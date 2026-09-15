import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { RBACService, type UserContext, type AppRole } from "@/lib/rbac-service";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    // Load user roles for RBAC enforcement
    const { data: roleRows } = await (supabase as any)
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id);

    const roles: AppRole[] = (roleRows ?? []).map((r: any) => r.role as AppRole);

    const userContext: UserContext = {
      id: data.user.id,
      roles,
    };

    // Role-based route protection
    const restrictedPaths: Record<string, AppRole[]> = {
      "/users": ["admin"],
      "/settings/fiscal-years": ["admin", "supervisor"],
      "/settings": ["admin"],
      "/data-management": ["admin", "supervisor"],
      "/approvals": ["admin", "supervisor", "approver", "checker"],
      "/allocations": ["admin", "supervisor", "finance_operator", "operator", "maker"],
      "/classification-review": ["admin", "supervisor", "checker", "approver", "operator"],
      "/audit-logs": ["admin", "auditor", "supervisor"],
      "/audit": ["admin", "auditor", "supervisor"],
      "/payments": [
        "admin",
        "supervisor",
        "finance_operator",
        "maker",
        "checker",
        "approver",
        "read_only",
      ],
      "/reports": [
        "admin",
        "supervisor",
        "report_viewer",
        "auditor",
        "finance_operator",
        "read_only",
        "maker",
        "operator",
        "checker",
        "approver",
      ],
      "/clients": ["admin", "supervisor", "operator", "maker", "checker", "approver", "read_only"],
      "/companies": ["admin", "supervisor", "operator", "read_only"],
      "/dividend": [
        "admin",
        "supervisor",
        "operator",
        "maker",
        "checker",
        "approver",
        "finance_operator",
        "read_only",
      ],
      "/interest": [
        "admin",
        "supervisor",
        "operator",
        "maker",
        "checker",
        "approver",
        "finance_operator",
        "read_only",
      ],
      "/mutual-fund": [
        "admin",
        "supervisor",
        "operator",
        "maker",
        "checker",
        "approver",
        "finance_operator",
        "read_only",
      ],
      "/reconciliation": ["admin", "supervisor", "reconciliation_officer", "finance_operator"],
      "/upload": ["admin", "supervisor", "operator", "maker"],
      "/upload-history": ["admin", "supervisor", "operator", "maker", "auditor"],
      "/analytics": ["admin", "supervisor", "finance_operator", "report_viewer", "read_only"],
      "/agm-studio": ["admin", "supervisor", "operator", "finance_operator"],
    };

    // Match most specific routes first
    const matchedPath = Object.keys(restrictedPaths)
      .sort((a, b) => b.length - a.length)
      .find((p) => location.pathname === p || location.pathname.startsWith(p + "/"));

    if (matchedPath) {
      const allowedRoles = restrictedPaths[matchedPath];
      if (!RBACService.hasRole(userContext, allowedRoles)) {
        throw redirect({ to: "/dashboard" });
      }
    }

    return { user: data.user, userContext };
  },
  component: () => (
    <ErrorBoundary>
      <AppShell>
        <Outlet />
      </AppShell>
    </ErrorBoundary>
  ),
});
