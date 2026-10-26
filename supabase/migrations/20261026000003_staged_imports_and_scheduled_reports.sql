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
    status text DEFAULT 'STAGED' CHECK (status IN ('STAGED', 'COMMITTED', 'REJECTED')),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    committed_at timestamp with time zone
);

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

    -- 7. Unpack staged rows and insert atomically into target ledger table
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

        -- Upsert client: find existing by boid or client_code, or insert new
        SELECT id INTO v_client_id FROM public.clients WHERE boid = v_boid LIMIT 1;

        IF v_client_id IS NULL THEN
            SELECT id INTO v_client_id FROM public.clients WHERE client_code = v_client_code LIMIT 1;
        END IF;

        IF v_client_id IS NOT NULL THEN
            UPDATE public.clients
            SET
                boid = COALESCE(v_boid, public.clients.boid),
                bank_name = COALESCE(v_bank_name, public.clients.bank_name),
                bank_account_no = COALESCE(v_bank_account, public.clients.bank_account_no),
                updated_at = now()
            WHERE id = v_client_id;
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

        -- Insert into target ledger table
        IF v_staged.target_table = 'interest_payables' THEN
            INSERT INTO public.interest_payables (
                company_id,
                client_id,
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

    -- 8. Mark approval Approved
    UPDATE public.pending_approvals
    SET
        status = 'Approved',
        reviewed_by = v_user_id,
        review_notes = p_checker_notes,
        reviewed_at = now()
    WHERE id = p_approval_id;

    -- 9. Mark staging COMMITTED
    UPDATE public.import_staging
    SET
        status = 'COMMITTED',
        committed_at = now()
    WHERE id = v_staged.id;

    -- 10. Record approval log
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

    -- 11. Record system audit log
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
GRANT EXECUTE ON FUNCTION public.commit_staged_import(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.reject_staged_import(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_staged_import(uuid, text) TO authenticated;

-- 7. Table Grants for authenticated and service_role
GRANT ALL ON TABLE public.import_staging TO authenticated, service_role;
GRANT ALL ON TABLE public.scheduled_reports TO authenticated, service_role;
GRANT ALL ON TABLE public.report_versions TO authenticated, service_role;
GRANT ALL ON TABLE public.report_presets TO authenticated, service_role;

