-- =========================================================
-- Bulk import RPC with SECURITY DEFINER to bypass RLS
-- Allows authenticated users to import data without
-- requiring admin/finance_operator role for each insert.
-- =========================================================

-- Insert clients in bulk (bypasses RLS)
CREATE OR REPLACE FUNCTION public.bulk_insert_clients(
  p_clients jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client jsonb;
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  FOR v_client IN SELECT * FROM jsonb_array_elements(p_clients)
  LOOP
    BEGIN
      INSERT INTO public.clients (
        id, boid, company_id, full_name, client_code,
        father_name, grandfather_name, pan_or_citizenship,
        address, district, phone, bank_name, bank_account_no,
        holder_type, status, verification_status
      ) VALUES (
        (v_client->>'id')::uuid,
        v_client->>'boid',
        (v_client->>'company_id')::uuid,
        v_client->>'full_name',
        v_client->>'client_code',
        v_client->>'father_name',
        v_client->>'grandfather_name',
        v_client->>'pan_or_citizenship',
        v_client->>'address',
        v_client->>'district',
        v_client->>'phone',
        v_client->>'bank_name',
        v_client->>'bank_account_no',
        COALESCE((v_client->>'holder_type')::public.holder_type, 'Public'),
        COALESCE((v_client->>'status')::public.record_status, 'Active'),
        COALESCE((v_client->>'verification_status')::public.verification_status, 'Verified')
      )
      ON CONFLICT (boid) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        company_id = EXCLUDED.company_id,
        father_name = EXCLUDED.father_name,
        grandfather_name = EXCLUDED.grandfather_name,
        pan_or_citizenship = EXCLUDED.pan_or_citizenship,
        address = EXCLUDED.address,
        district = EXCLUDED.district,
        phone = EXCLUDED.phone,
        bank_name = EXCLUDED.bank_name,
        bank_account_no = EXCLUDED.bank_account_no,
        holder_type = EXCLUDED.holder_type,
        verification_status = EXCLUDED.verification_status;
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'boid', v_client->>'boid',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'inserted', v_inserted, 'errors', v_errors);
END;
$$;

-- Insert dividend payables in bulk (bypasses RLS)
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
        after_bonus_kitta, bonus_tax, bank_name, bank_account_no, lot_name
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
        v_payable->>'lot_name'
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

-- Insert mutual fund payables in bulk (bypasses RLS)
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
        fiscal_year
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
        v_payable->>'fiscal_year'
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

-- Insert interest payables in bulk (bypasses RLS)
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
        tax_amount, net_payable, due_date, fiscal_year, payment_status
      ) VALUES (
        (v_payable->>'upload_id')::uuid,
        (v_payable->>'company_id')::uuid,
        (v_payable->>'client_id')::uuid,
        COALESCE((v_payable->>'gross_interest')::numeric, 0),
        COALESCE((v_payable->>'tax_amount')::numeric, 0),
        COALESCE((v_payable->>'net_payable')::numeric, 0),
        COALESCE((v_payable->>'due_date')::date, CURRENT_DATE),
        v_payable->>'fiscal_year',
        COALESCE((v_payable->>'payment_status')::public.payment_status, 'Pending')
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

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.bulk_insert_clients(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_insert_clients(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.bulk_insert_dividend_payables(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_insert_dividend_payables(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.bulk_insert_mutual_fund_payables(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_insert_mutual_fund_payables(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.bulk_insert_interest_payables(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_insert_interest_payables(jsonb) TO service_role;