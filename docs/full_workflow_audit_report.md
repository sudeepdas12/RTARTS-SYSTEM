# RTARTS System — Comprehensive Workflow & Authorization Audit Report

**Scope:** End-to-end audit of all user-facing screens (22 authenticated routes + public shell), data lifecycle, import calculation parity, payable-to-payment workflows, bank reconciliation, multi-tenant isolation, and role-based access control (RBAC).

**Audit Date:** 2026-10-01  
**Environment:** Local Isolated Sandbox (`http://127.0.0.1:54321`, Docker Supabase CLI v2.115.0)  
**Baseline Git Commit:** `150c424` (`origin/main`)  
**Test Suite Status:** 33 / 33 test files passed (275 / 275 tests), TypeScript `tsc --noEmit` clean, ESLint clean, Production Vite+Nitro build successful.

---

## 1. Executive Summary

A comprehensive, non-destructive audit of the RTARTS (RBB Merchant Banking — RTS/RTARTS) platform was conducted across all 24 route modules, the dual import engines (Deno Edge Function vs. Browser chunk processor), the database trigger layer, and the financial settlement workflows.

### Overall System Assessment: **LOCAL HARDENED (NOT YET PRODUCTION-READY)**

> [!WARNING]
> While local unit, integration, and database schema checks pass cleanly, **production readiness sign-off is withheld** until live cloud deployment of the Supabase Edge Function is verified and production network invariants are confirmed. Local Docker returns 503 for the edge runtime container, meaning live Edge execution was verified via fallback only.

- **Core Financial Integrity:** Math invariants ($Gross - Tax = Net$) are strictly enforced across debentures, equity dividends, and mutual funds within a statutory $\pm0.50$ NPR tolerance for banking settlement and $\pm0.05$ NPR for database check constraints (`chk_div_balance_invariant`).
- **Tenancy & Isolation:** Company scoping (`company_id`) and Row-Level Security (`has_company_access`) prevent cross-company leakage when investors hold shares across multiple client institutions with the same 16-digit BOID.
- **Import Parity:** Fallback and Edge imports both support dynamic `faceValue`, `daysCount`, and `dayCountConvention`. However, live cloud Deno Edge function parity must be validated post-deployment.
- **Atomic Operations:** Payment batch completion (`complete_payment_batch_atomic`), upload rollback (`rollback_upload_atomic`), and reconciliation lot reversion (`revert_reconciliation_lot_atomic`) all operate inside atomic PostgreSQL transactions with fail-closed security.

---

## 2. Unified Route & Authorization Matrix (24 Routes Audited)

All routes now derive permissions from a single authoritative catalog (`ROUTE_PERMISSIONS` in `src/lib/rbac-service.ts`), ensuring complete synchronization between the router guard (`route.tsx`), application sidebar (`app-sidebar.tsx`), and the command palette (`command-palette.tsx`):

