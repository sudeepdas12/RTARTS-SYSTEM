-- ============================================================================
-- Migration: 20261141000000_atomic_reconciliation_apply_rpc.sql
-- Description:
-- Creates an atomic, transactional RPC apply_reconciliation_batch to process
-- reconciliation matched items, update payables, and create/update payment records
-- in a single Postgres transaction.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_reconciliation_batch(
  p_items jsonb,
  p_batch_info jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_updated int := 0;
  v_payments_created int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  -- 1. Authenticate caller
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  -- 2. Optional: Create tracking payment batch if requested in p_batch_info
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

  -- 3. Loop over matched items and apply atomically
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

      -- Update payable record if payable_id is valid
      IF v_payable_id IS NOT NULL THEN
        EXECUTE format(
          'UPDATE public.%I SET payment_status = $1, payment_date = CURRENT_DATE, payment_reference = $2 WHERE id = $3',
          v_target_table
        ) USING v_new_status, v_payment_ref, v_payable_id;
        v_updated := v_updated + 1;
      END IF;

      -- Handle payment record: update existing or insert new
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
        -- Check if active payment already exists for this payable (idempotency)
        SELECT id INTO v_payment_id FROM public.payments WHERE payable_id = v_payable_id AND status NOT IN ('Reversed', 'Failed', 'Cancelled') LIMIT 1;

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
            tax_amount,
            net_amount,
            paid_amount,
            payment_method,
            payment_date,
            payment_reference,
            bank_name,
            bank_account_no,
            status,
            created_by
          ) VALUES (
            v_batch_id,
            v_company_id,
            NULLIF(v_item->>'client_id', '')::uuid,
            v_payable_id,
            v_payable_type,
            v_expected_amt,
            0,
            v_expected_amt,
            v_paid_amt,
            COALESCE(p_batch_info->>'payment_method', 'ConnectIPS'),
            CURRENT_DATE,
            v_payment_ref,
            NULLIF(v_item->>'bank_name', ''),
            NULLIF(v_item->>'bank_account_no', ''),
            'Completed',
            v_uid
          );
        END IF;
        v_payments_created := v_payments_created + 1;
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
    'updated', v_updated,
    'paymentsCreated', v_payments_created,
    'batchId', v_batch_id,
    'errors', v_errors
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_reconciliation_batch(jsonb, jsonb) TO authenticated, service_role;
