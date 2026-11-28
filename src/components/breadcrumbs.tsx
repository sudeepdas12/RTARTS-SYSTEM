import { Link, useRouterState } from "@tanstack/react-router";
import { Fragment } from "react";
import { ChevronRight, Home } from "lucide-react";

const LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  companies: "Companies",
  clients: "Clients",
  interest: "Debenture Interest",
  dividend: "Stock Dividend",
  "mutual-fund": "Mutual Fund",
  payments: "Payment Batches",
  reconciliation: "Bank Reconciliation",
  allocations: "IAF Allocations",
  approvals: "Pending Approvals",
  upload: "Upload Sheet",
  uploads: "Uploads",
  "upload-history": "Upload History",
  "classification-review": "Classification Review",
  "agm-studio": "AGM & Dividend Studio",
  "data-management": "Data Management",
  reports: "Reports",
  analytics: "Analytics",
  audit: "Audit Log",
  "audit-logs": "Audit Logs",
  backup: "Backup & Restore",
  users: "Users & Roles",
  settings: "Settings",
  "fiscal-years": "Fiscal Years",
};

function formatBreadcrumbSegment(segment: string): string {
  return (
    LABELS[segment] ??
    segment
      .split("-")
      .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
      .join(" ")
  );
}

export function Breadcrumbs() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  const crumbs = parts.map((p, i) => ({
    label: formatBreadcrumbSegment(p),
    href: "/" + parts.slice(0, i + 1).join("/"),
  }));

  return (
    <nav
      aria-label="Breadcrumb"
      className="hidden items-center gap-1 text-sm text-muted-foreground md:flex min-w-0 overflow-hidden"
    >
      <Link
        to="/dashboard"
        className="flex shrink-0 items-center hover:text-foreground"
        aria-label="Home"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((c, i) => (
        <Fragment key={c.href}>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
          {i === crumbs.length - 1 ? (
            <span className="font-medium text-foreground whitespace-nowrap truncate">
              {c.label}
            </span>
          ) : (
            <Link to={c.href} className="hover:text-foreground whitespace-nowrap truncate">
              {c.label}
            </Link>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
