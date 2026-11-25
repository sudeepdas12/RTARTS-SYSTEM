-- ============================================================================
-- Migration: 20261124141500_corporate_declarations.sql
-- Description: Corporate Action Declarations Master, Linking, and Summary RPC
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.corporate_declarations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    declaration_code text NOT NULL UNIQUE,
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    declaration_type text NOT NULL, -- 'Dividend' | 'Interest'
    sub_type text DEFAULT 'Cash',   -- 'Cash' | 'Bonus' | 'Combined' | 'Debenture_Coupon'
    fiscal_year text NOT NULL,
    declaration_date date NOT NULL DEFAULT CURRENT_DATE,
    record_date date,
    payment_due_date date,
    rate_per_share numeric(10,4) DEFAULT 0,
    face_value numeric(10,2) DEFAULT 100,
    total_declared_amount numeric(15,2) DEFAULT 0,
    total_eligible_shares numeric(15,2) DEFAULT 0,
    status text DEFAULT 'Active' NOT NULL, -- 'Draft' | 'Active' | 'Completed' | 'Closed'
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_corporate_declarations_company ON public.corporate_declarations(company_id);
CREATE INDEX IF NOT EXISTS idx_corporate_declarations_status ON public.corporate_declarations(status);
CREATE INDEX IF NOT EXISTS idx_corporate_declarations_code ON public.corporate_declarations(declaration_code);

-- Link declaration_id to payables and payment batches
ALTER TABLE public.dividend_payables
    ADD COLUMN IF NOT EXISTS declaration_id uuid REFERENCES public.corporate_declarations(id) ON DELETE SET NULL;

ALTER TABLE public.interest_payables
    ADD COLUMN IF NOT EXISTS declaration_id uuid REFERENCES public.corporate_declarations(id) ON DELETE SET NULL;

ALTER TABLE public.payment_batches
    ADD COLUMN IF NOT EXISTS declaration_id uuid REFERENCES public.corporate_declarations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dividend_payables_declaration ON public.dividend_payables(declaration_id);
CREATE INDEX IF NOT EXISTS idx_interest_payables_declaration ON public.interest_payables(declaration_id);
CREATE INDEX IF NOT EXISTS idx_payment_batches_declaration ON public.payment_batches(declaration_id);

-- Enable RLS
ALTER TABLE public.corporate_declarations ENABLE ROW LEVEL SECURITY;

-- Select policy: Allow authenticated users who have company access or admin role
DROP POLICY IF EXISTS "Users can read declarations for authorized companies" ON public.corporate_declarations;
CREATE POLICY "Users can read declarations for authorized companies"
    ON public.corporate_declarations
    FOR SELECT
    TO authenticated
    USING (
        public.has_role(auth.uid(), 'admin'::public.app_role) OR
        public.has_company_access(auth.uid(), company_id)
    );

-- Insert/Update policy: Allow makers, operators, supervisors, finance_operators, admins
DROP POLICY IF EXISTS "Authorized users can manage corporate declarations" ON public.corporate_declarations;
CREATE POLICY "Authorized users can manage corporate declarations"
    ON public.corporate_declarations
    FOR ALL
    TO authenticated
    USING (
        public.has_role(auth.uid(), 'admin'::public.app_role) OR
        (public.has_company_access(auth.uid(), company_id) AND
         public.has_any_role(auth.uid(), ARRAY['finance_operator'::public.app_role, 'supervisor'::public.app_role, 'operator'::public.app_role, 'maker'::public.app_role]))
    )
    WITH CHECK (
        public.has_role(auth.uid(), 'admin'::public.app_role) OR
        (public.has_company_access(auth.uid(), company_id) AND
         public.has_any_role(auth.uid(), ARRAY['finance_operator'::public.app_role, 'supervisor'::public.app_role, 'operator'::public.app_role, 'maker'::public.app_role]))
    );

