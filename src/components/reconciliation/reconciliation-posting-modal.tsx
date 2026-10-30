import React, { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Clock,
  UserCheck,
  FileCheck2,
} from "lucide-react";
import {
  ComprehensiveReconciliationReport,
  ReconciliationMatch,
} from "@/lib/reconciliation-engine";
import type { FileVariantWarning } from "@/lib/bank-parser";

export interface ReconciliationPostingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: ComprehensiveReconciliationReport | null;
  selectedMatchIds?: Set<string>;
  isApplying: boolean;
  onConfirmApply: () => Promise<void>;
  operatorName?: string;
  operatorRole?: string;
  isAll?: boolean;
  variantAlerts?: FileVariantWarning[];
}

function fmtNpr(n: number) {
  return (
    "NPR " +
    Number(n || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function ReconciliationPostingModal({
  open,
  onOpenChange,
  report,
  selectedMatchIds,
  isApplying,
  onConfirmApply,
  operatorName = "Authorized Operator",
  operatorRole = "Checker / Approver",
  isAll = true,
  variantAlerts = [],
}: ReconciliationPostingModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [variantAcknowledged, setVariantAcknowledged] = useState(false);

  const hasVariants = Boolean(variantAlerts && variantAlerts.length > 0);
  const canConfirm = acknowledged && (!hasVariants || variantAcknowledged) && !isApplying;

  const stats = useMemo(() => {
    if (!report?.matches) {
      return {
        targetMatches: [] as ReconciliationMatch[],
        matchedCount: 0,
        partialCount: 0,
        rejectCount: 0,
        totalAmount: 0,
        matchedAmount: 0,
        exceptionsCount: 0,
      };
    }

    const targetMatches =
      isAll || !selectedMatchIds || selectedMatchIds.size === 0
        ? report.matches
        : report.matches.filter((m) => selectedMatchIds.has(m.id));

    const matched = targetMatches.filter((m) => m.status === "Matched");
    const partial = targetMatches.filter(
      (m) => m.status === "Over_Paid" || m.status === "Under_Paid",
    );
    const rejected = targetMatches.filter((m) => m.status === "Rejected");
    const missing = targetMatches.filter((m) => m.status === "Missing");

    const totalAmount = targetMatches.reduce(
      (acc, m) => acc + (m.excelAmount || m.systemAmount || 0),
      0,
    );
    const matchedAmount = matched.reduce(
      (acc, m) => acc + (m.excelAmount || m.systemAmount || 0),
      0,
    );

    return {
      targetMatches,
      matchedCount: matched.length,
      partialCount: partial.length,
      rejectCount: rejected.length,
      totalAmount,
      matchedAmount,
      exceptionsCount: missing.length + rejected.length,
    };
  }, [report, selectedMatchIds, isAll]);

  const handleConfirm = async () => {
    if (!canConfirm || isApplying) return;
    await onConfirmApply();
    setAcknowledged(false);
    setVariantAcknowledged(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              Reconciliation Posting Confirmation
            </DialogTitle>
            <Badge variant={isAll ? "default" : "secondary"}>
              {isAll ? "Full File Posting" : `Selected (${stats.targetMatches.length})`}
            </Badge>
          </div>
          <DialogDescription>
            Verify the transaction counts, settlement volume, and irreversible financial transitions
            before executing the atomic database update.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Operator Context Block */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-muted/40 p-3 rounded-lg border text-xs">
            <div>
              <span className="text-muted-foreground block">Approver / Operator:</span>
              <span className="font-semibold">{operatorName}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Role:</span>
              <span className="font-semibold">{operatorRole}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Posting Timestamp:</span>
              <span className="font-semibold">{new Date().toLocaleString()}</span>
            </div>
          </div>

          {/* Posting Summary Metrics */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="border rounded-md p-3 bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200">
              <div className="text-xs text-muted-foreground uppercase font-medium">
                To Mark Paid
              </div>
              <div className="text-2xl font-bold text-emerald-600 mt-1">{stats.matchedCount}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {fmtNpr(stats.matchedAmount)}
              </div>
            </div>
            <div className="border rounded-md p-3 bg-blue-50/40 dark:bg-blue-950/20 border-blue-200">
              <div className="text-xs text-muted-foreground uppercase font-medium">
                Partial Settlement
              </div>
              <div className="text-2xl font-bold text-blue-600 mt-1">{stats.partialCount}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Variance recorded</div>
            </div>
            <div className="border rounded-md p-3 bg-red-50/40 dark:bg-red-950/20 border-red-200">
              <div className="text-xs text-muted-foreground uppercase font-medium">
                Exceptions / Rejected
              </div>
              <div className="text-2xl font-bold text-red-600 mt-1">{stats.rejectCount}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Audit-flagged</div>
            </div>
          </div>

          {/* Financial Volume Card */}
          <Card className="border-border">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground uppercase font-semibold">
                  Total Posting Financial Volume
                </div>
                <div className="text-2xl font-extrabold text-foreground mt-1">
                  {fmtNpr(stats.totalAmount)}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Across {stats.targetMatches.length} individual clearing records
                </div>
              </div>
              <FileCheck2 className="h-10 w-10 text-muted-foreground/30" />
            </CardContent>
          </Card>

          {/* Irreversible Effects Disclosure */}
          <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-lg text-xs space-y-1.5">
            <div className="font-semibold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Operational & Audit Impacts:
            </div>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 pl-1">
              <li>
                Matched payables will transition to status{" "}
                <strong className="text-foreground">"Paid"</strong> and lock subsequent batch
                additions.
              </li>
              <li>
                Reconciliation lots will be immutably recorded in{" "}
                <code className="bg-background px-1 rounded">reconciliation_history</code>.
              </li>
              <li>
                Partial payments will update remaining receivable balances with tolerance checks.
              </li>
              <li>Lot reversal requires Supervisor / Admin role and mandatory audit reasoning.</li>
            </ul>
          </div>

          {/* Source Variant Alert and Explicit Clearance */}
          {hasVariants && (
            <div className="bg-destructive/10 border border-destructive/30 p-3 rounded-lg text-xs space-y-2">
              <div className="font-semibold text-destructive flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Source Variant Warnings Detected ({variantAlerts.length})
              </div>
              <p className="text-muted-foreground text-[11px]">
                Potential file duplicate or superseded revision detected. Confirm that this posting
                batch represents the authoritative clearing data:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1 pl-1 max-h-28 overflow-y-auto font-mono text-[11px]">
                {variantAlerts.map((va, idx) => (
                  <li key={idx}>
                    <span className="font-semibold text-foreground">{va.fileA}</span> vs{" "}
                    <span className="font-semibold text-foreground">{va.fileB}</span>: {va.reason}
                  </li>
                ))}
              </ul>
              <div className="flex items-start gap-2 pt-1 border-t border-destructive/20">
                <Checkbox
                  id="recon-variant-ack"
                  checked={variantAcknowledged}
                  onCheckedChange={(c) => setVariantAcknowledged(Boolean(c))}
                  className="mt-0.5"
                />
                <Label
                  htmlFor="recon-variant-ack"
                  className="text-xs leading-relaxed cursor-pointer font-medium text-destructive-foreground"
                >
                  I have reviewed the source variant discrepancies across uploaded files and confirm
                  this batch contains the authoritative records.
                </Label>
              </div>
            </div>
          )}

          {/* Explicit Acknowledgement */}
          <div className="flex items-start gap-2.5 pt-2">
            <Checkbox
              id="recon-ack"
              checked={acknowledged}
              onCheckedChange={(c) => setAcknowledged(Boolean(c))}
              className="mt-0.5"
            />
            <Label
              htmlFor="recon-ack"
              className="text-xs leading-relaxed cursor-pointer font-medium"
            >
              I acknowledge the posting of{" "}
              <span className="text-foreground font-bold">{stats.targetMatches.length}</span>{" "}
              reconciliation records amounting to{" "}
              <span className="text-foreground font-bold">{fmtNpr(stats.totalAmount)}</span>, and
              confirm that all clearing lines match bank settlement records.
            </Label>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isApplying}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isApplying ? "Committing Settlement..." : "Confirm & Commit Posting"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
