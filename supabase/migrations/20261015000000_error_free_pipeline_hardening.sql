-- ============================================================================
-- Migration: 20261015000000_error_free_pipeline_hardening.sql
-- Description: Error-free pipeline hardening:
--   1. Preserve manual and imported tax overrides across all payable tables.
--   2. Replace calc triggers with calc_dividend_payable_safe() & calc_interest_payable_safe().
--   3. Atomic upload progress tracking via increment_upload_progress_atomic().
--   4. Batch dispatch separation via mark_payment_batch_dispatched_atomic().
--   5. Safe bank transaction locking & settlement via commit_reconciliation_matches_atomic().
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema Additions: Manual Tax Flags, Tax Rates, and Paid Amounts
-- ----------------------------------------------------------------------------

ALTER TABLE public.dividend_payables
  ADD COLUMN IF NOT EXISTS is_tax_manual boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_rate numeric(5,4),
  ADD COLUMN IF NOT EXISTS paid_amount numeric(15,2) DEFAULT 0.00;

ALTER TABLE public.interest_payables
  ADD COLUMN IF NOT EXISTS is_tax_manual boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_rate numeric(5,4),
  ADD COLUMN IF NOT EXISTS paid_amount numeric(15,2) DEFAULT 0.00;

ALTER TABLE public.mutual_fund_payables
  ADD COLUMN IF NOT EXISTS is_tax_manual boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_rate numeric(5,4),
  ADD COLUMN IF NOT EXISTS paid_amount numeric(15,2) DEFAULT 0.00;

ALTER TABLE public.upload_history
  ADD COLUMN IF NOT EXISTS processed_rows integer DEFAULT 0;

-- ----------------------------------------------------------------------------
-- 2. Safe Calculation Trigger Functions (Preserving Overrides)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calc_dividend_payable_safe()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Derive gross if not provided
  IF NEW.gross_dividend IS NULL OR NEW.gross_dividend = 0 THEN
    IF NEW.shares_held IS NOT NULL AND NEW.dividend_rate IS NOT NULL THEN
      NEW.gross_dividend := round(COALESCE(NEW.shares_held, 0) * COALESCE(NEW.dividend_rate, 0), 2);
    END IF;
  END IF;

  -- Preserve manual or imported tax overrides
  IF NEW.is_tax_manual IS TRUE THEN
    IF NEW.tax_amount IS NULL THEN
      NEW.tax_amount := 0.00;
    END IF;
  ELSE
    -- Only recalculate tax if tax_amount was not provided or 0, and a rate exists
    IF (NEW.tax_amount IS NULL OR NEW.tax_amount = 0) AND (NEW.tax_rate IS NOT NULL OR NEW.tds_rate IS NOT NULL) THEN
      NEW.tax_amount := round(COALESCE(NEW.gross_dividend, 0) * COALESCE(NEW.tax_rate, NEW.tds_rate, 0), 2);
    END IF;
  END IF;

  NEW.net_payable := round(COALESCE(NEW.gross_dividend, 0) - COALESCE(NEW.tax_amount, 0), 2);
  NEW.remaining_amount := GREATEST(0, round(COALESCE(NEW.net_payable, 0) - COALESCE(NEW.paid_amount, 0), 2));

  -- Auto-sync payment status when paid_amount reaches net_payable
  IF COALESCE(NEW.paid_amount, 0) >= NEW.net_payable AND NEW.net_payable > 0 THEN
    NEW.payment_status := 'Paid';
  ELSIF COALESCE(NEW.paid_amount, 0) > 0 THEN
    NEW.payment_status := 'Partial';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.calc_interest_payable_safe()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Preserve manual or imported tax overrides
  IF NEW.is_tax_manual IS TRUE THEN
    IF NEW.tax_amount IS NULL THEN
      NEW.tax_amount := 0.00;
    END IF;
  ELSE
    IF (NEW.tax_amount IS NULL OR NEW.tax_amount = 0) AND (NEW.tax_rate IS NOT NULL OR NEW.tds_rate IS NOT NULL) THEN
      NEW.tax_amount := round(COALESCE(NEW.gross_interest, 0) * COALESCE(NEW.tax_rate, NEW.tds_rate, 0), 2);
    END IF;
  END IF;

  NEW.net_payable := round(COALESCE(NEW.gross_interest, 0) - COALESCE(NEW.tax_amount, 0), 2);
  NEW.remaining_amount := GREATEST(0, round(COALESCE(NEW.net_payable, 0) - COALESCE(NEW.paid_amount, 0), 2));

  IF COALESCE(NEW.paid_amount, 0) >= NEW.net_payable AND NEW.net_payable > 0 THEN
    NEW.payment_status := 'Paid';
  ELSIF COALESCE(NEW.paid_amount, 0) > 0 THEN
    NEW.payment_status := 'Partial';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Replace existing triggers with safe versions
