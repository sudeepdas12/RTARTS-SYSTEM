-- =============================================================================
-- Replace get_cron_secret() minimum entropy validation without embedding any
-- legacy static secret literal in the active function definition.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_cron_secret()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_secret text;
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin')
     AND COALESCE(v_jwt_role, '') <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: cron secret is internal-only' USING ERRCODE = '42501';
  END IF;

  v_secret := NULLIF(current_setting('app.settings.cron_secret', true), '');
  IF v_secret IS NOT NULL AND length(v_secret) >= 32 THEN
    RETURN v_secret;
  END IF;

  SELECT NULLIF(setting_value->>'secret', '') INTO v_secret
  FROM public.system_settings
  WHERE setting_key = 'cron_secret'
  LIMIT 1;

  -- Require high-entropy 32+ char secret (generated via 32-byte random hex = 64 chars)
  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RAISE EXCEPTION 'app.settings.cron_secret is not configured securely' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.get_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_secret() TO service_role;
