


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';

-- Required Extensions
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pg_cron";
SELECT pg_catalog.set_config('search_path', '', false);




CREATE TYPE "public"."app_role" AS ENUM (
    'admin',
    'finance_operator',
    'reconciliation_officer',
    'auditor',
    'report_viewer',
    'supervisor',
    'operator',
    'maker',
    'checker',
    'approver',
    'read_only'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."approval_status" AS ENUM (
    'Pending',
    'Approved',
    'Rejected'
);


ALTER TYPE "public"."approval_status" OWNER TO "postgres";


CREATE TYPE "public"."dividend_type" AS ENUM (
    'Cash',
    'Stock',
    'Bonus',
    'Right'
);


ALTER TYPE "public"."dividend_type" OWNER TO "postgres";


CREATE TYPE "public"."holder_type" AS ENUM (
    'Natural Person - Public',
    'Natural Person - Promoter',
    'Legal Person',
    'Mutual Fund',
    'Foreign',
    'Tax Exempt',
    'Public',
    'Promoter',
    'Institution',
    'Natural Person - Local',
    'Natural Person - Employee',
    'Natural Person - Minor',
    'Natural Person - Joint Holder',
    'Legal Person - Promoter',
    'Local',
    'Employee'
);


ALTER TYPE "public"."holder_type" OWNER TO "postgres";


CREATE TYPE "public"."interest_rate_type" AS ENUM (
    'Fixed_6',
    'Fixed_6_25',
    'Fixed_7',
    'Fixed_7_5',
    'Floating',
    'Variable_Coupon'
);


ALTER TYPE "public"."interest_rate_type" OWNER TO "postgres";


CREATE TYPE "public"."notification_channel" AS ENUM (
    'Email',
    'SMS',
    'System'
);


ALTER TYPE "public"."notification_channel" OWNER TO "postgres";


CREATE TYPE "public"."payment_batch_status" AS ENUM (
    'Draft',
    'Approved',
    'Processed',
    'Completed',
    'Failed',
    'Pending',
    'Rejected',
    'Returned'
);


ALTER TYPE "public"."payment_batch_status" OWNER TO "postgres";


CREATE TYPE "public"."payment_method" AS ENUM (
    'NEFT',
    'RTGS',
    'ConnectIPS',
    'Cheque',
    'Cash',
    'Manual'
);


ALTER TYPE "public"."payment_method" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'Pending',
    'Paid',
    'Partial'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE TYPE "public"."reconciliation_result" AS ENUM (
    'Matched',
    'Not_Matched',
    'Missing',
    'Duplicate',
    'Over_Paid',
    'Under_Paid',
    'Pending',
    'Pledged',
    'Rejected',
    'Partial',
    'Exception'
);


ALTER TYPE "public"."reconciliation_result" OWNER TO "postgres";


CREATE TYPE "public"."record_status" AS ENUM (
    'Active',
    'Inactive'
);


ALTER TYPE "public"."record_status" OWNER TO "postgres";


CREATE TYPE "public"."residency_type" AS ENUM (
    'Resident',
    'Non-Resident'
);


ALTER TYPE "public"."residency_type" OWNER TO "postgres";


CREATE TYPE "public"."sector_type" AS ENUM (
    'Public',
    'Private',
    'Institution',
    'Government',
    'Other'
);


ALTER TYPE "public"."sector_type" OWNER TO "postgres";


CREATE TYPE "public"."tax_status" AS ENUM (
    'Taxable',
    'Exempted'
);


ALTER TYPE "public"."tax_status" OWNER TO "postgres";


CREATE TYPE "public"."verification_status" AS ENUM (
    'Pending',
    'Verified',
    'Rejected'
);


ALTER TYPE "public"."verification_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_agm_drn_record"("p_company_id" "uuid", "p_folio_no" "text", "p_holder_name" "text", "p_total_kitta" numeric, "p_drn_no" "text" DEFAULT NULL::"text", "p_drn_date" "text" DEFAULT NULL::"text", "p_target_boid" "text" DEFAULT NULL::"text", "p_certificate_no_start" bigint DEFAULT NULL::bigint, "p_certificate_no_end" bigint DEFAULT NULL::bigint, "p_distinctive_no_start" bigint DEFAULT NULL::bigint, "p_distinctive_no_end" bigint DEFAULT NULL::bigint, "p_status" "text" DEFAULT 'ACCEPTED'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."accept_agm_drn_record"("p_company_id" "uuid", "p_folio_no" "text", "p_holder_name" "text", "p_total_kitta" numeric, "p_drn_no" "text", "p_drn_date" "text", "p_target_boid" "text", "p_certificate_no_start" bigint, "p_certificate_no_end" bigint, "p_distinctive_no_start" bigint, "p_distinctive_no_end" bigint, "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_agm_statutory_corrections"("p_company_id" "uuid", "p_corrections" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."apply_agm_statutory_corrections"("p_company_id" "uuid", "p_corrections" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_and_record_reconciliation_batch"("p_run_info" "jsonb", "p_items" "jsonb", "p_batch_info" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '120s'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run_id uuid;
  v_company_id uuid;
  v_batch_id uuid;
  v_item jsonb;
  v_payable_id uuid;
  v_payment_id uuid;
  v_client_id uuid;
  v_target_table text;
  v_result text;
  v_actual_amt numeric;
  v_expected_amt numeric;
  v_paid_amt numeric;
  v_diff numeric;
  v_payment_ref text;
  v_instruction_id text;
  v_fiscal_year text;
  v_match_method text;
  v_confidence numeric;
  v_rule_ver text;
  v_notes text;
  v_idempotency_key text;
  v_existing_status text;
  v_chunk_index int;
  v_requested_chunks int := 1;
  v_ex_expected_chunks int := 1;
  v_expected_chunks int := 1;
  v_requires_approval boolean := false;
  v_approval_record RECORD;
  v_post_state_hash text;
  v_new_payment_status text;
  v_is_final_chunk boolean;
  v_existing_chunks jsonb;
  v_applied_payable_amt numeric;
  v_source_reference text;
  v_rows_affected int := 0;
  v_partial_count int := 0;
  v_rejected_count int := 0;
  v_item_count int := 0;
  
  v_payables_updated int := 0;
  v_payments_created int := 0;
  v_results_inserted int := 0;
  v_exceptions_created int := 0;
  v_already_paid int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_total_amount numeric := 0;
  v_old_paid_amount numeric;
  v_old_payment_status text;
  v_old_payment_date date;
  v_old_payment_reference text;
  v_prior_snapshot jsonb;
  v_pre_run_snapshots jsonb := '{}'::jsonb;
  v_snap_key text;
  v_authoritative_client_id uuid;
  v_authoritative_net numeric(15,2);
  v_result_enum public.reconciliation_result;
  v_ex_company_id uuid;
  v_ex_file_hash text;
  v_ex_source_type text;
  v_ex_fiscal_year text;
  v_ex_created_by uuid;
  v_chunk_hash text;
BEGIN
  -- 1. Authorization check
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');
  END IF;

  v_company_id := NULLIF(p_run_info->>'company_id', '')::uuid;
  v_fiscal_year := NULLIF(p_run_info->>'fiscal_year', '');

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Target company_id is required for reconciliation execution' USING ERRCODE = '23502';
  END IF;

  -- Tenant check
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    IF NOT public.has_company_access(v_uid, v_company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to target company %', v_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Idempotency Check & Multi-Chunk State Management
  v_chunk_index := COALESCE(NULLIF(p_run_info->>'chunk_index', '')::int, 0);
  v_requested_chunks := COALESCE(
    NULLIF(p_run_info->>'total_chunks', '')::int,
    NULLIF(p_run_info->>'expected_chunk_count', '')::int,
    1
  );
  v_expected_chunks := v_requested_chunks;
  v_item_count := jsonb_array_length(p_items);

  -- Validate chunk bounds strictly
  IF v_chunk_index < 0 OR v_chunk_index >= v_expected_chunks THEN
    RAISE EXCEPTION 'Invalid chunk bounds: chunk_index % is out of range for total_chunks %',
      v_chunk_index, v_expected_chunks USING ERRCODE = '22003';
  END IF;

  -- Deterministic chunk content digest
  v_chunk_hash := encode(extensions.digest(p_items::text::bytea, 'sha256'), 'hex');

  v_idempotency_key := NULLIF(p_run_info->>'idempotency_key', '');
  v_run_id := NULLIF(p_run_info->>'run_id', '')::uuid;

  IF v_idempotency_key IS NOT NULL AND v_run_id IS NULL THEN
    SELECT id, status INTO v_run_id, v_existing_status
    FROM public.reconciliation_runs
    WHERE idempotency_key = v_idempotency_key;

    IF v_run_id IS NOT NULL AND v_existing_status = 'applied' AND v_chunk_index = 0 THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'run_id', v_run_id,
        'message', 'Reconciliation run already applied with this idempotency key',
        'payables_updated', 0,
        'payments_created', 0,
        'results_inserted', 0,
        'exceptions_created', 0,
        'already_paid_skipped', 0,
        'errors', '[]'::jsonb
      );
    END IF;
  END IF;

  IF v_run_id IS NOT NULL THEN
    -- Acquire exclusive row lock on reconciliation_runs to serialize concurrent retries
    SELECT status, COALESCE(processed_chunks, '{}'::jsonb), batch_id, COALESCE(expected_chunk_count, 1),
           company_id, file_hash_sha256, source_type, fiscal_year, created_by
    INTO v_existing_status, v_existing_chunks, v_batch_id, v_ex_expected_chunks,
         v_ex_company_id, v_ex_file_hash, v_ex_source_type, v_ex_fiscal_year, v_ex_created_by
    FROM public.reconciliation_runs
    WHERE id = v_run_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reconciliation run % not found', v_run_id USING ERRCODE = '23503';
    END IF;

    -- Validate immutable metadata against stored run on retry / chunk submission
    IF v_ex_company_id IS DISTINCT FROM v_company_id THEN
      RAISE EXCEPTION 'Run metadata mismatch: company_id % does not match run company_id %', v_company_id, v_ex_company_id USING ERRCODE = '23514';
    END IF;

    IF NULLIF(p_run_info->>'file_hash_sha256', '') IS NOT NULL AND v_ex_file_hash IS NOT NULL AND v_ex_file_hash != p_run_info->>'file_hash_sha256' THEN
      RAISE EXCEPTION 'Run metadata mismatch: file_hash_sha256 does not match run record' USING ERRCODE = '23514';
    END IF;

    IF NULLIF(p_run_info->>'source_type', '') IS NOT NULL AND v_ex_source_type != p_run_info->>'source_type' THEN
      RAISE EXCEPTION 'Run metadata mismatch: source_type does not match run record' USING ERRCODE = '23514';
    END IF;

    IF NULLIF(p_run_info->>'fiscal_year', '') IS NOT NULL AND v_ex_fiscal_year IS NOT NULL AND v_ex_fiscal_year != p_run_info->>'fiscal_year' THEN
      RAISE EXCEPTION 'Run metadata mismatch: fiscal_year does not match run record' USING ERRCODE = '23514';
    END IF;

    IF v_requested_chunks != v_ex_expected_chunks THEN
      RAISE EXCEPTION 'Run metadata mismatch: total_chunks % does not match expected_chunk_count %', v_requested_chunks, v_ex_expected_chunks USING ERRCODE = '23514';
    END IF;

    v_expected_chunks := v_ex_expected_chunks;

    -- Chunk-level idempotency and payload collision verification
    IF v_existing_chunks ? v_chunk_index::text THEN
      IF (v_existing_chunks->>v_chunk_index::text) = v_chunk_hash OR (v_existing_chunks->>v_chunk_index::text) = 'true' THEN
        RETURN jsonb_build_object(
          'success', true,
          'idempotent', true,
          'run_id', v_run_id,
          'batch_id', v_batch_id,
          'message', 'Reconciliation chunk ' || v_chunk_index || ' already applied',
          'payables_updated', 0,
          'payments_created', 0,
          'results_inserted', 0,
          'exceptions_created', 0,
          'already_paid_skipped', 0,
          'errors', '[]'::jsonb
        );
      ELSE
        RAISE EXCEPTION 'Chunk % payload collision: incoming chunk hash does not match previously processed chunk', v_chunk_index USING ERRCODE = '23514';
      END IF;
    END IF;

    -- If run was previously marked applied, protect against re-run
    IF v_existing_status = 'applied' THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'run_id', v_run_id,
        'batch_id', v_batch_id,
        'message', 'Reconciliation run already finalized',
        'payables_updated', 0,
        'payments_created', 0,
        'results_inserted', 0,
        'exceptions_created', 0,
        'already_paid_skipped', 0,
        'errors', '[]'::jsonb
      );
    END IF;

    IF jsonb_typeof(v_existing_chunks) != 'object' THEN
      v_existing_chunks := '{}'::jsonb;
    END IF;
    v_existing_chunks := jsonb_set(
      v_existing_chunks,
      ARRAY[v_chunk_index::text],
      to_jsonb(v_chunk_hash)
    );
  ELSE
    v_existing_chunks := jsonb_build_object(v_chunk_index::text, v_chunk_hash);
  END IF;

  IF v_run_id IS NULL THEN
    INSERT INTO public.reconciliation_runs (
      company_id,
      fiscal_year,
      idempotency_key,
      source_type,
      file_name,
      file_hash_sha256,
      row_count,
      total_amount,
      parser_version,
      matching_rule_version,
      status,
      processed_chunks,
      expected_chunk_count,
      applied_by,
      applied_at,
      created_by
    ) VALUES (
      v_company_id,
      v_fiscal_year,
      v_idempotency_key,
      COALESCE(NULLIF(p_run_info->>'source_type', ''), 'excel'),
      COALESCE(NULLIF(p_run_info->>'file_name', ''), 'Reconciliation Batch'),
      COALESCE(NULLIF(p_run_info->>'file_hash_sha256', ''), md5(now()::text || p_run_info::text)),
      0,
      0,
      COALESCE(NULLIF(p_run_info->>'parser_version', ''), '2.0.0'),
      COALESCE(NULLIF(p_run_info->>'matching_rule_version', ''), '2.0.0'),
      'processing',
      v_existing_chunks,
      v_expected_chunks,
      NULL,
      NULL,
      v_uid
    ) RETURNING id INTO v_run_id;
    v_ex_created_by := v_uid;
  END IF;

  -- Server-authoritative finalization check: only finalize when all chunks 0..expected_chunks-1 are recorded
  v_is_final_chunk := true;
  FOR i IN 0..(v_expected_chunks - 1) LOOP
    IF NOT (v_existing_chunks ? i::text) THEN
      v_is_final_chunk := false;
      EXIT;
    END IF;
  END LOOP;

  -- 3. Create or Link Payment Batch if requested
  IF p_batch_info IS NOT NULL AND jsonb_typeof(p_batch_info) = 'object' THEN
    v_batch_id := NULLIF(p_batch_info->>'batch_id', '')::uuid;
    IF v_batch_id IS NULL THEN
      INSERT INTO public.payment_batches (
        batch_name,
        payable_type,
        company_id,
        status,
        cds_batch_ref,
        total_payments,
        total_amount,
        total_tax,
        created_by
      ) VALUES (
        COALESCE(NULLIF(p_batch_info->>'batch_name', ''), 'Reconciliation Auto-Batch ' || to_char(now(), 'YYYY-MM-DD')),
        COALESCE(NULLIF(p_batch_info->>'payable_type', ''), 'dividend'),
        v_company_id,
        'Draft'::public.payment_batch_status,
        COALESCE(NULLIF(p_batch_info->>'cds_batch_ref', ''), 'RECON-APPLY'),
        COALESCE(NULLIF(p_batch_info->>'total_records', '')::int, 0),
        COALESCE(NULLIF(p_batch_info->>'total_net', '')::numeric, 0),
        COALESCE(NULLIF(p_batch_info->>'total_tax', '')::numeric, 0),
        v_uid
      ) RETURNING id INTO v_batch_id;

      -- Update run with linked batch
      UPDATE public.reconciliation_runs SET batch_id = v_batch_id WHERE id = v_run_id;
    END IF;
  ELSIF v_batch_id IS NULL AND v_run_id IS NOT NULL THEN
    -- In subsequent chunks (where p_batch_info is null), inherit batch_id from the existing run
    SELECT batch_id INTO v_batch_id FROM public.reconciliation_runs WHERE id = v_run_id;
  END IF;

  -- Pre-execution in-memory snapshot map: snapshot each unique payable exactly once per run before mutations occur
  v_pre_run_snapshots := '{}'::jsonb;

  -- Populate pre-execution snapshots for all distinct payables in this batch
  FOR v_item IN
    SELECT jsonb_build_object(
      'p_type', LOWER(COALESCE(NULLIF(elem->>'target_table', ''), NULLIF(elem->>'payable_type', ''), 'dividend')),
      'p_id', NULLIF(elem->>'payable_id', '')
    )
    FROM jsonb_array_elements(p_items) AS elem
    WHERE NULLIF(elem->>'payable_id', '') IS NOT NULL
    GROUP BY 1
  LOOP
    v_snap_key := (v_item->>'p_type') || '_' || (v_item->>'p_id');
    v_old_paid_amount := NULL;
    v_old_payment_status := NULL;
    v_old_payment_date := NULL;
    v_old_payment_reference := NULL;
    v_prior_snapshot := NULL;

    -- 1. If an earlier chunk of this run already captured this payable, inherit that baseline snapshot
    SELECT
      rr.prior_paid_amount,
      rr.prior_payment_status,
      rr.prior_payment_date,
      rr.prior_payment_reference,
      rr.prior_snapshot
    INTO
      v_old_paid_amount,
      v_old_payment_status,
      v_old_payment_date,
      v_old_payment_reference,
      v_prior_snapshot
    FROM public.reconciliation_results rr
    WHERE rr.run_id = v_run_id
      AND rr.payable_id = (v_item->>'p_id')::uuid
      AND rr.payable_type = (v_item->>'p_type')
      AND (rr.prior_snapshot IS NOT NULL OR rr.prior_payment_status IS NOT NULL)
    ORDER BY rr.id ASC
    LIMIT 1;

    -- 2. If not found in earlier results of this run, query live payable table FOR UPDATE
    -- STRICT TENANT VERIFICATION: Payable MUST belong to v_company_id
    IF v_old_payment_status IS NULL AND v_prior_snapshot IS NULL THEN
      IF (v_item->>'p_type') LIKE '%dividend%' THEN
        SELECT
          p.paid_amount,
          p.payment_status::text,
          p.payment_date,
          p.payment_reference,
          p.client_id,
          p.net_payable,
          to_jsonb(p)
        INTO
          v_old_paid_amount,
          v_old_payment_status,
          v_old_payment_date,
          v_old_payment_reference,
          v_authoritative_client_id,
          v_authoritative_net,
          v_prior_snapshot
        FROM public.dividend_payables p
        WHERE p.id = (v_item->>'p_id')::uuid
          AND p.company_id = v_company_id
        FOR UPDATE;

      ELSIF (v_item->>'p_type') LIKE '%interest%' OR (v_item->>'p_type') LIKE '%debenture%' THEN
        SELECT
          p.paid_amount,
          p.payment_status::text,
          p.payment_date,
          p.payment_reference,
          p.client_id,
          p.net_payable,
          to_jsonb(p)
        INTO
          v_old_paid_amount,
          v_old_payment_status,
          v_old_payment_date,
          v_old_payment_reference,
          v_authoritative_client_id,
          v_authoritative_net,
          v_prior_snapshot
        FROM public.interest_payables p
        WHERE p.id = (v_item->>'p_id')::uuid
          AND p.company_id = v_company_id
        FOR UPDATE;

      ELSIF (v_item->>'p_type') LIKE '%mutual%' THEN
        SELECT
          p.paid_amount,
          p.payment_status::text,
          p.payment_date,
          p.payment_reference,
          p.client_id,
          p.net_payable,
          to_jsonb(p)
        INTO
          v_old_paid_amount,
          v_old_payment_status,
          v_old_payment_date,
          v_old_payment_reference,
          v_authoritative_client_id,
          v_authoritative_net,
          v_prior_snapshot
        FROM public.mutual_fund_payables p
        WHERE p.id = (v_item->>'p_id')::uuid
          AND p.company_id = v_company_id
        FOR UPDATE;
      END IF;
    END IF;

    IF v_old_payment_status IS NOT NULL OR v_prior_snapshot IS NOT NULL THEN
      v_pre_run_snapshots := jsonb_set(
        v_pre_run_snapshots,
        ARRAY[v_snap_key],
        jsonb_build_object(
          'prior_paid_amount', v_old_paid_amount,
          'prior_payment_status', v_old_payment_status,
          'prior_payment_date', v_old_payment_date,
          'prior_payment_reference', v_old_payment_reference,
          'client_id', v_authoritative_client_id,
          'net_payable', v_authoritative_net,
          'full_snapshot', v_prior_snapshot
        ),
        true
      );
    END IF;
  END LOOP;

  -- 4. Process each reconciliation item atomically
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_payable_id   := NULLIF(v_item->>'payable_id', '')::uuid;
      v_client_id    := NULLIF(v_item->>'client_id', '')::uuid;
      v_target_table := LOWER(COALESCE(NULLIF(v_item->>'target_table', ''), NULLIF(v_item->>'payable_type', ''), 'dividend'));
      v_result       := UPPER(COALESCE(NULLIF(v_item->>'reconciliation_result', ''), NULLIF(v_item->>'result', ''), 'MATCHED'));
      v_actual_amt   := COALESCE(NULLIF(v_item->>'actual_amount', '')::numeric, 0);
      v_expected_amt := COALESCE(NULLIF(v_item->>'expected_amount', '')::numeric, 0);
      v_diff         := COALESCE(NULLIF(v_item->>'difference', '')::numeric, v_actual_amt - v_expected_amt);
      v_payment_ref  := COALESCE(NULLIF(v_item->>'payment_reference', ''), NULLIF(v_item->>'reference_id', ''), 'RECON-' || substr(COALESCE(v_run_id::text, gen_random_uuid()::text), 1, 8));
      v_instruction_id := COALESCE(NULLIF(v_item->>'instruction_id', ''), NULLIF(v_item->>'connectips_ref', ''));
      v_match_method := COALESCE(NULLIF(v_item->>'match_method', ''), 'instruction_id');
      v_confidence   := COALESCE(NULLIF(v_item->>'match_confidence', '')::numeric, 80);
      v_rule_ver     := COALESCE(NULLIF(v_item->>'rule_version', ''), '2.0.0');
      v_notes        := NULLIF(v_item->>'notes', '');

      -- Fetch pre-execution snapshot from in-memory snapshots
      v_old_paid_amount := NULL;
      v_old_payment_status := NULL;
      v_old_payment_date := NULL;
      v_old_payment_reference := NULL;
      v_prior_snapshot := NULL;
      IF v_payable_id IS NOT NULL THEN
        v_snap_key := v_target_table || '_' || v_payable_id::text;
        IF v_pre_run_snapshots ? v_snap_key THEN
          v_old_paid_amount := (v_pre_run_snapshots->v_snap_key->>'prior_paid_amount')::numeric;
          v_old_payment_status := v_pre_run_snapshots->v_snap_key->>'prior_payment_status';
          v_old_payment_date := (v_pre_run_snapshots->v_snap_key->>'prior_payment_date')::date;
          v_old_payment_reference := v_pre_run_snapshots->v_snap_key->>'prior_payment_reference';
          v_prior_snapshot := v_pre_run_snapshots->v_snap_key->'full_snapshot';
          -- Authoritatively derive client_id from database row
          v_client_id := COALESCE(NULLIF(v_pre_run_snapshots->v_snap_key->>'client_id', '')::uuid, v_client_id);
          IF v_expected_amt <= 0 THEN
            v_expected_amt := COALESCE((v_pre_run_snapshots->v_snap_key->>'net_payable')::numeric, 0);
            v_diff := v_actual_amt - v_expected_amt;
          END IF;
        ELSE
          -- Payable not found under target company: strictly reject settlement to prevent cross-company corruption
          v_notes := COALESCE(v_notes || '; ', '') || 'Rejected: payable not found in target company ' || v_company_id::text;
          v_result := 'EXCEPTION';
          v_payable_id := NULL;
        END IF;
      END IF;

      v_result_enum := CASE v_result
        WHEN 'MATCHED' THEN 'Matched'::public.reconciliation_result
        WHEN 'NOT_MATCHED' THEN 'Not_Matched'::public.reconciliation_result
        WHEN 'MISSING' THEN 'Missing'::public.reconciliation_result
        WHEN 'DUPLICATE' THEN 'Duplicate'::public.reconciliation_result
        WHEN 'OVER_PAID' THEN 'Over_Paid'::public.reconciliation_result
        WHEN 'UNDER_PAID' THEN 'Under_Paid'::public.reconciliation_result
        WHEN 'PARTIAL' THEN 'Partial'::public.reconciliation_result
        WHEN 'PENDING' THEN 'Pending'::public.reconciliation_result
        WHEN 'PLEDGED' THEN 'Pledged'::public.reconciliation_result
        WHEN 'REJECTED' THEN 'Rejected'::public.reconciliation_result
        WHEN 'EXCEPTION' THEN 'Exception'::public.reconciliation_result
        ELSE 'Not_Matched'::public.reconciliation_result
      END;

      -- Strictly require positive actual amount for settlement (never fall back to expected_amount)
      v_paid_amt := v_actual_amt;
      v_total_amount := v_total_amount + GREATEST(0, v_paid_amt);
      v_payment_id := NULL;

      -- Derive deterministic, unique source reference per record in run BEFORE any mutation
      v_source_reference := COALESCE(
        NULLIF(v_item->>'source_reference', ''),
        NULLIF(v_item->>'id', ''),
        NULLIF(v_item->>'instruction_id', ''),
        NULLIF(v_item->>'connectips_ref', ''),
        NULLIF(v_item->>'payment_reference', ''),
        NULLIF(v_item->>'reference_id', ''),
        'ITEM-' || md5(v_item::text)
      );

      -- Check duplicate source reference BEFORE any financial mutation (skip if already committed in this run)
      IF EXISTS (
        SELECT 1 FROM public.reconciliation_results
        WHERE run_id = v_run_id AND source_reference = v_source_reference
          AND post_state_hash IS NOT NULL
      ) THEN
        INSERT INTO public.reconciliation_exceptions (
          run_id,
          company_id,
          payable_id,
          payable_type,
          source_reference,
          amount,
          exception_reason,
          status,
          created_by
        ) VALUES (
          v_run_id,
          v_company_id,
          v_payable_id,
          v_target_table,
          v_source_reference,
          v_actual_amt,
          'Duplicate source reference detected within run: ' || v_source_reference,
          'Open',
          v_uid
        );
        v_exceptions_created := v_exceptions_created + 1;
        CONTINUE; -- Strictly skip mutation on duplicate source reference
      END IF;

      -- Server-side Maker-Checker Variance Approval Check:
      -- Variance (UNDER_PAID / OVER_PAID) can only be settled if an authorized supervisor/admin (who is NOT the maker)
      -- has approved the variance in public.reconciliation_variance_approvals.
      IF v_result IN ('UNDER_PAID', 'OVER_PAID') THEN
        SELECT id, company_id, variance_type, expected_amount, actual_amount, variance_amount, maker_id, approved_by, approval_reason
        INTO v_approval_record
        FROM public.reconciliation_variance_approvals
        WHERE run_id = v_run_id
          AND payable_id = v_payable_id
          AND COALESCE(source_reference, '') = COALESCE(v_source_reference, '')
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_approval_record.id IS NOT NULL THEN
          -- Amount and metadata parity check: verify approved variance matches item exactly
          IF v_approval_record.company_id != v_company_id OR
             v_approval_record.variance_type != v_result OR
             ABS(COALESCE(v_approval_record.expected_amount, 0) - v_expected_amt) > 0.005 OR
             ABS(COALESCE(v_approval_record.actual_amount, 0) - v_actual_amt) > 0.005 OR
             ABS(COALESCE(v_approval_record.variance_amount, 0) - ABS(v_actual_amt - v_expected_amt)) > 0.005 THEN
            v_requires_approval := true;
            v_notes := COALESCE(v_notes || '; ', '') || 'Variance approval invalid: approval amounts or metadata do not match current transaction';
          -- Maker-checker verification: Approver cannot be run creator or recorded maker
          ELSIF v_approval_record.approved_by = COALESCE(v_ex_created_by, v_approval_record.maker_id) THEN
            v_requires_approval := true;
            v_notes := COALESCE(v_notes || '; ', '') || 'Variance approval refused: maker-checker violation (approver cannot be reconciler)';
          ELSE
            v_requires_approval := false;
            v_notes := COALESCE(v_notes || '; ', '') || 'Variance approved by ' || v_approval_record.approved_by::text || ' (' || v_approval_record.approval_reason || ')';
          END IF;
        ELSE
          v_requires_approval := true;
        END IF;
      ELSE
        v_requires_approval := false;
      END IF;

      IF v_requires_approval THEN
        v_notes := COALESCE(v_notes || '; ', '') || 'Variance requires manual supervisor approval before settlement for ' || v_result;
        v_payment_id := NULL;
        INSERT INTO public.reconciliation_exceptions (
          run_id,
          company_id,
          payable_id,
          payable_type,
          source_reference,
          amount,
          exception_reason,
          status,
          created_by
        ) VALUES (
          v_run_id,
          v_company_id,
          v_payable_id,
          v_target_table,
          v_source_reference,
          v_actual_amt,
          'Variance (' || v_result || ') requires manual supervisor approval before settlement',
          'Open',
          v_uid
        );
        v_exceptions_created := v_exceptions_created + 1;
      -- A. Settle payable if payable_id exists and status is MATCHED / PARTIAL or an approved variance
      ELSIF v_payable_id IS NOT NULL AND (v_result IN ('MATCHED', 'PARTIAL') OR (v_result IN ('OVER_PAID', 'UNDER_PAID') AND NOT v_requires_approval)) THEN
        IF v_paid_amt <= 0 THEN
          -- Strictly reject zero or negative actual amounts: underpayments or malformed rows must never settle as paid
          v_notes := COALESCE(v_notes || '; ', '') || 'Settlement rejected: actual payment amount must be strictly positive';
          v_result := 'EXCEPTION';
          v_result_enum := 'Exception'::public.reconciliation_result;
          v_payment_id := NULL;
        ELSIF v_old_payment_status = 'Paid' THEN
          -- SHORT-CIRCUIT: Payable is already Paid before this run; do NOT create duplicate payment record
          v_already_paid := v_already_paid + 1;
          v_notes := COALESCE(v_notes || '; ', '') || 'Payable already Paid prior to reconciliation run';
          v_payment_id := NULL;
        ELSE
          -- Apply settlement update to payable:
          -- UNDER_PAID and PARTIAL, or any remaining balance > 0.005 MUST set payment_status = 'Partial'
          IF v_target_table LIKE '%dividend%' THEN
            UPDATE public.dividend_payables
            SET payment_status = CASE 
                  WHEN v_result IN ('PARTIAL', 'UNDER_PAID') OR (COALESCE(net_payable, 0) - (COALESCE(paid_amount, 0) + v_paid_amt)) > 0.005 THEN 'Partial'::public.payment_status 
                  ELSE 'Paid'::public.payment_status 
                END,
                paid_amount = LEAST(net_payable, COALESCE(paid_amount, 0) + v_paid_amt),
                remaining_amount = GREATEST(0, COALESCE(net_payable, 0) - (COALESCE(paid_amount, 0) + v_paid_amt)),
                payment_date = COALESCE(payment_date, CURRENT_DATE),
                payment_reference = COALESCE(payment_reference, v_payment_ref),
                updated_at = now()
            WHERE id = v_payable_id
              AND company_id = v_company_id
              AND payment_status != 'Paid'
            RETURNING payment_status::text INTO v_new_payment_status;

            IF FOUND THEN
              v_payables_updated := v_payables_updated + 1;
            ELSE
              v_already_paid := v_already_paid + 1;
            END IF;

          ELSIF v_target_table LIKE '%interest%' OR v_target_table LIKE '%debenture%' THEN
            UPDATE public.interest_payables
            SET payment_status = CASE 
                  WHEN v_result IN ('PARTIAL', 'UNDER_PAID') OR (COALESCE(net_payable, 0) - (COALESCE(paid_amount, 0) + v_paid_amt)) > 0.005 THEN 'Partial'::public.payment_status 
                  ELSE 'Paid'::public.payment_status 
                END,
                paid_amount = LEAST(net_payable, COALESCE(paid_amount, 0) + v_paid_amt),
                remaining_amount = GREATEST(0, COALESCE(net_payable, 0) - (COALESCE(paid_amount, 0) + v_paid_amt)),
                payment_date = COALESCE(payment_date, CURRENT_DATE),
                payment_reference = COALESCE(payment_reference, v_payment_ref),
                updated_at = now()
            WHERE id = v_payable_id
              AND company_id = v_company_id
              AND payment_status != 'Paid'
            RETURNING payment_status::text INTO v_new_payment_status;

            IF FOUND THEN
              v_payables_updated := v_payables_updated + 1;
            ELSE
              v_already_paid := v_already_paid + 1;
            END IF;

          ELSIF v_target_table LIKE '%mutual%' THEN
            UPDATE public.mutual_fund_payables
            SET payment_status = CASE 
                  WHEN v_result IN ('PARTIAL', 'UNDER_PAID') OR (COALESCE(net_payable, 0) - (COALESCE(paid_amount, 0) + v_paid_amt)) > 0.005 THEN 'Partial'::public.payment_status 
                  ELSE 'Paid'::public.payment_status 
                END,
                paid_amount = LEAST(net_payable, COALESCE(paid_amount, 0) + v_paid_amt),
                remaining_amount = GREATEST(0, COALESCE(net_payable, 0) - (COALESCE(paid_amount, 0) + v_paid_amt)),
                payment_date = COALESCE(payment_date, CURRENT_DATE),
                payment_reference = COALESCE(payment_reference, v_payment_ref),
                updated_at = now()
            WHERE id = v_payable_id
              AND company_id = v_company_id
              AND payment_status != 'Paid'
            RETURNING payment_status::text INTO v_new_payment_status;

            IF FOUND THEN
              v_payables_updated := v_payables_updated + 1;
            ELSE
              v_already_paid := v_already_paid + 1;
            END IF;
          END IF;

          -- Compute deterministic post-state hash for infallible reversal verification
          v_post_state_hash := encode(extensions.digest((
            v_payable_id::text || '|' ||
            v_target_table || '|' ||
            (COALESCE(v_old_paid_amount, 0) + v_paid_amt)::text || '|' ||
            COALESCE(v_new_payment_status, 'Paid') || '|' ||
            COALESCE(v_payment_ref, '')
          )::bytea, 'sha256'), 'hex');

          -- Reconcile matching bank statement transaction
          IF v_source_reference IS NOT NULL THEN
            UPDATE public.bank_statement_transactions
            SET reconciliation_status = 'reconciled',
                reconciliation_run_id = v_run_id
            WHERE company_id = v_company_id
              AND (reference = v_source_reference OR transaction_fingerprint = v_source_reference);
          END IF;

          -- Deduplicate payment: prevent duplicate payment creation for the same payable in this run
          SELECT id INTO v_payment_id
          FROM public.payments
          WHERE reconciliation_run_id = v_run_id
            AND payable_id = v_payable_id
            AND payable_type = v_target_table
          LIMIT 1;

          IF v_payment_id IS NULL THEN
            -- Cap payments.paid_amount/net_amount at expected_amount (net_payable) to preserve ledger balance invariants
            v_applied_payable_amt := CASE 
              WHEN v_expected_amt > 0 THEN LEAST(v_expected_amt, v_paid_amt) 
              ELSE v_paid_amt 
            END;

            -- Create or stamp payment record with reconciliation_run_id
            INSERT INTO public.payments (
              batch_id,
              reconciliation_run_id,
              company_id,
              client_id,
              payable_type,
              payable_id,
              gross_amount,
              tax_amount,
              net_amount,
              paid_amount,
              payment_method,
              payment_date,
              payment_reference,
              connectips_ref,
              status,
              processed_by,
              processed_at
            ) VALUES (
              v_batch_id,
              v_run_id,
              v_company_id,
              v_client_id,
              v_target_table,
              v_payable_id,
              v_applied_payable_amt,
              0,
              v_applied_payable_amt,
              v_applied_payable_amt,
              'ConnectIPS'::public.payment_method,
              CURRENT_DATE,
              v_payment_ref,
              v_instruction_id,
              'Paid',
              v_uid,
              now()
            ) RETURNING id INTO v_payment_id;

            v_payments_created := v_payments_created + 1;
          END IF;
        END IF;
      END IF;

      -- B. Persist result record in reconciliation_results linked to run_id
      INSERT INTO public.reconciliation_results (
        run_id,
        reconciliation_date,
        source_reference,
        source_a_type,
        source_a_id,
        source_b_type,
        source_b_id,
        client_id,
        company_id,
        fiscal_year,
        payable_type,
        payable_id,
        payment_id,
        batch_id,
        expected_amount,
        actual_amount,
        difference,
        result,
        notes,
        match_method,
        match_confidence,
        candidate_count,
        rejected_candidates,
        rule_version,
        requires_manual_approval,
        matched_by,
        matched_at,
        prior_paid_amount,
        prior_payment_status,
        prior_payment_date,
        prior_payment_reference,
        prior_snapshot,
        post_state_hash
      ) VALUES (
        v_run_id,
        CURRENT_DATE,
        v_source_reference,
        COALESCE(NULLIF(v_item->>'source_a_type', ''), 'bank_statement'),
        NULLIF(v_item->>'source_a_id', '')::uuid,
        COALESCE(NULLIF(v_item->>'source_b_type', ''), 'payable'),
        COALESCE(v_payment_id, v_payable_id),
        v_client_id,
        v_company_id,
        v_fiscal_year,
        v_target_table,
        v_payable_id,
        v_payment_id,
        v_batch_id,
        v_expected_amt,
        v_actual_amt,
        v_diff,
        v_result_enum,
        v_notes,
        v_match_method,
        v_confidence,
        COALESCE(NULLIF(v_item->>'candidate_count', '')::int, 1),
        COALESCE(v_item->'rejected_candidates', '[]'::jsonb),
        v_rule_ver,
        v_requires_approval,
        v_uid,
        now(),
        v_old_paid_amount,
        v_old_payment_status,
        v_old_payment_date,
        v_old_payment_reference,
        v_prior_snapshot,
        v_post_state_hash
      )
      ON CONFLICT (run_id, source_reference) WHERE run_id IS NOT NULL DO UPDATE SET
        payment_id = EXCLUDED.payment_id,
        reconciliation_date = EXCLUDED.reconciliation_date,
        source_a_type = EXCLUDED.source_a_type,
        source_a_id = EXCLUDED.source_a_id,
        source_b_type = EXCLUDED.source_b_type,
        source_b_id = EXCLUDED.source_b_id,
        payable_type = EXCLUDED.payable_type,
        payable_id = EXCLUDED.payable_id,
        expected_amount = EXCLUDED.expected_amount,
        actual_amount = EXCLUDED.actual_amount,
        difference = EXCLUDED.difference,
        result = EXCLUDED.result,
        notes = EXCLUDED.notes,
        match_method = EXCLUDED.match_method,
        match_confidence = EXCLUDED.match_confidence,
        rule_version = EXCLUDED.rule_version,
        requires_manual_approval = EXCLUDED.requires_manual_approval,
        matched_by = EXCLUDED.matched_by,
        matched_at = EXCLUDED.matched_at,
        prior_paid_amount = EXCLUDED.prior_paid_amount,
        prior_payment_status = EXCLUDED.prior_payment_status,
        prior_payment_date = EXCLUDED.prior_payment_date,
        prior_payment_reference = EXCLUDED.prior_payment_reference,
        prior_snapshot = EXCLUDED.prior_snapshot,
        post_state_hash = EXCLUDED.post_state_hash;

      -- Increment results_inserted only when a row was actually inserted
      GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
      v_results_inserted := v_results_inserted + v_rows_affected;

      -- Track status counters
      IF v_result = 'REJECTED' THEN
        v_rejected_count := v_rejected_count + 1;
      ELSIF v_result IN ('PARTIAL', 'UNDER_PAID') OR (v_target_table = 'mutual_fund' AND v_paid_amt < v_expected_amt AND v_paid_amt > 0) THEN
        v_partial_count := v_partial_count + 1;
      END IF;

      -- C. If exception/unmatched, record durable exception (if not already recorded)
      IF (v_result IN ('MISSING', 'REJECTED', 'EXCEPTION') OR (v_result NOT IN ('MATCHED', 'PARTIAL') AND abs(v_diff) > 0.05))
         AND NOT EXISTS (
           SELECT 1 FROM public.reconciliation_exceptions
           WHERE run_id = v_run_id AND source_reference = v_source_reference
         ) THEN
        INSERT INTO public.reconciliation_exceptions (
          run_id,
          company_id,
          payable_id,
          payable_type,
          source_reference,
          amount,
          exception_reason,
          status,
          created_by
        ) VALUES (
          v_run_id,
          v_company_id,
          v_payable_id,
          v_target_table,
          v_source_reference,
          v_actual_amt,
          CASE 
            WHEN v_result = 'MISSING' THEN 'Record not found in core ledger'
            WHEN v_result = 'REJECTED' THEN 'Bank payout transaction rejected by switch'
            ELSE 'Amount variance: difference of ' || v_diff::text
          END,
          'Open',
          v_uid
        );
        v_exceptions_created := v_exceptions_created + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      -- Truly atomic: re-raise error to roll back transaction completely
      RAISE EXCEPTION 'Atomic reconciliation batch failed at record (payable_id: %, source_ref: %): % (SQLSTATE: %)',
        v_item->>'payable_id', v_source_reference, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  -- 5. Update run stats cumulatively from accepted items
  UPDATE public.reconciliation_runs
  SET matched_count = COALESCE(matched_count, 0) + v_payables_updated,
      unmatched_count = COALESCE(unmatched_count, 0) + v_exceptions_created,
      partial_count = COALESCE(partial_count, 0) + v_partial_count,
      rejected_count = COALESCE(rejected_count, 0) + v_rejected_count,
      row_count = COALESCE(row_count, 0) + v_item_count,
      total_amount = COALESCE(total_amount, 0) + v_total_amount,
      processed_chunks = v_existing_chunks,
      batch_id = COALESCE(batch_id, v_batch_id),
      status = CASE WHEN v_is_final_chunk THEN 'applied' ELSE 'processing' END,
      applied_by = CASE WHEN v_is_final_chunk THEN v_uid ELSE applied_by END,
      applied_at = CASE WHEN v_is_final_chunk THEN now() ELSE applied_at END,
      updated_at = now()
  WHERE id = v_run_id;

  -- Finalize bank statement imports when all chunks are applied
  IF v_is_final_chunk THEN
    UPDATE public.bank_statement_imports bsi
    SET status = 'reconciled',
        updated_at = now()
    WHERE bsi.company_id = v_company_id
      AND bsi.status = 'imported'
      AND (
        (v_ex_file_hash IS NOT NULL AND bsi.file_hash_sha256 = v_ex_file_hash)
        OR EXISTS (
          SELECT 1 FROM public.bank_statement_transactions bst
          WHERE bst.import_id = bsi.id AND bst.reconciliation_run_id = v_run_id
        )
      );
  END IF;

  -- 6. Audit log
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
  VALUES (
    v_uid,
    'RECONCILIATION_APPLIED_ATOMIC',
    'reconciliation_runs',
    v_run_id,
    jsonb_build_object(
      'run_id', v_run_id,
      'company_id', v_company_id,
      'payables_updated', v_payables_updated,
      'payments_created', v_payments_created,
      'results_inserted', v_results_inserted,
      'exceptions_created', v_exceptions_created,
      'already_paid_skipped', v_already_paid,
      'rejected_count', v_rejected_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id,
    'batch_id', v_batch_id,
    'payables_updated', v_payables_updated,
    'payments_created', v_payments_created,
    'results_inserted', v_results_inserted,
    'exceptions_created', v_exceptions_created,
    'already_paid_skipped', v_already_paid,
    'rejected_count', v_rejected_count,
    'errors', v_errors
  );
END;
$$;


ALTER FUNCTION "public"."apply_and_record_reconciliation_batch"("p_run_info" "jsonb", "p_items" "jsonb", "p_batch_info" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_payable_classification_and_tax"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."apply_payable_classification_and_tax"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_reconciliation_batch"("p_items" "jsonb", "p_batch_info" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '60s'
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


ALTER FUNCTION "public"."apply_reconciliation_batch"("p_items" "jsonb", "p_batch_info" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_share_conversion_atomic"("p_company_id" "uuid", "p_conversion_type" "text", "p_fiscal_year" "text", "p_ratio" numeric, "p_client_updates" "jsonb", "p_fractional_payables" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."apply_share_conversion_atomic"("p_company_id" "uuid", "p_conversion_type" "text", "p_fiscal_year" "text", "p_ratio" numeric, "p_client_updates" "jsonb", "p_fractional_payables" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_reconciliation_variance_atomic"("p_approval_info" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_uid uuid;
  v_result_id uuid;
  v_company_id uuid;
  v_run_id uuid;
  v_payable_id uuid;
  v_payable_type text;
  v_source_ref text;
  v_variance_type text;
  v_expected_amt numeric(15,2);
  v_actual_amt numeric(15,2);
  v_variance_amt numeric(15,2);
  v_maker_id uuid;
  v_reason text;
  v_approval_id uuid;
  v_is_admin boolean;
  v_is_service_role boolean;
  v_run_record RECORD;
  v_result_record RECORD;
  c_max_supervisor_variance CONSTANT numeric(15,2) := 50000.00;
  c_max_supervisor_pct CONSTANT numeric := 50.0;
BEGIN
  v_is_service_role := (
    current_user = 'service_role' OR
    current_user = 'postgres' OR
    COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') = 'service_role'
  );

  IF NOT v_is_service_role THEN
    PERFORM public.require_role('admin', 'supervisor');
    v_uid := auth.uid();
  ELSE
    v_uid := COALESCE(auth.uid(), NULLIF(p_approval_info->>'approved_by', '')::uuid);
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Approver identity must be authenticated via valid session or explicitly provided in trusted service context' USING ERRCODE = '42501';
  END IF;

  v_is_admin := (
    v_is_service_role OR
    (v_uid IS NOT NULL AND public.has_role(v_uid, 'admin'::public.app_role))
  );

  v_reason := trim(COALESCE(p_approval_info->>'approval_reason', ''));
  IF length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Detailed approval reason of at least 5 characters is mandatory' USING ERRCODE = '23514';
  END IF;

  v_result_id := NULLIF(p_approval_info->>'result_id', '')::uuid;
  v_run_id := NULLIF(p_approval_info->>'run_id', '')::uuid;
  v_payable_id := NULLIF(p_approval_info->>'payable_id', '')::uuid;
  v_source_ref := NULLIF(p_approval_info->>'source_reference', '');

  -- Load authoritative stored reconciliation result
  IF v_result_id IS NOT NULL THEN
    SELECT * INTO v_result_record
    FROM public.reconciliation_results
    WHERE id = v_result_id;
  ELSIF v_run_id IS NOT NULL AND v_payable_id IS NOT NULL THEN
    SELECT * INTO v_result_record
    FROM public.reconciliation_results
    WHERE run_id = v_run_id
      AND payable_id = v_payable_id
      AND (v_source_ref IS NULL OR COALESCE(source_reference, '') = v_source_ref)
    ORDER BY created_at DESC
    LIMIT 1;
  ELSE
    RAISE EXCEPTION 'A valid result_id or (run_id, payable_id) referencing a persisted reconciliation result is mandatory' USING ERRCODE = '23502';
  END IF;

  IF v_result_record.id IS NULL THEN
    RAISE EXCEPTION 'Persisted reconciliation result not found for approval' USING ERRCODE = 'P0002';
  END IF;

  -- Validate against tampering if caller sent payload values
  IF (p_approval_info->>'payable_id') IS NOT NULL AND (p_approval_info->>'payable_id')::uuid != v_result_record.payable_id THEN
    RAISE EXCEPTION 'Tampering detected: caller payable_id does not match persisted result payable_id' USING ERRCODE = '23514';
  END IF;

  IF (p_approval_info->>'actual_amount') IS NOT NULL AND ABS((p_approval_info->>'actual_amount')::numeric - COALESCE(v_result_record.actual_amount, 0)) > 0.005 THEN
    RAISE EXCEPTION 'Tampering detected: caller actual_amount does not match persisted result actual_amount' USING ERRCODE = '23514';
  END IF;

  IF (p_approval_info->>'expected_amount') IS NOT NULL AND ABS((p_approval_info->>'expected_amount')::numeric - COALESCE(v_result_record.expected_amount, 0)) > 0.005 THEN
    RAISE EXCEPTION 'Tampering detected: caller expected_amount does not match persisted result expected_amount' USING ERRCODE = '23514';
  END IF;

  -- Derive all financial, payable, and run attributes exclusively from persisted record
  v_result_id := v_result_record.id;
  v_run_id := v_result_record.run_id;
  v_company_id := v_result_record.company_id;
  v_payable_id := v_result_record.payable_id;
  v_payable_type := COALESCE(v_result_record.payable_type, 'dividend_payables');
  v_source_ref := v_result_record.source_reference;
  v_variance_type := UPPER(v_result_record.result::text);
  v_expected_amt := COALESCE(v_result_record.expected_amount, 0);
  v_actual_amt := COALESCE(v_result_record.actual_amount, 0);
  v_variance_amt := ABS(v_actual_amt - v_expected_amt);

  IF v_variance_type NOT IN ('UNDER_PAID', 'OVER_PAID', 'PARTIAL', 'DISCREPANCY') THEN
    RAISE EXCEPTION 'Reconciliation result % does not require variance approval (result: %)',
      v_result_id, v_variance_type USING ERRCODE = '23514';
  END IF;

  -- Enforce tenant access for non-service-role callers
  IF NOT v_is_service_role THEN
    IF NOT public.has_company_access(v_uid, v_company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to target company %', v_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Load run and determine maker
  SELECT id, company_id, created_by INTO v_run_record
  FROM public.reconciliation_runs
  WHERE id = v_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reconciliation run % not found', v_run_id USING ERRCODE = 'P0002';
  END IF;

  v_maker_id := COALESCE(v_result_record.matched_by, v_run_record.created_by);
  IF v_maker_id IS NULL AND v_is_service_role THEN
    v_maker_id := NULLIF(p_approval_info->>'maker_id', '')::uuid;
  END IF;

  -- Maker-Checker enforcement: Approver CANNOT be maker
  IF v_uid IS NOT NULL AND v_maker_id IS NOT NULL AND v_uid = v_maker_id THEN
    RAISE EXCEPTION 'Maker-checker policy violation: approver (%) cannot be the same user who created the run/variance (maker: %)',
      v_uid, v_maker_id USING ERRCODE = '42501';
  END IF;

  -- Immutable Append-Only Enforcement: Reject duplicate approval attempts
  IF EXISTS (
    SELECT 1 FROM public.reconciliation_variance_approvals
    WHERE run_id = v_run_id
      AND payable_id = v_payable_id
      AND COALESCE(source_reference, '') = COALESCE(v_source_ref, '')
  ) THEN
    RAISE EXCEPTION 'Variance has already been approved for run %, payable %, reference %. Approvals are immutable.',
      v_run_id, v_payable_id, COALESCE(v_source_ref, '') USING ERRCODE = '23505';
  END IF;

  -- Variance Limit enforcement
  IF NOT v_is_admin THEN
    IF v_variance_amt > c_max_supervisor_variance THEN
      RAISE EXCEPTION 'Variance limit exceeded: variance of % exceeds supervisor limit of %. Administrator approval required.',
        v_variance_amt, c_max_supervisor_variance USING ERRCODE = '23514';
    END IF;
    IF v_expected_amt > 0 AND (v_variance_amt / v_expected_amt * 100.0) > c_max_supervisor_pct THEN
      RAISE EXCEPTION 'Variance percentage limit exceeded: variance percentage of % exceeds supervisor limit of % percent. Administrator approval required.',
        ROUND(v_variance_amt / v_expected_amt * 100.0, 2), c_max_supervisor_pct USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Insert immutable approval record
  INSERT INTO public.reconciliation_variance_approvals (
    company_id,
    run_id,
    result_id,
    payable_id,
    payable_type,
    source_reference,
    variance_type,
    expected_amount,
    actual_amount,
    variance_amount,
    maker_id,
    approved_by,
    approval_reason
  ) VALUES (
    v_company_id,
    v_run_id,
    v_result_id,
    v_payable_id,
    v_payable_type,
    v_source_ref,
    v_variance_type,
    v_expected_amt,
    v_actual_amt,
    v_variance_amt,
    v_maker_id,
    v_uid,
    v_reason
  )
  RETURNING id INTO v_approval_id;

  -- Update persisted reconciliation_results status
  UPDATE public.reconciliation_results
  SET requires_manual_approval = false,
      notes = COALESCE(notes || '; ', '') || 'Variance approved by ' || v_uid::text || ' (' || v_reason || ')'
  WHERE id = v_result_id;

  RETURN jsonb_build_object(
    'success', true,
    'approval_id', v_approval_id,
    'result_id', v_result_id,
    'run_id', v_run_id,
    'payable_id', v_payable_id,
    'variance_amount', v_variance_amt,
    'approved_by', v_uid
  );
END;
$$;


ALTER FUNCTION "public"."approve_reconciliation_variance_atomic"("p_approval_info" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."audit_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_delete"("p_table" "text", "p_filters" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."bulk_delete"("p_table" "text", "p_filters" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_import_agm_shareholders"("p_company_id" "uuid", "p_clients" "jsonb", "p_payables" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
          gross_dividend,
          tax_amount,
          net_payable,
          bonus_tax,
          bonus_actual,
          bonus_fraction,
          bonus_issued,
          after_bonus_kitta,
          payment_status,
          remarks
        ) VALUES (
          p_company_id,
          v_client_id,
          v_target_fiscal_year,
          COALESCE((v_pay_rec->>'gross_amount')::numeric, (v_pay_rec->>'gross_dividend')::numeric, 0),
          COALESCE((v_pay_rec->>'tax_amount')::numeric, 0),
          COALESCE((v_pay_rec->>'net_amount')::numeric, (v_pay_rec->>'net_payable')::numeric, 0),
          COALESCE((v_pay_rec->>'bonus_tax_amount')::numeric, (v_pay_rec->>'bonus_tax')::numeric, 0),
          COALESCE((v_pay_rec->>'actual_bonus_kitta')::numeric, (v_pay_rec->>'bonus_actual')::numeric, 0),
          COALESCE((v_pay_rec->>'fraction_kitta')::numeric, (v_pay_rec->>'bonus_fraction')::numeric, 0),
          COALESCE((v_pay_rec->>'issued_bonus_kitta')::numeric, (v_pay_rec->>'bonus_issued')::numeric, 0),
          COALESCE((v_pay_rec->>'after_bonus_kitta')::numeric, 0),
          'Pending'::public.payment_status,
          v_pay_rec->>'remarks'
        );
        v_inserted_payables := v_inserted_payables + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'clients_upserted', v_upserted_clients,
    'payables_inserted', v_inserted_payables
  );
END;
$$;


ALTER FUNCTION "public"."bulk_import_agm_shareholders"("p_company_id" "uuid", "p_clients" "jsonb", "p_payables" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_insert_clients"("p_clients" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."bulk_insert_clients"("p_clients" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_insert_dividend_payables"("p_payables" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '60s'
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


ALTER FUNCTION "public"."bulk_insert_dividend_payables"("p_payables" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_insert_interest_payables"("p_payables" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '60s'
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


ALTER FUNCTION "public"."bulk_insert_interest_payables"("p_payables" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_insert_mutual_fund_payables"("p_payables" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '60s'
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


ALTER FUNCTION "public"."bulk_insert_mutual_fund_payables"("p_payables" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_upsert_company"("p_company_name" "text", "p_company_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."bulk_upsert_company"("p_company_name" "text", "p_company_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_upsert_company"("p_company_name" "text", "p_company_code" "text", "p_isin" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."bulk_upsert_company"("p_company_name" "text", "p_company_code" "text", "p_isin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calc_dividend_payable_safe"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."calc_dividend_payable_safe"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calc_interest_payable_safe"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."calc_interest_payable_safe"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calc_net_dividend"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."calc_net_dividend"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calc_net_payable"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.net_payable = COALESCE(NEW.gross_interest, 0) - COALESCE(NEW.tax_amount, 0);
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."calc_net_payable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_agm_broker_pool"("p_company_id" "uuid", "p_seq_no" bigint, "p_broker_code" "text", "p_broker_name" "text", "p_pool_boid" "text", "p_claimant_boid" "text", "p_claimant_name" "text", "p_fiscal_year" "text", "p_claimed_kitta" numeric, "p_claimed_cash" numeric, "p_contract_note_no" "text", "p_trade_date_bs" "text", "p_approved_by" "text" DEFAULT 'Operator'::"text", "p_remarks" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."claim_agm_broker_pool"("p_company_id" "uuid", "p_seq_no" bigint, "p_broker_code" "text", "p_broker_name" "text", "p_pool_boid" "text", "p_claimant_boid" "text", "p_claimant_name" "text", "p_fiscal_year" "text", "p_claimed_kitta" numeric, "p_claimed_cash" numeric, "p_contract_note_no" "text", "p_trade_date_bs" "text", "p_approved_by" "text", "p_remarks" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clean_auth_user_tokens"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."clean_auth_user_tokens"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."commit_agm_fiscal_year_import"("p_company_id" "uuid", "p_fiscal_year" "text", "p_batch_id" "uuid", "p_event_name" "text", "p_report" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."commit_agm_fiscal_year_import"("p_company_id" "uuid", "p_fiscal_year" "text", "p_batch_id" "uuid", "p_event_name" "text", "p_report" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."commit_reconciliation_matches_atomic"("p_company_id" "uuid", "p_matches" "jsonb", "p_operator_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."commit_reconciliation_matches_atomic"("p_company_id" "uuid", "p_matches" "jsonb", "p_operator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."commit_staged_import"("p_approval_id" "uuid", "p_checker_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_staged public.import_staging%ROWTYPE;
    v_approval public.pending_approvals%ROWTYPE;
    v_user_id uuid := auth.uid();
    v_is_authorized boolean := false;
    v_upload_id uuid;
    v_row jsonb;
    v_boid text;
    v_client_code text;
    v_client_name text;
    v_bank_name text;
    v_bank_account text;
    v_client_id uuid;
    v_shares_held numeric;
    v_dividend_rate numeric;
    v_gross numeric;
    v_tax numeric;
    v_net numeric;
    v_fiscal_year text;
    v_dividend_type text;
    v_inserted_count integer := 0;

    -- Investor Classification Variables
    v_raw_holder_type text;
    v_raw_classification text;
    v_payee_classification text;
    v_holder_type public.holder_type;
BEGIN
    -- 1. Authentication check
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required: User must be signed in to commit staged imports';
    END IF;

    -- 2. Retrieve pending approval record
    SELECT * INTO v_approval
    FROM public.pending_approvals
    WHERE id = p_approval_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pending approval record % not found', p_approval_id;
    END IF;

    IF v_approval.status <> 'Pending' THEN
        RAISE EXCEPTION 'Approval ticket is already %', v_approval.status;
    END IF;

    -- 3. Segregation of duties: Maker cannot approve their own material import
    IF v_approval.requested_by = v_user_id THEN
        RAISE EXCEPTION 'Segregation of duties violation: Maker cannot approve their own material import';
    END IF;

    -- 4. Authorization check: Checker role (admin or supervisor) required
    SELECT public.has_any_role(v_user_id, ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
    INTO v_is_authorized;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Unauthorized: Checker role required to approve material imports';
    END IF;

    -- 5. Retrieve staged import data
    SELECT * INTO v_staged
    FROM public.import_staging
    WHERE approval_id = p_approval_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staged import data for approval % not found', p_approval_id;
    END IF;

    IF v_staged.status <> 'STAGED' THEN
        RAISE EXCEPTION 'Staged import has already been %', v_staged.status;
    END IF;

    -- 6. Verify company access for checker
    IF NOT public.has_company_access(v_user_id, v_staged.company_id)
       AND NOT public.has_any_role(v_user_id, ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) THEN
        RAISE EXCEPTION 'Unauthorized: Checker has no access to target company';
    END IF;

    -- 7. Integrate with upload_history lifecycle
    INSERT INTO public.upload_history (
        user_id,
        file_name,
        file_size,
        file_hash,
        file_type,
        sheet_name,
        total_rows,
        success_rows,
        error_rows,
        target_table,
        status,
        started_at,
        completed_at,
        created_at
    ) VALUES (
        v_staged.created_by,
        v_staged.file_name,
        0,
        v_staged.file_hash,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        v_staged.sheet_name,
        jsonb_array_length(v_staged.staged_rows),
        0,
        0,
        v_staged.target_table,
        'Processing',
        now(),
        NULL,
        now()
    )
    RETURNING id INTO v_upload_id;

    -- 8. Commit rows into destination table and update/insert clients
    v_fiscal_year := COALESCE(v_staged.options->>'fiscalYear', '2080/81');
    v_dividend_type := COALESCE(v_staged.options->>'dividendType', 'Cash');
    v_dividend_rate := COALESCE((v_staged.options->>'dividendRate')::numeric, 0);

    FOR v_row IN SELECT * FROM jsonb_array_elements(v_staged.staged_rows)
    LOOP
        v_boid := COALESCE(
            v_row->>'boid',
            v_row->>'BOID',
            v_row->>'boid_no',
            v_row->>'BOID_NO',
            v_row->>'BENEFICIARY ID',
            v_row->>'folio',
            v_row->>'FOLIO',
            v_row->>'folio_no',
            v_row->>'FOLIO_NO',
            v_row->>'sh_no',
            v_row->>'SH_NO',
            v_row->>'shareholder_no',
            v_row->>'client_code',
            v_row->>'ClientCode',
            v_row->>'client_id'
        );

        -- Accept 16-digit Demat BOIDs as well as Physical Shareholder Folio numbers (>= 1 character)
        IF v_boid IS NULL OR length(trim(v_boid)) < 1 THEN
            CONTINUE;
        END IF;

        v_boid := trim(v_boid);
        v_client_name := COALESCE(
            v_row->>'name',
            v_row->>'shareholder_name',
            v_row->>'NAME',
            v_row->>'SHAREHOLDER NAME',
            v_row->>'investor_name',
            'Shareholder ' || v_boid
        );
        v_client_code := COALESCE(
            v_row->>'client_code',
            v_row->>'ClientCode',
            v_row->>'client_id',
            v_boid
        );
        v_bank_name := COALESCE(v_row->>'bank_name', v_row->>'BANK NAME', v_row->>'bank');
        v_bank_account := COALESCE(v_row->>'bank_account_number', v_row->>'ACCOUNT NO', v_row->>'account_no', v_row->>'bank_account');

        -- Resolve Classification and Investor Category
        v_raw_holder_type := COALESCE(
            v_row->>'holder_type',
            v_row->>'holderType',
            v_row->>'investor_type',
            v_row->>'investorType',
            v_row->>'investor_category',
            v_row->>'investorCategory',
            v_row->>'category',
            v_row->>'sheet_type',
            v_staged.sheet_name
        );
        v_raw_classification := COALESCE(
            v_row->>'payee_classification',
            v_row->>'payeeClassification',
            v_row->>'classification',
            v_row->>'tax_category'
        );

        -- Map payee_classification accurately
        IF upper(trim(coalesce(v_raw_classification, ''))) IN (
            'NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON', 'COMPANY_INSTITUTION',
            'FOREIGN_INVESTOR', 'BANK_FI', 'TAX_EXEMPT', 'UNCLASSIFIED'
        ) THEN
            v_payee_classification := upper(trim(v_raw_classification));
        ELSIF v_raw_holder_type ILIKE '%EXEMPT%' OR v_raw_holder_type ILIKE '%MUTUAL%' THEN
            v_payee_classification := 'TAX_EXEMPT';
        ELSIF v_raw_holder_type ILIKE '%FOREIGN%' THEN
            v_payee_classification := 'FOREIGN_INVESTOR';
        ELSIF v_raw_holder_type ILIKE '%BANK%' OR v_raw_holder_type ILIKE '%FINANCIAL%' THEN
            v_payee_classification := 'BANK_FI';
        ELSIF v_raw_holder_type ILIKE '%INSTITUTION%' OR v_raw_holder_type ILIKE '%LEGAL PERSON%' THEN
            v_payee_classification := 'COMPANY_INSTITUTION';
        ELSIF v_raw_holder_type ILIKE '%PUBLIC%' THEN
            v_payee_classification := 'NATURAL_PERSON';
        ELSE
            v_payee_classification := 'NATURAL_PERSON';
        END IF;

        -- Map holder_type enum
        IF v_raw_holder_type IN (
            'Natural Person - Public', 'Natural Person - Promoter', 'Legal Person', 'Mutual Fund',
            'Foreign', 'Tax Exempt', 'Public', 'Promoter', 'Institution', 'Natural Person - Local',
            'Natural Person - Employee', 'Natural Person - Minor', 'Natural Person - Joint Holder',
            'Legal Person - Promoter', 'Local', 'Employee'
        ) THEN
            v_holder_type := v_raw_holder_type::public.holder_type;
        ELSIF v_payee_classification = 'TAX_EXEMPT' THEN
            IF v_raw_holder_type ILIKE '%MUTUAL%' THEN
                v_holder_type := 'Mutual Fund'::public.holder_type;
            ELSE
                v_holder_type := 'Tax Exempt'::public.holder_type;
            END IF;
        ELSIF v_payee_classification = 'FOREIGN_INVESTOR' THEN
            v_holder_type := 'Foreign'::public.holder_type;
        ELSIF v_payee_classification = 'BANK_FI' THEN
            v_holder_type := 'Institution'::public.holder_type;
        ELSIF v_payee_classification = 'COMPANY_INSTITUTION' THEN
            v_holder_type := 'Legal Person'::public.holder_type;
        ELSIF v_payee_classification = 'PUBLIC_LEGAL_PERSON' THEN
            v_holder_type := 'Public'::public.holder_type;
        ELSIF v_raw_holder_type ILIKE '%PROMOTER%' THEN
            v_holder_type := 'Natural Person - Promoter'::public.holder_type;
        ELSIF v_raw_holder_type ILIKE '%LOCAL%' THEN
            v_holder_type := 'Natural Person - Local'::public.holder_type;
        ELSIF v_raw_holder_type ILIKE '%STAFF%' OR v_raw_holder_type ILIKE '%EMPLOYEE%' THEN
            v_holder_type := 'Natural Person - Employee'::public.holder_type;
        ELSIF v_raw_holder_type ILIKE '%MINOR%' THEN
            v_holder_type := 'Natural Person - Minor'::public.holder_type;
        ELSIF v_raw_holder_type ILIKE '%JOINT%' THEN
            v_holder_type := 'Natural Person - Joint Holder'::public.holder_type;
        ELSE
            v_holder_type := 'Natural Person - Public'::public.holder_type;
        END IF;

        -- Upsert client: strictly scoped to v_staged.company_id
        v_client_id := NULL;
        IF v_boid IS NOT NULL AND v_boid <> '' THEN
            SELECT id INTO v_client_id 
            FROM public.clients 
            WHERE company_id = v_staged.company_id AND boid = v_boid 
            LIMIT 1;
        END IF;

        IF v_client_id IS NULL AND v_client_code IS NOT NULL AND v_client_code <> '' THEN
            SELECT id INTO v_client_id 
            FROM public.clients 
            WHERE company_id = v_staged.company_id AND client_code = v_client_code 
            LIMIT 1;
        END IF;

        IF v_client_id IS NOT NULL THEN
            UPDATE public.clients
            SET
                bank_name = COALESCE(v_bank_name, public.clients.bank_name),
                bank_account_no = COALESCE(v_bank_account, public.clients.bank_account_no),
                payee_classification = CASE
                    WHEN public.clients.payee_classification = 'UNCLASSIFIED' AND v_payee_classification <> 'UNCLASSIFIED'
                        THEN v_payee_classification
                    ELSE public.clients.payee_classification
                END,
                holder_type = CASE
                    WHEN public.clients.payee_classification = 'UNCLASSIFIED' AND v_payee_classification <> 'UNCLASSIFIED'
                        THEN v_holder_type
                    ELSE public.clients.holder_type
                END,
                updated_at = now()
            WHERE id = v_client_id AND company_id = v_staged.company_id;
        ELSE
            INSERT INTO public.clients (
                company_id,
                client_code,
                full_name,
                boid,
                bank_name,
                bank_account_no,
                holder_type,
                payee_classification,
                classification_status,
                created_at,
                updated_at
            ) VALUES (
                v_staged.company_id,
                v_client_code,
                v_client_name,
                v_boid,
                v_bank_name,
                v_bank_account,
                v_holder_type,
                v_payee_classification,
                'AUTO_CLASSIFIED',
                now(),
                now()
            )
            RETURNING id INTO v_client_id;
        END IF;

        -- Extract financial figures
        v_shares_held := COALESCE(
            (v_row->>'shares_held')::numeric,
            (v_row->>'kitta')::numeric,
            (v_row->>'KITTA')::numeric,
            (v_row->>'TOTAL KITTA')::numeric,
            0
        );
        v_gross := COALESCE(
            (v_row->>'gross_dividend')::numeric,
            (v_row->>'gross')::numeric,
            (v_row->>'GROSS')::numeric,
            (v_row->>'gross_amount')::numeric,
            0
        );
        v_tax := COALESCE(
            (v_row->>'tax_amount')::numeric,
            (v_row->>'tax')::numeric,
            (v_row->>'TAX')::numeric,
            (v_row->>'tax_withheld')::numeric,
            0
        );
        v_net := COALESCE(
            (v_row->>'net_payable')::numeric,
            (v_row->>'net')::numeric,
            (v_row->>'NET')::numeric,
            (v_row->>'net_dividend')::numeric,
            (v_gross - v_tax)
        );

        -- Insert into target ledger table with upload_id & resolved classification
        IF v_staged.target_table = 'interest_payables' THEN
            INSERT INTO public.interest_payables (
                company_id,
                client_id,
                upload_id,
                gross_interest,
                tax_amount,
                net_payable,
                fiscal_year,
                payee_classification,
                classification_status,
                payment_status,
                created_by,
                created_at,
                updated_at
            ) VALUES (
                v_staged.company_id,
                v_client_id,
                v_upload_id,
                v_gross,
                v_tax,
                v_net,
                v_fiscal_year,
                v_payee_classification,
                'AUTO_CLASSIFIED',
                'Pending'::public.payment_status,
                v_user_id,
                now(),
                now()
            );
        ELSIF v_staged.target_table = 'mutual_fund_payables' THEN
            INSERT INTO public.mutual_fund_payables (
                company_id,
                client_id,
                upload_id,
                shares_held,
                dividend_rate,
                gross_dividend,
                tax_amount,
                net_payable,
                fiscal_year,
                payee_classification,
                classification_status,
                payment_status,
                created_by,
                created_at,
                updated_at
            ) VALUES (
                v_staged.company_id,
                v_client_id,
                v_upload_id,
                v_shares_held,
                v_dividend_rate,
                v_gross,
                v_tax,
                v_net,
                v_fiscal_year,
                v_payee_classification,
                'AUTO_CLASSIFIED',
                'Pending'::public.payment_status,
                v_user_id,
                now(),
                now()
            );
        ELSE
            -- Default to dividend_payables
            INSERT INTO public.dividend_payables (
                company_id,
                client_id,
                upload_id,
                shares_held,
                dividend_rate,
                gross_dividend,
                tax_amount,
                net_payable,
                tds_rate,
                payee_classification,
                classification_status,
                fiscal_year,
                dividend_type,
                payment_status,
                created_by,
                created_at,
                updated_at
            ) VALUES (
                v_staged.company_id,
                v_client_id,
                v_upload_id,
                v_shares_held,
                v_dividend_rate,
                v_gross,
                v_tax,
                v_net,
                CASE WHEN v_gross > 0 THEN ROUND(v_tax / v_gross, 4) ELSE 0 END,
                v_payee_classification,
                'AUTO_CLASSIFIED',
                v_fiscal_year,
                CASE
                    WHEN v_dividend_type = 'Stock' THEN 'Stock'::public.dividend_type
                    WHEN v_dividend_type = 'Bonus' THEN 'Bonus'::public.dividend_type
                    WHEN v_dividend_type = 'Right' THEN 'Right'::public.dividend_type
                    ELSE 'Cash'::public.dividend_type
                END,
                'Pending'::public.payment_status,
                v_user_id,
                now(),
                now()
            );
        END IF;

        v_inserted_count := v_inserted_count + 1;
    END LOOP;

    -- 9. Update upload_history completion
    UPDATE public.upload_history
    SET
        status = 'Completed',
        success_rows = v_inserted_count,
        completed_at = now()
    WHERE id = v_upload_id;

    -- 10. Mark approval Approved
    UPDATE public.pending_approvals
    SET
        status = 'Approved',
        reviewed_by = v_user_id,
        review_notes = p_checker_notes,
        reviewed_at = now()
    WHERE id = p_approval_id;

    -- 11. Mark staging COMMITTED and link generated upload_id
    UPDATE public.import_staging
    SET
        status = 'COMMITTED',
        upload_id = v_upload_id,
        committed_at = now()
    WHERE id = v_staged.id;

    -- 12. Record approval log
    INSERT INTO public.approval_logs (
        approval_id,
        action,
        previous_status,
        new_status,
        remarks,
        performed_by,
        performed_at
    ) VALUES (
        p_approval_id,
        'MATERIAL_IMPORT_COMMITTED',
        'Pending',
        'Approved',
        p_checker_notes,
        v_user_id,
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'approval_id', p_approval_id,
        'staging_id', v_staged.id,
        'upload_id', v_upload_id,
        'rows_committed', v_inserted_count,
        'status', 'Approved',
        'committed_at', now()
    );
END;
$$;


ALTER FUNCTION "public"."commit_staged_import"("p_approval_id" "uuid", "p_checker_notes" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."commit_staged_import"("p_approval_id" "uuid", "p_checker_notes" "text") IS 'Atomic verification, maker-checker segregation, and checker commit for material staged imports.';



CREATE OR REPLACE FUNCTION "public"."complete_payment_batch_atomic"("p_batch_id" "uuid", "p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '60s'
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


ALTER FUNCTION "public"."complete_payment_batch_atomic"("p_batch_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_payment_batch_atomic"("p_batch_name" "text", "p_company_id" "uuid" DEFAULT NULL::"uuid", "p_fiscal_year" "text" DEFAULT NULL::"text", "p_payable_type" "text" DEFAULT 'all'::"text", "p_payment_method" "text" DEFAULT 'ConnectIPS'::"text", "p_installment_tag" "text" DEFAULT 'FULL'::"text", "p_cds_batch_ref" "text" DEFAULT NULL::"text", "p_registrar" "text" DEFAULT NULL::"text", "p_max_items" integer DEFAULT 200000) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '120s'
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


ALTER FUNCTION "public"."create_payment_batch_atomic"("p_batch_name" "text", "p_company_id" "uuid", "p_fiscal_year" "text", "p_payable_type" "text", "p_payment_method" "text", "p_installment_tag" "text", "p_cds_batch_ref" "text", "p_registrar" "text", "p_max_items" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_reconciliation_draft_run_atomic"("p_run_info" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_company_id uuid;
  v_run_id uuid;
BEGIN
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');
  END IF;

  v_company_id := NULLIF(p_run_info->>'company_id', '')::uuid;
  IF v_company_id IS NOT NULL THEN
    IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
      IF NOT public.has_company_access(v_uid, v_company_id) THEN
        RAISE EXCEPTION 'Unauthorized: caller lacks access to target company %', v_company_id USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.reconciliation_runs (
    company_id,
    fiscal_year,
    source_type,
    file_name,
    file_hash_sha256,
    row_count,
    total_amount,
    matched_count,
    partial_count,
    rejected_count,
    unmatched_count,
    status,
    created_by
  ) VALUES (
    v_company_id,
    NULLIF(p_run_info->>'fiscal_year', ''),
    COALESCE(NULLIF(p_run_info->>'source_type', ''), 'manual'),
    COALESCE(NULLIF(p_run_info->>'file_name', ''), 'manual-reconciliation'),
    COALESCE(NULLIF(p_run_info->>'file_hash_sha256', ''), md5(now()::text || p_run_info::text)),
    COALESCE(NULLIF(p_run_info->>'row_count', '')::int, 0),
    COALESCE(NULLIF(p_run_info->>'total_amount', '')::numeric, 0),
    COALESCE(NULLIF(p_run_info->>'matched_count', '')::int, 0),
    COALESCE(NULLIF(p_run_info->>'partial_count', '')::int, 0),
    COALESCE(NULLIF(p_run_info->>'rejected_count', '')::int, 0),
    COALESCE(NULLIF(p_run_info->>'unmatched_count', '')::int, 0),
    'draft',
    v_uid
  ) RETURNING id INTO v_run_id;

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id
  );
END;
$$;


ALTER FUNCTION "public"."create_reconciliation_draft_run_atomic"("p_run_info" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_company_completely"("p_company_id" "uuid", "p_delete_clients" boolean DEFAULT true, "p_delete_orphans" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."delete_company_completely"("p_company_id" "uuid", "p_delete_clients" boolean, "p_delete_orphans" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_orphan_clients"("p_company_id" "text" DEFAULT NULL::"text", "p_fiscal_year" "text" DEFAULT NULL::"text", "p_imported_after" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."delete_orphan_clients"("p_company_id" "text", "p_fiscal_year" "text", "p_imported_after" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."disperse_agm_bulk_pools"("p_company_id" "uuid", "p_placeholder_boids" "text"[], "p_folio_records" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."disperse_agm_bulk_pools"("p_company_id" "uuid", "p_placeholder_boids" "text"[], "p_folio_records" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_interest_payable_tax_rates"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Deprecated in favor of apply_payable_classification_and_tax() using authoritative payable_tax_rules
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_interest_payable_tax_rates"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_agm_dividend_summary"("p_company_id" "uuid" DEFAULT NULL::"uuid", "p_fiscal_year" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_agm_dividend_summary"("p_company_id" "uuid", "p_fiscal_year" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_agm_summary_stats"() RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_agm_summary_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_agm_summary_stats"("p_company_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_agm_summary_stats"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_available_payables_preview"("p_company_id" "uuid" DEFAULT NULL::"uuid", "p_payable_type" "text" DEFAULT 'all'::"text", "p_fiscal_year" "text" DEFAULT 'all'::"text", "p_from_date" "text" DEFAULT NULL::"text", "p_to_date" "text" DEFAULT NULL::"text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_available_payables_preview"("p_company_id" "uuid", "p_payable_type" "text", "p_fiscal_year" "text", "p_from_date" "text", "p_to_date" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_clients_paginated"("p_company_id" "uuid" DEFAULT NULL::"uuid", "p_holder_type" "text" DEFAULT 'all'::"text", "p_classification" "text" DEFAULT 'all'::"text", "p_status" "text" DEFAULT 'all'::"text", "p_verification" "text" DEFAULT 'all'::"text", "p_search" "text" DEFAULT ''::"text", "p_limit" integer DEFAULT 25, "p_offset" integer DEFAULT 0, "p_needs_review" "text" DEFAULT 'all'::"text") RETURNS TABLE("id" "uuid", "client_code" "text", "client_id" "text", "company_id" "uuid", "full_name" "text", "father_name" "text", "grandfather_name" "text", "date_of_birth" "text", "gender" "text", "occupation" "text", "boid" "text", "kitta" numeric, "holder_type" "public"."holder_type", "payee_classification" "text", "pan_no" "text", "citizenship_no" "text", "pan_or_citizenship" "text", "nid_number" "text", "address" "text", "province" "text", "district" "text", "municipality" "text", "phone" "text", "email" "text", "bank_name" "text", "bank_branch" "text", "bank_account_no" "text", "account_type" "text", "residency" "public"."residency_type", "verification_status" "public"."verification_status", "status" "public"."record_status", "created_at" timestamp with time zone, "company_name" "text", "company_code" "text", "needs_review" boolean, "data_quality_notes" "text", "total_count" bigint, "company_details" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '60s'
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


ALTER FUNCTION "public"."get_clients_paginated"("p_company_id" "uuid", "p_holder_type" "text", "p_classification" "text", "p_status" "text", "p_verification" "text", "p_search" "text", "p_limit" integer, "p_offset" integer, "p_needs_review" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_company_client_ids"("p_company_id" "uuid") RETURNS SETOF "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_company_client_ids"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_company_client_stats"("p_company_id" "uuid" DEFAULT NULL::"uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '60s'
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


ALTER FUNCTION "public"."get_company_client_stats"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_company_fiscal_summary_rpc"("p_fiscal_year" "text" DEFAULT NULL::"text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_company_fiscal_summary_rpc"("p_fiscal_year" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_company_payable_summary"("p_company_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("company_id" "uuid", "company_name" "text", "company_code" "text", "dividend_count" bigint, "dividend_gross" numeric, "dividend_tax" numeric, "dividend_net" numeric, "interest_count" bigint, "interest_gross" numeric, "interest_tax" numeric, "interest_net" numeric, "total_count" bigint, "total_gross" numeric, "total_tax" numeric, "total_net" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '60s'
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


ALTER FUNCTION "public"."get_company_payable_summary"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_cron_secret"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_secret text;
BEGIN
    -- Check session / role configuration parameter first
    v_secret := nullif(current_setting('app.settings.cron_secret', true), '');
    IF v_secret IS NOT NULL THEN
        RETURN v_secret;
    END IF;

    -- Check persistent system_settings table
    SELECT setting_value->>'secret' INTO v_secret
    FROM public.system_settings
    WHERE setting_key = 'cron_secret';

    RETURN nullif(v_secret, '');
END;
$$;


ALTER FUNCTION "public"."get_cron_secret"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_declaration_summary"("p_declaration_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_declaration RECORD;
    v_is_dividend boolean;
    v_total_payables int := 0;
    v_gross_amt numeric(15,2) := 0;
    v_tax_amt numeric(15,2) := 0;
    v_net_amt numeric(15,2) := 0;
    v_paid_amt numeric(15,2) := 0;
    v_remaining_amt numeric(15,2) := 0;
    v_failed_amt numeric(15,2) := 0;
    v_paid_count int := 0;
    v_partial_count int := 0;
    v_unpaid_count int := 0;
    v_failed_count int := 0;
    v_batches_count int := 0;
BEGIN
    SELECT * INTO v_declaration FROM public.corporate_declarations WHERE id = p_declaration_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'Declaration not found');
    END IF;

    v_is_dividend := (v_declaration.declaration_type = 'Dividend');

    IF v_is_dividend THEN
        SELECT
            COUNT(*),
            COALESCE(SUM(gross_dividend), 0),
            COALESCE(SUM(tax_amount), 0),
            COALESCE(SUM(net_payable), 0),
            COALESCE(SUM(paid_amount), 0),
            COALESCE(SUM(remaining_amount), 0),
            COALESCE(SUM(CASE WHEN returned_status IS NOT NULL AND returned_status != '' THEN net_payable ELSE 0 END), 0),
            COUNT(CASE WHEN payment_status = 'Paid' THEN 1 END),
            COUNT(CASE WHEN payment_status = 'Partial' THEN 1 END),
            COUNT(CASE WHEN payment_status = 'Pending' AND (returned_status IS NULL OR returned_status = '') THEN 1 END),
            COUNT(CASE WHEN returned_status IS NOT NULL AND returned_status != '' THEN 1 END)
        INTO
            v_total_payables, v_gross_amt, v_tax_amt, v_net_amt, v_paid_amt, v_remaining_amt, v_failed_amt,
            v_paid_count, v_partial_count, v_unpaid_count, v_failed_count
        FROM public.dividend_payables
        WHERE declaration_id = p_declaration_id
           OR (declaration_id IS NULL AND company_id = v_declaration.company_id AND fiscal_year = v_declaration.fiscal_year);
    ELSE
        SELECT
            COUNT(*),
            COALESCE(SUM(gross_interest), 0),
            COALESCE(SUM(tax_amount), 0),
            COALESCE(SUM(net_payable), 0),
            COALESCE(SUM(paid_amount), 0),
            COALESCE(SUM(remaining_amount), 0),
            COALESCE(SUM(CASE WHEN returned_status IS NOT NULL AND returned_status != '' THEN net_payable ELSE 0 END), 0),
            COUNT(CASE WHEN payment_status = 'Paid' THEN 1 END),
            COUNT(CASE WHEN payment_status = 'Partial' THEN 1 END),
            COUNT(CASE WHEN payment_status = 'Pending' AND (returned_status IS NULL OR returned_status = '') THEN 1 END),
            COUNT(CASE WHEN returned_status IS NOT NULL AND returned_status != '' THEN 1 END)
        INTO
            v_total_payables, v_gross_amt, v_tax_amt, v_net_amt, v_paid_amt, v_remaining_amt, v_failed_amt,
            v_paid_count, v_partial_count, v_unpaid_count, v_failed_count
        FROM public.interest_payables
        WHERE declaration_id = p_declaration_id
           OR (declaration_id IS NULL AND company_id = v_declaration.company_id AND fiscal_year = v_declaration.fiscal_year);
    END IF;

    SELECT COUNT(*) INTO v_batches_count
    FROM public.payment_batches
    WHERE declaration_id = p_declaration_id
       OR (declaration_id IS NULL AND company_id = v_declaration.company_id AND fiscal_year = v_declaration.fiscal_year);

    RETURN jsonb_build_object(
        'declaration_id', v_declaration.id,
        'declaration_code', v_declaration.declaration_code,
        'declaration_type', v_declaration.declaration_type,
        'sub_type', v_declaration.sub_type,
        'fiscal_year', v_declaration.fiscal_year,
        'declaration_date', v_declaration.declaration_date,
        'record_date', v_declaration.record_date,
        'payment_due_date', v_declaration.payment_due_date,
        'rate_per_share', v_declaration.rate_per_share,
        'total_declared_amount', v_declaration.total_declared_amount,
        'total_payables_count', v_total_payables,
        'gross_amount', v_gross_amt,
        'tax_amount', v_tax_amt,
        'net_payable_amount', v_net_amt,
        'paid_amount', v_paid_amt,
        'remaining_amount', v_remaining_amt,
        'failed_amount', v_failed_amt,
        'paid_count', v_paid_count,
        'partial_count', v_partial_count,
        'unpaid_count', v_unpaid_count,
        'failed_count', v_failed_count,
        'batches_count', v_batches_count,
        'progress_percent', CASE WHEN v_net_amt > 0 THEN ROUND((v_paid_amt / v_net_amt) * 100, 2) ELSE 0 END
    );
END;
$$;


ALTER FUNCTION "public"."get_declaration_summary"("p_declaration_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_distinct_fiscal_years"("p_table" "text" DEFAULT 'mutual_fund_payables'::"text") RETURNS "text"[]
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_distinct_fiscal_years"("p_table" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dividend_payables_totals"("p_company_id" "uuid" DEFAULT NULL::"uuid", "p_status" "text" DEFAULT 'all'::"text", "p_fiscal_year" "text" DEFAULT 'all'::"text", "p_type" "text" DEFAULT 'all'::"text", "p_class" "text" DEFAULT 'all'::"text", "p_from_date" "text" DEFAULT NULL::"text", "p_to_date" "text" DEFAULT NULL::"text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_dividend_payables_totals"("p_company_id" "uuid", "p_status" "text", "p_fiscal_year" "text", "p_type" "text", "p_class" "text", "p_from_date" "text", "p_to_date" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_interest_payables_totals"("p_company_id" "uuid" DEFAULT NULL::"uuid", "p_status" "text" DEFAULT 'all'::"text", "p_fiscal_year" "text" DEFAULT 'all'::"text", "p_class" "text" DEFAULT 'all'::"text", "p_from_date" "text" DEFAULT NULL::"text", "p_to_date" "text" DEFAULT NULL::"text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
    COALESCE(SUM(gross_interest), 0),
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
      OR (p_class = 'PROMOTER' AND (payee_segment = 'PROMOTER' OR instrument_ref ILIKE '%PROMOT%'))
      OR (p_class = 'LOCAL' AND (payee_segment = 'LOCAL' OR instrument_ref ILIKE '%LOCAL%'))
      OR (p_class = 'TAX_EXEMPT' AND (payee_classification = 'TAX_EXEMPT' OR instrument_ref ILIKE '%MUTUAL%' OR instrument_ref ILIKE '%EXEMPT%'))
      OR (p_class = 'INSTITUTION' AND (payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR instrument_ref ILIKE '%INSTITUT%' OR instrument_ref ILIKE '%COMPANY%'))
      OR (p_class = 'PUBLIC' AND (payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON') OR instrument_ref ILIKE '%PUBLIC%'))
    )
    AND (p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date)
    AND (p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date);

  RETURN json_build_object(
    'count', v_count,
    'paidCount', v_paid_count,
    'partialCount', v_partial_count,
    'pendingCount', v_pending_count,
    'units', v_units,
    'gross', v_gross,
    'tax', v_tax,
    'net', v_net,
    'disbursed', v_disbursed,
    'remaining', v_remaining
  );
END;
$$;


ALTER FUNCTION "public"."get_interest_payables_totals"("p_company_id" "uuid", "p_status" "text", "p_fiscal_year" "text", "p_class" "text", "p_from_date" "text", "p_to_date" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_mutual_fund_distribution_summary"("p_company_id" "uuid" DEFAULT NULL::"uuid", "p_fiscal_year" "text" DEFAULT 'all'::"text", "p_from_date" "text" DEFAULT NULL::"text", "p_to_date" "text" DEFAULT NULL::"text") RETURNS TABLE("type" "text", "transaction_count" bigint, "kitta" numeric, "gross" numeric, "tax" numeric, "net" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_mutual_fund_distribution_summary"("p_company_id" "uuid", "p_fiscal_year" "text", "p_from_date" "text", "p_to_date" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_mutual_fund_payables_totals"("p_company_id" "uuid" DEFAULT NULL::"uuid", "p_status" "text" DEFAULT 'all'::"text", "p_fiscal_year" "text" DEFAULT 'all'::"text", "p_class" "text" DEFAULT 'all'::"text", "p_from_date" "text" DEFAULT NULL::"text", "p_to_date" "text" DEFAULT NULL::"text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_mutual_fund_payables_totals"("p_company_id" "uuid", "p_status" "text", "p_fiscal_year" "text", "p_class" "text", "p_from_date" "text", "p_to_date" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_mutual_fund_schemes_summary"("p_fiscal_year" "text" DEFAULT 'all'::"text") RETURNS TABLE("company_id" "uuid", "company_name" "text", "company_code" "text", "unitholders" bigint, "kitta" numeric, "gross" numeric, "tax" numeric, "net" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
    c.id AS company_id,
    c.company_name,
    c.company_code,
    COUNT(*)::bigint AS unitholders,
    COALESCE(SUM(m.shares_held), 0)::numeric AS kitta,
    COALESCE(SUM(m.gross_dividend), 0)::numeric AS gross,
    COALESCE(SUM(m.tax_amount), 0)::numeric AS tax,
    COALESCE(SUM(m.net_payable), 0)::numeric AS net
  FROM public.mutual_fund_payables m
  JOIN public.companies c ON m.company_id = c.id
  WHERE
    (v_is_global_access OR m.company_id = ANY(v_user_companies))
    AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR m.fiscal_year = p_fiscal_year)
  GROUP BY c.id, c.company_name, c.company_code
  ORDER BY c.company_name ASC;
END;
$$;


ALTER FUNCTION "public"."get_mutual_fund_schemes_summary"("p_fiscal_year" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_reconciliation_runs_paginated"("p_company_id" "uuid" DEFAULT NULL::"uuid", "p_source_type" "text" DEFAULT NULL::"text", "p_status" "text" DEFAULT NULL::"text", "p_search" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0, "p_start_date" "date" DEFAULT NULL::"date", "p_end_date" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total_count bigint := 0;
  v_summary record;
  v_runs jsonb := '[]'::jsonb;
BEGIN
  -- Verify caller role
  IF current_user != 'service_role' AND current_user != 'postgres' THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer', 'auditor', 'report_viewer', 'read_only');
  END IF;

  -- Total count query
  SELECT count(*) INTO v_total_count
  FROM public.reconciliation_runs rr
  WHERE (p_company_id IS NULL OR rr.company_id = p_company_id)
    AND (p_source_type IS NULL OR rr.source_type = p_source_type)
    AND (p_status IS NULL OR rr.status = p_status)
    AND (p_start_date IS NULL OR rr.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR rr.created_at::date <= p_end_date)
    AND (p_search IS NULL OR rr.file_name ILIKE '%' || p_search || '%' OR rr.notes ILIKE '%' || p_search || '%')
    AND (CASE WHEN rr.company_id IS NULL THEN public.has_role(v_uid, 'admin'::public.app_role) ELSE public.has_company_access(v_uid, rr.company_id) END);

  -- Aggregate summary metrics
  SELECT 
    COALESCE(sum(total_amount), 0) as grand_total_amount,
    COALESCE(sum(matched_count), 0) as grand_matched_count,
    COALESCE(sum(unmatched_count), 0) as grand_unmatched_count,
    COALESCE(sum(row_count), 0) as grand_row_count
  INTO v_summary
  FROM public.reconciliation_runs rr
  WHERE (p_company_id IS NULL OR rr.company_id = p_company_id)
    AND (p_source_type IS NULL OR rr.source_type = p_source_type)
    AND (p_status IS NULL OR rr.status = p_status)
    AND (p_start_date IS NULL OR rr.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR rr.created_at::date <= p_end_date)
    AND (p_search IS NULL OR rr.file_name ILIKE '%' || p_search || '%' OR rr.notes ILIKE '%' || p_search || '%')
    AND (CASE WHEN rr.company_id IS NULL THEN public.has_role(v_uid, 'admin'::public.app_role) ELSE public.has_company_access(v_uid, rr.company_id) END);

  -- Paginated records query
  SELECT COALESCE(jsonb_agg(to_jsonb(r_sub)), '[]'::jsonb) INTO v_runs
  FROM (
    SELECT 
      rr.id,
      rr.company_id,
      c.company_name as company_name,
      rr.fiscal_year,
      rr.source_type,
      rr.file_name,
      rr.file_hash_sha256,
      rr.row_count,
      rr.total_amount,
      rr.matched_count,
      rr.unmatched_count,
      rr.partial_count,
      rr.rejected_count,
      rr.parser_version,
      rr.matching_rule_version,
      rr.status,
      rr.batch_id,
      rr.notes,
      rr.applied_by,
      rr.applied_at,
      rr.reverted_by,
      rr.reverted_at,
      rr.created_by,
      rr.created_at,
      rr.updated_at
    FROM public.reconciliation_runs rr
    LEFT JOIN public.companies c ON c.id = rr.company_id
    WHERE (p_company_id IS NULL OR rr.company_id = p_company_id)
      AND (p_source_type IS NULL OR rr.source_type = p_source_type)
      AND (p_status IS NULL OR rr.status = p_status)
      AND (p_start_date IS NULL OR rr.created_at::date >= p_start_date)
      AND (p_end_date IS NULL OR rr.created_at::date <= p_end_date)
      AND (p_search IS NULL OR rr.file_name ILIKE '%' || p_search || '%' OR rr.notes ILIKE '%' || p_search || '%')
      AND (CASE WHEN rr.company_id IS NULL THEN public.has_role(v_uid, 'admin'::public.app_role) ELSE public.has_company_access(v_uid, rr.company_id) END)
    ORDER BY rr.created_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 500))
    OFFSET GREATEST(0, p_offset)
  ) r_sub;

  RETURN jsonb_build_object(
    'total_count', v_total_count,
    'limit', p_limit,
    'offset', p_offset,
    'summary', jsonb_build_object(
      'total_amount', v_summary.grand_total_amount,
      'matched_count', v_summary.grand_matched_count,
      'unmatched_count', v_summary.grand_unmatched_count,
      'row_count', v_summary.grand_row_count
    ),
    'runs', v_runs
  );
END;
$$;


ALTER FUNCTION "public"."get_reconciliation_runs_paginated"("p_company_id" "uuid", "p_source_type" "text", "p_status" "text", "p_search" "text", "p_limit" integer, "p_offset" integer, "p_start_date" "date", "p_end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_report_grand_totals"("p_report_id" "text", "p_company_id" "uuid" DEFAULT NULL::"uuid", "p_fiscal_year" "text" DEFAULT NULL::"text", "p_status" "text" DEFAULT NULL::"text", "p_from_date" "text" DEFAULT NULL::"text", "p_to_date" "text" DEFAULT NULL::"text", "p_classification" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_global_access boolean := false;
  v_user_companies uuid[];
  v_count bigint := 0;
  v_shares numeric := 0;
  v_gross numeric := 0;
  v_tax numeric := 0;
  v_net numeric := 0;
  v_disbursed numeric := 0;
  v_remaining numeric := 0;
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);

  -- Multi-tenant isolation check
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

  CASE p_report_id
    WHEN 'dividend_register', 'cash_dividend_register', 'right_share_register', 'cdsc_report', 'allocation_report', 'bonus_share_report' THEN
      SELECT
        COUNT(*),
        COALESCE(SUM(shares_held), 0),
        COALESCE(SUM(gross_dividend), 0),
        COALESCE(SUM(tax_amount), 0),
        COALESCE(SUM(net_payable), 0),
        COALESCE(SUM(COALESCE(paid_amount, CASE WHEN payment_status::text = 'Paid' THEN net_payable ELSE 0 END)), 0),
        COALESCE(SUM(COALESCE(remaining_amount, GREATEST(0, net_payable - COALESCE(paid_amount, 0)))), 0)
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.dividend_payables
      WHERE
        (v_is_global_access OR company_id = ANY(v_user_companies))
        AND (p_company_id IS NULL OR company_id = p_company_id)
        AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
        AND (p_status IS NULL OR p_status = 'all' OR payment_status::text = p_status)
        AND (p_classification IS NULL OR p_classification = 'all' OR payee_classification = p_classification)
        AND (
          p_report_id <> 'allocation_report' AND p_report_id <> 'bonus_share_report'
          OR dividend_type::text IN ('Bonus', 'Stock', 'Combined')
        )
        AND (
          p_report_id <> 'right_share_register'
          OR dividend_type::text = 'Right'
        )
        AND (
          p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date
        )
        AND (
          p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date
        );

    WHEN 'interest_register' THEN
      SELECT
        COUNT(*),
        COALESCE(SUM(shares_held), 0),
        COALESCE(SUM(gross_interest), 0),
        COALESCE(SUM(tax_amount), 0),
        COALESCE(SUM(net_payable), 0),
        COALESCE(SUM(COALESCE(paid_amount, CASE WHEN payment_status::text = 'Paid' THEN net_payable ELSE 0 END)), 0),
        COALESCE(SUM(COALESCE(remaining_amount, GREATEST(0, net_payable - COALESCE(paid_amount, 0)))), 0)
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.interest_payables
      WHERE
        (v_is_global_access OR company_id = ANY(v_user_companies))
        AND (p_company_id IS NULL OR company_id = p_company_id)
        AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
        AND (p_status IS NULL OR p_status = 'all' OR payment_status::text = p_status)
        AND (p_classification IS NULL OR p_classification = 'all' OR payee_classification = p_classification)
        AND (p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date)
        AND (p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date);

    WHEN 'mutual_fund_register' THEN
      SELECT
        COUNT(*),
        COALESCE(SUM(shares_held), 0),
        COALESCE(SUM(gross_dividend), 0),
        COALESCE(SUM(tax_amount), 0),
        COALESCE(SUM(net_payable), 0),
        COALESCE(SUM(COALESCE(paid_amount, CASE WHEN payment_status::text = 'Paid' THEN net_payable ELSE 0 END)), 0),
        COALESCE(SUM(COALESCE(remaining_amount, GREATEST(0, net_payable - COALESCE(paid_amount, 0)))), 0)
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.mutual_fund_payables
      WHERE
        (v_is_global_access OR company_id = ANY(v_user_companies))
        AND (p_company_id IS NULL OR company_id = p_company_id)
        AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
        AND (p_status IS NULL OR p_status = 'all' OR payment_status::text = p_status)
        AND (p_classification IS NULL OR p_classification = 'all' OR payee_classification = p_classification)
        AND (p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date)
        AND (p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date);

    WHEN 'tax_register' THEN
      -- Aggregated over all 3 payables
      WITH all_tax AS (
        SELECT gross_dividend AS gross, tax_amount AS tax, net_payable AS net
        FROM public.dividend_payables
        WHERE (v_is_global_access OR company_id = ANY(v_user_companies))
          AND (p_company_id IS NULL OR company_id = p_company_id)
          AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
          AND (p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date)
          AND (p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date)
        UNION ALL
        SELECT gross_interest AS gross, tax_amount AS tax, net_payable AS net
        FROM public.interest_payables
        WHERE (v_is_global_access OR company_id = ANY(v_user_companies))
          AND (p_company_id IS NULL OR company_id = p_company_id)
          AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
          AND (p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date)
          AND (p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date)
        UNION ALL
        SELECT gross_dividend AS gross, tax_amount AS tax, net_payable AS net
        FROM public.mutual_fund_payables
        WHERE (v_is_global_access OR company_id = ANY(v_user_companies))
          AND (p_company_id IS NULL OR company_id = p_company_id)
          AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
          AND (p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date)
          AND (p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date)
      )
      SELECT COUNT(*), 0, COALESCE(SUM(gross), 0), COALESCE(SUM(tax), 0), COALESCE(SUM(net), 0), 0, 0
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM all_tax;

    WHEN 'pending_register' THEN
      WITH all_pending AS (
        SELECT gross_dividend AS gross, tax_amount AS tax, net_payable AS net
        FROM public.dividend_payables
        WHERE payment_status::text = 'Pending'
          AND (v_is_global_access OR company_id = ANY(v_user_companies))
          AND (p_company_id IS NULL OR company_id = p_company_id)
          AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
        UNION ALL
        SELECT gross_interest AS gross, tax_amount AS tax, net_payable AS net
        FROM public.interest_payables
        WHERE payment_status::text = 'Pending'
          AND (v_is_global_access OR company_id = ANY(v_user_companies))
          AND (p_company_id IS NULL OR company_id = p_company_id)
          AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
        UNION ALL
        SELECT gross_dividend AS gross, tax_amount AS tax, net_payable AS net
        FROM public.mutual_fund_payables
        WHERE payment_status::text = 'Pending'
          AND (v_is_global_access OR company_id = ANY(v_user_companies))
          AND (p_company_id IS NULL OR company_id = p_company_id)
          AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
      )
      SELECT COUNT(*), 0, COALESCE(SUM(gross), 0), COALESCE(SUM(tax), 0), COALESCE(SUM(net), 0), 0, COALESCE(SUM(net), 0)
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM all_pending;

    WHEN 'payment_register' THEN
      SELECT
        COUNT(*),
        0,
        COALESCE(SUM(total_amount), 0),
        0,
        COALESCE(SUM(total_amount), 0),
        COALESCE(SUM(CASE WHEN status::text = 'Completed' THEN total_amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN status::text <> 'Completed' THEN total_amount ELSE 0 END), 0)
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.payment_batches
      WHERE
        (v_is_global_access OR company_id = ANY(v_user_companies) OR company_id IS NULL)
        AND (p_company_id IS NULL OR company_id = p_company_id)
        AND (p_status IS NULL OR p_status = 'all' OR status::text = p_status)
        AND (p_from_date IS NULL OR p_from_date = '' OR created_at >= p_from_date::timestamptz)
        AND (p_to_date IS NULL OR p_to_date = '' OR created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz);

    WHEN 'returned_payments_report' THEN
      SELECT
        COUNT(*),
        0,
        COALESCE(SUM(net_amount), 0),
        0,
        COALESCE(SUM(net_amount), 0),
        0,
        COALESCE(SUM(net_amount), 0)
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.payments
      WHERE
        status IN ('Returned', 'Reversed')
        AND (v_is_global_access OR company_id = ANY(v_user_companies))
        AND (p_company_id IS NULL OR company_id = p_company_id)
        AND (p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date)
        AND (p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date);

    WHEN 'bounced_cheques_report' THEN
      SELECT
        COUNT(*),
        0,
        COALESCE(SUM(net_amount), 0),
        0,
        COALESCE(SUM(net_amount), 0),
        0,
        COALESCE(SUM(net_amount), 0)
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.payments
      WHERE
        status = 'Bounced'
        AND (v_is_global_access OR company_id = ANY(v_user_companies))
        AND (p_company_id IS NULL OR company_id = p_company_id)
        AND (p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date)
        AND (p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date);

    WHEN 'bank_statement_report' THEN
      SELECT
        COUNT(*),
        0,
        COALESCE(SUM(total_credit), 0),
        COALESCE(SUM(total_debit), 0),
        COALESCE(SUM(total_credit - total_debit), 0),
        0,
        0
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.bank_statements
      WHERE
        (p_from_date IS NULL OR p_from_date = '' OR statement_date >= p_from_date::date)
        AND (p_to_date IS NULL OR p_to_date = '' OR statement_date <= p_to_date::date);

    WHEN 'client_profile_report', 'demographics_report' THEN
      SELECT COUNT(*), 0, 0, 0, 0, 0, 0
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.clients
      WHERE
        (v_is_global_access OR company_id = ANY(v_user_companies))
        AND (p_company_id IS NULL OR company_id = p_company_id);

    ELSE
      -- Generic fallback across dividend_payables
      SELECT COUNT(*), 0, COALESCE(SUM(gross_dividend), 0), COALESCE(SUM(tax_amount), 0), COALESCE(SUM(net_payable), 0), 0, 0
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.dividend_payables
      WHERE (v_is_global_access OR company_id = ANY(v_user_companies))
        AND (p_company_id IS NULL OR company_id = p_company_id);
  END CASE;

  RETURN jsonb_build_object(
    'report_id', p_report_id,
    'total_records', v_count,
    'total_shares', v_shares,
    'total_gross', v_gross,
    'total_tax', v_tax,
    'total_net', v_net,
    'total_disbursed', v_disbursed,
    'total_remaining', v_remaining,
    'server_calculated', true,
    'timestamp', now()
  );
END;
$$;


ALTER FUNCTION "public"."get_report_grand_totals"("p_report_id" "text", "p_company_id" "uuid", "p_fiscal_year" "text", "p_status" "text", "p_from_date" "text", "p_to_date" "text", "p_classification" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_any_role"("_user_id" "uuid", "_roles" "public"."app_role"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles));
$$;


ALTER FUNCTION "public"."has_any_role"("_user_id" "uuid", "_roles" "public"."app_role"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_company_access"("_user_id" "uuid", "_company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
   SELECT
     CASE
       WHEN _user_id IS NULL OR _company_id IS NULL THEN FALSE
       -- Global access roles: admin, supervisor, auditor, report_viewer, read_only
       WHEN (SELECT public.has_any_role(_user_id, ARRAY[
         'admin'::public.app_role,
         'supervisor'::public.app_role,
         'auditor'::public.app_role,
         'report_viewer'::public.app_role,
         'read_only'::public.app_role
       ])) THEN TRUE
       -- Company creator has access
       WHEN EXISTS (
         SELECT 1 FROM public.companies
         WHERE id = _company_id
           AND created_by = _user_id
       ) THEN TRUE
       -- If this user has explicit company assignments, enforce strict tenant isolation
       WHEN EXISTS (
         SELECT 1 FROM public.user_company_access
         WHERE user_id = _user_id
       ) THEN EXISTS (
         SELECT 1 FROM public.user_company_access
         WHERE user_id = _user_id
           AND company_id = _company_id
       )
       -- If no specific company restrictions are assigned, allow access to company records
       ELSE TRUE
     END;
$$;


ALTER FUNCTION "public"."has_company_access"("_user_id" "uuid", "_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;


ALTER FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_bank_statement_ledger_atomic"("p_import_info" "jsonb", "p_transactions" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_company_id uuid;
  v_bank_name text;
  v_account_no text;
  v_file_hash text;
  v_file_name text;
  v_opening_balance numeric(15,2);
  v_closing_balance numeric(15,2);
  v_row_count int;
  v_total_credit numeric(15,2);
  v_total_debit numeric(15,2);
  v_import_id uuid;
  v_existing_import_status text;
  v_inserted_txns int := 0;
  v_duplicate_txns int := 0;
  v_t jsonb;
  v_fingerprint text;
  v_resolved_ref text;
  v_raw_fingerprint_str text;
  v_diag_rows int := 0;
BEGIN
  -- 1. Role verification
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');
  END IF;

  v_company_id := NULLIF(p_import_info->>'company_id', '')::uuid;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Target company_id is required for bank statement import' USING ERRCODE = '23502';
  END IF;

  -- 2. Tenant isolation check
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    IF NOT public.has_company_access(v_uid, v_company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to target company %', v_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  v_bank_name := COALESCE(NULLIF(p_import_info->>'bank_name', ''), 'Bank Statement Ledger');
  v_account_no := COALESCE(NULLIF(p_import_info->>'account_no', ''), 'UNKNOWN_ACCT');
  v_file_hash := NULLIF(p_import_info->>'file_hash_sha256', '');
  v_file_name := COALESCE(NULLIF(p_import_info->>'file_name', ''), 'unknown.xlsx');
  v_opening_balance := COALESCE(NULLIF(p_import_info->>'opening_balance', '')::numeric, 0);
  v_closing_balance := COALESCE(NULLIF(p_import_info->>'closing_balance', '')::numeric, 0);
  v_row_count := COALESCE(NULLIF(p_import_info->>'row_count', '')::int, jsonb_array_length(p_transactions));
  v_total_credit := COALESCE(NULLIF(p_import_info->>'total_credit', '')::numeric, 0);
  v_total_debit := COALESCE(NULLIF(p_import_info->>'total_debit', '')::numeric, 0);

  -- Balance integrity validation: opening_balance + total_credit - total_debit = closing_balance
  -- Enforced whenever non-zero opening or closing balances are provided
  IF (v_opening_balance != 0 OR v_closing_balance != 0) THEN
    IF abs((v_opening_balance + v_total_credit - v_total_debit) - v_closing_balance) > 0.05 THEN
      RAISE EXCEPTION 'Bank statement balance integrity violation: opening (%) + credit (%) - debit (%) = %, which does not match closing (%)',
        v_opening_balance, v_total_credit, v_total_debit, (v_opening_balance + v_total_credit - v_total_debit), v_closing_balance USING ERRCODE = '23514';
    END IF;
  END IF;

  -- 3. Idempotency & Retry Check
  IF v_file_hash IS NOT NULL THEN
    SELECT id, status INTO v_import_id, v_existing_import_status
    FROM public.bank_statement_imports
    WHERE company_id = v_company_id
      AND file_hash_sha256 = v_file_hash
    LIMIT 1;

    IF v_import_id IS NOT NULL THEN
      IF v_existing_import_status IN ('imported', 'reconciled') THEN
        RETURN jsonb_build_object(
          'success', true,
          'import_id', v_import_id,
          'file_hash', v_file_hash,
          'inserted_count', 0,
          'is_duplicate', true,
          'message', 'Bank statement file already imported for this company'
        );
      ELSIF v_existing_import_status = 'rejected' THEN
        -- Retry / Reset previously rejected import:
        -- Remove any partial orphaned transactions from previous failed attempt
        DELETE FROM public.bank_statement_transactions WHERE import_id = v_import_id;

        -- Update the rejected import record to fresh 'imported' state
        UPDATE public.bank_statement_imports
        SET bank_name = v_bank_name,
            account_no = v_account_no,
            file_name = v_file_name,
            opening_balance = v_opening_balance,
            closing_balance = v_closing_balance,
            row_count = v_row_count,
            total_credit = v_total_credit,
            total_debit = v_total_debit,
            status = 'imported',
            parser_metadata = COALESCE(p_import_info->'parser_metadata', '{}'::jsonb),
            created_by = v_uid,
            created_at = now()
        WHERE id = v_import_id;
      END IF;
    END IF;
  END IF;

  IF v_import_id IS NULL THEN
    -- 4. Create bank statement import ledger record
    INSERT INTO public.bank_statement_imports (
      company_id,
      bank_name,
      account_no,
      file_name,
      file_hash_sha256,
      opening_balance,
      closing_balance,
      row_count,
      total_credit,
      total_debit,
      status,
      parser_metadata,
      created_by
    ) VALUES (
      v_company_id,
      v_bank_name,
      v_account_no,
      v_file_name,
      v_file_hash,
      v_opening_balance,
      v_closing_balance,
      v_row_count,
      v_total_credit,
      v_total_debit,
      'imported',
      COALESCE(p_import_info->'parser_metadata', '{}'::jsonb),
      v_uid
    ) RETURNING id INTO v_import_id;
  END IF;

  -- 5. Atomically insert all transactions
  FOR v_t IN SELECT * FROM jsonb_array_elements(p_transactions)
  LOOP
    v_resolved_ref := COALESCE(NULLIF(v_t->>'reference', ''), NULLIF(v_t->>'instruction_id', ''), NULLIF(v_t->>'reference_id', ''));
    v_fingerprint := NULLIF(v_t->>'transaction_fingerprint', '');
    IF v_fingerprint IS NULL THEN
      v_raw_fingerprint_str := v_company_id::text || '|' || COALESCE(v_t->>'transaction_date', '') || '|' || COALESCE(v_t->>'description', '') || '|' || COALESCE(v_resolved_ref, '') || '|' || COALESCE(v_t->>'debit_amount', '0') || '|' || COALESCE(v_t->>'credit_amount', '0');
      v_fingerprint := encode(extensions.digest(v_raw_fingerprint_str::bytea, 'sha256'), 'hex');
    END IF;

    INSERT INTO public.bank_statement_transactions (
      import_id,
      company_id,
      transaction_date,
      description,
      reference,
      debit_amount,
      credit_amount,
      balance,
      raw_data,
      transaction_fingerprint,
      reconciliation_status
    ) VALUES (
      v_import_id,
      v_company_id,
      COALESCE(NULLIF(v_t->>'transaction_date', '')::date, CURRENT_DATE),
      NULLIF(v_t->>'description', ''),
      v_resolved_ref,
      COALESCE(NULLIF(v_t->>'debit_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_t->>'credit_amount', '')::numeric, 0),
      NULLIF(v_t->>'balance', '')::numeric,
      COALESCE(v_t->'raw_data', '{}'::jsonb),
      v_fingerprint,
      'unreconciled'
    )
    ON CONFLICT (company_id, transaction_fingerprint) DO NOTHING;

    GET DIAGNOSTICS v_diag_rows = ROW_COUNT;
    IF v_diag_rows > 0 THEN
      v_inserted_txns := v_inserted_txns + v_diag_rows;
    ELSE
      -- Duplicate bank transaction detected (duplicate within file or already in company ledger)
      -- Explicitly record into reconciliation_exceptions to prevent silent drops
      INSERT INTO public.reconciliation_exceptions (
        company_id,
        source_reference,
        amount,
        exception_reason,
        status,
        created_by
      ) VALUES (
        v_company_id,
        COALESCE(v_resolved_ref, v_fingerprint),
        COALESCE(NULLIF(v_t->>'debit_amount', '')::numeric, NULLIF(v_t->>'credit_amount', '')::numeric, 0),
        'Duplicate bank statement transaction fingerprint (' || v_fingerprint || ') quarantined during import',
        'Open',
        v_uid
      );
      v_duplicate_txns := v_duplicate_txns + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'import_id', v_import_id,
    'file_hash', v_file_hash,
    'inserted_count', v_inserted_txns,
    'duplicate_count', v_duplicate_txns,
    'total_rows', jsonb_array_length(p_transactions),
    'is_duplicate', false
  );
END;
$$;


ALTER FUNCTION "public"."import_bank_statement_ledger_atomic"("p_import_info" "jsonb", "p_transactions" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_upload_progress_atomic"("p_upload_id" "uuid", "p_processed_inc" integer DEFAULT 0, "p_success_inc" integer DEFAULT 0, "p_error_inc" integer DEFAULT 0, "p_error_message" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."increment_upload_progress_atomic"("p_upload_id" "uuid", "p_processed_inc" integer, "p_success_inc" integer, "p_error_inc" integer, "p_error_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_payment_batch_dispatched_atomic"("p_batch_id" "uuid", "p_dispatched_by" "uuid" DEFAULT NULL::"uuid", "p_remarks" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."mark_payment_batch_dispatched_atomic"("p_batch_id" "uuid", "p_dispatched_by" "uuid", "p_remarks" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mask_smtp_secrets"("j" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."mask_smtp_secrets"("j" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_agm_broker_claim_seq"() RETURNS bigint
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  SELECT nextval('public.seq_agm_broker_claim_no');
$$;


ALTER FUNCTION "public"."next_agm_broker_claim_seq"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_import_staging_rows"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_row jsonb;
    v_rows jsonb := '[]'::jsonb;
    v_gross text;
    v_tax text;
    v_net text;
BEGIN
    FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.staged_rows, '[]'::jsonb))
    LOOP
        IF NOT (v_row ? 'name') THEN
            v_row := jsonb_set(
                v_row,
                '{name}',
                to_jsonb(COALESCE(
                    NULLIF(v_row->>'full_name', ''),
                    NULLIF(v_row->>'fullName', ''),
                    NULLIF(v_row->>'investor_name', ''),
                    NULLIF(v_row->>'shareholder_name', ''),
                    ''
                )),
                true
            );
        END IF;

        IF NOT (v_row ? 'bank_account_number') THEN
            v_row := jsonb_set(
                v_row,
                '{bank_account_number}',
                to_jsonb(COALESCE(
                    NULLIF(v_row->>'bank_account_no', ''),
                    NULLIF(v_row->>'account_number', ''),
                    NULLIF(v_row->>'account_no', ''),
                    ''
                )),
                true
            );
        END IF;

        IF NEW.target_table = 'interest_payables' THEN
            v_gross := COALESCE(
                NULLIF(v_row->>'gross_interest', ''),
                NULLIF(v_row->>'interest_amount', ''),
                NULLIF(v_row->>'interest', ''),
                NULLIF(v_row->>'gross_amount', ''),
                NULLIF(v_row->>'gross', '')
            );
            v_tax := COALESCE(
                NULLIF(v_row->>'tax_amount', ''),
                NULLIF(v_row->>'tax', ''),
                NULLIF(v_row->>'tds', ''),
                NULLIF(v_row->>'tds_amount', '')
            );
            v_net := COALESCE(
                NULLIF(v_row->>'net_interest', ''),
                NULLIF(v_row->>'net_interest_payable', ''),
                NULLIF(v_row->>'net_amount', ''),
                NULLIF(v_row->>'net_payable', ''),
                NULLIF(v_row->>'net', '')
            );

            IF v_gross IS NOT NULL AND NOT (v_row ? 'gross_dividend') THEN
                v_row := jsonb_set(v_row, '{gross_dividend}', to_jsonb(v_gross), true);
            END IF;
            IF v_tax IS NOT NULL AND NOT (v_row ? 'tax_amount') THEN
                v_row := jsonb_set(v_row, '{tax_amount}', to_jsonb(v_tax), true);
            END IF;
            IF v_net IS NOT NULL AND NOT (v_row ? 'net_payable') THEN
                v_row := jsonb_set(v_row, '{net_payable}', to_jsonb(v_net), true);
            END IF;
        END IF;

        v_rows := v_rows || jsonb_build_array(v_row);
    END LOOP;

    NEW.staged_rows := v_rows;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."normalize_import_staging_rows"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."populate_payment_batch_chunk"("p_batch_id" "uuid", "p_company_id" "uuid" DEFAULT NULL::"uuid", "p_fiscal_year" "text" DEFAULT NULL::"text", "p_payable_type" "text" DEFAULT 'all'::"text", "p_payment_method" "text" DEFAULT 'ConnectIPS'::"text", "p_installment_tag" "text" DEFAULT 'FULL'::"text", "p_limit" integer DEFAULT 2500) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."populate_payment_batch_chunk"("p_batch_id" "uuid", "p_company_id" "uuid", "p_fiscal_year" "text", "p_payable_type" "text", "p_payment_method" "text", "p_installment_tag" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."populate_staged_interest_metadata"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
    v_boid text;
    v_row jsonb;
    v_due_date text;
BEGIN
    IF NEW.due_date IS NULL THEN
        SELECT c.boid
        INTO v_boid
        FROM public.clients c
        WHERE c.id = NEW.client_id
        LIMIT 1;

        SELECT r.value
        INTO v_row
        FROM public.import_staging s
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.staged_rows, '[]'::jsonb)) r(value)
        WHERE s.upload_id = NEW.upload_id
          AND COALESCE(
              r.value->>'boid',
              r.value->>'BOID',
              r.value->>'client_code',
              r.value->>'folio',
              r.value->>'FOLIO'
          ) = v_boid
        LIMIT 1;

        v_due_date := COALESCE(
            NULLIF(v_row->>'due_date', ''),
            NULLIF(v_row->>'dueDate', ''),
            NULLIF(v_row->>'DUE DATE', ''),
            NULLIF(v_row->>'maturity_date', ''),
            NULLIF(v_row->>'payment_date', ''),
            NULLIF(v_row->>'interest_date', '')
        );

        IF v_due_date IS NOT NULL AND v_due_date ~ '^\d{4}-\d{2}-\d{2}$' THEN
            NEW.due_date := v_due_date::date;
        ELSE
            NEW.due_date := CURRENT_DATE;
        END IF;

    END IF;

    IF NEW.instrument_ref IS NULL THEN
        NEW.instrument_ref := COALESCE(
            NULLIF(v_row->>'instrument_ref', ''),
            NULLIF(v_row->>'instrument', ''),
            NULLIF(v_row->>'instrument_no', ''),
            NULLIF(v_row->>'security', ''),
            NULLIF(v_row->>'series', '')
        );
    END IF;

    RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."populate_staged_interest_metadata"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."promote_agm_clients_and_payables"("p_company_id" "uuid", "p_clients" "jsonb", "p_payables" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_client_rec jsonb;
  v_pay_rec jsonb;
  v_boid text;
  v_client_id uuid;
  v_upserted_clients integer := 0;
  v_inserted_payables integer := 0;
  v_boid_to_id_map jsonb := '{}'::jsonb;
  v_target_fiscal_year text;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id is required';
  END IF;

  -- 1. Upsert Clients with company isolation
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


ALTER FUNCTION "public"."promote_agm_clients_and_payables"("p_company_id" "uuid", "p_clients" "jsonb", "p_payables" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_sensitive_reveal_audit"("p_client_id" "uuid", "p_company_id" "uuid" DEFAULT NULL::"uuid", "p_purpose" "text" DEFAULT 'classification_explainability_inspection'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required for sensitive data inspection' USING ERRCODE = '42501';
  END IF;

  PERFORM public.require_role('admin', 'supervisor', 'approver', 'auditor');

  INSERT INTO public.audit_logs (
    user_id,
    action,
    table_name,
    record_id,
    old_value,
    new_value,
    action_time
  ) VALUES (
    v_uid,
    'SENSITIVE_IDENTIFIER_REVEAL',
    'clients',
    p_client_id::text,
    null,
    jsonb_build_object(
      'company_id', p_company_id,
      'purpose', p_purpose,
      'revealed_at', now()
    ),
    now()
  );

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."record_sensitive_reveal_audit"("p_client_id" "uuid", "p_company_id" "uuid", "p_purpose" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_company_client_map"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_client_map;
  EXCEPTION WHEN OTHERS THEN
    -- Fallback to standard refresh if concurrent is not yet possible
    REFRESH MATERIALIZED VIEW public.company_client_map;
  END;
END;
$$;


ALTER FUNCTION "public"."refresh_company_client_map"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_staged_import"("p_approval_id" "uuid", "p_rejection_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_staged public.import_staging%ROWTYPE;
    v_approval public.pending_approvals%ROWTYPE;
    v_user_id uuid := auth.uid();
    v_is_authorized boolean := false;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT * INTO v_approval
    FROM public.pending_approvals
    WHERE id = p_approval_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pending approval record % not found', p_approval_id;
    END IF;

    IF v_approval.status <> 'Pending' THEN
        RAISE EXCEPTION 'Approval ticket is already %', v_approval.status;
    END IF;

    IF v_approval.requested_by = v_user_id THEN
        RAISE EXCEPTION 'Segregation of duties violation: Maker cannot reject their own material import';
    END IF;

    SELECT public.has_any_role(v_user_id, ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
    INTO v_is_authorized;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Unauthorized: Checker role required to reject material imports';
    END IF;

    SELECT * INTO v_staged
    FROM public.import_staging
    WHERE approval_id = p_approval_id
    FOR UPDATE;

    UPDATE public.pending_approvals
    SET
        status = 'Rejected',
        reviewed_by = v_user_id,
        review_notes = p_rejection_notes,
        reviewed_at = now()
    WHERE id = p_approval_id;

    IF FOUND THEN
        UPDATE public.import_staging
        SET status = 'REJECTED'
        WHERE id = v_staged.id;
    END IF;

    INSERT INTO public.approval_logs (
        approval_id,
        action,
        previous_status,
        new_status,
        remarks,
        performed_by,
        performed_at
    ) VALUES (
        p_approval_id,
        'MATERIAL_IMPORT_REJECTED',
        'Pending',
        'Rejected',
        COALESCE(p_rejection_notes, 'Checker rejected staged import'),
        v_user_id,
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'approval_id', p_approval_id,
        'status', 'Rejected'
    );
END;
$$;


ALTER FUNCTION "public"."reject_staged_import"("p_approval_id" "uuid", "p_rejection_notes" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reject_staged_import"("p_approval_id" "uuid", "p_rejection_notes" "text") IS 'Checker rejection for material staged imports with audit logging.';



CREATE OR REPLACE FUNCTION "public"."replace_agm_fiscal_year_snapshots"("p_company_id" "uuid", "p_fiscal_year" "text", "p_incoming_boids" "text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."replace_agm_fiscal_year_snapshots"("p_company_id" "uuid", "p_fiscal_year" "text", "p_incoming_boids" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."require_role"(VARIADIC "_roles" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."require_role"(VARIADIC "_roles" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."require_role"(VARIADIC "_roles" "public"."app_role"[]) RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."require_role"(VARIADIC "_roles" "public"."app_role"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revert_payment_batch_atomic"("p_batch_id" "uuid", "p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '60s'
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


ALTER FUNCTION "public"."revert_payment_batch_atomic"("p_batch_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revert_payment_batch_atomic"("p_batch_id" "uuid", "p_user_id" "uuid" DEFAULT NULL::"uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '60s'
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


ALTER FUNCTION "public"."revert_payment_batch_atomic"("p_batch_id" "uuid", "p_user_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revert_reconciliation_lot_atomic"("p_result_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reverted_payables int := 0;
  v_updated_payments int := 0;
  v_deleted_results int := 0;
  v_payment_ids uuid[];
  v_completed_count int := 0;
  v_payable_record record;
BEGIN
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');

    -- Verify caller has access to the companies of these reconciliation records
    IF EXISTS (
      SELECT 1 FROM public.reconciliation_results rr
      WHERE rr.id = ANY(p_result_ids)
        AND rr.company_id IS NOT NULL
        AND NOT public.has_company_access(v_uid, rr.company_id)
    ) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to one or more companies in reconciliation lot' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 1. Extract specifically linked payment IDs
  SELECT COALESCE(array_agg(payment_id), '{}') INTO v_payment_ids
  FROM public.reconciliation_results
  WHERE id = ANY(p_result_ids) AND payment_id IS NOT NULL;

  -- Check if any of these specific payments are already Completed
  IF array_length(v_payment_ids, 1) > 0 THEN
    SELECT count(*) INTO v_completed_count
    FROM public.payments
    WHERE id = ANY(v_payment_ids)
      AND status IN ('Completed', 'Settled');

    IF v_completed_count > 0 THEN
      RAISE EXCEPTION 'Safety violation: % payments in this lot are already completed/settled and cannot be reverted automatically.', v_completed_count
        USING ERRCODE = '55000';
    END IF;
  END IF;

  -- 2. Restore payables back to prior snapshot (or Pending/0 if prior snapshot is null)
  FOR v_payable_record IN (
    SELECT DISTINCT ON (payable_type, payable_id)
      payable_type,
      payable_id,
      prior_paid_amount,
      prior_payment_status,
      prior_payment_date,
      prior_payment_reference,
      prior_snapshot
    FROM public.reconciliation_results
    WHERE id = ANY(p_result_ids) AND payable_id IS NOT NULL
    ORDER BY payable_type, payable_id, id ASC
  ) LOOP
    IF LOWER(COALESCE(v_payable_record.payable_type, '')) = 'dividend' THEN
      UPDATE public.dividend_payables
      SET payment_status = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_status')::public.payment_status,
            v_payable_record.prior_payment_status::public.payment_status,
            'Pending'::public.payment_status
          ),
          paid_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'paid_amount')::numeric,
            v_payable_record.prior_paid_amount,
            0
          ),
          remaining_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'remaining_amount')::numeric,
            GREATEST(0, COALESCE(net_payable, 0) - COALESCE(v_payable_record.prior_paid_amount, 0))
          ),
          payment_date = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_date')::date,
            v_payable_record.prior_payment_date
          ),
          payment_reference = COALESCE(
            v_payable_record.prior_snapshot->>'payment_reference',
            v_payable_record.prior_payment_reference
          ),
          updated_at = now()
      WHERE id = v_payable_record.payable_id;
      IF FOUND THEN v_reverted_payables := v_reverted_payables + 1; END IF;

    ELSIF LOWER(COALESCE(v_payable_record.payable_type, '')) IN ('interest', 'debenture') THEN
      UPDATE public.interest_payables
      SET payment_status = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_status')::public.payment_status,
            v_payable_record.prior_payment_status::public.payment_status,
            'Pending'::public.payment_status
          ),
          paid_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'paid_amount')::numeric,
            v_payable_record.prior_paid_amount,
            0
          ),
          remaining_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'remaining_amount')::numeric,
            GREATEST(0, COALESCE(net_payable, 0) - COALESCE(v_payable_record.prior_paid_amount, 0))
          ),
          payment_date = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_date')::date,
            v_payable_record.prior_payment_date
          ),
          payment_reference = COALESCE(
            v_payable_record.prior_snapshot->>'payment_reference',
            v_payable_record.prior_payment_reference
          ),
          updated_at = now()
      WHERE id = v_payable_record.payable_id;
      IF FOUND THEN v_reverted_payables := v_reverted_payables + 1; END IF;

    ELSIF LOWER(COALESCE(v_payable_record.payable_type, '')) = 'mutual_fund' THEN
      UPDATE public.mutual_fund_payables
      SET payment_status = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_status')::public.payment_status,
            v_payable_record.prior_payment_status::public.payment_status,
            'Pending'::public.payment_status
          ),
          paid_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'paid_amount')::numeric,
            v_payable_record.prior_paid_amount,
            0
          ),
          remaining_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'remaining_amount')::numeric,
            GREATEST(0, COALESCE(net_payable, 0) - COALESCE(v_payable_record.prior_paid_amount, 0))
          ),
          payment_date = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_date')::date,
            v_payable_record.prior_payment_date
          ),
          payment_reference = COALESCE(
            v_payable_record.prior_snapshot->>'payment_reference',
            v_payable_record.prior_payment_reference
          ),
          updated_at = now()
      WHERE id = v_payable_record.payable_id;
      IF FOUND THEN v_reverted_payables := v_reverted_payables + 1; END IF;
    END IF;
  END LOOP;

  -- 4. Delete or reset ONLY the explicitly linked payment rows (never unlinked external payments)
  IF array_length(v_payment_ids, 1) > 0 THEN
    WITH del AS (
      DELETE FROM public.payments
      WHERE id = ANY(v_payment_ids)
        AND status NOT IN ('Completed', 'Settled')
      RETURNING id
    )
    SELECT count(*) INTO v_updated_payments FROM del;
  END IF;

  -- 5. Delete reconciliation records for this lot
  WITH del AS (
    DELETE FROM public.reconciliation_results
    WHERE id = ANY(p_result_ids)
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_results FROM del;

  -- 6. Clean up any empty RECON-APPLY payment batches that have no active payments
  DELETE FROM public.payment_batches pb
  WHERE pb.cds_batch_ref = 'RECON-APPLY'
    AND NOT EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.batch_id = pb.id
        AND p.status NOT IN ('Failed', 'Cancelled')
    );

  -- 7. Record audit log
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
  VALUES (
    v_uid,
    'RECONCILIATION_LOT_REVERTED',
    'reconciliation_results',
    p_result_ids[1],
    jsonb_build_object(
      'result_ids_count', array_length(p_result_ids, 1),
      'reverted_payables', v_reverted_payables,
      'deleted_payments', v_updated_payments,
      'deleted_results', v_deleted_results
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'reverted_payables', v_reverted_payables,
    'deleted_payments', v_updated_payments,
    'deleted_results', v_deleted_results
  );
END;
$$;


ALTER FUNCTION "public"."revert_reconciliation_lot_atomic"("p_result_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revert_reconciliation_lot_atomic"("p_company_id" "uuid", "p_fiscal_year" "text", "p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."revert_reconciliation_lot_atomic"("p_company_id" "uuid", "p_fiscal_year" "text", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revert_reconciliation_run_atomic"("p_run_id" "uuid", "p_force" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run record;
  v_completed_count int := 0;
  v_conflict_count int := 0;
  v_reverted_payables int := 0;
  v_deleted_payments int := 0;
  v_payable_record record;
  v_payable_updated_at timestamp with time zone;
BEGIN
  -- 1. Authorization check
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    PERFORM public.require_role('admin', 'supervisor');
  END IF;

  -- 2. Fetch run record
  SELECT * INTO v_run FROM public.reconciliation_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reconciliation run % not found', p_run_id USING ERRCODE = 'P0002';
  END IF;

  -- Verify tenant access
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' AND v_run.company_id IS NOT NULL THEN
    IF NOT public.has_company_access(v_uid, v_run.company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to company %', v_run.company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_run.status = 'reverted' THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Run already reverted',
      'reverted_payables', 0,
      'deleted_payments', 0
    );
  END IF;

  -- 3. Safety check: Check if any linked payments are marked 'Completed' or externally finalized
  SELECT count(*) INTO v_completed_count
  FROM public.payments
  WHERE reconciliation_run_id = p_run_id
    AND status IN ('Completed', 'Settled');

  IF v_completed_count > 0 AND NOT p_force THEN
    RAISE EXCEPTION 'Safety violation: % payments are already finalized/completed. Reversal requires explicit supervisor override (p_force = true).', v_completed_count
      USING ERRCODE = '55000';
  END IF;

  -- Post-apply concurrency check: verify payable has not been modified by subsequent external payments or actions
  IF NOT p_force THEN
    FOR v_payable_record IN (
      SELECT DISTINCT ON (payable_type, payable_id) payable_type, payable_id
      FROM public.reconciliation_results
      WHERE run_id = p_run_id AND payable_id IS NOT NULL
    ) LOOP
      SELECT count(*) INTO v_conflict_count
      FROM public.payments
      WHERE payable_id = v_payable_record.payable_id
        AND (reconciliation_run_id IS NULL OR reconciliation_run_id != p_run_id)
        AND created_at > v_run.created_at;

      IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'Concurrency conflict: payable % has been modified by % subsequent payment(s) after reconciliation. Reversal refused without supervisor override (p_force = true).',
          v_payable_record.payable_id, v_conflict_count USING ERRCODE = '55000';
      END IF;

      -- Post-state verification: verify the payable record itself was not independently updated after reconciliation
      IF LOWER(v_payable_record.payable_type) LIKE '%dividend%' THEN
        SELECT updated_at INTO v_payable_updated_at FROM public.dividend_payables WHERE id = v_payable_record.payable_id;
      ELSIF LOWER(v_payable_record.payable_type) LIKE '%interest%' OR LOWER(v_payable_record.payable_type) LIKE '%debenture%' THEN
        SELECT updated_at INTO v_payable_updated_at FROM public.interest_payables WHERE id = v_payable_record.payable_id;
      ELSIF LOWER(v_payable_record.payable_type) LIKE '%mutual%' THEN
        SELECT updated_at INTO v_payable_updated_at FROM public.mutual_fund_payables WHERE id = v_payable_record.payable_id;
      END IF;

      IF v_payable_updated_at IS NOT NULL AND v_payable_updated_at > COALESCE(v_run.applied_at, v_run.created_at) THEN
        RAISE EXCEPTION 'Concurrency conflict: payable % has been modified after reconciliation was applied (last updated: %). Reversal refused without supervisor override (p_force = true).',
          v_payable_record.payable_id, v_payable_updated_at USING ERRCODE = '55000';
      END IF;
    END LOOP;
  END IF;

  -- 4. Revert ONLY payables linked to this run, restoring their prior snapshot
  FOR v_payable_record IN (
    SELECT DISTINCT ON (payable_type, payable_id)
      payable_type,
      payable_id,
      prior_paid_amount,
      prior_payment_status,
      prior_payment_date,
      prior_payment_reference,
      prior_snapshot
    FROM public.reconciliation_results
    WHERE run_id = p_run_id AND payable_id IS NOT NULL
    ORDER BY payable_type, payable_id, id ASC
  ) LOOP
    IF LOWER(v_payable_record.payable_type) LIKE '%dividend%' THEN
      UPDATE public.dividend_payables
      SET payment_status = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_status')::public.payment_status,
            v_payable_record.prior_payment_status::public.payment_status,
            'Pending'::public.payment_status
          ),
          paid_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'paid_amount')::numeric,
            v_payable_record.prior_paid_amount,
            0
          ),
          remaining_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'remaining_amount')::numeric,
            GREATEST(0, COALESCE(net_payable, 0) - COALESCE(v_payable_record.prior_paid_amount, 0))
          ),
          payment_date = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_date')::date,
            v_payable_record.prior_payment_date
          ),
          payment_reference = COALESCE(
            v_payable_record.prior_snapshot->>'payment_reference',
            v_payable_record.prior_payment_reference
          ),
          updated_at = now()
      WHERE id = v_payable_record.payable_id;
      IF FOUND THEN v_reverted_payables := v_reverted_payables + 1; END IF;

    ELSIF LOWER(v_payable_record.payable_type) LIKE '%interest%' OR LOWER(v_payable_record.payable_type) LIKE '%debenture%' THEN
      UPDATE public.interest_payables
      SET payment_status = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_status')::public.payment_status,
            v_payable_record.prior_payment_status::public.payment_status,
            'Pending'::public.payment_status
          ),
          paid_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'paid_amount')::numeric,
            v_payable_record.prior_paid_amount,
            0
          ),
          remaining_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'remaining_amount')::numeric,
            GREATEST(0, COALESCE(net_payable, 0) - COALESCE(v_payable_record.prior_paid_amount, 0))
          ),
          payment_date = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_date')::date,
            v_payable_record.prior_payment_date
          ),
          payment_reference = COALESCE(
            v_payable_record.prior_snapshot->>'payment_reference',
            v_payable_record.prior_payment_reference
          ),
          updated_at = now()
      WHERE id = v_payable_record.payable_id;
      IF FOUND THEN v_reverted_payables := v_reverted_payables + 1; END IF;

    ELSIF LOWER(v_payable_record.payable_type) LIKE '%mutual%' THEN
      UPDATE public.mutual_fund_payables
      SET payment_status = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_status')::public.payment_status,
            v_payable_record.prior_payment_status::public.payment_status,
            'Pending'::public.payment_status
          ),
          paid_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'paid_amount')::numeric,
            v_payable_record.prior_paid_amount,
            0
          ),
          remaining_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'remaining_amount')::numeric,
            GREATEST(0, COALESCE(net_payable, 0) - COALESCE(v_payable_record.prior_paid_amount, 0))
          ),
          payment_date = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_date')::date,
            v_payable_record.prior_payment_date
          ),
          payment_reference = COALESCE(
            v_payable_record.prior_snapshot->>'payment_reference',
            v_payable_record.prior_payment_reference
          ),
          updated_at = now()
      WHERE id = v_payable_record.payable_id;
      IF FOUND THEN v_reverted_payables := v_reverted_payables + 1; END IF;
    END IF;
  END LOOP;

  -- 5. Delete or reset ONLY payments that belong to this run
  WITH del_p AS (
    DELETE FROM public.payments
    WHERE reconciliation_run_id = p_run_id
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_payments FROM del_p;

  -- 6. Clean up auto-generated payment batch if it has no remaining payments
  IF v_run.batch_id IS NOT NULL THEN
    DELETE FROM public.payment_batches
    WHERE id = v_run.batch_id
      AND NOT EXISTS (
        SELECT 1 FROM public.payments WHERE batch_id = v_run.batch_id
      );
  END IF;

  -- 7. Update run status to 'reverted'
  UPDATE public.reconciliation_runs
  SET status = 'reverted',
      reverted_by = v_uid,
      reverted_at = now(),
      updated_at = now()
  WHERE id = p_run_id;

  -- Reset bank statement transactions and imports linked to this run
  UPDATE public.bank_statement_transactions
  SET reconciliation_status = 'unreconciled',
      reconciliation_run_id = NULL
  WHERE reconciliation_run_id = p_run_id;

  UPDATE public.bank_statement_imports
  SET status = 'imported',
      updated_at = now()
  WHERE company_id = v_run.company_id
    AND (
      (v_run.file_hash_sha256 IS NOT NULL AND file_hash_sha256 = v_run.file_hash_sha256)
      OR id IN (
        SELECT DISTINCT import_id FROM public.bank_statement_transactions WHERE reconciliation_run_id = p_run_id
      )
    );

  -- 8. Audit log
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
  VALUES (
    v_uid,
    'RECONCILIATION_RUN_REVERTED',
    'reconciliation_runs',
    p_run_id,
    jsonb_build_object(
      'run_id', p_run_id,
      'company_id', v_run.company_id,
      'reverted_payables', v_reverted_payables,
      'deleted_payments', v_deleted_payments
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'run_id', p_run_id,
    'reverted_payables', v_reverted_payables,
    'deleted_payments', v_deleted_payments
  );
END;
$$;


ALTER FUNCTION "public"."revert_reconciliation_run_atomic"("p_run_id" "uuid", "p_force" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rollback_upload_atomic"("p_upload_id" "uuid", "p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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
BEGIN
  -- 1. Enforce strict authentication check
  IF auth.uid() IS NULL AND current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- 2. Strictly restrict rollback execution to admin role
  IF auth.uid() IS NOT NULL THEN
    v_is_admin := public.has_role(auth.uid(), 'admin'::app_role);
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Access denied. Rollback operations are strictly restricted to admin role.';
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


ALTER FUNCTION "public"."rollback_upload_atomic"("p_upload_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rollback_upload_file_atomic"("p_file_hash" "text" DEFAULT NULL::"text", "p_file_name" "text" DEFAULT NULL::"text", "p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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

  -- 2. Strictly restrict rollback execution to admin role
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
      RAISE EXCEPTION 'Access denied. Rollback operations are strictly restricted to admin role.';
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
    'total_payables_deleted', v_total_payables,
    'total_clients_deleted', v_total_clients,
    'total_errors_deleted', v_total_errors
  );
END;
$$;


ALTER FUNCTION "public"."rollback_upload_file_atomic"("p_file_hash" "text", "p_file_name" "text", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_reconciliation_draft_results_atomic"("p_run_info" "jsonb", "p_results" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_company_id uuid;
  v_run_id uuid;
  v_res jsonb;
  v_saved_count int := 0;
  v_file_hash text;
  v_file_name text;
BEGIN
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');
  END IF;

  v_company_id := NULLIF(p_run_info->>'company_id', '')::uuid;
  IF v_company_id IS NOT NULL THEN
    IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
      IF NOT public.has_company_access(v_uid, v_company_id) THEN
        RAISE EXCEPTION 'Unauthorized: caller lacks access to target company %', v_company_id USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  v_file_name := COALESCE(NULLIF(p_run_info->>'file_name', ''), 'manual-reconciliation');
  v_file_hash := COALESCE(NULLIF(p_run_info->>'file_hash_sha256', ''), md5(now()::text || p_run_info::text));

  v_run_id := NULLIF(p_run_info->>'run_id', '')::uuid;
  IF v_run_id IS NULL THEN
    INSERT INTO public.reconciliation_runs (
      company_id,
      fiscal_year,
      source_type,
      file_name,
      file_hash_sha256,
      row_count,
      total_amount,
      matched_count,
      partial_count,
      rejected_count,
      unmatched_count,
      status,
      created_by
    ) VALUES (
      v_company_id,
      NULLIF(p_run_info->>'fiscal_year', ''),
      COALESCE(NULLIF(p_run_info->>'source_type', ''), 'manual'),
      v_file_name,
      v_file_hash,
      COALESCE(NULLIF(p_run_info->>'row_count', '')::int, jsonb_array_length(p_results)),
      COALESCE(NULLIF(p_run_info->>'total_amount', '')::numeric, 0),
      COALESCE(NULLIF(p_run_info->>'matched_count', '')::int, 0),
      COALESCE(NULLIF(p_run_info->>'partial_count', '')::int, 0),
      COALESCE(NULLIF(p_run_info->>'rejected_count', '')::int, 0),
      COALESCE(NULLIF(p_run_info->>'unmatched_count', '')::int, 0),
      'draft',
      v_uid
    ) RETURNING id INTO v_run_id;
  END IF;

  FOR v_res IN SELECT * FROM jsonb_array_elements(p_results)
  LOOP
    INSERT INTO public.reconciliation_results (
      run_id,
      reconciliation_date,
      source_reference,
      source_a_type,
      source_a_id,
      source_b_type,
      source_b_id,
      client_id,
      company_id,
      payable_type,
      payable_id,
      expected_amount,
      actual_amount,
      difference,
      result,
      notes,
      requires_manual_approval,
      match_method,
      match_confidence,
      rule_version,
      matched_by
    ) VALUES (
      v_run_id,
      COALESCE(NULLIF(v_res->>'reconciliation_date', '')::date, CURRENT_DATE),
      NULLIF(v_res->>'source_reference', ''),
      COALESCE(NULLIF(v_res->>'source_a_type', ''), 'bank_statement'),
      NULLIF(v_res->>'source_a_id', '')::uuid,
      COALESCE(NULLIF(v_res->>'source_b_type', ''), 'payable'),
      NULLIF(v_res->>'source_b_id', '')::uuid,
      NULLIF(v_res->>'client_id', '')::uuid,
      v_company_id,
      NULLIF(v_res->>'payable_type', ''),
      NULLIF(v_res->>'payable_id', '')::uuid,
      COALESCE(NULLIF(v_res->>'expected_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_res->>'actual_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_res->>'difference', '')::numeric, 0),
      CASE UPPER(COALESCE(v_res->>'result', 'NOT_MATCHED'))
        WHEN 'MATCHED' THEN 'Matched'::public.reconciliation_result
        WHEN 'PARTIAL' THEN 'Partial'::public.reconciliation_result
        WHEN 'UNDER_PAID' THEN 'Under_Paid'::public.reconciliation_result
        WHEN 'OVER_PAID' THEN 'Over_Paid'::public.reconciliation_result
        WHEN 'EXCEPTION' THEN 'Exception'::public.reconciliation_result
        WHEN 'REJECTED' THEN 'Exception'::public.reconciliation_result
        WHEN 'DUPLICATE' THEN 'Duplicate'::public.reconciliation_result
        ELSE 'Not_Matched'::public.reconciliation_result
      END,
      NULLIF(v_res->>'notes', ''),
      CASE WHEN UPPER(COALESCE(v_res->>'result', '')) IN ('UNDER_PAID', 'OVER_PAID', 'PARTIAL') THEN true ELSE false END,
      COALESCE(NULLIF(v_res->>'match_method', ''), 'manual'),
      COALESCE(NULLIF(v_res->>'match_confidence', '')::numeric, 100),
      COALESCE(NULLIF(v_res->>'rule_version', ''), '2.0.0'),
      v_uid
    );
    v_saved_count := v_saved_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id,
    'saved_count', v_saved_count
  );
END;
$$;


ALTER FUNCTION "public"."save_reconciliation_draft_results_atomic"("p_run_info" "jsonb", "p_results" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_system_settings_global"("p_settings" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."save_system_settings_global"("p_settings" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_payments_paginated"("p_search_term" "text" DEFAULT NULL::"text", "p_company_id" "uuid" DEFAULT NULL::"uuid", "p_status" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 15, "p_offset" integer DEFAULT 0) RETURNS TABLE("id" "uuid", "company_id" "uuid", "client_id" "uuid", "gross_amount" numeric, "tax_amount" numeric, "net_amount" numeric, "paid_amount" numeric, "status" "text", "bank_name" "text", "bank_account_no" "text", "payment_reference" "text", "connectips_ref" "text", "payment_method" "text", "payment_date" "date", "created_at" timestamp with time zone, "boid" "text", "full_name" "text", "holder_type" "text", "company_name" "text", "company_code" "text", "total_count" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_clean_search text := trim(p_search_term);
BEGIN
    RETURN QUERY
    WITH filtered AS (
        SELECT
            p.id,
            p.company_id,
            p.client_id,
            p.gross_amount,
            p.tax_amount,
            p.net_amount,
            p.paid_amount,
            p.status::text,
            p.bank_name,
            p.bank_account_no,
            p.payment_reference,
            p.connectips_ref,
            p.payment_method::text,
            p.payment_date,
            p.created_at,
            c.boid,
            c.full_name,
            c.holder_type::text,
            co.company_name,
            co.company_code,
            COUNT(*) OVER() AS total_count
        FROM public.payments p
        LEFT JOIN public.clients c ON p.client_id = c.id
        LEFT JOIN public.companies co ON p.company_id = co.id
        WHERE
            (p_company_id IS NULL OR p.company_id = p_company_id)
            AND (p_status IS NULL OR p_status = 'all' OR p.status::text = p_status)
            AND (
                v_clean_search IS NULL OR v_clean_search = ''
                OR p.payment_reference ILIKE '%' || v_clean_search || '%'
                OR p.connectips_ref ILIKE '%' || v_clean_search || '%'
                OR p.bank_account_no ILIKE '%' || v_clean_search || '%'
                OR c.boid ILIKE '%' || v_clean_search || '%'
                OR c.full_name ILIKE '%' || v_clean_search || '%'
            )
        ORDER BY p.created_at DESC, p.id ASC
        LIMIT p_limit
        OFFSET p_offset
    )
    SELECT * FROM filtered;
END;
$$;


ALTER FUNCTION "public"."search_payments_paginated"("p_search_term" "text", "p_company_id" "uuid", "p_status" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."search_payments_paginated"("p_search_term" "text", "p_company_id" "uuid", "p_status" "text", "p_limit" integer, "p_offset" integer) IS 'Paginated server-side search across payment reference, connectips ref, account number, shareholder BOID, and shareholder full name.';



CREATE OR REPLACE FUNCTION "public"."set_approval_log_actor"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.performed_by := auth.uid();
  END IF;
  NEW.performed_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_approval_log_actor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_audit_log_actor"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  NEW.action_time := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_audit_log_actor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_payment_log_actor"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.performed_by := auth.uid();
  END IF;
  NEW.performed_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_payment_log_actor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_upload_user_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_upload_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_all_classifications_and_taxes"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."sync_all_classifications_and_taxes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_client_payee_classification"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."sync_client_payee_classification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_clients_bonus_holdings"("p_company_id" "uuid", "p_fiscal_year" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "statement_timeout" TO '60s'
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


ALTER FUNCTION "public"."sync_clients_bonus_holdings"("p_company_id" "uuid", "p_fiscal_year" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_payables_on_client_classification_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."sync_payables_on_client_classification_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_clients_set_needs_review"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."trg_clients_set_needs_review"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_companies_generic_defaults"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."trg_companies_generic_defaults"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_fn_sync_payment_batch_completion"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."trg_fn_sync_payment_batch_completion"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_process_scheduled_reports"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'cron'
    AS $$
DECLARE
    v_url text;
    v_cron_secret text;
    v_request_id bigint;
BEGIN
    v_url := coalesce(
        nullif(current_setting('app.settings.edge_function_url', true), ''),
        'http://supabase_kong_illokcvaflhzrpxlwhtj:8000/functions/v1/process-scheduled-reports'
    );
    v_cron_secret := public.get_cron_secret();

    IF v_cron_secret IS NULL THEN
        RAISE EXCEPTION 'CRON trigger failed: app.settings.cron_secret is not configured. Hardcoded fallback has been removed.';
    END IF;

    SELECT net.http_post(
        url := v_url,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', v_cron_secret
        ),
        body := '{}'::jsonb
    ) INTO v_request_id;

    RETURN jsonb_build_object(
        'success', true,
        'request_id', v_request_id,
        'endpoint', v_url,
        'triggered_at', now()
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM,
        'triggered_at', now()
    );
END;
$$;


ALTER FUNCTION "public"."trigger_process_scheduled_reports"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."agm_broker_claims" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "seq_no" bigint NOT NULL,
    "broker_code" "text" NOT NULL,
    "broker_name" "text" NOT NULL,
    "pool_boid" "text" NOT NULL,
    "claimant_boid" "text" NOT NULL,
    "claimant_name" "text" NOT NULL,
    "fiscal_year" "text" NOT NULL,
    "claimed_kitta" numeric(15,4) NOT NULL,
    "claimed_cash" numeric(15,2) NOT NULL,
    "contract_note_no" "text" NOT NULL,
    "trade_date_bs" "text" NOT NULL,
    "status" "text" DEFAULT 'APPROVED'::"text" NOT NULL,
    "approve_date" timestamp with time zone DEFAULT "now"(),
    "approved_by" "text" DEFAULT 'Operator'::"text",
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company_id" "uuid",
    CONSTRAINT "agm_broker_claims_status_check" CHECK (("status" = ANY (ARRAY['PENDING'::"text", 'APPROVED'::"text", 'REJECTED'::"text"])))
);


ALTER TABLE "public"."agm_broker_claims" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agm_broker_pools" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "broker_code" "text" NOT NULL,
    "broker_name" "text" NOT NULL,
    "pool_boid" "text" NOT NULL,
    "fiscal_year" "text" NOT NULL,
    "unclaimed_kitta" numeric(15,4) DEFAULT 0 NOT NULL,
    "unclaimed_cash" numeric(15,2) DEFAULT 0 NOT NULL,
    "claimed_kitta" numeric(15,4) DEFAULT 0 NOT NULL,
    "claimed_cash" numeric(15,2) DEFAULT 0 NOT NULL,
    "active_balance_kitta" numeric(15,4) DEFAULT 0 NOT NULL,
    "active_balance_cash" numeric(15,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company_id" "uuid"
);


ALTER TABLE "public"."agm_broker_pools" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agm_drn_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "folio_no" "text" NOT NULL,
    "holder_name" "text" NOT NULL,
    "certificate_no_start" bigint,
    "certificate_no_end" bigint,
    "distinctive_no_start" bigint,
    "distinctive_no_end" bigint,
    "total_kitta" numeric(15,4) NOT NULL,
    "drn_no" "text",
    "drn_date" "text",
    "target_boid" "text",
    "status" "text" DEFAULT 'PHYSICAL'::"text" NOT NULL,
    "reconciled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company_id" "uuid",
    CONSTRAINT "agm_drn_records_status_check" CHECK (("status" = ANY (ARRAY['PHYSICAL'::"text", 'POSTED'::"text", 'ACCEPTED'::"text", 'REJECTED'::"text"])))
);


ALTER TABLE "public"."agm_drn_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agm_fiscal_year_meta" (
    "fiscal_year" "text" NOT NULL,
    "event_name" "text" NOT NULL,
    "total_shareholders" integer DEFAULT 0 NOT NULL,
    "total_kitta" numeric(15,4) DEFAULT 0 NOT NULL,
    "total_bonus_kitta" numeric(15,4) DEFAULT 0 NOT NULL,
    "total_cash_npr" numeric(15,2) DEFAULT 0 NOT NULL,
    "is_locked" boolean DEFAULT false NOT NULL,
    "import_report" "jsonb",
    "imported_by" "text" DEFAULT 'Operator'::"text",
    "imported_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company_id" "uuid"
);


ALTER TABLE "public"."agm_fiscal_year_meta" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agm_historical_shareholders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "boid" "text" NOT NULL,
    "shareholder_name" "text" NOT NULL,
    "father_name" "text",
    "grandfather_name" "text",
    "guardian_name" "text",
    "spouse_name" "text",
    "citizenship_no" "text",
    "pan_no" "text",
    "address" "text",
    "district" "text",
    "contact_no" "text",
    "email" "text",
    "bank_name" "text",
    "bank_account_no" "text",
    "holder_type" "text" NOT NULL,
    "initial_kitta_2075" numeric(15,4) DEFAULT 0 NOT NULL,
    "initial_fraction_2075" numeric(15,4) DEFAULT 0 NOT NULL,
    "current_kitta_2081" numeric(15,4) DEFAULT 0 NOT NULL,
    "current_fraction_2081" numeric(15,4) DEFAULT 0 NOT NULL,
    "total_bonus_shares" numeric(15,4) DEFAULT 0 NOT NULL,
    "total_cash_dividend" numeric(15,2) DEFAULT 0 NOT NULL,
    "total_tax_withheld" numeric(15,2) DEFAULT 0 NOT NULL,
    "reconciliation_status" "text" DEFAULT 'RECONCILED'::"text" NOT NULL,
    "has_discrepancy" boolean DEFAULT false NOT NULL,
    "anomalies" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "original_folio_no" "text",
    "true_initial_kitta_2075" numeric(15,4),
    "imported_base_kitta" numeric(15,4),
    "company_id" "uuid",
    "remarks" "text",
    "converted_shares" numeric(15,4),
    "imported_opening_fraction" numeric(10,4) DEFAULT 0,
    "imported_base_fiscal_year" "text",
    CONSTRAINT "agm_historical_shareholders_holder_type_check" CHECK (("holder_type" = ANY (ARRAY['PROMOTER'::"text", 'PUBLIC'::"text", 'MUTUAL_FUND'::"text", 'CLEARING_POOL'::"text", 'PHYSICAL'::"text"]))),
    CONSTRAINT "agm_historical_shareholders_reconciliation_status_check" CHECK (("reconciliation_status" = ANY (ARRAY['PENDING'::"text", 'RECONCILED'::"text", 'DISCREPANCY'::"text", 'PROMOTED'::"text"])))
);


ALTER TABLE "public"."agm_historical_shareholders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agm_import_staging" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "fiscal_year" "text" NOT NULL,
    "boid" "text" NOT NULL,
    "shareholder_row" "jsonb" NOT NULL,
    "snapshot_row" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."agm_import_staging" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agm_yearly_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shareholder_id" "uuid",
    "boid" "text" NOT NULL,
    "fiscal_year" "text" NOT NULL,
    "event_name" "text" NOT NULL,
    "base_kitta" numeric(15,4) DEFAULT 0 NOT NULL,
    "previous_fraction" numeric(15,4) DEFAULT 0 NOT NULL,
    "gross_bonus_entitlement" numeric(15,4) DEFAULT 0 NOT NULL,
    "issued_whole_bonus" numeric(15,4) DEFAULT 0 NOT NULL,
    "carried_new_fraction" numeric(15,4) DEFAULT 0 NOT NULL,
    "gross_cash_dividend" numeric(15,2) DEFAULT 0 NOT NULL,
    "bonus_tax_withheld" numeric(15,2) DEFAULT 0 NOT NULL,
    "cash_tax_withheld" numeric(15,2) DEFAULT 0 NOT NULL,
    "net_cash_payable" numeric(15,2) DEFAULT 0 NOT NULL,
    "post_event_kitta" numeric(15,4) DEFAULT 0 NOT NULL,
    "excel_discrepancy_flag" boolean DEFAULT false NOT NULL,
    "is_locked" boolean DEFAULT false NOT NULL,
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "right_shares_allotted" numeric(15,4),
    "converted_shares" numeric(15,4),
    "converted_from_folio" "text",
    "company_id" "uuid"
);


ALTER TABLE "public"."agm_yearly_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."api_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "method" "text" NOT NULL,
    "endpoint" "text" NOT NULL,
    "request_body" "jsonb",
    "response_status" integer,
    "response_body" "jsonb",
    "ip_address" "text",
    "duration_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."api_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."approval_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "approval_id" "uuid",
    "action" "text" NOT NULL,
    "previous_status" "text",
    "new_status" "text",
    "remarks" "text",
    "performed_by" "uuid",
    "performed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."approval_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" "text",
    "old_value" "jsonb",
    "new_value" "jsonb",
    "action_time" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_statement_imports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "bank_name" "text" NOT NULL,
    "account_no" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_hash_sha256" "text" NOT NULL,
    "opening_balance" numeric(15,2) DEFAULT 0,
    "closing_balance" numeric(15,2) DEFAULT 0,
    "total_debit" numeric(15,2) DEFAULT 0,
    "total_credit" numeric(15,2) DEFAULT 0,
    "row_count" integer DEFAULT 0,
    "parser_metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "status" "text" DEFAULT 'imported'::"text",
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bank_statement_imports_status_check" CHECK (("status" = ANY (ARRAY['imported'::"text", 'reconciled'::"text", 'archived'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."bank_statement_imports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_statement_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "import_id" "uuid",
    "company_id" "uuid" NOT NULL,
    "transaction_date" "date" NOT NULL,
    "description" "text",
    "reference" "text",
    "debit_amount" numeric(15,2) DEFAULT 0,
    "credit_amount" numeric(15,2) DEFAULT 0,
    "balance" numeric(15,2),
    "raw_data" "jsonb" DEFAULT '{}'::"jsonb",
    "transaction_fingerprint" "text" NOT NULL,
    "reconciliation_status" "text" DEFAULT 'unreconciled'::"text",
    "reconciliation_run_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bank_statement_transactions_reconciliation_status_check" CHECK (("reconciliation_status" = ANY (ARRAY['unreconciled'::"text", 'matched'::"text", 'reconciled'::"text", 'ignored'::"text", 'exception'::"text"])))
);


ALTER TABLE "public"."bank_statement_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_statements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bank_name" "text" NOT NULL,
    "account_no" "text" NOT NULL,
    "statement_date" "date" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_url" "text",
    "total_transactions" integer DEFAULT 0 NOT NULL,
    "total_debit" numeric(15,2) DEFAULT 0 NOT NULL,
    "total_credit" numeric(15,2) DEFAULT 0 NOT NULL,
    "is_reconciled" boolean DEFAULT false NOT NULL,
    "reconciled_at" timestamp with time zone,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company_id" "uuid"
);


ALTER TABLE "public"."bank_statements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_date" "date" NOT NULL,
    "description" "text",
    "reference" "text",
    "amount" numeric(15,2) NOT NULL,
    "bank_account_no" "text",
    "matched_payable_type" "text",
    "matched_payable_id" "uuid",
    "is_reconciled" boolean DEFAULT false NOT NULL,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company_id" "uuid",
    "statement_id" "uuid"
)
WITH ("autovacuum_vacuum_scale_factor"='0.05', "autovacuum_analyze_scale_factor"='0.02');


ALTER TABLE "public"."bank_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."classification_decision_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "company_id" "uuid",
    "previous_classification" "text",
    "new_classification" "text" NOT NULL,
    "previous_segment" "text",
    "new_segment" "text",
    "classification_source" "text" NOT NULL,
    "rule_version" "text" NOT NULL,
    "evidence_hash" "text",
    "evidence" "jsonb" DEFAULT '{}'::"jsonb",
    "confirmed_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."classification_decision_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_code" "text" NOT NULL,
    "full_name" "text" NOT NULL,
    "boid" "text",
    "holder_type" "public"."holder_type",
    "pan_or_citizenship" "text",
    "bank_account_no" "text",
    "bank_name" "text",
    "status" "public"."record_status" DEFAULT 'Active'::"public"."record_status" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_id" "text",
    "father_name" "text",
    "grandfather_name" "text",
    "address" "text",
    "province" "text",
    "district" "text",
    "municipality" "text",
    "phone" "text",
    "email" "text",
    "bank_branch" "text",
    "account_type" "text",
    "residency" "public"."residency_type",
    "verification_status" "public"."verification_status" DEFAULT 'Pending'::"public"."verification_status" NOT NULL,
    "company_id" "uuid",
    "payee_classification" "text" DEFAULT 'UNCLASSIFIED'::"text" NOT NULL,
    "payee_segment" "text",
    "classification_status" "text" DEFAULT 'REVIEW_REQUIRED'::"text" NOT NULL,
    "classification_source" "text",
    "date_of_birth" "text",
    "gender" "text",
    "occupation" "text",
    "bank_code" "text",
    "nid_number" "text",
    "pan_no" "text",
    "citizenship_no" "text",
    "kitta" numeric DEFAULT 0,
    "needs_review" boolean DEFAULT false NOT NULL,
    "data_quality_notes" "text",
    "classification_rule_version" "text" DEFAULT '2083.1'::"text",
    "classified_at" timestamp with time zone,
    "classification_evidence" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "chk_clients_kitta_nonneg" CHECK (("kitta" >= (0)::numeric)),
    CONSTRAINT "clients_classification_status_check" CHECK (("classification_status" = ANY (ARRAY['AUTO_CLASSIFIED'::"text", 'CONFIRMED'::"text", 'REVIEW_REQUIRED'::"text"]))),
    CONSTRAINT "clients_payee_classification_check" CHECK (("payee_classification" = ANY (ARRAY['NATURAL_PERSON'::"text", 'PUBLIC_LEGAL_PERSON'::"text", 'COMPANY_INSTITUTION'::"text", 'FOREIGN_INVESTOR'::"text", 'BANK_FI'::"text", 'TAX_EXEMPT'::"text", 'UNCLASSIFIED'::"text"]))),
    CONSTRAINT "clients_payee_segment_check" CHECK ((("payee_segment" IS NULL) OR ("payee_segment" = ANY (ARRAY['PROMOTER'::"text", 'LOCAL'::"text", 'EMPLOYEE'::"text", 'PUBLIC'::"text"]))))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_code" "text" NOT NULL,
    "company_name" "text" NOT NULL,
    "sector_type" "public"."sector_type",
    "interest_tax_status" "public"."tax_status",
    "pan_no" "text",
    "bank_account_no" "text",
    "bank_name" "text",
    "status" "public"."record_status" DEFAULT 'Active'::"public"."record_status" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "company_type" "text",
    "isin" "text",
    "listed_date" "date",
    "registrar" "text" DEFAULT 'RBB Merchant Banking Limited'::"text",
    "fiscal_year" "text",
    "dividend_rate" numeric,
    "debenture_rate" numeric,
    "coupon_rate" numeric,
    "maturity_date" "date",
    "face_value" numeric DEFAULT 100,
    "issue_size" numeric,
    "email" "text",
    "phone" "text",
    "website" "text",
    "address" "text",
    CONSTRAINT "chk_companies_coupon_rate_range" CHECK ((("coupon_rate" IS NULL) OR (("coupon_rate" >= (0)::numeric) AND ("coupon_rate" <= (100)::numeric)))),
    CONSTRAINT "chk_companies_dividend_rate_range" CHECK ((("dividend_rate" IS NULL) OR (("dividend_rate" >= (0)::numeric) AND ("dividend_rate" <= (1000)::numeric))))
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dividend_payables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "shares_held" numeric(15,2) DEFAULT 0,
    "dividend_rate" numeric(10,4) DEFAULT 0,
    "gross_dividend" numeric(15,2) DEFAULT 0 NOT NULL,
    "tax_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "net_payable" numeric(15,2) DEFAULT 0 NOT NULL,
    "payment_status" "public"."payment_status" DEFAULT 'Pending'::"public"."payment_status" NOT NULL,
    "payment_date" "date",
    "payment_reference" "text",
    "fiscal_year" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "upload_id" "uuid",
    "dividend_type" "public"."dividend_type",
    "bonus_ratio" "text",
    "right_ratio" "text",
    "fraction_shares" numeric(15,4) DEFAULT 0,
    "rounded_quantity" numeric(15,2) DEFAULT 0,
    "final_quantity" numeric(15,2) DEFAULT 0,
    "lock_in_period" "text",
    "promoter_quantity" numeric(15,2) DEFAULT 0,
    "public_quantity" numeric(15,2) DEFAULT 0,
    "employee_quantity" numeric(15,2) DEFAULT 0,
    "returned_status" "text",
    "cancelled_status" "text",
    "paid_amount" numeric(15,2) DEFAULT 0,
    "remaining_amount" numeric(15,2) DEFAULT 0,
    "adjustment_amount" numeric(15,2) DEFAULT 0,
    "previous_balance" numeric(15,2) DEFAULT 0,
    "final_payable" numeric(15,2) DEFAULT 0,
    "rts_submitted" boolean DEFAULT false,
    "rts_attempts" integer DEFAULT 0,
    "rts_error" "text",
    "bonus_actual" numeric(15,2) DEFAULT 0,
    "bonus_issued" numeric(15,2) DEFAULT 0,
    "bonus_fraction" numeric(15,4) DEFAULT 0,
    "after_bonus_kitta" numeric(15,2) DEFAULT 0,
    "bonus_tax" numeric(15,2) DEFAULT 0,
    "lot_name" "text",
    "tds_rate" numeric(10,4),
    "bank_name" "text",
    "bank_account_no" "text",
    "payee_classification" "text" DEFAULT 'UNCLASSIFIED'::"text" NOT NULL,
    "payee_segment" "text",
    "classification_status" "text" DEFAULT 'REVIEW_REQUIRED'::"text" NOT NULL,
    "bank_branch" "text",
    "remarks" "text",
    "bonus_rate" numeric,
    "is_tax_manual" boolean DEFAULT false,
    "tax_rate" numeric(5,4),
    "declaration_id" "uuid",
    CONSTRAINT "chk_div_balance_invariant" CHECK (("abs"((("gross_dividend" - "tax_amount") - "net_payable")) <= 0.05)),
    CONSTRAINT "chk_div_gross_nonneg" CHECK (("gross_dividend" >= (0)::numeric)),
    CONSTRAINT "chk_div_net_le_gross" CHECK (("net_payable" <= ("gross_dividend" + 0.05))),
    CONSTRAINT "chk_div_net_nonneg" CHECK (("net_payable" >= (0)::numeric)),
    CONSTRAINT "chk_div_shares_nonneg" CHECK ((("shares_held" IS NULL) OR ("shares_held" >= (0)::numeric))),
    CONSTRAINT "chk_div_tax_le_gross" CHECK (("tax_amount" <= ("gross_dividend" + 0.05))),
    CONSTRAINT "chk_div_tax_nonneg" CHECK (("tax_amount" >= (0)::numeric)),
    CONSTRAINT "chk_div_tds_rate_range" CHECK ((("tds_rate" IS NULL) OR (("tds_rate" >= (0)::numeric) AND ("tds_rate" <= (1)::numeric)))),
    CONSTRAINT "dividend_payables_classification_status_check" CHECK (("classification_status" = ANY (ARRAY['AUTO_CLASSIFIED'::"text", 'CONFIRMED'::"text", 'REVIEW_REQUIRED'::"text"]))),
    CONSTRAINT "dividend_payables_payee_classification_check" CHECK (("payee_classification" = ANY (ARRAY['NATURAL_PERSON'::"text", 'PUBLIC_LEGAL_PERSON'::"text", 'COMPANY_INSTITUTION'::"text", 'FOREIGN_INVESTOR'::"text", 'BANK_FI'::"text", 'TAX_EXEMPT'::"text", 'UNCLASSIFIED'::"text"]))),
    CONSTRAINT "dividend_payables_payee_segment_check" CHECK ((("payee_segment" IS NULL) OR ("payee_segment" = ANY (ARRAY['PROMOTER'::"text", 'LOCAL'::"text", 'EMPLOYEE'::"text", 'PUBLIC'::"text"]))))
)
WITH ("autovacuum_vacuum_scale_factor"='0.05', "autovacuum_analyze_scale_factor"='0.02');


ALTER TABLE "public"."dividend_payables" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."interest_payables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "instrument_ref" "text",
    "gross_interest" numeric(15,2) DEFAULT 0 NOT NULL,
    "tax_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "net_payable" numeric(15,2) DEFAULT 0 NOT NULL,
    "due_date" "date" NOT NULL,
    "payment_status" "public"."payment_status" DEFAULT 'Pending'::"public"."payment_status" NOT NULL,
    "payment_date" "date",
    "payment_reference" "text",
    "fiscal_year" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "upload_id" "uuid",
    "interest_rate_type" "public"."interest_rate_type",
    "interest_rate_value" numeric(10,4),
    "from_date" "date",
    "to_date" "date",
    "days_count" integer,
    "tds" numeric(15,2),
    "net_interest" numeric(15,2),
    "paid_amount" numeric(15,2) DEFAULT 0,
    "remaining_amount" numeric(15,2) DEFAULT 0,
    "adjustment_amount" numeric(15,2) DEFAULT 0,
    "previous_balance" numeric(15,2) DEFAULT 0,
    "final_payable" numeric(15,2) DEFAULT 0,
    "tds_rate" numeric(10,4),
    "payee_classification" "text" DEFAULT 'UNCLASSIFIED'::"text" NOT NULL,
    "payee_segment" "text",
    "classification_status" "text" DEFAULT 'REVIEW_REQUIRED'::"text" NOT NULL,
    "bank_name" "text",
    "bank_account_no" "text",
    "bank_branch" "text",
    "lot_name" "text",
    "remarks" "text",
    "shares_held" numeric DEFAULT 0,
    "kitta" numeric DEFAULT 0,
    "is_tax_manual" boolean DEFAULT false,
    "tax_rate" numeric(5,4),
    "declaration_id" "uuid",
    CONSTRAINT "chk_int_balance_invariant" CHECK (("abs"((("gross_interest" - "tax_amount") - "net_payable")) <= 0.05)),
    CONSTRAINT "chk_int_gross_nonneg" CHECK (("gross_interest" >= (0)::numeric)),
    CONSTRAINT "chk_int_kitta_nonneg" CHECK (((("kitta" IS NULL) OR ("kitta" >= (0)::numeric)) AND (("shares_held" IS NULL) OR ("shares_held" >= (0)::numeric)))),
    CONSTRAINT "chk_int_net_le_gross" CHECK (("net_payable" <= ("gross_interest" + 0.05))),
    CONSTRAINT "chk_int_net_nonneg" CHECK (("net_payable" >= (0)::numeric)),
    CONSTRAINT "chk_int_tax_le_gross" CHECK (("tax_amount" <= ("gross_interest" + 0.05))),
    CONSTRAINT "chk_int_tax_nonneg" CHECK (("tax_amount" >= (0)::numeric)),
    CONSTRAINT "chk_int_tds_rate_range" CHECK ((("tds_rate" IS NULL) OR (("tds_rate" >= (0)::numeric) AND ("tds_rate" <= (1)::numeric)))),
    CONSTRAINT "interest_payables_classification_status_check" CHECK (("classification_status" = ANY (ARRAY['AUTO_CLASSIFIED'::"text", 'CONFIRMED'::"text", 'REVIEW_REQUIRED'::"text"]))),
    CONSTRAINT "interest_payables_payee_classification_check" CHECK (("payee_classification" = ANY (ARRAY['NATURAL_PERSON'::"text", 'PUBLIC_LEGAL_PERSON'::"text", 'COMPANY_INSTITUTION'::"text", 'FOREIGN_INVESTOR'::"text", 'BANK_FI'::"text", 'TAX_EXEMPT'::"text", 'UNCLASSIFIED'::"text"]))),
    CONSTRAINT "interest_payables_payee_segment_check" CHECK ((("payee_segment" IS NULL) OR ("payee_segment" = ANY (ARRAY['PROMOTER'::"text", 'LOCAL'::"text", 'EMPLOYEE'::"text", 'PUBLIC'::"text"]))))
)
WITH ("autovacuum_vacuum_scale_factor"='0.05', "autovacuum_analyze_scale_factor"='0.02');


ALTER TABLE "public"."interest_payables" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mutual_fund_payables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "upload_id" "uuid",
    "company_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "shares_held" numeric(15,2) DEFAULT 0,
    "dividend_rate" numeric(10,4) DEFAULT 0,
    "dividend_type" "public"."dividend_type" DEFAULT 'Cash'::"public"."dividend_type" NOT NULL,
    "gross_dividend" numeric(15,2) DEFAULT 0 NOT NULL,
    "tax_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "net_payable" numeric(15,2) DEFAULT 0 NOT NULL,
    "payment_status" "public"."payment_status" DEFAULT 'Pending'::"public"."payment_status" NOT NULL,
    "payment_date" "date",
    "payment_reference" "text",
    "bonus_actual" numeric(15,2),
    "bonus_issued" numeric(15,2),
    "bonus_fraction" numeric(15,2),
    "after_bonus_kitta" numeric(15,2),
    "bonus_tax" numeric(15,2),
    "bank_name" "text",
    "bank_account_no" "text",
    "lot_name" "text",
    "fiscal_year" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tds_rate" numeric(10,4),
    "payee_classification" "text" DEFAULT 'UNCLASSIFIED'::"text" NOT NULL,
    "payee_segment" "text",
    "classification_status" "text" DEFAULT 'REVIEW_REQUIRED'::"text" NOT NULL,
    "remarks" "text",
    "bank_branch" "text",
    "paid_amount" numeric(15,2) DEFAULT 0,
    "remaining_amount" numeric(15,2),
    "is_tax_manual" boolean DEFAULT false,
    "tax_rate" numeric(5,4),
    CONSTRAINT "chk_mf_balance_invariant" CHECK (("abs"((("gross_dividend" - "tax_amount") - "net_payable")) <= 0.05)),
    CONSTRAINT "chk_mf_gross_nonneg" CHECK (("gross_dividend" >= (0)::numeric)),
    CONSTRAINT "chk_mf_net_le_gross" CHECK (("net_payable" <= ("gross_dividend" + 0.05))),
    CONSTRAINT "chk_mf_net_nonneg" CHECK (("net_payable" >= (0)::numeric)),
    CONSTRAINT "chk_mf_shares_nonneg" CHECK ((("shares_held" IS NULL) OR ("shares_held" >= (0)::numeric))),
    CONSTRAINT "chk_mf_tax_le_gross" CHECK (("tax_amount" <= ("gross_dividend" + 0.05))),
    CONSTRAINT "chk_mf_tax_nonneg" CHECK (("tax_amount" >= (0)::numeric)),
    CONSTRAINT "chk_mf_tds_rate_range" CHECK ((("tds_rate" IS NULL) OR (("tds_rate" >= (0)::numeric) AND ("tds_rate" <= (1)::numeric)))),
    CONSTRAINT "mutual_fund_payables_classification_status_check" CHECK (("classification_status" = ANY (ARRAY['AUTO_CLASSIFIED'::"text", 'CONFIRMED'::"text", 'REVIEW_REQUIRED'::"text"]))),
    CONSTRAINT "mutual_fund_payables_payee_classification_check" CHECK (("payee_classification" = ANY (ARRAY['NATURAL_PERSON'::"text", 'PUBLIC_LEGAL_PERSON'::"text", 'COMPANY_INSTITUTION'::"text", 'FOREIGN_INVESTOR'::"text", 'BANK_FI'::"text", 'TAX_EXEMPT'::"text", 'UNCLASSIFIED'::"text"]))),
    CONSTRAINT "mutual_fund_payables_payee_segment_check" CHECK ((("payee_segment" IS NULL) OR ("payee_segment" = ANY (ARRAY['PROMOTER'::"text", 'LOCAL'::"text", 'EMPLOYEE'::"text", 'PUBLIC'::"text"]))))
)
WITH ("autovacuum_vacuum_scale_factor"='0.05', "autovacuum_analyze_scale_factor"='0.02');


ALTER TABLE "public"."mutual_fund_payables" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."company_client_map" AS
 SELECT DISTINCT "clients"."company_id",
    "clients"."id" AS "client_id"
   FROM "public"."clients"
  WHERE ("clients"."company_id" IS NOT NULL)
UNION
 SELECT DISTINCT "mutual_fund_payables"."company_id",
    "mutual_fund_payables"."client_id"
   FROM "public"."mutual_fund_payables"
  WHERE (("mutual_fund_payables"."company_id" IS NOT NULL) AND ("mutual_fund_payables"."client_id" IS NOT NULL))
UNION
 SELECT DISTINCT "dividend_payables"."company_id",
    "dividend_payables"."client_id"
   FROM "public"."dividend_payables"
  WHERE (("dividend_payables"."company_id" IS NOT NULL) AND ("dividend_payables"."client_id" IS NOT NULL))
UNION
 SELECT DISTINCT "interest_payables"."company_id",
    "interest_payables"."client_id"
   FROM "public"."interest_payables"
  WHERE (("interest_payables"."company_id" IS NOT NULL) AND ("interest_payables"."client_id" IS NOT NULL))
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."company_client_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."corporate_declarations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "declaration_code" "text" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "declaration_type" "text" NOT NULL,
    "sub_type" "text" DEFAULT 'Cash'::"text",
    "fiscal_year" "text" NOT NULL,
    "declaration_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "record_date" "date",
    "payment_due_date" "date",
    "rate_per_share" numeric(10,4) DEFAULT 0,
    "face_value" numeric(10,2) DEFAULT 100,
    "total_declared_amount" numeric(15,2) DEFAULT 0,
    "total_eligible_shares" numeric(15,2) DEFAULT 0,
    "status" "text" DEFAULT 'Active'::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."corporate_declarations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."error_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "error_type" "text" NOT NULL,
    "error_code" "text",
    "error_message" "text" NOT NULL,
    "stack_trace" "text",
    "context" "jsonb",
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."error_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fiscal_years" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fiscal_year" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fiscal_years" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."iaf_allocations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid",
    "fiscal_year" "text" NOT NULL,
    "allocated_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "utilized_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."iaf_allocations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_staging" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "approval_id" "uuid",
    "company_id" "uuid" NOT NULL,
    "target_table" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_hash" "text" NOT NULL,
    "sheet_name" "text",
    "total_rows" integer DEFAULT 0 NOT NULL,
    "source_gross" numeric DEFAULT 0 NOT NULL,
    "source_tax" numeric DEFAULT 0 NOT NULL,
    "source_net" numeric DEFAULT 0 NOT NULL,
    "computed_gross" numeric DEFAULT 0 NOT NULL,
    "computed_tax" numeric DEFAULT 0 NOT NULL,
    "computed_net" numeric DEFAULT 0 NOT NULL,
    "staged_rows" "jsonb" NOT NULL,
    "options" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "upload_id" "uuid",
    "status" "text" DEFAULT 'STAGED'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "committed_at" timestamp with time zone,
    CONSTRAINT "import_staging_status_check" CHECK (("status" = ANY (ARRAY['STAGED'::"text", 'COMMITTED'::"text", 'REJECTED'::"text"])))
);


ALTER TABLE "public"."import_staging" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."login_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "email" "text",
    "ip_address" "text",
    "user_agent" "text",
    "browser" "text",
    "device" "text",
    "login_status" "text" NOT NULL,
    "failure_reason" "text",
    "login_time" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."login_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category" "text" NOT NULL,
    "email_enabled" boolean DEFAULT false NOT NULL,
    "sms_enabled" boolean DEFAULT false NOT NULL,
    "system_enabled" boolean DEFAULT true NOT NULL,
    "email_template" "text",
    "sms_template" "text",
    "email_recipients" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notification_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "channel" "public"."notification_channel" DEFAULT 'System'::"public"."notification_channel" NOT NULL,
    "category" "text",
    "reference_type" "text",
    "reference_id" "uuid",
    "is_read" boolean DEFAULT false NOT NULL,
    "read_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."payable_classification_summary" WITH ("security_invoker"='true') AS
 SELECT "dividend_payables"."company_id",
    'DIVIDEND'::"text" AS "payable_category",
    "dividend_payables"."payee_classification",
    "dividend_payables"."payee_segment",
    "dividend_payables"."classification_status",
    "count"(*) AS "transaction_count",
    "sum"("dividend_payables"."gross_dividend") AS "gross_payable",
    "sum"("dividend_payables"."tax_amount") AS "tax",
    "sum"("dividend_payables"."net_payable") AS "net_payable"
   FROM "public"."dividend_payables"
  GROUP BY "dividend_payables"."company_id", "dividend_payables"."payee_classification", "dividend_payables"."payee_segment", "dividend_payables"."classification_status"
UNION ALL
 SELECT "interest_payables"."company_id",
    'INTEREST'::"text" AS "payable_category",
    "interest_payables"."payee_classification",
    "interest_payables"."payee_segment",
    "interest_payables"."classification_status",
    "count"(*) AS "transaction_count",
    "sum"("interest_payables"."gross_interest") AS "gross_payable",
    "sum"("interest_payables"."tax_amount") AS "tax",
    "sum"("interest_payables"."net_payable") AS "net_payable"
   FROM "public"."interest_payables"
  GROUP BY "interest_payables"."company_id", "interest_payables"."payee_classification", "interest_payables"."payee_segment", "interest_payables"."classification_status"
UNION ALL
 SELECT "mutual_fund_payables"."company_id",
    'MUTUAL_FUND'::"text" AS "payable_category",
    "mutual_fund_payables"."payee_classification",
    "mutual_fund_payables"."payee_segment",
    "mutual_fund_payables"."classification_status",
    "count"(*) AS "transaction_count",
    "sum"("mutual_fund_payables"."gross_dividend") AS "gross_payable",
    "sum"("mutual_fund_payables"."tax_amount") AS "tax",
    "sum"("mutual_fund_payables"."net_payable") AS "net_payable"
   FROM "public"."mutual_fund_payables"
  GROUP BY "mutual_fund_payables"."company_id", "mutual_fund_payables"."payee_classification", "mutual_fund_payables"."payee_segment", "mutual_fund_payables"."classification_status";


ALTER VIEW "public"."payable_classification_summary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payable_tax_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payable_category" "text" NOT NULL,
    "payee_classification" "text" NOT NULL,
    "tax_rate" numeric(7,6) NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "statutory_citation" "text",
    "comparison_rate" numeric(7,6),
    "effective_from" "date" DEFAULT '2024-07-16'::"date",
    CONSTRAINT "payable_tax_rules_payable_category_check" CHECK (("payable_category" = ANY (ARRAY['DIVIDEND'::"text", 'INTEREST'::"text", 'MUTUAL_FUND'::"text"]))),
    CONSTRAINT "payable_tax_rules_payee_classification_check" CHECK (("payee_classification" = ANY (ARRAY['NATURAL_PERSON'::"text", 'PUBLIC_LEGAL_PERSON'::"text", 'COMPANY_INSTITUTION'::"text", 'FOREIGN_INVESTOR'::"text", 'BANK_FI'::"text", 'TAX_EXEMPT'::"text"]))),
    CONSTRAINT "payable_tax_rules_tax_rate_check" CHECK ((("tax_rate" >= (0)::numeric) AND ("tax_rate" <= (1)::numeric)))
);


ALTER TABLE "public"."payable_tax_rules" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."payable_tds_rate_drift" WITH ("security_invoker"='true') AS
 SELECT 'DIVIDEND'::"text" AS "payable_category",
    "p"."id",
    "p"."company_id",
    "p"."payee_classification",
    "p"."tds_rate" AS "stored_rate",
    "r"."tax_rate" AS "rule_rate",
    "p"."payment_status"
   FROM ("public"."dividend_payables" "p"
     JOIN "public"."payable_tax_rules" "r" ON ((("r"."payable_category" = 'DIVIDEND'::"text") AND ("r"."payee_classification" = "p"."payee_classification") AND "r"."is_active")))
  WHERE ("p"."tds_rate" IS DISTINCT FROM "r"."tax_rate")
UNION ALL
 SELECT 'INTEREST'::"text" AS "payable_category",
    "p"."id",
    "p"."company_id",
    "p"."payee_classification",
    "p"."tds_rate" AS "stored_rate",
    "r"."tax_rate" AS "rule_rate",
    "p"."payment_status"
   FROM ("public"."interest_payables" "p"
     JOIN "public"."payable_tax_rules" "r" ON ((("r"."payable_category" = 'INTEREST'::"text") AND ("r"."payee_classification" = "p"."payee_classification") AND "r"."is_active")))
  WHERE ("p"."tds_rate" IS DISTINCT FROM "r"."tax_rate")
UNION ALL
 SELECT 'MUTUAL_FUND'::"text" AS "payable_category",
    "p"."id",
    "p"."company_id",
    "p"."payee_classification",
    "p"."tds_rate" AS "stored_rate",
    "r"."tax_rate" AS "rule_rate",
    "p"."payment_status"
   FROM ("public"."mutual_fund_payables" "p"
     JOIN "public"."payable_tax_rules" "r" ON ((("r"."payable_category" = 'MUTUAL_FUND'::"text") AND ("r"."payee_classification" = "p"."payee_classification") AND "r"."is_active")))
  WHERE ("p"."tds_rate" IS DISTINCT FROM "r"."tax_rate");


ALTER VIEW "public"."payable_tds_rate_drift" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_name" "text" NOT NULL,
    "company_id" "uuid",
    "fiscal_year" "text",
    "payable_type" "text",
    "total_payments" integer DEFAULT 0 NOT NULL,
    "total_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "status" "public"."payment_batch_status" DEFAULT 'Draft'::"public"."payment_batch_status" NOT NULL,
    "neft_file_url" "text",
    "connectips_file_url" "text",
    "rtgs_file_url" "text",
    "created_by" "uuid",
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "total_tax" numeric(15,2) DEFAULT 0 NOT NULL,
    "payment_method" "text",
    "cds_batch_ref" "text",
    "registrar" "text",
    "declaration_id" "uuid"
);


ALTER TABLE "public"."payment_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_id" "uuid",
    "action" "text" NOT NULL,
    "previous_status" "text",
    "new_status" "text",
    "amount" numeric(15,2),
    "notes" "text",
    "performed_by" "uuid",
    "performed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."payment_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_id" "uuid",
    "company_id" "uuid",
    "client_id" "uuid",
    "payable_type" "text" NOT NULL,
    "payable_id" "uuid" NOT NULL,
    "gross_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "tax_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "net_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "paid_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "payment_method" "public"."payment_method",
    "payment_date" "date",
    "payment_reference" "text",
    "bank_name" "text",
    "bank_account_no" "text",
    "neft_ref" "text",
    "connectips_ref" "text",
    "rtgs_ref" "text",
    "cheque_no" "text",
    "remarks" "text",
    "status" "text" DEFAULT 'Pending'::"text" NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "processed_by" "uuid",
    "processed_at" timestamp with time zone,
    "reversed_by" "uuid",
    "reversed_at" timestamp with time zone,
    "reversal_reason" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reconciliation_run_id" "uuid",
    CONSTRAINT "chk_pay_amounts_nonneg" CHECK ((("gross_amount" >= (0)::numeric) AND ("tax_amount" >= (0)::numeric) AND ("net_amount" >= (0)::numeric) AND ("paid_amount" >= (0)::numeric))),
    CONSTRAINT "chk_pay_balance_invariant" CHECK (("abs"((("gross_amount" - "tax_amount") - "net_amount")) <= 0.05)),
    CONSTRAINT "chk_pay_net_le_gross" CHECK (("net_amount" <= ("gross_amount" + 0.05))),
    CONSTRAINT "chk_pay_tax_le_gross" CHECK (("tax_amount" <= ("gross_amount" + 0.05)))
)
WITH ("autovacuum_vacuum_scale_factor"='0.05', "autovacuum_analyze_scale_factor"='0.02');


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pending_approvals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid",
    "action" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "status" "public"."approval_status" DEFAULT 'Pending'::"public"."approval_status" NOT NULL,
    "requested_by" "uuid",
    "reviewed_by" "uuid",
    "review_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone
);


ALTER TABLE "public"."pending_approvals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reconciliation_exceptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid",
    "company_id" "uuid",
    "result_id" "uuid",
    "payable_id" "uuid",
    "payable_type" "text",
    "source_reference" "text",
    "amount" numeric(15,2),
    "exception_reason" "text" NOT NULL,
    "status" "text" DEFAULT 'Open'::"text",
    "assigned_to" "uuid",
    "deadline" "date",
    "notes" "text",
    "resolution_notes" "text",
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reconciliation_exceptions_status_check" CHECK (("status" = ANY (ARRAY['Open'::"text", 'Investigating'::"text", 'Accepted'::"text", 'Rejected'::"text", 'Resolved'::"text", 'Escalated'::"text"])))
);


ALTER TABLE "public"."reconciliation_exceptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reconciliation_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reconciliation_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "source_a_type" "text" NOT NULL,
    "source_a_id" "uuid",
    "source_b_type" "text" NOT NULL,
    "source_b_id" "uuid",
    "client_id" "uuid",
    "company_id" "uuid",
    "payable_type" "text",
    "payable_id" "uuid",
    "expected_amount" numeric(15,2),
    "actual_amount" numeric(15,2),
    "difference" numeric(15,2) DEFAULT 0,
    "result" "public"."reconciliation_result" DEFAULT 'Pending'::"public"."reconciliation_result" NOT NULL,
    "notes" "text",
    "matched_by" "uuid",
    "matched_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fiscal_year" "text",
    "payment_id" "uuid",
    "batch_id" "uuid",
    "run_id" "uuid",
    "source_reference" "text",
    "match_method" "text",
    "match_confidence" numeric(5,2),
    "candidate_count" integer DEFAULT 1,
    "rejected_candidates" "jsonb" DEFAULT '[]'::"jsonb",
    "rule_version" "text" DEFAULT '2.0.0'::"text",
    "requires_manual_approval" boolean DEFAULT false,
    "prior_paid_amount" numeric(15,2),
    "prior_payment_status" "text",
    "prior_payment_date" "date",
    "prior_payment_reference" "text",
    "prior_snapshot" "jsonb",
    "post_state_hash" "text"
)
WITH ("autovacuum_vacuum_scale_factor"='0.05', "autovacuum_analyze_scale_factor"='0.02');


ALTER TABLE "public"."reconciliation_results" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."reconciliation_lots" AS
 SELECT "id",
    "reconciliation_date",
    "client_id",
    "company_id",
    "payable_type",
    "payable_id",
    "expected_amount",
    "actual_amount",
    "difference",
    "result",
    ("result")::"text" AS "status",
    "notes",
    "matched_by",
    "matched_at",
    "created_at",
    "fiscal_year",
    "payment_id",
    "batch_id"
   FROM "public"."reconciliation_results";


ALTER VIEW "public"."reconciliation_lots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reconciliation_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid",
    "fiscal_year" "text",
    "idempotency_key" "text",
    "source_type" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_hash_sha256" "text" NOT NULL,
    "row_count" integer DEFAULT 0 NOT NULL,
    "total_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "matched_count" integer DEFAULT 0 NOT NULL,
    "unmatched_count" integer DEFAULT 0 NOT NULL,
    "partial_count" integer DEFAULT 0 NOT NULL,
    "rejected_count" integer DEFAULT 0 NOT NULL,
    "parser_version" "text" DEFAULT '2.0.0'::"text",
    "matching_rule_version" "text" DEFAULT '2.0.0'::"text",
    "status" "text" DEFAULT 'draft'::"text",
    "processed_chunks" "jsonb" DEFAULT '{}'::"jsonb",
    "expected_chunk_count" integer DEFAULT 1 NOT NULL,
    "batch_id" "uuid",
    "notes" "text",
    "applied_by" "uuid",
    "applied_at" timestamp with time zone,
    "reverted_by" "uuid",
    "reverted_at" timestamp with time zone,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reconciliation_runs_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'review'::"text", 'approved'::"text", 'processing'::"text", 'applied'::"text", 'reverted'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."reconciliation_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reconciliation_variance_approvals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "run_id" "uuid" NOT NULL,
    "result_id" "uuid",
    "payable_id" "uuid" NOT NULL,
    "payable_type" "text" NOT NULL,
    "source_reference" "text",
    "variance_type" "text" NOT NULL,
    "expected_amount" numeric(15,2) NOT NULL,
    "actual_amount" numeric(15,2) NOT NULL,
    "variance_amount" numeric(15,2) NOT NULL,
    "maker_id" "uuid" NOT NULL,
    "approved_by" "uuid" NOT NULL,
    "approval_reason" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ck_recon_approval_maker_checker" CHECK (("maker_id" <> "approved_by")),
    CONSTRAINT "ck_recon_approval_reason_not_empty" CHECK (("length"(TRIM(BOTH FROM "approval_reason")) >= 5)),
    CONSTRAINT "reconciliation_variance_approvals_variance_type_check" CHECK (("variance_type" = ANY (ARRAY['UNDER_PAID'::"text", 'OVER_PAID'::"text", 'PARTIAL'::"text", 'DISCREPANCY'::"text"])))
);


ALTER TABLE "public"."reconciliation_variance_approvals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."report_presets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "report_id" "text" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "fiscal_year" "text" NOT NULL,
    "format" "text" DEFAULT 'xlsx'::"text" NOT NULL,
    "is_shared" boolean DEFAULT true NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."report_presets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."report_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "report_type" "text" NOT NULL,
    "report_name" "text" NOT NULL,
    "filters" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "export_format" "text" DEFAULT 'excel'::"text" NOT NULL,
    "file_url" "text",
    "file_size" bigint,
    "record_count" integer DEFAULT 0 NOT NULL,
    "generated_by" "uuid" DEFAULT "auth"."uid"(),
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "parameters" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."report_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scheduled_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "report_type" "text" NOT NULL,
    "report_name" "text" NOT NULL,
    "filters" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "schedule_type" "text" NOT NULL,
    "schedule_time" "text" DEFAULT '18:00'::"text" NOT NULL,
    "schedule_day" integer,
    "schedule_month" integer,
    "recipients" "text"[] NOT NULL,
    "export_format" "text" DEFAULT 'excel'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "last_run_at" timestamp with time zone,
    "next_run_at" timestamp with time zone,
    "delivery_status" "text" DEFAULT 'PENDING'::"text",
    "last_error" "text",
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "scheduled_reports_schedule_type_check" CHECK (("schedule_type" = ANY (ARRAY['daily'::"text", 'weekly'::"text", 'monthly'::"text", 'quarterly'::"text"])))
);


ALTER TABLE "public"."scheduled_reports" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."seq_agm_broker_claim_no"
    START WITH 9020001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."seq_agm_broker_claim_no" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "setting_key" "text" NOT NULL,
    "setting_value" "jsonb" NOT NULL,
    "description" "text",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."system_settings" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."system_settings_safe" WITH ("security_invoker"='true') AS
 SELECT "id",
    "setting_key",
        CASE
            WHEN "public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") THEN "public"."mask_smtp_secrets"("setting_value")
            ELSE "public"."mask_smtp_secrets"("setting_value")
        END AS "setting_value",
    "description",
    "updated_by",
    "created_at",
    "updated_at"
   FROM "public"."system_settings";


ALTER VIEW "public"."system_settings_safe" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."upload_errors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "upload_id" "uuid" NOT NULL,
    "row_number" integer NOT NULL,
    "field_name" "text",
    "error_type" "text" NOT NULL,
    "error_message" "text" NOT NULL,
    "raw_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."upload_errors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."upload_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "file_name" "text" NOT NULL,
    "file_size" bigint DEFAULT 0 NOT NULL,
    "file_hash" "text",
    "file_type" "text",
    "sheet_name" "text",
    "total_rows" integer DEFAULT 0 NOT NULL,
    "processed_rows" integer DEFAULT 0 NOT NULL,
    "success_rows" integer DEFAULT 0 NOT NULL,
    "error_rows" integer DEFAULT 0 NOT NULL,
    "target_table" "text",
    "status" "text" DEFAULT 'Processing'::"text" NOT NULL,
    "error_message" "text",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
)
WITH ("autovacuum_vacuum_scale_factor"='0.05', "autovacuum_analyze_scale_factor"='0.02');


ALTER TABLE "public"."upload_history" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."upload_logs" AS
 SELECT "id",
    "user_id",
    "file_name",
    "file_size",
    "file_hash",
    "file_type",
    "file_type" AS "upload_type",
    "sheet_name",
    "total_rows",
    "success_rows",
    "error_rows",
    "target_table",
    "status",
    "error_message",
    "started_at",
    "completed_at",
    "created_at"
   FROM "public"."upload_history";


ALTER VIEW "public"."upload_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_company_access" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "role_override" "public"."app_role",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_company_access" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."app_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


ALTER TABLE ONLY "public"."agm_broker_claims"
    ADD CONSTRAINT "agm_broker_claims_company_seq_key" UNIQUE ("company_id", "seq_no");



ALTER TABLE ONLY "public"."agm_broker_claims"
    ADD CONSTRAINT "agm_broker_claims_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agm_broker_pools"
    ADD CONSTRAINT "agm_broker_pools_company_pool_fy_key" UNIQUE ("company_id", "pool_boid", "fiscal_year");



ALTER TABLE ONLY "public"."agm_broker_pools"
    ADD CONSTRAINT "agm_broker_pools_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agm_drn_records"
    ADD CONSTRAINT "agm_drn_records_company_folio_key" UNIQUE ("company_id", "folio_no");



ALTER TABLE ONLY "public"."agm_drn_records"
    ADD CONSTRAINT "agm_drn_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agm_fiscal_year_meta"
    ADD CONSTRAINT "agm_fiscal_year_meta_company_fy_key" UNIQUE ("company_id", "fiscal_year");



ALTER TABLE ONLY "public"."agm_historical_shareholders"
    ADD CONSTRAINT "agm_historical_shareholders_company_boid_key" UNIQUE ("company_id", "boid");



ALTER TABLE ONLY "public"."agm_historical_shareholders"
    ADD CONSTRAINT "agm_historical_shareholders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agm_import_staging"
    ADD CONSTRAINT "agm_import_staging_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agm_yearly_snapshots"
    ADD CONSTRAINT "agm_yearly_snapshots_company_boid_fy_key" UNIQUE ("company_id", "boid", "fiscal_year");



ALTER TABLE ONLY "public"."agm_yearly_snapshots"
    ADD CONSTRAINT "agm_yearly_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."api_logs"
    ADD CONSTRAINT "api_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."approval_logs"
    ADD CONSTRAINT "approval_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_statement_imports"
    ADD CONSTRAINT "bank_statement_imports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_statement_transactions"
    ADD CONSTRAINT "bank_statement_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_statements"
    ADD CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_transactions"
    ADD CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."classification_decision_history"
    ADD CONSTRAINT "classification_decision_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_company_code_key" UNIQUE ("company_code");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."corporate_declarations"
    ADD CONSTRAINT "corporate_declarations_declaration_code_key" UNIQUE ("declaration_code");



ALTER TABLE ONLY "public"."corporate_declarations"
    ADD CONSTRAINT "corporate_declarations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dividend_payables"
    ADD CONSTRAINT "dividend_payables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."error_logs"
    ADD CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fiscal_years"
    ADD CONSTRAINT "fiscal_years_fiscal_year_key" UNIQUE ("fiscal_year");



ALTER TABLE ONLY "public"."fiscal_years"
    ADD CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."iaf_allocations"
    ADD CONSTRAINT "iaf_allocations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_staging"
    ADD CONSTRAINT "import_staging_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."interest_payables"
    ADD CONSTRAINT "interest_payables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."login_logs"
    ADD CONSTRAINT "login_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mutual_fund_payables"
    ADD CONSTRAINT "mutual_fund_payables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_configs"
    ADD CONSTRAINT "notification_configs_category_key" UNIQUE ("category");



ALTER TABLE ONLY "public"."notification_configs"
    ADD CONSTRAINT "notification_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payable_tax_rules"
    ADD CONSTRAINT "payable_tax_rules_payable_category_payee_classification_key" UNIQUE ("payable_category", "payee_classification");



ALTER TABLE ONLY "public"."payable_tax_rules"
    ADD CONSTRAINT "payable_tax_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_batches"
    ADD CONSTRAINT "payment_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_logs"
    ADD CONSTRAINT "payment_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_approvals"
    ADD CONSTRAINT "pending_approvals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reconciliation_exceptions"
    ADD CONSTRAINT "reconciliation_exceptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reconciliation_results"
    ADD CONSTRAINT "reconciliation_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reconciliation_runs"
    ADD CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reconciliation_variance_approvals"
    ADD CONSTRAINT "reconciliation_variance_approvals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."report_presets"
    ADD CONSTRAINT "report_presets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."report_versions"
    ADD CONSTRAINT "report_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scheduled_reports"
    ADD CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_setting_key_key" UNIQUE ("setting_key");



ALTER TABLE ONLY "public"."upload_errors"
    ADD CONSTRAINT "upload_errors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."upload_history"
    ADD CONSTRAINT "upload_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_statement_imports"
    ADD CONSTRAINT "uq_bank_statement_imports_company_hash" UNIQUE ("company_id", "file_hash_sha256");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "uq_clients_company_boid" UNIQUE ("company_id", "boid");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "uq_clients_company_client_code" UNIQUE ("company_id", "client_code");



ALTER TABLE ONLY "public"."user_company_access"
    ADD CONSTRAINT "user_company_access_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_company_access"
    ADD CONSTRAINT "user_company_access_user_id_company_id_key" UNIQUE ("user_id", "company_id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_role_key" UNIQUE ("user_id", "role");



CREATE INDEX "idx_agm_broker_claims_boid" ON "public"."agm_broker_claims" USING "btree" ("claimant_boid");



CREATE INDEX "idx_agm_broker_claims_company_id" ON "public"."agm_broker_claims" USING "btree" ("company_id");



CREATE INDEX "idx_agm_broker_pools_company_id" ON "public"."agm_broker_pools" USING "btree" ("company_id");



CREATE INDEX "idx_agm_drn_company_id" ON "public"."agm_drn_records" USING "btree" ("company_id");



CREATE INDEX "idx_agm_drn_folio" ON "public"."agm_drn_records" USING "btree" ("folio_no");



CREATE INDEX "idx_agm_fy_meta_company_id" ON "public"."agm_fiscal_year_meta" USING "btree" ("company_id");



CREATE INDEX "idx_agm_shareholders_boid" ON "public"."agm_historical_shareholders" USING "btree" ("boid");



CREATE INDEX "idx_agm_shareholders_company_id" ON "public"."agm_historical_shareholders" USING "btree" ("company_id");



CREATE INDEX "idx_agm_shareholders_current_kitta" ON "public"."agm_historical_shareholders" USING "btree" ("current_kitta_2081" DESC);



CREATE INDEX "idx_agm_shareholders_folio" ON "public"."agm_historical_shareholders" USING "btree" ("original_folio_no") WHERE ("original_folio_no" IS NOT NULL);



CREATE INDEX "idx_agm_shareholders_holder_type" ON "public"."agm_historical_shareholders" USING "btree" ("holder_type");



CREATE INDEX "idx_agm_snapshots_boid" ON "public"."agm_yearly_snapshots" USING "btree" ("boid");



CREATE INDEX "idx_agm_snapshots_company_id" ON "public"."agm_yearly_snapshots" USING "btree" ("company_id");



CREATE INDEX "idx_agm_snapshots_conv_folio" ON "public"."agm_yearly_snapshots" USING "btree" ("converted_from_folio") WHERE ("converted_from_folio" IS NOT NULL);



CREATE INDEX "idx_agm_snapshots_fy" ON "public"."agm_yearly_snapshots" USING "btree" ("fiscal_year");



CREATE INDEX "idx_agm_snapshots_shareholder_id" ON "public"."agm_yearly_snapshots" USING "btree" ("shareholder_id");



CREATE INDEX "idx_agm_staging_lookup" ON "public"."agm_import_staging" USING "btree" ("company_id", "fiscal_year", "batch_id");



CREATE INDEX "idx_api_logs_user_id" ON "public"."api_logs" USING "btree" ("user_id");



CREATE INDEX "idx_approval_logs_approval_id" ON "public"."approval_logs" USING "btree" ("approval_id");



CREATE INDEX "idx_approval_logs_performed_by" ON "public"."approval_logs" USING "btree" ("performed_by");



CREATE INDEX "idx_audit_action_time" ON "public"."audit_logs" USING "btree" ("action", "action_time" DESC);



CREATE INDEX "idx_audit_table_time" ON "public"."audit_logs" USING "btree" ("table_name", "action_time" DESC);



CREATE INDEX "idx_audit_time" ON "public"."audit_logs" USING "btree" ("action_time" DESC);



CREATE INDEX "idx_audit_user_time" ON "public"."audit_logs" USING "btree" ("user_id", "action_time" DESC);



CREATE INDEX "idx_bank_statement_imports_company" ON "public"."bank_statement_imports" USING "btree" ("company_id");



CREATE INDEX "idx_bank_statement_imports_hash" ON "public"."bank_statement_imports" USING "btree" ("file_hash_sha256");



CREATE INDEX "idx_bank_statements_company_id" ON "public"."bank_statements" USING "btree" ("company_id");



CREATE INDEX "idx_bank_statements_uploaded_by" ON "public"."bank_statements" USING "btree" ("uploaded_by");



CREATE UNIQUE INDEX "idx_bank_stmt_imports_company_hash" ON "public"."bank_statement_imports" USING "btree" ("company_id", "file_hash_sha256");



CREATE INDEX "idx_bank_stmt_txns_company" ON "public"."bank_statement_transactions" USING "btree" ("company_id");



CREATE INDEX "idx_bank_stmt_txns_import" ON "public"."bank_statement_transactions" USING "btree" ("import_id");



CREATE INDEX "idx_bank_stmt_txns_status" ON "public"."bank_statement_transactions" USING "btree" ("reconciliation_status");



CREATE INDEX "idx_bank_transactions_company_id" ON "public"."bank_transactions" USING "btree" ("company_id");



CREATE INDEX "idx_bank_transactions_statement_id" ON "public"."bank_transactions" USING "btree" ("statement_id");



CREATE INDEX "idx_bank_transactions_uploaded_by" ON "public"."bank_transactions" USING "btree" ("uploaded_by");



CREATE INDEX "idx_class_dec_hist_client" ON "public"."classification_decision_history" USING "btree" ("client_id");



CREATE INDEX "idx_class_dec_hist_comp" ON "public"."classification_decision_history" USING "btree" ("company_id");



CREATE INDEX "idx_class_dec_hist_time" ON "public"."classification_decision_history" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_clients_company_created_at" ON "public"."clients" USING "btree" ("company_id", "created_at" DESC);



CREATE INDEX "idx_clients_company_id" ON "public"."clients" USING "btree" ("company_id");



CREATE INDEX "idx_clients_created_at" ON "public"."clients" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_clients_created_by" ON "public"."clients" USING "btree" ("created_by");



CREATE INDEX "idx_clients_needs_review" ON "public"."clients" USING "btree" ("needs_review") WHERE ("needs_review" = true);



CREATE INDEX "idx_clients_pan" ON "public"."clients" USING "btree" ("pan_or_citizenship");



CREATE INDEX "idx_clients_payee_classification" ON "public"."clients" USING "btree" ("payee_classification");



CREATE INDEX "idx_clients_trgm_account_no" ON "public"."clients" USING "gin" ("bank_account_no" "public"."gin_trgm_ops");



CREATE INDEX "idx_clients_trgm_boid" ON "public"."clients" USING "gin" ("boid" "public"."gin_trgm_ops");



CREATE INDEX "idx_clients_trgm_client_code" ON "public"."clients" USING "gin" ("client_code" "public"."gin_trgm_ops");



CREATE INDEX "idx_clients_trgm_composite_search" ON "public"."clients" USING "gin" ((((((((((COALESCE("full_name", ''::"text") || ' '::"text") || COALESCE("boid", ''::"text")) || ' '::"text") || COALESCE("client_code", ''::"text")) || ' '::"text") || COALESCE("pan_or_citizenship", ''::"text")) || ' '::"text") || COALESCE("bank_account_no", ''::"text"))) "public"."gin_trgm_ops");



CREATE INDEX "idx_clients_trgm_full_name" ON "public"."clients" USING "gin" ("full_name" "public"."gin_trgm_ops");



CREATE INDEX "idx_clients_trgm_pan" ON "public"."clients" USING "gin" ("pan_or_citizenship" "public"."gin_trgm_ops");



CREATE INDEX "idx_companies_created_by" ON "public"."companies" USING "btree" ("created_by");



CREATE INDEX "idx_companies_fiscal_year" ON "public"."companies" USING "btree" ("fiscal_year");



CREATE INDEX "idx_companies_isin" ON "public"."companies" USING "btree" ("isin");



CREATE INDEX "idx_company_client_map_client" ON "public"."company_client_map" USING "btree" ("client_id");



CREATE UNIQUE INDEX "idx_company_client_map_comp_client" ON "public"."company_client_map" USING "btree" ("company_id", "client_id");



CREATE INDEX "idx_corporate_declarations_code" ON "public"."corporate_declarations" USING "btree" ("declaration_code");



CREATE INDEX "idx_corporate_declarations_company" ON "public"."corporate_declarations" USING "btree" ("company_id");



CREATE INDEX "idx_corporate_declarations_status" ON "public"."corporate_declarations" USING "btree" ("status");



CREATE INDEX "idx_div_payables_comp_client" ON "public"."dividend_payables" USING "btree" ("company_id", "client_id");



CREATE INDEX "idx_div_payables_comp_created_at" ON "public"."dividend_payables" USING "btree" ("company_id", "created_at" DESC);



CREATE INDEX "idx_dividend_fy" ON "public"."dividend_payables" USING "btree" ("fiscal_year");



CREATE INDEX "idx_dividend_payables_classification" ON "public"."dividend_payables" USING "btree" ("company_id", "payee_classification");



CREATE INDEX "idx_dividend_payables_client_id" ON "public"."dividend_payables" USING "btree" ("client_id");



CREATE INDEX "idx_dividend_payables_comp_client" ON "public"."dividend_payables" USING "btree" ("company_id", "client_id");



CREATE INDEX "idx_dividend_payables_comp_lookup" ON "public"."dividend_payables" USING "btree" ("company_id", "fiscal_year", "payment_status");



CREATE INDEX "idx_dividend_payables_comp_status_created" ON "public"."dividend_payables" USING "btree" ("company_id", "payment_status", "created_at");



CREATE INDEX "idx_dividend_payables_company_id" ON "public"."dividend_payables" USING "btree" ("company_id");



CREATE INDEX "idx_dividend_payables_created_by" ON "public"."dividend_payables" USING "btree" ("created_by");



CREATE INDEX "idx_dividend_payables_declaration" ON "public"."dividend_payables" USING "btree" ("declaration_id");



CREATE INDEX "idx_dividend_payables_fiscal_year" ON "public"."dividend_payables" USING "btree" ("fiscal_year");



CREATE INDEX "idx_dividend_payables_status" ON "public"."dividend_payables" USING "btree" ("payment_status");



CREATE INDEX "idx_dividend_payables_upload_id" ON "public"."dividend_payables" USING "btree" ("upload_id");



CREATE INDEX "idx_dividend_status" ON "public"."dividend_payables" USING "btree" ("payment_status");



CREATE INDEX "idx_error_logs_user_id" ON "public"."error_logs" USING "btree" ("user_id");



CREATE INDEX "idx_error_time" ON "public"."error_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_error_type" ON "public"."error_logs" USING "btree" ("error_type");



CREATE INDEX "idx_iaf_allocations_company_id" ON "public"."iaf_allocations" USING "btree" ("company_id");



CREATE INDEX "idx_iaf_allocations_created_by" ON "public"."iaf_allocations" USING "btree" ("created_by");



CREATE INDEX "idx_import_staging_approval_id" ON "public"."import_staging" USING "btree" ("approval_id");



CREATE INDEX "idx_import_staging_company_id" ON "public"."import_staging" USING "btree" ("company_id");



CREATE INDEX "idx_import_staging_upload_id" ON "public"."import_staging" USING "btree" ("upload_id");



CREATE INDEX "idx_int_payables_comp_client" ON "public"."interest_payables" USING "btree" ("company_id", "client_id");



CREATE INDEX "idx_int_payables_comp_created_at" ON "public"."interest_payables" USING "btree" ("company_id", "created_at" DESC);



CREATE INDEX "idx_interest_due" ON "public"."interest_payables" USING "btree" ("due_date");



CREATE INDEX "idx_interest_payables_classification" ON "public"."interest_payables" USING "btree" ("company_id", "payee_classification");



CREATE INDEX "idx_interest_payables_client_id" ON "public"."interest_payables" USING "btree" ("client_id");



CREATE INDEX "idx_interest_payables_comp_client" ON "public"."interest_payables" USING "btree" ("company_id", "client_id");



CREATE INDEX "idx_interest_payables_comp_lookup" ON "public"."interest_payables" USING "btree" ("company_id", "fiscal_year", "payment_status");



CREATE INDEX "idx_interest_payables_comp_status_created" ON "public"."interest_payables" USING "btree" ("company_id", "payment_status", "created_at");



CREATE INDEX "idx_interest_payables_company_id" ON "public"."interest_payables" USING "btree" ("company_id");



CREATE INDEX "idx_interest_payables_created_by" ON "public"."interest_payables" USING "btree" ("created_by");



CREATE INDEX "idx_interest_payables_declaration" ON "public"."interest_payables" USING "btree" ("declaration_id");



CREATE INDEX "idx_interest_payables_fiscal_year" ON "public"."interest_payables" USING "btree" ("fiscal_year");



CREATE INDEX "idx_interest_payables_status" ON "public"."interest_payables" USING "btree" ("payment_status");



CREATE INDEX "idx_interest_payables_upload_id" ON "public"."interest_payables" USING "btree" ("upload_id");



CREATE INDEX "idx_login_logs_user_id" ON "public"."login_logs" USING "btree" ("user_id");



CREATE INDEX "idx_login_time" ON "public"."login_logs" USING "btree" ("login_time" DESC);



CREATE INDEX "idx_mf_payables_classification" ON "public"."mutual_fund_payables" USING "btree" ("company_id", "payee_classification");



CREATE INDEX "idx_mf_payables_comp_client" ON "public"."mutual_fund_payables" USING "btree" ("company_id", "client_id");



CREATE INDEX "idx_mf_payables_comp_created_at" ON "public"."mutual_fund_payables" USING "btree" ("company_id", "created_at" DESC);



CREATE INDEX "idx_mf_payables_comp_status_created" ON "public"."mutual_fund_payables" USING "btree" ("company_id", "payment_status", "created_at");



CREATE INDEX "idx_mutual_fund_fy" ON "public"."mutual_fund_payables" USING "btree" ("fiscal_year");



CREATE INDEX "idx_mutual_fund_payables_client_id" ON "public"."mutual_fund_payables" USING "btree" ("client_id");



CREATE INDEX "idx_mutual_fund_payables_comp_lookup" ON "public"."mutual_fund_payables" USING "btree" ("company_id", "fiscal_year", "payment_status");



CREATE INDEX "idx_mutual_fund_payables_company_id" ON "public"."mutual_fund_payables" USING "btree" ("company_id");



CREATE INDEX "idx_mutual_fund_payables_created_by" ON "public"."mutual_fund_payables" USING "btree" ("created_by");



CREATE INDEX "idx_mutual_fund_payables_fiscal_year" ON "public"."mutual_fund_payables" USING "btree" ("fiscal_year");



CREATE INDEX "idx_mutual_fund_payables_status" ON "public"."mutual_fund_payables" USING "btree" ("payment_status");



CREATE INDEX "idx_mutual_fund_payables_upload_id" ON "public"."mutual_fund_payables" USING "btree" ("upload_id");



CREATE INDEX "idx_notif_read" ON "public"."notifications" USING "btree" ("is_read");



CREATE INDEX "idx_notif_user" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "idx_payment_batches_approved_by" ON "public"."payment_batches" USING "btree" ("approved_by");



CREATE INDEX "idx_payment_batches_company_id" ON "public"."payment_batches" USING "btree" ("company_id");



CREATE INDEX "idx_payment_batches_created_by" ON "public"."payment_batches" USING "btree" ("created_by");



CREATE INDEX "idx_payment_batches_declaration" ON "public"."payment_batches" USING "btree" ("declaration_id");



CREATE INDEX "idx_payment_batches_status" ON "public"."payment_batches" USING "btree" ("status");



CREATE INDEX "idx_payment_logs_payment_id" ON "public"."payment_logs" USING "btree" ("payment_id");



CREATE INDEX "idx_payment_logs_performed_by" ON "public"."payment_logs" USING "btree" ("performed_by");



CREATE INDEX "idx_payments_approved_by" ON "public"."payments" USING "btree" ("approved_by");



CREATE INDEX "idx_payments_bank_account_no" ON "public"."payments" USING "btree" ("bank_account_no");



CREATE INDEX "idx_payments_batch_id" ON "public"."payments" USING "btree" ("batch_id");



CREATE INDEX "idx_payments_client_id" ON "public"."payments" USING "btree" ("client_id");



CREATE INDEX "idx_payments_company_id" ON "public"."payments" USING "btree" ("company_id");



CREATE INDEX "idx_payments_company_status" ON "public"."payments" USING "btree" ("company_id", "status");



CREATE INDEX "idx_payments_connectips_ref" ON "public"."payments" USING "btree" ("connectips_ref");



CREATE INDEX "idx_payments_created_by" ON "public"."payments" USING "btree" ("created_by");



CREATE INDEX "idx_payments_paid_amount" ON "public"."payments" USING "btree" ("paid_amount");



CREATE INDEX "idx_payments_payable" ON "public"."payments" USING "btree" ("payable_id", "payable_type");



CREATE INDEX "idx_payments_payable_active_lookup" ON "public"."payments" USING "btree" ("payable_id", "status") WHERE ("status" = ANY (ARRAY['Draft'::"text", 'Pending'::"text", 'Approved'::"text"]));



CREATE INDEX "idx_payments_processed_by" ON "public"."payments" USING "btree" ("processed_by");



CREATE UNIQUE INDEX "idx_payments_recon_run_payable" ON "public"."payments" USING "btree" ("reconciliation_run_id", "payable_type", "payable_id") WHERE ("reconciliation_run_id" IS NOT NULL);



CREATE INDEX "idx_payments_reconciliation_run_id" ON "public"."payments" USING "btree" ("reconciliation_run_id");



CREATE INDEX "idx_payments_reversed_by" ON "public"."payments" USING "btree" ("reversed_by");



CREATE INDEX "idx_payments_status" ON "public"."payments" USING "btree" ("status");



CREATE INDEX "idx_pending_approvals_requested_by" ON "public"."pending_approvals" USING "btree" ("requested_by");



CREATE INDEX "idx_pending_approvals_reviewed_by" ON "public"."pending_approvals" USING "btree" ("reviewed_by");



CREATE INDEX "idx_recon_exceptions_company" ON "public"."reconciliation_exceptions" USING "btree" ("company_id");



CREATE INDEX "idx_recon_exceptions_run" ON "public"."reconciliation_exceptions" USING "btree" ("run_id");



CREATE INDEX "idx_recon_exceptions_status" ON "public"."reconciliation_exceptions" USING "btree" ("status");



CREATE INDEX "idx_recon_result" ON "public"."reconciliation_results" USING "btree" ("result");



CREATE INDEX "idx_recon_variance_approvals_comp" ON "public"."reconciliation_variance_approvals" USING "btree" ("company_id");



CREATE INDEX "idx_recon_variance_approvals_result" ON "public"."reconciliation_variance_approvals" USING "btree" ("result_id");



CREATE INDEX "idx_recon_variance_approvals_run" ON "public"."reconciliation_variance_approvals" USING "btree" ("run_id");



CREATE INDEX "idx_reconciliation_results_batch_id" ON "public"."reconciliation_results" USING "btree" ("batch_id");



CREATE INDEX "idx_reconciliation_results_client_id" ON "public"."reconciliation_results" USING "btree" ("client_id");



CREATE INDEX "idx_reconciliation_results_comp_lookup" ON "public"."reconciliation_results" USING "btree" ("company_id", "reconciliation_date", "result");



CREATE INDEX "idx_reconciliation_results_company_id" ON "public"."reconciliation_results" USING "btree" ("company_id");



CREATE INDEX "idx_reconciliation_results_date" ON "public"."reconciliation_results" USING "btree" ("reconciliation_date");



CREATE UNIQUE INDEX "idx_reconciliation_results_idempotency" ON "public"."reconciliation_results" USING "btree" ("run_id", "source_reference") WHERE ("run_id" IS NOT NULL);



CREATE INDEX "idx_reconciliation_results_matched_by" ON "public"."reconciliation_results" USING "btree" ("matched_by");



CREATE INDEX "idx_reconciliation_results_payable_id" ON "public"."reconciliation_results" USING "btree" ("payable_id");



CREATE INDEX "idx_reconciliation_results_payment_id" ON "public"."reconciliation_results" USING "btree" ("payment_id");



CREATE INDEX "idx_reconciliation_results_run_id" ON "public"."reconciliation_results" USING "btree" ("run_id");



CREATE INDEX "idx_reconciliation_runs_company_id" ON "public"."reconciliation_runs" USING "btree" ("company_id");



CREATE INDEX "idx_reconciliation_runs_created_at" ON "public"."reconciliation_runs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_reconciliation_runs_file_hash" ON "public"."reconciliation_runs" USING "btree" ("file_hash_sha256");



CREATE UNIQUE INDEX "idx_reconciliation_runs_idempotency" ON "public"."reconciliation_runs" USING "btree" ("idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "idx_reconciliation_runs_status" ON "public"."reconciliation_runs" USING "btree" ("status");



CREATE INDEX "idx_report_presets_company_id" ON "public"."report_presets" USING "btree" ("company_id");



CREATE INDEX "idx_report_versions_company_id" ON "public"."report_versions" USING "btree" ("company_id");



CREATE INDEX "idx_report_versions_generated_at" ON "public"."report_versions" USING "btree" ("generated_at");



CREATE INDEX "idx_scheduled_reports_active_due" ON "public"."scheduled_reports" USING "btree" ("is_active", "next_run_at");



CREATE INDEX "idx_scheduled_reports_company_id" ON "public"."scheduled_reports" USING "btree" ("company_id");



CREATE INDEX "idx_system_settings_updated_by" ON "public"."system_settings" USING "btree" ("updated_by");



CREATE INDEX "idx_uca_company" ON "public"."user_company_access" USING "btree" ("company_id");



CREATE INDEX "idx_uca_user" ON "public"."user_company_access" USING "btree" ("user_id");



CREATE INDEX "idx_upload_errors_upload_id" ON "public"."upload_errors" USING "btree" ("upload_id");



CREATE INDEX "idx_upload_history_user_id" ON "public"."upload_history" USING "btree" ("user_id");



CREATE UNIQUE INDEX "uq_active_payments_payable_id" ON "public"."payments" USING "btree" ("payable_id") WHERE (("status" <> ALL (ARRAY['Failed'::"text", 'Reversed'::"text", 'Cancelled'::"text"])) AND ("payable_id" IS NOT NULL));



CREATE UNIQUE INDEX "uq_active_payments_reference" ON "public"."payments" USING "btree" ("payment_reference") WHERE (("status" <> ALL (ARRAY['Failed'::"text", 'Reversed'::"text", 'Cancelled'::"text"])) AND (("payment_reference" IS NOT NULL) AND ("payment_reference" <> ''::"text")));



CREATE UNIQUE INDEX "uq_bank_txn_fingerprint_scoped" ON "public"."bank_statement_transactions" USING "btree" ("company_id", "transaction_fingerprint");



CREATE UNIQUE INDEX "uq_dividend_payables_client_fy_remarks" ON "public"."dividend_payables" USING "btree" ("client_id", "company_id", "fiscal_year", COALESCE("remarks", ''::"text"));



CREATE UNIQUE INDEX "uq_interest_payables_client_fy_remarks" ON "public"."interest_payables" USING "btree" ("client_id", "company_id", "fiscal_year", COALESCE("remarks", ''::"text"));



CREATE UNIQUE INDEX "uq_mutual_fund_payables_client_fy_remarks" ON "public"."mutual_fund_payables" USING "btree" ("client_id", "company_id", "fiscal_year", COALESCE("remarks", ''::"text"));



CREATE UNIQUE INDEX "uq_recon_variance_approvals" ON "public"."reconciliation_variance_approvals" USING "btree" ("run_id", "payable_id", COALESCE("source_reference", ''::"text"));



CREATE UNIQUE INDEX "uq_upload_history_active_file_hash" ON "public"."upload_history" USING "btree" ("file_hash", "target_table") WHERE (("status" = ANY (ARRAY['Completed'::"text", 'Processing'::"text"])) AND ("file_hash" IS NOT NULL) AND ("file_hash" <> ''::"text"));



CREATE OR REPLACE TRIGGER "trg_approval_log_actor" BEFORE INSERT ON "public"."approval_logs" FOR EACH ROW EXECUTE FUNCTION "public"."set_approval_log_actor"();



CREATE OR REPLACE TRIGGER "trg_audit_bt" AFTER INSERT OR DELETE OR UPDATE ON "public"."bank_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_audit_clients" AFTER INSERT OR DELETE OR UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_audit_companies" AFTER INSERT OR DELETE OR UPDATE ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_audit_dp" AFTER INSERT OR DELETE OR UPDATE ON "public"."dividend_payables" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_audit_iaf" AFTER INSERT OR DELETE OR UPDATE ON "public"."iaf_allocations" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_audit_ip" AFTER INSERT OR DELETE OR UPDATE ON "public"."interest_payables" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_audit_log_actor" BEFORE INSERT ON "public"."audit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."set_audit_log_actor"();



CREATE OR REPLACE TRIGGER "trg_audit_mf" AFTER INSERT OR DELETE OR UPDATE ON "public"."mutual_fund_payables" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_audit_payment_batches" AFTER INSERT OR DELETE OR UPDATE ON "public"."payment_batches" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_audit_payments" AFTER INSERT OR DELETE OR UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_audit_reconciliation_results" AFTER INSERT OR DELETE OR UPDATE ON "public"."reconciliation_results" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_audit_upload_history" AFTER INSERT OR DELETE OR UPDATE ON "public"."upload_history" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_audit_user_company_access" AFTER INSERT OR DELETE OR UPDATE ON "public"."user_company_access" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_audit_user_roles" AFTER INSERT OR DELETE OR UPDATE ON "public"."user_roles" FOR EACH ROW EXECUTE FUNCTION "public"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_clients_needs_review" BEFORE INSERT OR UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."trg_clients_set_needs_review"();



CREATE OR REPLACE TRIGGER "trg_clients_payee_classification" BEFORE INSERT OR UPDATE OF "holder_type", "payee_classification", "classification_status" ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."sync_client_payee_classification"();



CREATE OR REPLACE TRIGGER "trg_clients_updated" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_companies_enforce_defaults" BEFORE INSERT OR UPDATE ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "public"."trg_companies_generic_defaults"();



CREATE OR REPLACE TRIGGER "trg_companies_updated" BEFORE UPDATE ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_dividend_classification_tax" BEFORE INSERT OR UPDATE OF "client_id", "gross_dividend", "tax_amount", "tds_rate" ON "public"."dividend_payables" FOR EACH ROW EXECUTE FUNCTION "public"."apply_payable_classification_and_tax"();



CREATE OR REPLACE TRIGGER "trg_dp_calc" BEFORE INSERT OR UPDATE ON "public"."dividend_payables" FOR EACH ROW EXECUTE FUNCTION "public"."calc_dividend_payable_safe"();



CREATE OR REPLACE TRIGGER "trg_interest_classification_tax" BEFORE INSERT OR UPDATE OF "client_id", "gross_interest", "tax_amount", "tds_rate" ON "public"."interest_payables" FOR EACH ROW EXECUTE FUNCTION "public"."apply_payable_classification_and_tax"();



CREATE OR REPLACE TRIGGER "trg_ip_calc" BEFORE INSERT OR UPDATE ON "public"."interest_payables" FOR EACH ROW EXECUTE FUNCTION "public"."calc_interest_payable_safe"();



CREATE OR REPLACE TRIGGER "trg_mfp_calc" BEFORE INSERT OR UPDATE ON "public"."mutual_fund_payables" FOR EACH ROW EXECUTE FUNCTION "public"."calc_dividend_payable_safe"();



CREATE OR REPLACE TRIGGER "trg_mutual_fund_classification_tax" BEFORE INSERT OR UPDATE OF "client_id", "gross_dividend", "tax_amount", "tds_rate" ON "public"."mutual_fund_payables" FOR EACH ROW EXECUTE FUNCTION "public"."apply_payable_classification_and_tax"();



CREATE OR REPLACE TRIGGER "trg_normalize_import_staging_rows" BEFORE INSERT OR UPDATE OF "staged_rows", "target_table" ON "public"."import_staging" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_import_staging_rows"();



CREATE OR REPLACE TRIGGER "trg_notification_configs_updated" BEFORE UPDATE ON "public"."notification_configs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_payment_batch_completed" AFTER UPDATE OF "status" ON "public"."payment_batches" FOR EACH ROW EXECUTE FUNCTION "public"."trg_fn_sync_payment_batch_completion"();



CREATE OR REPLACE TRIGGER "trg_payment_batches_updated" BEFORE UPDATE ON "public"."payment_batches" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_payment_log_actor" BEFORE INSERT ON "public"."payment_logs" FOR EACH ROW EXECUTE FUNCTION "public"."set_payment_log_actor"();



CREATE OR REPLACE TRIGGER "trg_payments_updated" BEFORE UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_populate_staged_interest_metadata" BEFORE INSERT ON "public"."interest_payables" FOR EACH ROW EXECUTE FUNCTION "public"."populate_staged_interest_metadata"();



CREATE OR REPLACE TRIGGER "trg_sync_payables_on_client_update" AFTER UPDATE OF "payee_classification", "holder_type" ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."sync_payables_on_client_classification_update"();



CREATE OR REPLACE TRIGGER "trg_system_settings_updated" BEFORE UPDATE ON "public"."system_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_upload_history_set_user" BEFORE INSERT ON "public"."upload_history" FOR EACH ROW EXECUTE FUNCTION "public"."set_upload_user_id"();



ALTER TABLE ONLY "public"."agm_broker_claims"
    ADD CONSTRAINT "agm_broker_claims_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agm_broker_pools"
    ADD CONSTRAINT "agm_broker_pools_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agm_drn_records"
    ADD CONSTRAINT "agm_drn_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agm_fiscal_year_meta"
    ADD CONSTRAINT "agm_fiscal_year_meta_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agm_historical_shareholders"
    ADD CONSTRAINT "agm_historical_shareholders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agm_import_staging"
    ADD CONSTRAINT "agm_import_staging_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agm_yearly_snapshots"
    ADD CONSTRAINT "agm_yearly_snapshots_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agm_yearly_snapshots"
    ADD CONSTRAINT "agm_yearly_snapshots_shareholder_id_fkey" FOREIGN KEY ("shareholder_id") REFERENCES "public"."agm_historical_shareholders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."api_logs"
    ADD CONSTRAINT "api_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."approval_logs"
    ADD CONSTRAINT "approval_logs_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "public"."pending_approvals"("id");



ALTER TABLE ONLY "public"."approval_logs"
    ADD CONSTRAINT "approval_logs_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bank_statement_imports"
    ADD CONSTRAINT "bank_statement_imports_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_statement_transactions"
    ADD CONSTRAINT "bank_statement_transactions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_statement_transactions"
    ADD CONSTRAINT "bank_statement_transactions_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "public"."bank_statement_imports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_statement_transactions"
    ADD CONSTRAINT "bank_statement_transactions_reconciliation_run_id_fkey" FOREIGN KEY ("reconciliation_run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bank_statements"
    ADD CONSTRAINT "bank_statements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_statements"
    ADD CONSTRAINT "bank_statements_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bank_transactions"
    ADD CONSTRAINT "bank_transactions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_transactions"
    ADD CONSTRAINT "bank_transactions_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_transactions"
    ADD CONSTRAINT "bank_transactions_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."classification_decision_history"
    ADD CONSTRAINT "classification_decision_history_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."classification_decision_history"
    ADD CONSTRAINT "classification_decision_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."corporate_declarations"
    ADD CONSTRAINT "corporate_declarations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dividend_payables"
    ADD CONSTRAINT "dividend_payables_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dividend_payables"
    ADD CONSTRAINT "dividend_payables_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dividend_payables"
    ADD CONSTRAINT "dividend_payables_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dividend_payables"
    ADD CONSTRAINT "dividend_payables_declaration_id_fkey" FOREIGN KEY ("declaration_id") REFERENCES "public"."corporate_declarations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dividend_payables"
    ADD CONSTRAINT "dividend_payables_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "public"."upload_history"("id");



ALTER TABLE ONLY "public"."error_logs"
    ADD CONSTRAINT "error_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."iaf_allocations"
    ADD CONSTRAINT "iaf_allocations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."iaf_allocations"
    ADD CONSTRAINT "iaf_allocations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."import_staging"
    ADD CONSTRAINT "import_staging_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "public"."pending_approvals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_staging"
    ADD CONSTRAINT "import_staging_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_staging"
    ADD CONSTRAINT "import_staging_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "public"."upload_history"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."interest_payables"
    ADD CONSTRAINT "interest_payables_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."interest_payables"
    ADD CONSTRAINT "interest_payables_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."interest_payables"
    ADD CONSTRAINT "interest_payables_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."interest_payables"
    ADD CONSTRAINT "interest_payables_declaration_id_fkey" FOREIGN KEY ("declaration_id") REFERENCES "public"."corporate_declarations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."interest_payables"
    ADD CONSTRAINT "interest_payables_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "public"."upload_history"("id");



ALTER TABLE ONLY "public"."login_logs"
    ADD CONSTRAINT "login_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mutual_fund_payables"
    ADD CONSTRAINT "mutual_fund_payables_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mutual_fund_payables"
    ADD CONSTRAINT "mutual_fund_payables_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mutual_fund_payables"
    ADD CONSTRAINT "mutual_fund_payables_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mutual_fund_payables"
    ADD CONSTRAINT "mutual_fund_payables_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "public"."upload_history"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_batches"
    ADD CONSTRAINT "payment_batches_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_batches"
    ADD CONSTRAINT "payment_batches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_batches"
    ADD CONSTRAINT "payment_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_batches"
    ADD CONSTRAINT "payment_batches_declaration_id_fkey" FOREIGN KEY ("declaration_id") REFERENCES "public"."corporate_declarations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_logs"
    ADD CONSTRAINT "payment_logs_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id");



ALTER TABLE ONLY "public"."payment_logs"
    ADD CONSTRAINT "payment_logs_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."payment_batches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_reconciliation_run_id_fkey" FOREIGN KEY ("reconciliation_run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pending_approvals"
    ADD CONSTRAINT "pending_approvals_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pending_approvals"
    ADD CONSTRAINT "pending_approvals_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reconciliation_exceptions"
    ADD CONSTRAINT "reconciliation_exceptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reconciliation_exceptions"
    ADD CONSTRAINT "reconciliation_exceptions_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "public"."reconciliation_results"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reconciliation_exceptions"
    ADD CONSTRAINT "reconciliation_exceptions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reconciliation_results"
    ADD CONSTRAINT "reconciliation_results_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."payment_batches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reconciliation_results"
    ADD CONSTRAINT "reconciliation_results_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reconciliation_results"
    ADD CONSTRAINT "reconciliation_results_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reconciliation_results"
    ADD CONSTRAINT "reconciliation_results_matched_by_fkey" FOREIGN KEY ("matched_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reconciliation_results"
    ADD CONSTRAINT "reconciliation_results_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reconciliation_results"
    ADD CONSTRAINT "reconciliation_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reconciliation_runs"
    ADD CONSTRAINT "reconciliation_runs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."payment_batches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reconciliation_runs"
    ADD CONSTRAINT "reconciliation_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reconciliation_variance_approvals"
    ADD CONSTRAINT "reconciliation_variance_approvals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reconciliation_variance_approvals"
    ADD CONSTRAINT "reconciliation_variance_approvals_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "public"."reconciliation_results"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reconciliation_variance_approvals"
    ADD CONSTRAINT "reconciliation_variance_approvals_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."report_presets"
    ADD CONSTRAINT "report_presets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."report_versions"
    ADD CONSTRAINT "report_versions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scheduled_reports"
    ADD CONSTRAINT "scheduled_reports_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."upload_errors"
    ADD CONSTRAINT "upload_errors_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "public"."upload_history"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."upload_history"
    ADD CONSTRAINT "upload_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_company_access"
    ADD CONSTRAINT "user_company_access_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_company_access"
    ADD CONSTRAINT "user_company_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Authorized users can manage corporate declarations" ON "public"."corporate_declarations" TO "authenticated" USING (("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR ("public"."has_company_access"("auth"."uid"(), "company_id") AND "public"."has_any_role"("auth"."uid"(), ARRAY['finance_operator'::"public"."app_role", 'supervisor'::"public"."app_role", 'operator'::"public"."app_role", 'maker'::"public"."app_role"])))) WITH CHECK (("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR ("public"."has_company_access"("auth"."uid"(), "company_id") AND "public"."has_any_role"("auth"."uid"(), ARRAY['finance_operator'::"public"."app_role", 'supervisor'::"public"."app_role", 'operator'::"public"."app_role", 'maker'::"public"."app_role"]))));



CREATE POLICY "Users can read declarations for authorized companies" ON "public"."corporate_declarations" FOR SELECT TO "authenticated" USING (("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role") OR "public"."has_company_access"("auth"."uid"(), "company_id")));



CREATE POLICY "admins manage payable tax rules" ON "public"."payable_tax_rules" TO "authenticated" USING ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")) WITH CHECK ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role"));



ALTER TABLE "public"."agm_broker_claims" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agm_broker_claims_modify" ON "public"."agm_broker_claims" TO "authenticated" USING (((("company_id" IS NULL) OR "public"."has_company_access"("auth"."uid"(), "company_id")) AND "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role"]))) WITH CHECK (((("company_id" IS NULL) OR "public"."has_company_access"("auth"."uid"(), "company_id")) AND "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role"])));



CREATE POLICY "agm_broker_claims_select" ON "public"."agm_broker_claims" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'operator'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") AND (( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") OR ("company_id" IS NULL) OR ("company_id" IN ( SELECT "user_company_access"."company_id"
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."created_by" = ( SELECT "auth"."uid"() AS "uid")))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))))));



ALTER TABLE "public"."agm_broker_pools" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agm_broker_pools_modify" ON "public"."agm_broker_pools" TO "authenticated" USING (((("company_id" IS NULL) OR "public"."has_company_access"("auth"."uid"(), "company_id")) AND "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role"]))) WITH CHECK (((("company_id" IS NULL) OR "public"."has_company_access"("auth"."uid"(), "company_id")) AND "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role"])));



CREATE POLICY "agm_broker_pools_select" ON "public"."agm_broker_pools" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'operator'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") AND (( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") OR ("company_id" IS NULL) OR ("company_id" IN ( SELECT "user_company_access"."company_id"
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."created_by" = ( SELECT "auth"."uid"() AS "uid")))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))))));



