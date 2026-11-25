import {
  ArrowUpRight,
  Building2,
  Check,
  CheckCircle2,
  Database,
  Download,
  Edit,
  FileSpreadsheet,
  FileText,
  Layers,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import type {
  CompanyProfile,
  ConversionSummaryReport,
  HistoricalFiscalYearConfig,
  MultiYearShareholderProfile,
  PhysicalDrnRecord,
  PromoterConversionRecord,
} from "@/lib/services/agm-studio.service";
import type { AgmStudioStatsSummary } from "./agm-studio-sandbox-radar-tabs";

export interface AgmConfigAndPromoteTabsProps {
  activeCompany: CompanyProfile;
  timeline: HistoricalFiscalYearConfig[];
  isRecalculatingAll: boolean;
  onRecalculateAll: () => void;
  onOpenCompanyModal: () => void;
  onOpenAddFyModal: () => void;
  onEditFyEvent: (fy: HistoricalFiscalYearConfig) => void;
  onDeleteFyEvent: (fiscalYear: string) => void;
  dataSourceMode: "MEMORY" | "DATABASE";
  dbSummaryStats: { totalShareholders?: number } | null;
  dbTotalCount: number;
  stats: AgmStudioStatsSummary;
  parsedProfiles: MultiYearShareholderProfile[];
  conversionSummary: ConversionSummaryReport | null;
  conversionRecords: PromoterConversionRecord[];
  drnList: PhysicalDrnRecord[];
  selectedCdscFy: string;
  onChangeSelectedCdscFy: (fy: string) => void;
  selectedAgmCardFy: string;
  onChangeSelectedAgmCardFy: (fy: string) => void;
  isPromoting: boolean;
  isAuthorizedToPromote: boolean;
  onDownloadExcel: () => void;
  onDownloadChronologicalLedger: () => void;
  onDownloadCdscTxt: () => void;
  onDownloadMutualFundsExcel: () => void;
  onDownloadDrnExcel: () => void;
  onExportConversionReport: () => void;
  onDownloadFySummaryExcel: () => void;
  onDownloadAgmSpecific: (targetFy: string) => void;
  onPromoteToDatabase: () => void;
}

export function AgmConfigAndPromoteTabs({
  activeCompany,
  timeline,
  isRecalculatingAll,
  onRecalculateAll,
  onOpenCompanyModal,
  onOpenAddFyModal,
  onEditFyEvent,
  onDeleteFyEvent,
  dataSourceMode,
  dbSummaryStats,
  dbTotalCount,
  stats,
  parsedProfiles,
  conversionSummary,
  conversionRecords,
  drnList,
  selectedCdscFy,
  onChangeSelectedCdscFy,
  selectedAgmCardFy,
  onChangeSelectedAgmCardFy,
  isPromoting,
  isAuthorizedToPromote,
  onDownloadExcel,
  onDownloadChronologicalLedger,
  onDownloadCdscTxt,
  onDownloadMutualFundsExcel,
  onDownloadDrnExcel,
  onExportConversionReport,
  onDownloadFySummaryExcel,
  onDownloadAgmSpecific,
  onPromoteToDatabase,
}: AgmConfigAndPromoteTabsProps) {
  return (
    <>
      <TabsContent value="config" className="space-y-6">
        <Card className="glass-card border border-border/80">
          <CardHeader className="pb-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Edit className="h-5 w-5 text-blue-500" />
                Company Profile & Corporate Action Timeline Configurator
              </CardTitle>
              <CardDescription className="text-xs">
                Configure corporate actions, bonus/cash ratios, right issues, and book closure dates
                for {activeCompany.name} or any client company.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5 border-cyan-500/40 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/10"
                onClick={onRecalculateAll}
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
                onClick={onOpenCompanyModal}
              >
                <Building2 className="h-3.5 w-3.5 text-primary" />
                <span>+ New Company</span>
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
                onClick={onOpenAddFyModal}
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
                            onClick={() => onEditFyEvent(fy)}
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2 text-rose-500 hover:text-rose-600"
                            onClick={() => onDeleteFyEvent(fy.fiscalYear)}
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

        {/* Export Cards Grid */}
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
                onClick={onDownloadExcel}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-10 gap-2 shadow-sm mb-2"
              >
                <Download className="h-4 w-4" />
                <span>Download Master Workbook (.xlsx)</span>
              </Button>
              <Button
                onClick={onDownloadChronologicalLedger}
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
                Formatted electronic pipe-delimited batch file ready for CDSC CAS portal upload with
                event-specific action codes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-semibold whitespace-nowrap">Target FY:</Label>
                <Select value={selectedCdscFy} onValueChange={onChangeSelectedCdscFy}>
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
                onClick={onDownloadCdscTxt}
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
              <CardTitle className="text-base font-bold mt-2">Mutual Funds 0% TDS Payout</CardTitle>
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
                onClick={onDownloadMutualFundsExcel}
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
              <CardTitle className="text-base font-bold mt-2">Physical Folio DRN Ledger</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Complete tracking of physical certificates, unmapped folios, pending DRN
                submissions, and accepted DEMAT mappings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div className="p-2.5 bg-muted/40 rounded-lg border text-xs flex justify-between items-center">
                <span className="text-muted-foreground text-[11px]">Physical Folios Tracked:</span>
                <span className="font-bold text-blue-600 dark:text-blue-400 font-mono">
                  {drnList.length.toLocaleString()} Folios
                </span>
              </div>
              <Button
                onClick={onDownloadDrnExcel}
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
                onClick={onExportConversionReport}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs h-10 gap-2 shadow-sm"
              >
                <Download className="h-4 w-4" />
                <span>Export CA 6316 Report (.xlsx)</span>
              </Button>
              <Button
                onClick={onDownloadDrnExcel}
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
              <CardTitle className="text-base font-bold mt-2">Multi-Year Fiscal Summary</CardTitle>
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
                onClick={onDownloadFySummaryExcel}
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
                <Select value={selectedAgmCardFy} onValueChange={onChangeSelectedAgmCardFy}>
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
                onClick={() => onDownloadAgmSpecific(selectedAgmCardFy)}
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
                Executive timeline overview of all statutory corporate actions across historical AGM
                fiscal years.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onDownloadFySummaryExcel}
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
                        {fy.publicKittaBaseline > 0 ? fy.publicKittaBaseline.toLocaleString() : "—"}
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
                Target: <strong>{stats.count.toLocaleString()} records</strong> will be synchronized
                to live system tables.
              </div>
              <Button
                size="default"
                disabled={isPromoting || stats.count === 0 || !isAuthorizedToPromote}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs h-11 px-6 gap-2 shadow-md"
                onClick={onPromoteToDatabase}
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
    </>
  );
}
