-- ============================================================================
-- Migration: 20261139000000_harden_bulk_import_rpcs_and_auth.sql
-- Description:
-- 1. Adds auth.uid() authentication checks to all SECURITY DEFINER bulk RPCs
-- 2. Includes kitta in bulk_insert_clients RPC
-- 3. Fixes EXCLUDED default overwriting existing client holder_type, residency, etc.
-- ============================================================================

-- 1. Hardened bulk_insert_clients
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
  -- Authenticate caller
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  FOR v_client IN SELECT * FROM jsonb_array_elements(p_clients)
  LOOP
    BEGIN
      INSERT INTO public.clients (
        id, boid, company_id, full_name, client_code, client_id,
        father_name, grandfather_name, pan_or_citizenship, pan_no, citizenship_no, nid_number,
        date_of_birth, gender, occupation,
        address, province, district, municipality,
        phone, email, bank_name, bank_branch, bank_account_no, bank_code, account_type,
        residency, holder_type, status, verification_status,
        payee_classification, payee_segment,
        classification_status, classification_source, kitta
      ) VALUES (
        (v_client->>'id')::uuid,
        v_client->>'boid',
        (v_client->>'company_id')::uuid,
        v_client->>'full_name',
        v_client->>'client_code',
        NULLIF(v_client->>'client_id', ''),
        NULLIF(v_client->>'father_name', ''),
        NULLIF(v_client->>'grandfather_name', ''),
        NULLIF(COALESCE(v_client->>'pan_no', v_client->>'pan_or_citizenship', v_client->>'citizenship_no'), ''),
        NULLIF(COALESCE(v_client->>'pan_no', v_client->>'pan'), ''),
        NULLIF(COALESCE(v_client->>'citizenship_no', v_client->>'citizenship'), ''),
        NULLIF(v_client->>'nid_number', ''),
        NULLIF(v_client->>'date_of_birth', ''),
        NULLIF(v_client->>'gender', ''),
        NULLIF(v_client->>'occupation', ''),
        NULLIF(v_client->>'address', ''),
        NULLIF(v_client->>'province', ''),
        NULLIF(v_client->>'district', ''),
        NULLIF(v_client->>'municipality', ''),
        NULLIF(v_client->>'phone', ''),
        NULLIF(v_client->>'email', ''),
        NULLIF(v_client->>'bank_name', ''),
        NULLIF(v_client->>'bank_branch', ''),
        NULLIF(v_client->>'bank_account_no', ''),
        NULLIF(v_client->>'bank_code', ''),
        NULLIF(v_client->>'account_type', ''),
        COALESCE(NULLIF(v_client->>'residency', '')::public.residency_type, 'Resident'),
        COALESCE(NULLIF(v_client->>'holder_type', '')::public.holder_type, 'Natural Person - Public'),
        COALESCE(NULLIF(v_client->>'status', '')::public.record_status, 'Active'),
        COALESCE(NULLIF(v_client->>'verification_status', '')::public.verification_status, 'Verified'),
        COALESCE(NULLIF(v_client->>'payee_classification', ''), 'UNCLASSIFIED'),
        NULLIF(v_client->>'payee_segment', ''),
        COALESCE(NULLIF(v_client->>'classification_status', ''), 'AUTO_CLASSIFIED'),
        NULLIF(v_client->>'classification_source', ''),
        COALESCE((v_client->>'kitta')::numeric, 0)
      )
      ON CONFLICT (boid) DO UPDATE SET
        full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), clients.full_name),
        company_id = COALESCE(EXCLUDED.company_id, clients.company_id),
        client_code = COALESCE(NULLIF(EXCLUDED.client_code, ''), clients.client_code),
        client_id = COALESCE(NULLIF(EXCLUDED.client_id, ''), clients.client_id),
        father_name = COALESCE(NULLIF(EXCLUDED.father_name, ''), clients.father_name),
        grandfather_name = COALESCE(NULLIF(EXCLUDED.grandfather_name, ''), clients.grandfather_name),
        pan_no = COALESCE(NULLIF(EXCLUDED.pan_no, ''), clients.pan_no),
        citizenship_no = COALESCE(NULLIF(EXCLUDED.citizenship_no, ''), clients.citizenship_no),
        pan_or_citizenship = COALESCE(NULLIF(EXCLUDED.pan_or_citizenship, ''), clients.pan_or_citizenship),
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
        residency = COALESCE(NULLIF(v_client->>'residency', '')::public.residency_type, clients.residency),
        holder_type = COALESCE(NULLIF(v_client->>'holder_type', '')::public.holder_type, clients.holder_type),
        verification_status = COALESCE(NULLIF(v_client->>'verification_status', '')::public.verification_status, clients.verification_status),
        payee_classification = COALESCE(NULLIF(v_client->>'payee_classification', 'UNCLASSIFIED'), clients.payee_classification),
        payee_segment = COALESCE(NULLIF(v_client->>'payee_segment', ''), clients.payee_segment),
        classification_status = COALESCE(NULLIF(v_client->>'classification_status', ''), clients.classification_status),
        classification_source = COALESCE(NULLIF(v_client->>'classification_source', ''), clients.classification_source),
        kitta = COALESCE((v_client->>'kitta')::numeric, clients.kitta),
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

-- 2. Hardened bulk_insert_dividend_payables
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
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

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
        COALESCE(NULLIF(v_payable->>'shares_held', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'dividend_rate', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'dividend_type', '')::public.dividend_type, 'Cash'),
        COALESCE(NULLIF(v_payable->>'gross_dividend', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'tax_amount', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'net_payable', '')::numeric, 0),
        v_payable->>'fiscal_year',
        COALESCE(NULLIF(v_payable->>'payment_status', '')::public.payment_status, 'Pending'),
        NULLIF(v_payable->>'bonus_actual', '')::numeric,
        NULLIF(v_payable->>'bonus_issued', '')::numeric,
        NULLIF(v_payable->>'bonus_fraction', '')::numeric,
        NULLIF(v_payable->>'after_bonus_kitta', '')::numeric,
        NULLIF(v_payable->>'bonus_tax', '')::numeric,
        v_payable->>'bank_name',
        v_payable->>'bank_account_no',
        v_payable->>'bank_branch',
        v_payable->>'lot_name',
        COALESCE(NULLIF(v_payable->>'tds_rate', '')::numeric, NULL),
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

-- 3. Hardened bulk_insert_interest_payables
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
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

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
        COALESCE(NULLIF(v_payable->>'shares_held', '')::numeric, NULLIF(v_payable->>'kitta', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'kitta', '')::numeric, NULLIF(v_payable->>'shares_held', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'gross_interest', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'tax_amount', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'net_payable', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'due_date', '')::date, CURRENT_DATE),
        v_payable->>'fiscal_year',
        COALESCE(NULLIF(v_payable->>'payment_status', '')::public.payment_status, 'Pending'),
        COALESCE(NULLIF(v_payable->>'tds_rate', '')::numeric, NULL),
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

-- 4. Hardened bulk_insert_mutual_fund_payables
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
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

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

GRANT EXECUTE ON FUNCTION public.bulk_insert_clients(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bulk_insert_dividend_payables(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bulk_insert_interest_payables(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bulk_insert_mutual_fund_payables(jsonb) TO authenticated, service_role;
