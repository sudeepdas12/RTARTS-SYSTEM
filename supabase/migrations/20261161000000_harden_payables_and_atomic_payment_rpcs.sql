-- Migration: Harden Payables Unique Constraints and Fix Atomic Payment & Reconciliation RPCs

BEGIN;

-- 1. Unique Constraints on interest_payables and mutual_fund_payables for complete multi-year idempotency
CREATE UNIQUE INDEX IF NOT EXISTS uq_interest_payables_client_fy_remarks
ON public.interest_payables (client_id, company_id, fiscal_year, COALESCE(remarks, ''));

CREATE UNIQUE INDEX IF NOT EXISTS uq_mutual_fund_payables_client_fy_remarks
ON public.mutual_fund_payables (client_id, company_id, fiscal_year, COALESCE(remarks, ''));

-- 2. Fix complete_payment_batch_atomic RPC audit_logs column mapping
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
  -- Enforce caller role: admin, supervisor, or finance_operator
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator');
  v_actor_id := COALESCE(auth.uid(), p_user_id);

  -- 1. Fetch and lock batch record
  SELECT * INTO v_batch
  FROM public.payment_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment batch with id % not found', p_batch_id;
  END IF;

  -- 2. Update payment batch status
  UPDATE public.payment_batches
  SET
    status = 'Completed',
    processed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_batch_id;

  -- 3. Update all payments in this batch
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
  SELECT COUNT(*) INTO v_payments_updated FROM updated_payments;

  -- 4. Cascade to underlying dividend payables
  WITH target_divs AS (
    SELECT DISTINCT p.payable_id
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.payable_type = 'dividend'
      AND p.payable_id IS NOT NULL
  ),
  updated_divs AS (
    UPDATE public.dividend_payables dp
    SET
      payment_status = 'Paid',
      payment_date = v_today,
      updated_at = NOW()
    FROM target_divs td
    WHERE dp.id = td.payable_id
    RETURNING dp.id
  )
  SELECT COUNT(*) INTO v_div_updated FROM updated_divs;

  -- 5. Cascade to underlying interest payables
  WITH target_ints AS (
    SELECT DISTINCT p.payable_id
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.payable_type = 'interest'
      AND p.payable_id IS NOT NULL
  ),
  updated_ints AS (
    UPDATE public.interest_payables ip
    SET
      payment_status = 'Paid',
      payment_date = v_today,
      updated_at = NOW()
    FROM target_ints ti
    WHERE ip.id = ti.payable_id
    RETURNING ip.id
  )
  SELECT COUNT(*) INTO v_int_updated FROM updated_ints;

  -- 6. Cascade to underlying mutual fund payables
  WITH target_mfs AS (
    SELECT DISTINCT p.payable_id
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.payable_type = 'mutual_fund'
      AND p.payable_id IS NOT NULL
  ),
  updated_mfs AS (
    UPDATE public.mutual_fund_payables mp
    SET
      payment_status = 'Paid',
      payment_date = v_today,
      updated_at = NOW()
    FROM target_mfs tm
    WHERE mp.id = tm.payable_id
    RETURNING mp.id
  )
  SELECT COUNT(*) INTO v_mf_updated FROM updated_mfs;

  -- 7. Audit log record using accurate audit_logs table schema
  INSERT INTO public.audit_logs (
    user_id,
    action,
    table_name,
    record_id,
    new_value,
    action_time
  ) VALUES (
    v_actor_id,
    'BATCH_COMPLETED_ATOMIC',
    'payment_batches',
    p_batch_id::text,
    jsonb_build_object(
      'batch_id', p_batch_id,
      'payments_completed', v_payments_updated,
      'dividend_payables_updated', v_div_updated,
      'interest_payables_updated', v_int_updated,
      'mutual_fund_payables_updated', v_mf_updated
    ),
    NOW()
  );

  RETURN json_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'payments_completed', v_payments_updated,
    'dividend_payables_updated', v_div_updated,
    'interest_payables_updated', v_int_updated,
    'mutual_fund_payables_updated', v_mf_updated
  );
END;
$function$;

