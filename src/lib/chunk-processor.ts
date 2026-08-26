import { ImportService } from './services/import.service';
import { UploadService } from './services/upload.service';
import { supabase } from '@/integrations/supabase/client';

export interface ChunkProgress {
  totalRows: number;
  processedRows: number;
  successRows: number;
  errorRows: number;
  status: 'Processing' | 'Completed' | 'Failed';
}

export interface ChunkOptions {
  fiscalYear?: string;
  dividendRate?: number;
  tdsRate?: number;  // Explicit TDS rate override (e.g. 0.15 for Institutions)
  dividendType?: 'Cash' | 'Stock' | 'Bonus' | 'Right';
  companyId?: string;  // Direct company UUID — bypasses name-based lookup entirely
  companyName?: string;  // Detected company name from file
  companyIsin?: string;  // Detected ISIN from file
  fileHash?: string;
  sheetType?: string;  // Sheet name/type for fallback investor categorization
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  sheetName?: string;
  totalRows?: number;
  userId?: string;
  isPreCalculated?: boolean;
  isRawInputFile?: boolean;
}

/** JSON-safe copy of raw row data for the upload_errors.raw_data (JSONB) column. */
function toSafeJson(value: any): any {
  if (value === null || value === undefined) return null;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : JSON.parse(serialized);
  } catch {
    try {
      return String(value);
    } catch {
      return null;
    }
  }
}

/**
 * Persist per-row error records to the upload_errors table.
 * Guarantees failed rows are NEVER silently dropped: each failed record is kept
 * with its reason and original raw data so it can be reviewed / exported /
 * corrected and re-uploaded from Upload History.
 */
async function persistErrorRows(
  uploadId: string,
  rows: {
    row_number?: number;
    field_name?: string;
    error_type?: string;
    error_message?: string;
    raw_data?: any;
  }[],
): Promise<void> {
  if (!Array.isArray(rows) || rows.length === 0) return;

  const errorRows = rows.map((e) => ({
    upload_id: uploadId,
    row_number: Number(e?.row_number) > 0 ? Number(e.row_number) : 0,
    field_name: e?.field_name ?? null,
    error_type: e?.error_type ?? "system",
    error_message: e?.error_message ?? "Unknown error",
    raw_data: toSafeJson(e?.raw_data),
  }));

  try {
    const { error: logErr } = await (supabase as any).from("upload_errors").insert(errorRows);
    if (logErr) console.warn("Failed to log upload errors:", logErr.message);
  } catch (logEx) {
    console.warn("Failed to log upload errors:", logEx);
  }
}

export const ChunkProcessor = {
  async processInChunks(
    uploadId: string,
    rows: any[],
    targetTable: string,
    chunkSize = 1000,
    onProgress?: (progress: ChunkProgress) => void,
    options?: ChunkOptions
  ): Promise<ChunkProgress> {
    let processed = 0;
    let success = 0;
    let errors = 0;
    const effectiveChunkSize = Math.max(250, chunkSize || 1000);
    const sharedContext = {
      companyId: options?.companyId || '',  // Use direct ID if provided (bypasses name lookup)
      clientIdCache: new Map<string, string>(),
    };

    const totalChunks = Math.ceil(rows.length / effectiveChunkSize);

    const errorMessages: string[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const chunk = rows.slice(i * effectiveChunkSize, (i + 1) * effectiveChunkSize);
      let rowErrorCount = 0;

      try {
        const result = await ImportService.processChunk(uploadId, chunk, targetTable, options, sharedContext);
        // Use explicit inserted/processed counts from the processor (edge/RPC/fallback).
        // Default to 0 rather than assuming the entire chunk succeeded.
        const chunkSuccess = Number(result?.rowsProcessed ?? result?.inserted ?? 0);
        // Count errors ONLY from the per-row error list returned by the processor.
        // Footer/total rows are silently filtered out by the processor and should NOT
        // be counted as errors. A chunk that was entirely footer rows returns
        // rowsProcessed: 0 with no errors — that's a successful skip, not a failure.
        rowErrorCount = Array.isArray(result?.errors) ? result.errors.length : 0;
        const chunkErrors = rowErrorCount > 0 ? rowErrorCount : 0;
        success += chunkSuccess;
        errors += chunkErrors;

        // If processor returned a top-level error or reported failure, capture message
        if (result && result.success === false) {
          const msg = result.error || JSON.stringify(result);
          errorMessages.push(String(msg));
        }

        // Persist every per-row error returned by the processor (edge/RPC/fallback)
        // to the upload_errors table so failed records can be reviewed / exported.
        await persistErrorRows(uploadId, (result?.errors as any[] | undefined) ?? []);

        // Only throw if the processor explicitly reported failure or returned row errors.
        // A chunk that was entirely footer/summary rows (rowsProcessed: 0, no errors)
        // is a successful skip, not a failure.
        if (chunk.length > 0 && chunkSuccess === 0 && !result?.duplicate && rowErrorCount > 0) {
          throw new Error('No rows were inserted for this chunk.');
        }
      } catch (err: any) {
        console.error(`Chunk ${i} failed`, err);
        try { errorMessages.push(err?.message ?? String(err)); } catch {}
        // If the underlying processor already reported row-level validation errors,
        // do not add the entire chunk length again. That would double-count errors.
        if (rowErrorCount === 0) {
          // The processor threw for the WHOLE chunk (e.g. a DB/RPC failure with no
          // per-row detail). Count every row as failed AND persist an audit-trail
          // record per row so the operator can see exactly which records failed and
          // why. Without this, the upload history reports errors but upload_errors
          // stays empty -> "No error records found for this upload."
          const chunkErrorRows = chunk.map((row, idx) => ({
            row_number: i * effectiveChunkSize + idx + 1,
            field_name: 'chunk',
            error_type: 'chunk_error',
            error_message: `Chunk failed: ${err?.message ?? String(err)}`,
            raw_data: row,
          }));
          await persistErrorRows(uploadId, chunkErrorRows);
          errors += chunk.length;
        }
      }

      processed += chunk.length;
      
      if (onProgress) {
        onProgress({
          totalRows: rows.length,
          processedRows: processed,
          successRows: success,
          errorRows: errors,
          status: processed === rows.length ? (success === 0 && errors > 0 ? 'Failed' : 'Completed') : 'Processing'
        });
      }
    }

    // Final update — non-fatal if upload_history table doesn't exist yet
    try {
      const updates: Record<string, any> = {
        success_rows: success,
        error_rows: errors,
      };
      if (errorMessages.length > 0) updates.error_message = errorMessages.slice(0, 5).join(' ; ');
      // Mark as Completed even if some rows had errors — partial imports are still successful.
      // Only mark as Failed if ALL rows failed (success === 0 && errors > 0).
      const finalStatus = success === 0 && errors > 0 ? 'Failed' : 'Completed';
      await UploadService.updateUploadStatus(uploadId, finalStatus, updates);
    } catch (err) {
      console.warn('Could not update upload_history status (table may not exist yet):', err);
    }

    return {
      totalRows: rows.length,
      processedRows: processed,
      successRows: success,
      errorRows: errors,
      status: success === 0 && errors > 0 ? 'Failed' : 'Completed',
    };
  }
};
