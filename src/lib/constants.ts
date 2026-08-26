/**
 * RTARTS System Constants
 */

// Reconciliation matching tolerance in NPR (e.g. 50 paisa)
export const RECONCILIATION_TOLERANCE_NPR = 0.50;

// Maximum number of items in a single Supabase query `.in('id', chunk)` to prevent URL length limits
export const BULK_CHUNK_SIZE = 200;

// Default pagination sizes
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_EXPORT_BROWSER_ROWS = 5000;

// Standard Lookup Cache Stale Times (5 minutes)
export const LOOKUP_STALE_TIME_MS = 5 * 60 * 1000;
