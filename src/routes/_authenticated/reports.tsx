import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Building2, Download, FileText, RefreshCw, Users, Wallet } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase, fetchAllRows } from "@/lib/services/database";
import { SummaryReportService } from "@/lib/services/summary-report.service";
import { ReportService, type ReportFilters } from "@/lib/services/report.service";
import { ExcelExporter } from "@/lib/excel-exporter";
import { PdfGenerator } from "@/lib/pdf-generator";
import { DeclarationSummaryCard } from "@/components/declarations/declaration-summary-card";
import { AgmDividendSummaryReportService } from "@/lib/services/dividend-summary-report.service";
import { DebentureSummaryReportService } from "@/lib/services/debenture-summary-report.service";
import { IrdEtdsService } from "@/lib/services/ird-etds.service";
import { IpfService } from "@/lib/services/ipf.service";
import { loadTaxRules, getDebentureDisplayRates } from "@/lib/services/tax-rules.service";
import { ReportManagementCenter } from "@/components/reports/report-management-center";
import { RegisterViewerDialog } from "@/components/reports/register-viewer-dialog";
import { ReportsAllSummariesTab } from "@/components/reports/reports-all-tab";
import {
  ReportsAgmTab,
  ReportsDebentureTab,
  ReportsMutualFundTab,
} from "@/components/reports/reports-instrument-tabs";
import {
  ReportsIpfAgingTab,
  ReportsIrdEtdsTab,
  ReportsRegistersTab,
} from "@/components/reports/reports-statutory-tabs";
import {
  OPERATIONS_REPORTS,
  PAYABLE_REPORTS,
  REPORT_COLUMNS,
  formatReportCurrency,
  type ReportId,
} from "@/components/reports/reports-config";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reports")({ component: ReportsRoute });