| Route Path               | View / Module                     | Route Guard (`ROUTE_PERMISSIONS`)                                                                                              | Sidebar Access                                                                                                                 | Command Palette Access                                                                                                         | Status  |
| :----------------------- | :-------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :-----: |
| `/`                      | Landing / Marketing               | Public                                                                                                                         | Public                                                                                                                         | Public                                                                                                                         | ✅ Pass |
| `/auth`                  | Authentication (GoTrue)           | Public                                                                                                                         | Public                                                                                                                         | Public                                                                                                                         | ✅ Pass |
| `/dashboard`             | Executive Dashboard & KPIs        | Authenticated                                                                                                                  | All Authenticated                                                                                                              | All Authenticated                                                                                                              | ✅ Pass |
| `/companies`             | Company Master Registry           | `admin`, `supervisor`, `operator`, `read_only`                                                                                 | `admin`, `supervisor`, `operator`, `read_only`                                                                                 | `admin`, `supervisor`, `operator`, `read_only`                                                                                 | ✅ Pass |
| `/clients`               | Shareholder Master Registry       | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `read_only`                                                 | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `read_only`                                                 | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `read_only`                                                 | ✅ Pass |
| `/dividend`              | Equity Dividend Payables          | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `finance_operator`, `read_only`                             | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `finance_operator`, `read_only`                             | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `finance_operator`, `read_only`                             | ✅ Pass |
| `/interest`              | Debenture Interest Payables       | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `finance_operator`, `read_only`                             | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `finance_operator`, `read_only`                             | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `finance_operator`, `read_only`                             | ✅ Pass |
| `/mutual-fund`           | Mutual Fund Distributions         | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `finance_operator`, `read_only`                             | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `finance_operator`, `read_only`                             | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `finance_operator`, `read_only`                             | ✅ Pass |
| `/payments`              | Payment Batches & ConnectIPS      | `admin`, `supervisor`, `finance_operator`, `maker`, `checker`, `approver`, `read_only`                                         | `admin`, `supervisor`, `finance_operator`, `maker`, `checker`, `approver`, `read_only`                                         | `admin`, `supervisor`, `finance_operator`, `maker`, `checker`, `approver`, `read_only`                                         | ✅ Pass |
| `/reconciliation`        | Bank 5-Way Reconciliation         | `admin`, `supervisor`, `reconciliation_officer`, `finance_operator`                                                            | `admin`, `supervisor`, `reconciliation_officer`, `finance_operator`                                                            | `admin`, `supervisor`, `reconciliation_officer`, `finance_operator`                                                            | ✅ Pass |
| `/allocations`           | CDSC & IAF Allotments             | `admin`, `supervisor`, `finance_operator`, `operator`, `maker`                                                                 | `admin`, `supervisor`, `finance_operator`, `operator`, `maker`                                                                 | `admin`, `supervisor`, `finance_operator`, `operator`, `maker`                                                                 | ✅ Pass |
| `/agm-studio`            | AGM Multi-Year Historical Studio  | `admin`, `supervisor`, `operator`, `finance_operator`                                                                          | `admin`, `supervisor`, `operator`, `finance_operator`                                                                          | `admin`, `supervisor`, `operator`, `finance_operator`                                                                          | ✅ Pass |
| `/approvals`             | Maker-Checker Approval Queue      | `admin`, `supervisor`, `approver`, `checker`                                                                                   | `admin`, `supervisor`, `approver`, `checker`                                                                                   | `admin`, `supervisor`, `approver`, `checker`                                                                                   | ✅ Pass |
| `/upload`                | Excel Multi-Sheet Ingestion       | `admin`, `supervisor`, `operator`, `maker`                                                                                     | `admin`, `supervisor`, `operator`, `maker`                                                                                     | `admin`, `supervisor`, `operator`, `maker`                                                                                     | ✅ Pass |
| `/upload-history`        | Ingestion History & Rollback      | `admin`, `supervisor`, `operator`, `maker`, `auditor`                                                                          | `admin`, `supervisor`, `operator`, `maker`, `auditor`                                                                          | `admin`, `supervisor`, `operator`, `maker`, `auditor`                                                                          | ✅ Pass |
| `/uploads`               | Legacy Route Redirect             | Redirects to `/upload-history`                                                                                                 | Hidden                                                                                                                         | Hidden                                                                                                                         | ✅ Pass |
| `/reports`               | Statutory & Financial Reports     | `admin`, `supervisor`, `report_viewer`, `auditor`, `finance_operator`, `read_only`, `maker`, `operator`, `checker`, `approver` | `admin`, `supervisor`, `report_viewer`, `auditor`, `finance_operator`, `read_only`, `maker`, `operator`, `checker`, `approver` | `admin`, `supervisor`, `report_viewer`, `auditor`, `finance_operator`, `read_only`, `maker`, `operator`, `checker`, `approver` | ✅ Pass |
| `/analytics`             | Financial & Demographic Analytics | `admin`, `supervisor`, `finance_operator`, `report_viewer`, `read_only`                                                        | `admin`, `supervisor`, `finance_operator`, `report_viewer`, `read_only`                                                        | `admin`, `supervisor`, `finance_operator`, `report_viewer`, `read_only`                                                        | ✅ Pass |
| `/classification-review` | Tax Classification Queue          | `admin`, `supervisor`, `checker`, `approver`, `operator`                                                                       | `admin`, `supervisor`, `checker`, `approver`, `operator`                                                                       | `admin`, `supervisor`, `checker`, `approver`, `operator`                                                                       | ✅ Pass |
| `/audit-logs`            | Immutable System Audit Trail      | `admin`, `auditor`, `supervisor`                                                                                               | `admin`, `auditor`, `supervisor`                                                                                               | `admin`, `auditor`, `supervisor`                                                                                               | ✅ Pass |
| `/audit`                 | Legacy Route Redirect             | Redirects to `/audit-logs`                                                                                                     | Hidden                                                                                                                         | Hidden                                                                                                                         | ✅ Pass |
| `/data-management`       | Maintenance & Bonus Sync          | `admin`, `supervisor`                                                                                                          | `admin`, `supervisor`                                                                                                          | `admin`, `supervisor`                                                                                                          | ✅ Pass |
| `/settings/fiscal-years` | Nepali B.S. Fiscal Years          | `admin`, `supervisor`                                                                                                          | `admin`, `supervisor`                                                                                                          | `admin`, `supervisor`                                                                                                          | ✅ Pass |
| `/settings`              | System Settings & TDS Rates       | `admin`, `supervisor`                                                                                                          | `admin`, `supervisor`                                                                                                          | `admin`, `supervisor`                                                                                                          | ✅ Pass |
| `/backup`                | Database Backup & Snapshots       | `admin`, `supervisor`                                                                                                          | `admin`, `supervisor`                                                                                                          | `admin`, `supervisor`                                                                                                          | ✅ Pass |

