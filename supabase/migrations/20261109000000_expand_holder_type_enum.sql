-- =========================================================
-- Expand the holder_type enum with granular investor categories
--
-- Why: mapToHolderType() previously collapsed Mutual Funds, Foreign
-- investors and Legal Persons into a single "Institution" bucket so
-- the database lost the distinction. This made it impossible to build
-- an accurate "Shareholder Demographics" report (especially for cash
-- dividends & stock where the TDS rate no longer discriminates).
--
-- This migration:
--   1. Adds the granular values while KEEPING the legacy values
--      ('Public','Promoter','Institution') so existing rows are
--      untouched and backward compatible.
--   2. Recreates the bulk_insert_clients RPC against the new type.
--
-- PostgreSQL does not allow ALTER TYPE ... ADD VALUE inside a
-- transaction (and the Supabase CLI applies migrations inside one),
-- so we recreate the enum type instead: CREATE new -> cast column ->
-- DROP old -> RENAME new. This whole block is transaction-safe.
-- =========================================================

-- 1. New enum: granular categories first, legacy values retained.
CREATE TYPE public.holder_type_new AS ENUM (
  'Natural Person - Public',
  'Natural Person - Promoter',
  'Legal Person',
  'Mutual Fund',
  'Foreign',
  'Tax Exempt',
  -- legacy values retained for backward compatibility
  'Public',
  'Promoter',
  'Institution'
);

-- 2. Migrate the column to the new type (legacy text values still valid).
ALTER TABLE public.clients
  ALTER COLUMN holder_type TYPE public.holder_type_new
  USING holder_type::text::public.holder_type_new;

-- 3. The bulk_insert_clients RPC casts to ::public.holder_type, so drop it
--    before we drop the old type (removes the type dependency).
DROP FUNCTION IF EXISTS public.bulk_insert_clients(jsonb);

-- 4. Drop the legacy enum now that nothing references it.
DROP TYPE public.holder_type;

-- 5. Promote the new enum to the canonical name.
ALTER TYPE public.holder_type_new RENAME TO holder_type;

-- 6. Recreate the RPC against the renamed (granular) type.
--    The cast accepts any valid holder_type value, including the new
--    granular ones; the default protects rows that arrive without one.
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
        holder_type, status, verification_status
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
        COALESCE((v_client->>'holder_type')::public.holder_type, 'Natural Person - Public'),
        COALESCE((v_client->>'status')::public.record_status, 'Active'),
        COALESCE((v_client->>'verification_status')::public.verification_status, 'Verified')
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
        verification_status = EXCLUDED.verification_status;
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
