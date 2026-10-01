/**
 * RTARTS System Constants
 */

/**
 * Reconciliation matching tolerance in NPR (50 paisa).
 * Used by ReconciliationEngine when matching external bank clearance statements
 * against internal payable ledgers. Accommodates commercial banking settlement
 * batch rounding and clearing house (ConnectIPS / NCHL) fractional variances.
 */
export const RECONCILIATION_TOLERANCE_NPR = 0.5;

/**
 * Ingestion Net Payable calculation tolerance in NPR (50 paisa).
 * Used during Excel multi-sheet data ingestion to detect significant discrepancy
 * between imported gross/tax and calculated net before flagging validation errors.
 */
export const NET_PAYABLE_TOLERANCE_NPR = 0.5;

/**
 * Database schema-level balance invariant tolerance in NPR (5 paisa).
 * Enforced by PostgreSQL check constraints (e.g. `chk_div_balance_invariant`):
 * `abs((gross_dividend - tax_amount) - net_payable) <= 0.05`.
 */
export const DATABASE_PAYABLE_BALANCE_TOLERANCE_NPR = 0.05;

// Maximum number of items in a single Supabase query `.in('id', chunk)` to prevent URL length limits
export const BULK_CHUNK_SIZE = 200;

// Default pagination sizes
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_EXPORT_BROWSER_ROWS = 5000;

export const isExportTruncated = (totalRows: number): boolean =>
  typeof totalRows === "number" && totalRows > MAX_EXPORT_BROWSER_ROWS;

// Standard Lookup Cache Stale Times (5 minutes)
export const LOOKUP_STALE_TIME_MS = 5 * 60 * 1000;
