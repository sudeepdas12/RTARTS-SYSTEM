-- Migration: 20261224000000_optimize_company_client_lookups_and_stats.sql
-- Description:
-- 1. Creates composite indexes (company_id, client_id) on payables tables.
-- 2. Creates company_client_map materialized view with unique and foreign indexes for instant multi-company resolution.
-- 3. Provides refresh_company_client_map() helper RPC for automatic/manual refresh.
-- 4. Optimizes get_company_client_stats to use company_client_map with instant single-aggregation query.
-- 5. Optimizes get_clients_paginated to eliminate correlated EXISTS subqueries across 55k+ rows.
-- 6. Sets robust statement_timeout safeguards.

BEGIN;

-- 1. Composite indexes on payables
CREATE INDEX IF NOT EXISTS idx_mf_payables_comp_client 
  ON public.mutual_fund_payables (company_id, client_id);

CREATE INDEX IF NOT EXISTS idx_div_payables_comp_client 
  ON public.dividend_payables (company_id, client_id);

CREATE INDEX IF NOT EXISTS idx_int_payables_comp_client 
  ON public.interest_payables (company_id, client_id);

-- 2. Materialized view for instant company-to-client mapping
CREATE MATERIALIZED VIEW IF NOT EXISTS public.company_client_map AS
SELECT DISTINCT company_id, id AS client_id 
FROM public.clients 
WHERE company_id IS NOT NULL
UNION
SELECT DISTINCT company_id, client_id 
FROM public.mutual_fund_payables 
WHERE company_id IS NOT NULL AND client_id IS NOT NULL
UNION
SELECT DISTINCT company_id, client_id 
FROM public.dividend_payables 
WHERE company_id IS NOT NULL AND client_id IS NOT NULL
UNION
SELECT DISTINCT company_id, client_id 
FROM public.interest_payables 
WHERE company_id IS NOT NULL AND client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_client_map_comp_client 
  ON public.company_client_map (company_id, client_id);

CREATE INDEX IF NOT EXISTS idx_company_client_map_client 
  ON public.company_client_map (client_id);

-- 3. Refresh helper RPC
CREATE OR REPLACE FUNCTION public.refresh_company_client_map()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_client_map;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_company_client_map() TO authenticated, service_role;

-- 4. Fast get_company_client_stats RPC
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
  v_needs_review bigint := 0;
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);

  v_uid := auth.uid();
  IF v_uid IS NULL AND current_user != 'service_role' AND current_user != 'postgres' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  IF current_user IN ('service_role', 'postgres') OR EXISTS (
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

  WITH allowed_client_ids AS (
    SELECT client_id 
    FROM public.company_client_map 
    WHERE p_company_id IS NOT NULL AND company_id = p_company_id
    UNION
    SELECT c_sub.id AS client_id 
    FROM public.clients c_sub 
    WHERE p_company_id IS NOT NULL AND c_sub.company_id = p_company_id
  ),
  target_clients AS (
    SELECT 
      c.id, 
      c.verification_status, 
      c.payee_classification,
      c.holder_type,
      COALESCE(c.needs_review, false) AS needs_review
    FROM public.clients c
    WHERE 
      (
        (p_company_id IS NOT NULL AND c.id IN (SELECT client_id FROM allowed_client_ids))
        OR (
          p_company_id IS NULL AND (
            v_is_global_access 
            OR c.company_id IS NULL 
            OR c.company_id = ANY(v_user_companies)
            OR EXISTS (SELECT 1 FROM public.company_client_map m WHERE m.company_id = ANY(v_user_companies) AND m.client_id = c.id)
          )
        )
      )
  )
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE verification_status = 'Verified'),
    COUNT(*) FILTER (WHERE verification_status = 'Pending'),
    COUNT(*) FILTER (WHERE 
      (payee_classification = 'NATURAL_PERSON' AND (holder_type IS NULL OR holder_type::text ILIKE '%Public%' OR holder_type::text ILIKE '%Natural%')) 
      OR holder_type::text = 'Natural Person - Public' 
      OR (holder_type::text = 'Public' AND payee_classification != 'COMPANY_INSTITUTION')
    ),
    COUNT(*) FILTER (WHERE 
      payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') 
      OR holder_type::text ILIKE '%Institution%' 
      OR holder_type::text ILIKE '%Legal Person%'
    ),
    COUNT(*) FILTER (WHERE needs_review = true)
  INTO v_total, v_verified, v_pending, v_natural, v_institutions, v_needs_review
  FROM target_clients;

  RETURN json_build_object(
    'total', COALESCE(v_total, 0),
    'verified', COALESCE(v_verified, 0),
    'pending', COALESCE(v_pending, 0),
    'natural', COALESCE(v_natural, 0),
    'institutions', COALESCE(v_institutions, 0),
    'needs_review', COALESCE(v_needs_review, 0)
  );
