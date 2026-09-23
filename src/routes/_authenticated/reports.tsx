import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Building2,
  Download,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  Users,
  Wallet,
  Coins,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Layers,
  ArrowUpRight,
  Sparkles,
  Eye,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase, fetchAllRows } from "@/lib/services/database";
import {
  SummaryReportService,
  type MutualFundSummaryRow,
} from "@/lib/services/summary-report.service";
import { ReportService, type ReportFilters } from "@/lib/services/report.service";
import { ExcelExporter } from "@/lib/excel-exporter";
import { PdfGenerator } from "@/lib/pdf-generator";
import { getPayeeCategoryLabel } from "@/lib/services/payable-summary";
import { AgmDividendSummaryReportService } from "@/lib/services/dividend-summary-report.service";
import { DebentureSummaryReportService } from "@/lib/services/debenture-summary-report.service";
import { IrdEtdsService } from "@/lib/services/ird-etds.service";
import { IpfService } from "@/lib/services/ipf.service";
import {
  loadTaxRules,
  getDebentureDisplayRates,
  getDividendDisplayRates,
} from "@/lib/services/tax-rules.service";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reports")({ component: ReportsRoute });

type ReportId =
  | "dividend_register"
  | "interest_register"
  | "mutual_fund_register"
  | "tax_register"
  | "pending_register"
  | "payment_register"
  | "reconciliation_report"
  | "upload_history_report";

const PAYABLE_REPORTS: Array<{ id: ReportId; title: string; description: string }> = [
  {
    id: "dividend_register",
    title: "Dividend Register",
    description:
      "Cash, stock, bonus, and right-share transactions with BOID & bank account details.",
  },
  {
    id: "interest_register",
    title: "Interest Register",
    description: "Debenture coupon interest dues, TDS deductions, and payment statuses.",
  },
  {
    id: "mutual_fund_register",
    title: "Mutual Fund Register",
    description: "Unit-holder distribution records, bank accounts, and payment statuses.",
  },
  {
    id: "tax_register",
    title: "Tax (TDS) Register",
    description: "Payable-level TDS breakdowns with payee PAN, gross, rate %, and tax withheld.",
  },
  {
    id: "pending_register",
    title: "Pending Payables",
    description: "Outstanding amounts across instruments awaiting payment or approval.",
  },
];

const OPERATIONS_REPORTS: Array<{ id: ReportId; title: string; description: string }> = [
  {
    id: "payment_register",
    title: "Payment Batches",
    description: "Batch payout processing, authorization status, and disbursement totals.",
  },
  {
    id: "reconciliation_report",
    title: "Reconciliation Results",
    description: "Bank settlement matches, discrepancy logs, and variance analysis.",
  },
  {
    id: "upload_history_report",
    title: "Upload History",
    description: "Import logs, validation diagnostics, and processed vs failed counts.",
  },
];

const REPORT_COLUMNS: Record<ReportId, Array<{ header: string; dataKey: string }>> = {
  dividend_register: [
    { header: "BOID", dataKey: "boid" },
    { header: "Payee", dataKey: "full_name" },
    { header: "Company", dataKey: "company_name" },
    { header: "Shares / Kitta", dataKey: "shares_held" },
    { header: "Bank Name", dataKey: "bank_name" },
    { header: "Bank Account", dataKey: "bank_account_no" },
    { header: "Gross (NPR)", dataKey: "gross_dividend" },
    { header: "Tax (NPR)", dataKey: "tax_amount" },
    { header: "Net (NPR)", dataKey: "net_payable" },
    { header: "Paid (NPR)", dataKey: "paid_amount" },
    { header: "Remaining (NPR)", dataKey: "remaining_amount" },
    { header: "Status", dataKey: "payment_status" },
  ],
  interest_register: [
    { header: "BOID", dataKey: "boid" },
    { header: "Payee", dataKey: "full_name" },
    { header: "Company", dataKey: "company_name" },
    { header: "Instrument", dataKey: "instrument_ref" },
    { header: "Bank Name", dataKey: "bank_name" },
    { header: "Bank Account", dataKey: "bank_account_no" },
    { header: "Gross (NPR)", dataKey: "gross_interest" },
    { header: "Tax (NPR)", dataKey: "tax_amount" },
    { header: "Net (NPR)", dataKey: "net_payable" },
    { header: "Paid (NPR)", dataKey: "paid_amount" },
    { header: "Remaining (NPR)", dataKey: "remaining_amount" },
    { header: "Status", dataKey: "payment_status" },
  ],
  mutual_fund_register: [
    { header: "BOID", dataKey: "boid" },
    { header: "Payee", dataKey: "full_name" },
    { header: "Company", dataKey: "company_name" },
    { header: "Units / Kitta", dataKey: "shares_held" },
    { header: "Bank Name", dataKey: "bank_name" },
    { header: "Bank Account", dataKey: "bank_account_no" },
    { header: "Gross (NPR)", dataKey: "gross_dividend" },
    { header: "Tax (NPR)", dataKey: "tax_amount" },
    { header: "Net (NPR)", dataKey: "net_payable" },
    { header: "Paid (NPR)", dataKey: "paid_amount" },
    { header: "Remaining (NPR)", dataKey: "remaining_amount" },
    { header: "Status", dataKey: "payment_status" },
  ],
  tax_register: [
    { header: "BOID", dataKey: "boid" },
    { header: "Payee", dataKey: "full_name" },
    { header: "PAN / Ctz", dataKey: "pan_or_citizenship" },
    { header: "Company", dataKey: "company_name" },
    { header: "Type", dataKey: "payable_type" },
    { header: "Gross (NPR)", dataKey: "gross_amount" },
    { header: "Rate %", dataKey: "tds_rate" },
    { header: "Tax (NPR)", dataKey: "tax_amount" },
    { header: "Net (NPR)", dataKey: "net_payable" },
  ],
  pending_register: [
    { header: "BOID", dataKey: "boid" },
    { header: "Payee", dataKey: "full_name" },
    { header: "Company", dataKey: "company_name" },
    { header: "Type", dataKey: "payable_type" },
    { header: "Bank Name", dataKey: "bank_name" },
    { header: "Bank Account", dataKey: "bank_account_no" },
    { header: "Gross (NPR)", dataKey: "gross_amount" },
    { header: "Tax (NPR)", dataKey: "tax_amount" },
    { header: "Net (NPR)", dataKey: "net_payable" },
  ],
  payment_register: [
    { header: "Batch Name", dataKey: "batch_name" },
    { header: "Method", dataKey: "payment_method" },
    { header: "Payments", dataKey: "total_payments" },
    { header: "Amount (NPR)", dataKey: "total_amount" },
    { header: "Fiscal Year", dataKey: "fiscal_year" },
    { header: "Status", dataKey: "status" },
  ],
  reconciliation_report: [
    { header: "Shareholder", dataKey: "shareholder_name" },
    { header: "Category", dataKey: "category" },
    { header: "Expected (NPR)", dataKey: "system_amount" },
    { header: "Actual (NPR)", dataKey: "excel_amount" },
    { header: "Difference", dataKey: "difference" },
    { header: "Status", dataKey: "status" },
  ],
  upload_history_report: [
    { header: "File Name", dataKey: "file_name" },
    { header: "Type", dataKey: "file_type" },
    { header: "Processed", dataKey: "rows_processed" },
    { header: "Failed", dataKey: "rows_failed" },
    { header: "Status", dataKey: "status" },
    { header: "Uploaded At", dataKey: "created_at" },
  ],
};

