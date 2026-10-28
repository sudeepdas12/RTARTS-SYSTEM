import { supabase, throwIfError } from "./database";
import { deleteInBatches } from "./data-management.service";
import * as XLSX from "xlsx";
import { toast } from "sonner";

/** Inline type definition for upload_history — the generated Supabase types don't include the new phase-1 tables yet. */
interface UploadHistoryRow {
  id: string;
  user_id?: string | null;
  file_name: string;
  file_size: number;
  file_hash?: string | null;
  file_type?: string | null;
  sheet_name?: string | null;
  total_rows: number;
  success_rows: number;
  error_rows: number;
  target_table?: string | null;
  status: string;
  error_message?: string | null;
  started_at: string;
  completed_at?: string | null;
  created_at: string;
}

const PAYABLE_TABLES = ["dividend_payables", "interest_payables", "mutual_fund_payables"] as const;

export interface UploadErrorRow {
  row_number: number;
  field_name?: string | null;
  error_type?: string | null;
  error_message?: string | null;
  raw_data?: Record<string, unknown> | null;
  created_at?: string | null;
}

async function countRowsByUploadId(uploadId: string, targetTable?: string | null): Promise<number> {
  const tables =
    targetTable && PAYABLE_TABLES.includes(targetTable as any) ? [targetTable] : PAYABLE_TABLES;

  let total = 0;
  for (const table of tables) {
    const { count, error } = await (supabase as any)
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("upload_id", uploadId);

    if (error) {
      console.warn(`Could not count rows for ${table}:`, error.message);
      continue;
    }

    total += Number(count || 0);
  }

  return total;
}

