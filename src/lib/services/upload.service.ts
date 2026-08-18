import { supabase, throwIfError } from "./database";
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
            ? Math.max(Number(row.success_rows || 0), linkedRows)
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

  async createUploadRecord(upload: Record<string, any>): Promise<UploadHistoryRow> {
    try {
      const { data, error } = await (supabase as any)
        .from("upload_history")
        .insert(upload)
        .select()
        .single();
      if (error) {
        throw error;
      }
      return data as UploadHistoryRow;
    } catch (error: any) {
      console.warn(
        "Upload history record unavailable, returning fallback object:",
        error?.message || error,
      );
      return {
        id: upload.id || crypto.randomUUID(),
        file_name: upload.file_name || "unknown",
        file_size: upload.file_size || 0,
        file_hash: upload.file_hash || null,
        file_type: upload.file_type || null,
        sheet_name: upload.sheet_name || null,
        total_rows: upload.total_rows || 0,
        success_rows: 0,
        error_rows: 0,
        target_table: upload.target_table || null,
        status: upload.status || "Processing",
        started_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      } as UploadHistoryRow;
    }
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

  async rollbackUpload(uploadId: string, targetTable: string): Promise<void> {
    // 1. Try direct delete via Supabase client
    const { error: deleteError, count: deletedCount } = await (supabase as any)
      .from(targetTable)
      .delete({ count: "exact" })
      .eq("upload_id", uploadId);

    // 2. If direct delete failed or deleted 0 rows, try the bulk_delete RPC (bypasses RLS)
    if (deleteError || !deletedCount) {
      console.warn("Direct delete failed or 0 rows, trying bulk_delete RPC:", deleteError?.message);
      try {
        // IMPORTANT: Pass the filters array directly (NOT JSON.stringify'd).
        // PostgREST serializes the array to a JSONB scalar, and the RPC's
        // jsonb_array_elements() fails with "cannot extract elements from a scalar"
        // when given a stringified JSON string.
        const { data: rpcResult, error: rpcError } = await (supabase as any).rpc("bulk_delete", {
          p_table: targetTable,
          p_filters: [{ field: "upload_id", value: uploadId }],
        });
        if (rpcError) {
          console.warn("bulk_delete RPC also failed:", rpcError.message);
        } else if (rpcResult?.success) {
          console.log("bulk_delete RPC deleted", rpcResult.deleted, "rows");
        }
      } catch (rpcErr: any) {
        console.warn("bulk_delete RPC exception:", rpcErr?.message);
      }
    }

    // 3. Mark upload as rolled back regardless
    const { error: statusError } = await (supabase as any)
      .from("upload_history")
      .update({ status: "RolledBack", completed_at: new Date().toISOString() })
      .eq("id", uploadId);

    throwIfError(statusError, "Failed to update upload status to RolledBack");
    if (deleteError) console.warn("Could not delete rows from target table:", deleteError.message);

    // 4. Cleanup any orphan clients that were created during this upload but no longer have any payables
    try {
      await (supabase as any).rpc("delete_orphan_clients");
    } catch (orphanErr: any) {
      console.warn("Could not clean up orphan clients:", orphanErr?.message);
    }
  },
};
