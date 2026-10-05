-- ============================================================================
-- Migration: 20261005000005_schema_rls_and_security.sql
-- Description: Row Level Security (RLS) Enablement, Security Policies, and Grants
-- ============================================================================

-- Name: payable_tax_rules admins manage payable tax rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins manage payable tax rules" ON public.payable_tax_rules TO authenticated USING (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role)) WITH CHECK (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role));


--

-- Name: agm_broker_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agm_broker_claims ENABLE ROW LEVEL SECURITY;

--

-- Name: agm_broker_claims agm_broker_claims_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agm_broker_claims_modify ON public.agm_broker_claims TO authenticated USING ((((company_id IS NULL) OR public.has_company_access(auth.uid(), company_id)) AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role]))) WITH CHECK ((((company_id IS NULL) OR public.has_company_access(auth.uid(), company_id)) AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role])));


--

-- Name: agm_broker_claims agm_broker_claims_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agm_broker_claims_select ON public.agm_broker_claims FOR SELECT TO authenticated USING ((( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role]) AS has_any_role) AND (( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) AS has_any_role) OR (company_id IS NULL) OR (company_id IN ( SELECT user_company_access.company_id
   FROM public.user_company_access
  WHERE (user_company_access.user_id = ( SELECT auth.uid() AS uid)))) OR (company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.created_by = ( SELECT auth.uid() AS uid)))))));


--

-- Name: agm_broker_pools; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agm_broker_pools ENABLE ROW LEVEL SECURITY;

--

-- Name: agm_broker_pools agm_broker_pools_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agm_broker_pools_modify ON public.agm_broker_pools TO authenticated USING ((((company_id IS NULL) OR public.has_company_access(auth.uid(), company_id)) AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role]))) WITH CHECK ((((company_id IS NULL) OR public.has_company_access(auth.uid(), company_id)) AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role])));


--

-- Name: agm_broker_pools agm_broker_pools_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agm_broker_pools_select ON public.agm_broker_pools FOR SELECT TO authenticated USING ((( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role]) AS has_any_role) AND (( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) AS has_any_role) OR (company_id IS NULL) OR (company_id IN ( SELECT user_company_access.company_id
   FROM public.user_company_access
  WHERE (user_company_access.user_id = ( SELECT auth.uid() AS uid)))) OR (company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.created_by = ( SELECT auth.uid() AS uid)))))));


--

-- Name: agm_drn_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agm_drn_records ENABLE ROW LEVEL SECURITY;

--

-- Name: agm_drn_records agm_drn_records_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agm_drn_records_modify ON public.agm_drn_records TO authenticated USING ((((company_id IS NULL) OR public.has_company_access(auth.uid(), company_id)) AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role]))) WITH CHECK ((((company_id IS NULL) OR public.has_company_access(auth.uid(), company_id)) AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role])));


--

-- Name: agm_drn_records agm_drn_records_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agm_drn_records_select ON public.agm_drn_records FOR SELECT TO authenticated USING ((( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role]) AS has_any_role) AND (( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) AS has_any_role) OR (company_id IS NULL) OR (company_id IN ( SELECT user_company_access.company_id
   FROM public.user_company_access
  WHERE (user_company_access.user_id = ( SELECT auth.uid() AS uid)))) OR (company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.created_by = ( SELECT auth.uid() AS uid)))))));


--

-- Name: agm_fiscal_year_meta; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agm_fiscal_year_meta ENABLE ROW LEVEL SECURITY;

--

-- Name: agm_fiscal_year_meta agm_fiscal_year_meta_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agm_fiscal_year_meta_modify ON public.agm_fiscal_year_meta TO authenticated USING ((((company_id IS NULL) OR public.has_company_access(auth.uid(), company_id)) AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role]))) WITH CHECK ((((company_id IS NULL) OR public.has_company_access(auth.uid(), company_id)) AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role])));


--

-- Name: agm_fiscal_year_meta agm_fiscal_year_meta_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agm_fiscal_year_meta_select ON public.agm_fiscal_year_meta FOR SELECT TO authenticated USING ((( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role]) AS has_any_role) AND (( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) AS has_any_role) OR (company_id IS NULL) OR (company_id IN ( SELECT user_company_access.company_id
   FROM public.user_company_access
  WHERE (user_company_access.user_id = ( SELECT auth.uid() AS uid)))) OR (company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.created_by = ( SELECT auth.uid() AS uid)))))));


