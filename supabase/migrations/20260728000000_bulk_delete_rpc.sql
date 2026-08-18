-- =========================================================
-- Stored procedure for bulk delete operations
-- Uses SECURITY DEFINER to bypass RLS
-- =========================================================

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
  v_sql text;
  v_where text := '';
  v_filter jsonb;
  v_field text;
  v_value text;
  v_count int;
  v_result jsonb;
BEGIN
  -- Build WHERE clause from filters array
  FOR v_filter IN SELECT * FROM jsonb_array_elements(p_filters)
  LOOP
    v_field := v_filter->>'field';
    v_value := v_filter->>'value';
    
    IF v_where = '' THEN
      v_where := format('WHERE %I = %L', v_field, v_value);
    ELSE
      v_where := v_where || format(' AND %I = %L', v_field, v_value);
    END IF;
  END LOOP;

  -- Count matching rows before delete
  v_sql := format('SELECT COUNT(*) FROM %I %s', p_table, v_where);
  EXECUTE v_sql INTO v_count;

  -- If no rows found, return early
  IF v_count = 0 THEN
    RETURN jsonb_build_object('success', true, 'deleted', 0);
  END IF;

  -- Execute the delete
  v_sql := format('DELETE FROM %I %s', p_table, v_where);
  EXECUTE v_sql;

  RETURN jsonb_build_object(
    'success', true,
    'deleted', v_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'deleted', 0,
    'error', SQLERRM
  );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.bulk_delete(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_delete(text, jsonb) TO service_role;