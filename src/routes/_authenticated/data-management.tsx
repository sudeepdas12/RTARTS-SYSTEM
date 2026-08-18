import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Download, Trash2, Eye, Database, Users, AlertTriangle,
  RefreshCw, Search, X, Building2, Calendar, TrendingUp,
  ChevronLeft, ChevronRight, Filter, ShieldAlert, FileX2,
  BarChart3, Layers, CheckCircle2, Clock,
} from "lucide-react";
import { toast } from "sonner";
import {
  DataManagementService,
  type CompanyFiscalData,
  type ClientFiscalData,
  type BulkDeleteResult,
} from "@/lib/services/data-management.service";

// ── Route search params ───────────────────────────────────────────────────────

interface DataManagementSearch {
  companyId?: string;
  fy?: string;
}

export const Route = createFileRoute("/_authenticated/data-management")({
  validateSearch: (search: Record<string, unknown>): DataManagementSearch => ({
    companyId: typeof search.companyId === "string" ? search.companyId : undefined,
    fy: typeof search.fy === "string" ? search.fy : undefined,
  }),
  component: DataManagementPage,
});

// ── Types ─────────────────────────────────────────────────────────────────────

type DeleteDialogState = {
  mode: "company-fy" | "company-all" | "fy-all" | "custom" | "all-clients";
  companyId?: string;
  companyName?: string;
  fiscalYear?: string;
  customOptions?: {
    companyId: string;
    deleteDividends: boolean;
    deleteInterests: boolean;
    deleteClients: boolean;
    deleteOrphans: boolean;
    deleteCompany: boolean;
    importedAfter?: string;
  };
} | null;

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined) =>
  n == null
    ? "—"
    : Number(n).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

