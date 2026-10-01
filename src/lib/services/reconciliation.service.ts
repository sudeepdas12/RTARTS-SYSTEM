import { supabase } from "./database";

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
  records: ReconciliationResultRow[];
}

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
      return (data || []) as ReconciliationResultRow[];
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

      // Cluster key by Date + Batch/File + Company + Payable Type
      const lotKey = `${dateStr}__${batchRef}__${companyName}__${payableType}`;
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
          records: [],
        });
      }

      const lot = map.get(lotKey)!;
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

    for (let i = 0; i < results.length; i += chunkSize) {
      const chunk = results.slice(i, i + chunkSize);
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
    if (!resultIds.length) {
      return { revertedPayables: 0, deletedPayments: 0, historyDeleted: false, success: true };
    }

    try {
      // 1. Primary: Use atomic SECURITY DEFINER database transaction
      const { data, error } = await (supabase as any).rpc("revert_reconciliation_lot_atomic", {
        p_result_ids: resultIds,
      });

      if (!error && data) {
        return {
          revertedPayables: Number(data.reverted_payables ?? 0),
          deletedPayments: Number(data.updated_payments ?? 0),
          historyDeleted: Number(data.deleted_results ?? 0) > 0,
          success: Boolean(data.success),
        };
      }
      if (error) {
        console.warn(
          "revert_reconciliation_lot_atomic RPC failed, trying fallback:",
          error.message,
        );
      }
    } catch (rpcErr: any) {
      console.warn(
        "revert_reconciliation_lot_atomic invocation error, falling back:",
        rpcErr?.message,
      );
    }

    let revertedPayables = 0;
    let deletedPayments = 0;

    try {
      const payableIdsByTable: Record<string, string[]> = {
        dividend_payables: [],
        interest_payables: [],
        mutual_fund_payables: [],
      };

      for (const r of lot.records) {
        if (r.payable_id) {
          const type = r.payable_type?.toLowerCase() || "interest";
          if (type === "dividend") payableIdsByTable.dividend_payables.push(r.payable_id);
          else if (type === "mutual_fund")
            payableIdsByTable.mutual_fund_payables.push(r.payable_id);
          else payableIdsByTable.interest_payables.push(r.payable_id);
        }
      }

      const allPayableIds = [
        ...payableIdsByTable.dividend_payables,
        ...payableIdsByTable.interest_payables,
        ...payableIdsByTable.mutual_fund_payables,
      ];

      // 1. Reset payables back to Pending
      for (const [table, ids] of Object.entries(payableIdsByTable)) {
        if (!ids.length) continue;
        const chunkSize = 100;
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
          const { error } = await (supabase as any)
            .from(table)
            .update({
              payment_status: "Pending",
              payment_date: null,
              payment_reference: null,
            })
            .in("id", chunk);

          if (!error) {
            revertedPayables += chunk.length;
          }
        }
      }

      // 2. Reset associated payment records
      if (allPayableIds.length > 0) {
        const chunkSize = 100;
        for (let i = 0; i < allPayableIds.length; i += chunkSize) {
          const chunk = allPayableIds.slice(i, i + chunkSize);
          const { data: pList } = await (supabase as any)
            .from("payments")
            .select("id")
            .in("payable_id", chunk);

          if (pList && pList.length > 0) {
            const pIds = pList.map((p: any) => p.id);
            // Only revert payments that are not already Completed/ExternallySettled
            const { error: pErr } = await (supabase as any)
              .from("payments")
              .update({
                status: "Pending",
                payment_date: null,
                paid_amount: 0,
                remarks: null,
                payment_reference: null,
              })
              .in("id", pIds)
              .neq("status", "Completed");

            if (!pErr) {
              deletedPayments += pIds.length;
            }
          }
        }
      }

      // 3. Delete reconciliation history records for this lot
      const historyDeleted = await this.deleteRecords(resultIds);

      return { revertedPayables, deletedPayments, historyDeleted, success: true };
    } catch (err: any) {
      console.error("Failed to revert lot:", err);
      return { revertedPayables, deletedPayments, historyDeleted: false, success: false };
    }
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
   * Revert an applied reconciliation batch or results:
   * - Reverts associated payables back to "Pending" (clears payment_date, payment_reference)
   * - Sets associated payments back to "Pending" or deletes auto-created payment batches
   */
  async revertReconciliation(
    batchIdOrDate?: string,
  ): Promise<{ revertedPayables: number; deletedPayments: number; success: boolean }> {
    let revertedPayables = 0;
    let deletedPayments = 0;

    try {
      // 1. Find all payables across dividend, interest, mutual fund with RECON references
      const payableTables = [
        "dividend_payables",
        "interest_payables",
        "mutual_fund_payables",
      ] as const;
      const revertedPayableIds: string[] = [];

      for (const table of payableTables) {
        let q = (supabase as any).from(table).select("id, payment_reference");
        if (batchIdOrDate) {
          q = q.ilike("payment_reference", `%${batchIdOrDate}%`);
        } else {
          q = q.ilike("payment_reference", "RECON-%");
        }

        const { data: rows, error: qErr } = await q;
        if (!qErr && rows && rows.length > 0) {
          const ids = rows.map((r: any) => r.id);
          const chunkSize = 100;
          for (let i = 0; i < ids.length; i += chunkSize) {
            const chunkIds = ids.slice(i, i + chunkSize);
            const { error: updErr } = await (supabase as any)
              .from(table)
              .update({
                payment_status: "Pending",
                payment_date: null,
                payment_reference: null,
              })
              .in("id", chunkIds);

            if (!updErr) {
              revertedPayables += chunkIds.length;
              revertedPayableIds.push(...chunkIds);
            }
          }
        }
      }

      // 2. Reset or delete associated payment records
      if (revertedPayableIds.length > 0) {
        // Chunk lookup in payments table
        const chunkSize = 200;
        for (let i = 0; i < revertedPayableIds.length; i += chunkSize) {
          const chunkIds = revertedPayableIds.slice(i, i + chunkSize);
          const { data: pList } = await (supabase as any)
            .from("payments")
            .select("id, batch_id, remarks, payment_reference")
            .in("payable_id", chunkIds);

          if (pList && pList.length > 0) {
            const pIds = pList.map((p: any) => p.id);
            const { error: pUpdErr } = await (supabase as any)
              .from("payments")
              .update({
                status: "Pending",
                payment_date: null,
                paid_amount: 0,
                remarks: null,
                payment_reference: null,
              })
              .in("id", pIds)
              .neq("status", "Completed");

            if (!pUpdErr) {
              deletedPayments += pIds.length;
            }
          }
        }
      }

      // 3. Delete any auto-created Reconciliation batches
      const { data: autoBatches } = await (supabase as any)
        .from("payment_batches")
        .select("id")
        .or("cds_batch_ref.eq.RECON-APPLY,batch_name.ilike.%Reconciliation Auto-Batch%");

      if (autoBatches && autoBatches.length > 0) {
        const autoBatchIds = autoBatches.map((b: any) => b.id);
        await (supabase as any).from("payments").delete().in("batch_id", autoBatchIds);
        await (supabase as any).from("payment_batches").delete().in("id", autoBatchIds);
      }

      return { revertedPayables, deletedPayments, success: true };
    } catch (err: any) {
      console.error("Revert reconciliation failed:", err);
      return { revertedPayables, deletedPayments, success: false };
    }
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
  ): Promise<{ updated: number; paymentsCreated: number; alreadyPaid: number; errors: string[] }> {
    const matchedResults = results.filter(
      (r) =>
        r.result === "Matched" ||
        r.result === "Over_Paid" ||
        r.result === "Under_Paid" ||
        r.result === "Partial",
    );
    if (!matchedResults.length) {
      return { updated: 0, paymentsCreated: 0, alreadyPaid: 0, errors: [] };
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
        payable_type: payableType,
        actual_amount: Number(r.actual_amount || r.expected_amount || 0),
        expected_amount: Number(r.expected_amount || r.actual_amount || 0),
        paid_amount: Number(r.actual_amount || r.expected_amount || 0),
        result: r.result,
        reconciliation_result: r.result,
        bank_name: (r as any).bank_name || r.client?.bank_name || null,
        bank_account_no: (r as any).bank_account_no || r.client?.bank_account_no || null,
        payment_reference: `RECON-${r.id ? String(r.id).slice(0, 8) : "AUTO"}`,
        connectips_ref: (r as any).connectips_ref || (r as any).instruction_id || null,
      });
    }

    // 5. Execute atomic RPC call per company and lot group
    let totalItemsProcessed = 0;
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

      const { data: rpcRes, error: rpcErr } = await (supabase as any).rpc(
        "apply_reconciliation_batch",
        {
          p_items: groupItems,
          p_batch_info: batchInfo,
        },
      );

      if (rpcErr) {
        throw new Error(`Atomic reconciliation batch failed: ${rpcErr.message}`);
      }

      if (!rpcRes || !rpcRes.success) {
        throw new Error(
          `Reconciliation transaction failed: ${rpcRes?.error || "Transaction rolled back"}`,
        );
      }

      updated += Number(rpcRes.payables_updated ?? rpcRes.updated ?? 0);
      paymentsCreated += Number(rpcRes.payments_created ?? rpcRes.paymentsCreated ?? 0);
      alreadyPaid += Number(rpcRes.already_paid ?? 0);
      if (Array.isArray(rpcRes.errors) && rpcRes.errors.length > 0) {
        for (const err of rpcRes.errors) {
          errors.push(err?.error || JSON.stringify(err));
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

    return { updated, paymentsCreated, alreadyPaid, errors };
  },
};
