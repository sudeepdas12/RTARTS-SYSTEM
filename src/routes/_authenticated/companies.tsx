import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useDebounce } from "@/hooks/use-debounce";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
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
  ShieldCheck,
  Percent,
  Loader2,
  Eye,
  Users,
  Coins,
  Mail,
  Phone,
  Globe,
  MapPin,
  ExternalLink,
  Layers,
  Calendar,
  CheckCircle2,
  Landmark,
  Clock,
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
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  status: Status;
  created_at: string;
}

interface CompanyLiveStats {
  clients: number;
  dividends: number;
  interests: number;
  mutualFunds: number;
  totalPayables: number;
}

const emptyForm = {
  company_code: "",
  company_name: "",
  company_type: "",
  isin: "",
  sector_type: "Public" as Sector,
  registrar: "RBB Merchant Banking Limited",
  fiscal_year: "2081/82",
  dividend_rate: "",
  debenture_rate: "",
  coupon_rate: "",
  maturity_date: "",
  face_value: "100",
  issue_size: "",
  interest_tax_status: "" as TaxStatus | "",
  pan_no: "",
  bank_name: "",
  bank_account_no: "",
  email: "",
  phone: "",
  website: "",
  address: "",
  status: "Active" as Status,
};

const num = (v: string) => (v === "" || isNaN(Number(v)) ? null : Number(v));

function SectionLabel({
  icon: Icon,
  children,
}: {
  icon?: React.ElementType;
  children: React.ReactNode;
}) {
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
      return (
        <Badge
          variant="secondary"
          className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-0 text-xs"
        >
          Public
        </Badge>
      );
    case "Private":
      return (
        <Badge
          variant="secondary"
          className="bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-0 text-xs"
        >
          Private
        </Badge>
      );
    case "Institution":
      return (
        <Badge
          variant="secondary"
          className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs"
        >
          Institution
        </Badge>
      );
    case "Government":
      return (
        <Badge
          variant="secondary"
          className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-xs"
        >
          Government
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-xs">
          {s || "—"}
        </Badge>
      );
  }
}

