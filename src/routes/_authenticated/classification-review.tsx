import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardCheck,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  Building2,
  Filter,
  CheckCircle2,
  UserCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  adminListReviewClients,
  adminConfirmClientClassification,
  adminListTaxExceptions,
  adminRecomputePayable,
  adminFixMisclassifiedNaturalPersons,
  type PayeeClassification,
} from "@/lib/classification-review.functions";
import { exportToExcel } from "@/lib/xlsx-utils";

export const Route = createFileRoute("/_authenticated/classification-review")({
  component: ClassificationReviewPage,
});

const CLASSIFICATION_OPTIONS: { value: PayeeClassification; label: string }[] = [
  { value: "NATURAL_PERSON", label: "Natural Person (Public / Individual)" },
  { value: "PUBLIC_LEGAL_PERSON", label: "Public Legal Person (Semi-Govt / Statutory)" },
  { value: "COMPANY_INSTITUTION", label: "Legal Person (Institution / Company)" },
  { value: "TAX_EXEMPT", label: "Tax Exempted (Mutual Fund / Retirement Fund)" },
];

const SEGMENT_OPTIONS = [
  { value: "", label: "— Segment: None —" },
  { value: "PUBLIC", label: "Public" },
  { value: "PROMOTER", label: "Promoter" },
  { value: "LOCAL", label: "Local Affected" },
  { value: "EMPLOYEE", label: "Employee / Staff" },
];

const PAGE_SIZE = 25;

const classBadge = (c: string | null | undefined) => {
  switch (c) {
    case "NATURAL_PERSON":
      return (
        <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
          Natural Person (Public)
        </Badge>
      );
    case "PUBLIC_LEGAL_PERSON":
      return (
        <Badge variant="secondary" className="bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300 border-0">
          Public Legal Person (Statutory)
        </Badge>
      );
    case "COMPANY_INSTITUTION":
      return (
        <Badge variant="secondary" className="bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 border-0">
          Legal Person (Institution)
        </Badge>
      );
    case "TAX_EXEMPT":
      return (
        <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0">
          Tax Exempted (Mutual Fund)
        </Badge>
      );
    case "UNCLASSIFIED":
      return (
        <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50 dark:bg-red-950/30">
          Review Required
        </Badge>
      );
    default:
      return <Badge variant="outline">{c ?? "—"}</Badge>;
  }
};

const statusBadge = (s: string | null | undefined) => {
  switch (s) {
    case "CONFIRMED":
      return <Badge variant="outline" className="text-emerald-700 border-emerald-300">CONFIRMED</Badge>;
    case "AUTO_CLASSIFIED":
      return <Badge variant="outline" className="text-sky-700 border-sky-300">AUTO</Badge>;
    default:
      return <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/30">REVIEW REQUIRED</Badge>;
  }
};

