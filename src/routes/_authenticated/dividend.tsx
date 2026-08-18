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
import { RtsService } from "@/lib/services/rts.service";
import { DividendService } from "@/lib/services/dividend.service";
import { SettingsService } from "@/lib/services/settings.service";
import { exportToExcel, importFromExcel } from "@/lib/xlsx-utils";
import { DividendCalculator, type DividendResult } from "@/lib/dividend-calculator";

export const Route = createFileRoute("/_authenticated/dividend")({
  component: DividendPage,
});

type PaymentStatus = "Pending" | "Paid" | "Partial";

interface Payable {
  id: string;
  company_id: string | null;
  client_id: string | null;
  shares_held: number | null;
  dividend_rate: number | null;
  gross_dividend: number | null;
  tax_amount: number | null;
  net_payable: number | null;
  payment_status: PaymentStatus;
  payment_date: string | null;
  payment_reference: string | null;
  fiscal_year: string | null;
  dividend_type?: string | null;
  bonus_actual?: number | null;
  bonus_issued?: number | null;
  bonus_fraction?: number | null;
  after_bonus_kitta?: number | null;
  bonus_tax?: number | null;
  lot_name?: string | null;
  bank_name?: string | null;
  bank_account_no?: string | null;
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
  shares_held: "",
  dividend_rate: "",
  gross_dividend: "",
  tax_amount: "",
  net_payable: "",
  payment_status: "Pending" as PaymentStatus,
  payment_date: "",
  payment_reference: "",
  fiscal_year: "",
  dividend_type: "Cash",
  bonus_actual: "",
  bonus_issued: "",
  bonus_fraction: "",
  after_bonus_kitta: "",
  bonus_tax: "",
  lot_name: "",
};

