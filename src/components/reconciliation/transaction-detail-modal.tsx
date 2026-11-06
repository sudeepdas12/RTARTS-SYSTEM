import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReconciliationMatch } from "@/lib/reconciliation-engine";
import {
  CreditCard,
  Building2,
  Calendar,
  Hash,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ShieldAlert,
} from "lucide-react";

interface TransactionDetailModalProps {
  match: ReconciliationMatch | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemediate?: (match: ReconciliationMatch) => void;
}

export function TransactionDetailModal({
  match,
  open,
  onOpenChange,
  onRemediate,
}: TransactionDetailModalProps) {
  if (!match) return null;

  const isMatched = match.status === "Matched";
  const isRejected = match.status === "Rejected";
  const isPartial = match.status === "Under_Paid" || match.status === "Over_Paid";
  const isMissing = match.status === "Missing";

  const getStatusIcon = () => {
    if (isMatched) return <CheckCircle2 className="w-5 h-5 text-emerald-600" />;
    if (isRejected) return <XCircle className="w-5 h-5 text-destructive" />;
    if (isPartial) return <AlertTriangle className="w-5 h-5 text-amber-600" />;
    return <HelpCircle className="w-5 h-5 text-muted-foreground" />;
  };

  const getStatusBadge = () => {
    switch (match.status) {
      case "Matched":
        return (
          <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-300">Matched</Badge>
        );
      case "Rejected":
        return <Badge variant="destructive">Rejected</Badge>;
      case "Under_Paid":
        return (
          <Badge className="bg-amber-500/15 text-amber-700 border-amber-300">
            Under Paid (Installment)
          </Badge>
        );
      case "Over_Paid":
        return <Badge className="bg-amber-500/15 text-amber-700 border-amber-300">Over Paid</Badge>;
      case "Missing":
        return <Badge variant="secondary">Missing in System</Badge>;
      case "Pledged":
        return (
          <Badge className="bg-purple-500/15 text-purple-700 border-purple-300">
            Pledged Account
          </Badge>
        );
      default:
        return <Badge variant="outline">{match.status}</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="border-b pb-3">
          <div className="flex items-center justify-between gap-3 pr-6">
            <div className="flex items-center gap-2.5">
              {getStatusIcon()}
              <div>
                <DialogTitle className="text-base font-bold">
                  {match.shareholderName || "Unmapped Transaction"}
                </DialogTitle>
                <DialogDescription className="text-xs font-mono">
                  BOID: {match.boid || "Not Available"} • Category: {match.category || "General"}
                </DialogDescription>
              </div>
            </div>
            <div>{getStatusBadge()}</div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Financial Reconciliation Audit Strip */}
          <div className="grid grid-cols-3 gap-3 p-3 bg-muted/30 border rounded-lg">
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                Statement / Excel Amount
              </span>
              <p className="text-base font-mono font-bold mt-0.5">
                NPR {match.excelAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                System Net Payable
              </span>
              <p className="text-base font-mono font-bold mt-0.5">
                NPR {match.systemAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                Audit Difference
              </span>
              <p
                className={`text-base font-mono font-bold mt-0.5 ${
                  match.difference === 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive"
                }`}
              >
                {match.difference !== 0
                  ? (match.difference > 0 ? "+" : "") +
                    match.difference.toLocaleString("en-IN", { minimumFractionDigits: 2 })
                  : "NPR 0.00 (Balanced)"}
              </p>
            </div>
          </div>

          {/* Transaction Provenance & Source Details */}
          <div className="border rounded-lg p-3 space-y-2.5 bg-background">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <FileSpreadsheet className="w-3.5 h-3.5 text-primary" />
              Transaction Provenance & Audit Trail
            </h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <span className="text-muted-foreground">Source Type:</span>
                <p className="font-medium capitalize">
                  {(match.sourceType || "system").replace("_", " ")}
                </p>
              </div>
              {match.transactionDate && (
                <div>
                  <span className="text-muted-foreground">Transaction Date:</span>
                  <p className="font-mono font-medium">{match.transactionDate}</p>
                </div>
              )}
              {(match.bankName || match.bankAccountNo) && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Bank & Account:</span>
                  <p className="font-medium">
                    {match.bankName || "Commercial Bank"}{" "}
                    {match.bankAccountNo && (
                      <span className="font-mono text-muted-foreground">
                        ({match.bankAccountNo})
                      </span>
                    )}
                  </p>
                </div>
              )}
              {match.transactionDescription && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Narration / Reference:</span>
                  <p className="font-mono text-[11px] bg-muted/40 p-1.5 rounded border mt-0.5 break-all">
                    {match.transactionDescription}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Engine Matching Analysis */}
          <div className="border rounded-lg p-3 space-y-2.5 bg-background">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Hash className="w-3.5 h-3.5 text-primary" />
              Engine Matching Analysis
            </h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <span className="text-muted-foreground">Confidence Score:</span>
                <p className="font-semibold text-primary">
                  {match.confidenceScore !== undefined ? `${match.confidenceScore}%` : "Rule-based"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Match Method:</span>
                <p className="font-mono font-medium capitalize">
                  {match.matchMethod ? match.matchMethod.replace(/_/g, " ") : "Direct Key"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Rule Version:</span>
                <p className="font-mono text-muted-foreground">{match.ruleVersion || "2.0.0"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Manual Approval:</span>
                <p className="font-medium">
                  {match.requiresManualApproval ? (
                    <Badge variant="outline" className="text-amber-600 border-amber-300">
                      Required
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-emerald-600 border-emerald-300">
                      Auto-Qualified
                    </Badge>
                  )}
                </p>
              </div>
              {match.matchSources && match.matchSources.length > 0 && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Matched Sources:</span>
                  <div className="flex gap-1.5 mt-1 flex-wrap">
                    {match.matchSources.map((source) => (
                      <Badge key={source} variant="secondary" className="text-[10px] capitalize">
                        {source}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Shareholder & DB Payable Snapshot */}
          <div className="border rounded-lg p-3 space-y-2.5 bg-background">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-primary" />
              Database Payable Reference
            </h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <span className="text-muted-foreground">Matched Payable ID:</span>
                <p className="font-mono text-[11px] truncate">
                  {match.payableId || "Unlinked / Pending Insertion"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Database Payment Status:</span>
                <p className="font-medium capitalize">
                  {match.paymentStatus || "Unpaid / Pending"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Registered Kitta:</span>
                <p className="font-mono font-medium">{match.kitta.toLocaleString()}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Payable Scheme / Type:</span>
                <p className="font-medium capitalize">
                  {match.payableType || "Mutual Fund Payout"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t pt-3 flex items-center justify-between">
          <div>
            {isRejected && onRemediate && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs text-amber-700 border-amber-300 hover:bg-amber-50"
                onClick={() => {
                  onOpenChange(false);
                  onRemediate(match);
                }}
              >
                <CreditCard className="w-3.5 h-3.5 mr-1" />
                Remediate Bank Account
              </Button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
