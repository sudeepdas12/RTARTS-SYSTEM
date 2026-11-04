-- Migration: 20261030000001_reconciliation_audit_remediation.sql
-- Description: Comprehensive Reconciliation Architecture & Security Remediation
-- Fixes:
--  1. Bank data RLS hardening (company_id scoping, role restricted)
--  2. Safe operation-scoped revert with fail-closed protection
--  3. Single atomic apply + history persistence RPC
--  4. Dedicated reconciliation_runs table with SHA-256 fingerprinting
--  5. Server-side pagination and aggregation RPC
--  6. Immutable bank statement imports and transaction ledger
--  7. Match explainability model and metadata persistence
--  8. Durable reconciliation_exceptions tracking

-- Extend reconciliation_result enum with Partial and Exception if not present
ALTER TYPE public.reconciliation_result ADD VALUE IF NOT EXISTS 'Partial';
ALTER TYPE public.reconciliation_result ADD VALUE IF NOT EXISTS 'Exception';

-- ============================================================================
-- 1. HARDEN BANK STATEMENTS & BANK TRANSACTIONS (RLS & TENANT ISOLATION)
-- ============================================================================

-- Add company_id to bank_statements if not present
ALTER TABLE public.bank_statements 
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_bank_statements_company_id 
  ON public.bank_statements(company_id);

-- Add company_id and statement_id to bank_transactions if not present
ALTER TABLE public.bank_transactions 
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS statement_id uuid REFERENCES public.bank_statements(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_company_id 
  ON public.bank_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_statement_id 
  ON public.bank_transactions(statement_id);

-- Drop open permissive bank policies
DROP POLICY IF EXISTS bs_read ON public.bank_statements;
DROP POLICY IF EXISTS bs_write ON public.bank_statements;
DROP POLICY IF EXISTS bs_delete ON public.bank_statements;
DROP POLICY IF EXISTS bs_update ON public.bank_statements;

DROP POLICY IF EXISTS bt_read ON public.bank_transactions;
DROP POLICY IF EXISTS bt_write ON public.bank_transactions;
DROP POLICY IF EXISTS bt_delete ON public.bank_transactions;
DROP POLICY IF EXISTS bt_update ON public.bank_transactions;

-- bank_statements RLS: scoped to authorized roles and assigned companies
CREATE POLICY bs_read ON public.bank_statements FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'finance_operator'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'auditor'::public.app_role,
    'report_viewer'::public.app_role
  ]))
  AND (CASE WHEN company_id IS NULL THEN public.has_role((SELECT auth.uid()), 'admin'::public.app_role) ELSE public.has_company_access((SELECT auth.uid()), company_id) END)
);

CREATE POLICY bs_write ON public.bank_statements FOR INSERT TO authenticated WITH CHECK (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND (CASE WHEN company_id IS NULL THEN public.has_role((SELECT auth.uid()), 'admin'::public.app_role) ELSE public.has_company_access((SELECT auth.uid()), company_id) END)
);

CREATE POLICY bs_update ON public.bank_statements FOR UPDATE TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND (CASE WHEN company_id IS NULL THEN public.has_role((SELECT auth.uid()), 'admin'::public.app_role) ELSE public.has_company_access((SELECT auth.uid()), company_id) END)
) WITH CHECK (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND (CASE WHEN company_id IS NULL THEN public.has_role((SELECT auth.uid()), 'admin'::public.app_role) ELSE public.has_company_access((SELECT auth.uid()), company_id) END)
);

CREATE POLICY bs_delete ON public.bank_statements FOR DELETE TO authenticated USING (
  (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  AND (CASE WHEN company_id IS NULL THEN true ELSE public.has_company_access((SELECT auth.uid()), company_id) END)
);

-- bank_transactions RLS: scoped to authorized roles and assigned companies
CREATE POLICY bt_read ON public.bank_transactions FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'finance_operator'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'auditor'::public.app_role,
    'report_viewer'::public.app_role
  ]))
  AND (CASE WHEN company_id IS NULL THEN public.has_role((SELECT auth.uid()), 'admin'::public.app_role) ELSE public.has_company_access((SELECT auth.uid()), company_id) END)
);

CREATE POLICY bt_write ON public.bank_transactions FOR INSERT TO authenticated WITH CHECK (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND (CASE WHEN company_id IS NULL THEN public.has_role((SELECT auth.uid()), 'admin'::public.app_role) ELSE public.has_company_access((SELECT auth.uid()), company_id) END)
);

CREATE POLICY bt_update ON public.bank_transactions FOR UPDATE TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND (CASE WHEN company_id IS NULL THEN public.has_role((SELECT auth.uid()), 'admin'::public.app_role) ELSE public.has_company_access((SELECT auth.uid()), company_id) END)
) WITH CHECK (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND (CASE WHEN company_id IS NULL THEN public.has_role((SELECT auth.uid()), 'admin'::public.app_role) ELSE public.has_company_access((SELECT auth.uid()), company_id) END)
);

CREATE POLICY bt_delete ON public.bank_transactions FOR DELETE TO authenticated USING (
  (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  AND (CASE WHEN company_id IS NULL THEN true ELSE public.has_company_access((SELECT auth.uid()), company_id) END)
);

-- ============================================================================
-- 2. DEDICATED RECONCILIATION RUNS TABLE (FILE IDENTITY & AUDIT TRAIL)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
    fiscal_year text,
    idempotency_key text,
    source_type text NOT NULL, -- 'excel', 'bank_statement', 'connectips', 'nchl'
    file_name text NOT NULL,
    file_hash_sha256 text NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    total_amount numeric(15,2) DEFAULT 0 NOT NULL,
    matched_count integer DEFAULT 0 NOT NULL,
    unmatched_count integer DEFAULT 0 NOT NULL,
    partial_count integer DEFAULT 0 NOT NULL,
    rejected_count integer DEFAULT 0 NOT NULL,
    parser_version text DEFAULT '2.0.0',
    matching_rule_version text DEFAULT '2.0.0',
    status text DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'processing', 'applied', 'reverted', 'failed')),
    processed_chunks jsonb DEFAULT '{}'::jsonb,
    expected_chunk_count integer DEFAULT 1 NOT NULL,
    batch_id uuid REFERENCES public.payment_batches(id) ON DELETE SET NULL,
    notes text,
    applied_by uuid,
    applied_at timestamp with time zone,
    reverted_by uuid,
    reverted_at timestamp with time zone,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Ensure auxiliary columns exist on reconciliation_runs if table pre-existed
ALTER TABLE public.reconciliation_runs
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.payment_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partial_count integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS rejected_count integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS processed_chunks jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS expected_chunk_count integer DEFAULT 1 NOT NULL;

-- Normalize existing processed_chunks values from legacy array format to object
UPDATE public.reconciliation_runs
SET processed_chunks = '{}'::jsonb
WHERE jsonb_typeof(processed_chunks) = 'array' OR processed_chunks IS NULL;

ALTER TABLE public.reconciliation_runs 
ALTER COLUMN processed_chunks SET DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_company_id ON public.reconciliation_runs(company_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_file_hash ON public.reconciliation_runs(file_hash_sha256);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliation_runs_idempotency ON public.reconciliation_runs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_status ON public.reconciliation_runs(status);
CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_created_at ON public.reconciliation_runs(created_at DESC);

ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recon_runs_read ON public.reconciliation_runs;
CREATE POLICY recon_runs_read ON public.reconciliation_runs FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'finance_operator'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'auditor'::public.app_role,
    'report_viewer'::public.app_role,
    'read_only'::public.app_role
  ]))
  AND (CASE WHEN company_id IS NULL THEN public.has_role((SELECT auth.uid()), 'admin'::public.app_role) ELSE public.has_company_access((SELECT auth.uid()), company_id) END)
);

DROP POLICY IF EXISTS recon_runs_write ON public.reconciliation_runs;
CREATE POLICY recon_runs_write ON public.reconciliation_runs FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS recon_runs_update ON public.reconciliation_runs;
CREATE POLICY recon_runs_update ON public.reconciliation_runs FOR UPDATE TO authenticated USING (false);

DROP POLICY IF EXISTS recon_runs_delete ON public.reconciliation_runs;
CREATE POLICY recon_runs_delete ON public.reconciliation_runs FOR DELETE TO authenticated USING (false);

-- ============================================================================
-- 3. LINK PAYMENTS & RECONCILIATION RESULTS TO RUNS & EXPLAINABILITY
-- ============================================================================

-- Track unique reconciliation run on generated payments
ALTER TABLE public.payments 
  ADD COLUMN IF NOT EXISTS reconciliation_run_id uuid REFERENCES public.reconciliation_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_reconciliation_run_id 
  ON public.payments(reconciliation_run_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_recon_run_payable
  ON public.payments (reconciliation_run_id, payable_type, payable_id)
  WHERE reconciliation_run_id IS NOT NULL;

-- Enrich reconciliation_results with run reference & explainability decision model
ALTER TABLE public.reconciliation_results 
  ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES public.reconciliation_runs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source_reference text,
  ADD COLUMN IF NOT EXISTS match_method text,
  ADD COLUMN IF NOT EXISTS match_confidence numeric(5,2),
  ADD COLUMN IF NOT EXISTS candidate_count integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS rejected_candidates jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rule_version text DEFAULT '2.0.0',
  ADD COLUMN IF NOT EXISTS requires_manual_approval boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS prior_paid_amount numeric(15,2),
  ADD COLUMN IF NOT EXISTS prior_payment_status text,
  ADD COLUMN IF NOT EXISTS prior_payment_date date,
  ADD COLUMN IF NOT EXISTS prior_payment_reference text,
  ADD COLUMN IF NOT EXISTS prior_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS post_state_hash text;

CREATE INDEX IF NOT EXISTS idx_reconciliation_results_run_id 
  ON public.reconciliation_results(run_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliation_results_idempotency
  ON public.reconciliation_results(run_id, source_reference)
  WHERE run_id IS NOT NULL;

-- Enrich payable_tax_rules with statutory citations and comparison rates for authoritative UI explainability
ALTER TABLE public.payable_tax_rules
  ADD COLUMN IF NOT EXISTS statutory_citation text,
  ADD COLUMN IF NOT EXISTS comparison_rate numeric(7,6),
  ADD COLUMN IF NOT EXISTS effective_from date DEFAULT '2024-07-16';

UPDATE public.payable_tax_rules
SET statutory_citation = CASE
      WHEN payable_category = 'DIVIDEND' AND payee_classification = 'NATURAL_PERSON' THEN 'Section 88 Resident Individual Final Withholding (5% Rate)'
      WHEN payable_category = 'DIVIDEND' AND payee_classification = 'PUBLIC_LEGAL_PERSON' THEN 'Section 88 Public/Statutory Legal Entity (5% Rate)'
      WHEN payable_category = 'DIVIDEND' AND payee_classification = 'COMPANY_INSTITUTION' THEN 'Section 88 Corporate Dividend Withholding (15% Legal Person Rate)'
      WHEN payable_category = 'DIVIDEND' AND payee_classification = 'FOREIGN_INVESTOR' THEN 'Section 88 Non-Resident / Foreign Investor Withholding (15% Rate)'
      WHEN payable_category = 'DIVIDEND' AND payee_classification = 'TAX_EXEMPT' THEN 'Section 10 Statutory Tax Exemption (0% Withholding)'
      WHEN payable_category = 'DIVIDEND' AND payee_classification = 'BANK_FI' THEN 'Section 88 Bank & Financial Institution Withholding (5% Rate)'
      WHEN payable_category = 'MUTUAL_FUND' AND payee_classification = 'NATURAL_PERSON' THEN 'Mutual Fund Scheme Individual Distribution (0% TDS per SEBON)'
      WHEN payable_category = 'MUTUAL_FUND' AND payee_classification = 'COMPANY_INSTITUTION' THEN 'Mutual Fund Institutional Distribution (15% TDS per RMF Rules)'
      WHEN payable_category = 'MUTUAL_FUND' AND payee_classification = 'TAX_EXEMPT' THEN 'Section 10 Mutual Fund Tax Exempt Entity (0% TDS)'
      WHEN payable_category = 'INTEREST' AND payee_classification = 'NATURAL_PERSON' THEN 'Section 87 Debenture Individual Interest (5% Final)'
      WHEN payable_category = 'INTEREST' AND payee_classification = 'COMPANY_INSTITUTION' THEN 'Section 87 Corporate Debenture Interest (15% Rate)'
      WHEN payable_category = 'INTEREST' AND payee_classification = 'BANK_FI' THEN 'Section 87 Bank / Financial Institution Debenture (0% Inter-bank TDS)'
      ELSE 'Statutory Withholding Rule'
    END,
    comparison_rate = CASE
      WHEN payee_classification IN ('COMPANY_INSTITUTION', 'FOREIGN_INVESTOR') THEN 0.05
      ELSE 0.15
    END,
    effective_from = COALESCE(effective_from, '2024-07-16'::date)
WHERE statutory_citation IS NULL;

-- Enrich clients with classification rule version, timestamp, and audit evidence
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS classification_rule_version text DEFAULT '2083.1',
  ADD COLUMN IF NOT EXISTS classified_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS classification_evidence jsonb DEFAULT '{}'::jsonb;

-- Append-only immutable classification decision history
CREATE TABLE IF NOT EXISTS public.classification_decision_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
    previous_classification text,
    new_classification text NOT NULL,
    previous_segment text,
    new_segment text,
    classification_source text NOT NULL,
    rule_version text NOT NULL,
    evidence_hash text,
    evidence jsonb DEFAULT '{}'::jsonb,
    confirmed_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_class_dec_hist_client ON public.classification_decision_history(client_id);
CREATE INDEX IF NOT EXISTS idx_class_dec_hist_comp ON public.classification_decision_history(company_id);
CREATE INDEX IF NOT EXISTS idx_class_dec_hist_time ON public.classification_decision_history(created_at DESC);

ALTER TABLE public.classification_decision_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY cdh_read ON public.classification_decision_history FOR SELECT TO authenticated USING (
  public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'finance_operator'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'auditor'::public.app_role
  ])
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
);

