import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Edit,
  Eye,
  FileSpreadsheet,
  Filter,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
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
  type BrokerPoolClaim,
  type BrokerPoolRecord,
  type ConversionSummaryReport,
  type PhysicalDrnRecord,
  type PromoterConversionRecord,
} from "@/lib/services/agm-studio.service";

export type ConversionStatusFilter = "ALL" | "CONVERTED" | "PHYSICAL_PENDING" | "RECONCILED";
export type DrnStatusFilter = "ALL" | "PHYSICAL" | "POSTED" | "ACCEPTED" | "REJECTED";

export interface AgmConversionPoolsDrnTabsProps {
  conversionFileInputRef: RefObject<HTMLInputElement | null>;
  conversionRecords: PromoterConversionRecord[];
  onSetConversionRecords: (records: PromoterConversionRecord[]) => void;
  conversionSummary: ConversionSummaryReport | null;
  isParsingConversion: boolean;
  isSavingConversion: boolean;
  onSaveConversionToDb: () => void;
  onExportConversionLedger: () => void;
  convSearch: string;
  onChangeConvSearch: (s: string) => void;
  convStatusFilter: ConversionStatusFilter;
  onChangeConvStatusFilter: (s: ConversionStatusFilter) => void;
  convPage: number;
  onChangeConvPage: Dispatch<SetStateAction<number>>;
  convPageSize: number;
  filteredConversionRecords: PromoterConversionRecord[];
  paginatedConversionRecords: PromoterConversionRecord[];
  totalConvPages: number;
  pools: BrokerPoolRecord[];
  claims: BrokerPoolClaim[];
  onOpenClaimModal: (pool: BrokerPoolRecord) => void;
  drnSearch: string;
  onChangeDrnSearch: (s: string) => void;
  drnStatusFilter: DrnStatusFilter;
  onChangeDrnStatusFilter: (s: DrnStatusFilter) => void;
  drnPage: number;
  onChangeDrnPage: Dispatch<SetStateAction<number>>;
  drnPageSize: number;
  filteredDrnList: PhysicalDrnRecord[];
  paginatedDrnList: PhysicalDrnRecord[];
  totalDrnPages: number;
  onOpenDecompositionModal: () => void;
  onDisperseBulkPools: () => void;
  onAutoMatchDrn: () => void;
  onOpenDrnModal: (drn: PhysicalDrnRecord) => void;
}

export function AgmConversionPoolsDrnTabs({
  conversionFileInputRef,
  conversionRecords,
  onSetConversionRecords,
  conversionSummary,
  isParsingConversion,
  isSavingConversion,
  onSaveConversionToDb,
  onExportConversionLedger,
  convSearch,
  onChangeConvSearch,
  convStatusFilter,
  onChangeConvStatusFilter,
  convPage,
  onChangeConvPage,
  convPageSize,
  filteredConversionRecords,
  paginatedConversionRecords,
  totalConvPages,
  pools,
  claims,
  onOpenClaimModal,
  drnSearch,
  onChangeDrnSearch,
  drnStatusFilter,
  onChangeDrnStatusFilter,
  drnPage,
  onChangeDrnPage,
  drnPageSize,
  filteredDrnList,
  paginatedDrnList,
  totalDrnPages,
  onOpenDecompositionModal,
  onDisperseBulkPools,
  onAutoMatchDrn,
  onOpenDrnModal,
}: AgmConversionPoolsDrnTabsProps) {
  return (
    <>
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
                Promoter retained and ~95% Public ordinary shares while preserving floating fraction
                residue.
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
                onClick={onSaveConversionToDb}
                disabled={isSavingConversion || conversionRecords.length === 0}
              >
                <Lock className="h-3.5 w-3.5" />
                <span>{isSavingConversion ? "Saving to DB..." : "Save & Lock CA 6316 to DB"}</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5 border-purple-500/40 text-purple-600 dark:text-purple-400 hover:bg-purple-500/10"
                onClick={onExportConversionLedger}
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
                    onChangeConvSearch(e.target.value);
                    onChangeConvPage(1);
                  }}
                  className="pl-9 h-9 text-xs"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Select
                  value={convStatusFilter}
                  onValueChange={(v) => {
                    onChangeConvStatusFilter(v as ConversionStatusFilter);
                    onChangeConvPage(1);
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
                        className="text-center py-10 text-muted-foreground text-xs"
                      >
                        <div className="space-y-2">
                          <p className="font-medium text-foreground/80">
                            No promoter conversion records found for this company.
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Upload a CDSC CA 6316 conversion workbook or load the demo dataset to
                            preview functionality.
                          </p>
                          <div className="flex justify-center gap-2 pt-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1"
                              onClick={() => conversionFileInputRef.current?.click()}
                            >
                              <Upload className="h-3 w-3" />
                              <span>Upload Excel</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/20"
                              onClick={() => {
                                const sample = AgmStudioService.getSamplePromoterConversions();
                                onSetConversionRecords(sample);
                                toast.info("Loaded sample dataset for testing.");
                              }}
                            >
                              <Sparkles className="h-3 w-3 text-amber-500" />
                              <span>Load Demo Data</span>
                            </Button>
                          </div>
                        </div>
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
                          {r.publicConvertedFrac > 0 ? `+ ${r.publicConvertedFrac.toFixed(4)}` : ""}
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
                  onClick={() => onChangeConvPage(1)}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={convPage === 1}
                  onClick={() => onChangeConvPage((p) => Math.max(1, p - 1))}
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
                  onClick={() => onChangeConvPage((p) => Math.min(totalConvPages, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={convPage === totalConvPages}
                  onClick={() => onChangeConvPage(totalConvPages)}
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="broker-pools" className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {pools.map((pool) => (
            <Card key={pool.poolBoid} className="glass-card border border-border/80 p-4 space-y-3">
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
                onClick={() => onOpenClaimModal(pool)}
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
                onClick={onOpenDecompositionModal}
              >
                <Eye className="h-3.5 w-3.5" />
                <span>View Dispersal Audit Schedule</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5 border-purple-500/40 text-purple-600 dark:text-purple-400 hover:bg-purple-500/10"
                onClick={onDisperseBulkPools}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Disperse Bulk Conversion & Bonus Pools</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                onClick={onAutoMatchDrn}
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
                      onChangeDrnSearch(e.target.value);
                      onChangeDrnPage(1);
                    }}
                    className="h-8 pl-8 text-xs bg-background"
                  />
                </div>
                <Select
                  value={drnStatusFilter}
                  onValueChange={(val) => {
                    onChangeDrnStatusFilter(val as DrnStatusFilter);
                    onChangeDrnPage(1);
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
                            onClick={() => onOpenDrnModal(r)}
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
                    onClick={() => onChangeDrnPage(1)}
                  >
                    <ChevronsLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={drnPage === 1}
                    onClick={() => onChangeDrnPage((p) => Math.max(1, p - 1))}
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
                    onClick={() => onChangeDrnPage((p) => Math.min(totalDrnPages, p + 1))}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={drnPage === totalDrnPages}
                    onClick={() => onChangeDrnPage(totalDrnPages)}
                  >
                    <ChevronsRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </>
  );
}
