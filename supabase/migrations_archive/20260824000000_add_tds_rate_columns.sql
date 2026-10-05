-- =========================================================
-- Add tds_rate columns to payable tables so the TDS % used
-- during import is persisted per-row (not just the resulting tax)
-- =========================================================

ALTER TABLE public.dividend_payables
  ADD COLUMN IF NOT EXISTS tds_rate NUMERIC(10,4);

ALTER TABLE public.mutual_fund_payables
  ADD COLUMN IF NOT EXISTS tds_rate NUMERIC(10,4);

ALTER TABLE public.interest_payables
  ADD COLUMN IF NOT EXISTS tds_rate NUMERIC(10,4);

-- =========================================================
-- Update bulk RPCs to accept and store tds_rate
-- =========================================================

CREATE OR REPLACE FUNCTION public.bulk_insert_dividend_payables(
  p_payables jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payable jsonb;
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      INSERT INTO public.dividend_payables (
        upload_id, company_id, client_id, shares_held,
        dividend_rate, dividend_type, gross_dividend, tax_amount,
        net_payable, fiscal_year, payment_status,
        bonus_actual, bonus_issued, bonus_fraction,
        after_bonus_kitta, bonus_tax, bank_name, bank_account_no, lot_name,
        tds_rate
      ) VALUES (
        (v_payable->>'upload_id')::uuid,
        (v_payable->>'company_id')::uuid,
        (v_payable->>'client_id')::uuid,
        COALESCE((v_payable->>'shares_held')::numeric, 0),
        COALESCE((v_payable->>'dividend_rate')::numeric, 0),
        COALESCE((v_payable->>'dividend_type')::public.dividend_type, 'Cash'),
        COALESCE((v_payable->>'gross_dividend')::numeric, 0),
        COALESCE((v_payable->>'tax_amount')::numeric, 0),
        COALESCE((v_payable->>'net_payable')::numeric, 0),
        v_payable->>'fiscal_year',
        COALESCE((v_payable->>'payment_status')::public.payment_status, 'Pending'),
        (v_payable->>'bonus_actual')::numeric,
        (v_payable->>'bonus_issued')::numeric,
        (v_payable->>'bonus_fraction')::numeric,
        (v_payable->>'after_bonus_kitta')::numeric,
        (v_payable->>'bonus_tax')::numeric,
        v_payable->>'bank_name',
        v_payable->>'bank_account_no',
        v_payable->>'lot_name',
        COALESCE((v_payable->>'tds_rate')::numeric, NULL)
      );
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'client_id', v_payable->>'client_id',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'inserted', v_inserted, 'errors', v_errors);
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_insert_mutual_fund_payables(
  p_payables jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payable jsonb;
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      INSERT INTO public.mutual_fund_payables (
        upload_id, company_id, client_id, shares_held,
        dividend_rate, dividend_type, gross_dividend, tax_amount,
        net_payable, payment_status, payment_date, payment_reference,
        bonus_actual, bonus_issued, bonus_fraction, after_bonus_kitta,
        bonus_tax, bank_name, bank_account_no, lot_name,
        fiscal_year, tds_rate
      ) VALUES (
        (v_payable->>'upload_id')::uuid,
        (v_payable->>'company_id')::uuid,
        (v_payable->>'client_id')::uuid,
        COALESCE((v_payable->>'shares_held')::numeric, 0),
        COALESCE((v_payable->>'dividend_rate')::numeric, 0),
        COALESCE((v_payable->>'dividend_type')::public.dividend_type, 'Cash'),
        COALESCE((v_payable->>'gross_dividend')::numeric, 0),
        COALESCE((v_payable->>'tax_amount')::numeric, 0),
        COALESCE((v_payable->>'net_payable')::numeric, 0),
        COALESCE((v_payable->>'payment_status')::public.payment_status, 'Pending'),
        COALESCE((v_payable->>'payment_date')::date, NULL),
        v_payable->>'payment_reference',
        (v_payable->>'bonus_actual')::numeric,
        (v_payable->>'bonus_issued')::numeric,
        (v_payable->>'bonus_fraction')::numeric,
        (v_payable->>'after_bonus_kitta')::numeric,
        (v_payable->>'bonus_tax')::numeric,
        v_payable->>'bank_name',
        v_payable->>'bank_account_no',
        v_payable->>'lot_name',
        v_payable->>'fiscal_year',
        COALESCE((v_payable->>'tds_rate')::numeric, NULL)
      );
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'client_id', v_payable->>'client_id',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'inserted', v_inserted, 'errors', v_errors);
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_insert_interest_payables(
  p_payables jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payable jsonb;
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      INSERT INTO public.interest_payables (
        upload_id, company_id, client_id, gross_interest,
        tax_amount, net_payable, due_date, fiscal_year, payment_status,
        tds_rate
      ) VALUES (
        (v_payable->>'upload_id')::uuid,
        (v_payable->>'company_id')::uuid,
        (v_payable->>'client_id')::uuid,
        COALESCE((v_payable->>'gross_interest')::numeric, 0),
        COALESCE((v_payable->>'tax_amount')::numeric, 0),
        COALESCE((v_payable->>'net_payable')::numeric, 0),
        COALESCE((v_payable->>'due_date')::date, CURRENT_DATE),
        v_payable->>'fiscal_year',
        COALESCE((v_payable->>'payment_status')::public.payment_status, 'Pending'),
        COALESCE((v_payable->>'tds_rate')::numeric, NULL)
      );
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'client_id', v_payable->>'client_id',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'inserted', v_inserted, 'errors', v_errors);
END;
$$;

-- Grant execute permissions (re-assert)
GRANT EXECUTE ON FUNCTION public.bulk_insert_clients(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_insert_clients(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.bulk_insert_dividend_payables(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_insert_dividend_payables(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.bulk_insert_mutual_fund_payables(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_insert_mutual_fund_payables(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.bulk_insert_interest_payables(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_insert_interest_payables(jsonb) TO service_role;