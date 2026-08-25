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
import {
  Shield,
  UserPlus,
  Key,
  Trash2,
  Users,
  UserCheck,
  ShieldAlert,
  Clock,
  Search,
  X,
  Eye,
  EyeOff,
  Copy,
  Sparkles,
  Lock,
  ExternalLink,
  Mail,
  UserCheck2,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { format } from "date-fns";
import { Link } from "@tanstack/react-router";
import {
  adminListUsers,
  adminInviteUser,
  adminCreateUserDirect,
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

function generatePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*";
  const all = upper + lower + digits + symbols;

  let pwd = "";
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += lower[Math.floor(Math.random() * lower.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  pwd += symbols[Math.floor(Math.random() * symbols.length)];

  for (let i = 4; i < 14; i++) {
    pwd += all[Math.floor(Math.random() * all.length)];
  }
  return pwd;
}

function UsersRoute() {
  const qc = useQueryClient();
  const { user: currentUser, isAdmin, loading: authLoading } = useAuth();

  // Invite / Direct Create state
  const [createMode, setCreateMode] = useState<"invite" | "direct">("invite");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("operator");
  const [directPassword, setDirectPassword] = useState("");
  const [showDirectPassword, setShowDirectPassword] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  // Password reset dialog state
  const [resetOpen, setResetOpen] = useState(false);
  const [userToReset, setUserToReset] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);

  const {
    data: users = [],
    isLoading,
  } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => adminListUsers(),
    enabled: !!isAdmin,
  });

  const { mutate: inviteUser, isPending: inviting } = useMutation({
    mutationFn: async () => {
      const { origin } = window.location;
      await adminInviteUser({
        data: {
          email: inviteEmail.trim(),
          fullName: inviteName.trim(),
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

  const { mutate: createDirectUser, isPending: creatingDirect } = useMutation({
    mutationFn: async () => {
      await adminCreateUserDirect({
        data: {
          email: inviteEmail.trim(),
          password: directPassword,
          fullName: inviteName.trim(),
          role: inviteRole,
        },
      });
    },
    onSuccess: () => {
      toast.success("Account provisioned successfully", {
        description: `Direct account created for ${inviteEmail}`,
      });
      setInviteOpen(false);
      setInviteEmail("");
      setInviteName("");
      setDirectPassword("");
      setInviteRole("operator");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => {
      toast.error("Failed to create user", { description: e.message });
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

  if (!authLoading && !isAdmin) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center">
        <div className="h-14 w-14 rounded-full bg-rose-100 dark:bg-rose-950/50 flex items-center justify-center text-rose-600 dark:text-rose-400 mb-4">
          <Lock className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">Administrator Access Required</h2>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-md">
          User account provisioning, privilege assignments, and credential management require the <span className="font-semibold text-foreground">admin</span> role.
        </p>
        <Button asChild variant="outline" className="mt-5">
          <Link to="/dashboard">Return to Dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <PageHeader
          title="User & Identity Management"
          description="Manage platform administrators, operational roles, credentials, and access privileges."
        />

        {/* User Provisioning Modal */}
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="hover-lift cursor-pointer gap-1.5">
              <UserPlus className="w-4 h-4" />
              Add / Invite User
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserCheck2 className="h-5 w-5 text-primary" />
                Provision Platform User
              </DialogTitle>
              <DialogDescription>
                Invite a colleague via email or provision an account directly for intranet/offline environments.
              </DialogDescription>
            </DialogHeader>

            <Tabs value={createMode} onValueChange={(v) => setCreateMode(v as any)} className="mt-2">
              <TabsList className="grid grid-cols-2 h-9">
                <TabsTrigger value="invite" className="text-xs gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> Email Invitation
                </TabsTrigger>
                <TabsTrigger value="direct" className="text-xs gap-1.5">
                  <Key className="h-3.5 w-3.5" /> Direct Account (Offline)
                </TabsTrigger>
              </TabsList>

              {/* TAB 1: EMAIL INVITATION */}
              <TabsContent value="invite" className="space-y-3 pt-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="email" className="text-xs">Email Address *</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="name" className="text-xs">Full Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g. Sudeep Das"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Assigned Privilege Role *</Label>
                  <Select value={inviteRole} onValueChange={(val) => setInviteRole(val as AppRole)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((role) => (
                        <SelectItem key={role} value={role} className="text-xs">
                          <span className="capitalize">{role.replace(/_/g, " ")}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <DialogFooter className="pt-2">
                  <Button variant="outline" size="sm" onClick={() => setInviteOpen(false)} disabled={inviting}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={() => inviteUser()} disabled={!inviteEmail || inviting}>
                    {inviting ? "Sending..." : "Send Invite"}
                  </Button>
                </DialogFooter>
              </TabsContent>

              {/* TAB 2: DIRECT ACCOUNT CREATION */}
              <TabsContent value="direct" className="space-y-3 pt-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="direct-email" className="text-xs">Email Address *</Label>
                  <Input
                    id="direct-email"
                    type="email"
                    placeholder="name@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="direct-name" className="text-xs">Full Name</Label>
                  <Input
                    id="direct-name"
                    placeholder="e.g. Sudeep Das"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Assigned Privilege Role *</Label>
                  <Select value={inviteRole} onValueChange={(val) => setInviteRole(val as AppRole)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((role) => (
                        <SelectItem key={role} value={role} className="text-xs">
                          <span className="capitalize">{role.replace(/_/g, " ")}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="direct-pwd" className="text-xs">Initial Password *</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px] text-primary gap-1"
                      onClick={() => setDirectPassword(generatePassword())}
                    >
                      <Sparkles className="h-2.5 w-2.5" /> Generate
                    </Button>
                  </div>
                  <div className="relative">
                    <Input
                      id="direct-pwd"
                      type={showDirectPassword ? "text" : "password"}
                      placeholder="Minimum 8 characters"
                      value={directPassword}
                      onChange={(e) => setDirectPassword(e.target.value)}
                      className="h-8 text-xs pr-8 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowDirectPassword(!showDirectPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showDirectPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <DialogFooter className="pt-2">
                  <Button variant="outline" size="sm" onClick={() => setInviteOpen(false)} disabled={creatingDirect}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => createDirectUser()}
                    disabled={!inviteEmail || !directPassword || directPassword.length < 6 || creatingDirect}
                  >
                    {creatingDirect ? "Provisioning..." : "Provision Account"}
                  </Button>
                </DialogFooter>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPI Overview */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border border-border/80 shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase text-muted-foreground">Total Users</p>
              <p className="text-2xl font-bold mt-1 tabular-nums">{kpis.total}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Platform accounts</p>
            </div>
            <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Users className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
        <Card className="border border-border/80 shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase text-muted-foreground">Administrators</p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1 tabular-nums">{kpis.admins}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Full privilege access</p>
            </div>
            <div className="p-2.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
              <ShieldAlert className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
        <Card className="border border-border/80 shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase text-muted-foreground">Active Signed-In</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 tabular-nums">{kpis.active}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Confirmed credentials</p>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <UserCheck className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
        <Card className="border border-border/80 shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase text-muted-foreground">Pending Invites</p>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1 tabular-nums">{kpis.pending}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Awaiting initial login</p>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Clock className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search user name or email…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 h-8 text-xs"
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
              <SelectItem key={r} value={r} className="text-xs">
                <span className="capitalize">{r.replace(/_/g, " ")}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Users Table */}
      <div className="border rounded-lg bg-card overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 text-xs hover:bg-transparent">
              <TableHead className="pl-6 w-[280px]">User & Identity</TableHead>
              <TableHead className="w-[180px]">Assigned Role</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[180px]">Last Sign-In</TableHead>
              <TableHead className="pr-6 text-right w-[140px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <TableCell key={j}>
                      <div className="h-4 rounded bg-muted animate-pulse" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-30 text-muted-foreground" />
                  <p className="text-sm font-medium">No users match your criteria.</p>
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((user) => {
                const isSelf = user.id === currentUser?.id;
                return (
                  <TableRow key={user.id} className="hover:bg-muted/40 transition-colors">
                    {/* User Identity */}
                    <TableCell className="pl-6 text-xs">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-[11px] font-semibold bg-primary/10 text-primary">
                            {initials(user.full_name, user.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col truncate">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-xs text-foreground truncate">
                              {user.full_name || "Unassigned Name"}
                            </span>
                            {isSelf && (
                              <Badge variant="secondary" className="text-[9px] px-1 py-0 font-normal">
                                You
                              </Badge>
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground font-mono truncate">{user.email}</span>
                        </div>
                      </div>
                    </TableCell>

                    {/* Role Selection */}
                    <TableCell>
                      <Select
                        value={user.role || ""}
                        onValueChange={(val) => updateRole({ userId: user.id, role: val as AppRole })}
                        disabled={updating || isSelf}
                      >
                        <SelectTrigger className="w-40 h-7 text-xs border border-border/60">
                          <div className="flex items-center gap-1.5">
                            <Shield className="w-3 h-3 text-muted-foreground" />
                            <SelectValue placeholder="No role" />
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((role) => (
                            <SelectItem key={role} value={role} className="text-xs">
                              <span className="capitalize">{role.replace(/_/g, " ")}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>

                    {/* Status Badge */}
                    <TableCell>
                      {user.last_sign_in_at ? (
                        <Badge
                          variant="outline"
                          className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 text-[10px]"
                        >
                          Active
                        </Badge>
                      ) : user.invited_at ? (
                        <Badge
                          variant="outline"
                          className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800 text-[10px]"
                        >
                          Invited
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">Pending</Badge>
                      )}
                    </TableCell>

                    {/* Last Sign-In */}
                    <TableCell className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                      {user.last_sign_in_at ? (
                        <div>
                          <div className="font-medium text-foreground">
                            {format(new Date(user.last_sign_in_at), "dd MMM yyyy")}
                          </div>
                          <div className="text-[10px] opacity-70">
                            {format(new Date(user.last_sign_in_at), "HH:mm")}
                          </div>
                        </div>
                      ) : (
                        <span className="italic text-[11px] opacity-60">Never</span>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="pr-6 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* Audit Logs Link */}
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="View user activity in Audit Logs"
                        >
                          <Link to="/audit-logs">
                            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                          </Link>
                        </Button>

                        {/* Reset Password */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 cursor-pointer"
                          title="Reset Password"
                          onClick={() => {
                            setUserToReset(user);
                            setNewPassword("");
                            setShowResetPassword(false);
                            setResetOpen(true);
                          }}
                        >
                          <Key className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                        </Button>

                        {/* Delete User */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 cursor-pointer text-muted-foreground hover:text-rose-600"
                              disabled={isSelf}
                              title={
                                isSelf
                                  ? "You cannot delete your own account"
                                  : "Delete user"
                              }
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete User Account?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently remove <strong>{user.email}</strong> and all
                                associated credentials, profile attributes, and role assignments.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteUser(user.id)}
                                disabled={deleting}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {deleting ? "Deleting..." : "Delete Account"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Password Reset Dialog */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              Reset User Password
            </DialogTitle>
            <DialogDescription>
              Set a new password for <strong className="text-foreground">{userToReset?.email}</strong>. The user will be able to sign in with this password immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label htmlFor="new-password" className="text-xs">New Password *</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[10px] text-primary gap-1"
                  onClick={() => setNewPassword(generatePassword())}
                >
                  <Sparkles className="h-2.5 w-2.5" /> Generate Secure Password
                </Button>
              </div>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showResetPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter a new password"
                  className="h-8 text-xs pr-8 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowResetPassword(!showResetPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showResetPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {newPassword && (
              <div className="flex items-center justify-between bg-muted/40 p-2 rounded text-xs">
                <span className="font-mono text-[11px] truncate mr-2">{newPassword}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] gap-1 shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(newPassword);
                    toast.success("Password copied to clipboard.");
                  }}
                >
                  <Copy className="h-2.5 w-2.5" /> Copy
                </Button>
              </div>
            )}
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" size="sm" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => resetPassword()} disabled={resetting || !newPassword || newPassword.length < 6}>
              {resetting ? "Resetting..." : "Save Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
