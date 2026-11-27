-- =============================================================================
-- Migration: Default payment_batches.created_by to auth.uid() for Maker-Checker
-- =============================================================================

ALTER TABLE public.payment_batches
  ALTER COLUMN created_by SET DEFAULT auth.uid();
