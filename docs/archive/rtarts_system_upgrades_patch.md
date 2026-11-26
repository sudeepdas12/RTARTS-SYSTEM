# RTARTS System Upgrades Patch Guide

This document records the architectural and logic patches applied to the **RTARTS-SYSTEM** core engine and database migration layer.

---

## 1. Database Migration: `20261015000000_error_free_pipeline_hardening.sql`

- **Location**: `supabase/migrations/20261015000000_error_free_pipeline_hardening.sql`
- **Capabilities**:
  1. **Manual & Imported Tax Preservation**:
     - Added `is_tax_manual` (`BOOLEAN DEFAULT false`), `tax_rate` (`NUMERIC(5,4)`), and `paid_amount` (`NUMERIC(15,2) DEFAULT 0.00`) to `dividend_payables`, `interest_payables`, and `mutual_fund_payables`.
     - Replaced calculation triggers with `calc_dividend_payable_safe()` and `calc_interest_payable_safe()` so imported tax rates and manual operator overrides are never overwritten.
  2. **Elimination of Stuck "Processing" Uploads**:
     - `increment_upload_progress_atomic()`: Server-side atomic progress increment that transitions `upload_history.status` to `Completed` or `Completed with Errors` once all rows finish.
  3. **Batch Dispatch Separation**:
     - `mark_payment_batch_dispatched_atomic()`: Transitions payment batches and payments to `Dispatched` without marking payables `Paid` until settlement is confirmed.
  4. **Bank Statement Locking & Settlement**:
     - `commit_reconciliation_matches_atomic()`: Uses `FOR UPDATE SKIP LOCKED` on `bank_transactions` and enforces `paid_amount <= net_payable` in exact 2-decimal NUMERIC precision.

---

## 2. TypeScript Module Upgrades

### `src/lib/currency.ts`

- Added `toPaisa(amount: number): number`: converts rupee amounts to integer paisa using `Number.EPSILON` half-up rounding.
- Added `fromPaisa(paisa: number): number`: converts integer paisa back to decimal rupee amounts.
- Added `roundToPaisa(amount: number): number`: matches PostgreSQL `ROUND(val::numeric, 2)`.
- Added `sumInPaisa(amounts: number[]): number`: sums arrays of values in integer paisa to eliminate floating-point drift.

### `src/lib/interest-calculator.ts`

- Standardized rounding on `roundToPaisa` from `./currency`.
- Applied exact paisa rounding on `grossPeriodInterest`, `taxAmount`, and `netInterestPayable`.

### `src/lib/excel-parser.ts`

- Removed account aliases (`BENEFICIARY ACC NO`, `ACCOUNT_NO`) from `boid` column mapping to prevent mapping bank accounts to shareholder BOIDs.
- Added CDSC 16-digit `130...` BOID sample pattern validation to disambiguate BOID columns.
- Returned `null` for blank/empty tax cells to ensure they are not coerced to `0%` tax overrides.

### `src/lib/chunk-processor.ts`

- Default chunk size configured to 250 rows for optimal transaction batching.
- Added `normalizeFiscalYear()` ("2081/2082" -> "2081/82").
- Added server-side atomic progress increments via `increment_upload_progress_atomic`.
- Added TanStack Query cache invalidations upon upload completion for instant UI visibility.

### `src/lib/payment-generator.ts`

- Added `validateConnectIPS()` to verify and block records missing valid 16-digit CDSC BOIDs before file generation.

### `src/lib/bank-parser.ts`

- Updated CSV tokenizer in `parseCsvRow()` to properly unescape RFC 4180 double-quote pairs (`""`) inside quoted bank narrations.

### `src/lib/reconciliation-engine.ts`

- Standardized amount equality checks on `amountEqualsPaisa()` and difference computation on `fromPaisa(toPaisa(system) - toPaisa(amount))` to eliminate floating-point inaccuracies.
