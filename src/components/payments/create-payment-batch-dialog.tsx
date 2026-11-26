import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, FileSpreadsheet, Loader2, Plus } from "lucide-react";

type PaymentMethod = "NEFT" | "RTGS" | "ConnectIPS" | "Cheque" | "Cash";

interface CreatePaymentBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchName: string;
  setBatchName: (val: string) => void;
  selectedCompany: string;
  setSelectedCompany: (val: string) => void;
  selectedPayableType: string;
  setSelectedPayableType: (val: string) => void;
  periodPreset: string;
  setPeriodPreset: (val: string) => void;
  periodDays: string;
  setPeriodDays: (val: string) => void;
  fromDate: string;
  setFromDate: (val: string) => void;
  toDate: string;
  setToDate: (val: string) => void;
  fiscalYear: string;
  setFiscalYear: (val: string) => void;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (val: PaymentMethod) => void;
  installmentTag: string;
  setInstallmentTag: (val: string) => void;
  companies: any[];
  fiscalYears: string[];
  payablesPreview: { count: number; totalAmount: number };
  isPreviewLoading: boolean;
  isExportingAvailablePayables: boolean;
  onExportAvailablePayables: () => void;
  isPending: boolean;
  createBatchProgress: string | null;
  onCreateBatch: () => void;
}

