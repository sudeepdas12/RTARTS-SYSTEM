import { Building2, CreditCard, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ReconciliationMatch } from "@/lib/reconciliation-engine";

export function getReconciliationStatusBadgeVariant(status: string) {
  switch (status) {
    case "Matched":
      return "default" as const;
    case "Missing":
    case "Rejected":
      return "destructive" as const;
    case "Over_Paid":
    case "Under_Paid":
    case "Pending":
      return "outline" as const;
    case "Pledged":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

export function ReconciliationPaginationToolbar({
  totalItems,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  totalItems: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  if (totalItems === 0) return null;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between border-t pt-3 mt-3 text-xs text-muted-foreground flex-wrap gap-2">
      <div className="flex items-center gap-2">
        <span>
          Showing <strong className="text-foreground">{startItem.toLocaleString()}</strong> to{" "}
          <strong className="text-foreground">{endItem.toLocaleString()}</strong> of{" "}
          <strong className="text-foreground">{totalItems.toLocaleString()}</strong> records
        </span>
        <Select
          value={String(pageSize)}
          onValueChange={(val) => {
            onPageSizeChange(Number(val));
          }}
        >
          <SelectTrigger className="h-7 w-[95px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="25">25 / page</SelectItem>
            <SelectItem value="50">50 / page</SelectItem>
            <SelectItem value="100">100 / page</SelectItem>
            <SelectItem value="250">250 / page</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
        >
          Previous
        </Button>
        <span className="px-2 font-medium text-foreground">
          Page {currentPage} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export function ReconciliationMatchRowCard({
  match,
  isSelected,
  onToggleSelect,
  onInspect,
}: {
  match: ReconciliationMatch;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onInspect: (match: ReconciliationMatch) => void;
}) {
  return (
    <div
      className={`rounded-lg border p-3.5 transition-all ${
        isSelected ? "border-primary/50 bg-primary/5 shadow-sm" : "bg-background hover:bg-muted/30"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect(match.id)}
            aria-label={`Select ${match.shareholderName}`}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-foreground">
                {match.shareholderName || "Unknown Shareholder"}
              </span>
              <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground border">
                BOID: {match.boid}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge
                variant={getReconciliationStatusBadgeVariant(match.status)}
                className="text-xs"
              >
                {match.status.replace("_", " ")}
              </Badge>
              {match.confidenceScore !== undefined && match.confidenceScore > 0 && (
                <Badge
                  variant="outline"
                  className={`text-[10px] h-5 font-semibold ${
                    match.confidenceScore >= 90
                      ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                      : match.confidenceScore >= 70
                        ? "border-amber-500/40 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                        : "border-rose-500/40 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400"
                  }`}
                >
                  {match.confidenceScore}% Match
                </Badge>
              )}
              {match.matchSources && match.matchSources.length > 0 && (
                <div className="flex gap-1">
                  {match.matchSources.map((source) => (
                    <Badge key={source} variant="outline" className="text-[10px] h-5 capitalize">
                      {source}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-muted-foreground">
            {(match.bankName || match.bankAccountNo) && (
              <div className="flex items-center gap-1">
                <CreditCard className="w-3.5 h-3.5 text-muted-foreground/70" />
                <span>
                  <strong>{match.bankName || "Bank"}</strong>
                  {match.bankAccountNo ? ` • A/C: ${match.bankAccountNo}` : ""}
                </span>
              </div>
            )}
            {match.payableType && (
              <div className="flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-muted-foreground/70" />
                <span className="capitalize">{match.payableType} Payable</span>
              </div>
            )}
            {match.category && (
              <div>
                <span>
                  Category: <strong className="text-foreground">{match.category}</strong>
                </span>
              </div>
            )}
            {match.transactionDate && (
              <div>
                <span>Txn Date: {match.transactionDate}</span>
              </div>
            )}
            {match.status === "Missing" &&
              match.transactionDate &&
              String(match.transactionDate) < "2026-01-01" && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 text-amber-700 dark:text-amber-300 border-amber-300/80 bg-amber-50 dark:bg-amber-950/40"
                >
                  Prior FY (Historical)
                </Badge>
              )}
          </div>

          {match.transactionDescription && (
            <div className="mt-1 text-[11px] text-muted-foreground/85 flex items-center gap-1.5 truncate">
              <span className="font-medium text-foreground/70">Narration / Ref:</span>
              <span className="font-mono truncate">{match.transactionDescription}</span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2.5 p-2 bg-muted/20 rounded-md border text-xs">
            <div>
              <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">
                Excel / Bank
              </span>
              <span className="font-mono font-semibold text-foreground">
                NPR {match.excelAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">
                System Amount
              </span>
              <span className="font-mono font-semibold text-foreground">
                NPR {match.systemAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">
                Difference
              </span>
              <span
                className={`font-mono font-bold ${
                  match.difference !== 0 ? "text-destructive" : "text-green-600 dark:text-green-400"
                }`}
              >
                {match.difference !== 0
                  ? (match.difference > 0 ? "+" : "") +
                    match.difference.toLocaleString("en-IN", { minimumFractionDigits: 2 })
                  : "0.00"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">
                Status in DB
              </span>
              <span className="font-medium text-foreground">
                {match.paymentStatus ? (
                  <Badge
                    variant={match.paymentStatus === "Paid" ? "default" : "outline"}
                    className="text-[10px] h-4"
                  >
                    {match.paymentStatus}
                  </Badge>
                ) : (
                  "Unpaid / Pending"
                )}
              </span>
            </div>
          </div>
        </div>
        <div className="pt-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            title="Inspect Details"
            onClick={() => onInspect(match)}
          >
            <Eye className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ReconciliationMatchTableView({
  matches,
  selectedMatchIds,
  onSetSelectedMatchIds,
  onToggleSelect,
  onInspect,
}: {
  matches: ReconciliationMatch[];
  selectedMatchIds: Set<string>;
  onSetSelectedMatchIds: (next: Set<string>) => void;
  onToggleSelect: (id: string) => void;
  onInspect: (match: ReconciliationMatch) => void;
}) {
  return (
    <div className="border rounded-md overflow-x-auto bg-background">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={matches.length > 0 && matches.every((m) => selectedMatchIds.has(m.id))}
                onCheckedChange={(checked) => {
                  const next = new Set(selectedMatchIds);
                  if (checked) {
                    matches.forEach((m) => next.add(m.id));
                  } else {
                    matches.forEach((m) => next.delete(m.id));
                  }
                  onSetSelectedMatchIds(next);
                }}
                aria-label="Select all on this page"
              />
            </TableHead>
            <TableHead className="font-semibold text-xs">Shareholder / BOID</TableHead>
            <TableHead className="font-semibold text-xs">Category</TableHead>
            <TableHead className="font-semibold text-xs">Bank / Account</TableHead>
            <TableHead className="text-right font-semibold text-xs">Statement / Excel</TableHead>
            <TableHead className="text-right font-semibold text-xs">System Amount</TableHead>
            <TableHead className="text-right font-semibold text-xs">Difference</TableHead>
            <TableHead className="font-semibold text-xs">Confidence</TableHead>
            <TableHead className="text-center font-semibold text-xs">Status</TableHead>
            <TableHead className="text-center font-semibold text-xs w-16">Inspect</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {matches.map((match) => {
            const isSelected = selectedMatchIds.has(match.id);
            return (
              <TableRow
                key={match.id}
                className={`cursor-pointer transition-colors ${
                  isSelected ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/40"
                }`}
                onClick={() => onToggleSelect(match.id)}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onToggleSelect(match.id)}
                    aria-label={`Select ${match.shareholderName}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="font-medium text-xs text-foreground">
                    {match.shareholderName || "Unknown Shareholder"}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {match.boid || "—"}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[11px]">
                    {match.category || "General"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="text-xs">{match.bankName || "—"}</div>
                  {match.bankAccountNo && (
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {match.bankAccountNo}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono font-medium text-xs">
                  NPR {match.excelAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                  NPR {match.systemAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold text-xs">
                  <span
                    className={
                      match.difference !== 0
                        ? "text-destructive"
                        : "text-emerald-600 dark:text-emerald-400"
                    }
                  >
                    {match.difference !== 0
                      ? (match.difference > 0 ? "+" : "") +
                        match.difference.toLocaleString("en-IN", { minimumFractionDigits: 2 })
                      : "0.00"}
                  </span>
                </TableCell>
                <TableCell>
                  {match.confidenceScore !== undefined && match.confidenceScore > 0 ? (
                    <Badge
                      variant="outline"
                      className={`text-[10px] h-5 font-semibold ${
                        match.confidenceScore >= 90
                          ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                          : match.confidenceScore >= 70
                            ? "border-amber-500/40 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                            : "border-rose-500/40 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400"
                      }`}
                    >
                      {match.confidenceScore}%
                    </Badge>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  <Badge
                    variant={getReconciliationStatusBadgeVariant(match.status)}
                    className="text-[11px]"
                  >
                    {match.status.replace("_", " ")}
                  </Badge>
                </TableCell>
                <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    title="Inspect Transaction Details"
                    onClick={() => onInspect(match)}
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
