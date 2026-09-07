-- Restrict all DELETE policies across the system to admin role only

ALTER TABLE reconciliation_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rr_delete ON reconciliation_results;
CREATE POLICY rr_delete ON reconciliation_results FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE payment_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pb_delete ON payment_batches;
CREATE POLICY pb_delete ON payment_batches FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_delete ON payments;
CREATE POLICY payments_delete ON payments FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE upload_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS uh_delete ON upload_history;
CREATE POLICY uh_delete ON upload_history FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE upload_errors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ue_delete ON upload_errors;
CREATE POLICY ue_delete ON upload_errors FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE pending_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pa_delete ON pending_approvals;
CREATE POLICY pa_delete ON pending_approvals FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bt_delete ON bank_transactions;
CREATE POLICY bt_delete ON bank_transactions FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE bank_statements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bs_delete ON bank_statements;
CREATE POLICY bs_delete ON bank_statements FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clients_delete ON clients;
CREATE POLICY clients_delete ON clients FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS companies_delete ON companies;
CREATE POLICY companies_delete ON companies FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE dividend_payables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dp_delete ON dividend_payables;
CREATE POLICY dp_delete ON dividend_payables FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE interest_payables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ip_delete ON interest_payables;
CREATE POLICY ip_delete ON interest_payables FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE mutual_fund_payables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfp_delete ON mutual_fund_payables;
CREATE POLICY mfp_delete ON mutual_fund_payables FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));
