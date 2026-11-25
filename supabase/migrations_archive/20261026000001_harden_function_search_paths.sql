-- Migration: 20261026000001_harden_function_search_paths.sql
-- Description: Enforce explicit search_path on public schema functions to prevent search_path escalation vulnerabilities (Supabase lint: 0011_function_search_path_mutable)

ALTER FUNCTION public.set_updated_at() SET search_path = 'public';
ALTER FUNCTION public.calc_net_payable() SET search_path = 'public';
ALTER FUNCTION public.enforce_interest_payable_tax_rates() SET search_path = 'public';
ALTER FUNCTION public.mask_smtp_secrets(jsonb) SET search_path = 'public';
ALTER FUNCTION public.next_agm_broker_claim_seq() SET search_path = 'public';
ALTER FUNCTION public.trg_clients_set_needs_review() SET search_path = 'public';
