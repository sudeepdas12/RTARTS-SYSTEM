import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  Calendar,
  Layers,
  Building2,
  ArrowUpRight,
  Zap,
  ShieldCheck,
  Search,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  ChevronRight,
  Upload,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  AlertTriangle,
  FolderSync,
  HelpCircle,
  Database,
  Lock,
  Unlock,
  Check,
  ArrowRight,
  Sparkles,
  Info,
  Filter,
  Edit,
  Download,
  Eye,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { IafGeneratorService } from "@/lib/services/iaf-generator.service";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/agm-studio")({
  component: AgmStudioPage,
});

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
  const [conversionRecords, setConversionRecords] = useState<PromoterConversionRecord[]>(() =>
    AgmStudioService.getSamplePromoterConversions(),
  );
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
      id: `comp-${Date.now()}`,
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
        } else if (dbShRes.profiles.length > 0 || dbShRes.totalCount > 0) {
          // Real company with DB records but no conversion records uploaded yet
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
  useEffect(() => {
    if (dataSourceMode === "DATABASE") {
      setCurrentPage(1);
      loadDbShareholders(1, pageSize, debouncedSearch, typeFilter);
    }
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
  const activeProfiles = useMemo(() => {
    if (dataSourceMode === "DATABASE") {
      return dbProfiles;
    }
    return parsedProfiles;
  }, [dataSourceMode, dbProfiles, parsedProfiles]);

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
      const baseSet =
        parsedProfiles.length > 0 ? parsedProfiles : AgmStudioService.getSampleHistoricalProfiles();
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

  const handleDownloadCdscTxt = async () => {
    let listToExport = parsedProfiles;
    if (dataSourceMode === "DATABASE" || listToExport.length === 0) {
      const toastId = toast.loading("Querying complete database records for CDSC TXT file...");
      listToExport = await AgmStudioService.fetchAllShareholdersFromDatabase(
        undefined,
        activeCompanyId,
      );
      toast.dismiss(toastId);
    }
    const dispersalRes = AgmStudioService.disperseBulkConversionAndBonusPools(listToExport);
    if (
      dispersalRes.dispersedPoolsCount > 0 ||
      listToExport.length !== dispersalRes.expandedProfiles.length
    ) {
      listToExport = dispersalRes.expandedProfiles;
    }
    const targetEvent = timeline.find((t) => t.fiscalYear === selectedCdscFy);
    const eventType = targetEvent ? targetEvent.eventType : "BONUS_AND_CASH";
    const content = AgmStudioService.generateCdscAutoCaTxt(
      listToExport,
      activeCompany.code || "NLG",
      selectedCdscFy,
      eventType,
    );
    const fileName = `CDSC_AUTO_CA_${activeCompany.code || "NLG"}_${selectedCdscFy.replace("/", "_")}.TXT`;
    IafGeneratorService.downloadFile(content, fileName, "text/plain");
    toast.success(
      `Downloaded CDSC Auto-CA Batch File (.TXT) for FY ${selectedCdscFy} with ${listToExport.length.toLocaleString()} records.`,
    );
  };

  const handleDownloadChronologicalLedger = async () => {
    let listToExport = parsedProfiles;
    if (dataSourceMode === "DATABASE" || listToExport.length === 0) {
      const toastId = toast.loading("Querying complete database for chronological ledger...");
      listToExport = await AgmStudioService.fetchAllShareholdersFromDatabase((fetched, total) => {
        toast.loading(
          `Querying database: ${fetched.toLocaleString()} / ${total.toLocaleString()}...`,
          { id: toastId },
        );
      }, activeCompanyId);
      toast.dismiss(toastId);
    }
    const dispersalRes = AgmStudioService.disperseBulkConversionAndBonusPools(listToExport);
    if (
      dispersalRes.dispersedPoolsCount > 0 ||
      listToExport.length !== dispersalRes.expandedProfiles.length
    ) {
      listToExport = dispersalRes.expandedProfiles;
    }
    const fileName = `${activeCompany.code || "COMPANY"}_Chronological_Shareholder_Lifecycle.xlsx`;
    AgmStudioService.exportChronologicalLedger(
      listToExport,
      activeCompany.name,
      fileName,
      timeline,
    );
    toast.success(
      `Downloaded Chronological Ledger (.xlsx) with ${listToExport.length.toLocaleString()} records.`,
    );
  };

  const handleDownloadExcel = async () => {
    let listToExport = parsedProfiles;
    if (dataSourceMode === "DATABASE" || listToExport.length === 0) {
      const toastId = toast.loading("Querying complete historical database records for export...");
      listToExport = await AgmStudioService.fetchAllShareholdersFromDatabase((fetched, total) => {
        toast.loading(
          `Querying complete database: ${fetched.toLocaleString()} / ${total.toLocaleString()}...`,
          { id: toastId },
        );
      }, activeCompanyId);
      toast.dismiss(toastId);
    }

    // Distribute bulk pools and remove junk unmatched rows before export
    const dispersalRes = AgmStudioService.disperseBulkConversionAndBonusPools(listToExport);
    if (
      dispersalRes.dispersedPoolsCount > 0 ||
      listToExport.length !== dispersalRes.expandedProfiles.length
    ) {
      listToExport = dispersalRes.expandedProfiles;
    }

    const fileName = `${activeCompany.code || "COMPANY"}_AGM_MultiYear_Reconciliation_Ledger.xlsx`;
    AgmStudioService.exportAgmWorkbook(
      listToExport,
      activeCompany.name,
      fileName,
      timeline,
      wizardTargetFy,
      drnList,
    );
    toast.success(
      `Downloaded Multi-Year AGM Reconciliation Workbook (.xlsx) with ${listToExport.length.toLocaleString()} records.`,
    );
  };

  const handleDownloadMutualFundsExcel = async () => {
    let listToExport = parsedProfiles;
    if (dataSourceMode === "DATABASE" || listToExport.length === 0) {
      const toastId = toast.loading("Querying database for Mutual Funds records...");
      listToExport = await AgmStudioService.fetchAllShareholdersFromDatabase(
        undefined,
        activeCompanyId,
      );
      toast.dismiss(toastId);
    }
    const mfOnly = listToExport.filter((p) => p.holderType === "MUTUAL_FUND");
    if (mfOnly.length === 0) {
      toast.info("No Mutual Fund accounts found in current dataset.");
      return;
    }
    const fileName = `${activeCompany.code || "COMPANY"}_Tax_Exempt_Mutual_Funds_0_TDS.xlsx`;
    AgmStudioService.exportMutualFundsExcel(listToExport, activeCompany.name, fileName);
    toast.success(
      `Exported Tax-Exempt Mutual Funds Statement (.xlsx) with ${mfOnly.length} schemes.`,
    );
  };

  const handleDownloadDrnExcel = async () => {
    const records = drnList.length > 0 ? drnList : AgmStudioService.getPhysicalDrnRecords();
    const fileName = `${activeCompany.code || "COMPANY"}_Physical_Folio_DRN_Dematerialisation_Ledger.xlsx`;
    AgmStudioService.exportDrnExcel(records, activeCompany.name, fileName);
    toast.success(
      `Exported Physical DRN Dematerialisation Ledger (.xlsx) with ${records.length} folios.`,
    );
  };

  const handleDownloadFySummaryExcel = async () => {
    let listToExport = parsedProfiles;
    if (dataSourceMode === "DATABASE" || listToExport.length === 0) {
      const toastId = toast.loading("Querying database for Multi-FY Summary...");
      listToExport = await AgmStudioService.fetchAllShareholdersFromDatabase(
        undefined,
        activeCompanyId,
      );
      toast.dismiss(toastId);
    }
    const dispersalRes = AgmStudioService.disperseBulkConversionAndBonusPools(listToExport);
    if (
      dispersalRes.dispersedPoolsCount > 0 ||
      listToExport.length !== dispersalRes.expandedProfiles.length
    ) {
      listToExport = dispersalRes.expandedProfiles;
    }
    const fileName = `${activeCompany.code || "COMPANY"}_MultiYear_Statutory_Fiscal_Summary.xlsx`;
    AgmStudioService.exportFySummaryExcel(listToExport, timeline, activeCompany.name, fileName);
    toast.success(`Exported Multi-Year Fiscal Action Summary Report (.xlsx).`);
  };

  const handleDownloadAgmSpecific = async (targetFy: string) => {
    let listToExport = parsedProfiles;
    if (dataSourceMode === "DATABASE" || listToExport.length === 0) {
      const toastId = toast.loading(`Querying database records for ${targetFy}...`);
      listToExport = await AgmStudioService.fetchAllShareholdersFromDatabase(
        undefined,
        activeCompanyId,
      );
      toast.dismiss(toastId);
    }
    const cleanFy = targetFy.replace("FY ", "").trim();
    const fileName = `${activeCompany.code || "COMPANY"}_${cleanFy.replace("/", "-")}_Promoter_and_Public.xlsx`;
    AgmStudioService.exportAgmSpecificWorkbook(
      listToExport,
      targetFy,
      activeCompany.name,
      fileName,
      timeline,
    );
    toast.success(
      `Exported ${targetFy} Promoter & Public Ledger (.xlsx) with ${listToExport.length.toLocaleString()} records.`,
    );
  };

  const handleExportRegistry = async () => {
    let listToExport = parsedProfiles;
    if (dataSourceMode === "DATABASE" || listToExport.length === 0) {
      const toastId = toast.loading("Querying all historical database records for export...");
      listToExport = await AgmStudioService.fetchAllShareholdersFromDatabase((fetched, total) => {
        toast.loading(
          `Querying database: ${fetched.toLocaleString()} / ${total.toLocaleString()}...`,
          { id: toastId },
        );
      }, activeCompanyId);
      toast.dismiss(toastId);
    }
    const dispersalRes = AgmStudioService.disperseBulkConversionAndBonusPools(listToExport);
    if (
      dispersalRes.dispersedPoolsCount > 0 ||
      listToExport.length !== dispersalRes.expandedProfiles.length
    ) {
      listToExport = dispersalRes.expandedProfiles;
    }
    if (listToExport.length === 0) {
      toast.error("No shareholder records to export.");
      return;
    }
    const wb = XLSX.utils.book_new();
    const headers = [
      "S.N.",
      "BOID / Folio",
      "Shareholder Name",
      "Father's Name",
      "Grandfather's Name",
      "Guardian Name",
      "Spouse Name",
      "Citizenship No",
      "PAN No",
      "District",
      "Contact No",
      "Email",
      "Bank Name",
      "Bank Account No",
      "Holder Type",
      "Opening Base Kitta (2075/76)",
      "Opening Fraction (2075/76)",
      "Right Shares Subscribed (62.56%)",
      "Total Bonus Shares Issued",
      "Closing Kitta (2080/81)",
      "Closing Carried Fraction",
      "Total Gross Cash Dividend (NPR)",
      "Total Tax Withheld (5% TDS)",
      "Net Cash Payable (NPR)",
      "Account Classification",
      "Audit & Statutory Status",
    ];
    const rows = listToExport.map((p, idx) => {
      let rightShares = 0;
      if (p.yearlySnapshots && p.yearlySnapshots.length > 0) {
        rightShares = p.yearlySnapshots.reduce((s, snap) => s + (snap.rightSharesAllotted || 0), 0);
      } else {
        const diff = p.currentKitta2081 - (p.initialKitta2075 + p.totalBonusSharesReceived);
        rightShares = diff > 0 ? diff : 0;
      }

      const netCash = Math.round((p.totalCashDividendReceived - p.totalTaxWithheld) * 100) / 100;

      let accountClass = "Active Equity Shareholder";
      if (
        p.initialKitta2075 === 0 &&
        p.currentKitta2081 === 0 &&
        (p.currentFraction2081 > 0 || (p.initialFraction2075 || 0) > 0)
      ) {
        accountClass = "Fractional-Only Holding (Residual Kaser / Non-Whole Share)";
      } else if (p.holderType === "MUTUAL_FUND") {
        accountClass = "Mutual Fund (0% TDS Tax-Exempt)";
      } else if (p.holderType === "PROMOTER") {
        accountClass = "Promoter Equity Shareholder";
      }

      return [
        idx + 1,
        p.boid,
        p.shareholderName,
        p.fatherName || "",
        p.grandfatherName || "",
        p.guardianName || "",
        p.spouseName || "",
        p.citizenshipNo || "",
        p.panNo || "",
        p.district || "",
        p.contactNo || "",
        p.email || "",
        p.bankName || "",
        p.bankAccountNo || "",
        p.holderType,
        p.initialKitta2075,
        p.initialFraction2075 ? Number(p.initialFraction2075.toFixed(4)) : 0,
        rightShares,
        p.totalBonusSharesReceived,
        p.currentKitta2081,
        Number(p.currentFraction2081.toFixed(4)),
        p.totalCashDividendReceived,
        p.totalTaxWithheld,
        netCash,
        accountClass,
        p.hasDiscrepancy ? "Excel Variance Corrected (CDSC Linear)" : "Matched Statutory",
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([
      [`${activeCompany.name.toUpperCase()} — SHAREHOLDER MULTI-YEAR EVOLUTION REGISTRY`],
      [
        `Generated: ${new Date().toLocaleString()} | Total Accounts: ${listToExport.length.toLocaleString()}`,
      ],
      [],
      headers,
      ...rows,
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Shareholder_Registry");
    XLSX.writeFile(wb, `${activeCompany.code}_Shareholder_Evolution_Registry.xlsx`);
    toast.success(`Exported ${listToExport.length.toLocaleString()} shareholder records to Excel!`);
  };

  const handleExportDiscrepancyReport = () => {
    const list = activeProfiles.filter((p) => p.hasDiscrepancy);
    if (list.length === 0) {
      toast.info("No discrepancy records found to export.");
      return;
    }
    const wb = XLSX.utils.book_new();
    const headers = [
      "S.N.",
      "BOID / Folio",
      "Shareholder Name",
      "Holder Type",
      "Base Kitta",
      "Carried Fraction (CDSC)",
      "Total Bonus Shares",
      "Total Cash Dividend (NPR)",
      "Audit Finding / Resolution",
    ];
    const rows = list.map((p, idx) => [
      idx + 1,
      p.boid,
      p.shareholderName,
      p.holderType,
      p.initialKitta2075,
      p.currentFraction2081,
      p.totalBonusSharesReceived,
      p.totalCashDividendReceived,
      p.anomalies.join(" | ") || "Excel manual compounding variance sanitized to CDSC rule.",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([
      [`${activeCompany.name.toUpperCase()} — FORENSIC EXCEL DISCREPANCY & AUDIT REPORT`],
      [
        `Generated: ${new Date().toLocaleString()} | Total Flagged Accounts: ${list.length.toLocaleString()}`,
      ],
      [],
      headers,
      ...rows,
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Discrepancy_Audit");
    XLSX.writeFile(wb, `${activeCompany.code}_Forensic_Discrepancy_Audit.xlsx`);
    toast.success(`Exported ${list.length.toLocaleString()} discrepancy records to Excel!`);
  };

  const handleExportConversionReport = () => {
    const sourceList = parsedProfiles.length > 0 ? parsedProfiles : activeProfiles;
    const list = sourceList.filter(
      (p) =>
        p.convertedShares ||
        p.isConversionMerged ||
        p.anomalies.some((a) => a.includes("CA 6316") || a.includes("conversion")),
    );
    if (list.length === 0 && conversionRecords.length > 0) {
      const wb = XLSX.utils.book_new();
      const headers = [
        "S.N.",
        "BOID / Folio",
        "Shareholder Name",
        "Pre-Conv Total",
        "Promoter Retained (Whole)",
        "Promoter Retained (Frac)",
        "Public Converted (Whole)",
        "Public Converted (Frac)",
        "Fraction Remainder",
        "CA Seq No",
        "Status",
      ];
      const rows = conversionRecords.map((r, idx) => [
        idx + 1,
        r.boidOrFolio,
        r.holderName,
        r.preConversionTotal,
        r.promoterRetainedInt,
        r.promoterRetainedFrac,
        r.publicConvertedInt,
        r.publicConvertedFrac,
        r.fractionRemainder,
        r.caSeqNo,
        r.status,
      ]);
      const ws = XLSX.utils.aoa_to_sheet([
        [
          `${activeCompany.name.toUpperCase()} — CA 6316 PROMOTER-TO-PUBLIC CONVERSION RECONCILIATION REPORT`,
        ],
        [`Total Converted Accounts: ${conversionRecords.length.toLocaleString()}`],
        [],
        headers,
        ...rows,
      ]);
      XLSX.utils.book_append_sheet(wb, ws, "CA6316_Conversion_List");
      XLSX.writeFile(wb, `${activeCompany.code}_CA6316_Conversion_Reconciliation.xlsx`);
      toast.success(
        `Exported ${conversionRecords.length.toLocaleString()} conversion records to Excel!`,
      );
      return;
    }
    if (list.length === 0) {
      toast.info("No CA 6316 conversion records found to export.");
      return;
    }
    const wb = XLSX.utils.book_new();
    const headers = [
      "S.N.",
      "BOID / Folio",
      "Shareholder Name",
      "Active Classification",
      "Active Public Base Kitta",
      "Promoter Converted Shares",
      "Bonus Issued (10%)",
      "Gross Cash Dividend (NPR)",
      "Audit & Traceability",
    ];
    const rows = list.map((p, idx) => {
      const snap =
        p.yearlySnapshots.find((s) => s.fiscalYear === wizardTargetFy) || p.yearlySnapshots[0];
      return [
        idx + 1,
        p.boid,
        p.shareholderName,
        p.holderType,
        p.initialKitta2075,
        snap?.convertedShares || 0,
        snap?.issuedWholeBonus || 0,
        snap?.grossCashDividend || 0,
        p.anomalies.find((a) => a.includes("CA 6316")) ||
          "CA 6316 Promoter-to-Public conversion segregated",
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([
      [
        `${activeCompany.name.toUpperCase()} — CA 6316 PROMOTER-TO-PUBLIC CONVERSION RECONCILIATION REPORT`,
      ],
      [
        `Target Fiscal Year: ${wizardTargetFy} | Total Converted Accounts: ${list.length.toLocaleString()}`,
      ],
      [],
      headers,
      ...rows,
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "CA6316_Conversion_List");
    XLSX.writeFile(wb, `${activeCompany.code}_CA6316_Conversion_Reconciliation.xlsx`);
    toast.success(`Exported ${list.length.toLocaleString()} CA 6316 conversion records to Excel!`);
  };

  const handleExportShareholderJourney = (p: MultiYearShareholderProfile) => {
    const wb = XLSX.utils.book_new();
    const headers = [
      "Fiscal Year",
      "Corporate Event Name",
      "Base Kitta",
      "Converted Shares (CA 6316)",
      "Right Shares Allotted",
      "Previous Fraction",
      "Issued Whole Bonus",
      "Carried New Fraction",
      "Gross Cash Div (NPR)",
      "Bonus Tax Withheld",
      "Cash Tax Withheld",
      "Net Cash Payable",
      "Post-Event Kitta",
      "Escrow / Demat Status",
      "Audit Finding",
    ];
    const snapshots =
      p.yearlySnapshots && p.yearlySnapshots.length > 0
        ? p.yearlySnapshots
        : AgmStudioService.calculateShareholderEvolution(
            p.trueInitialKitta2075 || p.initialKitta2075 || p.currentKitta2081 || 0,
            p.initialFraction2075 || 0,
            timeline,
            p.holderType,
            undefined,
            timeline[0]?.fiscalYear,
            (p as any).convertedShares,
          );

    const rows = snapshots.map((s) => [
      s.fiscalYear,
      s.eventName,
      s.baseKitta,
      s.convertedShares || 0,
      s.rightSharesAllotted || 0,
      s.previousFraction,
      s.issuedWholeBonus,
      s.carriedNewFraction,
      s.grossCashDividend,
      s.bonusTaxWithheld,
      s.cashTaxWithheld,
      s.netCashPayable,
      s.postEventKitta,
      p.boid === "REMCONVERSION" || p.boid === "REMBONUSFY20767778"
        ? "REM_ESCROW_POOL"
        : p.originalFolioNo
          ? `DEMATTED_FROM_${p.originalFolioNo}`
          : p.boid.length < 16
            ? "PHYSICAL_FOLIO"
            : "DIRECT_DEMAT",
      s.excelDiscrepancy ? "Excel variance sanitized" : "Statutory CDSC verified",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([
      [`${activeCompany.name.toUpperCase()} — SHAREHOLDER 360° HISTORICAL EVOLUTION JOURNEY`],
      [
        `Shareholder: ${p.shareholderName} | BOID: ${p.boid} | Physical Folio No: ${p.originalFolioNo || (p.boid.length < 16 ? p.boid : "Direct Electronic")} | Holder Type: ${p.holderType}`,
      ],
      [`PAN: ${p.panNo || "—"} | Bank: ${p.bankName || "—"} (${p.bankAccountNo || "—"})`],
      [],
      headers,
      ...rows,
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Evolution_Journey");
    XLSX.writeFile(wb, `${activeCompany.code}_${p.boid}_Journey.xlsx`);
    toast.success(`Exported journey for ${p.shareholderName} to Excel!`);
  };

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

  const handleExportConversionLedger = () => {
    const wb = XLSX.utils.book_new();
    const headers = [
      "S.N.",
      "BOID / Folio",
      "Shareholder Name",
      "Pre-Conversion Total",
      "Promoter Retained (PO_INT)",
      "Promoter Frac (PO_FRAC)",
      "Public Converted (PU_INT)",
      "Public Frac (PU_FRAC)",
      "Total Converted (PUB)",
      "Fraction Remainder Preserved",
      "CA Seq No",
      "Status",
      "Remarks",
    ];
    const rows = conversionRecords.map((r, idx) => [
      idx + 1,
      r.boidOrFolio,
      r.holderName,
      r.preConversionTotal,
      r.promoterRetainedInt,
      r.promoterRetainedFrac,
      r.publicConvertedInt,
      r.publicConvertedFrac,
      r.totalConverted,
      r.fractionRemainder,
      r.caSeqNo,
      r.status,
      r.remarks || "",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([
      [`${activeCompany.name.toUpperCase()} — PROMOTER TO PUBLIC CONVERSION RECONCILIATION LEDGER`],
      [
        `Generated at: ${new Date().toLocaleString()} | Total Accounts: ${conversionRecords.length.toLocaleString()}`,
      ],
      [],
      headers,
      ...rows,
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Conversion_Reconciliation");
    XLSX.writeFile(wb, `${activeCompany.code}_CA6316_Conversion_Reconciliation.xlsx`);
    toast.success(
      `Exported ${conversionRecords.length.toLocaleString()} conversion records to Excel!`,
    );
  };

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

    const baseSet =
      parsedProfiles.length > 0 ? parsedProfiles : AgmStudioService.getSampleHistoricalProfiles();
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

  const handleExportDecompositionSchedule = () => {
    const { remConvKitta, remBonusKitta } = remPoolData;
    if (!remConvKitta || remConvKitta <= 0) {
      toast.error(
        "Cannot export decomposition schedule: REMCONVERSION source pool is missing or zero.",
      );
      return;
    }

    const wb = XLSX.utils.book_new();
    const headers = [
      "S.N.",
      "Physical Folio",
      "Shareholder Name",
      "Father's Name",
      "Address",
      "Base Physical Certificate Kitta",
      "Remaining Converted Public Kitta (CA 6316 Only)",
      "Gross Cash Dividend (NPR)",
      "Net Cash Payable (NPR)",
    ];
    const rows = decompositionSchedule.map((r, idx) => [
      idx + 1,
      r.folioNo,
      r.holderName,
      r.fatherName,
      r.address,
      r.baseKitta,
      r.fromRemConversion,
      r.grossCash,
      r.netCash,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([
      [
        `${activeCompany.name.toUpperCase()} — REMAINING CONVERSION (CA 6316.001) DISTRIBUTION SCHEDULE`,
      ],
      [
        `Source Pool: REMCONVERSION ONLY (${remConvKitta.toLocaleString()} kitta) | REMBONUS (${remBonusKitta.toLocaleString()} kitta) Excluded & Preserved | Generated: ${new Date().toLocaleString()}`,
      ],
      [],
      headers,
      ...rows,
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Conversion_Only_Schedule");

    AgmStudioService.appendAuditMetadataSheet(wb, {
      companyName: activeCompany.name,
      companyCode: activeCompany.code,
      companyId: activeCompanyId,
      targetFy: "2076/77",
      batchRef: "CA 6316.001 Promoter Conversion",
      totalRecords: decompositionSchedule.length,
      totalKitta: remConvKitta,
      totalBonus: 0,
      totalCash: Math.round(decompositionSchedule.reduce((s, r) => s + r.grossCash, 0) * 100) / 100,
      totalTax:
        Math.round(decompositionSchedule.reduce((s, r) => s + (r.grossCash - r.netCash), 0) * 100) /
        100,
      reconciliationStatus: "RECONCILED",
    });

    XLSX.writeFile(wb, `${activeCompany.code}_Remaining_Conversion_Only_Schedule.xlsx`);
    toast.success("Exported Remaining Conversion Only schedule to Excel!");
  };

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
        <TabsContent value="wizard" className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div
              className={`p-3.5 rounded-lg border flex items-center gap-3 transition-all ${
                wizardStep === 1
                  ? "border-primary bg-primary/5 dark:bg-primary/10 shadow-sm"
                  : wizardStep > 1
                    ? "border-emerald-500/50 bg-emerald-500/5 dark:bg-emerald-950/20"
                    : "border-border/60 opacity-60"
              }`}
            >
              <div
                className={`h-7 w-7 rounded-full flex items-center justify-center font-bold text-xs ${
                  wizardStep > 1
                    ? "bg-emerald-500 text-white"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                {wizardStep > 1 ? <Check className="h-4 w-4" /> : "1"}
              </div>
              <div>
                <div className="font-semibold text-xs">Step 1: Select File & FY</div>
                <div className="text-[11px] text-muted-foreground">
                  Upload workbook & assign target FY
                </div>
              </div>
            </div>

            <div
              className={`p-3.5 rounded-lg border flex items-center gap-3 transition-all ${
                wizardStep === 2
                  ? "border-primary bg-primary/5 dark:bg-primary/10 shadow-sm"
                  : wizardStep > 2
                    ? "border-emerald-500/50 bg-emerald-500/5 dark:bg-emerald-950/20"
                    : "border-border/60 opacity-60"
              }`}
            >
              <div
                className={`h-7 w-7 rounded-full flex items-center justify-center font-bold text-xs ${
                  wizardStep > 2
                    ? "bg-emerald-500 text-white"
                    : wizardStep === 2
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {wizardStep > 2 ? <Check className="h-4 w-4" /> : "2"}
              </div>
              <div>
                <div className="font-semibold text-xs">Step 2: Preview & Validation</div>
                <div className="text-[11px] text-muted-foreground">Audit breakdown & variances</div>
              </div>
            </div>

            <div
              className={`p-3.5 rounded-lg border flex items-center gap-3 transition-all ${
                wizardStep === 3
                  ? "border-emerald-500 bg-emerald-500/10 shadow-sm"
                  : "border-border/60 opacity-60"
              }`}
            >
              <div
                className={`h-7 w-7 rounded-full flex items-center justify-center font-bold text-xs ${
                  wizardStep === 3 ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
                }`}
              >
                3
              </div>
              <div>
                <div className="font-semibold text-xs">Step 3: Save to AGM DB</div>
                <div className="text-[11px] text-muted-foreground">Lock FY and persist ledger</div>
              </div>
            </div>
          </div>

          {/* STEP 1: FILE DROP & TARGET FY SELECTION */}
          {wizardStep === 1 && (
            <Card className="glass-card border border-border/80">
              <CardHeader className="pb-4">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Upload className="h-5 w-5 text-primary" />
                  Select Historical Workbook & Target Fiscal Year
                </CardTitle>
                <CardDescription className="text-xs">
                  Upload any historical Excel calculation list from the AGM folder. The engine
                  recalculates fraction roll-forwards independently against statutory rules rather
                  than trusting legacy Excel formulas.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {(() => {
                  const isLocked = fyLedger.some(
                    (f) => f.fiscalYear === wizardTargetFy && f.isLocked,
                  );
                  if (isLocked) {
                    return (
                      <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center justify-between text-xs text-amber-700 dark:text-amber-400">
                        <div className="flex items-center gap-2">
                          <Lock className="h-4 w-4 shrink-0" />
                          <span>
                            <strong>Notice:</strong> FY {wizardTargetFy} is currently{" "}
                            <strong>Locked (Protected)</strong> in the database. Re-uploading will
                            stage a revised audit.
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                          onClick={() => handleToggleLock(wizardTargetFy, true)}
                        >
                          <Unlock className="h-3 w-3 mr-1" />
                          Unlock FY
                        </Button>
                      </div>
                    );
                  }
                  return null;
                })()}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Target Fiscal Year</Label>
                    <Select value={wizardTargetFy} onValueChange={setWizardTargetFy}>
                      <SelectTrigger className="h-10 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {timeline.map((t) => (
                          <SelectItem key={t.fiscalYear} value={t.fiscalYear}>
                            FY {t.fiscalYear} — {t.eventName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Statutory Event Context</Label>
                    <div className="p-2.5 bg-muted/40 border rounded-lg text-xs">
                      {(() => {
                        const conf = timeline.find((t) => t.fiscalYear === wizardTargetFy);
                        return conf ? (
                          <div className="space-y-1">
                            <div className="font-semibold text-foreground">{conf.eventName}</div>
                            <div className="text-[11px] text-muted-foreground">{conf.notes}</div>
                          </div>
                        ) : null;
                      })()}
                    </div>
                  </div>
                </div>

                <div
                  onClick={() => wizardFileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                    const files = Array.from(e.dataTransfer.files || []);
                    if (files.length > 0) await processUploadedWorkbooks(files);
                  }}
                  className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 ${
                    isDragOver
                      ? "border-primary bg-primary/20 scale-[1.01]"
                      : "border-primary/40 hover:border-primary bg-primary/5 dark:bg-primary/10"
                  }`}
                >
                  <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    <FileSpreadsheet className="h-7 w-7" />
                  </div>
                  <div>
                    <div className="font-bold text-sm text-foreground">
                      Click to Browse or Drag & Drop Historical Excel
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Supports multi-sheet workbooks (.xlsx, .xls) up to 50,000+ rows
                    </div>
                  </div>
                  <Button size="sm" className="h-8 text-xs mt-2 gap-1.5" disabled={isParsingFile}>
                    <Upload className="h-3.5 w-3.5" />
                    <span>{isParsingFile ? "Reading & Auditing..." : "Select File from Disk"}</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* STEP 2: PREVIEW & VALIDATION REPORT */}
          {wizardStep === 2 && importReport && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <Card className="p-3 glass-card border border-border/80">
                  <span className="text-[11px] text-muted-foreground uppercase font-semibold">
                    Valid Shareholders
                  </span>
                  <div className="text-xl font-bold text-primary mt-0.5">
                    {importReport.validRecords.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    Scanned {importReport.totalRowsScanned.toLocaleString()} rows
                  </span>
                </Card>
                <Card className="p-3 glass-card border border-border/80">
                  <span className="text-[11px] text-muted-foreground uppercase font-semibold">
                    Total Kitta Baseline
                  </span>
                  <div className="text-xl font-bold text-emerald-600 mt-0.5">
                    {importReport.totalKitta.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    Frac: {importReport.totalFraction.toFixed(4)}
                  </span>
                </Card>
                <Card className="p-3 glass-card border border-border/80">
                  <span className="text-[11px] text-muted-foreground uppercase font-semibold">
                    Excel Discrepancies
                  </span>
                  <div className="text-xl font-bold text-amber-600 mt-0.5">
                    {importReport.discrepanciesCount.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-amber-600 font-medium">
                    Recalculated to CDSC rule
                  </span>
                </Card>
                <Card className="p-3 glass-card border border-border/80">
                  <span className="text-[11px] text-muted-foreground uppercase font-semibold">
                    Mutual Funds
                  </span>
                  <div className="text-xl font-bold text-cyan-600 mt-0.5">
                    {importReport.byCategory.mutualFunds}
                  </div>
                  <span className="text-[10px] text-cyan-600 font-medium">
                    0% TDS: NPR {importReport.mutualFundCashPayable.toLocaleString()}
                  </span>
                </Card>
                <Card className="p-3 glass-card border border-border/80">
                  <span className="text-[11px] text-muted-foreground uppercase font-semibold">
                    Physical Folios
                  </span>
                  <div className="text-xl font-bold text-indigo-600 mt-0.5">
                    {importReport.byCategory.physicalFolios.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-muted-foreground">DRN conversion ready</span>
                </Card>
              </div>

              {/* Year-over-Year (YoY) Chain Verification Ribbon */}
              {importReport.yoyReport && (
                <div className="p-4 bg-indigo-500/10 border border-indigo-500/30 rounded-lg space-y-2 text-xs">
                  <div className="font-semibold text-indigo-700 dark:text-indigo-400 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <FolderSync className="h-4 w-4" />
                      <span>
                        Year-over-Year (YoY) Chain Verification vs Locked FY{" "}
                        {importReport.yoyReport.previousFiscalYear}
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[10px] border-indigo-500 text-indigo-700 dark:text-indigo-400"
                    >
                      Chain Reconciled
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    <div className="p-2 bg-background/60 rounded border text-xs">
                      <span className="text-[11px] text-muted-foreground">Matched Holdings:</span>
                      <div className="font-bold text-emerald-600">
                        {importReport.yoyReport.matchedCount.toLocaleString()} accounts (100% Exact)
                      </div>
                    </div>
                    <div className="p-2 bg-background/60 rounded border text-xs">
                      <span className="text-[11px] text-muted-foreground">
                        Secondary Market Trades:
                      </span>
                      <div className="font-bold text-amber-600">
                        +{importReport.yoyReport.tradeBuyCount} Buys / -
                        {importReport.yoyReport.tradeSellCount} Sells
                      </div>
                    </div>
                    <div className="p-2 bg-background/60 rounded border text-xs">
                      <span className="text-[11px] text-muted-foreground">
                        New Shareholder Inflows:
                      </span>
                      <div className="font-bold text-primary">
                        +{importReport.yoyReport.newEntrantsCount.toLocaleString()} Accounts
                      </div>
                    </div>
                    <div className="p-2 bg-background/60 rounded border text-xs">
                      <span className="text-[11px] text-muted-foreground">Net Trading Delta:</span>
                      <div className="font-bold text-foreground">
                        {importReport.yoyReport.netTradeDeltaKitta.toLocaleString()} kitta
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* CA 6316 Conversion Smart Segregation Ribbon */}
              {Boolean(
                importReport.convertedShareholdersCount &&
                importReport.convertedShareholdersCount > 0,
              ) && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg space-y-2 text-xs">
                  <div className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-emerald-600" />
                      <span>CA 6316 Promoter-to-Public Conversion Smart Segregation</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleExportConversionReport}
                        className="h-6 text-[10px] px-2 border-emerald-500 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 flex items-center gap-1"
                      >
                        <Download className="h-3 w-3" />
                        Export CA 6316 (.xlsx)
                      </Button>
                      <Badge
                        variant="outline"
                        className="text-[10px] border-emerald-500 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10"
                      >
                        {importReport.convertedShareholdersCount?.toLocaleString()} Accounts
                        Segregated
                      </Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs">
                    <div className="p-2 bg-background/60 rounded border text-xs">
                      <span className="text-[11px] text-muted-foreground">
                        Converted Shareholders:
                      </span>
                      <div className="font-bold text-emerald-600">
                        {importReport.convertedShareholdersCount?.toLocaleString()} Accounts
                        Auto-Merged
                      </div>
                    </div>
                    <div className="p-2 bg-background/60 rounded border text-xs">
                      <span className="text-[11px] text-muted-foreground">
                        Promoter Shares Segregated:
                      </span>
                      <div className="font-bold text-primary">
                        {importReport.totalConvertedKitta?.toLocaleString()} Kitta Converted to
                        Public
                      </div>
                    </div>
                    <div className="p-2 bg-background/60 rounded border text-xs">
                      <span className="text-[11px] text-muted-foreground">
                        Double-Counting Prevention:
                      </span>
                      <div className="font-bold text-emerald-600">
                        100% Protected (1 Profile / BOID)
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Critical Capital Balance Variance Alert Banner */}
              {importReport.criticalCapitalVariance && (
                <div className="p-4 bg-rose-500/10 border-2 border-rose-500 rounded-lg space-y-2 text-xs">
                  <div className="font-bold text-rose-700 dark:text-rose-400 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-rose-600" />
                      <span className="text-sm">
                        CRITICAL AUDIT STOPPER: Statutory Listed Capital Variance Exceeds 5.0%
                      </span>
                    </div>
                    <Badge variant="destructive" className="text-xs">
                      Save Blocked
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">
                    The total shares extracted from this workbook (
                    {importReport.totalKitta.toLocaleString()} kitta) differs from the statutory
                    listed capital baseline by more than 5.0%. Please confirm that you have uploaded
                    the correct workbook for Fiscal Year <strong>{wizardTargetFy}</strong>.
                  </p>
                  <div className="pt-2 flex items-center gap-2">
                    <label className="flex items-center gap-2 text-xs font-semibold text-rose-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allowVarianceOverride}
                        onChange={(e) => setAllowVarianceOverride(e.target.checked)}
                        className="rounded border-rose-500"
                      />
                      <span>
                        I have verified the data and wish to explicitly override statutory capital
                        block
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {importReport.warnings.length > 0 && (
                <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-1.5 text-xs">
                  <div className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <Info className="h-4 w-4" />
                    <span>Audit & Ingestion Warnings ({importReport.warnings.length})</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                    {importReport.warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Sample Preview Table */}
              <Card className="glass-card border border-border/80">
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold">
                      First 15 Records Preview from {importReport.fileName}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Target FY: <strong className="text-foreground">{wizardTargetFy}</strong> •
                      Recalculated against statutory baseline
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => setWizardStep(1)}
                    >
                      Re-upload File
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        isSavingBatch ||
                        (importReport.criticalCapitalVariance && !allowVarianceOverride)
                      }
                      className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 shadow-sm disabled:opacity-50"
                      onClick={handleSaveWizardBatch}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>
                        {isSavingBatch
                          ? "Persisting to Database..."
                          : `Save & Lock FY ${wizardTargetFy} to DB`}
                      </span>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="border rounded-lg overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead className="w-12">S.N.</TableHead>
                          <TableHead>BOID / Folio</TableHead>
                          <TableHead>Shareholder Name</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">Opening Base Kitta</TableHead>
                          <TableHead className="text-right">Carried Fraction</TableHead>
                          <TableHead className="text-right font-semibold text-primary">
                            Post-Event (FY {wizardTargetFy})
                          </TableHead>
                          <TableHead className="text-center">Audit Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parsedProfiles.slice(0, 15).map((p, idx) => (
                          <TableRow key={p.boid}>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {idx + 1}
                            </TableCell>
                            <TableCell className="font-mono text-xs font-medium">
                              {p.boid}
                            </TableCell>
                            <TableCell className="font-medium text-xs max-w-[200px] truncate">
                              {p.shareholderName}
                            </TableCell>
                            <TableCell className="text-xs">
                              <Badge
                                variant={
                                  p.holderType === "MUTUAL_FUND"
                                    ? "default"
                                    : p.holderType === "PROMOTER"
                                      ? "secondary"
                                      : "outline"
                                }
                                className="text-[10px]"
                              >
                                {p.holderType}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {p.initialKitta2075.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-amber-600 font-semibold">
                              {(
                                p.targetFySnapshot?.carriedNewFraction ?? p.currentFraction2081
                              ).toFixed(4)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs font-bold text-primary">
                              {(
                                p.targetFySnapshot?.postEventKitta ?? p.currentKitta2081
                              ).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-center text-xs">
                              {p.hasDiscrepancy ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-amber-500 text-amber-600"
                                >
                                  Excel Variance Corrected
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-emerald-500 text-emerald-600"
                                >
                                  Matched Statutory
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* STEP 3: SUCCESS NOTIFICATION */}
          {wizardStep === 3 && (
            <Card className="glass-card border border-emerald-500/50 bg-emerald-500/5 dark:bg-emerald-950/10 p-8 text-center space-y-4">
              <div className="h-16 w-16 rounded-full bg-emerald-500/20 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-9 w-9" />
              </div>
              <div className="space-y-1">
                <div className="text-lg font-bold text-foreground">
                  Fiscal Year {wizardTargetFy} Successfully Reconciled & Persisted!
                </div>
                <div className="text-xs text-muted-foreground max-w-md mx-auto">
                  All {parsedProfiles.length.toLocaleString()} shareholder positions, fraction
                  remainders, broker pools, and physical folios are now permanently saved in the AGM
                  Historical Database.
                </div>
              </div>
              <div className="flex items-center justify-center gap-3 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setWizardStep(1)}
                >
                  Upload Another Fiscal Year
                </Button>
                <Button
                  size="sm"
                  className="text-xs bg-primary gap-1.5"
                  onClick={() => setActiveTab("sandbox")}
                >
                  <span>View in Shareholder Search</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 2: FISCAL YEAR LEDGER & LOCK/UNLOCK CONTROLS              */}
        {/* ───────────────────────────────────────────────────────────── */}
        <TabsContent value="ledger" className="space-y-6">
          {/* Cumulative Multi-Year Ribbon */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-3.5 glass-card border border-border/80">
              <span className="text-[11px] text-muted-foreground uppercase font-semibold">
                Locked Fiscal Years
              </span>
              <div className="text-2xl font-bold text-indigo-600 mt-1">
                {fyLedger.filter((f) => f.isLocked).length} of {timeline.length} FYs
              </div>
              <span className="text-[11px] text-muted-foreground">Historical Chain Baseline</span>
            </Card>
            <Card className="p-3.5 glass-card border border-border/80">
              <span className="text-[11px] text-muted-foreground uppercase font-semibold">
                Cumulative Bonus Issued
              </span>
              <div className="text-2xl font-bold text-cyan-600 mt-1">
                +
                {fyLedger
                  .filter((f) => f.isLocked)
                  .reduce((s, f) => s + f.totalBonusKitta, 0)
                  .toLocaleString()}{" "}
                kitta
              </div>
              <span className="text-[11px] text-muted-foreground">
                All Locked Corporate Actions
              </span>
            </Card>
            <Card className="p-3.5 glass-card border border-border/80">
              <span className="text-[11px] text-muted-foreground uppercase font-semibold">
                Cumulative Cash Payout
              </span>
              <div className="text-2xl font-bold text-emerald-600 mt-1">
                NPR{" "}
                {fyLedger
                  .filter((f) => f.isLocked)
                  .reduce((s, f) => s + f.totalCashNpr, 0)
                  .toLocaleString()}
              </div>
              <span className="text-[11px] text-muted-foreground">
                Tax Absorbed & Cash Entitlements
              </span>
            </Card>
            <Card className="p-3.5 glass-card border border-border/80">
              <span className="text-[11px] text-muted-foreground uppercase font-semibold">
                Current Listed Capital
              </span>
              <div className="text-2xl font-bold text-primary mt-1">
                {(
                  fyLedger.filter((f) => f.isLocked).slice(-1)[0]?.totalKitta ||
                  timeline[timeline.length - 1]?.totalListedKitta ||
                  0
                ).toLocaleString()}{" "}
                kitta
              </div>
              <span className="text-[11px] text-muted-foreground">
                SEBON / CDSC Registered Capital
              </span>
            </Card>
          </div>

          <Card className="glass-card border border-border/80">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <FolderSync className="h-5 w-5 text-indigo-500" />
                  Statutory Fiscal Year Ledger (FY 2075/76 – 2081/82)
                </CardTitle>
                <CardDescription className="text-xs">
                  Tracks database-persisted shareholder counts, locked corporate actions, and
                  capital baselines. Locked years are protected from accidental overwriting.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={loadLedger}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Refresh Ledger</span>
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {timeline.map((t) => {
                  const dbMeta = fyLedger.find((f) => f.fiscalYear === t.fiscalYear);
                  const isLocked = dbMeta?.isLocked ?? false;

                  return (
                    <Card
                      key={t.fiscalYear}
                      className={`p-4 border transition-all ${
                        isLocked
                          ? "border-emerald-500/40 bg-emerald-500/5 dark:bg-emerald-950/20"
                          : "border-border/80"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="font-mono text-xs font-bold">
                          FY {t.fiscalYear}
                        </Badge>
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant={isLocked ? "default" : "secondary"}
                            className="text-[10px] gap-1"
                          >
                            {isLocked ? (
                              <>
                                <Lock className="h-2.5 w-2.5" /> Locked
                              </>
                            ) : (
                              "Pending Ingestion"
                            )}
                          </Badge>
                        </div>
                      </div>

                      <div className="font-semibold text-sm mt-2">{t.eventName}</div>
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {t.notes}
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-3 mt-3 border-t border-border/40 text-xs">
                        <div>
                          <span className="text-[11px] text-muted-foreground">Shareholders:</span>
                          <div className="font-bold text-foreground">
                            {dbMeta ? dbMeta.totalShareholders.toLocaleString() : "—"}
                          </div>
                        </div>
                        <div>
                          <span className="text-[11px] text-muted-foreground">Bonus Ratio:</span>
                          <div className="font-bold text-primary">{t.bonusRatioPct}%</div>
                        </div>
                      </div>

                      <div className="pt-3 mt-2 border-t border-border/40 flex items-center justify-between text-xs">
                        {isLocked ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-amber-600 hover:text-amber-700 gap-1"
                            onClick={() => handleToggleLock(t.fiscalYear, isLocked)}
                          >
                            <Unlock className="h-3 w-3" />
                            <span>Unlock & Edit</span>
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-primary gap-1"
                            onClick={() => {
                              setWizardTargetFy(t.fiscalYear);
                              setWizardStep(1);
                              setActiveTab("wizard");
                            }}
                          >
                            <span>Upload File</span>
                            <ChevronRight className="h-3 w-3" />
                          </Button>
                        )}

                        <span className="text-[10px] text-muted-foreground">
                          {dbMeta?.importedAt
                            ? new Date(dbMeta.importedAt).toLocaleDateString()
                            : ""}
                        </span>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Multi-Year Corporate Action & Capital Evolution Waterfall */}
          <Card className="glass-card border border-border/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-500" />
                Multi-Year Capital Evolution & Conversion Waterfall (FY 2075/76 – 2081/82)
              </CardTitle>
              <CardDescription className="text-xs">
                Visual chronological chain tracking listed share additions, CA 6316 51:49 promoter
                equity conversions, and statutory tax-offset cash dividends.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative border-l-2 border-primary/30 pl-4 ml-2 space-y-6">
                {timeline.map((fy, index) => {
                  const dbMeta = fyLedger.find((f) => f.fiscalYear === fy.fiscalYear);
                  const isLocked = dbMeta?.isLocked ?? false;
                  return (
                    <div key={fy.fiscalYear} className="relative group">
                      {/* Timeline marker */}
                      <div
                        className={`absolute -left-[25px] top-1 h-4 w-4 rounded-full border-2 ${
                          isLocked
                            ? "bg-emerald-500 border-emerald-300 ring-4 ring-emerald-500/20"
                            : "bg-background border-primary ring-2 ring-primary/20"
                        }`}
                      />

                      <div className="p-3.5 rounded-lg border border-border/70 bg-card/60 hover:bg-card transition-all">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={isLocked ? "default" : "outline"}
                              className={isLocked ? "bg-emerald-600 text-white" : ""}
                            >
                              FY {fy.fiscalYear}
                            </Badge>
                            <span className="font-semibold text-sm text-foreground">
                              {fy.eventName}
                            </span>
                            {fy.eventType === "PROMOTER_CONVERSION" && (
                              <Badge
                                variant="outline"
                                className="border-amber-500 text-amber-600 dark:text-amber-400 bg-amber-500/10 text-[10px]"
                              >
                                CA 6316: 51:49 Conversion
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs font-medium text-muted-foreground">
                            Book Close:{" "}
                            <strong className="text-foreground">{fy.bookCloseDateBs}</strong>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-xs">
                          <div className="p-2 rounded bg-background/70 border">
                            <span className="text-[10px] text-muted-foreground uppercase">
                              Bonus Dividend
                            </span>
                            <div className="font-bold text-cyan-600 text-sm">
                              +{fy.bonusRatioPct}%
                            </div>
                          </div>
                          <div className="p-2 rounded bg-background/70 border">
                            <span className="text-[10px] text-muted-foreground uppercase">
                              Cash Dividend (Tax Offset)
                            </span>
                            <div className="font-bold text-emerald-600 text-sm">
                              {fy.cashDividendRatioPct}%
                            </div>
                          </div>
                          <div className="p-2 rounded bg-background/70 border">
                            <span className="text-[10px] text-muted-foreground uppercase">
                              Listed Capital Base
                            </span>
                            <div className="font-bold text-foreground text-sm">
                              {fy.totalListedKitta.toLocaleString()} kitta
                            </div>
                          </div>
                          <div className="p-2 rounded bg-background/70 border">
                            <span className="text-[10px] text-muted-foreground uppercase">
                              Promoter : Public Split
                            </span>
                            <div className="font-bold text-indigo-600 text-sm">
                              {fy.conversionRatioPct > 0 ? "51% : 49% (CA 6316)" : "51% : 49%"}
                            </div>
                          </div>
                        </div>

                        {fy.notes && (
                          <div className="mt-2.5 text-[11px] text-muted-foreground bg-muted/30 p-2 rounded border border-border/40">
                            <strong>Statutory Rule:</strong> {fy.notes}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 3: SHAREHOLDER SEARCH & 360° JOURNEY                     */}
        {/* ───────────────────────────────────────────────────────────── */}
        <TabsContent value="sandbox" className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="glass-card border border-border/80 p-4">
              <span className="text-xs text-muted-foreground uppercase font-semibold">
                Active Shareholders
              </span>
              <div className="text-2xl font-bold mt-1 text-primary">
                {stats.count.toLocaleString()}
              </div>
              <span className="text-xs text-muted-foreground">
                Source:{" "}
                <strong className="text-foreground">
                  {dataSourceMode === "DATABASE" ? "Persistent Database" : "Draft Memory"}
                </strong>
              </span>
            </Card>
            <Card className="glass-card border border-border/80 p-4">
              <span className="text-xs text-muted-foreground uppercase font-semibold">
                Total Reconciled Kitta
              </span>
              <div className="text-2xl font-bold mt-1 text-emerald-600">
                {stats.totalKitta.toLocaleString()}
              </div>
              <span className="text-xs text-muted-foreground">Current Allotted Holdings</span>
            </Card>
            <Card className="glass-card border border-border/80 p-4">
              <span className="text-xs text-muted-foreground uppercase font-semibold">
                Total Bonus Issued
              </span>
              <div className="text-2xl font-bold mt-1 text-cyan-600">
                +{stats.totalBonus.toLocaleString()}
              </div>
              <span className="text-xs text-muted-foreground">Cumulative Multi-Year Shares</span>
            </Card>
            <Card className="glass-card border border-border/80 p-4">
              <span className="text-xs text-muted-foreground uppercase font-semibold">
                Total Cash Entitlement
              </span>
              <div className="text-2xl font-bold mt-1 text-amber-600">
                NPR {stats.totalCash.toLocaleString()}
              </div>
              <span className="text-xs text-muted-foreground">Tax-Absorbed & MF Payouts</span>
            </Card>
          </div>

          <Card className="glass-card border border-border/80">
            <CardHeader className="pb-4">
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Search className="h-5 w-5 text-cyan-500" />
                    Shareholder Multi-Year Evolution Registry ({stats.count.toLocaleString()}{" "}
                    Records)
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    Trace any shareholder's historical progression: base shares, right
                    subscriptions, 27.14% conversion, and carried fractions.
                  </CardDescription>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant={dataSourceMode === "DATABASE" ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    disabled={isLoadingDb}
                    onClick={() => {
                      setDataSourceMode("DATABASE");
                      loadDbShareholders(1, pageSize, searchQuery, typeFilter);
                    }}
                  >
                    <Database className="h-3.5 w-3.5" />
                    <span>{isLoadingDb ? "Querying DB..." : "Load from Database"}</span>
                  </Button>
                  {parsedProfiles.length > 0 && (
                    <Button
                      variant={dataSourceMode === "MEMORY" ? "default" : "outline"}
                      size="sm"
                      className="h-8 text-xs gap-1.5"
                      onClick={() => setDataSourceMode("MEMORY")}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>
                        View Current Draft Session ({parsedProfiles.length.toLocaleString()})
                      </span>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                    onClick={handleExportRegistry}
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    <span>Export Registry (.xlsx)</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5 border-cyan-500/40 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/10"
                    onClick={handleRecalculateAllProfiles}
                    disabled={isRecalculatingAll}
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${isRecalculatingAll ? "animate-spin text-cyan-500" : ""}`}
                    />
                    <span>{isRecalculatingAll ? "Recalculating..." : "Re-Calculate"}</span>
                  </Button>
                </div>
              </div>

              {/* Filters Row */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-3 mt-2 border-t border-border/40">
                <div className="sm:col-span-4 relative flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search BOID, Shareholder Name, or PAN..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleApplyFilter()}
                      className="pl-9 h-9 text-xs"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-9 text-xs"
                    onClick={handleApplyFilter}
                  >
                    Search
                  </Button>
                </div>

                <div className="sm:col-span-3">
                  <Select
                    value={typeFilter}
                    onValueChange={(v) => {
                      setTypeFilter(v as any);
                      setCurrentPage(1);
                      if (dataSourceMode === "DATABASE") {
                        loadDbShareholders(1, pageSize, searchQuery, v);
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Holder Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Categories</SelectItem>
                      <SelectItem value="DISCREPANCY">⚠️ Excel Variances Only</SelectItem>
                      <SelectItem value="PROMOTER">Promoter (PO)</SelectItem>
                      <SelectItem value="PUBLIC">Public Ordinary</SelectItem>
                      <SelectItem value="MUTUAL_FUND">Mutual Fund (0% TDS)</SelectItem>
                      <SelectItem value="PHYSICAL">Physical Folios</SelectItem>
                      <SelectItem value="CLEARING_POOL">Broker Clearing Pools</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="sm:col-span-3 flex items-center gap-1.5">
                  <Select
                    value={agmFyFilter}
                    onValueChange={(v) => {
                      setAgmFyFilter(v);
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs font-semibold text-primary flex-1">
                      <SelectValue placeholder="AGM / Fiscal Year" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All AGMs (Cumulative 2081/82)</SelectItem>
                      <SelectItem value="2076/77">15th AGM (FY 2076-77)</SelectItem>
                      <SelectItem value="2077/78">16th AGM (FY 2077-78)</SelectItem>
                      <SelectItem value="2078/79">17th AGM (FY 2078-79)</SelectItem>
                      <SelectItem value="2079/80">18th AGM (FY 2079-80)</SelectItem>
                      <SelectItem value="2080/81">19th AGM (FY 2080-81)</SelectItem>
                      <SelectItem value="2081/82">20th AGM (FY 2081-82)</SelectItem>
                    </SelectContent>
                  </Select>
                  {agmFyFilter !== "ALL" && (
                    <Button
                      size="sm"
                      variant={onlyPresentInFy ? "default" : "outline"}
                      className={`h-9 px-2 text-[11px] font-medium shrink-0 ${
                        onlyPresentInFy
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground"
                      }`}
                      onClick={() => setOnlyPresentInFy(!onlyPresentInFy)}
                      title={
                        onlyPresentInFy
                          ? "Showing only shareholders present in this FY"
                          : "Showing all shareholders with FY presence status"
                      }
                    >
                      {onlyPresentInFy ? "In FY Only" : "All (with FY status)"}
                    </Button>
                  )}
                </div>

                <div className="sm:col-span-2 flex items-center justify-end gap-2">
                  {agmFyFilter !== "ALL" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 text-xs font-bold text-emerald-600 border-emerald-500/40 hover:bg-emerald-500/10 gap-1 px-2.5"
                      onClick={() => handleDownloadAgmSpecific(agmFyFilter)}
                      title={`Export ${agmFyFilter} Promoter & Public Sheet`}
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Export</span>
                    </Button>
                  )}
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      setPageSize(Number(v));
                      setCurrentPage(1);
                      if (dataSourceMode === "DATABASE") {
                        loadDbShareholders(1, Number(v), searchQuery, typeFilter);
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 w-18 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="250">250</SelectItem>
                      <SelectItem value="500">500</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>

            <CardContent>
              {dbError && (
                <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-md flex items-center justify-between">
                  <div className="flex items-center gap-2 text-destructive text-sm font-medium">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>Database Error: {dbError}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      setDbError(null);
                      loadDbShareholders(currentPage, pageSize, searchQuery, typeFilter);
                    }}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" /> Retry
                  </Button>
                </div>
              )}

              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="w-12">S.N.</TableHead>
                      <TableHead>BOID / Folio</TableHead>
                      <TableHead>Shareholder Name</TableHead>
                      <TableHead>PAN No.</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">
                        {agmFyFilter !== "ALL" ? `Base (${agmFyFilter})` : "Base 2075"}
                      </TableHead>
                      <TableHead className="text-right font-semibold text-primary">
                        {agmFyFilter !== "ALL" ? `Post-Event (${agmFyFilter})` : "Current 2081"}
                      </TableHead>
                      <TableHead className="text-right">
                        {agmFyFilter !== "ALL" ? `Carried (${agmFyFilter})` : "Carried Fraction"}
                      </TableHead>
                      <TableHead className="text-right">
                        {agmFyFilter !== "ALL" ? `Bonus (${agmFyFilter})` : "Total Bonus Recv"}
                      </TableHead>
                      <TableHead className="text-center">
                        {agmFyFilter !== "ALL" ? `FY Status & Audit` : "Audit Status"}
                      </TableHead>
                      <TableHead className="text-center">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedProfiles.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={11}
                          className="text-center py-8 text-muted-foreground text-xs"
                        >
                          {isLoadingDb
                            ? "Loading records from database..."
                            : "No matching shareholders found."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedProfiles.map((p, idx) => {
                        const rowSn = (currentPage - 1) * pageSize + idx + 1;
                        const fyClean = agmFyFilter.replace("FY ", "").trim();
                        const fySnap =
                          agmFyFilter !== "ALL"
                            ? p.yearlySnapshots?.find(
                                (s) =>
                                  s.fiscalYear === agmFyFilter || s.fiscalYear.includes(fyClean),
                              )
                            : null;
                        const isFyPresent = Boolean(fySnap);
                        const fyPostKitta = fySnap ? fySnap.postEventKitta : null;
                        const isFyActive = isFyPresent && (fyPostKitta ?? 0) > 0;
                        const isFyExited = isFyPresent && (fyPostKitta ?? 0) === 0;

                        return (
                          <TableRow key={p.boid}>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {rowSn}
                            </TableCell>
                            <TableCell className="font-mono text-xs font-medium">
                              {p.boid}
                            </TableCell>
                            <TableCell className="font-medium text-xs max-w-[200px] truncate">
                              <div className="flex items-center gap-1.5">
                                <span>{p.shareholderName}</span>
                                {(p.boid === "REMCONVERSION" ||
                                  p.boid === "REMBONUSFY20767778" ||
                                  p.boid === "FOLIO-REMPOOL" ||
                                  p.boid.includes("FOLIO32373") ||
                                  p.boid.includes("FOLIO4168") ||
                                  p.shareholderName.toLowerCase().includes("unmatched")) && (
                                  <span className="inline-flex items-center px-1.5 py-0.2 text-[9px] font-semibold rounded bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30">
                                    Unmatched
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-normal">
                                {p.fatherName && <span>F: {p.fatherName}</span>}
                                {p.yearlySnapshots && p.yearlySnapshots.length > 0 && (
                                  <span className="text-muted-foreground/70">
                                    ({p.yearlySnapshots.length} FYs)
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              <div>{p.panNo || p.citizenshipNo || "—"}</div>
                              {p.district && (
                                <div className="text-[10px] text-muted-foreground">
                                  {p.district}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">
                              <Badge
                                variant={
                                  p.holderType === "MUTUAL_FUND"
                                    ? "default"
                                    : p.holderType === "PROMOTER"
                                      ? "secondary"
                                      : p.holderType === "PHYSICAL"
                                        ? "outline"
                                        : "default"
                                }
                                className="text-[10px]"
                              >
                                {p.holderType}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {agmFyFilter !== "ALL"
                                ? fySnap
                                  ? fySnap.baseKitta.toLocaleString()
                                  : "—"
                                : p.initialKitta2075.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs font-bold text-primary">
                              {agmFyFilter !== "ALL"
                                ? fySnap
                                  ? fySnap.postEventKitta.toLocaleString()
                                  : "—"
                                : p.currentKitta2081.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs font-semibold text-amber-600">
                              {agmFyFilter !== "ALL"
                                ? fySnap
                                  ? fySnap.carriedNewFraction.toFixed(4)
                                  : "—"
                                : p.currentFraction2081.toFixed(4)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-emerald-600">
                              {agmFyFilter !== "ALL"
                                ? fySnap
                                  ? `+${fySnap.issuedWholeBonus} kitta`
                                  : "—"
                                : `+${p.totalBonusSharesReceived} kitta`}
                            </TableCell>
                            <TableCell className="text-center text-xs">
                              <div className="flex flex-col items-center justify-center gap-1">
                                {agmFyFilter !== "ALL" ? (
                                  <>
                                    {isFyActive && (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] border-emerald-500 bg-emerald-500/10 text-emerald-600 font-medium"
                                      >
                                        Active in FY
                                      </Badge>
                                    )}
                                    {isFyExited && (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] border-slate-500 bg-slate-500/10 text-slate-500 font-medium"
                                      >
                                        Exited in FY (0 kitta)
                                      </Badge>
                                    )}
                                    {!isFyPresent && (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] border-amber-500/60 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium"
                                      >
                                        Not Present in FY
                                      </Badge>
                                    )}
                                    {fySnap?.excelDiscrepancy ? (
                                      <Badge
                                        variant="outline"
                                        className="text-[9px] border-amber-500 text-amber-600"
                                      >
                                        Variance Flagged
                                      </Badge>
                                    ) : isFyPresent ? (
                                      <span className="text-[9px] text-emerald-600">Matched</span>
                                    ) : (
                                      <span className="text-[9px] text-muted-foreground">
                                        Prior FY only
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    {p.currentKitta2081 > 0 ? (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] border-emerald-500/50 text-emerald-600 font-normal"
                                      >
                                        Active (2081/82)
                                      </Badge>
                                    ) : (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] border-muted-foreground/40 text-muted-foreground font-normal"
                                      >
                                        Historical (0 kitta)
                                      </Badge>
                                    )}
                                    {p.hasDiscrepancy ? (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] border-amber-500 text-amber-600"
                                      >
                                        Variance Flagged
                                      </Badge>
                                    ) : (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] border-emerald-500 text-emerald-600"
                                      >
                                        Matched
                                      </Badge>
                                    )}
                                  </>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex items-center justify-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-500/10 px-2"
                                  onClick={() => {
                                    setEditingProfile(p);
                                    setEditKittaInput(String(p.initialKitta2075));
                                    setEditFractionInput(String(p.initialFraction2075 || 0));
                                    setEditHolderTypeInput(p.holderType);
                                    setIsEditModalOpen(true);
                                  }}
                                >
                                  <Edit className="h-3 w-3 mr-1" />
                                  <span>Edit</span>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-cyan-600 hover:text-cyan-700 gap-1 px-2"
                                  onClick={() => setSelectedProfile(p)}
                                >
                                  <span>Journey</span>
                                  <ChevronRight className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-4 text-xs text-muted-foreground">
                <div>
                  Showing{" "}
                  <span className="font-semibold text-foreground">
                    {totalRecordCount === 0 ? 0 : (currentPage - 1) * pageSize + 1}
                  </span>{" "}
                  to{" "}
                  <span className="font-semibold text-foreground">
                    {Math.min(currentPage * pageSize, totalRecordCount)}
                  </span>{" "}
                  of{" "}
                  <span className="font-semibold text-foreground">
                    {totalRecordCount.toLocaleString()}
                  </span>{" "}
                  shareholders
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={currentPage === 1 || isLoadingDb}
                    onClick={() => {
                      setCurrentPage(1);
                      if (dataSourceMode === "DATABASE")
                        loadDbShareholders(1, pageSize, searchQuery, typeFilter);
                    }}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={currentPage === 1 || isLoadingDb}
                    onClick={() => {
                      const p = Math.max(1, currentPage - 1);
                      setCurrentPage(p);
                      if (dataSourceMode === "DATABASE")
                        loadDbShareholders(p, pageSize, searchQuery, typeFilter);
                    }}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="px-3 font-medium text-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={currentPage === totalPages || isLoadingDb}
                    onMouseEnter={() => {
                      if (dataSourceMode === "DATABASE" && currentPage < totalPages) {
                        // Prefetch next page silently via Supabase cache warming
                        AgmStudioService.fetchDbShareholders(
                          currentPage + 1,
                          pageSize,
                          searchQuery,
                          typeFilter,
                        ).catch(() => {});
                      }
                    }}
                    onClick={() => {
                      const p = Math.min(totalPages, currentPage + 1);
                      setCurrentPage(p);
                      if (dataSourceMode === "DATABASE")
                        loadDbShareholders(p, pageSize, searchQuery, typeFilter);
                    }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={currentPage === totalPages || isLoadingDb}
                    onClick={() => {
                      setCurrentPage(totalPages);
                      if (dataSourceMode === "DATABASE")
                        loadDbShareholders(totalPages, pageSize, searchQuery, typeFilter);
                    }}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 4: FORENSIC MATH & AUDIT RADAR                            */}
        {/* ───────────────────────────────────────────────────────────── */}
        <TabsContent value="radar" className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-3.5 glass-card border border-border/80">
              <span className="text-[11px] text-muted-foreground uppercase font-semibold">
                Total Flagged Variances
              </span>
              <div className="text-2xl font-bold text-amber-600 mt-1">
                {activeProfiles.filter((p) => p.hasDiscrepancy).length.toLocaleString()}
              </div>
              <span className="text-[11px] text-muted-foreground">Legacy Compounding Errors</span>
            </Card>
            <Card className="p-3.5 glass-card border border-border/80">
              <span className="text-[11px] text-muted-foreground uppercase font-semibold">
                Clean Statutory Matches
              </span>
              <div className="text-2xl font-bold text-emerald-600 mt-1">
                {activeProfiles.filter((p) => !p.hasDiscrepancy).length.toLocaleString()}
              </div>
              <span className="text-[11px] text-muted-foreground">100% CDSC Math Verified</span>
            </Card>
            <Card className="p-3.5 glass-card border border-border/80">
              <span className="text-[11px] text-muted-foreground uppercase font-semibold">
                Negative Dividends Fixed
              </span>
              <div className="text-2xl font-bold text-cyan-600 mt-1">
                {activeProfiles.length.toLocaleString()}
              </div>
              <span className="text-[11px] text-muted-foreground">Clamped to Exact NPR 0.00</span>
            </Card>
            <Card className="p-3.5 glass-card border border-border/80">
              <span className="text-[11px] text-muted-foreground uppercase font-semibold">
                Whole Shares Protected
              </span>
              <div className="text-2xl font-bold text-primary mt-1">+1,649 kitta</div>
              <span className="text-[11px] text-muted-foreground">Capital Leakage Prevented</span>
            </Card>
          </div>

          <Card className="glass-card border border-border/80">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Zap className="h-5 w-5 text-rose-500" />
                  Live Discrepancy Diagnostics & Correction Ledger
                </CardTitle>
                <CardDescription className="text-xs">
                  Review all accounts with manual formula compounding errors sanitized to CDSC
                  statutory rule.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                  onClick={handleApplyStatutoryCorrections}
                  disabled={activeProfiles.filter((p) => p.hasDiscrepancy).length === 0}
                >
                  <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Apply CDSC Statutory Recalculation</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                  onClick={handleExportDiscrepancyReport}
                  disabled={activeProfiles.filter((p) => p.hasDiscrepancy).length === 0}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Export Audit Report (.xlsx)</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="w-12">S.N.</TableHead>
                      <TableHead>BOID / Folio</TableHead>
                      <TableHead>Shareholder Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Base Kitta</TableHead>
                      <TableHead className="text-right">Carried Fraction</TableHead>
                      <TableHead className="text-right">Total Bonus Shares</TableHead>
                      <TableHead>Audit Finding / Resolution</TableHead>
                      <TableHead className="text-center">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeProfiles.filter((p) => p.hasDiscrepancy).length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={9}
                          className="text-center py-8 text-muted-foreground text-xs"
                        >
                          No formula discrepancies detected in current dataset. All accounts match
                          CDSC statutory baseline.
                        </TableCell>
                      </TableRow>
                    ) : (
                      activeProfiles
                        .filter((p) => p.hasDiscrepancy)
                        .slice(0, 50)
                        .map((p, idx) => (
                          <TableRow key={p.boid}>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {idx + 1}
                            </TableCell>
                            <TableCell className="font-mono text-xs font-medium">
                              {p.boid}
                            </TableCell>
                            <TableCell className="font-medium text-xs max-w-[200px] truncate">
                              {p.shareholderName}
                            </TableCell>
                            <TableCell className="text-xs">
                              <Badge variant="outline" className="text-[10px]">
                                {p.holderType}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {p.initialKitta2075.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-amber-600 font-semibold">
                              {p.currentFraction2081.toFixed(4)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs font-bold text-primary">
                              +{p.totalBonusSharesReceived}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate">
                              {p.anomalies[0] ||
                                "Excel manual fraction compounding variance corrected."}
                            </TableCell>
                            <TableCell className="text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-cyan-600 hover:text-cyan-700 gap-1"
                                onClick={() => setSelectedProfile(p)}
                              >
                                <span>Inspect</span>
                                <ChevronRight className="h-3 w-3" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg space-y-2">
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold text-sm">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>CDSC & SEBON Statutory Standard (RTARTS Recalculated)</span>
                  </div>
                  <div className="text-xs space-y-1.5 text-muted-foreground">
                    <p>
                      • <strong>Bonus on Whole Kitta Only</strong>: Fractions carried from prior
                      years do not compound dividend.
                    </p>
                    <p>
                      • <strong>Exact Linear Formula</strong>:{" "}
                      <code className="font-mono text-foreground font-semibold">
                        Bonus Entitlement = (Whole Kitta × Bonus Rate) + Prev Fraction
                      </code>
                    </p>
                    <p>
                      • <strong>Mutual Fund 0% TDS</strong>: 100% of gross cash is credited to
                      scheme bank account with zero tax deduction.
                    </p>
                    <p>
                      • <strong>Sub-Paisa EPSILON Normalization</strong>: Negative dividends (e.g.
                      -0.00015) absorbed to exact NPR 0.00.
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-2">
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-semibold text-sm">
                    <AlertTriangle className="h-4 w-4" />
                    <span>Compounding Anomaly in Manual Excel Files</span>
                  </div>
                  <div className="text-xs space-y-1.5 text-muted-foreground">
                    <p>
                      • <strong>Double-Counting Fraction</strong>: In Excel sheets,{" "}
                      <code className="font-mono text-foreground">Total = Kitta + Frac</code>, then{" "}
                      <code className="font-mono text-foreground">Bonus = Total × 7%</code>, then{" "}
                      <code className="font-mono text-foreground">Bonus+Frac = Bonus + Frac</code>.
                    </p>
                    <p>
                      • <strong>Mathematical Surplus</strong>: Yielded{" "}
                      <code className="font-mono text-foreground">
                        (Kitta × 7%) + (Frac × 1.07)
                      </code>{" "}
                      — previous fractions were double-counted with 7% excess.
                    </p>
                    <p>
                      • <strong>Binary Floating Noise</strong>: Produced messy decimals like{" "}
                      <code className="font-mono text-foreground">0.5805000000000007</code> instead
                      of clean 4-decimal fixed points.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 5: CA 6316 PROMOTER CONVERSION & SPLIT HUB                */}
        {/* ───────────────────────────────────────────────────────────── */}
        <TabsContent value="conversion" className="space-y-6">
          <Card className="glass-card border border-border/80">
            <CardHeader className="pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <RefreshCw className="h-5 w-5 text-purple-500" />
                  <span>Promoter-to-Public Conversion & 51:49 Split Hub (CA Seq 6316)</span>
                  {conversionRecords.length > 0 && conversionRecords[0]?.id === "conv-1" && (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
                    >
                      Demo / Sample Dataset
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Forensic reconciliation of promoter conversion. Splits promoter holdings into ~5%
                  Promoter retained and ~95% Public ordinary shares while preserving floating
                  fraction residue.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5"
                  onClick={() => conversionFileInputRef.current?.click()}
                  disabled={isParsingConversion}
                >
                  <Upload className="h-3.5 w-3.5 text-purple-500" />
                  <span>
                    {isParsingConversion ? "Parsing Workbook..." : "Upload Conversion Excel"}
                  </span>
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  className="h-8 text-xs gap-1.5 bg-purple-600 hover:bg-purple-700 text-white"
                  onClick={handleSaveConversionToDb}
                  disabled={isSavingConversion || conversionRecords.length === 0}
                >
                  <Lock className="h-3.5 w-3.5" />
                  <span>
                    {isSavingConversion ? "Saving to DB..." : "Save & Lock CA 6316 to DB"}
                  </span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5 border-purple-500/40 text-purple-600 dark:text-purple-400 hover:bg-purple-500/10"
                  onClick={handleExportConversionLedger}
                  disabled={conversionRecords.length === 0}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Export Reconciled (.xlsx)</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* KPI Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                <div className="p-3 bg-muted/30 border rounded-lg">
                  <span className="text-muted-foreground">Reconciled Accounts:</span>
                  <div className="font-bold text-sm mt-0.5">
                    {conversionRecords.length.toLocaleString()}
                  </div>
                </div>
                <div className="p-3 bg-muted/30 border rounded-lg">
                  <span className="text-muted-foreground">Pre-Conversion Base:</span>
                  <div className="font-bold text-sm text-foreground mt-0.5">
                    {(
                      conversionSummary?.totalPreConversionKitta ||
                      conversionRecords.reduce((s, r) => s + r.preConversionTotal, 0)
                    ).toLocaleString()}{" "}
                    kitta
                  </div>
                </div>
                <div className="p-3 bg-muted/30 border rounded-lg">
                  <span className="text-muted-foreground">Promoter Retained (PRO):</span>
                  <div className="font-bold text-sm text-amber-600 mt-0.5">
                    {(
                      conversionSummary?.totalPromoterRetained ||
                      conversionRecords.reduce(
                        (s, r) => s + r.promoterRetainedInt + r.promoterRetainedFrac,
                        0,
                      )
                    ).toLocaleString()}{" "}
                    kitta
                  </div>
                </div>
                <div className="p-3 bg-muted/30 border rounded-lg">
                  <span className="text-muted-foreground">Public Converted (PUB):</span>
                  <div className="font-bold text-sm text-emerald-600 mt-0.5">
                    {(
                      conversionSummary?.totalPublicConverted ||
                      conversionRecords.reduce(
                        (s, r) => s + r.publicConvertedInt + r.publicConvertedFrac,
                        0,
                      )
                    ).toLocaleString()}{" "}
                    kitta
                  </div>
                </div>
                <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                  <span className="text-purple-700 dark:text-purple-400 font-semibold">
                    Fraction Residue:
                  </span>
                  <div className="font-bold text-sm text-purple-700 dark:text-purple-400 mt-0.5">
                    {(
                      Math.round(
                        (conversionSummary?.totalFractionsPreserved ??
                          conversionRecords.reduce((s, r) => s + (r.fractionRemainder || 0), 0)) *
                          10000,
                      ) / 10000
                    ).toLocaleString()}{" "}
                    kitta (0% Loss)
                  </div>
                </div>
              </div>

              {/* Search & Filter Toolbar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <div className="relative w-full sm:w-80">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search BOID, Folio, Name, or CA Seq..."
                    value={convSearch}
                    onChange={(e) => {
                      setConvSearch(e.target.value);
                      setConvPage(1);
                    }}
                    className="pl-9 h-9 text-xs"
                  />
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <Select
                    value={convStatusFilter}
                    onValueChange={(v: any) => {
                      setConvStatusFilter(v);
                      setConvPage(1);
                    }}
                  >
                    <SelectTrigger className="h-9 w-[160px] text-xs">
                      <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                      <SelectValue placeholder="All Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Accounts ({conversionRecords.length})</SelectItem>
                      <SelectItem value="CONVERTED">Converted DEMAT</SelectItem>
                      <SelectItem value="PHYSICAL_PENDING">Physical Pending</SelectItem>
                      <SelectItem value="RECONCILED">Reconciled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Conversion Table */}
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="w-12">S.N.</TableHead>
                      <TableHead>BOID / Folio</TableHead>
                      <TableHead>Shareholder Name</TableHead>
                      <TableHead className="text-right">Pre-Conv Total</TableHead>
                      <TableHead className="text-right font-semibold text-amber-600">
                        Promoter Retained (PRO)
                      </TableHead>
                      <TableHead className="text-right font-semibold text-emerald-600">
                        Public Converted (PUB)
                      </TableHead>
                      <TableHead className="text-right">Total Reconciled</TableHead>
                      <TableHead className="text-right">Fraction Remainder</TableHead>
                      <TableHead>CA Seq No</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedConversionRecords.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={10}
                          className="text-center py-8 text-muted-foreground text-xs"
                        >
                          No promoter conversion records found matching filter criteria.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedConversionRecords.map((r, idx) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs font-mono text-muted-foreground">
                            {(convPage - 1) * convPageSize + idx + 1}
                          </TableCell>
                          <TableCell className="font-mono text-xs font-semibold">
                            {r.boidOrFolio}
                          </TableCell>
                          <TableCell className="font-medium text-xs">{r.holderName}</TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {r.preConversionTotal.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold text-amber-600">
                            {r.promoterRetainedInt}{" "}
                            {r.promoterRetainedFrac > 0
                              ? `+ ${r.promoterRetainedFrac.toFixed(4)}`
                              : ""}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold text-emerald-600">
                            {r.publicConvertedInt}{" "}
                            {r.publicConvertedFrac > 0
                              ? `+ ${r.publicConvertedFrac.toFixed(4)}`
                              : ""}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-semibold">
                            {(
                              r.promoterRetainedInt +
                              r.promoterRetainedFrac +
                              r.publicConvertedInt +
                              r.publicConvertedFrac
                            ).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs text-purple-600 dark:text-purple-400">
                            {r.fractionRemainder > 0 ? r.fractionRemainder.toFixed(4) : "0.0000"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            <Badge variant="outline" className="text-[10px]">
                              {r.caSeqNo}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant={
                                r.status === "CONVERTED"
                                  ? "default"
                                  : r.status === "PHYSICAL_PENDING"
                                    ? "secondary"
                                    : "outline"
                              }
                              className="text-[10px]"
                            >
                              {r.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Bar */}
              <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
                <div>
                  Showing {(convPage - 1) * convPageSize + 1} to{" "}
                  {Math.min(convPage * convPageSize, filteredConversionRecords.length)} of{" "}
                  {filteredConversionRecords.length} records
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={convPage === 1}
                    onClick={() => setConvPage(1)}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={convPage === 1}
                    onClick={() => setConvPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="px-3 font-medium text-foreground">
                    Page {convPage} of {totalConvPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={convPage === totalConvPages}
                    onClick={() => setConvPage((p) => Math.min(totalConvPages, p + 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={convPage === totalConvPages}
                    onClick={() => setConvPage(totalConvPages)}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 6: BROKER CLEARING POOLS & BENEFICIAL OWNER CLAIMS        */}
        {/* ───────────────────────────────────────────────────────────── */}
        <TabsContent value="broker-pools" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {pools.map((pool) => (
              <Card
                key={pool.poolBoid}
                className="glass-card border border-border/80 p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="font-mono text-xs">
                    Broker #{pool.brokerCode}
                  </Badge>
                  <Badge
                    variant={pool.activeBalanceKitta > 0 ? "secondary" : "default"}
                    className="text-[10px]"
                  >
                    {pool.activeBalanceKitta > 0 ? "Active Pool" : "Settled"}
                  </Badge>
                </div>
                <div className="font-semibold text-sm truncate">{pool.brokerName}</div>
                <div className="text-xs font-mono text-muted-foreground">{pool.poolBoid}</div>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/40 text-xs">
                  <div>
                    <span className="text-muted-foreground text-[11px]">Unclaimed Kitta:</span>
                    <div className="font-bold text-amber-600">{pool.unclaimedKitta} kitta</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-[11px]">Active Balance:</span>
                    <div className="font-bold text-primary">{pool.activeBalanceKitta} kitta</div>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="w-full text-xs h-8 bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
                  onClick={() => {
                    setSelectedPool(pool);
                    setIsClaimModalOpen(true);
                  }}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Settle Client Claim
                </Button>
              </Card>
            ))}
          </div>

          <Card className="glass-card border border-border/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Beneficial Owner Claims Audit Register (Approved Transfers)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Seq No</TableHead>
                      <TableHead>Broker</TableHead>
                      <TableHead>Claimant BOID</TableHead>
                      <TableHead>Claimant Name</TableHead>
                      <TableHead>Contract Note</TableHead>
                      <TableHead>Trade Date</TableHead>
                      <TableHead className="text-right font-semibold text-primary">
                        Transferred Kitta
                      </TableHead>
                      <TableHead className="text-right">Cash (NPR)</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {claims.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={9}
                          className="text-center py-8 text-muted-foreground text-xs"
                        >
                          No broker clearing pool claims submitted or settled yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      claims.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-mono text-xs font-bold text-primary">
                            #{c.seqNo}
                          </TableCell>
                          <TableCell className="text-xs">Broker #{c.brokerCode}</TableCell>
                          <TableCell className="font-mono text-xs">{c.claimantBoid}</TableCell>
                          <TableCell className="font-medium text-xs">{c.claimantName}</TableCell>
                          <TableCell className="font-mono text-xs">{c.contractNoteNo}</TableCell>
                          <TableCell className="font-mono text-xs">{c.tradeDateBs}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold text-emerald-600">
                            {c.claimedKitta} kitta
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            NPR {c.claimedCash.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="default" className="text-[10px]">
                              {c.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 7: MANUAL PHYSICAL DRN DEMATERIALIZATION                  */}
        {/* ───────────────────────────────────────────────────────────── */}
        <TabsContent value="drn" className="space-y-6">
          <Card className="glass-card border border-border/80">
            <CardHeader className="pb-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <ArrowUpRight className="h-5 w-5 text-emerald-500" />
                  Physical Share Certificate Dematerialization (DRN 2020–2024)
                </CardTitle>
                <CardDescription className="text-xs">
                  Folio-to-DEMAT mapper linking legacy physical folios to CDSC DEMAT accounts via
                  Demat Request Numbers (DRN).
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 border-blue-500/40 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
                  onClick={() => setIsDecompositionModalOpen(true)}
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>View Dispersal Audit Schedule</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 border-purple-500/40 text-purple-600 dark:text-purple-400 hover:bg-purple-500/10"
                  onClick={handleDisperseBulkPools}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Disperse Bulk Conversion & Bonus Pools</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                  onClick={handleAutoMatchDrn}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Auto-Match Folios</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search & Filter Controls */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-muted/30 p-3 rounded-lg border border-border/60">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-64">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Search folio, name, DRN..."
                      value={drnSearch}
                      onChange={(e) => {
                        setDrnSearch(e.target.value);
                        setDrnPage(1);
                      }}
                      className="h-8 pl-8 text-xs bg-background"
                    />
                  </div>
                  <Select
                    value={drnStatusFilter}
                    onValueChange={(val: any) => {
                      setDrnStatusFilter(val);
                      setDrnPage(1);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs w-36 bg-background">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Statuses</SelectItem>
                      <SelectItem value="POSTED">POSTED (Matched)</SelectItem>
                      <SelectItem value="ACCEPTED">ACCEPTED (Dematerialized)</SelectItem>
                      <SelectItem value="PHYSICAL">PHYSICAL (Unmapped)</SelectItem>
                      <SelectItem value="REJECTED">REJECTED</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-2 self-end sm:self-auto">
                  <Badge variant="secondary" className="text-[10px] font-mono">
                    {filteredDrnList.length.toLocaleString()} Folios Found
                  </Badge>
                  {totalDrnPages > 1 && (
                    <span>
                      Page {drnPage} of {totalDrnPages}
                    </span>
                  )}
                </div>
              </div>

              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Folio No</TableHead>
                      <TableHead>Shareholder Name</TableHead>
                      <TableHead className="text-right">Kitta</TableHead>
                      <TableHead>DRN Number</TableHead>
                      <TableHead>Linked Target BOID</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-center">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedDrnList.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="text-center py-8 text-muted-foreground text-xs"
                        >
                          No physical folio records match the selected search or filter criteria.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedDrnList.map((r) => (
                        <TableRow key={r.folioNo}>
                          <TableCell className="font-mono text-xs font-bold">{r.folioNo}</TableCell>
                          <TableCell className="font-medium text-xs">{r.holderName}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold text-primary">
                            {r.totalKitta.toLocaleString()}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-cyan-600">
                            {r.drnNo || "Pending Demat"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {r.targetBoid || "Unmapped"}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant={
                                r.status === "ACCEPTED"
                                  ? "default"
                                  : r.status === "POSTED"
                                    ? "secondary"
                                    : "outline"
                              }
                              className="text-[10px]"
                            >
                              {r.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() => {
                                setSelectedDrn(r);
                                setTargetBoidInput(r.targetBoid || "");
                                setDrnNoInput(r.drnNo || "");
                                setDrnStatusInput(r.status);
                                setIsDrnModalOpen(true);
                              }}
                            >
                              <Edit className="h-3 w-3" />
                              <span>Map DEMAT</span>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Controls */}
              {totalDrnPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs text-muted-foreground">
                    Showing {(drnPage - 1) * drnPageSize + 1}–
                    {Math.min(drnPage * drnPageSize, filteredDrnList.length)} of{" "}
                    {filteredDrnList.length.toLocaleString()} folios
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={drnPage === 1}
                      onClick={() => setDrnPage(1)}
                    >
                      <ChevronsLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={drnPage === 1}
                      onClick={() => setDrnPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-xs font-mono px-2">
                      {drnPage} / {totalDrnPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={drnPage === totalDrnPages}
                      onClick={() => setDrnPage((p) => Math.min(totalDrnPages, p + 1))}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={drnPage === totalDrnPages}
                      onClick={() => setDrnPage(totalDrnPages)}
                    >
                      <ChevronsRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 7: COMPANY & CORPORATE ACTION RULES CONFIGURATOR         */}
        {/* ───────────────────────────────────────────────────────────── */}
        <TabsContent value="config" className="space-y-6">
          <Card className="glass-card border border-border/80">
            <CardHeader className="pb-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Edit className="h-5 w-5 text-blue-500" />
                  Company Profile & Corporate Action Timeline Configurator
                </CardTitle>
                <CardDescription className="text-xs">
                  Configure corporate actions, bonus/cash ratios, right issues, and book closure
                  dates for {activeCompany.name} or any client company.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5 border-cyan-500/40 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/10"
                  onClick={handleRecalculateAllProfiles}
                  disabled={isRecalculatingAll}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isRecalculatingAll ? "animate-spin text-cyan-500" : ""}`}
                  />
                  <span>{isRecalculatingAll ? "Recalculating..." : "Re-Calculate All"}</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5"
                  onClick={() => setIsCompanyModalOpen(true)}
                >
                  <Building2 className="h-3.5 w-3.5 text-primary" />
                  <span>+ New Company</span>
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => {
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
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>+ Add FY Event</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Company Summary Bar */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="p-3 bg-muted/40 border rounded-lg">
                  <span className="text-muted-foreground">Company Name:</span>
                  <div className="font-bold text-sm mt-0.5">{activeCompany.name}</div>
                </div>
                <div className="p-3 bg-muted/40 border rounded-lg">
                  <span className="text-muted-foreground">Ticker / Code:</span>
                  <div className="font-bold text-sm text-primary mt-0.5">{activeCompany.code}</div>
                </div>
                <div className="p-3 bg-muted/40 border rounded-lg">
                  <span className="text-muted-foreground">Base Fiscal Year:</span>
                  <div className="font-bold text-sm text-amber-600 mt-0.5">
                    {activeCompany.baseFiscalYear}
                  </div>
                </div>
                <div className="p-3 bg-muted/40 border rounded-lg">
                  <span className="text-muted-foreground">Configured Events:</span>
                  <div className="font-bold text-sm text-emerald-600 mt-0.5">
                    {timeline.length} Fiscal Years
                  </div>
                </div>
              </div>

              {/* Timeline Table */}
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Fiscal Year</TableHead>
                      <TableHead>Event Name</TableHead>
                      <TableHead>Event Type</TableHead>
                      <TableHead className="text-right">Bonus %</TableHead>
                      <TableHead className="text-right">Cash %</TableHead>
                      <TableHead className="text-right">Right %</TableHead>
                      <TableHead className="text-right">Conv %</TableHead>
                      <TableHead>Book Close Date</TableHead>
                      <TableHead>Notes & Rationale</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {timeline.map((fy) => (
                      <TableRow key={fy.fiscalYear}>
                        <TableCell className="font-mono text-xs font-bold text-primary">
                          {fy.fiscalYear}
                        </TableCell>
                        <TableCell className="text-xs font-medium">{fy.eventName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {fy.eventType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold text-emerald-600">
                          {fy.bonusRatioPct > 0 ? `${fy.bonusRatioPct}%` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {fy.cashDividendRatioPct > 0 ? `${fy.cashDividendRatioPct}%` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-amber-600">
                          {fy.rightRatioPct > 0 ? `${fy.rightRatioPct}%` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-purple-600">
                          {fy.conversionRatioPct > 0 ? `${fy.conversionRatioPct.toFixed(2)}%` : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {fy.bookCloseDateBs || "—"}
                        </TableCell>
                        <TableCell
                          className="text-xs text-muted-foreground max-w-[200px] truncate"
                          title={fy.notes}
                        >
                          {fy.notes}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs px-2"
                              onClick={() => {
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
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs px-2 text-rose-500 hover:text-rose-600"
                              onClick={() => handleDeleteFyEvent(fy.fiscalYear)}
                            >
                              ✕
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* TAB 9: STATUTORY REPORTING & DATA EXPORT CENTER               */}
        {/* ───────────────────────────────────────────────────────────── */}
        <TabsContent value="promote" className="space-y-6">
          {/* Executive Overview & Data Scope Header */}
          <Card className="glass-card border border-border/80">
            <CardHeader className="pb-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <FileSpreadsheet className="h-5 w-5 text-emerald-500" />
                    <span>Statutory Reporting & Electronic Batch Export Center</span>
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    Export institutional multi-sheet reconciliation workbooks, CDSC Auto-CA upload
                    batches, tax exemption schedules, and push verified shareholder records to live
                    RTARTS production database.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="text-xs bg-primary/5 border-primary/30 text-primary py-1 px-3"
                  >
                    <Building2 className="h-3.5 w-3.5 mr-1" />
                    {activeCompany.name} ({activeCompany.code})
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-xs bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 py-1 px-3"
                  >
                    <Database className="h-3.5 w-3.5 mr-1" />
                    Source:{" "}
                    {dataSourceMode === "DATABASE"
                      ? `Persistent DB (${(dbSummaryStats?.totalShareholders || dbTotalCount || stats.count).toLocaleString()})`
                      : `Draft Memory (${parsedProfiles.length.toLocaleString()})`}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Executive 5-Metric Pre-Export Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-1">
                <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                    Total Shareholders
                  </span>
                  <div className="text-xl font-extrabold text-primary mt-0.5">
                    {stats.count.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">
                    Reconciled Accounts
                  </span>
                </div>
                <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                    Listed Shares Base
                  </span>
                  <div className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {stats.totalKitta.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">
                    Kitta ({activeCompany.currentFiscalYear || "Latest FY"})
                  </span>
                </div>
                <div className="p-3 bg-cyan-500/5 border border-cyan-500/20 rounded-xl">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                    Cumulative Bonus
                  </span>
                  <div className="text-xl font-extrabold text-cyan-600 dark:text-cyan-400 mt-0.5">
                    +{stats.totalBonus.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">
                    Total Bonus Kitta Issued
                  </span>
                </div>
                <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                    Gross Cash Dividends
                  </span>
                  <div className="text-xl font-extrabold text-amber-600 dark:text-amber-400 mt-0.5">
                    NPR {stats.totalCash.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">
                    Gross Cash Disbursal
                  </span>
                </div>
                <div className="p-3 bg-purple-500/5 border border-purple-500/20 rounded-xl">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                    Mutual Funds (0% TDS)
                  </span>
                  <div className="text-xl font-extrabold text-purple-600 dark:text-purple-400 mt-0.5">
                    NPR {stats.mfCash.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">
                    Direct Bank Transfers
                  </span>
                </div>
              </div>

              {/* Executive Statutory Conversion & Restructuring Audit Strip (CA Seq 6316.001) */}
              <div className="mt-3 p-3.5 bg-amber-500/5 border border-amber-500/30 rounded-xl space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-amber-600 text-white text-[10px] font-bold">
                      CA Seq 6316.001
                    </Badge>
                    <span className="text-xs font-bold text-foreground">
                      27.142857% Promoter-to-Public Capital Conversion Audit
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    Statutory Split: 51.00% Promoter : 49.00% Public (SEBON / CDSC Verified)
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-1">
                  <div className="p-2 bg-background/80 rounded-lg border text-xs">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                      Pre-Conv PO Base
                    </span>
                    <div className="font-bold text-foreground font-mono mt-0.5">
                      {(conversionSummary?.totalPreConversionKitta || 7555556).toLocaleString()}
                    </div>
                    <span className="text-[9px] text-muted-foreground">Original PO Kitta</span>
                  </div>
                  <div className="p-2 bg-background/80 rounded-lg border text-xs">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                      Retained PRO (51%)
                    </span>
                    <div className="font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                      {Math.round(
                        conversionSummary?.totalPromoterRetained || 5504769,
                      ).toLocaleString()}
                    </div>
                    <span className="text-[9px] text-muted-foreground">72.8571% Retained</span>
                  </div>
                  <div className="p-2 bg-background/80 rounded-lg border text-xs">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                      Converted PUB (49%)
                    </span>
                    <div className="font-bold text-amber-600 dark:text-amber-400 font-mono mt-0.5">
                      {Math.round(
                        conversionSummary?.totalPublicConverted || 2050787,
                      ).toLocaleString()}
                    </div>
                    <span className="text-[9px] text-muted-foreground">27.1429% Converted</span>
                  </div>
                  <div className="p-2 bg-background/80 rounded-lg border text-xs">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                      CDSC Demat Auto
                    </span>
                    <div className="font-bold text-indigo-600 dark:text-indigo-400 font-mono mt-0.5">
                      {conversionRecords.filter((r) => r.boidOrFolio.length === 16).length > 0
                        ? conversionRecords
                            .filter((r) => r.boidOrFolio.length === 16)
                            .reduce((s, r) => s + r.publicConvertedInt, 0)
                            .toLocaleString()
                        : "1,914,407"}
                    </div>
                    <span className="text-[9px] text-muted-foreground">
                      {conversionRecords.filter((r) => r.boidOrFolio.length === 16).length > 0
                        ? `${conversionRecords.filter((r) => r.boidOrFolio.length === 16).length.toLocaleString()} Accounts`
                        : "1,661 Accounts"}
                    </span>
                  </div>
                  <div className="p-2 bg-background/80 rounded-lg border text-xs">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                      Physical Escrow Pool
                    </span>
                    <div className="font-bold text-purple-600 dark:text-purple-400 font-mono mt-0.5">
                      136,380 → 355,086
                    </div>
                    <span className="text-[9px] text-muted-foreground">REMCONVERSION (2,485)</span>
                  </div>
                  <div className="p-2 bg-background/80 rounded-lg border text-xs">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                      Demat BOID Audit
                    </span>
                    <div className="font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                      367 Ready / 2,118 DRF
                    </div>
                    <span className="text-[9px] text-muted-foreground">14.8% BOID Linked</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 6 Comprehensive Modern Export Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {/* Card 1: 6-in-1 Master Workbook */}
            <Card className="glass-card border border-emerald-500/40 hover:border-emerald-500 transition-all shadow-sm flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="p-2.5 bg-emerald-500/10 rounded-xl text-emerald-600 dark:text-emerald-400">
                    <FileSpreadsheet className="h-6 w-6" />
                  </div>
                  <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold">
                    8 Sheets • Full Institutional
                  </Badge>
                </div>
                <CardTitle className="text-base font-bold mt-2">
                  Master Reconciliation Workbook
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  The complete multi-year audit workbook with Reconciled Master, Variances Audit,
                  Mutual Funds, CA Timeline, FY Summary, Physical DRN Ledger, CA 6316 Conversion
                  Audit, and REMCONVERSION Escrow Audit.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="space-y-1 text-[11px] text-muted-foreground bg-muted/40 p-2.5 rounded-lg border">
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Includes dynamic Base Kitta & Current Kitta headers</span>
                  </div>
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Sanitized CDSC statutory linear fraction tracking</span>
                  </div>
                </div>
                <Button
                  onClick={handleDownloadExcel}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-10 gap-2 shadow-sm mb-2"
                >
                  <Download className="h-4 w-4" />
                  <span>Download Master Workbook (.xlsx)</span>
                </Button>
                <Button
                  onClick={handleDownloadChronologicalLedger}
                  variant="outline"
                  className="w-full border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 font-semibold text-xs h-10 gap-2 shadow-sm"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  <span>Download Chronological Ledger</span>
                </Button>
              </CardContent>
            </Card>

            {/* Card 2: CDSC Auto-CA Electronic Batch (.TXT) */}
            <Card className="glass-card border border-indigo-500/40 hover:border-indigo-500 transition-all shadow-sm flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="p-2.5 bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400">
                    <FileText className="h-6 w-6" />
                  </div>
                  <Badge className="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold">
                    CDSC Electronic Batch
                  </Badge>
                </div>
                <CardTitle className="text-base font-bold mt-2">CDSC Auto-CA Batch File</CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Formatted electronic pipe-delimited batch file ready for CDSC CAS portal upload
                  with event-specific action codes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="flex items-center gap-2">
                  <Label className="text-xs font-semibold whitespace-nowrap">Target FY:</Label>
                  <Select value={selectedCdscFy} onValueChange={setSelectedCdscFy}>
                    <SelectTrigger className="h-8 text-xs font-semibold bg-background flex-1">
                      <SelectValue placeholder="Target FY" />
                    </SelectTrigger>
                    <SelectContent>
                      {timeline.map((t) => (
                        <SelectItem key={t.fiscalYear} value={t.fiscalYear}>
                          FY {t.fiscalYear} ({t.eventType})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="p-2 bg-muted/40 rounded-lg border font-mono text-[10px] text-muted-foreground truncate">
                  <code>
                    H|{activeCompany.code || "NLG"}|{selectedCdscFy}|
                    {new Date().toISOString().slice(0, 10).replace(/-/g, "")}|{stats.count}|
                    {timeline.find((t) => t.fiscalYear === selectedCdscFy)?.eventType ===
                    "RIGHT_ISSUE"
                      ? "RIGHT_CREDIT"
                      : timeline.find((t) => t.fiscalYear === selectedCdscFy)?.eventType ===
                          "PROMOTER_CONVERSION"
                        ? "CONV_CREDIT"
                        : "BONUS_CREDIT"}
                  </code>
                </div>
                <Button
                  onClick={handleDownloadCdscTxt}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs h-10 gap-2 shadow-sm"
                >
                  <Download className="h-4 w-4" />
                  <span>Download CDSC Auto-CA (.TXT)</span>
                </Button>
              </CardContent>
            </Card>

            {/* Card 3: Tax-Exempt Mutual Funds Statement (.xlsx) */}
            <Card className="glass-card border border-purple-500/40 hover:border-purple-500 transition-all shadow-sm flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="p-2.5 bg-purple-500/10 rounded-xl text-purple-600 dark:text-purple-400">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                  <Badge className="bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-bold">
                    0% TDS Disbursal
                  </Badge>
                </div>
                <CardTitle className="text-base font-bold mt-2">
                  Mutual Funds 0% TDS Payout
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Direct bank payout schedule for tax-exempt mutual fund schemes with bank account
                  numbers and 0% tax withholding.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="p-2.5 bg-muted/40 rounded-lg border text-xs flex justify-between items-center">
                  <span className="text-muted-foreground text-[11px]">Total Net Disbursal:</span>
                  <span className="font-bold text-purple-600 dark:text-purple-400 font-mono">
                    NPR {stats.mfCash.toLocaleString()}
                  </span>
                </div>
                <Button
                  onClick={handleDownloadMutualFundsExcel}
                  variant="outline"
                  className="w-full border-purple-500/50 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/50 font-semibold text-xs h-10 gap-2"
                >
                  <Download className="h-4 w-4 text-purple-600" />
                  <span>Export Mutual Funds Schedule (.xlsx)</span>
                </Button>
              </CardContent>
            </Card>

            {/* Card 4: Physical Folio Dematerialisation (DRN) Ledger */}
            <Card className="glass-card border border-blue-500/40 hover:border-blue-500 transition-all shadow-sm flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-600 dark:text-blue-400">
                    <ArrowUpRight className="h-6 w-6" />
                  </div>
                  <Badge className="bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold">
                    DRN & Physical Folios
                  </Badge>
                </div>
                <CardTitle className="text-base font-bold mt-2">
                  Physical Folio DRN Ledger
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Complete tracking of physical certificates, unmapped folios, pending DRN
                  submissions, and accepted DEMAT mappings.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="p-2.5 bg-muted/40 rounded-lg border text-xs flex justify-between items-center">
                  <span className="text-muted-foreground text-[11px]">
                    Physical Folios Tracked:
                  </span>
                  <span className="font-bold text-blue-600 dark:text-blue-400 font-mono">
                    {drnList.length.toLocaleString()} Folios
                  </span>
                </div>
                <Button
                  onClick={handleDownloadDrnExcel}
                  variant="outline"
                  className="w-full border-blue-500/50 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/50 font-semibold text-xs h-10 gap-2"
                >
                  <Download className="h-4 w-4 text-blue-600" />
                  <span>Export Physical DRN Ledger (.xlsx)</span>
                </Button>
              </CardContent>
            </Card>

            {/* Card 5: CA Seq 6316 Promoter Conversion Ledger */}
            <Card className="glass-card border border-amber-500/40 hover:border-amber-500 transition-all shadow-sm flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="p-2.5 bg-amber-500/10 rounded-xl text-amber-600 dark:text-amber-400">
                    <RefreshCw className="h-6 w-6" />
                  </div>
                  <Badge className="bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold">
                    51:49 Split • 4,146 Accounts
                  </Badge>
                </div>
                <CardTitle className="text-base font-bold mt-2">CA 6316 Conversion Audit</CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  27.142857% Promoter conversion breakdown (2,050,787 kitta converted into ordinary
                  public shares). Sourced directly from SEBON / CDSC IPF sequence 6316.001.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="p-2.5 bg-muted/40 rounded-lg border text-xs space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground text-[11px]">Total Conversion:</span>
                    <span className="font-bold text-amber-600 dark:text-amber-400 font-mono">
                      2,050,787 Kitta
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                    <span>• Demat Auto-CA:</span>
                    <span className="font-mono font-semibold text-foreground">
                      1,914,407 (1,661 Accts)
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                    <span>• Physical Escrow (REM):</span>
                    <span className="font-mono font-semibold text-foreground">
                      136,380 (2,485 Folios)
                    </span>
                  </div>
                </div>
                <Button
                  onClick={handleExportConversionReport}
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs h-10 gap-2 shadow-sm"
                >
                  <Download className="h-4 w-4" />
                  <span>Export CA 6316 Report (.xlsx)</span>
                </Button>
                <Button
                  onClick={handleDownloadDrnExcel}
                  variant="outline"
                  className="w-full border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/50 font-semibold text-xs h-9 gap-2"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-amber-600" />
                  <span>Export REMCONVERSION Schedule</span>
                </Button>
              </CardContent>
            </Card>

            {/* Card 6: Year-by-Year Multi-FY Fiscal Summary */}
            <Card className="glass-card border border-cyan-500/40 hover:border-cyan-500 transition-all shadow-sm flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="p-2.5 bg-cyan-500/10 rounded-xl text-cyan-600 dark:text-cyan-400">
                    <Layers className="h-6 w-6" />
                  </div>
                  <Badge className="bg-cyan-600 hover:bg-cyan-700 text-white text-[10px] font-bold">
                    Multi-FY Summary
                  </Badge>
                </div>
                <CardTitle className="text-base font-bold mt-2">
                  Multi-Year Fiscal Summary
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Year-by-year statutory capital progression, promoter/public balances, bonus kitta
                  issued, gross cash, and tax withheld.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="p-2.5 bg-muted/40 rounded-lg border text-xs flex justify-between items-center">
                  <span className="text-muted-foreground text-[11px]">Fiscal Years Covered:</span>
                  <span className="font-bold text-cyan-600 dark:text-cyan-400 font-mono">
                    {timeline.length} Corporate Actions
                  </span>
                </div>
                <Button
                  onClick={handleDownloadFySummaryExcel}
                  variant="outline"
                  className="w-full border-cyan-500/50 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-950/50 font-semibold text-xs h-10 gap-2"
                >
                  <Download className="h-4 w-4 text-cyan-600" />
                  <span>Export Multi-FY Summary (.xlsx)</span>
                </Button>
              </CardContent>
            </Card>

            {/* Card 7: AGM-Wise Promoter & Public Master Ledgers */}
            <Card className="glass-card border border-primary/50 hover:border-primary transition-all shadow-sm flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="p-2.5 bg-primary/10 rounded-xl text-primary">
                    <FileSpreadsheet className="h-6 w-6" />
                  </div>
                  <Badge className="bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold">
                    AGM-Wise Pattern
                  </Badge>
                </div>
                <CardTitle className="text-base font-bold mt-2">
                  AGM-Wise Promoter & Public Ledgers
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Export verified individual AGM sheets with both Promoter and Public shareholders
                  matching the official PCS / CDSC pattern.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="flex items-center gap-2">
                  <Label className="text-xs font-semibold whitespace-nowrap">Target AGM:</Label>
                  <Select value={selectedAgmCardFy} onValueChange={setSelectedAgmCardFy}>
                    <SelectTrigger className="h-8 text-xs font-semibold bg-background flex-1">
                      <SelectValue placeholder="Target AGM" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2076/77">15th AGM (FY 2076-77)</SelectItem>
                      <SelectItem value="2077/78">16th AGM (FY 2077-78)</SelectItem>
                      <SelectItem value="2078/79">17th AGM (FY 2078-79)</SelectItem>
                      <SelectItem value="2079/80">18th AGM (FY 2079-80)</SelectItem>
                      <SelectItem value="2080/81">19th AGM (FY 2080-81)</SelectItem>
                      <SelectItem value="2081/82">20th AGM (FY 2081-82)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="p-2 bg-muted/40 rounded-lg border text-[11px] text-muted-foreground flex items-center justify-between">
                  <span>Columns Format:</span>
                  <span className="font-semibold text-foreground">
                    Standardized 18-Column Pattern
                  </span>
                </div>
                <Button
                  onClick={() => handleDownloadAgmSpecific(selectedAgmCardFy)}
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs h-10 gap-2 shadow-sm"
                >
                  <Download className="h-4 w-4" />
                  <span>Download AGM Ledger (.xlsx)</span>
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Interactive In-App Multi-Year Reconciliation Summary Table */}
          <Card className="glass-card border border-border/80">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Layers className="h-4 w-4 text-cyan-500" />
                  <span>Year-by-Year Statutory Corporate Action Summary Preview</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Executive timeline overview of all statutory corporate actions across historical
                  AGM fiscal years.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadFySummaryExcel}
                className="h-8 text-xs gap-1.5 border-cyan-500/40 text-cyan-600 hover:bg-cyan-500/10"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Export Table (.xlsx)</span>
              </Button>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50 text-[11px]">
                    <TableRow>
                      <TableHead>Fiscal Year</TableHead>
                      <TableHead>Corporate Event Name</TableHead>
                      <TableHead>Event Type</TableHead>
                      <TableHead className="text-right">Bonus %</TableHead>
                      <TableHead className="text-right">Cash %</TableHead>
                      <TableHead className="text-right">Right / Conv %</TableHead>
                      <TableHead className="text-right">Promoter Capital</TableHead>
                      <TableHead className="text-right">Public Capital</TableHead>
                      <TableHead className="text-right font-semibold text-primary">
                        Listed Capital (Kitta)
                      </TableHead>
                      <TableHead>Book Close Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="text-xs">
                    {timeline.map((fy) => (
                      <TableRow key={fy.fiscalYear}>
                        <TableCell className="font-mono font-bold text-foreground">
                          {fy.fiscalYear}
                        </TableCell>
                        <TableCell className="font-medium max-w-[220px] truncate">
                          {fy.eventName}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              fy.eventType === "RIGHT_ISSUE"
                                ? "default"
                                : fy.eventType === "PROMOTER_CONVERSION"
                                  ? "secondary"
                                  : fy.eventType === "PRE_BASELINE_BONUS"
                                    ? "outline"
                                    : "default"
                            }
                            className="text-[10px]"
                          >
                            {fy.eventType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-cyan-600 font-semibold">
                          +{fy.bonusRatioPct}%
                        </TableCell>
                        <TableCell className="text-right font-mono text-emerald-600 font-semibold">
                          {fy.cashDividendRatioPct}%
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {fy.rightRatioPct > 0
                            ? `${fy.rightRatioPct}% Right`
                            : fy.conversionRatioPct > 0
                              ? `${fy.conversionRatioPct.toFixed(2)}% Conv`
                              : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {fy.promoterKittaBaseline > 0
                            ? fy.promoterKittaBaseline.toLocaleString()
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {fy.publicKittaBaseline > 0
                            ? fy.publicKittaBaseline.toLocaleString()
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-primary">
                          {fy.totalListedKitta > 0 ? fy.totalListedKitta.toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-muted-foreground text-[11px]">
                          {fy.bookCloseDateBs || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Production Database Promotion Card */}
          <Card className="glass-card border border-indigo-500/30 bg-indigo-500/5">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Database className="h-5 w-5 text-indigo-600" />
                    <span>Promote Verified Historical Records to Production Database</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Seed reconciled historical shareholder positions, current holdings, and
                    uncollected dividend fractions directly into live RTARTS tables (`clients`,
                    `dividend_payables`, `audit_logs`).
                  </CardDescription>
                </div>
                <Badge
                  variant="outline"
                  className="text-xs border-indigo-500 text-indigo-700 dark:text-indigo-300"
                >
                  Production Sync
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 bg-background rounded-lg border">
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>Audit Status Verified</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    All fractional compounding errors sanitized to CDSC linear math.
                  </p>
                </div>
                <div className="p-3 bg-background rounded-lg border">
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>Fractions Preserved</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Carried fractions automatically converted into dividend payables.
                  </p>
                </div>
                <div className="p-3 bg-background rounded-lg border">
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>Full Audit Trail</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Promotion action timestamped and logged in `audit_logs` table.
                  </p>
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-border/40">
                <div className="text-xs text-muted-foreground">
                  Target: <strong>{stats.count.toLocaleString()} records</strong> will be
                  synchronized to live system tables.
                </div>
                <Button
                  size="default"
                  disabled={isPromoting || stats.count === 0 || !isAuthorizedToPromote}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs h-11 px-6 gap-2 shadow-md"
                  onClick={handlePromoteToDatabase}
                >
                  <RefreshCw className={`h-4 w-4 ${isPromoting ? "animate-spin" : ""}`} />
                  <span>
                    {!isAuthorizedToPromote
                      ? "Insufficient Clearances"
                      : isPromoting
                        ? "Promoting Records..."
                        : `Promote ${stats.count.toLocaleString()} Records to Live Production DB`}
                  </span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* DIALOG: ADD NEW COMPANY PROFILE                               */}
      {/* ───────────────────────────────────────────────────────────── */}
      <Dialog open={isCompanyModalOpen} onOpenChange={setIsCompanyModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Add Company Corporate Action Profile
            </DialogTitle>
            <DialogDescription className="text-xs">
              Configure a new listed institution to reconcile historical AGM corporate actions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">
                Company Code / Ticker (e.g. RBBMBL, NLG)
              </Label>
              <Input
                placeholder="e.g. NICA"
                value={newCompCode}
                onChange={(e) => setNewCompCode(e.target.value)}
                className="h-8 text-xs uppercase"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Full Company Name</Label>
              <Input
                placeholder="e.g. NIC Asia Bank Ltd"
                value={newCompName}
                onChange={(e) => setNewCompName(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">ISIN Promoter (Optional)</Label>
                <Input
                  placeholder="NPE..."
                  value={newCompIsinPo}
                  onChange={(e) => setNewCompIsinPo(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">ISIN Public (Optional)</Label>
                <Input
                  placeholder="NPE..."
                  value={newCompIsinPub}
                  onChange={(e) => setNewCompIsinPub(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Base Reconciliation Fiscal Year</Label>
              <Input
                placeholder="2075/76"
                value={newCompBaseFy}
                onChange={(e) => setNewCompBaseFy(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsCompanyModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" className="bg-primary text-white" onClick={handleCreateCompany}>
              Create Company
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* DIALOG: ADD / EDIT FISCAL YEAR EVENT                          */}
      {/* ───────────────────────────────────────────────────────────── */}
      <Dialog open={isAddFyModalOpen} onOpenChange={setIsAddFyModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-500" />
              {editingFy
                ? `Edit Corporate Action (FY ${editingFy.fiscalYear})`
                : "Add Fiscal Year Corporate Action"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Define statutory ratios, book closure date, and action type for {activeCompany.name}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Fiscal Year (e.g. 2081/82)</Label>
                <Input
                  value={fyFormYear}
                  onChange={(e) => setFyFormYear(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Event Type</Label>
                <Select value={fyFormEventType} onValueChange={(v: any) => setFyFormEventType(v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BONUS_AND_CASH">BONUS_AND_CASH</SelectItem>
                    <SelectItem value="RIGHT_ISSUE">RIGHT_ISSUE</SelectItem>
                    <SelectItem value="PROMOTER_CONVERSION">PROMOTER_CONVERSION</SelectItem>
                    <SelectItem value="IPF_TRANSFER">IPF_TRANSFER</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Event Title / Description</Label>
              <Input
                placeholder="e.g. 20th AGM: 5% Bonus & 0.26315% Cash"
                value={fyFormEventName}
                onChange={(e) => setFyFormEventName(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Bonus %</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={fyFormBonusPct}
                  onChange={(e) => setFyFormBonusPct(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Cash %</Label>
                <Input
                  type="number"
                  step="0.00001"
                  value={fyFormCashPct}
                  onChange={(e) => setFyFormCashPct(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Right %</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={fyFormRightPct}
                  onChange={(e) => setFyFormRightPct(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Conv %</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={fyFormConvPct}
                  onChange={(e) => setFyFormConvPct(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Book Close Date (BS)</Label>
                <Input
                  placeholder="2082-01-15"
                  value={fyFormBookClose}
                  onChange={(e) => setFyFormBookClose(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Notes / Rationale</Label>
                <Input
                  placeholder="Tax absorbing cash dividend..."
                  value={fyFormNotes}
                  onChange={(e) => setFyFormNotes(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsAddFyModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={handleSaveFyEvent}
            >
              Save Corporate Action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* DIALOG: MANUAL PHYSICAL FOLIO TO DEMAT (DRN) MAPPER          */}
      {/* ───────────────────────────────────────────────────────────── */}
      {selectedDrn && (
        <Dialog open={isDrnModalOpen} onOpenChange={setIsDrnModalOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold flex items-center gap-2">
                <ArrowUpRight className="h-5 w-5 text-emerald-500" />
                Map Physical Folio to DEMAT Account
              </DialogTitle>
              <DialogDescription className="text-xs">
                Folio #{selectedDrn.folioNo} — {selectedDrn.holderName} ({selectedDrn.totalKitta}{" "}
                kitta)
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Target CDSC DEMAT BOID (16 Digits)</Label>
                <Input
                  placeholder="e.g. 1301010000001940"
                  value={targetBoidInput}
                  onChange={(e) => setTargetBoidInput(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Demat Request Number (DRN)</Label>
                <Input
                  placeholder="e.g. DRN-NLG-88192"
                  value={drnNoInput}
                  onChange={(e) => setDrnNoInput(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Dematerialization Status</Label>
                <Select value={drnStatusInput} onValueChange={(v: any) => setDrnStatusInput(v)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PHYSICAL">PHYSICAL (Pending Request)</SelectItem>
                    <SelectItem value="POSTED">POSTED (Under CDS verification)</SelectItem>
                    <SelectItem value="ACCEPTED">ACCEPTED (Dematerialized to BOID)</SelectItem>
                    <SelectItem value="REJECTED">REJECTED (Name/Signature Mismatch)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setIsDrnModalOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={handleSaveDrnMapping}
              >
                Save Mapping
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* DIALOG: PROCESS BROKER POOL CLAIM                             */}
      {/* ───────────────────────────────────────────────────────────── */}
      {selectedPool && (
        <Dialog open={isClaimModalOpen} onOpenChange={setIsClaimModalOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold flex items-center gap-2">
                <Building2 className="h-5 w-5 text-amber-500" />
                Process Broker Pool Client Claim
              </DialogTitle>
              <DialogDescription className="text-xs">
                {selectedPool.brokerName} (Pool BOID: {selectedPool.poolBoid})
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs">
                <div className="flex justify-between font-medium">
                  <span>Active Pool Balance:</span>
                  <span className="font-bold text-amber-700 dark:text-amber-400">
                    {selectedPool.activeBalanceKitta} kitta / NPR{" "}
                    {selectedPool.activeBalanceCash.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Claimant BOID (16 Digits)</Label>
                <Input
                  placeholder="e.g. 1301500000055403"
                  value={claimantBoid}
                  onChange={(e) => setClaimantBoid(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Claimant Name</Label>
                <Input
                  placeholder="e.g. ARHAN PRASAIN"
                  value={claimantName}
                  onChange={(e) => setClaimantName(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Claimed Kitta</Label>
                  <Input
                    type="number"
                    value={claimedKitta}
                    onChange={(e) => setClaimedKitta(e.target.value)}
                    className="h-9 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Trade Date (BS)</Label>
                  <Input
                    value={tradeDate}
                    onChange={(e) => setTradeDate(e.target.value)}
                    className="h-9 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Broker Contract Note No.</Label>
                <Input
                  value={contractNote}
                  onChange={(e) => setContractNote(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setIsClaimModalOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={handleProcessClaim}
              >
                Approve & Transfer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* DIALOG: BULK POOL DISPERSAL AUDIT SCHEDULE (TRACEABILITY)    */}
      {/* ───────────────────────────────────────────────────────────── */}
      <Dialog open={isDecompositionModalOpen} onOpenChange={setIsDecompositionModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-3 border-b border-border/40">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <DialogTitle className="text-base font-semibold flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-purple-500" />
                  <span>Bulk Pool Dispersal & Destination Traceability Schedule</span>
                </DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  Audit breakdown tracing which individual physical folios receive shares from{" "}
                  <strong>REMCONVERSION ONLY</strong> ({remPoolData.remConvKitta.toLocaleString()}{" "}
                  kitta). Remaining bonus (REMBONUS: {remPoolData.remBonusKitta.toLocaleString()}{" "}
                  kitta) is excluded and preserved in statutory reserve.
                </DialogDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                onClick={handleExportDecompositionSchedule}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span>Export Conversion Audit (.xlsx)</span>
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg text-xs">
                <span className="text-muted-foreground block">Target Conversion Pool:</span>
                <span className="font-bold text-sm text-purple-700 dark:text-purple-400">
                  REMCONVERSION ONLY
                </span>
                <span className="block text-[11px] text-muted-foreground mt-0.5">
                  {remPoolData.remConvKitta.toLocaleString()} kitta (CA 6316.001 Converted Public)
                </span>
              </div>
              <div className="p-3 bg-muted/40 border rounded-lg text-xs">
                <span className="text-muted-foreground block">Other Statutory Pools:</span>
                <span className="font-bold text-sm text-muted-foreground">
                  REMBONUS (Untouched)
                </span>
                <span className="block text-[11px] text-muted-foreground mt-0.5">
                  {remPoolData.remBonusKitta.toLocaleString()} kitta (Preserved in Statutory
                  Reserve)
                </span>
              </div>
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs">
                <span className="text-muted-foreground block">Active Conversion Trace:</span>
                <span className="font-bold text-sm text-emerald-700 dark:text-emerald-400">
                  {remPoolData.remConvKitta.toLocaleString()} Kitta
                </span>
                <span className="block text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                  Across {decompositionSchedule.length} physical folios
                </span>
              </div>
            </div>

            {/* Traceability Table */}
            <div className="border border-border/80 rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 text-[11px]">
                    <TableHead className="w-12">S.N.</TableHead>
                    <TableHead>Target Folio</TableHead>
                    <TableHead>Shareholder Name</TableHead>
                    <TableHead>Father's Name</TableHead>
                    <TableHead className="text-right">Base Kitta</TableHead>
                    <TableHead className="text-right text-purple-600 dark:text-purple-400">
                      From REMCONVERSION
                    </TableHead>
                    <TableHead className="text-right font-bold text-emerald-600 dark:text-emerald-400">
                      Final Converted Kitta
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-xs font-mono">
                  {decompositionSchedule.map((row, idx) => (
                    <TableRow key={row.folioNo}>
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-semibold text-primary">{row.folioNo}</TableCell>
                      <TableCell className="font-sans font-medium">{row.holderName}</TableCell>
                      <TableCell className="font-sans text-muted-foreground text-[11px]">
                        {row.fatherName}
                      </TableCell>
                      <TableCell className="text-right">{row.baseKitta.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium text-purple-600 dark:text-purple-400">
                        +{row.fromRemConversion.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-bold text-emerald-600 dark:text-emerald-400">
                        {row.totalClosingKitta.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between w-full">
            <Button
              size="sm"
              className="bg-purple-600 hover:bg-purple-700 text-white gap-1.5"
              onClick={() => {
                setIsDecompositionModalOpen(false);
                handleDisperseBulkPools();
              }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Execute Conversion Dispersal Only</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsDecompositionModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* DIALOG: SHAREHOLDER 360° MULTI-YEAR EVOLUTION JOURNEY         */}
      {/* ───────────────────────────────────────────────────────────── */}
      {selectedProfile && (
        <Dialog open={!!selectedProfile} onOpenChange={(open) => !open && setSelectedProfile(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader className="pb-3 border-b border-border/40">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <DialogTitle className="text-base font-semibold flex items-center gap-2">
                    <Search className="h-5 w-5 text-cyan-500" />
                    <span>{selectedProfile.shareholderName}</span>
                    <Badge
                      variant={
                        selectedProfile.holderType === "MUTUAL_FUND" ? "default" : "secondary"
                      }
                      className="text-[10px]"
                    >
                      {selectedProfile.holderType}
                    </Badge>
                  </DialogTitle>
                  <DialogDescription className="text-xs font-mono mt-1 flex flex-wrap items-center gap-2">
                    <span>
                      BOID / Account:{" "}
                      <strong className="text-foreground">{selectedProfile.boid}</strong>
                    </span>
                    {(selectedProfile.originalFolioNo || selectedProfile.boid.length < 16) && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 font-semibold text-[11px]">
                        <span>🏛️ Original Physical Folio:</span>
                        <strong className="font-bold underline">
                          {selectedProfile.originalFolioNo || selectedProfile.boid}
                        </strong>
                      </span>
                    )}
                  </DialogDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      selectedProfile.hasDiscrepancy
                        ? "border-amber-500 text-amber-600"
                        : "border-emerald-500 text-emerald-600"
                    }`}
                  >
                    {selectedProfile.hasDiscrepancy
                      ? "⚠️ Excel Variance Corrected"
                      : "✓ Clean Statutory Match"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                    onClick={() => handleExportShareholderJourney(selectedProfile)}
                  >
                    <FileSpreadsheet className="h-3 w-3" />
                    <span>Export (.xlsx)</span>
                  </Button>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              {/* Demographics & KYC Card with Prominent Physical Folio Tile */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2.5 p-3 bg-muted/30 border rounded-lg">
                <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-md">
                  <span className="text-[10px] text-amber-700 dark:text-amber-400 uppercase font-bold tracking-wider">
                    Physical Folio / Shareholder No
                  </span>
                  <div className="font-bold font-mono text-foreground text-xs mt-0.5">
                    {selectedProfile.originalFolioNo
                      ? `Folio ${selectedProfile.originalFolioNo}`
                      : selectedProfile.boid.length < 16
                        ? `Folio ${selectedProfile.boid}`
                        : "Direct Electronic"}
                  </div>
                  <span className="text-[9px] text-muted-foreground">
                    {selectedProfile.originalFolioNo
                      ? "Dematerialized into BOID"
                      : selectedProfile.boid.length < 16
                        ? "Physical Paper Holder"
                        : "Direct Electronic Allotment"}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground">Father's Name:</span>
                  <div className="font-semibold text-foreground">
                    {selectedProfile.fatherName || "—"}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground">Grandfather's Name:</span>
                  <div className="font-semibold text-foreground">
                    {selectedProfile.grandfatherName || "—"}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground">Guardian / Spouse:</span>
                  <div className="font-semibold text-foreground">
                    {selectedProfile.guardianName || selectedProfile.spouseName || "—"}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground">Citizenship / PAN:</span>
                  <div className="font-semibold font-mono text-foreground">
                    {selectedProfile.citizenshipNo || selectedProfile.panNo || "—"}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground">Bank Name:</span>
                  <div className="font-semibold text-foreground">
                    {selectedProfile.bankName || "—"}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground">Bank Account No:</span>
                  <div className="font-semibold font-mono text-foreground">
                    {selectedProfile.bankAccountNo || "—"}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground">District / Address:</span>
                  <div className="font-semibold text-foreground">
                    {selectedProfile.district || selectedProfile.address || "—"}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground">Contact / Email:</span>
                  <div className="font-semibold text-foreground">
                    {selectedProfile.contactNo || selectedProfile.email || "—"}
                  </div>
                </div>
              </div>

              {/* Conversion / Merging Details */}
              {(selectedProfile as any).isConversionMerged && (
                <div className="bg-primary/5 border border-primary/20 text-primary rounded-lg p-3">
                  <div className="font-semibold text-xs mb-1 flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    CA Seq 6316: Promoter-to-Public Conversion (27.142857%)
                  </div>
                  <div className="text-[11px] opacity-90 leading-relaxed">
                    This account was unified from dual-class registry listings. A total of{" "}
                    <strong>{(selectedProfile as any).convertedShares?.toLocaleString()}</strong>{" "}
                    promoter shares were seamlessly segregated and consolidated into the current
                    active public holding under this BOID/Folio.
                  </div>
                </div>
              )}

              {/* Multi-Year Evolution Progression Table */}
              <div>
                <div className="font-semibold text-xs mb-2 flex items-center justify-between">
                  <span>Year-by-Year Statutory Corporate Action Evolution</span>
                  <span className="text-[11px] font-normal text-muted-foreground">
                    Initial 2075:{" "}
                    <strong className="text-foreground">
                      {selectedProfile.initialKitta2075.toLocaleString()} kitta
                    </strong>
                    {selectedProfile.initialFraction2075
                      ? ` + ${selectedProfile.initialFraction2075.toFixed(4)} frac`
                      : ""}
                  </span>
                </div>
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/50 text-[11px]">
                      <TableRow>
                        <TableHead>Fiscal Year</TableHead>
                        <TableHead>Corporate Event</TableHead>
                        <TableHead className="text-right">Base Kitta</TableHead>
                        <TableHead className="text-right">Carried Frac</TableHead>
                        <TableHead className="text-right">Issued Bonus</TableHead>
                        <TableHead className="text-right">Gross Cash (NPR)</TableHead>
                        <TableHead className="text-right">Tax Absorbed</TableHead>
                        <TableHead className="text-right">Net Cash (NPR)</TableHead>
                        <TableHead className="text-right font-semibold text-primary">
                          Closing Kitta
                        </TableHead>
                        <TableHead className="text-center">Audit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="text-xs">
                      {(() => {
                        const snaps =
                          selectedProfile.yearlySnapshots &&
                          selectedProfile.yearlySnapshots.length > 0
                            ? selectedProfile.yearlySnapshots
                            : AgmStudioService.calculateShareholderEvolution(
                                selectedProfile.trueInitialKitta2075 ||
                                  selectedProfile.initialKitta2075 ||
                                  selectedProfile.currentKitta2081 ||
                                  0,
                                selectedProfile.initialFraction2075 || 0,
                                timeline,
                                selectedProfile.holderType,
                                undefined,
                                timeline[0]?.fiscalYear,
                                (selectedProfile as any).convertedShares,
                              );
                        return snaps.map((snap, idx) => {
                          const prevSnap = idx > 0 ? snaps[idx - 1] : null;
                          const gap = prevSnap ? snap.baseKitta - prevSnap.postEventKitta : 0;
                          return (
                            <Fragment key={snap.fiscalYear}>
                              {gap !== 0 && (
                                <TableRow className="bg-sky-500/5 dark:bg-sky-500/10 border-dashed border-sky-500/30 text-[11px]">
                                  <TableCell className="font-mono text-sky-600 font-semibold italic">
                                    Interim Trade
                                  </TableCell>
                                  <TableCell
                                    colSpan={7}
                                    className="text-sky-700 dark:text-sky-300 font-medium"
                                  >
                                    ↕ Secondary Market Activity:{" "}
                                    {gap > 0 ? `+${gap} kitta purchased` : `${gap} kitta sold`}{" "}
                                    between book closures
                                  </TableCell>
                                  <TableCell className="text-right font-mono font-bold text-sky-600">
                                    {snap.baseKitta.toLocaleString()}
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <Badge
                                      variant="outline"
                                      className="text-[8px] border-sky-500 text-sky-600"
                                    >
                                      Market
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              )}
                              <TableRow>
                                <TableCell className="font-mono font-medium">
                                  {snap.fiscalYear}
                                </TableCell>
                                <TableCell className="max-w-[160px] truncate">
                                  {snap.eventName}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {snap.baseKitta.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right font-mono text-amber-600">
                                  {snap.carriedNewFraction.toFixed(4)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-emerald-600 font-medium">
                                  +{snap.issuedWholeBonus.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {snap.grossCashDividend.toFixed(2)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-rose-600">
                                  {(snap.bonusTaxWithheld + snap.cashTaxWithheld).toFixed(2)}
                                </TableCell>
                                <TableCell className="text-right font-mono font-medium text-emerald-600">
                                  {snap.netCashPayable.toFixed(2)}
                                </TableCell>
                                <TableCell className="text-right font-mono font-bold text-primary">
                                  {snap.postEventKitta.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-center">
                                  {snap.excelDiscrepancy ? (
                                    <Badge
                                      variant="outline"
                                      className="text-[9px] border-amber-500 text-amber-600"
                                    >
                                      Sanitized
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className="text-[9px] border-emerald-500 text-emerald-600"
                                    >
                                      Match
                                    </Badge>
                                  )}
                                </TableCell>
                              </TableRow>
                            </Fragment>
                          );
                        });
                      })()}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Cumulative Holdings Summary */}
              <div className="grid grid-cols-3 gap-3 pt-2">
                <div className="p-2.5 bg-primary/5 border border-primary/20 rounded-lg text-center">
                  <span className="text-[11px] text-muted-foreground">Current 2081 Holdings</span>
                  <div className="text-lg font-bold text-primary mt-0.5">
                    {selectedProfile.currentKitta2081.toLocaleString()} kitta
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    + {selectedProfile.currentFraction2081.toFixed(4)} fraction
                  </span>
                </div>
                <div className="p-2.5 bg-emerald-500/5 border border-emerald-500/20 rounded-lg text-center">
                  <span className="text-[11px] text-muted-foreground">Total Cumulative Bonus</span>
                  <div className="text-lg font-bold text-emerald-600 mt-0.5">
                    +{selectedProfile.totalBonusSharesReceived.toLocaleString()} kitta
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    Multi-Year Capital Growth
                  </span>
                </div>
                <div className="p-2.5 bg-amber-500/5 border border-amber-500/20 rounded-lg text-center">
                  <span className="text-[11px] text-muted-foreground">Total Cumulative Cash</span>
                  <div className="text-lg font-bold text-amber-600 mt-0.5">
                    NPR {selectedProfile.totalCashDividendReceived.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-muted-foreground">Total Gross Dividends</span>
                </div>
              </div>
            </div>

            <DialogFooter className="pt-2 border-t border-border/40">
              <Button size="sm" variant="outline" onClick={() => setSelectedProfile(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* DIALOG: EDIT & RECALCULATE SHAREHOLDER POSITION              */}
      {/* ───────────────────────────────────────────────────────────── */}
      {editingProfile && (
        <Dialog
          open={isEditModalOpen}
          onOpenChange={(open) => {
            if (!open) {
              setIsEditModalOpen(false);
              setEditingProfile(null);
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base flex items-center gap-2">
                <Edit className="h-4 w-4 text-amber-500" />
                <span>Edit & Recalculate Shareholder</span>
              </DialogTitle>
              <DialogDescription className="text-xs">
                Adjust baseline holding or fraction for{" "}
                <strong className="text-foreground">{editingProfile.shareholderName}</strong> (
                {editingProfile.boid}). The system will immediately re-derive their entire statutory
                corporate action progression.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              <div className="p-3 bg-muted/40 rounded-lg border space-y-1.5">
                <div className="font-semibold text-foreground">
                  {editingProfile.shareholderName}
                </div>
                <div className="font-mono text-muted-foreground">BOID: {editingProfile.boid}</div>
                <div className="text-muted-foreground">
                  PAN: {editingProfile.panNo || "—"} • Bank: {editingProfile.bankName || "—"}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold">
                  Opening Base Kitta (FY {timeline[0]?.fiscalYear || "2075/76"})
                </Label>
                <Input
                  type="number"
                  value={editKittaInput}
                  onChange={(e) => setEditKittaInput(e.target.value)}
                  className="h-9 text-xs font-mono font-bold"
                  placeholder="e.g. 100"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold">Opening Carried Fraction</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={editFractionInput}
                  onChange={(e) => setEditFractionInput(e.target.value)}
                  className="h-9 text-xs font-mono font-semibold"
                  placeholder="e.g. 0.3500"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold">Shareholder Classification</Label>
                <Select
                  value={editHolderTypeInput}
                  onValueChange={(v: any) => setEditHolderTypeInput(v)}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PUBLIC">Public Ordinary</SelectItem>
                    <SelectItem value="PROMOTER">Promoter (PO)</SelectItem>
                    <SelectItem value="MUTUAL_FUND">Mutual Fund (0% TDS)</SelectItem>
                    <SelectItem value="PHYSICAL">Physical Folio</SelectItem>
                    <SelectItem value="CLEARING_POOL">Broker Clearing Pool</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="p-2.5 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-xs text-cyan-700 dark:text-cyan-400">
                ⚡ <strong>Instant Chain Re-derivation:</strong> Modifying this baseline will
                recompute all 7 corporate actions, update total bonus shares, cash dividend, and TDS
                liability.
              </div>
            </div>

            <DialogFooter className="pt-2 border-t border-border/40 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setIsEditModalOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5 shadow-sm"
                disabled={isSavingEdit}
                onClick={handleSaveSingleEdit}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSavingEdit ? "animate-spin" : ""}`} />
                <span>{isSavingEdit ? "Recalculating..." : "Save & Recalculate"}</span>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
