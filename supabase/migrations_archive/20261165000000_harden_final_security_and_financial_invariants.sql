-- ============================================================================
-- Migration: 20261165000000_harden_final_security_and_financial_invariants.sql
-- Description:
-- 1. Complete revocation of anon/public privileges on all sensitive RPCs (Issue 3)
-- 2. Lockdown of AGM tables RLS to prevent unrestricted modifications (Issue 7)
-- 3. Fix mutable search paths on all flagged stored functions (Issue 8)
-- 4. Transactional duplicate file hash unique constraint (Issue 9)
-- 5. Comprehensive financial and quantity bounds database constraints (Issue 6)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Complete Revocation of Anonymous Access from Sensitive Functions & RPCs
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_company_client_ids(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_company_client_ids(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_company_client_stats(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_company_client_stats(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_clients_paginated(uuid, text, text, text, text, text, int, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_clients_paginated(uuid, text, text, text, text, text, int, int) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_company_fiscal_summary_rpc(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_company_fiscal_summary_rpc(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.bulk_insert_clients(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.bulk_insert_clients(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.bulk_insert_dividend_payables(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.bulk_insert_dividend_payables(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.bulk_insert_interest_payables(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.bulk_insert_interest_payables(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.bulk_insert_mutual_fund_payables(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.bulk_insert_mutual_fund_payables(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.complete_payment_batch_atomic(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.complete_payment_batch_atomic(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_agm_summary_stats() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_agm_summary_stats() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Fix Mutable Search Paths on Functions (SET search_path = public)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_company_client_ids(p_company_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.clients WHERE company_id = p_company_id
  UNION
  SELECT client_id FROM public.dividend_payables WHERE company_id = p_company_id AND client_id IS NOT NULL
  UNION
  SELECT client_id FROM public.interest_payables WHERE company_id = p_company_id AND client_id IS NOT NULL
  UNION
  SELECT client_id FROM public.mutual_fund_payables WHERE company_id = p_company_id AND client_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.mask_smtp_secrets(j jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN j IS NULL THEN NULL ELSE j - 'smtp_pass' END;
$$;

CREATE OR REPLACE FUNCTION public.calc_net_dividend()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.gross_dividend IS NULL OR NEW.gross_dividend = 0 THEN
    NEW.gross_dividend = COALESCE(NEW.shares_held, 0) * COALESCE(NEW.dividend_rate, 0);
  END IF;
  NEW.net_payable = COALESCE(NEW.gross_dividend, 0) - COALESCE(NEW.tax_amount, 0);
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_payable_classification_and_tax()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  client_rec record;
  gross numeric := 0;
  payable_kind text := 'DIVIDEND';
BEGIN
  IF TG_TABLE_NAME = 'interest_payables' THEN
    payable_kind := 'INTEREST';
  ELSIF TG_TABLE_NAME = 'mutual_fund_payables' THEN
    payable_kind := 'MUTUAL_FUND';
  ELSE
    payable_kind := 'DIVIDEND';
  END IF;

  -- 1. Inherit verified classification from client if available
  IF NEW.client_id IS NOT NULL THEN
    SELECT payee_classification, payee_segment, holder_type
    INTO client_rec
    FROM public.clients
    WHERE id = NEW.client_id;

    IF client_rec.payee_classification IS NOT NULL AND client_rec.payee_classification != 'UNCLASSIFIED' THEN
      NEW.payee_classification := client_rec.payee_classification;
    END IF;

    IF NEW.payee_segment IS NULL AND client_rec.payee_segment IS NOT NULL THEN
      NEW.payee_segment := client_rec.payee_segment;
    END IF;

    IF NEW.holder_type IS NULL AND client_rec.holder_type IS NOT NULL THEN
      NEW.holder_type := client_rec.holder_type;
    END IF;
  END IF;

  -- 2. Fallback classification logic
  IF NEW.payee_classification IS NULL OR NEW.payee_classification = 'UNCLASSIFIED' THEN
    IF NEW.holder_type::text ILIKE '%Mutual Fund%' OR NEW.holder_type::text ILIKE '%Tax Exempt%' THEN
      NEW.payee_classification := 'TAX_EXEMPT';
    ELSIF NEW.holder_type::text ILIKE '%Institution%' OR NEW.holder_type::text ILIKE '%Legal Person%' THEN
      NEW.payee_classification := 'COMPANY_INSTITUTION';
    ELSIF NEW.holder_type IS NOT NULL THEN
      NEW.payee_classification := 'NATURAL_PERSON';
    ELSE
      NEW.payee_classification := 'UNCLASSIFIED';
    END IF;
  END IF;

  -- 3. Calculate statutory TDS
  IF TG_TABLE_NAME = 'interest_payables' THEN
    gross := COALESCE(NEW.gross_interest, 0);
    IF NEW.tds_rate IS NULL THEN
      IF NEW.payee_classification = 'TAX_EXEMPT' THEN
        NEW.tds_rate := 0.0;
      ELSIF NEW.payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR NEW.holder_type::text ILIKE '%Foreign%' THEN
        NEW.tds_rate := 0.15;
      ELSE
        NEW.tds_rate := 0.06;
      END IF;
    END IF;
    NEW.tax_amount := round(gross * NEW.tds_rate, 2);
    NEW.net_payable := gross - NEW.tax_amount;
  ELSE
    gross := COALESCE(NEW.gross_dividend, 0);
    IF NEW.tds_rate IS NULL THEN
      IF NEW.payee_classification = 'TAX_EXEMPT' THEN
        NEW.tds_rate := 0.0;
      ELSIF TG_TABLE_NAME = 'mutual_fund_payables' AND NEW.payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') THEN
        NEW.tds_rate := 0.15;
      ELSE
        NEW.tds_rate := 0.05;
      END IF;
    END IF;
    NEW.tax_amount := round(gross * NEW.tds_rate, 2);
    NEW.net_payable := gross - NEW.tax_amount;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_client_payee_classification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.classification_status = 'CONFIRMED' THEN RETURN NEW; END IF;
  IF NEW.payee_classification <> 'UNCLASSIFIED' THEN
    NEW.classification_status = COALESCE(NULLIF(NEW.classification_status, 'REVIEW_REQUIRED'), 'AUTO_CLASSIFIED');
    RETURN NEW;
  END IF;
  CASE NEW.holder_type::text
    WHEN 'Natural Person - Promoter', 'Promoter' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'PROMOTER';
    WHEN 'Natural Person - Local', 'Local' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'LOCAL';
    WHEN 'Natural Person - Employee', 'Employee' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'PUBLIC';
    WHEN 'Natural Person - Public', 'Natural Person - Minor', 'Natural Person - Joint Holder' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'PUBLIC';
    WHEN 'Public' THEN NEW.payee_classification := 'PUBLIC_LEGAL_PERSON'; NEW.payee_segment := 'PUBLIC';
    WHEN 'Legal Person', 'Legal Person - Promoter', 'Institution', 'Foreign' THEN NEW.payee_classification := 'COMPANY_INSTITUTION';
    WHEN 'Mutual Fund', 'Tax Exempt' THEN NEW.payee_classification := 'TAX_EXEMPT';
    ELSE RETURN NEW;
  END CASE;
  NEW.classification_status := 'AUTO_CLASSIFIED';
  NEW.classification_source := COALESCE(NEW.classification_source, 'holder_type');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_all_classifications_and_taxes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clients_updated int := 0;
  v_interest_updated int := 0;
  v_dividend_updated int := 0;
BEGIN
  -- 1. Correct Tax-Exempt Funds in Clients table
  UPDATE public.clients
  SET 
    payee_classification = 'TAX_EXEMPT',
    holder_type = 'Mutual Fund'::public.holder_type,
    classification_status = 'CONFIRMED'
  WHERE 
    (full_name ~* '\y(MUTUAL\s*FUND|MF|80[-/:]?20|FOCUS\s*\d+|SELECT\s*\d+|SUPER\s*\d+|NMB\s*\d+|SAMRIDDHI|PRAGATI|SAHABHAGITA|DHANABRIDDHI|SABAL|UNNATI|SARAL|SHUBHA|EQUITY|GROWTH|BALANCED|BLUECHIP|LARGE\s*CAP|FLEXI\s*CAP|VALUE|DEBT|FIXED\s*INCOME|DYNAMIC|SYSTEMATIC|INDEX|STABLE|SMART|YOJANA)\y')
    AND full_name !~* '\y(ARMY\s*WELFARE|SAINIK\s*KALYAN|POLICE\s*WELFARE|PRAHARI\s*KALYAN)\y';
  GET DIAGNOSTICS v_clients_updated = ROW_COUNT;

  -- 2. Sync interest_payables TDS
  UPDATE public.interest_payables ip
  SET 
    tds_rate = CASE 
      WHEN c.payee_classification = 'TAX_EXEMPT' THEN 0.0
      WHEN c.payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR c.holder_type::text ILIKE '%Foreign%' THEN 0.15
      ELSE 0.06
    END,
    tax_amount = round(COALESCE(ip.gross_interest, 0) * (CASE 
      WHEN c.payee_classification = 'TAX_EXEMPT' THEN 0.0
      WHEN c.payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR c.holder_type::text ILIKE '%Foreign%' THEN 0.15
      ELSE 0.06
    END), 2),
    net_payable = COALESCE(ip.gross_interest, 0) - round(COALESCE(ip.gross_interest, 0) * (CASE 
      WHEN c.payee_classification = 'TAX_EXEMPT' THEN 0.0
      WHEN c.payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR c.holder_type::text ILIKE '%Foreign%' THEN 0.15
      ELSE 0.06
    END), 2)
  FROM public.clients c
  WHERE ip.client_id = c.id;
  GET DIAGNOSTICS v_interest_updated = ROW_COUNT;

  -- 3. Sync dividend_payables TDS
  UPDATE public.dividend_payables dp
  SET 
    tds_rate = CASE 
      WHEN c.payee_classification = 'TAX_EXEMPT' THEN 0.0
      ELSE 0.05
    END,
    tax_amount = round(COALESCE(dp.gross_dividend, 0) * (CASE 
      WHEN c.payee_classification = 'TAX_EXEMPT' THEN 0.0
      ELSE 0.05
    END), 2),
    net_payable = COALESCE(dp.gross_dividend, 0) - round(COALESCE(dp.gross_dividend, 0) * (CASE 
      WHEN c.payee_classification = 'TAX_EXEMPT' THEN 0.0
      ELSE 0.05
    END), 2)
  FROM public.clients c
  WHERE dp.client_id = c.id;
  GET DIAGNOSTICS v_dividend_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'clients_updated', v_clients_updated,
    'interest_updated', v_interest_updated,
    'dividend_updated', v_dividend_updated
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Lockdown of AGM Tables RLS Policies (Issue 7)
-- ----------------------------------------------------------------------------

-- agm_broker_claims
DROP POLICY IF EXISTS "agm_broker_claims_auth" ON public.agm_broker_claims;
DROP POLICY IF EXISTS "agm_broker_claims_select" ON public.agm_broker_claims;
DROP POLICY IF EXISTS "agm_broker_claims_modify" ON public.agm_broker_claims;

CREATE POLICY "agm_broker_claims_select" ON public.agm_broker_claims
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "agm_broker_claims_modify" ON public.agm_broker_claims
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]));

-- agm_broker_pools
DROP POLICY IF EXISTS "agm_broker_pools_auth" ON public.agm_broker_pools;
DROP POLICY IF EXISTS "agm_broker_pools_select" ON public.agm_broker_pools;
DROP POLICY IF EXISTS "agm_broker_pools_modify" ON public.agm_broker_pools;

CREATE POLICY "agm_broker_pools_select" ON public.agm_broker_pools
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "agm_broker_pools_modify" ON public.agm_broker_pools
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]));

-- agm_drn_records
DROP POLICY IF EXISTS "agm_drn_records_auth" ON public.agm_drn_records;
DROP POLICY IF EXISTS "agm_drn_records_select" ON public.agm_drn_records;
DROP POLICY IF EXISTS "agm_drn_records_modify" ON public.agm_drn_records;

CREATE POLICY "agm_drn_records_select" ON public.agm_drn_records
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "agm_drn_records_modify" ON public.agm_drn_records
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]));

-- agm_fiscal_year_meta
DROP POLICY IF EXISTS "agm_fiscal_year_meta_auth" ON public.agm_fiscal_year_meta;
DROP POLICY IF EXISTS "agm_fiscal_year_meta_select" ON public.agm_fiscal_year_meta;
DROP POLICY IF EXISTS "agm_fiscal_year_meta_modify" ON public.agm_fiscal_year_meta;

CREATE POLICY "agm_fiscal_year_meta_select" ON public.agm_fiscal_year_meta
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "agm_fiscal_year_meta_modify" ON public.agm_fiscal_year_meta
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]));

-- agm_historical_shareholders
DROP POLICY IF EXISTS "agm_historical_shareholders_auth" ON public.agm_historical_shareholders;
DROP POLICY IF EXISTS "agm_historical_shareholders_select" ON public.agm_historical_shareholders;
DROP POLICY IF EXISTS "agm_historical_shareholders_modify" ON public.agm_historical_shareholders;

CREATE POLICY "agm_historical_shareholders_select" ON public.agm_historical_shareholders
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "agm_historical_shareholders_modify" ON public.agm_historical_shareholders
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]));

-- agm_yearly_snapshots
DROP POLICY IF EXISTS "agm_yearly_snapshots_auth" ON public.agm_yearly_snapshots;
DROP POLICY IF EXISTS "agm_yearly_snapshots_select" ON public.agm_yearly_snapshots;
DROP POLICY IF EXISTS "agm_yearly_snapshots_modify" ON public.agm_yearly_snapshots;

CREATE POLICY "agm_yearly_snapshots_select" ON public.agm_yearly_snapshots
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "agm_yearly_snapshots_modify" ON public.agm_yearly_snapshots
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]));

-- ----------------------------------------------------------------------------
-- 4. Transactional Duplicate File Hash Protection (Issue 9)
-- ----------------------------------------------------------------------------

-- Deduplicate any existing active duplicate uploads by marking older entries as RolledBack
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY file_hash, target_table 
           ORDER BY created_at DESC, id DESC
         ) as rn
  FROM public.upload_history
  WHERE status IN ('Completed', 'Processing')
    AND file_hash IS NOT NULL 
    AND file_hash != ''
)
UPDATE public.upload_history
SET status = 'RolledBack',
    error_message = COALESCE(error_message, 'Superseded by duplicate file hash')
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_upload_history_active_file_hash
  ON public.upload_history (file_hash, target_table)
  WHERE status IN ('Completed', 'Processing') AND file_hash IS NOT NULL AND file_hash != '';

