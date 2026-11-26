import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  BankStatementTransactionRow,
  ReconciliationService,
} from "@/lib/services/reconciliation.service";
import type { ManualReconciliationMode } from "./manual-reconciliation-dialog";
import { ExternalLink, Link2, PlusCircle, RefreshCw, Search, Tag, Zap } from "lucide-react";
import { toast } from "sonner";

export interface BankLedgerWorkbenchTabProps {
  selectedCompanyIds: string[];
  canApply: boolean;
  onOpenManualDialog: (
    mode: ManualReconciliationMode,
    txns?: BankStatementTransactionRow[],
  ) => void;
  onSyncConnectIpsComplete?: () => void;
}

export function BankLedgerWorkbenchTab({
  selectedCompanyIds,
  canApply,
  onOpenManualDialog,
  onSyncConnectIpsComplete,
}: BankLedgerWorkbenchTabProps) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("unreconciled");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSyncingIps, setIsSyncingIps] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: [
      "bank_statement_transactions",
      selectedCompanyIds,
      statusFilter,
      channelFilter,
      search,
    ],
    queryFn: () =>
      ReconciliationService.getBankStatementTransactions({
        companyIds: selectedCompanyIds,
        reconciliationStatus: statusFilter,
        entryChannel: channelFilter,
        search,
        limit: 100,
      }),
  });

  const rows = useMemo(() => data?.rows || [], [data]);
  const selectedRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          selectedIds.has(r.id) &&
          r.reconciliation_status === "unreconciled" &&
          r.approval_status !== "pending_approval",
      ),
    [rows, selectedIds],
  );

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSyncConnectIps = async () => {
    setIsSyncingIps(true);
    try {
      const res = await ReconciliationService.autoReconcileConnectIpsBatches(selectedCompanyIds);
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ["bank_statement_transactions"] });
      qc.invalidateQueries({ queryKey: ["brs_statement"] });
      onSyncConnectIpsComplete?.();
    } catch (err: any) {
      toast.error(err?.message || "ConnectIPS auto-reconciliation failed.");
    } finally {
      setIsSyncingIps(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Bank Ledger &amp; Manual Matching Workbench</CardTitle>
            <CardDescription className="text-xs">
              Persistent bank statement lines across file uploads, manual counter/cheque entries,
              and API syncs. Select unreconciled items to pair 1↔1 / 1↔N / N↔1 or classify
              non-payable bank charges.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canApply && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSyncConnectIps}
                  disabled={isSyncingIps}
                >
                  <Zap className="w-3.5 h-3.5 mr-1.5 text-amber-500" />
                  {isSyncingIps ? "Syncing..." : "Sync ConnectIPS"}
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => onOpenManualDialog("manual_entry", [])}
                >
                  <PlusCircle className="w-3.5 h-3.5 mr-1.5" />+ Manual Entry
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refetch()}
              disabled={isFetching}
              title="Refresh bank ledger"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Search reference, description, or reason code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="unreconciled">Unreconciled</SelectItem>
              <SelectItem value="reconciled">Reconciled</SelectItem>
              <SelectItem value="ignored">Non-Payable / Ignored</SelectItem>
              <SelectItem value="exception">Exception</SelectItem>
            </SelectContent>
          </Select>
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Channels</SelectItem>
              <SelectItem value="file_upload">File Upload</SelectItem>
              <SelectItem value="manual_entry">Manual Entry</SelectItem>
              <SelectItem value="api_sync">API Sync</SelectItem>
            </SelectContent>
          </Select>

          {canApply && selectedRows.length > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <Button
                size="sm"
                variant="secondary"
                className="h-8 text-xs"
                onClick={() => onOpenManualDialog("pair_payables", selectedRows)}
              >
                <Link2 className="w-3.5 h-3.5 mr-1.5" />
                Pair to Payable ({selectedRows.length})
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => onOpenManualDialog("classify_non_payable", selectedRows)}
              >
                <Tag className="w-3.5 h-3.5 mr-1.5" />
                Classify Non-Payable
              </Button>
            </div>
          )}
        </div>

        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Date</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Reference &amp; Description</TableHead>
                <TableHead className="text-right">Debit (NPR)</TableHead>
                <TableHead className="text-right">Credit (NPR)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Voucher</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-xs text-muted-foreground">
                    Loading bank statement ledger...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-xs text-muted-foreground">
                    No bank statement ledger transactions found for the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const isSelectable =
                    row.reconciliation_status === "unreconciled" &&
                    row.approval_status !== "pending_approval";
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(row.id)}
                          disabled={!isSelectable}
                          onCheckedChange={() => toggleRow(row.id)}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {row.transaction_date}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {row.entry_channel === "manual_entry"
                            ? "Manual"
                            : row.entry_channel === "api_sync"
                              ? "API"
                              : "File"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-sm">
                        <div className="text-xs font-medium truncate">
                          {row.reference || "No Reference"}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {row.description || "—"}
                        </div>
                        {row.reason_code && (
                          <span className="text-[10px] font-mono text-primary">
                            {row.reason_code}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {Number(row.debit_amount || 0) > 0
                          ? Number(row.debit_amount).toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                            })
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {Number(row.credit_amount || 0) > 0
                          ? Number(row.credit_amount).toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                            })
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge
                            variant={
                              row.reconciliation_status === "reconciled"
                                ? "default"
                                : row.reconciliation_status === "ignored"
                                  ? "secondary"
                                  : "outline"
                            }
                            className="text-[10px] w-fit capitalize"
                          >
                            {row.reconciliation_status}
                          </Badge>
                          {row.approval_status === "pending_approval" && (
                            <Badge className="text-[10px] w-fit bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-300">
                              Pending Checker
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {row.evidence_path ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={async () => {
                              try {
                                const url = await ReconciliationService.getEvidenceSignedUrl(
                                  row.evidence_path!,
                                );
                                window.open(url, "_blank", "noopener,noreferrer");
                              } catch (err: any) {
                                toast.error(err?.message || "Failed to load voucher");
                              }
                            }}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
