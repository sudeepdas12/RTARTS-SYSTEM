import { Building2 } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AccountRemediationDialog,
  type RejectedAccountItem,
} from "@/components/account-remediation-dialog";
import { TransactionDetailModal } from "@/components/reconciliation/transaction-detail-modal";
import { ShareholderStatementDialog } from "@/components/shareholder-statement-dialog";
import { ReconciliationPostingModal } from "@/components/reconciliation/reconciliation-posting-modal";
import type { FileVariantWarning } from "@/lib/bank-parser";
import type {
  ComprehensiveReconciliationReport,
  ReconciliationMatch,
} from "@/lib/reconciliation-engine";
import type { ReconciliationGroupedLot } from "@/lib/services/reconciliation.service";

export interface ReconciliationModalsProps {
  remediationDialogOpen: boolean;
  onRemediationOpenChange: (open: boolean) => void;
  remediationItems: RejectedAccountItem[];
  reconCompanyIds: string[];
  companiesList: { id: string; company_name: string; company_code: string }[];
  showPostingModal: boolean;
  onShowPostingModalChange: (open: boolean) => void;
  report: ComprehensiveReconciliationReport | null;
  selectedMatchIds: Set<string>;
  isApplying: boolean;
  onConfirmPosting: () => Promise<boolean>;
  operatorName: string;
  operatorRole: string;
  postingIsAll: boolean;
  variantAlerts: FileVariantWarning[];
  lotToDelete: ReconciliationGroupedLot | null;
  onCancelDeleteLot: () => void;
  onConfirmDeleteLot: () => void;
  lotToRevert: ReconciliationGroupedLot | null;
  onCancelRevertLot: () => void;
  onConfirmRevertLot: () => void;
  showClearHistoryDialog: boolean;
  onShowClearHistoryChange: (open: boolean) => void;
  onConfirmClearHistory: () => void;
  showRevertAllDialog: boolean;
  onShowRevertAllChange: (open: boolean) => void;
  onConfirmRevertReconciliation: () => void;
  inspectingMatch: ReconciliationMatch | null;
  onCloseInspectingMatch: () => void;
  onOpenRemediationForMatches: () => void;
  selectedStatementBoid: string | null;
  onSelectStatementBoid: (boid: string | null) => void;
  companySelectModalOpen: boolean;
  onCompanySelectModalChange: (open: boolean) => void;
  onSelectCompanyForPending: (companyId: string) => void;
  onCancelCompanySelect: () => void;
}

export function ReconciliationModalsGroup({
  remediationDialogOpen,
  onRemediationOpenChange,
  remediationItems,
  reconCompanyIds,
  companiesList,
  showPostingModal,
  onShowPostingModalChange,
  report,
  selectedMatchIds,
  isApplying,
  onConfirmPosting,
  operatorName,
  operatorRole,
  postingIsAll,
  variantAlerts,
  lotToDelete,
  onCancelDeleteLot,
  onConfirmDeleteLot,
  lotToRevert,
  onCancelRevertLot,
  onConfirmRevertLot,
  showClearHistoryDialog,
  onShowClearHistoryChange,
  onConfirmClearHistory,
  showRevertAllDialog,
  onShowRevertAllChange,
  onConfirmRevertReconciliation,
  inspectingMatch,
  onCloseInspectingMatch,
  onOpenRemediationForMatches,
  selectedStatementBoid,
  onSelectStatementBoid,
  companySelectModalOpen,
  onCompanySelectModalChange,
  onSelectCompanyForPending,
  onCancelCompanySelect,
}: ReconciliationModalsProps) {
  return (
    <>
      <AccountRemediationDialog
        open={remediationDialogOpen}
        onOpenChange={onRemediationOpenChange}
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
        onOpenChange={onShowPostingModalChange}
        report={report}
        selectedMatchIds={selectedMatchIds}
        isApplying={isApplying}
        onConfirmApply={onConfirmPosting}
        operatorName={operatorName}
        operatorRole={operatorRole}
        isAll={postingIsAll}
        variantAlerts={variantAlerts}
      />

      <AlertDialog
        open={Boolean(lotToDelete)}
        onOpenChange={(open) => !open && onCancelDeleteLot()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Reconciliation Lot</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete history for &quot;{lotToDelete?.lotName}&quot; (
              {lotToDelete?.totalRecords} records)? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onConfirmDeleteLot}
            >
              Delete Records
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(lotToRevert)}
        onOpenChange={(open) => !open && onCancelRevertLot()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revert Reconciliation Lot</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revert and remove &quot;{lotToRevert?.lotName}&quot;? This
              will reset all its linked payables back to &quot;Pending&quot; and remove this lot
              from history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onConfirmRevertLot}
            >
              Revert Lot
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showClearHistoryDialog} onOpenChange={onShowClearHistoryChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Reconciliation History</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to clear saved reconciliation history logs? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onConfirmClearHistory}
            >
              Clear History
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showRevertAllDialog} onOpenChange={onShowRevertAllChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revert Auto-Reconciled Payments</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revert auto-reconciled payments? This will set payables back
              to &quot;Pending&quot; and delete auto-created reconciliation payments.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onConfirmRevertReconciliation}
            >
              Revert Payments
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TransactionDetailModal
        match={inspectingMatch}
        open={Boolean(inspectingMatch)}
        onOpenChange={(open) => !open && onCloseInspectingMatch()}
        onRemediate={() => {
          onCloseInspectingMatch();
          onOpenRemediationForMatches();
        }}
        onViewStatement={(boid) => onSelectStatementBoid(boid)}
      />

      <ShareholderStatementDialog
        boid={selectedStatementBoid}
        open={Boolean(selectedStatementBoid)}
        onOpenChange={(open) => {
          if (!open) onSelectStatementBoid(null);
        }}
      />

      <Dialog open={companySelectModalOpen} onOpenChange={onCompanySelectModalChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Building2 className="w-5 h-5 text-primary" />
              Select Target Company
            </DialogTitle>
            <DialogDescription className="text-xs">
              To ingest statement transactions into the immutable financial ledger, please select
              the target issuing company / fund:
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-60 overflow-y-auto space-y-2 py-2">
            {companiesList.map((company) => (
              <button
                key={company.id}
                type="button"
                className="w-full text-left p-3 rounded-lg border hover:border-primary/50 hover:bg-primary/5 transition-all flex items-center justify-between cursor-pointer"
                onClick={() => onSelectCompanyForPending(company.id)}
              >
                <div>
                  <div className="font-semibold text-sm">{company.company_name}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {company.company_code}
                  </div>
                </div>
                <Badge variant="outline">Select</Badge>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={onCancelCompanySelect}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
