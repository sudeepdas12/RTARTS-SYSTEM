import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
} from "@/lib/reconciliation-engine";
import {
  ReconciliationService,
  ReconciliationGroupedLot,
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
  CheckCircle2,
  AlertTriangle,
  CheckSquare,
  CreditCard,
  Building2,
  ChevronDown,
  Info,
  Table as TableIcon,
  LayoutGrid,
  PlusCircle,
  Zap,
} from "lucide-react";
import { type RejectedAccountItem } from "@/components/account-remediation-dialog";
import { BankErrorUploadDialog } from "@/components/reconciliation/bank-error-upload-dialog";
import {
  buildReconciliationResultsPayload,
  exportReconciliationLotWorkbook,
  exportReconciliationReportWorkbook,
  exportSelectedMatchesWorkbook,
} from "@/components/reconciliation/reconciliation-exports";
import { ReconciliationOverviewSection } from "@/components/reconciliation/reconciliation-overview";
import {
  ReconciliationMatchRowCard,
  ReconciliationMatchTableView,
  ReconciliationPaginationToolbar,
} from "@/components/reconciliation/reconciliation-match-views";
import { ReconciliationExceptionQueueTab } from "@/components/reconciliation/reconciliation-exception-queue";
import { ReconciliationHistorySection } from "@/components/reconciliation/reconciliation-history-section";
import { ReconciliationModalsGroup } from "@/components/reconciliation/reconciliation-modals";
import {
  ManualReconciliationDialog,
  type ManualReconciliationMode,
} from "@/components/reconciliation/manual-reconciliation-dialog";
import { BankLedgerWorkbenchTab } from "@/components/reconciliation/bank-ledger-workbench-tab";
import { DurableExceptionsWorkbench } from "@/components/reconciliation/durable-exceptions-workbench";
import { BankReconciliationStatementPanel } from "@/components/reconciliation/bank-reconciliation-statement";
import type { BankStatementTransactionRow } from "@/lib/services/reconciliation.service";
import { useDebounce } from "@/hooks/use-debounce";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reconciliation")({
  component: ReconciliationRoute,
});

