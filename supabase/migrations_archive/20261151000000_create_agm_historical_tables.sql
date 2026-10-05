-- Migration: 20261151000000_create_agm_historical_tables.sql
-- Description: Dedicated persistent schema for AGM Historical Studio & Multi-FY Reconciliation Hub

-- 1. Master Historical Shareholder Table
CREATE TABLE IF NOT EXISTS public.agm_historical_shareholders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boid TEXT NOT NULL UNIQUE,
  shareholder_name TEXT NOT NULL,
  father_name TEXT,
  grandfather_name TEXT,
  guardian_name TEXT,
  spouse_name TEXT,
  citizenship_no TEXT,
  pan_no TEXT,
  address TEXT,
  district TEXT,
  contact_no TEXT,
  email TEXT,
  bank_name TEXT,
  bank_account_no TEXT,
  holder_type TEXT NOT NULL CHECK (holder_type IN ('PROMOTER', 'PUBLIC', 'MUTUAL_FUND', 'CLEARING_POOL', 'PHYSICAL')),
  initial_kitta_2075 NUMERIC(15, 4) NOT NULL DEFAULT 0,
  initial_fraction_2075 NUMERIC(15, 4) NOT NULL DEFAULT 0,
  current_kitta_2081 NUMERIC(15, 4) NOT NULL DEFAULT 0,
  current_fraction_2081 NUMERIC(15, 4) NOT NULL DEFAULT 0,
  total_bonus_shares NUMERIC(15, 4) NOT NULL DEFAULT 0,
  total_cash_dividend NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_tax_withheld NUMERIC(15, 2) NOT NULL DEFAULT 0,
  reconciliation_status TEXT NOT NULL DEFAULT 'RECONCILED' CHECK (reconciliation_status IN ('PENDING', 'RECONCILED', 'DISCREPANCY', 'PROMOTED')),
  has_discrepancy BOOLEAN NOT NULL DEFAULT false,
  anomalies TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Yearly Snapshot Table (FY 2072/73 to 2080/81)
CREATE TABLE IF NOT EXISTS public.agm_yearly_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shareholder_id UUID REFERENCES public.agm_historical_shareholders(id) ON DELETE CASCADE,
  boid TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  event_name TEXT NOT NULL,
  base_kitta NUMERIC(15, 4) NOT NULL DEFAULT 0,
  previous_fraction NUMERIC(15, 4) NOT NULL DEFAULT 0,
  gross_bonus_entitlement NUMERIC(15, 4) NOT NULL DEFAULT 0,
  issued_whole_bonus NUMERIC(15, 4) NOT NULL DEFAULT 0,
  carried_new_fraction NUMERIC(15, 4) NOT NULL DEFAULT 0,
  gross_cash_dividend NUMERIC(15, 2) NOT NULL DEFAULT 0,
  bonus_tax_withheld NUMERIC(15, 2) NOT NULL DEFAULT 0,
  cash_tax_withheld NUMERIC(15, 2) NOT NULL DEFAULT 0,
  net_cash_payable NUMERIC(15, 2) NOT NULL DEFAULT 0,
  post_event_kitta NUMERIC(15, 4) NOT NULL DEFAULT 0,
  excel_discrepancy_flag BOOLEAN NOT NULL DEFAULT false,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agm_yearly_snapshots_boid_fy_unique UNIQUE (boid, fiscal_year)
);

