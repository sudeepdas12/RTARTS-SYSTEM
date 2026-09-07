-- 20261159000000_update_fiscal_summary_rpc_breakdowns.sql
-- Update get_company_fiscal_summary_rpc to include paid, pending, and partial breakdowns
-- for interest, dividend, and mutual funds.

CREATE OR REPLACE FUNCTION public.get_company_fiscal_summary_rpc(
  p_fiscal_year text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result json;
BEGIN
  WITH div_summary AS (
    SELECT
      dp.company_id,
      dp.fiscal_year,
      COUNT(*) AS dividend_count,
      COALESCE(SUM(dp.gross_dividend), 0) AS dividend_gross,
      COALESCE(SUM(dp.net_payable), 0) AS dividend_net,
      COALESCE(SUM(dp.net_payable) FILTER (WHERE LOWER(dp.payment_status) = 'paid'), 0) AS dividend_paid,
      COALESCE(SUM(dp.net_payable) FILTER (WHERE LOWER(dp.payment_status) = 'partial'), 0) AS dividend_partial,
      COALESCE(SUM(dp.net_payable) FILTER (WHERE LOWER(COALESCE(dp.payment_status, 'pending')) NOT IN ('paid', 'partial')), 0) AS dividend_pending
    FROM public.dividend_payables dp
    WHERE p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR dp.fiscal_year = p_fiscal_year
    GROUP BY dp.company_id, dp.fiscal_year
  ),
  int_summary AS (
    SELECT
      ip.company_id,
      ip.fiscal_year,
      COUNT(*) AS interest_count,
      COALESCE(SUM(ip.gross_interest), 0) AS interest_gross,
      COALESCE(SUM(ip.net_payable), 0) AS interest_net,
      COALESCE(SUM(ip.net_payable) FILTER (WHERE LOWER(ip.payment_status) = 'paid'), 0) AS interest_paid,
      COALESCE(SUM(ip.net_payable) FILTER (WHERE LOWER(ip.payment_status) = 'partial'), 0) AS interest_partial,
      COALESCE(SUM(ip.net_payable) FILTER (WHERE LOWER(COALESCE(ip.payment_status, 'pending')) NOT IN ('paid', 'partial')), 0) AS interest_pending
    FROM public.interest_payables ip
    WHERE p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR ip.fiscal_year = p_fiscal_year
    GROUP BY ip.company_id, ip.fiscal_year
  ),
  mf_summary AS (
    SELECT
      mp.company_id,
      mp.fiscal_year,
      COUNT(*) AS mutual_fund_count,
      COALESCE(SUM(mp.gross_dividend), 0) AS mutual_fund_gross,
      COALESCE(SUM(mp.net_payable), 0) AS mutual_fund_net,
      COALESCE(SUM(mp.net_payable) FILTER (WHERE LOWER(mp.payment_status) = 'paid'), 0) AS mutual_fund_paid,
      COALESCE(SUM(mp.net_payable) FILTER (WHERE LOWER(mp.payment_status) = 'partial'), 0) AS mutual_fund_partial,
      COALESCE(SUM(mp.net_payable) FILTER (WHERE LOWER(COALESCE(mp.payment_status, 'pending')) NOT IN ('paid', 'partial')), 0) AS mutual_fund_pending
    FROM public.mutual_fund_payables mp
    WHERE p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR mp.fiscal_year = p_fiscal_year
    GROUP BY mp.company_id, mp.fiscal_year
  ),
  all_pairs AS (
    SELECT company_id, fiscal_year FROM div_summary
    UNION
    SELECT company_id, fiscal_year FROM int_summary
    UNION
    SELECT company_id, fiscal_year FROM mf_summary
  )
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'company_id', ap.company_id,
        'company_name', COALESCE(c.company_name, 'Unknown Company'),
        'company_code', COALESCE(c.company_code, 'N/A'),
        'fiscal_year', ap.fiscal_year,
        'dividend_count', COALESCE(ds.dividend_count, 0),
        'dividend_gross', ROUND(COALESCE(ds.dividend_gross, 0)::numeric, 2),
        'dividend_net', ROUND(COALESCE(ds.dividend_net, 0)::numeric, 2),
        'dividend_paid', ROUND(COALESCE(ds.dividend_paid, 0)::numeric, 2),
        'dividend_pending', ROUND(COALESCE(ds.dividend_pending, 0)::numeric, 2),
        'dividend_partial', ROUND(COALESCE(ds.dividend_partial, 0)::numeric, 2),
        'interest_count', COALESCE(is_data.interest_count, 0),
        'interest_gross', ROUND(COALESCE(is_data.interest_gross, 0)::numeric, 2),
        'interest_net', ROUND(COALESCE(is_data.interest_net, 0)::numeric, 2),
        'interest_paid', ROUND(COALESCE(is_data.interest_paid, 0)::numeric, 2),
        'interest_pending', ROUND(COALESCE(is_data.interest_pending, 0)::numeric, 2),
        'interest_partial', ROUND(COALESCE(is_data.interest_partial, 0)::numeric, 2),
        'mutual_fund_count', COALESCE(ms.mutual_fund_count, 0),
        'mutual_fund_gross', ROUND(COALESCE(ms.mutual_fund_gross, 0)::numeric, 2),
        'mutual_fund_net', ROUND(COALESCE(ms.mutual_fund_net, 0)::numeric, 2),
        'mutual_fund_paid', ROUND(COALESCE(ms.mutual_fund_paid, 0)::numeric, 2),
        'mutual_fund_pending', ROUND(COALESCE(ms.mutual_fund_pending, 0)::numeric, 2),
        'mutual_fund_partial', ROUND(COALESCE(ms.mutual_fund_partial, 0)::numeric, 2),
        'total_paid', ROUND((COALESCE(ds.dividend_paid, 0) + COALESCE(is_data.interest_paid, 0) + COALESCE(ms.mutual_fund_paid, 0))::numeric, 2),
        'total_pending', ROUND((COALESCE(ds.dividend_pending, 0) + COALESCE(is_data.interest_pending, 0) + COALESCE(ms.mutual_fund_pending, 0))::numeric, 2)
      )
      ORDER BY c.company_name ASC, ap.fiscal_year DESC
    ),
    '[]'::json
  )
  INTO v_result
  FROM all_pairs ap
  JOIN public.companies c ON c.id = ap.company_id
  LEFT JOIN div_summary ds ON ds.company_id = ap.company_id AND ds.fiscal_year = ap.fiscal_year
  LEFT JOIN int_summary is_data ON is_data.company_id = ap.company_id AND is_data.fiscal_year = ap.fiscal_year
  LEFT JOIN mf_summary ms ON ms.company_id = ap.company_id AND ms.fiscal_year = ap.fiscal_year;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_fiscal_summary_rpc(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_fiscal_summary_rpc(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_company_fiscal_summary_rpc(text) TO service_role;
