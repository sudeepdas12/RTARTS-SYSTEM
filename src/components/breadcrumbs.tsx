import { Link, useRouterState } from "@tanstack/react-router";
import { Fragment } from "react";
import { ChevronRight, Home } from "lucide-react";

const LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  companies: "Companies",
  clients: "Clients",
  interest: "Debenture Interest",
  dividend: "Stock Dividend",
  reconciliation: "Bank Reconciliation",
  allocations: "IAF Allocations",
  approvals: "Pending Approvals",
  uploads: "Uploads",
  reports: "Reports",
  audit: "Audit Log",
  users: "Users & Roles",
  settings: "Settings",
  "fiscal-years": "Fiscal Years",
};

export function Breadcrumbs() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  const crumbs = parts.map((p, i) => ({
    label: LABELS[p] ?? p,
    href: "/" + parts.slice(0, i + 1).join("/"),
  }));

  return (
    <nav aria-label="Breadcrumb" className="hidden items-center gap-1 text-sm text-muted-foreground md:flex">
      <Link to="/dashboard" className="flex items-center hover:text-foreground" aria-label="Home">
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((c, i) => (
        <Fragment key={c.href}>
          <ChevronRight className="h-3.5 w-3.5 opacity-50" />
          {i === crumbs.length - 1 ? (
            <span className="font-medium text-foreground">{c.label}</span>
          ) : (
            <Link to={c.href} className="hover:text-foreground">
              {c.label}
            </Link>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
