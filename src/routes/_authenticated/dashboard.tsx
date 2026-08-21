import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase, fetchAllRows } from "@/lib/services/database";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Wallet,
  BarChart3,
  Building2,
  Users,
  ArrowLeftRight,
  ClipboardCheck,
  TrendingUp,
  TrendingDown,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  ShieldCheck,
  Upload,
  RefreshCw,
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, AreaChart, Area } from "recharts";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

/** Compact currency for chart axis ticks — Nepali units: Cr (crore = 10M), L (lakh = 100K) */
function fmtAxisTick(n: number) {
  if (n >= 10000000) {
    const cr = n / 10000000;
    return `${cr % 1 === 0 ? cr.toFixed(0) : cr.toFixed(1)}Cr`;
  }
  if (n >= 100000) {
    const l = n / 100000;
    return `${l % 1 === 0 ? l.toFixed(0) : l.toFixed(1)}L`;
  }
  if (n >= 1000) {
    const k = n / 1000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return String(n);
}

const PIE_COLORS = ["#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6"];

function Dashboard() {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("all");
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<string>("all");

  const { data: companies = [] } = useQuery({
    queryKey: ["dashboard-companies"],
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("id, company_code, company_name").order("company_name");
      return data || [];
    },
  });

  const { data: fiscalYears = [] } = useQuery({
    queryKey: ["dashboard-fiscal-years"],
    queryFn: async () => {
      const { data } = await supabase.from("fiscal_years").select("fiscal_year").order("fiscal_year", { ascending: false });
      return (data || []).map(f => f.fiscal_year);
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-kpis", selectedCompanyId, selectedFiscalYear],
    queryFn: async () => {
      type Row = { net_payable: number | null; payment_status: string };

      const [interestRows, dividendRows, mutualFundRows] = await Promise.all([
        fetchAllRows<Row>((from, to) => {
          let q = (supabase as any).from("interest_payables").select("net_payable, payment_status").range(from, to);
          if (selectedCompanyId !== "all") q = q.eq("company_id", selectedCompanyId);
          if (selectedFiscalYear !== "all") q = q.eq("fiscal_year", selectedFiscalYear);
          return q;
        }),
        fetchAllRows<Row>((from, to) => {
          let q = (supabase as any).from("dividend_payables").select("net_payable, payment_status").range(from, to);
          if (selectedCompanyId !== "all") q = q.eq("company_id", selectedCompanyId);
          if (selectedFiscalYear !== "all") q = q.eq("fiscal_year", selectedFiscalYear);
          return q;
        }),
        fetchAllRows<Row>((from, to) => {
          let q = (supabase as any).from("mutual_fund_payables").select("net_payable, payment_status").range(from, to);
          if (selectedCompanyId !== "all") q = q.eq("company_id", selectedCompanyId);
          if (selectedFiscalYear !== "all") q = q.eq("fiscal_year", selectedFiscalYear);
          return q;
        }),
      ]);

      const requests = [
        supabase.from("companies").select("id", { count: "exact", head: true }),
        supabase.from("clients").select("id", { count: "exact", head: true }),
        (supabase as any)
          .from("clients")
          .select("id", { count: "exact", head: true })
          .or("classification_status.eq.REVIEW_REQUIRED,payee_classification.eq.UNCLASSIFIED"),
        supabase.from("bank_transactions").select("id", { count: "exact", head: true }),
        supabase.from("bank_transactions").select("id", { count: "exact", head: true }).eq("is_reconciled", true),
        supabase.from("pending_approvals").select("id", { count: "exact", head: true }).eq("status", "Pending"),
        (supabase as any).from("payments").select("id, net_amount, status, created_at").order("created_at", { ascending: false }).limit(5),
        (supabase as any).from("upload_history").select("id, file_name, status, created_at").order("created_at", { ascending: false }).limit(5),
        (supabase as any).from("reconciliation_results").select("id, result, created_at").order("created_at", { ascending: false }).limit(5),
        (supabase as any).from("payment_batches").select("id, batch_name, status, total_amount, created_at").order("created_at", { ascending: false }).limit(5),
      ];

      const [companies, clients, reviewPending, bankTotal, bankReconciled, approvals, payments, uploads, reconciliations, batches] = await Promise.all(requests);

      const sum = (rows: Row[] | null, status: string) =>
        (rows ?? [])
          .filter((r) => r.payment_status === status)
          .reduce((a, r) => a + Number(r.net_payable ?? 0), 0);

      const totalInterest = interestRows.reduce((a, r) => a + Number(r.net_payable ?? 0), 0);
      const totalDividend = dividendRows.reduce((a, r) => a + Number(r.net_payable ?? 0), 0);
      const totalMutualFund = mutualFundRows.reduce((a, r) => a + Number(r.net_payable ?? 0), 0);

      return {
        companies: companies.count ?? 0,
        clients: clients.count ?? 0,
        interestPending: sum(interestRows, "Pending"),
        interestPaid: sum(interestRows, "Paid"),
        interestPartial: sum(interestRows, "Partial"),
        dividendPending: sum(dividendRows, "Pending"),
        dividendPaid: sum(dividendRows, "Paid"),
        dividendPartial: sum(dividendRows, "Partial"),
        mutualFundPending: sum(mutualFundRows, "Pending"),
        mutualFundPaid: sum(mutualFundRows, "Paid"),
        mutualFundPartial: sum(mutualFundRows, "Partial"),
        totalInterest,
        totalDividend,
        totalMutualFund,
        bankTotal: bankTotal.count ?? 0,
        bankReconciled: bankReconciled.count ?? 0,
        approvals: approvals.count ?? 0,
        reviewPending: reviewPending.count ?? 0,
        recentPayments: (payments.data as any[]) || [],
        recentUploads: (uploads.data as any[]) || [],
        recentReconciliations: (reconciliations.data as any[]) || [],
        recentBatches: (batches.data as any[]) || [],
      };
    },
    retry: 1,
    throwOnError: false,
  });

  const totalPending = (data?.interestPending ?? 0) + (data?.dividendPending ?? 0) + (data?.mutualFundPending ?? 0);
  const totalPaid = (data?.interestPaid ?? 0) + (data?.dividendPaid ?? 0) + (data?.mutualFundPaid ?? 0);
  const totalAll = (data?.totalInterest ?? 0) + (data?.totalDividend ?? 0) + (data?.totalMutualFund ?? 0);
  const paymentProgress = totalAll > 0 ? Math.round((totalPaid / totalAll) * 100) : 0;
  const bankReconciledPct = (data?.bankTotal ?? 0) > 0 ? Math.round(((data?.bankReconciled ?? 0) / (data?.bankTotal ?? 1)) * 100) : 0;

  const kpis = [
    {
      title: "Companies",
      value: data?.companies ?? 0,
      icon: Building2,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-500/10 dark:bg-blue-950/40",
      trend: `${data?.companies ?? 0} registered`,
      trendUp: true,
      href: "/companies",
    },
    {
      title: "Clients",
      value: data?.clients ?? 0,
      icon: Users,
      color: "text-violet-600 dark:text-violet-400",
      bg: "bg-violet-500/10 dark:bg-violet-950/40",
      trend: `${data?.clients ?? 0} shareholders`,
      trendUp: true,
      href: "/clients",
    },
    {
      title: "Total Payables",
      value: `₨ ${fmtCurrency(totalAll)}`,
      icon: Wallet,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-500/10 dark:bg-emerald-950/40",
      trend: `${paymentProgress}% paid`,
      trendUp: true,
      href: "/analytics",
    },
    {
      title: "Pending Payments",
      value: `₨ ${fmtCurrency(totalPending)}`,
      icon: Clock,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-500/10 dark:bg-amber-950/40",
      trend: `${totalPending > 0 ? "Needs attention" : "All clear"}`,
      trendUp: totalPending === 0,
      href: "/payments",
    },
    {
      title: "Bank Reconciled",
      value: `${data?.bankReconciled ?? 0}/${data?.bankTotal ?? 0}`,
      icon: ArrowLeftRight,
      color: "text-cyan-600 dark:text-cyan-400",
      bg: "bg-cyan-500/10 dark:bg-cyan-950/40",
      trend: `${bankReconciledPct}% complete`,
      trendUp: bankReconciledPct > 50,
      href: "/reconciliation",
    },
    {
      title: "Classification Review",
      value: data?.reviewPending ?? 0,
      icon: ShieldCheck,
      color: "text-orange-600 dark:text-orange-400",
      bg: "bg-orange-500/10 dark:bg-orange-950/40",
      trend: data?.reviewPending ? "Needs classification" : "All classified",
      trendUp: (data?.reviewPending ?? 0) === 0,
      href: "/classification-review",
    },
    {
      title: "Pending Approvals",
      value: data?.approvals ?? 0,
      icon: ClipboardCheck,
      color: "text-rose-600 dark:text-rose-400",
      bg: "bg-rose-500/10 dark:bg-rose-950/40",
      trend: data?.approvals ? "Action required" : "No pending",
      trendUp: (data?.approvals ?? 0) === 0,
      href: "/approvals",
    },
  ];

  const chart = [
    { name: "Interest", Paid: data?.interestPaid ?? 0, Pending: data?.interestPending ?? 0, Partial: data?.interestPartial ?? 0 },
    { name: "Dividend", Paid: data?.dividendPaid ?? 0, Pending: data?.dividendPending ?? 0, Partial: data?.dividendPartial ?? 0 },
    { name: "Mutual Fund", Paid: data?.mutualFundPaid ?? 0, Pending: data?.mutualFundPending ?? 0, Partial: data?.mutualFundPartial ?? 0 },
  ];

  const pieData = [
    { name: "Paid", value: totalPaid },
    { name: "Pending", value: totalPending },
    { name: "Partial", value: (data?.interestPartial ?? 0) + (data?.dividendPartial ?? 0) + (data?.mutualFundPartial ?? 0) },
  ].filter(d => d.value > 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Completed":
      case "Paid":
      case "Matched":
      case "Approved":
        return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800">{status}</Badge>;
      case "Pending":
      case "Processing":
        return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800">{status}</Badge>;
      case "Failed":
      case "Rejected":
      case "Missing":
        return <Badge variant="destructive">{status}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <PageHeader
          title="Dashboard"
          description="Live view of payables, reconciliation, payments, and approvals across the platform."
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
            <SelectTrigger className="w-48 h-9 text-xs">
              <SelectValue placeholder="All Companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.company_code} — {c.company_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedFiscalYear} onValueChange={setSelectedFiscalYear}>
            <SelectTrigger className="w-36 h-9 text-xs">
              <SelectValue placeholder="All Fiscal Years" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Fiscal Years</SelectItem>
              {fiscalYears.map((fy) => (
                <SelectItem key={fy} value={fy}>
                  {fy}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Link to="/upload">
            <Button size="sm" className="cursor-pointer h-9">
              <Upload className="w-4 h-4 mr-2" />
              Upload Data
            </Button>
          </Link>
          <Link to="/reconciliation">
            <Button size="sm" variant="outline" className="cursor-pointer h-9">
              <RefreshCw className="w-4 h-4 mr-2" />
              Reconcile
            </Button>
          </Link>
        </div>
      </div>

      {/* Quick Access Modules */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Link
          to="/dividend"
          className="group flex items-center gap-2.5 p-2.5 rounded-lg border bg-card/60 hover:bg-accent/40 transition-all hover-lift"
        >
          <div className="p-2 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-500 group-hover:text-white transition-colors">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">Stock Dividends</p>
            <p className="text-[10px] text-muted-foreground truncate">Cash & Bonus Shares</p>
          </div>
        </Link>
        <Link
          to="/interest"
          className="group flex items-center gap-2.5 p-2.5 rounded-lg border bg-card/60 hover:bg-accent/40 transition-all hover-lift"
        >
          <div className="p-2 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 group-hover:bg-blue-500 group-hover:text-white transition-colors">
            <Wallet className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">Debentures</p>
            <p className="text-[10px] text-muted-foreground truncate">Coupon & Interest</p>
          </div>
        </Link>
        <Link
          to="/mutual-fund"
          className="group flex items-center gap-2.5 p-2.5 rounded-lg border bg-card/60 hover:bg-accent/40 transition-all hover-lift"
        >
          <div className="p-2 rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400 group-hover:bg-violet-500 group-hover:text-white transition-colors">
            <BarChart3 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">Mutual Funds</p>
            <p className="text-[10px] text-muted-foreground truncate">Scheme Distributions</p>
          </div>
        </Link>
        <Link
          to="/reports"
          className="group flex items-center gap-2.5 p-2.5 rounded-lg border bg-card/60 hover:bg-accent/40 transition-all hover-lift"
        >
          <div className="p-2 rounded-md bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 group-hover:bg-cyan-500 group-hover:text-white transition-colors">
            <FileSpreadsheet className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">Regulatory Reports</p>
            <p className="text-[10px] text-muted-foreground truncate">CDS & AGM Summaries</p>
          </div>
        </Link>
        <Link
          to="/classification-review"
          className="group flex items-center gap-2.5 p-2.5 rounded-lg border bg-card/60 hover:bg-accent/40 transition-all hover-lift"
        >
          <div className="p-2 rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-400 group-hover:bg-orange-500 group-hover:text-white transition-colors">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">Tax Review</p>
            <p className="text-[10px] text-muted-foreground truncate">
              {data?.reviewPending ? `${data.reviewPending} pending` : "TDS Verified"}
            </p>
          </div>
        </Link>
        <Link
          to="/audit-logs"
          className="group flex items-center gap-2.5 p-2.5 rounded-lg border bg-card/60 hover:bg-accent/40 transition-all hover-lift"
        >
          <div className="p-2 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 group-hover:bg-rose-500 group-hover:text-white transition-colors">
            <Activity className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">Audit Trail</p>
            <p className="text-[10px] text-muted-foreground truncate">Compliance & Logs</p>
          </div>
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
        {kpis.map((k) => {
          const card = (
            <Card className="glass-card hover-lift h-full border border-border/80">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{k.title}</CardTitle>
                <div className={`p-2 rounded-lg ${k.bg}`}>
                  <k.icon className={`h-4 w-4 ${k.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold tabular-nums">
                  {isLoading ? "—" : k.value}
                </div>
                <div className={`flex items-center gap-1 mt-1 text-[11px] ${k.trendUp ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                  {k.trendUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {k.trend}
                </div>
              </CardContent>
            </Card>
          );
          return k.href ? (
            <Link key={k.title} to={k.href} className="block h-full cursor-pointer">
              {card}
            </Link>
          ) : (
            <div key={k.title} className="h-full">
              {card}
            </div>
          );
        })}
      </div>

      {/* Charts Row */}
      <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
        {/* Bar Chart */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Payables — Paid vs Pending vs Partial
            </CardTitle>
            <CardDescription>Distribution of interest and dividend payables by payment status</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  interval={0}
                  tickMargin={8}
                />
                <YAxis
                  width={60}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickFormatter={fmtAxisTick}
                />
                <Tooltip formatter={(v: any) => `₨ ${fmtCurrency(Number(v))}`} />
                <Bar dataKey="Paid" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar dataKey="Pending" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar dataKey="Partial" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Payment Status Distribution
            </CardTitle>
            <CardDescription>Overall payment completion status</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => `₨ ${fmtCurrency(Number(v))}`} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                No payment data available
              </div>
            )}
            <div className="flex justify-center gap-4 mt-2">
              {pieData.map((d, i) => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="text-muted-foreground">{d.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Progress + Recent Activity Row */}
      <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-3">
        {/* Payment Progress */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              Payment Completion
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-muted-foreground">Overall</span>
                <span className="font-medium">{paymentProgress}%</span>
              </div>
              <Progress value={paymentProgress} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-muted-foreground">Bank Reconciliation</span>
                <span className="font-medium">{bankReconciledPct}%</span>
              </div>
              <Progress value={bankReconciledPct} className="h-2" />
            </div>
            <div className="pt-2 border-t">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Paid</span>
                <span className="font-semibold text-emerald-600">₨ {fmtCurrency(totalPaid)}</span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span className="text-muted-foreground">Total Pending</span>
                <span className="font-semibold text-amber-600">₨ {fmtCurrency(totalPending)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recent Payments */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Wallet className="h-4 w-4 text-primary" />
              Recent Payments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(data?.recentPayments ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No recent payments</p>
              ) : (
                (data?.recentPayments ?? []).map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="p-1.5 rounded-md bg-emerald-50">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.id.slice(0, 8)}…</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(p.created_at), "dd MMM yyyy")}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">₨ {fmtCurrency(Number(p.net_amount ?? 0))}</p>
                      {getStatusBadge(p.status)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-primary" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(data?.recentUploads ?? []).length === 0 && (data?.recentBatches ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No recent activity</p>
              ) : (
                <>
                  {(data?.recentUploads ?? []).slice(0, 3).map((u: any) => (
                    <div key={u.id} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="p-1.5 rounded-md bg-blue-50">
                          <FileSpreadsheet className="h-3.5 w-3.5 text-blue-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{u.file_name}</p>
                          <p className="text-xs text-muted-foreground">{format(new Date(u.created_at), "dd MMM yyyy")}</p>
                        </div>
                      </div>
                      {getStatusBadge(u.status)}
                    </div>
                  ))}
                  {(data?.recentBatches ?? []).slice(0, 2).map((b: any) => (
                    <div key={b.id} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="p-1.5 rounded-md bg-violet-50">
                          <ShieldCheck className="h-3.5 w-3.5 text-violet-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{b.batch_name}</p>
                          <p className="text-xs text-muted-foreground">₨ {fmtCurrency(Number(b.total_amount ?? 0))}</p>
                        </div>
                      </div>
                      {getStatusBadge(b.status)}
                    </div>
                  ))}
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts Row */}
      {(data?.approvals ?? 0) > 0 && (
        <Card className="border-amber-200 bg-amber-50/60 dark:bg-amber-900/20">
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <div>
                <p className="font-medium text-amber-800">{data?.approvals} pending approval{data?.approvals === 1 ? "" : "s"}</p>
                <p className="text-sm text-amber-700/70">Review and process pending approvals to keep workflows moving.</p>
              </div>
            </div>
            <Link to="/approvals">
              <Button size="sm" variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-100">
                View Approvals
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}