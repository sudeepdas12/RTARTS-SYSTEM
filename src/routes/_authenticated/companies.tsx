import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Pencil,
  Plus,
  Trash2,
  Download,
  Upload,
  Search,
  Building2,
  Briefcase,
  TrendingUp,
  Landmark,
  ShieldCheck,
  Percent,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { PaginatedTable } from "@/components/paginated-table";
import type { ColumnDef } from "@tanstack/react-table";
import { exportToExcel, importFromExcel } from "@/lib/xlsx-utils";
import { DataManagementService } from "@/lib/services/data-management.service";

export const Route = createFileRoute("/_authenticated/companies")({
  component: CompaniesPage,
});

type Sector = "Public" | "Private" | "Institution" | "Government" | "Other";
type TaxStatus = "Taxable" | "Exempted";
type Status = "Active" | "Inactive";

interface Company {
  id: string;
  company_code: string;
  company_name: string;
  company_type: string | null;
  isin: string | null;
  listed_date: string | null;
  sector_type: Sector | null;
  registrar: string | null;
  fiscal_year: string | null;
  dividend_rate: number | null;
  debenture_rate: number | null;
  coupon_rate: number | null;
  maturity_date: string | null;
  face_value: number | null;
  issue_size: number | null;
  interest_tax_status: TaxStatus | null;
  pan_no: string | null;
  bank_account_no: string | null;
  bank_name: string | null;
  status: Status;
  created_at: string;
}

const emptyForm = {
  company_code: "",
  company_name: "",
  company_type: "",
  isin: "",
  listed_date: "",
  sector_type: "Public" as Sector,
  registrar: "",
  fiscal_year: "",
  dividend_rate: "",
  debenture_rate: "",
  coupon_rate: "",
  maturity_date: "",
  face_value: "",
  issue_size: "",
  interest_tax_status: "Taxable" as TaxStatus,
  pan_no: "",
  bank_account_no: "",
  bank_name: "",
  status: "Active" as Status,
};

const num = (v: string) => (v === "" ? null : Number(v));

function SectionLabel({ icon: Icon, children }: { icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-4 flex items-center gap-2 border-b pb-1">
      {Icon && <Icon className="h-3.5 w-3.5 text-primary" />}
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {children}
      </span>
    </div>
  );
}

function sectorBadge(s: Sector | null) {
  switch (s) {
    case "Public":
      return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-0">Public</Badge>;
    case "Private":
      return <Badge variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-0">Private</Badge>;
    case "Institution":
      return <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">Institution</Badge>;
    case "Government":
      return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0">Government</Badge>;
    default:
      return <Badge variant="outline">{s || "—"}</Badge>;
  }
}

