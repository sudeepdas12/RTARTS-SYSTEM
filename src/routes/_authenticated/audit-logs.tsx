import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { AuditService, type AuditFieldDiff, type AuditUserProfile } from "@/lib/services/audit.service";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { format, subDays } from "date-fns";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck,
  History,
  Activity,
  AlertTriangle,
  Search,
  X,
  Download,
  Eye,
  RefreshCw,
  Server,
  ChevronLeft,
  ChevronRight,
  Filter,
  CheckCircle2,
  Lock,
  User,
  Coins,
  Users,
  CheckCheck,
  Building2,
  CreditCard,
  FileCode,
  Copy,
  Sparkles,
} from "lucide-react";
import { exportToExcel } from "@/lib/xlsx-utils";
import { toast } from "sonner";

type AuditLogRow = {
  id: string;
  action_time: string;
  action: string;
  table_name: string;
  record_id?: string | null;
  user_id?: string | null;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
};

type LoginLogRow = {
  id: string;
  user_id?: string | null;
  email?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  browser?: string | null;
  device?: string | null;
  login_status?: string | null;
  failure_reason?: string | null;
  login_time: string;
};

export const Route = createFileRoute("/_authenticated/audit-logs")({
  component: AuditLogsRoute,
});

const PAGE_SIZE = 25;

type DomainCategory = "ALL" | "PAYABLES" | "SHAREHOLDERS" | "RECONCILIATION" | "PAYMENTS" | "SYSTEM";
type DatePreset = "ALL" | "TODAY" | "7D" | "30D" | "CUSTOM";

const DOMAIN_TABLE_MAP: Record<DomainCategory, string[]> = {
  ALL: [],
  PAYABLES: ["dividend_payables", "interest_payables", "mutual_fund_payables", "payable_tax_rules"],
  SHAREHOLDERS: ["clients"],
  RECONCILIATION: ["reconciliation_results", "bank_statements", "bank_transactions"],
  PAYMENTS: ["payments", "payment_batches"],
  SYSTEM: ["companies", "system_settings", "profiles", "fiscal_years"],
};

function getTableIcon(table: string) {
  if (table.includes("payable") || table.includes("dividend") || table.includes("interest") || table.includes("mutual")) {
    return <Coins className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />;
  }
  if (table === "clients") {
    return <Users className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />;
  }
  if (table.includes("recon") || table.includes("bank")) {
    return <CheckCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />;
  }
  if (table.includes("payment")) {
    return <CreditCard className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />;
  }
  if (table === "companies") {
    return <Building2 className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />;
  }
  return <History className="h-3.5 w-3.5 text-muted-foreground" />;
}

function getTableCategoryBadge(table: string) {
  if (table === "dividend_payables") return <Badge variant="outline" className="text-[10px] bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800">Dividend</Badge>;
  if (table === "interest_payables") return <Badge variant="outline" className="text-[10px] bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800">Debenture</Badge>;
  if (table === "mutual_fund_payables") return <Badge variant="outline" className="text-[10px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">Mutual Fund</Badge>;
  if (table === "clients") return <Badge variant="outline" className="text-[10px] bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800">Shareholder</Badge>;
  if (table === "reconciliation_results") return <Badge variant="outline" className="text-[10px] bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-800">Reconciliation</Badge>;
  if (table === "payment_batches" || table === "payments") return <Badge variant="outline" className="text-[10px] bg-purple-50 dark:bg-purple-950/40 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-800">Payment</Badge>;
  if (table === "companies") return <Badge variant="outline" className="text-[10px] bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800">Company</Badge>;
  return <Badge variant="outline" className="text-[10px] font-mono">{table}</Badge>;
}

