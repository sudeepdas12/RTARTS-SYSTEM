-- Harmonize get_company_fiscal_summary_rpc to accurately compute disbursed and pending across partial and multi-leg payments
CREATE OR REPLACE FUNCTION public.get_company_fiscal_summary_rpc(p_fiscal_year text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_is_global_access boolean := false;
  v_user_companies uuid[];
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL 
     AND current_user != 'service_role' 
     AND session_user != 'postgres' 
     AND current_user != 'postgres' 
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  -- Resolve company authorization
  IF current_user = 'postgres' 
     OR session_user = 'postgres' 
     OR current_user = 'service_role' 
     OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' 
     OR EXISTS (
       SELECT 1 FROM public.user_roles
       WHERE user_id = v_uid
         AND role IN ('admin'::public.app_role, 'supervisor'::public.app_role)
     ) THEN
    v_is_global_access := true;
  ELSE
    SELECT COALESCE(array_agg(company_id), '{}')
    INTO v_user_companies
    FROM public.user_company_access
    WHERE user_id = v_uid;
  END IF;

  RETURN (
    WITH div_summary AS (
      SELECT
        dp.company_id,
        dp.fiscal_year,
        COUNT(*) AS dividend_count,
        COALESCE(SUM(dp.gross_dividend), 0) AS dividend_gross,
        COALESCE(SUM(dp.net_payable), 0) AS dividend_net,
        COALESCE(SUM(CASE WHEN dp.paid_amount IS NOT NULL THEN dp.paid_amount WHEN LOWER(dp.payment_status::text) = 'paid' THEN dp.net_payable ELSE 0 END), 0) AS dividend_disbursed,
        COALESCE(SUM(dp.net_payable) FILTER (WHERE LOWER(dp.payment_status::text) = 'paid'), 0) AS dividend_paid,
        COALESCE(SUM(dp.net_payable) FILTER (WHERE LOWER(dp.payment_status::text) = 'partial'), 0) AS dividend_partial,
        COALESCE(SUM(
          CASE
            WHEN LOWER(COALESCE(dp.payment_status::text, 'pending')) = 'paid' THEN 0
            WHEN dp.remaining_amount IS NOT NULL THEN dp.remaining_amount
            ELSE GREATEST(0, dp.net_payable - COALESCE(dp.paid_amount, 0))
          END
        ), 0) AS dividend_pending
      FROM public.dividend_payables dp
      WHERE (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR dp.fiscal_year = p_fiscal_year)
        AND (v_is_global_access OR dp.company_id = ANY(v_user_companies))
      GROUP BY dp.company_id, dp.fiscal_year
    ),
    int_summary AS (
      SELECT
        ip.company_id,
        ip.fiscal_year,
        COUNT(*) AS interest_count,
        COALESCE(SUM(ip.gross_interest), 0) AS interest_gross,
        COALESCE(SUM(ip.net_payable), 0) AS interest_net,
        COALESCE(SUM(CASE WHEN ip.paid_amount IS NOT NULL THEN ip.paid_amount WHEN LOWER(ip.payment_status::text) = 'paid' THEN ip.net_payable ELSE 0 END), 0) AS interest_disbursed,
        COALESCE(SUM(ip.net_payable) FILTER (WHERE LOWER(ip.payment_status::text) = 'paid'), 0) AS interest_paid,
        COALESCE(SUM(ip.net_payable) FILTER (WHERE LOWER(ip.payment_status::text) = 'partial'), 0) AS interest_partial,
        COALESCE(SUM(
          CASE
            WHEN LOWER(COALESCE(ip.payment_status::text, 'pending')) = 'paid' THEN 0
            WHEN ip.remaining_amount IS NOT NULL THEN ip.remaining_amount
            ELSE GREATEST(0, ip.net_payable - COALESCE(ip.paid_amount, 0))
          END
        ), 0) AS interest_pending
      FROM public.interest_payables ip
      WHERE (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR ip.fiscal_year = p_fiscal_year)
        AND (v_is_global_access OR ip.company_id = ANY(v_user_companies))
      GROUP BY ip.company_id, ip.fiscal_year
    ),
    mf_summary AS (
      SELECT
        mp.company_id,
        mp.fiscal_year,
        COUNT(*) AS mutual_fund_count,
        COALESCE(SUM(mp.gross_dividend), 0) AS mutual_fund_gross,
        COALESCE(SUM(mp.net_payable), 0) AS mutual_fund_net,
        COALESCE(SUM(CASE WHEN mp.paid_amount IS NOT NULL THEN mp.paid_amount WHEN LOWER(mp.payment_status::text) = 'paid' THEN mp.net_payable ELSE 0 END), 0) AS mutual_fund_disbursed,
        COALESCE(SUM(mp.net_payable) FILTER (WHERE LOWER(mp.payment_status::text) = 'paid'), 0) AS mutual_fund_paid,
        COALESCE(SUM(mp.net_payable) FILTER (WHERE LOWER(mp.payment_status::text) = 'partial'), 0) AS mutual_fund_partial,
        COALESCE(SUM(
          CASE
            WHEN LOWER(COALESCE(mp.payment_status::text, 'pending')) = 'paid' THEN 0
            WHEN mp.remaining_amount IS NOT NULL THEN mp.remaining_amount
            ELSE GREATEST(0, mp.net_payable - COALESCE(mp.paid_amount, 0))
          END
        ), 0) AS mutual_fund_pending
      FROM public.mutual_fund_payables mp
      WHERE (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR mp.fiscal_year = p_fiscal_year)
        AND (v_is_global_access OR mp.company_id = ANY(v_user_companies))
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
          'dividend_partial', ROUND(COALESCE(ds.dividend_partial, 0)::numeric, 2),
          'dividend_pending', ROUND(COALESCE(ds.dividend_pending, 0)::numeric, 2),
          'dividend_disbursed', ROUND(COALESCE(ds.dividend_disbursed, 0)::numeric, 2),
          'interest_count', COALESCE(isum.interest_count, 0),
          'interest_gross', ROUND(COALESCE(isum.interest_gross, 0)::numeric, 2),
          'interest_net', ROUND(COALESCE(isum.interest_net, 0)::numeric, 2),
          'interest_paid', ROUND(COALESCE(isum.interest_paid, 0)::numeric, 2),
          'interest_partial', ROUND(COALESCE(isum.interest_partial, 0)::numeric, 2),
          'interest_pending', ROUND(COALESCE(isum.interest_pending, 0)::numeric, 2),
          'interest_disbursed', ROUND(COALESCE(isum.interest_disbursed, 0)::numeric, 2),
          'mutual_fund_count', COALESCE(ms.mutual_fund_count, 0),
          'mutual_fund_gross', ROUND(COALESCE(ms.mutual_fund_gross, 0)::numeric, 2),
          'mutual_fund_net', ROUND(COALESCE(ms.mutual_fund_net, 0)::numeric, 2),
          'mutual_fund_paid', ROUND(COALESCE(ms.mutual_fund_paid, 0)::numeric, 2),
          'mutual_fund_partial', ROUND(COALESCE(ms.mutual_fund_partial, 0)::numeric, 2),
          'mutual_fund_pending', ROUND(COALESCE(ms.mutual_fund_pending, 0)::numeric, 2),
          'mutual_fund_disbursed', ROUND(COALESCE(ms.mutual_fund_disbursed, 0)::numeric, 2),
          'total_paid', ROUND((COALESCE(ds.dividend_paid, 0) + COALESCE(isum.interest_paid, 0) + COALESCE(ms.mutual_fund_paid, 0))::numeric, 2),
          'total_pending', ROUND((COALESCE(ds.dividend_pending, 0) + COALESCE(isum.interest_pending, 0) + COALESCE(ms.mutual_fund_pending, 0))::numeric, 2),
          'total_disbursed', ROUND((COALESCE(ds.dividend_disbursed, 0) + COALESCE(isum.interest_disbursed, 0) + COALESCE(ms.mutual_fund_disbursed, 0))::numeric, 2)
        )
      ),
      '[]'::json
    )
    FROM all_pairs ap
    JOIN public.companies c ON ap.company_id = c.id
    LEFT JOIN div_summary ds ON ap.company_id = ds.company_id AND ap.fiscal_year = ds.fiscal_year
    LEFT JOIN int_summary isum ON ap.company_id = isum.company_id AND ap.fiscal_year = isum.fiscal_year
    LEFT JOIN mf_summary ms ON ap.company_id = ms.company_id AND ap.fiscal_year = ms.fiscal_year
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_fiscal_summary_rpc(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_company_fiscal_summary_rpc(text) TO authenticated, service_role;
