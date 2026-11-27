import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { RBACService, UserContext } from "@/lib/rbac-service";
import { WorkflowEngine } from "@/lib/workflow-engine";
import { ReconciliationService } from "@/lib/services/reconciliation.service";
// import { ChunkProcessor } from "@/lib/chunk-processor";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
  X,
  ExternalLink,
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
  const [showRawPayload, setShowRawPayload] = useState(false);

  const currentUser: UserContext | null = user
    ? { id: user.id, roles: (roles as any) || ["read_only"] }
    : null;
  const canApprove = RBACService.canApprove(currentUser, "approvals");

  const { data: actorProfiles = [] } = useQuery({
    queryKey: ["approvals_actor_profiles"],
    queryFn: () => ReconciliationService.getCompanyOperators(null),
    staleTime: 15_000,
  });

  const actorMap = useMemo(() => {
    const map = new Map<string, { full_name: string | null; email: string | null }>();
    actorProfiles.forEach((p) => map.set(p.id, p));
    return map;
  }, [actorProfiles]);

  const formatActorLabel = (actorId: string | null) => {
    if (!actorId) return "System / Legacy";
    const prof = actorMap.get(actorId);
    const name = prof?.full_name?.trim();
    const email = prof?.email?.trim();
    if (name && email) return `${name} (${email})`;
    return email || name || actorId.slice(0, 8);
  };

  // Fetch all approvals so KPI cards are always accurate
  const { data: allRows = [], isLoading } = useQuery({
    queryKey: ["pending_approvals_all"],
    queryFn: async () => {
      const [pendingApprovalsRes, paymentBatchesRes] = await Promise.all([
        supabase
          .from("pending_approvals")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200),
        (supabase as any)
          .from("payment_batches")
          .select(
            "id, batch_name, total_amount, total_payments, status, created_at, created_by, payment_method",
          )
          .order("created_at", { ascending: false })
          .limit(200),
      ]);

      const rows: Row[] = [...((pendingApprovalsRes.data ?? []) as Row[])];
      const existingEntityIds = new Set(rows.map((r) => r.entity_id).filter(Boolean));

      // Synthesize payment batches so batches in workflow are always visible
      (paymentBatchesRes.data || []).forEach((batch: any) => {
        if (!existingEntityIds.has(batch.id)) {
          let rowStatus: Status = "Pending";
          if (
            batch.status === "Approved" ||
            batch.status === "Processed" ||
            batch.status === "Completed"
          ) {
            rowStatus = "Approved";
          } else if (batch.status === "Rejected") {
            rowStatus = "Rejected";
          } else if (batch.status === "Draft") {
            return; // Drafts stay in Payments until submitted
          }

          rows.push({
            id: `batch-${batch.id}`,
            entity_type: "payment_batches",
            entity_id: batch.id,
            action: `Payment Batch (${batch.payment_method || "ConnectIPS"})`,
            payload: {
              batch_name: batch.batch_name,
              total_amount: batch.total_amount,
              total_payments: batch.total_payments,
              payment_method: batch.payment_method,
              batch_status: batch.status,
            },
            status: rowStatus,
            review_notes: null,
            requested_by: batch.created_by || null,
            reviewed_by: null,
            reviewed_at: null,
            created_at: batch.created_at || new Date().toISOString(),
          });
        }
      });

      return rows.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
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
      list = list.filter((r) => {
        const prof = r.requested_by ? actorMap.get(r.requested_by) : undefined;
        return (
          r.entity_type?.toLowerCase().includes(q) ||
          r.action?.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q) ||
          prof?.full_name?.toLowerCase().includes(q) ||
          prof?.email?.toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [allRows, status, searchTerm, actorMap]);

  const canApproveViewing = viewing
    ? RBACService.canApprove(
        currentUser,
        viewing.entity_type === "IMPORT_BATCH" || viewing.action === "MATERIAL_IMPORT_APPROVAL"
          ? "IMPORT_BATCH"
          : viewing.entity_type,
      )
    : canApprove;

  const isSelfSubmission = Boolean(
    viewing?.status === "Pending" && viewing.requested_by && user?.id === viewing.requested_by,
  );

  const decide = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "Approved" | "Rejected" }) => {
      if (!viewing) return;

      if (viewing.entity_type === "manual_reconciliation") {
        await ReconciliationService.decideManualReconciliation(id, decision, notes || undefined);
        return;
      }

      const entityId =
        viewing.entity_id || (id.startsWith("batch-") ? id.replace("batch-", "") : null);

      // If this is a payment batch workflow, invoke the WorkflowEngine
      if (viewing.entity_type === "payment_batches" && entityId) {
        const res = await WorkflowEngine.processAction(
          entityId,
          "payment_batches",
          decision === "Approved" ? "approve" : "reject",
          notes || undefined,
          currentUser,
        );
        if (!res.success) {
          throw new Error(res.error || "Workflow transition failed");
        }
      }

      // If this is a material import approval, process atomic server-side commit/rejection
      if (viewing.entity_type === "IMPORT_BATCH" || viewing.action === "MATERIAL_IMPORT_APPROVAL") {
        if (decision === "Approved") {
          const { data: rpcRes, error: rpcErr } = await (supabase as any).rpc(
            "commit_staged_import",
            {
              p_approval_id: id,
              p_checker_notes: notes || null,
            },
          );
          if (rpcErr) {
            throw new Error(`Atomic commit failed: ${rpcErr.message}`);
          }
          if (rpcRes && rpcRes.success === false) {
            throw new Error(rpcRes.error || "Material import commit rejected by database");
          }
        } else {
          const { error: rpcErr } = await (supabase as any).rpc("reject_staged_import", {
            p_approval_id: id,
            p_rejection_notes: notes || null,
          });
          if (rpcErr) {
            await (supabase as any)
              .from("import_staging")
              .update({ status: "REJECTED" })
              .eq("approval_id", id);
          }
        }
      }

      // Update pending_approvals record if not synthetic
      if (!id.startsWith("batch-")) {
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
      }
    },
    onSuccess: (_, variables) => {
      toast.success(`Request ${variables.decision.toLowerCase()} successfully`);
      setViewing(null);
      setNotes("");
      qc.invalidateQueries({ queryKey: ["pending_approvals_all"] });
      qc.invalidateQueries({ queryKey: ["pending_batches_count"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["dividend_payables"] });
      qc.invalidateQueries({ queryKey: ["interest_payables"] });
      qc.invalidateQueries({ queryKey: ["mutual_fund_payables"] });
      qc.invalidateQueries({ queryKey: ["bank_statement_transactions"] });
      qc.invalidateQueries({ queryKey: ["reconciliation_exceptions"] });
      qc.invalidateQueries({ queryKey: ["brs_statement"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      qc.invalidateQueries({ queryKey: ["dashboard-operational-metrics"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-6 p-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <PageHeader
          title="Pending Approvals"
          description="Maker-checker authorization workflow — dual-control review and approval for payment batches and operational ledger updates."
        />
        {!canApprove && (
          <Badge
            variant="outline"
            className="text-xs bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300"
          >
            View-only access (Approver / Supervisor / Admin role required to decide)
          </Badge>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="glass-card hover-lift border border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Pending Review & Authorization
              </p>
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
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Approved Requests
              </p>
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
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Rejected Requests
              </p>
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
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Pending Payment Batches
              </p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1 tabular-nums">
                {pendingBatches.length}
              </p>
              <Link
                to="/payments"
                className="text-[11px] text-primary hover:underline mt-0.5 inline-block"
              >
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
              <TableHead>Requested By</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Review Notes</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Loading approval items…
                </TableCell>
              </TableRow>
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
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
                  <TableCell className="text-xs">
                    <span className="font-medium text-foreground">
                      {formatActorLabel(r.requested_by)}
                    </span>
                    {r.requested_by && user?.id === r.requested_by && (
                      <Badge
                        variant="outline"
                        className="ml-1.5 text-[10px] border-amber-300 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      >
                        You
                      </Badge>
                    )}
                  </TableCell>
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
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="p-6 pb-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Approval Request Review
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs bg-muted/40 p-3 rounded-lg border">
                <div>
                  <span className="text-muted-foreground font-medium">Entity Type:</span>{" "}
                  <span className="font-semibold capitalize">
                    {viewing.entity_type.replace(/_/g, " ")}
                  </span>
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
                <div className="col-span-2">
                  <span className="text-muted-foreground font-medium">Requested By (Maker):</span>{" "}
                  <span className="font-medium text-foreground">
                    {formatActorLabel(viewing.requested_by)}
                  </span>
                  {isSelfSubmission && (
                    <Badge
                      variant="outline"
                      className="ml-2 text-[10px] border-amber-400 bg-amber-500/15 text-amber-800 dark:text-amber-300"
                    >
                      Submitted by You
                    </Badge>
                  )}
                </div>
              </div>

              {typeof viewing.payload === "object" && viewing.payload !== null && (
                <div className="rounded-lg border bg-card p-3.5 shadow-sm space-y-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Operational Details
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                    {(viewing.payload as any).batch_name && (
                      <div className="col-span-full p-2.5 rounded bg-muted/30 border">
                        <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                          Batch Name
                        </span>
                        <span className="font-semibold text-foreground text-sm">
                          {(viewing.payload as any).batch_name}
                        </span>
                      </div>
                    )}
                    {(viewing.payload as any).total_amount !== undefined && (
                      <div className="p-2.5 rounded bg-muted/30 border">
                        <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                          Total Amount
                        </span>
                        <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400 text-sm tabular-nums">
                          NPR{" "}
                          {Number((viewing.payload as any).total_amount || 0).toLocaleString(
                            "en-IN",
                            { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                          )}
                        </span>
                      </div>
                    )}
                    {(viewing.payload as any).total_payments !== undefined && (
                      <div className="p-2.5 rounded bg-muted/30 border">
                        <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                          Transactions
                        </span>
                        <span className="font-bold font-mono text-foreground text-sm tabular-nums">
                          {Number((viewing.payload as any).total_payments || 0).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {(viewing.payload as any).payment_method && (
                      <div className="p-2.5 rounded bg-muted/30 border">
                        <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                          Method
                        </span>
                        <span className="font-semibold capitalize text-foreground text-sm">
                          {(viewing.payload as any).payment_method}
                        </span>
                      </div>
                    )}
                    {(viewing.payload as any).file_name && (
                      <div className="col-span-full p-2.5 rounded bg-muted/30 border">
                        <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                          File Name
                        </span>
                        <span className="font-mono text-xs text-foreground">
                          {(viewing.payload as any).file_name}
                        </span>
                      </div>
                    )}
                    {(viewing.payload as any).sheet_name && (
                      <div className="p-2.5 rounded bg-muted/30 border">
                        <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                          Sheet
                        </span>
                        <span className="font-mono text-xs">
                          {(viewing.payload as any).sheet_name}
                        </span>
                      </div>
                    )}
                    {(viewing.payload as any).staged_rows !== undefined && (
                      <div className="p-2.5 rounded bg-muted/30 border">
                        <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                          Staged Records
                        </span>
                        <span className="font-bold font-mono text-foreground tabular-nums">
                          {Number((viewing.payload as any).staged_rows || 0).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {viewing.entity_type === "manual_reconciliation" && (
                      <>
                        {(viewing.payload as any).reference && (
                          <div className="p-2.5 rounded bg-muted/30 border">
                            <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                              Bank / Voucher Reference
                            </span>
                            <span className="font-mono font-semibold text-xs text-foreground">
                              {(viewing.payload as any).reference}
                            </span>
                          </div>
                        )}
                        {(viewing.payload as any).reason_code && (
                          <div className="p-2.5 rounded bg-muted/30 border">
                            <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                              Reason Code
                            </span>
                            <Badge variant="outline" className="mt-0.5 font-mono text-[10px]">
                              {(viewing.payload as any).reason_code}
                            </Badge>
                          </div>
                        )}
                        {(viewing.payload as any).transaction_date && (
                          <div className="p-2.5 rounded bg-muted/30 border">
                            <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                              Transaction Date
                            </span>
                            <span className="font-mono text-xs text-foreground">
                              {(viewing.payload as any).transaction_date}
                            </span>
                          </div>
                        )}
                        {((viewing.payload as any).bank_total_amount !== undefined ||
                          (viewing.payload as any).debit_amount !== undefined ||
                          (viewing.payload as any).credit_amount !== undefined) && (
                          <div className="p-2.5 rounded bg-muted/30 border">
                            <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                              Voucher / Bank Amount
                            </span>
                            <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400 text-sm tabular-nums">
                              NPR{" "}
                              {Number(
                                (viewing.payload as any).bank_total_amount ??
                                  Math.max(
                                    Number((viewing.payload as any).debit_amount || 0),
                                    Number((viewing.payload as any).credit_amount || 0),
                                  ),
                              ).toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          </div>
                        )}
                        {(viewing.payload as any).alloc_count !== undefined && (
                          <div className="p-2.5 rounded bg-muted/30 border">
                            <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                              Paired Payables ({Number((viewing.payload as any).alloc_count || 0)})
                            </span>
                            <span className="font-bold font-mono text-foreground text-sm tabular-nums">
                              NPR{" "}
                              {Number((viewing.payload as any).alloc_total || 0).toLocaleString(
                                "en-IN",
                                { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                              )}
                            </span>
                          </div>
                        )}
                        {(viewing.payload as any).notes && (
                          <div className="col-span-full p-2.5 rounded bg-muted/30 border">
                            <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                              Maker Justification Notes
                            </span>
                            <span className="text-xs text-foreground">
                              {(viewing.payload as any).notes}
                            </span>
                          </div>
                        )}
                        {(viewing.payload as any).evidence_path && (
                          <div className="col-span-full flex items-center justify-between p-2.5 rounded bg-primary/5 border border-primary/20">
                            <div>
                              <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                                Supporting Evidence Attachment
                              </span>
                              <span className="font-mono text-[11px] text-foreground truncate max-w-md block">
                                {(viewing.payload as any).evidence_path}
                              </span>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs shrink-0"
                              onClick={async () => {
                                try {
                                  const url = await ReconciliationService.getEvidenceSignedUrl(
                                    (viewing.payload as any).evidence_path,
                                  );
                                  window.open(url, "_blank", "noopener,noreferrer");
                                } catch (err: any) {
                                  toast.error(err?.message || "Failed to load supporting document");
                                }
                              }}
                            >
                              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                              Open Voucher
                            </Button>
                          </div>
                        )}
                        {Array.isArray((viewing.payload as any).allocations) &&
                          (viewing.payload as any).allocations.length > 0 && (
                            <div className="col-span-full rounded border bg-background overflow-hidden">
                              <div className="px-2.5 py-1.5 bg-muted/40 border-b text-[10px] font-semibold uppercase text-muted-foreground">
                                Allocated Payables to Settle Upon Approval
                              </div>
                              <div className="divide-y max-h-40 overflow-y-auto">
                                {(viewing.payload as any).allocations.map(
                                  (alloc: any, aIdx: number) => (
                                    <div
                                      key={alloc.payable_id || aIdx}
                                      className="flex items-center justify-between px-2.5 py-1.5 text-xs"
                                    >
                                      <div className="min-w-0">
                                        <span className="font-medium text-foreground">
                                          {alloc.shareholder_name || alloc.payable_id}
                                        </span>
                                        <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                                          {alloc.boid ? `BOID ${alloc.boid} • ` : ""}
                                          {alloc.payable_type}
                                        </span>
                                      </div>
                                      <span className="font-mono font-semibold text-foreground shrink-0">
                                        NPR{" "}
                                        {Number(alloc.amount || 0).toLocaleString("en-IN", {
                                          minimumFractionDigits: 2,
                                        })}
                                      </span>
                                    </div>
                                  ),
                                )}
                              </div>
                            </div>
                          )}
                      </>
                    )}
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Payload Details
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px] px-2 text-muted-foreground"
                    onClick={() => setShowRawPayload((v) => !v)}
                  >
                    {showRawPayload ? "Hide Raw JSON" : "View Raw JSON"}
                  </Button>
                </div>
                {showRawPayload && (
                  <pre className="max-h-60 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs font-mono">
                    {JSON.stringify(viewing.payload, null, 2)}
                  </pre>
                )}
              </div>

              {isSelfSubmission && (
                <div
                  role="alert"
                  className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                  <div>
                    <div className="font-semibold">
                      Self-Approval Blocked (Maker-Checker Dual Control)
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed">
                      This request was submitted by your account (
                      <span className="font-medium">{formatActorLabel(viewing.requested_by)}</span>
                      ). For dual-control compliance, even an Admin cannot approve or reject their
                      own submission. Sign in with another authorized Admin, Supervisor, Approver,
                      or Checker account to complete review.
                    </p>
                  </div>
                </div>
              )}

              <div>
                <div className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Reviewer Notes / Remarks
                </div>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Enter remarks or justification for this decision (optional for approval, recommended for rejection)..."
                  disabled={viewing.status !== "Pending" || !canApproveViewing || isSelfSubmission}
                  className="text-xs"
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter className="p-4 border-t bg-muted/20 shrink-0 gap-2 flex items-center justify-between">
            {isSelfSubmission && (
              <span className="text-[11px] text-amber-700 dark:text-amber-400 font-medium mr-auto">
                Maker-Checker: Another Admin, Supervisor, Approver, or Checker must decide this
                submission.
              </span>
            )}
            <div className="flex gap-2 ml-auto">
              {viewing?.status === "Pending" && canApproveViewing ? (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={decide.isPending || isSelfSubmission}
                    title={
                      isSelfSubmission
                        ? "Maker-Checker blocks self-rejection of your own submission"
                        : undefined
                    }
                    onClick={() => decide.mutate({ id: viewing.id, decision: "Rejected" })}
                  >
                    <XCircle className="mr-1.5 h-4 w-4" />
                    Reject Request
                  </Button>
                  <Button
                    size="sm"
                    disabled={decide.isPending || isSelfSubmission}
                    title={
                      isSelfSubmission
                        ? "Maker-Checker blocks self-approval of your own submission"
                        : undefined
                    }
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
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
