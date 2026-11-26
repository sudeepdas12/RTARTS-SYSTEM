import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  SmsBroadcastService,
  type BroadcastSummary,
  type BroadcastTemplateType,
} from "@/lib/services/sms-broadcast.service";
import { FileSpreadsheet, Send } from "lucide-react";
import { toast } from "sonner";

interface PaymentBroadcastDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  broadcastSummary: BroadcastSummary | null;
  setBroadcastSummary: (summary: BroadcastSummary | null) => void;
  broadcastTemplateType: BroadcastTemplateType;
  onTemplateChange: (type: BroadcastTemplateType) => void;
  customMessageTemplate: string;
  setCustomMessageTemplate: (msg: string) => void;
}

export function PaymentBroadcastDialog({
  open,
  onOpenChange,
  broadcastSummary,
  setBroadcastSummary,
  broadcastTemplateType,
  onTemplateChange,
  customMessageTemplate,
  setCustomMessageTemplate,
}: PaymentBroadcastDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-5 pb-3 border-b shrink-0">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Send className="h-5 w-5 text-purple-600" />
            Shareholder Notification & SMS Broadcast Engine
          </DialogTitle>
        </DialogHeader>

        {broadcastSummary && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Batch Metadata & Metric Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-muted/30 border rounded-lg">
                <span className="text-xs text-muted-foreground uppercase font-medium">
                  Recipients
                </span>
                <div className="text-lg font-bold mt-0.5">
                  {broadcastSummary.totalRecipients.toLocaleString()}
                </div>
              </div>
              <div className="p-3 bg-muted/30 border rounded-lg">
                <span className="text-xs text-muted-foreground uppercase font-medium">
                  Valid Mobile (Nepal)
                </span>
                <div className="text-lg font-bold mt-0.5 text-emerald-600">
                  {broadcastSummary.validPhones.toLocaleString()}
                </div>
              </div>
              <div className="p-3 bg-muted/30 border rounded-lg">
                <span className="text-xs text-muted-foreground uppercase font-medium">
                  Invalid / Missing
                </span>
                <div className="text-lg font-bold mt-0.5 text-amber-600">
                  {broadcastSummary.invalidPhones.toLocaleString()}
                </div>
              </div>
              <div className="p-3 bg-muted/30 border rounded-lg">
                <span className="text-xs text-muted-foreground uppercase font-medium">
                  Total Payout
                </span>
                <div className="text-lg font-bold mt-0.5 text-primary">
                  NPR {broadcastSummary.totalAmount.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Template Selector */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Notification Template</Label>
              <Select
                value={broadcastTemplateType}
                onValueChange={(v) => onTemplateChange(v as BroadcastTemplateType)}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PAYMENT_SUCCESS">
                    ✅ Payment Disbursed (ConnectIPS Payout Confirmation)
                  </SelectItem>
                  <SelectItem value="PAYMENT_FAILED">
                    ⚠️ Payment Failed / Invalid Bank Mandate Notice
                  </SelectItem>
                  <SelectItem value="BONUS_CREDITED">
                    🎁 Bonus Shares Credited to DEMAT Alert
                  </SelectItem>
                  <SelectItem value="AGM_NOTICE">📢 AGM & Book Closure Announcement</SelectItem>
                  <SelectItem value="CUSTOM">✏️ Custom Message Template</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Message Content Editor / Preview */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">
                  Message Preview (Supports Tokens: {"{{name}}"}, {"{{amount}}"}, {"{{company}}"},{" "}
                  {"{{boid}}"}, {"{{fy}}"}, {"{{ref}}"})
                </Label>
                <span className="text-[11px] text-muted-foreground font-mono">
                  ~{customMessageTemplate.length} chars (
                  {Math.ceil(customMessageTemplate.length / 160) || 1} SMS)
                </span>
              </div>
              <Textarea
                rows={3}
                value={customMessageTemplate}
                onChange={(e) => {
                  setCustomMessageTemplate(e.target.value);
                  if (broadcastSummary) {
                    const updated = SmsBroadcastService.buildBroadcastQueue({
                      items: broadcastSummary.messages.map((m) => ({
                        id: m.id,
                        payeeName: m.recipientName,
                        boid: m.boid,
                        phone: m.phone,
                        companyName: m.companyName,
                        fiscalYear: m.fiscalYear,
                        amount: m.amount,
                      })),
                      templateType: broadcastTemplateType,
                      customTemplate: e.target.value,
                    });
                    setBroadcastSummary(updated);
                  }
                }}
                className="text-xs font-sans leading-relaxed"
              />
            </div>

            {/* Recipient Sample Preview Table */}
            <div className="border rounded-lg overflow-x-auto max-h-52">
              <Table>
                <TableHeader className="bg-muted/50 sticky top-0">
                  <TableRow>
                    <TableHead className="w-10">S.N.</TableHead>
                    <TableHead>Mobile</TableHead>
                    <TableHead>Payee</TableHead>
                    <TableHead>BOID</TableHead>
                    <TableHead>Personalized Message</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {broadcastSummary.messages.slice(0, 10).map((msg, idx) => (
                    <TableRow key={msg.id || idx}>
                      <TableCell className="font-mono text-xs">{idx + 1}</TableCell>
                      <TableCell className="font-mono text-xs font-medium">
                        {msg.phone || "—"}
                      </TableCell>
                      <TableCell className="text-xs font-medium">{msg.recipientName}</TableCell>
                      <TableCell className="font-mono text-xs">{msg.boid}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">
                        {msg.messageText}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={msg.status === "QUEUED" ? "default" : "outline"}
                          className="text-[10px]"
                        >
                          {msg.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter className="p-4 border-t bg-muted/20 shrink-0 flex flex-row items-center justify-between sm:justify-between w-full">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {broadcastSummary && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs text-emerald-700 dark:text-emerald-400 border-emerald-500/40 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                onClick={() => SmsBroadcastService.exportBroadcastCsv(broadcastSummary)}
              >
                <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />
                Download Gateway CSV
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs bg-purple-600 hover:bg-purple-700"
                onClick={() => {
                  SmsBroadcastService.exportBroadcastCsv(broadcastSummary);
                  toast.success(
                    `Broadcast file generated for ${broadcastSummary.validPhones.toLocaleString()} verified mobile numbers. Ready for SMS gateway dispatch (Sparrow/Aakash/NTC).`,
                  );
                  onOpenChange(false);
                }}
              >
                <Send className="h-3.5 w-3.5 mr-1.5" />
                Export & Dispatch Gateway Broadcast
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