ALTER TABLE "public"."agm_drn_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agm_drn_records_modify" ON "public"."agm_drn_records" TO "authenticated" USING (((("company_id" IS NULL) OR "public"."has_company_access"("auth"."uid"(), "company_id")) AND "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role"]))) WITH CHECK (((("company_id" IS NULL) OR "public"."has_company_access"("auth"."uid"(), "company_id")) AND "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role"])));



CREATE POLICY "agm_drn_records_select" ON "public"."agm_drn_records" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'operator'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") AND (( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") OR ("company_id" IS NULL) OR ("company_id" IN ( SELECT "user_company_access"."company_id"
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."created_by" = ( SELECT "auth"."uid"() AS "uid")))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))))));



ALTER TABLE "public"."agm_fiscal_year_meta" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agm_fiscal_year_meta_modify" ON "public"."agm_fiscal_year_meta" TO "authenticated" USING (((("company_id" IS NULL) OR "public"."has_company_access"("auth"."uid"(), "company_id")) AND "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role"]))) WITH CHECK (((("company_id" IS NULL) OR "public"."has_company_access"("auth"."uid"(), "company_id")) AND "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role"])));



CREATE POLICY "agm_fiscal_year_meta_select" ON "public"."agm_fiscal_year_meta" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'operator'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") AND (( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") OR ("company_id" IS NULL) OR ("company_id" IN ( SELECT "user_company_access"."company_id"
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."created_by" = ( SELECT "auth"."uid"() AS "uid")))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))))));



