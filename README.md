# RTARTS System

**RBB Merchant Banking Limited — Registrar & Transfer Agent (RTS / RTARTS) System**

[![Vitest Tests](https://img.shields.io/badge/Vitest-224%20Passed-brightgreen.svg)](https://github.com/sudeepdas12/RTARTS-SYSTEM)
[![Playwright E2E](https://img.shields.io/badge/Playwright-6%20Passed-brightgreen.svg)](https://github.com/sudeepdas12/RTARTS-SYSTEM)
[![ESLint](https://img.shields.io/badge/ESLint-Clean-blue.svg)](https://github.com/sudeepdas12/RTARTS-SYSTEM)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.x-61DAFB.svg)](https://react.dev/)
[![TanStack Router](https://img.shields.io/badge/TanStack-Start%20%2F%20Router-FF4154.svg)](https://tanstack.com/router)
[![Supabase Postgres](<https://img.shields.io/badge/Database-PostgreSQL%2015%20(Supabase)-3ECF8E.svg>)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4.x-38B2AC.svg)](https://tailwindcss.com/)

---

## Executive Overview

The **RTARTS (Registrar to the Shares / Registrar & Transfer Agent System)** is a mission-critical, multi-tenant enterprise platform engineered specifically for merchant banking and capital market operations in Nepal. It administers the entire lifecycle of shareholder registries, corporate actions, debenture interest disbursements, clearing-house bank integrations, statement reconciliations, statutory regulatory filings, and general meeting governance.

Designed strictly around Nepalese capital market regulations (Securities Board of Nepal — **SEBON**, Central Depository Services & Clearing — **CDSC**, and the Inland Revenue Department — **IRD**), the system enforces immutable audit trails, multi-tier Maker-Checker-Approver workflows, mathematical precision bounds, and row-level data isolation.

---

## Key Functional Modules

### 1. Shareholder & Investor Registry

- **CDSC Demat & Physical Folios**: Centralizes 16-digit Demat BOIDs (`1301...`) and legacy physical certificates with automatic alias extraction.
- **Optimized High-Volume Pagination**: Uses PostgreSQL statement-level security resolution and composite B-Tree indexes (`idx_clients_company_created_at`), returning page sets across **70,000+ client rows in under 370ms** without statement timeouts.
- **Investor Classification**: Classifies accounts into **Natural Person (Public, Promoter, Local, Staff)**, **Company / Institution**, **Mutual Fund**, **Tax-Exempt Entity**, and **Foreign / NRN Investor**.
- **Strict PII Protection & Company Isolation**: Secures PAN numbers, citizenship, NID, bank account numbers, and addresses behind strict Row-Level Security (RLS) with unauthenticated anonymous access completely revoked and company tenancy access validated via `has_company_access`.

### 2. Corporate Actions & Payables Engine

- **Dividend Distribution**: Processes Cash, Bonus (Stock), Right Shares, and Combined dividends.
- **Debenture Coupon Engine**: Computes daily accrued and periodic coupon interest under **Actual/365** and **ISDA 30/360** day-count conventions with leap-year and February month-end adjustments.
- **Statutory Tax Withholding (TDS)**: Automatically applies Nepal Income Tax withholding rules (5% resident retail, 6% debenture natural person, 15% corporate/foreign, 0% mutual funds & approved retirement funds).
- **Database Invariant Enforcement**: Ensures every payable row strictly satisfies:
  $$\text{Net Payable} = \text{Gross Amount} - \text{Tax Amount} \quad (\pm\text{NPR } 0.05 \text{ tolerance})$$

### 3. Share Restructuring & Corporate Conversions

- **5 Standard Nepalese Conversion Workflows**:
  1. **Promoter-to-Public Reclassification** (e.g. 70:30 to 51:49 ratio conversions).
  2. **Convertible Debenture / Preference to Equity** (conversion price valuation).
  3. **M&A / Merger Share Swap** (swap ratio balance computation).
  4. **Stock Split / Consolidation** (face value sub-divisions).
  5. **Physical-to-DEMAT Dematerialization (DRN)** (automatic physical folio discovery and conversion to Demat ordinary shares).
- **Atomic Database Execution**: Powered by `apply_share_conversion_atomic`, updating client holdings, reclassifying lock-in codes, inserting fractional remainder cash payables, and writing immutable audit logs in a single atomic database transaction.

### 4. CDSC Corporate Actions & Allotment File Engine

- **CDSC CAS Bonus Share Allotment**: Implements CDSC Corporate Action System rules, calculating whole bonus shares credited to Demat accounts and fractional remainders converted to cash payouts with automatic 5% tax withholding.
- **Statutory Tax Exemptions**: Recognizes Section 10 tax-exempt entities (Mutual Funds, Citizen Investment Trust, Employees Provident Fund, Social Security Fund) with 0% tax withholding.
- **CDSC Fixed-Width Specification Compliance**:
  - **IAF (Initial Allotment File)**: Formatted strictly with 42-character control headers and 124-character detail records, with 16-character zero-padded BOIDs and lock-in reason codes (`00` Free Public, `01` Promoter, `02` Employee, `09` Local Affected).
  - **IPF (Corporate Action Allotment File)**: Produces 58-character control headers and 274-character debit/credit transaction lines.
- **Automated DRN Dematerialization**: Discovers un-dematted physical folios and converts them to CDSC Demat ordinary shares upon Demat Request Form confirmation.

### 5. Banking Settlement & File Generation

- **NCHL ConnectIPS Batch Integration**: Generates bank-compliant batch settlement files with account format sanitization, paisa-level amount encoding, and secure SHA-256 HMAC credential checksums.
- **ConnectIPS Live Status Verification**: Validates transaction settlement status via dual verification (status inquiry + internal financial ledger confirmation).
- **NEFT / RTGS Clearing Rails**: Produces structured clearing schedules for commercial banks.
- **Maker-Checker-Approver Lifecycle**: Enforces strict multi-tier approval states:
  $$\text{Draft} \longrightarrow \text{Pending Approval} \longrightarrow \text{Approved} \longrightarrow \text{Processed} \longrightarrow \text{Completed}$$
- **Atomic Ledger Synchronization**: Completed batches execute a single-transaction database RPC (`complete_payment_batch_atomic`), simultaneously updating batch status, payment line items, and underlying dividend/coupon payables with company authorization checks and full support for `admin`, `supervisor`, `finance_operator`, and `approver` roles.
- **Payment Reversal Workflow**: Reverts failed transfers with mandatory audit justification, automatically reopening underlying payables.

### 6. Automated Bank Statement Reconciliation

- **Statement Ingestion**: Ingests commercial bank clearing statements (`.xlsx` or `.csv`).
- **Strict Non-Ambiguous Matching**: Reconciles payments strictly using exact company, fiscal year, and amount matching. Ambiguous fuzzy guessing is completely rejected to preserve financial correctness.
- **Atomic Reconciliation Batch & Lot Reversal**: Applies batches via `apply_reconciliation_batch` and reverses entire lots in an atomic single transaction using `revert_reconciliation_lot_atomic`, resetting payables to Pending, updating payments, and preserving audit integrity.
- **Unclaimed Aging & Investor Protection Fund (IAF)**: Identifies dividends remaining unclaimed beyond the statutory 5-year limit and generates allocation manifests for transfer to the government IAF account.

### 7. AGM Studio & Corporate Governance

- **Book Closure Snapshot**: Freezes eligible shareholding rosters as of official record dates.
- **Attendee Check-In**: Supports barcode scanning and 16-digit BOID lookup for in-person shareholders.
- **Proxy Registration Engine**: Validates proxy submissions 48 hours prior to meetings, blocking duplicate proxies.
- **Live Quorum Monitor**: Calculates real-time attendance percentage against total issued capital to confirm statutory quorum.
- **Ballot Counting**: Tallies Ordinary (51%) and Special (75%) resolution votes.

### 8. Ingestion Pipeline & Multi-Sheet Excel Uploads

- **Reliable Tracking**: Tracks single and multi-sheet workbooks in `upload_history`. If tracking initialization fails, the sheet is aborted cleanly without creating orphaned rows.
- **Zero-Row Guard**: Rejects empty files or skipped imports immediately.
- **Validation Engine**: Performs pre-upload verification of BOID formatting, PAN validity, duplicate keys, and balance invariants.

### 9. Statutory Compliance & IRD e-TDS

- **Annex-10 e-TDS Return Generation**: Assembles statutory e-TDS returns pursuant to Sections 87 & 88 of the Nepal Income Tax Act 2058, generating both IRD-compliant Excel workbooks and JSON exports.
- **High-Volume 1,000-Chunk Pagination**: Fetches payables in 1,000-record chunks, preventing statement timeouts and memory ceilings across 50,000+ payee datasets.
- **Automated Payee Classification**: Maps retail investors (`PRIVATE`, `PUBLIC`) to `NATURAL_PERSON` while isolating institutional and tax-exempt funds.
- **Printable TDS Withholding Certificates**: Generates formal PDF TDS withholding certificates pursuant to Section 90 with QR/voucher references and company seal layouts.
- **Demographic Reports**: Generates distribution curves by province, district, investor category, and shareholding brackets.

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Web Browser                       │
│  - React 19 Single-Page App with Server-Side Rendering      │
│  - TanStack Router, TanStack Query, Radix UI & Tailwind CSS │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / REST / Realtime WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             Application Server (Nitro / Vite SSR)           │
│  - In-memory calculation engine (Dividend / Coupon / TDS)   │
│  - Excel Parser & Stream Transformer (xlsx)                 │
│  - Bank Clearing Generators (ConnectIPS / NEFT / RTGS)      │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
                │ Invocation (JWT Verified)   │ Supabase Client (PostgREST / JWT)
                ▼                             ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│   Deno Edge Runtime          │ │  PostgreSQL 15 (Supabase)  │
│  - process-import-chunk      │ │  - Row-Level Security (RLS)│
│  - JWT & Role Authentication │ │  - Strict Company Tenancy  │
│  - has_company_access check  │ │  - Check Invariants       │
│  - Parallel chunk ingestion  │ │  - Atomic Financial RPCs   │
│    (1,000 rows per batch)    │ │  - Immutable Audit Triggers│
└──────────────────────────────┘ └────────────────────────────┘
```

---

## Quick Start & Local Setup

### Prerequisites

- **Node.js**: v20.x or higher
- **npm**: v10.x or higher
- **Docker Desktop**: Running locally (for Supabase PostgreSQL container stack)
- **Supabase CLI**: Installed (`npm i -g supabase` or via Scoop/Brew)

### 1. Clone & Install Dependencies

```powershell
git clone https://github.com/sudeepdas12/RTARTS-SYSTEM.git
cd "RTARTS System"
npm install
```

### 2. Configure Environment Variables

Copy the template configuration:

```powershell
Copy-Item .env.example .env
```

Default local values:

```ini
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=your-local-publishable-key-from-supabase-status
SUPABASE_SERVICE_ROLE_KEY=your-local-service-role-key-from-supabase-status
```

### 3. Start Local Supabase Stack (Docker)

> **Important**: This project uses a **100% local Supabase instance** running inside Docker. It does not connect to hosted cloud infrastructure during local development.

```powershell
# Start local containers
supabase start

# Confirm running ports and keys
supabase status
```

Local service ports:

- **API / REST**: `http://127.0.0.1:54321`
- **Studio UI (Database Manager)**: `http://127.0.0.1:54323`
- **PostgreSQL Direct Connection**: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- **Mailpit (Local Email Testing)**: `http://127.0.0.1:54324`

### 4. Apply Database Migrations & Seed Data

```powershell
# Apply all timestamped migrations
supabase migration up

# Or perform a complete clean reset (applies all migrations + seed.sql)
supabase db reset
```

### 5. Start the Development Server

```powershell
npm run dev
```

Navigate to `http://localhost:8080` in your browser.

---

## Available NPM Scripts

| Command              | Purpose                                                                        |
| :------------------- | :----------------------------------------------------------------------------- |
| `npm run dev`        | Starts Vite development server on port 8080 with Hot Module Replacement (HMR). |
| `npm run build`      | Compiles application assets and generates production Nitro server bundle.      |
| `npm run preview`    | Runs the compiled production build locally.                                    |
| `npm test`           | Runs the Vitest test runner across all 26 test files (224 tests).              |
| `npm run test:ui`    | Starts the Vitest interactive visual testing UI in browser.                    |
| `npm run test:e2e`   | Runs Playwright end-to-end browser tests against application routes.           |
| `npm run check:edge` | Verifies Edge Function TypeScript typing with Deno.                            |
| `npm run lint`       | Executes ESLint analysis to verify code quality.                               |
| `npm run format`     | Automatically formats codebase using Prettier.                                 |

---

## Default Administrative Credentials & Security

During local setup and initial system deployment, the administrative superuser is seeded via `supabase/migrations/20261147000000_seed_initial_admin_users.sql`:

| Parameter             | Value                       | Security Notes                                                             |
| :-------------------- | :-------------------------- | :------------------------------------------------------------------------- |
| **Login Email**       | `admin@rbbmbl.com.np`       | Corporate domain restricted                                                |
| **Password**          | `Admin123!`                 | Strong password policy enforced (Min 8 chars, Upper, Lower, Digit, Symbol) |
| **Initial Role**      | `admin`                     | Global multi-company superuser privileges                                  |
| **Password Hashing**  | Argon2id / bcrypt           | Managed securely inside Supabase Auth GoTrue engine                        |
| **Brute-Force Guard** | Client + Edge Rate Limiting | IP and email-based exponential backoff with account lockout                |

> [!IMPORTANT]
> For production deployment, administrators must immediately rotate credentials via `/_authenticated/settings` and configure multi-factor authentication (MFA).

---

## Verification & Testing Suite

The repository contains an automated test suite verifying domain calculations, precision rounding, import chunking, live database RPCs, and full end-to-end user flows:

### Unit & Precision Testing

```powershell
npx vitest run
```

- **`calculators-precision.test.ts`**: Verifies exact paisa rounding without floating-point drift for cash dividends, debenture coupons, custom tax rates, negative rates, whole percentages (e.g. 15%), and >100% caps.
- **`cdsc-bonus.test.ts`**: Verifies CDSC bonus share entitlement, lock-in codes, 124-character CAS format, fractional cash conversion, and statutory tax-exempt entity detection (CIT, EPF, SSF, Mutual Funds).
- **`iaf-generator.test.ts`**: Validates 42-character control headers, 124-character IAF detail lines with 16-character zero-padded BOIDs, and 274-character IPF corporate action lines.
- **`ird-etds.test.ts`**: Validates Annex-10 e-TDS return generation, mathematical balance invariants, 1,000-chunk pagination, and PDF TDS withholding certificate generation.
- **`connectips.service.test.ts`**: Tests NCHL ConnectIPS export formatting, SHA-256 HMAC checksum integrity, and field length constraints.
- **`bank-parser.test.ts`**: Verifies multi-format commercial bank statement parsing, amount normalization, and transaction categorization.
- **`conversion.test.ts`**: Tests physical-to-demat share conversions, stock splits, debenture equity swaps, and promoter conversions.
- **`tax-rules.test.ts`**: Verifies statutory TDS withholding logic across all investor categories.
- **`bulk-ops.test.ts`**: Tests chunking algorithms and batch database operations.
- **`agm-studio.test.ts` & `agm-rpc-live.test.ts`**: Validates quorum calculations, proxy rules, ballot tallies, and live PostgreSQL stored procedures.

### End-to-End Browser Testing

```powershell
npm run test:e2e
```

- **`smoke.spec.ts`**: Verifies Playwright execution engine configuration.
- **`workflow.spec.ts`**: Validates:
  1. Unauthenticated route protection (redirecting protected routes to `/auth`).
  2. Branding and login validation controls.
  3. Rejection of invalid credentials.
  4. Authenticated admin login, session establishment, and module navigation.
  5. High-volume shareholder client directory rendering when "All Companies" is selected.

---

## Security & Access Control (RBAC)

The application implements granular Role-Based Access Control via PostgreSQL Row-Level Security:

| Role                         | Permissions                                                                                                             |
| :--------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| **`admin`**                  | Full system administration, role assignments, system settings, global company access, and user auditing.                |
| **`supervisor`**             | Checker authorization: approves payment batches, authorizes reversals, signs off reconciliations.                       |
| **`approver`**               | Dedicated workflow approver: authorizes payment batches and triggers atomic completion.                                 |
| **`finance_operator`**       | Maker authorization: uploads registers, creates payment batches, exports banking clearing files for assigned companies. |
| **`reconciliation_officer`** | Reconciliation operator: reconciles bank statements and manages lots for assigned companies.                            |
| **`auditor`**                | Read-only inspection of financial ledgers, immutable audit trails, and reconciliation statements.                       |
| **`user`**                   | Restricted view of explicitly assigned company shareholder rosters.                                                     |

### Company Tenancy Model

- **Strict Assignment**: Non-admin and non-supervisor users only have access to companies explicitly assigned to them in `user_company_access`.
- **Zero Cross-Company Leakage**: Bulk import RPCs, reconciliation processing, payment batch completion, share conversions, and Edge Function chunk processing strictly verify `has_company_access(user_id, company_id)`.
- **Immutable Logs**: Audit logs (`audit_logs`), approval records (`approval_logs`), and payment tracking (`payment_logs`) are protected by database triggers that enforce `user_id := auth.uid()` and server-side timestamps (`now()`), preventing client spoofing.

---

## Documentation & Runbooks

- **[RUNBOOK.md](RUNBOOK.md)**: Master operations runbook covering standard operating procedures (SOP), step-by-step operational playbooks, calculation formulas, incident recovery guides, and disaster recovery commands.
- **[supabase/migrations/](supabase/migrations/)**: Complete timestamped database migration history documenting all tables, RPCs, triggers, and RLS policies.

---

## License & Proprietary Notice

Copyright © 2026 **RBB Merchant Banking Limited**. All rights reserved.  
This software and associated documentation files are proprietary and confidential. Unauthorized copying, modification, distribution, or deployment of this software is strictly prohibited.
