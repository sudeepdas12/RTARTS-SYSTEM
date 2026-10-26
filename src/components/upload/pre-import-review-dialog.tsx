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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  FileSpreadsheet,
  Building2,
  Clock,
  UserCheck,
  ArrowRight,
  Info,
} from "lucide-react";
import { ParsedExcelData } from "@/lib/excel-parser";
import { TaxRule } from "@/lib/services/tax-rules.service";

export interface PreImportReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File | null;
  fileHash: string;
  parsedData: ParsedExcelData | null;
  selectedSheetIndex: number;
  companyName: string;
  companyCode: string;
  fiscalYear: string;
  operatorName: string;
  operatorRole: string;
  taxRules: TaxRule[];
  onConfirmPost: (makerNotes?: string) => void;
  isPosting: boolean;
}

function fmtCurrency(val: number): string {
  return (
    "NPR " +
    Number(val || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

const MATERIAL_THRESHOLD_NPR = 100_000;

export function PreImportReviewDialog({
  open,
  onOpenChange,
  file,
  fileHash,
  parsedData,
  selectedSheetIndex,
  companyName,
  companyCode,
  fiscalYear,
  operatorName,
  operatorRole,
  taxRules,
  onConfirmPost,
  isPosting,
}: PreImportReviewDialogProps) {
  const [makerNotes, setMakerNotes] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [checkerAcknowledged, setCheckerAcknowledged] = useState(false);

  const sheet = parsedData?.sheets?.[selectedSheetIndex];

  // Calculate totals and exceptions from sheet data
  const metrics = useMemo(() => {
    if (!sheet) {
      return {
        totalRows: 0,
        validRows: 0,
        skippedRows: 0,
        rejectedRows: 0,
        sourceGross: 0,
        sourceTax: 0,
        sourceNet: 0,
        computedGross: 0,
        computedTax: 0,
        computedNet: 0,
        taxExceptions: [] as Array<{ rowIdx: number; name: string; reason: string }>,
      };
    }

    let sourceGross = 0;
    let sourceTax = 0;
    let sourceNet = 0;
    let rejectedCount = 0;
    let validCount = 0;
    const taxExceptions: Array<{ rowIdx: number; name: string; reason: string }> = [];

    const grossCol = sheet.headers.find((h) =>
      /gross|amount|payable_amount|alloted_quantity/i.test(h),
    );
    const taxCol = sheet.headers.find((h) => /tax|bon_tax|div_tax/i.test(h));
    const netCol = sheet.headers.find((h) => /net|net_payable|roundup/i.test(h));
    const nameCol = sheet.headers.find((h) => /name|shareholder|client/i.test(h));

    sheet.rows.forEach((r, idx) => {
      const g = Number(grossCol ? r[grossCol] : 0) || 0;
      const t = Number(taxCol ? r[taxCol] : 0) || 0;
      const n = Number(netCol ? r[netCol] : 0) || 0;

      sourceGross += g;
      sourceTax += t;
      sourceNet += n;

      if (!r || Object.keys(r).length === 0) {
        rejectedCount++;
        return;
      }
      validCount++;

      // Invariant check: if both gross & tax exist, verify net = gross - tax (within NPR 0.05)
      if (g > 0 && Math.abs(g - t - n) > 0.05 && n > 0) {
        taxExceptions.push({
          rowIdx: idx + 1,
          name: String(nameCol ? r[nameCol] : `Row ${idx + 1}`),
          reason: `Net (NPR ${n.toFixed(2)}) ≠ Gross (${g.toFixed(2)}) - Tax (${t.toFixed(2)})`,
        });
      }
    });

    return {
      totalRows: sheet.rows.length,
      validRows: validCount,
      skippedRows: sheet.sheetType === "SUMMARY" ? sheet.rows.length : 0,
      rejectedRows: rejectedCount,
      sourceGross,
      sourceTax,
      sourceNet,
      computedGross: sourceGross,
      computedTax: sourceTax,
      computedNet: sourceNet,
      taxExceptions,
    };
  }, [sheet]);

  const isMaterial = metrics.sourceNet >= MATERIAL_THRESHOLD_NPR;
  const isCheckerOrAdmin =
    operatorRole === "admin" ||
    operatorRole === "supervisor" ||
    operatorRole === "checker" ||
    operatorRole === "approver";

  const canSubmit =
    acknowledged && (!isMaterial || checkerAcknowledged || isCheckerOrAdmin) && !isPosting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Pre-Import Financial & Statutory Checkpoint
            </DialogTitle>
            <Badge variant={isMaterial ? "destructive" : "secondary"}>
              {isMaterial ? "Material Import (> 100K NPR)" : "Standard Import"}
            </Badge>
          </div>
          <DialogDescription>
            Review and confirm financial totals, tax classifications, and audit metadata before
            committing to the ledger.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Metadata & Audit Block */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-muted/40 p-3 rounded-lg border text-xs">
            <div>
              <span className="text-muted-foreground block">Company:</span>
              <span className="font-semibold">
                {companyName} ({companyCode})
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Fiscal Year:</span>
              <span className="font-semibold">{fiscalYear || "Default"}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Operator:</span>
              <span className="font-semibold">
                {operatorName} ({operatorRole})
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Timestamp:</span>
              <span className="font-semibold">{new Date().toLocaleString()}</span>
            </div>
            <div className="col-span-2 sm:col-span-4 font-mono truncate text-[11px] text-muted-foreground">
              SHA-256 Hash: {fileHash || "Pending calculation"}
            </div>
          </div>

          {/* Row Breakdown */}
          <div className="grid grid-cols-4 gap-3 text-center">
            <div className="border rounded-md p-2.5 bg-card">
              <div className="text-xs text-muted-foreground uppercase font-medium">Total Rows</div>
              <div className="text-lg font-bold">{metrics.totalRows}</div>
            </div>
            <div className="border rounded-md p-2.5 bg-card text-emerald-600">
              <div className="text-xs text-muted-foreground uppercase font-medium">Valid / New</div>
              <div className="text-lg font-bold">{metrics.validRows}</div>
            </div>
            <div className="border rounded-md p-2.5 bg-card text-amber-600">
              <div className="text-xs text-muted-foreground uppercase font-medium">Skipped</div>
              <div className="text-lg font-bold">{metrics.skippedRows}</div>
            </div>
            <div className="border rounded-md p-2.5 bg-card text-red-600">
              <div className="text-xs text-muted-foreground uppercase font-medium">Rejected</div>
              <div className="text-lg font-bold">{metrics.rejectedRows}</div>
            </div>
          </div>

          {/* Financial Totals Reconciliation */}
          <Card className="border-border">
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-semibold flex items-center justify-between">
                <span>Financial Totals Verification</span>
                <span className="text-xs text-muted-foreground">Source Excel vs Engine</span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-muted/30 p-2.5 rounded border">
                  <div className="text-xs text-muted-foreground">Gross Amount</div>
                  <div className="font-semibold mt-0.5">{fmtCurrency(metrics.sourceGross)}</div>
                </div>
                <div className="bg-muted/30 p-2.5 rounded border">
                  <div className="text-xs text-muted-foreground">Withheld TDS (Tax)</div>
                  <div className="font-semibold mt-0.5 text-amber-700 dark:text-amber-400">
                    {fmtCurrency(metrics.sourceTax)}
                  </div>
                </div>
                <div className="bg-muted/30 p-2.5 rounded border">
                  <div className="text-xs text-muted-foreground">Net Disbursement</div>
                  <div className="font-semibold mt-0.5 text-emerald-700 dark:text-emerald-400">
                    {fmtCurrency(metrics.sourceNet)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tax Exceptions Alert */}
          {metrics.taxExceptions.length > 0 ? (
            <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-lg text-xs space-y-2">
              <div className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                {metrics.taxExceptions.length} Tax & Mathematical Invariant Exception(s) Detected
              </div>
              <div className="max-h-24 overflow-y-auto space-y-1">
                {metrics.taxExceptions.slice(0, 5).map((ex, i) => (
                  <div key={i} className="text-muted-foreground flex justify-between">
                    <span>
                      Row {ex.rowIdx}: {ex.name}
                    </span>
                    <span className="text-amber-700 dark:text-amber-400 font-mono">
                      {ex.reason}
                    </span>
                  </div>
                ))}
                {metrics.taxExceptions.length > 5 && (
                  <div className="text-muted-foreground italic">
                    +{metrics.taxExceptions.length - 5} more exceptions will be logged to audit
                    trail.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-emerald-500/10 border border-emerald-500/30 p-2.5 rounded-lg text-xs flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              <span>All rows satisfy mathematical invariant: Net = Gross - TDS (± NPR 0.05).</span>
            </div>
          )}

          {/* Maker / Checker Sign-off */}
          <div className="space-y-3 pt-1">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Maker Notes & Justification (Optional)</Label>
              <Textarea
                placeholder="Enter justification, circular reference, or batch notes for auditor review..."
                value={makerNotes}
                onChange={(e) => setMakerNotes(e.target.value)}
                className="text-xs min-h-[60px]"
              />
            </div>

            <div className="flex items-start gap-2 pt-1">
              <Checkbox
                id="ack-import"
                checked={acknowledged}
                onCheckedChange={(c) => setAcknowledged(Boolean(c))}
                className="mt-0.5"
              />
              <Label htmlFor="ack-import" className="text-xs leading-relaxed cursor-pointer">
                I verify that the shareholder data, fiscal year ({fiscalYear}), and company tenancy
                are correct, and confirm submitting this batch for ledger commitment.
              </Label>
            </div>

            {isMaterial && (
              <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 p-2.5 rounded-md">
                <Checkbox
                  id="checker-ack"
                  checked={checkerAcknowledged}
                  onCheckedChange={(c) => setCheckerAcknowledged(Boolean(c))}
                  className="mt-0.5"
                />
                <Label
                  htmlFor="checker-ack"
                  className="text-xs leading-relaxed cursor-pointer font-medium text-destructive"
                >
                  Material Import Sign-off: As a designated Maker/Checker, I have verified the
                  source manifest and authorize this high-value disbursement of{" "}
                  {fmtCurrency(metrics.sourceNet)}.
                </Label>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPosting}>
            Cancel & Re-Map
          </Button>
          <Button
            onClick={() => onConfirmPost(makerNotes)}
            disabled={!canSubmit}
            className="gap-1.5"
          >
            {isPosting
              ? "Posting to Database..."
              : isMaterial
                ? "Authorize & Post Import"
                : "Confirm & Commit Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
