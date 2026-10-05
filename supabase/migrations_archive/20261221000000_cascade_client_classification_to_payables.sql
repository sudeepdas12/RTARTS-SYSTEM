-- Migration: 20261221000000_cascade_client_classification_to_payables.sql
-- Automatically cascade client payee_classification and holder_type updates
-- to all pending (unpaid) payables in dividend, interest, and mutual fund tables.

CREATE OR REPLACE FUNCTION public.apply_payable_classification_and_tax()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  client_rec record;
  gross numeric := 0;
  payable_kind text := 'DIVIDEND';
  v_holder_type text := NULL;
  v_rule_rate numeric := NULL;
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

  -- 3. Determine gross
  IF TG_TABLE_NAME = 'interest_payables' THEN
    gross := COALESCE(NEW.gross_interest, 0);
  ELSE
    gross := COALESCE(NEW.gross_dividend, 0);
  END IF;

  -- 4. Dynamic lookup from payable_tax_rules first
  IF NEW.payee_classification != 'UNCLASSIFIED' THEN
    SELECT tax_rate INTO v_rule_rate
    FROM public.payable_tax_rules
    WHERE payable_category = payable_kind
      AND payee_classification = NEW.payee_classification
      AND is_active = true
    LIMIT 1;
  END IF;

  IF NEW.tds_rate IS NULL THEN
    IF v_rule_rate IS NOT NULL THEN
      NEW.tds_rate := v_rule_rate;
    ELSIF NEW.payee_classification = 'TAX_EXEMPT' THEN
      NEW.tds_rate := 0.0;
    ELSIF TG_TABLE_NAME = 'interest_payables' THEN
      IF NEW.payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON', 'FOREIGN_INVESTOR')
            OR v_holder_type ILIKE '%Foreign%'
            OR v_holder_type ILIKE '%Institution%'
            OR v_holder_type ILIKE '%Legal Person%' THEN
        NEW.tds_rate := 0.15;
      ELSE
        NEW.tds_rate := 0.06;
      END IF;
    ELSE
      -- Dividend / Mutual Fund default fallback
      IF NEW.payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON', 'FOREIGN_INVESTOR')
            OR v_holder_type ILIKE '%Institution%'
            OR v_holder_type ILIKE '%Legal Person%'
            OR v_holder_type ILIKE '%Foreign%' THEN
        NEW.tds_rate := 0.15;
      ELSE
        NEW.tds_rate := 0.05;
      END IF;
    END IF;
  END IF;

  NEW.tax_amount := round(gross * COALESCE(NEW.tds_rate, 0), 2);
  NEW.net_payable := gross - NEW.tax_amount;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- Trigger function to cascade client classification changes to pending payables
CREATE OR REPLACE FUNCTION public.sync_payables_on_client_classification_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Only cascade if payee_classification or holder_type actually changed
  IF (OLD.payee_classification IS DISTINCT FROM NEW.payee_classification) OR
     (OLD.holder_type IS DISTINCT FROM NEW.holder_type) THEN
    
    -- Reset tds_rate to NULL on pending/unpaid payables so that apply_payable_classification_and_tax
    -- recalculates the tax rate, tax_amount, and net_payable matching the new client classification.
    UPDATE public.dividend_payables
    SET tds_rate = NULL, payee_classification = NEW.payee_classification
    WHERE client_id = NEW.id AND (payment_status IS NULL OR payment_status = 'Pending');

    UPDATE public.interest_payables
    SET tds_rate = NULL, payee_classification = NEW.payee_classification
    WHERE client_id = NEW.id AND (payment_status IS NULL OR payment_status = 'Pending');

    UPDATE public.mutual_fund_payables
    SET tds_rate = NULL, payee_classification = NEW.payee_classification
    WHERE client_id = NEW.id AND (payment_status IS NULL OR payment_status = 'Pending');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_payables_on_client_update ON public.clients;
CREATE TRIGGER trg_sync_payables_on_client_update
AFTER UPDATE OF payee_classification, holder_type ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.sync_payables_on_client_classification_update();
