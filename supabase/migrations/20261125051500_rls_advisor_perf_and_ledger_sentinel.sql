-- =============================================================================
-- Migration: RLS Advisor Optimization, Materialized View Hardening,
-- Extension Relocation, and Deterministic Ledger Invariant Sentinel
-- =============================================================================

-- 1. Move pg_trgm extension out of public schema to satisfy schema cleanliness
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm' AND n.nspname = 'public'
  ) THEN
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  END IF;
END $$;

-- 2. Restrict direct API access on materialized view public.company_client_map
--    and provide a tenant-scoped wrapper RPC for company client counts.
REVOKE ALL ON TABLE public.company_client_map FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.company_client_map TO service_role;

CREATE OR REPLACE FUNCTION public.get_company_client_counts(p_company_ids uuid[] DEFAULT NULL)
RETURNS TABLE(company_id uuid, client_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT m.company_id, count(*)::bigint AS client_count
  FROM public.company_client_map m
  WHERE (p_company_ids IS NULL OR m.company_id = ANY(p_company_ids))
    AND public.has_company_access(v_uid, m.company_id)
  GROUP BY m.company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_client_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_client_counts(uuid[]) TO authenticated, service_role;

-- 3. Deterministic Ledger Invariant Sentinel RPC
--    Verifies arithmetic balance invariants, batch totals, settlement states,
--    and classification gates without mutating any data.
CREATE OR REPLACE FUNCTION public.run_ledger_invariant_audit(p_company_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_div_mismatch bigint := 0;
  v_int_mismatch bigint := 0;
  v_mf_mismatch bigint := 0;
  v_batch_sum_mismatch bigint := 0;
  v_completed_pending_payments bigint := 0;
  v_paid_zero_amount bigint := 0;
  v_unclassified_in_batches bigint := 0;
  v_checks jsonb;
  v_passed boolean;
BEGIN
  IF v_uid IS NOT NULL THEN
    IF NOT (SELECT public.has_any_role(
      v_uid,
      ARRAY['admin', 'supervisor', 'auditor', 'finance_operator']::public.app_role[]
    )) THEN
      RAISE EXCEPTION 'Forbidden: insufficient role for ledger invariant audit' USING ERRCODE = '42501';
    END IF;
    IF p_company_id IS NOT NULL AND NOT public.has_company_access(v_uid, p_company_id) THEN
      RAISE EXCEPTION 'Forbidden: caller lacks access to company %', p_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT count(*) INTO v_div_mismatch
  FROM public.dividend_payables dp
  WHERE (p_company_id IS NULL OR dp.company_id = p_company_id)
    AND abs(
      COALESCE(dp.gross_dividend, 0)
      - COALESCE(dp.tax_amount, 0)
      - CASE WHEN COALESCE(dp.bonus_tax_mode, 'CASH_ADJUSTED') = 'CASH_ADJUSTED' THEN COALESCE(dp.bonus_tax, 0) ELSE 0 END
      - COALESCE(dp.net_payable, 0)
    ) > 0.05;

  SELECT count(*) INTO v_int_mismatch
  FROM public.interest_payables ip
  WHERE (p_company_id IS NULL OR ip.company_id = p_company_id)
    AND abs(
      COALESCE(ip.gross_interest, 0)
      - COALESCE(ip.tax_amount, 0)
      - COALESCE(ip.net_payable, 0)
    ) > 0.05;

  SELECT count(*) INTO v_mf_mismatch
  FROM public.mutual_fund_payables mf
  WHERE (p_company_id IS NULL OR mf.company_id = p_company_id)
    AND abs(
      COALESCE(mf.gross_dividend, 0)
      - COALESCE(mf.tax_amount, 0)
      - CASE WHEN COALESCE(mf.bonus_tax_mode, 'CASH_ADJUSTED') = 'CASH_ADJUSTED' THEN COALESCE(mf.bonus_tax, 0) ELSE 0 END
      - COALESCE(mf.net_payable, 0)
    ) > 0.05;

  SELECT count(*) INTO v_batch_sum_mismatch
  FROM (
    SELECT pb.id, pb.total_amount, COALESCE(SUM(p.net_amount), 0) AS calc_sum
    FROM public.payment_batches pb
    LEFT JOIN public.payments p
      ON p.batch_id = pb.id
      AND COALESCE(p.status, 'Pending') NOT IN ('Reversed', 'Cancelled')
    WHERE (p_company_id IS NULL OR pb.company_id = p_company_id)
      AND COALESCE(pb.status::text, '') NOT IN ('Reversed', 'Cancelled')
    GROUP BY pb.id, pb.total_amount
    HAVING abs(COALESCE(pb.total_amount, 0) - COALESCE(SUM(p.net_amount), 0)) > 0.05
  ) t;

  SELECT count(*) INTO v_completed_pending_payments
  FROM public.payment_batches pb
  JOIN public.payments p ON p.batch_id = pb.id
  WHERE (p_company_id IS NULL OR pb.company_id = p_company_id)
    AND pb.status = 'Completed'
    AND COALESCE(p.status, 'Pending') NOT IN ('Completed', 'Paid', 'Failed', 'Reversed', 'Cancelled');

  SELECT (
    (SELECT count(*) FROM public.dividend_payables WHERE (p_company_id IS NULL OR company_id = p_company_id) AND payment_status = 'Paid' AND COALESCE(net_payable, 0) > 0 AND COALESCE(paid_amount, 0) <= 0)
    + (SELECT count(*) FROM public.interest_payables WHERE (p_company_id IS NULL OR company_id = p_company_id) AND payment_status = 'Paid' AND COALESCE(net_payable, 0) > 0 AND COALESCE(paid_amount, 0) <= 0)
    + (SELECT count(*) FROM public.mutual_fund_payables WHERE (p_company_id IS NULL OR company_id = p_company_id) AND payment_status = 'Paid' AND COALESCE(net_payable, 0) > 0 AND COALESCE(paid_amount, 0) <= 0)
  ) INTO v_paid_zero_amount;

  SELECT count(*) INTO v_unclassified_in_batches
  FROM public.payments p
  LEFT JOIN public.dividend_payables dp ON p.payable_type = 'dividend' AND p.payable_id = dp.id
  LEFT JOIN public.interest_payables ip ON p.payable_type = 'interest' AND p.payable_id = ip.id
  LEFT JOIN public.mutual_fund_payables mf ON p.payable_type = 'mutual_fund' AND p.payable_id = mf.id
  WHERE (p_company_id IS NULL OR p.company_id = p_company_id)
    AND COALESCE(p.status, 'Pending') NOT IN ('Reversed', 'Cancelled', 'Failed')
    AND (
      (p.payable_type = 'dividend' AND dp.id IS NOT NULL AND (dp.payee_classification = 'UNCLASSIFIED' OR dp.classification_status = 'REVIEW_REQUIRED'))
      OR (p.payable_type = 'interest' AND ip.id IS NOT NULL AND (ip.payee_classification = 'UNCLASSIFIED' OR ip.classification_status = 'REVIEW_REQUIRED'))
      OR (p.payable_type = 'mutual_fund' AND mf.id IS NOT NULL AND (mf.payee_classification = 'UNCLASSIFIED' OR mf.classification_status = 'REVIEW_REQUIRED'))
    );

  v_checks := jsonb_build_array(
    jsonb_build_object('code', 'DIVIDEND_BALANCE_INVARIANT', 'label', 'Dividend Gross - CashTax - BonusTax = Net', 'violations', v_div_mismatch, 'passed', v_div_mismatch = 0),
    jsonb_build_object('code', 'INTEREST_BALANCE_INVARIANT', 'label', 'Debenture Interest Gross - Tax = Net', 'violations', v_int_mismatch, 'passed', v_int_mismatch = 0),
    jsonb_build_object('code', 'MUTUAL_FUND_BALANCE_INVARIANT', 'label', 'Mutual Fund Gross - CashTax - BonusTax = Net', 'violations', v_mf_mismatch, 'passed', v_mf_mismatch = 0),
    jsonb_build_object('code', 'BATCH_PAYMENT_SUM_PARITY', 'label', 'Payment Batch Total = Active Payment Lines Sum', 'violations', v_batch_sum_mismatch, 'passed', v_batch_sum_mismatch = 0),
    jsonb_build_object('code', 'COMPLETED_BATCH_LINE_SETTLEMENT', 'label', 'Completed Batches Have Zero Unsettled Lines', 'violations', v_completed_pending_payments, 'passed', v_completed_pending_payments = 0),
    jsonb_build_object('code', 'PAID_PAYABLE_NONZERO_SETTLED_AMOUNT', 'label', 'Paid Payables Have Positive paid_amount', 'violations', v_paid_zero_amount, 'passed', v_paid_zero_amount = 0),
    jsonb_build_object('code', 'BATCH_CLASSIFICATION_GATE', 'label', 'Active Payment Batches Exclude Unclassified/Review Rows', 'violations', v_unclassified_in_batches, 'passed', v_unclassified_in_batches = 0)
  );

  v_passed := (v_div_mismatch + v_int_mismatch + v_mf_mismatch + v_batch_sum_mismatch + v_completed_pending_payments + v_paid_zero_amount + v_unclassified_in_batches) = 0;

  RETURN jsonb_build_object(
    'audited_at', now(),
    'company_id', p_company_id,
    'passed', v_passed,
    'total_violations', v_div_mismatch + v_int_mismatch + v_mf_mismatch + v_batch_sum_mismatch + v_completed_pending_payments + v_paid_zero_amount + v_unclassified_in_batches,
    'checks', v_checks
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_ledger_invariant_audit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_ledger_invariant_audit(uuid) TO authenticated, service_role;

-- 4. Eliminate multiple_permissive_policies by splitting ALL into INSERT/UPDATE/DELETE
--    and optimize all auth_rls_initplan expressions using (select auth.uid())

-- 4a. AGM tables (6 tables)
DO $$
DECLARE
  v_tbl text;
  v_tables text[] := ARRAY[
    'agm_broker_claims',
    'agm_broker_pools',
    'agm_drn_records',
    'agm_fiscal_year_meta',
    'agm_historical_shareholders',
    'agm_yearly_snapshots'
  ];
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', v_tbl || '_modify', v_tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', v_tbl || '_insert', v_tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', v_tbl || '_update', v_tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', v_tbl || '_delete', v_tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', v_tbl || '_select', v_tbl);

    EXECUTE format($p$
      CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (
        (
          (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role, 'read_only'::public.app_role]))
          AND (
            (company_id IS NULL AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role])))
            OR (SELECT public.has_company_access((SELECT auth.uid()), company_id))
          )
        )
        OR (
          (company_id IS NULL OR (SELECT public.has_company_access((SELECT auth.uid()), company_id)))
          AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role]))
        )
      );
    $p$, v_tbl || '_select', v_tbl);

    EXECUTE format($p$
      CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
      WITH CHECK (
        (company_id IS NULL OR (SELECT public.has_company_access((SELECT auth.uid()), company_id)))
        AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role]))
      );
    $p$, v_tbl || '_insert', v_tbl);

    EXECUTE format($p$
      CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
      USING (
        (company_id IS NULL OR (SELECT public.has_company_access((SELECT auth.uid()), company_id)))
        AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role]))
      )
      WITH CHECK (
        (company_id IS NULL OR (SELECT public.has_company_access((SELECT auth.uid()), company_id)))
        AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role]))
      );
    $p$, v_tbl || '_update', v_tbl);

    EXECUTE format($p$
      CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
      USING (
        (company_id IS NULL OR (SELECT public.has_company_access((SELECT auth.uid()), company_id)))
        AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role]))
      );
    $p$, v_tbl || '_delete', v_tbl);
  END LOOP;
