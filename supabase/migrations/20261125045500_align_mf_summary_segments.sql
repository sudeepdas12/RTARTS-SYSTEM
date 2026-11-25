-- =============================================================================
-- Refine get_mutual_fund_distribution_summary() precedence so explicit
-- PROMOTER/LOCAL/EMPLOYEE segments remain prioritized over PUBLIC_LEGAL_PERSON.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_mutual_fund_distribution_summary(
  p_company_id uuid DEFAULT NULL::uuid,
  p_fiscal_year text DEFAULT 'all'::text,
  p_from_date text DEFAULT NULL::text,
  p_to_date text DEFAULT NULL::text
)
RETURNS TABLE(type text, transaction_count bigint, kitta numeric, gross numeric, tax numeric, net numeric)
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
        WHEN payee_classification IN ('COMPANY_INSTITUTION', 'BANK_FI', 'FOREIGN_INVESTOR') OR lot_name ILIKE '%INSTITUT%' OR lot_name ILIKE '%COMPANY%' THEN 'INSTITUTION'
        WHEN payee_classification = 'UNCLASSIFIED' THEN 'OTHERS'
        WHEN payee_segment = 'PROMOTER' OR lot_name ILIKE '%PROMOT%' THEN 'PROMOTER'
        WHEN payee_segment = 'LOCAL' OR lot_name ILIKE '%LOCAL%' THEN 'LOCAL'
        WHEN payee_segment = 'EMPLOYEE' OR lot_name ILIKE '%EMPLOYEE%' OR lot_name ILIKE '%STAFF%' THEN 'EMPLOYEE'
        WHEN payee_classification = 'PUBLIC_LEGAL_PERSON' THEN 'INSTITUTION'
        ELSE 'PUBLIC'
      END AS mapped_type
    FROM public.mutual_fund_payables
    WHERE
      (v_is_global_access OR company_id = ANY(v_user_companies))
      AND (p_company_id IS NULL OR company_id = p_company_id)
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
      WHEN 'PROMOTER' THEN 4
      WHEN 'LOCAL' THEN 5
      WHEN 'EMPLOYEE' THEN 6
      ELSE 7
    END;
END;
$$;
