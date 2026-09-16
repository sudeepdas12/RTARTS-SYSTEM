-- Migration: 20261186000000_harden_all_payable_rpcs_idempotent_upsert.sql
-- Description:
-- 1. Adds ON CONFLICT (client_id, company_id, fiscal_year, COALESCE(remarks, '')) DO UPDATE
--    to bulk_insert_dividend_payables and bulk_insert_mutual_fund_payables for complete idempotency.
-- 2. Hardens bulk_insert_interest_payables and bulk_insert_clients with payee_segment updates and robust service_role detection.
-- 3. Ensures execute permissions are granted to authenticated and service_role.

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
        fiscal_year, tds_rate, remarks, payee_classification, payee_segment, classification_status
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
        COALESCE(NULLIF(v_payable->>'classification_status', ''), 'AUTO_CLASSIFIED')
      )
      ON CONFLICT (client_id, company_id, fiscal_year, COALESCE(remarks, '')) DO UPDATE SET
        shares_held = COALESCE(EXCLUDED.shares_held, dividend_payables.shares_held),
        dividend_rate = COALESCE(EXCLUDED.dividend_rate, dividend_payables.dividend_rate),
        bonus_rate = COALESCE(EXCLUDED.bonus_rate, dividend_payables.bonus_rate),
        gross_dividend = EXCLUDED.gross_dividend,
        tax_amount = EXCLUDED.tax_amount,
        net_payable = EXCLUDED.net_payable,
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

REVOKE ALL ON FUNCTION public.bulk_insert_dividend_payables(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.bulk_insert_dividend_payables(jsonb) TO authenticated, service_role;


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
        tds_rate, remarks, payee_classification, payee_segment, classification_status
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
        COALESCE(NULLIF(v_payable->>'classification_status', ''), 'AUTO_CLASSIFIED')
      )
      ON CONFLICT (client_id, company_id, fiscal_year, COALESCE(remarks, '')) DO UPDATE SET
        shares_held = COALESCE(EXCLUDED.shares_held, mutual_fund_payables.shares_held),
        dividend_rate = COALESCE(EXCLUDED.dividend_rate, mutual_fund_payables.dividend_rate),
        dividend_type = COALESCE(EXCLUDED.dividend_type, mutual_fund_payables.dividend_type),
        gross_dividend = EXCLUDED.gross_dividend,
        tax_amount = EXCLUDED.tax_amount,
        net_payable = EXCLUDED.net_payable,
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

