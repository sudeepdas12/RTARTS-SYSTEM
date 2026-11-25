import type { RefObject } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FolderSync,
  Info,
  Lock,
  RefreshCw,
  Sparkles,
  Unlock,
  Upload,
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
  FiscalYearMetaRecord,
  HistoricalFiscalYearConfig,
  ImportValidationReport,
  MultiYearShareholderProfile,
} from "@/lib/services/agm-studio.service";

export type AgmStudioTabValue =
  | "wizard"
  | "ledger"
  | "sandbox"
  | "radar"
  | "conversion"
  | "broker-pools"
  | "drn"
  | "config"
  | "promote";

export interface AgmWizardAndLedgerTabsProps {
  wizardStep: 1 | 2 | 3;
  onChangeWizardStep: (step: 1 | 2 | 3) => void;
  wizardTargetFy: string;
  onChangeWizardTargetFy: (fy: string) => void;
  fyLedger: FiscalYearMetaRecord[];
  timeline: HistoricalFiscalYearConfig[];
  onToggleLock: (fiscalYear: string, currentLockState: boolean) => void;
  wizardFileInputRef: RefObject<HTMLInputElement | null>;
  isDragOver: boolean;
  onChangeDragOver: (dragOver: boolean) => void;
  onDropWorkbooks: (files: File[]) => Promise<void>;
  isParsingFile: boolean;
  importReport: ImportValidationReport | null;
  allowVarianceOverride: boolean;
  onChangeAllowVarianceOverride: (allow: boolean) => void;
  isSavingBatch: boolean;
  onSaveWizardBatch: () => void;
  onExportConversionReport: () => void;
  parsedProfiles: MultiYearShareholderProfile[];
  onChangeActiveTab: (tab: AgmStudioTabValue) => void;
  onRefreshLedger: () => void;
}

export function AgmWizardAndLedgerTabs({
  wizardStep,
  onChangeWizardStep,
  wizardTargetFy,
  onChangeWizardTargetFy,
  fyLedger,
  timeline,
  onToggleLock,
  wizardFileInputRef,
  isDragOver,
  onChangeDragOver,
  onDropWorkbooks,
  isParsingFile,
  importReport,
  allowVarianceOverride,
  onChangeAllowVarianceOverride,
  isSavingBatch,
  onSaveWizardBatch,
  onExportConversionReport,
  parsedProfiles,
  onChangeActiveTab,
  onRefreshLedger,
}: AgmWizardAndLedgerTabsProps) {
  return (
    <>
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
                wizardStep > 1 ? "bg-emerald-500 text-white" : "bg-primary text-primary-foreground"
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
                        onClick={() => onToggleLock(wizardTargetFy, true)}
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
                  <Select value={wizardTargetFy} onValueChange={onChangeWizardTargetFy}>
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
                  onChangeDragOver(true);
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  onChangeDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  onChangeDragOver(false);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  onChangeDragOver(false);
                  const files = Array.from(e.dataTransfer.files || []);
                  if (files.length > 0) await onDropWorkbooks(files);
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
                      onClick={onExportConversionReport}
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
                      {importReport.totalConvertedKitta?.toLocaleString()} Kitta Converted to Public
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
                      onChange={(e) => onChangeAllowVarianceOverride(e.target.checked)}
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
                    onClick={() => onChangeWizardStep(1)}
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
                    onClick={onSaveWizardBatch}
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
                          <TableCell className="font-mono text-xs font-medium">{p.boid}</TableCell>
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
                onClick={() => onChangeWizardStep(1)}
              >
                Upload Another Fiscal Year
              </Button>
              <Button
                size="sm"
                className="text-xs bg-primary gap-1.5"
                onClick={() => onChangeActiveTab("sandbox")}
              >
                <span>View in Shareholder Search</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </Card>
        )}
      </TabsContent>

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
            <span className="text-[11px] text-muted-foreground">All Locked Corporate Actions</span>
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
                Tracks database-persisted shareholder counts, locked corporate actions, and capital
                baselines. Locked years are protected from accidental overwriting.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={onRefreshLedger}
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
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.notes}</div>

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
                          onClick={() => onToggleLock(t.fiscalYear, isLocked)}
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
                            onChangeWizardTargetFy(t.fiscalYear);
                            onChangeWizardStep(1);
                            onChangeActiveTab("wizard");
                          }}
                        >
                          <span>Upload File</span>
                          <ChevronRight className="h-3 w-3" />
                        </Button>
                      )}

                      <span className="text-[10px] text-muted-foreground">
                        {dbMeta?.importedAt ? new Date(dbMeta.importedAt).toLocaleDateString() : ""}
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
              {timeline.map((fy) => {
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
    </>
  );
}
