-- Migration: 20261225000000_add_fast_payables_totals_and_summary_rpcs.sql
-- Description:
-- 1. Adds server-side aggregation RPCs for KPI totals on Mutual Fund, Dividend, and Interest pages,
--    eliminating client-side fetchAllRows loops across 50k+ rows.
-- 2. Adds server-side get_mutual_fund_distribution_summary RPC for the CDS distribution summary.
-- 3. Adds fast get_distinct_fiscal_years helper.
-- 4. Adds composite index (company_id, created_at DESC) for instant table sorting.

BEGIN;

-- 1. Composite indexes on (company_id, created_at DESC)
CREATE INDEX IF NOT EXISTS idx_mf_payables_comp_created_at 
  ON public.mutual_fund_payables (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_div_payables_comp_created_at 
  ON public.dividend_payables (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_int_payables_comp_created_at 
  ON public.interest_payables (company_id, created_at DESC);

-- 2. Mutual Fund Totals RPC
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
    AND (p_status = 'all' OR payment_status::text = p_status)
    AND (p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
    AND (
      p_class = 'all'
      OR (p_class = 'PROMOTER' AND (payee_segment = 'PROMOTER' OR lot_name ILIKE '%PROMOT%'))
      OR (p_class = 'LOCAL' AND (payee_segment = 'LOCAL' OR lot_name ILIKE '%LOCAL%'))
      OR (p_class = 'TAX_EXEMPT' AND (payee_classification = 'TAX_EXEMPT' OR lot_name ILIKE '%MUTUAL%' OR lot_name ILIKE '%EXEMPT%'))
      OR (p_class = 'INSTITUTION' AND (payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%INSTITUT%' OR lot_name ILIKE '%COMPANY%'))
      OR (p_class = 'PUBLIC' AND (payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%PUBLIC%'))
    )
    AND (p_from_date IS NULL OR created_at >= p_from_date::timestamptz)
    AND (p_to_date IS NULL OR created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz);

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

GRANT EXECUTE ON FUNCTION public.get_mutual_fund_payables_totals(uuid, text, text, text, text, text) TO authenticated, service_role;

-- 3. Mutual Fund Distribution Summary RPC
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
  WITH categorized AS (
    SELECT
      CASE
        WHEN m.payee_classification = 'TAX_EXEMPT' OR m.lot_name ILIKE '%MUTUAL%' OR m.lot_name ILIKE '%EXEMPT%' THEN 'MUTUAL FUND'
        WHEN m.payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR m.lot_name ILIKE '%INSTITUT%' OR m.lot_name ILIKE '%COMPANY%' THEN 'INSTITUTION'
        WHEN m.payee_segment = 'PROMOTER' OR m.lot_name ILIKE '%PROMOT%' THEN 'PROMOTER'
        WHEN m.payee_segment = 'LOCAL' OR m.lot_name ILIKE '%LOCAL%' THEN 'LOCAL'
        WHEN m.payee_segment = 'EMPLOYEE' OR m.lot_name ILIKE '%STAFF%' OR m.lot_name ILIKE '%EMPLOYEE%' THEN 'EMPLOYEE'
        ELSE 'PUBLIC'
      END AS cat_type,
      COALESCE(m.shares_held, 0) AS kitta,
      COALESCE(m.gross_dividend, 0) AS gross,
      COALESCE(m.tax_amount, 0) AS tax,
      COALESCE(m.net_payable, 0) AS net
    FROM public.mutual_fund_payables m
    WHERE (p_company_id IS NULL OR m.company_id = p_company_id)
      AND (p_fiscal_year = 'all' OR m.fiscal_year = p_fiscal_year)
      AND (p_from_date IS NULL OR m.created_at >= p_from_date::timestamptz)
      AND (p_to_date IS NULL OR m.created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz)
  )
  SELECT
    c.cat_type AS type,
    COUNT(*)::bigint AS transaction_count,
    SUM(c.kitta)::numeric AS kitta,
    SUM(c.gross)::numeric AS gross,
    SUM(c.tax)::numeric AS tax,
    SUM(c.net)::numeric AS net
  FROM categorized c
  GROUP BY c.cat_type
  ORDER BY 
    CASE c.cat_type
      WHEN 'PUBLIC' THEN 1
      WHEN 'INSTITUTION' THEN 2
      WHEN 'MUTUAL FUND' THEN 3
      WHEN 'PROMOTER' THEN 4
      WHEN 'LOCAL' THEN 5
      WHEN 'EMPLOYEE' THEN 6
      ELSE 7
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_mutual_fund_distribution_summary(uuid, text, text, text) TO authenticated, service_role;

-- 4. Dividend Payables Totals RPC
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
    AND (p_status = 'all' OR payment_status::text = p_status)
    AND (p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
    AND (p_type = 'all' OR dividend_type::text = p_type)
    AND (
      p_class = 'all'
      OR (p_class = 'PROMOTER' AND (payee_segment = 'PROMOTER' OR lot_name ILIKE '%PROMOT%'))
      OR (p_class = 'LOCAL' AND (payee_segment = 'LOCAL' OR lot_name ILIKE '%LOCAL%'))
      OR ((p_class = 'TAX_EXEMPT' OR p_class = 'MUTUAL_FUND') AND (payee_classification = 'TAX_EXEMPT' OR lot_name ILIKE '%MUTUAL%' OR lot_name ILIKE '%EXEMPT%'))
      OR (p_class = 'INSTITUTION' AND (payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%INSTITUT%' OR lot_name ILIKE '%COMPANY%'))
      OR (p_class = 'PUBLIC' AND (payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%PUBLIC%'))
    )
    AND (p_from_date IS NULL OR created_at >= p_from_date::timestamptz)
    AND (p_to_date IS NULL OR created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz);

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

GRANT EXECUTE ON FUNCTION public.get_dividend_payables_totals(uuid, text, text, text, text, text, text) TO authenticated, service_role;

-- 5. Interest Payables Totals RPC
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
    COALESCE(SUM(gross_interest), 0),
    COALESCE(SUM(tax_amount), 0),
    COALESCE(SUM(net_payable), 0),
    COALESCE(SUM(COALESCE(paid_amount, CASE WHEN payment_status::text = 'Paid' THEN net_payable ELSE 0 END)), 0),
    COALESCE(SUM(COALESCE(remaining_amount, CASE WHEN payment_status::text = 'Paid' THEN 0 ELSE net_payable END)), 0)
  INTO
    v_count, v_paid_count, v_partial_count, v_pending_count,
    v_gross, v_tax, v_net, v_disbursed, v_remaining
  FROM public.interest_payables
  WHERE
    (p_company_id IS NULL OR company_id = p_company_id)
    AND (p_status = 'all' OR payment_status::text = p_status)
    AND (p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
    AND (
      p_class = 'all'
      OR (p_class = 'PROMOTER' AND (payee_segment = 'PROMOTER' OR lot_name ILIKE '%PROMOT%'))
      OR (p_class = 'LOCAL' AND (payee_segment = 'LOCAL' OR lot_name ILIKE '%LOCAL%'))
      OR ((p_class = 'TAX_EXEMPT' OR p_class = 'MUTUAL_FUND') AND (payee_classification = 'TAX_EXEMPT' OR lot_name ILIKE '%MUTUAL%' OR lot_name ILIKE '%EXEMPT%'))
      OR (p_class = 'INSTITUTION' AND (payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%INSTITUT%' OR lot_name ILIKE '%COMPANY%'))
      OR (p_class = 'PUBLIC' AND (payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON') OR lot_name ILIKE '%PUBLIC%'))
    )
    AND (p_from_date IS NULL OR created_at >= p_from_date::timestamptz)
    AND (p_to_date IS NULL OR created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz);

  RETURN json_build_object(
    'count', COALESCE(v_count, 0),
    'paidCount', COALESCE(v_paid_count, 0),
    'partialCount', COALESCE(v_partial_count, 0),
    'pendingCount', COALESCE(v_pending_count, 0),
    'gross', COALESCE(v_gross, 0),
    'tax', COALESCE(v_tax, 0),
    'net', COALESCE(v_net, 0),
    'disbursed', COALESCE(v_disbursed, 0),
    'remaining', COALESCE(v_remaining, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_interest_payables_totals(uuid, text, text, text, text, text) TO authenticated, service_role;

-- 6. Fast distinct fiscal years helper
CREATE OR REPLACE FUNCTION public.get_distinct_fiscal_years(p_table text DEFAULT 'mutual_fund_payables')
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res text[];
BEGIN
  IF p_table = 'mutual_fund_payables' THEN
    SELECT array_agg(DISTINCT fiscal_year ORDER BY fiscal_year DESC)
    INTO v_res
    FROM public.mutual_fund_payables
    WHERE fiscal_year IS NOT NULL;
  ELSIF p_table = 'dividend_payables' THEN
    SELECT array_agg(DISTINCT fiscal_year ORDER BY fiscal_year DESC)
    INTO v_res
    FROM public.dividend_payables
    WHERE fiscal_year IS NOT NULL;
  ELSIF p_table = 'interest_payables' THEN
    SELECT array_agg(DISTINCT fiscal_year ORDER BY fiscal_year DESC)
    INTO v_res
    FROM public.interest_payables
    WHERE fiscal_year IS NOT NULL;
  END IF;

  RETURN COALESCE(v_res, '{}');
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_distinct_fiscal_years(text) TO authenticated, service_role;

COMMIT;
