-- =========================================================
-- Harden bulk delete: authorize callers, restrict tables,
-- support comparison operators, and audit every deletion.
-- Also adds a server-side orphan-client cleanup function.
-- Run AFTER 20260728000000_bulk_delete_rpc.sql.
-- =========================================================

-- ── 1) Hardened bulk_delete ──────────────────────────────
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
    'payments','reconciliation_results','clients','companies'
  ];
  v_cond text := '';
  v_clause text;
  v_filter jsonb;
  v_field text;
  v_value text;
  v_op text;
  v_count int;
BEGIN
  -- Authorization: only admins may bulk delete. (Matches the DELETE RLS
  -- policies in other migrations; the app_role enum has no 'supervisor'.)
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('success', false, 'deleted', 0, 'error', 'Not authorized to delete data.');
  END IF;

  -- Table whitelist (prevents deleting arbitrary/system tables).
  IF NOT (p_table = ANY(v_allowed)) THEN
    RETURN jsonb_build_object('success', false, 'deleted', 0, 'error', 'Table not allowed for deletion: ' || p_table);
  END IF;

  -- Build WHERE from supplied filters with a safe operator whitelist.
  FOR v_filter IN SELECT * FROM jsonb_array_elements(COALESCE(p_filters, '[]'::jsonb))
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

  -- Refuse full-table deletes except an explicit admin purge of clients.
  IF v_cond = '' AND p_table <> 'clients' THEN
    RETURN jsonb_build_object('success', false, 'deleted', 0, 'error', 'A filter is required to prevent full-table deletion.');
  END IF;

  EXECUTE format('SELECT COUNT(*) FROM %I %s', p_table, v_cond) INTO v_count;
  IF v_count = 0 THEN
    RETURN jsonb_build_object('success', true, 'deleted', 0);
  END IF;

  EXECUTE format('DELETE FROM %I %s', p_table, v_cond);

  -- Audit (never allowed to fail the delete).
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

-- ── 2) Server-side orphan client cleanup ──────────────────
CREATE OR REPLACE FUNCTION public.delete_orphan_clients(
  p_company_id text DEFAULT NULL,
  p_fiscal_year text DEFAULT NULL,
  p_imported_after timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orphans int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('success', false, 'deleted', 0, 'error', 'Not authorized.');
  END IF;

  -- Delete clients that no longer have ANY remaining dividend/interest/mutual-fund payables.
  DELETE FROM public.clients c
  WHERE NOT EXISTS (SELECT 1 FROM public.dividend_payables d WHERE d.client_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.interest_payables i WHERE i.client_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.mutual_fund_payables m WHERE m.client_id = c.id);

  GET DIAGNOSTICS v_orphans = ROW_COUNT;

  BEGIN
    INSERT INTO public.audit_logs(user_id, action, table_name, record_id, old_value)
    VALUES (auth.uid(), 'bulk_delete_orphans', 'clients', NULL,
            jsonb_build_object('deleted', v_orphans));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true, 'deleted', v_orphans);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_orphan_clients(text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_orphan_clients(text, text, timestamptz) TO service_role;