END $$;

-- 4b. agm_import_staging
DROP POLICY IF EXISTS "agm_import_staging_insert" ON public.agm_import_staging;
CREATE POLICY "agm_import_staging_insert" ON public.agm_import_staging FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role]))
);

DROP POLICY IF EXISTS "agm_import_staging_delete" ON public.agm_import_staging;
CREATE POLICY "agm_import_staging_delete" ON public.agm_import_staging FOR DELETE TO authenticated
USING (
  (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role]))
);

-- 4c. corporate_declarations
DROP POLICY IF EXISTS "Authorized users can manage corporate declarations" ON public.corporate_declarations;
DROP POLICY IF EXISTS "Users can read declarations for authorized companies" ON public.corporate_declarations;
CREATE POLICY "Users can read declarations for authorized companies" ON public.corporate_declarations FOR SELECT TO authenticated
USING (
  (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  OR (SELECT public.has_company_access((SELECT auth.uid()), company_id))
);
CREATE POLICY "Authorized users can insert corporate declarations" ON public.corporate_declarations FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  OR (
    (SELECT public.has_company_access((SELECT auth.uid()), company_id))
    AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['finance_operator'::public.app_role, 'supervisor'::public.app_role, 'operator'::public.app_role, 'maker'::public.app_role]))
  )
);
CREATE POLICY "Authorized users can update corporate declarations" ON public.corporate_declarations FOR UPDATE TO authenticated
USING (
  (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  OR (
    (SELECT public.has_company_access((SELECT auth.uid()), company_id))
    AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['finance_operator'::public.app_role, 'supervisor'::public.app_role, 'operator'::public.app_role, 'maker'::public.app_role]))
  )
)
WITH CHECK (
  (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  OR (
    (SELECT public.has_company_access((SELECT auth.uid()), company_id))
    AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['finance_operator'::public.app_role, 'supervisor'::public.app_role, 'operator'::public.app_role, 'maker'::public.app_role]))
  )
);
CREATE POLICY "Authorized users can delete corporate declarations" ON public.corporate_declarations FOR DELETE TO authenticated
USING (
  (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  OR (
    (SELECT public.has_company_access((SELECT auth.uid()), company_id))
    AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['finance_operator'::public.app_role, 'supervisor'::public.app_role, 'operator'::public.app_role, 'maker'::public.app_role]))
  )
);

