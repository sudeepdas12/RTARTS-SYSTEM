-- ============================================================================
-- Migration: 20261028000001_populate_and_maintain_company_client_map.sql
-- Description: Populate company_client_map materialized view and ensure safe concurrent refresh
-- ============================================================================

-- Populate the materialized view if it has no data
DO $$
BEGIN
  REFRESH MATERIALIZED VIEW public.company_client_map;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Update refresh_company_client_map to safely handle concurrent vs non-concurrent refresh
CREATE OR REPLACE FUNCTION public.refresh_company_client_map()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_client_map;
  EXCEPTION WHEN OTHERS THEN
    -- Fallback to standard refresh if concurrent is not yet possible
    REFRESH MATERIALIZED VIEW public.company_client_map;
  END;
END;
$$;
