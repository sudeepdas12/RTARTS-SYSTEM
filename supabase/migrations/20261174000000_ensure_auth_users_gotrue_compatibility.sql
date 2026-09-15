-- Migration: 20261174000000_ensure_auth_users_gotrue_compatibility.sql
-- Description:
-- GoTrue (Supabase Auth) scanners expect non-null values for string token fields on auth.users.
-- Ensure all existing users and future seeded users do not have NULL token strings.

BEGIN;

-- 1. Clean existing records in auth.users
UPDATE auth.users
SET
  aud = COALESCE(NULLIF(aud, ''), 'authenticated'),
  role = COALESCE(NULLIF(role, ''), 'authenticated'),
  email_change = COALESCE(email_change, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  recovery_token = COALESCE(recovery_token, ''),
  confirmation_token = COALESCE(confirmation_token, ''),
  reauthentication_token = COALESCE(reauthentication_token, ''),
  phone_change = COALESCE(phone_change, ''),
  phone_change_token = COALESCE(phone_change_token, '')
WHERE confirmation_token IS NULL
   OR recovery_token IS NULL
   OR email_change_token_new IS NULL
   OR email_change_token_current IS NULL
   OR email_change IS NULL
   OR reauthentication_token IS NULL
   OR phone_change IS NULL
   OR phone_change_token IS NULL;

-- 2. Clean trigger function in public schema that can be applied to auth.users if needed
CREATE OR REPLACE FUNCTION public.clean_auth_user_tokens()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.aud := COALESCE(NULLIF(NEW.aud, ''), 'authenticated');
  NEW.role := COALESCE(NULLIF(NEW.role, ''), 'authenticated');
  NEW.email_change := COALESCE(NEW.email_change, '');
  NEW.email_change_token_new := COALESCE(NEW.email_change_token_new, '');
  NEW.email_change_token_current := COALESCE(NEW.email_change_token_current, '');
  NEW.recovery_token := COALESCE(NEW.recovery_token, '');
  NEW.confirmation_token := COALESCE(NEW.confirmation_token, '');
  NEW.reauthentication_token := COALESCE(NEW.reauthentication_token, '');
  NEW.phone_change := COALESCE(NEW.phone_change, '');
  NEW.phone_change_token := COALESCE(NEW.phone_change_token, '');
  RETURN NEW;
END;
$$;

COMMIT;
