-- =============================================================================
-- Migration: Allow Consolidated (company_id IS NULL) Read Access on
-- payment_batches, payments, and reconciliation_results for Authorized Roles
-- =============================================================================

DROP POLICY IF EXISTS "pb_read" ON public.payment_batches;
CREATE POLICY "pb_read" ON public.payment_batches FOR SELECT TO authenticated
USING (
  CASE
    WHEN company_id IS NULL THEN (
      (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role]))
      OR (
        (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['finance_operator'::public.app_role, 'approver'::public.app_role, 'report_viewer'::public.app_role, 'operator'::public.app_role, 'checker'::public.app_role]))
        AND NOT EXISTS (
          SELECT 1 FROM public.payments p
          WHERE p.batch_id = payment_batches.id
            AND p.company_id IS NOT NULL
            AND NOT (SELECT public.has_company_access((SELECT auth.uid()), p.company_id))
        )
      )
    )
    ELSE (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  END
);

DROP POLICY IF EXISTS "pay_read" ON public.payments;
CREATE POLICY "pay_read" ON public.payments FOR SELECT TO authenticated
USING (
  CASE
    WHEN company_id IS NULL THEN (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role]))
    ELSE (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  END
);

DROP POLICY IF EXISTS "rr_select" ON public.reconciliation_results;
CREATE POLICY "rr_select" ON public.reconciliation_results FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role, 'reconciliation_officer'::public.app_role, 'finance_operator'::public.app_role, 'checker'::public.app_role, 'approver'::public.app_role, 'maker'::public.app_role, 'operator'::public.app_role, 'report_viewer'::public.app_role, 'read_only'::public.app_role]))
  AND CASE
    WHEN company_id IS NULL THEN (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role]))
    ELSE (SELECT public.has_company_access((SELECT auth.uid()), company_id))
  END
);
