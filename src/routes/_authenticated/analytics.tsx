import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Download, FileX2, RefreshCw, Search, X, Building2, Calendar, TrendingUp,
  ChevronLeft, ChevronRight, BarChart3, Layers, CheckCircle2, Clock, Eye
} from "lucide-react";
import { toast } from "sonner";
import { DataManagementService } from "@/lib/services/data-management.service";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/analytics")({
  component: AnalyticsPage,
});

import { formatCurrencyNPR as fmt, formatCount as fmtCount } from "@/lib/currency";

const PAGE_SIZE = 20;

function StatCard({
  title,
  value,
  icon: Icon,
  colorClass = "",
  subtitle,
}: {
  title: string;
  value: string;
  icon: React.ElementType;
  colorClass?: string;
  subtitle?: string;
}) {
  return (
    <Card className="relative overflow-hidden glass-card hover-lift">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
            <p className={`text-2xl font-bold tabular-nums ${colorClass}`}>{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className={`rounded-xl p-2.5 ${colorClass ? "bg-current/10" : "bg-muted"}`}>
            <Icon className={`h-5 w-5 ${colorClass || "text-muted-foreground"}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AnalyticsPage() {
  const [selectedFy, setSelectedFy] = useState<string>("all");
  const [selectedCompany, setSelectedCompany] = useState<string>("all");
  const [summarySearch, setSummarySearch] = useState<string>("");
  const [summaryPage, setSummaryPage] = useState<number>(1);

  const { data: companies = [] } = useQuery({
    queryKey: ["companies-lookup"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, company_code, company_name")
        .order("company_name");
      if (error) throw error;
      return data as { id: string; company_code: string; company_name: string }[];
    },
  });

  const { data: fiscalYears = [] } = useQuery({
    queryKey: ["distinct-fiscal-years"],
    staleTime: 5 * 60 * 1000,
    queryFn: () => DataManagementService.getDistinctFiscalYears(),
  });

  const { data: summary = [], isLoading: summaryLoading, refetch: refetchSummary } = useQuery({
    queryKey: ["company-fiscal-summary", selectedFy],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: () =>
      DataManagementService.getCompanyFiscalSummary(
        selectedFy !== "all" ? selectedFy : undefined
      ),
  });

  const filteredSummary = useMemo(() => {
    let data = summary;
    if (selectedCompany !== "all") {
      data = data.filter((s) => s.company_id === selectedCompany);
    }
    if (summarySearch.trim()) {
      const q = summarySearch.toLowerCase();
      data = data.filter(
        (s) =>
          s.company_name.toLowerCase().includes(q) ||
          s.company_code.toLowerCase().includes(q) ||
          s.fiscal_year.toLowerCase().includes(q)
      );
    }
    return data;
  }, [summary, selectedCompany, summarySearch]);

  const summaryPageCount = Math.max(1, Math.ceil(filteredSummary.length / PAGE_SIZE));
  const pagedSummary = filteredSummary.slice((summaryPage - 1) * PAGE_SIZE, summaryPage * PAGE_SIZE);

  const summaryStats = useMemo(() => {
    const totalCompanies = new Set(filteredSummary.map((s) => s.company_id)).size;
    const totalRecords = filteredSummary.reduce(
      (s, r) => s + r.dividend_count + r.interest_count + (r.mutual_fund_count || 0),
      0
    );
    const dividendGross = filteredSummary.reduce((s, r) => s + r.dividend_gross, 0);
    const interestGross = filteredSummary.reduce((s, r) => s + r.interest_gross, 0);
    const mutualFundGross = filteredSummary.reduce((s, r) => s + (r.mutual_fund_gross || 0), 0);
    const totalPaid = filteredSummary.reduce((s, r) => s + r.total_paid, 0);
    const totalPending = filteredSummary.reduce((s, r) => s + r.total_pending, 0);
    const totalGross = dividendGross + interestGross + mutualFundGross;
    return {
      totalCompanies,
      totalRecords,
      dividendGross,
      interestGross,
      mutualFundGross,
      totalGross,
      totalPaid,
      totalPending,
    };
  }, [filteredSummary]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Analytics & Fiscal Summaries"
        description="Comprehensive overview of companies, records, and overall payment statuses across Equity Dividends, Debentures, and Mutual Funds."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard title="Companies" value={summaryStats.totalCompanies.toString()} icon={Building2} />
        <StatCard title="Total Records" value={fmtCount(summaryStats.totalRecords)} icon={Layers} />
        <StatCard title="Equity Dividend" value={fmt(summaryStats.dividendGross)} icon={BarChart3} />
        <StatCard title="Debenture Interest" value={fmt(summaryStats.interestGross)} icon={TrendingUp} />
        <StatCard title="Mutual Fund" value={fmt(summaryStats.mutualFundGross)} icon={Layers} />
        <StatCard
          title="Total Paid"
          value={fmt(summaryStats.totalPaid)}
          icon={CheckCircle2}
          colorClass="text-emerald-600"
          subtitle={`Pending: NPR ${fmt(summaryStats.totalPending)}`}
        />
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Company × Fiscal Year Breakdown</CardTitle>
              <CardDescription>
                {filteredSummary.length} fiscal summary record{filteredSummary.length !== 1 ? "s" : ""} across all instruments
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => refetchSummary()} disabled={summaryLoading}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${summaryLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={filteredSummary.length === 0}
                onClick={() => {
                  DataManagementService.exportCompanyFiscalToExcel(
                    filteredSummary,
                    `company_fiscal_summary${selectedFy !== "all" ? `_${selectedFy}` : ""}`
                  );
                  toast.success("Exported successfully");
                }}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export Excel
              </Button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search company or FY…"
                value={summarySearch}
                onChange={(e) => {
                  setSummarySearch(e.target.value);
                  setSummaryPage(1);
                }}
                className="pl-8 h-8 text-sm"
              />
              {summarySearch && (
                <button
                  onClick={() => {
                    setSummarySearch("");
                    setSummaryPage(1);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Select
              value={selectedFy}
              onValueChange={(v) => {
                setSelectedFy(v);
                setSummaryPage(1);
              }}
            >
              <SelectTrigger className="w-40 h-8 text-sm">
                <Calendar className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All fiscal years" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All fiscal years</SelectItem>
                {fiscalYears.map((fy) => (
                  <SelectItem key={fy} value={fy}>
                    {fy}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={selectedCompany}
              onValueChange={(v) => {
                setSelectedCompany(v);
                setSummaryPage(1);
              }}
            >
              <SelectTrigger className="w-56 h-8 text-sm">
                <Building2 className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All companies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.company_code} — {c.company_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-6">Company</TableHead>
                  <TableHead>FY</TableHead>
                  <TableHead className="text-right">Div. Count</TableHead>
                  <TableHead className="text-right">Div. Gross</TableHead>
                  <TableHead className="text-right">Int. Count</TableHead>
                  <TableHead className="text-right">Int. Gross</TableHead>
                  <TableHead className="text-right">MF Count</TableHead>
                  <TableHead className="text-right">MF Gross</TableHead>
                  <TableHead className="text-right text-emerald-600">Paid</TableHead>
                  <TableHead className="text-right text-amber-600">Pending</TableHead>
                  <TableHead className="pr-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaryLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 11 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className="h-4 rounded bg-muted animate-pulse" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : pagedSummary.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="py-16 text-center text-muted-foreground">
                      <FileX2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">No data found matching your filters.</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedSummary.map((row) => (
                    <TableRow key={`${row.company_id}|${row.fiscal_year}`} className="group hover:bg-muted/40">
                      <TableCell className="pl-6">
                        <div>
                          <span className="font-medium text-sm">{row.company_name}</span>
                          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground bg-muted px-1 rounded">
                            {row.company_code}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {row.fiscal_year}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{fmtCount(row.dividend_count)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-medium">{fmt(row.dividend_gross)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{fmtCount(row.interest_count)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-medium">{fmt(row.interest_gross)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{fmtCount(row.mutual_fund_count)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-medium">{fmt(row.mutual_fund_gross)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-bold text-emerald-600">
                        {fmt(row.total_paid)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-bold text-amber-600">
                        {fmt(row.total_pending)}
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <Link to="/data-management" search={{ companyId: row.company_id, fy: row.fiscal_year }}>
                          <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {summaryPageCount > 1 && (
            <div className="flex items-center justify-between border-t px-6 py-3">
              <p className="text-xs text-muted-foreground">
                Page {summaryPage} of {summaryPageCount} · {filteredSummary.length} rows
              </p>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={summaryPage <= 1}
                  onClick={() => setSummaryPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={summaryPage >= summaryPageCount}
                  onClick={() => setSummaryPage((p) => Math.min(summaryPageCount, p + 1))}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}