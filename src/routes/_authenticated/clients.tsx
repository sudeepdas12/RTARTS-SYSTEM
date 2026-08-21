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
  MapPin,
  Landmark,
  ShieldAlert,
  Percent,
  CheckCircle2,
  Loader2,
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
type PayeeClassification = "NATURAL_PERSON" | "PUBLIC_LEGAL_PERSON" | "COMPANY_INSTITUTION" | "TAX_EXEMPT" | "UNCLASSIFIED";

interface Client {
  id: string;
  client_code: string;
  client_id: string | null;
  company_id: string | null;
  full_name: string;
  father_name: string | null;
  grandfather_name: string | null;
  date_of_birth: string | null;
  gender: string | null;
  occupation: string | null;
  boid: string | null;
  holder_type: Holder | null;
  payee_classification: PayeeClassification | null;
  pan_no: string | null;
  citizenship_no: string | null;
  pan_or_citizenship: string | null;
  nid_number: string | null;
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
  company?: { company_name: string; company_code: string } | null;
}

const emptyForm = {
  client_code: "",
  client_id: "",
  company_id: "",
  full_name: "",
  father_name: "",
  grandfather_name: "",
  date_of_birth: "",
  gender: "",
  occupation: "",
  boid: "",
  holder_type: "Natural Person - Public" as Holder,
  payee_classification: "NATURAL_PERSON" as PayeeClassification,
  pan_no: "",
  citizenship_no: "",
  pan_or_citizenship: "",
  nid_number: "",
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
  verification_status: "Verified" as Verification,
  status: "Active" as Status,
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function verificationBadge(v: Verification) {
  if (v === "Verified")
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-200 dark:border-emerald-800 dark:text-emerald-400 gap-1 text-[11px]">
        <ShieldCheck className="h-3 w-3" /> Verified
      </Badge>
    );
  if (v === "Rejected")
    return (
      <Badge className="bg-red-500/15 text-red-700 border-red-200 dark:border-red-800 dark:text-red-400 gap-1 text-[11px]">
        <XCircle className="h-3 w-3" /> Rejected
      </Badge>
    );
  return (
    <Badge className="bg-amber-500/15 text-amber-700 border-amber-200 dark:border-amber-800 dark:text-amber-400 gap-1 text-[11px]">
      <Clock className="h-3 w-3" /> Pending
    </Badge>
  );
}

function classificationBadge(c: PayeeClassification | null | undefined) {
  switch (c) {
    case "NATURAL_PERSON":
    case "PUBLIC_LEGAL_PERSON":
      return <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-[10px]">Natural Person (Public)</Badge>;
    case "COMPANY_INSTITUTION":
      return <Badge variant="secondary" className="bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 border-0 text-[10px]">Legal Person (Institution)</Badge>;
    case "TAX_EXEMPT":
      return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-[10px]">Tax Exempted (Mutual Fund)</Badge>;
    case "UNCLASSIFIED":
      return <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50 dark:bg-red-950/30 text-[10px]">Review Required</Badge>;
    default:
      return <Badge variant="outline" className="text-muted-foreground border-muted text-[10px]">Unclassified</Badge>;
  }
}

function holderBadge(h: Holder | null) {
  const type = h || "Public";
  if (type.includes("Promoter"))
    return <Badge variant="secondary" className="gap-1 text-[11px]"><Building2 className="h-3 w-3" />{type}</Badge>;
  if (type === "Institution" || type === "Legal Person" || type === "Mutual Fund")
    return <Badge variant="outline" className="gap-1 text-[11px]"><Building2 className="h-3 w-3" />{type}</Badge>;
  return <Badge variant="outline" className="gap-1 text-[11px]"><User className="h-3 w-3" />{type}</Badge>;
}