REVOKE ALL ON FUNCTION public.bulk_insert_mutual_fund_payables(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.bulk_insert_mutual_fund_payables(jsonb) TO authenticated, service_role;


-- ============================================================================
-- 3. bulk_insert_interest_payables
-- ============================================================================
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
      RAISE EXCEPTION 'Unauthorized: caller does not have access to one or more companies in interest payload' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      INSERT INTO public.interest_payables (
        upload_id, company_id, client_id, instrument_ref, gross_interest,
        tax_amount, net_payable, due_date, payment_status, payment_date,
        payment_reference, fiscal_year, tds_rate, bank_name, bank_account_no,
        bank_branch, lot_name, remarks, payee_classification, payee_segment,
        classification_status, shares_held, kitta
      ) VALUES (
        (v_payable->>'upload_id')::uuid,
        (v_payable->>'company_id')::uuid,
        (v_payable->>'client_id')::uuid,
        v_payable->>'instrument_ref',
        COALESCE(NULLIF(v_payable->>'gross_interest', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'tax_amount', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'net_payable', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'due_date', '')::date, CURRENT_DATE),
        COALESCE(NULLIF(v_payable->>'payment_status', '')::public.payment_status, 'Pending'),
        COALESCE(NULLIF(v_payable->>'payment_date', '')::date, NULL),
        v_payable->>'payment_reference',
        v_payable->>'fiscal_year',
        COALESCE(NULLIF(v_payable->>'tds_rate', '')::numeric, NULL),
        v_payable->>'bank_name',
        v_payable->>'bank_account_no',
        v_payable->>'bank_branch',
        v_payable->>'lot_name',
        v_payable->>'remarks',
        COALESCE(NULLIF(v_payable->>'payee_classification', ''), 'UNCLASSIFIED'),
        NULLIF(v_payable->>'payee_segment', ''),
        COALESCE(NULLIF(v_payable->>'classification_status', ''), 'AUTO_CLASSIFIED'),
        COALESCE(NULLIF(v_payable->>'shares_held', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'kitta', '')::numeric, 0)
      )
      ON CONFLICT (client_id, company_id, fiscal_year, COALESCE(remarks, '')) DO UPDATE SET
        gross_interest = EXCLUDED.gross_interest,
        tax_amount = EXCLUDED.tax_amount,
        net_payable = EXCLUDED.net_payable,
        tds_rate = COALESCE(EXCLUDED.tds_rate, interest_payables.tds_rate),
        shares_held = COALESCE(EXCLUDED.shares_held, interest_payables.shares_held),
        kitta = COALESCE(EXCLUDED.kitta, interest_payables.kitta),
        bank_name = COALESCE(EXCLUDED.bank_name, interest_payables.bank_name),
        bank_account_no = COALESCE(EXCLUDED.bank_account_no, interest_payables.bank_account_no),
        bank_branch = COALESCE(EXCLUDED.bank_branch, interest_payables.bank_branch),
        payee_classification = CASE 
          WHEN interest_payables.classification_status = 'OVERRIDDEN' THEN interest_payables.payee_classification 
          ELSE COALESCE(NULLIF(EXCLUDED.payee_classification, 'UNCLASSIFIED'), interest_payables.payee_classification) 
        END,
        payee_segment = CASE 
          WHEN interest_payables.classification_status = 'OVERRIDDEN' THEN interest_payables.payee_segment 
          ELSE COALESCE(EXCLUDED.payee_segment, interest_payables.payee_segment) 
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

REVOKE ALL ON FUNCTION public.bulk_insert_interest_payables(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.bulk_insert_interest_payables(jsonb) TO authenticated, service_role;


-- ============================================================================
-- 4. bulk_insert_clients
-- ============================================================================
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
  v_holder_type public.holder_type;
  v_residency public.residency_type;
  v_status public.record_status;
  v_verification public.verification_status;
  v_company_id uuid;
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
      SELECT 1 FROM jsonb_array_elements(p_clients) item
      WHERE (item->>'company_id') IS NOT NULL AND (item->>'company_id') != ''
        AND NOT public.has_company_access(auth.uid(), (item->>'company_id')::uuid)
    ) THEN
      RAISE EXCEPTION 'Unauthorized: caller does not have access to one or more companies in client payload' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_client IN SELECT * FROM jsonb_array_elements(p_clients)
  LOOP
    BEGIN
      v_company_id := NULLIF(v_client->>'company_id', '')::uuid;

      IF v_client->>'holder_type' IN (
        'Natural Person - Public', 'Natural Person - Promoter',
        'Legal Person', 'Mutual Fund', 'Foreign', 'Tax Exempt',
        'Public', 'Promoter', 'Institution'
      ) THEN
        v_holder_type := (v_client->>'holder_type')::public.holder_type;
      ELSIF v_client->>'holder_type' ILIKE '%promoter%' THEN
        v_holder_type := 'Natural Person - Promoter'::public.holder_type;
      ELSIF v_client->>'holder_type' ILIKE '%institution%' OR v_client->>'holder_type' ILIKE '%legal%' THEN
        v_holder_type := 'Legal Person'::public.holder_type;
      ELSIF v_client->>'holder_type' ILIKE '%fund%' THEN
        v_holder_type := 'Mutual Fund'::public.holder_type;
      ELSIF v_client->>'holder_type' ILIKE '%foreign%' THEN
        v_holder_type := 'Foreign'::public.holder_type;
      ELSIF v_client->>'holder_type' ILIKE '%exempt%' THEN
        v_holder_type := 'Tax Exempt'::public.holder_type;
      ELSE
        v_holder_type := 'Natural Person - Public'::public.holder_type;
      END IF;

      IF v_client->>'residency' IN ('Resident', 'Non-Resident') THEN
        v_residency := (v_client->>'residency')::public.residency_type;
      ELSIF v_client->>'residency' ILIKE '%non%' OR v_client->>'residency' ILIKE '%foreign%' THEN
        v_residency := 'Non-Resident'::public.residency_type;
      ELSE
        v_residency := 'Resident'::public.residency_type;
      END IF;

      IF v_client->>'status' IN ('Active', 'Inactive', 'Merged', 'Suspended') THEN
        v_status := (v_client->>'status')::public.record_status;
      ELSE
        v_status := 'Active'::public.record_status;
      END IF;

      IF v_client->>'verification_status' IN ('Verified', 'Pending', 'Rejected') THEN
        v_verification := (v_client->>'verification_status')::public.verification_status;
      ELSE
        v_verification := 'Pending'::public.verification_status;
      END IF;

      INSERT INTO public.clients (
        company_id, client_code, client_id, full_name, father_name,
        grandfather_name, pan_or_citizenship, pan_no, citizenship_no,
        nid_number, date_of_birth, gender, occupation, address,
        province, district, municipality, phone, email, bank_name,
        bank_branch, bank_account_no, bank_code, account_type,
        boid, residency, holder_type, status, verification_status,
        payee_classification, payee_segment, classification_status,
        classification_source, kitta
      ) VALUES (
        v_company_id,
        v_client->>'client_code',
        v_client->>'client_id',
        COALESCE(NULLIF(v_client->>'full_name', ''), 'Unknown Client'),
        v_client->>'father_name',
        v_client->>'grandfather_name',
        v_client->>'pan_or_citizenship',
        v_client->>'pan_no',
        v_client->>'citizenship_no',
        v_client->>'nid_number',
        v_client->>'date_of_birth',
        v_client->>'gender',
        v_client->>'occupation',
        v_client->>'address',
        v_client->>'province',
        v_client->>'district',
        v_client->>'municipality',
        v_client->>'phone',
        v_client->>'email',
        v_client->>'bank_name',
        v_client->>'bank_branch',
        v_client->>'bank_account_no',
        v_client->>'bank_code',
        v_client->>'account_type',
        v_client->>'boid',
        v_residency,
        v_holder_type,
        v_status,
        v_verification,
        COALESCE(NULLIF(v_client->>'payee_classification', ''), 'UNCLASSIFIED'),
        NULLIF(v_client->>'payee_segment', ''),
        COALESCE(NULLIF(v_client->>'classification_status', ''), 'PENDING'),
        COALESCE(NULLIF(v_client->>'classification_source', ''), 'SYSTEM'),
        COALESCE((v_client->>'kitta')::numeric, 0)
      )
      ON CONFLICT (company_id, boid) DO UPDATE SET
        full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), clients.full_name),
        father_name = COALESCE(NULLIF(EXCLUDED.father_name, ''), clients.father_name),
        grandfather_name = COALESCE(NULLIF(EXCLUDED.grandfather_name, ''), clients.grandfather_name),
        pan_or_citizenship = COALESCE(NULLIF(EXCLUDED.pan_or_citizenship, ''), clients.pan_or_citizenship),
        pan_no = COALESCE(NULLIF(EXCLUDED.pan_no, ''), clients.pan_no),
        citizenship_no = COALESCE(NULLIF(EXCLUDED.citizenship_no, ''), clients.citizenship_no),
        nid_number = COALESCE(NULLIF(EXCLUDED.nid_number, ''), clients.nid_number),
        date_of_birth = COALESCE(NULLIF(EXCLUDED.date_of_birth, ''), clients.date_of_birth),
        gender = COALESCE(NULLIF(EXCLUDED.gender, ''), clients.gender),
        occupation = COALESCE(NULLIF(EXCLUDED.occupation, ''), clients.occupation),
        address = COALESCE(NULLIF(EXCLUDED.address, ''), clients.address),
        province = COALESCE(NULLIF(EXCLUDED.province, ''), clients.province),
        district = COALESCE(NULLIF(EXCLUDED.district, ''), clients.district),
        municipality = COALESCE(NULLIF(EXCLUDED.municipality, ''), clients.municipality),
        phone = COALESCE(NULLIF(EXCLUDED.phone, ''), clients.phone),
        email = COALESCE(NULLIF(EXCLUDED.email, ''), clients.email),
        bank_name = COALESCE(NULLIF(EXCLUDED.bank_name, ''), clients.bank_name),
        bank_branch = COALESCE(NULLIF(EXCLUDED.bank_branch, ''), clients.bank_branch),
        bank_account_no = COALESCE(NULLIF(EXCLUDED.bank_account_no, ''), clients.bank_account_no),
        bank_code = COALESCE(NULLIF(EXCLUDED.bank_code, ''), clients.bank_code),
        account_type = COALESCE(NULLIF(EXCLUDED.account_type, ''), clients.account_type),
        holder_type = COALESCE(EXCLUDED.holder_type, clients.holder_type),
        payee_classification = CASE 
          WHEN clients.classification_status = 'OVERRIDDEN' THEN clients.payee_classification 
          ELSE COALESCE(NULLIF(EXCLUDED.payee_classification, 'UNCLASSIFIED'), clients.payee_classification) 
        END,
        payee_segment = CASE 
          WHEN clients.classification_status = 'OVERRIDDEN' THEN clients.payee_segment 
          ELSE COALESCE(EXCLUDED.payee_segment, clients.payee_segment) 
        END,
        kitta = GREATEST(COALESCE(EXCLUDED.kitta, 0), COALESCE(clients.kitta, 0)),
        updated_at = now();

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

REVOKE ALL ON FUNCTION public.bulk_insert_clients(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.bulk_insert_clients(jsonb) TO authenticated, service_role;

COMMIT;
