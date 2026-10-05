-- ============================================================================
-- Migration: 20261180000000_agm_studio_company_isolation_and_atomic_rpcs.sql
-- Description:
-- 1. Add company_id foreign keys to all AGM tables
-- 2. Backfill existing records with company UUID
-- 3. Replace global unique constraints with composite (company_id, ...) constraints
-- 4. Scope RLS policies to company access (has_company_access) and authorized roles
-- 5. Provide atomic, idempotent RPCs for broker claims, DRN acceptance, and company stats
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Add company_id column & missing helper columns to AGM tables
-- ----------------------------------------------------------------------------

ALTER TABLE public.agm_historical_shareholders
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS original_folio_no TEXT,
  ADD COLUMN IF NOT EXISTS remarks TEXT,
  ADD COLUMN IF NOT EXISTS converted_shares NUMERIC(15, 4),
  ADD COLUMN IF NOT EXISTS imported_base_kitta NUMERIC(15, 4);

ALTER TABLE public.agm_yearly_snapshots
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.agm_fiscal_year_meta
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.agm_broker_pools
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.agm_broker_claims
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.agm_drn_records
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

-- ----------------------------------------------------------------------------
-- 2. Ensure default company exists and backfill existing orphaned records
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  v_nlg_id UUID;
BEGIN
  -- Find or insert NLG company to guarantee an existing company record
  SELECT id INTO v_nlg_id FROM public.companies WHERE UPPER(company_code) = 'NLG' LIMIT 1;
  IF v_nlg_id IS NULL THEN
    INSERT INTO public.companies (company_code, company_name, isin)
    VALUES ('NLG', 'NLG Insurance Company Ltd', 'NPE208A00006')
    RETURNING id INTO v_nlg_id;
  END IF;

  -- Backfill any existing orphaned rows with the primary company UUID
  UPDATE public.agm_historical_shareholders SET company_id = v_nlg_id WHERE company_id IS NULL;
  UPDATE public.agm_yearly_snapshots SET company_id = v_nlg_id WHERE company_id IS NULL;
  UPDATE public.agm_fiscal_year_meta SET company_id = v_nlg_id WHERE company_id IS NULL;
  UPDATE public.agm_broker_pools SET company_id = v_nlg_id WHERE company_id IS NULL;
  UPDATE public.agm_broker_claims SET company_id = v_nlg_id WHERE company_id IS NULL;
  UPDATE public.agm_drn_records SET company_id = v_nlg_id WHERE company_id IS NULL;

  -- Enforce NOT NULL on company_id across all tables
  ALTER TABLE public.agm_historical_shareholders ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE public.agm_yearly_snapshots ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE public.agm_fiscal_year_meta ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE public.agm_broker_pools ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE public.agm_broker_claims ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE public.agm_drn_records ALTER COLUMN company_id SET NOT NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Transition Unique Constraints to Plain Composite Unique Constraints
-- ----------------------------------------------------------------------------

-- Drop old global & expression unique constraints/indexes
ALTER TABLE public.agm_historical_shareholders DROP CONSTRAINT IF EXISTS agm_historical_shareholders_boid_key;
ALTER TABLE public.agm_historical_shareholders DROP CONSTRAINT IF EXISTS agm_historical_shareholders_company_boid_key;
DROP INDEX IF EXISTS public.idx_agm_shareholders_comp_boid;

ALTER TABLE public.agm_yearly_snapshots DROP CONSTRAINT IF EXISTS agm_yearly_snapshots_boid_fy_unique;
ALTER TABLE public.agm_yearly_snapshots DROP CONSTRAINT IF EXISTS agm_yearly_snapshots_company_boid_fy_key;
DROP INDEX IF EXISTS public.idx_agm_snapshots_comp_boid_fy;

ALTER TABLE public.agm_fiscal_year_meta DROP CONSTRAINT IF EXISTS agm_fiscal_year_meta_pkey;
ALTER TABLE public.agm_fiscal_year_meta DROP CONSTRAINT IF EXISTS agm_fiscal_year_meta_company_fy_key;
DROP INDEX IF EXISTS public.idx_agm_fy_meta_comp_fy;

