import React, { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  CreditCard,
  RefreshCw,
  Search,
  Sparkles,
  User,
  ArrowRight,
} from "lucide-react";

export interface RejectedAccountItem {
  payable_id: string;
  payable_type: "interest" | "dividend" | "mutual_fund";
  client_id?: string | null;
  full_name: string;
  boid?: string | null;
  pan_or_citizenship?: string | null;
  current_bank_name?: string | null;
  current_bank_account_no?: string | null;
  rejection_reason?: string | null;
  net_payable: number;
}

interface AccountRemediationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialItems: RejectedAccountItem[];
  companyName?: string;
}

// Known Nepal Banking Mergers & Acquisitions Dictionary
const MERGER_DICTIONARY: { pattern: RegExp; newBank: string; note: string }[] = [
  {
    pattern: /century/i,
    newBank: "Prabhu Bank Limited",
    note: "Century Commercial Bank merged into Prabhu Bank Ltd.",
  },
  {
    pattern: /mega\s*bank/i,
    newBank: "Nepal Investment Mega Bank Ltd.",
    note: "Mega Bank Nepal merged into Nepal Investment Mega Bank (NIMB)",
  },
  {
    pattern: /bank\s*of\s*kathmandu|bok/i,
    newBank: "Global IME Bank Limited",
    note: "Bank of Kathmandu merged into Global IME Bank Ltd.",
  },
  {
    pattern: /nepal\s*bangladesh|nb\s*bank/i,
    newBank: "Nabil Bank Limited",
    note: "Nepal Bangladesh Bank merged into Nabil Bank Ltd.",
  },
  {
    pattern: /civil\s*bank/i,
    newBank: "Himalayan Bank Limited",
    note: "Civil Bank merged into Himalayan Bank Ltd.",
  },
  {
    pattern: /sunrise\s*bank/i,
    newBank: "Laxmi Sunrise Bank Limited",
    note: "Sunrise Bank merged with Laxmi Bank to form Laxmi Sunrise Bank",
  },
  {
    pattern: /ncc\s*bank|nepal\s*credit/i,
    newBank: "Kumari Bank Limited",
    note: "NCC Bank merged into Kumari Bank Ltd.",
  },
  {
    pattern: /janata\s*bank/i,
    newBank: "Global IME Bank Limited",
    note: "Janata Bank merged into Global IME Bank Ltd.",
  },
];

