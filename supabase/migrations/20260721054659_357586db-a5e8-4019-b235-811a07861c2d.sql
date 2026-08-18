
-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('admin','finance_operator','reconciliation_officer','auditor','report_viewer');
CREATE TYPE public.payment_status AS ENUM ('Pending','Paid','Partial');
CREATE TYPE public.record_status AS ENUM ('Active','Inactive');
CREATE TYPE public.sector_type AS ENUM ('Public','Private','Institution','Government','Other');
CREATE TYPE public.tax_status AS ENUM ('Taxable','Exempted');
CREATE TYPE public.holder_type AS ENUM ('Public','Promoter','Institution');
CREATE TYPE public.approval_status AS ENUM ('Pending','Approved','Rejected');

-- =========================================================
-- PROFILES
-- =========================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- =========================================================
-- USER ROLES
-- =========================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles_select_own" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID, _roles public.app_role[])
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles));
$$;

CREATE POLICY "roles_admin_all" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- Auto-create profile + first-user-becomes-admin
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  user_count INT;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email);

  SELECT COUNT(*) INTO user_count FROM public.user_roles;
  IF user_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'report_viewer');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- Generic updated_at trigger
-- =========================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- =========================================================
-- COMPANIES
-- =========================================================
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_code TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  sector_type public.sector_type,
  interest_tax_status public.tax_status,
  pan_no TEXT,
  bank_account_no TEXT,
  bank_name TEXT,
  status public.record_status NOT NULL DEFAULT 'Active',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "companies_read" ON public.companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "companies_write" ON public.companies FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_operator']::public.app_role[]));
CREATE POLICY "companies_update" ON public.companies FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_operator']::public.app_role[]));
CREATE POLICY "companies_delete" ON public.companies FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_companies_updated BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- CLIENTS (Shareholders)
-- =========================================================
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  boid TEXT UNIQUE,
  holder_type public.holder_type,
  pan_or_citizenship TEXT,
  bank_account_no TEXT,
  bank_name TEXT,
  status public.record_status NOT NULL DEFAULT 'Active',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clients_boid ON public.clients(boid);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clients_read" ON public.clients FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "clients_write" ON public.clients FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_operator']::public.app_role[]));
CREATE POLICY "clients_update" ON public.clients FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_operator']::public.app_role[]));
CREATE POLICY "clients_delete" ON public.clients FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- FISCAL YEAR SETTINGS
-- =========================================================
CREATE TABLE public.fiscal_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year TEXT NOT NULL UNIQUE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fiscal_years TO authenticated;
GRANT ALL ON public.fiscal_years TO service_role;
ALTER TABLE public.fiscal_years ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fy_read" ON public.fiscal_years FOR SELECT TO authenticated USING (true);
CREATE POLICY "fy_admin" ON public.fiscal_years FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- INTEREST PAYABLES (Debenture)
-- =========================================================
CREATE TABLE public.interest_payables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  instrument_ref TEXT,
  gross_interest NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_payable NUMERIC(15,2) NOT NULL DEFAULT 0,
  due_date DATE NOT NULL,
  payment_status public.payment_status NOT NULL DEFAULT 'Pending',
  payment_date DATE,
  payment_reference TEXT,
  fiscal_year TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_interest_due ON public.interest_payables(due_date);
