-- ============================================================================
-- Migration: 20261183000000_agm_production_invariants_and_statutory_corrections.sql
-- Description:
-- 1. Creates apply_agm_statutory_corrections() RPC for atomic correction
--    of master shareholder rows and yearly snapshots with mathematical verification.
-- 2. Hardens promote_agm_clients_and_payables() to exclude escrow/pool accounts,
--    enforce company authorization, and write audit log records.
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
  IF v_user_id IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  IF current_user != 'service_role' AND NOT public.has_company_access(v_user_id, p_company_id) THEN
    RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
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
        anomalies = '["Statutory CDSC Linear Correction Applied."]'::jsonb,
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
            anomalies = '["Statutory CDSC Linear Correction Applied."]'::jsonb,
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
-- 2. Hardened Stored Procedure: promote_agm_clients_and_payables
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
  v_client_rec JSONB;
  v_pay_rec JSONB;
  v_upserted_clients INT := 0;
  v_inserted_payables INT := 0;
  v_target_fiscal_year TEXT;
  v_client_id UUID;
  v_boid TEXT;
  v_boid_to_id_map JSONB := '{}'::jsonb;
BEGIN
  IF v_user_id IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  IF current_user != 'service_role' AND NOT public.has_company_access(v_user_id, p_company_id) THEN
    RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
  END IF;

  -- 1. Upsert valid clients in the batch (strictly excluding pool/escrow accounts)
  FOR v_client_rec IN SELECT * FROM jsonb_array_elements(p_clients)
  LOOP
    v_boid := TRIM(v_client_rec->>'boid');

    -- Exclude escrow and pool accounts from client master table
    IF v_boid IN ('REMCONVERSION', 'REMBONUSFY20767778', 'FOLIO-REMPOOL')
       OR v_boid ILIKE 'FOLIO-REM%'
       OR v_boid ILIKE 'REM%' THEN
      CONTINUE;
    END IF;

    INSERT INTO public.clients (
      company_id,
      boid,
      name,
      father_name,
      grandfather_name,
      citizenship_no,
      pan_no,
      address,
      contact_number,
      bank_name,
      bank_account_number,
      holder_type,
      total_kitta,
      fraction_kitta,
      status
    ) VALUES (
      p_company_id,
      v_boid,
      v_client_rec->>'name',
      v_client_rec->>'father_name',
      v_client_rec->>'grandfather_name',
      v_client_rec->>'citizenship_no',
      v_client_rec->>'pan_no',
      v_client_rec->>'address',
      v_client_rec->>'contact_number',
      v_client_rec->>'bank_name',
      v_client_rec->>'bank_account_number',
      COALESCE(v_client_rec->>'holder_type', 'Individual'),
      COALESCE((v_client_rec->>'total_kitta')::numeric, 0),
      COALESCE((v_client_rec->>'fraction_kitta')::numeric, 0),
      'Active'
    )
    ON CONFLICT (company_id, boid) DO UPDATE
    SET name = EXCLUDED.name,
        father_name = COALESCE(EXCLUDED.father_name, public.clients.father_name),
        grandfather_name = COALESCE(EXCLUDED.grandfather_name, public.clients.grandfather_name),
        citizenship_no = COALESCE(EXCLUDED.citizenship_no, public.clients.citizenship_no),
        pan_no = COALESCE(EXCLUDED.pan_no, public.clients.pan_no),
        address = COALESCE(EXCLUDED.address, public.clients.address),
        contact_number = COALESCE(EXCLUDED.contact_number, public.clients.contact_number),
        bank_name = COALESCE(EXCLUDED.bank_name, public.clients.bank_name),
        bank_account_number = COALESCE(EXCLUDED.bank_account_number, public.clients.bank_account_number),
        total_kitta = EXCLUDED.total_kitta,
        fraction_kitta = EXCLUDED.fraction_kitta,
        status = 'Active',
        updated_at = now()
    RETURNING id INTO v_client_id;

    v_upserted_clients := v_upserted_clients + 1;
    v_boid_to_id_map := jsonb_set(v_boid_to_id_map, ARRAY[v_boid], to_jsonb(v_client_id::text));
  END LOOP;

  -- 2. Handle fraction dividend payables atomically if present
  IF jsonb_array_length(p_payables) > 0 THEN
    v_target_fiscal_year := (p_payables->0)->>'fiscal_year';

    -- Clear prior fraction payables for these clients and fiscal year
    DELETE FROM public.dividend_payables dp
    WHERE dp.company_id = p_company_id
      AND dp.fiscal_year = v_target_fiscal_year
      AND dp.remarks ILIKE '%fraction remainder%'
      AND dp.client_id IN (
        SELECT (v_boid_to_id_map->>c_boid)::uuid
        FROM (SELECT DISTINCT value->>'boid' AS c_boid FROM jsonb_array_elements(p_payables)) t
        WHERE v_boid_to_id_map ? c_boid
      );

    -- Insert new fraction payables
    FOR v_pay_rec IN SELECT * FROM jsonb_array_elements(p_payables)
    LOOP
      v_boid := TRIM(v_pay_rec->>'boid');

      -- Exclude escrow/pool records
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
    company_id,
    user_id,
    action,
    entity,
    entity_id,
    details,
    created_at
  ) VALUES (
    p_company_id,
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
