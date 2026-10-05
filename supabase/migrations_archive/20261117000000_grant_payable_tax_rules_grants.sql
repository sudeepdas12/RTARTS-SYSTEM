-- =========================================================
-- Grant table-level privileges on payable_tax_rules to authenticated
--
-- The original migration (20261111000000) only granted SELECT. RLS policies do
-- not replace table grants in Postgres, so the "admins manage payable tax
-- rules" policy was unreachable for writes ("permission denied for table").
-- The System Settings page persists TDS rates into this table as the
-- authenticated admin, so it needs the base DML grants — the RLS policy still
-- restricts actual writes to admins only.
-- =========================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payable_tax_rules TO authenticated;
GRANT ALL ON public.payable_tax_rules TO service_role;
