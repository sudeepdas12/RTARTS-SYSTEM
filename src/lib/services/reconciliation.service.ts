import { supabase } from "./database";
import {
  extractReconciliationExceptions,
  type ReconciliationMatch,
  type ReconciliationExceptionSummary,
} from "../reconciliation-engine";

export interface ReconciliationResultRow {
  id: string;
  reconciliation_date: string;
  source_a_type: string;
  source_a_id: string | null;
  source_b_type: string;
  source_b_id: string | null;
  client_id: string | null;
  company_id: string | null;
  fiscal_year?: string | null;
  payable_type: string | null;
  payable_id: string | null;
  payment_id?: string | null;
  batch_id?: string | null;
  expected_amount: number | null;
  actual_amount: number | null;
  difference: number;
  result: string;
  notes: string | null;
  matched_by: string | null;
  matched_at: string | null;
  created_at: string;
  run_id?: string | null;
  match_method?: string | null;
  match_confidence?: number | null;
  candidate_count?: number | null;
  rejected_candidates?: any;
  rule_version?: string | null;
  requires_manual_approval?: boolean;
  client?: {
    full_name?: string;
    boid?: string;
    bank_name?: string;
    bank_account_no?: string;
  } | null;
  company?: {
    company_name?: string;
    company_code?: string;
  } | null;
}

export interface ReconciliationGroupedLot {
  lotKey: string;
  lotName: string;
  date: string;
  companyName: string;
  payableType: string;
  sourceType?: string;
  fileName?: string;
  batchRef?: string;
  totalRecords: number;
  matchedCount: number;
  rejectedCount: number;
  discrepancyCount: number;
  totalAmount: number;
  matchedAmount: number;
  rejectedAmount: number;
  runId?: string;
  fileHash?: string;
  status?: string;
  records: ReconciliationResultRow[];
}

