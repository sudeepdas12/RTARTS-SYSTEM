-- ============================================================================
-- Migration: 20261005000001_schema_tables_and_indexes.sql
-- Description: Core Schema - Extensions, Types, Tables, Constraints, and Indexes
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'finance_operator',
    'reconciliation_officer',
    'auditor',
    'report_viewer',
    'supervisor',
    'operator',
    'maker',
    'checker',
    'approver',
    'read_only'
);


--

-- Name: approval_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.approval_status AS ENUM (
    'Pending',
    'Approved',
    'Rejected'
);


--

-- Name: dividend_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.dividend_type AS ENUM (
    'Cash',
    'Stock',
    'Bonus',
    'Right'
);


--

-- Name: holder_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.holder_type AS ENUM (
    'Natural Person - Public',
    'Natural Person - Promoter',
    'Legal Person',
    'Mutual Fund',
    'Foreign',
    'Tax Exempt',
    'Public',
    'Promoter',
    'Institution',
    'Natural Person - Local',
    'Natural Person - Employee',
    'Natural Person - Minor',
    'Natural Person - Joint Holder',
    'Legal Person - Promoter',
    'Local',
    'Employee'
);


--

-- Name: interest_rate_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.interest_rate_type AS ENUM (
    'Fixed_6',
    'Fixed_6_25',
    'Fixed_7',
    'Fixed_7_5',
    'Floating',
    'Variable_Coupon'
);


--

-- Name: notification_channel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_channel AS ENUM (
    'Email',
    'SMS',
    'System'
);


--

-- Name: payment_batch_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_batch_status AS ENUM (
    'Draft',
    'Approved',
    'Processed',
    'Completed',
    'Failed',
    'Pending',
    'Rejected',
    'Returned'
);


--

-- Name: payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_method AS ENUM (
    'NEFT',
    'RTGS',
    'ConnectIPS',
    'Cheque',
    'Cash',
    'Manual'
);


--

-- Name: payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_status AS ENUM (
    'Pending',
    'Paid',
    'Partial'
);


--

-- Name: reconciliation_result; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.reconciliation_result AS ENUM (
    'Matched',
    'Not_Matched',
    'Missing',
    'Duplicate',
    'Over_Paid',
    'Under_Paid',
    'Pending',
    'Pledged',
    'Rejected'
);


--

-- Name: record_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.record_status AS ENUM (
    'Active',
    'Inactive'
);


--

-- Name: residency_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.residency_type AS ENUM (
    'Resident',
    'Non-Resident'
);


--

-- Name: sector_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sector_type AS ENUM (
    'Public',
    'Private',
    'Institution',
    'Government',
    'Other'
);


--

-- Name: tax_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tax_status AS ENUM (
    'Taxable',
    'Exempted'
);


--

-- Name: verification_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.verification_status AS ENUM (
    'Pending',
    'Verified',
    'Rejected'
);


--

-- Name: agm_broker_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agm_broker_claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seq_no bigint NOT NULL,
    broker_code text NOT NULL,
    broker_name text NOT NULL,
    pool_boid text NOT NULL,
    claimant_boid text NOT NULL,
    claimant_name text NOT NULL,
    fiscal_year text NOT NULL,
    claimed_kitta numeric(15,4) NOT NULL,
    claimed_cash numeric(15,2) NOT NULL,
    contract_note_no text NOT NULL,
    trade_date_bs text NOT NULL,
    status text DEFAULT 'APPROVED'::text NOT NULL,
    approve_date timestamp with time zone DEFAULT now(),
    approved_by text DEFAULT 'Operator'::text,
    remarks text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id uuid,
    CONSTRAINT agm_broker_claims_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])))
);


--

-- Name: agm_broker_pools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agm_broker_pools (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    broker_code text NOT NULL,
    broker_name text NOT NULL,
    pool_boid text NOT NULL,
    fiscal_year text NOT NULL,
    unclaimed_kitta numeric(15,4) DEFAULT 0 NOT NULL,
    unclaimed_cash numeric(15,2) DEFAULT 0 NOT NULL,
    claimed_kitta numeric(15,4) DEFAULT 0 NOT NULL,
    claimed_cash numeric(15,2) DEFAULT 0 NOT NULL,
    active_balance_kitta numeric(15,4) DEFAULT 0 NOT NULL,
    active_balance_cash numeric(15,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id uuid
);


--

-- Name: agm_drn_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agm_drn_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    folio_no text NOT NULL,
    holder_name text NOT NULL,
    certificate_no_start bigint,
    certificate_no_end bigint,
    distinctive_no_start bigint,
    distinctive_no_end bigint,
    total_kitta numeric(15,4) NOT NULL,
    drn_no text,
    drn_date text,
    target_boid text,
    status text DEFAULT 'PHYSICAL'::text NOT NULL,
    reconciled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id uuid,
    CONSTRAINT agm_drn_records_status_check CHECK ((status = ANY (ARRAY['PHYSICAL'::text, 'POSTED'::text, 'ACCEPTED'::text, 'REJECTED'::text])))
);


--

-- Name: agm_fiscal_year_meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agm_fiscal_year_meta (
    fiscal_year text NOT NULL,
    event_name text NOT NULL,
    total_shareholders integer DEFAULT 0 NOT NULL,
    total_kitta numeric(15,4) DEFAULT 0 NOT NULL,
    total_bonus_kitta numeric(15,4) DEFAULT 0 NOT NULL,
    total_cash_npr numeric(15,2) DEFAULT 0 NOT NULL,
    is_locked boolean DEFAULT false NOT NULL,
    import_report jsonb,
    imported_by text DEFAULT 'Operator'::text,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id uuid
);


--

-- Name: agm_historical_shareholders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agm_historical_shareholders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    boid text NOT NULL,
    shareholder_name text NOT NULL,
    father_name text,
    grandfather_name text,
    guardian_name text,
    spouse_name text,
    citizenship_no text,
    pan_no text,
    address text,
    district text,
    contact_no text,
    email text,
    bank_name text,
    bank_account_no text,
    holder_type text NOT NULL,
    initial_kitta_2075 numeric(15,4) DEFAULT 0 NOT NULL,
    initial_fraction_2075 numeric(15,4) DEFAULT 0 NOT NULL,
    current_kitta_2081 numeric(15,4) DEFAULT 0 NOT NULL,
    current_fraction_2081 numeric(15,4) DEFAULT 0 NOT NULL,
    total_bonus_shares numeric(15,4) DEFAULT 0 NOT NULL,
    total_cash_dividend numeric(15,2) DEFAULT 0 NOT NULL,
    total_tax_withheld numeric(15,2) DEFAULT 0 NOT NULL,
    reconciliation_status text DEFAULT 'RECONCILED'::text NOT NULL,
    has_discrepancy boolean DEFAULT false NOT NULL,
    anomalies text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    original_folio_no text,
    true_initial_kitta_2075 numeric(15,4),
    imported_base_kitta numeric(15,4),
    company_id uuid,
    remarks text,
    converted_shares numeric(15,4),
    imported_opening_fraction numeric(10,4) DEFAULT 0,
    imported_base_fiscal_year text,
    CONSTRAINT agm_historical_shareholders_holder_type_check CHECK ((holder_type = ANY (ARRAY['PROMOTER'::text, 'PUBLIC'::text, 'MUTUAL_FUND'::text, 'CLEARING_POOL'::text, 'PHYSICAL'::text]))),
    CONSTRAINT agm_historical_shareholders_reconciliation_status_check CHECK ((reconciliation_status = ANY (ARRAY['PENDING'::text, 'RECONCILED'::text, 'DISCREPANCY'::text, 'PROMOTED'::text])))
);


