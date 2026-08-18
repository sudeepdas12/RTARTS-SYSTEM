-- One authoritative classification and tax-calculation path for every payable.
-- Classifications are copied onto the payable as an immutable reporting snapshot.

CREATE TABLE IF NOT EXISTS public.payable_tax_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payable_category text NOT NULL CHECK (payable_category IN ('DIVIDEND', 'INTEREST', 'MUTUAL_FUND')),
  payee_classification text NOT NULL CHECK (payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON', 'COMPANY_INSTITUTION', 'TAX_EXEMPT')),
  tax_rate numeric(7,6) NOT NULL CHECK (tax_rate >= 0 AND tax_rate <= 1),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payable_category, payee_classification)
);

INSERT INTO public.payable_tax_rules (payable_category, payee_classification, tax_rate) VALUES
  ('DIVIDEND', 'NATURAL_PERSON', 0.05),
  ('DIVIDEND', 'PUBLIC_LEGAL_PERSON', 0.05),
  ('DIVIDEND', 'COMPANY_INSTITUTION', 0.05),
  ('DIVIDEND', 'TAX_EXEMPT', 0),
  ('INTEREST', 'NATURAL_PERSON', 0.06),
  ('INTEREST', 'PUBLIC_LEGAL_PERSON', 0.06),
  ('INTEREST', 'COMPANY_INSTITUTION', 0.15),
  ('INTEREST', 'TAX_EXEMPT', 0),
  ('MUTUAL_FUND', 'NATURAL_PERSON', 0.05),
  ('MUTUAL_FUND', 'PUBLIC_LEGAL_PERSON', 0.05),
  ('MUTUAL_FUND', 'COMPANY_INSTITUTION', 0.05),
  ('MUTUAL_FUND', 'TAX_EXEMPT', 0)
ON CONFLICT (payable_category, payee_classification) DO NOTHING;

