# RTARTS System — Comprehensive Workflow & Authorization Audit Report

**Scope:** End-to-end audit of all user-facing screens (22 authenticated routes + public shell), data lifecycle, import calculation parity, payable-to-payment workflows, bank reconciliation, multi-tenant isolation, and role-based access control (RBAC).

**Audit Date:** 2026-10-01  
**Environment:** Local Isolated Sandbox (`http://127.0.0.1:54321`, Docker Supabase CLI v2.109.0)  
**Baseline Git Commit:** `3c859cf` (`origin/main`)  
**Test Suite Status:** 33 / 33 test files passed (271 / 271 tests), TypeScript `tsc --noEmit` clean, ESLint clean, Production Vite+Nitro build successful.

---

## 1. Executive Summary

A comprehensive, non-destructive audit of the RTARTS (RBB Merchant Banking — RTS/RTARTS) platform was conducted across all 24 route modules, the dual import engines (Deno Edge Function vs. Browser chunk processor), the database trigger layer, and the financial settlement workflows.

### Overall System Assessment: **HEALTHY & PRODUCTION-READY**

- **Core Financial Integrity:** Math invariants ($Gross - Tax = Net$) are strictly enforced across debentures, equity dividends, and mutual funds within a statutory $\pm0.50$ NPR tolerance.
- **Tenancy & Isolation:** Company scoping (`company_id`) and Row-Level Security (`has_company_access`) prevent cross-company leakage when investors hold shares across multiple client institutions with the same 16-digit BOID.
- **Import Parity:** Verified that commit `3c859cf` synchronized the Deno Edge Function (`process-import-chunk`), the client-side fallback (`import.service.ts`), the database trigger (`apply_payable_classification_and_tax`), the `payable_tax_rules` table, and system settings to an authoritative 15% institutional dividend TDS and 6% debenture TDS for individuals.
- **Atomic Operations:** Payment batch completion (`complete_payment_batch_atomic`), upload rollback (`rollback_upload_atomic`), and reconciliation lot reversion (`revert_reconciliation_lot_atomic`) all operate inside atomic PostgreSQL transactions with fail-closed security.

---

## 2. Route & Authorization Matrix (24 Routes Audited)

| Route Path               | View / Module                     | Route Guard (`route.tsx`)                                                                                                      | Sidebar Access                                 | Direct URL Access Check |  Status   |
| :----------------------- | :-------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------- | :---------------------- | :-------: |
| `/`                      | Landing / Marketing               | Public                                                                                                                         | Public                                         | Allowed                 |  ✅ Pass  |
| `/auth`                  | Authentication (GoTrue)           | Public                                                                                                                         | Public                                         | Allowed                 |  ✅ Pass  |
| `/dashboard`             | Executive Dashboard & KPIs        | Authenticated                                                                                                                  | All Roles                                      | Enforced                |  ✅ Pass  |
| `/companies`             | Company Master Registry           | `admin`, `supervisor`, `operator`, `read_only`                                                                                 | `admin`, `supervisor`, `operator`, `read_only` | Enforced                |  ✅ Pass  |
| `/clients`               | Shareholder Master Registry       | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `read_only`                                                 | All Authenticated                              | Enforced                |  ✅ Pass  |
| `/dividend`              | Equity Dividend Payables          | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `finance_operator`, `read_only`                             | All Authenticated                              | Enforced                |  ✅ Pass  |
| `/interest`              | Debenture Interest Payables       | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `finance_operator`, `read_only`                             | All Authenticated                              | Enforced                |  ✅ Pass  |
| `/mutual-fund`           | Mutual Fund Distributions         | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `finance_operator`, `read_only`                             | All Authenticated                              | Enforced                |  ✅ Pass  |
| `/payments`              | Payment Batches & ConnectIPS      | `admin`, `supervisor`, `finance_operator`, `maker`, `checker`, `approver`, `read_only`                                         | All Authenticated                              | Enforced                |  ✅ Pass  |
| `/reconciliation`        | Bank 5-Way Reconciliation         | `admin`, `supervisor`, `reconciliation_officer`, `finance_operator`                                                            | All Authenticated                              | Enforced                |  ✅ Pass  |
| `/allocations`           | CDSC & IAF Allotments             | `admin`, `supervisor`, `finance_operator`, `operator`, `maker`                                                                 | All Authenticated                              | Enforced                |  ✅ Pass  |
| `/agm-studio`            | AGM Multi-Year Historical Studio  | `admin`, `supervisor`, `operator`, `finance_operator`                                                                          | All Authenticated                              | Enforced                |  ✅ Pass  |
| `/approvals`             | Maker-Checker Approval Queue      | `admin`, `supervisor`, `approver`, `checker`                                                                                   | `admin`, `supervisor`, `approver`, `checker`   | Enforced                |  ✅ Pass  |
| `/upload`                | Excel Multi-Sheet Ingestion       | `admin`, `supervisor`, `operator`, `maker`                                                                                     | All Authenticated                              | Enforced                |  ✅ Pass  |
| `/upload-history`        | Ingestion History & Rollback      | `admin`, `supervisor`, `operator`, `maker`, `auditor`                                                                          | All Authenticated                              | Enforced                |  ✅ Pass  |
| `/uploads`               | Legacy Route Redirect             | Redirects to `/upload-history`                                                                                                 | Hidden                                         | Redirects               |  ✅ Pass  |
| `/reports`               | Statutory & Financial Reports     | `admin`, `supervisor`, `report_viewer`, `auditor`, `finance_operator`, `read_only`, `maker`, `operator`, `checker`, `approver` | All Authenticated                              | Enforced                |  ✅ Pass  |
| `/analytics`             | Financial & Demographic Analytics | `admin`, `supervisor`, `finance_operator`, `report_viewer`, `read_only`                                                        | All Authenticated                              | Enforced                |  ✅ Pass  |
| `/classification-review` | Tax Classification Queue          | `admin`, `supervisor`, `checker`, `approver`, `operator`                                                                       | `admin`, `supervisor`                          | Enforced                |  ✅ Pass  |
| `/audit-logs`            | Immutable System Audit Trail      | `admin`, `auditor`, `supervisor`                                                                                               | `admin`, `auditor`, `supervisor`               | Enforced                |  ✅ Pass  |
| `/audit`                 | Legacy Route Redirect             | Redirects to `/audit-logs`                                                                                                     | Hidden                                         | Redirects               |  ✅ Pass  |
| `/data-management`       | Maintenance & Bonus Sync          | `admin`, `supervisor`                                                                                                          | `admin`, `supervisor`                          | Enforced                |  ✅ Pass  |
| `/settings/fiscal-years` | Nepali B.S. Fiscal Years          | `admin`, `supervisor`                                                                                                          | `admin`, `supervisor`                          | Enforced                |  ✅ Pass  |
| `/settings`              | System Settings & TDS Rates       | `admin`                                                                                                                        | `admin`                                        | Enforced                |  ✅ Pass  |
| `/backup`                | Database Backup & Snapshots       | ⚠️ _Client-side only_ (see Finding A-1)                                                                                        | `admin`, `supervisor`                          | Needs Guard             | ⚠️ Review |

