-- Migration: Deduplicate dividend_payables records from accidental multiple AGM runs and enforce uniqueness
BEGIN;

-- 1. Pause audit trigger to avoid 335,000+ individual audit log rows
ALTER TABLE public.dividend_payables DISABLE TRIGGER trg_audit_dp;

-- 2. Delete redundant duplicates, keeping the earliest record (rn = 1) per (client_id, company_id, fiscal_year, remarks)
DELETE FROM public.dividend_payables
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY client_id, company_id, fiscal_year, remarks
             ORDER BY created_at ASC, id ASC
           ) as rn
    FROM public.dividend_payables
  ) sub
  WHERE sub.rn > 1
);

-- 3. Re-enable audit trigger
ALTER TABLE public.dividend_payables ENABLE TRIGGER trg_audit_dp;

-- 4. Add unique index so future runs cannot insert duplicate payable records
CREATE UNIQUE INDEX IF NOT EXISTS uq_dividend_payables_client_fy_remarks
ON public.dividend_payables (client_id, company_id, fiscal_year, COALESCE(remarks, ''));

-- 5. Record a single summary audit log entry
INSERT INTO public.audit_logs (
  table_name,
  action,
  new_value,
  action_time
) VALUES (
  'dividend_payables',
  'BULK_DEDUPLICATION_AND_UNIQUE_INDEX',
  jsonb_build_object(
    'description', 'Deduplicated historical duplicate dividend payable records and added unique constraint',
    'timestamp', now()
  ),
  now()
);

COMMIT;