--

-- Name: agm_import_staging; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agm_import_staging (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    company_id uuid NOT NULL,
    fiscal_year text NOT NULL,
    boid text NOT NULL,
    shareholder_row jsonb NOT NULL,
    snapshot_row jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: agm_yearly_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agm_yearly_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shareholder_id uuid,
    boid text NOT NULL,
    fiscal_year text NOT NULL,
    event_name text NOT NULL,
    base_kitta numeric(15,4) DEFAULT 0 NOT NULL,
    previous_fraction numeric(15,4) DEFAULT 0 NOT NULL,
    gross_bonus_entitlement numeric(15,4) DEFAULT 0 NOT NULL,
    issued_whole_bonus numeric(15,4) DEFAULT 0 NOT NULL,
    carried_new_fraction numeric(15,4) DEFAULT 0 NOT NULL,
    gross_cash_dividend numeric(15,2) DEFAULT 0 NOT NULL,
    bonus_tax_withheld numeric(15,2) DEFAULT 0 NOT NULL,
    cash_tax_withheld numeric(15,2) DEFAULT 0 NOT NULL,
    net_cash_payable numeric(15,2) DEFAULT 0 NOT NULL,
    post_event_kitta numeric(15,4) DEFAULT 0 NOT NULL,
    excel_discrepancy_flag boolean DEFAULT false NOT NULL,
    is_locked boolean DEFAULT false NOT NULL,
    remarks text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    right_shares_allotted numeric(15,4),
    converted_shares numeric(15,4),
    converted_from_folio text,
    company_id uuid
);


--

-- Name: api_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    method text NOT NULL,
    endpoint text NOT NULL,
    request_body jsonb,
    response_status integer,
    response_body jsonb,
    ip_address text,
    duration_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: approval_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    approval_id uuid,
    action text NOT NULL,
    previous_status text,
    new_status text,
    remarks text,
    performed_by uuid,
    performed_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    action text NOT NULL,
    table_name text NOT NULL,
    record_id text,
    old_value jsonb,
    new_value jsonb,
    action_time timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: bank_statements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_statements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bank_name text NOT NULL,
    account_no text NOT NULL,
    statement_date date NOT NULL,
    file_name text NOT NULL,
    file_url text,
    total_transactions integer DEFAULT 0 NOT NULL,
    total_debit numeric(15,2) DEFAULT 0 NOT NULL,
    total_credit numeric(15,2) DEFAULT 0 NOT NULL,
    is_reconciled boolean DEFAULT false NOT NULL,
    reconciled_at timestamp with time zone,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: bank_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_date date NOT NULL,
    description text,
    reference text,
    amount numeric(15,2) NOT NULL,
    bank_account_no text,
    matched_payable_type text,
    matched_payable_id uuid,
    is_reconciled boolean DEFAULT false NOT NULL,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_code text NOT NULL,
    full_name text NOT NULL,
    boid text,
    holder_type public.holder_type,
    pan_or_citizenship text,
    bank_account_no text,
    bank_name text,
    status public.record_status DEFAULT 'Active'::public.record_status NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id text,
    father_name text,
    grandfather_name text,
    address text,
    province text,
    district text,
    municipality text,
    phone text,
    email text,
    bank_branch text,
    account_type text,
    residency public.residency_type,
    verification_status public.verification_status DEFAULT 'Pending'::public.verification_status NOT NULL,
    company_id uuid,
    payee_classification text DEFAULT 'UNCLASSIFIED'::text NOT NULL,
    payee_segment text,
    classification_status text DEFAULT 'REVIEW_REQUIRED'::text NOT NULL,
    classification_source text,
    date_of_birth text,
    gender text,
    occupation text,
    bank_code text,
    nid_number text,
    pan_no text,
    citizenship_no text,
    kitta numeric DEFAULT 0,
    needs_review boolean DEFAULT false NOT NULL,
    data_quality_notes text,
    CONSTRAINT chk_clients_kitta_nonneg CHECK ((kitta >= (0)::numeric)),
    CONSTRAINT clients_classification_status_check CHECK ((classification_status = ANY (ARRAY['AUTO_CLASSIFIED'::text, 'CONFIRMED'::text, 'REVIEW_REQUIRED'::text]))),
    CONSTRAINT clients_payee_classification_check CHECK ((payee_classification = ANY (ARRAY['NATURAL_PERSON'::text, 'PUBLIC_LEGAL_PERSON'::text, 'COMPANY_INSTITUTION'::text, 'FOREIGN_INVESTOR'::text, 'BANK_FI'::text, 'TAX_EXEMPT'::text, 'UNCLASSIFIED'::text]))),
    CONSTRAINT clients_payee_segment_check CHECK (((payee_segment IS NULL) OR (payee_segment = ANY (ARRAY['PROMOTER'::text, 'LOCAL'::text, 'EMPLOYEE'::text, 'PUBLIC'::text]))))
);


--

-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_code text NOT NULL,
    company_name text NOT NULL,
    sector_type public.sector_type,
    interest_tax_status public.tax_status,
    pan_no text,
    bank_account_no text,
    bank_name text,
    status public.record_status DEFAULT 'Active'::public.record_status NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_type text,
    isin text,
    listed_date date,
    registrar text DEFAULT 'RBB Merchant Banking Limited'::text,
    fiscal_year text,
    dividend_rate numeric,
    debenture_rate numeric,
    coupon_rate numeric,
    maturity_date date,
    face_value numeric DEFAULT 100,
    issue_size numeric,
    email text,
    phone text,
    website text,
    address text,
    CONSTRAINT chk_companies_coupon_rate_range CHECK (((coupon_rate IS NULL) OR ((coupon_rate >= (0)::numeric) AND (coupon_rate <= (100)::numeric)))),
    CONSTRAINT chk_companies_dividend_rate_range CHECK (((dividend_rate IS NULL) OR ((dividend_rate >= (0)::numeric) AND (dividend_rate <= (1000)::numeric))))
);


--

