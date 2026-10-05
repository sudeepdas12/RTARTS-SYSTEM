-- ============================================================================
-- Migration: 20261205000000_add_days_count_and_remaining_to_bulk_interest.sql
-- Description:
-- 1. Updates bulk_insert_interest_payables RPC to persist days_count, paid_amount,
--    and remaining_amount upon insert and conflict update.
-- 2. Defaults days_count to 183 (standard semi-annual in Nepal) if not provided.
-- 3. Ensures remaining_amount is initialized to net_payable for new Pending payables.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.bulk_insert_interest_payables(
  p_payables jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        upload_id, company_id, client_id, instrument_ref, gross_interest,
        tax_amount, net_payable, due_date, payment_status, payment_date,
        payment_reference, fiscal_year, tds_rate, bank_name, bank_account_no,
        bank_branch, lot_name, remarks, payee_classification, payee_segment,
        classification_status, shares_held, kitta, days_count,
        paid_amount, remaining_amount
      ) VALUES (
        (v_payable->>'upload_id')::uuid,
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
        gross_interest = EXCLUDED.gross_interest,
        tax_amount = EXCLUDED.tax_amount,
        net_payable = EXCLUDED.net_payable,
        tds_rate = COALESCE(EXCLUDED.tds_rate, interest_payables.tds_rate),
        shares_held = COALESCE(EXCLUDED.shares_held, interest_payables.shares_held),
        kitta = COALESCE(EXCLUDED.kitta, interest_payables.kitta),
        days_count = COALESCE(EXCLUDED.days_count, interest_payables.days_count),
        remaining_amount = CASE 
          WHEN interest_payables.payment_status = 'Pending' THEN EXCLUDED.net_payable 
          ELSE interest_payables.remaining_amount 
        END,
        bank_name = COALESCE(EXCLUDED.bank_name, interest_payables.bank_name),
        bank_account_no = COALESCE(EXCLUDED.bank_account_no, interest_payables.bank_account_no),
        bank_branch = COALESCE(EXCLUDED.bank_branch, interest_payables.bank_branch),
        payee_classification = CASE 
          WHEN interest_payables.classification_status = 'OVERRIDDEN' THEN interest_payables.payee_classification 
          ELSE COALESCE(NULLIF(EXCLUDED.payee_classification, 'UNCLASSIFIED'), interest_payables.payee_classification) 
        END,
        payee_segment = CASE 
          WHEN interest_payables.classification_status = 'OVERRIDDEN' THEN interest_payables.payee_segment 
          ELSE COALESCE(EXCLUDED.payee_segment, interest_payables.payee_segment) 
        END,
        updated_at = now();

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