-- 4d. api_logs, approval_logs, audit_logs, error_logs, login_logs, payment_logs
DROP POLICY IF EXISTS "al_read" ON public.api_logs;
CREATE POLICY "al_read" ON public.api_logs FOR SELECT TO authenticated
USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'auditor'::public.app_role])));

DROP POLICY IF EXISTS "apl_insert" ON public.approval_logs;
CREATE POLICY "apl_insert" ON public.approval_logs FOR INSERT TO authenticated
WITH CHECK ((performed_by = (SELECT auth.uid())) OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])));

DROP POLICY IF EXISTS "apl_read" ON public.approval_logs;
CREATE POLICY "apl_read" ON public.approval_logs FOR SELECT TO authenticated
USING ((performed_by = (SELECT auth.uid())) OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role])));

DROP POLICY IF EXISTS "audit_insert" ON public.audit_logs;
CREATE POLICY "audit_insert" ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK ((user_id = (SELECT auth.uid())) OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

DROP POLICY IF EXISTS "audit_read" ON public.audit_logs;
CREATE POLICY "audit_read" ON public.audit_logs FOR SELECT TO authenticated
USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role])));

DROP POLICY IF EXISTS "el_read" ON public.error_logs;
CREATE POLICY "el_read" ON public.error_logs FOR SELECT TO authenticated
USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'auditor'::public.app_role])));

