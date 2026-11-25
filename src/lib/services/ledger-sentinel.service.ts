import { supabase } from "./database";

export interface LedgerInvariantCheck {
  code: string;
  label: string;
  violations: number;
  passed: boolean;
}

export interface LedgerInvariantAuditReport {
  audited_at: string;
  company_id: string | null;
  passed: boolean;
  total_violations: number;
  checks: LedgerInvariantCheck[];
}

export const LedgerSentinelService = {
  /**
   * Executes the deterministic PostgreSQL ledger invariant audit across payables,
   * payment batches, payment line items, and classification gates.
   */
  async runAudit(companyId?: string | null): Promise<LedgerInvariantAuditReport> {
    const { data, error } = await (supabase as any).rpc("run_ledger_invariant_audit", {
      p_company_id: companyId || null,
    });
    if (error) {
      throw new Error(error.message || "Failed to execute ledger invariant audit");
    }
    const raw = (data || {}) as Partial<LedgerInvariantAuditReport>;
    const checks = Array.isArray(raw.checks)
      ? raw.checks.map((c: any) => ({
          code: String(c?.code || "UNKNOWN"),
          label: String(c?.label || "Invariant check"),
          violations: Number(c?.violations || 0),
          passed: Boolean(c?.passed),
        }))
      : [];
    return {
      audited_at: String(raw.audited_at || new Date().toISOString()),
      company_id: raw.company_id ?? null,
      passed: Boolean(raw.passed),
      total_violations: Number(raw.total_violations || 0),
      checks,
    };
  },
};
