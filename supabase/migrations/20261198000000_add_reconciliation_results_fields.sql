-- Migration to enhance reconciliation_results table with missing tracking columns and indices
ALTER TABLE reconciliation_results
  ADD COLUMN IF NOT EXISTS fiscal_year TEXT,
  ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES payment_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reconciliation_results_payable_id ON reconciliation_results (payable_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_results_payment_id ON reconciliation_results (payment_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_results_client_id ON reconciliation_results (client_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_results_company_id ON reconciliation_results (company_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_results_date ON reconciliation_results (reconciliation_date);
