import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase, fetchAllRows } from "@/lib/services/database";
import { useAuth } from "@/hooks/use-auth";
import { useDebounce } from "@/hooks/use-debounce";
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
import {
  Pencil,
  Plus,
  Trash2,
  Download,
  Upload,
  CheckCircle2,
  Calculator,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileSpreadsheet,
  FileText,
  BarChart3,
  Search,
  Users,
  Coins,
  Receipt,
  Wallet,
  Building2,
  Filter,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { SettingsService } from "@/lib/services/settings.service";
import { exportToExcel, importFromExcel } from "@/lib/xlsx-utils";
import { InterestCalculator, type InterestResult } from "@/lib/interest-calculator";
import { DebentureSummaryReportService } from "@/lib/services/debenture-summary-report.service";
import {
  STANDARD_PERIODS,
  type PeriodPreset,
  calculateDaysBetween,
} from "@/lib/services/period-calculator";
import { ShareholderStatementDialog } from "@/components/shareholder-statement-dialog";
import { loadTaxRules, getDebentureDisplayRates } from "@/lib/services/tax-rules.service";
import { normalizeBoid } from "@/lib/validation-engine";
import { fmtNpr } from "@/lib/nepal-currency";
import { DualDate } from "@/components/dual-date";
import { validateNepaliBankAccount } from "@/lib/nepal-banks";

export const Route = createFileRoute("/_authenticated/interest")({
  component: InterestPage,
});

type PaymentStatus = "Pending" | "Paid" | "Partial";

interface Payable {
  id: string;
  company_id: string | null;
  client_id: string | null;
  instrument_ref: string | null;
  lot_name?: string | null;
  shares_held?: number | null;
  kitta?: number | null;
  gross_interest: number | null;
  tax_amount: number | null;
  net_payable: number | null;
  due_date: string | null;
  payment_status: PaymentStatus;
  payment_date: string | null;
  payment_reference: string | null;
  paid_amount?: number | null;
  remaining_amount?: number | null;
  fiscal_year: string | null;
  tds_rate?: number | null;
  payee_classification?: string | null;
  bank_name?: string | null;
  bank_account_no?: string | null;
  bank_branch?: string | null;
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
  lot_name: "",
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
  const { data: settings } = useQuery({
    queryKey: ["system-settings"],
    queryFn: () => SettingsService.getSettings(),
  });
  const { data: activeFyData } = useQuery({
    queryKey: ["active_fiscal_year"],
    queryFn: async () => {
      const { data } = await supabase
        .from("fiscal_years")
        .select("fiscal_year")
        .eq("is_active", true)
        .maybeSingle();
      return data?.fiscal_year ?? "";
    },
  });

  const { data: taxRules } = useQuery({
    queryKey: ["tax-rules"],
    queryFn: () => loadTaxRules(),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  const debentureDisplayRates = useMemo(() => getDebentureDisplayRates(taxRules), [taxRules]);

  // ─── Interest Calculator state ───────────────────────────────────────────────
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcKitta, setCalcKitta] = useState("");
  const [calcFaceValue, setCalcFaceValue] = useState("1000");
  const [calcRate, setCalcRate] = useState("");
  const [calcFromDate, setCalcFromDate] = useState("");
  const [calcToDate, setCalcToDate] = useState("");
  const [calcTdsCategory, setCalcTdsCategory] = useState<
    "PUBLIC" | "PRIVATE" | "INSTITUTION" | "TAX_EXEMPT" | "MUTUAL_FUND" | "CUSTOM"
  >("PUBLIC");
  const [calcCustomTds, setCalcCustomTds] = useState("");
  const [calcResult, setCalcResult] = useState<InterestResult | null>(null);

  // Sync settings when they load
  useEffect(() => {
    if (settings?.interest_tds_natural) {
      setCalcCustomTds((prev) => (prev ? prev : String(settings.interest_tds_natural)));
    }
  }, [settings?.interest_tds_natural]);

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
    if (!kitta || kitta <= 0) {
      toast.error("Enter a valid number of debentures (Kitta)");
      return;
    }
    if (!rate || rate <= 0) {
      toast.error("Enter a valid coupon rate (%)");
      return;
    }
    if (calcDays <= 0) {
      toast.error("Check Date From and Date To range");
      return;
    }

    const result = InterestCalculator.calculate({
      debentureKitta: kitta,
      unitFaceValue: fv,
      annualInterestRate: rate,
      daysCount: calcDays,
      taxCategory: calcTdsCategory,
      taxRate: calcCustomTds ? Number(calcCustomTds) / 100 : undefined,
    });
    setCalcResult(result);
    toast.success("Interest calculated successfully");
  };

  const fmtNr = (n: number) =>
    n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const { data: companies = [] } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select(
          "id, company_code, company_name, company_type, sector_type, debenture_rate, coupon_rate",
        )
        .order("company_name");
      if (error) throw error;
      return (data || []) as {
        id: string;
        company_code: string;
        company_name: string;
        company_type?: string | null;
        sector_type?: string | null;
        debenture_rate?: number | null;
        coupon_rate?: number | null;
      }[];
    },
    staleTime: 10_000,
  });

  // Self-heal orphaned companyFilter
  useEffect(() => {
    if (companyFilter !== "all" && companies.length > 0) {
      const exists = companies.some((c) => c.id === companyFilter);
      if (!exists) {
        setCompanyFilter("all");
      }
    }
  }, [companies, companyFilter]);

  // Realtime subscription for live interest payables updates
  useEffect(() => {
    const channel = supabase
      .channel("interest-realtime-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "interest_payables" }, () => {
        qc.invalidateQueries({ queryKey: ["interest_payables_totals"] });
        qc.invalidateQueries({ queryKey: ["interest_payables_paginated"] });
        qc.invalidateQueries({ queryKey: ["interest_payables_all"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "upload_history" }, () => {
        qc.invalidateQueries({ queryKey: ["interest_payables_totals"] });
        qc.invalidateQueries({ queryKey: ["interest_payables_paginated"] });
        qc.invalidateQueries({ queryKey: ["interest_payables_all"] });
        qc.invalidateQueries({ queryKey: ["companies-lookup"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  // Contextual companies for Debenture / Interest section (strictly shows Debentures & Bonds only)
  const relevantCompanies = useMemo(() => {
    return companies.filter((c) => {
      if (companyFilter !== "all" && c.id === companyFilter) return true;
      if (form.company_id && c.id === form.company_id) return true;

      const type = (c.company_type || "").toLowerCase();
      const sector = (c.sector_type || "").toLowerCase();
      const name = (c.company_name || "").toLowerCase();
      const code = (c.company_code || "").toLowerCase();

      if (type === "debenture" || sector === "debenture") return true;
      if ((c.debenture_rate && c.debenture_rate > 0) || (c.coupon_rate && c.coupon_rate > 0))
        return true;
      if (
        name.includes("debenture") ||
        name.includes("bond") ||
        name.includes(" deb") ||
        code.includes("deb") ||
        code.includes("d8")
      )
        return true;
      return false;
    });
  }, [companies, companyFilter, form.company_id]);
  const { data: clients = [] } = useQuery({
    queryKey: ["clients_selector"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("clients")
        .select(
          "id, client_code, full_name, boid, father_name, grandfather_name, pan_or_citizenship, address, district, phone, bank_name, bank_account_no",
        )
        .order("full_name")
        .limit(2000);
      if (error) throw error;
      return (data || []) as {
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
    refetchOnWindowFocus: false,
  });

  const companyMap = useMemo(
    () => Object.fromEntries(companies.map((c) => [c.id, c])),
    [companies],
  );
  const clientMap = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);
  const companyByCode = useMemo(
    () => Object.fromEntries(companies.map((c) => [c.company_code.toLowerCase(), c.id])),
    [companies],
  );
  const clientByCode = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.client_code.toLowerCase(), c.id])),
    [clients],
  );
  const clientByBoid = useMemo(
    () =>
      Object.fromEntries(clients.filter((c) => c.boid).map((c) => [c.boid!.toLowerCase(), c.id])),
    [clients],
  );

  // Date range filters
  const [fromDateFilter, setFromDateFilter] = useState<string>("");
  const [toDateFilter, setToDateFilter] = useState<string>("");
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset | "ALL">("ALL");

  // Debounced search — 300ms before firing server query
  const debouncedSearch = useDebounce(search, 300);

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearch,
    statusFilter,
    companyFilter,
    fyFilter,
    classFilter,
    fromDateFilter,
    toDateFilter,
  ]);

  // Fetch fiscal years for filter dropdown via fast RPC
  const { data: fiscalYears = [] } = useQuery({
    queryKey: ["interest_fiscal_years"],
    queryFn: async () => {
      try {
        const { data, error } = await (supabase as any).rpc("get_distinct_fiscal_years", {
          p_table: "interest_payables",
        });
        if (!error && Array.isArray(data)) {
          return data as string[];
        }
      } catch (err: any) {
        console.warn("get_distinct_fiscal_years RPC error:", err?.message);
      }
      return ["2081/82", "2080/81"];
    },
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Server-side totals for KPI cards (instant <50ms server-side aggregation)
  const {
    data: totals = {
      count: 0,
      paidCount: 0,
      partialCount: 0,
      pendingCount: 0,
      gross: 0,
      tax: 0,
      net: 0,
      disbursed: 0,
      remaining: 0,
    },
  } = useQuery({
    queryKey: [
      "interest_payables_totals",
      statusFilter,
      companyFilter,
      fyFilter,
      classFilter,
      fromDateFilter,
      toDateFilter,
    ],
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      try {
        const { data: rpcTotals, error: rpcErr } = await (supabase as any).rpc(
          "get_interest_payables_totals",
          {
            p_company_id: companyFilter === "all" ? null : companyFilter,
            p_status: statusFilter,
            p_fiscal_year: fyFilter,
            p_class: classFilter,
            p_from_date: fromDateFilter || null,
            p_to_date: toDateFilter || null,
          },
        );
        if (!rpcErr && rpcTotals) {
          return {
            count: Number(rpcTotals.count || 0),
            paidCount: Number(rpcTotals.paidCount || 0),
            partialCount: Number(rpcTotals.partialCount || 0),
            pendingCount: Number(rpcTotals.pendingCount || 0),
            gross: Number(rpcTotals.gross || 0),
            tax: Number(rpcTotals.tax || 0),
            net: Number(rpcTotals.net || 0),
            disbursed: Number(rpcTotals.disbursed || 0),
            remaining: Number(rpcTotals.remaining || 0),
          };
        }
      } catch (err: any) {
        console.warn("get_interest_payables_totals RPC error, falling back:", err?.message);
      }

      return {
        count: 0,
        paidCount: 0,
        partialCount: 0,
        pendingCount: 0,
        gross: 0,
        tax: 0,
        net: 0,
        disbursed: 0,
        remaining: 0,
      };
    },
  });

  // Main server-side paginated query
  const safePage = Math.max(1, page);
  const { data: pageResult = { rows: [], count: 0 }, isLoading } = useQuery({
    queryKey: [
      "interest_payables",
      safePage,
      pageSize,
      debouncedSearch,
      statusFilter,
      companyFilter,
      fyFilter,
      classFilter,
      fromDateFilter,
      toDateFilter,
    ],
    queryFn: async () => {
      let q = (supabase as any)
        .from("interest_payables")
        .select(
          "*, client:clients(id, client_code, full_name, boid, father_name, grandfather_name, pan_or_citizenship, address, district, phone, bank_name, bank_account_no), company:companies(id, company_code, company_name)",
          { count: "exact" },
        )
        .order("due_date", { ascending: false, nullsFirst: false })
        .range((safePage - 1) * pageSize, safePage * pageSize - 1);

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
          q = q.or(
            "payee_classification.eq.TAX_EXEMPT,instrument_ref.ilike.%MUTUAL%,instrument_ref.ilike.%EXEMPT%",
          );
        } else if (classFilter === "INSTITUTION") {
          q = q.or(
            "payee_classification.eq.COMPANY_INSTITUTION,instrument_ref.ilike.%INSTITUT%,instrument_ref.ilike.%COMPANY%",
          );
        } else if (classFilter === "PUBLIC") {
          q = q.or(
            "payee_classification.eq.NATURAL_PERSON,payee_classification.eq.PUBLIC_LEGAL_PERSON,instrument_ref.ilike.%PUBLIC%",
          );
        }
      }

      if (debouncedSearch) {
        const clean = debouncedSearch.trim();
        const { data: matchedClients } = await (supabase as any)
          .from("clients")
          .select("id")
          .or(
            `full_name.ilike.%${clean}%,boid.ilike.%${clean}%,pan_or_citizenship.ilike.%${clean}%,bank_account_no.ilike.%${clean}%`,
          )
          .limit(80);

        const clientIds = (matchedClients || []).map((c: any) => c.id);
        if (clientIds.length > 0) {
          q = q.or(
            `client_id.in.(${clientIds.join(",")}),instrument_ref.ilike.%${clean}%,payment_reference.ilike.%${clean}%,fiscal_year.ilike.%${clean}%`,
          );
        } else {
          q = q.or(
            `instrument_ref.ilike.%${clean}%,payment_reference.ilike.%${clean}%,fiscal_year.ilike.%${clean}%`,
          );
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
  const pageItems = data;

  // Helper to fetch all filtered rows for export/summary
  const fetchAllFiltered = useCallback(async (): Promise<Payable[]> => {
    return fetchAllRows<Payable>((from, to) => {
      let q = (supabase as any)
        .from("interest_payables")
        .select(
          "*, client:clients(id, client_code, full_name, boid, father_name, grandfather_name, pan_or_citizenship, address, district, phone, bank_name, bank_account_no, holder_type, payee_classification), company:companies(id, company_code, company_name)",
        )
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
          q = q.or(
            "payee_classification.eq.TAX_EXEMPT,instrument_ref.ilike.%MUTUAL%,instrument_ref.ilike.%EXEMPT%",
          );
        } else if (classFilter === "INSTITUTION") {
          q = q.or(
            "payee_classification.eq.COMPANY_INSTITUTION,instrument_ref.ilike.%INSTITUT%,instrument_ref.ilike.%COMPANY%",
          );
        } else if (classFilter === "PUBLIC") {
          q = q.or(
            "payee_classification.eq.NATURAL_PERSON,payee_classification.eq.PUBLIC_LEGAL_PERSON,instrument_ref.ilike.%PUBLIC%",
          );
        }
      }
      if (debouncedSearch) {
        q = q.or(
          `instrument_ref.ilike.%${debouncedSearch}%,payment_reference.ilike.%${debouncedSearch}%,fiscal_year.ilike.%${debouncedSearch}%`,
        );
      }
      return q;
    });
  }, [
    statusFilter,
    companyFilter,
    fyFilter,
    classFilter,
    fromDateFilter,
    toDateFilter,
    debouncedSearch,
  ]);

  const [summaryReportOpen, setSummaryReportOpen] = useState(true);
  const [summaryCouponRate, setSummaryCouponRate] = useState<string>("");
  const [summaryFaceValue, setSummaryFaceValue] = useState<string>("1000");
  const [summaryDays, setSummaryDays] = useState<string>("");

  const activeDays = useMemo(() => {
    if (summaryDays && Number(summaryDays) > 0) return Number(summaryDays);
    if (periodPreset !== "ALL" && periodPreset !== "CUSTOM" && STANDARD_PERIODS[periodPreset]) {
      return STANDARD_PERIODS[periodPreset].days;
    }
    if (fromDateFilter && toDateFilter) {
      const from = new Date(fromDateFilter).getTime();
      const to = new Date(toDateFilter).getTime();
      if (!isNaN(from) && !isNaN(to) && to >= from) {
        return Math.ceil((to - from) / (1000 * 60 * 60 * 24));
      }
    }
    return undefined;
  }, [summaryDays, periodPreset, fromDateFilter, toDateFilter]);

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === companyFilter),
    [companies, companyFilter],
  );

  // Automatically fetch summary data with React Query
  const {
    data: summaryAllRows = [],
    isLoading: summaryLoading,
    refetch: loadSummary,
  } = useQuery({
    queryKey: ["interest_summary_rows", companyFilter, fyFilter, fromDateFilter, toDateFilter],
    queryFn: async () => {
      return fetchAllRows<Payable>((from, to) => {
        let q = (supabase as any)
          .from("interest_payables")
          .select(
            "*, client:clients(id, client_code, full_name, boid, father_name, grandfather_name, pan_or_citizenship, address, district, phone, bank_name, bank_account_no, holder_type, payee_classification, payee_segment, kitta), company:companies(id, company_code, company_name)",
          )
          .range(from, to);
        if (companyFilter !== "all") q = q.eq("company_id", companyFilter);
        if (fyFilter !== "all") q = q.eq("fiscal_year", fyFilter);
        if (fromDateFilter) q = q.gte("due_date", fromDateFilter);
        if (toDateFilter) q = q.lte("due_date", toDateFilter);
        return q;
      });
    },
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  const debentureSummaryReport = useMemo(
    () =>
      DebentureSummaryReportService.generateReportFromPayables(
        summaryAllRows,
        selectedCompany?.company_name ||
          (companyFilter === "all" ? "All Debentures" : "Selected Company"),
        selectedCompany?.company_code || "",
        fyFilter !== "all" ? fyFilter : "",
        summaryCouponRate ? Number(summaryCouponRate) : undefined,
        summaryFaceValue ? Number(summaryFaceValue) : 1000,
        activeDays,
        taxRules,
      ),
    [
      summaryAllRows,
      selectedCompany,
      companyFilter,
      fyFilter,
      summaryCouponRate,
      summaryFaceValue,
      activeDays,
      taxRules,
    ],
  );

  const upsert = useMutation({
    mutationFn: async () => {
      if (!canWrite) throw new Error("Unauthorized: You do not have permission to modify records.");
      if (!form.company_id) throw new Error("Please select a company.");
      if (!form.client_id) throw new Error("Please select a client.");
      const kittaVal = form.kitta ? Number(form.kitta) : 0;
      const gross = form.gross_interest ? Number(form.gross_interest) : 0;
      const tax = form.tax_amount ? Number(form.tax_amount) : 0;
      const net = form.net_payable ? Number(form.net_payable) : Math.max(0, gross - tax);

      if (kittaVal < 0) throw new Error("Kitta cannot be negative.");
      if (gross < 0) throw new Error("Gross interest cannot be negative.");
      if (tax < 0) throw new Error("Tax amount cannot be negative.");
      if (net < 0) throw new Error("Net payable cannot be negative.");
      if (tax > gross + 0.05) throw new Error("Tax amount cannot exceed gross interest.");
      if (net > gross + 0.05) throw new Error("Net payable cannot exceed gross interest.");
      if (Math.abs(gross - tax - net) > 0.05) {
        throw new Error(
          `Gross interest (${gross}) must equal Tax (${tax}) + Net Payable (${net}).`,
        );
      }

      const dueDateVal = form.due_date || new Date().toISOString().slice(0, 10);

      const payload = {
        company_id: form.company_id,
        client_id: form.client_id,
        instrument_ref: form.instrument_ref || null,
        lot_name: form.lot_name || null,
        shares_held: kittaVal,
        kitta: kittaVal,
        gross_interest: gross,
        tax_amount: tax,
        net_payable: net,
        due_date: dueDateVal,
        payment_status: form.payment_status || "Pending",
        payment_date: form.payment_date || null,
        payment_reference: form.payment_reference || null,
        fiscal_year: form.fiscal_year || null,
        paid_amount:
          form.payment_status === "Paid"
            ? net
            : form.payment_status === "Pending"
              ? 0
              : editing
                ? (editing.paid_amount ?? 0)
                : 0,
        remaining_amount:
          form.payment_status === "Paid"
            ? 0
            : form.payment_status === "Pending"
              ? net
              : editing
                ? (editing.remaining_amount ?? net)
                : net,
      };

      if (editing) {
        const { error } = await supabase
          .from("interest_payables")
          .update(payload as never)
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("interest_payables").insert(payload as never);
        if (error) throw error;
      }

      // If editing, also update the client record with editable client details
      if (editing && editing.client_id) {
        const clientPayload: Record<string, unknown> = {};
        if (form.client_boid !== undefined) clientPayload.boid = normalizeBoid(form.client_boid);
        if (form.client_full_name !== undefined)
          clientPayload.full_name = form.client_full_name || null;
        if (form.client_father_name !== undefined)
          clientPayload.father_name = form.client_father_name || null;
        if (form.client_grandfather_name !== undefined)
          clientPayload.grandfather_name = form.client_grandfather_name || null;
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
        if (form.client_district !== undefined)
          clientPayload.district = form.client_district || null;
        if (form.client_phone !== undefined) clientPayload.phone = form.client_phone || null;
        if (form.client_bank_name !== undefined)
          clientPayload.bank_name = form.client_bank_name || null;
        if (form.client_bank_account_no !== undefined)
          clientPayload.bank_account_no = form.client_bank_account_no || null;
        const { error: clientErr } = await supabase
          .from("clients")
          .update(clientPayload as never)
          .eq("id", editing.client_id);
        if (clientErr) throw clientErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["interest_payables"] });
      qc.invalidateQueries({ queryKey: ["interest_payables_totals"] });
      qc.invalidateQueries({ queryKey: ["interest_summary_rows"] });
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
      if (!canDelete)
        throw new Error("Unauthorized: You do not have permission to delete records.");
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
      if (!canWrite)
        throw new Error("Unauthorized: You do not have permission to update payment status.");
      if (!payOpen) return;
      const { error } = await (supabase as any)
        .from("interest_payables")
        .update({
          payment_status: "Paid",
          payment_date: payDate || new Date().toISOString().slice(0, 10),
          payment_reference: payRef || null,
          paid_amount: payOpen.net_payable ?? 0,
          remaining_amount: 0,
        })
        .eq("id", payOpen.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["interest_payables"] });
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
      client_pan:
        cl?.pan_no ??
        (cl?.pan_or_citizenship && String(cl.pan_or_citizenship).length === 9
          ? cl.pan_or_citizenship
          : ""),
      client_citizenship:
        cl?.citizenship_no ??
        (cl?.pan_or_citizenship && String(cl.pan_or_citizenship).length !== 9
          ? cl.pan_or_citizenship
          : ""),
      client_nid: cl?.nid_number ?? "",
      client_address: cl?.address ?? "",
      client_district: cl?.district ?? "",
      client_phone: cl?.phone ?? "",
      client_bank_name: cl?.bank_name ?? "",
      client_bank_account_no: cl?.bank_account_no ?? "",
      // Payable fields
      kitta:
        p.kitta != null
          ? String(p.kitta)
          : p.shares_held != null
            ? String(p.shares_held)
            : cl?.kitta != null
              ? String(cl.kitta)
              : "",
      instrument_ref: p.instrument_ref ?? "",
      lot_name: p.lot_name ?? "",
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
          bank_name: p.bank_name || cl?.bank_name || "",
          bank_account_no: p.bank_account_no || cl?.bank_account_no || "",
          instrument_ref: p.instrument_ref,
          gross_interest: p.gross_interest,
          tax_amount: p.tax_amount,
          net_payable: p.net_payable,
          paid_amount:
            p.paid_amount != null ? p.paid_amount : p.payment_status === "Paid" ? p.net_payable : 0,
          remaining_amount:
            p.remaining_amount != null
              ? p.remaining_amount
              : p.payment_status === "Paid"
                ? 0
                : p.net_payable,
          tds_rate: p.tds_rate ? (Number(p.tds_rate) * 100).toFixed(0) + "%" : "",
          due_date: p.due_date,
          payment_status: p.payment_status,
          payment_date: p.payment_date,
          payment_reference: p.payment_reference,
          lot_name: p.lot_name || "",
          fiscal_year: p.fiscal_year,
        };
      }),
      "interest_payables",
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
        holding_kitta?: number | string;
        kitta?: number | string;
        shares_held?: number | string;
        instrument_ref?: string;
        gross_interest?: number | string;
        tax_amount?: number | string;
        net_payable?: number | string;
        due_date?: string;
        payment_status?: string;
        payment_date?: string;
        payment_reference?: string;
        lot_name?: string;
        bank_name?: string;
        bank_account_no?: string;
        bank_branch?: string;
        fiscal_year?: string;
      };
      const rows = await importFromExcel<Row>(file);
      const clean: Record<string, unknown>[] = [];
      const errors: string[] = [];
      rows.forEach((r, i) => {
        const cid =
          r.company_id ||
          (r.company_code ? companyByCode[String(r.company_code).toLowerCase()] : undefined);
        const clid =
          r.client_id ||
          (r.client_code ? clientByCode[String(r.client_code).toLowerCase()] : undefined) ||
          (r.client_boid ? clientByBoid[String(r.client_boid).toLowerCase()] : undefined);
        if (!cid || !clid) {
          errors.push(`Row ${i + 2}: company/client not found`);
          return;
        }
        const kittaVal = Number(r.kitta ?? r.holding_kitta ?? r.shares_held ?? 0);
        const gross = r.gross_interest != null ? Number(r.gross_interest) : 0;
        const tax = r.tax_amount != null ? Number(r.tax_amount) : 0;
        const net = r.net_payable != null ? Number(r.net_payable) : Math.max(0, gross - tax);
        const dueDate = r.due_date ? String(r.due_date) : new Date().toISOString().slice(0, 10);
        clean.push({
          company_id: cid,
          client_id: clid,
          instrument_ref: r.instrument_ref ?? null,
          shares_held: kittaVal,
          kitta: kittaVal,
          gross_interest: gross,
          tax_amount: tax,
          net_payable: net,
          due_date: dueDate,
          payment_status: (r.payment_status as PaymentStatus) ?? "Pending",
          payment_date: r.payment_date ?? null,
          payment_reference: r.payment_reference ?? null,
          lot_name: r.lot_name ?? null,
          bank_name: r.bank_name ?? null,
          bank_account_no: r.bank_account_no ?? null,
          bank_branch: r.bank_branch ?? null,
          fiscal_year: r.fiscal_year ?? null,
        });
      });
      if (!clean.length) return toast.error(errors[0] ?? "No valid rows");
      const { error } = await supabase.from("interest_payables").insert(clean as never);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["interest_payables"] });
      toast.success(
        `Imported ${clean.length} rows${errors.length ? ` (${errors.length} skipped)` : ""}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    }
  };

  const fmt = (n: number | null | undefined) => fmtNpr(n);
  const previewNet = form.net_payable
    ? Number(form.net_payable)
    : (Number(form.gross_interest) || 0) - (Number(form.tax_amount) || 0);

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
            <Button variant="outline" size="sm" onClick={() => setCalcOpen((v) => !v)}>
              <Calculator className="mr-2 h-4 w-4" />
              Calculator
              {calcOpen ? (
                <ChevronUp className="ml-1 h-3 w-3" />
              ) : (
                <ChevronDown className="ml-1 h-3 w-3" />
              )}
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
                  <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0">
                    <DialogHeader className="p-6 pb-3 border-b shrink-0">
                      <DialogTitle>
                        {editing ? "Edit Interest Payable" : "New Interest Payable"}
                      </DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                      {/* Client Details (editable when editing) */}
                      {editing && (
                        <div className="rounded-md border bg-muted/30 p-3 mb-4">
                          <div className="text-xs font-semibold text-muted-foreground mb-2">
                            Client Details
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <Label>BOID (16 Digits)</Label>
                                {form.client_boid &&
                                  form.client_boid.length > 0 &&
                                  form.client_boid.length < 16 && (
                                    <span className="text-[10px] text-amber-600 font-mono">
                                      {form.client_boid.length}/16 (will auto-pad)
                                    </span>
                                  )}
                                {form.client_boid && form.client_boid.length === 16 && (
                                  <span className="text-[10px] text-emerald-600 font-mono">
                                    ✓ 16 digits
                                  </span>
                                )}
                              </div>
                              <Input
                                value={form.client_boid}
                                onChange={(e) => {
                                  const clean = e.target.value
                                    .replace(/[^0-9A-Za-z]/g, "")
                                    .slice(0, 16);
                                  setForm({ ...form, client_boid: clean });
                                }}
                                placeholder="13010200..."
                                maxLength={16}
                                className="font-mono"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Client Code</Label>
                              <Input
                                value={form.client_code}
                                disabled
                                onChange={(e) => setForm({ ...form, client_code: e.target.value })}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Full Name</Label>
                              <Input
                                value={form.client_full_name}
                                onChange={(e) =>
                                  setForm({ ...form, client_full_name: e.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Father's Name</Label>
                              <Input
                                value={form.client_father_name}
                                onChange={(e) =>
                                  setForm({ ...form, client_father_name: e.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Grandfather's Name</Label>
                              <Input
                                value={form.client_grandfather_name}
                                onChange={(e) =>
                                  setForm({ ...form, client_grandfather_name: e.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>PAN Number</Label>
                              <Input
                                value={form.client_pan}
                                onChange={(e) => setForm({ ...form, client_pan: e.target.value })}
                                placeholder="9-digit PAN"
                                className="font-mono"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Citizenship Number</Label>
                              <Input
                                value={form.client_citizenship}
                                onChange={(e) =>
                                  setForm({ ...form, client_citizenship: e.target.value })
                                }
                                placeholder="Citizenship No."
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>NID Number (National ID)</Label>
                              <Input
                                value={form.client_nid}
                                onChange={(e) => setForm({ ...form, client_nid: e.target.value })}
                                placeholder="10-digit NID"
                                className="font-mono"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Address</Label>
                              <Input
                                value={form.client_address}
                                onChange={(e) =>
                                  setForm({ ...form, client_address: e.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>District</Label>
                              <Input
                                value={form.client_district}
                                onChange={(e) =>
                                  setForm({ ...form, client_district: e.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Phone</Label>
                              <Input
                                value={form.client_phone}
                                onChange={(e) => setForm({ ...form, client_phone: e.target.value })}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Bank Name</Label>
                              <Input
                                value={form.client_bank_name}
                                onChange={(e) =>
                                  setForm({ ...form, client_bank_name: e.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Bank Account No</Label>
                              <Input
                                value={form.client_bank_account_no}
                                onChange={(e) =>
                                  setForm({ ...form, client_bank_account_no: e.target.value })
                                }
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Company *</Label>
                          <Select
                            value={form.company_id}
                            onValueChange={(v) => setForm({ ...form, company_id: v })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select company" />
                            </SelectTrigger>
                            <SelectContent className="max-h-60 overflow-y-auto">
                              {relevantCompanies.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.company_code} — {c.company_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Client *</Label>
                          <Select
                            value={form.client_id}
                            onValueChange={(v) => setForm({ ...form, client_id: v })}
                          >
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
                          <Label>Holding (Kitta / Units)</Label>
                          <Input
                            type="number"
                            placeholder="e.g. 50"
                            value={form.kitta}
                            onChange={(e) => {
                              const k = e.target.value;
                              const comp = companies.find((c) => c.id === form.company_id) as any;
                              const rate = comp
                                ? Number(
                                    comp.debenture_rate ||
                                      comp.coupon_rate ||
                                      comp.dividend_rate ||
                                      comp.company_name?.match(/(\d+(?:\.\d+)?)\s*%/)?.[1],
                                  ) || 8.5
                                : 8.5;
                              const faceVal =
                                comp && comp.face_value ? Number(comp.face_value) : 1000;
                              const kNum = Number(k) || 0;
                              const calculatedGross =
                                kNum > 0 ? kNum * faceVal * (rate / 100) * (183 / 365) : null;
                              setForm((f) => ({
                                ...f,
                                kitta: k,
                                gross_interest: calculatedGross
                                  ? calculatedGross.toFixed(2)
                                  : f.gross_interest,
                              }));
                            }}
                            className="font-mono"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Instrument Ref</Label>
                          <Input
                            value={form.instrument_ref}
                            onChange={(e) => setForm({ ...form, instrument_ref: e.target.value })}
                          />
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
                          <Label>Gross Interest</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={form.gross_interest}
                            onChange={(e) => setForm({ ...form, gross_interest: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Tax Amount</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={form.tax_amount}
                            onChange={(e) => setForm({ ...form, tax_amount: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Net Payable</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={form.net_payable}
                            placeholder={String(previewNet || "")}
                            onChange={(e) => setForm({ ...form, net_payable: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Due Date</Label>
                          <Input
                            type="date"
                            value={form.due_date}
                            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Payment Status</Label>
                          <Select
                            value={form.payment_status}
                            onValueChange={(v) =>
                              setForm({ ...form, payment_status: v as PaymentStatus })
                            }
                          >
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
                          <Input
                            type="date"
                            value={form.payment_date}
                            onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1.5 md:col-span-2">
                          <Label>Payment Reference</Label>
                          <Input
                            value={form.payment_reference}
                            onChange={(e) =>
                              setForm({ ...form, payment_reference: e.target.value })
                            }
                          />
                        </div>
                      </div>
                    </div>
                    <DialogFooter className="p-4 border-t bg-muted/20 shrink-0 flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setOpen(false);
                          setEditing(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        disabled={upsert.isPending || !form.company_id || !form.client_id}
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
                <span className="text-xs font-semibold text-muted-foreground mr-1">
                  Period Presets:
                </span>
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
                <Input
                  type="number"
                  value={calcKitta}
                  onChange={(e) => setCalcKitta(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Face Value / Kitta</Label>
                <Input
                  type="number"
                  value={calcFaceValue}
                  onChange={(e) => setCalcFaceValue(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Annual Int. Rate %</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={calcRate}
                  onChange={(e) => setCalcRate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>From Date</Label>
                <Input
                  type="date"
                  value={calcFromDate}
                  onChange={(e) => setCalcFromDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>To Date</Label>
                <Input
                  type="date"
                  value={calcToDate}
                  onChange={(e) => setCalcToDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Calculated Days</Label>
                <Input
                  readOnly
                  value={calcDays || ""}
                  placeholder="0"
                  className="bg-muted font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>TDS Category</Label>
                <Select value={calcTdsCategory} onValueChange={(v: any) => setCalcTdsCategory(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PUBLIC">Natural Person — Public (6%)</SelectItem>
                    <SelectItem value="PRIVATE">Natural Person — Private/Promoter (6%)</SelectItem>
                    <SelectItem value="INSTITUTION">Legal Person / Company (15%)</SelectItem>
                    <SelectItem value="TAX_EXEMPT">Mutual Fund / Tax Exempt (0%)</SelectItem>
                    <SelectItem value="CUSTOM">Custom Rate</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {calcTdsCategory === "CUSTOM" && (
                <div className="space-y-1.5">
                  <Label>Custom TDS %</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={calcCustomTds}
                    onChange={(e) => setCalcCustomTds(e.target.value)}
                  />
                </div>
              )}
              <div className="sm:col-span-3 mt-2">
                <Button onClick={handleCalcInterest} className="w-full">
                  Calculate Interest
                </Button>
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
                    <span className="font-medium text-amber-600">
                      {fmtNr(calcResult.annualInterestAmount)}
                    </span>
                  </div>
                  <div className="flex justify-between border-b pb-1">
                    <span className="text-muted-foreground">Daily Interest Rate</span>
                    <span className="font-medium text-blue-600">
                      {fmtNr(calcResult.dailyInterestRate)} / day
                    </span>
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
                    <span className="font-medium text-destructive">
                      {fmtNr(calcResult.taxAmount)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2">
                    <span className="font-semibold">Net Interest Payable</span>
                    <span className="font-bold text-lg text-green-600">
                      Rs. {fmtNr(calcResult.netInterestPayable)}
                    </span>
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
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Total Debenture Records
              </div>
              <div className="text-xl font-bold font-mono tracking-tight mt-1">
                {(totals.count ?? 0).toLocaleString()}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1">
                <span className="text-emerald-600 font-medium">{totals.paidCount ?? 0} Paid</span>
                {Boolean(totals.partialCount) && (
                  <>
                    <span>·</span>
                    <span className="text-amber-600 font-medium">
                      {totals.partialCount} Partial
                    </span>
                  </>
                )}
                <span>·</span>
                <span>{totals.pendingCount ?? 0} Pending</span>
              </div>
            </div>
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <Users className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm hover:shadow transition-shadow">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Gross Interest
              </div>
              <div className="text-xl font-bold font-mono tracking-tight mt-1">
                NPR {fmt(totals.gross)}
              </div>
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
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                TDS Tax Withheld
              </div>
              <div className="text-xl font-bold font-mono tracking-tight mt-1 text-rose-600 dark:text-rose-400">
                NPR {fmt(totals.tax)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {debentureDisplayRates.publicRatePct}% / {debentureDisplayRates.institutionRatePct}%
                TDS rate
              </div>
            </div>
            <div className="h-10 w-10 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-600 shrink-0">
              <Receipt className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm hover:shadow transition-shadow">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Net Interest Payable
              </div>
              <div className="text-xl font-bold font-mono tracking-tight mt-1 text-foreground">
                NPR {fmt(totals.net)}
              </div>
              <div className="text-[11px] mt-0.5 flex flex-wrap items-center gap-1.5 font-mono">
                <span className="text-emerald-600 font-medium">
                  Disbursed: NPR {fmt(totals.disbursed ?? 0)}
                </span>
                <span className="text-muted-foreground font-sans">·</span>
                <span className="text-rose-600 font-medium">
                  Due: NPR {fmt(totals.remaining ?? 0)}
                </span>
              </div>
            </div>
            <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 shrink-0">
              <Wallet className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Debenture Interest Distribution Summary Card (Pumori / CDS Format) ─── */}
      <Card className="mb-6 border-primary/20 shadow-xs overflow-hidden">
        <CardHeader className="p-4 sm:p-5 bg-card border-b flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0 mt-0.5">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base font-semibold tracking-tight text-foreground">
                  Debenture Interest Distribution Summary
                </CardTitle>
                <Badge
                  variant="outline"
                  className="font-mono text-[11px] bg-muted/50 border-border"
                >
                  {debentureSummaryReport?.companyCode || "All Debentures"}{" "}
                  {debentureSummaryReport?.fiscalYear
                    ? `• FY ${debentureSummaryReport.fiscalYear}`
                    : ""}
                </Badge>
                <Badge variant="secondary" className="text-[10px] uppercase font-semibold">
                  Pumori / CDS Format
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-normal">
                Holder-wise debenture capital &amp; coupon breakdown: Natural Persons (
                <span className="font-medium text-foreground">
                  {debentureDisplayRates.publicRatePct}% TDS
                </span>
                ), Institutions (
                <span className="font-medium text-foreground">
                  {debentureDisplayRates.institutionRatePct}% TDS
                </span>
                ), Tax-Exempt Funds (
                <span className="font-medium text-foreground">
                  {debentureDisplayRates.exemptRatePct}% TDS
                </span>
                )
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0 self-start lg:self-center">
            <Button
              variant="outline"
              size="sm"
              className="h-8.5 text-xs font-medium shadow-xs"
              onClick={() => setSummaryReportOpen((v) => !v)}
            >
              {summaryReportOpen ? (
                <ChevronUp className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
              )}
              {summaryReportOpen ? "Hide Breakdown" : "View Breakdown"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8.5 text-xs font-medium shadow-xs hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/40"
              onClick={() =>
                debentureSummaryReport &&
                DebentureSummaryReportService.exportToExcel(debentureSummaryReport)
              }
              disabled={debentureSummaryReport.rows.length === 0}
            >
              <FileSpreadsheet className="h-3.5 w-3.5 mr-1 text-emerald-600" />
              Summary Excel
            </Button>
          </div>
        </CardHeader>

        {/* ─── Dedicated Toolbar / Filter Ribbon ─── */}
        <div className="p-3.5 sm:px-4 bg-muted/20 border-b flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                Debenture:
              </span>
              <Select
                value={companyFilter}
                onValueChange={(v) => {
                  setCompanyFilter(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-44 sm:w-52 text-xs bg-background shadow-xs">
                  <SelectValue placeholder="All Debentures" />
                </SelectTrigger>
                <SelectContent className="max-h-60 overflow-y-auto">
                  <SelectItem value="all">All Debentures</SelectItem>
                  {relevantCompanies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.company_code} — {c.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                FY:
              </span>
              <Select
                value={fyFilter}
                onValueChange={(v) => {
                  setFyFilter(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-28 text-xs bg-background shadow-xs">
                  <SelectValue placeholder="All FY" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All FY</SelectItem>
                  {fiscalYears.map((fy) => (
                    <SelectItem key={fy} value={fy}>
                      {fy}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Period Quick Presets */}
            <div className="flex items-center rounded-md border bg-background p-0.5 shadow-xs">
              <span className="text-[11px] text-muted-foreground font-medium px-2 whitespace-nowrap">
                Period:
              </span>
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
                    className={`text-[11px] font-medium px-2.5 py-0.5 rounded transition-all whitespace-nowrap ${
                      periodPreset === p
                        ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>

            {/* Date Range Search */}
            <div className="flex items-center gap-1.5 bg-background border rounded-md px-2.5 h-8 text-xs shadow-xs">
              <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                From:
              </span>
              <input
                type="date"
                value={fromDateFilter}
                onChange={(e) => {
                  setFromDateFilter(e.target.value);
                  setPeriodPreset("CUSTOM");
                  setPage(1);
                }}
                className="w-[115px] shrink-0 bg-transparent text-xs outline-none font-mono"
              />
              <span className="text-muted-foreground/30 font-light">|</span>
              <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                To:
              </span>
              <input
                type="date"
                value={toDateFilter}
                onChange={(e) => {
                  setToDateFilter(e.target.value);
                  setPeriodPreset("CUSTOM");
                  setPage(1);
                }}
                className="w-[115px] shrink-0 bg-transparent text-xs outline-none font-mono"
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
                  className="ml-1 text-[11px] text-destructive hover:underline font-semibold shrink-0"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
        {summaryReportOpen && (
          <CardContent className="p-0 overflow-x-auto">
            {summaryLoading ? (
              <div className="py-12 text-center text-muted-foreground text-sm flex flex-col items-center justify-center gap-2">
                <BarChart3 className="h-8 w-8 animate-pulse text-primary opacity-60" />
                <p className="font-medium">Calculating Debenture Interest Distribution Summary…</p>
                <p className="text-xs text-muted-foreground">
                  Aggregating coupon rates, days, and tax categories
                </p>
              </div>
            ) : (
              <table className="w-full text-xs text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="bg-muted/80 text-foreground font-semibold border-b border-border divide-x border-border">
                    <th className="py-2.5 px-3 uppercase text-[11px] whitespace-nowrap min-w-[140px]">
                      CATEGORY
                    </th>
                    <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                      KITTA
                    </th>
                    <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                      AMOUNT
                    </th>
                    <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                      {debentureSummaryReport.couponRate > 0
                        ? `INT. @ ${debentureSummaryReport.couponRate}%`
                        : "ANNUAL INT."}
                    </th>
                    <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                      INT. PER DAY
                    </th>
                    <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                      INTEREST PUMORI
                    </th>
                    <th className="py-2.5 px-3 text-right uppercase text-[11px] whitespace-nowrap">
                      TAX
                    </th>
                    <th className="py-2.5 px-3 text-right uppercase text-[11px] bg-emerald-100/70 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-200 whitespace-nowrap">
                      NET INTEREST PAYABLE
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-mono">
                  {debentureSummaryReport.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-8 text-center text-muted-foreground font-sans text-xs whitespace-nowrap"
                      >
                        No debenture interest payables found for the selected filter.
                      </td>
                    </tr>
                  ) : (
                    debentureSummaryReport.rows.map((row) => (
                      <tr
                        key={row.name}
                        className="hover:bg-muted/30 transition-colors divide-x divide-border"
                      >
                        <td className="py-2 px-3 font-semibold font-sans whitespace-nowrap text-foreground">
                          {row.name}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">{fmt(row.kitta)}</td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {fmt(row.principalAmount)}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {fmt(row.annualInterest)}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {fmt(row.interestPerDay)}
                        </td>
                        <td className="py-2 px-3 text-right font-medium whitespace-nowrap">
                          {fmt(row.grossInterest)}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {fmt(row.taxAmount)}
                        </td>
                        <td className="py-2 px-3 text-right font-bold bg-emerald-50/70 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-200 whitespace-nowrap">
                          {fmt(row.netInterestPayable)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {debentureSummaryReport.rows.length > 0 && (
                  <tfoot>
                    <tr className="bg-muted/90 font-bold border-t-2 border-b-2 border-foreground/30 divide-x divide-border font-mono">
                      <td className="py-2.5 px-3 font-sans uppercase whitespace-nowrap">TOTAL</td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {fmt(debentureSummaryReport.total.kitta)}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {fmt(debentureSummaryReport.total.principalAmount)}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {fmt(debentureSummaryReport.total.annualInterest)}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {fmt(debentureSummaryReport.total.interestPerDay)}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {fmt(debentureSummaryReport.total.grossInterest)}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {fmt(debentureSummaryReport.total.taxAmount)}
                      </td>
                      <td className="py-2.5 px-3 text-right bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-200 whitespace-nowrap">
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

      <Card className="border-border/60 shadow-sm overflow-hidden">
        <CardHeader className="py-3 px-4 bg-muted/20 border-b flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-semibold tracking-tight">
              Debenture Payables &amp; Disbursements
            </CardTitle>
            <Badge variant="outline" className="font-mono text-[11px] bg-background">
              {pageResult.count.toLocaleString()} Records
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{pageItems.length}</span> of{" "}
            <span className="font-semibold text-foreground">
              {pageResult.count.toLocaleString()}
            </span>{" "}
            payables
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <div className="mb-4 flex flex-col gap-3">
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search shareholder, BOID, account, ref…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-9 h-9 text-xs bg-background"
                />
              </div>

              <Select
                value={companyFilter}
                onValueChange={(v) => {
                  setCompanyFilter(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-9 text-xs bg-background">
                  <SelectValue placeholder="All Debentures" />
                </SelectTrigger>
                <SelectContent className="max-h-60 overflow-y-auto">
                  <SelectItem value="all">All Debentures</SelectItem>
                  {relevantCompanies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.company_code} — {c.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={classFilter}
                onValueChange={(v) => {
                  setClassFilter(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-9 text-xs bg-background">
                  <SelectValue placeholder="All Classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Classes / Categories</SelectItem>
                  <SelectItem value="PUBLIC">Public (Natural Person)</SelectItem>
                  <SelectItem value="INSTITUTION">Institution (Legal Person)</SelectItem>
                  <SelectItem value="TAX_EXEMPT">Tax Exempt (Mutual Fund / Statutory)</SelectItem>
                  <SelectItem value="PROMOTER">Promoter</SelectItem>
                  <SelectItem value="LOCAL">Local</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v);
                  setPage(1);
                }}
              >
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

              <Select
                value={fyFilter}
                onValueChange={(v) => {
                  setFyFilter(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-9 text-xs bg-background">
                  <SelectValue placeholder="All Fiscal Years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Fiscal Years</SelectItem>
                  {fiscalYears.map((fy) => (
                    <SelectItem key={fy} value={fy}>
                      {fy}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/40">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 bg-muted/40 border rounded-md px-2.5 h-8 text-xs">
                  <span className="text-[11px] text-muted-foreground font-medium whitespace-nowrap">
                    From:
                  </span>
                  <input
                    type="date"
                    value={fromDateFilter}
                    onChange={(e) => {
                      setFromDateFilter(e.target.value);
                      setPage(1);
                    }}
                    className="w-[125px] shrink-0 bg-transparent text-xs outline-none font-mono"
                  />
                  <span className="text-muted-foreground/40 font-light">|</span>
                  <span className="text-[11px] text-muted-foreground font-medium whitespace-nowrap">
                    To:
                  </span>
                  <input
                    type="date"
                    value={toDateFilter}
                    onChange={(e) => {
                      setToDateFilter(e.target.value);
                      setPage(1);
                    }}
                    className="w-[125px] shrink-0 bg-transparent text-xs outline-none font-mono"
                  />
                </div>

                {(search ||
                  statusFilter !== "all" ||
                  companyFilter !== "all" ||
                  fyFilter !== "all" ||
                  classFilter !== "all" ||
                  fromDateFilter ||
                  toDateFilter) && (
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
            </div>
          </div>

          <div className="rounded-md border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-semibold whitespace-nowrap w-[12%] min-w-[110px]">
                    Debenture / Series
                  </TableHead>
                  <TableHead className="font-semibold whitespace-nowrap w-[19%] min-w-[160px]">
                    Shareholder &amp; BOID
                  </TableHead>
                  <TableHead className="text-center font-semibold whitespace-nowrap w-[6%] min-w-[55px]">
                    Holding
                  </TableHead>
                  <TableHead className="text-center font-semibold whitespace-nowrap w-[8%] min-w-[75px]">
                    Gross (NPR)
                  </TableHead>
                  <TableHead className="text-center font-semibold whitespace-nowrap w-[7%] min-w-[65px]">
                    TDS Tax
                  </TableHead>
                  <TableHead className="text-center font-semibold whitespace-nowrap w-[8%] min-w-[75px]">
                    Net Payable
                  </TableHead>
                  <TableHead className="text-center font-semibold whitespace-nowrap w-[8%] min-w-[75px]">
                    Paid
                  </TableHead>
                  <TableHead className="text-center font-semibold whitespace-nowrap w-[8%] min-w-[75px]">
                    Remaining
                  </TableHead>
                  <TableHead className="font-semibold whitespace-nowrap w-[12%] min-w-[125px]">
                    Bank Details
                  </TableHead>
                  <TableHead className="font-semibold whitespace-nowrap w-[12%] min-w-[105px]">
                    Status &amp; Due
                  </TableHead>
                  <TableHead className="text-right font-semibold whitespace-nowrap w-[6%] min-w-[65px]">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={11} className="py-12 text-center text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : pageItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="py-12 text-center text-muted-foreground">
                      No payables.
                    </TableCell>
                  </TableRow>
                ) : (
                  pageItems.map((p) => {
                    const c = p.company ?? null;
                    const cl = p.client ?? null;
                    const netVal = Number(p.net_payable ?? 0);
                    const paidVal =
                      p.paid_amount != null
                        ? Number(p.paid_amount)
                        : p.payment_status === "Paid"
                          ? netVal
                          : 0;
                    const remVal =
                      p.remaining_amount != null
                        ? Number(p.remaining_amount)
                        : p.payment_status === "Paid"
                          ? 0
                          : Math.max(0, netVal - paidVal);
                    return (
                      <TableRow key={p.id} className="hover:bg-muted/30 transition-colors">
                        {/* 1. Debenture / Series */}
                        <TableCell className="py-2 px-2 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-muted/80 text-foreground border border-border/50">
                              {c?.company_code || "DEB"}
                            </span>
                          </div>
                          <div
                            className="text-[11px] text-muted-foreground truncate max-w-[130px] mt-0.5"
                            title={p.instrument_ref || c?.company_name || undefined}
                          >
                            {p.instrument_ref || c?.company_name || "—"}
                          </div>
                        </TableCell>

                        {/* 2. Shareholder & BOID */}
                        <TableCell className="py-2 px-2">
                          <div
                            className="font-medium text-xs text-foreground truncate max-w-[190px]"
                            title={cl?.full_name ?? undefined}
                          >
                            {cl?.full_name ?? "—"}
                          </div>
                          <div className="mt-0.5">
                            {cl?.boid ? (
                              <button
                                type="button"
                                className="font-mono text-[11px] font-semibold text-primary hover:underline cursor-pointer block leading-none"
                                onClick={() => setSelectedStatementBoid(cl.boid)}
                                title="Click to view full statement"
                              >
                                {cl.boid}
                              </button>
                            ) : (
                              <span className="font-mono text-[11px] text-muted-foreground block leading-none">
                                —
                              </span>
                            )}
                          </div>
                          {cl?.father_name && (
                            <div
                              className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5 block max-w-[190px]"
                              title={`s/o ${cl.father_name}`}
                            >
                              s/o {cl.father_name}
                            </div>
                          )}
                        </TableCell>

                        {/* 3. Holding (Kitta) */}
                        <TableCell className="text-center font-mono font-semibold text-primary whitespace-nowrap text-xs py-2 px-2">
                          {p.kitta || p.shares_held || cl?.kitta
                            ? (p.kitta || p.shares_held || cl?.kitta)?.toLocaleString()
                            : "—"}
                        </TableCell>

                        {/* 4. Gross Interest */}
                        <TableCell className="text-center font-mono whitespace-nowrap text-xs py-2 px-2">
                          {fmt(p.gross_interest)}
                        </TableCell>

                        {/* 5. TDS Tax Amount */}
                        <TableCell className="text-center font-mono text-amber-600 dark:text-amber-400 whitespace-nowrap text-xs py-2 px-2">
                          {fmt(p.tax_amount)}
                        </TableCell>

                        {/* 6. Net Payable */}
                        <TableCell className="text-center font-mono font-bold text-foreground whitespace-nowrap text-xs py-2 px-2">
                          {fmt(p.net_payable)}
                        </TableCell>

                        {/* 7. Paid Amount */}
                        <TableCell className="text-center font-mono font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap text-xs py-2 px-2">
                          {fmt(paidVal)}
                        </TableCell>

                        {/* 8. Remaining Amount */}
                        <TableCell
                          className={`text-center font-mono font-semibold whitespace-nowrap text-xs py-2 px-2 ${
                            remVal > 0
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-muted-foreground"
                          }`}
                        >
                          {fmt(remVal)}
                        </TableCell>

                        {/* 9. Bank Details */}
                        <TableCell className="py-2 px-2">
                          {(p as any).bank_name || cl?.bank_name ? (
                            <div className="max-w-[160px]">
                              <div
                                className="text-[11px] font-medium truncate"
                                title={(p as any).bank_name || cl?.bank_name || undefined}
                              >
                                {(p as any).bank_name || cl?.bank_name}
                              </div>
                              {((p as any).bank_account_no || cl?.bank_account_no) && (
                                <div
                                  className="font-mono text-[10px] text-muted-foreground truncate"
                                  title={
                                    (p as any).bank_account_no || cl?.bank_account_no || undefined
                                  }
                                >
                                  {(p as any).bank_account_no || cl?.bank_account_no}
                                </div>
                              )}
                              {(() => {
                                const accNo = (p as any).bank_account_no || cl?.bank_account_no;
                                const bName = (p as any).bank_name || cl?.bank_name;
                                if (!accNo) return null;
                                const bCheck = validateNepaliBankAccount(bName, accNo);
                                if (!bCheck.isValid && bCheck.warning) {
                                  return (
                                    <div
                                      className="text-[9px] text-rose-500 font-medium truncate mt-0.5"
                                      title={bCheck.warning}
                                    >
                                      ⚠ {bCheck.warning}
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>

                        {/* 10. Status & Due */}
                        <TableCell className="py-2 px-2 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge
                              variant={
                                p.payment_status === "Paid"
                                  ? "default"
                                  : (p as any).remarks?.includes("Rejected")
                                    ? "destructive"
                                    : "outline"
                              }
                              className={`text-[10px] px-1.5 py-0 h-4.5 font-medium ${
                                p.payment_status === "Paid"
                                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                                  : p.payment_status === "Partial"
                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border-amber-300"
                                    : ""
                              }`}
                            >
                              {p.payment_status}
                            </Badge>
                            {p.fiscal_year && (
                              <span className="font-mono text-[10px] text-muted-foreground font-medium">
                                FY {p.fiscal_year}
                              </span>
                            )}
                            {Number(p.gross_interest || 0) >= 25000 &&
                              !(
                                cl?.pan_or_citizenship &&
                                /^\d{9}$/.test(cl.pan_or_citizenship.trim())
                              ) && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1 py-0 text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300"
                                  title="Nepal Income Tax Act 2058: Payments >= NPR 25,000 require PAN for IRD e-TDS credit"
                                >
                                  PAN Req
                                </Badge>
                              )}
                          </div>
                          {p.payment_date && (
                            <div className="mt-1">
                              <DualDate date={p.payment_date} />
                            </div>
                          )}
                          <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                            {p.due_date && <span>Due: {p.due_date}</span>}
                            {(p as any).remarks && (
                              <span
                                className={`truncate max-w-[120px] ${(p as any).remarks.includes("Rejected") ? "text-destructive font-semibold" : "text-muted-foreground"}`}
                                title={(p as any).remarks}
                              >
                                · {(p as any).remarks}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        {/* 11. Actions */}
                        <TableCell className="py-2 px-2 text-right whitespace-nowrap">
                          {canWrite && (
                            <div className="flex justify-end items-center gap-0.5">
                              {p.payment_status !== "Paid" && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => {
                                    setPayOpen(p);
                                    setPayRef(p.payment_reference ?? "");
                                  }}
                                  title="Mark as Paid"
                                  className="h-7 w-7 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => openEdit(p)}
                                title="Edit Payable"
                                className="h-7 w-7 text-muted-foreground hover:bg-blue-50 hover:text-blue-600"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              {canDelete && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => {
                                    if (confirm("Delete this payable?")) del.mutate(p.id);
                                  }}
                                  className="h-7 w-7 text-muted-foreground hover:bg-rose-50 hover:text-destructive"
                                  title="Delete Payable (Admin Only)"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            {pageResult.count > 0 && (
              <div className="flex items-center justify-between border-t px-4 py-3">
                <div className="text-sm text-muted-foreground">
                  Showing {(safePage - 1) * pageSize + 1} to{" "}
                  {Math.min(safePage * pageSize, pageResult.count)} of {pageResult.count} records
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="h-8 rounded border bg-background px-2 text-sm"
                  >
                    <option value="10">10 / page</option>
                    <option value="25">25 / page</option>
                    <option value="50">50 / page</option>
                  </select>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setPage(1)}
                    disabled={safePage === 1}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground px-2">
                    {safePage} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setPage(totalPages)}
                    disabled={safePage === totalPages}
                  >
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
          <DialogHeader>
            <DialogTitle>Mark as Paid</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Payment Date</Label>
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Payment Reference</Label>
              <Input
                placeholder="Cheque / Txn no."
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(null)}>
              Cancel
            </Button>
            <Button disabled={markPaid.isPending} onClick={() => markPaid.mutate()}>
              Confirm Payment
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
