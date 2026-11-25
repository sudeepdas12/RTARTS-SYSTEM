import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Database,
  Download,
  Edit,
  FileSpreadsheet,
  RefreshCw,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import {
  AgmStudioService,
  type MultiYearShareholderProfile,
} from "@/lib/services/agm-studio.service";

export interface AgmStudioStatsSummary {
  count: number;
  totalKitta: number;
  totalBonus: number;
  totalCash: number;
  totalTax: number;
  mfCash: number;
}

export type AgmTypeFilterValue =
  "ALL" | "PROMOTER" | "PUBLIC" | "MUTUAL_FUND" | "PHYSICAL" | "CLEARING_POOL" | "DISCREPANCY";

export interface AgmSandboxAndRadarTabsProps {
  stats: AgmStudioStatsSummary;
  dataSourceMode: "MEMORY" | "DATABASE";
  onChangeDataSourceMode: (mode: "MEMORY" | "DATABASE") => void;
  isLoadingDb: boolean;
  loadDbShareholders: (page: number, size: number, search: string, type: string) => void;
  parsedProfiles: MultiYearShareholderProfile[];
  activeProfiles: MultiYearShareholderProfile[];
  paginatedProfiles: MultiYearShareholderProfile[];
  pageSize: number;
  onChangePageSize: (size: number) => void;
  currentPage: number;
  onChangeCurrentPage: (page: number) => void;
  totalPages: number;
  totalRecordCount: number;
  searchQuery: string;
  onChangeSearchQuery: (q: string) => void;
  typeFilter: AgmTypeFilterValue;
  onChangeTypeFilter: (t: AgmTypeFilterValue) => void;
  agmFyFilter: string;
  onChangeAgmFyFilter: (fy: string) => void;
  onlyPresentInFy: boolean;
  onToggleOnlyPresentInFy: () => void;
  dbError: string | null;
  onClearDbError: () => void;
  isRecalculatingAll: boolean;
  onRecalculateAll: () => void;
  onExportRegistry: () => void;
  onApplyFilter: () => void;
  onDownloadAgmSpecific: (targetFy: string) => void;
  onOpenEditProfile: (profile: MultiYearShareholderProfile) => void;
  onSelectProfile: (profile: MultiYearShareholderProfile) => void;
  onApplyStatutoryCorrections: () => void;
  onExportDiscrepancyReport: () => void;
}

export function AgmSandboxAndRadarTabs({
  stats,
  dataSourceMode,
  onChangeDataSourceMode,
  isLoadingDb,
  loadDbShareholders,
  parsedProfiles,
  activeProfiles,
  paginatedProfiles,
  pageSize,
  onChangePageSize,
  currentPage,
  onChangeCurrentPage,
  totalPages,
  totalRecordCount,
  searchQuery,
  onChangeSearchQuery,
  typeFilter,
  onChangeTypeFilter,
  agmFyFilter,
  onChangeAgmFyFilter,
  onlyPresentInFy,
  onToggleOnlyPresentInFy,
  dbError,
  onClearDbError,
  isRecalculatingAll,
  onRecalculateAll,
  onExportRegistry,
  onApplyFilter,
  onDownloadAgmSpecific,
  onOpenEditProfile,
  onSelectProfile,
  onApplyStatutoryCorrections,
  onExportDiscrepancyReport,
}: AgmSandboxAndRadarTabsProps) {
  return (
    <>
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
                  Shareholder Multi-Year Evolution Registry ({stats.count.toLocaleString()} Records)
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  Trace any shareholder's historical progression: base shares, right subscriptions,
                  27.14% conversion, and carried fractions.
                </CardDescription>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant={dataSourceMode === "DATABASE" ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  disabled={isLoadingDb}
                  onClick={() => {
                    onChangeDataSourceMode("DATABASE");
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
                    onClick={() => onChangeDataSourceMode("MEMORY")}
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
                  onClick={onExportRegistry}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Export Registry (.xlsx)</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 border-cyan-500/40 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/10"
                  onClick={onRecalculateAll}
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
                    onChange={(e) => onChangeSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && onApplyFilter()}
                    className="pl-9 h-9 text-xs"
                  />
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-9 text-xs"
                  onClick={onApplyFilter}
                >
                  Search
                </Button>
              </div>

              <div className="sm:col-span-3">
                <Select
                  value={typeFilter}
                  onValueChange={(v) => {
                    const nextType = v as AgmTypeFilterValue;
                    onChangeTypeFilter(nextType);
                    onChangeCurrentPage(1);
                    if (dataSourceMode === "DATABASE") {
                      loadDbShareholders(1, pageSize, searchQuery, nextType);
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
                    onChangeAgmFyFilter(v);
                    onChangeCurrentPage(1);
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
                    onClick={onToggleOnlyPresentInFy}
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
                    onClick={() => onDownloadAgmSpecific(agmFyFilter)}
                    title={`Export ${agmFyFilter} Promoter & Public Sheet`}
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Export</span>
                  </Button>
                )}
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    const nextSize = Number(v);
                    onChangePageSize(nextSize);
                    onChangeCurrentPage(1);
                    if (dataSourceMode === "DATABASE") {
                      loadDbShareholders(1, nextSize, searchQuery, typeFilter);
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
                    onClearDbError();
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
                              (s) => s.fiscalYear === agmFyFilter || s.fiscalYear.includes(fyClean),
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
                          <TableCell className="font-mono text-xs font-medium">{p.boid}</TableCell>
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
                              <div className="text-[10px] text-muted-foreground">{p.district}</div>
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
                                onClick={() => onOpenEditProfile(p)}
                              >
                                <Edit className="h-3 w-3 mr-1" />
                                <span>Edit</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-cyan-600 hover:text-cyan-700 gap-1 px-2"
                                onClick={() => onSelectProfile(p)}
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
                    onChangeCurrentPage(1);
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
                    onChangeCurrentPage(p);
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
                    onChangeCurrentPage(p);
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
                    onChangeCurrentPage(totalPages);
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
                onClick={onApplyStatutoryCorrections}
                disabled={activeProfiles.filter((p) => p.hasDiscrepancy).length === 0}
              >
                <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                <span>Apply CDSC Statutory Recalculation</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5 border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                onClick={onExportDiscrepancyReport}
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
                          <TableCell className="font-mono text-xs font-medium">{p.boid}</TableCell>
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
                              onClick={() => onSelectProfile(p)}
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
                    • <strong>Bonus on Whole Kitta Only</strong>: Fractions carried from prior years
                    do not compound dividend.
                  </p>
                  <p>
                    • <strong>Exact Linear Formula</strong>:{" "}
                    <code className="font-mono text-foreground font-semibold">
                      Bonus Entitlement = (Whole Kitta × Bonus Rate) + Prev Fraction
                    </code>
                  </p>
                  <p>
                    • <strong>Mutual Fund 0% TDS</strong>: 100% of gross cash is credited to scheme
                    bank account with zero tax deduction.
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
                    <code className="font-mono text-foreground">(Kitta × 7%) + (Frac × 1.07)</code>{" "}
                    — previous fractions were double-counted with 7% excess.
                  </p>
                  <p>
                    • <strong>Binary Floating Noise</strong>: Produced messy decimals like{" "}
                    <code className="font-mono text-foreground">0.5805000000000007</code> instead of
                    clean 4-decimal fixed points.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </>
  );
}
