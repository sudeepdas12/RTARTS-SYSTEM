-- Migration: 20261028000003_fix_global_read_rls_and_company_access.sql
-- Description: Fix company access and table RLS policies so auditor, read_only, report_viewer,
-- and operational roles can properly view companies, clients, payables, reconciliations,
-- allocations, AGM studio, audit logs, and reports without empty screens.
-- Preserves multi-tenant company isolation when user_company_access records are assigned.
-- Optimized with PostgreSQL InitPlans for high-performance sub-millisecond execution.

-- 1. Upgrade public.has_company_access to allow global inspection roles and unconstrained operational staff
CREATE OR REPLACE FUNCTION public.has_company_access(_user_id uuid, _company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
   SELECT
     CASE
       WHEN _user_id IS NULL OR _company_id IS NULL THEN FALSE
       -- Global access roles: admin, supervisor, auditor, report_viewer, read_only
       WHEN (SELECT public.has_any_role(_user_id, ARRAY[
         'admin'::public.app_role,
         'supervisor'::public.app_role,
         'auditor'::public.app_role,
         'report_viewer'::public.app_role,
         'read_only'::public.app_role
       ])) THEN TRUE
       -- Company creator has access
       WHEN EXISTS (
         SELECT 1 FROM public.companies
         WHERE id = _company_id
           AND created_by = _user_id
       ) THEN TRUE
       -- If this user has explicit company assignments, enforce strict tenant isolation
       WHEN EXISTS (
         SELECT 1 FROM public.user_company_access
         WHERE user_id = _user_id
       ) THEN EXISTS (
         SELECT 1 FROM public.user_company_access
         WHERE user_id = _user_id
           AND company_id = _company_id
       )
       -- If no specific company restrictions are assigned, allow access to company records
       ELSE TRUE
     END;
$function$;

-- 2. Companies table SELECT policy (InitPlan optimized)
DROP POLICY IF EXISTS companies_read ON public.companies;
CREATE POLICY companies_read ON public.companies FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'auditor'::public.app_role,
    'report_viewer'::public.app_role,
    'read_only'::public.app_role
  ]))
  OR (created_by = (SELECT auth.uid()))
  OR (id IN (
    SELECT user_company_access.company_id
    FROM public.user_company_access
    WHERE user_company_access.user_id = (SELECT auth.uid())
  ))
  OR (NOT EXISTS (
    SELECT 1 FROM public.user_company_access
    WHERE user_company_access.user_id = (SELECT auth.uid())
  ))
);

-- 3. Clients table SELECT policy (InitPlan optimized)
DROP POLICY IF EXISTS clients_read ON public.clients;
CREATE POLICY clients_read ON public.clients FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'auditor'::public.app_role,
    'report_viewer'::public.app_role,
    'read_only'::public.app_role
  ]))
  OR (company_id IS NULL)
  OR (company_id IN (
    SELECT user_company_access.company_id
    FROM public.user_company_access
    WHERE user_company_access.user_id = (SELECT auth.uid())
  ))
  OR (company_id IN (
    SELECT companies.id
    FROM public.companies
    WHERE companies.created_by = (SELECT auth.uid())
  ))
  OR (NOT EXISTS (
    SELECT 1 FROM public.user_company_access
    WHERE user_company_access.user_id = (SELECT auth.uid())
  ))
);

-- 4. Dividend Payables table SELECT policy (InitPlan optimized)
DROP POLICY IF EXISTS dp_read ON public.dividend_payables;
CREATE POLICY dp_read ON public.dividend_payables FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'auditor'::public.app_role,
    'report_viewer'::public.app_role,
    'read_only'::public.app_role
  ]))
  OR (company_id IS NULL)
  OR (company_id IN (
    SELECT user_company_access.company_id
    FROM public.user_company_access
    WHERE user_company_access.user_id = (SELECT auth.uid())
  ))
  OR (company_id IN (
    SELECT companies.id
    FROM public.companies
    WHERE companies.created_by = (SELECT auth.uid())
  ))
  OR (NOT EXISTS (
    SELECT 1 FROM public.user_company_access
    WHERE user_company_access.user_id = (SELECT auth.uid())
  ))
);

