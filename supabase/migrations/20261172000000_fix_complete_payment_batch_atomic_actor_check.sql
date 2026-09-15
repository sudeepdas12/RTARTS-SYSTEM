-- Migration: 20261172000000_fix_complete_payment_batch_atomic_actor_check.sql
-- Description: In complete_payment_batch_atomic, verify company access against the resolved actor
-- (COALESCE(auth.uid(), p_user_id)) when called under service_role or authenticated sessions.

CREATE OR REPLACE FUNCTION public.complete_payment_batch_atomic(p_batch_id uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS json
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
  -- (If invoked under service_role without a restricted user, service_role has global access)
  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND v_batch.company_id IS NOT NULL THEN
    IF v_actor_id IS NOT NULL THEN
      IF NOT public.has_company_access(v_actor_id, v_batch.company_id) THEN
        RAISE EXCEPTION 'Unauthorized: caller lacks access to company % for payment batch %', v_batch.company_id, p_batch_id USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'Unauthorized: caller identification required' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 3. Update payment batch status
  UPDATE public.payment_batches
  SET
    status = 'Completed',
    processed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_batch_id;

  -- 4. Update all payments in this batch
  WITH updated_payments AS (
    UPDATE public.payments
    SET
      status = 'Completed',
      payment_date = v_today,
      updated_at = NOW()
    WHERE batch_id = p_batch_id
      AND status != 'Completed'
    RETURNING id, payable_id, payable_type
  )
  SELECT count(*) INTO v_payments_updated FROM updated_payments;

  -- 5. Update dividend_payables
  WITH div_matches AS (
    UPDATE public.dividend_payables dp
    SET
      payment_status = 'Paid',
      payment_date = v_today,
      updated_at = NOW()
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.payable_type IN ('dividend', 'dividend_payables')
      AND dp.id = p.payable_id
    RETURNING dp.id
  )
  SELECT count(*) INTO v_div_updated FROM div_matches;

  -- 6. Update interest_payables
  WITH int_matches AS (
    UPDATE public.interest_payables ip
    SET
      payment_status = 'Paid',
      payment_date = v_today,
      updated_at = NOW()
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.payable_type IN ('interest', 'interest_payables')
      AND ip.id = p.payable_id
    RETURNING ip.id
  )
  SELECT count(*) INTO v_int_updated FROM int_matches;

  -- 7. Update mutual_fund_payables
  WITH mf_matches AS (
    UPDATE public.mutual_fund_payables mp
    SET
      payment_status = 'Paid',
      payment_date = v_today,
      updated_at = NOW()
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.payable_type IN ('mutual_fund', 'mutual_fund_payables')
      AND mp.id = p.payable_id
    RETURNING mp.id
  )
  SELECT count(*) INTO v_mf_updated FROM mf_matches;

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
