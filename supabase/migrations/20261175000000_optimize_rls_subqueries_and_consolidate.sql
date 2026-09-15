-- Migration: 20261175000000_optimize_rls_subqueries_and_consolidate.sql
-- Description:
-- 1. Wrap auth.uid() in (select auth.uid()) across all RLS policies to evaluate once per statement.
-- 2. Consolidate overlapping permissive SELECT policies on reconciliation_results (rr_select + rr_read).

BEGIN;

-- 1. user_roles: roles_admin_all
DROP POLICY IF EXISTS "roles_admin_all" ON public.user_roles;
CREATE POLICY "roles_admin_all" ON public.user_roles
  FOR ALL
  TO authenticated
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));

-- 2. fiscal_years: fy_admin
DROP POLICY IF EXISTS "fy_admin" ON public.fiscal_years;
CREATE POLICY "fy_admin" ON public.fiscal_years
  FOR ALL
  TO authenticated
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));

-- 3. bank_transactions: bt_write
DROP POLICY IF EXISTS "bt_write" ON public.bank_transactions;
CREATE POLICY "bt_write" ON public.bank_transactions
  FOR ALL
  TO authenticated
  USING (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'reconciliation_officer'::app_role, 'finance_operator'::app_role]))
  WITH CHECK (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'reconciliation_officer'::app_role, 'finance_operator'::app_role]));

-- 4. iaf_allocations: iaf_write
DROP POLICY IF EXISTS "iaf_write" ON public.iaf_allocations;
CREATE POLICY "iaf_write" ON public.iaf_allocations
  FOR ALL
  TO authenticated
  USING (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'finance_operator'::app_role]))
  WITH CHECK (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'finance_operator'::app_role]));

-- 5. notification_configs: nc_admin
DROP POLICY IF EXISTS "nc_admin" ON public.notification_configs;
CREATE POLICY "nc_admin" ON public.notification_configs
  FOR ALL
  TO authenticated
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));

-- 6. system_settings: ss_admin
DROP POLICY IF EXISTS "ss_admin" ON public.system_settings;
CREATE POLICY "ss_admin" ON public.system_settings
  FOR ALL
  TO authenticated
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));

-- 7. payable_tax_rules: admins manage payable tax rules
DROP POLICY IF EXISTS "admins manage payable tax rules" ON public.payable_tax_rules;
CREATE POLICY "admins manage payable tax rules" ON public.payable_tax_rules
  FOR ALL
  TO authenticated
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));

-- 8. user_company_access: uca_admin_all
DROP POLICY IF EXISTS "uca_admin_all" ON public.user_company_access;
CREATE POLICY "uca_admin_all" ON public.user_company_access
  FOR ALL
  TO authenticated
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));

-- 9. clients: clients_read
DROP POLICY IF EXISTS "clients_read" ON public.clients;
CREATE POLICY "clients_read" ON public.clients
  FOR SELECT
  TO authenticated
  USING (
    company_id IS NULL
    OR has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'supervisor'::app_role])
    OR public.has_company_access((select auth.uid()), company_id)
  );

-- 10. AGM Tables: optimize modify policies
DROP POLICY IF EXISTS "agm_broker_claims_modify" ON public.agm_broker_claims;
CREATE POLICY "agm_broker_claims_modify" ON public.agm_broker_claims
  FOR ALL
  TO authenticated
  USING (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]))
  WITH CHECK (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]));

DROP POLICY IF EXISTS "agm_broker_pools_modify" ON public.agm_broker_pools;
CREATE POLICY "agm_broker_pools_modify" ON public.agm_broker_pools
  FOR ALL
  TO authenticated
  USING (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]))
  WITH CHECK (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]));

DROP POLICY IF EXISTS "agm_drn_records_modify" ON public.agm_drn_records;
CREATE POLICY "agm_drn_records_modify" ON public.agm_drn_records
  FOR ALL
  TO authenticated
  USING (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]))
  WITH CHECK (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]));

DROP POLICY IF EXISTS "agm_fiscal_year_meta_modify" ON public.agm_fiscal_year_meta;
CREATE POLICY "agm_fiscal_year_meta_modify" ON public.agm_fiscal_year_meta
  FOR ALL
  TO authenticated
  USING (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]))
  WITH CHECK (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]));

DROP POLICY IF EXISTS "agm_historical_shareholders_modify" ON public.agm_historical_shareholders;
CREATE POLICY "agm_historical_shareholders_modify" ON public.agm_historical_shareholders
  FOR ALL
  TO authenticated
  USING (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]))
  WITH CHECK (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]));

DROP POLICY IF EXISTS "agm_yearly_snapshots_modify" ON public.agm_yearly_snapshots;
CREATE POLICY "agm_yearly_snapshots_modify" ON public.agm_yearly_snapshots
  FOR ALL
  TO authenticated
  USING (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]))
  WITH CHECK (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role]));

-- 11. Consolidate reconciliation_results SELECT policies: drop rr_read, update rr_select
DROP POLICY IF EXISTS "rr_read" ON public.reconciliation_results;
DROP POLICY IF EXISTS "rr_select" ON public.reconciliation_results;

CREATE POLICY "rr_select" ON public.reconciliation_results
  FOR SELECT
  TO authenticated
  USING (
    has_any_role(
      (select auth.uid()),
      ARRAY['admin'::app_role, 'reconciliation_officer'::app_role, 'finance_operator'::app_role, 'supervisor'::app_role, 'checker'::app_role, 'approver'::app_role, 'report_viewer'::app_role]
    )
    AND (company_id IS NULL OR public.has_company_access((select auth.uid()), company_id))
  );

COMMIT;
