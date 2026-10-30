-- ============================================================================
-- Migration: 20261005000002_schema_functions_and_rpcs.sql
-- Description: Authoritative Functions, Procedures, and RPCs
-- ============================================================================

-- Name: accept_agm_drn_record(uuid, text, text, numeric, text, text, text, bigint, bigint, bigint, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_agm_drn_record(p_company_id uuid, p_folio_no text, p_holder_name text, p_total_kitta numeric, p_drn_no text DEFAULT NULL::text, p_drn_date text DEFAULT NULL::text, p_target_boid text DEFAULT NULL::text, p_certificate_no_start bigint DEFAULT NULL::bigint, p_certificate_no_end bigint DEFAULT NULL::bigint, p_distinctive_no_start bigint DEFAULT NULL::bigint, p_distinctive_no_end bigint DEFAULT NULL::bigint, p_status text DEFAULT 'ACCEPTED'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--

-- Name: apply_agm_statutory_corrections(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_agm_statutory_corrections(p_company_id uuid, p_corrections jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--

-- Name: apply_payable_classification_and_tax(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_payable_classification_and_tax() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  c record;
  payable_kind text := CASE TG_TABLE_NAME
    WHEN 'interest_payables' THEN 'INTEREST'
    WHEN 'mutual_fund_payables' THEN 'MUTUAL_FUND'
    ELSE 'DIVIDEND' END;
  gross numeric;
  v_rate numeric;
  v_locked boolean := false;
BEGIN
  -- Settled rows are a historical snapshot: never re-rate them.
  IF TG_OP = 'UPDATE' AND OLD.payment_status IS NOT NULL AND OLD.payment_status <> 'Pending'
     AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id THEN
    v_locked := true;
  END IF;
  IF v_locked THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.client_id IS NOT NULL THEN
    SELECT payee_classification, payee_segment, classification_status
      INTO c FROM public.clients WHERE id = NEW.client_id;
    IF FOUND THEN
      NEW.payee_classification := COALESCE(c.payee_classification, 'UNCLASSIFIED');
      NEW.payee_segment := COALESCE(c.payee_segment, NEW.payee_segment);
      NEW.classification_status := COALESCE(c.classification_status, 'REVIEW_REQUIRED');
    END IF;
  END IF;
  NEW.payee_classification := COALESCE(NEW.payee_classification, 'UNCLASSIFIED');

  IF TG_TABLE_NAME = 'interest_payables' THEN
    gross := COALESCE((to_jsonb(NEW)->>'gross_interest')::numeric, 0);
  ELSIF TG_TABLE_NAME = 'mutual_fund_payables' THEN
    gross := COALESCE((to_jsonb(NEW)->>'gross_dividend')::numeric, (to_jsonb(NEW)->>'gross_amount')::numeric, 0);
  ELSE
    gross := COALESCE((to_jsonb(NEW)->>'gross_dividend')::numeric, 0);
  END IF;

  IF NEW.payee_classification = 'UNCLASSIFIED' THEN
    -- Unknown payee: no tax is implied; classification review must happen before payment.
    NEW.tds_rate := NULL;
    NEW.tax_amount := 0;
  ELSE
    SELECT tax_rate INTO v_rate FROM public.payable_tax_rules
     WHERE payable_category = payable_kind
       AND payee_classification = NEW.payee_classification
       AND is_active
     LIMIT 1;
    IF v_rate IS NULL THEN
      RAISE EXCEPTION 'No active tax rule for % / %', payable_kind, NEW.payee_classification
        USING ERRCODE = 'P0001';
    END IF;
    NEW.tds_rate := v_rate;
    NEW.tax_amount := round(gross * v_rate, 2);
  END IF;

  NEW.net_payable := round(gross - COALESCE(NEW.tax_amount, 0), 2);
  NEW.remaining_amount := GREATEST(0, NEW.net_payable - COALESCE(NEW.paid_amount, 0));
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


--

-- Name: apply_reconciliation_batch(jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_reconciliation_batch(p_items jsonb, p_batch_info jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '60s'
    AS $$
DECLARE
  v_item jsonb;
  v_payable_id uuid;
  v_payment_id uuid;
  v_existing_payment_id uuid;
  v_target_table text;
  v_result text;
  v_actual_amt numeric;
  v_expected_amt numeric;
  v_paid_amt numeric;
  v_payment_ref text;
  v_current_status text;
  v_updated_payables int := 0;
  v_updated_payments int := 0;
  v_already_paid int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_jwt_role text;
BEGIN
  IF p_batch_info IS NOT NULL THEN
    NULL;
  END IF;
  -- Extract caller JWT role
  BEGIN
    v_jwt_role := (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  -- Role check: admin, supervisor, finance_operator, operator, or service_role
  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND current_user != 'postgres' THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      -- Parse identifiers and fields
      v_payable_id   := NULLIF(v_item->>'payable_id', '')::uuid;
      v_payment_id   := NULLIF(v_item->>'payment_id', '')::uuid;
      v_target_table := COALESCE(NULLIF(v_item->>'target_table', ''), 'dividend_payables');
      v_result       := UPPER(COALESCE(NULLIF(v_item->>'reconciliation_result', ''), 'MATCHED'));
      v_actual_amt   := COALESCE(NULLIF(v_item->>'actual_amount', '')::numeric, 0);
      v_expected_amt := COALESCE(NULLIF(v_item->>'expected_amount', '')::numeric, 0);
      v_payment_ref  := COALESCE(NULLIF(v_item->>'reference_id', ''), NULLIF(v_item->>'instruction_id', ''));

      -- Calculate paid amount
      IF v_result = 'MATCHED' THEN
        v_paid_amt := CASE WHEN v_actual_amt > 0 THEN v_actual_amt ELSE v_expected_amt END;
      ELSIF v_result IN ('PARTIAL', 'UNDER_PAID', 'OVER_PAID') THEN
        v_paid_amt := v_actual_amt;
      ELSE
        v_paid_amt := 0;
      END IF;

      -- Skip and log unlinked records
      IF v_payable_id IS NULL AND v_payment_id IS NULL THEN
        v_errors := v_errors || jsonb_build_object(
          'item_id', v_item->>'id',
          'client_id', v_item->>'client_id',
          'error', 'Skipped: neither payable_id nor payment_id provided'
        );
        CONTINUE;
      END IF;

      -- Check if an active payment already exists for this payable
      IF v_payable_id IS NOT NULL AND v_payment_id IS NULL THEN
        SELECT id INTO v_existing_payment_id
        FROM public.payments
        WHERE payable_id = v_payable_id
        LIMIT 1;

        IF v_existing_payment_id IS NOT NULL THEN
          v_payment_id := v_existing_payment_id;
        END IF;
      END IF;

      -- Update the payable table
      IF v_payable_id IS NOT NULL THEN
        IF v_target_table = 'dividend_payables' THEN
          SELECT payment_status::text INTO v_current_status FROM public.dividend_payables WHERE id = v_payable_id;
          IF v_current_status = 'Paid' AND v_paid_amt >= (SELECT net_payable FROM public.dividend_payables WHERE id = v_payable_id) - 0.05 THEN
            v_already_paid := v_already_paid + 1;
          END IF;

          UPDATE public.dividend_payables
          SET payment_date      = CURRENT_DATE,
              paid_amount       = LEAST(net_payable, COALESCE(paid_amount, 0) + v_paid_amt),
              remaining_amount  = GREATEST(0, net_payable - (COALESCE(paid_amount, 0) + v_paid_amt)),
              payment_status    = CASE
                -- Standard tolerance or ConnectIPS fee absorption (NPR 2, 8, 15)
                WHEN GREATEST(0, net_payable - (COALESCE(paid_amount, 0) + v_paid_amt)) <= 0.05
                  OR (v_paid_amt >= 10 AND GREATEST(0, net_payable - (COALESCE(paid_amount, 0) + v_paid_amt)) IN (2.00, 8.00, 15.00))
                  THEN 'Paid'::public.payment_status
                WHEN (COALESCE(paid_amount, 0) + v_paid_amt) > 0 THEN 'Partial'::public.payment_status
                ELSE 'Pending'::public.payment_status
              END,
              payment_reference = COALESCE(v_payment_ref, payment_reference),
              updated_at        = now()
          WHERE id = v_payable_id;

        ELSIF v_target_table = 'mutual_fund_payables' THEN
          SELECT payment_status::text INTO v_current_status FROM public.mutual_fund_payables WHERE id = v_payable_id;
          IF v_current_status = 'Paid' AND v_paid_amt >= (SELECT net_payable FROM public.mutual_fund_payables WHERE id = v_payable_id) - 0.05 THEN
            v_already_paid := v_already_paid + 1;
          END IF;

          UPDATE public.mutual_fund_payables
          SET payment_date      = CURRENT_DATE,
              paid_amount       = LEAST(net_payable, COALESCE(paid_amount, 0) + v_paid_amt),
              remaining_amount  = GREATEST(0, net_payable - (COALESCE(paid_amount, 0) + v_paid_amt)),
              payment_status    = CASE
                WHEN GREATEST(0, net_payable - (COALESCE(paid_amount, 0) + v_paid_amt)) <= 0.05
                  OR (v_paid_amt >= 10 AND GREATEST(0, net_payable - (COALESCE(paid_amount, 0) + v_paid_amt)) IN (2.00, 8.00, 15.00))
                  THEN 'Paid'::public.payment_status
                WHEN (COALESCE(paid_amount, 0) + v_paid_amt) > 0 THEN 'Partial'::public.payment_status
                ELSE 'Pending'::public.payment_status
              END,
              payment_reference = COALESCE(v_payment_ref, payment_reference),
              updated_at        = now()
          WHERE id = v_payable_id;

        ELSE
          SELECT payment_status::text INTO v_current_status FROM public.interest_payables WHERE id = v_payable_id;
          IF v_current_status = 'Paid' AND v_paid_amt >= (SELECT net_payable FROM public.interest_payables WHERE id = v_payable_id) - 0.05 THEN
            v_already_paid := v_already_paid + 1;
          END IF;

          UPDATE public.interest_payables
          SET payment_date      = CURRENT_DATE,
              paid_amount       = LEAST(net_payable, COALESCE(paid_amount, 0) + v_paid_amt),
              remaining_amount  = GREATEST(0, net_payable - (COALESCE(paid_amount, 0) + v_paid_amt)),
              payment_status    = CASE
                WHEN GREATEST(0, net_payable - (COALESCE(paid_amount, 0) + v_paid_amt)) <= 0.05
                  OR (v_paid_amt >= 10 AND GREATEST(0, net_payable - (COALESCE(paid_amount, 0) + v_paid_amt)) IN (2.00, 8.00, 15.00))
                  THEN 'Paid'::public.payment_status
                WHEN (COALESCE(paid_amount, 0) + v_paid_amt) > 0 THEN 'Partial'::public.payment_status
                ELSE 'Pending'::public.payment_status
              END,
              payment_reference = COALESCE(v_payment_ref, payment_reference),
              updated_at        = now()
          WHERE id = v_payable_id;
        END IF;

        v_updated_payables := v_updated_payables + 1;
      END IF;

      -- Update the payments table
      IF v_payment_id IS NOT NULL THEN
        UPDATE public.payments
        SET status            = CASE
              WHEN v_paid_amt > 0 THEN 'Completed'
              ELSE 'Failed'
            END,
            paid_amount       = v_paid_amt,
            payment_date      = COALESCE(payment_date, CURRENT_DATE),
            payment_reference = COALESCE(v_payment_ref, payment_reference),
            remarks           = CASE
              WHEN v_result = 'MATCHED' THEN 'Reconciled via automated statement match'
              ELSE COALESCE(remarks, 'Reconciliation: ' || v_result)
            END,
            updated_at        = now()
        WHERE id = v_payment_id;

        v_updated_payments := v_updated_payments + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'item_id', v_item->>'id',
        'payable_id', v_item->>'payable_id',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'updated_payables', v_updated_payables,
    'updated_payments', v_updated_payments,
    'already_paid_skipped', v_already_paid,
    'errors', v_errors
  );
END;
$$;


--

-- Name: apply_share_conversion_atomic(uuid, text, text, numeric, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_share_conversion_atomic(p_company_id uuid, p_conversion_type text, p_fiscal_year text, p_ratio numeric, p_client_updates jsonb, p_fractional_payables jsonb DEFAULT '[]'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid;
  v_update record;
  v_clients_updated int := 0;
  v_payables_inserted int := 0;
BEGIN
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');
  v_uid := auth.uid();

  -- Verify company authorization
  IF current_user != 'service_role' AND p_company_id IS NOT NULL THEN
    IF NOT public.has_company_access(v_uid, p_company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to company % for share conversion', p_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 1. Apply client holdings and classification updates
  IF p_client_updates IS NOT NULL AND jsonb_array_length(p_client_updates) > 0 THEN
    FOR v_update IN
      SELECT
        (x->>'client_id')::uuid AS client_id,
        (x->>'kitta')::bigint AS kitta,
        (x->>'holder_type')::text AS holder_type,
        (x->>'boid')::text AS boid
      FROM jsonb_array_elements(p_client_updates) AS x
    LOOP
      UPDATE public.clients
      SET
        kitta = COALESCE(v_update.kitta, kitta),
        holder_type = COALESCE(NULLIF(v_update.holder_type, '')::public.holder_type, holder_type),
        boid = CASE
          WHEN v_update.boid IS NOT NULL AND trim(v_update.boid) <> '' THEN v_update.boid
          ELSE boid
        END,
        updated_at = NOW()
      WHERE id = v_update.client_id AND company_id = p_company_id;
      
      IF FOUND THEN
        v_clients_updated := v_clients_updated + 1;
      END IF;
    END LOOP;
  END IF;

  -- 2. Insert fractional payables if any exist
  IF p_fractional_payables IS NOT NULL AND jsonb_array_length(p_fractional_payables) > 0 THEN
    INSERT INTO public.dividend_payables (
      company_id,
      client_id,
      fiscal_year,
      dividend_type,
      shares_held,
      dividend_rate,
      gross_dividend,
      tax_amount,
      net_payable,
      payment_status,
      bank_name,
      bank_account_no,
      remarks,
      created_at,
      updated_at
    )
    SELECT
      p_company_id,
      (x->>'client_id')::uuid,
      p_fiscal_year,
      CASE 
        WHEN x->>'dividend_type' IN ('Cash', 'Bonus', 'Right', 'Stock') THEN (x->>'dividend_type')::public.dividend_type
        ELSE 'Cash'::public.dividend_type
      END,
      COALESCE((x->>'shares_held')::numeric, 0),
      COALESCE((x->>'dividend_rate')::numeric, p_ratio),
      COALESCE((x->>'gross_dividend')::numeric, 0),
      COALESCE((x->>'tax_amount')::numeric, 0),
      COALESCE((x->>'net_payable')::numeric, 0),
      'Pending'::public.payment_status,
      x->>'bank_name',
      x->>'bank_account_no',
      COALESCE(x->>'remarks', p_conversion_type || ' Fraction Cash'),
      NOW(),
      NOW()
    FROM jsonb_array_elements(p_fractional_payables) AS x;
    
    GET DIAGNOSTICS v_payables_inserted = ROW_COUNT;
  END IF;

  -- 3. Record audit log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    table_name,
    record_id,
    new_value
  ) VALUES (
    v_uid,
    'SHARE_CONVERSION',
    'clients',
    p_company_id::text,
    jsonb_build_object(
      'company_id', p_company_id,
      'conversion_type', p_conversion_type,
      'fiscal_year', p_fiscal_year,
      'ratio', p_ratio,
      'clients_updated', v_clients_updated,
      'fractional_payables_inserted', v_payables_inserted
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'clients_updated', v_clients_updated,
    'fractional_payables_inserted', v_payables_inserted
  );
END;
$$;


--

-- Name: audit_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Bypass individual row audit if bulk operation flag is active
  IF current_setting('app.skip_audit', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO public.audit_logs(user_id, action, table_name, record_id, old_value, new_value)
  VALUES (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id::text, OLD.id::text),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;


--

-- Name: bulk_delete(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bulk_delete(p_table text, p_filters jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_allowed text[] := ARRAY[
    'dividend_payables','interest_payables','mutual_fund_payables',
    'payments','payment_batches','reconciliation_results','clients','companies','iaf_allocations'
  ];
  v_filters_array jsonb;
  v_cond text := '';
  v_clause text;
  v_filter jsonb;
  v_field text;
  v_value text;
  v_op text;
  v_count int;
BEGIN
  -- Authorization: only admins may bulk delete
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('success', false, 'deleted', 0, 'error', 'Not authorized to delete data.');
  END IF;

  -- Table whitelist
  IF NOT (p_table = ANY(v_allowed)) THEN
    RETURN jsonb_build_object('success', false, 'deleted', 0, 'error', 'Table not allowed for deletion: ' || p_table);
  END IF;

  -- Safely parse filters whether passed as JSONB array or JSON string
  IF jsonb_typeof(p_filters) = 'string' THEN
    BEGIN
      v_filters_array := (p_filters #>> '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      v_filters_array := '[]'::jsonb;
    END;
  ELSE
    v_filters_array := COALESCE(p_filters, '[]'::jsonb);
  END IF;

  -- Build WHERE from supplied filters with a safe operator whitelist
  FOR v_filter IN SELECT * FROM jsonb_array_elements(v_filters_array)
  LOOP
    v_field := v_filter->>'field';
    v_value := v_filter->>'value';
    v_op := COALESCE(v_filter->>'op', 'eq');
    IF v_field IS NULL OR v_value IS NULL OR v_op NOT IN ('eq','neq','gt','gte','lt','lte') THEN
      RETURN jsonb_build_object('success', false, 'deleted', 0, 'error', 'Invalid filter supplied to bulk_delete');
    END IF;
    v_clause := CASE v_op
      WHEN 'eq'  THEN format('%I = %L',  v_field, v_value)
      WHEN 'neq' THEN format('%I <> %L', v_field, v_value)
      WHEN 'gt'  THEN format('%I > %L',  v_field, v_value)
      WHEN 'gte' THEN format('%I >= %L', v_field, v_value)
      WHEN 'lt'  THEN format('%I < %L',  v_field, v_value)
      WHEN 'lte' THEN format('%I <= %L', v_field, v_value)
    END;
    IF v_cond = '' THEN v_cond := ' WHERE ' || v_clause; ELSE v_cond := v_cond || ' AND ' || v_clause; END IF;
  END LOOP;

  -- Refuse full-table deletes except an explicit admin purge of clients
  IF v_cond = '' AND p_table <> 'clients' THEN
    RETURN jsonb_build_object('success', false, 'deleted', 0, 'error', 'A filter is required to prevent full-table deletion.');
  END IF;

  EXECUTE format('SELECT COUNT(*) FROM %I %s', p_table, v_cond) INTO v_count;
  IF v_count = 0 THEN
    RETURN jsonb_build_object('success', true, 'deleted', 0);
  END IF;

  EXECUTE format('DELETE FROM %I %s', p_table, v_cond);

  -- Audit log
  BEGIN
    INSERT INTO public.audit_logs(user_id, action, table_name, record_id, old_value)
    VALUES (auth.uid(), 'bulk_delete', p_table, NULL,
            jsonb_build_object('rows_deleted', v_count, 'filters', p_filters));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true, 'deleted', v_count);
END;
$$;


--

-- Name: bulk_insert_clients(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.bulk_insert_clients(p_clients jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_client jsonb;
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_holder_type public.holder_type;
  v_residency public.residency_type;
  v_status public.record_status;
  v_verification public.verification_status;
  v_company_id uuid;
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := COALESCE(
      auth.jwt() ->> 'role',
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF COALESCE(v_jwt_role, '') != 'service_role' 
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_clients) item
      WHERE (item->>'company_id') IS NOT NULL AND (item->>'company_id') != ''
        AND NOT public.has_company_access(auth.uid(), (item->>'company_id')::uuid)
    ) THEN
      RAISE EXCEPTION 'Unauthorized: caller does not have access to one or more companies in client payload' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_client IN SELECT * FROM jsonb_array_elements(p_clients)
  LOOP
    BEGIN
      v_company_id := NULLIF(v_client->>'company_id', '')::uuid;

      IF v_client->>'holder_type' IN (
        'Natural Person - Public', 'Natural Person - Promoter',
        'Legal Person', 'Mutual Fund', 'Foreign', 'Tax Exempt',
        'Public', 'Promoter', 'Institution'
      ) THEN
        v_holder_type := (v_client->>'holder_type')::public.holder_type;
      ELSIF v_client->>'holder_type' ILIKE '%promoter%' THEN
        v_holder_type := 'Natural Person - Promoter'::public.holder_type;
      ELSIF v_client->>'holder_type' ILIKE '%institution%' OR v_client->>'holder_type' ILIKE '%legal%' THEN
        v_holder_type := 'Legal Person'::public.holder_type;
      ELSIF v_client->>'holder_type' ILIKE '%fund%' THEN
        v_holder_type := 'Mutual Fund'::public.holder_type;
      ELSIF v_client->>'holder_type' ILIKE '%foreign%' THEN
        v_holder_type := 'Foreign'::public.holder_type;
      ELSIF v_client->>'holder_type' ILIKE '%exempt%' THEN
        v_holder_type := 'Tax Exempt'::public.holder_type;
      ELSIF NULLIF(BTRIM(COALESCE(v_client->>'holder_type', '')), '') IS NULL THEN
        -- Unknown holder type must stay NULL so the classifier's REVIEW_REQUIRED verdict is kept.
        v_holder_type := NULL;
      ELSE
        v_holder_type := 'Natural Person - Public'::public.holder_type;
      END IF;

      IF v_client->>'residency' IN ('Resident', 'Non-Resident') THEN
        v_residency := (v_client->>'residency')::public.residency_type;
      ELSIF v_client->>'residency' ILIKE '%non%' OR v_client->>'residency' ILIKE '%foreign%' THEN
        v_residency := 'Non-Resident'::public.residency_type;
      ELSE
        v_residency := 'Resident'::public.residency_type;
      END IF;

      IF v_client->>'status' IN ('Active', 'Inactive', 'Merged', 'Suspended') THEN
        v_status := (v_client->>'status')::public.record_status;
      ELSE
        v_status := 'Active'::public.record_status;
      END IF;

      IF v_client->>'verification_status' IN ('Verified', 'Pending', 'Rejected') THEN
        v_verification := (v_client->>'verification_status')::public.verification_status;
      ELSE
        v_verification := 'Pending'::public.verification_status;
      END IF;

      INSERT INTO public.clients (
        company_id, client_code, client_id, full_name, father_name,
        grandfather_name, pan_or_citizenship, pan_no, citizenship_no,
        nid_number, date_of_birth, gender, occupation, address,
        province, district, municipality, phone, email, bank_name,
        bank_branch, bank_account_no, bank_code, account_type,
        boid, residency, holder_type, status, verification_status,
        payee_classification, payee_segment, classification_status,
        classification_source, kitta
      ) VALUES (
        v_company_id,
        v_client->>'client_code',
        v_client->>'client_id',
        COALESCE(NULLIF(v_client->>'full_name', ''), 'Unknown Client'),
        v_client->>'father_name',
        v_client->>'grandfather_name',
        v_client->>'pan_or_citizenship',
        v_client->>'pan_no',
        v_client->>'citizenship_no',
        v_client->>'nid_number',
        v_client->>'date_of_birth',
        v_client->>'gender',
        v_client->>'occupation',
        v_client->>'address',
        v_client->>'province',
        v_client->>'district',
        v_client->>'municipality',
        v_client->>'phone',
        v_client->>'email',
        v_client->>'bank_name',
        v_client->>'bank_branch',
        v_client->>'bank_account_no',
        v_client->>'bank_code',
        v_client->>'account_type',
        v_client->>'boid',
        v_residency,
        v_holder_type,
        v_status,
        v_verification,
        COALESCE(NULLIF(v_client->>'payee_classification', ''), 'UNCLASSIFIED'),
        NULLIF(v_client->>'payee_segment', ''),
        COALESCE(NULLIF(v_client->>'classification_status', ''), 'AUTO_CLASSIFIED'),
        COALESCE(NULLIF(v_client->>'classification_source', ''), 'SYSTEM'),
        COALESCE((v_client->>'kitta')::numeric, 0)
      )
      ON CONFLICT (company_id, boid) DO UPDATE SET
        full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), clients.full_name),
        father_name = COALESCE(NULLIF(EXCLUDED.father_name, ''), clients.father_name),
        grandfather_name = COALESCE(NULLIF(EXCLUDED.grandfather_name, ''), clients.grandfather_name),
        pan_or_citizenship = COALESCE(NULLIF(EXCLUDED.pan_or_citizenship, ''), clients.pan_or_citizenship),
        pan_no = COALESCE(NULLIF(EXCLUDED.pan_no, ''), clients.pan_no),
        citizenship_no = COALESCE(NULLIF(EXCLUDED.citizenship_no, ''), clients.citizenship_no),
        nid_number = COALESCE(NULLIF(EXCLUDED.nid_number, ''), clients.nid_number),
        date_of_birth = COALESCE(NULLIF(EXCLUDED.date_of_birth, ''), clients.date_of_birth),
        gender = COALESCE(NULLIF(EXCLUDED.gender, ''), clients.gender),
        occupation = COALESCE(NULLIF(EXCLUDED.occupation, ''), clients.occupation),
        address = COALESCE(NULLIF(EXCLUDED.address, ''), clients.address),
        province = COALESCE(NULLIF(EXCLUDED.province, ''), clients.province),
        district = COALESCE(NULLIF(EXCLUDED.district, ''), clients.district),
        municipality = COALESCE(NULLIF(EXCLUDED.municipality, ''), clients.municipality),
        phone = COALESCE(NULLIF(EXCLUDED.phone, ''), clients.phone),
        email = COALESCE(NULLIF(EXCLUDED.email, ''), clients.email),
        bank_name = COALESCE(NULLIF(EXCLUDED.bank_name, ''), clients.bank_name),
        bank_branch = COALESCE(NULLIF(EXCLUDED.bank_branch, ''), clients.bank_branch),
        bank_account_no = COALESCE(NULLIF(EXCLUDED.bank_account_no, ''), clients.bank_account_no),
        bank_code = COALESCE(NULLIF(EXCLUDED.bank_code, ''), clients.bank_code),
        account_type = COALESCE(NULLIF(EXCLUDED.account_type, ''), clients.account_type),
        holder_type = CASE
          WHEN clients.classification_status = 'CONFIRMED' THEN clients.holder_type
          WHEN EXCLUDED.classification_status = 'REVIEW_REQUIRED' AND EXCLUDED.payee_classification = 'UNCLASSIFIED' THEN EXCLUDED.holder_type
          ELSE COALESCE(EXCLUDED.holder_type, clients.holder_type)
        END,
        payee_classification = CASE 
          WHEN clients.classification_status = 'CONFIRMED' THEN clients.payee_classification 
          WHEN EXCLUDED.classification_status = 'REVIEW_REQUIRED' AND EXCLUDED.payee_classification = 'UNCLASSIFIED' THEN 'UNCLASSIFIED'
          ELSE COALESCE(NULLIF(EXCLUDED.payee_classification, 'UNCLASSIFIED'), clients.payee_classification) 
        END,
        payee_segment = CASE 
          WHEN clients.classification_status = 'CONFIRMED' THEN clients.payee_segment 
          ELSE COALESCE(EXCLUDED.payee_segment, clients.payee_segment) 
        END,
        classification_status = CASE 
          WHEN clients.classification_status = 'CONFIRMED' THEN 'CONFIRMED' 
          ELSE COALESCE(EXCLUDED.classification_status, clients.classification_status) 
        END,
        classification_source = CASE
          WHEN clients.classification_status = 'CONFIRMED' THEN clients.classification_source
          ELSE COALESCE(EXCLUDED.classification_source, clients.classification_source)
        END;

      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'boid', v_client->>'boid',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'inserted', v_inserted, 'errors', v_errors);
END;
$$;


--

-- Name: bulk_insert_dividend_payables(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bulk_insert_dividend_payables(p_payables jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '60s'
    AS $$
DECLARE
  v_payable jsonb;
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := COALESCE(
      auth.jwt() ->> 'role',
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF COALESCE(v_jwt_role, '') != 'service_role' 
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payables) item
      WHERE (item->>'company_id') IS NOT NULL AND (item->>'company_id') != ''
        AND NOT public.has_company_access(auth.uid(), (item->>'company_id')::uuid)
    ) THEN
      RAISE EXCEPTION 'Unauthorized: caller does not have access to one or more companies in dividend payload' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      INSERT INTO public.dividend_payables (
        upload_id, company_id, client_id, shares_held,
        dividend_rate, bonus_rate, gross_dividend, tax_amount,
        net_payable, payment_status, payment_date, payment_reference,
        bonus_actual, bonus_issued, bonus_fraction, after_bonus_kitta,
        bonus_tax, bank_name, bank_account_no, bank_branch, lot_name,
        fiscal_year, tds_rate, remarks, payee_classification, payee_segment,
        classification_status, paid_amount, remaining_amount
      ) VALUES (
        (v_payable->>'upload_id')::uuid,
        (v_payable->>'company_id')::uuid,
        (v_payable->>'client_id')::uuid,
        COALESCE(NULLIF(v_payable->>'shares_held', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'dividend_rate', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'bonus_rate', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'gross_dividend', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'tax_amount', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'net_payable', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'payment_status', '')::public.payment_status, 'Pending'),
        COALESCE(NULLIF(v_payable->>'payment_date', '')::date, NULL),
        v_payable->>'payment_reference',
        NULLIF(v_payable->>'bonus_actual', '')::numeric,
        NULLIF(v_payable->>'bonus_issued', '')::numeric,
        NULLIF(v_payable->>'bonus_fraction', '')::numeric,
        NULLIF(v_payable->>'after_bonus_kitta', '')::numeric,
        NULLIF(v_payable->>'bonus_tax', '')::numeric,
        v_payable->>'bank_name',
        v_payable->>'bank_account_no',
        v_payable->>'bank_branch',
        v_payable->>'lot_name',
        v_payable->>'fiscal_year',
        COALESCE(NULLIF(v_payable->>'tds_rate', '')::numeric, NULL),
        v_payable->>'remarks',
        COALESCE(NULLIF(v_payable->>'payee_classification', ''), 'UNCLASSIFIED'),
        NULLIF(v_payable->>'payee_segment', ''),
        COALESCE(NULLIF(v_payable->>'classification_status', ''), 'AUTO_CLASSIFIED'),
        COALESCE(NULLIF(v_payable->>'paid_amount', '')::numeric, 0),
        COALESCE(
          NULLIF(v_payable->>'remaining_amount', '')::numeric,
          NULLIF(v_payable->>'net_payable', '')::numeric,
          0
        )
      )
      ON CONFLICT (client_id, company_id, fiscal_year, COALESCE(remarks, '')) DO UPDATE SET
        shares_held = COALESCE(EXCLUDED.shares_held, dividend_payables.shares_held),
        dividend_rate = COALESCE(EXCLUDED.dividend_rate, dividend_payables.dividend_rate),
        bonus_rate = COALESCE(EXCLUDED.bonus_rate, dividend_payables.bonus_rate),
        gross_dividend = EXCLUDED.gross_dividend,
        tax_amount = EXCLUDED.tax_amount,
        net_payable = EXCLUDED.net_payable,
        remaining_amount = CASE 
          WHEN dividend_payables.payment_status = 'Pending' THEN EXCLUDED.net_payable 
          ELSE dividend_payables.remaining_amount 
        END,
        bonus_actual = COALESCE(EXCLUDED.bonus_actual, dividend_payables.bonus_actual),
        bonus_issued = COALESCE(EXCLUDED.bonus_issued, dividend_payables.bonus_issued),
        bonus_fraction = COALESCE(EXCLUDED.bonus_fraction, dividend_payables.bonus_fraction),
        after_bonus_kitta = COALESCE(EXCLUDED.after_bonus_kitta, dividend_payables.after_bonus_kitta),
        bonus_tax = COALESCE(EXCLUDED.bonus_tax, dividend_payables.bonus_tax),
        bank_name = COALESCE(EXCLUDED.bank_name, dividend_payables.bank_name),
        bank_account_no = COALESCE(EXCLUDED.bank_account_no, dividend_payables.bank_account_no),
        bank_branch = COALESCE(EXCLUDED.bank_branch, dividend_payables.bank_branch),
        lot_name = COALESCE(EXCLUDED.lot_name, dividend_payables.lot_name),
        tds_rate = COALESCE(EXCLUDED.tds_rate, dividend_payables.tds_rate),
        payee_classification = CASE 
          WHEN dividend_payables.classification_status = 'OVERRIDDEN' THEN dividend_payables.payee_classification 
          ELSE COALESCE(NULLIF(EXCLUDED.payee_classification, 'UNCLASSIFIED'), dividend_payables.payee_classification) 
        END,
        payee_segment = CASE 
          WHEN dividend_payables.classification_status = 'OVERRIDDEN' THEN dividend_payables.payee_segment 
          ELSE COALESCE(EXCLUDED.payee_segment, dividend_payables.payee_segment) 
        END,
        updated_at = now();

      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'client_id', v_payable->>'client_id',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'inserted', v_inserted, 'errors', v_errors);
END;
$$;


--

-- Name: bulk_insert_interest_payables(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bulk_insert_interest_payables(p_payables jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '60s'
    AS $$
DECLARE
  v_payable jsonb;
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := COALESCE(
      auth.jwt() ->> 'role',
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF COALESCE(v_jwt_role, '') != 'service_role' 
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payables) item
      WHERE (item->>'company_id') IS NOT NULL AND (item->>'company_id') != ''
        AND NOT public.has_company_access(auth.uid(), (item->>'company_id')::uuid)
    ) THEN
      RAISE EXCEPTION 'Unauthorized: caller does not have access to one or more companies in interest payload' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      INSERT INTO public.interest_payables (
        upload_id, company_id, client_id, instrument_ref, gross_interest,
        tax_amount, net_payable, due_date, payment_status, payment_date,
        payment_reference, fiscal_year, tds_rate, bank_name, bank_account_no,
        bank_branch, lot_name, remarks, payee_classification, payee_segment,
        classification_status, shares_held, kitta, days_count,
        paid_amount, remaining_amount
      ) VALUES (
        (v_payable->>'upload_id')::uuid,
        (v_payable->>'company_id')::uuid,
        (v_payable->>'client_id')::uuid,
        v_payable->>'instrument_ref',
        COALESCE(NULLIF(v_payable->>'gross_interest', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'tax_amount', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'net_payable', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'due_date', '')::date, CURRENT_DATE),
        COALESCE(NULLIF(v_payable->>'payment_status', '')::public.payment_status, 'Pending'),
        COALESCE(NULLIF(v_payable->>'payment_date', '')::date, NULL),
        v_payable->>'payment_reference',
        v_payable->>'fiscal_year',
        COALESCE(NULLIF(v_payable->>'tds_rate', '')::numeric, NULL),
        v_payable->>'bank_name',
        v_payable->>'bank_account_no',
        v_payable->>'bank_branch',
        v_payable->>'lot_name',
        v_payable->>'remarks',
        COALESCE(NULLIF(v_payable->>'payee_classification', ''), 'UNCLASSIFIED'),
        NULLIF(v_payable->>'payee_segment', ''),
        COALESCE(NULLIF(v_payable->>'classification_status', ''), 'AUTO_CLASSIFIED'),
        COALESCE(NULLIF(v_payable->>'shares_held', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'kitta', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'days_count', '')::numeric, 183),
        COALESCE(NULLIF(v_payable->>'paid_amount', '')::numeric, 0),
        COALESCE(
          NULLIF(v_payable->>'remaining_amount', '')::numeric,
          NULLIF(v_payable->>'net_payable', '')::numeric,
          0
        )
      )
      ON CONFLICT (client_id, company_id, fiscal_year, COALESCE(remarks, '')) DO UPDATE SET
        gross_interest = EXCLUDED.gross_interest,
        tax_amount = EXCLUDED.tax_amount,
        net_payable = EXCLUDED.net_payable,
        tds_rate = COALESCE(EXCLUDED.tds_rate, interest_payables.tds_rate),
        shares_held = COALESCE(EXCLUDED.shares_held, interest_payables.shares_held),
        kitta = COALESCE(EXCLUDED.kitta, interest_payables.kitta),
        days_count = COALESCE(EXCLUDED.days_count, interest_payables.days_count),
        remaining_amount = CASE 
          WHEN interest_payables.payment_status = 'Pending' THEN EXCLUDED.net_payable 
          ELSE interest_payables.remaining_amount 
        END,
        bank_name = COALESCE(EXCLUDED.bank_name, interest_payables.bank_name),
        bank_account_no = COALESCE(EXCLUDED.bank_account_no, interest_payables.bank_account_no),
        bank_branch = COALESCE(EXCLUDED.bank_branch, interest_payables.bank_branch),
        payee_classification = CASE 
          WHEN interest_payables.classification_status = 'OVERRIDDEN' THEN interest_payables.payee_classification 
          ELSE COALESCE(NULLIF(EXCLUDED.payee_classification, 'UNCLASSIFIED'), interest_payables.payee_classification) 
        END,
        payee_segment = CASE 
          WHEN interest_payables.classification_status = 'OVERRIDDEN' THEN interest_payables.payee_segment 
          ELSE COALESCE(EXCLUDED.payee_segment, interest_payables.payee_segment) 
        END,
        updated_at = now();

      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'client_id', v_payable->>'client_id',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'inserted', v_inserted, 'errors', v_errors);
END;
$$;


--

-- Name: bulk_insert_mutual_fund_payables(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bulk_insert_mutual_fund_payables(p_payables jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '60s'
    AS $$
DECLARE
  v_payable jsonb;
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := COALESCE(
      auth.jwt() ->> 'role',
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF COALESCE(v_jwt_role, '') != 'service_role' 
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payables) item
      WHERE (item->>'company_id') IS NOT NULL AND (item->>'company_id') != ''
        AND NOT public.has_company_access(auth.uid(), (item->>'company_id')::uuid)
    ) THEN
      RAISE EXCEPTION 'Unauthorized: caller does not have access to one or more companies in mutual fund payload' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      INSERT INTO public.mutual_fund_payables (
        upload_id, company_id, client_id, shares_held, dividend_rate,
        dividend_type, gross_dividend, tax_amount, net_payable,
        payment_status, payment_date, payment_reference, bonus_actual,
        bonus_issued, bonus_fraction, after_bonus_kitta, bonus_tax,
        bank_name, bank_account_no, bank_branch, lot_name, fiscal_year,
        tds_rate, remarks, payee_classification, payee_segment,
        classification_status, paid_amount, remaining_amount
      ) VALUES (
        (v_payable->>'upload_id')::uuid,
        (v_payable->>'company_id')::uuid,
        (v_payable->>'client_id')::uuid,
        COALESCE(NULLIF(v_payable->>'shares_held', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'dividend_rate', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'dividend_type', '')::public.dividend_type, 'Cash'),
        COALESCE(NULLIF(v_payable->>'gross_dividend', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'tax_amount', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'net_payable', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'payment_status', '')::public.payment_status, 'Pending'),
        COALESCE(NULLIF(v_payable->>'payment_date', '')::date, NULL),
        v_payable->>'payment_reference',
        NULLIF(v_payable->>'bonus_actual', '')::numeric,
        NULLIF(v_payable->>'bonus_issued', '')::numeric,
        NULLIF(v_payable->>'bonus_fraction', '')::numeric,
        NULLIF(v_payable->>'after_bonus_kitta', '')::numeric,
        NULLIF(v_payable->>'bonus_tax', '')::numeric,
        v_payable->>'bank_name',
        v_payable->>'bank_account_no',
        v_payable->>'bank_branch',
        v_payable->>'lot_name',
        v_payable->>'fiscal_year',
        COALESCE(NULLIF(v_payable->>'tds_rate', '')::numeric, NULL),
        v_payable->>'remarks',
        COALESCE(NULLIF(v_payable->>'payee_classification', ''), 'UNCLASSIFIED'),
        NULLIF(v_payable->>'payee_segment', ''),
        COALESCE(NULLIF(v_payable->>'classification_status', ''), 'AUTO_CLASSIFIED'),
        COALESCE(NULLIF(v_payable->>'paid_amount', '')::numeric, 0),
        COALESCE(
          NULLIF(v_payable->>'remaining_amount', '')::numeric,
          NULLIF(v_payable->>'net_payable', '')::numeric,
          0
        )
      )
      ON CONFLICT (client_id, company_id, fiscal_year, COALESCE(remarks, '')) DO UPDATE SET
        shares_held = COALESCE(EXCLUDED.shares_held, mutual_fund_payables.shares_held),
        dividend_rate = COALESCE(EXCLUDED.dividend_rate, mutual_fund_payables.dividend_rate),
        dividend_type = COALESCE(EXCLUDED.dividend_type, mutual_fund_payables.dividend_type),
        gross_dividend = EXCLUDED.gross_dividend,
        tax_amount = EXCLUDED.tax_amount,
        net_payable = EXCLUDED.net_payable,
        remaining_amount = CASE 
          WHEN mutual_fund_payables.payment_status = 'Pending' THEN EXCLUDED.net_payable 
          ELSE mutual_fund_payables.remaining_amount 
        END,
        bonus_actual = COALESCE(EXCLUDED.bonus_actual, mutual_fund_payables.bonus_actual),
        bonus_issued = COALESCE(EXCLUDED.bonus_issued, mutual_fund_payables.bonus_issued),
        bonus_fraction = COALESCE(EXCLUDED.bonus_fraction, mutual_fund_payables.bonus_fraction),
        after_bonus_kitta = COALESCE(EXCLUDED.after_bonus_kitta, mutual_fund_payables.after_bonus_kitta),
        bonus_tax = COALESCE(EXCLUDED.bonus_tax, mutual_fund_payables.bonus_tax),
        bank_name = COALESCE(EXCLUDED.bank_name, mutual_fund_payables.bank_name),
        bank_account_no = COALESCE(EXCLUDED.bank_account_no, mutual_fund_payables.bank_account_no),
        bank_branch = COALESCE(EXCLUDED.bank_branch, mutual_fund_payables.bank_branch),
        lot_name = COALESCE(EXCLUDED.lot_name, mutual_fund_payables.lot_name),
        tds_rate = COALESCE(EXCLUDED.tds_rate, mutual_fund_payables.tds_rate),
        payee_classification = CASE 
          WHEN mutual_fund_payables.classification_status = 'OVERRIDDEN' THEN mutual_fund_payables.payee_classification 
          ELSE COALESCE(NULLIF(EXCLUDED.payee_classification, 'UNCLASSIFIED'), mutual_fund_payables.payee_classification) 
        END,
        payee_segment = CASE 
          WHEN mutual_fund_payables.classification_status = 'OVERRIDDEN' THEN mutual_fund_payables.payee_segment 
          ELSE COALESCE(EXCLUDED.payee_segment, mutual_fund_payables.payee_segment) 
        END,
        updated_at = now();

      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'client_id', v_payable->>'client_id',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'inserted', v_inserted, 'errors', v_errors);
END;
$$;


--

-- Name: bulk_upsert_company(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bulk_upsert_company(p_company_name text, p_company_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_company_id uuid;
BEGIN
  -- Try to find existing company by name
  SELECT id INTO v_company_id FROM public.companies
  WHERE company_name ILIKE '%' || p_company_name || '%'
  LIMIT 1;

  -- If not found, create it
  IF v_company_id IS NULL THEN
    INSERT INTO public.companies (company_name, company_code, status)
    VALUES (p_company_name, p_company_code, 'Active')
    ON CONFLICT (company_code) DO UPDATE SET company_name = EXCLUDED.company_name
    RETURNING id INTO v_company_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'company_id', v_company_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


--

-- Name: bulk_upsert_company(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bulk_upsert_company(p_company_name text, p_company_code text, p_isin text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_company_id uuid;
  v_clean_isin text := NULLIF(trim(COALESCE(p_isin, '')), '');
  v_clean_name text := trim(p_company_name);
  v_clean_code text := trim(p_company_code);
  v_default_face_value numeric := 100;
BEGIN
  -- Determine default face value based on name/code
  IF (v_clean_name ILIKE '%debenture%' OR v_clean_code ILIKE '%d%') THEN
    v_default_face_value := 1000;
  ELSIF (v_clean_name ILIKE '%mutual fund%' OR v_clean_code ILIKE '%rmf%') THEN
    v_default_face_value := 10;
  END IF;

  -- 1. Try to find existing company by ISIN (if provided)
  IF v_clean_isin IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies
    WHERE isin = v_clean_isin
    LIMIT 1;
  END IF;

  -- 2. If not found by ISIN, try by exact company_code
  IF v_company_id IS NULL AND v_clean_code <> '' THEN
    SELECT id INTO v_company_id FROM public.companies
    WHERE company_code = v_clean_code
    LIMIT 1;
  END IF;

  -- 3. If not found, try to find existing company by name match
  IF v_company_id IS NULL THEN
    SELECT id INTO v_company_id FROM public.companies
    WHERE company_name ILIKE '%' || v_clean_name || '%'
       OR v_clean_name ILIKE '%' || company_name || '%'
    LIMIT 1;
  END IF;

  -- 4. If found, update its ISIN if company currently doesn't have one and v_clean_isin is provided
  IF v_company_id IS NOT NULL THEN
    IF v_clean_isin IS NOT NULL THEN
      UPDATE public.companies
      SET isin = COALESCE(isin, v_clean_isin)
      WHERE id = v_company_id AND (isin IS NULL OR isin = '');
    END IF;
  ELSE
    -- 5. If not found, create new company with defaults
    INSERT INTO public.companies (
      company_name,
      company_code,
      isin,
      face_value,
      registrar,
      status
    )
    VALUES (
      v_clean_name,
      v_clean_code,
      v_clean_isin,
      v_default_face_value,
      'RBB Merchant Banking Limited',
      'Active'
    )
    ON CONFLICT (company_code) DO UPDATE SET 
      company_name = EXCLUDED.company_name,
      isin = COALESCE(public.companies.isin, EXCLUDED.isin),
      face_value = COALESCE(public.companies.face_value, EXCLUDED.face_value),
      registrar = COALESCE(public.companies.registrar, EXCLUDED.registrar)
    RETURNING id INTO v_company_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'company_id', v_company_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


--

-- Name: calc_net_dividend(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calc_net_dividend() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
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


--

-- Name: calc_net_payable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calc_net_payable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.net_payable = COALESCE(NEW.gross_interest, 0) - COALESCE(NEW.tax_amount, 0);
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--

-- Name: claim_agm_broker_pool(uuid, bigint, text, text, text, text, text, text, numeric, numeric, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_agm_broker_pool(p_company_id uuid, p_seq_no bigint, p_broker_code text, p_broker_name text, p_pool_boid text, p_claimant_boid text, p_claimant_name text, p_fiscal_year text, p_claimed_kitta numeric, p_claimed_cash numeric, p_contract_note_no text, p_trade_date_bs text, p_approved_by text DEFAULT 'Operator'::text, p_remarks text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--

-- Name: commit_agm_fiscal_year_import(uuid, text, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.commit_agm_fiscal_year_import(p_company_id uuid, p_fiscal_year text, p_batch_id uuid, p_event_name text, p_report jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--

-- Name: complete_payment_batch_atomic(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_payment_batch_atomic(p_batch_id uuid, p_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '60s'
    AS $$
DECLARE
  v_batch record;
  v_actor_id uuid;
  v_jwt_role text;
  v_today date := CURRENT_DATE;
  v_payments_updated int := 0;
  v_div_updated int := 0;
  v_int_updated int := 0;
  v_mf_updated int := 0;
BEGIN
  -- Extract caller JWT role
  BEGIN
    v_jwt_role := (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  -- Role check: admin, supervisor, or service_role
  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND current_user != 'postgres' THEN
    PERFORM public.require_role('admin', 'supervisor');
  END IF;

  v_actor_id := COALESCE(auth.uid(), p_user_id);

  -- 1. Fetch and lock payment batch
  SELECT * INTO v_batch
  FROM public.payment_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment batch with id % not found', p_batch_id;
  END IF;

  IF v_batch.status = 'Completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'batch_id', p_batch_id,
      'message', 'Batch is already completed'
    );
  END IF;

  -- 2. Verify company access if batch has company_id
  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND v_batch.company_id IS NOT NULL THEN
    IF v_actor_id IS NOT NULL THEN
      IF NOT public.has_company_access(v_actor_id, v_batch.company_id) THEN
        RAISE EXCEPTION 'Unauthorized: caller lacks access to company % for payment batch %', v_batch.company_id, p_batch_id USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- 3. Update payments belonging to this batch
  WITH updated_payments AS (
    UPDATE public.payments
    SET
      status = 'Completed',
      payment_date = COALESCE(payment_date, v_today),
      paid_amount = COALESCE(paid_amount, net_amount),
      updated_at = NOW()
    WHERE batch_id = p_batch_id
      AND status NOT IN ('Completed', 'Failed', 'Rejected', 'Reversed', 'Cancelled')
    RETURNING id, payable_id, payable_type
  )
  SELECT count(*) INTO v_payments_updated FROM updated_payments;

  -- 4. Update dividend_payables
  WITH div_matches AS (
    UPDATE public.dividend_payables dp
    SET
      paid_amount = LEAST(dp.net_payable, COALESCE(dp.paid_amount, 0) + COALESCE(p.paid_amount, p.net_amount, 0)),
      remaining_amount = GREATEST(0, dp.net_payable - (COALESCE(dp.paid_amount, 0) + COALESCE(p.paid_amount, p.net_amount, 0))),
      payment_status = CASE
        WHEN (dp.net_payable - (COALESCE(dp.paid_amount, 0) + COALESCE(p.paid_amount, p.net_amount, 0))) <= 0.05 THEN 'Paid'::public.payment_status
        ELSE 'Partial'::public.payment_status
      END,
      payment_date = v_today,
      updated_at = NOW()
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.status = 'Completed'
      AND p.payable_type IN ('dividend', 'dividend_payables')
      AND dp.id = p.payable_id
    RETURNING dp.id
  )
  SELECT count(*) INTO v_div_updated FROM div_matches;

  -- 5. Update interest_payables
  WITH int_matches AS (
    UPDATE public.interest_payables ip
    SET
      paid_amount = LEAST(ip.net_payable, COALESCE(ip.paid_amount, 0) + COALESCE(p.paid_amount, p.net_amount, 0)),
      remaining_amount = GREATEST(0, ip.net_payable - (COALESCE(ip.paid_amount, 0) + COALESCE(p.paid_amount, p.net_amount, 0))),
      payment_status = CASE
        WHEN (ip.net_payable - (COALESCE(ip.paid_amount, 0) + COALESCE(p.paid_amount, p.net_amount, 0))) <= 0.05 THEN 'Paid'::public.payment_status
        ELSE 'Partial'::public.payment_status
      END,
      payment_date = v_today,
      updated_at = NOW()
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.status = 'Completed'
      AND p.payable_type IN ('interest', 'interest_payables')
      AND ip.id = p.payable_id
    RETURNING ip.id
  )
  SELECT count(*) INTO v_int_updated FROM int_matches;

  -- 6. Update mutual_fund_payables (with multileg paid/remaining support)
  WITH mf_matches AS (
    UPDATE public.mutual_fund_payables mp
    SET
      paid_amount = LEAST(mp.net_payable, COALESCE(mp.paid_amount, 0) + COALESCE(p.paid_amount, p.net_amount, 0)),
      remaining_amount = GREATEST(0, mp.net_payable - (COALESCE(mp.paid_amount, 0) + COALESCE(p.paid_amount, p.net_amount, 0))),
      payment_status = CASE
        WHEN (mp.net_payable - (COALESCE(mp.paid_amount, 0) + COALESCE(p.paid_amount, p.net_amount, 0))) <= 0.05 THEN 'Paid'::public.payment_status
        ELSE 'Partial'::public.payment_status
      END,
      payment_date = v_today,
      updated_at = NOW()
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.status = 'Completed'
      AND p.payable_type IN ('mutual_fund', 'mutual_fund_payables')
      AND mp.id = p.payable_id
    RETURNING mp.id
  )
  SELECT count(*) INTO v_mf_updated FROM mf_matches;

  -- 7. Update payment batch status to Completed
  UPDATE public.payment_batches
  SET
    status = 'Completed',
    processed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_batch_id;

  -- 8. Record audit log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    table_name,
    record_id,
    new_value
  ) VALUES (
    v_actor_id,
    'COMPLETE_BATCH',
    'payment_batches',
    p_batch_id,
    jsonb_build_object(
      'status', 'Completed',
      'payments_updated', v_payments_updated,
      'dividend_updated', v_div_updated,
      'interest_updated', v_int_updated,
      'mutual_fund_updated', v_mf_updated,
      'total_amount', v_batch.total_amount
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'payments_updated', v_payments_updated,
    'dividend_payables_updated', v_div_updated,
    'interest_payables_updated', v_int_updated,
    'mutual_fund_payables_updated', v_mf_updated
  );
END;
$$;


--

-- Name: create_payment_batch_atomic(text, uuid, text, text, text, text, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_payment_batch_atomic(p_batch_name text, p_company_id uuid DEFAULT NULL::uuid, p_fiscal_year text DEFAULT NULL::text, p_payable_type text DEFAULT 'all'::text, p_payment_method text DEFAULT 'ConnectIPS'::text, p_installment_tag text DEFAULT 'FULL'::text, p_cds_batch_ref text DEFAULT NULL::text, p_registrar text DEFAULT NULL::text, p_max_items integer DEFAULT 200000) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '120s'
    AS $$
DECLARE
  v_batch_id uuid;
  v_inserted_count bigint := 0;
  v_total_amount numeric := 0;
  v_total_tax numeric := 0;
  v_valid_payment_method public.payment_method;
  v_batch_record record;
BEGIN
  -- Disable individual row audit logging for this transaction to allow sub-second bulk insertion
  PERFORM set_config('app.skip_audit', 'on', true);

  IF p_batch_name IS NULL OR trim(p_batch_name) = '' THEN
    RAISE EXCEPTION 'Batch name is required.';
  END IF;

  -- Validate payment method cast
  BEGIN
    v_valid_payment_method := p_payment_method::public.payment_method;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid payment method: %', p_payment_method USING ERRCODE = '22023';
  END;

  -- 1. Create the Batch Header
  INSERT INTO public.payment_batches (
    batch_name,
    company_id,
    fiscal_year,
    payable_type,
    payment_method,
    status,
    total_payments,
    total_amount,
    total_tax,
    cds_batch_ref,
    registrar,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    trim(p_batch_name),
    p_company_id,
    p_fiscal_year,
    p_payable_type,
    p_payment_method,
    'Draft'::public.payment_batch_status,
    0,
    0,
    0,
    trim(p_cds_batch_ref),
    trim(p_registrar),
    auth.uid(),
    NOW(),
    NOW()
  ) RETURNING id INTO v_batch_id;

  -- 2. Populate Line Items from Mutual Fund Payables
  IF p_payable_type IS NULL OR p_payable_type = 'all' OR p_payable_type = 'mutual_fund' THEN
    INSERT INTO public.payments (
      batch_id,
      company_id,
      client_id,
      payable_type,
      payable_id,
      gross_amount,
      tax_amount,
      net_amount,
      paid_amount,
      payment_method,
      status,
      bank_name,
      bank_account_no,
      remarks,
      created_by,
      created_at,
      updated_at
    )
    SELECT
      v_batch_id,
      mf.company_id,
      mf.client_id,
      'mutual_fund',
      mf.id,
      GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) + CASE WHEN COALESCE(mf.net_payable,0) > 0 THEN round(COALESCE(mf.tax_amount,0) * GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) / mf.net_payable, 2) ELSE 0 END, CASE WHEN COALESCE(mf.net_payable,0) > 0 THEN round(COALESCE(mf.tax_amount,0) * GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) / mf.net_payable, 2) ELSE 0 END, GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0), GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0),
      v_valid_payment_method,
      'Pending',
      COALESCE(NULLIF(c.bank_name,''), mf.bank_name),
      COALESCE(NULLIF(c.bank_account_no,''), mf.bank_account_no),
      CASE 
        WHEN p_installment_tag = 'SEMI_1' THEN '[Installment 1 (Poush)] ' || p_batch_name
        WHEN p_installment_tag = 'SEMI_2' THEN '[Installment 2 (Asar)] ' || p_batch_name
        WHEN p_installment_tag = 'INTERIM' THEN '[Interim Dividend] ' || p_batch_name
        WHEN p_installment_tag = 'FINAL' THEN '[Final Dividend] ' || p_batch_name
        ELSE '[' || p_batch_name || ']'
      END,
      auth.uid(),
      NOW(),
      NOW()
    FROM public.mutual_fund_payables mf
    LEFT JOIN public.clients c ON c.id = mf.client_id
    WHERE
      (p_company_id IS NULL OR mf.company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR mf.fiscal_year = p_fiscal_year)
      AND mf.payment_status IN ('Pending', 'Partial')
      AND GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) > 0
      AND mf.payee_classification <> 'UNCLASSIFIED'
      AND mf.classification_status <> 'REVIEW_REQUIRED'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payable_id = mf.id
          AND p.status IN ('Draft', 'Pending', 'Approved')
      )
    ORDER BY mf.id ASC
    LIMIT p_max_items;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  END IF;

  -- 3. Populate Line Items from Dividend Payables
  IF (p_payable_type = 'all' OR p_payable_type = 'dividend') AND (p_max_items - v_inserted_count > 0) THEN
    INSERT INTO public.payments (
      batch_id,
      company_id,
      client_id,
      payable_type,
      payable_id,
      gross_amount,
      tax_amount,
      net_amount,
      paid_amount,
      payment_method,
      status,
      bank_name,
      bank_account_no,
      remarks,
      created_by,
      created_at,
      updated_at
    )
    SELECT
      v_batch_id,
      dp.company_id,
      dp.client_id,
      'dividend',
      dp.id,
      GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) + CASE WHEN COALESCE(dp.net_payable,0) > 0 THEN round(COALESCE(dp.tax_amount,0) * GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) / dp.net_payable, 2) ELSE 0 END, CASE WHEN COALESCE(dp.net_payable,0) > 0 THEN round(COALESCE(dp.tax_amount,0) * GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) / dp.net_payable, 2) ELSE 0 END, GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0), GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0),
      v_valid_payment_method,
      'Pending',
      COALESCE(NULLIF(c.bank_name,''), dp.bank_name),
      COALESCE(NULLIF(c.bank_account_no,''), dp.bank_account_no),
      '[' || p_batch_name || ']',
      auth.uid(),
      NOW(),
      NOW()
    FROM public.dividend_payables dp
    LEFT JOIN public.clients c ON c.id = dp.client_id
    WHERE
      (p_company_id IS NULL OR dp.company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR dp.fiscal_year = p_fiscal_year)
      AND dp.payment_status IN ('Pending', 'Partial')
      AND GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) > 0
      AND dp.payee_classification <> 'UNCLASSIFIED'
      AND dp.classification_status <> 'REVIEW_REQUIRED'
      AND dp.payee_classification <> 'UNCLASSIFIED'
      AND dp.classification_status <> 'REVIEW_REQUIRED'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payable_id = dp.id
          AND p.status IN ('Draft', 'Pending', 'Approved')
      )
    ORDER BY dp.id ASC
    LIMIT (p_max_items - v_inserted_count);

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  END IF;

  -- 4. Populate Line Items from Interest Payables
  IF (p_payable_type = 'all' OR p_payable_type = 'interest') AND (p_max_items - v_inserted_count > 0) THEN
    INSERT INTO public.payments (
      batch_id,
      company_id,
      client_id,
      payable_type,
      payable_id,
      gross_amount,
      tax_amount,
      net_amount,
      paid_amount,
      payment_method,
      status,
      bank_name,
      bank_account_no,
      remarks,
      created_by,
      created_at,
      updated_at
    )
    SELECT
      v_batch_id,
      ip.company_id,
      ip.client_id,
      'interest',
      ip.id,
      GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0) + CASE WHEN COALESCE(ip.net_payable,0) > 0 THEN round(COALESCE(ip.tax_amount,0) * GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0) / ip.net_payable, 2) ELSE 0 END, CASE WHEN COALESCE(ip.net_payable,0) > 0 THEN round(COALESCE(ip.tax_amount,0) * GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0) / ip.net_payable, 2) ELSE 0 END, GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0), GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0),
      v_valid_payment_method,
      'Pending',
      COALESCE(NULLIF(c.bank_name,''), ip.bank_name),
      COALESCE(NULLIF(c.bank_account_no,''), ip.bank_account_no),
      '[' || p_batch_name || ']',
      auth.uid(),
      NOW(),
      NOW()
    FROM public.interest_payables ip
    LEFT JOIN public.clients c ON c.id = ip.client_id
    WHERE
      (p_company_id IS NULL OR ip.company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR ip.fiscal_year = p_fiscal_year)
      AND ip.payment_status IN ('Pending', 'Partial')
      AND GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0) > 0
      AND ip.payee_classification <> 'UNCLASSIFIED'
      AND ip.classification_status <> 'REVIEW_REQUIRED'
      AND ip.payee_classification <> 'UNCLASSIFIED'
      AND ip.classification_status <> 'REVIEW_REQUIRED'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payable_id = ip.id
          AND p.status IN ('Draft', 'Pending', 'Approved')
      )
    ORDER BY ip.id ASC
    LIMIT (p_max_items - v_inserted_count);
  END IF;

  -- 5. Calculate and Update Batch Header Totals
  SELECT
    COUNT(*),
    COALESCE(SUM(net_amount), 0),
    COALESCE(SUM(tax_amount), 0)
  INTO v_inserted_count, v_total_amount, v_total_tax
  FROM public.payments
  WHERE batch_id = v_batch_id;

  UPDATE public.payment_batches
  SET
    total_payments = v_inserted_count,
    total_amount = v_total_amount,
    total_tax = v_total_tax,
    updated_at = NOW()
  WHERE id = v_batch_id;

  -- Re-enable audit logging and record batch summary audit log
  PERFORM set_config('app.skip_audit', 'off', true);

  INSERT INTO public.audit_logs(user_id, action, table_name, record_id, new_value)
  VALUES (
    auth.uid(),
    'INSERT',
    'payment_batches',
    v_batch_id::text,
    jsonb_build_object(
      'batch_id', v_batch_id,
      'batch_name', p_batch_name,
      'total_payments', v_inserted_count,
      'total_amount', v_total_amount,
      'total_tax', v_total_tax
    )
  );

  SELECT * INTO v_batch_record FROM public.payment_batches WHERE id = v_batch_id;
  RETURN to_jsonb(v_batch_record);
END;
$$;


--

-- Name: delete_company_completely(uuid, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_company_completely(p_company_id uuid, p_delete_clients boolean DEFAULT true, p_delete_orphans boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_div_count int := 0;
  v_mf_count int := 0;
  v_int_count int := 0;
  v_pay_count int := 0;
  v_batch_count int := 0;
  v_recon_count int := 0;
  v_iaf_count int := 0;
  v_clients_count int := 0;
  v_orphans_count int := 0;
  v_company_count int := 0;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized.');
  END IF;

  -- 1. Payments
  DELETE FROM public.payments WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_pay_count = ROW_COUNT;
  IF v_pay_count > 0 THEN
    v_results := v_results || jsonb_build_object('table', 'payments', 'deleted', v_pay_count);
  END IF;

  -- 2. Payment batches
  DELETE FROM public.payment_batches WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_batch_count = ROW_COUNT;
  IF v_batch_count > 0 THEN
    v_results := v_results || jsonb_build_object('table', 'payment_batches', 'deleted', v_batch_count);
  END IF;

  -- 3. Reconciliation results
  DELETE FROM public.reconciliation_results WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_recon_count = ROW_COUNT;
  IF v_recon_count > 0 THEN
    v_results := v_results || jsonb_build_object('table', 'reconciliation_results', 'deleted', v_recon_count);
  END IF;

  -- 4. Dividend payables
  DELETE FROM public.dividend_payables WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_div_count = ROW_COUNT;
  IF v_div_count > 0 THEN
    v_results := v_results || jsonb_build_object('table', 'dividend_payables', 'deleted', v_div_count);
  END IF;

  -- 5. Mutual fund payables
  DELETE FROM public.mutual_fund_payables WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_mf_count = ROW_COUNT;
  IF v_mf_count > 0 THEN
    v_results := v_results || jsonb_build_object('table', 'mutual_fund_payables', 'deleted', v_mf_count);
  END IF;

  -- 6. Interest payables
  DELETE FROM public.interest_payables WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_int_count = ROW_COUNT;
  IF v_int_count > 0 THEN
    v_results := v_results || jsonb_build_object('table', 'interest_payables', 'deleted', v_int_count);
  END IF;

  -- 7. IAF Allocations
  DELETE FROM public.iaf_allocations WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_iaf_count = ROW_COUNT;
  IF v_iaf_count > 0 THEN
    v_results := v_results || jsonb_build_object('table', 'iaf_allocations', 'deleted', v_iaf_count);
  END IF;

  -- 8. Company clients if requested
  IF p_delete_clients THEN
    DELETE FROM public.clients WHERE company_id = p_company_id;
    GET DIAGNOSTICS v_clients_count = ROW_COUNT;
    IF v_clients_count > 0 THEN
      v_results := v_results || jsonb_build_object('table', 'clients', 'deleted', v_clients_count);
    END IF;
  END IF;

  -- 9. Delete the company record itself
  DELETE FROM public.companies WHERE id = p_company_id;
  GET DIAGNOSTICS v_company_count = ROW_COUNT;
  v_results := v_results || jsonb_build_object('table', 'companies', 'deleted', v_company_count);

  -- 10. Clean up orphan clients if requested
  IF p_delete_orphans OR p_delete_clients THEN
    DELETE FROM public.clients c
    WHERE NOT EXISTS (SELECT 1 FROM public.dividend_payables d WHERE d.client_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.interest_payables i WHERE i.client_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.mutual_fund_payables m WHERE m.client_id = c.id);
    GET DIAGNOSTICS v_orphans_count = ROW_COUNT;
    IF v_orphans_count > 0 THEN
      v_results := v_results || jsonb_build_object('table', 'clients (orphans)', 'deleted', v_orphans_count);
    END IF;
  END IF;

  -- Audit log
  BEGIN
    INSERT INTO public.audit_logs(user_id, action, table_name, record_id, old_value)
    VALUES (auth.uid(), 'delete_company_completely', 'companies', p_company_id::text,
            jsonb_build_object(
              'company_deleted', v_company_count,
              'dividends_deleted', v_div_count,
              'mutual_funds_deleted', v_mf_count,
              'interests_deleted', v_int_count,
              'clients_deleted', v_clients_count + v_orphans_count
            ));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true, 'results', v_results);
END;
$$;


--

-- Name: delete_orphan_clients(text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.delete_orphan_clients(p_company_id text DEFAULT NULL::text, p_fiscal_year text DEFAULT NULL::text, p_imported_after timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_orphans int := 0;
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := COALESCE(
      auth.jwt() ->> 'role',
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF COALESCE(v_jwt_role, '') != 'service_role' 
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');
  END IF;

  IF p_company_id IS NOT NULL AND NOT public.has_company_access(COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid), p_company_id::uuid) THEN
    RAISE EXCEPTION 'Access denied to company %', p_company_id;
  END IF;

  IF p_fiscal_year IS NOT NULL THEN
    NULL;
  END IF;

  DELETE FROM public.clients c
  WHERE (p_imported_after IS NULL OR c.created_at >= p_imported_after)
    AND NOT EXISTS (SELECT 1 FROM public.dividend_payables d WHERE d.client_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.interest_payables i WHERE i.client_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.mutual_fund_payables m WHERE m.client_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.client_id = c.id);

  GET DIAGNOSTICS v_orphans = ROW_COUNT;

  BEGIN
    INSERT INTO public.audit_logs(user_id, action, table_name, record_id, old_value)
    VALUES (auth.uid(), 'bulk_delete_orphans', 'clients', NULL,
            jsonb_build_object('deleted', v_orphans));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true, 'deleted', v_orphans);
END;
$$;


--

-- Name: disperse_agm_bulk_pools(uuid, text[], jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.disperse_agm_bulk_pools(p_company_id uuid, p_placeholder_boids text[], p_folio_records jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--

-- Name: enforce_interest_payable_tax_rates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_interest_payable_tax_rates() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Deprecated in favor of apply_payable_classification_and_tax() using authoritative payable_tax_rules
  RETURN NEW;
END;
$$;


--

-- Name: get_agm_dividend_summary(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_agm_dividend_summary(p_company_id uuid DEFAULT NULL::uuid, p_fiscal_year text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
WITH filtered AS (
  SELECT
    dp.shares_held,
    dp.dividend_rate,
    COALESCE(dp.gross_dividend, 0)       AS gross_dividend,
    COALESCE(dp.tax_amount, 0)           AS tax_amount,
    COALESCE(dp.net_payable, 0)          AS net_payable,
    COALESCE(dp.bonus_actual, 0)         AS bonus_actual,
    COALESCE(dp.bonus_issued, 0)         AS bonus_issued,
    COALESCE(dp.bonus_fraction, 0)       AS bonus_fraction,
    COALESCE(dp.after_bonus_kitta,
      dp.shares_held + COALESCE(dp.bonus_issued, 0)) AS after_bonus_kitta,
    COALESCE(dp.bonus_tax, 0)            AS bonus_tax,
    CASE
      WHEN UPPER(COALESCE(dp.payee_segment, '')) = 'PROMOTER'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%PROMOT%'
        THEN 'PROMOTER'
      WHEN UPPER(COALESCE(dp.payee_segment, '')) = 'LOCAL'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%LOCAL%'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%UNVERIFIED%'
        THEN 'LOCAL'
      WHEN UPPER(COALESCE(dp.payee_segment, '')) = 'EMPLOYEE'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%STAFF%'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%EMPLOYEE%'
        THEN 'EMPLOYEE'
      WHEN dp.payee_classification = 'TAX_EXEMPT'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%MUTUAL%'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%EXEMPT%'
        THEN 'MUTUAL FUND'
      WHEN dp.payee_classification = 'COMPANY_INSTITUTION'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%INSTITUT%'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%COMPANY%'
        THEN 'INSTITUTION'
      ELSE 'PUBLIC'
    END AS particular
  FROM public.dividend_payables dp
  WHERE (p_company_id IS NULL OR dp.company_id = p_company_id)
    AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR dp.fiscal_year = p_fiscal_year)
),
grand_totals AS (
  SELECT
    COALESCE(SUM(shares_held), 0)         AS grand_kitta,
    COALESCE(MAX(dividend_rate), 0)       AS detected_rate
  FROM filtered
),
cat_agg AS (
  SELECT
    particular,
    COUNT(*)::bigint                                   AS shareholder_count,
    ROUND(COALESCE(SUM(shares_held), 0)::numeric, 2)  AS kitta,
    ROUND(COALESCE(SUM(bonus_actual), 0)::numeric, 2) AS actual_bonus,
    ROUND(COALESCE(SUM(bonus_issued), 0)::numeric, 2) AS issued_bonus,
    ROUND(COALESCE(SUM(bonus_fraction), 0)::numeric, 2) AS rem_fraction,
    ROUND(COALESCE(SUM(after_bonus_kitta), 0)::numeric, 2) AS after_bonus_kitta,
    ROUND(COALESCE(SUM(gross_dividend), 0)::numeric, 2)  AS gross_dividend,
    ROUND(COALESCE(SUM(bonus_tax), 0)::numeric, 2)    AS bon_tax,
    ROUND(COALESCE(SUM(tax_amount), 0)::numeric, 2)   AS div_tax,
    ROUND(COALESCE(SUM(net_payable), 0)::numeric, 2)  AS net_dividend,
    CASE particular
      WHEN 'PROMOTER'    THEN 1
      WHEN 'PUBLIC'      THEN 2
      WHEN 'LOCAL'       THEN 3
      WHEN 'INSTITUTION' THEN 4
      WHEN 'MUTUAL FUND' THEN 5
      WHEN 'EMPLOYEE'    THEN 6
      ELSE 7
    END AS sort_order
  FROM filtered
  GROUP BY particular
),
cat_numbered AS (
  SELECT
    ROW_NUMBER() OVER (ORDER BY sort_order) AS sn,
    particular,
    shareholder_count,
    kitta,
    actual_bonus,
    issued_bonus,
    rem_fraction,
    after_bonus_kitta,
    gross_dividend,
    bon_tax,
    div_tax,
    net_dividend,
    ROUND(
      CASE WHEN (SELECT grand_kitta FROM grand_totals) > 0
        THEN (kitta / (SELECT grand_kitta FROM grand_totals)) * 100
        ELSE 0
      END, 2) AS composition,
    sort_order
  FROM cat_agg
),
totals AS (
  SELECT
    COUNT(*)::bigint                                       AS shareholder_count,
    ROUND(COALESCE(SUM(shares_held), 0)::numeric, 2)      AS kitta,
    ROUND(COALESCE(SUM(bonus_actual), 0)::numeric, 2)     AS actual_bonus,
    ROUND(COALESCE(SUM(bonus_issued), 0)::numeric, 2)     AS issued_bonus,
    ROUND(COALESCE(SUM(bonus_fraction), 0)::numeric, 2)   AS rem_fraction,
    ROUND(COALESCE(SUM(after_bonus_kitta), 0)::numeric, 2) AS after_bonus_kitta,
    ROUND(COALESCE(SUM(gross_dividend), 0)::numeric, 2)   AS gross_dividend,
    ROUND(COALESCE(SUM(bonus_tax), 0)::numeric, 2)        AS bon_tax,
    ROUND(COALESCE(SUM(tax_amount), 0)::numeric, 2)       AS div_tax,
    ROUND(COALESCE(SUM(net_payable), 0)::numeric, 2)      AS net_dividend
  FROM filtered
),
company_meta AS (
  SELECT
    COALESCE(c.company_name, 'All Companies') AS company_name,
    COALESCE(c.company_code, '')              AS company_code
  FROM public.companies c
  WHERE p_company_id IS NOT NULL AND c.id = p_company_id
  LIMIT 1
),
first_fiscal AS (
  SELECT fiscal_year
  FROM public.dividend_payables
  WHERE (p_company_id IS NULL OR company_id = p_company_id)
    AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
    AND fiscal_year IS NOT NULL
  LIMIT 1
),
rows_json AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'sn',              sn,
      'particular',      particular,
      'shareholderCount', shareholder_count,
      'kitta',           kitta,
      'actualBonus',     actual_bonus,
      'bonusRate',       0,
      'issuedBonus',     issued_bonus,
      'remFraction',     rem_fraction,
      'afterBonusKitta', after_bonus_kitta,
      'grossDividend',   gross_dividend,
      'dividendRate',    (SELECT detected_rate FROM grand_totals),
      'bonTax',          bon_tax,
      'divTax',          div_tax,
      'netDividend',     net_dividend,
      'composition',     composition
    ) ORDER BY sort_order
  ) AS rows_data
  FROM cat_numbered
)
SELECT jsonb_build_object(
  'companyName',          COALESCE((SELECT company_name FROM company_meta), 'All Companies'),
  'companyCode',          COALESCE((SELECT company_code FROM company_meta), ''),
  'fiscalYear',           COALESCE(p_fiscal_year, (SELECT fiscal_year FROM first_fiscal), ''),
  'detectedBonusRate',    0,
  'detectedDividendRate', (SELECT detected_rate FROM grand_totals),
  'rows',                 COALESCE((SELECT rows_data FROM rows_json), '[]'::jsonb),
  'total', (
    SELECT jsonb_build_object(
      'shareholderCount',  shareholder_count,
      'kitta',             kitta,
      'actualBonus',       actual_bonus,
      'issuedBonus',       issued_bonus,
      'remFraction',       rem_fraction,
      'afterBonusKitta',   after_bonus_kitta,
      'grossDividend',     gross_dividend,
      'bonTax',            bon_tax,
      'divTax',            div_tax,
      'netDividend',       net_dividend,
      'composition',       100.00
    ) FROM totals
  )
);
$$;


--

-- Name: get_agm_summary_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_agm_summary_stats() RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT jsonb_build_object(
    'totalShareholders', COUNT(*),
    'totalKitta', COALESCE(SUM(current_kitta_2081), 0),
    'totalBonus', COALESCE(SUM(total_bonus_shares), 0),
    'totalCash', COALESCE(SUM(total_cash_dividend), 0),
    'totalTax', COALESCE(SUM(total_tax_withheld), 0),
    'mfCash', COALESCE(SUM(CASE WHEN holder_type = 'MUTUAL_FUND' THEN total_cash_dividend ELSE 0 END), 0)
  )
  FROM public.agm_historical_shareholders;
$$;


--

-- Name: get_agm_summary_stats(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_agm_summary_stats(p_company_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--

-- Name: get_available_payables_preview(uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_available_payables_preview(p_company_id uuid DEFAULT NULL::uuid, p_payable_type text DEFAULT 'all'::text, p_fiscal_year text DEFAULT 'all'::text, p_from_date text DEFAULT NULL::text, p_to_date text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_global_access boolean := false;
  v_user_companies uuid[];
  v_count bigint := 0;
  v_net numeric := 0;
  v_gross numeric := 0;
  v_tax numeric := 0;
  v_mf_count bigint := 0;
  v_mf_net numeric := 0;
  v_mf_gross numeric := 0;
  v_mf_tax numeric := 0;
  v_div_count bigint := 0;
  v_div_net numeric := 0;
  v_div_gross numeric := 0;
  v_div_tax numeric := 0;
  v_int_count bigint := 0;
  v_int_net numeric := 0;
  v_int_gross numeric := 0;
  v_int_tax numeric := 0;
  v_fetch_mf boolean;
  v_fetch_div boolean;
  v_fetch_int boolean;
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);

  IF session_user = 'postgres' 
     OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     OR COALESCE((NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') = 'service_role'
     OR (
       v_uid IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.user_roles
         WHERE user_id = v_uid
           AND role IN ('admin'::public.app_role, 'supervisor'::public.app_role)
       )
     ) THEN
    v_is_global_access := true;
  ELSE
    SELECT COALESCE(array_agg(company_id), '{}')
    INTO v_user_companies
    FROM public.user_company_access
    WHERE user_id = v_uid;
  END IF;

  v_fetch_mf := (p_payable_type IS NULL OR p_payable_type = 'all' OR p_payable_type = 'mutual_fund');
  v_fetch_div := (p_payable_type IS NULL OR p_payable_type = 'all' OR p_payable_type = 'dividend');
  v_fetch_int := (p_payable_type IS NULL OR p_payable_type = 'all' OR p_payable_type = 'interest');

  -- Mutual Fund Payables
  IF v_fetch_mf THEN
    SELECT
      COUNT(*),
      COALESCE(SUM(GREATEST(0, mf.net_payable - COALESCE(mf.paid_amount, 0))), 0),
      COALESCE(SUM(GREATEST(0, mf.net_payable - COALESCE(mf.paid_amount, 0)) + CASE WHEN COALESCE(mf.net_payable, 0) > 0 THEN round(COALESCE(mf.tax_amount, 0) * GREATEST(0, mf.net_payable - COALESCE(mf.paid_amount, 0)) / mf.net_payable, 2) ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN COALESCE(mf.net_payable, 0) > 0 THEN round(COALESCE(mf.tax_amount, 0) * GREATEST(0, mf.net_payable - COALESCE(mf.paid_amount, 0)) / mf.net_payable, 2) ELSE 0 END), 0)
    INTO v_mf_count, v_mf_net, v_mf_gross, v_mf_tax
    FROM public.mutual_fund_payables mf
    WHERE
      (v_is_global_access OR mf.company_id = ANY(v_user_companies))
      AND (p_company_id IS NULL OR mf.company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR mf.fiscal_year = p_fiscal_year)
      AND mf.payment_status IN ('Pending', 'Partial')
      AND GREATEST(0, mf.net_payable - COALESCE(mf.paid_amount, 0)) > 0
      AND (p_from_date IS NULL OR p_from_date = '' OR mf.created_at >= p_from_date::timestamptz)
      AND (p_to_date IS NULL OR p_to_date = '' OR mf.created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz)
      AND mf.payee_classification <> 'UNCLASSIFIED'
      AND mf.classification_status <> 'REVIEW_REQUIRED'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        JOIN public.payment_batches pb ON pb.id = p.batch_id
        WHERE p.payable_id = mf.id
          AND p.status IN ('Draft', 'Pending', 'Approved')
      );
  END IF;

  -- Dividend Payables
  IF v_fetch_div THEN
    SELECT
      COUNT(*),
      COALESCE(SUM(GREATEST(0, dp.net_payable - COALESCE(dp.paid_amount, 0))), 0),
      COALESCE(SUM(GREATEST(0, dp.net_payable - COALESCE(dp.paid_amount, 0)) + CASE WHEN COALESCE(dp.net_payable, 0) > 0 THEN round(COALESCE(dp.tax_amount, 0) * GREATEST(0, dp.net_payable - COALESCE(dp.paid_amount, 0)) / dp.net_payable, 2) ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN COALESCE(dp.net_payable, 0) > 0 THEN round(COALESCE(dp.tax_amount, 0) * GREATEST(0, dp.net_payable - COALESCE(dp.paid_amount, 0)) / dp.net_payable, 2) ELSE 0 END), 0)
    INTO v_div_count, v_div_net, v_div_gross, v_div_tax
    FROM public.dividend_payables dp
    WHERE
      (v_is_global_access OR dp.company_id = ANY(v_user_companies))
      AND (p_company_id IS NULL OR dp.company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR dp.fiscal_year = p_fiscal_year)
      AND dp.payment_status IN ('Pending', 'Partial')
      AND GREATEST(0, dp.net_payable - COALESCE(dp.paid_amount, 0)) > 0
      AND (p_from_date IS NULL OR p_from_date = '' OR dp.created_at >= p_from_date::timestamptz)
      AND (p_to_date IS NULL OR p_to_date = '' OR dp.created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz)
      AND dp.payee_classification <> 'UNCLASSIFIED'
      AND dp.classification_status <> 'REVIEW_REQUIRED'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        JOIN public.payment_batches pb ON pb.id = p.batch_id
        WHERE p.payable_id = dp.id
          AND p.status IN ('Draft', 'Pending', 'Approved')
      );
  END IF;

  -- Interest Payables
  IF v_fetch_int THEN
    SELECT
      COUNT(*),
      COALESCE(SUM(GREATEST(0, ip.net_payable - COALESCE(ip.paid_amount, 0))), 0),
      COALESCE(SUM(GREATEST(0, ip.net_payable - COALESCE(ip.paid_amount, 0)) + CASE WHEN COALESCE(ip.net_payable, 0) > 0 THEN round(COALESCE(ip.tax_amount, 0) * GREATEST(0, ip.net_payable - COALESCE(ip.paid_amount, 0)) / ip.net_payable, 2) ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN COALESCE(ip.net_payable, 0) > 0 THEN round(COALESCE(ip.tax_amount, 0) * GREATEST(0, ip.net_payable - COALESCE(ip.paid_amount, 0)) / ip.net_payable, 2) ELSE 0 END), 0)
    INTO v_int_count, v_int_net, v_int_gross, v_int_tax
    FROM public.interest_payables ip
    WHERE
      (v_is_global_access OR ip.company_id = ANY(v_user_companies))
      AND (p_company_id IS NULL OR ip.company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR ip.fiscal_year = p_fiscal_year)
      AND ip.payment_status IN ('Pending', 'Partial')
      AND GREATEST(0, ip.net_payable - COALESCE(ip.paid_amount, 0)) > 0
      AND (p_from_date IS NULL OR p_from_date = '' OR ip.created_at >= p_from_date::timestamptz)
      AND (p_to_date IS NULL OR p_to_date = '' OR ip.created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz)
      AND ip.payee_classification <> 'UNCLASSIFIED'
      AND ip.classification_status <> 'REVIEW_REQUIRED'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        JOIN public.payment_batches pb ON pb.id = p.batch_id
        WHERE p.payable_id = ip.id
          AND p.status IN ('Draft', 'Pending', 'Approved')
      );
  END IF;

  v_count := v_mf_count + v_div_count + v_int_count;
  v_net := v_mf_net + v_div_net + v_int_net;
  v_gross := v_mf_gross + v_div_gross + v_int_gross;
  v_tax := v_mf_tax + v_div_tax + v_int_tax;

  RETURN json_build_object(
    'count', v_count,
    'totalAmount', v_net,
    'totalGross', v_gross,
    'totalTax', v_tax,
    'mfCount', v_mf_count,
    'divCount', v_div_count,
    'intCount', v_int_count
  );
END;
$$;


--

-- Name: get_clients_paginated(uuid, text, text, text, text, text, integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_clients_paginated(p_company_id uuid DEFAULT NULL::uuid, p_holder_type text DEFAULT 'all'::text, p_classification text DEFAULT 'all'::text, p_status text DEFAULT 'all'::text, p_verification text DEFAULT 'all'::text, p_search text DEFAULT ''::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_needs_review text DEFAULT 'all'::text) RETURNS TABLE(id uuid, client_code text, client_id text, company_id uuid, full_name text, father_name text, grandfather_name text, date_of_birth text, gender text, occupation text, boid text, kitta numeric, holder_type public.holder_type, payee_classification text, pan_no text, citizenship_no text, pan_or_citizenship text, nid_number text, address text, province text, district text, municipality text, phone text, email text, bank_name text, bank_branch text, bank_account_no text, account_type text, residency public.residency_type, verification_status public.verification_status, status public.record_status, created_at timestamp with time zone, company_name text, company_code text, needs_review boolean, data_quality_notes text, total_count bigint, company_details jsonb)
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '60s'
    AS $$
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


--

-- Name: get_company_client_ids(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_company_client_ids(p_company_id uuid) RETURNS SETOF uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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


--

-- Name: get_company_client_stats(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_company_client_stats(p_company_id uuid DEFAULT NULL::uuid) RETURNS json
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '60s'
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


--

-- Name: get_company_fiscal_summary_rpc(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_company_fiscal_summary_rpc(p_fiscal_year text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid;
  v_is_global_access boolean := false;
  v_user_companies uuid[];
BEGIN
  -- Prevent premature statement timeout during financial cross-table rollup
  PERFORM set_config('statement_timeout', '60s', true);

  v_uid := auth.uid();
  IF v_uid IS NULL 
     AND current_user != 'service_role' 
     AND session_user != 'postgres' 
     AND current_user != 'postgres' 
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  -- Resolve company authorization
  IF current_user = 'postgres' 
     OR session_user = 'postgres' 
     OR current_user = 'service_role' 
     OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' 
     OR EXISTS (
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
        COALESCE(SUM(CASE WHEN dp.paid_amount IS NOT NULL THEN dp.paid_amount WHEN LOWER(dp.payment_status::text) = 'paid' THEN dp.net_payable ELSE 0 END), 0) AS dividend_disbursed,
        COALESCE(SUM(dp.net_payable) FILTER (WHERE LOWER(dp.payment_status::text) = 'paid'), 0) AS dividend_paid,
        COALESCE(SUM(dp.net_payable) FILTER (WHERE LOWER(dp.payment_status::text) = 'partial'), 0) AS dividend_partial,
        COALESCE(SUM(
          CASE
            WHEN LOWER(COALESCE(dp.payment_status::text, 'pending')) = 'paid' THEN 0
            WHEN dp.remaining_amount IS NOT NULL THEN dp.remaining_amount
            ELSE GREATEST(0, dp.net_payable - COALESCE(dp.paid_amount, 0))
          END
        ), 0) AS dividend_pending
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
        COALESCE(SUM(CASE WHEN ip.paid_amount IS NOT NULL THEN ip.paid_amount WHEN LOWER(ip.payment_status::text) = 'paid' THEN ip.net_payable ELSE 0 END), 0) AS interest_disbursed,
        COALESCE(SUM(ip.net_payable) FILTER (WHERE LOWER(ip.payment_status::text) = 'paid'), 0) AS interest_paid,
        COALESCE(SUM(ip.net_payable) FILTER (WHERE LOWER(ip.payment_status::text) = 'partial'), 0) AS interest_partial,
        COALESCE(SUM(
          CASE
            WHEN LOWER(COALESCE(ip.payment_status::text, 'pending')) = 'paid' THEN 0
            WHEN ip.remaining_amount IS NOT NULL THEN ip.remaining_amount
            ELSE GREATEST(0, ip.net_payable - COALESCE(ip.paid_amount, 0))
          END
        ), 0) AS interest_pending
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
        COALESCE(SUM(CASE WHEN mp.paid_amount IS NOT NULL THEN mp.paid_amount WHEN LOWER(mp.payment_status::text) = 'paid' THEN mp.net_payable ELSE 0 END), 0) AS mutual_fund_disbursed,
        COALESCE(SUM(mp.net_payable) FILTER (WHERE LOWER(mp.payment_status::text) = 'paid'), 0) AS mutual_fund_paid,
        COALESCE(SUM(mp.net_payable) FILTER (WHERE LOWER(mp.payment_status::text) = 'partial'), 0) AS mutual_fund_partial,
        COALESCE(SUM(
          CASE
            WHEN LOWER(COALESCE(mp.payment_status::text, 'pending')) = 'paid' THEN 0
            WHEN mp.remaining_amount IS NOT NULL THEN mp.remaining_amount
            ELSE GREATEST(0, mp.net_payable - COALESCE(mp.paid_amount, 0))
          END
        ), 0) AS mutual_fund_pending
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
          'dividend_disbursed', ROUND(COALESCE(ds.dividend_disbursed, 0)::numeric, 2),
          'interest_count', COALESCE(isum.interest_count, 0),
          'interest_gross', ROUND(COALESCE(isum.interest_gross, 0)::numeric, 2),
          'interest_net', ROUND(COALESCE(isum.interest_net, 0)::numeric, 2),
          'interest_paid', ROUND(COALESCE(isum.interest_paid, 0)::numeric, 2),
          'interest_partial', ROUND(COALESCE(isum.interest_partial, 0)::numeric, 2),
          'interest_pending', ROUND(COALESCE(isum.interest_pending, 0)::numeric, 2),
          'interest_disbursed', ROUND(COALESCE(isum.interest_disbursed, 0)::numeric, 2),
          'mutual_fund_count', COALESCE(ms.mutual_fund_count, 0),
          'mutual_fund_gross', ROUND(COALESCE(ms.mutual_fund_gross, 0)::numeric, 2),
          'mutual_fund_net', ROUND(COALESCE(ms.mutual_fund_net, 0)::numeric, 2),
          'mutual_fund_paid', ROUND(COALESCE(ms.mutual_fund_paid, 0)::numeric, 2),
          'mutual_fund_partial', ROUND(COALESCE(ms.mutual_fund_partial, 0)::numeric, 2),
          'mutual_fund_pending', ROUND(COALESCE(ms.mutual_fund_pending, 0)::numeric, 2),
          'mutual_fund_disbursed', ROUND(COALESCE(ms.mutual_fund_disbursed, 0)::numeric, 2),
          'total_paid', ROUND((COALESCE(ds.dividend_paid, 0) + COALESCE(isum.interest_paid, 0) + COALESCE(ms.mutual_fund_paid, 0))::numeric, 2),
          'total_pending', ROUND((COALESCE(ds.dividend_pending, 0) + COALESCE(isum.interest_pending, 0) + COALESCE(ms.mutual_fund_pending, 0))::numeric, 2),
          'total_disbursed', ROUND((COALESCE(ds.dividend_disbursed, 0) + COALESCE(isum.interest_disbursed, 0) + COALESCE(ms.mutual_fund_disbursed, 0))::numeric, 2)
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


--

-- Name: get_company_payable_summary(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_company_payable_summary(p_company_id uuid DEFAULT NULL::uuid) RETURNS TABLE(company_id uuid, company_name text, company_code text, dividend_count bigint, dividend_gross numeric, dividend_tax numeric, dividend_net numeric, interest_count bigint, interest_gross numeric, interest_tax numeric, interest_net numeric, total_count bigint, total_gross numeric, total_tax numeric, total_net numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '60s'
    AS $$
BEGIN
  -- Authenticate caller
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH div_agg AS (
    SELECT
      dp.company_id,
      COUNT(*)::bigint AS d_count,
      COALESCE(SUM(dp.gross_dividend), 0)::numeric AS d_gross,
      COALESCE(SUM(dp.tax_amount), 0)::numeric AS d_tax,
      COALESCE(SUM(dp.net_payable), 0)::numeric AS d_net
    FROM public.dividend_payables dp
    WHERE (p_company_id IS NULL OR dp.company_id = p_company_id)
    GROUP BY dp.company_id
  ),
  int_agg AS (
    SELECT
      ip.company_id,
      COUNT(*)::bigint AS i_count,
      COALESCE(SUM(ip.gross_interest), 0)::numeric AS i_gross,
      COALESCE(SUM(ip.tax_amount), 0)::numeric AS i_tax,
      COALESCE(SUM(ip.net_payable), 0)::numeric AS i_net
    FROM public.interest_payables ip
    WHERE (p_company_id IS NULL OR ip.company_id = p_company_id)
    GROUP BY ip.company_id
  ),
  mf_agg AS (
    SELECT
      mp.company_id,
      COUNT(*)::bigint AS m_count,
      COALESCE(SUM(mp.gross_dividend), 0)::numeric AS m_gross,
      COALESCE(SUM(mp.tax_amount), 0)::numeric AS m_tax,
      COALESCE(SUM(mp.net_payable), 0)::numeric AS m_net
    FROM public.mutual_fund_payables mp
    WHERE (p_company_id IS NULL OR mp.company_id = p_company_id)
    GROUP BY mp.company_id
  ),
  active_companies AS (
    SELECT DISTINCT c.id, c.company_name, c.company_code
    FROM public.companies c
    WHERE (p_company_id IS NULL OR c.id = p_company_id)
      AND (
        EXISTS (SELECT 1 FROM div_agg d WHERE d.company_id = c.id)
        OR EXISTS (SELECT 1 FROM int_agg i WHERE i.company_id = c.id)
        OR EXISTS (SELECT 1 FROM mf_agg m WHERE m.company_id = c.id)
      )
  )
  SELECT
    ac.id AS company_id,
    ac.company_name::text,
    ac.company_code::text,
    (COALESCE(d.d_count, 0) + COALESCE(m.m_count, 0))::bigint AS dividend_count,
    (COALESCE(d.d_gross, 0) + COALESCE(m.m_gross, 0))::numeric AS dividend_gross,
    (COALESCE(d.d_tax, 0) + COALESCE(m.m_tax, 0))::numeric AS dividend_tax,
    (COALESCE(d.d_net, 0) + COALESCE(m.m_net, 0))::numeric AS dividend_net,
    COALESCE(i.i_count, 0)::bigint AS interest_count,
    COALESCE(i.i_gross, 0)::numeric AS interest_gross,
    COALESCE(i.i_tax, 0)::numeric AS interest_tax,
    COALESCE(i.i_net, 0)::numeric AS interest_net,
    (COALESCE(d.d_count, 0) + COALESCE(m.m_count, 0) + COALESCE(i.i_count, 0))::bigint AS total_count,
    (COALESCE(d.d_gross, 0) + COALESCE(m.m_gross, 0) + COALESCE(i.i_gross, 0))::numeric AS total_gross,
    (COALESCE(d.d_tax, 0) + COALESCE(m.m_tax, 0) + COALESCE(i.i_tax, 0))::numeric AS total_tax,
    (COALESCE(d.d_net, 0) + COALESCE(m.m_net, 0) + COALESCE(i.i_net, 0))::numeric AS total_net
  FROM active_companies ac
  LEFT JOIN div_agg d ON d.company_id = ac.id
  LEFT JOIN int_agg i ON i.company_id = ac.id
  LEFT JOIN mf_agg m ON m.company_id = ac.id
  ORDER BY ac.company_name ASC;
END;
$$;


--

-- Name: get_distinct_fiscal_years(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_distinct_fiscal_years(p_table text DEFAULT 'mutual_fund_payables'::text) RETURNS text[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_res text[];
BEGIN
  IF p_table = 'mutual_fund_payables' THEN
    SELECT array_agg(DISTINCT fiscal_year ORDER BY fiscal_year DESC)
    INTO v_res
    FROM public.mutual_fund_payables
    WHERE fiscal_year IS NOT NULL;
  ELSIF p_table = 'dividend_payables' THEN
    SELECT array_agg(DISTINCT fiscal_year ORDER BY fiscal_year DESC)
    INTO v_res
    FROM public.dividend_payables
    WHERE fiscal_year IS NOT NULL;
  ELSIF p_table = 'interest_payables' THEN
    SELECT array_agg(DISTINCT fiscal_year ORDER BY fiscal_year DESC)
    INTO v_res
    FROM public.interest_payables
    WHERE fiscal_year IS NOT NULL;
  END IF;

  RETURN COALESCE(v_res, '{}');
END;
$$;


--

-- Name: get_dividend_payables_totals(uuid, text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_dividend_payables_totals(p_company_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'all'::text, p_fiscal_year text DEFAULT 'all'::text, p_type text DEFAULT 'all'::text, p_class text DEFAULT 'all'::text, p_from_date text DEFAULT NULL::text, p_to_date text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_global_access boolean := false;
  v_user_companies uuid[];
  v_count bigint := 0;
  v_paid_count bigint := 0;
  v_partial_count bigint := 0;
  v_pending_count bigint := 0;
  v_gross numeric := 0;
  v_tax numeric := 0;
  v_bonus_tax numeric := 0;
  v_net numeric := 0;
  v_disbursed numeric := 0;
  v_remaining numeric := 0;
  v_total_shares numeric := 0;
  v_bonus_issued numeric := 0;
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);

  IF session_user = 'postgres' 
     OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     OR COALESCE((NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') = 'service_role'
     OR (
       v_uid IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.user_roles
         WHERE user_id = v_uid
           AND role IN ('admin'::public.app_role, 'supervisor'::public.app_role)
       )
     ) THEN
    v_is_global_access := true;
  ELSE
    SELECT COALESCE(array_agg(company_id), '{}')
    INTO v_user_companies
    FROM public.user_company_access
    WHERE user_id = v_uid;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE payment_status::text = 'Paid'),
    COUNT(*) FILTER (WHERE payment_status::text = 'Partial'),
    COUNT(*) FILTER (WHERE payment_status::text = 'Pending'),
    COALESCE(SUM(gross_dividend), 0),
    COALESCE(SUM(tax_amount), 0),
    COALESCE(SUM(bonus_tax), 0),
    COALESCE(SUM(net_payable), 0),
    COALESCE(SUM(COALESCE(paid_amount, CASE WHEN payment_status::text = 'Paid' THEN net_payable ELSE 0 END)), 0),
    COALESCE(SUM(COALESCE(remaining_amount, GREATEST(0, net_payable - COALESCE(paid_amount, 0)))), 0),
    COALESCE(SUM(shares_held), 0),
    COALESCE(SUM(bonus_issued), 0)
  INTO
    v_count, v_paid_count, v_partial_count, v_pending_count,
    v_gross, v_tax, v_bonus_tax, v_net, v_disbursed, v_remaining,
    v_total_shares, v_bonus_issued
  FROM public.dividend_payables
  WHERE
    (v_is_global_access OR company_id = ANY(v_user_companies))
    AND (p_company_id IS NULL OR company_id = p_company_id)
    AND (p_status IS NULL OR p_status = 'all' OR p_status = '' OR payment_status::text = p_status)
    AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR fiscal_year = p_fiscal_year)
    AND (p_type IS NULL OR p_type = 'all' OR p_type = '' OR dividend_type::text = p_type)
    AND (
      p_class IS NULL OR p_class = 'all' OR p_class = ''
      OR (p_class = 'PROMOTER' AND (payee_segment = 'PROMOTER' OR lot_name ILIKE '%PROMOT%'))
      OR (p_class = 'LOCAL' AND (payee_segment = 'LOCAL' OR lot_name ILIKE '%LOCAL%'))
      OR ((p_class = 'TAX_EXEMPT' OR p_class = 'MUTUAL_FUND') AND (payee_classification = 'TAX_EXEMPT' OR lot_name ILIKE '%MUTUAL%' OR lot_name ILIKE '%EXEMPT%'))
      OR (p_class = 'INSTITUTION' AND (payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%INSTITUT%' OR lot_name ILIKE '%COMPANY%'))
      OR (p_class = 'PUBLIC' AND (payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%PUBLIC%'))
    )
    AND (p_from_date IS NULL OR p_from_date = '' OR created_at >= p_from_date::timestamptz)
    AND (p_to_date IS NULL OR p_to_date = '' OR created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz);

  RETURN json_build_object(
    'count', COALESCE(v_count, 0),
    'paidCount', COALESCE(v_paid_count, 0),
    'partialCount', COALESCE(v_partial_count, 0),
    'pendingCount', COALESCE(v_pending_count, 0),
    'gross', COALESCE(v_gross, 0),
    'tax', COALESCE(v_tax, 0),
    'bonusTax', COALESCE(v_bonus_tax, 0),
    'net', COALESCE(v_net, 0),
    'disbursed', COALESCE(v_disbursed, 0),
    'remaining', COALESCE(v_remaining, 0),
    'totalShares', COALESCE(v_total_shares, 0),
    'bonusIssued', COALESCE(v_bonus_issued, 0)
  );
END;
$$;


--

-- Name: get_interest_payables_totals(uuid, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_interest_payables_totals(p_company_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'all'::text, p_fiscal_year text DEFAULT 'all'::text, p_class text DEFAULT 'all'::text, p_from_date text DEFAULT NULL::text, p_to_date text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_global_access boolean := false;
  v_user_companies uuid[];
  v_count bigint := 0;
  v_paid_count bigint := 0;
  v_partial_count bigint := 0;
  v_pending_count bigint := 0;
  v_units numeric := 0;
  v_gross numeric := 0;
  v_tax numeric := 0;
  v_net numeric := 0;
  v_disbursed numeric := 0;
  v_remaining numeric := 0;
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);

  IF session_user = 'postgres' 
     OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     OR COALESCE((NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') = 'service_role'
     OR (
       v_uid IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.user_roles
         WHERE user_id = v_uid
           AND role IN ('admin'::public.app_role, 'supervisor'::public.app_role)
       )
     ) THEN
    v_is_global_access := true;
  ELSE
    SELECT COALESCE(array_agg(company_id), '{}')
    INTO v_user_companies
    FROM public.user_company_access
    WHERE user_id = v_uid;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE payment_status::text = 'Paid'),
    COUNT(*) FILTER (WHERE payment_status::text = 'Partial'),
    COUNT(*) FILTER (WHERE payment_status::text = 'Pending'),
    COALESCE(SUM(shares_held), 0),
    COALESCE(SUM(gross_dividend), 0),
    COALESCE(SUM(tax_amount), 0),
    COALESCE(SUM(net_payable), 0),
    COALESCE(SUM(COALESCE(paid_amount, CASE WHEN payment_status::text = 'Paid' THEN net_payable ELSE 0 END)), 0),
    COALESCE(SUM(COALESCE(remaining_amount, GREATEST(0, net_payable - COALESCE(paid_amount, 0)))), 0)
  INTO
    v_count, v_paid_count, v_partial_count, v_pending_count,
    v_units, v_gross, v_tax, v_net, v_disbursed, v_remaining
  FROM public.interest_payables
  WHERE
    (v_is_global_access OR company_id = ANY(v_user_companies))
    AND (p_company_id IS NULL OR company_id = p_company_id)
    AND (p_status IS NULL OR p_status = 'all' OR p_status = '' OR payment_status::text = p_status)
    AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR fiscal_year = p_fiscal_year)
    AND (
      p_class IS NULL OR p_class = 'all' OR p_class = ''
      OR (p_class = 'PROMOTER' AND (payee_segment = 'PROMOTER' OR lot_name ILIKE '%PROMOT%'))
      OR (p_class = 'LOCAL' AND (payee_segment = 'LOCAL' OR lot_name ILIKE '%LOCAL%'))
      OR (p_class = 'TAX_EXEMPT' AND (payee_classification = 'TAX_EXEMPT' OR lot_name ILIKE '%MUTUAL%' OR lot_name ILIKE '%EXEMPT%'))
      OR (p_class = 'INSTITUTION' AND (payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%INSTITUT%' OR lot_name ILIKE '%COMPANY%'))
      OR (p_class = 'PUBLIC' AND (payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%PUBLIC%'))
    )
    AND (p_from_date IS NULL OR p_from_date = '' OR created_at >= p_from_date::timestamptz)
    AND (p_to_date IS NULL OR p_to_date = '' OR created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz);

  RETURN json_build_object(
    'count', COALESCE(v_count, 0),
    'paidCount', COALESCE(v_paid_count, 0),
    'partialCount', COALESCE(v_partial_count, 0),
    'pendingCount', COALESCE(v_pending_count, 0),
    'units', COALESCE(v_units, 0),
    'gross', COALESCE(v_gross, 0),
    'tax', COALESCE(v_tax, 0),
    'net', COALESCE(v_net, 0),
    'disbursed', COALESCE(v_disbursed, 0),
    'remaining', COALESCE(v_remaining, 0)
  );
END;
$$;


--

-- Name: get_mutual_fund_distribution_summary(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_mutual_fund_distribution_summary(p_company_id uuid DEFAULT NULL::uuid, p_fiscal_year text DEFAULT 'all'::text, p_from_date text DEFAULT NULL::text, p_to_date text DEFAULT NULL::text) RETURNS TABLE(type text, transaction_count bigint, kitta numeric, gross numeric, tax numeric, net numeric)
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_global_access boolean := false;
  v_user_companies uuid[];
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);

  IF session_user = 'postgres' 
     OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     OR COALESCE((NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') = 'service_role'
     OR (
       v_uid IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.user_roles
         WHERE user_id = v_uid
           AND role IN ('admin'::public.app_role, 'supervisor'::public.app_role)
       )
     ) THEN
    v_is_global_access := true;
  ELSE
    SELECT COALESCE(array_agg(company_id), '{}')
    INTO v_user_companies
    FROM public.user_company_access
    WHERE user_id = v_uid;
  END IF;

  RETURN QUERY
  SELECT
    mapped_type AS type,
    COUNT(*)::bigint AS transaction_count,
    COALESCE(SUM(shares_held), 0)::numeric AS kitta,
    COALESCE(SUM(gross_dividend), 0)::numeric AS gross,
    COALESCE(SUM(tax_amount), 0)::numeric AS tax,
    COALESCE(SUM(net_payable), 0)::numeric AS net
  FROM (
    SELECT
      shares_held,
      gross_dividend,
      tax_amount,
      net_payable,
      CASE
        WHEN payee_classification = 'TAX_EXEMPT' OR lot_name ILIKE '%MUTUAL%' OR lot_name ILIKE '%EXEMPT%' THEN 'MUTUAL FUND'
        WHEN payee_classification = 'COMPANY_INSTITUTION' OR lot_name ILIKE '%INSTITUT%' OR lot_name ILIKE '%COMPANY%' THEN 'INSTITUTION'
        ELSE 'PUBLIC'
      END AS mapped_type
    FROM public.mutual_fund_payables
    WHERE
      (v_is_global_access OR company_id = ANY(v_user_companies))
      AND (p_company_id IS NULL OR company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR fiscal_year = p_fiscal_year)
      AND (p_from_date IS NULL OR p_from_date = '' OR created_at >= p_from_date::timestamptz)
      AND (p_to_date IS NULL OR p_to_date = '' OR created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz)
  ) sub
  GROUP BY mapped_type
  ORDER BY
    CASE mapped_type
      WHEN 'PUBLIC' THEN 1
      WHEN 'INSTITUTION' THEN 2
      WHEN 'MUTUAL FUND' THEN 3
      ELSE 4
    END;
END;
$$;


--

-- Name: get_mutual_fund_payables_totals(uuid, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_mutual_fund_payables_totals(p_company_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'all'::text, p_fiscal_year text DEFAULT 'all'::text, p_class text DEFAULT 'all'::text, p_from_date text DEFAULT NULL::text, p_to_date text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_global_access boolean := false;
  v_user_companies uuid[];
  v_count bigint := 0;
  v_paid_count bigint := 0;
  v_partial_count bigint := 0;
  v_pending_count bigint := 0;
  v_units numeric := 0;
  v_gross numeric := 0;
  v_tax numeric := 0;
  v_net numeric := 0;
  v_disbursed numeric := 0;
  v_remaining numeric := 0;
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);

  IF session_user = 'postgres' 
     OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     OR COALESCE((NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') = 'service_role'
     OR (
       v_uid IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.user_roles
         WHERE user_id = v_uid
           AND role IN ('admin'::public.app_role, 'supervisor'::public.app_role)
       )
     ) THEN
    v_is_global_access := true;
  ELSE
    SELECT COALESCE(array_agg(company_id), '{}')
    INTO v_user_companies
    FROM public.user_company_access
    WHERE user_id = v_uid;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE payment_status::text = 'Paid'),
    COUNT(*) FILTER (WHERE payment_status::text = 'Partial'),
    COUNT(*) FILTER (WHERE payment_status::text = 'Pending'),
    COALESCE(SUM(shares_held), 0),
    COALESCE(SUM(gross_dividend), 0),
    COALESCE(SUM(tax_amount), 0),
    COALESCE(SUM(net_payable), 0),
    COALESCE(SUM(COALESCE(paid_amount, CASE WHEN payment_status::text = 'Paid' THEN net_payable ELSE 0 END)), 0),
    COALESCE(SUM(COALESCE(remaining_amount, GREATEST(0, net_payable - COALESCE(paid_amount, 0)))), 0)
  INTO
    v_count, v_paid_count, v_partial_count, v_pending_count,
    v_units, v_gross, v_tax, v_net, v_disbursed, v_remaining
  FROM public.mutual_fund_payables
  WHERE
    (v_is_global_access OR company_id = ANY(v_user_companies))
    AND (p_company_id IS NULL OR company_id = p_company_id)
    AND (p_status IS NULL OR p_status = 'all' OR p_status = '' OR payment_status::text = p_status)
    AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR fiscal_year = p_fiscal_year)
    AND (
      p_class IS NULL OR p_class = 'all' OR p_class = ''
      OR (p_class = 'PROMOTER' AND (payee_segment = 'PROMOTER' OR lot_name ILIKE '%PROMOT%'))
      OR (p_class = 'LOCAL' AND (payee_segment = 'LOCAL' OR lot_name ILIKE '%LOCAL%'))
      OR (p_class = 'TAX_EXEMPT' AND (payee_classification = 'TAX_EXEMPT' OR lot_name ILIKE '%MUTUAL%' OR lot_name ILIKE '%EXEMPT%'))
      OR (p_class = 'INSTITUTION' AND (payee_classification = 'COMPANY_INSTITUTION' OR lot_name ILIKE '%INSTITUT%' OR lot_name ILIKE '%COMPANY%'))
      OR (p_class = 'PUBLIC' AND (payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%PUBLIC%'))
    )
    AND (p_from_date IS NULL OR p_from_date = '' OR created_at >= p_from_date::timestamptz)
    AND (p_to_date IS NULL OR p_to_date = '' OR created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz);

  RETURN json_build_object(
    'count', COALESCE(v_count, 0),
    'paidCount', COALESCE(v_paid_count, 0),
    'partialCount', COALESCE(v_partial_count, 0),
    'pendingCount', COALESCE(v_pending_count, 0),
    'units', COALESCE(v_units, 0),
    'gross', COALESCE(v_gross, 0),
    'tax', COALESCE(v_tax, 0),
    'net', COALESCE(v_net, 0),
    'disbursed', COALESCE(v_disbursed, 0),
    'remaining', COALESCE(v_remaining, 0)
  );
END;
$$;


--

-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  user_count INT;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email);

  SELECT COUNT(*) INTO user_count FROM public.user_roles;
  IF user_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'report_viewer');
  END IF;
  RETURN NEW;
END;
$$;


--

-- Name: has_any_role(uuid, public.app_role[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[]) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles));
$$;


--

-- Name: has_company_access(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_company_access(_user_id uuid, _company_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT 
    CASE 
      WHEN _user_id IS NULL OR _company_id IS NULL THEN FALSE
      WHEN (SELECT public.has_any_role(_user_id, ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])) THEN TRUE
      WHEN EXISTS (
        SELECT 1 FROM public.companies
        WHERE id = _company_id
          AND created_by = _user_id
      ) THEN TRUE
      ELSE EXISTS (
        SELECT 1 FROM public.user_company_access 
        WHERE user_id = _user_id 
          AND company_id = _company_id
      )
    END;
$$;


--

-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;


--

-- Name: mask_smtp_secrets(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mask_smtp_secrets(j jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT CASE 
    WHEN j IS NULL THEN NULL 
    ELSE (j - 'smtp_pass' - 'sms_api_key') 
         || jsonb_build_object(
              'smtp_pass_configured', COALESCE(j->>'smtp_pass', '') <> '',
              'sms_api_key_configured', COALESCE(j->>'sms_api_key', '') <> ''
            )
  END;
$$;


--

-- Name: next_agm_broker_claim_seq(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_agm_broker_claim_seq() RETURNS bigint
    LANGUAGE sql
    SET search_path TO 'public'
    AS $$
  SELECT nextval('public.seq_agm_broker_claim_no');
$$;


--

-- Name: populate_payment_batch_chunk(uuid, uuid, text, text, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.populate_payment_batch_chunk(p_batch_id uuid, p_company_id uuid DEFAULT NULL::uuid, p_fiscal_year text DEFAULT NULL::text, p_payable_type text DEFAULT 'all'::text, p_payment_method text DEFAULT 'ConnectIPS'::text, p_installment_tag text DEFAULT 'FULL'::text, p_limit integer DEFAULT 2500) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_inserted_count bigint := 0;
  v_total_amount numeric := 0;
  v_total_tax numeric := 0;
  v_valid_payment_method public.payment_method;
  v_batch_name text;
  v_has_more boolean := false;
  v_current_total bigint := 0;
BEGIN
  PERFORM set_config('app.skip_audit', 'on', true);

  SELECT batch_name INTO v_batch_name FROM public.payment_batches WHERE id = p_batch_id;
  IF v_batch_name IS NULL THEN
    RAISE EXCEPTION 'Batch not found.';
  END IF;

  BEGIN
    v_valid_payment_method := p_payment_method::public.payment_method;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid payment method: %', p_payment_method USING ERRCODE = '22023';
  END;

  -- 1. Insert chunk from Mutual Fund Payables
  IF p_payable_type IS NULL OR p_payable_type = 'all' OR p_payable_type = 'mutual_fund' THEN
    INSERT INTO public.payments (
      batch_id, company_id, client_id, payable_type, payable_id,
      gross_amount, tax_amount, net_amount, paid_amount, payment_method,
      status, bank_name, bank_account_no, remarks, created_by, created_at, updated_at
    )
    SELECT
      p_batch_id, mf.company_id, mf.client_id, 'mutual_fund', mf.id,
      GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) + CASE WHEN COALESCE(mf.net_payable,0) > 0 THEN round(COALESCE(mf.tax_amount,0) * GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) / mf.net_payable, 2) ELSE 0 END, CASE WHEN COALESCE(mf.net_payable,0) > 0 THEN round(COALESCE(mf.tax_amount,0) * GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) / mf.net_payable, 2) ELSE 0 END, GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0), GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0),
      v_valid_payment_method, 'Pending',
      COALESCE(NULLIF(c.bank_name,''), mf.bank_name), COALESCE(NULLIF(c.bank_account_no,''), mf.bank_account_no),
      CASE 
        WHEN p_installment_tag = 'SEMI_1' THEN '[Installment 1 (Poush)] ' || v_batch_name
        WHEN p_installment_tag = 'SEMI_2' THEN '[Installment 2 (Asar)] ' || v_batch_name
        WHEN p_installment_tag = 'INTERIM' THEN '[Interim Dividend] ' || v_batch_name
        WHEN p_installment_tag = 'FINAL' THEN '[Final Dividend] ' || v_batch_name
        ELSE '[' || v_batch_name || ']'
      END,
      auth.uid(), NOW(), NOW()
    FROM public.mutual_fund_payables mf
    LEFT JOIN public.clients c ON c.id = mf.client_id
    WHERE
      (p_company_id IS NULL OR mf.company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR mf.fiscal_year = p_fiscal_year)
      AND mf.payment_status IN ('Pending', 'Partial')
      AND GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) > 0
      AND mf.payee_classification <> 'UNCLASSIFIED'
      AND mf.classification_status <> 'REVIEW_REQUIRED'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        JOIN public.payment_batches pb ON pb.id = p.batch_id
        WHERE p.payable_id = mf.id
          AND p.status IN ('Draft', 'Pending', 'Approved')
      )
    ORDER BY mf.id ASC
    LIMIT p_limit;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  END IF;

  -- 2. Insert chunk from Dividend Payables if room remains
  IF (p_payable_type = 'all' OR p_payable_type = 'dividend') AND (p_limit - v_inserted_count > 0) THEN
    DECLARE
      v_div_inserted bigint := 0;
    BEGIN
      INSERT INTO public.payments (
        batch_id, company_id, client_id, payable_type, payable_id,
        gross_amount, tax_amount, net_amount, paid_amount, payment_method,
        status, bank_name, bank_account_no, remarks, created_by, created_at, updated_at
      )
      SELECT
        p_batch_id, dp.company_id, dp.client_id, 'dividend', dp.id,
        GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) + CASE WHEN COALESCE(dp.net_payable,0) > 0 THEN round(COALESCE(dp.tax_amount,0) * GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) / dp.net_payable, 2) ELSE 0 END, CASE WHEN COALESCE(dp.net_payable,0) > 0 THEN round(COALESCE(dp.tax_amount,0) * GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) / dp.net_payable, 2) ELSE 0 END, GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0), GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0),
        v_valid_payment_method, 'Pending',
        COALESCE(NULLIF(c.bank_name,''), dp.bank_name), COALESCE(NULLIF(c.bank_account_no,''), dp.bank_account_no),
        '[' || v_batch_name || ']',
        auth.uid(), NOW(), NOW()
      FROM public.dividend_payables dp
      LEFT JOIN public.clients c ON c.id = dp.client_id
      WHERE
        (p_company_id IS NULL OR dp.company_id = p_company_id)
        AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR dp.fiscal_year = p_fiscal_year)
        AND dp.payment_status IN ('Pending', 'Partial')
      AND GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM public.payments p
          JOIN public.payment_batches pb ON pb.id = p.batch_id
          WHERE p.payable_id = dp.id
            AND p.status IN ('Draft', 'Pending', 'Approved')
        )
      ORDER BY dp.id ASC
      LIMIT (p_limit - v_inserted_count);

      GET DIAGNOSTICS v_div_inserted = ROW_COUNT;
      v_inserted_count := v_inserted_count + v_div_inserted;
    END;
  END IF;

  -- 3. Insert chunk from Interest Payables if room remains
  IF (p_payable_type = 'all' OR p_payable_type = 'interest') AND (p_limit - v_inserted_count > 0) THEN
    DECLARE
      v_int_inserted bigint := 0;
    BEGIN
      INSERT INTO public.payments (
        batch_id, company_id, client_id, payable_type, payable_id,
        gross_amount, tax_amount, net_amount, paid_amount, payment_method,
        status, bank_name, bank_account_no, remarks, created_by, created_at, updated_at
      )
      SELECT
        p_batch_id, ip.company_id, ip.client_id, 'interest', ip.id,
        GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0) + CASE WHEN COALESCE(ip.net_payable,0) > 0 THEN round(COALESCE(ip.tax_amount,0) * GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0) / ip.net_payable, 2) ELSE 0 END, CASE WHEN COALESCE(ip.net_payable,0) > 0 THEN round(COALESCE(ip.tax_amount,0) * GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0) / ip.net_payable, 2) ELSE 0 END, GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0), GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0),
        v_valid_payment_method, 'Pending',
        COALESCE(NULLIF(c.bank_name,''), ip.bank_name), COALESCE(NULLIF(c.bank_account_no,''), ip.bank_account_no),
        '[' || v_batch_name || ']',
        auth.uid(), NOW(), NOW()
      FROM public.interest_payables ip
      LEFT JOIN public.clients c ON c.id = ip.client_id
      WHERE
        (p_company_id IS NULL OR ip.company_id = p_company_id)
        AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR ip.fiscal_year = p_fiscal_year)
        AND ip.payment_status IN ('Pending', 'Partial')
      AND GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM public.payments p
          JOIN public.payment_batches pb ON pb.id = p.batch_id
          WHERE p.payable_id = ip.id
            AND p.status IN ('Draft', 'Pending', 'Approved')
        )
      ORDER BY ip.id ASC
      LIMIT (p_limit - v_inserted_count);

      GET DIAGNOSTICS v_int_inserted = ROW_COUNT;
      v_inserted_count := v_inserted_count + v_int_inserted;
    END;
  END IF;

  -- 4. Update Header Totals
  SELECT
    COUNT(*),
    COALESCE(SUM(net_amount), 0),
    COALESCE(SUM(tax_amount), 0)
  INTO v_current_total, v_total_amount, v_total_tax
  FROM public.payments
  WHERE batch_id = p_batch_id;

  UPDATE public.payment_batches
  SET
    total_payments = v_current_total,
    total_amount = v_total_amount,
    total_tax = v_total_tax,
    updated_at = NOW()
  WHERE id = p_batch_id;

  v_has_more := (v_inserted_count >= p_limit);

  PERFORM set_config('app.skip_audit', 'off', true);

  RETURN json_build_object(
    'batch_id', p_batch_id,
    'inserted_count', v_inserted_count,
    'total_in_batch', v_current_total,
    'total_amount', v_total_amount,
    'has_more', v_has_more
  );
END;
$$;


--

-- Name: promote_agm_clients_and_payables(uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promote_agm_clients_and_payables(p_company_id uuid, p_clients jsonb, p_payables jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
    ON CONFLICT (company_id, boid) DO UPDATE
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


--

-- Name: refresh_company_client_map(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_company_client_map() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_client_map;
END;
$$;


--

-- Name: replace_agm_fiscal_year_snapshots(uuid, text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_agm_fiscal_year_snapshots(p_company_id uuid, p_fiscal_year text, p_incoming_boids text[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--

-- Name: require_role(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.require_role(VARIADIC _roles text[]) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_typed_roles public.app_role[];
BEGIN
  SELECT COALESCE(array_agg(r::public.app_role), ARRAY[]::public.app_role[])
  INTO v_typed_roles
  FROM unnest(_roles) AS r;

  PERFORM public.require_role(VARIADIC v_typed_roles);
END;
$$;


--

-- Name: require_role(public.app_role[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.require_role(VARIADIC _roles public.app_role[]) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt_role text;
BEGIN
  -- Always allow postgres superuser / internal triggers
  IF current_user = 'postgres' THEN
    RETURN;
  END IF;

  -- Allow service_role
  BEGIN
    v_jwt_role := (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role = 'service_role' THEN
    RETURN;
  END IF;

  -- Authenticated user check
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  -- Admin always has all privileges; otherwise verify at least one required role
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_uid AND (role = 'admin'::public.app_role OR role = ANY(_roles))
  ) THEN
    RAISE EXCEPTION 'Forbidden: user does not have required permissions' USING ERRCODE = '42501';
  END IF;
END;
$$;


--

-- Name: revert_payment_batch_atomic(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revert_payment_batch_atomic(p_batch_id uuid, p_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '60s'
    AS $$
DECLARE
  v_batch record;
  v_actor_id uuid;
  v_jwt_role text;
  v_div_ids uuid[];
  v_int_ids uuid[];
  v_mf_ids uuid[];
  v_div_count int := 0;
  v_int_count int := 0;
  v_mf_count int := 0;
  v_reverted_payables int := 0;
  v_payments_deleted int := 0;
BEGIN
  -- Extract caller JWT role
  BEGIN
    v_jwt_role := (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  -- Role check: admin, supervisor, or service_role
  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND current_user != 'postgres' THEN
    PERFORM public.require_role('admin', 'supervisor');
  END IF;

  v_actor_id := COALESCE(auth.uid(), p_user_id);

  -- 1. Fetch and lock payment batch
  SELECT * INTO v_batch
  FROM public.payment_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment batch with id % not found', p_batch_id;
  END IF;

  -- 2. Verify company access if batch has company_id
  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND v_batch.company_id IS NOT NULL THEN
    IF v_actor_id IS NOT NULL THEN
      IF NOT public.has_company_access(v_actor_id, v_batch.company_id) THEN
        RAISE EXCEPTION 'Unauthorized: caller lacks access to company % for payment batch %', v_batch.company_id, p_batch_id USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- 3. Collect payable IDs from payments in this batch grouped by payable type
  SELECT array_agg(DISTINCT payable_id) INTO v_div_ids
  FROM public.payments
  WHERE batch_id = p_batch_id
    AND payable_type IN ('dividend', 'dividend_payables')
    AND payable_id IS NOT NULL;

  SELECT array_agg(DISTINCT payable_id) INTO v_int_ids
  FROM public.payments
  WHERE batch_id = p_batch_id
    AND payable_type IN ('interest', 'interest_payables')
    AND payable_id IS NOT NULL;

  SELECT array_agg(DISTINCT payable_id) INTO v_mf_ids
  FROM public.payments
  WHERE batch_id = p_batch_id
    AND payable_type IN ('mutual_fund', 'mutual_fund_payables')
    AND payable_id IS NOT NULL;

  -- 4. Reset dividend payables back to Pending
  IF array_length(v_div_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE public.dividend_payables
      SET payment_status = 'Pending'::public.payment_status,
          paid_amount = 0,
          remaining_amount = net_payable,
          payment_date = NULL,
          payment_reference = NULL,
          updated_at = NOW()
      WHERE id = ANY(v_div_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_div_count FROM upd;
    v_reverted_payables := v_reverted_payables + v_div_count;
  END IF;

  -- 5. Reset interest payables back to Pending
  IF array_length(v_int_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE public.interest_payables
      SET payment_status = 'Pending'::public.payment_status,
          paid_amount = 0,
          remaining_amount = net_payable,
          payment_date = NULL,
          payment_reference = NULL,
          updated_at = NOW()
      WHERE id = ANY(v_int_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_int_count FROM upd;
    v_reverted_payables := v_reverted_payables + v_int_count;
  END IF;

  -- 6. Reset mutual fund payables back to Pending
  IF array_length(v_mf_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE public.mutual_fund_payables
      SET payment_status = 'Pending'::public.payment_status,
          paid_amount = 0,
          remaining_amount = net_payable,
          payment_date = NULL,
          payment_reference = NULL,
          updated_at = NOW()
      WHERE id = ANY(v_mf_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_mf_count FROM upd;
    v_reverted_payables := v_reverted_payables + v_mf_count;
  END IF;

  -- 7. Delete payment line items for this batch
  WITH del_pmt AS (
    DELETE FROM public.payments
    WHERE batch_id = p_batch_id
    RETURNING id
  )
  SELECT count(*) INTO v_payments_deleted FROM del_pmt;

  -- 8. Delete the payment batch header
  DELETE FROM public.payment_batches
  WHERE id = p_batch_id;

  -- 9. Record audit log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    table_name,
    record_id,
    new_value
  ) VALUES (
    v_actor_id,
    'REVERT_PAYMENT_BATCH',
    'payment_batches',
    p_batch_id,
    jsonb_build_object(
      'batch_name', v_batch.batch_name,
      'reverted_payables', v_reverted_payables,
      'dividend_payables_reverted', v_div_count,
      'interest_payables_reverted', v_int_count,
      'mutual_fund_payables_reverted', v_mf_count,
      'payments_deleted', v_payments_deleted
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'reverted_payables', v_reverted_payables,
    'payments_deleted', v_payments_deleted
  );
END;
$$;


--

-- Name: revert_payment_batch_atomic(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revert_payment_batch_atomic(p_batch_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '60s'
    AS $$
DECLARE
  v_batch record;
  v_actor_id uuid;
  v_jwt_role text;
  v_div_ids uuid[];
  v_int_ids uuid[];
  v_mf_ids uuid[];
  v_div_count int := 0;
  v_int_count int := 0;
  v_mf_count int := 0;
  v_payments_deleted int := 0;
  v_reverted_payables int := 0;
BEGIN
  -- Extract caller JWT role
  BEGIN
    v_jwt_role := (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  -- Role check: admin, supervisor, or service_role
  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND current_user != 'postgres' THEN
    PERFORM public.require_role('admin', 'supervisor');
  END IF;

  v_actor_id := COALESCE(auth.uid(), p_user_id);

  -- 1. Fetch and lock payment batch
  SELECT * INTO v_batch
  FROM public.payment_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment batch with id % not found', p_batch_id;
  END IF;

  -- 2. Verify company access if batch has company_id
  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND v_batch.company_id IS NOT NULL THEN
    IF v_actor_id IS NOT NULL THEN
      IF NOT public.has_company_access(v_actor_id, v_batch.company_id) THEN
        RAISE EXCEPTION 'Unauthorized: caller lacks access to company % for payment batch %', v_batch.company_id, p_batch_id USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- 3. Extract payable IDs grouped by payable_type
  SELECT COALESCE(array_agg(payable_id), '{}') INTO v_div_ids
  FROM public.payments
  WHERE batch_id = p_batch_id
    AND payable_id IS NOT NULL
    AND LOWER(COALESCE(payable_type, '')) IN ('dividend', 'dividend_payables');

  SELECT COALESCE(array_agg(payable_id), '{}') INTO v_int_ids
  FROM public.payments
  WHERE batch_id = p_batch_id
    AND payable_id IS NOT NULL
    AND LOWER(COALESCE(payable_type, '')) IN ('interest', 'interest_payables', 'debenture');

  SELECT COALESCE(array_agg(payable_id), '{}') INTO v_mf_ids
  FROM public.payments
  WHERE batch_id = p_batch_id
    AND payable_id IS NOT NULL
    AND LOWER(COALESCE(payable_type, '')) IN ('mutual_fund', 'mutual_fund_payables');

  -- 4. Reset dividend payables back to Pending
  IF array_length(v_div_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE public.dividend_payables
      SET payment_status = 'Pending'::public.payment_status,
          paid_amount = 0,
          remaining_amount = net_payable,
          payment_date = NULL,
          payment_reference = NULL,
          updated_at = NOW()
      WHERE id = ANY(v_div_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_div_count FROM upd;
    v_reverted_payables := v_reverted_payables + v_div_count;
  END IF;

  -- 5. Reset interest payables back to Pending
  IF array_length(v_int_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE public.interest_payables
      SET payment_status = 'Pending'::public.payment_status,
          paid_amount = 0,
          remaining_amount = net_payable,
          payment_date = NULL,
          payment_reference = NULL,
          updated_at = NOW()
      WHERE id = ANY(v_int_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_int_count FROM upd;
    v_reverted_payables := v_reverted_payables + v_int_count;
  END IF;

  -- 6. Reset mutual fund payables back to Pending
  IF array_length(v_mf_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE public.mutual_fund_payables
      SET payment_status = 'Pending'::public.payment_status,
          payment_date = NULL,
          payment_reference = NULL,
          updated_at = NOW()
      WHERE id = ANY(v_mf_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_mf_count FROM upd;
    v_reverted_payables := v_reverted_payables + v_mf_count;
  END IF;

  -- 7. Delete payment line items for this batch
  WITH del_pmt AS (
    DELETE FROM public.payments
    WHERE batch_id = p_batch_id
    RETURNING id
  )
  SELECT count(*) INTO v_payments_deleted FROM del_pmt;

  -- 8. Delete the payment batch header
  DELETE FROM public.payment_batches
  WHERE id = p_batch_id;

  -- 9. Insert audit log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    table_name,
    record_id,
    new_value
  ) VALUES (
    v_actor_id,
    'REVERT_PAYMENT_BATCH',
    'payment_batches',
    p_batch_id,
    jsonb_build_object(
      'batch_name', v_batch.batch_name,
      'reverted_payables', v_reverted_payables,
      'payments_deleted', v_payments_deleted,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'reverted_payables', v_reverted_payables,
    'payments_deleted', v_payments_deleted
  );
END;
$$;


--

-- Name: revert_reconciliation_lot_atomic(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revert_reconciliation_lot_atomic(p_result_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid;
  v_reverted_payables int := 0;
  v_updated_payments int := 0;
  v_deleted_results int := 0;
  v_div_ids uuid[];
  v_int_ids uuid[];
  v_mf_ids uuid[];
  v_all_payable_ids uuid[];
  v_div_count int := 0;
  v_int_count int := 0;
  v_mf_count int := 0;
BEGIN
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');
  v_uid := auth.uid();

  -- Verify caller has access to the companies of these reconciliation records
  IF current_user != 'service_role' THEN
    IF EXISTS (
      SELECT 1 FROM public.reconciliation_results rr
      WHERE rr.id = ANY(p_result_ids)
        AND rr.company_id IS NOT NULL
        AND NOT public.has_company_access(v_uid, rr.company_id)
    ) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to one or more companies in reconciliation lot' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 1. Extract payable IDs grouped by type
  SELECT COALESCE(array_agg(payable_id), '{}') INTO v_div_ids
  FROM public.reconciliation_results
  WHERE id = ANY(p_result_ids) AND LOWER(COALESCE(payable_type, '')) = 'dividend' AND payable_id IS NOT NULL;

  SELECT COALESCE(array_agg(payable_id), '{}') INTO v_int_ids
  FROM public.reconciliation_results
  WHERE id = ANY(p_result_ids) AND LOWER(COALESCE(payable_type, '')) IN ('interest', 'debenture') AND payable_id IS NOT NULL;

  SELECT COALESCE(array_agg(payable_id), '{}') INTO v_mf_ids
  FROM public.reconciliation_results
  WHERE id = ANY(p_result_ids) AND LOWER(COALESCE(payable_type, '')) = 'mutual_fund' AND payable_id IS NOT NULL;

  v_all_payable_ids := v_div_ids || v_int_ids || v_mf_ids;

  -- 2. Reset payables back to Pending
  IF array_length(v_div_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE public.dividend_payables
      SET payment_status = 'Pending'::public.payment_status,
          paid_amount = 0,
          remaining_amount = net_payable,
          payment_date = NULL,
          payment_reference = NULL,
          updated_at = now()
      WHERE id = ANY(v_div_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_div_count FROM upd;
    v_reverted_payables := v_reverted_payables + v_div_count;
  END IF;

  IF array_length(v_int_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE public.interest_payables
      SET payment_status = 'Pending'::public.payment_status,
          paid_amount = 0,
          remaining_amount = net_payable,
          payment_date = NULL,
          payment_reference = NULL,
          updated_at = now()
      WHERE id = ANY(v_int_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_int_count FROM upd;
    v_reverted_payables := v_reverted_payables + v_int_count;
  END IF;

  IF array_length(v_mf_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE public.mutual_fund_payables
      SET payment_status = 'Pending'::public.payment_status,
          payment_date = NULL,
          payment_reference = NULL,
          updated_at = now()
      WHERE id = ANY(v_mf_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_mf_count FROM upd;
    v_reverted_payables := v_reverted_payables + v_mf_count;
  END IF;

  -- 3. Reset associated payment rows
  IF array_length(v_all_payable_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE public.payments
      SET status = 'Pending', payment_date = NULL, paid_amount = 0, remarks = NULL, payment_reference = NULL, updated_at = now()
      WHERE payable_id = ANY(v_all_payable_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_updated_payments FROM upd;
  END IF;

  -- 4. Delete reconciliation records for this lot
  WITH del AS (
    DELETE FROM public.reconciliation_results
    WHERE id = ANY(p_result_ids)
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_results FROM del;

  -- 5. Clean up any empty RECON-APPLY payment batches that have no active payments
  DELETE FROM public.payment_batches pb
  WHERE pb.cds_batch_ref = 'RECON-APPLY'
    AND NOT EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.batch_id = pb.id
        AND p.status NOT IN ('Failed', 'Cancelled')
    );

  -- 6. Record audit log
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
  VALUES (
    v_uid,
    'RECONCILIATION_LOT_REVERTED',
    'reconciliation_results',
    NULL,
    jsonb_build_object(
      'reverted_payables', v_reverted_payables,
      'updated_payments', v_updated_payments,
      'deleted_results', v_deleted_results,
      'result_ids_count', array_length(p_result_ids, 1)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'reverted_payables', v_reverted_payables,
    'deleted_payments', v_updated_payments,
    'history_deleted', v_deleted_results > 0
  );
END;
$$;


--

-- Name: revert_reconciliation_lot_atomic(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revert_reconciliation_lot_atomic(p_company_id uuid, p_fiscal_year text, p_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor_id uuid;
  v_jwt_role text;
  v_div_count int := 0;
  v_int_count int := 0;
  v_mf_count int := 0;
  v_reverted_payables int := 0;
  v_updated_payments int := 0;
  v_all_payable_ids uuid[] := ARRAY[]::uuid[];
  v_div_ids uuid[] := ARRAY[]::uuid[];
  v_int_ids uuid[] := ARRAY[]::uuid[];
  v_mf_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  -- Extract caller JWT role
  BEGIN
    v_jwt_role := (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  -- Role check: admin, supervisor, or service_role
  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND current_user != 'postgres' THEN
    PERFORM public.require_role('admin', 'supervisor');
  END IF;

  v_actor_id := COALESCE(auth.uid(), p_user_id);

  -- Verify company access
  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND p_company_id IS NOT NULL THEN
    IF v_actor_id IS NOT NULL THEN
      IF NOT public.has_company_access(v_actor_id, p_company_id) THEN
        RAISE EXCEPTION 'Unauthorized: caller lacks access to company %', p_company_id USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- 1. Identify payables in this fiscal year that were marked Paid/Partial
  SELECT array_agg(id) INTO v_div_ids
  FROM public.dividend_payables
  WHERE company_id = p_company_id
    AND fiscal_year = p_fiscal_year
    AND payment_status IN ('Paid', 'Partial');

  SELECT array_agg(id) INTO v_int_ids
  FROM public.interest_payables
  WHERE company_id = p_company_id
    AND fiscal_year = p_fiscal_year
    AND payment_status IN ('Paid', 'Partial');

  SELECT array_agg(id) INTO v_mf_ids
  FROM public.mutual_fund_payables
  WHERE company_id = p_company_id
    AND fiscal_year = p_fiscal_year
    AND payment_status IN ('Paid', 'Partial');

  v_all_payable_ids := array_cat(
    array_cat(COALESCE(v_div_ids, ARRAY[]::uuid[]), COALESCE(v_int_ids, ARRAY[]::uuid[])),
    COALESCE(v_mf_ids, ARRAY[]::uuid[])
  );

  -- 2. Reset payables back to Pending
  IF array_length(v_div_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE public.dividend_payables
      SET payment_status = 'Pending'::public.payment_status,
          paid_amount = 0,
          remaining_amount = net_payable,
          payment_date = NULL,
          payment_reference = NULL,
          updated_at = now()
      WHERE id = ANY(v_div_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_div_count FROM upd;
    v_reverted_payables := v_reverted_payables + v_div_count;
  END IF;

  IF array_length(v_int_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE public.interest_payables
      SET payment_status = 'Pending'::public.payment_status,
          paid_amount = 0,
          remaining_amount = net_payable,
          payment_date = NULL,
          payment_reference = NULL,
          updated_at = now()
      WHERE id = ANY(v_int_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_int_count FROM upd;
    v_reverted_payables := v_reverted_payables + v_int_count;
  END IF;

  IF array_length(v_mf_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE public.mutual_fund_payables
      SET payment_status = 'Pending'::public.payment_status,
          paid_amount = 0,
          remaining_amount = net_payable,
          payment_date = NULL,
          payment_reference = NULL,
          updated_at = now()
      WHERE id = ANY(v_mf_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_mf_count FROM upd;
    v_reverted_payables := v_reverted_payables + v_mf_count;
  END IF;

  -- 3. Reset associated payment rows
  IF array_length(v_all_payable_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE public.payments
      SET status = 'Pending', payment_date = NULL, paid_amount = 0, remarks = NULL, payment_reference = NULL, updated_at = now()
      WHERE payable_id = ANY(v_all_payable_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_updated_payments FROM upd;
  END IF;

  -- 4. Record audit log
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
  VALUES (
    v_actor_id,
    'RECONCILIATION_LOT_REVERTED',
    'reconciliation_lot',
    p_company_id,
    jsonb_build_object(
      'fiscal_year', p_fiscal_year,
      'reverted_payables', v_reverted_payables,
      'dividend_reverted', v_div_count,
      'interest_reverted', v_int_count,
      'mutual_fund_reverted', v_mf_count,
      'updated_payments', v_updated_payments
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'company_id', p_company_id,
    'fiscal_year', p_fiscal_year,
    'reverted_payables', v_reverted_payables,
    'updated_payments', v_updated_payments
  );
END;
$$;


--

-- Name: rollback_upload_atomic(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rollback_upload_atomic(p_upload_id uuid, p_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_rec record;
  v_target_payable_ids uuid[];
  v_target_client_ids uuid[];
  v_interest_deleted int := 0;
  v_dividend_deleted int := 0;
  v_mf_deleted int := 0;
  v_total_payables_deleted int := 0;
  v_payments_cleaned int := 0;
  v_errors_deleted int := 0;
  v_orphans_deleted int := 0;
  v_actor_id uuid;
  v_is_admin boolean;
  v_is_operator boolean;
BEGIN
  -- 1. Enforce strict authentication check
  IF auth.uid() IS NULL AND current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- 2. Verify authorization for authenticated sessions
  IF auth.uid() IS NOT NULL THEN
    v_is_admin := public.has_role(auth.uid(), 'admin'::app_role);
    v_is_operator := public.has_role(auth.uid(), 'finance_operator'::app_role);
    IF NOT (v_is_admin OR v_is_operator) THEN
      RAISE EXCEPTION 'Access denied. Rollback requires admin or finance_operator role.';
    END IF;
  END IF;

  v_actor_id := COALESCE(auth.uid(), p_user_id);

  -- 3. Fetch and lock the upload record
  SELECT * INTO v_rec
  FROM public.upload_history
  WHERE id = p_upload_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Upload record with ID % not found', p_upload_id;
  END IF;

  -- If already rolled back, exit cleanly
  IF v_rec.status = 'RolledBack' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_rolled_back', true,
      'message', 'Upload has already been rolled back.',
      'upload_id', p_upload_id,
      'payables_deleted', 0,
      'clients_deleted', 0,
      'errors_deleted', 0
    );
  END IF;

  -- 4. Capture target payables and candidate clients
  SELECT
    coalesce(array_agg(id), ARRAY[]::uuid[]),
    coalesce(array_agg(DISTINCT client_id) FILTER (WHERE client_id IS NOT NULL), ARRAY[]::uuid[])
  INTO v_target_payable_ids, v_target_client_ids
  FROM (
    SELECT id, client_id FROM public.interest_payables WHERE upload_id = p_upload_id
    UNION ALL
    SELECT id, client_id FROM public.dividend_payables WHERE upload_id = p_upload_id
    UNION ALL
    SELECT id, client_id FROM public.mutual_fund_payables WHERE upload_id = p_upload_id
  ) targets;

  -- 5. Clean up any un-finalized payments referencing payables in this upload
  WITH del_pmts AS (
    DELETE FROM public.payments
    WHERE payable_id = ANY(v_target_payable_ids)
      AND status IN ('Draft', 'Pending', 'Failed', 'Rejected')
    RETURNING id
  )
  SELECT count(*) INTO v_payments_cleaned FROM del_pmts;

  -- 6. Delete interest_payables
  WITH del_int AS (
    DELETE FROM public.interest_payables
    WHERE upload_id = p_upload_id
    RETURNING id
  )
  SELECT count(*) INTO v_interest_deleted FROM del_int;

  -- 7. Delete dividend_payables
  WITH del_div AS (
    DELETE FROM public.dividend_payables
    WHERE upload_id = p_upload_id
    RETURNING id
  )
  SELECT count(*) INTO v_dividend_deleted FROM del_div;

  -- 8. Delete mutual_fund_payables
  WITH del_mf AS (
    DELETE FROM public.mutual_fund_payables
    WHERE upload_id = p_upload_id
    RETURNING id
  )
  SELECT count(*) INTO v_mf_deleted FROM del_mf;

  v_total_payables_deleted := v_interest_deleted + v_dividend_deleted + v_mf_deleted;

  -- 9. Delete upload errors
  WITH del_err AS (
    DELETE FROM public.upload_errors
    WHERE upload_id = p_upload_id
    RETURNING id
  )
  SELECT count(*) INTO v_errors_deleted FROM del_err;

  -- 10. Safely delete orphan clients that belonged to this upload and have no remaining payables
  WITH del_clients AS (
    DELETE FROM public.clients c
    WHERE c.id = ANY(v_target_client_ids)
      AND NOT EXISTS (SELECT 1 FROM public.dividend_payables d WHERE d.client_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.interest_payables i WHERE i.client_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.mutual_fund_payables m WHERE m.client_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.client_id = c.id)
    RETURNING id
  )
  SELECT count(*) INTO v_orphans_deleted FROM del_clients;

  -- 11. Mark this upload record as RolledBack
  UPDATE public.upload_history
  SET
    status = 'RolledBack',
    completed_at = now()
  WHERE id = p_upload_id;

  -- 12. Unblock re-uploading for this specific upload record's exact file_hash
  IF v_rec.file_hash IS NOT NULL AND v_rec.file_hash != '' THEN
    UPDATE public.upload_history
    SET status = 'RolledBack', completed_at = now()
    WHERE file_hash = v_rec.file_hash AND status != 'RolledBack';
  END IF;

  -- 13. Write audit log
  BEGIN
    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_value, new_value)
    VALUES (
      v_actor_id,
      'ROLLBACK_UPLOAD',
      'upload_history',
      p_upload_id::text,
      jsonb_build_object(
        'file_name', v_rec.file_name,
        'sheet_name', v_rec.sheet_name,
        'target_table', v_rec.target_table,
        'previous_status', v_rec.status
      ),
      jsonb_build_object(
        'status', 'RolledBack',
        'payables_deleted', v_total_payables_deleted,
        'interest_deleted', v_interest_deleted,
        'dividend_deleted', v_dividend_deleted,
        'mutual_fund_deleted', v_mf_deleted,
        'payments_cleaned', v_payments_cleaned,
        'errors_deleted', v_errors_deleted,
        'clients_deleted', v_orphans_deleted
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'upload_id', p_upload_id,
    'file_name', v_rec.file_name,
    'sheet_name', v_rec.sheet_name,
    'payables_deleted', v_total_payables_deleted,
    'interest_deleted', v_interest_deleted,
    'dividend_deleted', v_dividend_deleted,
    'mutual_fund_deleted', v_mf_deleted,
    'payments_cleaned', v_payments_cleaned,
    'errors_deleted', v_errors_deleted,
    'clients_deleted', v_orphans_deleted
  );
END;
$$;


--

-- Name: rollback_upload_file_atomic(text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rollback_upload_file_atomic(p_file_hash text DEFAULT NULL::text, p_file_name text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_rec record;
  v_sheets_count int := 0;
  v_total_payables int := 0;
  v_total_clients int := 0;
  v_total_errors int := 0;
  v_sheet_res jsonb;
  v_base_hash text;
BEGIN
  -- 1. Enforce strict authentication check
  IF auth.uid() IS NULL AND current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- 2. Verify authorization
  IF auth.uid() IS NOT NULL THEN
    IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'finance_operator'::app_role)) THEN
      RAISE EXCEPTION 'Access denied. Rollback requires admin or finance_operator role.';
    END IF;
  END IF;

  IF p_file_hash IS NULL AND p_file_name IS NULL THEN
    RAISE EXCEPTION 'Either p_file_hash or p_file_name must be provided';
  END IF;

  IF p_file_hash IS NOT NULL AND position('-' in p_file_hash) > 0 THEN
    v_base_hash := split_part(p_file_hash, '-', 1);
  ELSE
    v_base_hash := p_file_hash;
  END IF;

  FOR v_rec IN
    SELECT id
    FROM public.upload_history
    WHERE status != 'RolledBack'
      AND (
        (v_base_hash IS NOT NULL AND file_hash LIKE (v_base_hash || '%'))
        OR (p_file_name IS NOT NULL AND file_name = p_file_name)
      )
  LOOP
    v_sheet_res := public.rollback_upload_atomic(v_rec.id, p_user_id);
    v_sheets_count := v_sheets_count + 1;
    v_total_payables := v_total_payables + COALESCE((v_sheet_res ->> 'payables_deleted')::int, 0);
    v_total_clients := v_total_clients + COALESCE((v_sheet_res ->> 'clients_deleted')::int, 0);
    v_total_errors := v_total_errors + COALESCE((v_sheet_res ->> 'errors_deleted')::int, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'sheets_rolled_back', v_sheets_count,
    'payables_deleted', v_total_payables,
    'clients_deleted', v_total_clients,
    'errors_deleted', v_total_errors
  );
END;
$$;


--

-- Name: save_system_settings_global(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_system_settings_global(p_settings jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_existing jsonb;
  v_merged jsonb;
  v_is_admin boolean;
BEGIN
  -- Verify caller is admin, postgres, or service_role
  v_is_admin := (current_user IN ('postgres', 'service_role')) OR (auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin'));
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to update system settings.';
  END IF;

  SELECT setting_value INTO v_existing
  FROM public.system_settings
  WHERE setting_key = 'global';

  v_merged := COALESCE(v_existing, '{}'::jsonb) || p_settings;

  -- 1) Preserve smtp_pass if not provided, empty, or placeholder
  IF (COALESCE(p_settings->>'smtp_pass', '') = '' OR p_settings->>'smtp_pass' = '••••••••••••') 
     AND COALESCE(v_existing->>'smtp_pass', '') <> '' THEN
    v_merged := jsonb_set(v_merged, '{smtp_pass}', v_existing->'smtp_pass');
  END IF;

  -- 2) Preserve connectips_token if not provided, empty, or placeholder
  IF (COALESCE(p_settings->>'connectips_token', '') = '' OR p_settings->>'connectips_token' = '••••••••••••')
     AND COALESCE(v_existing->>'connectips_token', '') <> '' THEN
    v_merged := jsonb_set(v_merged, '{connectips_token}', v_existing->'connectips_token');
  END IF;

  -- 3) Preserve connectips_cert_pass if not provided, empty, or placeholder
  IF (COALESCE(p_settings->>'connectips_cert_pass', '') = '' OR p_settings->>'connectips_cert_pass' = '••••••••••••')
     AND COALESCE(v_existing->>'connectips_cert_pass', '') <> '' THEN
    v_merged := jsonb_set(v_merged, '{connectips_cert_pass}', v_existing->'connectips_cert_pass');
  END IF;

  -- 4) Preserve sms_api_key if not provided, empty, or placeholder
  IF (COALESCE(p_settings->>'sms_api_key', '') = '' OR p_settings->>'sms_api_key' = '••••••••••••') 
     AND COALESCE(v_existing->>'sms_api_key', '') <> '' THEN
    v_merged := jsonb_set(v_merged, '{sms_api_key}', v_existing->'sms_api_key');
  END IF;

  -- Remove transient frontend flags before saving to raw setting_value
  v_merged := (v_merged - 'smtp_pass_configured') - 'sms_api_key_configured';

  INSERT INTO public.system_settings (setting_key, setting_value, updated_at)
  VALUES ('global', v_merged, now())
  ON CONFLICT (setting_key)
  DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now();

  RETURN v_merged;
END;
$$;


--

-- Name: set_approval_log_actor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_approval_log_actor() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.performed_by := auth.uid();
  END IF;
  NEW.performed_at := now();
  RETURN NEW;
END;
$$;


--

-- Name: set_audit_log_actor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_audit_log_actor() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  NEW.action_time := now();
  RETURN NEW;
END;
$$;


--

-- Name: set_payment_log_actor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_payment_log_actor() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.performed_by := auth.uid();
  END IF;
  NEW.performed_at := now();
  RETURN NEW;
END;
$$;


--

-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--

-- Name: set_upload_user_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_upload_user_id() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;


--

-- Name: sync_all_classifications_and_taxes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_all_classifications_and_taxes() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--

-- Name: sync_client_payee_classification(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.sync_client_payee_classification() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.classification_status = 'CONFIRMED' THEN
    RETURN NEW;
  END IF;
  IF NEW.classification_status = 'REVIEW_REQUIRED'
     AND COALESCE(NEW.payee_classification, 'UNCLASSIFIED') = 'UNCLASSIFIED' THEN
    RETURN NEW;
  END IF;
  IF NEW.payee_classification IS NOT NULL AND NEW.payee_classification <> 'UNCLASSIFIED' THEN
    RETURN NEW;
  END IF;
  CASE NEW.holder_type::text
    WHEN 'Natural Person - Promoter', 'Promoter' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'PROMOTER';
    WHEN 'Natural Person - Local', 'Local' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'LOCAL';
    WHEN 'Natural Person - Employee', 'Employee' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'EMPLOYEE';
    WHEN 'Natural Person - Public', 'Natural Person - Minor', 'Natural Person - Joint Holder' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'PUBLIC';
    WHEN 'Public' THEN NEW.payee_classification := 'PUBLIC_LEGAL_PERSON'; NEW.payee_segment := 'PUBLIC';
    WHEN 'Legal Person', 'Legal Person - Promoter', 'Institution' THEN NEW.payee_classification := 'COMPANY_INSTITUTION';
    WHEN 'Foreign' THEN NEW.payee_classification := 'FOREIGN_INVESTOR';
    WHEN 'Bank', 'Financial Institution', 'Bank / FI' THEN NEW.payee_classification := 'BANK_FI';
    WHEN 'Mutual Fund', 'Tax Exempt' THEN NEW.payee_classification := 'TAX_EXEMPT';
    ELSE RETURN NEW;
  END CASE;
  NEW.classification_status := 'AUTO_CLASSIFIED';
  NEW.classification_source := COALESCE(NEW.classification_source, 'holder_type');
  RETURN NEW;
END;
$$;


--

-- Name: sync_clients_bonus_holdings(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_clients_bonus_holdings(p_company_id uuid, p_fiscal_year text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '60s'
    AS $$
DECLARE
  v_uid uuid;
  v_is_global_access boolean := false;
  v_user_companies uuid[];
  v_updated_count int := 0;
BEGIN
  -- Prevent premature timeout on large registry datasets
  PERFORM set_config('statement_timeout', '60s', true);

  v_uid := auth.uid();
  IF v_uid IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  -- Verify authorization
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

  IF NOT v_is_global_access AND NOT (p_company_id = ANY(v_user_companies)) THEN
    RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
  END IF;

  -- 1. Identify distinct latest post-bonus holdings for this company & fiscal year
  WITH latest_bonus AS (
    SELECT DISTINCT ON (dp.client_id)
      dp.client_id,
      dp.after_bonus_kitta
    FROM public.dividend_payables dp
    WHERE dp.company_id = p_company_id
      AND dp.fiscal_year = p_fiscal_year
      AND dp.after_bonus_kitta IS NOT NULL
      AND dp.after_bonus_kitta > 0
      AND dp.client_id IS NOT NULL
    ORDER BY dp.client_id, dp.created_at DESC
  ),
  updated AS (
    UPDATE public.clients c
    SET
      kitta = lb.after_bonus_kitta,
      updated_at = NOW()
    FROM latest_bonus lb
    WHERE c.id = lb.client_id
      AND c.company_id = p_company_id
      AND (c.kitta IS NULL OR c.kitta != lb.after_bonus_kitta)
    RETURNING c.id
  )
  SELECT count(*) INTO v_updated_count FROM updated;

  -- 2. Audit Trail
  INSERT INTO public.audit_logs (
    user_id,
    action,
    table_name,
    record_id,
    new_value
  ) VALUES (
    v_uid,
    'SYNC_BONUS_HOLDINGS',
    'clients',
    p_company_id,
    jsonb_build_object(
      'company_id', p_company_id,
      'fiscal_year', p_fiscal_year,
      'clients_updated', v_updated_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'company_id', p_company_id,
    'fiscal_year', p_fiscal_year,
    'updated_count', v_updated_count
  );
END;
$$;


--

-- Name: sync_payables_on_client_classification_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_payables_on_client_classification_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Only cascade if payee_classification or holder_type actually changed
  IF (OLD.payee_classification IS DISTINCT FROM NEW.payee_classification) OR
     (OLD.holder_type IS DISTINCT FROM NEW.holder_type) THEN
    
    -- Reset tds_rate to NULL on pending/unpaid payables so that apply_payable_classification_and_tax
    -- recalculates the tax rate, tax_amount, and net_payable matching the new client classification.
    UPDATE public.dividend_payables
    SET tds_rate = NULL, payee_classification = NEW.payee_classification
    WHERE client_id = NEW.id AND (payment_status IS NULL OR payment_status = 'Pending');

    UPDATE public.interest_payables
    SET tds_rate = NULL, payee_classification = NEW.payee_classification
    WHERE client_id = NEW.id AND (payment_status IS NULL OR payment_status = 'Pending');

    UPDATE public.mutual_fund_payables
    SET tds_rate = NULL, payee_classification = NEW.payee_classification
    WHERE client_id = NEW.id AND (payment_status IS NULL OR payment_status = 'Pending');
  END IF;

  RETURN NEW;
END;
$$;


--

-- Name: trg_clients_set_needs_review(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_clients_set_needs_review() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
BEGIN
  -- Auto-flag rows missing bank account
  IF (NEW.bank_account_no IS NULL OR NEW.bank_account_no = '') THEN
    NEW.needs_review := true;
    NEW.data_quality_notes := COALESCE(NEW.data_quality_notes, '') ||
      CASE WHEN NEW.data_quality_notes IS NOT NULL AND NEW.data_quality_notes != ''
        THEN '; missing_bank_account'
        ELSE 'missing_bank_account'
      END;
  END IF;

  -- Auto-normalize 10-digit NID to 11 digits
  IF NEW.nid_number IS NOT NULL AND NEW.nid_number ~ '^[0-9]{10}$' THEN
    NEW.nid_number := LPAD(NEW.nid_number, 11, '0');
  END IF;

  RETURN NEW;
END;
$_$;


--

-- Name: trg_companies_generic_defaults(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_companies_generic_defaults() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Intelligent Face Value derivation if omitted
  IF NEW.face_value IS NULL OR NEW.face_value <= 0 THEN
    IF (NEW.company_type ILIKE '%debenture%' OR NEW.company_name ILIKE '%debenture%' OR NEW.company_code ILIKE '%d%') THEN
      NEW.face_value := 1000;
    ELSIF (NEW.company_type ILIKE '%mutual fund%' OR NEW.company_name ILIKE '%mutual fund%' OR NEW.company_code ILIKE '%rmf%') THEN
      NEW.face_value := 10;
    ELSE
      NEW.face_value := 100;
    END IF;
  END IF;

  -- Default Registrar (RTA / RTS) if omitted
  IF NEW.registrar IS NULL OR trim(NEW.registrar) = '' THEN
    NEW.registrar := 'RBB Merchant Banking Limited';
  END IF;

  -- Default Status if omitted
  IF NEW.status IS NULL THEN
    NEW.status := 'Active';
  END IF;

  RETURN NEW;
END;
$$;


--

-- Name: trg_fn_sync_payment_batch_completion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_fn_sync_payment_batch_completion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- If currently inside complete_payment_batch_atomic, skip execution
  IF current_setting('rtarts.completing_batch', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Prevent recursive invocations
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- When a batch status changes to Completed, atomically complete all payments and underlying payables
  IF NEW.status = 'Completed' AND (OLD.status IS NULL OR OLD.status != 'Completed') THEN
    PERFORM public.complete_payment_batch_atomic(NEW.id, NEW.approved_by);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: clean_auth_user_tokens(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.clean_auth_user_tokens()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.aud := COALESCE(NULLIF(NEW.aud, ''), 'authenticated');
  NEW.role := COALESCE(NULLIF(NEW.role, ''), 'authenticated');
  NEW.email_change := COALESCE(NEW.email_change, '');
  NEW.email_change_token_new := COALESCE(NEW.email_change_token_new, '');
  NEW.email_change_token_current := COALESCE(NEW.email_change_token_current, '');
  NEW.recovery_token := COALESCE(NEW.recovery_token, '');
  NEW.confirmation_token := COALESCE(NEW.confirmation_token, '');
  NEW.reauthentication_token := COALESCE(NEW.reauthentication_token, '');
  NEW.phone_change := COALESCE(NEW.phone_change, '');
  NEW.phone_change_token := COALESCE(NEW.phone_change_token, '');
  RETURN NEW;
END;
$$;


-- ============================================================================
-- Safe Calculation Trigger Functions (Preserving Overrides)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calc_dividend_payable_safe()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Derive gross if not provided
  IF NEW.gross_dividend IS NULL OR NEW.gross_dividend = 0 THEN
    IF NEW.shares_held IS NOT NULL AND NEW.dividend_rate IS NOT NULL THEN
      NEW.gross_dividend := round(COALESCE(NEW.shares_held, 0) * COALESCE(NEW.dividend_rate, 0), 2);
    END IF;
  END IF;

  -- Preserve manual or imported tax overrides
  IF NEW.is_tax_manual IS TRUE THEN
    IF NEW.tax_amount IS NULL THEN
      NEW.tax_amount := 0.00;
    END IF;
  ELSE
    -- Only recalculate tax if tax_amount was not provided or 0, and a rate exists
    IF (NEW.tax_amount IS NULL OR NEW.tax_amount = 0) AND (NEW.tax_rate IS NOT NULL OR NEW.tds_rate IS NOT NULL) THEN
      NEW.tax_amount := round(COALESCE(NEW.gross_dividend, 0) * COALESCE(NEW.tax_rate, NEW.tds_rate, 0), 2);
    END IF;
  END IF;

  NEW.net_payable := round(COALESCE(NEW.gross_dividend, 0) - COALESCE(NEW.tax_amount, 0), 2);
  NEW.remaining_amount := GREATEST(0, round(COALESCE(NEW.net_payable, 0) - COALESCE(NEW.paid_amount, 0), 2));

  -- Auto-sync payment status when paid_amount reaches net_payable
  IF COALESCE(NEW.paid_amount, 0) >= NEW.net_payable AND NEW.net_payable > 0 THEN
    NEW.payment_status := 'Paid';
  ELSIF COALESCE(NEW.paid_amount, 0) > 0 THEN
    NEW.payment_status := 'Partial';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.calc_interest_payable_safe()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Preserve manual or imported tax overrides
  IF NEW.is_tax_manual IS TRUE THEN
    IF NEW.tax_amount IS NULL THEN
      NEW.tax_amount := 0.00;
    END IF;
  ELSE
    IF (NEW.tax_amount IS NULL OR NEW.tax_amount = 0) AND (NEW.tax_rate IS NOT NULL OR NEW.tds_rate IS NOT NULL) THEN
      NEW.tax_amount := round(COALESCE(NEW.gross_interest, 0) * COALESCE(NEW.tax_rate, NEW.tds_rate, 0), 2);
    END IF;
  END IF;

  NEW.net_payable := round(COALESCE(NEW.gross_interest, 0) - COALESCE(NEW.tax_amount, 0), 2);
  NEW.remaining_amount := GREATEST(0, round(COALESCE(NEW.net_payable, 0) - COALESCE(NEW.paid_amount, 0), 2));

  IF COALESCE(NEW.paid_amount, 0) >= NEW.net_payable AND NEW.net_payable > 0 THEN
    NEW.payment_status := 'Paid';
  ELSIF COALESCE(NEW.paid_amount, 0) > 0 THEN
    NEW.payment_status := 'Partial';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


-- ============================================================================
-- Atomic Upload Progress Tracking
-- ============================================================================

CREATE OR REPLACE FUNCTION public.increment_upload_progress_atomic(
  p_upload_id uuid,
  p_processed_inc integer DEFAULT 0,
  p_success_inc integer DEFAULT 0,
  p_error_inc integer DEFAULT 0,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rec record;
  v_new_status text;
BEGIN
  SELECT * INTO v_rec
  FROM public.upload_history
  WHERE id = p_upload_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Upload record not found');
  END IF;

  v_new_status := v_rec.status;
  IF v_rec.total_rows > 0 AND (COALESCE(v_rec.processed_rows, 0) + p_processed_inc) >= v_rec.total_rows THEN
    IF (COALESCE(v_rec.error_rows, 0) + p_error_inc) > 0 THEN
      IF (COALESCE(v_rec.success_rows, 0) + p_success_inc) = 0 THEN
        v_new_status := 'Failed';
      ELSE
        v_new_status := 'Completed with Errors';
      END IF;
    ELSE
      v_new_status := 'Completed';
    END IF;
  END IF;

  UPDATE public.upload_history
  SET
    processed_rows = COALESCE(processed_rows, 0) + p_processed_inc,
    success_rows   = COALESCE(success_rows, 0) + p_success_inc,
    error_rows     = COALESCE(error_rows, 0) + p_error_inc,
    status         = v_new_status,
    completed_at   = CASE WHEN v_new_status IN ('Completed', 'Completed with Errors', 'Failed') THEN COALESCE(completed_at, now()) ELSE completed_at END,
    error_message  = CASE 
      WHEN p_error_message IS NOT NULL AND p_error_message <> '' THEN 
        COALESCE(NULLIF(error_message, '') || ' ; ', '') || p_error_message
      ELSE error_message 
    END
  WHERE id = p_upload_id
  RETURNING * INTO v_rec;

  RETURN jsonb_build_object(
    'success', true,
    'upload_id', v_rec.id,
    'status', v_rec.status,
    'processed_rows', v_rec.processed_rows,
    'success_rows', v_rec.success_rows,
    'error_rows', v_rec.error_rows,
    'total_rows', v_rec.total_rows
  );
END;
$$;


-- ============================================================================
-- Batch Dispatch Separation
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mark_payment_batch_dispatched_atomic(
  p_batch_id uuid,
  p_dispatched_by uuid DEFAULT NULL,
  p_remarks text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch record;
  v_updated_payments_count integer := 0;
BEGIN
  SELECT * INTO v_batch
  FROM public.payment_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment batch not found');
  END IF;

  IF v_batch.status = 'Completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot dispatch an already completed/settled batch');
  END IF;

  UPDATE public.payment_batches
  SET
    status = 'Processed'::public.payment_batch_status,
    processed_at = COALESCE(processed_at, now()),
    updated_at = now()
  WHERE id = p_batch_id;

  UPDATE public.payments
  SET
    status = 'Dispatched',
    updated_at = now()
  WHERE batch_id = p_batch_id
    AND status NOT IN ('Paid', 'Failed', 'Cancelled', 'Reversed');

  GET DIAGNOSTICS v_updated_payments_count = ROW_COUNT;

  IF p_dispatched_by IS NOT NULL OR p_remarks IS NOT NULL THEN
    BEGIN
      INSERT INTO public.audit_logs(user_id, action, table_name, record_id, new_value)
      VALUES (
        COALESCE(p_dispatched_by, auth.uid()),
        'dispatch_payment_batch',
        'payment_batches',
        p_batch_id,
        jsonb_build_object('remarks', p_remarks, 'dispatched_by', p_dispatched_by)
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'status', 'Dispatched',
    'payments_dispatched', v_updated_payments_count
  );
END;
$$;


-- ============================================================================
-- Reconciliation Settlement Locking
-- ============================================================================

CREATE OR REPLACE FUNCTION public.commit_reconciliation_matches_atomic(
  p_company_id uuid,
  p_matches jsonb,
  p_operator_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item jsonb;
  v_txn_id uuid;
  v_payable_id uuid;
  v_payable_type text;
  v_match_amount numeric(15,2);
  v_reconciled_count integer := 0;
  v_settled_amount numeric(15,2) := 0.00;
BEGIN
  IF p_company_id IS NOT NULL AND NOT public.has_company_access(COALESCE(p_operator_id, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid), p_company_id) THEN
    RAISE EXCEPTION 'Access denied to company %', p_company_id;
  END IF;

  IF p_matches IS NULL OR jsonb_array_length(p_matches) = 0 THEN
    RETURN jsonb_build_object('success', true, 'reconciled_count', 0, 'settled_amount', 0);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_matches)
  LOOP
    v_txn_id := (v_item->>'bank_transaction_id')::uuid;
    v_payable_id := (v_item->>'payable_id')::uuid;
    v_payable_type := COALESCE(v_item->>'payable_type', 'dividend');
    v_match_amount := round(COALESCE((v_item->>'match_amount')::numeric, 0), 2);

    IF v_match_amount <= 0 THEN
      CONTINUE;
    END IF;

    -- 1. Lock bank transaction using FOR UPDATE SKIP LOCKED
    IF v_txn_id IS NOT NULL THEN
      PERFORM 1
      FROM public.bank_transactions
      WHERE id = v_txn_id
      FOR UPDATE SKIP LOCKED;

      IF FOUND THEN
        UPDATE public.bank_transactions
        SET
          is_reconciled = true
        WHERE id = v_txn_id;
      END IF;
    END IF;

    -- 2. Apply settlement to the payable row with paid_amount <= net_payable constraint
    IF v_payable_id IS NOT NULL THEN
      IF v_payable_type = 'interest' THEN
        UPDATE public.interest_payables
        SET
          paid_amount = LEAST(net_payable, round(COALESCE(paid_amount, 0) + v_match_amount, 2)),
          remaining_amount = GREATEST(0, round(net_payable - LEAST(net_payable, round(COALESCE(paid_amount, 0) + v_match_amount, 2)), 2)),
          payment_status = CASE 
            WHEN round(COALESCE(paid_amount, 0) + v_match_amount, 2) >= net_payable THEN 'Paid'::public.payment_status 
            ELSE 'Partial'::public.payment_status 
          END,
          updated_at = now()
        WHERE id = v_payable_id;
      ELSIF v_payable_type = 'mutual_fund' THEN
        UPDATE public.mutual_fund_payables
        SET
          paid_amount = LEAST(net_payable, round(COALESCE(paid_amount, 0) + v_match_amount, 2)),
          remaining_amount = GREATEST(0, round(net_payable - LEAST(net_payable, round(COALESCE(paid_amount, 0) + v_match_amount, 2)), 2)),
          payment_status = CASE 
            WHEN round(COALESCE(paid_amount, 0) + v_match_amount, 2) >= net_payable THEN 'Paid'::public.payment_status 
            ELSE 'Partial'::public.payment_status 
          END,
          updated_at = now()
        WHERE id = v_payable_id;
      ELSE
        UPDATE public.dividend_payables
        SET
          paid_amount = LEAST(net_payable, round(COALESCE(paid_amount, 0) + v_match_amount, 2)),
          remaining_amount = GREATEST(0, round(net_payable - LEAST(net_payable, round(COALESCE(paid_amount, 0) + v_match_amount, 2)), 2)),
          payment_status = CASE 
            WHEN round(COALESCE(paid_amount, 0) + v_match_amount, 2) >= net_payable THEN 'Paid'::public.payment_status 
            ELSE 'Partial'::public.payment_status 
          END,
          updated_at = now()
        WHERE id = v_payable_id;
      END IF;

      -- 3. Update any corresponding payment row to Completed/Paid
      UPDATE public.payments
      SET
        status = 'Paid',
        paid_amount = LEAST(net_amount, round(COALESCE(paid_amount, 0) + v_match_amount, 2)),
        updated_at = now()
      WHERE payable_id = v_payable_id AND status != 'Paid';

      v_reconciled_count := v_reconciled_count + 1;
      v_settled_amount := round(v_settled_amount + v_match_amount, 2);
    END IF;
  END LOOP;

  IF p_operator_id IS NOT NULL OR p_company_id IS NOT NULL THEN
    BEGIN
      INSERT INTO public.audit_logs(user_id, action, table_name, record_id, new_value)
      VALUES (
        COALESCE(p_operator_id, auth.uid()),
        'commit_reconciliation_matches',
        'bank_transactions',
        p_company_id,
        jsonb_build_object('matches_count', v_reconciled_count, 'settled_amount', v_settled_amount)
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reconciled_count', v_reconciled_count,
    'settled_amount', v_settled_amount
  );
END;
$$;


-- ============================================================================
-- Function Execution Grants
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.increment_upload_progress_atomic TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_payment_batch_dispatched_atomic TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commit_reconciliation_matches_atomic TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calc_dividend_payable_safe TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calc_interest_payable_safe TO authenticated, service_role;

