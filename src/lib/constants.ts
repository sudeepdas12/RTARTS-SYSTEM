/**
 * RTARTS System Constants
 */

// Reconciliation matching tolerance in NPR (e.g. 50 paisa)
export const RECONCILIATION_TOLERANCE_NPR = 0.5;
export const NET_PAYABLE_TOLERANCE_NPR = 0.5;

// Maximum number of items in a single Supabase query `.in('id', chunk)` to prevent URL length limits
export const BULK_CHUNK_SIZE = 200;

// Default pagination sizes
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_EXPORT_BROWSER_ROWS = 5000;

export const isExportTruncated = (totalRows: number): boolean =>
  typeof totalRows === "number" && totalRows > MAX_EXPORT_BROWSER_ROWS;

// Standard Lookup Cache Stale Times (5 minutes)
export const LOOKUP_STALE_TIME_MS = 5 * 60 * 1000;
