-- Migration: 20261231000002_fix_payment_batch_partial_and_method.sql
-- Fixes in payment-batch creation (create_payment_batch_atomic, populate_payment_batch_chunk):
--   1. Payables with status 'Partial' were batched at their FULL net_payable, so the remainder was
--      paid out a second time. Each line now carries only the unpaid remainder
--      (net_payable - paid_amount), with gross/tax pro-rated so gross - tax = net.
--      payments.paid_amount keeps its existing meaning (the amount this payment will settle);
--      complete_payment_batch_atomic adds it to the payable's paid_amount.
--   2. An unknown payment method no longer silently becomes 'ConnectIPS' (the batch header kept the
--      typo while the rows got ConnectIPS). It now raises an error.
--   3. Bank details: both functions now prefer the client master record, then the payable's own copy
--      (previously the chunk path preferred the payable and the atomic path the client).
--   4. Fully paid rows (remaining <= 0) are never batched.

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
SET statement_timeout = '120s'
AS $$
DECLARE
  v_batch_id uuid;
  v_inserted_count bigint := 0;
  v_total_amount numeric := 0;
  v_total_tax numeric := 0;
  v_valid_payment_method public.payment_method;
  v_batch_record record;
BEGIN
  -- Disable individual row audit logging for this transaction to allow sub-second bulk insertion
  PERFORM set_config('app.skip_audit', 'on', true);

  IF p_batch_name IS NULL OR trim(p_batch_name) = '' THEN
    RAISE EXCEPTION 'Batch name is required.';
  END IF;

  -- Validate payment method cast
  BEGIN
    v_valid_payment_method := p_payment_method::public.payment_method;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid payment method: %', p_payment_method USING ERRCODE = '22023';
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
      GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) + CASE WHEN COALESCE(mf.net_payable,0) > 0 THEN round(COALESCE(mf.tax_amount,0) * GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) / mf.net_payable, 2) ELSE 0 END, CASE WHEN COALESCE(mf.net_payable,0) > 0 THEN round(COALESCE(mf.tax_amount,0) * GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) / mf.net_payable, 2) ELSE 0 END, GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0), GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0),
      v_valid_payment_method,
      'Pending',
      COALESCE(NULLIF(c.bank_name,''), mf.bank_name),
      COALESCE(NULLIF(c.bank_account_no,''), mf.bank_account_no),
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
      AND GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payable_id = mf.id
          AND p.status IN ('Draft', 'Pending', 'Approved')
      )
    ORDER BY mf.id ASC
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
      GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) + CASE WHEN COALESCE(dp.net_payable,0) > 0 THEN round(COALESCE(dp.tax_amount,0) * GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) / dp.net_payable, 2) ELSE 0 END, CASE WHEN COALESCE(dp.net_payable,0) > 0 THEN round(COALESCE(dp.tax_amount,0) * GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) / dp.net_payable, 2) ELSE 0 END, GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0), GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0),
      v_valid_payment_method,
      'Pending',
      COALESCE(NULLIF(c.bank_name,''), dp.bank_name),
      COALESCE(NULLIF(c.bank_account_no,''), dp.bank_account_no),
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
      AND GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payable_id = dp.id
          AND p.status IN ('Draft', 'Pending', 'Approved')
      )
    ORDER BY dp.id ASC
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
      GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0) + CASE WHEN COALESCE(ip.net_payable,0) > 0 THEN round(COALESCE(ip.tax_amount,0) * GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0) / ip.net_payable, 2) ELSE 0 END, CASE WHEN COALESCE(ip.net_payable,0) > 0 THEN round(COALESCE(ip.tax_amount,0) * GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0) / ip.net_payable, 2) ELSE 0 END, GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0), GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0),
      v_valid_payment_method,
      'Pending',
      COALESCE(NULLIF(c.bank_name,''), ip.bank_name),
      COALESCE(NULLIF(c.bank_account_no,''), ip.bank_account_no),
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
      AND GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payable_id = ip.id
          AND p.status IN ('Draft', 'Pending', 'Approved')
      )
    ORDER BY ip.id ASC
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

  -- Re-enable audit logging and record batch summary audit log
  PERFORM set_config('app.skip_audit', 'off', true);

  INSERT INTO public.audit_logs(user_id, action, table_name, record_id, new_value)
  VALUES (
    auth.uid(),
    'INSERT',
    'payment_batches',
    v_batch_id::text,
    jsonb_build_object(
      'batch_id', v_batch_id,
      'batch_name', p_batch_name,
      'total_payments', v_inserted_count,
      'total_amount', v_total_amount,
      'total_tax', v_total_tax
    )
  );

  SELECT * INTO v_batch_record FROM public.payment_batches WHERE id = v_batch_id;
  RETURN to_jsonb(v_batch_record);