-- 3. Fix apply_reconciliation_batch RPC column and enum mappings
CREATE OR REPLACE FUNCTION public.apply_reconciliation_batch(p_items jsonb, p_batch_info jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_item jsonb;
  v_batch_id uuid;
  v_company_id uuid;
  v_payable_id uuid;
  v_payment_id uuid;
  v_payable_type text;
  v_target_table text;
  v_actual_amt numeric;
  v_expected_amt numeric;
  v_paid_amt numeric;
  v_result text;
  v_new_status public.payment_status;
  v_payment_ref text;
  v_payment_method public.payment_method;
  v_updated int := 0;
  v_payments_created int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  -- Enforce caller role: admin, supervisor, finance_operator, or reconciliation_officer
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');
  v_uid := auth.uid();

  -- Normalize payment method to enum
  v_payment_method := CASE UPPER(COALESCE(p_batch_info->>'payment_method', 'CONNECTIPS'))
    WHEN 'CONNECTIPS' THEN 'ConnectIPS'::public.payment_method
    WHEN 'NEFT' THEN 'NEFT'::public.payment_method
    WHEN 'RTGS' THEN 'RTGS'::public.payment_method
    WHEN 'CHEQUE' THEN 'Cheque'::public.payment_method
    WHEN 'CASH' THEN 'Cash'::public.payment_method
    ELSE 'Manual'::public.payment_method
  END;

  -- Optional: Create tracking payment batch if requested in p_batch_info
  IF p_batch_info IS NOT NULL AND p_batch_info->>'batch_name' IS NOT NULL THEN
    BEGIN
      INSERT INTO public.payment_batches (
        batch_name,
        company_id,
        payable_type,
        payment_method,
        total_payments,
        total_amount,
        total_tax,
        status,
        processed_at,
        cds_batch_ref,
        created_by
      ) VALUES (
        p_batch_info->>'batch_name',
        NULLIF(p_batch_info->>'company_id', '')::uuid,
        p_batch_info->>'payable_type',
        COALESCE(p_batch_info->>'payment_method', 'ConnectIPS'),
        COALESCE((p_batch_info->>'total_records')::numeric, 0),
        COALESCE((p_batch_info->>'total_net')::numeric, 0),
        COALESCE((p_batch_info->>'total_tax')::numeric, 0),
        'Completed',
        now(),
        COALESCE(p_batch_info->>'cds_batch_ref', 'RECON-APPLY'),
        v_uid
      )
      RETURNING id INTO v_batch_id;
    EXCEPTION WHEN OTHERS THEN
      v_batch_id := NULL;
    END;
  END IF;

  -- Loop over matched items and apply atomically
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_payable_id := NULLIF(v_item->>'payable_id', '')::uuid;
      v_payment_id := NULLIF(v_item->>'payment_id', '')::uuid;
      v_company_id := NULLIF(v_item->>'company_id', '')::uuid;
      v_payable_type := COALESCE(NULLIF(v_item->>'payable_type', ''), 'dividend');
      v_actual_amt := COALESCE((v_item->>'actual_amount')::numeric, (v_item->>'expected_amount')::numeric, 0);
      v_expected_amt := COALESCE((v_item->>'expected_amount')::numeric, v_actual_amt);
      v_paid_amt := COALESCE((v_item->>'paid_amount')::numeric, v_actual_amt);
      v_result := COALESCE(v_item->>'result', 'Matched');
      v_payment_ref := COALESCE(v_item->>'payment_reference', 'RECON-' || SUBSTRING(COALESCE(v_item->>'id', gen_random_uuid()::text), 1, 8));

      v_new_status := CASE 
        WHEN v_result = 'Matched' OR v_result = 'Over_Paid' THEN 'Paid'::public.payment_status
        ELSE 'Partial'::public.payment_status
      END;

      v_target_table := CASE v_payable_type
        WHEN 'interest' THEN 'interest_payables'
        WHEN 'mutual_fund' THEN 'mutual_fund_payables'
        ELSE 'dividend_payables'
      END;

      -- Update payable record if payable_id is valid (only if not already fully Paid)
      IF v_payable_id IS NOT NULL THEN
        EXECUTE format(
          'UPDATE public.%I SET payment_status = $1, payment_date = CURRENT_DATE, payment_reference = $2 WHERE id = $3 AND payment_status != ''Paid''',
          v_target_table
        ) USING v_new_status, v_payment_ref, v_payable_id;
        v_updated := v_updated + 1;
      END IF;

      -- Handle payment record: update existing or insert new with concurrency lock
      IF v_payment_id IS NOT NULL THEN
        UPDATE public.payments
        SET
          status = 'Completed',
          payment_date = CURRENT_DATE,
          paid_amount = v_paid_amt,
          batch_id = COALESCE(v_batch_id, payments.batch_id),
          updated_at = now()
        WHERE id = v_payment_id;
        v_payments_created := v_payments_created + 1;
      ELSIF v_payable_id IS NOT NULL THEN
        -- Check with FOR UPDATE lock if active payment already exists for this payable
        SELECT id INTO v_payment_id 
        FROM public.payments 
        WHERE payable_id = v_payable_id 
          AND status NOT IN ('Reversed', 'Failed', 'Cancelled')
        FOR UPDATE
        LIMIT 1;

        IF v_payment_id IS NOT NULL THEN
          UPDATE public.payments
          SET
            status = 'Completed',
            payment_date = CURRENT_DATE,
            paid_amount = v_paid_amt,
            batch_id = COALESCE(v_batch_id, payments.batch_id),
            updated_at = now()
          WHERE id = v_payment_id;
        ELSE
          INSERT INTO public.payments (
            batch_id,
            company_id,
            client_id,
            payable_id,
            payable_type,
            gross_amount,
            paid_amount,
            tax_amount,
            net_amount,
            status,
            payment_date,
            payment_reference,
            payment_method,
            remarks,
            created_by
          ) VALUES (
            v_batch_id,
            v_company_id,
            NULLIF(v_item->>'client_id', '')::uuid,
            v_payable_id,
            v_payable_type,
            v_expected_amt,
            v_paid_amt,
            COALESCE((v_item->>'tax_amount')::numeric, 0),
            COALESCE((v_item->>'net_amount')::numeric, v_actual_amt),
            'Completed',
            CURRENT_DATE,
            v_payment_ref,
            v_payment_method,
            'Auto-created via Reconciliation Batch: ' || COALESCE(v_result, 'Matched'),
            v_uid
          );
          v_payments_created := v_payments_created + 1;
        END IF;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'item', v_item,
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', jsonb_array_length(v_errors) = 0,
    'batch_id', v_batch_id,
    'updated', v_updated,
    'payments_created', v_payments_created,
    'errors', v_errors
  );
END;
$function$;

COMMIT;
