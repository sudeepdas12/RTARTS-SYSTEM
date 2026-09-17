-- ============================================================================
-- Migration: 20261187000000_harden_apply_reconciliation_batch.sql
-- Description:
-- 1. Harden apply_reconciliation_batch RPC:
--    - Fixes unique constraint violation (uq_active_payments_payable_id) by
--      checking for existing active payments before inserting and updating them.
--    - Handles service_role caller access cleanly without company access error.
--    - Populates company_id from payable if missing on item payload.
--    - Properly maps reconciliation_result ('Matched', 'Over_Paid', 'Under_Paid', 'Partial').
--    - Returns both 'payables_updated' and 'updated' for client compatibility.
--    - Allows direct update of payment records if matched directly against payments.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_reconciliation_batch(p_items jsonb, p_batch_info jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_is_service_role boolean;
  v_item jsonb;
  v_batch_id uuid;
  v_batch_company_id uuid;
  v_company_id uuid;
  v_payable_id uuid;
  v_payment_id uuid;
  v_existing_payment_id uuid;
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
  -- 1. Check Service Role vs User
  v_is_service_role := (
    current_user = 'service_role' OR
    COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
  );

  IF NOT v_is_service_role THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');
    v_uid := auth.uid();

    -- Verify caller has company access for batch info if company_id provided
    v_batch_company_id := NULLIF(p_batch_info->>'company_id', '')::uuid;
    IF v_batch_company_id IS NOT NULL THEN
      IF NOT public.has_company_access(v_uid, v_batch_company_id) THEN
        RAISE EXCEPTION 'Unauthorized: caller lacks access to company % in reconciliation batch info', v_batch_company_id USING ERRCODE = '42501';
      END IF;
    END IF;

    -- Verify caller has company access for all item companies
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

  -- 3. Loop over items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_payable_id   := NULLIF(v_item->>'payable_id', '')::uuid;
      v_company_id   := NULLIF(v_item->>'company_id', '')::uuid;
      v_payment_id   := NULLIF(v_item->>'payment_id', '')::uuid;
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

      -- Calculate status and paid amount
      IF v_result = 'MATCHED' THEN
        v_new_status := 'Paid'::public.payment_status;
        v_paid_amt   := CASE WHEN v_actual_amt > 0 THEN v_actual_amt ELSE v_expected_amt END;
      ELSIF v_result IN ('PARTIAL', 'UNDER_PAID', 'OVER_PAID') THEN
        v_new_status := 'Partial'::public.payment_status;
        v_paid_amt   := v_actual_amt;
      ELSE
        v_new_status := 'Pending'::public.payment_status;
        v_paid_amt   := 0;
      END IF;

      -- Check if an active payment already exists for this payable
      IF v_payable_id IS NOT NULL AND v_payment_id IS NULL THEN
        SELECT id INTO v_existing_payment_id
        FROM public.payments
        WHERE payable_id = v_payable_id
          AND status NOT IN ('Reversed', 'Failed', 'Cancelled')
        LIMIT 1;
        IF v_existing_payment_id IS NOT NULL THEN
          v_payment_id := v_existing_payment_id;
        END IF;
      END IF;

      -- If we have a payable_id, update the payable table
      IF v_payable_id IS NOT NULL THEN
        IF v_target_table = 'dividend_payables' THEN
          UPDATE public.dividend_payables
          SET payment_status    = v_new_status,
              payment_date      = CURRENT_DATE,
              payment_reference = COALESCE(v_payment_ref, payment_reference),
              updated_at        = now()
          WHERE id = v_payable_id;
        ELSIF v_target_table = 'mutual_fund_payables' THEN
          UPDATE public.mutual_fund_payables
          SET payment_status    = v_new_status,
              payment_date      = CURRENT_DATE,
              payment_reference = COALESCE(v_payment_ref, payment_reference),
              updated_at        = now()
          WHERE id = v_payable_id;
        ELSE
          UPDATE public.interest_payables
          SET payment_status    = v_new_status,
              payment_date      = CURRENT_DATE,
              payment_reference = COALESCE(v_payment_ref, payment_reference),
              updated_at        = now()
          WHERE id = v_payable_id;
        END IF;

        -- Update or insert payment record
        IF v_payment_id IS NOT NULL THEN
          UPDATE public.payments
          SET status            = CASE WHEN v_new_status = 'Paid' THEN 'Completed' ELSE 'Pending' END,
              payment_date      = CURRENT_DATE,
              paid_amount       = v_paid_amt,
              payment_reference = COALESCE(v_payment_ref, payment_reference),
              updated_at        = now()
          WHERE id = v_payment_id;
        ELSIF (v_new_status = 'Paid' OR v_new_status = 'Partial') AND v_company_id IS NOT NULL THEN
          BEGIN
            INSERT INTO public.payments (
              batch_id,
              company_id,
              client_id,
              payable_type,
              payable_id,
              gross_amount,
              tax_amount,
              net_amount,
              paid_amount,
              payment_method,
              payment_date,
              payment_reference,
              status,
              created_by
            ) VALUES (
              v_batch_id,
              v_company_id,
              NULLIF(v_item->>'client_id', '')::uuid,
              v_target_table,
              v_payable_id,
              v_expected_amt,
              0,
              v_expected_amt,
              v_paid_amt,
              v_payment_method,
              CURRENT_DATE,
              v_payment_ref,
              CASE WHEN v_new_status = 'Paid' THEN 'Completed' ELSE 'Pending' END,
              v_uid
            );
            v_payments_created := v_payments_created + 1;
          EXCEPTION WHEN unique_violation THEN
            -- Handle concurrency race on uq_active_payments_payable_id gracefully
            UPDATE public.payments
            SET status = CASE WHEN v_new_status = 'Paid' THEN 'Completed' ELSE 'Pending' END,
                payment_date = CURRENT_DATE,
                paid_amount = v_paid_amt,
                payment_reference = COALESCE(v_payment_ref, payment_reference),
                updated_at = now()
            WHERE payable_id = v_payable_id
              AND status NOT IN ('Reversed', 'Failed', 'Cancelled');
          END;
        END IF;

        v_updated := v_updated + 1;
      ELSIF v_payment_id IS NOT NULL THEN
        -- Bank statement transaction matched directly against an existing payment record
        UPDATE public.payments
        SET status            = CASE WHEN v_new_status = 'Paid' THEN 'Completed' ELSE 'Pending' END,
            payment_date      = CURRENT_DATE,
            paid_amount       = v_paid_amt,
            payment_reference = COALESCE(v_payment_ref, payment_reference),
            updated_at        = now()
        WHERE id = v_payment_id;
        v_updated := v_updated + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'payable_id', v_item->>'payable_id',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'payables_updated', v_updated,
    'updated', v_updated,
    'payments_created', v_payments_created,
    'batch_id', v_batch_id,
    'errors', v_errors
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_reconciliation_batch(jsonb, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.apply_reconciliation_batch(jsonb, jsonb) TO authenticated, service_role;
