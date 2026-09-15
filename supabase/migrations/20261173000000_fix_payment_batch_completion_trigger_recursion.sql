-- Migration: 20261173000000_fix_payment_batch_completion_trigger_recursion.sql
-- Description:
-- 1. In complete_payment_batch_atomic, execute payments and payables updates BEFORE updating payment_batches.
-- 2. Use a transaction-local session variable (rtarts.completing_batch) to prevent
--    trg_fn_sync_payment_batch_completion from firing recursively and causing duplicate executions or audit logs.

BEGIN;

-- 1. Guard the trigger against recursion using transaction-scoped setting
CREATE OR REPLACE FUNCTION public.trg_fn_sync_payment_batch_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
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

-- 2. Harden complete_payment_batch_atomic with correct operational sequence and re-entrancy guard
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

  -- 3. Update all payments in this batch FIRST (capturing counts and transitioning to Completed)
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

  -- 4. Update dividend_payables (supporting both logical 'dividend' and physical 'dividend_payables')
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

  -- 5. Update interest_payables (supporting both logical 'interest' and physical 'interest_payables')
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

  -- 6. Update mutual_fund_payables (supporting both logical 'mutual_fund' and physical 'mutual_fund_payables')
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

COMMIT;