-- Declaration Summary RPC
CREATE OR REPLACE FUNCTION public.get_declaration_summary(p_declaration_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_declaration RECORD;
    v_is_dividend boolean;
    v_total_payables int := 0;
    v_gross_amt numeric(15,2) := 0;
    v_tax_amt numeric(15,2) := 0;
    v_net_amt numeric(15,2) := 0;
    v_paid_amt numeric(15,2) := 0;
    v_remaining_amt numeric(15,2) := 0;
    v_failed_amt numeric(15,2) := 0;
    v_paid_count int := 0;
    v_partial_count int := 0;
    v_unpaid_count int := 0;
    v_failed_count int := 0;
    v_batches_count int := 0;
BEGIN
    SELECT * INTO v_declaration FROM public.corporate_declarations WHERE id = p_declaration_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'Declaration not found');
    END IF;

    v_is_dividend := (v_declaration.declaration_type = 'Dividend');

    IF v_is_dividend THEN
        SELECT
            COUNT(*),
            COALESCE(SUM(gross_dividend), 0),
            COALESCE(SUM(tax_amount), 0),
            COALESCE(SUM(net_payable), 0),
            COALESCE(SUM(paid_amount), 0),
            COALESCE(SUM(remaining_amount), 0),
            COALESCE(SUM(CASE WHEN returned_status IS NOT NULL AND returned_status != '' THEN net_payable ELSE 0 END), 0),
            COUNT(CASE WHEN payment_status = 'Paid' THEN 1 END),
            COUNT(CASE WHEN payment_status = 'Partial' THEN 1 END),
            COUNT(CASE WHEN payment_status = 'Pending' AND (returned_status IS NULL OR returned_status = '') THEN 1 END),
            COUNT(CASE WHEN returned_status IS NOT NULL AND returned_status != '' THEN 1 END)
        INTO
            v_total_payables, v_gross_amt, v_tax_amt, v_net_amt, v_paid_amt, v_remaining_amt, v_failed_amt,
            v_paid_count, v_partial_count, v_unpaid_count, v_failed_count
        FROM public.dividend_payables
        WHERE declaration_id = p_declaration_id
           OR (declaration_id IS NULL AND company_id = v_declaration.company_id AND fiscal_year = v_declaration.fiscal_year);
    ELSE
        SELECT
            COUNT(*),
            COALESCE(SUM(gross_interest), 0),
            COALESCE(SUM(tax_amount), 0),
            COALESCE(SUM(net_payable), 0),
            COALESCE(SUM(paid_amount), 0),
            COALESCE(SUM(remaining_amount), 0),
            COALESCE(SUM(CASE WHEN returned_status IS NOT NULL AND returned_status != '' THEN net_payable ELSE 0 END), 0),
            COUNT(CASE WHEN payment_status = 'Paid' THEN 1 END),
            COUNT(CASE WHEN payment_status = 'Partial' THEN 1 END),
            COUNT(CASE WHEN payment_status = 'Pending' AND (returned_status IS NULL OR returned_status = '') THEN 1 END),
            COUNT(CASE WHEN returned_status IS NOT NULL AND returned_status != '' THEN 1 END)
        INTO
            v_total_payables, v_gross_amt, v_tax_amt, v_net_amt, v_paid_amt, v_remaining_amt, v_failed_amt,
            v_paid_count, v_partial_count, v_unpaid_count, v_failed_count
        FROM public.interest_payables
        WHERE declaration_id = p_declaration_id
           OR (declaration_id IS NULL AND company_id = v_declaration.company_id AND fiscal_year = v_declaration.fiscal_year);
    END IF;

    SELECT COUNT(*) INTO v_batches_count
    FROM public.payment_batches
    WHERE declaration_id = p_declaration_id
       OR (declaration_id IS NULL AND company_id = v_declaration.company_id AND fiscal_year = v_declaration.fiscal_year);

    RETURN jsonb_build_object(
        'declaration_id', v_declaration.id,
        'declaration_code', v_declaration.declaration_code,
        'declaration_type', v_declaration.declaration_type,
        'sub_type', v_declaration.sub_type,
        'fiscal_year', v_declaration.fiscal_year,
        'declaration_date', v_declaration.declaration_date,
        'record_date', v_declaration.record_date,
        'payment_due_date', v_declaration.payment_due_date,
        'rate_per_share', v_declaration.rate_per_share,
        'total_declared_amount', v_declaration.total_declared_amount,
        'total_payables_count', v_total_payables,
        'gross_amount', v_gross_amt,
        'tax_amount', v_tax_amt,
        'net_payable_amount', v_net_amt,
        'paid_amount', v_paid_amt,
        'remaining_amount', v_remaining_amt,
        'failed_amount', v_failed_amt,
        'paid_count', v_paid_count,
        'partial_count', v_partial_count,
        'unpaid_count', v_unpaid_count,
        'failed_count', v_failed_count,
        'batches_count', v_batches_count,
        'progress_percent', CASE WHEN v_net_amt > 0 THEN ROUND((v_paid_amt / v_net_amt) * 100, 2) ELSE 0 END
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_declaration_summary(uuid) TO authenticated, service_role;
GRANT ALL ON TABLE public.corporate_declarations TO authenticated, service_role;