-- Name: dividend_payables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dividend_payables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    client_id uuid NOT NULL,
    shares_held numeric(15,2) DEFAULT 0,
    dividend_rate numeric(10,4) DEFAULT 0,
    gross_dividend numeric(15,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(15,2) DEFAULT 0 NOT NULL,
    net_payable numeric(15,2) DEFAULT 0 NOT NULL,
    payment_status public.payment_status DEFAULT 'Pending'::public.payment_status NOT NULL,
    payment_date date,
    payment_reference text,
    fiscal_year text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    upload_id uuid,
    dividend_type public.dividend_type,
    bonus_ratio text,
    right_ratio text,
    fraction_shares numeric(15,4) DEFAULT 0,
    rounded_quantity numeric(15,2) DEFAULT 0,
    final_quantity numeric(15,2) DEFAULT 0,
    lock_in_period text,
    promoter_quantity numeric(15,2) DEFAULT 0,
    public_quantity numeric(15,2) DEFAULT 0,
    employee_quantity numeric(15,2) DEFAULT 0,
    returned_status text,
    cancelled_status text,
    paid_amount numeric(15,2) DEFAULT 0,
    remaining_amount numeric(15,2) DEFAULT 0,
    adjustment_amount numeric(15,2) DEFAULT 0,
    previous_balance numeric(15,2) DEFAULT 0,
    final_payable numeric(15,2) DEFAULT 0,
    rts_submitted boolean DEFAULT false,
    rts_attempts integer DEFAULT 0,
    rts_error text,
    bonus_actual numeric(15,2) DEFAULT 0,
    bonus_issued numeric(15,2) DEFAULT 0,
    bonus_fraction numeric(15,4) DEFAULT 0,
    after_bonus_kitta numeric(15,2) DEFAULT 0,
    bonus_tax numeric(15,2) DEFAULT 0,
    lot_name text,
    tds_rate numeric(10,4),
    bank_name text,
    bank_account_no text,
    payee_classification text DEFAULT 'UNCLASSIFIED'::text NOT NULL,
    payee_segment text,
    classification_status text DEFAULT 'REVIEW_REQUIRED'::text NOT NULL,
    bank_branch text,
    remarks text,
    bonus_rate numeric,
    CONSTRAINT chk_div_balance_invariant CHECK ((abs(((gross_dividend - tax_amount) - net_payable)) <= 0.05)),
    CONSTRAINT chk_div_gross_nonneg CHECK ((gross_dividend >= (0)::numeric)),
    CONSTRAINT chk_div_net_le_gross CHECK ((net_payable <= (gross_dividend + 0.05))),
    CONSTRAINT chk_div_net_nonneg CHECK ((net_payable >= (0)::numeric)),
    CONSTRAINT chk_div_shares_nonneg CHECK (((shares_held IS NULL) OR (shares_held >= (0)::numeric))),
    CONSTRAINT chk_div_tax_le_gross CHECK ((tax_amount <= (gross_dividend + 0.05))),
    CONSTRAINT chk_div_tax_nonneg CHECK ((tax_amount >= (0)::numeric)),
    CONSTRAINT chk_div_tds_rate_range CHECK (((tds_rate IS NULL) OR ((tds_rate >= (0)::numeric) AND (tds_rate <= (1)::numeric)))),
    CONSTRAINT dividend_payables_classification_status_check CHECK ((classification_status = ANY (ARRAY['AUTO_CLASSIFIED'::text, 'CONFIRMED'::text, 'REVIEW_REQUIRED'::text]))),
    CONSTRAINT dividend_payables_payee_classification_check CHECK ((payee_classification = ANY (ARRAY['NATURAL_PERSON'::text, 'PUBLIC_LEGAL_PERSON'::text, 'COMPANY_INSTITUTION'::text, 'FOREIGN_INVESTOR'::text, 'BANK_FI'::text, 'TAX_EXEMPT'::text, 'UNCLASSIFIED'::text]))),
    CONSTRAINT dividend_payables_payee_segment_check CHECK (((payee_segment IS NULL) OR (payee_segment = ANY (ARRAY['PROMOTER'::text, 'LOCAL'::text, 'EMPLOYEE'::text, 'PUBLIC'::text]))))
);


--

-- Name: interest_payables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interest_payables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    client_id uuid NOT NULL,
    instrument_ref text,
    gross_interest numeric(15,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(15,2) DEFAULT 0 NOT NULL,
    net_payable numeric(15,2) DEFAULT 0 NOT NULL,
    due_date date NOT NULL,
    payment_status public.payment_status DEFAULT 'Pending'::public.payment_status NOT NULL,
    payment_date date,
    payment_reference text,
    fiscal_year text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    upload_id uuid,
    interest_rate_type public.interest_rate_type,
    interest_rate_value numeric(10,4),
    from_date date,
    to_date date,
    days_count integer,
    tds numeric(15,2),
    net_interest numeric(15,2),
    paid_amount numeric(15,2) DEFAULT 0,
    remaining_amount numeric(15,2) DEFAULT 0,
    adjustment_amount numeric(15,2) DEFAULT 0,
    previous_balance numeric(15,2) DEFAULT 0,
    final_payable numeric(15,2) DEFAULT 0,
    tds_rate numeric(10,4),
    payee_classification text DEFAULT 'UNCLASSIFIED'::text NOT NULL,
    payee_segment text,
    classification_status text DEFAULT 'REVIEW_REQUIRED'::text NOT NULL,
    bank_name text,
    bank_account_no text,
    bank_branch text,
    lot_name text,
    remarks text,
    shares_held numeric DEFAULT 0,
    kitta numeric DEFAULT 0,
    CONSTRAINT chk_int_balance_invariant CHECK ((abs(((gross_interest - tax_amount) - net_payable)) <= 0.05)),
    CONSTRAINT chk_int_gross_nonneg CHECK ((gross_interest >= (0)::numeric)),
    CONSTRAINT chk_int_kitta_nonneg CHECK ((((kitta IS NULL) OR (kitta >= (0)::numeric)) AND ((shares_held IS NULL) OR (shares_held >= (0)::numeric)))),
    CONSTRAINT chk_int_net_le_gross CHECK ((net_payable <= (gross_interest + 0.05))),
    CONSTRAINT chk_int_net_nonneg CHECK ((net_payable >= (0)::numeric)),
    CONSTRAINT chk_int_tax_le_gross CHECK ((tax_amount <= (gross_interest + 0.05))),
    CONSTRAINT chk_int_tax_nonneg CHECK ((tax_amount >= (0)::numeric)),
    CONSTRAINT chk_int_tds_rate_range CHECK (((tds_rate IS NULL) OR ((tds_rate >= (0)::numeric) AND (tds_rate <= (1)::numeric)))),
    CONSTRAINT interest_payables_classification_status_check CHECK ((classification_status = ANY (ARRAY['AUTO_CLASSIFIED'::text, 'CONFIRMED'::text, 'REVIEW_REQUIRED'::text]))),
    CONSTRAINT interest_payables_payee_classification_check CHECK ((payee_classification = ANY (ARRAY['NATURAL_PERSON'::text, 'PUBLIC_LEGAL_PERSON'::text, 'COMPANY_INSTITUTION'::text, 'FOREIGN_INVESTOR'::text, 'BANK_FI'::text, 'TAX_EXEMPT'::text, 'UNCLASSIFIED'::text]))),
    CONSTRAINT interest_payables_payee_segment_check CHECK (((payee_segment IS NULL) OR (payee_segment = ANY (ARRAY['PROMOTER'::text, 'LOCAL'::text, 'EMPLOYEE'::text, 'PUBLIC'::text]))))
);


--