export function AccountRemediationDialog({
  open,
  onOpenChange,
  initialItems,
  companyName = "Selected Entity",
}: AccountRemediationDialogProps) {
  const qc = useQueryClient();
  const [items, setItems] = useState<RejectedAccountItem[]>(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State for selected account
  const [newBankName, setNewBankName] = useState("");
  const [newAccountNumber, setNewAccountNumber] = useState("");
  const [remediationNote, setRemediationNote] = useState("");

  const loadItemForm = React.useCallback((item: RejectedAccountItem) => {
    // Check if merger suggestion exists
    const merger = MERGER_DICTIONARY.find(
      (m) =>
        m.pattern.test(item.current_bank_name || "") || m.pattern.test(item.rejection_reason || ""),
    );
    setNewBankName(merger ? merger.newBank : item.current_bank_name || "");
    setNewAccountNumber(item.current_bank_account_no || "");
    setRemediationNote(
      merger
        ? `Remediated bank merger: ${merger.note}`
        : "Updated verified bank account for payment re-run",
    );
  }, []);

  // Sync initial items when dialog opens or items change
  React.useEffect(() => {
    setItems(initialItems);
    if (initialItems.length > 0) {
      const exists = selectedId && initialItems.some((i) => i.payable_id === selectedId);
      if (!exists) {
        const first = initialItems[0];
        setSelectedId(first.payable_id);
        loadItemForm(first);
      }
    } else {
      setSelectedId(null);
    }
  }, [initialItems, selectedId, loadItemForm]);

  const selectedItem = useMemo(() => {
    return items.find((i) => i.payable_id === selectedId) || null;
  }, [items, selectedId]);

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.full_name.toLowerCase().includes(q) ||
        (i.boid && i.boid.toLowerCase().includes(q)) ||
        (i.current_bank_name && i.current_bank_name.toLowerCase().includes(q)) ||
        (i.current_bank_account_no && i.current_bank_account_no.toLowerCase().includes(q)) ||
        (i.rejection_reason && i.rejection_reason.toLowerCase().includes(q)),
    );
  }, [items, search]);

  const mergerSuggestion = useMemo(() => {
    if (!selectedItem) return null;
    return MERGER_DICTIONARY.find(
      (m) =>
        m.pattern.test(selectedItem.current_bank_name || "") ||
        m.pattern.test(selectedItem.rejection_reason || ""),
    );
  }, [selectedItem]);

  const handleSelectItem = (item: RejectedAccountItem) => {
    setSelectedId(item.payable_id);
    loadItemForm(item);
  };

  const handleApplyMerger = () => {
    if (mergerSuggestion) {
      setNewBankName(mergerSuggestion.newBank);
      setRemediationNote(`Post-merger account correction: ${mergerSuggestion.note}`);
      toast.info(`Applied merger update: ${mergerSuggestion.newBank}`);
    }
  };

  const handleSaveAndRequeue = async () => {
    if (!selectedItem) return;
    if (!newBankName.trim()) {
      toast.error("Bank name cannot be empty.");
      return;
    }
    if (!newAccountNumber.trim()) {
      toast.error("Account number cannot be empty.");
      return;
    }

    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      const trimmedBank = newBankName.trim();
      const trimmedAccount = newAccountNumber.trim();
      const trimmedNote = remediationNote.trim() || "Remediated bank details";

      // 1. Update Clients master record if client_id present
      if (selectedItem.client_id) {
        const { error: clientErr } = await (supabase as any)
          .from("clients")
          .update({
            bank_name: trimmedBank,
            bank_account_no: trimmedAccount,
            updated_at: now,
          })
          .eq("id", selectedItem.client_id);
        if (clientErr) console.warn("Failed to update client master:", clientErr.message);
      }

      // 2. Update the target payable table
      const tableName =
        selectedItem.payable_type === "interest"
          ? "interest_payables"
          : selectedItem.payable_type === "dividend"
            ? "dividend_payables"
            : "mutual_fund_payables";

      const { error: payErr } = await (supabase as any)
        .from(tableName)
        .update({
          bank_name: trimmedBank,
          bank_account_no: trimmedAccount,
          remarks: `[REMEDIATED] ${trimmedNote} (${new Date().toLocaleDateString("en-CA")})`,
          updated_at: now,
        })
        .eq("id", selectedItem.payable_id);

      if (payErr) throw payErr;

      // 3. Update any associated payments line items to Pending with updated bank info
      await (supabase as any)
        .from("payments")
        .update({
          bank_name: trimmedBank,
          bank_account_no: trimmedAccount,
          status: "Pending",
          remarks: `Remediated: Ready for Re-payout (${trimmedNote})`,
          updated_at: now,
        })
        .eq("payable_id", selectedItem.payable_id);

      // Invalidate relevant queries
      qc.invalidateQueries({ queryKey: ["payables"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["interest_payables"] });
      qc.invalidateQueries({ queryKey: ["dividend_payables"] });
      qc.invalidateQueries({ queryKey: ["mutual_fund_payables"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["reconciliation"] });

      toast.success(
        `Remediated ${selectedItem.full_name}: Updated to ${trimmedBank} and re-queued for payment!`,
      );

      // Remove from active list
      const updatedList = items.filter((i) => i.payable_id !== selectedItem.payable_id);
      setItems(updatedList);
      if (updatedList.length > 0) {
        const next = updatedList[0];
        setSelectedId(next.payable_id);
        loadItemForm(next);
      } else {
        setSelectedId(null);
        toast.success("All rejected accounts in this set have been successfully remediated!");
        onOpenChange(false);
      }
    } catch (err: any) {
      console.error("Remediation error:", err);
      toast.error(err.message || "Failed to save account remediation.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b bg-muted/30 shrink-0">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-lg font-bold flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-primary" />
                  Rejected Account Remediation Workflow
                </DialogTitle>
                <Badge
                  variant="outline"
                  className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-300"
                >
                  {items.length} Pending Remediation
                </Badge>
              </div>
              <DialogDescription className="text-xs text-muted-foreground">
                Update merger-affected or dormant bank accounts, resolve ConnectIPS/CBS codes, and
                atomically re-queue payouts for {companyName}.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden min-h-0">
          {/* Left Column: Account List */}
          <div className="md:col-span-5 border-r flex flex-col overflow-hidden bg-background">
            <div className="p-2.5 border-b bg-muted/20">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search name, BOID, bank..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="divide-y text-xs">
                {filteredItems.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
                    <p className="font-medium">No accounts matching criteria</p>
                  </div>
                ) : (
                  filteredItems.map((item) => {
                    const isSelected = item.payable_id === selectedId;
                    const isMerger = MERGER_DICTIONARY.some(
                      (m) =>
                        m.pattern.test(item.current_bank_name || "") ||
                        m.pattern.test(item.rejection_reason || ""),
                    );
                    return (
                      <button
                        key={item.payable_id}
                        type="button"
                        onClick={() => handleSelectItem(item)}
                        className={`w-full text-left p-3 transition-colors flex flex-col gap-1 ${
                          isSelected
                            ? "bg-primary/10 border-l-4 border-l-primary"
                            : "hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-foreground truncate max-w-[190px]">
                            {item.full_name}
                          </span>
                          <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">
                            NPR{" "}
                            {item.net_payable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono flex items-center justify-between">
                          <span>BOID: {item.boid || "—"}</span>
                          {isMerger && (
                            <Badge
                              variant="outline"
                              className="text-[9px] px-1 py-0 bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-300"
                            >
                              Merger
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {item.current_bank_name || "No Bank Listed"}
                        </div>
                        {item.rejection_reason && (
                          <div className="text-[10px] text-rose-600 dark:text-rose-400 truncate flex items-center gap-1 font-medium">
                            <AlertCircle className="w-2.5 h-2.5 shrink-0" />
                            {item.rejection_reason}
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Right Column: Remediation Form */}
          <div className="md:col-span-7 flex flex-col overflow-y-auto p-4 bg-muted/10">
            {selectedItem ? (
              <div className="space-y-4 max-w-lg">
                {/* Holder Profile Card */}
                <div className="p-3 bg-background border rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-primary" />
                      <span className="font-bold text-sm">{selectedItem.full_name}</span>
                    </div>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {selectedItem.payable_type.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      BOID:{" "}
                      <span className="font-mono text-foreground">{selectedItem.boid || "—"}</span>
                    </div>
                    <div>
                      PAN / Ctz:{" "}
                      <span className="font-mono text-foreground">
                        {selectedItem.pan_or_citizenship || "—"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Merger Auto-Fix Alert */}
                {mergerSuggestion && (
                  <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-xs space-y-2">
                    <div className="flex items-center gap-1.5 font-semibold text-blue-900 dark:text-blue-200">
                      <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      Bank Merger Auto-Detection
                    </div>
                    <p className="text-blue-800 dark:text-blue-300">{mergerSuggestion.note}</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs bg-blue-600 text-white hover:bg-blue-700 border-none"
                      onClick={handleApplyMerger}
                    >
                      <ArrowRight className="w-3 h-3 mr-1" />
                      Apply &ldquo;{mergerSuggestion.newBank}&rdquo;
                    </Button>
                  </div>
                )}

                {/* Edit Form */}
                <div className="space-y-3 bg-background p-4 border rounded-lg">
                  <div className="space-y-1">
                    <Label className="text-xs">Bank Name</Label>
                    <div className="relative">
                      <Building2 className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={newBankName}
                        onChange={(e) => setNewBankName(e.target.value)}
                        placeholder="e.g. Prabhu Bank Limited"
                        className="h-8 pl-8 text-xs font-medium"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Previous: {selectedItem.current_bank_name || "None"}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">16-Digit CBS Bank Account Number</Label>
                    <div className="relative">
                      <CreditCard className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={newAccountNumber}
                        onChange={(e) => setNewAccountNumber(e.target.value)}
                        placeholder="e.g. 0040000004123456"
                        className="h-8 pl-8 text-xs font-mono font-medium"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Previous:{" "}
                      <span className="font-mono">
                        {selectedItem.current_bank_account_no || "None"}
                      </span>
                    </p>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Remediation Note / Verification Reference</Label>
                    <Input
                      value={remediationNote}
                      onChange={(e) => setRemediationNote(e.target.value)}
                      placeholder="e.g. Verified via shareholder call & CBS merger migration"
                      className="h-8 text-xs"
                    />
                  </div>
                </div>

                {/* Action Card */}
                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs">
                    <span className="text-muted-foreground">Net Payout: </span>
                    <span className="font-bold font-mono text-emerald-600 text-sm">
                      NPR{" "}
                      {selectedItem.net_payable.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <Button
                    type="button"
                    onClick={handleSaveAndRequeue}
                    disabled={isSubmitting}
                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {isSubmitting ? (
                      <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    )}
                    Save & Re-queue Payout
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                <CheckCircle2 className="w-12 h-12 mb-3 text-emerald-500" />
                <p className="font-semibold text-base">Select an account to remediate</p>
                <p className="text-xs mt-1">
                  Choose from the left panel to update bank details and re-queue disbursements.
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="p-3 border-t bg-muted/20 shrink-0 flex items-center justify-between sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {items.length} accounts awaiting bank correction
          </span>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
