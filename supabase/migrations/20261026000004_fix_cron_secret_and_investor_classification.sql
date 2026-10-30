-- =============================================================================
-- Migration: 20261026000004_fix_cron_secret_and_investor_classification.sql
-- Description:
--   1. Removes hard-coded cron-secret fallback from trigger_process_scheduled_reports
--   2. Ensures 'reports' storage bucket exists with company-scoped RLS policies
--   3. Upgrades commit_staged_import to preserve investor classification & tax categories
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Remove Hardcoded Cron Secret Fallback & Support Injected Settings
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cron_secret()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_secret text;
BEGIN
    -- Check session / role configuration parameter first
    v_secret := nullif(current_setting('app.settings.cron_secret', true), '');
    IF v_secret IS NOT NULL THEN
        RETURN v_secret;
    END IF;

    -- Check persistent system_settings table
    SELECT setting_value->>'secret' INTO v_secret
    FROM public.system_settings
    WHERE setting_key = 'cron_secret';

    RETURN nullif(v_secret, '');
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cron_secret() TO authenticated, service_role;

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
        nullif(current_setting('app.settings.edge_function_url', true), ''),
        'http://supabase_kong_illokcvaflhzrpxlwhtj:8000/functions/v1/process-scheduled-reports'
    );
    v_cron_secret := public.get_cron_secret();

    IF v_cron_secret IS NULL THEN
        RAISE EXCEPTION 'CRON trigger failed: app.settings.cron_secret is not configured. Hardcoded fallback has been removed.';
    END IF;

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
        'triggered_at', now()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.trigger_process_scheduled_reports() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Secure 'reports' Storage Bucket & RLS Policies
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'reports',
    'reports',
    false,
    52428800,
    NULL
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'authenticated_reports_access'
    ) THEN
        CREATE POLICY authenticated_reports_access ON storage.objects
            FOR SELECT TO authenticated
            USING (
                bucket_id = 'reports'
                AND (
                    public.has_company_access(auth.uid(), (storage.foldername(name))[1]::uuid)
                    OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'authenticated_reports_insert'
    ) THEN
        CREATE POLICY authenticated_reports_insert ON storage.objects
            FOR INSERT TO authenticated
            WITH CHECK (
                bucket_id = 'reports'
                AND (
                    public.has_company_access(auth.uid(), (storage.foldername(name))[1]::uuid)
                    OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'supervisor'::public.app_role])
                )
            );
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Upgrade commit_staged_import to Preserve Investor Classification
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_staged_import(
    p_approval_id uuid,
    p_checker_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

    -- Investor Classification Variables
    v_raw_holder_type text;
    v_raw_classification text;
    v_payee_classification text;
    v_holder_type public.holder_type;
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

    -- 7. Integrate with upload_history lifecycle
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

        -- Resolve Classification and Investor Category
        v_raw_holder_type := COALESCE(
            v_row->>'holder_type',
            v_row->>'holderType',
            v_row->>'investor_type',
            v_row->>'investorType',
            v_row->>'investor_category',
            v_row->>'investorCategory',
            v_row->>'category',
            v_row->>'sheet_type',
            v_staged.sheet_name
        );
        v_raw_classification := COALESCE(
            v_row->>'payee_classification',
            v_row->>'payeeClassification',
            v_row->>'classification',
            v_row->>'tax_category'
        );

        -- Map payee_classification accurately
        IF upper(trim(coalesce(v_raw_classification, ''))) IN (
            'NATURAL_PERSON', 'PUBLIC_LEGAL_PERSON', 'COMPANY_INSTITUTION',
            'FOREIGN_INVESTOR', 'BANK_FI', 'TAX_EXEMPT', 'UNCLASSIFIED'
        ) THEN
            v_payee_classification := upper(trim(v_raw_classification));
        ELSIF v_raw_classification ILIKE '%MUTUAL%' OR v_raw_holder_type ILIKE '%MUTUAL%' THEN
            v_payee_classification := 'TAX_EXEMPT';
        ELSIF v_raw_classification ILIKE '%EXEMPT%' OR v_raw_holder_type ILIKE '%EXEMPT%' THEN
            v_payee_classification := 'TAX_EXEMPT';
        ELSIF v_raw_classification ILIKE '%FOREIGN%' OR v_raw_classification ILIKE '%NRN%'
           OR v_raw_holder_type ILIKE '%FOREIGN%' OR v_raw_holder_type ILIKE '%NRN%' THEN
            v_payee_classification := 'FOREIGN_INVESTOR';
        ELSIF v_raw_classification ILIKE '%BANK%' OR v_raw_classification ILIKE '%FINANCIAL%'
           OR v_raw_holder_type ILIKE '%BANK%' OR v_raw_holder_type ILIKE '%FINANCIAL%' THEN
            v_payee_classification := 'BANK_FI';
        ELSIF v_raw_classification ILIKE '%INSTITUT%' OR v_raw_classification ILIKE '%COMPANY%'
           OR v_raw_classification ILIKE '%CORPORATE%' OR v_raw_holder_type ILIKE '%INSTITUT%'
           OR v_raw_holder_type ILIKE '%LEGAL PERSON%' THEN
            v_payee_classification := 'COMPANY_INSTITUTION';
        ELSIF v_raw_classification ILIKE '%PUBLIC_LEGAL%' OR v_raw_holder_type = 'Public' THEN
            v_payee_classification := 'PUBLIC_LEGAL_PERSON';
        ELSE
            v_payee_classification := 'NATURAL_PERSON';
        END IF;

        -- Map holder_type enum
        IF v_raw_holder_type IN (
            'Natural Person - Public', 'Natural Person - Promoter', 'Legal Person', 'Mutual Fund',
            'Foreign', 'Tax Exempt', 'Public', 'Promoter', 'Institution', 'Natural Person - Local',
            'Natural Person - Employee', 'Natural Person - Minor', 'Natural Person - Joint Holder',
            'Legal Person - Promoter', 'Local', 'Employee'
        ) THEN
            v_holder_type := v_raw_holder_type::public.holder_type;
        ELSIF v_payee_classification = 'TAX_EXEMPT' THEN
            IF v_raw_holder_type ILIKE '%MUTUAL%' THEN
                v_holder_type := 'Mutual Fund'::public.holder_type;
            ELSE
                v_holder_type := 'Tax Exempt'::public.holder_type;
            END IF;
        ELSIF v_payee_classification = 'FOREIGN_INVESTOR' THEN
            v_holder_type := 'Foreign'::public.holder_type;
        ELSIF v_payee_classification = 'BANK_FI' THEN
            v_holder_type := 'Institution'::public.holder_type;
        ELSIF v_payee_classification = 'COMPANY_INSTITUTION' THEN
            v_holder_type := 'Legal Person'::public.holder_type;
        ELSIF v_payee_classification = 'PUBLIC_LEGAL_PERSON' THEN
            v_holder_type := 'Public'::public.holder_type;
        ELSIF v_raw_holder_type ILIKE '%PROMOTER%' THEN
            v_holder_type := 'Natural Person - Promoter'::public.holder_type;
        ELSIF v_raw_holder_type ILIKE '%LOCAL%' THEN
            v_holder_type := 'Natural Person - Local'::public.holder_type;
        ELSIF v_raw_holder_type ILIKE '%STAFF%' OR v_raw_holder_type ILIKE '%EMPLOYEE%' THEN
            v_holder_type := 'Natural Person - Employee'::public.holder_type;
        ELSIF v_raw_holder_type ILIKE '%MINOR%' THEN
            v_holder_type := 'Natural Person - Minor'::public.holder_type;
        ELSIF v_raw_holder_type ILIKE '%JOINT%' THEN
            v_holder_type := 'Natural Person - Joint Holder'::public.holder_type;
        ELSE
            v_holder_type := 'Natural Person - Public'::public.holder_type;
        END IF;

        -- Upsert client: strictly scoped to v_staged.company_id
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
                payee_classification = CASE
                    WHEN public.clients.payee_classification = 'UNCLASSIFIED' AND v_payee_classification <> 'UNCLASSIFIED'
                        THEN v_payee_classification
                    ELSE public.clients.payee_classification
                END,
                holder_type = CASE
                    WHEN public.clients.payee_classification = 'UNCLASSIFIED' AND v_payee_classification <> 'UNCLASSIFIED'
                        THEN v_holder_type
                    ELSE public.clients.holder_type
                END,
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
                v_holder_type,
                v_payee_classification,
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

        -- Insert into target ledger table with upload_id & resolved classification
        IF v_staged.target_table = 'interest_payables' THEN
            INSERT INTO public.interest_payables (
                company_id,
                client_id,
                upload_id,
                gross_interest,
                tax_amount,
                net_payable,
                fiscal_year,
                payee_classification,
                classification_status,
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
                v_payee_classification,
                'AUTO_CLASSIFIED',
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
                shares_held,
                dividend_rate,
                gross_dividend,
                tax_amount,
                net_payable,
                fiscal_year,
                payee_classification,
                classification_status,
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
                v_fiscal_year,
                v_payee_classification,
                'AUTO_CLASSIFIED',
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
                v_payee_classification,
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
        p_checker_notes,
        v_user_id,
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'approval_id', p_approval_id,
        'staging_id', v_staged.id,
        'upload_id', v_upload_id,
        'rows_committed', v_inserted_count,
        'status', 'Approved',
        'committed_at', now()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commit_staged_import(uuid, text) TO authenticated, service_role;
