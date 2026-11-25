-- =============================================================================
-- Migration: Security, RLS Isolation, View Invoker & Privilege Hardening
-- Fixes:
--   1. Cron secret exposure (get_cron_secret / system_settings fallback / pg_cron)
--   2. SECURITY DEFINER views (upload_logs, reconciliation_lots -> security_invoker = true)
--   3. Excessive anon / PUBLIC privileges on tables, views, sequences & routines
--   4. Multi-tenant bypass default in has_company_access & RLS policies (ELSE TRUE -> FALSE)
--   5. Auth/role/company guards on unguarded SECURITY DEFINER RPCs
--   6. Overloaded ambiguous RPC signatures & duplicate indexes
-- =============================================================================

-- 1. Rotate hardcoded cron_secret in system_settings if still set to the insecure default
UPDATE public.system_settings
SET
  setting_value = jsonb_set(
    COALESCE(setting_value, '{}'::jsonb),
    '{secret}',
    to_jsonb(encode(extensions.gen_random_bytes(32), 'hex'))
  ),
  updated_at = now()
WHERE setting_key = 'cron_secret'
  AND COALESCE(setting_value->>'secret', '') IN ('', 'rtarts-internal-cron-secret');

-- Ensure cron_secret exists even in fresh environments without leaking any static literal
INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES (
  'cron_secret',
  jsonb_build_object('secret', encode(extensions.gen_random_bytes(32), 'hex')),
  'Auto-generated internal cron authentication secret'
)
ON CONFLICT (setting_key) DO NOTHING;

-- 2. Lock down get_cron_secret() strictly to internal Postgres/service_role callers
CREATE OR REPLACE FUNCTION public.get_cron_secret()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_secret text;
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin')
     AND COALESCE(v_jwt_role, '') <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: cron secret is internal-only' USING ERRCODE = '42501';
  END IF;

  v_secret := NULLIF(current_setting('app.settings.cron_secret', true), '');
  IF v_secret IS NOT NULL THEN
    RETURN v_secret;
  END IF;

  SELECT NULLIF(setting_value->>'secret', '') INTO v_secret
  FROM public.system_settings
  WHERE setting_key = 'cron_secret'
  LIMIT 1;

  IF v_secret IS NULL OR v_secret = 'rtarts-internal-cron-secret' THEN
    RAISE EXCEPTION 'app.settings.cron_secret is not configured securely' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.get_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_secret() TO service_role;

-- 3. Harden trigger_process_scheduled_reports() and restore pg_cron registration idempotently
CREATE OR REPLACE FUNCTION public.trigger_process_scheduled_reports()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'cron'
AS $$
DECLARE
  v_url text;
  v_cron_secret text;
  v_request_id bigint;
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin')
     AND COALESCE(v_jwt_role, '') <> 'service_role' THEN
    PERFORM public.require_role('admin', 'supervisor');
  END IF;

  v_url := coalesce(
    nullif(current_setting('app.settings.edge_function_url', true), ''),
    'http://supabase_kong_illokcvaflhzrpxlwhtj:8000/functions/v1/process-scheduled-reports'
  );
  v_cron_secret := public.get_cron_secret();

  IF v_cron_secret IS NULL THEN
    RAISE EXCEPTION 'CRON trigger failed: app.settings.cron_secret is not configured.';
  END IF;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_cron_secret
    ),
    body := '{}'::jsonb
  ) INTO v_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request_id,
    'endpoint', v_url,
    'triggered_at', now()
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'triggered_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_process_scheduled_reports() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trigger_process_scheduled_reports() TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'cron' AND p.proname = 'schedule') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-scheduled-reports-job') THEN
      PERFORM cron.unschedule('process-scheduled-reports-job');
    END IF;
    PERFORM cron.schedule(
      'process-scheduled-reports-job',
      '*/15 * * * *',
      $cron$SELECT public.trigger_process_scheduled_reports();$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 4. Convert SECURITY DEFINER views to security_invoker = true so base-table RLS always applies
ALTER VIEW public.upload_logs SET (security_invoker = true);
ALTER VIEW public.reconciliation_lots SET (security_invoker = true);

-- 5. Enforce least privilege across schema public tables, views, materialized views, sequences
DO $$
DECLARE
  r record;
BEGIN
  -- Revoke ALL table/view/mview grants from anon and PUBLIC
  FOR r IN
    SELECT n.nspname, c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM PUBLIC, anon;', r.nspname, r.relname);
    IF r.relkind IN ('v', 'm') THEN
      EXECUTE format('GRANT SELECT ON TABLE %I.%I TO authenticated, service_role;', r.nspname, r.relname);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO authenticated;', r.nspname, r.relname);
      EXECUTE format('GRANT ALL ON TABLE %I.%I TO service_role;', r.nspname, r.relname);
    END IF;
  END LOOP;

  -- Revoke ALL sequence grants from anon and PUBLIC
  FOR r IN
    SELECT n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE %I.%I FROM PUBLIC, anon;', r.nspname, r.relname);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I.%I TO authenticated, service_role;', r.nspname, r.relname);
  END LOOP;

  -- Revoke default EXECUTE from PUBLIC and anon across all routines in schema public
  FOR r IN
    SELECT p.oid::regprocedure AS fn_sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon;', r.fn_sig);
    IF r.proname NOT IN ('get_cron_secret') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role;', r.fn_sig);
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon;