function ReviewRow({
  client,
  onConfirmed,
  isPending,
}: {
  client: any;
  onConfirmed: (id: string, classification: PayeeClassification, segment?: string) => void;
  isPending: boolean;
}) {
  const [classification, setClassification] = useState<PayeeClassification>(
    (["NATURAL_PERSON", "PUBLIC_LEGAL_PERSON", "COMPANY_INSTITUTION", "TAX_EXEMPT"].includes(
      client.payee_classification,
    )
      ? client.payee_classification
      : "NATURAL_PERSON") as PayeeClassification,
  );
  const [segment, setSegment] = useState(client.payee_segment ?? "");

  useEffect(() => {
    setClassification(
      (["NATURAL_PERSON", "PUBLIC_LEGAL_PERSON", "COMPANY_INSTITUTION", "TAX_EXEMPT"].includes(
        client.payee_classification,
      )
        ? client.payee_classification
        : "NATURAL_PERSON") as PayeeClassification,
    );
    setSegment(client.payee_segment ?? "");
  }, [client.id, client.payee_classification, client.payee_segment]);

  return (
    <TableRow key={client.id} className="hover:bg-muted/30">
      <TableCell className="font-medium text-sm">
        <div>{client.full_name}</div>
        {client.pan_or_citizenship && (
          <span className="text-[11px] text-muted-foreground font-mono">PAN: {client.pan_or_citizenship}</span>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">{client.boid || "—"}</TableCell>
      <TableCell className="text-xs">{client.company?.company_name ?? "—"}</TableCell>
      <TableCell>{classBadge(client.payee_classification)}</TableCell>
      <TableCell>{statusBadge(client.classification_status)}</TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={classification} onValueChange={(v) => setClassification(v as PayeeClassification)}>
            <SelectTrigger className="h-8 w-[190px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLASSIFICATION_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={segment} onValueChange={setSegment}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEGMENT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={isPending}
            onClick={() =>
              onConfirmed(client.id, classification, segment === "" ? undefined : segment)
            }
          >
            <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Confirm
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function ClassificationReviewPage() {
  const qc = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);

  const clients = useQuery({
    queryKey: ["classification-review-clients"],
    queryFn: () => adminListReviewClients(),
  });

  const exceptions = useQuery({
    queryKey: ["classification-tax-exceptions"],
    queryFn: () => adminListTaxExceptions(),
  });

  const confirmMutation = useMutation({
    mutationFn: ({
      clientId,
      classification,
      segment,
    }: {
      clientId: string;
      classification: PayeeClassification;
      segment?: string;
    }) =>
      adminConfirmClientClassification({
        data: { clientId, classification, segment: (segment as any) ?? null },
      }),
    onSuccess: (res) => {
      toast.success(`Classification confirmed — ${res.recomputed} related payable(s) recomputed.`);
      qc.invalidateQueries({ queryKey: ["classification-review-clients"] });
      qc.invalidateQueries({ queryKey: ["classification-tax-exceptions"] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed to confirm classification"),
  });

  const recomputeMutation = useMutation({
    mutationFn: ({ table, id }: { table: string; id: string }) =>
      adminRecomputePayable({ data: { table, id } }),
    onSuccess: () => {
      toast.success("Payable TDS recomputed.");
      qc.invalidateQueries({ queryKey: ["classification-tax-exceptions"] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed to recompute payable"),
  });

  const fixLineageMutation = useMutation({
    mutationFn: () => adminFixMisclassifiedNaturalPersons({ data: undefined }),
    onSuccess: (res: any) => {
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ["classification-review-clients"] });
      qc.invalidateQueries({ queryKey: ["classification-tax-exceptions"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed to auto-correct shareholders"),
  });

  const onConfirmed = (
    clientId: string,
    classification: PayeeClassification,
    segment?: string,
  ) => confirmMutation.mutate({ clientId, classification, segment });

  // Filter distinct companies in the client list
  const companyOptions = useMemo(() => {
    const list = clients.data || [];
    const set = new Set<string>();
    list.forEach((c) => {
      if (c.company?.company_name) set.add(c.company.company_name);
    });
    return Array.from(set).sort();
  }, [clients.data]);

  // Filtered client list
  const filteredClients = useMemo(() => {
    let list = clients.data || [];
    if (companyFilter !== "all") {
      list = list.filter((c) => c.company?.company_name === companyFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          c.full_name?.toLowerCase().includes(q) ||
          c.boid?.toLowerCase().includes(q) ||
          c.pan_or_citizenship?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [clients.data, companyFilter, searchQuery]);

  const pageCount = Math.max(1, Math.ceil(filteredClients.length / PAGE_SIZE));
  const pagedClients = filteredClients.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const handleExportReviewList = () => {
    if (filteredClients.length === 0) return;
    const rows = filteredClients.map((c) => ({
      "Shareholder Name": c.full_name,
      "BOID": c.boid,
      "PAN / Citizenship": c.pan_or_citizenship || "",
      "Company": c.company?.company_name || "",
      "Current Classification": c.payee_classification || "",
      "Segment": c.payee_segment || "",
      "Status": c.classification_status || "",
    }));
    exportToExcel(rows, `classification_review_${new Date().toISOString().slice(0, 10)}`);
    toast.success("Classification review list exported.");
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Investor Classification Review"
        description="Verify and confirm shareholder categories to ensure TDS is withheld at authoritative regulatory rates."
      />

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-amber-200/60 bg-amber-50/20 dark:border-amber-900/40">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase">Needs Review</p>
              <p className="text-2xl font-bold text-amber-600 mt-1 tabular-nums">
                {clients.data?.length ?? 0}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Shareholders awaiting decision</p>
            </div>
            <div className="p-3 bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 rounded-xl">
              <ClipboardCheck className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-red-200/60 bg-red-50/20 dark:border-red-900/40">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase">Tax Exceptions</p>
              <p className="text-2xl font-bold text-red-600 mt-1 tabular-nums">
                {exceptions.data?.length ?? 0}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Payables with mathematical mismatch</p>
            </div>
            <div className="p-3 bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 rounded-xl">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-emerald-200/60 bg-emerald-50/20 dark:border-emerald-900/40">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase">TDS Compliance</p>
              <p className="text-2xl font-bold text-emerald-600 mt-1 flex items-center gap-1.5">
                {(clients.data?.length ?? 0) === 0 ? "100%" : "Active"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {(clients.data?.length ?? 0) === 0 ? "All shareholders verified" : "Manual verification active"}
              </p>
            </div>
            <div className="p-3 bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 rounded-xl">
              <UserCheck className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="review" className="space-y-4">
        <TabsList>
          <TabsTrigger value="review" className="gap-2">
            <ClipboardCheck className="w-4 h-4" /> Needs Review
            {clients.data?.length ? (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                {clients.data.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="exceptions" className="gap-2 text-amber-600 data-[state=active]:text-amber-600">
            <AlertTriangle className="w-4 h-4" /> Tax Exceptions
            {exceptions.data?.length ? (
              <Badge variant="destructive" className="ml-1 px-1.5 py-0 text-[10px]">
                {exceptions.data.length}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        {/* ═══════════════════════════════════════════════════════
            TAB 1: CLIENTS NEEDING REVIEW
        ═══════════════════════════════════════════════════════ */}
        <TabsContent value="review" className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">Shareholders Pending Classification</CardTitle>
                  <CardDescription>
                    Confirming updates the shareholder master and automatically recomputes TDS for all associated payables.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-emerald-600/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                    onClick={() => fixLineageMutation.mutate()}
                    disabled={fixLineageMutation.isPending}
                    title="Automatically detect and correct natural persons with family names who were misclassified as tax-exempt"
                  >
                    <Sparkles className={`h-3.5 w-3.5 mr-1.5 ${fixLineageMutation.isPending ? "animate-spin" : "text-emerald-600"}`} />
                    {fixLineageMutation.isPending ? "Correcting..." : "Auto-Fix Natural Persons"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filteredClients.length === 0}
                    onClick={handleExportReviewList}
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />
                    Export List
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      qc.invalidateQueries({ queryKey: ["classification-review-clients"] });
                      qc.invalidateQueries({ queryKey: ["classification-tax-exceptions"] });
                    }}
                    disabled={clients.isLoading}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${clients.isLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>
              </div>

              {/* Filters */}
              <div className="mt-2 flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search name, BOID, PAN…"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="pl-8 h-8 text-sm"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => {
                        setSearchQuery("");
                        setCurrentPage(1);
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <Select
                  value={companyFilter}
                  onValueChange={(v) => {
                    setCompanyFilter(v);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="w-56 h-8 text-sm">
                    <Building2 className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                    <SelectValue placeholder="All companies" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All companies</SelectItem>
                    {companyOptions.map((comp) => (
                      <SelectItem key={comp} value={comp}>
                        {comp}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>

            <CardContent className="px-0 pb-0">
              {clients.isLoading ? (
                <div className="py-16 text-center text-muted-foreground">
                  <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                  <p className="text-sm">Loading review list…</p>
                </div>
              ) : filteredClients.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                  <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-emerald-500 opacity-80" />
                  <p className="text-sm font-semibold text-foreground">No shareholders need review</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Every shareholder is classified with authoritative tax rules.
                  </p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="pl-6">Shareholder</TableHead>
                          <TableHead>BOID</TableHead>
                          <TableHead>Company</TableHead>
                          <TableHead>Current</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="pr-6 w-[430px]">Confirm Classification & Segment</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedClients.map((client) => (
                          <ReviewRow
                            key={client.id}
                            client={client}
                            onConfirmed={onConfirmed}
                            isPending={confirmMutation.isPending}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Pagination */}
                  {pageCount > 1 && (
                    <div className="flex items-center justify-between border-t px-6 py-3">
                      <p className="text-xs text-muted-foreground">
                        Page {currentPage} of {pageCount} · {filteredClients.length} shareholders
                      </p>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={currentPage <= 1}
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={currentPage >= pageCount}
                          onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════
            TAB 2: TAX CONSISTENCY EXCEPTIONS
        ═══════════════════════════════════════════════════════ */}
        <TabsContent value="exceptions" className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Tax / TDS Consistency Exceptions</CardTitle>
              <CardDescription>
                Payables where the stored amounts disagree with statutory rules (net ≠ gross − tax, or tax ≠ gross × rate).
                Click Recompute to recalculate and fix discrepancies immediately.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {exceptions.isLoading ? (
                <div className="py-16 text-center text-muted-foreground">
                  <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                  <p className="text-sm">Scanning for tax exceptions…</p>
                </div>
              ) : !exceptions.data || exceptions.data.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                  <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-emerald-500 opacity-80" />
                  <p className="text-sm font-semibold text-foreground">No consistency exceptions found</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    All payables match regulatory TDS math across all companies.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-6">Payee</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                        <TableHead className="text-right">Tax</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead>Classification</TableHead>
                        <TableHead>Issue</TableHead>
                        <TableHead className="pr-6 text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {exceptions.data.map((row: any) => (
                        <TableRow key={`${row.table}-${row.id}`} className="hover:bg-muted/30">
                          <TableCell className="pl-6 font-medium text-sm">{row.payee}</TableCell>
                          <TableCell className="text-xs capitalize font-mono">{row.table.replace("_payables", "")}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{row.gross.toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm text-amber-600 font-mono">{row.tax.toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-bold text-emerald-600">{row.net.toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{row.tds_rate != null ? `${(Number(row.tds_rate) * 100).toFixed(0)}%` : "—"}</TableCell>
                          <TableCell>{classBadge(row.classification)}</TableCell>
                          <TableCell className="text-xs text-amber-700 dark:text-amber-400 font-medium">{row.reason}</TableCell>
                          <TableCell className="pr-6 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={recomputeMutation.isPending}
                              onClick={() => recomputeMutation.mutate({ table: row.table, id: row.id })}
                            >
                              <RefreshCw className="w-3 h-3 mr-1" /> Recompute
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

