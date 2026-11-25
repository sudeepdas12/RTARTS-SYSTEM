import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Badge } from "@/components/ui/badge";
import { ReportService, type ReportFilters } from "@/lib/services/report.service";
import { REPORT_COLUMNS, type ReportId } from "./reports-config";

export interface RegisterViewerDialogProps {
  reportId: ReportId | null;
  reportTitle: string;
  reportDescription: string;
  companyName: string;
  filters?: ReportFilters;
  companies?: { id: string; company_name: string; company_code: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fetchData?: (id: ReportId) => Promise<any[]>;
  onExport: (
    id: ReportId,
    kind: "xlsx" | "pdf",
    options?: { companyId?: string; search?: string },
  ) => void;
  isExporting: boolean;
  onSelectReport?: (id: ReportId) => void;
}

export function RegisterViewerDialog({
  reportId,
  reportTitle,
  reportDescription,
  companyName,
  filters,
  companies = [],
  open,
  onOpenChange,
  onExport,
  isExporting,
  onSelectReport,
}: RegisterViewerDialogProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [dialogCompanyId, setDialogCompanyId] = useState<string>(filters?.companyId || "all");

  const dialogCompanyResetKey = `${open}|${filters?.companyId ?? "all"}`;
  const [prevDialogCompanyResetKey, setPrevDialogCompanyResetKey] = useState(dialogCompanyResetKey);
  if (prevDialogCompanyResetKey !== dialogCompanyResetKey) {
    setPrevDialogCompanyResetKey(dialogCompanyResetKey);
    const nextCompanyId = filters?.companyId || "all";
    if (dialogCompanyId !== nextCompanyId) {
      setDialogCompanyId(nextCompanyId);
    }
  }

  const activeDialogFilters = useMemo(
    () => ({
      ...filters,
      companyId: dialogCompanyId === "all" ? undefined : dialogCompanyId,
    }),
    [filters, dialogCompanyId],
  );

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const pageResetKey = `${debouncedSearch}|${reportId ?? ""}|${pageSize}|${companyName}`;
  const [prevPageResetKey, setPrevPageResetKey] = useState(pageResetKey);
  if (prevPageResetKey !== pageResetKey) {
    setPrevPageResetKey(pageResetKey);
    if (page !== 1) {
      setPage(1);
    }
  }

  const {
    data: pageData,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: [
      "view-register-page-data",
      reportId,
      dialogCompanyId,
      activeDialogFilters,
      page,
      pageSize,
      debouncedSearch,
    ],
    queryFn: () =>
      reportId
        ? ReportService.getRegisterPage(
            reportId,
            activeDialogFilters,
            page,
            pageSize,
            debouncedSearch,
          )
        : Promise.resolve({ rows: [], totalCount: 0 }),
    enabled: open && !!reportId,
    staleTime: 30 * 1000,
  });

  const { data: serverTotals } = useQuery({
    queryKey: ["report-grand-totals", reportId, activeDialogFilters],
    queryFn: () =>
      reportId
        ? ReportService.getReportGrandTotals(reportId, activeDialogFilters)
        : Promise.resolve(null),
    enabled: open && !!reportId,
    staleTime: 60 * 1000,
  });

