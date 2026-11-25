-- =============================================================================
-- Migration: Financial Triggers, Declarations, Multi-Leg Installments & Batch Lifecycle
-- Fixes:
--   1. bonus_tax accounting invariant (chk_div_balance_invariant, chk_mf_balance_invariant,
--      apply_payable_classification_and_tax, calc_dividend_payable_safe)
--   2. Paid/Partial immutability against classification/tax overwrite triggers & sync_all
--   3. declaration_id propagation across all bulk inserts, commit_staged_import & MF table
--   4. Multi-leg SEMI_1/SEMI_2 installments + UNCLASSIFIED exclusion in populate_payment_batch_chunk
--   5. Payment batch completion (completed_at column, AFTER UPDATE loop fix, paid_amount=0 fix)
--   6. Mutual fund 3-arg batch reversal & partial settlement snapshot preservation
--   7. Broken SQL lint procedures (get_declaration_summary, get_mutual_fund_schemes_summary)
--   8. bulk_upsert_company '%d%' face-value bug & get_agm_dividend_summary bonus rate/precision
-- =============================================================================

-- 1. Schema additions
ALTER TABLE public.payment_batches
  ADD COLUMN IF NOT EXISTS completed_at timestamp with time zone;

ALTER TABLE public.dividend_payables
  ADD COLUMN IF NOT EXISTS bonus_tax_mode text NOT NULL DEFAULT 'CASH_ADJUSTED';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dividend_payables_bonus_tax_mode_check'
  ) THEN
    ALTER TABLE public.dividend_payables
      ADD CONSTRAINT dividend_payables_bonus_tax_mode_check
      CHECK (bonus_tax_mode IN ('CASH_ADJUSTED', 'COMPANY_PAID', 'INVESTOR_PAID'));
  END IF;
END $$;

