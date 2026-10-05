-- ============================================================================
-- Migration: 20261005000004_schema_triggers.sql
-- Description: Table Triggers (Audit, Classification, Calculations, Timestamps)
-- ============================================================================

-- Name: approval_logs trg_approval_log_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_approval_log_actor BEFORE INSERT ON public.approval_logs FOR EACH ROW EXECUTE FUNCTION public.set_approval_log_actor();


--

-- Name: bank_transactions trg_audit_bt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_bt AFTER INSERT OR DELETE OR UPDATE ON public.bank_transactions FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--

-- Name: clients trg_audit_clients; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_clients AFTER INSERT OR DELETE OR UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--

-- Name: companies trg_audit_companies; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_companies AFTER INSERT OR DELETE OR UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--

-- Name: dividend_payables trg_audit_dp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_dp AFTER INSERT OR DELETE OR UPDATE ON public.dividend_payables FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--

-- Name: iaf_allocations trg_audit_iaf; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_iaf AFTER INSERT OR DELETE OR UPDATE ON public.iaf_allocations FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--

-- Name: interest_payables trg_audit_ip; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_ip AFTER INSERT OR DELETE OR UPDATE ON public.interest_payables FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--

-- Name: audit_logs trg_audit_log_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_log_actor BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.set_audit_log_actor();


--

-- Name: mutual_fund_payables trg_audit_mf; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_mf AFTER INSERT OR DELETE OR UPDATE ON public.mutual_fund_payables FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--

-- Name: payment_batches trg_audit_payment_batches; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_payment_batches AFTER INSERT OR DELETE OR UPDATE ON public.payment_batches FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--

-- Name: payments trg_audit_payments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_payments AFTER INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--

-- Name: reconciliation_results trg_audit_reconciliation_results; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_reconciliation_results AFTER INSERT OR DELETE OR UPDATE ON public.reconciliation_results FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--

-- Name: upload_history trg_audit_upload_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_upload_history AFTER INSERT OR DELETE OR UPDATE ON public.upload_history FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--

-- Name: user_company_access trg_audit_user_company_access; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_user_company_access AFTER INSERT OR DELETE OR UPDATE ON public.user_company_access FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--

-- Name: user_roles trg_audit_user_roles; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_user_roles AFTER INSERT OR DELETE OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();


--

-- Name: clients trg_clients_needs_review; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clients_needs_review BEFORE INSERT OR UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.trg_clients_set_needs_review();


--

-- Name: clients trg_clients_payee_classification; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clients_payee_classification BEFORE INSERT OR UPDATE OF holder_type, payee_classification, classification_status ON public.clients FOR EACH ROW EXECUTE FUNCTION public.sync_client_payee_classification();


--

-- Name: clients trg_clients_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--

-- Name: companies trg_companies_enforce_defaults; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_companies_enforce_defaults BEFORE INSERT OR UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.trg_companies_generic_defaults();


--

-- Name: companies trg_companies_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_companies_updated BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--

-- Name: dividend_payables trg_dividend_classification_tax; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_dividend_classification_tax BEFORE INSERT OR UPDATE OF client_id, gross_dividend, tax_amount, tds_rate ON public.dividend_payables FOR EACH ROW EXECUTE FUNCTION public.apply_payable_classification_and_tax();


--

-- Name: dividend_payables trg_dp_calc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_dp_calc BEFORE INSERT OR UPDATE ON public.dividend_payables FOR EACH ROW EXECUTE FUNCTION public.calc_net_dividend();


--

-- Name: interest_payables trg_enforce_interest_payable_tax; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_interest_payable_tax BEFORE INSERT OR UPDATE ON public.interest_payables FOR EACH ROW EXECUTE FUNCTION public.enforce_interest_payable_tax_rates();


--

-- Name: interest_payables trg_interest_classification_tax; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_interest_classification_tax BEFORE INSERT OR UPDATE OF client_id, gross_interest, tax_amount, tds_rate ON public.interest_payables FOR EACH ROW EXECUTE FUNCTION public.apply_payable_classification_and_tax();


--

-- Name: interest_payables trg_ip_calc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ip_calc BEFORE INSERT OR UPDATE ON public.interest_payables FOR EACH ROW EXECUTE FUNCTION public.calc_net_payable();


--

-- Name: mutual_fund_payables trg_mfp_calc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mfp_calc BEFORE INSERT OR UPDATE ON public.mutual_fund_payables FOR EACH ROW EXECUTE FUNCTION public.calc_net_dividend();


--

-- Name: mutual_fund_payables trg_mutual_fund_classification_tax; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mutual_fund_classification_tax BEFORE INSERT OR UPDATE OF client_id, gross_dividend, tax_amount, tds_rate ON public.mutual_fund_payables FOR EACH ROW EXECUTE FUNCTION public.apply_payable_classification_and_tax();


--

-- Name: notification_configs trg_notification_configs_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notification_configs_updated BEFORE UPDATE ON public.notification_configs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--

-- Name: payment_batches trg_payment_batch_completed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payment_batch_completed AFTER UPDATE OF status ON public.payment_batches FOR EACH ROW EXECUTE FUNCTION public.trg_fn_sync_payment_batch_completion();


--

-- Name: payment_batches trg_payment_batches_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payment_batches_updated BEFORE UPDATE ON public.payment_batches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--

-- Name: payment_logs trg_payment_log_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payment_log_actor BEFORE INSERT ON public.payment_logs FOR EACH ROW EXECUTE FUNCTION public.set_payment_log_actor();


--

-- Name: payments trg_payments_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--

-- Name: clients trg_sync_payables_on_client_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_payables_on_client_update AFTER UPDATE OF payee_classification, holder_type ON public.clients FOR EACH ROW EXECUTE FUNCTION public.sync_payables_on_client_classification_update();


--

-- Name: system_settings trg_system_settings_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_system_settings_updated BEFORE UPDATE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--

-- Name: upload_history trg_upload_history_set_user; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_upload_history_set_user BEFORE INSERT ON public.upload_history FOR EACH ROW EXECUTE FUNCTION public.set_upload_user_id();


--
