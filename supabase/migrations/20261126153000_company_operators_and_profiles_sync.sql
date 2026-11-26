-- =============================================================================
-- Migration: Company Operator Directory RPC & Missing Profiles Backfill
-- =============================================================================

-- 1. Backfill any existing auth.users missing a public.profiles row
INSERT INTO public.profiles (id, email, full_name)
SELECT
  u.id,
  u.email,
  COALESCE(
    NULLIF(trim(u.raw_user_meta_data->>'full_name'), ''),
    split_part(COALESCE(u.email, u.id::text), '@', 1)
  )
FROM auth.users u
WHERE u.email IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- 2. RPC: List distinct authorized operators / makers / checkers for a company
CREATE OR REPLACE FUNCTION public.get_company_operators(p_company_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, full_name text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_is_service_role boolean;
  v_uid uuid;
BEGIN
  v_is_service_role := (
    current_user IN ('service_role', 'postgres')
    OR COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') = 'service_role'
  );

  IF NOT v_is_service_role THEN
    PERFORM public.require_role(
      'admin', 'supervisor', 'finance_operator', 'reconciliation_officer',
      'auditor', 'checker', 'approver', 'maker', 'operator'
    );
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'Authenticated session required' USING ERRCODE = '42501';
    END IF;
    IF p_company_id IS NOT NULL AND NOT public.has_company_access(v_uid, p_company_id) THEN
      RAISE EXCEPTION 'Forbidden: caller lacks access to company %', p_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    u.id,
    COALESCE(
      NULLIF(trim(p.full_name), ''),
      NULLIF(trim(u.raw_user_meta_data->>'full_name'), ''),
      split_part(COALESCE(u.email, u.id::text), '@', 1)
    )::text AS full_name,
    COALESCE(u.email, '')::text AS email
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = u.id
        AND ur.role IN ('admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role)
    )
    OR (
      p_company_id IS NULL AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id)
    )
    OR (
      p_company_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.user_company_access uca
        WHERE uca.user_id = u.id AND uca.company_id = p_company_id
      )
    )
  )
  ORDER BY full_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_operators(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_operators(uuid) TO authenticated, service_role;
