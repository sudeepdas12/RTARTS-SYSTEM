import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pencil,
  Plus,
  Trash2,
  Download,
  Upload,
  Search,
  Users,
  ShieldCheck,
  Clock,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Building2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { exportToExcel, importFromExcel } from "@/lib/xlsx-utils";

export const Route = createFileRoute("/_authenticated/clients")({
  component: ClientsPage,
});

type Holder = "Natural Person - Public" | "Natural Person - Promoter" | "Legal Person" | "Mutual Fund" | "Foreign" | "Tax Exempt" | "Public" | "Promoter" | "Institution";
type Status = "Active" | "Inactive";
type Residency = "Resident" | "Non-Resident";
type Verification = "Pending" | "Verified" | "Rejected";

interface Client {
  id: string;
  client_code: string;
  client_id: string | null;
  full_name: string;
  father_name: string | null;
  grandfather_name: string | null;
  boid: string | null;
  holder_type: Holder | null;
  pan_or_citizenship: string | null;
  address: string | null;
  province: string | null;
  district: string | null;
  municipality: string | null;
  phone: string | null;
  email: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account_no: string | null;
  account_type: string | null;
  residency: Residency | null;
  verification_status: Verification;
  status: Status;
  created_at: string;
}

const emptyForm = {
  client_code: "",
  client_id: "",
  full_name: "",
  father_name: "",
  grandfather_name: "",
  boid: "",
  holder_type: "Public" as Holder,
  pan_or_citizenship: "",
  address: "",
  province: "",
  district: "",
  municipality: "",
  phone: "",
  email: "",
  bank_name: "",
  bank_branch: "",
  bank_account_no: "",
  account_type: "",
  residency: "Resident" as Residency,
  verification_status: "Pending" as Verification,
  status: "Active" as Status,
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function verificationBadge(v: Verification) {
  if (v === "Verified")
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-200 dark:border-emerald-800 dark:text-emerald-400 gap-1">
        <ShieldCheck className="h-3 w-3" /> Verified
      </Badge>
    );
  if (v === "Rejected")
    return (
      <Badge className="bg-red-500/15 text-red-700 border-red-200 dark:border-red-800 dark:text-red-400 gap-1">
        <XCircle className="h-3 w-3" /> Rejected
      </Badge>
    );
  return (
    <Badge className="bg-amber-500/15 text-amber-700 border-amber-200 dark:border-amber-800 dark:text-amber-400 gap-1">
      <Clock className="h-3 w-3" /> Pending
    </Badge>
  );
}