ALTER TABLE public.agm_broker_pools DROP CONSTRAINT IF EXISTS agm_broker_pools_boid_fy_unique;
ALTER TABLE public.agm_broker_pools DROP CONSTRAINT IF EXISTS agm_broker_pools_company_pool_fy_key;
DROP INDEX IF EXISTS public.idx_agm_broker_pools_comp_boid_fy;

ALTER TABLE public.agm_drn_records DROP CONSTRAINT IF EXISTS agm_drn_records_folio_no_key;
ALTER TABLE public.agm_drn_records DROP CONSTRAINT IF EXISTS agm_drn_records_company_folio_key;
DROP INDEX IF EXISTS public.idx_agm_drn_comp_folio;

ALTER TABLE public.agm_broker_claims DROP CONSTRAINT IF EXISTS agm_broker_claims_seq_no_key;
ALTER TABLE public.agm_broker_claims DROP CONSTRAINT IF EXISTS agm_broker_claims_company_seq_key;
DROP INDEX IF EXISTS public.idx_agm_broker_claims_comp_seq;

-- Add plain table unique constraints for exact PostgREST onConflict matching
ALTER TABLE public.agm_historical_shareholders
  ADD CONSTRAINT agm_historical_shareholders_company_boid_key UNIQUE (company_id, boid);

ALTER TABLE public.agm_yearly_snapshots
  ADD CONSTRAINT agm_yearly_snapshots_company_boid_fy_key UNIQUE (company_id, boid, fiscal_year);

ALTER TABLE public.agm_fiscal_year_meta
  ADD CONSTRAINT agm_fiscal_year_meta_company_fy_key UNIQUE (company_id, fiscal_year);

ALTER TABLE public.agm_broker_pools
  ADD CONSTRAINT agm_broker_pools_company_pool_fy_key UNIQUE (company_id, pool_boid, fiscal_year);

ALTER TABLE public.agm_drn_records
  ADD CONSTRAINT agm_drn_records_company_folio_key UNIQUE (company_id, folio_no);

ALTER TABLE public.agm_broker_claims
  ADD CONSTRAINT agm_broker_claims_company_seq_key UNIQUE (company_id, seq_no);

-- Broker Claim Sequence
CREATE SEQUENCE IF NOT EXISTS public.seq_agm_broker_claim_no START WITH 9020001;

-- Performance indexes on company_id
CREATE INDEX IF NOT EXISTS idx_agm_shareholders_company_id ON public.agm_historical_shareholders(company_id);
CREATE INDEX IF NOT EXISTS idx_agm_snapshots_company_id ON public.agm_yearly_snapshots(company_id);
CREATE INDEX IF NOT EXISTS idx_agm_fy_meta_company_id ON public.agm_fiscal_year_meta(company_id);
CREATE INDEX IF NOT EXISTS idx_agm_broker_pools_company_id ON public.agm_broker_pools(company_id);
CREATE INDEX IF NOT EXISTS idx_agm_broker_claims_company_id ON public.agm_broker_claims(company_id);
CREATE INDEX IF NOT EXISTS idx_agm_drn_company_id ON public.agm_drn_records(company_id);

-- ----------------------------------------------------------------------------
-- 4. Scope RLS Policies by Company Access and Roles
-- ----------------------------------------------------------------------------

-- Drop prior role-only policies
DROP POLICY IF EXISTS "agm_broker_claims_select" ON public.agm_broker_claims;
DROP POLICY IF EXISTS "agm_broker_pools_select" ON public.agm_broker_pools;
DROP POLICY IF EXISTS "agm_drn_records_select" ON public.agm_drn_records;
DROP POLICY IF EXISTS "agm_fiscal_year_meta_select" ON public.agm_fiscal_year_meta;
DROP POLICY IF EXISTS "agm_historical_shareholders_select" ON public.agm_historical_shareholders;
DROP POLICY IF EXISTS "agm_yearly_snapshots_select" ON public.agm_yearly_snapshots;

