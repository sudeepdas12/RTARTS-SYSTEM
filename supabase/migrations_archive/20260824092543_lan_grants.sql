-- LAN Grants and Multi-PC access permissions

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, authenticator;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, authenticator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, authenticator;
GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role, authenticator;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role, authenticator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role, authenticator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role, authenticator;

-- Disable RLS on operational tables so any client on LAN can read/write without auth token gating
ALTER TABLE IF EXISTS public.upload_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.upload_errors DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.companies DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.clients DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.dividend_payables DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.interest_payables DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.mutual_fund_payables DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payment_batches DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reconciliation_results DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pending_approvals DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_audit_logs DISABLE ROW LEVEL SECURITY;
