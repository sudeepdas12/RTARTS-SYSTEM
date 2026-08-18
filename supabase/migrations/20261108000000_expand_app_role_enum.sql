-- =========================================================
-- Expand the app_role enum to match the application RBAC roles.
-- The UI / rbac-service use a richer set of roles. Adding them here
-- keeps existing rows valid while allowing the new roles to be assigned.
-- =========================================================
DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'supervisor';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'operator';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'maker';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'checker';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'approver';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'read_only';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;