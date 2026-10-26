import React, { useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Building2,
  User,
  ArrowRight,
  Info,
  Scale,
} from "lucide-react";
import { PayeeClassification } from "@/lib/classification-review.functions";

export interface ClassificationExplainabilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: any | null;
  onConfirmClassification?: (
    id: string,
    classification: PayeeClassification,
    segment?: string,
  ) => void;
  isPending?: boolean;
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

export function ClassificationExplainabilityDialog({
  open,
  onOpenChange,
  client,
  onConfirmClassification,
  isPending,
}: ClassificationExplainabilityDialogProps) {
  const [sampleGross, setSampleGross] = useState<number>(10000);

  const explanation = useMemo(() => {
    if (!client) {
      return {
        reason: "",
        ruleTitle: "",
        taxRatePct: 5,
        beforeRatePct: 15,
        targetClassification: "NATURAL_PERSON",
      };
    }

    const name = String(client.full_name || "").toUpperCase();
    const pan = String(client.pan_or_citizenship || "").toUpperCase();
    const currClass = client.payee_classification || "NATURAL_PERSON";

    let reason =
      "Classified as individual retail shareholder based on Demat BOID and personal identification.";
    let ruleTitle = "Nepal Income Tax Act 2058 - Section 88 (5% Resident Individual Dividend TDS)";
    let taxRatePct = 5;
    let beforeRatePct = 15;

    if (
      name.includes("LTD") ||
      name.includes("LIMITED") ||
      name.includes("PVT") ||
      name.includes("CORP") ||
      name.includes("COMPANY")
    ) {
      reason =
        "Entity name contains corporate keywords ('Ltd', 'Pvt', 'Company'). Classified as Legal Person pursuant to Section 88.";
      ruleTitle = "Corporate Dividend & Coupon TDS (15% Legal Person Withholding)";
      taxRatePct = 15;
      beforeRatePct = 5;
    } else if (
      name.includes("MUTUAL FUND") ||
      name.includes("RETIREMENT") ||
      name.includes("PROVIDENT") ||
      name.includes("SANSTHAN")
    ) {
      reason =
        "Entity identified as approved mutual fund or statutory retirement fund pursuant to Section 10 tax exemption.";
      ruleTitle = "Section 10 Statutory Tax Exemption (0% TDS Withholding)";
      taxRatePct = 0;
      beforeRatePct = 15;
    } else if (currClass === "COMPANY_INSTITUTION") {
      reason = "Assigned institutional classification by registry operator.";
      ruleTitle = "Corporate Investor Statutory TDS Rate (15%)";
      taxRatePct = 15;
      beforeRatePct = 5;
    } else if (currClass === "TAX_EXEMPT") {
      reason = "Designated tax-exempt entity with 0% statutory deduction.";
      ruleTitle = "Section 10 Tax Exemption Certificate";
      taxRatePct = 0;
      beforeRatePct = 5;
    }

    return {
      reason,
      ruleTitle,
      taxRatePct,
      beforeRatePct,
      targetClassification: currClass,
    };
  }, [client]);

  if (!client) return null;

  // Calculate before & after tax impact
  const taxBefore = (sampleGross * explanation.beforeRatePct) / 100;
  const netBefore = sampleGross - taxBefore;
  const taxAfter = (sampleGross * explanation.taxRatePct) / 100;
  const netAfter = sampleGross - taxAfter;
  const netDifference = netAfter - netBefore;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Tax Classification Explainability & Audit Panel
            </DialogTitle>
            <Badge variant="outline" className="border-primary/40 text-primary">
              Audit Transparency
            </Badge>
          </div>
          <DialogDescription>
            Inspect the underlying data fields, applicable tax rule logic, and financial variance
            impact for this shareholder.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-xs">
          {/* Source Fields Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-muted/40 p-3 rounded-lg border">
            <div>
              <span className="text-muted-foreground block">Shareholder Name:</span>
              <span className="font-semibold text-foreground text-sm">{client.full_name}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">BOID (16-Digit):</span>
              <span className="font-mono font-medium">{client.boid || "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">PAN / Citizenship:</span>
              <span className="font-mono font-medium">{client.pan_or_citizenship || "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Company / Issuer:</span>
              <span className="font-medium">{client.company?.company_name || "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Current Status:</span>
              <Badge variant="outline" className="mt-0.5">
                {client.classification_status || "PENDING"}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground block">Active Classification:</span>
              <Badge className="mt-0.5">{client.payee_classification || "NATURAL_PERSON"}</Badge>
            </div>
          </div>

          {/* Rule Selection Logic & Explainability */}
          <Card className="border-border bg-card">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-foreground font-semibold">
                <Scale className="h-4 w-4 text-primary" />
                <span>Applicable Rule: {explanation.ruleTitle}</span>
              </div>
              <div className="text-muted-foreground leading-relaxed bg-muted/30 p-2.5 rounded border border-border/60">
                <strong className="text-foreground">Why this was selected:</strong>{" "}
                {explanation.reason}
              </div>
              <div className="flex items-center gap-4 pt-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Resolved Statutory Rate:</span>
                  <Badge variant="secondary" className="font-bold text-sm">
                    {explanation.taxRatePct}%
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Withholding Scope:</span>
                  <span className="font-medium">Section 88, 87 / 90 Income Tax Act</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Before vs After Financial Simulation */}
          <Card className="border-border">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">Simulated Before & After Tax Impact</span>
                <div className="flex items-center gap-2">
                  <Label htmlFor="sample-gross" className="text-[11px] text-muted-foreground">
                    Test Gross (NPR):
                  </Label>
                  <Input
                    id="sample-gross"
                    type="number"
                    value={sampleGross}
                    onChange={(e) => setSampleGross(Number(e.target.value) || 0)}
                    className="w-24 h-7 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-muted/30 p-2.5 rounded border">
                  <div className="text-muted-foreground">
                    Prior / Alternative ({explanation.beforeRatePct}%)
                  </div>
                  <div className="font-semibold mt-1 text-sm">{fmtCurrency(taxBefore)} TDS</div>
                  <div className="text-[11px] text-muted-foreground">
                    Net: {fmtCurrency(netBefore)}
                  </div>
                </div>
                <div className="bg-primary/10 border border-primary/30 p-2.5 rounded">
                  <div className="text-primary font-semibold">
                    Resolved ({explanation.taxRatePct}%)
                  </div>
                  <div className="font-bold mt-1 text-sm text-primary">
                    {fmtCurrency(taxAfter)} TDS
                  </div>
                  <div className="text-[11px] text-foreground font-medium">
                    Net: {fmtCurrency(netAfter)}
                  </div>
                </div>
                <div className="bg-muted/30 p-2.5 rounded border">
                  <div className="text-muted-foreground">Shareholder Variance</div>
                  <div
                    className={`font-bold mt-1 text-sm ${netDifference >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                  >
                    {netDifference >= 0
                      ? `+${fmtCurrency(netDifference)}`
                      : fmtCurrency(netDifference)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {netDifference >= 0 ? "Higher Net Payout" : "Higher Statutory Tax"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {onConfirmClassification && (
            <Button
              onClick={() => {
                onConfirmClassification(
                  client.id,
                  client.payee_classification || "NATURAL_PERSON",
                  client.payee_segment,
                );
                onOpenChange(false);
              }}
              disabled={isPending}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 className="h-4 w-4" />
              Confirm & Recompute Payables
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