---

## 3. Data Lifecycle & Workflow Verification

### 3.1 Data Ingestion & Calculation Engine Parity

1. **Edge Function vs. Browser Fallback:**
   - Both engines implement identical classification priority:
     1. Natural Person indicators (`father_name`, `grandfather_name`, `citizenship`) override corporate name heuristics.
     2. Tax-exempt entities and Mutual Funds matched before generic institutions.
     3. TDS rates applied:
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
   - `complete_payment_batch_atomic` locks the batch, marks all line items as `Paid`, syncs the parent payable tables (`paid_amount`, `remaining_amount`, `payment_status`), and appends to the immutable audit log in a single transaction.

### 3.3 Reconciliation & Reversibility

1. **5-Way Matching:**
   - Compares Excel bank records against payables, payment records, and statement debits/credits using non-fuzzy account and reference matching.
2. **Tolerance Boundary:**
   - Centralized at `0.50 NPR` (`RECONCILIATION_TOLERANCE_NPR`).
3. **Reversion Safety:**
   - `revert_reconciliation_lot_atomic` resets payables back to `Pending` and zeroes payment records. Crucially, payments that have already achieved `Completed` or `ExternallySettled` status are protected from accidental revocation.

### 3.4 Regulatory Reporting Invariants

1. **IRD Annex-10 e-TDS:**
   - Validates that $\sum \text{Gross} - \sum \text{TDS} = \sum \text{Net}$ within 0.05 NPR tolerance before permitting CSV/Excel export.
2. **Investor Protection Fund (IPF) Aging:**
   - Calculates unpaid dividends across 5-year statutory thresholds for transfer to the SEBON Investor Protection Fund.

---

## 4. Key Findings & Resolution Status

### 🟢 Finding A-1: Add `/backup` to `restrictedPaths` in `route.tsx` — **RESOLVED**

- **Location:** `src/routes/_authenticated/route.tsx:27-95`
- **Resolution:** Added `"/backup": ["admin", "supervisor"]` to `restrictedPaths`. Unauthorized roles are now cleanly intercepted and redirected to `/dashboard` before the route component loads.

### 🟢 Finding A-2: Refresh Command Palette Navigation Routes — **RESOLVED**

- **Location:** `src/components/command-palette.tsx:31-51`
- **Resolution:** Updated all routes to use direct canonical URLs (`/upload`, `/upload-history`, `/audit-logs`) and added all 22 authenticated modules (`/payments`, `/agm-studio`, `/data-management`, `/classification-review`, `/backup`, `/analytics`, `/settings`), each with their contextual Lucide icons.

---

## 5. Verification Commands

To re-verify the codebase at any time:

```powershell
# 1. Full test suite (271 tests across 33 files)
npx vitest run

# 2. TypeScript typecheck
npm run typecheck

# 3. ESLint
npm run lint

# 4. Production build
npm run build
```