--

-- Name: agm_historical_shareholders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agm_historical_shareholders ENABLE ROW LEVEL SECURITY;

--

-- Name: agm_historical_shareholders agm_historical_shareholders_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agm_historical_shareholders_modify ON public.agm_historical_shareholders TO authenticated USING ((((company_id IS NULL) OR public.has_company_access(auth.uid(), company_id)) AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role]))) WITH CHECK ((((company_id IS NULL) OR public.has_company_access(auth.uid(), company_id)) AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role])));


--

-- Name: agm_historical_shareholders agm_historical_shareholders_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agm_historical_shareholders_select ON public.agm_historical_shareholders FOR SELECT TO authenticated USING ((( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role]) AS has_any_role) AND (( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) AS has_any_role) OR (company_id IS NULL) OR (company_id IN ( SELECT user_company_access.company_id
   FROM public.user_company_access
  WHERE (user_company_access.user_id = ( SELECT auth.uid() AS uid)))) OR (company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.created_by = ( SELECT auth.uid() AS uid)))))));


--

-- Name: agm_import_staging; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agm_import_staging ENABLE ROW LEVEL SECURITY;

--

-- Name: agm_import_staging agm_import_staging_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agm_import_staging_delete ON public.agm_import_staging FOR DELETE TO authenticated USING ((public.has_company_access(auth.uid(), company_id) AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role])));


--

-- Name: agm_import_staging agm_import_staging_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agm_import_staging_insert ON public.agm_import_staging FOR INSERT TO authenticated WITH CHECK ((public.has_company_access(auth.uid(), company_id) AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role])));


--

-- Name: agm_import_staging agm_import_staging_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agm_import_staging_select ON public.agm_import_staging FOR SELECT TO authenticated USING ((public.has_company_access(auth.uid(), company_id) AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role])));


--

-- Name: agm_yearly_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agm_yearly_snapshots ENABLE ROW LEVEL SECURITY;

--

-- Name: agm_yearly_snapshots agm_yearly_snapshots_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agm_yearly_snapshots_modify ON public.agm_yearly_snapshots TO authenticated USING ((((company_id IS NULL) OR public.has_company_access(auth.uid(), company_id)) AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role]))) WITH CHECK ((((company_id IS NULL) OR public.has_company_access(auth.uid(), company_id)) AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role])));


--

-- Name: agm_yearly_snapshots agm_yearly_snapshots_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agm_yearly_snapshots_select ON public.agm_yearly_snapshots FOR SELECT TO authenticated USING ((( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role]) AS has_any_role) AND (( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) AS has_any_role) OR (company_id IS NULL) OR (company_id IN ( SELECT user_company_access.company_id
   FROM public.user_company_access
  WHERE (user_company_access.user_id = ( SELECT auth.uid() AS uid)))) OR (company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.created_by = ( SELECT auth.uid() AS uid)))))));


--

-- Name: api_logs al_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY al_read ON public.api_logs FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'auditor'::public.app_role]));


--

-- Name: api_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_logs ENABLE ROW LEVEL SECURITY;

--

-- Name: approval_logs apl_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY apl_insert ON public.approval_logs FOR INSERT TO authenticated WITH CHECK (((performed_by = auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])));


--

-- Name: approval_logs apl_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY apl_read ON public.approval_logs FOR SELECT TO authenticated USING (((performed_by = auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role])));


--

-- Name: approval_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approval_logs ENABLE ROW LEVEL SECURITY;

--

-- Name: audit_logs audit_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_insert ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--

-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--

-- Name: audit_logs audit_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_read ON public.audit_logs FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'auditor'::public.app_role]));


--

-- Name: bank_statements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_statements ENABLE ROW LEVEL SECURITY;

--

-- Name: bank_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

--

-- Name: bank_statements bs_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bs_delete ON public.bank_statements FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--

-- Name: bank_statements bs_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bs_read ON public.bank_statements FOR SELECT TO authenticated USING (true);


--

-- Name: bank_statements bs_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bs_write ON public.bank_statements FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'reconciliation_officer'::public.app_role]));


--

-- Name: bank_transactions bt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bt_delete ON public.bank_transactions FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--

-- Name: bank_transactions bt_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bt_read ON public.bank_transactions FOR SELECT TO authenticated USING (true);


--

