import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { UploadService } from "@/lib/services/upload.service";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format, parseISO, isValid } from "date-fns";
import {
  Download,
  RotateCcw,
  Search,
  X,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  FileX2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  FileSpreadsheet,
  ClipboardList,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/upload-history")({
  component: UploadHistoryRoute,
});

// ── Constants ─────────────────────────────────────────────────────────────────
const PAGE_SIZE = 25;

const TARGET_TABLE_LABELS: Record<string, string> = {
  dividend_payables: "Dividend",
  interest_payables: "Interest",
  mutual_fund_payables: "Mutual Fund",
  clients: "Clients",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = parseISO(iso);
    return isValid(d) ? format(d, "dd MMM yyyy, HH:mm") : "—";
  } catch {
    return "—";
  }
}

function successRate(success: number, total: number): string {
  if (!total) return "—";
  const pct = Math.round((success / total) * 100);
  return `${pct}%`;
}

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { icon: React.ElementType; className: string; label: string }> = {
    Completed: {
      icon: CheckCircle2,
      className:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0",
      label: "Completed",
    },
    Processing: {
      icon: Loader2,
      className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0",
      label: "Processing",
    },
    Failed: {
      icon: AlertTriangle,
      className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0",
      label: "Failed",
    },
    RolledBack: {
      icon: RotateCcw,
      className: "bg-muted text-muted-foreground border",
      label: "Rolled Back",
    },
  };
  const cfg = configs[status] || { icon: Clock, className: "border", label: status };
  const Icon = cfg.icon;
  return (
    <Badge className={`gap-1 text-[10px] ${cfg.className}`}>
      <Icon className={`h-2.5 w-2.5 ${status === "Processing" ? "animate-spin" : ""}`} />
      {cfg.label}
    </Badge>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

function UploadHistoryRoute() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();

  // ── State ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  // ── Dialog states ─────────────────────────────────────────────────────────
  const [rollbackRecord, setRollbackRecord] = useState<any | null>(null);
  const [markFailedRecord, setMarkFailedRecord] = useState<any | null>(null);
  const [viewErrorsRecord, setViewErrorsRecord] = useState<any | null>(null);
  const [viewErrorsData, setViewErrorsData] = useState<any[]>([]);
  const [viewErrorsLoading, setViewErrorsLoading] = useState(false);

  const openErrorViewer = async (record: any) => {
    setViewErrorsRecord(record);
    setViewErrorsData([]);
    setViewErrorsLoading(true);
    try {
      const data = await UploadService.getUploadErrors(record.id);
      setViewErrorsData(data);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load error records.");
    } finally {
      setViewErrorsLoading(false);
    }
  };

  // ── Data ─────────────────────────────────────────────────────────────────
  const {
    data: history = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["upload-history"],
    queryFn: () => UploadService.getUploadHistory(500),
    refetchInterval: 15_000, // auto-refresh every 15s to catch "Processing" that completes
  });

  const handleRefresh = async () => {
    try {
      await qc.invalidateQueries({ queryKey: ["upload-history"] });
      const result = await refetch();
      if (result.error) {
        throw result.error;
      }
      toast.success("Upload history refreshed.");
    } catch (err: any) {
      toast.error(`Refresh failed: ${err?.message || "Unknown error"}`);
    }
  };

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let rows = history;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.file_name.toLowerCase().includes(q) || (r.sheet_name || "").toLowerCase().includes(q),
      );
    }
    if (statusFilter !== "all") {
      rows = rows.filter((r) => r.status === statusFilter);
    }
    if (typeFilter !== "all") {
      rows = rows.filter((r) => r.target_table === typeFilter);
    }
    if (dateFrom) {
      rows = rows.filter((r) => r.created_at >= `${dateFrom}T00:00:00`);
    }
    if (dateTo) {
      rows = rows.filter((r) => r.created_at <= `${dateTo}T23:59:59`);
    }
    return rows;
  }, [history, search, statusFilter, typeFilter, dateFrom, dateTo]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ── Summary stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = filtered.length;
    const completed = filtered.filter((r) => r.status === "Completed").length;
    const failed = filtered.filter((r) => r.status === "Failed").length;
    const processing = filtered.filter((r) => r.status === "Processing").length;
    const totalRows = filtered.reduce((s, r) => s + (r.success_rows || 0), 0);
    return { total, completed, failed, processing, totalRows };
  }, [filtered]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const rollbackMutation = useMutation({
    mutationFn: async (record: any) => {
      if (!isAdmin) throw new Error("Only administrators are authorized to roll back uploads.");
      // Determine target table — fall back to all payable tables if null
      const table = record.target_table;
      if (table) {
        await UploadService.rollbackUpload(record.id, table);
      } else {
        // Target table unknown — try all three payable tables and mark record
        const tables = ["dividend_payables", "interest_payables", "mutual_fund_payables"];
        for (const t of tables) {
          try {
            const { error } = await (supabase as any).from(t).delete().eq("upload_id", record.id);
            if (error) console.warn(`Rollback attempt on ${t}:`, error.message);
          } catch {
            /* silent */
          }
        }
        // Mark as RolledBack
        await (supabase as any)
          .from("upload_history")
          .update({ status: "RolledBack", completed_at: new Date().toISOString() })
          .eq("id", record.id);
      }
    },
    onSuccess: () => {
      toast.success("Upload rolled back — imported rows removed.");
      qc.invalidateQueries({ queryKey: ["upload-history"] });
      qc.invalidateQueries({ queryKey: ["company-fiscal-summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["interest_payables"] });
      qc.invalidateQueries({ queryKey: ["dividend_payables"] });
      qc.invalidateQueries({ queryKey: ["mutual_fund_payables"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      setRollbackRecord(null);
    },
    onError: (e: Error) => toast.error(`Rollback failed: ${e.message}`),
  });

  const markFailedMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!isAdmin) throw new Error("Only administrators are authorized to mark uploads as failed.");
      const { error } = await (supabase as any)
        .from("upload_history")
        .update({
          status: "Failed",
          completed_at: new Date().toISOString(),
          error_message: "Manually marked as failed by admin.",
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Record marked as Failed.");
      qc.invalidateQueries({ queryKey: ["upload-history"] });
      setMarkFailedRecord(null);
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setTypeFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };
  const hasActiveFilters =
    search || statusFilter !== "all" || typeFilter !== "all" || dateFrom || dateTo;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader
          title="Upload History"
          description="Track all file imports — view row counts, errors, and rollback completed uploads."
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          className="shrink-0 mt-1"
          disabled={isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          {isFetching ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {/* Summary stat row */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Total Uploads", value: stats.total, color: "" },
          { label: "Completed", value: stats.completed, color: "text-emerald-600" },
          { label: "Failed", value: stats.failed, color: "text-red-600" },
          {
            label: "Rows Imported",
            value: stats.totalRows.toLocaleString(),
            color: "text-primary",
          },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
              <p className={`text-xl font-bold tabular-nums mt-0.5 ${color}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search filename or sheet…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-8 h-8 text-sm"
              />
              {search && (
                <button
                  onClick={() => {
                    setSearch("");
                    setPage(1);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-36 h-8 text-sm">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="Completed">Completed</SelectItem>
                <SelectItem value="Failed">Failed</SelectItem>
                <SelectItem value="Processing">Processing</SelectItem>
                <SelectItem value="RolledBack">Rolled Back</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={typeFilter}
              onValueChange={(v) => {
                setTypeFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-36 h-8 text-sm">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="dividend_payables">Dividend</SelectItem>
                <SelectItem value="interest_payables">Interest</SelectItem>
                <SelectItem value="mutual_fund_payables">Mutual Fund</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                className="h-8 text-sm w-36"
                title="From date"
              />
              <span className="text-muted-foreground text-xs">to</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                className="h-8 text-sm w-36"
                title="To date"
              />
            </div>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
                <X className="h-3 w-3 mr-1" /> Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">File Name</TableHead>
                <TableHead>Sheet</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Total Rows</TableHead>
                <TableHead className="text-right">Success</TableHead>
                <TableHead className="text-right">Errors</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="pr-5 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <TableCell key={j}>
                        <div className="h-4 rounded bg-muted animate-pulse" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-16 text-center text-muted-foreground">
                    <FileX2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No upload records found.</p>
                    {hasActiveFilters && (
                      <button
                        onClick={clearFilters}
                        className="text-xs underline mt-1 text-muted-foreground hover:text-foreground"
                      >
                        Clear filters
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((record) => (
                  <TableRow key={record.id} className="group">
                    <TableCell className="pl-5">
                      <div className="flex items-center gap-2 max-w-[220px]">
                        <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate text-sm font-medium" title={record.file_name}>
                          {record.file_name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground font-mono">
                        {record.sheet_name || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {record.target_table ? (
                        <Badge variant="outline" className="text-[10px]">
                          {TARGET_TABLE_LABELS[record.target_table] || record.target_table}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {(record.total_rows || 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-semibold text-emerald-600">
                      {(record.success_rows || 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {record.error_rows > 0 ? (
                        <span className="font-semibold text-red-600">
                          {record.error_rows.toLocaleString()}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {successRate(record.success_rows || 0, record.total_rows || 0)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={record.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(record.created_at)}
                    </TableCell>
                    <TableCell className="pr-5">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {/* Download errors */}
                        {record.error_rows > 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-600 hover:bg-red-500/10"
                            title="View error records"
                            onClick={() => openErrorViewer(record)}
                          >
                            <ClipboardList className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {record.error_rows > 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            title="Download error report"
                            onClick={() =>
                              UploadService.downloadUploadErrors(record.id, record.file_name)
                            }
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {/* Rollback */}
                        {(record.status === "Completed" || record.status === "Failed") && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30"
                            title="Rollback this upload"
                            onClick={() => setRollbackRecord(record)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {/* Mark as Failed (for stuck Processing records) */}
                        {record.status === "Processing" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            title="Mark as Failed (stuck record)"
                            onClick={() => setMarkFailedRecord(record)}
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {pageCount > 1 && (
          <div className="flex items-center justify-between border-t px-5 py-3">
            <p className="text-xs text-muted-foreground">
              Page {page} of {pageCount} · {filtered.length} records
            </p>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Rollback Confirmation */}
      <AlertDialog
        open={!!rollbackRecord}
        onOpenChange={(open) => !open && setRollbackRecord(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-orange-600">
              <RotateCcw className="h-5 w-5" /> Rollback Upload?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm space-y-2 pt-1">
                <p>
                  This will permanently remove all{" "}
                  <strong>{(rollbackRecord?.success_rows || 0).toLocaleString()}</strong> rows
                  imported from <strong>{rollbackRecord?.file_name}</strong>.
                </p>
                {!rollbackRecord?.target_table && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                    <strong>Note:</strong> Target table is unknown — rollback will attempt all
                    payable tables (dividend, interest, mutual fund).
                  </div>
                )}
                <p className="text-destructive font-semibold text-xs">
                  This action cannot be undone.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollbackMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-orange-600 hover:bg-orange-700 text-white"
              disabled={rollbackMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                rollbackMutation.mutate(rollbackRecord);
              }}
            >
              {rollbackMutation.isPending ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Rolling back…
                </>
              ) : (
                "Yes, Rollback"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mark as Failed Confirmation (admin) */}
      <AlertDialog
        open={!!markFailedRecord}
        onOpenChange={(open) => !open && setMarkFailedRecord(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Mark as Failed?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm pt-1">
              This will manually mark the stuck <strong>Processing</strong> record for{" "}
              <strong>{markFailedRecord?.file_name}</strong> as Failed. Use this only when the
              import process crashed and the record is permanently stuck. No data will be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={markFailedMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                markFailedMutation.mutate(markFailedRecord?.id);
              }}
            >
              Mark as Failed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* View error records (persisted per-row failures) */}
      <Dialog
        open={!!viewErrorsRecord}
        onOpenChange={(open) => !open && setViewErrorsRecord(null)}
      >
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Error Records — {viewErrorsRecord?.file_name ?? ""}</DialogTitle>
            <DialogDescription>
              {viewErrorsData.length.toLocaleString()} failed record(s). Review the reason and raw
              row data, then correct and re-upload. Use “Download Excel” to export the full list.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-2 pb-2">
            <div className="text-xs text-muted-foreground">
              {viewErrorsLoading ? (
                <span className="inline-flex items-center gap-1">
                  <RefreshCw className="h-3 w-3 animate-spin" /> Loading…
                </span>
              ) : (
                <span>
                  {viewErrorsData.length.toLocaleString()} persisted record(s) ·{" "}
                  {viewErrorsRecord?.error_rows?.toLocaleString()} reported error(s)
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={viewErrorsData.length === 0}
              onClick={() =>
                viewErrorsRecord &&
                UploadService.downloadUploadErrors(viewErrorsRecord.id, viewErrorsRecord.file_name)
              }
            >
              <Download className="h-3.5 w-3.5 mr-1.5" /> Download Excel
            </Button>
          </div>

          <div className="flex-1 overflow-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Row</TableHead>
                  <TableHead className="w-28">Field</TableHead>
                  <TableHead className="w-32">Type</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Raw Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {viewErrorsData.length === 0 && !viewErrorsLoading && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      No persisted per-row error records found for this upload.
                    </TableCell>
                  </TableRow>
                )}
                {viewErrorsData.map((e: any, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="tabular-nums">{e.row_number ?? ""}</TableCell>
                    <TableCell className="font-mono text-xs">{e.field_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {e.error_type ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[260px] text-xs whitespace-pre-wrap break-words">
                      {e.error_message ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <details>
                        <summary className="text-xs cursor-pointer text-muted-foreground">
                          View data
                        </summary>
                        <pre className="mt-1 text-[10px] whitespace-pre-wrap break-words bg-muted/40 p-2 rounded">
                          {e.raw_data ? JSON.stringify(e.raw_data, null, 2) : "—"}
                        </pre>
                      </details>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