ALTER TABLE "public"."agm_historical_shareholders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agm_historical_shareholders_modify" ON "public"."agm_historical_shareholders" TO "authenticated" USING (((("company_id" IS NULL) OR "public"."has_company_access"("auth"."uid"(), "company_id")) AND "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role"]))) WITH CHECK (((("company_id" IS NULL) OR "public"."has_company_access"("auth"."uid"(), "company_id")) AND "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role"])));



CREATE POLICY "agm_historical_shareholders_select" ON "public"."agm_historical_shareholders" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'operator'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") AND (( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") OR ("company_id" IS NULL) OR ("company_id" IN ( SELECT "user_company_access"."company_id"
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."created_by" = ( SELECT "auth"."uid"() AS "uid")))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))))));



ALTER TABLE "public"."agm_import_staging" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agm_import_staging_delete" ON "public"."agm_import_staging" FOR DELETE TO "authenticated" USING (("public"."has_company_access"("auth"."uid"(), "company_id") AND "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role"])));



CREATE POLICY "agm_import_staging_insert" ON "public"."agm_import_staging" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_company_access"("auth"."uid"(), "company_id") AND "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role"])));



CREATE POLICY "agm_import_staging_select" ON "public"."agm_import_staging" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'operator'::"public"."app_role", 'auditor'::"public"."app_role"]) AS "has_any_role") AND (( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role"]) AS "has_any_role") OR ("company_id" IS NULL) OR ("company_id" IN ( SELECT "user_company_access"."company_id"
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."created_by" = ( SELECT "auth"."uid"() AS "uid")))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))))));



