-- ============================================================================
-- Migration: 20261157000000_harden_security_definer_and_lan_grants.sql
-- Description:
-- 1. Create public.require_role helper to strictly enforce RBAC in SECURITY DEFINER RPCs
-- 2. Harden complete_payment_batch_atomic with role checks and spoof-proof audit user_id
-- 3. Revoke anon execute on get_company_fiscal_summary_rpc and complete_payment_batch_atomic
-- 4. Harden apply_reconciliation_batch with role checks (admin/supervisor/finance/recon)
-- 5. Harden bulk_insert_* RPCs with role checks (admin/supervisor/finance/operator/maker)
-- 6. Revert over-permissive LAN grants and default privileges from anon
-- 7. Lock down login_logs (service_role insert only; privileged select only)
-- ============================================================================

-- 1. Helper Function: require_role
CREATE OR REPLACE FUNCTION public.require_role(VARIADIC _roles public.app_role[])
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt_role text;
BEGIN
  -- Always allow postgres superuser / internal triggers
  IF current_user = 'postgres' THEN
    RETURN;
  END IF;

  -- Allow service_role
  BEGIN
    v_jwt_role := (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role = 'service_role' THEN
    RETURN;
  END IF;

  -- Authenticated user check
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  -- Admin always has all privileges; otherwise verify at least one required role
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_uid AND (role = 'admin'::public.app_role OR role = ANY(_roles))
  ) THEN
    RAISE EXCEPTION 'Forbidden: user does not have required permissions' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Text-overload helper for require_role
CREATE OR REPLACE FUNCTION public.require_role(VARIADIC _roles text[])
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_typed_roles public.app_role[];
BEGIN
  SELECT COALESCE(array_agg(r::public.app_role), ARRAY[]::public.app_role[])
  INTO v_typed_roles
  FROM unnest(_roles) AS r;

  PERFORM public.require_role(VARIADIC v_typed_roles);
END;
$$;

