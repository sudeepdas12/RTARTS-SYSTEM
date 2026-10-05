-- Migration: 20261220000000_harden_bulk_insert_clients_and_global_boid.sql
-- Description:
-- 1. Updates bulk_insert_clients to use ON CONFLICT (boid) matching clients_boid_key constraint.
-- 2. Sets fallback classification_status to 'AUTO_CLASSIFIED' instead of 'PENDING'
--    which previously violated clients_classification_status_check constraint.

BEGIN;

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
        COALESCE(NULLIF(v_client->>'classification_status', ''), 'AUTO_CLASSIFIED'),
        COALESCE(NULLIF(v_client->>'classification_source', ''), 'SYSTEM'),
        COALESCE((v_client->>'kitta')::numeric, 0)
      )
      ON CONFLICT (boid) DO UPDATE SET
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
        classification_status = CASE 
          WHEN clients.classification_status = 'OVERRIDDEN' THEN 'OVERRIDDEN' 
          ELSE COALESCE(EXCLUDED.classification_status, clients.classification_status) 
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

COMMIT;
