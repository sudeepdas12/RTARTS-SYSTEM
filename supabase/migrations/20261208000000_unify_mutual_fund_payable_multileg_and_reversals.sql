-- ============================================================================
-- Migration: 20261208000000_unify_mutual_fund_payable_multileg_and_reversals.sql
-- Description:
-- 1. Hardens complete_payment_batch_atomic to update paid_amount and remaining_amount
--    on mutual_fund_payables, bringing it into full parity with dividends and interest.
-- 2. Hardens revert_payment_batch_atomic and revert_reconciliation_lot_atomic to
--    reset paid_amount to 0 and remaining_amount to net_payable for mutual_fund_payables.
-- 3. Hardens apply_reconciliation_batch to:
--    a) Maintain incremental paid_amount and remaining_amount for mutual_fund_payables.
--    b) Absorb recognized standard NCHL ConnectIPS bank charges (NPR 2, 8, 15) so that
--       payables properly transition to 'Paid' instead of remaining stranded in 'Partial'.
-- 4. Grants execute permissions to authenticated, service_role, and anon.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. complete_payment_batch_atomic
-- ============================================================================
DROP FUNCTION IF EXISTS public.complete_payment_batch_atomic(uuid, uuid);

CREATE OR REPLACE FUNCTION public.complete_payment_batch_atomic(
  p_batch_id uuid,
  p_user_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION public.complete_payment_batch_atomic(uuid, uuid) TO authenticated, service_role, anon;


-- ============================================================================
-- 2. revert_payment_batch_atomic
-- ============================================================================
DROP FUNCTION IF EXISTS public.revert_payment_batch_atomic(uuid, uuid);

CREATE OR REPLACE FUNCTION public.revert_payment_batch_atomic(
  p_batch_id uuid,
  p_user_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION public.revert_payment_batch_atomic(uuid, uuid) TO authenticated, service_role, anon;


-- ============================================================================
-- 3. revert_reconciliation_lot_atomic
-- ============================================================================
DROP FUNCTION IF EXISTS public.revert_reconciliation_lot_atomic(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.revert_reconciliation_lot_atomic(
  p_company_id uuid,
  p_fiscal_year text,
  p_user_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION public.revert_reconciliation_lot_atomic(uuid, text, uuid) TO authenticated, service_role, anon;


-- ============================================================================
-- 4. apply_reconciliation_batch
-- ============================================================================
DROP FUNCTION IF EXISTS public.apply_reconciliation_batch(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.apply_reconciliation_batch(jsonb);

CREATE OR REPLACE FUNCTION public.apply_reconciliation_batch(
  p_items jsonb,
  p_batch_info jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
  v_remaining numeric;
BEGIN
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
$function$;

GRANT EXECUTE ON FUNCTION public.apply_reconciliation_batch(jsonb, jsonb) TO authenticated, service_role, anon;

COMMIT;