-- Name: mutual_fund_payables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mutual_fund_payables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id uuid,
    company_id uuid NOT NULL,
    client_id uuid NOT NULL,
    shares_held numeric(15,2) DEFAULT 0,
    dividend_rate numeric(10,4) DEFAULT 0,
    dividend_type public.dividend_type DEFAULT 'Cash'::public.dividend_type NOT NULL,
    gross_dividend numeric(15,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(15,2) DEFAULT 0 NOT NULL,
    net_payable numeric(15,2) DEFAULT 0 NOT NULL,
    payment_status public.payment_status DEFAULT 'Pending'::public.payment_status NOT NULL,
    payment_date date,
    payment_reference text,
    bonus_actual numeric(15,2),
    bonus_issued numeric(15,2),
    bonus_fraction numeric(15,2),
    after_bonus_kitta numeric(15,2),
    bonus_tax numeric(15,2),
    bank_name text,
    bank_account_no text,
    lot_name text,
    fiscal_year text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tds_rate numeric(10,4),
    payee_classification text DEFAULT 'UNCLASSIFIED'::text NOT NULL,
    payee_segment text,
    classification_status text DEFAULT 'REVIEW_REQUIRED'::text NOT NULL,
    remarks text,
    bank_branch text,
    paid_amount numeric(15,2) DEFAULT 0,
    remaining_amount numeric(15,2),
    CONSTRAINT chk_mf_balance_invariant CHECK ((abs(((gross_dividend - tax_amount) - net_payable)) <= 0.05)),
    CONSTRAINT chk_mf_gross_nonneg CHECK ((gross_dividend >= (0)::numeric)),
    CONSTRAINT chk_mf_net_le_gross CHECK ((net_payable <= (gross_dividend + 0.05))),
    CONSTRAINT chk_mf_net_nonneg CHECK ((net_payable >= (0)::numeric)),
    CONSTRAINT chk_mf_shares_nonneg CHECK (((shares_held IS NULL) OR (shares_held >= (0)::numeric))),
    CONSTRAINT chk_mf_tax_le_gross CHECK ((tax_amount <= (gross_dividend + 0.05))),
    CONSTRAINT chk_mf_tax_nonneg CHECK ((tax_amount >= (0)::numeric)),
    CONSTRAINT chk_mf_tds_rate_range CHECK (((tds_rate IS NULL) OR ((tds_rate >= (0)::numeric) AND (tds_rate <= (1)::numeric)))),
    CONSTRAINT mutual_fund_payables_classification_status_check CHECK ((classification_status = ANY (ARRAY['AUTO_CLASSIFIED'::text, 'CONFIRMED'::text, 'REVIEW_REQUIRED'::text]))),
    CONSTRAINT mutual_fund_payables_payee_classification_check CHECK ((payee_classification = ANY (ARRAY['NATURAL_PERSON'::text, 'PUBLIC_LEGAL_PERSON'::text, 'COMPANY_INSTITUTION'::text, 'FOREIGN_INVESTOR'::text, 'BANK_FI'::text, 'TAX_EXEMPT'::text, 'UNCLASSIFIED'::text]))),
    CONSTRAINT mutual_fund_payables_payee_segment_check CHECK (((payee_segment IS NULL) OR (payee_segment = ANY (ARRAY['PROMOTER'::text, 'LOCAL'::text, 'EMPLOYEE'::text, 'PUBLIC'::text]))))
);


--

-- Name: error_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.error_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    error_type text NOT NULL,
    error_code text,
    error_message text NOT NULL,
    stack_trace text,
    context jsonb,
    ip_address text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: fiscal_years; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fiscal_years (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fiscal_year text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: iaf_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iaf_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    fiscal_year text NOT NULL,
    allocated_amount numeric(15,2) DEFAULT 0 NOT NULL,
    utilized_amount numeric(15,2) DEFAULT 0 NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: login_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    email text,
    ip_address text,
    user_agent text,
    browser text,
    device text,
    login_status text NOT NULL,
    failure_reason text,
    login_time timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: notification_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    email_enabled boolean DEFAULT false NOT NULL,
    sms_enabled boolean DEFAULT false NOT NULL,
    system_enabled boolean DEFAULT true NOT NULL,
    email_template text,
    sms_template text,
    email_recipients text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    title text NOT NULL,
    message text NOT NULL,
    channel public.notification_channel DEFAULT 'System'::public.notification_channel NOT NULL,
    category text,
    reference_type text,
    reference_id uuid,
    is_read boolean DEFAULT false NOT NULL,
    read_at timestamp with time zone,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: payable_tax_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payable_tax_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payable_category text NOT NULL,
    payee_classification text NOT NULL,
    tax_rate numeric(7,6) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payable_tax_rules_payable_category_check CHECK ((payable_category = ANY (ARRAY['DIVIDEND'::text, 'INTEREST'::text, 'MUTUAL_FUND'::text]))),
    CONSTRAINT payable_tax_rules_payee_classification_check CHECK ((payee_classification = ANY (ARRAY['NATURAL_PERSON'::text, 'PUBLIC_LEGAL_PERSON'::text, 'COMPANY_INSTITUTION'::text, 'FOREIGN_INVESTOR'::text, 'BANK_FI'::text, 'TAX_EXEMPT'::text]))),
    CONSTRAINT payable_tax_rules_tax_rate_check CHECK (((tax_rate >= (0)::numeric) AND (tax_rate <= (1)::numeric)))
);


--

-- Name: payment_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_name text NOT NULL,
    company_id uuid,
    fiscal_year text,
    payable_type text,
    total_payments integer DEFAULT 0 NOT NULL,
    total_amount numeric(15,2) DEFAULT 0 NOT NULL,
    status public.payment_batch_status DEFAULT 'Draft'::public.payment_batch_status NOT NULL,
    neft_file_url text,
    connectips_file_url text,
    rtgs_file_url text,
    created_by uuid,
    approved_by uuid,
    approved_at timestamp with time zone,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    total_tax numeric(15,2) DEFAULT 0 NOT NULL,
    payment_method text,
    cds_batch_ref text,
    registrar text
);


--

-- Name: payment_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid,
    action text NOT NULL,
    previous_status text,
    new_status text,
    amount numeric(15,2),
    notes text,
    performed_by uuid,
    performed_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid,
    company_id uuid,
    client_id uuid,
    payable_type text NOT NULL,
    payable_id uuid NOT NULL,
    gross_amount numeric(15,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(15,2) DEFAULT 0 NOT NULL,
    net_amount numeric(15,2) DEFAULT 0 NOT NULL,
    paid_amount numeric(15,2) DEFAULT 0 NOT NULL,
    payment_method public.payment_method,
    payment_date date,
    payment_reference text,
    bank_name text,
    bank_account_no text,
    neft_ref text,
    connectips_ref text,
    rtgs_ref text,
    cheque_no text,
    remarks text,
    status text DEFAULT 'Pending'::text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    processed_by uuid,
    processed_at timestamp with time zone,
    reversed_by uuid,
    reversed_at timestamp with time zone,
    reversal_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_pay_amounts_nonneg CHECK (((gross_amount >= (0)::numeric) AND (tax_amount >= (0)::numeric) AND (net_amount >= (0)::numeric) AND (paid_amount >= (0)::numeric))),
    CONSTRAINT chk_pay_balance_invariant CHECK ((abs(((gross_amount - tax_amount) - net_amount)) <= 0.05)),
    CONSTRAINT chk_pay_net_le_gross CHECK ((net_amount <= (gross_amount + 0.05))),
    CONSTRAINT chk_pay_tax_le_gross CHECK ((tax_amount <= (gross_amount + 0.05)))
);


