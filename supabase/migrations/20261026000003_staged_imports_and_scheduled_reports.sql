-- Migration: 20261026000003_staged_imports_and_scheduled_reports.sql
-- Description: Multi-tenant hardened import staging, atomic staged commit RPC with maker-checker segregation, scheduled reports, report versions, and report presets.

-- 1. Import Staging Table
CREATE TABLE IF NOT EXISTS public.import_staging (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    approval_id uuid REFERENCES public.pending_approvals(id) ON DELETE CASCADE,
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    target_table text NOT NULL,
    file_name text NOT NULL,
    file_hash text NOT NULL,
    sheet_name text,
    total_rows integer DEFAULT 0 NOT NULL,
    source_gross numeric DEFAULT 0 NOT NULL,
    source_tax numeric DEFAULT 0 NOT NULL,
    source_net numeric DEFAULT 0 NOT NULL,
    computed_gross numeric DEFAULT 0 NOT NULL,
    computed_tax numeric DEFAULT 0 NOT NULL,
    computed_net numeric DEFAULT 0 NOT NULL,
    staged_rows jsonb NOT NULL,
    options jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    upload_id uuid REFERENCES public.upload_history(id) ON DELETE SET NULL,
    status text DEFAULT 'STAGED' CHECK (status IN ('STAGED', 'COMMITTED', 'REJECTED')),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    committed_at timestamp with time zone
);

