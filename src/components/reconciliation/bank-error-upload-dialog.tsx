import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileSpreadsheet,
  Upload,
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  XCircle,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import {
  BankErrorProcessorService,
  BankErrorProcessingResult,
  BankErrorRow,
} from "@/lib/services/bank-error-processor.service";
import { fmtNpr } from "@/lib/nepal-currency";

interface BankErrorUploadDialogProps {
  companyId?: string;
  triggerButton?: React.ReactNode;
  onSuccess?: () => void;
}

export function BankErrorUploadDialog({
  companyId,
  triggerButton,
  onSuccess,
}: BankErrorUploadDialogProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<BankErrorProcessingResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setResult(null);
    }
  };

  const handleUploadAndProcess = async () => {
    if (!file) {
      toast.error("Please select a bank error or return report file.");
      return;
    }

    setIsProcessing(true);
    try {
      const res = await BankErrorProcessorService.processAndApplyBankErrors(
        file,
        companyId && companyId !== "all" ? companyId : undefined,
      );
      setResult(res);

      if (res.segregatedErrorCount > 0) {
        toast.success(
          `Segregated ${res.segregatedErrorCount} bank error records. ${res.matchedPayablesCount} payables updated to Remaining Payable.`,
        );
        // Invalidate queries to refresh payables, payments, and declaration summaries
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["payments"] }),
          queryClient.invalidateQueries({ queryKey: ["payment-batches"] }),
          queryClient.invalidateQueries({ queryKey: ["dividend_payables"] }),
          queryClient.invalidateQueries({ queryKey: ["interest_payables"] }),
          queryClient.invalidateQueries({ queryKey: ["corporate-declarations"] }),
          queryClient.invalidateQueries({ queryKey: ["declaration-summary"] }),
          queryClient.invalidateQueries({ queryKey: ["reconciliation-results"] }),
        ]);
        if (onSuccess) onSuccess();
      } else {
        toast.warning("No bank rejection rows were detected in the file.");
      }
    } catch (err: any) {
      console.error("Bank error processing failed:", err);
      toast.error(err?.message || "Failed to process bank error file.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExport = async () => {
    if (!result || result.items.length === 0) return;
    try {
      const exportName = `Segregated_Bank_Errors_${new Date().toISOString().split("T")[0]}`;
      await BankErrorProcessorService.exportSegregatedErrorReport(result.items, exportName);
      toast.success("Exported segregated bank error report to Excel.");
    } catch (err: any) {
      toast.error("Failed to export Excel report: " + err.message);
    }
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-8 text-xs border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40"
          >
            <Upload className="h-3.5 w-3.5" /> Upload Bank Error Report
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-rose-700 dark:text-rose-400">
            <AlertTriangle className="h-4 w-4" /> Bank Error &amp; Return Report Ingestion
          </DialogTitle>
          <DialogDescription className="text-xs">
            Upload bank response files containing failed or returned transactions (ConnectIPS /
            Commercial Bank CBS). The system will automatically segregate errors, capture failure
            remarks, and track remaining payable amounts.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {/* File Picker */}
          {!result && (
            <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-3 hover:border-primary/50 transition-colors">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="hidden"
                id="bank-error-file"
              />
              <FileSpreadsheet className="w-10 h-10 mx-auto text-muted-foreground" />
              <div>
                <label
                  htmlFor="bank-error-file"
                  className="font-semibold text-primary cursor-pointer hover:underline text-sm"
                >
                  Choose Excel or CSV bank error report
                </label>
                <p className="text-xs text-muted-foreground mt-1">
                  Supports ConnectIPS Reject Excel, CBS Returns, ACH Return files
                </p>
              </div>
              {file && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-muted rounded text-xs font-mono">
                  <span>{file.name}</span>
                  <span className="text-muted-foreground">
                    ({(file.size / 1024).toFixed(1)} KB)
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Results Summary */}
          {result && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-muted/40 p-3 rounded-lg border text-center">
                  <span className="text-[11px] text-muted-foreground block">Total File Rows</span>
                  <span className="text-lg font-bold font-mono">{result.totalRows}</span>
                </div>
                <div className="bg-rose-500/10 p-3 rounded-lg border border-rose-300 dark:border-rose-800 text-center">
                  <span className="text-[11px] text-rose-700 dark:text-rose-300 block">
                    Segregated Errors
                  </span>
                  <span className="text-lg font-bold font-mono text-rose-600 dark:text-rose-400">
                    {result.segregatedErrorCount}
                  </span>
                </div>
                <div className="bg-emerald-500/10 p-3 rounded-lg border border-emerald-300 dark:border-emerald-800 text-center">
                  <span className="text-[11px] text-emerald-700 dark:text-emerald-300 block">
                    Payables Re-flagged
                  </span>
                  <span className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                    {result.matchedPayablesCount}
                  </span>
                </div>
                <div className="bg-amber-500/10 p-3 rounded-lg border border-amber-300 dark:border-amber-800 text-center">
                  <span className="text-[11px] text-amber-700 dark:text-amber-300 block">
                    Total Remaining
                  </span>
                  <span className="text-sm font-bold font-mono text-amber-600 dark:text-amber-400 truncate block">
                    {fmtNpr(result.totalRemainingPayableAmount)}
                  </span>
                </div>
              </div>

              {result.items.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="p-2.5 bg-muted/40 border-b flex items-center justify-between">
                    <span className="text-xs font-semibold">Segregated Failed Transactions</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={handleExport}
                    >
                      <Download className="h-3 w-3" /> Export Excel Report
                    </Button>
                  </div>
                  <ScrollArea className="h-60">
                    <Table>
                      <TableHeader className="text-[11px]">
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Shareholder / Beneficiary</TableHead>
                          <TableHead>Account No.</TableHead>
                          <TableHead className="text-right">Amount (NPR)</TableHead>
                          <TableHead>Bank Failure Reason</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody className="text-xs">
                        {result.items.map((it, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-[11px]">{idx + 1}</TableCell>
                            <TableCell>
                              <div className="font-medium">
                                {it.matchedClientName || it.beneficiaryName || "—"}
                              </div>
                              {it.matchedBoid && (
                                <div className="text-[10px] text-muted-foreground font-mono">
                                  {it.matchedBoid}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-[11px]">
                              {it.accountNumber || "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {it.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-rose-600 dark:text-rose-400 font-medium">
                              {it.errorReason}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-rose-50 text-rose-700 border-rose-300"
                              >
                                Remaining Payable
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {result ? (
            <Button size="sm" variant="outline" onClick={handleReset} className="gap-1 text-xs">
              <RotateCcw className="h-3.5 w-3.5" /> Ingest Another File
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setOpen(false)} className="text-xs">
              Cancel
            </Button>
          )}

          {!result && (
            <Button
              size="sm"
              onClick={handleUploadAndProcess}
              disabled={!file || isProcessing}
              className="gap-1.5 text-xs bg-rose-600 hover:bg-rose-700 text-white"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing...
                </>
              ) : (
                <>
                  <Upload className="h-3.5 w-3.5" /> Process &amp; Segregate Errors
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