function holderBadge(h: Holder | null) {
  const type = h || "Public";
  if (type.includes("Promoter"))
    return <Badge variant="secondary" className="gap-1"><Building2 className="h-3 w-3" />{type}</Badge>;
  if (type === "Institution" || type === "Legal Person" || type === "Mutual Fund")
    return <Badge variant="outline" className="gap-1"><Building2 className="h-3 w-3" />{type}</Badge>;
  return <Badge variant="outline" className="gap-1"><User className="h-3 w-3" />{type}</Badge>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 mt-6 flex items-center gap-2">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-2">
        {children}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

function ClientsPage() {
  const { hasAny, isAdmin } = useAuth();
  const canWrite = hasAny(["admin", "finance_operator"]);
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [holderFilter, setHolderFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [verFilter, setVerFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const debouncedSearch = useDebounce(search, 500);

  const { data: stats = { total: 0, verified: 0, pending: 0, promoters: 0 } } = useQuery({
    queryKey: ["clients-stats"],
    queryFn: async () => {
      const [totalRes, verifiedRes, pendingRes, promotersRes] = await Promise.all([
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("clients").select("id", { count: "exact", head: true }).eq("verification_status", "Verified"),
        supabase.from("clients").select("id", { count: "exact", head: true }).eq("verification_status", "Pending"),
        supabase.from("clients").select("id", { count: "exact", head: true }).in("holder_type", ["Promoter", "Natural Person - Promoter"]),
      ]);
      return {
        total: totalRes.count || 0,
        verified: verifiedRes.count || 0,
        pending: pendingRes.count || 0,
        promoters: promotersRes.count || 0,
      };
    },
  });

  const { data: pageData = { rows: [], count: 0 }, isLoading } = useQuery({
    queryKey: ["clients", page, pageSize, debouncedSearch, holderFilter, statusFilter, verFilter],
    queryFn: async () => {
      let query = supabase
        .from("clients")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (holderFilter !== "all") query = query.eq("holder_type", holderFilter as any);
      if (statusFilter !== "all") query = query.eq("status", statusFilter as any);
      if (verFilter !== "all") query = query.eq("verification_status", verFilter as any);
      
      if (debouncedSearch) {
        query = query.or(
          `full_name.ilike.%${debouncedSearch}%,client_code.ilike.%${debouncedSearch}%,boid.ilike.%${debouncedSearch}%,pan_or_citizenship.ilike.%${debouncedSearch}%,phone.ilike.%${debouncedSearch}%,bank_account_no.ilike.%${debouncedSearch}%`
        );
      }

      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: data as Client[], count: count || 0 };
    },
    placeholderData: keepPreviousData,
  });

  const totalPages = Math.max(1, Math.ceil(pageData.count / pageSize));
  const pageItems = pageData.rows;

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setSheetOpen(true);
  }

  function openEdit(c: Client) {
    setEditing(c);
    setForm({
      client_code: c.client_code,
      client_id: c.client_id ?? "",
      full_name: c.full_name,
      father_name: c.father_name ?? "",
      grandfather_name: c.grandfather_name ?? "",
      boid: c.boid ?? "",
      holder_type: (c.holder_type ?? "Public") as Holder,
      pan_or_citizenship: c.pan_or_citizenship ?? "",
      address: c.address ?? "",
      province: c.province ?? "",
      district: c.district ?? "",
      municipality: c.municipality ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      bank_name: c.bank_name ?? "",
      bank_branch: c.bank_branch ?? "",
      bank_account_no: c.bank_account_no ?? "",
      account_type: c.account_type ?? "",
      residency: (c.residency ?? "Resident") as Residency,
      verification_status: c.verification_status ?? "Pending",
      status: c.status,
    });
    setSheetOpen(true);
  }

  const setF = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const upsert = useMutation({
    mutationFn: async () => {
      const payload = {
        client_code: form.client_code,
        client_id: form.client_id || null,
        full_name: form.full_name,
        father_name: form.father_name || null,
        grandfather_name: form.grandfather_name || null,
        boid: form.boid || null,
        holder_type: form.holder_type,
        pan_or_citizenship: form.pan_or_citizenship || null,
        address: form.address || null,
        province: form.province || null,
        district: form.district || null,
        municipality: form.municipality || null,
        phone: form.phone || null,
        email: form.email || null,
        bank_name: form.bank_name || null,
        bank_branch: form.bank_branch || null,
        bank_account_no: form.bank_account_no || null,
        account_type: form.account_type || null,
        residency: form.residency,
        verification_status: form.verification_status,
        status: form.status,
      };
      if (editing) {
        const { error } = await supabase.from("clients").update(payload as never).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("clients").insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["clients-stats"] });
      qc.invalidateQueries({ queryKey: ["clients-lookup"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      toast.success(editing ? "Client updated successfully" : "Client created successfully");
      setSheetOpen(false);
      setEditing(null);
      setForm(emptyForm);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["clients-stats"] });
      qc.invalidateQueries({ queryKey: ["clients-lookup"] });
      toast.success("Client deleted");
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleExport = async () => {
    if (pageData.count > 50000) {
      return toast.error(
        `Too many records (${pageData.count.toLocaleString()}). Please use filters to narrow down to under 50,000 for export.`
      );
    }
    
    toast.info(`Preparing export of ${pageData.count.toLocaleString()} clients... This might take a moment.`);
    try {
      const exportPageSize = 10000;
      const exportTotalPages = Math.ceil(pageData.count / exportPageSize);
      let allData: Record<string, unknown>[] = [];
      
      for (let p = 0; p < exportTotalPages; p++) {
        let query = supabase
          .from("clients")
          .select("*")
          .order("created_at", { ascending: false })
          .range(p * exportPageSize, (p + 1) * exportPageSize - 1);

        if (holderFilter !== "all") query = query.eq("holder_type", holderFilter as any);
        if (statusFilter !== "all") query = query.eq("status", statusFilter as any);
        if (verFilter !== "all") query = query.eq("verification_status", verFilter as any);
        if (debouncedSearch) {
          query = query.or(
            `full_name.ilike.%${debouncedSearch}%,client_code.ilike.%${debouncedSearch}%,boid.ilike.%${debouncedSearch}%,pan_or_citizenship.ilike.%${debouncedSearch}%,phone.ilike.%${debouncedSearch}%,bank_account_no.ilike.%${debouncedSearch}%`
          );
        }

        const { data, error } = await query;
        if (error) throw error;
        if (data) allData = allData.concat(data as unknown as Record<string, unknown>[]);
      }

      if (allData.length === 0) return toast.error("No data to export");

      exportToExcel(allData, "clients_export");
      toast.success(`Successfully exported ${allData.length.toLocaleString()} clients`);
    } catch (e: any) {
      toast.error(e.message || "Export failed");
    }
  };

  const handleImport = async (file: File) => {
    try {
      const rows = await importFromExcel<Record<string, unknown>>(file);
      const clean = rows
        .filter((r) => r.client_code && r.full_name)
        .map((r) => ({
          client_code: String(r.client_code),
          client_id: r.client_id ? String(r.client_id) : null,
          full_name: String(r.full_name),
          father_name: r.father_name ? String(r.father_name) : null,
          grandfather_name: r.grandfather_name ? String(r.grandfather_name) : null,
          boid: r.boid ? String(r.boid) : null,
          holder_type: (r.holder_type as Holder) ?? null,
          pan_or_citizenship: r.pan_or_citizenship ? String(r.pan_or_citizenship) : null,
          address: r.address ? String(r.address) : null,
          province: r.province ? String(r.province) : null,
          district: r.district ? String(r.district) : null,
          municipality: r.municipality ? String(r.municipality) : null,
          phone: r.phone ? String(r.phone) : null,
          email: r.email ? String(r.email) : null,
          bank_name: r.bank_name ? String(r.bank_name) : null,
          bank_branch: r.bank_branch ? String(r.bank_branch) : null,
          bank_account_no: r.bank_account_no ? String(r.bank_account_no) : null,
          account_type: r.account_type ? String(r.account_type) : null,
          residency: (r.residency as Residency) ?? null,
          verification_status: (r.verification_status as Verification) ?? "Pending",
          status: (r.status as Status) ?? "Active",
        }));
      if (!clean.length) return toast.error("No valid rows found");
      const { error } = await supabase.from("clients").insert(clean as never);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["clients-stats"] });
      toast.success(`Imported ${clean.length} clients`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <PageHeader
        title="Clients & Shareholders"
        description="Master register of all shareholders, debenture holders and unit holders with KYC and bank details."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleExport} className="hover-lift">
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
            {canWrite && (
              <>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  ref={fileRef}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImport(f);
                    e.target.value = "";
                  }}
                />
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="hover-lift">
                  <Upload className="mr-2 h-4 w-4" /> Import
                </Button>
                <Button size="sm" onClick={openNew} className="hover-lift">
                  <Plus className="mr-2 h-4 w-4" /> New Client
                </Button>
              </>
            )}
          </>
        }
      />

      {/* Stats Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total", value: stats.total, color: "text-primary", bg: "bg-primary/8" },
          { label: "Verified", value: stats.verified, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
          { label: "Pending KYC", value: stats.pending, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30" },
          { label: "Promoters", value: stats.promoters, color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950/30" },
        ].map((s) => (
          <Card key={s.label} className="glass-card">
            <CardContent className="flex items-center gap-3 p-4">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${s.bg}`}>
                <Users className={`h-5 w-5 ${s.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value.toLocaleString()}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter Toolbar */}
      <Card className="glass-card">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, code, BOID, PAN, phone…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={holderFilter} onValueChange={(v) => { setHolderFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Holder Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="Natural Person - Public">Natural Person - Public</SelectItem>
                <SelectItem value="Natural Person - Promoter">Natural Person - Promoter</SelectItem>
                <SelectItem value="Legal Person">Legal Person / Company</SelectItem>
                <SelectItem value="Mutual Fund">Mutual Fund</SelectItem>
                <SelectItem value="Foreign">Foreign</SelectItem>
                <SelectItem value="Tax Exempt">Tax Exempt</SelectItem>
                <SelectItem value="Public">Public (Legacy)</SelectItem>
                <SelectItem value="Promoter">Promoter (Legacy)</SelectItem>
                <SelectItem value="Institution">Institution (Legacy)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-32 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Select value={verFilter} onValueChange={(v) => { setVerFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Verification" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Verification</SelectItem>
                <SelectItem value="Verified">Verified</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="Rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <span className="ml-auto text-sm text-muted-foreground whitespace-nowrap">
              {pageData.count.toLocaleString()} result{pageData.count !== 1 ? "s" : ""}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="font-semibold">Code</TableHead>
                <TableHead className="font-semibold">Name</TableHead>
                <TableHead className="font-semibold">BOID</TableHead>
                <TableHead className="font-semibold">Type</TableHead>
                <TableHead className="font-semibold">PAN / Citizenship</TableHead>
                <TableHead className="font-semibold">Phone</TableHead>
                <TableHead className="font-semibold">Bank</TableHead>
                <TableHead className="font-semibold">Verification</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="w-24 text-right font-semibold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <TableCell key={j}>
                        <div className="h-4 w-full animate-pulse rounded bg-muted" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : pageItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-16 text-center text-muted-foreground">
                    <Users className="mx-auto mb-3 h-10 w-10 opacity-30" />
                    <p>No clients found</p>
                    <p className="text-xs mt-1 opacity-60">Try adjusting your search or filters</p>
                  </TableCell>
                </TableRow>
              ) : (
                pageItems.map((c, idx) => (
                  <TableRow
                    key={c.id}
                    className={`cursor-pointer transition-colors hover:bg-muted/50 ${idx % 2 === 0 ? "" : "bg-muted/20"}`}
                    onClick={() => openEdit(c)}
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.client_code}</TableCell>
                    <TableCell>
                      <div className="font-medium">{c.full_name}</div>
                      {c.father_name && <div className="text-xs text-muted-foreground">s/o {c.father_name}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.boid ?? "—"}</TableCell>
                    <TableCell>{holderBadge(c.holder_type)}</TableCell>
                    <TableCell className="text-xs">{c.pan_or_citizenship ?? "—"}</TableCell>
                    <TableCell className="text-xs">{c.phone ?? "—"}</TableCell>
                    <TableCell>
                      <div className="text-xs font-medium">{c.bank_name ?? "—"}</div>
                      {c.bank_account_no && <div className="font-mono text-[10px] text-muted-foreground">{c.bank_account_no}</div>}
                    </TableCell>
                    <TableCell>{verificationBadge(c.verification_status)}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === "Active" ? "default" : "secondary"}>
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 hover-lift"
                          onClick={() => openEdit(c)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {isAdmin && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10 hover-lift"
                            onClick={() => setDeleteTarget(c)}
                            title="Delete"
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

        {/* Pagination */}
        <div className="flex items-center justify-between border-t px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Rows per page:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}
            >
              <SelectTrigger className="h-7 w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {pageData.count === 0 ? "0" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, pageData.count)}`} of {pageData.count.toLocaleString()}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* ─── Client Edit/Create Sheet (no overlap!) ─────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) setEditing(null); }}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl overflow-y-auto p-0 flex flex-col"
        >
          <SheetHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b px-6 py-4 pr-14">
            <SheetTitle className="text-lg font-semibold">
              {editing ? `Edit — ${editing.full_name}` : "New Client"}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {/* Identity */}
            <SectionLabel>Identity</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Client Code <span className="text-destructive">*</span></Label>
                <Input value={form.client_code} onChange={(e) => setF("client_code", e.target.value)} placeholder="e.g. C001234" />
              </div>
              <div className="space-y-1.5">
                <Label>Client ID</Label>
                <Input value={form.client_id} onChange={(e) => setF("client_id", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>BOID</Label>
                <Input
                  value={form.boid}
                  onChange={(e) => setF("boid", e.target.value)}
                  placeholder="16-digit BOID"
                  maxLength={16}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Full Name <span className="text-destructive">*</span></Label>
                <Input value={form.full_name} onChange={(e) => setF("full_name", e.target.value)} placeholder="As per citizenship / PAN" />
              </div>
              <div className="space-y-1.5">
                <Label>Holder Type</Label>
                <Select value={form.holder_type} onValueChange={(v) => setF("holder_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Natural Person - Public">Natural Person - Public</SelectItem>
                    <SelectItem value="Natural Person - Promoter">Natural Person - Promoter</SelectItem>
                    <SelectItem value="Legal Person">Legal Person / Company</SelectItem>
                    <SelectItem value="Mutual Fund">Mutual Fund</SelectItem>
                    <SelectItem value="Foreign">Foreign</SelectItem>
                    <SelectItem value="Tax Exempt">Tax Exempt</SelectItem>
                    <SelectItem value="Public">Public (Legacy)</SelectItem>
                    <SelectItem value="Promoter">Promoter (Legacy)</SelectItem>
                    <SelectItem value="Institution">Institution (Legacy)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Father's Name</Label>
                <Input value={form.father_name} onChange={(e) => setF("father_name", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Grandfather's Name</Label>
                <Input value={form.grandfather_name} onChange={(e) => setF("grandfather_name", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>PAN / Citizenship No.</Label>
                <Input value={form.pan_or_citizenship} onChange={(e) => setF("pan_or_citizenship", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Residency</Label>
                <Select value={form.residency} onValueChange={(v) => setF("residency", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Resident">Resident</SelectItem>
                    <SelectItem value="Non-Resident">Non-Resident</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Address & Contact */}
            <SectionLabel>Address & Contact</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-3">
                <Label>Full Address</Label>
                <Input value={form.address} onChange={(e) => setF("address", e.target.value)} placeholder="Street, Ward No., Area" />
              </div>
              <div className="space-y-1.5">
                <Label>Province</Label>
                <Input value={form.province} onChange={(e) => setF("province", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>District</Label>
                <Input value={form.district} onChange={(e) => setF("district", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Municipality / VDC</Label>
                <Input value={form.municipality} onChange={(e) => setF("municipality", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setF("phone", e.target.value)} placeholder="+977-XXXXXXXXXX" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setF("email", e.target.value)} />
              </div>
            </div>

            {/* Bank Details */}
            <SectionLabel>Bank Details</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Bank Name</Label>
                <Input value={form.bank_name} onChange={(e) => setF("bank_name", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Branch</Label>
                <Input value={form.bank_branch} onChange={(e) => setF("bank_branch", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Account Type</Label>
                <Input placeholder="Saving / Current" value={form.account_type} onChange={(e) => setF("account_type", e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label>Account Number</Label>
                <Input value={form.bank_account_no} onChange={(e) => setF("bank_account_no", e.target.value)} className="font-mono" />
              </div>
            </div>

            {/* Status */}
            <SectionLabel>Status & Compliance</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Verification Status</Label>
                <Select value={form.verification_status} onValueChange={(v) => setF("verification_status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="Verified">Verified</SelectItem>
                    <SelectItem value="Rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Account Status</Label>
                <Select value={form.status} onValueChange={(v) => setF("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <SheetFooter className="sticky bottom-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t px-6 py-4 flex flex-row justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => { setSheetOpen(false); setEditing(null); }}
            >
              Cancel
            </Button>
            <Button
              disabled={upsert.isPending || !form.client_code || !form.full_name}
              onClick={() => upsert.mutate()}
            >
              {upsert.isPending ? "Saving…" : editing ? "Save Changes" : "Create Client"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Client</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.full_name}</strong>? This action cannot be undone and will also remove all associated payable records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && del.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