function ReconciliationRoute() {
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
  const [expandedLotKey, setExpandedLotKey] = useState<string | null>(null);
  const [historySearchQuery, setHistorySearchQuery] = useState<string>("");
  const debouncedHistorySearch = useDebounce(historySearchQuery, 300);
  const [lotToDelete, setLotToDelete] = useState<ReconciliationGroupedLot | null>(null);
  const [lotToRevert, setLotToRevert] = useState<ReconciliationGroupedLot | null>(null);
  const [showClearHistoryDialog, setShowClearHistoryDialog] = useState<boolean>(false);
  const [showRevertAllDialog, setShowRevertAllDialog] = useState<boolean>(false);
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
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [inspectingMatch, setInspectingMatch] = useState<ReconciliationMatch | null>(null);
  const [selectedStatementBoid, setSelectedStatementBoid] = useState<string | null>(null);
  const [companySelectModalOpen, setCompanySelectModalOpen] = useState<boolean>(false);
  const [pendingFilesToProcess, setPendingFilesToProcess] = useState<{
    files: File[];
    isBankStatement: boolean;
  } | null>(null);
  const [manualDialogOpen, setManualDialogOpen] = useState<boolean>(false);
  const [manualDialogMode, setManualDialogMode] =
    useState<ManualReconciliationMode>("manual_entry");
  const [manualSelectedTxns, setManualSelectedTxns] = useState<BankStatementTransactionRow[]>([]);
  const [isSyncingConnectIps, setIsSyncingConnectIps] = useState<boolean>(false);
  const [opsWorkbenchTab, setOpsWorkbenchTab] = useState<string>("bank_ledger");
  const [brsCompanyId, setBrsCompanyId] = useState<string>("");
  const [ledgerSelectionResetKey, setLedgerSelectionResetKey] = useState<number>(0);

  const { hasAny, isAdmin, user, roles } = useAuth();
  const canApply = hasAny(["admin", "finance_operator", "reconciliation_officer"]);
  const canManualSubmit = hasAny([
    "admin",
    "supervisor",
    "finance_operator",
    "reconciliation_officer",
    "maker",
    "operator",
  ]);
  const canCheckerApprove = hasAny(["admin", "supervisor", "checker", "approver"]);
  const canApproveVariance = hasAny(["admin", "supervisor"]);
  const canCertifyLock = hasAny(["admin", "supervisor", "approver"]);
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

  const handleRevertLot = (lot: ReconciliationGroupedLot) => {
    if (!isAdmin) {
      toast.error("Only administrators are authorized to revert and remove reconciliation lots.");
      return;
    }
    setLotToRevert(lot);
  };

  const confirmRevertLot = async () => {
    if (!lotToRevert) return;
    const lot = lotToRevert;
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
      setLotToRevert(null);
    }
  };

  const confirmDeleteLot = async () => {
    if (!lotToDelete) return;
    const lot = lotToDelete;
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
      setLotToDelete(null);
    }
  };

  const handleDeleteLot = (lot: ReconciliationGroupedLot) => {
    if (!isAdmin) {
      toast.error("Only administrators are authorized to delete reconciliation records.");
      return;
    }
    setLotToDelete(lot);
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
            search: debouncedHistorySearch || undefined,
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
    [historyCompanyFilter, historySourceFilter, debouncedHistorySearch],
  );

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const resolveTargetCompany = (
    files: File[],
    isBankStatement: boolean,
    overrideCompanyId?: string,
  ): string | null => {
    if (overrideCompanyId) return overrideCompanyId;
    if (reconCompanyIds.length > 0 && reconCompanyIds[0]) return reconCompanyIds[0];

    // Auto-detect single company
    if (companiesList.length === 1) {
      const singleId = companiesList[0].id;
      setReconCompanyIds([singleId]);
      return singleId;
    }

    // Auto-detect matching company code or name in filenames
    if (companiesList.length > 1) {
      const matchedComp = companiesList.find((c) =>
        files.some(
          (f) =>
            (c.company_code && f.name.toUpperCase().includes(c.company_code.toUpperCase())) ||
            (c.company_name && f.name.toUpperCase().includes(c.company_name.toUpperCase())),
        ),
      );
      if (matchedComp) {
        setReconCompanyIds([matchedComp.id]);
        toast.info(`Auto-selected target fund: ${matchedComp.company_name}`);
        return matchedComp.id;
      }
    }

    // Prompt user via modal
    setPendingFilesToProcess({ files, isBankStatement });
    setCompanySelectModalOpen(true);
    return null;
  };

  const handleSelectCompanyForPending = (companyId: string) => {
    setReconCompanyIds([companyId]);
    setCompanySelectModalOpen(false);
    if (pendingFilesToProcess) {
      const pending = pendingFilesToProcess;
      setPendingFilesToProcess(null);
      if (pending.isBankStatement) {
        processBankStatementFiles(pending.files, companyId);
      } else {
        processExcelFiles(pending.files, companyId);
      }
    }
  };

  const processExcelFiles = async (files: File[], overrideCompanyId?: string) => {
    if (!files.length) return;
    if (!canApply) {
      toast.error("Unauthorized: Read-only accounts cannot upload files for reconciliation.");
      return;
    }

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
        const targetCompany = resolveTargetCompany(bankFiles, false, overrideCompanyId);
        if (!targetCompany) return;
        try {
          const {
            transactions,
            perFileTransactions,
            fileStatuses,
            hasFailures,
            duplicateCount,
            variantWarnings,
            statementMetadata,
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
            for (const file of bankFiles) {
              const fileTxns = perFileTransactions.get(file) || [];
              if (fileTxns.length === 0) continue;
              const fileStatus = fileStatuses.find((s) => s.fileName === file.name);
              setProcessingProgress(`Persisting ledger for ${file.name}...`);
              await ReconciliationService.ingestBankStatementFile(
                targetCompany,
                file,
                fileTxns,
                fileStatus?.metadata,
              );
            }

            setProcessingProgress("Performing 5-way multi-source reconciliation...");
            const rep = await ReconciliationEngine.analyzeBankStatement(transactions, {
              fileName: bankFiles.map((f) => f.name).join(", "),
              companyIds: [targetCompany],
              expandConsolidatedBatches: true,
              metadata: statementMetadata,
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

  const processBankStatementFiles = async (files: File[], overrideCompanyId?: string) => {
    if (!files.length) return;

    const targetCompany = resolveTargetCompany(files, true, overrideCompanyId);
    if (!targetCompany) return;

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
        statementMetadata,
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
        for (const file of files) {
          const fileTxns = perFileTransactions.get(file) || [];
          if (fileTxns.length === 0) continue;
          const fileStatus = fileStatuses.find((s) => s.fileName === file.name);
          setProcessingProgress(`Persisting ledger for ${file.name}...`);
          await ReconciliationService.ingestBankStatementFile(
            targetCompany,
            file,
            fileTxns,
            fileStatus?.metadata,
          );
        }

        setProcessingProgress("Matching statement transactions with disbursements & payouts...");
        const rep = await ReconciliationEngine.analyzeBankStatement(transactions, {
          fileName: files.map((f) => f.name).join(", "),
          companyIds: [targetCompany],
          expandConsolidatedBatches: true,
          metadata: statementMetadata,
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

    if (!canApply) {
      toast.error("Unauthorized: Read-only accounts cannot upload files for reconciliation.");
      return;
    }

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

  const filterResetKey = `${searchQuery}|${statusFilter}|${sourceFilter}|${selectedCategoryFilter}|${report?.fileName ?? ""}|${report?.matches?.length ?? 0}`;
  const [prevFilterResetKey, setPrevFilterResetKey] = useState(filterResetKey);
  if (prevFilterResetKey !== filterResetKey) {
    setPrevFilterResetKey(filterResetKey);
    if (currentPage !== 1) setCurrentPage(1);
  }

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

  const handleAcknowledgeExceptionBatch = (excIds: string[]) => {
    setAcknowledgedExceptions((prev) => {
      const next = new Set(prev);
      excIds.forEach((id) => next.add(id));
      return next;
    });
    toast.success(`Acknowledged ${excIds.length} exception item(s) for operator review.`);
  };

  const openManualReconciliationDialog = (
    mode: ManualReconciliationMode,
    txns: BankStatementTransactionRow[] = [],
  ) => {
    setManualDialogMode(mode);
    setManualSelectedTxns(txns);
    setManualDialogOpen(true);
  };

  const handleHeaderSyncConnectIps = async () => {
    setIsSyncingConnectIps(true);
    try {
      const res = await ReconciliationService.autoReconcileConnectIpsBatches(reconCompanyIds);
      toast.success(res.message);
      await loadHistory();
      qc.invalidateQueries({ queryKey: ["bank_statement_transactions"] });
      qc.invalidateQueries({ queryKey: ["brs_statement"] });
    } catch (err: any) {
      toast.error(err?.message || "Failed to sync ConnectIPS batches.");
    } finally {
      setIsSyncingConnectIps(false);
    }
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
      const results = buildReconciliationResultsPayload(report);
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

  const confirmClearHistory = async () => {
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
      setShowClearHistoryDialog(false);
    }
  };

  const confirmRevertReconciliation = async () => {
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
      setShowRevertAllDialog(false);
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
    if (!report?.matches) return false;
    const targetMatches = postingIsAll
      ? report.matches
      : report.matches.filter((m) => selectedMatchIds.has(m.id));

    setIsApplying(true);
    try {
      const results = buildReconciliationResultsPayload(report, targetMatches);
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
        return false;
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
      qc.invalidateQueries({ queryKey: ["bank_statement_transactions"] });
      qc.invalidateQueries({ queryKey: ["reconciliation_exceptions"] });
      qc.invalidateQueries({ queryKey: ["brs_statement"] });

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
      return true;
    } catch (err: any) {
      console.error("Reconciliation apply error:", err);
      toast.error(`Failed to apply reconciliation: ${err?.message || err}`);
      return false;
    } finally {
      setIsApplying(false);
    }
  };

  const handleExportReport = () => {
    if (!report?.matches) return;
    exportReconciliationReportWorkbook(report, filteredMatches);
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
    exportSelectedMatchesWorkbook(toExport);
  };

  const renderMatchesContent = (items: ReconciliationMatch[], totalCount: number) => (
    <>
      {viewMode === "table" ? (
        <ReconciliationMatchTableView
          matches={items}
          selectedMatchIds={selectedMatchIds}
          onSetSelectedMatchIds={setSelectedMatchIds}
          onToggleSelect={toggleSelectMatch}
          onInspect={setInspectingMatch}
        />
      ) : (
        items.map((match) => (
          <ReconciliationMatchRowCard
            key={match.id}
            match={match}
            isSelected={selectedMatchIds.has(match.id)}
            onToggleSelect={toggleSelectMatch}
            onInspect={setInspectingMatch}
          />
        ))
      )}
      <ReconciliationPaginationToolbar
        totalItems={totalCount}
        currentPage={currentPage}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setCurrentPage(1);
        }}
      />
    </>
  );

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
            <BankErrorUploadDialog />
            {canApply && (
              <>
                <Button
                  type="button"
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
                  type="button"
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
                  accept=".xls,.xlsx,.xlsm,.csv,.txt,.xml,.mt940,.sta,.940"
                  className="hidden"
                  onChange={handleBankStatementUpload}
                />
              </>
            )}
            {canManualSubmit && (
              <>
                <Button
                  id="header-manual-entry-btn"
                  type="button"
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => openManualReconciliationDialog("manual_entry", [])}
                >
                  <PlusCircle className="w-4 h-4 mr-1.5" />
                  Manual Entry / Match
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="cursor-pointer"
                  disabled={isSyncingConnectIps}
                  onClick={handleHeaderSyncConnectIps}
                >
                  <Zap className="w-4 h-4 mr-1.5 text-amber-500" />
                  {isSyncingConnectIps ? "Syncing..." : "Sync ConnectIPS"}
                </Button>
              </>
            )}
            {!canApply && !canManualSubmit && (
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

          <ReconciliationOverviewSection
            report={report}
            variantAlerts={variantAlerts}
            parsedFileStatuses={parsedFileStatuses}
            selectedCategoryFilter={selectedCategoryFilter}
            onSelectCategoryFilter={setSelectedCategoryFilter}
          />

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

                <div className="flex items-center gap-2 ml-auto">
                  <div className="flex items-center border rounded-md p-0.5 bg-muted/40">
                    <Button
                      variant={viewMode === "table" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer"
                      onClick={() => setViewMode("table")}
                    >
                      <TableIcon className="w-3.5 h-3.5" />
                      Table View
                    </Button>
                    <Button
                      variant={viewMode === "cards" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 px-2.5 text-xs flex items-center gap-1.5 cursor-pointer"
                      onClick={() => setViewMode("cards")}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      Card View
                    </Button>
                  </div>
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
                    renderMatchesContent(paginatedFilteredMatches, filteredMatches.length)
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
                    renderMatchesContent(paginatedMatchedOnly, matchedOnlyMatches.length)
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
                      {renderMatchesContent(paginatedPartial, partialMatches.length)}
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
                      {renderMatchesContent(paginatedRejected, rejectedMatches.length)}
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
                      {renderMatchesContent(paginatedUnmatchedBank, unmatchedBankMatches.length)}
                    </>
                  )}
                </TabsContent>
                <ReconciliationExceptionQueueTab
                  exceptionsSummary={exceptionsSummary}
                  acknowledgedExceptions={acknowledgedExceptions}
                  onAcknowledgeException={handleAcknowledgeException}
                  onAcknowledgeBatch={handleAcknowledgeExceptionBatch}
                  onOpenRemediation={openRemediationForMatches}
                  matches={filteredMatches}
                />
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
                    accept=".xls,.xlsx,.xlsm,.csv,.txt,.xml,.mt940,.sta,.940"
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

      {/* Multi-Channel Operational Workbenches: Persistent Bank Ledger, Durable Exceptions & BRS */}
      <Tabs value={opsWorkbenchTab} onValueChange={setOpsWorkbenchTab} className="space-y-3">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="bank_ledger" className="text-xs">
            Bank Ledger &amp; Manual Matching
          </TabsTrigger>
          <TabsTrigger value="exceptions_workbench" className="text-xs">
            Exceptions &amp; Variance Approvals
          </TabsTrigger>
          <TabsTrigger value="brs_period_lock" className="text-xs">
            BRS &amp; Period Close
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bank_ledger" className="m-0">
          <BankLedgerWorkbenchTab
            selectedCompanyIds={reconCompanyIds}
            currentUserId={user?.id}
            selectionResetKey={ledgerSelectionResetKey}
            canApply={canManualSubmit}
            onOpenManualDialog={openManualReconciliationDialog}
            onSyncConnectIpsComplete={() => loadHistory()}
          />
        </TabsContent>

        <TabsContent value="exceptions_workbench" className="m-0">
          <DurableExceptionsWorkbench
            selectedCompanyIds={reconCompanyIds}
            currentUserId={user?.id}
            canApproveVariance={canApproveVariance}
            canEditExceptions={canManualSubmit}
          />
        </TabsContent>

        <TabsContent value="brs_period_lock" className="m-0">
          <BankReconciliationStatementPanel
            companiesList={companiesList}
            selectedCompanyIds={reconCompanyIds}
            selectedCompanyId={brsCompanyId}
            onSelectCompanyId={setBrsCompanyId}
            currentUserId={user?.id}
            canCertifyLock={canCertifyLock}
            isAdminOrSupervisor={hasAny(["admin", "supervisor"])}
          />
        </TabsContent>
      </Tabs>

      <ReconciliationHistorySection
        isLoadingHistory={isLoadingHistory}
        historyError={historyError}
        historyViewMode={historyViewMode}
        onChangeHistoryViewMode={setHistoryViewMode}
        onRefreshHistory={() => loadHistory()}
        totalRunsCount={totalRunsCount}
        runsSummary={runsSummary}
        reconciliationRuns={reconciliationRuns}
        groupedLots={groupedLots}
        filteredGroupedLots={filteredGroupedLots}
        savedResultsCount={savedResults.length}
        totalHistoryRecords={totalHistoryRecords}
        unlinkedHistoryCount={unlinkedHistoryCount}
        historySearchQuery={historySearchQuery}
        onChangeHistorySearchQuery={setHistorySearchQuery}
        historyCompanyFilter={historyCompanyFilter}
        onChangeHistoryCompanyFilter={setHistoryCompanyFilter}
        historySourceFilter={historySourceFilter}
        onChangeHistorySourceFilter={setHistorySourceFilter}
        companiesList={companiesList}
        historyCompanies={historyCompanies}
        expandedLotKey={expandedLotKey}
        onToggleExpandLot={setExpandedLotKey}
        lotDetailTabs={lotDetailTabs}
        onChangeLotDetailTab={(lotKey, tab) =>
          setLotDetailTabs((prev) => ({
            ...prev,
            [lotKey]: tab,
          }))
        }
        onExportLot={exportReconciliationLotWorkbook}
        onRevertLot={handleRevertLot}
        onDeleteLot={handleDeleteLot}
        onOpenRemediationForLot={openRemediationForLot}
        isAdmin={isAdmin}
        canDelete={canDelete}
        isApplying={isApplying}
      />

      <ManualReconciliationDialog
        open={manualDialogOpen}
        onOpenChange={setManualDialogOpen}
        companiesList={companiesList}
        defaultCompanyId={reconCompanyIds[0] || companiesList[0]?.id}
        initialMode={manualDialogMode}
        selectedTransactions={manualSelectedTxns}
        onSubmitted={() => {
          setLedgerSelectionResetKey((k) => k + 1);
          loadHistory();
        }}
      />

      <ReconciliationModalsGroup
        remediationDialogOpen={remediationDialogOpen}
        onRemediationOpenChange={setRemediationDialogOpen}
        remediationItems={remediationItems}
        reconCompanyIds={reconCompanyIds}
        companiesList={companiesList}
        showPostingModal={showPostingModal}
        onShowPostingModalChange={setShowPostingModal}
        report={report}
        selectedMatchIds={selectedMatchIds}
        isApplying={isApplying}
        onConfirmPosting={handleConfirmPosting}
        operatorName={user?.user_metadata?.full_name || user?.email || "Authorized Operator"}
        operatorRole={roles?.[0] || "Checker / Approver"}
        postingIsAll={postingIsAll}
        variantAlerts={variantAlerts}
        lotToDelete={lotToDelete}
        onCancelDeleteLot={() => setLotToDelete(null)}
        onConfirmDeleteLot={confirmDeleteLot}
        lotToRevert={lotToRevert}
        onCancelRevertLot={() => setLotToRevert(null)}
        onConfirmRevertLot={confirmRevertLot}
        showClearHistoryDialog={showClearHistoryDialog}
        onShowClearHistoryChange={setShowClearHistoryDialog}
        onConfirmClearHistory={confirmClearHistory}
        showRevertAllDialog={showRevertAllDialog}
        onShowRevertAllChange={setShowRevertAllDialog}
        onConfirmRevertReconciliation={confirmRevertReconciliation}
        inspectingMatch={inspectingMatch}
        onCloseInspectingMatch={() => setInspectingMatch(null)}
        onOpenRemediationForMatches={openRemediationForMatches}
        selectedStatementBoid={selectedStatementBoid}
        onSelectStatementBoid={setSelectedStatementBoid}
        companySelectModalOpen={companySelectModalOpen}
        onCompanySelectModalChange={setCompanySelectModalOpen}
        onSelectCompanyForPending={handleSelectCompanyForPending}
        onCancelCompanySelect={() => {
          setCompanySelectModalOpen(false);
          setPendingFilesToProcess(null);
        }}
      />
    </div>
  );
}
