import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AuditService } from "@/lib/services/audit.service";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ReconciliationExceptionLifecycleStatus,
  ReconciliationExceptionRow,
  ReconciliationService,
} from "@/lib/services/reconciliation.service";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export interface DurableExceptionsWorkbenchProps {
  selectedCompanyIds: string[];
  canApproveVariance: boolean;
  canEditExceptions: boolean;
}

export function DurableExceptionsWorkbench({
  selectedCompanyIds,
  canApproveVariance,
  canEditExceptions,
}: DurableExceptionsWorkbenchProps) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [approvingRow, setApprovingRow] = useState<any | null>(null);
  const [approvalReason, setApprovalReason] = useState<string>("");
  const [isApproving, setIsApproving] = useState(false);

  const [resolvingExc, setResolvingExc] = useState<ReconciliationExceptionRow | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState<string>("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [slaDeadline, setSlaDeadline] = useState<string>("");
  const [nextExcStatus, setNextExcStatus] =
    useState<ReconciliationExceptionLifecycleStatus>("Resolved");
  const [todayIso] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const singleCompanyId = selectedCompanyIds.length === 1 ? selectedCompanyIds[0] : null;

  const {
    data: excData,
    isLoading: isLoadingExc,
    refetch: refetchExc,
  } = useQuery({
    queryKey: ["reconciliation_exceptions", singleCompanyId, statusFilter],
    queryFn: () =>
      ReconciliationService.getDurableExceptions({
        companyId: singleCompanyId,
        status: statusFilter === "all" ? undefined : statusFilter,
        limit: 100,
      }),
  });

  const { data: profilesMap = {} } = useQuery({
    queryKey: ["audit_user_profiles_exceptions"],
    queryFn: () => AuditService.getUserProfiles(),
  });

  const {
    data: varianceRows = [],
    isLoading: isLoadingVar,
    refetch: refetchVar,
  } = useQuery({
    queryKey: ["reconciliation_variances_pending", selectedCompanyIds],
    queryFn: async () => {
      let q = (supabase as any)
        .from("reconciliation_results")
        .select(
          "id, run_id, company_id, payable_id, payable_type, source_reference, reconciliation_date, expected_amount, actual_amount, difference, result, requires_manual_approval, matched_by, notes, client:clients(full_name, boid)",
        )
        .or("requires_manual_approval.eq.true,result.eq.Partial")
        .order("created_at", { ascending: false })
        .limit(50);

      if (selectedCompanyIds.length === 1) q = q.eq("company_id", selectedCompanyIds[0]);
      else if (selectedCompanyIds.length > 1) q = q.in("company_id", selectedCompanyIds);

      const { data, error } = await q;
      if (error) {
        console.warn("Variance queue query warning:", error.message);
        return [];
      }
      return data || [];
    },
  });

  const exceptions = excData?.exceptions || [];
  const operatorsList = Object.values(profilesMap);

  const handleUpdateException = async () => {
    if (!resolvingExc) return;

    let ok = true;
    if (assigneeId && assigneeId !== "__unassigned__") {
      ok = await ReconciliationService.assignException(
        resolvingExc.id,
        assigneeId,
        slaDeadline || undefined,
      );
    }

    const updated = await ReconciliationService.updateExceptionStatus(
      resolvingExc.id,
      nextExcStatus,
      resolutionNotes || undefined,
      nextExcStatus === "Resolved" || nextExcStatus === "Accepted"
        ? resolutionNotes || "Resolved via Exception Workbench"
        : undefined,
    );

    if (ok && updated) {
      toast.success(`Exception updated (${nextExcStatus}).`);
      setResolvingExc(null);
      setResolutionNotes("");
      setAssigneeId("");
      setSlaDeadline("");
      qc.invalidateQueries({ queryKey: ["reconciliation_exceptions"] });
    } else {
      toast.error("Failed to update exception status or assignment.");
    }
  };

  const handleApproveVariance = async () => {
    if (!approvingRow) return;
    if (approvalReason.trim().length < 5) {
      toast.error("Enter a detailed Checker approval reason (minimum 5 characters).");
      return;
    }
    setIsApproving(true);
    try {
      await ReconciliationService.approveVariance({
        resultId: approvingRow.id,
        runId: approvingRow.run_id,
        payableId: approvingRow.payable_id,
        sourceReference: approvingRow.source_reference,
        approvalReason: approvalReason.trim(),
      });
      toast.success("Variance approved via Maker-Checker verification.");
      setApprovingRow(null);
      setApprovalReason("");
      qc.invalidateQueries({ queryKey: ["reconciliation_variances_pending"] });
      qc.invalidateQueries({ queryKey: ["brs_statement"] });
    } catch (err: any) {
      toast.error(err?.message || "Variance approval rejected.");
    } finally {
      setIsApproving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Durable Exceptions Queue
              </CardTitle>
              <CardDescription className="text-xs">
                Persistent cross-run reconciliation exceptions with assignee tracking, lifecycle
                status, and SLA deadlines.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="Open">Open</SelectItem>
                  <SelectItem value="Investigating">Investigating</SelectItem>
                  <SelectItem value="Escalated">Escalated</SelectItem>
                  <SelectItem value="Accepted">Accepted</SelectItem>
                  <SelectItem value="Resolved">Resolved</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  refetchExc();
                  refetchVar();
                }}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Exception Reason</TableHead>
                  <TableHead className="text-right">Amount (NPR)</TableHead>
                  <TableHead>Owner &amp; Status</TableHead>
                  <TableHead>SLA Deadline</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingExc ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-6 text-center text-xs text-muted-foreground"
                    >
                      Loading persistent exceptions...
                    </TableCell>
                  </TableRow>
                ) : exceptions.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-6 text-center text-xs text-muted-foreground"
                    >
                      No durable exceptions recorded for this scope.
                    </TableCell>
                  </TableRow>
                ) : (
                  exceptions.map((exc) => {
                    const owner = exc.assigned_to ? profilesMap[exc.assigned_to] : undefined;
                    const isOverdue =
                      Boolean(exc.deadline) &&
                      !["Resolved", "Accepted"].includes(exc.status) &&
                      String(exc.deadline).slice(0, 10) < todayIso;
                    return (
                      <TableRow key={exc.id}>
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                          {new Date(exc.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {exc.source_reference || exc.id.slice(0, 8)}
                        </TableCell>
                        <TableCell className="text-xs max-w-md">{exc.exception_reason}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {exc.amount != null
                            ? Number(exc.amount).toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                              })
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge
                              variant={
                                exc.status === "Resolved" || exc.status === "Accepted"
                                  ? "default"
                                  : exc.status === "Escalated" || exc.status === "Rejected"
                                    ? "destructive"
                                    : "outline"
                              }
                              className="text-[10px] w-fit"
                            >
                              {exc.status}
                            </Badge>
                            {owner && (
                              <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                                Owner: {owner.full_name}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {exc.deadline ? (
                            <span
                              className={
                                isOverdue
                                  ? "text-destructive font-semibold"
                                  : "text-muted-foreground"
                              }
                            >
                              {new Date(exc.deadline).toLocaleDateString()}
                              {isOverdue ? " (Overdue)" : ""}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {canEditExceptions && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => {
                                setResolvingExc(exc);
                                setNextExcStatus(
                                  exc.status === "Open" ? "Investigating" : "Resolved",
                                );
                                setAssigneeId(exc.assigned_to || "__unassigned__");
                                setSlaDeadline(
                                  exc.deadline ? String(exc.deadline).slice(0, 10) : "",
                                );
                                setResolutionNotes(exc.resolution_notes || exc.notes || "");
                              }}
                            >
                              Assign / Update
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Maker-Checker Variance Approvals
          </CardTitle>
          <CardDescription className="text-xs">
            Partial/variance matches flagged for Checker sign-off (
            <code>approve_reconciliation_variance_atomic</code> — Admin / Supervisor with strict
            Maker ≠ Checker).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Beneficiary / Reference</TableHead>
                  <TableHead className="text-right">Expected (NPR)</TableHead>
                  <TableHead className="text-right">Actual (NPR)</TableHead>
                  <TableHead className="text-right">Variance (NPR)</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Checker Sign-off</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingVar ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-6 text-center text-xs text-muted-foreground"
                    >
                      Loading variance approvals...
                    </TableCell>
                  </TableRow>
                ) : varianceRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-6 text-center text-xs text-muted-foreground"
                    >
                      No variances pending Checker approval.
                    </TableCell>
                  </TableRow>
                ) : (
                  varianceRows.map((row: any) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.reconciliation_date}</TableCell>
                      <TableCell className="text-xs">
                        <div className="font-medium">
                          {row.client?.full_name || row.source_reference || row.id.slice(0, 8)}
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground">
                          {row.client?.boid ? `BOID ${row.client.boid} • ` : ""}
                          {row.payable_type}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {Number(row.expected_amount || 0).toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {Number(row.actual_amount || 0).toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold text-amber-600">
                        {Number(row.difference || 0).toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={row.requires_manual_approval ? "destructive" : "default"}
                          className="text-[10px]"
                        >
                          {row.requires_manual_approval ? "Pending Checker" : row.result}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {row.requires_manual_approval && canApproveVariance ? (
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 text-xs"
                            onClick={() => {
                              setApprovingRow(row);
                              setApprovalReason("");
                            }}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                            Approve Variance
                          </Button>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            {row.requires_manual_approval ? "Supervisor / Admin Only" : "Cleared"}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Exception Update & SLA Assignment Dialog */}
      <Dialog open={Boolean(resolvingExc)} onOpenChange={(o) => !o && setResolvingExc(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Assign &amp; Update Reconciliation Exception
            </DialogTitle>
            <DialogDescription className="text-xs">
              {resolvingExc?.exception_reason}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label className="text-xs">Assignee (Owner)</Label>
                <Select value={assigneeId} onValueChange={setAssigneeId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__" className="text-xs">
                      Unassigned
                    </SelectItem>
                    {operatorsList.map((op) => (
                      <SelectItem key={op.id} value={op.id} className="text-xs">
                        {op.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">SLA Deadline</Label>
                <Input
                  type="date"
                  value={slaDeadline}
                  onChange={(e) => setSlaDeadline(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Lifecycle Status</Label>
              <Select
                value={nextExcStatus}
                onValueChange={(v) => setNextExcStatus(v as ReconciliationExceptionLifecycleStatus)}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Open">Open</SelectItem>
                  <SelectItem value="Investigating">Investigating</SelectItem>
                  <SelectItem value="Escalated">Escalated</SelectItem>
                  <SelectItem value="Accepted">Accepted</SelectItem>
                  <SelectItem value="Resolved">Resolved</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Investigation / Resolution Notes</Label>
              <Textarea
                rows={3}
                placeholder="Resolution notes or audit findings..."
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setResolvingExc(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleUpdateException}>
              Save Assignment &amp; Status
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve Variance Dialog */}
      <Dialog open={Boolean(approvingRow)} onOpenChange={(o) => !o && setApprovingRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Checker Variance Approval</DialogTitle>
            <DialogDescription className="text-xs">
              Verify tolerance variance of NPR{" "}
              {Number(approvingRow?.difference || 0).toLocaleString("en-IN", {
                minimumFractionDigits: 2,
              })}{" "}
              (Maker-Checker &amp; role threshold validated server-side).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Input
              placeholder="Mandatory Checker approval reason (min 5 chars)..."
              value={approvalReason}
              onChange={(e) => setApprovalReason(e.target.value)}
              className="text-xs"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setApprovingRow(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={isApproving} onClick={handleApproveVariance}>
              {isApproving ? "Authorizing..." : "Approve Variance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
