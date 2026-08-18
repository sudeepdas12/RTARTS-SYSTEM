-- =========================================================
-- Secure SMTP settings: prevent non-admin users from reading
-- the stored SMTP password directly from system_settings.
-- =========================================================

-- 1) Helper: strip the smtp_pass key from a setting value.
CREATE OR REPLACE FUNCTION public.mask_smtp_secrets(j jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE WHEN j IS NULL THEN NULL ELSE j - 'smtp_pass' END;
$$;

-- 2) Safe view for application reads: admins see full settings,
--    everyone else gets the SMTP password masked out.
DROP VIEW IF EXISTS public.system_settings_safe;
CREATE VIEW public.system_settings_safe AS
SELECT
  id,
  setting_key,
  CASE
    WHEN public.has_role(auth.uid(), 'admin') THEN setting_value
    ELSE public.mask_smtp_secrets(setting_value)
  END AS setting_value,
  description,
  updated_by,
  created_at,
  updated_at
FROM public.system_settings;

GRANT SELECT ON public.system_settings_safe TO authenticated;

-- 3) The raw table is now admin-only for reads; the safe view
--    above is used by all client-side application reads.
DROP POLICY IF EXISTS ss_read ON public.system_settings;
CREATE POLICY ss_read_admin ON public.system_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
