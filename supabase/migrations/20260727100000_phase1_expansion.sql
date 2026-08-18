-- =========================================================
-- Phase 1 — Foundation Enhancement & Database Expansion
-- =========================================================

-- New ENUM types
DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('NEFT','RTGS','ConnectIPS','Cheque','Cash','Manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_batch_status AS ENUM ('Draft','Approved','Processed','Completed','Failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE notification_channel AS ENUM ('Email','SMS','System');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE reconciliation_result AS ENUM ('Matched','Not_Matched','Missing','Duplicate','Over_Paid','Under_Paid','Pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dividend_type AS ENUM ('Cash','Stock','Bonus','Right');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE interest_rate_type AS ENUM ('Fixed_6','Fixed_6_25','Fixed_7','Fixed_7_5','Floating','Variable_Coupon');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================
-- 1. UPLOAD HISTORY (dedicated table)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.upload_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  file_hash TEXT,                                  -- SHA256 for duplicate detection
  file_type TEXT,                                  -- 'dividend','interest','debenture','bonus_share','cash_dividend','right_share'
  sheet_name TEXT,
  total_rows INT NOT NULL DEFAULT 0,
  success_rows INT NOT NULL DEFAULT 0,
  error_rows INT NOT NULL DEFAULT 0,
  target_table TEXT,                               -- the DB table imported into
  status TEXT NOT NULL DEFAULT 'Processing',       -- Processing / Completed / Failed / RolledBack
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.upload_history TO authenticated;
GRANT ALL ON public.upload_history TO service_role;
ALTER TABLE public.upload_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "uh_read" ON public.upload_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "uh_write" ON public.upload_history FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "uh_update" ON public.upload_history FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- =========================================================
-- 2. UPLOAD ERRORS
-- =========================================================
CREATE TABLE IF NOT EXISTS public.upload_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES public.upload_history(id) ON DELETE CASCADE,
  row_number INT NOT NULL,
  field_name TEXT,
  error_type TEXT NOT NULL,                        -- 'validation','duplicate','missing','format','system'
  error_message TEXT NOT NULL,
  raw_data JSONB,                                  -- the original row data
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.upload_errors TO authenticated;
GRANT ALL ON public.upload_errors TO service_role;
ALTER TABLE public.upload_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ue_read" ON public.upload_errors FOR SELECT TO authenticated USING (true);
CREATE POLICY "ue_write" ON public.upload_errors FOR INSERT TO authenticated WITH CHECK (true);

-- =========================================================
-- 3. PAYMENTS
-- =========================================================
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID,
  company_id UUID REFERENCES public.companies(id),
  client_id UUID REFERENCES public.clients(id),
  payable_type TEXT NOT NULL,                       -- 'interest_payables' or 'dividend_payables'
  payable_id UUID NOT NULL,
  gross_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  payment_method public.payment_method,
  payment_date DATE,
  payment_reference TEXT,
  bank_name TEXT,
  bank_account_no TEXT,
  neft_ref TEXT,
  connectips_ref TEXT,
  rtgs_ref TEXT,
  cheque_no TEXT,
  remarks TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',           -- Pending / Approved / Processed / Failed / Reversed / Returned
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  processed_by UUID REFERENCES auth.users(id),
  processed_at TIMESTAMPTZ,
  reversed_by UUID REFERENCES auth.users(id),
  reversed_at TIMESTAMPTZ,
  reversal_reason TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_batch ON public.payments(batch_id);
CREATE INDEX IF NOT EXISTS idx_payments_payable ON public.payments(payable_id, payable_type);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pay_read" ON public.payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "pay_write" ON public.payments FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_operator']::public.app_role[]));
CREATE POLICY "pay_update" ON public.payments FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_operator','reconciliation_officer']::public.app_role[]));

-- =========================================================
-- 4. PAYMENT BATCHES
-- =========================================================
CREATE TABLE IF NOT EXISTS public.payment_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_name TEXT NOT NULL,
  company_id UUID REFERENCES public.companies(id),
  fiscal_year TEXT,
  payable_type TEXT,                                -- 'interest_payables' or 'dividend_payables'
  total_payments INT NOT NULL DEFAULT 0,
  total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  status public.payment_batch_status NOT NULL DEFAULT 'Draft',
  neft_file_url TEXT,
  connectips_file_url TEXT,
  rtgs_file_url TEXT,
  created_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_batches TO authenticated;
GRANT ALL ON public.payment_batches TO service_role;
ALTER TABLE public.payment_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pb_read" ON public.payment_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY "pb_write" ON public.payment_batches FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_operator']::public.app_role[]));
CREATE POLICY "pb_update" ON public.payment_batches FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_operator']::public.app_role[]));

-- =========================================================
-- 5. NOTIFICATIONS
-- =========================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  channel public.notification_channel NOT NULL DEFAULT 'System',
  category TEXT,                                    -- 'interest_due','dividend_due','approval_pending','upload_failed','payment_failed','payment_success'
  reference_type TEXT,                              -- 'payment','upload','approval'
  reference_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_read ON public.notifications(is_read);
GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_read" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notif_insert" ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "notif_update" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- =========================================================
-- 6. NOTIFICATION CONFIG / TEMPLATES
-- =========================================================
CREATE TABLE IF NOT EXISTS public.notification_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL UNIQUE,
  email_enabled BOOLEAN NOT NULL DEFAULT false,
  sms_enabled BOOLEAN NOT NULL DEFAULT false,
  system_enabled BOOLEAN NOT NULL DEFAULT true,
  email_template TEXT,
  sms_template TEXT,
  email_recipients TEXT[],                          -- additional recipients
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.notification_configs TO authenticated;
GRANT ALL ON public.notification_configs TO service_role;
ALTER TABLE public.notification_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nc_read" ON public.notification_configs FOR SELECT TO authenticated USING (true);
CREATE POLICY "nc_admin" ON public.notification_configs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- 7. SYSTEM SETTINGS
-- =========================================================
CREATE TABLE IF NOT EXISTS public.system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key TEXT NOT NULL UNIQUE,
  setting_value JSONB NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.system_settings TO authenticated;
GRANT ALL ON public.system_settings TO service_role;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ss_read" ON public.system_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "ss_admin" ON public.system_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed default settings
INSERT INTO public.system_settings (setting_key, setting_value, description) VALUES
  ('tax_rate', '{"tds_interest": 6, "tds_dividend": 5, "corporate_tax": 25}', 'Tax rates in percentage'),
  ('interest_rates', '{"fixed_6": 6, "fixed_6_25": 6.25, "fixed_7": 7, "fixed_7_5": 7.5, "floating_base": 5}', 'Interest rate templates'),
  ('number_format', '{"decimal_places": 2, "thousands_separator": true}', 'Number formatting'),
  ('date_format', '{"format": "YYYY-MM-DD", "nepali_date_enabled": false}', 'Date formatting'),
  ('approval_levels', '{"maker_checker": true, "levels": 1}', 'Approval workflow config')
ON CONFLICT (setting_key) DO NOTHING;

-- =========================================================
-- 8. RECONCILIATION RESULTS
-- =========================================================
CREATE TABLE IF NOT EXISTS public.reconciliation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  source_a_type TEXT NOT NULL,                      -- 'excel','database','payment_file','bank_statement','cdsc'
  source_a_id UUID,
  source_b_type TEXT NOT NULL,
  source_b_id UUID,
  client_id UUID REFERENCES public.clients(id),
  company_id UUID REFERENCES public.companies(id),
  payable_type TEXT,
  payable_id UUID,
  expected_amount NUMERIC(15,2),
  actual_amount NUMERIC(15,2),
  difference NUMERIC(15,2) DEFAULT 0,
  result public.reconciliation_result NOT NULL DEFAULT 'Pending',
  notes TEXT,
  matched_by UUID REFERENCES auth.users(id),
  matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recon_result ON public.reconciliation_results(result);
CREATE INDEX IF NOT EXISTS idx_recon_date ON public.reconciliation_results(reconciliation_date);
GRANT SELECT, INSERT, UPDATE ON public.reconciliation_results TO authenticated;
GRANT ALL ON public.reconciliation_results TO service_role;
ALTER TABLE public.reconciliation_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rr_read" ON public.reconciliation_results FOR SELECT TO authenticated USING (true);
CREATE POLICY "rr_write" ON public.reconciliation_results FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','reconciliation_officer']::public.app_role[]));
CREATE POLICY "rr_update" ON public.reconciliation_results FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','reconciliation_officer']::public.app_role[]));

-- =========================================================
-- 9. BANK STATEMENTS (uploaded)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.bank_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name TEXT NOT NULL,
  account_no TEXT NOT NULL,
  statement_date DATE NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT,
  total_transactions INT NOT NULL DEFAULT 0,
  total_debit NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_credit NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_reconciled BOOLEAN NOT NULL DEFAULT false,
  reconciled_at TIMESTAMPTZ,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.bank_statements TO authenticated;
GRANT ALL ON public.bank_statements TO service_role;
ALTER TABLE public.bank_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bs_read" ON public.bank_statements FOR SELECT TO authenticated USING (true);
CREATE POLICY "bs_write" ON public.bank_statements FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','reconciliation_officer']::public.app_role[]));

-- =========================================================
-- 10. LOG TABLES
-- =========================================================

-- 10a. Login Logs
CREATE TABLE IF NOT EXISTS public.login_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  email TEXT,
  ip_address TEXT,
  user_agent TEXT,
  browser TEXT,
  device TEXT,
  login_status TEXT NOT NULL,                       -- 'success','failed'
  failure_reason TEXT,
  login_time TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_time ON public.login_logs(login_time DESC);
GRANT SELECT ON public.login_logs TO authenticated;
GRANT ALL ON public.login_logs TO service_role;
ALTER TABLE public.login_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ll_read" ON public.login_logs FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','auditor']::public.app_role[]));

-- 10b. API Logs
CREATE TABLE IF NOT EXISTS public.api_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  method TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_body JSONB,
  response_status INT,
  response_body JSONB,
  ip_address TEXT,
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.api_logs TO authenticated;
GRANT ALL ON public.api_logs TO service_role;
ALTER TABLE public.api_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "al_read" ON public.api_logs FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','auditor']::public.app_role[]));

-- 10c. Error Logs
CREATE TABLE IF NOT EXISTS public.error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  error_type TEXT NOT NULL,                         -- 'validation','system','payment','upload','api'
  error_code TEXT,
  error_message TEXT NOT NULL,
  stack_trace TEXT,
  context JSONB,                                    -- additional context (request data, file info)
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_error_type ON public.error_logs(error_type);
CREATE INDEX IF NOT EXISTS idx_error_time ON public.error_logs(created_at DESC);
GRANT SELECT ON public.error_logs TO authenticated;
GRANT ALL ON public.error_logs TO service_role;
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "el_read" ON public.error_logs FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','auditor']::public.app_role[]));

-- 10d. Payment Logs
CREATE TABLE IF NOT EXISTS public.payment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID REFERENCES public.payments(id),
  action TEXT NOT NULL,                             -- 'created','approved','processed','failed','reversed','retried'
  previous_status TEXT,
  new_status TEXT,
  amount NUMERIC(15,2),
  notes TEXT,
  performed_by UUID REFERENCES auth.users(id),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.payment_logs TO authenticated;
GRANT ALL ON public.payment_logs TO service_role;
ALTER TABLE public.payment_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pl_read" ON public.payment_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "pl_insert" ON public.payment_logs FOR INSERT TO authenticated WITH CHECK (true);

-- 10e. Approval Logs
CREATE TABLE IF NOT EXISTS public.approval_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id UUID REFERENCES public.pending_approvals(id),
  action TEXT NOT NULL,                             -- 'submitted','approved','rejected','returned','escalated'
  previous_status TEXT,
  new_status TEXT,
  remarks TEXT,
  performed_by UUID REFERENCES auth.users(id),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.approval_logs TO authenticated;
GRANT ALL ON public.approval_logs TO service_role;
ALTER TABLE public.approval_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "apl_read" ON public.approval_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "apl_insert" ON public.approval_logs FOR INSERT TO authenticated WITH CHECK (true);

-- =========================================================
-- 11. EXPAND COMPANIES TABLE
-- =========================================================
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS company_type TEXT,
  ADD COLUMN IF NOT EXISTS isin TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS listed_date DATE,
  ADD COLUMN IF NOT EXISTS registrar TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_year TEXT,
  ADD COLUMN IF NOT EXISTS dividend_rate NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS debenture_rate NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS coupon_rate NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS maturity_date DATE,
  ADD COLUMN IF NOT EXISTS face_value NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS issue_size NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT;

CREATE INDEX IF NOT EXISTS idx_companies_isin ON public.companies(isin);
CREATE INDEX IF NOT EXISTS idx_companies_fiscal_year ON public.companies(fiscal_year);

-- =========================================================
-- 12. EXPAND CLIENTS TABLE
-- =========================================================
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS father_name TEXT,
  ADD COLUMN IF NOT EXISTS grandfather_name TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS province TEXT,
  ADD COLUMN IF NOT EXISTS district TEXT,
  ADD COLUMN IF NOT EXISTS municipality TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS bank_branch TEXT,
  ADD COLUMN IF NOT EXISTS account_type TEXT;

DO $$ BEGIN
  ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS residency residency_type;
EXCEPTION WHEN undefined_object THEN
  CREATE TYPE residency_type AS ENUM ('Resident','Non-Resident');
  ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS residency residency_type;
END $$;

DO $$ BEGIN
  ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS verification_status verification_status NOT NULL DEFAULT 'Pending';
EXCEPTION WHEN undefined_object THEN
  CREATE TYPE verification_status AS ENUM ('Pending','Verified','Rejected');
  ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS verification_status verification_status NOT NULL DEFAULT 'Pending';
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_boid ON public.clients(boid);
CREATE INDEX IF NOT EXISTS idx_clients_pan ON public.clients(pan_or_citizenship);

-- =========================================================
-- 13. EXPAND INTEREST PAYABLES
-- =========================================================
ALTER TABLE public.interest_payables
  ADD COLUMN IF NOT EXISTS upload_id UUID REFERENCES public.upload_history(id),
  ADD COLUMN IF NOT EXISTS interest_rate_type interest_rate_type,
  ADD COLUMN IF NOT EXISTS interest_rate_value NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS from_date DATE,
  ADD COLUMN IF NOT EXISTS to_date DATE,
  ADD COLUMN IF NOT EXISTS days_count INT,
  ADD COLUMN IF NOT EXISTS gross_interest NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS tds NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS net_interest NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment_amount NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS previous_balance NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_payable NUMERIC(15,2) DEFAULT 0;

-- =========================================================
-- 14. EXPAND DIVIDEND PAYABLES
-- =========================================================
ALTER TABLE public.dividend_payables
  ADD COLUMN IF NOT EXISTS upload_id UUID REFERENCES public.upload_history(id),
  ADD COLUMN IF NOT EXISTS dividend_type dividend_type,
  ADD COLUMN IF NOT EXISTS bonus_ratio TEXT,
  ADD COLUMN IF NOT EXISTS right_ratio TEXT,
  ADD COLUMN IF NOT EXISTS fraction_shares NUMERIC(15,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rounded_quantity NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_quantity NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lock_in_period TEXT,
  ADD COLUMN IF NOT EXISTS promoter_quantity NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS public_quantity NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employee_quantity NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returned_status TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_status TEXT,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment_amount NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS previous_balance NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_payable NUMERIC(15,2) DEFAULT 0;

-- =========================================================
-- 15. TRIGGERS: updated_at for new tables
-- =========================================================
CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_payment_batches_updated BEFORE UPDATE ON public.payment_batches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_notification_configs_updated BEFORE UPDATE ON public.notification_configs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_system_settings_updated BEFORE UPDATE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- 16. AUDIT TRIGGERS for new tables
-- =========================================================
CREATE TRIGGER trg_audit_payments AFTER INSERT OR UPDATE OR DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER trg_audit_payment_batches AFTER INSERT OR UPDATE OR DELETE ON public.payment_batches FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER trg_audit_upload_history AFTER INSERT OR UPDATE OR DELETE ON public.upload_history FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER trg_audit_reconciliation_results AFTER INSERT OR UPDATE OR DELETE ON public.reconciliation_results FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();