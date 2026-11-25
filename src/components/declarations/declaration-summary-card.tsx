import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Users,
  ArrowUpRight,
} from "lucide-react";
import { DeclarationService, CorporateDeclaration } from "@/lib/services/declaration.service";
import { fmtNpr } from "@/lib/nepal-currency";

interface DeclarationSummaryCardProps {
  companyId?: string;
  onSelectDeclaration?: (declaration: CorporateDeclaration) => void;
}

export function DeclarationSummaryCard({
  companyId,
  onSelectDeclaration,
}: DeclarationSummaryCardProps) {
  const [selectedId, setSelectedId] = useState<string>("");

  const {
    data: declarations = [],
    isLoading: isLoadingDecs,
    refetch: refetchDecs,
  } = useQuery({
    queryKey: ["corporate-declarations", companyId],
    queryFn: () =>
      DeclarationService.getDeclarations(companyId && companyId !== "all" ? companyId : undefined),
  });

  const activeId = selectedId || declarations[0]?.id || "";

  const {
    data: summary,
    isLoading: isLoadingSummary,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ["declaration-summary", activeId],
    queryFn: () => DeclarationService.getDeclarationSummary(activeId),
    enabled: Boolean(activeId),
  });

  const handleSelect = (id: string) => {
    setSelectedId(id);
    const found = declarations.find((d) => d.id === id);
    if (found && onSelectDeclaration) onSelectDeclaration(found);
  };

  if (declarations.length === 0 && !isLoadingDecs) {
    return null; // No declarations defined yet
  }

  const activeDec = declarations.find((d) => d.id === activeId);

  return (
    <Card className="border-primary/20 bg-card shadow-sm">
      <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-bold flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" /> Corporate Declaration Outstanding Status
            </CardTitle>
            {activeDec && (
              <Badge variant="outline" className="text-[10px] font-mono">
                {activeDec.declaration_code}
              </Badge>
            )}
          </div>
          <CardDescription className="text-xs">
            Live reconciliation of declared corporate actions, bank disbursements, and remaining
            liabilities.
          </CardDescription>
        </div>

        <div className="flex items-center gap-2">
          <Select value={activeId} onValueChange={handleSelect}>
            <SelectTrigger className="h-8 text-xs w-[240px]">
              <SelectValue placeholder="Select declaration..." />
            </SelectTrigger>
            <SelectContent>
              {declarations.map((d) => (
                <SelectItem key={d.id} value={d.id} className="text-xs">
                  {d.declaration_code} ({d.fiscal_year})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={() => {
              refetchDecs();
              if (activeId) refetchSummary();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {summary && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-muted/40 border">
                <span className="text-muted-foreground block text-[11px]">Total Declared</span>
                <span className="text-base font-bold font-mono text-foreground block truncate">
                  {fmtNpr(summary.net_payable_amount || summary.total_declared_amount)}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {summary.total_payables_count.toLocaleString()} Shareholders
                </span>
              </div>

              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-300 dark:border-emerald-800">
                <span className="text-emerald-700 dark:text-emerald-300 block text-[11px] font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Disbursed (Paid)
                </span>
                <span className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400 block truncate">
                  {fmtNpr(summary.paid_amount)}
                </span>
                <span className="text-[10px] text-emerald-700 dark:text-emerald-300">
                  {summary.paid_count.toLocaleString()} Paid Shareholders
                </span>
              </div>

              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-300 dark:border-amber-800">
                <span className="text-amber-700 dark:text-amber-300 block text-[11px] font-medium flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Remaining Outstanding
                </span>
                <span className="text-base font-bold font-mono text-amber-600 dark:text-amber-400 block truncate">
                  {fmtNpr(summary.remaining_amount)}
                </span>
                <span className="text-[10px] text-amber-700 dark:text-amber-300">
                  {summary.unpaid_count.toLocaleString()} Pending Payout
                </span>
              </div>

              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-300 dark:border-rose-800">
                <span className="text-rose-700 dark:text-rose-300 block text-[11px] font-medium flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Bank Error Returns
                </span>
                <span className="text-base font-bold font-mono text-rose-600 dark:text-rose-400 block truncate">
                  {fmtNpr(summary.failed_amount)}
                </span>
                <span className="text-[10px] text-rose-700 dark:text-rose-300">
                  {summary.failed_count.toLocaleString()} Returned Transactions
                </span>
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Disbursement Settlement Progress</span>
                <span className="font-mono font-bold text-foreground">
                  {summary.progress_percent}%
                </span>
              </div>
              <Progress value={summary.progress_percent} className="h-2" />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
