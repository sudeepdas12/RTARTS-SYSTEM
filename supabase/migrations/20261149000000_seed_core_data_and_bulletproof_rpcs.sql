-- ============================================================================
-- Migration: 20261149000000_seed_core_data_and_bulletproof_rpcs.sql
-- Description:
--   1. Seeds standard Nepal fiscal years (2079/80 to 2083/84 with 2081/82 active)
--   2. Seeds core client companies and debentures (Supermai, Barun, RMF1, RBB Debentures, Prime)
--   3. Bulletproofs all bulk import RPCs against invalid enum strings
-- ============================================================================

-- 1. Seed Fiscal Years
INSERT INTO public.fiscal_years (id, fiscal_year, start_date, end_date, is_active)
VALUES
  (gen_random_uuid(), '2079/80', '2022-07-17', '2023-07-16', false),
  (gen_random_uuid(), '2080/81', '2023-07-17', '2024-07-15', false),
  (gen_random_uuid(), '2081/82', '2024-07-16', '2025-07-15', true),
  (gen_random_uuid(), '2082/83', '2025-07-16', '2026-07-15', false),
  (gen_random_uuid(), '2083/84', '2026-07-16', '2027-07-15', false)
ON CONFLICT DO NOTHING;

-- If no fiscal year is active, activate 2081/82
UPDATE public.fiscal_years
SET is_active = true
WHERE fiscal_year = '2081/82'
  AND NOT EXISTS (SELECT 1 FROM public.fiscal_years WHERE is_active = true);

-- 2. Seed Standard Companies
INSERT INTO public.companies (
  id, company_code, company_name, company_type, sector_type, face_value, dividend_rate, debenture_rate, coupon_rate, status
)
VALUES
  (gen_random_uuid(), 'SUPERMAI', 'Supermai Hydropower Limited', 'Equity', 'Public'::public.sector_type, 100, NULL, NULL, NULL, 'Active'::public.record_status),
  (gen_random_uuid(), 'BARUN', 'Barun Hydropower Co. Ltd.', 'Equity', 'Public'::public.sector_type, 100, NULL, NULL, NULL, 'Active'::public.record_status),
  (gen_random_uuid(), 'RMF1', 'RBB Mutual Fund 1', 'Mutual Fund', 'Institution'::public.sector_type, 10, NULL, NULL, NULL, 'Active'::public.record_status),
  (gen_random_uuid(), 'RBBD88', '7% RBB Debenture 2088', 'Debenture', 'Institution'::public.sector_type, 1000, NULL, 7.0, 7.0, 'Active'::public.record_status),
  (gen_random_uuid(), 'RBBD83', '8.5% RBB Debenture 2083', 'Debenture', 'Institution'::public.sector_type, 1000, NULL, 8.5, 8.5, 'Active'::public.record_status),
  (gen_random_uuid(), 'PRMD85', '8.75% Prime Debenture 2085', 'Debenture', 'Institution'::public.sector_type, 1000, NULL, 8.75, 8.75, 'Active'::public.record_status),
  (gen_random_uuid(), 'RBBMBL', 'RBB Merchant Banking Limited', 'Equity', 'Institution'::public.sector_type, 100, NULL, NULL, NULL, 'Active'::public.record_status)
ON CONFLICT DO NOTHING;

-- 3. Bulletproof bulk_insert_clients RPC
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
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  FOR v_client IN SELECT * FROM jsonb_array_elements(p_clients)
  LOOP
    BEGIN
      -- Safe enum mapping for holder_type
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

      -- Safe enum mapping for residency
      IF v_client->>'residency' IN ('Resident', 'Non-Resident') THEN
        v_residency := (v_client->>'residency')::public.residency_type;
      ELSIF v_client->>'residency' ILIKE '%non%' OR v_client->>'residency' ILIKE '%foreign%' THEN
        v_residency := 'Non-Resident'::public.residency_type;
      ELSE
        v_residency := 'Resident'::public.residency_type;
      END IF;

      -- Safe enum mapping for record_status
      IF v_client->>'status' IN ('Active', 'Inactive', 'Merged', 'Suspended') THEN
        v_status := (v_client->>'status')::public.record_status;
      ELSE
        v_status := 'Active'::public.record_status;
      END IF;

      -- Safe enum mapping for verification_status
      IF v_client->>'verification_status' IN ('Verified', 'Unverified', 'Pending_Review', 'Rejected') THEN
        v_verification := (v_client->>'verification_status')::public.verification_status;
      ELSE
        v_verification := 'Verified'::public.verification_status;
      END IF;

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
        v_residency,
        v_holder_type,
        v_status,
        v_verification,
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
        residency = COALESCE(v_residency, clients.residency),
        holder_type = COALESCE(v_holder_type, clients.holder_type),
        verification_status = COALESCE(v_verification, clients.verification_status),
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

-- 4. Bulletproof bulk_insert_dividend_payables RPC
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
  v_div_type public.dividend_type;
  v_pay_status public.payment_status;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      IF v_payable->>'dividend_type' IN ('Cash', 'Stock', 'Bonus', 'Right') THEN
        v_div_type := (v_payable->>'dividend_type')::public.dividend_type;
      ELSE
        v_div_type := 'Cash'::public.dividend_type;
      END IF;

      IF v_payable->>'payment_status' IN ('Pending', 'Processing', 'Paid', 'Failed', 'Cancelled', 'Discrepancy') THEN
        v_pay_status := (v_payable->>'payment_status')::public.payment_status;
      ELSE
        v_pay_status := 'Pending'::public.payment_status;
      END IF;

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
        v_div_type,
        COALESCE(NULLIF(v_payable->>'gross_dividend', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'tax_amount', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'net_payable', '')::numeric, 0),
        v_payable->>'fiscal_year',
        v_pay_status,
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

-- 5. Bulletproof bulk_insert_interest_payables RPC
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
  v_pay_status public.payment_status;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      IF v_payable->>'payment_status' IN ('Pending', 'Processing', 'Paid', 'Failed', 'Cancelled', 'Discrepancy') THEN
        v_pay_status := (v_payable->>'payment_status')::public.payment_status;
      ELSE
        v_pay_status := 'Pending'::public.payment_status;
      END IF;

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
        v_pay_status,
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

-- 6. Bulletproof bulk_insert_mutual_fund_payables RPC
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
  v_div_type public.dividend_type;
  v_pay_status public.payment_status;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      IF v_payable->>'dividend_type' IN ('Cash', 'Stock', 'Bonus', 'Right') THEN
        v_div_type := (v_payable->>'dividend_type')::public.dividend_type;
      ELSE
        v_div_type := 'Cash'::public.dividend_type;
      END IF;

      IF v_payable->>'payment_status' IN ('Pending', 'Processing', 'Paid', 'Failed', 'Cancelled', 'Discrepancy') THEN
        v_pay_status := (v_payable->>'payment_status')::public.payment_status;
      ELSE
        v_pay_status := 'Pending'::public.payment_status;
      END IF;

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
        v_div_type,
        COALESCE(NULLIF(v_payable->>'gross_dividend', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'tax_amount', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'net_payable', '')::numeric, 0),
        v_pay_status,
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
