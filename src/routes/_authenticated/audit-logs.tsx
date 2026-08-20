import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { AuditService } from "@/lib/services/audit.service";
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
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck,
  History,
  Activity,
  AlertTriangle,
  FileClock,
  ShieldAlert,
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
  email?: string | null;
  ip_address?: string | null;
  browser?: string | null;
  device?: string | null;
  login_status?: string | null;
  login_time: string;
};

export const Route = createFileRoute("/_authenticated/audit-logs")({
  component: AuditLogsRoute,
});

const PAGE_SIZE = 25;

function AuditLogsRoute() {
  const [activeTab, setActiveTab] = useState("activity");

  // Activity Log filters
  const [activitySearch, setActivitySearch] = useState("");
  const [activityTable, setActivityTable] = useState("all");
  const [activityAction, setActivityAction] = useState("all");
  const [activityPage, setActivityPage] = useState(1);
  const [selectedLogDetail, setSelectedLogDetail] = useState<AuditLogRow | null>(null);

  // Login Log filters
  const [loginSearch, setLoginSearch] = useState("");
  const [loginStatus, setLoginStatus] = useState("all");
  const [loginPage, setLoginPage] = useState(1);

  // Queries
  const { data: auditLogs = [], isLoading: loadingAudit, refetch: refetchAudit } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: () => AuditService.getAuditLogs(1000),
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

  // Filtered Activity Logs
  const filteredAuditLogs = useMemo(() => {
    let list = auditLogs as AuditLogRow[];
    if (activityTable !== "all") {
      list = list.filter((l) => l.table_name === activityTable);
    }
    if (activityAction !== "all") {
      list = list.filter((l) => l.action?.toUpperCase() === activityAction.toUpperCase());
    }
    if (activitySearch.trim()) {
      const q = activitySearch.toLowerCase();
      list = list.filter(
        (l) =>
          l.table_name?.toLowerCase().includes(q) ||
          l.action?.toLowerCase().includes(q) ||
          l.record_id?.toLowerCase().includes(q) ||
          l.user_id?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [auditLogs, activityTable, activityAction, activitySearch]);

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
  const deleteCount = useMemo(
    () => auditLogs.filter((l: AuditLogRow) => l.action?.toUpperCase() === "DELETE").length,
    [auditLogs]
  );

  const overviewCards = [
    {
      title: "Total Audit Actions",
      value: String(auditLogs.length),
      subtitle: `${insertCount} Inserts · ${deleteCount} Deletions`,
      icon: History,
      accent: "text-sky-600",
    },
    {
      title: "User Sign-Ins",
      value: String(loginLogs.length),
      subtitle: "Authenticated sessions",
      icon: ShieldCheck,
      accent: "text-emerald-600",
    },
    {
      title: "System Telemetry",
      value: String(apiLogs.length + errorLogs.length),
      subtitle: `${errorLogs.length} error traces captured`,
      icon: Activity,
      accent: errorLogs.length > 0 ? "text-amber-600" : "text-emerald-600",
    },
  ];

  const handleExportActivity = () => {
    if (filteredAuditLogs.length === 0) return;
    const rows = filteredAuditLogs.map((l) => ({
      Timestamp: l.action_time,
      Action: l.action,
      Table: l.table_name,
      Record_ID: l.record_id || "",
      User_ID: l.user_id || "system",
      Old_Value: JSON.stringify(l.old_value ?? ""),
      New_Value: JSON.stringify(l.new_value ?? ""),
    }));
    exportToExcel(rows, `audit_activity_${new Date().toISOString().slice(0, 10)}`);
    toast.success("Audit activity logs exported.");
  };

  const handleExportLogins = () => {
    if (filteredLoginLogs.length === 0) return;
    const rows = filteredLoginLogs.map((l) => ({
      Timestamp: l.login_time,
      Email: l.email || "Unknown",
      IP_Address: l.ip_address || "",
      Browser: l.browser || "",
      Device: l.device || "",
      Status: l.login_status || "",
    }));
    exportToExcel(rows, `login_logs_${new Date().toISOString().slice(0, 10)}`);
    toast.success("Login activity logs exported.");
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Audit & Compliance Logs"
        description="Security, database modification history, and access tracking for compliance and operational transparency."
      />

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {overviewCards.map((card) => (
          <Card key={card.title} className="border border-border/80 bg-card/80">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {card.title}
                  </p>
                  <p className={`mt-2 text-2xl font-bold tabular-nums ${card.accent}`}>
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
                {auditLogs.length}
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

        {/* ═══════════════════════════════════════════════════════
            TAB 1: DATABASE ACTIVITY LOGS
        ═══════════════════════════════════════════════════════ */}
        <TabsContent value="activity" className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">Database Modification Logs</CardTitle>
                  <CardDescription>
                    {filteredAuditLogs.length} tracked change{filteredAuditLogs.length !== 1 ? "s" : ""} across tables. Click the{" "}
                    <Eye className="inline h-3 w-3 mx-0.5" /> icon to inspect the before/after JSON diff.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filteredAuditLogs.length === 0}
                    onClick={handleExportActivity}
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />
                    Export Excel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchAudit()}
                    disabled={loadingAudit}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingAudit ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>
              </div>

              {/* Controls */}
              <div className="mt-2 flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search table, action, record ID…"
                    value={activitySearch}
                    onChange={(e) => {
                      setActivitySearch(e.target.value);
                      setActivityPage(1);
                    }}
                    className="pl-8 h-8 text-sm"
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

                <Select
                  value={activityTable}
                  onValueChange={(v) => {
                    setActivityTable(v);
                    setActivityPage(1);
                  }}
                >
                  <SelectTrigger className="w-48 h-8 text-sm">
                    <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                    <SelectValue placeholder="All Tables" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Tables</SelectItem>
                    {tableNames.map((tbl) => (
                      <SelectItem key={tbl} value={tbl}>
                        {tbl}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={activityAction}
                  onValueChange={(v) => {
                    setActivityAction(v);
                    setActivityPage(1);
                  }}
                >
                  <SelectTrigger className="w-36 h-8 text-sm">
                    <SelectValue placeholder="All Actions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Actions</SelectItem>
                    <SelectItem value="INSERT">INSERT</SelectItem>
                    <SelectItem value="UPDATE">UPDATE</SelectItem>
                    <SelectItem value="DELETE">DELETE</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>

            <CardContent className="px-0 pb-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-6">Timestamp</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Table</TableHead>
                      <TableHead>Record ID</TableHead>
                      <TableHead>User / System</TableHead>
                      <TableHead className="pr-6 text-right">Details</TableHead>
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
                          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                          <p className="text-sm">No audit logs matching selection.</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      pagedAuditLogs.map((log: AuditLogRow) => (
                        <TableRow key={log.id} className="hover:bg-muted/30">
                          <TableCell className="pl-6 text-xs text-muted-foreground font-mono">
                            {format(new Date(log.action_time), "dd MMM yyyy, HH:mm:ss")}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                log.action?.toUpperCase() === "INSERT"
                                  ? "default"
                                  : log.action?.toUpperCase() === "DELETE"
                                    ? "destructive"
                                    : "secondary"
                              }
                              className="text-[10px] uppercase font-mono"
                            >
                              {log.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium text-sm">{log.table_name}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {log.record_id ? log.record_id.substring(0, 8) : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {log.user_id ? log.user_id.substring(0, 8) : "system"}
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => setSelectedLogDetail(log)}
                            >
                              <Eye className="h-3.5 w-3.5 mr-1 text-primary" /> Inspect
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {activityPageCount > 1 && (
                <div className="flex items-center justify-between border-t px-6 py-3">
                  <p className="text-xs text-muted-foreground">
                    Page {activityPage} of {activityPageCount} · {filteredAuditLogs.length} records
                  </p>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={activityPage <= 1}
                      onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={activityPage >= activityPageCount}
                      onClick={() => setActivityPage((p) => Math.min(activityPageCount, p + 1))}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════
            TAB 2: USER LOGIN LOGS
        ═══════════════════════════════════════════════════════ */}
        <TabsContent value="logins" className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">User Sign-In Activity</CardTitle>
                  <CardDescription>
                    Successful and rejected authentication attempts with IP address and client metadata.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filteredLoginLogs.length === 0}
                    onClick={handleExportLogins}
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />
                    Export Excel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchLogins()}
                    disabled={loadingLogins}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingLogins ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>
              </div>

              {/* Controls */}
              <div className="mt-2 flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search email, IP, browser…"
                    value={loginSearch}
                    onChange={(e) => {
                      setLoginSearch(e.target.value);
                      setLoginPage(1);
                    }}
                    className="pl-8 h-8 text-sm"
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
                  <SelectTrigger className="w-40 h-8 text-sm">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="failure">Failure / Blocked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>

            <CardContent className="px-0 pb-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-6">Email / Principal</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Browser & Client</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="pr-6 text-right">Timestamp</TableHead>
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
                          <Lock className="h-8 w-8 mx-auto mb-2 opacity-30" />
                          <p className="text-sm">No login logs recorded yet.</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      pagedLoginLogs.map((log: LoginLogRow) => (
                        <TableRow key={log.id} className="hover:bg-muted/30">
                          <TableCell className="pl-6 font-medium text-sm">{log.email || "Unknown"}</TableCell>
                          <TableCell className="text-muted-foreground font-mono text-xs">
                            {log.ip_address || "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {log.browser || "Browser"} {log.device ? `(${log.device})` : ""}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={log.login_status === "success" ? "default" : "destructive"}
                              className={`text-[10px] ${
                                log.login_status === "success"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0"
                                  : ""
                              }`}
                            >
                              {log.login_status || "success"}
                            </Badge>
                          </TableCell>
                          <TableCell className="pr-6 text-right text-xs text-muted-foreground font-mono">
                            {log.login_time ? format(new Date(log.login_time), "dd MMM yyyy, HH:mm:ss") : "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {loginPageCount > 1 && (
                <div className="flex items-center justify-between border-t px-6 py-3">
                  <p className="text-xs text-muted-foreground">
                    Page {loginPage} of {loginPageCount} · {filteredLoginLogs.length} logs
                  </p>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={loginPage <= 1}
                      onClick={() => setLoginPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={loginPage >= loginPageCount}
                      onClick={() => setLoginPage((p) => Math.min(loginPageCount, p + 1))}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
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

      {/* ── JSON Detail Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={!!selectedLogDetail} onOpenChange={(open) => !open && setSelectedLogDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-primary" />
              Audit Log Record Details
            </DialogTitle>
            <DialogDescription>
              {selectedLogDetail?.table_name} — Action:{" "}
              <Badge variant="outline" className="font-mono text-xs uppercase">
                {selectedLogDetail?.action}
              </Badge>
            </DialogDescription>
          </DialogHeader>

          {selectedLogDetail && (
            <div className="space-y-4 pt-2 text-xs">
              <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3">
                <div>
                  <span className="text-muted-foreground">Timestamp:</span>
                  <p className="font-mono mt-0.5">
                    {format(new Date(selectedLogDetail.action_time), "dd MMM yyyy, HH:mm:ss")}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Record ID:</span>
                  <p className="font-mono mt-0.5">{selectedLogDetail.record_id || "—"}</p>
                </div>
              </div>

              {/* Before vs After comparison */}
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label className="text-xs font-semibold block mb-1.5 text-muted-foreground">
                    Previous State (Old Value)
                  </Label>
                  <pre className="p-3 bg-muted rounded-lg font-mono text-[11px] overflow-auto max-h-60 whitespace-pre-wrap">
                    {selectedLogDetail.old_value
                      ? JSON.stringify(selectedLogDetail.old_value, null, 2)
                      : "null (New Record)"}
                  </pre>
                </div>
                <div>
                  <Label className="text-xs font-semibold block mb-1.5 text-muted-foreground">
                    New State (New Value)
                  </Label>
                  <pre className="p-3 bg-muted rounded-lg font-mono text-[11px] overflow-auto max-h-60 whitespace-pre-wrap">
                    {selectedLogDetail.new_value
                      ? JSON.stringify(selectedLogDetail.new_value, null, 2)
                      : "null (Deleted Record)"}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
