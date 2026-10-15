-- ============================================================================
-- Migration: 20261015000001_postgres_best_practices_hardening.sql
-- Description: Postgres Best Practices Hardening (Supabase)
-- 1. Index unindexed foreign keys (eliminate seq scans on joins & cascades)
-- 2. Add composite indexes for high-frequency queries
-- 3. Remove redundant duplicate indexes to reclaim cache & reduce write overhead
-- 4. Optimize RLS policies by wrapping auth.uid() in scalar (SELECT auth.uid())
-- 5. Tune autovacuum scale factors for high-churn financial tables
-- ============================================================================

-- ============================================================================
-- Section 1: Foreign Key Indexes (schema-foreign-key-indexes.md)
-- ============================================================================

-- Uploads and error tracking
CREATE INDEX IF NOT EXISTS idx_mutual_fund_payables_upload_id ON public.mutual_fund_payables (upload_id);
CREATE INDEX IF NOT EXISTS idx_dividend_payables_upload_id ON public.dividend_payables (upload_id);
CREATE INDEX IF NOT EXISTS idx_interest_payables_upload_id ON public.interest_payables (upload_id);
CREATE INDEX IF NOT EXISTS idx_upload_errors_upload_id ON public.upload_errors (upload_id);
CREATE INDEX IF NOT EXISTS idx_upload_history_user_id ON public.upload_history (user_id);

-- Payments and logs
CREATE INDEX IF NOT EXISTS idx_payments_processed_by ON public.payments (processed_by);
CREATE INDEX IF NOT EXISTS idx_payments_approved_by ON public.payments (approved_by);
CREATE INDEX IF NOT EXISTS idx_payments_reversed_by ON public.payments (reversed_by);
CREATE INDEX IF NOT EXISTS idx_payments_created_by ON public.payments (created_by);
CREATE INDEX IF NOT EXISTS idx_payment_batches_created_by ON public.payment_batches (created_by);
CREATE INDEX IF NOT EXISTS idx_payment_batches_approved_by ON public.payment_batches (approved_by);
CREATE INDEX IF NOT EXISTS idx_payment_logs_payment_id ON public.payment_logs (payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_logs_performed_by ON public.payment_logs (performed_by);

-- Approvals
CREATE INDEX IF NOT EXISTS idx_pending_approvals_requested_by ON public.pending_approvals (requested_by);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_reviewed_by ON public.pending_approvals (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_approval_logs_approval_id ON public.approval_logs (approval_id);
CREATE INDEX IF NOT EXISTS idx_approval_logs_performed_by ON public.approval_logs (performed_by);

-- Reconciliation
CREATE INDEX IF NOT EXISTS idx_reconciliation_results_batch_id ON public.reconciliation_results (batch_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_results_matched_by ON public.reconciliation_results (matched_by);

-- Bank statements
CREATE INDEX IF NOT EXISTS idx_bank_statements_uploaded_by ON public.bank_statements (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_uploaded_by ON public.bank_transactions (uploaded_by);

-- IAF Allocations and metadata
CREATE INDEX IF NOT EXISTS idx_iaf_allocations_company_id ON public.iaf_allocations (company_id);
CREATE INDEX IF NOT EXISTS idx_iaf_allocations_created_by ON public.iaf_allocations (created_by);

-- Clients & payables audit creators
CREATE INDEX IF NOT EXISTS idx_clients_created_by ON public.clients (created_by);
CREATE INDEX IF NOT EXISTS idx_dividend_payables_created_by ON public.dividend_payables (created_by);
CREATE INDEX IF NOT EXISTS idx_interest_payables_created_by ON public.interest_payables (created_by);
CREATE INDEX IF NOT EXISTS idx_mutual_fund_payables_created_by ON public.mutual_fund_payables (created_by);

-- System logs and settings
CREATE INDEX IF NOT EXISTS idx_api_logs_user_id ON public.api_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_user_id ON public.error_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_login_logs_user_id ON public.login_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_system_settings_updated_by ON public.system_settings (updated_by);


-- ============================================================================
-- Section 2: Composite Indexes for Multi-Column Hotpaths (query-composite-indexes.md)
-- ============================================================================

-- Dividend Payables query hotpaths
CREATE INDEX IF NOT EXISTS idx_dividend_payables_comp_status_created 
  ON public.dividend_payables (company_id, payment_status, created_at);

CREATE INDEX IF NOT EXISTS idx_dividend_payables_comp_lookup 
  ON public.dividend_payables (company_id, fiscal_year, payment_status);

CREATE INDEX IF NOT EXISTS idx_dividend_payables_comp_client 
  ON public.dividend_payables (company_id, client_id);

-- Interest Payables query hotpaths
CREATE INDEX IF NOT EXISTS idx_interest_payables_comp_status_created 
  ON public.interest_payables (company_id, payment_status, created_at);

CREATE INDEX IF NOT EXISTS idx_interest_payables_comp_lookup 
  ON public.interest_payables (company_id, fiscal_year, payment_status);

CREATE INDEX IF NOT EXISTS idx_interest_payables_comp_client 
  ON public.interest_payables (company_id, client_id);

-- Reconciliation Results company + date hotpath
CREATE INDEX IF NOT EXISTS idx_reconciliation_results_comp_lookup
  ON public.reconciliation_results (company_id, reconciliation_date, result);


-- ============================================================================
-- Section 3: Remove Redundant Exact Duplicate Indexes (query-index-types.md)
-- ============================================================================

-- Drop identical duplicates that duplicate preexisting indexes
DROP INDEX IF EXISTS public.idx_mutual_fund_status;
DROP INDEX IF EXISTS public.idx_interest_status;
DROP INDEX IF EXISTS public.idx_payments_batch;
DROP INDEX IF EXISTS public.idx_reconciliation_company_id;
DROP INDEX IF EXISTS public.idx_recon_date;
DROP INDEX IF EXISTS public.idx_clients_boid;
DROP INDEX IF EXISTS public.uq_user_company_access;


-- ============================================================================
-- Section 4: RLS Policy Performance Hardening (security-rls-performance.md)
-- Wrap auth.uid() in (SELECT auth.uid()) to avoid row-by-row re-evaluation
-- ============================================================================

-- 4.1 mutual_fund_payables
DROP POLICY IF EXISTS mfp_delete ON public.mutual_fund_payables;
CREATE POLICY mfp_delete ON public.mutual_fund_payables 
  FOR DELETE TO authenticated 
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS mfp_update ON public.mutual_fund_payables;
CREATE POLICY mfp_update ON public.mutual_fund_payables 
  FOR UPDATE TO authenticated 
  USING (public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));

DROP POLICY IF EXISTS mfp_write ON public.mutual_fund_payables;
CREATE POLICY mfp_write ON public.mutual_fund_payables 
  FOR INSERT TO authenticated 
  WITH CHECK (public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));

-- 4.2 dividend_payables
DROP POLICY IF EXISTS dp_delete ON public.dividend_payables;
CREATE POLICY dp_delete ON public.dividend_payables 
  FOR DELETE TO authenticated 
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS dp_update ON public.dividend_payables;
CREATE POLICY dp_update ON public.dividend_payables 
  FOR UPDATE TO authenticated 
  USING (public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));

DROP POLICY IF EXISTS dp_write ON public.dividend_payables;
CREATE POLICY dp_write ON public.dividend_payables 
  FOR INSERT TO authenticated 
  WITH CHECK (public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));

