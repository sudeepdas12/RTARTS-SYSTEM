import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import * as XLSX from "xlsx";
import { ExcelParser } from "@/lib/excel-parser";
import {
  BankParser,
  classifyReconciliationFile,
  type FileParseStatus,
  type FileVariantWarning,
} from "@/lib/bank-parser";
import {
  ReconciliationEngine,
  ComprehensiveReconciliationReport,
  ReconciliationMatch,
  extractReconciliationExceptions,
  type ReconciliationExceptionItem,
} from "@/lib/reconciliation-engine";
import {
  ReconciliationService,
  ReconciliationResultRow,
  ReconciliationRunRow,
} from "@/lib/services/reconciliation.service";
import { useAuth } from "@/hooks/use-auth";
import {
  Upload,
  FileSpreadsheet,
  RefreshCw,
  Play,
  Download,
  Filter,
  Search,
  X,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RotateCcw,
  Trash2,
  CheckSquare,
  Square,
  CreditCard,
  Building2,
  ChevronDown,
  ChevronUp,
  Layers,
  ExternalLink,
  Info,
} from "lucide-react";
import { ReconciliationGroupedLot } from "@/lib/services/reconciliation.service";
import {
  AccountRemediationDialog,
  type RejectedAccountItem,
} from "@/components/account-remediation-dialog";
import { ReconciliationPostingModal } from "@/components/reconciliation/reconciliation-posting-modal";
import { ReconciliationDashboard } from "@/components/reconciliation/reconciliation-dashboard";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reconciliation")({
  component: ReconciliationRoute,
});

