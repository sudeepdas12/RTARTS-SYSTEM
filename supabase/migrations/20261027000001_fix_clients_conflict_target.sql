-- Migration: 20261027000001_fix_clients_conflict_target.sql
-- Description: Align bulk_insert_clients and bulk_import_agm_shareholders with uq_clients_company_boid unique constraint

BEGIN;

-- 1. Ensure uq_clients_company_boid constraint exists on public.clients
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_clients_company_boid' AND conrelid = 'public.clients'::regclass
  ) THEN
    ALTER TABLE public.clients ADD CONSTRAINT uq_clients_company_boid UNIQUE (company_id, boid);
  END IF;
END $$;

-- 2. Update bulk_insert_clients to use ON CONFLICT (company_id, boid)
CREATE OR REPLACE FUNCTION public.bulk_insert_clients(p_clients jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
      ELSIF NULLIF(BTRIM(COALESCE(v_client->>'holder_type', '')), '') IS NULL THEN
        -- Unknown holder type must stay NULL so the classifier's REVIEW_REQUIRED verdict is kept.
        v_holder_type := NULL;
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
        COALESCE(NULLIF(v_client->>'classification_status', ''), 'AUTO_CLASSIFIED'),
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
        holder_type = CASE
          WHEN clients.classification_status = 'CONFIRMED' THEN clients.holder_type
          WHEN EXCLUDED.classification_status = 'REVIEW_REQUIRED' AND EXCLUDED.payee_classification = 'UNCLASSIFIED' THEN EXCLUDED.holder_type
          ELSE COALESCE(EXCLUDED.holder_type, clients.holder_type)
        END,
        payee_classification = CASE 
          WHEN clients.classification_status = 'CONFIRMED' THEN clients.payee_classification 
          WHEN EXCLUDED.classification_status = 'REVIEW_REQUIRED' AND EXCLUDED.payee_classification = 'UNCLASSIFIED' THEN 'UNCLASSIFIED'
          ELSE COALESCE(NULLIF(EXCLUDED.payee_classification, 'UNCLASSIFIED'), clients.payee_classification) 
        END,
        payee_segment = CASE 
          WHEN clients.classification_status = 'CONFIRMED' THEN clients.payee_segment 
          ELSE COALESCE(EXCLUDED.payee_segment, clients.payee_segment) 
        END,
        classification_status = CASE 
          WHEN clients.classification_status = 'CONFIRMED' THEN 'CONFIRMED' 
          ELSE COALESCE(EXCLUDED.classification_status, clients.classification_status) 
        END,
        classification_source = CASE
          WHEN clients.classification_status = 'CONFIRMED' THEN clients.classification_source
          ELSE COALESCE(EXCLUDED.classification_source, clients.classification_source)
        END;

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

-- 3. Update bulk_import_agm_shareholders to use ON CONFLICT (company_id, boid)
CREATE OR REPLACE FUNCTION public.bulk_import_agm_shareholders(
    p_company_id uuid,
    p_clients jsonb,
    p_payables jsonb
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_jwt_role TEXT;
  v_client_rec JSONB;
  v_pay_rec JSONB;
  v_upserted_clients INT := 0;
  v_inserted_payables INT := 0;
  v_target_fiscal_year TEXT;
  v_client_id UUID;
  v_boid TEXT;
  v_boid_to_id_map JSONB := '{}'::jsonb;
BEGIN
  -- Extract caller JWT role
  BEGIN
    v_jwt_role := (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role != 'service_role' AND current_user != 'service_role' AND current_user != 'postgres' THEN
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
    END IF;

    IF NOT public.has_company_access(v_user_id, p_company_id) THEN
      RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 1. Upsert valid clients in the batch (strictly excluding pool/escrow accounts)
  FOR v_client_rec IN SELECT * FROM jsonb_array_elements(p_clients)
  LOOP
    v_boid := TRIM(v_client_rec->>'boid');

    IF v_boid IN ('REMCONVERSION', 'REMBONUSFY20767778', 'FOLIO-REMPOOL')
       OR v_boid ILIKE 'FOLIO-REM%'
       OR v_boid ILIKE 'REM%' THEN
      CONTINUE;
    END IF;

    INSERT INTO public.clients (
      company_id,
      client_code,
      boid,
      full_name,
      father_name,
      grandfather_name,
      citizenship_no,
      pan_no,
      address,
      phone,
      bank_name,
      bank_account_no,
      holder_type,
      kitta,
      status
    ) VALUES (
      p_company_id,
      COALESCE(v_client_rec->>'client_code', v_client_rec->>'client_id', v_boid),
      v_boid,
      COALESCE(v_client_rec->>'full_name', v_client_rec->>'name', 'Unknown Client'),
      v_client_rec->>'father_name',
      v_client_rec->>'grandfather_name',
      v_client_rec->>'citizenship_no',
      v_client_rec->>'pan_no',
      v_client_rec->>'address',
      COALESCE(v_client_rec->>'phone', v_client_rec->>'contact_number'),
      v_client_rec->>'bank_name',
      COALESCE(v_client_rec->>'bank_account_no', v_client_rec->>'bank_account_number'),
      (CASE 
        WHEN v_client_rec->>'holder_type' IN ('Promoter', 'PROMOTER') THEN 'Promoter'::holder_type
        WHEN v_client_rec->>'holder_type' IN ('Mutual Fund', 'MUTUAL_FUND') THEN 'Mutual Fund'::holder_type
        WHEN v_client_rec->>'holder_type' IN ('Institution', 'Legal Person') THEN 'Legal Person'::holder_type
        ELSE 'Public'::holder_type
      END),
      COALESCE((v_client_rec->>'total_kitta')::numeric, (v_client_rec->>'kitta')::numeric, 0),
      'Active'
    )
    ON CONFLICT (company_id, boid) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        client_code = COALESCE(public.clients.client_code, EXCLUDED.client_code),
        father_name = COALESCE(EXCLUDED.father_name, public.clients.father_name),
        grandfather_name = COALESCE(EXCLUDED.grandfather_name, public.clients.grandfather_name),
        citizenship_no = COALESCE(EXCLUDED.citizenship_no, public.clients.citizenship_no),
        pan_no = COALESCE(EXCLUDED.pan_no, public.clients.pan_no),
        address = COALESCE(EXCLUDED.address, public.clients.address),
        phone = COALESCE(EXCLUDED.phone, public.clients.phone),
        bank_name = COALESCE(EXCLUDED.bank_name, public.clients.bank_name),
        bank_account_no = COALESCE(EXCLUDED.bank_account_no, public.clients.bank_account_no),
        holder_type = EXCLUDED.holder_type,
        kitta = EXCLUDED.kitta,
        status = 'Active',
        updated_at = now()
    RETURNING id INTO v_client_id;

    v_upserted_clients := v_upserted_clients + 1;
    v_boid_to_id_map := jsonb_set(v_boid_to_id_map, ARRAY[v_boid], to_jsonb(v_client_id::text));
  END LOOP;

  -- 2. Handle fraction dividend payables atomically if present
  IF jsonb_array_length(p_payables) > 0 THEN
    v_target_fiscal_year := (p_payables->0)->>'fiscal_year';

    DELETE FROM public.dividend_payables dp
    WHERE dp.company_id = p_company_id
      AND dp.fiscal_year = v_target_fiscal_year
      AND dp.remarks ILIKE '%fraction remainder%'
      AND dp.client_id IN (
        SELECT (v_boid_to_id_map->>c_boid)::uuid
        FROM (SELECT DISTINCT value->>'boid' AS c_boid FROM jsonb_array_elements(p_payables)) t
        WHERE v_boid_to_id_map ? c_boid
      );

    FOR v_pay_rec IN SELECT * FROM jsonb_array_elements(p_payables)
    LOOP
      v_boid := TRIM(v_pay_rec->>'boid');

      IF v_boid IN ('REMCONVERSION', 'REMBONUSFY20767778', 'FOLIO-REMPOOL')
         OR v_boid ILIKE 'FOLIO-REM%'
         OR v_boid ILIKE 'REM%' THEN
        CONTINUE;
      END IF;

      v_client_id := (v_boid_to_id_map->>v_boid)::uuid;

      IF v_client_id IS NOT NULL THEN
        INSERT INTO public.dividend_payables (
          company_id,
          client_id,
          fiscal_year,
          gross_amount,
          tax_amount,
          net_amount,
          bonus_tax_amount,
          actual_bonus_kitta,
          fraction_kitta,
          issued_bonus_kitta,
          after_bonus_kitta,
          payment_status,
          verification_status,
          remarks
        ) VALUES (
          p_company_id,
          v_client_id,
          v_target_fiscal_year,
          COALESCE((v_pay_rec->>'gross_amount')::numeric, 0),
          COALESCE((v_pay_rec->>'tax_amount')::numeric, 0),
          COALESCE((v_pay_rec->>'net_amount')::numeric, 0),
          COALESCE((v_pay_rec->>'bonus_tax_amount')::numeric, 0),
          COALESCE((v_pay_rec->>'actual_bonus_kitta')::numeric, 0),
          COALESCE((v_pay_rec->>'fraction_kitta')::numeric, 0),
          COALESCE((v_pay_rec->>'issued_bonus_kitta')::numeric, 0),
          COALESCE((v_pay_rec->>'after_bonus_kitta')::numeric, 0),
          'Unpaid',
          'Pending',
          v_pay_rec->>'remarks'
        );
        v_inserted_payables := v_inserted_payables + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'clients_upserted', v_upserted_clients,
    'payables_inserted', v_inserted_payables
  );
END;
$$;

COMMIT;
