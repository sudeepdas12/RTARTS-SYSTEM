import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { RBACService, UserContext } from "@/lib/rbac-service";
import { WorkflowEngine } from "@/lib/workflow-engine";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Eye,
  ShieldCheck,
  Clock,
  AlertTriangle,
  Wallet,
  FileCheck,
  Search,
  X
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/approvals")({
  component: ApprovalsPage,
});

type Status = "Pending" | "Approved" | "Rejected";

type Row = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  payload: unknown;
  status: Status;
  review_notes: string | null;
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

function ApprovalsPage() {
  const qc = useQueryClient();
  const { user, roles } = useAuth();
  const [status, setStatus] = useState<Status | "all">("Pending");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewing, setViewing] = useState<Row | null>(null);
  const [notes, setNotes] = useState("");

  const currentUser: UserContext | null = user
    ? { id: user.id, roles: (roles as any) || ["read_only"] }
    : null;
  const canApprove = RBACService.canApprove(currentUser, "approvals");

  // Fetch all approvals so KPI cards are always accurate
  const { data: allRows = [], isLoading } = useQuery({
    queryKey: ["pending_approvals_all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_approvals")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  // Also query pending payment batches to ensure maker-checker sync
  const { data: pendingBatches = [] } = useQuery({
    queryKey: ["pending_batches_count"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("payment_batches")
        .select("id, batch_name, total_amount, status, created_at, created_by")
        .eq("status", "Pending");
      return data || [];
    },
  });

  const counts = useMemo(() => {
    const c = { Pending: 0, Approved: 0, Rejected: 0 };
    allRows.forEach((r) => {
      if (r.status in c) {
        c[r.status as keyof typeof c] += 1;
      }
    });
    return c;
  }, [allRows]);

  const filteredRows = useMemo(() => {
    let list = allRows;
    if (status !== "all") {
      list = list.filter((r) => r.status === status);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (r) =>
          r.entity_type?.toLowerCase().includes(q) ||
          r.action?.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allRows, status, searchTerm]);

  const decide = useMutation({
    mutationFn: async ({
      id,
      decision,
    }: {
      id: string;
      decision: "Approved" | "Rejected";
    }) => {
      if (!viewing) return;

      // If this is a payment batch workflow, invoke the WorkflowEngine
      if (viewing.entity_type === "payment_batches" && viewing.entity_id) {
        const res = await WorkflowEngine.processAction(
          viewing.entity_id,
          "payment_batches",
          decision === "Approved" ? "approve" : "reject",
          notes || undefined,
          currentUser
        );
        if (!res.success) {
          throw new Error(res.error || "Workflow transition failed");
        }
      }

      // Update pending_approvals record
      const { error } = await supabase
        .from("pending_approvals")
        .update({
          status: decision,
          review_notes: notes || null,
          reviewed_by: user?.id ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      toast.success(`Request ${variables.decision.toLowerCase()} successfully`);
      setViewing(null);
      setNotes("");
      qc.invalidateQueries({ queryKey: ["pending_approvals_all"] });
      qc.invalidateQueries({ queryKey: ["pending_batches_count"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-6 p-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <PageHeader
          title="Pending Approvals"
          description="Maker/checker workflow — authorized roles review changes and batches requested by operators."
        />
        {!canApprove && (
          <Badge variant="outline" className="text-xs bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300">
            View-only access (Approver / Supervisor / Admin role required to decide)
          </Badge>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Pending Review</p>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1 tabular-nums">
                {counts.Pending}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Awaiting decision</p>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Clock className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Approved</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 tabular-nums">
                {counts.Approved}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Verified & executed</p>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Rejected</p>
              <p className="text-2xl font-bold text-destructive mt-1 tabular-nums">
                {counts.Rejected}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Returned to requester</p>
            </div>
            <div className="p-2.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
              <XCircle className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Pending Payment Batches</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1 tabular-nums">
                {pendingBatches.length}
              </p>
              <Link to="/payments" className="text-[11px] text-primary hover:underline mt-0.5 inline-block">
                View batches in Payments →
              </Link>
            </div>
            <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Wallet className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search approvals by entity or action…"
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
        <Select value={status} onValueChange={(v: Status | "all") => setStatus(v)}>
          <SelectTrigger className="w-44 h-8 text-xs">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="Pending">Pending ({counts.Pending})</SelectItem>
            <SelectItem value="Approved">Approved ({counts.Approved})</SelectItem>
            <SelectItem value="Rejected">Rejected ({counts.Rejected})</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Requested Date</TableHead>
              <TableHead>Entity Type</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Review Notes</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  Loading approval items…
                </TableCell>
              </TableRow>
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No approval requests found matching filter criteria.
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((r) => (
                <TableRow key={r.id} className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">
                    {new Date(r.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-medium capitalize">
                    <Badge variant="outline" className="font-sans text-[11px]">
                      {r.entity_type.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs font-mono">{r.action}</TableCell>
                  <TableCell>
                    {r.status === "Pending" && (
                      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800 text-[11px]">
                        Pending
                      </Badge>
                    )}
                    {r.status === "Approved" && (
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 text-[11px]">
                        Approved
                      </Badge>
                    )}
                    {r.status === "Rejected" && (
                      <Badge variant="destructive" className="text-[11px]">
                        Rejected
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground truncate max-w-xs">
                    {r.review_notes || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-xs"
                      onClick={() => {
                        setViewing(r);
                        setNotes(r.review_notes ?? "");
                      }}
                    >
                      <Eye className="mr-1.5 h-3.5 w-3.5" /> Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Approval Request Review
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs bg-muted/40 p-3 rounded-lg border">
                <div>
                  <span className="text-muted-foreground font-medium">Entity Type:</span>{" "}
                  <span className="font-semibold capitalize">{viewing.entity_type.replace(/_/g, " ")}</span>
                </div>
                <div>
                  <span className="text-muted-foreground font-medium">Action:</span>{" "}
                  <span className="font-mono">{viewing.action}</span>
                </div>
                <div>
                  <span className="text-muted-foreground font-medium">Requested At:</span>{" "}
                  <span>{new Date(viewing.created_at).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground font-medium">Current Status:</span>{" "}
                  <span className="font-semibold">{viewing.status}</span>
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Payload Details
                </div>
                <pre className="max-h-60 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs font-mono">
                  {JSON.stringify(viewing.payload, null, 2)}
                </pre>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Reviewer Notes / Remarks
                </div>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Enter remarks or justification for this decision (optional for approval, recommended for rejection)..."
                  disabled={viewing.status !== "Pending" || !canApprove}
                  className="text-xs"
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {viewing?.status === "Pending" && canApprove ? (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: viewing.id, decision: "Rejected" })}
                >
                  <XCircle className="mr-1.5 h-4 w-4" />
                  Reject Request
                </Button>
                <Button
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: viewing.id, decision: "Approved" })}
                >
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                  Approve & Execute
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setViewing(null)}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}