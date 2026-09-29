-- ============================================================================
-- Migration: 20261188000000_harden_payment_batch_completion_and_revert.sql
-- Description:
-- 1. In complete_payment_batch_atomic:
--    - Explicitly exclude payments that are 'Failed', 'Rejected', 'Reversed',
--      or 'Cancelled' from being forcefully transitioned to 'Completed'.
--    - Only update payables to 'Paid' for payments that are actually 'Completed'.
-- 2. In revert_reconciliation_lot_atomic:
--    - Accurately count reverted payables using RETURNING id.
--    - Clean up empty 'RECON-APPLY' auto-reconciliation payment batches.
-- ============================================================================

-- 1. Harden complete_payment_batch_atomic
CREATE OR REPLACE FUNCTION public.complete_payment_batch_atomic(p_batch_id uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch record;
  v_payments_updated bigint := 0;
  v_div_updated bigint := 0;
  v_int_updated bigint := 0;
  v_mf_updated bigint := 0;
  v_today date := CURRENT_DATE;
  v_actor_id uuid;
  v_jwt_role text;
BEGIN
  -- Set transaction-local flag so triggers don't recursively re-execute
  PERFORM set_config('rtarts.completing_batch', 'true', true);

  -- Extract caller JWT role
  BEGIN
    v_jwt_role := (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  -- Enforce caller role: service_role or admin/supervisor/finance_operator/approver
  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND current_user != 'postgres' THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'approver');
  END IF;

  v_actor_id := COALESCE(auth.uid(), p_user_id);

  -- 1. Fetch and lock batch record
  SELECT * INTO v_batch
  FROM public.payment_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment batch with id % not found', p_batch_id;
  END IF;

  -- 2. Verify caller has access to the batch's company
  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND v_batch.company_id IS NOT NULL THEN
    IF v_actor_id IS NOT NULL THEN
      IF NOT public.has_company_access(v_actor_id, v_batch.company_id) THEN
        RAISE EXCEPTION 'Unauthorized: caller lacks access to company % for payment batch %', v_batch.company_id, p_batch_id USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'Unauthorized: caller identification required' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 3. Update pending payments in this batch (EXCLUDING Failed, Rejected, Reversed, Cancelled)
  WITH updated_payments AS (
    UPDATE public.payments
    SET
      status = 'Completed',
      payment_date = v_today,
      updated_at = NOW()
    WHERE batch_id = p_batch_id
      AND status NOT IN ('Completed', 'Failed', 'Rejected', 'Reversed', 'Cancelled')
    RETURNING id, payable_id, payable_type
  )
  SELECT count(*) INTO v_payments_updated FROM updated_payments;

  -- 4. Update dividend_payables (ONLY for Completed payments)
  WITH div_matches AS (
    UPDATE public.dividend_payables dp
    SET
      payment_status = 'Paid',
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

  -- 5. Update interest_payables (ONLY for Completed payments)
  WITH int_matches AS (
    UPDATE public.interest_payables ip
    SET
      payment_status = 'Paid',
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

  -- 6. Update mutual_fund_payables (ONLY for Completed payments)
  WITH mf_matches AS (
    UPDATE public.mutual_fund_payables mp
    SET
      payment_status = 'Paid',
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

  -- 7. Update payment batch status to Completed LAST
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


-- 2. Harden revert_reconciliation_lot_atomic with accurate counts and orphan batch pruning
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
      SET payment_status = 'Pending', payment_date = NULL, payment_reference = NULL, updated_at = now()
      WHERE id = ANY(v_div_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_div_count FROM upd;
    v_reverted_payables := v_reverted_payables + v_div_count;
  END IF;

  IF array_length(v_int_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE public.interest_payables
      SET payment_status = 'Pending', payment_date = NULL, payment_reference = NULL, updated_at = now()
      WHERE id = ANY(v_int_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_int_count FROM upd;
    v_reverted_payables := v_reverted_payables + v_int_count;
  END IF;

  IF array_length(v_mf_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE public.mutual_fund_payables
      SET payment_status = 'Pending', payment_date = NULL, payment_reference = NULL, updated_at = now()
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
