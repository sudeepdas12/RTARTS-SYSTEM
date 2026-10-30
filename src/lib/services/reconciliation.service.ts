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
  status: "draft" | "review" | "approved" | "applied" | "reverted" | "failed";
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

  async saveResults(results: Record<string, any>[]): Promise<{ savedCount: number }> {
    if (!results.length) return { savedCount: 0 };
    const chunkSize = 200;
    let savedCount = 0;

    // Lot/file deduplication: if notes have [File: ...], remove previous identical lot logs to prevent accumulation across sessions
    const firstNote = results[0]?.notes || "";
    const fileMatch = firstNote.match(/\[File:\s*([^\]|]+)/i);
    if (fileMatch && fileMatch[1]) {
      const fileName = fileMatch[1].trim();
      await (supabase as any)
        .from("reconciliation_results")
        .delete()
        .ilike("notes", `%[File: ${fileName}%`);
    }

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
        return sanitized;
      });
      const { error } = await (supabase as any).from("reconciliation_results").insert(chunk);
      if (error) {
        console.error("Failed to save reconciliation results chunk:", error.message);
        throw new Error(`Failed to save reconciliation results: ${error.message}`);
      }
      savedCount += chunk.length;
    }
    return { savedCount };
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
    runId?: string;
    errors: string[];
  }> {
    const matchedResults = results.filter(
      (r) =>
        r.result === "Matched" ||
        r.result === "Over_Paid" ||
        r.result === "Under_Paid" ||
        r.result === "Partial",
    );
    if (!matchedResults.length) {
      return {
        updated: 0,
        paymentsCreated: 0,
        alreadyPaid: 0,
        resultsInserted: 0,
        exceptionsCreated: 0,
        errors: [],
      };
    }

    let updated = 0;
    let paymentsCreated = 0;
    let alreadyPaid = 0;
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

    const batchMatches = matchedResults.filter(isBatchRecord);
    const individualMatches = matchedResults.filter((r) => !isBatchRecord(r));

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
        .eq("id", batchId);

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
      });
    }

    // 5. Execute atomic RPC call per company and lot group
    let totalItemsProcessed = 0;
    let activeRunId: string | null = null;
    let resultsInserted = 0;
    let exceptionsCreated = 0;

    for (const [groupKey, groupItems] of itemsPayloadByCompany.entries()) {
      if (groupItems.length === 0) continue;
      totalItemsProcessed += groupItems.length;

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

        let rpcRes: any = null;

        // Call unified atomic apply + persist RPC (fails closed, no insecure legacy fallback)
        const { data: unifiedData, error: unifiedErr } = await (supabase as any).rpc(
          "apply_and_record_reconciliation_batch",
          {
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
          },
        );

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

        rpcRes = unifiedData;
        if (rpcRes.run_id && !activeRunId) {
          activeRunId = rpcRes.run_id;
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
        if (Array.isArray(rpcRes.errors) && rpcRes.errors.length > 0) {
          for (const err of rpcRes.errors) {
            errors.push(err?.error || JSON.stringify(err));
          }
        }
      }
    }

    if (
      updated === 0 &&
      paymentsCreated === 0 &&
      alreadyPaid === 0 &&
      totalItemsProcessed === 0 &&
      batchesUpdated === 0 &&
      batchesAlreadyCompleted === 0
    ) {
      return { updated: 0, paymentsCreated: 0, alreadyPaid: 0, errors };
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
      runId: activeRunId ?? undefined,
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
  ): Promise<{ importId: string; fileHash: string; insertedCount: number; isDuplicate?: boolean }> {
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

    // 2. Create bank_statement_imports record
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
};
