-- Strict Company Isolation & Unified Category Filtering for Clients
-- Fixes cross-company data leakage and ensures clean category filtering across both holder_type and payee_classification.

DROP FUNCTION IF EXISTS public.get_clients_paginated(uuid, text, text, text, text, text, int, int);

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
) LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_search_pattern text := '';
BEGIN
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
      (p_company_id IS NULL OR c.company_id = p_company_id)
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
        OR (
          p_holder_type = 'PROMOTER' AND (
            c.holder_type::text ILIKE '%Promoter%'
          )
        )
        OR (
          p_holder_type = 'LOCAL' AND (
            c.holder_type::text ILIKE '%Local%'
          )
        )
        OR (
          p_holder_type = 'EMPLOYEE' AND (
            c.holder_type::text ILIKE '%Employee%' OR c.holder_type::text ILIKE '%Staff%'
          )
        )
        OR (
          p_holder_type = 'MUTUAL_FUND' AND (
            c.holder_type::text ILIKE '%Mutual Fund%'
          )
        )
        OR (
          p_holder_type = 'TAX_EXEMPT' AND (
            c.payee_classification = 'TAX_EXEMPT'
            OR c.holder_type::text ILIKE '%Tax Exempt%'
          )
        )
        OR (
          p_holder_type = 'FOREIGN' AND (
            c.holder_type::text ILIKE '%Foreign%'
          )
        )
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

GRANT EXECUTE ON FUNCTION public.get_clients_paginated(uuid, text, text, text, text, text, int, int) TO authenticated, anon, service_role;

-- Update get_company_client_stats for strict company isolation & unified category calculation
CREATE OR REPLACE FUNCTION public.get_company_client_stats(p_company_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total bigint := 0;
  v_verified bigint := 0;
  v_pending bigint := 0;
  v_natural bigint := 0;
  v_institutions bigint := 0;
BEGIN
  WITH target_clients AS (
    SELECT 
      c.id, 
      c.verification_status, 
      c.payee_classification,
      c.holder_type
    FROM public.clients c
    WHERE 
      p_company_id IS NULL 
      OR c.company_id = p_company_id
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

GRANT EXECUTE ON FUNCTION public.get_company_client_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_client_stats(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_company_client_stats(uuid) TO service_role;
