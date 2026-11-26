# RTARTS System Scripts Directory

This directory contains database management, DevOps, operational audits, fixture/flow verification, and synchronization utilities organized by discipline:

## Structure

- **`ops/`**: Operational DevOps, health, and release-gate utilities.
  - `backup-db.mjs` / `backup-db.ps1`: Automated schema & data backups (`npm run db:backup`).
  - `restore-db.mjs` / `restore-db.ps1`: Automated database restore from dumps (`npm run db:restore`).
  - `check-supabase-health.mjs`: Local SQL lint and security/performance advisor check (`npm run verify:db`).
  - `verify-edge-parity.mjs`: Verification of local vs. edge tax rules (`npm run verify:edge`).
  - `release-gate-verify.mjs`: Source release invariant & live production audit (`npm run audit:source-release`, `npm run verify:release-gate`, `npm run verify:production-live`).
  - `verify-supabase-deployment.mjs`: Deployment schema & RPC health check.

- **`audit/`**: Parameterized diagnostic and financial data verification tools.
  - `audit-classifications.mjs`: Audits tax exemptions, institutional classifications, and corporate payee classifications (`npm run audit:classifications`).
  - `audit-all-summaries.mjs`: Cross-entity summary reconciliation (`npm run audit:summaries`).
  - `verify-all-db-records.mjs`: Integrity verification of tables, clients, and payables.
  - `verify-payables-status.mjs`, `inspect-payables.mjs`, `list-tax-exempt-payables.mjs`, `check-tax-calc.mjs`: Targeted payable and tax calculation inspectors.

- **`sync/`**: Batch synchronization engines.
  - `sync-payables-classification-and-tds.mjs`: Synchronizes classifications and applies statutory TDS rates.
  - `reclassify-and-sync-all.mjs`: Full reclassification run for all clients and linked payables.
  - `force-sync-payable-classifications.mjs`: Targeted classification synchronization.

- **`verify/`**: Test fixture generation, parser validation, and end-to-end flow scripts.
  - `generate-all-test-fixtures.mjs`: Deterministically generates upload & edge-case spreadsheets under `test-fixtures/` (`npm run fixtures:generate`).
  - `verify-upload-fixtures.ts`: Validates all generated upload section fixtures against parsers and validators (`npm run test:fixtures`).
  - `verify-rta-flows.ts`: End-to-end RTA workflow diagnostic script against a local Supabase instance.

- **`archive/`**: Frozen historical one-off migration scripts and patches preserved for auditability (not intended for routine execution).