ALTER TABLE "public"."agm_yearly_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agm_yearly_snapshots_modify" ON "public"."agm_yearly_snapshots" TO "authenticated" USING (((("company_id" IS NULL) OR "public"."has_company_access"("auth"."uid"(), "company_id")) AND "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role"]))) WITH CHECK (((("company_id" IS NULL) OR "public"."has_company_access"("auth"."uid"(), "company_id")) AND "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role"])));



CREATE POLICY "agm_yearly_snapshots_select" ON "public"."agm_yearly_snapshots" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'operator'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") AND (( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") OR ("company_id" IS NULL) OR ("company_id" IN ( SELECT "user_company_access"."company_id"
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."created_by" = ( SELECT "auth"."uid"() AS "uid")))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))))));



CREATE POLICY "al_read" ON "public"."api_logs" FOR SELECT TO "authenticated" USING ("public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'auditor'::"public"."app_role"]));



ALTER TABLE "public"."api_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "apl_insert" ON "public"."approval_logs" FOR INSERT TO "authenticated" WITH CHECK ((("performed_by" = "auth"."uid"()) OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role"])));



CREATE POLICY "apl_read" ON "public"."approval_logs" FOR SELECT TO "authenticated" USING ((("performed_by" = "auth"."uid"()) OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'auditor'::"public"."app_role"])));