const fmtCount = (n: number | null | undefined) =>
  n == null || n === 0 ? "—" : Number(n).toLocaleString();

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  icon: Icon,
  colorClass = "",
  subtitle,
}: {
  title: string;
  value: string;
  icon: React.ElementType;
  colorClass?: string;
  subtitle?: string;
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
            <p className={`text-2xl font-bold tabular-nums ${colorClass}`}>{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className={`rounded-xl p-2.5 ${colorClass ? "bg-current/10" : "bg-muted"}`}>
            <Icon className={`h-5 w-5 ${colorClass || "text-muted-foreground"}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DeleteResultsSummary({ results }: { results: BulkDeleteResult[] }) {
  const errors = results.filter((r) => r.error);
  const successes = results.filter((r) => !r.error);
  const totalDeleted = successes.reduce((s, r) => s + r.deleted, 0);

  return (
    <div className="space-y-3">
      {successes.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              Deleted {totalDeleted.toLocaleString()} records
            </span>
          </div>
          <ul className="space-y-1">
            {successes.map((r) => (
              <li key={r.table} className="text-xs text-emerald-600 dark:text-emerald-400 flex justify-between">
                <span>{r.table}</span>
                <span className="font-mono">{r.deleted.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {errors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <span className="text-sm font-semibold text-red-700 dark:text-red-400">
              {errors.length} error(s)
            </span>
          </div>
          <ul className="space-y-1">
            {errors.map((r) => (
              <li key={r.table} className="text-xs text-red-600 dark:text-red-400">
                <strong>{r.table}:</strong> {r.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

function DataManagementPage() {
  const { hasAny } = useAuth();
  const isAdmin = hasAny(["admin"]);
  const qc = useQueryClient();

  // ── Filter state ──────────────────────────────────────────────────────────
  const [selectedFy, setSelectedFy] = useState<string>("all");
  const [selectedCompany, setSelectedCompany] = useState<string>("all");
  const [summarySearch, setSummarySearch] = useState<string>("");
  const [summaryPage, setSummaryPage] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<string>("summary");

  // ── Client detail state ───────────────────────────────────────────────────
  const [detailCompany, setDetailCompany] = useState<{ id: string; name: string } | null>(null);
  const [detailFy, setDetailFy] = useState<string>("");
  const [detailType, setDetailType] = useState<"dividend" | "interest" | "all">("all");
  const [detailSearch, setDetailSearch] = useState<string>("");
  const [detailPage, setDetailPage] = useState<number>(1);
  
  // Initialize detail state from URL search params (companyId, fy)
  const search = Route.useSearch();

  // ── Delete dialog state ───────────────────────────────────────────────────
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(null);
  const [deleteOrphans, setDeleteOrphans] = useState<boolean>(false);

  // ── Delete results display ────────────────────────────────────────────────
  const [lastDeleteResults, setLastDeleteResults] = useState<BulkDeleteResult[] | null>(null);
  const [showDeleteResults, setShowDeleteResults] = useState<boolean>(false);

  // ── Danger zone state ─────────────────────────────────────────────────────
  const [dangerCompany, setDangerCompany] = useState<string>("all");
  const [dangerFy, setDangerFy] = useState<string>("all");
  const [dangerDate, setDangerDate] = useState<string>("");
  const [dangerDividends, setDangerDividends] = useState<boolean>(true);
  const [dangerInterests, setDangerInterests] = useState<boolean>(true);
  const [dangerClients, setDangerClients] = useState<boolean>(false);
  const [dangerDeleteCompany, setDangerDeleteCompany] = useState<boolean>(false);
  const [dangerDeleteOrphans, setDangerDeleteOrphans] = useState<boolean>(true);

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: companies = [] } = useQuery({
    queryKey: ["companies-lookup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, company_code, company_name")
        .order("company_name");
      if (error) throw error;
      return data as { id: string; company_code: string; company_name: string }[];
    },
  });

  const { data: fiscalYears = [] } = useQuery({
    queryKey: ["distinct-fiscal-years"],
    queryFn: () => DataManagementService.getDistinctFiscalYears(),
  });

  const companyMap = useMemo(
    () => Object.fromEntries(companies.map((c) => [c.id, c])),
    [companies]
  );

  // Initialize detail state from URL search params (companyId, fy)
  useEffect(() => {
    const companyId = search.companyId;
    const fy = search.fy;
    if (companyId && fy) {
      setDetailCompany({ id: companyId, name: companyMap[companyId]?.company_name || "" });
      setDetailFy(fy);
      setDetailPage(1);
      setActiveTab("clients");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, companyMap]);

  const { data: summary = [], isLoading: summaryLoading, refetch: refetchSummary } = useQuery({
    queryKey: ["company-fiscal-summary", selectedFy],
    queryFn: () =>
      DataManagementService.getCompanyFiscalSummary(
        selectedFy !== "all" ? selectedFy : undefined
      ),
  });

  const { data: clientDetail = [], isLoading: detailLoading } = useQuery({
    queryKey: ["client-fiscal-detail", detailCompany?.id, detailFy, detailType],
    queryFn: () =>
      DataManagementService.getClientFiscalDetail(
        detailCompany!.id,
        detailFy,
        detailType !== "all" ? detailType : undefined
      ),
    enabled: !!detailCompany && !!detailFy,
  });

  // ── Computed values ───────────────────────────────────────────────────────

  const filteredSummary = useMemo(() => {
    let data = summary;
    if (selectedCompany !== "all") {
      data = data.filter((s) => s.company_id === selectedCompany);
    }
    if (summarySearch.trim()) {
      const q = summarySearch.toLowerCase();
      data = data.filter(
        (s) =>
          s.company_name.toLowerCase().includes(q) ||
          s.company_code.toLowerCase().includes(q) ||
          s.fiscal_year.toLowerCase().includes(q)
      );
    }
    return data;
  }, [summary, selectedCompany, summarySearch]);

  const summaryPageCount = Math.max(1, Math.ceil(filteredSummary.length / PAGE_SIZE));
  const pagedSummary = filteredSummary.slice((summaryPage - 1) * PAGE_SIZE, summaryPage * PAGE_SIZE);

  const filteredClientDetail = useMemo(() => {
    if (!detailSearch.trim()) return clientDetail;
    const q = detailSearch.toLowerCase();
    return clientDetail.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        r.boid.toLowerCase().includes(q) ||
        r.client_code.toLowerCase().includes(q)
    );
  }, [clientDetail, detailSearch]);

  const detailPageCount = Math.max(1, Math.ceil(filteredClientDetail.length / PAGE_SIZE));
  const pagedClientDetail = filteredClientDetail.slice(
    (detailPage - 1) * PAGE_SIZE,
    detailPage * PAGE_SIZE
  );

  const summaryStats = useMemo(() => {
    const totalCompanies = new Set(filteredSummary.map((s) => s.company_id)).size;
    const totalRecords = filteredSummary.reduce(
      (s, r) => s + r.dividend_count + r.interest_count,
      0
    );
    const dividendGross = filteredSummary.reduce((s, r) => s + r.dividend_gross, 0);
    const interestGross = filteredSummary.reduce((s, r) => s + r.interest_gross, 0);
    const totalPaid = filteredSummary.reduce((s, r) => s + r.total_paid, 0);
    const totalPending = filteredSummary.reduce((s, r) => s + r.total_pending, 0);
    return { totalCompanies, totalRecords, dividendGross, interestGross, totalPaid, totalPending };
  }, [filteredSummary]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["company-fiscal-summary"] });
    qc.invalidateQueries({ queryKey: ["distinct-fiscal-years"] });
    qc.invalidateQueries({ queryKey: ["client-fiscal-detail"] });
    qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
    qc.invalidateQueries({ queryKey: ["companies-lookup"] });
  }, [qc]);

  const handleDeleteSuccess = useCallback((results: BulkDeleteResult[]) => {
    invalidateAll();
    setDeleteDialog(null);
    setDeleteOrphans(false);

    const errors = results.filter((r) => r.error);
    const totalDeleted = results.filter((r) => !r.error).reduce((s, r) => s + r.deleted, 0);

    setLastDeleteResults(results);
    setShowDeleteResults(true);

    if (errors.length > 0) {
      toast.error(`Operation completed with ${errors.length} error(s). ${totalDeleted} records deleted.`);
    } else {
      toast.success(`Successfully deleted ${totalDeleted.toLocaleString()} record(s)`);
    }
  }, [invalidateAll]);

  const bulkDelete = useMutation({
    mutationFn: async (): Promise<BulkDeleteResult[]> => {
      if (!deleteDialog) return [];
      switch (deleteDialog.mode) {
        case "company-fy":
          return DataManagementService.deleteByCompanyAndFiscalYear(
            deleteDialog.companyId!,
            deleteDialog.fiscalYear!,
            { deleteOrphanClients: deleteOrphans }
          );
        case "company-all":
          return DataManagementService.deleteAllCompanyData(deleteDialog.companyId!);
        case "fy-all":
          return DataManagementService.deleteByFiscalYear(deleteDialog.fiscalYear!);
        case "all-clients": {
          // Batched delete of all clients
          const BATCH = 200;
          let deleted = 0;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { data: batch, error: fe } = await supabase
              .from("clients")
              .select("id")
              .limit(BATCH);
            if (fe) throw fe;
            if (!batch || batch.length === 0) break;
            const ids = batch.map((c) => c.id);
            const { error: de } = await supabase.from("clients").delete().in("id", ids);
            if (de) throw de;
            deleted += ids.length;
          }
          return [{ table: "clients", deleted }];
        }
        case "custom":
          return DataManagementService.customBulkDelete(deleteDialog.customOptions!);
        default:
          return [];
      }
    },
    onSuccess: handleDeleteSuccess,
    onError: (e: Error) => {
      toast.error(`Delete failed: ${e.message}`);
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  const openDetail = (companyId: string, companyName: string, fy: string) => {
    setDetailCompany({ id: companyId, name: companyName });
    setDetailFy(fy);
    setDetailType("all");
    setDetailSearch("");
    setDetailPage(1);
    setActiveTab("clients");
  };

  const closeDetail = () => {
    setDetailCompany(null);
    setDetailFy("");
    setDetailSearch("");
    setDetailPage(1);
    setActiveTab("summary");
  };

  const openCompanyFyDelete = (row: CompanyFiscalData) => {
    setDeleteOrphans(false);
    setDeleteDialog({
      mode: "company-fy",
      companyId: row.company_id,
      companyName: row.company_name,
      fiscalYear: row.fiscal_year,
    });
  };

  const handleDangerDelete = () => {
    setDeleteDialog({
      mode: "custom",
      customOptions: {
        companyId: dangerCompany,
        deleteDividends: dangerDividends,
        deleteInterests: dangerInterests,
        deleteClients: dangerCompany === "all" ? dangerClients : false,
        deleteOrphans: dangerDeleteOrphans,
        deleteCompany: dangerCompany !== "all" ? dangerDeleteCompany : false,
        importedAfter: dangerDate || undefined,
      },
    });
  };

  const buildDeleteDescription = (): React.ReactNode => {
    if (!deleteDialog) return null;

    switch (deleteDialog.mode) {
      case "company-fy":
        return (
          <div className="space-y-3">
            <p>
              Permanently delete all dividend and interest payables for{" "}
              <strong>{deleteDialog.companyName}</strong> — fiscal year{" "}
              <strong className="font-mono">{deleteDialog.fiscalYear}</strong>.
            </p>
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3">
              <Checkbox
                id="orphanCheck"
                checked={deleteOrphans}
                onCheckedChange={(v) => setDeleteOrphans(!!v)}
              />
              <Label htmlFor="orphanCheck" className="text-sm cursor-pointer leading-snug">
                Also remove <strong>orphaned clients</strong> — clients who have no remaining
                payables after this deletion
              </Label>
            </div>
          </div>
        );

      case "company-all":
        return (
          <p>
            Permanently delete <strong>ALL</strong> dividend payables, interest payables, payments,
            and reconciliation results for <strong>{deleteDialog.companyName}</strong> across all
            fiscal years.
          </p>
        );

      case "fy-all":
        return (
          <p>
            Permanently delete <strong>ALL</strong> dividend and interest payables for fiscal year{" "}
            <strong className="font-mono">{deleteDialog.fiscalYear}</strong> across{" "}
            <strong>ALL companies</strong>.
          </p>
        );

      case "all-clients":
        return (
          <p>
            Permanently delete <strong>ALL client records</strong> from the database. This will
            also cascade to any related payables and payments.
          </p>
        );

      case "custom": {
        const opts = deleteDialog.customOptions!;
        const companyLabel =
          opts.companyId !== "all"
            ? companyMap[opts.companyId]?.company_name || opts.companyId
            : "ALL companies";
        return (
          <div className="space-y-3">
            <p>
              Permanently delete the selected data
              {opts.companyId !== "all" ? ` for ${companyLabel}` : " across ALL companies"}
              {opts.importedAfter ? ` imported on or after ${opts.importedAfter}` : ""}.
            </p>
            <ul className="list-none space-y-1.5 rounded-lg border bg-muted/40 p-3 text-sm">
              {opts.deleteDividends && (
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  Dividend Payables
                </li>
              )}
              {opts.deleteInterests && (
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  Interest Payables
                </li>
              )}
              {opts.deleteClients && (
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  All Client Records (Global)
                </li>
              )}
              {opts.deleteOrphans && (
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                  Orphaned Clients (cleanup)
                </li>
              )}
              {opts.deleteCompany && (
                <li className="flex items-center gap-2 font-bold text-destructive">
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                  Company Record Itself
                </li>
              )}
            </ul>
          </div>
        );
      }
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Management"
        description="Manage fiscal year data — view summaries, drill into client records, export, and perform bulk deletions."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="h-10">
          <TabsTrigger value="summary" className="gap-2">
            <BarChart3 className="h-4 w-4" /> Fiscal Summary
          </TabsTrigger>
          <TabsTrigger value="clients" className="gap-2">
            <Users className="h-4 w-4" /> Client Detail
            {detailCompany && (
              <Badge variant="secondary" className="ml-1 py-0 px-1.5 text-[10px]">
                {detailCompany.name}
              </Badge>
            )}
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="danger" className="gap-2 text-destructive data-[state=active]:text-destructive">
              <ShieldAlert className="h-4 w-4" /> Danger Zone
            </TabsTrigger>
          )}
        </TabsList>

        {/* ═══════════════════════════════════════════════════════
            TAB 1 — FISCAL SUMMARY
        ═══════════════════════════════════════════════════════ */}
        <TabsContent value="summary" className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">Company × Fiscal Year Summary</CardTitle>
                  <CardDescription>
                    {filteredSummary.length} record{filteredSummary.length !== 1 ? "s" : ""} found — click the{" "}
                    <Eye className="inline h-3 w-3 mx-0.5" /> icon to view client-level detail
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => refetchSummary()} disabled={summaryLoading}>
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${summaryLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filteredSummary.length === 0}
                    onClick={() => {
                      DataManagementService.exportCompanyFiscalToExcel(
                        filteredSummary,
                        `company_fiscal_summary${selectedFy !== "all" ? `_${selectedFy}` : ""}`
                      );
                      toast.success("Exported successfully");
                    }}
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Export
                  </Button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search company or FY…"
                    value={summarySearch}
                    onChange={(e) => { setSummarySearch(e.target.value); setSummaryPage(1); }}
                    className="pl-8 h-8 text-sm"
                  />
                  {summarySearch && (
                    <button
                      onClick={() => { setSummarySearch(""); setSummaryPage(1); }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Select value={selectedFy} onValueChange={(v) => { setSelectedFy(v); setSummaryPage(1); }}>
                  <SelectTrigger className="w-40 h-8 text-sm">
                    <Calendar className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                    <SelectValue placeholder="All fiscal years" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All fiscal years</SelectItem>
                    {fiscalYears.map((fy) => (
                      <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedCompany} onValueChange={(v) => { setSelectedCompany(v); setSummaryPage(1); }}>
                  <SelectTrigger className="w-56 h-8 text-sm">
                    <Building2 className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                    <SelectValue placeholder="All companies" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All companies</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.company_code} — {c.company_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
<CardContent className="px-0 pb-0">
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-6">Company</TableHead>
                      <TableHead>FY</TableHead>
                      <TableHead className="text-right">Div. Count</TableHead>
                      <TableHead className="text-right">Div. Gross</TableHead>
                      <TableHead className="text-right">Div. Net</TableHead>
                      <TableHead className="text-right">Int. Count</TableHead>
                      <TableHead className="text-right">Int. Gross</TableHead>
                      <TableHead className="text-right">Int. Net</TableHead>
                      <TableHead className="text-right text-emerald-600">Paid</TableHead>
                      <TableHead className="text-right text-amber-600">Pending</TableHead>
                      <TableHead className="pr-6 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaryLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 11 }).map((_, j) => (
                            <TableCell key={j}>
                              <div className="h-4 rounded bg-muted animate-pulse" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : pagedSummary.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={11} className="py-16 text-center text-muted-foreground">
                          <FileX2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                          <p className="text-sm">No data found matching your filters.</p>
                        </TableCell>
                      </TableRow>
                    ) : (
pagedSummary.map((row) => (
                        <TableRow key={`${row.company_id}|${row.fiscal_year}`} className="group">
                          <TableCell className="pl-6">
                            <div>
                              <span className="font-medium text-sm">{row.company_name}</span>
                              <span className="ml-1.5 font-mono text-[10px] text-muted-foreground bg-muted px-1 rounded">
                                {companyMap[row.company_id]?.company_code ?? ""}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {row.fiscal_year}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{fmtCount(row.dividend_count)}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{fmt(row.dividend_gross)}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{fmt(row.dividend_net)}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{fmtCount(row.interest_count)}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{fmt(row.interest_gross)}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{fmt(row.interest_net)}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-semibold text-emerald-600">
                            {fmt(row.total_paid)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-semibold text-amber-600">
                            {fmt(row.total_pending)}
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => openDetail(row.company_id, row.company_name, row.fiscal_year)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {summaryPageCount > 1 && (
                <div className="flex items-center justify-between border-t px-6 py-3">
                  <p className="text-xs text-muted-foreground">
                    Page {summaryPage} of {summaryPageCount} · {filteredSummary.length} rows
                  </p>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={summaryPage <= 1}
                      onClick={() => setSummaryPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={summaryPage >= summaryPageCount}
                      onClick={() => setSummaryPage((p) => Math.min(summaryPageCount, p + 1))}
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
            TAB 2 — CLIENT DETAIL
        ═══════════════════════════════════════════════════════ */}
        <TabsContent value="clients" className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    Client Detail
                    {detailCompany && (
                      <Badge variant="secondary" className="font-normal">
                        {detailCompany.name}
                        <span className="mx-1 text-muted-foreground">·</span>
                        <span className="font-mono">{detailFy}</span>
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {detailCompany
                      ? `${filteredClientDetail.length} client record${filteredClientDetail.length !== 1 ? "s" : ""} found`
                      : "Click the eye icon on any summary row to view client-level detail"}
                  </CardDescription>
                </div>
                {detailCompany && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={clientDetail.length === 0}
                      onClick={() => {
                        DataManagementService.exportClientFiscalToExcel(
                          filteredClientDetail,
                          `clients_${detailCompany.name}_${detailFy}`
                        );
                        toast.success("Exported successfully");
                      }}
                    >
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                      Export
                    </Button>
                    <Button variant="ghost" size="sm" onClick={closeDetail}>
                      <X className="h-3.5 w-3.5 mr-1.5" />
                      Close
                    </Button>
                  </div>
                )}
              </div>

              {detailCompany && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search by name, BOID, code…"
                      value={detailSearch}
                      onChange={(e) => { setDetailSearch(e.target.value); setDetailPage(1); }}
                      className="pl-8 h-8 text-sm"
                    />
                    {detailSearch && (
                      <button
                        onClick={() => { setDetailSearch(""); setDetailPage(1); }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <Select
                    value={detailType}
                    onValueChange={(v) => { setDetailType(v as "dividend" | "interest" | "all"); setDetailPage(1); }}
                  >
                    <SelectTrigger className="w-36 h-8 text-sm">
                      <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="dividend">Dividend only</SelectItem>
                      <SelectItem value="interest">Interest only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardHeader>

            <CardContent className="px-0 pb-0">
              {!detailCompany ? (
                <div className="py-20 text-center text-muted-foreground">
                  <Eye className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p className="text-sm font-medium">No company selected</p>
                  <p className="text-xs mt-1 text-muted-foreground/70">
                    Go to Fiscal Summary and click the <Eye className="inline h-3 w-3 mx-0.5" /> icon on any row
                  </p>
                </div>
              ) : (
                <>
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="pl-6">Client Name</TableHead>
                          <TableHead>BOID</TableHead>
                          <TableHead>Code</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Gross</TableHead>
                          <TableHead className="text-right">Tax</TableHead>
                          <TableHead className="text-right">Net</TableHead>
                          <TableHead className="pr-6">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailLoading ? (
                          Array.from({ length: 8 }).map((_, i) => (
                            <TableRow key={i}>
                              {Array.from({ length: 8 }).map((_, j) => (
                                <TableCell key={j}>
                                  <div className="h-4 rounded bg-muted animate-pulse" />
                                </TableCell>
                              ))}
                            </TableRow>
                          ))
                        ) : pagedClientDetail.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="py-16 text-center text-muted-foreground">
                              <FileX2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                              <p className="text-sm">No records found.</p>
                            </TableCell>
                          </TableRow>
                        ) : (
                          pagedClientDetail.map((row, idx) => (
                            <TableRow key={`${row.client_id}-${row.payable_type}-${idx}`}>
                              <TableCell className="pl-6 font-medium text-sm">{row.full_name}</TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">{row.boid || "—"}</TableCell>
                              <TableCell className="font-mono text-xs">{row.client_code || "—"}</TableCell>
                              <TableCell>
                                <Badge
                                  variant={row.payable_type === "dividend" ? "default" : "secondary"}
                                  className="text-[10px] capitalize"
                                >
                                  {row.payable_type}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-sm">{fmt(row.gross_amount)}</TableCell>
                              <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{fmt(row.tax_amount)}</TableCell>
                              <TableCell className="text-right tabular-nums text-sm font-semibold">{fmt(row.net_amount)}</TableCell>
                              <TableCell className="pr-6">
                                <Badge
                                  variant={
                                    row.payment_status === "Paid"
                                      ? "default"
                                      : row.payment_status === "Partial"
                                        ? "secondary"
                                        : "outline"
                                  }
                                  className={`text-[10px] ${
                                    row.payment_status === "Paid"
                                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0"
                                      : row.payment_status === "Partial"
                                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0"
                                        : ""
                                  }`}
                                >
                                  {row.payment_status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Pagination */}
                  {detailPageCount > 1 && (
                    <div className="flex items-center justify-between border-t px-6 py-3">
                      <p className="text-xs text-muted-foreground">
                        Page {detailPage} of {detailPageCount} · {filteredClientDetail.length} rows
                      </p>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={detailPage <= 1}
                          onClick={() => setDetailPage((p) => Math.max(1, p - 1))}
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={detailPage >= detailPageCount}
                          onClick={() => setDetailPage((p) => Math.min(detailPageCount, p + 1))}
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Totals */}
                  {filteredClientDetail.length > 0 && (
                    <div className="border-t px-6 py-4">
                      <div className="grid gap-3 sm:grid-cols-3">
                        {[
                          { label: "Total Gross", key: "gross_amount" as const, color: "" },
                          { label: "Total Tax", key: "tax_amount" as const, color: "text-muted-foreground" },
                          { label: "Total Net", key: "net_amount" as const, color: "text-foreground" },
                        ].map(({ label, key, color }) => (
                          <div key={label} className="rounded-lg border bg-muted/30 p-3">
                            <p className="text-xs text-muted-foreground">{label}</p>
                            <p className={`text-lg font-bold tabular-nums mt-0.5 ${color}`}>
                              {fmt(filteredClientDetail.reduce((s, r) => s + r[key], 0))}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════
            TAB 3 — DANGER ZONE (admin only)
        ═══════════════════════════════════════════════════════ */}
        {isAdmin && (
          <TabsContent value="danger" className="space-y-5">
            {/* Last delete results */}
            {showDeleteResults && lastDeleteResults && (
              <Card className="border-emerald-200 dark:border-emerald-800">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      Last Delete Operation Results
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setShowDeleteResults(false)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <DeleteResultsSummary results={lastDeleteResults} />
                </CardContent>
              </Card>
            )}

            <div className="rounded-lg border border-destructive/30 bg-destructive/[0.02] p-1">
              <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 mb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                  <p className="text-sm font-medium text-destructive">
                    All operations in this zone are irreversible. Proceed with extreme caution.
                  </p>
                </div>
              </div>

              <div className="space-y-5 p-3">
                {/* Section 1: Custom bulk delete */}
                <div>
                  <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive/10 text-destructive text-[10px] font-bold">1</span>
                    Advanced Bulk Delete
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Specify filters and select what data to delete. All deletions are performed server-side with audit logging.
                  </p>

                  <div className="grid gap-4 md:grid-cols-2">
                    {/* Left: filters */}
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Company Scope</Label>
                        <Select value={dangerCompany} onValueChange={setDangerCompany}>
                          <SelectTrigger className="h-8 text-sm">
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
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Imported On or After (optional)</Label>
                        <Input
                          type="date"
                          value={dangerDate}
                          onChange={(e) => setDangerDate(e.target.value)}
                          className="h-8 text-sm"
                        />
                        {dangerDate && (
                          <button
                            onClick={() => setDangerDate("")}
                            className="text-xs text-muted-foreground underline hover:text-foreground"
                          >
                            Clear date filter
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Right: data type checkboxes */}
                    <div className="rounded-lg border border-destructive/20 bg-muted/20 p-3 space-y-2.5">
                      <Label className="text-xs font-medium block mb-1">Data to Delete</Label>

                      <div className="flex items-center gap-2.5">
                        <Checkbox
                          id="del-div"
                          checked={dangerDividends}
                          onCheckedChange={(v) => setDangerDividends(!!v)}
                        />
                        <Label htmlFor="del-div" className="text-sm cursor-pointer">
                          Dividend Payables
                        </Label>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <Checkbox
                          id="del-int"
                          checked={dangerInterests}
                          onCheckedChange={(v) => setDangerInterests(!!v)}
                        />
                        <Label htmlFor="del-int" className="text-sm cursor-pointer">
                          Interest Payables
                        </Label>
                      </div>

                      <Separator className="my-2" />

                      {dangerCompany === "all" ? (
                        <div className="flex items-center gap-2.5">
                          <Checkbox
                            id="del-cli"
                            checked={dangerClients}
                            onCheckedChange={(v) => setDangerClients(!!v)}
                          />
                          <Label htmlFor="del-cli" className="text-sm cursor-pointer">
                            <span className="font-semibold text-destructive">All Client Records</span>
                            <span className="text-xs text-muted-foreground ml-1">(global purge)</span>
                          </Label>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">
                          Clients are global — select "All Companies" to delete clients globally.
                        </p>
                      )}

                      <div className="flex items-start gap-2.5">
                        <Checkbox
                          id="del-orphans"
                          checked={dangerDeleteOrphans}
                          onCheckedChange={(v) => setDangerDeleteOrphans(!!v)}
                          className="mt-0.5"
                        />
                        <Label htmlFor="del-orphans" className="text-sm cursor-pointer leading-snug">
                          Clean up <strong>Orphaned Clients</strong>
                          <span className="text-xs text-muted-foreground block">
                            clients with no remaining payable records
                          </span>
                        </Label>
                      </div>

                      {dangerCompany !== "all" && (
                        <div className="flex items-start gap-2.5 pt-1 border-t border-destructive/20">
                          <Checkbox
                            id="del-company"
                            checked={dangerDeleteCompany}
                            onCheckedChange={(v) => setDangerDeleteCompany(!!v)}
                            className="mt-0.5"
                          />
                          <Label htmlFor="del-company" className="text-sm cursor-pointer leading-snug">
                            <span className="font-semibold text-destructive">Delete Company Record</span>
                            <span className="text-xs text-muted-foreground block">
                              permanently removes the company from the system
                            </span>
                          </Label>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex justify-end">
                    <Button
                      variant="destructive"
                      disabled={!dangerDividends && !dangerInterests && !dangerClients && !dangerDeleteOrphans && !dangerDeleteCompany}
                      onClick={handleDangerDelete}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Selected Data
                    </Button>
                  </div>
                </div>

                <Separator />

                {/* Section 2: Delete all clients */}
                <div>
                  <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive/10 text-destructive text-[10px] font-bold">2</span>
                    Global Client Purge
                  </h3>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-red-50 dark:bg-red-950/20 p-4">
                    <div>
                      <p className="text-sm font-medium">Delete ALL Clients</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Removes every client record from the database. This is batched and may take a moment.
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setDeleteDialog({ mode: "all-clients" })}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      Delete All Clients
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* ═══════════════════════════════════════════════════════
          DELETE CONFIRMATION DIALOG
      ═══════════════════════════════════════════════════════ */}
      <AlertDialog
        open={!!deleteDialog}
        onOpenChange={(open) => {
          if (!open && !bulkDelete.isPending) setDeleteDialog(null);
        }}
      >
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              Confirm Bulk Delete
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-foreground/80 space-y-3 pt-1">
                {buildDeleteDescription()}
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 mt-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  <span className="text-xs font-semibold text-destructive">
                    This action cannot be undone.
                  </span>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDelete.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
              onClick={(e) => {
                e.preventDefault();
                bulkDelete.mutate();
              }}
              disabled={bulkDelete.isPending}
            >
              {bulkDelete.isPending ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  Confirm Delete
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}