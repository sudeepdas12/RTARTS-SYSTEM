-- =========================================================
-- Update bulk import RPCs to persist all extracted fields
-- (bank_branch, remarks, instrument_ref, kitta/shares_held, classification)
-- AND backfill existing historical records
-- =========================================================

-- 1. Ensure columns exist on tables with IF NOT EXISTS
ALTER TABLE public.dividend_payables
  ADD COLUMN IF NOT EXISTS bank_branch TEXT,
  ADD COLUMN IF NOT EXISTS lot_name TEXT,
  ADD COLUMN IF NOT EXISTS remarks TEXT,
  ADD COLUMN IF NOT EXISTS payee_classification TEXT DEFAULT 'UNCLASSIFIED',
  ADD COLUMN IF NOT EXISTS payee_segment TEXT,
  ADD COLUMN IF NOT EXISTS classification_status TEXT DEFAULT 'AUTO_CLASSIFIED';

ALTER TABLE public.interest_payables
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_no TEXT,
  ADD COLUMN IF NOT EXISTS bank_branch TEXT,
  ADD COLUMN IF NOT EXISTS lot_name TEXT,
  ADD COLUMN IF NOT EXISTS shares_held NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kitta NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS instrument_ref TEXT,
  ADD COLUMN IF NOT EXISTS remarks TEXT,
  ADD COLUMN IF NOT EXISTS payee_classification TEXT DEFAULT 'UNCLASSIFIED',
  ADD COLUMN IF NOT EXISTS payee_segment TEXT,
  ADD COLUMN IF NOT EXISTS classification_status TEXT DEFAULT 'AUTO_CLASSIFIED';

ALTER TABLE public.mutual_fund_payables
  ADD COLUMN IF NOT EXISTS bank_branch TEXT,
  ADD COLUMN IF NOT EXISTS remarks TEXT,
  ADD COLUMN IF NOT EXISTS payee_classification TEXT DEFAULT 'UNCLASSIFIED',
  ADD COLUMN IF NOT EXISTS payee_segment TEXT,
  ADD COLUMN IF NOT EXISTS classification_status TEXT DEFAULT 'AUTO_CLASSIFIED';

-- 2. Update bulk_insert_dividend_payables RPC
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
        after_bonus_kitta, bonus_tax, bank_name, bank_account_no, bank_branch,
        lot_name, tds_rate, remarks, payee_classification, payee_segment, classification_status
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
        v_payable->>'bank_branch',
        v_payable->>'lot_name',
        COALESCE((v_payable->>'tds_rate')::numeric, NULL),
        v_payable->>'remarks',
        COALESCE(v_payable->>'payee_classification', 'UNCLASSIFIED'),
        v_payable->>'payee_segment',
        COALESCE(v_payable->>'classification_status', 'AUTO_CLASSIFIED')
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