ALTER TABLE "public"."approval_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_insert" ON "public"."audit_logs" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role")));



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_read" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING ("public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role"]));



ALTER TABLE "public"."bank_statement_imports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bank_statement_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bank_statements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bank_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bs_delete" ON "public"."bank_statements" FOR DELETE TO "authenticated" USING ((( SELECT "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role") AS "has_role") AND
CASE
    WHEN ("company_id" IS NULL) THEN true
    ELSE "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")
END));



CREATE POLICY "bs_read" ON "public"."bank_statements" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role"]) AS "has_any_role") AND
CASE
    WHEN ("company_id" IS NULL) THEN "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")
    ELSE "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")
END));



CREATE POLICY "bs_update" ON "public"."bank_statements" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'finance_operator'::"public"."app_role"]) AS "has_any_role") AND
CASE
    WHEN ("company_id" IS NULL) THEN "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")
    ELSE "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")
END)) WITH CHECK ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'finance_operator'::"public"."app_role"]) AS "has_any_role") AND
CASE
    WHEN ("company_id" IS NULL) THEN "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")
    ELSE "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")
END));



CREATE POLICY "bs_write" ON "public"."bank_statements" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'finance_operator'::"public"."app_role"]) AS "has_any_role") AND
CASE
    WHEN ("company_id" IS NULL) THEN "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")
    ELSE "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")
