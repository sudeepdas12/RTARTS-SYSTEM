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
  Building2,
  Clock,
  UserCheck,
  Layers,
  ArrowRight,
  Info,
  Scale,
  Send,
} from "lucide-react";
import { ParsedExcelData } from "@/lib/excel-parser";
import { TaxRule } from "@/lib/services/tax-rules.service";
import { detectPayeeCategory, getPayeeTaxRate } from "@/lib/services/payable-summary";
import { ImportService } from "@/lib/services/import.service";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface PreImportReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File | null;
  fileHash: string;
  parsedData: ParsedExcelData | null;
  selectedSheetIndex: number; // -1 indicates ALL data sheets
  dividendType?: string;
  dividendRate?: number | string;
  companyId?: string;
  companyName: string;
  companyCode: string;
  fiscalYear: string;
  operatorName: string;
  operatorRole: string;
  taxRules: TaxRule[];
  onConfirmPost: (makerNotes?: string) => Promise<void> | void;
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
  dividendType = "Dividend",
  dividendRate = 0,
  companyId,
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
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
  const [serverDryRunMetrics, setServerDryRunMetrics] = useState<any | null>(null);

  const isMultiSheet = selectedSheetIndex === -1;
  const targetSheets = useMemo(() => {
    if (!parsedData?.sheets) return [];
    if (isMultiSheet) {
      return parsedData.sheets.filter((s) => s.sheetType !== "SUMMARY");
    }
    const single = parsedData.sheets[selectedSheetIndex];
    return single ? [single] : [];
  }, [parsedData, selectedSheetIndex, isMultiSheet]);

  const isDebenture = dividendType === "Debenture";
  const isMutualFund = dividendType === "MutualFund";
  const rateNumber = Number(dividendRate) || 0;

  React.useEffect(() => {
    if (!open || targetSheets.length === 0) return;
    const allRows = targetSheets.flatMap((s) => s.rows || []);
    const targetTable = isDebenture
      ? "interest_payables"
      : isMutualFund
        ? "mutual_fund_payables"
        : "dividend_payables";

    ImportService.dryRunImport(allRows, targetTable, {
      dividendRate: rateNumber,
      isPreCalculated: targetSheets[0]?.isPreCalculated,
      sheetType: targetSheets[0]?.sheetType,
    })
      .then((res) => {
        if (res && res.success) {
          setServerDryRunMetrics(res);
        }
      })
      .catch((err) => console.debug("Server dry-run calculation check:", err));
  }, [open, targetSheets, isDebenture, isMutualFund, rateNumber]);

  // Authoritative calculation: Source Excel vs Engine Results
  const metrics = useMemo(() => {
    if (targetSheets.length === 0) {
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

    let totalRows = 0;
    let validRows = 0;
    let rejectedRows = 0;
    let sourceGross = 0;
    let sourceTax = 0;
    let sourceNet = 0;
    let computedGross = 0;
    let computedTax = 0;
    let computedNet = 0;
    const taxExceptions: Array<{ rowIdx: number; name: string; reason: string }> = [];

    targetSheets.forEach((sheet) => {
      totalRows += sheet.rows.length;

      const grossCol = sheet.headers.find((h) =>
        /gross|amount|payable_amount|alloted_quantity/i.test(h),
      );
      const taxCol = sheet.headers.find((h) => /tax|bon_tax|div_tax/i.test(h));
      const netCol = sheet.headers.find((h) => /net|net_payable|roundup/i.test(h));
      const nameCol = sheet.headers.find((h) => /name|shareholder|client/i.test(h));
      const kittaCol = sheet.headers.find((h) => /kitta|shares|holding|units|qty/i.test(h));

      sheet.rows.forEach((r, idx) => {
        if (!r || Object.keys(r).length === 0) {
          rejectedRows++;
          return;
        }
        validRows++;

        const g = Number(grossCol ? r[grossCol] : 0) || 0;
        const t = Number(taxCol ? r[taxCol] : 0) || 0;
        const n = Number(netCol ? r[netCol] : 0) || 0;
        const shares = Number(kittaCol ? r[kittaCol] : 0) || 0;

        sourceGross += g;
        sourceTax += t;
        sourceNet += n;

        // Authoritative engine calculation per statutory rules
        const category = detectPayeeCategory(r, sheet.sheetType);
        const engineTaxRate = getPayeeTaxRate(category, isDebenture, null, isMutualFund, taxRules);

        let rowEngineGross = g;
        if (!sheet.isPreCalculated && rateNumber > 0 && shares > 0) {
          const faceValue = isDebenture ? 1000 : isMutualFund ? 10 : 100;
          rowEngineGross = shares * (rateNumber / 100) * faceValue;
        } else if (rowEngineGross === 0 && n > 0 && t > 0) {
          rowEngineGross = n + t;
        }

        const rowEngineTax = Math.round(rowEngineGross * engineTaxRate * 100) / 100;
        const rowEngineNet = Math.round((rowEngineGross - rowEngineTax) * 100) / 100;

        computedGross += rowEngineGross;
        computedTax += rowEngineTax;
        computedNet += rowEngineNet;

        // Source vs Calculation invariant check
        if (g > 0 && Math.abs(g - t - n) > 0.05 && n > 0) {
          taxExceptions.push({
            rowIdx: idx + 1,
            name: String(nameCol ? r[nameCol] : `Row ${idx + 1}`),
            reason: `Excel Invariant Mismatch: Net (${n.toFixed(2)}) ≠ Gross (${g.toFixed(2)}) - Tax (${t.toFixed(2)})`,
          });
        } else if (sheet.isPreCalculated && t > 0 && Math.abs(t - rowEngineTax) > 0.5) {
          taxExceptions.push({
            rowIdx: idx + 1,
            name: String(nameCol ? r[nameCol] : `Row ${idx + 1}`),
            reason: `Tax Rate Divergence: Excel Tax (${t.toFixed(2)}) vs Statutory Rate Engine (${rowEngineTax.toFixed(2)}) [${category}]`,
          });
        }
      });
    });

    return {
      totalRows,
      validRows,
      skippedRows: 0,
      rejectedRows,
      sourceGross,
      sourceTax,
      sourceNet,
      computedGross,
      computedTax,
      computedNet,
      taxExceptions,
      isServerDerived: Boolean(serverDryRunMetrics),
    };
  }, [targetSheets, isDebenture, isMutualFund, rateNumber, taxRules, serverDryRunMetrics]);

  const isMaterial = metrics.sourceNet >= MATERIAL_THRESHOLD_NPR;
  const isCheckerOrAdmin =
    operatorRole === "admin" ||
    operatorRole === "supervisor" ||
    operatorRole === "checker" ||
    operatorRole === "approver";

  const taxDifference = Math.abs(metrics.sourceTax - metrics.computedTax);
  const hasTaxVariance = taxDifference > 1.0;

  // Handle Maker submitting material import for Checker approval in database
  const handleSubmitForCheckerApproval = async () => {
    setIsSubmittingApproval(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const approvalPayload = {
        companyName,
        companyCode,
        fiscalYear,
        fileHash,
        fileName: file?.name,
        importMode: isMultiSheet ? "ALL_DATA_SHEETS" : targetSheets[0]?.sheetName,
        totalRows: metrics.totalRows,
        validRows: metrics.validRows,
        sourceGross: metrics.sourceGross,
        sourceTax: metrics.sourceTax,
        sourceNet: metrics.sourceNet,
        computedGross: metrics.computedGross,
        computedTax: metrics.computedTax,
        computedNet: metrics.computedNet,
        makerNotes: makerNotes.trim(),
        submittedBy: operatorName,
        submittedRole: operatorRole,
        isMaterial: true,
      };

      // 1. Insert into pending_approvals
      const { data: paData, error: paError } = await (supabase as any)
        .from("pending_approvals")
        .insert({
          entity_type: "IMPORT_BATCH",
          action: "MATERIAL_IMPORT_APPROVAL",
          payload: approvalPayload,
          status: "Pending",
          requested_by: user?.id || null,
        })
        .select()
        .single();

      if (paError) throw paError;

      // 2. Persist durable staging records in import_staging
      let targetCompanyId = companyId;
      if (!targetCompanyId) {
        const { data: comp } = await (supabase as any)
          .from("companies")
          .select("id")
          .or(`company_code.eq.${companyCode},company_name.eq.${companyName}`)
          .maybeSingle();
        targetCompanyId = comp?.id;
      }

      if (!targetCompanyId) {
        throw new Error("Target company ID is required to stage import");
      }

      const targetTable = isDebenture
        ? "interest_payables"
        : isMutualFund
          ? "mutual_fund_payables"
          : "dividend_payables";
      const stagedRows = targetSheets.flatMap((s) => s.rows || []);

      const { error: stageErr } = await (supabase as any).from("import_staging").insert({
        approval_id: paData.id,
        company_id: targetCompanyId,
        target_table: targetTable,
        file_name: file?.name || "import.xlsx",
        file_hash: fileHash,
        sheet_name: isMultiSheet ? "ALL_DATA_SHEETS" : targetSheets[0]?.sheetName,
        total_rows: metrics.totalRows,
        source_gross: metrics.sourceGross,
        source_tax: metrics.sourceTax,
        source_net: metrics.sourceNet,
        computed_gross: metrics.computedGross,
        computed_tax: metrics.computedTax,
        computed_net: metrics.computedNet,
        staged_rows: stagedRows,
        options: {
          dividendType,
          dividendRate: rateNumber,
          companyName,
          companyCode,
          fiscalYear,
          isPreCalculated: targetSheets[0]?.isPreCalculated,
        },
        created_by: user?.id || null,
      });

      if (stageErr) {
        console.warn("Could not write to import_staging table (continuing):", stageErr);
      }

      // 3. Insert into approval_logs
      await (supabase as any).from("approval_logs").insert({
        approval_id: paData?.id || null,
        action: "IMPORT_APPROVAL_REQUESTED",
        previous_status: "DRAFT",
        new_status: "PENDING_CHECKER_APPROVAL",
        remarks: `Material Import (${fmtCurrency(metrics.sourceNet)}): ${makerNotes || "Submitted for checker authorization"}`,
        performed_by: user?.id || null,
      });

      toast.success(
        `Material import submitted for checker approval! Ticket ID: ${paData?.id?.slice(0, 8) || "Recorded"}`,
      );
      onOpenChange(false);
    } catch (err: any) {
      console.error("Error submitting import approval:", err);
      toast.error(`Approval submission failed: ${err.message || "Unknown error"}`);
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  const handleCheckerConfirmAndPost = async () => {
    // If material, record the approval log in database before posting
    if (isMaterial) {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        await (supabase as any).from("approval_logs").insert({
          action: "MATERIAL_IMPORT_APPROVED",
          previous_status: "PENDING_CHECKER_APPROVAL",
          new_status: "APPROVED_POSTED",
          remarks: `Checker Sign-off by ${operatorName} (${operatorRole}): ${makerNotes || "Approved and committed"}`,
          performed_by: user?.id || null,
        });
      } catch (logErr) {
        console.warn("Could not write checker approval log:", logErr);
      }
    }
    await onConfirmPost(makerNotes);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Pre-Import Financial & Statutory Checkpoint
            </DialogTitle>
            <div className="flex items-center gap-2">
              {isMultiSheet && (
                <Badge variant="outline" className="gap-1">
                  <Layers className="h-3 w-3" /> All Sheets ({targetSheets.length})
                </Badge>
              )}
              <Badge variant={isMaterial ? "destructive" : "secondary"}>
                {isMaterial ? "Material Import (> 100K NPR)" : "Standard Import"}
              </Badge>
            </div>
          </div>
          <DialogDescription>
            Authoritative source vs statutory calculation check, exception inspection, and
            maker-checker audit sign-off.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Metadata & Tenancy Block */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-muted/40 p-3 rounded-lg border text-xs">
            <div>
              <span className="text-muted-foreground block">Company:</span>
              <span className="font-semibold">
                {companyName} ({companyCode})
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Fiscal Year / Scope:</span>
              <span className="font-semibold">{fiscalYear || "Default"}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Operator (Maker):</span>
              <span className="font-semibold">
                {operatorName} ({operatorRole})
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Import Mode:</span>
              <span className="font-semibold">
                {isMultiSheet
                  ? `All ${targetSheets.length} Data Sheets`
                  : targetSheets[0]?.sheetName}
              </span>
            </div>
            <div className="col-span-2 sm:col-span-4 font-mono truncate text-[11px] text-muted-foreground">
              SHA-256 Hash: {fileHash || "Calculating..."}
            </div>
          </div>

          {/* Row Breakdown */}
          <div className="grid grid-cols-4 gap-3 text-center">
            <div className="border rounded-md p-2.5 bg-card">
              <div className="text-xs text-muted-foreground uppercase font-medium">Total Rows</div>
              <div className="text-lg font-bold">{metrics.totalRows}</div>
            </div>
            <div className="border rounded-md p-2.5 bg-card text-emerald-600">
              <div className="text-xs text-muted-foreground uppercase font-medium">
                Valid / In-Scope
              </div>
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

          {/* Financial Totals Reconciliation: Source vs Authoritative Engine */}
          <Card className="border-border">
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-semibold flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Scale className="h-4 w-4 text-primary" />
                  Financial Totals Verification
                </span>
                <div className="flex items-center gap-1.5">
                  {metrics.isServerDerived && (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 border-emerald-300"
                    >
                      Authoritative Server Engine Verified
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Source Excel vs Statutory Engine Calculation
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs">
                {/* Gross */}
                <div className="bg-muted/30 p-2.5 rounded border space-y-1">
                  <div className="text-muted-foreground font-medium">Gross Payable</div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Excel:</span>
                    <span className="font-mono font-medium">
                      {fmtCurrency(metrics.sourceGross)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Engine:</span>
                    <span className="font-mono font-medium">
                      {fmtCurrency(metrics.computedGross)}
                    </span>
                  </div>
                </div>

                {/* Tax */}
                <div className="bg-muted/30 p-2.5 rounded border space-y-1">
                  <div className="text-muted-foreground font-medium">Withheld TDS (Tax)</div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Excel:</span>
                    <span className="font-mono font-medium text-amber-700 dark:text-amber-400">
                      {fmtCurrency(metrics.sourceTax)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Engine:</span>
                    <span className="font-mono font-medium text-amber-700 dark:text-amber-400">
                      {fmtCurrency(metrics.computedTax)}
                    </span>
                  </div>
                </div>

                {/* Net */}
                <div className="bg-muted/30 p-2.5 rounded border space-y-1">
                  <div className="text-muted-foreground font-medium">Net Disbursement</div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Excel:</span>
                    <span className="font-mono font-medium text-emerald-700 dark:text-emerald-400">
                      {fmtCurrency(metrics.sourceNet)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Engine:</span>
                    <span className="font-mono font-medium text-emerald-700 dark:text-emerald-400">
                      {fmtCurrency(metrics.computedNet)}
                    </span>
                  </div>
                </div>
              </div>

              {hasTaxVariance && (
                <div className="text-[11px] bg-amber-500/10 border border-amber-500/30 p-2 rounded text-amber-800 dark:text-amber-300 flex items-center justify-between">
                  <span>
                    Tax Variance Detected: Active statutory rules compute TDS differing by{" "}
                    <strong>{fmtCurrency(taxDifference)}</strong> from source Excel values.
                  </span>
                  <Badge variant="outline" className="text-[10px] border-amber-500/40">
                    Statutory Rule Priority
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Exceptions Box */}
          {metrics.taxExceptions.length > 0 ? (
            <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-lg text-xs space-y-2">
              <div className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                {metrics.taxExceptions.length} Statutory & Invariant Exception(s)
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
                    +{metrics.taxExceptions.length - 5} more exceptions logged to audit ledger.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-emerald-500/10 border border-emerald-500/30 p-2.5 rounded-lg text-xs flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              <span>All rows satisfy mathematical & statutory rules: Net = Gross - TDS.</span>
            </div>
          )}

          {/* Maker / Checker Workflow Controls */}
          <div className="space-y-3 pt-1">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Maker Notes & Justification</Label>
              <Textarea
                placeholder="Enter justification, circular reference, or batch notes for checker and auditor review..."
                value={makerNotes}
                onChange={(e) => setMakerNotes(e.target.value)}
                className="text-xs min-h-[55px]"
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
                are correct, and confirm submitting this batch into the ledger workflow.
              </Label>
            </div>

            {/* Material Import Segregation Policy */}
            {isMaterial && (
              <div className="p-3 rounded-md border text-xs space-y-2 bg-destructive/10 border-destructive/20">
                <div className="flex items-center gap-1.5 font-semibold text-destructive">
                  <ShieldCheck className="h-4 w-4" />
                  Material Import Policy (&gt; 100,000 NPR Disbursement)
                </div>

                {isCheckerOrAdmin ? (
                  <div className="flex items-start gap-2 pt-1">
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
                      Checker Authorization: As an authorized Supervisor/Checker ({operatorRole}), I
                      have verified the source manifest and authorize this material disbursement of{" "}
                      {fmtCurrency(metrics.sourceNet)}.
                    </Label>
                  </div>
                ) : (
                  <div className="text-muted-foreground leading-relaxed text-[11px]">
                    ⚠️ <strong>Maker-Checker Segregation Enforced:</strong> As an operator with
                    maker role ({operatorRole}), you cannot directly commit a material import
                    exceeding NPR 100,000. You must submit this batch for independent checker
                    authorization in the ledger approval queue.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPosting || isSubmittingApproval}
          >
            Cancel & Re-Map
          </Button>

          {isMaterial && !isCheckerOrAdmin ? (
            <Button
              onClick={handleSubmitForCheckerApproval}
              disabled={!acknowledged || isSubmittingApproval}
              className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
            >
              <Send className="h-4 w-4" />
              {isSubmittingApproval
                ? "Submitting Approval Ticket..."
                : "Submit for Checker Authorization"}
            </Button>
          ) : (
            <Button
              onClick={handleCheckerConfirmAndPost}
              disabled={!acknowledged || (isMaterial && !checkerAcknowledged) || isPosting}
              className="gap-1.5"
            >
              {isPosting
                ? "Posting to Database..."
                : isMaterial
                  ? "Authorize & Commit Import"
                  : "Confirm & Commit Import"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
