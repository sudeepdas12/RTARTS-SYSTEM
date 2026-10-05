-- Update bulk_upsert_company to accept and store p_isin

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
BEGIN
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
    -- 5. If not found, create new company with the ISIN
    INSERT INTO public.companies (company_name, company_code, isin, status)
    VALUES (v_clean_name, v_clean_code, v_clean_isin, 'Active')
    ON CONFLICT (company_code) DO UPDATE SET 
      company_name = EXCLUDED.company_name,
      isin = COALESCE(public.companies.isin, EXCLUDED.isin)
    RETURNING id INTO v_company_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'company_id', v_company_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_upsert_company(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_company(text, text, text) TO service_role;