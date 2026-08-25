-- Enable RLS and add full CRUD policies for reconciliation_results
ALTER TABLE reconciliation_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rr_read ON reconciliation_results;
CREATE POLICY rr_read ON reconciliation_results FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rr_write ON reconciliation_results;
CREATE POLICY rr_write ON reconciliation_results FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS rr_update ON reconciliation_results;
CREATE POLICY rr_update ON reconciliation_results FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS rr_delete ON reconciliation_results;
CREATE POLICY rr_delete ON reconciliation_results FOR DELETE TO authenticated USING (true);