-- 3. Fiscal Year Import Batches & Metadata
CREATE TABLE IF NOT EXISTS public.agm_fiscal_year_meta (
  fiscal_year TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  total_shareholders INT NOT NULL DEFAULT 0,
  total_kitta NUMERIC(15, 4) NOT NULL DEFAULT 0,
  total_bonus_kitta NUMERIC(15, 4) NOT NULL DEFAULT 0,
  total_cash_npr NUMERIC(15, 2) NOT NULL DEFAULT 0,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  import_report JSONB,
  imported_by TEXT DEFAULT 'Operator',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Broker Clearing Pool Accounts Table
CREATE TABLE IF NOT EXISTS public.agm_broker_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_code TEXT NOT NULL,
  broker_name TEXT NOT NULL,
  pool_boid TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  unclaimed_kitta NUMERIC(15, 4) NOT NULL DEFAULT 0,
  unclaimed_cash NUMERIC(15, 2) NOT NULL DEFAULT 0,
  claimed_kitta NUMERIC(15, 4) NOT NULL DEFAULT 0,
  claimed_cash NUMERIC(15, 2) NOT NULL DEFAULT 0,
  active_balance_kitta NUMERIC(15, 4) NOT NULL DEFAULT 0,
  active_balance_cash NUMERIC(15, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agm_broker_pools_boid_fy_unique UNIQUE (pool_boid, fiscal_year)
);

-- 5. Broker Pool Claims Table
CREATE TABLE IF NOT EXISTS public.agm_broker_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq_no BIGINT NOT NULL UNIQUE,
  broker_code TEXT NOT NULL,
  broker_name TEXT NOT NULL,
  pool_boid TEXT NOT NULL,
  claimant_boid TEXT NOT NULL,
  claimant_name TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  claimed_kitta NUMERIC(15, 4) NOT NULL,
  claimed_cash NUMERIC(15, 2) NOT NULL,
  contract_note_no TEXT NOT NULL,
  trade_date_bs TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  approve_date TIMESTAMPTZ DEFAULT now(),
  approved_by TEXT DEFAULT 'Operator',
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Physical DRN Dematerialization Logs Table
CREATE TABLE IF NOT EXISTS public.agm_drn_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folio_no TEXT NOT NULL,
  holder_name TEXT NOT NULL,
  certificate_no_start BIGINT,
  certificate_no_end BIGINT,
  distinctive_no_start BIGINT,
  distinctive_no_end BIGINT,
  total_kitta NUMERIC(15, 4) NOT NULL,
  drn_no TEXT,
  drn_date TEXT,
  target_boid TEXT,
  status TEXT NOT NULL DEFAULT 'PHYSICAL' CHECK (status IN ('PHYSICAL', 'POSTED', 'ACCEPTED', 'REJECTED')),
  reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for lightning fast multi-year joins
CREATE INDEX IF NOT EXISTS idx_agm_shareholders_boid ON public.agm_historical_shareholders(boid);
CREATE INDEX IF NOT EXISTS idx_agm_snapshots_boid ON public.agm_yearly_snapshots(boid);
CREATE INDEX IF NOT EXISTS idx_agm_snapshots_fy ON public.agm_yearly_snapshots(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_agm_broker_claims_boid ON public.agm_broker_claims(claimant_boid);
CREATE INDEX IF NOT EXISTS idx_agm_drn_folio ON public.agm_drn_records(folio_no);

-- RLS Policies
ALTER TABLE public.agm_historical_shareholders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agm_yearly_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agm_fiscal_year_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agm_broker_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agm_broker_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agm_drn_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read agm_historical_shareholders"
  ON public.agm_historical_shareholders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert agm_historical_shareholders"
  ON public.agm_historical_shareholders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update agm_historical_shareholders"
  ON public.agm_historical_shareholders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated read agm_yearly_snapshots"
  ON public.agm_yearly_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert agm_yearly_snapshots"
  ON public.agm_yearly_snapshots FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update agm_yearly_snapshots"
  ON public.agm_yearly_snapshots FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated read agm_fiscal_year_meta"
  ON public.agm_fiscal_year_meta FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert agm_fiscal_year_meta"
  ON public.agm_fiscal_year_meta FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update agm_fiscal_year_meta"
  ON public.agm_fiscal_year_meta FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated read agm_broker_pools"
  ON public.agm_broker_pools FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert agm_broker_pools"
  ON public.agm_broker_pools FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update agm_broker_pools"
  ON public.agm_broker_pools FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated read agm_broker_claims"
  ON public.agm_broker_claims FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert agm_broker_claims"
  ON public.agm_broker_claims FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated read agm_drn_records"
  ON public.agm_drn_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert agm_drn_records"
  ON public.agm_drn_records FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update agm_drn_records"
  ON public.agm_drn_records FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Anonymous / Service role grants for local REST operations
GRANT ALL ON public.agm_historical_shareholders TO anon, authenticated, service_role;
GRANT ALL ON public.agm_yearly_snapshots TO anon, authenticated, service_role;
GRANT ALL ON public.agm_fiscal_year_meta TO anon, authenticated, service_role;
GRANT ALL ON public.agm_broker_pools TO anon, authenticated, service_role;
GRANT ALL ON public.agm_broker_claims TO anon, authenticated, service_role;
GRANT ALL ON public.agm_drn_records TO anon, authenticated, service_role;
