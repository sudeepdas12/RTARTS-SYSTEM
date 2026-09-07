-- Multi-Company Client Filter Function
-- Allows the Clients section to properly show all investors of a selected company
-- (both primary clients and cross-company shareholders from payables).

CREATE OR REPLACE FUNCTION public.get_company_client_ids(p_company_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.clients WHERE company_id = p_company_id
  UNION
  SELECT client_id FROM public.dividend_payables WHERE company_id = p_company_id AND client_id IS NOT NULL
  UNION
  SELECT client_id FROM public.interest_payables WHERE company_id = p_company_id AND client_id IS NOT NULL
  UNION
  SELECT client_id FROM public.mutual_fund_payables WHERE company_id = p_company_id AND client_id IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_client_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_client_ids(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_company_client_ids(uuid) TO service_role;
