import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { CheckCircle2, Loader2 } from "lucide-react";

type PaymentMethod = "NEFT" | "RTGS" | "ConnectIPS" | "Cheque" | "Cash";

interface EditBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editBatchName: string;
  setEditBatchName: (val: string) => void;
  editPayableType: string;
  setEditPayableType: (val: string) => void;
  editFiscalYear: string;
  setEditFiscalYear: (val: string) => void;
  editPaymentMethod: PaymentMethod;
  setEditPaymentMethod: (val: PaymentMethod) => void;
  editCdsBatchRef: string;
  setEditCdsBatchRef: (val: string) => void;
  editRegistrar: string;
  setEditRegistrar: (val: string) => void;
  fiscalYears: string[];
  isUpdatingBatch: boolean;
  onSave: () => void;
}

export function EditBatchDialog({
  open,
  onOpenChange,
  editBatchName,
  setEditBatchName,
  editPayableType,
  setEditPayableType,
  editFiscalYear,
  setEditFiscalYear,
  editPaymentMethod,
  setEditPaymentMethod,
  editCdsBatchRef,
  setEditCdsBatchRef,
  editRegistrar,
  setEditRegistrar,
  fiscalYears,
  isUpdatingBatch,
  onSave,
}: EditBatchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-6 pb-3 border-b shrink-0">
          <DialogTitle>Edit Batch Settings</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="space-y-2">
            <Label>Batch Name</Label>
            <Input
              value={editBatchName}
              onChange={(e) => setEditBatchName(e.target.value)}
              placeholder="Batch name"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Payable Type</Label>
              <Select value={editPayableType} onValueChange={setEditPayableType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dividend">Dividend</SelectItem>
                  <SelectItem value="interest">Interest</SelectItem>
                  <SelectItem value="mutual_fund">Mutual Fund</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Fiscal Year</Label>
              <Select value={editFiscalYear} onValueChange={setEditFiscalYear}>
                <SelectTrigger>
                  <SelectValue placeholder="Fiscal Year" />
                </SelectTrigger>
                <SelectContent className="max-h-60 overflow-y-auto">
                  {fiscalYears.map((fy) => (
                    <SelectItem key={fy} value={fy}>
                      {fy}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Payment Method</Label>
            <Select
              value={editPaymentMethod}
              onValueChange={(v) => setEditPaymentMethod(v as PaymentMethod)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["NEFT", "RTGS", "ConnectIPS", "Cheque", "Cash"] as PaymentMethod[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>CDS Batch Ref</Label>
              <Input
                value={editCdsBatchRef}
                onChange={(e) => setEditCdsBatchRef(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label>Registrar</Label>
              <Input
                value={editRegistrar}
                onChange={(e) => setEditRegistrar(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
        </div>
        <DialogFooter className="p-4 border-t bg-muted/20 shrink-0 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={isUpdatingBatch} onClick={onSave}>
            {isUpdatingBatch ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4 mr-2" />
            )}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ReversePaymentDialogProps {
  payment: any | null;
  onClose: () => void;
  reversalReason: string;
  setReversalReason: (val: string) => void;
  onConfirm: () => void;
}

export function ReversePaymentDialog({
  payment,
  onClose,
  reversalReason,
  setReversalReason,
  onConfirm,
}: ReversePaymentDialogProps) {
  return (
    <Dialog open={!!payment} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reverse Payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to reverse this payment of{" "}
            <strong>
              NPR{" "}
              {Number(payment?.net_amount || 0).toLocaleString("en-IN", {
                minimumFractionDigits: 2,
              })}
            </strong>{" "}
            for {payment?.clients?.full_name || "this investor"}?
          </p>
          <div className="space-y-1.5">
            <Label>Reversal Reason</Label>
            <Input
              value={reversalReason}
              onChange={(e) => setReversalReason(e.target.value)}
              placeholder="e.g. Account closed / Bank rejected / Wrong A/C"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirm}>
              Confirm Reversal
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
