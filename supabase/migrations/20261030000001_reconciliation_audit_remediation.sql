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
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
);

CREATE POLICY bs_write ON public.bank_statements FOR INSERT TO authenticated WITH CHECK (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
);

CREATE POLICY bs_update ON public.bank_statements FOR UPDATE TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
);

CREATE POLICY bs_delete ON public.bank_statements FOR DELETE TO authenticated USING (
  (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
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
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
);

CREATE POLICY bt_write ON public.bank_transactions FOR INSERT TO authenticated WITH CHECK (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
);

CREATE POLICY bt_update ON public.bank_transactions FOR UPDATE TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
);

CREATE POLICY bt_delete ON public.bank_transactions FOR DELETE TO authenticated USING (
  (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
);

-- ============================================================================
-- 2. DEDICATED RECONCILIATION RUNS TABLE (FILE IDENTITY & AUDIT TRAIL)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
    fiscal_year text,
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
    status text DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'applied', 'reverted', 'failed')),
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

CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_company_id ON public.reconciliation_runs(company_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_file_hash ON public.reconciliation_runs(file_hash_sha256);
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
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
);

DROP POLICY IF EXISTS recon_runs_write ON public.reconciliation_runs;
CREATE POLICY recon_runs_write ON public.reconciliation_runs FOR INSERT TO authenticated WITH CHECK (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'finance_operator'::public.app_role,
    'reconciliation_officer'::public.app_role
  ]))
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
);

DROP POLICY IF EXISTS recon_runs_update ON public.reconciliation_runs;
CREATE POLICY recon_runs_update ON public.reconciliation_runs FOR UPDATE TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'supervisor'::public.app_role,
    'finance_operator'::public.app_role,
    'reconciliation_officer'::public.app_role
  ]))
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
);

DROP POLICY IF EXISTS recon_runs_delete ON public.reconciliation_runs;
CREATE POLICY recon_runs_delete ON public.reconciliation_runs FOR DELETE TO authenticated USING (
  (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
);

-- ============================================================================
-- 3. LINK PAYMENTS & RECONCILIATION RESULTS TO RUNS & EXPLAINABILITY
-- ============================================================================

-- Track unique reconciliation run on generated payments
ALTER TABLE public.payments 
  ADD COLUMN IF NOT EXISTS reconciliation_run_id uuid REFERENCES public.reconciliation_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_reconciliation_run_id 
  ON public.payments(reconciliation_run_id);

-- Enrich reconciliation_results with run reference & explainability decision model
ALTER TABLE public.reconciliation_results 
  ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES public.reconciliation_runs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS match_method text,
  ADD COLUMN IF NOT EXISTS match_confidence numeric(5,2),
  ADD COLUMN IF NOT EXISTS candidate_count integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS rejected_candidates jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rule_version text DEFAULT '2.0.0',
  ADD COLUMN IF NOT EXISTS requires_manual_approval boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_reconciliation_results_run_id 
  ON public.reconciliation_results(run_id);

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

CREATE INDEX IF NOT EXISTS idx_bank_statement_imports_company ON public.bank_statement_imports(company_id);
CREATE INDEX IF NOT EXISTS idx_bank_statement_imports_hash ON public.bank_statement_imports(file_hash_sha256);

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
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
);

CREATE POLICY bsi_write ON public.bank_statement_imports FOR INSERT TO authenticated WITH CHECK (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
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
    reconciliation_status text DEFAULT 'unreconciled' CHECK (reconciliation_status IN ('unreconciled', 'matched', 'ignored', 'exception')),
    reconciliation_run_id uuid REFERENCES public.reconciliation_runs(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT uq_bank_txn_fingerprint UNIQUE (company_id, transaction_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_bank_stmt_txns_import ON public.bank_statement_transactions(import_id);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_txns_company ON public.bank_statement_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_txns_status ON public.bank_statement_transactions(reconciliation_status);

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
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
);

CREATE POLICY bst_write ON public.bank_statement_transactions FOR INSERT TO authenticated WITH CHECK (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
);

CREATE POLICY bst_update ON public.bank_statement_transactions FOR UPDATE TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role
  ]))
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
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
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
);

CREATE POLICY re_write ON public.reconciliation_exceptions FOR INSERT TO authenticated WITH CHECK (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role,
    'supervisor'::public.app_role
  ]))
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
);