export interface ReconciliationRunRow {
  id: string;
  company_id: string | null;
  company_name?: string | null;
  fiscal_year?: string | null;
  source_type: string;
  file_name: string;
  file_hash_sha256: string;
  row_count: number;
  total_amount: number;
  matched_count: number;
  unmatched_count: number;
  partial_count: number;
  rejected_count: number;
  parser_version: string;
  matching_rule_version: string;
  status: "draft" | "review" | "approved" | "applied" | "reverted" | "failed" | "processing";
  batch_id?: string | null;
  notes?: string | null;
  applied_by?: string | null;
  applied_at?: string | null;
  reverted_by?: string | null;
  reverted_at?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export type ReconciliationExceptionLifecycleStatus =
  "Open" | "Investigating" | "Accepted" | "Rejected" | "Resolved" | "Escalated";

export type ManualReasonCode =
  | "COUNTER_PAYOUT"
  | "CHEQUE_CLEARED"
  | "RTGS_OFFLINE"
  | "CONNECTIPS_MANUAL"
  | "BANK_CHARGE"
  | "INTEREST_CREDIT"
  | "SWEEP_INTERNAL"
  | "SUSPENSE_UNIDENTIFIED"
  | "ROUNDING_ADJUSTMENT"
  | "MANUAL_PAIR";

export interface BankStatementTransactionRow {
  id: string;
  import_id: string;
  company_id: string;
  transaction_date: string;
  description: string | null;
  reference: string | null;
  debit_amount: number;
  credit_amount: number;
  balance: number | null;
  reconciliation_status: "unreconciled" | "matched" | "reconciled" | "ignored" | "exception";
  reconciliation_run_id?: string | null;
  entry_channel: "file_upload" | "manual_entry" | "api_sync";
  reason_code?: ManualReasonCode | null;
  evidence_path?: string | null;
  maker_id?: string | null;
  approved_by?: string | null;
  approval_status: "pending_approval" | "approved" | "rejected";
  classification_notes?: string | null;
  matched_payment_ids?: string[];
  raw_data?: Record<string, any> | null;
  created_at: string;
  import?: {
    id: string;
    bank_name: string | null;
    account_no: string | null;
    file_name: string | null;
    entry_channel?: string | null;
  } | null;
}

export interface ManualPayableAllocationInput {
  payable_id: string;
  payable_type: "dividend" | "interest" | "mutual_fund";
  amount: number;
  shareholder_name?: string;
  boid?: string;
}

export interface ManualPayableSearchHit {
  id: string;
  company_id: string;
  client_id: string | null;
  payable_type: "dividend" | "interest" | "mutual_fund";
  fiscal_year: string | null;
  net_payable: number;
  paid_amount: number;
  remaining_amount: number;
  payment_status: string;
  payee_classification?: string | null;
  classification_status?: string | null;
  boid: string;
  full_name: string;
  bank_name: string;
  bank_account_no: string;
}

export interface BankReconciliationStatementSummary {
  company_id: string;
  period_start: string;
  period_end: string;
  is_period_locked: boolean;
  bank_closing_balance: number;
  bank_total_debit: number;
  bank_total_credit: number;
  reconciled_bank_debits: number;
  unreconciled_bank_debits: number;
  unreconciled_bank_credits: number;
  non_payable_bank_debits: number;
  non_payable_bank_credits: number;
  pending_manual_count: number;
  pending_manual_amount: number;
  ledger_paid_total: number;
  in_transit_batches_amount: number;
  reconciled_net_outflow: number;
  adjusted_matched_bank_debits: number;
  unreconciled_variance: number;
  open_exceptions_count: number;
  open_exceptions_amount: number;
  unapproved_variances_count: number;
  aging: {
    days_0_7: { count: number; amount: number };
    days_8_30: { count: number; amount: number };
    days_31_90: { count: number; amount: number };
    days_90_plus: { count: number; amount: number };
  };
}

export interface ReconciliationPeriodLockRow {
  id: string;
  company_id: string;
  fiscal_year?: string | null;
  period_start: string;
  period_end: string;
  bank_closing_balance: number;
  ledger_control_balance: number;
  unreconciled_difference: number;
  outstanding_items_count: number;
  status: "Locked" | "Reopened";
  maker_id: string;
  approved_by: string;
  approval_notes: string;
  locked_at: string;
  reopened_by?: string | null;
  reopened_at?: string | null;
  reopen_reason?: string | null;
}

export interface ReconciliationExceptionRow {
  id: string;
  run_id: string;
  company_id: string;
  result_id?: string | null;
  payable_id?: string | null;
  payable_type?: string | null;
  source_reference?: string | null;
  amount?: number | null;
  exception_reason: string;
  status: ReconciliationExceptionLifecycleStatus;
  assigned_to?: string | null;
  deadline?: string | null;
  notes?: string | null;
  resolution_notes?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export { computeSha256 } from "../crypto-hash";
import { computeSha256 } from "../crypto-hash";

export const ReconciliationService = {
  async getResultsCount(): Promise<number> {
    try {
      const { count, error } = await (supabase as any)
        .from("reconciliation_results")
        .select("id", { count: "exact", head: true });
      if (error) {
        console.error("Failed to count reconciliation results:", error.message);
        return 0;
      }
      return count ?? 0;
    } catch (err: any) {
      console.error("Failed to count reconciliation results:", err?.message || err);
      return 0;
    }
  },

  async getResults(limit = 10000, offset = 0): Promise<ReconciliationResultRow[]> {
    try {
      const { data, error } = await (supabase as any)
        .from("reconciliation_results")
        .select(
          `
          *,
          client:clients(full_name, boid, bank_name, bank_account_no),
          company:companies(company_name, company_code)
        `,
        )
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) {
        console.error("Failed to fetch reconciliation results:", error.message);
        throw error;
      }
      const enriched = ((data || []) as ReconciliationResultRow[]).map((r) => {
        if ((!r.client || !r.client.full_name) && r.notes) {
          const holderMatch = r.notes.match(/\[Holder:\s*([^|\]]+)(?:\|\s*BOID:\s*([^\]]+))?\]/);
          if (holderMatch) {
            r.client = {
              full_name: holderMatch[1]?.trim() || "Shareholder",
              boid: holderMatch[2]?.trim() || "",
              bank_name: r.client?.bank_name || "",
              bank_account_no: r.client?.bank_account_no || "",
            };
          }
        }
        return r;
      });
      return enriched;
    } catch (err: any) {
      console.error("Failed to fetch reconciliation results:", err?.message || err);
      throw err;
    }
  },

  groupResultsIntoLots(results: ReconciliationResultRow[]): ReconciliationGroupedLot[] {
    const map = new Map<string, ReconciliationGroupedLot>();

    for (const r of results) {
      // Extract batch ID, lot name, and file name from notes if present
      let batchRef = "Lot Settlement";
      let extractedFileName: string | undefined = undefined;

      if (r.notes) {
        if (r.notes.includes("[File:")) {
          const m = r.notes.match(/\[File:\s*([^\]|]+)/i);
          if (m && m[1]) {
            extractedFileName = m[1].trim();
            batchRef = extractedFileName.replace(/\.xlsx?$|\.csv$/i, "");
          }
        }
        if (r.notes.includes("Lot:")) {
          const m = r.notes.match(/Lot:\s*([^\]|]+)/i);
          if (m && m[1]) {
            const rawLot = m[1].trim();
            batchRef =
              rawLot.toLowerCase().startsWith("lot") ||
              rawLot.toLowerCase().startsWith("bank") ||
              rawLot.toLowerCase().startsWith("ips")
                ? rawLot
                : `Lot ${rawLot}`;
          }
        } else if (r.notes.includes("Batch:")) {
          const m = r.notes.match(/Batch:\s*([^\s|]+)/i);
          if (m && m[1]) {
            batchRef = `Batch ${m[1]}`;
          }
        } else if (r.notes.includes("ConnectIPS")) {
          if (!extractedFileName) batchRef = "ConnectIPS Settlement";
        }
      }

      const dateStr = r.reconciliation_date || r.created_at?.slice(0, 10) || "Unknown Date";
      const companyName = r.company?.company_name || "General Payables";
      const payableType = (r.payable_type || "interest").toUpperCase();

      // Canonical grouping by reconciliation run_id when available, otherwise cluster key
      const lotKey = r.run_id || `${dateStr}__${batchRef}__${companyName}__${payableType}`;
      const lotName = `${batchRef} (${payableType})`;

      if (!map.has(lotKey)) {
        map.set(lotKey, {
          lotKey,
          lotName,
          date: dateStr,
          companyName,
          payableType,
          sourceType:
            r.source_a_type ||
            (extractedFileName?.toLowerCase().includes("statement") ? "bank_statement" : "excel"),
          fileName: extractedFileName,
          batchRef,
          totalRecords: 0,
          matchedCount: 0,
          rejectedCount: 0,
          discrepancyCount: 0,
          totalAmount: 0,
          matchedAmount: 0,
          rejectedAmount: 0,
          runId: r.run_id || undefined,
          records: [],
        });
      }

      const lot = map.get(lotKey)!;
      if (r.run_id && !lot.runId) lot.runId = r.run_id;
      if (r.source_a_type === "bank_statement") {
        lot.sourceType = "bank_statement";
      }
      lot.totalRecords += 1;
      const actualAmt = Number(r.actual_amount || r.expected_amount || 0);
      lot.totalAmount += actualAmt;
      lot.records.push(r);

      if (r.result === "Matched") {
        lot.matchedCount += 1;
        lot.matchedAmount += actualAmt;
      } else if (r.result === "Rejected") {
        lot.rejectedCount += 1;
        lot.rejectedAmount += actualAmt;
      } else {
        lot.discrepancyCount += 1;
      }
    }

    return Array.from(map.values());
  },

  async saveResults(
    results: Record<string, any>[],
  ): Promise<{ savedCount: number; runId?: string }> {
    if (!results.length) return { savedCount: 0 };
    const chunkSize = 200;
    let savedCount = 0;

    // Lot/file deduplication: if notes have [File: ...], remove previous identical lot logs to prevent accumulation across sessions
    const firstNote = results[0]?.notes || "";
    const fileMatch = firstNote.match(/\[File:\s*([^\]|]+)/i);
    const fileName = fileMatch && fileMatch[1] ? fileMatch[1].trim() : "manual-reconciliation";
    if (fileMatch && fileMatch[1]) {
      await (supabase as any)
        .from("reconciliation_results")
        .delete()
        .ilike("notes", `%[File: ${fileName}%`);
    }

    const activeRunId = results[0]?.run_id || null;
    const companyId = results[0]?.company_id || null;
    const matchedCount = results.filter(
      (r) => r.result === "MATCHED" || r.result === "Matched",
    ).length;
    const partialCount = results.filter(
      (r) =>
        r.result === "PARTIAL" ||
        r.result === "Partial" ||
        r.result === "Under_Paid" ||
        r.result === "Over_Paid",
    ).length;
    const rejectedCount = results.filter(
      (r) => r.result === "EXCEPTION" || r.result === "Exception" || r.result === "Rejected",
    ).length;
    const unmatchedCount = results.filter(
      (r) => r.result === "NOT_MATCHED" || r.result === "Missing",
    ).length;
    const totalAmount = results.reduce(
      (acc, r) => acc + Number(r.actual_amount || r.expected_amount || 0),
      0,
    );
    const fileHash = await computeSha256(`${companyId || ""}-${fileName}-${Date.now()}`);

    // Server-authoritative atomic draft persistence RPC
    try {
      const { data: rpcData, error: rpcErr } = await (supabase as any).rpc(
        "save_reconciliation_draft_results_atomic",
        {
          p_run_info: {
            run_id: activeRunId,
            company_id: companyId,
            source_type: "manual",
            file_name: fileName,
            file_hash_sha256: fileHash,
            row_count: results.length,
            total_amount: totalAmount,
            matched_count: matchedCount,
            partial_count: partialCount,
            rejected_count: rejectedCount,
            unmatched_count: unmatchedCount,
          },
          p_results: results,
        },
      );

      if (!rpcErr && rpcData?.success) {
        return {
          savedCount: Number(rpcData.saved_count ?? results.length),
          runId: rpcData.run_id ?? activeRunId ?? undefined,
        };
      }
      if (rpcErr) {
        const isOfflineMock =
          (rpcErr.code === "PGRST202" ||
            rpcErr.message?.includes("does not exist") ||
            rpcErr.message?.includes("function") ||
            (rpcErr instanceof TypeError && rpcErr.message === "fetch failed")) &&
          process.env.NODE_ENV === "test" &&
          !import.meta.env?.PROD;
        if (!isOfflineMock) {
          throw new Error(`Failed to save reconciliation results atomically: ${rpcErr.message}`);
        }
      }
    } catch (e: any) {
      if (e?.message?.includes("Failed to save reconciliation results atomically")) {
        throw e;
      }
      if (import.meta.env?.PROD || process.env.NODE_ENV === "production") {
        throw new Error(
          `Atomic draft persistence required in production, but was bypassed: ${e?.message || e}`,
          { cause: e },
        );
      }
    }

    if (import.meta.env?.PROD || process.env.NODE_ENV === "production") {
      throw new Error(
        "Direct reconciliation results table insert is strictly prohibited in production.",
      );
    }

    // Offline mock fallback for unit tests without database RPC
    const ALLOWED_COLUMNS = new Set([
      "id",
      "run_id",
      "reconciliation_date",
      "source_a_type",
      "source_a_id",
      "source_b_type",
      "source_b_id",
      "client_id",
      "company_id",
      "payable_type",
      "payable_id",
      "payment_id",
      "batch_id",
      "expected_amount",
      "actual_amount",
      "difference",
      "result",
      "notes",
      "match_method",
      "match_confidence",
      "candidate_count",
      "rejected_candidates",
      "rule_version",
      "requires_manual_approval",
      "matched_by",
      "matched_at",
      "fiscal_year",
    ]);

    for (let i = 0; i < results.length; i += chunkSize) {
      const chunk = results.slice(i, i + chunkSize).map((item) => {
        const sanitized: Record<string, any> = {};
        for (const [k, v] of Object.entries(item)) {
          if (ALLOWED_COLUMNS.has(k)) {
            sanitized[k] = v;
          }
        }
        if (!sanitized.run_id && activeRunId) {
          sanitized.run_id = activeRunId;
        }
        return sanitized;
      });
      const { error } = await (supabase as any).from("reconciliation_results").insert(chunk);
      if (error) {
        console.error("Failed to save reconciliation results chunk:", error.message);
        throw new Error(`Failed to save reconciliation results: ${error.message}`);
      }
      savedCount += chunk.length;
    }
    return { savedCount, runId: activeRunId ?? undefined };
  },

  async deleteRecords(ids: string[]): Promise<boolean> {
    if (!ids.length) return true;
    try {
      const chunkSize = 100;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const { error } = await (supabase as any)
          .from("reconciliation_results")
          .delete()
          .in("id", chunk);
        if (error) {
          console.error("Failed to delete chunk:", error.message);
          return false;
        }
      }
      return true;
    } catch (err) {
      console.warn("Failed to delete reconciliation records:", err);
      return false;
    }
  },

  async revertLot(lot: ReconciliationGroupedLot): Promise<{
    revertedPayables: number;
    deletedPayments: number;
    historyDeleted: boolean;
    success: boolean;
  }> {
    const resultIds = (lot.records || []).map((r) => r.id).filter(Boolean);
    const runId = lot.runId || lot.records?.[0]?.run_id;

    // 1. Primary: Use atomic run-scoped revert if runId is available
    if (runId) {
      const { data, error } = await (supabase as any).rpc("revert_reconciliation_run_atomic", {
        p_run_id: runId,
        p_force: false,
      });

      if (error) {
        console.error("revert_reconciliation_run_atomic failed:", error.message);
        throw new Error(`Failed to safely revert reconciliation run: ${error.message}`);
      }

      return {
        revertedPayables: Number(data?.reverted_payables ?? 0),
        deletedPayments: Number(data?.deleted_payments ?? 0),
        historyDeleted: true,
        success: Boolean(data?.success),
      };
    }

    if (!resultIds.length) {
      return { revertedPayables: 0, deletedPayments: 0, historyDeleted: false, success: true };
    }

    // 2. Fallback to atomic lot-scoped revert (Strictly fail-closed, no un-transactional client-side fallback)
    const { data, error } = await (supabase as any).rpc("revert_reconciliation_lot_atomic", {
      p_result_ids: resultIds,
    });

    if (error) {
      console.error("revert_reconciliation_lot_atomic failed (fail closed):", error.message);
      throw new Error(`Atomic reconciliation lot revert failed: ${error.message}`);
    }

    return {
      revertedPayables: Number(data?.reverted_payables ?? 0),
      deletedPayments: Number(data?.updated_payments ?? data?.deleted_payments ?? 0),
      historyDeleted: Number(data?.deleted_results ?? 0) > 0,
      success: Boolean(data?.success),
    };
  },

  async clearHistory(date?: string): Promise<boolean> {
    try {
      let q = (supabase as any).from("reconciliation_results").delete();
      if (date) {
        q = q.eq("reconciliation_date", date);
      } else {
        q = q.neq("id", "00000000-0000-0000-0000-000000000000");
      }
      const { error } = await q;
      return !error;
    } catch (err) {
      console.warn("Failed to clear reconciliation history:", err);
      return false;
    }
  },

  /**
   * Safe operation-scoped revert:
   * - If a runId UUID is provided, atomically reverts that specific run.
   * - Never resets Completed/Settled payments without explicit supervisor approval.
   * - Fails closed if atomic RPC encounters an error.
   */
  async revertReconciliation(
    batchIdOrRunId?: string,
  ): Promise<{ revertedPayables: number; deletedPayments: number; success: boolean }> {
    const isUuid =
      batchIdOrRunId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        batchIdOrRunId,
      );

    if (isUuid) {
      const { data, error } = await (supabase as any).rpc("revert_reconciliation_run_atomic", {
        p_run_id: batchIdOrRunId,
        p_force: false,
      });

      if (error) {
        console.error("revert_reconciliation_run_atomic failed:", error.message);
        throw new Error(`Atomic run revert failed: ${error.message}`);
      }

      return {
        revertedPayables: Number(data?.reverted_payables ?? 0),
        deletedPayments: Number(data?.deleted_payments ?? 0),
        success: Boolean(data?.success),
      };
    }

    // If query string or date, find runs matching notes/date
    let query = (supabase as any).from("reconciliation_runs").select("id").limit(10);
    if (batchIdOrRunId) {
      query = query.or(`file_name.ilike.%${batchIdOrRunId}%,notes.ilike.%${batchIdOrRunId}%`);
    }
    const { data: runs } = await query;
    if (runs && runs.length > 0) {
      let totPayables = 0;
      let totPayments = 0;
      for (const r of runs) {
        const { data: revData, error: revErr } = await (supabase as any).rpc(
          "revert_reconciliation_run_atomic",
          {
            p_run_id: r.id,
            p_force: false,
          },
        );
        if (revErr) {
          throw new Error(`Failed to revert reconciliation run ${r.id}: ${revErr.message}`);
        }
        totPayables += Number(revData?.reverted_payables ?? 0);
        totPayments += Number(revData?.deleted_payments ?? 0);
      }
      return { revertedPayables: totPayables, deletedPayments: totPayments, success: true };
    }

    return { revertedPayables: 0, deletedPayments: 0, success: true };
  },

  /**
   * Apply reconciliation results to the system:
   * - For "Matched" records: update the payable's payment_status to "Paid"
   *   and create a corresponding record in the payments table.
   * - For "Over_Paid"/"Under_Paid": update the payable's payment_status to "Partial"
   *   and create a payment record with the actual paid amount.
   * - For "Missing": no system changes (the payable was not found in the payment bill).
   *
   * Creates a tracking batch for the reconciliation payments and includes idempotency protection.
   */
  async applyReconciliation(
    results: ReconciliationResultRow[],
    paymentMethod: string = "ConnectIPS",
    runOptions?: {
      fileName?: string;
      fileHash?: string;
      sourceType?: string;
      fiscalYear?: string;
    },
  ): Promise<{
    updated: number;
    paymentsCreated: number;
    alreadyPaid: number;
    resultsInserted?: number;
    exceptionsCreated?: number;
    rejectedCount?: number;
    runId?: string;
    runIds?: string[];
    errors: string[];
  }> {
    const applicableResults = results.filter(
      (r) =>
        r.result === "Matched" ||
        r.result === "Over_Paid" ||
        r.result === "Under_Paid" ||
        r.result === "Partial" ||
        r.result === "Rejected",
    );
    if (!applicableResults.length) {
      return {
        updated: 0,
        paymentsCreated: 0,
        alreadyPaid: 0,
        resultsInserted: 0,
        exceptionsCreated: 0,
        rejectedCount: 0,
        errors: [],
      };
    }

    let updated = 0;
    let paymentsCreated = 0;
    let alreadyPaid = 0;
    let rejectedCount = 0;
    const errors: string[] = [];

    // Helper to normalize payable types from any source format
    const normalizeType = (type?: string | null): "dividend" | "interest" | "mutual_fund" => {
      const t = String(type || "")
        .toLowerCase()
        .trim();
      if (t.includes("interest")) return "interest";
      if (t.includes("mutual_fund") || t.includes("mutual")) return "mutual_fund";
      if (t.includes("dividend")) return "dividend";
      return "interest";
    };

    // Helper to identify batch settlement debit records
    const isBatchRecord = (r: ReconciliationResultRow): boolean => {
      return (
        r.source_b_type === "batch" ||
        Boolean(r.batch_id) ||
        (Boolean(r.notes) && r.notes!.includes("Category: Payment Batch Debit")) ||
        (Boolean(r.notes) && r.notes!.includes("Batch:"))
      );
    };

    const batchMatches = applicableResults.filter(isBatchRecord);
    const individualMatches = applicableResults.filter((r) => !isBatchRecord(r));

    // 1. Process Batch Header matches (aggregate debit in bank statement)
    let batchesUpdated = 0;
    let batchesAlreadyCompleted = 0;
    const processedBatchIds = new Set<string>();

    for (const b of batchMatches) {
      let batchId = b.batch_id || (b.source_b_type === "batch" ? b.source_b_id : null);
      if (!batchId && b.notes) {
        const batchNameMatch = b.notes.match(/Batch:\s*([^/\]\n]+)/);
        if (batchNameMatch && batchNameMatch[1]) {
          const bName = batchNameMatch[1].trim();
          const { data: foundBatch } = await (supabase as any)
            .from("payment_batches")
            .select("id, status, total_payments")
            .eq("batch_name", bName)
            .maybeSingle();
          if (foundBatch) batchId = foundBatch.id;
        }
      }

      if (!batchId || processedBatchIds.has(batchId)) continue;
      processedBatchIds.add(batchId);

      const { data: batchRow, error: fetchErr } = await (supabase as any)
        .from("payment_batches")
        .select("id, status, total_payments")
        .eq("id", batchId)
        .maybeSingle();

      if (fetchErr || !batchRow) {
        errors.push(`Payment batch ${batchId} not found in system.`);
        continue;
      }

      if (batchRow.status === "Completed") {
        batchesAlreadyCompleted += 1;
        alreadyPaid += Number(batchRow.total_payments || 1);
        continue;
      }

      // Setting status = 'Completed' fires trg_payment_batch_completed which runs complete_payment_batch_atomic
      const { error: updateErr } = await (supabase as any)
        .from("payment_batches")
        .update({
          status: "Completed",
          processed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", batchId)
        .neq("status", "Completed");

      if (updateErr) {
        errors.push(`Failed to complete payment batch ${batchId}: ${updateErr.message}`);
      } else {
        batchesUpdated += 1;
        updated += Number(batchRow.total_payments || 1);
      }
    }

    // 2. Determine dominant payable type across individual matched results
    const typeCounts = individualMatches.reduce(
      (acc, r) => {
        const t = normalizeType(r.payable_type);
        acc[t] = (acc[t] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    // Default to "interest" rather than "dividend" — RTARTS primarily handles debenture interest
    const dominantPayableType =
      Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "interest";

    // 3. Group individual matches by company_id so each company gets its own batch
    // This fixes the bug where all multi-company results were lumped into one batch
    // using only the first company_id found.
    const matchesByCompany = new Map<string, ReconciliationResultRow[]>();
    for (const r of individualMatches) {
      const cid = r.company_id || "__no_company__";
      if (!matchesByCompany.has(cid)) matchesByCompany.set(cid, []);
      matchesByCompany.get(cid)!.push(r);
    }
    const todayStr = new Date().toISOString().split("T")[0];

    // 4. Resolve payable IDs and group into per-company payloads
    // Key: company_id (or "__no_company__" for unresolved) → items array
    const itemsPayloadByCompany = new Map<string, any[]>();

    for (const r of individualMatches) {
      const groupCid = r.company_id || "__no_company__";
      let payableId =
        r.payable_id ||
        (r.source_b_type !== "payment" && r.source_b_type !== "batch" ? r.source_b_id : null) ||
        null;
      const paymentId = r.source_b_type === "payment" ? r.source_b_id : r.payment_id || null;
      let payableType: string = normalizeType(r.payable_type || dominantPayableType);

      // If payableId is missing, strictly look up an exact matching pending payable
      if (!payableId && !paymentId && r.client_id) {
        const expAmt = Number(r.expected_amount || r.actual_amount || 0);
        const searchTables = [
          payableType === "dividend"
            ? "dividend_payables"
            : payableType === "interest"
              ? "interest_payables"
              : "mutual_fund_payables",
        ];

        for (const tbl of searchTables) {
          let q = (supabase as any)
            .from(tbl)
            .select("id, net_payable, payment_status, fiscal_year, company_id")
            .eq("client_id", r.client_id)
            .neq("payment_status", "Paid");

          if (r.company_id) q = q.eq("company_id", r.company_id);
          if (r.fiscal_year) q = q.eq("fiscal_year", r.fiscal_year);

          const { data: foundRows } = await q.limit(10);
          if (foundRows && foundRows.length > 0) {
            const exact = foundRows.find(
              (p: any) => expAmt > 0 && Math.abs(Number(p.net_payable) - expAmt) <= 0.01,
            );
            if (exact) {
              payableId = exact.id;
              payableType =
                tbl === "interest_payables"
                  ? "interest"
                  : tbl === "mutual_fund_payables"
                    ? "mutual_fund"
                    : "dividend";
              break;
            } else if (
              foundRows.length === 1 &&
              (r.result === "Under_Paid" || r.result === "Over_Paid" || r.result === "Partial")
            ) {
              payableId = foundRows[0].id;
              payableType =
                tbl === "interest_payables"
                  ? "interest"
                  : tbl === "mutual_fund_payables"
                    ? "mutual_fund"
                    : "dividend";
              break;
            }
          }
        }

        if (!payableId) {
          errors.push(
            `Skipping client ${r.client_id}: no pending payable found matching amount ${expAmt}`,
          );
          continue;
        }
      } else if (!payableId && !paymentId && !r.client_id) {
        // Log descriptive note and skip without failing the entire apply transaction
        errors.push(
          `Skipping unlinked record (${r.actual_amount ?? r.expected_amount ?? 0} NPR): no payable ID, payment ID, or client ID available`,
        );
      }

      const lotSuffix = (r as any).lot_name ? `:::${(r as any).lot_name}` : "";
      const groupKey = `${groupCid}${lotSuffix}`;

      if (!itemsPayloadByCompany.has(groupKey)) {
        itemsPayloadByCompany.set(groupKey, []);
      }
      itemsPayloadByCompany.get(groupKey)!.push({
        id: r.id,
        payable_id: payableId,
        payment_id: paymentId,
        company_id: r.company_id || null,
        client_id: r.client_id,
        fiscal_year: r.fiscal_year || null,
        payable_type: payableType,
        source_a_type: r.source_a_type || "excel",
        source_b_type: r.source_b_type || "payable",
        target_table:
          payableType === "interest"
            ? "interest_payables"
            : payableType === "mutual_fund"
              ? "mutual_fund_payables"
              : "dividend_payables",
        actual_amount: Number(r.actual_amount || r.expected_amount || 0),
        expected_amount: Number(r.expected_amount || r.actual_amount || 0),
        difference: Number(r.difference || 0),
        paid_amount: Number(r.actual_amount || r.expected_amount || 0),
        result: r.result,
        reconciliation_result: r.result,
        notes: r.notes || null,
        match_method: (r as any).match_method || (r as any).matchMethod || "instruction_id",
        match_confidence: (r as any).match_confidence || (r as any).confidenceScore || 80,
        candidate_count: (r as any).candidate_count || (r as any).candidateCount || 1,
        rejected_candidates: (r as any).rejected_candidates || (r as any).rejectedCandidates || [],
        rule_version: (r as any).rule_version || (r as any).ruleVersion || "2.0.0",
        bank_name: (r as any).bank_name || r.client?.bank_name || null,
        bank_account_no: (r as any).bank_account_no || r.client?.bank_account_no || null,
        payment_reference: `RECON-${r.id ? String(r.id).slice(0, 8) : "AUTO"}`,
        connectips_ref: (r as any).connectips_ref || (r as any).instruction_id || null,
        source_reference:
          (r as any).source_reference ||
          (r as any).instruction_id ||
          (r as any).connectips_ref ||
          (r as any).reference_id ||
          (r.id ? `REC-${r.id}` : `ITEM-${itemsPayloadByCompany.get(groupKey)!.length}`),
        transaction_fingerprint: (r as any).transaction_fingerprint || null,
      });
    }

    // 5. Execute atomic RPC call per company and lot group
    let totalItemsProcessed = 0;
    const allRunIds: string[] = [];
    let resultsInserted = 0;
    let exceptionsCreated = 0;

    for (const [groupKey, groupItems] of itemsPayloadByCompany.entries()) {
      if (groupItems.length === 0) continue;
      totalItemsProcessed += groupItems.length;

      // Each company and lot group maintains its own isolated reconciliation run
      let activeRunId: string | null = null;

      const [groupCid, lotName] = groupKey.split(":::");
      const resolvedCompanyId = groupCid === "__no_company__" ? null : groupCid;
      // Dominant type per this company group
      const groupTypeCounts = groupItems.reduce((acc: Record<string, number>, item: any) => {
        const t = normalizeType(item.payable_type);
        acc[t] = (acc[t] || 0) + 1;
        return acc;
      }, {});
      const groupDominantType =
        Object.entries(groupTypeCounts).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] ||
        dominantPayableType;

      const firstRef = groupItems.find((it: any) => it.connectips_ref)?.connectips_ref;
      const detectedBatchRef = firstRef ? String(firstRef).slice(0, 11) : "RECON-APPLY";

      const batchTitle = lotName
        ? `${lotName} (${todayStr})`
        : `Reconciliation Auto-Batch ${todayStr}${resolvedCompanyId ? ` [${resolvedCompanyId.slice(0, 8)}]` : ""}`;

      const batchInfo = {
        batch_name: batchTitle,
        company_id: resolvedCompanyId,
        payable_type: groupDominantType,
        payment_method: paymentMethod,
        total_records: groupItems.length,
        total_net: groupItems.reduce(
          (acc: number, item: any) => acc + Number(item.actual_amount || item.expected_amount || 0),
          0,
        ),
        total_tax: 0,
        cds_batch_ref: detectedBatchRef,
      };

      const CHUNK_SIZE = 500;
      const totalChunks = Math.ceil(groupItems.length / CHUNK_SIZE);
      for (let i = 0; i < groupItems.length; i += CHUNK_SIZE) {
        const chunkIndex = Math.floor(i / CHUNK_SIZE);
        const isFinalChunk = chunkIndex === totalChunks - 1;
        const chunk = groupItems.slice(i, i + CHUNK_SIZE);
        const fileHash = await computeSha256(
          `${resolvedCompanyId || "all"}|${lotName || "batch"}|${groupItems.length}|${todayStr}`,
        );

        // Call unified atomic apply + persist RPC (fails closed, no insecure legacy fallback)
        const { data: unifiedData, error: unifiedErr }: { data: any; error: any } = await (
          supabase as any
        ).rpc("apply_and_record_reconciliation_batch", {
          p_run_info: {
            run_id: activeRunId,
            chunk_index: chunkIndex,
            total_chunks: totalChunks,
            expected_chunk_count: totalChunks,
            is_final_chunk: isFinalChunk,
            company_id: resolvedCompanyId,
            fiscal_year: chunk[0]?.fiscal_year || null,
            source_type: chunk[0]?.source_a_type || "excel",
            file_name: lotName || "Reconciliation Batch",
            file_hash_sha256: fileHash,
            idempotency_key: `${resolvedCompanyId || "all"}_${fileHash || lotName}_chunk_${chunkIndex}`,
            row_count: groupItems.length,
            total_amount: groupItems.reduce(
              (acc: number, item: any) =>
                acc + Number(item.actual_amount || item.expected_amount || 0),
              0,
            ),
            parser_version: "2.0.0",
            matching_rule_version: "2.0.0",
          },
          p_items: chunk,
          p_batch_info: i === 0 ? batchInfo : null,
        });

        if (unifiedErr) {
          throw new Error(
            `Atomic reconciliation batch failed (records ${i + 1}-${i + chunk.length}): ${unifiedErr.message}`,
          );
        }

        if (!unifiedData || !unifiedData.success) {
          throw new Error(
            `Reconciliation transaction failed (records ${i + 1}-${i + chunk.length}): ${unifiedData?.error || "Transaction rolled back"}`,
          );
        }

        const rpcRes: any = unifiedData;
        if (rpcRes.run_id && !activeRunId) {
          activeRunId = rpcRes.run_id;
          if (!allRunIds.includes(rpcRes.run_id)) {
            allRunIds.push(rpcRes.run_id);
          }
        }
        resultsInserted += Number(rpcRes.results_inserted ?? 0);
        exceptionsCreated += Number(rpcRes.exceptions_created ?? 0);

        if (!rpcRes || !rpcRes.success) {
          throw new Error(
            `Reconciliation transaction failed (records ${i + 1}-${i + chunk.length}): ${rpcRes?.error || "Transaction rolled back"}`,
          );
        }

        updated += Number(
          rpcRes.updated_payables ?? rpcRes.payables_updated ?? rpcRes.updated ?? 0,
        );
        paymentsCreated += Number(
          rpcRes.updated_payments ?? rpcRes.payments_created ?? rpcRes.paymentsCreated ?? 0,
        );
        alreadyPaid += Number(rpcRes.already_paid_skipped ?? rpcRes.already_paid ?? 0);
        rejectedCount += Number(rpcRes.rejected_count ?? 0);
        if (Array.isArray(rpcRes.errors) && rpcRes.errors.length > 0) {
          for (const err of rpcRes.errors) {
            errors.push(err?.error || JSON.stringify(err));
          }
        }

        // Link reconciled bank_statement_transactions by deterministic fingerprint (handles keyless & 1-to-N batch rows)
        const chunkFingerprints = Array.from(
          new Set(
            chunk
              .filter(
                (it: any) =>
                  typeof it.transaction_fingerprint === "string" &&
                  it.transaction_fingerprint.length > 0 &&
                  String(it.result || "").toUpperCase() === "MATCHED",
              )
              .map((it: any) => it.transaction_fingerprint as string),
          ),
        );
        if (resolvedCompanyId && activeRunId && chunkFingerprints.length > 0) {
          try {
            await (supabase as any).rpc("mark_bank_transactions_reconciled_by_fingerprints", {
              p_company_id: resolvedCompanyId,
              p_run_id: activeRunId,
              p_fingerprints: chunkFingerprints,
            });
          } catch (fpErr) {
            console.warn("Bank ledger fingerprint sync skipped:", fpErr);
          }
        }
      }
    }

    if (
      updated === 0 &&
      paymentsCreated === 0 &&
      alreadyPaid === 0 &&
      rejectedCount === 0 &&
      totalItemsProcessed === 0 &&
      batchesUpdated === 0 &&
      batchesAlreadyCompleted === 0
    ) {
      return {
        updated: 0,
        paymentsCreated: 0,
        alreadyPaid: 0,
        resultsInserted,
        exceptionsCreated,
        rejectedCount: 0,
        errors,
      };
    }

    // 5. Process remarks for Rejected transactions strictly
    const rejectedResults = results.filter((r) => r.result === "Rejected");
    for (const rej of rejectedResults) {
      try {
        let payableType = normalizeType(rej.payable_type || dominantPayableType);
        let payableId = rej.payable_id;

        if (!payableId && rej.client_id) {
          const expAmt = Number(rej.expected_amount || rej.actual_amount || 0);
          const searchTables = [
            payableType === "dividend"
              ? "dividend_payables"
              : payableType === "interest"
                ? "interest_payables"
                : "mutual_fund_payables",
          ];
          for (const tbl of searchTables) {
            let q = (supabase as any)
              .from(tbl)
              .select("id, net_payable, payment_status")
              .eq("client_id", rej.client_id);
            if (rej.company_id) q = q.eq("company_id", rej.company_id);
            if (rej.fiscal_year) q = q.eq("fiscal_year", rej.fiscal_year);
            const { data: foundRows } = await q.limit(10);
            if (foundRows && foundRows.length > 0) {
              const exactMatch =
                foundRows.find(
                  (p: any) => expAmt > 0 && Math.abs(Number(p.net_payable) - expAmt) <= 0.01,
                ) || (foundRows.length === 1 ? foundRows[0] : null);
              if (exactMatch) {
                payableId = exactMatch.id;
                payableType =
                  tbl === "interest_payables"
                    ? "interest"
                    : tbl === "mutual_fund_payables"
                      ? "mutual_fund"
                      : "dividend";
                break;
              }
            }
          }
        }

        const tableName =
          payableType === "dividend"
            ? "dividend_payables"
            : payableType === "interest"
              ? "interest_payables"
              : payableType === "mutual_fund"
                ? "mutual_fund_payables"
                : null;

        if (tableName && payableId) {
          const rejectRemarks = `Bank Payout Rejected (RJCT): ${rej.notes || "Settlement Bounced"} [${new Date().toISOString().split("T")[0]}]`;

          await (supabase as any)
            .from(tableName)
            .update({
              payment_status: "Pending",
              remarks: rejectRemarks,
            })
            .eq("id", payableId);

          await (supabase as any)
            .from("payments")
            .update({
              status: "Pending",
              remarks: rejectRemarks,
            })
            .eq("payable_id", payableId);
        }
      } catch (rejErr) {
        console.warn("Could not update reject remarks:", rejErr);
      }
    }

    return {
      updated,
      paymentsCreated,
      alreadyPaid,
      resultsInserted,
      exceptionsCreated,
      rejectedCount,
      runId: allRunIds[0] ?? undefined,
      runIds: allRunIds,
      errors,
    };
  },

  getExceptions(
    matches: ReconciliationMatch[],
    varianceThresholdNpr = 1.0,
  ): ReconciliationExceptionSummary {
    return extractReconciliationExceptions(matches, varianceThresholdNpr);
  },

  async getReconciliationRuns(filter?: {
    companyId?: string | null;
    sourceType?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<{
    runs: ReconciliationRunRow[];
    totalCount: number;
    summary: {
      total_amount: number;
      matched_count: number;
      unmatched_count: number;
      row_count: number;
    };
  }> {
    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;
    try {
      const { data, error } = await (supabase as any).rpc("get_reconciliation_runs_paginated", {
        p_company_id: filter?.companyId || null,
        p_source_type: filter?.sourceType || null,
        p_status: filter?.status || null,
        p_search: filter?.search || null,
        p_limit: limit,
        p_offset: offset,
        p_start_date: filter?.startDate || null,
        p_end_date: filter?.endDate || null,
      });

      if (!error && data) {
        return {
          runs: (data.runs || []) as ReconciliationRunRow[],
          totalCount: Number(data.total_count ?? 0),
          summary: data.summary || {
            total_amount: 0,
            matched_count: 0,
            unmatched_count: 0,
            row_count: 0,
          },
        };
      }
    } catch (rpcErr) {
      console.warn("get_reconciliation_runs_paginated RPC error, falling back:", rpcErr);
    }

    // Direct table query fallback
    let query = (supabase as any)
      .from("reconciliation_runs")
      .select("*, company:companies(company_name)", { count: "exact" });

    if (filter?.companyId) query = query.eq("company_id", filter.companyId);
    if (filter?.sourceType) query = query.eq("source_type", filter.sourceType);
    if (filter?.status) query = query.eq("status", filter.status);
    if (filter?.startDate) query = query.gte("created_at", filter.startDate);
    if (filter?.endDate) query = query.lte("created_at", filter.endDate);
    if (filter?.search) query = query.ilike("file_name", `%${filter.search}%`);

    const { data, count, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Failed to query reconciliation_runs:", error.message);
      throw new Error(`Failed to load reconciliation run history: ${error.message}`);
    }

    const runs = (data || []).map((r: any) => ({
      ...r,
      company_name: r.company?.company_name || null,
    })) as ReconciliationRunRow[];

    return {
      runs,
      totalCount: count ?? runs.length,
      summary: {
        total_amount: runs.reduce((acc, r) => acc + Number(r.total_amount || 0), 0),
        matched_count: runs.reduce((acc, r) => acc + Number(r.matched_count || 0), 0),
        unmatched_count: runs.reduce((acc, r) => acc + Number(r.unmatched_count || 0), 0),
        row_count: runs.reduce((acc, r) => acc + Number(r.row_count || 0), 0),
      },
    };
  },

  async getDurableExceptions(filter?: {
    companyId?: string | null;
    runId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ exceptions: ReconciliationExceptionRow[]; totalCount: number }> {
    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;
    let query = (supabase as any).from("reconciliation_exceptions").select("*", { count: "exact" });

    if (filter?.companyId) query = query.eq("company_id", filter.companyId);
    if (filter?.runId) query = query.eq("run_id", filter.runId);
    if (filter?.status) query = query.eq("status", filter.status);

    const { data, count, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Failed to fetch reconciliation exceptions:", error.message);
      return { exceptions: [], totalCount: 0 };
    }

    return {
      exceptions: (data || []) as ReconciliationExceptionRow[],
      totalCount: count ?? data?.length ?? 0,
    };
  },

  async updateExceptionStatus(
    exceptionId: string,
    status: ReconciliationExceptionLifecycleStatus,
    notes?: string,
    resolutionNotes?: string,
  ): Promise<boolean> {
    const updatePayload: Record<string, any> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (notes) updatePayload.notes = notes;
    if (resolutionNotes) {
      updatePayload.resolution_notes = resolutionNotes;
      updatePayload.resolved_at = new Date().toISOString();
    }

    const { error } = await (supabase as any)
      .from("reconciliation_exceptions")
      .update(updatePayload)
      .eq("id", exceptionId);

    if (error) {
      console.error("Failed to update exception status:", error.message);
      return false;
    }
    return true;
  },

  async assignException(
    exceptionId: string,
    assignedTo: string,
    deadline?: string,
  ): Promise<boolean> {
    const updatePayload: Record<string, any> = {
      assigned_to: assignedTo,
      status: "Investigating",
      updated_at: new Date().toISOString(),
    };
    if (deadline) updatePayload.deadline = deadline;

    const { error } = await (supabase as any)
      .from("reconciliation_exceptions")
      .update(updatePayload)
      .eq("id", exceptionId);

    if (error) {
      console.error("Failed to assign exception:", error.message);
      return false;
    }
    return true;
  },

  async ingestBankStatementFile(
    companyId: string | null | undefined,
    file: File,
    transactions: any[],
    metadata?: {
      bankName?: string;
      accountNo?: string;
      openingBalance?: number;
      closingBalance?: number;
    },
  ): Promise<{
    importId: string;
    fileHash: string;
    insertedCount: number;
    duplicateCount?: number;
    totalRows?: number;
    isDuplicate?: boolean;
  }> {
    if (!companyId) {
      throw new Error(
        `Target company must be selected before ingesting bank statements into the immutable ledger for file ${file.name}.`,
      );
    }

    const fileHash = await computeSha256(file);
    const resolvedCompanyId = companyId;
    const bankName = metadata?.bankName || "Commercial Bank";
    const accountNo = metadata?.accountNo || "Statement Account";
    const totalDebit = transactions.reduce((acc, t) => acc + (Number(t.debit) || 0), 0);
    const totalCredit = transactions.reduce((acc, t) => acc + (Number(t.credit) || 0), 0);

    // Balance integrity validation: opening + credit - debit = closing
    const openingBalance = Number(metadata?.openingBalance ?? 0);
    const closingBalance = Number(metadata?.closingBalance ?? 0);
    if (openingBalance !== 0 || closingBalance !== 0) {
      const calculatedClosing = openingBalance + totalCredit - totalDebit;
      if (Math.abs(calculatedClosing - closingBalance) > 0.05) {
        throw new Error(
          `Bank statement balance integrity violation for ${file.name}: opening (${openingBalance.toFixed(2)}) + credit (${totalCredit.toFixed(2)}) - debit (${totalDebit.toFixed(2)}) = ${calculatedClosing.toFixed(2)}, but expected closing balance is ${closingBalance.toFixed(2)}.`,
        );
      }
    }

    // Precompute deterministic transaction fingerprints on every row so downstream matching & apply link cleanly
    const fingerprints = await Promise.all(
      transactions.map(async (t) => {
        const resolvedRef = t.reference || t.instructionId || t.referenceId || null;
        const rawFingerprintStr = `${resolvedCompanyId}|${t.date || ""}|${t.accountNo || ""}|${t.description || ""}|${resolvedRef || ""}|${t.category || ""}|${t.status || ""}|${t.batchId || ""}|${t.debit || 0}|${t.credit || 0}|${t.balance ?? ""}`;
        const fingerprint = await computeSha256(rawFingerprintStr);
        t.transactionFingerprint = fingerprint;
        return fingerprint;
      }),
    );

    // 1. Check for existing import with identical file hash to prevent duplicate import rows
    const { data: existingImport } = await (supabase as any)
      .from("bank_statement_imports")
      .select("id, file_name, row_count")
      .eq("file_hash_sha256", fileHash)
      .eq("company_id", resolvedCompanyId)
      .maybeSingle();

    if (existingImport) {
      console.info(
        `Duplicate bank statement file already ingested: ${file.name} (matches import ${existingImport.id})`,
      );
      return {
        importId: existingImport.id,
        fileHash,
        insertedCount: 0,
        isDuplicate: true,
      };
    }

    // 2. Transactional Ledger Persistence via Atomic RPC
    try {
      const payloadTransactions = transactions.map((t, idx) => {
        const resolvedRef = t.reference || t.instructionId || t.referenceId || null;
        const fingerprint = fingerprints[idx];
        return {
          transaction_date: t.date || new Date().toISOString().slice(0, 10),
          description: t.description || null,
          reference: resolvedRef,
          instruction_id: t.instructionId || null,
          reference_id: t.referenceId || null,
          debit_amount: Number(t.debit || 0),
          credit_amount: Number(t.credit || 0),
          balance: t.balance != null ? Number(t.balance) : null,
          transaction_fingerprint: fingerprint,
          raw_data: {
            accountNo: t.accountNo || null,
            category: t.category || null,
            status: t.status || null,
            batchId: t.batchId || null,
            beneficiaryName: t.beneficiaryName || null,
            instructionId: t.instructionId || null,
            referenceId: t.referenceId || null,
          },
        };
      });

      const { data: rpcRes, error: rpcErr } = await (supabase as any).rpc(
        "import_bank_statement_ledger_atomic",
        {
          p_import_info: {
            company_id: resolvedCompanyId,
            bank_name: bankName,
            account_no: accountNo,
            file_name: file.name,
            file_hash_sha256: fileHash,
            opening_balance: metadata?.openingBalance ?? 0,
            closing_balance: metadata?.closingBalance ?? 0,
            total_debit: totalDebit,
            total_credit: totalCredit,
            row_count: transactions.length,
            parser_metadata: {
              fileSize: file.size,
              lastModified: file.lastModified,
              type: file.type,
            },
          },
          p_transactions: payloadTransactions,
        },
      );

      if (!rpcErr && rpcRes && typeof rpcRes === "object") {
        return {
          importId: rpcRes.import_id,
          fileHash: rpcRes.file_hash || fileHash,
          insertedCount: Number(rpcRes.inserted_count ?? 0),
          duplicateCount: Number(rpcRes.duplicate_count ?? 0),
          totalRows: Number(rpcRes.total_rows ?? transactions.length),
          isDuplicate: Boolean(rpcRes.is_duplicate),
        };
      }
      if (rpcErr) {
        const isOfflineMock =
          (rpcErr.code === "PGRST202" ||
            rpcErr.message?.includes("does not exist") ||
            rpcErr.message?.includes("function")) &&
          process.env.NODE_ENV === "test" &&
          !import.meta.env?.PROD;
        if (!isOfflineMock) {
          console.error("import_bank_statement_ledger_atomic failed:", rpcErr.message);
          throw new Error(`Bank statement import failed for ${file.name}: ${rpcErr.message}`);
        }
      }
    } catch (e: any) {
      if (
        e?.message?.includes("Bank statement import failed") ||
        e?.message?.includes("balance integrity violation")
      ) {
        throw e;
      }
      if (import.meta.env?.PROD || process.env.NODE_ENV === "production") {
        throw new Error(
          `Bank statement import ledger creation failed for ${file.name}: ${e?.message || e}`,
          { cause: e },
        );
      }
      // If RPC is unavailable in offline unit tests, continue to direct fallback
    }

    // Direct table insert fallback is strictly disabled in production
    if (import.meta.env?.PROD || process.env.NODE_ENV === "production") {
      throw new Error(
        `Atomic bank statement import required in production, but was bypassed for ${file.name}.`,
      );
    }

    // Fallback: Direct table insert (offline unit test mocks only)
    const { data: imp, error: impErr } = await (supabase as any)
      .from("bank_statement_imports")
      .insert({
        company_id: resolvedCompanyId,
        bank_name: bankName,
        account_no: accountNo,
        file_name: file.name,
        file_hash_sha256: fileHash,
        opening_balance: metadata?.openingBalance ?? 0,
        closing_balance: metadata?.closingBalance ?? 0,
        total_debit: totalDebit,
        total_credit: totalCredit,
        row_count: transactions.length,
        parser_metadata: {
          fileSize: file.size,
          lastModified: file.lastModified,
          type: file.type,
        },
        status: "imported",
      })
      .select("id")
      .single();

    if (impErr) {
      // Handle unique conflict on (company_id, file_hash_sha256) gracefully
      if (
        impErr.code === "23505" ||
        impErr.message?.includes("uq_bank_statement_imports_company_hash") ||
        impErr.message?.includes("duplicate key")
      ) {
        const { data: dupImport } = await (supabase as any)
          .from("bank_statement_imports")
          .select("id, file_name, row_count")
          .eq("file_hash_sha256", fileHash)
          .eq("company_id", resolvedCompanyId)
          .maybeSingle();

        if (dupImport) {
          return {
            importId: dupImport.id,
            fileHash,
            insertedCount: 0,
            isDuplicate: true,
          };
        }
      }
      console.error("Could not insert bank_statement_imports:", impErr.message);
      throw new Error(
        `Bank statement import ledger creation failed for ${file.name}: ${impErr.message}`,
      );
    }

    const importId = imp.id;

    // 3. Insert transactions with fingerprint
    const batchSize = 250;
    let insertedCount = 0;
    try {
      for (let i = 0; i < transactions.length; i += batchSize) {
        const chunk = transactions.slice(i, i + batchSize);
        const rows = await Promise.all(
          chunk.map(async (t) => {
            const resolvedRef = t.reference || t.instructionId || t.referenceId || null;
            const rawFingerprintStr = `${resolvedCompanyId}|${t.date || ""}|${t.accountNo || ""}|${t.description || ""}|${resolvedRef || ""}|${t.category || ""}|${t.status || ""}|${t.batchId || ""}|${t.debit || 0}|${t.credit || 0}|${t.balance ?? ""}`;
            const fingerprint = await computeSha256(rawFingerprintStr);
            return {
              import_id: importId,
              company_id: resolvedCompanyId,
              transaction_date: t.date || new Date().toISOString().slice(0, 10),
              description: t.description || null,
              reference: resolvedRef,
              debit_amount: Number(t.debit || 0),
              credit_amount: Number(t.credit || 0),
              balance: t.balance != null ? Number(t.balance) : null,
              raw_data: {
                accountNo: t.accountNo || null,
                category: t.category || null,
                status: t.status || null,
                batchId: t.batchId || null,
                beneficiaryName: t.beneficiaryName || null,
                instructionId: t.instructionId || null,
                referenceId: t.referenceId || null,
              },
              transaction_fingerprint: fingerprint,
              reconciliation_status: "unreconciled",
            };
          }),
        );

        const upsertQuery = (supabase as any).from("bank_statement_transactions").upsert(rows, {
          onConflict: "company_id,transaction_fingerprint",
          ignoreDuplicates: true,
        });

        const { data: insertedRows, error: insErr } =
          typeof upsertQuery?.select === "function"
            ? await upsertQuery.select("id")
            : await upsertQuery;

        if (insErr) {
          console.error("Failed to insert bank_statement_transactions:", insErr.message);
          throw new Error(
            `Bank transaction ledger persistence failed for ${file.name} (chunk ${i + 1}-${i + chunk.length}): ${insErr.message}`,
          );
        }
        insertedCount += Array.isArray(insertedRows) ? insertedRows.length : rows.length;
      }
    } catch (txnErr: any) {
      // Mark import record rejected so partial imports are clearly audited and visible
      try {
        const updateBuilder = (supabase as any).from("bank_statement_imports");
        if (typeof updateBuilder?.update === "function") {
          const { error: rejectErr } = await updateBuilder
            .update({
              status: "rejected",
              parser_metadata: {
                fileSize: file.size,
                error: txnErr?.message || "Transaction persistence failed",
              },
            })
            .eq("id", importId);

          if (rejectErr) {
            console.error("Failed to mark bank_statement_imports as rejected:", rejectErr.message);
          }
        }
      } catch (secondaryErr: any) {
        console.error(
          "Secondary error updating bank_statement_imports status to rejected:",
          secondaryErr,
        );
      }
      throw txnErr;
    }

    return { importId, fileHash, insertedCount, isDuplicate: false };
  },

  /**
   * Approves an underpaid or overpaid reconciliation variance with server-side maker-checker enforcement.
   * Derives run, payable, amounts, variance attributes, and actor identity exclusively server-side.
   */
  async approveVariance(approvalInfo: {
    resultId?: string;
    runId?: string;
    payableId?: string;
    sourceReference?: string | null;
    approvalReason: string;
  }): Promise<{ success: boolean; approvalId: string; resultId?: string }> {
    const { data, error } = await (supabase as any).rpc("approve_reconciliation_variance_atomic", {
      p_approval_info: {
        result_id: approvalInfo.resultId || null,
        run_id: approvalInfo.runId || null,
        payable_id: approvalInfo.payableId || null,
        source_reference: approvalInfo.sourceReference || null,
        approval_reason: approvalInfo.approvalReason,
      },
    });

    if (error) {
      throw new Error(`Variance approval failed: ${error.message}`);
    }
    return {
      success: true,
      approvalId: data?.approval_id,
      resultId: data?.result_id,
    };
  },

  async acknowledgeException(
    exceptionId: string,
    notes: string,
    userId?: string,
  ): Promise<{ success: boolean; id: string; acknowledgedAt: string }> {
    const acknowledgedAt = new Date().toISOString();
    try {
      await (supabase as any).from("audit_logs").insert({
        action: "RECONCILIATION_EXCEPTION_ACKNOWLEDGED",
        target_entity: "reconciliation_exception",
        target_id: exceptionId,
        actor_id: userId || null,
        metadata: {
          exception_id: exceptionId,
          notes,
          acknowledged_at: acknowledgedAt,
        },
      });

      // Also update durable exceptions table if record exists
      await (supabase as any)
        .from("reconciliation_exceptions")
        .update({
          status: "Accepted",
          notes,
          updated_at: acknowledgedAt,
        })
        .eq("id", exceptionId);
    } catch (e) {
      console.warn("Could not persist audit log for exception acknowledgement:", e);
    }
    return { success: true, id: exceptionId, acknowledgedAt };
  },

  async getBankStatementTransactions(filter?: {
    companyIds?: string[];
    reconciliationStatus?: string;
    approvalStatus?: string;
    entryChannel?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ rows: BankStatementTransactionRow[]; totalCount: number }> {
    const limit = filter?.limit ?? 100;
    const offset = filter?.offset ?? 0;

    let query = (supabase as any)
      .from("bank_statement_transactions")
      .select(
        "*, import:bank_statement_imports(id, bank_name, account_no, file_name, entry_channel)",
        { count: "exact" },
      )
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (filter?.companyIds && filter.companyIds.length === 1) {
      query = query.eq("company_id", filter.companyIds[0]);
    } else if (filter?.companyIds && filter.companyIds.length > 1) {
      query = query.in("company_id", filter.companyIds);
    }

    if (filter?.reconciliationStatus && filter.reconciliationStatus !== "all") {
      query = query.eq("reconciliation_status", filter.reconciliationStatus);
    }
    if (filter?.approvalStatus && filter.approvalStatus !== "all") {
      query = query.eq("approval_status", filter.approvalStatus);
    }
    if (filter?.entryChannel && filter.entryChannel !== "all") {
      query = query.eq("entry_channel", filter.entryChannel);
    }
    if (filter?.search && filter.search.trim()) {
      const s = filter.search.trim().replace(/[%_,]/g, "");
      if (s) {
        query = query.or(
          `description.ilike.%${s}%,reference.ilike.%${s}%,reason_code.ilike.%${s}%`,
        );
      }
    }

    const { data, count, error } = await query.range(offset, offset + limit - 1);
    if (error) {
      const { data: sessionRes } = await supabase.auth.getSession();
      if (!sessionRes?.session) {
        return { rows: [], totalCount: 0 };
      }
      throw new Error(`Failed to load bank ledger transactions: ${error.message}`);
    }

    return {
      rows: (data || []) as BankStatementTransactionRow[],
      totalCount: count ?? data?.length ?? 0,
    };
  },

  async getCompanyOperators(
    companyId?: string | null,
  ): Promise<Array<{ id: string; full_name: string; email: string }>> {
    try {
      const { data, error } = await (supabase as any).rpc("get_company_operators", {
        p_company_id: companyId || null,
      });
      if (!error && Array.isArray(data)) {
        return data as Array<{ id: string; full_name: string; email: string }>;
      }
    } catch (e) {
      console.warn("get_company_operators fallback to profiles:", e);
    }

    try {
      const { data: profiles } = await (supabase as any)
        .from("profiles")
        .select("id, full_name, email")
        .order("full_name");
      return (profiles || []).map((p: any) => ({
        id: p.id,
        full_name: p.full_name || p.email || "Operator",
        email: p.email || "",
      }));
    } catch {
      return [];
    }
  },

  async searchPendingPayablesForManualMatch(
    companyId: string,
    searchQuery?: string,
    limit = 40,
  ): Promise<ManualPayableSearchHit[]> {
    if (!companyId) return [];

    const qTrim = (searchQuery || "").trim().toLowerCase();
    const fetchTable = async (
      table: "dividend_payables" | "interest_payables" | "mutual_fund_payables",
      payableType: "dividend" | "interest" | "mutual_fund",
    ): Promise<ManualPayableSearchHit[]> => {
      const { data, error } = await (supabase as any)
        .from(table)
        .select(
          "id, company_id, client_id, fiscal_year, net_payable, paid_amount, remaining_amount, payment_status, payee_classification, classification_status, bank_name, bank_account_no, clients(id, boid, full_name, bank_name, bank_account_no)",
        )
        .eq("company_id", companyId)
        .in("payment_status", ["Pending", "Partial"])
        .order("updated_at", { ascending: false })
        .limit(200);

      if (error) {
        console.warn(`Manual match search failed on ${table}:`, error.message);
        return [];
      }

      return (data || [])
        .map((row: any): ManualPayableSearchHit => {
          const net = Number(row.net_payable ?? 0);
          const paid = Number(row.paid_amount ?? 0);
          const remaining =
            row.remaining_amount != null
              ? Number(row.remaining_amount)
              : Math.max(0, Number((net - paid).toFixed(2)));
          return {
            id: row.id,
            company_id: row.company_id,
            client_id: row.client_id ?? null,
            payable_type: payableType,
            fiscal_year: row.fiscal_year ?? null,
            net_payable: net,
            paid_amount: paid,
            remaining_amount: remaining,
            payment_status: row.payment_status,
            payee_classification: row.payee_classification ?? null,
            classification_status: row.classification_status ?? null,
            boid: row.clients?.boid || "",
            full_name: row.clients?.full_name || "Unknown Beneficiary",
            bank_name: row.bank_name || row.clients?.bank_name || "",
            bank_account_no: row.bank_account_no || row.clients?.bank_account_no || "",
          };
        })
        .filter((h: ManualPayableSearchHit) => h.remaining_amount > 0);
    };

    const [divs, ints, mfs] = await Promise.all([
      fetchTable("dividend_payables", "dividend"),
      fetchTable("interest_payables", "interest"),
      fetchTable("mutual_fund_payables", "mutual_fund"),
    ]);

    const combined = [...divs, ...ints, ...mfs];
    const filtered = qTrim
      ? combined.filter(
          (item) =>
            item.boid.toLowerCase().includes(qTrim) ||
            item.full_name.toLowerCase().includes(qTrim) ||
            item.bank_account_no.toLowerCase().includes(qTrim) ||
            item.fiscal_year?.toLowerCase().includes(qTrim) ||
            String(item.remaining_amount).includes(qTrim) ||
            String(item.net_payable).includes(qTrim),
        )
      : combined;

    return filtered.slice(0, limit);
  },

  async uploadReconciliationEvidence(companyId: string, file: File): Promise<string> {
    if (!companyId) throw new Error("Company ID is required before uploading evidence.");
    const maxBytes = 20 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error("Supporting voucher exceeds 20 MB limit.");
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const objectPath = `${companyId}/${crypto.randomUUID()}-${safeName}`;

    const { error } = await supabase.storage
      .from("reconciliation-evidence")
      .upload(objectPath, file, {
        upsert: false,
        contentType: file.type || undefined,
      });

    if (error) {
      throw new Error(`Evidence upload failed: ${error.message}`);
    }
    return objectPath;
  },

  async getEvidenceSignedUrl(path: string, expiresInSeconds = 300): Promise<string> {
    const { data, error } = await supabase.storage
      .from("reconciliation-evidence")
      .createSignedUrl(path, expiresInSeconds);

    if (error || !data?.signedUrl) {
      throw new Error(`Unable to open supporting voucher: ${error?.message || "Unknown error"}`);
    }
    return data.signedUrl;
  },

  async submitManualBankEntry(entry: {
    companyId: string;
    transactionDate: string;
    debitAmount?: number;
    creditAmount?: number;
    reference: string;
    description: string;
    bankName?: string;
    accountNo?: string;
    reasonCode: ManualReasonCode;
    evidencePath?: string | null;
    notes?: string;
    allocations?: ManualPayableAllocationInput[];
  }): Promise<{ success: boolean; transactionId: string; approvalId: string; status: string }> {
    const { data, error } = await (supabase as any).rpc("submit_manual_bank_entry_atomic", {
      p_entry: {
        company_id: entry.companyId,
        transaction_date: entry.transactionDate,
        debit_amount: Number(entry.debitAmount || 0),
        credit_amount: Number(entry.creditAmount || 0),
        reference: entry.reference,
        description: entry.description,
        bank_name: entry.bankName || null,
        account_no: entry.accountNo || null,
        reason_code: entry.reasonCode,
        evidence_path: entry.evidencePath || null,
        notes: entry.notes || "",
        allocations: (entry.allocations || []).map((a) => ({
          payable_id: a.payable_id,
          payable_type: a.payable_type,
          amount: Number(a.amount),
          shareholder_name: a.shareholder_name,
          boid: a.boid,
        })),
      },
    });

    if (error) {
      throw new Error(error.message);
    }
    return {
      success: Boolean(data?.success),
      transactionId: data?.transaction_id,
      approvalId: data?.approval_id,
      status: data?.status || "pending_approval",
    };
  },

  async submitManualMatchRequest(request: {
    companyId: string;
    mode: "pair_payables" | "classify_non_payable";
    transactionIds: string[];
    reasonCode: ManualReasonCode;
    notes: string;
    evidencePath?: string | null;
    allocations?: ManualPayableAllocationInput[];
  }): Promise<{ success: boolean; approvalId: string; transactionCount: number }> {
    const { data, error } = await (supabase as any).rpc("submit_manual_match_request_atomic", {
      p_request: {
        company_id: request.companyId,
        mode: request.mode,
        transaction_ids: request.transactionIds,
        reason_code: request.reasonCode,
        notes: request.notes,
        evidence_path: request.evidencePath || null,
        allocations: (request.allocations || []).map((a) => ({
          payable_id: a.payable_id,
          payable_type: a.payable_type,
          amount: Number(a.amount),
          shareholder_name: a.shareholder_name,
          boid: a.boid,
        })),
      },
    });

    if (error) {
      throw new Error(error.message);
    }
    return {
      success: Boolean(data?.success),
      approvalId: data?.approval_id,
      transactionCount: Number(data?.transaction_count || request.transactionIds.length),
    };
  },

  async decideManualReconciliation(
    approvalId: string,
    decision: "Approved" | "Rejected",
    reviewNotes?: string,
  ): Promise<Record<string, any>> {
    const { data, error } = await (supabase as any).rpc("decide_manual_reconciliation_atomic", {
      p_approval_id: approvalId,
      p_decision: decision,
      p_review_notes: reviewNotes || null,
    });

    if (error) {
      throw new Error(error.message);
    }
    return (data || {}) as Record<string, any>;
  },

  async autoReconcileConnectIpsBatches(companyIds?: string[]): Promise<{
    batchesChecked: number;
    settledPayments: number;
    rejectedPayments: number;
    runsRecorded: number;
    message: string;
  }> {
    const { ConnectIPSService } = await import("./connectips.service");
    let query = (supabase as any)
      .from("payment_batches")
      .select("id, company_id, batch_name, cds_batch_ref, status, payment_method, total_amount")
      .in("status", ["Approved", "Processing", "Partially Paid", "Completed"])
      .order("created_at", { ascending: false })
      .limit(30);

    if (companyIds && companyIds.length === 1) {
      query = query.eq("company_id", companyIds[0]);
    } else if (companyIds && companyIds.length > 1) {
      query = query.in("company_id", companyIds);
    }

    const { data: batches, error: bErr } = await query;
    if (bErr) {
      throw new Error(
        `Failed to fetch active payment batches for ConnectIPS sync: ${bErr.message}`,
      );
    }

    const targetBatches = (batches || []).filter(
      (b: any) =>
        b.cds_batch_ref ||
        String(b.payment_method || "")
          .toLowerCase()
          .includes("connectips"),
    );

    if (targetBatches.length === 0) {
      return {
        batchesChecked: 0,
        settledPayments: 0,
        rejectedPayments: 0,
        runsRecorded: 0,
        message: "No active ConnectIPS batches found for the selected company scope.",
      };
    }

    let settledPayments = 0;
    let rejectedPayments = 0;
    let runsRecorded = 0;
    const syncedCompanyMap = new Map<string, any[]>();

    for (const batch of targetBatches) {
      if (batch.status !== "Completed") {
        try {
          const res = await ConnectIPSService.syncBatchTransactionStatuses(batch.id);
          settledPayments += res.settled || 0;
          rejectedPayments += (res.failed || 0) + (res.returned || 0);
        } catch (syncErr) {
          console.warn(`ConnectIPS batch sync warning for ${batch.batch_name}:`, syncErr);
        }
      }

      const { data: unlinkedPaid } = await (supabase as any)
        .from("payments")
        .select(
          "id, company_id, client_id, payable_type, payable_id, net_amount, paid_amount, payment_date, payment_reference, connectips_ref, status",
        )
        .eq("batch_id", batch.id)
        .in("status", ["Paid", "Completed"])
        .is("reconciliation_run_id", null);

      if (unlinkedPaid && unlinkedPaid.length > 0) {
        const compKey = batch.company_id || "global";
        if (!syncedCompanyMap.has(compKey)) syncedCompanyMap.set(compKey, []);
        unlinkedPaid.forEach((p: any) =>
          syncedCompanyMap
            .get(compKey)!
            .push({ ...p, batch_id: batch.id, batch_name: batch.batch_name }),
        );
      }
    }

    const { data: authData } = await supabase.auth.getUser();
    const actorId = authData?.user?.id || null;

    for (const [compKey, paymentRows] of syncedCompanyMap.entries()) {
      if (paymentRows.length === 0 || compKey === "global") continue;
      const totalAmount = paymentRows.reduce(
        (s: number, r: any) => s + Number(r.paid_amount ?? r.net_amount ?? 0),
        0,
      );
      const runHash = await computeSha256(
        `connectips_api|${compKey}|${new Date().toISOString()}|${paymentRows.map((p: any) => p.id).join(",")}`,
      );
      const { data: runRow, error: runErr } = await (supabase as any)
        .from("reconciliation_runs")
        .insert({
          company_id: compKey,
          source_type: "connectips_api",
          file_name: `ConnectIPS API Sync (${new Date().toISOString().slice(0, 10)})`,
          file_hash_sha256: runHash,
          row_count: paymentRows.length,
          total_amount: Number(totalAmount.toFixed(2)),
          matched_count: paymentRows.length,
          unmatched_count: 0,
          partial_count: 0,
          rejected_count: 0,
          parser_version: "3.0.0",
          matching_rule_version: "3.0.0",
          status: "applied",
          created_by: actorId,
          applied_by: actorId,
          applied_at: new Date().toISOString(),
          notes: "Automated ConnectIPS API settlement reconciliation",
        })
        .select("id")
        .single();

      if (runErr || !runRow?.id) continue;

      const resultsPayload = paymentRows.map((p: any) => ({
        run_id: runRow.id,
        reconciliation_date: p.payment_date || new Date().toISOString().slice(0, 10),
        source_reference: `${p.connectips_ref || p.payment_reference || "IPS"}::${p.id}`,
        source_a_type: "connectips_api",
        source_a_id: p.id,
        source_b_type: "payable",
        source_b_id: p.payable_id,
        client_id: p.client_id,
        company_id: p.company_id,
        payable_type: p.payable_type || "dividend",
        payable_id: p.payable_id,
        payment_id: p.id,
        batch_id: p.batch_id,
        expected_amount: Number(p.net_amount ?? 0),
        actual_amount: Number(p.paid_amount ?? p.net_amount ?? 0),
        difference: 0,
        result: "Matched",
        notes: `Auto-reconciled via ConnectIPS API (${p.batch_name || p.batch_id})`,
        match_method: "payment_reference",
        match_confidence: 100,
        candidate_count: 1,
        rule_version: "3.0.0",
        requires_manual_approval: false,
        matched_by: actorId,
        matched_at: new Date().toISOString(),
      }));

      await (supabase as any).from("reconciliation_results").insert(resultsPayload);
      await (supabase as any)
        .from("payments")
        .update({ reconciliation_run_id: runRow.id })
        .in(
          "id",
          paymentRows.map((p: any) => p.id),
        );

      runsRecorded += 1;
      settledPayments = Math.max(settledPayments, paymentRows.length);
    }

    return {
      batchesChecked: targetBatches.length,
      settledPayments,
      rejectedPayments,
      runsRecorded,
      message: `Checked ${targetBatches.length} ConnectIPS batch(es): ${runsRecorded} new audit run(s) recorded covering ${settledPayments} settled payout(s).`,
    };
  },

  async getBankReconciliationStatement(
    companyId: string,
    periodStart: string,
    periodEnd: string,
    bankClosingBalance?: number | null,
  ): Promise<BankReconciliationStatementSummary> {
    const { data, error } = await (supabase as any).rpc("get_bank_reconciliation_statement", {
      p_company_id: companyId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_bank_closing_balance:
        bankClosingBalance !== undefined &&
        bankClosingBalance !== null &&
        !Number.isNaN(bankClosingBalance)
          ? Number(bankClosingBalance)
          : null,
    });

    if (error) {
      throw new Error(`Failed to generate Bank Reconciliation Statement: ${error.message}`);
    }
    return data as BankReconciliationStatementSummary;
  },

  async lockReconciliationPeriod(lockInfo: {
    companyId: string;
    fiscalYear?: string;
    periodStart: string;
    periodEnd: string;
    bankClosingBalance?: number | null;
    makerId?: string;
    approvalNotes: string;
  }): Promise<{ success: boolean; lockId: string; brs: BankReconciliationStatementSummary }> {
    const { data, error } = await (supabase as any).rpc("lock_reconciliation_period_atomic", {
      p_lock_info: {
        company_id: lockInfo.companyId,
        fiscal_year: lockInfo.fiscalYear || null,
        period_start: lockInfo.periodStart,
        period_end: lockInfo.periodEnd,
        bank_closing_balance:
          lockInfo.bankClosingBalance !== undefined && lockInfo.bankClosingBalance !== null
            ? Number(lockInfo.bankClosingBalance)
            : null,
        maker_id: lockInfo.makerId || null,
        approval_notes: lockInfo.approvalNotes,
      },
    });

    if (error) {
      throw new Error(error.message);
    }
    return {
      success: Boolean(data?.success),
      lockId: data?.lock_id,
      brs: data?.brs,
    };
  },

  async getLockedReconciliationPeriods(
    companyId?: string | null,
  ): Promise<ReconciliationPeriodLockRow[]> {
    let query = (supabase as any)
      .from("reconciliation_period_locks")
      .select("*")
      .order("period_end", { ascending: false })
      .limit(50);

    if (companyId) {
      query = query.eq("company_id", companyId);
    }

    const { data, error } = await query;
    if (error) {
      console.warn("Failed to load period locks:", error.message);
      return [];
    }
    return (data || []) as ReconciliationPeriodLockRow[];
  },

  async reopenReconciliationPeriod(lockId: string, reopenReason: string): Promise<boolean> {
    if (!reopenReason || reopenReason.trim().length < 5) {
      throw new Error("A reason of at least 5 characters is required to reopen a locked period.");
    }
    const { data: authData } = await supabase.auth.getUser();
    const { error } = await (supabase as any)
      .from("reconciliation_period_locks")
      .update({
        status: "Reopened",
        reopened_by: authData?.user?.id || null,
        reopened_at: new Date().toISOString(),
        reopen_reason: reopenReason.trim(),
      })
      .eq("id", lockId);

    if (error) {
      throw new Error(`Failed to reopen period lock: ${error.message}`);
    }
    return true;
  },
};
