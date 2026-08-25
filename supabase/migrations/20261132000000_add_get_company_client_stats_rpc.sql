-- Add server-side aggregation for client stats by company
CREATE OR REPLACE FUNCTION public.get_company_client_stats(p_company_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total bigint := 0;
  v_verified bigint := 0;
  v_pending bigint := 0;
  v_natural bigint := 0;
  v_institutions bigint := 0;
BEGIN
  WITH target_clients AS (
    SELECT 
      c.id, 
      c.verification_status, 
      c.payee_classification
    FROM public.clients c
    WHERE 
      p_company_id IS NULL 
      OR c.company_id = p_company_id
      OR EXISTS (SELECT 1 FROM public.interest_payables ip WHERE ip.company_id = p_company_id AND ip.client_id = c.id)
      OR EXISTS (SELECT 1 FROM public.dividend_payables dp WHERE dp.company_id = p_company_id AND dp.client_id = c.id)
      OR EXISTS (SELECT 1 FROM public.mutual_fund_payables mp WHERE mp.company_id = p_company_id AND mp.client_id = c.id)
  )
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE verification_status = 'Verified'),
    COUNT(*) FILTER (WHERE verification_status = 'Pending'),
    COUNT(*) FILTER (WHERE payee_classification = 'NATURAL_PERSON'),
    COUNT(*) FILTER (WHERE payee_classification IN ('COMPANY_INSTITUTION', 'PUBLIC_LEGAL_PERSON'))
  INTO v_total, v_verified, v_pending, v_natural, v_institutions
  FROM target_clients;

  RETURN json_build_object(
    'total', COALESCE(v_total, 0),
    'verified', COALESCE(v_verified, 0),
    'pending', COALESCE(v_pending, 0),
    'natural', COALESCE(v_natural, 0),
    'institutions', COALESCE(v_institutions, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_client_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_client_stats(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_company_client_stats(uuid) TO service_role;
