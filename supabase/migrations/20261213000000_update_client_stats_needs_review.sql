-- Migration: 20261213000000_update_client_stats_needs_review.sql
-- Updates get_company_client_stats RPC to count needs_review

CREATE OR REPLACE FUNCTION public.get_company_client_stats(p_company_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_is_global_access boolean := false;
  v_user_companies uuid[];
  v_total bigint := 0;
  v_verified bigint := 0;
  v_pending bigint := 0;
  v_natural bigint := 0;
  v_institutions bigint := 0;
  v_needs_review bigint := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL AND current_user != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: caller must be authenticated' USING ERRCODE = '42501';
  END IF;

  -- Resolve company authorization once for the entire query
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

  IF p_company_id IS NOT NULL AND NOT v_is_global_access THEN
    IF NOT (p_company_id = ANY(v_user_companies)) THEN
      RAISE EXCEPTION 'Access denied: user not authorized for company %', p_company_id USING ERRCODE = '42501';
    END IF;
  END IF;

  WITH target_clients AS (
    SELECT 
      c.id, 
      c.verification_status, 
      c.payee_classification,
      c.holder_type,
      COALESCE(c.needs_review, false) AS needs_review
    FROM public.clients c
    WHERE 
      (
        (p_company_id IS NOT NULL AND c.company_id = p_company_id)
        OR (
          p_company_id IS NULL AND (
            v_is_global_access 
            OR c.company_id IS NULL 
            OR c.company_id = ANY(v_user_companies)
          )
        )
      )
  )
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE verification_status = 'Verified'),
    COUNT(*) FILTER (WHERE verification_status = 'Pending'),
    COUNT(*) FILTER (WHERE (payee_classification = 'NATURAL_PERSON' AND (holder_type IS NULL OR holder_type::text ILIKE '%Public%' OR holder_type::text ILIKE '%Natural%')) OR holder_type::text = 'Natural Person - Public'),
    COUNT(*) FILTER (WHERE payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON') OR holder_type::text ILIKE '%Institution%' OR holder_type::text ILIKE '%Legal Person%'),
    COUNT(*) FILTER (WHERE needs_review = true)
  INTO v_total, v_verified, v_pending, v_natural, v_institutions, v_needs_review
  FROM target_clients;

  RETURN json_build_object(
    'total', COALESCE(v_total, 0),
    'verified', COALESCE(v_verified, 0),
    'pending', COALESCE(v_pending, 0),
    'natural', COALESCE(v_natural, 0),
    'institutions', COALESCE(v_institutions, 0),
    'needs_review', COALESCE(v_needs_review, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_client_stats(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_company_client_stats(uuid) TO authenticated, service_role;