CREATE POLICY re_update ON public.reconciliation_exceptions FOR UPDATE TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
    'admin'::public.app_role,
    'reconciliation_officer'::public.app_role,
    'finance_operator'::public.app_role,
    'supervisor'::public.app_role
  ]))
  AND (company_id IS NULL OR public.has_company_access((SELECT auth.uid()), company_id))
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
  
  v_payables_updated int := 0;
  v_payments_created int := 0;
  v_results_inserted int := 0;
  v_exceptions_created int := 0;
  v_already_paid int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_total_amount numeric := 0;
BEGIN
  -- 1. Authorization check
  IF current_user != 'service_role' AND current_user != 'postgres' THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');
  END IF;

  v_company_id := NULLIF(p_run_info->>'company_id', '')::uuid;
  v_fiscal_year := NULLIF(p_run_info->>'fiscal_year', '');

  -- Tenant check
  IF current_user != 'service_role' AND v_company_id IS NOT NULL THEN
    IF NOT public.has_company_access(v_uid, v_company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to target company %', v_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Create or reuse reconciliation_run record
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
      parser_version,
      matching_rule_version,
      status,
      applied_by,
      applied_at,
      created_by
    ) VALUES (
      v_company_id,
      v_fiscal_year,
      COALESCE(NULLIF(p_run_info->>'source_type', ''), 'excel'),
      COALESCE(NULLIF(p_run_info->>'file_name', ''), 'Reconciliation Batch'),
      COALESCE(NULLIF(p_run_info->>'file_hash_sha256', ''), md5(now()::text || p_run_info::text)),
      COALESCE(NULLIF(p_run_info->>'row_count', '')::int, jsonb_array_length(p_items)),
      COALESCE(NULLIF(p_run_info->>'total_amount', '')::numeric, 0),
      COALESCE(NULLIF(p_run_info->>'parser_version', ''), '2.0.0'),
      COALESCE(NULLIF(p_run_info->>'matching_rule_version', ''), '2.0.0'),
      'applied',
      v_uid,
      now(),
      v_uid
    ) RETURNING id INTO v_run_id;
  ELSE
    UPDATE public.reconciliation_runs
    SET status = 'applied',
        applied_by = v_uid,
        applied_at = now(),
        updated_at = now()
    WHERE id = v_run_id;
  END IF;

  -- 3. Create or Link Payment Batch if requested
  IF p_batch_info IS NOT NULL AND jsonb_typeof(p_batch_info) = 'object' THEN
    v_batch_id := NULLIF(p_batch_info->>'batch_id', '')::uuid;
    IF v_batch_id IS NULL THEN
      INSERT INTO public.payment_batches (
        batch_name,
        batch_type,
        company_id,
        status,
        cds_batch_ref,
        total_records,
        total_net,
        total_tax,
        created_by
      ) VALUES (
        COALESCE(NULLIF(p_batch_info->>'batch_name', ''), 'Reconciliation Auto-Batch ' || to_char(now(), 'YYYY-MM-DD')),
        COALESCE(NULLIF(p_batch_info->>'payable_type', ''), 'dividend'),
        v_company_id,
        'Processing',
        COALESCE(NULLIF(p_batch_info->>'cds_batch_ref', ''), 'RECON-APPLY'),
        COALESCE(NULLIF(p_batch_info->>'total_records', '')::int, 0),
        COALESCE(NULLIF(p_batch_info->>'total_net', '')::numeric, 0),
        COALESCE(NULLIF(p_batch_info->>'total_tax', '')::numeric, 0),
        v_uid
      ) RETURNING id INTO v_batch_id;

      -- Update run with linked batch
      UPDATE public.reconciliation_runs SET batch_id = v_batch_id WHERE id = v_run_id;
    END IF;
  END IF;

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

      v_paid_amt := CASE WHEN v_actual_amt > 0 THEN v_actual_amt ELSE v_expected_amt END;
      v_total_amount := v_total_amount + v_paid_amt;

      -- A. Settle payable if payable_id exists and status is MATCHED / PARTIAL
      IF v_payable_id IS NOT NULL AND v_result IN ('MATCHED', 'PARTIAL', 'OVER_PAID', 'UNDER_PAID') THEN
        IF v_target_table LIKE '%dividend%' THEN
          -- Lock row FOR UPDATE to prevent race conditions
          PERFORM 1 FROM public.dividend_payables WHERE id = v_payable_id FOR UPDATE;

          UPDATE public.dividend_payables
          SET payment_status = CASE WHEN v_result = 'PARTIAL' THEN 'Partial'::public.payment_status ELSE 'Paid'::public.payment_status END,
              paid_amount = COALESCE(paid_amount, 0) + v_paid_amt,
              remaining_amount = GREATEST(0, COALESCE(net_payable, 0) - (COALESCE(paid_amount, 0) + v_paid_amt)),
              payment_date = COALESCE(payment_date, CURRENT_DATE),
              payment_reference = COALESCE(payment_reference, v_payment_ref),
              updated_at = now()
          WHERE id = v_payable_id
            AND payment_status != 'Paid';

          IF FOUND THEN
            v_payables_updated := v_payables_updated + 1;
          ELSE
            v_already_paid := v_already_paid + 1;
          END IF;

        ELSIF v_target_table LIKE '%interest%' OR v_target_table LIKE '%debenture%' THEN
          PERFORM 1 FROM public.interest_payables WHERE id = v_payable_id FOR UPDATE;

          UPDATE public.interest_payables
          SET payment_status = CASE WHEN v_result = 'PARTIAL' THEN 'Partial'::public.payment_status ELSE 'Paid'::public.payment_status END,
              paid_amount = COALESCE(paid_amount, 0) + v_paid_amt,
              remaining_amount = GREATEST(0, COALESCE(net_payable, 0) - (COALESCE(paid_amount, 0) + v_paid_amt)),
              payment_date = COALESCE(payment_date, CURRENT_DATE),
              payment_reference = COALESCE(payment_reference, v_payment_ref),
              updated_at = now()
          WHERE id = v_payable_id
            AND payment_status != 'Paid';

          IF FOUND THEN
            v_payables_updated := v_payables_updated + 1;
          ELSE
            v_already_paid := v_already_paid + 1;
          END IF;

        ELSIF v_target_table LIKE '%mutual%' THEN
          PERFORM 1 FROM public.mutual_fund_payables WHERE id = v_payable_id FOR UPDATE;

          UPDATE public.mutual_fund_payables
          SET payment_status = 'Paid'::public.payment_status,
              payment_date = COALESCE(payment_date, CURRENT_DATE),
              payment_reference = COALESCE(payment_reference, v_payment_ref),
              updated_at = now()
          WHERE id = v_payable_id
            AND payment_status != 'Paid';

          IF FOUND THEN
            v_payables_updated := v_payables_updated + 1;
          ELSE
            v_already_paid := v_already_paid + 1;
          END IF;
        END IF;

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
          v_expected_amt,
          0,
          v_paid_amt,
          v_paid_amt,
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

      -- B. Persist result record in reconciliation_results linked to run_id
      INSERT INTO public.reconciliation_results (
        run_id,
        reconciliation_date,
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
        matched_by,
        matched_at
      ) VALUES (
        v_run_id,
        CURRENT_DATE,
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
        v_result::public.reconciliation_result,
        v_notes,
        v_match_method,
        v_confidence,
        COALESCE(NULLIF(v_item->>'candidate_count', '')::int, 1),
        COALESCE(v_item->'rejected_candidates', '[]'::jsonb),
        v_rule_ver,
        v_uid,
        now()
      );
      v_results_inserted := v_results_inserted + 1;

      -- C. If exception/unmatched, record durable exception
      IF v_result IN ('MISSING', 'REJECTED', 'EXCEPTION') OR v_diff != 0 THEN
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
          COALESCE(v_payment_ref, v_instruction_id),
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
      v_errors := v_errors || jsonb_build_object(
        'payable_id', v_item->>'payable_id',
        'error', SQLERRM,
        'code', SQLSTATE
      );
    END;
  END LOOP;

  -- 5. Update run stats
  UPDATE public.reconciliation_runs
  SET matched_count = v_payables_updated,
      unmatched_count = v_exceptions_created,
      total_amount = GREATEST(total_amount, v_total_amount),
      updated_at = now()
  WHERE id = v_run_id;

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
      'already_paid_skipped', v_already_paid
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
  v_reverted_payables int := 0;
  v_deleted_payments int := 0;
  v_deleted_results int := 0;
  v_payable_record record;
