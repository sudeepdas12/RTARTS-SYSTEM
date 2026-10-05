-- ============================================================================
-- Migration: 20261189000000_atomic_upload_rollback.sql
-- Description:
-- Adds atomic stored procedures to safely and cleanly rollback file uploads:
-- 1. rollback_upload_atomic(p_upload_id, p_user_id)
--    - Deletes imported payables (interest_payables, dividend_payables, mutual_fund_payables)
--    - Cleans up draft/pending/failed payments referencing those payables
--    - Deletes upload errors for this upload
--    - Safely purges orphan clients with no remaining payables or payments
--    - Sets upload_history status to 'RolledBack'
--    - Clears active duplicate file_hash locks to unblock re-uploading
--    - Records an audit log entry
-- 2. rollback_upload_file_atomic(p_file_hash, p_file_name, p_user_id)
--    - Rolls back all sheets associated with a given workbook file
-- ============================================================================

-- 1. Single-sheet / single upload record rollback
CREATE OR REPLACE FUNCTION public.rollback_upload_atomic(
  p_upload_id uuid,
  p_user_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rec record;
  v_actor_id uuid;
  v_jwt_role text;
  v_interest_deleted int := 0;
  v_dividend_deleted int := 0;
  v_mf_deleted int := 0;
  v_errors_deleted int := 0;
  v_payments_cleaned int := 0;
  v_orphans_deleted int := 0;
  v_total_payables_deleted int := 0;
  v_base_hash text;
BEGIN
  -- Extract caller JWT role
  BEGIN
    v_jwt_role := (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  -- Verify caller role: service_role, postgres, or authenticated admin/supervisor
  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND current_user != 'postgres' THEN
    IF auth.uid() IS NOT NULL THEN
      PERFORM public.require_role('admin', 'supervisor');
    ELSIF p_user_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = p_user_id AND role IN ('admin'::public.app_role, 'supervisor'::public.app_role)
      ) THEN
        RAISE EXCEPTION 'Forbidden: caller does not have admin or supervisor role' USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
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

  -- 2. Clean up any un-finalized payments referencing payables in this upload
  WITH target_payables AS (
    SELECT id FROM public.interest_payables WHERE upload_id = p_upload_id
    UNION ALL
    SELECT id FROM public.dividend_payables WHERE upload_id = p_upload_id
    UNION ALL
    SELECT id FROM public.mutual_fund_payables WHERE upload_id = p_upload_id
  ),
  del_pmts AS (
    DELETE FROM public.payments
    WHERE payable_id IN (SELECT id FROM target_payables)
      AND status IN ('Draft', 'Pending', 'Failed', 'Rejected')
    RETURNING id
  )
  SELECT count(*) INTO v_payments_cleaned FROM del_pmts;

  -- 3. Delete interest_payables
  WITH del_int AS (
    DELETE FROM public.interest_payables
    WHERE upload_id = p_upload_id
    RETURNING id
  )
  SELECT count(*) INTO v_interest_deleted FROM del_int;

  -- 4. Delete dividend_payables
  WITH del_div AS (
    DELETE FROM public.dividend_payables
    WHERE upload_id = p_upload_id
    RETURNING id
  )
  SELECT count(*) INTO v_dividend_deleted FROM del_div;

  -- 5. Delete mutual_fund_payables
  WITH del_mf AS (
    DELETE FROM public.mutual_fund_payables
    WHERE upload_id = p_upload_id
    RETURNING id
  )
  SELECT count(*) INTO v_mf_deleted FROM del_mf;

  v_total_payables_deleted := v_interest_deleted + v_dividend_deleted + v_mf_deleted;

  -- 6. Delete upload errors
  WITH del_err AS (
    DELETE FROM public.upload_errors
    WHERE upload_id = p_upload_id
    RETURNING id
  )
  SELECT count(*) INTO v_errors_deleted FROM del_err;

  -- 7. Safely delete orphan clients that have no payables left across any table
  WITH del_clients AS (
    DELETE FROM public.clients c
    WHERE NOT EXISTS (SELECT 1 FROM public.dividend_payables d WHERE d.client_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.interest_payables i WHERE i.client_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.mutual_fund_payables m WHERE m.client_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.client_id = c.id)
    RETURNING id
  )
  SELECT count(*) INTO v_orphans_deleted FROM del_clients;

  -- 8. Mark this upload record as RolledBack
  UPDATE public.upload_history
  SET
    status = 'RolledBack',
    completed_at = now()
  WHERE id = p_upload_id;

  -- 9. Unblock re-uploading for this specific upload record's exact file_hash
  IF v_rec.file_hash IS NOT NULL AND v_rec.file_hash != '' THEN
    UPDATE public.upload_history
    SET status = 'RolledBack', completed_at = now()
    WHERE file_hash = v_rec.file_hash AND status != 'RolledBack';
  END IF;

  -- 10. Write audit log
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
$function$;

REVOKE ALL ON FUNCTION public.rollback_upload_atomic(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rollback_upload_atomic(uuid, uuid) TO authenticated, service_role;


-- 2. Multi-sheet / whole file rollback procedure
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

REVOKE ALL ON FUNCTION public.rollback_upload_file_atomic(text, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rollback_upload_file_atomic(text, text, uuid) TO authenticated, service_role;
