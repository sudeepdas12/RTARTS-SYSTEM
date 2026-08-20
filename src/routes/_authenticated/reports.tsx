import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase, fetchAllRows } from "@/lib/services/database";
import { SummaryReportService, type MutualFundSummaryRow } from "@/lib/services/summary-report.service";
import { ReportService, type ReportFilters } from "@/lib/services/report.service";
import { ExcelExporter } from "@/lib/excel-exporter";
import { PdfGenerator } from "@/lib/pdf-generator";
import { getPayeeCategoryLabel } from "@/lib/services/payable-summary";
import { AgmDividendSummaryReportService } from "@/lib/services/dividend-summary-report.service";
import { DebentureSummaryReportService } from "@/lib/services/debenture-summary-report.service";
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
  { id: "dividend_register", title: "Dividend Register", description: "Cash, stock, bonus, and right-share transactions with BOID & bank account details." },
  { id: "interest_register", title: "Interest Register", description: "Debenture coupon interest dues, TDS deductions, and payment statuses." },
  { id: "mutual_fund_register", title: "Mutual Fund Register", description: "Unit-holder distribution records, bank accounts, and payment statuses." },
  { id: "tax_register", title: "Tax (TDS) Register", description: "Payable-level TDS breakdowns with payee PAN, gross, rate %, and tax withheld." },
  { id: "pending_register", title: "Pending Payables", description: "Outstanding amounts across instruments awaiting payment or approval." },
];

const OPERATIONS_REPORTS: Array<{ id: ReportId; title: string; description: string }> = [
  { id: "payment_register", title: "Payment Batches", description: "Batch payout processing, authorization status, and disbursement totals." },
  { id: "reconciliation_report", title: "Reconciliation Results", description: "Bank settlement matches, discrepancy logs, and variance analysis." },
  { id: "upload_history_report", title: "Upload History", description: "Import logs, validation diagnostics, and processed vs failed counts." },
];

const REPORT_COLUMNS: Record<ReportId, Array<{ header: string; dataKey: string }>> = {
  dividend_register: [{ header: "BOID", dataKey: "boid" }, { header: "Payee", dataKey: "full_name" }, { header: "Company", dataKey: "company_name" }, { header: "Gross", dataKey: "gross_dividend" }, { header: "Tax", dataKey: "tax_amount" }, { header: "Net", dataKey: "net_payable" }, { header: "Status", dataKey: "payment_status" }],
  interest_register: [{ header: "BOID", dataKey: "boid" }, { header: "Payee", dataKey: "full_name" }, { header: "Company", dataKey: "company_name" }, { header: "Gross", dataKey: "gross_interest" }, { header: "Tax", dataKey: "tax_amount" }, { header: "Net", dataKey: "net_payable" }, { header: "Status", dataKey: "payment_status" }],
  mutual_fund_register: [{ header: "BOID", dataKey: "boid" }, { header: "Payee", dataKey: "full_name" }, { header: "Company", dataKey: "company_name" }, { header: "Gross", dataKey: "gross_dividend" }, { header: "Tax", dataKey: "tax_amount" }, { header: "Net", dataKey: "net_payable" }, { header: "Status", dataKey: "payment_status" }],
  tax_register: [{ header: "Payee", dataKey: "full_name" }, { header: "Company", dataKey: "company_name" }, { header: "Type", dataKey: "payable_type" }, { header: "Gross", dataKey: "gross_amount" }, { header: "Rate %", dataKey: "tds_rate" }, { header: "Tax", dataKey: "tax_amount" }, { header: "Net", dataKey: "net_payable" }],
  pending_register: [{ header: "BOID", dataKey: "boid" }, { header: "Payee", dataKey: "full_name" }, { header: "Company", dataKey: "company_name" }, { header: "Type", dataKey: "payable_type" }, { header: "Gross", dataKey: "gross_amount" }, { header: "Tax", dataKey: "tax_amount" }, { header: "Net", dataKey: "net_payable" }],
  payment_register: [{ header: "Batch", dataKey: "batch_name" }, { header: "Method", dataKey: "payment_method" }, { header: "Payments", dataKey: "total_payments" }, { header: "Amount", dataKey: "total_amount" }, { header: "Status", dataKey: "status" }],
  reconciliation_report: [{ header: "Payee", dataKey: "shareholder_name" }, { header: "Expected", dataKey: "system_amount" }, { header: "Actual", dataKey: "excel_amount" }, { header: "Difference", dataKey: "difference" }, { header: "Status", dataKey: "status" }],
  upload_history_report: [{ header: "File", dataKey: "file_name" }, { header: "Type", dataKey: "file_type" }, { header: "Processed", dataKey: "rows_processed" }, { header: "Failed", dataKey: "rows_failed" }, { header: "Status", dataKey: "status" }],
};