DROP POLICY IF EXISTS "agm_broker_claims_auth" ON public.agm_broker_claims;
DROP POLICY IF EXISTS "agm_broker_pools_auth" ON public.agm_broker_pools;
DROP POLICY IF EXISTS "agm_drn_records_auth" ON public.agm_drn_records;
DROP POLICY IF EXISTS "agm_fiscal_year_meta_auth" ON public.agm_fiscal_year_meta;
DROP POLICY IF EXISTS "agm_historical_shareholders_auth" ON public.agm_historical_shareholders;
DROP POLICY IF EXISTS "agm_yearly_snapshots_auth" ON public.agm_yearly_snapshots;

DROP POLICY IF EXISTS "agm_historical_shareholders_modify" ON public.agm_historical_shareholders;
DROP POLICY IF EXISTS "agm_yearly_snapshots_modify" ON public.agm_yearly_snapshots;
DROP POLICY IF EXISTS "agm_fiscal_year_meta_modify" ON public.agm_fiscal_year_meta;
DROP POLICY IF EXISTS "agm_broker_pools_modify" ON public.agm_broker_pools;
DROP POLICY IF EXISTS "agm_broker_claims_modify" ON public.agm_broker_claims;
DROP POLICY IF EXISTS "agm_drn_records_modify" ON public.agm_drn_records;

-- agm_historical_shareholders
CREATE POLICY "agm_historical_shareholders_select" ON public.agm_historical_shareholders
  FOR SELECT TO authenticated
  USING (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'auditor'::app_role, 'report_viewer'::app_role])
  );

CREATE POLICY "agm_historical_shareholders_modify" ON public.agm_historical_shareholders
  FOR ALL TO authenticated
  USING (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role])
  )
  WITH CHECK (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role])
  );

-- agm_yearly_snapshots
CREATE POLICY "agm_yearly_snapshots_select" ON public.agm_yearly_snapshots
  FOR SELECT TO authenticated
  USING (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'auditor'::app_role, 'report_viewer'::app_role])
  );

CREATE POLICY "agm_yearly_snapshots_modify" ON public.agm_yearly_snapshots
  FOR ALL TO authenticated
  USING (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role])
  )
  WITH CHECK (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role])
  );

-- agm_fiscal_year_meta
CREATE POLICY "agm_fiscal_year_meta_select" ON public.agm_fiscal_year_meta
  FOR SELECT TO authenticated
  USING (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'auditor'::app_role, 'report_viewer'::app_role])
  );

CREATE POLICY "agm_fiscal_year_meta_modify" ON public.agm_fiscal_year_meta
  FOR ALL TO authenticated
  USING (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role])
  )
  WITH CHECK (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role])
  );

-- agm_broker_pools
CREATE POLICY "agm_broker_pools_select" ON public.agm_broker_pools
  FOR SELECT TO authenticated
  USING (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'auditor'::app_role, 'report_viewer'::app_role])
  );

CREATE POLICY "agm_broker_pools_modify" ON public.agm_broker_pools
  FOR ALL TO authenticated
  USING (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role])
  )
  WITH CHECK (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role])
  );

-- agm_broker_claims
CREATE POLICY "agm_broker_claims_select" ON public.agm_broker_claims
  FOR SELECT TO authenticated
  USING (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'auditor'::app_role, 'report_viewer'::app_role])
  );

CREATE POLICY "agm_broker_claims_modify" ON public.agm_broker_claims
  FOR ALL TO authenticated
  USING (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role])
  )
  WITH CHECK (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role])
  );

-- agm_drn_records
CREATE POLICY "agm_drn_records_select" ON public.agm_drn_records
  FOR SELECT TO authenticated
  USING (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'auditor'::app_role, 'report_viewer'::app_role])
  );

