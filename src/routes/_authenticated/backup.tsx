import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  RefreshCw,
  Calendar,
  Database,
  HardDrive,
  FileSpreadsheet,
  FileCode,
  Copy,
  Check,
  Terminal,
  ShieldCheck,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import { DataManagementService } from "@/lib/services/data-management.service";

export const Route = createFileRoute("/_authenticated/backup")({
  component: BackupPage,
});

function BackupPage() {
  const { hasAny, loading } = useAuth();
  const canAccess = hasAny(["admin", "supervisor"]);

  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const handleCopyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(cmd);
    toast.success("Command copied to clipboard!");
    setTimeout(() => setCopiedCmd(null), 2500);
  };

  const handleExportFullExcel = async () => {
    setIsExportingBackup(true);
    try {
      toast.info("Generating full system Excel backup...");
      const res = await DataManagementService.exportFullDatabaseBackup();
      toast.success(
        `Full backup downloaded! (${res.companiesCount} companies, ${res.clientsCount} clients, ${res.payablesCount} payables, ${res.paymentsCount} payments)`,
      );
    } catch (err: any) {
      toast.error(`Backup export failed: ${err.message}`);
    } finally {
      setIsExportingBackup(false);
    }
  };

  const handleExportFullJson = async () => {
    setIsExportingBackup(true);
    try {
      toast.info("Generating full system JSON archive...");
      await DataManagementService.exportFullDatabaseJson();
      toast.success("System JSON archive downloaded successfully!");
    } catch (err: any) {
      toast.error(`JSON export failed: ${err.message}`);
    } finally {
      setIsExportingBackup(false);
    }
  };

  const {
    data: dbStats = null,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ["system-db-stats-dedicated"],
    queryFn: async () => {
      const [comp, clients, div, int, mf, batches, pay, recon] = await Promise.all([
        supabase.from("companies").select("id", { count: "exact", head: true }),
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("dividend_payables").select("id", { count: "exact", head: true }),
        supabase.from("interest_payables").select("id", { count: "exact", head: true }),
        (supabase as any).from("mutual_fund_payables").select("id", { count: "exact", head: true }),
        (supabase as any).from("payment_batches").select("id", { count: "exact", head: true }),
        (supabase as any).from("payments").select("id", { count: "exact", head: true }),
        (supabase as any)
          .from("reconciliation_results")
          .select("id", { count: "exact", head: true }),
      ]);
      return {
        companies: comp.count || 0,
        clients: clients.count || 0,
        payables: (div.count || 0) + (int.count || 0) + (mf.count || 0),
        batches: batches.count || 0,
        payments: pay.count || 0,
        reconciliation: recon.count || 0,
      };
    },
    enabled: canAccess,
  });

  if (!loading && !canAccess) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center">
        <div className="h-14 w-14 rounded-full bg-rose-100 dark:bg-rose-950/50 flex items-center justify-center text-rose-600 dark:text-rose-400 mb-4">
          <Lock className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">Access Restricted</h2>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-md">
          Database backup, disaster recovery, and system snapshots require the{" "}
          <span className="font-semibold text-foreground">admin</span> or{" "}
          <span className="font-semibold text-foreground">supervisor</span> role.
        </p>
        <Button asChild variant="outline" className="mt-5">
          <Link to="/dashboard">Return to Dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 animate-fade-in max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="Backup & Disaster Recovery"
          description="Enterprise database snapshots, host storage dumps, and multi-server disaster recovery."
        />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchStats()}
            disabled={statsLoading}
            className="text-xs gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${statsLoading ? "animate-spin" : ""}`} />
            Refresh Counts
          </Button>
        </div>
      </div>

      {/* Database Overview Banner */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-lg flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                Live Database Architecture & Record Metrics
              </CardTitle>
              <CardDescription>
                Live snapshot of all master data and transaction ledgers active in the system.
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className="gap-1.5 py-1 px-2.5 text-xs border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 self-start sm:self-auto"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Storage Engine Protected
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 pt-2">
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Companies</p>
              <p className="text-xl font-bold mt-1 font-mono">
                {dbStats ? dbStats.companies.toLocaleString() : "..."}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Shareholders</p>
              <p className="text-xl font-bold mt-1 font-mono">
                {dbStats ? dbStats.clients.toLocaleString() : "..."}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">All Payables</p>
              <p className="text-xl font-bold mt-1 font-mono">
                {dbStats ? dbStats.payables.toLocaleString() : "..."}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Payment Batches</p>
              <p className="text-xl font-bold mt-1 font-mono">
                {dbStats ? dbStats.batches.toLocaleString() : "..."}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Payment Items</p>
              <p className="text-xl font-bold mt-1 font-mono">
                {dbStats ? dbStats.payments.toLocaleString() : "..."}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Reconciled Records</p>
              <p className="text-xl font-bold mt-1 font-mono">
                {dbStats ? dbStats.reconciliation.toLocaleString() : "..."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: 1-Click Browser Snapshot Export */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950/40 p-2.5 text-blue-600 dark:text-blue-400">
                <Download className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">1-Click Browser Snapshot Export</CardTitle>
                <CardDescription className="text-xs">
                  Download an immediate complete snapshot directly to your computer without server
                  access.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 flex-1">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Packages all companies, client profiles, payables (dividends, debentures, mutual
              funds), payment records, and reconciliation history into an immediate offline file.
            </p>
            <div className="rounded-lg border bg-muted/40 p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">File Format:</span>
                <span className="font-medium">Multi-Sheet XLSX or Raw JSON</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Target Client:</span>
                <span className="font-medium">Direct Browser Download</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Offline Access:</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  Ready for Excel / External Audits
                </span>
              </div>
            </div>
          </CardContent>
          <CardContent className="pt-0 flex flex-wrap gap-2">
            <Button
              onClick={handleExportFullExcel}
              disabled={isExportingBackup}
              className="gap-2 text-xs flex-1"
            >
              {isExportingBackup ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-3.5 w-3.5" />
              )}
              Download Excel Backup (.xlsx)
            </Button>
            <Button
              onClick={handleExportFullJson}
              disabled={isExportingBackup}
              variant="outline"
              className="gap-2 text-xs flex-1"
            >
              <FileCode className="h-3.5 w-3.5" />
              Download JSON Archive (.json)
            </Button>
          </CardContent>
        </Card>

        {/* Card 2: Adaptive Server Storage & Automated Backup */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-2.5 text-emerald-600 dark:text-emerald-400">
                <HardDrive className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">
                  Server Physical & Automated Backup Engine
                </CardTitle>
                <CardDescription className="text-xs">
                  Full PostgreSQL superuser dump with smart multi-platform detection across any
                  server.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 flex-1">
            <div className="rounded-lg border bg-muted/40 p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Storage Resolution:</span>
                <span className="font-semibold text-primary">Adaptive (Auto-Detect)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Locations Supported:</span>
                <span className="font-mono text-[11px]">
                  D:\BACKUP &bull; ./backups &bull; $BACKUP_DIR
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Compression:</span>
                <span className="font-medium text-emerald-600">
                  GZIP / ZIP (~42MB &rarr; ~3.7MB, 90% savings)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Platform Engine:</span>
                <span className="font-medium">Universal (Windows, Linux, Docker, macOS)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Retention Policy:</span>
                <span className="font-medium">Automatic 30-day rotation</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Terminal className="h-3.5 w-3.5 text-primary" /> Create Backup Now:
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => handleCopyCommand("npm run db:backup")}
                >
                  {copiedCmd === "npm run db:backup" ? (
                    <Check className="h-3 w-3 text-emerald-600 mr-1" />
                  ) : (
                    <Copy className="h-3 w-3 mr-1" />
                  )}
                  Copy
                </Button>
              </div>
              <div className="rounded bg-slate-900 px-3 py-2 text-xs font-mono text-emerald-400 select-all flex items-center justify-between">
                <code>npm run db:backup</code>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5 text-amber-500" /> Restore Database:
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => handleCopyCommand("npm run db:restore")}
                >
                  {copiedCmd === "npm run db:restore" ? (
                    <Check className="h-3 w-3 text-emerald-600 mr-1" />
                  ) : (
                    <Copy className="h-3 w-3 mr-1" />
                  )}
                  Copy
                </Button>
              </div>
              <div className="rounded bg-slate-900 px-3 py-2 text-xs font-mono text-amber-300 select-all flex items-center justify-between">
                <code>npm run db:restore</code>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Card 3: Automated Daily Schedule Guide (Multi-Platform) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Automated Nightly Backups (Universal Setup for Any Server)
          </CardTitle>
          <CardDescription className="text-xs">
            Run nightly backups automatically without human intervention regardless of whether the
            server is Windows, Linux, or Cloud.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="rounded-lg border bg-card p-3 space-y-1.5">
              <p className="font-semibold text-foreground flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                Option A: Windows Server
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Open <strong>Task Scheduler</strong> (
                <code className="font-mono text-primary">taskschd.msc</code>), create a daily task
                at 11:00 PM:
              </p>
              <div className="rounded bg-muted p-2 font-mono text-[11px] select-all">
                npm run db:backup
              </div>
              <p className="text-[11px] text-muted-foreground">
                Works with secondary D:\ if present, or automatically falls back to local project
                storage.
              </p>
            </div>

            <div className="rounded-lg border bg-card p-3 space-y-1.5">
              <p className="font-semibold text-foreground flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Option B: Linux / Cloud (Ubuntu, AWS, etc.)
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Add a cron job with <code className="font-mono text-primary">crontab -e</code> to
                run daily at 11:00 PM:
              </p>
              <div className="rounded bg-muted p-2 font-mono text-[11px] select-all">
                0 23 * * * cd /var/www/rtarts && npm run db:backup
              </div>
              <p className="text-[11px] text-muted-foreground">
                Saves directly to server <code className="font-mono">./backups</code> with automatic
                30-day rotation.
              </p>
            </div>

            <div className="rounded-lg border bg-card p-3 space-y-1.5">
              <p className="font-semibold text-foreground flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-purple-500" />
                Option C: Custom Server Drive / NAS / SAN
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Set the <code className="font-mono text-primary">BACKUP_DIR</code> variable in your
                server's <code className="font-mono">.env</code>:
              </p>
              <div className="rounded bg-muted p-2 font-mono text-[11px] select-all">
                BACKUP_DIR=/mnt/nas/backups
              </div>
              <p className="text-[11px] text-muted-foreground">
                The system routes all physical dumps to your designated mount point or external
                volume.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