export function ReconciliationRoute() {
  const qc = useQueryClient();
  const [report, setReport] = useState<ComprehensiveReconciliationReport | null>(null);
  const [savedResults, setSavedResults] = useState<ReconciliationResultRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [remediationDialogOpen, setRemediationDialogOpen] = useState(false);
  const [remediationItems, setRemediationItems] = useState<RejectedAccountItem[]>([]);
  const [showPostingModal, setShowPostingModal] = useState(false);
  const [postingIsAll, setPostingIsAll] = useState(true);

  const headerExcelInputRef = useRef<HTMLInputElement>(null);
  const headerBankInputRef = useRef<HTMLInputElement>(null);
  const bodyExcelInputRef = useRef<HTMLInputElement>(null);
  const bodyBankInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>("all");
  const [reconCompanyIds, setReconCompanyIds] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [historyVisibleCount, setHistoryVisibleCount] = useState(15);
  const [expandedLotKey, setExpandedLotKey] = useState<string | null>(null);
  const [historySearchQuery, setHistorySearchQuery] = useState<string>("");
  const [historyCompanyFilter, setHistoryCompanyFilter] = useState<string>("all");
  const [historySourceFilter, setHistorySourceFilter] = useState<string>("all");
  const [reconciliationRuns, setReconciliationRuns] = useState<ReconciliationRunRow[]>([]);
  const [totalRunsCount, setTotalRunsCount] = useState<number>(0);
  const [runsSummary, setRunsSummary] = useState<{
    total_amount: number;
    matched_count: number;
    unmatched_count: number;
    row_count: number;
  }>({ total_amount: 0, matched_count: 0, unmatched_count: 0, row_count: 0 });
  const [historyViewMode, setHistoryViewMode] = useState<"runs" | "lots">("runs");
  const [lotDetailTabs, setLotDetailTabs] = useState<
    Record<string, "all" | "matched" | "rejected" | "discrepancy">
  >({});
  const [parsedFileStatuses, setParsedFileStatuses] = useState<FileParseStatus[]>([]);
  const [variantAlerts, setVariantAlerts] = useState<FileVariantWarning[]>([]);

  const { hasAny, isAdmin, user, roles } = useAuth();
  const canApply = hasAny(["admin", "finance_operator", "reconciliation_officer"]);
  const canDelete = isAdmin;

  const groupedLots = useMemo(() => {
    return ReconciliationService.groupResultsIntoLots(savedResults);
  }, [savedResults]);

  const { data: companiesList = [] } = useQuery<
    { id: string; company_name: string; company_code: string }[]
  >({
    queryKey: ["companies_list_recon"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, company_name, company_code")
        .order("company_name");
      if (error) return [];
      return (data || []) as { id: string; company_name: string; company_code: string }[];
    },
  });

  const registeredCompanies = useMemo(() => {
    return companiesList.map((c) => c.company_name).filter(Boolean);
  }, [companiesList]);

  const historyCompanies = useMemo(() => {
    if (registeredCompanies.length > 0) return registeredCompanies;
    const set = new Set<string>();
    for (const lot of groupedLots) {
      if (lot.companyName && lot.companyName !== "General Payables") set.add(lot.companyName);
    }
    return Array.from(set).sort();
  }, [registeredCompanies, groupedLots]);

  const filteredGroupedLots = useMemo(() => {
    let list = groupedLots;
    if (historyCompanyFilter !== "all") {
      list = list.filter((l) => l.companyName === historyCompanyFilter);
    }
    if (historySourceFilter === "bank_statement") {
      list = list.filter(
        (l) =>
          l.sourceType === "bank_statement" ||
          l.records.some((r) => r.source_a_type === "bank_statement") ||
          (l.fileName && l.fileName.toLowerCase().includes("statement")) ||
          l.lotName.toLowerCase().includes("statement") ||
          l.records.some((r) => r.notes && r.notes.toLowerCase().includes("statement")),
      );
    } else if (historySourceFilter === "connectips") {
      list = list.filter((l) => {
        const isBank =
          l.sourceType === "bank_statement" ||
          l.records.some((r) => r.source_a_type === "bank_statement");
        if (isBank) return false;

        return (
          l.sourceType === "excel" ||
          l.sourceType === "connectips" ||
          l.records.some((r) => r.source_a_type === "excel" || r.source_a_type === "connectips") ||
          (l.fileName && l.fileName.toLowerCase().includes("ips")) ||
          l.lotName.toLowerCase().includes("ips") ||
          l.lotName.toLowerCase().includes("lot") ||
          l.lotName.toLowerCase().includes("batch") ||
          l.records.some((r) => r.notes && r.notes.toLowerCase().includes("connectips"))
        );
      });
    }
    return list;
  }, [groupedLots, historyCompanyFilter, historySourceFilter]);

  const unlinkedHistoryCount = useMemo(
    () => savedResults.filter((r) => !r.payable_id && !r.client_id).length,
    [savedResults],
  );

  const handleRevertLot = async (lot: ReconciliationGroupedLot) => {
    if (!isAdmin) {
      toast.error("Only administrators are authorized to revert and remove reconciliation lots.");
      return;
    }
    if (
      !window.confirm(
        `Are you sure you want to revert and remove "${lot.lotName}"? This will reset all its payables back to "Pending" and remove this lot from history.`,
      )
    )
      return;
    setIsApplying(true);
    try {
      const res = await ReconciliationService.revertLot(lot);
      if (res.success) {
        toast.success(
          `Reverted "${lot.lotName}": ${res.revertedPayables} payables reset to Pending.`,
        );
        const deletedIds = new Set(lot.records.map((r) => r.id));
        setSavedResults((prev) => prev.filter((r) => !deletedIds.has(r.id)));
        qc.invalidateQueries({ queryKey: ["payments"] });
        qc.invalidateQueries({ queryKey: ["payables"] });
        qc.invalidateQueries({ queryKey: ["interest_payables"] });
        qc.invalidateQueries({ queryKey: ["dividend_payables"] });
        qc.invalidateQueries({ queryKey: ["mutual_fund_payables"] });
        loadHistory();
      } else {
        toast.error("Failed to revert lot.");
      }
    } finally {
      setIsApplying(false);
    }
  };

  const handleDeleteLot = async (lot: ReconciliationGroupedLot) => {
    if (!isAdmin) {
      toast.error("Only administrators are authorized to delete reconciliation records.");
      return;
    }
    if (
      !window.confirm(
        `Are you sure you want to delete history for "${lot.lotName}" (${lot.totalRecords} records)?`,
      )
    )
      return;
    setIsLoadingHistory(true);
    try {
      const ids = lot.records.map((r) => r.id);
      const ok = await ReconciliationService.deleteRecords(ids);
      if (ok) {
        toast.success(`Deleted lot "${lot.lotName}"`);
        const deletedIds = new Set(ids);
        setSavedResults((prev) => prev.filter((r) => !deletedIds.has(r.id)));
        loadHistory();
      } else {
        toast.error("Failed to delete lot");
      }
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleExportLot = (lot: ReconciliationGroupedLot) => {
    // 1. Sheet 1: Classification Summary for Lot
    const classRows: any[] = [
      [
        "S.N.",
        "Lot / Settlement Batch",
        "Company",
        "Payable Type",
        "Date",
        "Total Records",
        "Matched Count",
        "Rejected Count",
        "Discrepancy Count",
        "Total Settled Amount (NPR)",
        "Matched Amount (NPR)",
        "Rejected Amount (NPR)",
      ],
      [
        1,
        lot.lotName,
        lot.companyName,
        lot.payableType,
        lot.date,
        lot.totalRecords,
        lot.matchedCount,
        lot.rejectedCount,
        lot.discrepancyCount,
        Number(lot.totalAmount.toFixed(2)),
        Number(lot.matchedAmount.toFixed(2)),
        Number(lot.rejectedAmount.toFixed(2)),
      ],
    ];

    // 2. Sheet 2: Shareholder Reconciliation Records
    const matchRows: any[] = [
      [
        "S.N.",
        "BOID",
        "Shareholder Name",
        "Company",
        "Payable Type",
        "Reconciliation Status",
        "Expected System Amount (NPR)",
        "Actual Settled Amount (NPR)",
        "Difference (NPR)",
        "Bank Name",
        "Account Number",
        "Notes / Remarks",
      ],
    ];

    lot.records.forEach((r, idx) => {
      matchRows.push([
        idx + 1,
        r.client?.boid || "",
        r.client?.full_name || "Shareholder",
        r.company?.company_name || lot.companyName || "",
        r.payable_type || lot.payableType,
        r.result,
        Number(Number(r.expected_amount || 0).toFixed(2)),
        Number(Number(r.actual_amount || 0).toFixed(2)),
        Number(Number(r.difference || 0).toFixed(2)),
        r.client?.bank_name || (r as any).bank_name || "",
        r.client?.bank_account_no || (r as any).bank_account_no || "",
        r.notes || "",
      ]);
    });

    const wb = XLSX.utils.book_new();
    const wsClass = XLSX.utils.aoa_to_sheet(classRows);
    const wsMatches = XLSX.utils.aoa_to_sheet(matchRows);

    wsClass["!cols"] = [
      { wch: 6 },
      { wch: 28 },
      { wch: 28 },
      { wch: 16 },
      { wch: 14 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 18 },
      { wch: 26 },
      { wch: 24 },
      { wch: 24 },
    ];

    wsMatches["!cols"] = [
      { wch: 6 },
      { wch: 20 },
      { wch: 30 },
      { wch: 28 },
      { wch: 16 },
      { wch: 20 },
      { wch: 26 },
      { wch: 26 },
      { wch: 16 },
      { wch: 25 },
      { wch: 22 },
      { wch: 40 },
    ];

    XLSX.utils.book_append_sheet(wb, wsClass, "Classification Summary");
    XLSX.utils.book_append_sheet(wb, wsMatches, "Shareholder List");

    const safeLotName = lot.lotName.replace(/[^a-zA-Z0-9_-]/g, "_");
    XLSX.writeFile(wb, `Reconciliation_Lot_${safeLotName}.xlsx`);
    toast.success(`Exported Excel workbook (${lot.records.length} records) for ${lot.lotName}`);
  };

  const [totalHistoryRecords, setTotalHistoryRecords] = useState(0);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadHistory = useCallback(
    async (limit = 1000, offset = 0) => {
      setIsLoadingHistory(true);
      setHistoryError(null);
      try {
        const [results, count, runsData] = await Promise.all([
          ReconciliationService.getResults(limit, offset),
          ReconciliationService.getResultsCount(),
          ReconciliationService.getReconciliationRuns({
            companyId: historyCompanyFilter !== "all" ? historyCompanyFilter : null,
            sourceType: historySourceFilter !== "all" ? historySourceFilter : undefined,
            search: historySearchQuery || undefined,
            limit: 100,
            offset: 0,
          }),
        ]);
        setSavedResults(results);
        setTotalHistoryRecords(count);
        if (runsData) {
          setReconciliationRuns(runsData.runs);
          setTotalRunsCount(runsData.totalCount);
          setRunsSummary(runsData.summary);
        }
      } catch (error: any) {
        console.error("Could not load reconciliation history:", error);
        setHistoryError(
          error?.message || "Failed to load reconciliation run history from the server.",
        );
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [historyCompanyFilter, historySourceFilter, historySearchQuery],
  );

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const processExcelFiles = async (files: File[]) => {
    if (!files.length) return;

    setIsProcessing(true);
    setProcessingProgress(
      files.length > 1
        ? `Classifying and analyzing ${files.length} files...`
        : `Analyzing ${files[0].name}...`,
    );
    try {
      // Finding 1: Classify each file independently and reject mixed-mode batches
      const classifications = await Promise.all(
        files.map(async (f) => ({
          file: f,
          type: await classifyReconciliationFile(f),
        })),
      );

      const ambiguousFiles = classifications
        .filter((c) => c.type === "ambiguous")
        .map((c) => c.file);

      if (ambiguousFiles.length > 0) {
        toast.error(
          `Indeterminate file format: ${ambiguousFiles.map((f) => f.name).join(", ")}. Upload rejected because the file does not contain recognizable settlement or shareholder registry headers.`,
          { duration: 8000 },
        );
        return;
      }

      const bankFiles = classifications
        .filter((c) => c.type === "bank_statement")
        .map((c) => c.file);
      const registryFiles = classifications
        .filter((c) => c.type === "shareholder_registry")
        .map((c) => c.file);

      if (bankFiles.length > 0 && registryFiles.length > 0) {
        toast.error(
          `Mixed upload rejected: Batch contains ${bankFiles.length} bank settlement file(s) and ${registryFiles.length} shareholder register file(s). Please upload bank settlement reports and shareholder registries separately to prevent misinterpretation.`,
          { duration: 8000 },
        );
        return;
      }

      if (bankFiles.length > 0) {
        if (!reconCompanyIds.length || !reconCompanyIds[0]) {
          toast.error(
            "Target company selection is required before analyzing and ingesting settlement reports.",
          );
          return;
        }
        try {
          const {
            transactions,
            perFileTransactions,
            fileStatuses,
            hasFailures,
            duplicateCount,
            variantWarnings,
          } = await BankParser.parseMultipleFilesWithProvenance(bankFiles, {
            onProgress: (cur, tot, name) =>
              setProcessingProgress(`Analyzing settlement report ${cur} of ${tot}: ${name}`),
          });

          setParsedFileStatuses(fileStatuses);
          setVariantAlerts(variantWarnings);

          // Finding 2: Individual parse failures must be visible and block partial application
          if (hasFailures) {
            const failedNames = fileStatuses
              .filter((s) => s.status === "failed")
              .map((s) => `${s.fileName} (${s.error || "Parse error"})`)
              .join("; ");
            toast.error(
              `Parse failed for ${fileStatuses.filter((s) => s.status === "failed").length} file(s): ${failedNames}. Partial batches cannot be applied.`,
              { duration: 9000 },
            );
            return;
          }

          if (variantWarnings.length > 0) {
            toast.warning(`Source variant discrepancy detected: ${variantWarnings[0].reason}`, {
              duration: 8000,
            });
          }

          if (transactions.length > 0) {
            // Persist into immutable bank ledger per file with provenance (fail closed)
            const targetCompany = reconCompanyIds.length > 0 ? reconCompanyIds[0] : null;
            for (const file of bankFiles) {
              const fileTxns = perFileTransactions.get(file) || [];
              if (fileTxns.length === 0) continue;
              setProcessingProgress(`Persisting ledger for ${file.name}...`);
              await ReconciliationService.ingestBankStatementFile(targetCompany, file, fileTxns);
            }

            setProcessingProgress("Performing 5-way multi-source reconciliation...");
            const rep = await ReconciliationEngine.analyzeBankStatement(transactions, {
              fileName: bankFiles.map((f) => f.name).join(", "),
              companyIds: reconCompanyIds.length > 0 ? reconCompanyIds : null,
            });
            setReport(rep);
            toast.success(
              `Successfully analyzed ${bankFiles.length} settlement file(s) with ${transactions.length.toLocaleString()} total transactions${duplicateCount > 0 ? ` (${duplicateCount} duplicate files skipped)` : ""}`,
            );
            return;
          } else {
            toast.error("No valid settlement transactions found in the uploaded file(s).");
            return;
          }
        } catch (bErr: any) {
          console.error("Settlement report parser error:", bErr);
          toast.error(
            `Failed to process settlement file: ${bErr?.message || "Invalid layout"}. Refusing to misinterpret settlement data as shareholder registries.`,
          );
          return;
        }
      }

      // Default: parse as multi-file Excel records
      const parsedData = await ExcelParser.parseMultipleFiles(registryFiles, (cur, tot, name) => {
        setProcessingProgress(`Parsing Excel workbook ${cur} of ${tot}: ${name}`);
      });
      setProcessingProgress("Matching shareholder records against database...");
      const rep = await ReconciliationEngine.analyzeParsedExcel(parsedData, {
        companyIds: reconCompanyIds.length > 0 ? reconCompanyIds : undefined,
      });
      setReport(rep);
      setParsedFileStatuses(
        registryFiles.map((f) => ({
          file: f,
          fileName: f.name,
          fileHash: "",
          status: "parsed",
          transactionCount: parsedData.grandTotals?.totalRows || 0,
          rejectedCount: 0,
          acceptedCount: parsedData.grandTotals?.totalRows || 0,
        })),
      );
      setVariantAlerts([]);
      toast.success(
        `Successfully analyzed ${registryFiles.length} Excel file(s) (${rep.matches.length.toLocaleString()} records)`,
      );
    } catch (error) {
      console.error(error);
      toast.error("Failed to parse Excel file(s) for reconciliation");
    } finally {
      setIsProcessing(false);
      setProcessingProgress(null);
    }
  };

  const processBankStatementFiles = async (files: File[]) => {
    if (!files.length) return;

    if (!reconCompanyIds.length || !reconCompanyIds[0]) {
      toast.error(
        "Target company selection is required before analyzing and ingesting bank statements.",
      );
      return;
    }

    setIsProcessing(true);
    setProcessingProgress(
      files.length > 1
        ? `Preparing ${files.length} bank statements...`
        : `Parsing ${files[0].name}...`,
    );
    try {
      const {
        transactions,
        perFileTransactions,
        fileStatuses,
        hasFailures,
        duplicateCount,
        variantWarnings,
      } = await BankParser.parseMultipleFilesWithProvenance(files, {
        onProgress: (cur, tot, name) =>
          setProcessingProgress(`Parsing bank statement ${cur} of ${tot}: ${name}`),
      });

      setParsedFileStatuses(fileStatuses);
      setVariantAlerts(variantWarnings);

      if (hasFailures) {
        const failedNames = fileStatuses
          .filter((s) => s.status === "failed")
          .map((s) => `${s.fileName} (${s.error || "Parse error"})`)
          .join("; ");
        toast.error(
          `Parse failed for ${fileStatuses.filter((s) => s.status === "failed").length} file(s): ${failedNames}. Partial batches cannot be applied.`,
          { duration: 9000 },
        );
        return;
      }

      if (variantWarnings.length > 0) {
        toast.warning(`Source variant discrepancy detected: ${variantWarnings[0].reason}`, {
          duration: 8000,
        });
      }

      if (transactions.length > 0) {
        // Persist into immutable bank ledger per file with provenance (fail closed)
        const targetCompany = reconCompanyIds.length > 0 ? reconCompanyIds[0] : null;
        for (const file of files) {
          const fileTxns = perFileTransactions.get(file) || [];
          if (fileTxns.length === 0) continue;
          setProcessingProgress(`Persisting statement ledger for ${file.name}...`);
          await ReconciliationService.ingestBankStatementFile(targetCompany, file, fileTxns);
        }

        setProcessingProgress("Matching statement transactions with disbursements & payouts...");
        const rep = await ReconciliationEngine.analyzeBankStatement(transactions, {
          fileName: files.map((f) => f.name).join(", "),
          companyIds: reconCompanyIds.length > 0 ? reconCompanyIds : null,
        });
        setReport(rep);
        toast.success(
          `Successfully analyzed ${files.length} statement file(s) with ${transactions.length.toLocaleString()} total transactions${duplicateCount > 0 ? ` (${duplicateCount} duplicate files skipped)` : ""}`,
        );
      } else {
        toast.error("No valid transactions found in the uploaded file(s).");
      }
    } catch (error: any) {
      console.error(error);
      toast.error(
        `Bank statement ingestion failed: ${error?.message || "Failed to parse bank statement file(s)"}`,
      );
    } finally {
      setIsProcessing(false);
      setProcessingProgress(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canApply) {
      toast.error("Unauthorized: Read-only accounts cannot upload files for reconciliation.");
      return;
    }
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    await processExcelFiles(files);
  };

  const handleBankStatementUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canApply) {
      toast.error(
        "Unauthorized: Read-only accounts cannot upload bank statements for reconciliation.",
      );
      return;
    }
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    await processBankStatementFiles(files);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingOver) setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      // Route through processExcelFiles which classifies each file and rejects mixed batches
      await processExcelFiles(files);
    }
  };

  const filteredMatches = useMemo(() => {
    if (!report?.matches) return [];

    return report.matches.filter((match) => {
      const matchesSearch =
        !searchQuery ||
        match.boid.toLowerCase().includes(searchQuery.toLowerCase()) ||
        match.shareholderName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        match.category.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus = statusFilter === "all" || match.status === statusFilter;
      const matchesSource = sourceFilter === "all" || match.sourceType === sourceFilter;
      const matchesCategory =
        selectedCategoryFilter === "all" || match.category === selectedCategoryFilter;

      return matchesSearch && matchesStatus && matchesSource && matchesCategory;
    });
  }, [report, searchQuery, statusFilter, sourceFilter, selectedCategoryFilter]);

  const unmatchedBankMatches = useMemo(() => {
    return filteredMatches.filter(
      (m) => m.sourceType === "bank_statement" && m.status === "Missing",
    );
  }, [filteredMatches]);

  const rejectedMatches = useMemo(() => {
    return filteredMatches.filter((m) => m.status === "Rejected");
  }, [filteredMatches]);

  const matchedOnlyMatches = useMemo(() => {
    return filteredMatches.filter((m) => m.status === "Matched");
  }, [filteredMatches]);

  const partialMatches = useMemo(() => {
    return filteredMatches.filter((m) => m.status === "Under_Paid" || m.status === "Over_Paid");
  }, [filteredMatches]);

  const exceptionsSummary = useMemo(() => {
    return extractReconciliationExceptions(filteredMatches, 1.0);
  }, [filteredMatches]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, sourceFilter, selectedCategoryFilter, report]);

  const paginatedFilteredMatches = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredMatches.slice(start, start + pageSize);
  }, [filteredMatches, currentPage, pageSize]);

  const paginatedMatchedOnly = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return matchedOnlyMatches.slice(start, start + pageSize);
  }, [matchedOnlyMatches, currentPage, pageSize]);

  const paginatedPartial = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return partialMatches.slice(start, start + pageSize);
  }, [partialMatches, currentPage, pageSize]);

  const paginatedRejected = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return rejectedMatches.slice(start, start + pageSize);
  }, [rejectedMatches, currentPage, pageSize]);

  const paginatedUnmatchedBank = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return unmatchedBankMatches.slice(start, start + pageSize);
  }, [unmatchedBankMatches, currentPage, pageSize]);

  const renderPaginationToolbar = (totalItems: number) => {
    if (totalItems === 0) return null;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalItems);

    return (
      <div className="flex items-center justify-between border-t pt-3 mt-3 text-xs text-muted-foreground flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span>
            Showing <strong className="text-foreground">{startItem.toLocaleString()}</strong> to{" "}
            <strong className="text-foreground">{endItem.toLocaleString()}</strong> of{" "}
            <strong className="text-foreground">{totalItems.toLocaleString()}</strong> records
          </span>
          <Select
            value={String(pageSize)}
            onValueChange={(val) => {
              setPageSize(Number(val));
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="h-7 w-[95px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25 / page</SelectItem>
              <SelectItem value="50">50 / page</SelectItem>
              <SelectItem value="100">100 / page</SelectItem>
              <SelectItem value="250">250 / page</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
          >
            Previous
          </Button>
          <span className="px-2 font-medium text-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
          >
            Next
          </Button>
        </div>
      </div>
    );
  };

  const renderCompanyMultiSelect = (
    triggerClassName: string = "w-[210px] h-9 text-xs",
    placeholder: string = "All Companies",
  ) => {
    const selectedCount = reconCompanyIds.length;
    const isAll = selectedCount === 0;
    const displayText = isAll
      ? placeholder
      : selectedCount === 1
        ? companiesList.find((c) => c.id === reconCompanyIds[0])?.company_name ||
          "1 Company Selected"
        : `${selectedCount} Companies Selected`;

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={`${triggerClassName} justify-between text-left font-normal`}
          >
            <div className="flex items-center gap-1.5 truncate">
              <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="truncate">{displayText}</span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 ml-2 opacity-50 flex-shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2 shadow-lg" align="start">
          <div className="space-y-1">
            <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">
              Target Reconciliation Scheme(s)
            </div>
            <div
              className={`flex items-center space-x-2 px-2 py-1.5 rounded-md hover:bg-muted cursor-pointer transition-colors ${
                isAll ? "bg-muted font-medium" : ""
              }`}
              onClick={() => {
                setReconCompanyIds([]);
                if (report) setReport(null);
              }}
            >
              <Checkbox checked={isAll} />
              <span className="text-xs">All Companies</span>
            </div>
            <div className="border-t my-1" />
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {companiesList.map((c) => {
                const isChecked = reconCompanyIds.includes(c.id);
                return (
                  <div
                    key={c.id}
                    className={`flex items-center space-x-2 px-2 py-1.5 rounded-md hover:bg-muted cursor-pointer transition-colors ${
                      isChecked ? "bg-primary/5 text-primary font-medium" : ""
                    }`}
                    onClick={() => {
                      let updated: string[];
                      if (isChecked) {
                        updated = reconCompanyIds.filter((id) => id !== c.id);
                      } else {
                        updated = [...reconCompanyIds, c.id];
                      }
                      setReconCompanyIds(updated);
                      if (report) setReport(null);
                    }}
                  >
                    <Checkbox checked={isChecked} />
                    <span className="text-xs truncate flex-1">{c.company_name}</span>
                    {c.company_code && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono">
                        {c.company_code}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  const [acknowledgedExceptions, setAcknowledgedExceptions] = useState<Set<string>>(new Set());

  const handleAcknowledgeException = (excId: string) => {
    setAcknowledgedExceptions((prev) => new Set(prev).add(excId));
  };

  const openRemediationForMatches = () => {
    const items: RejectedAccountItem[] = rejectedMatches.map((m) => ({
      payable_id: m.payableId || (m as any).payable_id || "",
      payable_type: ((m.payableType as any) || "interest") as any,
      client_id: m.clientId || (m as any).client_id || null,
      full_name: m.shareholderName || (m as any).name || "Shareholder",
      boid: (m as any).boid || null,
      pan_or_citizenship: (m as any).pan_or_citizenship || null,
      current_bank_name: (m as any).bankName || (m as any).bank_name || null,
      current_bank_account_no: (m as any).accountNumber || (m as any).bank_account_no || null,
      rejection_reason: m.transactionDescription || m.category || "ConnectIPS / CBS rejection",
      net_payable: m.systemAmount || m.excelAmount || 0,
    }));
    setRemediationItems(items);
    setRemediationDialogOpen(true);
  };

  const openRemediationForLot = (lotRecords: ReconciliationResultRow[]) => {
    const items: RejectedAccountItem[] = lotRecords
      .filter((r) => r.result === "Rejected")
      .map((r) => ({
        payable_id: r.payable_id || r.id,
        payable_type: ((r.payable_type as any) || "interest") as any,
        client_id: r.client_id || null,
        full_name: (r as any).client?.full_name || (r as any).full_name || "Shareholder",
        boid: (r as any).client?.boid || (r as any).boid || null,
        pan_or_citizenship: (r as any).client?.pan_or_citizenship || null,
        current_bank_name: (r as any).bank_name || (r as any).client?.bank_name || null,
        current_bank_account_no:
          (r as any).bank_account_no || (r as any).client?.bank_account_no || null,
        rejection_reason: r.notes || "Rejected payment record",
        net_payable: r.expected_amount || r.actual_amount || 0,
      }));
    setRemediationItems(items);
    setRemediationDialogOpen(true);
  };

  const isUUID = (str: any): boolean =>
    typeof str === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

  const buildResults = (targetMatches?: ReconciliationMatch[]) => {
    const matchesToConvert = targetMatches || report?.matches || [];
    if (!matchesToConvert.length) return [];
    const today = new Date().toISOString().slice(0, 10);
    return matchesToConvert.map((match) => {
      const isBankStatement = report?.sourceType === "bank_statement";
      const clientId = isUUID(match.clientId) ? match.clientId : null;
      const companyId = isUUID(match.companyId) ? match.companyId : null;
      const payableId = isUUID(match.payableId) ? match.payableId : null;
      const paymentId = isUUID(match.paymentId) ? match.paymentId : null;
      const batchId = isUUID(match.batchId) ? match.batchId : null;
      const isBatch = Boolean(batchId) || match.matchSources?.includes("payment_batch");
      const sourceBId = isBankStatement ? paymentId || batchId || payableId : payableId;
      const sourceBType = isBankStatement
        ? paymentId
          ? "payment"
          : isBatch
            ? "batch"
            : "payable"
        : "payable";

      const fileNamePrefix = report?.fileName ? `File: ${report.fileName}` : "";
      const lotPrefix = match.lotName ? `Lot: ${match.lotName}` : "";
      const holderPrefix = match.shareholderName
        ? `Holder: ${match.shareholderName}${match.boid ? ` | BOID: ${match.boid}` : ""}`
        : "";
      const contextPrefix = [fileNamePrefix, lotPrefix, holderPrefix].filter(Boolean).join(" | ");

      return {
        reconciliation_date: today,
        source_a_type: isBankStatement ? "bank_statement" : "excel",
        source_a_id: null,
        source_b_type: sourceBType,
        source_b_id: sourceBId,
        client_id: clientId,
        company_id: companyId,
        fiscal_year: match.fiscalYear || null,
        payable_type:
          match.payableType ||
          (report?.fileName?.toLowerCase().includes("debenture") ||
          report?.fileName?.toLowerCase().includes("interest")
            ? "interest"
            : isBankStatement
              ? "interest"
              : "dividend"),
        payable_id: payableId,
        payment_id: paymentId,
        batch_id: batchId,
        expected_amount: match.systemAmount,
        actual_amount: match.excelAmount,
        difference: match.difference,
        result: match.status,
        notes:
          `${contextPrefix ? `[${contextPrefix}] ` : ""}Category: ${match.category}${isBankStatement ? ` / Bank Transaction ${match.transactionDate ?? ""}` : ""}${match.matchSources ? ` / Sources: ${match.matchSources.join(", ")}` : ""}${match.transactionDescription ? ` / Remarks: ${match.transactionDescription}` : ""}`.trim(),
        matched_by: null,
        matched_at: null,
        instruction_id:
          (match as any).instructionId ||
          (match as any).instruction_id ||
          (match as any).referenceId ||
          null,
        connectips_ref:
          (match as any).instructionId ||
          (match as any).instruction_id ||
          (match as any).referenceId ||
          null,
        bank_name: match.bankName || null,
        bank_account_no: match.bankAccountNo || null,
        lot_name: match.lotName || null,
        match_method: match.matchMethod || "instruction_id",
        match_confidence: match.confidenceScore || 80,
        candidate_count: match.candidateCount || 1,
        rejected_candidates: match.rejectedCandidates || [],
        rule_version: match.ruleVersion || "2.0.0",
        requires_manual_approval: match.requiresManualApproval || false,
      };
    });
  };

  const handleSaveReconciliation = async () => {
    if (!canApply) {
      toast.error("Unauthorized: Read-only accounts cannot modify reconciliation data.");
      return;
    }
    if (!report?.matches?.length) {
      toast.error("No reconciliation report to save.");
      return;
    }

    setIsSaving(true);
    try {
      const results = buildResults();
      await ReconciliationService.saveResults(results);
      toast.success(`Saved ${results.length.toLocaleString()} reconciliation records.`);
      await loadHistory();
    } catch (error) {
      console.error("Save reconciliation failed:", error);
      toast.error("Failed to save reconciliation results.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearHistory = async () => {
    if (!isAdmin) {
      toast.error("Only administrators are authorized to clear reconciliation history.");
      return;
    }
    if (!window.confirm("Are you sure you want to clear saved reconciliation history logs?"))
      return;
    setIsLoadingHistory(true);
    try {
      const ok = await ReconciliationService.clearHistory();
      if (ok) {
        toast.success("Reconciliation history cleared.");
        setSavedResults([]);
      } else {
        toast.error("Failed to clear history.");
      }
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleRevertReconciliation = async () => {
    if (!isAdmin) {
      toast.error("Only administrators are authorized to revert reconciliation.");
      return;
    }
    if (
      !window.confirm(
        'Are you sure you want to revert auto-reconciled payments? This will set payables back to "Pending" and delete auto-created reconciliation payments.',
      )
    )
      return;
    setIsApplying(true);
    try {
      const res = await ReconciliationService.revertReconciliation();
      if (res.success) {
        toast.success(
          `Reverted: ${res.revertedPayables} payables reset to Pending, ${res.deletedPayments} payment records removed.`,
        );
        qc.invalidateQueries({ queryKey: ["payments"] });
        qc.invalidateQueries({ queryKey: ["payables"] });
        qc.invalidateQueries({ queryKey: ["interest_payables"] });
        qc.invalidateQueries({ queryKey: ["dividend_payables"] });
        qc.invalidateQueries({ queryKey: ["mutual_fund_payables"] });
        await loadHistory();
      } else {
        toast.error("Failed to revert reconciliation payments.");
      }
    } finally {
      setIsApplying(false);
    }
  };

  const handleApplyReconciliation = () => {
    if (!canApply) {
      toast.error("Unauthorized: You do not have permission to apply reconciliation.");
      return;
    }
    if (!report?.matches?.length) {
      toast.error("No reconciliation report to apply.");
      return;
    }

    const matchedCount = report.matches.filter((m) => m.status === "Matched").length;
    const partialCount = report.matches.filter(
      (m) => m.status === "Over_Paid" || m.status === "Under_Paid",
    ).length;
    const rejectCount = report.matches.filter((m) => m.status === "Rejected").length;

    if (matchedCount === 0 && partialCount === 0 && rejectCount === 0) {
      toast.warning(
        "No matching pending payables were found in the system for this file. All rows are currently marked as 'Missing'. Ensure payables are imported for this company/fiscal year, or verify that the uploaded file matches your pending disbursements.",
        { duration: 7000 },
      );
      return;
    }

    setPostingIsAll(true);
    setShowPostingModal(true);
  };

  const handleConfirmPosting = async () => {
    if (!report?.matches) return;
    const targetMatches = postingIsAll
      ? report.matches
      : report.matches.filter((m) => selectedMatchIds.has(m.id));

    setIsApplying(true);
    try {
      const results = buildResults(targetMatches);
      const applyRes = await ReconciliationService.applyReconciliation(
        results as unknown as ReconciliationResultRow[],
        "ConnectIPS",
        {
          fileName: report.fileName,
          sourceType: report.sourceType,
        },
      );

      if (
        applyRes.updated === 0 &&
        applyRes.paymentsCreated === 0 &&
        (applyRes.rejectedCount ?? 0) > 0
      ) {
        toast.success(
          `Successfully recorded ${applyRes.rejectedCount} rejected payout transaction(s) into reconciliation run audit trail and exceptions ledger.`,
        );
      } else if (
        applyRes.updated === 0 &&
        applyRes.paymentsCreated === 0 &&
        (applyRes.alreadyPaid ?? 0) > 0
      ) {
        toast.info(
          `All ${applyRes.alreadyPaid} records are already marked as Paid / Completed in the system.`,
        );
      } else if (
        applyRes.updated === 0 &&
        applyRes.paymentsCreated === 0 &&
        applyRes.errors?.length > 0
      ) {
        toast.error(`Reconciliation apply skipped: ${applyRes.errors[0]}`);
      } else if (applyRes.updated === 0 && applyRes.paymentsCreated === 0) {
        toast.warning(
          "Applied reconciliation: 0 payables updated. Check that records have matching pending payables in the system.",
        );
      } else {
        const alreadyNote =
          (applyRes.alreadyPaid ?? 0) > 0 ? ` (${applyRes.alreadyPaid} already paid)` : "";
        const rejNote =
          (applyRes.rejectedCount ?? 0) > 0 ? ` (${applyRes.rejectedCount} rejected recorded)` : "";
        const skippedNote =
          applyRes.errors?.length > 0 ? ` (${applyRes.errors.length} unlinked items skipped)` : "";
        toast.success(
          `Applied reconciliation: ${applyRes.updated} payables updated, ${applyRes.paymentsCreated} payments created${alreadyNote}${rejNote}${skippedNote}.`,
        );
      }
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["payables"] });
      qc.invalidateQueries({ queryKey: ["interest_payables"] });
      qc.invalidateQueries({ queryKey: ["dividend_payables"] });
      qc.invalidateQueries({ queryKey: ["mutual_fund_payables"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      qc.invalidateQueries({ queryKey: ["dashboard-operational-metrics"] });

      // Update in-memory matches
      setReport((prev) => {
        if (!prev) return null;
        const targetIds = new Set(targetMatches.map((m) => m.id));
        return {
          ...prev,
          matches: prev.matches.map((m) => {
            if (!targetIds.has(m.id)) return m;
            if (m.status === "Matched") return { ...m, status: "Paid" as any };
            return m;
          }),
        };
      });

      if (!postingIsAll) {
        setSelectedMatchIds(new Set());
      }
      await loadHistory();
    } catch (err: any) {
      console.error("Reconciliation apply error:", err);
      toast.error(`Failed to apply reconciliation: ${err?.message || err}`);
    } finally {
      setIsApplying(false);
    }
  };

  const handleExportReport = () => {
    if (!report?.matches) return;

    // 1. Sheet 1: Classification Summary
    const classificationRows: any[] = [
      [
        "S.N.",
        "Classification / Category",
        "Total Records",
        "Total Kitta",
        "Gross Amount (NPR)",
        "TDS Tax (NPR)",
        "Net Payable (NPR)",
        "Exact Matched",
        "Partial / Discrepancy",
        "Reconciliation Status",
      ],
    ];

    if (report.categories && report.categories.length > 0) {
      report.categories.forEach((cat, idx) => {
        classificationRows.push([
          idx + 1,
          cat.categoryName,
          cat.rowCount,
          cat.totalKitta || 0,
          Number((cat.totalGrossAmount || 0).toFixed(2)),
          Number((cat.totalTaxAmount || 0).toFixed(2)),
          Number((cat.totalNetPayable || 0).toFixed(2)),
          cat.matchedCount || 0,
          cat.mismatchedCount || 0,
          cat.matchedCount === cat.rowCount
            ? "Fully Reconciled"
            : cat.matchedCount > 0
              ? "Partially Reconciled"
              : "Pending Reconciliation",
        ]);
      });
    }

    // 2. Sheet 2: Shareholder Reconciliation List
    const matchRows: any[] = [
      [
        "S.N.",
        "BOID",
        "Shareholder Name",
        "Classification / Category",
        "Reconciliation Status",
        "Expected System Amount (NPR)",
        "Actual Excel/Bank Amount (NPR)",
        "Variance (NPR)",
        "Bank Name",
        "Account Number",
        "Payable Type",
        "Fiscal Year",
        "Match Sources",
        "Confidence Score (%)",
        "Narration / Notes",
      ],
    ];

    filteredMatches.forEach((m, idx) => {
      matchRows.push([
        idx + 1,
        m.boid || "",
        m.shareholderName || "Shareholder",
        m.category || "",
        m.status || "",
        Number(Number(m.systemAmount ?? 0).toFixed(2)),
        Number(Number(m.excelAmount ?? 0).toFixed(2)),
        Number(Number(m.difference ?? 0).toFixed(2)),
        m.bankName || "",
        m.bankAccountNo || "",
        m.payableType || "",
        m.fiscalYear || "",
        m.matchSources?.join(", ") || "None",
        m.confidenceScore ?? 0,
        m.transactionDescription || "",
      ]);
    });

    const wb = XLSX.utils.book_new();
    const wsClass = XLSX.utils.aoa_to_sheet(classificationRows);
    const wsMatches = XLSX.utils.aoa_to_sheet(matchRows);

    wsClass["!cols"] = [
      { wch: 6 },
      { wch: 32 },
      { wch: 15 },
      { wch: 15 },
      { wch: 20 },
      { wch: 16 },
      { wch: 20 },
      { wch: 15 },
      { wch: 22 },
      { wch: 24 },
    ];

    wsMatches["!cols"] = [
      { wch: 6 },
      { wch: 20 },
      { wch: 30 },
      { wch: 25 },
      { wch: 18 },
      { wch: 22 },
      { wch: 24 },
      { wch: 16 },
      { wch: 25 },
      { wch: 22 },
      { wch: 16 },
      { wch: 14 },
      { wch: 20 },
      { wch: 18 },
      { wch: 40 },
    ];

    XLSX.utils.book_append_sheet(wb, wsClass, "Classification Summary");
    XLSX.utils.book_append_sheet(wb, wsMatches, "Shareholder List");

    const safeFileName = (report.fileName || "reconciliation-report").replace(
      /[^a-zA-Z0-9_-]/g,
      "_",
    );
    XLSX.writeFile(
      wb,
      `Reconciliation_${safeFileName}_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
    toast.success("Excel report exported with Classification Summary & Shareholder List");
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "Matched":
        return "default";
      case "Missing":
        return "destructive";
      case "Over_Paid":
      case "Under_Paid":
        return "outline";
      case "Pledged":
        return "secondary";
      case "Rejected":
        return "destructive";
      case "Pending":
        return "outline";
      default:
        return "outline";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Matched":
        return <CheckCircle2 className="w-4 h-4 text-green-600" />;
      case "Missing":
        return <XCircle className="w-4 h-4 text-red-600" />;
      case "Over_Paid":
      case "Under_Paid":
        return <AlertTriangle className="w-4 h-4 text-amber-600" />;
      default:
        return null;
    }
  };

  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(new Set());

  const toggleSelectMatch = (id: string) => {
    setSelectedMatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    if (selectedMatchIds.size === filteredMatches.length) {
      setSelectedMatchIds(new Set());
    } else {
      setSelectedMatchIds(new Set(filteredMatches.map((m) => m.id)));
    }
  };

  const selectOnlyMatched = () => {
    setSelectedMatchIds(new Set(matchedOnlyMatches.map((m) => m.id)));
  };

  const selectOnlyRejected = () => {
    setSelectedMatchIds(new Set(rejectedMatches.map((m) => m.id)));
  };

  const clearSelection = () => {
    setSelectedMatchIds(new Set());
  };

  const handleApplySelected = () => {
    if (!canApply) {
      toast.error("Unauthorized: You do not have permission to apply reconciliation.");
      return;
    }
    if (selectedMatchIds.size === 0) return;
    const selectedMatches = (report?.matches || []).filter((m) => selectedMatchIds.has(m.id));
    if (selectedMatches.length === 0) return;

    setPostingIsAll(false);
    setShowPostingModal(true);
  };

  const handleExportSelected = () => {
    const toExport = (report?.matches || []).filter((m) => selectedMatchIds.has(m.id));
    if (toExport.length === 0) return;

    // 1. Sheet 1: Classification Summary for Selected
    const categoryMap = new Map<
      string,
      { count: number; expected: number; actual: number; matched: number }
    >();
    toExport.forEach((m) => {
      const cat = m.category || "General";
      if (!categoryMap.has(cat)) {
        categoryMap.set(cat, { count: 0, expected: 0, actual: 0, matched: 0 });
      }
      const entry = categoryMap.get(cat)!;
      entry.count += 1;
      entry.expected += Number(m.systemAmount || 0);
      entry.actual += Number(m.excelAmount || 0);
      if (m.status === "Matched") entry.matched += 1;
    });

    const classificationRows: any[] = [
      [
        "S.N.",
        "Classification / Category",
        "Selected Records",
        "Expected System Amount (NPR)",
        "Actual Settled Amount (NPR)",
        "Variance (NPR)",
        "Matched Count",
      ],
    ];

    Array.from(categoryMap.entries()).forEach(([catName, stats], idx) => {
      classificationRows.push([
        idx + 1,
        catName,
        stats.count,
        Number(stats.expected.toFixed(2)),
        Number(stats.actual.toFixed(2)),
        Number((stats.expected - stats.actual).toFixed(2)),
        stats.matched,
      ]);
    });

    // 2. Sheet 2: Selected Shareholder List
    const matchRows: any[] = [
      [
        "S.N.",
        "BOID",
        "Shareholder Name",
        "Classification / Category",
        "Reconciliation Status",
        "Expected System Amount (NPR)",
        "Actual Excel/Bank Amount (NPR)",
        "Variance (NPR)",
        "Bank Name",
        "Account Number",
        "Payable Type",
        "Fiscal Year",
        "Match Sources",
        "Confidence Score (%)",
        "Narration / Notes",
      ],
    ];

    toExport.forEach((m, idx) => {
      matchRows.push([
        idx + 1,
        m.boid || "",
        m.shareholderName || "Shareholder",
        m.category || "",
        m.status || "",
        Number(Number(m.systemAmount ?? 0).toFixed(2)),
        Number(Number(m.excelAmount ?? 0).toFixed(2)),
        Number(Number(m.difference ?? 0).toFixed(2)),
        m.bankName || "",
        m.bankAccountNo || "",
        m.payableType || "",
        m.fiscalYear || "",
        m.matchSources?.join(", ") || "None",
        m.confidenceScore ?? 0,
        m.transactionDescription || "",
      ]);
    });

    const wb = XLSX.utils.book_new();
    const wsClass = XLSX.utils.aoa_to_sheet(classificationRows);
    const wsMatches = XLSX.utils.aoa_to_sheet(matchRows);

    wsClass["!cols"] = [
      { wch: 6 },
      { wch: 30 },
      { wch: 18 },
      { wch: 25 },
      { wch: 25 },
      { wch: 16 },
      { wch: 15 },
    ];

    wsMatches["!cols"] = [
      { wch: 6 },
      { wch: 20 },
      { wch: 30 },
      { wch: 25 },
      { wch: 18 },
      { wch: 22 },
      { wch: 24 },
      { wch: 16 },
      { wch: 25 },
      { wch: 22 },
      { wch: 16 },
      { wch: 14 },
      { wch: 20 },
      { wch: 18 },
      { wch: 40 },
    ];

    XLSX.utils.book_append_sheet(wb, wsClass, "Classification Summary");
    XLSX.utils.book_append_sheet(wb, wsMatches, "Selected Shareholder List");

    XLSX.writeFile(
      wb,
      `Reconciliation_Selected_${toExport.length}_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
    toast.success(`Exported Excel workbook with ${toExport.length} selected records`);
  };

  const renderMatchRow = (match: ReconciliationMatch) => {
    const isSelected = selectedMatchIds.has(match.id);

    return (
      <div
        key={match.id}
        className={`rounded-lg border p-3.5 transition-all ${
          isSelected
            ? "border-primary/50 bg-primary/5 shadow-sm"
            : "bg-background hover:bg-muted/30"
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="pt-0.5">
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggleSelectMatch(match.id)}
              aria-label={`Select ${match.shareholderName}`}
            />
          </div>
          <div className="flex-1 min-w-0">
            {/* Header: Name, BOID, Status Badges */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-foreground">
                  {match.shareholderName || "Unknown Shareholder"}
                </span>
                <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground border">
                  BOID: {match.boid}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge variant={getStatusBadgeVariant(match.status)} className="text-xs">
                  {match.status.replace("_", " ")}
                </Badge>
                {match.confidenceScore !== undefined && match.confidenceScore > 0 && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] h-5 font-semibold ${
                      match.confidenceScore >= 90
                        ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                        : match.confidenceScore >= 70
                          ? "border-amber-500/40 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                          : "border-rose-500/40 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400"
                    }`}
                  >
                    {match.confidenceScore}% Match
                  </Badge>
                )}
                {match.matchSources && match.matchSources.length > 0 && (
                  <div className="flex gap-1">
                    {match.matchSources.map((source) => (
                      <Badge key={source} variant="outline" className="text-[10px] h-5 capitalize">
                        {source}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Sub-row: Bank details & Category info */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-muted-foreground">
              {(match.bankName || match.bankAccountNo) && (
                <div className="flex items-center gap-1">
                  <CreditCard className="w-3.5 h-3.5 text-muted-foreground/70" />
                  <span>
                    <strong>{match.bankName || "Bank"}</strong>
                    {match.bankAccountNo ? ` • A/C: ${match.bankAccountNo}` : ""}
                  </span>
                </div>
              )}
              {match.payableType && (
                <div className="flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground/70" />
                  <span className="capitalize">{match.payableType} Payable</span>
                </div>
              )}
              {match.category && (
                <div>
                  <span>
                    Category: <strong className="text-foreground">{match.category}</strong>
                  </span>
                </div>
              )}
              {match.transactionDate && (
                <div>
                  <span>Txn Date: {match.transactionDate}</span>
                </div>
              )}
              {match.status === "Missing" &&
                match.transactionDate &&
                String(match.transactionDate) < "2026-01-01" && (
                  <Badge
                    variant="outline"
                    className="text-[10px] h-5 text-amber-700 dark:text-amber-300 border-amber-300/80 bg-amber-50 dark:bg-amber-950/40"
                  >
                    Prior FY (Historical)
                  </Badge>
                )}
            </div>

            {match.transactionDescription && (
              <div className="mt-1 text-[11px] text-muted-foreground/85 flex items-center gap-1.5 truncate">
                <span className="font-medium text-foreground/70">Narration / Ref:</span>
                <span className="font-mono truncate">{match.transactionDescription}</span>
              </div>
            )}

            {/* Financial comparison grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2.5 p-2 bg-muted/20 rounded-md border text-xs">
              <div>
                <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">
                  Excel / Bank
                </span>
                <span className="font-mono font-semibold text-foreground">
                  NPR {match.excelAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">
                  System Amount
                </span>
                <span className="font-mono font-semibold text-foreground">
                  NPR {match.systemAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">
                  Difference
                </span>
                <span
                  className={`font-mono font-bold ${
                    match.difference !== 0
                      ? "text-destructive"
                      : "text-green-600 dark:text-green-400"
                  }`}
                >
                  {match.difference !== 0
                    ? (match.difference > 0 ? "+" : "") +
                      match.difference.toLocaleString("en-IN", { minimumFractionDigits: 2 })
                    : "0.00"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">
                  Status in DB
                </span>
                <span className="font-medium text-foreground">
                  {match.paymentStatus ? (
                    <Badge
                      variant={match.paymentStatus === "Paid" ? "default" : "outline"}
                      className="text-[10px] h-4"
                    >
                      {match.paymentStatus}
                    </Badge>
                  ) : (
                    "Unpaid / Pending"
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <PageHeader
          title="Reconciliation Engine"
          description="5-way reconciliation: Excel vs Payables, Payments, Bank Statements with multi-source matching and discrepancy detection."
        />
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {renderCompanyMultiSelect("w-[210px] h-9 text-xs", "All Companies")}
            {canApply ? (
              <>
                <Button
                  variant="default"
                  className="cursor-pointer"
                  disabled={isProcessing || isSaving || isApplying}
                  onClick={() => headerExcelInputRef.current?.click()}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {isProcessing ? "Analyzing..." : "Upload Excel File(s)"}
                </Button>
                <input
                  ref={headerExcelInputRef}
                  id="reconcile-excel-upload"
                  type="file"
                  multiple
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button
                  variant="outline"
                  className="cursor-pointer"
                  disabled={isProcessing || isSaving || isApplying}
                  onClick={() => headerBankInputRef.current?.click()}
                >
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  {isProcessing ? "Analyzing..." : "Upload Bank Statement(s)"}
                </Button>
                <input
                  ref={headerBankInputRef}
                  id="reconcile-bank-upload"
                  type="file"
                  multiple
                  accept=".xls,.xlsx,.xlsm,.csv,.txt"
                  className="hidden"
                  onChange={handleBankStatementUpload}
                />
              </>
            ) : (
              <Badge
                variant="outline"
                className="text-amber-700 dark:text-amber-300 border-amber-300 bg-amber-50 dark:bg-amber-950/20 text-xs px-2.5 py-1"
              >
                Read-Only Audit Mode — Viewing Historical Lots & Verification Records
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Multi-file upload enabled • Hold Ctrl / Shift to select multiple files at once
          </p>
        </div>
      </div>

      {processingProgress && (
        <Alert className="bg-primary/5 border-primary/20 text-primary py-3">
          <div className="flex items-center gap-2.5">
            <RefreshCw className="w-4 h-4 animate-spin text-primary shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-xs tracking-tight">Processing Files...</span>
              <AlertDescription className="text-xs text-muted-foreground font-mono">
                {processingProgress}
              </AlertDescription>
            </div>
          </div>
        </Alert>
      )}

      {report ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-bold tracking-tight">Reconciliation Analysis</h2>
              <p className="text-sm text-muted-foreground">
                {report.sourceType === "excel" ? "Excel" : "Bank Statement"} • {report.fileName} •{" "}
                {report.matches.length.toLocaleString()} records
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canApply && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSaveReconciliation}
                  disabled={isSaving || isProcessing || isApplying}
                >
                  {isSaving ? "Saving..." : "Save Reconciliation"}
                </Button>
              )}
              {canApply && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleApplyReconciliation}
                  disabled={
                    isApplying ||
                    isProcessing ||
                    isSaving ||
                    report.matches.filter(
                      (m) =>
                        m.status === "Matched" ||
                        m.status === "Over_Paid" ||
                        m.status === "Under_Paid" ||
                        m.status === "Rejected",
                    ).length === 0
                  }
                  title={
                    report.matches.filter(
                      (m) =>
                        m.status === "Matched" ||
                        m.status === "Over_Paid" ||
                        m.status === "Under_Paid" ||
                        m.status === "Rejected",
                    ).length === 0
                      ? "No records matched against pending payables in the system"
                      : undefined
                  }
                >
                  {isApplying ? (
                    "Applying..."
                  ) : (
                    <>
                      <Play className="w-3 h-3 mr-1" /> Apply to System
                    </>
                  )}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleExportReport}>
                <Download className="w-4 h-4 mr-2" />
                Export Excel (.xlsx)
              </Button>
              <Button variant="outline" size="sm" onClick={() => setReport(null)}>
                <RefreshCw className="w-4 h-4 mr-2" />
                New Analysis
              </Button>
            </div>
          </div>

          {/* Source Variant Discrepancy Alert Banner (Finding 6) */}
          {variantAlerts.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    Source Variant Discrepancy Detected
                  </h4>
                  {variantAlerts.map((va, idx) => (
                    <p key={idx} className="text-xs text-amber-800 dark:text-amber-300">
                      • {va.reason} ({va.fileA}: {va.countA.toLocaleString()} rows vs {va.fileB}:{" "}
                      {va.countB.toLocaleString()} rows).
                    </p>
                  ))}
                  <p className="text-xs font-medium text-amber-900 dark:text-amber-200 pt-1">
                    Please confirm whether one file represents an incomplete version, copy, or
                    supplementary sheet before applying reconciliation.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Pre-Apply Source File Provenance & Classification Review (Finding 6) */}
          {parsedFileStatuses.length > 0 && (
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center justify-between pb-2 border-b">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-primary" />
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Source File Ingestion Provenance ({parsedFileStatuses.length} files)
                    </span>
                  </div>
                </div>
                <div className="divide-y text-xs mt-2 max-h-40 overflow-y-auto">
                  {parsedFileStatuses.map((fs, idx) => (
                    <div key={idx} className="py-1.5 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex items-center gap-2">
                        <FileSpreadsheet className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        <span className="font-medium truncate">{fs.fileName}</span>
                        {fs.status === "duplicate" && (
                          <Badge variant="outline" className="text-[10px] text-amber-600">
                            Duplicate (Skipped)
                          </Badge>
                        )}
                        {fs.status === "failed" && (
                          <Badge variant="destructive" className="text-[10px]">
                            Failed
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 shrink-0 text-muted-foreground font-mono text-[11px]">
                        <span>{fs.transactionCount.toLocaleString()} rows</span>
                        {fs.rejectedCount > 0 && (
                          <span className="text-red-600">
                            {fs.rejectedCount.toLocaleString()} rejects
                          </span>
                        )}
                        {fs.fileHash && (
                          <span
                            className="text-[10px] opacity-70"
                            title={`SHA-256: ${fs.fileHash}`}
                          >
                            Hash: {fs.fileHash.slice(0, 8)}...
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <ReconciliationDashboard report={report} />

          {report.summary && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground">Exact Matches</p>
                  <p className="text-lg font-bold text-green-600">
                    {report.grandTotal.matchedRecords}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground">Partial / Installments</p>
                  <p className="text-lg font-bold text-amber-600">
                    {report.grandTotal.partialRecords || 0}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground">Matched (Payment)</p>
                  <p className="text-lg font-bold text-blue-600">
                    {report.summary.matchedFromPayment}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground">Matched (Bank)</p>
                  <p className="text-lg font-bold text-purple-600">
                    {report.summary.matchedFromBank}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground">Missing in System</p>
                  <p className="text-lg font-bold text-red-600">{report.summary.missingInSystem}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground">Rejected / Bounced</p>
                  <p className="text-lg font-bold text-rose-600">
                    {report.grandTotal.rejectedCount}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {report.summary && (
            <Card className="bg-muted/30">
              <CardContent className="py-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">Overall Match Rate</span>
                  <span className="font-medium text-primary">
                    {Math.round(
                      (((report.grandTotal.matchedRecords || 0) +
                        (report.grandTotal.partialRecords || 0)) /
                        Math.max(1, report.grandTotal.totalRecords)) *
                        100,
                    )}
                    % (
                    {(report.grandTotal.matchedRecords || 0) +
                      (report.grandTotal.partialRecords || 0)}{" "}
                    of {report.grandTotal.totalRecords} matched
                    {(report.grandTotal.partialRecords || 0) > 0
                      ? ` • ${report.grandTotal.partialRecords} partial/installments`
                      : ""}
                    )
                  </span>
                </div>
                <div className="h-4 w-full bg-muted rounded-full overflow-hidden flex">
                  <div
                    className="bg-green-500 h-full transition-all"
                    style={{
                      width: `${(report.grandTotal.matchedRecords / Math.max(1, report.grandTotal.totalRecords)) * 100}%`,
                    }}
                    title={`Exact Matches (${report.grandTotal.matchedRecords})`}
                  />
                  {(report.grandTotal.partialRecords || 0) > 0 && (
                    <div
                      className="bg-amber-400 h-full transition-all"
                      style={{
                        width: `${((report.grandTotal.partialRecords || 0) / Math.max(1, report.grandTotal.totalRecords)) * 100}%`,
                      }}
                      title={`Partial / Installment Matches (${report.grandTotal.partialRecords})`}
                    />
                  )}
                  <div
                    className="bg-blue-500 h-full transition-all"
                    style={{
                      width: `${(report.summary.matchedFromPayment / Math.max(1, report.grandTotal.totalRecords)) * 100}%`,
                    }}
                    title="Matched from Payment"
                  />
                  <div
                    className="bg-purple-500 h-full transition-all"
                    style={{
                      width: `${(report.summary.matchedFromBank / Math.max(1, report.grandTotal.totalRecords)) * 100}%`,
                    }}
                    title="Matched from Bank"
                  />
                  <div
                    className="bg-red-500 h-full transition-all"
                    style={{
                      width: `${(report.summary.missingInSystem / Math.max(1, report.grandTotal.totalRecords)) * 100}%`,
                    }}
                    title="Missing"
                  />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-muted-foreground">
                  <div className="flex items-center">
                    <div className="w-2 h-2 rounded-full bg-green-500 mr-1" /> Exact Match
                  </div>
                  <div className="flex items-center">
                    <div className="w-2 h-2 rounded-full bg-amber-400 mr-1" /> Partial / Installment
                  </div>
                  <div className="flex items-center">
                    <div className="w-2 h-2 rounded-full bg-blue-500 mr-1" /> Payment Match
                  </div>
                  <div className="flex items-center">
                    <div className="w-2 h-2 rounded-full bg-purple-500 mr-1" /> Bank Match
                  </div>
                  <div className="flex items-center">
                    <div className="w-2 h-2 rounded-full bg-red-500 mr-1" /> Missing
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {report.categories && report.categories.length > 0 && (
            <Card className="border shadow-sm">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-primary" />
                    Classification Summary Breakdown
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    Exact category-wise totals across all sheets and settlement lots. Click any
                    category row to filter shareholder matches below.
                  </CardDescription>
                </div>
                {selectedCategoryFilter !== "all" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs text-primary"
                    onClick={() => setSelectedCategoryFilter("all")}
                  >
                    Clear Filter ({selectedCategoryFilter})
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 border-b">
                      <tr>
                        <th className="py-2.5 px-3 text-left font-semibold">
                          Classification / Category
                        </th>
                        <th className="py-2.5 px-3 text-right font-semibold">Shareholders</th>
                        <th className="py-2.5 px-3 text-right font-semibold">Total Kitta</th>
                        <th className="py-2.5 px-3 text-right font-semibold">Gross Amount (NPR)</th>
                        <th className="py-2.5 px-3 text-right font-semibold">TDS Tax (NPR)</th>
                        <th className="py-2.5 px-3 text-right font-semibold">Net Payable (NPR)</th>
                        <th className="py-2.5 px-3 text-right font-semibold text-green-600 dark:text-green-400">
                          Matched
                        </th>
                        <th className="py-2.5 px-3 text-right font-semibold text-amber-600 dark:text-amber-400">
                          Discrepancy
                        </th>
                        <th className="py-2.5 px-3 text-center font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {report.categories.map((cat) => {
                        const isSelected = selectedCategoryFilter === cat.categoryName;
                        return (
                          <tr
                            key={cat.categoryName}
                            className={`cursor-pointer transition-colors ${
                              isSelected ? "bg-primary/10 font-semibold" : "hover:bg-muted/40"
                            }`}
                            onClick={() =>
                              setSelectedCategoryFilter(isSelected ? "all" : cat.categoryName)
                            }
                          >
                            <td className="py-2.5 px-3 font-medium flex items-center gap-2">
                              <span>{cat.categoryName}</span>
                              {isSelected && (
                                <Badge variant="secondary" className="text-[10px] h-4">
                                  Filtered
                                </Badge>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono">
                              {cat.rowCount.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono">
                              {cat.totalKitta > 0 ? cat.totalKitta.toLocaleString() : "-"}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono">
                              {cat.totalGrossAmount > 0
                                ? cat.totalGrossAmount.toLocaleString("en-IN", {
                                    minimumFractionDigits: 2,
                                  })
                                : "-"}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">
                              {cat.totalTaxAmount > 0
                                ? cat.totalTaxAmount.toLocaleString("en-IN", {
                                    minimumFractionDigits: 2,
                                  })
                                : "-"}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-primary">
                              {cat.totalNetPayable > 0
                                ? cat.totalNetPayable.toLocaleString("en-IN", {
                                    minimumFractionDigits: 2,
                                  })
                                : "-"}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-green-600 dark:text-green-400 font-semibold">
                              {cat.matchedCount.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono">
                              {cat.mismatchedCount > 0 ? (
                                <span className="text-amber-600 dark:text-amber-400 font-semibold">
                                  {cat.mismatchedCount.toLocaleString()}
                                </span>
                              ) : (
                                "0"
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {cat.matchedCount === cat.rowCount ? (
                                <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-300 text-[10px] h-4">
                                  100% Matched
                                </Badge>
                              ) : cat.matchedCount > 0 ? (
                                <Badge
                                  variant="outline"
                                  className="text-amber-600 border-amber-300 text-[10px] h-4"
                                >
                                  Partial
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="text-[10px] h-4">
                                  Unmatched
                                </Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {report.grandTotal.matchedRecords === 0 &&
            (report.grandTotal.partialRecords || 0) === 0 &&
            report.matches.length > 0 && (
              <div className="flex items-start gap-2.5 p-3.5 bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 rounded-xl text-xs mb-3">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="font-semibold text-sm mb-1">
                    No Matching Records Found (0 Matches)
                  </p>
                  <p>
                    All {report.matches.length.toLocaleString()} records in this file are currently
                    categorized as &ldquo;Missing&rdquo; because no matching Pending payables or
                    payments could be found by Account Number, Shareholder Name, or ConnectIPS
                    Reference.
                  </p>
                  <ul className="list-disc pl-4 mt-1.5 space-y-1">
                    <li>
                      <strong>General Bank Statements:</strong> Consolidated sweep entries (e.g.{" "}
                      <em>NRB Circular</em>) and lump-sum batch debits (e.g. <em>IPS DR</em>)
                      require the individual ConnectIPS LOT settlement reports to be uploaded and
                      applied first so payment batches exist.
                    </li>
                    <li>
                      <strong>ConnectIPS Settlement Reports (LOT files):</strong> Ensure that the
                      underlying payables (Dividend, Interest/Debenture, or Mutual Fund) for this
                      company and fiscal year have been imported via the <strong>Upload</strong>{" "}
                      section.
                    </li>
                    <li>
                      <strong>Company Filter:</strong> Verify that the company selected in the top
                      filter matches the company whose disbursements are in this file.
                    </li>
                  </ul>
                </div>
              </div>
            )}

          {(report.grandTotal.partialRecords || 0) > 0 && (
            <div className="flex items-start gap-2.5 p-3.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-900 dark:text-emerald-200 rounded-xl text-xs mb-3">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="font-semibold text-sm mb-1">
                  Semi-Annual / Installment Matches Detected ({report.grandTotal.partialRecords}{" "}
                  records)
                </p>
                <p>
                  These records successfully matched shareholder accounts in the system with partial
                  payout amounts (e.g. semi-annual debenture interest). Applying reconciliation will
                  update these payables to <strong>&ldquo;Partial&rdquo;</strong> status and create
                  corresponding payment records with the disbursed installment amount.
                </p>
              </div>
            </div>
          )}

          {report?.sourceType === "bank_statement" && (
            <div className="flex items-start gap-2.5 p-3.5 bg-blue-500/10 border border-blue-500/20 text-blue-900 dark:text-blue-200 rounded-xl text-xs mb-3">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
              <div className="space-y-1.5">
                <p className="font-semibold text-sm">
                  Bank Statement Multi-Source Reconciliation Guide
                </p>
                <ul className="list-disc pl-4 space-y-1 text-muted-foreground dark:text-muted-foreground">
                  <li>
                    <strong className="text-foreground">Multi-Year Statements:</strong> Statements
                    spanning prior fiscal years (2021–2025) will show as &ldquo;Missing&rdquo;
                    because only the active fiscal year payables (e.g. FY 2082/83) are currently
                    imported.
                  </li>
                  <li>
                    <strong className="text-foreground">ConnectIPS Batch Withdrawals:</strong>{" "}
                    Lump-sum payout debits (e.g. <em>IPS DR</em> or bulk transfers) represent the
                    pool funding for ConnectIPS LOT settlement files (LOT 1, LOT 2, LOT 3). Ensure
                    the LOT settlement files are uploaded and applied first to register the payment
                    batches.
                  </li>
                  <li>
                    <strong className="text-foreground">Bounced Returns & Credits:</strong> Failed
                    payouts credited back into the bank account are automatically recognized and
                    flagged as bounced returns.
                  </li>
                </ul>
              </div>
            </div>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Filter & Search
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Search (BOID/Name/Category)</Label>
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="Matched">Matched</SelectItem>
                      <SelectItem value="Missing">Missing</SelectItem>
                      <SelectItem value="Over_Paid">Over Paid</SelectItem>
                      <SelectItem value="Under_Paid">Under Paid</SelectItem>
                      <SelectItem value="Pledged">Pledged</SelectItem>
                      <SelectItem value="Rejected">Rejected</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Source Type</Label>
                  <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sources</SelectItem>
                      <SelectItem value="excel">Excel Files</SelectItem>
                      <SelectItem value="bank_statement">Bank Statements</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {(searchQuery || statusFilter !== "all" || sourceFilter !== "all") && (
                <div className="mt-3 text-sm text-muted-foreground">
                  Showing {filteredMatches.length} of {report.matches.length} records
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle className="text-sm">Detailed Reconciliation Matches</CardTitle>
                  <CardDescription>
                    5-way matching: Payables • Payments • Bank Statements • Cross-references
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Smart Bulk Selection & Quick Actions Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 mb-3 bg-muted/30 rounded-lg border">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-medium cursor-pointer"
                    onClick={selectAllFiltered}
                  >
                    <CheckSquare className="w-3.5 h-3.5 mr-1.5" />
                    {selectedMatchIds.size === filteredMatches.length && filteredMatches.length > 0
                      ? "Deselect All"
                      : `Select All (${filteredMatches.length})`}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs cursor-pointer text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/20"
                    onClick={selectOnlyMatched}
                  >
                    Select Matched ({matchedOnlyMatches.length})
                  </Button>
                  {rejectedMatches.length > 0 && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs cursor-pointer text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                        onClick={selectOnlyRejected}
                      >
                        Select Rejected ({rejectedMatches.length})
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs cursor-pointer text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800"
                        onClick={openRemediationForMatches}
                      >
                        <CreditCard className="w-3.5 h-3.5 mr-1 text-amber-600" />
                        Remediate Accounts ({rejectedMatches.length})
                      </Button>
                    </>
                  )}
                  {selectedMatchIds.size > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                      onClick={clearSelection}
                    >
                      Clear ({selectedMatchIds.size})
                    </Button>
                  )}
                </div>

                {selectedMatchIds.size > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-primary">
                      {selectedMatchIds.size} selected
                    </span>
                    {canApply && (
                      <Button
                        size="sm"
                        className="h-8 text-xs font-medium cursor-pointer"
                        onClick={handleApplySelected}
                        disabled={isApplying}
                      >
                        <Play className="w-3.5 h-3.5 mr-1.5" />
                        Apply Selected (
                        {
                          (report.matches || []).filter(
                            (m) => selectedMatchIds.has(m.id) && m.status === "Matched",
                          ).length
                        }
                        )
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs font-medium cursor-pointer"
                      onClick={handleExportSelected}
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      Export Selected ({selectedMatchIds.size})
                    </Button>
                  </div>
                )}
              </div>

              <Tabs defaultValue="all" className="w-full">
                <TabsList className="mb-4">
                  <TabsTrigger value="all">All Records ({filteredMatches.length})</TabsTrigger>
                  <TabsTrigger value="matched">
                    Exact Matches ({matchedOnlyMatches.length})
                  </TabsTrigger>
                  <TabsTrigger value="partial">
                    Partial / Installments ({partialMatches.length})
                    {partialMatches.length > 0 && (
                      <Badge
                        variant="secondary"
                        className="ml-2 h-5 text-[10px] rounded-full px-1.5 min-w-[20px] justify-center bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
                      >
                        {partialMatches.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="rejected">
                    Rejected / Bounced ({rejectedMatches.length})
                    {rejectedMatches.length > 0 && (
                      <Badge
                        variant="destructive"
                        className="ml-2 h-5 text-[10px] rounded-full px-1.5 min-w-[20px] justify-center"
                      >
                        {rejectedMatches.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="unmatched_bank">
                    Unmatched Bank Txns
                    {unmatchedBankMatches.length > 0 && (
                      <Badge
                        variant="destructive"
                        className="ml-2 h-5 text-[10px] rounded-full px-1.5 min-w-[20px] justify-center"
                      >
                        {unmatchedBankMatches.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="exceptions"
                    className="text-amber-700 dark:text-amber-400 font-medium"
                  >
                    Exceptions & Action Queue
                    {exceptionsSummary.totalExceptions > 0 && (
                      <Badge
                        variant="destructive"
                        className="ml-2 h-5 text-[10px] rounded-full px-1.5 min-w-[20px] justify-center bg-rose-600"
                      >
                        {exceptionsSummary.totalExceptions}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TabsList>
                <TabsContent
                  value="all"
                  className="m-0 space-y-2 max-h-[600px] overflow-y-auto pr-1"
                >
                  {filteredMatches.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No matches found for current filters.
                    </p>
                  ) : (
                    <>
                      {paginatedFilteredMatches.map(renderMatchRow)}
                      {renderPaginationToolbar(filteredMatches.length)}
                    </>
                  )}
                </TabsContent>
                <TabsContent
                  value="matched"
                  className="m-0 space-y-2 max-h-[600px] overflow-y-auto pr-1"
                >
                  {matchedOnlyMatches.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No exact matched records found.
                    </p>
                  ) : (
                    <>
                      {paginatedMatchedOnly.map(renderMatchRow)}
                      {renderPaginationToolbar(matchedOnlyMatches.length)}
                    </>
                  )}
                </TabsContent>
                <TabsContent
                  value="partial"
                  className="m-0 space-y-2 max-h-[600px] overflow-y-auto pr-1"
                >
                  {partialMatches.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No partial or installment records found.
                    </p>
                  ) : (
                    <>
                      <Alert className="mb-3 bg-amber-500/10 border-amber-500/20 text-amber-900 dark:text-amber-200">
                        <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        <AlertDescription className="text-xs">
                          These {partialMatches.length} records matched shareholder accounts in the
                          system with partial payout amounts (e.g. semi-annual debenture interest).
                          When applied, payables will update to &ldquo;Partial&rdquo; status.
                        </AlertDescription>
                      </Alert>
                      {paginatedPartial.map(renderMatchRow)}
                      {renderPaginationToolbar(partialMatches.length)}
                    </>
                  )}
                </TabsContent>
                <TabsContent
                  value="rejected"
                  className="m-0 space-y-2 max-h-[600px] overflow-y-auto pr-1"
                >
                  {rejectedMatches.length === 0 ? (
                    <div className="text-center py-10 bg-green-50/50 rounded-lg border border-green-100 dark:bg-green-950/10 dark:border-green-900/30">
                      <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-2 opacity-80" />
                      <p className="text-sm font-medium text-green-700 dark:text-green-400">
                        No Rejected Transactions
                      </p>
                      <p className="text-xs text-green-600/70 dark:text-green-500/70 mt-1">
                        All bank settlement payouts were accepted successfully.
                      </p>
                    </div>
                  ) : (
                    <>
                      <Alert variant="destructive" className="mb-3">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          These {rejectedMatches.length} payouts were rejected by the destination
                          bank (status: RJCT). When you click "Apply to System", these will remain
                          unpaid for retry.
                        </AlertDescription>
                      </Alert>
                      {paginatedRejected.map(renderMatchRow)}
                      {renderPaginationToolbar(rejectedMatches.length)}
                    </>
                  )}
                </TabsContent>
                <TabsContent
                  value="unmatched_bank"
                  className="m-0 space-y-2 max-h-[600px] overflow-y-auto pr-1"
                >
                  {unmatchedBankMatches.length === 0 ? (
                    <div className="text-center py-10 bg-green-50/50 rounded-lg border border-green-100 dark:bg-green-950/10 dark:border-green-900/30">
                      <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-2 opacity-80" />
                      <p className="text-sm font-medium text-green-700 dark:text-green-400">
                        All Bank Transactions Reconciled
                      </p>
                      <p className="text-xs text-green-600/70 dark:text-green-500/70 mt-1">
                        There are no missing bank transactions in the system.
                      </p>
                    </div>
                  ) : (
                    <>
                      <Alert variant="destructive" className="mb-3">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          These bank transactions could not be matched to any payables, payments, or
                          clients in the system. They require manual review.
                        </AlertDescription>
                      </Alert>
                      {paginatedUnmatchedBank.map(renderMatchRow)}
                      {renderPaginationToolbar(unmatchedBankMatches.length)}
                    </>
                  )}
                </TabsContent>
                <TabsContent
                  value="exceptions"
                  className="m-0 space-y-4 max-h-[600px] overflow-y-auto pr-1"
                >
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-lg">
                      <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                        Unmatched Bank Entries
                      </p>
                      <p className="text-xl font-bold text-red-700 dark:text-red-300 mt-1">
                        {exceptionsSummary.unmatchedBankTxnCount}
                      </p>
                      <p className="text-[11px] text-red-600/70 mt-0.5">
                        Total: NPR {exceptionsSummary.unmatchedBankTotalAmount.toLocaleString()}
                      </p>
                    </div>

                    <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-lg">
                      <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                        Large Variances (&gt; NPR 1.00)
                      </p>
                      <p className="text-xl font-bold text-amber-700 dark:text-amber-300 mt-1">
                        {exceptionsSummary.largeVarianceCount}
                      </p>
                      <p className="text-[11px] text-amber-600/70 mt-0.5">
                        Discrepancy: NPR{" "}
                        {exceptionsSummary.largeVarianceTotalAmount.toLocaleString()}
                      </p>
                    </div>

                    <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 rounded-lg">
                      <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                        Reference Mismatches
                      </p>
                      <p className="text-xl font-bold text-blue-700 dark:text-blue-300 mt-1">
                        {exceptionsSummary.mismatchedReferenceCount}
                      </p>
                      <p className="text-[11px] text-blue-600/70 mt-0.5">
                        Action: Force-Match or Sync Reference
                      </p>
                    </div>
                  </div>

                  {exceptionsSummary.exceptions.length === 0 ? (
                    <div className="text-center py-8 bg-green-50/50 rounded-lg border border-green-100 dark:bg-green-950/10 dark:border-green-900/30">
                      <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-1.5 opacity-80" />
                      <p className="text-sm font-medium text-green-700 dark:text-green-400">
                        Zero Reconciliation Exceptions
                      </p>
                      <p className="text-xs text-green-600/70 dark:text-green-500/70 mt-0.5">
                        No unmatched bank entries, high variances, or reference anomalies detected.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {exceptionsSummary.totalExceptions > exceptionsSummary.exceptions.length && (
                        <Alert className="mb-2 bg-blue-50/50 border-blue-200 text-blue-900 dark:bg-blue-950/20 dark:border-blue-900/40 dark:text-blue-200">
                          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                          <AlertDescription className="text-xs">
                            Displaying top {exceptionsSummary.exceptions.length} exceptions of{" "}
                            {exceptionsSummary.totalExceptions.toLocaleString()} total identified.
                          </AlertDescription>
                        </Alert>
                      )}
                      {exceptionsSummary.exceptions.map((exc) => {
                        const isAcknowledged = acknowledgedExceptions.has(exc.id);
                        return (
                          <div
                            key={exc.id}
                            className={`p-3 rounded-lg border text-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-3 transition-colors ${
                              isAcknowledged
                                ? "bg-muted/40 border-muted opacity-60"
                                : exc.severity === "critical"
                                  ? "bg-rose-50/60 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/40"
                                  : "bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40"
                            }`}
                          >
                            <div className="space-y-1 flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge
                                  variant={
                                    isAcknowledged
                                      ? "secondary"
                                      : exc.severity === "critical"
                                        ? "destructive"
                                        : "default"
                                  }
                                  className="text-[10px] uppercase font-semibold"
                                >
                                  {exc.type.replace(/_/g, " ")}
                                </Badge>
                                {exc.boid && (
                                  <span className="font-mono text-xs text-muted-foreground">
                                    BOID: {exc.boid}
                                  </span>
                                )}
                                {exc.shareholderName && (
                                  <span className="font-medium text-foreground">
                                    {exc.shareholderName}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">{exc.description}</p>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <div className="text-right">
                                <p className="font-mono text-xs font-semibold">
                                  NPR {exc.amount.toLocaleString()}
                                </p>
                                <span className="text-[10px] text-muted-foreground">
                                  Action: {exc.actionRequired}
                                </span>
                              </div>
                              <Button
                                size="sm"
                                variant={isAcknowledged ? "outline" : "secondary"}
                                className="h-8 text-xs"
                                disabled={isAcknowledged}
                                onClick={() => handleAcknowledgeException(exc.id)}
                              >
                                {isAcknowledged ? "Acknowledged" : "Acknowledge"}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card
          className={`border-dashed border-2 p-8 text-center transition-all ${
            isDraggingOver
              ? "border-primary bg-primary/5 shadow-md scale-[1.005]"
              : "border-muted-foreground/30 bg-muted/10"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <CardContent className="flex flex-col items-center gap-4 py-8">
            <FileSpreadsheet
              className={`w-16 h-16 ${
                isDraggingOver ? "text-primary scale-110" : "text-muted-foreground/60 animate-pulse"
              } transition-transform duration-200`}
            />
            <div>
              <CardTitle className="text-xl">Upload Files for 5-Way Reconciliation</CardTitle>
              <CardDescription className="max-w-md mx-auto mt-2">
                Upload or drag-and-drop multiple Excel payment files or bank statements to perform
                comprehensive reconciliation across Payables, Payments, and Bank Statements.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
              {renderCompanyMultiSelect("w-[240px] h-11 text-xs", "Target: All Companies")}
              {canApply ? (
                <>
                  <Button
                    size="lg"
                    className="cursor-pointer"
                    disabled={isProcessing}
                    onClick={() => bodyExcelInputRef.current?.click()}
                  >
                    <Upload className="w-5 h-5 mr-2" />
                    Select Excel File(s)
                  </Button>
                  <input
                    ref={bodyExcelInputRef}
                    id="reconcile-file-upload-body"
                    type="file"
                    multiple
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <Button
                    size="lg"
                    variant="outline"
                    className="cursor-pointer"
                    disabled={isProcessing}
                    onClick={() => bodyBankInputRef.current?.click()}
                  >
                    <FileSpreadsheet className="w-5 h-5 mr-2" />
                    Select Bank Statement(s)
                  </Button>
                  <input
                    ref={bodyBankInputRef}
                    id="reconcile-bank-upload-body"
                    type="file"
                    multiple
                    accept=".xls,.xlsx,.xlsm,.csv,.txt"
                    className="hidden"
                    onChange={handleBankStatementUpload}
                  />
                </>
              ) : (
                <div className="py-2.5 px-4 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-center">
                  <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                    Audit &amp; Inspection Mode
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Select a saved reconciliation lot from the historical lots tab to inspect
                    matches.
                  </p>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Multi-file upload enabled • Hold Ctrl / Shift to select multiple files at once, or
              drag and drop files here
            </p>
            <Alert className="max-w-md mt-4">
              <AlertDescription className="text-xs">
                <strong>5-Way Matching & Deduplication:</strong> Each record is matched against
                Payables, Payments, and Bank Statements. Duplicate batches and identical transaction
                instruction IDs across multiple files are automatically detected and consolidated.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      <Card className="border mt-4">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Reconciliation History &amp; Audit Trail</CardTitle>
            <CardDescription>
              {isLoadingHistory
                ? "Loading reconciliation audit runs and lots..."
                : historyViewMode === "runs"
                  ? `${totalRunsCount.toLocaleString()} immutable reconciliation run${totalRunsCount === 1 ? "" : "s"} tracked across all fiscal files.`
                  : `${groupedLots.length} saved lot${groupedLots.length === 1 ? "" : "s"} (${savedResults.length.toLocaleString()}${totalHistoryRecords > savedResults.length ? ` of ${totalHistoryRecords.toLocaleString()}` : ""} records) loaded.`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
              <Button
                variant={historyViewMode === "runs" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => setHistoryViewMode("runs")}
              >
                Audit Runs ({totalRunsCount})
              </Button>
              <Button
                variant={historyViewMode === "lots" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => setHistoryViewMode("lots")}
              >
                Grouped Lots ({groupedLots.length})
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => loadHistory()}
              disabled={isLoadingHistory}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 mr-1.5 ${isLoadingHistory ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingHistory ? (
            <div className="text-center py-8 text-sm text-muted-foreground flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Loading saved reconciliation lots...
            </div>
          ) : historyViewMode === "runs" ? (
            <div className="space-y-4">
              {/* Summary KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-muted/40 rounded-lg border">
                  <div className="text-[11px] text-muted-foreground font-medium">
                    Reconciliation Runs
                  </div>
                  <div className="text-lg font-bold text-foreground mt-0.5">
                    {totalRunsCount.toLocaleString()}
                  </div>
                </div>
                <div className="p-3 bg-muted/40 rounded-lg border">
                  <div className="text-[11px] text-muted-foreground font-medium">
                    Total Ingested Amount
                  </div>
                  <div className="text-lg font-bold text-foreground mt-0.5">
                    NPR{" "}
                    {runsSummary.total_amount.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                </div>
                <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                  <div className="text-[11px] text-emerald-800 dark:text-emerald-300 font-medium">
                    Matched Rows
                  </div>
                  <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                    {runsSummary.matched_count.toLocaleString()}
                  </div>
                </div>
                <div className="p-3 bg-amber-50/50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
                  <div className="text-[11px] text-amber-800 dark:text-amber-300 font-medium">
                    Exceptions / Variance
                  </div>
                  <div className="text-lg font-bold text-amber-700 dark:text-amber-400 mt-0.5">
                    {runsSummary.unmatched_count.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search runs by file name, run ID, or notes..."
                    value={historySearchQuery}
                    onChange={(e) => setHistorySearchQuery(e.target.value)}
                    className="pl-8 text-xs h-8"
                  />
                  {historySearchQuery && (
                    <button
                      onClick={() => setHistorySearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {companiesList.length > 0 && (
                  <Select
                    value={historyCompanyFilter}
                    onValueChange={(val) => {
                      setHistoryCompanyFilter(val);
                    }}
                  >
                    <SelectTrigger className="w-52 h-8 text-xs">
                      <SelectValue placeholder="All Companies" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Companies</SelectItem>
                      {companiesList.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">
                          {c.company_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Select value={historySourceFilter} onValueChange={setHistorySourceFilter}>
                  <SelectTrigger className="w-44 h-8 text-xs">
                    <SelectValue placeholder="All Sources" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">
                      All Source Types
                    </SelectItem>
                    <SelectItem value="excel" className="text-xs">
                      Excel Lots
                    </SelectItem>
                    <SelectItem value="bank_statement" className="text-xs">
                      Bank Statements
                    </SelectItem>
                    <SelectItem value="connectips" className="text-xs">
                      ConnectIPS
                    </SelectItem>
                    <SelectItem value="nchl" className="text-xs">
                      NCHL Settlements
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Runs Table */}
              {historyError ? (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center my-4">
                  <p className="text-sm font-medium text-destructive mb-3">{historyError}</p>
                  <Button variant="outline" size="sm" onClick={() => loadHistory()}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry Loading History
                  </Button>
                </div>
              ) : reconciliationRuns.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  <p>No reconciliation runs found for the current filter criteria.</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                      <tr>
                        <th className="p-2.5 text-left">Date / Run</th>
                        <th className="p-2.5 text-left">File Name</th>
                        <th className="p-2.5 text-left">SHA-256 Hash</th>
                        <th className="p-2.5 text-left">Company</th>
                        <th className="p-2.5 text-right">Rows</th>
                        <th className="p-2.5 text-right">Total NPR</th>
                        <th className="p-2.5 text-center">Status</th>
                        <th className="p-2.5 text-center">Engine Ver</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {reconciliationRuns.map((run) => (
                        <tr key={run.id} className="hover:bg-muted/30 transition-colors">
                          <td className="p-2.5 font-mono text-[11px] whitespace-nowrap">
                            <div>
                              {run.created_at ? new Date(run.created_at).toLocaleDateString() : "-"}
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              {run.id.slice(0, 8)}
                            </span>
                          </td>
                          <td
                            className="p-2.5 font-medium max-w-[200px] truncate"
                            title={run.file_name}
                          >
                            <div className="flex items-center gap-1.5">
                              <FileSpreadsheet className="w-3.5 h-3.5 text-primary shrink-0" />
                              <span className="truncate">{run.file_name}</span>
                            </div>
                            <span className="text-[10px] text-muted-foreground uppercase">
                              {run.source_type}
                            </span>
                          </td>
                          <td className="p-2.5 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                            <span title={run.file_hash_sha256}>
                              {run.file_hash_sha256
                                ? `${run.file_hash_sha256.slice(0, 10)}...`
                                : "-"}
                            </span>
                          </td>
                          <td className="p-2.5 text-muted-foreground whitespace-nowrap">
                            {run.company_name || "All / Unassigned"}
                          </td>
                          <td className="p-2.5 text-right whitespace-nowrap">
                            <div>
                              <strong>{run.row_count}</strong> total
                            </div>
                            <div className="text-[10px] text-emerald-600 dark:text-emerald-400">
                              {run.matched_count} matched
                            </div>
                          </td>
                          <td className="p-2.5 text-right font-medium whitespace-nowrap">
                            NPR{" "}
                            {Number(run.total_amount || 0).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className="p-2.5 text-center whitespace-nowrap">
                            <Badge
                              variant={
                                run.status === "applied"
                                  ? "default"
                                  : run.status === "review"
                                    ? "secondary"
                                    : run.status === "reverted"
                                      ? "destructive"
                                      : "outline"
                              }
                              className="text-[10px] capitalize"
                            >
                              {run.status}
                            </Badge>
                          </td>
                          <td className="p-2.5 text-center text-muted-foreground font-mono text-[10px]">
                            {run.matching_rule_version || "2.0.0"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : filteredGroupedLots.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              <p>No saved reconciliation history lots match the selected filter.</p>
              {historyCompanyFilter !== "all" && (
                <Button
                  variant="link"
                  size="sm"
                  className="mt-1 text-xs"
                  onClick={() => setHistoryCompanyFilter("all")}
                >
                  Clear company filter
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {unlinkedHistoryCount > 0 && (
                <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 rounded-lg text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    <strong>Notice:</strong> {unlinkedHistoryCount.toLocaleString()} saved records
                    in history are legacy logs without payable or client IDs. These historical
                    records cannot be auto-applied; newly analyzed reports carry verified database
                    linkages.
                  </span>
                </div>
              )}

              {/* History Search & Company Filter Controls */}
              <div className="flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search in history by Shareholder, BOID, Bank Account, or Batch..."
                    value={historySearchQuery}
                    onChange={(e) => setHistorySearchQuery(e.target.value)}
                    className="pl-8 text-xs h-8"
                  />
                  {historySearchQuery && (
                    <button
                      onClick={() => setHistorySearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {historyCompanies.length > 0 && (
                  <Select value={historyCompanyFilter} onValueChange={setHistoryCompanyFilter}>
                    <SelectTrigger className="w-52 h-8 text-xs">
                      <SelectValue placeholder="All Companies" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Companies ({groupedLots.length} lots)</SelectItem>
                      {historyCompanies.map((c) => (
                        <SelectItem key={c} value={c} className="text-xs">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <Select value={historySourceFilter} onValueChange={setHistorySourceFilter}>
                  <SelectTrigger className="w-48 h-8 text-xs">
                    <SelectValue placeholder="All Sources" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">
                      All Settlement Types
                    </SelectItem>
                    <SelectItem value="connectips" className="text-xs">
                      ConnectIPS Payout Lots
                    </SelectItem>
                    <SelectItem value="bank_statement" className="text-xs">
                      Bank Statements
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Grouped Lot Accordion List */}
              <div className="space-y-3">
                {filteredGroupedLots.map((lot) => {
                  const isExpanded = expandedLotKey === lot.lotKey;
                  const currentDetailTab = lotDetailTabs[lot.lotKey] || "all";

                  const filteredLotRecords = lot.records.filter((r) => {
                    if (currentDetailTab === "matched" && r.result !== "Matched") return false;
                    if (currentDetailTab === "rejected" && r.result !== "Rejected") return false;
                    if (
                      currentDetailTab === "discrepancy" &&
                      (r.result === "Matched" || r.result === "Rejected")
                    )
                      return false;

                    if (!historySearchQuery) return true;
                    const q = historySearchQuery.toLowerCase();
                    return (
                      (r.client?.full_name && r.client.full_name.toLowerCase().includes(q)) ||
                      (r.client?.boid && r.client.boid.toLowerCase().includes(q)) ||
                      (r.client?.bank_account_no &&
                        r.client.bank_account_no.toLowerCase().includes(q)) ||
                      (r.notes && r.notes.toLowerCase().includes(q)) ||
                      lot.lotName.toLowerCase().includes(q)
                    );
                  });

                  // If user is searching and this lot has no matching records, skip it
                  if (
                    historySearchQuery &&
                    filteredLotRecords.length === 0 &&
                    currentDetailTab === "all"
                  )
                    return null;

                  return (
                    <div
                      key={lot.lotKey}
                      className="rounded-xl border bg-card text-card-foreground shadow-sm transition-all overflow-hidden"
                    >
                      {/* Lot Header */}
                      <div className="p-4 bg-muted/20 border-b flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-start gap-3 flex-1 min-w-[280px]">
                          <div className="p-2 rounded-lg bg-primary/10 text-primary mt-0.5">
                            <Layers className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="text-sm font-bold text-foreground">{lot.lotName}</h4>
                              <Badge
                                variant="outline"
                                className="text-[11px] font-semibold text-primary"
                              >
                                {lot.companyName}
                              </Badge>
                              {lot.fileName && (
                                <span className="inline-flex items-center text-[11px] text-muted-foreground font-mono bg-muted/60 px-2 py-0.5 rounded border">
                                  <FileSpreadsheet className="w-3 h-3 mr-1 text-primary" />
                                  {lot.fileName}
                                </span>
                              )}
                              <Badge variant="outline" className="text-[11px]">
                                {lot.date}
                              </Badge>
                              <Badge variant="secondary" className="text-[10px] capitalize">
                                {lot.payableType}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs">
                              <span className="text-muted-foreground">
                                Total:{" "}
                                <strong className="text-foreground">
                                  {lot.totalRecords} records
                                </strong>{" "}
                                (NPR{" "}
                                {lot.totalAmount.toLocaleString("en-IN", {
                                  minimumFractionDigits: 2,
                                })}
                                )
                              </span>
                              <span className="text-green-600 dark:text-green-400 font-medium">
                                ✓ {lot.matchedCount} Matched (NPR{" "}
                                {lot.matchedAmount.toLocaleString("en-IN", {
                                  minimumFractionDigits: 2,
                                })}
                                )
                              </span>
                              {lot.rejectedCount > 0 && (
                                <span className="text-red-600 dark:text-red-400 font-medium">
                                  ✕ {lot.rejectedCount} Rejected (NPR{" "}
                                  {lot.rejectedAmount.toLocaleString("en-IN", {
                                    minimumFractionDigits: 2,
                                  })}
                                  )
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Lot Actions */}
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant={isExpanded ? "secondary" : "default"}
                            size="sm"
                            className="h-8 text-xs cursor-pointer font-medium"
                            onClick={() => setExpandedLotKey(isExpanded ? null : lot.lotKey)}
                          >
                            {isExpanded ? (
                              <>
                                <ChevronUp className="w-3.5 h-3.5 mr-1.5" />
                                Hide Details
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3.5 h-3.5 mr-1.5" />
                                View Details ({lot.totalRecords})
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs cursor-pointer"
                            onClick={() => handleExportLot(lot)}
                          >
                            <Download className="w-3.5 h-3.5 mr-1.5" />
                            Export CSV
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 cursor-pointer"
                              onClick={() => handleRevertLot(lot)}
                              disabled={isApplying}
                              title="Revert payables and remove this lot (Admin Only)"
                            >
                              <RotateCcw className="w-3.5 h-3.5 mr-1" />
                              Revert
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs text-destructive hover:bg-destructive/10 cursor-pointer"
                              onClick={() => handleDeleteLot(lot)}
                              title="Delete lot history (Admin Only)"
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-1" />
                              Delete
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Expandable Lot Detailed View */}
                      {isExpanded && (
                        <div className="p-4 space-y-3 bg-background max-h-[600px] overflow-y-auto">
                          {/* Detail Sub-Tabs */}
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b">
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="sm"
                                variant={currentDetailTab === "all" ? "default" : "outline"}
                                className="h-7 text-xs px-2.5"
                                onClick={() =>
                                  setLotDetailTabs((prev) => ({ ...prev, [lot.lotKey]: "all" }))
                                }
                              >
                                All Records ({lot.totalRecords})
                              </Button>
                              <Button
                                size="sm"
                                variant={currentDetailTab === "matched" ? "default" : "outline"}
                                className="h-7 text-xs px-2.5 text-green-700 dark:text-green-400"
                                onClick={() =>
                                  setLotDetailTabs((prev) => ({ ...prev, [lot.lotKey]: "matched" }))
                                }
                              >
                                Matched ({lot.matchedCount})
                              </Button>
                              {lot.rejectedCount > 0 && (
                                <>
                                  <Button
                                    size="sm"
                                    variant={
                                      currentDetailTab === "rejected" ? "destructive" : "outline"
                                    }
                                    className="h-7 text-xs px-2.5 text-red-600"
                                    onClick={() =>
                                      setLotDetailTabs((prev) => ({
                                        ...prev,
                                        [lot.lotKey]: "rejected",
                                      }))
                                    }
                                  >
                                    Rejected / Bounced ({lot.rejectedCount})
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs px-2.5 text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800"
                                    onClick={() => openRemediationForLot(lot.records)}
                                  >
                                    <CreditCard className="w-3 h-3 mr-1 text-amber-600" />
                                    Remediate ({lot.rejectedCount})
                                  </Button>
                                </>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              Showing {filteredLotRecords.length} records in this view
                            </span>
                          </div>

                          <div className="space-y-2 pt-1">
                            {filteredLotRecords.length === 0 ? (
                              <p className="text-xs text-muted-foreground text-center py-6">
                                No records found for the selected tab filter.
                              </p>
                            ) : (
                              filteredLotRecords.map((r, idx) => (
                                <div
                                  key={r.id || idx}
                                  className="rounded-lg border p-3 bg-muted/10 hover:bg-muted/30 transition-colors text-xs"
                                >
                                  <div className="flex items-start justify-between gap-3 flex-wrap">
                                    <div className="flex-1 min-w-[200px]">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-bold text-sm text-foreground">
                                          {r.client?.full_name || "Shareholder"}
                                        </span>
                                        {r.client?.boid && (
                                          <span className="font-mono text-[11px] bg-muted px-2 py-0.5 rounded text-muted-foreground border">
                                            BOID: {r.client.boid}
                                          </span>
                                        )}
                                        <Badge
                                          variant={
                                            r.result === "Matched" ? "default" : "destructive"
                                          }
                                          className="text-[10px] h-4"
                                        >
                                          {r.result}
                                        </Badge>
                                      </div>

                                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-muted-foreground">
                                        {(r.client?.bank_name || r.client?.bank_account_no) && (
                                          <div className="flex items-center gap-1">
                                            <CreditCard className="w-3.5 h-3.5" />
                                            <span>
                                              {r.client.bank_name}{" "}
                                              {r.client.bank_account_no
                                                ? `(A/C: ${r.client.bank_account_no})`
                                                : ""}
                                            </span>
                                          </div>
                                        )}
                                        {r.notes && (
                                          <span className="text-[11px] text-muted-foreground/80">
                                            {r.notes}
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-4 text-right">
                                      <div>
                                        <span className="text-[10px] text-muted-foreground block">
                                          {r.result === "Rejected"
                                            ? "Attempted Txn"
                                            : "Actual Paid"}
                                        </span>
                                        <span
                                          className={`font-mono font-bold text-sm ${r.result === "Rejected" ? "text-destructive line-through" : "text-foreground"}`}
                                        >
                                          NPR{" "}
                                          {(r.actual_amount || 0).toLocaleString("en-IN", {
                                            minimumFractionDigits: 2,
                                          })}
                                        </span>
                                        {r.result === "Rejected" && (
                                          <span className="text-[10px] text-destructive block font-semibold">
                                            NPR 0.00 (Bounced)
                                          </span>
                                        )}
                                      </div>
                                      <div>
                                        <span className="text-[10px] text-muted-foreground block">
                                          System Expected
                                        </span>
                                        <span className="font-mono text-muted-foreground">
                                          NPR{" "}
                                          {(r.expected_amount || 0).toLocaleString("en-IN", {
                                            minimumFractionDigits: 2,
                                          })}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AccountRemediationDialog
        open={remediationDialogOpen}
        onOpenChange={setRemediationDialogOpen}
        initialItems={remediationItems}
        companyName={
          reconCompanyIds.length === 1
            ? companiesList.find((c) => c.id === reconCompanyIds[0])?.company_name
            : reconCompanyIds.length > 1
              ? `${reconCompanyIds.length} Companies Selected`
              : "All Companies"
        }
      />

      <ReconciliationPostingModal
        open={showPostingModal}
        onOpenChange={setShowPostingModal}
        report={report}
        selectedMatchIds={selectedMatchIds}
        isApplying={isApplying}
        onConfirmApply={handleConfirmPosting}
        operatorName={user?.user_metadata?.full_name || user?.email || "Authorized Operator"}
        operatorRole={roles?.[0] || "Checker / Approver"}
        isAll={postingIsAll}
        variantAlerts={variantAlerts}
      />
    </div>
  );
}
