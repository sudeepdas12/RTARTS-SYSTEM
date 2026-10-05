-- =========================================================
-- Expand payment_batch_status enum to include maker-checker workflow statuses
-- =========================================================

DO $$ BEGIN
  ALTER TYPE payment_batch_status ADD VALUE IF NOT EXISTS 'Pending';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE payment_batch_status ADD VALUE IF NOT EXISTS 'Rejected';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE payment_batch_status ADD VALUE IF NOT EXISTS 'Returned';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
