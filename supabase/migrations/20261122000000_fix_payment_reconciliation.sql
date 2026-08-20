-- =========================================================
-- Migration: Fix Payment Batches and Reconciliation ENUMs
-- =========================================================

-- 1. Add missing columns to payment_batches
ALTER TABLE public.payment_batches
  ADD COLUMN IF NOT EXISTS total_tax NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS cds_batch_ref TEXT,
  ADD COLUMN IF NOT EXISTS registrar TEXT;

-- 2. Extend reconciliation_result ENUM safely if values do not exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'reconciliation_result' AND e.enumlabel = 'Pledged'
  ) THEN
    ALTER TYPE public.reconciliation_result ADD VALUE 'Pledged';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'reconciliation_result' AND e.enumlabel = 'Rejected'
  ) THEN
    ALTER TYPE public.reconciliation_result ADD VALUE 'Rejected';
  END IF;
END $$;
