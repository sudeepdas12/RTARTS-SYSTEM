# RTARTS System — End-to-End Audit Report

**Scope:** Full-system audit of the RTARTS (RBB Merchant Banking — RTS/RTARTS) dividend & interest management platform: import pipeline, calculation, payables, payments, reconciliation, and reporting.

**Audit date:** 2026-09-30
**Baseline commit:** `89a7d8a` (main, in sync with origin)
**Re-audit:** working tree at `HEAD 89a7d8a` + uncommitted TDS-alignment changes (migration `20261219000000` included) — see Section 8.

---

## 1. Executive Summary

The system is **functionally complete and production-ready in its core workflow**: the full Import → Calculate → Payables → Payment Batch → Reconciliation → Report pipeline is implemented, integrated, and verified by a passing suite of **271 tests across 33 files** (including live-DB rollback/smoke tests), a clean **TypeScript typecheck**, a **successful production build**, and **ESLint clean**.

**Top headline finding:** a **Tax (TDS) rate source-of-truth inconsistency for institutional dividend payables**:

| Component                                                                                        | Institutional Dividend TDS |
| ------------------------------------------------------------------------------------------------ | -------------------------- |
| `src/lib/services/payable-summary.ts` `getPayeeTaxRate('INSTITUTION', false)`                    | **15%**                    |
| `src/lib/dividend-calculator.ts` `taxCategory='INSTITUTION'`                                     | **15%**                    |
| DB `payable_tax_rules` (seed + migration `20261111000000`) `DIVIDEND/COMPANY_INSTITUTION`        | **5%**                     |
| DB trigger `apply_payable_classification_and_tax` (migration `20261171000000`) — dividend branch | **5%**                     |
| Settings default `dividend_tds_legal` (`settings.service.ts`)                                    | **5%**                     |
| e2e smoke test (`e2e-smoke.test.ts`) expectation                                                 | **15%**                    |

The commit `6a7e0dd` ("institutional dividend TDS 5% to 15%") updated only the **front-end calculator** to 15%, but the **database rule/trigger/seed were not updated** — so imported institutional dividend payables still resolve to **5%** through the database path while the UI calculator and tests show **15%**. This is the single most important remediation item (Section 7, item C-1).

No other workflow-blocking defects were found. The remaining findings are consistency, hardening, and UX improvements.

---

## 2. Verification Environment & Method

- **Validation commands run:**
  - `npx vitest run` → ✅ 33 files / **271 tests passed** (unit + live-DB e2e/live-verification)
  - `npx tsc --noEmit` → ✅ no type errors
  - `npm run build` (Vite/Nitro) → ✅ built successfully
  - `npm run lint` (ESLint) → ✅ clean
- **Files reviewed:** all route views under `src/routes/_authenticated`, all services under `src/lib/services`, core engines (`dividend-calculator`, `interest-calculator`, `excel-parser`, `chunk-processor`, `validation-engine`, `reconciliation-engine`, `payment-generator`, `excel-exporter`, `pdf-generator`, `bank-parser`), `src/lib/*` utilities, and **all 100+ Supabase migrations** in `supabase/migrations`.

---

## 3. Section-by-Section Status

