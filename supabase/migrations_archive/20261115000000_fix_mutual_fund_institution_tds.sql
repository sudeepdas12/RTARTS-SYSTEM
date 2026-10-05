-- =========================================================
-- Fix: Mutual Fund institutional distributions are taxed at 15%
--
-- The RMF sample file ("RMF 1 BOOK CLOSE FY_2081-82_DIVIDEND.xlsx")
-- applies 15% TDS to INSTITUTION unit-holders and 5% to PUBLIC
-- unit-holders (0% for tax-exempt). The original seed set
-- MUTUAL_FUND / COMPANY_INSTITUTION to 5% (copying the ordinary
-- dividend rule), which would under-deduct TDS by 10 points for
-- institutions on mutual-fund income — both for raw (non-precalculated)
-- imports and for classification-confirm recomputations.
-- =========================================================

UPDATE public.payable_tax_rules
   SET tax_rate = 0.15,
       updated_at = now()
 WHERE payable_category = 'MUTUAL_FUND'
   AND payee_classification = 'COMPANY_INSTITUTION'
   AND is_active;