function CompaniesPage() {
  const { hasAny, isAdmin } = useAuth();
  const canWrite = hasAny(["admin", "finance_operator"]);
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [sectorFilter, setSectorFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);
  const [selectedCompanyForSheet, setSelectedCompanyForSheet] = useState<Company | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Master companies list
  const { data = [], isLoading } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .order("company_name", { ascending: true });
      if (error) throw error;
      return (data || []) as Company[];
    },
  });

  // Total managed shareholders across the entire RTA/RTS registry
  const { data: totalShareholdersCount = 0 } = useQuery({
    queryKey: ["companies-total-shareholders-count"],
    staleTime: 30_000,
    queryFn: async () => {
      const { count, error } = await (supabase.from("clients") as any).select("id", {
        count: "exact",
        head: true,
      });
      if (error) throw error;
      return count || 0;
    },
  });

  // Live per-company aggregated metrics (Shareholders, Payables across Dividend, Interest, Mutual Funds)
  const companyIds = useMemo(() => data.map((c) => c.id), [data]);

  const { data: liveStats = {}, isLoading: isLoadingLiveStats } = useQuery<
    Record<string, CompanyLiveStats>
  >({
    queryKey: ["companies-live-stats", companyIds],
    enabled: companyIds.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const statsMap: Record<string, CompanyLiveStats> = {};
      await Promise.all(
        companyIds.map(async (id) => {
          const [cRes, dRes, iRes, mRes] = await Promise.all([
            (supabase.from("clients") as any)
              .select("id", { count: "exact", head: true })
              .eq("company_id", id),
            (supabase.from("dividend_payables") as any)
              .select("id", { count: "exact", head: true })
              .eq("company_id", id),
            (supabase.from("interest_payables") as any)
              .select("id", { count: "exact", head: true })
              .eq("company_id", id),
            (supabase as any)
              .from("mutual_fund_payables")
              .select("id", { count: "exact", head: true })
              .eq("company_id", id),
          ]);
          const clients = cRes.count || 0;
          const dividends = dRes.count || 0;
          const interests = iRes.count || 0;
          const mutualFunds = mRes.count || 0;
          statsMap[id] = {
            clients,
            dividends,
            interests,
            mutualFunds,
            totalPayables: dividends + interests + mutualFunds,
          };
        }),
      );
      return statsMap;
    },
  });

  // Extract unique company types for dropdown filtering
  const companyTypes = useMemo(() => {
    const set = new Set<string>();
    data.forEach((c) => {
      if (c.company_type && c.company_type.trim()) {
        set.add(c.company_type.trim());
      }
    });
    return Array.from(set).sort();
  }, [data]);

  // Overall KPI Statistics Strip
  const stats = useMemo(() => {
    const total = data.length;
    const active = data.filter((c) => c.status === "Active").length;
    const inactive = total - active;

    // Total issued units across active companies
    const totalUnits = data.reduce((acc, c) => acc + (Number(c.issue_size) || 0), 0);

    // Total nominal capital (Face Value * Issue Size)
    const totalNominalCapital = data.reduce((acc, c) => {
      const face = Number(c.face_value) || 100;
      const size = Number(c.issue_size) || 0;
      return acc + face * size;
    }, 0);

    // Entities with active corporate schemes
    const withSchemes = data.filter((c) => {
      const pCount = liveStats[c.id]?.totalPayables ?? 0;
      const hasRate =
        (c.dividend_rate && c.dividend_rate > 0) ||
        (c.coupon_rate && c.coupon_rate > 0) ||
        (c.debenture_rate && c.debenture_rate > 0);
      return pCount > 0 || hasRate;
    }).length;

    const totalPayablesCount = Object.values(liveStats).reduce(
      (acc, curr) => acc + curr.totalPayables,
      0,
    );

    return {
      total,
      active,
      inactive,
      totalShareholders: totalShareholdersCount,
      totalUnits,
      totalNominalCapital,
      withSchemes,
      totalPayablesCount,
    };
  }, [data, liveStats, totalShareholdersCount]);

  // Filtered companies list
  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    return data.filter((c) => {
      const matchesSearch =
        !q ||
        c.company_name.toLowerCase().includes(q) ||
        c.company_code.toLowerCase().includes(q) ||
        (c.isin ?? "").toLowerCase().includes(q) ||
        (c.pan_no ?? "").toLowerCase().includes(q) ||
        (c.company_type ?? "").toLowerCase().includes(q) ||
        (c.bank_name ?? "").toLowerCase().includes(q);

      const matchesSector = sectorFilter === "all" || c.sector_type === sectorFilter;
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;
      const matchesType = typeFilter === "all" || c.company_type === typeFilter;

      return matchesSearch && matchesSector && matchesStatus && matchesType;
    });
  }, [data, debouncedSearch, sectorFilter, statusFilter, typeFilter]);

  const startEdit = useCallback((c: Company) => {
    setEditing(c);
    setForm({
      company_code: c.company_code,
      company_name: c.company_name,
      company_type: c.company_type ?? "",
      isin: c.isin ?? "",
      sector_type: (c.sector_type ?? "Public") as Sector,
      registrar: c.registrar ?? "RBB Merchant Banking Limited",
      fiscal_year: c.fiscal_year ?? "",
      dividend_rate: c.dividend_rate != null ? c.dividend_rate.toString() : "",
      debenture_rate: c.debenture_rate != null ? c.debenture_rate.toString() : "",
      coupon_rate: c.coupon_rate != null ? c.coupon_rate.toString() : "",
      maturity_date: c.maturity_date ?? "",
      face_value: c.face_value != null ? c.face_value.toString() : "100",
      issue_size: c.issue_size != null ? c.issue_size.toString() : "",
      interest_tax_status: (c.interest_tax_status ?? "") as TaxStatus | "",
      pan_no: c.pan_no ?? "",
      bank_name: c.bank_name ?? "",
      bank_account_no: c.bank_account_no ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      website: c.website ?? "",
      address: c.address ?? "",
      status: c.status,
    });
    setOpen(true);
  }, []);

  const upsert = useMutation({
    mutationFn: async () => {
      if (!canWrite)
        throw new Error("Unauthorized: You do not have permission to create or edit companies.");
      const compType = form.company_type.trim().toLowerCase();
      const defaultFace = compType.includes("debenture")
        ? 1000
        : compType.includes("mutual fund")
          ? 10
          : 100;

      const payload = {
        company_code: form.company_code.trim().toUpperCase(),
        company_name: form.company_name.trim(),
        company_type: form.company_type.trim() || null,
        isin: form.isin.trim() || null,
        sector_type: form.sector_type,
        registrar: form.registrar.trim() || "RBB Merchant Banking Limited",
        fiscal_year: form.fiscal_year.trim() || null,
        dividend_rate: num(form.dividend_rate),
        debenture_rate: num(form.debenture_rate),
        coupon_rate: num(form.coupon_rate),
        maturity_date: form.maturity_date.trim() || null,
        face_value: num(form.face_value) ?? defaultFace,
        issue_size: num(form.issue_size),
        interest_tax_status: (form.interest_tax_status || null) as TaxStatus | null,
        pan_no: form.pan_no.trim() || null,
        bank_name: form.bank_name.trim() || null,
        bank_account_no: form.bank_account_no.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        website: form.website.trim() || null,
        address: form.address.trim() || null,
        status: form.status,
      };

      if (editing) {
        const { error } = await supabase.from("companies").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("companies").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["companies-lookup"] });
      qc.invalidateQueries({ queryKey: ["companies-live-stats"] });
      qc.invalidateQueries({ queryKey: ["dashboard-companies"] });
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
      if (!isAdmin)
        throw new Error("Unauthorized: Only administrators can delete company records.");
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
      qc.invalidateQueries({ queryKey: ["companies-live-stats"] });
      qc.invalidateQueries({ queryKey: ["companies-total-shareholders-count"] });
      qc.invalidateQueries({ queryKey: ["dashboard-companies"] });
      qc.invalidateQueries({ queryKey: ["report-companies"] });
      qc.invalidateQueries({ queryKey: ["agm-companies-list"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      qc.invalidateQueries({ queryKey: ["dashboard-operational-metrics"] });
      qc.invalidateQueries({ queryKey: ["company-fiscal-summary"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["clients-stats"] });
      qc.invalidateQueries({ queryKey: ["dividend_payables"] });
      qc.invalidateQueries({ queryKey: ["interest_payables"] });
      qc.invalidateQueries({ queryKey: ["mutual_fund_payables"] });
      qc.invalidateQueries({ queryKey: ["live-payable-summary"] });
      qc.invalidateQueries({ queryKey: ["upload-history"] });
      toast.success("Company and all associated records deleted successfully");
      setDeleteTarget(null);
      if (selectedCompanyForSheet?.id === deleteTarget?.id) {
        setSelectedCompanyForSheet(null);
      }
    },
    onError: (e: Error) => toast.error(`Delete failed: ${e.message}`),
  });

  const columns: ColumnDef<Company>[] = useMemo(
    () => [
      {
        accessorKey: "company_code",
        header: "Code",
        cell: ({ row }) => (
          <span className="font-mono text-xs font-bold bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded">
            {row.original.company_code}
          </span>
        ),
      },
      {
        accessorKey: "company_name",
        header: "Company Name",
        cell: ({ row }) => (
          <div>
            <div className="font-semibold text-sm text-foreground hover:text-primary transition-colors">
              {row.original.company_name}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
              {row.original.company_type && <span>{row.original.company_type}</span>}
              {row.original.fiscal_year && (
                <>
                  <span>•</span>
                  <span className="font-mono">{row.original.fiscal_year}</span>
                </>
              )}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "isin",
        header: "ISIN / PAN",
        cell: ({ row }) => (
          <div className="space-y-0.5 text-xs font-mono">
            <div className="text-foreground font-medium">{row.original.isin || "—"}</div>
            {row.original.pan_no && (
              <div className="text-[11px] text-muted-foreground">PAN: {row.original.pan_no}</div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "sector_type",
        header: "Sector",
        cell: ({ row }) => sectorBadge(row.original.sector_type),
      },
      {
        id: "shareholders",
        header: "Shareholders",
        cell: ({ row }) => {
          const compStats = liveStats[row.original.id];
          const count = compStats?.clients;
          return (
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <Link
                to="/clients"
                search={{ companyId: row.original.id } as any}
                className="font-mono text-xs font-semibold text-primary hover:underline"
                title={`View all ${count !== undefined ? count.toLocaleString() : 0} shareholders`}
              >
                {count !== undefined ? count.toLocaleString() : "…"}
              </Link>
            </div>
          );
        },
      },
      {
        id: "distributions",
        header: "Payables & Schemes",
        cell: ({ row }) => {
          const compStats = liveStats[row.original.id];
          const total = compStats?.totalPayables;
          return (
            <div className="text-xs">
              <span className="font-mono font-medium text-foreground">
                {total !== undefined ? `${total.toLocaleString()} records` : "…"}
              </span>
              {total && total > 0 ? (
                <div className="text-[10px] text-muted-foreground flex gap-1.5">
                  {compStats.dividends > 0 && (
                    <span>Div: {compStats.dividends.toLocaleString()}</span>
                  )}
                  {compStats.interests > 0 && (
                    <span>Int: {compStats.interests.toLocaleString()}</span>
                  )}
                  {compStats.mutualFunds > 0 && (
                    <span>MF: {compStats.mutualFunds.toLocaleString()}</span>
                  )}
                </div>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "face_value",
        header: "Face Value",
        cell: ({ row }) => (
          <span className="text-xs tabular-nums font-medium">
            {row.original.face_value != null
              ? `Rs. ${Number(row.original.face_value).toLocaleString()}`
              : "—"}
          </span>
        ),
      },
      {
        accessorKey: "issue_size",
        header: "Issued Units",
        cell: ({ row }) => (
          <span className="text-xs tabular-nums font-mono font-medium text-foreground">
            {row.original.issue_size != null
              ? Number(row.original.issue_size).toLocaleString()
              : "—"}
          </span>
        ),
      },
      {
        id: "rates",
        header: "Return Rates",
        cell: ({ row }) => (
          <div className="space-y-0.5 text-xs tabular-nums">
            {row.original.dividend_rate != null && (
              <div className="text-emerald-600 font-medium">Div: {row.original.dividend_rate}%</div>
            )}
            {row.original.debenture_rate != null && (
              <div className="text-blue-600 font-medium">Deb: {row.original.debenture_rate}%</div>
            )}
            {row.original.coupon_rate != null && (
              <div className="text-indigo-600 font-medium">Cpn: {row.original.coupon_rate}%</div>
            )}
            {row.original.dividend_rate == null &&
              row.original.debenture_rate == null &&
              row.original.coupon_rate == null && <span className="text-muted-foreground">—</span>}
          </div>
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
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-0 text-xs"
                : "text-xs"
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
          <div className="flex items-center gap-1 justify-end">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 hover:bg-muted text-primary"
              onClick={() => setSelectedCompanyForSheet(row.original)}
              title="View 360° Company Profile"
            >
              <Eye className="h-4 w-4" />
            </Button>
            {canWrite && (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 hover:bg-muted"
                onClick={() => startEdit(row.original)}
                title="Edit Company Details"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {isAdmin && (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive hover:bg-destructive/10"
                onClick={() => setDeleteTarget(row.original)}
                title="Delete Company (Admin Only)"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [canWrite, isAdmin, liveStats, startEdit],
  );

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
        email: c.email,
        phone: c.phone,
        website: c.website,
        address: c.address,
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
        .map((r) => {
          const compType = r.company_type ? String(r.company_type).trim().toLowerCase() : "";
          const defaultFace = compType.includes("debenture")
            ? 1000
            : compType.includes("mutual fund")
              ? 10
              : 100;
          return {
            company_code: String(r.company_code).trim().toUpperCase(),
            company_name: String(r.company_name).trim(),
            company_type: r.company_type ? String(r.company_type).trim() : null,
            isin: r.isin ? String(r.isin).trim() : null,
            listed_date: r.listed_date ? String(r.listed_date) : null,
            sector_type: (r.sector_type as Sector) ?? null,
            registrar: r.registrar ? String(r.registrar).trim() : "RBB Merchant Banking Limited",
            fiscal_year: r.fiscal_year ? String(r.fiscal_year).trim() : null,
            dividend_rate:
              r.dividend_rate !== undefined && r.dividend_rate !== ""
                ? Number(r.dividend_rate)
                : null,
            debenture_rate:
              r.debenture_rate !== undefined && r.debenture_rate !== ""
                ? Number(r.debenture_rate)
                : null,
            coupon_rate:
              r.coupon_rate !== undefined && r.coupon_rate !== "" ? Number(r.coupon_rate) : null,
            maturity_date: r.maturity_date ? String(r.maturity_date) : null,
            face_value:
              r.face_value !== undefined && r.face_value !== ""
                ? Number(r.face_value)
                : defaultFace,
            issue_size:
              r.issue_size !== undefined && r.issue_size !== "" ? Number(r.issue_size) : null,
            interest_tax_status: (r.interest_tax_status as TaxStatus) ?? null,
            pan_no: r.pan_no ? String(r.pan_no).trim() : null,
            bank_account_no: r.bank_account_no ? String(r.bank_account_no).trim() : null,
            bank_name: r.bank_name ? String(r.bank_name).trim() : null,
            email: r.email ? String(r.email).trim() : null,
            phone: r.phone ? String(r.phone).trim() : null,
            website: r.website ? String(r.website).trim() : null,
            address: r.address ? String(r.address).trim() : null,
            status: r.status
              ? ((String(r.status).trim().charAt(0).toUpperCase() +
                  String(r.status).trim().slice(1).toLowerCase()) as Status)
              : "Active",
          };
        });
      if (!clean.length) return toast.error("No valid company rows found");
      const { error } = await supabase
        .from("companies")
        .upsert(clean as never, { onConflict: "company_code" });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["companies-lookup"] });
      qc.invalidateQueries({ queryKey: ["companies-live-stats"] });
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  className="hover-lift"
                >
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

      {/* KPI Stats Strip — 100% Dynamic from Database */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "Total Registered Entities",
            value: stats.total.toLocaleString(),
            sub: `${stats.active} Active · ${stats.inactive} Inactive`,
            icon: Building2,
            color: "text-primary",
            bg: "bg-primary/10",
          },
          {
            label: "Managed Shareholders",
            value: stats.totalShareholders.toLocaleString(),
            sub: `Across ${stats.active} live portfolios`,
            icon: Users,
            color: "text-emerald-600",
            bg: "bg-emerald-50 dark:bg-emerald-950/30",
          },
          {
            label: "Total Capital / Units",
            value:
              stats.totalUnits > 0
                ? stats.totalUnits >= 10_000_000
                  ? `${(stats.totalUnits / 10_000_000).toFixed(2)} Cr Kitta`
                  : `${(stats.totalUnits / 100_000).toFixed(2)} Lakh Kitta`
                : "—",
            sub:
              stats.totalNominalCapital > 0
                ? `Nominal: NPR ${(stats.totalNominalCapital / 100_000_000).toFixed(2)} Arba`
                : "Nominal capital tracking",
            icon: Coins,
            color: "text-blue-600",
            bg: "bg-blue-50 dark:bg-blue-950/30",
          },
          {
            label: "Corporate Schemes",
            value: `${stats.withSchemes} Active`,
            sub: `${stats.totalPayablesCount.toLocaleString()} payable records`,
            icon: TrendingUp,
            color: "text-violet-600",
            bg: "bg-violet-50 dark:bg-violet-950/30",
          },
        ].map((s) => (
          <Card key={s.label} className="glass-card shadow-xs">
            <CardContent className="flex items-center gap-3 p-4">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${s.bg}`}
              >
                <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground truncate">{s.label}</p>
                <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">{s.sub}</p>
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
                placeholder="Search by code, company name, ISIN, PAN, bank…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Company Type Filter */}
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-40 h-9">
                <SelectValue placeholder="Company Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {companyTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Sector Filter */}
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

            {/* Status Filter */}
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

          <PaginatedTable
            columns={columns}
            data={filtered}
            pageSize={10}
            onRowClick={(company) => setSelectedCompanyForSheet(company)}
          />
        </CardContent>
      </Card>

      {/* 360° Company Profile Sheet (Inspector Drawer) */}
      <Sheet
        open={!!selectedCompanyForSheet}
        onOpenChange={(open) => {
          if (!open) setSelectedCompanyForSheet(null);
        }}
      >
        <SheetContent className="w-full sm:max-w-xl md:max-w-2xl overflow-y-auto p-0 flex flex-col">
          {selectedCompanyForSheet && (
            <div className="flex flex-col h-full">
              <SheetHeader className="p-6 pb-4 border-b bg-muted/20">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs font-bold bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded">
                        {selectedCompanyForSheet.company_code}
                      </span>
                      {sectorBadge(selectedCompanyForSheet.sector_type)}
                      <Badge
                        variant={
                          selectedCompanyForSheet.status === "Active" ? "default" : "secondary"
                        }
                        className={
                          selectedCompanyForSheet.status === "Active"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-0"
                            : ""
                        }
                      >
                        {selectedCompanyForSheet.status}
                      </Badge>
                    </div>
                    <SheetTitle className="text-xl font-bold">
                      {selectedCompanyForSheet.company_name}
                    </SheetTitle>
                    <SheetDescription className="mt-1 flex items-center gap-2">
                      <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{selectedCompanyForSheet.company_type || "Corporate Issuer"}</span>
                      {selectedCompanyForSheet.fiscal_year && (
                        <>
                          <span>•</span>
                          <span className="font-mono">
                            FY {selectedCompanyForSheet.fiscal_year}
                          </span>
                        </>
                      )}
                    </SheetDescription>
                  </div>
                </div>

                {/* Quick Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t">
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/clients" search={{ companyId: selectedCompanyForSheet.id } as any}>
                      <Users className="mr-1.5 h-4 w-4 text-emerald-600" />
                      View Shareholders (
                      {liveStats[selectedCompanyForSheet.id]?.clients?.toLocaleString() ?? 0})
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const c = selectedCompanyForSheet;
                      setSelectedCompanyForSheet(null);
                      startEdit(c);
                    }}
                  >
                    <Pencil className="mr-1.5 h-4 w-4 text-blue-600" />
                    Edit Company
                  </Button>
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* 1. Live Operational Statistics */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <TrendingUp className="h-4 w-4 text-primary" /> Live Registry Portfolio Status
                  </h4>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg border bg-card p-3 shadow-2xs">
                      <p className="text-[11px] text-muted-foreground">Shareholders</p>
                      <p className="text-lg font-bold font-mono text-primary mt-0.5">
                        {liveStats[selectedCompanyForSheet.id]?.clients?.toLocaleString() ?? "0"}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-card p-3 shadow-2xs">
                      <p className="text-[11px] text-muted-foreground">Dividend Records</p>
                      <p className="text-lg font-bold font-mono text-emerald-600 mt-0.5">
                        {liveStats[selectedCompanyForSheet.id]?.dividends?.toLocaleString() ?? "0"}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-card p-3 shadow-2xs">
                      <p className="text-[11px] text-muted-foreground">Debenture Records</p>
                      <p className="text-lg font-bold font-mono text-blue-600 mt-0.5">
                        {liveStats[selectedCompanyForSheet.id]?.interests?.toLocaleString() ?? "0"}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-card p-3 shadow-2xs">
                      <p className="text-[11px] text-muted-foreground">Mutual Fund Records</p>
                      <p className="text-lg font-bold font-mono text-violet-600 mt-0.5">
                        {liveStats[selectedCompanyForSheet.id]?.mutualFunds?.toLocaleString() ??
                          "0"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 2. Capital Structure & Instrument Terms */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Coins className="h-4 w-4 text-primary" /> Capital Structure & Instrument Rates
                  </h4>
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-3 text-sm">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <div>
                        <span className="text-xs text-muted-foreground block">Face Value</span>
                        <span className="font-semibold font-mono">
                          {selectedCompanyForSheet.face_value != null
                            ? `NPR ${Number(selectedCompanyForSheet.face_value).toLocaleString()}`
                            : "NPR 100"}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">
                          Issued Units (Kitta)
                        </span>
                        <span className="font-semibold font-mono">
                          {selectedCompanyForSheet.issue_size != null
                            ? Number(selectedCompanyForSheet.issue_size).toLocaleString()
                            : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Paid-up Capital</span>
                        <span className="font-semibold font-mono text-primary">
                          {selectedCompanyForSheet.issue_size && selectedCompanyForSheet.face_value
                            ? `NPR ${(
                                Number(selectedCompanyForSheet.issue_size) *
                                Number(selectedCompanyForSheet.face_value)
                              ).toLocaleString()}`
                            : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Dividend Rate</span>
                        <span className="font-semibold font-mono text-emerald-600">
                          {selectedCompanyForSheet.dividend_rate != null
                            ? `${selectedCompanyForSheet.dividend_rate}%`
                            : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">
                          Debenture / Coupon
                        </span>
                        <span className="font-semibold font-mono text-blue-600">
                          {selectedCompanyForSheet.coupon_rate != null
                            ? `${selectedCompanyForSheet.coupon_rate}%`
                            : selectedCompanyForSheet.debenture_rate != null
                              ? `${selectedCompanyForSheet.debenture_rate}%`
                              : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Maturity Date</span>
                        <span className="font-semibold font-mono">
                          {selectedCompanyForSheet.maturity_date || "Perpetual / Ongoing"}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">
                          Interest Tax Status
                        </span>
                        <span className="font-medium">
                          {selectedCompanyForSheet.interest_tax_status || "Standard (Taxable)"}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">ISIN</span>
                        <span className="font-mono font-medium">
                          {selectedCompanyForSheet.isin || "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Company PAN</span>
                        <span className="font-mono font-medium">
                          {selectedCompanyForSheet.pan_no || "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Settlement Banking Details */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Landmark className="h-4 w-4 text-primary" /> Settlement Banking & Disbursement
                    Account
                  </h4>
                  <div className="rounded-lg border bg-card p-4 space-y-2 text-sm">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <span className="text-xs text-muted-foreground block">
                          Settlement Bank Name
                        </span>
                        <span className="font-medium">
                          {selectedCompanyForSheet.bank_name || "Not Configured"}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">
                          Corporate Account No.
                        </span>
                        <span className="font-mono font-semibold">
                          {selectedCompanyForSheet.bank_account_no || "Not Configured"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. Official Contacts & Governance */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Building2 className="h-4 w-4 text-primary" /> Official Contacts & Registrar
                  </h4>
                  <div className="rounded-lg border bg-card p-4 space-y-3 text-sm">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <span className="text-xs text-muted-foreground block">
                          Registrar (RTA/RTS)
                        </span>
                        <span className="font-medium">
                          {selectedCompanyForSheet.registrar || "RBB Merchant Banking Limited"}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">
                          Head Office Address
                        </span>
                        <span className="flex items-center gap-1.5 text-foreground">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                          {selectedCompanyForSheet.address || "Kathmandu, Nepal"}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Official Email</span>
                        {selectedCompanyForSheet.email ? (
                          <a
                            href={`mailto:${selectedCompanyForSheet.email}`}
                            className="flex items-center gap-1 text-primary hover:underline font-mono"
                          >
                            <Mail className="h-3.5 w-3.5" />
                            {selectedCompanyForSheet.email}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Official Phone</span>
                        {selectedCompanyForSheet.phone ? (
                          <a
                            href={`tel:${selectedCompanyForSheet.phone}`}
                            className="flex items-center gap-1 text-primary hover:underline font-mono"
                          >
                            <Phone className="h-3.5 w-3.5" />
                            {selectedCompanyForSheet.phone}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                      <div className="sm:col-span-2">
                        <span className="text-xs text-muted-foreground block">Website</span>
                        {selectedCompanyForSheet.website ? (
                          <a
                            href={
                              selectedCompanyForSheet.website.startsWith("http")
                                ? selectedCompanyForSheet.website
                                : `https://${selectedCompanyForSheet.website}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-primary hover:underline font-mono text-xs"
                          >
                            <Globe className="h-3.5 w-3.5" />
                            {selectedCompanyForSheet.website}
                            <ExternalLink className="h-3 w-3 ml-0.5" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Create / Edit Dialog — Includes All Database Fields */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              {editing ? `Edit — ${editing.company_name}` : "Add New Company"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {/* Section 1: General Info & Identification */}
            <SectionLabel icon={Building2}>General Information & Identification</SectionLabel>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>
                  Company Code <span className="text-destructive">*</span>
                </Label>
                <Input
                  placeholder="e.g. NABIL, CIT, NECO"
                  value={form.company_code}
                  onChange={(e) => setF("company_code", e.target.value.toUpperCase())}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>
                  Company Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  placeholder="Official registered entity name"
                  value={form.company_name}
                  onChange={(e) => setF("company_name", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Company Type</Label>
                <Input
                  placeholder="Commercial Bank, Mutual Fund, Debenture…"
                  value={form.company_type}
                  onChange={(e) => setF("company_type", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>ISIN Code</Label>
                <Input
                  placeholder="e.g. NPE..."
                  value={form.isin}
                  onChange={(e) => setF("isin", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Company PAN</Label>
                <Input
                  placeholder="9-digit PAN"
                  value={form.pan_no}
                  onChange={(e) => setF("pan_no", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Sector</Label>
                <Select value={form.sector_type} onValueChange={(v) => setF("sector_type", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Public", "Private", "Institution", "Government", "Other"].map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Registrar (RTA/RTS)</Label>
                <Input
                  placeholder="Registrar name"
                  value={form.registrar}
                  onChange={(e) => setF("registrar", e.target.value)}
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
                    setF("fiscal_year", nextValue);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
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

            {/* Section 2: Financial Terms & Capital Structure */}
            <SectionLabel icon={Percent}>Instrument Terms & Capital Structure</SectionLabel>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Face Value (Rs.)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="100, 1000…"
                  value={form.face_value}
                  onChange={(e) => setF("face_value", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Issued Units (Kitta)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Total units"
                  value={form.issue_size}
                  onChange={(e) => setF("issue_size", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Maturity Date</Label>
                <Input
                  type="date"
                  value={form.maturity_date}
                  onChange={(e) => setF("maturity_date", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Dividend Rate (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 10.5"
                  value={form.dividend_rate}
                  onChange={(e) => setF("dividend_rate", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Debenture Rate (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 8.5"
                  value={form.debenture_rate}
                  onChange={(e) => setF("debenture_rate", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Coupon Rate (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 6.0"
                  value={form.coupon_rate}
                  onChange={(e) => setF("coupon_rate", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Interest Tax Status</Label>
                <Select
                  value={form.interest_tax_status || "Taxable"}
                  onValueChange={(v) => setF("interest_tax_status", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Taxable">Standard (Taxable)</SelectItem>
                    <SelectItem value="Exempted">Exempted</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Section 3: Official Contacts & Settlement Banking */}
            <SectionLabel icon={Landmark}>Official Contacts & Settlement Banking</SectionLabel>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Official Email Address</Label>
                <Input
                  type="email"
                  placeholder="info@company.com"
                  value={form.email}
                  onChange={(e) => setF("email", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone / Contact No.</Label>
                <Input
                  placeholder="01-XXXXXXX, 98XXXXXXXX"
                  value={form.phone}
                  onChange={(e) => setF("phone", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Official Website URL</Label>
                <Input
                  placeholder="https://www.company.com.np"
                  value={form.website}
                  onChange={(e) => setF("website", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Head Office Address</Label>
                <Input
                  placeholder="e.g. Putalisadak, Kathmandu"
                  value={form.address}
                  onChange={(e) => setF("address", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Settlement Bank Name</Label>
                <Input
                  placeholder="e.g. Rastriya Banijya Bank Ltd."
                  value={form.bank_name}
                  onChange={(e) => setF("bank_name", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Settlement Bank Account No.</Label>
                <Input
                  placeholder="e.g. 1090000123456789"
                  value={form.bank_account_no}
                  onChange={(e) => setF("bank_account_no", e.target.value)}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="p-4 border-t bg-muted/20 gap-2">
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
              disabled={upsert.isPending || !form.company_code.trim() || !form.company_name.trim()}
              onClick={() => upsert.mutate()}
            >
              {upsert.isPending ? "Saving…" : editing ? "Save Changes" : "Create Company"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Alert Dialog */}
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
              Delete Company & Associated Records
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.company_name}</strong> (
              {deleteTarget?.company_code})? This will safely remove the company along with all its
              associated payables, payments, and client distributions.
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