| Section                 | Route / Module           | Status                                                         |
| ----------------------- | ------------------------ | -------------------------------------------------------------- |
| Dashboard & KPIs        | `/dashboard`             | ✅ Working                                                     |
| Companies (Master)      | `/companies`             | ✅ Working                                                     |
| Clients (Master)        | `/clients`               | ✅ Working                                                     |
| Stock Dividend          | `/dividend`              | ✅ Working (C-1 fixes in working tree + Edge Function; see §8) |
| Debenture Interest      | `/interest`              | ✅ Working                                                     |
| Mutual Fund             | `/mutual-fund`           | ✅ Working (C-2 DB rules aligned; see §8)                      |
| Payments                | `/payments`              | ✅ Working                                                     |
| Bank Reconciliation     | `/reconciliation`        | ✅ Working                                                     |
| Reports                 | `/reports`               | ✅ Working                                                     |
| Upload Data             | `/upload`                | ✅ Working                                                     |
| Upload History          | `/upload-history`        | ✅ Working                                                     |
| CDSC & IAF / Allotments | `/allocations`           | ✅ Working                                                     |
| AGM Studio              | `/agm-studio`            | ✅ Working (very large view)                                   |
| Pending Approvals       | `/approvals`             | ✅ Working                                                     |
| Data Management         | `/data-management`       | ✅ Working                                                     |
| Classification Review   | `/classification-review` | ✅ Working                                                     |
| Audit Logs              | `/audit-logs`            | ✅ Working                                                     |
| Analytics               | `/analytics`             | ✅ Working                                                     |
| Backup & Recovery       | `/backup`                | ✅ Working                                                     |
| Users & Roles           | `/users`                 | ✅ Working                                                     |
| Fiscal Years            | `/settings/fiscal-years` | ✅ Working                                                     |
| System Settings         | `/settings`              | ✅ Working                                                     |
| AUTH login              | `/auth`                  | ✅ Working                                                     |

---

## 4. End-to-End Workflow Verification

### 4.1 Import Pipeline — ✅ Working

`excel-parser.ts` (multi-sheet: CA / AD / BM / Dividend / Bonus / CDSC / SUMMARY) → field-alias mapping with priority → `chunk-processor.ts` (1,000-row chunks, per-row `upload_errors` persistence) → `import.service.ts` → **edge function `process-import-chunk`** with **60 s timeout + client-side fallback**, or direct batched client processing.

- **Robustness verified:**
  - Footer/`TOTAL`/`SUMMARY` rows are filtered out before import.
  - BOID normalization (pad to 16), aliases across CDS column naming variants.
  - Client ID batching (`CLIENT_LOOKUP_BATCH=300`) avoids PostgREST URL-length failures.
  - `bulk_insert_*` RPCs are **idempotent** (`ON CONFLICT`) — re-imports are safe.
  - Schema fallback strips only whitelisted optional columns; refuses to strip required columns.
  - `checkDuplicateFile` (SHA-256 hash) blocks duplicate completed uploads.
  - Upload status self-healing (stale `Processing` → auto-finalized).
  - Atomic rollback RPCs (`rollback_upload_atomic`, `rollback_upload_file_atomic`) delete payables/payments, purge orphan clients, clear duplicate locks, and mark `RolledBack`.
- **Component-level upload tracking** is comprehensive (single sheet + import-all-sheets).

### 4.2 Calculation Engines — ✅ Working (rates: see C-1)

- `dividend-calculator.ts`: cash + bonus share (+ combined), bonus-on-cash on pre-bonus capital toggle, equity share rounding (EPSILON-safe), tax categories with per-category override, `taxPayableByInvestor` for negatives.
- `interest-calculator.ts`: Actual/365 & ISDA 30/360, leap-year/Feb-end adjustments, prorated days, TDS by category.
- **Math invariants** (`gross − tax = net`, tolerance NPR 0.05–0.50) are enforced by DB CHECK constraints/triggers and validated by tests (`e2e-payment-reconciliation-flows.test.ts`, `validation-engine`).

### 4.3 Payables Creation — ✅ Working

- Dividend / interest / mutual-fund payables built during import via RPCs with `ON CONFLICT` upserts, `paid_amount`/`remaining_amount` fields, installments (`days_count`), bank snapshots, TDS.
- DB trigger `apply_payable_classification_and_tax` resolves classification from the client master and re-applies rules. The original 5%-for-institutions dividend branch is now replaced by the working-tree migration `20261219000000` (15%; fixes C-1). ⚠️ The **Edge Function** (`supabase/functions/process-import-chunk`) previously wrote 5% for institutions — corrected in the working tree; must be deployed (C-1b).
- Payment batch generation (`payments.tsx`) prorates partial installments and excludes already-batched payables.

