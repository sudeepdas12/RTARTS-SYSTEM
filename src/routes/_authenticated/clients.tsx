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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
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
  FileText,
  AlertTriangle,
  X,
  Mail,
} from "lucide-react";
import { toast } from "sonner";
import { exportToExcel, importFromExcel } from "@/lib/xlsx-utils";
import { ShareholderStatementDialog } from "@/components/shareholder-statement-dialog";
import { ShareholderNoticeDialog } from "@/components/shareholder-notice-dialog";
import { ShareholderNoticeService } from "@/lib/services/shareholder-notice.service";
import { normalizeBoid } from "@/lib/validation-engine";

export const Route = createFileRoute("/_authenticated/clients")({
  component: ClientsPage,
});

type Holder =
  | "Natural Person - Public"
  | "Natural Person - Promoter"
  | "Natural Person - Local"
  | "Natural Person - Employee"
  | "Natural Person - Minor"
  | "Natural Person - Joint Holder"
  | "Legal Person"
  | "Legal Person - Promoter"
  | "Mutual Fund"
  | "Foreign"
  | "Tax Exempt"
  | "Public"
  | "Promoter"
  | "Local"
  | "Employee"
  | "Institution";
type Status = "Active" | "Inactive";
type Residency = "Resident" | "Non-Resident";
type Verification = "Pending" | "Verified" | "Rejected";
type PayeeClassification =
  "NATURAL_PERSON" | "PUBLIC_LEGAL_PERSON" | "COMPANY_INSTITUTION" | "TAX_EXEMPT" | "UNCLASSIFIED";

function classificationBadge(c: PayeeClassification | null, holderType?: string | null) {
  switch (c) {
    case "NATURAL_PERSON":
      return (
        <Badge
          variant="secondary"
          className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-[10px]"
        >
          Natural Person (5% Div / 6% Deb)
        </Badge>
      );
    case "PUBLIC_LEGAL_PERSON":
      return (
        <Badge
          variant="secondary"
          className="bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300 border-0 text-[10px]"
        >
          Public Legal Person (Statutory)
        </Badge>
      );
    case "COMPANY_INSTITUTION":
      return (
        <Badge
          variant="secondary"
          className="bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 border-0 text-[10px]"
        >
          Legal Person / Institution (15% Div / 15% Deb)
        </Badge>
      );
    case "TAX_EXEMPT":
      if (holderType && /Mutual Fund/i.test(holderType)) {
        return (
          <Badge
            variant="secondary"
            className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-[10px]"
          >
            Tax Exempt (Mutual Fund — 0% TDS)
          </Badge>
        );
      }
      if (holderType && /Tax Exempt/i.test(holderType)) {
        return (
          <Badge
            variant="secondary"
            className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-[10px]"
          >
            Tax Exempt (Statutory Fund — 0% TDS)
          </Badge>
        );
      }
      return (
        <Badge
          variant="secondary"
          className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-[10px]"
        >
          Tax Exempted (0% TDS)
        </Badge>
      );
    case "UNCLASSIFIED":
      return (
        <Badge
          variant="outline"
          className="text-red-600 border-red-300 bg-red-50 dark:bg-red-950/30 text-[10px]"
        >
          Review Required
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground border-muted text-[10px]">
          Unclassified
        </Badge>
      );
  }
}

function holderBadge(h: Holder | null) {
  const type = String(h || "Public").trim();
  if (/Local/i.test(type))
    return (
      <Badge
        variant="secondary"
        className="bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300 border-0 gap-1 text-[11px]"
      >
        <MapPin className="h-3 w-3" />
        Local Affected
      </Badge>
    );
  if (/Employee|Staff/i.test(type))
    return (
      <Badge
        variant="secondary"
        className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-0 gap-1 text-[11px]"
      >
        <User className="h-3 w-3" />
        Employee Quota
      </Badge>
    );
  if (/Promoter/i.test(type))
    return (
      <Badge
        variant="secondary"
        className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 gap-1 text-[11px]"
      >
        <ShieldCheck className="h-3 w-3" />
        Promoter
      </Badge>
    );
  if (/Mutual Fund/i.test(type))
    return (
      <Badge
        variant="secondary"
        className="bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 border-0 gap-1 text-[11px]"
      >
        <Landmark className="h-3 w-3" />
        Mutual Fund
      </Badge>
    );
  if (/Tax Exempt/i.test(type))
    return (
      <Badge
        variant="secondary"
        className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 gap-1 text-[11px]"
      >
        <ShieldAlert className="h-3 w-3" />
        Tax Exempt (Statutory)
      </Badge>
    );
  if (/Foreign/i.test(type))
    return (
      <Badge variant="outline" className="text-purple-700 border-purple-300 gap-1 text-[11px]">
        <User className="h-3 w-3" />
        Foreign
      </Badge>
    );
  if (/Legal Person|Institution/i.test(type))
    return (
      <Badge variant="outline" className="text-indigo-700 border-indigo-300 gap-1 text-[11px]">
        <Building2 className="h-3 w-3" />
        Institution
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-emerald-700 border-emerald-300 gap-1 text-[11px]">
      <User className="h-3 w-3" />
      Public
    </Badge>
  );
}

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
  kitta?: number | null;
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
  needs_review?: boolean;
  data_quality_notes?: string | null;
  created_at: string;
  company?: { company_name: string; company_code: string } | null;
  company_details?: Array<{
    company_id: string;
    company_code: string;
    company_name: string;
    kitta: number;
  }> | null;
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
  kitta: "",
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

