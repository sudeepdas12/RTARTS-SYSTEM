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

interface MarkPaidDialogProps {
  open: boolean;
  onClose: () => void;
  payDate: string;
  setPayDate: (val: string) => void;
  payRef: string;
  setPayRef: (val: string) => void;
  isPending: boolean;
  onConfirm: () => void;
  confirmLabel?: string;
}

export function MarkPaidDialog({
  open,
  onClose,
  payDate,
  setPayDate,
  payRef,
  setPayRef,
  isPending,
  onConfirm,
  confirmLabel = "Confirm Payment",
}: MarkPaidDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark as Paid</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Payment Date</Label>
            <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Payment Reference</Label>
            <Input
              placeholder="Cheque / Txn no."
              value={payRef}
              onChange={(e) => setPayRef(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={isPending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface BulkMarkPaidDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedPendingCount: number;
  selectedTotalNetFormatted: string;
  bulkPayRef: string;
  setBulkPayRef: (val: string) => void;
  bulkPayDate: string;
  setBulkPayDate: (val: string) => void;
  isPending: boolean;
  onConfirm: () => void;
}

export function BulkMarkPaidDialog({
  open,
  onOpenChange,
  selectedPendingCount,
  selectedTotalNetFormatted,
  bulkPayRef,
  setBulkPayRef,
  bulkPayDate,
  setBulkPayDate,
  isPending,
  onConfirm,
}: BulkMarkPaidDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark Selected Payables as Paid</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 text-sm">
          <div className="rounded-md border bg-muted/30 p-3 space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Selected items:</span>
              <span className="font-semibold">{selectedPendingCount} pending payables</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Net Payout:</span>
              <span className="font-mono font-bold text-foreground">
                NPR {selectedTotalNetFormatted}
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Payment Reference / Bank Trx ID</Label>
            <Input
              placeholder="e.g., CIPS-BULK-2081-01"
              value={bulkPayRef}
              onChange={(e) => setBulkPayRef(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Payment Date</Label>
            <Input
              type="date"
              value={bulkPayDate}
              onChange={(e) => setBulkPayDate(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={isPending}
            onClick={onConfirm}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isPending ? "Updating..." : `Mark ${selectedPendingCount} as Paid`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
