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
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Badge } from "@/components/ui/badge";
import { Pencil, Plus, Trash2, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { PaginatedTable } from '@/components/paginated-table';
import type { ColumnDef } from '@tanstack/react-table';
import { exportToExcel, importFromExcel } from "@/lib/xlsx-utils";

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

function CompaniesPage() {
  const { hasAny } = useAuth();
  const canWrite = hasAny(["admin", "finance_operator"]);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState(emptyForm);
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

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return data.filter(
      (c) =>
        !q ||
        c.company_name.toLowerCase().includes(q) ||
        c.company_code.toLowerCase().includes(q) ||
        (c.isin ?? "").toLowerCase().includes(q) ||
        (c.pan_no ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);
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
        company_code: form.company_code,
        company_name: form.company_name,
        company_type: form.company_type || null,
        isin: form.isin || null,
        listed_date: form.listed_date || null,
        sector_type: form.sector_type,
        registrar: form.registrar || null,
        fiscal_year: form.fiscal_year || null,
        dividend_rate: num(form.dividend_rate),
        debenture_rate: num(form.debenture_rate),
        coupon_rate: num(form.coupon_rate),
        maturity_date: form.maturity_date || null,
        face_value: num(form.face_value),
        issue_size: num(form.issue_size),
        interest_tax_status: form.interest_tax_status,
        pan_no: form.pan_no || null,
        bank_account_no: form.bank_account_no || null,
        bank_name: form.bank_name || null,
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
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      toast.success(editing ? "Company updated" : "Company created");
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("companies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      toast.success("Company deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ColumnDef<Company>[] = useMemo(() => [
    { accessorKey: 'company_code', header: 'Code' },
    { accessorKey: 'company_name', header: 'Name' },
    { accessorKey: 'isin', header: 'ISIN', cell: info => info.getValue() ?? '—' },
    { accessorKey: 'sector_type', header: 'Sector' },
    { accessorKey: 'coupon_rate', header: 'Coupon', cell: info => info.getValue() != null ? `${info.getValue()}%` : '—' },
    { accessorKey: 'face_value', header: 'Face Val.', cell: info => info.getValue() != null ? Number(info.getValue()).toLocaleString() : '—' },
    { accessorKey: 'maturity_date', header: 'Maturity' },
    { accessorKey: 'interest_tax_status', header: 'Tax' },
    { accessorKey: 'status', header: 'Status', cell: info => <Badge variant={info.getValue() === 'Active' ? 'default' : 'secondary'}>{String(info.getValue())}</Badge> },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        canWrite && (
          <>
            <Button size="icon" variant="ghost" onClick={() => startEdit(row.original)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Delete ${row.original.company_name}?`)) del.mutate(row.original.id); }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )
      ),
    },
  ], [canWrite, del, startEdit]);

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
      "companies",
    );
  };

  const handleImport = async (file: File) => {
    try {
      const rows = await importFromExcel<Record<string, unknown>>(file);
      const clean = rows
        .filter((r) => r.company_code && r.company_name)
        .map((r) => ({
          company_code: String(r.company_code),
          company_name: String(r.company_name),
          company_type: r.company_type ? String(r.company_type) : null,
          isin: r.isin ? String(r.isin) : null,
          listed_date: r.listed_date ? String(r.listed_date) : null,
          sector_type: (r.sector_type as Sector) ?? null,
          registrar: r.registrar ? String(r.registrar) : null,
          fiscal_year: r.fiscal_year ? String(r.fiscal_year) : null,
          dividend_rate: r.dividend_rate !== undefined && r.dividend_rate !== "" ? Number(r.dividend_rate) : null,
          debenture_rate: r.debenture_rate !== undefined && r.debenture_rate !== "" ? Number(r.debenture_rate) : null,
          coupon_rate: r.coupon_rate !== undefined && r.coupon_rate !== "" ? Number(r.coupon_rate) : null,
          maturity_date: r.maturity_date ? String(r.maturity_date) : null,
          face_value: r.face_value !== undefined && r.face_value !== "" ? Number(r.face_value) : null,
          issue_size: r.issue_size !== undefined && r.issue_size !== "" ? Number(r.issue_size) : null,
          interest_tax_status: (r.interest_tax_status as TaxStatus) ?? null,
          pan_no: r.pan_no ? String(r.pan_no) : null,
          bank_account_no: r.bank_account_no ? String(r.bank_account_no) : null,
          bank_name: r.bank_name ? String(r.bank_name) : null,
          status: (r.status as Status) ?? "Active",
        }));
      if (!clean.length) return toast.error("No valid rows found");
      const { error } = await supabase.from("companies").insert(clean as never);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["companies"] });
      toast.success(`Imported ${clean.length} companies`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    }
  };

  const setF = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  return (
    <div>
      <PageHeader
        title="Companies"
        description="Master list of issuing companies (debentures & stocks) with full instrument details."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleExport}>
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
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" /> Import
                </Button>
                <Dialog open={open} onOpenChange={setOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" onClick={startNew}>
                      <Plus className="mr-2 h-4 w-4" /> New Company
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{editing ? "Edit Company" : "New Company"}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label>Company Code *</Label>
                        <Input value={form.company_code} onChange={(e) => setF("company_code", e.target.value)} />
                      </div>
                      <div className="space-y-1.5 md:col-span-2">
                        <Label>Company Name *</Label>
                        <Input value={form.company_name} onChange={(e) => setF("company_name", e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Company Type</Label>
                        <Input placeholder="Bank / Insurance / Hydropower…" value={form.company_type} onChange={(e) => setF("company_type", e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>ISIN</Label>
                        <Input value={form.isin} onChange={(e) => setF("isin", e.target.value)} />
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
                        <Label>Registrar</Label>
                        <Input value={form.registrar} onChange={(e) => setF("registrar", e.target.value)} />
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
                      <div className="space-y-1.5">
                        <Label>Dividend Rate (%)</Label>
                        <Input type="number" step="0.01" value={form.dividend_rate} onChange={(e) => setF("dividend_rate", e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Debenture Rate (%)</Label>
                        <Input type="number" step="0.01" value={form.debenture_rate} onChange={(e) => setF("debenture_rate", e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Coupon Rate (%)</Label>
                        <Input type="number" step="0.01" value={form.coupon_rate} onChange={(e) => setF("coupon_rate", e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Maturity Date</Label>
                        <Input type="date" value={form.maturity_date} onChange={(e) => setF("maturity_date", e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Face Value</Label>
                        <Input type="number" step="0.01" value={form.face_value} onChange={(e) => setF("face_value", e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Issue Size</Label>
                        <Input type="number" step="0.01" value={form.issue_size} onChange={(e) => setF("issue_size", e.target.value)} />
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
                        <Label>PAN No.</Label>
                        <Input value={form.pan_no} onChange={(e) => setF("pan_no", e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Bank Name</Label>
                        <Input value={form.bank_name} onChange={(e) => setF("bank_name", e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Bank Account No.</Label>
                        <Input value={form.bank_account_no} onChange={(e) => setF("bank_account_no", e.target.value)} />
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
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>
                        Cancel
                      </Button>
                      <Button
                        disabled={upsert.isPending || !form.company_code || !form.company_name}
                        onClick={() => upsert.mutate()}
                      >
                        {editing ? "Save changes" : "Create"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
            )}
          </>
        }
      />
      <Card>
        <CardContent className="p-4">
          <Input
            placeholder="Search by code, name, ISIN, or PAN…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-4 max-w-sm"
          />
                    <PaginatedTable columns={columns} data={filtered} pageSize={10} />
        </CardContent>
      </Card>
    </div>
  );
}