async function reconcileStaleProcessingUploads(rows: UploadHistoryRow[]): Promise<void> {
  const staleCutoffMs = 15 * 60 * 1000;
  const now = Date.now();

  const staleRows = rows.filter((row) => {
    if (row.status !== "Processing") return false;
    const startedMs = new Date(row.started_at || row.created_at).getTime();
    if (Number.isNaN(startedMs)) return false;
    return now - startedMs > staleCutoffMs;
  });

  for (const row of staleRows) {
    const linkedRows = await countRowsByUploadId(row.id, row.target_table || null);
    const nextStatus = linkedRows > 0 ? "Completed" : "Failed";
    const nextError =
      linkedRows > 0
        ? row.error_message || null
        : row.error_message || "Upload was left in Processing state and was auto-finalized.";

    const { error } = await (supabase as any)
      .from("upload_history")
      .update({
        status: nextStatus,
        success_rows:
          linkedRows > 0
            ? Math.max(0, linkedRows - Number(row.error_rows || 0))
            : Number(row.success_rows || 0),
        error_message: nextError,
        completed_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (error) {
      console.warn(`Could not auto-finalize stale upload ${row.id}:`, error.message);
    }
  }
}

export const UploadService = {
  async getUploadHistory(limit = 50): Promise<UploadHistoryRow[]> {
    const { data, error } = await (supabase as any)
      .from("upload_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    throwIfError(error, "Failed to fetch upload history");
    const rows = (data || []) as UploadHistoryRow[];

    // Self-heal stale rows that stayed in Processing after client/network interruptions.
    try {
      await reconcileStaleProcessingUploads(rows);
    } catch (reconcileErr: any) {
      console.warn("Upload history reconciliation skipped:", reconcileErr?.message || reconcileErr);
    }

    const { data: refreshed, error: refreshedError } = await (supabase as any)
      .from("upload_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    throwIfError(refreshedError, "Failed to refresh upload history");
    return (refreshed || rows) as UploadHistoryRow[];
  },

  async getUploadHistoryPaginated(
    page = 1,
    pageSize = 50,
    options?: {
      targetTable?: string;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ): Promise<{
    data: UploadHistoryRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = (supabase as any)
      .from("upload_history")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    if (options?.targetTable && options.targetTable !== "all") {
      query = query.eq("target_table", options.targetTable);
    }
    if (options?.status && options.status !== "all") {
      query = query.eq("status", options.status);
    }
    if (options?.dateFrom) {
      query = query.gte("created_at", `${options.dateFrom}T00:00:00.000Z`);
    }
    if (options?.dateTo) {
      query = query.lte("created_at", `${options.dateTo}T23:59:59.999Z`);
    }

    query = query.range(from, to);

    const { data, count, error } = await query;
    throwIfError(error, "Failed to fetch paginated upload history");

    const total = count || 0;
    return {
      data: (data || []) as UploadHistoryRow[],
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  },

  async findActiveUploadByHash(
    fileHash: string,
    targetTable?: string,
  ): Promise<UploadHistoryRow | null> {
    try {
      let q = (supabase as any)
        .from("upload_history")
        .select("*")
        .in("status", ["Completed", "Processing"]);

      if (targetTable) {
        q = q.eq("target_table", targetTable);
      }
      q = q.or(`file_hash.eq.${fileHash},file_hash.ilike.${fileHash}-%`);

      const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!data) return null;

      // Self-healing check: verify if this record actually has active payables.
      // If the user deleted the payables or company data previously, this upload is orphaned.
      const linkedRows = await countRowsByUploadId(data.id, data.target_table || null);
      if (linkedRows === 0) {
        // Auto-heal by marking as RolledBack so the file is unblocked
        await (supabase as any)
          .from("upload_history")
          .update({
            status: "RolledBack",
            completed_at: new Date().toISOString(),
            error_message: "Auto-cleared: Underlying payable records were removed.",
          })
          .eq("id", data.id);
        return null;
      }

      return data as UploadHistoryRow;
    } catch {
      return null;
    }
  },

  async createUploadRecord(upload: Record<string, any>): Promise<UploadHistoryRow> {
    const { data, error } = await (supabase as any)
      .from("upload_history")
      .insert(upload)
      .select()
      .single();
    if (error) {
      if (error.code === "23505" || error.message?.includes("uq_upload_history_active_file_hash")) {
        // Check if the conflicting active upload is actually orphaned (all its payables were deleted)
        if (upload.file_hash) {
          const conflicting = await this.findActiveUploadByHash(
            upload.file_hash,
            upload.target_table,
          );
          if (!conflicting) {
            // Self-healing succeeded: the orphaned record was cleared, retry the insert once!
            const retry = await (supabase as any)
              .from("upload_history")
              .insert(upload)
              .select()
              .single();
            if (!retry.error && retry.data) {
              return retry.data as UploadHistoryRow;
            }
          }
        }
        throw new Error(
          `This file has already been uploaded and is active in the system. To re-upload it, please go to "Upload History" and roll back or delete the previous upload first.`,
        );
      }
      console.error("Failed to create upload_history record:", error.message);
      throw new Error(error.message || "Failed to create upload record");
    }
    return data as UploadHistoryRow;
  },

  async updateUploadStatus(
    id: string,
    status: "Processing" | "Completed" | "Failed" | "RolledBack",
    updates?: Record<string, any>,
  ): Promise<UploadHistoryRow> {
    const { data, error } = await (supabase as any)
      .from("upload_history")
      .update({
        status,
        ...updates,
        completed_at: status !== "Processing" ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) {
      throw error;
    }

    if (status === "Completed" || status === "RolledBack") {
      (supabase as any).rpc("refresh_company_client_map").catch((e: any) => {
        console.warn("Background refresh_company_client_map error:", e?.message);
      });
    }

    return data as UploadHistoryRow;
  },

  async logUploadErrors(errors: Record<string, any>[]): Promise<void> {
    if (!errors.length) return;
    try {
      const { error } = await (supabase as any).from("upload_errors").insert(errors);
      if (error) console.warn("Failed to log upload errors (table may not exist):", error.message);
    } catch (err: any) {
      console.warn("Failed to log upload errors:", err?.message || err);
    }
  },

  async getUploadErrors(uploadId: string, limit = 10000): Promise<UploadErrorRow[]> {
    try {
      const { data, error } = await (supabase as any)
        .from("upload_errors")
        .select("row_number, field_name, error_type, error_message, raw_data, created_at")
        .eq("upload_id", uploadId)
        .order("row_number", { ascending: true })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to fetch error records: ${error.message}`);
      }

      return (data || []) as UploadErrorRow[];
    } catch (err: any) {
      console.error("Failed to fetch upload errors:", err);
      throw new Error(err?.message || "Failed to fetch upload error records.");
    }
  },

  async downloadUploadErrors(uploadId: string, fileName: string = "upload"): Promise<void> {
    try {
      const { data, error } = await (supabase as any)
        .from("upload_errors")
        .select("row_number, field_name, error_type, error_message, raw_data")
        .eq("upload_id", uploadId)
        .order("row_number", { ascending: true });

      if (error) {
        toast.error(`Could not retrieve error records: ${error.message}`);
        return;
      }

      const errors = data || [];
      if (errors.length === 0) {
        toast.error(
          "No persisted per-row error records exist for this upload. If errors were reported, they occurred at the chunk/database level — check the upload's error message, or re-upload the file after fixing it.",
        );
        return;
      }

      const safeName = fileName.replace(/[^a-zA-Z0-9-_]/g, "_").replace(/\.[^.]+$/, "") || "upload";
      const rows = errors.map((e: any) => ({
        Row: e.row_number ?? "",
        Field: e.field_name ?? "",
        Type: e.error_type ?? "",
        Message: e.error_message ?? "",
        Raw_Data: e.raw_data ? JSON.stringify(e.raw_data) : "",
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = [{ wch: 8 }, { wch: 20 }, { wch: 20 }, { wch: 60 }, { wch: 60 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Errors");
      XLSX.writeFile(wb, `${safeName}-errors.xlsx`);
      toast.success(`Exported ${errors.length.toLocaleString()} error record(s).`);
    } catch (err) {
      console.error("Failed to download upload errors:", err);
    }
  },

  async rollbackUpload(
    uploadId: string,
    targetTable?: string,
  ): Promise<{
    success: boolean;
    payablesDeleted: number;
    clientsDeleted: number;
    errorsDeleted: number;
  }> {
    // 1. Preferred approach: Atomic PostgreSQL transaction
    try {
      const { data, error } = await (supabase as any).rpc("rollback_upload_atomic", {
        p_upload_id: uploadId,
      });

      if (!error && data && typeof data === "object") {
        return {
          success: Boolean(data.success),
          payablesDeleted: Number(data.payables_deleted || 0),
          clientsDeleted: Number(data.clients_deleted || 0),
          errorsDeleted: Number(data.errors_deleted || 0),
        };
      }

      if (error) {
        console.warn(
          "rollback_upload_atomic RPC returned error, using direct fallback:",
          error.message,
        );
      }
    } catch (rpcErr: any) {
      console.warn("Could not invoke rollback_upload_atomic RPC:", rpcErr?.message);
    }

    // 2. Direct fallback: Delete by upload_id directly (not chunked in query params)
    let fileHash: string | null = null;
    let actualTable = targetTable;
    try {
      const { data: rec } = await (supabase as any)
        .from("upload_history")
        .select("id, file_hash, target_table")
        .eq("id", uploadId)
        .maybeSingle();
      if (rec) {
        fileHash = rec.file_hash || null;
        if (!actualTable && rec.target_table) {
          actualTable = rec.target_table;
        }
      }
    } catch (fetchErr) {
      console.warn("Could not fetch upload record before rollback:", fetchErr);
    }

    // Delete rows from target table(s) directly
    const tablesToClean = actualTable
      ? [actualTable]
      : ["interest_payables", "dividend_payables", "mutual_fund_payables"];

    let totalPayablesDeleted = 0;
    for (const table of tablesToClean) {
      try {
        const { count, error } = await (supabase as any)
          .from(table)
          .delete({ count: "exact" })
          .eq("upload_id", uploadId);
        if (error) {
          throw error;
        }
        totalPayablesDeleted += Number(count || 0);
      } catch (err: any) {
        console.error(`Failed to delete from ${table}:`, err?.message);
        throw new Error(`Failed to delete records from ${table}: ${err?.message}`);
      }
    }

    // Delete errors logged for this upload
    try {
      await (supabase as any).from("upload_errors").delete().eq("upload_id", uploadId);
    } catch {
      // non-blocking
    }

    // Mark upload record as RolledBack
    const { error: statusError } = await (supabase as any)
      .from("upload_history")
      .update({ status: "RolledBack", completed_at: new Date().toISOString() })
      .eq("id", uploadId);

    throwIfError(statusError, "Failed to update upload status to RolledBack");

    // Clear active file_hash so file can be re-uploaded cleanly
    if (fileHash) {
      try {
        await (supabase as any)
          .from("upload_history")
          .update({ status: "RolledBack", completed_at: new Date().toISOString() })
          .eq("file_hash", fileHash)
          .neq("status", "RolledBack");
      } catch (hashErr) {
        console.warn("Could not update duplicate file_hash upload records:", hashErr);
      }
    }

    // Cleanup orphan clients
    let clientsDeleted = 0;
    try {
      const { data: orphanRes } = await (supabase as any).rpc("delete_orphan_clients");
      clientsDeleted = Number(orphanRes?.deleted || 0);
    } catch (orphanErr: any) {
      console.warn("Could not clean up orphan clients:", orphanErr?.message);
    }

    return {
      success: true,
      payablesDeleted: totalPayablesDeleted,
      clientsDeleted,
      errorsDeleted: 0,
    };
  },

  /**
   * Rolls back all sheets belonging to an entire imported workbook file.
   */
  async rollbackEntireFile(params: {
    fileName?: string;
    fileHash?: string;
  }): Promise<{ success: boolean; sheetsRolledBack: number; payablesDeleted: number }> {
    const { data, error } = await (supabase as any).rpc("rollback_upload_file_atomic", {
      p_file_name: params.fileName || null,
      p_file_hash: params.fileHash || null,
    });

    if (error) {
      throw new Error(`Failed to rollback file: ${error.message}`);
    }

    return {
      success: Boolean(data?.success),
      sheetsRolledBack: Number(data?.sheets_rolled_back || 0),
      payablesDeleted: Number(data?.payables_deleted ?? data?.total_payables_deleted ?? 0),
    };
  },
};
