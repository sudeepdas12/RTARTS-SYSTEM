-- =============================================================================
-- Migration: Multi-Channel & Manual Reconciliation Workbench,
-- Supporting Evidence Storage, Variance/Exception Activation, and Formal BRS
-- =============================================================================

-- 1. Private storage bucket for manual reconciliation supporting vouchers
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reconciliation-evidence',
  'reconciliation-evidence',
  false,
  20971520,
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'recon_evidence_select'
  ) THEN
    CREATE POLICY "recon_evidence_select" ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'reconciliation-evidence'
        AND (
          (
            (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
            AND (SELECT public.has_company_access((SELECT auth.uid()), ((storage.foldername(name))[1])::uuid))
          )
          OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'auditor'::public.app_role]))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'recon_evidence_insert'
  ) THEN
    CREATE POLICY "recon_evidence_insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'reconciliation-evidence'
        AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'reconciliation_officer'::public.app_role, 'maker'::public.app_role, 'operator'::public.app_role]))
        AND (
          (
            (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
            AND (SELECT public.has_company_access((SELECT auth.uid()), ((storage.foldername(name))[1])::uuid))
          )
          OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'recon_evidence_update'
  ) THEN
    CREATE POLICY "recon_evidence_update" ON storage.objects
      FOR UPDATE TO authenticated
      USING (
        bucket_id = 'reconciliation-evidence'
        AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'reconciliation_officer'::public.app_role]))
        AND (
          (
            (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
            AND (SELECT public.has_company_access((SELECT auth.uid()), ((storage.foldername(name))[1])::uuid))
          )
          OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
        )
      )
      WITH CHECK (
        bucket_id = 'reconciliation-evidence'
        AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role, 'finance_operator'::public.app_role, 'reconciliation_officer'::public.app_role]))
      );
  END IF;
END $$;

-- 2. Extend bank_statement_imports & bank_statement_transactions for multi-channel tracking
ALTER TABLE public.bank_statement_imports
  ADD COLUMN IF NOT EXISTS entry_channel text NOT NULL DEFAULT 'file_upload';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bank_statement_imports_entry_channel_check'
  ) THEN
    ALTER TABLE public.bank_statement_imports
      ADD CONSTRAINT bank_statement_imports_entry_channel_check
      CHECK (entry_channel IN ('file_upload', 'manual_entry', 'api_sync'));
  END IF;
END $$;

ALTER TABLE public.bank_statement_transactions
  ADD COLUMN IF NOT EXISTS entry_channel text NOT NULL DEFAULT 'file_upload',
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS evidence_path text,
  ADD COLUMN IF NOT EXISTS maker_id uuid,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS classification_notes text,
  ADD COLUMN IF NOT EXISTS matched_payment_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bst_entry_channel_check'
  ) THEN
    ALTER TABLE public.bank_statement_transactions
      ADD CONSTRAINT bst_entry_channel_check
      CHECK (entry_channel IN ('file_upload', 'manual_entry', 'api_sync'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bst_approval_status_check'
  ) THEN
    ALTER TABLE public.bank_statement_transactions
      ADD CONSTRAINT bst_approval_status_check
      CHECK (approval_status IN ('pending_approval', 'approved', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bst_reason_code_check'
  ) THEN
    ALTER TABLE public.bank_statement_transactions
      ADD CONSTRAINT bst_reason_code_check
      CHECK (
        reason_code IS NULL OR reason_code IN (
          'COUNTER_PAYOUT',
          'CHEQUE_CLEARED',
          'RTGS_OFFLINE',
          'CONNECTIPS_MANUAL',
          'BANK_CHARGE',
          'INTEREST_CREDIT',
          'SWEEP_INTERNAL',
          'SUSPENSE_UNIDENTIFIED',
          'ROUNDING_ADJUSTMENT',
          'MANUAL_PAIR'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bst_company_status_date
  ON public.bank_statement_transactions (company_id, reconciliation_status, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_bst_approval_status
  ON public.bank_statement_transactions (company_id, approval_status);

CREATE INDEX IF NOT EXISTS idx_re_company_status_created
  ON public.reconciliation_exceptions (company_id, status, created_at DESC);

-- 3. Formal Bank Reconciliation Statement (BRS) Period Lock table
CREATE TABLE IF NOT EXISTS public.reconciliation_period_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fiscal_year text,
  period_start date NOT NULL,
  period_end date NOT NULL,
  bank_closing_balance numeric(15,2) NOT NULL DEFAULT 0,
  ledger_control_balance numeric(15,2) NOT NULL DEFAULT 0,
  unreconciled_difference numeric(15,2) NOT NULL DEFAULT 0,
  outstanding_items_count integer NOT NULL DEFAULT 0,
  brs_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'Locked',
  maker_id uuid NOT NULL,
  approved_by uuid NOT NULL,
  approval_notes text NOT NULL,
  locked_at timestamp with time zone NOT NULL DEFAULT now(),
  reopened_by uuid,
  reopened_at timestamp with time zone,
  reopen_reason text,
  CONSTRAINT ck_rpl_dates_valid CHECK (period_end >= period_start),
  CONSTRAINT ck_rpl_status_valid CHECK (status IN ('Locked', 'Reopened')),
  CONSTRAINT ck_rpl_maker_checker CHECK (maker_id <> approved_by),
  CONSTRAINT ck_rpl_zero_variance CHECK (abs(unreconciled_difference) <= 0.05),
  CONSTRAINT ck_rpl_notes_not_empty CHECK (length(trim(approval_notes)) >= 5)
);

CREATE INDEX IF NOT EXISTS idx_rpl_company_period
  ON public.reconciliation_period_locks (company_id, period_start DESC, period_end DESC);

ALTER TABLE public.reconciliation_period_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rpl_select" ON public.reconciliation_period_locks;
CREATE POLICY "rpl_select" ON public.reconciliation_period_locks
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role,
      'supervisor'::public.app_role,
      'finance_operator'::public.app_role,
      'reconciliation_officer'::public.app_role,
      'auditor'::public.app_role,
      'approver'::public.app_role,
      'checker'::public.app_role,
      'report_viewer'::public.app_role
    ]))
    AND (
      (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR (SELECT public.has_company_access((SELECT auth.uid()), company_id))
    )
  );

DROP POLICY IF EXISTS "rpl_insert" ON public.reconciliation_period_locks;
CREATE POLICY "rpl_insert" ON public.reconciliation_period_locks
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role,
      'supervisor'::public.app_role,
      'approver'::public.app_role
    ]))
    AND (
      (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR (SELECT public.has_company_access((SELECT auth.uid()), company_id))
    )
  );

DROP POLICY IF EXISTS "rpl_update" ON public.reconciliation_period_locks;
CREATE POLICY "rpl_update" ON public.reconciliation_period_locks
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role,
      'supervisor'::public.app_role
    ]))
    AND (
      (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR (SELECT public.has_company_access((SELECT auth.uid()), company_id))
    )
  )
  WITH CHECK (
    (SELECT public.has_any_role((SELECT auth.uid()), ARRAY[
      'admin'::public.app_role,
      'supervisor'::public.app_role
    ]))
  );

