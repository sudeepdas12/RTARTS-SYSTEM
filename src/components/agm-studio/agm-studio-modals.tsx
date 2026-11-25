import { Fragment } from "react";
import {
  ArrowUpRight,
  Building2,
  Edit,
  FileSpreadsheet,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import {
  AgmStudioService,
  type BrokerPoolRecord,
  type CompanyProfile,
  type HistoricalFiscalYearConfig,
  type MultiYearShareholderProfile,
  type PhysicalDrnRecord,
} from "@/lib/services/agm-studio.service";
import type { DecompositionScheduleRow, RemPoolSummary } from "./agm-studio-exports";

export type FyEventType = HistoricalFiscalYearConfig["eventType"];
export type HolderTypeValue = MultiYearShareholderProfile["holderType"];

export interface AgmStudioModalsProps {
  activeCompany: CompanyProfile;
  timeline: HistoricalFiscalYearConfig[];
  // Add company modal
  isCompanyModalOpen: boolean;
  onChangeCompanyModalOpen: (open: boolean) => void;
  newCompCode: string;
  onChangeNewCompCode: (v: string) => void;
  newCompName: string;
  onChangeNewCompName: (v: string) => void;
  newCompIsinPo: string;
  onChangeNewCompIsinPo: (v: string) => void;
  newCompIsinPub: string;
  onChangeNewCompIsinPub: (v: string) => void;
  newCompBaseFy: string;
  onChangeNewCompBaseFy: (v: string) => void;
  onCreateCompany: () => void;
  // Add/Edit FY modal
  isAddFyModalOpen: boolean;
  onChangeAddFyModalOpen: (open: boolean) => void;
  editingFy: HistoricalFiscalYearConfig | null;
  fyFormYear: string;
  onChangeFyFormYear: (v: string) => void;
  fyFormEventName: string;
  onChangeFyFormEventName: (v: string) => void;
  fyFormEventType: FyEventType;
  onChangeFyFormEventType: (v: FyEventType) => void;
  fyFormBonusPct: string;
  onChangeFyFormBonusPct: (v: string) => void;
  fyFormCashPct: string;
  onChangeFyFormCashPct: (v: string) => void;
  fyFormRightPct: string;
  onChangeFyFormRightPct: (v: string) => void;
  fyFormConvPct: string;
  onChangeFyFormConvPct: (v: string) => void;
  fyFormBookClose: string;
  onChangeFyFormBookClose: (v: string) => void;
  fyFormNotes: string;
  onChangeFyFormNotes: (v: string) => void;
  onSaveFyEvent: () => void;
  // DRN modal
  selectedDrn: PhysicalDrnRecord | null;
  isDrnModalOpen: boolean;
  onChangeDrnModalOpen: (open: boolean) => void;
  targetBoidInput: string;
  onChangeTargetBoidInput: (v: string) => void;
  drnNoInput: string;
  onChangeDrnNoInput: (v: string) => void;
  drnStatusInput: PhysicalDrnRecord["status"];
  onChangeDrnStatusInput: (v: PhysicalDrnRecord["status"]) => void;
  onSaveDrnMapping: () => void;
  // Claim modal
  selectedPool: BrokerPoolRecord | null;
  isClaimModalOpen: boolean;
  onChangeClaimModalOpen: (open: boolean) => void;
  claimantBoid: string;
  onChangeClaimantBoid: (v: string) => void;
  claimantName: string;
  onChangeClaimantName: (v: string) => void;
  claimedKitta: string;
  onChangeClaimedKitta: (v: string) => void;
  tradeDate: string;
  onChangeTradeDate: (v: string) => void;
  contractNote: string;
  onChangeContractNote: (v: string) => void;
  onProcessClaim: () => void;
  // Decomposition modal
  isDecompositionModalOpen: boolean;
  onChangeDecompositionModalOpen: (open: boolean) => void;
  remPoolData: RemPoolSummary;
  decompositionSchedule: DecompositionScheduleRow[];
  onExportDecompositionSchedule: () => void;
  onDisperseBulkPools: () => void;
  // Profile detail modal
  selectedProfile: MultiYearShareholderProfile | null;
  onClearSelectedProfile: () => void;
  onExportShareholderJourney: (p: MultiYearShareholderProfile) => void;
  // Edit profile modal
  editingProfile: MultiYearShareholderProfile | null;
  isEditModalOpen: boolean;
  onCloseEditModal: () => void;
  editKittaInput: string;
  onChangeEditKittaInput: (v: string) => void;
  editFractionInput: string;
  onChangeEditFractionInput: (v: string) => void;
  editHolderTypeInput: HolderTypeValue;
  onChangeEditHolderTypeInput: (v: HolderTypeValue) => void;
  isSavingEdit: boolean;
  onSaveSingleEdit: () => void;
}

export function AgmStudioModals({
  activeCompany,
  timeline,
  isCompanyModalOpen,
  onChangeCompanyModalOpen,
  newCompCode,
  onChangeNewCompCode,
  newCompName,
  onChangeNewCompName,
  newCompIsinPo,
  onChangeNewCompIsinPo,
  newCompIsinPub,
  onChangeNewCompIsinPub,
  newCompBaseFy,
  onChangeNewCompBaseFy,
  onCreateCompany,
  isAddFyModalOpen,
  onChangeAddFyModalOpen,
  editingFy,
  fyFormYear,
  onChangeFyFormYear,
  fyFormEventName,
  onChangeFyFormEventName,
  fyFormEventType,
  onChangeFyFormEventType,
  fyFormBonusPct,
  onChangeFyFormBonusPct,
  fyFormCashPct,
  onChangeFyFormCashPct,
  fyFormRightPct,
  onChangeFyFormRightPct,
  fyFormConvPct,
  onChangeFyFormConvPct,
  fyFormBookClose,
  onChangeFyFormBookClose,
  fyFormNotes,
  onChangeFyFormNotes,
  onSaveFyEvent,
  selectedDrn,
  isDrnModalOpen,
  onChangeDrnModalOpen,
  targetBoidInput,
  onChangeTargetBoidInput,
  drnNoInput,
  onChangeDrnNoInput,
  drnStatusInput,
  onChangeDrnStatusInput,
  onSaveDrnMapping,
  selectedPool,
  isClaimModalOpen,
  onChangeClaimModalOpen,
  claimantBoid,
  onChangeClaimantBoid,
  claimantName,
  onChangeClaimantName,
  claimedKitta,
  onChangeClaimedKitta,
  tradeDate,
  onChangeTradeDate,
  contractNote,
  onChangeContractNote,
  onProcessClaim,
  isDecompositionModalOpen,
  onChangeDecompositionModalOpen,
  remPoolData,
  decompositionSchedule,
  onExportDecompositionSchedule,
  onDisperseBulkPools,
  selectedProfile,
  onClearSelectedProfile,
  onExportShareholderJourney,
  editingProfile,
  isEditModalOpen,
  onCloseEditModal,
  editKittaInput,
  onChangeEditKittaInput,
  editFractionInput,
  onChangeEditFractionInput,
  editHolderTypeInput,
  onChangeEditHolderTypeInput,
  isSavingEdit,
  onSaveSingleEdit,
}: AgmStudioModalsProps) {
  return (
    <>
      <Dialog open={isCompanyModalOpen} onOpenChange={onChangeCompanyModalOpen}>
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
                onChange={(e) => onChangeNewCompCode(e.target.value)}
                className="h-8 text-xs uppercase"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Full Company Name</Label>
              <Input
                placeholder="e.g. NIC Asia Bank Ltd"
                value={newCompName}
                onChange={(e) => onChangeNewCompName(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">ISIN Promoter (Optional)</Label>
                <Input
                  placeholder="NPE..."
                  value={newCompIsinPo}
                  onChange={(e) => onChangeNewCompIsinPo(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">ISIN Public (Optional)</Label>
                <Input
                  placeholder="NPE..."
                  value={newCompIsinPub}
                  onChange={(e) => onChangeNewCompIsinPub(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Base Reconciliation Fiscal Year</Label>
              <Input
                placeholder="2075/76"
                value={newCompBaseFy}
                onChange={(e) => onChangeNewCompBaseFy(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => onChangeCompanyModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" className="bg-primary text-white" onClick={onCreateCompany}>
              Create Company
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddFyModalOpen} onOpenChange={onChangeAddFyModalOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="p-5 pb-3 border-b shrink-0">
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

          <div className="flex-1 overflow-y-auto p-5 space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Fiscal Year (e.g. 2081/82)</Label>
                <Input
                  value={fyFormYear}
                  onChange={(e) => onChangeFyFormYear(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Event Type</Label>
                <Select
                  value={fyFormEventType}
                  onValueChange={(v) => onChangeFyFormEventType(v as FyEventType)}
                >
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
                onChange={(e) => onChangeFyFormEventName(e.target.value)}
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
                  onChange={(e) => onChangeFyFormBonusPct(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Cash %</Label>
                <Input
                  type="number"
                  step="0.00001"
                  value={fyFormCashPct}
                  onChange={(e) => onChangeFyFormCashPct(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Right %</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={fyFormRightPct}
                  onChange={(e) => onChangeFyFormRightPct(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Conv %</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={fyFormConvPct}
                  onChange={(e) => onChangeFyFormConvPct(e.target.value)}
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
                  onChange={(e) => onChangeFyFormBookClose(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Notes / Rationale</Label>
                <Input
                  placeholder="Tax absorbing cash dividend..."
                  value={fyFormNotes}
                  onChange={(e) => onChangeFyFormNotes(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="p-4 border-t bg-muted/20 shrink-0 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onChangeAddFyModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={onSaveFyEvent}
            >
              Save Corporate Action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedDrn && (
        <Dialog open={isDrnModalOpen} onOpenChange={onChangeDrnModalOpen}>
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
                  onChange={(e) => onChangeTargetBoidInput(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Demat Request Number (DRN)</Label>
                <Input
                  placeholder="e.g. DRN-NLG-88192"
                  value={drnNoInput}
                  onChange={(e) => onChangeDrnNoInput(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Dematerialization Status</Label>
                <Select
                  value={drnStatusInput}
                  onValueChange={(v) => onChangeDrnStatusInput(v as PhysicalDrnRecord["status"])}
                >
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
              <Button variant="outline" size="sm" onClick={() => onChangeDrnModalOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={onSaveDrnMapping}
              >
                Save Mapping
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {selectedPool && (
        <Dialog open={isClaimModalOpen} onOpenChange={onChangeClaimModalOpen}>
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
                  onChange={(e) => onChangeClaimantBoid(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Claimant Name</Label>
                <Input
                  placeholder="e.g. ARHAN PRASAIN"
                  value={claimantName}
                  onChange={(e) => onChangeClaimantName(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Claimed Kitta</Label>
                  <Input
                    type="number"
                    value={claimedKitta}
                    onChange={(e) => onChangeClaimedKitta(e.target.value)}
                    className="h-9 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Trade Date (BS)</Label>
                  <Input
                    value={tradeDate}
                    onChange={(e) => onChangeTradeDate(e.target.value)}
                    className="h-9 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Broker Contract Note No.</Label>
                <Input
                  value={contractNote}
                  onChange={(e) => onChangeContractNote(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => onChangeClaimModalOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={onProcessClaim}
              >
                Approve & Transfer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={isDecompositionModalOpen} onOpenChange={onChangeDecompositionModalOpen}>
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
                onClick={onExportDecompositionSchedule}
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
                onChangeDecompositionModalOpen(false);
                onDisperseBulkPools();
              }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Execute Conversion Dispersal Only</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onChangeDecompositionModalOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedProfile && (
        <Dialog open={!!selectedProfile} onOpenChange={(open) => !open && onClearSelectedProfile()}>
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
                    onClick={() => onExportShareholderJourney(selectedProfile)}
                  >
                    <FileSpreadsheet className="h-3 w-3" />
                    <span>Export (.xlsx)</span>
                  </Button>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              {/* Demographics & KYC Card */}
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
              <Button size="sm" variant="outline" onClick={onClearSelectedProfile}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {editingProfile && (
        <Dialog
          open={isEditModalOpen}
          onOpenChange={(open) => {
            if (!open) onCloseEditModal();
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
                  onChange={(e) => onChangeEditKittaInput(e.target.value)}
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
                  onChange={(e) => onChangeEditFractionInput(e.target.value)}
                  className="h-9 text-xs font-mono font-semibold"
                  placeholder="e.g. 0.3500"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold">Shareholder Classification</Label>
                <Select
                  value={editHolderTypeInput}
                  onValueChange={(v) => onChangeEditHolderTypeInput(v as HolderTypeValue)}
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
              <Button size="sm" variant="outline" onClick={onCloseEditModal}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5 shadow-sm"
                disabled={isSavingEdit}
                onClick={onSaveSingleEdit}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSavingEdit ? "animate-spin" : ""}`} />
                <span>{isSavingEdit ? "Recalculating..." : "Save & Recalculate"}</span>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
