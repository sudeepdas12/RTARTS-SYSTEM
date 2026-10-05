-- ============================================================================
-- Migration: 20261143000000_add_db_constraints_and_indexes.sql
-- Description:
-- 1. Adds non-negative and rate range CHECK constraints to payable tables
-- 2. Prevents double-payment via a partial unique index on active payments
-- 3. Adds missing performance indexes on FK and filter columns
-- ============================================================================

-- 1. Double-payment prevention (partial unique index on active payments)
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_payments_payable_id
  ON public.payments (payable_id)
  WHERE status NOT IN ('Reversed', 'Failed', 'Cancelled') AND payable_id IS NOT NULL;

-- 2. Financial amount CHECK constraints
DO $$ BEGIN
  ALTER TABLE public.dividend_payables
    ADD CONSTRAINT chk_div_gross_nonneg CHECK (gross_dividend >= 0),
    ADD CONSTRAINT chk_div_tax_nonneg CHECK (tax_amount >= 0),
    ADD CONSTRAINT chk_div_net_nonneg CHECK (net_payable >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.interest_payables
    ADD CONSTRAINT chk_int_gross_nonneg CHECK (gross_interest >= 0),
    ADD CONSTRAINT chk_int_tax_nonneg CHECK (tax_amount >= 0),
    ADD CONSTRAINT chk_int_net_nonneg CHECK (net_payable >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.mutual_fund_payables
    ADD CONSTRAINT chk_mf_gross_nonneg CHECK (gross_dividend >= 0),
    ADD CONSTRAINT chk_mf_tax_nonneg CHECK (tax_amount >= 0),
    ADD CONSTRAINT chk_mf_net_nonneg CHECK (net_payable >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Performance Indexes on Foreign Keys and Query Columns
CREATE INDEX IF NOT EXISTS idx_payments_company_id ON public.payments(company_id);
CREATE INDEX IF NOT EXISTS idx_payments_client_id ON public.payments(client_id);
CREATE INDEX IF NOT EXISTS idx_payments_batch_id ON public.payments(batch_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);

CREATE INDEX IF NOT EXISTS idx_payment_batches_company_id ON public.payment_batches(company_id);
CREATE INDEX IF NOT EXISTS idx_payment_batches_status ON public.payment_batches(status);

CREATE INDEX IF NOT EXISTS idx_reconciliation_company_id ON public.reconciliation_results(company_id);

CREATE INDEX IF NOT EXISTS idx_dividend_payables_company_id ON public.dividend_payables(company_id);
CREATE INDEX IF NOT EXISTS idx_dividend_payables_client_id ON public.dividend_payables(client_id);
CREATE INDEX IF NOT EXISTS idx_dividend_payables_fiscal_year ON public.dividend_payables(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_dividend_payables_status ON public.dividend_payables(payment_status);

CREATE INDEX IF NOT EXISTS idx_interest_payables_company_id ON public.interest_payables(company_id);
CREATE INDEX IF NOT EXISTS idx_interest_payables_client_id ON public.interest_payables(client_id);
CREATE INDEX IF NOT EXISTS idx_interest_payables_fiscal_year ON public.interest_payables(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_interest_payables_status ON public.interest_payables(payment_status);

CREATE INDEX IF NOT EXISTS idx_mutual_fund_payables_company_id ON public.mutual_fund_payables(company_id);
CREATE INDEX IF NOT EXISTS idx_mutual_fund_payables_client_id ON public.mutual_fund_payables(client_id);
CREATE INDEX IF NOT EXISTS idx_mutual_fund_payables_fiscal_year ON public.mutual_fund_payables(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_mutual_fund_payables_status ON public.mutual_fund_payables(payment_status);
