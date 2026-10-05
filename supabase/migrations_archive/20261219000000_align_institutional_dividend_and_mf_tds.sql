-- Migration: 20261219000000_align_institutional_dividend_and_mf_tds.sql
-- Description: Standardize statutory TDS rates across database rules and trigger:
-- Institutional & Corporate Dividend TDS aligned to 15% (matching frontend calculators and e2e tests),
-- Mutual Fund Institutional TDS confirmed at 15%.

-- 1. Ensure payable_tax_rules contains authoritative statutory 15% rate for Institutional Dividends & Mutual Funds
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payable_tax_rules') THEN
    INSERT INTO public.payable_tax_rules (payable_category, payee_classification, tax_rate, is_active)
    VALUES
      ('DIVIDEND', 'COMPANY_INSTITUTION', 0.15, true),
      ('DIVIDEND', 'FOREIGN_INVESTOR', 0.15, true),
      ('MUTUAL_FUND', 'COMPANY_INSTITUTION', 0.15, true),
      ('MUTUAL_FUND', 'FOREIGN_INVESTOR', 0.15, true)
    ON CONFLICT (payable_category, payee_classification)
    DO UPDATE SET tax_rate = EXCLUDED.tax_rate, updated_at = now();
  END IF;
END $$;

-- 2. Update apply_payable_classification_and_tax trigger to assign 15% TDS to institutional dividends
CREATE OR REPLACE FUNCTION public.apply_payable_classification_and_tax()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  client_rec record;
  gross numeric := 0;
  payable_kind text := 'DIVIDEND';
  v_holder_type text := NULL;
BEGIN
  IF TG_TABLE_NAME = 'interest_payables' THEN
    payable_kind := 'INTEREST';
  ELSIF TG_TABLE_NAME = 'mutual_fund_payables' THEN
    payable_kind := 'MUTUAL_FUND';
  ELSE
    payable_kind := 'DIVIDEND';
  END IF;

  -- 1. Inherit verified classification from client if available
  IF NEW.client_id IS NOT NULL THEN
    SELECT payee_classification, payee_segment, holder_type
    INTO client_rec
    FROM public.clients
    WHERE id = NEW.client_id;

    IF client_rec.payee_classification IS NOT NULL AND client_rec.payee_classification != 'UNCLASSIFIED' THEN
      NEW.payee_classification := client_rec.payee_classification;
    END IF;

    IF NEW.payee_segment IS NULL AND client_rec.payee_segment IS NOT NULL THEN
      NEW.payee_segment := client_rec.payee_segment;
    END IF;

    v_holder_type := client_rec.holder_type::text;
  END IF;

  -- 2. Fallback classification logic using client holder_type
  IF NEW.payee_classification IS NULL OR NEW.payee_classification = 'UNCLASSIFIED' THEN
    IF v_holder_type ILIKE '%Mutual Fund%' OR v_holder_type ILIKE '%Tax Exempt%' THEN
      NEW.payee_classification := 'TAX_EXEMPT';
    ELSIF v_holder_type ILIKE '%Institution%' OR v_holder_type ILIKE '%Legal Person%' THEN
      NEW.payee_classification := 'COMPANY_INSTITUTION';
    ELSIF v_holder_type IS NOT NULL THEN
      NEW.payee_classification := 'NATURAL_PERSON';
    ELSE
      NEW.payee_classification := 'UNCLASSIFIED';
    END IF;
  END IF;

  -- 3. Calculate statutory TDS
  IF TG_TABLE_NAME = 'interest_payables' THEN
    gross := COALESCE(NEW.gross_interest, 0);
    IF NEW.tds_rate IS NULL THEN
      IF NEW.payee_classification = 'TAX_EXEMPT' THEN
        NEW.tds_rate := 0.0;
      ELSIF NEW.payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON', 'FOREIGN_INVESTOR')
            OR v_holder_type ILIKE '%Foreign%'
            OR v_holder_type ILIKE '%Institution%'
            OR v_holder_type ILIKE '%Legal Person%' THEN
        NEW.tds_rate := 0.15;
      ELSE
        NEW.tds_rate := 0.06;
      END IF;
    END IF;
    NEW.tax_amount := round(gross * NEW.tds_rate, 2);
    NEW.net_payable := gross - NEW.tax_amount;
  ELSE
    gross := COALESCE(NEW.gross_dividend, 0);
    IF NEW.tds_rate IS NULL THEN
      IF NEW.payee_classification = 'TAX_EXEMPT' THEN
        NEW.tds_rate := 0.0;
      ELSIF TG_TABLE_NAME = 'mutual_fund_payables' AND NEW.payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON', 'FOREIGN_INVESTOR') THEN
        NEW.tds_rate := 0.15;
      ELSIF NEW.payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON', 'FOREIGN_INVESTOR')
            OR v_holder_type ILIKE '%Institution%'
            OR v_holder_type ILIKE '%Legal Person%'
            OR v_holder_type ILIKE '%Foreign%' THEN
        NEW.tds_rate := 0.15;
      ELSE
        NEW.tds_rate := 0.05;
      END IF;
    END IF;
    NEW.tax_amount := round(gross * NEW.tds_rate, 2);
    NEW.net_payable := gross - NEW.tax_amount;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
