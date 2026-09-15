-- Migration: 20261169000000_harden_payment_approver_and_atomic_conversion.sql
-- Description:
-- 1. Add 'approver' to require_role in complete_payment_batch_atomic so approver role can complete payment workflows.
-- 2. Create atomic stored procedure apply_share_conversion_atomic for corporate action share conversions (promoter-to-public, splits, mergers, debenture-to-equity, physical-to-demat).

-- ----------------------------------------------------------------------------
-- 1. Update complete_payment_batch_atomic to allow approver role
-- ----------------------------------------------------------------------------

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
BEGIN
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'approver');
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
  IF current_user != 'service_role' AND v_batch.company_id IS NOT NULL THEN
    IF NOT public.has_company_access(auth.uid(), v_batch.company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to company % for payment batch %', v_batch.company_id, p_batch_id USING ERRCODE = '42501';
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

-- ----------------------------------------------------------------------------
-- 2. Create apply_share_conversion_atomic RPC
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_share_conversion_atomic(
  p_company_id uuid,
  p_conversion_type text,
  p_fiscal_year text,
  p_ratio numeric,
  p_client_updates jsonb,
  p_fractional_payables jsonb DEFAULT '[]'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        holder_type = COALESCE(v_update.holder_type, holder_type),
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
      COALESCE(x->>'dividend_type', p_conversion_type || ' Fraction Cash'),
      COALESCE((x->>'shares_held')::numeric, 0),
      COALESCE((x->>'dividend_rate')::numeric, p_ratio),
      COALESCE((x->>'gross_dividend')::numeric, 0),
      COALESCE((x->>'tax_amount')::numeric, 0),
      COALESCE((x->>'net_payable')::numeric, 0),
      'Pending'::public.payment_status,
      x->>'bank_name',
      x->>'bank_account_no',
      x->>'remarks',
      NOW(),
      NOW()
    FROM jsonb_array_elements(p_fractional_payables) AS x;
    
    GET DIAGNOSTICS v_payables_inserted = ROW_COUNT;
  END IF;

  -- 3. Record audit log
  INSERT INTO public.audit_logs (
    company_id,
    user_id,
    action,
    table_name,
    record_id,
    metadata
  ) VALUES (
    p_company_id,
    v_uid,
    'SHARE_CONVERSION',
    'clients',
    p_company_id,
    jsonb_build_object(
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
$function$;

REVOKE ALL ON FUNCTION public.apply_share_conversion_atomic(uuid, text, text, numeric, jsonb, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.apply_share_conversion_atomic(uuid, text, text, numeric, jsonb, jsonb) TO authenticated, service_role;
