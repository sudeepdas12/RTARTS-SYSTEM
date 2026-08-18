-- =========================================================
-- Align dividend_payables with the bulk import contract
-- =========================================================
-- Root cause: the base dividend_payables table (20260721) and every
-- migration in the repository never add `bank_name` / `bank_account_no`,
-- while `bulk_insert_dividend_payables` (redefined in 20260824) and the
-- import service / process-import-chunk edge function emit BOTH of these
-- fields for every dividend payable row.
--
-- On a clean `supabase db reset` the bonus_* / lot_name columns land
-- (added by 20260822) and tds_rate lands (added by 20260824), but the two
-- bank columns never get added anywhere. Each payable row then raised:
--     ERROR: column "bank_name" of relation "dividend_payables" does not exist
-- which was swallowed by the RPC's per-row `EXCEPTION WHEN OTHERS` handler
-- and surfaced only as:
--     "Payable import completed without inserting any rows."
--
-- This migration closes that gap so the Dividend (Sheet1) import succeeds
-- on a clean database. IF NOT EXISTS makes it safe on schemas that
-- already carry these columns.
-- =========================================================

ALTER TABLE public.dividend_payables
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_no TEXT;

-- Re-assert table privileges (matches the grants in the base migration).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dividend_payables TO authenticated;
GRANT ALL ON public.dividend_payables TO service_role;
