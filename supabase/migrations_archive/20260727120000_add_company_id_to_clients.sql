-- Add company_id to clients table to establish relationship
-- This ensures that when a company is deleted, all its clients are also deleted

-- Add company_id column to clients table
ALTER TABLE public.clients 
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_clients_company_id ON public.clients(company_id);

-- Update RLS policies to allow reading company_id
DROP POLICY IF EXISTS "clients_read" ON public.clients;
CREATE POLICY "clients_read" ON public.clients FOR SELECT TO authenticated USING (true);

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS trg_clients_updated ON public.clients;
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();