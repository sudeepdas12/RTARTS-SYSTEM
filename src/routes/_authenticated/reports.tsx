import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Building2, Download, FileSpreadsheet, FileText, RefreshCw, Users, Wallet } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { SummaryReportService } from "@/lib/services/summary-report.service";
import { ReportService, type ReportFilters } from "@/lib/services/report.service";
import { ExcelExporter } from "@/lib/excel-exporter";
import { PdfGenerator } from "@/lib/pdf-generator";
import { getPayeeCategoryLabel } from "@/lib/services/payable-summary";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reports")({ component: ReportsRoute });

type ReportId = "dividend_register" | "interest_register" | "mutual_fund_register" | "tax_register" | "pending_register" | "payment_register" | "reconciliation_report" | "upload_history_report";

const REPORTS: Array<{ id: ReportId; title: string; description: string; group: "Payables" | "Operations" }> = [
  { id: "dividend_register", title: "Dividend register", description: "Cash, stock, bonus, and right-share payable transactions.", group: "Payables" },
  { id: "interest_register", title: "Interest register", description: "Debenture interest due, tax, and payment status.", group: "Payables" },
  { id: "mutual_fund_register", title: "Mutual-fund register", description: "Unit-holder distributions and deductions.", group: "Payables" },
  { id: "tax_register", title: "Tax register", description: "Payable-level TDS for filing and review.", group: "Payables" },
  { id: "pending_register", title: "Pending payables", description: "Outstanding amounts awaiting payment or reconciliation.", group: "Payables" },
  { id: "payment_register", title: "Payment batches", description: "Payment-batch processing and approval totals.", group: "Operations" },
  { id: "reconciliation_report", title: "Reconciliation results", description: "Matched, partial, and unmatched payment reconciliation.", group: "Operations" },
  { id: "upload_history_report", title: "Upload history", description: "Imported files and processing outcomes.", group: "Operations" },
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
  const { data: companies = [] } = useQuery({ queryKey: ["report-companies"], queryFn: async () => {
    const { data, error } = await supabase.from("companies").select("id, company_name, company_code").order("company_name");
    if (error) throw error;
    return data || [];
  }});
  const filters: ReportFilters = useMemo(() => ({ companyId: companyId === "all" ? undefined : companyId }), [companyId]);
  const summary = useQuery({ queryKey: ["live-payable-summary", companyId], queryFn: () => SummaryReportService.getCompanySummary(filters) });
  const rows = summary.data || [];
  const totals = useMemo(() => rows.reduce((a, row) => ({ companies: a.companies + 1, count: a.count + row.total_count, gross: a.gross + row.total_gross, tax: a.tax + row.total_tax, net: a.net + row.total_net }), { companies: 0, count: 0, gross: 0, tax: 0, net: 0 }), [rows]);
  const categories = useMemo(() => {
    const result = new Map<string, { count: number; gross: number; tax: number; net: number }>();
    rows.forEach((row) => Object.entries(row.category_totals || {}).forEach(([key, value]) => {
      const current = result.get(key) || { count: 0, gross: 0, tax: 0, net: 0 };
      current.count += value.transactionCount; current.gross += value.grossPayable; current.tax += value.tax; current.net += value.netPayable; result.set(key, current);
    }));
    return [...result.entries()].map(([category, value]) => ({ category, ...value })).sort((a, b) => b.net - a.net);
  }, [rows]);
  const format = (value: number) => `NPR ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fetchReport = (id: ReportId) => ({ dividend_register: ReportService.getDividendRegister, interest_register: ReportService.getInterestRegister, mutual_fund_register: ReportService.getMutualFundRegister, tax_register: ReportService.getTaxRegister, pending_register: ReportService.getPendingPayments, payment_register: ReportService.getPaymentRegister, reconciliation_report: ReportService.getReconciliationReport, upload_history_report: ReportService.getUploadHistoryReport }[id])(filters);
  const exportReport = async (id: ReportId, kind: "xlsx" | "pdf") => {
    setActiveExport(`${id}-${kind}`);
    try {
      const data = await fetchReport(id);
      if (!data.length) { toast.info("No real records match the selected company."); return; }
      if (kind === "xlsx") ExcelExporter.exportToExcel(data as any[], REPORTS.find((report) => report.id === id)?.title || id);
      else PdfGenerator.generate({ title: REPORTS.find((report) => report.id === id)?.title || id, companyName: "RTARTS System", generatedBy: "System" }, REPORT_COLUMNS[id], data as unknown as Record<string, unknown>[]);
      toast.success(`${data.length} record(s) exported.`);
    } catch (error) { console.error(error); toast.error("This report could not be loaded from the live system data."); }
    finally { setActiveExport(null); }
  };

  return <div className="space-y-6 p-6">
    <PageHeader title="Reports" description="Live payable, tax, payment, reconciliation, and upload reporting. Totals only use stored transactions." />
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-background to-background"><CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-end md:justify-between">
      <div className="space-y-1"><div className="flex items-center gap-2 text-primary"><BarChart3 className="h-5 w-5" /><span className="font-semibold">Reporting workspace</span></div><p className="text-sm text-muted-foreground">Choose a company to refresh every summary and export from the same live data set.</p></div>
      <div className="flex w-full gap-2 md:w-[360px]"><Select value={companyId} onValueChange={setCompanyId}><SelectTrigger><SelectValue placeholder="All companies" /></SelectTrigger><SelectContent><SelectItem value="all">All companies</SelectItem>{companies.map((company) => <SelectItem key={company.id} value={company.id}>{company.company_code} — {company.company_name}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" onClick={() => summary.refetch()}><RefreshCw className="h-4 w-4" /></Button></div>
    </CardContent></Card>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{[{ label: "Companies", value: totals.companies, icon: Building2 }, { label: "Transactions", value: totals.count, icon: FileText }, { label: "Gross payable", value: format(totals.gross), icon: Wallet }, { label: "Tax", value: format(totals.tax), icon: Download }, { label: "Net payable", value: format(totals.net), icon: Users }].map(({ label, value, icon: Icon }) => <Card key={label}><CardContent className="p-4"><div className="flex items-center justify-between text-muted-foreground"><span className="text-xs">{label}</span><Icon className="h-4 w-4" /></div><div className="mt-2 text-xl font-bold">{value}</div></CardContent></Card>)}</div>
    <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
      <Card><CardHeader><CardTitle>Company payable totals</CardTitle><CardDescription>Gross, tax, and net values from dividend, interest, and mutual-fund payables.</CardDescription></CardHeader><CardContent><div className="overflow-auto"><Table><TableHeader><TableRow><TableHead>Company</TableHead><TableHead className="text-right">Transactions</TableHead><TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Tax</TableHead><TableHead className="text-right">Net</TableHead></TableRow></TableHeader><TableBody>{summary.isLoading ? <TableRow><TableCell colSpan={5} className="py-10 text-center">Loading live data…</TableCell></TableRow> : rows.length === 0 ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No payable records match this filter.</TableCell></TableRow> : rows.map((row) => <TableRow key={row.company_id}><TableCell><div className="font-medium">{row.company_name}</div><div className="text-xs text-muted-foreground">{row.company_code}</div></TableCell><TableCell className="text-right">{row.total_count}</TableCell><TableCell className="text-right">{format(row.total_gross)}</TableCell><TableCell className="text-right">{format(row.total_tax)}</TableCell><TableCell className="text-right font-semibold">{format(row.total_net)}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>
      <Card><CardHeader><CardTitle>Classification & segment totals</CardTitle><CardDescription>Rows marked Review Required need master-data confirmation before tax processing.</CardDescription></CardHeader><CardContent><div className="space-y-3">{categories.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No classified payable data.</p> : categories.map((row) => <div key={row.category} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><Badge variant={row.category === "UNCLASSIFIED" ? "destructive" : "secondary"}>{getPayeeCategoryLabel(row.category)}</Badge><span className="text-xs text-muted-foreground">{row.count} transactions</span></div><div className="mt-2 grid grid-cols-3 gap-2 text-xs"><span>Gross<br /><strong>{format(row.gross)}</strong></span><span>Tax<br /><strong>{format(row.tax)}</strong></span><span>Net<br /><strong>{format(row.net)}</strong></span></div></div>)}</div></CardContent></Card>
    </div>
    {(["Payables", "Operations"] as const).map((group) => <section key={group} className="space-y-3"><div><h2 className="text-lg font-semibold">{group} exports</h2><p className="text-sm text-muted-foreground">Exports query current database records, not sample data.</p></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{REPORTS.filter((report) => report.group === group).map((report) => <Card key={report.id} className="transition-colors hover:border-primary/50"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{report.title}</h3><p className="mt-1 text-sm text-muted-foreground">{report.description}</p></div><FileText className="h-5 w-5 text-primary" /></div><div className="mt-4 flex gap-2"><Button size="sm" variant="outline" disabled={activeExport === `${report.id}-xlsx`} onClick={() => exportReport(report.id, "xlsx")}><FileSpreadsheet className="mr-1 h-4 w-4" />Excel</Button><Button size="sm" variant="outline" disabled={activeExport === `${report.id}-pdf`} onClick={() => exportReport(report.id, "pdf")}><FileText className="mr-1 h-4 w-4" />PDF</Button></div></CardContent></Card>)}</div></section>)}
  </div>;
}
