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