GRANT SELECT ON public.payable_tax_rules TO authenticated;
GRANT ALL ON public.payable_tax_rules TO service_role;
ALTER TABLE public.payable_tax_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payable tax rules are readable" ON public.payable_tax_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage payable tax rules" ON public.payable_tax_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS payee_classification text NOT NULL DEFAULT 'UNCLASSIFIED'
    CHECK (payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON', 'COMPANY_INSTITUTION', 'TAX_EXEMPT', 'UNCLASSIFIED')),
  ADD COLUMN IF NOT EXISTS payee_segment text
    CHECK (payee_segment IS NULL OR payee_segment IN ('PROMOTER', 'LOCAL', 'PUBLIC')),
  ADD COLUMN IF NOT EXISTS classification_status text NOT NULL DEFAULT 'REVIEW_REQUIRED'
    CHECK (classification_status IN ('AUTO_CLASSIFIED', 'CONFIRMED', 'REVIEW_REQUIRED')),
  ADD COLUMN IF NOT EXISTS classification_source text;

ALTER TABLE public.dividend_payables
  ADD COLUMN IF NOT EXISTS payee_classification text NOT NULL DEFAULT 'UNCLASSIFIED'
    CHECK (payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON', 'COMPANY_INSTITUTION', 'TAX_EXEMPT', 'UNCLASSIFIED')),
  ADD COLUMN IF NOT EXISTS payee_segment text CHECK (payee_segment IS NULL OR payee_segment IN ('PROMOTER', 'LOCAL', 'PUBLIC')),
  ADD COLUMN IF NOT EXISTS classification_status text NOT NULL DEFAULT 'REVIEW_REQUIRED'
    CHECK (classification_status IN ('AUTO_CLASSIFIED', 'CONFIRMED', 'REVIEW_REQUIRED'));
ALTER TABLE public.interest_payables
  ADD COLUMN IF NOT EXISTS payee_classification text NOT NULL DEFAULT 'UNCLASSIFIED'
    CHECK (payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON', 'COMPANY_INSTITUTION', 'TAX_EXEMPT', 'UNCLASSIFIED')),
  ADD COLUMN IF NOT EXISTS payee_segment text CHECK (payee_segment IS NULL OR payee_segment IN ('PROMOTER', 'LOCAL', 'PUBLIC')),
  ADD COLUMN IF NOT EXISTS classification_status text NOT NULL DEFAULT 'REVIEW_REQUIRED'
    CHECK (classification_status IN ('AUTO_CLASSIFIED', 'CONFIRMED', 'REVIEW_REQUIRED'));
ALTER TABLE public.mutual_fund_payables
  ADD COLUMN IF NOT EXISTS payee_classification text NOT NULL DEFAULT 'UNCLASSIFIED'
    CHECK (payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON', 'COMPANY_INSTITUTION', 'TAX_EXEMPT', 'UNCLASSIFIED')),
  ADD COLUMN IF NOT EXISTS payee_segment text CHECK (payee_segment IS NULL OR payee_segment IN ('PROMOTER', 'LOCAL', 'PUBLIC')),
  ADD COLUMN IF NOT EXISTS classification_status text NOT NULL DEFAULT 'REVIEW_REQUIRED'
    CHECK (classification_status IN ('AUTO_CLASSIFIED', 'CONFIRMED', 'REVIEW_REQUIRED'));

CREATE INDEX IF NOT EXISTS idx_clients_payee_classification ON public.clients(payee_classification);
CREATE INDEX IF NOT EXISTS idx_dividend_payables_classification ON public.dividend_payables(company_id, payee_classification);
CREATE INDEX IF NOT EXISTS idx_interest_payables_classification ON public.interest_payables(company_id, payee_classification);
CREATE INDEX IF NOT EXISTS idx_mf_payables_classification ON public.mutual_fund_payables(company_id, payee_classification);

CREATE OR REPLACE FUNCTION public.sync_client_payee_classification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A reviewed/confirmed master record is never overwritten by a later upload.
  IF NEW.classification_status = 'CONFIRMED' THEN RETURN NEW; END IF;
  IF NEW.payee_classification <> 'UNCLASSIFIED' THEN
    NEW.classification_status = COALESCE(NULLIF(NEW.classification_status, 'REVIEW_REQUIRED'), 'AUTO_CLASSIFIED');
    RETURN NEW;
  END IF;
  CASE NEW.holder_type::text
    WHEN 'Natural Person - Promoter', 'Promoter' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'PROMOTER';
    WHEN 'Natural Person - Public' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'PUBLIC';
    WHEN 'Public' THEN NEW.payee_classification := 'PUBLIC_LEGAL_PERSON'; NEW.payee_segment := 'PUBLIC';
    WHEN 'Legal Person', 'Institution', 'Foreign' THEN NEW.payee_classification := 'COMPANY_INSTITUTION';
    WHEN 'Mutual Fund', 'Tax Exempt' THEN NEW.payee_classification := 'TAX_EXEMPT';
    ELSE RETURN NEW;
  END CASE;
  NEW.classification_status := 'AUTO_CLASSIFIED';
  NEW.classification_source := COALESCE(NEW.classification_source, 'holder_type');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_clients_payee_classification ON public.clients;
CREATE TRIGGER trg_clients_payee_classification BEFORE INSERT OR UPDATE OF holder_type, payee_classification, classification_status ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.sync_client_payee_classification();

CREATE OR REPLACE FUNCTION public.apply_payable_classification_and_tax()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  client_classification text;
  client_segment text;
  client_status text;
  payable_kind text := CASE TG_TABLE_NAME WHEN 'interest_payables' THEN 'INTEREST' WHEN 'mutual_fund_payables' THEN 'MUTUAL_FUND' ELSE 'DIVIDEND' END;
  gross numeric;
BEGIN
  SELECT payee_classification, payee_segment, classification_status
    INTO client_classification, client_segment, client_status FROM public.clients WHERE id = NEW.client_id;
  NEW.payee_classification := COALESCE(client_classification, 'UNCLASSIFIED');
  NEW.payee_segment := client_segment;
  NEW.classification_status := COALESCE(client_status, 'REVIEW_REQUIRED');
  gross := CASE WHEN TG_TABLE_NAME = 'interest_payables' THEN COALESCE(NEW.gross_interest, 0) ELSE COALESCE(NEW.gross_dividend, 0) END;
  IF NEW.payee_classification = 'UNCLASSIFIED' THEN
    NEW.tds_rate := NULL;
    NEW.tax_amount := 0;
  ELSE
    SELECT tax_rate INTO NEW.tds_rate FROM public.payable_tax_rules
      WHERE payable_category = payable_kind AND payee_classification = NEW.payee_classification AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'No active tax rule for % / %', payable_kind, NEW.payee_classification; END IF;
    NEW.tax_amount := round(gross * NEW.tds_rate, 2);
  END IF;
  NEW.net_payable := round(gross - COALESCE(NEW.tax_amount, 0), 2);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_dividend_classification_tax ON public.dividend_payables;
DROP TRIGGER IF EXISTS trg_interest_classification_tax ON public.interest_payables;
DROP TRIGGER IF EXISTS trg_mutual_fund_classification_tax ON public.mutual_fund_payables;
CREATE TRIGGER trg_dividend_classification_tax BEFORE INSERT OR UPDATE OF client_id, gross_dividend, tax_amount, tds_rate ON public.dividend_payables FOR EACH ROW EXECUTE FUNCTION public.apply_payable_classification_and_tax();
CREATE TRIGGER trg_interest_classification_tax BEFORE INSERT OR UPDATE OF client_id, gross_interest, tax_amount, tds_rate ON public.interest_payables FOR EACH ROW EXECUTE FUNCTION public.apply_payable_classification_and_tax();
CREATE TRIGGER trg_mutual_fund_classification_tax BEFORE INSERT OR UPDATE OF client_id, gross_dividend, tax_amount, tds_rate ON public.mutual_fund_payables FOR EACH ROW EXECUTE FUNCTION public.apply_payable_classification_and_tax();

CREATE OR REPLACE VIEW public.payable_classification_summary WITH (security_invoker = true) AS
  SELECT company_id, 'DIVIDEND'::text AS payable_category, payee_classification, payee_segment, classification_status,
    count(*)::bigint AS transaction_count, sum(gross_dividend) AS gross_payable, sum(tax_amount) AS tax, sum(net_payable) AS net_payable
  FROM public.dividend_payables GROUP BY company_id, payee_classification, payee_segment, classification_status
  UNION ALL
  SELECT company_id, 'INTEREST', payee_classification, payee_segment, classification_status,
    count(*)::bigint, sum(gross_interest), sum(tax_amount), sum(net_payable)
  FROM public.interest_payables GROUP BY company_id, payee_classification, payee_segment, classification_status
  UNION ALL
  SELECT company_id, 'MUTUAL_FUND', payee_classification, payee_segment, classification_status,
    count(*)::bigint, sum(gross_dividend), sum(tax_amount), sum(net_payable)
  FROM public.mutual_fund_payables GROUP BY company_id, payee_classification, payee_segment, classification_status;
GRANT SELECT ON public.payable_classification_summary TO authenticated;

-- Preserve confirmed master classifications if a repeated upload hits the same BOID.
CREATE OR REPLACE FUNCTION public.bulk_insert_clients(p_clients jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client jsonb; v_inserted int := 0; v_errors jsonb := '[]'::jsonb;
BEGIN
  FOR v_client IN SELECT * FROM jsonb_array_elements(p_clients) LOOP
    BEGIN
      INSERT INTO public.clients (id, boid, company_id, full_name, client_code, father_name, grandfather_name, pan_or_citizenship, address, district, phone, bank_name, bank_account_no, holder_type, payee_classification, payee_segment, classification_status, classification_source, status, verification_status)
      VALUES ((v_client->>'id')::uuid, v_client->>'boid', (v_client->>'company_id')::uuid, v_client->>'full_name', v_client->>'client_code', v_client->>'father_name', v_client->>'grandfather_name', v_client->>'pan_or_citizenship', v_client->>'address', v_client->>'district', v_client->>'phone', v_client->>'bank_name', v_client->>'bank_account_no', (v_client->>'holder_type')::public.holder_type, COALESCE(v_client->>'payee_classification', 'UNCLASSIFIED'), v_client->>'payee_segment', COALESCE(v_client->>'classification_status', 'REVIEW_REQUIRED'), v_client->>'classification_source', COALESCE((v_client->>'status')::public.record_status, 'Active'), COALESCE((v_client->>'verification_status')::public.verification_status, 'Verified'))
      ON CONFLICT (boid) DO UPDATE SET full_name = EXCLUDED.full_name, company_id = EXCLUDED.company_id, father_name = EXCLUDED.father_name, grandfather_name = EXCLUDED.grandfather_name, pan_or_citizenship = EXCLUDED.pan_or_citizenship, address = EXCLUDED.address, district = EXCLUDED.district, phone = EXCLUDED.phone, bank_name = EXCLUDED.bank_name, bank_account_no = EXCLUDED.bank_account_no,
        holder_type = CASE WHEN clients.classification_status = 'CONFIRMED' THEN clients.holder_type ELSE EXCLUDED.holder_type END,
        payee_classification = CASE WHEN clients.classification_status = 'CONFIRMED' THEN clients.payee_classification ELSE EXCLUDED.payee_classification END,
        payee_segment = CASE WHEN clients.classification_status = 'CONFIRMED' THEN clients.payee_segment ELSE EXCLUDED.payee_segment END,
        classification_status = CASE WHEN clients.classification_status = 'CONFIRMED' THEN clients.classification_status ELSE EXCLUDED.classification_status END,
        classification_source = CASE WHEN clients.classification_status = 'CONFIRMED' THEN clients.classification_source ELSE EXCLUDED.classification_source END;
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN v_errors := v_errors || jsonb_build_object('boid', v_client->>'boid', 'error', SQLERRM); END;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'inserted', v_inserted, 'errors', v_errors);
END; $$;
REVOKE EXECUTE ON FUNCTION public.bulk_insert_clients(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_insert_clients(jsonb) TO authenticated, service_role;
