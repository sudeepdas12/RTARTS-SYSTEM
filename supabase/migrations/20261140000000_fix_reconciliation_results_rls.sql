-- ============================================================================
-- Migration: 20261140000000_fix_reconciliation_results_rls.sql
-- Description:
-- Fixes overly permissive RLS policies on reconciliation_results by enforcing
-- role-based access control and wrapping (SELECT auth.uid()) properly.
-- ============================================================================

ALTER TABLE public.reconciliation_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rr_read ON public.reconciliation_results;
DROP POLICY IF EXISTS rr_write ON public.reconciliation_results;
DROP POLICY IF EXISTS rr_update ON public.reconciliation_results;
DROP POLICY IF EXISTS rr_delete ON public.reconciliation_results;
DROP POLICY IF EXISTS "rr_select" ON public.reconciliation_results;
DROP POLICY IF EXISTS "rr_insert" ON public.reconciliation_results;
DROP POLICY IF EXISTS "rr_update" ON public.reconciliation_results;
DROP POLICY IF EXISTS "rr_delete" ON public.reconciliation_results;

-- SELECT policy: Authorized operational and reporting roles
CREATE POLICY "rr_select" ON public.reconciliation_results
  FOR SELECT TO authenticated
  USING (
    public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role,
      'reconciliation_officer'::public.app_role,
      'finance_operator'::public.app_role,
      'supervisor'::public.app_role,
      'checker'::public.app_role,
      'approver'::public.app_role,
      'report_viewer'::public.app_role
    ])
  );

-- INSERT policy: Authorized maker and reconciliation roles
CREATE POLICY "rr_insert" ON public.reconciliation_results
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role,
      'reconciliation_officer'::public.app_role,
      'finance_operator'::public.app_role,
      'maker'::public.app_role
    ])
  );

-- UPDATE policy: Only reconciliation officers and admins
CREATE POLICY "rr_update" ON public.reconciliation_results
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role,
      'reconciliation_officer'::public.app_role
    ])
  )
  WITH CHECK (
    public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role,
      'reconciliation_officer'::public.app_role
    ])
  );

-- DELETE policy: Admins only
CREATE POLICY "rr_delete" ON public.reconciliation_results
  FOR DELETE TO authenticated
  USING (
    public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role
    ])
  );
