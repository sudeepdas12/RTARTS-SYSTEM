-- Migration: 20261210000000_add_schema_alignment_reporting_views.sql
-- Description: Creates backward-compatible reporting views for upload_logs and reconciliation_lots

-- 1. upload_logs compatibility view mapping to upload_history
CREATE OR REPLACE VIEW public.upload_logs AS
SELECT 
  id,
  user_id,
  file_name,
  file_size,
  file_hash,
  file_type,
  file_type AS upload_type,
  sheet_name,
  total_rows,
  success_rows,
  error_rows,
  target_table,
  status,
  error_message,
  started_at,
  completed_at,
  created_at
FROM public.upload_history;

COMMENT ON VIEW public.upload_logs IS 'Compatibility view mapping legacy upload_logs queries to public.upload_history';

GRANT SELECT ON public.upload_logs TO authenticated;
GRANT SELECT ON public.upload_logs TO service_role;
GRANT SELECT ON public.upload_logs TO anon;

-- 2. reconciliation_lots compatibility view mapping to reconciliation_results
CREATE OR REPLACE VIEW public.reconciliation_lots AS
SELECT 
  id,
  reconciliation_date,
  client_id,
  company_id,
  payable_type,
  payable_id,
  expected_amount,
  actual_amount,
  difference,
  result,
  result::text AS status,
  notes,
  matched_by,
  matched_at,
  created_at,
  fiscal_year,
  payment_id,
  batch_id
FROM public.reconciliation_results;

COMMENT ON VIEW public.reconciliation_lots IS 'Compatibility view mapping legacy reconciliation_lots queries to public.reconciliation_results';

GRANT SELECT ON public.reconciliation_lots TO authenticated;
GRANT SELECT ON public.reconciliation_lots TO service_role;
GRANT SELECT ON public.reconciliation_lots TO anon;
