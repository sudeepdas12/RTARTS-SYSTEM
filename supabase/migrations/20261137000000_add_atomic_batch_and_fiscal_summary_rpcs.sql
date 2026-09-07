-- ============================================================================
-- Migration: Add Atomic Batch Completion and Fiscal Summary RPCs
-- ============================================================================

-- 1. Atomic Payment Batch Completion Function
CREATE OR REPLACE FUNCTION public.complete_payment_batch_atomic(
  p_batch_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_batch record;
  v_payments_updated bigint := 0;
  v_div_updated bigint := 0;
  v_int_updated bigint := 0;
  v_mf_updated bigint := 0;
  v_today date := CURRENT_DATE;
BEGIN
  -- 1. Fetch and lock batch record
  SELECT * INTO v_batch
  FROM public.payment_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment batch with id % not found', p_batch_id;
  END IF;

  -- 2. Update payment batch status
  UPDATE public.payment_batches
  SET
    status = 'Completed',
    processed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_batch_id;

  -- 3. Update all payments in this batch
  WITH updated_payments AS (
    UPDATE public.payments
    SET
      status = 'Completed',
      payment_date = v_today,
      updated_at = NOW()
    WHERE batch_id = p_batch_id
      AND status != 'Completed'
    RETURNING id, payable_id, payable_type
  )
  SELECT COUNT(*) INTO v_payments_updated FROM updated_payments;

  -- 4. Cascade to underlying dividend payables
  WITH target_divs AS (
    SELECT DISTINCT p.payable_id
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.payable_type = 'dividend'
      AND p.payable_id IS NOT NULL
  ),
  updated_divs AS (
    UPDATE public.dividend_payables dp
    SET
      payment_status = 'Paid',
      payment_date = v_today,
      updated_at = NOW()
    FROM target_divs td
    WHERE dp.id = td.payable_id
    RETURNING dp.id
  )
  SELECT COUNT(*) INTO v_div_updated FROM updated_divs;

  -- 5. Cascade to underlying interest payables
  WITH target_ints AS (
    SELECT DISTINCT p.payable_id
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.payable_type = 'interest'
      AND p.payable_id IS NOT NULL
  ),
  updated_ints AS (
    UPDATE public.interest_payables ip
    SET
      payment_status = 'Paid',
      payment_date = v_today,
      updated_at = NOW()
    FROM target_ints ti
    WHERE ip.id = ti.payable_id
    RETURNING ip.id
  )
  SELECT COUNT(*) INTO v_int_updated FROM updated_ints;

  -- 6. Cascade to underlying mutual fund payables
  WITH target_mfs AS (
    SELECT DISTINCT p.payable_id
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.payable_type = 'mutual_fund'
      AND p.payable_id IS NOT NULL
  ),
  updated_mfs AS (
    UPDATE public.mutual_fund_payables mp
    SET
      payment_status = 'Paid',
      payment_date = v_today,
      updated_at = NOW()
    FROM target_mfs tm
    WHERE mp.id = tm.payable_id
    RETURNING mp.id
  )
  SELECT COUNT(*) INTO v_mf_updated FROM updated_mfs;

  -- 7. Audit log record
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_type,
    entity_id,
    new_values,
    created_at
  ) VALUES (
    p_user_id,
    'BATCH_COMPLETED_ATOMIC',
    'payment_batches',
    p_batch_id::text,
    json_build_object(
      'batch_id', p_batch_id,
      'payments_completed', v_payments_updated,
      'dividend_payables_updated', v_div_updated,
      'interest_payables_updated', v_int_updated,
      'mutual_fund_payables_updated', v_mf_updated
    ),
    NOW()
  );

  RETURN json_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'payments_completed', v_payments_updated,
    'dividend_payables_updated', v_div_updated,
    'interest_payables_updated', v_int_updated,
    'mutual_fund_payables_updated', v_mf_updated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_payment_batch_atomic(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_payment_batch_atomic(uuid, uuid) TO service_role;


-- 2. Server-side Fiscal Summary Aggregation Function
CREATE OR REPLACE FUNCTION public.get_company_fiscal_summary_rpc(
  p_fiscal_year text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
      COALESCE(SUM(dp.net_payable) FILTER (WHERE dp.payment_status = 'Paid'), 0) AS dividend_paid,
      COALESCE(SUM(dp.net_payable) FILTER (WHERE dp.payment_status != 'Paid'), 0) AS dividend_pending
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
      COALESCE(SUM(ip.net_payable) FILTER (WHERE ip.payment_status = 'Paid'), 0) AS interest_paid,
      COALESCE(SUM(ip.net_payable) FILTER (WHERE ip.payment_status != 'Paid'), 0) AS interest_pending
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
      COALESCE(SUM(mp.net_payable) FILTER (WHERE mp.payment_status = 'Paid'), 0) AS mutual_fund_paid,
      COALESCE(SUM(mp.net_payable) FILTER (WHERE mp.payment_status != 'Paid'), 0) AS mutual_fund_pending
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
        'interest_count', COALESCE(is_data.interest_count, 0),
        'interest_gross', ROUND(COALESCE(is_data.interest_gross, 0)::numeric, 2),
        'interest_net', ROUND(COALESCE(is_data.interest_net, 0)::numeric, 2),
        'mutual_fund_count', COALESCE(ms.mutual_fund_count, 0),
        'mutual_fund_gross', ROUND(COALESCE(ms.mutual_fund_gross, 0)::numeric, 2),
        'mutual_fund_net', ROUND(COALESCE(ms.mutual_fund_net, 0)::numeric, 2),
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
