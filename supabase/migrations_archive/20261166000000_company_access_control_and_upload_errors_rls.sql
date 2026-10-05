-- ============================================================================
-- Migration: 20261166000000_company_access_control_and_upload_errors_rls.sql
-- Description:
-- 1. Authoritative user_company_access table & has_company_access function
-- 2. Restrict upload_errors INSERT to upload owners and admins
-- 3. Enforce company-scoped SELECT policies on all financial and client tables
-- 4. Restrict AGM tables SELECT to authorized staff roles
-- 5. Enforce company authorization inside sensitive stored RPCs
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Authoritative user_company_access Table & Helper Function
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_company_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  role_override public.app_role,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_uca_user ON public.user_company_access(user_id);
CREATE INDEX IF NOT EXISTS idx_uca_company ON public.user_company_access(company_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_company_access TO authenticated;
GRANT ALL ON public.user_company_access TO service_role;

ALTER TABLE public.user_company_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "uca_select" ON public.user_company_access;
CREATE POLICY "uca_select" ON public.user_company_access
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role])
  );

DROP POLICY IF EXISTS "uca_admin_all" ON public.user_company_access;
CREATE POLICY "uca_admin_all" ON public.user_company_access
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.has_company_access(_user_id UUID, _company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    -- Admins and Supervisors always have unrestricted access across all companies
    has_any_role(_user_id, ARRAY['admin'::app_role, 'supervisor'::app_role])
    -- User has explicit company assignment in user_company_access
    OR EXISTS (
      SELECT 1 FROM public.user_company_access
      WHERE user_id = _user_id AND company_id = _company_id
    )
    -- Default fallback: if no company restrictions are assigned to this user,
    -- internal operations and compliance staff retain access
    OR (
      NOT EXISTS (SELECT 1 FROM public.user_company_access WHERE user_id = _user_id)
      AND has_any_role(_user_id, ARRAY['finance_operator'::app_role, 'auditor'::app_role, 'report_viewer'::app_role])
    )
  );
$$;

REVOKE ALL ON FUNCTION public.has_company_access(UUID, UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_company_access(UUID, UUID) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Restrict upload_errors INSERT Policy
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "ue_write" ON public.upload_errors;
CREATE POLICY "ue_write" ON public.upload_errors
  FOR INSERT
  TO authenticated
  WITH CHECK (
    upload_id IN (
      SELECT id FROM public.upload_history
      WHERE user_id = auth.uid() OR user_id IS NULL
    )
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'finance_operator'::app_role])
  );

-- ----------------------------------------------------------------------------
-- 3. Apply Company-Scoped Read Policies
-- ----------------------------------------------------------------------------

-- clients
DROP POLICY IF EXISTS "clients_read" ON public.clients;
CREATE POLICY "clients_read" ON public.clients
  FOR SELECT TO authenticated
  USING (
    company_id IS NULL 
    OR public.has_company_access(auth.uid(), company_id)
  );

-- dividend_payables
DROP POLICY IF EXISTS "dp_read" ON public.dividend_payables;
CREATE POLICY "dp_read" ON public.dividend_payables
  FOR SELECT TO authenticated
  USING (
    company_id IS NULL 
    OR public.has_company_access(auth.uid(), company_id)
  );

-- interest_payables
DROP POLICY IF EXISTS "ip_read" ON public.interest_payables;
CREATE POLICY "ip_read" ON public.interest_payables
  FOR SELECT TO authenticated
  USING (
    company_id IS NULL 
    OR public.has_company_access(auth.uid(), company_id)
  );

-- mutual_fund_payables
DROP POLICY IF EXISTS "mfp_read" ON public.mutual_fund_payables;
CREATE POLICY "mfp_read" ON public.mutual_fund_payables
  FOR SELECT TO authenticated
  USING (
    company_id IS NULL 
    OR public.has_company_access(auth.uid(), company_id)
  );

-- payment_batches
DROP POLICY IF EXISTS "pb_read" ON public.payment_batches;
CREATE POLICY "pb_read" ON public.payment_batches
  FOR SELECT TO authenticated
  USING (
    company_id IS NULL 
    OR public.has_company_access(auth.uid(), company_id)
  );

-- payments
DROP POLICY IF EXISTS "pay_read" ON public.payments;
CREATE POLICY "pay_read" ON public.payments
  FOR SELECT TO authenticated
  USING (
    company_id IS NULL 
    OR public.has_company_access(auth.uid(), company_id)
  );