--

-- Name: pending_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    action text NOT NULL,
    payload jsonb NOT NULL,
    status public.approval_status DEFAULT 'Pending'::public.approval_status NOT NULL,
    requested_by uuid,
    reviewed_by uuid,
    review_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone
);


--

-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: reconciliation_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reconciliation_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reconciliation_date date DEFAULT CURRENT_DATE NOT NULL,
    source_a_type text NOT NULL,
    source_a_id uuid,
    source_b_type text NOT NULL,
    source_b_id uuid,
    client_id uuid,
    company_id uuid,
    payable_type text,
    payable_id uuid,
    expected_amount numeric(15,2),
    actual_amount numeric(15,2),
    difference numeric(15,2) DEFAULT 0,
    result public.reconciliation_result DEFAULT 'Pending'::public.reconciliation_result NOT NULL,
    notes text,
    matched_by uuid,
    matched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    fiscal_year text,
    payment_id uuid,
    batch_id uuid
);


--

-- Name: seq_agm_broker_claim_no; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_agm_broker_claim_no
    START WITH 9020001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--

-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    setting_key text NOT NULL,
    setting_value jsonb NOT NULL,
    description text,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: upload_errors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.upload_errors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id uuid NOT NULL,
    row_number integer NOT NULL,
    field_name text,
    error_type text NOT NULL,
    error_message text NOT NULL,
    raw_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: upload_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.upload_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    file_name text NOT NULL,
    file_size bigint DEFAULT 0 NOT NULL,
    file_hash text,
    file_type text,
    sheet_name text,
    total_rows integer DEFAULT 0 NOT NULL,
    success_rows integer DEFAULT 0 NOT NULL,
    error_rows integer DEFAULT 0 NOT NULL,
    target_table text,
    status text DEFAULT 'Processing'::text NOT NULL,
    error_message text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: user_company_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_company_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    company_id uuid NOT NULL,
    role_override public.app_role,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--

-- Name: agm_broker_claims agm_broker_claims_company_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_broker_claims
    ADD CONSTRAINT agm_broker_claims_company_seq_key UNIQUE (company_id, seq_no);


--

-- Name: agm_broker_claims agm_broker_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_broker_claims
    ADD CONSTRAINT agm_broker_claims_pkey PRIMARY KEY (id);


--

-- Name: agm_broker_pools agm_broker_pools_company_pool_fy_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_broker_pools
    ADD CONSTRAINT agm_broker_pools_company_pool_fy_key UNIQUE (company_id, pool_boid, fiscal_year);


--

-- Name: agm_broker_pools agm_broker_pools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_broker_pools
    ADD CONSTRAINT agm_broker_pools_pkey PRIMARY KEY (id);


--

-- Name: agm_drn_records agm_drn_records_company_folio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_drn_records
    ADD CONSTRAINT agm_drn_records_company_folio_key UNIQUE (company_id, folio_no);


--

-- Name: agm_drn_records agm_drn_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_drn_records
    ADD CONSTRAINT agm_drn_records_pkey PRIMARY KEY (id);


--

-- Name: agm_fiscal_year_meta agm_fiscal_year_meta_company_fy_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_fiscal_year_meta
    ADD CONSTRAINT agm_fiscal_year_meta_company_fy_key UNIQUE (company_id, fiscal_year);


--

-- Name: agm_historical_shareholders agm_historical_shareholders_company_boid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_historical_shareholders
    ADD CONSTRAINT agm_historical_shareholders_company_boid_key UNIQUE (company_id, boid);


--

-- Name: agm_historical_shareholders agm_historical_shareholders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_historical_shareholders
    ADD CONSTRAINT agm_historical_shareholders_pkey PRIMARY KEY (id);


--

-- Name: agm_import_staging agm_import_staging_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_import_staging
    ADD CONSTRAINT agm_import_staging_pkey PRIMARY KEY (id);


--

-- Name: agm_yearly_snapshots agm_yearly_snapshots_company_boid_fy_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_yearly_snapshots
    ADD CONSTRAINT agm_yearly_snapshots_company_boid_fy_key UNIQUE (company_id, boid, fiscal_year);


--

-- Name: agm_yearly_snapshots agm_yearly_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_yearly_snapshots
    ADD CONSTRAINT agm_yearly_snapshots_pkey PRIMARY KEY (id);


--

-- Name: api_logs api_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_logs
    ADD CONSTRAINT api_logs_pkey PRIMARY KEY (id);


--

-- Name: approval_logs approval_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_logs
    ADD CONSTRAINT approval_logs_pkey PRIMARY KEY (id);


--

-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--

-- Name: bank_statements bank_statements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statements
    ADD CONSTRAINT bank_statements_pkey PRIMARY KEY (id);


--

-- Name: bank_transactions bank_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_pkey PRIMARY KEY (id);


--

-- Name: clients clients_boid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_boid_key UNIQUE (boid);


--

-- Name: clients clients_client_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_client_code_key UNIQUE (client_code);


--

-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--

-- Name: companies companies_company_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_company_code_key UNIQUE (company_code);


--

-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--

-- Name: dividend_payables dividend_payables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dividend_payables
    ADD CONSTRAINT dividend_payables_pkey PRIMARY KEY (id);


--

-- Name: error_logs error_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_logs
    ADD CONSTRAINT error_logs_pkey PRIMARY KEY (id);


--

-- Name: fiscal_years fiscal_years_fiscal_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_years
    ADD CONSTRAINT fiscal_years_fiscal_year_key UNIQUE (fiscal_year);


--

-- Name: fiscal_years fiscal_years_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_years
    ADD CONSTRAINT fiscal_years_pkey PRIMARY KEY (id);


--

-- Name: iaf_allocations iaf_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iaf_allocations
    ADD CONSTRAINT iaf_allocations_pkey PRIMARY KEY (id);


--

-- Name: interest_payables interest_payables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interest_payables
    ADD CONSTRAINT interest_payables_pkey PRIMARY KEY (id);


--

-- Name: login_logs login_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_logs
    ADD CONSTRAINT login_logs_pkey PRIMARY KEY (id);


--

-- Name: mutual_fund_payables mutual_fund_payables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mutual_fund_payables
    ADD CONSTRAINT mutual_fund_payables_pkey PRIMARY KEY (id);


--

-- Name: notification_configs notification_configs_category_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_configs
    ADD CONSTRAINT notification_configs_category_key UNIQUE (category);


--

-- Name: notification_configs notification_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_configs
    ADD CONSTRAINT notification_configs_pkey PRIMARY KEY (id);


--

-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--

-- Name: payable_tax_rules payable_tax_rules_payable_category_payee_classification_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payable_tax_rules
    ADD CONSTRAINT payable_tax_rules_payable_category_payee_classification_key UNIQUE (payable_category, payee_classification);


