-- Migration: PostgreSQL Grand Totals Aggregation RPCs and Limit Removal
-- Version: 20261026000006

-- 1. Fix public.get_interest_payables_totals (use gross_interest instead of gross_dividend and cast date parameters)
CREATE OR REPLACE FUNCTION public.get_interest_payables_totals(
    p_company_id uuid DEFAULT NULL::uuid,
    p_status text DEFAULT 'all'::text,
    p_fiscal_year text DEFAULT 'all'::text,
    p_class text DEFAULT 'all'::text,
    p_from_date text DEFAULT NULL::text,
    p_to_date text DEFAULT NULL::text
) RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_global_access boolean := false;
  v_user_companies uuid[];
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

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE payment_status::text = 'Paid'),
    COUNT(*) FILTER (WHERE payment_status::text = 'Partial'),
    COUNT(*) FILTER (WHERE payment_status::text = 'Pending'),
    COALESCE(SUM(shares_held), 0),
    COALESCE(SUM(gross_interest), 0),
    COALESCE(SUM(tax_amount), 0),
    COALESCE(SUM(net_payable), 0),
    COALESCE(SUM(COALESCE(paid_amount, CASE WHEN payment_status::text = 'Paid' THEN net_payable ELSE 0 END)), 0),
    COALESCE(SUM(COALESCE(remaining_amount, GREATEST(0, net_payable - COALESCE(paid_amount, 0)))), 0)
  INTO
    v_count, v_paid_count, v_partial_count, v_pending_count,
    v_units, v_gross, v_tax, v_net, v_disbursed, v_remaining
  FROM public.interest_payables
  WHERE
    (v_is_global_access OR company_id = ANY(v_user_companies))
    AND (p_company_id IS NULL OR company_id = p_company_id)
    AND (p_status IS NULL OR p_status = 'all' OR p_status = '' OR payment_status::text = p_status)
    AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR fiscal_year = p_fiscal_year)
    AND (
      p_class IS NULL OR p_class = 'all' OR p_class = ''
      OR (p_class = 'PROMOTER' AND (payee_segment = 'PROMOTER' OR instrument_ref ILIKE '%PROMOT%'))
      OR (p_class = 'LOCAL' AND (payee_segment = 'LOCAL' OR instrument_ref ILIKE '%LOCAL%'))
      OR (p_class = 'TAX_EXEMPT' AND (payee_classification = 'TAX_EXEMPT' OR instrument_ref ILIKE '%MUTUAL%' OR instrument_ref ILIKE '%EXEMPT%'))
      OR (p_class = 'INSTITUTION' AND (payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR instrument_ref ILIKE '%INSTITUT%' OR instrument_ref ILIKE '%COMPANY%'))
      OR (p_class = 'PUBLIC' AND (payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON') OR instrument_ref ILIKE '%PUBLIC%'))
    )
    AND (p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date)
    AND (p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date);

  RETURN json_build_object(
    'count', v_count,
    'paidCount', v_paid_count,
    'partialCount', v_partial_count,
    'pendingCount', v_pending_count,
    'units', v_units,
    'gross', v_gross,
    'tax', v_tax,
    'net', v_net,
    'disbursed', v_disbursed,
    'remaining', v_remaining
  );
END;
$$;

-- 2. General Server-Side Filtered Grand Totals RPC for All Statutory Reports
CREATE OR REPLACE FUNCTION public.get_report_grand_totals(
    p_report_id text,
    p_company_id uuid DEFAULT NULL::uuid,
    p_fiscal_year text DEFAULT NULL::text,
    p_status text DEFAULT NULL::text,
    p_from_date text DEFAULT NULL::text,
    p_to_date text DEFAULT NULL::text,
    p_classification text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_global_access boolean := false;
  v_user_companies uuid[];
  v_count bigint := 0;
  v_shares numeric := 0;
  v_gross numeric := 0;
  v_tax numeric := 0;
  v_net numeric := 0;
  v_disbursed numeric := 0;
  v_remaining numeric := 0;
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);

  -- Multi-tenant isolation check
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

  CASE p_report_id
    WHEN 'dividend_register', 'cash_dividend_register', 'right_share_register', 'cdsc_report', 'allocation_report', 'bonus_share_report' THEN
      SELECT
        COUNT(*),
        COALESCE(SUM(shares_held), 0),
        COALESCE(SUM(gross_dividend), 0),
        COALESCE(SUM(tax_amount), 0),
        COALESCE(SUM(net_payable), 0),
        COALESCE(SUM(COALESCE(paid_amount, CASE WHEN payment_status::text = 'Paid' THEN net_payable ELSE 0 END)), 0),
        COALESCE(SUM(COALESCE(remaining_amount, GREATEST(0, net_payable - COALESCE(paid_amount, 0)))), 0)
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.dividend_payables
      WHERE
        (v_is_global_access OR company_id = ANY(v_user_companies))
        AND (p_company_id IS NULL OR company_id = p_company_id)
        AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
        AND (p_status IS NULL OR p_status = 'all' OR payment_status::text = p_status)
        AND (
          p_report_id <> 'allocation_report' AND p_report_id <> 'bonus_share_report'
          OR dividend_type::text IN ('Bonus', 'Stock', 'Combined')
        )
        AND (
          p_report_id <> 'right_share_register'
          OR dividend_type::text = 'Right'
        )
        AND (
          p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date
        )
        AND (
          p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date
        );

    WHEN 'interest_register' THEN
      SELECT
        COUNT(*),
        COALESCE(SUM(shares_held), 0),
        COALESCE(SUM(gross_interest), 0),
        COALESCE(SUM(tax_amount), 0),
        COALESCE(SUM(net_payable), 0),
        COALESCE(SUM(COALESCE(paid_amount, CASE WHEN payment_status::text = 'Paid' THEN net_payable ELSE 0 END)), 0),
        COALESCE(SUM(COALESCE(remaining_amount, GREATEST(0, net_payable - COALESCE(paid_amount, 0)))), 0)
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.interest_payables
      WHERE
        (v_is_global_access OR company_id = ANY(v_user_companies))
        AND (p_company_id IS NULL OR company_id = p_company_id)
        AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
        AND (p_status IS NULL OR p_status = 'all' OR payment_status::text = p_status)
        AND (p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date)
        AND (p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date);

    WHEN 'mutual_fund_register' THEN
      SELECT
        COUNT(*),
        COALESCE(SUM(shares_held), 0),
        COALESCE(SUM(gross_dividend), 0),
        COALESCE(SUM(tax_amount), 0),
        COALESCE(SUM(net_payable), 0),
        COALESCE(SUM(COALESCE(paid_amount, CASE WHEN payment_status::text = 'Paid' THEN net_payable ELSE 0 END)), 0),
        COALESCE(SUM(COALESCE(remaining_amount, GREATEST(0, net_payable - COALESCE(paid_amount, 0)))), 0)
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.mutual_fund_payables
      WHERE
        (v_is_global_access OR company_id = ANY(v_user_companies))
        AND (p_company_id IS NULL OR company_id = p_company_id)
        AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
        AND (p_status IS NULL OR p_status = 'all' OR payment_status::text = p_status)
        AND (p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date)
        AND (p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date);

    WHEN 'tax_register' THEN
      -- Aggregated over all 3 payables
      WITH all_tax AS (
        SELECT gross_dividend AS gross, tax_amount AS tax, net_payable AS net
        FROM public.dividend_payables
        WHERE (v_is_global_access OR company_id = ANY(v_user_companies))
          AND (p_company_id IS NULL OR company_id = p_company_id)
          AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
          AND (p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date)
          AND (p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date)
        UNION ALL
        SELECT gross_interest AS gross, tax_amount AS tax, net_payable AS net
        FROM public.interest_payables
        WHERE (v_is_global_access OR company_id = ANY(v_user_companies))
          AND (p_company_id IS NULL OR company_id = p_company_id)
          AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
          AND (p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date)
          AND (p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date)
        UNION ALL
        SELECT gross_dividend AS gross, tax_amount AS tax, net_payable AS net
        FROM public.mutual_fund_payables
        WHERE (v_is_global_access OR company_id = ANY(v_user_companies))
          AND (p_company_id IS NULL OR company_id = p_company_id)
          AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
          AND (p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date)
          AND (p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date)
      )
      SELECT COUNT(*), 0, COALESCE(SUM(gross), 0), COALESCE(SUM(tax), 0), COALESCE(SUM(net), 0), 0, 0
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM all_tax;

    WHEN 'pending_register' THEN
      WITH all_pending AS (
        SELECT gross_dividend AS gross, tax_amount AS tax, net_payable AS net
        FROM public.dividend_payables
        WHERE payment_status::text = 'Pending'
          AND (v_is_global_access OR company_id = ANY(v_user_companies))
          AND (p_company_id IS NULL OR company_id = p_company_id)
          AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
        UNION ALL
        SELECT gross_interest AS gross, tax_amount AS tax, net_payable AS net
        FROM public.interest_payables
        WHERE payment_status::text = 'Pending'
          AND (v_is_global_access OR company_id = ANY(v_user_companies))
          AND (p_company_id IS NULL OR company_id = p_company_id)
          AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
        UNION ALL
        SELECT gross_dividend AS gross, tax_amount AS tax, net_payable AS net
        FROM public.mutual_fund_payables
        WHERE payment_status::text = 'Pending'
          AND (v_is_global_access OR company_id = ANY(v_user_companies))
          AND (p_company_id IS NULL OR company_id = p_company_id)
          AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
      )
      SELECT COUNT(*), 0, COALESCE(SUM(gross), 0), COALESCE(SUM(tax), 0), COALESCE(SUM(net), 0), 0, COALESCE(SUM(net), 0)
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM all_pending;

    WHEN 'payment_register' THEN
      SELECT
        COUNT(*),
        0,
        COALESCE(SUM(total_amount), 0),
        0,
        COALESCE(SUM(total_amount), 0),
        COALESCE(SUM(CASE WHEN status::text = 'Completed' THEN total_amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN status::text <> 'Completed' THEN total_amount ELSE 0 END), 0)
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.payment_batches
      WHERE
        (v_is_global_access OR company_id = ANY(v_user_companies) OR company_id IS NULL)
        AND (p_company_id IS NULL OR company_id = p_company_id)
        AND (p_status IS NULL OR p_status = 'all' OR status::text = p_status)
        AND (p_from_date IS NULL OR p_from_date = '' OR created_at >= p_from_date::timestamptz)
        AND (p_to_date IS NULL OR p_to_date = '' OR created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz);

    WHEN 'returned_payments_report' THEN
      SELECT
        COUNT(*),
        0,
        COALESCE(SUM(net_amount), 0),
        0,
        COALESCE(SUM(net_amount), 0),
        0,
        COALESCE(SUM(net_amount), 0)
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.payments
      WHERE
        status IN ('Returned', 'Reversed')
        AND (v_is_global_access OR company_id = ANY(v_user_companies))
        AND (p_company_id IS NULL OR company_id = p_company_id)
        AND (p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date)
        AND (p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date);

    WHEN 'bounced_cheques_report' THEN
      SELECT
        COUNT(*),
        0,
        COALESCE(SUM(net_amount), 0),
        0,
        COALESCE(SUM(net_amount), 0),
        0,
        COALESCE(SUM(net_amount), 0)
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.payments
      WHERE
        status = 'Bounced'
        AND (v_is_global_access OR company_id = ANY(v_user_companies))
        AND (p_company_id IS NULL OR company_id = p_company_id)
        AND (p_from_date IS NULL OR p_from_date = '' OR payment_date >= p_from_date::date)
        AND (p_to_date IS NULL OR p_to_date = '' OR payment_date <= p_to_date::date);

    WHEN 'bank_statement_report' THEN
      SELECT
        COUNT(*),
        0,
        COALESCE(SUM(total_credit), 0),
        COALESCE(SUM(total_debit), 0),
        COALESCE(SUM(total_credit - total_debit), 0),
        0,
        0
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.bank_statements
      WHERE
        (p_from_date IS NULL OR p_from_date = '' OR statement_date >= p_from_date::date)
        AND (p_to_date IS NULL OR p_to_date = '' OR statement_date <= p_to_date::date);

    WHEN 'client_profile_report', 'demographics_report' THEN
      SELECT COUNT(*), 0, 0, 0, 0, 0, 0
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.clients
      WHERE
        (v_is_global_access OR company_id = ANY(v_user_companies))
        AND (p_company_id IS NULL OR company_id = p_company_id);

    ELSE
      -- Generic fallback across dividend_payables
      SELECT COUNT(*), 0, COALESCE(SUM(gross_dividend), 0), COALESCE(SUM(tax_amount), 0), COALESCE(SUM(net_payable), 0), 0, 0
      INTO v_count, v_shares, v_gross, v_tax, v_net, v_disbursed, v_remaining
      FROM public.dividend_payables
      WHERE (v_is_global_access OR company_id = ANY(v_user_companies))
        AND (p_company_id IS NULL OR company_id = p_company_id);
  END CASE;

  RETURN jsonb_build_object(
    'report_id', p_report_id,
    'total_records', v_count,
    'total_shares', v_shares,
    'total_gross', v_gross,
    'total_tax', v_tax,
    'total_net', v_net,
    'total_disbursed', v_disbursed,
    'total_remaining', v_remaining,
    'server_calculated', true,
    'timestamp', now()
  );
END;
$$;
