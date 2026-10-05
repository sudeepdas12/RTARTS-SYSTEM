-- Migration: 20261231000000_clean_orphaned_payments_and_add_cascade.sql
-- Description:
-- 1. Deletes orphaned payments that do not belong to any valid batch in payment_batches.
-- 2. Ensures payments.batch_id cascades when a payment_batch is deleted.
-- 3. Joins payment_batches in all available payables check so orphaned rows can never lock payables.

-- 1. Remove all orphaned payment rows
DELETE FROM public.payments 
WHERE batch_id IS NOT NULL 
  AND batch_id NOT IN (SELECT id FROM public.payment_batches);

-- 2. Ensure foreign key constraint on payments.batch_id has ON DELETE CASCADE
DO $$
BEGIN
  -- Drop existing constraint if it exists without cascade
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'payments_batch_id_fkey' AND table_name = 'payments'
  ) THEN
    ALTER TABLE public.payments DROP CONSTRAINT payments_batch_id_fkey;
  END IF;

  ALTER TABLE public.payments
    ADD CONSTRAINT payments_batch_id_fkey
    FOREIGN KEY (batch_id)
    REFERENCES public.payment_batches(id)
    ON DELETE CASCADE;
END $$;

-- 3. Update get_available_payables_preview to ensure only payments tied to active batches block payables
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
        JOIN public.payment_batches pb ON pb.id = p.batch_id
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
        JOIN public.payment_batches pb ON pb.id = p.batch_id
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
        JOIN public.payment_batches pb ON pb.id = p.batch_id
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

-- 4. Update populate_payment_batch_chunk to join payment_batches in NOT EXISTS check
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
  EXCEPTION WHEN OTHERS THEN
    v_valid_payment_method := 'ConnectIPS'::public.payment_method;
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
      COALESCE(mf.gross_dividend, 0), COALESCE(mf.tax_amount, 0), COALESCE(mf.net_payable, 0), COALESCE(mf.net_payable, 0),
      v_valid_payment_method, 'Pending',
      COALESCE(mf.bank_name, c.bank_name), COALESCE(mf.bank_account_no, c.bank_account_no),
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
        COALESCE(dp.gross_dividend, 0), COALESCE(dp.tax_amount, 0), COALESCE(dp.net_payable, 0), COALESCE(dp.net_payable, 0),
        v_valid_payment_method, 'Pending',
        COALESCE(dp.bank_name, c.bank_name), COALESCE(dp.bank_account_no, c.bank_account_no),
        '[' || v_batch_name || ']',
        auth.uid(), NOW(), NOW()
      FROM public.dividend_payables dp
      LEFT JOIN public.clients c ON c.id = dp.client_id
      WHERE
        (p_company_id IS NULL OR dp.company_id = p_company_id)
        AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR dp.fiscal_year = p_fiscal_year)
        AND dp.payment_status IN ('Pending', 'Partial')
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
        COALESCE(ip.gross_interest, 0), COALESCE(ip.tax_amount, 0), COALESCE(ip.net_payable, 0), COALESCE(ip.net_payable, 0),
        v_valid_payment_method, 'Pending',
        COALESCE(ip.bank_name, c.bank_name), COALESCE(ip.bank_account_no, c.bank_account_no),
        '[' || v_batch_name || ']',
        auth.uid(), NOW(), NOW()
      FROM public.interest_payables ip
      LEFT JOIN public.clients c ON c.id = ip.client_id
      WHERE
        (p_company_id IS NULL OR ip.company_id = p_company_id)
        AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR ip.fiscal_year = p_fiscal_year)
        AND ip.payment_status IN ('Pending', 'Partial')
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
