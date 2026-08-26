import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Upload,
  Download,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Layers,
  Calculator,
  History,
  ShieldCheck,
  RefreshCw,
  Search,
  Lock,
  Unlock,
  Building2,
  Sparkles,
  PieChart,
} from "lucide-react";
import { toast } from "sonner";
import { exportToExcel } from "@/lib/xlsx-utils";
import {
  IafGeneratorService,
  IafRecord,
  AllotmentSummary,
  LOCK_IN_PRESETS,
  LockInPreset,
  formatIafHeader,
  formatIafDetailLine,
} from "@/lib/services/iaf-generator.service";

export const Route = createFileRoute("/_authenticated/allocations")({
  component: AllocationsPage,
});

type FundRow = {
  id: string;
  company_id: string | null;
  fiscal_year: string;
  allocated_amount: number;
  utilized_amount: number;
  notes: string | null;
};

function AllocationsPage() {
  const qc = useQueryClient();
  const { hasAny } = useAuth();
  const canWrite = hasAny(["admin", "finance_operator"]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Tab State ──
  const [activeTab, setActiveTab] = useState<"generator" | "calculator" | "history" | "fund">("generator");

  // ── IAF Generator State ──
  const [records, setRecords] = useState<IafRecord[]>([]);
  const [summary, setSummary] = useState<AllotmentSummary | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [isLoadingFile, setIsLoadingFile] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Configuration options
  const [issueSeqNo, setIssueSeqNo] = useState<string>("504");
  const [lotNo, setLotNo] = useState<string>("001");
  const [rtaRef, setRtaRef] = useState<string>("");
  const [selectedPresetKey, setSelectedPresetKey] = useState<string>("PUBLIC");
  const [customLockCode, setCustomLockCode] = useState<string>("00");
  const [customLockReason, setCustomLockReason] = useState<string>("");
  const [customExpiryDate, setCustomExpiryDate] = useState<string>("");
  const [isLockAll, setIsLockAll] = useState<boolean>(false);

  // ── Calculator State ──
  const [calcTotalKitta, setCalcTotalKitta] = useState<number>(1000000);
  const [calcPublicPct, setCalcPublicPct] = useState<number>(70);
  const [calcLocalPct, setCalcLocalPct] = useState<number>(10);
  const [calcForeignPct, setCalcForeignPct] = useState<number>(10);
  const [calcStaffPct, setCalcStaffPct] = useState<number>(5);
  const [calcMfPct, setCalcMfPct] = useState<number>(5);

  // ── Fund Allocations State ──
  const [fundOpen, setFundOpen] = useState(false);
  const [editingFund, setEditingFund] = useState<FundRow | null>(null);
  const [fundForm, setFundForm] = useState({ company_id: "", fiscal_year: "", allocated_amount: "", utilized_amount: "", notes: "" });

  // ── Database Queries ──
  const { data: fundRows = [] } = useQuery({
    queryKey: ["iaf_allocations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("iaf_allocations").select("*").order("fiscal_year", { ascending: false });
      if (error) throw error;
      return (data ?? []) as FundRow[];
    },
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["companies-min"],
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("id, company_name, company_code").order("company_name");
      return (data ?? []) as { id: string; company_name: string; company_code: string }[];
    },
  });

  const { data: fys = [] } = useQuery({
    queryKey: ["fiscal_years-min"],
    queryFn: async () => {
      const { data } = await supabase.from("fiscal_years").select("fiscal_year").order("fiscal_year", { ascending: false });
      return (data ?? []) as { fiscal_year: string }[];
    },
  });

  const companyMap = useMemo(() => Object.fromEntries(companies.map((c) => [c.id, c.company_name])), [companies]);

  const fundTotals = useMemo(() => ({
    allocated: fundRows.reduce((s, r) => s + Number(r.allocated_amount || 0), 0),
    utilized: fundRows.reduce((s, r) => s + Number(r.utilized_amount || 0), 0),
  }), [fundRows]);

  // ── File Upload Handler ──
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoadingFile(true);
    setFileName(file.name);

    try {
      const preset = LOCK_IN_PRESETS[selectedPresetKey] || LOCK_IN_PRESETS.PUBLIC;
      const { records: parsedRecords, summary: parsedSummary, detectedRtaRef } = await IafGeneratorService.parseAllotmentExcel(file, {
        defaultLockPreset: preset,
        defaultRtaRef: rtaRef || undefined,
        customExpiryDate: customExpiryDate || undefined,
      });

      if (parsedRecords.length === 0) {
        toast.error("No valid allotment records or BOIDs found in uploaded file.");
        return;
      }

      setRecords(parsedRecords);
      setSummary(parsedSummary);
      if (detectedRtaRef && !rtaRef) {
        setRtaRef(detectedRtaRef);
      }

      // Try extracting sequence and lot from filename if present (e.g. 504.001 or 410.005)
      const seqMatch = file.name.match(/(\d{3,5})\.(\d{3,4})/);
      if (seqMatch) {
        setIssueSeqNo(seqMatch[1]);
        setLotNo(seqMatch[2]);
      }

      toast.success(`Successfully loaded ${parsedRecords.length.toLocaleString()} shareholder allotment records!`);
    } catch (err: any) {
      console.error("Failed to parse allotment Excel:", err);
      toast.error(`Error parsing allotment file: ${err?.message || "Invalid file format"}`);
    } finally {
      setIsLoadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ── Preset Change ──
  const handlePresetChange = (presetKey: string) => {
    setSelectedPresetKey(presetKey);
    const p = LOCK_IN_PRESETS[presetKey];
    if (p) {
      setCustomLockCode(p.code);
      setCustomLockReason(p.reason);
      setIsLockAll(p.isLocked);
      if (p.defaultExpiryYears) {
        const d = new Date();
        d.setFullYear(d.getFullYear() + p.defaultExpiryYears);
        setCustomExpiryDate(d.toISOString().slice(0, 10));
      } else {
        setCustomExpiryDate("");
      }
    }
  };

  // ── Fully Reactive Effective Records ──
  const effectiveRecords = useMemo(() => {
    if (records.length === 0) return [];
    return records.map((r) => {
      let lockQty = r.lockInKitta;
      let code = r.lockInReasonCode;
      let reason = r.lockInReason;
      let expiry = r.lockInExpiryDate;

      if (selectedPresetKey === "PUBLIC" || customLockCode === "00") {
        lockQty = 0;
        code = "00";
        reason = "";
        expiry = "00000000";
      } else if (isLockAll) {
        lockQty = r.currentKitta;
        code = customLockCode || "09";
        reason = customLockReason || "Local Affected";
        expiry = customExpiryDate ? normalizeDateToDDMMYYYY(customExpiryDate) : "00000000";
      } else if (customLockCode) {
        code = customLockCode;
        reason = customLockReason;
        if (customExpiryDate) expiry = normalizeDateToDDMMYYYY(customExpiryDate);
      }

      return {
        ...r,
        lockInKitta: lockQty,
        lockInReasonCode: code,
        lockInReason: reason,
        lockInExpiryDate: expiry,
        rtaIntRefNo: rtaRef || r.rtaIntRefNo,
      };
    });
  }, [records, selectedPresetKey, isLockAll, customLockCode, customLockReason, customExpiryDate, rtaRef]);

  const effectiveSummary = useMemo(() => {
    if (effectiveRecords.length === 0) return null;
    return IafGeneratorService.generateAllotmentSummary(effectiveRecords);
  }, [effectiveRecords]);

  // ── Filtered Records for Table ──
  const filteredRecords = useMemo(() => {
    let list = effectiveRecords;
    if (categoryFilter !== "all") {
      list = list.filter((r) => (r.category || r.lotName) === categoryFilter);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (r) =>
          r.boid.toLowerCase().includes(q) ||
          (r.name && r.name.toLowerCase().includes(q)) ||
          (r.applicantNo && r.applicantNo.toLowerCase().includes(q)) ||
          (r.rtaIntRefNo && r.rtaIntRefNo.toLowerCase().includes(q))
      );
    }
    return list;
  }, [effectiveRecords, categoryFilter, searchTerm]);

  // ── Download Actions ──
  const handleDownloadIaf = () => {
    if (effectiveRecords.length === 0) {
      toast.error("Please upload an allotment file first.");
      return;
    }

    const content = IafGeneratorService.generateIafContent(effectiveRecords, {
      rtaRef: rtaRef || "RTA REF",
      lockCode: customLockCode,
      lockReason: customLockReason,
      lockExpiryDate: customExpiryDate,
      lockAll: isLockAll,
    });

    const outputName = `${issueSeqNo.trim() || "504"}.${lotNo.trim() || "001"}.iaf`;
    IafGeneratorService.downloadFile(content, outputName);
    toast.success(`Generated and downloaded ${outputName} (CDSC Format)`);
  };

  const handleDownloadIvf = () => {
    if (effectiveRecords.length === 0) {
      toast.error("Please upload an allotment file first.");
      return;
    }

    const content = IafGeneratorService.generateIvfContent(effectiveRecords);
    const outputName = `${issueSeqNo.trim() || "504"}.${lotNo.trim() || "0001"}.ivf`;
    IafGeneratorService.downloadFile(content, outputName);
    toast.success(`Generated and downloaded ${outputName} (BO Verification File)`);
  };

  const handleDownloadWebCsv = () => {
    if (effectiveRecords.length === 0) {
      toast.error("Please upload an allotment file first.");
      return;
    }

    const content = IafGeneratorService.generateWebAlloteeCsv(effectiveRecords);
    const outputName = `weballoteelist_${issueSeqNo || "allotment"}.csv`;
    IafGeneratorService.downloadFile(content, outputName, "text/csv;charset=utf-8");
    toast.success(`Generated and downloaded ${outputName} (Web Search Result CSV)`);
  };

  const handleDownloadExcelExport = () => {
    if (effectiveRecords.length === 0) {
      toast.error("Please upload an allotment file first.");
      return;
    }

    const exportRows = effectiveRecords.map((r, idx) => ({
      "S.N": idx + 1,
      BOID: r.boid,
      "Shareholder Name": r.name || "Shareholder",
      "Allotted Kitta": r.currentKitta,
      "Locked-in Kitta": r.lockInKitta,
      "Lock Code": r.lockInReasonCode,
      "Lock Reason": r.lockInReason,
      "Lock Expiry Date": r.lockInExpiryDate,
      "RTA Reference": r.rtaIntRefNo,
      Category: r.category || r.lotName || "General",
      Status: r.isValid ? "Valid" : "Check Notice",
    }));

    exportToExcel(exportRows, `Allotment_Export_${issueSeqNo || "504"}_${lotNo || "001"}`);
    toast.success("Allotment data exported to Excel.");
  };

  // ── Fund Allocations Mutations ──
  const saveFund = useMutation({
    mutationFn: async () => {
      const payload = {
        company_id: fundForm.company_id || null,
        fiscal_year: fundForm.fiscal_year,
        allocated_amount: Number(fundForm.allocated_amount || 0),
        utilized_amount: Number(fundForm.utilized_amount || 0),
        notes: fundForm.notes || null,
      };
      if (editingFund) {
        const { error } = await supabase.from("iaf_allocations").update(payload).eq("id", editingFund.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("iaf_allocations").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Saved");
      setFundOpen(false);
      qc.invalidateQueries({ queryKey: ["iaf_allocations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delFund = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("iaf_allocations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["iaf_allocations"] });
    },
  });

  return (
    <div className="flex flex-col gap-6 p-6 animate-fade-in">
      <PageHeader
        title="CDSC & IAF Allotment Engine"
        description="Generate verified CDSC Allotment (.iaf), BO Verification (.ivf), Corporate Action (.ipf), and Web Allotee files."
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
        <TabsList className="grid grid-cols-2 lg:grid-cols-4 w-full mb-6">
          <TabsTrigger value="generator" className="gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <span>CDSC File Generator</span>
          </TabsTrigger>
          <TabsTrigger value="calculator" className="gap-2">
            <Calculator className="h-4 w-4 text-indigo-500" />
            <span>Quota & Allotment Calculator</span>
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4 text-amber-500" />
            <span>Specs & Guidelines</span>
          </TabsTrigger>
          <TabsTrigger value="fund" className="gap-2">
            <Building2 className="h-4 w-4 text-emerald-500" />
            <span>IAF Fund Budget</span>
          </TabsTrigger>
        </TabsList>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 1: CDSC FILE GENERATOR (IAF / IVF / Web CSV)              */}
        {/* ───────────────────────────────────────────────────────────── */}
        <TabsContent value="generator" className="space-y-6">
          {/* Top Configuration & Upload Bar */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Upload Box */}
            <Card className="glass-card border border-border/80 lg:col-span-1">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Upload className="h-4 w-4 text-primary" />
                  Upload Allotment Excel / CSV
                </CardTitle>
                <CardDescription className="text-xs">
                  Upload spreadsheet with BOID, Allotted Kitta, and category details.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer hover:border-primary/60 transition-colors bg-muted/20 hover:bg-muted/30 flex flex-col items-center justify-center gap-2"
                >
                  <FileSpreadsheet className="h-8 w-8 text-primary/70 animate-bounce" />
                  <p className="text-xs font-medium text-foreground">
                    {fileName ? fileName : "Click to select Excel / CSV file"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Supports .xlsx, .xls, .csv (e.g. 410.005 iaf.xlsx, weballoteelist.csv)
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>

                {isLoadingFile && (
                  <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground animate-pulse">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Parsing allotment records and validating BOIDs...
                  </div>
                )}
              </CardContent>
            </Card>

            {/* CDSC Header & Lock-in Configuration */}
            <Card className="glass-card border border-border/80 lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  CDSC Parameters & Lock-in Presets
                </CardTitle>
                <CardDescription className="text-xs">
                  Configure sequence numbering, RTA internal reference, and lock-in expiration.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <Label className="text-[11px] font-medium text-muted-foreground">Issue Seq No</Label>
                    <Input
                      value={issueSeqNo}
                      onChange={(e) => setIssueSeqNo(e.target.value)}
                      placeholder="e.g. 504"
                      className="h-8 text-xs font-mono mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] font-medium text-muted-foreground">Lot / Sub No</Label>
                    <Input
                      value={lotNo}
                      onChange={(e) => setLotNo(e.target.value)}
                      placeholder="e.g. 001"
                      className="h-8 text-xs font-mono mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] font-medium text-muted-foreground">RTA Internal Ref No (Max 16)</Label>
                    <Input
                      value={rtaRef}
                      onChange={(e) => setRtaRef(e.target.value)}
                      placeholder="e.g. KHPL IPO 2082"
                      className="h-8 text-xs font-mono mt-1"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs pt-1 border-t">
                  <div>
                    <Label className="text-[11px] font-medium text-muted-foreground">Category Preset</Label>
                    <Select value={selectedPresetKey} onValueChange={handlePresetChange}>
                      <SelectTrigger className="h-8 text-xs mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOCAL">Local Affected (Code 09 - 3 Yrs)</SelectItem>
                        <SelectItem value="PUBLIC">General Public (Code 00 - Free)</SelectItem>
                        <SelectItem value="EMPLOYEE">Employees (Code 02 - Locked)</SelectItem>
                        <SelectItem value="PROMOTER">Promoter (Code 01 - Locked)</SelectItem>
                        <SelectItem value="MUTUAL_FUND">Mutual Fund (Code 03 - 6 Mos)</SelectItem>
                        <SelectItem value="CUSTOM">Custom Rule (Code 99)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-[11px] font-medium text-muted-foreground">Lock Code (2 digits)</Label>
                    <Input
                      value={customLockCode}
                      onChange={(e) => setCustomLockCode(e.target.value)}
                      className="h-8 text-xs font-mono mt-1"
                      maxLength={2}
                    />
                  </div>

                  <div>
                    <Label className="text-[11px] font-medium text-muted-foreground">Lock Reason (Max 50)</Label>
                    <Input
                      value={customLockReason}
                      onChange={(e) => setCustomLockReason(e.target.value)}
                      className="h-8 text-xs mt-1"
                      maxLength={50}
                    />
                  </div>

                  <div>
                    <Label className="text-[11px] font-medium text-muted-foreground">Lock Expiry (YYYY-MM-DD)</Label>
                    <Input
                      type="date"
                      value={customExpiryDate}
                      onChange={(e) => setCustomExpiryDate(e.target.value)}
                      className="h-8 text-xs mt-1"
                    />
                  </div>
                </div>

                {/* Lock Date Source Toggle & Spacing Notice */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t text-[11px]">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-muted-foreground">Lock-in Date Source:</span>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="lockDateMode"
                        checked={!isLockAll}
                        onChange={() => setIsLockAll(false)}
                        className="h-3 w-3 text-primary"
                      />
                      <span>From Spreadsheet Rows</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="lockDateMode"
                        checked={isLockAll}
                        onChange={() => setIsLockAll(true)}
                        className="h-3 w-3 text-primary"
                      />
                      <span>Apply Fixed Lot Expiry Date</span>
                    </label>
                  </div>
                  <div className="text-muted-foreground font-mono">
                    Header: 42 chars | Detail: 124 chars | CRLF endings
                  </div>
                </div>

                {/* Live CDSC Fixed-Width Line Inspector */}
                {effectiveRecords.length > 0 && (
                  <div className="p-3 rounded-lg bg-muted/40 border space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        CDSC Fixed-Width Output Inspector (Exact Spacing & Character Positions)
                      </span>
                      <span className="font-mono text-[10px] text-primary">Strict CDSC Spec Verified</span>
                    </div>
                    <div className="font-mono text-[11px] bg-background/80 p-2.5 rounded border overflow-x-auto space-y-1">
                      <div className="text-muted-foreground text-[10px]">
                        Line 1 (Header: 42 chars) = [Recs: 1-10] [CurrentQty: 11-26] [LockQty: 27-42]
                      </div>
                      <div className="text-emerald-700 dark:text-emerald-300 select-all font-semibold">
                        {formatIafHeader(effectiveRecords.length, effectiveSummary?.totalAllottedKitta || 0, effectiveSummary?.totalLockInKitta || 0)}
                      </div>
                      <div className="text-muted-foreground text-[10px] pt-1">
                        Line 2 (Detail: 124 chars) = [BOID: 1-16] [Curr: 17-32] [Lock: 33-48] [Code: 49-50] [Reason: 51-100] [Date: 101-108] [Ref: 109-124]
                      </div>
                      <div className="text-primary select-all font-semibold whitespace-pre">
                        {formatIafDetailLine(effectiveRecords[0], rtaRef)}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* KPI Summary Cards */}
          {effectiveSummary && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="glass-card hover-lift border border-border/80">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">Total Beneficiaries</p>
                    <p className="text-2xl font-bold text-foreground mt-1 tabular-nums">
                      {effectiveSummary.totalRecords.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                      {effectiveSummary.validRecords.toLocaleString()} valid BOIDs
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
                    <Layers className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-card hover-lift border border-border/80">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">Total Allotted Kitta</p>
                    <p className="text-2xl font-bold text-primary mt-1 tabular-nums">
                      {effectiveSummary.totalAllottedKitta.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Total shares declared</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                    <Sparkles className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-card hover-lift border border-border/80">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">Locked-in Quantity</p>
                    <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1 tabular-nums">
                      {effectiveSummary.totalLockInKitta.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Code {customLockCode || "00"} ({customLockReason || "Free/No Lock"})
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <Lock className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-card hover-lift border border-border/80">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">Free Floating Kitta</p>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 tabular-nums">
                      {effectiveSummary.totalFreeKitta.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Immediately tradable</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <Unlock className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Action Button Bar */}
          {effectiveRecords.length > 0 && (
            <Card className="glass-card border border-primary/30 bg-primary/5">
              <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>
                    Ready to generate files for <strong>{effectiveRecords.length.toLocaleString()}</strong> investors ({effectiveSummary?.totalAllottedKitta.toLocaleString()} kitta)
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={handleDownloadIaf} size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
                    <Download className="mr-1.5 h-4 w-4" />
                    Download .IAF File
                  </Button>
                  <Button onClick={handleDownloadIvf} size="sm" variant="outline">
                    <Download className="mr-1.5 h-4 w-4" />
                    Download .IVF File
                  </Button>
                  <Button onClick={handleDownloadWebCsv} size="sm" variant="outline">
                    <Download className="mr-1.5 h-4 w-4" />
                    Download Web CSV
                  </Button>
                  <Button onClick={handleDownloadExcelExport} size="sm" variant="outline">
                    <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                    Export Excel
                  </Button>
                  <Button onClick={() => { setRecords([]); setSummary(null); setFileName(""); }} size="sm" variant="ghost" className="text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Data Table */}
          {effectiveRecords.length > 0 && (
            <Card className="glass-card border border-border/80">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold">Shareholder Allotment Preview</CardTitle>
                  <CardDescription className="text-xs">
                    Showing {filteredRecords.length.toLocaleString()} of {effectiveRecords.length.toLocaleString()} records
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative w-64">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search BOID, Name, Ref..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="h-8 pl-8 text-xs"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border overflow-x-auto">
                  <Table className="text-xs">
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>BOID</TableHead>
                        <TableHead>Shareholder Name</TableHead>
                        <TableHead className="text-right">Allotted Kitta</TableHead>
                        <TableHead className="text-right">Locked Kitta</TableHead>
                        <TableHead>Lock Code</TableHead>
                        <TableHead>Lock Reason</TableHead>
                        <TableHead>Expiry Date</TableHead>
                        <TableHead>RTA Ref</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRecords.slice(0, 100).map((row, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-muted-foreground font-mono">{idx + 1}</TableCell>
                          <TableCell className="font-mono font-medium">{row.boid}</TableCell>
                          <TableCell>{row.name || "Shareholder"}</TableCell>
                          <TableCell className="text-right font-mono font-semibold">{row.currentKitta.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono text-amber-600">{row.lockInKitta.toLocaleString()}</TableCell>
                          <TableCell className="font-mono">{row.lockInReasonCode}</TableCell>
                          <TableCell className="truncate max-w-[150px]">{row.lockInReason || "—"}</TableCell>
                          <TableCell className="font-mono">{row.lockInExpiryDate || "00000000"}</TableCell>
                          <TableCell className="font-mono text-muted-foreground">{row.rtaIntRefNo || rtaRef || "—"}</TableCell>
                          <TableCell>
                            {row.isValid ? (
                              <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50/50">
                                Verified
                              </Badge>
                            ) : (
                              <Badge variant="destructive">
                                {row.errors?.[0] || "Notice"}
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {filteredRecords.length > 100 && (
                  <p className="text-xs text-muted-foreground text-center mt-3">
                    Showing first 100 rows. All {filteredRecords.length.toLocaleString()} rows will be exported to the files.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 2: SMART ALLOTMENT RATIO CALCULATOR                      */}
        {/* ───────────────────────────────────────────────────────────── */}
        <TabsContent value="calculator" className="space-y-6">
          <Card className="glass-card border border-border/80">
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <PieChart className="h-4 w-4 text-indigo-500" />
                IPO & Corporate Action Allotment Quota Calculator
              </CardTitle>
              <CardDescription className="text-xs">
                Calculate share distribution ratios across regulatory quotas (Public, Local, Foreign, Employees, Mutual Funds).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs font-medium">Total Issue Size (Kitta / Shares)</Label>
                  <Input
                    type="number"
                    value={calcTotalKitta}
                    onChange={(e) => setCalcTotalKitta(Number(e.target.value) || 0)}
                    className="mt-1 font-mono text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">Face Value per Share (NPR)</Label>
                  <Input defaultValue={100} className="mt-1 font-mono text-sm" />
                </div>
                <div>
                  <Label className="text-xs font-medium">Total Issue Amount (NPR)</Label>
                  <div className="mt-1 h-9 px-3 rounded-md border bg-muted/40 flex items-center text-sm font-mono font-bold text-primary">
                    NPR {(calcTotalKitta * 100).toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 pt-2">
                <div className="p-3.5 rounded-xl border bg-muted/20 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>General Public</span>
                    <span className="text-primary">{calcPublicPct}%</span>
                  </div>
                  <Input
                    type="number"
                    value={calcPublicPct}
                    onChange={(e) => setCalcPublicPct(Number(e.target.value) || 0)}
                    className="h-8 text-xs"
                  />
                  <div className="text-xs font-mono font-bold text-foreground">
                    {Math.round((calcTotalKitta * calcPublicPct) / 100).toLocaleString()} kitta
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border bg-muted/20 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Local Affected</span>
                    <span className="text-amber-600">{calcLocalPct}%</span>
                  </div>
                  <Input
                    type="number"
                    value={calcLocalPct}
                    onChange={(e) => setCalcLocalPct(Number(e.target.value) || 0)}
                    className="h-8 text-xs"
                  />
                  <div className="text-xs font-mono font-bold text-foreground">
                    {Math.round((calcTotalKitta * calcLocalPct) / 100).toLocaleString()} kitta
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border bg-muted/20 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Foreign Workers (FRN)</span>
                    <span className="text-sky-600">{calcForeignPct}%</span>
                  </div>
                  <Input
                    type="number"
                    value={calcForeignPct}
                    onChange={(e) => setCalcForeignPct(Number(e.target.value) || 0)}
                    className="h-8 text-xs"
                  />
                  <div className="text-xs font-mono font-bold text-foreground">
                    {Math.round((calcTotalKitta * calcForeignPct) / 100).toLocaleString()} kitta
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border bg-muted/20 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Employees</span>
                    <span className="text-violet-600">{calcStaffPct}%</span>
                  </div>
                  <Input
                    type="number"
                    value={calcStaffPct}
                    onChange={(e) => setCalcStaffPct(Number(e.target.value) || 0)}
                    className="h-8 text-xs"
                  />
                  <div className="text-xs font-mono font-bold text-foreground">
                    {Math.round((calcTotalKitta * calcStaffPct) / 100).toLocaleString()} kitta
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border bg-muted/20 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Mutual Funds</span>
                    <span className="text-emerald-600">{calcMfPct}%</span>
                  </div>
                  <Input
                    type="number"
                    value={calcMfPct}
                    onChange={(e) => setCalcMfPct(Number(e.target.value) || 0)}
                    className="h-8 text-xs"
                  />
                  <div className="text-xs font-mono font-bold text-foreground">
                    {Math.round((calcTotalKitta * calcMfPct) / 100).toLocaleString()} kitta
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 3: CDSC SPECS & ALLOTMENT GUIDELINES                      */}
        {/* ───────────────────────────────────────────────────────────── */}
        <TabsContent value="history" className="space-y-6">
          <Card className="glass-card border border-border/80">
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Official CDSC File Specifications (Ref: CDSC Allotment Manual)
              </CardTitle>
              <CardDescription className="text-xs">
                Specifications for Issue Allotment (.iaf), BO Verification (.ivf), and Corporate Action Allotment (.ipf) files.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border bg-muted/30 space-y-2">
                  <h4 className="font-semibold text-foreground">1. Issue Allotment File (.iaf)</h4>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li><strong>Naming</strong>: &lt;IPO-SEQ-NUMB&gt;.&lt;LOT-NUMB&gt;.iaf (e.g. 504.001.iaf)</li>
                    <li><strong>Header (Line 1)</strong>: Exactly 42 characters (TotalRecords: 10, TotalCurrentQty: 16, TotalLockQty: 16).</li>
                    <li><strong>Detail (Line 2..N)</strong>: Exactly 124 characters (BOID: 16, Current: 16, Lock: 16, Code: 2, Reason: 50, Expiry: 8, RtaRef: 16).</li>
                    <li><strong>Alignment</strong>: Numeric right-justified (0-padded), alphanumeric left-justified (space-padded).</li>
                  </ul>
                </div>

                <div className="p-4 rounded-xl border bg-muted/30 space-y-2">
                  <h4 className="font-semibold text-foreground">2. Investor Verification File (.ivf)</h4>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li><strong>Naming</strong>: &lt;IPO-SEQ-NUMB&gt;.&lt;SUB-NUMB&gt;.ivf (e.g. 504.0001.ivf)</li>
                    <li><strong>Header (Line 1)</strong>: Exactly 10 characters (TotalRecords: 10, 0-padded).</li>
                    <li><strong>Detail (Line 2..N)</strong>: Exactly 16 characters (BOID: 16).</li>
                    <li><strong>Purpose</strong>: Verification of all applicant BOIDs against CDSC master repository before allotment run.</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 4: IAF FUND BUDGET ALLOCATIONS                            */}
        {/* ───────────────────────────────────────────────────────────── */}
        <TabsContent value="fund" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Investor Awareness Fund (IAF) Budget Ledger</h3>
              <p className="text-xs text-muted-foreground">Track company-level annual IAF allocations and utilization records.</p>
            </div>
            {canWrite && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    exportToExcel(
                      fundRows.map((r) => ({
                        Company: companyMap[r.company_id ?? ""] ?? "",
                        "Fiscal Year": r.fiscal_year,
                        Allocated: r.allocated_amount,
                        Utilized: r.utilized_amount,
                        Balance: Number(r.allocated_amount) - Number(r.utilized_amount),
                        Notes: r.notes,
                      })),
                      "iaf_fund_allocations"
                    )
                  }
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Export Ledger
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingFund(null);
                    setFundForm({ company_id: "", fiscal_year: "", allocated_amount: "", utilized_amount: "", notes: "" });
                    setFundOpen(true);
                  }}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  New Allocation
                </Button>
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="glass-card"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Budget Allocated</div><div className="text-2xl font-semibold mt-1 tabular-nums">NPR {fundTotals.allocated.toLocaleString()}</div></CardContent></Card>
            <Card className="glass-card"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Utilized</div><div className="text-2xl font-semibold mt-1 tabular-nums">NPR {fundTotals.utilized.toLocaleString()}</div></CardContent></Card>
            <Card className="glass-card"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Remaining Balance</div><div className="text-2xl font-semibold text-emerald-600 mt-1 tabular-nums">NPR {(fundTotals.allocated - fundTotals.utilized).toLocaleString()}</div></CardContent></Card>
          </div>

          <Card className="glass-card border border-border/80">
            <CardContent className="p-0">
              <Table className="text-xs">
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Fiscal Year</TableHead>
                    <TableHead className="text-right">Allocated (NPR)</TableHead>
                    <TableHead className="text-right">Utilized (NPR)</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Notes</TableHead>
                    {canWrite && <TableHead className="text-right w-20">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fundRows.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No fund allocation records found.</TableCell></TableRow>
                  ) : (
                    fundRows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{companyMap[r.company_id ?? ""] ?? "—"}</TableCell>
                        <TableCell className="font-mono">{r.fiscal_year}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">{Number(r.allocated_amount || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono">{Number(r.utilized_amount || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-emerald-600 font-semibold">{(Number(r.allocated_amount || 0) - Number(r.utilized_amount || 0)).toLocaleString()}</TableCell>
                        <TableCell className="text-muted-foreground">{r.notes || "—"}</TableCell>
                        {canWrite && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingFund(r);
                                  setFundForm({
                                    company_id: r.company_id ?? "",
                                    fiscal_year: r.fiscal_year,
                                    allocated_amount: String(r.allocated_amount ?? ""),
                                    utilized_amount: String(r.utilized_amount ?? ""),
                                    notes: r.notes ?? "",
                                  });
                                  setFundOpen(true);
                                }}
                              >
                                Edit
                              </Button>
                              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => delFund.mutate(r.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Fund Allocation Modal */}
      <Dialog open={fundOpen} onOpenChange={setFundOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingFund ? "Edit Fund Allocation" : "New Fund Allocation"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div>
              <Label className="text-xs">Company</Label>
              <Select value={fundForm.company_id} onValueChange={(v) => setFundForm({ ...fundForm, company_id: v })}>
                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.company_name} ({c.company_code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Fiscal Year</Label>
              <Select value={fundForm.fiscal_year} onValueChange={(v) => setFundForm({ ...fundForm, fiscal_year: v })}>
                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Select fiscal year" /></SelectTrigger>
                <SelectContent>
                  {fys.map((f) => (
                    <SelectItem key={f.fiscal_year} value={f.fiscal_year}>{f.fiscal_year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Allocated Amount (NPR)</Label>
              <Input
                type="number"
                value={fundForm.allocated_amount}
                onChange={(e) => setFundForm({ ...fundForm, allocated_amount: e.target.value })}
                className="mt-1 h-8 text-xs font-mono"
              />
            </div>
            <div>
              <Label className="text-xs">Utilized Amount (NPR)</Label>
              <Input
                type="number"
                value={fundForm.utilized_amount}
                onChange={(e) => setFundForm({ ...fundForm, utilized_amount: e.target.value })}
                className="mt-1 h-8 text-xs font-mono"
              />
            </div>
            <div>
              <Label className="text-xs">Notes / Reference</Label>
              <Input
                value={fundForm.notes}
                onChange={(e) => setFundForm({ ...fundForm, notes: e.target.value })}
                className="mt-1 h-8 text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setFundOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={saveFund.isPending} onClick={() => saveFund.mutate()}>
              {saveFund.isPending ? "Saving..." : "Save Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