-- 5. Interest Payables table SELECT policy (InitPlan optimized)
DROP POLICY IF EXISTS ip_read ON public.interest_payables;
CREATE POLICY ip_read ON public.interest_payables FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'auditor'::public.app_role,
    'report_viewer'::public.app_role,
    'read_only'::public.app_role
  ]))
  OR (company_id IS NULL)
  OR (company_id IN (
    SELECT user_company_access.company_id
    FROM public.user_company_access
    WHERE user_company_access.user_id = (SELECT auth.uid())
  ))
  OR (company_id IN (
    SELECT companies.id
    FROM public.companies
    WHERE companies.created_by = (SELECT auth.uid())
  ))
  OR (NOT EXISTS (
    SELECT 1 FROM public.user_company_access
    WHERE user_company_access.user_id = (SELECT auth.uid())
  ))
);

-- 6. Mutual Fund Payables table SELECT policy (InitPlan optimized)
DROP POLICY IF EXISTS mfp_read ON public.mutual_fund_payables;
CREATE POLICY mfp_read ON public.mutual_fund_payables FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'auditor'::public.app_role,
    'report_viewer'::public.app_role,
    'read_only'::public.app_role
  ]))
  OR (company_id IS NULL)
  OR (company_id IN (
    SELECT user_company_access.company_id
    FROM public.user_company_access
    WHERE user_company_access.user_id = (SELECT auth.uid())
  ))
  OR (company_id IN (
    SELECT companies.id
    FROM public.companies
    WHERE companies.created_by = (SELECT auth.uid())
  ))
  OR (NOT EXISTS (
    SELECT 1 FROM public.user_company_access
    WHERE user_company_access.user_id = (SELECT auth.uid())
  ))
);

-- 7. Payments table SELECT policy (InitPlan optimized)
DROP POLICY IF EXISTS pay_read ON public.payments;
CREATE POLICY pay_read ON public.payments FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'auditor'::public.app_role,
    'report_viewer'::public.app_role,
    'read_only'::public.app_role
  ]))
  OR (company_id IS NULL)
  OR (company_id IN (
    SELECT user_company_access.company_id
    FROM public.user_company_access
    WHERE user_company_access.user_id = (SELECT auth.uid())
  ))
  OR (company_id IN (
    SELECT companies.id
    FROM public.companies
    WHERE companies.created_by = (SELECT auth.uid())
  ))
  OR (NOT EXISTS (
    SELECT 1 FROM public.user_company_access
    WHERE user_company_access.user_id = (SELECT auth.uid())
  ))
);

-- 8. Payment Batches table SELECT policy (InitPlan optimized)
DROP POLICY IF EXISTS pb_read ON public.payment_batches;
CREATE POLICY pb_read ON public.payment_batches FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'auditor'::public.app_role,
    'report_viewer'::public.app_role,
    'read_only'::public.app_role
  ]))
  OR (company_id IS NULL)
  OR (company_id IN (
    SELECT user_company_access.company_id
    FROM public.user_company_access
    WHERE user_company_access.user_id = (SELECT auth.uid())
  ))
  OR (company_id IN (
    SELECT companies.id
    FROM public.companies
    WHERE companies.created_by = (SELECT auth.uid())
  ))
  OR (NOT EXISTS (
    SELECT 1 FROM public.user_company_access
    WHERE user_company_access.user_id = (SELECT auth.uid())
  ))
);

-- 9. Reconciliation Results table SELECT policy (InitPlan optimized)
DROP POLICY IF EXISTS rr_select ON public.reconciliation_results;
CREATE POLICY rr_select ON public.reconciliation_results FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'auditor'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role,
    'checker'::public.app_role,
    'approver'::public.app_role,
    'maker'::public.app_role,
    'operator'::public.app_role,
    'report_viewer'::public.app_role,
    'read_only'::public.app_role
  ]))
  AND (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role,
      'supervisor'::public.app_role,
      'auditor'::public.app_role,
      'report_viewer'::public.app_role,
      'read_only'::public.app_role
    ]))
    OR (company_id IS NULL)
    OR (company_id IN (
      SELECT user_company_access.company_id
      FROM public.user_company_access
      WHERE user_company_access.user_id = (SELECT auth.uid())
    ))
    OR (company_id IN (
      SELECT companies.id
      FROM public.companies
      WHERE companies.created_by = (SELECT auth.uid())
    ))
    OR (NOT EXISTS (
      SELECT 1 FROM public.user_company_access
      WHERE user_company_access.user_id = (SELECT auth.uid())
    ))
  )
);