-- Name: bank_transactions bt_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bt_write ON public.bank_transactions TO authenticated USING (public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'reconciliation_officer'::public.app_role, 'finance_operator'::public.app_role])) WITH CHECK (public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'reconciliation_officer'::public.app_role, 'finance_operator'::public.app_role]));


--

-- Name: clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

--

-- Name: clients clients_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_delete ON public.clients FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--

-- Name: clients clients_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_read ON public.clients FOR SELECT TO authenticated USING ((( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) AS has_any_role) OR (company_id IS NULL) OR (company_id IN ( SELECT user_company_access.company_id
   FROM public.user_company_access
  WHERE (user_company_access.user_id = ( SELECT auth.uid() AS uid)))) OR (company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.created_by = ( SELECT auth.uid() AS uid))))));


--

-- Name: clients clients_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_update ON public.clients FOR UPDATE TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));


--

-- Name: clients clients_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_write ON public.clients FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));


--

-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--

-- Name: companies companies_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_delete ON public.companies FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--

-- Name: companies companies_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_read ON public.companies FOR SELECT TO authenticated USING ((( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) AS has_any_role) OR (id IN ( SELECT user_company_access.company_id
   FROM public.user_company_access
  WHERE (user_company_access.user_id = ( SELECT auth.uid() AS uid)))) OR (created_by = ( SELECT auth.uid() AS uid))));


--

-- Name: companies companies_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_update ON public.companies FOR UPDATE TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));


--

-- Name: companies companies_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_write ON public.companies FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));


--

-- Name: dividend_payables; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dividend_payables ENABLE ROW LEVEL SECURITY;

--

-- Name: dividend_payables dp_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dp_delete ON public.dividend_payables FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--

-- Name: dividend_payables dp_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dp_read ON public.dividend_payables FOR SELECT TO authenticated USING ((( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) AS has_any_role) OR (company_id IS NULL) OR (company_id IN ( SELECT user_company_access.company_id
   FROM public.user_company_access
  WHERE (user_company_access.user_id = ( SELECT auth.uid() AS uid)))) OR (company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.created_by = ( SELECT auth.uid() AS uid))))));


--

-- Name: dividend_payables dp_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dp_update ON public.dividend_payables FOR UPDATE TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));


--

-- Name: dividend_payables dp_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dp_write ON public.dividend_payables FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));


--

-- Name: error_logs el_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY el_read ON public.error_logs FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'auditor'::public.app_role]));


--

-- Name: error_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

--

-- Name: fiscal_years; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fiscal_years ENABLE ROW LEVEL SECURITY;

--

-- Name: fiscal_years fy_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fy_admin ON public.fiscal_years TO authenticated USING (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role)) WITH CHECK (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role));


--

-- Name: fiscal_years fy_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fy_read ON public.fiscal_years FOR SELECT TO authenticated USING (true);


--

-- Name: iaf_allocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.iaf_allocations ENABLE ROW LEVEL SECURITY;

--

-- Name: iaf_allocations iaf_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY iaf_read ON public.iaf_allocations FOR SELECT TO authenticated USING ((( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) AS has_any_role) OR (company_id IS NULL) OR (company_id IN ( SELECT user_company_access.company_id
   FROM public.user_company_access
  WHERE (user_company_access.user_id = ( SELECT auth.uid() AS uid)))) OR (company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.created_by = ( SELECT auth.uid() AS uid))))));


--

-- Name: iaf_allocations iaf_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY iaf_write ON public.iaf_allocations TO authenticated USING (public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role])) WITH CHECK (public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));


--

-- Name: interest_payables; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.interest_payables ENABLE ROW LEVEL SECURITY;

--

-- Name: interest_payables ip_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ip_delete ON public.interest_payables FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--

-- Name: interest_payables ip_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ip_read ON public.interest_payables FOR SELECT TO authenticated USING ((( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) AS has_any_role) OR (company_id IS NULL) OR (company_id IN ( SELECT user_company_access.company_id
   FROM public.user_company_access
  WHERE (user_company_access.user_id = ( SELECT auth.uid() AS uid)))) OR (company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.created_by = ( SELECT auth.uid() AS uid))))));


--

-- Name: interest_payables ip_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ip_update ON public.interest_payables FOR UPDATE TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));


--

-- Name: interest_payables ip_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ip_write ON public.interest_payables FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));


--

