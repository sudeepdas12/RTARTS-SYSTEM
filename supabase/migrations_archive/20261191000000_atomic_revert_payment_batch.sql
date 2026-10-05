-- ============================================================================
-- Migration: 20261191000000_atomic_revert_payment_batch.sql
-- Description:
-- Adds atomic revert_payment_batch_atomic function to safely rollback
-- payment batches and their associated payables within a single database transaction.
-- ============================================================================

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
      SET payment_status = 'Pending',
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
      SET payment_status = 'Pending',
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
      SET payment_status = 'Pending',
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
      'batch_id', p_batch_id,
      'batch_name', v_batch.batch_name,
      'reverted_payables', v_reverted_payables,
      'deleted_payments', v_payments_deleted,
      'reason', COALESCE(p_reason, 'Manual batch revert')
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'reverted_payables', v_reverted_payables,
    'deleted_payments', v_payments_deleted
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.revert_payment_batch_atomic(uuid, uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.revert_payment_batch_atomic(uuid, uuid, text) TO authenticated, service_role;