DROP POLICY IF EXISTS "ll_select" ON public.login_logs;
CREATE POLICY "ll_select" ON public.login_logs FOR SELECT TO authenticated
USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role])));

DROP POLICY IF EXISTS "pl_insert" ON public.payment_logs;
CREATE POLICY "pl_insert" ON public.payment_logs FOR INSERT TO authenticated
WITH CHECK ((performed_by = (SELECT auth.uid())) OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role])));

DROP POLICY IF EXISTS "pl_read" ON public.payment_logs;
CREATE POLICY "pl_read" ON public.payment_logs FOR SELECT TO authenticated
USING ((performed_by = (SELECT auth.uid())) OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role])));

-- 4e. clients, companies, payment_batches, pending_approvals, profiles, notifications
DROP POLICY IF EXISTS "clients_delete" ON public.clients;
CREATE POLICY "clients_delete" ON public.clients FOR DELETE TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

DROP POLICY IF EXISTS "clients_update" ON public.clients;
CREATE POLICY "clients_update" ON public.clients FOR UPDATE TO authenticated
USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role])));

DROP POLICY IF EXISTS "clients_write" ON public.clients;
CREATE POLICY "clients_write" ON public.clients FOR INSERT TO authenticated
WITH CHECK ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role])));

DROP POLICY IF EXISTS "companies_delete" ON public.companies;
CREATE POLICY "companies_delete" ON public.companies FOR DELETE TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