--

-- Name: payable_tax_rules payable_tax_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payable_tax_rules
    ADD CONSTRAINT payable_tax_rules_pkey PRIMARY KEY (id);


--

-- Name: payment_batches payment_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_batches
    ADD CONSTRAINT payment_batches_pkey PRIMARY KEY (id);


--

-- Name: payment_logs payment_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_logs
    ADD CONSTRAINT payment_logs_pkey PRIMARY KEY (id);


--

-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--

-- Name: pending_approvals pending_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_approvals
    ADD CONSTRAINT pending_approvals_pkey PRIMARY KEY (id);


--

-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--

-- Name: reconciliation_results reconciliation_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_results
    ADD CONSTRAINT reconciliation_results_pkey PRIMARY KEY (id);


--

-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--

-- Name: system_settings system_settings_setting_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_setting_key_key UNIQUE (setting_key);


--

-- Name: upload_errors upload_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_errors
    ADD CONSTRAINT upload_errors_pkey PRIMARY KEY (id);


--

-- Name: upload_history upload_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_history
    ADD CONSTRAINT upload_history_pkey PRIMARY KEY (id);


--

-- Name: clients uq_clients_company_boid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT uq_clients_company_boid UNIQUE (company_id, boid);


--

-- Name: user_company_access user_company_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_company_access
    ADD CONSTRAINT user_company_access_pkey PRIMARY KEY (id);


--

-- Name: user_company_access user_company_access_user_id_company_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_company_access
    ADD CONSTRAINT user_company_access_user_id_company_id_key UNIQUE (user_id, company_id);


--

-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--

-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--

-- Name: idx_agm_broker_claims_boid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agm_broker_claims_boid ON public.agm_broker_claims USING btree (claimant_boid);


--

-- Name: idx_agm_broker_claims_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agm_broker_claims_company_id ON public.agm_broker_claims USING btree (company_id);


--

-- Name: idx_agm_broker_pools_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agm_broker_pools_company_id ON public.agm_broker_pools USING btree (company_id);


--

-- Name: idx_agm_drn_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agm_drn_company_id ON public.agm_drn_records USING btree (company_id);


--

-- Name: idx_agm_drn_folio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agm_drn_folio ON public.agm_drn_records USING btree (folio_no);


--

-- Name: idx_agm_fy_meta_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agm_fy_meta_company_id ON public.agm_fiscal_year_meta USING btree (company_id);


--

-- Name: idx_agm_shareholders_boid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agm_shareholders_boid ON public.agm_historical_shareholders USING btree (boid);


--

-- Name: idx_agm_shareholders_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agm_shareholders_company_id ON public.agm_historical_shareholders USING btree (company_id);


--

-- Name: idx_agm_shareholders_current_kitta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agm_shareholders_current_kitta ON public.agm_historical_shareholders USING btree (current_kitta_2081 DESC);


--

-- Name: idx_agm_shareholders_folio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agm_shareholders_folio ON public.agm_historical_shareholders USING btree (original_folio_no) WHERE (original_folio_no IS NOT NULL);


--

-- Name: idx_agm_shareholders_holder_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agm_shareholders_holder_type ON public.agm_historical_shareholders USING btree (holder_type);


--

-- Name: idx_agm_snapshots_boid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agm_snapshots_boid ON public.agm_yearly_snapshots USING btree (boid);


--

-- Name: idx_agm_snapshots_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agm_snapshots_company_id ON public.agm_yearly_snapshots USING btree (company_id);


--

-- Name: idx_agm_snapshots_conv_folio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agm_snapshots_conv_folio ON public.agm_yearly_snapshots USING btree (converted_from_folio) WHERE (converted_from_folio IS NOT NULL);


--

-- Name: idx_agm_snapshots_fy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agm_snapshots_fy ON public.agm_yearly_snapshots USING btree (fiscal_year);


--

-- Name: idx_agm_snapshots_shareholder_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agm_snapshots_shareholder_id ON public.agm_yearly_snapshots USING btree (shareholder_id);


--

-- Name: idx_agm_staging_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agm_staging_lookup ON public.agm_import_staging USING btree (company_id, fiscal_year, batch_id);


--

-- Name: idx_audit_action_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_action_time ON public.audit_logs USING btree (action, action_time DESC);


--

-- Name: idx_audit_table_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_table_time ON public.audit_logs USING btree (table_name, action_time DESC);


--

-- Name: idx_audit_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_time ON public.audit_logs USING btree (action_time DESC);


--

-- Name: idx_audit_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user_time ON public.audit_logs USING btree (user_id, action_time DESC);


--

-- Name: idx_clients_boid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_boid ON public.clients USING btree (boid);


--

-- Name: idx_clients_company_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_company_created_at ON public.clients USING btree (company_id, created_at DESC);


--

-- Name: idx_clients_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_company_id ON public.clients USING btree (company_id);


--

-- Name: idx_clients_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_created_at ON public.clients USING btree (created_at DESC);


--

-- Name: idx_clients_needs_review; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_needs_review ON public.clients USING btree (needs_review) WHERE (needs_review = true);


--

-- Name: idx_clients_pan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_pan ON public.clients USING btree (pan_or_citizenship);


--

-- Name: idx_clients_payee_classification; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_payee_classification ON public.clients USING btree (payee_classification);


--

-- Name: idx_clients_trgm_account_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_trgm_account_no ON public.clients USING gin (bank_account_no public.gin_trgm_ops);


--

-- Name: idx_clients_trgm_boid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_trgm_boid ON public.clients USING gin (boid public.gin_trgm_ops);


--

-- Name: idx_clients_trgm_client_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_trgm_client_code ON public.clients USING gin (client_code public.gin_trgm_ops);


--

-- Name: idx_clients_trgm_composite_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_trgm_composite_search ON public.clients USING gin ((((((((((COALESCE(full_name, ''::text) || ' '::text) || COALESCE(boid, ''::text)) || ' '::text) || COALESCE(client_code, ''::text)) || ' '::text) || COALESCE(pan_or_citizenship, ''::text)) || ' '::text) || COALESCE(bank_account_no, ''::text))) public.gin_trgm_ops);


--

-- Name: idx_clients_trgm_full_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_trgm_full_name ON public.clients USING gin (full_name public.gin_trgm_ops);


--

-- Name: idx_clients_trgm_pan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_trgm_pan ON public.clients USING gin (pan_or_citizenship public.gin_trgm_ops);


--

-- Name: idx_companies_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_created_by ON public.companies USING btree (created_by);


--

-- Name: idx_companies_fiscal_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_fiscal_year ON public.companies USING btree (fiscal_year);


--

-- Name: idx_companies_isin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_isin ON public.companies USING btree (isin);


--

-- Name: idx_div_payables_comp_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_div_payables_comp_client ON public.dividend_payables USING btree (company_id, client_id);


--

-- Name: idx_div_payables_comp_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_div_payables_comp_created_at ON public.dividend_payables USING btree (company_id, created_at DESC);


--

-- Name: idx_dividend_fy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dividend_fy ON public.dividend_payables USING btree (fiscal_year);


--

