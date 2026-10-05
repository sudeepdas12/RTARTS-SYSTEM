-- Migration: 20261211000000_add_client_needs_review_flag.sql
-- Adds needs_review + data_quality_notes to clients for upload-error tracking
-- and a helper function to auto-normalize 10-digit NID numbers.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add needs_review flag and notes column to clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS needs_review       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_quality_notes text    DEFAULT null;

-- 2. Index for fast filtered queries
CREATE INDEX IF NOT EXISTS idx_clients_needs_review
  ON public.clients (needs_review)
  WHERE needs_review = true;

-- 3. Auto-flag existing clients that are missing a bank account
UPDATE public.clients
SET
  needs_review = true,
  data_quality_notes = COALESCE(data_quality_notes || '; ', '') || 'missing_bank_account'
WHERE (bank_account_no IS NULL OR bank_account_no = '')
  AND needs_review = false;

-- 4. Auto-normalize existing 10-digit NID numbers to 11 digits (leading zero)
UPDATE public.clients
SET
  nid_number = LPAD(nid_number, 11, '0'),
  needs_review = CASE
    WHEN (bank_account_no IS NULL OR bank_account_no = '') THEN true
    ELSE needs_review
  END
WHERE nid_number ~ '^[0-9]{10}$';

-- 5. Grant access (same as existing table grants)
GRANT SELECT, UPDATE ON public.clients TO authenticated;
GRANT SELECT, UPDATE ON public.clients TO service_role;

-- 6. Trigger: auto-set needs_review when bank_account_no is null
CREATE OR REPLACE FUNCTION public.trg_clients_set_needs_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Auto-flag rows missing bank account
  IF (NEW.bank_account_no IS NULL OR NEW.bank_account_no = '') THEN
    NEW.needs_review := true;
    NEW.data_quality_notes := COALESCE(NEW.data_quality_notes, '') ||
      CASE WHEN NEW.data_quality_notes IS NOT NULL AND NEW.data_quality_notes != ''
        THEN '; missing_bank_account'
        ELSE 'missing_bank_account'
      END;
  END IF;

  -- Auto-normalize 10-digit NID to 11 digits
  IF NEW.nid_number IS NOT NULL AND NEW.nid_number ~ '^[0-9]{10}$' THEN
    NEW.nid_number := LPAD(NEW.nid_number, 11, '0');
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_clients_needs_review
  BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.trg_clients_set_needs_review();

COMMENT ON COLUMN public.clients.needs_review IS
  'True when the client record has data quality issues that need manual review (missing bank account, invalid NID, etc.)';
COMMENT ON COLUMN public.clients.data_quality_notes IS
  'Semicolon-separated list of data quality issue codes (e.g. missing_bank_account, invalid_nid).';