-- 3. Update bulk_insert_interest_payables RPC
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
        upload_id, company_id, client_id, shares_held, kitta,
        gross_interest, tax_amount, net_payable, due_date, fiscal_year,
        payment_status, tds_rate, bank_name, bank_account_no, bank_branch,
        lot_name, instrument_ref, remarks, payee_classification, payee_segment, classification_status
      ) VALUES (
        (v_payable->>'upload_id')::uuid,
        (v_payable->>'company_id')::uuid,
        (v_payable->>'client_id')::uuid,
        COALESCE((v_payable->>'shares_held')::numeric, (v_payable->>'kitta')::numeric, 0),
        COALESCE((v_payable->>'kitta')::numeric, (v_payable->>'shares_held')::numeric, 0),
        COALESCE((v_payable->>'gross_interest')::numeric, 0),
        COALESCE((v_payable->>'tax_amount')::numeric, 0),
        COALESCE((v_payable->>'net_payable')::numeric, 0),
        COALESCE((v_payable->>'due_date')::date, CURRENT_DATE),
        v_payable->>'fiscal_year',
        COALESCE((v_payable->>'payment_status')::public.payment_status, 'Pending'),
        COALESCE((v_payable->>'tds_rate')::numeric, NULL),
        v_payable->>'bank_name',
        v_payable->>'bank_account_no',
        v_payable->>'bank_branch',
        v_payable->>'lot_name',
        v_payable->>'instrument_ref',
        v_payable->>'remarks',
        COALESCE(v_payable->>'payee_classification', 'UNCLASSIFIED'),
        v_payable->>'payee_segment',
        COALESCE(v_payable->>'classification_status', 'AUTO_CLASSIFIED')
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

-- 4. Update bulk_insert_mutual_fund_payables RPC
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
        bonus_tax, bank_name, bank_account_no, bank_branch, lot_name,
        fiscal_year, tds_rate, remarks, payee_classification, payee_segment, classification_status
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
        v_payable->>'bank_branch',
        v_payable->>'lot_name',
        v_payable->>'fiscal_year',
        COALESCE((v_payable->>'tds_rate')::numeric, NULL),
        v_payable->>'remarks',
        COALESCE(v_payable->>'payee_classification', 'UNCLASSIFIED'),
        v_payable->>'payee_segment',
        COALESCE(v_payable->>'classification_status', 'AUTO_CLASSIFIED')
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

GRANT EXECUTE ON FUNCTION public.bulk_insert_dividend_payables(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_insert_dividend_payables(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.bulk_insert_interest_payables(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_insert_interest_payables(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.bulk_insert_mutual_fund_payables(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_insert_mutual_fund_payables(jsonb) TO service_role;

-- =========================================================
-- 5. Backfill Existing Historical Data in Database
-- =========================================================

-- A. Backfill companies sector_type, company_type, face_value
UPDATE public.companies
SET company_type = 'Debenture', sector_type = 'Institution'::public.sector_type, face_value = COALESCE(face_value, 1000)
WHERE (company_type IS NULL OR sector_type IS NULL OR face_value IS NULL)
  AND (company_name ILIKE '%debenture%' OR company_name ILIKE '%bond%' OR company_name ILIKE '% deb%' OR company_code ILIKE '%deb%' OR company_code ILIKE '%d8%' OR COALESCE(debenture_rate, 0) > 0 OR COALESCE(coupon_rate, 0) > 0);

UPDATE public.companies
SET company_type = 'Mutual Fund', sector_type = 'Institution'::public.sector_type, face_value = COALESCE(face_value, 10)
WHERE (company_type IS NULL OR sector_type IS NULL OR face_value IS NULL)
  AND (company_name ILIKE '%fund%' OR company_name ILIKE '%scheme%' OR company_name ILIKE '%yojana%' OR company_name ILIKE '%samriddhi%' OR company_name ILIKE '%samunnat%' OR company_code ILIKE '%mf%');

UPDATE public.companies
SET sector_type = 'Public'::public.sector_type, company_type = COALESCE(company_type, 'Equity'), face_value = COALESCE(face_value, 100)
WHERE sector_type IS NULL OR company_type IS NULL;

UPDATE public.companies
SET sector_type = COALESCE(sector_type, 'Other'::public.sector_type), company_type = COALESCE(company_type, 'Equity'), face_value = COALESCE(face_value, 100), status = COALESCE(status, 'Active')
WHERE sector_type IS NULL OR company_type IS NULL OR face_value IS NULL;

-- B. Backfill clients residency
UPDATE public.clients
SET residency = 'Resident'
WHERE residency IS NULL;

-- C. Backfill bank details in dividend_payables from clients
UPDATE public.dividend_payables dp
SET 
  bank_name = COALESCE(dp.bank_name, c.bank_name),
  bank_account_no = COALESCE(dp.bank_account_no, c.bank_account_no),
  bank_branch = COALESCE(dp.bank_branch, c.bank_branch)
FROM public.clients c
WHERE dp.client_id = c.id
  AND (dp.bank_name IS NULL OR dp.bank_account_no IS NULL OR dp.bank_branch IS NULL);

-- D. Backfill bank details and shares_held in interest_payables from clients
UPDATE public.interest_payables ip
SET 
  bank_name = COALESCE(ip.bank_name, c.bank_name),
  bank_account_no = COALESCE(ip.bank_account_no, c.bank_account_no),
  bank_branch = COALESCE(ip.bank_branch, c.bank_branch),
  shares_held = COALESCE(NULLIF(ip.shares_held, 0), ip.kitta, c.kitta, 0),
  kitta = COALESCE(NULLIF(ip.kitta, 0), ip.shares_held, c.kitta, 0)
FROM public.clients c
WHERE ip.client_id = c.id
  AND (ip.bank_name IS NULL OR ip.bank_account_no IS NULL OR ip.bank_branch IS NULL OR ip.shares_held IS NULL OR ip.shares_held = 0);
