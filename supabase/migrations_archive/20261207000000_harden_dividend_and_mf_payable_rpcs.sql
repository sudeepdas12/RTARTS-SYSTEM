-- Migration: 20261207000000_harden_dividend_and_mf_payable_rpcs.sql
-- Description:
-- 1. Updates bulk_insert_dividend_payables and bulk_insert_mutual_fund_payables RPCs
--    to persist paid_amount and remaining_amount on insert and conflict updates.
-- 2. Defaults remaining_amount to net_payable for new Pending payables.
-- 3. Grants execute permissions to authenticated, service_role, and anon.
-- 4. Backfills any historical rows where remaining_amount IS NULL.

BEGIN;

-- ============================================================================
-- 1. bulk_insert_dividend_payables
-- ============================================================================
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
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := COALESCE(
      auth.jwt() ->> 'role',
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF COALESCE(v_jwt_role, '') != 'service_role' 
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payables) item
      WHERE (item->>'company_id') IS NOT NULL AND (item->>'company_id') != ''
        AND NOT public.has_company_access(auth.uid(), (item->>'company_id')::uuid)
    ) THEN
      RAISE EXCEPTION 'Unauthorized: caller does not have access to one or more companies in dividend payload' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      INSERT INTO public.dividend_payables (
        upload_id, company_id, client_id, shares_held,
        dividend_rate, bonus_rate, gross_dividend, tax_amount,
        net_payable, payment_status, payment_date, payment_reference,
        bonus_actual, bonus_issued, bonus_fraction, after_bonus_kitta,
        bonus_tax, bank_name, bank_account_no, bank_branch, lot_name,
        fiscal_year, tds_rate, remarks, payee_classification, payee_segment,
        classification_status, paid_amount, remaining_amount
      ) VALUES (
        (v_payable->>'upload_id')::uuid,
        (v_payable->>'company_id')::uuid,
        (v_payable->>'client_id')::uuid,
        COALESCE(NULLIF(v_payable->>'shares_held', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'dividend_rate', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'bonus_rate', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'gross_dividend', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'tax_amount', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'net_payable', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'payment_status', '')::public.payment_status, 'Pending'),
        COALESCE(NULLIF(v_payable->>'payment_date', '')::date, NULL),
        v_payable->>'payment_reference',
        NULLIF(v_payable->>'bonus_actual', '')::numeric,
        NULLIF(v_payable->>'bonus_issued', '')::numeric,
        NULLIF(v_payable->>'bonus_fraction', '')::numeric,
        NULLIF(v_payable->>'after_bonus_kitta', '')::numeric,
        NULLIF(v_payable->>'bonus_tax', '')::numeric,
        v_payable->>'bank_name',
        v_payable->>'bank_account_no',
        v_payable->>'bank_branch',
        v_payable->>'lot_name',
        v_payable->>'fiscal_year',
        COALESCE(NULLIF(v_payable->>'tds_rate', '')::numeric, NULL),
        v_payable->>'remarks',
        COALESCE(NULLIF(v_payable->>'payee_classification', ''), 'UNCLASSIFIED'),
        NULLIF(v_payable->>'payee_segment', ''),
        COALESCE(NULLIF(v_payable->>'classification_status', ''), 'AUTO_CLASSIFIED'),
        COALESCE(NULLIF(v_payable->>'paid_amount', '')::numeric, 0),
        COALESCE(
          NULLIF(v_payable->>'remaining_amount', '')::numeric,
          NULLIF(v_payable->>'net_payable', '')::numeric,
          0
        )
      )
      ON CONFLICT (client_id, company_id, fiscal_year, COALESCE(remarks, '')) DO UPDATE SET
        shares_held = COALESCE(EXCLUDED.shares_held, dividend_payables.shares_held),
        dividend_rate = COALESCE(EXCLUDED.dividend_rate, dividend_payables.dividend_rate),
        bonus_rate = COALESCE(EXCLUDED.bonus_rate, dividend_payables.bonus_rate),
        gross_dividend = EXCLUDED.gross_dividend,
        tax_amount = EXCLUDED.tax_amount,
        net_payable = EXCLUDED.net_payable,
        remaining_amount = CASE 
          WHEN dividend_payables.payment_status = 'Pending' THEN EXCLUDED.net_payable 
          ELSE dividend_payables.remaining_amount 
        END,
        bonus_actual = COALESCE(EXCLUDED.bonus_actual, dividend_payables.bonus_actual),
        bonus_issued = COALESCE(EXCLUDED.bonus_issued, dividend_payables.bonus_issued),
        bonus_fraction = COALESCE(EXCLUDED.bonus_fraction, dividend_payables.bonus_fraction),
        after_bonus_kitta = COALESCE(EXCLUDED.after_bonus_kitta, dividend_payables.after_bonus_kitta),
        bonus_tax = COALESCE(EXCLUDED.bonus_tax, dividend_payables.bonus_tax),
        bank_name = COALESCE(EXCLUDED.bank_name, dividend_payables.bank_name),
        bank_account_no = COALESCE(EXCLUDED.bank_account_no, dividend_payables.bank_account_no),
        bank_branch = COALESCE(EXCLUDED.bank_branch, dividend_payables.bank_branch),
        lot_name = COALESCE(EXCLUDED.lot_name, dividend_payables.lot_name),
        tds_rate = COALESCE(EXCLUDED.tds_rate, dividend_payables.tds_rate),
        payee_classification = CASE 
          WHEN dividend_payables.classification_status = 'OVERRIDDEN' THEN dividend_payables.payee_classification 
          ELSE COALESCE(NULLIF(EXCLUDED.payee_classification, 'UNCLASSIFIED'), dividend_payables.payee_classification) 
        END,
        payee_segment = CASE 
          WHEN dividend_payables.classification_status = 'OVERRIDDEN' THEN dividend_payables.payee_segment 
          ELSE COALESCE(EXCLUDED.payee_segment, dividend_payables.payee_segment) 
        END,
        updated_at = now();

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

