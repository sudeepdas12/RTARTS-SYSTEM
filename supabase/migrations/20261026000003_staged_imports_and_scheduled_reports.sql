-- Migration: 20261026000003_staged_imports_and_scheduled_reports.sql
-- Description: Creates import staging table, atomic staged commit RPC, scheduled reports, report versions, and server-backed report presets.

-- 1. Import Staging Table
CREATE TABLE IF NOT EXISTS public.import_staging (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    approval_id uuid REFERENCES public.pending_approvals(id) ON DELETE CASCADE,
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
    created_by uuid,
    status text DEFAULT 'STAGED' CHECK (status IN ('STAGED', 'COMMITTED', 'REJECTED')),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    committed_at timestamp with time zone
);

ALTER TABLE public.import_staging ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_staging_read ON public.import_staging
    FOR SELECT TO authenticated USING (true);

CREATE POLICY import_staging_insert ON public.import_staging
    FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY import_staging_update ON public.import_staging
    FOR UPDATE TO authenticated USING (
        public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
    );

-- 2. Scheduled Reports Table
CREATE TABLE IF NOT EXISTS public.scheduled_reports (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
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
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.scheduled_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY scheduled_reports_all ON public.scheduled_reports
    FOR ALL TO authenticated USING (true) WITH CHECK (auth.uid() IS NOT NULL);

-- 3. Report Versions Table
CREATE TABLE IF NOT EXISTS public.report_versions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    report_type text NOT NULL,
    report_name text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    export_format text DEFAULT 'excel' NOT NULL,
    file_url text,
    file_size bigint,
    record_count integer DEFAULT 0 NOT NULL,
    generated_by uuid,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.report_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_versions_read ON public.report_versions
    FOR SELECT TO authenticated USING (true);

CREATE POLICY report_versions_insert ON public.report_versions
    FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- 4. Server-Backed Report Presets Table
CREATE TABLE IF NOT EXISTS public.report_presets (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    report_id text NOT NULL,
    company_id text NOT NULL,
    fiscal_year text NOT NULL,
    format text DEFAULT 'xlsx' NOT NULL,
    is_shared boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.report_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_presets_all ON public.report_presets
    FOR ALL TO authenticated USING (true) WITH CHECK (auth.uid() IS NOT NULL);

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
BEGIN
    -- Check permissions: must be admin or supervisor
    SELECT public.has_any_role(v_user_id, ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
    INTO v_is_authorized;

    IF NOT v_is_authorized AND v_user_id IS NOT NULL THEN
        RAISE EXCEPTION 'Unauthorized: Checker role required to approve material imports';
    END IF;

    -- Retrieve pending approval
    SELECT * INTO v_approval
    FROM public.pending_approvals
    WHERE id = p_approval_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pending approval record % not found', p_approval_id;
    END IF;

    IF v_approval.status <> 'Pending' THEN
        RAISE EXCEPTION 'Approval ticket is already %', v_approval.status;
    END IF;

    -- Retrieve staging record
    SELECT * INTO v_staged
    FROM public.import_staging
    WHERE approval_id = p_approval_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staged import data for approval % not found', p_approval_id;
    END IF;

    -- Mark approval Approved
    UPDATE public.pending_approvals
    SET
        status = 'Approved',
        reviewed_by = v_user_id,
        review_notes = p_checker_notes,
        reviewed_at = now()
    WHERE id = p_approval_id;

    -- Mark staging COMMITTED
    UPDATE public.import_staging
    SET
        status = 'COMMITTED',
        committed_at = now()
    WHERE id = v_staged.id;

    -- Record audit log
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
        COALESCE(p_checker_notes, 'Checker committed staged import'),
        v_user_id,
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'approval_id', p_approval_id,
        'staging_id', v_staged.id,
        'target_table', v_staged.target_table,
        'total_rows', v_staged.total_rows,
        'status', 'Approved'
    );
END;
$$;

COMMENT ON FUNCTION public.commit_staged_import IS 'Atomic verification and checker commit for material staged imports.';

GRANT EXECUTE ON FUNCTION public.commit_staged_import TO authenticated;
