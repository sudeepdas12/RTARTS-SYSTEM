-- Fix apply_payable_classification_and_tax trigger to use to_jsonb(NEW)
-- instead of direct field references that fail across different payable tables.

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

  IF NEW.payee_classification = 'UNCLASSIFIED' THEN
    IF NEW.tds_rate IS NULL THEN
      NEW.tax_amount := 0;
    END IF;
  ELSE
    SELECT tax_rate INTO NEW.tds_rate FROM public.payable_tax_rules
      WHERE payable_category = payable_kind AND payee_classification = NEW.payee_classification AND is_active;
    IF NOT FOUND THEN
      NEW.tds_rate := CASE WHEN payable_kind = 'INTEREST' THEN 0.06 WHEN payable_kind = 'MUTUAL_FUND' THEN 0.0 ELSE 0.05 END;
    END IF;
    IF NEW.tax_amount IS NULL OR NEW.tax_amount = 0 THEN
      NEW.tax_amount := round(gross * COALESCE(NEW.tds_rate, 0), 2);
    END IF;
  END IF;

  IF NEW.net_payable IS NULL OR NEW.net_payable = 0 THEN
    NEW.net_payable := round(gross - COALESCE(NEW.tax_amount, 0), 2);
  END IF;
  RETURN NEW;
END;
$$;