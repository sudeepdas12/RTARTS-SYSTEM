-- Migration: Add missing audit triggers to complete universal audit trail
-- Attaches audit_trigger() to mutual_fund_payables, user_roles, and user_company_access

DROP TRIGGER IF EXISTS trg_audit_mf ON public.mutual_fund_payables;
CREATE TRIGGER trg_audit_mf
  AFTER INSERT OR UPDATE OR DELETE ON public.mutual_fund_payables
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_user_roles ON public.user_roles;
CREATE TRIGGER trg_audit_user_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_user_company_access ON public.user_company_access;
CREATE TRIGGER trg_audit_user_company_access
  AFTER INSERT OR UPDATE OR DELETE ON public.user_company_access
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
