import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { ReconciliationService } from "@/lib/services/reconciliation.service";
import { Download, Lock, Printer, RefreshCw, ShieldCheck, Unlock } from "lucide-react";
import { toast } from "sonner";

export interface BankReconciliationStatementPanelProps {
  companiesList: Array<{ id: string; company_name: string; company_code?: string | null }>;
  selectedCompanyIds: string[];
  selectedCompanyId?: string;
  onSelectCompanyId?: (id: string) => void;
  currentUserId?: string | null;
  canCertifyLock: boolean;
  isAdminOrSupervisor: boolean;
}

const fmtNpr = (val: number | undefined | null) =>
  `NPR ${Number(val || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function BankReconciliationStatementPanel({
  companiesList,
  selectedCompanyIds,
  selectedCompanyId,
  onSelectCompanyId,
  currentUserId,
  canCertifyLock,
  isAdminOrSupervisor,
}: BankReconciliationStatementPanelProps) {
  const qc = useQueryClient();
  const [localCompanyId, setLocalCompanyId] = useState<string>("");
  const effectiveManualId = selectedCompanyId || localCompanyId;
  const companyId =
    selectedCompanyIds.length === 1 && selectedCompanyIds[0]
      ? selectedCompanyIds[0]
      : effectiveManualId || companiesList[0]?.id || "";
  const setCompanyId = (id: string) => {
    setLocalCompanyId(id);
    setManualPeriodStart(null);
    setManualPeriodEnd(null);
    onSelectCompanyId?.(id);
  };
  const [manualPeriodStart, setManualPeriodStart] = useState<string | null>(null);
  const [manualPeriodEnd, setManualPeriodEnd] = useState<string | null>(null);

  const { data: txDateRange } = useQuery({
    queryKey: ["brs_tx_date_range", companyId],
    enabled: Boolean(currentUserId && companyId),
    queryFn: () => ReconciliationService.getCompanyBankTransactionDateRange(companyId),
  });

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const defaultPeriodStart = txDateRange?.minDate
    ? `${txDateRange.minDate.slice(0, 7)}-01`
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const defaultPeriodEnd =
    txDateRange?.maxDate && txDateRange.maxDate > today ? txDateRange.maxDate : today;

  const periodStart = manualPeriodStart ?? defaultPeriodStart;
  const periodEnd = manualPeriodEnd ?? defaultPeriodEnd;
  const [bankClosingInput, setBankClosingInput] = useState<string>("");
  const [fiscalYear, setFiscalYear] = useState<string>("2082/83");

  // Period Lock Dialog state
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [makerId, setMakerId] = useState<string>("");
  const [approvalNotes, setApprovalNotes] = useState<string>("");
  const [isLocking, setIsLocking] = useState(false);

  // Reopen Dialog state
  const [reopenTargetId, setReopenTargetId] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState<string>("");

  const parsedClosing = useMemo(() => {
    const trimmed = bankClosingInput.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }, [bankClosingInput]);

  const {
    data: brs,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["brs_statement", companyId, periodStart, periodEnd, parsedClosing],
    enabled: Boolean(
      currentUserId && companyId && periodStart && periodEnd && periodEnd >= periodStart,
    ),
    retry: false,
    queryFn: () =>
      ReconciliationService.getBankReconciliationStatement(
        companyId,
        periodStart,
        periodEnd,
        parsedClosing,
      ),
  });

  const { data: periodLocks = [] } = useQuery({
    queryKey: ["reconciliation_period_locks", companyId],
    enabled: Boolean(currentUserId && companyId),
    retry: false,
    queryFn: () => ReconciliationService.getLockedReconciliationPeriods(companyId),
  });

  const { data: operatorsList = [] } = useQuery({
    queryKey: ["company_operators_brs", companyId],
    enabled: Boolean(currentUserId),
    retry: false,
    queryFn: () => ReconciliationService.getCompanyOperators(companyId || null),
  });

  const distinctPreparers = useMemo(
    () => operatorsList.filter((p) => p.id !== currentUserId),
    [operatorsList, currentUserId],
  );

  const selectedCompanyName = useMemo(
    () => companiesList.find((c) => c.id === companyId)?.company_name || companyId,
    [companiesList, companyId],
  );

  const handleExportBrsExcel = () => {
    if (!brs) return;
    const summaryRows = [
      ["Official Bank Reconciliation Statement (BRS)", ""],
      ["Company / Fund Scheme", selectedCompanyName],
      ["Period Start", brs.period_start],
      ["Period End", brs.period_end],
      ["Period Status", brs.is_period_locked ? "Locked / Certified" : "Open"],
      [],
      ["Metric", "Amount (NPR) / Count"],
      ["Bank Statement Closing Balance", brs.bank_closing_balance],
      ["Total Bank Debits (Outflows)", brs.bank_total_debit],
      ["Total Bank Credits (Inflows)", brs.bank_total_credit],
      ["Reconciled Bank Debits (Settled Payouts)", brs.reconciled_bank_debits],
      ["Non-Payable Bank Debits (Fees/Sweeps)", brs.non_payable_bank_debits],
      ["Unreconciled Bank Debits", brs.unreconciled_bank_debits],
      ["Unreconciled Bank Credits", brs.unreconciled_bank_credits],
      ["Total Unreconciled Bank Variance", brs.unreconciled_variance],
      [
        "Pending Checker Manual Approvals",
        `${brs.pending_manual_count} (${brs.pending_manual_amount})`,
      ],
      ["System Ledger Paid Total", brs.ledger_paid_total],
      ["Approved/In-Transit Batches Unmatched", brs.in_transit_batches_amount],
      ["Open Durable Exceptions", `${brs.open_exceptions_count} (${brs.open_exceptions_amount})`],
      ["Unapproved Settlement Variances", brs.unapproved_variances_count],
    ];

    const agingRows = [
      ["Aging Bucket", "Unreconciled Count", "Amount (NPR)"],
      ["0 - 7 Days", brs.aging.days_0_7.count, brs.aging.days_0_7.amount],
      ["8 - 30 Days", brs.aging.days_8_30.count, brs.aging.days_8_30.amount],
      ["31 - 90 Days", brs.aging.days_31_90.count, brs.aging.days_31_90.amount],
      ["90+ Days", brs.aging.days_90_plus.count, brs.aging.days_90_plus.amount],
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "BRS Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(agingRows), "Aging Breakdown");
    XLSX.writeFile(wb, `BRS_${brs.period_start}_to_${brs.period_end}.xlsx`);
  };

  const handleLockPeriod = async () => {
    if (!companyId || !brs) return;
    if (!makerId) {
      toast.error("Select the distinct Maker/Preparer user before certifying this period lock.");
      return;
    }
    if (approvalNotes.trim().length < 5) {
      toast.error("Enter certification sign-off remarks (minimum 5 characters).");
      return;
    }

    setIsLocking(true);
    try {
      await ReconciliationService.lockReconciliationPeriod({
        companyId,
        fiscalYear: fiscalYear.trim() || undefined,
        periodStart,
        periodEnd,
        bankClosingBalance: parsedClosing,
        makerId,
        approvalNotes: approvalNotes.trim(),
      });
      toast.success(`Reconciliation period ${periodStart} to ${periodEnd} certified and locked.`);
      setLockModalOpen(false);
      setApprovalNotes("");
      qc.invalidateQueries({ queryKey: ["brs_statement"] });
      qc.invalidateQueries({ queryKey: ["reconciliation_period_locks"] });
    } catch (err: any) {
      toast.error(err?.message || "Failed to certify and lock period.");
    } finally {
      setIsLocking(false);
    }
  };

  const handleReopenPeriod = async () => {
    if (!reopenTargetId) return;
    try {
      await ReconciliationService.reopenReconciliationPeriod(reopenTargetId, reopenReason);
      toast.success("Locked reconciliation period reopened.");
      setReopenTargetId(null);
      setReopenReason("");
      qc.invalidateQueries({ queryKey: ["brs_statement"] });
      qc.invalidateQueries({ queryKey: ["reconciliation_period_locks"] });
    } catch (err: any) {
      toast.error(err?.message || "Failed to reopen period lock.");
    }
  };

  const isZeroVariance =
    brs !== undefined &&
    Math.abs(brs.unreconciled_variance) <= 0.05 &&
    brs.unapproved_variances_count === 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                Formal Bank Reconciliation Statement (BRS) &amp; Period Close
              </CardTitle>
              <CardDescription className="text-xs">
                Live cash proof reconciling bank outflows, ledger payouts, non-payable bank fees,
                and aged unreconciled items with Maker-Checker period locking.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleExportBrsExcel} disabled={!brs}>
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Export BRS (.xlsx)
              </Button>
              <Button size="sm" variant="outline" onClick={() => window.print()} disabled={!brs}>
                <Printer className="w-3.5 h-3.5 mr-1.5" />
                Print / PDF
              </Button>
              {canCertifyLock && (
                <Button
                  size="sm"
                  variant={isZeroVariance && !brs?.is_period_locked ? "default" : "secondary"}
                  disabled={!brs || brs.is_period_locked || !isZeroVariance}
                  onClick={() => {
                    setMakerId(distinctPreparers[0]?.id || "");
                    setLockModalOpen(true);
                  }}
                >
                  <Lock className="w-3.5 h-3.5 mr-1.5" />
                  {brs?.is_period_locked ? "Period Locked" : "Certify & Lock Period"}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => refetch()}>
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 p-3 rounded-lg bg-muted/20 border">
            <div className="space-y-1">
              <Label className="text-xs">Company / Fund Scheme</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {companiesList.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Period Start</Label>
              <Input
                type="date"
                value={periodStart}
                onChange={(e) => setManualPeriodStart(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Period End</Label>
              <Input
                type="date"
                value={periodEnd}
                onChange={(e) => setManualPeriodEnd(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fiscal Year</Label>
              <Input
                value={fiscalYear}
                onChange={(e) => setFiscalYear(e.target.value)}
                placeholder="2082/83"
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bank Closing Override (optional)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="Auto from statement"
                value={bankClosingInput}
                onChange={(e) => setBankClosingInput(e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>

          {isLoading || !brs ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {companyId
                ? "Calculating formal BRS metrics..."
                : "Select a company to generate the Bank Reconciliation Statement."}
            </div>
          ) : (
            <>
              <Alert
                variant={isZeroVariance ? "default" : "destructive"}
                className={
                  isZeroVariance
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200"
                    : undefined
                }
              >
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span>
                    {brs.is_period_locked
                      ? "This period is CERTIFIED & LOCKED against backdated edits."
                      : isZeroVariance
                        ? "Zero unreconciled bank variance & zero pending Checker variances. Ready for Period Close certification."
                        : `Period cannot be locked until unreconciled bank items (${fmtNpr(brs.unreconciled_variance)}) and pending Checker variances (${brs.unapproved_variances_count}) reach zero.`}
                  </span>
                  <Badge variant={brs.is_period_locked ? "default" : "outline"}>
                    {brs.is_period_locked ? "LOCKED" : "OPEN"}
                  </Badge>
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg border bg-card min-w-0">
                  <div className="text-[11px] text-muted-foreground">Bank Closing Balance</div>
                  <div className="text-sm xl:text-base font-bold font-mono mt-1 break-words">
                    {fmtNpr(brs.bank_closing_balance)}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 break-words">
                    Outflows: {fmtNpr(brs.bank_total_debit)}
                  </div>
                </div>
                <div className="p-3 rounded-lg border bg-card min-w-0">
                  <div className="text-[11px] text-muted-foreground">Reconciled + Non-Payable</div>
                  <div className="text-sm xl:text-base font-bold font-mono text-emerald-600 mt-1 break-words">
                    {fmtNpr(brs.reconciled_net_outflow)}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 break-words">
                    Payable Outflows: {fmtNpr(brs.reconciled_bank_debits)}
                  </div>
                </div>
                <div className="p-3 rounded-lg border bg-card min-w-0">
                  <div className="text-[11px] text-muted-foreground">System Ledger Settled</div>
                  <div className="text-sm xl:text-base font-bold font-mono mt-1 break-words">
                    {fmtNpr(brs.ledger_paid_total)}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 break-words">
                    In-Transit Batches: {fmtNpr(brs.in_transit_batches_amount)}
                  </div>
                </div>
                <div className="p-3 rounded-lg border bg-card min-w-0">
                  <div className="text-[11px] text-muted-foreground">Unreconciled Variance</div>
                  <div
                    className={`text-sm xl:text-base font-bold font-mono mt-1 break-words ${
                      brs.unreconciled_variance > 0.05 ? "text-destructive" : "text-emerald-600"
                    }`}
                  >
                    {fmtNpr(brs.unreconciled_variance)}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 break-words">
                    Pending Manual Queue: {brs.pending_manual_count} (
                    {fmtNpr(brs.pending_manual_amount)})
                  </div>
                </div>
              </div>

              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unreconciled Aging Bucket</TableHead>
                      <TableHead className="text-right">Outstanding Items</TableHead>
                      <TableHead className="text-right">Amount (NPR)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="text-xs font-medium">0 – 7 Days (Current)</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {brs.aging.days_0_7.count}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmtNpr(brs.aging.days_0_7.amount)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-xs font-medium">8 – 30 Days</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {brs.aging.days_8_30.count}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmtNpr(brs.aging.days_8_30.amount)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-xs font-medium">31 – 90 Days (Escalate)</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {brs.aging.days_31_90.count}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmtNpr(brs.aging.days_31_90.amount)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-xs font-medium text-destructive">
                        90+ Days (Aged Exception)
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {brs.aging.days_90_plus.count}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-destructive">
                        {fmtNpr(brs.aging.days_90_plus.amount)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {periodLocks.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Certified Reconciliation Period Locks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Period Window</TableHead>
                    <TableHead>FY</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Bank Closing</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Ledger Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Certification Notes</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {periodLocks.map((lock) => (
                    <TableRow key={lock.id}>
                      <TableCell className="font-mono text-[11px] whitespace-nowrap">
                        {lock.period_start} → {lock.period_end}
                      </TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {lock.fiscal_year || "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs whitespace-nowrap">
                        {fmtNpr(lock.bank_closing_balance)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs whitespace-nowrap">
                        {fmtNpr(lock.ledger_control_balance)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={lock.status === "Locked" ? "default" : "outline"}>
                          {lock.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs max-w-[180px] truncate">
                        {lock.approval_notes}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {lock.status === "Locked" && isAdminOrSupervisor && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => {
                              setReopenTargetId(lock.id);
                              setReopenReason("");
                            }}
                          >
                            <Unlock className="w-3 h-3 mr-1" />
                            Reopen
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lock Period Dialog */}
      <Dialog open={lockModalOpen} onOpenChange={setLockModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Certify &amp; Lock Reconciliation Period</DialogTitle>
            <DialogDescription className="text-xs">
              Once locked ({periodStart} to {periodEnd}), no manual entries or backdated adjustments
              can be posted in this date window unless reopened by Supervisor/Admin.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Distinct Preparer (Maker) *</Label>
              <Select value={makerId} onValueChange={setMakerId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select operator who prepared reconciliation" />
                </SelectTrigger>
                <SelectContent>
                  {distinctPreparers.map((u) => (
                    <SelectItem key={u.id} value={u.id} className="text-xs">
                      {u.full_name} ({u.email || u.id.slice(0, 8)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Checker Certification Remarks *</Label>
              <Input
                placeholder="e.g. Monthly BRS verified with bank statement closing balance"
                value={approvalNotes}
                onChange={(e) => setApprovalNotes(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setLockModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={isLocking} onClick={handleLockPeriod}>
              {isLocking ? "Locking..." : "Certify & Lock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reopen Period Dialog */}
      <Dialog open={Boolean(reopenTargetId)} onOpenChange={(o) => !o && setReopenTargetId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Reopen Certified Reconciliation Period</DialogTitle>
            <DialogDescription className="text-xs">
              Enter a mandatory audit reason to unlock this reconciliation period.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="Audit reason for reopening period..."
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              className="text-xs"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReopenTargetId(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" onClick={handleReopenPeriod}>
              Confirm Reopen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