-- 4.3 interest_payables
DROP POLICY IF EXISTS ip_delete ON public.interest_payables;
CREATE POLICY ip_delete ON public.interest_payables 
  FOR DELETE TO authenticated 
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS ip_update ON public.interest_payables;
CREATE POLICY ip_update ON public.interest_payables 
  FOR UPDATE TO authenticated 
  USING (public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));

DROP POLICY IF EXISTS ip_write ON public.interest_payables;
CREATE POLICY ip_write ON public.interest_payables 
  FOR INSERT TO authenticated 
  WITH CHECK (public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));

-- 4.4 payments
DROP POLICY IF EXISTS payments_delete ON public.payments;
CREATE POLICY payments_delete ON public.payments 
  FOR DELETE TO authenticated 
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS pay_update ON public.payments;
CREATE POLICY pay_update ON public.payments 
  FOR UPDATE TO authenticated 
  USING (public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role, 'reconciliation_officer'::public.app_role]));

DROP POLICY IF EXISTS pay_write ON public.payments;
CREATE POLICY pay_write ON public.payments 
  FOR INSERT TO authenticated 
  WITH CHECK (public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role, 'reconciliation_officer'::public.app_role]));

-- 4.5 upload_history & upload_errors
DROP POLICY IF EXISTS uh_delete ON public.upload_history;
CREATE POLICY uh_delete ON public.upload_history 
  FOR DELETE TO authenticated 
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS uh_read ON public.upload_history;
CREATE POLICY uh_read ON public.upload_history 
  FOR SELECT TO authenticated 
  USING ((user_id = (SELECT auth.uid())) OR (user_id IS NULL) OR public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));

DROP POLICY IF EXISTS uh_update ON public.upload_history;
CREATE POLICY uh_update ON public.upload_history 
  FOR UPDATE TO authenticated 
  USING ((user_id IS NULL) OR (user_id = (SELECT auth.uid())) OR public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));

DROP POLICY IF EXISTS uh_write ON public.upload_history;
CREATE POLICY uh_write ON public.upload_history 
  FOR INSERT TO authenticated 
  WITH CHECK ((user_id = (SELECT auth.uid())) OR (user_id IS NULL) OR public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));

DROP POLICY IF EXISTS ue_delete ON public.upload_errors;
CREATE POLICY ue_delete ON public.upload_errors 
  FOR DELETE TO authenticated 
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS ue_read ON public.upload_errors;
CREATE POLICY ue_read ON public.upload_errors 
  FOR SELECT TO authenticated 
  USING (
    (upload_id IN (SELECT upload_history.id FROM public.upload_history WHERE upload_history.user_id = (SELECT auth.uid())))
    OR public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role])
  );

DROP POLICY IF EXISTS ue_write ON public.upload_errors;
CREATE POLICY ue_write ON public.upload_errors 
  FOR INSERT TO authenticated 
  WITH CHECK (
    (upload_id IN (SELECT upload_history.id FROM public.upload_history WHERE upload_history.user_id = (SELECT auth.uid())))
    OR public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role])
  );


-- ============================================================================
-- Section 5: Autovacuum Tuning for High-Churn Tables (monitor-vacuum-analyze.md)
-- Vacuum at 5% dead tuples (default 20%), analyze at 2% changes (default 10%)
-- ============================================================================

ALTER TABLE public.upload_history SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.mutual_fund_payables SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.dividend_payables SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.interest_payables SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.payments SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.reconciliation_results SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.bank_transactions SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);


-- ============================================================================
-- Section 6: Refresh Statistics (monitor-vacuum-analyze.md)
-- ============================================================================

ANALYZE public.clients;
ANALYZE public.mutual_fund_payables;
ANALYZE public.dividend_payables;
ANALYZE public.interest_payables;
ANALYZE public.payments;
ANALYZE public.payment_batches;
ANALYZE public.reconciliation_results;
ANALYZE public.upload_history;
ANALYZE public.upload_errors;