function ReportsRoute() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("all");
  const [activeExport, setActiveExport] = useState<string | null>(null);
  const [exportRevision, setExportRevision] = useState(0);
  const [viewingReport, setViewingReport] = useState<ReportId | null>(null);

  const { data: companies = [] } = useQuery({
    queryKey: ["report-companies"],
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, company_name, company_code, fiscal_year")
        .order("company_name");
      if (error) throw error;
      return data || [];
    },
  });

  if (companyId !== "all" && companies.length > 0) {
    const exists = companies.some((c) => c.id === companyId);
    if (!exists) {
      setCompanyId("all");
    }
  }

  useEffect(() => {
    const channel = supabase
      .channel("reports-realtime-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "upload_history" }, () => {
        qc.invalidateQueries({ queryKey: ["report-companies"] });
        qc.invalidateQueries({ queryKey: ["live-payable-summary"] });
        qc.invalidateQueries({ queryKey: ["agm-dividend-summary-report"] });
        qc.invalidateQueries({ queryKey: ["debenture-interest-summary-report"] });
        qc.invalidateQueries({ queryKey: ["mutual-fund-summary-report"] });
        qc.invalidateQueries({ queryKey: ["ird-annex-10-report"] });
        qc.invalidateQueries({ queryKey: ["sebon-ipf-aging-report"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "dividend_payables" }, () => {
        qc.invalidateQueries({ queryKey: ["live-payable-summary"] });
        qc.invalidateQueries({ queryKey: ["agm-dividend-summary-report"] });
        qc.invalidateQueries({ queryKey: ["ird-annex-10-report"] });
        qc.invalidateQueries({ queryKey: ["sebon-ipf-aging-report"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "interest_payables" }, () => {
        qc.invalidateQueries({ queryKey: ["live-payable-summary"] });
        qc.invalidateQueries({ queryKey: ["debenture-interest-summary-report"] });
        qc.invalidateQueries({ queryKey: ["ird-annex-10-report"] });
        qc.invalidateQueries({ queryKey: ["sebon-ipf-aging-report"] });
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mutual_fund_payables" },
        () => {
          qc.invalidateQueries({ queryKey: ["live-payable-summary"] });
          qc.invalidateQueries({ queryKey: ["mutual-fund-summary-report"] });
          qc.invalidateQueries({ queryKey: ["ird-annex-10-report"] });
          qc.invalidateQueries({ queryKey: ["sebon-ipf-aging-report"] });
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => {
        qc.invalidateQueries({ queryKey: ["live-payable-summary"] });
        qc.invalidateQueries({ queryKey: ["agm-dividend-summary-report"] });
        qc.invalidateQueries({ queryKey: ["debenture-interest-summary-report"] });
        qc.invalidateQueries({ queryKey: ["mutual-fund-summary-report"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

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

  const summary = useQuery({
    queryKey: ["live-payable-summary", companyId],
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
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

  const agmSummaryQuery = useQuery({
    queryKey: ["agm-dividend-summary-report", companyId],
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: () =>
      AgmDividendSummaryReportService.getCompanySummary(
        companyId === "all" ? undefined : companyId,
      ),
  });
  const agmSummary = agmSummaryQuery.data;

  const debentureSummaryQuery = useQuery({
    queryKey: ["debenture-interest-summary-report", companyId, taxRules],
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
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

  const mfSummaryQuery = useQuery({
    queryKey: ["mutual-fund-summary-report", companyId],
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: () => SummaryReportService.getMutualFundSummary({ companyId }),
  });
  const mfSummary = useMemo(() => mfSummaryQuery.data || [], [mfSummaryQuery.data]);

  const mfSchemesQuery = useQuery({
    queryKey: ["mutual-fund-schemes-summary"],
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: () => SummaryReportService.getMutualFundSchemesSummary(),
  });
  const mfSchemes = useMemo(() => mfSchemesQuery.data || [], [mfSchemesQuery.data]);
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

  const irdEtdsQuery = useQuery({
    queryKey: ["ird-annex-10-report", companyId],
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: () =>
      IrdEtdsService.getAnnex10Report({
        companyId: companyId === "all" ? undefined : companyId,
        maxPreviewRows: 50,
      }),
    enabled: companies.length > 0,
  });

  const ipfAgingQuery = useQuery({
    queryKey: ["sebon-ipf-aging-report", companyId],
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: () =>
      IpfService.getIpfAgingReport({
        companyId: companyId === "all" ? undefined : companyId,
        maxPreviewRows: 100,
      }),
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

  const exportReport = async (
    id: ReportId,
    kind: "xlsx" | "pdf",
    options?: { companyId?: string; search?: string },
  ) => {
    const targetCompanyId = options?.companyId !== undefined ? options.companyId : companyId;
    const targetSearch = options?.search;
    const targetCompany = companies.find((c) => c.id === targetCompanyId);
    const targetCompanyName =
      targetCompany?.company_name ||
      (targetCompanyId === "all" ? "Consolidated Portfolio (RMF1 & RMF2)" : "RTARTS System");

    const title = [...PAYABLE_REPORTS, ...OPERATIONS_REPORTS].find((r) => r.id === id)?.title || id;
    setActiveExport(`${id}-${kind}`);
    const toastId = toast.loading(
      `Preparing ${kind.toUpperCase()} export for ${title} (${targetCompanyName})...`,
    );
    try {
      const activeFilters: ReportFilters = {
        ...filters,
        companyId: targetCompanyId === "all" ? undefined : targetCompanyId,
      };

      if (kind === "pdf") {
        const MAX_PDF_ROWS = 3000;
        const result = await ReportService.getRegisterExportData(
          id,
          activeFilters,
          targetSearch,
          MAX_PDF_ROWS,
        );
        if (!result.rows || result.rows.length === 0) {
          toast.dismiss(toastId);
          toast.info(
            targetCompanyId !== "all"
              ? `No records found in ${title} matching ${targetCompanyName}.`
              : "No records currently found in the system for this register.",
          );
          return;
        }

        const subtitle = result.isTruncated
          ? `Displaying first ${result.rows.length.toLocaleString()} of ${result.totalCount.toLocaleString()} records — for complete register, use Excel`
          : targetCompanyId === "all"
            ? `Consolidated Register (${result.companyNames.join(", ")}) • ${result.totalCount.toLocaleString()} total records`
            : `Scheme / Company Register (${targetCompanyName}) • ${result.totalCount.toLocaleString()} total records`;

        await PdfGenerator.generate(
          {
            title,
            subtitle,
            companyName: targetCompanyName,
            generatedBy: "System",
          },
          REPORT_COLUMNS[id] || [],
          result.rows as unknown as Record<string, unknown>[],
        );
        const { data: authRes } = await supabase.auth.getUser();
        await (supabase as any).from("audit_logs").insert({
          user_id: authRes?.user?.id || null,
          action: "EXPORT_REPORT",
          table_name: "reports",
          record_id: id,
          new_value: {
            reportId: id,
            reportTitle: title,
            format: "PDF",
            companyId: targetCompanyId,
            companyName: targetCompanyName,
            rowCount: result.rows.length,
          },
        });
        setExportRevision((r) => r + 1);
        toast.dismiss(toastId);
        if (result.isTruncated) {
          toast.warning(
            `PDF generated for first ${result.rows.length.toLocaleString()} records. For complete export (${result.totalCount.toLocaleString()} rows), please download Excel.`,
          );
        } else {
          toast.success(
            `${result.rows.length.toLocaleString()} record(s) exported to PDF successfully.`,
          );
        }
      } else {
        const result = await ReportService.getRegisterExportData(id, activeFilters, targetSearch);
        if (!result.rows || result.rows.length === 0) {
          toast.dismiss(toastId);
          toast.info("No records found to export.");
          return;
        }
        ExcelExporter.exportToExcel(
          result.rows as any[],
          `${targetCompanyName.replace(/[^a-zA-Z0-9]/g, "_")}_${title.replace(/[^a-zA-Z0-9]/g, "_")}`,
        );
        const { data: authRes } = await supabase.auth.getUser();
        await (supabase as any).from("audit_logs").insert({
          user_id: authRes?.user?.id || null,
          action: "EXPORT_REPORT",
          table_name: "reports",
          record_id: id,
          new_value: {
            reportId: id,
            reportTitle: title,
            format: "XLSX",
            companyId: targetCompanyId,
            companyName: targetCompanyName,
            rowCount: result.rows.length,
          },
        });
        setExportRevision((r) => r + 1);
        toast.dismiss(toastId);
        toast.success(
          `Successfully exported ${result.rows.length.toLocaleString()} record(s) to Excel.`,
        );
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
    <div className="space-y-6">
      <PageHeader
        title="Reports & Distribution Summaries"
        description="Comprehensive AGM distributions, debenture interest summaries, mutual fund returns, and official registers."
      />

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
          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
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
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {Math.round(totals.count || 0).toLocaleString("en-IN")}
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card hover-lift min-w-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wide">Gross Payable</span>
              <Wallet className="h-4 w-4 text-primary shrink-0" />
            </div>
            <div className="mt-2 text-lg xl:text-xl font-bold tabular-nums break-words">
              {formatReportCurrency(totals.gross)}
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card hover-lift min-w-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wide">TDS Tax</span>
              <Download className="h-4 w-4 text-amber-600 shrink-0" />
            </div>
            <div className="mt-2 text-lg xl:text-xl font-bold tabular-nums break-words text-amber-600">
              {formatReportCurrency(totals.tax)}
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card hover-lift min-w-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wide">Net Payable</span>
              <Users className="h-4 w-4 text-emerald-600 shrink-0" />
            </div>
            <div className="mt-2 text-lg xl:text-xl font-bold tabular-nums break-words text-emerald-600">
              {formatReportCurrency(totals.net)}
            </div>
          </CardContent>
        </Card>
      </div>

      <ReportManagementCenter
        currentReportId="dividend_register"
        currentCompanyId={companyId}
        currentCompanyName={selectedCompany?.company_name || "All Companies (Consolidated)"}
        currentFiscalYear={
          selectedCompany?.fiscal_year ||
          companies.find((c) => c.fiscal_year)?.fiscal_year ||
          "All Fiscal Years"
        }
        dataAsOf={new Date()}
        refreshTrigger={exportRevision}
        onApplyPreset={(preset) => {
          if (preset.companyId) setCompanyId(preset.companyId);
          toast.success(`Applied report preset: ${preset.name}`);
        }}
      />

      <DeclarationSummaryCard companyId={companyId} />

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
            IRD Annex-10
          </TabsTrigger>
          <TabsTrigger value="ipf_aging" className="py-2 text-xs md:text-sm">
            SEBON IPF
          </TabsTrigger>
          <TabsTrigger value="registers" className="py-2 text-xs md:text-sm">
            Registers & Exports
          </TabsTrigger>
        </TabsList>

        <ReportsAllSummariesTab
          agmSummary={agmSummary}
          agmSummaryLoading={agmSummaryQuery.isLoading}
          debentureSummary={debentureSummary}
          debentureSummaryLoading={debentureSummaryQuery.isLoading}
          debDisplayRates={debDisplayRates}
          mfSummary={mfSummary}
          mfSummaryLoading={mfSummaryQuery.isLoading}
          mfTotal={mfTotal}
          mfSchemes={mfSchemes}
          selectedCompany={selectedCompany}
          companyId={companyId}
          isSummariesLoading={isSummariesLoading}
          hasAnySummaryData={hasAnySummaryData}
        />

        <ReportsAgmTab agmSummary={agmSummary} />

        <ReportsDebentureTab
          debentureSummary={debentureSummary}
          isLoading={debentureSummaryQuery.isLoading}
          onLogSummaryExport={async (reportId, reportTitle, format) => {
            try {
              const { data: authRes } = await supabase.auth.getUser();
              await (supabase as any).from("audit_logs").insert({
                user_id: authRes?.user?.id || null,
                action: "EXPORT_REPORT",
                table_name: "reports",
                record_id: reportId,
                new_value: {
                  reportId,
                  reportTitle,
                  format,
                  company: selectedCompany?.company_code || companyId,
                },
              });
              setExportRevision((v) => v + 1);
            } catch {
              // Non-blocking audit log
            }
          }}
        />

        <ReportsMutualFundTab
          companyId={companyId}
          mfSchemes={mfSchemes}
          mfSummary={mfSummary}
          mfTotal={mfTotal}
          selectedCompany={selectedCompany}
          onSelectCompanyAndView={(schemeCompanyId, reportId) => {
            setCompanyId(schemeCompanyId);
            setViewingReport(reportId);
          }}
          onExportReport={exportReport}
        />

        <ReportsRegistersTab
          activeExport={activeExport}
          onViewReport={setViewingReport}
          onExportReport={exportReport}
        />

        <ReportsIrdEtdsTab irdEtds={irdEtdsQuery.data} isLoading={irdEtdsQuery.isLoading} />

        <ReportsIpfAgingTab ipfReport={ipfAgingQuery.data} isLoading={ipfAgingQuery.isLoading} />
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
        filters={filters}
        companies={companies}
        open={!!viewingReport}
        onOpenChange={(isOpen) => !isOpen && setViewingReport(null)}
        fetchData={fetchReport}
        onExport={exportReport}
        isExporting={!!activeExport}
        onSelectReport={(newId) => setViewingReport(newId)}
      />
    </div>
  );
}