-- Name: idx_dividend_payables_classification; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dividend_payables_classification ON public.dividend_payables USING btree (company_id, payee_classification);


--

-- Name: idx_dividend_payables_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dividend_payables_client_id ON public.dividend_payables USING btree (client_id);


--

-- Name: idx_dividend_payables_comp_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dividend_payables_comp_lookup ON public.dividend_payables USING btree (company_id, fiscal_year, payment_status);


--

-- Name: idx_dividend_payables_comp_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dividend_payables_comp_status_created ON public.dividend_payables USING btree (company_id, payment_status, created_at);


--

-- Name: idx_dividend_payables_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dividend_payables_company_id ON public.dividend_payables USING btree (company_id);


--

-- Name: idx_dividend_payables_fiscal_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dividend_payables_fiscal_year ON public.dividend_payables USING btree (fiscal_year);


--

-- Name: idx_dividend_payables_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dividend_payables_status ON public.dividend_payables USING btree (payment_status);


--

-- Name: idx_dividend_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dividend_status ON public.dividend_payables USING btree (payment_status);


--

-- Name: idx_error_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_time ON public.error_logs USING btree (created_at DESC);


--

-- Name: idx_error_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_type ON public.error_logs USING btree (error_type);


--

-- Name: idx_int_payables_comp_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_int_payables_comp_client ON public.interest_payables USING btree (company_id, client_id);


--

-- Name: idx_int_payables_comp_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_int_payables_comp_created_at ON public.interest_payables USING btree (company_id, created_at DESC);


--

-- Name: idx_interest_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interest_due ON public.interest_payables USING btree (due_date);


--

-- Name: idx_interest_payables_classification; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interest_payables_classification ON public.interest_payables USING btree (company_id, payee_classification);


--

-- Name: idx_interest_payables_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interest_payables_client_id ON public.interest_payables USING btree (client_id);


--

-- Name: idx_interest_payables_comp_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interest_payables_comp_lookup ON public.interest_payables USING btree (company_id, fiscal_year, payment_status);


--

-- Name: idx_interest_payables_comp_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interest_payables_comp_status_created ON public.interest_payables USING btree (company_id, payment_status, created_at);


--

-- Name: idx_interest_payables_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interest_payables_company_id ON public.interest_payables USING btree (company_id);


--

-- Name: idx_interest_payables_fiscal_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interest_payables_fiscal_year ON public.interest_payables USING btree (fiscal_year);


--

-- Name: idx_interest_payables_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interest_payables_status ON public.interest_payables USING btree (payment_status);


--

-- Name: idx_interest_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interest_status ON public.interest_payables USING btree (payment_status);


--

-- Name: idx_login_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_time ON public.login_logs USING btree (login_time DESC);


--

-- Name: idx_mf_payables_classification; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mf_payables_classification ON public.mutual_fund_payables USING btree (company_id, payee_classification);


--

-- Name: idx_mf_payables_comp_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mf_payables_comp_client ON public.mutual_fund_payables USING btree (company_id, client_id);


--

-- Name: idx_mf_payables_comp_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mf_payables_comp_created_at ON public.mutual_fund_payables USING btree (company_id, created_at DESC);


--

-- Name: idx_mf_payables_comp_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mf_payables_comp_status_created ON public.mutual_fund_payables USING btree (company_id, payment_status, created_at);


--

-- Name: idx_mutual_fund_fy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mutual_fund_fy ON public.mutual_fund_payables USING btree (fiscal_year);


--

-- Name: idx_mutual_fund_payables_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mutual_fund_payables_client_id ON public.mutual_fund_payables USING btree (client_id);


--

-- Name: idx_mutual_fund_payables_comp_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mutual_fund_payables_comp_lookup ON public.mutual_fund_payables USING btree (company_id, fiscal_year, payment_status);


--

-- Name: idx_mutual_fund_payables_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mutual_fund_payables_company_id ON public.mutual_fund_payables USING btree (company_id);


--

-- Name: idx_mutual_fund_payables_fiscal_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mutual_fund_payables_fiscal_year ON public.mutual_fund_payables USING btree (fiscal_year);


--

-- Name: idx_mutual_fund_payables_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mutual_fund_payables_status ON public.mutual_fund_payables USING btree (payment_status);


--

-- Name: idx_mutual_fund_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mutual_fund_status ON public.mutual_fund_payables USING btree (payment_status);


--

-- Name: idx_notif_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_read ON public.notifications USING btree (is_read);


--

-- Name: idx_notif_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_user ON public.notifications USING btree (user_id);


--

-- Name: idx_payment_batches_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_batches_company_id ON public.payment_batches USING btree (company_id);


--

-- Name: idx_payment_batches_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_batches_status ON public.payment_batches USING btree (status);


--

-- Name: idx_payments_bank_account_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_bank_account_no ON public.payments USING btree (bank_account_no);


--

-- Name: idx_payments_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_batch ON public.payments USING btree (batch_id);


--

-- Name: idx_payments_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_batch_id ON public.payments USING btree (batch_id);


--

-- Name: idx_payments_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_client_id ON public.payments USING btree (client_id);


--

-- Name: idx_payments_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_company_id ON public.payments USING btree (company_id);


--

-- Name: idx_payments_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_company_status ON public.payments USING btree (company_id, status);


--

-- Name: idx_payments_connectips_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_connectips_ref ON public.payments USING btree (connectips_ref);


--

-- Name: idx_payments_paid_amount; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_paid_amount ON public.payments USING btree (paid_amount);


--

-- Name: idx_payments_payable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_payable ON public.payments USING btree (payable_id, payable_type);


--

-- Name: idx_payments_payable_active_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_payable_active_lookup ON public.payments USING btree (payable_id, status) WHERE (status = ANY (ARRAY['Draft'::text, 'Pending'::text, 'Approved'::text]));


--

-- Name: idx_payments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_status ON public.payments USING btree (status);


--

-- Name: idx_recon_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recon_date ON public.reconciliation_results USING btree (reconciliation_date);


--

-- Name: idx_recon_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recon_result ON public.reconciliation_results USING btree (result);


--

-- Name: idx_reconciliation_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reconciliation_company_id ON public.reconciliation_results USING btree (company_id);


--

-- Name: idx_reconciliation_results_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reconciliation_results_client_id ON public.reconciliation_results USING btree (client_id);


--

-- Name: idx_reconciliation_results_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reconciliation_results_company_id ON public.reconciliation_results USING btree (company_id);


--

-- Name: idx_reconciliation_results_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reconciliation_results_date ON public.reconciliation_results USING btree (reconciliation_date);


--

-- Name: idx_reconciliation_results_payable_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reconciliation_results_payable_id ON public.reconciliation_results USING btree (payable_id);


--

-- Name: idx_reconciliation_results_payment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reconciliation_results_payment_id ON public.reconciliation_results USING btree (payment_id);


--

-- Name: idx_uca_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uca_company ON public.user_company_access USING btree (company_id);


--

-- Name: idx_uca_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uca_user ON public.user_company_access USING btree (user_id);


--

