-- ============================================================================
-- Migration: 20261146000000_add_fast_agm_dividend_summary_rpc.sql
-- Description:
-- Adds get_agm_dividend_summary RPC using a single-pass SQL (no temp tables)
-- with window function separated from jsonb_agg for maximum PostgreSQL compatibility.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_agm_dividend_summary(
  p_company_id uuid DEFAULT NULL,
  p_fiscal_year text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
WITH filtered AS (
  SELECT
    dp.shares_held,
    dp.dividend_rate,
    COALESCE(dp.gross_dividend, 0)       AS gross_dividend,
    COALESCE(dp.tax_amount, 0)           AS tax_amount,
    COALESCE(dp.net_payable, 0)          AS net_payable,
    COALESCE(dp.bonus_actual, 0)         AS bonus_actual,
    COALESCE(dp.bonus_issued, 0)         AS bonus_issued,
    COALESCE(dp.bonus_fraction, 0)       AS bonus_fraction,
    COALESCE(dp.after_bonus_kitta,
      dp.shares_held + COALESCE(dp.bonus_issued, 0)) AS after_bonus_kitta,
    COALESCE(dp.bonus_tax, 0)            AS bonus_tax,
    CASE
      WHEN UPPER(COALESCE(dp.payee_segment, '')) = 'PROMOTER'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%PROMOT%'
        THEN 'PROMOTER'
      WHEN UPPER(COALESCE(dp.payee_segment, '')) = 'LOCAL'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%LOCAL%'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%UNVERIFIED%'
        THEN 'LOCAL'
      WHEN UPPER(COALESCE(dp.payee_segment, '')) = 'EMPLOYEE'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%STAFF%'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%EMPLOYEE%'
        THEN 'EMPLOYEE'
      WHEN dp.payee_classification = 'TAX_EXEMPT'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%MUTUAL%'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%EXEMPT%'
        THEN 'MUTUAL FUND'
      WHEN dp.payee_classification = 'COMPANY_INSTITUTION'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%INSTITUT%'
        OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%COMPANY%'
        THEN 'INSTITUTION'
      ELSE 'PUBLIC'
    END AS particular
  FROM public.dividend_payables dp
  WHERE (p_company_id IS NULL OR dp.company_id = p_company_id)
    AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR dp.fiscal_year = p_fiscal_year)
),
grand_totals AS (
  SELECT
    COALESCE(SUM(shares_held), 0)         AS grand_kitta,
    COALESCE(MAX(dividend_rate), 0)       AS detected_rate
  FROM filtered
),
cat_agg AS (
  SELECT
    particular,
    COUNT(*)::bigint                                   AS shareholder_count,
    ROUND(COALESCE(SUM(shares_held), 0)::numeric, 2)  AS kitta,
    ROUND(COALESCE(SUM(bonus_actual), 0)::numeric, 2) AS actual_bonus,
    ROUND(COALESCE(SUM(bonus_issued), 0)::numeric, 2) AS issued_bonus,
    ROUND(COALESCE(SUM(bonus_fraction), 0)::numeric, 2) AS rem_fraction,
    ROUND(COALESCE(SUM(after_bonus_kitta), 0)::numeric, 2) AS after_bonus_kitta,
    ROUND(COALESCE(SUM(gross_dividend), 0)::numeric, 2)  AS gross_dividend,
    ROUND(COALESCE(SUM(bonus_tax), 0)::numeric, 2)    AS bon_tax,
    ROUND(COALESCE(SUM(tax_amount), 0)::numeric, 2)   AS div_tax,
    ROUND(COALESCE(SUM(net_payable), 0)::numeric, 2)  AS net_dividend,
    CASE particular
      WHEN 'PROMOTER'    THEN 1
      WHEN 'PUBLIC'      THEN 2
      WHEN 'LOCAL'       THEN 3
      WHEN 'INSTITUTION' THEN 4
      WHEN 'MUTUAL FUND' THEN 5
      WHEN 'EMPLOYEE'    THEN 6
      ELSE 7
    END AS sort_order
  FROM filtered
  GROUP BY particular
),
cat_numbered AS (
  SELECT
    ROW_NUMBER() OVER (ORDER BY sort_order) AS sn,
    particular,
    shareholder_count,
    kitta,
    actual_bonus,
    issued_bonus,
    rem_fraction,
    after_bonus_kitta,
    gross_dividend,
    bon_tax,
    div_tax,
    net_dividend,
    ROUND(
      CASE WHEN (SELECT grand_kitta FROM grand_totals) > 0
        THEN (kitta / (SELECT grand_kitta FROM grand_totals)) * 100
        ELSE 0
      END, 2) AS composition,
    sort_order
  FROM cat_agg
),
totals AS (
  SELECT
    COUNT(*)::bigint                                       AS shareholder_count,
    ROUND(COALESCE(SUM(shares_held), 0)::numeric, 2)      AS kitta,
    ROUND(COALESCE(SUM(bonus_actual), 0)::numeric, 2)     AS actual_bonus,
    ROUND(COALESCE(SUM(bonus_issued), 0)::numeric, 2)     AS issued_bonus,
    ROUND(COALESCE(SUM(bonus_fraction), 0)::numeric, 2)   AS rem_fraction,
    ROUND(COALESCE(SUM(after_bonus_kitta), 0)::numeric, 2) AS after_bonus_kitta,
    ROUND(COALESCE(SUM(gross_dividend), 0)::numeric, 2)   AS gross_dividend,
    ROUND(COALESCE(SUM(bonus_tax), 0)::numeric, 2)        AS bon_tax,
    ROUND(COALESCE(SUM(tax_amount), 0)::numeric, 2)       AS div_tax,
    ROUND(COALESCE(SUM(net_payable), 0)::numeric, 2)      AS net_dividend
  FROM filtered
),
company_meta AS (
  SELECT
    COALESCE(c.company_name, 'All Companies') AS company_name,
    COALESCE(c.company_code, '')              AS company_code
  FROM public.companies c
  WHERE p_company_id IS NOT NULL AND c.id = p_company_id
  LIMIT 1
),
first_fiscal AS (
  SELECT fiscal_year
  FROM public.dividend_payables
  WHERE (p_company_id IS NULL OR company_id = p_company_id)
    AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
    AND fiscal_year IS NOT NULL
  LIMIT 1
),
rows_json AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'sn',              sn,
      'particular',      particular,
      'shareholderCount', shareholder_count,
      'kitta',           kitta,
      'actualBonus',     actual_bonus,
      'bonusRate',       0,
      'issuedBonus',     issued_bonus,
      'remFraction',     rem_fraction,
      'afterBonusKitta', after_bonus_kitta,
      'grossDividend',   gross_dividend,
      'dividendRate',    (SELECT detected_rate FROM grand_totals),
      'bonTax',          bon_tax,
      'divTax',          div_tax,
      'netDividend',     net_dividend,
      'composition',     composition
    ) ORDER BY sort_order
  ) AS rows_data
  FROM cat_numbered
)
SELECT jsonb_build_object(
  'companyName',          COALESCE((SELECT company_name FROM company_meta), 'All Companies'),
  'companyCode',          COALESCE((SELECT company_code FROM company_meta), ''),
  'fiscalYear',           COALESCE(p_fiscal_year, (SELECT fiscal_year FROM first_fiscal), ''),
  'detectedBonusRate',    0,
  'detectedDividendRate', (SELECT detected_rate FROM grand_totals),
  'rows',                 COALESCE((SELECT rows_data FROM rows_json), '[]'::jsonb),
  'total', (
    SELECT jsonb_build_object(
      'shareholderCount',  shareholder_count,
      'kitta',             kitta,
      'actualBonus',       actual_bonus,
      'issuedBonus',       issued_bonus,
      'remFraction',       rem_fraction,
      'afterBonusKitta',   after_bonus_kitta,
      'grossDividend',     gross_dividend,
      'bonTax',            bon_tax,
      'divTax',            div_tax,
      'netDividend',       net_dividend,
      'composition',       100.00
    ) FROM totals
  )
);
$$;
