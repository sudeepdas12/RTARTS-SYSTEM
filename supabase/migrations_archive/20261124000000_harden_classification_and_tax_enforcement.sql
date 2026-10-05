-- Harden apply_payable_classification_and_tax to strictly enforce TDS rates:
-- Tax Exempt: 0% tax (always NPR 0.00, net = gross)
-- Debenture / Interest for Institution: 15% TDS
-- Debenture / Interest for Natural Person: 6% TDS
-- Dividend for Natural Person / Institution: 5% TDS

CREATE OR REPLACE FUNCTION public.apply_payable_classification_and_tax()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  client_classification text;
  client_segment text;
  client_status text;
  payable_kind text := CASE TG_TABLE_NAME WHEN 'interest_payables' THEN 'INTEREST' WHEN 'mutual_fund_payables' THEN 'MUTUAL_FUND' ELSE 'DIVIDEND' END;
  gross numeric;
  new_json jsonb;
BEGIN
  SELECT payee_classification, payee_segment, classification_status
    INTO client_classification, client_segment, client_status FROM public.clients WHERE id = NEW.client_id;
  NEW.payee_classification := COALESCE(client_classification, 'UNCLASSIFIED');
  NEW.payee_segment := client_segment;
  NEW.classification_status := COALESCE(client_status, 'REVIEW_REQUIRED');
  
  new_json := to_jsonb(NEW);
  IF TG_TABLE_NAME = 'interest_payables' THEN
    gross := COALESCE((new_json->>'gross_interest')::numeric, 0);
  ELSE
    gross := COALESCE((new_json->>'gross_dividend')::numeric, 0);
  END IF;

  IF NEW.payee_classification = 'TAX_EXEMPT' THEN
    NEW.tds_rate := 0.0;
    NEW.tax_amount := 0.0;
    NEW.net_payable := gross;
    IF TG_TABLE_NAME = 'interest_payables' THEN
      NEW.net_interest := gross;
    END IF;
  ELSIF NEW.payee_classification = 'COMPANY_INSTITUTION' THEN
    IF payable_kind = 'INTEREST' THEN
      NEW.tds_rate := 0.15;
      NEW.tax_amount := round(gross * 0.15, 2);
      NEW.net_payable := round(gross - NEW.tax_amount, 2);
      NEW.net_interest := NEW.net_payable;
    ELSE
      NEW.tds_rate := 0.05;
      NEW.tax_amount := round(gross * 0.05, 2);
      NEW.net_payable := round(gross - NEW.tax_amount, 2);
    END IF;
  ELSIF NEW.payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON') THEN
    IF payable_kind = 'INTEREST' THEN
      NEW.tds_rate := 0.06;
      NEW.tax_amount := round(gross * 0.06, 2);
      NEW.net_payable := round(gross - NEW.tax_amount, 2);
      NEW.net_interest := NEW.net_payable;
    ELSE
      NEW.tds_rate := 0.05;
      NEW.tax_amount := round(gross * 0.05, 2);
      NEW.net_payable := round(gross - NEW.tax_amount, 2);
    END IF;
  ELSE
    -- UNCLASSIFIED or custom
    IF NEW.tds_rate IS NULL THEN
      NEW.tds_rate := CASE WHEN payable_kind = 'INTEREST' THEN 0.06 WHEN payable_kind = 'MUTUAL_FUND' THEN 0.0 ELSE 0.05 END;
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