DROP TRIGGER IF EXISTS trg_dp_calc ON public.dividend_payables;
CREATE TRIGGER trg_dp_calc
  BEFORE INSERT OR UPDATE ON public.dividend_payables
  FOR EACH ROW EXECUTE FUNCTION public.calc_dividend_payable_safe();

DROP TRIGGER IF EXISTS trg_ip_calc ON public.interest_payables;
CREATE TRIGGER trg_ip_calc
  BEFORE INSERT OR UPDATE ON public.interest_payables
  FOR EACH ROW EXECUTE FUNCTION public.calc_interest_payable_safe();

DROP TRIGGER IF EXISTS trg_mfp_calc ON public.mutual_fund_payables;
CREATE TRIGGER trg_mfp_calc
  BEFORE INSERT OR UPDATE ON public.mutual_fund_payables
  FOR EACH ROW EXECUTE FUNCTION public.calc_dividend_payable_safe();

-- ----------------------------------------------------------------------------
-- 3. Eliminate Stuck Uploads via increment_upload_progress_atomic
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.increment_upload_progress_atomic(
  p_upload_id uuid,
  p_processed_inc integer DEFAULT 0,
  p_success_inc integer DEFAULT 0,
  p_error_inc integer DEFAULT 0,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rec record;
  v_new_status text;
BEGIN
  SELECT * INTO v_rec
  FROM public.upload_history
  WHERE id = p_upload_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Upload record not found');
  END IF;

  -- Determine completion status if total_rows is reached
  v_new_status := v_rec.status;
  IF v_rec.total_rows > 0 AND (COALESCE(v_rec.processed_rows, 0) + p_processed_inc) >= v_rec.total_rows THEN
    IF (COALESCE(v_rec.error_rows, 0) + p_error_inc) > 0 THEN
      IF (COALESCE(v_rec.success_rows, 0) + p_success_inc) = 0 THEN
        v_new_status := 'Failed';
      ELSE
        v_new_status := 'Completed with Errors';
      END IF;
    ELSE
      v_new_status := 'Completed';
    END IF;
  END IF;

  UPDATE public.upload_history
  SET
    processed_rows = COALESCE(processed_rows, 0) + p_processed_inc,
    success_rows   = COALESCE(success_rows, 0) + p_success_inc,
    error_rows     = COALESCE(error_rows, 0) + p_error_inc,
    status         = v_new_status,
    completed_at   = CASE WHEN v_new_status IN ('Completed', 'Completed with Errors', 'Failed') THEN COALESCE(completed_at, now()) ELSE completed_at END,
    error_message  = CASE 
      WHEN p_error_message IS NOT NULL AND p_error_message <> '' THEN 
        COALESCE(NULLIF(error_message, '') || ' ; ', '') || p_error_message
      ELSE error_message 
    END
  WHERE id = p_upload_id
  RETURNING * INTO v_rec;

  RETURN jsonb_build_object(
    'success', true,
    'upload_id', v_rec.id,
    'status', v_rec.status,
    'processed_rows', v_rec.processed_rows,
    'success_rows', v_rec.success_rows,
    'error_rows', v_rec.error_rows,
    'total_rows', v_rec.total_rows
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Separate Batch Dispatch from Settlement via mark_payment_batch_dispatched_atomic
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_payment_batch_dispatched_atomic(
  p_batch_id uuid,
  p_dispatched_by uuid DEFAULT NULL,
  p_remarks text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch record;
  v_updated_payments_count integer := 0;
BEGIN
  SELECT * INTO v_batch
  FROM public.payment_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment batch not found');
  END IF;

  IF v_batch.status = 'Completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot dispatch an already completed/settled batch');
  END IF;

  -- Transition batch status to Dispatched
  UPDATE public.payment_batches
  SET
    status = 'Dispatched',
    updated_at = now()
  WHERE id = p_batch_id;

  -- Transition pending payments to Dispatched (NOT Paid)
  UPDATE public.payments
  SET
    status = 'Dispatched',
    updated_at = now()
  WHERE batch_id = p_batch_id
    AND status NOT IN ('Paid', 'Failed', 'Cancelled', 'Reversed');

  GET DIAGNOSTICS v_updated_payments_count = ROW_COUNT;

  -- Payables remain Pending/Dispatched until settlement is confirmed by bank reconciliation

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'status', 'Dispatched',
    'payments_dispatched', v_updated_payments_count
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Lock Statements During Reconciliation via commit_reconciliation_matches_atomic
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.commit_reconciliation_matches_atomic(
  p_company_id uuid,
  p_matches jsonb,
  p_operator_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item jsonb;
  v_txn_id uuid;
  v_payable_id uuid;
  v_payable_type text;
  v_match_amount numeric(15,2);
  v_txn record;
  v_reconciled_count integer := 0;
  v_settled_amount numeric(15,2) := 0.00;
BEGIN
  IF p_matches IS NULL OR jsonb_array_length(p_matches) = 0 THEN
    RETURN jsonb_build_object('success', true, 'reconciled_count', 0, 'settled_amount', 0);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_matches)
  LOOP
    v_txn_id := (v_item->>'bank_transaction_id')::uuid;
    v_payable_id := (v_item->>'payable_id')::uuid;
    v_payable_type := COALESCE(v_item->>'payable_type', 'dividend');
    v_match_amount := round(COALESCE((v_item->>'match_amount')::numeric, 0), 2);

    IF v_match_amount <= 0 THEN
      CONTINUE;
    END IF;

    -- 1. Lock bank transaction using FOR UPDATE SKIP LOCKED
    IF v_txn_id IS NOT NULL THEN
      SELECT * INTO v_txn
      FROM public.bank_transactions
      WHERE id = v_txn_id
      FOR UPDATE SKIP LOCKED;

      IF FOUND THEN
        UPDATE public.bank_transactions
        SET
          status = 'Reconciled',
          reconciled_at = now(),
          updated_at = now()
        WHERE id = v_txn_id;
      END IF;
    END IF;

    -- 2. Apply settlement to the payable row with paid_amount <= net_payable constraint
    IF v_payable_id IS NOT NULL THEN
      IF v_payable_type = 'interest' THEN
        UPDATE public.interest_payables
        SET
          paid_amount = LEAST(net_payable, round(COALESCE(paid_amount, 0) + v_match_amount, 2)),
          remaining_amount = GREATEST(0, round(net_payable - LEAST(net_payable, round(COALESCE(paid_amount, 0) + v_match_amount, 2)), 2)),
          payment_status = CASE 
            WHEN round(COALESCE(paid_amount, 0) + v_match_amount, 2) >= net_payable THEN 'Paid' 
            ELSE 'Partial' 
          END,
          updated_at = now()
        WHERE id = v_payable_id;
      ELSIF v_payable_type = 'mutual_fund' THEN
        UPDATE public.mutual_fund_payables
        SET
          paid_amount = LEAST(net_payable, round(COALESCE(paid_amount, 0) + v_match_amount, 2)),
          remaining_amount = GREATEST(0, round(net_payable - LEAST(net_payable, round(COALESCE(paid_amount, 0) + v_match_amount, 2)), 2)),
          payment_status = CASE 
            WHEN round(COALESCE(paid_amount, 0) + v_match_amount, 2) >= net_payable THEN 'Paid' 
            ELSE 'Partial' 
          END,
          updated_at = now()
        WHERE id = v_payable_id;
      ELSE
        UPDATE public.dividend_payables
        SET
          paid_amount = LEAST(net_payable, round(COALESCE(paid_amount, 0) + v_match_amount, 2)),
          remaining_amount = GREATEST(0, round(net_payable - LEAST(net_payable, round(COALESCE(paid_amount, 0) + v_match_amount, 2)), 2)),
          payment_status = CASE 
            WHEN round(COALESCE(paid_amount, 0) + v_match_amount, 2) >= net_payable THEN 'Paid' 
            ELSE 'Partial' 
          END,
          updated_at = now()
        WHERE id = v_payable_id;
      END IF;

      -- 3. Update any corresponding payment row to Completed/Paid
      UPDATE public.payments
      SET
        status = 'Paid',
        paid_amount = LEAST(net_amount, round(COALESCE(paid_amount, 0) + v_match_amount, 2)),
        updated_at = now()
      WHERE payable_id = v_payable_id AND status != 'Paid';

      v_reconciled_count := v_reconciled_count + 1;
      v_settled_amount := round(v_settled_amount + v_match_amount, 2);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'reconciled_count', v_reconciled_count,
    'settled_amount', v_settled_amount
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Permissions
-- ----------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.increment_upload_progress_atomic TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_payment_batch_dispatched_atomic TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commit_reconciliation_matches_atomic TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calc_dividend_payable_safe TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calc_interest_payable_safe TO authenticated, service_role;
