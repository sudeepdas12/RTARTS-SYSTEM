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
        holder_type, status, verification_status,
        payee_classification, payee_segment,
        classification_status, classification_source
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
        COALESCE((v_client->>'verification_status')::public.verification_status, 'Verified'),
        COALESCE(v_client->>'payee_classification', 'UNCLASSIFIED'),
        v_client->>'payee_segment',
        COALESCE(v_client->>'classification_status', 'REVIEW_REQUIRED'),
        v_client->>'classification_source'
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
        verification_status = EXCLUDED.verification_status,
        payee_classification = EXCLUDED.payee_classification,
        payee_segment = EXCLUDED.payee_segment,
        classification_status = EXCLUDED.classification_status,
        classification_source = EXCLUDED.classification_source;
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