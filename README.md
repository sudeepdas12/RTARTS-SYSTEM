# RTARTS System

RTARTS manages shareholder records, payables, tax deductions, payments, uploads, and bank reconciliation for registrar and transfer-agent operations.

## Start locally

1. Copy `.env.example` to `.env` and set the local Supabase keys from `supabase status`.
2. Start the database: `supabase start`.
3. Apply migrations and local seed data: `supabase db reset`.
4. Install dependencies: `npm install`.
5. Start the app: `npm run dev`.

Use `npm run build` to create a production build.

## Supabase runs locally in Docker (not the cloud)

> **Important.** In this repository, Supabase is **local**: it runs inside Docker, managed by the
> Supabase CLI (`supabase start` / `supabase stop`). There is **no hosted/cloud Supabase** in play
> during local development, and this project is **not** linked to a remote `supabase.co` project.
> The app talks to `http://127.0.0.1:54321`, never to a cloud URL.

- The container images come from `public.ecr.aws/supabase/...` and are named
  `supabase_<service>_<project_id>` (e.g. `supabase_db_illokcvaflhzrpxlwhtj`).
- The name after the underscores is just the **local project identifier** from `supabase/config.toml`
  (`project_id`). It is **not** a hosted instance reference — everything runs on your machine.

The single source of truth for the running URLs and keys is:

```bash
supabase status
```

Typical local endpoints:

| Part        | URL / connection                                                        |
|-------------|-------------------------------------------------------------------------|
| API / REST  | `http://127.0.0.1:54321/rest/v1`                                        |
| Studio (UI) | `http://127.0.0.1:54323` (SQL editor here)                              |
| Postgres    | `postgresql://postgres:postgres@127.0.0.1:54322/postgres`               |
| Mailpit     | `http://127.0.0.1:54324`                                                |

To confirm the stack is up: run `supabase status` or `docker ps` (look for the `supabase_*` containers).

### Applying database migrations locally

All schema changes live in `supabase/migrations/` (see [supabase/](supabase/README.md)).
Apply any **pending** migrations to the local Docker database with:

```bash
supabase migration up
```

or run the SQL manually in the local Studio SQL editor at `http://127.0.0.1:54323` → **SQL** → **New query**.
If you ever see a Postgres error like `column ... does not exist`, it almost always means a migration
in `supabase/migrations/` has not been applied to the local database yet — apply it with the command above.

## Environment rules

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are browser-safe build-time values.
- These point at the **local** Supabase instance (`http://127.0.0.1:54321`) when developing locally.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never prefix it with `VITE_`, commit it, or pass it as a Docker build argument.
- `.env` is ignored by Git. Keep only variable names and placeholder values in `.env.example`.

## Database

All database artifacts are centralised under [supabase/](supabase/README.md). In particular, every schema change belongs in `supabase/migrations/`; do not add migration files under `src/`.

## Docker

`docker compose up --build` builds the application with only the browser-safe `VITE_*` values. Runtime server variables, including the service-role key when server-only operations need it, are supplied by Docker Compose and are not embedded into the image.

The Docker image runs only the **application**. It does not run Supabase or deploy Edge Functions — Supabase itself is the separate local CLI-managed Docker stack described above. Deploy functions such as `process-import-chunk` to the Supabase project separately.