DROP POLICY IF EXISTS "rpl_delete" ON public.reconciliation_period_locks;
CREATE POLICY "rpl_delete" ON public.reconciliation_period_locks
  FOR DELETE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reconciliation_period_locks TO authenticated, service_role;

-- 4. RPC: Submit a manual off-file bank/cheque/RTGS statement entry for Maker-Checker review
CREATE OR REPLACE FUNCTION public.submit_manual_bank_entry_atomic(p_entry jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_is_service_role boolean;
  v_uid uuid;
  v_company_id uuid;
  v_txn_date date;
  v_debit numeric(15,2);
  v_credit numeric(15,2);
  v_reference text;
  v_description text;
  v_bank_name text;
  v_account_no text;
  v_reason_code text;
  v_evidence_path text;
  v_notes text;
  v_allocations jsonb;
  v_import_id uuid;
  v_txn_id uuid;
  v_approval_id uuid;
  v_fingerprint text;
  v_alloc_count int := 0;
  v_alloc_total numeric(15,2) := 0;
  v_entry_amount numeric(15,2);
BEGIN
  v_is_service_role := (
    current_user IN ('service_role', 'postgres')
    OR COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') = 'service_role'
  );

  IF NOT v_is_service_role THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer', 'maker', 'operator');
    v_uid := auth.uid();
  ELSE
    v_uid := COALESCE(auth.uid(), NULLIF(p_entry->>'requested_by', '')::uuid);
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated maker identity required' USING ERRCODE = '42501';
  END IF;

  v_company_id := NULLIF(p_entry->>'company_id', '')::uuid;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required for manual bank entry' USING ERRCODE = '23502';
  END IF;

  IF NOT v_is_service_role AND NOT public.has_company_access(v_uid, v_company_id) THEN
    RAISE EXCEPTION 'Forbidden: caller lacks access to target company %', v_company_id USING ERRCODE = '42501';
  END IF;

  v_txn_date := COALESCE(NULLIF(p_entry->>'transaction_date', '')::date, CURRENT_DATE);
  v_debit := ROUND(COALESCE(NULLIF(p_entry->>'debit_amount', '')::numeric, 0), 2);
  v_credit := ROUND(COALESCE(NULLIF(p_entry->>'credit_amount', '')::numeric, 0), 2);
  v_reference := trim(COALESCE(p_entry->>'reference', ''));
  v_description := trim(COALESCE(p_entry->>'description', ''));
  v_bank_name := COALESCE(NULLIF(trim(p_entry->>'bank_name'), ''), 'Manual Counter / Bank Voucher');
  v_account_no := COALESCE(NULLIF(trim(p_entry->>'account_no'), ''), 'MANUAL_VOUCHER');
  v_reason_code := UPPER(trim(COALESCE(p_entry->>'reason_code', 'COUNTER_PAYOUT')));
  v_evidence_path := NULLIF(trim(COALESCE(p_entry->>'evidence_path', '')), '');
  v_notes := trim(COALESCE(p_entry->>'notes', ''));
  v_allocations := COALESCE(p_entry->'allocations', '[]'::jsonb);

  IF (v_debit <= 0 AND v_credit <= 0) OR (v_debit > 0 AND v_credit > 0) THEN
    RAISE EXCEPTION 'Exactly one of debit_amount or credit_amount must be greater than zero' USING ERRCODE = '23514';
  END IF;

  IF length(v_reference) < 2 THEN
    RAISE EXCEPTION 'External cheque, UTR, or voucher reference is mandatory' USING ERRCODE = '23514';
  END IF;

  IF v_reason_code NOT IN (
    'COUNTER_PAYOUT', 'CHEQUE_CLEARED', 'RTGS_OFFLINE', 'CONNECTIPS_MANUAL',
    'BANK_CHARGE', 'INTEREST_CREDIT', 'SWEEP_INTERNAL', 'SUSPENSE_UNIDENTIFIED',
    'ROUNDING_ADJUSTMENT', 'MANUAL_PAIR'
  ) THEN
    RAISE EXCEPTION 'Invalid reconciliation reason_code: %', v_reason_code USING ERRCODE = '23514';
  END IF;

  -- Check reconciliation period lock
  IF EXISTS (
    SELECT 1 FROM public.reconciliation_period_locks
    WHERE company_id = v_company_id
      AND status = 'Locked'
      AND v_txn_date BETWEEN period_start AND period_end
  ) THEN
    RAISE EXCEPTION 'Reconciliation period covering % is locked for this company. Reopen the period before adding entries.', v_txn_date USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(v_allocations) = 'array' AND jsonb_array_length(v_allocations) > 0 THEN
    v_alloc_count := jsonb_array_length(v_allocations);
    SELECT COALESCE(SUM(ROUND(COALESCE((elem->>'amount')::numeric, 0), 2)), 0)
      INTO v_alloc_total
    FROM jsonb_array_elements(v_allocations) elem;

    v_entry_amount := GREATEST(v_debit, v_credit);
    IF v_alloc_total <= 0 THEN
      RAISE EXCEPTION 'Paired payable allocations must sum to a positive amount' USING ERRCODE = '23514';
    END IF;
    IF abs(v_alloc_total - v_entry_amount) > 10.00 THEN
      RAISE EXCEPTION 'Allocated payable sum (%) differs from manual voucher amount (%) beyond allowable fee/rounding variance tolerance', v_alloc_total, v_entry_amount USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Reuse or create per-company manual import bucket
  SELECT id INTO v_import_id
  FROM public.bank_statement_imports
  WHERE company_id = v_company_id
    AND entry_channel = 'manual_entry'
    AND file_name = 'Manual Reconciliation Entries'
  LIMIT 1;

  IF v_import_id IS NULL THEN
    INSERT INTO public.bank_statement_imports (
      company_id, bank_name, account_no, file_name, file_hash_sha256,
      opening_balance, closing_balance, total_debit, total_credit, row_count,
      status, entry_channel, created_by
    ) VALUES (
      v_company_id, v_bank_name, v_account_no, 'Manual Reconciliation Entries',
      encode(extensions.digest((v_company_id::text || '|manual_bucket')::bytea, 'sha256'), 'hex'),
      0, 0, v_debit, v_credit, 1,
      'imported', 'manual_entry', v_uid
    )
    ON CONFLICT (company_id, file_hash_sha256) DO UPDATE
      SET updated_at = now()
    RETURNING id INTO v_import_id;
  ELSE
    UPDATE public.bank_statement_imports
    SET total_debit = total_debit + v_debit,
        total_credit = total_credit + v_credit,
        row_count = row_count + 1,
        updated_at = now()
    WHERE id = v_import_id;
  END IF;

  v_fingerprint := encode(
    extensions.digest(
      (v_company_id::text || '|manual|' || gen_random_uuid()::text || '|' || v_txn_date::text || '|' || v_reference || '|' || v_debit::text || '|' || v_credit::text)::bytea,
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.bank_statement_transactions (
    import_id, company_id, transaction_date, description, reference,
    debit_amount, credit_amount, balance, raw_data, transaction_fingerprint,
    reconciliation_status, entry_channel, reason_code, evidence_path,
    maker_id, approval_status, classification_notes
  ) VALUES (
    v_import_id, v_company_id, v_txn_date,
    COALESCE(NULLIF(v_description, ''), v_reason_code || ' - ' || v_reference),
    v_reference, v_debit, v_credit, NULL,
    jsonb_build_object(
      'bank_name', v_bank_name,
      'account_no', v_account_no,
      'reason_code', v_reason_code,
      'notes', v_notes
    ),
    v_fingerprint, 'unreconciled', 'manual_entry', v_reason_code,
    v_evidence_path, v_uid, 'pending_approval', NULLIF(v_notes, '')
  )
  RETURNING id INTO v_txn_id;

  INSERT INTO public.pending_approvals (
    entity_type, entity_id, action, status, requested_by, payload
  ) VALUES (
    'manual_reconciliation',
    v_txn_id,
    'MANUAL_BANK_ENTRY',
    'Pending'::public.approval_status,
    v_uid,
    jsonb_build_object(
      'company_id', v_company_id,
      'transaction_id', v_txn_id,
      'transaction_ids', jsonb_build_array(v_txn_id),
      'transaction_date', v_txn_date,
      'debit_amount', v_debit,
      'credit_amount', v_credit,
      'reference', v_reference,
      'description', COALESCE(NULLIF(v_description, ''), v_reason_code || ' - ' || v_reference),
      'bank_name', v_bank_name,
      'reason_code', v_reason_code,
      'evidence_path', v_evidence_path,
      'notes', v_notes,
      'allocations', v_allocations,
      'alloc_count', v_alloc_count,
      'alloc_total', v_alloc_total
    )
  )
  RETURNING id INTO v_approval_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
  VALUES (
    v_uid,
    'MANUAL_RECONCILIATION_SUBMITTED',
    'bank_statement_transactions',
    v_txn_id::text,
    jsonb_build_object(
      'approval_id', v_approval_id,
      'company_id', v_company_id,
      'reason_code', v_reason_code,
      'reference', v_reference,
      'debit_amount', v_debit,
      'credit_amount', v_credit,
      'alloc_count', v_alloc_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_txn_id,
    'approval_id', v_approval_id,
    'status', 'pending_approval'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_manual_bank_entry_atomic(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_manual_bank_entry_atomic(jsonb) TO authenticated, service_role;

-- 5. RPC: Submit manual pairing (1-1, 1-N, N-1) or non-payable classification on existing bank lines
CREATE OR REPLACE FUNCTION public.submit_manual_match_request_atomic(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_is_service_role boolean;
  v_uid uuid;
  v_mode text;
  v_company_id uuid;
  v_txn_ids uuid[];
  v_primary_txn_id uuid;
  v_txn_date date;
  v_reason_code text;
  v_notes text;
  v_evidence_path text;
  v_allocations jsonb;
  v_bank_total numeric(15,2) := 0;
  v_alloc_total numeric(15,2) := 0;
  v_alloc_count int := 0;
  v_locked_count int := 0;
  v_approval_id uuid;
  v_action text;
  v_refs text;
BEGIN
  v_is_service_role := (
    current_user IN ('service_role', 'postgres')
    OR COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') = 'service_role'
  );

  IF NOT v_is_service_role THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer', 'maker', 'operator');
    v_uid := auth.uid();
  ELSE
    v_uid := COALESCE(auth.uid(), NULLIF(p_request->>'requested_by', '')::uuid);
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated maker identity required' USING ERRCODE = '42501';
  END IF;

  v_company_id := NULLIF(p_request->>'company_id', '')::uuid;
  v_mode := COALESCE(NULLIF(trim(p_request->>'mode'), ''), 'pair_payables');
  v_reason_code := UPPER(trim(COALESCE(p_request->>'reason_code', CASE WHEN v_mode = 'classify_non_payable' THEN 'BANK_CHARGE' ELSE 'MANUAL_PAIR' END)));
  v_notes := trim(COALESCE(p_request->>'notes', ''));
  v_evidence_path := NULLIF(trim(COALESCE(p_request->>'evidence_path', '')), '');
  v_allocations := COALESCE(p_request->'allocations', '[]'::jsonb);

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required' USING ERRCODE = '23502';
  END IF;

  IF NOT v_is_service_role AND NOT public.has_company_access(v_uid, v_company_id) THEN
    RAISE EXCEPTION 'Forbidden: caller lacks access to company %', v_company_id USING ERRCODE = '42501';
  END IF;

  SELECT ARRAY_AGG(val::uuid)
    INTO v_txn_ids
  FROM jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(p_request->'transaction_ids') = 'array' THEN p_request->'transaction_ids'
      WHEN NULLIF(p_request->>'transaction_id', '') IS NOT NULL THEN jsonb_build_array(p_request->>'transaction_id')
      ELSE '[]'::jsonb
    END
  ) AS val;

  IF v_txn_ids IS NULL OR array_length(v_txn_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one bank_statement_transactions id is required' USING ERRCODE = '23502';
  END IF;

  v_primary_txn_id := v_txn_ids[1];

  IF v_reason_code NOT IN (
    'COUNTER_PAYOUT', 'CHEQUE_CLEARED', 'RTGS_OFFLINE', 'CONNECTIPS_MANUAL',
    'BANK_CHARGE', 'INTEREST_CREDIT', 'SWEEP_INTERNAL', 'SUSPENSE_UNIDENTIFIED',
    'ROUNDING_ADJUSTMENT', 'MANUAL_PAIR'
  ) THEN
    RAISE EXCEPTION 'Invalid reason_code: %', v_reason_code USING ERRCODE = '23514';
  END IF;

  IF length(v_notes) < 3 THEN
    RAISE EXCEPTION 'Justification notes (min 3 chars) are required for manual match/classification' USING ERRCODE = '23514';
  END IF;

  -- Lock involved bank transactions and confirm ownership + unreconciled state
  SELECT
    COUNT(*),
    COALESCE(SUM(GREATEST(COALESCE(debit_amount, 0), COALESCE(credit_amount, 0))), 0),
    MIN(transaction_date),
    STRING_AGG(COALESCE(reference, left(id::text, 8)), ', ')
  INTO v_locked_count, v_bank_total, v_txn_date, v_refs
  FROM public.bank_statement_transactions
  WHERE id = ANY(v_txn_ids)
    AND company_id = v_company_id
    AND reconciliation_status = 'unreconciled'
    AND approval_status <> 'pending_approval';

  IF v_locked_count <> array_length(v_txn_ids, 1) THEN
    RAISE EXCEPTION 'One or more selected bank statement transactions are missing, locked in pending review, belong to another company, or are already reconciled' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reconciliation_period_locks
    WHERE company_id = v_company_id
      AND status = 'Locked'
      AND v_txn_date BETWEEN period_start AND period_end
  ) THEN
    RAISE EXCEPTION 'Reconciliation period covering % is locked for this company', v_txn_date USING ERRCODE = '42501';
  END IF;

  IF v_mode = 'pair_payables' THEN
    IF jsonb_typeof(v_allocations) <> 'array' OR jsonb_array_length(v_allocations) = 0 THEN
      RAISE EXCEPTION 'At least one payable allocation is required for manual pairing' USING ERRCODE = '23502';
    END IF;
    v_alloc_count := jsonb_array_length(v_allocations);
    SELECT COALESCE(SUM(ROUND(COALESCE((elem->>'amount')::numeric, 0), 2)), 0)
      INTO v_alloc_total
    FROM jsonb_array_elements(v_allocations) elem;

    IF v_alloc_total <= 0 THEN
      RAISE EXCEPTION 'Allocated payable amount must be greater than zero' USING ERRCODE = '23514';
    END IF;
    v_action := 'MANUAL_MATCH_PAIRING';
  ELSIF v_mode = 'classify_non_payable' THEN
    v_action := 'NON_PAYABLE_CLASSIFICATION';
  ELSE
    RAISE EXCEPTION 'Unsupported mode: %', v_mode USING ERRCODE = '23514';
  END IF;

  UPDATE public.bank_statement_transactions
  SET approval_status = 'pending_approval',
      maker_id = v_uid,
      reason_code = v_reason_code,
      classification_notes = v_notes,
      evidence_path = COALESCE(v_evidence_path, evidence_path)
  WHERE id = ANY(v_txn_ids)
    AND company_id = v_company_id;

  INSERT INTO public.pending_approvals (
    entity_type, entity_id, action, status, requested_by, payload
  ) VALUES (
    'manual_reconciliation',
    v_primary_txn_id,
    v_action,
    'Pending'::public.approval_status,
    v_uid,
    jsonb_build_object(
      'company_id', v_company_id,
      'mode', v_mode,
      'transaction_id', v_primary_txn_id,
      'transaction_ids', to_jsonb(v_txn_ids),
      'transaction_date', v_txn_date,
      'reference', v_refs,
      'bank_total_amount', v_bank_total,
      'reason_code', v_reason_code,
      'evidence_path', v_evidence_path,
      'notes', v_notes,
      'allocations', v_allocations,
      'alloc_count', v_alloc_count,
      'alloc_total', v_alloc_total
    )
  )
  RETURNING id INTO v_approval_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
  VALUES (
    v_uid,
    'MANUAL_MATCH_REQUESTED',
    'bank_statement_transactions',
    v_primary_txn_id::text,
    jsonb_build_object(
      'approval_id', v_approval_id,
      'mode', v_mode,
      'company_id', v_company_id,
      'transaction_count', v_locked_count,
      'bank_total', v_bank_total,
      'alloc_count', v_alloc_count,
      'alloc_total', v_alloc_total,
      'reason_code', v_reason_code
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'approval_id', v_approval_id,
    'transaction_count', v_locked_count,
    'status', 'pending_approval'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_manual_match_request_atomic(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_manual_match_request_atomic(jsonb) TO authenticated, service_role;

-- 6. RPC: Checker decision on manual reconciliation request (strict Maker <> Checker + atomic settlement)
CREATE OR REPLACE FUNCTION public.decide_manual_reconciliation_atomic(
  p_approval_id uuid,
  p_decision text,
  p_review_notes text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_is_service_role boolean;
  v_uid uuid;
  v_pa RECORD;
  v_payload jsonb;
  v_company_id uuid;
  v_txn_ids uuid[];
  v_primary_txn RECORD;
  v_alloc jsonb;
  v_allocations jsonb;
  v_payable_id uuid;
  v_raw_type text;
  v_norm_type text;
  v_alloc_amt numeric(15,2);
  v_applied numeric(15,2);
  v_remaining numeric(15,2);
  v_pay_rec RECORD;
  v_run_id uuid;
  v_batch_id uuid;
  v_total_applied numeric(15,2) := 0;
  v_total_payments int := 0;
  v_method public.payment_method;
  v_reason_code text;
  v_payment_date date;
  v_payment_ref text;
  v_new_status text;
  v_result_enum public.reconciliation_result;
BEGIN
  v_is_service_role := (
    current_user IN ('service_role', 'postgres')
    OR COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') = 'service_role'
  );

  IF NOT v_is_service_role THEN
    PERFORM public.require_role('admin', 'supervisor', 'checker', 'approver');
    v_uid := auth.uid();
  ELSE
    v_uid := COALESCE(auth.uid(), p_actor_id);
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated checker/approver identity is required' USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('Approved', 'Rejected') THEN
    RAISE EXCEPTION 'Decision must be Approved or Rejected (got: %)', p_decision USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_pa
  FROM public.pending_approvals
  WHERE id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval request % not found', p_approval_id USING ERRCODE = 'P0002';
  END IF;

  IF v_pa.entity_type <> 'manual_reconciliation' THEN
    RAISE EXCEPTION 'Approval % is not a manual_reconciliation request', p_approval_id USING ERRCODE = '23514';
  END IF;

  IF v_pa.status::text <> 'Pending' THEN
    RAISE EXCEPTION 'Approval % has already been decided (%)', p_approval_id, v_pa.status USING ERRCODE = '23514';
  END IF;

  IF v_pa.requested_by IS NOT NULL AND v_uid = v_pa.requested_by THEN
    RAISE EXCEPTION 'Maker-checker policy violation: approver cannot decide their own manual reconciliation submission' USING ERRCODE = '42501';
  END IF;

  v_payload := COALESCE(v_pa.payload, '{}'::jsonb);
  v_company_id := NULLIF(v_payload->>'company_id', '')::uuid;

  IF v_company_id IS NOT NULL AND NOT v_is_service_role THEN
    IF NOT public.has_company_access(v_uid, v_company_id) THEN
      RAISE EXCEPTION 'Forbidden: checker lacks access to company %', v_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT ARRAY_AGG(val::uuid)
    INTO v_txn_ids
  FROM jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(v_payload->'transaction_ids') = 'array' THEN v_payload->'transaction_ids'
      WHEN v_pa.entity_id IS NOT NULL THEN jsonb_build_array(v_pa.entity_id::text)
      ELSE '[]'::jsonb
    END
  ) AS val;

  -- Handle Rejection cleanly
  IF p_decision = 'Rejected' THEN
    IF v_txn_ids IS NOT NULL THEN
      UPDATE public.bank_statement_transactions
      SET approval_status = CASE WHEN entry_channel = 'manual_entry' THEN 'rejected' ELSE 'approved' END,
          reconciliation_status = 'unreconciled',
          classification_notes = COALESCE(NULLIF(trim(p_review_notes), ''), classification_notes)
      WHERE id = ANY(v_txn_ids)
        AND company_id = v_company_id;
    END IF;

    UPDATE public.pending_approvals
    SET status = 'Rejected'::public.approval_status,
        reviewed_by = v_uid,
        review_notes = NULLIF(trim(p_review_notes), ''),
        reviewed_at = now()
    WHERE id = p_approval_id;

    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
    VALUES (
      v_uid,
      'MANUAL_RECONCILIATION_REJECTED',
      'pending_approvals',
      p_approval_id::text,
      jsonb_build_object('company_id', v_company_id, 'review_notes', p_review_notes)
    );

    RETURN jsonb_build_object('success', true, 'decision', 'Rejected', 'approval_id', p_approval_id);
  END IF;

  -- Decision = Approved
  SELECT * INTO v_primary_txn
  FROM public.bank_statement_transactions
  WHERE id = v_txn_ids[1]
    AND company_id = v_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Primary bank statement transaction % not found', v_txn_ids[1] USING ERRCODE = 'P0002';
  END IF;

  v_reason_code := UPPER(COALESCE(v_payload->>'reason_code', v_primary_txn.reason_code, 'MANUAL_PAIR'));
  v_payment_date := COALESCE(v_primary_txn.transaction_date, CURRENT_DATE);
  v_payment_ref := COALESCE(NULLIF(v_primary_txn.reference, ''), 'MANUAL-' || left(p_approval_id::text, 8));
  v_allocations := COALESCE(v_payload->'allocations', '[]'::jsonb);

  -- Case A: Non-payable bank line classification (Bank Charge, Interest, Internal Sweep, Suspense)
  IF v_pa.action = 'NON_PAYABLE_CLASSIFICATION' THEN
    UPDATE public.bank_statement_transactions
    SET reconciliation_status = 'ignored',
        approval_status = 'approved',
        approved_by = v_uid,
        reason_code = v_reason_code,
        classification_notes = COALESCE(NULLIF(trim(p_review_notes), ''), v_payload->>'notes', classification_notes)
    WHERE id = ANY(v_txn_ids)
      AND company_id = v_company_id;

    UPDATE public.pending_approvals
    SET status = 'Approved'::public.approval_status,
        reviewed_by = v_uid,
        review_notes = NULLIF(trim(p_review_notes), ''),
        reviewed_at = now()
    WHERE id = p_approval_id;

    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
    VALUES (
      v_uid,
      'NON_PAYABLE_BANK_LINE_APPROVED',
      'bank_statement_transactions',
      v_primary_txn.id::text,
      jsonb_build_object('approval_id', p_approval_id, 'reason_code', v_reason_code, 'company_id', v_company_id)
    );

    RETURN jsonb_build_object('success', true, 'decision', 'Approved', 'mode', 'non_payable', 'approval_id', p_approval_id);
  END IF;

  -- Case B: Manual bank statement entry with NO payable allocations yet (approves into unreconciled ledger)
  IF jsonb_typeof(v_allocations) <> 'array' OR jsonb_array_length(v_allocations) = 0 THEN
    UPDATE public.bank_statement_transactions
    SET approval_status = 'approved',
        approved_by = v_uid,
        reconciliation_status = 'unreconciled'
    WHERE id = ANY(v_txn_ids)
      AND company_id = v_company_id;

    UPDATE public.pending_approvals
    SET status = 'Approved'::public.approval_status,
        reviewed_by = v_uid,
        review_notes = NULLIF(trim(p_review_notes), ''),
        reviewed_at = now()
    WHERE id = p_approval_id;

    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
    VALUES (
      v_uid,
      'MANUAL_BANK_ENTRY_APPROVED',
      'bank_statement_transactions',
      v_primary_txn.id::text,
      jsonb_build_object('approval_id', p_approval_id, 'company_id', v_company_id, 'reference', v_payment_ref)
    );

    RETURN jsonb_build_object('success', true, 'decision', 'Approved', 'mode', 'ledger_only', 'approval_id', p_approval_id);
  END IF;

  -- Case C: Settle paired payable allocations atomically with Maker-Checker run + batch parity
  v_method := CASE v_reason_code
    WHEN 'RTGS_OFFLINE' THEN 'RTGS'::public.payment_method
    WHEN 'CHEQUE_CLEARED' THEN 'Cheque'::public.payment_method
    WHEN 'COUNTER_PAYOUT' THEN 'Cash'::public.payment_method
    WHEN 'CONNECTIPS_MANUAL' THEN 'ConnectIPS'::public.payment_method
    ELSE 'Manual'::public.payment_method
  END;

  INSERT INTO public.reconciliation_runs (
    company_id, source_type, file_name, file_hash_sha256,
    row_count, total_amount, matched_count, unmatched_count, partial_count, rejected_count,
    status, created_by, applied_by, applied_at, notes
  ) VALUES (
    v_company_id, 'manual', 'Manual Reconciliation (' || v_payment_ref || ')',
    encode(extensions.digest((p_approval_id::text || '|manual_run')::bytea, 'sha256'), 'hex'),
    jsonb_array_length(v_allocations), 0, 0, 0, 0, 0,
    'applied', v_pa.requested_by, v_uid, now(),
    COALESCE(NULLIF(trim(p_review_notes), ''), v_payload->>'notes', 'Manual Maker-Checker Reconciliation')
  )
  RETURNING id INTO v_run_id;

  PERFORM set_config('rtarts.completing_batch', 'true', true);

  INSERT INTO public.payment_batches (
    batch_name, company_id, payable_type, total_payments, total_amount, total_tax,
    status, payment_method, created_by, approved_by, approved_at, processed_at, completed_at
  ) VALUES (
    'Manual Recon — ' || v_payment_ref, v_company_id, 'mixed', 0, 0, 0,
    'Completed'::public.payment_batch_status, v_method::text,
    v_pa.requested_by, v_uid, now(), now(), now()
  )
  RETURNING id INTO v_batch_id;

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_allocations)
  LOOP
    v_payable_id := NULLIF(v_alloc->>'payable_id', '')::uuid;
    v_raw_type := LOWER(COALESCE(v_alloc->>'payable_type', 'dividend'));
    v_alloc_amt := ROUND(COALESCE(NULLIF(v_alloc->>'amount', '')::numeric, 0), 2);

    IF v_payable_id IS NULL OR v_alloc_amt <= 0 THEN
      RAISE EXCEPTION 'Each allocation requires a valid payable_id and positive amount' USING ERRCODE = '23514';
    END IF;

    v_norm_type := CASE
      WHEN v_raw_type LIKE '%interest%' OR v_raw_type LIKE '%debenture%' THEN 'interest'
      WHEN v_raw_type LIKE '%mutual%' THEN 'mutual_fund'
      ELSE 'dividend'
    END;

    IF v_norm_type = 'dividend' THEN
      SELECT id, company_id, client_id, fiscal_year, net_payable, COALESCE(paid_amount, 0) AS paid_amount,
             payment_status::text AS payment_status, payee_classification, classification_status
        INTO v_pay_rec
      FROM public.dividend_payables
      WHERE id = v_payable_id AND company_id = v_company_id
      FOR UPDATE;
    ELSIF v_norm_type = 'interest' THEN
      SELECT id, company_id, client_id, fiscal_year, net_payable, COALESCE(paid_amount, 0) AS paid_amount,
             payment_status::text AS payment_status, payee_classification, classification_status
        INTO v_pay_rec
      FROM public.interest_payables
      WHERE id = v_payable_id AND company_id = v_company_id
      FOR UPDATE;
    ELSE
      SELECT id, company_id, client_id, fiscal_year, net_payable, COALESCE(paid_amount, 0) AS paid_amount,
             payment_status::text AS payment_status, payee_classification, classification_status
        INTO v_pay_rec
      FROM public.mutual_fund_payables
      WHERE id = v_payable_id AND company_id = v_company_id
      FOR UPDATE;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target payable % (%) not found in company %', v_payable_id, v_norm_type, v_company_id USING ERRCODE = 'P0002';
    END IF;

    IF v_pay_rec.payment_status = 'Paid' THEN
      RAISE EXCEPTION 'Payable % is already fully Paid and cannot be manually re-settled', v_payable_id USING ERRCODE = '23514';
    END IF;

    IF COALESCE(v_pay_rec.payee_classification, 'UNCLASSIFIED') = 'UNCLASSIFIED'
       OR COALESCE(v_pay_rec.classification_status, '') = 'REVIEW_REQUIRED' THEN
      RAISE EXCEPTION 'Payable % requires tax classification review before settlement', v_payable_id USING ERRCODE = '23514';
    END IF;

    v_remaining := GREATEST(0, ROUND(COALESCE(v_pay_rec.net_payable, 0) - v_pay_rec.paid_amount, 2));
    v_applied := LEAST(v_remaining, v_alloc_amt);
    IF v_applied <= 0 THEN
      RAISE EXCEPTION 'Payable % has zero remaining balance', v_payable_id USING ERRCODE = '23514';
    END IF;

    IF (v_remaining - v_applied) <= 0.005 THEN
      v_new_status := 'Paid';
      v_result_enum := 'Matched'::public.reconciliation_result;
    ELSE
      v_new_status := 'Partial';
      v_result_enum := 'Partial'::public.reconciliation_result;
    END IF;

    IF v_norm_type = 'dividend' THEN
      UPDATE public.dividend_payables
      SET payment_status = v_new_status::public.payment_status,
          paid_amount = ROUND(v_pay_rec.paid_amount + v_applied, 2),
          remaining_amount = GREATEST(0, ROUND(v_remaining - v_applied, 2)),
          payment_date = COALESCE(payment_date, v_payment_date),
          payment_reference = COALESCE(payment_reference, v_payment_ref),
          updated_at = now()
      WHERE id = v_payable_id;
    ELSIF v_norm_type = 'interest' THEN
      UPDATE public.interest_payables
      SET payment_status = v_new_status::public.payment_status,
          paid_amount = ROUND(v_pay_rec.paid_amount + v_applied, 2),
          remaining_amount = GREATEST(0, ROUND(v_remaining - v_applied, 2)),
          payment_date = COALESCE(payment_date, v_payment_date),
          payment_reference = COALESCE(payment_reference, v_payment_ref),
          updated_at = now()
      WHERE id = v_payable_id;
    ELSE
      UPDATE public.mutual_fund_payables
      SET payment_status = v_new_status::public.payment_status,
          paid_amount = ROUND(v_pay_rec.paid_amount + v_applied, 2),
          remaining_amount = GREATEST(0, ROUND(v_remaining - v_applied, 2)),
          payment_date = COALESCE(payment_date, v_payment_date),
          payment_reference = COALESCE(payment_reference, v_payment_ref),
          updated_at = now()
      WHERE id = v_payable_id;
    END IF;

    INSERT INTO public.payments (
      batch_id, reconciliation_run_id, company_id, client_id, payable_type, payable_id,
      gross_amount, tax_amount, net_amount, paid_amount,
      payment_method, payment_date, payment_reference, status,
      approved_by, approved_at, processed_by, processed_at, created_by
    ) VALUES (
      v_batch_id, v_run_id, v_company_id, v_pay_rec.client_id, v_norm_type, v_payable_id,
      v_applied, 0, v_applied, v_applied,
      v_method, v_payment_date,
      CASE
        WHEN jsonb_array_length(v_allocations) > 1 THEN v_payment_ref || '-L' || (v_total_payments + 1)::text
        ELSE v_payment_ref
      END,
      'Paid',
      v_uid, now(), v_uid, now(), v_pa.requested_by
    );

    INSERT INTO public.reconciliation_results (
      run_id, reconciliation_date, source_reference, source_a_type, source_a_id,
      source_b_type, source_b_id, client_id, company_id, fiscal_year,
      payable_type, payable_id, batch_id,
      expected_amount, actual_amount, difference, result, notes,
      match_method, match_confidence, candidate_count, rule_version,
      requires_manual_approval, matched_by, matched_at,
      prior_paid_amount, prior_payment_status
    ) VALUES (
      v_run_id, v_payment_date, v_payment_ref || '::' || v_payable_id::text,
      'manual_entry', v_primary_txn.id, 'payable', v_payable_id,
      v_pay_rec.client_id, v_company_id, v_pay_rec.fiscal_year,
      v_norm_type, v_payable_id, v_batch_id,
      v_remaining, v_applied, ROUND(v_applied - v_remaining, 2), v_result_enum,
      COALESCE(NULLIF(trim(p_review_notes), ''), v_payload->>'notes', 'Manual Maker-Checker Reconciliation'),
      'manual', 100, 1, '3.0.0',
      false, v_pa.requested_by, now(),
      v_pay_rec.paid_amount, v_pay_rec.payment_status
    );

    v_total_applied := v_total_applied + v_applied;
    v_total_payments := v_total_payments + 1;
  END LOOP;

  UPDATE public.payment_batches
  SET total_payments = v_total_payments,
      total_amount = v_total_applied,
      updated_at = now()
  WHERE id = v_batch_id;

  PERFORM set_config('rtarts.completing_batch', 'false', true);

  UPDATE public.reconciliation_runs
  SET total_amount = v_total_applied,
      matched_count = v_total_payments,
      batch_id = v_batch_id,
      updated_at = now()
  WHERE id = v_run_id;

  UPDATE public.bank_statement_transactions
  SET reconciliation_status = 'reconciled',
      approval_status = 'approved',
      approved_by = v_uid,
      reconciliation_run_id = v_run_id,
      classification_notes = COALESCE(NULLIF(trim(p_review_notes), ''), classification_notes)
  WHERE id = ANY(v_txn_ids)
    AND company_id = v_company_id;

  UPDATE public.pending_approvals
  SET status = 'Approved'::public.approval_status,
      reviewed_by = v_uid,
      review_notes = NULLIF(trim(p_review_notes), ''),
      reviewed_at = now()
  WHERE id = p_approval_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
  VALUES (
    v_uid,
    'MANUAL_RECONCILIATION_APPROVED',
    'reconciliation_runs',
    v_run_id::text,
    jsonb_build_object(
      'approval_id', p_approval_id,
      'company_id', v_company_id,
      'batch_id', v_batch_id,
      'settled_count', v_total_payments,
      'settled_amount', v_total_applied
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'decision', 'Approved',
    'mode', 'settled',
    'approval_id', p_approval_id,
    'run_id', v_run_id,
    'batch_id', v_batch_id,
    'settled_count', v_total_payments,
    'settled_amount', v_total_applied
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('rtarts.completing_batch', 'false', true);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.decide_manual_reconciliation_atomic(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_manual_reconciliation_atomic(uuid, text, text, uuid) TO authenticated, service_role;

-- 7. RPC: Authoritative Bank Reconciliation Statement (BRS) & Aging Summary
CREATE OR REPLACE FUNCTION public.get_bank_reconciliation_statement(
  p_company_id uuid,
  p_period_start date,
  p_period_end date,
  p_bank_closing_balance numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_is_service_role boolean;
  v_uid uuid;
  v_bank_total_debit numeric(15,2) := 0;
  v_bank_total_credit numeric(15,2) := 0;
  v_reconciled_bank_debits numeric(15,2) := 0;
  v_unreconciled_bank_debits numeric(15,2) := 0;
  v_unreconciled_bank_credits numeric(15,2) := 0;
  v_non_payable_bank_debits numeric(15,2) := 0;
  v_non_payable_bank_credits numeric(15,2) := 0;
  v_pending_manual_amount numeric(15,2) := 0;
  v_pending_manual_count bigint := 0;
  v_ledger_paid_total numeric(15,2) := 0;
  v_ledger_unreconciled_batches numeric(15,2) := 0;
  v_open_exceptions_count bigint := 0;
  v_open_exceptions_amount numeric(15,2) := 0;
  v_unapproved_variances_count bigint := 0;
  v_age_0_7_cnt bigint := 0;
  v_age_0_7_amt numeric(15,2) := 0;
  v_age_8_30_cnt bigint := 0;
  v_age_8_30_amt numeric(15,2) := 0;
  v_age_31_90_cnt bigint := 0;
  v_age_31_90_amt numeric(15,2) := 0;
  v_age_90_plus_cnt bigint := 0;
  v_age_90_plus_amt numeric(15,2) := 0;
  v_inferred_closing numeric(15,2) := 0;
  v_bank_closing numeric(15,2) := 0;
  v_reconciled_net_outflow numeric(15,2) := 0;
  v_brs_adjusted_bank numeric(15,2) := 0;
  v_unreconciled_variance numeric(15,2) := 0;
  v_is_period_locked boolean := false;
BEGIN
  v_is_service_role := (
    current_user IN ('service_role', 'postgres')
    OR COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') = 'service_role'
  );

  IF NOT v_is_service_role THEN
    PERFORM public.require_role('admin', 'supervisor', 'finance_operator', 'reconciliation_officer', 'auditor', 'approver', 'checker', 'report_viewer', 'operator', 'maker');
    v_uid := auth.uid();
    IF v_uid IS NULL OR NOT public.has_company_access(v_uid, p_company_id) THEN
      RAISE EXCEPTION 'Forbidden: caller lacks access to company %', p_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_company_id IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Valid company_id and date window required' USING ERRCODE = '23514';
  END IF;

  SELECT
    COALESCE(SUM(debit_amount), 0),
    COALESCE(SUM(credit_amount), 0),
    COALESCE(SUM(debit_amount) FILTER (WHERE reconciliation_status = 'reconciled'), 0),
    COALESCE(SUM(debit_amount) FILTER (WHERE reconciliation_status = 'unreconciled'), 0),
    COALESCE(SUM(credit_amount) FILTER (WHERE reconciliation_status = 'unreconciled'), 0),
    COALESCE(SUM(debit_amount) FILTER (WHERE reconciliation_status = 'ignored'), 0),
    COALESCE(SUM(credit_amount) FILTER (WHERE reconciliation_status = 'ignored'), 0),
    COALESCE(SUM(GREATEST(debit_amount, credit_amount)) FILTER (WHERE approval_status = 'pending_approval'), 0),
    COUNT(*) FILTER (WHERE approval_status = 'pending_approval'),
    COUNT(*) FILTER (WHERE reconciliation_status = 'unreconciled' AND (p_period_end - transaction_date) BETWEEN 0 AND 7),
    COALESCE(SUM(GREATEST(debit_amount, credit_amount)) FILTER (WHERE reconciliation_status = 'unreconciled' AND (p_period_end - transaction_date) BETWEEN 0 AND 7), 0),
    COUNT(*) FILTER (WHERE reconciliation_status = 'unreconciled' AND (p_period_end - transaction_date) BETWEEN 8 AND 30),
    COALESCE(SUM(GREATEST(debit_amount, credit_amount)) FILTER (WHERE reconciliation_status = 'unreconciled' AND (p_period_end - transaction_date) BETWEEN 8 AND 30), 0),
    COUNT(*) FILTER (WHERE reconciliation_status = 'unreconciled' AND (p_period_end - transaction_date) BETWEEN 31 AND 90),
    COALESCE(SUM(GREATEST(debit_amount, credit_amount)) FILTER (WHERE reconciliation_status = 'unreconciled' AND (p_period_end - transaction_date) BETWEEN 31 AND 90), 0),
    COUNT(*) FILTER (WHERE reconciliation_status = 'unreconciled' AND (p_period_end - transaction_date) > 90),
    COALESCE(SUM(GREATEST(debit_amount, credit_amount)) FILTER (WHERE reconciliation_status = 'unreconciled' AND (p_period_end - transaction_date) > 90), 0)
  INTO
    v_bank_total_debit, v_bank_total_credit, v_reconciled_bank_debits,
    v_unreconciled_bank_debits, v_unreconciled_bank_credits,
    v_non_payable_bank_debits, v_non_payable_bank_credits,
    v_pending_manual_amount, v_pending_manual_count,
    v_age_0_7_cnt, v_age_0_7_amt,
    v_age_8_30_cnt, v_age_8_30_amt,
    v_age_31_90_cnt, v_age_31_90_amt,
    v_age_90_plus_cnt, v_age_90_plus_amt
  FROM public.bank_statement_transactions
  WHERE company_id = p_company_id
    AND transaction_date BETWEEN p_period_start AND p_period_end
    AND approval_status <> 'rejected';

  -- Ledger payments disbursed in window
  SELECT
    COALESCE(SUM(paid_amount) FILTER (WHERE status IN ('Paid', 'Completed')), 0),
    COALESCE(SUM(net_amount) FILTER (WHERE status IN ('Pending', 'Processing', 'Approved') AND reconciliation_run_id IS NULL), 0)
  INTO v_ledger_paid_total, v_ledger_unreconciled_batches
  FROM public.payments
  WHERE company_id = p_company_id
    AND COALESCE(payment_date, created_at::date) BETWEEN p_period_start AND p_period_end
    AND status NOT IN ('Reversed', 'Cancelled', 'Failed', 'Rejected', 'Returned');

  SELECT COUNT(*), COALESCE(SUM(COALESCE(amount, 0)), 0)
  INTO v_open_exceptions_count, v_open_exceptions_amount
  FROM public.reconciliation_exceptions
  WHERE company_id = p_company_id
    AND status IN ('Open', 'Investigating', 'Escalated');

  SELECT COUNT(*)
  INTO v_unapproved_variances_count
  FROM public.reconciliation_results
  WHERE company_id = p_company_id
    AND reconciliation_date BETWEEN p_period_start AND p_period_end
    AND requires_manual_approval = true;

  SELECT COALESCE(closing_balance, 0)
  INTO v_inferred_closing
  FROM public.bank_statement_imports
  WHERE company_id = p_company_id
    AND entry_channel <> 'manual_entry'
    AND closing_balance IS NOT NULL
    AND closing_balance <> 0
  ORDER BY created_at DESC
  LIMIT 1;

  v_bank_closing := COALESCE(p_bank_closing_balance, v_inferred_closing, 0);

  -- Canonical Cash Proof: Reconciled bank outflows + non-payable adjustments vs bank outflows
  v_reconciled_net_outflow := ROUND(v_reconciled_bank_debits + v_non_payable_bank_debits, 2);
  v_brs_adjusted_bank := ROUND(v_bank_total_debit - v_unreconciled_bank_debits - v_non_payable_bank_debits, 2);
  v_unreconciled_variance := ROUND(v_unreconciled_bank_debits + v_unreconciled_bank_credits, 2);

  SELECT EXISTS (
    SELECT 1 FROM public.reconciliation_period_locks
    WHERE company_id = p_company_id
      AND status = 'Locked'
      AND p_period_start >= period_start
      AND p_period_end <= period_end
  ) INTO v_is_period_locked;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'period_start', p_period_start,
    'period_end', p_period_end,
    'is_period_locked', v_is_period_locked,
    'bank_closing_balance', v_bank_closing,
    'bank_total_debit', v_bank_total_debit,
    'bank_total_credit', v_bank_total_credit,
    'reconciled_bank_debits', v_reconciled_bank_debits,
    'unreconciled_bank_debits', v_unreconciled_bank_debits,
    'unreconciled_bank_credits', v_unreconciled_bank_credits,
    'non_payable_bank_debits', v_non_payable_bank_debits,
    'non_payable_bank_credits', v_non_payable_bank_credits,
    'pending_manual_count', v_pending_manual_count,
    'pending_manual_amount', v_pending_manual_amount,
    'ledger_paid_total', v_ledger_paid_total,
    'in_transit_batches_amount', v_ledger_unreconciled_batches,
    'reconciled_net_outflow', v_reconciled_net_outflow,
    'adjusted_matched_bank_debits', v_brs_adjusted_bank,
    'unreconciled_variance', v_unreconciled_variance,
    'open_exceptions_count', v_open_exceptions_count,
    'open_exceptions_amount', v_open_exceptions_amount,
    'unapproved_variances_count', v_unapproved_variances_count,
    'aging', jsonb_build_object(
      'days_0_7', jsonb_build_object('count', v_age_0_7_cnt, 'amount', v_age_0_7_amt),
      'days_8_30', jsonb_build_object('count', v_age_8_30_cnt, 'amount', v_age_8_30_amt),
      'days_31_90', jsonb_build_object('count', v_age_31_90_cnt, 'amount', v_age_31_90_amt),
      'days_90_plus', jsonb_build_object('count', v_age_90_plus_cnt, 'amount', v_age_90_plus_amt)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_bank_reconciliation_statement(uuid, date, date, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bank_reconciliation_statement(uuid, date, date, numeric) TO authenticated, service_role;

-- 8. RPC: Certify & Lock Reconciliation Period (requires zero unreconciled variance + Maker-Checker)
CREATE OR REPLACE FUNCTION public.lock_reconciliation_period_atomic(p_lock_info jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_is_service_role boolean;
  v_uid uuid;
  v_company_id uuid;
  v_maker_id uuid;
  v_period_start date;
  v_period_end date;
  v_fiscal_year text;
  v_bank_closing numeric(15,2);
  v_notes text;
  v_brs jsonb;
  v_variance numeric(15,2);
  v_open_exc bigint;
  v_unapproved_var bigint;
  v_lock_id uuid;
BEGIN
  v_is_service_role := (
    current_user IN ('service_role', 'postgres')
    OR COALESCE((auth.jwt()->>'role'), current_setting('request.jwt.claim.role', true), '') = 'service_role'
  );

  IF NOT v_is_service_role THEN
    PERFORM public.require_role('admin', 'supervisor', 'approver');
    v_uid := auth.uid();
  ELSE
    v_uid := COALESCE(auth.uid(), NULLIF(p_lock_info->>'approved_by', '')::uuid);
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authenticated approver required to certify reconciliation period' USING ERRCODE = '42501';
  END IF;

  v_company_id := NULLIF(p_lock_info->>'company_id', '')::uuid;
  v_maker_id := COALESCE(NULLIF(p_lock_info->>'maker_id', '')::uuid, v_uid);
  v_period_start := NULLIF(p_lock_info->>'period_start', '')::date;
  v_period_end := NULLIF(p_lock_info->>'period_end', '')::date;
  v_fiscal_year := NULLIF(trim(COALESCE(p_lock_info->>'fiscal_year', '')), '');
  v_bank_closing := NULLIF(p_lock_info->>'bank_closing_balance', '')::numeric;
  v_notes := trim(COALESCE(p_lock_info->>'approval_notes', ''));

  IF v_company_id IS NULL OR v_period_start IS NULL OR v_period_end IS NULL THEN
    RAISE EXCEPTION 'company_id, period_start, and period_end are mandatory' USING ERRCODE = '23502';
  END IF;

  IF NOT v_is_service_role AND NOT public.has_company_access(v_uid, v_company_id) THEN
    RAISE EXCEPTION 'Forbidden: caller lacks access to company %', v_company_id USING ERRCODE = '42501';
  END IF;

  IF length(v_notes) < 5 THEN
    RAISE EXCEPTION 'Certification approval notes (min 5 characters) are mandatory' USING ERRCODE = '23514';
  END IF;

  IF v_maker_id = v_uid THEN
    RAISE EXCEPTION 'Maker-checker violation: period preparer (maker_id) and certifier (approved_by) must be distinct users' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reconciliation_period_locks
    WHERE company_id = v_company_id
      AND status = 'Locked'
      AND daterange(period_start, period_end, '[]') && daterange(v_period_start, v_period_end, '[]')
  ) THEN
    RAISE EXCEPTION 'An overlapping locked period already exists for this company' USING ERRCODE = '23505';
  END IF;

  v_brs := public.get_bank_reconciliation_statement(v_company_id, v_period_start, v_period_end, v_bank_closing);
  v_variance := COALESCE((v_brs->>'unreconciled_variance')::numeric, 0);
  v_open_exc := COALESCE((v_brs->>'open_exceptions_count')::bigint, 0);
  v_unapproved_var := COALESCE((v_brs->>'unapproved_variances_count')::bigint, 0);

  IF abs(v_variance) > 0.05 THEN
    RAISE EXCEPTION 'Cannot certify and lock period with unreconciled bank lines totaling NPR %', v_variance USING ERRCODE = '23514';
  END IF;

  IF v_unapproved_var > 0 THEN
    RAISE EXCEPTION 'Cannot lock period while % reconciliation variance(s) still require Checker approval', v_unapproved_var USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.reconciliation_period_locks (
    company_id, fiscal_year, period_start, period_end,
    bank_closing_balance, ledger_control_balance, unreconciled_difference,
    outstanding_items_count, brs_snapshot, status,
    maker_id, approved_by, approval_notes
  ) VALUES (
    v_company_id, v_fiscal_year, v_period_start, v_period_end,
    COALESCE((v_brs->>'bank_closing_balance')::numeric, 0),
    COALESCE((v_brs->>'ledger_paid_total')::numeric, 0),
    v_variance,
    v_open_exc::integer,
    v_brs,
    'Locked',
    v_maker_id, v_uid, v_notes
  )
  RETURNING id INTO v_lock_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_value)
  VALUES (
    v_uid,
    'RECONCILIATION_PERIOD_LOCKED',
    'reconciliation_period_locks',
    v_lock_id::text,
    jsonb_build_object(
      'company_id', v_company_id,
      'period_start', v_period_start,
      'period_end', v_period_end,
      'maker_id', v_maker_id,
      'bank_closing_balance', COALESCE((v_brs->>'bank_closing_balance')::numeric, 0)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'lock_id', v_lock_id,
    'brs', jsonb_set(v_brs, '{is_period_locked}', 'true'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lock_reconciliation_period_atomic(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_reconciliation_period_atomic(jsonb) TO authenticated, service_role;
