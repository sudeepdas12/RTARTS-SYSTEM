-- Migration: 20261231000001_unify_tax_rules_and_foreign_investor.sql
-- Purpose:
--   1. Make payable_tax_rules the ONLY source of TDS rates (no hardcoded fallbacks in the trigger).
--   2. Allow FOREIGN_INVESTOR (and EMPLOYEE segment) on clients and all payable tables.
--   3. Map holder_type 'Foreign' -> FOREIGN_INVESTOR instead of COMPANY_INSTITUTION.
--   4. Provide an audit view listing payables whose stored rate differs from the current rule.
--
-- !! ACTION REQUIRED BEFORE APPLYING !!
-- Rates below follow FY 2083/84 (Finance Act 2083) tables published by Nexus Advisory and Shankar
-- Associates (secondary sources, not the gazetted Act). Earlier migrations (1111, 1142, 1219) disagree
-- with each other. Remaining open items are marked CONFIRM. Have your tax advisor
-- confirm every row, edit the VALUES list, and only then run this migration.
-- This migration does NOT rewrite already-paid or historical payables.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Authoritative rates (edit after tax-advisor confirmation)
-- ---------------------------------------------------------------------------
INSERT INTO public.payable_tax_rules (payable_category, payee_classification, tax_rate, is_active) VALUES
  ('DIVIDEND',    'NATURAL_PERSON',      0.05, true),
  ('DIVIDEND',    'PUBLIC_LEGAL_PERSON', 0.05, true),
  ('DIVIDEND',    'COMPANY_INSTITUTION', 0.05, true),   -- Sec 88(2)(ka): 5% on any resident-company dividend (1219's 15% has no source)
  ('DIVIDEND',    'FOREIGN_INVESTOR',    0.05, true),   -- non-resident dividend: 5%, final (Sec 92)
  ('DIVIDEND',    'BANK_FI',             0.05, true),
  ('DIVIDEND',    'TAX_EXEMPT',          0,    true),
  ('INTEREST',    'NATURAL_PERSON',      0.06, true),
  ('INTEREST',    'PUBLIC_LEGAL_PERSON', 0.06, true),   -- CONFIRM: law gives 6% only to natural persons; entities 15%
  ('INTEREST',    'COMPANY_INSTITUTION', 0.15, true),
  ('INTEREST',    'FOREIGN_INVESTOR',    0.15, true),
  ('INTEREST',    'BANK_FI',             0.00, true),   -- Inter-bank / BFIs exempt from TDS on debentures (Sec 88(4))
  ('INTEREST',    'TAX_EXEMPT',          0,    true),
  ('MUTUAL_FUND', 'NATURAL_PERSON',      0.05, true),
  ('MUTUAL_FUND', 'PUBLIC_LEGAL_PERSON', 0.15, true),   -- Sec 88(1) proviso 6: natural person 5%, any other person 15%
  ('MUTUAL_FUND', 'COMPANY_INSTITUTION', 0.15, true),   -- Sec 88(1) proviso 6 (1111's 5% was wrong)
  ('MUTUAL_FUND', 'FOREIGN_INVESTOR',    0.15, true),   -- CONFIRM: foreign individual may be 5% (natural person); needs individual/entity split
  ('MUTUAL_FUND', 'BANK_FI',             0.15, true),
  ('MUTUAL_FUND', 'TAX_EXEMPT',          0,    true)
ON CONFLICT (payable_category, payee_classification)
DO UPDATE SET tax_rate = EXCLUDED.tax_rate, is_active = EXCLUDED.is_active, updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. Widen CHECK constraints (looked up by definition, so legacy names do not matter)
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, c.conname
    FROM pg_constraint c
    WHERE c.contype = 'c'
      AND c.conrelid IN ('public.clients'::regclass, 'public.dividend_payables'::regclass,
                         'public.interest_payables'::regclass, 'public.mutual_fund_payables'::regclass)
      AND (pg_get_constraintdef(c.oid) ILIKE '%payee_classification%'
        OR pg_get_constraintdef(c.oid) ILIKE '%payee_segment%')
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','dividend_payables','interest_payables','mutual_fund_payables'] LOOP
    EXECUTE format($f$ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (payee_classification IN
      ('NATURAL_PERSON','PUBLIC_LEGAL_PERSON','COMPANY_INSTITUTION','FOREIGN_INVESTOR','BANK_FI','TAX_EXEMPT','UNCLASSIFIED'))$f$,
      t, t || '_payee_classification_check');
    EXECUTE format($f$ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (payee_segment IS NULL OR payee_segment IN
      ('PROMOTER','LOCAL','EMPLOYEE','PUBLIC'))$f$, t, t || '_payee_segment_check');
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Client classification trigger: Foreign -> FOREIGN_INVESTOR, Employee segment kept
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_client_payee_classification()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.classification_status = 'CONFIRMED' THEN RETURN NEW; END IF;
  IF NEW.payee_classification <> 'UNCLASSIFIED' THEN
    NEW.classification_status := COALESCE(NULLIF(NEW.classification_status, 'REVIEW_REQUIRED'), 'AUTO_CLASSIFIED');
    RETURN NEW;
  END IF;
  CASE NEW.holder_type::text
    WHEN 'Natural Person - Promoter', 'Promoter' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'PROMOTER';
    WHEN 'Natural Person - Local', 'Local' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'LOCAL';
    WHEN 'Natural Person - Employee', 'Employee' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'EMPLOYEE';
    WHEN 'Natural Person - Public', 'Natural Person - Minor', 'Natural Person - Joint Holder' THEN NEW.payee_classification := 'NATURAL_PERSON'; NEW.payee_segment := 'PUBLIC';
    WHEN 'Public' THEN NEW.payee_classification := 'PUBLIC_LEGAL_PERSON'; NEW.payee_segment := 'PUBLIC';
    WHEN 'Legal Person', 'Legal Person - Promoter', 'Institution' THEN NEW.payee_classification := 'COMPANY_INSTITUTION';
    WHEN 'Foreign' THEN NEW.payee_classification := 'FOREIGN_INVESTOR';
    WHEN 'Bank', 'Financial Institution', 'Bank / FI' THEN NEW.payee_classification := 'BANK_FI';
    WHEN 'Mutual Fund', 'Tax Exempt' THEN NEW.payee_classification := 'TAX_EXEMPT';
    ELSE RETURN NEW;
  END CASE;
  NEW.classification_status := 'AUTO_CLASSIFIED';
  NEW.classification_source := COALESCE(NEW.classification_source, 'holder_type');
  RETURN NEW;
END;
$$;

-- Existing foreign clients that were auto-mapped to COMPANY_INSTITUTION: move them, but only
-- if nobody has confirmed them manually. Pending payables follow via the existing cascade trigger.
UPDATE public.clients
   SET payee_classification = 'FOREIGN_INVESTOR'
 WHERE holder_type::text = 'Foreign'
   AND payee_classification = 'COMPANY_INSTITUTION'
   AND classification_status <> 'CONFIRMED';

-- ---------------------------------------------------------------------------
-- 4. Payable trigger: rule table is the single source; no hardcoded fallback rates
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_payable_classification_and_tax()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  c record;
  payable_kind text := CASE TG_TABLE_NAME
    WHEN 'interest_payables' THEN 'INTEREST'
    WHEN 'mutual_fund_payables' THEN 'MUTUAL_FUND'
    ELSE 'DIVIDEND' END;
  gross numeric;
  v_rate numeric;
  v_locked boolean := false;
BEGIN
  -- Settled rows are a historical snapshot: never re-rate them.
  IF TG_OP = 'UPDATE' AND OLD.payment_status IS NOT NULL AND OLD.payment_status <> 'Pending'
     AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id THEN
    v_locked := true;
  END IF;
  IF v_locked THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.client_id IS NOT NULL THEN
    SELECT payee_classification, payee_segment, classification_status
      INTO c FROM public.clients WHERE id = NEW.client_id;
    IF FOUND THEN
      NEW.payee_classification := COALESCE(c.payee_classification, 'UNCLASSIFIED');
      NEW.payee_segment := COALESCE(c.payee_segment, NEW.payee_segment);
      NEW.classification_status := COALESCE(c.classification_status, 'REVIEW_REQUIRED');
    END IF;
  END IF;
  NEW.payee_classification := COALESCE(NEW.payee_classification, 'UNCLASSIFIED');

  gross := CASE WHEN TG_TABLE_NAME = 'interest_payables'
                THEN COALESCE(NEW.gross_interest, 0) ELSE COALESCE(NEW.gross_dividend, 0) END;

  IF NEW.payee_classification = 'UNCLASSIFIED' THEN
    -- Unknown payee: no tax is implied; classification review must happen before payment.
    NEW.tds_rate := NULL;
    NEW.tax_amount := 0;
  ELSE
    SELECT tax_rate INTO v_rate FROM public.payable_tax_rules
     WHERE payable_category = payable_kind
       AND payee_classification = NEW.payee_classification
       AND is_active
     LIMIT 1;
    IF v_rate IS NULL THEN
      RAISE EXCEPTION 'No active tax rule for % / %', payable_kind, NEW.payee_classification
        USING ERRCODE = 'P0001';
    END IF;
    NEW.tds_rate := v_rate;
    NEW.tax_amount := round(gross * v_rate, 2);
  END IF;

  NEW.net_payable := round(gross - COALESCE(NEW.tax_amount, 0), 2);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Drift audit: stored rate vs current rule (read-only; review before any backfill)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.payable_tds_rate_drift WITH (security_invoker = true) AS
SELECT 'DIVIDEND'::text AS payable_category, p.id, p.company_id, p.payee_classification,
       p.tds_rate AS stored_rate, r.tax_rate AS rule_rate, p.payment_status
  FROM public.dividend_payables p
  JOIN public.payable_tax_rules r ON r.payable_category = 'DIVIDEND'
   AND r.payee_classification = p.payee_classification AND r.is_active
 WHERE p.tds_rate IS DISTINCT FROM r.tax_rate
UNION ALL
SELECT 'INTEREST', p.id, p.company_id, p.payee_classification, p.tds_rate, r.tax_rate, p.payment_status
  FROM public.interest_payables p
  JOIN public.payable_tax_rules r ON r.payable_category = 'INTEREST'
   AND r.payee_classification = p.payee_classification AND r.is_active
 WHERE p.tds_rate IS DISTINCT FROM r.tax_rate
UNION ALL
SELECT 'MUTUAL_FUND', p.id, p.company_id, p.payee_classification, p.tds_rate, r.tax_rate, p.payment_status
  FROM public.mutual_fund_payables p
  JOIN public.payable_tax_rules r ON r.payable_category = 'MUTUAL_FUND'
   AND r.payee_classification = p.payee_classification AND r.is_active
 WHERE p.tds_rate IS DISTINCT FROM r.tax_rate;
GRANT SELECT ON public.payable_tds_rate_drift TO authenticated;

COMMIT;
