-- Migration: 20261195000000_add_bonus_rate_to_dividend_payables.sql
-- Add bonus_rate column to dividend_payables to support both cash and bonus dividend rates
-- and prevent bulk_insert_dividend_payables RPC failure.

ALTER TABLE public.dividend_payables 
ADD COLUMN IF NOT EXISTS bonus_rate numeric;

COMMENT ON COLUMN public.dividend_payables.bonus_rate IS 'Bonus share declaration percentage (e.g. 10.0 for 10% bonus shares)';
