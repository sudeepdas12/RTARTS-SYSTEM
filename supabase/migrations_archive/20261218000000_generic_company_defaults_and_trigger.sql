-- ============================================================================
-- Migration: 20261218000000_generic_company_defaults_and_trigger.sql
-- Description:
--   1. Sets generic column defaults on public.companies (face_value, registrar, status).
--   2. Adds a BEFORE INSERT OR UPDATE trigger that automatically assigns standard
--      statutory face values (1000 for Debentures, 10 for Mutual Funds, 100 for Equity)
--      and default registrar for ANY current or future company added via Excel or UI.
--   3. Hardens bulk_upsert_company RPC to include face_value and registrar fallback.
--   4. Zero hardcoded company codes — fully dynamic for any company onboarded.
-- ============================================================================

BEGIN;

-- 1. Set standard column defaults on public.companies
ALTER TABLE public.companies ALTER COLUMN face_value SET DEFAULT 100;
ALTER TABLE public.companies ALTER COLUMN registrar SET DEFAULT 'RBB Merchant Banking Limited';
ALTER TABLE public.companies ALTER COLUMN status SET DEFAULT 'Active';

-- 2. Trigger function to enforce intelligent statutory defaults on any company
CREATE OR REPLACE FUNCTION public.trg_companies_generic_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Intelligent Face Value derivation if omitted
  IF NEW.face_value IS NULL OR NEW.face_value <= 0 THEN
    IF (NEW.company_type ILIKE '%debenture%' OR NEW.company_name ILIKE '%debenture%' OR NEW.company_code ILIKE '%d%') THEN
      NEW.face_value := 1000;
    ELSIF (NEW.company_type ILIKE '%mutual fund%' OR NEW.company_name ILIKE '%mutual fund%' OR NEW.company_code ILIKE '%rmf%') THEN
      NEW.face_value := 10;
    ELSE
      NEW.face_value := 100;
    END IF;
  END IF;

  -- Default Registrar (RTA / RTS) if omitted
  IF NEW.registrar IS NULL OR trim(NEW.registrar) = '' THEN
    NEW.registrar := 'RBB Merchant Banking Limited';
  END IF;

  -- Default Status if omitted
  IF NEW.status IS NULL THEN
    NEW.status := 'Active';
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger to public.companies
DROP TRIGGER IF EXISTS trg_companies_enforce_defaults ON public.companies;
CREATE TRIGGER trg_companies_enforce_defaults
  BEFORE INSERT OR UPDATE ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_companies_generic_defaults();

-- 3. Update bulk_upsert_company to also set face_value & registrar fallback on creation
CREATE OR REPLACE FUNCTION public.bulk_upsert_company(
  p_company_name text,
  p_company_code text,
  p_isin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_clean_isin text := NULLIF(trim(COALESCE(p_isin, '')), '');
  v_clean_name text := trim(p_company_name);
  v_clean_code text := trim(p_company_code);
  v_default_face_value numeric := 100;
BEGIN
  -- Determine default face value based on name/code
  IF (v_clean_name ILIKE '%debenture%' OR v_clean_code ILIKE '%d%') THEN
    v_default_face_value := 1000;
  ELSIF (v_clean_name ILIKE '%mutual fund%' OR v_clean_code ILIKE '%rmf%') THEN
    v_default_face_value := 10;
  END IF;

  -- 1. Try to find existing company by ISIN (if provided)
  IF v_clean_isin IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies
    WHERE isin = v_clean_isin
    LIMIT 1;
  END IF;

  -- 2. If not found by ISIN, try by exact company_code
  IF v_company_id IS NULL AND v_clean_code <> '' THEN
    SELECT id INTO v_company_id FROM public.companies
    WHERE company_code = v_clean_code
    LIMIT 1;
  END IF;

  -- 3. If not found, try to find existing company by name match
  IF v_company_id IS NULL THEN
    SELECT id INTO v_company_id FROM public.companies
    WHERE company_name ILIKE '%' || v_clean_name || '%'
       OR v_clean_name ILIKE '%' || company_name || '%'
    LIMIT 1;
  END IF;

  -- 4. If found, update its ISIN if company currently doesn't have one and v_clean_isin is provided
  IF v_company_id IS NOT NULL THEN
    IF v_clean_isin IS NOT NULL THEN
      UPDATE public.companies
      SET isin = COALESCE(isin, v_clean_isin)
      WHERE id = v_company_id AND (isin IS NULL OR isin = '');
    END IF;
  ELSE
    -- 5. If not found, create new company with defaults
    INSERT INTO public.companies (
      company_name,
      company_code,
      isin,
      face_value,
      registrar,
      status
    )
    VALUES (
      v_clean_name,
      v_clean_code,
      v_clean_isin,
      v_default_face_value,
      'RBB Merchant Banking Limited',
      'Active'
    )
    ON CONFLICT (company_code) DO UPDATE SET 
      company_name = EXCLUDED.company_name,
      isin = COALESCE(public.companies.isin, EXCLUDED.isin),
      face_value = COALESCE(public.companies.face_value, EXCLUDED.face_value),
      registrar = COALESCE(public.companies.registrar, EXCLUDED.registrar)
    RETURNING id INTO v_company_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'company_id', v_company_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_upsert_company(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_company(text, text, text) TO service_role;

-- 4. Backfill any existing companies with missing face_value or registrar
UPDATE public.companies
SET face_value = CASE 
      WHEN company_type ILIKE '%debenture%' OR company_name ILIKE '%debenture%' THEN 1000
      WHEN company_type ILIKE '%mutual fund%' OR company_name ILIKE '%mutual fund%' THEN 10
      ELSE 100
    END
WHERE face_value IS NULL OR face_value <= 0;

UPDATE public.companies
SET registrar = 'RBB Merchant Banking Limited'
WHERE registrar IS NULL OR trim(registrar) = '';

COMMIT;
