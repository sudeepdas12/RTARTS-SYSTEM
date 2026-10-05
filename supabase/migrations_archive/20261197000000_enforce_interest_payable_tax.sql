-- ============================================================
-- Migration: Enforce correct statutory TDS rates on interest_payables
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_interest_payable_tax_rates()
RETURNS TRIGGER AS $$
BEGIN
  -- TAX_EXEMPT: always 0% (Mutual Funds, Social Security Fund, CIT, etc.)
  IF NEW.payee_classification = 'TAX_EXEMPT' THEN
    NEW.tds_rate    := 0.00;
    NEW.tax_amount  := 0.00;
    NEW.net_payable := NEW.gross_interest;

  -- COMPANY_INSTITUTION: always 15% for debenture/interest
  ELSIF NEW.payee_classification = 'COMPANY_INSTITUTION' THEN
    NEW.tds_rate    := 0.15;
    NEW.tax_amount  := ROUND((NEW.gross_interest * 0.15)::numeric, 2);
    NEW.net_payable := ROUND((NEW.gross_interest * 0.85)::numeric, 2);

  -- NATURAL_PERSON / others: 6% for debenture
  ELSIF NEW.payee_classification IN ('NATURAL_PERSON', 'UNCLASSIFIED') 
        AND (NEW.tds_rate IS NULL OR NEW.tds_rate = 0) THEN
    NEW.tds_rate    := 0.06;
    NEW.tax_amount  := ROUND((NEW.gross_interest * 0.06)::numeric, 2);
    NEW.net_payable := ROUND((NEW.gross_interest * 0.94)::numeric, 2);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_interest_payable_tax ON interest_payables;

CREATE TRIGGER trg_enforce_interest_payable_tax
  BEFORE INSERT OR UPDATE ON interest_payables
  FOR EACH ROW
  EXECUTE FUNCTION enforce_interest_payable_tax_rates();

COMMENT ON TRIGGER trg_enforce_interest_payable_tax ON interest_payables IS
  'Enforces statutory Nepal TDS rates: 0% for Tax Exempt, 15% for Institutions, 6% for Natural Persons on debenture interest.';