-- 6. Remove global read bypass when a user has zero rows in user_company_access
CREATE OR REPLACE FUNCTION public.has_company_access(_user_id uuid, _company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    CASE
      WHEN _user_id IS NULL OR _company_id IS NULL THEN FALSE
      WHEN (SELECT public.has_any_role(_user_id, ARRAY[
        'admin'::public.app_role,
        'supervisor'::public.app_role,
        'auditor'::public.app_role,
        'report_viewer'::public.app_role,
        'read_only'::public.app_role
      ])) THEN TRUE
      WHEN EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id = _company_id
          AND c.created_by = _user_id
      ) THEN TRUE
      WHEN EXISTS (
        SELECT 1 FROM public.user_company_access uca
        WHERE uca.user_id = _user_id
          AND uca.company_id = _company_id
      ) THEN TRUE
      ELSE FALSE
    END;
$$;

-- 7. Tighten tenant isolation across RLS policies (drop NOT EXISTS(user_company_access) bypass & unguarded user_id IS NULL)
DROP POLICY IF EXISTS "companies_read" ON public.companies;
CREATE POLICY "companies_read" ON public.companies
FOR SELECT TO authenticated
USING ((SELECT public.has_company_access((SELECT auth.uid()), id)));

DROP POLICY IF EXISTS "clients_read" ON public.clients;
CREATE POLICY "clients_read" ON public.clients
FOR SELECT TO authenticated
USING (
  (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  OR (
    company_id IS NULL
    AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role
    ]))
  )
);

DROP POLICY IF EXISTS "dp_read" ON public.dividend_payables;
CREATE POLICY "dp_read" ON public.dividend_payables
FOR SELECT TO authenticated
USING ((SELECT public.has_company_access((SELECT auth.uid()), company_id)));

DROP POLICY IF EXISTS "ip_read" ON public.interest_payables;
CREATE POLICY "ip_read" ON public.interest_payables
FOR SELECT TO authenticated
USING ((SELECT public.has_company_access((SELECT auth.uid()), company_id)));

DROP POLICY IF EXISTS "mfp_read" ON public.mutual_fund_payables;
CREATE POLICY "mfp_read" ON public.mutual_fund_payables
FOR SELECT TO authenticated
USING ((SELECT public.has_company_access((SELECT auth.uid()), company_id)));

DROP POLICY IF EXISTS "pay_read" ON public.payments;
CREATE POLICY "pay_read" ON public.payments
FOR SELECT TO authenticated
USING ((SELECT public.has_company_access((SELECT auth.uid()), company_id)));

DROP POLICY IF EXISTS "pb_read" ON public.payment_batches;
CREATE POLICY "pb_read" ON public.payment_batches
FOR SELECT TO authenticated
USING ((SELECT public.has_company_access((SELECT auth.uid()), company_id)));