END));



CREATE POLICY "bsi_read" ON "public"."bank_statement_imports" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role"]) AS "has_any_role") AND "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")));



CREATE POLICY "bsi_write" ON "public"."bank_statement_imports" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'finance_operator'::"public"."app_role"]) AS "has_any_role") AND "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")));



CREATE POLICY "bst_read" ON "public"."bank_statement_transactions" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role"]) AS "has_any_role") AND "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")));



CREATE POLICY "bst_update" ON "public"."bank_statement_transactions" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'finance_operator'::"public"."app_role"]) AS "has_any_role") AND "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id"))) WITH CHECK ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'finance_operator'::"public"."app_role"]) AS "has_any_role") AND "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")));



CREATE POLICY "bst_write" ON "public"."bank_statement_transactions" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'finance_operator'::"public"."app_role"]) AS "has_any_role") AND "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")));



CREATE POLICY "bt_delete" ON "public"."bank_transactions" FOR DELETE TO "authenticated" USING ((( SELECT "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role") AS "has_role") AND
CASE
    WHEN ("company_id" IS NULL) THEN true
    ELSE "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")
END));



CREATE POLICY "bt_read" ON "public"."bank_transactions" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role"]) AS "has_any_role") AND
CASE
    WHEN ("company_id" IS NULL) THEN "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")
    ELSE "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")
