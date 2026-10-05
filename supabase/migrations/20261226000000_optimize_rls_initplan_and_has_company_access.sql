-- Migration: Optimize RLS policies with InitPlan evaluation to eliminate statement timeouts on 50,000+ row tables
-- Author: RTARTS System Optimization
-- Date: 2026-10-02

-- 1. Ensure supporting indexes exist
CREATE INDEX IF NOT EXISTS idx_companies_created_by ON public.companies(created_by);

-- 2. Optimize has_company_access function for standalone RPC calls
CREATE OR REPLACE FUNCTION public.has_company_access(_user_id uuid, _company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT 
    CASE 
      WHEN _user_id IS NULL OR _company_id IS NULL THEN FALSE
      WHEN (SELECT public.has_any_role(_user_id, ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])) THEN TRUE
      WHEN EXISTS (
        SELECT 1 FROM public.companies
        WHERE id = _company_id
          AND created_by = _user_id
      ) THEN TRUE
      ELSE EXISTS (
        SELECT 1 FROM public.user_company_access 
        WHERE user_id = _user_id 
          AND company_id = _company_id
      )
    END;
$function$;

-- 3. Optimize mutual_fund_payables SELECT policy (mfp_read)
DROP POLICY IF EXISTS "mfp_read" ON public.mutual_fund_payables;
CREATE POLICY "mfp_read" ON public.mutual_fund_payables
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  OR company_id IS NULL
  OR (company_id IN (SELECT company_id FROM public.user_company_access WHERE user_id = (SELECT auth.uid())))
  OR (company_id IN (SELECT id FROM public.companies WHERE created_by = (SELECT auth.uid())))
);

-- 4. Optimize dividend_payables SELECT policy (dp_read)
DROP POLICY IF EXISTS "dp_read" ON public.dividend_payables;
CREATE POLICY "dp_read" ON public.dividend_payables
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  OR company_id IS NULL
  OR (company_id IN (SELECT company_id FROM public.user_company_access WHERE user_id = (SELECT auth.uid())))
  OR (company_id IN (SELECT id FROM public.companies WHERE created_by = (SELECT auth.uid())))
);

-- 5. Optimize interest_payables SELECT policy (ip_read)
DROP POLICY IF EXISTS "ip_read" ON public.interest_payables;
CREATE POLICY "ip_read" ON public.interest_payables
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  OR company_id IS NULL
  OR (company_id IN (SELECT company_id FROM public.user_company_access WHERE user_id = (SELECT auth.uid())))
  OR (company_id IN (SELECT id FROM public.companies WHERE created_by = (SELECT auth.uid())))
);

-- 6. Optimize clients SELECT policy (clients_read)
DROP POLICY IF EXISTS "clients_read" ON public.clients;
CREATE POLICY "clients_read" ON public.clients
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  OR company_id IS NULL
  OR (company_id IN (SELECT company_id FROM public.user_company_access WHERE user_id = (SELECT auth.uid())))
  OR (company_id IN (SELECT id FROM public.companies WHERE created_by = (SELECT auth.uid())))
);

-- 7. Optimize companies SELECT policy (companies_read)
DROP POLICY IF EXISTS "companies_read" ON public.companies;
CREATE POLICY "companies_read" ON public.companies
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  OR id IN (SELECT company_id FROM public.user_company_access WHERE user_id = (SELECT auth.uid()))
  OR created_by = (SELECT auth.uid())
);

-- 8. Optimize payments SELECT policy (pay_read)
DROP POLICY IF EXISTS "pay_read" ON public.payments;
CREATE POLICY "pay_read" ON public.payments
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  OR company_id IS NULL
  OR (company_id IN (SELECT company_id FROM public.user_company_access WHERE user_id = (SELECT auth.uid())))
  OR (company_id IN (SELECT id FROM public.companies WHERE created_by = (SELECT auth.uid())))
);

-- 9. Optimize payment_batches SELECT policy (pb_read)
DROP POLICY IF EXISTS "pb_read" ON public.payment_batches;
CREATE POLICY "pb_read" ON public.payment_batches
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  OR company_id IS NULL
  OR (company_id IN (SELECT company_id FROM public.user_company_access WHERE user_id = (SELECT auth.uid())))
  OR (company_id IN (SELECT id FROM public.companies WHERE created_by = (SELECT auth.uid())))
);