-- 10. IAF Allocations table SELECT policy (InitPlan optimized)
DROP POLICY IF EXISTS iaf_read ON public.iaf_allocations;
CREATE POLICY iaf_read ON public.iaf_allocations FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'auditor'::public.app_role,
    'report_viewer'::public.app_role,
    'read_only'::public.app_role
  ]))
  OR (company_id IS NULL)
  OR (company_id IN (
    SELECT user_company_access.company_id
    FROM public.user_company_access
    WHERE user_company_access.user_id = (SELECT auth.uid())
  ))
  OR (company_id IN (
    SELECT companies.id
    FROM public.companies
    WHERE companies.created_by = (SELECT auth.uid())
  ))
  OR (NOT EXISTS (
    SELECT 1 FROM public.user_company_access
    WHERE user_company_access.user_id = (SELECT auth.uid())
  ))
);

-- 11. AGM tables SELECT policies (InitPlan optimized)
DROP POLICY IF EXISTS agm_broker_claims_select ON public.agm_broker_claims;
CREATE POLICY agm_broker_claims_select ON public.agm_broker_claims FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'operator'::app_role, 'auditor'::app_role, 'report_viewer'::app_role, 'read_only'::app_role
  ]))
  AND (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::app_role, 'supervisor'::app_role, 'auditor'::app_role, 'report_viewer'::app_role, 'read_only'::app_role
    ]))
    OR (company_id IS NULL)
    OR (company_id IN (
      SELECT user_company_access.company_id FROM public.user_company_access WHERE user_company_access.user_id = (SELECT auth.uid())
    ))
    OR (company_id IN (
      SELECT companies.id FROM public.companies WHERE companies.created_by = (SELECT auth.uid())
    ))
    OR (NOT EXISTS (
      SELECT 1 FROM public.user_company_access WHERE user_company_access.user_id = (SELECT auth.uid())
    ))
  )
);

DROP POLICY IF EXISTS agm_broker_pools_select ON public.agm_broker_pools;
CREATE POLICY agm_broker_pools_select ON public.agm_broker_pools FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'operator'::app_role, 'auditor'::app_role, 'report_viewer'::app_role, 'read_only'::app_role
  ]))
  AND (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::app_role, 'supervisor'::app_role, 'auditor'::app_role, 'report_viewer'::app_role, 'read_only'::app_role
    ]))
    OR (company_id IS NULL)
    OR (company_id IN (
      SELECT user_company_access.company_id FROM public.user_company_access WHERE user_company_access.user_id = (SELECT auth.uid())
    ))
    OR (company_id IN (
      SELECT companies.id FROM public.companies WHERE companies.created_by = (SELECT auth.uid())
    ))
    OR (NOT EXISTS (
      SELECT 1 FROM public.user_company_access WHERE user_company_access.user_id = (SELECT auth.uid())
    ))
  )
);

DROP POLICY IF EXISTS agm_drn_records_select ON public.agm_drn_records;
CREATE POLICY agm_drn_records_select ON public.agm_drn_records FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'operator'::app_role, 'auditor'::app_role, 'report_viewer'::app_role, 'read_only'::app_role
  ]))
  AND (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::app_role, 'supervisor'::app_role, 'auditor'::app_role, 'report_viewer'::app_role, 'read_only'::app_role
    ]))
    OR (company_id IS NULL)
    OR (company_id IN (
      SELECT user_company_access.company_id FROM public.user_company_access WHERE user_company_access.user_id = (SELECT auth.uid())
    ))
    OR (company_id IN (
      SELECT companies.id FROM public.companies WHERE companies.created_by = (SELECT auth.uid())
    ))
    OR (NOT EXISTS (
      SELECT 1 FROM public.user_company_access WHERE user_company_access.user_id = (SELECT auth.uid())
    ))
  )
);