-- Name: login_logs ll_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ll_insert ON public.login_logs FOR INSERT TO service_role WITH CHECK (true);


--

-- Name: login_logs ll_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ll_select ON public.login_logs FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role]));


--

-- Name: login_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.login_logs ENABLE ROW LEVEL SECURITY;

--

-- Name: mutual_fund_payables mfp_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mfp_delete ON public.mutual_fund_payables FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--

-- Name: mutual_fund_payables mfp_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mfp_read ON public.mutual_fund_payables FOR SELECT TO authenticated USING ((( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) AS has_any_role) OR (company_id IS NULL) OR (company_id IN ( SELECT user_company_access.company_id
   FROM public.user_company_access
  WHERE (user_company_access.user_id = ( SELECT auth.uid() AS uid)))) OR (company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.created_by = ( SELECT auth.uid() AS uid))))));


--

-- Name: mutual_fund_payables mfp_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mfp_update ON public.mutual_fund_payables FOR UPDATE TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));


--

-- Name: mutual_fund_payables mfp_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mfp_write ON public.mutual_fund_payables FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));


--

-- Name: mutual_fund_payables; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mutual_fund_payables ENABLE ROW LEVEL SECURITY;

--

-- Name: notification_configs nc_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY nc_admin ON public.notification_configs TO authenticated USING (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role)) WITH CHECK (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role));


--

-- Name: notification_configs nc_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY nc_read ON public.notification_configs FOR SELECT TO authenticated USING (true);


--

-- Name: notifications notif_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_insert ON public.notifications FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role])));


--

-- Name: notifications notif_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_read ON public.notifications FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--

-- Name: notifications notif_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_update ON public.notifications FOR UPDATE TO authenticated USING ((user_id = auth.uid()));


--

-- Name: notification_configs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_configs ENABLE ROW LEVEL SECURITY;

--

-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--

-- Name: pending_approvals pa_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pa_delete ON public.pending_approvals FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--

-- Name: pending_approvals pa_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pa_insert ON public.pending_approvals FOR INSERT TO authenticated WITH CHECK ((requested_by = auth.uid()));


--

-- Name: pending_approvals pa_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pa_read ON public.pending_approvals FOR SELECT TO authenticated USING (true);


--

-- Name: pending_approvals pa_review; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pa_review ON public.pending_approvals FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--

-- Name: payments pay_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_read ON public.payments FOR SELECT TO authenticated USING ((( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) AS has_any_role) OR (company_id IS NULL) OR (company_id IN ( SELECT user_company_access.company_id
   FROM public.user_company_access
  WHERE (user_company_access.user_id = ( SELECT auth.uid() AS uid)))) OR (company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.created_by = ( SELECT auth.uid() AS uid))))));


--

-- Name: payments pay_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_update ON public.payments FOR UPDATE TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role, 'reconciliation_officer'::public.app_role]));


--

-- Name: payments pay_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pay_write ON public.payments FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role, 'reconciliation_officer'::public.app_role]));


--

-- Name: payable_tax_rules payable tax rules are readable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "payable tax rules are readable" ON public.payable_tax_rules FOR SELECT TO authenticated USING (true);


--

-- Name: payable_tax_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payable_tax_rules ENABLE ROW LEVEL SECURITY;

--

-- Name: payment_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_batches ENABLE ROW LEVEL SECURITY;

--

-- Name: payment_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_logs ENABLE ROW LEVEL SECURITY;

--

-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--

-- Name: payments payments_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_delete ON public.payments FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--

-- Name: payment_batches pb_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pb_delete ON public.payment_batches FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--

-- Name: payment_batches pb_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pb_read ON public.payment_batches FOR SELECT TO authenticated USING ((( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) AS has_any_role) OR (company_id IS NULL) OR (company_id IN ( SELECT user_company_access.company_id
   FROM public.user_company_access
  WHERE (user_company_access.user_id = ( SELECT auth.uid() AS uid)))) OR (company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.created_by = ( SELECT auth.uid() AS uid))))));


--

-- Name: payment_batches pb_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pb_update ON public.payment_batches FOR UPDATE TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));


--

-- Name: payment_batches pb_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pb_write ON public.payment_batches FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role]));


--

-- Name: pending_approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pending_approvals ENABLE ROW LEVEL SECURITY;

--

