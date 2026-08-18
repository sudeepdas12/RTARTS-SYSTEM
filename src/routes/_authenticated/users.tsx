import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { Shield, UserPlus, Settings2, Key, Trash2 } from "lucide-react";
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
  admin: "bg-red-100 text-red-800",
  supervisor: "bg-violet-100 text-violet-800",
  approver: "bg-green-100 text-green-800",
  checker: "bg-blue-100 text-blue-800",
  maker: "bg-yellow-100 text-yellow-800",
  operator: "bg-indigo-100 text-indigo-800",
  finance_operator: "bg-indigo-100 text-indigo-800",
  reconciliation_officer: "bg-cyan-100 text-cyan-800",
  auditor: "bg-purple-100 text-purple-800",
  report_viewer: "bg-gray-100 text-gray-700",
  read_only: "bg-gray-100 text-gray-700",
};

function UsersRoute() {
  const qc = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("operator");
  const [inviteOpen, setInviteOpen] = useState(false);

  // Password reset dialog state
  const [resetOpen, setResetOpen] = useState(false);
  const [userToReset, setUserToReset] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const {
    data: users,
    isLoading,
    isError,
    isFetching,
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
      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
      setInviteName("");
      setInviteOpen(false);
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
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => {
      toast.error("Failed to update role", { description: e.message });
    },
  });

  const { mutate: resetPassword, isPending: resetting } = useMutation({
    mutationFn: async () => {
      if (!userToReset || !newPassword) return;
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
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <PageHeader
          title="User Management"
          description="Manage administrators, operators, and viewers across the platform."
        />

        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
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

      <div className="border rounded-lg bg-card">
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
                <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                  Loading users...
                </TableCell>
              </TableRow>
            ) : !users || users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>{initials(user.full_name, user.email)}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="font-medium text-sm">{user.full_name || "Unknown"}</span>
                        <span className="text-xs text-muted-foreground">{user.email}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={user.role || ""}
                      onValueChange={(val) => updateRole({ userId: user.id, role: val as AppRole })}
                      disabled={updating}
                    >
                      <SelectTrigger className="w-40 h-8 text-xs border-transparent hover:border-border">
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
                        className="bg-emerald-50 text-emerald-600 border-emerald-200"
                      >
                        Active
                      </Badge>
                    ) : user.invited_at ? (
                      <Badge
                        variant="outline"
                        className="bg-amber-50 text-amber-600 border-amber-200"
                      >
                        Invited
                      </Badge>
                    ) : (
                      <Badge variant="outline">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
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
                        onClick={() => {
                          setUserToReset(user);
                          setNewPassword("");
                          setResetOpen(true);
                        }}
                        title="Reset password"
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
