import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/use-debounce";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  BankStatementTransactionRow,
  ManualPayableAllocationInput,
  ManualPayableSearchHit,
  ManualReasonCode,
  ReconciliationService,
} from "@/lib/services/reconciliation.service";
import { FileUp, Link2, PlusCircle, Search, ShieldCheck, Tag } from "lucide-react";
import { toast } from "sonner";

export type ManualReconciliationMode = "manual_entry" | "pair_payables" | "classify_non_payable";

const ENTRY_REASONS: Array<{ code: ManualReasonCode; label: string }> = [
  { code: "COUNTER_PAYOUT", label: "Counter / Cash Payout" },
  { code: "CHEQUE_CLEARED", label: "Cheque Cleared" },
  { code: "RTGS_OFFLINE", label: "RTGS / IPS Offline Voucher" },
  { code: "CONNECTIPS_MANUAL", label: "ConnectIPS Manual Confirmation" },
  { code: "BANK_CHARGE", label: "Bank Fee / Commission" },
  { code: "INTEREST_CREDIT", label: "Interest / Account Credit" },
  { code: "SWEEP_INTERNAL", label: "Internal Treasury Sweep" },
  { code: "ROUNDING_ADJUSTMENT", label: "Paisa Rounding Adjustment" },
  { code: "SUSPENSE_UNIDENTIFIED", label: "Unidentified / Suspense Item" },
];

const NON_PAYABLE_REASONS: Array<{ code: ManualReasonCode; label: string }> = [
  { code: "BANK_CHARGE", label: "Bank Service Charge / Fee" },
  { code: "INTEREST_CREDIT", label: "Bank Interest Credit" },
  { code: "SWEEP_INTERNAL", label: "Internal Sweep / Contra Transfer" },
  { code: "ROUNDING_ADJUSTMENT", label: "Paisa / Tax Rounding Difference" },
  { code: "SUSPENSE_UNIDENTIFIED", label: "Unidentified Suspense Entry" },
];

export interface ManualReconciliationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companiesList: Array<{ id: string; company_name: string; company_code?: string | null }>;
  defaultCompanyId?: string | null;
  initialMode?: ManualReconciliationMode;
  selectedTransactions?: BankStatementTransactionRow[];
  onSubmitted?: () => void;
}