DROP POLICY IF EXISTS agm_fiscal_year_meta_select ON public.agm_fiscal_year_meta;
CREATE POLICY agm_fiscal_year_meta_select ON public.agm_fiscal_year_meta FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'operator'::app_role, 'auditor'::app_role, 'report_viewer'::app_role, 'read_only'::app_role
  ]))
  AND (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::app_role, 'supervisor'::app_role, 'auditor'::app_role, 'report_viewer'::app_role, 'read_only'::app_role
    ]))
    OR (company_id IS NULL)
    OR (company_id IN (
      SELECT user_company_access.company_id FROM public.user_company_access WHERE user_company_access.user_id = (SELECT auth.uid())
    ))
    OR (company_id IN (
      SELECT companies.id FROM public.companies WHERE companies.created_by = (SELECT auth.uid())
    ))
    OR (NOT EXISTS (
      SELECT 1 FROM public.user_company_access WHERE user_company_access.user_id = (SELECT auth.uid())
    ))
  )
);

DROP POLICY IF EXISTS agm_historical_shareholders_select ON public.agm_historical_shareholders;
CREATE POLICY agm_historical_shareholders_select ON public.agm_historical_shareholders FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'operator'::app_role, 'auditor'::app_role, 'report_viewer'::app_role, 'read_only'::app_role
  ]))
  AND (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::app_role, 'supervisor'::app_role, 'auditor'::app_role, 'report_viewer'::app_role, 'read_only'::app_role
    ]))
    OR (company_id IS NULL)
    OR (company_id IN (
      SELECT user_company_access.company_id FROM public.user_company_access WHERE user_company_access.user_id = (SELECT auth.uid())
    ))
    OR (company_id IN (
      SELECT companies.id FROM public.companies WHERE companies.created_by = (SELECT auth.uid())
    ))
    OR (NOT EXISTS (
      SELECT 1 FROM public.user_company_access WHERE user_company_access.user_id = (SELECT auth.uid())
    ))
  )
);

DROP POLICY IF EXISTS agm_yearly_snapshots_select ON public.agm_yearly_snapshots;
CREATE POLICY agm_yearly_snapshots_select ON public.agm_yearly_snapshots FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'operator'::app_role, 'auditor'::app_role, 'report_viewer'::app_role, 'read_only'::app_role
  ]))
  AND (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::app_role, 'supervisor'::app_role, 'auditor'::app_role, 'report_viewer'::app_role, 'read_only'::app_role
    ]))
    OR (company_id IS NULL)
    OR (company_id IN (
      SELECT user_company_access.company_id FROM public.user_company_access WHERE user_company_access.user_id = (SELECT auth.uid())
    ))
    OR (company_id IN (
      SELECT companies.id FROM public.companies WHERE companies.created_by = (SELECT auth.uid())
    ))
    OR (NOT EXISTS (
      SELECT 1 FROM public.user_company_access WHERE user_company_access.user_id = (SELECT auth.uid())
    ))
  )
);

DROP POLICY IF EXISTS agm_import_staging_select ON public.agm_import_staging;
CREATE POLICY agm_import_staging_select ON public.agm_import_staging FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'operator'::app_role, 'auditor'::app_role
  ]))
  AND (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::app_role, 'supervisor'::app_role, 'auditor'::app_role
    ]))
    OR (company_id IS NULL)
    OR (company_id IN (
      SELECT user_company_access.company_id FROM public.user_company_access WHERE user_company_access.user_id = (SELECT auth.uid())
    ))
    OR (company_id IN (
      SELECT companies.id FROM public.companies WHERE companies.created_by = (SELECT auth.uid())
    ))
    OR (NOT EXISTS (
      SELECT 1 FROM public.user_company_access WHERE user_company_access.user_id = (SELECT auth.uid())
    ))
  )
);

-- 12. Audit Logs table SELECT policy (ensure supervisor and auditor have read access)
DROP POLICY IF EXISTS audit_read ON public.audit_logs;
CREATE POLICY audit_read ON public.audit_logs FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'auditor'::app_role]));

-- 13. User Company Access table SELECT policy (allow auditor to inspect access mappings)
DROP POLICY IF EXISTS uca_select ON public.user_company_access;
CREATE POLICY uca_select ON public.user_company_access FOR SELECT TO authenticated
USING ((user_id = auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'auditor'::app_role]));