DROP POLICY IF EXISTS "companies_update" ON public.companies;
CREATE POLICY "companies_update" ON public.companies FOR UPDATE TO authenticated
USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role])));

DROP POLICY IF EXISTS "companies_write" ON public.companies;
CREATE POLICY "companies_write" ON public.companies FOR INSERT TO authenticated
WITH CHECK ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role])));

DROP POLICY IF EXISTS "pb_delete" ON public.payment_batches;
CREATE POLICY "pb_delete" ON public.payment_batches FOR DELETE TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

DROP POLICY IF EXISTS "pb_write" ON public.payment_batches;
CREATE POLICY "pb_write" ON public.payment_batches FOR INSERT TO authenticated
WITH CHECK ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role])));

DROP POLICY IF EXISTS "pa_delete" ON public.pending_approvals;
CREATE POLICY "pa_delete" ON public.pending_approvals FOR DELETE TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

DROP POLICY IF EXISTS "pa_insert" ON public.pending_approvals;
CREATE POLICY "pa_insert" ON public.pending_approvals FOR INSERT TO authenticated
WITH CHECK (requested_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated
USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "notif_insert" ON public.notifications;
CREATE POLICY "notif_insert" ON public.notifications FOR INSERT TO authenticated
WITH CHECK ((user_id = (SELECT auth.uid())) OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role])));

DROP POLICY IF EXISTS "notif_read" ON public.notifications;
CREATE POLICY "notif_read" ON public.notifications FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "notif_update" ON public.notifications;
CREATE POLICY "notif_update" ON public.notifications FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()));

-- 4f. fiscal_years, iaf_allocations, notification_configs, payable_tax_rules, system_settings
DROP POLICY IF EXISTS "fy_admin" ON public.fiscal_years;
CREATE POLICY "fy_admin_insert" ON public.fiscal_years FOR INSERT TO authenticated
WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
CREATE POLICY "fy_admin_update" ON public.fiscal_years FOR UPDATE TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
CREATE POLICY "fy_admin_delete" ON public.fiscal_years FOR DELETE TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

DROP POLICY IF EXISTS "iaf_write" ON public.iaf_allocations;
DROP POLICY IF EXISTS "iaf_read" ON public.iaf_allocations;
CREATE POLICY "iaf_read" ON public.iaf_allocations FOR SELECT TO authenticated
USING (
  (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]))
);
CREATE POLICY "iaf_write_insert" ON public.iaf_allocations FOR INSERT TO authenticated
WITH CHECK ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role])));
CREATE POLICY "iaf_write_update" ON public.iaf_allocations FOR UPDATE TO authenticated
USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role])))
WITH CHECK ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role])));
CREATE POLICY "iaf_write_delete" ON public.iaf_allocations FOR DELETE TO authenticated
USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role])));

DROP POLICY IF EXISTS "nc_admin" ON public.notification_configs;
CREATE POLICY "nc_admin_insert" ON public.notification_configs FOR INSERT TO authenticated
WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
CREATE POLICY "nc_admin_update" ON public.notification_configs FOR UPDATE TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
CREATE POLICY "nc_admin_delete" ON public.notification_configs FOR DELETE TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

