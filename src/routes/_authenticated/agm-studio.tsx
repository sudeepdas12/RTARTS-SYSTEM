import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  ArrowUpRight,
  Building2,
  Edit,
  FileSpreadsheet,
  FolderSync,
  RefreshCw,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AgmStudioService,
  MultiYearShareholderProfile,
  BrokerPoolRecord,
  BrokerPoolClaim,
  PhysicalDrnRecord,
  PromoterConversionRecord,
  ConversionSummaryReport,
  ImportValidationReport,
  FiscalYearMetaRecord,
  CompanyProfile,
  HistoricalFiscalYearConfig,
} from "@/lib/services/agm-studio.service";
import { useAuth } from "@/hooks/use-auth";
import {
  downloadAgmSpecificWorkbook,
  downloadCdscAutoCaTxt,
  downloadChronologicalLedgerWorkbook,
  downloadDrnLedgerWorkbook,
  downloadFySummaryWorkbook,
  downloadMasterAgmWorkbook,
  downloadMutualFundsWorkbook,
  exportConversionLedgerWorkbook,
  exportConversionReportWorkbook,
  exportDecompositionScheduleWorkbook,
  exportDiscrepancyAuditWorkbook,
  exportShareholderJourneyWorkbook,
  exportShareholderRegistryWorkbook,
  type AgmStudioExportContext,
} from "@/components/agm-studio/agm-studio-exports";
import { AgmWizardAndLedgerTabs } from "@/components/agm-studio/agm-studio-wizard-ledger-tabs";
import { AgmSandboxAndRadarTabs } from "@/components/agm-studio/agm-studio-sandbox-radar-tabs";
import { AgmConversionPoolsDrnTabs } from "@/components/agm-studio/agm-studio-conversion-pools-drn-tabs";
import { AgmConfigAndPromoteTabs } from "@/components/agm-studio/agm-studio-config-promote-tabs";
import { AgmStudioModals } from "@/components/agm-studio/agm-studio-modals";

export const Route = createFileRoute("/_authenticated/agm-studio")({
  component: AgmStudioPage,
});

function createGeneratedCompanyId() {
  return `comp-${Date.now()}`;
}

