-- =============================================================================
-- Migration: ConnectIPS Secret Masking & NCHL Payment Status Lifecycle Sync
-- Fixes:
--   1. Mask connectips_token and connectips_cert_pass in mask_smtp_secrets() /
--      system_settings_safe view and expose *_configured flags cleanly.
--   2. Preserve / explicitly clear ConnectIPS credentials in save_system_settings_global
--      while stripping transient UI flags.
--   3. Allow payment_logs history to survive batch revert (ON DELETE SET NULL).
--   4. Support NCHL ConnectIPS 'Processing' and 'Returned' statuses consistently across
--      installment caps, complete_payment_batch_atomic, and run_ledger_invariant_audit.
--   5. Provide atomic sync_connectips_payment_results() RPC to update payments,
--      recompute paid_amount/remaining_amount/payment_status on payables, and keep
--      parent payment_batches status & totals synchronized.
-- =============================================================================

-- 1. Preserve immutable payment logs across batch reverts without FK errors
ALTER TABLE public.payment_logs
  DROP CONSTRAINT IF EXISTS payment_logs_payment_id_fkey;

ALTER TABLE public.payment_logs
  ADD CONSTRAINT payment_logs_payment_id_fkey
  FOREIGN KEY (payment_id)
  REFERENCES public.payments(id)
  ON DELETE SET NULL;