END;
$$;

CREATE OR REPLACE FUNCTION public.populate_payment_batch_chunk(
  p_batch_id uuid,
  p_company_id uuid DEFAULT NULL,
  p_fiscal_year text DEFAULT NULL,
  p_payable_type text DEFAULT 'all',
  p_payment_method text DEFAULT 'ConnectIPS',
  p_installment_tag text DEFAULT 'FULL',
  p_limit integer DEFAULT 2500
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_count bigint := 0;
  v_total_amount numeric := 0;
  v_total_tax numeric := 0;
  v_valid_payment_method public.payment_method;
  v_batch_name text;
  v_has_more boolean := false;
  v_current_total bigint := 0;
BEGIN
  PERFORM set_config('app.skip_audit', 'on', true);

  SELECT batch_name INTO v_batch_name FROM public.payment_batches WHERE id = p_batch_id;
  IF v_batch_name IS NULL THEN
    RAISE EXCEPTION 'Batch not found.';
  END IF;

  BEGIN
    v_valid_payment_method := p_payment_method::public.payment_method;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid payment method: %', p_payment_method USING ERRCODE = '22023';
  END;

  -- 1. Insert chunk from Mutual Fund Payables
  IF p_payable_type IS NULL OR p_payable_type = 'all' OR p_payable_type = 'mutual_fund' THEN
    INSERT INTO public.payments (
      batch_id, company_id, client_id, payable_type, payable_id,
      gross_amount, tax_amount, net_amount, paid_amount, payment_method,
      status, bank_name, bank_account_no, remarks, created_by, created_at, updated_at
    )
    SELECT
      p_batch_id, mf.company_id, mf.client_id, 'mutual_fund', mf.id,
      GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) + CASE WHEN COALESCE(mf.net_payable,0) > 0 THEN round(COALESCE(mf.tax_amount,0) * GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) / mf.net_payable, 2) ELSE 0 END, CASE WHEN COALESCE(mf.net_payable,0) > 0 THEN round(COALESCE(mf.tax_amount,0) * GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) / mf.net_payable, 2) ELSE 0 END, GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0), GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0),
      v_valid_payment_method, 'Pending',
      COALESCE(NULLIF(c.bank_name,''), mf.bank_name), COALESCE(NULLIF(c.bank_account_no,''), mf.bank_account_no),
      CASE 
        WHEN p_installment_tag = 'SEMI_1' THEN '[Installment 1 (Poush)] ' || v_batch_name
        WHEN p_installment_tag = 'SEMI_2' THEN '[Installment 2 (Asar)] ' || v_batch_name
        WHEN p_installment_tag = 'INTERIM' THEN '[Interim Dividend] ' || v_batch_name
        WHEN p_installment_tag = 'FINAL' THEN '[Final Dividend] ' || v_batch_name
        ELSE '[' || v_batch_name || ']'
      END,
      auth.uid(), NOW(), NOW()
    FROM public.mutual_fund_payables mf
    LEFT JOIN public.clients c ON c.id = mf.client_id
    WHERE
      (p_company_id IS NULL OR mf.company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR mf.fiscal_year = p_fiscal_year)
      AND mf.payment_status IN ('Pending', 'Partial')
      AND GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        JOIN public.payment_batches pb ON pb.id = p.batch_id
        WHERE p.payable_id = mf.id
          AND p.status IN ('Draft', 'Pending', 'Approved')
      )
    ORDER BY mf.id ASC
    LIMIT p_limit;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  END IF;

  -- 2. Insert chunk from Dividend Payables if room remains
  IF (p_payable_type = 'all' OR p_payable_type = 'dividend') AND (p_limit - v_inserted_count > 0) THEN
    DECLARE
      v_div_inserted bigint := 0;
    BEGIN
      INSERT INTO public.payments (
        batch_id, company_id, client_id, payable_type, payable_id,
        gross_amount, tax_amount, net_amount, paid_amount, payment_method,
        status, bank_name, bank_account_no, remarks, created_by, created_at, updated_at
      )
      SELECT
        p_batch_id, dp.company_id, dp.client_id, 'dividend', dp.id,
        GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) + CASE WHEN COALESCE(dp.net_payable,0) > 0 THEN round(COALESCE(dp.tax_amount,0) * GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) / dp.net_payable, 2) ELSE 0 END, CASE WHEN COALESCE(dp.net_payable,0) > 0 THEN round(COALESCE(dp.tax_amount,0) * GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) / dp.net_payable, 2) ELSE 0 END, GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0), GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0),
        v_valid_payment_method, 'Pending',
        COALESCE(NULLIF(c.bank_name,''), dp.bank_name), COALESCE(NULLIF(c.bank_account_no,''), dp.bank_account_no),
        '[' || v_batch_name || ']',
        auth.uid(), NOW(), NOW()
      FROM public.dividend_payables dp
      LEFT JOIN public.clients c ON c.id = dp.client_id
      WHERE
        (p_company_id IS NULL OR dp.company_id = p_company_id)
        AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR dp.fiscal_year = p_fiscal_year)
        AND dp.payment_status IN ('Pending', 'Partial')
      AND GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM public.payments p
          JOIN public.payment_batches pb ON pb.id = p.batch_id
          WHERE p.payable_id = dp.id
            AND p.status IN ('Draft', 'Pending', 'Approved')
        )
      ORDER BY dp.id ASC
      LIMIT (p_limit - v_inserted_count);

      GET DIAGNOSTICS v_div_inserted = ROW_COUNT;
      v_inserted_count := v_inserted_count + v_div_inserted;
    END;
  END IF;

  -- 3. Insert chunk from Interest Payables if room remains
  IF (p_payable_type = 'all' OR p_payable_type = 'interest') AND (p_limit - v_inserted_count > 0) THEN
    DECLARE
      v_int_inserted bigint := 0;
    BEGIN
      INSERT INTO public.payments (
        batch_id, company_id, client_id, payable_type, payable_id,
        gross_amount, tax_amount, net_amount, paid_amount, payment_method,
        status, bank_name, bank_account_no, remarks, created_by, created_at, updated_at
      )
      SELECT
        p_batch_id, ip.company_id, ip.client_id, 'interest', ip.id,
        GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0) + CASE WHEN COALESCE(ip.net_payable,0) > 0 THEN round(COALESCE(ip.tax_amount,0) * GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0) / ip.net_payable, 2) ELSE 0 END, CASE WHEN COALESCE(ip.net_payable,0) > 0 THEN round(COALESCE(ip.tax_amount,0) * GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0) / ip.net_payable, 2) ELSE 0 END, GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0), GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0),
        v_valid_payment_method, 'Pending',
        COALESCE(NULLIF(c.bank_name,''), ip.bank_name), COALESCE(NULLIF(c.bank_account_no,''), ip.bank_account_no),
        '[' || v_batch_name || ']',
        auth.uid(), NOW(), NOW()
      FROM public.interest_payables ip
      LEFT JOIN public.clients c ON c.id = ip.client_id
      WHERE
        (p_company_id IS NULL OR ip.company_id = p_company_id)
        AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR ip.fiscal_year = p_fiscal_year)
        AND ip.payment_status IN ('Pending', 'Partial')
      AND GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM public.payments p
          JOIN public.payment_batches pb ON pb.id = p.batch_id
          WHERE p.payable_id = ip.id
            AND p.status IN ('Draft', 'Pending', 'Approved')
        )
      ORDER BY ip.id ASC
      LIMIT (p_limit - v_inserted_count);

      GET DIAGNOSTICS v_int_inserted = ROW_COUNT;
      v_inserted_count := v_inserted_count + v_int_inserted;
    END;
  END IF;

  -- 4. Update Header Totals
  SELECT
    COUNT(*),
    COALESCE(SUM(net_amount), 0),
    COALESCE(SUM(tax_amount), 0)
  INTO v_current_total, v_total_amount, v_total_tax
  FROM public.payments
  WHERE batch_id = p_batch_id;

  UPDATE public.payment_batches
  SET
    total_payments = v_current_total,
    total_amount = v_total_amount,
    total_tax = v_total_tax,
    updated_at = NOW()
  WHERE id = p_batch_id;

  v_has_more := (v_inserted_count >= p_limit);

  PERFORM set_config('app.skip_audit', 'off', true);

  RETURN json_build_object(
    'batch_id', p_batch_id,
    'inserted_count', v_inserted_count,
    'total_in_batch', v_current_total,
    'total_amount', v_total_amount,
    'has_more', v_has_more
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_payment_batch_atomic(text, uuid, text, text, text, text, text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.populate_payment_batch_chunk(uuid, uuid, text, text, text, text, integer) TO authenticated, service_role;
