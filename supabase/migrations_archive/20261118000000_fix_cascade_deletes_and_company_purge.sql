-- =========================================================
-- Fix CASCADE foreign keys and add robust Company & Client purge RPC
-- =========================================================

-- 1) Fix Foreign Key constraints on payments to ON DELETE CASCADE
DO $$ BEGIN
  ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_company_id_fkey;
  ALTER TABLE public.payments ADD CONSTRAINT payments_company_id_fkey 
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_client_id_fkey;
  ALTER TABLE public.payments ADD CONSTRAINT payments_client_id_fkey 
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 2) Fix Foreign Key constraints on payment_batches to ON DELETE CASCADE
DO $$ BEGIN
  ALTER TABLE public.payment_batches DROP CONSTRAINT IF EXISTS payment_batches_company_id_fkey;
  ALTER TABLE public.payment_batches ADD CONSTRAINT payment_batches_company_id_fkey 
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 3) Fix Foreign Key constraints on reconciliation_results to ON DELETE CASCADE
DO $$ BEGIN
  ALTER TABLE public.reconciliation_results DROP CONSTRAINT IF EXISTS reconciliation_results_company_id_fkey;
  ALTER TABLE public.reconciliation_results ADD CONSTRAINT reconciliation_results_company_id_fkey 
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.reconciliation_results DROP CONSTRAINT IF EXISTS reconciliation_results_client_id_fkey;
  ALTER TABLE public.reconciliation_results ADD CONSTRAINT reconciliation_results_client_id_fkey 
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 4) Update bulk_delete RPC whitelist to include all tables and handle scalar string vs array safely
CREATE OR REPLACE FUNCTION public.bulk_delete(
  p_table text,
  p_filters jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed text[] := ARRAY[
    'dividend_payables','interest_payables','mutual_fund_payables',
    'payments','payment_batches','reconciliation_results','clients','companies','iaf_allocations'
  ];
  v_filters_array jsonb;
  v_cond text := '';
  v_clause text;
  v_filter jsonb;
  v_field text;
  v_value text;
  v_op text;
  v_count int;
BEGIN
  -- Authorization: only admins may bulk delete
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('success', false, 'deleted', 0, 'error', 'Not authorized to delete data.');
  END IF;

  -- Table whitelist
  IF NOT (p_table = ANY(v_allowed)) THEN
    RETURN jsonb_build_object('success', false, 'deleted', 0, 'error', 'Table not allowed for deletion: ' || p_table);
  END IF;

  -- Safely parse filters whether passed as JSONB array or JSON string
  IF jsonb_typeof(p_filters) = 'string' THEN
    BEGIN
      v_filters_array := (p_filters #>> '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      v_filters_array := '[]'::jsonb;
    END;
  ELSE
    v_filters_array := COALESCE(p_filters, '[]'::jsonb);
  END IF;

  -- Build WHERE from supplied filters with a safe operator whitelist
  FOR v_filter IN SELECT * FROM jsonb_array_elements(v_filters_array)
  LOOP
    v_field := v_filter->>'field';
    v_value := v_filter->>'value';
    v_op := COALESCE(v_filter->>'op', 'eq');
    IF v_field IS NULL OR v_value IS NULL OR v_op NOT IN ('eq','neq','gt','gte','lt','lte') THEN
      RETURN jsonb_build_object('success', false, 'deleted', 0, 'error', 'Invalid filter supplied to bulk_delete');
    END IF;
    v_clause := CASE v_op
      WHEN 'eq'  THEN format('%I = %L',  v_field, v_value)
      WHEN 'neq' THEN format('%I <> %L', v_field, v_value)
      WHEN 'gt'  THEN format('%I > %L',  v_field, v_value)
      WHEN 'gte' THEN format('%I >= %L', v_field, v_value)
      WHEN 'lt'  THEN format('%I < %L',  v_field, v_value)
      WHEN 'lte' THEN format('%I <= %L', v_field, v_value)
    END;
    IF v_cond = '' THEN v_cond := ' WHERE ' || v_clause; ELSE v_cond := v_cond || ' AND ' || v_clause; END IF;
  END LOOP;

  -- Refuse full-table deletes except an explicit admin purge of clients
  IF v_cond = '' AND p_table <> 'clients' THEN
    RETURN jsonb_build_object('success', false, 'deleted', 0, 'error', 'A filter is required to prevent full-table deletion.');
  END IF;

  EXECUTE format('SELECT COUNT(*) FROM %I %s', p_table, v_cond) INTO v_count;
  IF v_count = 0 THEN
    RETURN jsonb_build_object('success', true, 'deleted', 0);
  END IF;

  EXECUTE format('DELETE FROM %I %s', p_table, v_cond);

  -- Audit log
  BEGIN
    INSERT INTO public.audit_logs(user_id, action, table_name, record_id, old_value)
    VALUES (auth.uid(), 'bulk_delete', p_table, NULL,
            jsonb_build_object('rows_deleted', v_count, 'filters', p_filters));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true, 'deleted', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_delete(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_delete(text, jsonb) TO service_role;

-- 5) Dedicated Atomic RPC to delete a Company and all associated records safely
CREATE OR REPLACE FUNCTION public.delete_company_completely(
  p_company_id uuid,
  p_delete_clients boolean DEFAULT true,
  p_delete_orphans boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_div_count int := 0;
  v_mf_count int := 0;
  v_int_count int := 0;
  v_pay_count int := 0;
  v_batch_count int := 0;
  v_recon_count int := 0;
  v_iaf_count int := 0;
  v_clients_count int := 0;
  v_orphans_count int := 0;
  v_company_count int := 0;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized.');
  END IF;

  -- 1. Payments
  DELETE FROM public.payments WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_pay_count = ROW_COUNT;
  IF v_pay_count > 0 THEN
    v_results := v_results || jsonb_build_object('table', 'payments', 'deleted', v_pay_count);
  END IF;

  -- 2. Payment batches
  DELETE FROM public.payment_batches WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_batch_count = ROW_COUNT;
  IF v_batch_count > 0 THEN
    v_results := v_results || jsonb_build_object('table', 'payment_batches', 'deleted', v_batch_count);
  END IF;

  -- 3. Reconciliation results
  DELETE FROM public.reconciliation_results WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_recon_count = ROW_COUNT;
  IF v_recon_count > 0 THEN
    v_results := v_results || jsonb_build_object('table', 'reconciliation_results', 'deleted', v_recon_count);
  END IF;

  -- 4. Dividend payables
  DELETE FROM public.dividend_payables WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_div_count = ROW_COUNT;
  IF v_div_count > 0 THEN
    v_results := v_results || jsonb_build_object('table', 'dividend_payables', 'deleted', v_div_count);
  END IF;

  -- 5. Mutual fund payables
  DELETE FROM public.mutual_fund_payables WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_mf_count = ROW_COUNT;
  IF v_mf_count > 0 THEN
    v_results := v_results || jsonb_build_object('table', 'mutual_fund_payables', 'deleted', v_mf_count);
  END IF;

  -- 6. Interest payables
  DELETE FROM public.interest_payables WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_int_count = ROW_COUNT;
  IF v_int_count > 0 THEN
    v_results := v_results || jsonb_build_object('table', 'interest_payables', 'deleted', v_int_count);
  END IF;

  -- 7. IAF Allocations
  DELETE FROM public.iaf_allocations WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_iaf_count = ROW_COUNT;
  IF v_iaf_count > 0 THEN
    v_results := v_results || jsonb_build_object('table', 'iaf_allocations', 'deleted', v_iaf_count);
  END IF;

  -- 8. Company clients if requested
  IF p_delete_clients THEN
    DELETE FROM public.clients WHERE company_id = p_company_id;
    GET DIAGNOSTICS v_clients_count = ROW_COUNT;
    IF v_clients_count > 0 THEN
      v_results := v_results || jsonb_build_object('table', 'clients', 'deleted', v_clients_count);
    END IF;
  END IF;

  -- 9. Delete the company record itself
  DELETE FROM public.companies WHERE id = p_company_id;
  GET DIAGNOSTICS v_company_count = ROW_COUNT;
  v_results := v_results || jsonb_build_object('table', 'companies', 'deleted', v_company_count);

  -- 10. Clean up orphan clients if requested
  IF p_delete_orphans OR p_delete_clients THEN
    DELETE FROM public.clients c
    WHERE NOT EXISTS (SELECT 1 FROM public.dividend_payables d WHERE d.client_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.interest_payables i WHERE i.client_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.mutual_fund_payables m WHERE m.client_id = c.id);
    GET DIAGNOSTICS v_orphans_count = ROW_COUNT;
    IF v_orphans_count > 0 THEN
      v_results := v_results || jsonb_build_object('table', 'clients (orphans)', 'deleted', v_orphans_count);
    END IF;
  END IF;

  -- Audit log
  BEGIN
    INSERT INTO public.audit_logs(user_id, action, table_name, record_id, old_value)
    VALUES (auth.uid(), 'delete_company_completely', 'companies', p_company_id::text,
            jsonb_build_object(
              'company_deleted', v_company_count,
              'dividends_deleted', v_div_count,
              'mutual_funds_deleted', v_mf_count,
              'interests_deleted', v_int_count,
              'clients_deleted', v_clients_count + v_orphans_count
            ));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true, 'results', v_results);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_company_completely(uuid, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_company_completely(uuid, boolean, boolean) TO service_role;
