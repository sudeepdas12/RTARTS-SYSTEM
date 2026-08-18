import { useEffect, useState, useCallback, useMemo } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole =
  | "admin"
  | "supervisor"
  | "operator"
  | "maker"
  | "checker"
  | "approver"
  | "auditor"
  | "read_only"
  // Legacy roles (kept for backward compat)
  | "finance_operator"
  | "reconciliation_officer"
  | "report_viewer";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRoles = useCallback(async (uid: string) => {
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", uid);
    setRoles(((data ?? []) as { role: AppRole }[]).map((r) => r.role));
  }, []);

  useEffect(() => {
    let isMounted = true;

    const syncSession = async () => {
      const { data: sessionData, error } = await supabase.auth.getSession();
      if (!isMounted) return;

      if (error) {
        console.warn('[supabase] getSession error', error.message);
      }

      const session = sessionData.session;
      if (session?.expires_at && session.expires_at <= Math.floor(Date.now() / 1000) + 60) {
        const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession();
        if (!isMounted) return;
        if (refreshError) {
          console.warn('[supabase] refreshSession error', refreshError.message);
        }
        setUser(refreshedData.session?.user ?? session.user ?? null);
        if (refreshedData.session?.user) {
          setTimeout(() => loadRoles(refreshedData.session!.user.id), 0);
        } else {
          setRoles([]);
        }
        setLoading(false);
        return;
      }

      setUser(session?.user ?? null);
      if (session?.user) {
        setTimeout(() => loadRoles(session.user.id), 0);
      } else {
        setRoles([]);
      }
      setLoading(false);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setUser(session?.user ?? null);
      if (session?.user) {
        setTimeout(() => loadRoles(session.user.id), 0);
      } else {
        setRoles([]);
      }
    });

    syncSession();

    return () => {
      isMounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadRoles]);

  const helpers = useMemo(
    () => ({
      hasRole: (r: AppRole) => roles.includes(r),
      hasAny: (rs: AppRole[]) => rs.some((r) => roles.includes(r)),
      isAdmin: roles.includes("admin"),
    }),
    [roles],
  );

  return { user, roles, loading, ...helpers };
}
