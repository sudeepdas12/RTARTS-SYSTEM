-- ============================================================================
-- Migration: 20261005000003_schema_views.sql
-- Description: Views, Materialized Views, and Materialized View Indexes
-- ============================================================================

-- Name: company_client_map; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.company_client_map AS
 SELECT DISTINCT clients.company_id,
    clients.id AS client_id
   FROM public.clients
  WHERE (clients.company_id IS NOT NULL)
UNION
 SELECT DISTINCT mutual_fund_payables.company_id,
    mutual_fund_payables.client_id
   FROM public.mutual_fund_payables
  WHERE ((mutual_fund_payables.company_id IS NOT NULL) AND (mutual_fund_payables.client_id IS NOT NULL))
UNION
 SELECT DISTINCT dividend_payables.company_id,
    dividend_payables.client_id
   FROM public.dividend_payables
  WHERE ((dividend_payables.company_id IS NOT NULL) AND (dividend_payables.client_id IS NOT NULL))
UNION
 SELECT DISTINCT interest_payables.company_id,
    interest_payables.client_id
   FROM public.interest_payables
  WHERE ((interest_payables.company_id IS NOT NULL) AND (interest_payables.client_id IS NOT NULL))
  WITH NO DATA;


--

-- Name: payable_classification_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.payable_classification_summary WITH (security_invoker='true') AS
 SELECT dividend_payables.company_id,
    'DIVIDEND'::text AS payable_category,
    dividend_payables.payee_classification,
    dividend_payables.payee_segment,
    dividend_payables.classification_status,
    count(*) AS transaction_count,
    sum(dividend_payables.gross_dividend) AS gross_payable,
    sum(dividend_payables.tax_amount) AS tax,
    sum(dividend_payables.net_payable) AS net_payable
   FROM public.dividend_payables
  GROUP BY dividend_payables.company_id, dividend_payables.payee_classification, dividend_payables.payee_segment, dividend_payables.classification_status
UNION ALL
 SELECT interest_payables.company_id,
    'INTEREST'::text AS payable_category,
    interest_payables.payee_classification,
    interest_payables.payee_segment,
    interest_payables.classification_status,
    count(*) AS transaction_count,
    sum(interest_payables.gross_interest) AS gross_payable,
    sum(interest_payables.tax_amount) AS tax,
    sum(interest_payables.net_payable) AS net_payable
   FROM public.interest_payables
  GROUP BY interest_payables.company_id, interest_payables.payee_classification, interest_payables.payee_segment, interest_payables.classification_status
UNION ALL
 SELECT mutual_fund_payables.company_id,
    'MUTUAL_FUND'::text AS payable_category,
    mutual_fund_payables.payee_classification,
    mutual_fund_payables.payee_segment,
    mutual_fund_payables.classification_status,
    count(*) AS transaction_count,
    sum(mutual_fund_payables.gross_dividend) AS gross_payable,
    sum(mutual_fund_payables.tax_amount) AS tax,
    sum(mutual_fund_payables.net_payable) AS net_payable
   FROM public.mutual_fund_payables
  GROUP BY mutual_fund_payables.company_id, mutual_fund_payables.payee_classification, mutual_fund_payables.payee_segment, mutual_fund_payables.classification_status;


--

-- Name: payable_tds_rate_drift; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.payable_tds_rate_drift WITH (security_invoker='true') AS
 SELECT 'DIVIDEND'::text AS payable_category,
    p.id,
    p.company_id,
    p.payee_classification,
    p.tds_rate AS stored_rate,
    r.tax_rate AS rule_rate,
    p.payment_status
   FROM (public.dividend_payables p
     JOIN public.payable_tax_rules r ON (((r.payable_category = 'DIVIDEND'::text) AND (r.payee_classification = p.payee_classification) AND r.is_active)))
  WHERE (p.tds_rate IS DISTINCT FROM r.tax_rate)
UNION ALL
 SELECT 'INTEREST'::text AS payable_category,
    p.id,
    p.company_id,
    p.payee_classification,
    p.tds_rate AS stored_rate,
    r.tax_rate AS rule_rate,
    p.payment_status
   FROM (public.interest_payables p
     JOIN public.payable_tax_rules r ON (((r.payable_category = 'INTEREST'::text) AND (r.payee_classification = p.payee_classification) AND r.is_active)))
  WHERE (p.tds_rate IS DISTINCT FROM r.tax_rate)
UNION ALL
 SELECT 'MUTUAL_FUND'::text AS payable_category,
    p.id,
    p.company_id,
    p.payee_classification,
    p.tds_rate AS stored_rate,
    r.tax_rate AS rule_rate,
    p.payment_status
   FROM (public.mutual_fund_payables p
     JOIN public.payable_tax_rules r ON (((r.payable_category = 'MUTUAL_FUND'::text) AND (r.payee_classification = p.payee_classification) AND r.is_active)))
  WHERE (p.tds_rate IS DISTINCT FROM r.tax_rate);


--

-- Name: reconciliation_lots; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.reconciliation_lots AS
 SELECT id,
    reconciliation_date,
    client_id,
    company_id,
    payable_type,
    payable_id,
    expected_amount,
    actual_amount,
    difference,
    result,
    (result)::text AS status,
    notes,
    matched_by,
    matched_at,
    created_at,
    fiscal_year,
    payment_id,
    batch_id
   FROM public.reconciliation_results;


--

-- Name: system_settings_safe; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.system_settings_safe WITH (security_invoker='true') AS
 SELECT id,
    setting_key,
        CASE
            WHEN public.has_role(auth.uid(), 'admin'::public.app_role) THEN public.mask_smtp_secrets(setting_value)
            ELSE public.mask_smtp_secrets(setting_value)
        END AS setting_value,
    description,
    updated_by,
    created_at,
    updated_at
   FROM public.system_settings;


--

-- Name: upload_logs; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.upload_logs AS
 SELECT id,
    user_id,
    file_name,
    file_size,
    file_hash,
    file_type,
    file_type AS upload_type,
    sheet_name,
    total_rows,
    success_rows,
    error_rows,
    target_table,
    status,
    error_message,
    started_at,
    completed_at,
    created_at
   FROM public.upload_history;


--

-- Name: idx_company_client_map_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_client_map_client ON public.company_client_map USING btree (client_id);


--

-- Name: idx_company_client_map_comp_client; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_company_client_map_comp_client ON public.company_client_map USING btree (company_id, client_id);


--
