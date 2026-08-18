-- =========================================================
-- Add missing stock dividend columns to dividend_payables
-- =========================================================
ALTER TABLE public.dividend_payables
  ADD COLUMN IF NOT EXISTS bonus_actual NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_issued NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_fraction NUMERIC(15,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS after_bonus_kitta NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_tax NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lot_name TEXT;

-- =========================================================
-- Company upsert RPC (bypasses RLS for company creation)
-- =========================================================
CREATE OR REPLACE FUNCTION public.bulk_upsert_company(
  p_company_name text,
  p_company_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  -- Try to find existing company by name
  SELECT id INTO v_company_id FROM public.companies
  WHERE company_name ILIKE '%' || p_company_name || '%'
  LIMIT 1;

  -- If not found, create it
  IF v_company_id IS NULL THEN
    INSERT INTO public.companies (company_name, company_code, status)
    VALUES (p_company_name, p_company_code, 'Active')
    ON CONFLICT (company_code) DO UPDATE SET company_name = EXCLUDED.company_name
    RETURNING id INTO v_company_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'company_id', v_company_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_upsert_company(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_company(text, text) TO service_role;