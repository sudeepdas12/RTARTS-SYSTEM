-- Migration: Add paid_amount and remaining_amount to mutual_fund_payables
-- Ensures all 3 payable tables (interest, dividend, mutual_fund) have uniform multi-leg / installment ledger support.

ALTER TABLE public.mutual_fund_payables
  ADD COLUMN IF NOT EXISTS paid_amount numeric(15, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_amount numeric(15, 2);

-- Backfill remaining_amount where null
UPDATE public.mutual_fund_payables
SET
  paid_amount = CASE WHEN payment_status = 'Paid' THEN COALESCE(net_payable, 0) ELSE COALESCE(paid_amount, 0) END,
  remaining_amount = CASE WHEN payment_status = 'Paid' THEN 0 ELSE GREATEST(0, COALESCE(net_payable, 0) - COALESCE(paid_amount, 0)) END
WHERE remaining_amount IS NULL;