REVOKE INSERT, UPDATE, DELETE ON TABLE public.classification_decision_history FROM PUBLIC, authenticated;
GRANT SELECT ON TABLE public.classification_decision_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.classification_decision_history TO service_role;

-- ============================================================================
-- 4. IMMUTABLE BANK STATEMENT INGESTION LEDGER & FINGERPRINTING
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bank_statement_imports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
    bank_name text NOT NULL,
    account_no text NOT NULL,
    file_name text NOT NULL,
    file_hash_sha256 text NOT NULL,
    opening_balance numeric(15,2) DEFAULT 0,
    closing_balance numeric(15,2) DEFAULT 0,
    total_debit numeric(15,2) DEFAULT 0,
    total_credit numeric(15,2) DEFAULT 0,
    row_count integer DEFAULT 0,
    parser_metadata jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'imported' CHECK (status IN ('imported', 'reconciled', 'archived', 'rejected')),
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Backfill orphaned bank imports before enforcing NOT NULL
DO $$
BEGIN
  UPDATE public.bank_statement_imports 
  SET company_id = (SELECT id FROM public.companies ORDER BY created_at ASC LIMIT 1) 
  WHERE company_id IS NULL;
  
  ALTER TABLE public.bank_statement_imports ALTER COLUMN company_id SET NOT NULL;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_bank_statement_imports_company ON public.bank_statement_imports(company_id);
CREATE INDEX IF NOT EXISTS idx_bank_statement_imports_hash ON public.bank_statement_imports(file_hash_sha256);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_stmt_imports_company_hash ON public.bank_statement_imports(company_id, file_hash_sha256);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_bank_statement_imports_company_hash'
  ) THEN
    ALTER TABLE public.bank_statement_imports 
      ADD CONSTRAINT uq_bank_statement_imports_company_hash UNIQUE (company_id, file_hash_sha256);
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

ALTER TABLE public.bank_statement_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY bsi_read ON public.bank_statement_imports FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'finance_operator'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'auditor'::public.app_role,
    'report_viewer'::public.app_role
  ]))
  AND public.has_company_access((SELECT auth.uid()), company_id)
);

CREATE POLICY bsi_write ON public.bank_statement_imports FOR INSERT TO authenticated WITH CHECK (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND public.has_company_access((SELECT auth.uid()), company_id)
);

CREATE TABLE IF NOT EXISTS public.bank_statement_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id uuid REFERENCES public.bank_statement_imports(id) ON DELETE CASCADE,
    company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
    transaction_date date NOT NULL,
    description text,
    reference text,
    debit_amount numeric(15,2) DEFAULT 0,
    credit_amount numeric(15,2) DEFAULT 0,
    balance numeric(15,2),
    raw_data jsonb DEFAULT '{}'::jsonb,
    transaction_fingerprint text NOT NULL,
    reconciliation_status text DEFAULT 'unreconciled',
    reconciliation_run_id uuid REFERENCES public.reconciliation_runs(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Backfill orphaned bank transactions and enforce NOT NULL and allowed statuses
DO $$
BEGIN
  UPDATE public.bank_statement_transactions bst 
  SET company_id = bsi.company_id 
  FROM public.bank_statement_imports bsi 
  WHERE bst.import_id = bsi.id AND bst.company_id IS NULL;

  UPDATE public.bank_statement_transactions 
  SET company_id = (SELECT id FROM public.companies ORDER BY created_at ASC LIMIT 1) 
  WHERE company_id IS NULL;

  ALTER TABLE public.bank_statement_transactions ALTER COLUMN company_id SET NOT NULL;

  ALTER TABLE public.bank_statement_transactions 
    DROP CONSTRAINT IF EXISTS bank_statement_transactions_reconciliation_status_check;
  ALTER TABLE public.bank_statement_transactions 
    ADD CONSTRAINT bank_statement_transactions_reconciliation_status_check 
    CHECK (reconciliation_status IN ('unreconciled', 'matched', 'reconciled', 'ignored', 'exception'));
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_bank_stmt_txns_import ON public.bank_statement_transactions(import_id);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_txns_company ON public.bank_statement_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_txns_status ON public.bank_statement_transactions(reconciliation_status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_txn_fingerprint_scoped 
  ON public.bank_statement_transactions (
    company_id,
    transaction_fingerprint
  );

ALTER TABLE public.bank_statement_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY bst_read ON public.bank_statement_transactions FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'finance_operator'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'auditor'::public.app_role,
    'report_viewer'::public.app_role
  ]))
  AND public.has_company_access((SELECT auth.uid()), company_id)
);

CREATE POLICY bst_write ON public.bank_statement_transactions FOR INSERT TO authenticated WITH CHECK (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND public.has_company_access((SELECT auth.uid()), company_id)
);

CREATE POLICY bst_update ON public.bank_statement_transactions FOR UPDATE TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND public.has_company_access((SELECT auth.uid()), company_id)
) WITH CHECK (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND public.has_company_access((SELECT auth.uid()), company_id)
);

-- ============================================================================
-- 4b. SERVER-SIDE MAKER-CHECKER VARIANCE APPROVALS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reconciliation_variance_approvals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    run_id uuid NOT NULL REFERENCES public.reconciliation_runs(id) ON DELETE CASCADE,
    result_id uuid REFERENCES public.reconciliation_results(id) ON DELETE CASCADE,
    payable_id uuid NOT NULL,
    payable_type text NOT NULL,
    source_reference text,
    variance_type text NOT NULL CHECK (variance_type IN ('UNDER_PAID', 'OVER_PAID', 'PARTIAL', 'DISCREPANCY')),
    expected_amount numeric(15,2) NOT NULL,
    actual_amount numeric(15,2) NOT NULL,
    variance_amount numeric(15,2) NOT NULL,
    maker_id uuid NOT NULL,
    approved_by uuid NOT NULL,
    approval_reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_recon_approval_reason_not_empty CHECK (length(trim(approval_reason)) >= 5),
    CONSTRAINT ck_recon_approval_maker_checker CHECK (maker_id <> approved_by)
);

CREATE INDEX IF NOT EXISTS idx_recon_variance_approvals_run ON public.reconciliation_variance_approvals(run_id);
CREATE INDEX IF NOT EXISTS idx_recon_variance_approvals_comp ON public.reconciliation_variance_approvals(company_id);
CREATE INDEX IF NOT EXISTS idx_recon_variance_approvals_result ON public.reconciliation_variance_approvals(result_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_variance_approvals 
  ON public.reconciliation_variance_approvals (run_id, payable_id, COALESCE(source_reference, ''));

-- Append auxiliary columns if table pre-existed
ALTER TABLE public.reconciliation_variance_approvals
  ADD COLUMN IF NOT EXISTS result_id uuid REFERENCES public.reconciliation_results(id) ON DELETE CASCADE;

ALTER TABLE public.reconciliation_variance_approvals ENABLE ROW LEVEL SECURITY;

-- Read-only policy for authenticated users: approvals can only be queried, NEVER directly inserted or updated
CREATE POLICY rva_read ON public.reconciliation_variance_approvals FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'finance_operator'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'auditor'::public.app_role
  ]))
  AND public.has_company_access((SELECT auth.uid()), company_id)
);

-- ============================================================================
-- 5. DURABLE RECONCILIATION EXCEPTIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reconciliation_exceptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid REFERENCES public.reconciliation_runs(id) ON DELETE CASCADE,
    company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
    result_id uuid REFERENCES public.reconciliation_results(id) ON DELETE SET NULL,
    payable_id uuid,
    payable_type text,
    source_reference text,
    amount numeric(15,2),
    exception_reason text NOT NULL,
    status text DEFAULT 'Open' CHECK (status IN ('Open', 'Investigating', 'Accepted', 'Rejected', 'Resolved', 'Escalated')),
    assigned_to uuid,
    deadline date,
    notes text,
    resolution_notes text,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recon_exceptions_company ON public.reconciliation_exceptions(company_id);
CREATE INDEX IF NOT EXISTS idx_recon_exceptions_run ON public.reconciliation_exceptions(run_id);
CREATE INDEX IF NOT EXISTS idx_recon_exceptions_status ON public.reconciliation_exceptions(status);

ALTER TABLE public.reconciliation_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY re_read ON public.reconciliation_exceptions FOR SELECT TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'finance_operator'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'auditor'::public.app_role,
    'report_viewer'::public.app_role
  ]))
  AND (CASE WHEN company_id IS NULL THEN public.has_role((SELECT auth.uid()), 'admin'::public.app_role) ELSE public.has_company_access((SELECT auth.uid()), company_id) END)
);

CREATE POLICY re_write ON public.reconciliation_exceptions FOR INSERT TO authenticated WITH CHECK (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role,
    'supervisor'::public.app_role
  ]))
  AND (CASE WHEN company_id IS NULL THEN public.has_role((SELECT auth.uid()), 'admin'::public.app_role) ELSE public.has_company_access((SELECT auth.uid()), company_id) END)
);

CREATE POLICY re_update ON public.reconciliation_exceptions FOR UPDATE TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role,
    'supervisor'::public.app_role
  ]))
  AND (CASE WHEN company_id IS NULL THEN public.has_role((SELECT auth.uid()), 'admin'::public.app_role) ELSE public.has_company_access((SELECT auth.uid()), company_id) END)
) WITH CHECK (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role,
    'supervisor'::public.app_role
  ]))
  AND (CASE WHEN company_id IS NULL THEN public.has_role((SELECT auth.uid()), 'admin'::public.app_role) ELSE public.has_company_access((SELECT auth.uid()), company_id) END)
);

