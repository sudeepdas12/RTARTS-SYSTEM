-- ============================================================================
-- Migration: 20261201000000_harden_reconciliation_installment_sync.sql
-- Description:
-- 1. Hardens apply_reconciliation_batch to support multi-leg installment payouts
--    and maintain the invariant: paid_amount + remaining_amount = net_payable.
-- 2. Sets payment_status = 'Paid' when remaining_amount <= 0.05,
--    'Partial' when paid_amount > 0, and 'Pending' when unpaid.
-- 3. Ensures both interest_payables and dividend_payables accumulate installment
--    payouts cleanly across all companies.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_reconciliation_batch(
  p_items jsonb,
  p_batch_info jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_is_global_access boolean := false;
  v_batch_id uuid := NULL;
  v_batch_company_id uuid := NULL;
  v_payment_method public.payment_method := 'ConnectIPS'::public.payment_method;
  v_updated int := 0;
  v_payments_created int := 0;
  v_already_paid int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_item jsonb;
  v_payable_id uuid;
  v_company_id uuid;
  v_payment_id uuid;
  v_client_id uuid;
  v_payable_type text;
  v_result text;
  v_actual_amt numeric;
  v_expected_amt numeric;
  v_paid_amt numeric;
  v_new_status public.payment_status;
  v_payment_ref text;
  v_target_table text;
  v_existing_payment_id uuid;
  v_current_status text;
BEGIN
  -- 1. Caller authentication & permission check
  v_uid := auth.uid();
  IF v_uid IS NULL 
     AND current_user != 'service_role' 
     AND session_user != 'postgres' 
     AND current_user != 'postgres' 
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  IF current_user = 'postgres' 
     OR session_user = 'postgres' 
     OR current_user = 'service_role' 
     OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' 
     OR EXISTS (
       SELECT 1 FROM public.user_roles
       WHERE user_id = v_uid
         AND role IN ('admin'::public.app_role, 'supervisor'::public.app_role)
     ) THEN
    v_is_global_access := true;
  END IF;

  IF NOT v_is_global_access THEN
    v_batch_company_id := NULLIF(p_batch_info->>'company_id', '')::uuid;
    IF v_batch_company_id IS NOT NULL AND NOT public.has_company_access(v_uid, v_batch_company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to target company %', v_batch_company_id USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) item
      WHERE (item->>'company_id') IS NOT NULL AND (item->>'company_id') != ''
        AND NOT public.has_company_access(v_uid, (item->>'company_id')::uuid)
    ) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to one or more companies in reconciliation items' USING ERRCODE = '42501';
    END IF;
  ELSE
    v_uid := COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
    v_batch_company_id := NULLIF(p_batch_info->>'company_id', '')::uuid;
  END IF;

  v_payment_method := CASE UPPER(COALESCE(p_batch_info->>'payment_method', 'CONNECTIPS'))
    WHEN 'CONNECTIPS' THEN 'ConnectIPS'::public.payment_method
    WHEN 'NEFT' THEN 'NEFT'::public.payment_method
    WHEN 'RTGS' THEN 'RTGS'::public.payment_method
    WHEN 'CHEQUE' THEN 'Cheque'::public.payment_method
    WHEN 'CASH' THEN 'Cash'::public.payment_method
    ELSE 'Manual'::public.payment_method
  END;

  -- 2. Create payment batch record if batch_name is provided
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
        v_batch_company_id,
        p_batch_info->>'payable_type',
        COALESCE(p_batch_info->>'payment_method', 'ConnectIPS'),
        COALESCE(floor((p_batch_info->>'total_records')::numeric)::int, 0),
        COALESCE((p_batch_info->>'total_net')::numeric, 0),
        COALESCE((p_batch_info->>'total_tax')::numeric, 0),
        'Completed'::public.payment_batch_status,
        now(),
        COALESCE(p_batch_info->>'cds_batch_ref', 'RECON-APPLY'),
        v_uid
      )
      RETURNING id INTO v_batch_id;
    EXCEPTION WHEN OTHERS THEN
      v_batch_id := NULL;
    END;
  END IF;

  -- 3. Loop over items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_payable_id   := NULLIF(v_item->>'payable_id', '')::uuid;
      v_company_id   := NULLIF(v_item->>'company_id', '')::uuid;
      v_payment_id   := NULLIF(v_item->>'payment_id', '')::uuid;
      v_client_id    := NULLIF(v_item->>'client_id', '')::uuid;
      v_payable_type := LOWER(COALESCE(v_item->>'payable_type', 'interest'));
      v_result       := UPPER(COALESCE(v_item->>'reconciliation_result', v_item->>'result', 'MATCHED'));
      v_actual_amt   := COALESCE((v_item->>'actual_amount')::numeric, 0);
      v_expected_amt := COALESCE((v_item->>'expected_amount')::numeric, 0);
      v_payment_ref  := COALESCE(v_item->>'payment_reference', v_item->>'bank_reference');

      IF v_payable_type = 'dividend' THEN
        v_target_table := 'dividend_payables';
      ELSIF v_payable_type = 'mutual_fund' THEN
        v_target_table := 'mutual_fund_payables';
      ELSE
        v_target_table := 'interest_payables';
      END IF;

      -- If company_id is missing on item, populate from batch or from payable
      IF v_company_id IS NULL THEN
        v_company_id := v_batch_company_id;
      END IF;

      IF v_company_id IS NULL AND v_payable_id IS NOT NULL THEN
        IF v_target_table = 'dividend_payables' THEN
          SELECT company_id INTO v_company_id FROM public.dividend_payables WHERE id = v_payable_id;
        ELSIF v_target_table = 'mutual_fund_payables' THEN
          SELECT company_id INTO v_company_id FROM public.mutual_fund_payables WHERE id = v_payable_id;
        ELSE
          SELECT company_id INTO v_company_id FROM public.interest_payables WHERE id = v_payable_id;
        END IF;
      END IF;

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

      -- If we have a payable_id, update the payable table
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
                WHEN GREATEST(0, net_payable - (COALESCE(paid_amount, 0) + v_paid_amt)) <= 0.05 THEN 'Paid'::public.payment_status
                WHEN (COALESCE(paid_amount, 0) + v_paid_amt) > 0 THEN 'Partial'::public.payment_status
                ELSE 'Pending'::public.payment_status
              END,
              payment_reference = COALESCE(v_payment_ref, payment_reference),
              updated_at        = now()
          WHERE id = v_payable_id;

        ELSIF v_target_table = 'mutual_fund_payables' THEN
          SELECT payment_status::text INTO v_current_status FROM public.mutual_fund_payables WHERE id = v_payable_id;
          IF v_current_status = 'Paid' THEN
            v_already_paid := v_already_paid + 1;
          END IF;

          UPDATE public.mutual_fund_payables
          SET payment_status    = CASE WHEN v_paid_amt > 0 THEN 'Paid'::public.payment_status ELSE payment_status END,
              payment_date      = CURRENT_DATE,
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
                WHEN GREATEST(0, net_payable - (COALESCE(paid_amount, 0) + v_paid_amt)) <= 0.05 THEN 'Paid'::public.payment_status
                WHEN (COALESCE(paid_amount, 0) + v_paid_amt) > 0 THEN 'Partial'::public.payment_status
                ELSE 'Pending'::public.payment_status
              END,
              payment_reference = COALESCE(v_payment_ref, payment_reference),
              updated_at        = now()
          WHERE id = v_payable_id;
        END IF;

        -- Update or insert payment record. When a payout is confirmed (Paid or Partial installment), payment is Completed.
        IF v_payment_id IS NOT NULL THEN
          UPDATE public.payments
          SET status            = CASE WHEN v_paid_amt > 0 THEN 'Completed'::public.payment_status ELSE 'Pending'::public.payment_status END,
              payment_date      = CURRENT_DATE,
              paid_amount       = v_paid_amt,
              payment_reference = COALESCE(v_payment_ref, payment_reference),
              batch_id          = COALESCE(v_batch_id, payments.batch_id),
              updated_at        = now()
          WHERE id = v_payment_id;
        ELSE
          INSERT INTO public.payments (
            company_id,
            client_id,
            payable_id,
            payable_type,
            gross_amount,
            tax_amount,
            net_amount,
            paid_amount,
            payment_status,
            payment_date,
            payment_method,
            payment_reference,
            batch_id,
            bank_name,
            bank_account_no,
            created_by
          ) VALUES (
            v_company_id,
            v_client_id,
            v_payable_id,
            v_payable_type,
            COALESCE((v_item->>'gross_amount')::numeric, v_expected_amt),
            COALESCE((v_item->>'tax_amount')::numeric, 0),
            v_expected_amt,
            v_paid_amt,
            CASE WHEN v_paid_amt > 0 THEN 'Completed'::public.payment_status ELSE 'Pending'::public.payment_status END,
            CURRENT_DATE,
            v_payment_method,
            v_payment_ref,
            v_batch_id,
            v_item->>'bank_name',
            v_item->>'bank_account_no',
            v_uid
          );
          v_payments_created := v_payments_created + 1;
        END IF;

        v_updated := v_updated + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'item_id', v_item->>'id',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'updated', v_updated,
    'payments_created', v_payments_created,
    'already_paid', v_already_paid,
    'errors', v_errors
  );
END;
$$;
