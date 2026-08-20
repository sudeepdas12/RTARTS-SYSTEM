-- =========================================================
-- Migration: Add missing client fields & preserve existing data on import
-- =========================================================

-- 1. Add date_of_birth, gender, occupation, bank_code to clients table
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS date_of_birth TEXT,
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS occupation TEXT,
  ADD COLUMN IF NOT EXISTS bank_code TEXT;

-- 2. Add bank columns and lot_name to interest_payables if missing
ALTER TABLE public.interest_payables
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_no TEXT,
  ADD COLUMN IF NOT EXISTS bank_branch TEXT,
  ADD COLUMN IF NOT EXISTS lot_name TEXT;

-- 3. Add bank_branch and lot_name to dividend_payables if missing
ALTER TABLE public.dividend_payables
  ADD COLUMN IF NOT EXISTS bank_branch TEXT,
  ADD COLUMN IF NOT EXISTS lot_name TEXT;

-- 4. Update bulk_insert_clients RPC to support all fields and NEVER overwrite existing valuable data with blanks
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
        id, boid, company_id, full_name, client_code, client_id,
        father_name, grandfather_name, pan_or_citizenship,
        date_of_birth, gender, occupation,
        address, province, district, municipality,
        phone, email, bank_name, bank_branch, bank_account_no, bank_code, account_type,
        residency, holder_type, status, verification_status,
        payee_classification, payee_segment,
        classification_status, classification_source
      ) VALUES (
        (v_client->>'id')::uuid,
        v_client->>'boid',
        (v_client->>'company_id')::uuid,
        v_client->>'full_name',
        v_client->>'client_code',
        NULLIF(v_client->>'client_id', ''),
        NULLIF(v_client->>'father_name', ''),
        NULLIF(v_client->>'grandfather_name', ''),
        NULLIF(v_client->>'pan_or_citizenship', ''),
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
        NULLIF(v_client->>'classification_source', '')
      )
      ON CONFLICT (boid) DO UPDATE SET
        full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), clients.full_name),
        company_id = COALESCE(EXCLUDED.company_id, clients.company_id),
        client_code = COALESCE(NULLIF(EXCLUDED.client_code, ''), clients.client_code),
        client_id = COALESCE(NULLIF(EXCLUDED.client_id, ''), clients.client_id),
        father_name = COALESCE(NULLIF(EXCLUDED.father_name, ''), clients.father_name),
        grandfather_name = COALESCE(NULLIF(EXCLUDED.grandfather_name, ''), clients.grandfather_name),
        pan_or_citizenship = COALESCE(NULLIF(EXCLUDED.pan_or_citizenship, ''), clients.pan_or_citizenship),
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
        residency = COALESCE(EXCLUDED.residency, clients.residency),
        holder_type = COALESCE(EXCLUDED.holder_type, clients.holder_type),
        verification_status = COALESCE(EXCLUDED.verification_status, clients.verification_status),
        payee_classification = COALESCE(NULLIF(EXCLUDED.payee_classification, 'UNCLASSIFIED'), clients.payee_classification),
        payee_segment = COALESCE(EXCLUDED.payee_segment, clients.payee_segment),
        classification_status = COALESCE(EXCLUDED.classification_status, clients.classification_status),
        classification_source = COALESCE(EXCLUDED.classification_source, clients.classification_source),
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

GRANT EXECUTE ON FUNCTION public.bulk_insert_clients(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_insert_clients(jsonb) TO service_role;