function DividendPage() {
  const { hasAny } = useAuth();
  const canWrite = hasAny(["admin", "finance_operator"]);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [fyFilter, setFyFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  
  // Fetch settings & active fiscal year
  const { data: settings } = useQuery({ queryKey: ["system-settings"], queryFn: () => SettingsService.getSettings() });
  const { data: activeFyData } = useQuery({ 
    queryKey: ["active_fiscal_year"], 
    queryFn: async () => {
      const { data } = await supabase.from("fiscal_years").select("fiscal_year").eq("is_active", true).maybeSingle();
      return data?.fiscal_year ?? "";
    }
  });

  const [open, setOpen] = useState(false);
  const [payOpen, setPayOpen] = useState<Payable | null>(null);
  const [payRef, setPayRef] = useState("");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [editing, setEditing] = useState<Payable | null>(null);
  const [form, setForm] = useState(emptyForm);
  const fileRef = useRef<HTMLInputElement>(null);

  // ─── Dividend Calculator state ───────────────────────────────────────────────
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcShares, setCalcShares] = useState('');
  const [calcDivType, setCalcDivType] = useState<'Cash' | 'Stock' | 'Bonus' | 'Combined'>('Cash');
  const [calcCashRate, setCalcCashRate] = useState('');
  const [calcCashRateIsPerShare, setCalcCashRateIsPerShare] = useState(false);
  const [calcBonusRatio, setCalcBonusRatio] = useState('');
  const [calcTaxCategory, setCalcTaxCategory] = useState<'PUBLIC' | 'INSTITUTION' | 'TAX_EXEMPTED' | 'CUSTOM'>('PUBLIC');
  const [calcCustomTds, setCalcCustomTds] = useState('');
  const [calcFaceValue, setCalcFaceValue] = useState('100');
  const [calcResult, setCalcResult] = useState<DividendResult | null>(null);

  // Sync settings when they load
  useEffect(() => {
    if (settings && !calcCustomTds && settings.dividend_tds_natural) {
      setCalcCustomTds(String(settings.dividend_tds_natural));
    }
  }, [settings]);

  const handleCalcDividend = () => {
    const shares = Number(calcShares);
    if (!shares || shares <= 0) { toast.error('Enter valid shares held'); return; }
    if ((calcDivType === 'Cash' || calcDivType === 'Combined') && (!calcCashRate || Number(calcCashRate) <= 0)) {
      toast.error('Enter a valid cash dividend rate'); return;
    }
    if ((calcDivType === 'Bonus' || calcDivType === 'Combined' || calcDivType === 'Stock') && (!calcBonusRatio || Number(calcBonusRatio) <= 0)) {
      toast.error('Enter a valid bonus ratio (%)'); return;
    }
    let effectiveCustomRate = undefined;
    let finalTaxCategory = calcTaxCategory;
    
    // Override the calculator's hardcoded 5% by injecting settings defaults via CUSTOM
    if (calcTaxCategory === 'PUBLIC' && settings?.dividend_tds_natural !== undefined) {
      finalTaxCategory = 'CUSTOM';
      effectiveCustomRate = settings.dividend_tds_natural / 100;
    } else if (calcTaxCategory === 'INSTITUTION' && settings?.dividend_tds_legal !== undefined) {
      finalTaxCategory = 'CUSTOM';
      effectiveCustomRate = settings.dividend_tds_legal / 100;
    } else if (calcTaxCategory === 'CUSTOM' && calcCustomTds) {
      effectiveCustomRate = Number(calcCustomTds) / 100;
    }

    const result = DividendCalculator.calculate({
      sharesHeld: shares,
      dividendType: calcDivType,
      cashDividendRate: calcCashRate ? Number(calcCashRate) : undefined,
      cashRateIsPerShare: calcCashRateIsPerShare,
      bonusRatio: calcBonusRatio ? Number(calcBonusRatio) / 100 : undefined,
      taxCategory: finalTaxCategory,
      customTaxRate: effectiveCustomRate,
      faceValue: calcFaceValue ? Number(calcFaceValue) : 100,
    });
    setCalcResult(result);
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
    queryKey: ["dividend_payables"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dividend_payables")
        .select("*, client:clients(id, client_code, full_name, boid, father_name, grandfather_name, pan_or_citizenship, address, district, phone, bank_name, bank_account_no), company:companies(id, company_code, company_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Payable[];
    },
  });

  const fiscalYears = useMemo(() => Array.from(new Set(data.map((p) => p.fiscal_year).filter(Boolean))) as string[], [data]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return data.filter((p) => {
      if (statusFilter !== "all" && p.payment_status !== statusFilter) return false;
      if (companyFilter !== "all" && p.company_id !== companyFilter) return false;
      if (fyFilter !== "all" && p.fiscal_year !== fyFilter) return false;
      if (typeFilter !== "all" && (p.dividend_type || "Cash") !== typeFilter) return false;
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
        (p.lot_name ?? "").toLowerCase().includes(q) ||
        (p.payment_reference ?? "").toLowerCase().includes(q) ||
        (p.dividend_type ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, search, statusFilter, companyFilter, fyFilter, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const totals = useMemo(() => filtered.reduce(
    (a, p) => ({
      count: a.count + 1,
      totalShares: a.totalShares + Number(p.shares_held ?? 0),
      gross: a.gross + Number(p.gross_dividend ?? 0),
      tax: a.tax + Number(p.tax_amount ?? 0),
      bonusTax: a.bonusTax + Number(p.bonus_tax ?? 0),
      net: a.net + Number(p.net_payable ?? 0),
      bonusIssued: a.bonusIssued + Number(p.bonus_issued ?? 0),
    }),
    { count: 0, totalShares: 0, gross: 0, tax: 0, bonusTax: 0, net: 0, bonusIssued: 0 },
  ), [filtered]);

  const upsert = useMutation({
    mutationFn: async () => {
      const shares = form.shares_held ? Number(form.shares_held) : null;
      const rate = form.dividend_rate ? Number(form.dividend_rate) : null;
      const gross = form.gross_dividend ? Number(form.gross_dividend) : (shares != null && rate != null ? shares * rate : null);
      const tax = form.tax_amount ? Number(form.tax_amount) : null;
      const bonusTax = form.bonus_tax ? Number(form.bonus_tax) : 0;
      const net = form.net_payable ? Number(form.net_payable) : (gross != null && tax != null ? Math.max(0, gross - tax - bonusTax) : (gross ?? null));
      const payload = {
        company_id: form.company_id || null,
        client_id: form.client_id || null,
        shares_held: shares,
        dividend_rate: rate,
        gross_dividend: gross,
        tax_amount: tax,
        net_payable: net,
        payment_status: form.payment_status,
        payment_date: form.payment_date || null,
        payment_reference: form.payment_reference || null,
        fiscal_year: form.fiscal_year || null,
        dividend_type: form.dividend_type || "Cash",
        bonus_actual: form.bonus_actual ? Number(form.bonus_actual) : null,
        bonus_issued: form.bonus_issued ? Number(form.bonus_issued) : null,
        bonus_fraction: form.bonus_fraction ? Number(form.bonus_fraction) : null,
        after_bonus_kitta: form.after_bonus_kitta ? Number(form.after_bonus_kitta) : null,
        bonus_tax: form.bonus_tax ? Number(form.bonus_tax) : null,
        lot_name: form.lot_name || null,
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
        const { error } = await supabase.from("dividend_payables").update(payload as never).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("dividend_payables").insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dividend_payables"] });
      qc.invalidateQueries({ queryKey: ["clients-lookup"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      toast.success(editing ? "Payable updated" : "Payable created");
      setOpen(false); setEditing(null); setForm(emptyForm);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("dividend_payables").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dividend_payables"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      toast.success("Payable deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markPaid = useMutation({
    mutationFn: async () => {
      if (!payOpen) return;
      const { error } = await supabase
        .from("dividend_payables")
        .update({ payment_status: "Paid", payment_date: payDate || new Date().toISOString().slice(0, 10), payment_reference: payRef || null })
        .eq("id", payOpen.id);
      if (error) throw error;
      // Push to RTS via DividendService
      await DividendService.pushToRts(payOpen.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dividend_payables"] });
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
      shares_held: p.shares_held?.toString() ?? "",
      dividend_rate: p.dividend_rate?.toString() ?? "",
      gross_dividend: p.gross_dividend?.toString() ?? "",
      tax_amount: p.tax_amount?.toString() ?? "",
      net_payable: p.net_payable?.toString() ?? "",
      payment_status: p.payment_status,
      payment_date: p.payment_date ?? "",
      payment_reference: p.payment_reference ?? "",
      fiscal_year: p.fiscal_year ?? "",
      dividend_type: p.dividend_type ?? "Cash",
      bonus_actual: p.bonus_actual?.toString() ?? "",
      bonus_issued: p.bonus_issued?.toString() ?? "",
      bonus_fraction: p.bonus_fraction?.toString() ?? "",
      after_bonus_kitta: p.after_bonus_kitta?.toString() ?? "",
      bonus_tax: p.bonus_tax?.toString() ?? "",
      lot_name: p.lot_name ?? "",
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
          shares_held: p.shares_held,
          dividend_rate: p.dividend_rate,
          gross_dividend: p.gross_dividend,
          tax_amount: p.tax_amount,
          net_payable: p.net_payable,
          payment_status: p.payment_status,
          payment_date: p.payment_date,
          payment_reference: p.payment_reference,
          fiscal_year: p.fiscal_year,
        };
      }),
      "dividend_payables",
    );
  };

  const handleImport = async (file: File) => {
    try {
      type Row = {
        company_code?: string; company_id?: string; client_code?: string; client_boid?: string; client_id?: string;
        shares_held?: number | string; dividend_rate?: number | string; gross_dividend?: number | string;
        tax_amount?: number | string; net_payable?: number | string; payment_status?: string; payment_date?: string; payment_reference?: string; fiscal_year?: string;
      };
      const rows = await importFromExcel<Row>(file);
      const clean: Record<string, unknown>[] = [];
      const errors: string[] = [];
      rows.forEach((r, i) => {
        const cid = r.company_id || (r.company_code ? companyByCode[String(r.company_code).toLowerCase()] : undefined);
        const clid = r.client_id || (r.client_code ? clientByCode[String(r.client_code).toLowerCase()] : undefined) || (r.client_boid ? clientByBoid[String(r.client_boid).toLowerCase()] : undefined);
        if (!cid || !clid) { errors.push(`Row ${i + 2}: company/client not found`); return; }
        const shares = r.shares_held != null ? Number(r.shares_held) : null;
        const rate = r.dividend_rate != null ? Number(r.dividend_rate) : null;
        const gross = r.gross_dividend != null ? Number(r.gross_dividend) : (shares != null && rate != null ? shares * rate : null);
        clean.push({
          company_id: cid,
          client_id: clid,
          shares_held: shares,
          dividend_rate: rate,
          gross_dividend: gross,
          tax_amount: r.tax_amount != null ? Number(r.tax_amount) : null,
          net_payable: r.net_payable != null ? Number(r.net_payable) : null,
          payment_status: (r.payment_status as PaymentStatus) ?? "Pending",
          payment_date: r.payment_date ?? null,
          payment_reference: r.payment_reference ?? null,
          fiscal_year: r.fiscal_year ?? null,
        });
      });
      if (!clean.length) return toast.error(errors[0] ?? "No valid rows");
      const { error } = await supabase.from("dividend_payables").insert(clean as never);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["dividend_payables"] });
      toast.success(`Imported ${clean.length} rows${errors.length ? ` (${errors.length} skipped)` : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    }
  };

  const fmt = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const previewGross = form.gross_dividend
    ? Number(form.gross_dividend)
    : (Number(form.shares_held) || 0) * (Number(form.dividend_rate) || 0);
  const previewNet = form.net_payable
    ? Number(form.net_payable)
    : Math.max(0, previewGross - (Number(form.tax_amount) || 0) - (Number(form.bonus_tax) || 0));

  return (
    <div>
      <PageHeader
        title="Stock Dividend Payables"
        description="Manage stock dividends with shares × rate calculation, grouped by fiscal year."
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
                      <Plus className="mr-2 h-4 w-4" /> New Dividend
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{editing ? "Edit Dividend Payable" : "New Dividend Payable"}</DialogTitle>
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
                            <Input value={form.client_code} disabled />
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
                        <Label>Shares Held</Label>
                        <Input type="number" step="0.01" value={form.shares_held} onChange={(e) => setForm({ ...form, shares_held: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Dividend Rate</Label>
                        <Input type="number" step="0.0001" value={form.dividend_rate} onChange={(e) => setForm({ ...form, dividend_rate: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Gross Dividend (override)</Label>
                        <Input type="number" step="0.01" placeholder={String(previewGross || "")} value={form.gross_dividend} onChange={(e) => setForm({ ...form, gross_dividend: e.target.value })} />
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
                        <Label>Dividend Type</Label>
                        <Select value={form.dividend_type} onValueChange={(v) => setForm({ ...form, dividend_type: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Cash">Cash</SelectItem>
                            <SelectItem value="Stock">Stock</SelectItem>
                            <SelectItem value="Bonus">Bonus</SelectItem>
                            <SelectItem value="Right">Right</SelectItem>
                          </SelectContent>
                        </Select>
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
                      <div className="space-y-1.5">
                        <Label>Payment Reference</Label>
                        <Input value={form.payment_reference} onChange={(e) => setForm({ ...form, payment_reference: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Bonus Actual</Label>
                        <Input type="number" step="0.01" value={form.bonus_actual} onChange={(e) => setForm({ ...form, bonus_actual: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Bonus Issued</Label>
                        <Input type="number" step="0.01" value={form.bonus_issued} onChange={(e) => setForm({ ...form, bonus_issued: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Bonus Fraction</Label>
                        <Input type="number" step="0.0001" value={form.bonus_fraction} onChange={(e) => setForm({ ...form, bonus_fraction: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>After Bonus Kitta</Label>
                        <Input type="number" step="0.01" value={form.after_bonus_kitta} onChange={(e) => setForm({ ...form, after_bonus_kitta: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Bonus Tax</Label>
                        <Input type="number" step="0.01" value={form.bonus_tax} onChange={(e) => setForm({ ...form, bonus_tax: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Lot Name</Label>
                        <Input value={form.lot_name} onChange={(e) => setForm({ ...form, lot_name: e.target.value })} />
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
              Dividend Calculator
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 grid gap-4 lg:grid-cols-2">
            <div className="grid gap-4 sm:grid-cols-3 bg-card p-4 rounded-lg border shadow-sm">
              <div className="space-y-1.5">
                <Label>Shares Held</Label>
                <Input type="number" value={calcShares} onChange={e => setCalcShares(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Dividend Type</Label>
                <Select value={calcDivType} onValueChange={(v: any) => setCalcDivType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Cash">Cash</SelectItem>
                    <SelectItem value="Stock">Stock</SelectItem>
                    <SelectItem value="Bonus">Bonus</SelectItem>
                    <SelectItem value="Right">Right</SelectItem>
                    <SelectItem value="Combined">Combined</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(calcDivType === 'Stock' || calcDivType === 'Combined') && (
                <div className="space-y-1.5">
                  <Label>Bonus Ratio %</Label>
                  <Input type="number" step="0.01" value={calcBonusRatio} onChange={e => setCalcBonusRatio(e.target.value)} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Cash Rate {calcCashRateIsPerShare ? '(Rs/Share)' : '(%)'}</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" step="0.01" value={calcCashRate} onChange={e => setCalcCashRate(e.target.value)} />
                  <Button variant="outline" size="icon" className="shrink-0 h-9 w-9" onClick={() => setCalcCashRateIsPerShare(!calcCashRateIsPerShare)} title="Toggle % or Rs per share">
                    <span className="text-xs">{calcCashRateIsPerShare ? 'Rs' : '%'}</span>
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Face Value (Rs)</Label>
                <Input type="number" value={calcFaceValue} onChange={e => setCalcFaceValue(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Tax Category</Label>
                <Select value={calcTaxCategory} onValueChange={(v: any) => setCalcTaxCategory(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PUBLIC">Natural Person — Public (5%)</SelectItem>
                    <SelectItem value="INSTITUTION">Legal Person / Company (5%)</SelectItem>
                    <SelectItem value="TAX_EXEMPTED">Mutual Fund / Tax Exempt (0%)</SelectItem>
                    <SelectItem value="CUSTOM">Custom Rate</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {calcTaxCategory === 'CUSTOM' && (
                <div className="space-y-1.5">
                  <Label>Custom TDS %</Label>
                  <Input type="number" step="0.1" value={calcCustomTds} onChange={e => setCalcCustomTds(e.target.value)} />
                </div>
              )}
              <div className="sm:col-span-3 mt-2">
                <Button onClick={handleCalcDividend} className="w-full">Calculate</Button>
              </div>
            </div>

            <div className="bg-primary/5 p-4 rounded-lg border border-primary/10 flex flex-col justify-center">
              {calcResult ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">Shares Held</span>
                    <span className="font-medium">{fmtNr(Number(calcShares))}</span>
                  </div>
                  {calcResult.exactBonusShares > 0 && (
                    <>
                      <div className="flex justify-between border-b pb-1">
                        <span className="text-muted-foreground">Bonus Shares (Exact/Issued/Frac)</span>
                        <span className="font-medium text-amber-600">
                          {fmtNr(calcResult.exactBonusShares)} / {fmtNr(calcResult.issuedBonusShares)} / {fmtNr(calcResult.fractionBonusShares)}
                        </span>
                      </div>
                      <div className="flex justify-between border-b pb-1">
                        <span className="text-muted-foreground">After Bonus Kitta</span>
                        <span className="font-medium text-blue-600">{fmtNr(calcResult.afterBonusKitta)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">Gross Cash Dividend</span>
                    <span className="font-medium">{fmtNr(calcResult.grossCashDividend)}</span>
                  </div>
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">TDS Rate</span>
                    <span className="font-medium">{(calcResult.appliedTdsRate * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">Cash TDS</span>
                    <span className="font-medium text-destructive">{fmtNr(calcResult.cashTaxAmount)}</span>
                  </div>
                  {calcResult.bonusTaxAmount > 0 && (
                    <div className="flex justify-between border-b pb-1">
                      <span className="text-muted-foreground">Bonus Tax</span>
                      <span className="font-medium text-destructive">{fmtNr(calcResult.bonusTaxAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2">
                    <span className="font-semibold">Net Cash Payable</span>
                    <span className="font-bold text-lg text-green-600">Rs. {fmtNr(calcResult.netCashPayable)}</span>
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground h-full flex flex-col items-center justify-center">
                  <Calculator className="w-8 h-8 opacity-20 mb-2" />
                  <p>Enter values and calculate to view detailed breakdown</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mb-4 grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Shares Held</div><div className="text-xl font-semibold">{totals.totalShares.toLocaleString()}</div><div className="text-[11px] text-muted-foreground mt-0.5">{totals.count.toLocaleString()} records</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Gross Cash Dividend</div><div className="text-xl font-semibold">NPR {fmt(totals.gross)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Tax (Cash + Bonus)</div><div className="text-xl font-semibold text-destructive">NPR {fmt(totals.tax + totals.bonusTax)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Bonus Shares Issued</div><div className="text-xl font-semibold text-amber-600">{totals.bonusIssued.toLocaleString()} Kitta</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Net Cash Payable</div><div className="text-xl font-semibold text-emerald-600">NPR {fmt(totals.net)}</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex flex-wrap gap-2">
            <Input placeholder="Search company, client, BOID, bank, lot…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-sm" />
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="Partial">Partial</SelectItem>
                <SelectItem value="Paid">Paid</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All Types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="Cash">Cash Dividend</SelectItem>
                <SelectItem value="Stock">Stock Dividend</SelectItem>
                <SelectItem value="Bonus">Bonus Share</SelectItem>
                <SelectItem value="Right">Right Share</SelectItem>
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
              <SelectTrigger className="w-36"><SelectValue placeholder="All FY" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All FY</SelectItem>
                {fiscalYears.map((fy) => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}
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
                  <TableHead className="font-semibold">Type</TableHead>
                  <TableHead className="text-right font-semibold">Shares</TableHead>
                  <TableHead className="text-right font-semibold">Rate</TableHead>
                  <TableHead className="text-right font-semibold">Gross</TableHead>
                  <TableHead className="text-right font-semibold">Tax</TableHead>
                  <TableHead className="text-right font-semibold">Net</TableHead>
                  <TableHead className="font-semibold">FY</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="text-right font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={11} className="py-12 text-center text-muted-foreground">Loading…</TableCell></TableRow>
                ) : pageItems.length === 0 ? (
                  <TableRow><TableCell colSpan={11} className="py-12 text-center text-muted-foreground">No dividend payables.</TableCell></TableRow>
                ) : pageItems.map((p) => {
                  const c = p.company ?? null;
                  const cl = p.client ?? null;
                  return (
                    <TableRow key={p.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell>{c ? <span><span className="font-mono text-xs text-muted-foreground">{c.company_code}</span> {c.company_name}</span> : "—"}</TableCell>
                      <TableCell>{cl ? <span><span className="font-mono text-xs text-muted-foreground">{cl.client_code}</span> {cl.full_name}</span> : "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{cl?.boid ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {p.dividend_type || 'Cash'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{fmt(p.shares_held)}</TableCell>
                      <TableCell className="text-right">{fmt(p.dividend_rate)}</TableCell>
                      <TableCell className="text-right">{fmt(p.gross_dividend)}</TableCell>
                      <TableCell className="text-right">{fmt(p.tax_amount)}</TableCell>
                      <TableCell className="text-right font-medium">{fmt(p.net_payable)}</TableCell>
                      <TableCell className="text-xs">{p.fiscal_year ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={p.payment_status === "Paid" ? "default" : p.payment_status === "Partial" ? "secondary" : "outline"}>
                          {p.payment_status}
                        </Badge>
                      </TableCell>
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
            {true && (
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