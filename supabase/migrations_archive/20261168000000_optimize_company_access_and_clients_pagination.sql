-- Migration: Optimize company access, clients pagination, stats aggregation, and RLS performance
-- Eliminates row-by-row function overhead causing statement timeouts when querying all companies.

-- 1. Optimize has_company_access function with SQL language and index-backed checks
CREATE OR REPLACE FUNCTION public.has_company_access(
  _user_id uuid,
  _company_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    CASE 
      WHEN _user_id IS NULL OR _company_id IS NULL THEN FALSE
      WHEN EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = _user_id 
          AND role IN ('admin'::public.app_role, 'supervisor'::public.app_role)
      ) THEN TRUE
      ELSE EXISTS (
        SELECT 1 FROM public.user_company_access 
        WHERE user_id = _user_id 
          AND company_id = _company_id
      )
    END;
$$;

REVOKE ALL ON FUNCTION public.has_company_access(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_company_access(uuid, uuid) TO authenticated, service_role;

-- 2. Add high-performance B-tree ordering indexes
CREATE INDEX IF NOT EXISTS idx_clients_created_at ON public.clients (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clients_company_created_at ON public.clients (company_id, created_at DESC);

-- 3. Optimize clients_read RLS policy to short-circuit for admin and supervisor
DROP POLICY IF EXISTS "clients_read" ON public.clients;
CREATE POLICY "clients_read" ON public.clients
  FOR SELECT
  TO authenticated
  USING (
    company_id IS NULL
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role])
    OR public.has_company_access(auth.uid(), company_id)
  );

-- 4. Fast get_company_client_stats
CREATE OR REPLACE FUNCTION public.get_company_client_stats(p_company_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_is_global_access boolean := false;
  v_user_companies uuid[];
  v_total bigint := 0;
  v_verified bigint := 0;
  v_pending bigint := 0;
  v_natural bigint := 0;
  v_institutions bigint := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  -- Resolve company authorization once for the entire query
  IF current_user = 'service_role' OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_uid
      AND role IN ('admin'::public.app_role, 'supervisor'::public.app_role)
  ) THEN
    v_is_global_access := true;
  ELSE
    SELECT COALESCE(array_agg(company_id), '{}')
    INTO v_user_companies
    FROM public.user_company_access
    WHERE user_id = v_uid;
  END IF;

  IF p_company_id IS NOT NULL AND NOT v_is_global_access THEN
    IF NOT (p_company_id = ANY(v_user_companies)) THEN
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
          p_company_id IS NULL AND (
            v_is_global_access 
            OR c.company_id IS NULL 
            OR c.company_id = ANY(v_user_companies)
          )
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

-- 5. Fast get_clients_paginated
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
  v_uid uuid;
  v_is_global_access boolean := false;
  v_user_companies uuid[];
  v_search_pattern text := '';
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  -- Resolve company authorization once for the entire query
  IF current_user = 'service_role' OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_uid
      AND role IN ('admin'::public.app_role, 'supervisor'::public.app_role)
  ) THEN
    v_is_global_access := true;
  ELSE
    SELECT COALESCE(array_agg(company_id), '{}')
    INTO v_user_companies
    FROM public.user_company_access
    WHERE user_id = v_uid;
  END IF;

  IF p_company_id IS NOT NULL AND NOT v_is_global_access THEN
    IF NOT (p_company_id = ANY(v_user_companies)) THEN
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
          p_company_id IS NULL AND (
            v_is_global_access 
            OR c.company_id IS NULL 
            OR c.company_id = ANY(v_user_companies)
          )
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

-- 6. Fast get_company_fiscal_summary_rpc
CREATE OR REPLACE FUNCTION public.get_company_fiscal_summary_rpc(p_fiscal_year text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_is_global_access boolean := false;
  v_user_companies uuid[];
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  -- Resolve company authorization once
  IF current_user = 'service_role' OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_uid
      AND role IN ('admin'::public.app_role, 'supervisor'::public.app_role)
  ) THEN
    v_is_global_access := true;
  ELSE
    SELECT COALESCE(array_agg(company_id), '{}')
    INTO v_user_companies
    FROM public.user_company_access
    WHERE user_id = v_uid;
  END IF;

  RETURN (
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
        AND (v_is_global_access OR dp.company_id = ANY(v_user_companies))
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
        AND (v_is_global_access OR ip.company_id = ANY(v_user_companies))
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
        AND (v_is_global_access OR mp.company_id = ANY(v_user_companies))
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
          'dividend_partial', ROUND(COALESCE(ds.dividend_partial, 0)::numeric, 2),
          'dividend_pending', ROUND(COALESCE(ds.dividend_pending, 0)::numeric, 2),
          'interest_count', COALESCE(isum.interest_count, 0),
          'interest_gross', ROUND(COALESCE(isum.interest_gross, 0)::numeric, 2),
          'interest_net', ROUND(COALESCE(isum.interest_net, 0)::numeric, 2),
          'interest_paid', ROUND(COALESCE(isum.interest_paid, 0)::numeric, 2),
          'interest_partial', ROUND(COALESCE(isum.interest_partial, 0)::numeric, 2),
          'interest_pending', ROUND(COALESCE(isum.interest_pending, 0)::numeric, 2),
          'mutual_fund_count', COALESCE(ms.mutual_fund_count, 0),
          'mutual_fund_gross', ROUND(COALESCE(ms.mutual_fund_gross, 0)::numeric, 2),
          'mutual_fund_net', ROUND(COALESCE(ms.mutual_fund_net, 0)::numeric, 2),
          'mutual_fund_paid', ROUND(COALESCE(ms.mutual_fund_paid, 0)::numeric, 2),
          'mutual_fund_partial', ROUND(COALESCE(ms.mutual_fund_partial, 0)::numeric, 2),
          'mutual_fund_pending', ROUND(COALESCE(ms.mutual_fund_pending, 0)::numeric, 2)
        )
      ),
      '[]'::json
    )
    FROM all_pairs ap
    JOIN public.companies c ON ap.company_id = c.id
    LEFT JOIN div_summary ds ON ap.company_id = ds.company_id AND ap.fiscal_year = ds.fiscal_year
    LEFT JOIN int_summary isum ON ap.company_id = isum.company_id AND ap.fiscal_year = isum.fiscal_year
    LEFT JOIN mf_summary ms ON ap.company_id = ms.company_id AND ap.fiscal_year = ms.fiscal_year
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_fiscal_summary_rpc(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_company_fiscal_summary_rpc(text) TO authenticated, service_role;