---

## 3. Data Lifecycle & Workflow Verification

### 3.1 Data Ingestion & Calculation Engine Parity

1. **Edge Function vs. Browser Fallback:**
   - Both engines support dynamic parameters (`isPreCalculated`, `faceValue`, `daysCount`, `dayCountConvention`).
   - If `faceValue` is supplied in import options, both paths use it rather than defaulting to 100/1000.
   - Classification logic:
     1. Natural Person indicators (`father_name`, `grandfather_name`, `citizenship`) override corporate name heuristics.
     2. Tax-exempt entities and Mutual Funds matched before generic institutions.
     3. Nepali given names sharing tokens with fund schemes (e.g. _YOJANA_, _LUK_) are protected from false-positive mutual fund classification.
     4. Statutory TDS applied:
        - Dividends: Natural Person = 5%, Institution = 15%, Tax Exempt = 0%.
        - Debentures: Natural Person = 6%, Institution = 15%, Tax Exempt = 0%.
        - Mutual Funds: Natural Person = 5%, Institution = 15%, Tax Exempt = 0%.
2. **Database Trigger Integrity:**
   - The PostgreSQL trigger `apply_payable_classification_and_tax` operates on `BEFORE INSERT OR UPDATE`. It preserves explicit custom rates (`IF NEW.tds_rate IS NULL`) while applying statutory defaults when rates are omitted.
3. **Rollback Idempotency:**
   - Both `rollback_upload_atomic` and `rollback_upload_file_atomic` remove payables, clear duplicate SHA-256 hashes, and purge orphan client records without affecting shared shareholder master records.

### 3.2 Payable-to-Payment Lifecycle

1. **Batch Generation:**
   - Payment batch creation filters out already batched payables, ensuring no shareholder receives double disbursement for the same fiscal action.
2. **Maker-Checker Segregation:**
   - `workflow-engine.ts` prevents self-approval: a user with `maker` role who creates a batch cannot approve it even if they also possess `approver` permissions.
3. **Atomic Batch Completion:**
   - `complete_payment_batch_atomic` locks the batch, marks all line items as `Paid`, syncs parent payable tables (`paid_amount`, `remaining_amount`, `payment_status`), and appends to the immutable audit log in a single transaction.

### 3.3 Reconciliation & Operational Tolerances

1. **5-Way Matching:**
   - Compares Excel bank records against payables, payment records, and statement debits/credits using non-fuzzy account and reference matching.
