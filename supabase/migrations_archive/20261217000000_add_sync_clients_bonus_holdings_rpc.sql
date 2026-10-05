-- ============================================================================
-- Migration: 20261217000000_add_sync_clients_bonus_holdings_rpc.sql
-- Description:
-- Adds sync_clients_bonus_holdings RPC to safely and idempotently synchronize
-- client master holdings (clients.kitta) with the final post-bonus balance
-- (dividend_payables.after_bonus_kitta) following a bonus share allotment.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_clients_bonus_holdings(
  p_company_id uuid,
  p_fiscal_year text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_is_global_access boolean := false;
  v_user_companies uuid[];
  v_updated_count int := 0;
BEGIN
  -- Prevent premature timeout on large registry datasets
  PERFORM set_config('statement_timeout', '60s', true);

  v_uid := auth.uid();
  IF v_uid IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  -- Verify authorization
  IF current_user = 'service_role' OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_uid
      AND role IN ('admin'::public.app_role, 'supervisor'::public.app_role)
  ) THEN
    v_is_global_access := true;
  ELSE
    SELECT COALESCE(array_agg(company_id), '{}')
    INTO v_user_companies
    FROM public.user_company_access
    WHERE user_id = v_uid;
  END IF;

  IF NOT v_is_global_access AND NOT (p_company_id = ANY(v_user_companies)) THEN
    RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
  END IF;

  -- 1. Identify distinct latest post-bonus holdings for this company & fiscal year
  WITH latest_bonus AS (
    SELECT DISTINCT ON (dp.client_id)
      dp.client_id,
      dp.after_bonus_kitta
    FROM public.dividend_payables dp
    WHERE dp.company_id = p_company_id
      AND dp.fiscal_year = p_fiscal_year
      AND dp.after_bonus_kitta IS NOT NULL
      AND dp.after_bonus_kitta > 0
      AND dp.client_id IS NOT NULL
    ORDER BY dp.client_id, dp.created_at DESC
  ),
  updated AS (
    UPDATE public.clients c
    SET
      kitta = lb.after_bonus_kitta,
      updated_at = NOW()
    FROM latest_bonus lb
    WHERE c.id = lb.client_id
      AND c.company_id = p_company_id
      AND (c.kitta IS NULL OR c.kitta != lb.after_bonus_kitta)
    RETURNING c.id
  )
  SELECT count(*) INTO v_updated_count FROM updated;

  -- 2. Audit Trail
  INSERT INTO public.audit_logs (
    user_id,
    action,
    table_name,
    record_id,
    new_value
  ) VALUES (
    v_uid,
    'SYNC_BONUS_HOLDINGS',
    'clients',
    p_company_id,
    jsonb_build_object(
      'company_id', p_company_id,
      'fiscal_year', p_fiscal_year,
      'clients_updated', v_updated_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'company_id', p_company_id,
    'fiscal_year', p_fiscal_year,
    'updated_count', v_updated_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_clients_bonus_holdings(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_clients_bonus_holdings(uuid, text) TO service_role;

ALTER FUNCTION public.sync_clients_bonus_holdings(uuid, text) SET statement_timeout = '60s';
