import { useMemo, useState } from "react";
import { CheckCircle2, Info, ShieldAlert, Sparkles, Wrench } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import type { ReconciliationExceptionItem, ReconciliationMatch } from "@/lib/reconciliation-engine";
import {
  clusterReconciliationExceptions,
  redactSensitiveText,
} from "@/lib/services/hitl-triage-agent.service";
import { runHitlAiAdvisory, type HitlAdvisoryResponse } from "@/lib/hitl-triage.functions";

export interface ReconciliationExceptionsSummary {
  exceptions: ReconciliationExceptionItem[];
  totalExceptions: number;
  unmatchedBankTxnCount: number;
  unmatchedBankTotalAmount: number;
  largeVarianceCount: number;
  largeVarianceTotalAmount: number;
  mismatchedReferenceCount: number;
}

export function ReconciliationExceptionQueueTab({
  exceptionsSummary,
  acknowledgedExceptions,
  onAcknowledgeException,
  onAcknowledgeBatch,
  onOpenRemediation,
  matches = [],
}: {
  exceptionsSummary: ReconciliationExceptionsSummary;
  acknowledgedExceptions: Set<string>;
  onAcknowledgeException: (excId: string) => void;
  onAcknowledgeBatch?: (excIds: string[]) => void;
  onOpenRemediation?: () => void;
  matches?: ReconciliationMatch[];
}) {
  const [showCopilot, setShowCopilot] = useState(false);
  const [advisory, setAdvisory] = useState<HitlAdvisoryResponse | null>(null);
  const [isLoadingAdvisory, setIsLoadingAdvisory] = useState(false);

  const clusters = useMemo(
    () => clusterReconciliationExceptions(exceptionsSummary.exceptions, matches),
    [exceptionsSummary.exceptions, matches],
  );

  const handleRunAdvisory = async () => {
    setShowCopilot(true);
    if (clusters.length === 0) return;
    setIsLoadingAdvisory(true);
    try {
      const res = await runHitlAiAdvisory({
        data: {
          workflow: "reconciliation_exceptions",
          contextTitle: `Reconciliation Exception Queue (${exceptionsSummary.totalExceptions} items)`,
          items: clusters.map((c) => ({
            id: c.category,
            label: c.title,
            suggestedDecision: c.recommendedHitlAction.slice(0, 80),
            summary: redactSensitiveText(
              `${c.itemCount} item(s), exposure NPR ${c.totalExposureNpr.toLocaleString()}: ${c.rootCauseSummary}`,
            ).slice(0, 320),
          })),
        },
      });
      setAdvisory(res);
    } catch {
      setAdvisory(null);
    } finally {
      setIsLoadingAdvisory(false);
    }
  };

  return (
    <TabsContent value="exceptions" className="m-0 space-y-4 max-h-[600px] overflow-y-auto pr-1">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-lg">
          <p className="text-xs text-red-600 dark:text-red-400 font-medium">
            Unmatched Bank Entries
          </p>
          <p className="text-xl font-bold text-red-700 dark:text-red-300 mt-1">
            {exceptionsSummary.unmatchedBankTxnCount}
          </p>
          <p className="text-[11px] text-red-600/70 mt-0.5">
            Total: NPR {exceptionsSummary.unmatchedBankTotalAmount.toLocaleString()}
          </p>
        </div>

        <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-lg">
          <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
            Large Variances (&gt; NPR 1.00)
          </p>
          <p className="text-xl font-bold text-amber-700 dark:text-amber-300 mt-1">
            {exceptionsSummary.largeVarianceCount}
          </p>
          <p className="text-[11px] text-amber-600/70 mt-0.5">
            Discrepancy: NPR {exceptionsSummary.largeVarianceTotalAmount.toLocaleString()}
          </p>
        </div>

        <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 rounded-lg">
          <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
            Reference Mismatches
          </p>
          <p className="text-xl font-bold text-blue-700 dark:text-blue-300 mt-1">
            {exceptionsSummary.mismatchedReferenceCount}
          </p>
          <p className="text-[11px] text-blue-600/70 mt-0.5">
            Action: Force-Match or Sync Reference
          </p>
        </div>
      </div>

      {exceptionsSummary.exceptions.length === 0 ? (
        <div className="text-center py-8 bg-green-50/50 rounded-lg border border-green-100 dark:bg-green-950/10 dark:border-green-900/30">
          <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-1.5 opacity-80" />
          <p className="text-sm font-medium text-green-700 dark:text-green-400">
            Zero Reconciliation Exceptions
          </p>
          <p className="text-xs text-green-600/70 dark:text-green-500/70 mt-0.5">
            No unmatched bank entries, high variances, or reference anomalies detected.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {exceptionsSummary.totalExceptions > exceptionsSummary.exceptions.length && (
            <Alert className="mb-2 bg-blue-50/50 border-blue-200 text-blue-900 dark:bg-blue-950/20 dark:border-blue-900/40 dark:text-blue-200">
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <AlertDescription className="text-xs">
                Displaying top {exceptionsSummary.exceptions.length} exceptions of{" "}
                {exceptionsSummary.totalExceptions.toLocaleString()} total identified.
              </AlertDescription>
            </Alert>
          )}

          {clusters.length > 0 && (
            <div className="p-3 rounded-lg border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-950/20 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-indigo-800 dark:text-indigo-300">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <span>
                    HITL Root-Cause Triage Copilot ({clusters.length} cluster
                    {clusters.length === 1 ? "" : "s"})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] border-indigo-300 text-indigo-700 dark:text-indigo-300"
                    disabled={isLoadingAdvisory}
                    onClick={handleRunAdvisory}
                  >
                    <Sparkles className="w-3 h-3 mr-1" />
                    {isLoadingAdvisory ? "Analyzing..." : "Run HITL Exception Triage"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={() => setShowCopilot((v) => !v)}
                  >
                    {showCopilot ? "Hide Details" : "Inspect Clusters"}
                  </Button>
                </div>
              </div>

              {advisory && (
                <div className="text-[11px] bg-background/70 rounded p-2 border border-indigo-200/70 space-y-1">
                  <div className="font-semibold text-indigo-700 dark:text-indigo-300">
                    {advisory.providerLabel}
                  </div>
                  <p className="text-muted-foreground">{advisory.advisorSummary}</p>
                </div>
              )}

              {showCopilot && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {clusters.map((cluster) => {
                    const allAck = cluster.exceptionIds.every((id) =>
                      acknowledgedExceptions.has(id),
                    );
                    return (
                      <div
                        key={cluster.category}
                        className="p-2.5 rounded border bg-background/80 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold flex items-center gap-1.5">
                            <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            {cluster.title}
                          </span>
                          <Badge variant="outline" className="text-[10px] shrink-0 font-mono">
                            {cluster.itemCount} • NPR {cluster.totalExposureNpr.toLocaleString()}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {cluster.rootCauseSummary}
                        </p>
                        {advisory?.itemRationales[cluster.category] && (
                          <p className="text-[11px] text-indigo-700 dark:text-indigo-300">
                            {advisory.itemRationales[cluster.category]}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {cluster.supportsRemediation && onOpenRemediation && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] px-2 border-amber-400 text-amber-700 dark:text-amber-300"
                              onClick={onOpenRemediation}
                            >
                              <Wrench className="w-3 h-3 mr-1" />
                              Open Remediation
                            </Button>
                          )}
                          {cluster.supportsToleranceAcknowledge && onAcknowledgeBatch && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="h-6 text-[10px] px-2"
                              disabled={allAck}
                              onClick={() => onAcknowledgeBatch(cluster.exceptionIds)}
                            >
                              {allAck ? "Cluster Acknowledged" : "Acknowledge Cluster"}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {exceptionsSummary.exceptions.map((exc) => {
            const isAcknowledged = acknowledgedExceptions.has(exc.id);
            return (
              <div
                key={exc.id}
                className={`p-3 rounded-lg border text-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-3 transition-colors ${
                  isAcknowledged
                    ? "bg-muted/40 border-muted opacity-60"
                    : exc.severity === "critical"
                      ? "bg-rose-50/60 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/40"
                      : "bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40"
                }`}
              >
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant={
                        isAcknowledged
                          ? "secondary"
                          : exc.severity === "critical"
                            ? "destructive"
                            : "default"
                      }
                      className="text-[10px] uppercase font-semibold"
                    >
                      {exc.type.replace(/_/g, " ")}
                    </Badge>
                    {exc.boid && (
                      <span className="font-mono text-xs text-muted-foreground">
                        BOID: {exc.boid}
                      </span>
                    )}
                    {exc.shareholderName && (
                      <span className="font-medium text-foreground">{exc.shareholderName}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{exc.description}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <p className="font-mono text-xs font-semibold">
                      NPR {exc.amount.toLocaleString()}
                    </p>
                    <span className="text-[10px] text-muted-foreground">
                      Action: {exc.actionRequired}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant={isAcknowledged ? "outline" : "secondary"}
                    className="h-8 text-xs"
                    disabled={isAcknowledged}
                    onClick={() => onAcknowledgeException(exc.id)}
                  >
                    {isAcknowledged ? "Acknowledged" : "Acknowledge"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </TabsContent>
  );
}
