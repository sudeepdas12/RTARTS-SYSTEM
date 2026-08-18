-- =========================================================
-- Add dedicated mutual_fund_payables table
-- =========================================================

CREATE TABLE IF NOT EXISTS public.mutual_fund_payables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES public.upload_history(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  shares_held NUMERIC(15,2) DEFAULT 0,
  dividend_rate NUMERIC(10,4) DEFAULT 0,
  dividend_type public.dividend_type NOT NULL DEFAULT 'Cash',
  gross_dividend NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_payable NUMERIC(15,2) NOT NULL DEFAULT 0,
  payment_status public.payment_status NOT NULL DEFAULT 'Pending',
  payment_date DATE,
  payment_reference TEXT,
  bonus_actual NUMERIC(15,2),
  bonus_issued NUMERIC(15,2),
  bonus_fraction NUMERIC(15,2),
  after_bonus_kitta NUMERIC(15,2),
  bonus_tax NUMERIC(15,2),
  bank_name TEXT,
  bank_account_no TEXT,
  lot_name TEXT,
  fiscal_year TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mutual_fund_status ON public.mutual_fund_payables(payment_status);
CREATE INDEX IF NOT EXISTS idx_mutual_fund_fy ON public.mutual_fund_payables(fiscal_year);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mutual_fund_payables TO authenticated;
GRANT ALL ON public.mutual_fund_payables TO service_role;
ALTER TABLE public.mutual_fund_payables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfp_read" ON public.mutual_fund_payables FOR SELECT TO authenticated USING (true);
CREATE POLICY "mfp_write" ON public.mutual_fund_payables FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_operator']::public.app_role[]));
CREATE POLICY "mfp_update" ON public.mutual_fund_payables FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_operator']::public.app_role[]));
CREATE POLICY "mfp_delete" ON public.mutual_fund_payables FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_mfp_calc BEFORE INSERT OR UPDATE ON public.mutual_fund_payables
  FOR EACH ROW EXECUTE FUNCTION public.calc_net_dividend();