-- ============================================================================
-- 6. UNIFIED ATOMIC APPLY & RECORD RPC (apply_and_record_reconciliation_batch)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_and_record_reconciliation_batch(
    p_run_info jsonb,
    p_items jsonb,
    p_batch_info jsonb DEFAULT NULL::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run_id uuid;
  v_company_id uuid;
  v_batch_id uuid;
  v_item jsonb;
  v_payable_id uuid;
  v_payment_id uuid;
  v_client_id uuid;
  v_target_table text;
  v_result text;
  v_actual_amt numeric;
  v_expected_amt numeric;
  v_paid_amt numeric;
  v_diff numeric;
  v_payment_ref text;
  v_instruction_id text;
  v_fiscal_year text;
  v_match_method text;
  v_confidence numeric;
  v_rule_ver text;
  v_notes text;
  v_idempotency_key text;
  v_existing_status text;
  v_chunk_index int;
  v_requested_chunks int := 1;
  v_ex_expected_chunks int := 1;
  v_expected_chunks int := 1;
  v_requires_approval boolean := false;
  v_approval_record RECORD;
  v_post_state_hash text;
  v_new_payment_status text;
  v_is_final_chunk boolean;
  v_existing_chunks jsonb;
  v_applied_payable_amt numeric;
  v_source_reference text;
  v_rows_affected int := 0;
  v_partial_count int := 0;
  v_rejected_count int := 0;
  v_item_count int := 0;
  
  v_payables_updated int := 0;
  v_payments_created int := 0;
  v_results_inserted int := 0;
  v_exceptions_created int := 0;
  v_already_paid int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_total_amount numeric := 0;
  v_old_paid_amount numeric;
  v_old_payment_status text;
  v_old_payment_date date;
  v_old_payment_reference text;
  v_prior_snapshot jsonb;
  v_pre_run_snapshots jsonb := '{}'::jsonb;
  v_snap_key text;
  v_authoritative_client_id uuid;
  v_authoritative_net numeric(15,2);
  v_result_enum public.reconciliation_result;
  v_ex_company_id uuid;
  v_ex_file_hash text;
  v_ex_source_type text;
  v_ex_fiscal_year text;
  v_ex_created_by uuid;
  v_chunk_hash text;
BEGIN
  -- 1. Authorization check
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');
  END IF;

  v_company_id := NULLIF(p_run_info->>'company_id', '')::uuid;
  v_fiscal_year := NULLIF(p_run_info->>'fiscal_year', '');

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Target company_id is required for reconciliation execution' USING ERRCODE = '23502';
  END IF;

  -- Tenant check
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    IF NOT public.has_company_access(v_uid, v_company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to target company %', v_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Idempotency Check & Multi-Chunk State Management
  v_chunk_index := COALESCE(NULLIF(p_run_info->>'chunk_index', '')::int, 0);
  v_requested_chunks := COALESCE(
    NULLIF(p_run_info->>'total_chunks', '')::int,
    NULLIF(p_run_info->>'expected_chunk_count', '')::int,
    1
  );
  v_expected_chunks := v_requested_chunks;
  v_item_count := jsonb_array_length(p_items);

  -- Validate chunk bounds strictly
  IF v_chunk_index < 0 OR v_chunk_index >= v_expected_chunks THEN
    RAISE EXCEPTION 'Invalid chunk bounds: chunk_index % is out of range for total_chunks %',
      v_chunk_index, v_expected_chunks USING ERRCODE = '22003';
  END IF;

  -- Deterministic chunk content digest
  v_chunk_hash := encode(extensions.digest(p_items::text::bytea, 'sha256'), 'hex');

  v_idempotency_key := NULLIF(p_run_info->>'idempotency_key', '');
  v_run_id := NULLIF(p_run_info->>'run_id', '')::uuid;

  IF v_idempotency_key IS NOT NULL AND v_run_id IS NULL THEN
    SELECT id, status INTO v_run_id, v_existing_status
    FROM public.reconciliation_runs
    WHERE idempotency_key = v_idempotency_key;

    IF v_run_id IS NOT NULL AND v_existing_status = 'applied' AND v_chunk_index = 0 THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'run_id', v_run_id,
        'message', 'Reconciliation run already applied with this idempotency key',
        'payables_updated', 0,
        'payments_created', 0,
        'results_inserted', 0,
        'exceptions_created', 0,
        'already_paid_skipped', 0,
        'errors', '[]'::jsonb
      );
    END IF;
  END IF;

  IF v_run_id IS NOT NULL THEN
    -- Acquire exclusive row lock on reconciliation_runs to serialize concurrent retries
    SELECT status, COALESCE(processed_chunks, '{}'::jsonb), batch_id, COALESCE(expected_chunk_count, 1),
           company_id, file_hash_sha256, source_type, fiscal_year, created_by
    INTO v_existing_status, v_existing_chunks, v_batch_id, v_ex_expected_chunks,
         v_ex_company_id, v_ex_file_hash, v_ex_source_type, v_ex_fiscal_year, v_ex_created_by
    FROM public.reconciliation_runs
    WHERE id = v_run_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reconciliation run % not found', v_run_id USING ERRCODE = '23503';
    END IF;

    -- Validate immutable metadata against stored run on retry / chunk submission
    IF v_ex_company_id IS DISTINCT FROM v_company_id THEN
      RAISE EXCEPTION 'Run metadata mismatch: company_id % does not match run company_id %', v_company_id, v_ex_company_id USING ERRCODE = '23514';
    END IF;

    IF NULLIF(p_run_info->>'file_hash_sha256', '') IS NOT NULL AND v_ex_file_hash IS NOT NULL AND v_ex_file_hash != p_run_info->>'file_hash_sha256' THEN
      RAISE EXCEPTION 'Run metadata mismatch: file_hash_sha256 does not match run record' USING ERRCODE = '23514';
    END IF;

    IF NULLIF(p_run_info->>'source_type', '') IS NOT NULL AND v_ex_source_type != p_run_info->>'source_type' THEN
      RAISE EXCEPTION 'Run metadata mismatch: source_type does not match run record' USING ERRCODE = '23514';
    END IF;

    IF NULLIF(p_run_info->>'fiscal_year', '') IS NOT NULL AND v_ex_fiscal_year IS NOT NULL AND v_ex_fiscal_year != p_run_info->>'fiscal_year' THEN
      RAISE EXCEPTION 'Run metadata mismatch: fiscal_year does not match run record' USING ERRCODE = '23514';
    END IF;

    IF v_requested_chunks != v_ex_expected_chunks THEN
      RAISE EXCEPTION 'Run metadata mismatch: total_chunks % does not match expected_chunk_count %', v_requested_chunks, v_ex_expected_chunks USING ERRCODE = '23514';
    END IF;

    v_expected_chunks := v_ex_expected_chunks;

    -- Chunk-level idempotency and payload collision verification
    IF v_existing_chunks ? v_chunk_index::text THEN
      IF (v_existing_chunks->>v_chunk_index::text) = v_chunk_hash OR (v_existing_chunks->>v_chunk_index::text) = 'true' THEN
        RETURN jsonb_build_object(
          'success', true,
          'idempotent', true,
          'run_id', v_run_id,
          'batch_id', v_batch_id,
          'message', 'Reconciliation chunk ' || v_chunk_index || ' already applied',
          'payables_updated', 0,
          'payments_created', 0,
          'results_inserted', 0,
          'exceptions_created', 0,
          'already_paid_skipped', 0,
          'errors', '[]'::jsonb
        );
      ELSE
        RAISE EXCEPTION 'Chunk % payload collision: incoming chunk hash does not match previously processed chunk', v_chunk_index USING ERRCODE = '23514';
      END IF;
    END IF;

    -- If run was previously marked applied, protect against re-run
    IF v_existing_status = 'applied' THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'run_id', v_run_id,
        'batch_id', v_batch_id,
        'message', 'Reconciliation run already finalized',
        'payables_updated', 0,
        'payments_created', 0,
        'results_inserted', 0,
        'exceptions_created', 0,
        'already_paid_skipped', 0,
        'errors', '[]'::jsonb
      );
    END IF;

    IF jsonb_typeof(v_existing_chunks) != 'object' THEN
      v_existing_chunks := '{}'::jsonb;
    END IF;
    v_existing_chunks := jsonb_set(
      v_existing_chunks,
      ARRAY[v_chunk_index::text],
      to_jsonb(v_chunk_hash)
    );
  ELSE
    v_existing_chunks := jsonb_build_object(v_chunk_index::text, v_chunk_hash);
  END IF;

  IF v_run_id IS NULL THEN
    INSERT INTO public.reconciliation_runs (
      company_id,
      fiscal_year,
      idempotency_key,
      source_type,
      file_name,
      file_hash_sha256,
      row_count,
      total_amount,
      parser_version,
      matching_rule_version,
      status,
      processed_chunks,
      expected_chunk_count,
      applied_by,
      applied_at,
      created_by
    ) VALUES (
      v_company_id,
      v_fiscal_year,
      v_idempotency_key,
      COALESCE(NULLIF(p_run_info->>'source_type', ''), 'excel'),
      COALESCE(NULLIF(p_run_info->>'file_name', ''), 'Reconciliation Batch'),
      COALESCE(NULLIF(p_run_info->>'file_hash_sha256', ''), md5(now()::text || p_run_info::text)),
      0,
      0,
      COALESCE(NULLIF(p_run_info->>'parser_version', ''), '2.0.0'),
      COALESCE(NULLIF(p_run_info->>'matching_rule_version', ''), '2.0.0'),
      'processing',
      v_existing_chunks,
      v_expected_chunks,
      NULL,
      NULL,
      v_uid
    ) RETURNING id INTO v_run_id;
    v_ex_created_by := v_uid;
  END IF;

  -- Server-authoritative finalization check: only finalize when all chunks 0..expected_chunks-1 are recorded
  v_is_final_chunk := true;
  FOR i IN 0..(v_expected_chunks - 1) LOOP
    IF NOT (v_existing_chunks ? i::text) THEN
      v_is_final_chunk := false;
      EXIT;
    END IF;
  END LOOP;

  -- 3. Create or Link Payment Batch if requested
  IF p_batch_info IS NOT NULL AND jsonb_typeof(p_batch_info) = 'object' THEN
    v_batch_id := NULLIF(p_batch_info->>'batch_id', '')::uuid;
    IF v_batch_id IS NULL THEN
      INSERT INTO public.payment_batches (
        batch_name,
        payable_type,
        company_id,
        status,
        cds_batch_ref,
        total_payments,
        total_amount,
        total_tax,
        created_by
      ) VALUES (
        COALESCE(NULLIF(p_batch_info->>'batch_name', ''), 'Reconciliation Auto-Batch ' || to_char(now(), 'YYYY-MM-DD')),
        COALESCE(NULLIF(p_batch_info->>'payable_type', ''), 'dividend'),
        v_company_id,
        'Draft'::public.payment_batch_status,
        COALESCE(NULLIF(p_batch_info->>'cds_batch_ref', ''), 'RECON-APPLY'),
        COALESCE(NULLIF(p_batch_info->>'total_records', '')::int, 0),
        COALESCE(NULLIF(p_batch_info->>'total_net', '')::numeric, 0),
        COALESCE(NULLIF(p_batch_info->>'total_tax', '')::numeric, 0),
        v_uid
      ) RETURNING id INTO v_batch_id;

      -- Update run with linked batch
      UPDATE public.reconciliation_runs SET batch_id = v_batch_id WHERE id = v_run_id;
    END IF;
  ELSIF v_batch_id IS NULL AND v_run_id IS NOT NULL THEN
    -- In subsequent chunks (where p_batch_info is null), inherit batch_id from the existing run
    SELECT batch_id INTO v_batch_id FROM public.reconciliation_runs WHERE id = v_run_id;
  END IF;

  -- Pre-execution in-memory snapshot map: snapshot each unique payable exactly once per run before mutations occur
  v_pre_run_snapshots := '{}'::jsonb;

  -- Populate pre-execution snapshots for all distinct payables in this batch
  FOR v_item IN
    SELECT jsonb_build_object(
      'p_type', LOWER(COALESCE(NULLIF(elem->>'target_table', ''), NULLIF(elem->>'payable_type', ''), 'dividend')),
      'p_id', NULLIF(elem->>'payable_id', '')
    )
    FROM jsonb_array_elements(p_items) AS elem
    WHERE NULLIF(elem->>'payable_id', '') IS NOT NULL
    GROUP BY 1
  LOOP
    v_snap_key := (v_item->>'p_type') || '_' || (v_item->>'p_id');
    v_old_paid_amount := NULL;
    v_old_payment_status := NULL;
    v_old_payment_date := NULL;
    v_old_payment_reference := NULL;
    v_prior_snapshot := NULL;

    -- 1. If an earlier chunk of this run already captured this payable, inherit that baseline snapshot
    SELECT
      rr.prior_paid_amount,
      rr.prior_payment_status,
      rr.prior_payment_date,
      rr.prior_payment_reference,
      rr.prior_snapshot
    INTO
      v_old_paid_amount,
      v_old_payment_status,
      v_old_payment_date,
      v_old_payment_reference,
      v_prior_snapshot
    FROM public.reconciliation_results rr
    WHERE rr.run_id = v_run_id
      AND rr.payable_id = (v_item->>'p_id')::uuid
      AND rr.payable_type = (v_item->>'p_type')
      AND (rr.prior_snapshot IS NOT NULL OR rr.prior_payment_status IS NOT NULL)
    ORDER BY rr.id ASC
    LIMIT 1;

    -- 2. If not found in earlier results of this run, query live payable table FOR UPDATE
    -- STRICT TENANT VERIFICATION: Payable MUST belong to v_company_id
    IF v_old_payment_status IS NULL AND v_prior_snapshot IS NULL THEN
      IF (v_item->>'p_type') LIKE '%dividend%' THEN
        SELECT
          p.paid_amount,
          p.payment_status::text,
          p.payment_date,
          p.payment_reference,
          p.client_id,
          p.net_payable,
          to_jsonb(p)
        INTO
          v_old_paid_amount,
          v_old_payment_status,
          v_old_payment_date,
          v_old_payment_reference,
          v_authoritative_client_id,
          v_authoritative_net,
          v_prior_snapshot
        FROM public.dividend_payables p
        WHERE p.id = (v_item->>'p_id')::uuid
          AND p.company_id = v_company_id
        FOR UPDATE;

      ELSIF (v_item->>'p_type') LIKE '%interest%' OR (v_item->>'p_type') LIKE '%debenture%' THEN
        SELECT
          p.paid_amount,
          p.payment_status::text,
          p.payment_date,
          p.payment_reference,
          p.client_id,
          p.net_payable,
          to_jsonb(p)
        INTO
          v_old_paid_amount,
          v_old_payment_status,
          v_old_payment_date,
          v_old_payment_reference,
          v_authoritative_client_id,
          v_authoritative_net,
          v_prior_snapshot
        FROM public.interest_payables p
        WHERE p.id = (v_item->>'p_id')::uuid
          AND p.company_id = v_company_id
        FOR UPDATE;

      ELSIF (v_item->>'p_type') LIKE '%mutual%' THEN
        SELECT
          p.paid_amount,
          p.payment_status::text,
          p.payment_date,
          p.payment_reference,
          p.client_id,
          p.net_payable,
          to_jsonb(p)
        INTO
          v_old_paid_amount,
          v_old_payment_status,
          v_old_payment_date,
          v_old_payment_reference,
          v_authoritative_client_id,
          v_authoritative_net,
          v_prior_snapshot
        FROM public.mutual_fund_payables p
        WHERE p.id = (v_item->>'p_id')::uuid
          AND p.company_id = v_company_id
        FOR UPDATE;
      END IF;
    END IF;

    IF v_old_payment_status IS NOT NULL OR v_prior_snapshot IS NOT NULL THEN
      v_pre_run_snapshots := jsonb_set(
        v_pre_run_snapshots,
        ARRAY[v_snap_key],
        jsonb_build_object(
          'prior_paid_amount', v_old_paid_amount,
          'prior_payment_status', v_old_payment_status,
          'prior_payment_date', v_old_payment_date,
          'prior_payment_reference', v_old_payment_reference,
          'client_id', v_authoritative_client_id,
          'net_payable', v_authoritative_net,
          'full_snapshot', v_prior_snapshot
        ),
        true
      );
    END IF;
  END LOOP;

  -- 4. Process each reconciliation item atomically
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_payable_id   := NULLIF(v_item->>'payable_id', '')::uuid;
      v_client_id    := NULLIF(v_item->>'client_id', '')::uuid;
      v_target_table := LOWER(COALESCE(NULLIF(v_item->>'target_table', ''), NULLIF(v_item->>'payable_type', ''), 'dividend'));
      v_result       := UPPER(COALESCE(NULLIF(v_item->>'reconciliation_result', ''), NULLIF(v_item->>'result', ''), 'MATCHED'));
      v_actual_amt   := COALESCE(NULLIF(v_item->>'actual_amount', '')::numeric, 0);
      v_expected_amt := COALESCE(NULLIF(v_item->>'expected_amount', '')::numeric, 0);
      v_diff         := COALESCE(NULLIF(v_item->>'difference', '')::numeric, v_actual_amt - v_expected_amt);
      v_payment_ref  := COALESCE(NULLIF(v_item->>'payment_reference', ''), NULLIF(v_item->>'reference_id', ''), 'RECON-' || substr(COALESCE(v_run_id::text, gen_random_uuid()::text), 1, 8));
      v_instruction_id := COALESCE(NULLIF(v_item->>'instruction_id', ''), NULLIF(v_item->>'connectips_ref', ''));
      v_match_method := COALESCE(NULLIF(v_item->>'match_method', ''), 'instruction_id');
      v_confidence   := COALESCE(NULLIF(v_item->>'match_confidence', '')::numeric, 80);
      v_rule_ver     := COALESCE(NULLIF(v_item->>'rule_version', ''), '2.0.0');
      v_notes        := NULLIF(v_item->>'notes', '');

      -- Fetch pre-execution snapshot from in-memory snapshots
      v_old_paid_amount := NULL;
      v_old_payment_status := NULL;
      v_old_payment_date := NULL;
      v_old_payment_reference := NULL;
      v_prior_snapshot := NULL;
      IF v_payable_id IS NOT NULL THEN
        v_snap_key := v_target_table || '_' || v_payable_id::text;
        IF v_pre_run_snapshots ? v_snap_key THEN
          v_old_paid_amount := (v_pre_run_snapshots->v_snap_key->>'prior_paid_amount')::numeric;
          v_old_payment_status := v_pre_run_snapshots->v_snap_key->>'prior_payment_status';
          v_old_payment_date := (v_pre_run_snapshots->v_snap_key->>'prior_payment_date')::date;
          v_old_payment_reference := v_pre_run_snapshots->v_snap_key->>'prior_payment_reference';
          v_prior_snapshot := v_pre_run_snapshots->v_snap_key->'full_snapshot';
          -- Authoritatively derive client_id from database row
          v_client_id := COALESCE(NULLIF(v_pre_run_snapshots->v_snap_key->>'client_id', '')::uuid, v_client_id);
          IF v_expected_amt <= 0 THEN
            v_expected_amt := COALESCE((v_pre_run_snapshots->v_snap_key->>'net_payable')::numeric, 0);
            v_diff := v_actual_amt - v_expected_amt;
          END IF;
        ELSE
          -- Payable not found under target company: strictly reject settlement to prevent cross-company corruption
          v_notes := COALESCE(v_notes || '; ', '') || 'Rejected: payable not found in target company ' || v_company_id::text;
          v_result := 'EXCEPTION';
          v_payable_id := NULL;
        END IF;
      END IF;

      v_result_enum := CASE v_result
        WHEN 'MATCHED' THEN 'Matched'::public.reconciliation_result
        WHEN 'NOT_MATCHED' THEN 'Not_Matched'::public.reconciliation_result
        WHEN 'MISSING' THEN 'Missing'::public.reconciliation_result
        WHEN 'DUPLICATE' THEN 'Duplicate'::public.reconciliation_result
        WHEN 'OVER_PAID' THEN 'Over_Paid'::public.reconciliation_result
        WHEN 'UNDER_PAID' THEN 'Under_Paid'::public.reconciliation_result
        WHEN 'PARTIAL' THEN 'Partial'::public.reconciliation_result
        WHEN 'PENDING' THEN 'Pending'::public.reconciliation_result
        WHEN 'PLEDGED' THEN 'Pledged'::public.reconciliation_result
        WHEN 'REJECTED' THEN 'Rejected'::public.reconciliation_result
        WHEN 'EXCEPTION' THEN 'Exception'::public.reconciliation_result
        ELSE 'Not_Matched'::public.reconciliation_result
      END;

      -- Strictly require positive actual amount for settlement (never fall back to expected_amount)
      v_paid_amt := v_actual_amt;
      v_total_amount := v_total_amount + GREATEST(0, v_paid_amt);
      v_payment_id := NULL;

      -- Derive deterministic, unique source reference per record in run BEFORE any mutation
      v_source_reference := COALESCE(
        NULLIF(v_item->>'source_reference', ''),
        NULLIF(v_item->>'id', ''),
        NULLIF(v_item->>'instruction_id', ''),
        NULLIF(v_item->>'connectips_ref', ''),
        NULLIF(v_item->>'payment_reference', ''),
        NULLIF(v_item->>'reference_id', ''),
        'ITEM-' || md5(v_item::text)
      );

      -- Check duplicate source reference BEFORE any financial mutation (skip if already committed in this run)
      IF EXISTS (
        SELECT 1 FROM public.reconciliation_results
        WHERE run_id = v_run_id AND source_reference = v_source_reference
          AND post_state_hash IS NOT NULL
      ) THEN
        INSERT INTO public.reconciliation_exceptions (
          run_id,
          company_id,
          payable_id,
          payable_type,
          source_reference,
          amount,
          exception_reason,
          status,
          created_by
        ) VALUES (
          v_run_id,
          v_company_id,
          v_payable_id,
          v_target_table,
          v_source_reference,
          v_actual_amt,
          'Duplicate source reference detected within run: ' || v_source_reference,
          'Open',
          v_uid
        );
        v_exceptions_created := v_exceptions_created + 1;
        CONTINUE; -- Strictly skip mutation on duplicate source reference
      END IF;

      -- Server-side Maker-Checker Variance Approval Check:
      -- Variance (UNDER_PAID / OVER_PAID) can only be settled if an authorized supervisor/admin (who is NOT the maker)
      -- has approved the variance in public.reconciliation_variance_approvals.
      IF v_result IN ('UNDER_PAID', 'OVER_PAID') THEN
        SELECT id, company_id, variance_type, expected_amount, actual_amount, variance_amount, maker_id, approved_by, approval_reason
        INTO v_approval_record
        FROM public.reconciliation_variance_approvals
        WHERE run_id = v_run_id
          AND payable_id = v_payable_id
          AND COALESCE(source_reference, '') = COALESCE(v_source_reference, '')
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_approval_record.id IS NOT NULL THEN
          -- Amount and metadata parity check: verify approved variance matches item exactly
          IF v_approval_record.company_id != v_company_id OR
             v_approval_record.variance_type != v_result OR
             ABS(COALESCE(v_approval_record.expected_amount, 0) - v_expected_amt) > 0.005 OR
             ABS(COALESCE(v_approval_record.actual_amount, 0) - v_actual_amt) > 0.005 OR
             ABS(COALESCE(v_approval_record.variance_amount, 0) - ABS(v_actual_amt - v_expected_amt)) > 0.005 THEN
            v_requires_approval := true;
            v_notes := COALESCE(v_notes || '; ', '') || 'Variance approval invalid: approval amounts or metadata do not match current transaction';
          -- Maker-checker verification: Approver cannot be run creator or recorded maker
          ELSIF v_approval_record.approved_by = COALESCE(v_ex_created_by, v_approval_record.maker_id) THEN
            v_requires_approval := true;
            v_notes := COALESCE(v_notes || '; ', '') || 'Variance approval refused: maker-checker violation (approver cannot be reconciler)';
          ELSE
            v_requires_approval := false;
            v_notes := COALESCE(v_notes || '; ', '') || 'Variance approved by ' || v_approval_record.approved_by::text || ' (' || v_approval_record.approval_reason || ')';
          END IF;
        ELSE
          v_requires_approval := true;
        END IF;
      ELSE
        v_requires_approval := false;
      END IF;

      IF v_requires_approval THEN
        v_notes := COALESCE(v_notes || '; ', '') || 'Variance requires manual supervisor approval before settlement for ' || v_result;
        v_payment_id := NULL;
        INSERT INTO public.reconciliation_exceptions (
          run_id,
          company_id,
          payable_id,
          payable_type,
          source_reference,
          amount,
          exception_reason,
          status,
          created_by
        ) VALUES (
          v_run_id,
          v_company_id,
          v_payable_id,
          v_target_table,
          v_source_reference,
          v_actual_amt,
          'Variance (' || v_result || ') requires manual supervisor approval before settlement',
          'Open',
          v_uid
        );
        v_exceptions_created := v_exceptions_created + 1;
      -- A. Settle payable if payable_id exists and status is MATCHED / PARTIAL or an approved variance
      ELSIF v_payable_id IS NOT NULL AND (v_result IN ('MATCHED', 'PARTIAL') OR (v_result IN ('OVER_PAID', 'UNDER_PAID') AND NOT v_requires_approval)) THEN
        IF v_paid_amt <= 0 THEN
          -- Strictly reject zero or negative actual amounts: underpayments or malformed rows must never settle as paid
          v_notes := COALESCE(v_notes || '; ', '') || 'Settlement rejected: actual payment amount must be strictly positive';
          v_result := 'EXCEPTION';
          v_result_enum := 'Exception'::public.reconciliation_result;
          v_payment_id := NULL;
        ELSIF v_old_payment_status = 'Paid' THEN
          -- SHORT-CIRCUIT: Payable is already Paid before this run; do NOT create duplicate payment record
          v_already_paid := v_already_paid + 1;
          v_notes := COALESCE(v_notes || '; ', '') || 'Payable already Paid prior to reconciliation run';
          v_payment_id := NULL;
        ELSE
          -- Apply settlement update to payable:
          -- UNDER_PAID and PARTIAL, or any remaining balance > 0.005 MUST set payment_status = 'Partial'
          IF v_target_table LIKE '%dividend%' THEN
            UPDATE public.dividend_payables
            SET payment_status = CASE 
                  WHEN v_result IN ('PARTIAL', 'UNDER_PAID') OR (COALESCE(net_payable, 0) - (COALESCE(paid_amount, 0) + v_paid_amt)) > 0.005 THEN 'Partial'::public.payment_status 
                  ELSE 'Paid'::public.payment_status 
                END,
                paid_amount = LEAST(net_payable, COALESCE(paid_amount, 0) + v_paid_amt),
                remaining_amount = GREATEST(0, COALESCE(net_payable, 0) - (COALESCE(paid_amount, 0) + v_paid_amt)),
                payment_date = COALESCE(payment_date, CURRENT_DATE),
                payment_reference = COALESCE(payment_reference, v_payment_ref),
                updated_at = now()
            WHERE id = v_payable_id
              AND company_id = v_company_id
              AND payment_status != 'Paid'
            RETURNING payment_status::text INTO v_new_payment_status;

            IF FOUND THEN
              v_payables_updated := v_payables_updated + 1;
            ELSE
              v_already_paid := v_already_paid + 1;
            END IF;

          ELSIF v_target_table LIKE '%interest%' OR v_target_table LIKE '%debenture%' THEN
            UPDATE public.interest_payables
            SET payment_status = CASE 
                  WHEN v_result IN ('PARTIAL', 'UNDER_PAID') OR (COALESCE(net_payable, 0) - (COALESCE(paid_amount, 0) + v_paid_amt)) > 0.005 THEN 'Partial'::public.payment_status 
                  ELSE 'Paid'::public.payment_status 
                END,
                paid_amount = LEAST(net_payable, COALESCE(paid_amount, 0) + v_paid_amt),
                remaining_amount = GREATEST(0, COALESCE(net_payable, 0) - (COALESCE(paid_amount, 0) + v_paid_amt)),
                payment_date = COALESCE(payment_date, CURRENT_DATE),
                payment_reference = COALESCE(payment_reference, v_payment_ref),
                updated_at = now()
            WHERE id = v_payable_id
              AND company_id = v_company_id
              AND payment_status != 'Paid'
            RETURNING payment_status::text INTO v_new_payment_status;

            IF FOUND THEN
              v_payables_updated := v_payables_updated + 1;
            ELSE
              v_already_paid := v_already_paid + 1;
            END IF;

          ELSIF v_target_table LIKE '%mutual%' THEN
            UPDATE public.mutual_fund_payables
            SET payment_status = CASE 
                  WHEN v_result IN ('PARTIAL', 'UNDER_PAID') OR (COALESCE(net_payable, 0) - (COALESCE(paid_amount, 0) + v_paid_amt)) > 0.005 THEN 'Partial'::public.payment_status 
                  ELSE 'Paid'::public.payment_status 
                END,
                paid_amount = LEAST(net_payable, COALESCE(paid_amount, 0) + v_paid_amt),
                remaining_amount = GREATEST(0, COALESCE(net_payable, 0) - (COALESCE(paid_amount, 0) + v_paid_amt)),
                payment_date = COALESCE(payment_date, CURRENT_DATE),
                payment_reference = COALESCE(payment_reference, v_payment_ref),
                updated_at = now()
            WHERE id = v_payable_id
              AND company_id = v_company_id
              AND payment_status != 'Paid'
            RETURNING payment_status::text INTO v_new_payment_status;

            IF FOUND THEN
              v_payables_updated := v_payables_updated + 1;
            ELSE
              v_already_paid := v_already_paid + 1;
            END IF;
          END IF;

          -- Compute deterministic post-state hash for infallible reversal verification
          v_post_state_hash := encode(extensions.digest((
            v_payable_id::text || '|' ||
            v_target_table || '|' ||
            (COALESCE(v_old_paid_amount, 0) + v_paid_amt)::text || '|' ||
            COALESCE(v_new_payment_status, 'Paid') || '|' ||
            COALESCE(v_payment_ref, '')
          )::bytea, 'sha256'), 'hex');

          -- Reconcile matching bank statement transaction
          IF v_source_reference IS NOT NULL THEN
            UPDATE public.bank_statement_transactions
            SET reconciliation_status = 'reconciled',
                reconciliation_run_id = v_run_id
            WHERE company_id = v_company_id
              AND (reference = v_source_reference OR transaction_fingerprint = v_source_reference);
          END IF;

          -- Deduplicate payment: prevent duplicate payment creation for the same payable in this run
          SELECT id INTO v_payment_id
          FROM public.payments
          WHERE reconciliation_run_id = v_run_id
            AND payable_id = v_payable_id
            AND payable_type = v_target_table
          LIMIT 1;

          IF v_payment_id IS NULL THEN
            -- Cap payments.paid_amount/net_amount at expected_amount (net_payable) to preserve ledger balance invariants
            v_applied_payable_amt := CASE 
              WHEN v_expected_amt > 0 THEN LEAST(v_expected_amt, v_paid_amt) 
              ELSE v_paid_amt 
            END;

            -- Create or stamp payment record with reconciliation_run_id
            INSERT INTO public.payments (
              batch_id,
              reconciliation_run_id,
              company_id,
              client_id,
              payable_type,
              payable_id,
              gross_amount,
              tax_amount,
              net_amount,
              paid_amount,
              payment_method,
              payment_date,
              payment_reference,
              connectips_ref,
              status,
              processed_by,
              processed_at
            ) VALUES (
              v_batch_id,
              v_run_id,
              v_company_id,
              v_client_id,
              v_target_table,
              v_payable_id,
              v_applied_payable_amt,
              0,
              v_applied_payable_amt,
              v_applied_payable_amt,
              'ConnectIPS'::public.payment_method,
              CURRENT_DATE,
              v_payment_ref,
              v_instruction_id,
              'Paid',
              v_uid,
              now()
            ) RETURNING id INTO v_payment_id;

            v_payments_created := v_payments_created + 1;
          END IF;
        END IF;
      END IF;

      -- B. Persist result record in reconciliation_results linked to run_id
      INSERT INTO public.reconciliation_results (
        run_id,
        reconciliation_date,
        source_reference,
        source_a_type,
        source_a_id,
        source_b_type,
        source_b_id,
        client_id,
        company_id,
        fiscal_year,
        payable_type,
        payable_id,
        payment_id,
        batch_id,
        expected_amount,
        actual_amount,
        difference,
        result,
        notes,
        match_method,
        match_confidence,
        candidate_count,
        rejected_candidates,
        rule_version,
        requires_manual_approval,
        matched_by,
        matched_at,
        prior_paid_amount,
        prior_payment_status,
        prior_payment_date,
        prior_payment_reference,
        prior_snapshot,
        post_state_hash
      ) VALUES (
        v_run_id,
        CURRENT_DATE,
        v_source_reference,
        COALESCE(NULLIF(v_item->>'source_a_type', ''), 'bank_statement'),
        NULLIF(v_item->>'source_a_id', '')::uuid,
        COALESCE(NULLIF(v_item->>'source_b_type', ''), 'payable'),
        COALESCE(v_payment_id, v_payable_id),
        v_client_id,
        v_company_id,
        v_fiscal_year,
        v_target_table,
        v_payable_id,
        v_payment_id,
        v_batch_id,
        v_expected_amt,
        v_actual_amt,
        v_diff,
        v_result_enum,
        v_notes,
        v_match_method,
        v_confidence,
        COALESCE(NULLIF(v_item->>'candidate_count', '')::int, 1),
        COALESCE(v_item->'rejected_candidates', '[]'::jsonb),
        v_rule_ver,
        v_requires_approval,
        v_uid,
        now(),
        v_old_paid_amount,
        v_old_payment_status,
        v_old_payment_date,
        v_old_payment_reference,
        v_prior_snapshot,
        v_post_state_hash
      )
      ON CONFLICT (run_id, source_reference) WHERE run_id IS NOT NULL DO UPDATE SET
        payment_id = EXCLUDED.payment_id,
        reconciliation_date = EXCLUDED.reconciliation_date,
        source_a_type = EXCLUDED.source_a_type,
        source_a_id = EXCLUDED.source_a_id,
        source_b_type = EXCLUDED.source_b_type,
        source_b_id = EXCLUDED.source_b_id,
        payable_type = EXCLUDED.payable_type,
        payable_id = EXCLUDED.payable_id,
        expected_amount = EXCLUDED.expected_amount,
        actual_amount = EXCLUDED.actual_amount,
        difference = EXCLUDED.difference,
        result = EXCLUDED.result,
        notes = EXCLUDED.notes,
        match_method = EXCLUDED.match_method,
        match_confidence = EXCLUDED.match_confidence,
        rule_version = EXCLUDED.rule_version,
        requires_manual_approval = EXCLUDED.requires_manual_approval,
        matched_by = EXCLUDED.matched_by,
        matched_at = EXCLUDED.matched_at,
        prior_paid_amount = EXCLUDED.prior_paid_amount,
        prior_payment_status = EXCLUDED.prior_payment_status,
        prior_payment_date = EXCLUDED.prior_payment_date,
        prior_payment_reference = EXCLUDED.prior_payment_reference,
        prior_snapshot = EXCLUDED.prior_snapshot,
        post_state_hash = EXCLUDED.post_state_hash;

      -- Increment results_inserted only when a row was actually inserted
      GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
      v_results_inserted := v_results_inserted + v_rows_affected;

      -- Track status counters
      IF v_result = 'REJECTED' THEN
        v_rejected_count := v_rejected_count + 1;
      ELSIF v_result IN ('PARTIAL', 'UNDER_PAID') OR (v_target_table = 'mutual_fund' AND v_paid_amt < v_expected_amt AND v_paid_amt > 0) THEN
        v_partial_count := v_partial_count + 1;
      END IF;

      -- C. If exception/unmatched, record durable exception (if not already recorded)
      IF (v_result IN ('MISSING', 'REJECTED', 'EXCEPTION') OR (v_result NOT IN ('MATCHED', 'PARTIAL') AND abs(v_diff) > 0.05))
         AND NOT EXISTS (
           SELECT 1 FROM public.reconciliation_exceptions
           WHERE run_id = v_run_id AND source_reference = v_source_reference
         ) THEN
        INSERT INTO public.reconciliation_exceptions (
          run_id,
          company_id,
          payable_id,
          payable_type,
          source_reference,
          amount,
          exception_reason,
          status,
          created_by
        ) VALUES (
          v_run_id,
          v_company_id,
          v_payable_id,
          v_target_table,
          v_source_reference,
          v_actual_amt,
          CASE 
            WHEN v_result = 'MISSING' THEN 'Record not found in core ledger'
            WHEN v_result = 'REJECTED' THEN 'Bank payout transaction rejected by switch'
            ELSE 'Amount variance: difference of ' || v_diff::text
          END,
          'Open',
          v_uid
        );
        v_exceptions_created := v_exceptions_created + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      -- Truly atomic: re-raise error to roll back transaction completely
      RAISE EXCEPTION 'Atomic reconciliation batch failed at record (payable_id: %, source_ref: %): % (SQLSTATE: %)',
        v_item->>'payable_id', v_source_reference, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  -- 5. Update run stats cumulatively from accepted items
  UPDATE public.reconciliation_runs
  SET matched_count = COALESCE(matched_count, 0) + v_payables_updated,
      unmatched_count = COALESCE(unmatched_count, 0) + v_exceptions_created,
      partial_count = COALESCE(partial_count, 0) + v_partial_count,
      rejected_count = COALESCE(rejected_count, 0) + v_rejected_count,
      row_count = COALESCE(row_count, 0) + v_item_count,
      total_amount = COALESCE(total_amount, 0) + v_total_amount,
      processed_chunks = v_existing_chunks,
      batch_id = COALESCE(batch_id, v_batch_id),
      status = CASE WHEN v_is_final_chunk THEN 'applied' ELSE 'processing' END,
      applied_by = CASE WHEN v_is_final_chunk THEN v_uid ELSE applied_by END,
      applied_at = CASE WHEN v_is_final_chunk THEN now() ELSE applied_at END,
      updated_at = now()
  WHERE id = v_run_id;

  -- Finalize bank statement imports when all chunks are applied
  IF v_is_final_chunk THEN
    UPDATE public.bank_statement_imports bsi
    SET status = 'reconciled',
        updated_at = now()
    WHERE bsi.company_id = v_company_id
      AND bsi.status = 'imported'
      AND (
        (v_ex_file_hash IS NOT NULL AND bsi.file_hash_sha256 = v_ex_file_hash)
        OR EXISTS (
          SELECT 1 FROM public.bank_statement_transactions bst
          WHERE bst.import_id = bsi.id AND bst.reconciliation_run_id = v_run_id
        )
      );
  END IF;

  -- 6. Audit log
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
  VALUES (
    v_uid,
    'RECONCILIATION_APPLIED_ATOMIC',
    'reconciliation_runs',
    v_run_id,
    jsonb_build_object(
      'run_id', v_run_id,
      'company_id', v_company_id,
      'payables_updated', v_payables_updated,
      'payments_created', v_payments_created,
      'results_inserted', v_results_inserted,
      'exceptions_created', v_exceptions_created,
      'already_paid_skipped', v_already_paid,
      'rejected_count', v_rejected_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id,
    'batch_id', v_batch_id,
    'payables_updated', v_payables_updated,
    'payments_created', v_payments_created,
    'results_inserted', v_results_inserted,
    'exceptions_created', v_exceptions_created,
    'already_paid_skipped', v_already_paid,
    'rejected_count', v_rejected_count,
    'errors', v_errors
  );
END;
$$;

-- ============================================================================
-- 7. SAFE OPERATION-SCOPED REVERT (revert_reconciliation_run_atomic)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.revert_reconciliation_run_atomic(
    p_run_id uuid,
    p_force boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run record;
  v_completed_count int := 0;
  v_conflict_count int := 0;
  v_reverted_payables int := 0;
  v_deleted_payments int := 0;
  v_payable_record record;
  v_payable_updated_at timestamp with time zone;
BEGIN
  -- 1. Authorization check
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    PERFORM public.require_role('admin', 'supervisor');
  END IF;

  -- 2. Fetch run record
  SELECT * INTO v_run FROM public.reconciliation_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reconciliation run % not found', p_run_id USING ERRCODE = 'P0002';
  END IF;

  -- Verify tenant access
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' AND v_run.company_id IS NOT NULL THEN
    IF NOT public.has_company_access(v_uid, v_run.company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to company %', v_run.company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_run.status = 'reverted' THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Run already reverted',
      'reverted_payables', 0,
      'deleted_payments', 0
    );
  END IF;

  -- 3. Safety check: Check if any linked payments are marked 'Completed' or externally finalized
  SELECT count(*) INTO v_completed_count
  FROM public.payments
  WHERE reconciliation_run_id = p_run_id
    AND status IN ('Completed', 'Settled');

  IF v_completed_count > 0 AND NOT p_force THEN
    RAISE EXCEPTION 'Safety violation: % payments are already finalized/completed. Reversal requires explicit supervisor override (p_force = true).', v_completed_count
      USING ERRCODE = '55000';
  END IF;

  -- Post-apply concurrency check: verify payable has not been modified by subsequent external payments or actions
  IF NOT p_force THEN
    FOR v_payable_record IN (
      SELECT DISTINCT ON (payable_type, payable_id) payable_type, payable_id
      FROM public.reconciliation_results
      WHERE run_id = p_run_id AND payable_id IS NOT NULL
    ) LOOP
      SELECT count(*) INTO v_conflict_count
      FROM public.payments
      WHERE payable_id = v_payable_record.payable_id
        AND (reconciliation_run_id IS NULL OR reconciliation_run_id != p_run_id)
        AND created_at > v_run.created_at;

      IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'Concurrency conflict: payable % has been modified by % subsequent payment(s) after reconciliation. Reversal refused without supervisor override (p_force = true).',
          v_payable_record.payable_id, v_conflict_count USING ERRCODE = '55000';
      END IF;

      -- Post-state verification: verify the payable record itself was not independently updated after reconciliation
      IF LOWER(v_payable_record.payable_type) LIKE '%dividend%' THEN
        SELECT updated_at INTO v_payable_updated_at FROM public.dividend_payables WHERE id = v_payable_record.payable_id;
      ELSIF LOWER(v_payable_record.payable_type) LIKE '%interest%' OR LOWER(v_payable_record.payable_type) LIKE '%debenture%' THEN
        SELECT updated_at INTO v_payable_updated_at FROM public.interest_payables WHERE id = v_payable_record.payable_id;
      ELSIF LOWER(v_payable_record.payable_type) LIKE '%mutual%' THEN
        SELECT updated_at INTO v_payable_updated_at FROM public.mutual_fund_payables WHERE id = v_payable_record.payable_id;
      END IF;

      IF v_payable_updated_at IS NOT NULL AND v_payable_updated_at > COALESCE(v_run.applied_at, v_run.created_at) THEN
        RAISE EXCEPTION 'Concurrency conflict: payable % has been modified after reconciliation was applied (last updated: %). Reversal refused without supervisor override (p_force = true).',
          v_payable_record.payable_id, v_payable_updated_at USING ERRCODE = '55000';
      END IF;
    END LOOP;
  END IF;

  -- 4. Revert ONLY payables linked to this run, restoring their prior snapshot
  FOR v_payable_record IN (
    SELECT DISTINCT ON (payable_type, payable_id)
      payable_type,
      payable_id,
      prior_paid_amount,
      prior_payment_status,
      prior_payment_date,
      prior_payment_reference,
      prior_snapshot
    FROM public.reconciliation_results
    WHERE run_id = p_run_id AND payable_id IS NOT NULL
    ORDER BY payable_type, payable_id, id ASC
  ) LOOP
    IF LOWER(v_payable_record.payable_type) LIKE '%dividend%' THEN
      UPDATE public.dividend_payables
      SET payment_status = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_status')::public.payment_status,
            v_payable_record.prior_payment_status::public.payment_status,
            'Pending'::public.payment_status
          ),
          paid_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'paid_amount')::numeric,
            v_payable_record.prior_paid_amount,
            0
          ),
          remaining_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'remaining_amount')::numeric,
            GREATEST(0, COALESCE(net_payable, 0) - COALESCE(v_payable_record.prior_paid_amount, 0))
          ),
          payment_date = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_date')::date,
            v_payable_record.prior_payment_date
          ),
          payment_reference = COALESCE(
            v_payable_record.prior_snapshot->>'payment_reference',
            v_payable_record.prior_payment_reference
          ),
          updated_at = now()
      WHERE id = v_payable_record.payable_id;
      IF FOUND THEN v_reverted_payables := v_reverted_payables + 1; END IF;

    ELSIF LOWER(v_payable_record.payable_type) LIKE '%interest%' OR LOWER(v_payable_record.payable_type) LIKE '%debenture%' THEN
      UPDATE public.interest_payables
      SET payment_status = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_status')::public.payment_status,
            v_payable_record.prior_payment_status::public.payment_status,
            'Pending'::public.payment_status
          ),
          paid_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'paid_amount')::numeric,
            v_payable_record.prior_paid_amount,
            0
          ),
          remaining_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'remaining_amount')::numeric,
            GREATEST(0, COALESCE(net_payable, 0) - COALESCE(v_payable_record.prior_paid_amount, 0))
          ),
          payment_date = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_date')::date,
            v_payable_record.prior_payment_date
          ),
          payment_reference = COALESCE(
            v_payable_record.prior_snapshot->>'payment_reference',
            v_payable_record.prior_payment_reference
          ),
          updated_at = now()
      WHERE id = v_payable_record.payable_id;
      IF FOUND THEN v_reverted_payables := v_reverted_payables + 1; END IF;

    ELSIF LOWER(v_payable_record.payable_type) LIKE '%mutual%' THEN
      UPDATE public.mutual_fund_payables
      SET payment_status = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_status')::public.payment_status,
            v_payable_record.prior_payment_status::public.payment_status,
            'Pending'::public.payment_status
          ),
          paid_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'paid_amount')::numeric,
            v_payable_record.prior_paid_amount,
            0
          ),
          remaining_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'remaining_amount')::numeric,
            GREATEST(0, COALESCE(net_payable, 0) - COALESCE(v_payable_record.prior_paid_amount, 0))
          ),
          payment_date = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_date')::date,
            v_payable_record.prior_payment_date
          ),
          payment_reference = COALESCE(
            v_payable_record.prior_snapshot->>'payment_reference',
            v_payable_record.prior_payment_reference
          ),
          updated_at = now()
      WHERE id = v_payable_record.payable_id;
      IF FOUND THEN v_reverted_payables := v_reverted_payables + 1; END IF;
    END IF;
  END LOOP;

  -- 5. Delete or reset ONLY payments that belong to this run
  WITH del_p AS (
    DELETE FROM public.payments
    WHERE reconciliation_run_id = p_run_id
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_payments FROM del_p;

  -- 6. Clean up auto-generated payment batch if it has no remaining payments
  IF v_run.batch_id IS NOT NULL THEN
    DELETE FROM public.payment_batches
    WHERE id = v_run.batch_id
      AND NOT EXISTS (
        SELECT 1 FROM public.payments WHERE batch_id = v_run.batch_id
      );
  END IF;

  -- 7. Update run status to 'reverted'
  UPDATE public.reconciliation_runs
  SET status = 'reverted',
      reverted_by = v_uid,
      reverted_at = now(),
      updated_at = now()
  WHERE id = p_run_id;

  -- Reset bank statement transactions and imports linked to this run
  UPDATE public.bank_statement_transactions
  SET reconciliation_status = 'unreconciled',
      reconciliation_run_id = NULL
  WHERE reconciliation_run_id = p_run_id;

  UPDATE public.bank_statement_imports
  SET status = 'imported',
      updated_at = now()
  WHERE company_id = v_run.company_id
    AND (
      (v_run.file_hash_sha256 IS NOT NULL AND file_hash_sha256 = v_run.file_hash_sha256)
      OR id IN (
        SELECT DISTINCT import_id FROM public.bank_statement_transactions WHERE reconciliation_run_id = p_run_id
      )
    );

  -- 8. Audit log
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
  VALUES (
    v_uid,
    'RECONCILIATION_RUN_REVERTED',
    'reconciliation_runs',
    p_run_id,
    jsonb_build_object(
      'run_id', p_run_id,
      'company_id', v_run.company_id,
      'reverted_payables', v_reverted_payables,
      'deleted_payments', v_deleted_payments
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'run_id', p_run_id,
    'reverted_payables', v_reverted_payables,
    'deleted_payments', v_deleted_payments
  );
END;
$$;

-- Upgrade existing revert_reconciliation_lot_atomic to be strictly scoped and safe
CREATE OR REPLACE FUNCTION public.revert_reconciliation_lot_atomic(p_result_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reverted_payables int := 0;
  v_updated_payments int := 0;
  v_deleted_results int := 0;
  v_payment_ids uuid[];
  v_completed_count int := 0;
  v_payable_record record;
BEGIN
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');

    -- Verify caller has access to the companies of these reconciliation records
    IF EXISTS (
      SELECT 1 FROM public.reconciliation_results rr
      WHERE rr.id = ANY(p_result_ids)
        AND rr.company_id IS NOT NULL
        AND NOT public.has_company_access(v_uid, rr.company_id)
    ) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to one or more companies in reconciliation lot' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 1. Extract specifically linked payment IDs
  SELECT COALESCE(array_agg(payment_id), '{}') INTO v_payment_ids
  FROM public.reconciliation_results
  WHERE id = ANY(p_result_ids) AND payment_id IS NOT NULL;

  -- Check if any of these specific payments are already Completed
  IF array_length(v_payment_ids, 1) > 0 THEN
    SELECT count(*) INTO v_completed_count
    FROM public.payments
    WHERE id = ANY(v_payment_ids)
      AND status IN ('Completed', 'Settled');

    IF v_completed_count > 0 THEN
      RAISE EXCEPTION 'Safety violation: % payments in this lot are already completed/settled and cannot be reverted automatically.', v_completed_count
        USING ERRCODE = '55000';
    END IF;
  END IF;

  -- 2. Restore payables back to prior snapshot (or Pending/0 if prior snapshot is null)
  FOR v_payable_record IN (
    SELECT DISTINCT ON (payable_type, payable_id)
      payable_type,
      payable_id,
      prior_paid_amount,
      prior_payment_status,
      prior_payment_date,
      prior_payment_reference,
      prior_snapshot
    FROM public.reconciliation_results
    WHERE id = ANY(p_result_ids) AND payable_id IS NOT NULL
    ORDER BY payable_type, payable_id, id ASC
  ) LOOP
    IF LOWER(COALESCE(v_payable_record.payable_type, '')) = 'dividend' THEN
      UPDATE public.dividend_payables
      SET payment_status = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_status')::public.payment_status,
            v_payable_record.prior_payment_status::public.payment_status,
            'Pending'::public.payment_status
          ),
          paid_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'paid_amount')::numeric,
            v_payable_record.prior_paid_amount,
            0
          ),
          remaining_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'remaining_amount')::numeric,
            GREATEST(0, COALESCE(net_payable, 0) - COALESCE(v_payable_record.prior_paid_amount, 0))
          ),
          payment_date = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_date')::date,
            v_payable_record.prior_payment_date
          ),
          payment_reference = COALESCE(
            v_payable_record.prior_snapshot->>'payment_reference',
            v_payable_record.prior_payment_reference
          ),
          updated_at = now()
      WHERE id = v_payable_record.payable_id;
      IF FOUND THEN v_reverted_payables := v_reverted_payables + 1; END IF;

    ELSIF LOWER(COALESCE(v_payable_record.payable_type, '')) IN ('interest', 'debenture') THEN
      UPDATE public.interest_payables
      SET payment_status = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_status')::public.payment_status,
            v_payable_record.prior_payment_status::public.payment_status,
            'Pending'::public.payment_status
          ),
          paid_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'paid_amount')::numeric,
            v_payable_record.prior_paid_amount,
            0
          ),
          remaining_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'remaining_amount')::numeric,
            GREATEST(0, COALESCE(net_payable, 0) - COALESCE(v_payable_record.prior_paid_amount, 0))
          ),
          payment_date = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_date')::date,
            v_payable_record.prior_payment_date
          ),
          payment_reference = COALESCE(
            v_payable_record.prior_snapshot->>'payment_reference',
            v_payable_record.prior_payment_reference
          ),
          updated_at = now()
      WHERE id = v_payable_record.payable_id;
      IF FOUND THEN v_reverted_payables := v_reverted_payables + 1; END IF;

    ELSIF LOWER(COALESCE(v_payable_record.payable_type, '')) = 'mutual_fund' THEN
      UPDATE public.mutual_fund_payables
      SET payment_status = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_status')::public.payment_status,
            v_payable_record.prior_payment_status::public.payment_status,
            'Pending'::public.payment_status
          ),
          paid_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'paid_amount')::numeric,
            v_payable_record.prior_paid_amount,
            0
          ),
          remaining_amount = COALESCE(
            (v_payable_record.prior_snapshot->>'remaining_amount')::numeric,
            GREATEST(0, COALESCE(net_payable, 0) - COALESCE(v_payable_record.prior_paid_amount, 0))
          ),
          payment_date = COALESCE(
            (v_payable_record.prior_snapshot->>'payment_date')::date,
            v_payable_record.prior_payment_date
          ),
          payment_reference = COALESCE(
            v_payable_record.prior_snapshot->>'payment_reference',
            v_payable_record.prior_payment_reference
          ),
          updated_at = now()
      WHERE id = v_payable_record.payable_id;
      IF FOUND THEN v_reverted_payables := v_reverted_payables + 1; END IF;
    END IF;
  END LOOP;

  -- 4. Delete or reset ONLY the explicitly linked payment rows (never unlinked external payments)
  IF array_length(v_payment_ids, 1) > 0 THEN
    WITH del AS (
      DELETE FROM public.payments
      WHERE id = ANY(v_payment_ids)
        AND status NOT IN ('Completed', 'Settled')
      RETURNING id
    )
    SELECT count(*) INTO v_updated_payments FROM del;
  END IF;

  -- 5. Delete reconciliation records for this lot
  WITH del AS (
    DELETE FROM public.reconciliation_results
    WHERE id = ANY(p_result_ids)
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_results FROM del;

  -- 6. Clean up any empty RECON-APPLY payment batches that have no active payments
  DELETE FROM public.payment_batches pb
  WHERE pb.cds_batch_ref = 'RECON-APPLY'
    AND NOT EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.batch_id = pb.id
        AND p.status NOT IN ('Failed', 'Cancelled')
    );

  -- 7. Record audit log
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
  VALUES (
    v_uid,
    'RECONCILIATION_LOT_REVERTED',
    'reconciliation_results',
    p_result_ids[1],
    jsonb_build_object(
      'result_ids_count', array_length(p_result_ids, 1),
      'reverted_payables', v_reverted_payables,
      'deleted_payments', v_updated_payments,
      'deleted_results', v_deleted_results
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'reverted_payables', v_reverted_payables,
    'deleted_payments', v_updated_payments,
    'deleted_results', v_deleted_results
  );
END;
$$;

-- ============================================================================
-- 8. SERVER-SIDE PAGINATION & AGGREGATION RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_reconciliation_runs_paginated(
    p_company_id uuid DEFAULT NULL::uuid,
    p_source_type text DEFAULT NULL::text,
    p_status text DEFAULT NULL::text,
    p_search text DEFAULT NULL::text,
    p_limit int DEFAULT 50,
    p_offset int DEFAULT 0,
    p_start_date date DEFAULT NULL::date,
    p_end_date date DEFAULT NULL::date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total_count bigint := 0;
  v_summary record;
  v_runs jsonb := '[]'::jsonb;
BEGIN
  -- Verify caller role
  IF current_user != 'service_role' AND current_user != 'postgres' THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer', 'auditor', 'report_viewer', 'read_only');
  END IF;

  -- Total count query
  SELECT count(*) INTO v_total_count
  FROM public.reconciliation_runs rr
  WHERE (p_company_id IS NULL OR rr.company_id = p_company_id)
    AND (p_source_type IS NULL OR rr.source_type = p_source_type)
    AND (p_status IS NULL OR rr.status = p_status)
    AND (p_start_date IS NULL OR rr.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR rr.created_at::date <= p_end_date)
    AND (p_search IS NULL OR rr.file_name ILIKE '%' || p_search || '%' OR rr.notes ILIKE '%' || p_search || '%')
    AND (CASE WHEN rr.company_id IS NULL THEN public.has_role(v_uid, 'admin'::public.app_role) ELSE public.has_company_access(v_uid, rr.company_id) END);

  -- Aggregate summary metrics
  SELECT 
    COALESCE(sum(total_amount), 0) as grand_total_amount,
    COALESCE(sum(matched_count), 0) as grand_matched_count,
    COALESCE(sum(unmatched_count), 0) as grand_unmatched_count,
    COALESCE(sum(row_count), 0) as grand_row_count
  INTO v_summary
  FROM public.reconciliation_runs rr
  WHERE (p_company_id IS NULL OR rr.company_id = p_company_id)
    AND (p_source_type IS NULL OR rr.source_type = p_source_type)
    AND (p_status IS NULL OR rr.status = p_status)
    AND (p_start_date IS NULL OR rr.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR rr.created_at::date <= p_end_date)
    AND (p_search IS NULL OR rr.file_name ILIKE '%' || p_search || '%' OR rr.notes ILIKE '%' || p_search || '%')
    AND (CASE WHEN rr.company_id IS NULL THEN public.has_role(v_uid, 'admin'::public.app_role) ELSE public.has_company_access(v_uid, rr.company_id) END);

  -- Paginated records query
  SELECT COALESCE(jsonb_agg(to_jsonb(r_sub)), '[]'::jsonb) INTO v_runs
  FROM (
    SELECT 
      rr.id,
      rr.company_id,
      c.company_name as company_name,
      rr.fiscal_year,
      rr.source_type,
      rr.file_name,
      rr.file_hash_sha256,
      rr.row_count,
      rr.total_amount,
      rr.matched_count,
      rr.unmatched_count,
      rr.partial_count,
      rr.rejected_count,
      rr.parser_version,
      rr.matching_rule_version,
      rr.status,
      rr.batch_id,
      rr.notes,
      rr.applied_by,
      rr.applied_at,
      rr.reverted_by,
      rr.reverted_at,
      rr.created_by,
      rr.created_at,
      rr.updated_at
    FROM public.reconciliation_runs rr
    LEFT JOIN public.companies c ON c.id = rr.company_id
    WHERE (p_company_id IS NULL OR rr.company_id = p_company_id)
      AND (p_source_type IS NULL OR rr.source_type = p_source_type)
      AND (p_status IS NULL OR rr.status = p_status)
      AND (p_start_date IS NULL OR rr.created_at::date >= p_start_date)
      AND (p_end_date IS NULL OR rr.created_at::date <= p_end_date)
      AND (p_search IS NULL OR rr.file_name ILIKE '%' || p_search || '%' OR rr.notes ILIKE '%' || p_search || '%')
      AND (CASE WHEN rr.company_id IS NULL THEN public.has_role(v_uid, 'admin'::public.app_role) ELSE public.has_company_access(v_uid, rr.company_id) END)
    ORDER BY rr.created_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 500))
    OFFSET GREATEST(0, p_offset)
  ) r_sub;

  RETURN jsonb_build_object(
    'total_count', v_total_count,
    'limit', p_limit,
    'offset', p_offset,
    'summary', jsonb_build_object(
      'total_amount', v_summary.grand_total_amount,
      'matched_count', v_summary.grand_matched_count,
      'unmatched_count', v_summary.grand_unmatched_count,
      'row_count', v_summary.grand_row_count
    ),
    'runs', v_runs
  );