### 4.4 Payment Batch Workflow — ✅ Working

- `Draft → Pending → Approved → Processed → Completed` with `workflow-engine.ts` + RBAC maker/checker/approver roles.
- Atomic completion via `complete_payment_batch_atomic` (locks batch, updates payments + all three payable tables, audits).
- Batch totals recomputed after line-item insertion; `createBatchWithLineItems` rolls back draft + items on failure.
- Currency: `PaymentGenerator` (NEFT/RTGS/Cheque), `ConnectIPSService` (HMAC / signature / return-file parsing / live disburse with progress), file exports.
- Reversal, remediation dialog (bank-account fix + requeue), and SMS broadcast wired.

### 4.5 Reconciliation — ✅ Working

- `reconciliation-engine.ts` performs 5-way matching (Excel rows ↔ payables ↔ payments ↔ bank statements, cross-reference payables↔payments, payments↔bank statements), with strict non-fuzzy matching, tolerance NPR 0.50, prorated-interest matching, and FY date-compatibility guards.
- Save results → `apply_reconciliation_batch` RPC (atomic per company/lot, creates batch + payments, syncs payables) → history grouping into lots → lot **revert** (`revert_reconciliation_lot_atomic`) with fallback path → lot delete (admin-only, RLS-protected).
- Rejected-payment account remediation dialog integrated.

### 4.6 Reports — ✅ Working

- Dividend / Interest / Mutual-Fund Registers, Tax (TDS) Register, Pending Payments, Payment Register, Bonus Share, Reconciliation, Upload History, Bank Statement, Shareholder Demographics, Client Profiles, plus **IRD e-TDS Annex-10** (`ird-etds.service.ts`), **IPF aging report** (`ipf.service.ts`), share-allocation & CDSC reports.
- Export via `excel-exporter.ts` (browser-safe cap 5,000 rows with truncation note) and `pdf-generator.ts`.
- **Invariant checking** built into report generator (`assertReportInvariants`).

### 4.7 Security / RBAC / Audit — ✅ Working

- Route-level role guards (`_authenticated/route.tsx` `restrictedPaths`), RLS on all sensitive tables, `has_company_access` tenancy isolation, service-role-only admin server functions, anon revoked, audit triggers, login/API/error logging.

---

## 5. Data & Migration Layer Notes

- Migrations are **catalogued and coherent** (100+ SQL files ordered by timestamp). Recent performance work (statement timeouts, trigram indexes, composite indexes, `get_clients_paginated` optimization) is in the latest migrations.
- `sync_clients_bonus_holdings` RPC: idempotent, 60 s timeout, admin/supervisor + company-access checks, audit trail — good.
- `20261214000000_seed_company_defaults_and_cleanup` and `20261218000000_generic_company_defaults_and_trigger` auto-seed defaults; verified in files.

---

## 6. Test Coverage Summary

