import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Download,
  FileSpreadsheet,
  Layers,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ReconciliationGroupedLot,
  ReconciliationResultRow,
  ReconciliationRunRow,
} from "@/lib/services/reconciliation.service";

export interface ReconciliationHistorySectionProps {
  isLoadingHistory: boolean;
  historyError: string | null;
  historyViewMode: "runs" | "lots";
  onChangeHistoryViewMode: (mode: "runs" | "lots") => void;
  onRefreshHistory: () => void;
  totalRunsCount: number;
  runsSummary: {
    total_amount: number;
    matched_count: number;
    unmatched_count: number;
    row_count: number;
  };
  reconciliationRuns: ReconciliationRunRow[];
  groupedLots: ReconciliationGroupedLot[];
  filteredGroupedLots: ReconciliationGroupedLot[];
  savedResultsCount: number;
  totalHistoryRecords: number;
  unlinkedHistoryCount: number;
  historySearchQuery: string;
  onChangeHistorySearchQuery: (q: string) => void;
  historyCompanyFilter: string;
  onChangeHistoryCompanyFilter: (c: string) => void;
  historySourceFilter: string;
  onChangeHistorySourceFilter: (s: string) => void;
  companiesList: { id: string; company_name: string; company_code: string }[];
  historyCompanies: string[];
  expandedLotKey: string | null;
  onToggleExpandLot: (lotKey: string | null) => void;
  lotDetailTabs: Record<string, "all" | "matched" | "rejected" | "discrepancy">;
  onChangeLotDetailTab: (
    lotKey: string,
    tab: "all" | "matched" | "rejected" | "discrepancy",
  ) => void;
  onExportLot: (lot: ReconciliationGroupedLot) => void;
  onRevertLot: (lot: ReconciliationGroupedLot) => void;
  onDeleteLot: (lot: ReconciliationGroupedLot) => void;
  onOpenRemediationForLot: (records: ReconciliationResultRow[]) => void;
  isAdmin: boolean;
  canDelete: boolean;
  isApplying: boolean;
}

