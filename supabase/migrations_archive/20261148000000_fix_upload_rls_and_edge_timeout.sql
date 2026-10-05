-- ============================================================================
-- Migration: 20261148000000_fix_upload_rls_and_edge_timeout.sql
-- Description:
--   Fixes the upload pipeline so it works reliably regardless of whether
--   the edge runtime is running or not.
--
--   Problems fixed:
--   1. upload_history INSERT policy: (user_id = auth.uid())
--      If user_id is absent (race/brief session gap), RLS blocks the INSERT
--      → "Failed to create upload record" → entire upload aborted.
--      Fix: auto-fill user_id via BEFORE INSERT trigger and allow NULL.
--
--   2. upload_history UPDATE policy: (user_id = auth.uid())
--      Chunk processor calls updateUploadStatus() after upload completes.
--      After a token refresh the uid may differ → silently fails → upload
--      stuck in "Processing" state forever.
--      Fix: allow updates by owner, or admin/finance_operator role.
-- ============================================================================

-- 1. Auto-fill user_id on INSERT from auth.uid()
CREATE OR REPLACE FUNCTION public.set_upload_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_upload_history_set_user ON public.upload_history;
CREATE TRIGGER trg_upload_history_set_user
  BEFORE INSERT ON public.upload_history
  FOR EACH ROW
  EXECUTE FUNCTION public.set_upload_user_id();

-- 2. Fix INSERT policy: allow any authenticated user to insert
ALTER TABLE public.upload_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uh_write ON public.upload_history;
CREATE POLICY uh_write ON public.upload_history
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 3. Fix UPDATE policy: allow update if user owns the record OR user_id is NULL
--    OR caller has admin/finance_operator role (for background chunk updates)
DROP POLICY IF EXISTS uh_update ON public.upload_history;
CREATE POLICY uh_update ON public.upload_history
  FOR UPDATE
  TO authenticated
  USING (
    user_id IS NULL
    OR user_id = auth.uid()
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'finance_operator'::app_role])
  );

-- 4. Grant execute on the trigger function
GRANT EXECUTE ON FUNCTION public.set_upload_user_id() TO authenticated, service_role;