-- reconciliation_results
DROP POLICY IF EXISTS "rr_read" ON public.reconciliation_results;
CREATE POLICY "rr_read" ON public.reconciliation_results
  FOR SELECT TO authenticated
  USING (
    company_id IS NULL 
    OR public.has_company_access(auth.uid(), company_id)
  );

-- iaf_allocations
DROP POLICY IF EXISTS "iaf_read" ON public.iaf_allocations;
CREATE POLICY "iaf_read" ON public.iaf_allocations
  FOR SELECT TO authenticated
  USING (
    company_id IS NULL 
    OR public.has_company_access(auth.uid(), company_id)
  );

-- companies
DROP POLICY IF EXISTS "companies_read" ON public.companies;
CREATE POLICY "companies_read" ON public.companies
  FOR SELECT TO authenticated
  USING (
    public.has_company_access(auth.uid(), id)
  );

-- ----------------------------------------------------------------------------
-- 4. Lockdown AGM Tables Read Policies
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "agm_broker_claims_select" ON public.agm_broker_claims;
CREATE POLICY "agm_broker_claims_select" ON public.agm_broker_claims
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'auditor'::app_role]));

DROP POLICY IF EXISTS "agm_broker_pools_select" ON public.agm_broker_pools;
CREATE POLICY "agm_broker_pools_select" ON public.agm_broker_pools
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'auditor'::app_role]));

DROP POLICY IF EXISTS "agm_drn_records_select" ON public.agm_drn_records;
CREATE POLICY "agm_drn_records_select" ON public.agm_drn_records
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'auditor'::app_role]));

DROP POLICY IF EXISTS "agm_fiscal_year_meta_select" ON public.agm_fiscal_year_meta;
CREATE POLICY "agm_fiscal_year_meta_select" ON public.agm_fiscal_year_meta
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'auditor'::app_role]));

DROP POLICY IF EXISTS "agm_historical_shareholders_select" ON public.agm_historical_shareholders;
CREATE POLICY "agm_historical_shareholders_select" ON public.agm_historical_shareholders
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'auditor'::app_role]));

DROP POLICY IF EXISTS "agm_yearly_snapshots_select" ON public.agm_yearly_snapshots;
CREATE POLICY "agm_yearly_snapshots_select" ON public.agm_yearly_snapshots
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'auditor'::app_role]));

-- ----------------------------------------------------------------------------
-- 5. Stored RPC Company Authorization Guards
-- ----------------------------------------------------------------------------