CREATE POLICY "agm_drn_records_modify" ON public.agm_drn_records
  FOR ALL TO authenticated
  USING (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role])
  )
  WITH CHECK (
    (company_id IS NULL OR public.has_company_access(auth.uid(), company_id))
    AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role])
  );

-- ----------------------------------------------------------------------------
-- 5. Stored Procedures: Atomic Broker Claim, Idempotent DRN, Company Stats
-- ----------------------------------------------------------------------------

-- 5.1 Atomic Broker Claim RPC
CREATE OR REPLACE FUNCTION public.claim_agm_broker_pool(
  p_company_id UUID,
  p_seq_no BIGINT,
  p_broker_code TEXT,
  p_broker_name TEXT,
  p_pool_boid TEXT,
  p_claimant_boid TEXT,
  p_claimant_name TEXT,
  p_fiscal_year TEXT,
  p_claimed_kitta NUMERIC,
  p_claimed_cash NUMERIC,
  p_contract_note_no TEXT,
  p_trade_date_bs TEXT,
  p_approved_by TEXT DEFAULT 'Operator',
  p_remarks TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pool RECORD;
  v_new_claimed_kitta NUMERIC;
  v_new_claimed_cash NUMERIC;
  v_new_active_kitta NUMERIC;
  v_new_active_cash NUMERIC;
  v_claim_id UUID;
BEGIN
  IF (SELECT auth.uid()) IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  IF current_user != 'service_role' AND p_company_id IS NOT NULL AND NOT public.has_company_access(auth.uid(), p_company_id) THEN
    RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
  END IF;

  -- Atomic row lock on the broker pool
  SELECT * INTO v_pool
  FROM public.agm_broker_pools
  WHERE (company_id = p_company_id OR (company_id IS NULL AND p_company_id IS NULL))
    AND pool_boid = p_pool_boid
    AND fiscal_year = p_fiscal_year
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Broker pool record not found for pool BOID % and FY %', p_pool_boid, p_fiscal_year USING ERRCODE = 'P0002';
  END IF;

  IF v_pool.active_balance_kitta < p_claimed_kitta THEN
    RAISE EXCEPTION 'Insufficient pool kitta balance: requested %, available %', p_claimed_kitta, v_pool.active_balance_kitta USING ERRCODE = '23514';
  END IF;

  IF v_pool.active_balance_cash < p_claimed_cash THEN
    RAISE EXCEPTION 'Insufficient pool cash balance: requested %, available %', p_claimed_cash, v_pool.active_balance_cash USING ERRCODE = '23514';
  END IF;

  v_new_claimed_kitta := v_pool.claimed_kitta + p_claimed_kitta;
  v_new_claimed_cash := ROUND(v_pool.claimed_cash + p_claimed_cash, 2);
  v_new_active_kitta := GREATEST(0, v_pool.active_balance_kitta - p_claimed_kitta);
  v_new_active_cash := GREATEST(0, ROUND(v_pool.active_balance_cash - p_claimed_cash, 2));

  UPDATE public.agm_broker_pools
  SET claimed_kitta = v_new_claimed_kitta,
      claimed_cash = v_new_claimed_cash,
      active_balance_kitta = v_new_active_kitta,
      active_balance_cash = v_new_active_cash,
      updated_at = now()
  WHERE id = v_pool.id;

  INSERT INTO public.agm_broker_claims (
    company_id, seq_no, broker_code, broker_name, pool_boid,
    claimant_boid, claimant_name, fiscal_year, claimed_kitta,
    claimed_cash, contract_note_no, trade_date_bs, status,
    approve_date, approved_by, remarks, created_at
  ) VALUES (
    p_company_id, p_seq_no, p_broker_code, p_broker_name, p_pool_boid,
    p_claimant_boid, p_claimant_name, p_fiscal_year, p_claimed_kitta,
    p_claimed_cash, p_contract_note_no, p_trade_date_bs, 'APPROVED',
    now(), p_approved_by, p_remarks, now()
  )
  RETURNING id INTO v_claim_id;

  RETURN jsonb_build_object(
    'success', true,
    'claimId', v_claim_id,
    'activeBalanceKitta', v_new_active_kitta,
    'activeBalanceCash', v_new_active_cash
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agm_broker_pool(UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.claim_agm_broker_pool(UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- 5.2 Idempotent DRN Acceptance & Escrow Update RPC
CREATE OR REPLACE FUNCTION public.accept_agm_drn_record(
  p_company_id UUID,
  p_folio_no TEXT,
  p_holder_name TEXT,
  p_total_kitta NUMERIC,
  p_drn_no TEXT DEFAULT NULL,
  p_drn_date TEXT DEFAULT NULL,
  p_target_boid TEXT DEFAULT NULL,
  p_certificate_no_start BIGINT DEFAULT NULL,
  p_certificate_no_end BIGINT DEFAULT NULL,
  p_distinctive_no_start BIGINT DEFAULT NULL,
  p_distinctive_no_end BIGINT DEFAULT NULL,
  p_status TEXT DEFAULT 'ACCEPTED'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
  v_rem RECORD;
  v_new_rem_kitta NUMERIC;
  v_was_accepted BOOLEAN := false;
BEGIN
  IF (SELECT auth.uid()) IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  IF current_user != 'service_role' AND p_company_id IS NOT NULL AND NOT public.has_company_access(auth.uid(), p_company_id) THEN
    RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM public.agm_drn_records
  WHERE (company_id = p_company_id OR (company_id IS NULL AND p_company_id IS NULL))
    AND folio_no = p_folio_no
  FOR UPDATE;

  IF FOUND THEN
    v_was_accepted := (v_existing.status = 'ACCEPTED');
    UPDATE public.agm_drn_records
    SET holder_name = p_holder_name,
        total_kitta = p_total_kitta,
        drn_no = coalesce(p_drn_no, drn_no),
        drn_date = coalesce(p_drn_date, drn_date),
        target_boid = coalesce(p_target_boid, target_boid),
        certificate_no_start = coalesce(p_certificate_no_start, certificate_no_start),
        certificate_no_end = coalesce(p_certificate_no_end, certificate_no_end),
        distinctive_no_start = coalesce(p_distinctive_no_start, distinctive_no_start),
        distinctive_no_end = coalesce(p_distinctive_no_end, distinctive_no_end),
        status = p_status,
        reconciled_at = (CASE WHEN p_status = 'ACCEPTED' THEN coalesce(reconciled_at, now()) ELSE NULL END)
    WHERE id = v_existing.id;
  ELSE
    INSERT INTO public.agm_drn_records (
      company_id, folio_no, holder_name, total_kitta, drn_no, drn_date,
      target_boid, certificate_no_start, certificate_no_end,
      distinctive_no_start, distinctive_no_end, status, reconciled_at, created_at
    ) VALUES (
      p_company_id, p_folio_no, p_holder_name, p_total_kitta, p_drn_no, p_drn_date,
      p_target_boid, p_certificate_no_start, p_certificate_no_end,
      p_distinctive_no_start, p_distinctive_no_end, p_status,
      (CASE WHEN p_status = 'ACCEPTED' THEN now() ELSE NULL END), now()
    );
  END IF;

  -- IDEMPOTENT ESCROW DECREMENT: Only decrement if transitioning to ACCEPTED for the first time
  IF p_status = 'ACCEPTED' AND NOT v_was_accepted AND p_total_kitta > 0 THEN
    -- Link folio to shareholder if target BOID valid
    IF p_target_boid IS NOT NULL AND length(p_target_boid) = 16 THEN
      UPDATE public.agm_historical_shareholders
      SET original_folio_no = p_folio_no
      WHERE (company_id = p_company_id OR (company_id IS NULL AND p_company_id IS NULL))
        AND boid = p_target_boid;
    END IF;

    -- Deduct from REMCONVERSION
    SELECT * INTO v_rem
    FROM public.agm_historical_shareholders
    WHERE (company_id = p_company_id OR (company_id IS NULL AND p_company_id IS NULL))
      AND boid = 'REMCONVERSION'
    FOR UPDATE;

    IF FOUND AND v_rem.current_kitta_2081 > 0 THEN
      v_new_rem_kitta := GREATEST(0, v_rem.current_kitta_2081 - p_total_kitta);
      UPDATE public.agm_historical_shareholders
      SET current_kitta_2081 = v_new_rem_kitta,
          remarks = 'Active Escrow: ' || v_new_rem_kitta::text || ' kitta | Folio ' || p_folio_no || ' (' || p_total_kitta::text || ' kitta) dematted via DRN ' || coalesce(p_drn_no, 'APPROVED')
      WHERE id = v_rem.id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'folioNo', p_folio_no,
    'status', p_status,
    'idempotentEscrowApplied', (p_status = 'ACCEPTED' AND NOT v_was_accepted)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_agm_drn_record(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.accept_agm_drn_record(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT, TEXT) TO authenticated, service_role;

-- 5.3 Company-Scoped Summary Stats RPC
CREATE OR REPLACE FUNCTION public.get_agm_summary_stats(p_company_id UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  IF current_user != 'service_role' AND p_company_id IS NOT NULL AND NOT public.has_company_access(auth.uid(), p_company_id) THEN
    RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
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
  WHERE p_company_id IS NULL OR company_id = p_company_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_agm_summary_stats(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_agm_summary_stats(UUID) TO authenticated, service_role;

-- 5.4 Atomic Bulk Pool Decomposition RPC
CREATE OR REPLACE FUNCTION public.disperse_agm_bulk_pools(
  p_company_id UUID,
  p_placeholder_boids TEXT[],
  p_folio_records JSONB
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec jsonb;
  v_inserted_count INT := 0;
  v_deleted_count INT := 0;
BEGIN
  IF (SELECT auth.uid()) IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  IF current_user != 'service_role' AND NOT public.has_company_access(auth.uid(), p_company_id) THEN
    RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id must be provided' USING ERRCODE = '23502';
  END IF;

  -- 1. Delete snapshots of placeholder records
  DELETE FROM public.agm_yearly_snapshots
  WHERE company_id = p_company_id
    AND boid = ANY(p_placeholder_boids);

  -- 2. Delete placeholder shareholders
  WITH deleted AS (
    DELETE FROM public.agm_historical_shareholders
    WHERE company_id = p_company_id
      AND boid = ANY(p_placeholder_boids)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted;

  -- 3. Atomically insert all expanded physical folio records
  FOR v_rec IN SELECT * FROM jsonb_array_elements(p_folio_records) LOOP
    INSERT INTO public.agm_historical_shareholders (
      company_id,
      boid,
      shareholder_name,
      father_name,
      grandfather_name,
      citizenship_no,
      address,
      district,
      contact_no,
      holder_type,
      initial_kitta_2075,
      initial_fraction_2075,
      imported_base_kitta,
      current_kitta_2081,
      current_fraction_2081,
      total_bonus_shares,
      total_cash_dividend,
      total_tax_withheld,
      has_discrepancy,
      reconciliation_status,
      anomalies
    ) VALUES (
      p_company_id,
      v_rec->>'boid',
      v_rec->>'shareholder_name',
      v_rec->>'father_name',
      v_rec->>'grandfather_name',
      v_rec->>'citizenship_no',
      v_rec->>'address',
      COALESCE(v_rec->>'district', 'Kathmandu'),
      v_rec->>'contact_no',
      'PUBLIC',
      COALESCE((v_rec->>'initial_kitta_2075')::numeric, 0),
      COALESCE((v_rec->>'initial_fraction_2075')::numeric, 0),
      (v_rec->>'imported_base_kitta')::numeric,
      COALESCE((v_rec->>'current_kitta_2081')::numeric, 0),
      COALESCE((v_rec->>'current_fraction_2081')::numeric, 0),
      COALESCE((v_rec->>'total_bonus_shares')::numeric, 0),
      COALESCE((v_rec->>'total_cash_dividend')::numeric, 0),
      COALESCE((v_rec->>'total_tax_withheld')::numeric, 0),
      false,
      'RECONCILED',
      ARRAY['Decomposed from bulk conversion/bonus pool']
    )
    ON CONFLICT (company_id, boid) DO UPDATE
    SET current_kitta_2081 = EXCLUDED.current_kitta_2081,
        current_fraction_2081 = EXCLUDED.current_fraction_2081,
        total_bonus_shares = EXCLUDED.total_bonus_shares,
        total_cash_dividend = EXCLUDED.total_cash_dividend,
        total_tax_withheld = EXCLUDED.total_tax_withheld,
        updated_at = now();

    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'deletedPlaceholderCount', v_deleted_count,
    'insertedFoliosCount', v_inserted_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.disperse_agm_bulk_pools(UUID, TEXT[], JSONB) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.disperse_agm_bulk_pools(UUID, TEXT[], JSONB) TO authenticated, service_role;

-- 5.5 Atomic Broker Claim Sequence Allocator
CREATE OR REPLACE FUNCTION public.next_agm_broker_claim_seq()
RETURNS BIGINT
LANGUAGE sql
AS $$
  SELECT nextval('public.seq_agm_broker_claim_no');
$$;

GRANT EXECUTE ON FUNCTION public.next_agm_broker_claim_seq() TO authenticated, service_role;

-- 5.6 Transactional Replacement and Stale Shareholder Cleanup for Fiscal Year Re-import
CREATE OR REPLACE FUNCTION public.replace_agm_fiscal_year_snapshots(
  p_company_id UUID,
  p_fiscal_year TEXT,
  p_incoming_boids TEXT[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_snapshots INT := 0;
  v_archived_shareholders INT := 0;
BEGIN
  IF (SELECT auth.uid()) IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  IF current_user != 'service_role' AND NOT public.has_company_access(auth.uid(), p_company_id) THEN
    RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
  END IF;

  -- 1. Delete snapshots for this company and fiscal year that are NOT present in the incoming workbook
  IF array_length(p_incoming_boids, 1) IS NOT NULL AND array_length(p_incoming_boids, 1) > 0 THEN
    DELETE FROM public.agm_yearly_snapshots
    WHERE company_id = p_company_id
      AND fiscal_year = p_fiscal_year
      AND boid != ALL(p_incoming_boids);
    GET DIAGNOSTICS v_deleted_snapshots = ROW_COUNT;
  ELSE
    DELETE FROM public.agm_yearly_snapshots
    WHERE company_id = p_company_id
      AND fiscal_year = p_fiscal_year;
    GET DIAGNOSTICS v_deleted_snapshots = ROW_COUNT;
  END IF;

  -- 2. Cleanup orphaned shareholders who have ZERO snapshots left across all fiscal years for this company
  -- and who are not in the incoming batch and not an escrow/pool placeholder
  DELETE FROM public.agm_historical_shareholders h
  WHERE h.company_id = p_company_id
    AND (p_incoming_boids IS NULL OR h.boid != ALL(p_incoming_boids))
    AND h.boid NOT IN ('REMCONVERSION', 'REMBONUSFY20767778', 'FOLIO-REMPOOL')
    AND NOT EXISTS (
      SELECT 1 FROM public.agm_yearly_snapshots s
      WHERE s.company_id = p_company_id
        AND s.boid = h.boid
    );
  GET DIAGNOSTICS v_archived_shareholders = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deletedSnapshotsCount', v_deleted_snapshots,
    'archivedShareholdersCount', v_archived_shareholders
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_agm_fiscal_year_snapshots(UUID, TEXT, TEXT[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.replace_agm_fiscal_year_snapshots(UUID, TEXT, TEXT[]) TO authenticated, service_role;
