-- ============================================================================
-- Migration: 20261194000000_support_multileg_installment_payments.sql
-- Description:
-- 1. Updates uq_active_payments_payable_id partial unique index to only
--    constrain in-flight statuses ('Draft', 'Pending', 'Approved').
--    This allows completed installment payments to coexist with future installment batches.
-- 2. Hardens complete_payment_batch_atomic to update paid_amount and remaining_amount
--    on dividend_payables and interest_payables, correctly setting 'Paid' vs 'Partial'.
-- 3. Hardens revert_payment_batch_atomic and revert_reconciliation_lot_atomic
--    to reset paid_amount to 0 and remaining_amount to net_payable on revert.
-- ============================================================================

-- 1. Double-payment prevention constraint: only lock unfinalized in-flight payments
DROP INDEX IF EXISTS public.uq_active_payments_payable_id;
CREATE UNIQUE INDEX uq_active_payments_payable_id ON public.payments (payable_id)
WHERE (status IN ('Draft', 'Pending', 'Approved') AND payable_id IS NOT NULL);

DROP INDEX IF EXISTS public.idx_payments_payable_active_lookup;
CREATE INDEX idx_payments_payable_active_lookup ON public.payments (payable_id, status)
WHERE (status IN ('Draft', 'Pending', 'Approved'));

-- 2. Update complete_payment_batch_atomic
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

  -- 6. Update mutual_fund_payables
  WITH mf_matches AS (
    UPDATE public.mutual_fund_payables mp
    SET
      payment_status = 'Paid'::public.payment_status,
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
      'mutual_fund_updated', v_mf_updated
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

REVOKE ALL ON FUNCTION public.complete_payment_batch_atomic(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.complete_payment_batch_atomic(uuid, uuid) TO authenticated, service_role;


-- 3. Update revert_payment_batch_atomic
CREATE OR REPLACE FUNCTION public.revert_payment_batch_atomic(
  p_batch_id uuid,
  p_user_id uuid DEFAULT NULL::uuid,
  p_reason text DEFAULT NULL::text
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
$function$;

REVOKE ALL ON FUNCTION public.revert_payment_batch_atomic(uuid, uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.revert_payment_batch_atomic(uuid, uuid, text) TO authenticated, service_role;


-- 4. Update revert_reconciliation_lot_atomic
CREATE OR REPLACE FUNCTION public.revert_reconciliation_lot_atomic(
  p_result_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.revert_reconciliation_lot_atomic(uuid[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.revert_reconciliation_lot_atomic(uuid[]) TO authenticated, service_role;
