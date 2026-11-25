# Supabase Migrations Registry & Architecture Index

This directory contains the immutable, sequential migration history for the **RTA Dividend & Interest Payment Management System**.

> [!IMPORTANT]
> **Immutability Principle**: Migrations in this folder must never be renamed, reordered, or deleted once applied. They represent the chronological ledger of schema modifications tracked in `supabase_migrations.schema_migrations`.
>
> For a single consolidated view of the entire active database schema, refer to [schema_baseline.sql](../schema_baseline.sql).

---

## Migration Architecture Tiers

The migrations are structured into 4 sequential architectural tiers:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Tier 4: Corporate Declarations (20261124)                              │
│         RTA corporate declarations, dividend linking, payable batches  │
├────────────────────────────────────────────────────────────────────────┤
│ Tier 3: Reconciliation & Audit Overhaul (20261030 - 20261106)          │
│         Audit remediation, batch limits, staged import normalization   │
├────────────────────────────────────────────────────────────────────────┤
│ Tier 2: Performance & Hardening (20261026 - 20261028)                  │
│         Search paths, paginated search, staging, vault, folio dedupe   │
├────────────────────────────────────────────────────────────────────────┤
│ Tier 1: Core Foundation (20261005)                                     │
│         Base tables, constraints, indexes, views, RPCs, RLS, triggers  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Migration Catalog

### Tier 1: Core Foundation (2026-10-05)

| Version          | File                                                                     | Primary Scope & Objects Affected                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261005000001` | [`20261005000001_initial_schema.sql`](20261005000001_initial_schema.sql) | Base database schema: creates `companies`, `shareholders`, `payment_batches`, `payment_records`, `audit_logs`, custom enum types, and primary key / foreign key constraints. |
| `20261005000002` | [`20261005000002_indexes.sql`](20261005000002_indexes.sql)               | Performance indexes across high-volume transaction tables: B-tree indexes on `company_id`, `status`, `folio_number`, `created_at`, and partial indexes for active batches.   |
| `20261005000003` | [`20261005000003_views.sql`](20261005000003_views.sql)                   | Reporting abstractions: `v_company_payment_summary`, `v_batch_reconciliation_status`, and shareholder-level summary views.                                                   |
| `20261005000004` | [`20261005000004_functions.sql`](20261005000004_functions.sql)           | Core RPC functions: batch calculation, status transitions, batch aggregation, and shareholder status evaluation.                                                             |
| `20261005000005` | [`20261005000005_rls.sql`](20261005000005_rls.sql)                       | Multi-tenant Row-Level Security (RLS) policies enforcing company data isolation for authenticated roles.                                                                     |
| `20261005000006` | [`20261005000006_triggers.sql`](20261005000006_triggers.sql)             | Automated triggers: timestamp auto-updating (`updated_at`), audit event logging, and status validation hooks.                                                                |

---

### Tier 2: Performance & Hardening (2026-10-26 – 2026-10-28)

| Version          | File                                                                                     | Primary Scope & Objects Affected                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261026000001` | [`20261026000001_search_path_fix.sql`](20261026000001_search_path_fix.sql)               | Security hardening: enforces explicit `SET search_path = public, pg_temp` across all security-definer stored procedures to prevent search-path injection. |
| `20261026000002` | [`20261026000002_paginated_search.sql`](20261026000002_paginated_search.sql)             | Scalability: introduces server-side paginated search RPCs for large shareholder rosters (~20,000+ records) with composite filtering.                      |
| `20261026000003` | [`20261026000003_payment_lot_staging.sql`](20261026000003_payment_lot_staging.sql)       | Lot processing pipeline: creates `staging_payment_records` and lot staging functions for multi-stage batch preparation and bank upload validation.        |
| `20261026000004` | [`20261026000004_cron_secrets_hardening.sql`](20261026000004_cron_secrets_hardening.sql) | Cron & background task security: secures pg_net / pg_cron background workers and encrypts service keys.                                                   |
| `20261027000001` | [`20261027000001_physical_folio_numbers.sql`](20261027000001_physical_folio_numbers.sql) | Folio management: adds deduplication rules, physical certificate folio tracking, and format validation for demat vs physical holdings.                    |
| `20261027000002` | [`20261027000002_grand_totals.sql`](20261027000002_grand_totals.sql)                     | Financial reporting: adds grand total aggregation functions and company-wide dividend liability balance views.                                            |
| `20261027000003` | [`20261027000003_conflict_target_fix.sql`](20261027000003_conflict_target_fix.sql)       | Bulk upsert stabilization: resolves unique conflict targets during mass shareholder Excel imports (`ON CONFLICT (company_id, folio_number)`).             |
| `20261028000001` | [`20261028000001_client_map.sql`](20261028000001_client_map.sql)                         | Multi-client extensions: introduces client entity mappings and RTA agency operator assignments.                                                           |
| `20261028000002` | [`20261028000002_rollback_rpc_rbac.sql`](20261028000002_rollback_rpc_rbac.sql)           | Operational recovery & RBAC: implements `rollback_payment_batch` RPC with strict Maker/Checker role gating and audit log enforcement.                     |
| `20261028000003` | [`20261028000003_company_access.sql`](20261028000003_company_access.sql)                 | Authorization: refines `user_company_access` mappings and tenant membership checks.                                                                       |

---

### Tier 3: Reconciliation & Audit Overhaul (2026-10-30 – 2026-11-06)

| Version          | File                                                                                                         | Primary Scope & Objects Affected                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261030000001` | [`20261030000001_reconciliation_audit_remediation.sql`](20261030000001_reconciliation_audit_remediation.sql) | Compliance: strengthens bank return file reconciliation audit logs, captures bank error response codes, and enforces immutable transaction trails. |
| `20261102000001` | [`20261102000001_batch_limit_safeguards.sql`](20261102000001_batch_limit_safeguards.sql)                     | Safeguards: establishes lot size constraints (max records per bank lot) and duplicate payment prevention rules.                                    |
| `20261104000001` | [`20261104000001_staged_import_normalization.sql`](20261104000001_staged_import_normalization.sql)           | Data cleaning: normalizes bank account numbers, IFSC codes, and currency formatting during raw Excel staging.                                      |
| `20261106000001` | [`20261106000001_scheme_summary_view.sql`](20261106000001_scheme_summary_view.sql)                           | Extended reporting: adds mutual fund / equity scheme aggregate payout summaries and remaining payable tracking.                                    |

---

### Tier 4: RTA Corporate Declarations (2026-11-24)

| Version          | File                                                                                     | Primary Scope & Objects Affected                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261124141500` | [`20261124141500_corporate_declarations.sql`](20261124141500_corporate_declarations.sql) | Declaration management: creates `corporate_declarations` table, adds declaration foreign keys to payment batches/records, and introduces declaration-level payable tracking views. |

---

## Verification & Deployment Guidelines

To verify or deploy these migrations locally or to a remote Supabase instance:

```powershell
# 1. Check local migration status vs database schema_migrations
npx supabase migration list --local

# 2. Apply any pending migrations locally
npx supabase migration up --local

# 3. Run CI release gate checks
npm run verify:release-gate

# 4. Verify Supabase deployment state
node scripts/ops/verify-supabase-deployment.mjs
```
