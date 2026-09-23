-- Migration: 20261196000000_optimize_rollback_orphan_cleanup.sql
-- Optimizes rollback_upload_atomic so orphan client cleanup is strictly scoped
-- to client IDs associated with the payables being deleted, rather than a full-table
-- scan across the entire client demographics database which caused statement timeouts.

CREATE OR REPLACE FUNCTION public.rollback_upload_atomic(
  p_upload_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec record;
  v_interest_deleted int := 0;
  v_dividend_deleted int := 0;
  v_mf_deleted int := 0;
  v_total_payables_deleted int := 0;
  v_payments_cleaned int := 0;
  v_errors_deleted int := 0;
  v_orphans_deleted int := 0;
  v_actor_id uuid;
  v_is_admin boolean;
  v_is_operator boolean;
BEGIN
  -- Authorization check
  IF auth.uid() IS NOT NULL THEN
    v_is_admin := public.has_role(auth.uid(), 'admin'::app_role);
    v_is_operator := public.has_role(auth.uid(), 'finance_operator'::app_role);
    IF NOT (v_is_admin OR v_is_operator) THEN
      RAISE EXCEPTION 'Access denied. Rollback requires admin or finance_operator role.';
    END IF;
  END IF;

  v_actor_id := COALESCE(auth.uid(), p_user_id);

  -- 1. Fetch and lock the upload record
  SELECT * INTO v_rec
  FROM public.upload_history
  WHERE id = p_upload_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Upload record with ID % not found', p_upload_id;
  END IF;

  -- If already rolled back, exit cleanly
  IF v_rec.status = 'RolledBack' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_rolled_back', true,
      'message', 'Upload has already been rolled back.',
      'upload_id', p_upload_id,
      'payables_deleted', 0,
      'clients_deleted', 0,
      'errors_deleted', 0
    );
  END IF;

  -- 2. Capture target payables and candidate clients in temp table
  CREATE TEMP TABLE IF NOT EXISTS temp_rollback_targets (
    id uuid,
    client_id uuid
  ) ON COMMIT DROP;

  TRUNCATE temp_rollback_targets;

  INSERT INTO temp_rollback_targets (id, client_id)
  SELECT id, client_id FROM public.interest_payables WHERE upload_id = p_upload_id
  UNION ALL
  SELECT id, client_id FROM public.dividend_payables WHERE upload_id = p_upload_id
  UNION ALL
  SELECT id, client_id FROM public.mutual_fund_payables WHERE upload_id = p_upload_id;

  -- 3. Clean up any un-finalized payments referencing payables in this upload
  WITH del_pmts AS (
    DELETE FROM public.payments
    WHERE payable_id IN (SELECT id FROM temp_rollback_targets)
      AND status IN ('Draft', 'Pending', 'Failed', 'Rejected')
    RETURNING id
  )
  SELECT count(*) INTO v_payments_cleaned FROM del_pmts;

  -- 4. Delete interest_payables
  WITH del_int AS (
    DELETE FROM public.interest_payables
    WHERE upload_id = p_upload_id
    RETURNING id
  )
  SELECT count(*) INTO v_interest_deleted FROM del_int;

  -- 5. Delete dividend_payables
  WITH del_div AS (
    DELETE FROM public.dividend_payables
    WHERE upload_id = p_upload_id
    RETURNING id
  )
  SELECT count(*) INTO v_dividend_deleted FROM del_div;

  -- 6. Delete mutual_fund_payables
  WITH del_mf AS (
    DELETE FROM public.mutual_fund_payables
    WHERE upload_id = p_upload_id
    RETURNING id
  )
  SELECT count(*) INTO v_mf_deleted FROM del_mf;

  v_total_payables_deleted := v_interest_deleted + v_dividend_deleted + v_mf_deleted;

  -- 7. Delete upload errors
  WITH del_err AS (
    DELETE FROM public.upload_errors
    WHERE upload_id = p_upload_id
    RETURNING id
  )
  SELECT count(*) INTO v_errors_deleted FROM del_err;

  -- 8. Safely delete orphan clients that belonged to this upload and have no remaining payables
  WITH candidate_clients AS (
    SELECT DISTINCT client_id FROM temp_rollback_targets WHERE client_id IS NOT NULL
  ),
  del_clients AS (
    DELETE FROM public.clients c
    WHERE c.id IN (SELECT client_id FROM candidate_clients)
      AND NOT EXISTS (SELECT 1 FROM public.dividend_payables d WHERE d.client_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.interest_payables i WHERE i.client_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.mutual_fund_payables m WHERE m.client_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.client_id = c.id)
    RETURNING id
  )
  SELECT count(*) INTO v_orphans_deleted FROM del_clients;

  -- 9. Mark this upload record as RolledBack
  UPDATE public.upload_history
  SET
    status = 'RolledBack',
    completed_at = now()
  WHERE id = p_upload_id;

  -- 10. Unblock re-uploading for this specific upload record's exact file_hash
  IF v_rec.file_hash IS NOT NULL AND v_rec.file_hash != '' THEN
    UPDATE public.upload_history
    SET status = 'RolledBack', completed_at = now()
    WHERE file_hash = v_rec.file_hash AND status != 'RolledBack';
  END IF;

  -- 11. Write audit log
  BEGIN
    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_value, new_value)
    VALUES (
      v_actor_id,
      'ROLLBACK_UPLOAD',
      'upload_history',
      p_upload_id::text,
      jsonb_build_object(
        'file_name', v_rec.file_name,
        'sheet_name', v_rec.sheet_name,
        'target_table', v_rec.target_table,
        'previous_status', v_rec.status
      ),
      jsonb_build_object(
        'status', 'RolledBack',
        'payables_deleted', v_total_payables_deleted,
        'interest_deleted', v_interest_deleted,
        'dividend_deleted', v_dividend_deleted,
        'mutual_fund_deleted', v_mf_deleted,
        'payments_cleaned', v_payments_cleaned,
        'errors_deleted', v_errors_deleted,
        'clients_deleted', v_orphans_deleted
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'upload_id', p_upload_id,
    'file_name', v_rec.file_name,
    'sheet_name', v_rec.sheet_name,
    'payables_deleted', v_total_payables_deleted,
    'interest_deleted', v_interest_deleted,
    'dividend_deleted', v_dividend_deleted,
    'mutual_fund_deleted', v_mf_deleted,
    'payments_cleaned', v_payments_cleaned,
    'errors_deleted', v_errors_deleted,
    'clients_deleted', v_orphans_deleted
  );
END;
$$;