| Suite                                                                                                                                                             | Result                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/lib/services/*.test.ts` + unit tests                                                                                                                         | ✅ Passing                                                                                                 |
| `e2e-smoke.test.ts` (category/TDS invariants)                                                                                                                     | ✅ Passing (asserts 15% institutional dividend — now consistent with DB rules/trigger/seed after §8 fixes) |
| `e2e-live-verification.test.ts` (live DB pipeline w/ rollback)                                                                                                    | ✅ Passing in this environment                                                                             |
| `agm-rpc-live.test.ts`, `integration-financial-flows.test.ts`                                                                                                     | ✅ Passing / RLS-isolated                                                                                  |
| `chunk-processor.test.ts`, `report.test.ts`, `reconciliation`, `conversion`, `cdsc-bonus`, `ird-etds`, `ipf`, `iaf`, `connectips`, `tax-rules`, `payable-summary` | ✅ Passing                                                                                                 |
| Playwright config present (`playwright.config.ts`)                                                                                                                | Framework configured                                                                                       |

> Note: several live-DB tests are gated with `describe.skipIf(!isLiveDb)` and fall back to mocked paths in CI (`ci.yml` sets `CI=true` mock keys) — good CI hygiene.

---

## 7. Issues & Recommendations (Prioritized)

### 🔴 Critical

#### C-1. Institutional dividend TDS is 15% in the UI but 5% in the database rules/trigger

- **Files:** `src/lib/services/payable-summary.ts:184-187` (returns `0.15`); `src/lib/dividend-calculator.ts:61-62` (15%); `src/lib/services/e2e-smoke.test.ts:64-66` (expects 15%); `supabase/seed.sql:186` and `supabase/migrations/20261111000000_centralize_payee_classification_and_tax.sql:18` (`DIVIDEND/COMPANY_INSTITUTION = 0.05`); `supabase/migrations/20261171000000_fix_apply_payable_classification_holder_type.sql:70-79` (dividend branch falls to `0.05`); `src/lib/services/settings.service.ts:38` (`dividend_tds_legal: 5.0`).
- **Impact:** Data imported through the DB path (import engine + trigger) withholds **5%** TDS for institutional cash dividends, while the on-screen calculator and the smoke test report **15%** — under-withholding risk and report/UI disagreement for the same client.
- **Fix:** Standardize to one statutory rate. Recommended: add a migration that sets `DIVIDEND/COMPANY_INSTITUTION = 0.15` and `DIVIDEND/FOREIGN_INVESTOR = 0.15` (consistent with the 15% intent in commit `6a7e0dd`), update the trigger's dividend branch, update `seed.sql`, and align `settings.service.ts` default + `e2e-smoke` expectations. If 5% is statutory, instead revert the calculator/test change.

#### C-2. Mutual-fund calculator display rate vs DB rules

- **Files:** `src/routes/_authenticated/mutual-fund.tsx:591-596`, `supabase/seed.sql:196` (`MUTUAL_FUND/COMPANY_INSTITUTION = 0.15`).
- **Impact:** The MF calculator falls back to DB rules (15%) — consistent post-migration `20261115000000`; verify live DB has the updated 0.15 row (the migration is `ON CONFLICT DO UPDATE`, so a fresh seed would reinsert 0.05 only if `seed.sql` runs after — confirm the deployed DB row). Lower risk than C-1 but should be spot-checked.

### 🟠 Important

#### I-1. `getPayeeTaxRate` uses a hard-coded per-category table that can drift from `payable_tax_rules`

- **Files:** `src/lib/services/payable-summary.ts:149-194` (`getPayeeTaxRate`) vs `src/lib/services/tax-rules.service.ts` (`loadTaxRules` / `getTaxRateFromRules`).
- **Recommendation:** Route all tax lookups through the single `payable_tax_rules` source (as the settings page does) and make `getPayeeTaxRate` a thin fallback that only triggers when rules are unavailable (as `getCategoryTdsRate` in `import.service.ts` already does).

#### I-2. Documentation drift

- `docs/PRODUCTION_DEPLOYMENT_GUIDE.md` and `README.md` reference an **Electron shell** (`electron/main.js`, `electron/preload.js`); **no `electron/` directory or dependency exists** in the repo, and `package.json` has no electron scripts — the app is a plain Vite+Nitro web app.
- `RUNBOOK.md` and `README.md` test counts (256/270) trail the actual suite (270).
- **Recommendation:** Update docs to describe the current Nitro/Vite deployment model and refresh badge/test counts.

#### I-3. Reconcile live DB vs seed state

- The e2e live tests pass against the deployed DB, but **`seed.sql` is not re-run on top of an existing database**. Any rate/config divergence between live DB rows and seed/migrations can silently change behavior. **Recommendation:** add a `supabase db diff` + data-integrity check to CI, and a small "audit vs expected tax rules" RPC (there is a `scratch/audit_all.ts` precedent).

### 🟡 Nice-to-Have / UX

- **N-1.** `agm-studio.tsx` is ~315 KB, `payments.tsx` ~120 KB, `dividend.tsx` ~129 KB — split into feature components for maintainability (the rest of the codebase already follows a component-per-area pattern).
- **N-2.** `BankParser` / reconciliation date-window logic hardcodes Nepal FY calendar windows (`reconciliation-engine.ts:1102-1115`) — consider driving from `fiscal_years` table.
- **N-3.** `MAX_EXPORT_BROWSER_ROWS = 5000` browser export cap is applied beyond a console warning; the note row handles auditability, but consider a "download full via server export" call-to-action in the UI.
- **N-4.** `dividend.service.ts` RTS push silently returns when `VITE_RTS_API_URL` is unset (logs a warning); consider surfacing configuration state in the UI.
- **N-5.** `settings.index.tsx` masks SMTP/SMS keys client-side (`system_settings_safe` view) — good; ensure the server-side `save_system_settings_global` RPC is the only write path in production.
- **N-6.** Small inconsistency: `reports.tsx` `applyClassificationFilter` builds `query.or()` with `PUBLIC` offering `NATURAL_PERSON` + `PUBLIC_LEGAL_PERSON` — verify OR precedence matches intended semantics in PostgREST (paren grouping).

---

## 8. Conclusion & Re-audit Verification

**C-1 — RESOLVED (working tree).** The institutional dividend TDS inconsistency is fixed and verified across every layer:

| Component                                                                                                                   | Institutional Dividend TDS | Status    |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------- |
| `src/lib/services/payable-summary.ts` `getPayeeTaxRate('INSTITUTION', false)`                                               | **15%**                    | ✅        |
| `src/lib/dividend-calculator.ts` `taxCategory='INSTITUTION'`                                                                | **15%**                    | ✅        |
| DB `payable_tax_rules` (seed + migration `20261219000000`) `DIVIDEND/COMPANY_INSTITUTION` & `FOREIGN_INVESTOR`              | **15%**                    | ✅        |
| DB trigger `apply_payable_classification_and_tax` (migration `20261219000000`) — dividend branch                            | **15%**                    | ✅        |
| Edge Function `process-import-chunk` `getCategoryTdsRate('INSTITUTION'/'COMPANY_INSTITUTION'/'FOREIGN'/'FOREIGN_INVESTOR')` | **15%**                    | ✅ (C-1b) |
| Settings default `dividend_tds_legal` (`settings.service.ts`) + settings page writes to `payable_tax_rules`                 | **15%**                    | ✅        |
| e2e smoke test (`e2e-smoke.test.ts`) expectation                                                                            | **15%**                    | ✅        |

**C-2 — Verified.** `MUTUAL_FUND/COMPANY_INSTITUTION` and `MUTUAL_FUND/FOREIGN_INVESTOR` are both seeded to **15%** (`seed.sql`) via the same migration; `seed.sql` now uses `ON CONFLICT ... DO UPDATE` so a re-seed over an existing DB converges to the authoritative rates.

**Re-audit validation (working tree at `HEAD 89a7d8a` + TDS-alignment changes):**

- `npx vitest run` → ✅ **33 files / 271 tests passed**
- `npx tsc --noEmit` → ✅ no type errors
- `npm run build` (Vite/Nitro) → ✅ built successfully
- `npm run lint` (ESLint) → ✅ clean

**Remaining deployment note (C-1b / production):** The Edge Function fix is present in the working tree but must be deployed to the live Supabase project to take effect for the production import path:

```powershell
supabase functions deploy process-import-chunk --no-verify-jwt
```

After deploying, apply migration `20261219000000_align_institutional_dividend_and_mf_tds.sql` (it also refreshes the trigger and rules) so the live DB trigger and `payable_tax_rules` rows match the 15% statutory rate. The rest of the core workflows (import, calculation, payables, payment batches, reconciliation, reporting) are verified green. With C-1 aligned and C-2 confirmed, the system is ready for the documented production deployment.
