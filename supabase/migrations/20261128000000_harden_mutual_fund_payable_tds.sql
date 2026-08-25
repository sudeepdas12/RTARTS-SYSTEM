-- Harden apply_payable_classification_and_tax for Mutual Fund Distributions
-- Under Sec 88 Income Tax Act Nepal:
-- 1. Mutual Fund return to Institution: 15% TDS
-- 2. Mutual Fund return to Natural Person: 5% TDS
-- 3. Mutual Fund return to Tax Exempt Entity: 0% TDS
-- 4. Debenture Interest to Institution: 15% TDS
-- 5. Debenture Interest to Natural Person: 6% TDS
-- 6. Debenture Interest to Tax Exempt: 0% TDS
-- 7. Equity Dividend to Institution: 5% TDS
-- 8. Equity Dividend to Natural Person: 5% TDS
-- 9. Equity Dividend to Tax Exempt: 0% TDS

CREATE OR REPLACE FUNCTION public.apply_payable_classification_and_tax()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  client_rec record;
  gross numeric := 0;
  payable_kind text := 'DIVIDEND';
  new_json jsonb;
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
  END IF;

  -- Fallback if still unclassified
  IF NEW.payee_classification IS NULL OR NEW.payee_classification = 'UNCLASSIFIED' THEN
    NEW.payee_classification := 'NATURAL_PERSON';
  END IF;

  -- Extract gross amount
  new_json := to_jsonb(NEW);
  IF TG_TABLE_NAME = 'interest_payables' THEN
    gross := COALESCE((new_json->>'gross_interest')::numeric, 0);
  ELSE
    gross := COALESCE((new_json->>'gross_dividend')::numeric, 0);
  END IF;

  -- 2. Apply statutory tax rates
  IF NEW.payee_classification = 'TAX_EXEMPT' THEN
    NEW.tds_rate := 0.0;
    NEW.tax_amount := 0.0;
    NEW.net_payable := gross;
    IF TG_TABLE_NAME = 'interest_payables' THEN
      NEW.net_interest := gross;
    END IF;
  ELSIF NEW.payee_classification = 'COMPANY_INSTITUTION' THEN
    IF payable_kind IN ('INTEREST', 'MUTUAL_FUND') THEN
      NEW.tds_rate := 0.15;
      NEW.tax_amount := round(gross * 0.15, 2);
      NEW.net_payable := round(gross - NEW.tax_amount, 2);
      IF TG_TABLE_NAME = 'interest_payables' THEN
        NEW.net_interest := NEW.net_payable;
      END IF;
    ELSE
      -- Standard corporate equity dividend TDS = 5%
      NEW.tds_rate := 0.05;
      NEW.tax_amount := round(gross * 0.05, 2);
      NEW.net_payable := round(gross - NEW.tax_amount, 2);
    END IF;
  ELSIF NEW.payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON') THEN
    IF payable_kind = 'INTEREST' THEN
      NEW.tds_rate := 0.06;
      NEW.tax_amount := round(gross * 0.06, 2);
      NEW.net_payable := round(gross - NEW.tax_amount, 2);
      IF TG_TABLE_NAME = 'interest_payables' THEN
        NEW.net_interest := NEW.net_payable;
      END IF;
    ELSE
      NEW.tds_rate := 0.05;
      NEW.tax_amount := round(gross * 0.05, 2);
      NEW.net_payable := round(gross - NEW.tax_amount, 2);
    END IF;
  ELSE
    IF NEW.tds_rate IS NULL THEN
      NEW.tds_rate := CASE WHEN payable_kind = 'INTEREST' THEN 0.06 WHEN payable_kind = 'MUTUAL_FUND' THEN 0.05 ELSE 0.05 END;
    END IF;
    IF NEW.tax_amount IS NULL THEN
      NEW.tax_amount := round(gross * COALESCE(NEW.tds_rate, 0), 2);
    END IF;
    NEW.net_payable := round(gross - COALESCE(NEW.tax_amount, 0), 2);
    IF TG_TABLE_NAME = 'interest_payables' THEN
      NEW.net_interest := NEW.net_payable;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
