-- Migration: 20261153000000_fix_agm_tables_rls_policies.sql
-- Description: Allow anon and authenticated full access to AGM historical tables

DROP POLICY IF EXISTS "Allow authenticated read agm_historical_shareholders" ON public.agm_historical_shareholders;
DROP POLICY IF EXISTS "Allow authenticated insert agm_historical_shareholders" ON public.agm_historical_shareholders;
DROP POLICY IF EXISTS "Allow authenticated update agm_historical_shareholders" ON public.agm_historical_shareholders;

DROP POLICY IF EXISTS "Allow authenticated read agm_yearly_snapshots" ON public.agm_yearly_snapshots;
DROP POLICY IF EXISTS "Allow authenticated insert agm_yearly_snapshots" ON public.agm_yearly_snapshots;
DROP POLICY IF EXISTS "Allow authenticated update agm_yearly_snapshots" ON public.agm_yearly_snapshots;

DROP POLICY IF EXISTS "Allow authenticated read agm_fiscal_year_meta" ON public.agm_fiscal_year_meta;
DROP POLICY IF EXISTS "Allow authenticated insert agm_fiscal_year_meta" ON public.agm_fiscal_year_meta;
DROP POLICY IF EXISTS "Allow authenticated update agm_fiscal_year_meta" ON public.agm_fiscal_year_meta;

DROP POLICY IF EXISTS "Allow authenticated read agm_broker_pools" ON public.agm_broker_pools;
DROP POLICY IF EXISTS "Allow authenticated insert agm_broker_pools" ON public.agm_broker_pools;
DROP POLICY IF EXISTS "Allow authenticated update agm_broker_pools" ON public.agm_broker_pools;

DROP POLICY IF EXISTS "Allow authenticated read agm_broker_claims" ON public.agm_broker_claims;
DROP POLICY IF EXISTS "Allow authenticated insert agm_broker_claims" ON public.agm_broker_claims;

DROP POLICY IF EXISTS "Allow authenticated read agm_drn_records" ON public.agm_drn_records;
DROP POLICY IF EXISTS "Allow authenticated insert agm_drn_records" ON public.agm_drn_records;
DROP POLICY IF EXISTS "Allow authenticated update agm_drn_records" ON public.agm_drn_records;

-- Create open policies for anon, authenticated, and service_role
CREATE POLICY "agm_historical_shareholders_all" ON public.agm_historical_shareholders FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "agm_yearly_snapshots_all" ON public.agm_yearly_snapshots FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "agm_fiscal_year_meta_all" ON public.agm_fiscal_year_meta FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "agm_broker_pools_all" ON public.agm_broker_pools FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "agm_broker_claims_all" ON public.agm_broker_claims FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "agm_drn_records_all" ON public.agm_drn_records FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