-- Name: payment_logs pl_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pl_insert ON public.payment_logs FOR INSERT TO authenticated WITH CHECK (((performed_by = auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role])));


--

-- Name: payment_logs pl_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pl_read ON public.payment_logs FOR SELECT TO authenticated USING (((performed_by = auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role])));


--

-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--

-- Name: profiles profiles_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_all ON public.profiles FOR SELECT TO authenticated USING (true);


--

-- Name: profiles profiles_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = id));


--

-- Name: reconciliation_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reconciliation_results ENABLE ROW LEVEL SECURITY;

--

-- Name: user_roles roles_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roles_admin_all ON public.user_roles TO authenticated USING (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role)) WITH CHECK (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role));


--

-- Name: user_roles roles_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roles_select_own ON public.user_roles FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--

-- Name: reconciliation_results rr_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rr_delete ON public.reconciliation_results FOR DELETE TO authenticated USING (public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role]));


--

-- Name: reconciliation_results rr_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rr_insert ON public.reconciliation_results FOR INSERT TO authenticated WITH CHECK (public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'reconciliation_officer'::public.app_role, 'finance_operator'::public.app_role, 'maker'::public.app_role]));


--

-- Name: reconciliation_results rr_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rr_select ON public.reconciliation_results FOR SELECT TO authenticated USING ((( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'reconciliation_officer'::public.app_role, 'finance_operator'::public.app_role, 'supervisor'::public.app_role, 'checker'::public.app_role, 'approver'::public.app_role, 'report_viewer'::public.app_role]) AS has_any_role) AND (( SELECT public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) AS has_any_role) OR (company_id IS NULL) OR (company_id IN ( SELECT user_company_access.company_id
   FROM public.user_company_access
  WHERE (user_company_access.user_id = ( SELECT auth.uid() AS uid)))) OR (company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.created_by = ( SELECT auth.uid() AS uid)))))));


--

-- Name: reconciliation_results rr_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rr_update ON public.reconciliation_results FOR UPDATE TO authenticated USING (public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'reconciliation_officer'::public.app_role])) WITH CHECK (public.has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::public.app_role, 'reconciliation_officer'::public.app_role]));


--

-- Name: system_settings ss_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ss_admin ON public.system_settings TO authenticated USING (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role)) WITH CHECK (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role));


--

-- Name: system_settings ss_read_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ss_read_admin ON public.system_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--

-- Name: system_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

--

-- Name: user_company_access uca_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY uca_admin_all ON public.user_company_access TO authenticated USING (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role)) WITH CHECK (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role));


--

-- Name: user_company_access uca_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY uca_select ON public.user_company_access FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])));


--

-- Name: upload_errors ue_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ue_delete ON public.upload_errors FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--

-- Name: upload_errors ue_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ue_read ON public.upload_errors FOR SELECT TO authenticated USING (((upload_id IN ( SELECT upload_history.id
   FROM public.upload_history
  WHERE (upload_history.user_id = auth.uid()))) OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role, 'auditor'::public.app_role])));


--

-- Name: upload_errors ue_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ue_write ON public.upload_errors FOR INSERT TO authenticated WITH CHECK (((upload_id IN ( SELECT upload_history.id
   FROM public.upload_history
  WHERE (upload_history.user_id = auth.uid()))) OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role])));


--

-- Name: upload_history uh_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY uh_delete ON public.upload_history FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--

-- Name: upload_history uh_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY uh_read ON public.upload_history FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (user_id IS NULL) OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role])));


--

-- Name: upload_history uh_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY uh_update ON public.upload_history FOR UPDATE TO authenticated USING (((user_id IS NULL) OR (user_id = auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role])));


--

-- Name: upload_history uh_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY uh_write ON public.upload_history FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) OR (user_id IS NULL) OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'finance_operator'::public.app_role])));


--

-- Name: upload_errors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.upload_errors ENABLE ROW LEVEL SECURITY;

--

-- Name: upload_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.upload_history ENABLE ROW LEVEL SECURITY;

--

-- Name: user_company_access; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_company_access ENABLE ROW LEVEL SECURITY;

--

-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


-- ----------------------------------------------------------------------------
-- Standard Supabase Role Grants
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT USAGE ON SCHEMA public TO anon;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
    GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
    GRANT ALL ON ALL ROUTINES IN SCHEMA public TO authenticated;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA public TO service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
    GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;
  END IF;
END $$;
