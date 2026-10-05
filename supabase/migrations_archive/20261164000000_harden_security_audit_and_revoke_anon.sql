-- ============================================================================
-- Migration: 20261164000000_harden_security_audit_and_revoke_anon.sql
-- Description:
-- 1. Revoke anon/public execution on sensitive client RPCs (Issue 1 & 12)
-- 2. Restrict upload_history and upload_errors RLS to owners & admins (Issue 3)
-- 3. Add financial balance and upper-bound invariants to payables (Issue 5)
-- ============================================================================

-- 1. Revoke anonymous & public execution from sensitive client data RPCs
REVOKE EXECUTE ON FUNCTION public.get_clients_paginated(uuid, text, text, text, text, text, int, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_clients_paginated(uuid, text, text, text, text, text, int, int) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_company_client_stats(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_company_client_stats(uuid) TO authenticated, service_role;

-- Update get_clients_paginated with caller authentication guard
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
  -- Authenticate caller: only authenticated users or internal service_role
  IF (SELECT auth.uid()) IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
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

-- 2. Restrict upload_history and upload_errors RLS
CREATE OR REPLACE FUNCTION public.set_upload_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS uh_write ON public.upload_history;
CREATE POLICY uh_write ON public.upload_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() 
    OR user_id IS NULL 
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'finance_operator'::app_role])
  );

DROP POLICY IF EXISTS uh_read ON public.upload_history;
CREATE POLICY uh_read ON public.upload_history
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR user_id IS NULL
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'finance_operator'::app_role])
  );

DROP POLICY IF EXISTS ue_read ON public.upload_errors;
CREATE POLICY ue_read ON public.upload_errors
  FOR SELECT
  TO authenticated
  USING (
    upload_id IN (
      SELECT id FROM public.upload_history
      WHERE user_id = auth.uid() OR user_id IS NULL
    )
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'finance_operator'::app_role])
  );

-- 3. Financial consistency and balance invariants on payables
DO $$ BEGIN
  ALTER TABLE public.dividend_payables
    DROP CONSTRAINT IF EXISTS chk_div_tax_le_gross,
    ADD CONSTRAINT chk_div_tax_le_gross CHECK (tax_amount <= gross_dividend + 0.05),
    DROP CONSTRAINT IF EXISTS chk_div_net_le_gross,
    ADD CONSTRAINT chk_div_net_le_gross CHECK (net_payable <= gross_dividend + 0.05),
    DROP CONSTRAINT IF EXISTS chk_div_balance_invariant,
    ADD CONSTRAINT chk_div_balance_invariant CHECK (abs((gross_dividend - tax_amount) - net_payable) <= 0.05);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.interest_payables
    DROP CONSTRAINT IF EXISTS chk_int_tax_le_gross,
    ADD CONSTRAINT chk_int_tax_le_gross CHECK (tax_amount <= gross_interest + 0.05),
    DROP CONSTRAINT IF EXISTS chk_int_net_le_gross,
    ADD CONSTRAINT chk_int_net_le_gross CHECK (net_payable <= gross_interest + 0.05),
    DROP CONSTRAINT IF EXISTS chk_int_balance_invariant,
    ADD CONSTRAINT chk_int_balance_invariant CHECK (abs((gross_interest - tax_amount) - net_payable) <= 0.05);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.mutual_fund_payables
    DROP CONSTRAINT IF EXISTS chk_mf_tax_le_gross,
    ADD CONSTRAINT chk_mf_tax_le_gross CHECK (tax_amount <= gross_dividend + 0.05),
    DROP CONSTRAINT IF EXISTS chk_mf_net_le_gross,
    ADD CONSTRAINT chk_mf_net_le_gross CHECK (net_payable <= gross_dividend + 0.05),
    DROP CONSTRAINT IF EXISTS chk_mf_balance_invariant,
    ADD CONSTRAINT chk_mf_balance_invariant CHECK (abs((gross_dividend - tax_amount) - net_payable) <= 0.05);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