END));



CREATE POLICY "bt_update" ON "public"."bank_transactions" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'finance_operator'::"public"."app_role"]) AS "has_any_role") AND
CASE
    WHEN ("company_id" IS NULL) THEN "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")
    ELSE "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")
END)) WITH CHECK ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'finance_operator'::"public"."app_role"]) AS "has_any_role") AND
CASE
    WHEN ("company_id" IS NULL) THEN "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")
    ELSE "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")
END));



CREATE POLICY "bt_write" ON "public"."bank_transactions" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'finance_operator'::"public"."app_role"]) AS "has_any_role") AND
CASE
    WHEN ("company_id" IS NULL) THEN "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")
    ELSE "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")
END));



CREATE POLICY "cdh_read" ON "public"."classification_decision_history" FOR SELECT TO "authenticated" USING (("public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'auditor'::"public"."app_role"]) AND (("company_id" IS NULL) OR "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id"))));



ALTER TABLE "public"."classification_decision_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_delete" ON "public"."clients" FOR DELETE TO "authenticated" USING ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"));



CREATE POLICY "clients_read" ON "public"."clients" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") OR ("company_id" IS NULL) OR ("company_id" IN ( SELECT "user_company_access"."company_id"
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."created_by" = ( SELECT "auth"."uid"() AS "uid")))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "clients_update" ON "public"."clients" FOR UPDATE TO "authenticated" USING ("public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role"]));



CREATE POLICY "clients_write" ON "public"."clients" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role"]));



ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "companies_delete" ON "public"."companies" FOR DELETE TO "authenticated" USING ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"));



CREATE POLICY "companies_read" ON "public"."companies" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") OR ("created_by" = ( SELECT "auth"."uid"() AS "uid")) OR ("id" IN ( SELECT "user_company_access"."company_id"
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "companies_update" ON "public"."companies" FOR UPDATE TO "authenticated" USING ("public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role"]));



CREATE POLICY "companies_write" ON "public"."companies" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role"]));



ALTER TABLE "public"."corporate_declarations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dividend_payables" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dp_delete" ON "public"."dividend_payables" FOR DELETE TO "authenticated" USING ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role"));



CREATE POLICY "dp_read" ON "public"."dividend_payables" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") OR ("company_id" IS NULL) OR ("company_id" IN ( SELECT "user_company_access"."company_id"
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."created_by" = ( SELECT "auth"."uid"() AS "uid")))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "dp_update" ON "public"."dividend_payables" FOR UPDATE TO "authenticated" USING ("public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role"]));



CREATE POLICY "dp_write" ON "public"."dividend_payables" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role"]));



CREATE POLICY "el_read" ON "public"."error_logs" FOR SELECT TO "authenticated" USING ("public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'auditor'::"public"."app_role"]));



ALTER TABLE "public"."error_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fiscal_years" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fy_admin" ON "public"."fiscal_years" TO "authenticated" USING ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")) WITH CHECK ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role"));



CREATE POLICY "fy_read" ON "public"."fiscal_years" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."iaf_allocations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "iaf_read" ON "public"."iaf_allocations" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") OR ("company_id" IS NULL) OR ("company_id" IN ( SELECT "user_company_access"."company_id"
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."created_by" = ( SELECT "auth"."uid"() AS "uid")))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "iaf_write" ON "public"."iaf_allocations" TO "authenticated" USING ("public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role"])) WITH CHECK ("public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role"]));



