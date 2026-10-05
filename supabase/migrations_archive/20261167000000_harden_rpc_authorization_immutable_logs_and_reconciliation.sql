-- ============================================================================
-- Migration: 20261167000000_harden_rpc_authorization_immutable_logs_and_reconciliation.sql
-- Description:
-- 1. Fix mutable search paths on set_updated_at and calc_net_payable
-- 2. Enforce strict company access authorization inside all bulk-import RPCs
-- 3. Enforce company access authorization in apply_reconciliation_batch
-- 4. Enforce company access authorization in complete_payment_batch_atomic
-- 5. Add atomic, transactional reconciliation revert RPC
-- 6. Harden audit_logs, notifications, approval_logs, payment_logs RLS & triggers
-- 7. Remove upload_errors null ownership bypass
-- 8. Strict company access model: no-assignment means no-access for non-admins
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Fix Remaining Mutable Search Paths
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.calc_net_payable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.net_payable = COALESCE(NEW.gross_interest, 0) - COALESCE(NEW.tax_amount, 0);
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Strict Company Access Model (No Permissive Fallback)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_company_access(_user_id UUID, _company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    -- 1. System administrators and supervisors have global oversight
    has_any_role(_user_id, ARRAY['admin'::app_role, 'supervisor'::app_role])
    -- 2. Explicit assignment in user_company_access is strictly required for all other users
    OR EXISTS (
      SELECT 1 FROM public.user_company_access
      WHERE user_id = _user_id AND company_id = _company_id
    )
  );
$$;

