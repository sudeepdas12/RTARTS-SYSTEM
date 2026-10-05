-- =========================================================
-- Add shares_held and kitta to interest_payables table
-- =========================================================

ALTER TABLE public.interest_payables 
  ADD COLUMN IF NOT EXISTS shares_held numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kitta numeric DEFAULT 0;

-- Backfill from clients.kitta or gross_interest
UPDATE public.interest_payables ip
SET 
  shares_held = COALESCE(NULLIF(c.kitta, 0), ROUND(ip.gross_interest / (1000 * 0.085 * (183.0 / 365.0)))),
  kitta = COALESCE(NULLIF(c.kitta, 0), ROUND(ip.gross_interest / (1000 * 0.085 * (183.0 / 365.0))))
FROM public.clients c
WHERE ip.client_id = c.id;