ALTER TABLE "public"."import_staging" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "import_staging_delete" ON "public"."import_staging" FOR DELETE TO "authenticated" USING ((("auth"."uid"() IS NOT NULL) AND ((("created_by" = "auth"."uid"()) AND ("status" = 'STAGED'::"text") AND "public"."has_company_access"("auth"."uid"(), "company_id")) OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role"]))));



CREATE POLICY "import_staging_insert" ON "public"."import_staging" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("created_by" = "auth"."uid"()) AND ("public"."has_company_access"("auth"."uid"(), "company_id") OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role"]))));



CREATE POLICY "import_staging_select" ON "public"."import_staging" FOR SELECT TO "authenticated" USING (("public"."has_company_access"("auth"."uid"(), "company_id") OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role"])));



CREATE POLICY "import_staging_update" ON "public"."import_staging" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() IS NOT NULL) AND ((("created_by" = "auth"."uid"()) AND ("status" = 'STAGED'::"text") AND "public"."has_company_access"("auth"."uid"(), "company_id")) OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role"]))));



ALTER TABLE "public"."interest_payables" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ip_delete" ON "public"."interest_payables" FOR DELETE TO "authenticated" USING ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role"));



CREATE POLICY "ip_read" ON "public"."interest_payables" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") OR ("company_id" IS NULL) OR ("company_id" IN ( SELECT "user_company_access"."company_id"
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."created_by" = ( SELECT "auth"."uid"() AS "uid")))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "ip_update" ON "public"."interest_payables" FOR UPDATE TO "authenticated" USING ("public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role"]));



CREATE POLICY "ip_write" ON "public"."interest_payables" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role"]));



CREATE POLICY "ll_insert" ON "public"."login_logs" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "ll_select" ON "public"."login_logs" FOR SELECT TO "authenticated" USING ("public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role"]));



ALTER TABLE "public"."login_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mfp_delete" ON "public"."mutual_fund_payables" FOR DELETE TO "authenticated" USING ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role"));



CREATE POLICY "mfp_read" ON "public"."mutual_fund_payables" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") OR ("company_id" IS NULL) OR ("company_id" IN ( SELECT "user_company_access"."company_id"
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."created_by" = ( SELECT "auth"."uid"() AS "uid")))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "mfp_update" ON "public"."mutual_fund_payables" FOR UPDATE TO "authenticated" USING ("public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role"]));



CREATE POLICY "mfp_write" ON "public"."mutual_fund_payables" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role"]));



ALTER TABLE "public"."mutual_fund_payables" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "nc_admin" ON "public"."notification_configs" TO "authenticated" USING ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")) WITH CHECK ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role"));



CREATE POLICY "nc_read" ON "public"."notification_configs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "notif_insert" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role"])));



CREATE POLICY "notif_read" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "notif_update" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."notification_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pa_delete" ON "public"."pending_approvals" FOR DELETE TO "authenticated" USING ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"));



CREATE POLICY "pa_insert" ON "public"."pending_approvals" FOR INSERT TO "authenticated" WITH CHECK (("requested_by" = "auth"."uid"()));



CREATE POLICY "pa_read" ON "public"."pending_approvals" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "pa_review" ON "public"."pending_approvals" FOR UPDATE TO "authenticated" USING ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"));



CREATE POLICY "pay_read" ON "public"."payments" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") OR ("company_id" IS NULL) OR ("company_id" IN ( SELECT "user_company_access"."company_id"
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."created_by" = ( SELECT "auth"."uid"() AS "uid")))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "pay_update" ON "public"."payments" FOR UPDATE TO "authenticated" USING ("public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role", 'reconciliation_officer'::"public"."app_role"]));



CREATE POLICY "pay_write" ON "public"."payments" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role", 'reconciliation_officer'::"public"."app_role"]));



CREATE POLICY "payable tax rules are readable" ON "public"."payable_tax_rules" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."payable_tax_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payments_delete" ON "public"."payments" FOR DELETE TO "authenticated" USING ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role"));



CREATE POLICY "pb_delete" ON "public"."payment_batches" FOR DELETE TO "authenticated" USING ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"));



CREATE POLICY "pb_read" ON "public"."payment_batches" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") OR ("company_id" IS NULL) OR ("company_id" IN ( SELECT "user_company_access"."company_id"
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."created_by" = ( SELECT "auth"."uid"() AS "uid")))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "pb_update" ON "public"."payment_batches" FOR UPDATE TO "authenticated" USING ("public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role"]));



CREATE POLICY "pb_write" ON "public"."payment_batches" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role"]));



ALTER TABLE "public"."pending_approvals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pl_insert" ON "public"."payment_logs" FOR INSERT TO "authenticated" WITH CHECK ((("performed_by" = "auth"."uid"()) OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role"])));



CREATE POLICY "pl_read" ON "public"."payment_logs" FOR SELECT TO "authenticated" USING ((("performed_by" = "auth"."uid"()) OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'auditor'::"public"."app_role"])));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_all" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "re_read" ON "public"."reconciliation_exceptions" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role"]) AS "has_any_role") AND
CASE
    WHEN ("company_id" IS NULL) THEN "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")
    ELSE "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")
END));



CREATE POLICY "re_update" ON "public"."reconciliation_exceptions" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'finance_operator'::"public"."app_role", 'supervisor'::"public"."app_role"]) AS "has_any_role") AND
CASE
    WHEN ("company_id" IS NULL) THEN "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")
    ELSE "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")
END)) WITH CHECK ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'finance_operator'::"public"."app_role", 'supervisor'::"public"."app_role"]) AS "has_any_role") AND
CASE
    WHEN ("company_id" IS NULL) THEN "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")
    ELSE "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")
END));



CREATE POLICY "re_write" ON "public"."reconciliation_exceptions" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'finance_operator'::"public"."app_role", 'supervisor'::"public"."app_role"]) AS "has_any_role") AND
CASE
    WHEN ("company_id" IS NULL) THEN "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")
    ELSE "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")
END));



CREATE POLICY "recon_runs_delete" ON "public"."reconciliation_runs" FOR DELETE TO "authenticated" USING (false);



CREATE POLICY "recon_runs_read" ON "public"."reconciliation_runs" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") AND
CASE
    WHEN ("company_id" IS NULL) THEN "public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")
    ELSE "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")
END));



CREATE POLICY "recon_runs_update" ON "public"."reconciliation_runs" FOR UPDATE TO "authenticated" USING (false);



CREATE POLICY "recon_runs_write" ON "public"."reconciliation_runs" FOR INSERT TO "authenticated" WITH CHECK (false);



ALTER TABLE "public"."reconciliation_exceptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reconciliation_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reconciliation_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reconciliation_variance_approvals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."report_presets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "report_presets_delete" ON "public"."report_presets" FOR DELETE TO "authenticated" USING ((("auth"."uid"() IS NOT NULL) AND ((("created_by" = "auth"."uid"()) AND "public"."has_company_access"("auth"."uid"(), "company_id")) OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role"]))));



CREATE POLICY "report_presets_insert" ON "public"."report_presets" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("created_by" = "auth"."uid"()) AND ("public"."has_company_access"("auth"."uid"(), "company_id") OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role"]))));



CREATE POLICY "report_presets_select" ON "public"."report_presets" FOR SELECT TO "authenticated" USING (("public"."has_company_access"("auth"."uid"(), "company_id") OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role"])));



CREATE POLICY "report_presets_update" ON "public"."report_presets" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() IS NOT NULL) AND ((("created_by" = "auth"."uid"()) AND "public"."has_company_access"("auth"."uid"(), "company_id")) OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role"]))));



ALTER TABLE "public"."report_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "report_versions_insert" ON "public"."report_versions" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("generated_by" = "auth"."uid"()) AND ("public"."has_company_access"("auth"."uid"(), "company_id") OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role"]))));



CREATE POLICY "report_versions_modify" ON "public"."report_versions" TO "authenticated" USING ((("auth"."uid"() IS NOT NULL) AND "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role"])));



CREATE POLICY "report_versions_select" ON "public"."report_versions" FOR SELECT TO "authenticated" USING (("public"."has_company_access"("auth"."uid"(), "company_id") OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role"])));



CREATE POLICY "roles_admin_all" ON "public"."user_roles" TO "authenticated" USING ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")) WITH CHECK ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role"));



CREATE POLICY "roles_select_own" ON "public"."user_roles" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "rr_delete" ON "public"."reconciliation_results" FOR DELETE TO "authenticated" USING ("public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role"]));



CREATE POLICY "rr_insert" ON "public"."reconciliation_results" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'finance_operator'::"public"."app_role", 'maker'::"public"."app_role"]));



CREATE POLICY "rr_select" ON "public"."reconciliation_results" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'finance_operator'::"public"."app_role", 'checker'::"public"."app_role", 'approver'::"public"."app_role", 'maker'::"public"."app_role", 'operator'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") AND (( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role", 'report_viewer'::"public"."app_role", 'read_only'::"public"."app_role"]) AS "has_any_role") OR ("company_id" IS NULL) OR ("company_id" IN ( SELECT "user_company_access"."company_id"
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("company_id" IN ( SELECT "companies"."id"
   FROM "public"."companies"
  WHERE ("companies"."created_by" = ( SELECT "auth"."uid"() AS "uid")))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_company_access"
  WHERE ("user_company_access"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))))));



CREATE POLICY "rr_update" ON "public"."reconciliation_results" FOR UPDATE TO "authenticated" USING ("public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'reconciliation_officer'::"public"."app_role"])) WITH CHECK ("public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'reconciliation_officer'::"public"."app_role"]));



CREATE POLICY "rva_read" ON "public"."reconciliation_variance_approvals" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'reconciliation_officer'::"public"."app_role", 'auditor'::"public"."app_role"]) AS "has_any_role") AND "public"."has_company_access"(( SELECT "auth"."uid"() AS "uid"), "company_id")));



ALTER TABLE "public"."scheduled_reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "scheduled_reports_delete" ON "public"."scheduled_reports" FOR DELETE TO "authenticated" USING ((("auth"."uid"() IS NOT NULL) AND ((("created_by" = "auth"."uid"()) AND "public"."has_company_access"("auth"."uid"(), "company_id")) OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role"]))));



CREATE POLICY "scheduled_reports_insert" ON "public"."scheduled_reports" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("created_by" = "auth"."uid"()) AND ("public"."has_company_access"("auth"."uid"(), "company_id") OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role"]))));



CREATE POLICY "scheduled_reports_select" ON "public"."scheduled_reports" FOR SELECT TO "authenticated" USING (("public"."has_company_access"("auth"."uid"(), "company_id") OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role"])));



CREATE POLICY "scheduled_reports_update" ON "public"."scheduled_reports" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() IS NOT NULL) AND ((("created_by" = "auth"."uid"()) AND "public"."has_company_access"("auth"."uid"(), "company_id")) OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role"]))));



CREATE POLICY "ss_admin" ON "public"."system_settings" TO "authenticated" USING ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")) WITH CHECK ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role"));



CREATE POLICY "ss_read_admin" ON "public"."system_settings" FOR SELECT TO "authenticated" USING ("public"."has_role"("auth"."uid"(), 'admin'::"public"."app_role"));



ALTER TABLE "public"."system_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "uca_admin_all" ON "public"."user_company_access" TO "authenticated" USING ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role")) WITH CHECK ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role"));



CREATE POLICY "uca_select" ON "public"."user_company_access" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'auditor'::"public"."app_role"])));



CREATE POLICY "ue_delete" ON "public"."upload_errors" FOR DELETE TO "authenticated" USING ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role"));



CREATE POLICY "ue_read" ON "public"."upload_errors" FOR SELECT TO "authenticated" USING ((("upload_id" IN ( SELECT "upload_history"."id"
   FROM "public"."upload_history"
  WHERE ("upload_history"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role", 'auditor'::"public"."app_role"])));



CREATE POLICY "ue_write" ON "public"."upload_errors" FOR INSERT TO "authenticated" WITH CHECK ((("upload_id" IN ( SELECT "upload_history"."id"
   FROM "public"."upload_history"
  WHERE ("upload_history"."user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role"])));



CREATE POLICY "uh_delete" ON "public"."upload_history" FOR DELETE TO "authenticated" USING ("public"."has_role"(( SELECT "auth"."uid"() AS "uid"), 'admin'::"public"."app_role"));



CREATE POLICY "uh_read" ON "public"."upload_history" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR ("user_id" IS NULL) OR "public"."has_any_role"("auth"."uid"(), ARRAY['admin'::"public"."app_role", 'supervisor'::"public"."app_role", 'finance_operator'::"public"."app_role", 'auditor'::"public"."app_role", 'operator'::"public"."app_role", 'maker'::"public"."app_role"])));



CREATE POLICY "uh_update" ON "public"."upload_history" FOR UPDATE TO "authenticated" USING ((("user_id" IS NULL) OR ("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role"])));



CREATE POLICY "uh_write" ON "public"."upload_history" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("user_id" IS NULL) OR "public"."has_any_role"(( SELECT "auth"."uid"() AS "uid"), ARRAY['admin'::"public"."app_role", 'finance_operator'::"public"."app_role"])));



ALTER TABLE "public"."upload_errors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."upload_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_company_access" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_agm_drn_record"("p_company_id" "uuid", "p_folio_no" "text", "p_holder_name" "text", "p_total_kitta" numeric, "p_drn_no" "text", "p_drn_date" "text", "p_target_boid" "text", "p_certificate_no_start" bigint, "p_certificate_no_end" bigint, "p_distinctive_no_start" bigint, "p_distinctive_no_end" bigint, "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_agm_drn_record"("p_company_id" "uuid", "p_folio_no" "text", "p_holder_name" "text", "p_total_kitta" numeric, "p_drn_no" "text", "p_drn_date" "text", "p_target_boid" "text", "p_certificate_no_start" bigint, "p_certificate_no_end" bigint, "p_distinctive_no_start" bigint, "p_distinctive_no_end" bigint, "p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_agm_statutory_corrections"("p_company_id" "uuid", "p_corrections" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_agm_statutory_corrections"("p_company_id" "uuid", "p_corrections" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_and_record_reconciliation_batch"("p_run_info" "jsonb", "p_items" "jsonb", "p_batch_info" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_and_record_reconciliation_batch"("p_run_info" "jsonb", "p_items" "jsonb", "p_batch_info" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_and_record_reconciliation_batch"("p_run_info" "jsonb", "p_items" "jsonb", "p_batch_info" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_payable_classification_and_tax"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_payable_classification_and_tax"() TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_reconciliation_batch"("p_items" "jsonb", "p_batch_info" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_reconciliation_batch"("p_items" "jsonb", "p_batch_info" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_share_conversion_atomic"("p_company_id" "uuid", "p_conversion_type" "text", "p_fiscal_year" "text", "p_ratio" numeric, "p_client_updates" "jsonb", "p_fractional_payables" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_share_conversion_atomic"("p_company_id" "uuid", "p_conversion_type" "text", "p_fiscal_year" "text", "p_ratio" numeric, "p_client_updates" "jsonb", "p_fractional_payables" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."approve_reconciliation_variance_atomic"("p_approval_info" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_reconciliation_variance_atomic"("p_approval_info" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."approve_reconciliation_variance_atomic"("p_approval_info" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bulk_delete"("p_table" "text", "p_filters" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_delete"("p_table" "text", "p_filters" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."bulk_insert_clients"("p_clients" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_insert_clients"("p_clients" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."bulk_insert_dividend_payables"("p_payables" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_insert_dividend_payables"("p_payables" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."bulk_insert_interest_payables"("p_payables" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_insert_interest_payables"("p_payables" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."bulk_insert_mutual_fund_payables"("p_payables" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_insert_mutual_fund_payables"("p_payables" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."bulk_upsert_company"("p_company_name" "text", "p_company_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_upsert_company"("p_company_name" "text", "p_company_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."bulk_upsert_company"("p_company_name" "text", "p_company_code" "text", "p_isin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_upsert_company"("p_company_name" "text", "p_company_code" "text", "p_isin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."calc_dividend_payable_safe"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calc_dividend_payable_safe"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calc_interest_payable_safe"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calc_interest_payable_safe"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calc_net_dividend"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calc_net_dividend"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calc_net_payable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calc_net_payable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_agm_broker_pool"("p_company_id" "uuid", "p_seq_no" bigint, "p_broker_code" "text", "p_broker_name" "text", "p_pool_boid" "text", "p_claimant_boid" "text", "p_claimant_name" "text", "p_fiscal_year" "text", "p_claimed_kitta" numeric, "p_claimed_cash" numeric, "p_contract_note_no" "text", "p_trade_date_bs" "text", "p_approved_by" "text", "p_remarks" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_agm_broker_pool"("p_company_id" "uuid", "p_seq_no" bigint, "p_broker_code" "text", "p_broker_name" "text", "p_pool_boid" "text", "p_claimant_boid" "text", "p_claimant_name" "text", "p_fiscal_year" "text", "p_claimed_kitta" numeric, "p_claimed_cash" numeric, "p_contract_note_no" "text", "p_trade_date_bs" "text", "p_approved_by" "text", "p_remarks" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."clean_auth_user_tokens"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."clean_auth_user_tokens"() TO "service_role";



GRANT ALL ON FUNCTION "public"."commit_agm_fiscal_year_import"("p_company_id" "uuid", "p_fiscal_year" "text", "p_batch_id" "uuid", "p_event_name" "text", "p_report" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."commit_agm_fiscal_year_import"("p_company_id" "uuid", "p_fiscal_year" "text", "p_batch_id" "uuid", "p_event_name" "text", "p_report" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."commit_reconciliation_matches_atomic"("p_company_id" "uuid", "p_matches" "jsonb", "p_operator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."commit_reconciliation_matches_atomic"("p_company_id" "uuid", "p_matches" "jsonb", "p_operator_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."commit_staged_import"("p_approval_id" "uuid", "p_checker_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."commit_staged_import"("p_approval_id" "uuid", "p_checker_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."commit_staged_import"("p_approval_id" "uuid", "p_checker_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_payment_batch_atomic"("p_batch_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_payment_batch_atomic"("p_batch_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_payment_batch_atomic"("p_batch_name" "text", "p_company_id" "uuid", "p_fiscal_year" "text", "p_payable_type" "text", "p_payment_method" "text", "p_installment_tag" "text", "p_cds_batch_ref" "text", "p_registrar" "text", "p_max_items" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_payment_batch_atomic"("p_batch_name" "text", "p_company_id" "uuid", "p_fiscal_year" "text", "p_payable_type" "text", "p_payment_method" "text", "p_installment_tag" "text", "p_cds_batch_ref" "text", "p_registrar" "text", "p_max_items" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_reconciliation_draft_run_atomic"("p_run_info" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_reconciliation_draft_run_atomic"("p_run_info" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_reconciliation_draft_run_atomic"("p_run_info" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_company_completely"("p_company_id" "uuid", "p_delete_clients" boolean, "p_delete_orphans" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_company_completely"("p_company_id" "uuid", "p_delete_clients" boolean, "p_delete_orphans" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_orphan_clients"("p_company_id" "text", "p_fiscal_year" "text", "p_imported_after" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_orphan_clients"("p_company_id" "text", "p_fiscal_year" "text", "p_imported_after" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."disperse_agm_bulk_pools"("p_company_id" "uuid", "p_placeholder_boids" "text"[], "p_folio_records" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."disperse_agm_bulk_pools"("p_company_id" "uuid", "p_placeholder_boids" "text"[], "p_folio_records" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_interest_payable_tax_rates"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_interest_payable_tax_rates"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_agm_dividend_summary"("p_company_id" "uuid", "p_fiscal_year" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_agm_dividend_summary"("p_company_id" "uuid", "p_fiscal_year" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_agm_summary_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_agm_summary_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_agm_summary_stats"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_agm_summary_stats"("p_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_available_payables_preview"("p_company_id" "uuid", "p_payable_type" "text", "p_fiscal_year" "text", "p_from_date" "text", "p_to_date" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_available_payables_preview"("p_company_id" "uuid", "p_payable_type" "text", "p_fiscal_year" "text", "p_from_date" "text", "p_to_date" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_clients_paginated"("p_company_id" "uuid", "p_holder_type" "text", "p_classification" "text", "p_status" "text", "p_verification" "text", "p_search" "text", "p_limit" integer, "p_offset" integer, "p_needs_review" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_clients_paginated"("p_company_id" "uuid", "p_holder_type" "text", "p_classification" "text", "p_status" "text", "p_verification" "text", "p_search" "text", "p_limit" integer, "p_offset" integer, "p_needs_review" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_company_client_ids"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_company_client_ids"("p_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_company_client_stats"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_company_client_stats"("p_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_company_fiscal_summary_rpc"("p_fiscal_year" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_company_fiscal_summary_rpc"("p_fiscal_year" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_company_payable_summary"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_company_payable_summary"("p_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_cron_secret"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_cron_secret"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_declaration_summary"("p_declaration_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_declaration_summary"("p_declaration_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_distinct_fiscal_years"("p_table" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_distinct_fiscal_years"("p_table" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dividend_payables_totals"("p_company_id" "uuid", "p_status" "text", "p_fiscal_year" "text", "p_type" "text", "p_class" "text", "p_from_date" "text", "p_to_date" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dividend_payables_totals"("p_company_id" "uuid", "p_status" "text", "p_fiscal_year" "text", "p_type" "text", "p_class" "text", "p_from_date" "text", "p_to_date" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_interest_payables_totals"("p_company_id" "uuid", "p_status" "text", "p_fiscal_year" "text", "p_class" "text", "p_from_date" "text", "p_to_date" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_interest_payables_totals"("p_company_id" "uuid", "p_status" "text", "p_fiscal_year" "text", "p_class" "text", "p_from_date" "text", "p_to_date" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_mutual_fund_distribution_summary"("p_company_id" "uuid", "p_fiscal_year" "text", "p_from_date" "text", "p_to_date" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_mutual_fund_distribution_summary"("p_company_id" "uuid", "p_fiscal_year" "text", "p_from_date" "text", "p_to_date" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_mutual_fund_payables_totals"("p_company_id" "uuid", "p_status" "text", "p_fiscal_year" "text", "p_class" "text", "p_from_date" "text", "p_to_date" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_mutual_fund_payables_totals"("p_company_id" "uuid", "p_status" "text", "p_fiscal_year" "text", "p_class" "text", "p_from_date" "text", "p_to_date" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_mutual_fund_schemes_summary"("p_fiscal_year" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_mutual_fund_schemes_summary"("p_fiscal_year" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_mutual_fund_schemes_summary"("p_fiscal_year" "text") TO "anon";



REVOKE ALL ON FUNCTION "public"."get_reconciliation_runs_paginated"("p_company_id" "uuid", "p_source_type" "text", "p_status" "text", "p_search" "text", "p_limit" integer, "p_offset" integer, "p_start_date" "date", "p_end_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_reconciliation_runs_paginated"("p_company_id" "uuid", "p_source_type" "text", "p_status" "text", "p_search" "text", "p_limit" integer, "p_offset" integer, "p_start_date" "date", "p_end_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_reconciliation_runs_paginated"("p_company_id" "uuid", "p_source_type" "text", "p_status" "text", "p_search" "text", "p_limit" integer, "p_offset" integer, "p_start_date" "date", "p_end_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_any_role"("_user_id" "uuid", "_roles" "public"."app_role"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_any_role"("_user_id" "uuid", "_roles" "public"."app_role"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."has_company_access"("_user_id" "uuid", "_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_company_access"("_user_id" "uuid", "_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "service_role";



REVOKE ALL ON FUNCTION "public"."import_bank_statement_ledger_atomic"("p_import_info" "jsonb", "p_transactions" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_bank_statement_ledger_atomic"("p_import_info" "jsonb", "p_transactions" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."import_bank_statement_ledger_atomic"("p_import_info" "jsonb", "p_transactions" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_upload_progress_atomic"("p_upload_id" "uuid", "p_processed_inc" integer, "p_success_inc" integer, "p_error_inc" integer, "p_error_message" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_upload_progress_atomic"("p_upload_id" "uuid", "p_processed_inc" integer, "p_success_inc" integer, "p_error_inc" integer, "p_error_message" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_payment_batch_dispatched_atomic"("p_batch_id" "uuid", "p_dispatched_by" "uuid", "p_remarks" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_payment_batch_dispatched_atomic"("p_batch_id" "uuid", "p_dispatched_by" "uuid", "p_remarks" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mask_smtp_secrets"("j" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mask_smtp_secrets"("j" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."next_agm_broker_claim_seq"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."next_agm_broker_claim_seq"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."normalize_import_staging_rows"() FROM PUBLIC;



GRANT ALL ON FUNCTION "public"."populate_payment_batch_chunk"("p_batch_id" "uuid", "p_company_id" "uuid", "p_fiscal_year" "text", "p_payable_type" "text", "p_payment_method" "text", "p_installment_tag" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."populate_payment_batch_chunk"("p_batch_id" "uuid", "p_company_id" "uuid", "p_fiscal_year" "text", "p_payable_type" "text", "p_payment_method" "text", "p_installment_tag" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."populate_staged_interest_metadata"() FROM PUBLIC;



GRANT ALL ON FUNCTION "public"."promote_agm_clients_and_payables"("p_company_id" "uuid", "p_clients" "jsonb", "p_payables" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."promote_agm_clients_and_payables"("p_company_id" "uuid", "p_clients" "jsonb", "p_payables" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_sensitive_reveal_audit"("p_client_id" "uuid", "p_company_id" "uuid", "p_purpose" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_sensitive_reveal_audit"("p_client_id" "uuid", "p_company_id" "uuid", "p_purpose" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_sensitive_reveal_audit"("p_client_id" "uuid", "p_company_id" "uuid", "p_purpose" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_company_client_map"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_company_client_map"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reject_staged_import"("p_approval_id" "uuid", "p_rejection_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reject_staged_import"("p_approval_id" "uuid", "p_rejection_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_staged_import"("p_approval_id" "uuid", "p_rejection_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."replace_agm_fiscal_year_snapshots"("p_company_id" "uuid", "p_fiscal_year" "text", "p_incoming_boids" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."replace_agm_fiscal_year_snapshots"("p_company_id" "uuid", "p_fiscal_year" "text", "p_incoming_boids" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."require_role"(VARIADIC "_roles" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."require_role"(VARIADIC "_roles" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."require_role"(VARIADIC "_roles" "public"."app_role"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."require_role"(VARIADIC "_roles" "public"."app_role"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."revert_payment_batch_atomic"("p_batch_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."revert_payment_batch_atomic"("p_batch_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."revert_payment_batch_atomic"("p_batch_id" "uuid", "p_user_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."revert_payment_batch_atomic"("p_batch_id" "uuid", "p_user_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."revert_reconciliation_lot_atomic"("p_result_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revert_reconciliation_lot_atomic"("p_result_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."revert_reconciliation_lot_atomic"("p_result_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."revert_reconciliation_lot_atomic"("p_company_id" "uuid", "p_fiscal_year" "text", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."revert_reconciliation_lot_atomic"("p_company_id" "uuid", "p_fiscal_year" "text", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."revert_reconciliation_run_atomic"("p_run_id" "uuid", "p_force" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revert_reconciliation_run_atomic"("p_run_id" "uuid", "p_force" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."revert_reconciliation_run_atomic"("p_run_id" "uuid", "p_force" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rollback_upload_atomic"("p_upload_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rollback_upload_atomic"("p_upload_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rollback_upload_atomic"("p_upload_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rollback_upload_file_atomic"("p_file_hash" "text", "p_file_name" "text", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rollback_upload_file_atomic"("p_file_hash" "text", "p_file_name" "text", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rollback_upload_file_atomic"("p_file_hash" "text", "p_file_name" "text", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_reconciliation_draft_results_atomic"("p_run_info" "jsonb", "p_results" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_reconciliation_draft_results_atomic"("p_run_info" "jsonb", "p_results" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_reconciliation_draft_results_atomic"("p_run_info" "jsonb", "p_results" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."save_system_settings_global"("p_settings" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_system_settings_global"("p_settings" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."search_payments_paginated"("p_search_term" "text", "p_company_id" "uuid", "p_status" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_approval_log_actor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_approval_log_actor"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_audit_log_actor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_audit_log_actor"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_payment_log_actor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_payment_log_actor"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_upload_user_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_upload_user_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_all_classifications_and_taxes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_all_classifications_and_taxes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_client_payee_classification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_client_payee_classification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_clients_bonus_holdings"("p_company_id" "uuid", "p_fiscal_year" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_clients_bonus_holdings"("p_company_id" "uuid", "p_fiscal_year" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_payables_on_client_classification_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_payables_on_client_classification_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_clients_set_needs_review"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_clients_set_needs_review"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_companies_generic_defaults"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_companies_generic_defaults"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_fn_sync_payment_batch_completion"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fn_sync_payment_batch_completion"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trigger_process_scheduled_reports"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trigger_process_scheduled_reports"() TO "service_role";
GRANT ALL ON FUNCTION "public"."trigger_process_scheduled_reports"() TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."agm_broker_claims" TO "anon";
GRANT ALL ON TABLE "public"."agm_broker_claims" TO "authenticated";
GRANT ALL ON TABLE "public"."agm_broker_claims" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."agm_broker_pools" TO "anon";
GRANT ALL ON TABLE "public"."agm_broker_pools" TO "authenticated";
GRANT ALL ON TABLE "public"."agm_broker_pools" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."agm_drn_records" TO "anon";
GRANT ALL ON TABLE "public"."agm_drn_records" TO "authenticated";
GRANT ALL ON TABLE "public"."agm_drn_records" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."agm_fiscal_year_meta" TO "anon";
GRANT ALL ON TABLE "public"."agm_fiscal_year_meta" TO "authenticated";
GRANT ALL ON TABLE "public"."agm_fiscal_year_meta" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."agm_historical_shareholders" TO "anon";
GRANT ALL ON TABLE "public"."agm_historical_shareholders" TO "authenticated";
GRANT ALL ON TABLE "public"."agm_historical_shareholders" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."agm_import_staging" TO "anon";
GRANT ALL ON TABLE "public"."agm_import_staging" TO "authenticated";
GRANT ALL ON TABLE "public"."agm_import_staging" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."agm_yearly_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."agm_yearly_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."agm_yearly_snapshots" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."api_logs" TO "anon";
GRANT ALL ON TABLE "public"."api_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."api_logs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."approval_logs" TO "anon";
GRANT ALL ON TABLE "public"."approval_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."approval_logs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bank_statement_imports" TO "anon";
GRANT ALL ON TABLE "public"."bank_statement_imports" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_statement_imports" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bank_statement_transactions" TO "anon";
GRANT ALL ON TABLE "public"."bank_statement_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_statement_transactions" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bank_statements" TO "anon";
GRANT ALL ON TABLE "public"."bank_statements" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_statements" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bank_transactions" TO "anon";
GRANT ALL ON TABLE "public"."bank_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_transactions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."classification_decision_history" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."classification_decision_history" TO "authenticated";
GRANT ALL ON TABLE "public"."classification_decision_history" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."companies" TO "anon";
GRANT ALL ON TABLE "public"."companies" TO "authenticated";
GRANT ALL ON TABLE "public"."companies" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."dividend_payables" TO "anon";
GRANT ALL ON TABLE "public"."dividend_payables" TO "authenticated";
GRANT ALL ON TABLE "public"."dividend_payables" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."interest_payables" TO "anon";
GRANT ALL ON TABLE "public"."interest_payables" TO "authenticated";
GRANT ALL ON TABLE "public"."interest_payables" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."mutual_fund_payables" TO "anon";
GRANT ALL ON TABLE "public"."mutual_fund_payables" TO "authenticated";
GRANT ALL ON TABLE "public"."mutual_fund_payables" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."company_client_map" TO "anon";
GRANT ALL ON TABLE "public"."company_client_map" TO "authenticated";
GRANT ALL ON TABLE "public"."company_client_map" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."corporate_declarations" TO "anon";
GRANT ALL ON TABLE "public"."corporate_declarations" TO "authenticated";
GRANT ALL ON TABLE "public"."corporate_declarations" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."error_logs" TO "anon";
GRANT ALL ON TABLE "public"."error_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."error_logs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."fiscal_years" TO "anon";
GRANT ALL ON TABLE "public"."fiscal_years" TO "authenticated";
GRANT ALL ON TABLE "public"."fiscal_years" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."iaf_allocations" TO "anon";
GRANT ALL ON TABLE "public"."iaf_allocations" TO "authenticated";
GRANT ALL ON TABLE "public"."iaf_allocations" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."import_staging" TO "anon";
GRANT ALL ON TABLE "public"."import_staging" TO "authenticated";
GRANT ALL ON TABLE "public"."import_staging" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."login_logs" TO "anon";
GRANT ALL ON TABLE "public"."login_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."login_logs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."notification_configs" TO "anon";
GRANT ALL ON TABLE "public"."notification_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_configs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payable_classification_summary" TO "anon";
GRANT ALL ON TABLE "public"."payable_classification_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."payable_classification_summary" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payable_tax_rules" TO "anon";
GRANT ALL ON TABLE "public"."payable_tax_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."payable_tax_rules" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payable_tds_rate_drift" TO "anon";
GRANT ALL ON TABLE "public"."payable_tds_rate_drift" TO "authenticated";
GRANT ALL ON TABLE "public"."payable_tds_rate_drift" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_batches" TO "anon";
GRANT ALL ON TABLE "public"."payment_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_batches" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_logs" TO "anon";
GRANT ALL ON TABLE "public"."payment_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_logs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pending_approvals" TO "anon";
GRANT ALL ON TABLE "public"."pending_approvals" TO "authenticated";
GRANT ALL ON TABLE "public"."pending_approvals" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."reconciliation_exceptions" TO "anon";
GRANT ALL ON TABLE "public"."reconciliation_exceptions" TO "authenticated";
GRANT ALL ON TABLE "public"."reconciliation_exceptions" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."reconciliation_results" TO "anon";
GRANT ALL ON TABLE "public"."reconciliation_results" TO "authenticated";
GRANT ALL ON TABLE "public"."reconciliation_results" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."reconciliation_lots" TO "anon";
GRANT ALL ON TABLE "public"."reconciliation_lots" TO "authenticated";
GRANT ALL ON TABLE "public"."reconciliation_lots" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."reconciliation_runs" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."reconciliation_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."reconciliation_runs" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."reconciliation_variance_approvals" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."reconciliation_variance_approvals" TO "authenticated";
GRANT ALL ON TABLE "public"."reconciliation_variance_approvals" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."report_presets" TO "anon";
GRANT ALL ON TABLE "public"."report_presets" TO "authenticated";
GRANT ALL ON TABLE "public"."report_presets" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."report_versions" TO "anon";
GRANT ALL ON TABLE "public"."report_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."report_versions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."scheduled_reports" TO "anon";
GRANT ALL ON TABLE "public"."scheduled_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."scheduled_reports" TO "service_role";



GRANT SELECT,UPDATE ON SEQUENCE "public"."seq_agm_broker_claim_no" TO "anon";
GRANT ALL ON SEQUENCE "public"."seq_agm_broker_claim_no" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seq_agm_broker_claim_no" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."system_settings" TO "anon";
GRANT ALL ON TABLE "public"."system_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."system_settings" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."system_settings_safe" TO "anon";
GRANT ALL ON TABLE "public"."system_settings_safe" TO "authenticated";
GRANT ALL ON TABLE "public"."system_settings_safe" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."upload_errors" TO "anon";
GRANT ALL ON TABLE "public"."upload_errors" TO "authenticated";
GRANT ALL ON TABLE "public"."upload_errors" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."upload_history" TO "anon";
GRANT ALL ON TABLE "public"."upload_history" TO "authenticated";
GRANT ALL ON TABLE "public"."upload_history" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."upload_logs" TO "anon";
GRANT ALL ON TABLE "public"."upload_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."upload_logs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_company_access" TO "anon";
GRANT ALL ON TABLE "public"."user_company_access" TO "authenticated";
GRANT ALL ON TABLE "public"."user_company_access" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";

-- -----------------------------------------------------------------------------
-- Initial Materialized View Population & Storage Buckets
-- -----------------------------------------------------------------------------
REFRESH MATERIALIZED VIEW public.company_client_map;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'reports',
    'reports',
    false,
    52428800,
    NULL
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'authenticated_reports_access'
    ) THEN
        CREATE POLICY authenticated_reports_access ON storage.objects
            FOR SELECT TO authenticated
            USING (
                bucket_id = 'reports'
                AND (
                    public.has_company_access(auth.uid(), (storage.foldername(name))[1]::uuid)
                    OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'authenticated_reports_insert'
    ) THEN
        CREATE POLICY authenticated_reports_insert ON storage.objects
            FOR INSERT TO authenticated
            WITH CHECK (
                bucket_id = 'reports'
                AND (
                    public.has_company_access(auth.uid(), (storage.foldername(name))[1]::uuid)
                    OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
                )
            );
    END IF;
END $$;








