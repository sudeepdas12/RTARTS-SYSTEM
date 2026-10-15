# RTARTS System Scripts Directory

This directory contains database management, DevOps, operational audits, and synchronization utilities organized by discipline:

## Structure

- **`ops/`**: Operational DevOps utilities for disaster recovery and edge parity checks.
  - `backup-db.mjs` / `backup-db.ps1`: Automated schema & data backups.
  - `restore-db.mjs` / `restore-db.ps1`: Automated database restore from dumps.
  - `verify-edge-parity.mjs`: Verification of local vs. edge Supabase feature flags.
  - `verify-supabase-deployment.mjs`: Deployment health check.

- **`audit/`**: Parameterized diagnostic and data verification tools.
  - `audit-classifications.mjs`: Audits tax exemptions, institutional classifications, and identifies potential corporate names classified as natural persons.
    - Usage: `node scripts/audit/audit-classifications.mjs --company=RMF1` (or `--company=ALL`).
  - `audit-all-summaries.mjs`: In-depth reconciliation of summaries across all entities.
  - `verify-all-db-records.mjs`: Integrity verification of tables, clients, and payables.
  - `inspect-payables.mjs` / `list-tax-exempt-payables.mjs` / `check-tax-calc.mjs`: Targeted payable and tax calculation inspectors.

- **`sync/`**: Batch synchronization engines.
  - `sync-payables-classification-and-tds.mjs`: Synchronizes classifications and applies statutory TDS rates.
  - `reclassify-and-sync-all.mjs`: Full reclassification run for all clients and linked payables.
  - `force-sync-payable-classifications.mjs`: Targeted classification synchronization.

- **`archive/`**: Frozen historical one-off migration scripts, patches, and seed runs.
  - Preserved for auditability; not intended for routine execution.
