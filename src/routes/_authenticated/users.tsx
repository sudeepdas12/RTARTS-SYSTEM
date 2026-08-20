import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Shield, UserPlus, Key, Trash2, Users, UserCheck, ShieldAlert, Clock, Search, X } from "lucide-react";
import { toast } from "sonner";
import {
  adminListUsers,
  adminInviteUser,
  adminSetUserRole,
  adminResetUserPassword,
  adminDeleteUser,
} from "@/lib/admin-user.functions";
import { RBACService, type AppRole } from "@/lib/rbac-service";
import { useAuth } from "@/hooks/use-auth";

const ROLES: AppRole[] = RBACService.getAllRoles();

export const Route = createFileRoute("/_authenticated/users")({
  component: UsersRoute,
});

type AdminUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  invited_at: string | null;
};

const roleColor: Record<string, string> = {
  admin: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  supervisor: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  approver: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  checker: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  maker: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  operator: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300",
  finance_operator: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300",
  reconciliation_officer: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300",
  auditor: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
  report_viewer: "bg-muted text-muted-foreground",
  read_only: "bg-muted text-muted-foreground",
};

function UsersRoute() {
  const qc = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("operator");
  const [inviteOpen, setInviteOpen] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  // Password reset dialog state
  const [resetOpen, setResetOpen] = useState(false);
  const [userToReset, setUserToReset] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const {
    data: users = [],
    isLoading,
  } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => adminListUsers(),
  });

  const { mutate: inviteUser, isPending: inviting } = useMutation({
    mutationFn: async () => {
      const { origin } = window.location;
      await adminInviteUser({
        data: {
          email: inviteEmail,
          fullName: inviteName,
          role: inviteRole,
          redirectTo: `${origin}/auth`,
        },
      });
    },
    onSuccess: () => {
      toast.success("User invited successfully", {
        description: `Invitation sent to ${inviteEmail}`,
      });
      setInviteOpen(false);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("operator");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => {
      toast.error("Failed to invite user", { description: e.message });
    },
  });

  const { mutate: updateRole, isPending: updating } = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      await adminSetUserRole({ data: { userId, role } });
    },
    onSuccess: () => {
      toast.success("User role updated");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => {
      toast.error("Failed to update role", { description: e.message });
    },
  });

  const { mutate: resetPassword, isPending: resetting } = useMutation({
    mutationFn: async () => {
      if (!userToReset) return;
      await adminResetUserPassword({
        data: { userId: userToReset.id, newPassword },
      });
    },
    onSuccess: () => {
      toast.success(`Password reset for ${userToReset?.email}`);
      setResetOpen(false);
      setUserToReset(null);
      setNewPassword("");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => {
      toast.error("Failed to reset password", { description: e.message });
    },
  });

  const { mutate: deleteUser, isPending: deleting } = useMutation({
    mutationFn: async (userId: string) => {
      await adminDeleteUser({ data: { userId } });
    },
    onSuccess: () => {
      toast.success("User deleted successfully");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => {
      toast.error("Failed to delete user", { description: e.message });
    },
  });

  const { user: currentUser } = useAuth();

  const filteredUsers = useMemo(() => {
    let list = users as AdminUser[];
    if (roleFilter !== "all") {
      list = list.filter((u) => u.role === roleFilter);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (u) =>
          u.full_name?.toLowerCase().includes(q) ||
          u.email?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, roleFilter, searchTerm]);

  const kpis = useMemo(() => {
    const total = users.length;
    const admins = users.filter((u: AdminUser) => u.role === "admin").length;
    const active = users.filter((u: AdminUser) => u.last_sign_in_at != null).length;
    const pending = users.filter((u: AdminUser) => !u.last_sign_in_at).length;
    return { total, admins, active, pending };
  }, [users]);

  const initials = (name?: string | null, email?: string | null) => {
    const src = name ?? email ?? "U";
    return src
      .split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  };

  return (
    <div className="flex flex-col gap-6 p-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <PageHeader
          title="User Management"
          description="Manage administrators, operators, and viewers across the platform."
        />

        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="hover-lift">
              <UserPlus className="w-4 h-4 mr-2" />
              Invite User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite new user</DialogTitle>
              <DialogDescription>
                Send an email invitation to add a new team member.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  placeholder="Optional"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Role</Label>
                <Select value={inviteRole} onValueChange={(val) => setInviteRole(val as AppRole)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        <div className="flex flex-col">
                          <span className="capitalize">{role.replace(/_/g, " ")}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setInviteOpen(false)} disabled={inviting}>
                Cancel
              </Button>
              <Button onClick={() => inviteUser()} disabled={!inviteEmail || inviting}>
                {inviting ? "Sending..." : "Send Invite"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Total Users</p>
              <p className="text-2xl font-bold mt-1 tabular-nums">{kpis.total}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Platform accounts</p>
            </div>
            <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Users className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Administrators</p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1 tabular-nums">{kpis.admins}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Full privilege access</p>
            </div>
            <div className="p-2.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
              <ShieldAlert className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Active Signed-In</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 tabular-nums">{kpis.active}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Confirmed credentials</p>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <UserCheck className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Pending Invites</p>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1 tabular-nums">{kpis.pending}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Awaiting initial login</p>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Clock className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search user name or email…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-44 h-8 text-xs">
            <SelectValue placeholder="All Roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                <span className="capitalize">{r.replace(/_/g, " ")}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Active</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Loading users...
                </TableCell>
              </TableRow>
            ) : filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No users matching filter criteria.
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((user) => (
                <TableRow key={user.id} className="hover:bg-muted/30">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs font-semibold">{initials(user.full_name, user.email)}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="font-medium text-sm">{user.full_name || "Unknown"}</span>
                        <span className="text-xs text-muted-foreground font-mono">{user.email}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={user.role || ""}
                      onValueChange={(val) => updateRole({ userId: user.id, role: val as AppRole })}
                      disabled={updating}
                    >
                      <SelectTrigger className="w-44 h-8 text-xs border-transparent hover:border-border">
                        <div className="flex items-center gap-2">
                          <Shield className="w-3 h-3 text-muted-foreground" />
                          <SelectValue placeholder="No role" />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            <span className="capitalize text-xs">{role.replace(/_/g, " ")}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {user.last_sign_in_at ? (
                      <Badge
                        variant="outline"
                        className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 text-[11px]"
                      >
                        Active
                      </Badge>
                    ) : user.invited_at ? (
                      <Badge
                        variant="outline"
                        className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800 text-[11px]"
                      >
                        Invited
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[11px]">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {user.last_sign_in_at
                      ? new Date(user.last_sign_in_at).toLocaleDateString()
                      : "Never"}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        title="Reset Password"
                        onClick={() => {
                          setUserToReset(user);
                          setNewPassword("");
                          setResetOpen(true);
                        }}
                      >
                        <Key className="w-4 h-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            disabled={user.id === currentUser?.id}
                            title={
                              user.id === currentUser?.id
                                ? "You cannot delete your own account"
                                : "Delete user"
                            }
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete User?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently remove <strong>{user.email}</strong> and all
                              their associated data (profile, role assignments). This action cannot
                              be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteUser(user.id)}
                              disabled={deleting}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              {deleting ? "Deleting..." : "Delete User"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Password Reset Dialog */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new password for <strong>{userToReset?.email}</strong>. The user will be able to
              sign in with this password immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter a new password"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const chars =
                  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
                let pwd = "";
                for (let i = 0; i < 16; i++) {
                  pwd += chars.charAt(Math.floor(Math.random() * chars.length));
                }
                setNewPassword(pwd);
              }}
            >
              Generate Secure Password
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => resetPassword()} disabled={resetting || !newPassword}>
              {resetting ? "Resetting..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