  const columns = reportId ? REPORT_COLUMNS[reportId] || [] : [];
  const rows = pageData?.rows ?? [];
  const totalCount = pageData?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const renderCell = (row: any, dataKey: string) => {
    const val = row[dataKey];
    if (val === null || val === undefined || val === "")
      return <span className="text-muted-foreground/40">—</span>;

    if (dataKey === "payment_status" || dataKey === "status") {
      const s = String(val).toUpperCase();
      const isGood =
        s.includes("PAID") ||
        s.includes("ACSC") ||
        s.includes("COMPLETED") ||
        s.includes("SUCCESS") ||
        s.includes("MATCH");
      const isBad =
        s.includes("REJECT") ||
        s.includes("RJCT") ||
        s.includes("FAIL") ||
        s.includes("DISCREPANCY") ||
        s.includes("REVERS");
      return (
        <Badge
          variant="outline"
          className={`text-[10px] uppercase font-mono tracking-wider ${
            isGood
              ? "text-emerald-700 bg-emerald-50 border-emerald-300 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800"
              : isBad
                ? "text-rose-700 bg-rose-50 border-rose-300 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800"
                : "text-amber-700 bg-amber-50 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800"
          }`}
        >
          {String(val)}
        </Badge>
      );
    }

    if (
      [
        "boid",
        "bank_account_no",
        "pan_or_citizenship",
        "batch_name",
        "file_name",
        "instrument_ref",
      ].includes(dataKey)
    ) {
      return <span className="font-mono text-xs">{String(val)}</span>;
    }

    if (
      [
        "gross_dividend",
        "gross_interest",
        "gross_amount",
        "tax_amount",
        "net_payable",
        "paid_amount",
        "remaining_amount",
        "total_amount",
        "system_amount",
        "excel_amount",
        "difference",
      ].includes(dataKey)
    ) {
      const nr = Number(val);
      const isPaidCol = dataKey === "paid_amount";
      const isRemCol = dataKey === "remaining_amount";
      return (
        <span
          className={`font-mono text-xs tabular-nums text-right block font-medium ${
            isPaidCol
              ? "text-emerald-600 font-bold"
              : isRemCol
                ? nr > 0
                  ? "text-rose-600 font-bold"
                  : "text-muted-foreground"
                : ""
          }`}
        >
          {Number.isNaN(nr)
            ? String(val)
            : nr.toLocaleString("en-IN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
        </span>
      );
    }

    if (["shares_held", "total_payments", "rows_processed", "rows_failed"].includes(dataKey)) {
      const nr = Number(val);
      return (
        <span className="font-mono text-xs tabular-nums text-right block">
          {Number.isNaN(nr) ? String(val) : nr.toLocaleString("en-IN")}
        </span>
      );
    }

    return <span className="text-xs">{String(val)}</span>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b bg-muted/30 shrink-0">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-lg font-bold flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  {reportTitle}
                </DialogTitle>
                <Badge variant="secondary" className="text-xs font-normal">
                  {companyName}
                </Badge>
                {serverTotals && serverTotals.total_records > 0 && (
                  <Badge
                    variant="outline"
                    className="text-emerald-700 bg-emerald-50 border-emerald-300 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800 text-[11px] font-mono flex items-center gap-1"
                  >
                    <ShieldCheck className="h-3 w-3" />
                    Server Verified: {serverTotals.total_records.toLocaleString()} records
                  </Badge>
                )}
              </div>
              <DialogDescription className="text-xs text-muted-foreground">
                {reportDescription}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={isExporting || isLoading || totalCount === 0}
                onClick={() =>
                  reportId &&
                  onExport(reportId, "xlsx", {
                    companyId: dialogCompanyId,
                    search: debouncedSearch,
                  })
                }
              >
                <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={isExporting || isLoading || totalCount === 0}
                onClick={() =>
                  reportId &&
                  onExport(reportId, "pdf", { companyId: dialogCompanyId, search: debouncedSearch })
                }
              >
                <FileText className="mr-1.5 h-3.5 w-3.5 text-rose-600" />
                PDF
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => refetch()}
                title="Refresh Register"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {!isLoading && (totalCount > 0 || (serverTotals && serverTotals.total_records > 0)) && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 pt-3">
              <div className="px-3 py-1.5 bg-background/80 border rounded text-xs flex justify-between items-center">
                <span className="text-muted-foreground font-medium">
                  {debouncedSearch ? "Filtered / Total:" : "Records:"}
                </span>
                <span className="font-bold font-mono">
                  {debouncedSearch
                    ? `${totalCount.toLocaleString()} / ${(serverTotals?.total_records ?? totalCount).toLocaleString()}`
                    : (serverTotals?.total_records ?? totalCount).toLocaleString()}
                </span>
              </div>
              {(serverTotals?.total_gross ?? 0) > 0 && (
                <div className="px-3 py-1.5 bg-background/80 border rounded text-xs flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">Gross:</span>
                  <span className="font-bold font-mono text-primary">
                    NPR{" "}
                    {(serverTotals?.total_gross ?? 0).toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}
              {(serverTotals?.total_tax ?? 0) > 0 && (
                <div className="px-3 py-1.5 bg-background/80 border rounded text-xs flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">Tax:</span>
                  <span className="font-bold font-mono text-amber-600">
                    NPR{" "}
                    {(serverTotals?.total_tax ?? 0).toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}
              {(serverTotals?.total_net ?? 0) > 0 && (
                <div className="px-3 py-1.5 bg-background/80 border rounded text-xs flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">Net:</span>
                  <span className="font-bold font-mono text-foreground">
                    NPR{" "}
                    {(serverTotals?.total_net ?? 0).toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}
              {(serverTotals?.total_disbursed ?? 0) > 0 && (
                <div className="px-3 py-1.5 bg-background/80 border rounded text-xs flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">Disbursed:</span>
                  <span className="font-bold font-mono text-emerald-600">
                    NPR{" "}
                    {(serverTotals?.total_disbursed ?? 0).toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}
              {(serverTotals?.total_remaining ?? 0) > 0 && (
                <div className="px-3 py-1.5 bg-background/80 border rounded text-xs flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">Due:</span>
                  <span className="font-bold font-mono text-rose-600">
                    NPR{" "}
                    {(serverTotals?.total_remaining ?? 0).toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="p-3 border-b bg-background/50 flex flex-col sm:flex-row items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto flex-1">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search shareholder, BOID, PAN, account…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
            {companies && companies.length > 0 && (
              <Select
                value={dialogCompanyId}
                onValueChange={(val) => {
                  setDialogCompanyId(val);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-52 text-xs bg-background shrink-0">
                  <Building2 className="h-3.5 w-3.5 mr-1.5 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="All Companies / Schemes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Schemes / Companies</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.company_name} ({c.company_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground w-full sm:w-auto justify-end">
            <span>Show:</span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="h-8 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="15">15</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
            <span>per page</span>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-0 min-h-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-9 w-full rounded" />
              ))}
            </div>
          ) : isError ? (
            <div className="p-12 text-center text-sm text-destructive space-y-2">
              <p>Failed to load register records.</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-sm space-y-3">
              {debouncedSearch ? (
                <p className="text-muted-foreground">
                  No matching records found for "{debouncedSearch}".
                </p>
              ) : reportId === "dividend_register" ? (
                <div className="max-w-md mx-auto p-4 bg-muted/40 border rounded-lg space-y-2 text-left">
                  <p className="font-semibold text-foreground text-sm flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    No Equity Dividend Records Found
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    The Equity Dividend Register manages corporate stock dividends. If your uploaded
                    files are Mutual Funds (such as RMF1 or RMF2), those unit-holder payouts are
                    available in the <strong>Mutual Fund Register</strong>.
                  </p>
                  {onSelectReport && (
                    <Button
                      size="sm"
                      className="mt-2 text-xs"
                      onClick={() => onSelectReport("mutual_fund_register")}
                    >
                      Open Mutual Fund Register
                    </Button>
                  )}
                </div>
              ) : reportId === "interest_register" ? (
                <div className="max-w-md mx-auto p-4 bg-muted/40 border rounded-lg space-y-2 text-left">
                  <p className="font-semibold text-foreground text-sm flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    No Debenture Interest Records Found
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    The Debenture Register tracks corporate bonds and coupon schedules. For mutual
                    fund unitholder payouts, please switch to the{" "}
                    <strong>Mutual Fund Register</strong>.
                  </p>
                  {onSelectReport && (
                    <Button
                      size="sm"
                      className="mt-2 text-xs"
                      onClick={() => onSelectReport("mutual_fund_register")}
                    >
                      Open Mutual Fund Register
                    </Button>
                  )}
                </div>
              ) : reportId === "payment_register" ? (
                <div className="max-w-md mx-auto p-4 bg-muted/40 border rounded-lg space-y-2 text-left">
                  <p className="font-semibold text-foreground text-sm flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    No Payment Batches Generated
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Disbursement payment batches are created in the Payments module during
                    ConnectIPS / bank transfer batching.
                  </p>
                </div>
              ) : reportId === "reconciliation_report" ? (
                <div className="max-w-md mx-auto p-4 bg-muted/40 border rounded-lg space-y-2 text-left">
                  <p className="font-semibold text-foreground text-sm flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    No Reconciliation Matches Recorded
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Bank statement settlement records are generated in the Bank Reconciliation
                    module upon uploading bank statements.
                  </p>
                </div>
              ) : (
                <p className="text-muted-foreground">No records found in this register.</p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur z-10 border-b">
                <TableRow className="divide-x divide-border">
                  <TableHead className="w-12 text-center text-[11px] uppercase">#</TableHead>
                  {columns.map((col) => (
                    <TableHead
                      key={col.dataKey}
                      className={`text-[11px] uppercase whitespace-nowrap px-3 ${
                        col.header.includes("NPR") ||
                        col.header.includes("Gross") ||
                        col.header.includes("Tax") ||
                        col.header.includes("Net") ||
                        col.header.includes("Rate") ||
                        col.header.includes("Shares") ||
                        col.header.includes("Payments") ||
                        col.header.includes("Processed") ||
                        col.header.includes("Failed")
                          ? "text-right"
                          : ""
                      }`}
                    >
                      {col.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border">
                {rows.map((row: any, idx) => (
                  <TableRow
                    key={row.id || idx}
                    className="hover:bg-muted/40 divide-x divide-border"
                  >
                    <TableCell className="text-center font-mono text-xs text-muted-foreground">
                      {(page - 1) * pageSize + idx + 1}
                    </TableCell>
                    {columns.map((col) => (
                      <TableCell key={col.dataKey} className="px-3 py-2 whitespace-nowrap">
                        {renderCell(row, col.dataKey)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="p-3 border-t bg-muted/20 shrink-0 flex items-center justify-between text-xs text-muted-foreground">
          <div>
            Showing{" "}
            <span className="font-semibold text-foreground">
              {totalCount === 0 ? 0 : (page - 1) * pageSize + 1}
            </span>{" "}
            to{" "}
            <span className="font-semibold text-foreground">
              {Math.min(page * pageSize, totalCount)}
            </span>{" "}
            of <span className="font-semibold text-foreground">{totalCount.toLocaleString()}</span>{" "}
            records
            {serverTotals && serverTotals.total_records > 0 && (
              <span className="ml-2 text-muted-foreground">
                (PostgreSQL Server Grand Total:{" "}
                <span className="font-medium text-foreground">
                  {serverTotals.total_records.toLocaleString()}
                </span>{" "}
                records, NPR{" "}
                <span className="font-medium text-foreground">
                  {serverTotals.total_net.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>{" "}
                Net)
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page <= 1}
              onClick={() => setPage(1)}
              title="First Page"
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              title="Previous Page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-2 font-medium">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              title="Next Page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page >= totalPages}
              onClick={() => setPage(totalPages)}
              title="Last Page"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