-- Name: uq_active_payments_payable_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_active_payments_payable_id ON public.payments USING btree (payable_id) WHERE ((status = ANY (ARRAY['Draft'::text, 'Pending'::text, 'Approved'::text])) AND (payable_id IS NOT NULL));


--

-- Name: uq_dividend_payables_client_fy_remarks; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_dividend_payables_client_fy_remarks ON public.dividend_payables USING btree (client_id, company_id, fiscal_year, COALESCE(remarks, ''::text));


--

-- Name: uq_interest_payables_client_fy_remarks; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_interest_payables_client_fy_remarks ON public.interest_payables USING btree (client_id, company_id, fiscal_year, COALESCE(remarks, ''::text));


--

-- Name: uq_mutual_fund_payables_client_fy_remarks; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_mutual_fund_payables_client_fy_remarks ON public.mutual_fund_payables USING btree (client_id, company_id, fiscal_year, COALESCE(remarks, ''::text));


--

-- Name: uq_upload_history_active_file_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_upload_history_active_file_hash ON public.upload_history USING btree (file_hash, target_table) WHERE ((status = ANY (ARRAY['Completed'::text, 'Processing'::text])) AND (file_hash IS NOT NULL) AND (file_hash <> ''::text));


--

-- Name: uq_user_company_access; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_user_company_access ON public.user_company_access USING btree (user_id, company_id);


--

-- Name: agm_broker_claims agm_broker_claims_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_broker_claims
    ADD CONSTRAINT agm_broker_claims_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--

-- Name: agm_broker_pools agm_broker_pools_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_broker_pools
    ADD CONSTRAINT agm_broker_pools_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--

-- Name: agm_drn_records agm_drn_records_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_drn_records
    ADD CONSTRAINT agm_drn_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--

-- Name: agm_fiscal_year_meta agm_fiscal_year_meta_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_fiscal_year_meta
    ADD CONSTRAINT agm_fiscal_year_meta_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--

-- Name: agm_historical_shareholders agm_historical_shareholders_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_historical_shareholders
    ADD CONSTRAINT agm_historical_shareholders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--

-- Name: agm_import_staging agm_import_staging_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_import_staging
    ADD CONSTRAINT agm_import_staging_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--

-- Name: agm_yearly_snapshots agm_yearly_snapshots_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_yearly_snapshots
    ADD CONSTRAINT agm_yearly_snapshots_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--

-- Name: agm_yearly_snapshots agm_yearly_snapshots_shareholder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agm_yearly_snapshots
    ADD CONSTRAINT agm_yearly_snapshots_shareholder_id_fkey FOREIGN KEY (shareholder_id) REFERENCES public.agm_historical_shareholders(id) ON DELETE CASCADE;


--

-- Name: api_logs api_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_logs
    ADD CONSTRAINT api_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: approval_logs approval_logs_approval_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_logs
    ADD CONSTRAINT approval_logs_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES public.pending_approvals(id);


--

-- Name: approval_logs approval_logs_performed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_logs
    ADD CONSTRAINT approval_logs_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: bank_statements bank_statements_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statements
    ADD CONSTRAINT bank_statements_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: bank_transactions bank_transactions_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: clients clients_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--

-- Name: clients clients_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: companies companies_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: dividend_payables dividend_payables_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dividend_payables
    ADD CONSTRAINT dividend_payables_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--

-- Name: dividend_payables dividend_payables_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dividend_payables
    ADD CONSTRAINT dividend_payables_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--

-- Name: dividend_payables dividend_payables_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dividend_payables
    ADD CONSTRAINT dividend_payables_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: dividend_payables dividend_payables_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dividend_payables
    ADD CONSTRAINT dividend_payables_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.upload_history(id);


--

-- Name: error_logs error_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_logs
    ADD CONSTRAINT error_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: iaf_allocations iaf_allocations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iaf_allocations
    ADD CONSTRAINT iaf_allocations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--

-- Name: iaf_allocations iaf_allocations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iaf_allocations
    ADD CONSTRAINT iaf_allocations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: interest_payables interest_payables_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interest_payables
    ADD CONSTRAINT interest_payables_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--

-- Name: interest_payables interest_payables_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interest_payables
    ADD CONSTRAINT interest_payables_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--

-- Name: interest_payables interest_payables_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interest_payables
    ADD CONSTRAINT interest_payables_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: interest_payables interest_payables_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interest_payables
    ADD CONSTRAINT interest_payables_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.upload_history(id);


--

-- Name: login_logs login_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_logs
    ADD CONSTRAINT login_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: mutual_fund_payables mutual_fund_payables_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mutual_fund_payables
    ADD CONSTRAINT mutual_fund_payables_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--

-- Name: mutual_fund_payables mutual_fund_payables_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mutual_fund_payables
    ADD CONSTRAINT mutual_fund_payables_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--

-- Name: mutual_fund_payables mutual_fund_payables_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mutual_fund_payables
    ADD CONSTRAINT mutual_fund_payables_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: mutual_fund_payables mutual_fund_payables_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mutual_fund_payables
    ADD CONSTRAINT mutual_fund_payables_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.upload_history(id) ON DELETE CASCADE;


--

-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: payment_batches payment_batches_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_batches
    ADD CONSTRAINT payment_batches_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: payment_batches payment_batches_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_batches
    ADD CONSTRAINT payment_batches_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--

-- Name: payment_batches payment_batches_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_batches
    ADD CONSTRAINT payment_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: payment_logs payment_logs_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_logs
    ADD CONSTRAINT payment_logs_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);


--

-- Name: payment_logs payment_logs_performed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_logs
    ADD CONSTRAINT payment_logs_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: payments payments_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: payments payments_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.payment_batches(id) ON DELETE CASCADE;


--

-- Name: payments payments_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--

-- Name: payments payments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--

-- Name: payments payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: payments payments_processed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: payments payments_reversed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: pending_approvals pending_approvals_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_approvals
    ADD CONSTRAINT pending_approvals_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: pending_approvals pending_approvals_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_approvals
    ADD CONSTRAINT pending_approvals_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--

-- Name: reconciliation_results reconciliation_results_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_results
    ADD CONSTRAINT reconciliation_results_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.payment_batches(id) ON DELETE SET NULL;


--

-- Name: reconciliation_results reconciliation_results_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_results
    ADD CONSTRAINT reconciliation_results_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--

-- Name: reconciliation_results reconciliation_results_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_results
    ADD CONSTRAINT reconciliation_results_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--

-- Name: reconciliation_results reconciliation_results_matched_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_results
    ADD CONSTRAINT reconciliation_results_matched_by_fkey FOREIGN KEY (matched_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: reconciliation_results reconciliation_results_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_results
    ADD CONSTRAINT reconciliation_results_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;


--

-- Name: system_settings system_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: upload_errors upload_errors_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_errors
    ADD CONSTRAINT upload_errors_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.upload_history(id) ON DELETE CASCADE;


--

-- Name: upload_history upload_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upload_history
    ADD CONSTRAINT upload_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--

-- Name: user_company_access user_company_access_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_company_access
    ADD CONSTRAINT user_company_access_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--

-- Name: user_company_access user_company_access_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_company_access
    ADD CONSTRAINT user_company_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--

-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