DROP POLICY IF EXISTS "admins manage payable tax rules" ON public.payable_tax_rules;
CREATE POLICY "admins insert payable tax rules" ON public.payable_tax_rules FOR INSERT TO authenticated
WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
CREATE POLICY "admins update payable tax rules" ON public.payable_tax_rules FOR UPDATE TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
CREATE POLICY "admins delete payable tax rules" ON public.payable_tax_rules FOR DELETE TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

DROP POLICY IF EXISTS "ss_admin" ON public.system_settings;
DROP POLICY IF EXISTS "ss_read_admin" ON public.system_settings;
CREATE POLICY "ss_read_admin" ON public.system_settings FOR SELECT TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
CREATE POLICY "ss_admin_insert" ON public.system_settings FOR INSERT TO authenticated
WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
CREATE POLICY "ss_admin_update" ON public.system_settings FOR UPDATE TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
CREATE POLICY "ss_admin_delete" ON public.system_settings FOR DELETE TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

-- 4g. user_company_access & user_roles
DROP POLICY IF EXISTS "uca_admin_all" ON public.user_company_access;
DROP POLICY IF EXISTS "uca_select" ON public.user_company_access;
CREATE POLICY "uca_select" ON public.user_company_access FOR SELECT TO authenticated
USING (
  (user_id = (SELECT auth.uid()))
  OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role]))
);
CREATE POLICY "uca_admin_insert" ON public.user_company_access FOR INSERT TO authenticated
WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
CREATE POLICY "uca_admin_update" ON public.user_company_access FOR UPDATE TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
CREATE POLICY "uca_admin_delete" ON public.user_company_access FOR DELETE TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

DROP POLICY IF EXISTS "roles_admin_all" ON public.user_roles;
DROP POLICY IF EXISTS "roles_select_own" ON public.user_roles;
CREATE POLICY "roles_select_own" ON public.user_roles FOR SELECT TO authenticated
USING (
  (user_id = (SELECT auth.uid()))
  OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
);
CREATE POLICY "roles_admin_insert" ON public.user_roles FOR INSERT TO authenticated
WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
CREATE POLICY "roles_admin_update" ON public.user_roles FOR UPDATE TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
CREATE POLICY "roles_admin_delete" ON public.user_roles FOR DELETE TO authenticated
USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

