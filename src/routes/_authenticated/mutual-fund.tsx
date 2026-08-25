import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase, fetchAllRows } from "@/lib/services/database";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Pencil, Plus, Trash2, Download, Upload, CheckCircle2, Calculator, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileSpreadsheet, FileText, BarChart3, Search, Users, Coins, Receipt, Wallet, Building2, Filter, X } from "lucide-react";
import { toast } from "sonner";
import { exportToExcel, importFromExcel } from "@/lib/xlsx-utils";
import { SummaryReportService } from "@/lib/services/summary-report.service";
import { STANDARD_PERIODS, type PeriodPreset } from "@/lib/services/period-calculator";
import { ShareholderStatementDialog } from "@/components/shareholder-statement-dialog";
import {
  getTaxRateFromRules,
  investorCategoryToClassification,
  loadTaxRules,
} from "@/lib/services/tax-rules.service";

export const Route = createFileRoute("/_authenticated/mutual-fund")({
  component: MutualFundPage,
});

type PaymentStatus = "Pending" | "Paid" | "Partial";

interface Payable {
  id: string;
  company_id: string | null;
  client_id: string | null;
  shares_held: number | null;
  kitta?: number | null;
  dividend_rate: number | null;
  dividend_type: string | null;
  gross_dividend: number | null;
  tax_amount: number | null;
  net_payable: number | null;
  payment_status: PaymentStatus;
  payment_date: string | null;
  payment_reference: string | null;
  fiscal_year: string | null;
  bonus_actual?: number | null;
  bonus_issued?: number | null;
  bonus_fraction?: number | null;
  after_bonus_kitta?: number | null;
  bonus_tax?: number | null;
  bank_name?: string | null;
  bank_account_no?: string | null;
  lot_name?: string | null;
  upload_id?: string | null;
  created_at: string;
  client?: {
    id: string;
    client_code: string;
    full_name: string;
    boid: string | null;
    kitta?: number | null;
    holder_type?: string | null;
    payee_classification?: string | null;
    father_name: string | null;
    grandfather_name: string | null;
    pan_no?: string | null;
    citizenship_no?: string | null;
    pan_or_citizenship: string | null;
    nid_number?: string | null;
    address: string | null;
    district: string | null;
    phone: string | null;
    bank_name: string | null;
    bank_account_no: string | null;
  } | null;
  company?: {
    id: string;
    company_code: string;
    company_name: string;
  } | null;
}

const emptyForm = {
  company_id: "",
  client_id: "",
  client_boid: "",
  client_code: "",
  client_full_name: "",
  client_father_name: "",
  client_grandfather_name: "",
  client_pan: "",
  client_citizenship: "",
  client_nid: "",
  client_address: "",
  client_district: "",
  client_phone: "",
  client_bank_name: "",
  client_bank_account_no: "",
  shares_held: "",
  dividend_rate: "",
  dividend_type: "Cash",
  gross_dividend: "",
  tax_amount: "",
  net_payable: "",
  payment_status: "Pending" as PaymentStatus,
  payment_date: "",
  payment_reference: "",
  bonus_actual: "",
  bonus_issued: "",
  bonus_fraction: "",
  after_bonus_kitta: "",
  bonus_tax: "",
  lot_name: "",
  fiscal_year: "",
};

