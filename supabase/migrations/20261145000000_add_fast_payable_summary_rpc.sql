-- ============================================================================
-- Migration: 20261145000000_add_fast_payable_summary_rpc.sql
-- Description:
-- Adds a server-side PostgreSQL aggregation function get_company_payable_summary
-- to compute consolidated distribution summaries in single-digit milliseconds
-- without client-side full-table memory fetching.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_company_payable_summary(p_company_id uuid DEFAULT NULL)
RETURNS TABLE (
  company_id uuid,
  company_name text,
  company_code text,
  dividend_count bigint,
  dividend_gross numeric,
  dividend_tax numeric,
  dividend_net numeric,
  interest_count bigint,
  interest_gross numeric,
  interest_tax numeric,
  interest_net numeric,
  total_count bigint,
  total_gross numeric,
  total_tax numeric,
  total_net numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Authenticate caller
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH div_agg AS (
    SELECT
      dp.company_id,
      COUNT(*)::bigint AS d_count,
      COALESCE(SUM(dp.gross_dividend), 0)::numeric AS d_gross,
      COALESCE(SUM(dp.tax_amount), 0)::numeric AS d_tax,
      COALESCE(SUM(dp.net_payable), 0)::numeric AS d_net
    FROM public.dividend_payables dp
    WHERE (p_company_id IS NULL OR dp.company_id = p_company_id)
    GROUP BY dp.company_id
  ),
  int_agg AS (
    SELECT
      ip.company_id,
      COUNT(*)::bigint AS i_count,
      COALESCE(SUM(ip.gross_interest), 0)::numeric AS i_gross,
      COALESCE(SUM(ip.tax_amount), 0)::numeric AS i_tax,
      COALESCE(SUM(ip.net_payable), 0)::numeric AS i_net
    FROM public.interest_payables ip
    WHERE (p_company_id IS NULL OR ip.company_id = p_company_id)
    GROUP BY ip.company_id
  ),
  mf_agg AS (
    SELECT
      mp.company_id,
      COUNT(*)::bigint AS m_count,
      COALESCE(SUM(mp.gross_dividend), 0)::numeric AS m_gross,
      COALESCE(SUM(mp.tax_amount), 0)::numeric AS m_tax,
      COALESCE(SUM(mp.net_payable), 0)::numeric AS m_net
    FROM public.mutual_fund_payables mp
    WHERE (p_company_id IS NULL OR mp.company_id = p_company_id)
    GROUP BY mp.company_id
  ),
  active_companies AS (
    SELECT DISTINCT c.id, c.company_name, c.company_code
    FROM public.companies c
    WHERE (p_company_id IS NULL OR c.id = p_company_id)
      AND (
        EXISTS (SELECT 1 FROM div_agg d WHERE d.company_id = c.id)
        OR EXISTS (SELECT 1 FROM int_agg i WHERE i.company_id = c.id)
        OR EXISTS (SELECT 1 FROM mf_agg m WHERE m.company_id = c.id)
      )
  )
  SELECT
    ac.id AS company_id,
    ac.company_name::text,
    ac.company_code::text,
    (COALESCE(d.d_count, 0) + COALESCE(m.m_count, 0))::bigint AS dividend_count,
    (COALESCE(d.d_gross, 0) + COALESCE(m.m_gross, 0))::numeric AS dividend_gross,
    (COALESCE(d.d_tax, 0) + COALESCE(m.m_tax, 0))::numeric AS dividend_tax,
    (COALESCE(d.d_net, 0) + COALESCE(m.m_net, 0))::numeric AS dividend_net,
    COALESCE(i.i_count, 0)::bigint AS interest_count,
    COALESCE(i.i_gross, 0)::numeric AS interest_gross,
    COALESCE(i.i_tax, 0)::numeric AS interest_tax,
    COALESCE(i.i_net, 0)::numeric AS interest_net,
    (COALESCE(d.d_count, 0) + COALESCE(m.m_count, 0) + COALESCE(i.i_count, 0))::bigint AS total_count,
    (COALESCE(d.d_gross, 0) + COALESCE(m.m_gross, 0) + COALESCE(i.i_gross, 0))::numeric AS total_gross,
    (COALESCE(d.d_tax, 0) + COALESCE(m.m_tax, 0) + COALESCE(i.i_tax, 0))::numeric AS total_tax,
    (COALESCE(d.d_net, 0) + COALESCE(m.m_net, 0) + COALESCE(i.i_net, 0))::numeric AS total_net
  FROM active_companies ac
  LEFT JOIN div_agg d ON d.company_id = ac.id
  LEFT JOIN int_agg i ON i.company_id = ac.id
  LEFT JOIN mf_agg m ON m.company_id = ac.id
  ORDER BY ac.company_name ASC;
END;
$$;