-- 10. Optimize iaf_allocations SELECT policy (iaf_read)
DROP POLICY IF EXISTS "iaf_read" ON public.iaf_allocations;
CREATE POLICY "iaf_read" ON public.iaf_allocations
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
  OR company_id IS NULL
  OR (company_id IN (SELECT company_id FROM public.user_company_access WHERE user_id = (SELECT auth.uid())))
  OR (company_id IN (SELECT id FROM public.companies WHERE created_by = (SELECT auth.uid())))
);

-- 11. Optimize reconciliation_results SELECT policy (rr_select)
DROP POLICY IF EXISTS "rr_select" ON public.reconciliation_results;
CREATE POLICY "rr_select" ON public.reconciliation_results
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'reconciliation_officer'::public.app_role, 'finance_operator'::public.app_role, 'supervisor'::public.app_role, 'checker'::public.app_role, 'approver'::public.app_role, 'report_viewer'::public.app_role]))
  AND (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
    OR company_id IS NULL
    OR (company_id IN (SELECT company_id FROM public.user_company_access WHERE user_id = (SELECT auth.uid())))
    OR (company_id IN (SELECT id FROM public.companies WHERE created_by = (SELECT auth.uid())))
  )
);

-- 12. Optimize AGM tables
DROP POLICY IF EXISTS "agm_historical_shareholders_select" ON public.agm_historical_shareholders;
CREATE POLICY "agm_historical_shareholders_select" ON public.agm_historical_shareholders
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role]))
  AND (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
    OR company_id IS NULL
    OR (company_id IN (SELECT company_id FROM public.user_company_access WHERE user_id = (SELECT auth.uid())))
    OR (company_id IN (SELECT id FROM public.companies WHERE created_by = (SELECT auth.uid())))
  )
);

DROP POLICY IF EXISTS "agm_yearly_snapshots_select" ON public.agm_yearly_snapshots;
CREATE POLICY "agm_yearly_snapshots_select" ON public.agm_yearly_snapshots
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role]))
  AND (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
    OR company_id IS NULL
    OR (company_id IN (SELECT company_id FROM public.user_company_access WHERE user_id = (SELECT auth.uid())))
    OR (company_id IN (SELECT id FROM public.companies WHERE created_by = (SELECT auth.uid())))
  )
);

DROP POLICY IF EXISTS "agm_broker_claims_select" ON public.agm_broker_claims;
CREATE POLICY "agm_broker_claims_select" ON public.agm_broker_claims
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role]))
  AND (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
    OR company_id IS NULL
    OR (company_id IN (SELECT company_id FROM public.user_company_access WHERE user_id = (SELECT auth.uid())))
    OR (company_id IN (SELECT id FROM public.companies WHERE created_by = (SELECT auth.uid())))
  )
);

DROP POLICY IF EXISTS "agm_drn_records_select" ON public.agm_drn_records;
CREATE POLICY "agm_drn_records_select" ON public.agm_drn_records
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role]))
  AND (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
    OR company_id IS NULL
    OR (company_id IN (SELECT company_id FROM public.user_company_access WHERE user_id = (SELECT auth.uid())))
    OR (company_id IN (SELECT id FROM public.companies WHERE created_by = (SELECT auth.uid())))
  )
);

DROP POLICY IF EXISTS "agm_broker_pools_select" ON public.agm_broker_pools;
CREATE POLICY "agm_broker_pools_select" ON public.agm_broker_pools
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role]))
  AND (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
    OR company_id IS NULL
    OR (company_id IN (SELECT company_id FROM public.user_company_access WHERE user_id = (SELECT auth.uid())))
    OR (company_id IN (SELECT id FROM public.companies WHERE created_by = (SELECT auth.uid())))
  )
);

DROP POLICY IF EXISTS "agm_fiscal_year_meta_select" ON public.agm_fiscal_year_meta;
CREATE POLICY "agm_fiscal_year_meta_select" ON public.agm_fiscal_year_meta
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role]))
  AND (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]))
    OR company_id IS NULL
    OR (company_id IN (SELECT company_id FROM public.user_company_access WHERE user_id = (SELECT auth.uid())))
    OR (company_id IN (SELECT id FROM public.companies WHERE created_by = (SELECT auth.uid())))
  )
);