export function ReconciliationHistorySection({
  isLoadingHistory,
  historyError,
  historyViewMode,
  onChangeHistoryViewMode,
  onRefreshHistory,
  totalRunsCount,
  runsSummary,
  reconciliationRuns,
  groupedLots,
  filteredGroupedLots,
  savedResultsCount,
  totalHistoryRecords,
  unlinkedHistoryCount,
  historySearchQuery,
  onChangeHistorySearchQuery,
  historyCompanyFilter,
  onChangeHistoryCompanyFilter,
  historySourceFilter,
  onChangeHistorySourceFilter,
  companiesList,
  historyCompanies,
  expandedLotKey,
  onToggleExpandLot,
  lotDetailTabs,
  onChangeLotDetailTab,
  onExportLot,
  onRevertLot,
  onDeleteLot,
  onOpenRemediationForLot,
  isAdmin,
  canDelete,
  isApplying,
}: ReconciliationHistorySectionProps) {
  return (
    <Card className="border mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Reconciliation History &amp; Audit Trail</CardTitle>
          <CardDescription>
            {isLoadingHistory
              ? "Loading reconciliation audit runs and lots..."
              : historyViewMode === "runs"
                ? `${totalRunsCount.toLocaleString()} immutable reconciliation run${totalRunsCount === 1 ? "" : "s"} tracked across all fiscal files.`
                : `${groupedLots.length} saved lot${groupedLots.length === 1 ? "" : "s"} (${savedResultsCount.toLocaleString()}${totalHistoryRecords > savedResultsCount ? ` of ${totalHistoryRecords.toLocaleString()}` : ""} records) loaded.`}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
            <Button
              variant={historyViewMode === "runs" ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs px-2.5"
              onClick={() => onChangeHistoryViewMode("runs")}
            >
              Audit Runs ({totalRunsCount})
            </Button>
            <Button
              variant={historyViewMode === "lots" ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs px-2.5"
              onClick={() => onChangeHistoryViewMode("lots")}
            >
              Grouped Lots ({groupedLots.length})
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onRefreshHistory}
            disabled={isLoadingHistory}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoadingHistory ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoadingHistory ? (
          <div className="text-center py-8 text-sm text-muted-foreground flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Loading saved reconciliation lots...
          </div>
        ) : historyViewMode === "runs" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-muted/40 rounded-lg border">
                <div className="text-[11px] text-muted-foreground font-medium">
                  Reconciliation Runs
                </div>
                <div className="text-lg font-bold text-foreground mt-0.5">
                  {totalRunsCount.toLocaleString()}
                </div>
              </div>
              <div className="p-3 bg-muted/40 rounded-lg border">
                <div className="text-[11px] text-muted-foreground font-medium">
                  Total Ingested Amount
                </div>
                <div className="text-lg font-bold text-foreground mt-0.5">
                  NPR{" "}
                  {runsSummary.total_amount.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
              <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                <div className="text-[11px] text-emerald-800 dark:text-emerald-300 font-medium">
                  Matched Rows
                </div>
                <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                  {runsSummary.matched_count.toLocaleString()}
                </div>
              </div>
              <div className="p-3 bg-amber-50/50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <div className="text-[11px] text-amber-800 dark:text-amber-300 font-medium">
                  Exceptions / Variance
                </div>
                <div className="text-lg font-bold text-amber-700 dark:text-amber-400 mt-0.5">
                  {runsSummary.unmatched_count.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search runs by file name, run ID, or notes..."
                  value={historySearchQuery}
                  onChange={(e) => onChangeHistorySearchQuery(e.target.value)}
                  className="pl-8 text-xs h-8"
                />
                {historySearchQuery && (
                  <button
                    onClick={() => onChangeHistorySearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {companiesList.length > 0 && (
                <Select value={historyCompanyFilter} onValueChange={onChangeHistoryCompanyFilter}>
                  <SelectTrigger className="w-52 h-8 text-xs">
                    <SelectValue placeholder="All Companies" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Companies</SelectItem>
                    {companiesList.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">
                        {c.company_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={historySourceFilter} onValueChange={onChangeHistorySourceFilter}>
                <SelectTrigger className="w-44 h-8 text-xs">
                  <SelectValue placeholder="All Sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    All Source Types
                  </SelectItem>
                  <SelectItem value="excel" className="text-xs">
                    Excel Lots
                  </SelectItem>
                  <SelectItem value="bank_statement" className="text-xs">
                    Bank Statements
                  </SelectItem>
                  <SelectItem value="connectips" className="text-xs">
                    ConnectIPS
                  </SelectItem>
                  <SelectItem value="nchl" className="text-xs">
                    NCHL Settlements
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {historyError ? (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center my-4">
                <p className="text-sm font-medium text-destructive mb-3">{historyError}</p>
                <Button variant="outline" size="sm" onClick={onRefreshHistory}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry Loading History
                </Button>
              </div>
            ) : reconciliationRuns.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <p>No reconciliation runs found for the current filter criteria.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                    <tr>
                      <th className="p-2.5 text-left">Date / Run</th>
                      <th className="p-2.5 text-left">File Name</th>
                      <th className="p-2.5 text-left">SHA-256 Hash</th>
                      <th className="p-2.5 text-left">Company</th>
                      <th className="p-2.5 text-right">Rows</th>
                      <th className="p-2.5 text-right">Total NPR</th>
                      <th className="p-2.5 text-center">Status</th>
                      <th className="p-2.5 text-center">Engine Ver</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {reconciliationRuns.map((run) => (
                      <tr key={run.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-2.5 font-mono text-[11px] whitespace-nowrap">
                          <div>
                            {run.created_at ? new Date(run.created_at).toLocaleDateString() : "-"}
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {run.id.slice(0, 8)}
                          </span>
                        </td>
                        <td
                          className="p-2.5 font-medium max-w-[200px] truncate"
                          title={run.file_name}
                        >
                          <div className="flex items-center gap-1.5">
                            <FileSpreadsheet className="w-3.5 h-3.5 text-primary shrink-0" />
                            <span className="truncate">{run.file_name}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground uppercase">
                            {run.source_type}
                          </span>
                        </td>
                        <td className="p-2.5 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                          <span title={run.file_hash_sha256}>
                            {run.file_hash_sha256 ? `${run.file_hash_sha256.slice(0, 10)}...` : "-"}
                          </span>
                        </td>
                        <td className="p-2.5 text-muted-foreground whitespace-nowrap">
                          {run.company_name || "All / Unassigned"}
                        </td>
                        <td className="p-2.5 text-right whitespace-nowrap">
                          <div>
                            <strong>{run.row_count}</strong> total
                          </div>
                          <div className="text-[10px] text-emerald-600 dark:text-emerald-400">
                            {run.matched_count} matched
                          </div>
                        </td>
                        <td className="p-2.5 text-right font-medium whitespace-nowrap">
                          NPR{" "}
                          {Number(run.total_amount || 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="p-2.5 text-center whitespace-nowrap">
                          <Badge
                            variant={
                              run.status === "applied"
                                ? "default"
                                : run.status === "review"
                                  ? "secondary"
                                  : run.status === "reverted"
                                    ? "destructive"
                                    : "outline"
                            }
                            className="text-[10px] capitalize"
                          >
                            {run.status}
                          </Badge>
                        </td>
                        <td className="p-2.5 text-center text-muted-foreground font-mono text-[10px]">
                          {run.matching_rule_version || "2.0.0"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : filteredGroupedLots.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            <p>No saved reconciliation history lots match the selected filter.</p>
            {historyCompanyFilter !== "all" && (
              <Button
                variant="link"
                size="sm"
                className="mt-1 text-xs"
                onClick={() => onChangeHistoryCompanyFilter("all")}
              >
                Clear company filter
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {unlinkedHistoryCount > 0 && (
              <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 rounded-lg text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  <strong>Notice:</strong> {unlinkedHistoryCount.toLocaleString()} saved records in
                  history are legacy logs without payable or client IDs. These historical records
                  cannot be auto-applied; newly analyzed reports carry verified database linkages.
                </span>
              </div>
            )}

            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search in history by Shareholder, BOID, Bank Account, or Batch..."
                  value={historySearchQuery}
                  onChange={(e) => onChangeHistorySearchQuery(e.target.value)}
                  className="pl-8 text-xs h-8"
                />
                {historySearchQuery && (
                  <button
                    onClick={() => onChangeHistorySearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {historyCompanies.length > 0 && (
                <Select value={historyCompanyFilter} onValueChange={onChangeHistoryCompanyFilter}>
                  <SelectTrigger className="w-52 h-8 text-xs">
                    <SelectValue placeholder="All Companies" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Companies ({groupedLots.length} lots)</SelectItem>
                    {historyCompanies.map((c) => (
                      <SelectItem key={c} value={c} className="text-xs">
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Select value={historySourceFilter} onValueChange={onChangeHistorySourceFilter}>
                <SelectTrigger className="w-48 h-8 text-xs">
                  <SelectValue placeholder="All Sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    All Settlement Types
                  </SelectItem>
                  <SelectItem value="connectips" className="text-xs">
                    ConnectIPS Payout Lots
                  </SelectItem>
                  <SelectItem value="bank_statement" className="text-xs">
                    Bank Statements
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              {filteredGroupedLots.map((lot) => {
                const isExpanded = expandedLotKey === lot.lotKey;
                const currentDetailTab = lotDetailTabs[lot.lotKey] || "all";

                const filteredLotRecords = lot.records.filter((r) => {
                  if (currentDetailTab === "matched" && r.result !== "Matched") return false;
                  if (currentDetailTab === "rejected" && r.result !== "Rejected") return false;
                  if (
                    currentDetailTab === "discrepancy" &&
                    (r.result === "Matched" || r.result === "Rejected")
                  )
                    return false;

                  if (!historySearchQuery) return true;
                  const q = historySearchQuery.toLowerCase();
                  return (
                    (r.client?.full_name && r.client.full_name.toLowerCase().includes(q)) ||
                    (r.client?.boid && r.client.boid.toLowerCase().includes(q)) ||
                    (r.client?.bank_account_no &&
                      r.client.bank_account_no.toLowerCase().includes(q)) ||
                    (r.notes && r.notes.toLowerCase().includes(q)) ||
                    lot.lotName.toLowerCase().includes(q)
                  );
                });

                if (
                  historySearchQuery &&
                  filteredLotRecords.length === 0 &&
                  currentDetailTab === "all"
                )
                  return null;

                return (
                  <div
                    key={lot.lotKey}
                    className="rounded-xl border bg-card text-card-foreground shadow-sm transition-all overflow-hidden"
                  >
                    <div className="p-4 bg-muted/20 border-b flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-[280px]">
                        <div className="p-2 rounded-lg bg-primary/10 text-primary mt-0.5">
                          <Layers className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm font-bold text-foreground">{lot.lotName}</h4>
                            <Badge
                              variant="outline"
                              className="text-[11px] font-semibold text-primary"
                            >
                              {lot.companyName}
                            </Badge>
                            {lot.fileName && (
                              <span className="inline-flex items-center text-[11px] text-muted-foreground font-mono bg-muted/60 px-2 py-0.5 rounded border">
                                <FileSpreadsheet className="w-3 h-3 mr-1 text-primary" />
                                {lot.fileName}
                              </span>
                            )}
                            <Badge variant="outline" className="text-[11px]">
                              {lot.date}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px] capitalize">
                              {lot.payableType}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs">
                            <span className="text-muted-foreground">
                              Total:{" "}
                              <strong className="text-foreground">
                                {lot.totalRecords} records
                              </strong>{" "}
                              (NPR{" "}
                              {lot.totalAmount.toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                              })}
                              )
                            </span>
                            <span className="text-green-600 dark:text-green-400 font-medium">
                              ✓ {lot.matchedCount} Matched (NPR{" "}
                              {lot.matchedAmount.toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                              })}
                              )
                            </span>
                            {lot.rejectedCount > 0 && (
                              <span className="text-red-600 dark:text-red-400 font-medium">
                                ✕ {lot.rejectedCount} Rejected (NPR{" "}
                                {lot.rejectedAmount.toLocaleString("en-IN", {
                                  minimumFractionDigits: 2,
                                })}
                                )
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant={isExpanded ? "secondary" : "default"}
                          size="sm"
                          className="h-8 text-xs cursor-pointer font-medium"
                          onClick={() => onToggleExpandLot(isExpanded ? null : lot.lotKey)}
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp className="w-3.5 h-3.5 mr-1.5" />
                              Hide Details
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3.5 h-3.5 mr-1.5" />
                              View Details ({lot.totalRecords})
                            </>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs cursor-pointer"
                          onClick={() => onExportLot(lot)}
                        >
                          <Download className="w-3.5 h-3.5 mr-1.5" />
                          Export CSV
                        </Button>
                        {isAdmin && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 cursor-pointer"
                            onClick={() => onRevertLot(lot)}
                            disabled={isApplying}
                            title="Revert payables and remove this lot (Admin Only)"
                          >
                            <RotateCcw className="w-3.5 h-3.5 mr-1" />
                            Revert
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs text-destructive hover:bg-destructive/10 cursor-pointer"
                            onClick={() => onDeleteLot(lot)}
                            title="Delete lot history (Admin Only)"
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            Delete
                          </Button>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="p-4 space-y-3 bg-background max-h-[600px] overflow-y-auto">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b">
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant={currentDetailTab === "all" ? "default" : "outline"}
                              className="h-7 text-xs px-2.5"
                              onClick={() => onChangeLotDetailTab(lot.lotKey, "all")}
                            >
                              All Records ({lot.totalRecords})
                            </Button>
                            <Button
                              size="sm"
                              variant={currentDetailTab === "matched" ? "default" : "outline"}
                              className="h-7 text-xs px-2.5 text-green-700 dark:text-green-400"
                              onClick={() => onChangeLotDetailTab(lot.lotKey, "matched")}
                            >
                              Matched ({lot.matchedCount})
                            </Button>
                            {lot.rejectedCount > 0 && (
                              <>
                                <Button
                                  size="sm"
                                  variant={
                                    currentDetailTab === "rejected" ? "destructive" : "outline"
                                  }
                                  className="h-7 text-xs px-2.5 text-red-600"
                                  onClick={() => onChangeLotDetailTab(lot.lotKey, "rejected")}
                                >
                                  Rejected / Bounced ({lot.rejectedCount})
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs px-2.5 text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800"
                                  onClick={() => onOpenRemediationForLot(lot.records)}
                                >
                                  <CreditCard className="w-3 h-3 mr-1 text-amber-600" />
                                  Remediate ({lot.rejectedCount})
                                </Button>
                              </>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            Showing {filteredLotRecords.length} records in this view
                          </span>
                        </div>

                        <div className="space-y-2 pt-1">
                          {filteredLotRecords.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-6">
                              No records found for the selected tab filter.
                            </p>
                          ) : (
                            filteredLotRecords.map((r, idx) => (
                              <div
                                key={r.id || idx}
                                className="rounded-lg border p-3 bg-muted/10 hover:bg-muted/30 transition-colors text-xs"
                              >
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                  <div className="flex-1 min-w-[200px]">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-bold text-sm text-foreground">
                                        {r.client?.full_name || "Shareholder"}
                                      </span>
                                      {r.client?.boid && (
                                        <span className="font-mono text-[11px] bg-muted px-2 py-0.5 rounded text-muted-foreground border">
                                          BOID: {r.client.boid}
                                        </span>
                                      )}
                                      <Badge
                                        variant={r.result === "Matched" ? "default" : "destructive"}
                                        className="text-[10px] h-4"
                                      >
                                        {r.result}
                                      </Badge>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-muted-foreground">
                                      {(r.client?.bank_name || r.client?.bank_account_no) && (
                                        <div className="flex items-center gap-1">
                                          <CreditCard className="w-3.5 h-3.5" />
                                          <span>
                                            {r.client.bank_name}{" "}
                                            {r.client.bank_account_no
                                              ? `(A/C: ${r.client.bank_account_no})`
                                              : ""}
                                          </span>
                                        </div>
                                      )}
                                      {r.notes && (
                                        <span className="text-[11px] text-muted-foreground/80">
                                          {r.notes}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-4 text-right">
                                    <div>
                                      <span className="text-[10px] text-muted-foreground block">
                                        {r.result === "Rejected" ? "Attempted Txn" : "Actual Paid"}
                                      </span>
                                      <span
                                        className={`font-mono font-bold text-sm ${r.result === "Rejected" ? "text-destructive line-through" : "text-foreground"}`}
                                      >
                                        NPR{" "}
                                        {(r.actual_amount || 0).toLocaleString("en-IN", {
                                          minimumFractionDigits: 2,
                                        })}
                                      </span>
                                      {r.result === "Rejected" && (
                                        <span className="text-[10px] text-destructive block font-semibold">
                                          NPR 0.00 (Bounced)
                                        </span>
                                      )}
                                    </div>
                                    <div>
                                      <span className="text-[10px] text-muted-foreground block">
                                        System Expected
                                      </span>
                                      <span className="font-mono text-muted-foreground">
                                        NPR{" "}
                                        {(r.expected_amount || 0).toLocaleString("en-IN", {
                                          minimumFractionDigits: 2,
                                        })}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
