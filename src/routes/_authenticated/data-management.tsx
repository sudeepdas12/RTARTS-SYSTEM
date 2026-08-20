import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Download,
  Trash2,
  Eye,
  Users,
  AlertTriangle,
  RefreshCw,
  Search,
  X,
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Filter,
  ShieldAlert,
  FileX2,
  BarChart3,
  Layers,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  DataManagementService,
  type CompanyFiscalData,
  type BulkDeleteResult,
} from "@/lib/services/data-management.service";

// ── Route search params ───────────────────────────────────────────────────────

interface DataManagementSearch {
  companyId?: string;
  fy?: string;
  tab?: string;
}

export const Route = createFileRoute("/_authenticated/data-management")({
  validateSearch: (search: Record<string, unknown>): DataManagementSearch => ({
    companyId: typeof search.companyId === "string" ? search.companyId : undefined,
    fy: typeof search.fy === "string" ? search.fy : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
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
    deleteMutualFunds: boolean;
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

function DataManagementPage() {
  const { hasAny } = useAuth();
  const isAdmin = hasAny(["admin"]);
  const qc = useQueryClient();
  const search = Route.useSearch();

  const [activeTab, setActiveTab] = useState<string>(search.tab || "clients");

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

  const [explorerCompanyId, setExplorerCompanyId] = useState<string>(search.companyId || "");
  const [explorerFy, setExplorerFy] = useState<string>(search.fy || "");
  const [explorerType, setExplorerType] = useState<"dividend" | "interest" | "mutual_fund" | "all">("all");
  const [explorerSearch, setExplorerSearch] = useState<string>("");
  const [explorerPage, setExplorerPage] = useState<number>(1);

  useEffect(() => {
    if (search.companyId) setExplorerCompanyId(search.companyId);
    else if (!explorerCompanyId && companies.length > 0) setExplorerCompanyId(companies[0].id);

    if (search.fy) setExplorerFy(search.fy);
    else if (!explorerFy && fiscalYears.length > 0) setExplorerFy(fiscalYears[0]);
  }, [search, companies, fiscalYears]);

  const selectedExplorerCompany = useMemo(
    () => companies.find((c) => c.id === explorerCompanyId),
    [companies, explorerCompanyId]
  );

  const { data: clientDetail = [], isLoading: detailLoading, refetch: refetchClientDetail } = useQuery({
    queryKey: ["client-fiscal-detail", explorerCompanyId, explorerFy, explorerType],
    queryFn: () =>
      DataManagementService.getClientFiscalDetail(
        explorerCompanyId,
        explorerFy,
        explorerType !== "all" ? explorerType : undefined
      ),
    enabled: !!explorerCompanyId && !!explorerFy,
  });

  const filteredClientDetail = useMemo(() => {
    if (!explorerSearch.trim()) return clientDetail;
    const q = explorerSearch.toLowerCase();
    return clientDetail.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        r.boid.toLowerCase().includes(q) ||
        r.client_code.toLowerCase().includes(q)
    );
  }, [clientDetail, explorerSearch]);

  const detailPageCount = Math.max(1, Math.ceil(filteredClientDetail.length / PAGE_SIZE));
  const pagedClientDetail = filteredClientDetail.slice(
    (explorerPage - 1) * PAGE_SIZE,
    explorerPage * PAGE_SIZE
  );

  const [opsFy, setOpsFy] = useState<string>("all");
  const [opsCompany, setOpsCompany] = useState<string>("all");
  const [opsSearch, setOpsSearch] = useState<string>("");
  const [opsPage, setOpsPage] = useState<number>(1);

  const { data: summary = [], isLoading: summaryLoading, refetch: refetchSummary } = useQuery({
    queryKey: ["company-fiscal-summary", opsFy],
    queryFn: () =>
      DataManagementService.getCompanyFiscalSummary(opsFy !== "all" ? opsFy : undefined),
  });

  const filteredSummary = useMemo(() => {
    let data = summary;
    if (opsCompany !== "all") {
      data = data.filter((s) => s.company_id === opsCompany);
    }
    if (opsSearch.trim()) {
      const q = opsSearch.toLowerCase();
      data = data.filter(
        (s) =>
          s.company_name.toLowerCase().includes(q) ||
          s.company_code.toLowerCase().includes(q) ||
          s.fiscal_year.toLowerCase().includes(q)
      );
    }
    return data;
  }, [summary, opsCompany, opsSearch]);

  const opsPageCount = Math.max(1, Math.ceil(filteredSummary.length / PAGE_SIZE));
  const pagedSummary = filteredSummary.slice((opsPage - 1) * PAGE_SIZE, opsPage * PAGE_SIZE);

  const [dangerCompany, setDangerCompany] = useState<string>("all");
  const [dangerDate, setDangerDate] = useState<string>("");
  const [dangerDividends, setDangerDividends] = useState<boolean>(true);
  const [dangerMutualFunds, setDangerMutualFunds] = useState<boolean>(true);
  const [dangerInterests, setDangerInterests] = useState<boolean>(true);
  const [dangerClients, setDangerClients] = useState<boolean>(false);
  const [dangerDeleteCompany, setDangerDeleteCompany] = useState<boolean>(false);
  const [dangerDeleteOrphans, setDangerDeleteOrphans] = useState<boolean>(true);

  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(null);
  const [deleteOrphans, setDeleteOrphans] = useState<boolean>(false);
  const [lastDeleteResults, setLastDeleteResults] = useState<BulkDeleteResult[] | null>(null);
  const [showDeleteResults, setShowDeleteResults] = useState<boolean>(false);

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["company-fiscal-summary"] });
    qc.invalidateQueries({ queryKey: ["distinct-fiscal-years"] });
    qc.invalidateQueries({ queryKey: ["client-fiscal-detail"] });
    qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
    qc.invalidateQueries({ queryKey: ["companies-lookup"] });
  }, [qc]);

  const handleDeleteSuccess = useCallback(
    (results: BulkDeleteResult[]) => {
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
    },
    [invalidateAll]
  );

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
          const BATCH = 200;
          let deleted = 0;
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

  const openCompanyFyDelete = (row: CompanyFiscalData) => {
    setDeleteOrphans(false);
    setDeleteDialog({
      mode: "company-fy",
      companyId: row.company_id,
      companyName: row.company_name,
      fiscalYear: row.fiscal_year,
    });
  };

  const handleInspectCompanyFy = (companyId: string, fy: string) => {
    setExplorerCompanyId(companyId);
    setExplorerFy(fy);
    setExplorerPage(1);
    setExplorerSearch("");
    setActiveTab("clients");
  };

  const handleDangerDelete = () => {
    setDeleteDialog({
      mode: "custom",
      customOptions: {
        companyId: dangerCompany,
        deleteDividends: dangerDividends,
        deleteInterests: dangerInterests,
        deleteMutualFunds: dangerMutualFunds,
        deleteClients: dangerClients,
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
              Permanently delete all dividend, mutual fund, and interest payables for{" "}
              <strong>{deleteDialog.companyName}</strong> — fiscal year{" "}
              <strong className="font-mono">{deleteDialog.fiscalYear}</strong>.
            </p>
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3">
              <Checkbox
                id="del-orphans"
                checked={deleteOrphans}
                onCheckedChange={(v) => setDeleteOrphans(!!v)}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <Label htmlFor="del-orphans" className="text-xs font-semibold cursor-pointer">
                  Also remove orphaned client records
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Deletes client profiles associated with this company that have no other payable transactions.
                </p>
              </div>
            </div>
          </div>
        );
      case "custom": {
        const opts = deleteDialog.customOptions!;
        const companyLabel =
          opts.companyId === "all"
            ? "ALL Companies"
            : companyMap[opts.companyId]?.company_name || opts.companyId;

        return (
          <div className="space-y-3">
            <p className="text-sm">
              You are about to delete selected records
              {opts.companyId !== "all" ? ` for ${companyLabel}` : " across ALL companies"}
              {opts.importedAfter ? ` imported on or after ${opts.importedAfter}` : ""}.
            </p>
            <ul className="list-none space-y-1.5 rounded-lg border bg-muted/40 p-3 text-sm">
              {opts.deleteDividends && (
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  Equity Dividend Payables
                </li>
              )}
              {opts.deleteMutualFunds && (
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  Mutual Fund Payables
                </li>
              )}
              {opts.deleteInterests && (
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  Debenture Interest Payables
                </li>
              )}
              {opts.deleteClients && (
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  Client Records
                </li>
              )}
              {opts.deleteCompany && (
                <li className="flex items-center gap-2 font-bold text-destructive">
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                  Company Master Record
                </li>
              )}
            </ul>
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Data Management & Operations"
        description="Inspect client-level payables, prune fiscal-year datasets, and perform secure database maintenance."
      />

      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-background to-background">
        <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Looking for high-level fiscal reporting and charts?</p>
              <p className="text-xs text-muted-foreground">
                View executive KPIs, instrument distributions, and payment status progress bars in the Analytics Workspace.
              </p>
            </div>
          </div>
          <Link to="/analytics">
            <Button variant="outline" size="sm" className="shrink-0 text-xs">
              Go to Analytics <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="h-10 bg-muted/60 p-1">
          <TabsTrigger value="clients" className="gap-2 text-xs md:text-sm">
            <Users className="h-4 w-4" /> Client Records Explorer
            {selectedExplorerCompany && (
              <Badge variant="secondary" className="ml-1 py-0 px-1.5 text-[10px]">
                {selectedExplorerCompany.company_code}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="operations" className="gap-2 text-xs md:text-sm">
            <Layers className="h-4 w-4" /> Data Operations & Pruning
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="danger" className="gap-2 text-xs md:text-sm text-destructive data-[state=active]:text-destructive">
              <ShieldAlert className="h-4 w-4" /> Danger Zone
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="clients" className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    Client Payables Explorer
                    {selectedExplorerCompany && explorerFy && (
                      <Badge variant="secondary" className="font-normal font-mono text-xs">
                        {selectedExplorerCompany.company_name} · FY {explorerFy}
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {filteredClientDetail.length} client transaction record{filteredClientDetail.length !== 1 ? "s" : ""} matching selection
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filteredClientDetail.length === 0}
                    onClick={() => {
                      DataManagementService.exportClientFiscalToExcel(
                        filteredClientDetail,
                        `clients_${selectedExplorerCompany?.company_code || "export"}_${explorerFy}`
                      );
                      toast.success("Client transactions exported to Excel.");
                    }}
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />
                    Export Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => refetchClientDetail()} disabled={detailLoading}>
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${detailLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Select value={explorerCompanyId} onValueChange={(v) => { setExplorerCompanyId(v); setExplorerPage(1); }}>
                  <SelectTrigger className="h-9 text-xs">
                    <Building2 className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.company_code} — {c.company_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={explorerFy} onValueChange={(v) => { setExplorerFy(v); setExplorerPage(1); }}>
                  <SelectTrigger className="h-9 text-xs">
                    <Calendar className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                    <SelectValue placeholder="Select fiscal year" />
                  </SelectTrigger>
                  <SelectContent>
                    {fiscalYears.map((fy) => (
                      <SelectItem key={fy} value={fy}>
                        FY {fy}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={explorerType}
                  onValueChange={(v) => {
                    setExplorerType(v as "dividend" | "interest" | "mutual_fund" | "all");
                    setExplorerPage(1);
                  }}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                    <SelectValue placeholder="Instrument type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Instruments</SelectItem>
                    <SelectItem value="dividend">Equity Dividends</SelectItem>
                    <SelectItem value="interest">Debenture Interest</SelectItem>
                    <SelectItem value="mutual_fund">Mutual Funds</SelectItem>
                  </SelectContent>
                </Select>

                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search name, BOID, code…"
                    value={explorerSearch}
                    onChange={(e) => { setExplorerSearch(e.target.value); setExplorerPage(1); }}
                    className="pl-8 h-9 text-xs"
                  />
                  {explorerSearch && (
                    <button
                      onClick={() => { setExplorerSearch(""); setExplorerPage(1); }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="px-0 pb-0">
              {!explorerCompanyId || !explorerFy ? (
                <div className="py-20 text-center text-muted-foreground">
                  <Eye className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p className="text-sm font-medium">Select a company and fiscal year to explore client records.</p>
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
                          <TableHead>Instrument</TableHead>
                          <TableHead className="text-right">Gross Amount</TableHead>
                          <TableHead className="text-right">Tax (TDS)</TableHead>
                          <TableHead className="text-right font-semibold">Net Payable</TableHead>
                          <TableHead className="pr-6">Payment Status</TableHead>
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
                              <p className="text-sm">No client records found for this selection.</p>
                            </TableCell>
                          </TableRow>
                        ) : (
                          pagedClientDetail.map((row, idx) => (
                            <TableRow key={`${row.client_id}-${row.payable_type}-${idx}`} className="hover:bg-muted/30">
                              <TableCell className="pl-6 font-medium text-sm">{row.full_name}</TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">{row.boid || "—"}</TableCell>
                              <TableCell className="font-mono text-xs">{row.client_code || "—"}</TableCell>
                              <TableCell>
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] uppercase font-mono"
                                >
                                  {row.payable_type === "mutual_fund" ? "Mutual Fund" : row.payable_type}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-sm">{fmt(row.gross_amount)}</TableCell>
                              <TableCell className="text-right tabular-nums text-sm text-amber-600 font-mono">{fmt(row.tax_amount)}</TableCell>
                              <TableCell className="text-right tabular-nums text-sm font-bold text-emerald-600">{fmt(row.net_amount)}</TableCell>
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

                  {detailPageCount > 1 && (
                    <div className="flex items-center justify-between border-t px-6 py-3">
                      <p className="text-xs text-muted-foreground">
                        Page {explorerPage} of {detailPageCount} · {filteredClientDetail.length} rows
                      </p>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={explorerPage <= 1}
                          onClick={() => setExplorerPage((p) => Math.max(1, p - 1))}
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={explorerPage >= detailPageCount}
                          onClick={() => setExplorerPage((p) => Math.min(detailPageCount, p + 1))}
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {filteredClientDetail.length > 0 && (
                    <div className="border-t px-6 py-4 bg-muted/20">
                      <div className="grid gap-3 sm:grid-cols-3">
                        {[
                          { label: "Total Gross Amount", key: "gross_amount" as const, color: "" },
                          { label: "Total Tax (TDS)", key: "tax_amount" as const, color: "text-amber-600 font-mono" },
                          { label: "Total Net Payable", key: "net_amount" as const, color: "text-emerald-600 font-bold" },
                        ].map(({ label, key, color }) => (
                          <div key={label} className="rounded-lg border bg-background p-3">
                            <p className="text-xs text-muted-foreground">{label}</p>
                            <p className={`text-lg tabular-nums mt-0.5 ${color}`}>
                              NPR {fmt(filteredClientDetail.reduce((s, r) => s + r[key], 0))}
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

        <TabsContent value="operations" className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">Company Fiscal Dataset Operations</CardTitle>
                  <CardDescription>
                    {filteredSummary.length} dataset{filteredSummary.length !== 1 ? "s" : ""} available for client exploration and targeted deletion
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => refetchSummary()} disabled={summaryLoading}>
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${summaryLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search company or FY…"
                    value={opsSearch}
                    onChange={(e) => { setOpsSearch(e.target.value); setOpsPage(1); }}
                    className="pl-8 h-8 text-sm"
                  />
                  {opsSearch && (
                    <button
                      onClick={() => { setOpsSearch(""); setOpsPage(1); }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Select value={opsFy} onValueChange={(v) => { setOpsFy(v); setOpsPage(1); }}>
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
                <Select value={opsCompany} onValueChange={(v) => { setOpsCompany(v); setOpsPage(1); }}>
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
                      <TableHead className="text-right">Dividend Records</TableHead>
                      <TableHead className="text-right">Debenture Records</TableHead>
                      <TableHead className="text-right">Mutual Fund Records</TableHead>
                      <TableHead className="text-right text-emerald-600">Total Paid</TableHead>
                      <TableHead className="text-right text-amber-600">Total Pending</TableHead>
                      <TableHead className="pr-6 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaryLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 8 }).map((_, j) => (
                            <TableCell key={j}>
                              <div className="h-4 rounded bg-muted animate-pulse" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : pagedSummary.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-16 text-center text-muted-foreground">
                          <FileX2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                          <p className="text-sm">No datasets found matching your filters.</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      pagedSummary.map((row) => (
                        <TableRow key={`${row.company_id}|${row.fiscal_year}`} className="group hover:bg-muted/30">
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
                          <TableCell className="text-right tabular-nums text-sm">{fmtCount(row.interest_count)}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{fmtCount(row.mutual_fund_count)}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-semibold text-emerald-600">
                            {fmt(row.total_paid)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-semibold text-amber-600">
                            {fmt(row.total_pending)}
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => handleInspectCompanyFy(row.company_id, row.fiscal_year)}
                              >
                                <Eye className="h-3 w-3 mr-1" />
                                Inspect
                              </Button>
                              {isAdmin && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-destructive hover:bg-destructive/10"
                                  onClick={() => openCompanyFyDelete(row)}
                                  title="Delete FY payables"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {opsPageCount > 1 && (
                <div className="flex items-center justify-between border-t px-6 py-3">
                  <p className="text-xs text-muted-foreground">
                    Page {opsPage} of {opsPageCount} · {filteredSummary.length} datasets
                  </p>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={opsPage <= 1}
                      onClick={() => setOpsPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={opsPage >= opsPageCount}
                      onClick={() => setOpsPage((p) => Math.min(opsPageCount, p + 1))}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="danger" className="space-y-5">
            {showDeleteResults && lastDeleteResults && (
              <Card className="border-emerald-200 dark:border-emerald-800">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      Last Purge Results
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
                    All operations in this zone are irreversible. Operations are performed server-side with full audit logging.
                  </p>
                </div>
              </div>

              <div className="space-y-5 p-3">
                <div>
                  <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive/10 text-destructive text-[10px] font-bold">1</span>
                    Advanced Bulk Purge
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Specify company scope and select exact instruments to purge.
                  </p>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Company Scope</Label>
                        <Select value={dangerCompany} onValueChange={setDangerCompany}>
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="All Companies" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Companies (Global Wipe)</SelectItem>
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

                    <div className="rounded-lg border border-destructive/20 bg-muted/20 p-3 space-y-2.5">
                      <Label className="text-xs font-medium block mb-1">Data to Purge</Label>

                      <div className="flex items-center gap-2.5">
                        <Checkbox
                          id="del-div"
                          checked={dangerDividends}
                          onCheckedChange={(v) => setDangerDividends(!!v)}
                        />
                        <Label htmlFor="del-div" className="text-sm cursor-pointer">
                          Equity Dividend Payables
                        </Label>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <Checkbox
                          id="del-mf"
                          checked={dangerMutualFunds}
                          onCheckedChange={(v) => setDangerMutualFunds(!!v)}
                        />
                        <Label htmlFor="del-mf" className="text-sm cursor-pointer">
                          Mutual Fund Payables
                        </Label>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <Checkbox
                          id="del-int"
                          checked={dangerInterests}
                          onCheckedChange={(v) => setDangerInterests(!!v)}
                        />
                        <Label htmlFor="del-int" className="text-sm cursor-pointer">
                          Debenture Interest Payables
                        </Label>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <Checkbox
                          id="del-orphans-danger"
                          checked={dangerDeleteOrphans}
                          onCheckedChange={(v) => setDangerDeleteOrphans(!!v)}
                        />
                        <Label htmlFor="del-orphans-danger" className="text-sm cursor-pointer text-orange-600 dark:text-orange-400">
                          Clean up orphaned client records
                        </Label>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex justify-end">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDangerDelete}
                      disabled={!dangerDividends && !dangerInterests && !dangerMutualFunds && !dangerClients && !dangerDeleteCompany}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      Execute Purge
                    </Button>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive/10 text-destructive text-[10px] font-bold">2</span>
                    Global Client Purge
                  </h3>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-red-50 dark:bg-red-950/20 p-4">
                    <div>
                      <p className="text-sm font-medium">Delete ALL Clients</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Removes every client record from the database.
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