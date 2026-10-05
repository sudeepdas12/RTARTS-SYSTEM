-- Migration: Enable login_logs permissions and RLS policies
GRANT ALL ON public.login_logs TO anon, authenticated, service_role;
ALTER TABLE public.login_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ll_insert ON public.login_logs;
CREATE POLICY ll_insert ON public.login_logs FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS ll_read ON public.login_logs;
DROP POLICY IF EXISTS ll_select ON public.login_logs;
CREATE POLICY ll_select ON public.login_logs FOR SELECT TO authenticated USING (true);
