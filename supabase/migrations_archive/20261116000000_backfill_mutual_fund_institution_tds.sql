-- =========================================================
-- Backfill existing mutual-fund institutional payables to 15% TDS
--
-- Rows imported before the MUTUAL_FUND / COMPANY_INSTITUTION rate was
-- corrected (20261115000000) may still hold a 5% TDS (or the value their
-- source file carried). Recompute only rows whose master client is a confirmed
-- COMPANY_INSTITUTION, using the authoritative rule — the payable trigger
-- re-reads the client master anyway, so anything else would be overwritten by
-- the trigger rather than by this statement.
-- =========================================================

UPDATE public.mutual_fund_payables p
   SET tds_rate = r.tax_rate,
       tax_amount = round(p.gross_dividend * r.tax_rate, 2),
       net_payable = round(p.gross_dividend - round(p.gross_dividend * r.tax_rate, 2), 2)
  FROM public.clients c
  JOIN public.payable_tax_rules r
    ON r.payable_category = 'MUTUAL_FUND'
   AND r.payee_classification = 'COMPANY_INSTITUTION'
   AND r.is_active
 WHERE c.id = p.client_id
   AND c.payee_classification = 'COMPANY_INSTITUTION'
   AND p.payee_classification = 'COMPANY_INSTITUTION'
   AND p.tds_rate IS DISTINCT FROM 0.15;
