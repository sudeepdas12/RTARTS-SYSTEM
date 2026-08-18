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
      "/settings": ["admin"],
      "/data-management": ["admin", "supervisor"],
      "/approvals": ["admin", "supervisor", "approver", "checker"],
      "/audit": ["admin", "auditor", "supervisor"],
    };

    const matchedPath = Object.keys(restrictedPaths).find(p =>
      location.pathname === p || location.pathname.startsWith(p + "/")
    );

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
