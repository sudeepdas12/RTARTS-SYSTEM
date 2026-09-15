# Routes

TanStack Start uses **file-based routing**. Every `.tsx` file in this directory
defines a route. Do **not** create `src/pages/`, `src/routes/_app/index.tsx`, or
`app/layout.tsx` — those are Next.js / Remix conventions. The only root layout
is `src/routes/__root.tsx`.

## Conventions

| File                     | URL                                                     |
| ------------------------ | ------------------------------------------------------- |
| `index.tsx`              | `/`                                                     |
| `about.tsx`              | `/about`                                                |
| `users/index.tsx`        | `/users`                                                |
| `users/$id.tsx`          | `/users/:id` (dynamic — bare `$`, no curly braces)      |
| `posts/{-$category}.tsx` | `/posts/:category?` (optional segment)                  |
| `files/$.tsx`            | `/files/*` (splat — read via `_splat` param, never `*`) |
| `_layout.tsx`            | layout route (renders children via `<Outlet />`)        |
| `__root.tsx`             | app shell — wraps every page; preserve `<Outlet />`     |

`routeTree.gen.ts` is auto-generated. Don't edit it by hand.

---

## Application Route Topology & Role Access

All protected operational screens reside under `src/routes/_authenticated/` and are guarded by the layout route `_authenticated/route.tsx`:

| File                                       | URL                      | Description                                           | Minimum Authorized Roles                                                  |
| :----------------------------------------- | :----------------------- | :---------------------------------------------------- | :------------------------------------------------------------------------ |
| `auth.tsx`                                 | `/auth`                  | Login portal with rate limiting & brute force guard   | Public                                                                    |
| `_authenticated/dashboard.tsx`             | `/dashboard`             | System overview, operational metrics & feeds          | All authenticated roles                                                   |
| `_authenticated/clients.tsx`               | `/clients`               | Shareholder Master Registry (paginated 70k+ records)  | `operator`, `maker`, `checker`, `approver`, `supervisor`, `admin`         |
| `_authenticated/companies.tsx`             | `/companies`             | Client company portfolio administration               | `operator`, `supervisor`, `admin`                                         |
| `_authenticated/dividend.tsx`              | `/dividend`              | Equity dividend processing & CDSC bonus allocations   | `maker`, `operator`, `checker`, `approver`, `supervisor`, `admin`         |
| `_authenticated/interest.tsx`              | `/interest`              | Debenture coupon interest calculation & payouts       | `maker`, `operator`, `checker`, `approver`, `supervisor`, `admin`         |
| `_authenticated/mutual-fund.tsx`           | `/mutual-fund`           | Scheme distribution calculation & payments            | `maker`, `operator`, `checker`, `approver`, `supervisor`, `admin`         |
| `_authenticated/allocations.tsx`           | `/allocations`           | Corporate actions, 5 share conversion types & DRN     | `maker`, `operator`, `finance_operator`, `supervisor`, `admin`            |
| `_authenticated/payments.tsx`              | `/payments`              | Maker-Checker payment batches & ConnectIPS exports    | `maker`, `checker`, `approver`, `finance_operator`, `supervisor`, `admin` |
| `_authenticated/approvals.tsx`             | `/approvals`             | Dedicated Maker-Checker authorization queue           | `checker`, `approver`, `supervisor`, `admin`                              |
| `_authenticated/reconciliation.tsx`        | `/reconciliation`        | Bank statement reconciliation & IAF aging transfers   | `reconciliation_officer`, `finance_operator`, `supervisor`, `admin`       |
| `_authenticated/agm-studio.tsx`            | `/agm-studio`            | Multi-year historical reconciliation, quorum & voting | `operator`, `finance_operator`, `supervisor`, `admin`                     |
| `_authenticated/reports.tsx`               | `/reports`               | IRD Annex-10 e-TDS returns, PDF certificates, BI      | `report_viewer`, `auditor`, `finance_operator`, `supervisor`, `admin`     |
| `_authenticated/upload.tsx`                | `/upload`                | Excel single & multi-sheet bulk ingestion pipeline    | `maker`, `operator`, `supervisor`, `admin`                                |
| `_authenticated/upload-history.tsx`        | `/upload-history`        | Ingestion history, error drill-down & rollback        | `maker`, `operator`, `auditor`, `supervisor`, `admin`                     |
| `_authenticated/audit-logs.tsx`            | `/audit-logs`            | Immutable audit trail viewer                          | `auditor`, `supervisor`, `admin`                                          |
| `_authenticated/users.tsx`                 | `/users`                 | User management & company tenancy assignments         | `admin`                                                                   |
| `_authenticated/settings.index.tsx`        | `/settings`              | System-wide settings & database parameters            | `admin`                                                                   |
| `_authenticated/settings.fiscal-years.tsx` | `/settings/fiscal-years` | Fiscal year lifecycle & period locking                | `supervisor`, `admin`                                                     |
| `_authenticated/data-management.tsx`       | `/data-management`       | Bulk data purge and maintenance utilities             | `supervisor`, `admin`                                                     |