REVOKE ALL ON FUNCTION public.has_company_access(UUID, UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_company_access(UUID, UUID) TO authenticated, service_role;

-- Seed explicit company access for all existing users so current accounts remain operational
INSERT INTO public.user_company_access (user_id, company_id)
SELECT u.id, c.id
FROM auth.users u
CROSS JOIN public.companies c
ON CONFLICT (user_id, company_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Company Authorization in Privileged Bulk Import RPCs
-- ----------------------------------------------------------------------------

-- 3a. bulk_insert_clients
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
BEGIN
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');

  -- Verify caller has access to all companies in the payload
  IF current_user != 'service_role' THEN
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
        client_code = COALESCE(NULLIF(EXCLUDED.client_code, ''), clients.client_code),
        client_id = COALESCE(NULLIF(EXCLUDED.client_id, ''), clients.client_id),
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

REVOKE ALL ON FUNCTION public.bulk_insert_clients(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.bulk_insert_clients(jsonb) TO authenticated, service_role;

-- 3b. bulk_insert_dividend_payables
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
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');

  IF current_user != 'service_role' THEN
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

REVOKE ALL ON FUNCTION public.bulk_insert_dividend_payables(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.bulk_insert_dividend_payables(jsonb) TO authenticated, service_role;

-- 3c. bulk_insert_interest_payables
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
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');

  IF current_user != 'service_role' THEN
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
        COALESCE(v_payable->>'payee_classification', 'UNCLASSIFIED'),
        v_payable->>'payee_segment',
        COALESCE(v_payable->>'classification_status', 'AUTO_CLASSIFIED'),
        COALESCE(NULLIF(v_payable->>'shares_held', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'kitta', '')::numeric, 0)
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

REVOKE ALL ON FUNCTION public.bulk_insert_interest_payables(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.bulk_insert_interest_payables(jsonb) TO authenticated, service_role;

-- 3d. bulk_insert_mutual_fund_payables
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
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');

  IF current_user != 'service_role' THEN
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

REVOKE ALL ON FUNCTION public.bulk_insert_mutual_fund_payables(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.bulk_insert_mutual_fund_payables(jsonb) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Company Authorization in apply_reconciliation_batch
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_reconciliation_batch(p_items jsonb, p_batch_info jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_item jsonb;
  v_batch_id uuid;
  v_company_id uuid;
  v_payable_id uuid;
  v_payment_id uuid;
  v_payable_type text;
  v_target_table text;
  v_actual_amt numeric;
  v_expected_amt numeric;
  v_paid_amt numeric;
  v_result text;
  v_new_status public.payment_status;
  v_payment_ref text;
  v_payment_method public.payment_method;
  v_updated int := 0;
  v_payments_created int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');
  v_uid := auth.uid();

  -- Verify caller has company access for batch info
  IF current_user != 'service_role' AND p_batch_info IS NOT NULL AND (p_batch_info->>'company_id') IS NOT NULL AND (p_batch_info->>'company_id') != '' THEN
    IF NOT public.has_company_access(v_uid, (p_batch_info->>'company_id')::uuid) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to company % in reconciliation batch info', (p_batch_info->>'company_id') USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Verify caller has company access for all item companies
  IF current_user != 'service_role' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) item
      WHERE (item->>'company_id') IS NOT NULL AND (item->>'company_id') != ''
        AND NOT public.has_company_access(v_uid, (item->>'company_id')::uuid)
    ) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to one or more companies in reconciliation items' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_payment_method := CASE UPPER(COALESCE(p_batch_info->>'payment_method', 'CONNECTIPS'))
    WHEN 'CONNECTIPS' THEN 'ConnectIPS'::public.payment_method
    WHEN 'NEFT' THEN 'NEFT'::public.payment_method
    WHEN 'RTGS' THEN 'RTGS'::public.payment_method
    WHEN 'CHEQUE' THEN 'Cheque'::public.payment_method
    WHEN 'CASH' THEN 'Cash'::public.payment_method
    ELSE 'Manual'::public.payment_method
  END;

  IF p_batch_info IS NOT NULL AND p_batch_info->>'batch_name' IS NOT NULL THEN
    BEGIN
      INSERT INTO public.payment_batches (
        batch_name,
        company_id,
        payable_type,
        payment_method,
        total_payments,
        total_amount,
        total_tax,
        status,
        processed_at,
        cds_batch_ref,
        created_by
      ) VALUES (
        p_batch_info->>'batch_name',
        NULLIF(p_batch_info->>'company_id', '')::uuid,
        p_batch_info->>'payable_type',
        COALESCE(p_batch_info->>'payment_method', 'ConnectIPS'),
        COALESCE((p_batch_info->>'total_records')::numeric, 0),
        COALESCE((p_batch_info->>'total_net')::numeric, 0),
        COALESCE((p_batch_info->>'total_tax')::numeric, 0),
        'Completed',
        now(),
        COALESCE(p_batch_info->>'cds_batch_ref', 'RECON-APPLY'),
        v_uid
      )
      RETURNING id INTO v_batch_id;
    EXCEPTION WHEN OTHERS THEN
      v_batch_id := NULL;
    END;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_payable_id   := NULLIF(v_item->>'payable_id', '')::uuid;
      v_company_id   := NULLIF(v_item->>'company_id', '')::uuid;
      v_payment_id   := NULLIF(v_item->>'payment_id', '')::uuid;
      v_payable_type := LOWER(COALESCE(v_item->>'payable_type', 'interest'));
      v_result       := UPPER(COALESCE(v_item->>'reconciliation_result', 'MATCHED'));
      v_actual_amt   := COALESCE((v_item->>'actual_amount')::numeric, 0);
      v_expected_amt := COALESCE((v_item->>'expected_amount')::numeric, 0);
      v_payment_ref  := v_item->>'bank_reference';

      IF v_payable_type = 'dividend' THEN
        v_target_table := 'dividend_payables';
      ELSIF v_payable_type = 'mutual_fund' THEN
        v_target_table := 'mutual_fund_payables';
      ELSE
        v_target_table := 'interest_payables';
      END IF;

      IF v_result = 'MATCHED' THEN
        v_new_status := 'Paid'::public.payment_status;
        v_paid_amt   := v_expected_amt;
      ELSIF v_result = 'PARTIAL' THEN
        v_new_status := 'Partial'::public.payment_status;
        v_paid_amt   := v_actual_amt;
      ELSE
        v_new_status := 'Pending'::public.payment_status;
        v_paid_amt   := 0;
      END IF;

      IF v_payable_id IS NOT NULL THEN
        IF v_target_table = 'dividend_payables' THEN
          UPDATE public.dividend_payables
          SET payment_status    = v_new_status,
              payment_date      = CURRENT_DATE,
              payment_reference = COALESCE(v_payment_ref, payment_reference),
              updated_at        = now()
          WHERE id = v_payable_id;
        ELSIF v_target_table = 'mutual_fund_payables' THEN
          UPDATE public.mutual_fund_payables
          SET payment_status    = v_new_status,
              payment_date      = CURRENT_DATE,
              payment_reference = COALESCE(v_payment_ref, payment_reference),
              updated_at        = now()
          WHERE id = v_payable_id;
        ELSE
          UPDATE public.interest_payables
          SET payment_status    = v_new_status,
              payment_date      = CURRENT_DATE,
              payment_reference = COALESCE(v_payment_ref, payment_reference),
              updated_at        = now()
          WHERE id = v_payable_id;
        END IF;

        IF v_payment_id IS NOT NULL THEN
          UPDATE public.payments
          SET status            = CASE WHEN v_new_status = 'Paid' THEN 'Completed' ELSE 'Pending' END,
              payment_date      = CURRENT_DATE,
              paid_amount       = v_paid_amt,
              payment_reference = COALESCE(v_payment_ref, payment_reference),
              updated_at        = now()
          WHERE id = v_payment_id;
        ELSIF v_new_status = 'Paid' AND v_company_id IS NOT NULL THEN
          INSERT INTO public.payments (
            batch_id,
            company_id,
            payable_type,
            payable_id,
            gross_amount,
            tax_amount,
            net_amount,
            paid_amount,
            payment_method,
            payment_date,
            payment_reference,
            status,
            created_by
          ) VALUES (
            v_batch_id,
            v_company_id,
            v_target_table,
            v_payable_id,
            v_expected_amt,
            0,
            v_expected_amt,
            v_paid_amt,
            v_payment_method,
            CURRENT_DATE,
            v_payment_ref,
            'Completed',
            v_uid
          );
          v_payments_created := v_payments_created + 1;
        END IF;

        v_updated := v_updated + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'payable_id', v_item->>'payable_id',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'payables_updated', v_updated,
    'payments_created', v_payments_created,
    'batch_id', v_batch_id,
    'errors', v_errors
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_reconciliation_batch(jsonb, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.apply_reconciliation_batch(jsonb, jsonb) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Company Authorization in complete_payment_batch_atomic
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_payment_batch_atomic(p_batch_id uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch record;
  v_payments_updated bigint := 0;
  v_div_updated bigint := 0;
  v_int_updated bigint := 0;
  v_mf_updated bigint := 0;
  v_today date := CURRENT_DATE;
  v_actor_id uuid;
BEGIN
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator');
  v_actor_id := COALESCE(auth.uid(), p_user_id);

  -- 1. Fetch and lock batch record
  SELECT * INTO v_batch
  FROM public.payment_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment batch with id % not found', p_batch_id;
  END IF;

  -- 2. Verify caller has access to the batch's company
  IF current_user != 'service_role' AND v_batch.company_id IS NOT NULL THEN
    IF NOT public.has_company_access(auth.uid(), v_batch.company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to company % for payment batch %', v_batch.company_id, p_batch_id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 3. Update payment batch status
  UPDATE public.payment_batches
  SET
    status = 'Completed',
    processed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_batch_id;

  -- 4. Update all payments in this batch
  WITH updated_payments AS (
    UPDATE public.payments
    SET
      status = 'Completed',
      payment_date = v_today,
      updated_at = NOW()
    WHERE batch_id = p_batch_id
      AND status != 'Completed'
    RETURNING id, payable_id, payable_type
  )
  SELECT count(*) INTO v_payments_updated FROM updated_payments;

  -- 5. Update dividend_payables
  WITH div_matches AS (
    UPDATE public.dividend_payables dp
    SET
      payment_status = 'Paid',
      payment_date = v_today,
      updated_at = NOW()
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.payable_type = 'dividend_payables'
      AND dp.id = p.payable_id
    RETURNING dp.id
  )
  SELECT count(*) INTO v_div_updated FROM div_matches;

  -- 6. Update interest_payables
  WITH int_matches AS (
    UPDATE public.interest_payables ip
    SET
      payment_status = 'Paid',
      payment_date = v_today,
      updated_at = NOW()
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.payable_type = 'interest_payables'
      AND ip.id = p.payable_id
    RETURNING ip.id
  )
  SELECT count(*) INTO v_int_updated FROM int_matches;

  -- 7. Update mutual_fund_payables
  WITH mf_matches AS (
    UPDATE public.mutual_fund_payables mp
    SET
      payment_status = 'Paid',
      payment_date = v_today,
      updated_at = NOW()
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.payable_type = 'mutual_fund_payables'
      AND mp.id = p.payable_id
    RETURNING mp.id
  )
  SELECT count(*) INTO v_mf_updated FROM mf_matches;

  -- 8. Record audit log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    table_name,
    record_id,
    new_value
  ) VALUES (
    v_actor_id,
    'COMPLETE_BATCH',
    'payment_batches',
    p_batch_id,
    jsonb_build_object(
      'status', 'Completed',
      'payments_updated', v_payments_updated,
      'dividend_updated', v_div_updated,
      'interest_updated', v_int_updated,
      'mutual_fund_updated', v_mf_updated
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'payments_updated', v_payments_updated,
    'dividend_payables_updated', v_div_updated,
    'interest_payables_updated', v_int_updated,
    'mutual_fund_payables_updated', v_mf_updated
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_payment_batch_atomic(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.complete_payment_batch_atomic(uuid, uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Atomic Reconciliation Revert RPC
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.revert_reconciliation_lot_atomic(
  p_result_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_reverted_payables int := 0;
  v_updated_payments int := 0;
  v_deleted_results int := 0;
  v_div_ids uuid[];
  v_int_ids uuid[];
  v_mf_ids uuid[];
  v_all_payable_ids uuid[];
BEGIN
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');
  v_uid := auth.uid();

  -- Verify caller has access to the companies of these reconciliation records
  IF current_user != 'service_role' THEN
    IF EXISTS (
      SELECT 1 FROM public.reconciliation_results rr
      WHERE rr.id = ANY(p_result_ids)
        AND rr.company_id IS NOT NULL
        AND NOT public.has_company_access(v_uid, rr.company_id)
    ) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to one or more companies in reconciliation lot' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 1. Extract payable IDs grouped by type
  SELECT COALESCE(array_agg(payable_id), '{}') INTO v_div_ids
  FROM public.reconciliation_results
  WHERE id = ANY(p_result_ids) AND LOWER(COALESCE(payable_type, '')) = 'dividend' AND payable_id IS NOT NULL;

  SELECT COALESCE(array_agg(payable_id), '{}') INTO v_int_ids
  FROM public.reconciliation_results
  WHERE id = ANY(p_result_ids) AND LOWER(COALESCE(payable_type, '')) IN ('interest', 'debenture') AND payable_id IS NOT NULL;

  SELECT COALESCE(array_agg(payable_id), '{}') INTO v_mf_ids
  FROM public.reconciliation_results
  WHERE id = ANY(p_result_ids) AND LOWER(COALESCE(payable_type, '')) = 'mutual_fund' AND payable_id IS NOT NULL;

  v_all_payable_ids := v_div_ids || v_int_ids || v_mf_ids;

  -- 2. Reset payables back to Pending
  IF array_length(v_div_ids, 1) > 0 THEN
    UPDATE public.dividend_payables
    SET payment_status = 'Pending', payment_date = NULL, payment_reference = NULL, updated_at = now()
    WHERE id = ANY(v_div_ids);
    v_reverted_payables := v_reverted_payables + array_length(v_div_ids, 1);
  END IF;

  IF array_length(v_int_ids, 1) > 0 THEN
    UPDATE public.interest_payables
    SET payment_status = 'Pending', payment_date = NULL, payment_reference = NULL, updated_at = now()
    WHERE id = ANY(v_int_ids);
    v_reverted_payables := v_reverted_payables + array_length(v_int_ids, 1);
  END IF;

  IF array_length(v_mf_ids, 1) > 0 THEN
    UPDATE public.mutual_fund_payables
    SET payment_status = 'Pending', payment_date = NULL, payment_reference = NULL, updated_at = now()
    WHERE id = ANY(v_mf_ids);
    v_reverted_payables := v_reverted_payables + array_length(v_mf_ids, 1);
  END IF;

  -- 3. Reset associated payment rows
  IF array_length(v_all_payable_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE public.payments
      SET status = 'Pending', payment_date = NULL, paid_amount = 0, remarks = NULL, payment_reference = NULL, updated_at = now()
      WHERE payable_id = ANY(v_all_payable_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_updated_payments FROM upd;
  END IF;

  -- 4. Delete reconciliation records for this lot
  WITH del AS (
    DELETE FROM public.reconciliation_results
    WHERE id = ANY(p_result_ids)
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_results FROM del;

  -- 5. Record audit log
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
  VALUES (
    v_uid,
    'RECONCILIATION_LOT_REVERTED',
    'reconciliation_results',
    NULL,
    jsonb_build_object(
      'reverted_payables', v_reverted_payables,
      'updated_payments', v_updated_payments,
      'deleted_results', v_deleted_results,
      'result_ids_count', array_length(p_result_ids, 1)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'reverted_payables', v_reverted_payables,
    'deleted_payments', v_updated_payments,
    'history_deleted', v_deleted_results > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.revert_reconciliation_lot_atomic(uuid[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.revert_reconciliation_lot_atomic(uuid[]) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. Controlled & Server-Side Enforced Audit, Approval, Payment, and Notification Logs
-- ----------------------------------------------------------------------------

-- Audit logs actor trigger
CREATE OR REPLACE FUNCTION public.set_audit_log_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  NEW.action_time := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_actor ON public.audit_logs;
CREATE TRIGGER trg_audit_log_actor
BEFORE INSERT ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.set_audit_log_actor();

DROP POLICY IF EXISTS "audit_insert" ON public.audit_logs;
CREATE POLICY "audit_insert" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
  );

-- Notifications
DROP POLICY IF EXISTS "notif_insert" ON public.notifications;
CREATE POLICY "notif_insert" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role])
  );

-- Approval logs actor trigger
CREATE OR REPLACE FUNCTION public.set_approval_log_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.performed_by := auth.uid();
  END IF;
  NEW.performed_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_approval_log_actor ON public.approval_logs;
CREATE TRIGGER trg_approval_log_actor
BEFORE INSERT ON public.approval_logs
FOR EACH ROW EXECUTE FUNCTION public.set_approval_log_actor();

DROP POLICY IF EXISTS "apl_insert" ON public.approval_logs;
CREATE POLICY "apl_insert" ON public.approval_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    performed_by = auth.uid()
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role])
  );

DROP POLICY IF EXISTS "apl_read" ON public.approval_logs;
CREATE POLICY "apl_read" ON public.approval_logs
  FOR SELECT TO authenticated
  USING (
    performed_by = auth.uid()
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'auditor'::app_role])
  );

-- Payment logs actor trigger
CREATE OR REPLACE FUNCTION public.set_payment_log_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.performed_by := auth.uid();
  END IF;
  NEW.performed_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_log_actor ON public.payment_logs;
CREATE TRIGGER trg_payment_log_actor
BEFORE INSERT ON public.payment_logs
FOR EACH ROW EXECUTE FUNCTION public.set_payment_log_actor();

DROP POLICY IF EXISTS "pl_insert" ON public.payment_logs;
CREATE POLICY "pl_insert" ON public.payment_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    performed_by = auth.uid()
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role])
  );

DROP POLICY IF EXISTS "pl_read" ON public.payment_logs;
CREATE POLICY "pl_read" ON public.payment_logs
  FOR SELECT TO authenticated
  USING (
    performed_by = auth.uid()
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'supervisor'::app_role, 'finance_operator'::app_role, 'auditor'::app_role])
  );

-- ----------------------------------------------------------------------------
-- 8. Eliminate Upload Error Null-Ownership Bypass
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "ue_write" ON public.upload_errors;
CREATE POLICY "ue_write" ON public.upload_errors
  FOR INSERT
  TO authenticated
  WITH CHECK (
    upload_id IN (
      SELECT id FROM public.upload_history
      WHERE user_id = auth.uid()
    )
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'finance_operator'::app_role])
  );

DROP POLICY IF EXISTS "ue_read" ON public.upload_errors;
CREATE POLICY "ue_read" ON public.upload_errors
  FOR SELECT
  TO authenticated
  USING (
    upload_id IN (
      SELECT id FROM public.upload_history
      WHERE user_id = auth.uid()
    )
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'finance_operator'::app_role, 'auditor'::app_role])
  );
