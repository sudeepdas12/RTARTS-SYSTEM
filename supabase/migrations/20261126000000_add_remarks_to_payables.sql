-- Add remarks column to payables tables for tracking rejection reasons and notes
ALTER TABLE dividend_payables ADD COLUMN IF NOT EXISTS remarks text;
ALTER TABLE interest_payables ADD COLUMN IF NOT EXISTS remarks text;
ALTER TABLE mutual_fund_payables ADD COLUMN IF NOT EXISTS remarks text;
