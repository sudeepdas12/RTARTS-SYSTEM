import React from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Upload,
  ShieldCheck,
  ClipboardCheck,
  Layers,
  Send,
  ArrowLeftRight,
  FileSpreadsheet,
  AlertTriangle,
  Clock,
  ArrowRight,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Building2,
} from "lucide-react";

export interface OperationalMetrics {
  pendingApprovals: number;
  dataQualityIssues: number;
  unreconciledPending: number;
  batchesPending: number;
  totalPendingAmount?: number;
}

export interface OperationalWorkflowHubProps {
  metrics?: OperationalMetrics;
  dataAsOf: Date;
  onRefresh: () => void;
  isRefreshing?: boolean;
  selectedCompanyName?: string;
  selectedFiscalYear?: string;
}

export function OperationalWorkflowHub({
  metrics = {
    pendingApprovals: 0,
    dataQualityIssues: 0,
    unreconciledPending: 0,
    batchesPending: 0,
  },
  dataAsOf,
  onRefresh,
  isRefreshing = false,
  selectedCompanyName = "All Companies",
  selectedFiscalYear = "All Fiscal Years",
}: OperationalWorkflowHubProps) {
  // Determine highest-priority action
  let priorityAction = {
    title: "All Core Queues Clear",
    desc: "No pending approval bottlenecks or critical data issues detected. System is operational.",
    cta: "Start New Upload",
    href: "/upload",
    sla: "Standard SLA",
    owner: "Operators",
    variant: "default" as "default" | "destructive",
    badgeColor: "bg-emerald-600",
  };

  if (metrics.pendingApprovals > 0) {
    priorityAction = {
      title: `${metrics.pendingApprovals} Approvals Awaiting Review`,
      desc: "Maker submissions require checker/supervisor verification to unlock downstream disbursements.",
      cta: "Review & Authorize",
      href: "/approvals",
      sla: "SLA: Within 2 Hours",
      owner: "Checker / Approver Role",
      variant: "destructive" as const,
      badgeColor: "bg-rose-600",
    };
  } else if (metrics.batchesPending > 0) {
    priorityAction = {
      title: `${metrics.batchesPending} Payment Batches in Draft / Pending Stage`,
      desc: "Payment batches are staged. Complete approval workflow or generate ConnectIPS / NEFT clearing manifests.",
      cta: "Go to Payment Rails",
      href: "/payments",
      sla: "SLA: Cutoff 3:00 PM NST",
      owner: "Finance Operator",
      variant: "default" as "default" | "destructive",
      badgeColor: "bg-amber-600",
    };
  } else if (metrics.dataQualityIssues > 0) {
    priorityAction = {
      title: `${metrics.dataQualityIssues} Client Records Missing Bank Details`,
      desc: "Accounts lacking 16-digit Demat BOID or valid bank account numbers cannot be disbursed.",
      cta: "Resolve Data Quality",
      href: "/classification-review",
      sla: "SLA: Prior to Record Date",
      owner: "Registry Officer",
      variant: "default" as "default" | "destructive",
      badgeColor: "bg-orange-600",
    };
  } else if (metrics.unreconciledPending > 0) {
    priorityAction = {
      title: `${metrics.unreconciledPending} Transactions Pending Bank Reconciliation`,
      desc: "Bank clearing statements need ingestion to confirm settlement and clear receivables.",
      cta: "Run Bank Matching",
      href: "/reconciliation",
      sla: "SLA: Daily T+1",
      owner: "Reconciliation Officer",
      variant: "default" as "default" | "destructive",
      badgeColor: "bg-blue-600",
    };
  }

  const steps = [
    { num: 1, label: "Upload & Map", href: "/upload", icon: Upload },
    { num: 2, label: "Validate & Tax", href: "/classification-review", icon: ShieldCheck },
    { num: 3, label: "Authorize", href: "/approvals", icon: ClipboardCheck },
    { num: 4, label: "Create Batch", href: "/payments", icon: Layers },
    { num: 5, label: "Disburse", href: "/payments", icon: Send },
    { num: 6, label: "Reconcile", href: "/reconciliation", icon: ArrowLeftRight },
    { num: 7, label: "Statutory Reports", href: "/reports", icon: FileSpreadsheet },
  ];

  return (
    <div className="space-y-4">
      {/* Scope & Data Timestamp Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-muted/40 p-3 rounded-lg border text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="font-medium bg-background">
            <Building2 className="h-3 w-3 mr-1 text-primary" />
            Scope: {selectedCompanyName}
          </Badge>
          <Badge variant="outline" className="font-medium bg-background">
            FY: {selectedFiscalYear}
          </Badge>
          <span className="text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Data as of:{" "}
            <strong className="text-foreground">
              {dataAsOf.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </strong>{" "}
            ({dataAsOf.toLocaleDateString()})
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="h-7 text-xs gap-1.5 hover:bg-background"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          {isRefreshing ? "Refreshing..." : "Refresh Snapshot"}
        </Button>
      </div>

      {/* Sequential Primary Workflow Journey */}
      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-background to-background">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Primary Financial Lifecycle Journey
            </span>
            <span className="text-[11px] text-muted-foreground hidden md:inline">
              Follow sequence from Excel ingestion to statutory tax filings
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {steps.map((st) => {
              const Icon = st.icon;
              return (
                <Link
                  key={st.num}
                  to={st.href}
                  className="flex flex-col items-center justify-center p-2.5 rounded-lg border border-border/60 bg-background/80 hover:bg-primary/10 hover:border-primary/40 transition-all text-center group"
                >
                  <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary font-bold text-xs mb-1.5 group-hover:scale-105 transition-transform">
                    {st.num}
                  </div>
                  <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary mb-1" />
                  <span className="text-xs font-medium line-clamp-1">{st.label}</span>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Operational Priority Next-Action Banner */}
      <Card className="border-l-4 border-l-primary border-t border-r border-b">
        <CardContent className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${priorityAction.badgeColor}`}
              />
              <h3 className="font-bold text-sm tracking-tight">{priorityAction.title}</h3>
              <Badge variant="outline" className="text-[10px] uppercase font-semibold">
                {priorityAction.sla}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                Owner: {priorityAction.owner}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{priorityAction.desc}</p>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            <Button asChild size="sm" className="gap-1.5 font-semibold shadow-sm">
              <Link to={priorityAction.href}>
                {priorityAction.cta}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Quick Operational Drill-Down Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <Link
          to="/approvals"
          className="border rounded-lg p-3 bg-card hover:bg-muted/40 transition-colors flex items-center justify-between"
        >
          <div>
            <div className="text-muted-foreground uppercase font-medium">Pending Approvals</div>
            <div className="text-xl font-bold mt-0.5">{metrics.pendingApprovals}</div>
            <div className="text-[10px] text-muted-foreground">Maker/Checker queue</div>
          </div>
          <ClipboardCheck className="h-6 w-6 text-rose-500/60" />
        </Link>

        <Link
          to="/payments"
          className="border rounded-lg p-3 bg-card hover:bg-muted/40 transition-colors flex items-center justify-between"
        >
          <div>
            <div className="text-muted-foreground uppercase font-medium">Active Batches</div>
            <div className="text-xl font-bold mt-0.5">{metrics.batchesPending}</div>
            <div className="text-[10px] text-muted-foreground">Draft or In-Process</div>
          </div>
          <Layers className="h-6 w-6 text-amber-500/60" />
        </Link>

        <Link
          to="/classification-review"
          className="border rounded-lg p-3 bg-card hover:bg-muted/40 transition-colors flex items-center justify-between"
        >
          <div>
            <div className="text-muted-foreground uppercase font-medium">Data Quality Issues</div>
            <div className="text-xl font-bold mt-0.5">{metrics.dataQualityIssues}</div>
            <div className="text-[10px] text-muted-foreground">Missing bank/BOID</div>
          </div>
          <AlertTriangle className="h-6 w-6 text-orange-500/60" />
        </Link>

        <Link
          to="/reconciliation"
          className="border rounded-lg p-3 bg-card hover:bg-muted/40 transition-colors flex items-center justify-between"
        >
          <div>
            <div className="text-muted-foreground uppercase font-medium">Unreconciled Queue</div>
            <div className="text-xl font-bold mt-0.5">{metrics.unreconciledPending}</div>
            <div className="text-[10px] text-muted-foreground">Bank clearing pending</div>
          </div>
          <ArrowLeftRight className="h-6 w-6 text-blue-500/60" />
        </Link>
      </div>
    </div>
  );
}
