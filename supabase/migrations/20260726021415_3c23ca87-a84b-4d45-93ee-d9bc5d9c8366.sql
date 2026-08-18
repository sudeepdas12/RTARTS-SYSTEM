
-- Companies expansion
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS company_type text,
  ADD COLUMN IF NOT EXISTS isin text,
  ADD COLUMN IF NOT EXISTS listed_date date,
  ADD COLUMN IF NOT EXISTS registrar text,
  ADD COLUMN IF NOT EXISTS fiscal_year text,
  ADD COLUMN IF NOT EXISTS dividend_rate numeric,
  ADD COLUMN IF NOT EXISTS debenture_rate numeric,
  ADD COLUMN IF NOT EXISTS coupon_rate numeric,
  ADD COLUMN IF NOT EXISTS maturity_date date,
  ADD COLUMN IF NOT EXISTS face_value numeric,
  ADD COLUMN IF NOT EXISTS issue_size numeric;

-- Verification enum
DO $$ BEGIN
  CREATE TYPE verification_status AS ENUM ('Pending','Verified','Rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE residency_type AS ENUM ('Resident','Non-Resident');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Clients expansion
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS client_id text,
  ADD COLUMN IF NOT EXISTS father_name text,
  ADD COLUMN IF NOT EXISTS grandfather_name text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS province text,
  ADD COLUMN IF NOT EXISTS district text,
  ADD COLUMN IF NOT EXISTS municipality text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS bank_branch text,
  ADD COLUMN IF NOT EXISTS account_type text,
  ADD COLUMN IF NOT EXISTS residency residency_type,
  ADD COLUMN IF NOT EXISTS verification_status verification_status NOT NULL DEFAULT 'Pending';

CREATE INDEX IF NOT EXISTS idx_clients_boid ON public.clients(boid);
CREATE INDEX IF NOT EXISTS idx_clients_pan ON public.clients(pan_or_citizenship);
CREATE INDEX IF NOT EXISTS idx_companies_isin ON public.companies(isin);