ALTER TABLE public.mutual_fund_payables
  ADD COLUMN IF NOT EXISTS declaration_id uuid REFERENCES public.corporate_declarations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bonus_tax_mode text NOT NULL DEFAULT 'CASH_ADJUSTED';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mutual_fund_payables_bonus_tax_mode_check'
  ) THEN
    ALTER TABLE public.mutual_fund_payables
      ADD CONSTRAINT mutual_fund_payables_bonus_tax_mode_check
      CHECK (bonus_tax_mode IN ('CASH_ADJUSTED', 'COMPANY_PAID', 'INVESTOR_PAID'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mfp_declaration_id ON public.mutual_fund_payables (declaration_id);

-- 2. Replace balance check constraints to include bonus_tax cleanly when CASH_ADJUSTED
ALTER TABLE public.dividend_payables DROP CONSTRAINT IF EXISTS chk_div_balance_invariant;
ALTER TABLE public.dividend_payables
  ADD CONSTRAINT chk_div_balance_invariant CHECK (
    abs(
      (
        gross_dividend
        - tax_amount
        - CASE WHEN COALESCE(bonus_tax_mode, 'CASH_ADJUSTED') = 'CASH_ADJUSTED' THEN COALESCE(bonus_tax, 0) ELSE 0 END
      ) - net_payable
    ) <= 0.05
  );

ALTER TABLE public.mutual_fund_payables DROP CONSTRAINT IF EXISTS chk_mf_balance_invariant;
ALTER TABLE public.mutual_fund_payables
  ADD CONSTRAINT chk_mf_balance_invariant CHECK (
    abs(
      (
        gross_dividend
        - tax_amount
        - CASE WHEN COALESCE(bonus_tax_mode, 'CASH_ADJUSTED') = 'CASH_ADJUSTED' THEN COALESCE(bonus_tax, 0) ELSE 0 END
      ) - net_payable
    ) <= 0.05
  );

-- 3. Fix classification/tax triggers to respect bonus_tax, is_tax_manual, and Paid/Partial immutability
CREATE OR REPLACE FUNCTION public.apply_payable_classification_and_tax()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  c record;
  payable_kind text := CASE TG_TABLE_NAME
    WHEN 'interest_payables' THEN 'INTEREST'
    WHEN 'mutual_fund_payables' THEN 'MUTUAL_FUND'
    ELSE 'DIVIDEND' END;
  gross numeric;
  v_rate numeric;
  v_bonus_deduction numeric := 0;
BEGIN
  -- Settled rows (Paid/Partial/etc.) are an immutable historical snapshot for tax/gross math
  IF TG_OP = 'UPDATE' AND OLD.payment_status IS NOT NULL AND OLD.payment_status::text <> 'Pending' THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.client_id IS NOT NULL THEN
    SELECT payee_classification, payee_segment, classification_status
      INTO c FROM public.clients WHERE id = NEW.client_id;
    IF FOUND THEN
      -- Only override when incoming row is UNCLASSIFIED or inherits client classification
      IF COALESCE(NEW.payee_classification, 'UNCLASSIFIED') = 'UNCLASSIFIED'
         OR COALESCE(c.classification_status, '') = 'CONFIRMED' THEN
        NEW.payee_classification := COALESCE(c.payee_classification, NEW.payee_classification, 'UNCLASSIFIED');
      END IF;
      NEW.payee_segment := COALESCE(c.payee_segment, NEW.payee_segment);
      IF NEW.classification_status IS NULL OR NEW.classification_status = 'REVIEW_REQUIRED' THEN
        NEW.classification_status := COALESCE(c.classification_status, 'REVIEW_REQUIRED');
      END IF;
    END IF;
  END IF;
  NEW.payee_classification := COALESCE(NEW.payee_classification, 'UNCLASSIFIED');

  IF TG_TABLE_NAME = 'interest_payables' THEN
    gross := COALESCE((to_jsonb(NEW)->>'gross_interest')::numeric, 0);
  ELSIF TG_TABLE_NAME = 'mutual_fund_payables' THEN
    gross := COALESCE((to_jsonb(NEW)->>'gross_dividend')::numeric, (to_jsonb(NEW)->>'gross_amount')::numeric, 0);
  ELSE
    gross := COALESCE((to_jsonb(NEW)->>'gross_dividend')::numeric, 0);
  END IF;

  IF TG_TABLE_NAME IN ('dividend_payables', 'mutual_fund_payables') THEN
    IF COALESCE((to_jsonb(NEW)->>'bonus_tax_mode'), 'CASH_ADJUSTED') = 'CASH_ADJUSTED' THEN
      v_bonus_deduction := COALESCE((to_jsonb(NEW)->>'bonus_tax')::numeric, 0);
    END IF;
  END IF;

  IF NEW.payee_classification = 'UNCLASSIFIED' THEN
    IF COALESCE(NEW.is_tax_manual, false) = false THEN
      NEW.tds_rate := NULL;
      NEW.tax_amount := 0;
    END IF;
  ELSIF COALESCE(NEW.is_tax_manual, false) = true THEN
    -- Keep explicitly audited / imported manual tax amounts intact
    NEW.tax_amount := COALESCE(NEW.tax_amount, 0);
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

  NEW.net_payable := GREATEST(0, round(gross - COALESCE(NEW.tax_amount, 0) - v_bonus_deduction, 2));
  NEW.remaining_amount := GREATEST(0, round(NEW.net_payable - COALESCE(NEW.paid_amount, 0), 2));
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.calc_dividend_payable_safe()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_bonus_deduction numeric := 0;
BEGIN
  -- Do not rewrite settled math on Paid/Partial rows; only refresh remaining_amount/status if paid_amount changed
  IF TG_OP = 'UPDATE' AND OLD.payment_status IS NOT NULL AND OLD.payment_status::text <> 'Pending' THEN
    IF NEW.paid_amount IS DISTINCT FROM OLD.paid_amount OR NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
      NEW.remaining_amount := GREATEST(0, round(COALESCE(NEW.net_payable, 0) - COALESCE(NEW.paid_amount, 0), 2));
      IF COALESCE(NEW.paid_amount, 0) >= NEW.net_payable AND NEW.net_payable > 0 THEN
        NEW.payment_status := 'Paid';
      ELSIF COALESCE(NEW.paid_amount, 0) > 0 THEN
        NEW.payment_status := 'Partial';
      END IF;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.gross_dividend IS NULL OR NEW.gross_dividend = 0 THEN
    IF NEW.shares_held IS NOT NULL AND NEW.dividend_rate IS NOT NULL THEN
      NEW.gross_dividend := round(COALESCE(NEW.shares_held, 0) * COALESCE(NEW.dividend_rate, 0), 2);
    END IF;
  END IF;

  IF COALESCE(NEW.bonus_tax_mode, 'CASH_ADJUSTED') = 'CASH_ADJUSTED' THEN
    v_bonus_deduction := COALESCE(NEW.bonus_tax, 0);
  END IF;

  IF NEW.is_tax_manual IS TRUE THEN
    IF NEW.tax_amount IS NULL THEN
      NEW.tax_amount := 0.00;
    END IF;
  ELSIF COALESCE(NEW.payee_classification, 'UNCLASSIFIED') = 'UNCLASSIFIED' THEN
    NEW.tax_amount := 0.00;
  ELSE
    IF (NEW.tax_amount IS NULL OR NEW.tax_amount = 0) AND (NEW.tax_rate IS NOT NULL OR NEW.tds_rate IS NOT NULL) THEN
      NEW.tax_amount := round(COALESCE(NEW.gross_dividend, 0) * COALESCE(NEW.tax_rate, NEW.tds_rate, 0), 2);
    END IF;
  END IF;

  NEW.net_payable := GREATEST(0, round(COALESCE(NEW.gross_dividend, 0) - COALESCE(NEW.tax_amount, 0) - v_bonus_deduction, 2));
  NEW.remaining_amount := GREATEST(0, round(COALESCE(NEW.net_payable, 0) - COALESCE(NEW.paid_amount, 0), 2));

  IF COALESCE(NEW.paid_amount, 0) >= NEW.net_payable AND NEW.net_payable > 0 THEN
    NEW.payment_status := 'Paid';
  ELSIF COALESCE(NEW.paid_amount, 0) > 0 THEN
    NEW.payment_status := 'Partial';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dividend_classification_tax ON public.dividend_payables;
CREATE TRIGGER trg_dividend_classification_tax
  BEFORE INSERT OR UPDATE OF client_id, gross_dividend, tax_amount, bonus_tax, bonus_tax_mode, tds_rate
  ON public.dividend_payables
  FOR EACH ROW EXECUTE FUNCTION public.apply_payable_classification_and_tax();

DROP TRIGGER IF EXISTS trg_mutual_fund_classification_tax ON public.mutual_fund_payables;
CREATE TRIGGER trg_mutual_fund_classification_tax
  BEFORE INSERT OR UPDATE OF client_id, gross_dividend, tax_amount, bonus_tax, bonus_tax_mode, tds_rate
  ON public.mutual_fund_payables
  FOR EACH ROW EXECUTE FUNCTION public.apply_payable_classification_and_tax();

-- 4. Update bulk_insert_* RPCs to preserve declaration_id, bonus_tax_mode, and is_tax_manual
CREATE OR REPLACE FUNCTION public.bulk_insert_dividend_payables(p_payables jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $$
DECLARE
  v_payable jsonb;
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := COALESCE(
      auth.jwt() ->> 'role',
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF COALESCE(v_jwt_role, '') != 'service_role'
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payables) item
      WHERE (item->>'company_id') IS NOT NULL AND (item->>'company_id') != ''
        AND NOT public.has_company_access(auth.uid(), (item->>'company_id')::uuid)
    ) THEN
      RAISE EXCEPTION 'Unauthorized: caller does not have access to one or more companies in dividend payload' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      INSERT INTO public.dividend_payables (
        declaration_id, upload_id, company_id, client_id, shares_held,
        dividend_rate, bonus_rate, gross_dividend, tax_amount,
        net_payable, payment_status, payment_date, payment_reference,
        bonus_actual, bonus_issued, bonus_fraction, after_bonus_kitta,
        bonus_tax, bonus_tax_mode, is_tax_manual,
        bank_name, bank_account_no, bank_branch, lot_name,
        fiscal_year, tds_rate, remarks, payee_classification, payee_segment,
        classification_status, paid_amount, remaining_amount
      ) VALUES (
        NULLIF(v_payable->>'declaration_id', '')::uuid,
        NULLIF(v_payable->>'upload_id', '')::uuid,
        (v_payable->>'company_id')::uuid,
        (v_payable->>'client_id')::uuid,
        COALESCE(NULLIF(v_payable->>'shares_held', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'dividend_rate', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'bonus_rate', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'gross_dividend', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'tax_amount', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'net_payable', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'payment_status', '')::public.payment_status, 'Pending'),
        COALESCE(NULLIF(v_payable->>'payment_date', '')::date, NULL),
        v_payable->>'payment_reference',
        NULLIF(v_payable->>'bonus_actual', '')::numeric,
        NULLIF(v_payable->>'bonus_issued', '')::numeric,
        NULLIF(v_payable->>'bonus_fraction', '')::numeric,
        NULLIF(v_payable->>'after_bonus_kitta', '')::numeric,
        NULLIF(v_payable->>'bonus_tax', '')::numeric,
        COALESCE(NULLIF(v_payable->>'bonus_tax_mode', ''), 'CASH_ADJUSTED'),
        COALESCE(NULLIF(v_payable->>'is_tax_manual', '')::boolean, false),
        v_payable->>'bank_name',
        v_payable->>'bank_account_no',
        v_payable->>'bank_branch',
        v_payable->>'lot_name',
        v_payable->>'fiscal_year',
        COALESCE(NULLIF(v_payable->>'tds_rate', '')::numeric, NULL),
        v_payable->>'remarks',
        COALESCE(NULLIF(v_payable->>'payee_classification', ''), 'UNCLASSIFIED'),
        NULLIF(v_payable->>'payee_segment', ''),
        COALESCE(NULLIF(v_payable->>'classification_status', ''), 'AUTO_CLASSIFIED'),
        COALESCE(NULLIF(v_payable->>'paid_amount', '')::numeric, 0),
        COALESCE(
          NULLIF(v_payable->>'remaining_amount', '')::numeric,
          NULLIF(v_payable->>'net_payable', '')::numeric,
          0
        )
      )
      ON CONFLICT (client_id, company_id, fiscal_year, COALESCE(remarks, '')) DO UPDATE SET
        declaration_id = COALESCE(EXCLUDED.declaration_id, dividend_payables.declaration_id),
        upload_id = COALESCE(EXCLUDED.upload_id, dividend_payables.upload_id),
        shares_held = COALESCE(EXCLUDED.shares_held, dividend_payables.shares_held),
        dividend_rate = COALESCE(EXCLUDED.dividend_rate, dividend_payables.dividend_rate),
        bonus_rate = COALESCE(EXCLUDED.bonus_rate, dividend_payables.bonus_rate),
        gross_dividend = EXCLUDED.gross_dividend,
        tax_amount = EXCLUDED.tax_amount,
        net_payable = EXCLUDED.net_payable,
        remaining_amount = EXCLUDED.net_payable,
        bonus_actual = COALESCE(EXCLUDED.bonus_actual, dividend_payables.bonus_actual),
        bonus_issued = COALESCE(EXCLUDED.bonus_issued, dividend_payables.bonus_issued),
        bonus_fraction = COALESCE(EXCLUDED.bonus_fraction, dividend_payables.bonus_fraction),
        after_bonus_kitta = COALESCE(EXCLUDED.after_bonus_kitta, dividend_payables.after_bonus_kitta),
        bonus_tax = COALESCE(EXCLUDED.bonus_tax, dividend_payables.bonus_tax),
        bonus_tax_mode = COALESCE(EXCLUDED.bonus_tax_mode, dividend_payables.bonus_tax_mode),
        is_tax_manual = EXCLUDED.is_tax_manual OR COALESCE(dividend_payables.is_tax_manual, false),
        bank_name = COALESCE(EXCLUDED.bank_name, dividend_payables.bank_name),
        bank_account_no = COALESCE(EXCLUDED.bank_account_no, dividend_payables.bank_account_no),
        bank_branch = COALESCE(EXCLUDED.bank_branch, dividend_payables.bank_branch),
        lot_name = COALESCE(EXCLUDED.lot_name, dividend_payables.lot_name),
        tds_rate = COALESCE(EXCLUDED.tds_rate, dividend_payables.tds_rate),
        payee_classification = CASE
          WHEN dividend_payables.classification_status = 'CONFIRMED' THEN dividend_payables.payee_classification
          ELSE COALESCE(NULLIF(EXCLUDED.payee_classification, 'UNCLASSIFIED'), dividend_payables.payee_classification)
        END,
        payee_segment = CASE
          WHEN dividend_payables.classification_status = 'CONFIRMED' THEN dividend_payables.payee_segment
          ELSE COALESCE(EXCLUDED.payee_segment, dividend_payables.payee_segment)
        END,
        updated_at = now()
      WHERE dividend_payables.payment_status = 'Pending';

      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'client_id', v_payable->>'client_id',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'inserted', v_inserted, 'errors', v_errors);
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_insert_interest_payables(p_payables jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $$
DECLARE
  v_payable jsonb;
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := COALESCE(
      auth.jwt() ->> 'role',
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF COALESCE(v_jwt_role, '') != 'service_role'
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payables) item
      WHERE (item->>'company_id') IS NOT NULL AND (item->>'company_id') != ''
        AND NOT public.has_company_access(auth.uid(), (item->>'company_id')::uuid)
    ) THEN
      RAISE EXCEPTION 'Unauthorized: caller does not have access to one or more companies in interest payload' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      INSERT INTO public.interest_payables (
        declaration_id, upload_id, company_id, client_id, instrument_ref, gross_interest,
        tax_amount, net_payable, due_date, payment_status, payment_date,
        payment_reference, fiscal_year, tds_rate, is_tax_manual, bank_name, bank_account_no,
        bank_branch, lot_name, remarks, payee_classification, payee_segment,
        classification_status, shares_held, kitta, days_count,
        paid_amount, remaining_amount
      ) VALUES (
        NULLIF(v_payable->>'declaration_id', '')::uuid,
        NULLIF(v_payable->>'upload_id', '')::uuid,
        (v_payable->>'company_id')::uuid,
        (v_payable->>'client_id')::uuid,
        v_payable->>'instrument_ref',
        COALESCE(NULLIF(v_payable->>'gross_interest', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'tax_amount', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'net_payable', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'due_date', '')::date, CURRENT_DATE),
        COALESCE(NULLIF(v_payable->>'payment_status', '')::public.payment_status, 'Pending'),
        COALESCE(NULLIF(v_payable->>'payment_date', '')::date, NULL),
        v_payable->>'payment_reference',
        v_payable->>'fiscal_year',
        COALESCE(NULLIF(v_payable->>'tds_rate', '')::numeric, NULL),
        COALESCE(NULLIF(v_payable->>'is_tax_manual', '')::boolean, false),
        v_payable->>'bank_name',
        v_payable->>'bank_account_no',
        v_payable->>'bank_branch',
        v_payable->>'lot_name',
        v_payable->>'remarks',
        COALESCE(NULLIF(v_payable->>'payee_classification', ''), 'UNCLASSIFIED'),
        NULLIF(v_payable->>'payee_segment', ''),
        COALESCE(NULLIF(v_payable->>'classification_status', ''), 'AUTO_CLASSIFIED'),
        COALESCE(NULLIF(v_payable->>'shares_held', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'kitta', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'days_count', '')::numeric, 183),
        COALESCE(NULLIF(v_payable->>'paid_amount', '')::numeric, 0),
        COALESCE(
          NULLIF(v_payable->>'remaining_amount', '')::numeric,
          NULLIF(v_payable->>'net_payable', '')::numeric,
          0
        )
      )
      ON CONFLICT (client_id, company_id, fiscal_year, COALESCE(remarks, '')) DO UPDATE SET
        declaration_id = COALESCE(EXCLUDED.declaration_id, interest_payables.declaration_id),
        upload_id = COALESCE(EXCLUDED.upload_id, interest_payables.upload_id),
        gross_interest = EXCLUDED.gross_interest,
        tax_amount = EXCLUDED.tax_amount,
        net_payable = EXCLUDED.net_payable,
        tds_rate = COALESCE(EXCLUDED.tds_rate, interest_payables.tds_rate),
        is_tax_manual = EXCLUDED.is_tax_manual OR COALESCE(interest_payables.is_tax_manual, false),
        shares_held = COALESCE(EXCLUDED.shares_held, interest_payables.shares_held),
        kitta = COALESCE(EXCLUDED.kitta, interest_payables.kitta),
        days_count = COALESCE(EXCLUDED.days_count, interest_payables.days_count),
        remaining_amount = EXCLUDED.net_payable,
        bank_name = COALESCE(EXCLUDED.bank_name, interest_payables.bank_name),
        bank_account_no = COALESCE(EXCLUDED.bank_account_no, interest_payables.bank_account_no),
        bank_branch = COALESCE(EXCLUDED.bank_branch, interest_payables.bank_branch),
        payee_classification = CASE
          WHEN interest_payables.classification_status = 'CONFIRMED' THEN interest_payables.payee_classification
          ELSE COALESCE(NULLIF(EXCLUDED.payee_classification, 'UNCLASSIFIED'), interest_payables.payee_classification)
        END,
        payee_segment = CASE
          WHEN interest_payables.classification_status = 'CONFIRMED' THEN interest_payables.payee_segment
          ELSE COALESCE(EXCLUDED.payee_segment, interest_payables.payee_segment)
        END,
        updated_at = now()
      WHERE interest_payables.payment_status = 'Pending';

      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'client_id', v_payable->>'client_id',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'inserted', v_inserted, 'errors', v_errors);
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_insert_mutual_fund_payables(p_payables jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $$
DECLARE
  v_payable jsonb;
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := COALESCE(
      auth.jwt() ->> 'role',
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF COALESCE(v_jwt_role, '') != 'service_role'
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payables) item
      WHERE (item->>'company_id') IS NOT NULL AND (item->>'company_id') != ''
        AND NOT public.has_company_access(auth.uid(), (item->>'company_id')::uuid)
    ) THEN
      RAISE EXCEPTION 'Unauthorized: caller does not have access to one or more companies in mutual fund payload' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      INSERT INTO public.mutual_fund_payables (
        declaration_id, upload_id, company_id, client_id, shares_held, dividend_rate,
        dividend_type, gross_dividend, tax_amount, net_payable,
        payment_status, payment_date, payment_reference, bonus_actual,
        bonus_issued, bonus_fraction, after_bonus_kitta, bonus_tax, bonus_tax_mode, is_tax_manual,
        bank_name, bank_account_no, bank_branch, lot_name, fiscal_year,
        tds_rate, remarks, payee_classification, payee_segment,
        classification_status, paid_amount, remaining_amount
      ) VALUES (
        NULLIF(v_payable->>'declaration_id', '')::uuid,
        NULLIF(v_payable->>'upload_id', '')::uuid,
        (v_payable->>'company_id')::uuid,
        (v_payable->>'client_id')::uuid,
        COALESCE(NULLIF(v_payable->>'shares_held', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'dividend_rate', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'dividend_type', '')::public.dividend_type, 'Cash'),
        COALESCE(NULLIF(v_payable->>'gross_dividend', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'tax_amount', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'net_payable', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'payment_status', '')::public.payment_status, 'Pending'),
        COALESCE(NULLIF(v_payable->>'payment_date', '')::date, NULL),
        v_payable->>'payment_reference',
        NULLIF(v_payable->>'bonus_actual', '')::numeric,
        NULLIF(v_payable->>'bonus_issued', '')::numeric,
        NULLIF(v_payable->>'bonus_fraction', '')::numeric,
        NULLIF(v_payable->>'after_bonus_kitta', '')::numeric,
        NULLIF(v_payable->>'bonus_tax', '')::numeric,
        COALESCE(NULLIF(v_payable->>'bonus_tax_mode', ''), 'CASH_ADJUSTED'),
        COALESCE(NULLIF(v_payable->>'is_tax_manual', '')::boolean, false),
        v_payable->>'bank_name',
        v_payable->>'bank_account_no',
        v_payable->>'bank_branch',
        v_payable->>'lot_name',
        v_payable->>'fiscal_year',
        COALESCE(NULLIF(v_payable->>'tds_rate', '')::numeric, NULL),
        v_payable->>'remarks',
        COALESCE(NULLIF(v_payable->>'payee_classification', ''), 'UNCLASSIFIED'),
        NULLIF(v_payable->>'payee_segment', ''),
        COALESCE(NULLIF(v_payable->>'classification_status', ''), 'AUTO_CLASSIFIED'),
        COALESCE(NULLIF(v_payable->>'paid_amount', '')::numeric, 0),
        COALESCE(
          NULLIF(v_payable->>'remaining_amount', '')::numeric,
          NULLIF(v_payable->>'net_payable', '')::numeric,
          0
        )
      )
      ON CONFLICT (client_id, company_id, fiscal_year, COALESCE(remarks, '')) DO UPDATE SET
        declaration_id = COALESCE(EXCLUDED.declaration_id, mutual_fund_payables.declaration_id),
        upload_id = COALESCE(EXCLUDED.upload_id, mutual_fund_payables.upload_id),
        shares_held = COALESCE(EXCLUDED.shares_held, mutual_fund_payables.shares_held),
        dividend_rate = COALESCE(EXCLUDED.dividend_rate, mutual_fund_payables.dividend_rate),
        dividend_type = COALESCE(EXCLUDED.dividend_type, mutual_fund_payables.dividend_type),
        gross_dividend = EXCLUDED.gross_dividend,
        tax_amount = EXCLUDED.tax_amount,
        net_payable = EXCLUDED.net_payable,
        remaining_amount = EXCLUDED.net_payable,
        bonus_actual = COALESCE(EXCLUDED.bonus_actual, mutual_fund_payables.bonus_actual),
        bonus_issued = COALESCE(EXCLUDED.bonus_issued, mutual_fund_payables.bonus_issued),
        bonus_fraction = COALESCE(EXCLUDED.bonus_fraction, mutual_fund_payables.bonus_fraction),
        after_bonus_kitta = COALESCE(EXCLUDED.after_bonus_kitta, mutual_fund_payables.after_bonus_kitta),
        bonus_tax = COALESCE(EXCLUDED.bonus_tax, mutual_fund_payables.bonus_tax),
        bonus_tax_mode = COALESCE(EXCLUDED.bonus_tax_mode, mutual_fund_payables.bonus_tax_mode),
        is_tax_manual = EXCLUDED.is_tax_manual OR COALESCE(mutual_fund_payables.is_tax_manual, false),
        bank_name = COALESCE(EXCLUDED.bank_name, mutual_fund_payables.bank_name),
        bank_account_no = COALESCE(EXCLUDED.bank_account_no, mutual_fund_payables.bank_account_no),
        bank_branch = COALESCE(EXCLUDED.bank_branch, mutual_fund_payables.bank_branch),
        lot_name = COALESCE(EXCLUDED.lot_name, mutual_fund_payables.lot_name),
        tds_rate = COALESCE(EXCLUDED.tds_rate, mutual_fund_payables.tds_rate),
        payee_classification = CASE
          WHEN mutual_fund_payables.classification_status = 'CONFIRMED' THEN mutual_fund_payables.payee_classification
          ELSE COALESCE(NULLIF(EXCLUDED.payee_classification, 'UNCLASSIFIED'), mutual_fund_payables.payee_classification)
        END,
        payee_segment = CASE
          WHEN mutual_fund_payables.classification_status = 'CONFIRMED' THEN mutual_fund_payables.payee_segment
          ELSE COALESCE(EXCLUDED.payee_segment, mutual_fund_payables.payee_segment)
        END,
        updated_at = now()
      WHERE mutual_fund_payables.payment_status = 'Pending';

      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'client_id', v_payable->>'client_id',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'inserted', v_inserted, 'errors', v_errors);