function SectionLabel({
  icon: Icon,
  children,
}: {
  icon?: React.ElementType;
  children: React.ReactNode;
}) {
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
  const [companyFilter, setCompanyFilter] = useState(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      return p.get("companyId") || p.get("companyFilter") || "all";
    }
    return "all";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      const paramComp = p.get("companyId") || p.get("companyFilter");
      if (paramComp && paramComp !== companyFilter) {
        setCompanyFilter(paramComp);
      }
    }
  }, [companyFilter]);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [verFilter, setVerFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [selectedStatementBoid, setSelectedStatementBoid] = useState<string | null>(null);
  const [counterQuery, setCounterQuery] = useState("");
  const [isCounterSearching, setIsCounterSearching] = useState(false);
  const [counterSearchResults, setCounterSearchResults] = useState<any[] | null>(null);
  const [showCounterDropdown, setShowCounterDropdown] = useState(false);
  const [noticeDialogOpen, setNoticeDialogOpen] = useState(false);
  const [noticeTargetClient, setNoticeTargetClient] = useState<any | null>(null);

  const handleCounterLookup = async (queryToSearch?: string) => {
    const raw = (queryToSearch !== undefined ? queryToSearch : counterQuery).trim();
    if (!raw) {
      toast.info("Please enter a BOID, PAN, Citizenship, Phone, or Name to lookup.");
      return;
    }

    setIsCounterSearching(true);
    try {
      const digits = raw.replace(/[^0-9]/g, "");

      // 1. Direct 16-digit numeric BOID match
      if (digits.length === 16) {
        const { data: boidMatches } = await supabase
          .from("clients")
          .select(
            "id, boid, full_name, pan_or_citizenship, phone, bank_name, bank_account_no, company:companies(company_code, company_name)",
          )
          .eq("boid", digits)
          .limit(10);
        if (boidMatches && boidMatches.length === 1) {
          setShowCounterDropdown(false);
          setSelectedStatementBoid(boidMatches[0].boid || boidMatches[0].id);
          toast.success(`Found shareholder: ${boidMatches[0].full_name} (${boidMatches[0].boid})`);
          return;
        } else if (boidMatches && boidMatches.length > 1) {
          setCounterSearchResults(boidMatches);
          setShowCounterDropdown(true);
          toast.info(`Found ${boidMatches.length} matching accounts for this BOID.`);
          return;
        }
      }

      // 2. Exact match across identifiers
      const { data: exactMatches } = await supabase
        .from("clients")
        .select(
          "id, boid, full_name, pan_or_citizenship, phone, bank_name, bank_account_no, company:companies(company_code, company_name)",
        )
        .or(`boid.eq.${raw},pan_or_citizenship.eq.${raw},phone.eq.${raw},bank_account_no.eq.${raw}`)
        .limit(10);

      if (exactMatches && exactMatches.length === 1) {
        setShowCounterDropdown(false);
        setSelectedStatementBoid(exactMatches[0].boid || exactMatches[0].id);
        toast.success(`Found shareholder: ${exactMatches[0].full_name} (${exactMatches[0].boid})`);
        return;
      } else if (exactMatches && exactMatches.length > 1) {
        setCounterSearchResults(exactMatches);
        setShowCounterDropdown(true);
        toast.info(`Found ${exactMatches.length} matching accounts. Select one to view.`);
        return;
      }

      // 3. Fallback partial/fuzzy match (name, pan, client_code)
      const { data: partialMatches } = await supabase
        .from("clients")
        .select(
          "id, boid, full_name, pan_or_citizenship, phone, bank_name, bank_account_no, company:companies(company_code, company_name)",
        )
        .or(`full_name.ilike.%${raw}%,pan_or_citizenship.ilike.%${raw}%,client_code.ilike.%${raw}%`)
        .limit(10);

      if (partialMatches && partialMatches.length === 1) {
        setShowCounterDropdown(false);
        setSelectedStatementBoid(partialMatches[0].boid || partialMatches[0].id);
        toast.success(
          `Found shareholder: ${partialMatches[0].full_name} (${partialMatches[0].boid})`,
        );
        return;
      } else if (partialMatches && partialMatches.length > 1) {
        setCounterSearchResults(partialMatches);
        setShowCounterDropdown(true);
        toast.info(
          `Found ${partialMatches.length} matching shareholders. Select one to view statement.`,
        );
        return;
      }

      toast.error(
        `No shareholder record found matching "${raw}". Verify BOID, PAN, or Citizenship number.`,
      );
    } catch (err: any) {
      toast.error(
        `Counter search error: ${err?.message || "Failed to query shareholder database."}`,
      );
    } finally {
      setIsCounterSearching(false);
    }
  };

  const fileRef = useRef<HTMLInputElement>(null);
  const debouncedSearch = useDebounce(search, 400);

  // Companies lookup for dropdown filter and association
  const { data: companies = [] } = useQuery({
    queryKey: ["companies-lookup"],
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, company_code, company_name")
        .order("company_name");
      if (error) throw error;
      return data as { id: string; company_code: string; company_name: string }[];
    },
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

  // Realtime subscription for clients & uploads
  useEffect(() => {
    const channel = supabase
      .channel("clients-realtime-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, () => {
        qc.invalidateQueries({ queryKey: ["clients"] });
        qc.invalidateQueries({ queryKey: ["clients-stats"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "upload_history" }, () => {
        qc.invalidateQueries({ queryKey: ["clients"] });
        qc.invalidateQueries({ queryKey: ["clients-stats"] });
        qc.invalidateQueries({ queryKey: ["companies-lookup"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const {
    data: stats = {
      total: 0,
      verified: 0,
      pending: 0,
      natural: 0,
      institutions: 0,
      needsReview: 0,
    },
  } = useQuery({
    queryKey: ["clients-stats", companyFilter],
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      // 1. Primary: dedicated server-side aggregation RPC for instant (<50ms) single query response
      try {
        const { data: rpcStats, error: rpcErr } = await (supabase as any).rpc(
          "get_company_client_stats",
          { p_company_id: companyFilter === "all" ? null : companyFilter },
        );
        if (!rpcErr && rpcStats) {
          return {
            total: Number(rpcStats.total || 0),
            verified: Number(rpcStats.verified || 0),
            pending: Number(rpcStats.pending || 0),
            natural: Number(rpcStats.natural || 0),
            institutions: Number(rpcStats.institutions || 0),
            needsReview: Number(rpcStats.needs_review || 0),
          };
        }
      } catch (err: any) {
        console.warn("get_company_client_stats error, falling back:", err?.message);
      }

      if (companyFilter === "all") {
        const [totalRes, verifiedRes, pendingRes, naturalRes, instRes, reviewRes] =
          await Promise.all([
            (supabase as any).from("clients").select("id", { count: "exact", head: true }),
            (supabase as any)
              .from("clients")
              .select("id", { count: "exact", head: true })
              .eq("verification_status", "Verified"),
            (supabase as any)
              .from("clients")
              .select("id", { count: "exact", head: true })
              .eq("verification_status", "Pending"),
            (supabase as any)
              .from("clients")
              .select("id", { count: "exact", head: true })
              .eq("payee_classification", "NATURAL_PERSON"),
            (supabase as any)
              .from("clients")
              .select("id", { count: "exact", head: true })
              .in("payee_classification", ["COMPANY_INSTITUTION", "PUBLIC_LEGAL_PERSON"]),
            (supabase as any)
              .from("clients")
              .select("id", { count: "exact", head: true })
              .eq("needs_review", true),
          ]);

        return {
          total: totalRes.count || 0,
          verified: verifiedRes.count || 0,
          pending: pendingRes.count || 0,
          natural: naturalRes.count || 0,
          institutions: instRes.count || 0,
          needsReview: reviewRes.count || 0,
        };
      }

      // Safe fallback for selected company: fetch real counts dynamically from PostgreSQL
      try {
        const [totalRes, verifiedRes, pendingRes, naturalRes, instRes, reviewRes] =
          await Promise.all([
            (supabase as any)
              .from("clients")
              .select("id", { count: "exact", head: true })
              .eq("company_id", companyFilter),
            (supabase as any)
              .from("clients")
              .select("id", { count: "exact", head: true })
              .eq("company_id", companyFilter)
              .eq("verification_status", "Verified"),
            (supabase as any)
              .from("clients")
              .select("id", { count: "exact", head: true })
              .eq("company_id", companyFilter)
              .eq("verification_status", "Pending"),
            (supabase as any)
              .from("clients")
              .select("id", { count: "exact", head: true })
              .eq("company_id", companyFilter)
              .eq("payee_classification", "NATURAL_PERSON"),
            (supabase as any)
              .from("clients")
              .select("id", { count: "exact", head: true })
              .eq("company_id", companyFilter)
              .in("payee_classification", ["COMPANY_INSTITUTION", "PUBLIC_LEGAL_PERSON"]),
            (supabase as any)
              .from("clients")
              .select("id", { count: "exact", head: true })
              .eq("company_id", companyFilter)
              .eq("needs_review", true),
          ]);

        return {
          total: totalRes.count || 0,
          verified: verifiedRes.count || 0,
          pending: pendingRes.count || 0,
          natural: naturalRes.count || 0,
          institutions: instRes.count || 0,
          needsReview: reviewRes.count || 0,
        };
      } catch {
        return {
          total: 0,
          verified: 0,
          pending: 0,
          natural: 0,
          institutions: 0,
          needsReview: 0,
        };
      }
    },
  });

  const { data: pageData = { rows: [], count: 0 }, isLoading } = useQuery({
    queryKey: [
      "clients",
      page,
      pageSize,
      debouncedSearch,
      companyFilter,
      categoryFilter,
      statusFilter,
      verFilter,
      reviewFilter,
    ],
    queryFn: async () => {
      // Pass the unified categoryFilter key to get_clients_paginated (which handles full multi-label matching)
      const { data, error } = await (supabase as any).rpc("get_clients_paginated", {
        p_company_id: companyFilter === "all" ? null : companyFilter,
        p_holder_type: categoryFilter === "STATUTORY_FUND" ? "Tax Exempt" : categoryFilter,
        p_classification: "all",
        p_status: statusFilter,
        p_verification: verFilter,
        p_search: debouncedSearch || "",
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize,
        p_needs_review: reviewFilter,
      });

      if (error) {
        let query = (supabase as any)
          .from("clients")
          .select("*, company:companies(company_name, company_code)", { count: "exact" })
          .order("created_at", { ascending: false })
          .range((page - 1) * pageSize, page * pageSize - 1);

        if (companyFilter !== "all") query = query.eq("company_id", companyFilter);
        if (reviewFilter === "true") query = query.eq("needs_review", true);
        if (reviewFilter === "false") query = query.eq("needs_review", false);
        if (categoryFilter !== "all") {
          if (categoryFilter === "INSTITUTION") {
            query = query.or(
              "payee_classification.in.(COMPANY_INSTITUTION,PUBLIC_LEGAL_PERSON),holder_type.ilike.%Institution%,holder_type.ilike.%Legal Person%",
            );
          } else if (categoryFilter === "PUBLIC") {
            query = query.or(
              "payee_classification.eq.NATURAL_PERSON,holder_type.eq.Natural Person - Public,holder_type.eq.Public",
            );
          } else if (categoryFilter === "PROMOTER") {
            query = query.ilike("holder_type", "%Promoter%");
          } else if (categoryFilter === "LOCAL") {
            query = query.ilike("holder_type", "%Local%");
          } else if (categoryFilter === "EMPLOYEE") {
            query = query.or("holder_type.ilike.%Employee%,holder_type.ilike.%Staff%");
          } else if (categoryFilter === "MUTUAL_FUND") {
            query = query.ilike("holder_type", "%Mutual Fund%");
          } else if (categoryFilter === "STATUTORY_FUND") {
            query = query.eq("holder_type", "Tax Exempt");
          } else if (categoryFilter === "TAX_EXEMPT") {
            query = query.or(
              "payee_classification.eq.TAX_EXEMPT,holder_type.ilike.%Tax Exempt%,holder_type.ilike.%Mutual Fund%",
            );
          } else if (categoryFilter === "FOREIGN") {
            query = query.ilike("holder_type", "%Foreign%");
          }
        }
        if (statusFilter !== "all") query = query.eq("status", statusFilter as any);
        if (verFilter !== "all") query = query.eq("verification_status", verFilter as any);

        const res = await query;
        return { rows: (res.data || []) as unknown as Client[], count: res.count || 0 };
      }

      const rows = (data || []).map((r: any) => ({
        ...r,
        company:
          r.company_code || r.company_name
            ? { company_name: r.company_name || "", company_code: r.company_code || "" }
            : null,
        company_details: r.company_details || null,
      }));
      const count = data && data.length > 0 ? Number(data[0].total_count) : 0;

      return { rows: rows as unknown as Client[], count };
    },
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
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
      kitta: c.kitta != null ? String(c.kitta) : "",
      holder_type: (c.holder_type ?? "Natural Person - Public") as Holder,
      payee_classification: (c.payee_classification ?? "NATURAL_PERSON") as PayeeClassification,
      pan_no:
        c.pan_no ??
        (c.pan_or_citizenship && c.pan_or_citizenship.length === 9 ? c.pan_or_citizenship : ""),
      citizenship_no:
        c.citizenship_no ??
        (c.pan_or_citizenship && c.pan_or_citizenship.length !== 9 ? c.pan_or_citizenship : ""),
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

  const handleHolderTypeChange = (v: string) => {
    setForm((f) => {
      let pc: PayeeClassification = f.payee_classification;
      if (/Mutual Fund|Tax Exempt/i.test(v)) {
        pc = "TAX_EXEMPT";
      } else if (/Legal Person/i.test(v)) {
        pc = "COMPANY_INSTITUTION";
      } else if (/Natural Person/i.test(v)) {
        pc = "NATURAL_PERSON";
      }
      return { ...f, holder_type: v as Holder, payee_classification: pc };
    });
  };

  const upsert = useMutation({
    mutationFn: async () => {
      if (!canWrite)
        throw new Error("Unauthorized: You do not have permission to create or edit clients.");
      const panNo = form.pan_no.trim() || null;
      const citizenshipNo = form.citizenship_no.trim() || null;
      const kittaVal = form.kitta !== "" ? Number(form.kitta) : 0;
      const cleanBoid = normalizeBoid(form.boid);
      if (cleanBoid && cleanBoid.length > 20) {
        throw new Error("BOID or folio identifier cannot exceed 20 characters.");
      }
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
        boid: cleanBoid,
        kitta: kittaVal,
        holder_type: form.holder_type,
        payee_classification: form.payee_classification,
        classification_status: "CONFIRMED",
        classification_source: "manual_edit",
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
        needs_review: form.bank_account_no.trim() ? false : Boolean(editing?.needs_review),
        data_quality_notes: form.bank_account_no.trim()
          ? null
          : (editing?.data_quality_notes ?? null),
      };
      if (editing) {
        const { error } = await supabase
          .from("clients")
          .update(payload as never)
          .eq("id", editing.id);
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
      qc.invalidateQueries({ queryKey: ["dividend_payables"] });
      qc.invalidateQueries({ queryKey: ["dividend_payables_totals"] });
      qc.invalidateQueries({ queryKey: ["interest_payables"] });
      qc.invalidateQueries({ queryKey: ["interest_payables_totals"] });
      qc.invalidateQueries({ queryKey: ["mutual_fund_payables"] });
      qc.invalidateQueries({ queryKey: ["mutual_fund_payables_totals"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["all-individual-payments"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      qc.invalidateQueries({ queryKey: ["dashboard-operational-metrics"] });
      qc.invalidateQueries({ queryKey: ["live-payable-summary"] });
      qc.invalidateQueries({ queryKey: ["exceptions"] });
      toast.success(
        editing
          ? "Client updated and pending payables synchronized"
          : "Client created successfully",
      );
      setSheetOpen(false);
      setEditing(null);
    },
    onError: (e: any) => {
      toast.error(e.message || "Failed to save client");
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      if (!isAdmin) throw new Error("Unauthorized: Only administrators can delete client records.");
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
      const batchSize = 2000;
      let allData: Record<string, unknown>[] = [];
      const totalRows = pageData.count;
      const numBatches = Math.max(1, Math.ceil(totalRows / batchSize));

      let effectiveHolderType = "all";
      let effectiveClassification = "all";

      if (categoryFilter === "PUBLIC") {
        effectiveHolderType = "Natural Person - Public";
      } else if (categoryFilter === "PROMOTER") {
        effectiveHolderType = "Natural Person - Promoter";
      } else if (categoryFilter === "LOCAL") {
        effectiveHolderType = "Natural Person - Local";
      } else if (categoryFilter === "EMPLOYEE") {
        effectiveHolderType = "Natural Person - Employee";
      } else if (categoryFilter === "INSTITUTION") {
        effectiveClassification = "COMPANY_INSTITUTION";
      } else if (categoryFilter === "MUTUAL_FUND") {
        effectiveHolderType = "Mutual Fund";
      } else if (categoryFilter === "STATUTORY_FUND") {
        effectiveHolderType = "Tax Exempt";
      } else if (categoryFilter === "TAX_EXEMPT") {
        effectiveClassification = "TAX_EXEMPT";
      } else if (categoryFilter === "FOREIGN") {
        effectiveHolderType = "Foreign";
      }

      for (let i = 0; i < numBatches; i++) {
        const { data, error } = await (supabase as any).rpc("get_clients_paginated", {
          p_company_id: companyFilter === "all" ? null : companyFilter,
          p_holder_type: effectiveHolderType,
          p_classification: effectiveClassification,
          p_status: statusFilter,
          p_verification: verFilter,
          p_search: debouncedSearch || "",
          p_limit: batchSize,
          p_offset: i * batchSize,
        });

        if (error) {
          let query = (supabase as any)
            .from("clients")
            .select("*, company:companies(company_name, company_code)")
            .order("created_at", { ascending: false })
            .range(i * batchSize, (i + 1) * batchSize - 1);

          if (companyFilter !== "all") query = query.eq("company_id", companyFilter);
          if (effectiveHolderType !== "all")
            query = query.eq("holder_type", effectiveHolderType as any);
          if (effectiveClassification !== "all")
            query = query.eq("payee_classification", effectiveClassification as any);
          if (statusFilter !== "all") query = query.eq("status", statusFilter as any);
          if (verFilter !== "all") query = query.eq("verification_status", verFilter as any);
          const fallback = await query;
          if (fallback.data) allData = allData.concat(fallback.data);
        } else if (data) {
          allData = allData.concat(data);
        }
      }

      if (allData.length === 0) return toast.error("No data to export");

      exportToExcel(
        allData.map((d: any) => ({
          client_code: d.client_code,
          full_name: d.full_name,
          boid: d.boid,
          holding_kitta: d.kitta || 0,
          company_code: d.company_code || d.company?.company_code || "",
          company: d.company_name || d.company?.company_name || "",
          holder_type: d.holder_type,
          classification: d.payee_classification,
          father_name: d.father_name,
          grandfather_name: d.grandfather_name,
          date_of_birth: d.date_of_birth,
          gender: d.gender,
          occupation: d.occupation,
          pan_no:
            d.pan_no ||
            (d.pan_or_citizenship && String(d.pan_or_citizenship).length === 9
              ? d.pan_or_citizenship
              : ""),
          citizenship_no:
            d.citizenship_no ||
            (d.pan_or_citizenship && String(d.pan_or_citizenship).length !== 9
              ? d.pan_or_citizenship
              : ""),
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
        companyFilter !== "all"
          ? `clients_register_${companies.find((c) => c.id === companyFilter)?.company_code || "export"}`
          : "clients_register_all",
      );
      toast.success(`Successfully exported ${allData.length.toLocaleString()} clients`);
    } catch (e: any) {
      toast.error(e.message || "Export failed");
    }
  };

  function getClientField(row: Record<string, unknown>, ...aliases: string[]): any {
    for (const [key, val] of Object.entries(row)) {
      const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      for (const alias of aliases) {
        const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (
          cleanKey === cleanAlias &&
          val !== undefined &&
          val !== null &&
          String(val).trim() !== ""
        ) {
          return val;
        }
      }
    }
    return undefined;
  }

  function parseClientDate(val: any): string | null {
    if (!val) return null;
    if (val instanceof Date) return val.toISOString().slice(0, 10);
    if (typeof val === "number" && val > 20000 && val < 60000) {
      const d = new Date(Math.round((val - 25569) * 86400 * 1000));
      return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    const str = String(val).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : str || null;
  }

  const handleImport = async (file: File) => {
    try {
      const rows = await importFromExcel<Record<string, unknown>>(file);
      const clean = rows
        .map((r, idx) => {
          const rawCode = getClientField(
            r,
            "client_code",
            "clientcode",
            "code",
            "shareholder_no",
            "folio_no",
            "account_no",
          );
          const rawName = getClientField(
            r,
            "full_name",
            "fullname",
            "name",
            "shareholder_name",
            "client_name",
          );
          const rawBoid = getClientField(r, "boid", "demat_no", "demat", "boid_no");
          const cleanBoid = rawBoid ? normalizeBoid(rawBoid) : null;

          // If no client code provided, use BOID or generate sequential folio
          const clientCode = rawCode
            ? String(rawCode).trim()
            : cleanBoid
              ? cleanBoid
              : `CL-${Date.now().toString().slice(-6)}-${idx + 1}`;

          if (!rawName) return null;

          const pan = getClientField(r, "pan_no", "panno", "pan", "pan_number")
            ? String(getClientField(r, "pan_no", "panno", "pan", "pan_number")).trim()
            : null;
          const ctz = getClientField(
            r,
            "citizenship_no",
            "citizenshipno",
            "citizenship",
            "citizenship_number",
          )
            ? String(
                getClientField(
                  r,
                  "citizenship_no",
                  "citizenshipno",
                  "citizenship",
                  "citizenship_number",
                ),
              ).trim()
            : null;
          const legacyPanCtz = getClientField(r, "pan_or_citizenship")
            ? String(getClientField(r, "pan_or_citizenship")).trim()
            : null;

          const rawClass = getClientField(
            r,
            "payee_classification",
            "classification",
            "tax_class",
            "tax_classification",
          );
          const payeeClass = (rawClass as PayeeClassification) ?? "NATURAL_PERSON";

          const rowCompanyCode = getClientField(r, "company_code", "companycode", "company");
          const resolvedCompanyId = getClientField(r, "company_id")
            ? String(getClientField(r, "company_id")).trim()
            : rowCompanyCode
              ? (companies.find(
                  (c) => c.company_code === String(rowCompanyCode).trim().toUpperCase(),
                )?.id ?? null)
              : companyFilter !== "all"
                ? companyFilter
                : (companies[0]?.id ?? null);

          const rawKitta = getClientField(r, "kitta", "holding_kitta", "shares", "units");

          return {
            client_code: clientCode,
            company_id: resolvedCompanyId,
            client_id: getClientField(r, "client_id")
              ? String(getClientField(r, "client_id")).trim()
              : null,
            full_name: String(rawName).trim(),
            father_name: getClientField(r, "father_name", "fathername", "father")
              ? String(getClientField(r, "father_name", "fathername", "father")).trim()
              : null,
            grandfather_name: getClientField(
              r,
              "grandfather_name",
              "grandfathername",
              "grandfather",
            )
              ? String(
                  getClientField(r, "grandfather_name", "grandfathername", "grandfather"),
                ).trim()
              : null,
            date_of_birth: parseClientDate(getClientField(r, "date_of_birth", "dob")),
            gender: getClientField(r, "gender", "sex")
              ? String(getClientField(r, "gender", "sex")).trim()
              : null,
            occupation: getClientField(r, "occupation", "profession")
              ? String(getClientField(r, "occupation", "profession")).trim()
              : null,
            boid: cleanBoid,
            kitta: Math.max(0, Number(rawKitta ?? 0)),
            holder_type: (getClientField(r, "holder_type", "holdertype") as Holder) ?? null,
            payee_classification: payeeClass,
            pan_no: pan,
            citizenship_no: ctz,
            pan_or_citizenship: pan || ctz || legacyPanCtz,
            nid_number: getClientField(r, "nid_number", "nid", "national_id")
              ? String(getClientField(r, "nid_number", "nid", "national_id")).trim()
              : null,
            address: getClientField(r, "address", "location")
              ? String(getClientField(r, "address", "location")).trim()
              : null,
            province: getClientField(r, "province", "state")
              ? String(getClientField(r, "province", "state")).trim()
              : null,
            district: getClientField(r, "district")
              ? String(getClientField(r, "district")).trim()
              : null,
            municipality: getClientField(r, "municipality", "city")
              ? String(getClientField(r, "municipality", "city")).trim()
              : null,
            phone: getClientField(r, "phone", "phone_no", "mobile", "contact_no")
              ? String(getClientField(r, "phone", "phone_no", "mobile", "contact_no")).trim()
              : null,
            email: getClientField(r, "email", "email_address")
              ? String(getClientField(r, "email", "email_address")).trim()
              : null,
            bank_name: getClientField(r, "bank_name", "bankname", "bank")
              ? String(getClientField(r, "bank_name", "bankname", "bank")).trim()
              : null,
            bank_branch: getClientField(r, "bank_branch", "branch")
              ? String(getClientField(r, "bank_branch", "branch")).trim()
              : null,
            bank_account_no: getClientField(
              r,
              "bank_account_no",
              "bankaccountno",
              "account_no",
              "account_number",
            )
              ? String(
                  getClientField(
                    r,
                    "bank_account_no",
                    "bankaccountno",
                    "account_no",
                    "account_number",
                  ),
                ).trim()
              : null,
            account_type: getClientField(r, "account_type")
              ? String(getClientField(r, "account_type")).trim()
              : null,
            residency: (getClientField(r, "residency") as Residency) ?? null,
            verification_status:
              (getClientField(r, "verification_status") as Verification) ?? "Verified",
            status: (getClientField(r, "status") as Status) ?? "Active",
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (!clean.length) return toast.error("No valid client rows found in spreadsheet");

      const BATCH_SIZE = 250;
      for (let i = 0; i < clean.length; i += BATCH_SIZE) {
        const batch = clean.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
          .from("clients")
          .upsert(batch as never, { onConflict: "company_id,client_code" });
        if (error) throw error;
      }
      if (fileRef.current) fileRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["clients-stats"] });
      toast.success(`Successfully imported ${clean.length.toLocaleString()} clients`);
    } catch (e) {
      if (fileRef.current) fileRef.current.value = "";
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setNoticeTargetClient(null);
                    setNoticeDialogOpen(true);
                  }}
                  className="hover-lift border-primary/30 text-primary hover:bg-primary/5 cursor-pointer"
                  title="Send KYC & Bank Detail Update Notices via Email"
                >
                  <Mail className="mr-2 h-4 w-4" /> Send KYC Notices
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  className="hover-lift"
                >
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

      {/* KPI Stats Strip — 100% Dynamic & Interactive */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          {
            label: "Total Shareholders",
            value: stats.total,
            icon: Users,
            color: "text-primary",
            bg: "bg-primary/10",
            active: reviewFilter === "all" && categoryFilter === "all" && verFilter === "all",
            onClick: () => {
              setReviewFilter("all");
              setCategoryFilter("all");
              setVerFilter("all");
              setPage(1);
            },
          },
          {
            label: "KYC Verified",
            value: stats.verified,
            icon: ShieldCheck,
            color: "text-emerald-600",
            bg: "bg-emerald-50 dark:bg-emerald-950/30",
            active: verFilter === "Verified",
            onClick: () => {
              setVerFilter(verFilter === "Verified" ? "all" : "Verified");
              setPage(1);
            },
          },
          {
            label: "Needs Review",
            value: stats.needsReview,
            icon: AlertTriangle,
            color: "text-amber-600",
            bg:
              reviewFilter === "true"
                ? "bg-amber-100 ring-2 ring-amber-400 dark:bg-amber-950/60"
                : "bg-amber-50 dark:bg-amber-950/30",
            active: reviewFilter === "true",
            onClick: () => {
              setReviewFilter(reviewFilter === "true" ? "all" : "true");
              setPage(1);
            },
          },
          {
            label: "Pending Review",
            value: stats.pending,
            icon: Clock,
            color: "text-blue-600",
            bg: "bg-blue-50 dark:bg-blue-950/30",
            active: verFilter === "Pending",
            onClick: () => {
              setVerFilter(verFilter === "Pending" ? "all" : "Pending");
              setPage(1);
            },
          },
          {
            label: "Natural Persons",
            value: stats.natural,
            icon: User,
            color: "text-violet-600",
            bg: "bg-violet-50 dark:bg-violet-950/30",
            active: categoryFilter === "PUBLIC",
            onClick: () => {
              setCategoryFilter(categoryFilter === "PUBLIC" ? "all" : "PUBLIC");
              setPage(1);
            },
          },
          {
            label: "Institutions & Legal",
            value: stats.institutions,
            icon: Building2,
            color: "text-indigo-600",
            bg: "bg-indigo-50 dark:bg-indigo-950/30",
            active: categoryFilter === "INSTITUTION",
            onClick: () => {
              setCategoryFilter(categoryFilter === "INSTITUTION" ? "all" : "INSTITUTION");
              setPage(1);
            },
          },
        ].map((s) => (
          <Card
            key={s.label}
            className={`glass-card cursor-pointer hover:border-primary/50 transition-all ${s.active ? "border-amber-400 dark:border-amber-600 ring-1 ring-amber-400" : ""}`}
            onClick={s.onClick}
          >
            <CardContent className="flex items-center gap-3 p-3.5">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${s.bg}`}
              >
                <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-muted-foreground truncate">{s.label}</p>
                <p className={`text-xl font-bold tabular-nums ${s.color}`}>
                  {s.value.toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* RTS Walk-in Counter 360° Quick Lookup */}
      <Card className="border-primary/30 bg-primary/5 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Landmark className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">RTS Shareholder 360° Counter Lookup</h3>
                <p className="text-xs text-muted-foreground">
                  Instantly retrieve consolidated holdings, distribution history & print official
                  ledger statements.
                </p>
              </div>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCounterLookup();
              }}
              className="flex items-center gap-2 relative"
            >
              <div className="relative min-w-[280px] sm:min-w-[340px]">
                <Input
                  placeholder="Enter 16-digit BOID, PAN, Citizenship, Phone, Name..."
                  value={counterQuery}
                  onChange={(e) => {
                    setCounterQuery(e.target.value);
                    if (showCounterDropdown) setShowCounterDropdown(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setShowCounterDropdown(false);
                    }
                  }}
                  className="h-9 text-xs font-mono bg-background pr-7"
                />
                {counterQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setCounterQuery("");
                      setShowCounterDropdown(false);
                      setCounterSearchResults(null);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    title="Clear input"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}

                {/* Dropdown for multiple search results */}
                {showCounterDropdown && counterSearchResults && counterSearchResults.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-md border bg-popover text-popover-foreground shadow-lg max-h-64 overflow-y-auto p-1 text-xs">
                    <div className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground border-b flex justify-between items-center">
                      <span>Select Shareholder ({counterSearchResults.length} found)</span>
                      <button
                        type="button"
                        onClick={() => setShowCounterDropdown(false)}
                        className="hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    {counterSearchResults.map((res: any) => (
                      <div
                        key={res.id}
                        onClick={() => {
                          setShowCounterDropdown(false);
                          setSelectedStatementBoid(res.boid || res.id);
                        }}
                        className="cursor-pointer rounded px-2.5 py-2 hover:bg-accent hover:text-accent-foreground transition-colors border-b last:border-b-0"
                      >
                        <div className="flex items-center justify-between font-semibold">
                          <span>{res.full_name}</span>
                          <span className="font-mono text-[11px] text-primary">
                            {res.boid || "No BOID"}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                          {res.pan_or_citizenship && <span>PAN/ID: {res.pan_or_citizenship}</span>}
                          {res.phone && <span>Ph: {res.phone}</span>}
                          {res.company?.company_name && (
                            <span className="truncate max-w-[140px]">
                              {res.company.company_name}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={isCounterSearching}
                className="h-9 text-xs gap-1.5 shrink-0"
              >
                {isCounterSearching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                {isCounterSearching ? "Searching..." : "View 360° Statement"}
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>

      {/* Filter Toolbar */}
      <Card className="glass-card">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, code, BOID, PAN, phone, email…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>

            <Select
              value={companyFilter}
              onValueChange={(v) => {
                setCompanyFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-40 h-9">
                <SelectValue placeholder="Company" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Companies</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.company_code} — {c.company_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={reviewFilter}
              onValueChange={(v) => {
                setReviewFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-44 h-9">
                <SelectValue placeholder="Data Quality" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Records</SelectItem>
                <SelectItem value="true">⚠️ Needs Review ({stats.needsReview})</SelectItem>
                <SelectItem value="false">✓ Clean Records</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={categoryFilter}
              onValueChange={(v) => {
                setCategoryFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-52 h-9">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Shareholder Categories</SelectItem>
                <SelectItem value="PUBLIC">Public</SelectItem>
                <SelectItem value="INSTITUTION">Institution (Legal Person)</SelectItem>
                <SelectItem value="TAX_EXEMPT">Tax Exempt — 0% TDS (All Funds)</SelectItem>
                <SelectItem value="MUTUAL_FUND">↳ Mutual Fund (SEBON Scheme)</SelectItem>
                <SelectItem value="STATUTORY_FUND">
                  ↳ Statutory Pension / Retirement Fund
                </SelectItem>
                <SelectItem value="PROMOTER">Promoter</SelectItem>
                <SelectItem value="LOCAL">Local Affected</SelectItem>
                <SelectItem value="EMPLOYEE">Employee / Staff Quota</SelectItem>
                <SelectItem value="FOREIGN">Foreign</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
            >
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
                <TableHead className="font-semibold text-xs">Shareholder Name</TableHead>
                <TableHead className="font-semibold text-xs">BOID</TableHead>
                <TableHead className="text-right font-semibold text-xs">Holding (Kitta)</TableHead>
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
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-sm text-foreground">{c.full_name}</span>
                        {c.needs_review && (
                          <Badge
                            variant="outline"
                            className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700 text-[10px] gap-1 px-1.5 py-0 font-medium shrink-0"
                            title={
                              c.data_quality_notes
                                ? `Issues: ${c.data_quality_notes.replace(/_/g, " ")}`
                                : "Needs Review"
                            }
                          >
                            <AlertTriangle className="h-2.5 w-2.5" /> Needs Review
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground mt-0.5">
                        {c.father_name && <span>s/o {c.father_name}</span>}
                        {c.phone && <span>• {c.phone}</span>}
                        {c.email && (
                          <span className="text-primary font-mono text-[10px]">({c.email})</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.boid ? (
                        <button
                          type="button"
                          className="font-semibold text-primary hover:underline cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedStatementBoid(c.boid);
                          }}
                          title="Click to view full distribution & payment statement"
                        >
                          {c.boid}
                        </button>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold text-primary">
                      <div>{c.kitta ? Number(c.kitta).toLocaleString() : "—"}</div>
                      {companyFilter === "all" &&
                        c.company_details &&
                        c.company_details.length > 1 && (
                          <span
                            className="text-[10px] text-muted-foreground font-normal block cursor-help"
                            title={c.company_details
                              .map(
                                (cd) =>
                                  `${cd.company_code}: ${Number(cd.kitta || 0).toLocaleString()}`,
                              )
                              .join(" | ")}
                          >
                            Total ({c.company_details.length} co.)
                          </span>
                        )}
                    </TableCell>
                    <TableCell>
                      {classificationBadge(c.payee_classification, c.holder_type)}
                    </TableCell>
                    <TableCell>{holderBadge(c.holder_type)}</TableCell>
                    <TableCell>
                      {c.company_details && c.company_details.length > 1 ? (
                        <div className="flex flex-wrap gap-1 items-center max-w-[180px]">
                          {c.company_details.map((cd) => (
                            <Badge
                              key={cd.company_id || cd.company_code}
                              variant="secondary"
                              className="font-mono text-[10px] px-1.5 py-0 bg-primary/10 text-primary border-0 font-medium"
                              title={`${cd.company_name}: ${Number(cd.kitta || 0).toLocaleString()} kitta`}
                            >
                              {cd.company_code}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground font-medium">
                          {c.company?.company_code || c.company?.company_name || "—"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {c.pan_or_citizenship ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="text-xs font-medium">{c.bank_name ?? "—"}</div>
                      {c.bank_account_no ? (
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {c.bank_account_no}
                        </div>
                      ) : (
                        <span className="inline-flex items-center text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                          ⚠️ No Bank Account
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{verificationBadge(c.verification_status)}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {c.email &&
                          (ShareholderNoticeService.isMissingBank(c) ||
                            ShareholderNoticeService.isMissingPan(c)) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/50 cursor-pointer"
                              onClick={() => {
                                setNoticeTargetClient({
                                  id: c.id,
                                  full_name: c.full_name,
                                  boid: c.boid,
                                  email: c.email,
                                  phone: c.phone,
                                  bank_name: c.bank_name,
                                  bank_account_no: c.bank_account_no,
                                  pan_no: c.pan_no,
                                  pan_or_citizenship: c.pan_or_citizenship,
                                  citizenship_no: c.citizenship_no,
                                  company_name: c.company?.company_name,
                                  company_code: c.company?.company_code,
                                });
                                setNoticeDialogOpen(true);
                              }}
                              title="Send KYC / Bank Detail Update Notice via Email"
                            >
                              <Mail className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-primary hover:bg-primary/10 cursor-pointer"
                          onClick={() => setSelectedStatementBoid(c.boid || c.id)}
                          title="View All-Time Distribution & Payment Statement"
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 hover:bg-muted"
                          onClick={() => openEdit(c)}
                          title="Edit Shareholder"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {isAdmin && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteTarget(c)}
                            title="Delete Shareholder (Admin Only)"
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

        {/* Pagination Bar */}
        <div className="flex items-center justify-between border-t px-4 py-3 bg-muted/10">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Rows per page:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPage(1);
              }}
            >
              <SelectTrigger className="h-7 w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">
              {pageData.count === 0
                ? "0"
                : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, pageData.count)}`}{" "}
              of {pageData.count.toLocaleString()}
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
      <Sheet
        open={sheetOpen}
        onOpenChange={(o) => {
          setSheetOpen(o);
          if (!o) setEditing(null);
        }}
      >
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
            {editing?.needs_review && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5 mt-4">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-amber-900 dark:text-amber-100">
                    Flagged for Data Quality Review
                  </div>
                  <div className="mt-0.5 text-muted-foreground leading-relaxed">
                    {editing.data_quality_notes
                      ? `Issue: ${editing.data_quality_notes.replace(/;/g, ",").replace(/_/g, " ")}.`
                      : "This record was flagged during upload or audit due to missing bank or identity details."}{" "}
                    Entering the bank account number or correcting identity details and clicking
                    Save will clear this review flag.
                  </div>
                </div>
              </div>
            )}

            {editing &&
              editing.email &&
              (ShareholderNoticeService.isMissingBank(editing) ||
                ShareholderNoticeService.isMissingPan(editing)) && (
                <div className="rounded-lg border border-blue-200 bg-blue-50/70 dark:bg-blue-950/40 p-3 text-xs text-blue-900 dark:text-blue-200 flex items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <Mail className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-blue-950 dark:text-blue-100">
                        Missing Details with Registered Email ({editing.email})
                      </div>
                      <div className="text-[11px] text-blue-700 dark:text-blue-300 leading-relaxed mt-0.5">
                        {ShareholderNoticeService.isMissingBank(editing) &&
                        ShareholderNoticeService.isMissingPan(editing)
                          ? "Shareholder lacks both Bank Account details and PAN number."
                          : ShareholderNoticeService.isMissingBank(editing)
                            ? "Shareholder lacks verified Bank Account details for ConnectIPS."
                            : "Shareholder lacks a registered 9-digit PAN number for tax credit."}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 border-blue-300 shrink-0 gap-1.5 cursor-pointer hover:bg-blue-100/50"
                    onClick={() => {
                      setNoticeTargetClient({
                        id: editing.id,
                        full_name: editing.full_name,
                        boid: editing.boid,
                        email: editing.email,
                        phone: editing.phone,
                        bank_name: editing.bank_name,
                        bank_account_no: editing.bank_account_no,
                        pan_no: editing.pan_no,
                        pan_or_citizenship: editing.pan_or_citizenship,
                        citizenship_no: editing.citizenship_no,
                        company_name: editing.company?.company_name,
                        company_code: editing.company?.company_code,
                      });
                      setNoticeDialogOpen(true);
                    }}
                  >
                    <Mail className="h-3.5 w-3.5" /> Send Notice
                  </Button>
                </div>
              )}

            {/* Portfolio & Company Holdings */}
            {editing?.company_details && editing.company_details.length > 0 && (
              <div className="rounded-lg border bg-muted/40 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <Building2 className="h-4 w-4 text-primary" />
                    <span>
                      Company Holdings & Portfolio ({editing.company_details.length} Companies)
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px] text-primary hover:bg-primary/10 px-2 gap-1 cursor-pointer"
                    onClick={() => {
                      if (editing.boid) setSelectedStatementBoid(editing.boid);
                      else setSelectedStatementBoid(editing.id);
                    }}
                  >
                    <FileText className="h-3 w-3" /> View Consolidated Statement
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {editing.company_details.map((cd) => (
                    <div
                      key={cd.company_id || cd.company_code}
                      className="rounded-md border bg-card p-2.5 flex items-center justify-between text-xs shadow-xs"
                    >
                      <div className="min-w-0 pr-2">
                        <Badge
                          variant="outline"
                          className="font-mono font-semibold text-primary px-1.5 py-0 mb-0.5"
                        >
                          {cd.company_code}
                        </Badge>
                        <span
                          className="text-muted-foreground text-[11px] block truncate"
                          title={cd.company_name}
                        >
                          {cd.company_name}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-mono font-bold text-foreground">
                          {Number(cd.kitta || 0).toLocaleString()}
                        </span>
                        <span className="text-[10px] text-muted-foreground block">kitta</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Identity */}
            <SectionLabel icon={User}>Identity & Demographics</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>
                  Client Code <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={form.client_code}
                  onChange={(e) => setF("client_code", e.target.value)}
                  placeholder="e.g. C001234"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>BOID (16 Digits)</Label>
                  {form.boid && form.boid.length > 0 && form.boid.length < 16 && (
                    <span className="text-[10px] text-amber-600 font-mono">
                      {form.boid.length}/16 (will auto-pad)
                    </span>
                  )}
                  {form.boid && form.boid.length === 16 && (
                    <span className="text-[10px] text-emerald-600 font-mono">✓ 16 digits</span>
                  )}
                </div>
                <Input
                  value={form.boid}
                  onChange={(e) => {
                    const clean = e.target.value.replace(/[^0-9A-Za-z]/g, "").slice(0, 16);
                    setF("boid", clean);
                  }}
                  placeholder="13010200..."
                  maxLength={16}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Linked Company</Label>
                <Select value={form.company_id} onValueChange={(v) => setF("company_id", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="— None —" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60 overflow-y-auto">
                    <SelectItem value="">— None —</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.company_code} — {c.company_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>
                  Full Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={form.full_name}
                  onChange={(e) => setF("full_name", e.target.value)}
                  placeholder="As per citizenship / PAN"
                />
              </div>
              <div className="space-y-1.5">
                <Label>PAN Number (Permanent Account No)</Label>
                <Input
                  value={form.pan_no}
                  onChange={(e) => setF("pan_no", e.target.value)}
                  placeholder="9-digit PAN (e.g. 102938475)"
                  maxLength={15}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Citizenship Number</Label>
                <Input
                  value={form.citizenship_no}
                  onChange={(e) => setF("citizenship_no", e.target.value)}
                  placeholder="e.g. 27-01-75-01234"
                />
              </div>
              <div className="space-y-1.5">
                <Label>NID Number (National ID)</Label>
                <Input
                  value={form.nid_number}
                  onChange={(e) => setF("nid_number", e.target.value)}
                  placeholder="10-digit NID Number"
                  maxLength={15}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Date of Birth (BS / AD)</Label>
                <Input
                  value={form.date_of_birth}
                  onChange={(e) => setF("date_of_birth", e.target.value)}
                  placeholder="YYYY-MM-DD"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Gender</Label>
                <Select value={form.gender} onValueChange={(v) => setF("gender", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select Gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other / Entity</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Occupation</Label>
                <Input
                  value={form.occupation}
                  onChange={(e) => setF("occupation", e.target.value)}
                  placeholder="e.g. Service / Business"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Father's Name</Label>
                <Input
                  value={form.father_name}
                  onChange={(e) => setF("father_name", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Grandfather's Name</Label>
                <Input
                  value={form.grandfather_name}
                  onChange={(e) => setF("grandfather_name", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Residency</Label>
                <Select value={form.residency} onValueChange={(v) => setF("residency", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Resident">Resident</SelectItem>
                    <SelectItem value="Non-Resident">Non-Resident</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Classification */}
            <SectionLabel icon={Percent}>Tax Classification & Holding Units</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Holding (Kitta / Shares / Units)</Label>
                <Input
                  type="number"
                  value={form.kitta}
                  onChange={(e) => setF("kitta", e.target.value)}
                  placeholder="e.g. 500"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tax Classification (TDS Rate)</Label>
                <Select
                  value={form.payee_classification}
                  onValueChange={(v) => setF("payee_classification", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NATURAL_PERSON">
                      Natural Person (Public) — 5% Div / 6% Deb
                    </SelectItem>
                    <SelectItem value="PUBLIC_LEGAL_PERSON">
                      Public Legal Person (Semi-Govt / Statutory Body) — 5% Div / 6% Deb
                    </SelectItem>
                    <SelectItem value="COMPANY_INSTITUTION">
                      Legal Person (Institution / Company) — 5% Div / 15% Deb
                    </SelectItem>
                    <SelectItem value="TAX_EXEMPT">
                      Tax Exempted (Mutual Fund / Retirement) — 0% TDS
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Holder Type (Segment)</Label>
                <Select value={form.holder_type} onValueChange={handleHolderTypeChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Natural Person - Public">Public (Natural Person)</SelectItem>
                    <SelectItem value="Natural Person - Local">Local Affected</SelectItem>
                    <SelectItem value="Natural Person - Employee">
                      Employee / Staff Quota
                    </SelectItem>
                    <SelectItem value="Natural Person - Promoter">
                      Promoter (Natural Person)
                    </SelectItem>
                    <SelectItem value="Legal Person">
                      Institution (Legal Person / Corporate)
                    </SelectItem>
                    <SelectItem value="Legal Person - Promoter">
                      Promoter (Legal Person / Corporate)
                    </SelectItem>
                    <SelectItem value="Mutual Fund">Mutual Fund (Tax Exempt)</SelectItem>
                    <SelectItem value="Foreign">Foreign / Non-Resident</SelectItem>
                    <SelectItem value="Tax Exempt">Tax Exempt (Statutory / Pension)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-md border border-primary/20 bg-primary/5 p-2.5 text-xs text-muted-foreground flex items-center gap-2">
              <Percent className="h-4 w-4 text-primary shrink-0" />
              <span>
                <strong>Automatic Tax Sync:</strong> Updating Tax Classification immediately
                recomputes TDS tax and net payable on all pending payables for this shareholder
                across Dividend, Interest, and Mutual Fund modules.
              </span>
            </div>

            {/* Address & Contact */}
            <SectionLabel icon={MapPin}>Address & Contact Details</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-3">
                <Label>Full Address</Label>
                <Input
                  value={form.address}
                  onChange={(e) => setF("address", e.target.value)}
                  placeholder="Street, Ward No., Area"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Province</Label>
                <Input
                  value={form.province}
                  onChange={(e) => setF("province", e.target.value)}
                  placeholder="e.g. Bagmati"
                />
              </div>
              <div className="space-y-1.5">
                <Label>District</Label>
                <Input
                  value={form.district}
                  onChange={(e) => setF("district", e.target.value)}
                  placeholder="e.g. Kathmandu"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Municipality / Local Body</Label>
                <Input
                  value={form.municipality}
                  onChange={(e) => setF("municipality", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone / Mobile</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setF("phone", e.target.value)}
                  placeholder="+977-98..."
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Email Address</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setF("email", e.target.value)}
                  placeholder="investor@example.com"
                />
              </div>
            </div>

            {/* Bank Details */}
            <SectionLabel icon={Landmark}>Banking Details for Distribution</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Bank Name</Label>
                <Input
                  value={form.bank_name}
                  onChange={(e) => setF("bank_name", e.target.value)}
                  placeholder="e.g. Nabil Bank"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Branch</Label>
                <Input
                  value={form.bank_branch}
                  onChange={(e) => setF("bank_branch", e.target.value)}
                  placeholder="Branch name"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Account Type</Label>
                <Input
                  placeholder="Saving / Current"
                  value={form.account_type}
                  onChange={(e) => setF("account_type", e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label>Account Number</Label>
                <Input
                  value={form.bank_account_no}
                  onChange={(e) => setF("bank_account_no", e.target.value)}
                  className="font-mono"
                  placeholder="Bank account number"
                />
              </div>
            </div>

            {/* Status */}
            <SectionLabel icon={ShieldCheck}>Compliance & Status</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Verification Status</Label>
                <Select
                  value={form.verification_status}
                  onValueChange={(v) => setF("verification_status", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
              onClick={() => {
                setSheetOpen(false);
                setEditing(null);
              }}
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
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!del.isPending && !o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Shareholder Record
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.full_name}</strong> (
              {deleteTarget?.client_code})? This action will permanently remove this shareholder
              record.
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

      {/* Shareholder Multi-Year Statement Dialog */}
      <ShareholderStatementDialog
        boid={selectedStatementBoid}
        open={!!selectedStatementBoid}
        onOpenChange={(open) => {
          if (!open) setSelectedStatementBoid(null);
        }}
      />

      {/* Shareholder Missing Details KYC/Bank Notice Dialog */}
      <ShareholderNoticeDialog
        open={noticeDialogOpen}
        onOpenChange={setNoticeDialogOpen}
        client={noticeTargetClient}
        defaultCompanyId={companyFilter !== "all" ? companyFilter : undefined}
        onNoticeSent={() => {
          qc.invalidateQueries({ queryKey: ["clients"] });
        }}
      />
    </div>
  );
}
