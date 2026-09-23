-- Migration: Backfill days_count for interest_payables
UPDATE public.interest_payables
SET days_count = 183
WHERE days_count IS NULL
  AND company_id = '389b302c-09b3-46bc-9112-ce88fa94f8b1';

UPDATE public.interest_payables
SET days_count = 183
WHERE days_count IS NULL;
