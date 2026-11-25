BEGIN;

SET LOCAL app.skip_audit = 'on';

-- Keep the seeded fiscal-year flag aligned with the actual reporting date.
-- The original reference-data migration hard-coded 2081/82 as active.
UPDATE public.fiscal_years
SET is_active = CURRENT_DATE BETWEEN start_date AND end_date
WHERE fiscal_year IN ('2079/80', '2080/81', '2081/82', '2082/83', '2083/84');

-- Repair ledger balances after seed/import runs without changing settled amounts.
UPDATE public.dividend_payables
SET paid_amount = GREATEST(0, LEAST(net_payable, COALESCE(paid_amount, 0))),
    remaining_amount = GREATEST(0, net_payable - GREATEST(0, LEAST(net_payable, COALESCE(paid_amount, 0)))),
    updated_at = now()
WHERE paid_amount IS NULL
   OR paid_amount < 0
   OR paid_amount > net_payable
   OR remaining_amount IS NULL
   OR remaining_amount <> GREATEST(0, net_payable - GREATEST(0, LEAST(net_payable, COALESCE(paid_amount, 0))));

UPDATE public.interest_payables
SET paid_amount = GREATEST(0, LEAST(net_payable, COALESCE(paid_amount, 0))),
    remaining_amount = GREATEST(0, net_payable - GREATEST(0, LEAST(net_payable, COALESCE(paid_amount, 0)))),
    updated_at = now()
WHERE paid_amount IS NULL
   OR paid_amount < 0
   OR paid_amount > net_payable
   OR remaining_amount IS NULL
   OR remaining_amount <> GREATEST(0, net_payable - GREATEST(0, LEAST(net_payable, COALESCE(paid_amount, 0))));

UPDATE public.mutual_fund_payables
SET paid_amount = GREATEST(0, LEAST(net_payable, COALESCE(paid_amount, 0))),
    remaining_amount = GREATEST(0, net_payable - GREATEST(0, LEAST(net_payable, COALESCE(paid_amount, 0)))),
    updated_at = now()
WHERE paid_amount IS NULL
   OR paid_amount < 0
   OR paid_amount > net_payable
   OR remaining_amount IS NULL
   OR remaining_amount <> GREATEST(0, net_payable - GREATEST(0, LEAST(net_payable, COALESCE(paid_amount, 0))));

COMMIT;