-- ----------------------------------------------------------------------------
-- 5. Comprehensive Financial Amounts and Rates Bounds (Issue 6)
-- ----------------------------------------------------------------------------

-- Payments financial bounds
DO $$ BEGIN
  ALTER TABLE public.payments
    DROP CONSTRAINT IF EXISTS chk_pay_amounts_nonneg,
    ADD CONSTRAINT chk_pay_amounts_nonneg CHECK (
      gross_amount >= 0 AND tax_amount >= 0 AND net_amount >= 0 AND paid_amount >= 0
    ),
    DROP CONSTRAINT IF EXISTS chk_pay_net_le_gross,
    ADD CONSTRAINT chk_pay_net_le_gross CHECK (net_amount <= gross_amount + 0.05),
    DROP CONSTRAINT IF EXISTS chk_pay_tax_le_gross,
    ADD CONSTRAINT chk_pay_tax_le_gross CHECK (tax_amount <= gross_amount + 0.05),
    DROP CONSTRAINT IF EXISTS chk_pay_balance_invariant,
    ADD CONSTRAINT chk_pay_balance_invariant CHECK (abs((gross_amount - tax_amount) - net_amount) <= 0.05);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Clients shareholding quantities
DO $$ BEGIN
  ALTER TABLE public.clients
    DROP CONSTRAINT IF EXISTS chk_clients_kitta_nonneg,
    ADD CONSTRAINT chk_clients_kitta_nonneg CHECK (kitta >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Companies dividend and coupon rate bounds
DO $$ BEGIN
  ALTER TABLE public.companies
    DROP CONSTRAINT IF EXISTS chk_companies_dividend_rate_range,
    ADD CONSTRAINT chk_companies_dividend_rate_range CHECK (dividend_rate IS NULL OR (dividend_rate >= 0 AND dividend_rate <= 1000)),
    DROP CONSTRAINT IF EXISTS chk_companies_coupon_rate_range,
    ADD CONSTRAINT chk_companies_coupon_rate_range CHECK (coupon_rate IS NULL OR (coupon_rate >= 0 AND coupon_rate <= 100));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Dividend payables quantities and rates
DO $$ BEGIN
  ALTER TABLE public.dividend_payables
    DROP CONSTRAINT IF EXISTS chk_div_shares_nonneg,
    ADD CONSTRAINT chk_div_shares_nonneg CHECK (shares_held IS NULL OR shares_held >= 0),
    DROP CONSTRAINT IF EXISTS chk_div_tds_rate_range,
    ADD CONSTRAINT chk_div_tds_rate_range CHECK (tds_rate IS NULL OR (tds_rate >= 0 AND tds_rate <= 1));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Interest payables quantities and rates
DO $$ BEGIN
  ALTER TABLE public.interest_payables
    DROP CONSTRAINT IF EXISTS chk_int_kitta_nonneg,
    ADD CONSTRAINT chk_int_kitta_nonneg CHECK (
      (kitta IS NULL OR kitta >= 0) AND
      (shares_held IS NULL OR shares_held >= 0)
    ),
    DROP CONSTRAINT IF EXISTS chk_int_tds_rate_range,
    ADD CONSTRAINT chk_int_tds_rate_range CHECK (tds_rate IS NULL OR (tds_rate >= 0 AND tds_rate <= 1));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Mutual fund payables quantities and rates
DO $$ BEGIN
  ALTER TABLE public.mutual_fund_payables
    DROP CONSTRAINT IF EXISTS chk_mf_units_nonneg,
    DROP CONSTRAINT IF EXISTS chk_mf_shares_nonneg,
    ADD CONSTRAINT chk_mf_shares_nonneg CHECK (shares_held IS NULL OR shares_held >= 0),
    DROP CONSTRAINT IF EXISTS chk_mf_tds_rate_range,
    ADD CONSTRAINT chk_mf_tds_rate_range CHECK (tds_rate IS NULL OR (tds_rate >= 0 AND tds_rate <= 1));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
