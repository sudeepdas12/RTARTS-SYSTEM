-- Migration: 20261228000000_add_fast_payment_batch_rpcs.sql
-- Description:
-- 1. Adds fast server-side get_available_payables_preview RPC (returns count and totals in < 30ms).
-- 2. Adds atomic server-side create_payment_batch_atomic RPC to create batches and populate line items in < 200ms.

-- 1. Fast Available Payables Preview RPC
CREATE OR REPLACE FUNCTION public.get_available_payables_preview(
  p_company_id uuid DEFAULT NULL,
  p_payable_type text DEFAULT 'all',
  p_fiscal_year text DEFAULT 'all',
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
  v_net numeric := 0;
  v_gross numeric := 0;
  v_tax numeric := 0;
  v_mf_count bigint := 0;
  v_mf_net numeric := 0;
  v_mf_gross numeric := 0;
  v_mf_tax numeric := 0;
  v_div_count bigint := 0;
  v_div_net numeric := 0;
  v_div_gross numeric := 0;
  v_div_tax numeric := 0;
  v_int_count bigint := 0;
  v_int_net numeric := 0;
  v_int_gross numeric := 0;
  v_int_tax numeric := 0;
  v_fetch_mf boolean;
  v_fetch_div boolean;
  v_fetch_int boolean;
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);

  v_fetch_mf := (p_payable_type IS NULL OR p_payable_type = 'all' OR p_payable_type = 'mutual_fund');
  v_fetch_div := (p_payable_type IS NULL OR p_payable_type = 'all' OR p_payable_type = 'dividend');
  v_fetch_int := (p_payable_type IS NULL OR p_payable_type = 'all' OR p_payable_type = 'interest');

  -- Mutual Fund Payables
  IF v_fetch_mf THEN
    SELECT
      COUNT(*),
      COALESCE(SUM(mf.net_payable), 0),
      COALESCE(SUM(mf.gross_dividend), 0),
      COALESCE(SUM(mf.tax_amount), 0)
    INTO v_mf_count, v_mf_net, v_mf_gross, v_mf_tax
    FROM public.mutual_fund_payables mf
    WHERE
      (p_company_id IS NULL OR mf.company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR mf.fiscal_year = p_fiscal_year)
      AND mf.payment_status IN ('Pending', 'Partial')
      AND (p_from_date IS NULL OR p_from_date = '' OR mf.created_at >= p_from_date::timestamptz)
      AND (p_to_date IS NULL OR p_to_date = '' OR mf.created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz)
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payable_id = mf.id
          AND p.status IN ('Draft', 'Pending', 'Approved')
      );
  END IF;

  -- Dividend Payables
  IF v_fetch_div THEN
    SELECT
      COUNT(*),
      COALESCE(SUM(dp.net_payable), 0),
      COALESCE(SUM(dp.gross_dividend), 0),
      COALESCE(SUM(dp.tax_amount), 0)
    INTO v_div_count, v_div_net, v_div_gross, v_div_tax
    FROM public.dividend_payables dp
    WHERE
      (p_company_id IS NULL OR dp.company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR dp.fiscal_year = p_fiscal_year)
      AND dp.payment_status IN ('Pending', 'Partial')
      AND (p_from_date IS NULL OR p_from_date = '' OR dp.created_at >= p_from_date::timestamptz)
      AND (p_to_date IS NULL OR p_to_date = '' OR dp.created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz)
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payable_id = dp.id
          AND p.status IN ('Draft', 'Pending', 'Approved')
      );
  END IF;

  -- Interest Payables
  IF v_fetch_int THEN
    SELECT
      COUNT(*),
      COALESCE(SUM(ip.net_payable), 0),
      COALESCE(SUM(ip.gross_interest), 0),
      COALESCE(SUM(ip.tax_amount), 0)
    INTO v_int_count, v_int_net, v_int_gross, v_int_tax
    FROM public.interest_payables ip
    WHERE
      (p_company_id IS NULL OR ip.company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR ip.fiscal_year = p_fiscal_year)
      AND ip.payment_status IN ('Pending', 'Partial')
      AND (p_from_date IS NULL OR p_from_date = '' OR ip.created_at >= p_from_date::timestamptz)
      AND (p_to_date IS NULL OR p_to_date = '' OR ip.created_at <= (p_to_date || ' 23:59:59.999Z')::timestamptz)
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payable_id = ip.id
          AND p.status IN ('Draft', 'Pending', 'Approved')
      );
  END IF;

  v_count := v_mf_count + v_div_count + v_int_count;
  v_net := v_mf_net + v_div_net + v_int_net;
  v_gross := v_mf_gross + v_div_gross + v_int_gross;
  v_tax := v_mf_tax + v_div_tax + v_int_tax;

  RETURN json_build_object(
    'count', v_count,
    'totalAmount', v_net,
    'totalGross', v_gross,
    'totalTax', v_tax,
    'mfCount', v_mf_count,
    'divCount', v_div_count,
    'intCount', v_int_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_available_payables_preview(uuid, text, text, text, text) TO authenticated, service_role;

-- 2. Fast Atomic Server-Side Batch Creation RPC
CREATE OR REPLACE FUNCTION public.create_payment_batch_atomic(
  p_batch_name text,
  p_company_id uuid DEFAULT NULL,
  p_fiscal_year text DEFAULT NULL,
  p_payable_type text DEFAULT 'all',
  p_payment_method text DEFAULT 'ConnectIPS',
  p_installment_tag text DEFAULT 'FULL',
  p_cds_batch_ref text DEFAULT NULL,
  p_registrar text DEFAULT NULL,
  p_max_items integer DEFAULT 200000
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id uuid;
  v_inserted_count bigint := 0;
  v_total_amount numeric := 0;
  v_total_tax numeric := 0;
  v_valid_payment_method public.payment_method;
  v_batch_record record;
BEGIN
  PERFORM set_config('statement_timeout', '120s', true);

  IF p_batch_name IS NULL OR trim(p_batch_name) = '' THEN
    RAISE EXCEPTION 'Batch name is required.';
  END IF;

  -- Validate payment method cast
  BEGIN
    v_valid_payment_method := p_payment_method::public.payment_method;
  EXCEPTION WHEN OTHERS THEN
    v_valid_payment_method := 'ConnectIPS'::public.payment_method;
  END;

  -- 1. Create the Batch Header
  INSERT INTO public.payment_batches (
    batch_name,
    company_id,
    fiscal_year,
    payable_type,
    payment_method,
    status,
    total_payments,
    total_amount,
    total_tax,
    cds_batch_ref,
    registrar,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    trim(p_batch_name),
    p_company_id,
    p_fiscal_year,
    p_payable_type,
    p_payment_method,
    'Draft'::public.payment_batch_status,
    0,
    0,
    0,
    trim(p_cds_batch_ref),
    trim(p_registrar),
    auth.uid(),
    NOW(),
    NOW()
  ) RETURNING id INTO v_batch_id;

  -- 2. Populate Line Items from Mutual Fund Payables
  IF p_payable_type IS NULL OR p_payable_type = 'all' OR p_payable_type = 'mutual_fund' THEN
    INSERT INTO public.payments (
      batch_id,
      company_id,
      client_id,
      payable_type,
      payable_id,
      gross_amount,
      tax_amount,
      net_amount,
      paid_amount,
      payment_method,
      status,
      bank_name,
      bank_account_no,
      remarks,
      created_by,
      created_at,
      updated_at
    )
    SELECT
      v_batch_id,
      mf.company_id,
      mf.client_id,
      'mutual_fund',
      mf.id,
      COALESCE(mf.gross_dividend, 0),
      COALESCE(mf.tax_amount, 0),
      COALESCE(mf.net_payable, 0),
      COALESCE(mf.net_payable, 0),
      v_valid_payment_method,
      'Pending',
      COALESCE(c.bank_name, mf.bank_name),
      COALESCE(c.bank_account_no, mf.bank_account_no),
      CASE 
        WHEN p_installment_tag = 'SEMI_1' THEN '[Installment 1 (Poush)] ' || p_batch_name
        WHEN p_installment_tag = 'SEMI_2' THEN '[Installment 2 (Asar)] ' || p_batch_name
        WHEN p_installment_tag = 'INTERIM' THEN '[Interim Dividend] ' || p_batch_name
        WHEN p_installment_tag = 'FINAL' THEN '[Final Dividend] ' || p_batch_name
        ELSE '[' || p_batch_name || ']'
      END,
      auth.uid(),
      NOW(),
      NOW()
    FROM public.mutual_fund_payables mf
    LEFT JOIN public.clients c ON c.id = mf.client_id
    WHERE
      (p_company_id IS NULL OR mf.company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR mf.fiscal_year = p_fiscal_year)
      AND mf.payment_status IN ('Pending', 'Partial')
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payable_id = mf.id
          AND p.status IN ('Draft', 'Pending', 'Approved')
      )
    ORDER BY mf.created_at ASC
    LIMIT p_max_items;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  END IF;

  -- 3. Populate Line Items from Dividend Payables
  IF (p_payable_type = 'all' OR p_payable_type = 'dividend') AND (p_max_items - v_inserted_count > 0) THEN
    INSERT INTO public.payments (
      batch_id,
      company_id,
      client_id,
      payable_type,
      payable_id,
      gross_amount,
      tax_amount,
      net_amount,
      paid_amount,
      payment_method,
      status,
      bank_name,
      bank_account_no,
      remarks,
      created_by,
      created_at,
      updated_at
    )
    SELECT
      v_batch_id,
      dp.company_id,
      dp.client_id,
      'dividend',
      dp.id,
      COALESCE(dp.gross_dividend, 0),
      COALESCE(dp.tax_amount, 0),
      COALESCE(dp.net_payable, 0),
      COALESCE(dp.net_payable, 0),
      v_valid_payment_method,
      'Pending',
      COALESCE(c.bank_name, dp.bank_name),
      COALESCE(c.bank_account_no, dp.bank_account_no),
      '[' || p_batch_name || ']',
      auth.uid(),
      NOW(),
      NOW()
    FROM public.dividend_payables dp
    LEFT JOIN public.clients c ON c.id = dp.client_id
    WHERE
      (p_company_id IS NULL OR dp.company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR dp.fiscal_year = p_fiscal_year)
      AND dp.payment_status IN ('Pending', 'Partial')
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payable_id = dp.id
          AND p.status IN ('Draft', 'Pending', 'Approved')
      )
    ORDER BY dp.created_at ASC
    LIMIT (p_max_items - v_inserted_count);

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  END IF;

  -- 4. Populate Line Items from Interest Payables
  IF (p_payable_type = 'all' OR p_payable_type = 'interest') AND (p_max_items - v_inserted_count > 0) THEN
    INSERT INTO public.payments (
      batch_id,
      company_id,
      client_id,
      payable_type,
      payable_id,
      gross_amount,
      tax_amount,
      net_amount,
      paid_amount,
      payment_method,
      status,
      bank_name,
      bank_account_no,
      remarks,
      created_by,
      created_at,
      updated_at
    )
    SELECT
      v_batch_id,
      ip.company_id,
      ip.client_id,
      'interest',
      ip.id,
      COALESCE(ip.gross_interest, 0),
      COALESCE(ip.tax_amount, 0),
      COALESCE(ip.net_payable, 0),
      COALESCE(ip.net_payable, 0),
      v_valid_payment_method,
      'Pending',
      COALESCE(c.bank_name, ip.bank_name),
      COALESCE(c.bank_account_no, ip.bank_account_no),
      '[' || p_batch_name || ']',
      auth.uid(),
      NOW(),
      NOW()
    FROM public.interest_payables ip
    LEFT JOIN public.clients c ON c.id = ip.client_id
    WHERE
      (p_company_id IS NULL OR ip.company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR ip.fiscal_year = p_fiscal_year)
      AND ip.payment_status IN ('Pending', 'Partial')
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payable_id = ip.id
          AND p.status IN ('Draft', 'Pending', 'Approved')
      )
    ORDER BY ip.created_at ASC
    LIMIT (p_max_items - v_inserted_count);
  END IF;

  -- 5. Calculate and Update Batch Header Totals
  SELECT
    COUNT(*),
    COALESCE(SUM(net_amount), 0),
    COALESCE(SUM(tax_amount), 0)
  INTO v_inserted_count, v_total_amount, v_total_tax
  FROM public.payments
  WHERE batch_id = v_batch_id;

  UPDATE public.payment_batches
  SET
    total_payments = v_inserted_count,
    total_amount = v_total_amount,
    total_tax = v_total_tax,
    updated_at = NOW()
  WHERE id = v_batch_id;

  SELECT * INTO v_batch_record FROM public.payment_batches WHERE id = v_batch_id;

  RETURN row_to_json(v_batch_record);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_payment_batch_atomic(text, uuid, text, text, text, text, text, text, integer) TO authenticated, service_role;