function AgmStudioPage() {
  const qc = useQueryClient();
  const wizardFileInputRef = useRef<HTMLInputElement>(null);
  const conversionFileInputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------
  // MULTI-COMPANY STATE
  // -------------------------------------------------------------
  const [companies, setCompanies] = useState<CompanyProfile[]>(() =>
    AgmStudioService.getCompanies(),
  );
  const [activeCompanyId, setActiveCompanyId] = useState<string>(() =>
    AgmStudioService.getActiveCompanyId(),
  );

  const { data: dbCompanies } = useQuery({
    queryKey: ["agm-companies-list"],
    queryFn: () => AgmStudioService.fetchCompaniesFromDatabase(),
    staleTime: 10_000,
  });

  const [prevDbCompanies, setPrevDbCompanies] = useState(dbCompanies);
  if (prevDbCompanies !== dbCompanies) {
    setPrevDbCompanies(dbCompanies);
    if (dbCompanies && dbCompanies.length > 0) {
      setCompanies(dbCompanies);
      const hasCurrent = dbCompanies.some((c) => c.id === activeCompanyId);
      if (!hasCurrent) {
        const nlgMatch = dbCompanies.find((c) => c.code === "NLG");
        const nextId = nlgMatch ? nlgMatch.id : dbCompanies[0].id;
        AgmStudioService.setActiveCompanyId(nextId);
        setActiveCompanyId(nextId);
      }
    }
  }

  const activeCompany = useMemo(() => {
    return companies.find((c) => c.id === activeCompanyId) || companies[0];
  }, [companies, activeCompanyId]);

  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const [isAddFyModalOpen, setIsAddFyModalOpen] = useState(false);
  const [editingFy, setEditingFy] = useState<HistoricalFiscalYearConfig | null>(null);

  // New Company form
  const [newCompCode, setNewCompCode] = useState("");
  const [newCompName, setNewCompName] = useState("");
  const [newCompIsinPo, setNewCompIsinPo] = useState("");
  const [newCompIsinPub, setNewCompIsinPub] = useState("");
  const [newCompBaseFy, setNewCompBaseFy] = useState("2075/76");

  // FY Event Form
  const [fyFormYear, setFyFormYear] = useState("2081/82");
  const [fyFormEventName, setFyFormEventName] = useState("");
  const [fyFormEventType, setFyFormEventType] = useState<
    "RIGHT_ISSUE" | "PROMOTER_CONVERSION" | "BONUS_AND_CASH" | "IPF_TRANSFER" | "PRE_BASELINE_BONUS"
  >("BONUS_AND_CASH");
  const [fyFormBonusPct, setFyFormBonusPct] = useState("5.0");
  const [fyFormCashPct, setFyFormCashPct] = useState("0.26315");
  const [fyFormRightPct, setFyFormRightPct] = useState("0");
  const [fyFormConvPct, setFyFormConvPct] = useState("0");
  const [fyFormBookClose, setFyFormBookClose] = useState("2082-01-15");
  const [fyFormNotes, setFyFormNotes] = useState("");

  // Active Main Tab
  const [activeTab, setActiveTab] = useState<
    | "wizard"
    | "ledger"
    | "sandbox"
    | "radar"
    | "conversion"
    | "broker-pools"
    | "drn"
    | "config"
    | "promote"
  >("wizard");

  // -------------------------------------------------------------
  // PROMOTER CONVERSION (CA Seq 6316) STATE
  // -------------------------------------------------------------
  const [conversionRecords, setConversionRecords] = useState<PromoterConversionRecord[]>([]);
  const [conversionSummary, setConversionSummary] = useState<ConversionSummaryReport | null>(null);
  const [isParsingConversion, setIsParsingConversion] = useState(false);
  const [convSearch, setConvSearch] = useState("");
  const [convStatusFilter, setConvStatusFilter] = useState<
    "ALL" | "CONVERTED" | "PHYSICAL_PENDING" | "RECONCILED"
  >("ALL");
  const [convPage, setConvPage] = useState(1);
  const convPageSize = 50;

  // -------------------------------------------------------------
  // PHYSICAL DRN (Dematerialisation Request) STATE
  // -------------------------------------------------------------
  const [drnSearch, setDrnSearch] = useState("");
  const [drnStatusFilter, setDrnStatusFilter] = useState<
    "ALL" | "POSTED" | "ACCEPTED" | "REJECTED" | "PHYSICAL"
  >("ALL");
  const [drnPage, setDrnPage] = useState(1);
  const drnPageSize = 50;

  // -------------------------------------------------------------
  // WIZARD STATE (3-Step Guided Process)
  // -------------------------------------------------------------
  const { roles } = useAuth();
  const isAuthorizedToPromote = roles.includes("admin") || roles.includes("supervisor");

  // -------------------------------------------------------------
  // STATE DEFINITIONS
  // -------------------------------------------------------------
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [wizardTargetFy, setWizardTargetFy] = useState<string>("2075/76");
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [isSavingBatch, setIsSavingBatch] = useState(false);

  // Parsed Temporary Data
  const [parsedProfiles, setParsedProfiles] = useState<MultiYearShareholderProfile[]>([]);
  const [parsedBrokerPools, setParsedBrokerPools] = useState<BrokerPoolRecord[]>([]);
  const [parsedDrnRecords, setParsedDrnRecords] = useState<PhysicalDrnRecord[]>([]);
  const [importReport, setImportReport] = useState<ImportValidationReport | null>(null);

  // -------------------------------------------------------------
  // DB DATA & LEDGER STATE
  // -------------------------------------------------------------
  const [dataSourceMode, setDataSourceMode] = useState<"MEMORY" | "DATABASE">("DATABASE");
  const [dbProfiles, setDbProfiles] = useState<MultiYearShareholderProfile[]>([]);
  const [dbTotalCount, setDbTotalCount] = useState<number>(0);
  const [dbFilteredCount, setDbFilteredCount] = useState<number>(0);
  const [isLoadingDb, setIsLoadingDb] = useState(false);
  const [fyLedger, setFyLedger] = useState<FiscalYearMetaRecord[]>([]);
  const [dbSummaryStats, setDbSummaryStats] = useState<{
    totalKitta: number;
    totalBonus: number;
    totalCash: number;
    totalTax: number;
    mfCash: number;
    totalShareholders?: number;
  } | null>(null);

  // -------------------------------------------------------------
  // SEARCH, FILTER & PAGINATION STATE
  // -------------------------------------------------------------
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const [typeFilter, setTypeFilter] = useState<
    "ALL" | "PROMOTER" | "PUBLIC" | "MUTUAL_FUND" | "PHYSICAL" | "CLEARING_POOL" | "DISCREPANCY"
  >("ALL");
  const [agmFyFilter, setAgmFyFilter] = useState<string>("ALL");
  const [selectedAgmCardFy, setSelectedAgmCardFy] = useState<string>("2076/77");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedProfile, setSelectedProfile] = useState<MultiYearShareholderProfile | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [onlyPresentInFy, setOnlyPresentInFy] = useState(false);

  // -------------------------------------------------------------
  // BROKER POOLS & CLAIMS STATE
  // -------------------------------------------------------------
  const [pools, setPools] = useState<BrokerPoolRecord[]>(() =>
    AgmStudioService.getBrokerPoolAccounts(),
  );
  const [claims, setClaims] = useState<BrokerPoolClaim[]>(() =>
    AgmStudioService.getBrokerPoolClaims(),
  );
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [selectedPool, setSelectedPool] = useState<BrokerPoolRecord | null>(null);
  const [claimantBoid, setClaimantBoid] = useState("");
  const [claimantName, setClaimantName] = useState("");
  const [claimedKitta, setClaimedKitta] = useState("50");
  const [contractNote, setContractNote] = useState("CN-14-2080-9901");
  const [tradeDate, setTradeDate] = useState("2080-11-25");

  // -------------------------------------------------------------
  // MANUAL PHYSICAL DRN MAPPING STATE
  // -------------------------------------------------------------
  const [drnList, setDrnList] = useState<PhysicalDrnRecord[]>(() =>
    AgmStudioService.getPhysicalDrnRecords(),
  );
  const [isDrnModalOpen, setIsDrnModalOpen] = useState(false);
  const [selectedDrn, setSelectedDrn] = useState<PhysicalDrnRecord | null>(null);
  const [targetBoidInput, setTargetBoidInput] = useState("");
  const [drnNoInput, setDrnNoInput] = useState("");
  const [drnStatusInput, setDrnStatusInput] = useState<
    "PHYSICAL" | "POSTED" | "ACCEPTED" | "REJECTED"
  >("POSTED");

  // -------------------------------------------------------------
  // PROMOTION STATE & SINGLE EDIT STATE
  // -------------------------------------------------------------
  const [isPromoting, setIsPromoting] = useState(false);
  const [allowVarianceOverride, setAllowVarianceOverride] = useState(false);
  const [selectedCdscFy, setSelectedCdscFy] = useState<string>("2080/81");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<MultiYearShareholderProfile | null>(null);
  const [editKittaInput, setEditKittaInput] = useState<string>("");
  const [editFractionInput, setEditFractionInput] = useState<string>("");
  const [editHolderTypeInput, setEditHolderTypeInput] = useState<
    "PROMOTER" | "PUBLIC" | "MUTUAL_FUND" | "CLEARING_POOL" | "PHYSICAL"
  >("PUBLIC");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isRecalculatingAll, setIsRecalculatingAll] = useState(false);
  const [isDecompositionModalOpen, setIsDecompositionModalOpen] = useState(false);

  // Active Company Timeline
  const timeline = useMemo(() => {
    return activeCompany?.timeline || AgmStudioService.getHistoricalTimeline(activeCompanyId);
  }, [activeCompany, activeCompanyId]);

  const handleSelectCompany = (id: string) => {
    setActiveCompanyId(id);
    AgmStudioService.setActiveCompanyId(id);
    const comp = companies.find((c) => c.id === id);
    if (comp) {
      setWizardTargetFy(comp.baseFiscalYear || comp.timeline[0]?.fiscalYear || "2075/76");
      const latest =
        comp.timeline[comp.timeline.length - 1]?.fiscalYear || comp.currentFiscalYear || "2080/81";
      setSelectedCdscFy(latest);
      toast.success(`Switched active corporate workspace to "${comp.name}" (${comp.code})`);
      loadInitialData(id);
    }
  };

  const handleCreateCompany = () => {
    if (!newCompCode.trim() || !newCompName.trim()) {
      toast.error("Please enter Company Code and Company Name.");
      return;
    }
    const newComp: CompanyProfile = {
      id: createGeneratedCompanyId(),
      code: newCompCode.toUpperCase().trim(),
      name: newCompName.trim(),
      isinPromoter: newCompIsinPo.trim() || undefined,
      isinPublic: newCompIsinPub.trim() || undefined,
      baseFiscalYear: newCompBaseFy.trim() || "2075/76",
      currentFiscalYear: "2080/81",
      timeline: activeCompany
        ? JSON.parse(JSON.stringify(activeCompany.timeline))
        : AgmStudioService.getHistoricalTimeline(),
    };
    const updated = [...companies, newComp];
    setCompanies(updated);
    AgmStudioService.saveCompanies(updated);
    handleSelectCompany(newComp.id);
    setIsCompanyModalOpen(false);
    setNewCompCode("");
    setNewCompName("");
    setNewCompIsinPo("");
    setNewCompIsinPub("");
    toast.success(`Created company profile "${newComp.name}"!`);
  };

  const handleSaveFyEvent = () => {
    if (!fyFormYear.trim() || !fyFormEventName.trim()) {
      toast.error("Please enter Fiscal Year and Event Name.");
      return;
    }
    const newEvent: HistoricalFiscalYearConfig = {
      fiscalYear: fyFormYear.trim(),
      eventName: fyFormEventName.trim(),
      eventType: fyFormEventType,
      bonusRatioPct: parseFloat(fyFormBonusPct) || 0,
      cashDividendRatioPct: parseFloat(fyFormCashPct) || 0,
      rightRatioPct: parseFloat(fyFormRightPct) || 0,
      conversionRatioPct: parseFloat(fyFormConvPct) || 0,
      bookCloseDateBs: fyFormBookClose.trim() || "2082-01-15",
      promoterKittaBaseline: 0,
      publicKittaBaseline: 0,
      totalListedKitta: 0,
      notes: fyFormNotes.trim() || "Custom corporate action setup.",
    };

    const currentTimeline = [...timeline];
    const existingIdx = currentTimeline.findIndex((e) => e.fiscalYear === newEvent.fiscalYear);
    if (existingIdx >= 0) {
      currentTimeline[existingIdx] = newEvent;
    } else {
      currentTimeline.push(newEvent);
    }

    const updatedCompany: CompanyProfile = {
      ...activeCompany,
      timeline: currentTimeline,
    };

    const updatedCompanies = companies.map((c) => (c.id === activeCompany.id ? updatedCompany : c));
    setCompanies(updatedCompanies);
    AgmStudioService.saveCompanies(updatedCompanies);
    setIsAddFyModalOpen(false);
    setEditingFy(null);
    toast.success(`Saved Corporate Action configuration for FY ${newEvent.fiscalYear}!`);
  };

  const handleDeleteFyEvent = (fy: string) => {
    const updatedTimeline = timeline.filter((e) => e.fiscalYear !== fy);
    if (updatedTimeline.length === 0) {
      toast.error("Cannot remove all fiscal year events. At least one event is required.");
      return;
    }
    const updatedCompany: CompanyProfile = {
      ...activeCompany,
      timeline: updatedTimeline,
    };
    const updatedCompanies = companies.map((c) => (c.id === activeCompany.id ? updatedCompany : c));
    setCompanies(updatedCompanies);
    AgmStudioService.saveCompanies(updatedCompanies);
    toast.success(`Removed FY ${fy} from corporate action timeline.`);
  };

  const [isDragOver, setIsDragOver] = useState(false);

  // Load FY Ledger, Pools, DRN, Claims, Conversions and real Database Shareholders on mount
  const loadInitialData = useCallback(
    async (targetCompanyId = activeCompanyId) => {
      try {
        const [ledgerRecords, dbPools, dbClaims, dbDrn, dbShRes, summaryStats, dbConversions] =
          await Promise.all([
            AgmStudioService.fetchFiscalYearLedger(targetCompanyId),
            AgmStudioService.fetchBrokerPools(targetCompanyId),
            AgmStudioService.fetchBrokerClaims(targetCompanyId),
            AgmStudioService.fetchDrnRecords(targetCompanyId),
            AgmStudioService.fetchDbShareholders(1, 50, "", "ALL", targetCompanyId),
            AgmStudioService.fetchDbSummaryStats(targetCompanyId),
            AgmStudioService.fetchConversionRecordsFromDatabase("2076/77", targetCompanyId),
          ]);
        setFyLedger(ledgerRecords);
        if (dbPools.length > 0) setPools(dbPools);
        if (dbClaims.length > 0) setClaims(dbClaims);
        if (dbDrn.length > 0) setDrnList(dbDrn);
        setDbSummaryStats(summaryStats);
        if (dbConversions && dbConversions.length > 0) {
          setConversionRecords(dbConversions);
          const sumPre = dbConversions.reduce((s, r) => s + r.preConversionTotal, 0);
          const sumProm = dbConversions.reduce(
            (s, r) => s + r.promoterRetainedInt + r.promoterRetainedFrac,
            0,
          );
          const sumPub = dbConversions.reduce(
            (s, r) => s + r.publicConvertedInt + r.publicConvertedFrac,
            0,
          );
          const sumFrac = dbConversions.reduce((s, r) => s + r.fractionRemainder, 0);
          const baseTotal = sumPre || 1;
          setConversionSummary({
            totalAccounts: dbConversions.length,
            totalPreConversionKitta: Math.round(sumPre * 100) / 100,
            totalPromoterRetained: Math.round(sumProm * 10000) / 10000,
            totalPublicConverted: Math.round(sumPub * 10000) / 10000,
            totalFractionsPreserved: Math.round(sumFrac * 10000) / 10000,
            ratioActualPromoterPct: Math.round((sumProm / baseTotal) * 10000) / 100,
            ratioActualPublicPct: Math.round((sumPub / baseTotal) * 10000) / 100,
            floatingLotDifference: Math.round(sumFrac * 10000) / 10000,
            caSeqList: Array.from(new Set(dbConversions.map((r) => r.caSeqNo).filter(Boolean))),
          });
        } else {
          setConversionRecords([]);
          setConversionSummary(null);
        }
        if (dbShRes.profiles.length > 0 || dbShRes.totalCount > 0) {
          setDbProfiles(dbShRes.profiles);
          setDbFilteredCount(dbShRes.totalCount || summaryStats.totalShareholders || 0);
          setDbTotalCount(summaryStats.totalShareholders || dbShRes.totalCount || 0);
          setDataSourceMode("DATABASE");
        }
        setDbError(null);
      } catch (e: any) {
        console.error("Could not load initial AGM data:", e);
        setDbError(e?.message || "Failed to query AGM database records");
        toast.error(`Database error: ${e?.message || "Failed to load initial AGM data"}`);
      }
    },
    [activeCompanyId],
  );

  useEffect(() => {
    loadInitialData(activeCompanyId);
  }, [loadInitialData, activeCompanyId]);

  const loadLedger = async () => {
    try {
      const records = await AgmStudioService.fetchFiscalYearLedger(activeCompanyId);
      setFyLedger(records);
    } catch (e: any) {
      console.error("Could not load FY ledger:", e);
      toast.error(`Failed to load FY ledger: ${e?.message || "Query error"}`);
    }
  };

  // Load DB Shareholders
  const loadDbShareholders = useCallback(
    async (page = 1, size = 50, q = "", filter = "ALL") => {
      setIsLoadingDb(true);
      setDbError(null);
      try {
        const [res, summary] = await Promise.all([
          AgmStudioService.fetchDbShareholders(page, size, q, filter, activeCompanyId),
          AgmStudioService.fetchDbSummaryStats(activeCompanyId),
        ]);
        setDbProfiles(res.profiles);
        setDbFilteredCount(res.totalCount);
        if (!q.trim() && filter === "ALL") {
          setDbTotalCount(res.totalCount || summary.totalShareholders || 0);
        } else if (summary.totalShareholders) {
          setDbTotalCount(summary.totalShareholders);
        }
        setDbSummaryStats(summary);
        if (res.profiles.length > 0 || res.totalCount > 0) {
          setDataSourceMode("DATABASE");
        }
      } catch (e: any) {
        console.error("Error fetching DB shareholders:", e);
        const msg = e?.message || "Query error fetching database shareholders";
        setDbError(msg);
        toast.error(`Database error loading shareholders: ${msg}`);
      } finally {
        setIsLoadingDb(false);
      }
    },
    [activeCompanyId],
  );

  // Real-time search in DATABASE mode as user types or filters change
  const dbQueryResetKey = `${debouncedSearch}|${dataSourceMode}|${pageSize}|${typeFilter}`;
  const [prevDbQueryResetKey, setPrevDbQueryResetKey] = useState(dbQueryResetKey);
  if (prevDbQueryResetKey !== dbQueryResetKey) {
    setPrevDbQueryResetKey(dbQueryResetKey);
    if (dataSourceMode === "DATABASE" && currentPage !== 1) {
      setCurrentPage(1);
    }
  }

  useEffect(() => {
    if (dataSourceMode !== "DATABASE") return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        void loadDbShareholders(1, pageSize, debouncedSearch, typeFilter);
      }
    });
    return () => {
      active = false;
    };
  }, [debouncedSearch, dataSourceMode, pageSize, typeFilter, loadDbShareholders]);

  // Process Uploaded Workbooks (Single or Multiple)
  const processUploadedWorkbooks = async (files: File[]) => {
    if (files.length === 0) return;
    setIsParsingFile(true);
    const toastId = toast.loading(`Parsing & merging ${files.length} workbook(s)...`);
    try {
      const mergedProfileMap = new Map<string, MultiYearShareholderProfile>();
      const consolidatedPools: BrokerPoolRecord[] = [];
      const consolidatedDrn: PhysicalDrnRecord[] = [];

      let totalDiscrepancies = 0;
      let combinedReport: ImportValidationReport | null = null;

      for (let fIdx = 0; fIdx < files.length; fIdx++) {
        const file = files[fIdx];
        toast.loading(`[File ${fIdx + 1}/${files.length}] Reading ${file.name}...`, {
          id: toastId,
        });
        const buffer = await file.arrayBuffer();
        const res = await AgmStudioService.parseHistoricalExcelWithReport(
          buffer,
          file.name,
          wizardTargetFy,
          timeline,
          (msg, pct) => {
            toast.loading(`[File ${fIdx + 1}/${files.length}] ${msg} (${pct}%)`, { id: toastId });
          },
        );

        totalDiscrepancies += res.report.discrepanciesCount;
        consolidatedPools.push(...res.brokerPools);
        consolidatedDrn.push(...res.drnRecords);

        // Merge profiles by BOID
        res.profiles.forEach((p) => {
          if (mergedProfileMap.has(p.boid)) {
            const ex = mergedProfileMap.get(p.boid)!;
            ex.currentKitta2081 += p.currentKitta2081;
            ex.currentFraction2081 =
              Math.round((ex.currentFraction2081 + p.currentFraction2081) * 10000) / 10000;
            ex.initialKitta2075 = (ex.initialKitta2075 || 0) + (p.initialKitta2075 || 0);
            ex.initialFraction2075 =
              Math.round(((ex.initialFraction2075 || 0) + (p.initialFraction2075 || 0)) * 10000) /
              10000;
            if (p.importedBaseKitta !== undefined) {
              ex.importedBaseKitta = (ex.importedBaseKitta || 0) + p.importedBaseKitta;
            }
            ex.totalBonusSharesReceived =
              (ex.totalBonusSharesReceived || 0) + (p.totalBonusSharesReceived || 0);
            ex.totalCashDividendReceived =
              Math.round(
                ((ex.totalCashDividendReceived || 0) + (p.totalCashDividendReceived || 0)) * 100,
              ) / 100;
            ex.totalTaxWithheld =
              Math.round(((ex.totalTaxWithheld || 0) + (p.totalTaxWithheld || 0)) * 100) / 100;
            if (p.convertedShares) {
              ex.convertedShares = (ex.convertedShares || 0) + p.convertedShares;
            }
            ex.isConversionMerged = ex.isConversionMerged || p.isConversionMerged;

            // Merge yearlySnapshots
            p.yearlySnapshots.forEach((pSnap) => {
              const exSnap = ex.yearlySnapshots.find((s) => s.fiscalYear === pSnap.fiscalYear);
              if (exSnap) {
                exSnap.baseKitta += pSnap.baseKitta;
                exSnap.previousFraction =
                  Math.round((exSnap.previousFraction + pSnap.previousFraction) * 10000) / 10000;
                exSnap.grossBonusEntitlement += pSnap.grossBonusEntitlement;
                exSnap.issuedWholeBonus += pSnap.issuedWholeBonus;
                exSnap.carriedNewFraction =
                  Math.round((exSnap.carriedNewFraction + pSnap.carriedNewFraction) * 10000) /
                  10000;
                exSnap.grossCashDividend =
                  Math.round((exSnap.grossCashDividend + pSnap.grossCashDividend) * 100) / 100;
                exSnap.bonusTaxWithheld =
                  Math.round((exSnap.bonusTaxWithheld + pSnap.bonusTaxWithheld) * 100) / 100;
                exSnap.cashTaxWithheld =
                  Math.round((exSnap.cashTaxWithheld + pSnap.cashTaxWithheld) * 100) / 100;
                exSnap.netCashPayable =
                  Math.round((exSnap.netCashPayable + pSnap.netCashPayable) * 100) / 100;
                exSnap.postEventKitta += pSnap.postEventKitta;
                if (pSnap.rightSharesAllotted) {
                  exSnap.rightSharesAllotted =
                    (exSnap.rightSharesAllotted || 0) + pSnap.rightSharesAllotted;
                }
                if (pSnap.convertedShares) {
                  exSnap.convertedShares = (exSnap.convertedShares || 0) + pSnap.convertedShares;
                }
                exSnap.excelDiscrepancy = exSnap.excelDiscrepancy || pSnap.excelDiscrepancy;
              } else {
                ex.yearlySnapshots.push({ ...pSnap });
              }
            });

            if (p.anomalies && p.anomalies.length > 0) {
              ex.anomalies = Array.from(new Set([...(ex.anomalies || []), ...p.anomalies]));
            }
            ex.hasDiscrepancy = ex.hasDiscrepancy || p.hasDiscrepancy;

            if (!ex.fatherName && p.fatherName) ex.fatherName = p.fatherName;
            if (!ex.grandfatherName && p.grandfatherName) ex.grandfatherName = p.grandfatherName;
            if (!ex.panNo && p.panNo) ex.panNo = p.panNo;
            if (!ex.citizenshipNo && p.citizenshipNo) ex.citizenshipNo = p.citizenshipNo;
            if (!ex.contactNo && p.contactNo) ex.contactNo = p.contactNo;
            if (!ex.bankName && p.bankName) ex.bankName = p.bankName;
            if (!ex.bankAccountNo && p.bankAccountNo) ex.bankAccountNo = p.bankAccountNo;
            if (p.holderType === "PUBLIC") ex.holderType = "PUBLIC";
          } else {
            mergedProfileMap.set(p.boid, {
              ...p,
              yearlySnapshots: p.yearlySnapshots.map((s) => ({ ...s })),
            });
          }
        });

        if (!combinedReport) {
          combinedReport = {
            ...res.report,
            sheetNames: [...res.report.sheetNames],
            skippedRows: [...res.report.skippedRows],
            warnings: [...res.report.warnings],
            byCategory: { ...res.report.byCategory },
          };
        } else {
          combinedReport.totalRowsScanned += res.report.totalRowsScanned;
          combinedReport.skippedRowsCount += res.report.skippedRowsCount;
          combinedReport.duplicateBoidsCount += res.report.duplicateBoidsCount;
          combinedReport.convertedShareholdersCount =
            (combinedReport.convertedShareholdersCount || 0) +
            (res.report.convertedShareholdersCount || 0);
          combinedReport.totalConvertedKitta =
            (combinedReport.totalConvertedKitta || 0) + (res.report.totalConvertedKitta || 0);
          combinedReport.sheetNames = Array.from(
            new Set([...combinedReport.sheetNames, ...res.report.sheetNames]),
          );
          combinedReport.skippedRows.push(...res.report.skippedRows);
          combinedReport.totalKitta += res.report.totalKitta;
          combinedReport.totalFraction =
            Math.round((combinedReport.totalFraction + res.report.totalFraction) * 10000) / 10000;
          combinedReport.estimatedGrossCash =
            Math.round((combinedReport.estimatedGrossCash + res.report.estimatedGrossCash) * 100) /
            100;
          combinedReport.estimatedNetCash =
            Math.round((combinedReport.estimatedNetCash + res.report.estimatedNetCash) * 100) / 100;
          combinedReport.mutualFundCashPayable =
            Math.round(
              (combinedReport.mutualFundCashPayable + res.report.mutualFundCashPayable) * 100,
            ) / 100;
          combinedReport.byCategory.promoterDemat += res.report.byCategory.promoterDemat;
          combinedReport.byCategory.publicDemat += res.report.byCategory.publicDemat;
          combinedReport.byCategory.physicalFolios += res.report.byCategory.physicalFolios;
          combinedReport.byCategory.mutualFunds += res.report.byCategory.mutualFunds;
          combinedReport.byCategory.clearingPools += res.report.byCategory.clearingPools;
          combinedReport.warnings = Array.from(
            new Set([...combinedReport.warnings, ...res.report.warnings]),
          );
          combinedReport.criticalCapitalVariance =
            combinedReport.criticalCapitalVariance || res.report.criticalCapitalVariance;
        }
      }

      const mergedProfiles = Array.from(mergedProfileMap.values());
      if (mergedProfiles.length === 0 || !combinedReport) {
        toast.dismiss(toastId);
        toast.error("No valid shareholder records found in the workbook(s).");
        return;
      }

      combinedReport.validRecords = mergedProfiles.length;
      combinedReport.discrepanciesCount = totalDiscrepancies;

      // Check if previous FY is available in DB to run full Dual-Key YoY Chain validation
      const currentFyIndex = timeline.findIndex((t) => t.fiscalYear === wizardTargetFy);
      if (currentFyIndex > 0) {
        const prevFy = timeline[currentFyIndex - 1].fiscalYear;
        const prevLocked = fyLedger.find((f) => f.fiscalYear === prevFy);
        if (prevLocked) {
          toast.loading(`Reconciling YoY Chain vs locked FY ${prevFy}...`, { id: toastId });
          const dbPrevSnapshots = await AgmStudioService.fetchPreviousFiscalYearSnapshots(
            prevFy,
            activeCompanyId,
          );
          const prevProfiles =
            dbPrevSnapshots.length > 0
              ? dbPrevSnapshots
              : dbProfiles.map((p) => {
                  const snap = p.yearlySnapshots.find((s) => s.fiscalYear === prevFy);
                  return {
                    boid: p.boid,
                    closingKitta: snap ? snap.postEventKitta : p.currentKitta2081,
                    closingFraction: snap ? snap.carriedNewFraction : p.currentFraction2081,
                  };
                });

          if (prevProfiles.length > 0) {
            const yoyReport = AgmStudioService.validateYearOverYearChain(
              mergedProfiles,
              prevProfiles,
              prevFy,
              wizardTargetFy,
            );
            combinedReport.yoyReport = yoyReport;
            // Count opening fraction mismatches detected during YoY chain
            const mismatchCount = mergedProfiles.filter(
              (p) =>
                p.anomalies && p.anomalies.some((a) => a.includes("Opening fraction mismatch")),
            ).length;
            if (mismatchCount > 0) {
              combinedReport.openingFractionMismatchesCount =
                (combinedReport.openingFractionMismatchesCount || 0) + mismatchCount;
              combinedReport.warnings.push(
                `🔍 Opening fraction chain mismatches detected: ${mismatchCount} shareholder(s) show fractional deviation vs FY ${prevFy} locked closing.`,
              );
            }
          }
        }
      }

      setParsedProfiles(mergedProfiles);
      setParsedBrokerPools(consolidatedPools);
      setParsedDrnRecords(consolidatedDrn);
      setImportReport(combinedReport);

      // Deduplicate pools and DRN
      if (consolidatedPools.length > 0) {
        setPools((prev) => {
          const map = new Map(prev.map((p) => [`${p.poolBoid}-${p.fiscalYear}`, p]));
          consolidatedPools.forEach((p) => map.set(`${p.poolBoid}-${p.fiscalYear}`, p));
          return Array.from(map.values());
        });
      }
      if (consolidatedDrn.length > 0) {
        setDrnList((prev) => {
          const map = new Map(prev.map((d) => [d.folioNo, d]));
          consolidatedDrn.forEach((d) => map.set(d.folioNo, d));
          return Array.from(map.values());
        });
      }

      setWizardStep(2);
      toast.dismiss(toastId);
      toast.success(
        `Merged ${files.length} file(s): ${mergedProfiles.length.toLocaleString()} shareholders unified! (${totalDiscrepancies} variances audited).`,
      );
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(err?.message || "Failed to parse workbooks.");
    } finally {
      setIsParsingFile(false);
    }
  };

  const handleWizardFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    await processUploadedWorkbooks(files);
    if (e.target) e.target.value = "";
  };

  // Handle Wizard Commit to Database
  const handleSaveWizardBatch = async () => {
    if (!importReport || parsedProfiles.length === 0) {
      toast.error("No parsed dataset to save.");
      return;
    }

    if (importReport.criticalCapitalVariance && !allowVarianceOverride) {
      toast.error(
        "Cannot save: Critical Capital Balance Variance exceeds 5.0% statutory threshold. Please verify uploaded workbook.",
      );
      return;
    }

    const preValidation = AgmStudioService.validateImportDataset(
      parsedProfiles,
      wizardTargetFy,
      timeline,
      activeCompany,
    );

    if (!preValidation.canProceed && !allowVarianceOverride) {
      toast.error(`Cannot save: ${preValidation.criticalErrors.join(" | ")}`);
      return;
    }

    const existingMeta = fyLedger.find((f) => f.fiscalYear === wizardTargetFy);
    if (existingMeta?.isLocked) {
      const confirmOverwrite = window.confirm(
        `⚠️ Notice: Fiscal Year ${wizardTargetFy} is currently LOCKED in the historical database.\n\nDo you wish to proceed and update the records for FY ${wizardTargetFy}?`,
      );
      if (!confirmOverwrite) return;
    }

    setIsSavingBatch(true);
    const fyConfig = timeline.find((t) => t.fiscalYear === wizardTargetFy);
    const eventName = fyConfig?.eventName || `AGM Corporate Action FY ${wizardTargetFy}`;

    const toastId = toast.loading(`Saving & Locking FY ${wizardTargetFy} — Starting...`);
    try {
      const res = await AgmStudioService.saveFiscalYearToDatabase(
        wizardTargetFy,
        eventName,
        parsedProfiles,
        parsedBrokerPools,
        parsedDrnRecords,
        importReport,
        (saved, total, pct) => {
          toast.loading(
            pct >= 100
              ? `✅ All ${total.toLocaleString()} shareholders saved — Finalizing...`
              : `Saving & Locking FY ${wizardTargetFy}: ${saved.toLocaleString()} / ${total.toLocaleString()} (${pct}%)...`,
            { id: toastId },
          );
        },
        activeCompanyId,
      );

      toast.loading(`📋 Refreshing FY Ledger...`, { id: toastId });
      await loadLedger();

      toast.loading(`🔍 Loading registry view...`, { id: toastId });
      await loadDbShareholders(1, pageSize, "", "ALL");

      toast.dismiss(toastId);
      toast.success(
        `Saved & Locked FY ${wizardTargetFy}! ${res.savedCount.toLocaleString()} shareholders persisted to DB.`,
      );
      setWizardStep(3);
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(err?.message || "Failed to save batch to database.");
    } finally {
      setIsSavingBatch(false);
    }
  };

  // Toggle Lock/Unlock on a Fiscal Year
  const handleToggleLock = async (fiscalYear: string, currentLockState: boolean) => {
    const newState = !currentLockState;
    try {
      await AgmStudioService.toggleLockFiscalYear(fiscalYear, newState, activeCompanyId);
      await loadLedger();
      toast.success(
        `FY ${fiscalYear} is now ${newState ? "Locked (Protected)" : "Unlocked for Re-import"}.`,
      );
    } catch (e: any) {
      toast.error(e?.message || "Failed to toggle lock state.");
    }
  };

  // Handle Manual DRN Update
  const handleSaveDrnMapping = async () => {
    if (!selectedDrn) return;
    if (!targetBoidInput || targetBoidInput.length < 16) {
      toast.error("Please enter a valid 16-digit Target DEMAT BOID.");
      return;
    }

    const updated: PhysicalDrnRecord = {
      ...selectedDrn,
      targetBoid: targetBoidInput,
      drnNo:
        drnNoInput ||
        `DRN-${activeCompany.code || "NLG"}-${Math.floor(10000 + Math.random() * 90000)}`,
      status: drnStatusInput,
    };

    setDrnList((prev) => prev.map((d) => (d.folioNo === selectedDrn.folioNo ? updated : d)));
    setIsDrnModalOpen(false);

    try {
      await AgmStudioService.updateDrnRecord(updated, activeCompanyId);
      toast.success(
        `Folio ${selectedDrn.folioNo} mapped to DEMAT BOID ${targetBoidInput} (${drnStatusInput})!`,
      );
    } catch (e: any) {
      toast.error("Failed to persist DRN update.");
    }
  };

  const handleAutoMatchDrn = () => {
    const matches = AgmStudioService.autoSuggestDrnMatches(drnList, activeProfiles);
    if (matches.length === 0) {
      toast.info("No exact holder name matches found between unmapped folios and DEMAT registry.");
      return;
    }
    const matchMap = new Map(matches.map((m) => [m.folioNo, m.suggestedBoid]));
    const updated = drnList.map((d) => {
      const suggested = matchMap.get(d.folioNo);
      if (suggested && !d.targetBoid) {
        return {
          ...d,
          targetBoid: suggested,
          status: "POSTED" as const,
          drnNo: d.drnNo || `DRN-NLG-${Math.floor(10000 + Math.random() * 90000)}`,
          drnDate: d.drnDate || new Date().toISOString().slice(0, 10),
        };
      }
      return d;
    });
    setDrnList(updated);
    toast.success(
      `Auto-matched and mapped ${matches.length} physical folios to verified DEMAT BOIDs!`,
    );
  };

  // Active Profile Set based on DataSourceMode
  const activeProfiles = dataSourceMode === "DATABASE" ? dbProfiles : parsedProfiles;

  // Client-Side Filtered Profiles (For In-Memory / Draft mode)
  const filteredProfiles = useMemo(() => {
    if (dataSourceMode === "DATABASE") return dbProfiles;
    return activeProfiles.filter((p) => {
      if (p.boid === "REMCONVERSION" || p.boid === "REMBONUSFY20767778") return false;
      if (typeFilter === "DISCREPANCY" && !p.hasDiscrepancy) return false;
      if (typeFilter !== "ALL" && typeFilter !== "DISCREPANCY" && p.holderType !== typeFilter)
        return false;
      if (!debouncedSearch.trim()) return true;
      const q = debouncedSearch.toLowerCase();
      return (
        (p.boid || "").toLowerCase().includes(q) ||
        (p.originalFolioNo && p.originalFolioNo.toLowerCase().includes(q)) ||
        (p.shareholderName || "").toLowerCase().includes(q) ||
        (p.fatherName && p.fatherName.toLowerCase().includes(q)) ||
        (p.grandfatherName && p.grandfatherName.toLowerCase().includes(q)) ||
        (p.guardianName && p.guardianName.toLowerCase().includes(q)) ||
        (p.spouseName && p.spouseName.toLowerCase().includes(q)) ||
        (p.citizenshipNo && p.citizenshipNo.toLowerCase().includes(q)) ||
        (p.district && p.district.toLowerCase().includes(q)) ||
        (p.contactNo && p.contactNo.toLowerCase().includes(q)) ||
        (p.bankName && p.bankName.toLowerCase().includes(q)) ||
        (p.bankAccountNo && p.bankAccountNo.toLowerCase().includes(q)) ||
        (p.email && p.email.toLowerCase().includes(q)) ||
        (p.panNo && p.panNo.toLowerCase().includes(q))
      );
    });
  }, [activeProfiles, debouncedSearch, typeFilter, dataSourceMode, dbProfiles]);

  const totalRecordCount =
    dataSourceMode === "DATABASE"
      ? searchQuery.trim() || typeFilter !== "ALL"
        ? dbFilteredCount
        : dbTotalCount || dbSummaryStats?.totalShareholders || 0
      : filteredProfiles.length;
  const totalPages = Math.max(1, Math.ceil(totalRecordCount / pageSize));

  const paginatedProfiles = useMemo(() => {
    let list = dataSourceMode === "DATABASE" ? dbProfiles : filteredProfiles;
    if (agmFyFilter !== "ALL" && onlyPresentInFy) {
      const cleanFy = agmFyFilter.replace("FY ", "").trim();
      list = list.filter((p) =>
        p.yearlySnapshots?.some(
          (s) => s.fiscalYear === agmFyFilter || s.fiscalYear.includes(cleanFy),
        ),
      );
    }
    if (dataSourceMode === "DATABASE") return list;
    const start = (currentPage - 1) * pageSize;
    return list.slice(start, start + pageSize);
  }, [
    dataSourceMode,
    dbProfiles,
    filteredProfiles,
    currentPage,
    pageSize,
    agmFyFilter,
    onlyPresentInFy,
  ]);

  const handleApplyFilter = () => {
    setCurrentPage(1);
    if (dataSourceMode === "DATABASE") {
      loadDbShareholders(1, pageSize, searchQuery, typeFilter);
    }
  };

  const stats = useMemo(() => {
    if (dataSourceMode === "DATABASE") {
      if (dbSummaryStats) {
        return {
          count: dbSummaryStats.totalShareholders ?? (dbTotalCount || 0),
          totalKitta: dbSummaryStats.totalKitta,
          totalBonus: dbSummaryStats.totalBonus,
          totalCash: dbSummaryStats.totalCash,
          totalTax: dbSummaryStats.totalTax,
          mfCash: dbSummaryStats.mfCash,
        };
      }
      return {
        count: dbTotalCount || 0,
        totalKitta: 0,
        totalBonus: 0,
        totalCash: 0,
        totalTax: 0,
        mfCash: 0,
      };
    }
    const list = activeProfiles;
    const totalKitta = list.reduce((s, p) => s + p.currentKitta2081, 0);
    const totalBonus = list.reduce((s, p) => s + p.totalBonusSharesReceived, 0);
    const totalCash = list.reduce((s, p) => s + p.totalCashDividendReceived, 0);
    const totalTax = list.reduce((s, p) => s + p.totalTaxWithheld, 0);
    const mfCash = list
      .filter((p) => p.holderType === "MUTUAL_FUND")
      .reduce((s, p) => s + p.totalCashDividendReceived, 0);
    return {
      count: list.length,
      totalKitta,
      totalBonus,
      totalCash: Math.round(totalCash * 100) / 100,
      totalTax: Math.round(totalTax * 100) / 100,
      mfCash: Math.round(mfCash * 100) / 100,
    };
  }, [activeProfiles, dataSourceMode, dbSummaryStats, dbTotalCount]);

  // Handle Settle Broker Pool Claim
  const handleProcessClaim = async () => {
    if (!selectedPool) return;
    const kitta = Number(claimedKitta) || 0;
    if (kitta <= 0 || kitta > selectedPool.activeBalanceKitta) {
      toast.error(
        `Invalid claimed kitta. Maximum available is ${selectedPool.activeBalanceKitta}.`,
      );
      return;
    }
    if (!claimantBoid || claimantBoid.length < 16) {
      toast.error("Please enter a valid 16-digit Claimant BOID.");
      return;
    }

    const poolFyConfig = timeline.find((t) => t.fiscalYear === selectedPool.fiscalYear);
    const cashRatePct = poolFyConfig ? poolFyConfig.cashDividendRatioPct : 0.28947;
    const cashAmount = Math.round((kitta * 100 * (cashRatePct / 100) + Number.EPSILON) * 100) / 100;

    const newClaim: BrokerPoolClaim = {
      id: `claim-${Date.now()}`,
      seqNo: 9020000 + claims.length + 1,
      brokerCode: selectedPool.brokerCode,
      brokerName: selectedPool.brokerName,
      poolBoid: selectedPool.poolBoid,
      claimantBoid,
      claimantName: claimantName || "Beneficial Claimant",
      fiscalYear: selectedPool.fiscalYear,
      claimedKitta: kitta,
      claimedCash: cashAmount,
      contractNoteNo: contractNote,
      tradeDateBs: tradeDate,
      status: "APPROVED",
      approveDate: new Date().toISOString().slice(0, 10),
      approvedBy: "Operator (Verified)",
      remarks: "Trade date verified on or prior to Book Close date.",
    };

    setPools((prev) =>
      prev.map((pool) => {
        if (pool.poolBoid === selectedPool.poolBoid) {
          return {
            ...pool,
            claimedKitta: pool.claimedKitta + kitta,
            claimedCash: Math.round((pool.claimedCash + cashAmount) * 100) / 100,
            activeBalanceKitta: pool.activeBalanceKitta - kitta,
            activeBalanceCash: Math.round((pool.activeBalanceCash - cashAmount) * 100) / 100,
            claimsCount: pool.claimsCount + 1,
          };
        }
        return pool;
      }),
    );

    setClaims((prev) => [newClaim, ...prev]);
    setIsClaimModalOpen(false);
    try {
      await AgmStudioService.saveBrokerPoolClaim(newClaim, activeCompanyId);
      toast.success(
        `Claim Approved (Seq #${newClaim.seqNo})! Transferred ${kitta} shares & NPR ${cashAmount} to ${claimantBoid}.`,
      );
    } catch (err: any) {
      toast.error(err?.message || "Failed to persist claim to database.");
    }
  };

  const handleRecalculateAllProfiles = async () => {
    if (isRecalculatingAll) return;
    setIsRecalculatingAll(true);

    if (dataSourceMode === "DATABASE") {
      const toastId = toast.loading(
        "Recalculating all database records against corporate action timeline...",
      );
      try {
        const res = await AgmStudioService.recalculateAndPersistAllTimelineProfiles(
          timeline,
          (processed, total, pct) => {
            toast.loading(
              `Recalculating portfolio: ${processed.toLocaleString()} / ${total.toLocaleString()} (${pct}%)...`,
              {
                id: toastId,
              },
            );
          },
          activeCompanyId,
        );

        // Refresh stats and current page
        const newStats = await AgmStudioService.fetchDbSummaryStats(activeCompanyId);
        setDbSummaryStats(newStats);
        await loadDbShareholders(1, pageSize, searchQuery, typeFilter);

        toast.dismiss(toastId);
        toast.success(
          `Successfully recalculated & updated all ${res.updatedCount.toLocaleString()} shareholder records against active corporate actions!`,
        );
      } catch (e: any) {
        toast.dismiss(toastId);
        toast.error(e?.message || "Recalculation failed.");
      } finally {
        setIsRecalculatingAll(false);
      }
      return;
    }

    try {
      if (parsedProfiles.length === 0) {
        toast.info("No shareholder profiles loaded. Please upload an Excel workbook first.");
        return;
      }
      const baseSet = parsedProfiles;
      const updated = baseSet.map((p) => {
        const initialFrac =
          p.yearlySnapshots?.[0]?.previousFraction ?? (p.initialFraction2075 || 0);
        const baseKitta = p.importedBaseKitta ?? p.initialKitta2075;
        const snapshots = AgmStudioService.calculateShareholderEvolution(
          baseKitta,
          initialFrac,
          timeline,
          p.holderType,
          undefined,
          undefined,
          p.convertedShares,
          undefined,
          p.isConversionMerged,
        );
        const last = snapshots[snapshots.length - 1];
        const totalBonus = snapshots.reduce((s, snap) => s + snap.issuedWholeBonus, 0);
        const totalCash = snapshots.reduce((s, snap) => s + snap.grossCashDividend, 0);
        const totalTax = snapshots.reduce(
          (s, snap) => s + (snap.bonusTaxWithheld + snap.cashTaxWithheld),
          0,
        );

        return {
          ...p,
          currentKitta2081: last ? last.postEventKitta : baseKitta,
          currentFraction2081: last ? last.carriedNewFraction : initialFrac,
          totalBonusSharesReceived: totalBonus,
          totalCashDividendReceived: Math.round(totalCash * 100) / 100,
          totalTaxWithheld: Math.round(totalTax * 100) / 100,
          yearlySnapshots: snapshots,
          hasDiscrepancy: snapshots.some((s) => s.excelDiscrepancy),
        };
      });

      if (parsedProfiles.length > 0) {
        setParsedProfiles(updated);
      }
      toast.success(
        `Recalculated ${updated.length.toLocaleString()} shareholder positions against updated corporate action timeline!`,
      );
    } catch (e: any) {
      toast.error(e?.message || "Recalculation failed.");
    } finally {
      setIsRecalculatingAll(false);
    }
  };

  const handleSaveSingleEdit = async () => {
    if (!editingProfile) return;
    const kittaNum = Number(editKittaInput);
    const fracNum = Number(editFractionInput) || 0;
    if (isNaN(kittaNum) || kittaNum < 0) {
      toast.error("Please enter a valid non-negative kitta amount.");
      return;
    }
    setIsSavingEdit(true);
    const toastId = toast.loading(
      `Recalculating & persisting ${editingProfile.shareholderName}...`,
    );
    try {
      const res = await AgmStudioService.updateSingleShareholderHolding(
        editingProfile.boid,
        kittaNum,
        fracNum,
        editHolderTypeInput,
        timeline,
        activeCompanyId,
      );

      if (dataSourceMode === "DATABASE") {
        setDbProfiles((prev) =>
          prev.map((p) => (p.boid === editingProfile.boid ? res.profile : p)),
        );
      } else {
        setParsedProfiles((prev) =>
          prev.map((p) => (p.boid === editingProfile.boid ? res.profile : p)),
        );
      }

      toast.dismiss(toastId);
      toast.success(
        `Updated & Recalculated ${editingProfile.shareholderName}! 7-year chain persisted.`,
      );
      setIsEditModalOpen(false);
      setEditingProfile(null);
    } catch (e: any) {
      toast.dismiss(toastId);
      toast.error(e?.message || "Failed to update shareholder.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const getExportContext = (): AgmStudioExportContext => ({
    activeCompany,
    activeCompanyId,
    dataSourceMode,
    parsedProfiles,
    activeProfiles,
    timeline,
    wizardTargetFy,
    drnList,
    conversionRecords,
    selectedCdscFy,
  });

  const handleDownloadCdscTxt = () => downloadCdscAutoCaTxt(getExportContext());

  const handleDownloadChronologicalLedger = () =>
    downloadChronologicalLedgerWorkbook(getExportContext());

  const handleDownloadExcel = () => downloadMasterAgmWorkbook(getExportContext());

  const handleDownloadMutualFundsExcel = () => downloadMutualFundsWorkbook(getExportContext());

  const handleDownloadDrnExcel = () => downloadDrnLedgerWorkbook(getExportContext());

  const handleDownloadFySummaryExcel = () => downloadFySummaryWorkbook(getExportContext());

  const handleDownloadAgmSpecific = (targetFy: string) =>
    downloadAgmSpecificWorkbook(getExportContext(), targetFy);

  const handleExportRegistry = () => exportShareholderRegistryWorkbook(getExportContext());

  const handleExportDiscrepancyReport = () => exportDiscrepancyAuditWorkbook(getExportContext());

  const handleExportConversionReport = () => exportConversionReportWorkbook(getExportContext());

  const handleExportShareholderJourney = (p: MultiYearShareholderProfile) =>
    exportShareholderJourneyWorkbook(p, getExportContext());

  const handleConversionFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    if (fileList.length === 0) return;

    setIsParsingConversion(true);
    const toastId = toast.loading(`Parsing & merging ${fileList.length} conversion workbook(s)...`);
    try {
      // Build unified registry indexed by boidOrFolio and normalized holderName
      const unifiedMap = new Map<string, PromoterConversionRecord>();
      const nameIndex = new Map<string, string>();

      // Preserve previously loaded records if uploading files sequentially
      conversionRecords.forEach((r) => {
        unifiedMap.set(r.boidOrFolio, { ...r });
        const normName = r.holderName.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (normName) nameIndex.set(normName, r.boidOrFolio);
      });

      let totalNewParsed = 0;
      let totalEnriched = 0;

      for (const file of fileList) {
        const buffer = await file.arrayBuffer();
        const res = AgmStudioService.parsePromoterConversionExcel(buffer, file.name);
        totalNewParsed += res.records.length;

        res.records.forEach((r) => {
          const normName = r.holderName.toLowerCase().replace(/[^a-z0-9]/g, "");
          const targetKey = unifiedMap.has(r.boidOrFolio)
            ? r.boidOrFolio
            : normName
              ? nameIndex.get(normName)
              : undefined;

          if (targetKey && unifiedMap.has(targetKey)) {
            const existing = unifiedMap.get(targetKey)!;
            // Upgrade folio to Demat BOID if new record has 16-digit BOID
            if (r.boidOrFolio.length === 16 && existing.boidOrFolio.length !== 16) {
              existing.boidOrFolio = r.boidOrFolio;
            }
            if (r.status === "CONVERTED") {
              existing.status = "CONVERTED";
              existing.remarks = "Demat conversion approved (SUCCESS).";
            }
            if (r.caSeqNo && r.caSeqNo !== "6316.001") {
              existing.caSeqNo = r.caSeqNo;
            }
            totalEnriched++;
          } else {
            unifiedMap.set(r.boidOrFolio, { ...r });
            if (normName) nameIndex.set(normName, r.boidOrFolio);
          }
        });
      }

      const mergedList = Array.from(unifiedMap.values());
      if (mergedList.length === 0) {
        toast.dismiss(toastId);
        toast.error("No valid conversion records found in selected workbook(s).");
        return;
      }

      const sumPre = mergedList.reduce((s, r) => s + r.preConversionTotal, 0);
      const sumProm = mergedList.reduce(
        (s, r) => s + r.promoterRetainedInt + r.promoterRetainedFrac,
        0,
      );
      const sumPub = mergedList.reduce(
        (s, r) => s + r.publicConvertedInt + r.publicConvertedFrac,
        0,
      );
      const sumFrac = mergedList.reduce((s, r) => s + r.fractionRemainder, 0);
      const baseTotal = sumPre || 1;

      const summary: ConversionSummaryReport = {
        totalAccounts: mergedList.length,
        totalPreConversionKitta: Math.round(sumPre * 100) / 100,
        totalPromoterRetained: Math.round(sumProm * 10000) / 10000,
        totalPublicConverted: Math.round(sumPub * 10000) / 10000,
        totalFractionsPreserved: Math.round(sumFrac * 10000) / 10000,
        ratioActualPromoterPct: Math.round((sumProm / baseTotal) * 10000) / 100,
        ratioActualPublicPct: Math.round((sumPub / baseTotal) * 10000) / 100,
        floatingLotDifference: Math.round(sumFrac * 10000) / 10000,
        caSeqList: Array.from(new Set(mergedList.map((r) => r.caSeqNo).filter(Boolean))),
      };

      setConversionRecords(mergedList);
      setConversionSummary(summary);
      toast.dismiss(toastId);
      toast.success(
        `Merged ${fileList.length} file(s): ${mergedList.length.toLocaleString()} conversion accounts unified (${totalEnriched.toLocaleString()} Demat matched)!`,
      );
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(err?.message || "Failed to parse conversion workbooks.");
    } finally {
      setIsParsingConversion(false);
      if (e.target) e.target.value = "";
    }
  };

  const handleExportConversionLedger = () => exportConversionLedgerWorkbook(getExportContext());

  const [isSavingConversion, setIsSavingConversion] = useState(false);

  const handleSaveConversionToDb = async () => {
    if (conversionRecords.length === 0) {
      toast.error("No conversion records to save.");
      return;
    }
    setIsSavingConversion(true);
    const toastId = toast.loading(
      `Saving ${conversionRecords.length.toLocaleString()} CA 6316 conversion records to DB...`,
    );
    try {
      const res = await AgmStudioService.saveConversionToDatabase(
        conversionRecords,
        "2076/77",
        activeCompanyId,
      );
      toast.dismiss(toastId);
      toast.success(
        `Successfully persisted ${res.savedCount.toLocaleString()} conversion snapshots to database!`,
      );
    } catch (e: any) {
      toast.dismiss(toastId);
      toast.error(e?.message || "Failed to save conversion records to DB.");
    } finally {
      setIsSavingConversion(false);
    }
  };

  const handleApplyStatutoryCorrections = async () => {
    if (dataSourceMode === "DATABASE") {
      const toastId = toast.loading(
        "Applying CDSC Statutory Recalculation across all flagged database accounts...",
      );
      try {
        const { correctedCount } = await AgmStudioService.applyAndPersistStatutoryCorrections(
          timeline,
          (processed, total) => {
            toast.loading(
              `Sanitizing & saving to database: ${processed.toLocaleString()} / ${total.toLocaleString()}...`,
              { id: toastId },
            );
          },
          activeCompanyId,
        );
        toast.dismiss(toastId);
        toast.success(
          `Successfully sanitized & updated ${correctedCount.toLocaleString()} accounts in the live database!`,
        );
        await loadDbShareholders(1, pageSize, searchQuery, typeFilter);
      } catch (e: any) {
        toast.dismiss(toastId);
        toast.error(e?.message || "Failed to apply corrections to database.");
      }
    } else {
      const corrected = AgmStudioService.applyStatutoryCorrections(parsedProfiles, timeline);
      setParsedProfiles(corrected);
      toast.success("Applied CDSC Statutory Linear Rule across all in-memory flagged accounts!");
    }
  };

  const filteredConversionRecords = useMemo(() => {
    return conversionRecords.filter((r) => {
      if (convStatusFilter !== "ALL" && r.status !== convStatusFilter) return false;
      if (!convSearch.trim()) return true;
      const q = convSearch.toLowerCase();
      return (
        r.boidOrFolio.toLowerCase().includes(q) ||
        r.holderName.toLowerCase().includes(q) ||
        r.caSeqNo.toLowerCase().includes(q)
      );
    });
  }, [conversionRecords, convStatusFilter, convSearch]);

  const totalConvPages = Math.max(1, Math.ceil(filteredConversionRecords.length / convPageSize));
  const paginatedConversionRecords = useMemo(() => {
    const start = (convPage - 1) * convPageSize;
    return filteredConversionRecords.slice(start, start + convPageSize);
  }, [filteredConversionRecords, convPage, convPageSize]);

  const filteredDrnList = useMemo(() => {
    return drnList.filter((r) => {
      if (drnStatusFilter !== "ALL" && r.status !== drnStatusFilter) return false;
      if (!drnSearch.trim()) return true;
      const q = drnSearch.toLowerCase();
      return (
        r.folioNo.toLowerCase().includes(q) ||
        r.holderName.toLowerCase().includes(q) ||
        (r.drnNo && r.drnNo.toLowerCase().includes(q)) ||
        (r.targetBoid && r.targetBoid.toLowerCase().includes(q))
      );
    });
  }, [drnList, drnStatusFilter, drnSearch]);

  const totalDrnPages = Math.max(1, Math.ceil(filteredDrnList.length / drnPageSize));
  const paginatedDrnList = useMemo(() => {
    const start = (drnPage - 1) * drnPageSize;
    return filteredDrnList.slice(start, start + drnPageSize);
  }, [filteredDrnList, drnPage, drnPageSize]);

  const handleDisperseBulkPools = async () => {
    const userConfirmed = window.confirm(
      `⚠️ Statutory Notice:\n\nThese accounts (REMCONVERSION, REMBONUS, FOLIO-REMPOOL, etc.) are kept in the system as Unmatched Reserve Pools.\n\nDispersing them into physical folios requires an official board resolution or verified physical certificate audit.\n\nDo you want to proceed with dispersing these pools?`,
    );
    if (!userConfirmed) return;

    if (dataSourceMode === "DATABASE") {
      const toastId = toast.loading(
        "Decomposing bulk placeholder pools (REMCONVERSION / REMBONUS) into physical folios...",
      );
      const res = await AgmStudioService.disperseBulkPoolsInDatabase(activeCompanyId);
      toast.dismiss(toastId);
      if (res.dispersedCount > 0) {
        await loadDbShareholders(1, pageSize, searchQuery, typeFilter);
        const newStats = await AgmStudioService.fetchDbSummaryStats(activeCompanyId);
        setDbSummaryStats(newStats);
        toast.success(
          `✨ Decomposed ${res.dispersedCount} bulk placeholder pool(s) into ${res.createdFoliosCount} physical promoter folios! Distributed ${res.totalKittaDistributed.toLocaleString()} kitta & NPR ${res.totalCashDistributed.toLocaleString()} cash.`,
          { duration: 6000 },
        );
      } else {
        toast.info("No bulk placeholder pools (REMCONVERSION / REMBONUS) found in database.");
      }
      return;
    }

    if (parsedProfiles.length === 0) {
      toast.info("No shareholder profiles loaded. Please upload an Excel workbook first.");
      return;
    }
    const baseSet = parsedProfiles;
    const res = AgmStudioService.disperseBulkConversionAndBonusPools(baseSet);
    if (res.dispersedPoolsCount > 0) {
      setParsedProfiles(res.expandedProfiles);
      toast.success(
        `✨ Decomposed ${res.dispersedPoolsCount} bulk conversion/bonus pool(s) into ${res.createdFoliosCount} individual physical folios! Distributed ${res.totalKittaDistributed.toLocaleString()} kitta & NPR ${res.totalCashDistributed.toLocaleString()} cash.`,
        { duration: 6000 },
      );
    } else {
      toast.info(
        "No bulk placeholder pools (REMCONVERSION / REMBONUS) found in current active profiles.",
      );
    }
  };

  const remPoolData = useMemo(() => {
    const activeList = parsedProfiles.length > 0 ? parsedProfiles : dbProfiles;
    const remConvProfile = activeList.find(
      (p) =>
        p.boid.toUpperCase() === "REMCONVERSION" ||
        p.shareholderName.toUpperCase().includes("REM CONVERSION"),
    );
    const remBonusProfile = activeList.find(
      (p) =>
        p.boid.toUpperCase() === "REMBONUSFY20767778" ||
        p.shareholderName.toUpperCase().includes("REMAINING BONUS") ||
        p.boid.toUpperCase() === "REMBONUS",
    );

    const isNlg = activeCompanyId === "nlg-insurance" || activeCompany?.code === "NLG";
    const remConvKitta = remConvProfile ? remConvProfile.currentKitta2081 : isNlg ? 355086 : 0;
    const remConvCash = remConvProfile
      ? remConvProfile.totalCashDividendReceived
      : isNlg
        ? 1537721.05
        : 0;
    const remBonusKitta = remBonusProfile ? remBonusProfile.currentKitta2081 : isNlg ? 197260 : 0;

    return {
      remConvKitta,
      remConvCash,
      remBonusKitta,
    };
  }, [parsedProfiles, dbProfiles, activeCompanyId, activeCompany]);

  const decompositionSchedule = useMemo(() => {
    const folios = AgmStudioService.getStandardPhysicalPromoterFolios();
    const totalBase = folios.reduce((s, f) => s + f.baseKitta, 0) || 1;
    const { remConvKitta, remConvCash } = remPoolData;

    return folios.map((f) => {
      const weight = f.baseKitta / totalBase;
      const fromConvKitta = Math.floor(remConvKitta * weight);
      const totalCash = Math.round(remConvCash * weight * 100) / 100;
      const tax = Math.round(totalCash * 0.05 * 100) / 100;
      const netCash = Math.round((totalCash - tax) * 100) / 100;

      return {
        folioNo: `FOLIO-${f.folioNo}`,
        holderName: f.holderName,
        fatherName: f.fatherName || "—",
        address: f.address || "Kathmandu",
        baseKitta: f.baseKitta,
        fromRemConversion: fromConvKitta,
        fromRemBonus: 0,
        totalClosingKitta: fromConvKitta,
        grossCash: totalCash,
        netCash: netCash,
      };
    });
  }, [remPoolData]);

  const handleExportDecompositionSchedule = () =>
    exportDecompositionScheduleWorkbook({
      ...getExportContext(),
      remPoolData,
      decompositionSchedule,
    });

  const handlePromoteToDatabase = async () => {
    let listToPromote = parsedProfiles;
    if (dataSourceMode === "DATABASE" || listToPromote.length === 0) {
      const toastId = toast.loading("Querying all verified database records for promotion...");
      listToPromote = await AgmStudioService.fetchAllShareholdersFromDatabase((fetched, total) => {
        toast.loading(
          `Querying database: ${fetched.toLocaleString()} / ${total.toLocaleString()}...`,
          { id: toastId },
        );
      }, activeCompanyId);
      toast.dismiss(toastId);
    }

    if (listToPromote.length === 0) {
      toast.error(
        "No verified shareholder records found to promote. Please import or load historical records first.",
      );
      return;
    }

    // Segregate statutory escrow pools (REMCONVERSION, REMBONUS, REMPOOL, Unmatched) from individual client promotion
    const validClientProfiles = listToPromote.filter((p) => {
      const uboid = p.boid.toUpperCase();
      const uname = p.shareholderName.toUpperCase();
      if (p.holderType === "CLEARING_POOL") return false;
      if (
        uboid.includes("REMCONVERSION") ||
        uboid.includes("REMBONUS") ||
        uboid.includes("REMPOOL") ||
        uboid.startsWith("FOLIO32373") ||
        uboid.startsWith("FOLIO4168")
      )
        return false;
      if (uname.includes("UNMATCHED") || uname.includes("ESCROW")) return false;
      return true;
    });

    const escrowCount = listToPromote.length - validClientProfiles.length;

    const confirm = window.confirm(
      `🚀 Production Sync Confirmation:\n\nYou are about to promote ${validClientProfiles.length.toLocaleString()} verified individual shareholder records of "${activeCompany.name}" (${activeCompany.code}) into RTARTS Live Production Database.\n\n` +
        (escrowCount > 0
          ? `🛡️ Note: ${escrowCount} statutory escrow & pool account(s) (REMCONVERSION, REMBONUS, REMPOOL, Unmatched) are safely preserved in the Escrow / Pool Ledger and excluded from client accounts.\n\n`
          : "") +
        `This will:\n1. Seed/Update records in "clients" table (with BOID, KYC, and current kitta).\n2. Create corresponding fraction payables in "dividend_payables" table.\n3. Log an immutable audit entry.\n\nDo you wish to proceed?`,
    );
    if (!confirm) return;

    setIsPromoting(true);
    const toastId = toast.loading(
      `Promoting ${validClientProfiles.length.toLocaleString()} records to live RTARTS production tables...`,
    );
    try {
      const res = await AgmStudioService.promoteHistoricalDataToDatabase(
        validClientProfiles,
        activeCompanyId,
        activeCompany.code || "NLG",
        activeCompany.name,
        (promoted, total, pct) => {
          toast.loading(
            pct >= 100
              ? `✅ Finalizing promotion of ${total.toLocaleString()} records...`
              : `Promoting to production: ${promoted.toLocaleString()} / ${total.toLocaleString()} (${pct}%)...`,
            { id: toastId },
          );
        },
      );

      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["dividend_payables"] });
      qc.invalidateQueries({ queryKey: ["live-payable-summary"] });
      toast.dismiss(toastId);

      if (res.failedChunks && res.failedChunks.length > 0) {
        if (!navigator.onLine) {
          toast.warning(
            `Network offline. ${res.failedChunks.length} batches securely queued in browser and will sync automatically when online.`,
            { duration: 8000 },
          );
          localStorage.setItem("pending_agm_promotions", JSON.stringify(res.failedChunks));
        } else {
          toast.warning(
            `Promoted ${res.promotedCount.toLocaleString()} records, but ${res.failedChunks.length} chunks failed. Please check network and retry.`,
            { duration: 8000 },
          );
        }
      } else {
        toast.success(
          `🎉 Successfully Promoted! Seeded ${res.promotedCount.toLocaleString()} client records & created ${res.fractionPayablesCreated.toLocaleString()} fraction dividend payables.`,
          { duration: 6000 },
        );
      }
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(err?.message || "Failed to promote historical data to production database.");
    } finally {
      setIsPromoting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-1">
        <PageHeader
          title="AGM Historical Studio & Multi-FY Reconciliation Hub"
          description={`Statutory corporate action reconciliation & multi-year historical ledger for ${activeCompany.name} (${activeCompany.code}). Ingest Excel workbooks, audit fraction roll-forwards, manage broker pools, and persist verified ledgers.`}
        />
        <div className="flex items-center gap-2">
          <Select value={activeCompanyId} onValueChange={handleSelectCompany}>
            <SelectTrigger className="h-9 w-[220px] text-xs font-semibold bg-background">
              <Building2 className="h-3.5 w-3.5 text-primary mr-1.5 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            className="h-9 text-xs gap-1.5"
            onClick={() => setIsCompanyModalOpen(true)}
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            <span>+ New Company</span>
          </Button>
        </div>
      </div>

      {/* Hidden File Input for Wizard */}
      <input
        type="file"
        multiple
        ref={wizardFileInputRef}
        onChange={handleWizardFileSelect}
        accept=".xlsx,.xls"
        className="hidden"
      />

      {/* Hidden File Input for Conversion */}
      <input
        type="file"
        multiple
        ref={conversionFileInputRef}
        onChange={handleConversionFileSelect}
        accept=".xlsx,.xls"
        className="hidden"
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
        <TabsList className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 w-full mb-6">
          <TabsTrigger value="wizard" className="gap-1 font-medium text-xs">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            <span>1. Import Wizard</span>
          </TabsTrigger>
          <TabsTrigger value="ledger" className="gap-1 font-medium text-xs">
            <FolderSync className="h-3.5 w-3.5 text-indigo-500" />
            <span>2. FY Ledger ({fyLedger.length})</span>
          </TabsTrigger>
          <TabsTrigger value="sandbox" className="gap-1 font-medium text-xs">
            <Search className="h-3.5 w-3.5 text-cyan-500" />
            <span>3. Registry & Search</span>
          </TabsTrigger>
          <TabsTrigger value="radar" className="gap-1 font-medium text-xs">
            <Zap className="h-3.5 w-3.5 text-rose-500" />
            <span>4. Math & Audit</span>
          </TabsTrigger>
          <TabsTrigger value="conversion" className="gap-1 font-medium text-xs">
            <RefreshCw className="h-3.5 w-3.5 text-purple-500" />
            <span>5. CA 6316 Split ({conversionRecords.length})</span>
          </TabsTrigger>
          <TabsTrigger value="broker-pools" className="gap-1 font-medium text-xs">
            <Building2 className="h-3.5 w-3.5 text-amber-600" />
            <span>6. Broker Pools ({pools.length})</span>
          </TabsTrigger>
          <TabsTrigger value="drn" className="gap-1 font-medium text-xs">
            <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" />
            <span>7. Physical DRN ({drnList.length})</span>
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-1 font-medium text-xs">
            <Edit className="h-3.5 w-3.5 text-blue-500" />
            <span>8. Company & CA</span>
          </TabsTrigger>
          <TabsTrigger value="promote" className="gap-1 font-medium text-xs">
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500" />
            <span>9. Reports & Exports</span>
          </TabsTrigger>
        </TabsList>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 1: 3-STEP GUIDED IMPORT WIZARD                           */}
        {/* ───────────────────────────────────────────────────────────── */}
        <AgmWizardAndLedgerTabs
          wizardStep={wizardStep}
          onChangeWizardStep={setWizardStep}
          wizardTargetFy={wizardTargetFy}
          onChangeWizardTargetFy={setWizardTargetFy}
          fyLedger={fyLedger}
          timeline={timeline}
          onToggleLock={handleToggleLock}
          wizardFileInputRef={wizardFileInputRef}
          isDragOver={isDragOver}
          onChangeDragOver={setIsDragOver}
          onDropWorkbooks={processUploadedWorkbooks}
          isParsingFile={isParsingFile}
          importReport={importReport}
          allowVarianceOverride={allowVarianceOverride}
          onChangeAllowVarianceOverride={setAllowVarianceOverride}
          isSavingBatch={isSavingBatch}
          onSaveWizardBatch={handleSaveWizardBatch}
          onExportConversionReport={handleExportConversionReport}
          parsedProfiles={parsedProfiles}
          onChangeActiveTab={setActiveTab}
          onRefreshLedger={loadLedger}
        />

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 3: SHAREHOLDER SEARCH & 360° JOURNEY                     */}
        {/* ───────────────────────────────────────────────────────────── */}
        <AgmSandboxAndRadarTabs
          stats={stats}
          dataSourceMode={dataSourceMode}
          onChangeDataSourceMode={setDataSourceMode}
          isLoadingDb={isLoadingDb}
          loadDbShareholders={loadDbShareholders}
          parsedProfiles={parsedProfiles}
          activeProfiles={activeProfiles}
          paginatedProfiles={paginatedProfiles}
          pageSize={pageSize}
          onChangePageSize={setPageSize}
          currentPage={currentPage}
          onChangeCurrentPage={setCurrentPage}
          totalPages={totalPages}
          totalRecordCount={totalRecordCount}
          searchQuery={searchQuery}
          onChangeSearchQuery={setSearchQuery}
          typeFilter={typeFilter}
          onChangeTypeFilter={setTypeFilter}
          agmFyFilter={agmFyFilter}
          onChangeAgmFyFilter={setAgmFyFilter}
          onlyPresentInFy={onlyPresentInFy}
          onToggleOnlyPresentInFy={() => setOnlyPresentInFy((v) => !v)}
          dbError={dbError}
          onClearDbError={() => setDbError(null)}
          isRecalculatingAll={isRecalculatingAll}
          onRecalculateAll={handleRecalculateAllProfiles}
          onExportRegistry={handleExportRegistry}
          onApplyFilter={handleApplyFilter}
          onDownloadAgmSpecific={handleDownloadAgmSpecific}
          onOpenEditProfile={(p) => {
            setEditingProfile(p);
            setEditKittaInput(String(p.initialKitta2075));
            setEditFractionInput(String(p.initialFraction2075 || 0));
            setEditHolderTypeInput(p.holderType);
            setIsEditModalOpen(true);
          }}
          onSelectProfile={setSelectedProfile}
          onApplyStatutoryCorrections={handleApplyStatutoryCorrections}
          onExportDiscrepancyReport={handleExportDiscrepancyReport}
        />

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 5: CA 6316 PROMOTER CONVERSION & SPLIT HUB                */}
        {/* ───────────────────────────────────────────────────────────── */}
        <AgmConversionPoolsDrnTabs
          conversionFileInputRef={conversionFileInputRef}
          conversionRecords={conversionRecords}
          onSetConversionRecords={setConversionRecords}
          conversionSummary={conversionSummary}
          isParsingConversion={isParsingConversion}
          isSavingConversion={isSavingConversion}
          onSaveConversionToDb={handleSaveConversionToDb}
          onExportConversionLedger={handleExportConversionLedger}
          convSearch={convSearch}
          onChangeConvSearch={setConvSearch}
          convStatusFilter={convStatusFilter}
          onChangeConvStatusFilter={setConvStatusFilter}
          convPage={convPage}
          onChangeConvPage={setConvPage}
          convPageSize={convPageSize}
          filteredConversionRecords={filteredConversionRecords}
          paginatedConversionRecords={paginatedConversionRecords}
          totalConvPages={totalConvPages}
          pools={pools}
          claims={claims}
          onOpenClaimModal={(pool) => {
            setSelectedPool(pool);
            setIsClaimModalOpen(true);
          }}
          drnSearch={drnSearch}
          onChangeDrnSearch={setDrnSearch}
          drnStatusFilter={drnStatusFilter}
          onChangeDrnStatusFilter={setDrnStatusFilter}
          drnPage={drnPage}
          onChangeDrnPage={setDrnPage}
          drnPageSize={drnPageSize}
          filteredDrnList={filteredDrnList}
          paginatedDrnList={paginatedDrnList}
          totalDrnPages={totalDrnPages}
          onOpenDecompositionModal={() => setIsDecompositionModalOpen(true)}
          onDisperseBulkPools={handleDisperseBulkPools}
          onAutoMatchDrn={handleAutoMatchDrn}
          onOpenDrnModal={(r) => {
            setSelectedDrn(r);
            setTargetBoidInput(r.targetBoid || "");
            setDrnNoInput(r.drnNo || "");
            setDrnStatusInput(r.status);
            setIsDrnModalOpen(true);
          }}
        />

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 7: COMPANY & CORPORATE ACTION RULES CONFIGURATOR         */}
        {/* ───────────────────────────────────────────────────────────── */}
        <AgmConfigAndPromoteTabs
          activeCompany={activeCompany}
          timeline={timeline}
          isRecalculatingAll={isRecalculatingAll}
          onRecalculateAll={handleRecalculateAllProfiles}
          onOpenCompanyModal={() => setIsCompanyModalOpen(true)}
          onOpenAddFyModal={() => {
            const lastFy = timeline[timeline.length - 1]?.fiscalYear || "2080/81";
            const match = lastFy.match(/^(\d{4})\/(\d{2})$/);
            let nextFy = "2081/82";
            if (match) {
              const startYr = parseInt(match[1], 10) + 1;
              const endYr = (parseInt(match[2], 10) + 1) % 100;
              nextFy = `${startYr}/${String(endYr).padStart(2, "0")}`;
            }
            setFyFormYear(nextFy);
            setFyFormEventName("");
            setFyFormEventType("BONUS_AND_CASH");
            setFyFormBonusPct("5.0");
            setFyFormCashPct("0.26315");
            setFyFormRightPct("0");
            setFyFormConvPct("0");
            setFyFormBookClose("2082-01-15");
            setFyFormNotes("");
            setIsAddFyModalOpen(true);
          }}
          onEditFyEvent={(fy) => {
            setEditingFy(fy);
            setFyFormYear(fy.fiscalYear);
            setFyFormEventName(fy.eventName);
            setFyFormEventType(fy.eventType);
            setFyFormBonusPct(String(fy.bonusRatioPct));
            setFyFormCashPct(String(fy.cashDividendRatioPct));
            setFyFormRightPct(String(fy.rightRatioPct));
            setFyFormConvPct(String(fy.conversionRatioPct));
            setFyFormBookClose(fy.bookCloseDateBs);
            setFyFormNotes(fy.notes);
            setIsAddFyModalOpen(true);
          }}
          onDeleteFyEvent={handleDeleteFyEvent}
          dataSourceMode={dataSourceMode}
          dbSummaryStats={dbSummaryStats}
          dbTotalCount={dbTotalCount}
          stats={stats}
          parsedProfiles={parsedProfiles}
          conversionSummary={conversionSummary}
          conversionRecords={conversionRecords}
          drnList={drnList}
          selectedCdscFy={selectedCdscFy}
          onChangeSelectedCdscFy={setSelectedCdscFy}
          selectedAgmCardFy={selectedAgmCardFy}
          onChangeSelectedAgmCardFy={setSelectedAgmCardFy}
          isPromoting={isPromoting}
          isAuthorizedToPromote={isAuthorizedToPromote}
          onDownloadExcel={handleDownloadExcel}
          onDownloadChronologicalLedger={handleDownloadChronologicalLedger}
          onDownloadCdscTxt={handleDownloadCdscTxt}
          onDownloadMutualFundsExcel={handleDownloadMutualFundsExcel}
          onDownloadDrnExcel={handleDownloadDrnExcel}
          onExportConversionReport={handleExportConversionReport}
          onDownloadFySummaryExcel={handleDownloadFySummaryExcel}
          onDownloadAgmSpecific={handleDownloadAgmSpecific}
          onPromoteToDatabase={handlePromoteToDatabase}
        />
      </Tabs>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* DIALOG: ADD NEW COMPANY PROFILE                               */}
      {/* ───────────────────────────────────────────────────────────── */}
      <AgmStudioModals
        activeCompany={activeCompany}
        timeline={timeline}
        isCompanyModalOpen={isCompanyModalOpen}
        onChangeCompanyModalOpen={setIsCompanyModalOpen}
        newCompCode={newCompCode}
        onChangeNewCompCode={setNewCompCode}
        newCompName={newCompName}
        onChangeNewCompName={setNewCompName}
        newCompIsinPo={newCompIsinPo}
        onChangeNewCompIsinPo={setNewCompIsinPo}
        newCompIsinPub={newCompIsinPub}
        onChangeNewCompIsinPub={setNewCompIsinPub}
        newCompBaseFy={newCompBaseFy}
        onChangeNewCompBaseFy={setNewCompBaseFy}
        onCreateCompany={handleCreateCompany}
        isAddFyModalOpen={isAddFyModalOpen}
        onChangeAddFyModalOpen={setIsAddFyModalOpen}
        editingFy={editingFy}
        fyFormYear={fyFormYear}
        onChangeFyFormYear={setFyFormYear}
        fyFormEventName={fyFormEventName}
        onChangeFyFormEventName={setFyFormEventName}
        fyFormEventType={fyFormEventType}
        onChangeFyFormEventType={setFyFormEventType}
        fyFormBonusPct={fyFormBonusPct}
        onChangeFyFormBonusPct={setFyFormBonusPct}
        fyFormCashPct={fyFormCashPct}
        onChangeFyFormCashPct={setFyFormCashPct}
        fyFormRightPct={fyFormRightPct}
        onChangeFyFormRightPct={setFyFormRightPct}
        fyFormConvPct={fyFormConvPct}
        onChangeFyFormConvPct={setFyFormConvPct}
        fyFormBookClose={fyFormBookClose}
        onChangeFyFormBookClose={setFyFormBookClose}
        fyFormNotes={fyFormNotes}
        onChangeFyFormNotes={setFyFormNotes}
        onSaveFyEvent={handleSaveFyEvent}
        selectedDrn={selectedDrn}
        isDrnModalOpen={isDrnModalOpen}
        onChangeDrnModalOpen={setIsDrnModalOpen}
        targetBoidInput={targetBoidInput}
        onChangeTargetBoidInput={setTargetBoidInput}
        drnNoInput={drnNoInput}
        onChangeDrnNoInput={setDrnNoInput}
        drnStatusInput={drnStatusInput}
        onChangeDrnStatusInput={setDrnStatusInput}
        onSaveDrnMapping={handleSaveDrnMapping}
        selectedPool={selectedPool}
        isClaimModalOpen={isClaimModalOpen}
        onChangeClaimModalOpen={setIsClaimModalOpen}
        claimantBoid={claimantBoid}
        onChangeClaimantBoid={setClaimantBoid}
        claimantName={claimantName}
        onChangeClaimantName={setClaimantName}
        claimedKitta={claimedKitta}
        onChangeClaimedKitta={setClaimedKitta}
        tradeDate={tradeDate}
        onChangeTradeDate={setTradeDate}
        contractNote={contractNote}
        onChangeContractNote={setContractNote}
        onProcessClaim={handleProcessClaim}
        isDecompositionModalOpen={isDecompositionModalOpen}
        onChangeDecompositionModalOpen={setIsDecompositionModalOpen}
        remPoolData={remPoolData}
        decompositionSchedule={decompositionSchedule}
        onExportDecompositionSchedule={handleExportDecompositionSchedule}
        onDisperseBulkPools={handleDisperseBulkPools}
        selectedProfile={selectedProfile}
        onClearSelectedProfile={() => setSelectedProfile(null)}
        onExportShareholderJourney={handleExportShareholderJourney}
        editingProfile={editingProfile}
        isEditModalOpen={isEditModalOpen}
        onCloseEditModal={() => {
          setIsEditModalOpen(false);
          setEditingProfile(null);
        }}
        editKittaInput={editKittaInput}
        onChangeEditKittaInput={setEditKittaInput}
        editFractionInput={editFractionInput}
        onChangeEditFractionInput={setEditFractionInput}
        editHolderTypeInput={editHolderTypeInput}
        onChangeEditHolderTypeInput={setEditHolderTypeInput}
        isSavingEdit={isSavingEdit}
        onSaveSingleEdit={handleSaveSingleEdit}
      />
    </div>
  );
}
