# RTARTS System Master Operations Runbook

**RBB Merchant Banking Limited — RTS / RTARTS Management System**  
_Comprehensive Standard Operating Procedures (SOP), Technical Architecture, Operational Playbooks, Regulatory Workflows, and Incident Response Manual._

---

## Table of Contents

1. [System Architecture & Technical Anatomy](#1-system-architecture--technical-anatomy)
2. [Codebase & Directory Topology](#2-codebase--directory-topology)
3. [Configuration, Secrets & Environment Matrix](#3-configuration-secrets--environment-matrix)
4. [Database Architecture & Data Dictionary](#4-database-architecture--data-dictionary)
5. [Standard Operating Procedures (SOP)](#5-standard-operating-procedures-sop)
6. [Core Business Domain Playbooks](#6-core-business-domain-playbooks)
   - [Playbook 1: Excel Data Ingestion, Multi-Sheet Isolation & Validation Pipeline](#playbook-1-excel-data-ingestion-multi-sheet-isolation--validation-pipeline)
   - [Playbook 2: Dividend & Coupon Interest Calculations](#playbook-2-dividend--coupon-interest-calculations)
   - [Playbook 3: Payment Batch Lifecycle, Maker-Checker-Approver & Bank File Exports](#playbook-3-payment-batch-lifecycle-maker-checker-approver--bank-file-exports)
   - [Playbook 4: Payment Reversals & Exception Handling](#playbook-4-payment-reversals--exception-handling)
   - [Playbook 5: Bank Statement Reconciliation & IAF Fund Transfer](#playbook-5-bank-statement-reconciliation--iaf-fund-transfer)
   - [Playbook 6: AGM Studio, Attendance & Proxy Voting](#playbook-6-agm-studio-attendance--proxy-voting)
   - [Playbook 7: Statutory IRD e-TDS Compliance](#playbook-7-statutory-ird-e-tds-compliance)
   - [Playbook 8: Corporate Actions & Share Conversions (Atomic Restructuring)](#playbook-8-corporate-actions--share-conversions-atomic-restructuring)
   - [Playbook 9: CDSC Corporate Actions & Allotment File Generation (CAS/IAF/IPF/DRN)](#playbook-9-cdsc-corporate-actions--allotment-file-generation-casiafipfdrn)
7. [Incident Response & Troubleshooting Guides](#7-incident-response--troubleshooting-guides)
   - [IR-01: Upload Stuck in "Processing" State](#ir-01-upload-stuck-in-processing-state)
   - [IR-02: "Failed to create upload record" & Ingestion Aborts](#ir-02-failed-to-create-upload-record--ingestion-aborts)
   - [IR-03: Payable Balance Invariant Violation (`chk_div_balance_invariant`)](#ir-03-payable-balance-invariant-violation)
   - [IR-04: Edge Function ReferenceError & Deployment](#ir-04-edge-function-referenceerror--deployment)
   - [IR-05: Unauthorized / Permission Denied (42501) on RPC Calls](#ir-05-unauthorized--permission-denied-42501-on-rpc-calls)
   - [IR-06: Duplicate File Upload Blocked](#ir-06-duplicate-file-upload-blocked)
   - [IR-07: PostgreSQL Statement Timeout (57014) on Large Shareholder Datasets](#ir-07-postgresql-statement-timeout-57014-on-large-shareholder-datasets)
   - [IR-08: Upload History Schema Mismatches](#ir-08-upload-history-schema-mismatches)
   - [IR-09: Approver Payment Batch Authorization & Trigger Failures](#ir-09-approver-payment-batch-authorization--trigger-failures)
8. [Security, RBAC & Audit Procedures](#8-security-rbac--audit-procedures)
9. [Testing, Quality Assurance & Verification Suite](#9-testing-quality-assurance--verification-suite)
10. [Backup, Disaster Recovery & Maintenance](#10-backup-disaster-recovery--maintenance)

---

## 1. System Architecture & Technical Anatomy

The RTARTS platform is an enterprise-grade Registrar and Transfer Agent (RTA) solution engineered for merchant banks to administer shareholder registers, process corporate actions, execute mass dividend/interest distributions, perform bank reconciliations, and fulfill statutory compliance under Nepalese company and tax laws.

```mermaid
graph TB
    subgraph "Client Tier"
        Browser["User Browser (Single Page App / SSR Client)"]
    end

    subgraph "Application Server (Nitro / Node.js Runtime)"
        Router["TanStack Start / TanStack Router"]
        CalcEngine["In-Memory Calculation Engine (Dividend/Coupon/Tax)"]
        ExcelParser["Excel Parser & Stream Transformer (xlsx)"]
        FileGen["Bank Settlement Generators (ConnectIPS / NEFT / RTGS)"]
        ConvEngine["Corporate Restructuring & Share Conversion Engine"]
    end

    subgraph "Supabase / PostgreSQL Data Tier (Local Docker)"
        Postgres[(PostgreSQL 15 Database)]
        RLS["Row-Level Security (RLS) Engine"]
        AtomicRPC["Atomic Financial Stored Procedures (PL/pgSQL)"]
        AuthService["Supabase Auth (GoTrue JWT)"]
        AuditLog["Immutable Audit Trail (audit_logs)"]
    end

    subgraph "Edge Compute Runtime (Deno)"
        EdgeFn["process-import-chunk (Background Chunk Ingestion)"]
    end

    subgraph "External Banking & Regulatory Rails"
        ConnectIPS["NCHL ConnectIPS Clearing Rail"]
        BankCore["Commercial Bank Core Banking Systems (CBS)"]
        CDSC["CDSC Demat Central Depository"]
        IRD["Inland Revenue Department (IRD e-TDS)"]
    end

    Browser <-->|HTTPS / REST / WebSocket| Router
    Router <-->|supabase-js / JWT| RLS
    RLS <--> Postgres
    Postgres <--> AtomicRPC
    Router -.->|Direct Edge Invocation| EdgeFn
    EdgeFn <-->|Service Role Key (Bypass RLS)| Postgres
    FileGen -.->|CSV / XLSX| ConnectIPS
    FileGen -.->|Excel / Flat| BankCore
    Router -.->|CDSC Allotment Format| CDSC
    Router -.->|Annex 8 / 10 Reports| IRD
```

### Key Technical Specifications

- **Frontend Framework**: React 19, TypeScript, TanStack Start, TanStack Router (`@tanstack/react-router`), TanStack Query (`@tanstack/react-query`).
- **UI & Styling**: Tailwind CSS v4, Radix UI primitives, Lucide React icons, Sonner toast engine.
- **Backend / Database**: Supabase PostgreSQL 15, PostgREST, GoTrue Auth, Realtime WebSocket pub/sub.
- **Server Runtime**: Nitro server engine with SSR and client hydration.
- **Edge Functions**: Deno TypeScript runtime executing parallel chunk ingestion with zero cold-start footprint.
- **Testing & Quality Assurance**: Vitest test runner (26 test files, 224 unit/precision/live tests), Playwright E2E browser test suite (6 tests), ESLint v9, Prettier.

---

## 2. Codebase & Directory Topology

```
e:\RTARTS System
├── src/
│   ├── components/                # Reusable UI component library
│   │   ├── agm/                   # AGM Studio attendee, voting, and report cards
│   │   ├── auth/                  # Authentication forms and session guards
│   │   ├── layout/                # App layout, navigation sidebar, and topbar
│   │   ├── payments/              # Payment batch drawers, item lists, export modals
│   │   ├── ui/                    # Base Radix + Tailwind UI components
│   │   └── upload/                # Drag-and-drop zone, column mapper, validation report
│   ├── hooks/                     # Custom React hooks (useAuth, useRole, useToast)
│   ├── integrations/
│   │   └── supabase/              # Supabase browser and SSR client configurations
│   ├── lib/
│   │   ├── calculations/          # Precision dividend, debenture, and TDS calculators
│   │   ├── engines/               # Ingestion chunking engine, file parsers, validator
│   │   ├── services/              # Business domain services (payments, reports, recon)
│   │   └── types/                 # Domain models, enums, database schema types
│   └── routes/                    # File-based routing tree (TanStack Router)
│       ├── _authenticated/        # Role-guarded application screens
│       │   ├── dashboard.tsx      # Executive metrics, charts, activity feed
│       │   ├── clients.tsx        # Shareholder master register (high-volume paginated)
│       │   ├── dividend.tsx       # Cash and stock dividend entitlement registry
│       │   ├── interest.tsx       # Debenture periodic coupon payables
│       │   ├── mutual-fund.tsx    # Scheme dividend distribution
│       │   ├── payments.tsx       # Batch lifecycle, bank file exports, reversals
│       │   ├── reconciliation.tsx # Automated statement matching and lot management
│       │   ├── allocations.tsx    # Corporate action conversions and fractional claims
│       │   ├── agm-studio.tsx     # AGM roster, attendance barcode check-in, voting
│       │   ├── reports.tsx        # Regulatory IRD e-TDS, demographic, unclaimed aging
│       │   ├── upload.tsx         # Excel upload engine (single & multi-sheet)
│       │   └── users.tsx          # User management, role assignments, company access
│       └── auth.tsx               # Login, MFA, and password recovery portal
├── supabase/
│   ├── functions/
│   │   └── process-import-chunk/  # Deno Edge Function for background bulk ingestion
│   └── migrations/                # Timestamped declarative schema migrations
├── e2e/                           # Playwright end-to-end browser tests
└── vitest.config.ts               # Unit test runner configuration
```

---

## 3. Configuration, Secrets & Environment Matrix

The system operates strictly against a **100% local Supabase instance** running in Docker during development.

### Environment Variable Matrix (`.env`)

| Variable                        | Scope         | Description                                    | Sample Local Value            |
| :------------------------------ | :------------ | :--------------------------------------------- | :---------------------------- |
| `VITE_SUPABASE_URL`             | Browser       | Local Supabase API gateway URL                 | `http://127.0.0.1:54321`      |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser       | Anon public API key                            | `your-local-publishable-key`  |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server / Edge | Secret admin key (bypasses RLS)                | `your-local-service-role-key` |
| `VITE_RTS_API_URL`              | Optional      | Integration endpoint for external core banking | `""`                          |
| `VITE_RTS_API_KEY`              | Optional      | API secret for bank integration                | `""`                          |

> [!CAUTION]
> **Never commit `.env` files or expose the `SUPABASE_SERVICE_ROLE_KEY` in client-side code.** Any reference with the `VITE_` prefix will be bundled into client JavaScript and exposed to end users.

---

## 4. Database Architecture & Data Dictionary

The PostgreSQL database maintains strict referential integrity, decimal precision, and auditability.

```mermaid
erDiagram
    COMPANIES ||--o{ CLIENTS : "issues shares to"
    COMPANIES ||--o{ PAYMENT_BATCHES : "funds"
    CLIENTS ||--o{ DIVIDEND_PAYABLES : "receives"
    CLIENTS ||--o{ INTEREST_PAYABLES : "receives"
    CLIENTS ||--o{ MUTUAL_FUND_PAYABLES : "receives"
    PAYMENT_BATCHES ||--o{ PAYMENTS : "contains"
    DIVIDEND_PAYABLES ||--o{ PAYMENTS : "settled by"
    INTEREST_PAYABLES ||--o{ PAYMENTS : "settled by"
    MUTUAL_FUND_PAYABLES ||--o{ PAYMENTS : "settled by"
    PAYMENTS ||--o{ PAYMENT_LOGS : "audit trail"
    UPLOAD_HISTORY ||--o{ UPLOAD_ERRORS : "logs errors"
```

### Core Table Dictionary

#### `companies`

- `id` (`uuid`, PK): Unique identifier.
- `company_code` (`text`, Unique): Short stock ticker (e.g. `RBBL`, `NABIL`).
- `company_name` (`text`): Full registered legal entity name.
- `isin` (`text`): 12-character International Securities Identification Number.

#### `clients`

- `id` (`uuid`, PK): Shareholder record identifier.
- `company_id` (`uuid`, FK): Issuing company.
- `boid` (`text`): 16-digit Demat Account number (`1301...`).
- `full_name` (`text`): Beneficiary legal name.
- `kitta` (`numeric(15,2)`): Current shareholding balance.
- `holder_type` (`text`): Classification (`Public`, `Promoter`, `Institutional`, `Physical Folio`).
- `pan_no` (`text`): 9-digit Inland Revenue Department Permanent Account Number.
- `bank_name` / `bank_account_no` (`text`): Primary bank payout account.

#### `dividend_payables`

- `id` (`uuid`, PK): Entitlement line item.
- `company_id` (`uuid`, FK) / `client_id` (`uuid`, FK).
- `fiscal_year` (`text`): Nepalese fiscal year (e.g. `2080/81`).
- `shares_held` (`numeric(15,2)`): Eligibility balance at book closure.
- `dividend_rate` (`numeric(8,4)`): Declared dividend percentage.
- `gross_dividend` (`numeric(15,2)`): Gross dividend entitlement.
- `tax_amount` (`numeric(15,2)`): Statutory TDS deducted.
- `net_payable` (`numeric(15,2)`): Disbursable amount (`gross - tax`).
- `payment_status` (`payment_status` enum): `Pending`, `Approved`, `Processing`, `Paid`, `Failed`, `Returned`, `Transferred_To_IAF`.

#### `payment_batches`

- `id` (`uuid`, PK): Batch identifier.
- `batch_name` (`text`): Human-readable batch title.
- `status` (`batch_status` enum): `Draft`, `Pending Approval`, `Approved`, `Processing`, `Completed`, `Rejected`, `Reversed`.
- `approved_by` (`uuid`, FK): Checker user identifier.
- `total_amount` / `total_payments` (`numeric`): Verification aggregates.

#### `audit_logs`

- `id` (`uuid`, PK): Immutable log record.
- `user_id` (`uuid`): Actor identifier automatically forced by trigger to `auth.uid()`.
- `action` (`text`): Operation performed (`INSERT`, `UPDATE`, `COMPLETE_BATCH`, `REVERSAL`).
- `table_name` (`text`): Modified table.
- `record_id` (`text`): Primary key of the modified row.
- `created_at` (`timestamptz`): Automatic timestamp forced to `now()`.

---

## 5. Standard Operating Procedures (SOP)

### SOP 1: User Provisioning & Company Access Assignment

1. Log in as an `admin` user.
2. Navigate to `/_authenticated/users`.
3. Click **Invite / Create User**: Enter email, temporary password, and system role (`admin`, `supervisor`, `finance_operator`, `approver`, `reconciliation_officer`, `auditor`, `user`).
4. **Assign Company Scopes**: Under **Company Access**, assign the operator to their authorized client companies.
5. Operators without explicit assignments cannot view or modify shareholder registers.

### SOP 2: Book Closure Roster Import & Verification

1. Obtain the official CDSC beneficial ownership report (`.xlsx` or `.csv`).
2. Navigate to `/_authenticated/upload`.
3. Select Company, Target Table (`clients` or `dividend_payables`), and Fiscal Year.
4. Upload file and review the automatic column mapping.
5. Review the validation drawer: resolve unmapped columns or invariant errors.
6. Click **Confirm & Ingest**. The engine validates rows and executes background ingestion.

---

## 6. Core Business Domain Playbooks

### Playbook 1: Excel Data Ingestion, Multi-Sheet Isolation & Validation Pipeline

```mermaid
graph TD
    Upload[User Drops Excel Workbook] --> Detect[Inspect Sheets & Auto-Detect Types]
    Detect --> Choice{Single or Multi-Sheet?}
    Choice -->|Single| MapCols[Column Mapping Verification]
    Choice -->|Multi-Sheet| SheetLoop[Iterate Sheets Sequentially]
    SheetLoop --> TrackRec[Create upload_history Record]
    TrackRec -->|Failure| AbortSheet[Abort Sheet & Alert Operator]
    TrackRec -->|Success| Validate[Pre-Validation Engine]
    Validate --> InvariantCheck[Verify Net = Gross - Tax]
    InvariantCheck --> ZeroCheck{Success Rows > 0?}
    ZeroCheck -->|No| Reject[Reject Zero-Row Import]
    ZeroCheck -->|Yes| Ingest[Execute ImportEngine / Edge Chunking]
    Ingest --> NextSheet[Proceed to Next Sheet]
```

#### Multi-Sheet Handling Rules

- Multi-sheet workbooks allow uploading multiple shareholder lists or payable categories in a single file.
- Each sheet must successfully establish an independent tracking record in `upload_history`. If tracking creation fails, the sheet is **immediately aborted** to prevent untracked orphaned rows.
- Imports resulting in 0 inserted rows are strictly rejected.

---

### Playbook 2: Dividend & Coupon Interest Calculations

#### 1. Cash Dividend Precision Formula

$$\text{Gross Cash} = \text{Shares Held} \times \text{Face Value (NPR 100)} \times \frac{\text{Cash Dividend \%}}{100}$$
$$\text{Tax Amount} = \text{Gross Cash} \times \frac{\text{TDS Rate \%}}{100}$$
$$\text{Net Payable} = \text{Gross Cash} - \text{Tax Amount}$$

_Amounts are rounded to 2 decimal places (paisa precision). The database enforces `abs(gross - tax - net) <= 0.05`._

#### 2. Debenture Coupon Calculations

- **Actual/365 Convention**:
  $$\text{Coupon} = \text{Principal} \times \text{Coupon Rate} \times \frac{\text{Days Accrued}}{365}$$
- **ISDA 30/360 Convention**:
  $$\text{Days} = 360 \times (Y_2 - Y_1) + 30 \times (M_2 - M_1) + (D_2 - D_1)$$
  _Adjusts February month-end to 30 days._

---

### Playbook 3: Payment Batch Lifecycle, Maker-Checker-Approver & Bank File Exports

```mermaid
stateDiagram-v2
    [*] --> Draft : Maker (finance_operator) creates batch
    Draft --> Pending_Approval : Maker submits batch
    Pending_Approval --> Approved : Checker (supervisor) verifies batch
    Approved --> Processed : Bank file exported (ConnectIPS/NEFT)
    Processed --> Completed : Approver/Supervisor authorizes completion
    Completed --> [*]

    Pending_Approval --> Draft : Rejected by Checker
    Approved --> Reversed : Reversal authorized with audit justification
    Reversed --> [*]
```

#### Multi-Tier Workflow

1. **Maker (`finance_operator`)**: Filters payables by company and fiscal year, selects disbursement method (ConnectIPS, NEFT, RTGS), and creates batch in `Draft`.
2. **Checker (`supervisor`)**: Reviews total payments, tax withheld, and beneficiary accounts. Approves batch into `Approved`.
3. **Export**: Bank clearing files are generated:
   - **ConnectIPS CSV**: Formatted with 16-digit account numbers, NCHL bank codes, and paisa-denominated amounts.
   - **Bank CBS Excel**: Formatted with standard beneficiary payout columns.
4. **Approver (`approver` / `supervisor`)**: Authorizes batch completion after bank confirmation.
5. **Atomic Execution**: The database trigger calls `complete_payment_batch_atomic(batch_id, user_id)`, which:
   - Locks the batch with `FOR UPDATE`.
   - Verifies company access permissions.
   - Updates batch status to `Completed`.
   - Updates all child `payments` to `Completed`.
   - Updates underlying `dividend_payables`, `interest_payables`, or `mutual_fund_payables` to `Paid`.
   - Writes an immutable audit log entry.

---

### Playbook 4: Payment Reversals & Exception Handling

If a commercial bank or ConnectIPS returns failed payouts:

1. Navigate to `/_authenticated/payments`.
2. Open the affected batch and click **Reverse Payment**.
3. Select specific failed transactions or the entire batch.
4. Enter mandatory reason (e.g. `Account closed`, `Invalid beneficiary name`).
5. Authorize with supervisor credentials.
6. The system sets payment status to `Failed` / `Reversed` and reopens the underlying payables to `Pending`.

---

### Playbook 5: Bank Statement Reconciliation & IAF Fund Transfer

```mermaid
graph LR
    Stmt[Bank Clearing Statement] --> UploadStmt[Upload Excel/CSV]
    UploadStmt --> ExactMatch[Strict Exact Matching: Company + FY + Amount]
    ExactMatch --> Review[Reconciliation Review Table]
    Review --> ApplyBatch[apply_reconciliation_batch Atomic RPC]
    ApplyBatch --> RevertOption{Reversal Needed?}
    RevertOption -->|Yes| AtomicRevert[revert_reconciliation_lot_atomic RPC]
    RevertOption -->|No| Complete[Ledger Synchronized]
```

#### Strict Reconciliation Rules

- Matching strictly requires identical company, fiscal year, and net amount ($\pm\text{NPR } 0.01$).
- Unmatched records are flagged with clear errors; ambiguous guessing or arbitrary fallback is strictly prohibited.
- Reversals are executed via `revert_reconciliation_lot_atomic`, atomically resetting payables to `Pending` and removing tracking lots.

#### Investor Protection Fund (IAF) Allocation

- Unclaimed dividends $> 5$ years are flagged for transfer to the government IAF under Nepalese Company Act provisions.
- Generates statutory transfer manifests for SEBON and the Office of the Company Registrar.

---

### Playbook 6: AGM Studio, Attendance & Proxy Voting

1. **Book Closure Freeze**: Shareholder roster is frozen on the official record date.
2. **Attendance Check-In**: Supports 16-digit BOID lookup, barcode scanner, and physical certificate folios.
3. **Proxy Verification**: Validates proxy forms submitted 48 hours prior to meeting; prevents duplicate proxy assignments.
4. **Real-time Quorum Calculation**:
   $$\text{Quorum \%} = \frac{\text{Attending Shares (In-Person + Valid Proxies)}}{\text{Total Issued Capital}} \times 100$$
5. **Resolution Voting**: Tallies Ordinary (51%) and Special (75%) resolutions.

---

### Playbook 7: Statutory IRD e-TDS Compliance

The system compiles comprehensive e-TDS statements in compliance with Sections 87, 88 & 90 of the Nepal Income Tax Act 2058:

1. **Annex-10 e-TDS Return Generation**:
   - Navigate to `/_authenticated/reports` $\rightarrow$ **Tax Withholding (e-TDS)**.
   - Filter by Company, Fiscal Year, and Income Head (`DIVIDEND`, `INTEREST`, or `ALL`).
   - **1,000-Chunk Safe Pagination**: Payables are extracted in paginated 1,000-row chunks using `.range(from, from + 999)`, guaranteeing stability against server memory limits on registers exceeding 50,000 investors.
   - **Classification Engine**: Normalizes retail holders (`PRIVATE`, `PUBLIC`, `PROMOTER`, `LOCAL`) to `NATURAL_PERSON`, and recognizes institutional and tax-exempt payees.
   - **Validation Guard**: Runs `assertReportInvariants` ensuring $\sum \text{Gross} - \sum \text{TDS} = \sum \text{Net} \quad (\pm\text{NPR } 0.50)$.
2. **Export Options**:
   - **Excel Spreadsheet**: Formatted with standard IRD columns (PAN, Full Name, BOID, Payment Head, Gross, Rate, Tax, Net, Voucher Ref).
   - **JSON File**: Formatted for direct upload into the IRD Integrated Tax System (ITS) portal.
3. **Printable TDS Certificates (Section 90)**:
   - Generates formal PDF TDS Withholding Certificates using `generateTdsCertificatePdf`, including company tax PAN, fiscal year, shareholder details, gross dividend/interest breakdown, and authorized signatory credentials.

---

### Playbook 8: Corporate Actions & Share Conversions (Atomic Restructuring)

```mermaid
graph TD
    SelectComp[Select Company & Fiscal Year] --> SelectType[Select Conversion Type]
    SelectType --> InputParams[Enter Restructuring Parameters]
    InputParams --> Simulate[Simulate Conversion & Preview Balances]
    Simulate --> Commit[Commit Conversion via apply_share_conversion_atomic]
    Commit --> DB[Atomically Updates Clients & Inserts Fractional Payables]
```

#### 5 Conversion Workflows

1. **Promoter to Public Conversion**:
   - Adjusts Promoter shares (Lock-in 01) to Ordinary Public shares (Lock-in 00) based on approved conversion percentage (e.g. to reach 51:49).
2. **Debenture to Equity Conversion**:
   - Converts matured debenture principal into ordinary shares at the approved conversion price.
3. **Merger & Acquisition Swap**:
   - Computes exchange ratios (e.g. 100:85) and generates replacement ordinary shares.
4. **Stock Split / Consolidation**:
   - Sub-divides share face value (e.g. NPR 100 to NPR 10), multiplying shareholder holdings proportionately.
5. **Physical-to-DEMAT Conversion (DRN)**:
   - Discovers physical holdings or un-dematted clients and converts folios into Demat ordinary shares.

#### Atomic Execution (`apply_share_conversion_atomic`)

- Validates operator role and company authorization.
- Atomically updates client shareholding and holder type.
- Inserts fractional cash balances into `dividend_payables`.
- Writes immutable audit entry to `audit_logs`.

---

### Playbook 9: CDSC Corporate Actions & Allotment File Generation (CAS/IAF/IPF/DRN)

Implements official CDSC (Central Depository Services and Clearing Ltd.) corporate action and allotment specifications:

```mermaid
graph TD
    Holdings[Fetch Shareholder Register] --> BonusCalc[Calculate Bonus Entitlement]
    BonusCalc --> Whole[Whole Shares Credited to Demat]
    BonusCalc --> Remainder[Fractional Share Remainder]
    Remainder --> CashPayout[Fractional Cash Payout at Face Value]
    Whole --> BonusTax[5% Tax on Credited Shares]
    Remainder --> FracTax[5% Tax on Fractional Cash]
    ExemptCheck{Is Holder Tax-Exempt?}
    ExemptCheck -->|Yes: Mutual Funds / CIT / EPF / SSF| ZeroTax[Apply 0.0% TDS]
    ExemptCheck -->|No: Retail / Corporate| StdTax[Apply 5.0% TDS]
    StdTax --> GenFiles[Generate CDSC Files]
    ZeroTax --> GenFiles
    GenFiles --> IAF[IAF Text File: 42-char Header + 124-char Detail Lines]
    GenFiles --> IPF[IPF Text File: 58-char Header + 274-char Detail Lines]
    GenFiles --> CAS[CAS Allotment Excel Sheet]
```

#### 1. CDSC Bonus Share Mathematics

- **Credited Bonus Kitta**: $\lfloor \text{Existing Kitta} \times \text{Bonus Ratio} \rfloor$
- **Fractional Kitta**: $(\text{Existing Kitta} \times \text{Bonus Ratio}) - \text{Credited Bonus Kitta}$
- **Bonus Share Tax Payable**: $\text{Credited Kitta} \times \text{Face Value} \times \text{Tax Rate}$
- **Fractional Cash Payable**: $(\text{Fractional Kitta} \times \text{Face Value}) \times (1 - \text{Tax Rate})$
- **Statutory Tax Exemption**: Section 10 exempt entities (`payee_classification = 'TAX_EXEMPT'`, Mutual Funds, Citizen Investment Trust, Employees Provident Fund, Social Security Fund) are assessed at **0.0% tax**.

#### 2. Fixed-Width CDSC File Formats

- **IAF (Initial Allotment File)**:
  - **Header (42 chars)**: Total Records (10 digits) + Total Allotted Qty (16 digits, 3 decimals) + Total Lock-in Qty (16 digits, 3 decimals).
  - **Detail Lines (124 chars strictly)**:
    - BOID: 16 digits (strictly zero-padded: `.padStart(16, "0")`).
    - Current Quantity: 16 chars (`000000000100.000`).
    - Lock-In Quantity: 16 chars (`000000000000.000`).
    - Lock-in Reason Code: 2 chars (`00` Free Public, `01` Promoter, `02` Staff, `09` Local Affected).
    - Lock-in Reason: 50 chars space-padded.
    - Expiry Date: 8 chars (`DDMMYYYY` or `00000000`).
    - RTA Internal Ref No: 16 chars space-padded.
- **IPF (Corporate Action Allotment File)**:
  - **Header (58 chars)**: Record Count + Total Debit Qty + Total Debit Frozen + Total Credit Qty.
  - **Detail Lines (274 chars strictly)**: Contains dual 16-char BOID, 16-char RTA Ref, 12-char Debit ISIN, 16-char Debit Quantities, Lock-in data, Credit/Debit flags (`C`/`D`), and Credit ISIN + Quantities.
- **DRN Dematerialization**:
  - Validates physical folios against un-dematted records.
  - Generates Demat credit schedules for transfer into CDSC depository.

---

## 7. Incident Response & Troubleshooting Guides

### Incident Matrix

| Symptom                               | Severity      | Probable Root Cause                                       | Resolution Playbook                                                              |
| :------------------------------------ | :------------ | :-------------------------------------------------------- | :------------------------------------------------------------------------------- |
| Upload stuck in `Processing`          | P2 (High)     | Disconnected client chunk upload                          | [IR-01](#ir-01-upload-stuck-in-processing-state)                                 |
| `Failed to create upload record`      | P1 (Critical) | Stopped Supabase pooler, expired session, or missing role | [IR-02](#ir-02-failed-to-create-upload-record--ingestion-aborts)                 |
| `chk_div_balance_invariant` error     | P2 (High)     | Discrepancy between gross, tax, and net                   | [IR-03](#ir-03-payable-balance-invariant-violation)                              |
| Edge Function ReferenceError          | P1 (Critical) | Outdated function code                                    | [IR-04](#ir-04-edge-function-referenceerror--deployment)                         |
| Permission Denied `42501` on RPC      | P1 (Critical) | Unauthenticated or missing company access                 | [IR-05](#ir-05-unauthorized--permission-denied-42501-on-rpc-calls)               |
| Duplicate File Upload Blocked         | P3 (Medium)   | Identical file hash already uploaded                      | [IR-06](#ir-06-duplicate-file-upload-blocked)                                    |
| PostgreSQL Timeout `57014` on Clients | P1 (Critical) | Unindexed scan across 70,000+ rows                        | [IR-07](#ir-07-postgresql-statement-timeout-57014-on-large-shareholder-datasets) |
| Column mismatch in Upload History     | P2 (High)     | Querying nonexistent columns                              | [IR-08](#ir-08-upload-history-schema-mismatches)                                 |
| Approver batch completion rejected    | P1 (Critical) | Missing `approver` role in RPC                            | [IR-09](#ir-09-approver-payment-batch-authorization--trigger-failures)           |

---

### IR-01: Upload Stuck in "Processing" State

- **Diagnosis**:
  ```sql
  SELECT id, file_name, total_rows, success_rows, error_rows, status
  FROM public.upload_history WHERE status = 'Processing';
  ```
- **Remedy**: If actual inserted payables match `total_rows`, update status to `Completed`. If partial, delete inserted payables and mark upload `Failed`.

---

### IR-02: "Failed to create upload record" & Ingestion Aborts

**Severity**: P1 (Critical) — upload pipeline is completely blocked.

#### Symptoms

The upload page shows a red toast: `"Failed to create upload record: <detail>"` immediately after clicking **Confirm & Ingest**. No rows are inserted.

#### Root Causes (in order of likelihood)

| #   | Root Cause                                  | Detail                                                                                                                                                                                                                     |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Supabase pooler service stopped**         | The most common cause. Supabase's connection pooler (`supabase_pooler_*`) stops after a system restart or Docker hiccup, cutting PostgREST off from the database. The Supabase DB itself stays up but REST API calls fail. |
| 2   | **Session expired / no authenticated user** | `supabase.auth.getUser()` returns no user — JWT has expired and not refreshed. The RLS `uh_write` policy requires an authenticated session.                                                                                |
| 3   | **User missing required role**              | User does not have `admin`, `supervisor`, or `finance_operator` role in `user_roles`.                                                                                                                                      |
| 4   | **Schema cache stale (PGRST204)**           | PostgREST schema cache hasn't refreshed after a recent migration. Manifests as `"Could not find the 'X' column"` in the error detail.                                                                                      |

#### Diagnosis

**Step 1 — Read the full toast message.** The error toast now shows the actual underlying message (e.g., `"connection refused"`, `"JWT expired"`, `"new row violates row-level security policy"`). This tells you which cause applies.

**Step 2 — Check Supabase service health:**

```powershell
npx supabase status
```

Look for `Stopped services:` in the output. If `supabase_pooler_*` or `supabase_edge_runtime_*` is listed as stopped, proceed to Remedy #1.

**Step 3 — Test connectivity directly:**

```powershell
# Should return HTTP 200 and a JSON array
Invoke-RestMethod -Uri "http://127.0.0.1:54321/rest/v1/upload_history?limit=1" `
  -Headers @{ "apikey" = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"; "Authorization" = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0" }
```

If this fails, Supabase REST is down.

#### Remedies

**Remedy 1 — Full Supabase restart (fixes stopped pooler / stale schema cache):**

```powershell
# WARNING: --no-backup wipes all local data. Use only in development.
# For a safe restart that preserves data, omit --no-backup:
npx supabase stop
npx supabase start
```

> [!WARNING]
> `npx supabase stop --no-backup` **deletes all local database data** and re-seeds from migrations. Use the plain `npx supabase stop` (which backs up) unless you intentionally want a clean slate.

After restart, verify all services are running:

```powershell
npx supabase status
# Confirm NO "Stopped services:" line in output
```

**Remedy 2 — Session expired:** Log out and log back in. The Supabase client auto-refreshes tokens, but if the browser tab was idle overnight the session may be fully expired. Refresh the page and re-authenticate.

**Remedy 3 — Missing role:** As admin, go to `/_authenticated/users`, open the user, and assign `finance_operator` or `supervisor` role.

**Remedy 4 — Stale schema cache only (no data loss):** Restart just the PostgREST container:

```powershell
# Find the container name
docker ps --filter "name=supabase_rest"
# Restart it
docker restart <container_name>
```

#### Prevention

- Before an upload session, run `npx supabase status` and confirm no services are stopped.
- After any OS reboot or Docker Desktop restart, always run `npx supabase start` before opening the app.
- The upload page error toast now shows the **actual error detail** — always read the full message before escalating.

#### Code Reference

- Error thrown from: [`src/lib/services/upload.service.ts`](src/lib/services/upload.service.ts) — `createUploadRecord()` — PostgREST `INSERT` into `upload_history`.
- Caught and surfaced in: [`src/routes/_authenticated/upload.tsx`](src/routes/_authenticated/upload.tsx) — `handleImport()` try/catch block.
- RLS policy governing INSERT: migration `20261148000000_fix_upload_rls_and_edge_timeout.sql` — `uh_write` policy (`FOR INSERT TO authenticated WITH CHECK (true)`).

---

### IR-03: Payable Balance Invariant Violation

- **Diagnosis**: Ingestion aborted due to `chk_div_balance_invariant`.
- **Remedy**: Inspect `upload_errors` for row number. Recompute net figure using `Net = Gross - Tax` or select the automated pre-calculation option on upload.

---

### IR-04: Edge Function ReferenceError & Deployment

- **Diagnosis**: Deno edge runtime returns 500 error on bulk chunk import.
- **Remedy**: Deploy latest version:
  ```powershell
  supabase functions deploy process-import-chunk --no-verify-jwt
  ```

---

### IR-05: Unauthorized / Permission Denied (42501) on RPC Calls

- **Diagnosis**: Anonymous or unassigned caller attempting to execute sensitive RPCs.
- **Remedy**: Ensure request contains valid authenticated JWT and user has company assignment in `user_company_access`.

---

### IR-06: Duplicate File Upload Blocked

- **Diagnosis**: Identical file hash exists in `upload_history`.
- **Remedy**: If previous import was invalid, roll back previous upload from **Upload History** before re-importing.

---

### IR-07: PostgreSQL Statement Timeout (57014) on Large Shareholder Datasets

- **Diagnosis**: Fetching clients with "All Companies" selected returns HTTP 500 / statement timeout on 70,000+ rows.
- **Root Cause**: Per-row evaluation of PL/pgSQL authorization functions.
- **Remedy**: Verify migration `20261168000000` is applied:
  - Statement-level authorization resolution.
  - `has_company_access` inlined as `LANGUAGE sql STABLE`.
  - B-tree composite index `idx_clients_company_created_at`.
  - Benchmarks reduce query latency to **<370ms**.

---

### IR-08: Upload History Schema Mismatches

- **Diagnosis**: Query to `upload_history` fails with `column upload_history.rows_processed does not exist`.
- **Remedy**: Ensure `report.service.ts` queries `id, file_name, file_type, status, total_rows, success_rows, error_rows, created_at` matching the database schema.

---

### IR-09: Approver Payment Batch Authorization & Trigger Failures

- **Diagnosis**: Payment batch fails to complete when approved by an approver user.
- **Root Cause**: `complete_payment_batch_atomic` omitted `approver` from `require_role`.
- **Remedy**: Verify migration `20261169000000` is applied, allowing `admin`, `supervisor`, `finance_operator`, and `approver`.

---

## 8. Security, RBAC & Audit Procedures

### Centralized Route-Level Access Control (`src/routes/_authenticated/route.tsx`)

All authenticated routes enforce centralized role boundaries at beforeLoad:

| Route Path               | Allowed Roles                                                                                                                  | Description                                       |
| :----------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------ |
| `/users`                 | `admin`                                                                                                                        | User management, role assignments, company access |
| `/settings`              | `admin`                                                                                                                        | System configuration, database parameters         |
| `/settings/fiscal-years` | `admin`, `supervisor`                                                                                                          | Fiscal year lifecycle and period locking          |
| `/data-management`       | `admin`, `supervisor`                                                                                                          | Bulk deletion, purge utilities                    |
| `/approvals`             | `admin`, `supervisor`, `approver`, `checker`                                                                                   | Maker-checker-approver action queue               |
| `/allocations`           | `admin`, `supervisor`, `finance_operator`, `operator`, `maker`                                                                 | Share conversion and fractional distributions     |
| `/classification-review` | `admin`, `supervisor`, `checker`, `approver`, `operator`                                                                       | Tax entity classification overrides               |
| `/audit-logs`            | `admin`, `auditor`, `supervisor`                                                                                               | Immutable audit trail viewer                      |
| `/payments`              | `admin`, `supervisor`, `finance_operator`, `maker`, `checker`, `approver`, `read_only`                                         | Batch payment management and ConnectIPS           |
| `/reports`               | `admin`, `supervisor`, `report_viewer`, `auditor`, `finance_operator`, `read_only`, `maker`, `operator`, `checker`, `approver` | Financial & IRD statutory report generation       |
| `/clients`               | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `read_only`                                                 | Shareholder directory & Demat lookup              |
| `/companies`             | `admin`, `supervisor`, `operator`, `read_only`                                                                                 | Client company management                         |
| `/dividend`              | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `finance_operator`, `read_only`                             | Cash & bonus dividend registers                   |
| `/interest`              | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `finance_operator`, `read_only`                             | Debenture coupon payment register                 |
| `/mutual-fund`           | `admin`, `supervisor`, `operator`, `maker`, `checker`, `approver`, `finance_operator`, `read_only`                             | Scheme distribution register                      |
| `/reconciliation`        | `admin`, `supervisor`, `reconciliation_officer`, `finance_operator`                                                            | Statement matching & lot reversions               |
| `/upload`                | `admin`, `supervisor`, `operator`, `maker`                                                                                     | Single & multi-sheet Excel ingestion              |
| `/upload-history`        | `admin`, `supervisor`, `operator`, `maker`, `auditor`                                                                          | Ingestion history and rollback                    |
| `/analytics`             | `admin`, `supervisor`, `finance_operator`, `report_viewer`, `read_only`                                                        | Executive BI dashboards & KPIs                    |
| `/agm-studio`            | `admin`, `supervisor`, `operator`, `finance_operator`                                                                          | AGM attendance, voting, and proxy ledger          |

### Fail-Closed Financial Error Semantics

All financial service layers (`PaymentService`, `ReconciliationService`, `ReportService`, `SearchService`, `DataManagementService`, `AgmStudioService`) enforce fail-closed query semantics:

- Database query exceptions and RPC failures **must throw immediately**.
- Under no circumstances may an error fallback to empty arrays (`[]`), empty objects (`{}`), or zero totals, which could masquerade failure as a zero-liability state.

### AGM Production Database Migrations (`20261180000000` - `20261184000000`)

1. **`20261180000000_agm_studio_company_isolation_and_atomic_rpcs.sql`**:
   - Enforces multi-tenant isolation on all AGM tables (`agm_staging_records`, `agm_historical_shareholders`, `agm_yearly_snapshots`, `agm_fiscal_year_meta`).
2. **`20261181000000_agm_staging_atomic_import_and_promotion.sql`**:
   - Introduces `commit_agm_fiscal_year_import` for atomic staging-to-production ingestion.
   - Introduces `promote_agm_clients_and_payables` for atomic promotion of clients and fraction payables.
3. **`20261182000000_fix_agm_atomic_import_lock_and_shareholder_fk.sql`**:
   - Resolves `shareholder_id` foreign keys and locks the imported fiscal year in `agm_fiscal_year_meta`.
4. **`20261183000000_agm_production_invariants_and_statutory_corrections.sql`**:
   - Enforces statutory balance invariants: `master current kitta == final snapshot kitta`, `master bonus == sum(snapshot bonus)`.
   - Introduces `apply_agm_statutory_corrections`, `claim_agm_broker_pool`, and `accept_agm_drn_record`.
5. **`20261184000000_harden_agm_service_role_auth_and_pool_claims.sql`**:
   - Grants service-role authentication bypass for automated backend scripts and test suites.
   - Aligns `clients` unique conflict constraint (`ON CONFLICT (boid)`).
   - Aligns `audit_logs` insert schema with server-enforced columns (`table_name`, `record_id`, `new_value`, `action_time`).

### Supabase Deployment Verification SOP

To verify that all required tables, RPCs, constraints, and migrations are applied on any Supabase environment (local or hosted):

```powershell
node scripts/verify-supabase-deployment.mjs
```

The script audits:

- 16 critical tables & PostgREST endpoints.
- 6 atomic financial & AGM stored procedures.
- Local or remote catalog registration of migration `20261184000000`.

---

## 9. Testing, Quality Assurance & Verification Suite

All modifications must pass the 5-tier verification pipeline prior to release:

### 1. Full Vitest Test Suite (Unit, Precision & Live Integration)

```powershell
npx vitest run
```

- **Target**: 26 test files, **224 passed**, 0 failed.
- Validates paisa rounding, tax bounds, day-count conventions, share conversion algorithms, and live Supabase transactions.

### 2. Live Supabase Database Integration Suite

```powershell
npx vitest run src/lib/services/agm-rpc-live.test.ts
```

- **Target**: 10 passed tests directly against PostgreSQL.
- Validates:
  - `commit_agm_fiscal_year_import` snapshot linkage and fiscal year lock.
  - `apply_agm_statutory_corrections` balance invariant checks.
  - `claim_agm_broker_pool` active balance decrementing.
  - `accept_agm_drn_record` state mutations.
  - `promote_agm_clients_and_payables` atomic promotion.
  - Payment batch draft rollback on line-item failure.
  - Statutory correction atomic rollback on invariant violation.
  - Promotion atomic rollback on payable insertion error.
  - Multi-tenant company isolation across records and snapshots.
  - Fail-closed RLS denial for unauthorized/anonymous users.

### 3. Static Code Analysis (ESLint)

```powershell
npm run lint
```

- **Target**: 0 errors, 0 warnings.

### 4. TypeScript Typecheck

```powershell
npx tsc --noEmit
```

- **Target**: 0 errors.

### 5. Production SSR & Nitro Build

```powershell
npm run build
```

- **Target**: Clean compilation of client assets and Nitro server bundle.

---

## 10. Backup, Disaster Recovery & Maintenance

### Daily Database Backup Procedure

```powershell
$TIMESTAMP = Get-Date -Format "yyyyMMdd_HHmmss"
docker exec -t supabase_db_illokcvaflhzrpxlwhtj pg_dump -U postgres postgres `
  --format=custom --file="/var/lib/postgresql/data/rtarts_backup_$TIMESTAMP.dump"
docker cp supabase_db_illokcvaflhzrpxlwhtj:/var/lib/postgresql/data/rtarts_backup_$TIMESTAMP.dump ./backups/
```

### Disaster Recovery / Database Restoration

```powershell
docker cp ./backups/rtarts_backup_RECOVERY.dump supabase_db_illokcvaflhzrpxlwhtj:/tmp/recovery.dump
docker exec -t supabase_db_illokcvaflhzrpxlwhtj pg_restore -U postgres -d postgres --clean --if-exists /tmp/recovery.dump
```

### Database Maintenance Routine (Monthly)

```sql
REINDEX TABLE public.clients;
REINDEX TABLE public.dividend_payables;
REINDEX TABLE public.payments;
REINDEX TABLE public.upload_history;

VACUUM ANALYZE public.clients;
VACUUM ANALYZE public.dividend_payables;
VACUUM ANALYZE public.payments;
VACUUM ANALYZE public.upload_history;
```