END;
$$;

ALTER FUNCTION public.get_company_client_stats(uuid) SET statement_timeout = '60s';
REVOKE ALL ON FUNCTION public.get_company_client_stats(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_company_client_stats(uuid) TO authenticated, service_role;

-- 5. Optimized get_clients_paginated RPC
DROP FUNCTION IF EXISTS public.get_clients_paginated(uuid, text, text, text, text, text, int, int, text);
DROP FUNCTION IF EXISTS public.get_clients_paginated(uuid, text, text, text, text, text, int, int);
DROP FUNCTION IF EXISTS public.get_clients_paginated;

CREATE OR REPLACE FUNCTION public.get_clients_paginated(
  p_company_id uuid DEFAULT NULL,
  p_holder_type text DEFAULT 'all',
  p_classification text DEFAULT 'all',
  p_status text DEFAULT 'all',
  p_verification text DEFAULT 'all',
  p_search text DEFAULT '',
  p_limit int DEFAULT 25,
  p_offset int DEFAULT 0,
  p_needs_review text DEFAULT 'all'
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
  needs_review boolean,
  data_quality_notes text,
  total_count bigint,
  company_details jsonb
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid;
  v_is_global_access boolean := false;
  v_user_companies uuid[];
  v_search_pattern text := '';
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);

  v_uid := auth.uid();
  IF v_uid IS NULL AND current_user != 'service_role' AND current_user != 'postgres' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  IF current_user IN ('service_role', 'postgres') OR EXISTS (
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
  WITH allowed_client_ids AS (
    SELECT client_id 
    FROM public.company_client_map 
    WHERE p_company_id IS NOT NULL AND company_id = p_company_id
    UNION
    SELECT c_sub.id AS client_id 
    FROM public.clients c_sub 
    WHERE p_company_id IS NOT NULL AND c_sub.company_id = p_company_id
  ),
  matching_clients AS (
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
      COALESCE(c.needs_review, false) AS needs_review,
      c.data_quality_notes
    FROM public.clients c
    WHERE 
      (
        (p_company_id IS NOT NULL AND c.id IN (SELECT client_id FROM allowed_client_ids))
        OR (
          p_company_id IS NULL AND (
            v_is_global_access 
            OR c.company_id IS NULL 
            OR c.company_id = ANY(v_user_companies)
            OR EXISTS (SELECT 1 FROM public.company_client_map m WHERE m.company_id = ANY(v_user_companies) AND m.client_id = c.id)
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
        p_needs_review = 'all'
        OR (p_needs_review = 'true' AND c.needs_review = true)
        OR (p_needs_review = 'false' AND (c.needs_review IS FALSE OR c.needs_review IS NULL))
      )
      AND (
        v_search_pattern = ''
        OR (
          COALESCE(c.full_name, '') || ' ' ||
          COALESCE(c.boid, '') || ' ' ||
          COALESCE(c.client_code, '') || ' ' ||
          COALESCE(c.pan_or_citizenship, '') || ' ' ||
          COALESCE(c.bank_account_no, '')
        ) ILIKE v_search_pattern
      )
  ),
  counted AS (
    SELECT COUNT(*) AS total_rows FROM matching_clients
  ),
  paginated_clients AS (
    SELECT mc.*
    FROM matching_clients mc
    ORDER BY mc.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ),
  pc_payable_holdings AS (
    SELECT mp.client_id, mp.company_id, comp.company_code, comp.company_name, COALESCE(mp.shares_held, 0) AS kitta
    FROM public.mutual_fund_payables mp
    JOIN public.companies comp ON mp.company_id = comp.id
    WHERE mp.client_id IN (SELECT pc_sub.id FROM paginated_clients pc_sub)
      AND (p_company_id IS NULL OR mp.company_id = p_company_id)
    UNION ALL
    SELECT dp.client_id, dp.company_id, comp.company_code, comp.company_name, COALESCE(dp.shares_held, 0) AS kitta
    FROM public.dividend_payables dp
    JOIN public.companies comp ON dp.company_id = comp.id
    WHERE dp.client_id IN (SELECT pc_sub.id FROM paginated_clients pc_sub)
      AND (p_company_id IS NULL OR dp.company_id = p_company_id)
    UNION ALL
    SELECT ip.client_id, ip.company_id, comp.company_code, comp.company_name, 0 AS kitta
    FROM public.interest_payables ip
    JOIN public.companies comp ON ip.company_id = comp.id
    WHERE ip.client_id IN (SELECT pc_sub.id FROM paginated_clients pc_sub)
      AND (p_company_id IS NULL OR ip.company_id = p_company_id)
  ),
  pc_holdings AS (
    SELECT * FROM pc_payable_holdings
    UNION ALL
    SELECT pc_sub.id AS client_id, pc_sub.company_id, comp.company_code, comp.company_name, COALESCE(pc_sub.kitta, 0) AS kitta
    FROM paginated_clients pc_sub
    JOIN public.companies comp ON pc_sub.company_id = comp.id
    WHERE (p_company_id IS NULL OR pc_sub.company_id = p_company_id)
      AND pc_sub.id NOT IN (SELECT ph_sub.client_id FROM pc_payable_holdings ph_sub)
  ),
  aggregated_holdings AS (
    SELECT 
      pch.client_id,
      string_agg(DISTINCT pch.company_code, ', ' ORDER BY pch.company_code) AS agg_company_codes,
      string_agg(DISTINCT pch.company_name, ', ' ORDER BY pch.company_name) AS agg_company_names,
      SUM(pch.kitta) AS agg_total_kitta,
      jsonb_agg(
        DISTINCT jsonb_build_object(
          'company_id', pch.company_id,
          'company_code', pch.company_code,
          'company_name', pch.company_name,
          'kitta', pch.kitta
        )
      ) AS agg_company_details
    FROM pc_holdings pch
    GROUP BY pch.client_id
  )
  SELECT 
    pc.id,
    pc.client_code,
    pc.client_id,
    pc.company_id,
    pc.full_name,
    pc.father_name,
    pc.grandfather_name,
    pc.date_of_birth,
    pc.gender,
    pc.occupation,
    pc.boid,
    COALESCE(ah.agg_total_kitta, pc.kitta, 0) AS kitta,
    pc.holder_type,
    pc.payee_classification,
    pc.pan_no,
    pc.citizenship_no,
    pc.pan_or_citizenship,
    pc.nid_number,
    pc.address,
    pc.province,
    pc.district,
    pc.municipality,
    pc.phone,
    pc.email,
    pc.bank_name,
    pc.bank_branch,
    pc.bank_account_no,
    pc.account_type,
    pc.residency,
    pc.verification_status,
    pc.status,
    pc.created_at,
    COALESCE(ah.agg_company_names, comp.company_name) AS company_name,
    COALESCE(ah.agg_company_codes, comp.company_code) AS company_code,
    pc.needs_review,
    pc.data_quality_notes,
    COALESCE(cnt.total_rows, 0) AS total_count,
    ah.agg_company_details AS company_details
  FROM paginated_clients pc
  LEFT JOIN aggregated_holdings ah ON pc.id = ah.client_id
  LEFT JOIN public.companies comp ON pc.company_id = comp.id
  CROSS JOIN counted cnt
  ORDER BY pc.created_at DESC;
END;
$$;

ALTER FUNCTION public.get_clients_paginated(uuid, text, text, text, text, text, int, int, text) SET statement_timeout = '60s';

REVOKE ALL ON FUNCTION public.get_clients_paginated(uuid, text, text, text, text, text, int, int, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_clients_paginated(uuid, text, text, text, text, text, int, int, text) TO authenticated, service_role;

COMMIT;