function SectionLabel({ icon: Icon, children }: { icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="mb-2.5 mt-5 flex items-center gap-2 border-b pb-1">
      {Icon && <Icon className="h-4 w-4 text-primary" />}
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {children}
      </span>
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
  const [companyFilter, setCompanyFilter] = useState("all");
  const [holderFilter, setHolderFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [verFilter, setVerFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const debouncedSearch = useDebounce(search, 400);

  // Companies lookup for dropdown filter and association
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

  const { data: stats = { total: 0, verified: 0, pending: 0, natural: 0, institutions: 0 } } = useQuery({
    queryKey: ["clients-stats"],
    queryFn: async () => {
      const [totalRes, verifiedRes, pendingRes, naturalRes, instRes] = await Promise.all([
        (supabase as any).from("clients").select("id", { count: "exact", head: true }),
        (supabase as any).from("clients").select("id", { count: "exact", head: true }).eq("verification_status", "Verified"),
        (supabase as any).from("clients").select("id", { count: "exact", head: true }).eq("verification_status", "Pending"),
        (supabase as any).from("clients").select("id", { count: "exact", head: true }).eq("payee_classification", "NATURAL_PERSON"),
        (supabase as any).from("clients").select("id", { count: "exact", head: true }).in("payee_classification", ["COMPANY_INSTITUTION", "PUBLIC_LEGAL_PERSON"]),
      ]);
      return {
        total: totalRes.count || 0,
        verified: verifiedRes.count || 0,
        pending: pendingRes.count || 0,
        natural: naturalRes.count || 0,
        institutions: instRes.count || 0,
      };
    },
  });

  const { data: pageData = { rows: [], count: 0 }, isLoading } = useQuery({
    queryKey: ["clients", page, pageSize, debouncedSearch, companyFilter, holderFilter, classFilter, statusFilter, verFilter],
    queryFn: async () => {
      let query = (supabase as any)
        .from("clients")
        .select("*, company:companies(company_name, company_code)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (companyFilter !== "all") query = query.eq("company_id", companyFilter);
      if (holderFilter !== "all") query = query.eq("holder_type", holderFilter as any);
      if (classFilter !== "all") query = query.eq("payee_classification", classFilter as any);
      if (statusFilter !== "all") query = query.eq("status", statusFilter as any);
      if (verFilter !== "all") query = query.eq("verification_status", verFilter as any);

      if (debouncedSearch) {
        query = query.or(
          `full_name.ilike.%${debouncedSearch}%,client_code.ilike.%${debouncedSearch}%,boid.ilike.%${debouncedSearch}%,pan_or_citizenship.ilike.%${debouncedSearch}%,phone.ilike.%${debouncedSearch}%,bank_account_no.ilike.%${debouncedSearch}%`
        );
      }

      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: data as unknown as Client[], count: count || 0 };
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
      company_id: c.company_id ?? "",
      full_name: c.full_name,
      father_name: c.father_name ?? "",
      grandfather_name: c.grandfather_name ?? "",
      date_of_birth: c.date_of_birth ?? "",
      gender: c.gender ?? "",
      occupation: c.occupation ?? "",
      boid: c.boid ?? "",
      holder_type: (c.holder_type ?? "Natural Person - Public") as Holder,
      payee_classification: (c.payee_classification ?? "NATURAL_PERSON") as PayeeClassification,
      pan_no: c.pan_no ?? (c.pan_or_citizenship && c.pan_or_citizenship.length === 9 ? c.pan_or_citizenship : ""),
      citizenship_no: c.citizenship_no ?? (c.pan_or_citizenship && c.pan_or_citizenship.length !== 9 ? c.pan_or_citizenship : ""),
      pan_or_citizenship: c.pan_or_citizenship ?? "",
      nid_number: c.nid_number ?? "",
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
      verification_status: c.verification_status ?? "Verified",
      status: c.status,
    });
    setSheetOpen(true);
  }

  const setF = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const upsert = useMutation({
    mutationFn: async () => {
      const panNo = form.pan_no.trim() || null;
      const citizenshipNo = form.citizenship_no.trim() || null;
      const payload = {
        client_code: form.client_code.trim(),
        client_id: form.client_id.trim() || null,
        company_id: form.company_id || null,
        full_name: form.full_name.trim(),
        father_name: form.father_name.trim() || null,
        grandfather_name: form.grandfather_name.trim() || null,
        date_of_birth: form.date_of_birth.trim() || null,
        gender: form.gender.trim() || null,
        occupation: form.occupation.trim() || null,
        boid: form.boid.trim() || null,
        holder_type: form.holder_type,
        payee_classification: form.payee_classification,
        pan_no: panNo,
        citizenship_no: citizenshipNo,
        pan_or_citizenship: panNo || citizenshipNo || form.pan_or_citizenship.trim() || null,
        nid_number: form.nid_number.trim() || null,
        address: form.address.trim() || null,
        province: form.province.trim() || null,
        district: form.district.trim() || null,
        municipality: form.municipality.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        bank_name: form.bank_name.trim() || null,
        bank_branch: form.bank_branch.trim() || null,
        bank_account_no: form.bank_account_no.trim() || null,
        account_type: form.account_type.trim() || null,
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
      toast.success(editing ? "Client updated successfully" : "Client created successfully");
      setSheetOpen(false);
      setEditing(null);
    },
    onError: (e: any) => {
      toast.error(e.message || "Failed to save client");
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const toastId = toast.loading("Deleting shareholder record…");
      try {
        const { error } = await supabase.from("clients").delete().eq("id", id);
        toast.dismiss(toastId);
        if (error) throw error;
      } catch (err: any) {
        toast.dismiss(toastId);
        throw err;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["clients-stats"] });
      qc.invalidateQueries({ queryKey: ["clients-lookup"] });
      toast.success("Client deleted successfully");
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(`Delete failed: ${e.message}`),
  });

  const handleExport = async () => {
    try {
      const batchSize = 1000;
      let allData: Record<string, unknown>[] = [];
      const numBatches = Math.ceil(pageData.count / batchSize);

      for (let i = 0; i < numBatches; i++) {
        let query = (supabase as any)
          .from("clients")
          .select("*, company:companies(company_name, company_code)")
          .order("created_at", { ascending: false })
          .range(i * batchSize, (i + 1) * batchSize - 1);

        if (companyFilter !== "all") query = query.eq("company_id", companyFilter);
        if (holderFilter !== "all") query = query.eq("holder_type", holderFilter as any);
        if (classFilter !== "all") query = query.eq("payee_classification", classFilter as any);
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

      exportToExcel(
        allData.map((d: any) => ({
          client_code: d.client_code,
          full_name: d.full_name,
          boid: d.boid,
          company: d.company?.company_name || "",
          holder_type: d.holder_type,
          classification: d.payee_classification,
          father_name: d.father_name,
          grandfather_name: d.grandfather_name,
          date_of_birth: d.date_of_birth,
          gender: d.gender,
          occupation: d.occupation,
          pan_no: d.pan_no || (d.pan_or_citizenship && String(d.pan_or_citizenship).length === 9 ? d.pan_or_citizenship : ""),
          citizenship_no: d.citizenship_no || (d.pan_or_citizenship && String(d.pan_or_citizenship).length !== 9 ? d.pan_or_citizenship : ""),
          nid_number: d.nid_number,
          phone: d.phone,
          email: d.email,
          address: d.address,
          province: d.province,
          district: d.district,
          municipality: d.municipality,
          bank_name: d.bank_name,
          bank_branch: d.bank_branch,
          bank_account_no: d.bank_account_no,
          account_type: d.account_type,
          residency: d.residency,
          verification_status: d.verification_status,
          status: d.status,
        })),
        "clients_register"
      );
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
        .map((r) => {
          const pan = r.pan_no ? String(r.pan_no).trim() : (r.pan ? String(r.pan).trim() : (r.PAN ? String(r.PAN).trim() : (r["PAN NO"] ? String(r["PAN NO"]).trim() : null)));
          const ctz = r.citizenship_no ? String(r.citizenship_no).trim() : (r.citizenship ? String(r.citizenship).trim() : (r.CITIZENSHIP ? String(r.CITIZENSHIP).trim() : (r["CITIZENSHIP NO"] ? String(r["CITIZENSHIP NO"]).trim() : null)));
          const legacyPanCtz = r.pan_or_citizenship ? String(r.pan_or_citizenship).trim() : null;
          return {
            client_code: String(r.client_code).trim(),
            client_id: r.client_id ? String(r.client_id).trim() : null,
            full_name: String(r.full_name).trim(),
            father_name: r.father_name ? String(r.father_name).trim() : null,
            grandfather_name: r.grandfather_name ? String(r.grandfather_name).trim() : null,
            date_of_birth: r.date_of_birth ? String(r.date_of_birth).trim() : null,
            gender: r.gender ? String(r.gender).trim() : null,
            occupation: r.occupation ? String(r.occupation).trim() : null,
            boid: r.boid ? String(r.boid).trim() : null,
            holder_type: (r.holder_type as Holder) ?? null,
            payee_classification: (r.payee_classification as PayeeClassification) ?? "NATURAL_PERSON",
            pan_no: pan,
            citizenship_no: ctz,
            pan_or_citizenship: pan || ctz || legacyPanCtz,
            nid_number: r.nid_number ? String(r.nid_number).trim() : (r.nid ? String(r.nid).trim() : (r.NID ? String(r.NID).trim() : null)),
            address: r.address ? String(r.address).trim() : null,
            province: r.province ? String(r.province).trim() : null,
            district: r.district ? String(r.district).trim() : null,
            municipality: r.municipality ? String(r.municipality).trim() : null,
            phone: r.phone ? String(r.phone).trim() : null,
            email: r.email ? String(r.email).trim() : null,
            bank_name: r.bank_name ? String(r.bank_name).trim() : null,
            bank_branch: r.bank_branch ? String(r.bank_branch).trim() : null,
            bank_account_no: r.bank_account_no ? String(r.bank_account_no).trim() : null,
            account_type: r.account_type ? String(r.account_type).trim() : null,
            residency: (r.residency as Residency) ?? null,
            verification_status: (r.verification_status as Verification) ?? "Verified",
            status: (r.status as Status) ?? "Active",
          };
        });
      if (!clean.length) return toast.error("No valid client rows found");
      const { error } = await supabase.from("clients").insert(clean as never);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["clients-stats"] });
      toast.success(`Successfully imported ${clean.length} clients`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <PageHeader
        title="Clients & Shareholders"
        description="Master register of shareholders, debenture holders, and institutional unit holders with tax classifications."
        actions={
          <div className="flex items-center gap-2">
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
          </div>
        }
      />

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Shareholders", value: stats.total, icon: Users, color: "text-primary", bg: "bg-primary/10" },
          { label: "KYC Verified", value: stats.verified, icon: ShieldCheck, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
          { label: "Pending Review", value: stats.pending, icon: Clock, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30" },
          { label: "Natural Persons", value: stats.natural, icon: User, color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950/30" },
        ].map((s) => (
          <Card key={s.label} className="glass-card">
            <CardContent className="flex items-center gap-3 p-4">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${s.bg}`}>
                <s.icon className={`h-5 w-5 ${s.color}`} />
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
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, code, BOID, PAN, phone…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>

            <Select value={companyFilter} onValueChange={(v) => { setCompanyFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40 h-9">
                <SelectValue placeholder="Company" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Companies</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.company_code} — {c.company_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={classFilter} onValueChange={(v) => { setClassFilter(v); setPage(1); }}>
              <SelectTrigger className="w-44 h-9">
                <SelectValue placeholder="Classification" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                <SelectItem value="NATURAL_PERSON">Natural Person (Public)</SelectItem>
                <SelectItem value="COMPANY_INSTITUTION">Legal Person (Institution)</SelectItem>
                <SelectItem value="TAX_EXEMPT">Tax Exempted (Mutual Fund)</SelectItem>
              </SelectContent>
            </Select>

            <Select value={holderFilter} onValueChange={(v) => { setHolderFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36 h-9">
                <SelectValue placeholder="Holder Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Holder Types</SelectItem>
                <SelectItem value="Natural Person - Public">Natural Person - Public</SelectItem>
                <SelectItem value="Natural Person - Promoter">Natural Person - Promoter</SelectItem>
                <SelectItem value="Legal Person">Legal Person / Company</SelectItem>
                <SelectItem value="Mutual Fund">Mutual Fund</SelectItem>
                <SelectItem value="Foreign">Foreign</SelectItem>
                <SelectItem value="Tax Exempt">Tax Exempt</SelectItem>
                <SelectItem value="Public">Public</SelectItem>
                <SelectItem value="Promoter">Promoter</SelectItem>
                <SelectItem value="Institution">Institution</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-28 h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>

            <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
              {pageData.count.toLocaleString()} result{pageData.count !== 1 ? "s" : ""}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Table Card */}
      <Card className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="font-semibold text-xs">Code</TableHead>
                <TableHead className="font-semibold text-xs">Shareholder Name</TableHead>
                <TableHead className="font-semibold text-xs">BOID</TableHead>
                <TableHead className="font-semibold text-xs">Tax Class</TableHead>
                <TableHead className="font-semibold text-xs">Holder Type</TableHead>
                <TableHead className="font-semibold text-xs">Company</TableHead>
                <TableHead className="font-semibold text-xs">PAN / Citizenship</TableHead>
                <TableHead className="font-semibold text-xs">Bank Details</TableHead>
                <TableHead className="font-semibold text-xs">Verification</TableHead>
                <TableHead className="w-20 text-right font-semibold text-xs">Actions</TableHead>
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
                    <p className="font-medium text-sm">No shareholders found</p>
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
                    <TableCell className="font-mono text-xs text-muted-foreground font-semibold">
                      {c.client_code}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm text-foreground">{c.full_name}</div>
                      {c.father_name && <div className="text-[11px] text-muted-foreground">s/o {c.father_name}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.boid ?? "—"}</TableCell>
                    <TableCell>{classificationBadge(c.payee_classification)}</TableCell>
                    <TableCell>{holderBadge(c.holder_type)}</TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground font-medium">
                        {c.company?.company_code || c.company?.company_name || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{c.pan_or_citizenship ?? "—"}</TableCell>
                    <TableCell>
                      <div className="text-xs font-medium">{c.bank_name ?? "—"}</div>
                      {c.bank_account_no && <div className="font-mono text-[10px] text-muted-foreground">{c.bank_account_no}</div>}
                    </TableCell>
                    <TableCell>{verificationBadge(c.verification_status)}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 hover:bg-muted"
                          onClick={() => openEdit(c)}
                          title="Edit Shareholder"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteTarget(c)}
                          title="Delete Shareholder"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Bar */}
        <div className="flex items-center justify-between border-t px-4 py-3 bg-muted/10">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
          <div className="flex items-center gap-3 text-xs">
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

      {/* Client Edit/Create Sheet */}
      <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) setEditing(null); }}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl overflow-y-auto p-0 flex flex-col"
        >
          <SheetHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b px-6 py-4 pr-14">
            <SheetTitle className="text-lg font-semibold flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              {editing ? `Edit — ${editing.full_name}` : "New Client Registration"}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-4">
            {/* Identity */}
            <SectionLabel icon={User}>Identity & Demographics</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Client Code <span className="text-destructive">*</span></Label>
                <Input value={form.client_code} onChange={(e) => setF("client_code", e.target.value)} placeholder="e.g. C001234" />
              </div>
              <div className="space-y-1.5">
                <Label>BOID (16 Digits)</Label>
                <Input
                  value={form.boid}
                  onChange={(e) => setF("boid", e.target.value)}
                  placeholder="13010200..."
                  maxLength={16}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Linked Company</Label>
                <Select value={form.company_id} onValueChange={(v) => setF("company_id", v)}>
                  <SelectTrigger><SelectValue placeholder="— None —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">— None —</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.company_code} — {c.company_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Full Name <span className="text-destructive">*</span></Label>
                <Input value={form.full_name} onChange={(e) => setF("full_name", e.target.value)} placeholder="As per citizenship / PAN" />
              </div>
              <div className="space-y-1.5">
                <Label>PAN Number (Permanent Account No)</Label>
                <Input value={form.pan_no} onChange={(e) => setF("pan_no", e.target.value)} placeholder="9-digit PAN (e.g. 102938475)" maxLength={15} className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>Citizenship Number</Label>
                <Input value={form.citizenship_no} onChange={(e) => setF("citizenship_no", e.target.value)} placeholder="e.g. 27-01-75-01234" />
              </div>
              <div className="space-y-1.5">
                <Label>NID Number (National ID)</Label>
                <Input value={form.nid_number} onChange={(e) => setF("nid_number", e.target.value)} placeholder="10-digit NID Number" maxLength={15} className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>Date of Birth (BS / AD)</Label>
                <Input value={form.date_of_birth} onChange={(e) => setF("date_of_birth", e.target.value)} placeholder="YYYY-MM-DD" />
              </div>
              <div className="space-y-1.5">
                <Label>Gender</Label>
                <Select value={form.gender} onValueChange={(v) => setF("gender", v)}>
                  <SelectTrigger><SelectValue placeholder="Select Gender" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other / Entity</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Occupation</Label>
                <Input value={form.occupation} onChange={(e) => setF("occupation", e.target.value)} placeholder="e.g. Service / Business" />
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

            {/* Classification */}
            <SectionLabel icon={Percent}>Tax Classification & Category</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tax Classification (TDS Rate)</Label>
                <Select value={form.payee_classification} onValueChange={(v) => setF("payee_classification", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NATURAL_PERSON">Natural Person (Public) — 5% Div / 6% Deb</SelectItem>
                    <SelectItem value="COMPANY_INSTITUTION">Legal Person (Institution / Company) — 5% Div / 15% Deb</SelectItem>
                    <SelectItem value="TAX_EXEMPT">Tax Exempted (Mutual Fund / Retirement) — 0% TDS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Holder Type (Segment)</Label>
                <Select value={form.holder_type} onValueChange={(v) => setF("holder_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Natural Person - Public">Natural Person - Public</SelectItem>
                    <SelectItem value="Natural Person - Promoter">Natural Person - Promoter</SelectItem>
                    <SelectItem value="Legal Person">Legal Person / Company</SelectItem>
                    <SelectItem value="Mutual Fund">Mutual Fund</SelectItem>
                    <SelectItem value="Foreign">Foreign</SelectItem>
                    <SelectItem value="Tax Exempt">Tax Exempt</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Address & Contact */}
            <SectionLabel icon={MapPin}>Address & Contact Details</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-3">
                <Label>Full Address</Label>
                <Input value={form.address} onChange={(e) => setF("address", e.target.value)} placeholder="Street, Ward No., Area" />
              </div>
              <div className="space-y-1.5">
                <Label>Province</Label>
                <Input value={form.province} onChange={(e) => setF("province", e.target.value)} placeholder="e.g. Bagmati" />
              </div>
              <div className="space-y-1.5">
                <Label>District</Label>
                <Input value={form.district} onChange={(e) => setF("district", e.target.value)} placeholder="e.g. Kathmandu" />
              </div>
              <div className="space-y-1.5">
                <Label>Municipality / Local Body</Label>
                <Input value={form.municipality} onChange={(e) => setF("municipality", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone / Mobile</Label>
                <Input value={form.phone} onChange={(e) => setF("phone", e.target.value)} placeholder="+977-98..." />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Email Address</Label>
                <Input type="email" value={form.email} onChange={(e) => setF("email", e.target.value)} placeholder="investor@example.com" />
              </div>
            </div>

            {/* Bank Details */}
            <SectionLabel icon={Landmark}>Banking Details for Distribution</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Bank Name</Label>
                <Input value={form.bank_name} onChange={(e) => setF("bank_name", e.target.value)} placeholder="e.g. Nabil Bank" />
              </div>
              <div className="space-y-1.5">
                <Label>Branch</Label>
                <Input value={form.bank_branch} onChange={(e) => setF("bank_branch", e.target.value)} placeholder="Branch name" />
              </div>
              <div className="space-y-1.5">
                <Label>Account Type</Label>
                <Input placeholder="Saving / Current" value={form.account_type} onChange={(e) => setF("account_type", e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label>Account Number</Label>
                <Input value={form.bank_account_no} onChange={(e) => setF("bank_account_no", e.target.value)} className="font-mono" placeholder="Bank account number" />
              </div>
            </div>

            {/* Status */}
            <SectionLabel icon={ShieldCheck}>Compliance & Status</SectionLabel>
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
              disabled={upsert.isPending || !form.client_code.trim() || !form.full_name.trim()}
              onClick={() => upsert.mutate()}
            >
              {upsert.isPending ? "Saving…" : editing ? "Save Changes" : "Create Shareholder"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!del.isPending && !o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Shareholder Record
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.full_name}</strong> ({deleteTarget?.client_code})?
              This action will permanently remove this shareholder record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <Button
              variant="outline"
              disabled={del.isPending}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={() => {
                if (deleteTarget) {
                  del.mutate(deleteTarget.id);
                }
              }}
            >
              {del.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Confirm Delete"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