function formatValueForDisplay(val: any): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function AuditLogsRoute() {
  const [activeTab, setActiveTab] = useState("activity");

  // Activity Log filters
  const [activitySearch, setActivitySearch] = useState("");
  const [domainCategory, setDomainCategory] = useState<DomainCategory>("ALL");
  const [activityTable, setActivityTable] = useState("all");
  const [activityAction, setActivityAction] = useState("all");
  const [activityUser, setActivityUser] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [activityPage, setActivityPage] = useState(1);
  const [selectedLogDetail, setSelectedLogDetail] = useState<AuditLogRow | null>(null);
  const [detailModalTab, setDetailModalTab] = useState<"diff" | "raw">("diff");

  // Login Log filters
  const [loginSearch, setLoginSearch] = useState("");
  const [loginStatus, setLoginStatus] = useState("all");
  const [loginPage, setLoginPage] = useState(1);

  // Queries
  const { data: userProfiles = {}, isLoading: loadingProfiles } = useQuery({
    queryKey: ["audit-user-profiles"],
    queryFn: () => AuditService.getUserProfiles(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: auditLogs = [], isLoading: loadingAudit, refetch: refetchAudit } = useQuery({
    queryKey: ["audit-logs", activityTable, activityAction, activityUser, fromDate, toDate],
    queryFn: () => AuditService.getAuditLogs({
      limit: 2000,
      tableName: activityTable !== "all" ? activityTable : undefined,
      action: activityAction !== "all" ? activityAction : undefined,
      userId: activityUser !== "all" ? activityUser : undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    }),
  });

  const { data: loginLogs = [], isLoading: loadingLogins, refetch: refetchLogins } = useQuery({
    queryKey: ["login-logs"],
    queryFn: () => AuditService.getLoginLogs(200),
  });

  const { data: apiLogs = [], isLoading: loadingApi, refetch: refetchApi } = useQuery({
    queryKey: ["api-logs"],
    queryFn: () => AuditService.getApiLogs(100),
  });

  const { data: errorLogs = [], isLoading: loadingErrors, refetch: refetchErrors } = useQuery({
    queryKey: ["error-logs"],
    queryFn: () => AuditService.getErrorLogs(100),
  });

  // Distinct tables for Activity filter
  const tableNames = useMemo(() => {
    const set = new Set<string>();
    auditLogs.forEach((l: AuditLogRow) => {
      if (l.table_name) set.add(l.table_name);
    });
    return Array.from(set).sort();
  }, [auditLogs]);

  // Distinct actors
  const distinctUsers = useMemo(() => {
    const set = new Set<string>();
    auditLogs.forEach((l: AuditLogRow) => {
      if (l.user_id) set.add(l.user_id);
    });
    return Array.from(set).map(uid => ({
      id: uid,
      name: userProfiles[uid]?.full_name || `User (${uid.slice(0, 8)})`,
      email: userProfiles[uid]?.email || "",
    }));
  }, [auditLogs, userProfiles]);

  // Date Preset handler
  const handleDatePresetChange = (preset: DatePreset) => {
    setDatePreset(preset);
    setActivityPage(1);
    const now = new Date();
    if (preset === "TODAY") {
      const todayStr = format(now, "yyyy-MM-dd");
      setFromDate(todayStr);
      setToDate(todayStr);
    } else if (preset === "7D") {
      setFromDate(format(subDays(now, 7), "yyyy-MM-dd"));
      setToDate(format(now, "yyyy-MM-dd"));
    } else if (preset === "30D") {
      setFromDate(format(subDays(now, 30), "yyyy-MM-dd"));
      setToDate(format(now, "yyyy-MM-dd"));
    } else if (preset === "ALL") {
      setFromDate("");
      setToDate("");
    }
  };

  // Filtered Activity Logs
  const filteredAuditLogs = useMemo(() => {
    let list = auditLogs as AuditLogRow[];

    // Domain Category filter
    if (domainCategory !== "ALL") {
      const tablesInDomain = DOMAIN_TABLE_MAP[domainCategory];
      list = list.filter((l) => tablesInDomain.includes(l.table_name));
    }

    // Specific Table filter
    if (activityTable !== "all") {
      list = list.filter((l) => l.table_name === activityTable);
    }

    // Action filter
    if (activityAction !== "all") {
      list = list.filter((l) => l.action?.toUpperCase() === activityAction.toUpperCase());
    }

    // User filter
    if (activityUser !== "all") {
      list = list.filter((l) => l.user_id === activityUser);
    }

    // Keyword Search (searches table, action, record_id, user name, and payload text)
    if (activitySearch.trim()) {
      const q = activitySearch.toLowerCase();
      list = list.filter((l) => {
        const userName = l.user_id ? (userProfiles[l.user_id]?.full_name || "").toLowerCase() : "";
        const userEmail = l.user_id ? (userProfiles[l.user_id]?.email || "").toLowerCase() : "";
        const summary = AuditService.formatAuditSummary(l);
        const summaryText = `${summary.title} ${summary.subtitle || ""}`.toLowerCase();
        
        return (
          l.table_name?.toLowerCase().includes(q) ||
          l.action?.toLowerCase().includes(q) ||
          (l.record_id ?? "").toLowerCase().includes(q) ||
          userName.includes(q) ||
          userEmail.includes(q) ||
          summaryText.includes(q)
        );
      });
    }

    return list;
  }, [auditLogs, domainCategory, activityTable, activityAction, activityUser, activitySearch, userProfiles]);

  const activityPageCount = Math.max(1, Math.ceil(filteredAuditLogs.length / PAGE_SIZE));
  const pagedAuditLogs = filteredAuditLogs.slice(
    (activityPage - 1) * PAGE_SIZE,
    activityPage * PAGE_SIZE
  );

  // Filtered Login Logs
  const filteredLoginLogs = useMemo(() => {
    let list = loginLogs as LoginLogRow[];
    if (loginStatus !== "all") {
      list = list.filter((l) => l.login_status?.toLowerCase() === loginStatus.toLowerCase());
    }
    if (loginSearch.trim()) {
      const q = loginSearch.toLowerCase();
      list = list.filter(
        (l) =>
          l.email?.toLowerCase().includes(q) ||
          l.ip_address?.toLowerCase().includes(q) ||
          l.browser?.toLowerCase().includes(q) ||
          l.device?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [loginLogs, loginStatus, loginSearch]);

  const loginPageCount = Math.max(1, Math.ceil(filteredLoginLogs.length / PAGE_SIZE));
  const pagedLoginLogs = filteredLoginLogs.slice(
    (loginPage - 1) * PAGE_SIZE,
    loginPage * PAGE_SIZE
  );

  // KPI calculations
  const insertCount = useMemo(
    () => auditLogs.filter((l: AuditLogRow) => l.action?.toUpperCase() === "INSERT").length,
    [auditLogs]
  );
  const updateCount = useMemo(
    () => auditLogs.filter((l: AuditLogRow) => l.action?.toUpperCase() === "UPDATE").length,
    [auditLogs]
  );
  const deleteCount = useMemo(
    () => auditLogs.filter((l: AuditLogRow) => l.action?.toUpperCase() === "DELETE").length,
    [auditLogs]
  );

  const payableModCount = useMemo(
    () => auditLogs.filter((l: AuditLogRow) => l.table_name?.includes("payable") || l.table_name?.includes("dividend") || l.table_name?.includes("interest")).length,
    [auditLogs]
  );

  const overviewCards = [
    {
      title: "Total Audited Events",
      value: Number(auditLogs.length).toLocaleString(),
      subtitle: `${insertCount} Creations · ${updateCount} Updates`,
      icon: History,
      accent: "text-sky-600",
    },
    {
      title: "Critical Deletions",
      value: Number(deleteCount).toLocaleString(),
      subtitle: deleteCount > 0 ? "Restricted Admin operations" : "Zero deletions recorded",
      icon: AlertTriangle,
      accent: deleteCount > 0 ? "text-rose-600" : "text-emerald-600",
    },
    {
      title: "Payables & Payout Edits",
      value: Number(payableModCount).toLocaleString(),
      subtitle: "Dividend & Debenture modifications",
      icon: Coins,
      accent: "text-amber-600",
    },
    {
      title: "User Sign-Ins",
      value: String(loginLogs.length),
      subtitle: "Authenticated sessions tracked",
      icon: ShieldCheck,
      accent: "text-emerald-600",
    },
  ];

  const handleExportActivity = () => {
    if (filteredAuditLogs.length === 0) return;
    const rows = filteredAuditLogs.map((l) => {
      const summary = AuditService.formatAuditSummary(l);
      const actor = l.user_id ? userProfiles[l.user_id] : null;
      return {
        Timestamp: l.action_time,
        Action: l.action,
        Table: l.table_name,
        Summary: `${summary.title} | ${summary.subtitle || ""}`,
        Actor_Name: actor ? actor.full_name : "System / Automation",
        Actor_Email: actor ? actor.email : "",
        Record_ID: l.record_id || "",
        User_ID: l.user_id || "system",
        Old_Value: JSON.stringify(l.old_value ?? ""),
        New_Value: JSON.stringify(l.new_value ?? ""),
      };
    });
    exportToExcel(rows, `audit_activity_${new Date().toISOString().slice(0, 10)}`);
    toast.success("Enriched audit activity logs exported to Excel.");
  };

  const handleExportLogins = () => {
    if (filteredLoginLogs.length === 0) return;
    const rows = filteredLoginLogs.map((l) => ({
      Timestamp: l.login_time,
      Email: l.email || "Unknown",
      Status: l.login_status || "success",
      Failure_Reason: l.failure_reason || "None",
      IP_Address: l.ip_address || "",
      Browser: l.browser || "",
      Device: l.device || "",
      User_Agent: l.user_agent || "",
    }));
    exportToExcel(rows, `login_logs_${new Date().toISOString().slice(0, 10)}`);
    toast.success("Enriched login activity logs exported to Excel.");
  };

  const fieldDiffs: AuditFieldDiff[] = useMemo(() => {
    if (!selectedLogDetail) return [];
    return AuditService.calculateFieldDiffs(selectedLogDetail.old_value, selectedLogDetail.new_value);
  }, [selectedLogDetail]);

  const copyDetailPayload = () => {
    if (!selectedLogDetail) return;
    const payload = JSON.stringify({
      id: selectedLogDetail.id,
      timestamp: selectedLogDetail.action_time,
      action: selectedLogDetail.action,
      table: selectedLogDetail.table_name,
      record_id: selectedLogDetail.record_id,
      user: selectedLogDetail.user_id ? userProfiles[selectedLogDetail.user_id] : "system",
      old_value: selectedLogDetail.old_value,
      new_value: selectedLogDetail.new_value,
    }, null, 2);
    navigator.clipboard.writeText(payload);
    toast.success("Audit entry payload copied to clipboard.");
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Audit & Compliance Intelligence Center"
        description="Comprehensive immutable traceability of all database writes, payment lifecycle shifts, user actions, and system telemetry."
      />

      {/* KPI Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {overviewCards.map((card) => (
          <Card key={card.title} className="border border-border/80 bg-card/80 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {card.title}
                  </p>
                  <p className={`mt-1.5 text-2xl font-bold tabular-nums ${card.accent}`}>
                    {card.value}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{card.subtitle}</p>
                </div>
                <div className={`rounded-lg bg-muted p-2.5 ${card.accent}`}>
                  <card.icon className="h-4 w-4" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="h-10 bg-muted/60 p-1">
          <TabsTrigger value="activity" className="gap-2 text-xs md:text-sm">
            <History className="h-4 w-4" /> Modification History
            {auditLogs.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                {Number(auditLogs.length).toLocaleString()}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="logins" className="gap-2 text-xs md:text-sm">
            <ShieldCheck className="h-4 w-4" /> User Sign-Ins
            {loginLogs.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                {loginLogs.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="system" className="gap-2 text-xs md:text-sm">
            <Activity className="h-4 w-4" /> System Telemetry
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: DATABASE ACTIVITY LOGS */}
        <TabsContent value="activity" className="space-y-4">
          <Card className="border border-border/80 shadow-sm">
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">Audit Trace Log</CardTitle>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {filteredAuditLogs.length.toLocaleString()} matching records
                    </Badge>
                  </div>
                  <CardDescription className="mt-1">
                    Every create, update, and delete is recorded with the executing user, timestamp, and field-level diffs.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filteredAuditLogs.length === 0}
                    onClick={handleExportActivity}
                    className="h-8 text-xs cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />
                    Export Excel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchAudit()}
                    disabled={loadingAudit}
                    className="h-8 text-xs cursor-pointer"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingAudit ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>
              </div>

              {/* Domain Quick Category Chips */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">
                  Category:
                </span>
                {(
                  [
                    { id: "ALL", label: "All Entities", icon: Sparkles },
                    { id: "PAYABLES", label: "Payables & Dividends", icon: Coins },
                    { id: "SHAREHOLDERS", label: "Shareholders", icon: Users },
                    { id: "RECONCILIATION", label: "Reconciliation", icon: CheckCheck },
                    { id: "PAYMENTS", label: "Payments", icon: CreditCard },
                    { id: "SYSTEM", label: "System & Companies", icon: Building2 },
                  ] as const
                ).map((cat) => {
                  const Icon = cat.icon;
                  const isActive = domainCategory === cat.id;
                  return (
                    <Button
                      key={cat.id}
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      className={`h-7 px-2.5 text-xs gap-1.5 cursor-pointer ${
                        isActive ? "font-semibold" : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => {
                        setDomainCategory(cat.id);
                        setActivityTable("all");
                        setActivityPage(1);
                      }}
                    >
                      <Icon className="h-3 w-3" />
                      {cat.label}
                    </Button>
                  );
                })}
              </div>

              {/* Filter Controls Row */}
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                {/* Search Bar */}
                <div className="relative lg:col-span-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search shareholder, BOID, amount, table, actor…"
                    value={activitySearch}
                    onChange={(e) => {
                      setActivitySearch(e.target.value);
                      setActivityPage(1);
                    }}
                    className="pl-8 h-8 text-xs"
                  />
                  {activitySearch && (
                    <button
                      onClick={() => {
                        setActivitySearch("");
                        setActivityPage(1);
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Specific Table Filter */}
                <Select
                  value={activityTable}
                  onValueChange={(v) => {
                    setActivityTable(v);
                    setActivityPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <Filter className="h-3 w-3 mr-1 text-muted-foreground" />
                    <SelectValue placeholder="All Tables" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Specific Tables</SelectItem>
                    {tableNames.map((tbl) => (
                      <SelectItem key={tbl} value={tbl} className="text-xs">
                        {tbl}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Action Filter */}
                <Select
                  value={activityAction}
                  onValueChange={(v) => {
                    setActivityAction(v);
                    setActivityPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="All Actions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Actions</SelectItem>
                    <SelectItem value="INSERT">INSERT (Creations)</SelectItem>
                    <SelectItem value="UPDATE">UPDATE (Modifications)</SelectItem>
                    <SelectItem value="DELETE">DELETE (Deletions)</SelectItem>
                  </SelectContent>
                </Select>

                {/* User / Actor Filter */}
                <Select
                  value={activityUser}
                  onValueChange={(v) => {
                    setActivityUser(v);
                    setActivityPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <User className="h-3 w-3 mr-1 text-muted-foreground" />
                    <SelectValue placeholder="All Users" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Actors</SelectItem>
                    {distinctUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id} className="text-xs">
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date Presets Row */}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-[11px] text-muted-foreground mr-1">Timeframe:</span>
                {(
                  [
                    { id: "ALL", label: "All Time" },
                    { id: "TODAY", label: "Today" },
                    { id: "7D", label: "Last 7 Days" },
                    { id: "30D", label: "Last 30 Days" },
                    { id: "CUSTOM", label: "Custom Range" },
                  ] as const
                ).map((preset) => (
                  <Button
                    key={preset.id}
                    variant={datePreset === preset.id ? "secondary" : "ghost"}
                    size="sm"
                    className="h-6 px-2 text-[11px] cursor-pointer"
                    onClick={() => handleDatePresetChange(preset.id)}
                  >
                    {preset.label}
                  </Button>
                ))}

                {datePreset === "CUSTOM" && (
                  <div className="flex items-center gap-1.5 ml-2">
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => {
                        setFromDate(e.target.value);
                        setActivityPage(1);
                      }}
                      className="h-6 rounded border bg-background px-1.5 text-[11px] outline-none"
                    />
                    <span className="text-[11px] text-muted-foreground">to</span>
                    <input
                      type="date"
                      value={toDate}
                      onChange={(e) => {
                        setToDate(e.target.value);
                        setActivityPage(1);
                      }}
                      className="h-6 rounded border bg-background px-1.5 text-[11px] outline-none"
                    />
                  </div>
                )}
              </div>
            </CardHeader>

            <CardContent className="px-0 pb-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent bg-muted/40 text-xs">
                      <TableHead className="pl-6 w-[180px]">Timestamp</TableHead>
                      <TableHead className="w-[100px]">Action</TableHead>
                      <TableHead className="w-[150px]">Entity / Table</TableHead>
                      <TableHead className="min-w-[280px]">Descriptive Event Summary</TableHead>
                      <TableHead className="w-[180px]">Performed By</TableHead>
                      <TableHead className="pr-6 text-right w-[110px]">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingAudit ? (
                      Array.from({ length: 8 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 6 }).map((_, j) => (
                            <TableCell key={j}>
                              <div className="h-4 rounded bg-muted animate-pulse" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : pagedAuditLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-16 text-muted-foreground">
                          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-30 text-emerald-500" />
                          <p className="text-sm font-medium">No audit events match your selected filters.</p>
                          <p className="text-xs mt-1 text-muted-foreground">Try clearing filters or selecting another date range.</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      pagedAuditLogs.map((log: AuditLogRow) => {
                        const summary = AuditService.formatAuditSummary(log);
                        const actor = log.user_id ? userProfiles[log.user_id] : null;
                        const actorName = actor ? actor.full_name : log.user_id ? `User (${log.user_id.slice(0, 8)})` : "System / Automation";
                        const actUpper = log.action?.toUpperCase();

                        return (
                          <TableRow key={log.id} className="hover:bg-muted/40 transition-colors">
                            {/* Timestamp */}
                            <TableCell className="pl-6 text-xs text-muted-foreground font-mono whitespace-nowrap">
                              <div className="font-semibold text-foreground">
                                {format(new Date(log.action_time), "dd MMM yyyy")}
                              </div>
                              <div className="text-[11px] opacity-70">
                                {format(new Date(log.action_time), "HH:mm:ss")}
                              </div>
                            </TableCell>

                            {/* Action Badge */}
                            <TableCell>
                              <Badge
                                variant={
                                  actUpper === "INSERT"
                                    ? "default"
                                    : actUpper === "DELETE"
                                      ? "destructive"
                                      : "secondary"
                                }
                                className={`text-[10px] font-mono uppercase ${
                                  actUpper === "INSERT"
                                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                                    : actUpper === "UPDATE"
                                      ? "bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border-blue-200"
                                      : ""
                                }`}
                              >
                                {log.action}
                              </Badge>
                            </TableCell>

                            {/* Entity / Table */}
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                {getTableIcon(log.table_name)}
                                {getTableCategoryBadge(log.table_name)}
                              </div>
                            </TableCell>

                            {/* Smart Event Summary */}
                            <TableCell className="py-2.5">
                              <div className="font-medium text-xs text-foreground flex items-center gap-2">
                                <span>{summary.title}</span>
                              </div>
                              {summary.subtitle && (
                                <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[450px]">
                                  {summary.subtitle}
                                </p>
                              )}
                            </TableCell>

                            {/* Performed By */}
                            <TableCell className="text-xs">
                              <div className="flex items-center gap-1.5">
                                <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-[10px] uppercase shrink-0">
                                  {actorName.charAt(0)}
                                </div>
                                <div className="truncate">
                                  <div className="font-medium text-xs truncate" title={actorName}>
                                    {actorName}
                                  </div>
                                  {actor?.email && (
                                    <div className="text-[10px] text-muted-foreground truncate" title={actor.email}>
                                      {actor.email}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </TableCell>

                            {/* Actions */}
                            <TableCell className="pr-6 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1 cursor-pointer hover:bg-primary/10 hover:text-primary"
                                onClick={() => {
                                  setSelectedLogDetail(log);
                                  setDetailModalTab("diff");
                                }}
                              >
                                <Eye className="h-3 w-3" /> Inspect
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Bar */}
              {activityPageCount > 1 && (
                <div className="flex items-center justify-between border-t px-6 py-3">
                  <p className="text-xs text-muted-foreground">
                    Showing {(activityPage - 1) * PAGE_SIZE + 1}–{Math.min(activityPage * PAGE_SIZE, filteredAuditLogs.length)} of {filteredAuditLogs.length.toLocaleString()} events
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Page {activityPage} of {activityPageCount}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        disabled={activityPage <= 1}
                        onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        disabled={activityPage >= activityPageCount}
                        onClick={() => setActivityPage((p) => Math.min(activityPageCount, p + 1))}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: USER LOGIN LOGS */}
        <TabsContent value="logins" className="space-y-4">
          <Card className="border border-border/80 shadow-sm">
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">User Sign-In & Authentication Intelligence</CardTitle>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {filteredLoginLogs.length.toLocaleString()} authentication records
                    </Badge>
                  </div>
                  <CardDescription className="mt-1">
                    Complete traceability of authentication events, user principals, IP origins, browser devices, and failure diagnostics.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filteredLoginLogs.length === 0}
                    onClick={handleExportLogins}
                    className="h-8 text-xs cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />
                    Export Excel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchLogins()}
                    disabled={loadingLogins}
                    className="h-8 text-xs cursor-pointer"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingLogins ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>
              </div>

              {/* Controls */}
              <div className="mt-3 flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[240px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search email, name, IP address, browser, or failure reason…"
                    value={loginSearch}
                    onChange={(e) => {
                      setLoginSearch(e.target.value);
                      setLoginPage(1);
                    }}
                    className="pl-8 h-8 text-xs"
                  />
                  {loginSearch && (
                    <button
                      onClick={() => {
                        setLoginSearch("");
                        setLoginPage(1);
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <Select
                  value={loginStatus}
                  onValueChange={(v) => {
                    setLoginStatus(v);
                    setLoginPage(1);
                  }}
                >
                  <SelectTrigger className="w-44 h-8 text-xs">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Authentication Statuses</SelectItem>
                    <SelectItem value="success">Successful Sign-Ins (🟢)</SelectItem>
                    <SelectItem value="failed">Failed / Rejected Attempts (🔴)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>

            <CardContent className="px-0 pb-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent bg-muted/40 text-xs">
                      <TableHead className="pl-6 w-[240px]">User / Principal</TableHead>
                      <TableHead className="w-[180px]">Status & Diagnostics</TableHead>
                      <TableHead className="w-[180px]">Client & Device</TableHead>
                      <TableHead className="w-[160px]">IP Address Origin</TableHead>
                      <TableHead className="pr-6 text-right w-[180px]">Timestamp</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingLogins ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 5 }).map((_, j) => (
                            <TableCell key={j}>
                              <div className="h-4 rounded bg-muted animate-pulse" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : pagedLoginLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-16 text-muted-foreground">
                          <Lock className="h-8 w-8 mx-auto mb-2 opacity-30 text-muted-foreground" />
                          <p className="text-sm font-medium">No sign-in records found.</p>
                          <p className="text-xs mt-1 text-muted-foreground">Authentication attempts will be dynamically tracked here.</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      pagedLoginLogs.map((log: LoginLogRow) => {
                        const isSuccess = log.login_status?.toLowerCase() === "success";
                        const profile = log.user_id ? userProfiles[log.user_id] : null;
                        const displayName = profile?.full_name || log.email?.split("@")[0] || "User";

                        return (
                          <TableRow key={log.id} className="hover:bg-muted/40 transition-colors">
                            {/* User / Principal */}
                            <TableCell className="pl-6 text-xs">
                              <div className="flex items-center gap-2">
                                <div
                                  className={`h-7 w-7 rounded-full flex items-center justify-center font-bold text-[10px] uppercase shrink-0 ${
                                    isSuccess
                                      ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
                                      : "bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300"
                                  }`}
                                >
                                  {displayName.charAt(0)}
                                </div>
                                <div className="truncate">
                                  <div className="font-medium text-foreground truncate" title={displayName}>
                                    {displayName}
                                  </div>
                                  <div className="text-[11px] text-muted-foreground font-mono truncate" title={log.email || ""}>
                                    {log.email || "Unknown"}
                                  </div>
                                </div>
                              </div>
                            </TableCell>

                            {/* Status & Failure Diagnostics */}
                            <TableCell>
                              <div className="space-y-1">
                                <Badge
                                  variant={isSuccess ? "default" : "destructive"}
                                  className={`text-[10px] uppercase font-mono ${
                                    isSuccess
                                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                                      : "bg-rose-600 hover:bg-rose-700 text-white"
                                  }`}
                                >
                                  {isSuccess ? "Authenticated" : "Rejected"}
                                </Badge>
                                {log.failure_reason && (
                                  <p className="text-[11px] text-rose-600 dark:text-rose-400 font-medium">
                                    {log.failure_reason}
                                  </p>
                                )}
                              </div>
                            </TableCell>

                            {/* Client & Device */}
                            <TableCell className="text-xs">
                              <div className="font-medium text-foreground">
                                {log.browser || "Web Client"}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {log.device || "Desktop PC"}
                              </div>
                            </TableCell>

                            {/* IP Address */}
                            <TableCell className="text-xs font-mono text-muted-foreground">
                              <span className="bg-muted px-1.5 py-0.5 rounded text-[11px] border border-border/50">
                                {log.ip_address || "127.0.0.1"}
                              </span>
                            </TableCell>

                            {/* Timestamp */}
                            <TableCell className="pr-6 text-right text-xs text-muted-foreground font-mono whitespace-nowrap">
                              <div className="font-semibold text-foreground">
                                {log.login_time ? format(new Date(log.login_time), "dd MMM yyyy") : "—"}
                              </div>
                              <div className="text-[11px] opacity-70">
                                {log.login_time ? format(new Date(log.login_time), "HH:mm:ss") : ""}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {loginPageCount > 1 && (
                <div className="flex items-center justify-between border-t px-6 py-3">
                  <p className="text-xs text-muted-foreground">
                    Showing {(loginPage - 1) * PAGE_SIZE + 1}–{Math.min(loginPage * PAGE_SIZE, filteredLoginLogs.length)} of {filteredLoginLogs.length.toLocaleString()} sign-ins
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Page {loginPage} of {loginPageCount}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        disabled={loginPage <= 1}
                        onClick={() => setLoginPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        disabled={loginPage >= loginPageCount}
                        onClick={() => setLoginPage((p) => Math.min(loginPageCount, p + 1))}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════
            TAB 3: SYSTEM TELEMETRY & API TRACES
        ═══════════════════════════════════════════════════════ */}
        <TabsContent value="system" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* System Health */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Server className="h-4 w-4 text-emerald-600" /> Platform Infrastructure Status
                  </CardTitle>
                  <Badge variant="outline" className="text-emerald-600 border-emerald-300">
                    ONLINE
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Database Engine</span>
                  <span className="font-semibold">PostgreSQL (Supabase RLS Active)</span>
                </div>
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">TDS Tax Rules Engine</span>
                  <span className="font-semibold text-emerald-600">Active (Authoritative Rules)</span>
                </div>
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Audit Logging</span>
                  <span className="font-semibold text-emerald-600">Enabled (Full Traceability)</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-muted-foreground">Batch Import Processing</span>
                  <span className="font-semibold">Client Batched (2,000 chunk cap)</span>
                </div>
              </CardContent>
            </Card>

            {/* Error Diagnostics */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" /> Recent Error Diagnostic Traces
                  </CardTitle>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetchErrors()}>
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingErrors ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {errorLogs.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500 opacity-80" />
                    <p className="text-xs">No active runtime error traces captured.</p>
                  </div>
                ) : (
                  <div className="max-h-60 overflow-y-auto divide-y">
                    {errorLogs.map((err: any) => (
                      <div key={err.id} className="p-3 text-xs space-y-1">
                        <div className="flex justify-between">
                          <span className="font-semibold text-destructive">{err.error_type || "Error"}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {err.created_at ? format(new Date(err.created_at), "HH:mm:ss") : ""}
                          </span>
                        </div>
                        <p className="text-muted-foreground truncate">{err.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* SMART VISUAL FIELD-LEVEL DIFF MODAL */}
      <Dialog open={!!selectedLogDetail} onOpenChange={(open) => !open && setSelectedLogDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-6 py-4 border-b bg-muted/20">
            <div className="flex items-center justify-between pr-8">
              <div className="flex items-center gap-2">
                <DialogTitle className="flex items-center gap-2 text-base">
                  <History className="h-4 w-4 text-primary" />
                  Audit Event Deep Inspection
                </DialogTitle>
                <Badge
                  variant={
                    selectedLogDetail?.action === "INSERT"
                      ? "default"
                      : selectedLogDetail?.action === "DELETE"
                        ? "destructive"
                        : "secondary"
                  }
                  className="font-mono text-xs uppercase"
                >
                  {selectedLogDetail?.action}
                </Badge>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 cursor-pointer"
                onClick={copyDetailPayload}
              >
                <Copy className="h-3 w-3" /> Copy Payload
              </Button>
            </div>
            <DialogDescription className="text-xs mt-1">
              Table: <span className="font-mono font-semibold text-foreground">{selectedLogDetail?.table_name}</span> · Record ID: <span className="font-mono">{selectedLogDetail?.record_id || "—"}</span>
            </DialogDescription>
          </DialogHeader>

          {selectedLogDetail && (
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {/* Event Metadata Banner */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg border bg-muted/30 p-3">
                <div>
                  <span className="text-muted-foreground text-[11px] block">Timestamp:</span>
                  <p className="font-semibold text-foreground mt-0.5">
                    {format(new Date(selectedLogDetail.action_time), "dd MMM yyyy, HH:mm:ss")}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-[11px] block">Actor (User):</span>
                  <p className="font-semibold text-foreground mt-0.5">
                    {selectedLogDetail.user_id
                      ? userProfiles[selectedLogDetail.user_id]?.full_name || selectedLogDetail.user_id.slice(0, 8)
                      : "System / Automation"}
                  </p>
                  {selectedLogDetail.user_id && userProfiles[selectedLogDetail.user_id]?.email && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {userProfiles[selectedLogDetail.user_id].email}
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground text-[11px] block">Target Record ID:</span>
                  <p className="font-mono text-[11px] text-foreground mt-0.5 truncate" title={selectedLogDetail.record_id || ""}>
                    {selectedLogDetail.record_id || "—"}
                  </p>
                </div>
              </div>

              {/* View Switcher: Visual Field Diff vs Raw JSON */}
              <div className="flex items-center justify-between border-b pb-2">
                <div className="flex gap-2">
                  <Button
                    variant={detailModalTab === "diff" ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs cursor-pointer"
                    onClick={() => setDetailModalTab("diff")}
                  >
                    Visual Field Diff ({fieldDiffs.filter(d => d.isChanged).length} modified)
                  </Button>
                  <Button
                    variant={detailModalTab === "raw" ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs cursor-pointer"
                    onClick={() => setDetailModalTab("raw")}
                  >
                    <FileCode className="h-3 w-3 mr-1" /> Raw JSON
                  </Button>
                </div>
              </div>

              {/* Visual Diff View */}
              {detailModalTab === "diff" && (
                <div className="border rounded-lg overflow-hidden bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 text-xs">
                        <TableHead className="w-[180px]">Field</TableHead>
                        <TableHead>Previous State (Old)</TableHead>
                        <TableHead>New State (Current)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fieldDiffs.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-6 text-muted-foreground">
                            No specific attribute diffs available.
                          </TableCell>
                        </TableRow>
                      ) : (
                        fieldDiffs.map((diff) => (
                          <TableRow
                            key={diff.field}
                            className={`text-xs ${
                              diff.isChanged
                                ? selectedLogDetail.action === "DELETE"
                                  ? "bg-rose-500/10 dark:bg-rose-950/20"
                                  : selectedLogDetail.action === "INSERT"
                                    ? "bg-emerald-500/10 dark:bg-emerald-950/20"
                                    : "bg-amber-500/10 dark:bg-amber-950/20"
                                : ""
                            }`}
                          >
                            {/* Field Name */}
                            <TableCell className="font-mono font-semibold text-foreground align-top">
                              {diff.field}
                              {diff.isChanged && (
                                <Badge
                                  variant="outline"
                                  className={`ml-1.5 text-[9px] px-1 py-0 ${
                                    selectedLogDetail.action === "DELETE"
                                      ? "text-rose-600 border-rose-300"
                                      : selectedLogDetail.action === "INSERT"
                                        ? "text-emerald-600 border-emerald-300"
                                        : "text-amber-600 border-amber-300"
                                  }`}
                                >
                                  {selectedLogDetail.action === "DELETE" ? "Removed" : selectedLogDetail.action === "INSERT" ? "Added" : "Changed"}
                                </Badge>
                              )}
                            </TableCell>

                            {/* Old Value */}
                            <TableCell className="font-mono text-muted-foreground align-top break-all">
                              {formatValueForDisplay(diff.oldValue)}
                            </TableCell>

                            {/* New Value */}
                            <TableCell className="font-mono font-medium text-foreground align-top break-all">
                              {formatValueForDisplay(diff.newValue)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Raw JSON View */}
              {detailModalTab === "raw" && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label className="text-xs font-semibold block mb-1.5 text-muted-foreground">
                      Previous State (Old JSON)
                    </Label>
                    <pre className="p-3 bg-muted rounded-lg font-mono text-[11px] overflow-auto max-h-72 whitespace-pre-wrap">
                      {selectedLogDetail.old_value
                        ? JSON.stringify(selectedLogDetail.old_value, null, 2)
                        : "null (Created record)"}
                    </pre>
                  </div>
                  <div>
                    <Label className="text-xs font-semibold block mb-1.5 text-muted-foreground">
                      New State (New JSON)
                    </Label>
                    <pre className="p-3 bg-muted rounded-lg font-mono text-[11px] overflow-auto max-h-72 whitespace-pre-wrap">
                      {selectedLogDetail.new_value
                        ? JSON.stringify(selectedLogDetail.new_value, null, 2)
                        : "null (Deleted record)"}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