interface RegisterViewerDialogProps {
  reportId: ReportId | null;
  reportTitle: string;
  reportDescription: string;
  companyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fetchData: (id: ReportId) => Promise<any[]>;
  onExport: (id: ReportId, kind: "xlsx" | "pdf") => void;
  isExporting: boolean;
}

function RegisterViewerDialog({
  reportId,
  reportTitle,
  reportDescription,
  companyName,
  open,
  onOpenChange,
  fetchData,
  onExport,
  isExporting,
}: RegisterViewerDialogProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const {
    data = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["view-register-dialog-data", reportId, companyName],
    queryFn: () => (reportId ? fetchData(reportId) : Promise.resolve([])),
    enabled: open && !!reportId,
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    setPage(1);
  }, [search, reportId, pageSize]);

  const columns = reportId ? REPORT_COLUMNS[reportId] || [] : [];

  const filteredRows = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase().trim();
    return data.filter((row: any) =>
      Object.values(row).some((val) => val != null && String(val).toLowerCase().includes(q)),
    );
  }, [data, search]);

  const stats = useMemo(() => {
    let gross = 0;
    let tax = 0;
    let net = 0;
    let paid = 0;
    let remaining = 0;
    for (const r of filteredRows as any[]) {
      gross += Number(
        r.gross_dividend ||
          r.gross_interest ||
          r.gross_amount ||
          r.total_amount ||
          r.system_amount ||
          0,
      );
      tax += Number(r.tax_amount || 0);
      const netVal = Number(r.net_payable || r.total_amount || r.excel_amount || 0);
      net += netVal;
      paid += Number(
        r.paid_amount != null ? r.paid_amount : r.payment_status === "Paid" ? netVal : 0,
      );
      remaining += Number(
        r.remaining_amount != null
          ? r.remaining_amount
          : r.payment_status === "Paid"
            ? 0
            : Math.max(0, netVal - Number(r.paid_amount || 0)),
      );
    }
    return { count: filteredRows.length, gross, tax, net, paid, remaining };
  }, [filteredRows]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  const renderCell = (row: any, dataKey: string) => {
    const val = row[dataKey];
    if (val === null || val === undefined || val === "")
      return <span className="text-muted-foreground/40">—</span>;

    // Status badges
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

    // Monospace text codes
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

    // Monetary amounts (INR/NPR commas, 2 decimals, right aligned)
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

    // Quantity / counts
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
                disabled={isExporting || isLoading || !data.length}
                onClick={() => reportId && onExport(reportId, "xlsx")}
              >
                <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={isExporting || isLoading || !data.length}
                onClick={() => reportId && onExport(reportId, "pdf")}
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

          {/* Quick Stats Summary Strip */}
          {!isLoading && data.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 pt-3">
              <div className="px-3 py-1.5 bg-background/80 border rounded text-xs flex justify-between items-center">
                <span className="text-muted-foreground font-medium">Records:</span>
                <span className="font-bold font-mono">{stats.count.toLocaleString()}</span>
              </div>
              {stats.gross > 0 && (
                <div className="px-3 py-1.5 bg-background/80 border rounded text-xs flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">Gross:</span>
                  <span className="font-bold font-mono text-primary">
                    NPR{" "}
                    {stats.gross.toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}
              {stats.tax > 0 && (
                <div className="px-3 py-1.5 bg-background/80 border rounded text-xs flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">Tax:</span>
                  <span className="font-bold font-mono text-amber-600">
                    NPR{" "}
                    {stats.tax.toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}
              {stats.net > 0 && (
                <div className="px-3 py-1.5 bg-background/80 border rounded text-xs flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">Net:</span>
                  <span className="font-bold font-mono text-foreground">
                    NPR{" "}
                    {stats.net.toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}
              {stats.paid > 0 && (
                <div className="px-3 py-1.5 bg-background/80 border rounded text-xs flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">Disbursed:</span>
                  <span className="font-bold font-mono text-emerald-600">
                    NPR{" "}
                    {stats.paid.toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}
              {stats.remaining > 0 && (
                <div className="px-3 py-1.5 bg-background/80 border rounded text-xs flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">Due:</span>
                  <span className="font-bold font-mono text-rose-600">
                    NPR{" "}
                    {stats.remaining.toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}
            </div>
          )}
        </DialogHeader>

        {/* Toolbar: Search + PageSize Selector */}
        <div className="p-3 border-b bg-background/50 flex flex-col sm:flex-row items-center justify-between gap-2 shrink-0">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search across all fields..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
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

        {/* Live Data Grid */}
        <div className="flex-1 overflow-auto p-0 min-h-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-9 w-full rounded" />
              ))}
            </div>
          ) : isError ? (
            <div className="p-12 text-center text-sm text-destructive">
              Failed to load register records. Please try again.
            </div>
          ) : paginatedRows.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              {search
                ? "No matching records found for your search."
                : "No records found in this register."}
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
                {paginatedRows.map((row: any, idx) => (
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

        {/* Pagination Footer */}
        <div className="p-3 border-t bg-muted/20 shrink-0 flex items-center justify-between text-xs text-muted-foreground">
          <div>
            Showing{" "}
            <span className="font-semibold text-foreground">
              {filteredRows.length === 0 ? 0 : (page - 1) * pageSize + 1}
            </span>{" "}
            to{" "}
            <span className="font-semibold text-foreground">
              {Math.min(page * pageSize, filteredRows.length)}
            </span>{" "}
            of{" "}
            <span className="font-semibold text-foreground">
              {filteredRows.length.toLocaleString()}
            </span>{" "}
            records
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

function ReportsRoute() {
  const [companyId, setCompanyId] = useState("all");
  const [activeExport, setActiveExport] = useState<string | null>(null);
  const [viewingReport, setViewingReport] = useState<ReportId | null>(null);

  const { data: companies = [] } = useQuery({
    queryKey: ["report-companies"],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, company_name, company_code")
        .order("company_name");
      if (error) throw error;
      return data || [];
    },
  });

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === companyId),
    [companies, companyId],
  );

  const { data: taxRules } = useQuery({
    queryKey: ["tax-rules"],
    queryFn: () => loadTaxRules(),
    staleTime: 60_000,
  });

  const debDisplayRates = useMemo(() => getDebentureDisplayRates(taxRules), [taxRules]);
  const filters: ReportFilters = useMemo(
    () => ({ companyId: companyId === "all" ? undefined : companyId }),
    [companyId],
  );

  // 1. Consolidated Summary
  const summary = useQuery({
    queryKey: ["live-payable-summary", companyId],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: () => SummaryReportService.getCompanySummary(filters),
  });
  const rows = useMemo(() => summary.data || [], [summary.data]);
  const totals = useMemo(
    () =>
      rows.reduce(
        (a, row) => ({
          companies: a.companies + 1,
          count: a.count + row.total_count,
          gross: a.gross + row.total_gross,
          tax: a.tax + row.total_tax,
          net: a.net + row.total_net,
        }),
        { companies: 0, count: 0, gross: 0, tax: 0, net: 0 },
      ),
    [rows],
  );

  // 2. AGM Dividend Summary
  const agmSummaryQuery = useQuery({
    queryKey: ["agm-dividend-summary-report", companyId],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: () =>
      AgmDividendSummaryReportService.getCompanySummary(
        companyId === "all" ? undefined : companyId,
      ),
  });
  const agmSummary = agmSummaryQuery.data;

  // 3. Debenture Summary
  const debentureSummaryQuery = useQuery({
    queryKey: ["debenture-interest-summary-report", companyId, taxRules],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const data = await fetchAllRows<any>((from, to) => {
        let q = (supabase as any)
          .from("interest_payables")
          .select(
            "id, company_id, shares_held, gross_interest, tax_amount, net_payable, payee_classification, payee_segment, instrument_ref, lot_name, due_date, fiscal_year, tds_rate, interest_rate_value, days_count, company:companies(id, company_name, company_code)",
          )
          .range(from, to);
        if (companyId && companyId !== "all") {
          q = q.eq("company_id", companyId);
        }
        return q;
      });
      return DebentureSummaryReportService.generateReportFromPayables(
        data || [],
        selectedCompany?.company_name ||
          (companyId === "all" ? "All Debentures" : "Selected Company"),
        selectedCompany?.company_code || "",
        "",
        undefined,
        1000,
        undefined,
        taxRules,
      );
    },
  });
  const debentureSummary = debentureSummaryQuery.data;

  // 4. Mutual Fund Summary
  const mfSummaryQuery = useQuery({
    queryKey: ["mutual-fund-summary-report", companyId],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: () => SummaryReportService.getMutualFundSummary({ companyId }),
  });
  const mfSummary = useMemo(() => mfSummaryQuery.data || [], [mfSummaryQuery.data]);
  const mfTotal = useMemo(
    () =>
      mfSummary.reduce(
        (acc, r) => ({
          transaction_count: acc.transaction_count + r.transaction_count,
          kitta: acc.kitta + r.kitta,
          gross: acc.gross + r.gross,
          tax: acc.tax + r.tax,
          net: acc.net + r.net,
        }),
        { transaction_count: 0, kitta: 0, gross: 0, tax: 0, net: 0 },
      ),
    [mfSummary],
  );

  const hasAgmData = Boolean(agmSummary && agmSummary.rows && agmSummary.rows.length > 0);
  const hasDebentureData = Boolean(
    debentureSummary && debentureSummary.rows && debentureSummary.rows.length > 0,
  );
  const hasMfData = Boolean(mfSummary && mfSummary.length > 0);
  const isSummariesLoading =
    agmSummaryQuery.isLoading || debentureSummaryQuery.isLoading || mfSummaryQuery.isLoading;
  const hasAnySummaryData = hasAgmData || hasDebentureData || hasMfData;

  // 5. IRD Annex-10 e-TDS Query
  const irdEtdsQuery = useQuery({
    queryKey: ["ird-annex-10-report", companyId],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: () =>
      IrdEtdsService.getAnnex10Report({
        companyId: companyId === "all" ? undefined : companyId,
      }),
    enabled: companies.length > 0,
  });
  const irdEtds = irdEtdsQuery.data;

  // 6. SEBON IPF Aging Query
  const ipfAgingQuery = useQuery({
    queryKey: ["sebon-ipf-aging-report", companyId],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: () =>
      IpfService.getIpfAgingReport({
        companyId: companyId === "all" ? undefined : companyId,
      }),
  });
  const ipfReport = ipfAgingQuery.data;

  const format = (value: number) =>
    `NPR ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtNr = (value: number) =>
    Number(value || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const fetchReport = (id: ReportId) =>
    ({
      dividend_register: ReportService.getDividendRegister,
      interest_register: ReportService.getInterestRegister,
      mutual_fund_register: ReportService.getMutualFundRegister,
      tax_register: ReportService.getTaxRegister,
      pending_register: ReportService.getPendingPayments,
      payment_register: ReportService.getPaymentRegister,
      reconciliation_report: ReportService.getReconciliationReport,
      upload_history_report: ReportService.getUploadHistoryReport,
    })[id](filters);

  const exportReport = async (id: ReportId, kind: "xlsx" | "pdf") => {
    const title = [...PAYABLE_REPORTS, ...OPERATIONS_REPORTS].find((r) => r.id === id)?.title || id;
    setActiveExport(`${id}-${kind}`);
    const toastId = toast.loading(`Fetching data for ${title}...`);
    try {
      const data = await fetchReport(id);
      if (!data || !data.length) {
        toast.dismiss(toastId);
        toast.info(
          companyId !== "all"
            ? "No records found matching the selected company."
            : "No records currently found in the system for this register.",
        );
        return;
      }
      if (kind === "xlsx") {
        ExcelExporter.exportToExcel(data as any[], title);
        toast.dismiss(toastId);
        toast.success(`${data.length.toLocaleString()} record(s) exported to Excel successfully.`);
      } else {
        const MAX_PDF_ROWS = 3000;
        const exportData = data.length > MAX_PDF_ROWS ? data.slice(0, MAX_PDF_ROWS) : data;

        PdfGenerator.generate(
          {
            title,
            subtitle:
              data.length > MAX_PDF_ROWS
                ? `(Displaying first ${MAX_PDF_ROWS.toLocaleString()} of ${data.length.toLocaleString()} records — for complete register, use Excel)`
                : undefined,
            companyName: selectedCompany?.company_name || "RTARTS System",
            generatedBy: "System",
          },
          REPORT_COLUMNS[id] || [],
          exportData as unknown as Record<string, unknown>[],
        );
        toast.dismiss(toastId);
        if (data.length > MAX_PDF_ROWS) {
          toast.warning(
            `PDF generated for first ${MAX_PDF_ROWS.toLocaleString()} records. For complete export (${data.length.toLocaleString()} rows), please download Excel.`,
          );
        } else {
          toast.success(`${data.length.toLocaleString()} record(s) exported to PDF successfully.`);
        }
      }
    } catch (error) {
      toast.dismiss(toastId);
      console.error(error);
      toast.error("This report could not be exported from live data.");
    } finally {
      setActiveExport(null);
    }
  };

  const handleRefreshAll = async () => {
    const results = await Promise.allSettled([
      summary.refetch(),
      agmSummaryQuery.refetch(),
      debentureSummaryQuery.refetch(),
      mfSummaryQuery.refetch(),
      irdEtdsQuery.refetch(),
      ipfAgingQuery.refetch(),
    ]);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      toast.error(`${failed.length} report(s) could not be refreshed.`);
    } else {
      toast.success("All summaries refreshed with latest data.");
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Reports & Distribution Summaries"
        description="Comprehensive AGM distributions, debenture interest summaries, mutual fund returns, and official registers."
      />

      {/* Top Filter Bar */}
      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-background to-background">
        <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-primary font-semibold text-sm">
              <BarChart3 className="h-4 w-4" />
              Company Workspace
            </div>
            <p className="text-xs text-muted-foreground">
              Filter by company to generate exact regulatory and management distribution reports.
            </p>
          </div>
          <div className="flex w-full items-center gap-2 md:w-auto">
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger className="w-full md:w-[320px] h-9 text-sm">
                <SelectValue placeholder="All companies" />
              </SelectTrigger>
              <SelectContent className="max-h-60 overflow-y-auto">
                <SelectItem value="all">All Companies (Consolidated)</SelectItem>
                {companies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.company_code} — {company.company_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={handleRefreshAll}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Key Metric Overview Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="glass-card hover-lift">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wide">Companies</span>
              <Building2 className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 text-2xl font-bold">{totals.companies}</div>
          </CardContent>
        </Card>
        <Card className="glass-card hover-lift">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wide">Transactions</span>
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 text-2xl font-bold">{fmtNr(totals.count)}</div>
          </CardContent>
        </Card>
        <Card className="glass-card hover-lift">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wide">Gross Payable</span>
              <Wallet className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 text-xl font-bold tabular-nums">{format(totals.gross)}</div>
          </CardContent>
        </Card>
        <Card className="glass-card hover-lift">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wide">TDS Tax</span>
              <Download className="h-4 w-4 text-amber-600" />
            </div>
            <div className="mt-2 text-xl font-bold tabular-nums text-amber-600">
              {format(totals.tax)}
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card hover-lift">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wide">Net Payable</span>
              <Users className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-2 text-xl font-bold tabular-nums text-emerald-600">
              {format(totals.net)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabbed Reporting Center */}
      <Tabs defaultValue="all" className="space-y-4">
        <TabsList className="flex flex-wrap lg:grid lg:grid-cols-7 w-full h-auto p-1 bg-muted/60 gap-1">
          <TabsTrigger value="all" className="py-2 text-xs md:text-sm">
            All Summaries
          </TabsTrigger>
          <TabsTrigger value="agm" className="py-2 text-xs md:text-sm">
            AGM Equities & Bonus
          </TabsTrigger>
          <TabsTrigger value="debenture" className="py-2 text-xs md:text-sm">
            Debentures (Pumori)
          </TabsTrigger>
          <TabsTrigger value="mf" className="py-2 text-xs md:text-sm">
            Mutual Funds (CDS)
          </TabsTrigger>
          <TabsTrigger value="ird_etds" className="py-2 text-xs md:text-sm">
            🏛️ IRD Annex-10
          </TabsTrigger>
          <TabsTrigger value="ipf_aging" className="py-2 text-xs md:text-sm">
            📊 SEBON IPF
          </TabsTrigger>
          <TabsTrigger value="registers" className="py-2 text-xs md:text-sm">
            Registers & Exports
          </TabsTrigger>
        </TabsList>

        {/* ─── TAB 1: ALL SUMMARIES ─── */}
        <TabsContent value="all" className="space-y-6">
          {/* AGM Summary Preview */}
          {agmSummaryQuery.isLoading ? (
            <Card className="border-primary/20 shadow-sm">
              <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center gap-3">
                <BarChart3 className="h-4 w-4 text-primary shrink-0" />
                <Skeleton className="h-4 w-64" />
              </CardHeader>
              <CardContent className="p-4 space-y-2">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full rounded" />
                ))}
              </CardContent>
            </Card>
          ) : agmSummary && agmSummary.rows.length > 0 ? (
            <Card className="border-primary/20 shadow-sm">
              <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    AGM Cash & Bonus Dividend Distribution Summary
                    <Badge variant="outline" className="font-mono text-[11px] ml-1">
                      {agmSummary.companyCode || "All"}{" "}
                      {agmSummary.fiscalYear ? `— FY ${agmSummary.fiscalYear}` : ""}
                    </Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Promoter, Public, and Local shareholding capital, bonus shares, and net cash
                    distribution.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => AgmDividendSummaryReportService.exportToExcel(agmSummary)}
                  >
                    <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                    Excel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => AgmDividendSummaryReportService.exportToPdf(agmSummary)}
                  >
                    <FileText className="mr-1.5 h-3.5 w-3.5 text-rose-600" />
                    PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-muted/80 text-foreground font-semibold border-b border-border divide-x divide-border">
                      <th className="py-2.5 px-3 text-center w-10 uppercase text-[11px] whitespace-nowrap">
                        S.N.
                      </th>
                      <th className="py-2.5 px-3 uppercase text-[11px] whitespace-nowrap min-w-[140px]">
                        CATEGORY
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                        SHAREHOLDERS
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                        KITTA
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                        {agmSummary.detectedBonusRate
                          ? `BONUS ${agmSummary.detectedBonusRate}%`
                          : "BONUS"}
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] bg-emerald-100/70 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200 whitespace-nowrap">
                        AFTER BONUS KITTA
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                        GROSS DIVIDEND
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                        TAX
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] bg-emerald-100/70 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200 whitespace-nowrap">
                        NET DIVIDEND
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                        COMPOSITION
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono">
                    {agmSummary.rows.map((row) => (
                      <tr
                        key={row.particular}
                        className="hover:bg-muted/30 transition-colors divide-x divide-border"
                      >
                        <td className="py-2 px-3 text-center text-muted-foreground whitespace-nowrap">
                          {row.sn}
                        </td>
                        <td className="py-2 px-3 font-semibold font-sans whitespace-nowrap text-foreground">
                          {row.particular}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {fmtNr(row.shareholderCount)}
                        </td>
                        <td className="py-2 px-3 text-right font-medium whitespace-nowrap">
                          {fmtNr(row.kitta)}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {fmtNr(row.issuedBonus)}
                        </td>
                        <td className="py-2 px-3 text-right font-semibold bg-emerald-50/70 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200 whitespace-nowrap">
                          {fmtNr(row.afterBonusKitta)}
                        </td>
                        <td className="py-2 px-3 text-right font-medium whitespace-nowrap">
                          {fmtNr(row.grossDividend)}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {fmtNr(row.divTax)}
                        </td>
                        <td className="py-2 px-3 text-right font-bold bg-emerald-50/70 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200 whitespace-nowrap">
                          {fmtNr(row.netDividend)}
                        </td>
                        <td className="py-2 px-3 text-right font-sans font-medium whitespace-nowrap">
                          {(row.composition ?? 0).toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/90 font-bold border-t-2 border-b-2 border-foreground/30 divide-x divide-border font-mono">
                      <td className="py-2 px-3 text-center whitespace-nowrap"></td>
                      <td className="py-2 px-3 font-sans uppercase whitespace-nowrap">TOTAL</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {fmtNr(agmSummary.total.shareholderCount)}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {fmtNr(agmSummary.total.kitta)}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {fmtNr(agmSummary.total.issuedBonus)}
                      </td>
                      <td className="py-2 px-3 text-right bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-200 whitespace-nowrap">
                        {fmtNr(agmSummary.total.afterBonusKitta)}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {fmtNr(agmSummary.total.grossDividend)}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {fmtNr(agmSummary.total.divTax)}
                      </td>
                      <td className="py-2 px-3 text-right bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-200 whitespace-nowrap">
                        {fmtNr(agmSummary.total.netDividend)}
                      </td>
                      <td className="py-2 px-3 text-right font-sans whitespace-nowrap">
                        {agmSummary.total.composition.toFixed(2)}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>
          ) : null}

          {/* Debenture Summary Preview */}
          {debentureSummaryQuery.isLoading ? (
            <Card className="border-primary/20 shadow-sm">
              <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center gap-3">
                <Coins className="h-4 w-4 text-primary shrink-0" />
                <Skeleton className="h-4 w-72" />
              </CardHeader>
              <CardContent className="p-4 space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full rounded" />
                ))}
              </CardContent>
            </Card>
          ) : debentureSummary && debentureSummary.rows.length > 0 ? (
            <Card className="border-primary/20 shadow-sm">
              <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Coins className="h-4 w-4 text-primary" />
                    Debenture Interest Distribution Summary (Pumori Format)
                    <Badge variant="outline" className="font-mono text-[11px] ml-1">
                      {debentureSummary.companyCode || "All"}{" "}
                      {debentureSummary.fiscalYear ? `— FY ${debentureSummary.fiscalYear}` : ""}
                    </Badge>
                    {debentureSummary.daysCount && (
                      <Badge
                        variant="secondary"
                        className="font-sans text-[10px] ml-1 bg-primary/10 text-primary"
                      >
                        {debentureSummary.daysCount} Days &bull;{" "}
                        {debentureSummary.daysCount >= 360
                          ? "Annual"
                          : debentureSummary.daysCount >= 180
                            ? "Semi-Annual (6M)"
                            : "Quarterly"}
                      </Badge>
                    )}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Public ({debDisplayRates.publicRatePct}% TDS), Institution (
                    {debDisplayRates.institutionRatePct}% TDS), and Mutual Fund (
                    {debDisplayRates.exemptRatePct}% TDS) debenture coupon calculation.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => DebentureSummaryReportService.exportToExcel(debentureSummary)}
                  >
                    <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                    Excel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => DebentureSummaryReportService.exportToPdf(debentureSummary)}
                  >
                    <FileText className="mr-1.5 h-3.5 w-3.5 text-rose-600" />
                    PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-muted/80 text-foreground font-semibold border-b border-border divide-x border-border">
                      <th className="py-2.5 px-3 uppercase text-[11px] whitespace-nowrap min-w-[140px]">
                        CATEGORY
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                        KITTA
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                        PRINCIPAL
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                        {debentureSummary.couponRate > 0
                          ? `ANNUAL INT. (${debentureSummary.couponRate}%)`
                          : "ANNUAL INT. (12M)"}
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                        INT. PER DAY
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                        GROSS INTEREST (COUPON)
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                        TAX
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] bg-emerald-100/70 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200 whitespace-nowrap">
                        NET PAYABLE
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono">
                    {debentureSummary.rows.map((row) => (
                      <tr
                        key={row.name}
                        className="hover:bg-muted/30 transition-colors divide-x divide-border"
                      >
                        <td className="py-2 px-3 font-semibold font-sans whitespace-nowrap text-foreground">
                          {row.name}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {fmtNr(row.kitta)}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {fmtNr(row.principalAmount)}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {fmtNr(row.annualInterest)}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {fmtNr(row.interestPerDay)}
                        </td>
                        <td className="py-2 px-3 text-right font-medium whitespace-nowrap">
                          {fmtNr(row.grossInterest)}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {fmtNr(row.taxAmount)}
                        </td>
                        <td className="py-2 px-3 text-right font-bold bg-emerald-50/70 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200 whitespace-nowrap">
                          {fmtNr(row.netInterestPayable)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/90 font-bold border-t-2 border-b-2 border-foreground/30 divide-x divide-border font-mono">
                      <td className="py-2 px-3 font-sans uppercase whitespace-nowrap">TOTAL</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {fmtNr(debentureSummary.total.kitta)}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {fmtNr(debentureSummary.total.principalAmount)}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {fmtNr(debentureSummary.total.annualInterest)}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {fmtNr(debentureSummary.total.interestPerDay)}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {fmtNr(debentureSummary.total.grossInterest)}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {fmtNr(debentureSummary.total.taxAmount)}
                      </td>
                      <td className="py-2 px-3 text-right bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-200 whitespace-nowrap">
                        {fmtNr(debentureSummary.total.netInterestPayable)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>
          ) : null}

          {/* Mutual Fund Summary Preview */}
          {mfSummaryQuery.isLoading ? (
            <Card className="border-primary/20 shadow-sm">
              <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center gap-3">
                <Layers className="h-4 w-4 text-primary shrink-0" />
                <Skeleton className="h-4 w-60" />
              </CardHeader>
              <CardContent className="p-4 space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full rounded" />
                ))}
              </CardContent>
            </Card>
          ) : mfSummary.length > 0 ? (
            <Card className="border-primary/20 shadow-sm">
              <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    Mutual Fund Distribution Summary (CDS Format)
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    CDS & Clearing format unitholder category distribution with unit counts and net
                    dividends.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() =>
                      SummaryReportService.exportMutualFundSummaryToExcel(
                        mfSummary,
                        `mutual_fund_summary_${selectedCompany?.company_code || "all"}`,
                      )
                    }
                  >
                    <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                    Excel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() =>
                      SummaryReportService.exportMutualFundSummaryToPdf(
                        mfSummary,
                        selectedCompany?.company_name || "RTARTS System",
                      )
                    }
                  >
                    <FileText className="mr-1.5 h-3.5 w-3.5 text-rose-600" />
                    PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-muted/80 text-foreground font-semibold border-b border-border divide-x divide-border">
                      <th className="py-2.5 px-3 text-center w-10 uppercase text-[11px] whitespace-nowrap">
                        S.N.
                      </th>
                      <th className="py-2.5 px-3 uppercase text-[11px] whitespace-nowrap min-w-[140px]">
                        CATEGORY
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                        UNITHOLDERS
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                        UNITS / KITTA
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                        GROSS DIVIDEND
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                        TAX
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] bg-emerald-100/70 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200 whitespace-nowrap">
                        NET DIVIDEND
                      </th>
                      <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                        COMPOSITION
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono">
                    {mfSummary.map((row) => (
                      <tr
                        key={row.type}
                        className="hover:bg-muted/30 transition-colors divide-x divide-border"
                      >
                        <td className="py-2 px-3 text-center text-muted-foreground whitespace-nowrap">
                          {row.sn}
                        </td>
                        <td className="py-2 px-3 font-semibold font-sans whitespace-nowrap text-foreground">
                          {row.type}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {fmtNr(row.transaction_count)}
                        </td>
                        <td className="py-2 px-3 text-right font-medium whitespace-nowrap">
                          {fmtNr(row.kitta)}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {fmtNr(row.gross)}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">{fmtNr(row.tax)}</td>
                        <td className="py-2 px-3 text-right font-bold bg-emerald-50/70 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200 whitespace-nowrap">
                          {fmtNr(row.net)}
                        </td>
                        <td className="py-2 px-3 text-right font-sans font-medium whitespace-nowrap">
                          {(row.composition ?? 0).toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/90 font-bold border-t-2 border-b-2 border-foreground/30 divide-x divide-border font-mono">
                      <td className="py-2 px-3 text-center whitespace-nowrap"></td>
                      <td className="py-2 px-3 font-sans uppercase whitespace-nowrap">TOTAL</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {fmtNr(mfTotal.transaction_count)}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {fmtNr(mfTotal.kitta)}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {fmtNr(mfTotal.gross)}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {fmtNr(mfTotal.tax)}
                      </td>
                      <td className="py-2 px-3 text-right bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-200 whitespace-nowrap">
                        {fmtNr(mfTotal.net)}
                      </td>
                      <td className="py-2 px-3 text-right font-sans whitespace-nowrap">100.00%</td>
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>
          ) : null}

          {!isSummariesLoading && !hasAnySummaryData && (
            <Card className="border-dashed border-muted-foreground/30 bg-muted/10">
              <CardContent className="py-12 text-center text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-sm text-foreground">
                  No Distribution Records Found
                </p>
                <p>
                  No AGM equity dividends, debenture coupons, or mutual fund returns are currently
                  registered for this selection.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── TAB 2: AGM EQUITIES & BONUS ─── */}
        <TabsContent value="agm" className="space-y-4">
          {agmSummary && agmSummary.rows.length > 0 ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>AGM Shareholder Category Summary</CardTitle>
                  <CardDescription>
                    Official AGM distribution sheet matching regulatory RTA format.
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => AgmDividendSummaryReportService.exportToExcel(agmSummary)}
                  >
                    <FileSpreadsheet className="mr-1.5 h-4 w-4 text-emerald-600" /> Export Excel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => AgmDividendSummaryReportService.exportToPdf(agmSummary)}
                  >
                    <FileText className="mr-1.5 h-4 w-4 text-rose-600" /> Export PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>S.N.</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Shareholders</TableHead>
                      <TableHead className="text-right">Kitta</TableHead>
                      <TableHead className="text-right">Bonus Issued</TableHead>
                      <TableHead className="text-right">After Bonus Kitta</TableHead>
                      <TableHead className="text-right">Gross Dividend</TableHead>
                      <TableHead className="text-right">Tax</TableHead>
                      <TableHead className="text-right">Net Dividend</TableHead>
                      <TableHead className="text-right">Composition</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agmSummary.rows.map((row) => (
                      <TableRow key={row.particular}>
                        <TableCell>{row.sn}</TableCell>
                        <TableCell className="font-medium">{row.particular}</TableCell>
                        <TableCell className="text-right">{fmtNr(row.shareholderCount)}</TableCell>
                        <TableCell className="text-right">{fmtNr(row.kitta)}</TableCell>
                        <TableCell className="text-right">{fmtNr(row.issuedBonus)}</TableCell>
                        <TableCell className="text-right font-medium text-emerald-600">
                          {fmtNr(row.afterBonusKitta)}
                        </TableCell>
                        <TableCell className="text-right">{format(row.grossDividend)}</TableCell>
                        <TableCell className="text-right text-amber-600">
                          {format(row.divTax + row.bonTax)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-emerald-600">
                          {format(row.netDividend)}
                        </TableCell>
                        <TableCell className="text-right">
                          {(row.composition ?? 0).toFixed(2)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  {agmSummary.total && (
                    <TableFooter>
                      <TableRow className="bg-muted/90 font-bold border-t-2 border-foreground/30 font-mono">
                        <TableCell></TableCell>
                        <TableCell className="font-sans uppercase">TOTAL</TableCell>
                        <TableCell className="text-right">
                          {fmtNr(agmSummary.total.shareholderCount)}
                        </TableCell>
                        <TableCell className="text-right">
                          {fmtNr(agmSummary.total.kitta)}
                        </TableCell>
                        <TableCell className="text-right">
                          {fmtNr(agmSummary.total.issuedBonus)}
                        </TableCell>
                        <TableCell className="text-right text-emerald-600 dark:text-emerald-400">
                          {fmtNr(agmSummary.total.afterBonusKitta)}
                        </TableCell>
                        <TableCell className="text-right">
                          {format(agmSummary.total.grossDividend)}
                        </TableCell>
                        <TableCell className="text-right text-amber-600">
                          {format(agmSummary.total.divTax + agmSummary.total.bonTax)}
                        </TableCell>
                        <TableCell className="text-right text-emerald-600 dark:text-emerald-400">
                          {format(agmSummary.total.netDividend)}
                        </TableCell>
                        <TableCell className="text-right font-sans">
                          {agmSummary.total.composition.toFixed(2)}%
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No dividend records found for the selected company.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── TAB 3: DEBENTURES (PUMORI) ─── */}
        <TabsContent value="debenture" className="space-y-4">
          {debentureSummaryQuery.isLoading ? (
            <Card className="border-primary/20 shadow-sm">
              <CardContent className="p-4 space-y-2">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full rounded" />
                ))}
              </CardContent>
            </Card>
          ) : debentureSummary && debentureSummary.rows.length > 0 ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    Debenture Interest Distribution Summary
                    {debentureSummary.daysCount && (
                      <Badge
                        variant="outline"
                        className="font-sans text-xs bg-primary/10 text-primary"
                      >
                        {debentureSummary.daysCount} Days &bull;{" "}
                        {debentureSummary.daysCount >= 360
                          ? "Annual (12 Months)"
                          : debentureSummary.daysCount >= 180
                            ? "Semi-Annual (6 Months)"
                            : "Quarterly"}
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    Pumori banking & CDS format for Public, Institution, and Mutual Fund debentures.
                    Displays both Full Annual (12M) baseline interest and the actual Coupon Period (
                    {debentureSummary.daysCount
                      ? `${debentureSummary.daysCount} Days`
                      : "6 Months / Semi-Annual"}
                    ) disbursed.
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => DebentureSummaryReportService.exportToExcel(debentureSummary)}
                  >
                    <FileSpreadsheet className="mr-1.5 h-4 w-4 text-emerald-600" /> Export Excel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => DebentureSummaryReportService.exportToPdf(debentureSummary)}
                  >
                    <FileText className="mr-1.5 h-4 w-4 text-rose-600" /> Export PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Kitta</TableHead>
                      <TableHead className="text-right">Principal Amount</TableHead>
                      <TableHead className="text-right">Annual Interest (12M)</TableHead>
                      <TableHead className="text-right">Int. Per Day</TableHead>
                      <TableHead className="text-right">Gross Interest (Coupon)</TableHead>
                      <TableHead className="text-right">Tax Withheld</TableHead>
                      <TableHead className="text-right">Net Payable</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {debentureSummary.rows.map((row) => (
                      <TableRow key={row.name}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-right">{fmtNr(row.kitta)}</TableCell>
                        <TableCell className="text-right">{format(row.principalAmount)}</TableCell>
                        <TableCell className="text-right">{format(row.annualInterest)}</TableCell>
                        <TableCell className="text-right">{format(row.interestPerDay)}</TableCell>
                        <TableCell className="text-right">{format(row.grossInterest)}</TableCell>
                        <TableCell className="text-right text-amber-600">
                          {format(row.taxAmount)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-emerald-600">
                          {format(row.netInterestPayable)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  {debentureSummary.total && (
                    <TableFooter>
                      <TableRow className="bg-muted/90 font-bold border-t-2 border-foreground/30 font-mono">
                        <TableCell className="font-sans uppercase">TOTAL</TableCell>
                        <TableCell className="text-right">
                          {fmtNr(debentureSummary.total.kitta)}
                        </TableCell>
                        <TableCell className="text-right">
                          {format(debentureSummary.total.principalAmount)}
                        </TableCell>
                        <TableCell className="text-right">
                          {format(debentureSummary.total.annualInterest)}
                        </TableCell>
                        <TableCell className="text-right">
                          {format(debentureSummary.total.interestPerDay)}
                        </TableCell>
                        <TableCell className="text-right">
                          {format(debentureSummary.total.grossInterest)}
                        </TableCell>
                        <TableCell className="text-right text-amber-600">
                          {format(debentureSummary.total.taxAmount)}
                        </TableCell>
                        <TableCell className="text-right text-emerald-600 dark:text-emerald-400">
                          {format(debentureSummary.total.netInterestPayable)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No debenture interest records found for the selected company.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── TAB 4: MUTUAL FUNDS (CDS) ─── */}
        <TabsContent value="mf" className="space-y-4">
          {mfSummary.length > 0 ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Mutual Fund Distribution Summary</CardTitle>
                  <CardDescription>CDS standard category returns for unitholders.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      SummaryReportService.exportMutualFundSummaryToExcel(
                        mfSummary,
                        `mutual_fund_summary_${selectedCompany?.company_code || "all"}`,
                      )
                    }
                  >
                    <FileSpreadsheet className="mr-1.5 h-4 w-4 text-emerald-600" /> Export Excel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      SummaryReportService.exportMutualFundSummaryToPdf(
                        mfSummary,
                        selectedCompany?.company_name || "RTARTS System",
                      )
                    }
                  >
                    <FileText className="mr-1.5 h-4 w-4 text-rose-600" /> Export PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>S.N.</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Unitholders</TableHead>
                      <TableHead className="text-right">Units / Kitta</TableHead>
                      <TableHead className="text-right">Gross Dividend</TableHead>
                      <TableHead className="text-right">Tax</TableHead>
                      <TableHead className="text-right">Net Dividend</TableHead>
                      <TableHead className="text-right">Composition</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mfSummary.map((row) => (
                      <TableRow key={row.type}>
                        <TableCell>{row.sn}</TableCell>
                        <TableCell className="font-medium">{row.type}</TableCell>
                        <TableCell className="text-right">{fmtNr(row.transaction_count)}</TableCell>
                        <TableCell className="text-right">{fmtNr(row.kitta)}</TableCell>
                        <TableCell className="text-right">{format(row.gross)}</TableCell>
                        <TableCell className="text-right text-amber-600">
                          {format(row.tax)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-emerald-600">
                          {format(row.net)}
                        </TableCell>
                        <TableCell className="text-right">
                          {(row.composition ?? 0).toFixed(2)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="bg-muted/90 font-bold border-t-2 border-foreground/30 font-mono">
                      <TableCell></TableCell>
                      <TableCell className="font-sans uppercase">TOTAL</TableCell>
                      <TableCell className="text-right">
                        {fmtNr(mfTotal.transaction_count)}
                      </TableCell>
                      <TableCell className="text-right">{fmtNr(mfTotal.kitta)}</TableCell>
                      <TableCell className="text-right">{format(mfTotal.gross)}</TableCell>
                      <TableCell className="text-right text-amber-600">
                        {format(mfTotal.tax)}
                      </TableCell>
                      <TableCell className="text-right text-emerald-600 dark:text-emerald-400">
                        {format(mfTotal.net)}
                      </TableCell>
                      <TableCell className="text-right font-sans">100.00%</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No mutual fund records found for the selected company.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── TAB 5: REGISTERS & EXPORTS ─── */}
        <TabsContent value="registers" className="space-y-6">
          {/* Payable Registers Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-semibold text-base">Payable Registers</h3>
                <p className="text-xs text-muted-foreground">
                  Download transaction-level registers with BOID, bank account numbers, and tax
                  rates.
                </p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {PAYABLE_REPORTS.map((report) => (
                <Card key={report.id} className="hover:border-primary/50 transition-colors">
                  <CardContent className="p-4 flex flex-col justify-between h-full">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-medium text-sm">{report.title}</h4>
                        <FileText className="h-4 w-4 text-primary shrink-0" />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{report.description}</p>
                    </div>
                    <div className="mt-4 flex gap-1.5 pt-2 border-t">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-8 text-xs flex-1 bg-primary/90 hover:bg-primary"
                        onClick={() => setViewingReport(report.id)}
                      >
                        <Eye className="mr-1.5 h-3.5 w-3.5" />
                        View
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs px-2.5"
                        disabled={activeExport === `${report.id}-xlsx`}
                        onClick={() => exportReport(report.id, "xlsx")}
                        title="Export Excel"
                      >
                        {activeExport === `${report.id}-xlsx` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                        ) : (
                          <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs px-2.5"
                        disabled={activeExport === `${report.id}-pdf`}
                        onClick={() => exportReport(report.id, "pdf")}
                        title="Export PDF"
                      >
                        {activeExport === `${report.id}-pdf` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-600" />
                        ) : (
                          <FileText className="h-3.5 w-3.5 text-rose-600" />
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Operations & Audit Section */}
          <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-semibold text-base">Operations & Audit Exports</h3>
                <p className="text-xs text-muted-foreground">
                  Export system batch approvals, bank reconciliation discrepancies, and data
                  uploads.
                </p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {OPERATIONS_REPORTS.map((report) => (
                <Card key={report.id} className="hover:border-primary/50 transition-colors">
                  <CardContent className="p-4 flex flex-col justify-between h-full">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-medium text-sm">{report.title}</h4>
                        <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{report.description}</p>
                    </div>
                    <div className="mt-4 flex gap-1.5 pt-2 border-t">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-8 text-xs flex-1 bg-primary/90 hover:bg-primary"
                        onClick={() => setViewingReport(report.id)}
                      >
                        <Eye className="mr-1.5 h-3.5 w-3.5" />
                        View
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs px-2.5"
                        disabled={activeExport === `${report.id}-xlsx`}
                        onClick={() => exportReport(report.id, "xlsx")}
                        title="Export Excel"
                      >
                        {activeExport === `${report.id}-xlsx` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                        ) : (
                          <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs px-2.5"
                        disabled={activeExport === `${report.id}-pdf`}
                        onClick={() => exportReport(report.id, "pdf")}
                        title="Export PDF"
                      >
                        {activeExport === `${report.id}-pdf` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-600" />
                        ) : (
                          <FileText className="h-3.5 w-3.5 text-rose-600" />
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* ─── TAB 6: IRD ANNEX-10 e-TDS ─── */}
        <TabsContent value="ird_etds" className="space-y-6">
          <Card className="border-primary/20 shadow-sm">
            <CardHeader className="py-4 px-6 bg-muted/40 border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Coins className="h-5 w-5 text-emerald-600" />
                  Government of Nepal — Inland Revenue Department (IRD) Annex-10 e-TDS Return
                </CardTitle>
                <CardDescription className="text-xs">
                  Pursuant to Section 87 & 88 of the Nepal Income Tax Act 2058. Formatted for direct
                  upload to the IRD e-filing portal.
                </CardDescription>
              </div>
              {irdEtds && (
                <Button
                  variant="default"
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 h-9"
                  onClick={() => IrdEtdsService.exportAnnex10Excel(irdEtds)}
                >
                  <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                  Download IRD Annex-10 Excel
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              {irdEtdsQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : irdEtds ? (
                <>
                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 bg-muted/30 border rounded-lg">
                      <span className="text-xs text-muted-foreground font-medium uppercase">
                        Total Withholdees
                      </span>
                      <div className="text-xl font-bold mt-1">
                        {irdEtds.totalWithholdees.toLocaleString()}
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        PAN: {irdEtds.panWithholdees} | Unregistered:{" "}
                        {irdEtds.unregisteredWithholdees}
                      </span>
                    </div>
                    <div className="p-4 bg-muted/30 border rounded-lg">
                      <span className="text-xs text-muted-foreground font-medium uppercase">
                        Total Gross Payment
                      </span>
                      <div className="text-xl font-bold mt-1 text-primary">
                        {format(irdEtds.totalGrossAmount)}
                      </div>
                    </div>
                    <div className="p-4 bg-muted/30 border rounded-lg">
                      <span className="text-xs text-muted-foreground font-medium uppercase">
                        Total TDS Withheld
                      </span>
                      <div className="text-xl font-bold mt-1 text-rose-600">
                        {format(irdEtds.totalTdsAmount)}
                      </div>
                    </div>
                    <div className="p-4 bg-muted/30 border rounded-lg">
                      <span className="text-xs text-muted-foreground font-medium uppercase">
                        Total Net Payment
                      </span>
                      <div className="text-xl font-bold mt-1 text-emerald-600">
                        {format(irdEtds.totalNetAmount)}
                      </div>
                    </div>
                  </div>

                  {/* Sample Return Table */}
                  <div className="border rounded-lg overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead className="w-12">S.N.</TableHead>
                          <TableHead>Withholdee PAN</TableHead>
                          <TableHead>Shareholder / Payee</TableHead>
                          <TableHead>BOID</TableHead>
                          <TableHead>Payment Head</TableHead>
                          <TableHead className="text-right">Gross (NPR)</TableHead>
                          <TableHead className="text-right">TDS %</TableHead>
                          <TableHead className="text-right">TDS (NPR)</TableHead>
                          <TableHead className="text-right">Net (NPR)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {irdEtds.rows.slice(0, 15).map((row) => (
                          <TableRow key={row.sn}>
                            <TableCell className="font-mono text-xs">{row.sn}</TableCell>
                            <TableCell className="font-mono text-xs font-medium">
                              {row.withholdeePan === "UNREGISTERED" ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] text-amber-600 bg-amber-50 dark:bg-amber-950/20"
                                >
                                  Unregistered
                                </Badge>
                              ) : (
                                row.withholdeePan
                              )}
                            </TableCell>
                            <TableCell className="font-medium text-xs">
                              {row.withholdeeName}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{row.boid}</TableCell>
                            <TableCell className="text-xs">
                              <Badge variant="secondary" className="text-[10px]">
                                {row.paymentType}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {fmtNr(row.grossAmount)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs font-semibold">
                              {row.tdsRate.toFixed(1)}%
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-rose-600 font-semibold">
                              {fmtNr(row.tdsAmount)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-emerald-600 font-semibold">
                              {fmtNr(row.netPayable)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {irdEtds.rows.length > 15 && (
                    <p className="text-xs text-muted-foreground text-center">
                      Showing first 15 of {irdEtds.rows.length.toLocaleString()} withholdee records.
                      Download full Annex-10 Excel file for complete e-filing schedule.
                    </p>
                  )}
                </>
              ) : (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  Please select a company to view the IRD Annex-10 e-TDS schedule.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB 7: SEBON IPF AGING ─── */}
        <TabsContent value="ipf_aging" className="space-y-6">
          <Card className="border-primary/20 shadow-sm">
            <CardHeader className="py-4 px-6 bg-muted/40 border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-amber-600" />
                  SEBON & Office of Company Registrar — Investor Protection Fund (IPF) 5-Year Aging
                  Tracker
                </CardTitle>
                <CardDescription className="text-xs">
                  Pursuant to Section 182 of the Nepal Companies Act 2063: Unclaimed dividends older
                  than 5 years must be transferred to the Investor Protection Fund.
                </CardDescription>
              </div>
              {ipfReport && ipfReport.ipfEligibleCount > 0 && (
                <Button
                  variant="default"
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-700 h-9"
                  onClick={() => IpfService.exportIpfTransferSchedule(ipfReport)}
                >
                  <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                  Download SEBON IPF Transfer Schedule
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              {ipfAgingQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : ipfReport ? (
                <>
                  {/* Aging Bracket Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {ipfReport.agingBuckets.map((bucket, idx) => (
                      <div
                        key={idx}
                        className={`p-4 border rounded-lg ${
                          bucket.isEligibleForIpf
                            ? "bg-amber-50/60 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800"
                            : "bg-muted/30"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold uppercase">{bucket.label}</span>
                          {bucket.isEligibleForIpf && (
                            <Badge variant="destructive" className="text-[9px]">
                              IPF STATUTORY
                            </Badge>
                          )}
                        </div>
                        <div className="text-xl font-bold mt-2 font-mono">
                          {format(bucket.totalAmount)}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {bucket.count.toLocaleString()} payables
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Summary Callout */}
                  <div className="p-4 bg-muted/40 border rounded-lg flex flex-col md:flex-row items-center justify-between gap-4">
                    <div>
                      <h4 className="font-semibold text-sm">Total Unclaimed Payable Balance</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Total {ipfReport.totalUnclaimedCount.toLocaleString()} unclaimed payables
                        amounting to {format(ipfReport.totalUnclaimedAmount)}.
                        {ipfReport.ipfEligibleCount > 0 ? (
                          <span className="text-amber-700 dark:text-amber-400 font-semibold ml-1">
                            {ipfReport.ipfEligibleCount.toLocaleString()} payables (
                            {format(ipfReport.ipfEligibleAmount)}) have exceeded 5 years and are
                            ready for statutory transfer.
                          </span>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-400 font-semibold ml-1">
                            No payables currently exceed the 5-year threshold.
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  No unclaimed dividend records found.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <RegisterViewerDialog
        reportId={viewingReport}
        reportTitle={
          [...PAYABLE_REPORTS, ...OPERATIONS_REPORTS].find((r) => r.id === viewingReport)?.title ||
          ""
        }
        reportDescription={
          [...PAYABLE_REPORTS, ...OPERATIONS_REPORTS].find((r) => r.id === viewingReport)
            ?.description || ""
        }
        companyName={
          selectedCompany?.company_name ||
          (companyId === "all" ? "All Companies (Consolidated)" : "Selected Company")
        }
        open={!!viewingReport}
        onOpenChange={(isOpen) => !isOpen && setViewingReport(null)}
        fetchData={fetchReport}
        onExport={exportReport}
        isExporting={!!activeExport}
      />
    </div>
  );
}
