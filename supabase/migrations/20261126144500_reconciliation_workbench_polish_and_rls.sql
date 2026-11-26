-- =============================================================================
-- Migration: Workbench Role RLS Parity & File-Ledger Fingerprint Reconciliation
-- =============================================================================

-- 1. Include checker, approver, maker, operator on bank_statement_transactions,
--    reconciliation_exceptions, and reconciliation_period_locks READ policies
--    (company access still strictly enforced via has_company_access).

DROP POLICY IF EXISTS "bst_read" ON public.bank_statement_transactions;
CREATE POLICY "bst_read" ON public.bank_statement_transactions
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role,
      'supervisor'::public.app_role,
      'finance_operator'::public.app_role,
      'reconciliation_officer'::public.app_role,
      'auditor'::public.app_role,
      'report_viewer'::public.app_role,
      'checker'::public.app_role,
      'approver'::public.app_role,
      'maker'::public.app_role,
      'operator'::public.app_role
    ]))
    AND (
      (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR (SELECT public.has_company_access((SELECT auth.uid()), company_id))
    )
  );

DROP POLICY IF EXISTS "re_read" ON public.reconciliation_exceptions;
CREATE POLICY "re_read" ON public.reconciliation_exceptions
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role,
      'supervisor'::public.app_role,
      'finance_operator'::public.app_role,
      'reconciliation_officer'::public.app_role,
      'auditor'::public.app_role,
      'report_viewer'::public.app_role,
      'checker'::public.app_role,
      'approver'::public.app_role,
      'maker'::public.app_role,
      'operator'::public.app_role
    ]))
    AND (
      (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR (SELECT public.has_company_access((SELECT auth.uid()), company_id))
    )
  );

DROP POLICY IF EXISTS "rpl_select" ON public.reconciliation_period_locks;
CREATE POLICY "rpl_select" ON public.reconciliation_period_locks
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role,
      'supervisor'::public.app_role,
      'finance_operator'::public.app_role,
      'reconciliation_officer'::public.app_role,
      'auditor'::public.app_role,
      'approver'::public.app_role,
      'checker'::public.app_role,
      'report_viewer'::public.app_role,
      'maker'::public.app_role,
      'operator'::public.app_role
    ]))
    AND (
      (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR (SELECT public.has_company_access((SELECT auth.uid()), company_id))
    )
  );

-- 2. RPC: Link matched uploaded statement transactions to applied reconciliation_run_id
--    by transaction_fingerprint (covers keyless & 1-to-N consolidated batch rows cleanly).
CREATE OR REPLACE FUNCTION public.mark_bank_transactions_reconciled_by_fingerprints(
  p_company_id uuid,
  p_run_id uuid,
  p_fingerprints text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_is_service_role boolean;
  v_uid uuid;
  v_updated int := 0;
BEGIN
  v_is_service_role := (
    current_user IN ('service_role', 'postgres')
    OR COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') = 'service_role'
  );

  IF NOT v_is_service_role THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer', 'maker', 'operator');
    v_uid := auth.uid();
    IF v_uid IS NULL OR NOT public.has_company_access(v_uid, p_company_id) THEN
      RAISE EXCEPTION 'Forbidden: caller lacks access to company %', p_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_company_id IS NULL OR p_run_id IS NULL OR p_fingerprints IS NULL OR array_length(p_fingerprints, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.bank_statement_transactions
  SET reconciliation_status = 'reconciled',
      reconciliation_run_id = p_run_id
  WHERE company_id = p_company_id
    AND reconciliation_status = 'unreconciled'
    AND approval_status <> 'pending_approval'
    AND transaction_fingerprint = ANY(p_fingerprints);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_bank_transactions_reconciled_by_fingerprints(uuid, uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_bank_transactions_reconciled_by_fingerprints(uuid, uuid, text[]) TO authenticated, service_role;
