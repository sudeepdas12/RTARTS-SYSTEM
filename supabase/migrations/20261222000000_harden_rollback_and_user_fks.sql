-- Migration: 20261222000000_harden_rollback_and_user_fks.sql
-- 1. Secure rollback RPCs against unauthenticated anonymous execution
-- 2. Update foreign keys referencing auth.users to ON DELETE SET NULL to preserve audit history while permitting user deletion

-- ============================================================================
-- PART 1: SECURE ROLLBACK RPCS
-- ============================================================================

-- Revoke public / anon privileges
REVOKE EXECUTE ON FUNCTION public.rollback_upload_atomic(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rollback_upload_file_atomic(text, text, uuid) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.rollback_upload_atomic(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rollback_upload_file_atomic(text, text, uuid) TO authenticated, service_role;

-- Re-create rollback_upload_atomic with strict authentication & role verification
CREATE OR REPLACE FUNCTION public.rollback_upload_atomic(
  p_upload_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  -- 1. Enforce strict authentication check
  IF auth.uid() IS NULL AND current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- 2. Verify authorization for authenticated sessions
  IF auth.uid() IS NOT NULL THEN
    v_is_admin := public.has_role(auth.uid(), 'admin'::app_role);
    v_is_operator := public.has_role(auth.uid(), 'finance_operator'::app_role);
    IF NOT (v_is_admin OR v_is_operator) THEN
      RAISE EXCEPTION 'Access denied. Rollback requires admin or finance_operator role.';
    END IF;
  END IF;

  v_actor_id := COALESCE(auth.uid(), p_user_id);

  -- 3. Fetch and lock the upload record
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

  -- 4. Capture target payables and candidate clients in temp table
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

  -- 5. Clean up any un-finalized payments referencing payables in this upload
  WITH del_pmts AS (
    DELETE FROM public.payments
    WHERE payable_id IN (SELECT id FROM temp_rollback_targets)
      AND status IN ('Draft', 'Pending', 'Failed', 'Rejected')
    RETURNING id
  )
  SELECT count(*) INTO v_payments_cleaned FROM del_pmts;

  -- 6. Delete interest_payables
  WITH del_int AS (
    DELETE FROM public.interest_payables
    WHERE upload_id = p_upload_id
    RETURNING id
  )
  SELECT count(*) INTO v_interest_deleted FROM del_int;

  -- 7. Delete dividend_payables
  WITH del_div AS (
    DELETE FROM public.dividend_payables
    WHERE upload_id = p_upload_id
    RETURNING id
  )
  SELECT count(*) INTO v_dividend_deleted FROM del_div;

  -- 8. Delete mutual_fund_payables
  WITH del_mf AS (
    DELETE FROM public.mutual_fund_payables
    WHERE upload_id = p_upload_id
    RETURNING id
  )
  SELECT count(*) INTO v_mf_deleted FROM del_mf;

  v_total_payables_deleted := v_interest_deleted + v_dividend_deleted + v_mf_deleted;

  -- 9. Delete upload errors
  WITH del_err AS (
    DELETE FROM public.upload_errors
    WHERE upload_id = p_upload_id
    RETURNING id
  )
  SELECT count(*) INTO v_errors_deleted FROM del_err;

  -- 10. Safely delete orphan clients that belonged to this upload and have no remaining payables
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

  -- 11. Mark this upload record as RolledBack
  UPDATE public.upload_history
  SET
    status = 'RolledBack',
    completed_at = now()
  WHERE id = p_upload_id;

  -- 12. Unblock re-uploading for this specific upload record's exact file_hash
  IF v_rec.file_hash IS NOT NULL AND v_rec.file_hash != '' THEN
    UPDATE public.upload_history
    SET status = 'RolledBack', completed_at = now()
    WHERE file_hash = v_rec.file_hash AND status != 'RolledBack';
  END IF;

  -- 13. Write audit log
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

-- Re-create rollback_upload_file_atomic with strict authentication check
CREATE OR REPLACE FUNCTION public.rollback_upload_file_atomic(
  p_file_hash text DEFAULT NULL,
  p_file_name text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rec record;
  v_sheets_count int := 0;
  v_total_payables int := 0;
  v_total_clients int := 0;
  v_total_errors int := 0;
  v_sheet_res jsonb;
  v_base_hash text;
BEGIN
  -- 1. Enforce strict authentication check
  IF auth.uid() IS NULL AND current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- 2. Verify authorization
  IF auth.uid() IS NOT NULL THEN
    IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'finance_operator'::app_role)) THEN
      RAISE EXCEPTION 'Access denied. Rollback requires admin or finance_operator role.';
    END IF;
  END IF;

  IF p_file_hash IS NULL AND p_file_name IS NULL THEN
    RAISE EXCEPTION 'Either p_file_hash or p_file_name must be provided';
  END IF;

  IF p_file_hash IS NOT NULL AND position('-' in p_file_hash) > 0 THEN
    v_base_hash := split_part(p_file_hash, '-', 1);
  ELSE
    v_base_hash := p_file_hash;
  END IF;

  FOR v_rec IN
    SELECT id
    FROM public.upload_history
    WHERE status != 'RolledBack'
      AND (
        (v_base_hash IS NOT NULL AND file_hash LIKE (v_base_hash || '%'))
        OR (p_file_name IS NOT NULL AND file_name = p_file_name)
      )
  LOOP
    v_sheet_res := public.rollback_upload_atomic(v_rec.id, p_user_id);
    v_sheets_count := v_sheets_count + 1;
    v_total_payables := v_total_payables + COALESCE((v_sheet_res ->> 'payables_deleted')::int, 0);
    v_total_clients := v_total_clients + COALESCE((v_sheet_res ->> 'clients_deleted')::int, 0);
    v_total_errors := v_total_errors + COALESCE((v_sheet_res ->> 'errors_deleted')::int, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'sheets_rolled_back', v_sheets_count,
    'payables_deleted', v_total_payables,
    'clients_deleted', v_total_clients,
    'errors_deleted', v_total_errors
  );
END;
$function$;

-- ============================================================================
-- PART 2: ALTER HISTORICAL AUDIT / LEDGER FKS TO ON DELETE SET NULL
-- ============================================================================

DO $$
BEGIN
  -- api_logs (user_id)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_logs_user_id_fkey') THEN
    ALTER TABLE public.api_logs DROP CONSTRAINT api_logs_user_id_fkey;
    ALTER TABLE public.api_logs ADD CONSTRAINT api_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- approval_logs (performed_by)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_logs_performed_by_fkey') THEN
    ALTER TABLE public.approval_logs DROP CONSTRAINT approval_logs_performed_by_fkey;
    ALTER TABLE public.approval_logs ADD CONSTRAINT approval_logs_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- audit_logs (user_id)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_user_id_fkey') THEN
    ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_user_id_fkey;
    ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- bank_statements (uploaded_by)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_statements_uploaded_by_fkey') THEN
    ALTER TABLE public.bank_statements DROP CONSTRAINT bank_statements_uploaded_by_fkey;
    ALTER TABLE public.bank_statements ADD CONSTRAINT bank_statements_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- bank_transactions (uploaded_by)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_transactions_uploaded_by_fkey') THEN
    ALTER TABLE public.bank_transactions DROP CONSTRAINT bank_transactions_uploaded_by_fkey;
    ALTER TABLE public.bank_transactions ADD CONSTRAINT bank_transactions_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- clients (created_by)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_created_by_fkey') THEN
    ALTER TABLE public.clients DROP CONSTRAINT clients_created_by_fkey;
    ALTER TABLE public.clients ADD CONSTRAINT clients_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- companies (created_by)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_created_by_fkey') THEN
    ALTER TABLE public.companies DROP CONSTRAINT companies_created_by_fkey;
    ALTER TABLE public.companies ADD CONSTRAINT companies_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- dividend_payables (created_by)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dividend_payables_created_by_fkey') THEN
    ALTER TABLE public.dividend_payables DROP CONSTRAINT dividend_payables_created_by_fkey;
    ALTER TABLE public.dividend_payables ADD CONSTRAINT dividend_payables_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- error_logs (user_id)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'error_logs_user_id_fkey') THEN
    ALTER TABLE public.error_logs DROP CONSTRAINT error_logs_user_id_fkey;
    ALTER TABLE public.error_logs ADD CONSTRAINT error_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- iaf_allocations (created_by)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'iaf_allocations_created_by_fkey') THEN
    ALTER TABLE public.iaf_allocations DROP CONSTRAINT iaf_allocations_created_by_fkey;
    ALTER TABLE public.iaf_allocations ADD CONSTRAINT iaf_allocations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- interest_payables (created_by)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interest_payables_created_by_fkey') THEN
    ALTER TABLE public.interest_payables DROP CONSTRAINT interest_payables_created_by_fkey;
    ALTER TABLE public.interest_payables ADD CONSTRAINT interest_payables_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- login_logs (user_id)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'login_logs_user_id_fkey') THEN
    ALTER TABLE public.login_logs DROP CONSTRAINT login_logs_user_id_fkey;
    ALTER TABLE public.login_logs ADD CONSTRAINT login_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- mutual_fund_payables (created_by)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mutual_fund_payables_created_by_fkey') THEN
    ALTER TABLE public.mutual_fund_payables DROP CONSTRAINT mutual_fund_payables_created_by_fkey;
    ALTER TABLE public.mutual_fund_payables ADD CONSTRAINT mutual_fund_payables_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- notifications (user_id)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_user_id_fkey') THEN
    ALTER TABLE public.notifications DROP CONSTRAINT notifications_user_id_fkey;
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- payment_batches (created_by, approved_by)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_batches_created_by_fkey') THEN
    ALTER TABLE public.payment_batches DROP CONSTRAINT payment_batches_created_by_fkey;
    ALTER TABLE public.payment_batches ADD CONSTRAINT payment_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_batches_approved_by_fkey') THEN
    ALTER TABLE public.payment_batches DROP CONSTRAINT payment_batches_approved_by_fkey;
    ALTER TABLE public.payment_batches ADD CONSTRAINT payment_batches_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- payment_logs (performed_by)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_logs_performed_by_fkey') THEN
    ALTER TABLE public.payment_logs DROP CONSTRAINT payment_logs_performed_by_fkey;
    ALTER TABLE public.payment_logs ADD CONSTRAINT payment_logs_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- payments (created_by, approved_by, processed_by, reversed_by)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_created_by_fkey') THEN
    ALTER TABLE public.payments DROP CONSTRAINT payments_created_by_fkey;
    ALTER TABLE public.payments ADD CONSTRAINT payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_approved_by_fkey') THEN
    ALTER TABLE public.payments DROP CONSTRAINT payments_approved_by_fkey;
    ALTER TABLE public.payments ADD CONSTRAINT payments_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_processed_by_fkey') THEN
    ALTER TABLE public.payments DROP CONSTRAINT payments_processed_by_fkey;
    ALTER TABLE public.payments ADD CONSTRAINT payments_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_reversed_by_fkey') THEN
    ALTER TABLE public.payments DROP CONSTRAINT payments_reversed_by_fkey;
    ALTER TABLE public.payments ADD CONSTRAINT payments_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- pending_approvals (requested_by, reviewed_by)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_approvals_requested_by_fkey') THEN
    ALTER TABLE public.pending_approvals DROP CONSTRAINT pending_approvals_requested_by_fkey;
    ALTER TABLE public.pending_approvals ADD CONSTRAINT pending_approvals_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_approvals_reviewed_by_fkey') THEN
    ALTER TABLE public.pending_approvals DROP CONSTRAINT pending_approvals_reviewed_by_fkey;
    ALTER TABLE public.pending_approvals ADD CONSTRAINT pending_approvals_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- reconciliation_results (matched_by)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reconciliation_results_matched_by_fkey') THEN
    ALTER TABLE public.reconciliation_results DROP CONSTRAINT reconciliation_results_matched_by_fkey;
    ALTER TABLE public.reconciliation_results ADD CONSTRAINT reconciliation_results_matched_by_fkey FOREIGN KEY (matched_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- system_settings (updated_by)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'system_settings_updated_by_fkey') THEN
    ALTER TABLE public.system_settings DROP CONSTRAINT system_settings_updated_by_fkey;
    ALTER TABLE public.system_settings ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- upload_history (user_id)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upload_history_user_id_fkey') THEN
    ALTER TABLE public.upload_history DROP CONSTRAINT upload_history_user_id_fkey;
    ALTER TABLE public.upload_history ADD CONSTRAINT upload_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

END $$;