CREATE INDEX idx_interest_status ON public.interest_payables(payment_status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interest_payables TO authenticated;
GRANT ALL ON public.interest_payables TO service_role;
ALTER TABLE public.interest_payables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ip_read" ON public.interest_payables FOR SELECT TO authenticated USING (true);
CREATE POLICY "ip_write" ON public.interest_payables FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_operator']::public.app_role[]));
CREATE POLICY "ip_update" ON public.interest_payables FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_operator']::public.app_role[]));
CREATE POLICY "ip_delete" ON public.interest_payables FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.calc_net_payable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.net_payable = COALESCE(NEW.gross_interest, 0) - COALESCE(NEW.tax_amount, 0);
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_ip_calc BEFORE INSERT OR UPDATE ON public.interest_payables
  FOR EACH ROW EXECUTE FUNCTION public.calc_net_payable();

-- =========================================================
-- DIVIDEND PAYABLES (Stock)
-- =========================================================
CREATE TABLE public.dividend_payables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  shares_held NUMERIC(15,2) DEFAULT 0,
  dividend_rate NUMERIC(10,4) DEFAULT 0,
  gross_dividend NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_payable NUMERIC(15,2) NOT NULL DEFAULT 0,
  payment_status public.payment_status NOT NULL DEFAULT 'Pending',
  payment_date DATE,
  payment_reference TEXT,
  fiscal_year TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dividend_status ON public.dividend_payables(payment_status);
CREATE INDEX idx_dividend_fy ON public.dividend_payables(fiscal_year);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dividend_payables TO authenticated;
GRANT ALL ON public.dividend_payables TO service_role;
ALTER TABLE public.dividend_payables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dp_read" ON public.dividend_payables FOR SELECT TO authenticated USING (true);
CREATE POLICY "dp_write" ON public.dividend_payables FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_operator']::public.app_role[]));
CREATE POLICY "dp_update" ON public.dividend_payables FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_operator']::public.app_role[]));
CREATE POLICY "dp_delete" ON public.dividend_payables FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.calc_net_dividend()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.gross_dividend IS NULL OR NEW.gross_dividend = 0 THEN
    NEW.gross_dividend = COALESCE(NEW.shares_held,0) * COALESCE(NEW.dividend_rate,0);
  END IF;
  NEW.net_payable = COALESCE(NEW.gross_dividend, 0) - COALESCE(NEW.tax_amount, 0);
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_dp_calc BEFORE INSERT OR UPDATE ON public.dividend_payables
  FOR EACH ROW EXECUTE FUNCTION public.calc_net_dividend();

-- =========================================================
-- BANK RECONCILIATION
-- =========================================================
CREATE TABLE public.bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_date DATE NOT NULL,
  description TEXT,
  reference TEXT,
  amount NUMERIC(15,2) NOT NULL,
  bank_account_no TEXT,
  matched_payable_type TEXT,
  matched_payable_id UUID,
  is_reconciled BOOLEAN NOT NULL DEFAULT false,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_transactions TO authenticated;
GRANT ALL ON public.bank_transactions TO service_role;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bt_read" ON public.bank_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "bt_write" ON public.bank_transactions FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','reconciliation_officer','finance_operator']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','reconciliation_officer','finance_operator']::public.app_role[]));

-- =========================================================
-- IAF ALLOCATIONS
-- =========================================================
CREATE TABLE public.iaf_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  fiscal_year TEXT NOT NULL,
  allocated_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  utilized_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.iaf_allocations TO authenticated;
GRANT ALL ON public.iaf_allocations TO service_role;
ALTER TABLE public.iaf_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "iaf_read" ON public.iaf_allocations FOR SELECT TO authenticated USING (true);
CREATE POLICY "iaf_write" ON public.iaf_allocations FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_operator']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_operator']::public.app_role[]));

-- =========================================================
-- PENDING APPROVALS (maker/checker)
-- =========================================================
CREATE TABLE public.pending_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  payload JSONB NOT NULL,
  status public.approval_status NOT NULL DEFAULT 'Pending',
  requested_by UUID REFERENCES auth.users(id),
  reviewed_by UUID REFERENCES auth.users(id),
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_approvals TO authenticated;
GRANT ALL ON public.pending_approvals TO service_role;
ALTER TABLE public.pending_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa_read" ON public.pending_approvals FOR SELECT TO authenticated USING (true);
CREATE POLICY "pa_insert" ON public.pending_approvals FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid());
CREATE POLICY "pa_review" ON public.pending_approvals FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- AUDIT LOG (auto-recorded via trigger)
-- =========================================================
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT,
  old_value JSONB,
  new_value JSONB,
  action_time TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_time ON public.audit_logs(action_time DESC);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_read" ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','auditor']::public.app_role[]));
CREATE POLICY "audit_insert" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_logs(user_id, action, table_name, record_id, old_value, new_value)
  VALUES (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id::text, OLD.id::text),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_companies AFTER INSERT OR UPDATE OR DELETE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER trg_audit_clients AFTER INSERT OR UPDATE OR DELETE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER trg_audit_ip AFTER INSERT OR UPDATE OR DELETE ON public.interest_payables FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER trg_audit_dp AFTER INSERT OR UPDATE OR DELETE ON public.dividend_payables FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER trg_audit_bt AFTER INSERT OR UPDATE OR DELETE ON public.bank_transactions FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER trg_audit_iaf AFTER INSERT OR UPDATE OR DELETE ON public.iaf_allocations FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