BEGIN
  -- 1. Authorization check
  PERFORM public.require_role('admin', 'supervisor');

  -- 2. Fetch run record
  SELECT * INTO v_run FROM public.reconciliation_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reconciliation run % not found', p_run_id USING ERRCODE = 'P0002';
  END IF;

  -- Verify tenant access
  IF current_user != 'service_role' AND v_run.company_id IS NOT NULL THEN
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

  -- 4. Revert ONLY payables linked to this run
  FOR v_payable_record IN (
    SELECT DISTINCT payable_type, payable_id, expected_amount, actual_amount
    FROM public.reconciliation_results
    WHERE run_id = p_run_id AND payable_id IS NOT NULL
  ) LOOP
    IF LOWER(v_payable_record.payable_type) LIKE '%dividend%' THEN
      UPDATE public.dividend_payables
      SET payment_status = 'Pending'::public.payment_status,
          paid_amount = 0,
          remaining_amount = net_payable,
          payment_date = NULL,
          payment_reference = NULL,
          updated_at = now()
      WHERE id = v_payable_record.payable_id;
      IF FOUND THEN v_reverted_payables := v_reverted_payables + 1; END IF;

    ELSIF LOWER(v_payable_record.payable_type) LIKE '%interest%' OR LOWER(v_payable_record.payable_type) LIKE '%debenture%' THEN
      UPDATE public.interest_payables
      SET payment_status = 'Pending'::public.payment_status,
          paid_amount = 0,
          remaining_amount = net_payable,
          payment_date = NULL,
          payment_reference = NULL,
          updated_at = now()
      WHERE id = v_payable_record.payable_id;
      IF FOUND THEN v_reverted_payables := v_reverted_payables + 1; END IF;

    ELSIF LOWER(v_payable_record.payable_type) LIKE '%mutual%' THEN
      UPDATE public.mutual_fund_payables
      SET payment_status = 'Pending'::public.payment_status,
          payment_date = NULL,
          payment_reference = NULL,
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
  v_div_ids uuid[];
  v_int_ids uuid[];
  v_mf_ids uuid[];
  v_payment_ids uuid[];
  v_completed_count int := 0;
