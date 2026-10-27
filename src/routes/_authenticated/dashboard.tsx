import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, fetchAllRows } from "@/lib/services/database";
import { OperationalWorkflowHub } from "@/components/dashboard/operational-workflow-hub";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from "recharts";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
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

const STATUS_COLORS: Record<string, string> = {
  Paid: "#10b981", // Emerald
  Pending: "#f59e0b", // Amber
  Partial: "#3b82f6", // Blue
};

const SCOPE_STORAGE_KEY = "rtarts_dashboard_scope";

function Dashboard() {
  const qc = useQueryClient();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(SCOPE_STORAGE_KEY);
      if (saved) return JSON.parse(saved).companyId || "all";
    } catch (err) {
      console.debug("Scope storage read unavailable", err);
    }
    return "all";
  });
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(SCOPE_STORAGE_KEY);
      if (saved) return JSON.parse(saved).fiscalYear || "all";
    } catch (err) {
      console.debug("Scope FY storage read unavailable", err);
    }
    return "all";
  });
  const [dataAsOf, setDataAsOf] = useState<Date>(() => new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(
        SCOPE_STORAGE_KEY,
        JSON.stringify({ companyId: selectedCompanyId, fiscalYear: selectedFiscalYear }),
      );
    } catch (err) {
      console.debug("Scope storage write unavailable", err);
    }
  }, [selectedCompanyId, selectedFiscalYear]);

  const handleRefreshSnapshot = async () => {
    setIsRefreshing(true);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] }),
      qc.invalidateQueries({ queryKey: ["dashboard-operational-metrics"] }),
      qc.invalidateQueries({ queryKey: ["dashboard-companies"] }),
      qc.invalidateQueries({ queryKey: ["dashboard-fiscal-years"] }),
    ]);
    setDataAsOf(new Date());
    setIsRefreshing(false);
  };

  const { data: companies = [] } = useQuery({
    queryKey: ["dashboard-companies"],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("companies")
        .select("id, company_code, company_name")
        .order("company_name");
      return data || [];
    },
  });

  const { data: fiscalYears = [] } = useQuery({
    queryKey: ["dashboard-fiscal-years"],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("fiscal_years")
        .select("fiscal_year")
        .order("fiscal_year", { ascending: false });
      return (data || []).map((f) => f.fiscal_year);
    },
  });

  // Sanitize stored scope: if the saved company or fiscal year no longer exists, reset to "all"
  useEffect(() => {
    if (
      selectedCompanyId !== "all" &&
      companies.length > 0 &&
      !companies.some((c: any) => c.id === selectedCompanyId)
    ) {
      setSelectedCompanyId("all");
    }
  }, [companies, selectedCompanyId]);

  useEffect(() => {
    if (
      selectedFiscalYear !== "all" &&
      fiscalYears.length > 0 &&
      !fiscalYears.includes(selectedFiscalYear)
    ) {
      setSelectedFiscalYear("all");
    }
  }, [fiscalYears, selectedFiscalYear]);

  const { data: opMetrics } = useQuery({
    queryKey: ["dashboard-operational-metrics", selectedCompanyId],
    queryFn: async () => {
      let appQ = (supabase as any)
        .from("pending_approvals")
        .select("id", { count: "exact", head: true })
        .eq("status", "Pending");
      if (selectedCompanyId !== "all") appQ = appQ.eq("company_id", selectedCompanyId);
      const { count: pendingApprovals = 0 } = await appQ;

      let clientQ = (supabase as any)
        .from("clients")
        .select("id", { count: "exact", head: true })
        .or("bank_account_no.is.null,bank_account_no.eq.'',needs_review.eq.true");
      if (selectedCompanyId !== "all") clientQ = clientQ.eq("company_id", selectedCompanyId);
      const { count: dataQualityIssues = 0 } = await clientQ;

      let reconQ = (supabase as any)
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("status", "Pending");
      if (selectedCompanyId !== "all") reconQ = reconQ.eq("company_id", selectedCompanyId);
      const { count: unreconciledPending = 0 } = await reconQ;

      let batchQ = (supabase as any)
        .from("payment_batches")
        .select("id", { count: "exact", head: true })
        .in("status", ["Draft", "Pending_Approval"]);
      if (selectedCompanyId !== "all") batchQ = batchQ.eq("company_id", selectedCompanyId);
      const { count: batchesPending = 0 } = await batchQ;

      return {
        pendingApprovals: pendingApprovals || 0,
        dataQualityIssues: dataQualityIssues || 0,
        unreconciledPending: unreconciledPending || 0,
        batchesPending: batchesPending || 0,
      };
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  // Real-time live synchronization: invalidate dashboard queries immediately on database changes
  useEffect(() => {
    const channel = supabase
      .channel("dashboard-realtime-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "upload_history" }, () => {
        qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
        qc.invalidateQueries({ queryKey: ["dashboard-operational-metrics"] });
        qc.invalidateQueries({ queryKey: ["dashboard-companies"] });
        setDataAsOf(new Date());
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "dividend_payables" }, () => {
        qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
        qc.invalidateQueries({ queryKey: ["dashboard-operational-metrics"] });
        setDataAsOf(new Date());
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "interest_payables" }, () => {
        qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
        qc.invalidateQueries({ queryKey: ["dashboard-operational-metrics"] });
        setDataAsOf(new Date());
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mutual_fund_payables" },
        () => {
          qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
          qc.invalidateQueries({ queryKey: ["dashboard-operational-metrics"] });
          setDataAsOf(new Date());
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => {
        qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
        qc.invalidateQueries({ queryKey: ["dashboard-operational-metrics"] });
        setDataAsOf(new Date());
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "pending_approvals" }, () => {
        qc.invalidateQueries({ queryKey: ["dashboard-operational-metrics"] });
        qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
        setDataAsOf(new Date());
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const selectedCompany = companies.find((c: any) => c.id === selectedCompanyId);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-kpis", selectedCompanyId, selectedFiscalYear],
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      type Row = {
        net_payable: number | null;
        payment_status: string;
        paid_amount?: number | null;
      };

      let interestPending = 0;
      let interestPaid = 0;
      let interestPartial = 0;
      let totalInterest = 0;
      let dividendPending = 0;
      let dividendPaid = 0;
      let dividendPartial = 0;
      let totalDividend = 0;
      let mutualFundPending = 0;
      let mutualFundPaid = 0;
      let mutualFundPartial = 0;
      let totalMutualFund = 0;
      let totalDisbursed = 0;

      // 1. Attempt fast server-side aggregation via get_company_fiscal_summary_rpc
      let rpcSucceeded = false;
      try {
        const { data: summaryData, error: rpcErr } = await (supabase as any).rpc(
          "get_company_fiscal_summary_rpc",
          { p_fiscal_year: selectedFiscalYear === "all" ? null : selectedFiscalYear },
        );
        if (!rpcErr && Array.isArray(summaryData)) {
          const firstRow = summaryData[0];
          const hasBreakdown =
            summaryData.length === 0 ||
            (firstRow &&
              (firstRow.dividend_paid !== undefined ||
                firstRow.interest_paid !== undefined ||
                firstRow.mutual_fund_paid !== undefined));

          if (hasBreakdown) {
            const rpcRows =
              selectedCompanyId === "all"
                ? summaryData
                : summaryData.filter((r: any) => r.company_id === selectedCompanyId);

            for (const r of rpcRows) {
              dividendPaid += Number(r.dividend_paid || 0);
              dividendPending += Number(r.dividend_pending || 0);
              dividendPartial += Number(r.dividend_partial || 0);
              totalDividend += Number(r.dividend_net || 0);

              interestPaid += Number(r.interest_paid || 0);
              interestPending += Number(r.interest_pending || 0);
              interestPartial += Number(r.interest_partial || 0);
              totalInterest += Number(r.interest_net || 0);

              mutualFundPaid += Number(r.mutual_fund_paid || 0);
              mutualFundPending += Number(r.mutual_fund_pending || 0);
              mutualFundPartial += Number(r.mutual_fund_partial || 0);
              totalMutualFund += Number(r.mutual_fund_net || 0);

              totalDisbursed += Number(
                r.total_disbursed ??
                  Number(r.interest_disbursed || 0) +
                    Number(r.dividend_disbursed || 0) +
                    Number(r.mutual_fund_disbursed || 0),
              );
            }
            rpcSucceeded = true;
          }
        }
      } catch {
        rpcSucceeded = false;
      }

      // 2. Fast server-side fallback if get_company_fiscal_summary_rpc is unavailable
      if (!rpcSucceeded) {
        try {
          const compId = selectedCompanyId === "all" ? null : selectedCompanyId;
          const fy = selectedFiscalYear === "all" ? "all" : selectedFiscalYear;
          const [mfRes, divRes, intRes] = await Promise.all([
            (supabase as any).rpc("get_mutual_fund_payables_totals", {
              p_company_id: compId,
              p_fiscal_year: fy,
            }),
            (supabase as any).rpc("get_dividend_payables_totals", {
              p_company_id: compId,
              p_fiscal_year: fy,
            }),
            (supabase as any).rpc("get_interest_payables_totals", {
              p_company_id: compId,
              p_fiscal_year: fy,
            }),
          ]);

          if (mfRes.data) {
            mutualFundPaid = Number(mfRes.data.disbursed || 0);
            mutualFundPending = Number(mfRes.data.pendingCount > 0 ? mfRes.data.remaining || 0 : 0);
            mutualFundPartial = Number(mfRes.data.partialCount > 0 ? mfRes.data.remaining || 0 : 0);
            totalMutualFund = Number(mfRes.data.net || 0);
          }
          if (divRes.data) {
            dividendPaid = Number(divRes.data.disbursed || 0);
            dividendPending = Number(divRes.data.pendingCount > 0 ? divRes.data.remaining || 0 : 0);
            dividendPartial = Number(divRes.data.partialCount > 0 ? divRes.data.remaining || 0 : 0);
            totalDividend = Number(divRes.data.net || 0);
          }
          if (intRes.data) {
            interestPaid = Number(intRes.data.disbursed || 0);
            interestPending = Number(intRes.data.pendingCount > 0 ? intRes.data.remaining || 0 : 0);
            interestPartial = Number(intRes.data.partialCount > 0 ? intRes.data.remaining || 0 : 0);
            totalInterest = Number(intRes.data.net || 0);
          }
          totalDisbursed = mutualFundPaid + dividendPaid + interestPaid;
        } catch (e: any) {
          console.warn("Dashboard totals fallback error:", e?.message);
        }
      }

      let paymentsQ = (supabase as any)
        .from("payments")
        .select("id, net_amount, status, created_at")
        .order("created_at", { ascending: false })
        .limit(5);
      if (selectedCompanyId !== "all") paymentsQ = paymentsQ.eq("company_id", selectedCompanyId);

      const uploadsQ = (supabase as any)
        .from("upload_history")
        .select("id, file_name, status, created_at")
        .order("created_at", { ascending: false })
        .limit(5);

      let reconciliationsQ = (supabase as any)
        .from("reconciliation_results")
        .select("id, result, created_at")
        .order("created_at", { ascending: false })
        .limit(5);
      if (selectedCompanyId !== "all")
        reconciliationsQ = reconciliationsQ.eq("company_id", selectedCompanyId);

      let batchesQ = (supabase as any)
        .from("payment_batches")
        .select("id, batch_name, status, total_amount, created_at")
        .order("created_at", { ascending: false })
        .limit(5);
      if (selectedCompanyId !== "all") batchesQ = batchesQ.eq("company_id", selectedCompanyId);

      let bankTotalQ = (supabase as any)
        .from("reconciliation_results")
        .select("id", { count: "exact", head: true });
      let bankReconciledQ = (supabase as any)
        .from("reconciliation_results")
        .select("id", { count: "exact", head: true })
        .eq("result", "Matched");
      let clientsQ = (supabase.from("clients") as any).select("id", { count: "exact", head: true });
      let reviewPendingQ = (supabase as any)
        .from("clients")
        .select("id", { count: "exact", head: true })
        .or("classification_status.eq.REVIEW_REQUIRED,payee_classification.eq.UNCLASSIFIED");

      if (selectedCompanyId !== "all") {
        bankTotalQ = bankTotalQ.eq("company_id", selectedCompanyId);
        bankReconciledQ = bankReconciledQ.eq("company_id", selectedCompanyId);
        clientsQ = clientsQ.eq("company_id", selectedCompanyId);
        reviewPendingQ = reviewPendingQ.eq("company_id", selectedCompanyId);
      }

      const requests = [
        supabase.from("companies").select("id", { count: "exact", head: true }),
        clientsQ,
        reviewPendingQ,
        bankTotalQ,
        bankReconciledQ,
        supabase
          .from("pending_approvals")
          .select("id", { count: "exact", head: true })
          .eq("status", "Pending"),
        paymentsQ,
        uploadsQ,
        reconciliationsQ,
        batchesQ,
      ];

      const [
        companies,
        clients,
        reviewPending,
        bankTotal,
        bankReconciled,
        approvals,
        payments,
        uploads,
        reconciliations,
        batches,
      ] = await Promise.all(requests);

      return {
        companies: companies.count ?? 0,
        clients: clients.count ?? 0,
        interestPending,
        interestPaid,
        interestPartial,
        dividendPending,
        dividendPaid,
        dividendPartial,
        mutualFundPending,
        mutualFundPaid,
        mutualFundPartial,
        totalInterest,
        totalDividend,
        totalMutualFund,
        totalDisbursed,
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

  const totalPaid =
    (data?.interestPaid ?? 0) + (data?.dividendPaid ?? 0) + (data?.mutualFundPaid ?? 0);
  const totalPartial =
    (data?.interestPartial ?? 0) + (data?.dividendPartial ?? 0) + (data?.mutualFundPartial ?? 0);
  const totalAll =
    (data?.totalInterest ?? 0) + (data?.totalDividend ?? 0) + (data?.totalMutualFund ?? 0);
  const totalDisbursed = (data?.totalDisbursed ?? 0) > 0 ? (data?.totalDisbursed ?? 0) : totalPaid;
  const totalPending = Math.max(0, totalAll - totalDisbursed);
  const disbursementProgress =
    totalAll > 0 ? Math.min(100, Math.round((totalDisbursed / totalAll) * 100)) : 0;
  const paymentProgress = totalAll > 0 ? Math.round((totalPaid / totalAll) * 100) : 0;
  const bankReconciledPct =
    (data?.bankTotal ?? 0) > 0
      ? Math.round(((data?.bankReconciled ?? 0) / (data?.bankTotal ?? 1)) * 100)
      : 0;

  const kpis = [
    {
      title: "Companies",
      value: selectedCompany ? 1 : fmt(data?.companies ?? 0),
      icon: Building2,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-500/10 dark:bg-blue-950/40",
      trend: selectedCompany
        ? selectedCompany.company_code
        : `${fmt(data?.companies ?? 0)} registered`,
      trendUp: true,
      href: "/companies",
    },
    {
      title: "Clients",
      value: fmt(data?.clients ?? 0),
      icon: Users,
      color: "text-violet-600 dark:text-violet-400",
      bg: "bg-violet-500/10 dark:bg-violet-950/40",
      trend: `${fmt(data?.clients ?? 0)} shareholders`,
      trendUp: true,
      href: "/clients",
    },
    {
      title: "Total Payables",
      value: `₨ ${fmtCurrency(totalAll)}`,
      icon: Wallet,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-500/10 dark:bg-emerald-950/40",
      trend: `${disbursementProgress}% disbursed`,
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
      value: `${fmt(data?.bankReconciled ?? 0)}/${fmt(data?.bankTotal ?? 0)}`,
      icon: ArrowLeftRight,
      color: "text-cyan-600 dark:text-cyan-400",
      bg: "bg-cyan-500/10 dark:bg-cyan-950/40",
      trend: `${bankReconciledPct}% complete`,
      trendUp: bankReconciledPct > 50,
      href: "/reconciliation",
    },
    {
      title: "Classification Review",
      value: fmt(data?.reviewPending ?? 0),
      icon: ShieldCheck,
      color: "text-orange-600 dark:text-orange-400",
      bg: "bg-orange-500/10 dark:bg-orange-950/40",
      trend: data?.reviewPending ? `${fmt(data.reviewPending)} to review` : "All classified",
      trendUp: (data?.reviewPending ?? 0) === 0,
      href: "/classification-review",
    },
    {
      title: "Pending Approvals",
      value: fmt(data?.approvals ?? 0),
      icon: ClipboardCheck,
      color: "text-rose-600 dark:text-rose-400",
      bg: "bg-rose-500/10 dark:bg-rose-950/40",
      trend: data?.approvals ? `${fmt(data.approvals)} pending` : "No pending",
      trendUp: (data?.approvals ?? 0) === 0,
      href: "/approvals",
    },
  ];

  const chart = [
    {
      name: "Interest",
      Paid: data?.interestPaid ?? 0,
      Pending: data?.interestPending ?? 0,
      Partial: data?.interestPartial ?? 0,
    },
    {
      name: "Dividend",
      Paid: data?.dividendPaid ?? 0,
      Pending: data?.dividendPending ?? 0,
      Partial: data?.dividendPartial ?? 0,
    },
    {
      name: "Mutual Fund",
      Paid: data?.mutualFundPaid ?? 0,
      Pending: data?.mutualFundPending ?? 0,
      Partial: data?.mutualFundPartial ?? 0,
    },
  ];

  const pieData = [
    { name: "Paid", value: totalPaid },
    { name: "Pending", value: totalPending },
    {
      name: "Partial",
      value:
        (data?.interestPartial ?? 0) +
        (data?.dividendPartial ?? 0) +
        (data?.mutualFundPartial ?? 0),
    },
  ].filter((d) => d.value > 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Completed":
      case "Paid":
      case "Matched":
      case "Approved":
        return (
          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800">
            {status}
          </Badge>
        );
      case "Pending":
      case "Processing":
        return (
          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800">
            {status}
          </Badge>
        );
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

      <OperationalWorkflowHub
        metrics={opMetrics}
        dataAsOf={dataAsOf}
        onRefresh={handleRefreshSnapshot}
        isRefreshing={isRefreshing}
        selectedCompanyName={selectedCompany?.company_name || "All Companies"}
        selectedFiscalYear={selectedFiscalYear === "all" ? "All Fiscal Years" : selectedFiscalYear}
      />

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
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {k.title}
                </CardTitle>
                <div className={`p-2 rounded-lg ${k.bg}`}>
                  <k.icon className={`h-4 w-4 ${k.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold tabular-nums">{isLoading ? "—" : k.value}</div>
                <div
                  className={`flex items-center gap-1 mt-1 text-[11px] ${k.trendUp ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
                >
                  {k.trendUp ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" />
                  )}
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
        <Card className="lg:col-span-1 min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Payables — Paid vs Pending vs Partial
            </CardTitle>
            <CardDescription>
              Distribution of interest and dividend payables by payment status
            </CardDescription>
          </CardHeader>
          <CardContent className="h-80 min-h-[320px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={280}>
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
                <Legend wrapperStyle={{ paddingTop: 8, fontSize: "12px" }} />
                <Bar dataKey="Paid" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar dataKey="Pending" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar dataKey="Partial" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Pie Chart */}
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Payment Status Distribution
            </CardTitle>
            <CardDescription>Overall payment completion status</CardDescription>
          </CardHeader>
          <CardContent className="h-80 min-h-[320px] min-w-0 flex flex-col justify-between">
            {pieData.length > 0 ? (
              <div className="w-full flex-1 min-h-[220px]">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
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
                        <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.name] || "#6b7280"} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => `₨ ${fmtCurrency(Number(v))}`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground text-sm gap-2">
                <Activity className="h-8 w-8 text-muted-foreground/40" />
                <span>No payment transactions recorded yet</span>
              </div>
            )}
            <div className="flex justify-center flex-wrap gap-4 pt-3 border-t">
              {pieData.length > 0 ? (
                pieData.map((d) => {
                  const pct = totalAll > 0 ? ((d.value / totalAll) * 100).toFixed(1) : "0";
                  return (
                    <div key={d.name} className="flex items-center gap-1.5 text-xs">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[d.name] || "#6b7280" }}
                      />
                      <span className="text-muted-foreground font-medium">
                        {d.name}: ₨ {fmtCurrency(d.value)}{" "}
                        <span className="text-muted-foreground/70">({pct}%)</span>
                      </span>
                    </div>
                  );
                })
              ) : (
                <span className="text-xs text-muted-foreground italic">
                  Data will populate automatically as disbursements are imported
                </span>
              )}
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
            <CardDescription className="text-xs">
              {selectedCompany ? selectedCompany.company_name : "System-wide all companies"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-muted-foreground">
                  {selectedCompany
                    ? `${selectedCompany.company_code} Funds Disbursed`
                    : "Funds Disbursed"}
                </span>
                <span className="font-semibold text-emerald-600">{disbursementProgress}%</span>
              </div>
              <Progress value={disbursementProgress} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-muted-foreground">Bank Reconciliation</span>
                <span className="font-medium">{bankReconciledPct}%</span>
              </div>
              <Progress value={bankReconciledPct} className="h-2" />
            </div>
            <div className="pt-2 border-t space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Disbursed</span>
                <span className="font-semibold text-emerald-600">
                  ₨ {fmtCurrency(totalDisbursed)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Fully Settled</span>
                <span className="font-medium text-emerald-700 dark:text-emerald-400">
                  ₨ {fmtCurrency(totalPaid)}
                </span>
              </div>
              {totalPartial > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">In Installments (Partial)</span>
                  <span className="font-semibold text-blue-600 dark:text-blue-400">
                    ₨ {fmtCurrency(totalPartial)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
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
              {isLoading ? (
                <div className="space-y-2 py-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (data?.recentPayments ?? []).length === 0 ? (
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
                        <p className="text-xs text-muted-foreground">
                          {p.created_at ? format(new Date(p.created_at), "dd MMM yyyy") : "—"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">
                        ₨ {fmtCurrency(Number(p.net_amount ?? 0))}
                      </p>
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
              {isLoading ? (
                <div className="space-y-2 py-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (data?.recentUploads ?? []).length === 0 &&
                (data?.recentBatches ?? []).length === 0 ? (
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
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(u.created_at), "dd MMM yyyy")}
                          </p>
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
                          <p className="text-xs text-muted-foreground">
                            ₨ {fmtCurrency(Number(b.total_amount ?? 0))}
                          </p>
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
                <p className="font-medium text-amber-800">
                  {data?.approvals} pending approval{data?.approvals === 1 ? "" : "s"}
                </p>
                <p className="text-sm text-amber-700/70">
                  Review and process pending approvals to keep workflows moving.
                </p>
              </div>
            </div>
            <Link to="/approvals">
              <Button
                size="sm"
                variant="outline"
                className="border-amber-300 text-amber-700 hover:bg-amber-100"
              >
                View Approvals
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
