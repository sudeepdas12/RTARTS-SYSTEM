import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Pencil, Plus, Trash2, Download, Upload, CheckCircle2, Calculator, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { toast } from "sonner";
import { SettingsService } from "@/lib/services/settings.service";
import { exportToExcel, importFromExcel } from "@/lib/xlsx-utils";
import { InterestCalculator, type InterestResult } from "@/lib/interest-calculator";

export const Route = createFileRoute("/_authenticated/interest")({
  component: InterestPage,
});

type PaymentStatus = "Pending" | "Paid" | "Partial";

interface Payable {
  id: string;
  company_id: string | null;
  client_id: string | null;
  instrument_ref: string | null;
  gross_interest: number | null;
  tax_amount: number | null;
  net_payable: number | null;
  due_date: string | null;
  payment_status: PaymentStatus;
  payment_date: string | null;
  payment_reference: string | null;
  fiscal_year: string | null;
  upload_id?: string | null;
  created_at: string;
  client?: { id: string; client_code: string; full_name: string; boid: string | null; father_name: string | null; grandfather_name: string | null; pan_or_citizenship: string | null; address: string | null; district: string | null; phone: string | null; bank_name: string | null; bank_account_no: string | null } | null;
  company?: { id: string; company_code: string; company_name: string } | null;
}

const emptyForm = {
  company_id: "",
  client_id: "",
  // Client details (editable)
  client_boid: "",
  client_code: "",
  client_full_name: "",
  client_father_name: "",
  client_grandfather_name: "",
  client_pan: "",
  client_address: "",
  client_district: "",
  client_phone: "",
  client_bank_name: "",
  client_bank_account_no: "",
  // Payable fields
  instrument_ref: "",
  gross_interest: "",
  tax_amount: "",
  net_payable: "",
  due_date: "",
  payment_status: "Pending" as PaymentStatus,
  payment_date: "",
  payment_reference: "",
  fiscal_year: "",
};

