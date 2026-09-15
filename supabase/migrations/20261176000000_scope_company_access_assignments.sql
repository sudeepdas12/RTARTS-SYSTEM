-- Migration: 20261176000000_scope_company_access_assignments.sql
-- Description:
-- Prevent indiscriminate global cross-join seeding for future or non-admin accounts.
-- Clarifies that user_company_access is strictly for non-admin company assignments,
-- while system administrators and supervisors inherently have universal company access.

BEGIN;

-- 1. Remove duplicate or orphaned user_company_access entries if user is already admin or supervisor
DELETE FROM public.user_company_access uca
WHERE EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = uca.user_id
    AND ur.role IN ('admin'::public.app_role, 'supervisor'::public.app_role)
);

-- 2. Ensure user_company_access has unique constraint on (user_id, company_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_company_access ON public.user_company_access (user_id, company_id);

COMMIT;