function CompaniesPage() {
  const { hasAny, isAdmin } = useAuth();
  const canWrite = hasAny(["admin", "finance_operator"]);
  const qc = useQueryClient();
  
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Company[];
    },
  });

  const stats = useMemo(() => {
    const total = data.length;
    const active = data.filter((c) => c.status === "Active").length;
    const publicSectors = data.filter((c) => c.sector_type === "Public").length;
    const withInstruments = data.filter((c) => (c.dividend_rate && c.dividend_rate > 0) || (c.coupon_rate && c.coupon_rate > 0)).length;
    return { total, active, publicSectors, withInstruments };
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return data.filter((c) => {
      const matchesSearch =
        !q ||
        c.company_name.toLowerCase().includes(q) ||
        c.company_code.toLowerCase().includes(q) ||
        (c.isin ?? "").toLowerCase().includes(q) ||
        (c.pan_no ?? "").toLowerCase().includes(q) ||
        (c.company_type ?? "").toLowerCase().includes(q);

      const matchesSector = sectorFilter === "all" || c.sector_type === sectorFilter;
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;

      return matchesSearch && matchesSector && matchesStatus;
    });
  }, [data, search, sectorFilter, statusFilter]);

  const startEdit = useCallback((c: Company) => {
    setEditing(c);
    setForm({
      company_code: c.company_code,
      company_name: c.company_name,
      company_type: c.company_type ?? "",
      isin: c.isin ?? "",
      listed_date: c.listed_date ?? "",
      sector_type: (c.sector_type ?? "Public") as Sector,
      registrar: c.registrar ?? "",
      fiscal_year: c.fiscal_year ?? "",
      dividend_rate: c.dividend_rate?.toString() ?? "",
      debenture_rate: c.debenture_rate?.toString() ?? "",
      coupon_rate: c.coupon_rate?.toString() ?? "",
      maturity_date: c.maturity_date ?? "",
      face_value: c.face_value?.toString() ?? "",
      issue_size: c.issue_size?.toString() ?? "",
      interest_tax_status: (c.interest_tax_status ?? "Taxable") as TaxStatus,
      pan_no: c.pan_no ?? "",
      bank_account_no: c.bank_account_no ?? "",
      bank_name: c.bank_name ?? "",
      status: c.status,
    });
    setOpen(true);
  }, []);

  const upsert = useMutation({
    mutationFn: async () => {
      const payload = {
        company_code: form.company_code.trim(),
        company_name: form.company_name.trim(),
        company_type: form.company_type.trim() || null,
        isin: form.isin.trim() || null,
        listed_date: form.listed_date || null,
        sector_type: form.sector_type,
        registrar: form.registrar.trim() || null,
        fiscal_year: form.fiscal_year.trim() || null,
        dividend_rate: num(form.dividend_rate),
        debenture_rate: num(form.debenture_rate),
        coupon_rate: num(form.coupon_rate),
        maturity_date: form.maturity_date || null,
        face_value: num(form.face_value),
        issue_size: num(form.issue_size),
        interest_tax_status: form.interest_tax_status,
        pan_no: form.pan_no.trim() || null,
        bank_account_no: form.bank_account_no.trim() || null,
        bank_name: form.bank_name.trim() || null,
        status: form.status,
      };
      if (editing) {
        const { error } = await supabase.from("companies").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("companies").insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["companies-lookup"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      toast.success(editing ? "Company updated successfully" : "Company created successfully");
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const toastId = toast.loading("Deleting company and associated records…");
      try {
        const results = await DataManagementService.customBulkDelete({
          companyId: id,
          deleteDividends: true,
          deleteMutualFunds: true,
          deleteInterests: true,
          deleteClients: true,
          deleteCompany: true,
          deleteOrphans: true,
        });
        toast.dismiss(toastId);
        const errors = results.filter((r) => r.error);
        if (errors.length > 0) {
          throw new Error(errors.map((e) => `${e.table}: ${e.error}`).join(", "));
        }
        return results;
      } catch (err: any) {
        toast.dismiss(toastId);
        throw err;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["companies-lookup"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["clients-stats"] });
      toast.success("Company and all associated records deleted successfully");
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(`Delete failed: ${e.message}`),
  });

  const columns: ColumnDef<Company>[] = useMemo(() => [
    {
      accessorKey: "company_code",
      header: "Code",
      cell: ({ row }) => (
        <span className="font-mono text-xs font-semibold bg-muted px-2 py-1 rounded">
          {row.original.company_code}
        </span>
      ),
    },
    {
      accessorKey: "company_name",
      header: "Company Name",
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-sm text-foreground">{row.original.company_name}</div>
          {row.original.company_type && (
            <div className="text-xs text-muted-foreground">{row.original.company_type}</div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "isin",
      header: "ISIN",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.isin || "—"}
        </span>
      ),
    },
    {
      accessorKey: "sector_type",
      header: "Sector",
      cell: ({ row }) => sectorBadge(row.original.sector_type),
    },
    {
      accessorKey: "dividend_rate",
      header: "Div. Rate",
      cell: ({ row }) => (
        <span className="text-xs tabular-nums font-medium">
          {row.original.dividend_rate != null ? `${row.original.dividend_rate}%` : "—"}
        </span>
      ),
    },
    {
      accessorKey: "coupon_rate",
      header: "Coupon",
      cell: ({ row }) => (
        <span className="text-xs tabular-nums font-medium">
          {row.original.coupon_rate != null ? `${row.original.coupon_rate}%` : "—"}
        </span>
      ),
    },
    {
      accessorKey: "face_value",
      header: "Face Val.",
      cell: ({ row }) => (
        <span className="text-xs tabular-nums">
          {row.original.face_value != null ? `Rs. ${Number(row.original.face_value).toLocaleString()}` : "—"}
        </span>
      ),
    },
    {
      accessorKey: "fiscal_year",
      header: "Fiscal Year",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground font-mono">
          {row.original.fiscal_year || "—"}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge
          variant={row.original.status === "Active" ? "default" : "secondary"}
          className={
            row.original.status === "Active"
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-0"
              : ""
          }
        >
          {row.original.status}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        canWrite && (
          <div className="flex items-center gap-1 justify-end">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 hover:bg-muted"
              onClick={() => startEdit(row.original)}
              title="Edit Company"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-destructive hover:bg-destructive/10"
              onClick={() => setDeleteTarget(row.original)}
              title="Delete Company"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )
      ),
    },
  ], [canWrite, startEdit]);

  const startNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const handleExport = () => {
    exportToExcel(
      filtered.map((c) => ({
        company_code: c.company_code,
        company_name: c.company_name,
        company_type: c.company_type,
        isin: c.isin,
        listed_date: c.listed_date,
        sector_type: c.sector_type,
        registrar: c.registrar,
        fiscal_year: c.fiscal_year,
        dividend_rate: c.dividend_rate,
        debenture_rate: c.debenture_rate,
        coupon_rate: c.coupon_rate,
        maturity_date: c.maturity_date,
        face_value: c.face_value,
        issue_size: c.issue_size,
        interest_tax_status: c.interest_tax_status,
        pan_no: c.pan_no,
        bank_account_no: c.bank_account_no,
        bank_name: c.bank_name,
        status: c.status,
      })),
      "companies_master",
    );
  };

  const handleImport = async (file: File) => {
    try {
      const rows = await importFromExcel<Record<string, unknown>>(file);
      const clean = rows
        .filter((r) => r.company_code && r.company_name)
        .map((r) => ({
          company_code: String(r.company_code).trim(),
          company_name: String(r.company_name).trim(),
          company_type: r.company_type ? String(r.company_type).trim() : null,
          isin: r.isin ? String(r.isin).trim() : null,
          listed_date: r.listed_date ? String(r.listed_date) : null,
          sector_type: (r.sector_type as Sector) ?? null,
          registrar: r.registrar ? String(r.registrar).trim() : null,
          fiscal_year: r.fiscal_year ? String(r.fiscal_year).trim() : null,
          dividend_rate: r.dividend_rate !== undefined && r.dividend_rate !== "" ? Number(r.dividend_rate) : null,
          debenture_rate: r.debenture_rate !== undefined && r.debenture_rate !== "" ? Number(r.debenture_rate) : null,
          coupon_rate: r.coupon_rate !== undefined && r.coupon_rate !== "" ? Number(r.coupon_rate) : null,
          maturity_date: r.maturity_date ? String(r.maturity_date) : null,
          face_value: r.face_value !== undefined && r.face_value !== "" ? Number(r.face_value) : null,
          issue_size: r.issue_size !== undefined && r.issue_size !== "" ? Number(r.issue_size) : null,
          interest_tax_status: (r.interest_tax_status as TaxStatus) ?? null,
          pan_no: r.pan_no ? String(r.pan_no).trim() : null,
          bank_account_no: r.bank_account_no ? String(r.bank_account_no).trim() : null,
          bank_name: r.bank_name ? String(r.bank_name).trim() : null,
          status: (r.status as Status) ?? "Active",
        }));
      if (!clean.length) return toast.error("No valid company rows found");
      const { error } = await supabase.from("companies").insert(clean as never);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["companies-lookup"] });
      toast.success(`Successfully imported ${clean.length} companies`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    }
  };

  const setF = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <PageHeader
        title="Companies & Issuers"
        description="Master registry of issuing companies, debenture institutions, and mutual fund entities."
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
                <Button size="sm" onClick={startNew} className="hover-lift">
                  <Plus className="mr-2 h-4 w-4" /> New Company
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Issuers", value: stats.total, icon: Building2, color: "text-primary", bg: "bg-primary/10" },
          { label: "Active Companies", value: stats.active, icon: ShieldCheck, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
          { label: "Public Sector", value: stats.publicSectors, icon: Briefcase, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30" },
          { label: "With Distributions", value: stats.withInstruments, icon: TrendingUp, color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950/30" },
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

      {/* Filter and Table Card */}
      <Card className="glass-card overflow-hidden">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by code, company name, ISIN, or PAN…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={sectorFilter} onValueChange={setSectorFilter}>
              <SelectTrigger className="w-36 h-9">
                <SelectValue placeholder="Sector" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sectors</SelectItem>
                <SelectItem value="Public">Public</SelectItem>
                <SelectItem value="Private">Private</SelectItem>
                <SelectItem value="Institution">Institution</SelectItem>
                <SelectItem value="Government">Government</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32 h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
              {filtered.length} of {data.length} companies
            </span>
          </div>

          <PaginatedTable columns={columns} data={filtered} pageSize={10} />
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              {editing ? `Edit — ${editing.company_name}` : "Add New Company"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* General Info */}
            <SectionLabel icon={Building2}>General Information</SectionLabel>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Company Code <span className="text-destructive">*</span></Label>
                <Input placeholder="e.g. NABIL, CIT" value={form.company_code} onChange={(e) => setF("company_code", e.target.value)} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>Company Name <span className="text-destructive">*</span></Label>
                <Input placeholder="Official registered entity name" value={form.company_name} onChange={(e) => setF("company_name", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Company Type</Label>
                <Input placeholder="Commercial Bank, Mutual Fund…" value={form.company_type} onChange={(e) => setF("company_type", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>ISIN</Label>
                <Input placeholder="NPE..." value={form.isin} onChange={(e) => setF("isin", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Listed Date</Label>
                <Input type="date" value={form.listed_date} onChange={(e) => setF("listed_date", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Sector</Label>
                <Select value={form.sector_type} onValueChange={(v) => setF("sector_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Public", "Private", "Institution", "Government", "Other"].map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Registrar (RTA/RTS)</Label>
                <Input placeholder="Registrar name" value={form.registrar} onChange={(e) => setF("registrar", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Fiscal Year</Label>
                <Input
                  placeholder="2081/82"
                  value={form.fiscal_year}
                  inputMode="numeric"
                  onChange={(e) => {
                    const nextValue = e.target.value.replace(/[^0-9/]/g, '').slice(0, 9);
                    setF("fiscal_year", nextValue);
                  }}
                />
              </div>
            </div>

            {/* Financial & Rates */}
            <SectionLabel icon={Percent}>Instrument Rates & Values</SectionLabel>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Dividend Rate (%)</Label>
                <Input type="number" step="0.01" placeholder="e.g. 10.5" value={form.dividend_rate} onChange={(e) => setF("dividend_rate", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Debenture Rate (%)</Label>
                <Input type="number" step="0.01" placeholder="e.g. 8.5" value={form.debenture_rate} onChange={(e) => setF("debenture_rate", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Coupon Rate (%)</Label>
                <Input type="number" step="0.01" placeholder="e.g. 6.0" value={form.coupon_rate} onChange={(e) => setF("coupon_rate", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Face Value (Rs.)</Label>
                <Input type="number" step="0.01" placeholder="100, 1000…" value={form.face_value} onChange={(e) => setF("face_value", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Issue Size</Label>
                <Input type="number" step="0.01" placeholder="Total units" value={form.issue_size} onChange={(e) => setF("issue_size", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Maturity Date</Label>
                <Input type="date" value={form.maturity_date} onChange={(e) => setF("maturity_date", e.target.value)} />
              </div>
            </div>

            {/* Tax & Banking */}
            <SectionLabel icon={Landmark}>Tax & Banking Information</SectionLabel>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>PAN No.</Label>
                <Input placeholder="9-digit PAN" value={form.pan_no} onChange={(e) => setF("pan_no", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Interest Tax Status</Label>
                <Select value={form.interest_tax_status} onValueChange={(v) => setF("interest_tax_status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Taxable">Taxable</SelectItem>
                    <SelectItem value="Exempted">Exempted</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setF("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Bank Name</Label>
                <Input placeholder="Designated bank" value={form.bank_name} onChange={(e) => setF("bank_name", e.target.value)} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>Bank Account Number</Label>
                <Input placeholder="Account number for distributions" value={form.bank_account_no} onChange={(e) => setF("bank_account_no", e.target.value)} />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>
              Cancel
            </Button>
            <Button
              disabled={upsert.isPending || !form.company_code.trim() || !form.company_name.trim()}
              onClick={() => upsert.mutate()}
            >
              {upsert.isPending ? "Saving…" : editing ? "Save Changes" : "Create Company"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Alert Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!del.isPending && !o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Company & Associated Records
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.company_name}</strong> ({deleteTarget?.company_code})?
              This will safely remove the company along with all its associated payables, payments, and client distributions.
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
