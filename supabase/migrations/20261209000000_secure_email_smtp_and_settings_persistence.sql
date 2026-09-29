-- =========================================================
-- Migration: 20261209000000_secure_email_smtp_and_settings_persistence.sql
-- Description:
-- 1. Updates mask_smtp_secrets to indicate whether smtp_pass is configured
--    without leaking plaintext passwords.
-- 2. Adds save_system_settings_global RPC to safely merge settings and preserve
--    existing secrets (smtp_pass, connectips_token, connectips_cert_pass)
--    when blank or placeholder values are submitted.
-- =========================================================

-- 1) Update mask_smtp_secrets: strips plaintext passwords/secrets, but returns configured flags
CREATE OR REPLACE FUNCTION public.mask_smtp_secrets(j jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE 
    WHEN j IS NULL THEN NULL 
    ELSE (j - 'smtp_pass' - 'sms_api_key') 
         || jsonb_build_object(
              'smtp_pass_configured', COALESCE(j->>'smtp_pass', '') <> '',
              'sms_api_key_configured', COALESCE(j->>'sms_api_key', '') <> ''
            )
  END;
$$;

-- 2) Re-create system_settings_safe with security_invoker = true
DROP VIEW IF EXISTS public.system_settings_safe;
CREATE VIEW public.system_settings_safe 
WITH (security_invoker = true)
AS
SELECT
  id,
  setting_key,
  CASE
    WHEN public.has_role(auth.uid(), 'admin') THEN 
      -- Even for admins, mask the plaintext secrets for frontend reads,
      -- while explicitly signaling smtp_pass_configured and sms_api_key_configured
      public.mask_smtp_secrets(setting_value)
    ELSE 
      public.mask_smtp_secrets(setting_value)
  END AS setting_value,
  description,
  updated_by,
  created_at,
  updated_at
FROM public.system_settings;

GRANT SELECT ON public.system_settings_safe TO authenticated;

-- 3) Atomic save_system_settings_global RPC:
-- Merges incoming JSON with existing system_settings.global,
-- protecting existing secrets from being overwritten by blank/masked values.
CREATE OR REPLACE FUNCTION public.save_system_settings_global(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing jsonb;
  v_merged jsonb;
  v_is_admin boolean;
BEGIN
  -- Verify caller is admin, postgres, or service_role
  v_is_admin := (current_user IN ('postgres', 'service_role')) OR (auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin'));
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to update system settings.';
  END IF;

  SELECT setting_value INTO v_existing
  FROM public.system_settings
  WHERE setting_key = 'global';

  v_merged := COALESCE(v_existing, '{}'::jsonb) || p_settings;

  -- 1) Preserve smtp_pass if not provided, empty, or placeholder
  IF (COALESCE(p_settings->>'smtp_pass', '') = '' OR p_settings->>'smtp_pass' = '••••••••••••') 
     AND COALESCE(v_existing->>'smtp_pass', '') <> '' THEN
    v_merged := jsonb_set(v_merged, '{smtp_pass}', v_existing->'smtp_pass');
  END IF;

  -- 2) Preserve connectips_token if not provided, empty, or placeholder
  IF (COALESCE(p_settings->>'connectips_token', '') = '' OR p_settings->>'connectips_token' = '••••••••••••')
     AND COALESCE(v_existing->>'connectips_token', '') <> '' THEN
    v_merged := jsonb_set(v_merged, '{connectips_token}', v_existing->'connectips_token');
  END IF;

  -- 3) Preserve connectips_cert_pass if not provided, empty, or placeholder
  IF (COALESCE(p_settings->>'connectips_cert_pass', '') = '' OR p_settings->>'connectips_cert_pass' = '••••••••••••')
     AND COALESCE(v_existing->>'connectips_cert_pass', '') <> '' THEN
    v_merged := jsonb_set(v_merged, '{connectips_cert_pass}', v_existing->'connectips_cert_pass');
  END IF;

  -- 4) Preserve sms_api_key if not provided, empty, or placeholder
  IF (COALESCE(p_settings->>'sms_api_key', '') = '' OR p_settings->>'sms_api_key' = '••••••••••••') 
     AND COALESCE(v_existing->>'sms_api_key', '') <> '' THEN
    v_merged := jsonb_set(v_merged, '{sms_api_key}', v_existing->'sms_api_key');
  END IF;

  -- Remove transient frontend flags before saving to raw setting_value
  v_merged := (v_merged - 'smtp_pass_configured') - 'sms_api_key_configured';

  INSERT INTO public.system_settings (setting_key, setting_value, updated_at)
  VALUES ('global', v_merged, now())
  ON CONFLICT (setting_key)
  DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now();

  RETURN v_merged;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_system_settings_global(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_system_settings_global(jsonb) TO service_role;