function MutualFundPage() {
  const { hasAny, isAdmin } = useAuth();
  const canWrite = hasAny(["admin", "finance_operator"]);
  const canDelete = isAdmin;
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [fyFilter, setFyFilter] = useState<string>("all");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [fromDateFilter, setFromDateFilter] = useState<string>("");
  const [toDateFilter, setToDateFilter] = useState<string>("");
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset | "ALL">("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [open, setOpen] = useState(false);
  const [selectedStatementBoid, setSelectedStatementBoid] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState<Payable | null>(null);
  const [payRef, setPayRef] = useState("");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [editing, setEditing] = useState<Payable | null>(null);
  const [form, setForm] = useState(emptyForm);
  const fileRef = useRef<HTMLInputElement>(null);

  // ─── Mutual Fund Calculator state ─────────────────────────────────────────
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcUnits, setCalcUnits] = useState("");
  const [calcRate, setCalcRate] = useState("");
  const [calcRateIsPerUnit, setCalcRateIsPerUnit] = useState(true);
  const [calcFaceValue, setCalcFaceValue] = useState("10");
  const [calcTaxCategory, setCalcTaxCategory] = useState<"TAX_EXEMPTED" | "PUBLIC" | "INSTITUTION" | "CUSTOM">("TAX_EXEMPTED");
  const [calcCustomTds, setCalcCustomTds] = useState("0");

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

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-lookup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, client_code, full_name, boid, bank_name, bank_account_no")
        .order("full_name")
        .limit(5000);
      if (error) throw error;
      return (data || []) as {
        id: string;
        client_code: string;
        full_name: string;
        boid: string | null;
        bank_name: string | null;
        bank_account_no: string | null;
      }[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const companyMap = useMemo(() => Object.fromEntries(companies.map((c) => [c.id, c])), [companies]);
  const clientMap = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);
  const companyByCode = useMemo(
    () => Object.fromEntries(companies.map((c) => [c.company_code.toLowerCase(), c.id])),
    [companies],
  );

  // Centralized TDS rules — the calculator uses exactly what imports/DB apply.
  const { data: mfRules } = useQuery({
    queryKey: ["tax-rules"],
    queryFn: () => loadTaxRules(true),
  });
  const clientByCode = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.client_code.toLowerCase(), c.id])),
    [clients],
  );
  const clientByBoid = useMemo(
    () => Object.fromEntries(clients.filter((c) => c.boid).map((c) => [c.boid!.toLowerCase(), c.id])),
    [clients],
  );

  // Debounced search — wait 400ms before firing server query
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter, companyFilter, fyFilter, classFilter, fromDateFilter, toDateFilter]);

  // Fetch fiscal years for filter dropdown
  const { data: fiscalYears = [] } = useQuery({
    queryKey: ["mutual_fund_fiscal_years"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("mutual_fund_payables").select("fiscal_year").order("fiscal_year", { ascending: false });
      return Array.from(new Set((data || []).map((r: any) => r.fiscal_year).filter(Boolean))) as string[];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Server-side totals for KPI cards (using fetchAllRows to support datasets > 1,000 records)
  const { data: totals = { count: 0, paidCount: 0, pendingCount: 0, units: 0, gross: 0, tax: 0, net: 0 } } = useQuery({
    queryKey: ["mutual_fund_payables_totals", statusFilter, companyFilter, fyFilter, classFilter, fromDateFilter, toDateFilter],
    queryFn: async () => {
      const data = await fetchAllRows<any>((from, to) => {
        let q = (supabase as any)
          .from("mutual_fund_payables")
          .select("payment_status, shares_held, gross_dividend, tax_amount, net_payable, payee_classification, payee_segment, lot_name, created_at, payment_date")
          .range(from, to);
        if (statusFilter !== "all") q = q.eq("payment_status", statusFilter);
        if (companyFilter !== "all") q = q.eq("company_id", companyFilter);
        if (fyFilter !== "all") q = q.eq("fiscal_year", fyFilter);
        if (fromDateFilter) q = q.gte("created_at", fromDateFilter);
        if (toDateFilter) q = q.lte("created_at", `${toDateFilter}T23:59:59Z`);
        if (classFilter !== "all") {
          if (classFilter === "PROMOTER") {
            q = q.or("payee_segment.eq.PROMOTER,lot_name.ilike.%PROMOT%");
          } else if (classFilter === "LOCAL") {
            q = q.or("payee_segment.eq.LOCAL,lot_name.ilike.%LOCAL%");
          } else if (classFilter === "TAX_EXEMPT") {
            q = q.or("payee_classification.eq.TAX_EXEMPT,lot_name.ilike.%MUTUAL%,lot_name.ilike.%EXEMPT%");
          } else if (classFilter === "INSTITUTION") {
            q = q.or("payee_classification.eq.COMPANY_INSTITUTION,lot_name.ilike.%INSTITUT%,lot_name.ilike.%COMPANY%");
          } else if (classFilter === "PUBLIC") {
            q = q.or("payee_classification.eq.NATURAL_PERSON,payee_classification.eq.PUBLIC_LEGAL_PERSON,lot_name.ilike.%PUBLIC%");
          }
        }
        return q;
      });

      return (data || []).reduce(
        (acc: { count: number; paidCount: number; pendingCount: number; units: number; gross: number; tax: number; net: number }, p: { payment_status: string; shares_held: number | null; gross_dividend: number | null; tax_amount: number | null; net_payable: number | null }) => ({
          count: acc.count + 1,
          paidCount: acc.paidCount + (p.payment_status === "Paid" ? 1 : 0),
          pendingCount: acc.pendingCount + (p.payment_status === "Pending" ? 1 : 0),
          units: acc.units + Number(p.shares_held ?? 0),
          gross: acc.gross + Number(p.gross_dividend ?? 0),
          tax: acc.tax + Number(p.tax_amount ?? 0),
          net: acc.net + Number(p.net_payable ?? 0),
        }),
        { count: 0, paidCount: 0, pendingCount: 0, units: 0, gross: 0, tax: 0, net: 0 }
      );
    },
    staleTime: 60_000,
  });

  // Main server-side paginated query
  const { data: pageResult = { rows: [], count: 0 }, isLoading } = useQuery({
    queryKey: ["mutual_fund_payables", page, pageSize, debouncedSearch, statusFilter, companyFilter, fyFilter, classFilter, fromDateFilter, toDateFilter],
    queryFn: async () => {
      let q = (supabase as any)
        .from("mutual_fund_payables")
        .select(
          "*, client:clients(id, client_code, full_name, boid, father_name, grandfather_name, pan_or_citizenship, address, district, phone, bank_name, bank_account_no), company:companies(id, company_code, company_name)",
          { count: "exact" }
        )
        .order("created_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (statusFilter !== "all") q = q.eq("payment_status", statusFilter);
      if (companyFilter !== "all") q = q.eq("company_id", companyFilter);
      if (fyFilter !== "all") q = q.eq("fiscal_year", fyFilter);
      if (fromDateFilter) q = q.gte("created_at", fromDateFilter);
      if (toDateFilter) q = q.lte("created_at", `${toDateFilter}T23:59:59Z`);
      if (classFilter !== "all") {
        if (classFilter === "PROMOTER") {
          q = q.or("payee_segment.eq.PROMOTER,lot_name.ilike.%PROMOT%");
        } else if (classFilter === "LOCAL") {
          q = q.or("payee_segment.eq.LOCAL,lot_name.ilike.%LOCAL%");
        } else if (classFilter === "TAX_EXEMPT") {
          q = q.or("payee_classification.eq.TAX_EXEMPT,lot_name.ilike.%MUTUAL%,lot_name.ilike.%EXEMPT%");
        } else if (classFilter === "INSTITUTION") {
          q = q.or("payee_classification.eq.COMPANY_INSTITUTION,lot_name.ilike.%INSTITUT%,lot_name.ilike.%COMPANY%");
        } else if (classFilter === "PUBLIC") {
          q = q.or("payee_classification.eq.NATURAL_PERSON,payee_classification.eq.PUBLIC_LEGAL_PERSON,lot_name.ilike.%PUBLIC%");
        }
      }

      if (debouncedSearch) {
        q = q.or(
          `lot_name.ilike.%${debouncedSearch}%,payment_reference.ilike.%${debouncedSearch}%,bank_name.ilike.%${debouncedSearch}%,bank_account_no.ilike.%${debouncedSearch}%`
        );
      }

      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: (data || []) as Payable[], count: count || 0 };
    },
    placeholderData: keepPreviousData,
  });

  const data = pageResult.rows;
  const totalPages = Math.max(1, Math.ceil(pageResult.count / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = data;

  // Helper to fetch all filtered rows for export
  const fetchAllFiltered = useCallback(async (): Promise<Payable[]> => {
    return fetchAllRows<Payable>((from, to) => {
      let q = (supabase as any)
        .from("mutual_fund_payables")
        .select(
          "*, client:clients(id, client_code, full_name, boid, father_name, grandfather_name, pan_or_citizenship, address, district, phone, bank_name, bank_account_no), company:companies(id, company_code, company_name)"
        )
        .order("created_at", { ascending: false })
        .range(from, to);
      if (statusFilter !== "all") q = q.eq("payment_status", statusFilter);
      if (companyFilter !== "all") q = q.eq("company_id", companyFilter);
      if (fyFilter !== "all") q = q.eq("fiscal_year", fyFilter);
      if (fromDateFilter) q = q.gte("created_at", fromDateFilter);
      if (toDateFilter) q = q.lte("created_at", `${toDateFilter}T23:59:59Z`);
      return q;
    });
  }, [statusFilter, companyFilter, fyFilter, fromDateFilter, toDateFilter]);

  // Category-wise distribution summary in the CDS "SUMMARY" sheet layout.
  const mfSummary = useQuery({
    queryKey: ["mf-summary", companyFilter, fyFilter, fromDateFilter, toDateFilter],
    queryFn: () =>
      SummaryReportService.getMutualFundSummary({
        companyId: companyFilter,
        fiscalYear: fyFilter,
        startDate: fromDateFilter || undefined,
        endDate: toDateFilter || undefined,
      }),
  });
  const mfTotal = useMemo(
    () =>
      (mfSummary.data ?? []).reduce(
        (acc, r) => ({
          kitta: acc.kitta + r.kitta,
          gross: acc.gross + r.gross,
          tax: acc.tax + r.tax,
          net: acc.net + r.net,
        }),
        { kitta: 0, gross: 0, tax: 0, net: 0 },
      ),
    [mfSummary.data],
  );

  const calcResult = useMemo(() => {
    const units = Number(calcUnits);
    const fv = Number(calcFaceValue) || 10;
    const rate = Number(calcRate);
    if (!units || !rate) return null;

    const totalPrincipal = units * fv;
    let gross = 0;
    if (calcRateIsPerUnit) {
      gross = units * rate;
    } else {
      gross = (units * fv * rate) / 100;
    }

    let tdsRate = 0;
    // Authoritative: centralized MUTUAL_FUND rules (fallback = previous values).
    const ruleRate =
      calcTaxCategory !== "CUSTOM"
        ? getTaxRateFromRules(
            mfRules ?? [],
            "MUTUAL_FUND",
            investorCategoryToClassification(calcTaxCategory) ?? "TAX_EXEMPT",
          )
        : null;
    if (ruleRate != null) tdsRate = ruleRate;
    else if (calcTaxCategory === "PUBLIC") tdsRate = 0.05;
    else if (calcTaxCategory === "INSTITUTION") tdsRate = 0.15;
    else if (calcTaxCategory === "CUSTOM") tdsRate = (Number(calcCustomTds) || 0) / 100;

    const tax = gross * tdsRate;
    const net = gross - tax;

    return {
      totalPrincipal,
      gross: Math.round(gross * 100) / 100,
      tdsRate,
      tax: Math.round(tax * 100) / 100,
      net: Math.round(net * 100) / 100,
    };
  }, [calcUnits, calcRate, calcRateIsPerUnit, calcFaceValue, calcTaxCategory, calcCustomTds, mfRules]);

  const upsert = useMutation({
    mutationFn: async () => {
      const shares = form.shares_held ? Number(form.shares_held) : null;
      const rate = form.dividend_rate ? Number(form.dividend_rate) : null;
      // Gross: use explicit value if provided, else units × rate (simple per-unit) 
      const gross = form.gross_dividend
        ? Number(form.gross_dividend)
        : shares != null && rate != null
          ? Math.round(shares * rate * 100) / 100
          : null;
      const tax = form.tax_amount ? Number(form.tax_amount) : null;
      const net = form.net_payable
        ? Number(form.net_payable)
        : gross != null && tax != null
        ? gross - tax
        : gross ?? null;
      const payload = {
        company_id: form.company_id || null,
        client_id: form.client_id || null,
        shares_held: shares,
        dividend_rate: rate,
        dividend_type: form.dividend_type || "Cash",
        gross_dividend: gross,
        tax_amount: tax,
        net_payable: net,
        payment_status: form.payment_status,
        payment_date: form.payment_date || null,
        payment_reference: form.payment_reference || null,
        fiscal_year: form.fiscal_year || null,
        bonus_actual: form.bonus_actual ? Number(form.bonus_actual) : null,
        bonus_issued: form.bonus_issued ? Number(form.bonus_issued) : null,
        bonus_fraction: form.bonus_fraction ? Number(form.bonus_fraction) : null,
        after_bonus_kitta: form.after_bonus_kitta ? Number(form.after_bonus_kitta) : null,
        bonus_tax: form.bonus_tax ? Number(form.bonus_tax) : null,
        bank_name: form.client_bank_name || null,
        bank_account_no: form.client_bank_account_no || null,
        lot_name: form.lot_name || null,
      };

      if (editing && editing.client_id) {
        const clientPayload: Record<string, unknown> = {};
        if (form.client_boid !== undefined) clientPayload.boid = form.client_boid || null;
        if (form.client_full_name !== undefined) clientPayload.full_name = form.client_full_name || null;
        if (form.client_father_name !== undefined) clientPayload.father_name = form.client_father_name || null;
        if (form.client_grandfather_name !== undefined) clientPayload.grandfather_name = form.client_grandfather_name || null;
        if (form.client_pan !== undefined) {
          clientPayload.pan_no = form.client_pan || null;
        }
        if (form.client_citizenship !== undefined) {
          clientPayload.citizenship_no = form.client_citizenship || null;
        }
        clientPayload.pan_or_citizenship = form.client_pan || form.client_citizenship || null;
        if (form.client_nid !== undefined) clientPayload.nid_number = form.client_nid || null;
        if (form.client_address !== undefined) clientPayload.address = form.client_address || null;
        if (form.client_district !== undefined) clientPayload.district = form.client_district || null;
        if (form.client_phone !== undefined) clientPayload.phone = form.client_phone || null;
        if (form.client_bank_name !== undefined) clientPayload.bank_name = form.client_bank_name || null;
        if (form.client_bank_account_no !== undefined) clientPayload.bank_account_no = form.client_bank_account_no || null;
        const { error: clientErr } = await supabase.from("clients").update(clientPayload as never).eq("id", editing.client_id);
        if (clientErr) throw clientErr;
      }

      if (editing) {
        const { error } = await (supabase as any).from("mutual_fund_payables").update(payload as never).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("mutual_fund_payables").insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mutual_fund_payables"] });
      qc.invalidateQueries({ queryKey: ["mutual_fund_payables_totals"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      toast.success(editing ? "Payable & client updated" : "Payable created");
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("mutual_fund_payables").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mutual_fund_payables"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      toast.success("Payable deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markPaid = useMutation({
    mutationFn: async () => {
      if (!payOpen) return;
      const { error } = await (supabase as any)
        .from("mutual_fund_payables")
        .update({ payment_status: "Paid", payment_date: payDate || new Date().toISOString().slice(0, 10), payment_reference: payRef || null })
        .eq("id", payOpen.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mutual_fund_payables"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      toast.success("Marked as paid");
      setPayOpen(null);
      setPayRef("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const startEdit = (p: Payable) => {
    const cl = p.client ?? null;
    setEditing(p);
    setForm({
      company_id: p.company_id ?? "",
      client_id: p.client_id ?? "",
      client_boid: cl?.boid ?? "",
      client_code: cl?.client_code ?? "",
      client_full_name: cl?.full_name ?? "",
      client_father_name: cl?.father_name ?? "",
      client_grandfather_name: cl?.grandfather_name ?? "",
      client_pan: cl?.pan_no ?? (cl?.pan_or_citizenship && String(cl.pan_or_citizenship).length === 9 ? cl.pan_or_citizenship : ""),
      client_citizenship: cl?.citizenship_no ?? (cl?.pan_or_citizenship && String(cl.pan_or_citizenship).length !== 9 ? cl.pan_or_citizenship : ""),
      client_nid: cl?.nid_number ?? "",
      client_address: cl?.address ?? "",
      client_district: cl?.district ?? "",
      client_phone: cl?.phone ?? "",
      client_bank_name: cl?.bank_name ?? "",
      client_bank_account_no: cl?.bank_account_no ?? "",
      shares_held: p.shares_held?.toString() ?? "",
      dividend_rate: p.dividend_rate?.toString() ?? "",
      dividend_type: p.dividend_type ?? "Cash",
      gross_dividend: p.gross_dividend?.toString() ?? "",
      tax_amount: p.tax_amount?.toString() ?? "",
      net_payable: p.net_payable?.toString() ?? "",
      payment_status: p.payment_status,
      payment_date: p.payment_date ?? "",
      payment_reference: p.payment_reference ?? "",
      bonus_actual: p.bonus_actual?.toString() ?? "",
      bonus_issued: p.bonus_issued?.toString() ?? "",
      bonus_fraction: p.bonus_fraction?.toString() ?? "",
      after_bonus_kitta: p.after_bonus_kitta?.toString() ?? "",
      bonus_tax: p.bonus_tax?.toString() ?? "",
      lot_name: p.lot_name ?? "",
      fiscal_year: p.fiscal_year ?? "",
    });
    setOpen(true);
  };

  const handleExport = async () => {
    const rows = await fetchAllFiltered();
    exportToExcel(
      rows.map((p) => {
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
          dividend_type: p.dividend_type,
          gross_dividend: p.gross_dividend,
          tax_amount: p.tax_amount,
          net_payable: p.net_payable,
          payment_status: p.payment_status,
          payment_date: p.payment_date,
          payment_reference: p.payment_reference,
          bonus_actual: p.bonus_actual,
          bonus_issued: p.bonus_issued,
          bonus_fraction: p.bonus_fraction,
          after_bonus_kitta: p.after_bonus_kitta,
          bonus_tax: p.bonus_tax,
          bank_name: p.bank_name,
          bank_account_no: p.bank_account_no,
          lot_name: p.lot_name,
          fiscal_year: p.fiscal_year,
        };
      }),
      "mutual_fund_payables",
    );
  };

  const handleImport = async (file: File) => {
    try {
      type Row = {
        company_code?: string;
        company_id?: string;
        client_code?: string;
        client_boid?: string;
        client_id?: string;
        shares_held?: number | string;
        dividend_rate?: number | string;
        dividend_type?: string;
        gross_dividend?: number | string;
        tax_amount?: number | string;
        net_payable?: number | string;
        payment_status?: string;
        payment_date?: string;
        payment_reference?: string;
        bonus_actual?: number | string;
        bonus_issued?: number | string;
        bonus_fraction?: number | string;
        after_bonus_kitta?: number | string;
        bonus_tax?: number | string;
        bank_name?: string;
        bank_account_no?: string;
        lot_name?: string;
        fiscal_year?: string;
      };
      const rows = await importFromExcel<Row>(file);
      const clean: Record<string, unknown>[] = [];
      const errors: string[] = [];
      rows.forEach((r, i) => {
        const cid = r.company_id || (r.company_code ? companyByCode[String(r.company_code).toLowerCase()] : undefined);
        const clid =
          r.client_id ||
          (r.client_code ? clientByCode[String(r.client_code).toLowerCase()] : undefined) ||
          (r.client_boid ? clientByBoid[String(r.client_boid).toLowerCase()] : undefined);
        if (!cid || !clid) {
          errors.push(`Row ${i + 2}: company/client not found`);
          return;
        }
        clean.push({
          company_id: cid,
          client_id: clid,
          shares_held: r.shares_held != null ? Number(r.shares_held) : null,
          dividend_rate: r.dividend_rate != null ? Number(r.dividend_rate) : null,
          dividend_type: r.dividend_type ?? "Cash",
          gross_dividend: r.gross_dividend != null ? Number(r.gross_dividend) : null,
          tax_amount: r.tax_amount != null ? Number(r.tax_amount) : null,
          net_payable: r.net_payable != null ? Number(r.net_payable) : null,
          payment_status: (r.payment_status as PaymentStatus) ?? "Pending",
          payment_date: r.payment_date ?? null,
          payment_reference: r.payment_reference ?? null,
          bonus_actual: r.bonus_actual != null ? Number(r.bonus_actual) : null,
          bonus_issued: r.bonus_issued != null ? Number(r.bonus_issued) : null,
          bonus_fraction: r.bonus_fraction != null ? Number(r.bonus_fraction) : null,
          after_bonus_kitta: r.after_bonus_kitta != null ? Number(r.after_bonus_kitta) : null,
          bonus_tax: r.bonus_tax != null ? Number(r.bonus_tax) : null,
          bank_name: r.bank_name ?? null,
          bank_account_no: r.bank_account_no ?? null,
          lot_name: r.lot_name ?? null,
          fiscal_year: r.fiscal_year ?? null,
        });
      });
      if (!clean.length) return toast.error(errors[0] ?? "No valid rows");
      const { error } = await (supabase as any).from("mutual_fund_payables").insert(clean as never);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["mutual_fund_payables"] });
      toast.success(`Imported ${clean.length} rows${errors.length ? ` (${errors.length} skipped)` : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    }
  };

  const fmt = (n: number | null | undefined) =>
    n == null ? "—" : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const previewNet =
    form.net_payable && !Number.isNaN(Number(form.net_payable))
      ? Number(form.net_payable)
      : ((Number(form.gross_dividend) || 0) - (Number(form.tax_amount) || 0));

  return (
    <div>
      <PageHeader
        title="Mutual Fund Payables"
        description="View and manage mutual fund payables that are uploaded through the dedicated mutual fund import path."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!(mfSummary.data?.length)}
              onClick={() =>
                SummaryReportService.exportMutualFundSummaryToExcel(
                  mfSummary.data ?? [],
                  "mutual_fund_summary",
                )
              }
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Summary
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCalcOpen((v) => !v)}>
              <Calculator className="mr-2 h-4 w-4" />
              Calculator
              {calcOpen ? <ChevronUp className="ml-1 h-3 w-3" /> : <ChevronDown className="ml-1 h-3 w-3" />}
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
                      <Plus className="mr-2 h-4 w-4" /> New Payable
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{editing ? "Edit Mutual Fund Payable" : "New Mutual Fund Payable"}</DialogTitle>
                    </DialogHeader>
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
                            <Label>PAN Number</Label>
                            <Input value={form.client_pan} onChange={(e) => setForm({ ...form, client_pan: e.target.value })} placeholder="9-digit PAN" className="font-mono" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Citizenship Number</Label>
                            <Input value={form.client_citizenship} onChange={(e) => setForm({ ...form, client_citizenship: e.target.value })} placeholder="Citizenship No." />
                          </div>
                          <div className="space-y-1.5">
                            <Label>NID Number (National ID)</Label>
                            <Input value={form.client_nid} onChange={(e) => setForm({ ...form, client_nid: e.target.value })} placeholder="10-digit NID" className="font-mono" />
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
                          <SelectTrigger>
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
                      </div>
                      <div className="space-y-1.5">
                        <Label>Client *</Label>
                        <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select client" />
                          </SelectTrigger>
                          <SelectContent>
                            {clients.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.full_name} {c.boid ? `(${c.boid})` : ""}
                              </SelectItem>
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
                        <Label>Gross Dividend</Label>
                        <Input type="number" step="0.01" value={form.gross_dividend} onChange={(e) => setForm({ ...form, gross_dividend: e.target.value })} />
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
                            const nextValue = e.target.value.replace(/[^0-9/]/g, "").slice(0, 9);
                            setForm({ ...form, fiscal_year: nextValue });
                          }}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Payment Status</Label>
                        <Select value={form.payment_status} onValueChange={(v) => setForm({ ...form, payment_status: v as PaymentStatus })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
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
                      <div className="space-y-1.5 md:col-span-2">
                        <Label>Bank Name</Label>
                        <Input value={form.client_bank_name} onChange={(e) => setForm({ ...form, client_bank_name: e.target.value })} />
                      </div>
                      <div className="space-y-1.5 md:col-span-2">
                        <Label>Bank Account No</Label>
                        <Input value={form.client_bank_account_no} onChange={(e) => setForm({ ...form, client_bank_account_no: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Lot Name</Label>
                        <Input value={form.lot_name} onChange={(e) => setForm({ ...form, lot_name: e.target.value })} />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>
                        Cancel
                      </Button>
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
              Mutual Fund Distribution Calculator
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 grid gap-4 lg:grid-cols-2">
            <div className="grid gap-4 sm:grid-cols-3 bg-card p-4 rounded-lg border shadow-sm">
              <div className="space-y-1.5">
                <Label>Units Held</Label>
                <Input type="number" placeholder="e.g. 5000" value={calcUnits} onChange={(e) => setCalcUnits(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Face Value / Unit (Rs)</Label>
                <Input type="number" value={calcFaceValue} onChange={(e) => setCalcFaceValue(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Rate {calcRateIsPerUnit ? "(Rs/Unit)" : "(%)"}</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" step="0.01" value={calcRate} onChange={(e) => setCalcRate(e.target.value)} />
                  <Button variant="outline" size="icon" className="shrink-0 h-9 w-9" onClick={() => setCalcRateIsPerUnit(!calcRateIsPerUnit)} title="Toggle % or Rs per unit">
                    <span className="text-xs">{calcRateIsPerUnit ? "Rs" : "%"}</span>
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Tax Status</Label>
                <Select value={calcTaxCategory} onValueChange={(v: any) => setCalcTaxCategory(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TAX_EXEMPTED">Tax Exempted (0%)</SelectItem>
                    <SelectItem value="PUBLIC">Public Individual (5%)</SelectItem>
                    <SelectItem value="INSTITUTION">Institution (15%)</SelectItem>
                    <SelectItem value="CUSTOM">Custom %</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {calcTaxCategory === "CUSTOM" && (
                <div className="space-y-1.5">
                  <Label>Custom Tax %</Label>
                  <Input type="number" step="0.5" value={calcCustomTds} onChange={(e) => setCalcCustomTds(e.target.value)} />
                </div>
              )}
            </div>

            <div className="bg-primary/5 p-4 rounded-lg border border-primary/10 flex flex-col justify-center">
              {calcResult ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">Total Units / Investment Value</span>
                    <span className="font-medium">{fmt(Number(calcUnits))} Units (Rs. {fmt(calcResult.totalPrincipal)})</span>
                  </div>
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">Gross Distribution</span>
                    <span className="font-medium text-blue-600">Rs. {fmt(calcResult.gross)}</span>
                  </div>
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">TDS Tax Rate</span>
                    <span className="font-medium">
                      {(calcResult.tdsRate * 100).toFixed(2)}%
                      {calcTaxCategory === "TAX_EXEMPTED" && (
                        <Badge variant="secondary" className="ml-2 text-[10px] bg-emerald-100 text-emerald-700">Tax Exempt</Badge>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">Tax Amount</span>
                    <span className="font-medium text-destructive">Rs. {fmt(calcResult.tax)}</span>
                  </div>
                  <div className="flex justify-between pt-2">
                    <span className="font-semibold">Net Distribution Payable</span>
                    <span className="font-bold text-lg text-emerald-600">Rs. {fmt(calcResult.net)}</span>
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground h-full flex flex-col items-center justify-center">
                  <Calculator className="w-8 h-8 opacity-20 mb-2" />
                  <p>Enter unit details and dividend rate to compute distribution breakdown</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mb-4 grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/60 shadow-sm hover:shadow transition-shadow">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Units Held</div>
              <div className="text-xl font-bold font-mono tracking-tight mt-1">{(totals.units ?? 0).toLocaleString()}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{(totals.count ?? 0).toLocaleString()} records · <span className="text-emerald-600 font-medium">{totals.paidCount ?? 0} Paid</span></div>
            </div>
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <Users className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm hover:shadow transition-shadow">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Gross Distribution</div>
              <div className="text-xl font-bold font-mono tracking-tight mt-1">NPR {fmt(totals.gross)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Pre-tax gross pool</div>
            </div>
            <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-600 shrink-0">
              <Coins className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm hover:shadow transition-shadow">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">TDS Tax Withheld</div>
              <div className="text-xl font-bold font-mono tracking-tight mt-1 text-rose-600 dark:text-rose-400">NPR {fmt(totals.tax)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Auto-calculated TDS</div>
            </div>
            <div className="h-10 w-10 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-600 shrink-0">
              <Receipt className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm hover:shadow transition-shadow">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Net Payable</div>
              <div className="text-xl font-bold font-mono tracking-tight mt-1 text-emerald-600 dark:text-emerald-400">NPR {fmt(totals.net)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{totals.pendingCount ?? 0} Pending transfer</div>
            </div>
            <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 shrink-0">
              <Wallet className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Mutual Fund Distribution Summary Card ─────────────────────────── */}
      <Card className="mb-4 border-primary/20 shadow-sm">
        <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center justify-between">
          <div className="space-y-0.5">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Mutual Fund Distribution Summary (CDS Format)
              <Badge variant="outline" className="font-mono text-[11px] ml-1">
                {companyFilter === "all" ? "All Schemes" : companies.find(c => c.id === companyFilter)?.company_code || "Selected"} {fyFilter !== "all" ? `— FY ${fyFilter}` : ""}
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Scheme-wise unitholder category breakdown (Public 5%, Institution 15%, Tax Exempt 0%)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={companyFilter} onValueChange={(v) => { setCompanyFilter(v); setPage(1); }}>
              <SelectTrigger className="h-8 w-44 text-xs bg-background">
                <SelectValue placeholder="Scheme: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Schemes</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.company_code} — {c.company_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={fyFilter} onValueChange={(v) => { setFyFilter(v); setPage(1); }}>
              <SelectTrigger className="h-8 w-28 text-xs bg-background">
                <SelectValue placeholder="All FY" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All FY</SelectItem>
                {fiscalYears.map((fy) => (
                  <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Period Quick Presets */}
            <div className="flex items-center gap-1 bg-background border rounded px-1.5 py-0.5 h-8">
              <span className="text-[11px] text-muted-foreground whitespace-nowrap mr-0.5">Period:</span>
              {(["3M", "6M", "9M", "12M"] as PeriodPreset[]).map((p) => {
                const days = STANDARD_PERIODS[p].days;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setPeriodPreset(p);
                      const end = new Date();
                      const start = new Date();
                      start.setDate(end.getDate() - days);
                      setFromDateFilter(start.toISOString().slice(0, 10));
                      setToDateFilter(end.toISOString().slice(0, 10));
                      setPage(1);
                    }}
                    className={`text-[11px] font-medium px-1.5 py-0.5 rounded transition-colors ${
                      periodPreset === p
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>

            {/* Date Range Search */}
            <div className="flex items-center gap-1 bg-background border rounded px-2 py-0.5 h-8 text-xs">
              <span className="text-[11px] text-muted-foreground">From:</span>
              <input
                type="date"
                value={fromDateFilter}
                onChange={(e) => {
                  setFromDateFilter(e.target.value);
                  setPeriodPreset("CUSTOM");
                  setPage(1);
                }}
                className="bg-transparent text-xs outline-none"
              />
              <span className="text-[11px] text-muted-foreground ml-1">To:</span>
              <input
                type="date"
                value={toDateFilter}
                onChange={(e) => {
                  setToDateFilter(e.target.value);
                  setPeriodPreset("CUSTOM");
                  setPage(1);
                }}
                className="bg-transparent text-xs outline-none"
              />
              {(fromDateFilter || toDateFilter) && (
                <button
                  type="button"
                  onClick={() => {
                    setFromDateFilter("");
                    setToDateFilter("");
                    setPeriodPreset("ALL");
                    setPage(1);
                  }}
                  className="ml-1 text-[11px] text-destructive hover:underline font-medium"
                >
                  Clear
                </button>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => SummaryReportService.exportMutualFundSummaryToExcel(mfSummary.data ?? [], `${companies.find(c => c.id === companyFilter)?.company_code || 'Mutual_Fund'}_Summary`)}
              disabled={!mfSummary.data?.length}
            >
              <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
              Export Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => SummaryReportService.exportMutualFundSummaryToPdf(mfSummary.data ?? [], companies.find(c => c.id === companyFilter)?.company_name || 'Mutual Fund Distribution', `${companies.find(c => c.id === companyFilter)?.company_code || 'All Schemes'} — FY ${fyFilter !== 'all' ? fyFilter : 'All'}`)}
              disabled={!mfSummary.data?.length}
            >
              <FileText className="mr-1.5 h-3.5 w-3.5 text-rose-600" />
              Export PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-muted/80 text-foreground font-semibold border-b border-border divide-x divide-border">
                <th className="py-2.5 px-3 text-center w-12 uppercase text-[11px]">S.N.</th>
                <th className="py-2.5 px-3 uppercase text-[11px]">TYPE / PARTICULAR</th>
                <th className="py-2.5 px-3 text-right uppercase text-[11px]">NO. OF UNITHOLDERS</th>
                <th className="py-2.5 px-3 text-right uppercase text-[11px]">KITTA / UNITS HELD</th>
                <th className="py-2.5 px-3 text-right uppercase text-[11px]">AMOUNT / GROSS</th>
                <th className="py-2.5 px-3 text-right uppercase text-[11px]">TDS TAX</th>
                <th className="py-2.5 px-3 text-right uppercase text-[11px] bg-emerald-100/70 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200">
                  NET DISTRIBUTION
                </th>
                <th className="py-2.5 px-3 text-right uppercase text-[11px]">COMPOSITION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono">
              {mfSummary.isLoading ? (
                <tr><td colSpan={8} className="py-8 text-center text-muted-foreground font-sans text-xs">Loading summary…</td></tr>
              ) : !mfSummary.data || mfSummary.data.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-muted-foreground font-sans text-xs">No mutual fund payables for the selected scheme / fiscal year filter.</td></tr>
              ) : (
                mfSummary.data.map((row) => (
                  <tr key={row.type} className="hover:bg-muted/30 transition-colors divide-x divide-border">
                    <td className="py-2 px-3 text-center text-muted-foreground">{row.sn}</td>
                    <td className="py-2 px-3 font-semibold font-sans">{row.type}</td>
                    <td className="py-2 px-3 text-right">{fmt(row.transaction_count)}</td>
                    <td className="py-2 px-3 text-right font-medium">{fmt(row.kitta)}</td>
                    <td className="py-2 px-3 text-right">{fmt(row.gross)}</td>
                    <td className="py-2 px-3 text-right">{fmt(row.tax)}</td>
                    <td className="py-2 px-3 text-right font-bold bg-emerald-50/70 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200">
                      {fmt(row.net)}
                    </td>
                    <td className="py-2 px-3 text-right font-sans font-medium">{(row.composition ?? 0).toFixed(2)}%</td>
                  </tr>
                ))
              )}
            </tbody>
            {mfSummary.data && mfSummary.data.length > 0 && (
              <tfoot>
                <tr className="bg-muted/90 font-bold border-t-2 border-b-2 border-foreground/30 divide-x divide-border font-mono">
                  <td className="py-2.5 px-3 text-center"></td>
                  <td className="py-2.5 px-3 font-sans uppercase">TOTAL</td>
                  <td className="py-2.5 px-3 text-right">{fmt(mfSummary.data.reduce((a, r) => a + r.transaction_count, 0))}</td>
                  <td className="py-2.5 px-3 text-right">{fmt(mfTotal.kitta)}</td>
                  <td className="py-2.5 px-3 text-right">{fmt(mfTotal.gross)}</td>
                  <td className="py-2.5 px-3 text-right">{fmt(mfTotal.tax)}</td>
                  <td className="py-2.5 px-3 text-right bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-200">
                    {fmt(mfTotal.net)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-sans">100.00%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-4">
          <div className="mb-4 flex flex-col gap-3">
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search scheme, client, BOID, bank…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9 text-xs bg-background"
                />
              </div>

              <Select value={companyFilter} onValueChange={setCompanyFilter}>
                <SelectTrigger className="h-9 text-xs bg-background">
                  <SelectValue placeholder="All schemes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Schemes / Funds</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.company_code} — {c.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={classFilter} onValueChange={setClassFilter}>
                <SelectTrigger className="h-9 text-xs bg-background">
                  <SelectValue placeholder="All Classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Classes / Categories</SelectItem>
                  <SelectItem value="PUBLIC">Public (Natural Person)</SelectItem>
                  <SelectItem value="INSTITUTION">Institution (Legal Person)</SelectItem>
                  <SelectItem value="TAX_EXEMPT">Tax Exempted (Mutual Fund)</SelectItem>
                  <SelectItem value="PROMOTER">Promoter</SelectItem>
                  <SelectItem value="LOCAL">Local</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 text-xs bg-background">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Partial">Partial</SelectItem>
                  <SelectItem value="Paid">Paid</SelectItem>
                </SelectContent>
              </Select>

              <Select value={fyFilter} onValueChange={setFyFilter}>
                <SelectTrigger className="h-9 text-xs bg-background">
                  <SelectValue placeholder="All fiscal years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All fiscal years</SelectItem>
                  {fiscalYears.map((fy) => (
                    <SelectItem key={fy} value={fy}>
                      {fy}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date Filters & Quick Reset */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/40">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 bg-muted/40 border rounded-md px-2.5 h-8 text-xs">
                  <span className="text-[11px] text-muted-foreground font-medium">From:</span>
                  <input
                    type="date"
                    value={fromDateFilter}
                    onChange={(e) => { setFromDateFilter(e.target.value); setPage(1); }}
                    className="bg-transparent text-xs outline-none"
                  />
                  <span className="text-[11px] text-muted-foreground font-medium ml-1">To:</span>
                  <input
                    type="date"
                    value={toDateFilter}
                    onChange={(e) => { setToDateFilter(e.target.value); setPage(1); }}
                    className="bg-transparent text-xs outline-none"
                  />
                </div>
                {(fromDateFilter || toDateFilter || search || statusFilter !== "all" || companyFilter !== "all" || fyFilter !== "all" || classFilter !== "all") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("all");
                      setCompanyFilter("all");
                      setFyFilter("all");
                      setClassFilter("all");
                      setFromDateFilter("");
                      setToDateFilter("");
                      setPage(1);
                    }}
                    className="h-8 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5 mr-1" /> Reset Filters
                  </Button>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{pageItems.length}</span> of <span className="font-semibold text-foreground">{pageResult.count.toLocaleString()}</span> payables
              </div>
            </div>
          </div>

          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-semibold">Company / Scheme</TableHead>
                  <TableHead className="font-semibold">Client</TableHead>
                  <TableHead className="font-semibold">BOID</TableHead>
                  <TableHead className="text-right font-semibold">Holding (Units / Kitta)</TableHead>
                  <TableHead className="text-right font-semibold">Rate %</TableHead>
                  <TableHead className="text-right font-semibold">Gross</TableHead>
                  <TableHead className="text-right font-semibold">Tax</TableHead>
                  <TableHead className="text-right font-semibold">Net</TableHead>
                  <TableHead className="font-semibold">Bank Details</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold">Fiscal Year</TableHead>
                  <TableHead className="text-right font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="py-12 text-center text-muted-foreground">
                      No mutual fund payables.
                    </TableCell>
                  </TableRow>
                ) : (
                  pageItems.map((payable) => (
                    <TableRow key={payable.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell>
                        <span className="font-mono text-xs font-semibold text-muted-foreground mr-1">{payable.company?.company_code ?? "—"}</span>
                        <span className="text-xs">{payable.company?.company_name}</span>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-xs text-foreground">{payable.client?.full_name ?? "—"}</div>
                        {payable.client?.father_name && <div className="text-[10px] text-muted-foreground">s/o {payable.client.father_name}</div>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {payable.client?.boid ? (
                          <button
                            type="button"
                            className="font-semibold text-primary hover:underline cursor-pointer"
                            onClick={() => setSelectedStatementBoid(payable.client!.boid)}
                            title="Click to view full statement"
                          >
                            {payable.client.boid}
                          </button>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold text-primary">
                        {payable.shares_held || payable.after_bonus_kitta || payable.client?.kitta
                          ? (payable.shares_held || payable.after_bonus_kitta || payable.client?.kitta)?.toLocaleString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {payable.dividend_rate ? `${payable.dividend_rate}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">{fmt(payable.gross_dividend)}</TableCell>
                      <TableCell className="text-right font-mono text-amber-600">{fmt(payable.tax_amount)}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-foreground">{fmt(payable.net_payable)}</TableCell>
                      <TableCell>
                        <div className="text-[11px] font-medium max-w-[140px] truncate">{payable.bank_name || payable.client?.bank_name || "—"}</div>
                        {(payable.bank_account_no || payable.client?.bank_account_no) && (
                          <div className="font-mono text-[10px] text-muted-foreground">{payable.bank_account_no || payable.client?.bank_account_no}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={payable.payment_status === "Paid" ? "default" : payable.payment_status === "Partial" ? "secondary" : (payable as any).remarks?.includes("Rejected") ? "destructive" : "outline"}>
                          {payable.payment_status}
                        </Badge>
                        {(payable as any).remarks && (
                          <span
                            className={`block text-[10px] max-w-[140px] truncate mt-0.5 ${(payable as any).remarks.includes("Rejected") ? "text-destructive font-medium" : "text-muted-foreground"}`}
                            title={(payable as any).remarks}
                          >
                            {(payable as any).remarks}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{payable.fiscal_year ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {canWrite && (
                          <div className="flex justify-end gap-1">
                            {payable.payment_status !== "Paid" && (
                              <Button size="icon" variant="ghost" onClick={() => setPayOpen(payable)} title="Mark paid" className="hover:bg-emerald-50">
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" onClick={() => startEdit(payable)} className="hover:bg-blue-50">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {canDelete && (
                              <Button size="icon" variant="ghost" onClick={() => del.mutate(payable.id)} className="hover:bg-red-50" title="Delete Payable (Admin Only)">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {pageResult.count > 0 && (
              <div className="flex items-center justify-between border-t px-4 py-3">
                <div className="text-sm text-muted-foreground">
                  Showing {(safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, pageResult.count)} of {pageResult.count} records
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

      <Dialog open={Boolean(payOpen)} onOpenChange={(open) => !open && setPayOpen(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Mark as paid</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>Payment Date</Label>
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Payment Reference</Label>
              <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(null)}>
              Cancel
            </Button>
            <Button disabled={markPaid.isPending} onClick={() => markPaid.mutate()}>
              Mark Paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ShareholderStatementDialog
        boid={selectedStatementBoid}
        open={Boolean(selectedStatementBoid)}
        onOpenChange={(openState) => {
          if (!openState) setSelectedStatementBoid(null);
        }}
      />
    </div>
  );
}
