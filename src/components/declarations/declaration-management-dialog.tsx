import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Sparkles, Calendar, Building2, Tag, Percent } from "lucide-react";
import { toast } from "sonner";
import { DeclarationService, CorporateDeclaration } from "@/lib/services/declaration.service";

interface DeclarationManagementDialogProps {
  companyId?: string;
  companyName?: string;
  onDeclarationCreated?: (declaration: CorporateDeclaration) => void;
  triggerButton?: React.ReactNode;
}

export function DeclarationManagementDialog({
  companyId,
  companyName,
  onDeclarationCreated,
  triggerButton,
}: DeclarationManagementDialogProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const [declarationCode, setDeclarationCode] = useState("");
  const [declarationType, setDeclarationType] = useState<"Dividend" | "Interest">("Dividend");
  const [subType, setSubType] = useState("Cash");
  const [fiscalYear, setFiscalYear] = useState("2081/82");
  const [declarationDate, setDeclarationDate] = useState(new Date().toISOString().split("T")[0]);
  const [recordDate, setRecordDate] = useState("");
  const [ratePerShare, setRatePerShare] = useState("");
  const [totalDeclaredAmount, setTotalDeclaredAmount] = useState("");
  const [notes, setNotes] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!companyId || companyId === "auto" || companyId === "all") {
        throw new Error("Please select a target company first.");
      }
      if (!fiscalYear) {
        throw new Error("Fiscal year is required.");
      }

      const rate = Number(ratePerShare) || 0;
      const totalAmount = Number(totalDeclaredAmount) || 0;

      return await DeclarationService.createDeclaration({
        company_id: companyId,
        declaration_code: declarationCode.trim() || undefined,
        declaration_type: declarationType,
        sub_type: subType,
        fiscal_year: fiscalYear.trim(),
        declaration_date: declarationDate,
        record_date: recordDate || undefined,
        rate_per_share: rate,
        total_declared_amount: totalAmount,
        notes: notes.trim() || undefined,
        status: "Active",
      });
    },
    onSuccess: (newDec) => {
      toast.success(`Declaration created: ${newDec.declaration_code}`);
      queryClient.invalidateQueries({ queryKey: ["corporate-declarations"] });
      if (onDeclarationCreated) {
        onDeclarationCreated(newDec);
      }
      setOpen(false);
      // Reset form
      setDeclarationCode("");
      setRatePerShare("");
      setTotalDeclaredAmount("");
      setNotes("");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to create corporate declaration.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs">
            <Plus className="h-3.5 w-3.5" /> New Declaration
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> Create Corporate Declaration
          </DialogTitle>
          <DialogDescription className="text-xs">
            Record a formal dividend or interest declaration for{" "}
            <span className="font-semibold text-foreground">
              {companyName || "Selected Company"}
            </span>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Select
                value={declarationType}
                onValueChange={(v: any) => {
                  setDeclarationType(v);
                  if (v === "Interest") setSubType("Debenture_Coupon");
                  else setSubType("Cash");
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Dividend">Dividend</SelectItem>
                  <SelectItem value="Interest">Debenture Interest</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Sub-Type</Label>
              <Select value={subType} onValueChange={setSubType}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {declarationType === "Dividend" ? (
                    <>
                      <SelectItem value="Cash">Cash Dividend</SelectItem>
                      <SelectItem value="Bonus">Bonus Share</SelectItem>
                      <SelectItem value="Combined">Combined (Cash + Bonus)</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="Debenture_Coupon">Debenture Coupon</SelectItem>
                      <SelectItem value="Annual_Interest">Annual Interest</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Fiscal Year</Label>
              <Input
                className="h-8 text-xs"
                placeholder="e.g. 2081/82"
                value={fiscalYear}
                onChange={(e) => setFiscalYear(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Declaration Code (Optional)</Label>
              <Input
                className="h-8 text-xs font-mono"
                placeholder="Auto-generated if blank"
                value={declarationCode}
                onChange={(e) => setDeclarationCode(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Declaration Date</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={declarationDate}
                onChange={(e) => setDeclarationDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Record Date (Book Closure)</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={recordDate}
                onChange={(e) => setRecordDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Rate per Share / Coupon (%)</Label>
              <Input
                type="number"
                step="0.001"
                className="h-8 text-xs font-mono"
                placeholder="e.g. 5.5"
                value={ratePerShare}
                onChange={(e) => setRatePerShare(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Total Amount Declared (NPR)</Label>
              <Input
                type="number"
                step="1000"
                className="h-8 text-xs font-mono"
                placeholder="e.g. 50000000"
                value={totalDeclaredAmount}
                onChange={(e) => setTotalDeclaredAmount(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Notes / AGM Reference</Label>
            <Textarea
              className="text-xs min-h-[60px]"
              placeholder="e.g. Approved in 15th Annual General Meeting"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {createMutation.isPending ? "Creating..." : "Create Declaration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
