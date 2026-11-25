-- Migration: 20261026000002_search_payments_paginated_rpc.sql
-- Description: Parameterized server-side RPC for searching payments by BOID, shareholder name, bank account, and payment reference with pagination.

CREATE OR REPLACE FUNCTION public.search_payments_paginated(
    p_search_term text DEFAULT NULL,
    p_company_id uuid DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_limit integer DEFAULT 15,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id uuid,
    company_id uuid,
    client_id uuid,
    gross_amount numeric,
    tax_amount numeric,
    net_amount numeric,
    paid_amount numeric,
    status text,
    bank_name text,
    bank_account_no text,
    payment_reference text,
    connectips_ref text,
    payment_method text,
    payment_date date,
    created_at timestamp with time zone,
    boid text,
    full_name text,
    holder_type text,
    company_name text,
    company_code text,
    total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_clean_search text := trim(p_search_term);
BEGIN
    RETURN QUERY
    WITH filtered AS (
        SELECT
            p.id,
            p.company_id,
            p.client_id,
            p.gross_amount,
            p.tax_amount,
            p.net_amount,
            p.paid_amount,
            p.status::text,
            p.bank_name,
            p.bank_account_no,
            p.payment_reference,
            p.connectips_ref,
            p.payment_method::text,
            p.payment_date,
            p.created_at,
            c.boid,
            c.full_name,
            c.holder_type::text,
            co.company_name,
            co.company_code,
            COUNT(*) OVER() AS total_count
        FROM public.payments p
        LEFT JOIN public.clients c ON p.client_id = c.id
        LEFT JOIN public.companies co ON p.company_id = co.id
        WHERE
            (p_company_id IS NULL OR p.company_id = p_company_id)
            AND (p_status IS NULL OR p_status = 'all' OR p.status::text = p_status)
            AND (
                v_clean_search IS NULL OR v_clean_search = ''
                OR p.payment_reference ILIKE '%' || v_clean_search || '%'
                OR p.connectips_ref ILIKE '%' || v_clean_search || '%'
                OR p.bank_account_no ILIKE '%' || v_clean_search || '%'
                OR c.boid ILIKE '%' || v_clean_search || '%'
                OR c.full_name ILIKE '%' || v_clean_search || '%'
            )
        ORDER BY p.created_at DESC, p.id ASC
        LIMIT p_limit
        OFFSET p_offset
    )
    SELECT * FROM filtered;
END;
$$;

COMMENT ON FUNCTION public.search_payments_paginated IS 'Paginated server-side search across payment reference, connectips ref, account number, shareholder BOID, and shareholder full name.';

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.search_payments_paginated TO authenticated;