END;
$$;

-- 5. Support multi-leg installments safely on payments + prevent over-allocation
DROP INDEX IF EXISTS public.uq_active_payments_payable_id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_payments_batch_payable
  ON public.payments (batch_id, payable_id)
  WHERE status NOT IN ('Failed', 'Reversed', 'Cancelled')
    AND payable_id IS NOT NULL
    AND batch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_payment_installment_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_net_payable numeric := 0;
  v_active_sum numeric := 0;
BEGIN
  IF NEW.payable_id IS NULL OR NEW.status IN ('Failed', 'Reversed', 'Cancelled') THEN
    RETURN NEW;
  END IF;

  IF LOWER(COALESCE(NEW.payable_type, '')) IN ('interest', 'interest_payables', 'debenture') THEN
    SELECT net_payable INTO v_net_payable FROM public.interest_payables WHERE id = NEW.payable_id;
  ELSIF LOWER(COALESCE(NEW.payable_type, '')) IN ('mutual_fund', 'mutual_fund_payables') THEN
    SELECT net_payable INTO v_net_payable FROM public.mutual_fund_payables WHERE id = NEW.payable_id;
  ELSE
    SELECT net_payable INTO v_net_payable FROM public.dividend_payables WHERE id = NEW.payable_id;
  END IF;

  IF v_net_payable IS NOT NULL AND v_net_payable > 0 THEN
    SELECT COALESCE(SUM(p.net_amount), 0) INTO v_active_sum
    FROM public.payments p
    WHERE p.payable_id = NEW.payable_id
      AND p.id IS DISTINCT FROM NEW.id
      AND p.status NOT IN ('Failed', 'Reversed', 'Cancelled');

    IF (v_active_sum + COALESCE(NEW.net_amount, 0)) > (v_net_payable + 0.05) THEN
      RAISE EXCEPTION 'Over-allocation blocked: cumulative active payments (%) exceed payable net_payable (%) for payable %',
        (v_active_sum + COALESCE(NEW.net_amount, 0)), v_net_payable, NEW.payable_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_payment_installment_cap ON public.payments;
CREATE TRIGGER trg_enforce_payment_installment_cap
  BEFORE INSERT OR UPDATE OF payable_id, net_amount, status
  ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_installment_cap();

-- 6. Harden populate_payment_batch_chunk (exclude UNCLASSIFIED & REVIEW_REQUIRED across ALL tables + multi-leg support)
CREATE OR REPLACE FUNCTION public.populate_payment_batch_chunk(
  p_batch_id uuid,
  p_company_id uuid DEFAULT NULL::uuid,
  p_fiscal_year text DEFAULT NULL::text,
  p_payable_type text DEFAULT 'all'::text,
  p_payment_method text DEFAULT 'ConnectIPS'::text,
  p_installment_tag text DEFAULT 'FULL'::text,
  p_limit integer DEFAULT 2500
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt_role text;
  v_is_service boolean := false;
  v_inserted_count bigint := 0;
  v_total_amount numeric := 0;
  v_total_tax numeric := 0;
  v_valid_payment_method public.payment_method;
  v_batch record;
  v_has_more boolean := false;
  v_current_total bigint := 0;
  v_tag_prefix text;
BEGIN
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;
  v_is_service := (current_user IN ('postgres', 'service_role', 'supabase_admin') OR COALESCE(v_jwt_role, '') = 'service_role');

  IF NOT v_is_service THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator');
  END IF;

  SELECT * INTO v_batch FROM public.payment_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch not found.';
  END IF;

  IF NOT v_is_service AND v_batch.company_id IS NOT NULL AND NOT public.has_company_access(v_uid, v_batch.company_id) THEN
    RAISE EXCEPTION 'Unauthorized: caller lacks access to company %', v_batch.company_id USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_valid_payment_method := p_payment_method::public.payment_method;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid payment method: %', p_payment_method USING ERRCODE = '22023';
  END;

  v_tag_prefix := CASE p_installment_tag
    WHEN 'SEMI_1' THEN '[Installment 1 (Poush)] ' || v_batch.batch_name
    WHEN 'SEMI_2' THEN '[Installment 2 (Asar)] ' || v_batch.batch_name
    WHEN 'INTERIM' THEN '[Interim Dividend] ' || v_batch.batch_name
    WHEN 'FINAL' THEN '[Final Dividend] ' || v_batch.batch_name
    ELSE '[' || v_batch.batch_name || ']'
  END;

  PERFORM set_config('app.skip_audit', 'on', true);

  -- 1. Mutual Fund Payables
  IF p_payable_type IS NULL OR p_payable_type = 'all' OR p_payable_type = 'mutual_fund' THEN
    INSERT INTO public.payments (
      batch_id, company_id, client_id, payable_type, payable_id,
      gross_amount, tax_amount, net_amount, paid_amount, payment_method,
      status, bank_name, bank_account_no, remarks, created_by, created_at, updated_at
    )
    SELECT
      p_batch_id, mf.company_id, mf.client_id, 'mutual_fund', mf.id,
      GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0)
        + CASE WHEN COALESCE(mf.net_payable,0) > 0 THEN round(COALESCE(mf.tax_amount,0) * GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) / mf.net_payable, 2) ELSE 0 END,
      CASE WHEN COALESCE(mf.net_payable,0) > 0 THEN round(COALESCE(mf.tax_amount,0) * GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) / mf.net_payable, 2) ELSE 0 END,
      GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0),
      0,
      v_valid_payment_method, 'Pending',
      COALESCE(NULLIF(c.bank_name,''), mf.bank_name),
      COALESCE(NULLIF(c.bank_account_no,''), mf.bank_account_no),
      v_tag_prefix,
      v_uid, NOW(), NOW()
    FROM public.mutual_fund_payables mf
    LEFT JOIN public.clients c ON c.id = mf.client_id
    WHERE
      (v_is_service OR public.has_company_access(v_uid, mf.company_id))
      AND (p_company_id IS NULL OR mf.company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR mf.fiscal_year = p_fiscal_year)
      AND mf.payment_status IN ('Pending', 'Partial')
      AND GREATEST(COALESCE(mf.net_payable,0) - COALESCE(mf.paid_amount,0), 0) > 0
      AND mf.payee_classification <> 'UNCLASSIFIED'
      AND mf.classification_status <> 'REVIEW_REQUIRED'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.payable_id = mf.id
          AND p.status IN ('Draft', 'Pending', 'Approved', 'Processed')
      )
    ORDER BY mf.id ASC
    LIMIT p_limit;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  END IF;

  -- 2. Dividend Payables
  IF (p_payable_type = 'all' OR p_payable_type = 'dividend') AND (p_limit - v_inserted_count > 0) THEN
    DECLARE
      v_div_inserted bigint := 0;
    BEGIN
      INSERT INTO public.payments (
        batch_id, company_id, client_id, payable_type, payable_id,
        gross_amount, tax_amount, net_amount, paid_amount, payment_method,
        status, bank_name, bank_account_no, remarks, created_by, created_at, updated_at
      )
      SELECT
        p_batch_id, dp.company_id, dp.client_id, 'dividend', dp.id,
        GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0)
          + CASE WHEN COALESCE(dp.net_payable,0) > 0 THEN round(COALESCE(dp.tax_amount,0) * GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) / dp.net_payable, 2) ELSE 0 END,
        CASE WHEN COALESCE(dp.net_payable,0) > 0 THEN round(COALESCE(dp.tax_amount,0) * GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) / dp.net_payable, 2) ELSE 0 END,
        GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0),
        0,
        v_valid_payment_method, 'Pending',
        COALESCE(NULLIF(c.bank_name,''), dp.bank_name),
        COALESCE(NULLIF(c.bank_account_no,''), dp.bank_account_no),
        v_tag_prefix,
        v_uid, NOW(), NOW()
      FROM public.dividend_payables dp
      LEFT JOIN public.clients c ON c.id = dp.client_id
      WHERE
        (v_is_service OR public.has_company_access(v_uid, dp.company_id))
        AND (p_company_id IS NULL OR dp.company_id = p_company_id)
        AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR dp.fiscal_year = p_fiscal_year)
        AND dp.payment_status IN ('Pending', 'Partial')
        AND GREATEST(COALESCE(dp.net_payable,0) - COALESCE(dp.paid_amount,0), 0) > 0
        AND dp.payee_classification <> 'UNCLASSIFIED'
        AND dp.classification_status <> 'REVIEW_REQUIRED'
        AND NOT EXISTS (
          SELECT 1 FROM public.payments p
          WHERE p.payable_id = dp.id
            AND p.status IN ('Draft', 'Pending', 'Approved', 'Processed')
        )
      ORDER BY dp.id ASC
      LIMIT (p_limit - v_inserted_count);

      GET DIAGNOSTICS v_div_inserted = ROW_COUNT;
      v_inserted_count := v_inserted_count + v_div_inserted;
    END;
  END IF;

  -- 3. Interest Payables (with SEMI_1 50% tranche support if unpaid)
  IF (p_payable_type = 'all' OR p_payable_type = 'interest') AND (p_limit - v_inserted_count > 0) THEN
    DECLARE
      v_int_inserted bigint := 0;
    BEGIN
      INSERT INTO public.payments (
        batch_id, company_id, client_id, payable_type, payable_id,
        gross_amount, tax_amount, net_amount, paid_amount, payment_method,
        status, bank_name, bank_account_no, remarks, created_by, created_at, updated_at
      )
      SELECT
        p_batch_id,
        ip.company_id,
        ip.client_id,
        'interest',
        ip.id,
        calc.tranche_net + calc.tranche_tax,
        calc.tranche_tax,
        calc.tranche_net,
        0,
        v_valid_payment_method,
        'Pending',
        COALESCE(NULLIF(c.bank_name,''), ip.bank_name),
        COALESCE(NULLIF(c.bank_account_no,''), ip.bank_account_no),
        v_tag_prefix,
        v_uid,
        NOW(),
        NOW()
      FROM public.interest_payables ip
      LEFT JOIN public.clients c ON c.id = ip.client_id
      CROSS JOIN LATERAL (
        SELECT
          GREATEST(COALESCE(ip.net_payable,0) - COALESCE(ip.paid_amount,0), 0) AS rem_net
      ) r
      CROSS JOIN LATERAL (
        SELECT
          CASE
            WHEN p_installment_tag = 'SEMI_1' AND COALESCE(ip.paid_amount, 0) = 0
              THEN round(r.rem_net / 2.0, 2)
            ELSE r.rem_net
          END AS tranche_net,
          CASE
            WHEN COALESCE(ip.net_payable, 0) > 0 THEN
              round(
                COALESCE(ip.tax_amount, 0) * (
                  CASE
                    WHEN p_installment_tag = 'SEMI_1' AND COALESCE(ip.paid_amount, 0) = 0
                      THEN round(r.rem_net / 2.0, 2)
                    ELSE r.rem_net
                  END
                ) / ip.net_payable,
                2
              )
            ELSE 0
          END AS tranche_tax
      ) calc
      WHERE
        (v_is_service OR public.has_company_access(v_uid, ip.company_id))
        AND (p_company_id IS NULL OR ip.company_id = p_company_id)
        AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR ip.fiscal_year = p_fiscal_year)
        AND ip.payment_status IN ('Pending', 'Partial')
        AND r.rem_net > 0
        AND calc.tranche_net > 0
        AND ip.payee_classification <> 'UNCLASSIFIED'
        AND ip.classification_status <> 'REVIEW_REQUIRED'
        AND NOT EXISTS (
          SELECT 1 FROM public.payments p
          WHERE p.payable_id = ip.id
            AND p.status IN ('Draft', 'Pending', 'Approved', 'Processed')
        )
      ORDER BY ip.id ASC
      LIMIT (p_limit - v_inserted_count);

      GET DIAGNOSTICS v_int_inserted = ROW_COUNT;
      v_inserted_count := v_inserted_count + v_int_inserted;
    END;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(net_amount), 0),
    COALESCE(SUM(tax_amount), 0)
  INTO v_current_total, v_total_amount, v_total_tax
  FROM public.payments
  WHERE batch_id = p_batch_id;

  UPDATE public.payment_batches
  SET
    total_payments = v_current_total,
    total_amount = v_total_amount,
    total_tax = v_total_tax,
    updated_at = NOW()
  WHERE id = p_batch_id;

  v_has_more := (v_inserted_count >= p_limit);

  PERFORM set_config('app.skip_audit', 'off', true);

  RETURN json_build_object(
    'batch_id', p_batch_id,
    'inserted_count', v_inserted_count,
    'total_in_batch', v_current_total,
    'total_amount', v_total_amount,
    'has_more', v_has_more
  );