GRANT EXECUTE ON FUNCTION public.bulk_insert_dividend_payables(jsonb) TO authenticated, service_role, anon;

-- ============================================================================
-- 2. bulk_insert_mutual_fund_payables
-- ============================================================================
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
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := COALESCE(
      auth.jwt() ->> 'role',
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF COALESCE(v_jwt_role, '') != 'service_role' 
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payables) item
      WHERE (item->>'company_id') IS NOT NULL AND (item->>'company_id') != ''
        AND NOT public.has_company_access(auth.uid(), (item->>'company_id')::uuid)
    ) THEN
      RAISE EXCEPTION 'Unauthorized: caller does not have access to one or more companies in mutual fund payload' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      INSERT INTO public.mutual_fund_payables (
        upload_id, company_id, client_id, shares_held, dividend_rate,
        dividend_type, gross_dividend, tax_amount, net_payable,
        payment_status, payment_date, payment_reference, bonus_actual,
        bonus_issued, bonus_fraction, after_bonus_kitta, bonus_tax,
        bank_name, bank_account_no, bank_branch, lot_name, fiscal_year,
        tds_rate, remarks, payee_classification, payee_segment,
        classification_status, paid_amount, remaining_amount
      ) VALUES (
        (v_payable->>'upload_id')::uuid,
        (v_payable->>'company_id')::uuid,
        (v_payable->>'client_id')::uuid,
        COALESCE(NULLIF(v_payable->>'shares_held', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'dividend_rate', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'dividend_type', '')::public.dividend_type, 'Cash'),
        COALESCE(NULLIF(v_payable->>'gross_dividend', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'tax_amount', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'net_payable', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'payment_status', '')::public.payment_status, 'Pending'),
        COALESCE(NULLIF(v_payable->>'payment_date', '')::date, NULL),
        v_payable->>'payment_reference',
        NULLIF(v_payable->>'bonus_actual', '')::numeric,
        NULLIF(v_payable->>'bonus_issued', '')::numeric,
        NULLIF(v_payable->>'bonus_fraction', '')::numeric,
        NULLIF(v_payable->>'after_bonus_kitta', '')::numeric,
        NULLIF(v_payable->>'bonus_tax', '')::numeric,
        v_payable->>'bank_name',
        v_payable->>'bank_account_no',
        v_payable->>'bank_branch',
        v_payable->>'lot_name',
        v_payable->>'fiscal_year',
        COALESCE(NULLIF(v_payable->>'tds_rate', '')::numeric, NULL),
        v_payable->>'remarks',
        COALESCE(NULLIF(v_payable->>'payee_classification', ''), 'UNCLASSIFIED'),
        NULLIF(v_payable->>'payee_segment', ''),
        COALESCE(NULLIF(v_payable->>'classification_status', ''), 'AUTO_CLASSIFIED'),
        COALESCE(NULLIF(v_payable->>'paid_amount', '')::numeric, 0),
        COALESCE(
          NULLIF(v_payable->>'remaining_amount', '')::numeric,
          NULLIF(v_payable->>'net_payable', '')::numeric,
          0
        )
      )
      ON CONFLICT (client_id, company_id, fiscal_year, COALESCE(remarks, '')) DO UPDATE SET
        shares_held = COALESCE(EXCLUDED.shares_held, mutual_fund_payables.shares_held),
        dividend_rate = COALESCE(EXCLUDED.dividend_rate, mutual_fund_payables.dividend_rate),
        dividend_type = COALESCE(EXCLUDED.dividend_type, mutual_fund_payables.dividend_type),
        gross_dividend = EXCLUDED.gross_dividend,
        tax_amount = EXCLUDED.tax_amount,
        net_payable = EXCLUDED.net_payable,
        remaining_amount = CASE 
          WHEN mutual_fund_payables.payment_status = 'Pending' THEN EXCLUDED.net_payable 
          ELSE mutual_fund_payables.remaining_amount 
        END,
        bonus_actual = COALESCE(EXCLUDED.bonus_actual, mutual_fund_payables.bonus_actual),
        bonus_issued = COALESCE(EXCLUDED.bonus_issued, mutual_fund_payables.bonus_issued),
        bonus_fraction = COALESCE(EXCLUDED.bonus_fraction, mutual_fund_payables.bonus_fraction),
        after_bonus_kitta = COALESCE(EXCLUDED.after_bonus_kitta, mutual_fund_payables.after_bonus_kitta),
        bonus_tax = COALESCE(EXCLUDED.bonus_tax, mutual_fund_payables.bonus_tax),
        bank_name = COALESCE(EXCLUDED.bank_name, mutual_fund_payables.bank_name),
        bank_account_no = COALESCE(EXCLUDED.bank_account_no, mutual_fund_payables.bank_account_no),
        bank_branch = COALESCE(EXCLUDED.bank_branch, mutual_fund_payables.bank_branch),
        lot_name = COALESCE(EXCLUDED.lot_name, mutual_fund_payables.lot_name),
        tds_rate = COALESCE(EXCLUDED.tds_rate, mutual_fund_payables.tds_rate),
        payee_classification = CASE 
          WHEN mutual_fund_payables.classification_status = 'OVERRIDDEN' THEN mutual_fund_payables.payee_classification 
          ELSE COALESCE(NULLIF(EXCLUDED.payee_classification, 'UNCLASSIFIED'), mutual_fund_payables.payee_classification) 
        END,
        payee_segment = CASE 
          WHEN mutual_fund_payables.classification_status = 'OVERRIDDEN' THEN mutual_fund_payables.payee_segment 
          ELSE COALESCE(EXCLUDED.payee_segment, mutual_fund_payables.payee_segment) 
        END,
        updated_at = now();

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

GRANT EXECUTE ON FUNCTION public.bulk_insert_mutual_fund_payables(jsonb) TO authenticated, service_role, anon;

-- ============================================================================
-- 3. Backfill any historical rows with remaining_amount IS NULL
-- ============================================================================
UPDATE public.dividend_payables
SET remaining_amount = GREATEST(0, net_payable - COALESCE(paid_amount, 0))
WHERE remaining_amount IS NULL;

UPDATE public.mutual_fund_payables
SET remaining_amount = GREATEST(0, net_payable - COALESCE(paid_amount, 0))
WHERE remaining_amount IS NULL;

COMMIT;
