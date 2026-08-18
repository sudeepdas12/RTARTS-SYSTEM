import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AppRole } from "@/lib/rbac-service";

/**
 * Server-side admin user management.
 *
 * All functions require a valid bearer token (attached automatically by the
 * `attachSupabaseAuth` client middleware) and assert the caller is an admin
 * before touching the service-role client. The service-role key is imported
 * lazily so it never ends up in the browser bundle.
 */

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });

  if (error || data !== true) {
    throw new Error("You need administrator privileges to manage users.");
  }
}

export interface AdminUser {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  invited_at: string | null;
}

/**
 * List all users with their profile + role.
 */
export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUser[]> => {
    await assertAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let authUsers: any[] = [];
    const { data, error } = await supabaseAdmin.auth.admin.listUsers();
    if (!error && data?.users) {
      authUsers = data.users;
    } else {
      console.warn("Failed to list users from auth.admin, falling back to profiles table.", error);
    }

    const { data: roleRows } = await supabaseAdmin.from("user_roles").select("user_id, role");

    const { data: profileRows } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, created_at");

    const roleByUser = new Map<string, AppRole>();
    for (const row of roleRows ?? []) {
      const existing = roleByUser.get(row.user_id);
      const next = row.role as AppRole;
      if (!existing || priority(next) < priority(existing)) {
        roleByUser.set(row.user_id, next);
      }
    }

    const authUserMap = new Map<string, any>(authUsers.map((u) => [u.id, u]));

    const baseUsers =
      authUsers.length > 0
        ? authUsers.map((u) => ({ id: u.id }))
        : (profileRows ?? []).map((p) => ({ id: p.id }));

    const nameByUser = new Map<string, string | null>(
      (profileRows ?? []).map((p) => [p.id, p.full_name]),
    );

    const emailByUser = new Map<string, string | null>(
      (profileRows ?? []).map((p) => [p.id, p.email]),
    );

    const createdByUser = new Map<string, string | null>(
      (profileRows ?? []).map((p) => [p.id, p.created_at]),
    );

    return baseUsers.map((base) => {
      const u = authUserMap.get(base.id);
      return {
        id: base.id,
        email: u?.email ?? emailByUser.get(base.id) ?? null,
        full_name: nameByUser.get(base.id) ?? u?.user_metadata?.full_name ?? null,
        role: roleByUser.get(base.id) ?? null,
        created_at: u?.created_at ?? createdByUser.get(base.id) ?? null,
        last_sign_in_at: u?.last_sign_in_at ?? null,
        invited_at: u?.invited_at ?? null,
      };
    });
  });

function priority(role: string): number {
  const order: Record<string, number> = {
    admin: 0,
    supervisor: 1,
    approver: 2,
    checker: 3,
    maker: 4,
    operator: 5,
    finance_operator: 5,
    reconciliation_officer: 5,
    auditor: 6,
    report_viewer: 7,
    read_only: 7,
  };
  return order[role] ?? 99;
}

/**
 * Invite a new user by email and assign them the given role.
 */
export const adminInviteUser = createServerFn({ method: "POST" })
  .validator((d: { email: string; role: AppRole; fullName?: string; redirectTo: string }) => d)
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: inviteData, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      data.email,
      {
        data: { full_name: data.fullName?.trim() || null },
        redirectTo: data.redirectTo,
      },
    );

    if (error) throw new Error(error.message);
    if (!inviteData.user) throw new Error("Could not create the invited user.");

    // The `handle_new_user` trigger grants a default role — replace it with
    // the one the admin actually selected.
    await supabaseAdmin.from("user_roles").delete().eq("user_id", inviteData.user.id);
    const { error: roleError } = await supabaseAdmin.from("user_roles").insert({
      user_id: inviteData.user.id,
      role: data.role,
    });
    if (roleError) throw new Error(roleError.message);

    return { id: inviteData.user.id, email: inviteData.user.email };
  });

/**
 * Change the role of an existing user.
 */
export const adminSetUserRole = createServerFn({ method: "POST" })
  .validator((d: { userId: string; role: AppRole }) => d)
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.userId, role: data.role });
    if (error) throw new Error(error.message);

    return { ok: true };
  });

/**
 * Reset a user's password.
 * The admin supplies a new password that the user will use to sign in.
 */
export const adminResetUserPassword = createServerFn({ method: "POST" })
  .validator((d: { userId: string; newPassword: string }) => d)
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.newPassword,
    });
    if (error) throw new Error(error.message);

    return { ok: true };
  });

/**
 * Delete a user and all their associated data.
 * The `profiles` and `user_roles` rows are removed via ON DELETE CASCADE.
 */
export const adminDeleteUser = createServerFn({ method: "POST" })
  .validator((d: { userId: string }) => d)
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);

    return { ok: true };
  });