END;
$$;

-- ============================================================================
-- 8B. TRANSACTIONAL BANK STATEMENT LEDGER IMPORT (import_bank_statement_ledger_atomic)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.import_bank_statement_ledger_atomic(
    p_import_info jsonb,
    p_transactions jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_company_id uuid;
  v_bank_name text;
  v_account_no text;
  v_file_hash text;
  v_file_name text;
  v_opening_balance numeric(15,2);
  v_closing_balance numeric(15,2);
  v_row_count int;
  v_total_credit numeric(15,2);
  v_total_debit numeric(15,2);
  v_import_id uuid;
  v_existing_import_status text;
  v_inserted_txns int := 0;
  v_duplicate_txns int := 0;
  v_t jsonb;
  v_fingerprint text;
  v_resolved_ref text;
  v_raw_fingerprint_str text;
  v_diag_rows int := 0;
BEGIN
  -- 1. Role verification
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');
  END IF;

  v_company_id := NULLIF(p_import_info->>'company_id', '')::uuid;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Target company_id is required for bank statement import' USING ERRCODE = '23502';
  END IF;

  -- 2. Tenant isolation check
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    IF NOT public.has_company_access(v_uid, v_company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to target company %', v_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  v_bank_name := COALESCE(NULLIF(p_import_info->>'bank_name', ''), 'Bank Statement Ledger');
  v_account_no := COALESCE(NULLIF(p_import_info->>'account_no', ''), 'UNKNOWN_ACCT');
  v_file_hash := NULLIF(p_import_info->>'file_hash_sha256', '');
  v_file_name := COALESCE(NULLIF(p_import_info->>'file_name', ''), 'unknown.xlsx');
  v_opening_balance := COALESCE(NULLIF(p_import_info->>'opening_balance', '')::numeric, 0);
  v_closing_balance := COALESCE(NULLIF(p_import_info->>'closing_balance', '')::numeric, 0);
  v_row_count := COALESCE(NULLIF(p_import_info->>'row_count', '')::int, jsonb_array_length(p_transactions));
  v_total_credit := COALESCE(NULLIF(p_import_info->>'total_credit', '')::numeric, 0);
  v_total_debit := COALESCE(NULLIF(p_import_info->>'total_debit', '')::numeric, 0);

  -- Balance integrity validation: opening_balance + total_credit - total_debit = closing_balance
  -- Enforced whenever non-zero opening or closing balances are provided
  IF (v_opening_balance != 0 OR v_closing_balance != 0) THEN
    IF abs((v_opening_balance + v_total_credit - v_total_debit) - v_closing_balance) > 0.05 THEN
      RAISE EXCEPTION 'Bank statement balance integrity violation: opening (%) + credit (%) - debit (%) = %, which does not match closing (%)',
        v_opening_balance, v_total_credit, v_total_debit, (v_opening_balance + v_total_credit - v_total_debit), v_closing_balance USING ERRCODE = '23514';
    END IF;
  END IF;

  -- 3. Idempotency & Retry Check
  IF v_file_hash IS NOT NULL THEN
    SELECT id, status INTO v_import_id, v_existing_import_status
    FROM public.bank_statement_imports
    WHERE company_id = v_company_id
      AND file_hash_sha256 = v_file_hash
    LIMIT 1;

    IF v_import_id IS NOT NULL THEN
      IF v_existing_import_status IN ('imported', 'reconciled') THEN
        RETURN jsonb_build_object(
          'success', true,
          'import_id', v_import_id,
          'file_hash', v_file_hash,
          'inserted_count', 0,
          'is_duplicate', true,
          'message', 'Bank statement file already imported for this company'
        );
      ELSIF v_existing_import_status = 'rejected' THEN
        -- Retry / Reset previously rejected import:
        -- Remove any partial orphaned transactions from previous failed attempt
        DELETE FROM public.bank_statement_transactions WHERE import_id = v_import_id;

        -- Update the rejected import record to fresh 'imported' state
        UPDATE public.bank_statement_imports
        SET bank_name = v_bank_name,
            account_no = v_account_no,
            file_name = v_file_name,
            opening_balance = v_opening_balance,
            closing_balance = v_closing_balance,
            row_count = v_row_count,
            total_credit = v_total_credit,
            total_debit = v_total_debit,
            status = 'imported',
            parser_metadata = COALESCE(p_import_info->'parser_metadata', '{}'::jsonb),
            created_by = v_uid,
            created_at = now()
        WHERE id = v_import_id;
      END IF;
    END IF;
  END IF;

  IF v_import_id IS NULL THEN
    -- 4. Create bank statement import ledger record
    INSERT INTO public.bank_statement_imports (
      company_id,
      bank_name,
      account_no,
      file_name,
      file_hash_sha256,
      opening_balance,
      closing_balance,
      row_count,
      total_credit,
      total_debit,
      status,
      parser_metadata,
      created_by
    ) VALUES (
      v_company_id,
      v_bank_name,
      v_account_no,
      v_file_name,
      v_file_hash,
      v_opening_balance,
      v_closing_balance,
      v_row_count,
      v_total_credit,
      v_total_debit,
      'imported',
      COALESCE(p_import_info->'parser_metadata', '{}'::jsonb),
      v_uid
    ) RETURNING id INTO v_import_id;
  END IF;

  -- 5. Atomically insert all transactions
  FOR v_t IN SELECT * FROM jsonb_array_elements(p_transactions)
  LOOP
    v_resolved_ref := COALESCE(NULLIF(v_t->>'reference', ''), NULLIF(v_t->>'instruction_id', ''), NULLIF(v_t->>'reference_id', ''));
    v_fingerprint := NULLIF(v_t->>'transaction_fingerprint', '');
    IF v_fingerprint IS NULL THEN
      v_raw_fingerprint_str := v_company_id::text || '|' || COALESCE(v_t->>'transaction_date', '') || '|' || COALESCE(v_t->>'description', '') || '|' || COALESCE(v_resolved_ref, '') || '|' || COALESCE(v_t->>'debit_amount', '0') || '|' || COALESCE(v_t->>'credit_amount', '0');
      v_fingerprint := encode(extensions.digest(v_raw_fingerprint_str::bytea, 'sha256'), 'hex');
    END IF;

    INSERT INTO public.bank_statement_transactions (
      import_id,
      company_id,
      transaction_date,
      description,
      reference,
      debit_amount,
      credit_amount,
      balance,
      raw_data,
      transaction_fingerprint,
      reconciliation_status
    ) VALUES (
      v_import_id,
      v_company_id,
      COALESCE(NULLIF(v_t->>'transaction_date', '')::date, CURRENT_DATE),
      NULLIF(v_t->>'description', ''),
      v_resolved_ref,
      COALESCE(NULLIF(v_t->>'debit_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_t->>'credit_amount', '')::numeric, 0),
      NULLIF(v_t->>'balance', '')::numeric,
      COALESCE(v_t->'raw_data', '{}'::jsonb),
      v_fingerprint,
      'unreconciled'
    )
    ON CONFLICT (company_id, transaction_fingerprint) DO NOTHING;

    GET DIAGNOSTICS v_diag_rows = ROW_COUNT;
    IF v_diag_rows > 0 THEN
      v_inserted_txns := v_inserted_txns + v_diag_rows;
    ELSE
      -- Duplicate bank transaction detected (duplicate within file or already in company ledger)
      -- Explicitly record into reconciliation_exceptions to prevent silent drops
      INSERT INTO public.reconciliation_exceptions (
        company_id,
        source_reference,
        amount,
        exception_reason,
        status,
        created_by
      ) VALUES (
        v_company_id,
        COALESCE(v_resolved_ref, v_fingerprint),
        COALESCE(NULLIF(v_t->>'debit_amount', '')::numeric, NULLIF(v_t->>'credit_amount', '')::numeric, 0),
        'Duplicate bank statement transaction fingerprint (' || v_fingerprint || ') quarantined during import',
        'Open',
        v_uid
      );
      v_duplicate_txns := v_duplicate_txns + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'import_id', v_import_id,
    'file_hash', v_file_hash,
    'inserted_count', v_inserted_txns,
    'duplicate_count', v_duplicate_txns,
    'total_rows', jsonb_array_length(p_transactions),
    'is_duplicate', false
  );
END;
$$;

-- ============================================================================
-- 9. EXPLICIT RPC PRIVILEGE REVOCATION & LEAST-PRIVILEGE GRANTS
-- ============================================================================

-- Restrict SECURITY DEFINER RPC execution from PUBLIC, grant exclusively to authenticated and service_role
REVOKE EXECUTE ON FUNCTION public.apply_and_record_reconciliation_batch(jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_and_record_reconciliation_batch(jsonb, jsonb, jsonb) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.revert_reconciliation_run_atomic(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revert_reconciliation_run_atomic(uuid, boolean) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.revert_reconciliation_lot_atomic(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revert_reconciliation_lot_atomic(uuid[]) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_reconciliation_runs_paginated(uuid, text, text, text, int, int, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reconciliation_runs_paginated(uuid, text, text, text, int, int, date, date) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.import_bank_statement_ledger_atomic(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_bank_statement_ledger_atomic(jsonb, jsonb) TO authenticated, service_role;

-- 8b. CONTROLLED DRAFT RECONCILIATION RUN CREATION
CREATE OR REPLACE FUNCTION public.create_reconciliation_draft_run_atomic(
  p_run_info jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_company_id uuid;
  v_run_id uuid;
BEGIN
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');
  END IF;

  v_company_id := NULLIF(p_run_info->>'company_id', '')::uuid;
  IF v_company_id IS NOT NULL THEN
    IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
      IF NOT public.has_company_access(v_uid, v_company_id) THEN
        RAISE EXCEPTION 'Unauthorized: caller lacks access to target company %', v_company_id USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.reconciliation_runs (
    company_id,
    fiscal_year,
    source_type,
    file_name,
    file_hash_sha256,
    row_count,
    total_amount,
    matched_count,
    partial_count,
    rejected_count,
    unmatched_count,
    status,
    created_by
  ) VALUES (
    v_company_id,
    NULLIF(p_run_info->>'fiscal_year', ''),
    COALESCE(NULLIF(p_run_info->>'source_type', ''), 'manual'),
    COALESCE(NULLIF(p_run_info->>'file_name', ''), 'manual-reconciliation'),
    COALESCE(NULLIF(p_run_info->>'file_hash_sha256', ''), md5(now()::text || p_run_info::text)),
    COALESCE(NULLIF(p_run_info->>'row_count', '')::int, 0),
    COALESCE(NULLIF(p_run_info->>'total_amount', '')::numeric, 0),
    COALESCE(NULLIF(p_run_info->>'matched_count', '')::int, 0),
    COALESCE(NULLIF(p_run_info->>'partial_count', '')::int, 0),
    COALESCE(NULLIF(p_run_info->>'rejected_count', '')::int, 0),
    COALESCE(NULLIF(p_run_info->>'unmatched_count', '')::int, 0),
    'draft',
    v_uid
  ) RETURNING id INTO v_run_id;

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_reconciliation_draft_run_atomic(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_reconciliation_draft_run_atomic(jsonb) TO authenticated, service_role;

-- Grant table privileges on newly introduced tables (access controlled by RLS)
-- Reconciliation runs table: direct writes strictly REVOKED from authenticated clients, allowed only via atomic RPCs
REVOKE INSERT, UPDATE, DELETE ON TABLE public.reconciliation_runs FROM authenticated;
GRANT SELECT ON TABLE public.reconciliation_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reconciliation_runs TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reconciliation_exceptions TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bank_statement_imports TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bank_statement_transactions TO authenticated, service_role;
GRANT SELECT ON TABLE public.reconciliation_variance_approvals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reconciliation_variance_approvals TO service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.reconciliation_variance_approvals FROM PUBLIC, authenticated;

-- 8c. SERVER-SIDE MAKER-CHECKER VARIANCE APPROVAL RPC
CREATE OR REPLACE FUNCTION public.approve_reconciliation_variance_atomic(
  p_approval_info jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_uid uuid;
  v_result_id uuid;
  v_company_id uuid;
  v_run_id uuid;
  v_payable_id uuid;
  v_payable_type text;
  v_source_ref text;
  v_variance_type text;
  v_expected_amt numeric(15,2);
  v_actual_amt numeric(15,2);
  v_variance_amt numeric(15,2);
  v_maker_id uuid;
  v_reason text;
  v_approval_id uuid;
  v_is_admin boolean;
  v_is_service_role boolean;
  v_run_record RECORD;
  v_result_record RECORD;
  c_max_supervisor_variance CONSTANT numeric(15,2) := 50000.00;
  c_max_supervisor_pct CONSTANT numeric := 50.0;
BEGIN
  v_is_service_role := (
    current_user = 'service_role' OR
    current_user = 'postgres' OR
    COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') = 'service_role'
  );

  IF NOT v_is_service_role THEN
    PERFORM public.require_role('admin', 'supervisor');
    v_uid := auth.uid();
  ELSE
    v_uid := COALESCE(auth.uid(), NULLIF(p_approval_info->>'approved_by', '')::uuid);
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Approver identity must be authenticated via valid session or explicitly provided in trusted service context' USING ERRCODE = '42501';
  END IF;

  v_is_admin := (
    v_is_service_role OR
    (v_uid IS NOT NULL AND public.has_role(v_uid, 'admin'::public.app_role))
  );

  v_reason := trim(COALESCE(p_approval_info->>'approval_reason', ''));
  IF length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Detailed approval reason of at least 5 characters is mandatory' USING ERRCODE = '23514';
  END IF;

  v_result_id := NULLIF(p_approval_info->>'result_id', '')::uuid;
  v_run_id := NULLIF(p_approval_info->>'run_id', '')::uuid;
  v_payable_id := NULLIF(p_approval_info->>'payable_id', '')::uuid;
  v_source_ref := NULLIF(p_approval_info->>'source_reference', '');

  -- Load authoritative stored reconciliation result
  IF v_result_id IS NOT NULL THEN
    SELECT * INTO v_result_record
    FROM public.reconciliation_results
    WHERE id = v_result_id;
  ELSIF v_run_id IS NOT NULL AND v_payable_id IS NOT NULL THEN
    SELECT * INTO v_result_record
    FROM public.reconciliation_results
    WHERE run_id = v_run_id
      AND payable_id = v_payable_id
      AND (v_source_ref IS NULL OR COALESCE(source_reference, '') = v_source_ref)
    ORDER BY created_at DESC
    LIMIT 1;
  ELSE
    RAISE EXCEPTION 'A valid result_id or (run_id, payable_id) referencing a persisted reconciliation result is mandatory' USING ERRCODE = '23502';
  END IF;

  IF v_result_record.id IS NULL THEN
    RAISE EXCEPTION 'Persisted reconciliation result not found for approval' USING ERRCODE = 'P0002';
  END IF;

  -- Validate against tampering if caller sent payload values
  IF (p_approval_info->>'payable_id') IS NOT NULL AND (p_approval_info->>'payable_id')::uuid != v_result_record.payable_id THEN
    RAISE EXCEPTION 'Tampering detected: caller payable_id does not match persisted result payable_id' USING ERRCODE = '23514';
  END IF;

  IF (p_approval_info->>'actual_amount') IS NOT NULL AND ABS((p_approval_info->>'actual_amount')::numeric - COALESCE(v_result_record.actual_amount, 0)) > 0.005 THEN
    RAISE EXCEPTION 'Tampering detected: caller actual_amount does not match persisted result actual_amount' USING ERRCODE = '23514';
  END IF;

  IF (p_approval_info->>'expected_amount') IS NOT NULL AND ABS((p_approval_info->>'expected_amount')::numeric - COALESCE(v_result_record.expected_amount, 0)) > 0.005 THEN
    RAISE EXCEPTION 'Tampering detected: caller expected_amount does not match persisted result expected_amount' USING ERRCODE = '23514';
  END IF;

  -- Derive all financial, payable, and run attributes exclusively from persisted record
  v_result_id := v_result_record.id;
  v_run_id := v_result_record.run_id;
  v_company_id := v_result_record.company_id;
  v_payable_id := v_result_record.payable_id;
  v_payable_type := COALESCE(v_result_record.payable_type, 'dividend_payables');
  v_source_ref := v_result_record.source_reference;
  v_variance_type := UPPER(v_result_record.result::text);
  v_expected_amt := COALESCE(v_result_record.expected_amount, 0);
  v_actual_amt := COALESCE(v_result_record.actual_amount, 0);
  v_variance_amt := ABS(v_actual_amt - v_expected_amt);

  IF v_variance_type NOT IN ('UNDER_PAID', 'OVER_PAID', 'PARTIAL', 'DISCREPANCY') THEN
    RAISE EXCEPTION 'Reconciliation result % does not require variance approval (result: %)',
      v_result_id, v_variance_type USING ERRCODE = '23514';
  END IF;

  -- Enforce tenant access for non-service-role callers
  IF NOT v_is_service_role THEN
    IF NOT public.has_company_access(v_uid, v_company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to target company %', v_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Load run and determine maker
  SELECT id, company_id, created_by INTO v_run_record
  FROM public.reconciliation_runs
  WHERE id = v_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reconciliation run % not found', v_run_id USING ERRCODE = 'P0002';
  END IF;

  v_maker_id := COALESCE(v_result_record.matched_by, v_run_record.created_by);
  IF v_maker_id IS NULL AND v_is_service_role THEN
    v_maker_id := NULLIF(p_approval_info->>'maker_id', '')::uuid;
  END IF;

  -- Maker-Checker enforcement: Approver CANNOT be maker
  IF v_uid IS NOT NULL AND v_maker_id IS NOT NULL AND v_uid = v_maker_id THEN
    RAISE EXCEPTION 'Maker-checker policy violation: approver (%) cannot be the same user who created the run/variance (maker: %)',
      v_uid, v_maker_id USING ERRCODE = '42501';
  END IF;

  -- Immutable Append-Only Enforcement: Reject duplicate approval attempts
  IF EXISTS (
    SELECT 1 FROM public.reconciliation_variance_approvals
    WHERE run_id = v_run_id
      AND payable_id = v_payable_id
      AND COALESCE(source_reference, '') = COALESCE(v_source_ref, '')
  ) THEN
    RAISE EXCEPTION 'Variance has already been approved for run %, payable %, reference %. Approvals are immutable.',
      v_run_id, v_payable_id, COALESCE(v_source_ref, '') USING ERRCODE = '23505';
  END IF;

  -- Variance Limit enforcement
  IF NOT v_is_admin THEN
    IF v_variance_amt > c_max_supervisor_variance THEN
      RAISE EXCEPTION 'Variance limit exceeded: variance of % exceeds supervisor limit of %. Administrator approval required.',
        v_variance_amt, c_max_supervisor_variance USING ERRCODE = '23514';
    END IF;
    IF v_expected_amt > 0 AND (v_variance_amt / v_expected_amt * 100.0) > c_max_supervisor_pct THEN
      RAISE EXCEPTION 'Variance percentage limit exceeded: variance percentage of % exceeds supervisor limit of % percent. Administrator approval required.',
        ROUND(v_variance_amt / v_expected_amt * 100.0, 2), c_max_supervisor_pct USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Insert immutable approval record
  INSERT INTO public.reconciliation_variance_approvals (
    company_id,
    run_id,
    result_id,
    payable_id,
    payable_type,
    source_reference,
    variance_type,
    expected_amount,
    actual_amount,
    variance_amount,
    maker_id,
    approved_by,
    approval_reason
  ) VALUES (
    v_company_id,
    v_run_id,
    v_result_id,
    v_payable_id,
    v_payable_type,
    v_source_ref,
    v_variance_type,
    v_expected_amt,
    v_actual_amt,
    v_variance_amt,
    v_maker_id,
    v_uid,
    v_reason
  )
  RETURNING id INTO v_approval_id;

  -- Update persisted reconciliation_results status
  UPDATE public.reconciliation_results
  SET requires_manual_approval = false,
      notes = COALESCE(notes || '; ', '') || 'Variance approved by ' || v_uid::text || ' (' || v_reason || ')'
  WHERE id = v_result_id;

  RETURN jsonb_build_object(
    'success', true,
    'approval_id', v_approval_id,
    'result_id', v_result_id,
    'run_id', v_run_id,
    'payable_id', v_payable_id,
    'variance_amount', v_variance_amt,
    'approved_by', v_uid
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_reconciliation_variance_atomic(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_reconciliation_variance_atomic(jsonb) TO authenticated, service_role;

-- 8d. ATOMIC DRAFT RESULTS PERSISTENCE (save_reconciliation_draft_results_atomic)
CREATE OR REPLACE FUNCTION public.save_reconciliation_draft_results_atomic(
  p_run_info jsonb,
  p_results jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_company_id uuid;
  v_run_id uuid;
  v_res jsonb;
  v_saved_count int := 0;
  v_file_hash text;
  v_file_name text;
BEGIN
  IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');
  END IF;

  v_company_id := NULLIF(p_run_info->>'company_id', '')::uuid;
  IF v_company_id IS NOT NULL THEN
    IF current_user != 'service_role' AND current_user != 'postgres' AND COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') != 'service_role' THEN
      IF NOT public.has_company_access(v_uid, v_company_id) THEN
        RAISE EXCEPTION 'Unauthorized: caller lacks access to target company %', v_company_id USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  v_file_name := COALESCE(NULLIF(p_run_info->>'file_name', ''), 'manual-reconciliation');
  v_file_hash := COALESCE(NULLIF(p_run_info->>'file_hash_sha256', ''), md5(now()::text || p_run_info::text));

  v_run_id := NULLIF(p_run_info->>'run_id', '')::uuid;
  IF v_run_id IS NULL THEN
    INSERT INTO public.reconciliation_runs (
      company_id,
      fiscal_year,
      source_type,
      file_name,
      file_hash_sha256,
      row_count,
      total_amount,
      matched_count,
      partial_count,
      rejected_count,
      unmatched_count,
      status,
      created_by
    ) VALUES (
      v_company_id,
      NULLIF(p_run_info->>'fiscal_year', ''),
      COALESCE(NULLIF(p_run_info->>'source_type', ''), 'manual'),
      v_file_name,
      v_file_hash,
      COALESCE(NULLIF(p_run_info->>'row_count', '')::int, jsonb_array_length(p_results)),
      COALESCE(NULLIF(p_run_info->>'total_amount', '')::numeric, 0),
      COALESCE(NULLIF(p_run_info->>'matched_count', '')::int, 0),
      COALESCE(NULLIF(p_run_info->>'partial_count', '')::int, 0),
      COALESCE(NULLIF(p_run_info->>'rejected_count', '')::int, 0),
      COALESCE(NULLIF(p_run_info->>'unmatched_count', '')::int, 0),
      'draft',
      v_uid
    ) RETURNING id INTO v_run_id;
  END IF;

  FOR v_res IN SELECT * FROM jsonb_array_elements(p_results)
  LOOP
    INSERT INTO public.reconciliation_results (
      run_id,
      reconciliation_date,
      source_reference,
      source_a_type,
      source_a_id,
      source_b_type,
      source_b_id,
      client_id,
      company_id,
      payable_type,
      payable_id,
      expected_amount,
      actual_amount,
      difference,
      result,
      notes,
      requires_manual_approval,
      match_method,
      match_confidence,
      rule_version,
      matched_by
    ) VALUES (
      v_run_id,
      COALESCE(NULLIF(v_res->>'reconciliation_date', '')::date, CURRENT_DATE),
      NULLIF(v_res->>'source_reference', ''),
      COALESCE(NULLIF(v_res->>'source_a_type', ''), 'bank_statement'),
      NULLIF(v_res->>'source_a_id', '')::uuid,
      COALESCE(NULLIF(v_res->>'source_b_type', ''), 'payable'),
      NULLIF(v_res->>'source_b_id', '')::uuid,
      NULLIF(v_res->>'client_id', '')::uuid,
      v_company_id,
      NULLIF(v_res->>'payable_type', ''),
      NULLIF(v_res->>'payable_id', '')::uuid,
      COALESCE(NULLIF(v_res->>'expected_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_res->>'actual_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_res->>'difference', '')::numeric, 0),
      CASE UPPER(COALESCE(v_res->>'result', 'NOT_MATCHED'))
        WHEN 'MATCHED' THEN 'Matched'::public.reconciliation_result
        WHEN 'PARTIAL' THEN 'Partial'::public.reconciliation_result
        WHEN 'UNDER_PAID' THEN 'Under_Paid'::public.reconciliation_result
        WHEN 'OVER_PAID' THEN 'Over_Paid'::public.reconciliation_result
        WHEN 'EXCEPTION' THEN 'Exception'::public.reconciliation_result
        WHEN 'REJECTED' THEN 'Exception'::public.reconciliation_result
        WHEN 'DUPLICATE' THEN 'Duplicate'::public.reconciliation_result
        ELSE 'Not_Matched'::public.reconciliation_result
      END,
      NULLIF(v_res->>'notes', ''),
      CASE WHEN UPPER(COALESCE(v_res->>'result', '')) IN ('UNDER_PAID', 'OVER_PAID', 'PARTIAL') THEN true ELSE false END,
      COALESCE(NULLIF(v_res->>'match_method', ''), 'manual'),
      COALESCE(NULLIF(v_res->>'match_confidence', '')::numeric, 100),
      COALESCE(NULLIF(v_res->>'rule_version', ''), '2.0.0'),
      v_uid
    );
    v_saved_count := v_saved_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id,
    'saved_count', v_saved_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_reconciliation_draft_results_atomic(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_reconciliation_draft_results_atomic(jsonb, jsonb) TO authenticated, service_role;

-- 8d. DURABLE SENSITIVE IDENTIFIER REVEAL AUDIT RPC
CREATE OR REPLACE FUNCTION public.record_sensitive_reveal_audit(
  p_client_id uuid,
  p_company_id uuid DEFAULT NULL,
  p_purpose text DEFAULT 'classification_explainability_inspection'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required for sensitive data inspection' USING ERRCODE = '42501';
  END IF;

  PERFORM public.require_role('admin', 'supervisor', 'approver', 'auditor');

  INSERT INTO public.audit_logs (
    user_id,
    action,
    table_name,
    record_id,
    old_value,
    new_value,
    action_time
  ) VALUES (
    v_uid,
    'SENSITIVE_IDENTIFIER_REVEAL',
    'clients',
    p_client_id::text,
    null,
    jsonb_build_object(
      'company_id', p_company_id,
      'purpose', p_purpose,
      'revealed_at', now()
    ),
    now()
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_sensitive_reveal_audit(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_sensitive_reveal_audit(uuid, uuid, text) TO authenticated, service_role;
