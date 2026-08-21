-- ============================================================================
-- Migration: Correct natural persons misclassified as TAX_EXEMPT
-- Description:
--   Prior import heuristics matched the substring 'kosh' in personal names
--   (e.g., Rikosh Giri, Hikosh Giri, Kikosh Thapa, Kosh Nath Adhikari, Kosh Raj).
--   This migration fixes all existing client records that have human family lineage
--   (father_name or grandfather_name) and restores them to NATURAL_PERSON / Public.
-- ============================================================================

-- 1. Correct existing client records in public.clients
UPDATE public.clients
SET
  payee_classification = 'NATURAL_PERSON',
  holder_type = 'Natural Person - Public'::public.holder_type,
  payee_segment = 'PUBLIC',
  classification_status = 'AUTO_CLASSIFIED',
  classification_source = 'Family Lineage Verification',
  updated_at = now()
WHERE
  (
    (father_name IS NOT NULL AND trim(father_name) != '')
    OR (grandfather_name IS NOT NULL AND trim(grandfather_name) != '')
  )
  AND (
    payee_classification = 'TAX_EXEMPT'
    OR holder_type IN ('Tax Exempt'::public.holder_type, 'Mutual Fund'::public.holder_type)
  )
  -- Safety check: Ensure we never alter genuine institutional funds
  AND full_name !~* '(MUTUAL\s*FUND|\bMF\b|FOCUS\s*(40|30)|SELECT\s*30|SUPER\s*30|SAMRIDDHI|SAMUNNAT|PRAGATI|SAHABHAGITA|DHANABRIDDHI|SABAL|EQUITY\s*(FUND|SCHEME|ORIENTED)|GROWTH\s*(FUND|SCHEME)|BALANCED\s*(FUND|SCHEME)|BLUECHIP|LARGE\s*CAP|FLEXI\s*CAP|VALUE\s*FUND|DEBT\s*FUND|FIXED\s*INCOME|DYNAMIC\s*DEBT|SYSTEMATIC\s*INVESTMENT|SANCHAYA\s*KOSH|NAGARIK\s*LAGANI|CITIZEN\s*INVESTMENT|\bCIT\b|\bEPF\b|\bSSF\b|SOCIAL\s*SECURITY\s*FUND|AWAKASH\s*KOSH|AWAKASH\s*FUND|KALYAN\s*KOSH|KOSH\s*BYAWASTHAPAN)';

-- 2. Recalculate and sync any dividend_payables linked to these corrected clients
UPDATE public.dividend_payables dp
SET
  payee_classification = 'NATURAL_PERSON',
  payee_category = 'PUBLIC',
  tax_amount = round(dp.gross_amount * 0.05, 2),
  net_payable = round(dp.gross_amount - (dp.gross_amount * 0.05), 2),
  updated_at = now()
FROM public.clients c
WHERE
  dp.client_id = c.id
  AND c.payee_classification = 'NATURAL_PERSON'
  AND (dp.payee_classification = 'TAX_EXEMPT' OR dp.tax_amount = 0)
  AND dp.gross_amount > 0;

-- 3. Recalculate and sync any interest_payables linked to these corrected clients
UPDATE public.interest_payables ip
SET
  payee_classification = 'NATURAL_PERSON',
  payee_category = 'PUBLIC',
  tax_amount = round(ip.gross_interest * 0.06, 2),
  net_payable = round(ip.gross_interest - (ip.gross_interest * 0.06), 2),
  updated_at = now()
FROM public.clients c
WHERE
  ip.client_id = c.id
  AND c.payee_classification = 'NATURAL_PERSON'
  AND (ip.payee_classification = 'TAX_EXEMPT' OR ip.tax_amount = 0)
  AND ip.gross_interest > 0;
