-- Migration: 20261206000000_grant_rollback_upload_permissions.sql
-- Ensure EXECUTE privilege is granted on rollback_upload_atomic and rollback_upload_file_atomic

GRANT EXECUTE ON FUNCTION public.rollback_upload_atomic(uuid, uuid) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.rollback_upload_file_atomic(text, text, uuid) TO authenticated, service_role, anon;