function InterestPage() {
  const { hasAny } = useAuth();
  const canWrite = hasAny(["admin", "finance_operator"]);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [fyFilter, setFyFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [open, setOpen] = useState(false);
  const [payOpen, setPayOpen] = useState<Payable | null>(null);
  const [payRef, setPayRef] = useState("");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [editing, setEditing] = useState<Payable | null>(null);
  const [form, setForm] = useState(emptyForm);
  const fileRef = useRef<HTMLInputElement>(null);

  // Fetch settings & active fiscal year
  const { data: settings } = useQuery({ queryKey: ["system-settings"], queryFn: () => SettingsService.getSettings() });
  const { data: activeFyData } = useQuery({ 
    queryKey: ["active_fiscal_year"], 
    queryFn: async () => {
      const { data } = await supabase.from("fiscal_years").select("fiscal_year").eq("is_active", true).maybeSingle();
      return data?.fiscal_year ?? "";
    }
  });

  // ─── Interest Calculator state ───────────────────────────────────────────────
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcKitta, setCalcKitta] = useState('');
  const [calcFaceValue, setCalcFaceValue] = useState('1000');
  const [calcRate, setCalcRate] = useState('');
  const [calcFromDate, setCalcFromDate] = useState('');
  const [calcToDate, setCalcToDate] = useState('');
  const [calcTdsCategory, setCalcTdsCategory] = useState<'PUBLIC' | 'PRIVATE' | 'INSTITUTION' | 'MUTUAL_FUND' | 'TAX_EXEMPTED'>('PUBLIC');
  const [calcCustomTds, setCalcCustomTds] = useState('');
  const [calcResult, setCalcResult] = useState<InterestResult | null>(null);

  // Sync settings when they load
  useEffect(() => {
    if (settings && !calcCustomTds && settings.interest_tds_natural) {
      setCalcCustomTds(String(settings.interest_tds_natural));
    }
  }, [settings]);

  const calcDays = useMemo(() => {
    if (!calcFromDate || !calcToDate) return 0;
    const from = new Date(calcFromDate);
    const to = new Date(calcToDate);
    if (to < from) return 0;
    return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
  }, [calcFromDate, calcToDate]);

  const handleCalcInterest = () => {
    const kitta = Number(calcKitta);
    const fv = Number(calcFaceValue);
    const rate = Number(calcRate);
    if (!kitta || kitta <= 0) { toast.error('Enter a valid number of debentures (Kitta)'); return; }
    if (!fv || fv <= 0) { toast.error('Enter a valid face value'); return; }
    if (!rate || rate <= 0) { toast.error('Enter a valid annual interest rate'); return; }
    if (!calcDays || calcDays <= 0) { toast.error('Select valid From and To dates'); return; }
    const result = InterestCalculator.calculate({
      debentureKitta: kitta,
      unitFaceValue: fv,
      annualInterestRate: rate,
      daysCount: calcDays,
      taxCategory: calcTdsCategory,
      taxRate: calcCustomTds ? Number(calcCustomTds) / 100 : undefined,
    });
    setCalcResult(result);
    toast.success('Interest calculated successfully');
  };

  const fmtNr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const { data: companies = [] } = useQuery({
    queryKey: ["companies-lookup"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id, company_code, company_name").order("company_name");
      if (error) throw error;
      return data as { id: string; company_code: string; company_name: string }[];
    },
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients-lookup"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, client_code, full_name, boid, father_name, grandfather_name, pan_or_citizenship, address, district, phone, bank_name, bank_account_no").order("full_name").limit(100000);
      if (error) throw error;
      return data as { id: string; client_code: string; full_name: string; boid: string | null; father_name: string | null; grandfather_name: string | null; pan_or_citizenship: string | null; address: string | null; district: string | null; phone: string | null; bank_name: string | null; bank_account_no: string | null }[];
    },
  });

  const companyMap = useMemo(() => Object.fromEntries(companies.map((c) => [c.id, c])), [companies]);
  const clientMap = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);
  const companyByCode = useMemo(() => Object.fromEntries(companies.map((c) => [c.company_code.toLowerCase(), c.id])), [companies]);
  const clientByCode = useMemo(() => Object.fromEntries(clients.map((c) => [c.client_code.toLowerCase(), c.id])), [clients]);
  const clientByBoid = useMemo(() => Object.fromEntries(clients.filter(c => c.boid).map((c) => [c.boid!.toLowerCase(), c.id])), [clients]);

  const { data = [], isLoading } = useQuery({
    queryKey: ["interest_payables"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interest_payables")
        .select("*, client:clients(id, client_code, full_name, boid, father_name, grandfather_name, pan_or_citizenship, address, district, phone, bank_name, bank_account_no), company:companies(id, company_code, company_name)")
        .order("due_date", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data as Payable[];
    },
  });

  const fiscalYears = useMemo(() => {
    const set = new Set<string>();
    data.forEach((p) => { if (p.fiscal_year) set.add(p.fiscal_year); });
    return Array.from(set).sort().reverse();
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return data.filter((p) => {
      if (statusFilter !== "all" && p.payment_status !== statusFilter) return false;
      if (companyFilter !== "all" && p.company_id !== companyFilter) return false;
      if (fyFilter !== "all" && p.fiscal_year !== fyFilter) return false;
      if (!q) return true;
      const c = p.company ?? null;
      const cl = p.client ?? null;
      return (
        (c?.company_name.toLowerCase().includes(q) ?? false) ||
        (c?.company_code.toLowerCase().includes(q) ?? false) ||
        (cl?.full_name.toLowerCase().includes(q) ?? false) ||
        (cl?.client_code.toLowerCase().includes(q) ?? false) ||
        (cl?.boid?.toLowerCase().includes(q) ?? false) ||
        (cl?.bank_name?.toLowerCase().includes(q) ?? false) ||
        (cl?.bank_account_no?.toLowerCase().includes(q) ?? false) ||
        (cl?.pan_or_citizenship?.toLowerCase().includes(q) ?? false) ||
        (p.fiscal_year ?? "").toLowerCase().includes(q) ||
        (p.instrument_ref ?? "").toLowerCase().includes(q) ||
        (p.payment_reference ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, search, statusFilter, companyFilter, fyFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const totals = useMemo(() => {
    return filtered.reduce(
      (a, p) => ({
        count: a.count + 1,
        paidCount: a.paidCount + (p.payment_status === 'Paid' ? 1 : 0),
        pendingCount: a.pendingCount + (p.payment_status === 'Pending' ? 1 : 0),
        gross: a.gross + Number(p.gross_interest ?? 0),
        tax: a.tax + Number(p.tax_amount ?? 0),
        net: a.net + Number(p.net_payable ?? 0),
      }),
      { count: 0, paidCount: 0, pendingCount: 0, gross: 0, tax: 0, net: 0 },
    );
  }, [filtered]);

  const upsert = useMutation({
    mutationFn: async () => {
      const gross = form.gross_interest ? Number(form.gross_interest) : null;
      const tax = form.tax_amount ? Number(form.tax_amount) : null;
      const net = form.net_payable ? Number(form.net_payable) : (gross != null && tax != null ? gross - tax : (gross ?? null));
      const payload = {
        company_id: form.company_id || null,
        client_id: form.client_id || null,
        instrument_ref: form.instrument_ref || null,
        gross_interest: gross,
        tax_amount: tax,
        net_payable: net,
        due_date: form.due_date || null,
        payment_status: form.payment_status,
        payment_date: form.payment_date || null,
        payment_reference: form.payment_reference || null,
        fiscal_year: form.fiscal_year || null,
      };

      // If editing, also update the client record with editable client details
      if (editing && editing.client_id) {
        const clientPayload: Record<string, unknown> = {};
        if (form.client_boid !== undefined) clientPayload.boid = form.client_boid || null;
        if (form.client_full_name !== undefined) clientPayload.full_name = form.client_full_name || null;
        if (form.client_father_name !== undefined) clientPayload.father_name = form.client_father_name || null;
        if (form.client_grandfather_name !== undefined) clientPayload.grandfather_name = form.client_grandfather_name || null;
        if (form.client_pan !== undefined) clientPayload.pan_or_citizenship = form.client_pan || null;
        if (form.client_address !== undefined) clientPayload.address = form.client_address || null;
        if (form.client_district !== undefined) clientPayload.district = form.client_district || null;
        if (form.client_phone !== undefined) clientPayload.phone = form.client_phone || null;
        if (form.client_bank_name !== undefined) clientPayload.bank_name = form.client_bank_name || null;
        if (form.client_bank_account_no !== undefined) clientPayload.bank_account_no = form.client_bank_account_no || null;
        const { error: clientErr } = await supabase.from("clients").update(clientPayload as never).eq("id", editing.client_id);
        if (clientErr) throw clientErr;
      }

      if (editing) {
        const { error } = await supabase.from("interest_payables").update(payload as never).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("interest_payables").insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["interest_payables"] });
      qc.invalidateQueries({ queryKey: ["clients-lookup"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      toast.success(editing ? "Payable updated" : "Payable created");
      setOpen(false); setEditing(null); setForm(emptyForm);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("interest_payables").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["interest_payables"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      toast.success("Payable deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markPaid = useMutation({
    mutationFn: async () => {
      if (!payOpen) return;
      const { error } = await supabase
        .from("interest_payables")
        .update({ payment_status: "Paid", payment_date: payDate || new Date().toISOString().slice(0, 10), payment_reference: payRef || null })
        .eq("id", payOpen.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["interest_payables"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      toast.success("Marked as paid");
      setPayOpen(null); setPayRef("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startNew = () => { setEditing(null); setForm({ ...emptyForm, fiscal_year: activeFyData || "" }); setOpen(true); };
  const startEdit = (p: Payable) => {
    setEditing(p);
    const cl = p.client ?? null;
    setForm({
      company_id: p.company_id ?? "",
      client_id: p.client_id ?? "",
      // Client details
      client_boid: cl?.boid ?? "",
      client_code: cl?.client_code ?? "",
      client_full_name: cl?.full_name ?? "",
      client_father_name: cl?.father_name ?? "",
      client_grandfather_name: cl?.grandfather_name ?? "",
      client_pan: cl?.pan_or_citizenship ?? "",
      client_address: cl?.address ?? "",
      client_district: cl?.district ?? "",
      client_phone: cl?.phone ?? "",
      client_bank_name: cl?.bank_name ?? "",
      client_bank_account_no: cl?.bank_account_no ?? "",
      // Payable fields
      instrument_ref: p.instrument_ref ?? "",
      gross_interest: p.gross_interest?.toString() ?? "",
      tax_amount: p.tax_amount?.toString() ?? "",
      net_payable: p.net_payable?.toString() ?? "",
      due_date: p.due_date ?? "",
      payment_status: p.payment_status,
      payment_date: p.payment_date ?? "",
      payment_reference: p.payment_reference ?? "",
      fiscal_year: p.fiscal_year ?? "",
    });
    setOpen(true);
  };

  const handleExport = () => {
    exportToExcel(
      filtered.map((p) => {
        const cl = p.client ?? null;
        const c = p.company ?? null;
        return {
          company_code: c?.company_code ?? "",
          company_name: c?.company_name ?? "",
          client_code: cl?.client_code ?? "",
          client_name: cl?.full_name ?? "",
          boid: cl?.boid ?? "",
          instrument_ref: p.instrument_ref,
          gross_interest: p.gross_interest,
          tax_amount: p.tax_amount,
          net_payable: p.net_payable,
          due_date: p.due_date,
          payment_status: p.payment_status,
          payment_date: p.payment_date,
          payment_reference: p.payment_reference,
          fiscal_year: p.fiscal_year,
        };
      }),
      "interest_payables",
    );
  };

  const handleImport = async (file: File) => {
    try {
      type Row = {
        company_code?: string; company_id?: string; client_code?: string; client_boid?: string; client_id?: string;
        instrument_ref?: string; gross_interest?: number | string; tax_amount?: number | string;
        due_date?: string; payment_status?: string; payment_date?: string; payment_reference?: string; fiscal_year?: string;
      };
      const rows = await importFromExcel<Row>(file);
      const clean: Record<string, unknown>[] = [];
      const errors: string[] = [];
      rows.forEach((r, i) => {
        const cid = r.company_id || (r.company_code ? companyByCode[String(r.company_code).toLowerCase()] : undefined);
        const clid = r.client_id || (r.client_code ? clientByCode[String(r.client_code).toLowerCase()] : undefined) || (r.client_boid ? clientByBoid[String(r.client_boid).toLowerCase()] : undefined);
        if (!cid || !clid) { errors.push(`Row ${i + 2}: company/client not found`); return; }
        clean.push({
          company_id: cid,
          client_id: clid,
          instrument_ref: r.instrument_ref ?? null,
          gross_interest: r.gross_interest != null ? Number(r.gross_interest) : null,
          tax_amount: r.tax_amount != null ? Number(r.tax_amount) : null,
          due_date: r.due_date ?? null,
          payment_status: (r.payment_status as PaymentStatus) ?? "Pending",
          payment_date: r.payment_date ?? null,
          payment_reference: r.payment_reference ?? null,
          fiscal_year: r.fiscal_year ?? null,
        });
      });
      if (!clean.length) return toast.error(errors[0] ?? "No valid rows");
      const { error } = await supabase.from("interest_payables").insert(clean as never);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["interest_payables"] });
      toast.success(`Imported ${clean.length} rows${errors.length ? ` (${errors.length} skipped)` : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    }
  };

  const fmt = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const previewNet = form.net_payable
    ? Number(form.net_payable)
    : ((Number(form.gross_interest) || 0) - (Number(form.tax_amount) || 0));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Debenture Interest Payables"
        description="Track debenture interest with auto tax calculation, filters, and bulk upload."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCalcOpen(v => !v)}>
              <Calculator className="mr-2 h-4 w-4" />
              Calculator
              {calcOpen ? <ChevronUp className="ml-1 h-3 w-3" /> : <ChevronDown className="ml-1 h-3 w-3" />}
            </Button>
            {canWrite && (
              <>
                <input type="file" accept=".xlsx,.xls,.csv" ref={fileRef} className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ""; }} />
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" /> Import
                </Button>
                <Dialog open={open} onOpenChange={setOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" onClick={startNew}>
                      <Plus className="mr-2 h-4 w-4" /> New Payable
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{editing ? "Edit Interest Payable" : "New Interest Payable"}</DialogTitle>
                    </DialogHeader>

                    {/* Client Details (editable when editing) */}
                    {editing && (
                      <div className="rounded-md border bg-muted/30 p-3 mb-4">
                        <div className="text-xs font-semibold text-muted-foreground mb-2">Client Details</div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>BOID</Label>
                            <Input value={form.client_boid} onChange={(e) => setForm({ ...form, client_boid: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Client Code</Label>
                            <Input value={form.client_code} disabled onChange={(e) => setForm({ ...form, client_code: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Full Name</Label>
                            <Input value={form.client_full_name} onChange={(e) => setForm({ ...form, client_full_name: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Father's Name</Label>
                            <Input value={form.client_father_name} onChange={(e) => setForm({ ...form, client_father_name: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Grandfather's Name</Label>
                            <Input value={form.client_grandfather_name} onChange={(e) => setForm({ ...form, client_grandfather_name: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>PAN/Citizenship</Label>
                            <Input value={form.client_pan} onChange={(e) => setForm({ ...form, client_pan: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Address</Label>
                            <Input value={form.client_address} onChange={(e) => setForm({ ...form, client_address: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>District</Label>
                            <Input value={form.client_district} onChange={(e) => setForm({ ...form, client_district: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Phone</Label>
                            <Input value={form.client_phone} onChange={(e) => setForm({ ...form, client_phone: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Bank Name</Label>
                            <Input value={form.client_bank_name} onChange={(e) => setForm({ ...form, client_bank_name: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Bank Account No</Label>
                            <Input value={form.client_bank_account_no} onChange={(e) => setForm({ ...form, client_bank_account_no: e.target.value })} />
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Company *</Label>
                        <Select value={form.company_id} onValueChange={(v) => setForm({ ...form, company_id: v })}>
                          <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                          <SelectContent>
                            {companies.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.company_code} — {c.company_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Client *</Label>
                        <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
                          <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                          <SelectContent>
                            {clients.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.client_code} — {c.full_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Instrument Ref</Label>
                        <Input value={form.instrument_ref} onChange={(e) => setForm({ ...form, instrument_ref: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Fiscal Year</Label>
                        <Input
                          placeholder="2081/82"
                          value={form.fiscal_year}
                          inputMode="numeric"
                          onChange={(e) => {
                            const nextValue = e.target.value.replace(/[^0-9/]/g, '').slice(0, 9);
                            setForm({ ...form, fiscal_year: nextValue });
                          }}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Gross Interest</Label>
                        <Input type="number" step="0.01" value={form.gross_interest} onChange={(e) => setForm({ ...form, gross_interest: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Tax Amount</Label>
                        <Input type="number" step="0.01" value={form.tax_amount} onChange={(e) => setForm({ ...form, tax_amount: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Net Payable</Label>
                        <Input type="number" step="0.01" value={form.net_payable} placeholder={String(previewNet || "")} onChange={(e) => setForm({ ...form, net_payable: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Due Date</Label>
                        <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Payment Status</Label>
                        <Select value={form.payment_status} onValueChange={(v) => setForm({ ...form, payment_status: v as PaymentStatus })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Pending">Pending</SelectItem>
                            <SelectItem value="Partial">Partial</SelectItem>
                            <SelectItem value="Paid">Paid</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Payment Date</Label>
                        <Input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} />
                      </div>
                      <div className="space-y-1.5 md:col-span-2">
                        <Label>Payment Reference</Label>
                        <Input value={form.payment_reference} onChange={(e) => setForm({ ...form, payment_reference: e.target.value })} />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
                      <Button disabled={upsert.isPending || !form.company_id || !form.client_id} onClick={() => upsert.mutate()}>
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

      {calcOpen && (
        <Card className="mb-4 bg-muted/20 border-primary/20">
          <CardHeader className="pb-3 border-b bg-muted/40">
            <CardTitle className="flex items-center text-sm font-medium">
              <Calculator className="mr-2 h-4 w-4" />
              Debenture Interest Calculator
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 grid gap-4 lg:grid-cols-2">
            <div className="grid gap-4 sm:grid-cols-3 bg-card p-4 rounded-lg border shadow-sm">
              <div className="space-y-1.5">
                <Label>Debenture Kitta</Label>
                <Input type="number" value={calcKitta} onChange={e => setCalcKitta(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Face Value / Kitta</Label>
                <Input type="number" value={calcFaceValue} onChange={e => setCalcFaceValue(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Annual Int. Rate %</Label>
                <Input type="number" step="0.01" value={calcRate} onChange={e => setCalcRate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>From Date</Label>
                <Input type="date" value={calcFromDate} onChange={e => setCalcFromDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>To Date</Label>
                <Input type="date" value={calcToDate} onChange={e => setCalcToDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Calculated Days</Label>
                <Input readOnly value={calcDays || ''} placeholder="0" className="bg-muted" />
              </div>
              <div className="space-y-1.5">
                <Label>TDS Category</Label>
                  <Select value={calcTdsCategory} onValueChange={(v: any) => setCalcTdsCategory(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PUBLIC">Natural Person — Public (6%)</SelectItem>
                    <SelectItem value="PRIVATE">Natural Person — Private/Promoter (6%)</SelectItem>
                    <SelectItem value="INSTITUTION">Legal Person / Company (15%)</SelectItem>
                    <SelectItem value="MUTUAL_FUND">Mutual Fund / Tax Exempt (0%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {calcTdsCategory !== 'PUBLIC' && calcTdsCategory !== 'PRIVATE' && calcTdsCategory !== 'INSTITUTION' && calcTdsCategory !== 'MUTUAL_FUND' && (
                <div className="space-y-1.5">
                  <Label>Custom TDS %</Label>
                  <Input type="number" step="0.1" value={calcCustomTds} onChange={e => setCalcCustomTds(e.target.value)} />
                </div>
              )}
              <div className="sm:col-span-3 mt-2">
                <Button onClick={handleCalcInterest} className="w-full">Calculate Interest</Button>
              </div>
            </div>

            <div className="bg-primary/5 p-4 rounded-lg border border-primary/10 flex flex-col justify-center">
              {calcResult ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">Total Principal</span>
                    <span className="font-medium">{fmtNr(calcResult.totalPrincipal)}</span>
                  </div>
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">Annual Interest Amount</span>
                    <span className="font-medium text-amber-600">{fmtNr(calcResult.annualInterestAmount)}</span>
                  </div>
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">Daily Interest Rate</span>
                    <span className="font-medium text-blue-600">{fmtNr(calcResult.dailyInterestRate)} / day</span>
                  </div>
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">Days Count</span>
                    <span className="font-medium">{calcResult.daysCount} days</span>
                  </div>
                  <div className="flex justify-between border-b pb-1 pt-1 mt-1 border-t border-t-muted">
                    <span className="text-muted-foreground">Gross Period Interest</span>
                    <span className="font-medium">{fmtNr(calcResult.grossPeriodInterest)}</span>
                  </div>
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">TDS Rate</span>
                    <span className="font-medium">{(calcResult.tdsRate * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">Tax Amount</span>
                    <span className="font-medium text-destructive">{fmtNr(calcResult.taxAmount)}</span>
                  </div>
                  <div className="flex justify-between pt-2">
                    <span className="font-semibold">Net Interest Payable</span>
                    <span className="font-bold text-lg text-green-600">Rs. {fmtNr(calcResult.netInterestPayable)}</span>
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground h-full flex flex-col items-center justify-center">
                  <Calculator className="w-8 h-8 opacity-20 mb-2" />
                  <p>Enter debenture details and calculate to view interest breakdown</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mb-4 grid gap-3 grid-cols-2 md:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Records</div><div className="text-xl font-semibold">{totals.count.toLocaleString()}</div><div className="text-[11px] text-muted-foreground mt-0.5">{totals.paidCount} Paid · {totals.pendingCount} Pending</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Gross Interest</div><div className="text-xl font-semibold">NPR {fmt(totals.gross)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">TDS Tax</div><div className="text-xl font-semibold text-destructive">NPR {fmt(totals.tax)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Net Interest Payable</div><div className="text-xl font-semibold text-emerald-600">NPR {fmt(totals.net)}</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex flex-wrap gap-2">
            <Input placeholder="Search company, client, BOID, bank, ref…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-sm" />
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="Partial">Partial</SelectItem>
                <SelectItem value="Paid">Paid</SelectItem>
              </SelectContent>
            </Select>
            <Select value={companyFilter} onValueChange={(v) => { setCompanyFilter(v); setPage(1); }}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.company_code} — {c.company_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={fyFilter} onValueChange={(v) => { setFyFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All Fiscal Years" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Fiscal Years</SelectItem>
                {fiscalYears.map((fy) => (
                  <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-semibold">Company</TableHead>
                  <TableHead className="font-semibold">Client</TableHead>
                  <TableHead className="font-semibold">BOID</TableHead>
                  <TableHead className="font-semibold">Instrument</TableHead>
                  <TableHead className="text-right font-semibold">Gross</TableHead>
                  <TableHead className="text-right font-semibold">Tax</TableHead>
                  <TableHead className="text-right font-semibold">Net</TableHead>
                  <TableHead className="font-semibold">Due</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold">FY</TableHead>
                  <TableHead className="text-right font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={11} className="py-12 text-center text-muted-foreground">Loading…</TableCell></TableRow>
                ) : pageItems.length === 0 ? (
                  <TableRow><TableCell colSpan={11} className="py-12 text-center text-muted-foreground">No payables.</TableCell></TableRow>
                ) : pageItems.map((p) => {
                  const c = p.company ?? null;
                  const cl = p.client ?? null;
                  return (
                    <TableRow key={p.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell>{c ? <span><span className="font-mono text-xs text-muted-foreground">{c.company_code}</span> {c.company_name}</span> : "—"}</TableCell>
                      <TableCell>{cl ? <span><span className="font-mono text-xs text-muted-foreground">{cl.client_code}</span> {cl.full_name}</span> : "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{cl?.boid ?? "—"}</TableCell>
                      <TableCell className="text-xs">{p.instrument_ref ?? "—"}</TableCell>
                      <TableCell className="text-right">{fmt(p.gross_interest)}</TableCell>
                      <TableCell className="text-right">{fmt(p.tax_amount)}</TableCell>
                      <TableCell className="text-right font-medium">{fmt(p.net_payable)}</TableCell>
                      <TableCell>{p.due_date ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={p.payment_status === "Paid" ? "default" : p.payment_status === "Partial" ? "secondary" : "outline"}>
                          {p.payment_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{p.fiscal_year ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {canWrite && (
                          <div className="flex justify-end gap-1">
                            {p.payment_status !== "Paid" && (
                              <Button size="icon" variant="ghost" onClick={() => { setPayOpen(p); setPayRef(p.payment_reference ?? ""); }} title="Mark paid" className="hover:bg-emerald-50">
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" onClick={() => startEdit(p)} className="hover:bg-blue-50"><Pencil className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete this payable?")) del.mutate(p.id); }} className="hover:bg-red-50">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {filtered.length > pageSize && (
              <div className="flex items-center justify-between border-t px-4 py-3">
                <div className="text-sm text-muted-foreground">
                  Showing {(safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, filtered.length)} of {filtered.length} records
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                    className="h-8 rounded border bg-background px-2 text-sm"
                  >
                    <option value="10">10 / page</option>
                    <option value="25">25 / page</option>
                    <option value="50">50 / page</option>
                  </select>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(1)} disabled={safePage === 1}>
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground px-2">
                    {safePage} / {totalPages}
                  </span>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(totalPages)} disabled={safePage === totalPages}>
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!payOpen} onOpenChange={(o) => !o && setPayOpen(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Mark as Paid</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Payment Date</Label>
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Payment Reference</Label>
              <Input placeholder="Cheque / Txn no." value={payRef} onChange={(e) => setPayRef(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(null)}>Cancel</Button>
            <Button disabled={markPaid.isPending} onClick={() => markPaid.mutate()}>Confirm Payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}