GRANT EXECUTE ON FUNCTION public.require_role(VARIADIC public.app_role[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.require_role(VARIADIC text[]) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.require_role(VARIADIC public.app_role[]) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.require_role(VARIADIC text[]) FROM anon, PUBLIC;


-- 2. Hardened complete_payment_batch_atomic
CREATE OR REPLACE FUNCTION public.complete_payment_batch_atomic(
  p_batch_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch record;
  v_payments_updated bigint := 0;
  v_div_updated bigint := 0;
  v_int_updated bigint := 0;
  v_mf_updated bigint := 0;
  v_today date := CURRENT_DATE;
  v_actor_id uuid;
BEGIN
  -- Enforce caller role: admin, supervisor, or finance_operator
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator');
  v_actor_id := COALESCE(auth.uid(), p_user_id);

  -- 1. Fetch and lock batch record
  SELECT * INTO v_batch
  FROM public.payment_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment batch with id % not found', p_batch_id;
  END IF;

  -- 2. Update payment batch status
  UPDATE public.payment_batches
  SET
    status = 'Completed',
    processed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_batch_id;

  -- 3. Update all payments in this batch
  WITH updated_payments AS (
    UPDATE public.payments
    SET
      status = 'Completed',
      payment_date = v_today,
      updated_at = NOW()
    WHERE batch_id = p_batch_id
      AND status != 'Completed'
    RETURNING id, payable_id, payable_type
  )
  SELECT COUNT(*) INTO v_payments_updated FROM updated_payments;

  -- 4. Cascade to underlying dividend payables
  WITH target_divs AS (
    SELECT DISTINCT p.payable_id
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.payable_type = 'dividend'
      AND p.payable_id IS NOT NULL
  ),
  updated_divs AS (
    UPDATE public.dividend_payables dp
    SET
      payment_status = 'Paid',
      payment_date = v_today,
      updated_at = NOW()
    FROM target_divs td
    WHERE dp.id = td.payable_id
    RETURNING dp.id
  )
  SELECT COUNT(*) INTO v_div_updated FROM updated_divs;

  -- 5. Cascade to underlying interest payables
  WITH target_ints AS (
    SELECT DISTINCT p.payable_id
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.payable_type = 'interest'
      AND p.payable_id IS NOT NULL
  ),
  updated_ints AS (
    UPDATE public.interest_payables ip
    SET
      payment_status = 'Paid',
      payment_date = v_today,
      updated_at = NOW()
    FROM target_ints ti
    WHERE ip.id = ti.payable_id
    RETURNING ip.id
  )
  SELECT COUNT(*) INTO v_int_updated FROM updated_ints;

  -- 6. Cascade to underlying mutual fund payables
  WITH target_mfs AS (
    SELECT DISTINCT p.payable_id
    FROM public.payments p
    WHERE p.batch_id = p_batch_id
      AND p.payable_type = 'mutual_fund'
      AND p.payable_id IS NOT NULL
  ),
  updated_mfs AS (
    UPDATE public.mutual_fund_payables mp
    SET
      payment_status = 'Paid',
      payment_date = v_today,
      updated_at = NOW()
    FROM target_mfs tm
    WHERE mp.id = tm.payable_id
    RETURNING mp.id
  )
  SELECT COUNT(*) INTO v_mf_updated FROM updated_mfs;

  -- 7. Audit log record using authenticated actor_id
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_type,
    entity_id,
    new_values,
    created_at
  ) VALUES (
    v_actor_id,
    'BATCH_COMPLETED_ATOMIC',
    'payment_batches',
    p_batch_id::text,
    json_build_object(
      'batch_id', p_batch_id,
      'payments_completed', v_payments_updated,
      'dividend_payables_updated', v_div_updated,
      'interest_payables_updated', v_int_updated,
      'mutual_fund_payables_updated', v_mf_updated
    ),
    NOW()
  );

  RETURN json_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'payments_completed', v_payments_updated,
    'dividend_payables_updated', v_div_updated,
    'interest_payables_updated', v_int_updated,
    'mutual_fund_payables_updated', v_mf_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_payment_batch_atomic(uuid, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_payment_batch_atomic(uuid, uuid) TO authenticated, service_role;


-- 3. Hardened get_company_fiscal_summary_rpc (Revoke Anon Access)
CREATE OR REPLACE FUNCTION public.get_company_fiscal_summary_rpc(
  p_fiscal_year text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
  v_uid uuid := auth.uid();
  v_jwt_role text;
BEGIN
  -- Verify caller is authenticated or service_role
  IF current_user != 'postgres' THEN
    BEGIN
      v_jwt_role := (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
    EXCEPTION WHEN OTHERS THEN
      v_jwt_role := NULL;
    END;

    IF v_jwt_role != 'service_role' AND v_uid IS NULL THEN
      RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
    END IF;
  END IF;

  WITH div_summary AS (
    SELECT
      dp.company_id,
      dp.fiscal_year,
      COUNT(*) AS dividend_count,
      COALESCE(SUM(dp.gross_dividend), 0) AS dividend_gross,
      COALESCE(SUM(dp.net_payable), 0) AS dividend_net,
      COALESCE(SUM(dp.net_payable) FILTER (WHERE dp.payment_status = 'Paid'), 0) AS dividend_paid,
      COALESCE(SUM(dp.net_payable) FILTER (WHERE dp.payment_status != 'Paid'), 0) AS dividend_pending
    FROM public.dividend_payables dp
    WHERE p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR dp.fiscal_year = p_fiscal_year
    GROUP BY dp.company_id, dp.fiscal_year
  ),
  int_summary AS (
    SELECT
      ip.company_id,
      ip.fiscal_year,
      COUNT(*) AS interest_count,
      COALESCE(SUM(ip.gross_interest), 0) AS interest_gross,
      COALESCE(SUM(ip.net_payable), 0) AS interest_net,
      COALESCE(SUM(ip.net_payable) FILTER (WHERE ip.payment_status = 'Paid'), 0) AS interest_paid,
      COALESCE(SUM(ip.net_payable) FILTER (WHERE ip.payment_status != 'Paid'), 0) AS interest_pending
    FROM public.interest_payables ip
    WHERE p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR ip.fiscal_year = p_fiscal_year
    GROUP BY ip.company_id, ip.fiscal_year
  ),
  mf_summary AS (
    SELECT
      mp.company_id,
      mp.fiscal_year,
      COUNT(*) AS mutual_fund_count,
      COALESCE(SUM(mp.gross_dividend), 0) AS mutual_fund_gross,
      COALESCE(SUM(mp.net_payable), 0) AS mutual_fund_net,
      COALESCE(SUM(mp.net_payable) FILTER (WHERE mp.payment_status = 'Paid'), 0) AS mutual_fund_paid,
      COALESCE(SUM(mp.net_payable) FILTER (WHERE mp.payment_status != 'Paid'), 0) AS mutual_fund_pending
    FROM public.mutual_fund_payables mp
    WHERE p_fiscal_year IS NULL OR p_fiscal_year = 'all' OR mp.fiscal_year = p_fiscal_year
    GROUP BY mp.company_id, mp.fiscal_year
  ),
  all_pairs AS (
    SELECT company_id, fiscal_year FROM div_summary
    UNION
    SELECT company_id, fiscal_year FROM int_summary
    UNION
    SELECT company_id, fiscal_year FROM mf_summary
  )
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'company_id', ap.company_id,
        'company_name', COALESCE(c.company_name, 'Unknown Company'),
        'company_code', COALESCE(c.company_code, 'N/A'),
        'fiscal_year', ap.fiscal_year,
        'dividend_count', COALESCE(ds.dividend_count, 0),
        'dividend_gross', ROUND(COALESCE(ds.dividend_gross, 0)::numeric, 2),
        'dividend_net', ROUND(COALESCE(ds.dividend_net, 0)::numeric, 2),
        'interest_count', COALESCE(is_data.interest_count, 0),
        'interest_gross', ROUND(COALESCE(is_data.interest_gross, 0)::numeric, 2),
        'interest_net', ROUND(COALESCE(is_data.interest_net, 0)::numeric, 2),
        'mutual_fund_count', COALESCE(ms.mutual_fund_count, 0),
        'mutual_fund_gross', ROUND(COALESCE(ms.mutual_fund_gross, 0)::numeric, 2),
        'mutual_fund_net', ROUND(COALESCE(ms.mutual_fund_net, 0)::numeric, 2),
        'total_paid', ROUND((COALESCE(ds.dividend_paid, 0) + COALESCE(is_data.interest_paid, 0) + COALESCE(ms.mutual_fund_paid, 0))::numeric, 2),
        'total_pending', ROUND((COALESCE(ds.dividend_pending, 0) + COALESCE(is_data.interest_pending, 0) + COALESCE(ms.mutual_fund_pending, 0))::numeric, 2)
      )
      ORDER BY c.company_name ASC, ap.fiscal_year DESC
    ),
    '[]'::json
  )
  INTO v_result
  FROM all_pairs ap
  JOIN public.companies c ON c.id = ap.company_id
  LEFT JOIN div_summary ds ON ds.company_id = ap.company_id AND ds.fiscal_year = ap.fiscal_year
  LEFT JOIN int_summary is_data ON is_data.company_id = ap.company_id AND is_data.fiscal_year = ap.fiscal_year
  LEFT JOIN mf_summary ms ON ms.company_id = ap.company_id AND ms.fiscal_year = ap.fiscal_year;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_fiscal_summary_rpc(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_fiscal_summary_rpc(text) TO authenticated, service_role;


-- 4. Hardened apply_reconciliation_batch
CREATE OR REPLACE FUNCTION public.apply_reconciliation_batch(
  p_items jsonb,
  p_batch_info jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_item jsonb;
  v_batch_id uuid;
  v_company_id uuid;
  v_payable_id uuid;
  v_payment_id uuid;
  v_payable_type text;
  v_target_table text;
  v_actual_amt numeric;
  v_expected_amt numeric;
  v_paid_amt numeric;
  v_result text;
  v_new_status public.payment_status;
  v_payment_ref text;
  v_updated int := 0;
  v_payments_created int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  -- Enforce caller role: admin, supervisor, finance_operator, or reconciliation_officer
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer');
  v_uid := auth.uid();

  -- Optional: Create tracking payment batch if requested in p_batch_info
  IF p_batch_info IS NOT NULL AND p_batch_info->>'batch_name' IS NOT NULL THEN
    BEGIN
      INSERT INTO public.payment_batches (
        batch_name,
        company_id,
        payable_type,
        payment_method,
        total_payments,
        total_amount,
        total_tax,
        status,
        processed_at,
        cds_batch_ref,
        created_by
      ) VALUES (
        p_batch_info->>'batch_name',
        NULLIF(p_batch_info->>'company_id', '')::uuid,
        p_batch_info->>'payable_type',
        COALESCE(p_batch_info->>'payment_method', 'ConnectIPS'),
        COALESCE((p_batch_info->>'total_records')::numeric, 0),
        COALESCE((p_batch_info->>'total_net')::numeric, 0),
        COALESCE((p_batch_info->>'total_tax')::numeric, 0),
        'Completed',
        now(),
        COALESCE(p_batch_info->>'cds_batch_ref', 'RECON-APPLY'),
        v_uid
      )
      RETURNING id INTO v_batch_id;
    EXCEPTION WHEN OTHERS THEN
      v_batch_id := NULL;
    END;
  END IF;

  -- Loop over matched items and apply atomically
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_payable_id := NULLIF(v_item->>'payable_id', '')::uuid;
      v_payment_id := NULLIF(v_item->>'payment_id', '')::uuid;
      v_company_id := NULLIF(v_item->>'company_id', '')::uuid;
      v_payable_type := COALESCE(NULLIF(v_item->>'payable_type', ''), 'dividend');
      v_actual_amt := COALESCE((v_item->>'actual_amount')::numeric, (v_item->>'expected_amount')::numeric, 0);
      v_expected_amt := COALESCE((v_item->>'expected_amount')::numeric, v_actual_amt);
      v_paid_amt := COALESCE((v_item->>'paid_amount')::numeric, v_actual_amt);
      v_result := COALESCE(v_item->>'result', 'Matched');
      v_payment_ref := COALESCE(v_item->>'payment_reference', 'RECON-' || SUBSTRING(COALESCE(v_item->>'id', gen_random_uuid()::text), 1, 8));

      v_new_status := CASE 
        WHEN v_result = 'Matched' OR v_result = 'Over_Paid' THEN 'Paid'::public.payment_status
        ELSE 'Partial'::public.payment_status
      END;

      v_target_table := CASE v_payable_type
        WHEN 'interest' THEN 'interest_payables'
        WHEN 'mutual_fund' THEN 'mutual_fund_payables'
        ELSE 'dividend_payables'
      END;

      -- Update payable record if payable_id is valid (only if not already fully Paid)
      IF v_payable_id IS NOT NULL THEN
        EXECUTE format(
          'UPDATE public.%I SET payment_status = $1, payment_date = CURRENT_DATE, payment_reference = $2 WHERE id = $3 AND payment_status != ''Paid''',
          v_target_table
        ) USING v_new_status, v_payment_ref, v_payable_id;
        v_updated := v_updated + 1;
      END IF;

      -- Handle payment record: update existing or insert new with concurrency lock
      IF v_payment_id IS NOT NULL THEN
        UPDATE public.payments
        SET
          status = 'Completed',
          payment_date = CURRENT_DATE,
          paid_amount = v_paid_amt,
          batch_id = COALESCE(v_batch_id, payments.batch_id),
          updated_at = now()
        WHERE id = v_payment_id;
        v_payments_created := v_payments_created + 1;
      ELSIF v_payable_id IS NOT NULL THEN
        -- Check with FOR UPDATE lock if active payment already exists for this payable
        SELECT id INTO v_payment_id 
        FROM public.payments 
        WHERE payable_id = v_payable_id 
          AND status NOT IN ('Reversed', 'Failed', 'Cancelled')
        FOR UPDATE
        LIMIT 1;

        IF v_payment_id IS NOT NULL THEN
          UPDATE public.payments
          SET
            status = 'Completed',
            payment_date = CURRENT_DATE,
            paid_amount = v_paid_amt,
            batch_id = COALESCE(v_batch_id, payments.batch_id),
            updated_at = now()
          WHERE id = v_payment_id;
        ELSE
          INSERT INTO public.payments (
            batch_id,
            company_id,
            client_id,
            payable_id,
            payable_type,
            amount,
            paid_amount,
            tax_amount,
            net_amount,
            status,
            payment_date,
            payment_reference,
            payment_method,
            remarks,
            created_by
          ) VALUES (
            v_batch_id,
            v_company_id,
            NULLIF(v_item->>'client_id', '')::uuid,
            v_payable_id,
            v_payable_type,
            v_expected_amt,
            v_paid_amt,
            COALESCE((v_item->>'tax_amount')::numeric, 0),
            COALESCE((v_item->>'net_amount')::numeric, v_actual_amt),
            'Completed',
            CURRENT_DATE,
            v_payment_ref,
            'Bank Statement Reconciliation',
            'Auto-created via Reconciliation Batch: ' || COALESCE(v_result, 'Matched'),
            v_uid
          );
          v_payments_created := v_payments_created + 1;
        END IF;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'item', v_item,
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', jsonb_array_length(v_errors) = 0,
    'batch_id', v_batch_id,
    'updated', v_updated,
    'payments_created', v_payments_created,
    'errors', v_errors
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_reconciliation_batch(jsonb, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_reconciliation_batch(jsonb, jsonb) TO authenticated, service_role;


-- 5. Hardened Bulk Insert Functions (Clients & Payables)
-- 5a. bulk_insert_clients
CREATE OR REPLACE FUNCTION public.bulk_insert_clients(
  p_clients jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client jsonb;
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_holder_type public.holder_type;
  v_residency public.residency_type;
  v_status public.record_status;
  v_verification public.verification_status;
BEGIN
  -- Enforce caller role: admin, supervisor, finance_operator, operator, or maker
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');

  FOR v_client IN SELECT * FROM jsonb_array_elements(p_clients)
  LOOP
    BEGIN
      -- Safe enum mapping for holder_type
      IF v_client->>'holder_type' IN (
        'Natural Person - Public', 'Natural Person - Promoter',
        'Legal Person', 'Mutual Fund', 'Foreign', 'Tax Exempt',
        'Public', 'Promoter', 'Institution'
      ) THEN
        v_holder_type := (v_client->>'holder_type')::public.holder_type;
      ELSIF v_client->>'holder_type' ILIKE '%promoter%' THEN
        v_holder_type := 'Natural Person - Promoter'::public.holder_type;
      ELSIF v_client->>'holder_type' ILIKE '%institution%' OR v_client->>'holder_type' ILIKE '%legal%' THEN
        v_holder_type := 'Legal Person'::public.holder_type;
      ELSIF v_client->>'holder_type' ILIKE '%fund%' THEN
        v_holder_type := 'Mutual Fund'::public.holder_type;
      ELSIF v_client->>'holder_type' ILIKE '%foreign%' THEN
        v_holder_type := 'Foreign'::public.holder_type;
      ELSIF v_client->>'holder_type' ILIKE '%exempt%' THEN
        v_holder_type := 'Tax Exempt'::public.holder_type;
      ELSE
        v_holder_type := 'Natural Person - Public'::public.holder_type;
      END IF;

      -- Safe enum mapping for residency
      IF v_client->>'residency' IN ('Resident', 'Non-Resident') THEN
        v_residency := (v_client->>'residency')::public.residency_type;
      ELSIF v_client->>'residency' ILIKE '%non%' OR v_client->>'residency' ILIKE '%foreign%' THEN
        v_residency := 'Non-Resident'::public.residency_type;
      ELSE
        v_residency := 'Resident'::public.residency_type;
      END IF;

      -- Safe enum mapping for record_status
      IF v_client->>'status' IN ('Active', 'Inactive', 'Merged', 'Suspended') THEN
        v_status := (v_client->>'status')::public.record_status;
      ELSE
        v_status := 'Active'::public.record_status;
      END IF;

      -- Safe enum mapping for verification_status
      IF v_client->>'verification_status' IN ('Verified', 'Pending', 'Rejected') THEN
        v_verification := (v_client->>'verification_status')::public.verification_status;
      ELSE
        v_verification := 'Verified'::public.verification_status;
      END IF;

      INSERT INTO public.clients (
        id, boid, company_id, full_name, client_code, client_id,
        father_name, grandfather_name, pan_or_citizenship, pan_no, citizenship_no, nid_number,
        date_of_birth, gender, occupation,
        address, province, district, municipality,
        phone, email, bank_name, bank_branch, bank_account_no, bank_code, account_type,
        residency, holder_type, status, verification_status,
        payee_classification, payee_segment,
        classification_status, classification_source, kitta
      ) VALUES (
        COALESCE(NULLIF(v_client->>'id', '')::uuid, gen_random_uuid()),
        v_client->>'boid',
        (v_client->>'company_id')::uuid,
        v_client->>'full_name',
        v_client->>'client_code',
        NULLIF(v_client->>'client_id', ''),
        NULLIF(v_client->>'father_name', ''),
        NULLIF(v_client->>'grandfather_name', ''),
        NULLIF(COALESCE(v_client->>'pan_no', v_client->>'pan_or_citizenship', v_client->>'citizenship_no'), ''),
        NULLIF(COALESCE(v_client->>'pan_no', v_client->>'pan'), ''),
        NULLIF(COALESCE(v_client->>'citizenship_no', v_client->>'citizenship'), ''),
        NULLIF(v_client->>'nid_number', ''),
        NULLIF(v_client->>'date_of_birth', ''),
        NULLIF(v_client->>'gender', ''),
        NULLIF(v_client->>'occupation', ''),
        NULLIF(v_client->>'address', ''),
        NULLIF(v_client->>'province', ''),
        NULLIF(v_client->>'district', ''),
        NULLIF(v_client->>'municipality', ''),
        NULLIF(v_client->>'phone', ''),
        NULLIF(v_client->>'email', ''),
        NULLIF(v_client->>'bank_name', ''),
        NULLIF(v_client->>'bank_branch', ''),
        NULLIF(v_client->>'bank_account_no', ''),
        NULLIF(v_client->>'bank_code', ''),
        NULLIF(v_client->>'account_type', ''),
        v_residency,
        v_holder_type,
        v_status,
        v_verification,
        COALESCE(NULLIF(v_client->>'payee_classification', ''), 'UNCLASSIFIED'),
        NULLIF(v_client->>'payee_segment', ''),
        COALESCE(NULLIF(v_client->>'classification_status', ''), 'PENDING'),
        COALESCE(NULLIF(v_client->>'classification_source', ''), 'SYSTEM'),
        COALESCE((v_client->>'kitta')::numeric, 0)
      )
      ON CONFLICT (company_id, boid) DO UPDATE SET
        full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), clients.full_name),
        client_code = COALESCE(NULLIF(EXCLUDED.client_code, ''), clients.client_code),
        client_id = COALESCE(NULLIF(EXCLUDED.client_id, ''), clients.client_id),
        father_name = COALESCE(NULLIF(EXCLUDED.father_name, ''), clients.father_name),
        grandfather_name = COALESCE(NULLIF(EXCLUDED.grandfather_name, ''), clients.grandfather_name),
        pan_or_citizenship = COALESCE(NULLIF(EXCLUDED.pan_or_citizenship, ''), clients.pan_or_citizenship),
        pan_no = COALESCE(NULLIF(EXCLUDED.pan_no, ''), clients.pan_no),
        citizenship_no = COALESCE(NULLIF(EXCLUDED.citizenship_no, ''), clients.citizenship_no),
        nid_number = COALESCE(NULLIF(EXCLUDED.nid_number, ''), clients.nid_number),
        date_of_birth = COALESCE(NULLIF(EXCLUDED.date_of_birth, ''), clients.date_of_birth),
        gender = COALESCE(NULLIF(EXCLUDED.gender, ''), clients.gender),
        occupation = COALESCE(NULLIF(EXCLUDED.occupation, ''), clients.occupation),
        address = COALESCE(NULLIF(EXCLUDED.address, ''), clients.address),
        province = COALESCE(NULLIF(EXCLUDED.province, ''), clients.province),
        district = COALESCE(NULLIF(EXCLUDED.district, ''), clients.district),
        municipality = COALESCE(NULLIF(EXCLUDED.municipality, ''), clients.municipality),
        phone = COALESCE(NULLIF(EXCLUDED.phone, ''), clients.phone),
        email = COALESCE(NULLIF(EXCLUDED.email, ''), clients.email),
        bank_name = COALESCE(NULLIF(EXCLUDED.bank_name, ''), clients.bank_name),
        bank_branch = COALESCE(NULLIF(EXCLUDED.bank_branch, ''), clients.bank_branch),
        bank_account_no = COALESCE(NULLIF(EXCLUDED.bank_account_no, ''), clients.bank_account_no),
        bank_code = COALESCE(NULLIF(EXCLUDED.bank_code, ''), clients.bank_code),
        account_type = COALESCE(NULLIF(EXCLUDED.account_type, ''), clients.account_type),
        residency = COALESCE(NULLIF(v_client->>'residency', '')::public.residency_type, clients.residency),
        holder_type = COALESCE(NULLIF(v_client->>'holder_type', '')::public.holder_type, clients.holder_type),
        verification_status = COALESCE(NULLIF(v_client->>'verification_status', '')::public.verification_status, clients.verification_status),
        payee_classification = COALESCE(NULLIF(v_client->>'payee_classification', 'UNCLASSIFIED'), clients.payee_classification),
        payee_segment = COALESCE(NULLIF(v_client->>'payee_segment', ''), clients.payee_segment),
        classification_status = COALESCE(NULLIF(v_client->>'classification_status', ''), clients.classification_status),
        classification_source = COALESCE(NULLIF(v_client->>'classification_source', ''), clients.classification_source),
        kitta = COALESCE((v_client->>'kitta')::numeric, clients.kitta),
        updated_at = now();
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'boid', v_client->>'boid',
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'inserted', v_inserted, 'errors', v_errors);
END;
$$;

-- 5b. bulk_insert_dividend_payables
CREATE OR REPLACE FUNCTION public.bulk_insert_dividend_payables(
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
BEGIN
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');

  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      INSERT INTO public.dividend_payables (
        upload_id, company_id, client_id, shares_held,
        dividend_rate, bonus_rate, gross_dividend, tax_amount,
        net_payable, payment_status, payment_date, payment_reference,
        bonus_actual, bonus_issued, bonus_fraction, after_bonus_kitta,
        bonus_tax, bank_name, bank_account_no, bank_branch, lot_name,
        fiscal_year, tds_rate, remarks, payee_classification, payee_segment, classification_status
      ) VALUES (
        (v_payable->>'upload_id')::uuid,
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
        v_payable->>'bank_name',
        v_payable->>'bank_account_no',
        v_payable->>'bank_branch',
        v_payable->>'lot_name',
        v_payable->>'fiscal_year',
        COALESCE(NULLIF(v_payable->>'tds_rate', '')::numeric, NULL),
        v_payable->>'remarks',
        COALESCE(v_payable->>'payee_classification', 'UNCLASSIFIED'),
        v_payable->>'payee_segment',
        COALESCE(v_payable->>'classification_status', 'AUTO_CLASSIFIED')
      );
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

-- 5c. bulk_insert_interest_payables
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
BEGIN
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');

  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      INSERT INTO public.interest_payables (
        upload_id, company_id, client_id, shares_held, kitta,
        gross_interest, tax_amount, net_payable, due_date, fiscal_year,
        payment_status, tds_rate, bank_name, bank_account_no, bank_branch,
        lot_name, instrument_ref, remarks, payee_classification, payee_segment, classification_status
      ) VALUES (
        (v_payable->>'upload_id')::uuid,
        (v_payable->>'company_id')::uuid,
        (v_payable->>'client_id')::uuid,
        COALESCE(NULLIF(v_payable->>'shares_held', '')::numeric, NULLIF(v_payable->>'kitta', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'kitta', '')::numeric, NULLIF(v_payable->>'shares_held', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'gross_interest', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'tax_amount', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'net_payable', '')::numeric, 0),
        COALESCE(NULLIF(v_payable->>'due_date', '')::date, CURRENT_DATE),
        v_payable->>'fiscal_year',
        COALESCE(NULLIF(v_payable->>'payment_status', '')::public.payment_status, 'Pending'),
        COALESCE(NULLIF(v_payable->>'tds_rate', '')::numeric, NULL),
        v_payable->>'bank_name',
        v_payable->>'bank_account_no',
        v_payable->>'bank_branch',
        v_payable->>'lot_name',
        v_payable->>'instrument_ref',
        v_payable->>'remarks',
        COALESCE(v_payable->>'payee_classification', 'UNCLASSIFIED'),
        v_payable->>'payee_segment',
        COALESCE(v_payable->>'classification_status', 'AUTO_CLASSIFIED')
      );
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

-- 5d. bulk_insert_mutual_fund_payables
CREATE OR REPLACE FUNCTION public.bulk_insert_mutual_fund_payables(
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
BEGIN
  PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'operator', 'maker');

  FOR v_payable IN SELECT * FROM jsonb_array_elements(p_payables)
  LOOP
    BEGIN
      INSERT INTO public.mutual_fund_payables (
        upload_id, company_id, client_id, shares_held,
        dividend_rate, dividend_type, gross_dividend, tax_amount,
        net_payable, payment_status, payment_date, payment_reference,
        bonus_actual, bonus_issued, bonus_fraction, after_bonus_kitta,
        bonus_tax, bank_name, bank_account_no, bank_branch, lot_name,
        fiscal_year, tds_rate, remarks, payee_classification, payee_segment, classification_status
      ) VALUES (
        (v_payable->>'upload_id')::uuid,
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
        v_payable->>'bank_name',
        v_payable->>'bank_account_no',
        v_payable->>'bank_branch',
        v_payable->>'lot_name',
        v_payable->>'fiscal_year',
        COALESCE(NULLIF(v_payable->>'tds_rate', '')::numeric, NULL),
        v_payable->>'remarks',
        COALESCE(v_payable->>'payee_classification', 'UNCLASSIFIED'),
        v_payable->>'payee_segment',
        COALESCE(v_payable->>'classification_status', 'AUTO_CLASSIFIED')
      );
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

REVOKE ALL ON FUNCTION public.bulk_insert_clients(jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_insert_clients(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.bulk_insert_dividend_payables(jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_insert_dividend_payables(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.bulk_insert_interest_payables(jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_insert_interest_payables(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.bulk_insert_mutual_fund_payables(jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_insert_mutual_fund_payables(jsonb) TO authenticated, service_role;


-- 6. Revert over-permissive LAN grants and default privileges from anon
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon;

-- Ensure public schema usage is clean
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;


-- 7. Lock down login_logs table
REVOKE ALL ON public.login_logs FROM anon;
REVOKE INSERT ON public.login_logs FROM authenticated;
GRANT SELECT ON public.login_logs TO authenticated;
GRANT ALL ON public.login_logs TO service_role;

ALTER TABLE public.login_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ll_insert ON public.login_logs;
CREATE POLICY ll_insert ON public.login_logs FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS ll_read ON public.login_logs;
DROP POLICY IF EXISTS ll_select ON public.login_logs;
CREATE POLICY ll_select ON public.login_logs FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role])
  );
