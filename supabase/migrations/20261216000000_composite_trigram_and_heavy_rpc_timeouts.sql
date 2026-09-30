-- ============================================================================
-- Migration: 20261216000000_composite_trigram_and_heavy_rpc_timeouts.sql
-- Description:
-- 1. Creates composite GIN trigram index on clients table across
--    (full_name, boid, client_code, pan_or_citizenship, bank_account_no).
-- 2. Updates get_clients_paginated to query the composite expression,
--    enabling single-index bitmap scans instead of sequential scans.
-- 3. Hardens heavy batch & reconciliation RPCs with 60s statement_timeout
--    to prevent timeout cancellations during bulk operations.
-- 4. Creates composite index on payments (company_id, status).
-- ============================================================================

-- 1. Composite GIN Trigram Index on clients
CREATE INDEX IF NOT EXISTS idx_clients_trgm_composite_search
  ON public.clients USING gin (
    (
      COALESCE(full_name, '') || ' ' ||
      COALESCE(boid, '') || ' ' ||
      COALESCE(client_code, '') || ' ' ||
      COALESCE(pan_or_citizenship, '') || ' ' ||
      COALESCE(bank_account_no, '')
    ) gin_trgm_ops
  );

-- 2. Composite index on payments for scoped batch/status filtering
CREATE INDEX IF NOT EXISTS idx_payments_company_status
  ON public.payments (company_id, status);

-- 3. Update get_clients_paginated to leverage composite GIN trigram index
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
  total_count bigint
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid;
  v_is_global_access boolean := false;
  v_user_companies uuid[];
  v_search_pattern text := '';
BEGIN
  -- Prevent premature statement timeout during heavy searches
  PERFORM set_config('statement_timeout', '30s', true);

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
      COALESCE(c.needs_review, false) AS needs_review,
      c.data_quality_notes
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
    pc.kitta,
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
    comp.company_name,
    comp.company_code,
    pc.needs_review,
    pc.data_quality_notes,
    COALESCE(cnt.total_rows, 0) AS total_count
  FROM paginated_clients pc
  LEFT JOIN public.companies comp ON pc.company_id = comp.id
  CROSS JOIN counted cnt
  ORDER BY pc.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_clients_paginated TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_clients_paginated TO service_role;

-- 4. Set statement_timeout = '60s' on all heavy batch, payment, and reconciliation RPCs
ALTER FUNCTION public.bulk_insert_clients(jsonb) SET statement_timeout = '60s';
ALTER FUNCTION public.bulk_insert_dividend_payables(jsonb) SET statement_timeout = '60s';
ALTER FUNCTION public.bulk_insert_interest_payables(jsonb) SET statement_timeout = '60s';
ALTER FUNCTION public.bulk_insert_mutual_fund_payables(jsonb) SET statement_timeout = '60s';
ALTER FUNCTION public.complete_payment_batch_atomic(uuid, uuid) SET statement_timeout = '60s';
ALTER FUNCTION public.revert_payment_batch_atomic(uuid, uuid) SET statement_timeout = '60s';
ALTER FUNCTION public.revert_payment_batch_atomic(uuid, uuid, text) SET statement_timeout = '60s';
ALTER FUNCTION public.apply_reconciliation_batch(jsonb, jsonb) SET statement_timeout = '60s';
ALTER FUNCTION public.get_company_payable_summary(uuid) SET statement_timeout = '60s';
