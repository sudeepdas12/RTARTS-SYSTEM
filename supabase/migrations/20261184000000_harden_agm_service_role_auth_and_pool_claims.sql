-- ============================================================================
-- Migration: 20261184000000_harden_agm_service_role_auth_and_pool_claims.sql
-- Description:
-- 1. Updates commit_agm_fiscal_year_import, apply_agm_statutory_corrections,
--    promote_agm_clients_and_payables, and claim_agm_broker_pool to properly
--    recognize service_role callers via request.jwt.claims.
-- 2. Casts anomalies array correctly to TEXT[] in statutory corrections & import.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Stored Procedure: apply_agm_statutory_corrections
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_agm_statutory_corrections(
  p_company_id UUID,
  p_corrections JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_jwt_role TEXT;
  v_corr_rec JSONB;
  v_snap_rec JSONB;
  v_sh_row JSONB;
  v_boid TEXT;
  v_sh_id UUID;
  v_corrected_shareholders INT := 0;
  v_corrected_snapshots INT := 0;

  -- Mathematical consistency variables
  v_expected_kitta NUMERIC(15, 4);
  v_expected_bonus NUMERIC(15, 4);
  v_expected_cash NUMERIC(15, 2);
  v_expected_tax NUMERIC(15, 2);

  v_calc_bonus NUMERIC(15, 4);
  v_calc_cash NUMERIC(15, 2);
  v_calc_tax NUMERIC(15, 2);
  v_final_post_kitta NUMERIC(15, 4);
BEGIN
  -- Extract caller JWT role
  BEGIN
    v_jwt_role := (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND current_user != 'postgres' THEN
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
    END IF;

    IF NOT public.has_company_access(v_user_id, p_company_id) THEN
      RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_corrections IS NULL OR jsonb_array_length(p_corrections) = 0 THEN
    RETURN jsonb_build_object('success', true, 'shareholdersCorrected', 0, 'snapshotsCorrected', 0);
  END IF;

  FOR v_corr_rec IN SELECT * FROM jsonb_array_elements(p_corrections)
  LOOP
    v_sh_row := v_corr_rec->'shareholder_row';
    v_boid := v_sh_row->>'boid';

    IF v_boid IS NULL THEN
      RAISE EXCEPTION 'Correction record missing BOID' USING ERRCODE = '22000';
    END IF;

    v_expected_kitta := COALESCE((v_sh_row->>'current_kitta_2081')::numeric, 0);
    v_expected_bonus := COALESCE((v_sh_row->>'total_bonus_shares')::numeric, 0);
    v_expected_cash := COALESCE((v_sh_row->>'total_cash_dividend')::numeric, 0);
    v_expected_tax := COALESCE((v_sh_row->>'total_tax_withheld')::numeric, 0);

    v_calc_bonus := 0;
    v_calc_cash := 0;
    v_calc_tax := 0;
    v_final_post_kitta := 0;

    -- Verify math across all snapshots in the correction payload
    FOR v_snap_rec IN SELECT * FROM jsonb_array_elements(v_corr_rec->'snapshots')
    LOOP
      v_calc_bonus := v_calc_bonus + COALESCE((v_snap_rec->>'issued_whole_bonus')::numeric, 0);
      v_calc_cash := v_calc_cash + COALESCE((v_snap_rec->>'gross_cash_dividend')::numeric, 0);
      v_calc_tax := v_calc_tax + COALESCE((v_snap_rec->>'bonus_tax_withheld')::numeric, 0) + COALESCE((v_snap_rec->>'cash_tax_withheld')::numeric, 0);
      v_final_post_kitta := COALESCE((v_snap_rec->>'post_event_kitta')::numeric, 0);
    END LOOP;

    -- Consistency Check 1: Final snapshot kitta vs master current kitta
    IF jsonb_array_length(v_corr_rec->'snapshots') > 0 AND ABS(v_expected_kitta - v_final_post_kitta) > 0.0001 THEN
      RAISE EXCEPTION 'Invariant violated for BOID %: master kitta (%) does not match final snapshot post-event kitta (%)',
        v_boid, v_expected_kitta, v_final_post_kitta USING ERRCODE = '22000';
    END IF;

    -- Consistency Check 2: Sum of bonus shares
    IF jsonb_array_length(v_corr_rec->'snapshots') > 0 AND ABS(v_expected_bonus - v_calc_bonus) > 0.0001 THEN
      RAISE EXCEPTION 'Invariant violated for BOID %: master bonus total (%) does not match sum of snapshots (%)',
        v_boid, v_expected_bonus, v_calc_bonus USING ERRCODE = '22000';
    END IF;

    -- Consistency Check 3: Sum of cash dividend (within 0.05 rounding tolerance)
    IF jsonb_array_length(v_corr_rec->'snapshots') > 0 AND ABS(v_expected_cash - v_calc_cash) > 0.05 THEN
      RAISE EXCEPTION 'Invariant violated for BOID %: master cash total (%) does not match sum of snapshots (%)',
        v_boid, v_expected_cash, v_calc_cash USING ERRCODE = '22000';
    END IF;

    -- Update master shareholder
    UPDATE public.agm_historical_shareholders
    SET current_kitta_2081 = v_expected_kitta,
        current_fraction_2081 = COALESCE((v_sh_row->>'current_fraction_2081')::numeric, 0),
        total_bonus_shares = v_expected_bonus,
        total_cash_dividend = v_expected_cash,
        total_tax_withheld = v_expected_tax,
        reconciliation_status = 'RECONCILED',
        has_discrepancy = false,
        anomalies = ARRAY['Statutory CDSC Linear Correction Applied.']::TEXT[],
        updated_at = now()
    WHERE company_id = p_company_id
      AND boid = v_boid
    RETURNING id INTO v_sh_id;

    IF v_sh_id IS NULL THEN
      -- If row wasn't found by BOID, query id directly if present
      IF (v_sh_row->>'id') IS NOT NULL THEN
        UPDATE public.agm_historical_shareholders
        SET current_kitta_2081 = v_expected_kitta,
            current_fraction_2081 = COALESCE((v_sh_row->>'current_fraction_2081')::numeric, 0),
            total_bonus_shares = v_expected_bonus,
            total_cash_dividend = v_expected_cash,
            total_tax_withheld = v_expected_tax,
            reconciliation_status = 'RECONCILED',
            has_discrepancy = false,
            anomalies = ARRAY['Statutory CDSC Linear Correction Applied.']::TEXT[],
            updated_at = now()
        WHERE id = (v_sh_row->>'id')::uuid
          AND company_id = p_company_id
        RETURNING id INTO v_sh_id;
      END IF;
    END IF;

    IF v_sh_id IS NOT NULL THEN
      v_corrected_shareholders := v_corrected_shareholders + 1;

      -- Upsert synchronized snapshots for this shareholder
      FOR v_snap_rec IN SELECT * FROM jsonb_array_elements(v_corr_rec->'snapshots')
      LOOP
        INSERT INTO public.agm_yearly_snapshots (
          company_id,
          shareholder_id,
          boid,
          fiscal_year,
          event_name,
          base_kitta,
          previous_fraction,
          gross_bonus_entitlement,
          issued_whole_bonus,
          carried_new_fraction,
          gross_cash_dividend,
          bonus_tax_withheld,
          cash_tax_withheld,
          net_cash_payable,
          post_event_kitta,
          excel_discrepancy_flag,
          remarks
        ) VALUES (
          p_company_id,
          v_sh_id,
          v_boid,
          v_snap_rec->>'fiscal_year',
          COALESCE(v_snap_rec->>'event_name', 'AGM Corporate Action'),
          COALESCE((v_snap_rec->>'base_kitta')::numeric, 0),
          COALESCE((v_snap_rec->>'previous_fraction')::numeric, 0),
          COALESCE((v_snap_rec->>'gross_bonus_entitlement')::numeric, 0),
          COALESCE((v_snap_rec->>'issued_whole_bonus')::numeric, 0),
          COALESCE((v_snap_rec->>'carried_new_fraction')::numeric, 0),
          COALESCE((v_snap_rec->>'gross_cash_dividend')::numeric, 0),
          COALESCE((v_snap_rec->>'bonus_tax_withheld')::numeric, 0),
          COALESCE((v_snap_rec->>'cash_tax_withheld')::numeric, 0),
          COALESCE((v_snap_rec->>'net_cash_payable')::numeric, 0),
          COALESCE((v_snap_rec->>'post_event_kitta')::numeric, 0),
          false,
          COALESCE(v_snap_rec->>'remarks', 'Statutory CDSC Linear Correction Applied.')
        )
        ON CONFLICT (company_id, boid, fiscal_year) DO UPDATE
        SET shareholder_id = EXCLUDED.shareholder_id,
            base_kitta = EXCLUDED.base_kitta,
            previous_fraction = EXCLUDED.previous_fraction,
            gross_bonus_entitlement = EXCLUDED.gross_bonus_entitlement,
            issued_whole_bonus = EXCLUDED.issued_whole_bonus,
            carried_new_fraction = EXCLUDED.carried_new_fraction,
            gross_cash_dividend = EXCLUDED.gross_cash_dividend,
            bonus_tax_withheld = EXCLUDED.bonus_tax_withheld,
            cash_tax_withheld = EXCLUDED.cash_tax_withheld,
            net_cash_payable = EXCLUDED.net_cash_payable,
            post_event_kitta = EXCLUDED.post_event_kitta,
            excel_discrepancy_flag = false,
            remarks = EXCLUDED.remarks;

        v_corrected_snapshots := v_corrected_snapshots + 1;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'shareholdersCorrected', v_corrected_shareholders,
    'snapshotsCorrected', v_corrected_snapshots
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_agm_statutory_corrections(UUID, JSONB) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.apply_agm_statutory_corrections(UUID, JSONB) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Stored Procedure: commit_agm_fiscal_year_import
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_agm_fiscal_year_import(
  p_company_id UUID,
  p_fiscal_year TEXT,
  p_batch_id UUID,
  p_event_name TEXT,
  p_report JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_jwt_role TEXT;
  v_staged_count INT := 0;
  v_upserted_shareholders INT := 0;
  v_upserted_snapshots INT := 0;
  v_deleted_snapshots INT := 0;
  v_archived_shareholders INT := 0;
  v_total_kitta NUMERIC(15, 4) := 0;
  v_total_bonus NUMERIC(15, 4) := 0;
  v_total_cash NUMERIC(15, 2) := 0;
BEGIN
  -- Extract caller JWT role
  BEGIN
    v_jwt_role := (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND current_user != 'postgres' THEN
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
    END IF;

    IF NOT public.has_company_access(v_user_id, p_company_id) THEN
      RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_staged_count
  FROM public.agm_import_staging
  WHERE company_id = p_company_id
    AND fiscal_year = p_fiscal_year
    AND batch_id = p_batch_id;

  IF v_staged_count = 0 THEN
    RAISE EXCEPTION 'No staged records found for batch % and fiscal year %', p_batch_id, p_fiscal_year USING ERRCODE = 'P0002';
  END IF;

  -- 1. Transactional replacement: remove stale snapshots for (company_id, fiscal_year) not in staging
  DELETE FROM public.agm_yearly_snapshots s
  WHERE s.company_id = p_company_id
    AND s.fiscal_year = p_fiscal_year
    AND NOT EXISTS (
      SELECT 1 FROM public.agm_import_staging st
      WHERE st.company_id = p_company_id
        AND st.fiscal_year = p_fiscal_year
        AND st.batch_id = p_batch_id
        AND st.boid = s.boid
    );
  GET DIAGNOSTICS v_deleted_snapshots = ROW_COUNT;

  -- 2. Prune orphaned shareholders with zero snapshots remaining across all fiscal years
  DELETE FROM public.agm_historical_shareholders h
  WHERE h.company_id = p_company_id
    AND h.boid NOT IN ('REMCONVERSION', 'REMBONUSFY20767778', 'FOLIO-REMPOOL')
    AND NOT EXISTS (
      SELECT 1 FROM public.agm_import_staging st
      WHERE st.company_id = p_company_id
        AND st.batch_id = p_batch_id
        AND st.boid = h.boid
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.agm_yearly_snapshots s
      WHERE s.company_id = p_company_id
        AND s.boid = h.boid
    );
  GET DIAGNOSTICS v_archived_shareholders = ROW_COUNT;

  -- 3. Upsert master shareholders from staging
  INSERT INTO public.agm_historical_shareholders (
    company_id,
    boid,
    shareholder_name,
    father_name,
    grandfather_name,
    guardian_name,
    spouse_name,
    citizenship_no,
    address,
    district,
    contact_no,
    email,
    bank_name,
    bank_account_no,
    pan_no,
    original_folio_no,
    holder_type,
    initial_kitta_2075,
    initial_fraction_2075,
    imported_base_kitta,
    imported_opening_fraction,
    imported_base_fiscal_year,
    converted_shares,
    current_kitta_2081,
    current_fraction_2081,
    total_bonus_shares,
    total_cash_dividend,
    total_tax_withheld,
    reconciliation_status,
    has_discrepancy,
    anomalies,
    updated_at
  )
  SELECT
    p_company_id,
    st.boid,
    COALESCE(st.shareholder_row->>'shareholder_name', 'Unknown Shareholder'),
    (st.shareholder_row->>'father_name'),
    (st.shareholder_row->>'grandfather_name'),
    (st.shareholder_row->>'guardian_name'),
    (st.shareholder_row->>'spouse_name'),
    (st.shareholder_row->>'citizenship_no'),
    (st.shareholder_row->>'address'),
    (st.shareholder_row->>'district'),
    (st.shareholder_row->>'contact_no'),
    (st.shareholder_row->>'email'),
    (st.shareholder_row->>'bank_name'),
    (st.shareholder_row->>'bank_account_no'),
    (st.shareholder_row->>'pan_no'),
    (st.shareholder_row->>'original_folio_no'),
    COALESCE(NULLIF(st.shareholder_row->>'holder_type', 'Individual'), 'PUBLIC'),
    COALESCE((st.shareholder_row->>'initial_kitta_2075')::numeric, 0),
    COALESCE((st.shareholder_row->>'initial_fraction_2075')::numeric, 0),
    COALESCE((st.shareholder_row->>'imported_base_kitta')::numeric, 0),
    COALESCE((st.shareholder_row->>'imported_opening_fraction')::numeric, 0),
    st.shareholder_row->>'imported_base_fiscal_year',
    COALESCE((st.shareholder_row->>'converted_shares')::numeric, 0),
    COALESCE((st.shareholder_row->>'current_kitta_2081')::numeric, 0),
    COALESCE((st.shareholder_row->>'current_fraction_2081')::numeric, 0),
    COALESCE((st.shareholder_row->>'total_bonus_shares')::numeric, 0),
    COALESCE((st.shareholder_row->>'total_cash_dividend')::numeric, 0),
    COALESCE((st.shareholder_row->>'total_tax_withheld')::numeric, 0),
    COALESCE(st.shareholder_row->>'reconciliation_status', 'PENDING'),
    COALESCE((st.shareholder_row->>'has_discrepancy')::boolean, false),
    COALESCE((SELECT array_agg(x::text) FROM jsonb_array_elements_text(st.shareholder_row->'anomalies') x), ARRAY[]::TEXT[]),
    now()
  FROM public.agm_import_staging st
  WHERE st.company_id = p_company_id
    AND st.fiscal_year = p_fiscal_year
    AND st.batch_id = p_batch_id
  ON CONFLICT (company_id, boid) DO UPDATE
  SET shareholder_name = EXCLUDED.shareholder_name,
      father_name = COALESCE(EXCLUDED.father_name, public.agm_historical_shareholders.father_name),
      grandfather_name = COALESCE(EXCLUDED.grandfather_name, public.agm_historical_shareholders.grandfather_name),
      guardian_name = COALESCE(EXCLUDED.guardian_name, public.agm_historical_shareholders.guardian_name),
      spouse_name = COALESCE(EXCLUDED.spouse_name, public.agm_historical_shareholders.spouse_name),
      citizenship_no = COALESCE(EXCLUDED.citizenship_no, public.agm_historical_shareholders.citizenship_no),
      address = COALESCE(EXCLUDED.address, public.agm_historical_shareholders.address),
      district = COALESCE(EXCLUDED.district, public.agm_historical_shareholders.district),
      contact_no = COALESCE(EXCLUDED.contact_no, public.agm_historical_shareholders.contact_no),
      email = COALESCE(EXCLUDED.email, public.agm_historical_shareholders.email),
      bank_name = COALESCE(EXCLUDED.bank_name, public.agm_historical_shareholders.bank_name),
      bank_account_no = COALESCE(EXCLUDED.bank_account_no, public.agm_historical_shareholders.bank_account_no),
      pan_no = COALESCE(EXCLUDED.pan_no, public.agm_historical_shareholders.pan_no),
      holder_type = COALESCE(EXCLUDED.holder_type, public.agm_historical_shareholders.holder_type),
      current_kitta_2081 = EXCLUDED.current_kitta_2081,
      current_fraction_2081 = EXCLUDED.current_fraction_2081,
      total_bonus_shares = EXCLUDED.total_bonus_shares,
      total_cash_dividend = EXCLUDED.total_cash_dividend,
      total_tax_withheld = EXCLUDED.total_tax_withheld,
      reconciliation_status = EXCLUDED.reconciliation_status,
      has_discrepancy = EXCLUDED.has_discrepancy,
      anomalies = EXCLUDED.anomalies,
      updated_at = now();
  GET DIAGNOSTICS v_upserted_shareholders = ROW_COUNT;

  -- 4. Upsert yearly snapshots from staging
  INSERT INTO public.agm_yearly_snapshots (
    company_id,
    shareholder_id,
    boid,
    fiscal_year,
    event_name,
    base_kitta,
    previous_fraction,
    gross_bonus_entitlement,
    issued_whole_bonus,
    carried_new_fraction,
    gross_cash_dividend,
    bonus_tax_withheld,
    cash_tax_withheld,
    net_cash_payable,
    post_event_kitta,
    excel_discrepancy_flag,
    is_locked,
    remarks
  )
  SELECT
    p_company_id,
    sh.id,
    st.boid,
    p_fiscal_year,
    p_event_name,
    COALESCE((st.snapshot_row->>'base_kitta')::numeric, 0),
    COALESCE((st.snapshot_row->>'previous_fraction')::numeric, 0),
    COALESCE((st.snapshot_row->>'gross_bonus_entitlement')::numeric, 0),
    COALESCE((st.snapshot_row->>'issued_whole_bonus')::numeric, 0),
    COALESCE((st.snapshot_row->>'carried_new_fraction')::numeric, 0),
    COALESCE((st.snapshot_row->>'gross_cash_dividend')::numeric, 0),
    COALESCE((st.snapshot_row->>'bonus_tax_withheld')::numeric, 0),
    COALESCE((st.snapshot_row->>'cash_tax_withheld')::numeric, 0),
    COALESCE((st.snapshot_row->>'net_cash_payable')::numeric, 0),
    COALESCE((st.snapshot_row->>'post_event_kitta')::numeric, 0),
    COALESCE((st.snapshot_row->>'excel_discrepancy_flag')::boolean, false),
    true,
    st.snapshot_row->>'remarks'
  FROM public.agm_import_staging st
  JOIN public.agm_historical_shareholders sh
    ON sh.company_id = p_company_id
   AND sh.boid = st.boid
  WHERE st.company_id = p_company_id
    AND st.fiscal_year = p_fiscal_year
    AND st.batch_id = p_batch_id
  ON CONFLICT (company_id, boid, fiscal_year) DO UPDATE
  SET shareholder_id = EXCLUDED.shareholder_id,
      event_name = EXCLUDED.event_name,
      base_kitta = EXCLUDED.base_kitta,
      previous_fraction = EXCLUDED.previous_fraction,
      gross_bonus_entitlement = EXCLUDED.gross_bonus_entitlement,
      issued_whole_bonus = EXCLUDED.issued_whole_bonus,
      carried_new_fraction = EXCLUDED.carried_new_fraction,
      gross_cash_dividend = EXCLUDED.gross_cash_dividend,
      bonus_tax_withheld = EXCLUDED.bonus_tax_withheld,
      cash_tax_withheld = EXCLUDED.cash_tax_withheld,
      net_cash_payable = EXCLUDED.net_cash_payable,
      post_event_kitta = EXCLUDED.post_event_kitta,
      excel_discrepancy_flag = EXCLUDED.excel_discrepancy_flag,
      is_locked = true,
      remarks = EXCLUDED.remarks;
  GET DIAGNOSTICS v_upserted_snapshots = ROW_COUNT;

  -- 5. Calculate verified financial and kitta totals for metadata
  SELECT
    COALESCE(SUM(post_event_kitta), 0),
    COALESCE(SUM(issued_whole_bonus), 0),
    COALESCE(SUM(gross_cash_dividend), 0)
  INTO v_total_kitta, v_total_bonus, v_total_cash
  FROM public.agm_yearly_snapshots
  WHERE company_id = p_company_id
    AND fiscal_year = p_fiscal_year;

  -- 6. Upsert metadata and lock the fiscal year
  INSERT INTO public.agm_fiscal_year_meta (
    company_id,
    fiscal_year,
    event_name,
    total_shareholders,
    total_kitta,
    total_bonus_kitta,
    total_cash_npr,
    is_locked,
    import_report,
    imported_by,
    imported_at,
    updated_at
  ) VALUES (
    p_company_id,
    p_fiscal_year,
    p_event_name,
    v_upserted_snapshots,
    v_total_kitta,
    v_total_bonus,
    v_total_cash,
    true,
    p_report,
    COALESCE(v_user_id::text, 'ServiceRole'),
    now(),
    now()
  )
  ON CONFLICT (company_id, fiscal_year) DO UPDATE
  SET event_name = EXCLUDED.event_name,
      total_shareholders = EXCLUDED.total_shareholders,
      total_kitta = EXCLUDED.total_kitta,
      total_bonus_kitta = EXCLUDED.total_bonus_kitta,
      total_cash_npr = EXCLUDED.total_cash_npr,
      is_locked = true,
      import_report = EXCLUDED.import_report,
      updated_at = now();

  -- 7. Clean up staging records for this batch
  DELETE FROM public.agm_import_staging
  WHERE company_id = p_company_id
    AND fiscal_year = p_fiscal_year
    AND batch_id = p_batch_id;

  RETURN jsonb_build_object(
    'success', true,
    'batchId', p_batch_id,
    'fiscalYear', p_fiscal_year,
    'isLocked', true,
    'savedCount', v_upserted_shareholders,
    'snapshotsSaved', v_upserted_snapshots,
    'staleSnapshotsPruned', v_deleted_snapshots,
    'orphansPruned', v_archived_shareholders,
    'totalKitta', v_total_kitta,
    'totalBonus', v_total_bonus,
    'totalCash', v_total_cash
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commit_agm_fiscal_year_import(UUID, TEXT, UUID, TEXT, JSONB) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.commit_agm_fiscal_year_import(UUID, TEXT, UUID, TEXT, JSONB) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Stored Procedure: claim_agm_broker_pool
-- ----------------------------------------------------------------------------
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
  v_user_id UUID := auth.uid();
  v_jwt_role TEXT;
  v_pool RECORD;
  v_new_claimed_kitta NUMERIC;
  v_new_claimed_cash NUMERIC;
  v_new_active_kitta NUMERIC;
  v_new_active_cash NUMERIC;
  v_claim_id UUID;
BEGIN
  -- Extract caller JWT role
  BEGIN
    v_jwt_role := (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND current_user != 'postgres' THEN
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
    END IF;

    IF p_company_id IS NOT NULL AND NOT public.has_company_access(v_user_id, p_company_id) THEN
      RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
    END IF;
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
    RAISE EXCEPTION 'Insufficient pool balance: requested %, available %', p_claimed_kitta, v_pool.active_balance_kitta USING ERRCODE = '22000';
  END IF;

  v_new_claimed_kitta := v_pool.claimed_kitta + p_claimed_kitta;
  v_new_claimed_cash := v_pool.claimed_cash + p_claimed_cash;
  v_new_active_kitta := v_pool.active_balance_kitta - p_claimed_kitta;
  v_new_active_cash := v_pool.active_balance_cash - p_claimed_cash;

  -- Update broker pool balances
  UPDATE public.agm_broker_pools
  SET claimed_kitta = v_new_claimed_kitta,
      claimed_cash = v_new_claimed_cash,
      active_balance_kitta = v_new_active_kitta,
      active_balance_cash = v_new_active_cash,
      updated_at = now()
  WHERE id = v_pool.id;

  -- Insert claim record
  INSERT INTO public.agm_broker_claims (
    seq_no,
    company_id,
    broker_code,
    broker_name,
    pool_boid,
    claimant_boid,
    claimant_name,
    fiscal_year,
    claimed_kitta,
    claimed_cash,
    contract_note_no,
    trade_date_bs,
    approved_by,
    remarks,
    created_at
  ) VALUES (
    p_seq_no,
    p_company_id,
    p_broker_code,
    p_broker_name,
    p_pool_boid,
    p_claimant_boid,
    p_claimant_name,
    p_fiscal_year,
    p_claimed_kitta,
    p_claimed_cash,
    p_contract_note_no,
    p_trade_date_bs,
    p_approved_by,
    p_remarks,
    now()
  )
  RETURNING id INTO v_claim_id;

  RETURN jsonb_build_object(
    'success', true,
    'claimId', v_claim_id,
    'remainingKitta', v_new_active_kitta,
    'remainingCash', v_new_active_cash
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agm_broker_pool(UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.claim_agm_broker_pool(UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
-- ----------------------------------------------------------------------------
-- 5. Stored Procedure: accept_agm_drn_record
-- ----------------------------------------------------------------------------
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
  v_jwt_role TEXT;
  v_existing RECORD;
  v_rem RECORD;
  v_new_rem_kitta NUMERIC;
  v_was_accepted BOOLEAN := false;
BEGIN
  -- Extract caller JWT role
  BEGIN
    v_jwt_role := (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND current_user != 'postgres' THEN
    IF (SELECT auth.uid()) IS NULL THEN
      RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
    END IF;

    IF p_company_id IS NOT NULL AND NOT public.has_company_access(auth.uid(), p_company_id) THEN
      RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
    END IF;
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

-- ----------------------------------------------------------------------------
-- 6. Stored Procedure: promote_agm_clients_and_payables
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_agm_clients_and_payables(
  p_company_id UUID,
  p_clients JSONB,
  p_payables JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_jwt_role TEXT;
  v_client_rec JSONB;
  v_pay_rec JSONB;
  v_upserted_clients INT := 0;
  v_inserted_payables INT := 0;
  v_target_fiscal_year TEXT;
  v_client_id UUID;
  v_boid TEXT;
  v_boid_to_id_map JSONB := '{}'::jsonb;
BEGIN
  -- Extract caller JWT role
  BEGIN
    v_jwt_role := (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND current_user != 'postgres' THEN
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
    END IF;

    IF NOT public.has_company_access(v_user_id, p_company_id) THEN
      RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 1. Upsert valid clients in the batch (strictly excluding pool/escrow accounts)
  FOR v_client_rec IN SELECT * FROM jsonb_array_elements(p_clients)
  LOOP
    v_boid := TRIM(v_client_rec->>'boid');

    IF v_boid IN ('REMCONVERSION', 'REMBONUSFY20767778', 'FOLIO-REMPOOL')
       OR v_boid ILIKE 'FOLIO-REM%'
       OR v_boid ILIKE 'REM%' THEN
      CONTINUE;
    END IF;

    INSERT INTO public.clients (
      company_id,
      client_code,
      boid,
      full_name,
      father_name,
      grandfather_name,
      citizenship_no,
      pan_no,
      address,
      phone,
      bank_name,
      bank_account_no,
      holder_type,
      kitta,
      status
    ) VALUES (
      p_company_id,
      COALESCE(v_client_rec->>'client_code', v_client_rec->>'client_id', v_boid),
      v_boid,
      COALESCE(v_client_rec->>'full_name', v_client_rec->>'name', 'Unknown Client'),
      v_client_rec->>'father_name',
      v_client_rec->>'grandfather_name',
      v_client_rec->>'citizenship_no',
      v_client_rec->>'pan_no',
      v_client_rec->>'address',
      COALESCE(v_client_rec->>'phone', v_client_rec->>'contact_number'),
      v_client_rec->>'bank_name',
      COALESCE(v_client_rec->>'bank_account_no', v_client_rec->>'bank_account_number'),
      (CASE 
        WHEN v_client_rec->>'holder_type' IN ('Promoter', 'PROMOTER') THEN 'Promoter'::holder_type
        WHEN v_client_rec->>'holder_type' IN ('Mutual Fund', 'MUTUAL_FUND') THEN 'Mutual Fund'::holder_type
        WHEN v_client_rec->>'holder_type' IN ('Institution', 'Legal Person') THEN 'Legal Person'::holder_type
        ELSE 'Public'::holder_type
      END),
      COALESCE((v_client_rec->>'total_kitta')::numeric, (v_client_rec->>'kitta')::numeric, 0),
      'Active'
    )
    ON CONFLICT (boid) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        client_code = COALESCE(public.clients.client_code, EXCLUDED.client_code),
        father_name = COALESCE(EXCLUDED.father_name, public.clients.father_name),
        grandfather_name = COALESCE(EXCLUDED.grandfather_name, public.clients.grandfather_name),
        citizenship_no = COALESCE(EXCLUDED.citizenship_no, public.clients.citizenship_no),
        pan_no = COALESCE(EXCLUDED.pan_no, public.clients.pan_no),
        address = COALESCE(EXCLUDED.address, public.clients.address),
        phone = COALESCE(EXCLUDED.phone, public.clients.phone),
        bank_name = COALESCE(EXCLUDED.bank_name, public.clients.bank_name),
        bank_account_no = COALESCE(EXCLUDED.bank_account_no, public.clients.bank_account_no),
        holder_type = EXCLUDED.holder_type,
        kitta = EXCLUDED.kitta,
        status = 'Active',
        updated_at = now()
    RETURNING id INTO v_client_id;

    v_upserted_clients := v_upserted_clients + 1;
    v_boid_to_id_map := jsonb_set(v_boid_to_id_map, ARRAY[v_boid], to_jsonb(v_client_id::text));
  END LOOP;

  -- 2. Handle fraction dividend payables atomically if present
  IF jsonb_array_length(p_payables) > 0 THEN
    v_target_fiscal_year := (p_payables->0)->>'fiscal_year';

    DELETE FROM public.dividend_payables dp
    WHERE dp.company_id = p_company_id
      AND dp.fiscal_year = v_target_fiscal_year
      AND dp.remarks ILIKE '%fraction remainder%'
      AND dp.client_id IN (
        SELECT (v_boid_to_id_map->>c_boid)::uuid
        FROM (SELECT DISTINCT value->>'boid' AS c_boid FROM jsonb_array_elements(p_payables)) t
        WHERE v_boid_to_id_map ? c_boid
      );

    FOR v_pay_rec IN SELECT * FROM jsonb_array_elements(p_payables)
    LOOP
      v_boid := TRIM(v_pay_rec->>'boid');

      IF v_boid IN ('REMCONVERSION', 'REMBONUSFY20767778', 'FOLIO-REMPOOL')
         OR v_boid ILIKE 'FOLIO-REM%'
         OR v_boid ILIKE 'REM%' THEN
        CONTINUE;
      END IF;

      v_client_id := (v_boid_to_id_map->>v_boid)::uuid;
      IF v_client_id IS NOT NULL THEN
        INSERT INTO public.dividend_payables (
          company_id,
          client_id,
          fiscal_year,
          shares_held,
          fraction_shares,
          gross_dividend,
          tax_amount,
          net_payable,
          payment_status,
          remarks
        ) VALUES (
          p_company_id,
          v_client_id,
          v_pay_rec->>'fiscal_year',
          COALESCE((v_pay_rec->>'shares_held')::numeric, 0),
          COALESCE((v_pay_rec->>'fraction_shares')::numeric, 0),
          COALESCE((v_pay_rec->>'gross_dividend')::numeric, 0),
          COALESCE((v_pay_rec->>'tax_amount')::numeric, 0),
          COALESCE((v_pay_rec->>'net_payable')::numeric, 0),
          'Pending',
          v_pay_rec->>'remarks'
        );
        v_inserted_payables := v_inserted_payables + 1;
      END IF;
    END LOOP;
  END IF;

  -- 3. Write immutable audit log entry within the same transaction
  INSERT INTO public.audit_logs (
    user_id,
    action,
    table_name,
    record_id,
    new_value,
    action_time
  ) VALUES (
    v_user_id,
    'PROMOTE_HISTORICAL_CLIENTS',
    'clients',
    p_company_id::text,
    jsonb_build_object(
      'company_id', p_company_id,
      'clients_upserted', v_upserted_clients,
      'payables_inserted', v_inserted_payables
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'clientsUpserted', v_upserted_clients,
    'payablesInserted', v_inserted_payables
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_agm_clients_and_payables(UUID, JSONB, JSONB) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.promote_agm_clients_and_payables(UUID, JSONB, JSONB) TO authenticated, service_role;