2. **Tolerance Hierarchy:**
   - **Bank Settlement Matching Tolerance:** $\pm\text{NPR } 0.50$ (`RECONCILIATION_TOLERANCE_NPR`), accounting for banking gateway truncation and rounding.
   - **Database Balance Invariant Constraint:** $\pm\text{NPR } 0.05$ (`DATABASE_PAYABLE_BALANCE_TOLERANCE_NPR`), enforced on PostgreSQL tables via `chk_div_balance_invariant`.
3. **Reversion Safety:**
   - `revert_reconciliation_lot_atomic` resets payables back to `Pending` and zeroes payment records. Payments that have already achieved `Completed` or `ExternallySettled` status are protected from accidental revocation.
4. **History Save Failure Guard:**
   - If persisting reconciliation lot results fails in `ReconciliationService.saveResults`, the UI flags a persistent error toast and explicitly suppresses the success toast to prevent misleading operators into believing records were archived.

---

## 4. Key Hardening Actions Completed

### 🟢 1. AGM Studio Invalid Company Schema Fix

- **Location:** `src/lib/services/agm-studio.service.ts:868`
- **Resolution:** Removed references to non-existent `total_shares` column on `companies`. Fallback inserts now pass valid schema attributes (`company_code`, `company_name`, `isin`, `sector_type`, `status`).

### 🟢 2. Reconciliation History Save Failure Exclusivity

- **Location:** `src/routes/_authenticated/reconciliation.tsx:710-745` and `903-937`
- **Resolution:** Added `historySaved` state tracking to prevent simultaneous warning/error and success toasts when `saveResults` encounters database failures.

### 3. Ambiguous BOID Multi-Company Scoping

- **Location:** `src/lib/reconciliation-engine.ts:253, 330`
- **Resolution:** Selected `company_id` in client queries and prioritized matching the active company's client record when populating `clientsByBoid`.

### 🟢 4. Single-Catalog Role Permission Synchronization

- **Location:** `src/lib/rbac-service.ts`, `src/routes/_authenticated/route.tsx`, `src/components/app-sidebar.tsx`, `src/components/command-palette.tsx`
- **Resolution:** Exported `ROUTE_PERMISSIONS` from `rbac-service.ts` as the single authoritative source of truth. Router guard, sidebar, and command palette now filter identically.

### 🟢 5. Classification Review Non-Admin Action Protection

- **Location:** `src/routes/_authenticated/classification-review.tsx`
- **Resolution:** Guarded "Auto-Fix Natural Persons", "Recompute All", and individual "Recompute" buttons behind `useAuth().hasAny(["admin", "supervisor"])` permissions. Non-admin reviewers can inspect exceptions without hitting unauthorized server RPCs.

### 🟢 6. CSRF & Cross-Site Origin Middleware

- **Location:** `src/start.ts`
- **Resolution:** Added server-level `csrfMiddleware` checking `Sec-Fetch-Site` and `Origin/Host` headers on mutating requests, complementing `requireSupabaseAuth` Bearer token verification.

### 🟢 7. Mutual Fund Classification False-Positive Elimination

- **Location:** `src/lib/services/smart-classifier.ts`, `supabase/functions/process-import-chunk/index.ts`
- **Resolution:** Removed bare standalone keywords (`YOJANA`, `LUK`, `SLK`) from `MUTUAL_FUND_SCHEMES_REGEX`. Nepali given names are now classified as `NATURAL_PERSON` (`PUBLIC`, 5% TDS), while genuine funds (_NABIL BALANCED FUND-II_, _NIBL SAMRIDDHI FUND-II_, _CIT - CITIZEN UNIT SCHEME_) classify as `MUTUAL_FUND` / `TAX_EXEMPT` (0% TDS).

---

## 5. Verification Commands

To re-verify the codebase at any time:

```powershell
# 1. Full test suite (275 tests across 33 files)
npx vitest run

# 2. TypeScript typecheck
npm run typecheck

# 3. ESLint
npm run lint

# 4. Production build
npm run build

# 5. Database deployment & RPC verification
node scripts/verify-supabase-deployment.mjs
```
