-- Migration: 20261227000000_make_totals_rpcs_null_safe.sql
-- Description: Makes payables aggregation RPCs safe against NULL, empty string, and 'all' filter parameters.

-- 1. Mutual Fund Totals RPC
CREATE OR REPLACE FUNCTION public.get_mutual_fund_payables_totals(
  p_company_id uuid DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_fiscal_year text DEFAULT 'all',
  p_class text DEFAULT 'all',
  p_from_date text DEFAULT NULL,
  p_to_date text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint := 0;
  v_paid_count bigint := 0;
  v_partial_count bigint := 0;
  v_pending_count bigint := 0;
  v_units numeric := 0;
  v_gross numeric := 0;
  v_tax numeric := 0;
  v_net numeric := 0;
  v_disbursed numeric := 0;
  v_remaining numeric := 0;
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE payment_status::text = 'Paid'),
    COUNT(*) FILTER (WHERE payment_status::text = 'Partial'),
    COUNT(*) FILTER (WHERE payment_status::text = 'Pending'),
    COALESCE(SUM(shares_held), 0),
    COALESCE(SUM(gross_dividend), 0),
    COALESCE(SUM(tax_amount), 0),
    COALESCE(SUM(net_payable), 0),
    COALESCE(SUM(COALESCE(paid_amount, CASE WHEN payment_status::text = 'Paid' THEN net_payable ELSE 0 END)), 0),
    COALESCE(SUM(COALESCE(remaining_amount, CASE WHEN payment_status::text = 'Paid' THEN 0 ELSE net_payable END)), 0)
  INTO
    v_count, v_paid_count, v_partial_count, v_pending_count,
    v_units, v_gross, v_tax, v_net, v_disbursed, v_remaining
  FROM public.mutual_fund_payables
  WHERE
    (p_company_id IS NULL OR company_id = p_company_id)
    AND (p_status IS NULL OR p_status = 'all' OR p_status = '' OR payment_status::text = p_status)
    AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR fiscal_year = p_fiscal_year)
    AND (
      p_class IS NULL OR p_class = 'all' OR p_class = ''
      OR (p_class = 'PROMOTER' AND (payee_segment = 'PROMOTER' OR lot_name ILIKE '%PROMOT%'))
      OR (p_class = 'LOCAL' AND (payee_segment = 'LOCAL' OR lot_name ILIKE '%LOCAL%'))
      OR (p_class = 'TAX_EXEMPT' AND (payee_classification = 'TAX_EXEMPT' OR lot_name ILIKE '%MUTUAL%' OR lot_name ILIKE '%EXEMPT%'))
      OR (p_class = 'INSTITUTION' AND (payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%INSTITUT%' OR lot_name ILIKE '%COMPANY%'))
      OR (p_class = 'PUBLIC' AND (payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%PUBLIC%'))
    )
    AND (p_from_date IS NULL OR p_from_date = '' OR created_at >= p_from_date::timestamptz)
    AND (p_to_date IS NULL OR p_to_date = '' OR created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz);

  RETURN json_build_object(
    'count', COALESCE(v_count, 0),
    'paidCount', COALESCE(v_paid_count, 0),
    'partialCount', COALESCE(v_partial_count, 0),
    'pendingCount', COALESCE(v_pending_count, 0),
    'units', COALESCE(v_units, 0),
    'gross', COALESCE(v_gross, 0),
    'tax', COALESCE(v_tax, 0),
    'net', COALESCE(v_net, 0),
    'disbursed', COALESCE(v_disbursed, 0),
    'remaining', COALESCE(v_remaining, 0)
  );
END;
$$;

-- 2. Mutual Fund Distribution Summary RPC
CREATE OR REPLACE FUNCTION public.get_mutual_fund_distribution_summary(
  p_company_id uuid DEFAULT NULL,
  p_fiscal_year text DEFAULT 'all',
  p_from_date text DEFAULT NULL,
  p_to_date text DEFAULT NULL
)
RETURNS TABLE (
  type text,
  transaction_count bigint,
  kitta numeric,
  gross numeric,
  tax numeric,
  net numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);

  RETURN QUERY
  SELECT
    mapped_type AS type,
    COUNT(*)::bigint AS transaction_count,
    COALESCE(SUM(shares_held), 0)::numeric AS kitta,
    COALESCE(SUM(gross_dividend), 0)::numeric AS gross,
    COALESCE(SUM(tax_amount), 0)::numeric AS tax,
    COALESCE(SUM(net_payable), 0)::numeric AS net
  FROM (
    SELECT
      shares_held,
      gross_dividend,
      tax_amount,
      net_payable,
      CASE
        WHEN payee_classification = 'TAX_EXEMPT' OR lot_name ILIKE '%MUTUAL%' OR lot_name ILIKE '%EXEMPT%' THEN 'MUTUAL FUND'
        WHEN payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%INSTITUT%' OR lot_name ILIKE '%COMPANY%' THEN 'INSTITUTION'
        ELSE 'PUBLIC'
      END AS mapped_type
    FROM public.mutual_fund_payables
    WHERE
      (p_company_id IS NULL OR company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR fiscal_year = p_fiscal_year)
      AND (p_from_date IS NULL OR p_from_date = '' OR created_at >= p_from_date::timestamptz)
      AND (p_to_date IS NULL OR p_to_date = '' OR created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz)
  ) sub
  GROUP BY mapped_type
  ORDER BY
    CASE mapped_type
      WHEN 'PUBLIC' THEN 1
      WHEN 'INSTITUTION' THEN 2
      WHEN 'MUTUAL FUND' THEN 3
      ELSE 4
    END;
END;
$$;

-- 3. Dividend Payables Totals RPC
CREATE OR REPLACE FUNCTION public.get_dividend_payables_totals(
  p_company_id uuid DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_fiscal_year text DEFAULT 'all',
  p_type text DEFAULT 'all',
  p_class text DEFAULT 'all',
  p_from_date text DEFAULT NULL,
  p_to_date text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint := 0;
  v_paid_count bigint := 0;
  v_partial_count bigint := 0;
  v_pending_count bigint := 0;
  v_gross numeric := 0;
  v_tax numeric := 0;
  v_bonus_tax numeric := 0;
  v_net numeric := 0;
  v_disbursed numeric := 0;
  v_remaining numeric := 0;
  v_total_shares numeric := 0;
  v_bonus_issued numeric := 0;
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE payment_status::text = 'Paid'),
    COUNT(*) FILTER (WHERE payment_status::text = 'Partial'),
    COUNT(*) FILTER (WHERE payment_status::text = 'Pending'),
    COALESCE(SUM(gross_dividend), 0),
    COALESCE(SUM(tax_amount), 0),
    COALESCE(SUM(bonus_tax), 0),
    COALESCE(SUM(net_payable), 0),
    COALESCE(SUM(COALESCE(paid_amount, CASE WHEN payment_status::text = 'Paid' THEN net_payable ELSE 0 END)), 0),
    COALESCE(SUM(COALESCE(remaining_amount, CASE WHEN payment_status::text = 'Paid' THEN 0 ELSE net_payable END)), 0),
    COALESCE(SUM(shares_held), 0),
    COALESCE(SUM(bonus_issued), 0)
  INTO
    v_count, v_paid_count, v_partial_count, v_pending_count,
    v_gross, v_tax, v_bonus_tax, v_net, v_disbursed, v_remaining,
    v_total_shares, v_bonus_issued
  FROM public.dividend_payables
  WHERE
    (p_company_id IS NULL OR company_id = p_company_id)
    AND (p_status IS NULL OR p_status = 'all' OR p_status = '' OR payment_status::text = p_status)
    AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR fiscal_year = p_fiscal_year)
    AND (p_type IS NULL OR p_type = 'all' OR p_type = '' OR dividend_type::text = p_type)
    AND (
      p_class IS NULL OR p_class = 'all' OR p_class = ''
      OR (p_class = 'PROMOTER' AND (payee_segment = 'PROMOTER' OR lot_name ILIKE '%PROMOT%'))
      OR (p_class = 'LOCAL' AND (payee_segment = 'LOCAL' OR lot_name ILIKE '%LOCAL%'))
      OR ((p_class = 'TAX_EXEMPT' OR p_class = 'MUTUAL_FUND') AND (payee_classification = 'TAX_EXEMPT' OR lot_name ILIKE '%MUTUAL%' OR lot_name ILIKE '%EXEMPT%'))
      OR (p_class = 'INSTITUTION' AND (payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%INSTITUT%' OR lot_name ILIKE '%COMPANY%'))
      OR (p_class = 'PUBLIC' AND (payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%PUBLIC%'))
    )
    AND (p_from_date IS NULL OR p_from_date = '' OR created_at >= p_from_date::timestamptz)
    AND (p_to_date IS NULL OR p_to_date = '' OR created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz);

  RETURN json_build_object(
    'count', COALESCE(v_count, 0),
    'paidCount', COALESCE(v_paid_count, 0),
    'partialCount', COALESCE(v_partial_count, 0),
    'pendingCount', COALESCE(v_pending_count, 0),
    'gross', COALESCE(v_gross, 0),
    'tax', COALESCE(v_tax, 0),
    'bonusTax', COALESCE(v_bonus_tax, 0),
    'net', COALESCE(v_net, 0),
    'disbursed', COALESCE(v_disbursed, 0),
    'remaining', COALESCE(v_remaining, 0),
    'totalShares', COALESCE(v_total_shares, 0),
    'bonusIssued', COALESCE(v_bonus_issued, 0)
  );
END;
$$;

-- 4. Interest Payables Totals RPC
CREATE OR REPLACE FUNCTION public.get_interest_payables_totals(
  p_company_id uuid DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_fiscal_year text DEFAULT 'all',
  p_class text DEFAULT 'all',
  p_from_date text DEFAULT NULL,
  p_to_date text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint := 0;
  v_paid_count bigint := 0;
  v_partial_count bigint := 0;
  v_pending_count bigint := 0;
  v_units numeric := 0;
  v_gross numeric := 0;
  v_tax numeric := 0;
  v_net numeric := 0;
  v_disbursed numeric := 0;
  v_remaining numeric := 0;
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE payment_status::text = 'Paid'),
    COUNT(*) FILTER (WHERE payment_status::text = 'Partial'),
    COUNT(*) FILTER (WHERE payment_status::text = 'Pending'),
    COALESCE(SUM(shares_held), 0),
    COALESCE(SUM(gross_dividend), 0),
    COALESCE(SUM(tax_amount), 0),
    COALESCE(SUM(net_payable), 0),
    COALESCE(SUM(COALESCE(paid_amount, CASE WHEN payment_status::text = 'Paid' THEN net_payable ELSE 0 END)), 0),
    COALESCE(SUM(COALESCE(remaining_amount, CASE WHEN payment_status::text = 'Paid' THEN 0 ELSE net_payable END)), 0)
  INTO
    v_count, v_paid_count, v_partial_count, v_pending_count,
    v_units, v_gross, v_tax, v_net, v_disbursed, v_remaining
  FROM public.interest_payables
  WHERE
    (p_company_id IS NULL OR company_id = p_company_id)
    AND (p_status IS NULL OR p_status = 'all' OR p_status = '' OR payment_status::text = p_status)
    AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR fiscal_year = p_fiscal_year)
    AND (
      p_class IS NULL OR p_class = 'all' OR p_class = ''
      OR (p_class = 'PROMOTER' AND (payee_segment = 'PROMOTER' OR lot_name ILIKE '%PROMOT%'))
      OR (p_class = 'LOCAL' AND (payee_segment = 'LOCAL' OR lot_name ILIKE '%LOCAL%'))
      OR (p_class = 'TAX_EXEMPT' AND (payee_classification = 'TAX_EXEMPT' OR lot_name ILIKE '%MUTUAL%' OR lot_name ILIKE '%EXEMPT%'))
      OR (p_class = 'INSTITUTION' AND (payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%INSTITUT%' OR lot_name ILIKE '%COMPANY%'))
      OR (p_class = 'PUBLIC' AND (payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%PUBLIC%'))
    )
    AND (p_from_date IS NULL OR p_from_date = '' OR created_at >= p_from_date::timestamptz)
    AND (p_to_date IS NULL OR p_to_date = '' OR created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz);

  RETURN json_build_object(
    'count', COALESCE(v_count, 0),
    'paidCount', COALESCE(v_paid_count, 0),
    'partialCount', COALESCE(v_partial_count, 0),
    'pendingCount', COALESCE(v_pending_count, 0),
    'units', COALESCE(v_units, 0),
    'gross', COALESCE(v_gross, 0),
    'tax', COALESCE(v_tax, 0),
    'net', COALESCE(v_net, 0),
    'disbursed', COALESCE(v_disbursed, 0),
    'remaining', COALESCE(v_remaining, 0)
  );
END;
$$;