END;
$$;

-- 7. Fix complete_payment_batch_atomic + AFTER UPDATE trigger sync loop + paid_amount=0 bug
CREATE OR REPLACE FUNCTION public.complete_payment_batch_atomic(p_batch_id uuid, p_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $$
DECLARE
  v_batch record;
  v_actor_id uuid;
  v_jwt_role text;
  v_from_trigger boolean := (COALESCE(current_setting('rtarts.from_completion_trigger', true), '') = 'true');
  v_today date := CURRENT_DATE;
  v_payments_updated int := 0;
  v_div_updated int := 0;
  v_int_updated int := 0;
  v_mf_updated int := 0;
BEGIN
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF COALESCE(v_jwt_role, '') <> 'service_role'
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    PERFORM public.require_role('admin', 'supervisor', 'approver');
  END IF;

  v_actor_id := COALESCE(auth.uid(), p_user_id);

  SELECT * INTO v_batch
  FROM public.payment_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment batch with id % not found', p_batch_id;
  END IF;

  -- Skip only when NOT invoked directly from an external status -> Completed transition trigger
  IF v_batch.status = 'Completed' AND NOT v_from_trigger THEN
    RETURN jsonb_build_object(
      'success', true,
      'batch_id', p_batch_id,
      'message', 'Batch is already completed'
    );
  END IF;

  IF COALESCE(v_jwt_role, '') <> 'service_role'
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin')
     AND v_batch.company_id IS NOT NULL
     AND v_actor_id IS NOT NULL THEN
    IF NOT public.has_company_access(v_actor_id, v_batch.company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to company % for payment batch %', v_batch.company_id, p_batch_id USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM set_config('rtarts.completing_batch', 'true', true);

  -- Settle non-finalized payments (fixing COALESCE(0, net_amount) trap via NULLIF(paid_amount, 0))
  WITH updated_payments AS (
    UPDATE public.payments
    SET
      status = 'Completed',
      payment_date = COALESCE(payment_date, v_today),
      paid_amount = COALESCE(NULLIF(paid_amount, 0), net_amount),
      updated_at = NOW()
    WHERE batch_id = p_batch_id
      AND status NOT IN ('Completed', 'Failed', 'Rejected', 'Reversed', 'Cancelled')
    RETURNING id, payable_id, payable_type
  )
  SELECT count(*) INTO v_payments_updated FROM updated_payments;

  -- Recompute cumulative settled totals accurately for dividend_payables
  WITH batch_payables AS (
    SELECT DISTINCT payable_id
    FROM public.payments
    WHERE batch_id = p_batch_id
      AND status = 'Completed'
      AND LOWER(COALESCE(payable_type, '')) IN ('dividend', 'dividend_payables')
      AND payable_id IS NOT NULL
  ),
  settled_sums AS (
    SELECT
      bp.payable_id,
      COALESCE(SUM(COALESCE(NULLIF(p.paid_amount, 0), p.net_amount)), 0) AS total_paid
    FROM batch_payables bp
    JOIN public.payments p ON p.payable_id = bp.payable_id AND p.status = 'Completed'
    GROUP BY bp.payable_id
  ),
  div_matches AS (
    UPDATE public.dividend_payables dp
    SET
      paid_amount = LEAST(dp.net_payable, s.total_paid),
      remaining_amount = GREATEST(0, dp.net_payable - LEAST(dp.net_payable, s.total_paid)),
      payment_status = CASE
        WHEN (dp.net_payable - LEAST(dp.net_payable, s.total_paid)) <= 0.05 THEN 'Paid'::public.payment_status
        WHEN s.total_paid > 0 THEN 'Partial'::public.payment_status
        ELSE 'Pending'::public.payment_status
      END,
      payment_date = COALESCE(dp.payment_date, v_today),
      updated_at = NOW()
    FROM settled_sums s
    WHERE dp.id = s.payable_id
    RETURNING dp.id
  )
  SELECT count(*) INTO v_div_updated FROM div_matches;

  -- Interest payables
  WITH batch_payables AS (
    SELECT DISTINCT payable_id
    FROM public.payments
    WHERE batch_id = p_batch_id
      AND status = 'Completed'
      AND LOWER(COALESCE(payable_type, '')) IN ('interest', 'interest_payables', 'debenture')
      AND payable_id IS NOT NULL
  ),
  settled_sums AS (
    SELECT
      bp.payable_id,
      COALESCE(SUM(COALESCE(NULLIF(p.paid_amount, 0), p.net_amount)), 0) AS total_paid
    FROM batch_payables bp
    JOIN public.payments p ON p.payable_id = bp.payable_id AND p.status = 'Completed'
    GROUP BY bp.payable_id
  ),
  int_matches AS (
    UPDATE public.interest_payables ip
    SET
      paid_amount = LEAST(ip.net_payable, s.total_paid),
      remaining_amount = GREATEST(0, ip.net_payable - LEAST(ip.net_payable, s.total_paid)),
      payment_status = CASE
        WHEN (ip.net_payable - LEAST(ip.net_payable, s.total_paid)) <= 0.05 THEN 'Paid'::public.payment_status
        WHEN s.total_paid > 0 THEN 'Partial'::public.payment_status
        ELSE 'Pending'::public.payment_status
      END,
      payment_date = COALESCE(ip.payment_date, v_today),
      updated_at = NOW()
    FROM settled_sums s
    WHERE ip.id = s.payable_id
    RETURNING ip.id
  )
  SELECT count(*) INTO v_int_updated FROM int_matches;

  -- Mutual fund payables
  WITH batch_payables AS (
    SELECT DISTINCT payable_id
    FROM public.payments
    WHERE batch_id = p_batch_id
      AND status = 'Completed'
      AND LOWER(COALESCE(payable_type, '')) IN ('mutual_fund', 'mutual_fund_payables')
      AND payable_id IS NOT NULL
  ),
  settled_sums AS (
    SELECT
      bp.payable_id,
      COALESCE(SUM(COALESCE(NULLIF(p.paid_amount, 0), p.net_amount)), 0) AS total_paid
    FROM batch_payables bp
    JOIN public.payments p ON p.payable_id = bp.payable_id AND p.status = 'Completed'
    GROUP BY bp.payable_id
  ),
  mf_matches AS (
    UPDATE public.mutual_fund_payables mp
    SET
      paid_amount = LEAST(mp.net_payable, s.total_paid),
      remaining_amount = GREATEST(0, mp.net_payable - LEAST(mp.net_payable, s.total_paid)),
      payment_status = CASE
        WHEN (mp.net_payable - LEAST(mp.net_payable, s.total_paid)) <= 0.05 THEN 'Paid'::public.payment_status
        WHEN s.total_paid > 0 THEN 'Partial'::public.payment_status
        ELSE 'Pending'::public.payment_status
      END,
      payment_date = COALESCE(mp.payment_date, v_today),
      updated_at = NOW()
    FROM settled_sums s
    WHERE mp.id = s.payable_id
    RETURNING mp.id
  )
  SELECT count(*) INTO v_mf_updated FROM mf_matches;

  -- Finalize payment_batches header cleanly
  UPDATE public.payment_batches
  SET
    status = 'Completed',
    processed_at = COALESCE(processed_at, NOW()),
    completed_at = COALESCE(completed_at, NOW()),
    updated_at = NOW()
  WHERE id = p_batch_id;

  PERFORM set_config('rtarts.completing_batch', 'false', true);

  INSERT INTO public.audit_logs (
    user_id, action, table_name, record_id, new_value
  ) VALUES (
    v_actor_id,
    'COMPLETE_BATCH',
    'payment_batches',
    p_batch_id,
    jsonb_build_object(
      'status', 'Completed',
      'payments_updated', v_payments_updated,
      'dividend_updated', v_div_updated,
      'interest_updated', v_int_updated,
      'mutual_fund_updated', v_mf_updated,
      'total_amount', v_batch.total_amount
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'payments_updated', v_payments_updated,
    'dividend_payables_updated', v_div_updated,
    'interest_payables_updated', v_int_updated,
    'mutual_fund_payables_updated', v_mf_updated
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('rtarts.completing_batch', 'false', true);
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_sync_payment_batch_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('rtarts.completing_batch', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'Completed' AND (OLD.status IS NULL OR OLD.status::text <> 'Completed') THEN
    PERFORM set_config('rtarts.from_completion_trigger', 'true', true);
    PERFORM public.complete_payment_batch_atomic(NEW.id, COALESCE(NEW.approved_by, auth.uid()));
    PERFORM set_config('rtarts.from_completion_trigger', 'false', true);
  END IF;
  RETURN NEW;
END;
$$;

-- 8. Fix 3-arg revert_payment_batch_atomic (reset MF paid_amount/remaining_amount & preserve prior completed batches!)
CREATE OR REPLACE FUNCTION public.revert_payment_batch_atomic(
  p_batch_id uuid,
  p_user_id uuid DEFAULT NULL::uuid,
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $$
DECLARE
  v_batch record;
  v_actor_id uuid;
  v_jwt_role text;
  v_div_ids uuid[];
  v_int_ids uuid[];
  v_mf_ids uuid[];
  v_div_count int := 0;
  v_int_count int := 0;
  v_mf_count int := 0;
  v_payments_deleted int := 0;
  v_reverted_payables int := 0;
BEGIN
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF COALESCE(v_jwt_role, '') <> 'service_role'
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    PERFORM public.require_role('admin', 'supervisor');
  END IF;

  v_actor_id := COALESCE(auth.uid(), p_user_id);

  SELECT * INTO v_batch
  FROM public.payment_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment batch with id % not found', p_batch_id;
  END IF;

  IF COALESCE(v_jwt_role, '') <> 'service_role'
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin')
     AND v_batch.company_id IS NOT NULL
     AND v_actor_id IS NOT NULL THEN
    IF NOT public.has_company_access(v_actor_id, v_batch.company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to company % for payment batch %', v_batch.company_id, p_batch_id USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT payable_id), '{}') INTO v_div_ids
  FROM public.payments
  WHERE batch_id = p_batch_id
    AND payable_id IS NOT NULL
    AND LOWER(COALESCE(payable_type, '')) IN ('dividend', 'dividend_payables');

  SELECT COALESCE(array_agg(DISTINCT payable_id), '{}') INTO v_int_ids
  FROM public.payments
  WHERE batch_id = p_batch_id
    AND payable_id IS NOT NULL
    AND LOWER(COALESCE(payable_type, '')) IN ('interest', 'interest_payables', 'debenture');

  SELECT COALESCE(array_agg(DISTINCT payable_id), '{}') INTO v_mf_ids
  FROM public.payments
  WHERE batch_id = p_batch_id
    AND payable_id IS NOT NULL
    AND LOWER(COALESCE(payable_type, '')) IN ('mutual_fund', 'mutual_fund_payables');

  -- Delete batch payment rows FIRST so surviving completed batches sum accurately
  WITH del_pmt AS (
    DELETE FROM public.payments
    WHERE batch_id = p_batch_id
    RETURNING id
  )
  SELECT count(*) INTO v_payments_deleted FROM del_pmt;

  -- Restore dividend payables based on any surviving Completed payments
  IF array_length(v_div_ids, 1) > 0 THEN
    WITH remaining_sums AS (
      SELECT
        u.id AS payable_id,
        COALESCE(SUM(COALESCE(NULLIF(p.paid_amount, 0), p.net_amount)), 0) AS surviving_paid,
        MAX(p.payment_date) AS last_pay_date,
        MAX(p.payment_reference) AS last_pay_ref
      FROM unnest(v_div_ids) AS u(id)
      LEFT JOIN public.payments p
        ON p.payable_id = u.id
       AND p.status = 'Completed'
      GROUP BY u.id
    ),
    upd AS (
      UPDATE public.dividend_payables dp
      SET
        paid_amount = LEAST(dp.net_payable, rs.surviving_paid),
        remaining_amount = GREATEST(0, dp.net_payable - LEAST(dp.net_payable, rs.surviving_paid)),
        payment_status = CASE
          WHEN (dp.net_payable - LEAST(dp.net_payable, rs.surviving_paid)) <= 0.05 AND dp.net_payable > 0 THEN 'Paid'::public.payment_status
          WHEN rs.surviving_paid > 0 THEN 'Partial'::public.payment_status
          ELSE 'Pending'::public.payment_status
        END,
        payment_date = rs.last_pay_date,
        payment_reference = rs.last_pay_ref,
        updated_at = NOW()
      FROM remaining_sums rs
      WHERE dp.id = rs.payable_id
      RETURNING dp.id
    )
    SELECT count(*) INTO v_div_count FROM upd;
    v_reverted_payables := v_reverted_payables + v_div_count;
  END IF;

  -- Restore interest payables
  IF array_length(v_int_ids, 1) > 0 THEN
    WITH remaining_sums AS (
      SELECT
        u.id AS payable_id,
        COALESCE(SUM(COALESCE(NULLIF(p.paid_amount, 0), p.net_amount)), 0) AS surviving_paid,
        MAX(p.payment_date) AS last_pay_date,
        MAX(p.payment_reference) AS last_pay_ref
      FROM unnest(v_int_ids) AS u(id)
      LEFT JOIN public.payments p
        ON p.payable_id = u.id
       AND p.status = 'Completed'
      GROUP BY u.id
    ),
    upd AS (
      UPDATE public.interest_payables ip
      SET
        paid_amount = LEAST(ip.net_payable, rs.surviving_paid),
        remaining_amount = GREATEST(0, ip.net_payable - LEAST(ip.net_payable, rs.surviving_paid)),
        payment_status = CASE
          WHEN (ip.net_payable - LEAST(ip.net_payable, rs.surviving_paid)) <= 0.05 AND ip.net_payable > 0 THEN 'Paid'::public.payment_status
          WHEN rs.surviving_paid > 0 THEN 'Partial'::public.payment_status
          ELSE 'Pending'::public.payment_status
        END,
        payment_date = rs.last_pay_date,
        payment_reference = rs.last_pay_ref,
        updated_at = NOW()
      FROM remaining_sums rs
      WHERE ip.id = rs.payable_id
      RETURNING ip.id
    )
    SELECT count(*) INTO v_int_count FROM upd;
    v_reverted_payables := v_reverted_payables + v_int_count;
  END IF;

  -- Restore mutual fund payables (including paid_amount & remaining_amount!)
  IF array_length(v_mf_ids, 1) > 0 THEN
    WITH remaining_sums AS (
      SELECT
        u.id AS payable_id,
        COALESCE(SUM(COALESCE(NULLIF(p.paid_amount, 0), p.net_amount)), 0) AS surviving_paid,
        MAX(p.payment_date) AS last_pay_date,
        MAX(p.payment_reference) AS last_pay_ref
      FROM unnest(v_mf_ids) AS u(id)
      LEFT JOIN public.payments p
        ON p.payable_id = u.id
       AND p.status = 'Completed'
      GROUP BY u.id
    ),
    upd AS (
      UPDATE public.mutual_fund_payables mp
      SET
        paid_amount = LEAST(mp.net_payable, rs.surviving_paid),
        remaining_amount = GREATEST(0, mp.net_payable - LEAST(mp.net_payable, rs.surviving_paid)),
        payment_status = CASE
          WHEN (mp.net_payable - LEAST(mp.net_payable, rs.surviving_paid)) <= 0.05 AND mp.net_payable > 0 THEN 'Paid'::public.payment_status
          WHEN rs.surviving_paid > 0 THEN 'Partial'::public.payment_status
          ELSE 'Pending'::public.payment_status
        END,
        payment_date = rs.last_pay_date,
        payment_reference = rs.last_pay_ref,
        updated_at = NOW()
      FROM remaining_sums rs
      WHERE mp.id = rs.payable_id
      RETURNING mp.id
    )
    SELECT count(*) INTO v_mf_count FROM upd;
    v_reverted_payables := v_reverted_payables + v_mf_count;
  END IF;

  DELETE FROM public.payment_batches WHERE id = p_batch_id;

  INSERT INTO public.audit_logs (
    user_id, action, table_name, record_id, new_value
  ) VALUES (
    v_actor_id,
    'REVERT_PAYMENT_BATCH',
    'payment_batches',
    p_batch_id,
    jsonb_build_object(
      'batch_name', v_batch.batch_name,
      'reverted_payables', v_reverted_payables,
      'payments_deleted', v_payments_deleted,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'reverted_payables', v_reverted_payables,
    'payments_deleted', v_payments_deleted
  );
END;
$$;

-- 9. Fix sync_all_classifications_and_taxes(): enforce roles, never mutate non-Pending rows, use payable_tax_rules & bonus_tax
CREATE OR REPLACE FUNCTION public.sync_all_classifications_and_taxes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_jwt_role text;
  v_clients_updated int := 0;
  v_interest_updated int := 0;
  v_dividend_updated int := 0;
  v_mf_updated int := 0;
BEGIN
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF COALESCE(v_jwt_role, '') <> 'service_role'
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    PERFORM public.require_role('admin', 'supervisor');
  END IF;

  -- Only backfill non-confirmed MUTUAL_FUND/TAX_EXEMPT client names when unclassified or mismatched
  UPDATE public.clients
  SET
    payee_classification = 'TAX_EXEMPT',
    holder_type = 'Mutual Fund'::public.holder_type,
    classification_status = 'AUTO_CLASSIFIED'
  WHERE
    classification_status <> 'CONFIRMED'
    AND payee_classification <> 'TAX_EXEMPT'
    AND (full_name ~* '\y(MUTUAL\s*FUND|MF|80[-/:]?20|FOCUS\s*(FUND|SCHEME|\d+)|SELECT\s*(FUND|SCHEME|\d+)|SUPER\s*(FUND|SCHEME|\d+)|NMB\s*\d+|SAMRIDDHI\s*(FUND|YOJANA|SCHEME)|PRAGATI\s*(FUND|SCHEME|YOJANA)|SAHABHAGITA\s*(FUND|SCHEME|YOJANA)|DHANABRIDDHI\s*(YOJANA|FUND)|SABAL\s*(FUND|YOJANA|SCHEME)|UNNATI\s*(FUND|KOSH|SCHEME)|SARAL\s*(BACHAT|FUND|YOJANA)|AWAKASH\s*(KOSH|FUND)|RETIREMENT\s*(FUND|TRUST)|PROVIDENT\s*FUND|KARMACHARI\s*SANCHAYA\s*KOSH)\y')
    AND full_name !~* '\y(ARMY\s*WELFARE|SAINIK\s*KALYAN|POLICE\s*WELFARE|PRAHARI\s*KALYAN)\y';
  GET DIAGNOSTICS v_clients_updated = ROW_COUNT;

  -- Sync Pending interest_payables using authoritative payable_tax_rules
  UPDATE public.interest_payables ip
  SET
    payee_classification = COALESCE(NULLIF(c.payee_classification, 'UNCLASSIFIED'), ip.payee_classification),
    tds_rate = r.tax_rate,
    tax_amount = round(COALESCE(ip.gross_interest, 0) * r.tax_rate, 2),
    net_payable = GREATEST(0, round(COALESCE(ip.gross_interest, 0) - round(COALESCE(ip.gross_interest, 0) * r.tax_rate, 2), 2)),
    remaining_amount = GREATEST(0, round(COALESCE(ip.gross_interest, 0) - round(COALESCE(ip.gross_interest, 0) * r.tax_rate, 2) - COALESCE(ip.paid_amount, 0), 2)),
    updated_at = now()
  FROM public.clients c
  JOIN public.payable_tax_rules r
    ON r.payable_category = 'INTEREST'
   AND r.payee_classification = c.payee_classification
   AND r.is_active
  WHERE ip.client_id = c.id
    AND ip.payment_status = 'Pending'
    AND COALESCE(ip.is_tax_manual, false) = false
    AND c.payee_classification <> 'UNCLASSIFIED';
  GET DIAGNOSTICS v_interest_updated = ROW_COUNT;

  -- Sync Pending dividend_payables using authoritative payable_tax_rules + bonus_tax deduction
  UPDATE public.dividend_payables dp
  SET
    payee_classification = COALESCE(NULLIF(c.payee_classification, 'UNCLASSIFIED'), dp.payee_classification),
    tds_rate = r.tax_rate,
    tax_amount = round(COALESCE(dp.gross_dividend, 0) * r.tax_rate, 2),
    net_payable = GREATEST(
      0,
      round(
        COALESCE(dp.gross_dividend, 0)
        - round(COALESCE(dp.gross_dividend, 0) * r.tax_rate, 2)
        - CASE WHEN COALESCE(dp.bonus_tax_mode, 'CASH_ADJUSTED') = 'CASH_ADJUSTED' THEN COALESCE(dp.bonus_tax, 0) ELSE 0 END,
        2
      )
    ),
    remaining_amount = GREATEST(
      0,
      round(
        COALESCE(dp.gross_dividend, 0)
        - round(COALESCE(dp.gross_dividend, 0) * r.tax_rate, 2)
        - CASE WHEN COALESCE(dp.bonus_tax_mode, 'CASH_ADJUSTED') = 'CASH_ADJUSTED' THEN COALESCE(dp.bonus_tax, 0) ELSE 0 END
        - COALESCE(dp.paid_amount, 0),
        2
      )
    ),
    updated_at = now()
  FROM public.clients c
  JOIN public.payable_tax_rules r
    ON r.payable_category = 'DIVIDEND'
   AND r.payee_classification = c.payee_classification
   AND r.is_active
  WHERE dp.client_id = c.id
    AND dp.payment_status = 'Pending'
    AND COALESCE(dp.is_tax_manual, false) = false
    AND c.payee_classification <> 'UNCLASSIFIED';
  GET DIAGNOSTICS v_dividend_updated = ROW_COUNT;

  -- Sync Pending mutual_fund_payables using authoritative payable_tax_rules + bonus_tax deduction
  UPDATE public.mutual_fund_payables mp
  SET
    payee_classification = COALESCE(NULLIF(c.payee_classification, 'UNCLASSIFIED'), mp.payee_classification),
    tds_rate = r.tax_rate,
    tax_amount = round(COALESCE(mp.gross_dividend, 0) * r.tax_rate, 2),
    net_payable = GREATEST(
      0,
      round(
        COALESCE(mp.gross_dividend, 0)
        - round(COALESCE(mp.gross_dividend, 0) * r.tax_rate, 2)
        - CASE WHEN COALESCE(mp.bonus_tax_mode, 'CASH_ADJUSTED') = 'CASH_ADJUSTED' THEN COALESCE(mp.bonus_tax, 0) ELSE 0 END,
        2
      )
    ),
    remaining_amount = GREATEST(
      0,
      round(
        COALESCE(mp.gross_dividend, 0)
        - round(COALESCE(mp.gross_dividend, 0) * r.tax_rate, 2)
        - CASE WHEN COALESCE(mp.bonus_tax_mode, 'CASH_ADJUSTED') = 'CASH_ADJUSTED' THEN COALESCE(mp.bonus_tax, 0) ELSE 0 END
        - COALESCE(mp.paid_amount, 0),
        2
      )
    ),
    updated_at = now()
  FROM public.clients c
  JOIN public.payable_tax_rules r
    ON r.payable_category = 'MUTUAL_FUND'
   AND r.payee_classification = c.payee_classification
   AND r.is_active
  WHERE mp.client_id = c.id
    AND mp.payment_status = 'Pending'
    AND COALESCE(mp.is_tax_manual, false) = false
    AND c.payee_classification <> 'UNCLASSIFIED';
  GET DIAGNOSTICS v_mf_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'clients_updated', v_clients_updated,
    'interest_updated', v_interest_updated,
    'dividend_updated', v_dividend_updated,
    'mutual_fund_updated', v_mf_updated
  );
END;
$$;

-- 10. Fix SQL lint errors in get_declaration_summary and get_mutual_fund_schemes_summary
CREATE OR REPLACE FUNCTION public.get_declaration_summary(p_declaration_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt_role text;
  v_is_service boolean := false;
  v_declaration record;
  v_total_payables int := 0;
  v_gross_amt numeric(15,2) := 0;
  v_tax_amt numeric(15,2) := 0;
  v_net_amt numeric(15,2) := 0;
  v_paid_amt numeric(15,2) := 0;
  v_remaining_amt numeric(15,2) := 0;
  v_failed_amt numeric(15,2) := 0;
  v_paid_count int := 0;
  v_partial_count int := 0;
  v_unpaid_count int := 0;
  v_failed_count int := 0;
  v_batches_count int := 0;
  v_decl_type text;
BEGIN
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;
  v_is_service := (current_user IN ('postgres', 'service_role', 'supabase_admin') OR COALESCE(v_jwt_role, '') = 'service_role');

  IF NOT v_is_service THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer', 'checker', 'approver', 'operator', 'maker', 'auditor', 'report_viewer', 'read_only');
  END IF;

  SELECT * INTO v_declaration FROM public.corporate_declarations WHERE id = p_declaration_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Declaration not found');
  END IF;

  IF NOT v_is_service AND v_declaration.company_id IS NOT NULL
     AND NOT public.has_company_access(v_uid, v_declaration.company_id) THEN
    RAISE EXCEPTION 'Unauthorized: caller lacks access to company %', v_declaration.company_id USING ERRCODE = '42501';
  END IF;

  v_decl_type := LOWER(COALESCE(v_declaration.declaration_type, ''));

  IF v_decl_type IN ('mutual_fund', 'mutual fund') THEN
    SELECT
      COUNT(*),
      COALESCE(SUM(gross_dividend), 0),
      COALESCE(SUM(tax_amount), 0),
      COALESCE(SUM(net_payable), 0),
      COALESCE(SUM(paid_amount), 0),
      COALESCE(SUM(remaining_amount), 0),
      0::numeric(15,2),
      COUNT(CASE WHEN payment_status = 'Paid' THEN 1 END),
      COUNT(CASE WHEN payment_status = 'Partial' THEN 1 END),
      COUNT(CASE WHEN payment_status = 'Pending' THEN 1 END),
      0
    INTO
      v_total_payables, v_gross_amt, v_tax_amt, v_net_amt, v_paid_amt, v_remaining_amt, v_failed_amt,
      v_paid_count, v_partial_count, v_unpaid_count, v_failed_count
    FROM public.mutual_fund_payables
    WHERE declaration_id = p_declaration_id
       OR (declaration_id IS NULL AND company_id = v_declaration.company_id AND fiscal_year = v_declaration.fiscal_year);
  ELSIF v_decl_type = 'dividend' THEN
    SELECT
      COUNT(*),
      COALESCE(SUM(gross_dividend), 0),
      COALESCE(SUM(tax_amount), 0),
      COALESCE(SUM(net_payable), 0),
      COALESCE(SUM(paid_amount), 0),
      COALESCE(SUM(remaining_amount), 0),
      COALESCE(SUM(CASE WHEN returned_status IS NOT NULL AND returned_status <> '' THEN net_payable ELSE 0 END), 0),
      COUNT(CASE WHEN payment_status = 'Paid' THEN 1 END),
      COUNT(CASE WHEN payment_status = 'Partial' THEN 1 END),
      COUNT(CASE WHEN payment_status = 'Pending' AND (returned_status IS NULL OR returned_status = '') THEN 1 END),
      COUNT(CASE WHEN returned_status IS NOT NULL AND returned_status <> '' THEN 1 END)
    INTO
      v_total_payables, v_gross_amt, v_tax_amt, v_net_amt, v_paid_amt, v_remaining_amt, v_failed_amt,
      v_paid_count, v_partial_count, v_unpaid_count, v_failed_count
    FROM public.dividend_payables
    WHERE declaration_id = p_declaration_id
       OR (declaration_id IS NULL AND company_id = v_declaration.company_id AND fiscal_year = v_declaration.fiscal_year);
  ELSE
    -- Interest payables do not carry returned_status; check failed/reversed settlements on payments
    WITH scoped_int AS (
      SELECT
        ip.id,
        ip.gross_interest,
        ip.tax_amount,
        ip.net_payable,
        ip.paid_amount,
        ip.remaining_amount,
        ip.payment_status,
        EXISTS (
          SELECT 1 FROM public.payments p
          WHERE p.payable_id = ip.id AND p.status IN ('Failed', 'Rejected', 'Reversed')
        ) AS has_return_failure
      FROM public.interest_payables ip
      WHERE ip.declaration_id = p_declaration_id
         OR (ip.declaration_id IS NULL AND ip.company_id = v_declaration.company_id AND ip.fiscal_year = v_declaration.fiscal_year)
    )
    SELECT
      COUNT(*),
      COALESCE(SUM(gross_interest), 0),
      COALESCE(SUM(tax_amount), 0),
      COALESCE(SUM(net_payable), 0),
      COALESCE(SUM(paid_amount), 0),
      COALESCE(SUM(remaining_amount), 0),
      COALESCE(SUM(CASE WHEN has_return_failure THEN net_payable ELSE 0 END), 0),
      COUNT(CASE WHEN payment_status = 'Paid' THEN 1 END),
      COUNT(CASE WHEN payment_status = 'Partial' THEN 1 END),
      COUNT(CASE WHEN payment_status = 'Pending' AND NOT has_return_failure THEN 1 END),
      COUNT(CASE WHEN has_return_failure THEN 1 END)
    INTO
      v_total_payables, v_gross_amt, v_tax_amt, v_net_amt, v_paid_amt, v_remaining_amt, v_failed_amt,
      v_paid_count, v_partial_count, v_unpaid_count, v_failed_count
    FROM scoped_int;
  END IF;

  SELECT COUNT(*) INTO v_batches_count
  FROM public.payment_batches
  WHERE declaration_id = p_declaration_id
     OR (declaration_id IS NULL AND company_id = v_declaration.company_id AND fiscal_year = v_declaration.fiscal_year);

  RETURN jsonb_build_object(
    'declaration_id', v_declaration.id,
    'declaration_code', v_declaration.declaration_code,
    'declaration_type', v_declaration.declaration_type,
    'sub_type', v_declaration.sub_type,
    'fiscal_year', v_declaration.fiscal_year,
    'declaration_date', v_declaration.declaration_date,
    'record_date', v_declaration.record_date,
    'payment_due_date', v_declaration.payment_due_date,
    'rate_per_share', v_declaration.rate_per_share,
    'total_declared_amount', v_declaration.total_declared_amount,
    'total_payables_count', v_total_payables,
    'gross_amount', v_gross_amt,
    'tax_amount', v_tax_amt,
    'net_payable_amount', v_net_amt,
    'paid_amount', v_paid_amt,
    'remaining_amount', v_remaining_amt,
    'failed_amount', v_failed_amt,
    'paid_count', v_paid_count,
    'partial_count', v_partial_count,
    'unpaid_count', v_unpaid_count,
    'failed_count', v_failed_count,
    'batches_count', v_batches_count,
    'progress_percent', CASE WHEN v_net_amt > 0 THEN ROUND((v_paid_amt / v_net_amt) * 100, 2) ELSE 0 END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_mutual_fund_schemes_summary(p_fiscal_year text DEFAULT 'all'::text)
RETURNS TABLE(
  company_id uuid,
  company_name text,
  company_code text,
  unitholders bigint,
  kitta numeric,
  gross numeric,
  tax numeric,
  net numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt_role text;
  v_is_service boolean := false;
  v_is_global_access boolean := false;
  v_user_companies uuid[];
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);

  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;
  v_is_service := (session_user IN ('postgres', 'service_role', 'supabase_admin') OR COALESCE(v_jwt_role, '') = 'service_role');

  IF NOT v_is_service THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'auditor', 'report_viewer', 'read_only');
  END IF;

  IF v_is_service OR (
    v_uid IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = v_uid
        AND ur.role IN ('admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role, 'report_viewer'::public.app_role, 'read_only'::public.app_role)
    )
  ) THEN
    v_is_global_access := true;
  ELSE
    SELECT COALESCE(array_agg(uca.company_id), '{}')
    INTO v_user_companies
    FROM public.user_company_access uca
    WHERE uca.user_id = v_uid;
  END IF;

  RETURN QUERY
  SELECT
    c.id AS company_id,
    c.company_name,
    c.company_code,
    COUNT(*)::bigint AS unitholders,
    COALESCE(SUM(m.shares_held), 0)::numeric AS kitta,
    COALESCE(SUM(m.gross_dividend), 0)::numeric AS gross,
    COALESCE(SUM(m.tax_amount), 0)::numeric AS tax,
    COALESCE(SUM(m.net_payable), 0)::numeric AS net
  FROM public.mutual_fund_payables m
  JOIN public.companies c ON m.company_id = c.id
  WHERE
    (v_is_global_access OR m.company_id = ANY(v_user_companies))
    AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR p_fiscal_year = '' OR m.fiscal_year = p_fiscal_year)
  GROUP BY c.id, c.company_name, c.company_code
  ORDER BY c.company_name ASC;
END;
$$;

-- 11. Fix bulk_upsert_company (%d% bug + auth guard) and get_agm_dividend_summary (bonus rate + 4dp precision + auth)
CREATE OR REPLACE FUNCTION public.bulk_upsert_company(
  p_company_name text,
  p_company_code text,
  p_isin text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt_role text;
  v_is_service boolean := false;
  v_company_id uuid;
  v_clean_isin text := NULLIF(trim(COALESCE(p_isin, '')), '');
  v_clean_name text := trim(p_company_name);
  v_clean_code text := trim(p_company_code);
  v_default_face_value numeric := 100;
BEGIN
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;
  v_is_service := (current_user IN ('postgres', 'service_role', 'supabase_admin') OR COALESCE(v_jwt_role, '') = 'service_role');

  IF NOT v_is_service THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');
  END IF;

  -- Accurate instrument face value detection (never treat every code containing letter 'd' like ADBL/HIDCL as a debenture)
  IF (v_clean_name ~* '(debenture|bond|rinpatra)' OR v_clean_code ~* '^(RBB|NBL|PBL|GBIME|SCB|HBL|NICA)?D[0-9]{2,4}$|DEB') THEN
    v_default_face_value := 1000;
  ELSIF (v_clean_name ~* 'mutual\s*fund' OR v_clean_code ~* '^RMF|MF\d*$') THEN
    v_default_face_value := 10;
  END IF;

  IF v_clean_isin IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies WHERE isin = v_clean_isin LIMIT 1;
  END IF;

  IF v_company_id IS NULL AND v_clean_code <> '' THEN
    SELECT id INTO v_company_id FROM public.companies WHERE company_code = v_clean_code LIMIT 1;
  END IF;

  IF v_company_id IS NULL THEN
    SELECT id INTO v_company_id FROM public.companies
    WHERE company_name ILIKE '%' || v_clean_name || '%'
       OR v_clean_name ILIKE '%' || company_name || '%'
    LIMIT 1;
  END IF;

  IF v_company_id IS NOT NULL THEN
    IF NOT v_is_service AND NOT public.has_company_access(v_uid, v_company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to company %', v_company_id USING ERRCODE = '42501';
    END IF;
    IF v_clean_isin IS NOT NULL THEN
      UPDATE public.companies
      SET isin = COALESCE(isin, v_clean_isin)
      WHERE id = v_company_id AND (isin IS NULL OR isin = '');
    END IF;
  ELSE
    INSERT INTO public.companies (
      company_name, company_code, isin, face_value, registrar, status, created_by
    )
    VALUES (
      v_clean_name, v_clean_code, v_clean_isin, v_default_face_value,
      'RBB Merchant Banking Limited', 'Active', v_uid
    )
    ON CONFLICT (company_code) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      isin = COALESCE(public.companies.isin, EXCLUDED.isin),
      face_value = COALESCE(public.companies.face_value, EXCLUDED.face_value),
      registrar = COALESCE(public.companies.registrar, EXCLUDED.registrar)
    RETURNING id INTO v_company_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'company_id', v_company_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_agm_dividend_summary(
  p_company_id uuid DEFAULT NULL::uuid,
  p_fiscal_year text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt_role text;
  v_is_service boolean := false;
  v_res jsonb;
BEGIN
  BEGIN
    v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;
  v_is_service := (current_user IN ('postgres', 'service_role', 'supabase_admin') OR COALESCE(v_jwt_role, '') = 'service_role');

  IF NOT v_is_service THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'auditor', 'report_viewer', 'read_only');
    IF p_company_id IS NOT NULL AND NOT public.has_company_access(v_uid, p_company_id) THEN
      RAISE EXCEPTION 'Unauthorized: caller lacks access to company %', p_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  WITH filtered AS (
    SELECT
      dp.shares_held,
      dp.dividend_rate,
      COALESCE(dp.bonus_rate, 0)         AS bonus_rate,
      COALESCE(dp.gross_dividend, 0)     AS gross_dividend,
      COALESCE(dp.tax_amount, 0)         AS tax_amount,
      COALESCE(dp.net_payable, 0)        AS net_payable,
      COALESCE(dp.bonus_actual, 0)       AS bonus_actual,
      COALESCE(dp.bonus_issued, 0)       AS bonus_issued,
      COALESCE(dp.bonus_fraction, 0)     AS bonus_fraction,
      COALESCE(dp.after_bonus_kitta, dp.shares_held + COALESCE(dp.bonus_issued, 0)) AS after_bonus_kitta,
      COALESCE(dp.bonus_tax, 0)          AS bonus_tax,
      CASE
        WHEN UPPER(COALESCE(dp.payee_segment, '')) = 'PROMOTER' OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%PROMOT%' THEN 'PROMOTER'
        WHEN UPPER(COALESCE(dp.payee_segment, '')) = 'LOCAL' OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%LOCAL%' OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%UNVERIFIED%' THEN 'LOCAL'
        WHEN UPPER(COALESCE(dp.payee_segment, '')) = 'EMPLOYEE' OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%STAFF%' OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%EMPLOYEE%' THEN 'EMPLOYEE'
        WHEN dp.payee_classification = 'TAX_EXEMPT' OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%MUTUAL%' OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%EXEMPT%' THEN 'MUTUAL FUND'
        WHEN dp.payee_classification = 'COMPANY_INSTITUTION' OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%INSTITUT%' OR UPPER(COALESCE(dp.lot_name, '')) LIKE '%COMPANY%' THEN 'INSTITUTION'
        ELSE 'PUBLIC'
      END AS particular
    FROM public.dividend_payables dp
    WHERE (v_is_service OR public.has_company_access(v_uid, dp.company_id))
      AND (p_company_id IS NULL OR dp.company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR dp.fiscal_year = p_fiscal_year)
  ),
  grand_totals AS (
    SELECT
      COALESCE(SUM(shares_held), 0) AS grand_kitta,
      COALESCE(MAX(dividend_rate), 0) AS detected_div_rate,
      COALESCE(MAX(bonus_rate), 0) AS detected_bonus_rate
    FROM filtered
  ),
  cat_agg AS (
    SELECT
      particular,
      COUNT(*)::bigint AS shareholder_count,
      ROUND(COALESCE(SUM(shares_held), 0)::numeric, 4) AS kitta,
      ROUND(COALESCE(SUM(bonus_actual), 0)::numeric, 4) AS actual_bonus,
      ROUND(COALESCE(SUM(bonus_issued), 0)::numeric, 4) AS issued_bonus,
      ROUND(COALESCE(SUM(bonus_fraction), 0)::numeric, 4) AS rem_fraction,
      ROUND(COALESCE(SUM(after_bonus_kitta), 0)::numeric, 4) AS after_bonus_kitta,
      ROUND(COALESCE(SUM(gross_dividend), 0)::numeric, 2) AS gross_dividend,
      ROUND(COALESCE(SUM(bonus_tax), 0)::numeric, 2) AS bon_tax,
      ROUND(COALESCE(SUM(tax_amount), 0)::numeric, 2) AS div_tax,
      ROUND(COALESCE(SUM(net_payable), 0)::numeric, 2) AS net_dividend,
      CASE particular
        WHEN 'PROMOTER' THEN 1 WHEN 'PUBLIC' THEN 2 WHEN 'LOCAL' THEN 3
        WHEN 'INSTITUTION' THEN 4 WHEN 'MUTUAL FUND' THEN 5 WHEN 'EMPLOYEE' THEN 6 ELSE 7
      END AS sort_order
    FROM filtered
    GROUP BY particular
  ),
  cat_numbered AS (
    SELECT
      ROW_NUMBER() OVER (ORDER BY sort_order) AS sn,
      particular, shareholder_count, kitta, actual_bonus, issued_bonus, rem_fraction,
      after_bonus_kitta, gross_dividend, bon_tax, div_tax, net_dividend,
      ROUND(CASE WHEN (SELECT grand_kitta FROM grand_totals) > 0 THEN (kitta / (SELECT grand_kitta FROM grand_totals)) * 100 ELSE 0 END, 2) AS composition,
      sort_order
    FROM cat_agg
  ),
  totals AS (
    SELECT
      COUNT(*)::bigint AS shareholder_count,
      ROUND(COALESCE(SUM(shares_held), 0)::numeric, 4) AS kitta,
      ROUND(COALESCE(SUM(bonus_actual), 0)::numeric, 4) AS actual_bonus,
      ROUND(COALESCE(SUM(bonus_issued), 0)::numeric, 4) AS issued_bonus,
      ROUND(COALESCE(SUM(bonus_fraction), 0)::numeric, 4) AS rem_fraction,
      ROUND(COALESCE(SUM(after_bonus_kitta), 0)::numeric, 4) AS after_bonus_kitta,
      ROUND(COALESCE(SUM(gross_dividend), 0)::numeric, 2) AS gross_dividend,
      ROUND(COALESCE(SUM(bonus_tax), 0)::numeric, 2) AS bon_tax,
      ROUND(COALESCE(SUM(tax_amount), 0)::numeric, 2) AS div_tax,
      ROUND(COALESCE(SUM(net_payable), 0)::numeric, 2) AS net_dividend
    FROM filtered
  ),
  company_meta AS (
    SELECT COALESCE(c.company_name, 'All Companies') AS company_name, COALESCE(c.company_code, '') AS company_code
    FROM public.companies c WHERE p_company_id IS NOT NULL AND c.id = p_company_id LIMIT 1
  ),
  first_fiscal AS (
    SELECT fiscal_year FROM public.dividend_payables
    WHERE (v_is_service OR public.has_company_access(v_uid, company_id))
      AND (p_company_id IS NULL OR company_id = p_company_id)
      AND (p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR fiscal_year = p_fiscal_year)
      AND fiscal_year IS NOT NULL LIMIT 1
  ),
  rows_json AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'sn', sn, 'particular', particular, 'shareholderCount', shareholder_count,
        'kitta', kitta, 'actualBonus', actual_bonus,
        'bonusRate', (SELECT detected_bonus_rate FROM grand_totals),
        'issuedBonus', issued_bonus, 'remFraction', rem_fraction,
        'afterBonusKitta', after_bonus_kitta, 'grossDividend', gross_dividend,
        'dividendRate', (SELECT detected_div_rate FROM grand_totals),
        'bonTax', bon_tax, 'divTax', div_tax, 'netDividend', net_dividend,
        'composition', composition
      ) ORDER BY sort_order
    ) AS rows_data FROM cat_numbered
  )
  SELECT jsonb_build_object(
    'companyName', COALESCE((SELECT company_name FROM company_meta), 'All Companies'),
    'companyCode', COALESCE((SELECT company_code FROM company_meta), ''),
    'fiscalYear', COALESCE(p_fiscal_year, (SELECT fiscal_year FROM first_fiscal), ''),
    'detectedBonusRate', (SELECT detected_bonus_rate FROM grand_totals),
    'detectedDividendRate', (SELECT detected_div_rate FROM grand_totals),
    'rows', COALESCE((SELECT rows_data FROM rows_json), '[]'::jsonb),
    'total', (
      SELECT jsonb_build_object(
        'shareholderCount', shareholder_count, 'kitta', kitta, 'actualBonus', actual_bonus,
        'issuedBonus', issued_bonus, 'remFraction', rem_fraction, 'afterBonusKitta', after_bonus_kitta,
        'grossDividend', gross_dividend, 'bonTax', bon_tax, 'divTax', div_tax, 'netDividend', net_dividend,
        'composition', 100.00
      ) FROM totals
    )
  ) INTO v_res;

  RETURN v_res;
END;
$$;

-- 12. Update commit_staged_import to propagate declaration_id, bonus_tax, and bonus_tax_mode
CREATE OR REPLACE FUNCTION public.commit_staged_import(p_approval_id uuid, p_checker_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_staged public.import_staging%ROWTYPE;
  v_approval public.pending_approvals%ROWTYPE;
  v_user_id uuid := auth.uid();
  v_is_authorized boolean := false;
  v_upload_id uuid;
  v_row jsonb;
  v_boid text;
  v_client_code text;
  v_client_name text;
  v_bank_name text;
  v_bank_account text;
  v_client_id uuid;
  v_shares_held numeric;
  v_dividend_rate numeric;
  v_bonus_rate numeric;
  v_gross numeric;
  v_tax numeric;
  v_bonus_tax numeric;
  v_net numeric;
  v_fiscal_year text;
  v_dividend_type text;
  v_declaration_id uuid;
  v_bonus_tax_mode text;
  v_inserted_count integer := 0;
  v_raw_holder_type text;
  v_raw_classification text;
  v_payee_classification text;
  v_holder_type public.holder_type;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: User must be signed in to commit staged imports';
  END IF;

  SELECT * INTO v_approval FROM public.pending_approvals WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending approval record % not found', p_approval_id;
  END IF;
  IF v_approval.status <> 'Pending' THEN
    RAISE EXCEPTION 'Approval ticket is already %', v_approval.status;
  END IF;
  IF v_approval.requested_by = v_user_id THEN
    RAISE EXCEPTION 'Segregation of duties violation: Maker cannot approve their own material import';
  END IF;

  SELECT public.has_any_role(v_user_id, ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
  INTO v_is_authorized;
  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Checker role required to approve material imports';
  END IF;

  SELECT * INTO v_staged FROM public.import_staging WHERE approval_id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staged import data for approval % not found', p_approval_id;
  END IF;
  IF v_staged.status <> 'STAGED' THEN
    RAISE EXCEPTION 'Staged import has already been %', v_staged.status;
  END IF;

  IF NOT public.has_company_access(v_user_id, v_staged.company_id)
     AND NOT public.has_any_role(v_user_id, ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) THEN
    RAISE EXCEPTION 'Unauthorized: Checker has no access to target company';
  END IF;

  INSERT INTO public.upload_history (
    user_id, file_name, file_size, file_hash, file_type, sheet_name,
    total_rows, success_rows, error_rows, target_table, status, started_at, completed_at, created_at
  ) VALUES (
    v_staged.created_by, v_staged.file_name, 0, v_staged.file_hash,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    v_staged.sheet_name, jsonb_array_length(v_staged.staged_rows), 0, 0,
    v_staged.target_table, 'Processing', now(), NULL, now()
  )
  RETURNING id INTO v_upload_id;

  v_fiscal_year := COALESCE(v_staged.options->>'fiscalYear', '2080/81');
  v_dividend_type := COALESCE(v_staged.options->>'dividendType', 'Cash');
  v_dividend_rate := COALESCE(NULLIF(v_staged.options->>'dividendRate', '')::numeric, 0);
  v_bonus_rate := COALESCE(NULLIF(v_staged.options->>'bonusRate', '')::numeric, 0);
  v_declaration_id := NULLIF(v_staged.options->>'declarationId', '')::uuid;
  v_bonus_tax_mode := COALESCE(NULLIF(v_staged.options->>'bonusTaxMode', ''), 'CASH_ADJUSTED');

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_staged.staged_rows)
  LOOP
    v_boid := COALESCE(
      v_row->>'boid', v_row->>'BOID', v_row->>'boid_no', v_row->>'BOID_NO',
      v_row->>'BENEFICIARY ID', v_row->>'folio', v_row->>'FOLIO',
      v_row->>'folio_no', v_row->>'FOLIO_NO', v_row->>'sh_no', v_row->>'SH_NO',
      v_row->>'shareholder_no', v_row->>'client_code', v_row->>'ClientCode', v_row->>'client_id'
    );
    IF v_boid IS NULL OR length(trim(v_boid)) < 1 THEN
      CONTINUE;
    END IF;
    v_boid := trim(v_boid);
    v_client_name := COALESCE(v_row->>'name', v_row->>'shareholder_name', v_row->>'NAME', v_row->>'SHAREHOLDER NAME', v_row->>'investor_name', 'Shareholder ' || v_boid);
    v_client_code := COALESCE(v_row->>'client_code', v_row->>'ClientCode', v_row->>'client_id', v_boid);
    v_bank_name := COALESCE(v_row->>'bank_name', v_row->>'BANK NAME', v_row->>'bank');
    v_bank_account := COALESCE(v_row->>'bank_account_number', v_row->>'ACCOUNT NO', v_row->>'account_no', v_row->>'bank_account');

    v_raw_holder_type := COALESCE(
      v_row->>'holder_type', v_row->>'holderType', v_row->>'investor_type',
      v_row->>'investorType', v_row->>'investor_category', v_row->>'investorCategory',
      v_row->>'category', v_row->>'sheet_type', v_staged.sheet_name
    );
    v_raw_classification := COALESCE(v_row->>'payee_classification', v_row->>'payeeClassification', v_row->>'classification', v_row->>'tax_category');

    IF upper(trim(coalesce(v_raw_classification, ''))) IN (
      'NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON', 'COMPANY_INSTITUTION',
      'FOREIGN_INVESTOR', 'BANK_FI', 'TAX_EXEMPT', 'UNCLASSIFIED'
    ) THEN
      v_payee_classification := upper(trim(v_raw_classification));
    ELSIF v_raw_holder_type ILIKE '%EXEMPT%' OR v_raw_holder_type ILIKE '%MUTUAL%' THEN
      v_payee_classification := 'TAX_EXEMPT';
    ELSIF v_raw_holder_type ILIKE '%FOREIGN%' THEN
      v_payee_classification := 'FOREIGN_INVESTOR';
    ELSIF v_raw_holder_type ILIKE '%BANK%' OR v_raw_holder_type ILIKE '%FINANCIAL%' THEN
      v_payee_classification := 'BANK_FI';
    ELSIF v_raw_holder_type ILIKE '%INSTITUTION%' OR v_raw_holder_type ILIKE '%LEGAL PERSON%' THEN
      v_payee_classification := 'COMPANY_INSTITUTION';
    ELSE
      v_payee_classification := 'NATURAL_PERSON';
    END IF;

    IF v_raw_holder_type IN (
      'Natural Person - Public', 'Natural Person - Promoter', 'Legal Person', 'Mutual Fund',
      'Foreign', 'Tax Exempt', 'Public', 'Promoter', 'Institution', 'Natural Person - Local',
      'Natural Person - Employee', 'Natural Person - Minor', 'Natural Person - Joint Holder',
      'Legal Person - Promoter', 'Local', 'Employee'
    ) THEN
      v_holder_type := v_raw_holder_type::public.holder_type;
    ELSIF v_payee_classification = 'TAX_EXEMPT' THEN
      v_holder_type := CASE WHEN v_raw_holder_type ILIKE '%MUTUAL%' THEN 'Mutual Fund'::public.holder_type ELSE 'Tax Exempt'::public.holder_type END;
    ELSIF v_payee_classification = 'FOREIGN_INVESTOR' THEN v_holder_type := 'Foreign'::public.holder_type;
    ELSIF v_payee_classification = 'BANK_FI' THEN v_holder_type := 'Institution'::public.holder_type;
    ELSIF v_payee_classification = 'COMPANY_INSTITUTION' THEN v_holder_type := 'Legal Person'::public.holder_type;
    ELSIF v_payee_classification = 'PUBLIC_LEGAL_PERSON' THEN v_holder_type := 'Public'::public.holder_type;
    ELSIF v_raw_holder_type ILIKE '%PROMOTER%' THEN v_holder_type := 'Natural Person - Promoter'::public.holder_type;
    ELSIF v_raw_holder_type ILIKE '%LOCAL%' THEN v_holder_type := 'Natural Person - Local'::public.holder_type;
    ELSIF v_raw_holder_type ILIKE '%STAFF%' OR v_raw_holder_type ILIKE '%EMPLOYEE%' THEN v_holder_type := 'Natural Person - Employee'::public.holder_type;
    ELSIF v_raw_holder_type ILIKE '%MINOR%' THEN v_holder_type := 'Natural Person - Minor'::public.holder_type;
    ELSIF v_raw_holder_type ILIKE '%JOINT%' THEN v_holder_type := 'Natural Person - Joint Holder'::public.holder_type;
    ELSE v_holder_type := 'Natural Person - Public'::public.holder_type;
    END IF;

    v_client_id := NULL;
    IF v_boid IS NOT NULL AND v_boid <> '' THEN
      SELECT id INTO v_client_id FROM public.clients WHERE company_id = v_staged.company_id AND boid = v_boid LIMIT 1;
    END IF;
    IF v_client_id IS NULL AND v_client_code IS NOT NULL AND v_client_code <> '' THEN
      SELECT id INTO v_client_id FROM public.clients WHERE company_id = v_staged.company_id AND client_code = v_client_code LIMIT 1;
    END IF;

    IF v_client_id IS NOT NULL THEN
      UPDATE public.clients SET
        bank_name = COALESCE(v_bank_name, public.clients.bank_name),
        bank_account_no = COALESCE(v_bank_account, public.clients.bank_account_no),
        payee_classification = CASE
          WHEN public.clients.payee_classification = 'UNCLASSIFIED' AND v_payee_classification <> 'UNCLASSIFIED'
            THEN v_payee_classification ELSE public.clients.payee_classification END,
        holder_type = CASE
          WHEN public.clients.payee_classification = 'UNCLASSIFIED' AND v_payee_classification <> 'UNCLASSIFIED'
            THEN v_holder_type ELSE public.clients.holder_type END,
        updated_at = now()
      WHERE id = v_client_id AND company_id = v_staged.company_id;
    ELSE
      INSERT INTO public.clients (
        company_id, client_code, full_name, boid, bank_name, bank_account_no,
        holder_type, payee_classification, classification_status, created_at, updated_at
      ) VALUES (
        v_staged.company_id, v_client_code, v_client_name, v_boid, v_bank_name, v_bank_account,
        v_holder_type, v_payee_classification, 'AUTO_CLASSIFIED', now(), now()
      ) RETURNING id INTO v_client_id;
    END IF;

    v_shares_held := COALESCE((v_row->>'shares_held')::numeric, (v_row->>'kitta')::numeric, (v_row->>'KITTA')::numeric, (v_row->>'TOTAL KITTA')::numeric, 0);
    v_gross := COALESCE((v_row->>'gross_dividend')::numeric, (v_row->>'gross')::numeric, (v_row->>'GROSS')::numeric, (v_row->>'gross_amount')::numeric, 0);
    v_tax := COALESCE((v_row->>'tax_amount')::numeric, (v_row->>'tax')::numeric, (v_row->>'TAX')::numeric, (v_row->>'tax_withheld')::numeric, 0);
    v_bonus_tax := COALESCE((v_row->>'bonus_tax')::numeric, (v_row->>'bon_tax')::numeric, 0);
    v_net := COALESCE(
      (v_row->>'net_payable')::numeric,
      (v_row->>'net')::numeric,
      (v_row->>'NET')::numeric,
      (v_row->>'net_dividend')::numeric,
      GREATEST(0, v_gross - v_tax - CASE WHEN v_bonus_tax_mode = 'CASH_ADJUSTED' THEN v_bonus_tax ELSE 0 END)
    );

    IF v_staged.target_table = 'interest_payables' THEN
      INSERT INTO public.interest_payables (
        declaration_id, company_id, client_id, upload_id, gross_interest, tax_amount, net_payable,
        fiscal_year, payee_classification, classification_status, payment_status, created_by, created_at, updated_at
      ) VALUES (
        v_declaration_id, v_staged.company_id, v_client_id, v_upload_id, v_gross, v_tax, v_net,
        v_fiscal_year, v_payee_classification, 'AUTO_CLASSIFIED', 'Pending'::public.payment_status, v_user_id, now(), now()
      );
    ELSIF v_staged.target_table = 'mutual_fund_payables' THEN
      INSERT INTO public.mutual_fund_payables (
        declaration_id, company_id, client_id, upload_id, shares_held, dividend_rate, gross_dividend, tax_amount, bonus_tax, bonus_tax_mode, net_payable,
        fiscal_year, payee_classification, classification_status, payment_status, created_by, created_at, updated_at
      ) VALUES (
        v_declaration_id, v_staged.company_id, v_client_id, v_upload_id, v_shares_held, v_dividend_rate, v_gross, v_tax, NULLIF(v_bonus_tax, 0), v_bonus_tax_mode, v_net,
        v_fiscal_year, v_payee_classification, 'AUTO_CLASSIFIED', 'Pending'::public.payment_status, v_user_id, now(), now()
      );
    ELSE
      INSERT INTO public.dividend_payables (
        declaration_id, company_id, client_id, upload_id, shares_held, dividend_rate, bonus_rate, gross_dividend, tax_amount, bonus_tax, bonus_tax_mode, net_payable,
        tds_rate, payee_classification, classification_status, fiscal_year, dividend_type, payment_status, created_by, created_at, updated_at
      ) VALUES (
        v_declaration_id, v_staged.company_id, v_client_id, v_upload_id, v_shares_held, v_dividend_rate, v_bonus_rate, v_gross, v_tax, NULLIF(v_bonus_tax, 0), v_bonus_tax_mode, v_net,
        CASE WHEN v_gross > 0 THEN ROUND(v_tax / v_gross, 4) ELSE 0 END,
        v_payee_classification, 'AUTO_CLASSIFIED', v_fiscal_year,
        CASE
          WHEN v_dividend_type = 'Stock' THEN 'Stock'::public.dividend_type
          WHEN v_dividend_type = 'Bonus' THEN 'Bonus'::public.dividend_type
          WHEN v_dividend_type = 'Right' THEN 'Right'::public.dividend_type
          ELSE 'Cash'::public.dividend_type
        END,
        'Pending'::public.payment_status, v_user_id, now(), now()
      );
    END IF;

    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  UPDATE public.upload_history SET status = 'Completed', success_rows = v_inserted_count, completed_at = now() WHERE id = v_upload_id;
  UPDATE public.pending_approvals SET status = 'Approved', reviewed_by = v_user_id, review_notes = p_checker_notes, reviewed_at = now() WHERE id = p_approval_id;
  UPDATE public.import_staging SET status = 'COMMITTED', upload_id = v_upload_id, committed_at = now() WHERE id = v_staged.id;

  INSERT INTO public.approval_logs (approval_id, action, previous_status, new_status, remarks, performed_by, performed_at)
  VALUES (p_approval_id, 'MATERIAL_IMPORT_COMMITTED', 'Pending', 'Approved', COALESCE(p_checker_notes, 'Approved and committed ' || v_inserted_count || ' rows'), v_user_id, now());

  RETURN jsonb_build_object(
    'success', true,
    'approval_id', p_approval_id,
    'staging_id', v_staged.id,
    'upload_id', v_upload_id,
    'rows_committed', v_inserted_count,
    'inserted_count', v_inserted_count,
    'status', 'Approved',
    'committed_at', now(),
    'target_table', v_staged.target_table
  );
END;
$$;