export function ManualReconciliationDialog({
  open,
  onOpenChange,
  companiesList,
  defaultCompanyId,
  initialMode = "manual_entry",
  selectedTransactions = [],
  onSubmitted,
}: ManualReconciliationDialogProps) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<ManualReconciliationMode>(initialMode);
  const [companyId, setCompanyId] = useState<string>(defaultCompanyId || "");

  // Manual entry fields
  const [txDate, setTxDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [direction, setDirection] = useState<"debit" | "credit">("debit");
  const [amount, setAmount] = useState<string>("");
  const [reference, setReference] = useState<string>("");
  const [bankName, setBankName] = useState<string>("");
  const [accountNo, setAccountNo] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [reasonCode, setReasonCode] = useState<ManualReasonCode>("COUNTER_PAYOUT");
  const [notes, setNotes] = useState<string>("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);

  // Payable pairing state
  const [payableQuery, setPayableQuery] = useState<string>("");
  const debouncedPayableQuery = useDebounce(payableQuery, 220);
  const [selectedAllocations, setSelectedAllocations] = useState<
    Record<string, { hit: ManualPayableSearchHit; amount: number }>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setMode(initialMode);
      setCompanyId(
        selectedTransactions[0]?.company_id || defaultCompanyId || companiesList[0]?.id || "",
      );
      setReasonCode(
        initialMode === "classify_non_payable"
          ? "BANK_CHARGE"
          : initialMode === "pair_payables"
            ? "MANUAL_PAIR"
            : "COUNTER_PAYOUT",
      );
      setNotes("");
      setEvidenceFile(null);
      setSelectedAllocations({});
      if (initialMode === "manual_entry") {
        setAmount("");
        setReference("");
        setBankName("");
        setAccountNo("");
        setDescription("");
      }
    }
  }

  const effectiveCompanyId =
    companyId ||
    selectedTransactions[0]?.company_id ||
    defaultCompanyId ||
    companiesList[0]?.id ||
    "";

  const { data: payableHits = [], isLoading: isSearchingPayables } = useQuery({
    queryKey: ["manual_match_payables", effectiveCompanyId, debouncedPayableQuery],
    enabled: open && Boolean(effectiveCompanyId) && mode !== "classify_non_payable",
    queryFn: () =>
      ReconciliationService.searchPendingPayablesForManualMatch(
        effectiveCompanyId,
        debouncedPayableQuery,
        30,
      ),
  });

  const selectedBankTotal = useMemo(() => {
    if (mode === "manual_entry") return Number(amount || 0);
    return selectedTransactions.reduce(
      (sum, t) => sum + Math.max(Number(t.debit_amount || 0), Number(t.credit_amount || 0)),
      0,
    );
  }, [mode, amount, selectedTransactions]);

  const allocationsList = useMemo<ManualPayableAllocationInput[]>(() => {
    return Object.values(selectedAllocations).map(({ hit, amount: allocAmt }) => ({
      payable_id: hit.id,
      payable_type: hit.payable_type,
      amount: Number(allocAmt || 0),
      shareholder_name: hit.full_name,
      boid: hit.boid,
    }));
  }, [selectedAllocations]);

  const allocationsTotal = useMemo(
    () => allocationsList.reduce((s, a) => s + Number(a.amount || 0), 0),
    [allocationsList],
  );

  const togglePayableSelection = (hit: ManualPayableSearchHit) => {
    setSelectedAllocations((prev) => {
      const next = { ...prev };
      if (next[hit.id]) {
        delete next[hit.id];
      } else {
        next[hit.id] = { hit, amount: hit.remaining_amount };
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!effectiveCompanyId) {
      toast.error("Please select a target company.");
      return;
    }

    const distinctCompanies = new Set(
      selectedTransactions.map((t) => t.company_id).filter(Boolean),
    );
    if (distinctCompanies.size > 1) {
      toast.error("Selected bank transactions must belong to a single company.");
      return;
    }

    setIsSubmitting(true);
    try {
      let evidencePath: string | null = null;
      if (evidenceFile) {
        evidencePath = await ReconciliationService.uploadReconciliationEvidence(
          effectiveCompanyId,
          evidenceFile,
        );
      }

      if (mode === "manual_entry") {
        const numAmt = Number(amount || 0);
        if (!Number.isFinite(numAmt) || numAmt <= 0) {
          toast.error("Enter a positive amount.");
          return;
        }
        if (reference.trim().length < 2) {
          toast.error("Cheque, UTR, or voucher reference is required.");
          return;
        }
        await ReconciliationService.submitManualBankEntry({
          companyId: effectiveCompanyId,
          transactionDate: txDate,
          debitAmount: direction === "debit" ? numAmt : 0,
          creditAmount: direction === "credit" ? numAmt : 0,
          reference: reference.trim(),
          description: description.trim() || `${reasonCode} - ${reference.trim()}`,
          bankName: bankName.trim() || undefined,
          accountNo: accountNo.trim() || undefined,
          reasonCode,
          evidencePath,
          notes: notes.trim(),
          allocations: allocationsList,
        });
        toast.success(
          "Manual bank entry submitted to Checker queue on /approvals (Maker-Checker enforced).",
        );
      } else {
        if (selectedTransactions.length === 0) {
          toast.error("Select at least one unreconciled bank line first.");
          return;
        }
        if (notes.trim().length < 3) {
          toast.error("Please enter justification notes (at least 3 characters).");
          return;
        }
        if (mode === "pair_payables" && allocationsList.length === 0) {
          toast.error("Select at least one pending payable to pair.");
          return;
        }
        await ReconciliationService.submitManualMatchRequest({
          companyId: effectiveCompanyId,
          mode,
          transactionIds: selectedTransactions.map((t) => t.id),
          reasonCode,
          notes: notes.trim(),
          evidencePath,
          allocations: mode === "pair_payables" ? allocationsList : [],
        });
        toast.success(
          mode === "pair_payables"
            ? "Manual match pairing submitted for Checker approval on /approvals."
            : "Non-payable classification submitted for Checker approval on /approvals.",
        );
      }

      qc.invalidateQueries({ queryKey: ["bank_statement_transactions"] });
      qc.invalidateQueries({ queryKey: ["pending_approvals_all"] });
      qc.invalidateQueries({ queryKey: ["brs_statement"] });
      onSubmitted?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Failed to submit manual reconciliation request.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="p-6 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Manual Reconciliation &amp; Voucher Workbench
          </DialogTitle>
          <DialogDescription>
            Record off-file bank/cheque/RTGS entries, pair bank lines (1↔1, 1↔N, N↔1) to pending
            payables, or classify non-payable bank events. All actions require dual Checker
            approval.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <Tabs
            value={mode}
            onValueChange={(v) => {
              const nextMode = v as ManualReconciliationMode;
              setMode(nextMode);
              if (nextMode === "classify_non_payable") setReasonCode("BANK_CHARGE");
              else if (nextMode === "pair_payables") setReasonCode("MANUAL_PAIR");
              else setReasonCode("COUNTER_PAYOUT");
            }}
          >
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="manual_entry" className="text-xs">
                <PlusCircle className="w-3.5 h-3.5 mr-1.5" />
                New Manual Entry
              </TabsTrigger>
              <TabsTrigger
                value="pair_payables"
                className="text-xs"
                disabled={selectedTransactions.length === 0}
              >
                <Link2 className="w-3.5 h-3.5 mr-1.5" />
                Pair Selected ({selectedTransactions.length})
              </TabsTrigger>
              <TabsTrigger
                value="classify_non_payable"
                className="text-xs"
                disabled={selectedTransactions.length === 0}
              >
                <Tag className="w-3.5 h-3.5 mr-1.5" />
                Non-Payable Event
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Target Company</Label>
              <Select
                value={effectiveCompanyId}
                onValueChange={setCompanyId}
                disabled={selectedTransactions.length > 0 && mode !== "manual_entry"}
              >
                <SelectTrigger className="h-9 text-xs">
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
              <Label className="text-xs">Reconciliation Reason Code</Label>
              <Select
                value={reasonCode}
                onValueChange={(v) => setReasonCode(v as ManualReasonCode)}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(mode === "classify_non_payable" ? NON_PAYABLE_REASONS : ENTRY_REASONS).map(
                    (r) => (
                      <SelectItem key={r.code} value={r.code} className="text-xs">
                        {r.label} ({r.code})
                      </SelectItem>
                    ),
                  )}
                  {mode === "pair_payables" && (
                    <SelectItem value="MANUAL_PAIR" className="text-xs">
                      Manual 1↔1 / 1↔N / N↔1 Pairing (MANUAL_PAIR)
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {mode === "manual_entry" ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-lg border bg-muted/20">
              <div className="space-y-1">
                <Label className="text-xs">Value Date</Label>
                <Input
                  type="date"
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Entry Side</Label>
                <Select
                  value={direction}
                  onValueChange={(v) => setDirection(v as "debit" | "credit")}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="debit">Debit (Payout / Fee Outflow)</SelectItem>
                    <SelectItem value="credit">Credit (Return / Funding Inflow)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Amount (NPR)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cheque / UTR / Voucher Ref *</Label>
                <Input
                  placeholder="e.g. CHQ-40912 or RTGS-2026-081"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bank / Channel Name</Label>
                <Input
                  placeholder="e.g. Global IME Bank"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bank Account No.</Label>
                <Input
                  placeholder="e.g. 0420101000412"
                  value={accountNo}
                  onChange={(e) => setAccountNo(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
              </div>
              <div className="sm:col-span-3 space-y-1">
                <Label className="text-xs">Particulars / Narrative</Label>
                <Input
                  placeholder="Cheque payee or offline transfer details"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>
          ) : (
            <Alert className="bg-muted/30 border">
              <AlertDescription className="text-xs flex flex-wrap items-center justify-between gap-2">
                <span>
                  Selected <strong>{selectedTransactions.length}</strong> bank ledger item(s):{" "}
                  <span className="font-mono">
                    {selectedTransactions
                      .map((t) => t.reference || t.description?.slice(0, 24) || t.id.slice(0, 8))
                      .join(", ")}
                  </span>
                </span>
                <Badge variant="secondary" className="font-mono">
                  Bank Total: NPR{" "}
                  {selectedBankTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </Badge>
              </AlertDescription>
            </Alert>
          )}

          {mode !== "classify_non_payable" && (
            <div className="rounded-lg border p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold">
                    {mode === "manual_entry"
                      ? "Optional: Pair Immediately with Pending Payables (1↔N)"
                      : "Select Pending Payables to Reconcile (1↔1, 1↔N, or N↔1)"}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Search by shareholder BOID, full name, bank account, fiscal year, or exact
                    amount.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="font-mono">
                    Allocated: NPR{" "}
                    {allocationsTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </Badge>
                  {selectedBankTotal > 0 && allocationsTotal > 0 && (
                    <Badge
                      variant={
                        Math.abs(selectedBankTotal - allocationsTotal) <= 1
                          ? "default"
                          : "destructive"
                      }
                      className="font-mono"
                    >
                      Diff: NPR{" "}
                      {(selectedBankTotal - allocationsTotal).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="Search pending dividends, interest, or mutual fund payables..."
                  value={payableQuery}
                  onChange={(e) => setPayableQuery(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>

              <div className="max-h-48 overflow-y-auto border rounded divide-y bg-background">
                {isSearchingPayables ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">
                    Searching pending payables...
                  </div>
                ) : payableHits.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">
                    No matching pending/partial payables found for the selected company.
                  </div>
                ) : (
                  payableHits.map((hit) => {
                    const selected = selectedAllocations[hit.id];
                    const blockedByTax =
                      !hit.payee_classification ||
                      hit.payee_classification === "UNCLASSIFIED" ||
                      hit.classification_status === "REVIEW_REQUIRED";
                    return (
                      <div
                        key={hit.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-muted/30"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Checkbox
                            checked={Boolean(selected)}
                            disabled={blockedByTax}
                            onCheckedChange={() => togglePayableSelection(hit)}
                          />
                          <div className="min-w-0">
                            <div className="font-medium truncate">
                              {hit.full_name}{" "}
                              <span className="font-mono text-[10px] text-muted-foreground">
                                ({hit.boid})
                              </span>
                            </div>
                            <div className="text-[10px] text-muted-foreground flex flex-wrap gap-2">
                              <span className="capitalize">{hit.payable_type}</span>
                              {hit.fiscal_year && <span>FY {hit.fiscal_year}</span>}
                              {hit.bank_account_no && (
                                <span className="font-mono">A/C {hit.bank_account_no}</span>
                              )}
                              {blockedByTax && (
                                <span className="text-amber-600 font-medium">
                                  Tax review required
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-[11px] text-muted-foreground">
                            Rem:{" "}
                            {hit.remaining_amount.toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                            })}
                          </span>
                          {selected && (
                            <Input
                              type="number"
                              min="0.01"
                              max={hit.remaining_amount}
                              step="0.01"
                              value={selected.amount}
                              onChange={(e) => {
                                const val = Number(e.target.value || 0);
                                setSelectedAllocations((prev) => ({
                                  ...prev,
                                  [hit.id]: { ...prev[hit.id], amount: val },
                                }));
                              }}
                              className="w-28 h-7 text-xs font-mono text-right"
                            />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">
                Supporting Voucher / Advice (PDF, PNG, JPG, CSV, XLSX — private bucket)
              </Label>
              <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed cursor-pointer hover:bg-muted/30 text-xs">
                <FileUp className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="truncate text-muted-foreground">
                  {evidenceFile
                    ? evidenceFile.name
                    : "Attach scanned cheque / RTGS slip (optional)"}
                </span>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">
                Audit Justification Notes {mode !== "manual_entry" && "*"}
              </Label>
              <Textarea
                rows={2}
                placeholder="Explain voucher reference, bank charge nature, or manual pairing basis..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="p-4 border-t bg-muted/20 shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={isSubmitting} onClick={handleSubmit}>
            {isSubmitting ? "Submitting..." : "Submit for Checker Approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