DROP POLICY IF EXISTS "pb_update" ON public.payment_batches;
CREATE POLICY "pb_update" ON public.payment_batches
FOR UPDATE TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'approver'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND (
    company_id IS NULL
    OR (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  )
)
WITH CHECK (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'approver'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND (
    company_id IS NULL
    OR (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  )
);

DROP POLICY IF EXISTS "rr_select" ON public.reconciliation_results;
CREATE POLICY "rr_select" ON public.reconciliation_results
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role,
    'reconciliation_officer'::public.app_role, 'finance_operator'::public.app_role,
    'checker'::public.app_role, 'approver'::public.app_role, 'maker'::public.app_role,
    'operator'::public.app_role, 'report_viewer'::public.app_role, 'read_only'::public.app_role
  ]))
  AND (SELECT public.has_company_access((SELECT auth.uid()), company_id))
);

DROP POLICY IF EXISTS "iaf_read" ON public.iaf_allocations;
CREATE POLICY "iaf_read" ON public.iaf_allocations
FOR SELECT TO authenticated
USING ((SELECT public.has_company_access((SELECT auth.uid()), company_id)));

DROP POLICY IF EXISTS "agm_broker_claims_select" ON public.agm_broker_claims;
CREATE POLICY "agm_broker_claims_select" ON public.agm_broker_claims
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role,
    'operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role, 'read_only'::public.app_role
  ]))
  AND (
    (company_id IS NULL AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role
    ])))
    OR (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  )
);

DROP POLICY IF EXISTS "agm_broker_pools_select" ON public.agm_broker_pools;
CREATE POLICY "agm_broker_pools_select" ON public.agm_broker_pools
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role,
    'operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role, 'read_only'::public.app_role
  ]))
  AND (
    (company_id IS NULL AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role
    ])))
    OR (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  )
);

DROP POLICY IF EXISTS "agm_drn_records_select" ON public.agm_drn_records;
CREATE POLICY "agm_drn_records_select" ON public.agm_drn_records
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role,
    'operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role, 'read_only'::public.app_role
  ]))
  AND (
    (company_id IS NULL AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role
    ])))
    OR (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  )
);

DROP POLICY IF EXISTS "agm_fiscal_year_meta_select" ON public.agm_fiscal_year_meta;
CREATE POLICY "agm_fiscal_year_meta_select" ON public.agm_fiscal_year_meta
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role,
    'operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role, 'read_only'::public.app_role
  ]))
  AND (
    (company_id IS NULL AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role
    ])))
    OR (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  )
);

DROP POLICY IF EXISTS "agm_historical_shareholders_select" ON public.agm_historical_shareholders;
CREATE POLICY "agm_historical_shareholders_select" ON public.agm_historical_shareholders
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role,
    'operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role, 'read_only'::public.app_role
  ]))
  AND (
    (company_id IS NULL AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role
    ])))
    OR (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  )
);

DROP POLICY IF EXISTS "agm_yearly_snapshots_select" ON public.agm_yearly_snapshots;
CREATE POLICY "agm_yearly_snapshots_select" ON public.agm_yearly_snapshots
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role,
    'operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role, 'read_only'::public.app_role
  ]))
  AND (
    (company_id IS NULL AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role
    ])))
    OR (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  )
);

DROP POLICY IF EXISTS "uh_read" ON public.upload_history;
CREATE POLICY "uh_read" ON public.upload_history
FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role
  ]))
);

DROP POLICY IF EXISTS "uh_update" ON public.upload_history;
CREATE POLICY "uh_update" ON public.upload_history
FOR UPDATE TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role
  ]))
);

DROP POLICY IF EXISTS "pa_review" ON public.pending_approvals;
CREATE POLICY "pa_review" ON public.pending_approvals
FOR UPDATE TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role, 'supervisor'::public.app_role, 'checker'::public.app_role, 'approver'::public.app_role
  ]))
);

-- 8. Drop obsolete overloaded RPC signatures and duplicate indexes
DROP FUNCTION IF EXISTS public.bulk_upsert_company(text, text);
DROP FUNCTION IF EXISTS public.get_agm_summary_stats();
DROP FUNCTION IF EXISTS public.revert_payment_batch_atomic(uuid, uuid);

DROP INDEX IF EXISTS public.idx_bank_stmt_imports_company_hash;
DROP INDEX IF EXISTS public.idx_div_payables_comp_client;
DROP INDEX IF EXISTS public.idx_dividend_fy;
DROP INDEX IF EXISTS public.idx_dividend_payables_status;
DROP INDEX IF EXISTS public.idx_int_payables_comp_client;
DROP INDEX IF EXISTS public.idx_mutual_fund_fy;

