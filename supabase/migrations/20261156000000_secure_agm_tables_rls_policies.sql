-- Migration: 20261156000000_secure_agm_tables_rls_policies.sql
-- Description: Revoke anon access, drop open RLS policies, restrict to authenticated users and service_role, and add get_agm_summary_stats RPC function.

-- 1. Revoke anon permissions from all AGM tables
REVOKE ALL ON public.agm_historical_shareholders FROM anon;
REVOKE ALL ON public.agm_yearly_snapshots FROM anon;
REVOKE ALL ON public.agm_fiscal_year_meta FROM anon;
REVOKE ALL ON public.agm_broker_pools FROM anon;
REVOKE ALL ON public.agm_broker_claims FROM anon;
REVOKE ALL ON public.agm_drn_records FROM anon;

-- Ensure authenticated and service_role have appropriate access
GRANT ALL ON public.agm_historical_shareholders TO authenticated;
GRANT ALL ON public.agm_yearly_snapshots TO authenticated;
GRANT ALL ON public.agm_fiscal_year_meta TO authenticated;
GRANT ALL ON public.agm_broker_pools TO authenticated;
GRANT ALL ON public.agm_broker_claims TO authenticated;
GRANT ALL ON public.agm_drn_records TO authenticated;

GRANT ALL ON public.agm_historical_shareholders TO service_role;
GRANT ALL ON public.agm_yearly_snapshots TO service_role;
GRANT ALL ON public.agm_fiscal_year_meta TO service_role;
GRANT ALL ON public.agm_broker_pools TO service_role;
GRANT ALL ON public.agm_broker_claims TO service_role;
GRANT ALL ON public.agm_drn_records TO service_role;

-- 2. Drop open policies created in migration 20261153000000
DROP POLICY IF EXISTS "agm_historical_shareholders_all" ON public.agm_historical_shareholders;
DROP POLICY IF EXISTS "agm_yearly_snapshots_all" ON public.agm_yearly_snapshots;
DROP POLICY IF EXISTS "agm_fiscal_year_meta_all" ON public.agm_fiscal_year_meta;
DROP POLICY IF EXISTS "agm_broker_pools_all" ON public.agm_broker_pools;
DROP POLICY IF EXISTS "agm_broker_claims_all" ON public.agm_broker_claims;
DROP POLICY IF EXISTS "agm_drn_records_all" ON public.agm_drn_records;

-- 3. Create secure policies scoped to authenticated and service_role only
CREATE POLICY "agm_historical_shareholders_auth" ON public.agm_historical_shareholders
  FOR ALL TO authenticated, service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "agm_yearly_snapshots_auth" ON public.agm_yearly_snapshots
  FOR ALL TO authenticated, service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "agm_fiscal_year_meta_auth" ON public.agm_fiscal_year_meta
  FOR ALL TO authenticated, service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "agm_broker_pools_auth" ON public.agm_broker_pools
  FOR ALL TO authenticated, service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "agm_broker_claims_auth" ON public.agm_broker_claims
  FOR ALL TO authenticated, service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "agm_drn_records_auth" ON public.agm_drn_records
  FOR ALL TO authenticated, service_role
  USING (true)
  WITH CHECK (true);

-- 4. Server-side Summary Aggregation RPC
CREATE OR REPLACE FUNCTION public.get_agm_summary_stats()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'totalShareholders', COUNT(*),
    'totalKitta', COALESCE(SUM(current_kitta_2081), 0),
    'totalBonus', COALESCE(SUM(total_bonus_shares), 0),
    'totalCash', COALESCE(SUM(total_cash_dividend), 0),
    'totalTax', COALESCE(SUM(total_tax_withheld), 0),
    'mfCash', COALESCE(SUM(CASE WHEN holder_type = 'MUTUAL_FUND' THEN total_cash_dividend ELSE 0 END), 0)
  )
  FROM public.agm_historical_shareholders;
$$;

GRANT EXECUTE ON FUNCTION public.get_agm_summary_stats() TO authenticated, service_role;
