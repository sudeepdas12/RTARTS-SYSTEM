import { createFileRoute } from "@tanstack/react-router";
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
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck,
  History,
  Activity,
  AlertTriangle,
  FileClock,
  ShieldAlert,
} from "lucide-react";

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

function AuditLogsRoute() {
  const { data: loginLogs, isLoading: loadingLogins } = useQuery({
    queryKey: ["login-logs"],
    queryFn: () => AuditService.getLoginLogs(50),
  });

  const { data: auditLogs, isLoading: loadingAudit } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: () => AuditService.getAuditLogs(100),
  });

  const overviewCards = [
    {
      title: "Activity",
      value: String(auditLogs?.length ?? 0),
      icon: History,
      accent: "text-sky-600",
    },
    {
      title: "Logins",
      value: String(loginLogs?.length ?? 0),
      icon: ShieldCheck,
      accent: "text-emerald-600",
    },
    {
      title: "Alerts",
      value: "0",
      icon: ShieldAlert,
      accent: "text-amber-600",
    },
  ];

  const renderAuditDetails = (log: AuditLogRow) => {
    const details: string[] = [];

    if (log.old_value && typeof log.old_value === "object") {
      details.push(`Old: ${JSON.stringify(log.old_value).substring(0, 100)}`);
    }
    if (log.new_value && typeof log.new_value === "object") {
      details.push(`New: ${JSON.stringify(log.new_value).substring(0, 100)}`);
    }

    return details.length > 0 ? details.join(" | ") : "—";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Logs"
        description="Security, access, and operational activity tracking for the system."
      />

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
                </div>
                <div className={`rounded-lg bg-muted p-2.5 ${card.accent}`}>
                  <card.icon className="h-4 w-4" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="activity" className="space-y-6">
        <TabsList className="h-10">
          <TabsTrigger value="activity" className="gap-2">
            <History className="h-4 w-4" /> Activity Logs
          </TabsTrigger>
          <TabsTrigger value="logins" className="gap-2">
            <ShieldCheck className="h-4 w-4" /> Login Activity
          </TabsTrigger>
          <TabsTrigger value="api" className="gap-2">
            <Activity className="h-4 w-4" /> API Requests
          </TabsTrigger>
          <TabsTrigger
            value="errors"
            className="gap-2 text-amber-600 data-[state=active]:text-amber-600"
          >
            <AlertTriangle className="h-4 w-4" /> System Errors
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Recent Activity</CardTitle>
                  <CardDescription>
                    Latest administrator and system changes across the platform.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Table</TableHead>
                    <TableHead>Record ID</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingAudit ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-4">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : auditLogs?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-4">
                        No audit logs found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    auditLogs?.map((log: AuditLogRow) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(log.action_time), "dd MMM yyyy, HH:mm:ss")}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              log.action === "INSERT"
                                ? "default"
                                : log.action === "DELETE"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {log.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{log.table_name}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {log.record_id?.substring(0, 8) || "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {log.user_id?.substring(0, 8) || "system"}
                        </TableCell>
                        <TableCell
                          className="text-xs text-muted-foreground max-w-[300px] truncate"
                          title={renderAuditDetails(log)}
                        >
                          {renderAuditDetails(log)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logins" className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Login Activity</CardTitle>
                  <CardDescription>
                    Successful and failed sign-ins with browser and device metadata.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Browser / Device</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingLogins ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-4">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : (
                    loginLogs?.map((log: LoginLogRow) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-medium">{log.email || "Unknown"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {log.ip_address || "-"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {log.browser} / {log.device}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={log.login_status === "success" ? "default" : "destructive"}
                          >
                            {log.login_status}
                          </Badge>
                        </TableCell>
                        <TableCell>{format(new Date(log.login_time), "PPp")}</TableCell>
                      </TableRow>
                    ))
                  )}
                  {(!loginLogs || loginLogs.length === 0) && !loadingLogins && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-4">
                        No login logs found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api" className="space-y-4">
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              API request logs stream... (Demonstration Stub)
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="errors" className="space-y-4">
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              System error logs stream... (Demonstration Stub)
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