-- 2. Mask all integration secrets (SMTP, SMS, and NCHL ConnectIPS) in system_settings_safe
CREATE OR REPLACE FUNCTION public.mask_smtp_secrets(j jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN j IS NULL THEN NULL
    ELSE (j - 'smtp_pass' - 'sms_api_key' - 'connectips_token' - 'connectips_cert_pass')
      || jsonb_build_object(
           'smtp_pass_configured', COALESCE(j->>'smtp_pass', '') <> '',
           'sms_api_key_configured', COALESCE(j->>'sms_api_key', '') <> '',
           'connectips_token_configured', COALESCE(j->>'connectips_token', '') <> '',
           'connectips_cert_pass_configured', COALESCE(j->>'connectips_cert_pass', '') <> ''
         )
  END;
$$;

-- 3. Persist ConnectIPS secrets safely and strip transient *_configured / *_clear flags
CREATE OR REPLACE FUNCTION public.save_system_settings_global(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing jsonb;
  v_merged jsonb;
  v_is_admin boolean;
  v_uid uuid := auth.uid();
BEGIN
  v_is_admin := (current_user IN ('postgres', 'service_role', 'supabase_admin'))
    OR (v_uid IS NOT NULL AND public.has_role(v_uid, 'admin'));
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to update system settings.'
      USING ERRCODE = '42501';
  END IF;

  SELECT setting_value INTO v_existing
  FROM public.system_settings
  WHERE setting_key = 'global';

  v_merged := COALESCE(v_existing, '{}'::jsonb) || COALESCE(p_settings, '{}'::jsonb);

  -- Preserve existing secrets when omitted, blank, or masked placeholder unless explicitly cleared
  IF (COALESCE(p_settings->>'smtp_pass', '') = '' OR p_settings->>'smtp_pass' = '••••••••••••')
     AND COALESCE(v_existing->>'smtp_pass', '') <> '' THEN
    v_merged := jsonb_set(v_merged, '{smtp_pass}', v_existing->'smtp_pass');
  END IF;

  IF COALESCE(p_settings->>'connectips_token_clear', 'false') = 'true' THEN
    v_merged := jsonb_set(v_merged, '{connectips_token}', '""'::jsonb);
  ELSIF (COALESCE(p_settings->>'connectips_token', '') = '' OR p_settings->>'connectips_token' = '••••••••••••')
     AND COALESCE(v_existing->>'connectips_token', '') <> '' THEN
    v_merged := jsonb_set(v_merged, '{connectips_token}', v_existing->'connectips_token');
  END IF;

  IF COALESCE(p_settings->>'connectips_cert_pass_clear', 'false') = 'true' THEN
    v_merged := jsonb_set(v_merged, '{connectips_cert_pass}', '""'::jsonb);
  ELSIF (COALESCE(p_settings->>'connectips_cert_pass', '') = '' OR p_settings->>'connectips_cert_pass' = '••••••••••••')
     AND COALESCE(v_existing->>'connectips_cert_pass', '') <> '' THEN
    v_merged := jsonb_set(v_merged, '{connectips_cert_pass}', v_existing->'connectips_cert_pass');
  END IF;

  IF (COALESCE(p_settings->>'sms_api_key', '') = '' OR p_settings->>'sms_api_key' = '••••••••••••')
     AND COALESCE(v_existing->>'sms_api_key', '') <> '' THEN
    v_merged := jsonb_set(v_merged, '{sms_api_key}', v_existing->'sms_api_key');
  END IF;

  v_merged := ((((((v_merged
    - 'smtp_pass_configured')
    - 'sms_api_key_configured')
    - 'connectips_token_configured')
    - 'connectips_cert_pass_configured')
    - 'connectips_token_clear')
    - 'connectips_cert_pass_clear');

  INSERT INTO public.system_settings (setting_key, setting_value, updated_by, updated_at)
  VALUES ('global', v_merged, v_uid, now())
  ON CONFLICT (setting_key)
  DO UPDATE SET
    setting_value = EXCLUDED.setting_value,
    updated_by = COALESCE(EXCLUDED.updated_by, public.system_settings.updated_by),
    updated_at = now();

  RETURN public.mask_smtp_secrets(v_merged);
END;
$$;

-- 4. Exclude Returned/Rejected ConnectIPS payments from installment locks & caps
DROP INDEX IF EXISTS public.uq_active_payments_batch_payable;
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_payments_batch_payable
  ON public.payments (batch_id, payable_id)
  WHERE status NOT IN ('Failed', 'Rejected', 'Reversed', 'Cancelled', 'Returned')
    AND payable_id IS NOT NULL
    AND batch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_payment_installment_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_net_payable numeric := 0;
  v_active_sum numeric := 0;
BEGIN
  IF NEW.payable_id IS NULL OR NEW.status IN ('Failed', 'Rejected', 'Reversed', 'Cancelled', 'Returned') THEN
    RETURN NEW;
  END IF;

  IF LOWER(COALESCE(NEW.payable_type, '')) IN ('interest', 'interest_payables', 'debenture') THEN
    SELECT net_payable INTO v_net_payable FROM public.interest_payables WHERE id = NEW.payable_id;
  ELSIF LOWER(COALESCE(NEW.payable_type, '')) IN ('mutual_fund', 'mutual_fund_payables') THEN
    SELECT net_payable INTO v_net_payable FROM public.mutual_fund_payables WHERE id = NEW.payable_id;
  ELSE
    SELECT net_payable INTO v_net_payable FROM public.dividend_payables WHERE id = NEW.payable_id;
  END IF;

  IF v_net_payable IS NOT NULL AND v_net_payable > 0 THEN
    SELECT COALESCE(SUM(p.net_amount), 0) INTO v_active_sum
    FROM public.payments p
    WHERE p.payable_id = NEW.payable_id
      AND p.id IS DISTINCT FROM NEW.id
      AND p.status NOT IN ('Failed', 'Rejected', 'Reversed', 'Cancelled', 'Returned');

    IF (v_active_sum + COALESCE(NEW.net_amount, 0)) > (v_net_payable + 0.05) THEN
      RAISE EXCEPTION 'Over-allocation blocked: cumulative active payments (%) exceed payable net_payable (%) for payable %',
        (v_active_sum + COALESCE(NEW.net_amount, 0)), v_net_payable, NEW.payable_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 5. Keep complete_payment_batch_atomic aligned with Returned / Paid statuses
CREATE OR REPLACE FUNCTION public.complete_payment_batch_atomic(p_batch_id uuid, p_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $$
DECLARE
  v_batch record;
  v_actor_id uuid;
  v_jwt_role text;
  v_from_trigger boolean := (COALESCE(current_setting('rtarts.from_completion_trigger', true), '') = 'true');
  v_today date := CURRENT_DATE;
  v_payments_updated int := 0;
  v_div_updated int := 0;
  v_int_updated int := 0;
  v_mf_updated int := 0;
BEGIN
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF COALESCE(v_jwt_role, '') <> 'service_role'
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    PERFORM public.require_role('admin', 'supervisor', 'approver');
  END IF;

  v_actor_id := COALESCE(auth.uid(), p_user_id);

  SELECT * INTO v_batch
  FROM public.payment_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment batch with id % not found', p_batch_id;
  END IF;

  IF v_batch.status = 'Completed' AND NOT v_from_trigger THEN
    RETURN jsonb_build_object(
      'success', true,
      'batch_id', p_batch_id,
      'message', 'Batch is already completed'
    );
  END IF;

  IF COALESCE(v_jwt_role, '') <> 'service_role'
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin')
     AND v_batch.company_id IS NOT NULL
     AND v_actor_id IS NOT NULL THEN
    IF NOT public.has_company_access(v_actor_id, v_batch.company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to company % for payment batch %', v_batch.company_id, p_batch_id USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM set_config('rtarts.completing_batch', 'true', true);

  WITH updated_payments AS (
    UPDATE public.payments
    SET
      status = 'Completed',
      payment_date = COALESCE(payment_date, v_today),
      paid_amount = COALESCE(NULLIF(paid_amount, 0), net_amount),
      processed_at = COALESCE(processed_at, NOW()),
      updated_at = NOW()
    WHERE batch_id = p_batch_id
      AND status NOT IN ('Completed', 'Paid', 'Failed', 'Rejected', 'Reversed', 'Cancelled', 'Returned')
    RETURNING id, payable_id, payable_type
  )
  SELECT count(*) INTO v_payments_updated FROM updated_payments;

  WITH batch_payables AS (
    SELECT DISTINCT payable_id
    FROM public.payments
    WHERE batch_id = p_batch_id
      AND status IN ('Completed', 'Paid')
      AND LOWER(COALESCE(payable_type, '')) IN ('dividend', 'dividend_payables')
      AND payable_id IS NOT NULL
  ),
  settled_sums AS (
    SELECT
      bp.payable_id,
      COALESCE(SUM(COALESCE(NULLIF(p.paid_amount, 0), p.net_amount)), 0) AS total_paid
    FROM batch_payables bp
    JOIN public.payments p ON p.payable_id = bp.payable_id AND p.status IN ('Completed', 'Paid')
    GROUP BY bp.payable_id
  ),
  div_matches AS (
    UPDATE public.dividend_payables dp
    SET
      paid_amount = LEAST(dp.net_payable, s.total_paid),
      remaining_amount = GREATEST(0, dp.net_payable - LEAST(dp.net_payable, s.total_paid)),
      payment_status = CASE
        WHEN (dp.net_payable - LEAST(dp.net_payable, s.total_paid)) <= 0.05 THEN 'Paid'::public.payment_status
        WHEN s.total_paid > 0 THEN 'Partial'::public.payment_status
        ELSE 'Pending'::public.payment_status
      END,
      payment_date = COALESCE(dp.payment_date, v_today),
      updated_at = NOW()
    FROM settled_sums s
    WHERE dp.id = s.payable_id
    RETURNING dp.id
  )
  SELECT count(*) INTO v_div_updated FROM div_matches;

  WITH batch_payables AS (
    SELECT DISTINCT payable_id
    FROM public.payments
    WHERE batch_id = p_batch_id
      AND status IN ('Completed', 'Paid')
      AND LOWER(COALESCE(payable_type, '')) IN ('interest', 'interest_payables', 'debenture')
      AND payable_id IS NOT NULL
  ),
  settled_sums AS (
    SELECT
      bp.payable_id,
      COALESCE(SUM(COALESCE(NULLIF(p.paid_amount, 0), p.net_amount)), 0) AS total_paid
    FROM batch_payables bp
    JOIN public.payments p ON p.payable_id = bp.payable_id AND p.status IN ('Completed', 'Paid')
    GROUP BY bp.payable_id
  ),
  int_matches AS (
    UPDATE public.interest_payables ip
    SET
      paid_amount = LEAST(ip.net_payable, s.total_paid),
      remaining_amount = GREATEST(0, ip.net_payable - LEAST(ip.net_payable, s.total_paid)),
      payment_status = CASE
        WHEN (ip.net_payable - LEAST(ip.net_payable, s.total_paid)) <= 0.05 THEN 'Paid'::public.payment_status
        WHEN s.total_paid > 0 THEN 'Partial'::public.payment_status
        ELSE 'Pending'::public.payment_status
      END,
      payment_date = COALESCE(ip.payment_date, v_today),
      updated_at = NOW()
    FROM settled_sums s
    WHERE ip.id = s.payable_id
    RETURNING ip.id
  )
  SELECT count(*) INTO v_int_updated FROM int_matches;

  WITH batch_payables AS (
    SELECT DISTINCT payable_id
    FROM public.payments
    WHERE batch_id = p_batch_id
      AND status IN ('Completed', 'Paid')
      AND LOWER(COALESCE(payable_type, '')) IN ('mutual_fund', 'mutual_fund_payables')
      AND payable_id IS NOT NULL
  ),
  settled_sums AS (
    SELECT
      bp.payable_id,
      COALESCE(SUM(COALESCE(NULLIF(p.paid_amount, 0), p.net_amount)), 0) AS total_paid
    FROM batch_payables bp
    JOIN public.payments p ON p.payable_id = bp.payable_id AND p.status IN ('Completed', 'Paid')
    GROUP BY bp.payable_id
  ),
  mf_matches AS (
    UPDATE public.mutual_fund_payables mp
    SET
      paid_amount = LEAST(mp.net_payable, s.total_paid),
      remaining_amount = GREATEST(0, mp.net_payable - LEAST(mp.net_payable, s.total_paid)),
      payment_status = CASE
        WHEN (mp.net_payable - LEAST(mp.net_payable, s.total_paid)) <= 0.05 THEN 'Paid'::public.payment_status
        WHEN s.total_paid > 0 THEN 'Partial'::public.payment_status
        ELSE 'Pending'::public.payment_status
      END,
      payment_date = COALESCE(mp.payment_date, v_today),
      updated_at = NOW()
    FROM settled_sums s
    WHERE mp.id = s.payable_id
    RETURNING mp.id
  )
  SELECT count(*) INTO v_mf_updated FROM mf_matches;

  UPDATE public.payment_batches
  SET
    status = 'Completed',
    processed_at = COALESCE(processed_at, NOW()),
    completed_at = COALESCE(completed_at, NOW()),
    updated_at = NOW()
  WHERE id = p_batch_id;

  PERFORM set_config('rtarts.completing_batch', 'false', true);

  INSERT INTO public.audit_logs (
    user_id, action, table_name, record_id, new_value
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
      'mutual_fund_updated', v_mf_updated,
      'total_amount', v_batch.total_amount
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
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('rtarts.completing_batch', 'false', true);
  RAISE;
END;
$$;

-- 6. Atomic ConnectIPS status synchronization RPC
-- Updates individual payment lines, recomputes paid_amount/remaining_amount/payment_status
-- on all touched payables, and synchronizes parent payment_batches totals and lifecycle status.
CREATE OR REPLACE FUNCTION public.sync_connectips_payment_results(
  p_batch_id uuid DEFAULT NULL::uuid,
  p_updates jsonb DEFAULT '[]'::jsonb,
  p_user_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $$
DECLARE
  v_jwt_role text;
  v_actor_id uuid;
  v_today date := CURRENT_DATE;
  v_item jsonb;
  v_pmt record;
  v_new_status text;
  v_pay_date date;
  v_paid_amt numeric;
  v_updates_applied int := 0;
  v_div_ids uuid[] := '{}'::uuid[];
  v_int_ids uuid[] := '{}'::uuid[];
  v_mf_ids uuid[] := '{}'::uuid[];
  v_batch_ids uuid[] := '{}'::uuid[];
  v_b_id uuid;
  v_b record;
  v_active_count int := 0;
  v_active_amount numeric := 0;
  v_active_tax numeric := 0;
  v_settled_cnt int := 0;
  v_processing_cnt int := 0;
  v_pending_cnt int := 0;
  v_failed_cnt int := 0;
  v_returned_cnt int := 0;
  v_total_cnt int := 0;
  v_derived_status public.payment_batch_status;
  v_final_batch_status text := NULL;
BEGIN
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF COALESCE(v_jwt_role, '') <> 'service_role'
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    PERFORM public.require_role(
      'admin',
      'supervisor',
      'approver',
      'finance_operator',
      'operator',
      'reconciliation_officer'
    );
  END IF;

  v_actor_id := COALESCE(auth.uid(), p_user_id);

  IF p_batch_id IS NOT NULL THEN
    SELECT * INTO v_b FROM public.payment_batches WHERE id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment batch % not found', p_batch_id;
    END IF;
    IF COALESCE(v_jwt_role, '') <> 'service_role'
       AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin')
       AND v_b.company_id IS NOT NULL
       AND v_actor_id IS NOT NULL THEN
      IF NOT public.has_company_access(v_actor_id, v_b.company_id) THEN
        RAISE EXCEPTION 'Unauthorized: caller lacks access to company %', v_b.company_id USING ERRCODE = '42501';
      END IF;
    END IF;
    v_batch_ids := array_append(v_batch_ids, p_batch_id);
  END IF;

  IF p_updates IS NOT NULL AND jsonb_typeof(p_updates) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_updates)
    LOOP
      SELECT * INTO v_pmt
      FROM public.payments
      WHERE id = (v_item->>'payment_id')::uuid
      FOR UPDATE;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      IF COALESCE(v_jwt_role, '') <> 'service_role'
         AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin')
         AND v_pmt.company_id IS NOT NULL
         AND v_actor_id IS NOT NULL THEN
        IF NOT public.has_company_access(v_actor_id, v_pmt.company_id) THEN
          RAISE EXCEPTION 'Unauthorized: caller lacks access to company %', v_pmt.company_id USING ERRCODE = '42501';
        END IF;
      END IF;

      v_new_status := CASE UPPER(TRIM(COALESCE(v_item->>'status', '')))
        WHEN 'COMPLETED' THEN 'Completed'
        WHEN 'PAID' THEN 'Completed'
        WHEN 'SUCCESS' THEN 'Completed'
        WHEN 'SETTLED' THEN 'Completed'
        WHEN 'PROCESSING' THEN 'Processing'
        WHEN 'PENDING_CLEARING' THEN 'Processing'
        WHEN 'SUBMITTED' THEN 'Processing'
        WHEN 'ACCEPTED' THEN 'Processing'
        WHEN 'INITIATED' THEN 'Processing'
        WHEN 'RETURNED' THEN 'Returned'
        WHEN 'RETURN' THEN 'Returned'
        WHEN 'BOUNCED' THEN 'Returned'
        WHEN 'REJECTED' THEN 'Rejected'
        WHEN 'RJCT' THEN 'Rejected'
        WHEN 'FAILED' THEN 'Failed'
        WHEN 'FAIL' THEN 'Failed'
        WHEN 'PENDING' THEN 'Pending'
        ELSE COALESCE(NULLIF(TRIM(v_item->>'status'), ''), v_pmt.status)
      END;

      v_pay_date := COALESCE(NULLIF(v_item->>'payment_date', '')::date, v_pmt.payment_date, v_today);
      v_paid_amt := CASE
        WHEN v_new_status IN ('Completed', 'Paid') THEN
          COALESCE(NULLIF((v_item->>'paid_amount')::numeric, 0), NULLIF(v_pmt.paid_amount, 0), v_pmt.net_amount)
        WHEN v_new_status IN ('Failed', 'Rejected', 'Returned', 'Reversed', 'Cancelled', 'Pending') THEN
          0
        ELSE
          v_pmt.paid_amount
      END;

      UPDATE public.payments
      SET
        status = v_new_status,
        connectips_ref = COALESCE(NULLIF(TRIM(v_item->>'connectips_ref'), ''), connectips_ref),
        payment_reference = COALESCE(NULLIF(TRIM(v_item->>'payment_reference'), ''), NULLIF(TRIM(v_item->>'connectips_ref'), ''), payment_reference),
        payment_date = CASE
          WHEN v_new_status IN ('Completed', 'Paid') THEN v_pay_date
          WHEN v_new_status IN ('Failed', 'Rejected', 'Returned', 'Reversed', 'Cancelled') THEN NULL
          ELSE payment_date
        END,
        paid_amount = v_paid_amt,
        remarks = COALESCE(NULLIF(v_item->>'remarks', ''), remarks),
        reversal_reason = CASE
          WHEN v_new_status IN ('Failed', 'Rejected', 'Returned') THEN
            COALESCE(NULLIF(v_item->>'reversal_reason', ''), NULLIF(v_item->>'remarks', ''), reversal_reason)
          WHEN v_new_status IN ('Completed', 'Paid', 'Processing') THEN NULL
          ELSE reversal_reason
        END,
        processed_by = COALESCE(processed_by, v_actor_id),
        processed_at = CASE
          WHEN v_new_status IN ('Completed', 'Paid', 'Processing') THEN COALESCE(processed_at, NOW())
          ELSE processed_at
        END,
        updated_at = NOW()
      WHERE id = v_pmt.id;

      v_updates_applied := v_updates_applied + 1;

      INSERT INTO public.payment_logs (
        payment_id,
        action,
        previous_status,
        new_status,
        amount,
        notes,
        performed_by
      ) VALUES (
        v_pmt.id,
        'connectips_' || lower(v_new_status),
        v_pmt.status,
        v_new_status,
        v_pmt.net_amount,
        NULLIF(v_item->>'remarks', ''),
        v_actor_id
      );

      IF v_pmt.batch_id IS NOT NULL AND NOT (v_pmt.batch_id = ANY(v_batch_ids)) THEN
        v_batch_ids := array_append(v_batch_ids, v_pmt.batch_id);
      END IF;

      IF v_pmt.payable_id IS NOT NULL THEN
        IF LOWER(COALESCE(v_pmt.payable_type, '')) IN ('interest', 'interest_payables', 'debenture') THEN
          IF NOT (v_pmt.payable_id = ANY(v_int_ids)) THEN
            v_int_ids := array_append(v_int_ids, v_pmt.payable_id);
          END IF;
        ELSIF LOWER(COALESCE(v_pmt.payable_type, '')) IN ('mutual_fund', 'mutual_fund_payables') THEN
          IF NOT (v_pmt.payable_id = ANY(v_mf_ids)) THEN
            v_mf_ids := array_append(v_mf_ids, v_pmt.payable_id);
          END IF;
        ELSE
          IF NOT (v_pmt.payable_id = ANY(v_div_ids)) THEN
            v_div_ids := array_append(v_div_ids, v_pmt.payable_id);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Synchronize touched dividend_payables
  IF array_length(v_div_ids, 1) > 0 THEN
    WITH target_sums AS (
      SELECT
        u.id AS payable_id,
        COALESCE(SUM(COALESCE(NULLIF(p.paid_amount, 0), p.net_amount)), 0) AS total_paid,
        MAX(p.payment_date) AS last_pay_date,
        MAX(COALESCE(NULLIF(p.connectips_ref, ''), p.payment_reference)) AS last_pay_ref
      FROM unnest(v_div_ids) AS u(id)
      LEFT JOIN public.payments p
        ON p.payable_id = u.id
       AND p.status IN ('Completed', 'Paid')
      GROUP BY u.id
    )
    UPDATE public.dividend_payables dp
    SET
      paid_amount = LEAST(dp.net_payable, ts.total_paid),
      remaining_amount = GREATEST(0, dp.net_payable - LEAST(dp.net_payable, ts.total_paid)),
      payment_status = CASE
        WHEN (dp.net_payable - LEAST(dp.net_payable, ts.total_paid)) <= 0.05 AND dp.net_payable > 0 THEN 'Paid'::public.payment_status
        WHEN ts.total_paid > 0 THEN 'Partial'::public.payment_status
        ELSE 'Pending'::public.payment_status
      END,
      payment_date = ts.last_pay_date,
      payment_reference = ts.last_pay_ref,
      updated_at = NOW()
    FROM target_sums ts
    WHERE dp.id = ts.payable_id;
  END IF;

  -- Synchronize touched interest_payables
  IF array_length(v_int_ids, 1) > 0 THEN
    WITH target_sums AS (
      SELECT
        u.id AS payable_id,
        COALESCE(SUM(COALESCE(NULLIF(p.paid_amount, 0), p.net_amount)), 0) AS total_paid,
        MAX(p.payment_date) AS last_pay_date,
        MAX(COALESCE(NULLIF(p.connectips_ref, ''), p.payment_reference)) AS last_pay_ref
      FROM unnest(v_int_ids) AS u(id)
      LEFT JOIN public.payments p
        ON p.payable_id = u.id
       AND p.status IN ('Completed', 'Paid')
      GROUP BY u.id
    )
    UPDATE public.interest_payables ip
    SET
      paid_amount = LEAST(ip.net_payable, ts.total_paid),
      remaining_amount = GREATEST(0, ip.net_payable - LEAST(ip.net_payable, ts.total_paid)),
      payment_status = CASE
        WHEN (ip.net_payable - LEAST(ip.net_payable, ts.total_paid)) <= 0.05 AND ip.net_payable > 0 THEN 'Paid'::public.payment_status
        WHEN ts.total_paid > 0 THEN 'Partial'::public.payment_status
        ELSE 'Pending'::public.payment_status
      END,
      payment_date = ts.last_pay_date,
      payment_reference = ts.last_pay_ref,
      updated_at = NOW()
    FROM target_sums ts
    WHERE ip.id = ts.payable_id;
  END IF;

  -- Synchronize touched mutual_fund_payables
  IF array_length(v_mf_ids, 1) > 0 THEN
    WITH target_sums AS (
      SELECT
        u.id AS payable_id,
        COALESCE(SUM(COALESCE(NULLIF(p.paid_amount, 0), p.net_amount)), 0) AS total_paid,
        MAX(p.payment_date) AS last_pay_date,
        MAX(COALESCE(NULLIF(p.connectips_ref, ''), p.payment_reference)) AS last_pay_ref
      FROM unnest(v_mf_ids) AS u(id)
      LEFT JOIN public.payments p
        ON p.payable_id = u.id
       AND p.status IN ('Completed', 'Paid')
      GROUP BY u.id
    )
    UPDATE public.mutual_fund_payables mp
    SET
      paid_amount = LEAST(mp.net_payable, ts.total_paid),
      remaining_amount = GREATEST(0, mp.net_payable - LEAST(mp.net_payable, ts.total_paid)),
      payment_status = CASE
        WHEN (mp.net_payable - LEAST(mp.net_payable, ts.total_paid)) <= 0.05 AND mp.net_payable > 0 THEN 'Paid'::public.payment_status
        WHEN ts.total_paid > 0 THEN 'Partial'::public.payment_status
        ELSE 'Pending'::public.payment_status
      END,
      payment_date = ts.last_pay_date,
      payment_reference = ts.last_pay_ref,
      updated_at = NOW()
    FROM target_sums ts
    WHERE mp.id = ts.payable_id;
  END IF;

  -- Recompute totals & lifecycle status on all touched payment_batches
  IF array_length(v_batch_ids, 1) > 0 THEN
    FOREACH v_b_id IN ARRAY v_batch_ids
    LOOP
      SELECT * INTO v_b FROM public.payment_batches WHERE id = v_b_id FOR UPDATE;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      SELECT
        COUNT(*) FILTER (WHERE COALESCE(status, 'Pending') NOT IN ('Failed', 'Rejected', 'Returned', 'Reversed', 'Cancelled')),
        COALESCE(SUM(net_amount) FILTER (WHERE COALESCE(status, 'Pending') NOT IN ('Failed', 'Rejected', 'Returned', 'Reversed', 'Cancelled')), 0),
        COALESCE(SUM(tax_amount) FILTER (WHERE COALESCE(status, 'Pending') NOT IN ('Failed', 'Rejected', 'Returned', 'Reversed', 'Cancelled')), 0),
        COUNT(*) FILTER (WHERE status IN ('Completed', 'Paid')),
        COUNT(*) FILTER (WHERE status = 'Processing'),
        COUNT(*) FILTER (WHERE status IN ('Pending', 'Draft')),
        COUNT(*) FILTER (WHERE status IN ('Failed', 'Rejected')),
        COUNT(*) FILTER (WHERE status IN ('Returned', 'Reversed')),
        COUNT(*) FILTER (WHERE status <> 'Cancelled')
      INTO
        v_active_count,
        v_active_amount,
        v_active_tax,
        v_settled_cnt,
        v_processing_cnt,
        v_pending_cnt,
        v_failed_cnt,
        v_returned_cnt,
        v_total_cnt
      FROM public.payments
      WHERE batch_id = v_b_id;

      IF v_b.status IN ('Approved', 'Processed', 'Completed', 'Failed', 'Returned') AND v_total_cnt > 0 THEN
        IF v_settled_cnt > 0 AND v_processing_cnt = 0 AND v_pending_cnt = 0 AND v_failed_cnt = 0 AND v_returned_cnt = 0 THEN
          v_derived_status := 'Completed'::public.payment_batch_status;
        ELSIF v_processing_cnt > 0 OR (v_settled_cnt > 0 AND (v_pending_cnt > 0 OR v_failed_cnt > 0 OR v_returned_cnt > 0)) THEN
          v_derived_status := 'Processed'::public.payment_batch_status;
        ELSIF v_returned_cnt > 0 AND (v_returned_cnt + v_failed_cnt) = v_total_cnt THEN
          v_derived_status := 'Returned'::public.payment_batch_status;
        ELSIF v_failed_cnt = v_total_cnt THEN
          v_derived_status := 'Failed'::public.payment_batch_status;
        ELSE
          v_derived_status := v_b.status;
        END IF;
      ELSE
        v_derived_status := v_b.status;
      END IF;

      PERFORM set_config('rtarts.completing_batch', 'true', true);
      UPDATE public.payment_batches
      SET
        total_payments = v_active_count,
        total_amount = v_active_amount,
        total_tax = v_active_tax,
        status = v_derived_status,
        processed_at = CASE
          WHEN v_derived_status IN ('Processed', 'Completed') THEN COALESCE(processed_at, NOW())
          ELSE processed_at
        END,
        completed_at = CASE
          WHEN v_derived_status = 'Completed' THEN COALESCE(completed_at, NOW())
          WHEN v_derived_status IN ('Processed', 'Failed', 'Returned') THEN NULL
          ELSE completed_at
        END,
        updated_at = NOW()
      WHERE id = v_b_id;
      PERFORM set_config('rtarts.completing_batch', 'false', true);

      v_final_batch_status := v_derived_status::text;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'updates_applied', v_updates_applied,
    'batch_status', v_final_batch_status,
    'counts', jsonb_build_object(
      'settled', v_settled_cnt,
      'processing', v_processing_cnt,
      'pending', v_pending_cnt,
      'failed', v_failed_cnt,
      'returned', v_returned_cnt,
      'total', v_total_cnt
    )
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('rtarts.completing_batch', 'false', true);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_connectips_payment_results(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_connectips_payment_results(uuid, jsonb, uuid) TO authenticated, service_role;

-- 7. Keep run_ledger_invariant_audit synchronized with Failed/Rejected/Returned payment statuses
CREATE OR REPLACE FUNCTION public.run_ledger_invariant_audit(p_company_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_div_mismatch bigint := 0;
  v_int_mismatch bigint := 0;
  v_mf_mismatch bigint := 0;
  v_batch_sum_mismatch bigint := 0;
  v_completed_pending_payments bigint := 0;
  v_paid_zero_amount bigint := 0;
  v_unclassified_in_batches bigint := 0;
  v_checks jsonb;
  v_passed boolean;
BEGIN
  IF v_uid IS NOT NULL THEN
    IF NOT (SELECT public.has_any_role(
      v_uid,
      ARRAY['admin', 'supervisor', 'auditor', 'finance_operator']::public.app_role[]
    )) THEN
      RAISE EXCEPTION 'Forbidden: insufficient role for ledger invariant audit' USING ERRCODE = '42501';
    END IF;
    IF p_company_id IS NOT NULL AND NOT public.has_company_access(v_uid, p_company_id) THEN
      RAISE EXCEPTION 'Forbidden: caller lacks access to company %', p_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT count(*) INTO v_div_mismatch
  FROM public.dividend_payables dp
  WHERE (p_company_id IS NULL OR dp.company_id = p_company_id)
    AND abs(
      COALESCE(dp.gross_dividend, 0)
      - COALESCE(dp.tax_amount, 0)
      - CASE WHEN COALESCE(dp.bonus_tax_mode, 'CASH_ADJUSTED') = 'CASH_ADJUSTED' THEN COALESCE(dp.bonus_tax, 0) ELSE 0 END
      - COALESCE(dp.net_payable, 0)
    ) > 0.05;

  SELECT count(*) INTO v_int_mismatch
  FROM public.interest_payables ip
  WHERE (p_company_id IS NULL OR ip.company_id = p_company_id)
    AND abs(
      COALESCE(ip.gross_interest, 0)
      - COALESCE(ip.tax_amount, 0)
      - COALESCE(ip.net_payable, 0)
    ) > 0.05;

  SELECT count(*) INTO v_mf_mismatch
  FROM public.mutual_fund_payables mf
  WHERE (p_company_id IS NULL OR mf.company_id = p_company_id)
    AND abs(
      COALESCE(mf.gross_dividend, 0)
      - COALESCE(mf.tax_amount, 0)
      - CASE WHEN COALESCE(mf.bonus_tax_mode, 'CASH_ADJUSTED') = 'CASH_ADJUSTED' THEN COALESCE(mf.bonus_tax, 0) ELSE 0 END
      - COALESCE(mf.net_payable, 0)
    ) > 0.05;

  SELECT count(*) INTO v_batch_sum_mismatch
  FROM (
    SELECT
      pb.id,
      pb.total_amount,
      COALESCE(
        SUM(p.net_amount) FILTER (
          WHERE COALESCE(p.status, 'Pending') NOT IN ('Failed', 'Rejected', 'Returned', 'Reversed', 'Cancelled')
        ),
        0
      ) AS calc_sum
    FROM public.payment_batches pb
    LEFT JOIN public.payments p
      ON p.batch_id = pb.id
    WHERE (p_company_id IS NULL OR pb.company_id = p_company_id)
      AND COALESCE(pb.status::text, '') NOT IN ('Reversed', 'Cancelled')
    GROUP BY pb.id, pb.total_amount
    HAVING abs(
      COALESCE(pb.total_amount, 0) - COALESCE(
        SUM(p.net_amount) FILTER (
          WHERE COALESCE(p.status, 'Pending') NOT IN ('Failed', 'Rejected', 'Returned', 'Reversed', 'Cancelled')
        ),
        0
      )
    ) > 0.05
  ) t;

  SELECT count(*) INTO v_completed_pending_payments
  FROM public.payment_batches pb
  JOIN public.payments p ON p.batch_id = pb.id
  WHERE (p_company_id IS NULL OR pb.company_id = p_company_id)
    AND pb.status = 'Completed'
    AND COALESCE(p.status, 'Pending') NOT IN ('Completed', 'Paid', 'Failed', 'Rejected', 'Returned', 'Reversed', 'Cancelled');

  SELECT (
    (SELECT count(*) FROM public.dividend_payables WHERE (p_company_id IS NULL OR company_id = p_company_id) AND payment_status = 'Paid' AND COALESCE(net_payable, 0) > 0 AND COALESCE(paid_amount, 0) <= 0)
    + (SELECT count(*) FROM public.interest_payables WHERE (p_company_id IS NULL OR company_id = p_company_id) AND payment_status = 'Paid' AND COALESCE(net_payable, 0) > 0 AND COALESCE(paid_amount, 0) <= 0)
    + (SELECT count(*) FROM public.mutual_fund_payables WHERE (p_company_id IS NULL OR company_id = p_company_id) AND payment_status = 'Paid' AND COALESCE(net_payable, 0) > 0 AND COALESCE(paid_amount, 0) <= 0)
  ) INTO v_paid_zero_amount;

  SELECT count(*) INTO v_unclassified_in_batches
  FROM public.payments p
  LEFT JOIN public.dividend_payables dp ON p.payable_type = 'dividend' AND p.payable_id = dp.id
  LEFT JOIN public.interest_payables ip ON p.payable_type = 'interest' AND p.payable_id = ip.id
  LEFT JOIN public.mutual_fund_payables mf ON p.payable_type = 'mutual_fund' AND p.payable_id = mf.id
  WHERE (p_company_id IS NULL OR p.company_id = p_company_id)
    AND COALESCE(p.status, 'Pending') NOT IN ('Reversed', 'Cancelled', 'Failed', 'Rejected', 'Returned')
    AND (
      (p.payable_type = 'dividend' AND dp.id IS NOT NULL AND (dp.payee_classification = 'UNCLASSIFIED' OR dp.classification_status = 'REVIEW_REQUIRED'))
      OR (p.payable_type = 'interest' AND ip.id IS NOT NULL AND (ip.payee_classification = 'UNCLASSIFIED' OR ip.classification_status = 'REVIEW_REQUIRED'))
      OR (p.payable_type = 'mutual_fund' AND mf.id IS NOT NULL AND (mf.payee_classification = 'UNCLASSIFIED' OR mf.classification_status = 'REVIEW_REQUIRED'))
    );

  v_checks := jsonb_build_array(
    jsonb_build_object('code', 'DIVIDEND_BALANCE_INVARIANT', 'label', 'Dividend Gross - CashTax - BonusTax = Net', 'violations', v_div_mismatch, 'passed', v_div_mismatch = 0),
    jsonb_build_object('code', 'INTEREST_BALANCE_INVARIANT', 'label', 'Debenture Interest Gross - Tax = Net', 'violations', v_int_mismatch, 'passed', v_int_mismatch = 0),
    jsonb_build_object('code', 'MUTUAL_FUND_BALANCE_INVARIANT', 'label', 'Mutual Fund Gross - CashTax - BonusTax = Net', 'violations', v_mf_mismatch, 'passed', v_mf_mismatch = 0),
    jsonb_build_object('code', 'BATCH_PAYMENT_SUM_PARITY', 'label', 'Payment Batch Total = Active Payment Lines Sum', 'violations', v_batch_sum_mismatch, 'passed', v_batch_sum_mismatch = 0),
    jsonb_build_object('code', 'COMPLETED_BATCH_LINE_SETTLEMENT', 'label', 'Completed Batches Have Zero Unsettled Lines', 'violations', v_completed_pending_payments, 'passed', v_completed_pending_payments = 0),
    jsonb_build_object('code', 'PAID_PAYABLE_NONZERO_SETTLED_AMOUNT', 'label', 'Paid Payables Have Positive paid_amount', 'violations', v_paid_zero_amount, 'passed', v_paid_zero_amount = 0),
    jsonb_build_object('code', 'BATCH_CLASSIFICATION_GATE', 'label', 'Active Payment Batches Exclude Unclassified/Review Rows', 'violations', v_unclassified_in_batches, 'passed', v_unclassified_in_batches = 0)
  );

  v_passed := (v_div_mismatch + v_int_mismatch + v_mf_mismatch + v_batch_sum_mismatch + v_completed_pending_payments + v_paid_zero_amount + v_unclassified_in_batches) = 0;

  RETURN jsonb_build_object(
    'audited_at', now(),
    'company_id', p_company_id,
    'passed', v_passed,
    'total_violations', v_div_mismatch + v_int_mismatch + v_mf_mismatch + v_batch_sum_mismatch + v_completed_pending_payments + v_paid_zero_amount + v_unclassified_in_batches,
    'checks', v_checks
  );
END;
$$;
