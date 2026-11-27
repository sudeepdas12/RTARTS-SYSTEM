-- =============================================================================
-- Migration: Ensure unique payment_reference per reconciliation payment record
-- =============================================================================
-- Fixes SQLSTATE 23505 (uq_active_payments_reference) when applying multi-row
-- reconciliation batches where payment_reference / reference_id was omitted or
-- shared across rows (falling back to non-unique 'RECON-' || run_id prefix).
-- =============================================================================

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
      v_payable_id     := NULLIF(v_item->>'payable_id', '')::uuid;
      v_client_id      := NULLIF(v_item->>'client_id', '')::uuid;
      v_target_table   := LOWER(COALESCE(NULLIF(v_item->>'target_table', ''), NULLIF(v_item->>'payable_type', ''), 'dividend'));
      v_result         := UPPER(COALESCE(NULLIF(v_item->>'reconciliation_result', ''), NULLIF(v_item->>'result', ''), 'MATCHED'));
      v_actual_amt     := COALESCE(NULLIF(v_item->>'actual_amount', '')::numeric, 0);
      v_expected_amt   := COALESCE(NULLIF(v_item->>'expected_amount', '')::numeric, 0);
      v_diff           := COALESCE(NULLIF(v_item->>'difference', '')::numeric, v_actual_amt - v_expected_amt);
      v_instruction_id := COALESCE(NULLIF(v_item->>'instruction_id', ''), NULLIF(v_item->>'connectips_ref', ''));
      v_payment_ref    := COALESCE(
        NULLIF(v_item->>'payment_reference', ''),
        NULLIF(v_item->>'reference_id', ''),
        v_instruction_id,
        'RECON-' || substr(COALESCE(v_run_id::text, gen_random_uuid()::text), 1, 8) || '-' || substr(COALESCE(v_payable_id::text, gen_random_uuid()::text), 1, 8)
      );
      v_match_method   := COALESCE(NULLIF(v_item->>'match_method', ''), 'instruction_id');
      v_confidence     := COALESCE(NULLIF(v_item->>'match_confidence', '')::numeric, 80);
      v_rule_ver       := COALESCE(NULLIF(v_item->>'rule_version', ''), '2.0.0');
      v_notes          := NULLIF(v_item->>'notes', '');

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

      -- Server-side Maker-Checker Variance Approval Check
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
          IF v_approval_record.company_id != v_company_id OR
             v_approval_record.variance_type != v_result OR
             ABS(COALESCE(v_approval_record.expected_amount, 0) - v_expected_amt) > 0.005 OR
             ABS(COALESCE(v_approval_record.actual_amount, 0) - v_actual_amt) > 0.005 OR
             ABS(COALESCE(v_approval_record.variance_amount, 0) - ABS(v_actual_amt - v_expected_amt)) > 0.005 THEN
            v_requires_approval := true;
            v_notes := COALESCE(v_notes || '; ', '') || 'Variance approval invalid: approval amounts or metadata do not match current transaction';
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
          v_notes := COALESCE(v_notes || '; ', '') || 'Settlement rejected: actual payment amount must be strictly positive';
          v_result := 'EXCEPTION';
          v_result_enum := 'Exception'::public.reconciliation_result;
          v_payment_id := NULL;
        ELSIF v_old_payment_status = 'Paid' THEN
          v_already_paid := v_already_paid + 1;
          v_notes := COALESCE(v_notes || '; ', '') || 'Payable already Paid prior to reconciliation run';
          v_payment_id := NULL;
        ELSE
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
            v_applied_payable_amt := CASE 
              WHEN v_expected_amt > 0 THEN LEAST(v_expected_amt, v_paid_amt) 
              ELSE v_paid_amt 
            END;

            -- Ensure payment_reference cannot collide with another active row under uq_active_payments_reference
            IF v_payment_ref IS NOT NULL AND v_payment_ref <> '' AND EXISTS (
              SELECT 1 FROM public.payments p
              WHERE p.payment_reference = v_payment_ref
                AND p.status NOT IN ('Failed', 'Reversed', 'Cancelled')
                AND (p.reconciliation_run_id IS DISTINCT FROM v_run_id OR p.payable_id IS DISTINCT FROM v_payable_id)
            ) THEN
              v_payment_ref := v_payment_ref || '-' || substr(COALESCE(v_payable_id::text, gen_random_uuid()::text), 1, 8);
            END IF;

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

      GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
      v_results_inserted := v_results_inserted + v_rows_affected;

      IF v_result = 'REJECTED' THEN
        v_rejected_count := v_rejected_count + 1;
      ELSIF v_result IN ('PARTIAL', 'UNDER_PAID') OR (v_target_table = 'mutual_fund' AND v_paid_amt < v_expected_amt AND v_paid_amt > 0) THEN
        v_partial_count := v_partial_count + 1;
      END IF;

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
      RAISE EXCEPTION 'Atomic reconciliation batch failed at record (payable_id: %, source_ref: %): % (SQLSTATE: %)',
        v_item->>'payable_id', v_source_reference, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  -- 5. Update run stats cumulatively from accepted items
  -- matched_count includes both newly settled payables and idempotently matched already-paid records
  UPDATE public.reconciliation_runs
  SET matched_count = COALESCE(matched_count, 0) + v_payables_updated + v_already_paid,
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
