-- Update check constraint on payable_tax_rules to allow FOREIGN_INVESTOR
ALTER TABLE public.payable_tax_rules
  DROP CONSTRAINT IF EXISTS payable_tax_rules_payee_classification_check;

ALTER TABLE public.payable_tax_rules
  ADD CONSTRAINT payable_tax_rules_payee_classification_check
  CHECK (payee_classification IN ('NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON', 'COMPANY_INSTITUTION', 'TAX_EXEMPT', 'FOREIGN_INVESTOR'));

-- Add FOREIGN_INVESTOR rules to payable_tax_rules table
INSERT INTO public.payable_tax_rules (payable_category, payee_classification, tax_rate, is_active)
VALUES
  ('DIVIDEND',     'FOREIGN_INVESTOR', 0.05, true),
  ('INTEREST',     'FOREIGN_INVESTOR', 0.15, true),
  ('MUTUAL_FUND',  'FOREIGN_INVESTOR', 0.00, true)
ON CONFLICT (payable_category, payee_classification) DO UPDATE
  SET tax_rate = EXCLUDED.tax_rate, is_active = EXCLUDED.is_active;
