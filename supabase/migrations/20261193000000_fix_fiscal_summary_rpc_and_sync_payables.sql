-- ============================================================================
-- Migration: 20261193000000_fix_fiscal_summary_rpc_and_sync_payables.sql
-- Description:
-- 1. Fix get_company_fiscal_summary_rpc: Cast payment_status to text before LOWER()
--    to prevent "function lower(payment_status) does not exist" error.
-- 2. Include total_paid, total_pending, and total_disbursed in fiscal summary output.
-- 3. Update apply_reconciliation_batch to set paid_amount and remaining_amount on payables.
-- 4. Sync existing reconciled interest and dividend payables with payments.paid_amount.
-- ============================================================================

-- 1. Fix get_company_fiscal_summary_rpc
CREATE OR REPLACE FUNCTION public.get_company_fiscal_summary_rpc(p_fiscal_year text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_is_global_access boolean := false;
  v_user_companies uuid[];
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL 
     AND current_user != 'service_role' 
     AND session_user != 'postgres' 
     AND current_user != 'postgres' 
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  -- Resolve company authorization
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
  ELSE
    SELECT COALESCE(array_agg(company_id), '{}')
    INTO v_user_companies
    FROM public.user_company_access
    WHERE user_id = v_uid;
  END IF;

  RETURN (
    WITH div_summary AS (
      SELECT
        dp.company_id,
        dp.fiscal_year,
        COUNT(*) AS dividend_count,
        COALESCE(SUM(dp.gross_dividend), 0) AS dividend_gross,
        COALESCE(SUM(dp.net_payable), 0) AS dividend_net,
        COALESCE(SUM(dp.paid_amount), 0) AS dividend_disbursed,
        COALESCE(SUM(dp.net_payable) FILTER (WHERE LOWER(dp.payment_status::text) = 'paid'), 0) AS dividend_paid,
        COALESCE(SUM(dp.net_payable) FILTER (WHERE LOWER(dp.payment_status::text) = 'partial'), 0) AS dividend_partial,
        COALESCE(SUM(dp.net_payable) FILTER (WHERE LOWER(COALESCE(dp.payment_status::text, 'pending')) NOT IN ('paid', 'partial')), 0) AS dividend_pending
      FROM public.dividend_payables dp
      WHERE (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR dp.fiscal_year = p_fiscal_year)
        AND (v_is_global_access OR dp.company_id = ANY(v_user_companies))
      GROUP BY dp.company_id, dp.fiscal_year
    ),
    int_summary AS (
      SELECT
        ip.company_id,
        ip.fiscal_year,
        COUNT(*) AS interest_count,
        COALESCE(SUM(ip.gross_interest), 0) AS interest_gross,
        COALESCE(SUM(ip.net_payable), 0) AS interest_net,
        COALESCE(SUM(ip.paid_amount), 0) AS interest_disbursed,
        COALESCE(SUM(ip.net_payable) FILTER (WHERE LOWER(ip.payment_status::text) = 'paid'), 0) AS interest_paid,
        COALESCE(SUM(ip.net_payable) FILTER (WHERE LOWER(ip.payment_status::text) = 'partial'), 0) AS interest_partial,
        COALESCE(SUM(ip.net_payable) FILTER (WHERE LOWER(COALESCE(ip.payment_status::text, 'pending')) NOT IN ('paid', 'partial')), 0) AS interest_pending
      FROM public.interest_payables ip
      WHERE (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR ip.fiscal_year = p_fiscal_year)
        AND (v_is_global_access OR ip.company_id = ANY(v_user_companies))
      GROUP BY ip.company_id, ip.fiscal_year
    ),
    mf_summary AS (
      SELECT
        mp.company_id,
        mp.fiscal_year,
        COUNT(*) AS mutual_fund_count,
        COALESCE(SUM(mp.gross_dividend), 0) AS mutual_fund_gross,
        COALESCE(SUM(mp.net_payable), 0) AS mutual_fund_net,
        COALESCE(SUM(mp.net_payable) FILTER (WHERE LOWER(mp.payment_status::text) = 'paid'), 0) AS mutual_fund_disbursed,
        COALESCE(SUM(mp.net_payable) FILTER (WHERE LOWER(mp.payment_status::text) = 'paid'), 0) AS mutual_fund_paid,
        COALESCE(SUM(mp.net_payable) FILTER (WHERE LOWER(mp.payment_status::text) = 'partial'), 0) AS mutual_fund_partial,
        COALESCE(SUM(mp.net_payable) FILTER (WHERE LOWER(COALESCE(mp.payment_status::text, 'pending')) NOT IN ('paid', 'partial')), 0) AS mutual_fund_pending
      FROM public.mutual_fund_payables mp
      WHERE (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR mp.fiscal_year = p_fiscal_year)
        AND (v_is_global_access OR mp.company_id = ANY(v_user_companies))
      GROUP BY mp.company_id, mp.fiscal_year
    ),
    all_pairs AS (
      SELECT company_id, fiscal_year FROM div_summary
      UNION
      SELECT company_id, fiscal_year FROM int_summary
      UNION
      SELECT company_id, fiscal_year FROM mf_summary
    )
    SELECT COALESCE(
      json_agg(
        json_build_object(
          'company_id', ap.company_id,
          'company_name', COALESCE(c.company_name, 'Unknown Company'),
          'company_code', COALESCE(c.company_code, 'N/A'),
          'fiscal_year', ap.fiscal_year,
          'dividend_count', COALESCE(ds.dividend_count, 0),
          'dividend_gross', ROUND(COALESCE(ds.dividend_gross, 0)::numeric, 2),
          'dividend_net', ROUND(COALESCE(ds.dividend_net, 0)::numeric, 2),
          'dividend_paid', ROUND(COALESCE(ds.dividend_paid, 0)::numeric, 2),
          'dividend_partial', ROUND(COALESCE(ds.dividend_partial, 0)::numeric, 2),
          'dividend_pending', ROUND(COALESCE(ds.dividend_pending, 0)::numeric, 2),
          'dividend_disbursed', ROUND(COALESCE(ds.dividend_disbursed, 0)::numeric, 2),
          'interest_count', COALESCE(isum.interest_count, 0),
          'interest_gross', ROUND(COALESCE(isum.interest_gross, 0)::numeric, 2),
          'interest_net', ROUND(COALESCE(isum.interest_net, 0)::numeric, 2),
          'interest_paid', ROUND(COALESCE(isum.interest_paid, 0)::numeric, 2),
          'interest_partial', ROUND(COALESCE(isum.interest_partial, 0)::numeric, 2),
          'interest_pending', ROUND(COALESCE(isum.interest_pending, 0)::numeric, 2),
          'interest_disbursed', ROUND(COALESCE(isum.interest_disbursed, 0)::numeric, 2),
          'mutual_fund_count', COALESCE(ms.mutual_fund_count, 0),
          'mutual_fund_gross', ROUND(COALESCE(ms.mutual_fund_gross, 0)::numeric, 2),
          'mutual_fund_net', ROUND(COALESCE(ms.mutual_fund_net, 0)::numeric, 2),
          'mutual_fund_paid', ROUND(COALESCE(ms.mutual_fund_paid, 0)::numeric, 2),
          'mutual_fund_partial', ROUND(COALESCE(ms.mutual_fund_partial, 0)::numeric, 2),
          'mutual_fund_pending', ROUND(COALESCE(ms.mutual_fund_pending, 0)::numeric, 2),
          'mutual_fund_disbursed', ROUND(COALESCE(ms.mutual_fund_disbursed, 0)::numeric, 2),
          'total_paid', ROUND((COALESCE(ds.dividend_paid, 0) + COALESCE(isum.interest_paid, 0) + COALESCE(ms.mutual_fund_paid, 0))::numeric, 2),
          'total_pending', ROUND((COALESCE(ds.dividend_pending, 0) + COALESCE(isum.interest_pending, 0) + COALESCE(ms.mutual_fund_pending, 0))::numeric, 2),
          'total_disbursed', ROUND((COALESCE(ds.dividend_disbursed, 0) + COALESCE(isum.interest_disbursed, 0) + COALESCE(ms.mutual_fund_disbursed, 0))::numeric, 2)
        )
      ),
      '[]'::json
    )
    FROM all_pairs ap
    JOIN public.companies c ON ap.company_id = c.id
    LEFT JOIN div_summary ds ON ap.company_id = ds.company_id AND ap.fiscal_year = ds.fiscal_year
    LEFT JOIN int_summary isum ON ap.company_id = isum.company_id AND ap.fiscal_year = isum.fiscal_year
    LEFT JOIN mf_summary ms ON ap.company_id = ms.company_id AND ap.fiscal_year = ms.fiscal_year
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_fiscal_summary_rpc(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_company_fiscal_summary_rpc(text) TO authenticated, service_role;

-- 2. Update apply_reconciliation_batch to set paid_amount and remaining_amount on payables
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
  v_already_paid int := 0;
  v_current_status text;
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
          AND status NOT IN ('Reversed', 'Failed', 'Cancelled')
        LIMIT 1;
        IF v_existing_payment_id IS NOT NULL THEN
          v_payment_id := v_existing_payment_id;
        END IF;
      END IF;

      -- If we have a payable_id, update the payable table
      IF v_payable_id IS NOT NULL THEN
        IF v_target_table = 'dividend_payables' THEN
          SELECT payment_status::text INTO v_current_status FROM public.dividend_payables WHERE id = v_payable_id;
          IF v_current_status = 'Paid' AND v_new_status = 'Paid' THEN
            v_already_paid := v_already_paid + 1;
          END IF;

          UPDATE public.dividend_payables
          SET payment_status    = v_new_status,
              payment_date      = CURRENT_DATE,
              paid_amount       = CASE WHEN v_new_status = 'Paid' THEN net_payable ELSE v_paid_amt END,
              remaining_amount  = CASE WHEN v_new_status = 'Paid' THEN 0 ELSE GREATEST(0, net_payable - v_paid_amt) END,
              payment_reference = COALESCE(v_payment_ref, payment_reference),
              updated_at        = now()
          WHERE id = v_payable_id;
        ELSIF v_target_table = 'mutual_fund_payables' THEN
          SELECT payment_status::text INTO v_current_status FROM public.mutual_fund_payables WHERE id = v_payable_id;
          IF v_current_status = 'Paid' AND v_new_status = 'Paid' THEN
            v_already_paid := v_already_paid + 1;
          END IF;

          UPDATE public.mutual_fund_payables
          SET payment_status    = v_new_status,
              payment_date      = CURRENT_DATE,
              payment_reference = COALESCE(v_payment_ref, payment_reference),
              updated_at        = now()
          WHERE id = v_payable_id;
        ELSE
          SELECT payment_status::text INTO v_current_status FROM public.interest_payables WHERE id = v_payable_id;
          IF v_current_status = 'Paid' AND v_new_status = 'Paid' THEN
            v_already_paid := v_already_paid + 1;
          END IF;

          UPDATE public.interest_payables
          SET payment_status    = v_new_status,
              payment_date      = CURRENT_DATE,
              paid_amount       = CASE WHEN v_new_status = 'Paid' THEN net_payable ELSE v_paid_amt END,
              remaining_amount  = CASE WHEN v_new_status = 'Paid' THEN 0 ELSE GREATEST(0, net_payable - v_paid_amt) END,
              payment_reference = COALESCE(v_payment_ref, payment_reference),
              updated_at        = now()
          WHERE id = v_payable_id;
        END IF;

        -- Update or insert payment record. When a payout is confirmed (Paid or Partial installment), payment is Completed.
        IF v_payment_id IS NOT NULL THEN
          UPDATE public.payments
          SET status            = CASE WHEN v_new_status IN ('Paid', 'Partial') THEN 'Completed' ELSE 'Pending' END,
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
              CASE WHEN v_new_status IN ('Paid', 'Partial') THEN 'Completed' ELSE 'Pending' END,
              v_uid
            );
            v_payments_created := v_payments_created + 1;
          EXCEPTION WHEN unique_violation THEN
            UPDATE public.payments
            SET status = CASE WHEN v_new_status IN ('Paid', 'Partial') THEN 'Completed' ELSE 'Pending' END,
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
        SELECT payable_id, payable_type INTO v_payable_id, v_target_table
        FROM public.payments WHERE id = v_payment_id;

        UPDATE public.payments
        SET status            = CASE WHEN v_new_status IN ('Paid', 'Partial') THEN 'Completed' ELSE 'Pending' END,
            payment_date      = CURRENT_DATE,
            paid_amount       = v_paid_amt,
            payment_reference = COALESCE(v_payment_ref, payment_reference),
            updated_at        = now()
        WHERE id = v_payment_id;

        -- Synchronize linked payable if present
        IF v_payable_id IS NOT NULL THEN
          IF v_target_table = 'dividend' OR v_target_table = 'dividend_payables' THEN
            UPDATE public.dividend_payables
            SET payment_status   = v_new_status,
                paid_amount      = CASE WHEN v_new_status = 'Paid' THEN net_payable ELSE v_paid_amt END,
                remaining_amount = CASE WHEN v_new_status = 'Paid' THEN 0 ELSE GREATEST(0, net_payable - v_paid_amt) END,
                updated_at       = now()
            WHERE id = v_payable_id AND payment_status != 'Paid';
          ELSIF v_target_table = 'interest' OR v_target_table = 'interest_payables' THEN
            UPDATE public.interest_payables
            SET payment_status   = v_new_status,
                paid_amount      = CASE WHEN v_new_status = 'Paid' THEN net_payable ELSE v_paid_amt END,
                remaining_amount = CASE WHEN v_new_status = 'Paid' THEN 0 ELSE GREATEST(0, net_payable - v_paid_amt) END,
                updated_at       = now()
            WHERE id = v_payable_id AND payment_status != 'Paid';
          ELSIF v_target_table = 'mutual_fund' OR v_target_table = 'mutual_fund_payables' THEN
            UPDATE public.mutual_fund_payables
            SET payment_status   = v_new_status,
                updated_at       = now()
            WHERE id = v_payable_id AND payment_status != 'Paid';
          END IF;
        END IF;

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
    'already_paid', v_already_paid,
    'batch_id', v_batch_id,
    'errors', v_errors
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_reconciliation_batch(jsonb, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.apply_reconciliation_batch(jsonb, jsonb) TO authenticated, service_role;

-- 3. Synchronize existing interest_payables paid_amount and remaining_amount from payments
UPDATE public.interest_payables ip
SET paid_amount = CASE 
      WHEN ip.payment_status = 'Paid' THEN ip.net_payable 
      ELSE COALESCE(p.paid_amount, 0) 
    END,
    remaining_amount = CASE 
      WHEN ip.payment_status = 'Paid' THEN 0 
      ELSE GREATEST(0, ip.net_payable - COALESCE(p.paid_amount, 0)) 
    END,
    updated_at = now()
FROM public.payments p
WHERE p.payable_id = ip.id 
  AND p.status = 'Completed'
  AND (ip.paid_amount = 0 OR ip.paid_amount IS NULL);

-- Sync dividend_payables if any exist
UPDATE public.dividend_payables dp
SET paid_amount = CASE 
      WHEN dp.payment_status = 'Paid' THEN dp.net_payable 
      ELSE COALESCE(p.paid_amount, 0) 
    END,
    remaining_amount = CASE 
      WHEN dp.payment_status = 'Paid' THEN 0 
      ELSE GREATEST(0, dp.net_payable - COALESCE(p.paid_amount, 0)) 
    END,
    updated_at = now()
FROM public.payments p
WHERE p.payable_id = dp.id 
  AND p.status = 'Completed'
  AND (dp.paid_amount = 0 OR dp.paid_amount IS NULL);