export function CreatePaymentBatchDialog({
  open,
  onOpenChange,
  batchName,
  setBatchName,
  selectedCompany,
  setSelectedCompany,
  selectedPayableType,
  setSelectedPayableType,
  periodPreset,
  setPeriodPreset,
  periodDays,
  setPeriodDays,
  fromDate,
  setFromDate,
  toDate,
  setToDate,
  fiscalYear,
  setFiscalYear,
  paymentMethod,
  setPaymentMethod,
  installmentTag,
  setInstallmentTag,
  companies,
  fiscalYears,
  payablesPreview,
  isPreviewLoading,
  isExportingAvailablePayables,
  onExportAvailablePayables,
  isPending,
  createBatchProgress,
  onCreateBatch,
}: CreatePaymentBatchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          onClick={() => {
            setSelectedCompany("all");
            setSelectedPayableType("all");
            setFiscalYear("all");
            setPeriodPreset("12M");
            setPeriodDays("365");
            setFromDate("");
            setToDate("");
            setBatchName(`Payment Batch — ${new Date().toISOString().slice(0, 10)}`);
          }}
        >
          <Plus className="w-4 h-4 mr-2" />
          New Payment Batch
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-6 pb-4 border-b shrink-0">
          <DialogTitle>Create Payment Batch</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="space-y-2">
            <Label>Batch Name</Label>
            <Input
              placeholder="e.g., Dividend Payment Batch Q1 2081/82"
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Company</Label>
              <Select
                value={selectedCompany}
                onValueChange={(val) => {
                  setSelectedCompany(val);
                  if (val !== "all") {
                    const comp = companies.find((c: any) => c.id === val);
                    if (comp) {
                      if (comp.fiscal_year) {
                        setFiscalYear(comp.fiscal_year);
                      }
                      if (comp.company_type === "Debenture") {
                        setSelectedPayableType("interest");
                      } else if (comp.company_type === "Mutual Fund") {
                        setSelectedPayableType("mutual_fund");
                      } else {
                        setSelectedPayableType("dividend");
                      }
                      const code = comp.company_code || comp.company_name?.slice(0, 8);
                      setBatchName(
                        `${code} Payout — ${comp.fiscal_year ? `FY ${comp.fiscal_year}` : new Date().toISOString().slice(0, 10)}`,
                      );
                    }
                  } else {
                    setSelectedPayableType("all");
                    setFiscalYear("all");
                    setBatchName(`All Schemes Payout — ${new Date().toISOString().slice(0, 10)}`);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All companies" />
                </SelectTrigger>
                <SelectContent className="max-h-60 overflow-y-auto">
                  <SelectItem value="all">All companies</SelectItem>
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.company_code} — {company.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Payable Type</Label>
              <Select value={selectedPayableType} onValueChange={setSelectedPayableType}>
                <SelectTrigger>
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="mutual_fund">Mutual Fund</SelectItem>
                  <SelectItem value="dividend">Dividend</SelectItem>
                  <SelectItem value="interest">Interest</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Period / Quarter</Label>
              <Select
                value={periodPreset}
                onValueChange={(v) => {
                  setPeriodPreset(v);
                  if (v === "3M") setPeriodDays("91");
                  else if (v === "6M") setPeriodDays("183");
                  else if (v === "9M") setPeriodDays("274");
                  else if (v === "12M") setPeriodDays("365");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="12M">Full Period / Annual (12 Months / 365 Days)</SelectItem>
                  <SelectItem value="3M">Q1 (1st Quarter / 3 Months / ~91 Days)</SelectItem>
                  <SelectItem value="6M">
                    Q2 (2nd Quarter / 6 Months / 183 Days / Semi-Annual)
                  </SelectItem>
                  <SelectItem value="9M">Q3 (3rd Quarter / 9 Months / ~274 Days)</SelectItem>
                  <SelectItem value="CUSTOM">Custom Day / Date Range</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {periodPreset === "CUSTOM" ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">From Date</Label>
                  <Input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">To Date</Label>
                  <Input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Period Days</Label>
                <Input
                  type="number"
                  value={periodDays}
                  onChange={(e) => {
                    setPeriodDays(e.target.value);
                    setPeriodPreset("CUSTOM");
                  }}
                  placeholder="365"
                />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Fiscal Year</Label>
              <Select value={fiscalYear} onValueChange={setFiscalYear}>
                <SelectTrigger>
                  <SelectValue placeholder="All Fiscal Years" />
                </SelectTrigger>
                <SelectContent className="max-h-60 overflow-y-auto">
                  <SelectItem value="all">All Fiscal Years (All Records)</SelectItem>
                  {fiscalYears.map((fy) => (
                    <SelectItem key={fy} value={fy}>
                      {fy}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select
                value={paymentMethod}
                onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["NEFT", "RTGS", "ConnectIPS", "Cheque", "Cash"] as PaymentMethod[]).map(
                    (m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Installment / Payout Leg Tag</Label>
            <Select
              value={installmentTag}
              onValueChange={(v) => {
                setInstallmentTag(v);
                const comp = companies.find((c: any) => c.id === selectedCompany);
                const code = comp?.company_code || comp?.company_name?.slice(0, 8) || "PAYMENT";
                const tagLabels: Record<string, string> = {
                  FULL: "Full Annual Payout",
                  SEMI_1: "Semi-Annual Installment 1 (Poush End)",
                  SEMI_2: "Semi-Annual Installment 2 (Asar End)",
                  INTERIM: "Interim Dividend Distribution",
                  FINAL: "Final Dividend Distribution",
                  REMEDIATION: "Remediated Accounts Payout",
                };
                if (v !== "FULL") {
                  setBatchName(`${code} — ${tagLabels[v] || v} — ${fiscalYear || "FY"}`);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FULL">Full Settlement / Annual Payout</SelectItem>
                <SelectItem value="SEMI_1">Semi-Annual Installment 1 (Poush End)</SelectItem>
                <SelectItem value="SEMI_2">Semi-Annual Installment 2 (Asar End)</SelectItem>
                <SelectItem value="INTERIM">Interim Dividend Distribution</SelectItem>
                <SelectItem value="FINAL">Final Dividend Distribution</SelectItem>
                <SelectItem value="REMEDIATION">
                  Remediated Accounts Payout (Corrected Bank Accounts)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border bg-muted/20 p-3 text-sm">
            <div className="flex items-center justify-between font-medium mb-1">
              <span>Available Payables</span>
              <span className="text-xs text-muted-foreground">
                {periodPreset !== "12M"
                  ? `Prorated for ${periodDays} Days`
                  : "Full Period (365 Days)"}
              </span>
            </div>
            {isPreviewLoading ? (
              <div className="flex items-center text-muted-foreground py-1">
                <Loader2 className="w-4 h-4 animate-spin text-primary mr-2" />
                <span>Calculating matching pending payables...</span>
              </div>
            ) : (
              <>
                <p className="text-muted-foreground">
                  {payablesPreview.count.toLocaleString()} payables found matching your criteria.
                  {payablesPreview.count > 0 && (
                    <span className="ml-2 text-primary font-semibold">
                      Total: NPR{" "}
                      {payablesPreview.totalAmount.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  )}
                </p>
                {payablesPreview.count === 0 && (
                  <div className="mt-2.5 p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-md text-xs text-amber-700 dark:text-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span>No pending payables match the current filter.</span>
                    {(selectedCompany !== "all" ||
                      selectedPayableType !== "all" ||
                      fiscalYear !== "all") && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 text-xs font-semibold shrink-0"
                        onClick={() => {
                          setSelectedCompany("all");
                          setSelectedPayableType("all");
                          setFiscalYear("all");
                          setBatchName(`Payment Batch — ${new Date().toISOString().slice(0, 10)}`);
                        }}
                      >
                        Reset Filters
                      </Button>
                    )}
                  </div>
                )}
                <div className="mt-3 pt-2.5 border-t flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground mr-1">Quick Select:</span>
                  <Button
                    type="button"
                    variant={
                      selectedCompany === "all" && fiscalYear === "all" ? "default" : "outline"
                    }
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => {
                      setSelectedCompany("all");
                      setSelectedPayableType("all");
                      setFiscalYear("all");
                      setBatchName(`All Schemes Payout — ${new Date().toISOString().slice(0, 10)}`);
                    }}
                  >
                    All Schemes
                  </Button>
                  {companies
                    .filter((c: any) => c.company_code === "RMF1" || c.company_code === "RMF2")
                    .map((c: any) => (
                      <Button
                        key={c.id}
                        type="button"
                        variant={selectedCompany === c.id ? "default" : "outline"}
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => {
                          setSelectedCompany(c.id);
                          setSelectedPayableType("mutual_fund");
                          if (c.fiscal_year) setFiscalYear(c.fiscal_year);
                          setBatchName(
                            `${c.company_code} Payout — ${c.fiscal_year ? `FY ${c.fiscal_year}` : new Date().toISOString().slice(0, 10)}`,
                          );
                        }}
                      >
                        {c.company_code}
                      </Button>
                    ))}
                </div>
              </>
            )}
          </div>
        </div>
        <DialogFooter className="flex sm:justify-between items-center w-full gap-2 p-4 border-t bg-muted/20 shrink-0">
          <Button
            variant="outline"
            type="button"
            onClick={onExportAvailablePayables}
            disabled={payablesPreview.count === 0 || isExportingAvailablePayables}
            className="text-xs"
          >
            {isExportingAvailablePayables ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
            )}
            Download Payable List (Excel)
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={isPending || isPreviewLoading} onClick={onCreateBatch}>
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {createBatchProgress || "Creating Payment Batch..."}
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Create Payment Batch
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