-- get_company_client_ids
CREATE OR REPLACE FUNCTION public.get_company_client_ids(p_company_id uuid)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  IF current_user != 'service_role' AND NOT public.has_company_access(auth.uid(), p_company_id) THEN
    RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT id FROM public.clients WHERE company_id = p_company_id
    UNION
    SELECT client_id FROM public.dividend_payables WHERE company_id = p_company_id AND client_id IS NOT NULL
    UNION
    SELECT client_id FROM public.interest_payables WHERE company_id = p_company_id AND client_id IS NOT NULL
    UNION
    SELECT client_id FROM public.mutual_fund_payables WHERE company_id = p_company_id AND client_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_client_ids(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_company_client_ids(uuid) TO authenticated, service_role;

-- get_company_client_stats
CREATE OR REPLACE FUNCTION public.get_company_client_stats(p_company_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint := 0;
  v_verified bigint := 0;
  v_pending bigint := 0;
  v_natural bigint := 0;
  v_institutions bigint := 0;
BEGIN
  IF (SELECT auth.uid()) IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NOT NULL AND current_user != 'service_role' THEN
    IF NOT public.has_company_access(auth.uid(), p_company_id) THEN
      RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  WITH target_clients AS (
    SELECT 
      c.id, 
      c.verification_status, 
      c.payee_classification,
      c.holder_type
    FROM public.clients c
    WHERE 
      (
        (p_company_id IS NOT NULL AND c.company_id = p_company_id)
        OR (
          p_company_id IS NULL 
          AND (c.company_id IS NULL OR public.has_company_access(auth.uid(), c.company_id))
        )
      )
  )
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE verification_status = 'Verified'),
    COUNT(*) FILTER (WHERE verification_status = 'Pending'),
    COUNT(*) FILTER (WHERE (payee_classification = 'NATURAL_PERSON' AND (holder_type IS NULL OR holder_type::text ILIKE '%Public%' OR holder_type::text ILIKE '%Natural%')) OR holder_type::text = 'Natural Person - Public'),
    COUNT(*) FILTER (WHERE payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR holder_type::text ILIKE '%Institution%' OR holder_type::text ILIKE '%Legal Person%')
  INTO v_total, v_verified, v_pending, v_natural, v_institutions
  FROM target_clients;

  RETURN json_build_object(
    'total', COALESCE(v_total, 0),
    'verified', COALESCE(v_verified, 0),
    'pending', COALESCE(v_pending, 0),
    'natural', COALESCE(v_natural, 0),
    'institutions', COALESCE(v_institutions, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_client_stats(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_company_client_stats(uuid) TO authenticated, service_role;

-- get_clients_paginated
CREATE OR REPLACE FUNCTION public.get_clients_paginated(
  p_company_id uuid DEFAULT NULL,
  p_holder_type text DEFAULT 'all',
  p_classification text DEFAULT 'all',
  p_status text DEFAULT 'all',
  p_verification text DEFAULT 'all',
  p_search text DEFAULT '',
  p_limit int DEFAULT 25,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  client_code text,
  client_id text,
  company_id uuid,
  full_name text,
  father_name text,
  grandfather_name text,
  date_of_birth text,
  gender text,
  occupation text,
  boid text,
  kitta numeric,
  holder_type public.holder_type,
  payee_classification text,
  pan_no text,
  citizenship_no text,
  pan_or_citizenship text,
  nid_number text,
  address text,
  province text,
  district text,
  municipality text,
  phone text,
  email text,
  bank_name text,
  bank_branch text,
  bank_account_no text,
  account_type text,
  residency public.residency_type,
  verification_status public.verification_status,
  status public.record_status,
  created_at timestamptz,
  company_name text,
  company_code text,
  total_count bigint
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_search_pattern text := '';
BEGIN
  IF (SELECT auth.uid()) IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NOT NULL AND current_user != 'service_role' THEN
    IF NOT public.has_company_access(auth.uid(), p_company_id) THEN
      RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_search IS NOT NULL AND trim(p_search) != '' THEN
    v_search_pattern := '%' || trim(p_search) || '%';
  END IF;

  RETURN QUERY
  WITH matching_clients AS (
    SELECT 
      c.id,
      c.client_code,
      c.client_id,
      c.company_id,
      c.full_name,
      c.father_name,
      c.grandfather_name,
      c.date_of_birth,
      c.gender,
      c.occupation,
      c.boid,
      COALESCE(c.kitta, 0) AS kitta,
      c.holder_type,
      c.payee_classification,
      c.pan_no,
      c.citizenship_no,
      c.pan_or_citizenship,
      c.nid_number,
      c.address,
      c.province,
      c.district,
      c.municipality,
      c.phone,
      c.email,
      c.bank_name,
      c.bank_branch,
      c.bank_account_no,
      c.account_type,
      c.residency,
      c.verification_status,
      c.status,
      c.created_at,
      comp.company_name,
      comp.company_code
    FROM public.clients c
    LEFT JOIN public.companies comp ON c.company_id = comp.id
    WHERE 
      (
        (p_company_id IS NOT NULL AND c.company_id = p_company_id)
        OR (
          p_company_id IS NULL 
          AND (c.company_id IS NULL OR public.has_company_access(auth.uid(), c.company_id))
        )
      )
      AND (
        p_holder_type = 'all'
        OR (
          p_holder_type = 'INSTITUTION' AND (
            c.payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON')
            OR c.holder_type::text ILIKE '%Institution%'
            OR c.holder_type::text ILIKE '%Legal Person%'
          )
        )
        OR (
          p_holder_type = 'PUBLIC' AND (
            (c.payee_classification = 'NATURAL_PERSON' AND (c.holder_type IS NULL OR c.holder_type::text ILIKE '%Public%' OR c.holder_type::text ILIKE '%Natural%'))
            OR c.holder_type::text = 'Natural Person - Public'
            OR (c.holder_type::text = 'Public' AND c.payee_classification != 'COMPANY_INSTITUTION')
          )
        )
        OR (p_holder_type = 'PROMOTER' AND c.holder_type::text ILIKE '%Promoter%')
        OR (p_holder_type = 'LOCAL' AND c.holder_type::text ILIKE '%Local%')
        OR (p_holder_type = 'EMPLOYEE' AND (c.holder_type::text ILIKE '%Employee%' OR c.holder_type::text ILIKE '%Staff%'))
        OR (p_holder_type = 'MUTUAL_FUND' AND c.holder_type::text ILIKE '%Mutual Fund%')
        OR (p_holder_type = 'TAX_EXEMPT' AND (c.payee_classification = 'TAX_EXEMPT' OR c.holder_type::text ILIKE '%Tax Exempt%'))
        OR (p_holder_type = 'FOREIGN' AND c.holder_type::text ILIKE '%Foreign%')
        OR (c.holder_type::text = p_holder_type)
      )
      AND (p_classification = 'all' OR c.payee_classification = p_classification)
      AND (p_status = 'all' OR c.status::text = p_status)
      AND (p_verification = 'all' OR c.verification_status::text = p_verification)
      AND (
        v_search_pattern = ''
        OR c.full_name ILIKE v_search_pattern
        OR c.boid ILIKE v_search_pattern
        OR c.client_code ILIKE v_search_pattern
        OR c.pan_or_citizenship ILIKE v_search_pattern
        OR c.bank_account_no ILIKE v_search_pattern
      )
  ),
  counted AS (
    SELECT COUNT(*) AS total_rows FROM matching_clients
  )
  SELECT 
    mc.id,
    mc.client_code,
    mc.client_id,
    mc.company_id,
    mc.full_name,
    mc.father_name,
    mc.grandfather_name,
    mc.date_of_birth,
    mc.gender,
    mc.occupation,
    mc.boid,
    mc.kitta,
    mc.holder_type,
    mc.payee_classification,
    mc.pan_no,
    mc.citizenship_no,
    mc.pan_or_citizenship,
    mc.nid_number,
    mc.address,
    mc.province,
    mc.district,
    mc.municipality,
    mc.phone,
    mc.email,
    mc.bank_name,
    mc.bank_branch,
    mc.bank_account_no,
    mc.account_type,
    mc.residency,
    mc.verification_status,
    mc.status,
    mc.created_at,
    mc.company_name,
    mc.company_code,
    COALESCE(cnt.total_rows, 0) AS total_count
  FROM matching_clients mc
  LEFT JOIN counted cnt ON true
  ORDER BY mc.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_clients_paginated(uuid, text, text, text, text, text, int, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_clients_paginated(uuid, text, text, text, text, text, int, int) TO authenticated, service_role;

-- get_company_fiscal_summary_rpc
CREATE OR REPLACE FUNCTION public.get_company_fiscal_summary_rpc(
  p_fiscal_year text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  IF (SELECT auth.uid()) IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  WITH div_summary AS (
    SELECT
      dp.company_id,
      dp.fiscal_year,
      COUNT(*) AS dividend_count,
      COALESCE(SUM(dp.gross_dividend), 0) AS dividend_gross,
      COALESCE(SUM(dp.net_payable), 0) AS dividend_net,
      COALESCE(SUM(dp.net_payable) FILTER (WHERE LOWER(dp.payment_status) = 'paid'), 0) AS dividend_paid,
      COALESCE(SUM(dp.net_payable) FILTER (WHERE LOWER(dp.payment_status) = 'partial'), 0) AS dividend_partial,
      COALESCE(SUM(dp.net_payable) FILTER (WHERE LOWER(COALESCE(dp.payment_status, 'pending')) NOT IN ('paid', 'partial')), 0) AS dividend_pending
    FROM public.dividend_payables dp
    WHERE (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR dp.fiscal_year = p_fiscal_year)
      AND (current_user = 'service_role' OR public.has_company_access(auth.uid(), dp.company_id))
    GROUP BY dp.company_id, dp.fiscal_year
  ),
  int_summary AS (
    SELECT
      ip.company_id,
      ip.fiscal_year,
      COUNT(*) AS interest_count,
      COALESCE(SUM(ip.gross_interest), 0) AS interest_gross,
      COALESCE(SUM(ip.net_payable), 0) AS interest_net,
      COALESCE(SUM(ip.net_payable) FILTER (WHERE LOWER(ip.payment_status) = 'paid'), 0) AS interest_paid,
      COALESCE(SUM(ip.net_payable) FILTER (WHERE LOWER(ip.payment_status) = 'partial'), 0) AS interest_partial,
      COALESCE(SUM(ip.net_payable) FILTER (WHERE LOWER(COALESCE(ip.payment_status, 'pending')) NOT IN ('paid', 'partial')), 0) AS interest_pending
    FROM public.interest_payables ip
    WHERE (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR ip.fiscal_year = p_fiscal_year)
      AND (current_user = 'service_role' OR public.has_company_access(auth.uid(), ip.company_id))
    GROUP BY ip.company_id, ip.fiscal_year
  ),
  mf_summary AS (
    SELECT
      mp.company_id,
      mp.fiscal_year,
      COUNT(*) AS mutual_fund_count,
      COALESCE(SUM(mp.gross_dividend), 0) AS mutual_fund_gross,
      COALESCE(SUM(mp.net_payable), 0) AS mutual_fund_net,
      COALESCE(SUM(mp.net_payable) FILTER (WHERE LOWER(mp.payment_status) = 'paid'), 0) AS mutual_fund_paid,
      COALESCE(SUM(mp.net_payable) FILTER (WHERE LOWER(mp.payment_status) = 'partial'), 0) AS mutual_fund_partial,
      COALESCE(SUM(mp.net_payable) FILTER (WHERE LOWER(COALESCE(mp.payment_status, 'pending')) NOT IN ('paid', 'partial')), 0) AS mutual_fund_pending
    FROM public.mutual_fund_payables mp
    WHERE (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR mp.fiscal_year = p_fiscal_year)
      AND (current_user = 'service_role' OR public.has_company_access(auth.uid(), mp.company_id))
    GROUP BY mp.company_id, mp.fiscal_year
  ),
  all_pairs AS (
    SELECT company_id, fiscal_year FROM div_summary
    UNION
    SELECT company_id, fiscal_year FROM int_summary
    UNION
    SELECT company_id, fiscal_year FROM mf_summary
  )
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'company_id', ap.company_id,
        'company_name', COALESCE(c.company_name, 'Unknown Company'),
        'company_code', COALESCE(c.company_code, 'N/A'),
        'fiscal_year', ap.fiscal_year,
        'dividend_count', COALESCE(ds.dividend_count, 0),
        'dividend_gross', ROUND(COALESCE(ds.dividend_gross, 0)::numeric, 2),
        'dividend_net', ROUND(COALESCE(ds.dividend_net, 0)::numeric, 2),
        'dividend_paid', ROUND(COALESCE(ds.dividend_paid, 0)::numeric, 2),
        'dividend_pending', ROUND(COALESCE(ds.dividend_pending, 0)::numeric, 2),
        'dividend_partial', ROUND(COALESCE(ds.dividend_partial, 0)::numeric, 2),
        'interest_count', COALESCE(is_data.interest_count, 0),
        'interest_gross', ROUND(COALESCE(is_data.interest_gross, 0)::numeric, 2),
        'interest_net', ROUND(COALESCE(is_data.interest_net, 0)::numeric, 2),
        'interest_paid', ROUND(COALESCE(is_data.interest_paid, 0)::numeric, 2),
        'interest_pending', ROUND(COALESCE(is_data.interest_pending, 0)::numeric, 2),
        'interest_partial', ROUND(COALESCE(is_data.interest_partial, 0)::numeric, 2),
        'mutual_fund_count', COALESCE(ms.mutual_fund_count, 0),
        'mutual_fund_gross', ROUND(COALESCE(ms.mutual_fund_gross, 0)::numeric, 2),
        'mutual_fund_net', ROUND(COALESCE(ms.mutual_fund_net, 0)::numeric, 2),
        'mutual_fund_paid', ROUND(COALESCE(ms.mutual_fund_paid, 0)::numeric, 2),
        'mutual_fund_pending', ROUND(COALESCE(ms.mutual_fund_pending, 0)::numeric, 2),
        'mutual_fund_partial', ROUND(COALESCE(ms.mutual_fund_partial, 0)::numeric, 2),
        'total_paid', ROUND((COALESCE(ds.dividend_paid, 0) + COALESCE(is_data.interest_paid, 0) + COALESCE(ms.mutual_fund_paid, 0))::numeric, 2),
        'total_pending', ROUND((COALESCE(ds.dividend_pending, 0) + COALESCE(is_data.interest_pending, 0) + COALESCE(ms.mutual_fund_pending, 0))::numeric, 2)
      )
      ORDER BY c.company_name ASC, ap.fiscal_year DESC
    ),
    '[]'::json
  )
  INTO v_result
  FROM all_pairs ap
  JOIN public.companies c ON c.id = ap.company_id
  LEFT JOIN div_summary ds ON ds.company_id = ap.company_id AND ds.fiscal_year = ap.fiscal_year
  LEFT JOIN int_summary is_data ON is_data.company_id = ap.company_id AND is_data.fiscal_year = ap.fiscal_year
  LEFT JOIN mf_summary ms ON ms.company_id = ap.company_id AND ms.fiscal_year = ap.fiscal_year;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_fiscal_summary_rpc(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_company_fiscal_summary_rpc(text) TO authenticated, service_role;