-- 4h. import_staging, report_presets, report_versions, scheduled_reports
DROP POLICY IF EXISTS "import_staging_select" ON public.import_staging;
CREATE POLICY "import_staging_select" ON public.import_staging FOR SELECT TO authenticated
USING (
  (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
);
DROP POLICY IF EXISTS "import_staging_insert" ON public.import_staging;
CREATE POLICY "import_staging_insert" ON public.import_staging FOR INSERT TO authenticated
WITH CHECK (
  ((SELECT auth.uid()) IS NOT NULL)
  AND (created_by = (SELECT auth.uid()))
  AND (
    (SELECT public.has_company_access((SELECT auth.uid()), company_id))
    OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  )
);
DROP POLICY IF EXISTS "import_staging_update" ON public.import_staging;
CREATE POLICY "import_staging_update" ON public.import_staging FOR UPDATE TO authenticated
USING (
  ((SELECT auth.uid()) IS NOT NULL)
  AND (
    (created_by = (SELECT auth.uid()) AND status = 'STAGED' AND (SELECT public.has_company_access((SELECT auth.uid()), company_id)))
    OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  )
);
DROP POLICY IF EXISTS "import_staging_delete" ON public.import_staging;
CREATE POLICY "import_staging_delete" ON public.import_staging FOR DELETE TO authenticated
USING (
  ((SELECT auth.uid()) IS NOT NULL)
  AND (
    (created_by = (SELECT auth.uid()) AND status = 'STAGED' AND (SELECT public.has_company_access((SELECT auth.uid()), company_id)))
    OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  )
);

DROP POLICY IF EXISTS "report_presets_select" ON public.report_presets;
CREATE POLICY "report_presets_select" ON public.report_presets FOR SELECT TO authenticated
USING (
  (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
);
DROP POLICY IF EXISTS "report_presets_insert" ON public.report_presets;
CREATE POLICY "report_presets_insert" ON public.report_presets FOR INSERT TO authenticated
WITH CHECK (
  ((SELECT auth.uid()) IS NOT NULL)
  AND (created_by = (SELECT auth.uid()))
  AND (
    (SELECT public.has_company_access((SELECT auth.uid()), company_id))
    OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  )
);
DROP POLICY IF EXISTS "report_presets_update" ON public.report_presets;
CREATE POLICY "report_presets_update" ON public.report_presets FOR UPDATE TO authenticated
USING (
  ((SELECT auth.uid()) IS NOT NULL)
  AND (
    (created_by = (SELECT auth.uid()) AND (SELECT public.has_company_access((SELECT auth.uid()), company_id)))
    OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  )
);
DROP POLICY IF EXISTS "report_presets_delete" ON public.report_presets;
CREATE POLICY "report_presets_delete" ON public.report_presets FOR DELETE TO authenticated
USING (
  ((SELECT auth.uid()) IS NOT NULL)
  AND (
    (created_by = (SELECT auth.uid()) AND (SELECT public.has_company_access((SELECT auth.uid()), company_id)))
    OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  )
);

DROP POLICY IF EXISTS "report_versions_modify" ON public.report_versions;
DROP POLICY IF EXISTS "report_versions_select" ON public.report_versions;
DROP POLICY IF EXISTS "report_versions_insert" ON public.report_versions;
CREATE POLICY "report_versions_select" ON public.report_versions FOR SELECT TO authenticated
USING (
  (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
);
CREATE POLICY "report_versions_insert" ON public.report_versions FOR INSERT TO authenticated
WITH CHECK (
  ((SELECT auth.uid()) IS NOT NULL)
  AND (
    (
      generated_by = (SELECT auth.uid())
      AND (
        (SELECT public.has_company_access((SELECT auth.uid()), company_id))
        OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
      )
    )
    OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  )
);
CREATE POLICY "report_versions_update" ON public.report_versions FOR UPDATE TO authenticated
USING (
  ((SELECT auth.uid()) IS NOT NULL)
  AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
);
CREATE POLICY "report_versions_delete" ON public.report_versions FOR DELETE TO authenticated
USING (
  ((SELECT auth.uid()) IS NOT NULL)
  AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
);

DROP POLICY IF EXISTS "scheduled_reports_select" ON public.scheduled_reports;
CREATE POLICY "scheduled_reports_select" ON public.scheduled_reports FOR SELECT TO authenticated
USING (
  (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
);
DROP POLICY IF EXISTS "scheduled_reports_insert" ON public.scheduled_reports;
CREATE POLICY "scheduled_reports_insert" ON public.scheduled_reports FOR INSERT TO authenticated
WITH CHECK (
  ((SELECT auth.uid()) IS NOT NULL)
  AND (created_by = (SELECT auth.uid()))
  AND (
    (SELECT public.has_company_access((SELECT auth.uid()), company_id))
    OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  )
);
DROP POLICY IF EXISTS "scheduled_reports_update" ON public.scheduled_reports;
CREATE POLICY "scheduled_reports_update" ON public.scheduled_reports FOR UPDATE TO authenticated
USING (
  ((SELECT auth.uid()) IS NOT NULL)
  AND (
    (created_by = (SELECT auth.uid()) AND (SELECT public.has_company_access((SELECT auth.uid()), company_id)))
    OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  )
);
DROP POLICY IF EXISTS "scheduled_reports_delete" ON public.scheduled_reports;
CREATE POLICY "scheduled_reports_delete" ON public.scheduled_reports FOR DELETE TO authenticated
USING (
  ((SELECT auth.uid()) IS NOT NULL)
  AND (
    (created_by = (SELECT auth.uid()) AND (SELECT public.has_company_access((SELECT auth.uid()), company_id)))
    OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  )
);
