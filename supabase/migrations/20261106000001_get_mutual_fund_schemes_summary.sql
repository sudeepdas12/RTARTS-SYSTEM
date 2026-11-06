-- Migration: Add get_mutual_fund_schemes_summary RPC for fast multi-scheme reporting
-- Version: 20261106000001

CREATE OR REPLACE FUNCTION public.get_mutual_fund_schemes_summary(
  p_fiscal_year text DEFAULT 'all'::text
) RETURNS TABLE(
  company_id uuid,
  company_name text,
  company_code text,
  unitholders bigint,
  kitta numeric,
  gross numeric,
  tax numeric,
  net numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_global_access boolean := false;
  v_user_companies uuid[];
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);

  IF session_user = 'postgres' 
     OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     OR COALESCE((NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') = 'service_role'
     OR (
       v_uid IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.user_roles
         WHERE user_id = v_uid
           AND role IN ('admin'::public.app_role, 'supervisor'::public.app_role)
       )
     ) THEN
    v_is_global_access := true;
  ELSE
    SELECT COALESCE(array_agg(company_id), '{}')
    INTO v_user_companies
    FROM public.user_company_access
    WHERE user_id = v_uid;
  END IF;

  RETURN QUERY
  SELECT
    c.id AS company_id,
    c.company_name,
    c.company_code,
    COUNT(*)::bigint AS unitholders,
    COALESCE(SUM(m.shares_held), 0)::numeric AS kitta,
    COALESCE(SUM(m.gross_dividend), 0)::numeric AS gross,
    COALESCE(SUM(m.tax_amount), 0)::numeric AS tax,
    COALESCE(SUM(m.net_payable), 0)::numeric AS net
  FROM public.mutual_fund_payables m
  JOIN public.companies c ON m.company_id = c.id
  WHERE
    (v_is_global_access OR m.company_id = ANY(v_user_companies))
    AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR m.fiscal_year = p_fiscal_year)
  GROUP BY c.id, c.company_name, c.company_code
  ORDER BY c.company_name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_mutual_fund_schemes_summary(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_mutual_fund_schemes_summary(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_mutual_fund_schemes_summary(text) TO anon;