function ReportsRoute() {
  const [companyId, setCompanyId] = useState("all");
  const [activeExport, setActiveExport] = useState<string | null>(null);

  const { data: companies = [] } = useQuery({
    queryKey: ["report-companies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id, company_name, company_code").order("company_name");
      if (error) throw error;
      return data || [];
    },
  });

  const selectedCompany = useMemo(() => companies.find((c) => c.id === companyId), [companies, companyId]);
  const filters: ReportFilters = useMemo(() => ({ companyId: companyId === "all" ? undefined : companyId }), [companyId]);

  // 1. Consolidated Summary
  const summary = useQuery({
    queryKey: ["live-payable-summary", companyId],
    queryFn: () => SummaryReportService.getCompanySummary(filters),
  });
  const rows = summary.data || [];
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
        { companies: 0, count: 0, gross: 0, tax: 0, net: 0 }
      ),
    [rows]
  );

  // 2. AGM Dividend Summary
  const agmSummaryQuery = useQuery({
    queryKey: ["agm-dividend-summary-report", companyId],
    queryFn: () => AgmDividendSummaryReportService.getCompanySummary(companyId === "all" ? undefined : companyId),
  });
  const agmSummary = agmSummaryQuery.data;

  // 3. Debenture Summary
  const debentureSummaryQuery = useQuery({
    queryKey: ["debenture-interest-summary-report", companyId],
    queryFn: async () => {
      const data = await fetchAllRows<any>((from, to) => {
        let q = supabase
          .from("interest_payables")
          .select("*, client:clients(id, full_name, holder_type, payee_classification), company:companies(id, company_code, company_name)")
          .range(from, to);
        if (companyId && companyId !== "all") {
          q = q.eq("company_id", companyId);
        }
        return q;
      });
      return DebentureSummaryReportService.generateReportFromPayables(
        data || [],
        selectedCompany?.company_name || (companyId === "all" ? "All Debentures" : "Selected Company"),
        selectedCompany?.company_code || ""
      );
    },
  });
  const debentureSummary = debentureSummaryQuery.data;

  // 4. Mutual Fund Summary
  const mfSummaryQuery = useQuery({
    queryKey: ["mutual-fund-summary-report", companyId],
    queryFn: () => SummaryReportService.getMutualFundSummary({ companyId }),
  });
  const mfSummary = mfSummaryQuery.data || [];
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
        { transaction_count: 0, kitta: 0, gross: 0, tax: 0, net: 0 }
      ),
    [mfSummary]
  );

  const format = (value: number) => `NPR ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtNr = (value: number) => Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
    }[id])(filters);

  const exportReport = async (id: ReportId, kind: "xlsx" | "pdf") => {
    setActiveExport(`${id}-${kind}`);
    try {
      const data = await fetchReport(id);
      if (!data.length) {
        toast.info("No records found matching the selected company.");
        return;
      }
      const title =
        [...PAYABLE_REPORTS, ...OPERATIONS_REPORTS].find((r) => r.id === id)?.title || id;
      if (kind === "xlsx") ExcelExporter.exportToExcel(data as any[], title);
      else
        PdfGenerator.generate(
          { title, companyName: selectedCompany?.company_name || "RTARTS System", generatedBy: "System" },
          REPORT_COLUMNS[id] || [],
          data as unknown as Record<string, unknown>[]
        );
      toast.success(`${data.length} record(s) exported.`);
    } catch (error) {
      console.error(error);
      toast.error("This report could not be exported from live data.");
    } finally {
      setActiveExport(null);
    }
  };

  const handleRefreshAll = () => {
    summary.refetch();
    agmSummaryQuery.refetch();
    debentureSummaryQuery.refetch();
    mfSummaryQuery.refetch();
    toast.success("All summaries refreshed with latest data.");
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
              <SelectContent>
                <SelectItem value="all">All Companies (Consolidated)</SelectItem>
                {companies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.company_code} — {company.company_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={handleRefreshAll}>
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
            <div className="mt-2 text-xl font-bold tabular-nums text-amber-600">{format(totals.tax)}</div>
          </CardContent>
        </Card>
        <Card className="glass-card hover-lift">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wide">Net Payable</span>
              <Users className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-2 text-xl font-bold tabular-nums text-emerald-600">{format(totals.net)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabbed Reporting Center */}
      <Tabs defaultValue="all" className="space-y-4">
        <TabsList className="grid grid-cols-2 md:grid-cols-5 w-full h-auto p-1 bg-muted/60">
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
          <TabsTrigger value="registers" className="py-2 text-xs md:text-sm">
            Registers & Exports
          </TabsTrigger>
        </TabsList>

        {/* ─── TAB 1: ALL SUMMARIES ─── */}
        <TabsContent value="all" className="space-y-6">
          {/* AGM Summary Preview */}
          {agmSummary && agmSummary.rows.length > 0 && (
            <Card className="border-primary/20 shadow-sm">
              <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    AGM Cash & Bonus Dividend Distribution Summary
                    <Badge variant="outline" className="font-mono text-[11px] ml-1">
                      {agmSummary.companyCode || "All"} {agmSummary.fiscalYear ? `— FY ${agmSummary.fiscalYear}` : ""}
                    </Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Promoter, Public, and Local shareholding capital, bonus shares, and net cash distribution.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => AgmDividendSummaryReportService.exportToExcel(agmSummary)}>
                    <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                    Excel
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => AgmDividendSummaryReportService.exportToPdf(agmSummary)}>
                    <FileText className="mr-1.5 h-3.5 w-3.5 text-rose-600" />
                    PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-muted/80 text-foreground font-semibold border-b border-border divide-x divide-border">
                      <th className="py-2 px-3 text-center w-10 uppercase text-[11px]">S.N.</th>
                      <th className="py-2 px-3 uppercase text-[11px]">PARTICULAR</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px]">SHAREHOLDERS</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px]">KITTA</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px]">{agmSummary.detectedBonusRate ? `BONUS ${agmSummary.detectedBonusRate}%` : "BONUS"}</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px] bg-emerald-100/70 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200">AFTER BONUS KITTA</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px]">GROSS DIVIDEND</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px]">DIV_TAX</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px] bg-emerald-100/70 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200">NET DIVIDEND</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px]">COMPOSITION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono">
                    {agmSummary.rows.map((row) => (
                      <tr key={row.particular} className="hover:bg-muted/30 transition-colors divide-x divide-border">
                        <td className="py-2 px-3 text-center text-muted-foreground">{row.sn}</td>
                        <td className="py-2 px-3 font-semibold font-sans">{row.particular}</td>
                        <td className="py-2 px-3 text-right">{fmtNr(row.shareholderCount)}</td>
                        <td className="py-2 px-3 text-right font-medium">{fmtNr(row.kitta)}</td>
                        <td className="py-2 px-3 text-right">{fmtNr(row.issuedBonus)}</td>
                        <td className="py-2 px-3 text-right font-semibold bg-emerald-50/70 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200">{fmtNr(row.afterBonusKitta)}</td>
                        <td className="py-2 px-3 text-right font-medium">{fmtNr(row.grossDividend)}</td>
                        <td className="py-2 px-3 text-right">{fmtNr(row.divTax)}</td>
                        <td className="py-2 px-3 text-right font-bold bg-emerald-50/70 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200">{fmtNr(row.netDividend)}</td>
                        <td className="py-2 px-3 text-right font-sans font-medium">{row.composition.toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/90 font-bold border-t-2 border-b-2 border-foreground/30 divide-x divide-border font-mono">
                      <td className="py-2 px-3 text-center"></td>
                      <td className="py-2 px-3 font-sans uppercase">TOTAL</td>
                      <td className="py-2 px-3 text-right">{fmtNr(agmSummary.total.shareholderCount)}</td>
                      <td className="py-2 px-3 text-right">{fmtNr(agmSummary.total.kitta)}</td>
                      <td className="py-2 px-3 text-right">{fmtNr(agmSummary.total.issuedBonus)}</td>
                      <td className="py-2 px-3 text-right bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-200">{fmtNr(agmSummary.total.afterBonusKitta)}</td>
                      <td className="py-2 px-3 text-right">{fmtNr(agmSummary.total.grossDividend)}</td>
                      <td className="py-2 px-3 text-right">{fmtNr(agmSummary.total.divTax)}</td>
                      <td className="py-2 px-3 text-right bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-200">{fmtNr(agmSummary.total.netDividend)}</td>
                      <td className="py-2 px-3 text-right font-sans">{agmSummary.total.composition.toFixed(2)}%</td>
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Debenture Summary Preview */}
          {debentureSummary && debentureSummary.rows.length > 0 && (
            <Card className="border-primary/20 shadow-sm">
              <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Coins className="h-4 w-4 text-primary" />
                    Debenture Interest Distribution Summary (Pumori Format)
                    <Badge variant="outline" className="font-mono text-[11px] ml-1">
                      {debentureSummary.companyCode || "All"} {debentureSummary.fiscalYear ? `— FY ${debentureSummary.fiscalYear}` : ""}
                    </Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Public (6% TDS), Institution (15% TDS), and Tax Exempted (0% TDS) debenture coupon calculation.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => DebentureSummaryReportService.exportToExcel(debentureSummary)}>
                    <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                    Excel
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => DebentureSummaryReportService.exportToPdf(debentureSummary)}>
                    <FileText className="mr-1.5 h-3.5 w-3.5 text-rose-600" />
                    PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-muted/80 text-foreground font-semibold border-b border-border divide-x divide-border">
                      <th className="py-2 px-3 uppercase text-[11px]">CATEGORY</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px]">KITTA</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px]">PRINCIPAL</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px]">INT. @ {debentureSummary.couponRate}%</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px]">INT. PER DAY</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px]">GROSS INTEREST</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px]">TAX</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px] bg-emerald-100/70 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200">NET PAYABLE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono">
                    {debentureSummary.rows.map((row) => (
                      <tr key={row.name} className="hover:bg-muted/30 transition-colors divide-x divide-border">
                        <td className="py-2 px-3 font-semibold font-sans">{row.name}</td>
                        <td className="py-2 px-3 text-right">{fmtNr(row.kitta)}</td>
                        <td className="py-2 px-3 text-right">{fmtNr(row.principalAmount)}</td>
                        <td className="py-2 px-3 text-right">{fmtNr(row.annualInterest)}</td>
                        <td className="py-2 px-3 text-right">{fmtNr(row.interestPerDay)}</td>
                        <td className="py-2 px-3 text-right font-medium">{fmtNr(row.grossInterest)}</td>
                        <td className="py-2 px-3 text-right">
                          {row.taxAmount > 0 ? (
                            <span>{fmtNr(row.taxAmount)} <span className="text-[10px] text-muted-foreground font-sans">({row.taxRatePercent}%)</span></span>
                          ) : (
                            <span className="text-muted-foreground font-sans">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-bold bg-emerald-50/70 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200">{fmtNr(row.netInterestPayable)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/90 font-bold border-t-2 border-b-2 border-foreground/30 divide-x divide-border font-mono">
                      <td className="py-2 px-3 font-sans uppercase">TOTAL</td>
                      <td className="py-2 px-3 text-right">{fmtNr(debentureSummary.total.kitta)}</td>
                      <td className="py-2 px-3 text-right">{fmtNr(debentureSummary.total.principalAmount)}</td>
                      <td className="py-2 px-3 text-right">{fmtNr(debentureSummary.total.annualInterest)}</td>
                      <td className="py-2 px-3 text-right">{fmtNr(debentureSummary.total.interestPerDay)}</td>
                      <td className="py-2 px-3 text-right">{fmtNr(debentureSummary.total.grossInterest)}</td>
                      <td className="py-2 px-3 text-right">{fmtNr(debentureSummary.total.taxAmount)}</td>
                      <td className="py-2 px-3 text-right bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-200">{fmtNr(debentureSummary.total.netInterestPayable)}</td>
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Mutual Fund Summary Preview */}
          {mfSummary.length > 0 && (
            <Card className="border-primary/20 shadow-sm">
              <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    Mutual Fund Distribution Summary (CDS Format)
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    CDS & Clearing format unitholder category distribution with unit counts and net dividends.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => SummaryReportService.exportMutualFundSummaryToExcel(mfSummary, `mutual_fund_summary_${selectedCompany?.company_code || "all"}`)}
                  >
                    <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                    Excel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => SummaryReportService.exportMutualFundSummaryToPdf(mfSummary, selectedCompany?.company_name || "RTARTS System")}
                  >
                    <FileText className="mr-1.5 h-3.5 w-3.5 text-rose-600" />
                    PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-muted/80 text-foreground font-semibold border-b border-border divide-x divide-border">
                      <th className="py-2 px-3 text-center w-10 uppercase text-[11px]">S.N.</th>
                      <th className="py-2 px-3 uppercase text-[11px]">TYPE</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px]">UNITHOLDERS</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px]">UNITS / KITTA</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px]">GROSS DIVIDEND</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px]">TAX</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px] bg-emerald-100/70 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200">NET DIVIDEND</th>
                      <th className="py-2 px-3 text-right uppercase text-[11px]">COMPOSITION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono">
                    {mfSummary.map((row) => (
                      <tr key={row.type} className="hover:bg-muted/30 transition-colors divide-x divide-border">
                        <td className="py-2 px-3 text-center text-muted-foreground">{row.sn}</td>
                        <td className="py-2 px-3 font-semibold font-sans">{row.type}</td>
                        <td className="py-2 px-3 text-right">{fmtNr(row.transaction_count)}</td>
                        <td className="py-2 px-3 text-right font-medium">{fmtNr(row.kitta)}</td>
                        <td className="py-2 px-3 text-right">{fmtNr(row.gross)}</td>
                        <td className="py-2 px-3 text-right">{fmtNr(row.tax)}</td>
                        <td className="py-2 px-3 text-right font-bold bg-emerald-50/70 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200">{fmtNr(row.net)}</td>
                        <td className="py-2 px-3 text-right font-sans font-medium">{(row.composition ?? 0).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/90 font-bold border-t-2 border-b-2 border-foreground/30 divide-x divide-border font-mono">
                      <td className="py-2 px-3 text-center"></td>
                      <td className="py-2 px-3 font-sans uppercase">TOTAL</td>
                      <td className="py-2 px-3 text-right">{fmtNr(mfTotal.transaction_count)}</td>
                      <td className="py-2 px-3 text-right">{fmtNr(mfTotal.kitta)}</td>
                      <td className="py-2 px-3 text-right">{fmtNr(mfTotal.gross)}</td>
                      <td className="py-2 px-3 text-right">{fmtNr(mfTotal.tax)}</td>
                      <td className="py-2 px-3 text-right bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-200">{fmtNr(mfTotal.net)}</td>
                      <td className="py-2 px-3 text-right font-sans">100.00%</td>
                    </tr>
                  </tfoot>
                </table>
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
                  <CardDescription>Official AGM distribution sheet matching regulatory RTA format.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => AgmDividendSummaryReportService.exportToExcel(agmSummary)}>
                    <FileSpreadsheet className="mr-1.5 h-4 w-4 text-emerald-600" /> Export Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => AgmDividendSummaryReportService.exportToPdf(agmSummary)}>
                    <FileText className="mr-1.5 h-4 w-4 text-rose-600" /> Export PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>S.N.</TableHead>
                      <TableHead>Category / Particular</TableHead>
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
                        <TableCell className="text-right font-medium text-emerald-600">{fmtNr(row.afterBonusKitta)}</TableCell>
                        <TableCell className="text-right">{format(row.grossDividend)}</TableCell>
                        <TableCell className="text-right text-amber-600">{format(row.divTax + row.bonTax)}</TableCell>
                        <TableCell className="text-right font-bold text-emerald-600">{format(row.netDividend)}</TableCell>
                        <TableCell className="text-right">{row.composition.toFixed(2)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
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
          {debentureSummary && debentureSummary.rows.length > 0 ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Debenture Interest Distribution Summary</CardTitle>
                  <CardDescription>Pumori banking & CDS format for Public, Institution, and Tax Exempted debentures.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => DebentureSummaryReportService.exportToExcel(debentureSummary)}>
                    <FileSpreadsheet className="mr-1.5 h-4 w-4 text-emerald-600" /> Export Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => DebentureSummaryReportService.exportToPdf(debentureSummary)}>
                    <FileText className="mr-1.5 h-4 w-4 text-rose-600" /> Export PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Holder Category</TableHead>
                      <TableHead className="text-right">Kitta</TableHead>
                      <TableHead className="text-right">Principal Amount</TableHead>
                      <TableHead className="text-right">Annual Int. @ {debentureSummary.couponRate}%</TableHead>
                      <TableHead className="text-right">Int. Per Day</TableHead>
                      <TableHead className="text-right">Gross Interest</TableHead>
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
                          {row.taxAmount > 0 ? `${format(row.taxAmount)} (${row.taxRatePercent}%)` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-bold text-emerald-600">{format(row.netInterestPayable)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
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
                    onClick={() => SummaryReportService.exportMutualFundSummaryToExcel(mfSummary, `mutual_fund_summary_${selectedCompany?.company_code || "all"}`)}
                  >
                    <FileSpreadsheet className="mr-1.5 h-4 w-4 text-emerald-600" /> Export Excel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => SummaryReportService.exportMutualFundSummaryToPdf(mfSummary, selectedCompany?.company_name || "RTARTS System")}
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
                      <TableHead>Type</TableHead>
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
                        <TableCell className="text-right text-amber-600">{format(row.tax)}</TableCell>
                        <TableCell className="text-right font-bold text-emerald-600">{format(row.net)}</TableCell>
                        <TableCell className="text-right">{(row.composition ?? 0).toFixed(2)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
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
                <p className="text-xs text-muted-foreground">Download transaction-level registers with BOID, bank account numbers, and tax rates.</p>
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
                    <div className="mt-4 flex gap-2 pt-2 border-t">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs flex-1"
                        disabled={activeExport === `${report.id}-xlsx`}
                        onClick={() => exportReport(report.id, "xlsx")}
                      >
                        <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                        Excel
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs flex-1"
                        disabled={activeExport === `${report.id}-pdf`}
                        onClick={() => exportReport(report.id, "pdf")}
                      >
                        <FileText className="mr-1.5 h-3.5 w-3.5 text-rose-600" />
                        PDF
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
                <p className="text-xs text-muted-foreground">Export system batch approvals, bank reconciliation discrepancies, and data uploads.</p>
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
                    <div className="mt-4 flex gap-2 pt-2 border-t">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs flex-1"
                        disabled={activeExport === `${report.id}-xlsx`}
                        onClick={() => exportReport(report.id, "xlsx")}
                      >
                        <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                        Excel
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs flex-1"
                        disabled={activeExport === `${report.id}-pdf`}
                        onClick={() => exportReport(report.id, "pdf")}
                      >
                        <FileText className="mr-1.5 h-3.5 w-3.5 text-rose-600" />
                        PDF
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