BEGIN
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');

  -- Verify caller has access to the companies of these reconciliation records
  IF current_user != 'service_role' THEN
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

  -- 2. Extract payable IDs grouped by type
  SELECT COALESCE(array_agg(payable_id), '{}') INTO v_div_ids
  FROM public.reconciliation_results
  WHERE id = ANY(p_result_ids) AND LOWER(COALESCE(payable_type, '')) = 'dividend' AND payable_id IS NOT NULL;

  SELECT COALESCE(array_agg(payable_id), '{}') INTO v_int_ids
  FROM public.reconciliation_results
  WHERE id = ANY(p_result_ids) AND LOWER(COALESCE(payable_type, '')) IN ('interest', 'debenture') AND payable_id IS NOT NULL;

  SELECT COALESCE(array_agg(payable_id), '{}') INTO v_mf_ids
  FROM public.reconciliation_results
  WHERE id = ANY(p_result_ids) AND LOWER(COALESCE(payable_type, '')) = 'mutual_fund' AND payable_id IS NOT NULL;

  -- 3. Reset payables back to Pending
  IF array_length(v_div_ids, 1) > 0 THEN
    UPDATE public.dividend_payables
    SET payment_status = 'Pending'::public.payment_status,
        paid_amount = 0,
        remaining_amount = net_payable,
        payment_date = NULL,
        payment_reference = NULL,
        updated_at = now()
    WHERE id = ANY(v_div_ids);
    v_reverted_payables := v_reverted_payables + array_length(v_div_ids, 1);
  END IF;

  IF array_length(v_int_ids, 1) > 0 THEN
    UPDATE public.interest_payables
    SET payment_status = 'Pending'::public.payment_status,
        paid_amount = 0,
        remaining_amount = net_payable,
        payment_date = NULL,
        payment_reference = NULL,
        updated_at = now()
    WHERE id = ANY(v_int_ids);
    v_reverted_payables := v_reverted_payables + array_length(v_int_ids, 1);
  END IF;

  IF array_length(v_mf_ids, 1) > 0 THEN
    UPDATE public.mutual_fund_payables
    SET payment_status = 'Pending'::public.payment_status,
        payment_date = NULL,
        payment_reference = NULL,
        updated_at = now()
    WHERE id = ANY(v_mf_ids);
    v_reverted_payables := v_reverted_payables + array_length(v_mf_ids, 1);
  END IF;

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
    AND (rr.company_id IS NULL OR public.has_company_access(v_uid, rr.company_id));

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
    AND (rr.company_id IS NULL OR public.has_company_access(v_uid, rr.company_id));

  -- Paginated records query
  SELECT COALESCE(jsonb_agg(to_jsonb(r_sub)), '[]'::jsonb) INTO v_runs
  FROM (
    SELECT 
      rr.id,
      rr.company_id,
      c.name as company_name,
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
      AND (rr.company_id IS NULL OR public.has_company_access(v_uid, rr.company_id))
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