ALTER TABLE public.import_staging ADD COLUMN IF NOT EXISTS upload_id uuid REFERENCES public.upload_history(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_import_staging_upload_id ON public.import_staging(upload_id);

CREATE INDEX IF NOT EXISTS idx_import_staging_company_id ON public.import_staging(company_id);
CREATE INDEX IF NOT EXISTS idx_import_staging_approval_id ON public.import_staging(approval_id);

ALTER TABLE public.import_staging ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_staging_select ON public.import_staging
    FOR SELECT TO authenticated
    USING (
        public.has_company_access(auth.uid(), company_id)
        OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
    );

CREATE POLICY import_staging_insert ON public.import_staging
    FOR INSERT TO authenticated
    WITH CHECK (
        auth.uid() IS NOT NULL
        AND (created_by = auth.uid())
        AND (
            public.has_company_access(auth.uid(), company_id)
            OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
        )
    );

CREATE POLICY import_staging_update ON public.import_staging
    FOR UPDATE TO authenticated
    USING (
        auth.uid() IS NOT NULL
        AND (
            (created_by = auth.uid() AND status = 'STAGED' AND public.has_company_access(auth.uid(), company_id))
            OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
        )
    );

CREATE POLICY import_staging_delete ON public.import_staging
    FOR DELETE TO authenticated
    USING (
        auth.uid() IS NOT NULL
        AND (
            (created_by = auth.uid() AND status = 'STAGED' AND public.has_company_access(auth.uid(), company_id))
            OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
        )
    );

-- 2. Scheduled Reports Table
CREATE TABLE IF NOT EXISTS public.scheduled_reports (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    report_type text NOT NULL,
    report_name text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    schedule_type text NOT NULL CHECK (schedule_type IN ('daily', 'weekly', 'monthly', 'quarterly')),
    schedule_time text DEFAULT '18:00' NOT NULL,
    schedule_day integer,
    schedule_month integer,
    recipients text[] NOT NULL,
    export_format text DEFAULT 'excel' NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone,
    delivery_status text DEFAULT 'PENDING',
    last_error text,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_company_id ON public.scheduled_reports(company_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_active_due ON public.scheduled_reports(is_active, next_run_at);

ALTER TABLE public.scheduled_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY scheduled_reports_select ON public.scheduled_reports
    FOR SELECT TO authenticated
    USING (
        public.has_company_access(auth.uid(), company_id)
        OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
    );

CREATE POLICY scheduled_reports_insert ON public.scheduled_reports
    FOR INSERT TO authenticated
    WITH CHECK (
        auth.uid() IS NOT NULL
        AND (created_by = auth.uid())
        AND (
            public.has_company_access(auth.uid(), company_id)
            OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
        )
    );

CREATE POLICY scheduled_reports_update ON public.scheduled_reports
    FOR UPDATE TO authenticated
    USING (
        auth.uid() IS NOT NULL
        AND (
            (created_by = auth.uid() AND public.has_company_access(auth.uid(), company_id))
            OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
        )
    );

CREATE POLICY scheduled_reports_delete ON public.scheduled_reports
    FOR DELETE TO authenticated
    USING (
        auth.uid() IS NOT NULL
        AND (
            (created_by = auth.uid() AND public.has_company_access(auth.uid(), company_id))
            OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
        )
    );

-- 3. Report Versions Table
CREATE TABLE IF NOT EXISTS public.report_versions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    report_type text NOT NULL,
    report_name text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    export_format text DEFAULT 'excel' NOT NULL,
    file_url text,
    file_size bigint,
    record_count integer DEFAULT 0 NOT NULL,
    generated_by uuid DEFAULT auth.uid(),
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_report_versions_company_id ON public.report_versions(company_id);
CREATE INDEX IF NOT EXISTS idx_report_versions_generated_at ON public.report_versions(generated_at);

ALTER TABLE public.report_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_versions_select ON public.report_versions
    FOR SELECT TO authenticated
    USING (
        public.has_company_access(auth.uid(), company_id)
        OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
    );

CREATE POLICY report_versions_insert ON public.report_versions
    FOR INSERT TO authenticated
    WITH CHECK (
        auth.uid() IS NOT NULL
        AND (generated_by = auth.uid())
        AND (
            public.has_company_access(auth.uid(), company_id)
            OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
        )
    );

CREATE POLICY report_versions_modify ON public.report_versions
    FOR ALL TO authenticated
    USING (
        auth.uid() IS NOT NULL
        AND public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
    );

-- 4. Server-Backed Report Presets Table
CREATE TABLE IF NOT EXISTS public.report_presets (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    report_id text NOT NULL,
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    fiscal_year text NOT NULL,
    format text DEFAULT 'xlsx' NOT NULL,
    is_shared boolean DEFAULT true NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_presets_company_id ON public.report_presets(company_id);

ALTER TABLE public.report_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_presets_select ON public.report_presets
    FOR SELECT TO authenticated
    USING (
        public.has_company_access(auth.uid(), company_id)
        OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
    );

CREATE POLICY report_presets_insert ON public.report_presets
    FOR INSERT TO authenticated
    WITH CHECK (
        auth.uid() IS NOT NULL
        AND (created_by = auth.uid())
        AND (
            public.has_company_access(auth.uid(), company_id)
            OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
        )
    );

CREATE POLICY report_presets_update ON public.report_presets
    FOR UPDATE TO authenticated
    USING (
        auth.uid() IS NOT NULL
        AND (
            (created_by = auth.uid() AND public.has_company_access(auth.uid(), company_id))
            OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
        )
    );

CREATE POLICY report_presets_delete ON public.report_presets
    FOR DELETE TO authenticated
    USING (
        auth.uid() IS NOT NULL
        AND (
            (created_by = auth.uid() AND public.has_company_access(auth.uid(), company_id))
            OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
        )
    );

-- Client Multi-Tenant Isolation Constraints: Scope uniqueness per company
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_boid_key;
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_client_code_key;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_clients_company_client_code'
    ) THEN
        ALTER TABLE public.clients ADD CONSTRAINT uq_clients_company_client_code UNIQUE (company_id, client_code);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_clients_company_boid'
    ) THEN
        ALTER TABLE public.clients ADD CONSTRAINT uq_clients_company_boid UNIQUE (company_id, boid);
    END IF;
END $$;

-- 5. Atomic RPC: Commit Staged Import
CREATE OR REPLACE FUNCTION public.commit_staged_import(
    p_approval_id uuid,
    p_checker_notes text DEFAULT NULL
)
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
    v_gross numeric;
    v_tax numeric;
    v_net numeric;
    v_fiscal_year text;
    v_dividend_type text;
    v_inserted_count integer := 0;
BEGIN
    -- 1. Authentication check
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required: User must be signed in to commit staged imports';
    END IF;

    -- 2. Retrieve pending approval record
    SELECT * INTO v_approval
    FROM public.pending_approvals
    WHERE id = p_approval_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pending approval record % not found', p_approval_id;
    END IF;

    IF v_approval.status <> 'Pending' THEN
        RAISE EXCEPTION 'Approval ticket is already %', v_approval.status;
    END IF;

    -- 3. Segregation of duties: Maker cannot approve their own material import
    IF v_approval.requested_by = v_user_id THEN
        RAISE EXCEPTION 'Segregation of duties violation: Maker cannot approve their own material import';
    END IF;

    -- 4. Authorization check: Checker role (admin or supervisor) required
    SELECT public.has_any_role(v_user_id, ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
    INTO v_is_authorized;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Unauthorized: Checker role required to approve material imports';
    END IF;

    -- 5. Retrieve staged import data
    SELECT * INTO v_staged
    FROM public.import_staging
    WHERE approval_id = p_approval_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staged import data for approval % not found', p_approval_id;
    END IF;

    IF v_staged.status <> 'STAGED' THEN
        RAISE EXCEPTION 'Staged import has already been %', v_staged.status;
    END IF;

    -- 6. Verify company access for checker
    IF NOT public.has_company_access(v_user_id, v_staged.company_id)
       AND NOT public.has_any_role(v_user_id, ARRAY['admin'::public.app_role, 'supervisor'::public.app_role]) THEN
        RAISE EXCEPTION 'Unauthorized: Checker has no access to target company';
    END IF;

    -- 7. Integrate with upload_history lifecycle (enabling duplicate check, audit, error, and rollback)
    INSERT INTO public.upload_history (
        user_id,
        file_name,
        file_size,
        file_hash,
        file_type,
        sheet_name,
        total_rows,
        success_rows,
        error_rows,
        target_table,
        status,
        started_at,
        completed_at,
        created_at
    ) VALUES (
        v_staged.created_by,
        v_staged.file_name,
        0,
        v_staged.file_hash,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        v_staged.sheet_name,
        jsonb_array_length(v_staged.staged_rows),
        0,
        0,
        v_staged.target_table,
        'Processing',
        v_staged.created_at,
        NULL,
        now()
    ) RETURNING id INTO v_upload_id;

    -- 8. Unpack staged rows and insert atomically into target ledger table
    v_fiscal_year := COALESCE(v_staged.options->>'fiscalYear', '2080/81');
    v_dividend_type := COALESCE(v_staged.options->>'dividendType', 'Cash');
    v_dividend_rate := COALESCE((v_staged.options->>'dividendRate')::numeric, 0);

    FOR v_row IN SELECT * FROM jsonb_array_elements(v_staged.staged_rows)
    LOOP
        v_boid := COALESCE(
            v_row->>'boid',
            v_row->>'BOID',
            v_row->>'BENEFICIARY ID',
            v_row->>'client_code',
            v_row->>'ClientCode'
        );

        IF v_boid IS NULL OR length(trim(v_boid)) < 8 THEN
            CONTINUE;
        END IF;

        v_boid := trim(v_boid);
        v_client_name := COALESCE(
            v_row->>'name',
            v_row->>'shareholder_name',
            v_row->>'NAME',
            v_row->>'SHAREHOLDER NAME',
            v_row->>'investor_name',
            'Shareholder ' || v_boid
        );
        v_client_code := COALESCE(
            v_row->>'client_code',
            v_row->>'ClientCode',
            v_row->>'client_id',
            v_boid
        );
        v_bank_name := COALESCE(v_row->>'bank_name', v_row->>'BANK NAME', v_row->>'bank');
        v_bank_account := COALESCE(v_row->>'bank_account_number', v_row->>'ACCOUNT NO', v_row->>'account_no', v_row->>'bank_account');

        -- Upsert client: strictly scoped to v_staged.company_id to avoid touching other tenant clients
        v_client_id := NULL;
        IF v_boid IS NOT NULL AND v_boid <> '' THEN
            SELECT id INTO v_client_id 
            FROM public.clients 
            WHERE company_id = v_staged.company_id AND boid = v_boid 
            LIMIT 1;
        END IF;

        IF v_client_id IS NULL AND v_client_code IS NOT NULL AND v_client_code <> '' THEN
            SELECT id INTO v_client_id 
            FROM public.clients 
            WHERE company_id = v_staged.company_id AND client_code = v_client_code 
            LIMIT 1;
        END IF;

        IF v_client_id IS NOT NULL THEN
            UPDATE public.clients
            SET
                boid = COALESCE(v_boid, public.clients.boid),
                bank_name = COALESCE(v_bank_name, public.clients.bank_name),
                bank_account_no = COALESCE(v_bank_account, public.clients.bank_account_no),
                updated_at = now()
            WHERE id = v_client_id AND company_id = v_staged.company_id;
        ELSE
            INSERT INTO public.clients (
                company_id,
                client_code,
                full_name,
                boid,
                bank_name,
                bank_account_no,
                holder_type,
                payee_classification,
                classification_status,
                created_at,
                updated_at
            ) VALUES (
                v_staged.company_id,
                v_client_code,
                v_client_name,
                v_boid,
                v_bank_name,
                v_bank_account,
                'Natural Person - Public'::public.holder_type,
                'NATURAL_PERSON',
                'AUTO_CLASSIFIED',
                now(),
                now()
            )
            RETURNING id INTO v_client_id;
        END IF;

        -- Extract financial figures
        v_shares_held := COALESCE(
            (v_row->>'shares_held')::numeric,
            (v_row->>'kitta')::numeric,
            (v_row->>'KITTA')::numeric,
            (v_row->>'TOTAL KITTA')::numeric,
            0
        );
        v_gross := COALESCE(
            (v_row->>'gross_dividend')::numeric,
            (v_row->>'gross')::numeric,
            (v_row->>'GROSS')::numeric,
            (v_row->>'gross_amount')::numeric,
            0
        );
        v_tax := COALESCE(
            (v_row->>'tax_amount')::numeric,
            (v_row->>'tax')::numeric,
            (v_row->>'TAX')::numeric,
            (v_row->>'tax_withheld')::numeric,
            0
        );
        v_net := COALESCE(
            (v_row->>'net_payable')::numeric,
            (v_row->>'net')::numeric,
            (v_row->>'NET')::numeric,
            (v_row->>'net_dividend')::numeric,
            (v_gross - v_tax)
        );

        -- Insert into target ledger table with upload_id
        IF v_staged.target_table = 'interest_payables' THEN
            INSERT INTO public.interest_payables (
                company_id,
                client_id,
                upload_id,
                gross_interest,
                tax_amount,
                net_payable,
                fiscal_year,
                payment_status,
                created_by,
                created_at,
                updated_at
            ) VALUES (
                v_staged.company_id,
                v_client_id,
                v_upload_id,
                v_gross,
                v_tax,
                v_net,
                v_fiscal_year,
                'Pending'::public.payment_status,
                v_user_id,
                now(),
                now()
            );
        ELSIF v_staged.target_table = 'mutual_fund_payables' THEN
            INSERT INTO public.mutual_fund_payables (
                company_id,
                client_id,
                upload_id,
                units_held,
                nav,
                gross_amount,
                tax_amount,
                net_payable,
                fiscal_year,
                payment_status,
                created_by,
                created_at,
                updated_at
            ) VALUES (
                v_staged.company_id,
                v_client_id,
                v_upload_id,
                v_shares_held,
                10.0,
                v_gross,
                v_tax,
                v_net,
                v_fiscal_year,
                'Pending'::public.payment_status,
                v_user_id,
                now(),
                now()
            );
        ELSE
            -- Default to dividend_payables
            INSERT INTO public.dividend_payables (
                company_id,
                client_id,
                upload_id,
                shares_held,
                dividend_rate,
                gross_dividend,
                tax_amount,
                net_payable,
                tds_rate,
                payee_classification,
                classification_status,
                fiscal_year,
                dividend_type,
                payment_status,
                created_by,
                created_at,
                updated_at
            ) VALUES (
                v_staged.company_id,
                v_client_id,
                v_upload_id,
                v_shares_held,
                v_dividend_rate,
                v_gross,
                v_tax,
                v_net,
                CASE WHEN v_gross > 0 THEN ROUND(v_tax / v_gross, 4) ELSE 0 END,
                'NATURAL_PERSON',
                'AUTO_CLASSIFIED',
                v_fiscal_year,
                CASE
                    WHEN v_dividend_type = 'Stock' THEN 'Stock'::public.dividend_type
                    WHEN v_dividend_type = 'Bonus' THEN 'Bonus'::public.dividend_type
                    WHEN v_dividend_type = 'Right' THEN 'Right'::public.dividend_type
                    ELSE 'Cash'::public.dividend_type
                END,
                'Pending'::public.payment_status,
                v_user_id,
                now(),
                now()
            );
        END IF;

        v_inserted_count := v_inserted_count + 1;
    END LOOP;

    -- 9. Update upload_history completion
    UPDATE public.upload_history
    SET
        status = 'Completed',
        success_rows = v_inserted_count,
        completed_at = now()
    WHERE id = v_upload_id;

    -- 10. Mark approval Approved
    UPDATE public.pending_approvals
    SET
        status = 'Approved',
        reviewed_by = v_user_id,
        review_notes = p_checker_notes,
        reviewed_at = now()
    WHERE id = p_approval_id;

    -- 11. Mark staging COMMITTED and link generated upload_id
    UPDATE public.import_staging
    SET
        status = 'COMMITTED',
        upload_id = v_upload_id,
        committed_at = now()
    WHERE id = v_staged.id;

    -- 12. Record approval log
    INSERT INTO public.approval_logs (
        approval_id,
        action,
        previous_status,
        new_status,
        remarks,
        performed_by,
        performed_at
    ) VALUES (
        p_approval_id,
        'MATERIAL_IMPORT_COMMITTED',
        'Pending',
        'Approved',
        COALESCE(p_checker_notes, 'Checker approved and atomically committed ' || v_inserted_count || ' staged rows to ledger'),
        v_user_id,
        now()
    );

    -- 13. Record system audit log
    INSERT INTO public.audit_logs (
        user_id,
        action,
        table_name,
        record_id,
        new_value,
        action_time
    ) VALUES (
        v_user_id,
        'STAGED_IMPORT_COMMITTED',
        v_staged.target_table,
        v_staged.id::text,
        jsonb_build_object(
            'approval_id', p_approval_id,
            'company_id', v_staged.company_id,
            'upload_id', v_upload_id,
            'rows_committed', v_inserted_count,
            'target_table', v_staged.target_table,
            'file_name', v_staged.file_name,
            'file_hash', v_staged.file_hash
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'approval_id', p_approval_id,
        'staging_id', v_staged.id,
        'upload_id', v_upload_id,
        'target_table', v_staged.target_table,
        'rows_committed', v_inserted_count,
        'status', 'Approved'
    );
END;
$$;

-- 6. Atomic RPC: Reject Staged Import
CREATE OR REPLACE FUNCTION public.reject_staged_import(
    p_approval_id uuid,
    p_rejection_notes text DEFAULT NULL
)
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
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT * INTO v_approval
    FROM public.pending_approvals
    WHERE id = p_approval_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pending approval record % not found', p_approval_id;
    END IF;

    IF v_approval.status <> 'Pending' THEN
        RAISE EXCEPTION 'Approval ticket is already %', v_approval.status;
    END IF;

    IF v_approval.requested_by = v_user_id THEN
        RAISE EXCEPTION 'Segregation of duties violation: Maker cannot reject their own material import';
    END IF;

    SELECT public.has_any_role(v_user_id, ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
    INTO v_is_authorized;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Unauthorized: Checker role required to reject material imports';
    END IF;

    SELECT * INTO v_staged
    FROM public.import_staging
    WHERE approval_id = p_approval_id
    FOR UPDATE;

    UPDATE public.pending_approvals
    SET
        status = 'Rejected',
        reviewed_by = v_user_id,
        review_notes = p_rejection_notes,
        reviewed_at = now()
    WHERE id = p_approval_id;

    IF FOUND THEN
        UPDATE public.import_staging
        SET status = 'REJECTED'
        WHERE id = v_staged.id;
    END IF;

    INSERT INTO public.approval_logs (
        approval_id,
        action,
        previous_status,
        new_status,
        remarks,
        performed_by,
        performed_at
    ) VALUES (
        p_approval_id,
        'MATERIAL_IMPORT_REJECTED',
        'Pending',
        'Rejected',
        COALESCE(p_rejection_notes, 'Checker rejected staged import'),
        v_user_id,
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'approval_id', p_approval_id,
        'status', 'Rejected'
    );
END;
$$;

COMMENT ON FUNCTION public.commit_staged_import IS 'Atomic verification, maker-checker segregation, and checker commit for material staged imports.';
COMMENT ON FUNCTION public.reject_staged_import IS 'Checker rejection for material staged imports with audit logging.';

REVOKE EXECUTE ON FUNCTION public.commit_staged_import(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_staged_import(uuid, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.reject_staged_import(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_staged_import(uuid, text) TO authenticated, service_role;

-- 7. Table Grants for authenticated and service_role
GRANT ALL ON TABLE public.import_staging TO authenticated, service_role;
GRANT ALL ON TABLE public.scheduled_reports TO authenticated, service_role;
GRANT ALL ON TABLE public.report_versions TO authenticated, service_role;
GRANT ALL ON TABLE public.report_presets TO authenticated, service_role;

-- 9. Scoped promote_agm_clients_and_payables for company-level multi-tenancy
CREATE OR REPLACE FUNCTION public.promote_agm_clients_and_payables(p_company_id uuid, p_clients jsonb, p_payables jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_client_rec jsonb;
  v_pay_rec jsonb;
  v_boid text;
  v_client_id uuid;
  v_upserted_clients integer := 0;
  v_inserted_payables integer := 0;
  v_boid_to_id_map jsonb := '{}'::jsonb;
  v_target_fiscal_year text;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id is required';
  END IF;

  -- 1. Upsert Clients with company isolation
  FOR v_client_rec IN SELECT * FROM jsonb_array_elements(p_clients)
  LOOP
    v_boid := TRIM(v_client_rec->>'boid');

    IF v_boid IN ('REMCONVERSION', 'REMBONUSFY20767778', 'FOLIO-REMPOOL')
       OR v_boid ILIKE 'FOLIO-REM%'
       OR v_boid ILIKE 'REM%' THEN
      CONTINUE;
    END IF;

    INSERT INTO public.clients (
      company_id,
      client_code,
      boid,
      full_name,
      father_name,
      grandfather_name,
      citizenship_no,
      pan_no,
      address,
      phone,
      bank_name,
      bank_account_no,
      holder_type,
      kitta,
      status
    ) VALUES (
      p_company_id,
      COALESCE(v_client_rec->>'client_code', v_client_rec->>'client_id', v_boid),
      v_boid,
      COALESCE(v_client_rec->>'full_name', v_client_rec->>'name', 'Unknown Client'),
      v_client_rec->>'father_name',
      v_client_rec->>'grandfather_name',
      v_client_rec->>'citizenship_no',
      v_client_rec->>'pan_no',
      v_client_rec->>'address',
      COALESCE(v_client_rec->>'phone', v_client_rec->>'contact_number'),
      v_client_rec->>'bank_name',
      COALESCE(v_client_rec->>'bank_account_no', v_client_rec->>'bank_account_number'),
      (CASE 
        WHEN v_client_rec->>'holder_type' IN ('Promoter', 'PROMOTER') THEN 'Promoter'::holder_type
        WHEN v_client_rec->>'holder_type' IN ('Mutual Fund', 'MUTUAL_FUND') THEN 'Mutual Fund'::holder_type
        WHEN v_client_rec->>'holder_type' IN ('Institution', 'Legal Person') THEN 'Legal Person'::holder_type
        ELSE 'Public'::holder_type
      END),
      COALESCE((v_client_rec->>'total_kitta')::numeric, (v_client_rec->>'kitta')::numeric, 0),
      'Active'
    )
    ON CONFLICT (company_id, boid) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        client_code = COALESCE(public.clients.client_code, EXCLUDED.client_code),
        father_name = COALESCE(EXCLUDED.father_name, public.clients.father_name),
        grandfather_name = COALESCE(EXCLUDED.grandfather_name, public.clients.grandfather_name),
        citizenship_no = COALESCE(EXCLUDED.citizenship_no, public.clients.citizenship_no),
        pan_no = COALESCE(EXCLUDED.pan_no, public.clients.pan_no),
        address = COALESCE(EXCLUDED.address, public.clients.address),
        phone = COALESCE(EXCLUDED.phone, public.clients.phone),
        bank_name = COALESCE(EXCLUDED.bank_name, public.clients.bank_name),
        bank_account_no = COALESCE(EXCLUDED.bank_account_no, public.clients.bank_account_no),
        holder_type = EXCLUDED.holder_type,
        kitta = EXCLUDED.kitta,
        status = 'Active',
        updated_at = now()
    RETURNING id INTO v_client_id;

    v_upserted_clients := v_upserted_clients + 1;
    v_boid_to_id_map := jsonb_set(v_boid_to_id_map, ARRAY[v_boid], to_jsonb(v_client_id::text));
  END LOOP;

  -- 2. Handle fraction dividend payables atomically if present
  IF jsonb_array_length(p_payables) > 0 THEN
    v_target_fiscal_year := (p_payables->0)->>'fiscal_year';

    DELETE FROM public.dividend_payables dp
    WHERE dp.company_id = p_company_id
      AND dp.fiscal_year = v_target_fiscal_year
      AND dp.remarks ILIKE '%fraction remainder%'
      AND dp.client_id IN (
        SELECT (v_boid_to_id_map->>c_boid)::uuid
        FROM (SELECT DISTINCT value->>'boid' AS c_boid FROM jsonb_array_elements(p_payables)) t
        WHERE v_boid_to_id_map ? c_boid
      );

    FOR v_pay_rec IN SELECT * FROM jsonb_array_elements(p_payables)
    LOOP
      v_boid := TRIM(v_pay_rec->>'boid');

      IF v_boid IN ('REMCONVERSION', 'REMBONUSFY20767778', 'FOLIO-REMPOOL')
         OR v_boid ILIKE 'FOLIO-REM%'
         OR v_boid ILIKE 'REM%' THEN
        CONTINUE;
      END IF;

      v_client_id := (v_boid_to_id_map->>v_boid)::uuid;
      IF v_client_id IS NOT NULL THEN
        INSERT INTO public.dividend_payables (
          company_id,
          client_id,
          fiscal_year,
          shares_held,
          fraction_shares,
          gross_dividend,
          tax_amount,
          net_payable,
          payment_status,
          remarks
        ) VALUES (
          p_company_id,
          v_client_id,
          v_pay_rec->>'fiscal_year',
          COALESCE((v_pay_rec->>'shares_held')::numeric, 0),
          COALESCE((v_pay_rec->>'fraction_shares')::numeric, 0),
          COALESCE((v_pay_rec->>'gross_dividend')::numeric, 0),
          COALESCE((v_pay_rec->>'tax_amount')::numeric, 0),
          COALESCE((v_pay_rec->>'net_payable')::numeric, 0),
          'Pending',
          v_pay_rec->>'remarks'
        );
        v_inserted_payables := v_inserted_payables + 1;
      END IF;
    END LOOP;
  END IF;

  -- 3. Write immutable audit log entry within the same transaction
  INSERT INTO public.audit_logs (
    user_id,
    action,
    table_name,
    record_id,
    new_value,
    action_time
  ) VALUES (
    v_user_id,
    'PROMOTE_HISTORICAL_CLIENTS',
    'clients',
    p_company_id::text,
    jsonb_build_object(
      'company_id', p_company_id,
      'clients_upserted', v_upserted_clients,
      'payables_inserted', v_inserted_payables
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'clientsUpserted', v_upserted_clients,
    'payablesInserted', v_inserted_payables
  );
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.trigger_process_scheduled_reports()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, cron
AS $$
DECLARE
    v_url text;
    v_cron_secret text;
    v_request_id bigint;
BEGIN
    v_url := coalesce(
        current_setting('app.settings.edge_function_url', true),
        'http://supabase_kong_illokcvaflhzrpxlwhtj:8000/functions/v1/process-scheduled-reports'
    );
    v_cron_secret := coalesce(
        current_setting('app.settings.cron_secret', true),
        'rtarts-internal-cron-secret'
    );

    SELECT net.http_post(
        url := v_url,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', v_cron_secret
        ),
        body := '{}'::jsonb
    ) INTO v_request_id;

    RETURN jsonb_build_object(
        'success', true,
        'request_id', v_request_id,
        'endpoint', v_url,
        'triggered_at', now()
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM,
        'endpoint', v_url
    );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_process_scheduled_reports() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_process_scheduled_reports() TO service_role, postgres;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-scheduled-reports-job') THEN
        PERFORM cron.unschedule('process-scheduled-reports-job');
    END IF;

    PERFORM cron.schedule(
        'process-scheduled-reports-job',
        '*/15 * * * *',
        'SELECT public.trigger_process_scheduled_reports();'
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not schedule cron job: %', SQLERRM;
END $$;


