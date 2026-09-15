# Database layout

> **Local Docker, not the cloud.** This Supabase instance runs locally in Docker via the CLI
> (`supabase start`) — see the project [README](../README.md). All migrations below target that
> **local** database. `config.toml`'s `project_id` is only the local project identifier.

All database-changing SQL belongs in this directory:

- `migrations/` — ordered, immutable schema and data migrations applied by the Supabase CLI.
- `seed.sql` — local-development seed data only.
- `snippets/` — read-only investigation queries; never run automatically.
- `functions/` — Supabase Edge Functions, not database migrations.

Do not place migrations under `src/`, scripts, or feature folders. Create new migrations with `supabase migration new <name>` and keep the generated file under `supabase/migrations/`.

Before applying a migration, run the local database and verify it with `supabase migration list --local` (and `supabase db advisors` when available). Production secrets are configured in the Supabase dashboard or deployment environment, not in migration files.

## Applying migrations locally

- Apply all **pending** migrations to the local Docker DB: `supabase migration up`
- Reset the whole local DB from migrations + seed: `supabase db reset`
- Inspect what has / has not been applied: `supabase migration list --local`
- Manual SQL editor (if you prefer pasting SQL): local Studio at `http://127.0.0.1:54323` → **SQL** → **New query**

If a runtime error says a column/table does not exist (e.g. `column clients_1.payee_classification does not exist`),
it almost always means a migration here has **not been applied** — run `supabase migration up` first.

---

## Key Stored Procedures & Financial RPCs

The system enforces transactional and financial consistency via PostgreSQL stored functions (`SECURITY DEFINER`):

| Stored Procedure                   | Purpose                                                                                                                                      | Security & Roles                                      |
| :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------- |
| `complete_payment_batch_atomic`    | Synchronously transitions payment batches, individual line items, and underlying dividend/interest payables to `Completed` / `Paid`.         | `admin`, `supervisor`, `finance_operator`, `approver` |
| `apply_share_conversion_atomic`    | Executes corporate restructuring (5 conversion types), updates client holdings, reclassifies lock-ins, and creates fractional cash payables. | `admin`, `supervisor`, `finance_operator`             |
| `apply_reconciliation_batch`       | Applies verified bank clearing statement batches against dividend/interest ledgers.                                                          | `admin`, `supervisor`, `reconciliation_officer`       |
| `revert_reconciliation_lot_atomic` | Reverses an entire reconciliation lot, reopening underlying payables to `Pending`.                                                           | `admin`, `supervisor`                                 |
| `commit_agm_fiscal_year_import`    | Ingests AGM staging records, links shareholder profiles, builds snapshots, and locks the fiscal year.                                        | `admin`, `supervisor`, `finance_operator`             |
| `apply_agm_statutory_corrections`  | Corrects historical AGM discrepancies while strictly maintaining master/snapshot invariants.                                                 | `admin`, `supervisor`                                 |
| `claim_agm_broker_pool`            | Decrements active broker pool holdings and reallocates to verified beneficiary accounts.                                                     | `admin`, `supervisor`                                 |
| `promote_agm_clients_and_payables` | Promotes finalized AGM historical rosters into live production `clients` and `dividend_payables`.                                            | `admin`, `supervisor`                                 |

---

## Deployment & Verification Scripts

To audit that all tables, foreign keys, triggers, RPCs, and RLS policies are applied correctly in your database:

```powershell
# Run the deployment verification script
node scripts/verify-supabase-deployment.mjs
```

This script verifies:

1. **16 Critical Tables**: `companies`, `clients`, `dividend_payables`, `interest_payables`, `mutual_fund_payables`, `payment_batches`, `payments`, `upload_history`, `upload_errors`, `audit_logs`, `agm_historical_shareholders`, `agm_yearly_snapshots`, etc.
2. **Atomic RPCs**: Checks existence and authorization parameters for all financial stored procedures.
3. **Migration Catalog**: Verifies that the latest migration (`20261184000000_harden_agm_service_role_auth_and_pool_claims.sql`) has been registered in the Supabase schema migration history.

---

## Initial Seed & Administrative Accounts

On a fresh database reset (`supabase db reset`), initial configuration and superuser accounts are created by `20261147000000_seed_initial_admin_users.sql` and `seed.sql`:

- **Admin Email**: `admin@rbbmbl.com.np`
- **Default Password**: `Admin123!`
- **Seeded Companies**: Pre-configured sample issuing companies (`NLG Insurance`, `Supermai Hydropower`, etc.).
