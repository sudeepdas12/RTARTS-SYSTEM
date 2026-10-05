-- =========================================================
-- Restrict INSERT on payments and reconciliation_results
-- so only authorized roles can create payment records and
-- reconciliation results (defense-in-depth alongside the
-- UI-level role check in the reconciliation route).
-- =========================================================

-- payments: only admin, finance_operator, reconciliation_officer can insert
DROP POLICY IF EXISTS pay_write ON payments;
CREATE POLICY pay_write ON payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'finance_operator'::app_role, 'reconciliation_officer'::app_role])
  );

-- reconciliation_results: only admin, reconciliation_officer can insert
DROP POLICY IF EXISTS rr_write ON reconciliation_results;
CREATE POLICY rr_write ON reconciliation_results
  FOR INSERT
  TO authenticated
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'reconciliation_officer'::app_role])
  );
