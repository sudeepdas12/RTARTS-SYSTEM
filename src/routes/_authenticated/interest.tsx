import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase, fetchAllRows } from "@/lib/services/database";
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
import { Pencil, Plus, Trash2, Download, Upload, CheckCircle2, Calculator, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileSpreadsheet, FileText, BarChart3, Search, Users, Coins, Receipt, Wallet, Building2, Filter, X } from "lucide-react";
import { toast } from "sonner";
import { SettingsService } from "@/lib/services/settings.service";
import { exportToExcel, importFromExcel } from "@/lib/xlsx-utils";
import { InterestCalculator, type InterestResult } from "@/lib/interest-calculator";
import { DebentureSummaryReportService } from "@/lib/services/debenture-summary-report.service";
import { STANDARD_PERIODS, type PeriodPreset, calculateDaysBetween } from "@/lib/services/period-calculator";
import { ShareholderStatementDialog } from "@/components/shareholder-statement-dialog";

export const Route = createFileRoute("/_authenticated/interest")({
  component: InterestPage,
});

type PaymentStatus = "Pending" | "Paid" | "Partial";

interface Payable {
  id: string;
  company_id: string | null;
  client_id: string | null;
  instrument_ref: string | null;
  shares_held?: number | null;
  kitta?: number | null;
  gross_interest: number | null;
  tax_amount: number | null;
  net_payable: number | null;
  due_date: string | null;
  payment_status: PaymentStatus;
  payment_date: string | null;
  payment_reference: string | null;
  fiscal_year: string | null;
  tds_rate?: number | null;
  payee_classification?: string | null;
  upload_id?: string | null;
  created_at: string;
  client?: { id: string; client_code: string; full_name: string; boid: string | null; kitta?: number | null; holder_type?: string | null; payee_classification?: string | null; father_name: string | null; grandfather_name: string | null; pan_no?: string | null; citizenship_no?: string | null; pan_or_citizenship: string | null; nid_number?: string | null; address: string | null; district: string | null; phone: string | null; bank_name: string | null; bank_account_no: string | null } | null;
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
  client_citizenship: "",
  client_nid: "",
  client_address: "",
  client_district: "",
  client_phone: "",
  client_bank_name: "",
  client_bank_account_no: "",
  // Payable fields
  kitta: "",
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
  const { hasAny, isAdmin } = useAuth();
  const canWrite = hasAny(["admin", "finance_operator"]);
  const canDelete = isAdmin;
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [fyFilter, setFyFilter] = useState<string>("all");
  const [classFilter, setClassFilter] = useState<string>("all");
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
    if (!rate || rate <= 0) { toast.error('Enter a valid coupon rate (%)'); return; }
    if (calcDays <= 0) { toast.error('Check Date From and Date To range'); return; }

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
    queryKey: ["companies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id, company_code, company_name").order("company_name");
      if (error) throw error;
      return data;
    },
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients_selector"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, client_code, full_name, boid, father_name, grandfather_name, pan_or_citizenship, address, district, phone, bank_name, bank_account_no")
        .order("full_name")
        .limit(2000);
      if (error) throw error;
      return data as {
        id: string;
        client_code: string;
        full_name: string;
        boid: string | null;
        father_name: string | null;
        grandfather_name: string | null;
        pan_or_citizenship: string | null;
        address: string | null;
        district: string | null;
        phone: string | null;
        bank_name: string | null;
        bank_account_no: string | null;
      }[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const companyMap = useMemo(() => Object.fromEntries(companies.map((c) => [c.id, c])), [companies]);
  const clientMap = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);
  const companyByCode = useMemo(() => Object.fromEntries(companies.map((c) => [c.company_code.toLowerCase(), c.id])), [companies]);
  const clientByCode = useMemo(() => Object.fromEntries(clients.map((c) => [c.client_code.toLowerCase(), c.id])), [clients]);
  const clientByBoid = useMemo(() => Object.fromEntries(clients.filter(c => c.boid).map((c) => [c.boid!.toLowerCase(), c.id])), [clients]);

  // Date range filters
  const [fromDateFilter, setFromDateFilter] = useState<string>("");
  const [toDateFilter, setToDateFilter] = useState<string>("");
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset | "ALL">("ALL");

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
    queryKey: ["interest_fiscal_years"],
    queryFn: async () => {
      const { data } = await supabase.from("interest_payables").select("fiscal_year").order("fiscal_year", { ascending: false });
      return Array.from(new Set((data || []).map(r => r.fiscal_year).filter(Boolean))) as string[];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Server-side totals for KPI cards
  const { data: totals = { count: 0, paidCount: 0, pendingCount: 0, gross: 0, tax: 0, net: 0 } } = useQuery({
    queryKey: ["interest_payables_totals", statusFilter, companyFilter, fyFilter, classFilter, fromDateFilter, toDateFilter],
    queryFn: async () => {
      const data = await fetchAllRows<any>((from, to) => {
        let q = (supabase as any)
          .from("interest_payables")
          .select("payment_status, gross_interest, tax_amount, net_payable, payee_classification, payee_segment, instrument_ref, due_date")
          .range(from, to);
        if (statusFilter !== "all") q = q.eq("payment_status", statusFilter);
        if (companyFilter !== "all") q = q.eq("company_id", companyFilter);
        if (fyFilter !== "all") q = q.eq("fiscal_year", fyFilter);
        if (fromDateFilter) q = q.gte("due_date", fromDateFilter);
        if (toDateFilter) q = q.lte("due_date", toDateFilter);
        if (classFilter !== "all") {
          if (classFilter === "PROMOTER") {
            q = q.or("payee_segment.eq.PROMOTER,instrument_ref.ilike.%PROMOT%");
          } else if (classFilter === "LOCAL") {
            q = q.or("payee_segment.eq.LOCAL,instrument_ref.ilike.%LOCAL%");
          } else if (classFilter === "TAX_EXEMPT") {
            q = q.or("payee_classification.eq.TAX_EXEMPT,instrument_ref.ilike.%MUTUAL%,instrument_ref.ilike.%EXEMPT%");
          } else if (classFilter === "INSTITUTION") {
            q = q.or("payee_classification.eq.COMPANY_INSTITUTION,instrument_ref.ilike.%INSTITUT%,instrument_ref.ilike.%COMPANY%");
          } else if (classFilter === "PUBLIC") {
            q = q.or("payee_classification.eq.NATURAL_PERSON,payee_classification.eq.PUBLIC_LEGAL_PERSON,instrument_ref.ilike.%PUBLIC%");
          }
        }
        return q;
      });

      return (data || []).reduce(
        (a, p) => ({
          count: a.count + 1,
          paidCount: a.paidCount + (p.payment_status === "Paid" ? 1 : 0),
          pendingCount: a.pendingCount + (p.payment_status === "Pending" ? 1 : 0),
          gross: a.gross + Number(p.gross_interest ?? 0),
          tax: a.tax + Number(p.tax_amount ?? 0),
          net: a.net + Number(p.net_payable ?? 0),
        }),
        { count: 0, paidCount: 0, pendingCount: 0, gross: 0, tax: 0, net: 0 }
      );
    },
    staleTime: 60_000,
  });

  // Main server-side paginated query
  const { data: pageResult = { rows: [], count: 0 }, isLoading } = useQuery({
    queryKey: ["interest_payables", page, pageSize, debouncedSearch, statusFilter, companyFilter, fyFilter, classFilter, fromDateFilter, toDateFilter],
    queryFn: async () => {
      let q = (supabase as any)
        .from("interest_payables")
        .select("*, client:clients(id, client_code, full_name, boid, father_name, grandfather_name, pan_or_citizenship, address, district, phone, bank_name, bank_account_no), company:companies(id, company_code, company_name)", { count: "exact" })
        .order("due_date", { ascending: false, nullsFirst: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (statusFilter !== "all") q = q.eq("payment_status", statusFilter);
      if (companyFilter !== "all") q = q.eq("company_id", companyFilter);
      if (fyFilter !== "all") q = q.eq("fiscal_year", fyFilter);
      if (fromDateFilter) q = q.gte("due_date", fromDateFilter);
      if (toDateFilter) q = q.lte("due_date", toDateFilter);
      if (classFilter !== "all") {
        if (classFilter === "PROMOTER") {
          q = q.or("payee_segment.eq.PROMOTER,instrument_ref.ilike.%PROMOT%");
        } else if (classFilter === "LOCAL") {
          q = q.or("payee_segment.eq.LOCAL,instrument_ref.ilike.%LOCAL%");
        } else if (classFilter === "TAX_EXEMPT") {
          q = q.or("payee_classification.eq.TAX_EXEMPT,instrument_ref.ilike.%MUTUAL%,instrument_ref.ilike.%EXEMPT%");
        } else if (classFilter === "INSTITUTION") {
          q = q.or("payee_classification.eq.COMPANY_INSTITUTION,instrument_ref.ilike.%INSTITUT%,instrument_ref.ilike.%COMPANY%");
        } else if (classFilter === "PUBLIC") {
          q = q.or("payee_classification.eq.NATURAL_PERSON,payee_classification.eq.PUBLIC_LEGAL_PERSON,instrument_ref.ilike.%PUBLIC%");
        }
      }

      if (debouncedSearch) {
        const clean = debouncedSearch.trim();
        const { data: matchedClients } = await (supabase as any)
          .from("clients")
          .select("id")
          .or(`full_name.ilike.%${clean}%,boid.ilike.%${clean}%,pan_or_citizenship.ilike.%${clean}%,bank_account_no.ilike.%${clean}%`)
          .limit(80);

        const clientIds = (matchedClients || []).map((c: any) => c.id);
        if (clientIds.length > 0) {
          q = q.or(`client_id.in.(${clientIds.join(",")}),instrument_ref.ilike.%${clean}%,payment_reference.ilike.%${clean}%,fiscal_year.ilike.%${clean}%`);
        } else {
          q = q.or(`instrument_ref.ilike.%${clean}%,payment_reference.ilike.%${clean}%,fiscal_year.ilike.%${clean}%`);
        }
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

  // Helper to fetch all filtered rows for export/summary
  const fetchAllFiltered = useCallback(async (): Promise<Payable[]> => {
    return fetchAllRows<Payable>((from, to) => {
      let q = (supabase as any)
        .from("interest_payables")
        .select("*, client:clients(id, client_code, full_name, boid, father_name, grandfather_name, pan_or_citizenship, address, district, phone, bank_name, bank_account_no, holder_type, payee_classification), company:companies(id, company_code, company_name)")
        .order("due_date", { ascending: false, nullsFirst: false })
        .range(from, to);
      if (statusFilter !== "all") q = q.eq("payment_status", statusFilter);
      if (companyFilter !== "all") q = q.eq("company_id", companyFilter);
      if (fyFilter !== "all") q = q.eq("fiscal_year", fyFilter);
      if (fromDateFilter) q = q.gte("due_date", fromDateFilter);
      if (toDateFilter) q = q.lte("due_date", toDateFilter);
      if (classFilter !== "all") {
        if (classFilter === "PROMOTER") {
          q = q.or("payee_segment.eq.PROMOTER,instrument_ref.ilike.%PROMOT%");
        } else if (classFilter === "LOCAL") {
          q = q.or("payee_segment.eq.LOCAL,instrument_ref.ilike.%LOCAL%");
        } else if (classFilter === "TAX_EXEMPT") {
          q = q.or("payee_classification.eq.TAX_EXEMPT,instrument_ref.ilike.%MUTUAL%,instrument_ref.ilike.%EXEMPT%");
        } else if (classFilter === "INSTITUTION") {
          q = q.or("payee_classification.eq.COMPANY_INSTITUTION,instrument_ref.ilike.%INSTITUT%,instrument_ref.ilike.%COMPANY%");
        } else if (classFilter === "PUBLIC") {
          q = q.or("payee_classification.eq.NATURAL_PERSON,payee_classification.eq.PUBLIC_LEGAL_PERSON,instrument_ref.ilike.%PUBLIC%");
        }
      }
      if (debouncedSearch) {
        q = q.or(
          `instrument_ref.ilike.%${debouncedSearch}%,payment_reference.ilike.%${debouncedSearch}%,fiscal_year.ilike.%${debouncedSearch}%`
        );
      }
      return q;
    });
  }, [statusFilter, companyFilter, fyFilter, classFilter, fromDateFilter, toDateFilter, debouncedSearch]);

  const [summaryReportOpen, setSummaryReportOpen] = useState(true);
  const [summaryCouponRate, setSummaryCouponRate] = useState<string>("");
  const [summaryFaceValue, setSummaryFaceValue] = useState<string>("1000");
  const [summaryDays, setSummaryDays] = useState<string>("");

  const selectedCompany = useMemo(() => companies.find((c) => c.id === companyFilter), [companies, companyFilter]);

  // Automatically fetch summary data with React Query
  const { data: summaryAllRows = [], isLoading: summaryLoading, refetch: loadSummary } = useQuery({
    queryKey: ["interest_summary_rows", companyFilter, fyFilter],
    queryFn: async () => {
      return fetchAllRows<Payable>((from, to) => {
        let q = (supabase as any)
          .from("interest_payables")
          .select("id, client_id, company_id, instrument_ref, gross_interest, tax_amount, net_payable, due_date, payment_status, fiscal_year, payee_classification, payee_segment, client:clients(id, full_name, holder_type, payee_classification, payee_segment)")
          .range(from, to);
        if (companyFilter !== "all") q = q.eq("company_id", companyFilter);
        if (fyFilter !== "all") q = q.eq("fiscal_year", fyFilter);
        return q;
      });
    },
    staleTime: 60_000,
  });

  const debentureSummaryReport = useMemo(
    () =>
      DebentureSummaryReportService.generateReportFromPayables(
        summaryAllRows,
        selectedCompany?.company_name || (companyFilter === "all" ? "All Debentures" : "Selected Company"),
        selectedCompany?.company_code || "",
        fyFilter !== "all" ? fyFilter : "",
        summaryCouponRate ? Number(summaryCouponRate) : undefined,
        summaryFaceValue ? Number(summaryFaceValue) : 1000,
        summaryDays ? Number(summaryDays) : undefined,
      ),
    [summaryAllRows, selectedCompany, companyFilter, fyFilter, summaryCouponRate, summaryFaceValue, summaryDays],
  );

  const upsert = useMutation({
    mutationFn: async () => {
      const kittaVal = form.kitta ? Number(form.kitta) : null;
      const gross = form.gross_interest ? Number(form.gross_interest) : null;
      const tax = form.tax_amount ? Number(form.tax_amount) : null;
      const net = form.net_payable ? Number(form.net_payable) : (gross != null && tax != null ? gross - tax : (gross ?? null));
      const payload = {
        company_id: form.company_id || null,
        client_id: form.client_id || null,
        instrument_ref: form.instrument_ref || null,
        shares_held: kittaVal,
        kitta: kittaVal,
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
        if (form.kitta !== undefined && kittaVal != null) clientPayload.kitta = kittaVal;
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
        const { error } = await supabase.from("interest_payables").update(payload as never).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("interest_payables").insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["interest_payables"] });
      qc.invalidateQueries({ queryKey: ["interest_payables_totals"] });
      qc.invalidateQueries({ queryKey: ["interest_summary_rows"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      toast.success(editing ? "Payable & client updated" : "Payable created");
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
      qc.invalidateQueries({ queryKey: ["interest_payables_totals"] });
      qc.invalidateQueries({ queryKey: ["interest_summary_rows"] });
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

  const startNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (p: Payable) => {
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
      client_pan: cl?.pan_no ?? (cl?.pan_or_citizenship && String(cl.pan_or_citizenship).length === 9 ? cl.pan_or_citizenship : ""),
      client_citizenship: cl?.citizenship_no ?? (cl?.pan_or_citizenship && String(cl.pan_or_citizenship).length !== 9 ? cl.pan_or_citizenship : ""),
      client_nid: cl?.nid_number ?? "",
      client_address: cl?.address ?? "",
      client_district: cl?.district ?? "",
      client_phone: cl?.phone ?? "",
      client_bank_name: cl?.bank_name ?? "",
      client_bank_account_no: cl?.bank_account_no ?? "",
      // Payable fields
      kitta: p.kitta != null ? String(p.kitta) : (p.shares_held != null ? String(p.shares_held) : (cl?.kitta != null ? String(cl.kitta) : "")),
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
          holding_kitta: p.kitta || p.shares_held || cl?.kitta || 0,
          holder_type: cl?.holder_type ?? "",
          classification: p.payee_classification || cl?.payee_classification || "",
          pan_or_citizenship: cl?.pan_or_citizenship ?? "",
          bank_name: cl?.bank_name ?? "",
          bank_account_no: cl?.bank_account_no ?? "",
          instrument_ref: p.instrument_ref,
          gross_interest: p.gross_interest,
          tax_amount: p.tax_amount,
          net_payable: p.net_payable,
          tds_rate: p.tds_rate ? (Number(p.tds_rate) * 100).toFixed(0) + "%" : "",
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
                              <SelectItem key={c.id} value={c.id}>{c.full_name} {c.boid ? `(${c.boid})` : ""}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Holding (Kitta / Units)</Label>
                        <Input
                          type="number"
                          placeholder="e.g. 50"
                          value={form.kitta}
                          onChange={(e) => {
                            const k = e.target.value;
                            const comp = companies.find(c => c.id === form.company_id);
                            const rate = comp ? (Number(comp.company_name?.match(/(\d+(?:\.\d+)?)\s*%/)?.[1]) || 8.5) : 8.5;
                            const kNum = Number(k) || 0;
                            const calculatedGross = kNum > 0 ? (kNum * 1000 * (rate / 100) * (183 / 365)) : null;
                            setForm(f => ({
                              ...f,
                              kitta: k,
                              gross_interest: calculatedGross ? calculatedGross.toFixed(2) : f.gross_interest,
                            }));
                          }}
                          className="font-mono"
                        />
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
              <div className="sm:col-span-3 flex flex-wrap items-center gap-1.5 pb-2 border-b">
                <span className="text-xs font-semibold text-muted-foreground mr-1">Period Presets:</span>
                {(["3M", "6M", "9M", "12M"] as PeriodPreset[]).map((p) => {
                  const days = STANDARD_PERIODS[p].days;
                  return (
                    <Button
                      key={p}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs px-2.5 bg-background"
                      onClick={() => {
                        const end = new Date();
                        const start = new Date();
                        start.setDate(end.getDate() - days);
                        setCalcFromDate(start.toISOString().slice(0, 10));
                        setCalcToDate(end.toISOString().slice(0, 10));
                      }}
                    >
                      {STANDARD_PERIODS[p].label}
                    </Button>
                  );
                })}
              </div>
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
                <Input readOnly value={calcDays || ''} placeholder="0" className="bg-muted font-mono" />
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
        <Card className="border-border/60 shadow-sm hover:shadow transition-shadow">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Debenture Records</div>
              <div className="text-xl font-bold font-mono tracking-tight mt-1">{(totals.count ?? 0).toLocaleString()}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5"><span className="text-emerald-600 font-medium">{totals.paidCount ?? 0} Paid</span> · {totals.pendingCount ?? 0} Pending</div>
            </div>
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <Users className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm hover:shadow transition-shadow">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Gross Interest</div>
              <div className="text-xl font-bold font-mono tracking-tight mt-1">NPR {fmt(totals.gross)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Pre-tax interest pool</div>
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
              <div className="text-[11px] text-muted-foreground mt-0.5">6% / 15% TDS rate</div>
            </div>
            <div className="h-10 w-10 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-600 shrink-0">
              <Receipt className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm hover:shadow transition-shadow">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Net Interest Payable</div>
              <div className="text-xl font-bold font-mono tracking-tight mt-1 text-emerald-600 dark:text-emerald-400">NPR {fmt(totals.net)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{totals.pendingCount ?? 0} Pending transfer</div>
            </div>
            <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 shrink-0">
              <Wallet className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Debenture Interest Distribution Summary Card (Pumori / CDS Format) ─── */}
      <Card className="mb-4 border-primary/20 shadow-sm">
        <CardHeader className="py-3 px-4 bg-muted/40 border-b flex flex-row items-center justify-between">
          <div className="space-y-0.5">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Debenture Interest Distribution Summary (Pumori / CDS Format)
              <Badge variant="outline" className="font-mono text-[11px] ml-1">
                {debentureSummaryReport?.companyCode || "All"} {debentureSummaryReport?.fiscalYear ? `— FY ${debentureSummaryReport.fiscalYear}` : ""}
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Holder-wise debenture capital & coupon breakdown (Public 6% TDS, Institution 15% TDS, Tax Exempted 0% TDS)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={companyFilter} onValueChange={(v) => { setCompanyFilter(v); setPage(1); }}>
              <SelectTrigger className="h-8 w-44 text-xs bg-background">
                <SelectValue placeholder="Company: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Debentures</SelectItem>
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
              onClick={() => setSummaryReportOpen((v) => !v)}
            >
              {summaryReportOpen ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
              {summaryReportOpen ? "Hide Breakdown" : "View Breakdown"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => debentureSummaryReport && DebentureSummaryReportService.exportToExcel(debentureSummaryReport)}
              disabled={debentureSummaryReport.rows.length === 0}
            >
              <FileSpreadsheet className="h-3.5 w-3.5 mr-1 text-emerald-600" />
              Summary Excel
            </Button>
          </div>
        </CardHeader>
        {summaryReportOpen && (
          <CardContent className="p-0 overflow-x-auto">
            {summaryLoading ? (
              <div className="py-12 text-center text-muted-foreground text-sm flex flex-col items-center justify-center gap-2">
                <BarChart3 className="h-8 w-8 animate-pulse text-primary opacity-60" />
                <p className="font-medium">Calculating Debenture Interest Distribution Summary…</p>
                <p className="text-xs text-muted-foreground">Aggregating coupon rates, days, and tax categories</p>
              </div>
            ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-muted/80 text-foreground font-semibold border-b border-border divide-x border-border">
                  <th className="py-2.5 px-3 uppercase text-[11px]">CATEGORY</th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px]">KITTA</th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px]">AMOUNT</th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px]">
                    {debentureSummaryReport.couponRate > 0
                      ? `INT. @ ${debentureSummaryReport.couponRate}%`
                      : "ANNUAL INT."}
                  </th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px]">INT. PER DAY</th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px]">INTEREST PUMORI</th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px]">TAX</th>
                  <th className="py-2.5 px-3 text-right uppercase text-[11px] bg-emerald-100/70 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200">
                    NET INTEREST PAYABLE
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {debentureSummaryReport.rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground font-sans text-xs">
                      No debenture interest payables found for the selected filter.
                    </td>
                  </tr>
                ) : (
                  debentureSummaryReport.rows.map((row) => (
                    <tr key={row.name} className="hover:bg-muted/30 transition-colors divide-x divide-border">
                      <td className="py-2 px-3 font-semibold font-sans">{row.name}</td>
                      <td className="py-2 px-3 text-right">{fmt(row.kitta)}</td>
                      <td className="py-2 px-3 text-right">{fmt(row.principalAmount)}</td>
                      <td className="py-2 px-3 text-right">{fmt(row.annualInterest)}</td>
                      <td className="py-2 px-3 text-right">{fmt(row.interestPerDay)}</td>
                      <td className="py-2 px-3 text-right font-medium">{fmt(row.grossInterest)}</td>
                      <td className="py-2 px-3 text-right">
                        {row.taxAmount > 0 ? (
                          <span>{fmt(row.taxAmount)} <span className="text-[10px] text-muted-foreground font-sans">({row.taxRatePercent}%)</span></span>
                        ) : (
                          <span className="text-muted-foreground font-sans">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-bold bg-emerald-50/70 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200">
                        {fmt(row.netInterestPayable)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {debentureSummaryReport.rows.length > 0 && (
                <tfoot>
                  <tr className="bg-muted/90 font-bold border-t-2 border-b-2 border-foreground/30 divide-x divide-border font-mono">
                    <td className="py-2.5 px-3 font-sans uppercase">TOTAL</td>
                    <td className="py-2.5 px-3 text-right">{fmt(debentureSummaryReport.total.kitta)}</td>
                    <td className="py-2.5 px-3 text-right">{fmt(debentureSummaryReport.total.principalAmount)}</td>
                    <td className="py-2.5 px-3 text-right">{fmt(debentureSummaryReport.total.annualInterest)}</td>
                    <td className="py-2.5 px-3 text-right">{fmt(debentureSummaryReport.total.interestPerDay)}</td>
                    <td className="py-2.5 px-3 text-right">{fmt(debentureSummaryReport.total.grossInterest)}</td>
                    <td className="py-2.5 px-3 text-right">{fmt(debentureSummaryReport.total.taxAmount)}</td>
                    <td className="py-2.5 px-3 text-right bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-200">
                      {fmt(debentureSummaryReport.total.netInterestPayable)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
            )}
          </CardContent>
        )}
      </Card>

      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-4">
          <div className="mb-4 flex flex-col gap-3">
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search shareholder, BOID, account, ref…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="pl-9 h-9 text-xs bg-background"
                />
              </div>

              <Select value={companyFilter} onValueChange={(v) => { setCompanyFilter(v); setPage(1); }}>
                <SelectTrigger className="h-9 text-xs bg-background">
                  <SelectValue placeholder="All Debentures" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Debentures</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.company_code} — {c.company_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={classFilter} onValueChange={(v) => { setClassFilter(v); setPage(1); }}>
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

              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
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

              <Select value={fyFilter} onValueChange={(v) => { setFyFilter(v); setPage(1); }}>
                <SelectTrigger className="h-9 text-xs bg-background">
                  <SelectValue placeholder="All Fiscal Years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Fiscal Years</SelectItem>
                  {fiscalYears.map((fy) => (
                    <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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

                {(search || statusFilter !== "all" || companyFilter !== "all" || fyFilter !== "all" || classFilter !== "all" || fromDateFilter || toDateFilter) && (
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
                  <TableHead className="font-semibold">Company</TableHead>
                  <TableHead className="font-semibold">Client</TableHead>
                  <TableHead className="font-semibold">BOID</TableHead>
                  <TableHead className="text-right font-semibold">Holding (Kitta)</TableHead>
                  <TableHead className="font-semibold">Instrument</TableHead>
                  <TableHead className="text-right font-semibold">Gross</TableHead>
                  <TableHead className="text-right font-semibold">Tax</TableHead>
                  <TableHead className="text-right font-semibold">Net</TableHead>
                  <TableHead className="font-semibold">Bank Details</TableHead>
                  <TableHead className="font-semibold">Due</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold">FY</TableHead>
                  <TableHead className="text-right font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={13} className="py-12 text-center text-muted-foreground">Loading…</TableCell></TableRow>
                ) : pageItems.length === 0 ? (
                  <TableRow><TableCell colSpan={13} className="py-12 text-center text-muted-foreground">No payables.</TableCell></TableRow>
                ) : pageItems.map((p) => {
                  const c = p.company ?? null;
                  const cl = p.client ?? null;
                  return (
                    <TableRow key={p.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell>{c ? <span><span className="font-mono text-xs text-muted-foreground">{c.company_code}</span> {c.company_name}</span> : "—"}</TableCell>
                      <TableCell>
                        <div className="font-medium text-xs text-foreground">{cl?.full_name ?? "—"}</div>
                        {cl?.father_name && <div className="text-[10px] text-muted-foreground">s/o {cl.father_name}</div>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {cl?.boid ? (
                          <button
                            type="button"
                            className="font-semibold text-primary hover:underline cursor-pointer"
                            onClick={() => setSelectedStatementBoid(cl.boid)}
                            title="Click to view full statement"
                          >
                            {cl.boid}
                          </button>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold text-primary">
                        {p.kitta || p.shares_held || cl?.kitta ? (p.kitta || p.shares_held || cl?.kitta)?.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{p.instrument_ref ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(p.gross_interest)}</TableCell>
                      <TableCell className="text-right font-mono text-amber-600">{fmt(p.tax_amount)}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-foreground">{fmt(p.net_payable)}</TableCell>
                      <TableCell>
                        <div className="text-[11px] font-medium max-w-[140px] truncate">{(p as any).bank_name || cl?.bank_name || "—"}</div>
                        {((p as any).bank_account_no || cl?.bank_account_no) && (
                          <div className="font-mono text-[10px] text-muted-foreground">{(p as any).bank_account_no || cl?.bank_account_no}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{p.due_date ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={p.payment_status === "Paid" ? "default" : p.payment_status === "Partial" ? "secondary" : (p as any).remarks?.includes("Rejected") ? "destructive" : "outline"}>
                          {p.payment_status}
                        </Badge>
                        {(p as any).remarks && (
                          <span
                            className={`block text-[10px] max-w-[160px] truncate mt-0.5 ${(p as any).remarks.includes("Rejected") ? "text-destructive font-medium" : "text-muted-foreground"}`}
                            title={(p as any).remarks}
                          >
                            {(p as any).remarks}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{p.fiscal_year ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {canWrite && (
                          <div className="flex justify-end gap-1">
                            {p.payment_status !== "Paid" && (
                              <Button size="icon" variant="ghost" onClick={() => { setPayOpen(p); setPayRef(p.payment_reference ?? ""); }} title="Mark paid" className="hover:bg-emerald-50">
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" onClick={() => openEdit(p)} className="hover:bg-blue-50"><Pencil className="h-4 w-4" /></Button>
                            {canDelete && (
                              <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete this payable?")) del.mutate(p.id); }} className="hover:bg-red-50" title="Delete Payable (Admin Only)">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
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