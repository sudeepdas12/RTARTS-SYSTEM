-- =========================================================
-- Add kitta (shareholding units) to clients table & backfill
-- =========================================================

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS kitta numeric DEFAULT 0;

-- Backfill from dividend_payables
UPDATE public.clients c
SET kitta = sub.total_kitta
FROM (
  SELECT client_id, SUM(COALESCE(after_bonus_kitta, shares_held, 0)) AS total_kitta
  FROM public.dividend_payables
  WHERE client_id IS NOT NULL AND (COALESCE(after_bonus_kitta, shares_held, 0) > 0)
  GROUP BY client_id
) sub
WHERE c.id = sub.client_id AND (c.kitta IS NULL OR c.kitta = 0);

-- Backfill from mutual_fund_payables
UPDATE public.clients c
SET kitta = sub.total_kitta
FROM (
  SELECT client_id, SUM(COALESCE(after_bonus_kitta, shares_held, 0)) AS total_kitta
  FROM public.mutual_fund_payables
  WHERE client_id IS NOT NULL AND (COALESCE(after_bonus_kitta, shares_held, 0) > 0)
  GROUP BY client_id
) sub
WHERE c.id = sub.client_id AND (c.kitta IS NULL OR c.kitta = 0);

-- Backfill from interest_payables
UPDATE public.clients c
SET kitta = sub.total_kitta
FROM (
  SELECT client_id, SUM(ROUND(gross_interest / (1000 * 0.085 * (183.0 / 365.0)))) AS total_kitta
  FROM public.interest_payables
  WHERE client_id IS NOT NULL AND gross_interest > 0
  GROUP BY client_id
) sub
WHERE c.id = sub.client_id AND (c.kitta IS NULL OR c.kitta = 0);