-- 9. Add explicit auth + role + tenant scoping to previously unguarded SECURITY DEFINER RPCs
CREATE OR REPLACE FUNCTION public.search_payments_paginated(
  p_search_term text DEFAULT NULL::text,
  p_company_id uuid DEFAULT NULL::uuid,
  p_status text DEFAULT NULL::text,
  p_limit integer DEFAULT 15,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, company_id uuid, client_id uuid, gross_amount numeric, tax_amount numeric,
  net_amount numeric, paid_amount numeric, status text, bank_name text, bank_account_no text,
  payment_reference text, connectips_ref text, payment_method text, payment_date date,
  created_at timestamp with time zone, boid text, full_name text, holder_type text,
  company_name text, company_code text, total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_clean_search text := trim(p_search_term);
  v_uid uuid := auth.uid();
  v_jwt_role text;
  v_is_service boolean := false;
BEGIN
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;
  v_is_service := (current_user IN ('postgres', 'service_role', 'supabase_admin') OR COALESCE(v_jwt_role, '') = 'service_role');

  IF NOT v_is_service THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer', 'checker', 'approver', 'operator', 'maker', 'auditor', 'report_viewer', 'read_only');
    IF p_company_id IS NOT NULL AND NOT public.has_company_access(v_uid, p_company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to company %', p_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      p.id,
      p.company_id,
      p.client_id,
      p.gross_amount,
      p.tax_amount,
      p.net_amount,
      p.paid_amount,
      p.status::text,
      p.bank_name,
      p.bank_account_no,
      p.payment_reference,
      p.connectips_ref,
      p.payment_method::text,
      p.payment_date,
      p.created_at,
      c.boid,
      c.full_name,
      c.holder_type::text,
      co.company_name,
      co.company_code,
      COUNT(*) OVER() AS total_count
    FROM public.payments p
    LEFT JOIN public.clients c ON p.client_id = c.id
    LEFT JOIN public.companies co ON p.company_id = co.id
    WHERE
      (v_is_service OR public.has_company_access(v_uid, p.company_id))
      AND (p_company_id IS NULL OR p.company_id = p_company_id)
      AND (p_status IS NULL OR p_status = 'all' OR p.status::text = p_status)
      AND (
        v_clean_search IS NULL OR v_clean_search = ''
        OR p.payment_reference ILIKE '%' || v_clean_search || '%'
        OR p.connectips_ref ILIKE '%' || v_clean_search || '%'
        OR p.bank_account_no ILIKE '%' || v_clean_search || '%'
        OR c.boid ILIKE '%' || v_clean_search || '%'
        OR c.full_name ILIKE '%' || v_clean_search || '%'
      )
    ORDER BY p.created_at DESC, p.id ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 15), 500))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  )
  SELECT * FROM filtered;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_agm_summary_stats(p_company_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt_role text;
  v_is_service boolean := false;
  v_result jsonb;
BEGIN
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;
  v_is_service := (current_user IN ('postgres', 'service_role', 'supabase_admin') OR COALESCE(v_jwt_role, '') = 'service_role');

  IF NOT v_is_service THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'auditor', 'report_viewer', 'read_only');
    IF p_company_id IS NOT NULL AND NOT public.has_company_access(v_uid, p_company_id) THEN
      RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'totalShareholders', COUNT(*),
    'totalKitta', COALESCE(SUM(current_kitta_2081), 0),
    'totalBonus', COALESCE(SUM(total_bonus_shares), 0),
    'totalCash', COALESCE(SUM(total_cash_dividend), 0),
    'totalTax', COALESCE(SUM(total_tax_withheld), 0),
    'mfCash', COALESCE(SUM(CASE WHEN holder_type = 'MUTUAL_FUND' THEN total_cash_dividend ELSE 0 END), 0)
  ) INTO v_result
  FROM public.agm_historical_shareholders
  WHERE (v_is_service OR public.has_company_access(v_uid, company_id))
    AND (p_company_id IS NULL OR company_id = p_company_id);

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_distinct_fiscal_years(p_table text DEFAULT 'mutual_fund_payables'::text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt_role text;
  v_is_service boolean := false;
  v_res text[];
BEGIN
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;
  v_is_service := (current_user IN ('postgres', 'service_role', 'supabase_admin') OR COALESCE(v_jwt_role, '') = 'service_role');

  IF NOT v_is_service THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer', 'checker', 'approver', 'operator', 'maker', 'auditor', 'report_viewer', 'read_only');
  END IF;

  IF p_table = 'mutual_fund_payables' THEN
    SELECT array_agg(DISTINCT fiscal_year ORDER BY fiscal_year DESC)
    INTO v_res
    FROM public.mutual_fund_payables
    WHERE fiscal_year IS NOT NULL
      AND (v_is_service OR public.has_company_access(v_uid, company_id));
  ELSIF p_table = 'dividend_payables' THEN
    SELECT array_agg(DISTINCT fiscal_year ORDER BY fiscal_year DESC)
    INTO v_res
    FROM public.dividend_payables
    WHERE fiscal_year IS NOT NULL
      AND (v_is_service OR public.has_company_access(v_uid, company_id));
  ELSIF p_table = 'interest_payables' THEN
    SELECT array_agg(DISTINCT fiscal_year ORDER BY fiscal_year DESC)
    INTO v_res
    FROM public.interest_payables
    WHERE fiscal_year IS NOT NULL
      AND (v_is_service OR public.has_company_access(v_uid, company_id));
  END IF;

  RETURN COALESCE(v_res, '{}');
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_upload_progress_atomic(
  p_upload_id uuid,
  p_processed_inc integer DEFAULT 0,
  p_success_inc integer DEFAULT 0,
  p_error_inc integer DEFAULT 0,
  p_error_message text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt_role text;
  v_is_service boolean := false;
  v_rec record;
  v_new_status text;
BEGIN
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;
  v_is_service := (current_user IN ('postgres', 'service_role', 'supabase_admin') OR COALESCE(v_jwt_role, '') = 'service_role');

  IF NOT v_is_service THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');
  END IF;

  SELECT * INTO v_rec
  FROM public.upload_history
  WHERE id = p_upload_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Upload record not found');
  END IF;

  IF NOT v_is_service AND v_rec.user_id IS NOT NULL AND v_rec.user_id <> v_uid THEN
    IF NOT public.has_any_role(v_uid, ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role]) THEN
      RAISE EXCEPTION 'Unauthorized: cannot update upload owned by another user' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_new_status := v_rec.status;
  IF v_rec.total_rows > 0 AND (COALESCE(v_rec.processed_rows, 0) + p_processed_inc) >= v_rec.total_rows THEN
    IF (COALESCE(v_rec.error_rows, 0) + p_error_inc) > 0 THEN
      IF (COALESCE(v_rec.success_rows, 0) + p_success_inc) = 0 THEN
        v_new_status := 'Failed';
      ELSE
        v_new_status := 'Completed with Errors';
      END IF;
    ELSE
      v_new_status := 'Completed';
    END IF;
  END IF;

  UPDATE public.upload_history
  SET
    processed_rows = COALESCE(processed_rows, 0) + p_processed_inc,
    success_rows   = COALESCE(success_rows, 0) + p_success_inc,
    error_rows     = COALESCE(error_rows, 0) + p_error_inc,
    status         = v_new_status,
    completed_at   = CASE WHEN v_new_status IN ('Completed', 'Completed with Errors', 'Failed') THEN COALESCE(completed_at, now()) ELSE completed_at END,
    error_message  = CASE
      WHEN p_error_message IS NOT NULL AND p_error_message <> '' THEN
        COALESCE(NULLIF(error_message, '') || ' ; ', '') || p_error_message
      ELSE error_message
    END
  WHERE id = p_upload_id
  RETURNING * INTO v_rec;

  RETURN jsonb_build_object(
    'success', true,
    'upload_id', v_rec.id,
    'status', v_rec.status,
    'processed_rows', v_rec.processed_rows,
    'success_rows', v_rec.success_rows,
    'error_rows', v_rec.error_rows,
    'total_rows', v_rec.total_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_company_client_map()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin')
     AND COALESCE(v_jwt_role, '') <> 'service_role' THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');
  END IF;

  REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_client_map;
EXCEPTION WHEN OTHERS THEN
  REFRESH MATERIALIZED VIEW public.company_client_map;
END;
$$;
