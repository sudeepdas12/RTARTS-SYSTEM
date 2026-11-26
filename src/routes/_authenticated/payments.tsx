import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { useDebounce } from "@/hooks/use-debounce";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { PaymentGenerator } from "@/lib/payment-generator";
import { exportToExcel, exportMultiSheetExcel } from "@/lib/xlsx-utils";
import { getPayeeCategoryLabel } from "@/lib/services/payable-summary";
import { PaymentService, PaymentBatch, PaymentLineItem } from "@/lib/services/payment.service";
import { ConnectIPSService } from "@/lib/services/connectips.service";
import { getPaymentStatusPresentation } from "@/lib/connectips-utils";
import {
  SmsBroadcastService,
  BroadcastSummary,
  BroadcastTemplateType,
  DEFAULT_TEMPLATES,
} from "@/lib/services/sms-broadcast.service";
import { WorkflowEngine, ApprovalAction } from "@/lib/workflow-engine";
import { NotificationService } from "@/lib/services/notification.service";
import { RBACService, UserContext } from "@/lib/rbac-service";
import { fetchAllRows } from "@/lib/services/database";
import { useAuth } from "@/hooks/use-auth";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShareholderStatementDialog } from "@/components/shareholder-statement-dialog";
import {
  AccountRemediationDialog,
  type RejectedAccountItem,
} from "@/components/account-remediation-dialog";
import {
  Download,
  Plus,
  CheckCircle2,
  XCircle,
  FileSpreadsheet,
  Trash2,
  Eye,
  X,
  Loader2,
  Send,
  Search,
  User,
  CreditCard,
  Layers,
  FileText,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RotateCcw,
  Edit3,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ApprovalBar } from "@/components/workflow/approval-bar";
import { STANDARD_PERIODS, type PeriodPreset } from "@/lib/services/period-calculator";
import { BankErrorUploadDialog } from "@/components/reconciliation/bank-error-upload-dialog";
import { DeclarationSummaryCard } from "@/components/declarations/declaration-summary-card";
import { CreatePaymentBatchDialog } from "@/components/payments/create-payment-batch-dialog";
import {
  EditBatchDialog,
  ReversePaymentDialog,
} from "@/components/payments/payment-edit-and-reverse-dialogs";
import { PaymentBroadcastDialog } from "@/components/payments/payment-broadcast-dialog";

export const Route = createFileRoute("/_authenticated/payments")({
  component: PaymentsRoute,
});

type PaymentMethod = "NEFT" | "RTGS" | "ConnectIPS" | "Cheque" | "Cash";

function PaymentsRoute() {
  const qc = useQueryClient();
  const { user, roles, isAdmin } = useAuth();
  const canWrite =
    isAdmin ||
    (roles || []).some((r: string) =>
      ["admin", "finance_operator", "maker", "operator"].includes(r),
    );
  const currentUser: UserContext | null = user
    ? { id: user.id, roles: (roles as any) || ["read_only"] }
    : null;
  const canApprove = RBACService.canApprove(currentUser, "payment_batches");
  const canExport = RBACService.canExport(currentUser, "payments");
  const [createOpen, setCreateOpen] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("ConnectIPS");
  const [selectedCompany, setSelectedCompany] = useState<string>("all");
  const [selectedPayableType, setSelectedPayableType] = useState<string>("all");
  const [batchName, setBatchName] = useState("");
  const [fiscalYear, setFiscalYear] = useState("all");
  const [cdsBatchRef, setCdsBatchRef] = useState("");
  const [registrar, setRegistrar] = useState("");
  const [reverseDialogOpen, setReverseDialogOpen] = useState<PaymentLineItem | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [periodPreset, setPeriodPreset] = useState<string>("12M");
  const [periodDays, setPeriodDays] = useState<string>("365");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [isDisbursing, setIsDisbursing] = useState(false);
  const [disburseProgress, setDisburseProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [isSyncingConnectIps, setIsSyncingConnectIps] = useState(false);
  const [checkingPaymentId, setCheckingPaymentId] = useState<string | null>(null);
  const [installmentTag, setInstallmentTag] = useState<string>("FULL");

  const invalidatePaymentLedgers = (batchId?: string | null) => {
    qc.invalidateQueries({ queryKey: ["payments"] });
    qc.invalidateQueries({ queryKey: ["payment-batches"] });
    qc.invalidateQueries({ queryKey: ["payment-batch"] });
    qc.invalidateQueries({ queryKey: ["payment-line-items"] });
    if (batchId) {
      qc.invalidateQueries({ queryKey: ["payment-batch", batchId] });
      qc.invalidateQueries({ queryKey: ["payment-line-items", batchId] });
    }
    qc.invalidateQueries({ queryKey: ["payments-individual-server"] });
    qc.invalidateQueries({ queryKey: ["payables-preview"] });
    qc.invalidateQueries({ queryKey: ["available-payables"] });
    qc.invalidateQueries({ queryKey: ["dividend_payables"] });
    qc.invalidateQueries({ queryKey: ["interest_payables"] });
    qc.invalidateQueries({ queryKey: ["mutual_fund_payables"] });
    qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
    qc.invalidateQueries({ queryKey: ["dashboard-operational-metrics"] });
  };

  const handleCheckSinglePaymentStatus = async (params: {
    paymentId: string;
    referenceId?: string | null;
    batchId?: string | null;
  }) => {
    const ref = params.referenceId || params.paymentId;
    setCheckingPaymentId(params.paymentId);
    try {
      const res = await ConnectIPSService.checkTransactionStatus(ref, {
        paymentId: params.paymentId,
        batchId: params.batchId || undefined,
      });
      invalidatePaymentLedgers(params.batchId);
      if (res.status === "SUCCESS") {
        toast.success(res.message);
      } else if (res.status === "FAILED") {
        toast.error(res.message);
      } else {
        toast.info(res.message);
      }
    } catch (err: any) {
      toast.error(`ConnectIPS status inquiry failed: ${err?.message || err}`);
    } finally {
      setCheckingPaymentId(null);
    }
  };

  const handleSyncBatchStatuses = async (batchId: string) => {
    setIsSyncingConnectIps(true);
    try {
      const res = await ConnectIPSService.syncBatchTransactionStatuses(batchId);
      invalidatePaymentLedgers(batchId);
      if (res.failed > 0 || res.returned > 0) {
        toast.warning(res.message);
      } else if (res.processing > 0 || res.pending > 0) {
        toast.info(res.message);
      } else {
        toast.success(res.message);
      }
    } catch (err: any) {
      toast.error(`Failed to sync ConnectIPS statuses: ${err?.message || err}`);
    } finally {
      setIsSyncingConnectIps(false);
    }
  };
  const [createBatchProgress, setCreateBatchProgress] = useState<string | null>(null);

  // Edit Batch Dialog State (for Draft batches)
  const [editBatchOpen, setEditBatchOpen] = useState(false);
  const [editBatchName, setEditBatchName] = useState("");
  const [editFiscalYear, setEditFiscalYear] = useState("");
  const [editPayableType, setEditPayableType] = useState<string>("dividend");
  const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod>("ConnectIPS");
  const [editCdsBatchRef, setEditCdsBatchRef] = useState("");
  const [editRegistrar, setEditRegistrar] = useState("");

  // Active top tab (Batches vs Individual Shareholder Search)
  const [paymentsActiveTab, setPaymentsActiveTab] = useState<"batches" | "shareholders">("batches");
  const [selectedStatementBoid, setSelectedStatementBoid] = useState<string | null>(null);
  const [remediationDialogOpen, setRemediationDialogOpen] = useState(false);
  const [remediationItems, setRemediationItems] = useState<RejectedAccountItem[]>([]);

  // SMS Broadcast State
  const [broadcastOpen, setBroadcastOpen] = useState<boolean>(false);
  const [broadcastBatch, setBroadcastBatch] = useState<PaymentBatch | null>(null);
  const [broadcastTemplateType, setBroadcastTemplateType] =
    useState<BroadcastTemplateType>("PAYMENT_SUCCESS");
  const [customMessageTemplate, setCustomMessageTemplate] = useState<string>(
    DEFAULT_TEMPLATES.PAYMENT_SUCCESS,
  );
  const [broadcastSummary, setBroadcastSummary] = useState<BroadcastSummary | null>(null);

  // Main table filters
  const [tableSearch, setTableSearch] = useState<string>("");
  const [tableStatusFilter, setTableStatusFilter] = useState<string>("all");
  const [tableFromDate, setTableFromDate] = useState<string>("");
  const [tableToDate, setTableToDate] = useState<string>("");
  const [tablePeriodPreset, setTablePeriodPreset] = useState<PeriodPreset | "ALL">("ALL");

  // Individual Shareholder Transactions Query
  const [shareholderSearch, setShareholderSearch] = useState<string>("");
  const debouncedShareholderSearch = useDebounce(shareholderSearch, 350);
  const [shareholderCompany, setShareholderCompany] = useState<string>("all");
  const [shareholderStatus, setShareholderStatus] = useState<string>("all");
  const [shareholderPage, setShareholderPage] = useState<number>(1);
  const [shareholderPageSize, setShareholderPageSize] = useState<number>(15);

  const { data: shareholderQueryResult, isLoading: isIndividualLoading } = useQuery({
    queryKey: [
      "payments-individual-server",
      shareholderCompany,
      shareholderStatus,
      debouncedShareholderSearch,
      shareholderPage,
      shareholderPageSize,
    ],
    queryFn: async () => {
      const from = (shareholderPage - 1) * shareholderPageSize;
      const to = from + shareholderPageSize - 1;
      const term = debouncedShareholderSearch ? debouncedShareholderSearch.trim() : null;
      const companyId = shareholderCompany !== "all" ? shareholderCompany : null;
      const statusFilter = shareholderStatus !== "all" ? shareholderStatus : null;

      // Attempt parameterized server-side RPC (supports BOID, full_name, reference, bank account)
      try {
        const { data: rpcData, error: rpcError } = await (supabase as any).rpc(
          "search_payments_paginated",
          {
            p_search_term: term,
            p_company_id: companyId,
            p_status: statusFilter,
            p_limit: shareholderPageSize,
            p_offset: from,
          },
        );

        if (!rpcError && Array.isArray(rpcData)) {
          const totalCount = Number(rpcData[0]?.total_count || 0);
          const mapped = rpcData.map((row: any) => ({
            ...row,
            client: {
              id: row.client_id,
              boid: row.boid,
              full_name: row.full_name,
              holder_type: row.holder_type,
              bank_name: row.bank_name,
              bank_account_no: row.bank_account_no,
            },
            company: {
              id: row.company_id,
              company_name: row.company_name,
              company_code: row.company_code,
            },
          }));
          return {
            items: mapped,
            total: totalCount,
          };
        }
      } catch (rpcEx) {
        console.debug(
          "search_payments_paginated RPC not available, using direct query fallback:",
          rpcEx,
        );
      }

      // Direct query fallback
      let q = (supabase as any)
        .from("payments")
        .select(
          `
          *,
          client:clients(id, full_name, boid, bank_name, bank_account_no, pan_no, citizenship_no, phone, holder_type),
          company:companies(id, company_name, company_code)
        `,
          { count: "exact" },
        )
        .order("created_at", { ascending: false })
        .order("id", { ascending: true });

      if (shareholderCompany !== "all") q = q.eq("company_id", shareholderCompany);
      if (shareholderStatus !== "all") q = q.eq("status", shareholderStatus);

      if (term) {
        q = q.or(
          `bank_account_no.ilike.%${term}%,payment_reference.ilike.%${term}%,connectips_ref.ilike.%${term}%`,
        );
      }

      q = q.range(from, to);

      const { data, count, error } = await q;
      if (error) {
        console.error("Error fetching individual payments paged:", error);
        throw error;
      }
      return {
        items: data || [],
        total: count || 0,
      };
    },
    staleTime: 10_000,
  });

  const paginatedShareholders = shareholderQueryResult?.items || [];
  const totalShareholders = shareholderQueryResult?.total || 0;
  const filteredIndividualPayments = paginatedShareholders;
  const shareholderTotalPages = Math.max(1, Math.ceil(totalShareholders / shareholderPageSize));
  const safeShareholderPage = Math.min(shareholderPage, shareholderTotalPages);

  const { data: payments, isLoading } = useQuery({
    queryKey: ["payments"],
    queryFn: () => PaymentService.getBatches(100, 0),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["companies-lookup"],
    queryFn: async () => {
      const { data } = await supabase
        .from("companies")
        .select("id, company_name, company_code, company_type, fiscal_year")
        .order("company_name");
      return (data || []) as any[];
    },
  });

  const { data: fiscalYears = [] } = useQuery({
    queryKey: ["payments-fiscal-years"],
    queryFn: async () => {
      const { data } = await supabase
        .from("fiscal_years")
        .select("fiscal_year")
        .order("fiscal_year", { ascending: false });
      return (data || []).map((f) => f.fiscal_year);
    },
  });

  const { data: activeBatchData } = useQuery({
    queryKey: ["payment-batch", activeBatchId],
    queryFn: () => PaymentService.getBatchById(activeBatchId!),
    enabled: !!activeBatchId,
  });

  const { data: lineItems, isLoading: lineItemsLoading } = useQuery({
    queryKey: ["payment-line-items", activeBatchId],
    queryFn: () => PaymentService.getLineItems(activeBatchId!),
    enabled: !!activeBatchId,
  });

  // Default fiscal year to 'all' if empty
  if (!fiscalYear) {
    setFiscalYear("all");
  }

  // Fast server-side payables preview (< 50ms)
  const {
    data: payablesPreview = {
      count: 0,
      totalAmount: 0,
      totalGross: 0,
      totalTax: 0,
      mfCount: 0,
      divCount: 0,
      intCount: 0,
    },
    isLoading: isPreviewLoading,
  } = useQuery({
    queryKey: [
      "payables-preview",
      selectedCompany,
      selectedPayableType,
      fiscalYear,
      fromDate,
      toDate,
    ],
    queryFn: () =>
      PaymentService.getAvailablePayablesPreview(
        selectedCompany !== "all" ? selectedCompany : undefined,
        selectedPayableType !== "all" ? selectedPayableType : undefined,
        {
          fiscalYear: fiscalYear || undefined,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
        },
      ),
    staleTime: 30 * 1000,
  });

  // Dedicated query for payables specifically matching the active batch
  const { data: activeBatchPayables = [], isLoading: isActiveBatchPayablesLoading } = useQuery({
    queryKey: [
      "active-batch-payables",
      activeBatchId,
      activeBatchData?.company_id,
      activeBatchData?.payable_type,
      activeBatchData?.fiscal_year,
    ],
    queryFn: async () => {
      if (!activeBatchId || !activeBatchData) return [];
      return PaymentService.getPayablesForPayment(
        activeBatchData.company_id || undefined,
        activeBatchData.payable_type || undefined,
        {
          fiscalYear: activeBatchData.fiscal_year || undefined,
        },
      );
    },
    enabled: !!activeBatchId && !!activeBatchData,
  });

  const existingLineItemPayableIds = useMemo(() => {
    return new Set((lineItems || []).map((li) => li.payable_id).filter(Boolean));
  }, [lineItems]);

  const unbatchedPayablesForActiveBatch = useMemo(() => {
    return activeBatchPayables.filter((p) => !existingLineItemPayableIds.has(p.id));
  }, [activeBatchPayables, existingLineItemPayableIds]);

  const { mutate: createBatch, isPending } = useMutation({
    mutationFn: async () => {
      if (!canWrite) throw new Error("You do not have permission to create payment batches.");
      if (!batchName.trim()) throw new Error("Batch name is required");

      if (payablesPreview.count === 0) {
        const proceed = confirm(
          "No pending payables match the selected company, type, and fiscal year. Are you sure you want to create an empty payment batch?",
        );
        if (!proceed) throw new Error("Batch creation cancelled: no payables selected.");
      }

      setCreateBatchProgress("Initializing batch header...");

      // Fast, safe chunked batch population in Postgres (prevents timeouts on large batches)
      const batch = await PaymentService.createBatchAtomic(
        {
          batch_name: batchName.trim(),
          company_id: selectedCompany !== "all" ? selectedCompany : undefined,
          fiscal_year: fiscalYear || undefined,
          payable_type: selectedPayableType !== "all" ? selectedPayableType : undefined,
          payment_method: paymentMethod,
          installment_tag: installmentTag,
          cds_batch_ref: cdsBatchRef.trim() || undefined,
          registrar: registrar.trim() || undefined,
        },
        (inserted, total) => {
          const target = payablesPreview.count || total || 1;
          const pct = Math.min(100, Math.round((inserted / target) * 100));
          setCreateBatchProgress(
            `Populating: ${inserted.toLocaleString()} / ${target.toLocaleString()} (${pct}%)...`,
          );
        },
      );

      return batch;
    },
    onSuccess: (batch: any) => {
      setCreateBatchProgress(null);
      toast.success(
        `Payment batch created with ${batch.total_payments ?? payablesPreview.count} payables.`,
      );
      setCreateOpen(false);
      setBatchName("");
      setCdsBatchRef("");
      setRegistrar("");
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["payment-batch"] });
      qc.invalidateQueries({ queryKey: ["payables-preview"] });
      if (batch?.id) {
        setActiveBatchId(batch.id);
      }
    },
    onError: (err: any) => {
      setCreateBatchProgress(null);
      toast.error(`Failed to create batch: ${err?.message || err}`);
    },
  });

  const { mutate: addPayablesToBatch, isPending: isAddingPayables } = useMutation({
    mutationFn: async (batchId: string) => {
      if (!canWrite) throw new Error("You do not have permission to modify payment batches.");
      if (!activeBatchData) throw new Error("Batch details are not loaded.");
      if (activeBatchData.status !== "Draft") {
        throw new Error("Cannot add payables to a batch that is not in Draft status.");
      }

      if (unbatchedPayablesForActiveBatch.length === 0) {
        throw new Error(
          `No unbatched pending payables found for this batch's company, payable type (${activeBatchData.payable_type || "All"}), and fiscal year (${activeBatchData.fiscal_year || "All"}).`,
        );
      }

      const items = unbatchedPayablesForActiveBatch.map((payable) => {
        const origGross = Number(
          payable.gross_dividend ??
            payable.gross_interest ??
            payable.gross_amount ??
            payable.gross ??
            0,
        );
        const origNet = Number(
          payable.net_payable ?? payable.net_interest ?? payable.net_amount ?? 0,
        );
        const origTax = Number(payable.tax_amount ?? origGross - origNet);
        const isPartial = payable.payment_status === "Partial";
        const rem = payable.remaining_amount != null ? Number(payable.remaining_amount) : origNet;

        let grossAmount = origGross;
        let taxAmount = origTax;
        let netAmount = origNet;

        if (isPartial && rem > 0 && rem < origNet && origNet > 0) {
          netAmount = rem;
          const ratio = netAmount / origNet;
          grossAmount = Math.round(origGross * ratio * 100) / 100;
          taxAmount = Number((grossAmount - netAmount).toFixed(2));
          grossAmount = Number((netAmount + taxAmount).toFixed(2));
        }

        return {
          company_id: payable.company_id || activeBatchData.company_id,
          client_id: payable.client_id,
          payable_type: payable.payable_type || activeBatchData.payable_type || "interest",
          payable_id: payable.id,
          gross_amount: grossAmount,
          tax_amount: taxAmount,
          net_amount: netAmount,
          paid_amount: netAmount,
          payment_method: activeBatchData?.payment_method || "ConnectIPS",
          payment_date: null,
          payment_reference: null,
          bank_name: payable.clients?.bank_name || payable.bank_name || null,
          bank_account_no: payable.clients?.bank_account_no || payable.bank_account_no || null,
          neft_ref: null,
          connectips_ref: null,
          rtgs_ref: null,
          cheque_no: null,
          status: "Pending" as const,
          remarks: null,
        };
      });

      const success = await PaymentService.addLineItems(batchId, items);
      if (!success) throw new Error("Failed to add line items to database");
      return items.length;
    },
    onSuccess: (count) => {
      toast.success(`Successfully added ${count} payables to batch.`);
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["payment-batch", activeBatchId] });
      qc.invalidateQueries({ queryKey: ["payment-line-items", activeBatchId] });
      qc.invalidateQueries({ queryKey: ["active-batch-payables", activeBatchId] });
      qc.invalidateQueries({ queryKey: ["payables-for-payment"] });
    },
    onError: (err: any) => toast.error(`Failed to add payables: ${err?.message || err}`),
  });

  const { mutate: updateBatchSettings, isPending: isUpdatingBatch } = useMutation({
    mutationFn: async () => {
      if (!canWrite) throw new Error("You do not have permission to modify payment batches.");
      if (!activeBatchId) throw new Error("No active batch selected.");
      if (!editBatchName.trim()) throw new Error("Batch name is required.");

      return PaymentService.updateBatch(activeBatchId, {
        batch_name: editBatchName.trim(),
        fiscal_year: editFiscalYear || undefined,
        payable_type: editPayableType || undefined,
        payment_method: editPaymentMethod,
        cds_batch_ref: editCdsBatchRef.trim() || null,
        registrar: editRegistrar.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success("Batch settings updated successfully.");
      setEditBatchOpen(false);
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["payment-batch", activeBatchId] });
      qc.invalidateQueries({ queryKey: ["active-batch-payables", activeBatchId] });
    },
    onError: (err: any) => toast.error(`Failed to update batch settings: ${err?.message || err}`),
  });

  const { mutate: updateBatchStatus } = useMutation({
    mutationFn: async ({
      batchId,
      status,
      action,
    }: {
      batchId: string;
      status?: PaymentBatch["status"];
      action?: ApprovalAction;
    }) => {
      const batchData = payments?.find((p: any) => p.id === batchId) || activeBatchData;
      let effectiveAction: ApprovalAction = action || "submit";
      if (!action && status) {
        if (status === "Pending") effectiveAction = "submit";
        else if (status === "Approved") effectiveAction = "approve";
        else if (status === "Rejected") effectiveAction = "reject";
        else if (status === "Processed") effectiveAction = "process";
        else if (status === "Completed") effectiveAction = "complete";
      }
      const result = await WorkflowEngine.processAction(
        batchId,
        "payment_batches",
        effectiveAction,
        undefined,
        currentUser,
      );
      if (!result.success) throw new Error(result.error || "Failed to update status");

      await NotificationService.sendPaymentNotification(
        currentUser?.id || null,
        batchId.slice(0, 8),
        result.success,
        batchData?.total_amount || 0,
        batchData?.total_payments || 0,
      );
    },
    onSuccess: () => {
      toast.success("Batch workflow status updated successfully.");
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["payment-batch"] });
      qc.invalidateQueries({ queryKey: ["payment-line-items"] });
      qc.invalidateQueries({ queryKey: ["pending_approvals_all"] });
      qc.invalidateQueries({ queryKey: ["pending_batches_count"] });
      qc.invalidateQueries({ queryKey: ["dividend_payables"] });
      qc.invalidateQueries({ queryKey: ["interest_payables"] });
      qc.invalidateQueries({ queryKey: ["mutual_fund_payables"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      qc.invalidateQueries({ queryKey: ["dashboard-operational-metrics"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update batch status."),
  });

  const { mutate: deleteBatch, isPending: isDeletingBatch } = useMutation({
    mutationFn: async (batchId: string) => {
      if (!canWrite) throw new Error("Unauthorized: you do not have permission to delete batches.");
      const ok = await PaymentService.deleteBatch(batchId);
      if (!ok) throw new Error("Failed to delete batch");
      return batchId;
    },
    onSuccess: () => {
      toast.success("Payment batch deleted successfully.");
      setActiveBatchId(null);
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["payables-for-payment"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to delete batch."),
  });

  const { mutate: revertBatch, isPending: isRevertingBatch } = useMutation({
    mutationFn: async (batch: PaymentBatch) => {
      if (!isAdmin)
        throw new Error("Unauthorized: only administrators can revert payment batches.");
      const res = await PaymentService.revertBatch(batch.id, currentUser?.id, "Admin Batch Revert");
      return { batch, res };
    },
    onSuccess: ({ batch, res }) => {
      toast.success(
        `Batch "${batch.batch_name}" reverted: ${res.revertedPayables} payables reset to Pending.`,
      );
      setActiveBatchId(null);
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["payment-batches"] });
      qc.invalidateQueries({ queryKey: ["payables-for-payment"] });
      qc.invalidateQueries({ queryKey: ["dividend_payables"] });
      qc.invalidateQueries({ queryKey: ["interest_payables"] });
      qc.invalidateQueries({ queryKey: ["mutual_fund_payables"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      qc.invalidateQueries({ queryKey: ["dashboard-operational-metrics"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to revert batch."),
  });

  const { mutate: executeReversal } = useMutation({
    mutationFn: async () => {
      if (!canWrite)
        throw new Error("Unauthorized: you do not have permission to reverse payments.");
      if (!reverseDialogOpen) return;
      const success = await PaymentService.reversePayment(
        reverseDialogOpen.id,
        reversalReason || "Manual Reversal by Operator",
        currentUser?.id,
      );
      if (!success) throw new Error("Failed to reverse payment");
    },
    onSuccess: () => {
      toast.success("Payment successfully reversed and payable restored.");
      setReverseDialogOpen(null);
      setReversalReason("");
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["payment-batch"] });
      qc.invalidateQueries({ queryKey: ["payment-line-items"] });
      qc.invalidateQueries({ queryKey: ["dividend_payables"] });
      qc.invalidateQueries({ queryKey: ["interest_payables"] });
      qc.invalidateQueries({ queryKey: ["mutual_fund_payables"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
      qc.invalidateQueries({ queryKey: ["dashboard-operational-metrics"] });
    },
    onError: (err: any) => toast.error(err?.message || "Reversal failed"),
  });

  const handleDownloadPaymentFile = async (batch: PaymentBatch) => {
    let itemsToExport = lineItems;
    if (
      !itemsToExport ||
      itemsToExport.length === 0 ||
      activeBatchId !== batch.id ||
      (batch.total_payments != null && itemsToExport.length < batch.total_payments)
    ) {
      itemsToExport = await PaymentService.getAllLineItemsForExport(batch.id);
    }

    if (!itemsToExport || itemsToExport.length === 0) {
      toast.error("No line items found in this batch.");
      return;
    }

    let content: string;
    const batchName = batch.batch_name || `Batch_${batch.id.slice(0, 8)}`;

    switch (batch.payment_method) {
      case "ConnectIPS":
        content = PaymentGenerator.generateConnectIPS(itemsToExport, batchName);
        break;
      case "RTGS":
        content = PaymentGenerator.generateNEFT(itemsToExport, batchName);
        break;
      case "Cheque":
        content = PaymentGenerator.generateCheque(itemsToExport, batchName);
        break;
      case "Cash":
        content = PaymentGenerator.generateCash(itemsToExport, batchName);
        break;
      default:
        content = PaymentGenerator.generateNEFT(itemsToExport, batchName);
    }

    PaymentGenerator.downloadPaymentFile(content, batch.payment_method || "NEFT", batchName);
    toast.success(`${batch.payment_method || "NEFT"} file downloaded.`);
  };

  const handleDownloadExcel = async (batch: PaymentBatch) => {
    if (!canExport) {
      toast.error("Unauthorized: You do not have permission to export payment reports.");
      return;
    }
    let itemsToExport = lineItems;
    if (
      !itemsToExport ||
      itemsToExport.length === 0 ||
      activeBatchId !== batch.id ||
      (batch.total_payments != null && itemsToExport.length < batch.total_payments)
    ) {
      itemsToExport = await PaymentService.getAllLineItemsForExport(batch.id);
    }

    if (!itemsToExport || itemsToExport.length === 0) {
      toast.error("No line items found in this batch.");
      return;
    }

    // Classification summary for the batch
    const classificationMap = new Map<
      string,
      { category: string; count: number; gross: number; tax: number; net: number }
    >();

    itemsToExport.forEach((item) => {
      const rawCode = item.clients?.payee_classification || "UNCLASSIFIED";
      const label = getPayeeCategoryLabel(rawCode);
      const gross = Number(item.gross_amount || 0);
      const tax = Number(item.tax_amount || 0);
      const net = Number(item.net_amount || gross - tax);

      if (!classificationMap.has(label)) {
        classificationMap.set(label, { category: label, count: 0, gross: 0, tax: 0, net: 0 });
      }
      const entry = classificationMap.get(label)!;
      entry.count += 1;
      entry.gross += gross;
      entry.tax += tax;
      entry.net += net;
    });

    const totalGross = Array.from(classificationMap.values()).reduce((sum, c) => sum + c.gross, 0);
    const totalTax = Array.from(classificationMap.values()).reduce((sum, c) => sum + c.tax, 0);
    const totalNet = Array.from(classificationMap.values()).reduce((sum, c) => sum + c.net, 0);

    const summaryRows = Array.from(classificationMap.values()).map((c) => ({
      "Investor Classification": c.category,
      "Payee Count": c.count,
      "Gross Amount (NPR)": Number(c.gross.toFixed(2)),
      "Tax / TDS Amount (NPR)": Number(c.tax.toFixed(2)),
      "Net Payable Amount (NPR)": Number(c.net.toFixed(2)),
      "Share of Total (%)": totalNet > 0 ? `${((c.net / totalNet) * 100).toFixed(2)}%` : "0%",
    }));

    summaryRows.push({
      "Investor Classification": "TOTAL BATCH SUMMARY",
      "Payee Count": itemsToExport.length,
      "Gross Amount (NPR)": Number(totalGross.toFixed(2)),
      "Tax / TDS Amount (NPR)": Number(totalTax.toFixed(2)),
      "Net Payable Amount (NPR)": Number(totalNet.toFixed(2)),
      "Share of Total (%)": "100.00%",
    });

    const detailRows = itemsToExport.map((item, idx) => {
      const rawCode = item.clients?.payee_classification || "";
      const label = rawCode ? getPayeeCategoryLabel(rawCode) : "Unclassified";
      const panOrCitizenship =
        item.clients?.pan_or_citizenship ||
        item.clients?.pan_no ||
        item.clients?.citizenship_no ||
        "";

      return {
        "S.N": idx + 1,
        "Shareholder / Payee Name": item.clients?.full_name || "Unknown",
        BOID: item.clients?.boid || "",
        "PAN / Citizenship No": panOrCitizenship,
        "Investor Classification": label,
        "Category Code": rawCode,
        Segment: item.clients?.payee_segment || "",
        "Bank Name": item.bank_name || item.clients?.bank_name || "",
        "Bank Account No": item.bank_account_no || item.clients?.bank_account_no || "",
        "Bank Branch": item.clients?.bank_branch || "",
        "Gross Amount (NPR)": Number(item.gross_amount || 0),
        "Tax / TDS Amount (NPR)": Number(item.tax_amount || 0),
        "Net Payable (NPR)": Number(item.net_amount || 0),
        "Payment Method": item.payment_method || batch.payment_method,
        Status: item.status,
        Reference: item.connectips_ref || item.payment_reference || "",
        "Payment Date": item.payment_date || "",
      };
    });

    exportMultiSheetExcel(
      [
        { name: "Classification Summary", rows: summaryRows },
        { name: "Payment Line Items", rows: detailRows },
      ],
      `Payment_Batch_${(batch.batch_name || batch.id.slice(0, 8)).replace(/[^a-zA-Z0-9_-]/g, "_")}_${new Date().toISOString().slice(0, 10)}`,
    );
    toast.success("Payment batch exported to Excel with classification summary.");
  };

  const handleDownloadCorporatePay = async (batch: PaymentBatch) => {
    if (!canExport) {
      toast.error("Unauthorized: You do not have permission to export payment files.");
      return;
    }
    const toastId = toast.loading("Generating NCHL CorporatePay / ConnectIPS batch file...");
    try {
      const res = await ConnectIPSService.generateCorporatePayBatchFile({
        batchId: batch.id,
      });
      toast.dismiss(toastId);
      toast.success(
        `NCHL CorporatePay batch (${res.totalRows} payees, NPR ${res.totalAmount.toLocaleString()}) exported successfully.`,
      );
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(err?.message || "Failed to generate CorporatePay batch file.");
    }
  };

  const handleRejectionFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const toastId = toast.loading(`Parsing disbursement return file: ${file.name}...`);
    try {
      const result = await ConnectIPSService.parseDisbursementReturnFile(file);
      qc.invalidateQueries({ queryKey: ["payment-batches"] });
      qc.invalidateQueries({ queryKey: ["payment-line-items"] });
      qc.invalidateQueries({ queryKey: ["available-payables"] });
      toast.dismiss(toastId);
      if (result.totalFailed > 0) {
        toast.warning(
          `Processed ${result.totalProcessed} records. Flagged ${result.totalFailed} returned/rejected payment(s) and routed them to the Unclaimed/Reissue queue.`,
        );
      } else {
        toast.info(`Processed ${result.totalProcessed} records. No failed payments detected.`);
      }
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(err?.message || "Failed to parse disbursement return file.");
    }
  };

  const openBroadcastDialog = async (batch: PaymentBatch) => {
    setBroadcastBatch(batch);
    setBroadcastTemplateType("PAYMENT_SUCCESS");
    setCustomMessageTemplate(DEFAULT_TEMPLATES.PAYMENT_SUCCESS);

    let items = lineItems;
    if (!items || items.length === 0 || activeBatchId !== batch.id) {
      items = await PaymentService.getAllLineItemsForExport(batch.id);
    }

    const payload = (items || []).map((item) => {
      const client = (item.clients || {}) as Record<string, any>;
      return {
        id: item.id,
        payeeName: client.full_name || "Shareholder",
        boid: client.boid || "",
        phone: client.phone || "",
        email: client.email || undefined,
        companyName: batch.company_id
          ? companies.find((c) => c.id === batch.company_id)?.company_name || "Company"
          : "Company",
        fiscalYear: batch.fiscal_year || "",
        amount: Number(item.net_amount || item.gross_amount || 0),
        reference: item.connectips_ref || item.payment_reference || undefined,
        bankName: item.bank_name || client.bank_name || undefined,
      };
    });

    const summary = SmsBroadcastService.buildBroadcastQueue({
      items: payload,
      templateType: "PAYMENT_SUCCESS",
      customTemplate: DEFAULT_TEMPLATES.PAYMENT_SUCCESS,
    });

    setBroadcastSummary(summary);
    setBroadcastOpen(true);
  };

  const handleTemplateChange = (type: BroadcastTemplateType) => {
    setBroadcastTemplateType(type);
    const newText = DEFAULT_TEMPLATES[type];
    setCustomMessageTemplate(newText);
    if (broadcastSummary) {
      const updated = SmsBroadcastService.buildBroadcastQueue({
        items: broadcastSummary.messages.map((m) => ({
          id: m.id,
          payeeName: m.recipientName,
          boid: m.boid,
          phone: m.phone,
          companyName: m.companyName,
          fiscalYear: m.fiscalYear,
          amount: m.amount,
        })),
        templateType: type,
        customTemplate: newText,
      });
      setBroadcastSummary(updated);
    }
  };

  const [isExportingAvailablePayables, setIsExportingAvailablePayables] = useState(false);
  const handleExportAvailablePayables = async () => {
    if (payablesPreview.count === 0) {
      toast.error("No payables available to export with current filters.");
      return;
    }

    setIsExportingAvailablePayables(true);
    const toastId = toast.loading(
      `Preparing Excel export for ${payablesPreview.count.toLocaleString()} payables...`,
    );
    try {
      const payables = await PaymentService.getPayablesForPayment(
        selectedCompany !== "all" ? selectedCompany : undefined,
        selectedPayableType !== "all" ? selectedPayableType : undefined,
        {
          fiscalYear: fiscalYear || undefined,
          periodPreset,
          periodDays: periodDays ? Number(periodDays) : undefined,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
        },
      );

      if (payables.length === 0) {
        toast.dismiss(toastId);
        toast.error("No payables found to export.");
        return;
      }

      // 1. Group by Classification to generate exact classification-wise statutory summary
      const classificationMap = new Map<
        string,
        {
          category: string;
          rawCode: string;
          count: number;
          shares: number;
          gross: number;
          tax: number;
          net: number;
        }
      >();

      payables.forEach((p) => {
        const rawCode = p.payee_classification || p.clients?.payee_classification || "UNCLASSIFIED";
        const label = getPayeeCategoryLabel(rawCode);
        const gross = Number(p.gross_dividend ?? p.gross_interest ?? 0);
        const tax = Number(p.tax_amount ?? 0);
        const net = Number(p.net_payable ?? gross - tax);
        const shares = Number(p.shares_held ?? p.kitta ?? p.clients?.kitta ?? 0);

        if (!classificationMap.has(label)) {
          classificationMap.set(label, {
            category: label,
            rawCode,
            count: 0,
            shares: 0,
            gross: 0,
            tax: 0,
            net: 0,
          });
        }
        const entry = classificationMap.get(label)!;
        entry.count += 1;
        entry.shares += shares;
        entry.gross += gross;
        entry.tax += tax;
        entry.net += net;
      });

      const totalGross = Array.from(classificationMap.values()).reduce(
        (sum, c) => sum + c.gross,
        0,
      );
      const totalTax = Array.from(classificationMap.values()).reduce((sum, c) => sum + c.tax, 0);
      const totalNet = Array.from(classificationMap.values()).reduce((sum, c) => sum + c.net, 0);
      const totalShares = Array.from(classificationMap.values()).reduce(
        (sum, c) => sum + c.shares,
        0,
      );

      const summaryRows = Array.from(classificationMap.values()).map((c) => ({
        "Investor Classification": c.category,
        "System Category Code": c.rawCode,
        "Shareholder / Payee Count": c.count,
        "Total Shares / Kitta": c.shares,
        "Gross Payable (NPR)": Number(c.gross.toFixed(2)),
        "TDS / Tax Withheld (NPR)": Number(c.tax.toFixed(2)),
        "Net Payable Amount (NPR)": Number(c.net.toFixed(2)),
        "Share of Net Total (%)": totalNet > 0 ? `${((c.net / totalNet) * 100).toFixed(2)}%` : "0%",
      }));

      // Add Total Row to Summary
      summaryRows.push({
        "Investor Classification": "TOTAL STATUTORY SUMMARY",
        "System Category Code": "ALL",
        "Shareholder / Payee Count": payables.length,
        "Total Shares / Kitta": totalShares,
        "Gross Payable (NPR)": Number(totalGross.toFixed(2)),
        "TDS / Tax Withheld (NPR)": Number(totalTax.toFixed(2)),
        "Net Payable Amount (NPR)": Number(totalNet.toFixed(2)),
        "Share of Net Total (%)": "100.00%",
      });

      // 2. Build full line-by-line real shareholder payable list
      const detailRows = payables.map((p, idx) => {
        const gross = Number(p.gross_dividend ?? p.gross_interest ?? 0);
        const tax = Number(p.tax_amount ?? 0);
        const net = Number(p.net_payable ?? gross - tax);
        const rawCode = p.payee_classification || p.clients?.payee_classification || "";
        const label = rawCode ? getPayeeCategoryLabel(rawCode) : "Unclassified";
        const shares = Number(p.shares_held ?? p.kitta ?? p.clients?.kitta ?? 0);
        const rate = p.dividend_rate ?? p.interest_rate_value ?? "";
        const tdsRate =
          p.tds_rate != null
            ? `${Number(p.tds_rate) <= 1 ? (Number(p.tds_rate) * 100).toFixed(1) : Number(p.tds_rate)}%`
            : "";
        const panOrCitizenship =
          p.clients?.pan_or_citizenship || p.clients?.pan_no || p.clients?.citizenship_no || "";

        return {
          "S.N": idx + 1,
          "Company Code": p.companies?.company_code || "",
          "Company Name": p.companies?.company_name || "",
          "Shareholder / Payee Name": p.clients?.full_name || p.full_name || "Unknown",
          BOID: p.clients?.boid || p.boid || "",
          "PAN / Citizenship No": panOrCitizenship,
          "Investor Classification": label,
          "Category Code": rawCode,
          Segment: p.payee_segment || p.clients?.payee_segment || "",
          "Shares / Units Held": shares,
          "Rate (%)": rate,
          "Gross Amount (NPR)": gross,
          "TDS Rate": tdsRate,
          "Tax / TDS Amount (NPR)": tax,
          "Net Payable (NPR)": net,
          "Paid Amount (NPR)": Number(p.paid_amount ?? 0),
          "Remaining Amount (NPR)": Number(
            p.remaining_amount ?? (p.payment_status === "Paid" ? 0 : net),
          ),
          "Bank Name": p.bank_name || p.clients?.bank_name || "",
          "Bank Account No": p.bank_account_no || p.clients?.bank_account_no || "",
          "Bank Branch": p.bank_branch || p.clients?.bank_branch || "",
          "Payable Type": (p.payable_type || selectedPayableType || "").toUpperCase(),
          "Payment Status": p.payment_status || "Pending",
          "Fiscal Year": p.fiscal_year || fiscalYear,
        };
      });

      const compCode =
        selectedCompany !== "all"
          ? companies.find((c: any) => c.id === selectedCompany)?.company_code || "Company"
          : "All_Companies";

      exportMultiSheetExcel(
        [
          { name: "Classification Summary", rows: summaryRows },
          { name: "Shareholder Payable List", rows: detailRows },
        ],
        `Available_Payables_List_${compCode}_${new Date().toISOString().slice(0, 10)}`,
      );
      toast.dismiss(toastId);
      toast.success(
        `Exported ${detailRows.length.toLocaleString()} payables across ${classificationMap.size} investor categories to Excel.`,
      );
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(`Export failed: ${err?.message || err}`);
    } finally {
      setIsExportingAvailablePayables(false);
    }
  };

  const statusVariant = (status: string) => getPaymentStatusPresentation(status).variant;
  const statusBadgeClass = (status: string) => getPaymentStatusPresentation(status).className;

  const batchTotals = useMemo(() => {
    if (
      activeBatchData &&
      (activeBatchData.total_payments != null || activeBatchData.total_amount != null)
    ) {
      return {
        count: Number(activeBatchData.total_payments || 0),
        total: Number(activeBatchData.total_amount || 0),
      };
    }
    if (!lineItems) return { count: 0, total: 0 };
    return {
      count: lineItems.length,
      total: lineItems.reduce((sum, item) => sum + (item.net_amount || 0), 0),
    };
  }, [activeBatchData, lineItems]);

  const filteredBatches = useMemo(() => {
    if (!payments) return [];
    return payments.filter((b: any) => {
      if (tableStatusFilter !== "all" && (b.status || "Draft") !== tableStatusFilter) return false;
      if (tableSearch) {
        const q = tableSearch.toLowerCase();
        const matchesName = b.batch_name?.toLowerCase().includes(q);
        const matchesRef = b.cds_batch_ref?.toLowerCase().includes(q);
        const matchesMethod = b.payment_method?.toLowerCase().includes(q);
        if (!matchesName && !matchesRef && !matchesMethod) return false;
      }
      if (tableFromDate) {
        const batchDate = b.created_at ? b.created_at.slice(0, 10) : "";
        if (batchDate && batchDate < tableFromDate) return false;
      }
      if (tableToDate) {
        const batchDate = b.created_at ? b.created_at.slice(0, 10) : "";
        if (batchDate && batchDate > tableToDate) return false;
      }
      return true;
    });
  }, [payments, tableStatusFilter, tableSearch, tableFromDate, tableToDate]);

  const totalBatchAmount = filteredBatches.reduce(
    (sum: number, p: any) => sum + (p.total_amount || 0),
    0,
  );
  const totalBatchCount = filteredBatches.length;

  // Pagination for Batches Table
  const [batchesPage, setBatchesPage] = useState<number>(1);
  const [batchesPageSize, setBatchesPageSize] = useState<number>(10);
  const batchesTotalPages = Math.max(1, Math.ceil(totalBatchCount / batchesPageSize));
  const safeBatchesPage = Math.min(batchesPage, batchesTotalPages);
  const paginatedBatches = useMemo(() => {
    const start = (safeBatchesPage - 1) * batchesPageSize;
    return filteredBatches.slice(start, start + batchesPageSize);
  }, [filteredBatches, safeBatchesPage, batchesPageSize]);

  // Pagination for Active Batch Line Items in Modal
  const [lineItemsPage, setLineItemsPage] = useState<number>(1);
  const [lineItemsPageSize, setLineItemsPageSize] = useState<number>(10);
  const totalLineItems = activeBatchData?.total_payments || lineItems?.length || 0;
  const lineItemsTotalPages = Math.max(1, Math.ceil(totalLineItems / lineItemsPageSize));
  const safeLineItemsPage = Math.min(lineItemsPage, lineItemsTotalPages);
  const paginatedLineItems = useMemo(() => {
    const start = (safeLineItemsPage - 1) * lineItemsPageSize;
    return (lineItems || []).slice(start, start + lineItemsPageSize);
  }, [lineItems, safeLineItemsPage, lineItemsPageSize]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <PageHeader
          title="Payments Module"
          description="Create payment batches, manage installment tranches, generate clearing manifests (ConnectIPS, NCHL, RTGS), and authorize disbursements."
        />
        <div className="flex items-center gap-2">
          <BankErrorUploadDialog
            companyId={selectedCompany}
            onSuccess={() => {
              qc.invalidateQueries({ queryKey: ["payment-batches"] });
            }}
          />
          <Button
            variant="outline"
            onClick={handleExportAvailablePayables}
            disabled={payablesPreview.count === 0 || isExportingAvailablePayables}
          >
            {isExportingAvailablePayables ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-4 h-4 mr-2 text-emerald-600" />
            )}
            Download Payables ({payablesPreview.count.toLocaleString()})
          </Button>
          <CreatePaymentBatchDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            batchName={batchName}
            setBatchName={setBatchName}
            selectedCompany={selectedCompany}
            setSelectedCompany={setSelectedCompany}
            selectedPayableType={selectedPayableType}
            setSelectedPayableType={setSelectedPayableType}
            periodPreset={periodPreset}
            setPeriodPreset={setPeriodPreset}
            periodDays={periodDays}
            setPeriodDays={setPeriodDays}
            fromDate={fromDate}
            setFromDate={setFromDate}
            toDate={toDate}
            setToDate={setToDate}
            fiscalYear={fiscalYear}
            setFiscalYear={setFiscalYear}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            installmentTag={installmentTag}
            setInstallmentTag={setInstallmentTag}
            companies={companies}
            fiscalYears={fiscalYears}
            payablesPreview={payablesPreview}
            isPreviewLoading={isPreviewLoading}
            isExportingAvailablePayables={isExportingAvailablePayables}
            onExportAvailablePayables={handleExportAvailablePayables}
            isPending={isPending}
            createBatchProgress={createBatchProgress}
            onCreateBatch={() => createBatch()}
          />
        </div>
      </div>

      {/* Corporate Action Declaration Live Status */}
      <DeclarationSummaryCard companyId={selectedCompany} />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/60 shadow-sm hover:shadow transition-shadow">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total Payment Batches
            </p>
            <p className="text-2xl font-bold font-mono tracking-tight mt-1">{totalBatchCount}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Across all payable types</p>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-sm hover:shadow transition-shadow">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total Batch Value
            </p>
            <p className="text-2xl font-bold font-mono tracking-tight mt-1">
              NPR {totalBatchAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Disbursement gross sum</p>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-sm hover:shadow transition-shadow">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Draft Batches
            </p>
            <p className="text-2xl font-bold font-mono tracking-tight mt-1">
              {filteredBatches.filter((p: any) => p.status === "Draft").length}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Staged for verification</p>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-sm hover:shadow transition-shadow">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Approved Batches
            </p>
            <p className="text-2xl font-bold font-mono tracking-tight mt-1">
              {filteredBatches.filter((p: any) => p.status === "Approved").length}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Ready for clearing transmission
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Top Navigation Tabs */}
      <Tabs
        value={paymentsActiveTab}
        onValueChange={(v: any) => setPaymentsActiveTab(v)}
        className="space-y-4"
      >
        <TabsList className="grid grid-cols-2 max-w-lg h-10">
          <TabsTrigger value="batches" className="text-xs font-semibold gap-2">
            <Layers className="w-4 h-4" />
            Payment Batches ({filteredBatches.length})
          </TabsTrigger>
          <TabsTrigger value="shareholders" className="text-xs font-semibold gap-2">
            <User className="w-4 h-4" />
            Shareholder Payouts & BOID Search
          </TabsTrigger>
        </TabsList>

        <TabsContent value="batches" className="space-y-4 mt-0">
          {/* Filter Toolbar */}
          <div className="flex flex-wrap items-center gap-2.5 bg-card p-3 rounded-lg border">
            <Input
              placeholder="Search batch name, reference, or method..."
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              className="max-w-xs h-9 text-xs"
            />
            <Select value={tableStatusFilter} onValueChange={setTableStatusFilter}>
              <SelectTrigger className="w-36 h-9 text-xs">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="Draft">Draft</SelectItem>
                <SelectItem value="Pending">Pending Approval</SelectItem>
                <SelectItem value="Approved">Approved</SelectItem>
                <SelectItem value="Processed">Processed (In Clearing)</SelectItem>
                <SelectItem value="Completed">Completed</SelectItem>
                <SelectItem value="Failed">Failed</SelectItem>
                <SelectItem value="Returned">Returned</SelectItem>
                <SelectItem value="Rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>

            {/* Period Quick Presets */}
            <div className="flex items-center gap-1 bg-background border rounded px-1.5 py-0.5 h-9">
              <span className="text-[11px] text-muted-foreground whitespace-nowrap mr-0.5">
                Period:
              </span>
              {(["3M", "6M", "9M", "12M"] as PeriodPreset[]).map((p) => {
                const days = STANDARD_PERIODS[p].days;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setTablePeriodPreset(p);
                      const end = new Date();
                      const start = new Date();
                      start.setDate(end.getDate() - days);
                      setTableFromDate(start.toISOString().slice(0, 10));
                      setTableToDate(end.toISOString().slice(0, 10));
                    }}
                    className={`text-[11px] font-medium px-2 py-1 rounded transition-colors ${
                      tablePeriodPreset === p
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>

            {/* Date Range Search */}
            <div className="flex items-center gap-1.5 bg-background border rounded-md px-2.5 h-9 text-xs shadow-2xs">
              <span className="text-[11px] text-muted-foreground whitespace-nowrap font-medium">
                From:
              </span>
              <input
                type="date"
                value={tableFromDate}
                onChange={(e) => {
                  setTableFromDate(e.target.value);
                  setTablePeriodPreset("CUSTOM");
                }}
                className="w-[125px] shrink-0 bg-transparent text-xs outline-none font-mono"
              />
              <span className="text-muted-foreground/40 font-light">|</span>
              <span className="text-[11px] text-muted-foreground whitespace-nowrap font-medium">
                To:
              </span>
              <input
                type="date"
                value={tableToDate}
                onChange={(e) => {
                  setTableToDate(e.target.value);
                  setTablePeriodPreset("CUSTOM");
                }}
                className="w-[125px] shrink-0 bg-transparent text-xs outline-none font-mono"
              />
              {(tableFromDate || tableToDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setTableFromDate("");
                    setTableToDate("");
                    setTablePeriodPreset("ALL");
                  }}
                  className="ml-1 text-[11px] text-destructive hover:underline font-semibold shrink-0"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Bank Rejection Reconciler */}
            <div className="flex items-center gap-2">
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleRejectionFileUpload}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs border-dashed text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                  asChild
                >
                  <span>
                    <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5 text-amber-600" />
                    Reconcile Bank Returns / Rejections
                  </span>
                </Button>
              </label>
            </div>
          </div>

          {/* Batches Table */}
          <div className="border rounded-lg bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch Name</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                  <TableHead className="text-right">Total Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : paginatedBatches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No payment batches match the selected filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedBatches.map((batch: any) => (
                    <TableRow
                      key={batch.id}
                      className={activeBatchId === batch.id ? "bg-muted/30" : ""}
                    >
                      <TableCell className="font-medium">
                        <div>
                          {batch.batch_name}
                          {batch.cds_batch_ref && (
                            <span className="ml-2 text-xs text-muted-foreground font-mono bg-muted/60 px-1.5 py-0.5 rounded">
                              {batch.cds_batch_ref}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {batch.payment_method}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {Number(batch.total_payments || 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums font-semibold">
                        NPR{" "}
                        {(batch.total_amount || 0).toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={statusVariant(batch.status || "Draft")}
                          className={statusBadgeClass(batch.status || "Draft")}
                        >
                          {batch.status || "Draft"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(batch.created_at || new Date()), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setActiveBatchId(batch.id)}
                          >
                            <Eye className="w-3 h-3 mr-1" />
                            View
                          </Button>
                          {(batch.status === "Approved" ||
                            batch.status === "Draft" ||
                            batch.status === "Processed" ||
                            batch.status === "Completed" ||
                            batch.status === "Failed" ||
                            batch.status === "Returned") && (
                            <>
                              {(batch.status === "Processed" ||
                                batch.status === "Failed" ||
                                batch.status === "Returned") && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-sky-600 hover:text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950"
                                  title="Sync NCHL ConnectIPS Payment Status"
                                  disabled={isSyncingConnectIps}
                                  onClick={() => handleSyncBatchStatuses(batch.id)}
                                >
                                  {isSyncingConnectIps ? (
                                    <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                                  ) : (
                                    <RefreshCw className="w-3.5 h-3.5 mr-1" />
                                  )}
                                  Sync
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                                title="Download Batch in Excel (.xlsx)"
                                onClick={() => handleDownloadExcel(batch)}
                              >
                                <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />
                                Excel
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950"
                                title="Download NCHL CorporatePay / ConnectIPS Batch File"
                                onClick={() => handleDownloadCorporatePay(batch)}
                              >
                                <CreditCard className="w-3.5 h-3.5 mr-1" />
                                CorporatePay
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-purple-600 hover:text-purple-700 hover:bg-purple-50 dark:hover:bg-purple-950"
                                title="Send SMS / Email Payment Alerts"
                                onClick={() => openBroadcastDialog(batch)}
                              >
                                <Send className="w-3.5 h-3.5 mr-1" />
                                SMS Alert
                              </Button>
                              {isAdmin && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950"
                                  title="Revert Payment Batch & Reset Payables to Pending (Admin Only)"
                                  disabled={isRevertingBatch}
                                  onClick={() => {
                                    if (
                                      confirm(
                                        `Are you sure you want to revert completed batch "${batch.batch_name}"?\n\nThis will reset all its associated payables back to "Pending" and delete this payment batch record.`,
                                      )
                                    ) {
                                      revertBatch(batch);
                                    }
                                  }}
                                >
                                  <RotateCcw className="w-3 h-3 mr-1" />
                                  Revert
                                </Button>
                              )}
                            </>
                          )}
                          {batch.status === "Draft" && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950"
                                title="Submit for Maker/Checker Approval"
                                onClick={() => {
                                  updateBatchStatus({ batchId: batch.id, action: "submit" });
                                }}
                              >
                                <Send className="w-3 h-3 mr-1" />
                                Submit
                              </Button>
                              {isAdmin && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-destructive hover:bg-destructive/10"
                                  title="Delete Draft Batch (Admin Only)"
                                  disabled={isDeletingBatch}
                                  onClick={() => {
                                    if (
                                      confirm(
                                        `Are you sure you want to delete draft batch "${batch.batch_name}"?`,
                                      )
                                    ) {
                                      deleteBatch(batch.id);
                                    }
                                  }}
                                >
                                  <Trash2 className="w-3 h-3 mr-1" />
                                  Delete
                                </Button>
                              )}
                            </>
                          )}
                          {batch.status === "Pending" && canApprove && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                                title="Approve Batch"
                                onClick={() => {
                                  updateBatchStatus({ batchId: batch.id, action: "approve" });
                                }}
                              >
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Approve
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-destructive hover:bg-destructive/10"
                                title="Reject Batch"
                                onClick={() => {
                                  updateBatchStatus({ batchId: batch.id, action: "reject" });
                                }}
                              >
                                <XCircle className="w-3 h-3 mr-1" />
                                Reject
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {totalBatchCount > 0 && (
              <div className="flex flex-wrap items-center justify-between border-t px-4 py-3 gap-2 bg-muted/20">
                <div className="text-xs text-muted-foreground">
                  Showing {(safeBatchesPage - 1) * batchesPageSize + 1} to{" "}
                  {Math.min(safeBatchesPage * batchesPageSize, totalBatchCount)} of{" "}
                  {totalBatchCount} batches
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={batchesPageSize}
                    onChange={(e) => {
                      setBatchesPageSize(Number(e.target.value));
                      setBatchesPage(1);
                    }}
                    className="h-8 rounded border bg-background px-2 text-xs"
                  >
                    <option value="10">10 / page</option>
                    <option value="25">25 / page</option>
                    <option value="50">50 / page</option>
                    <option value="100">100 / page</option>
                  </select>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setBatchesPage(1)}
                    disabled={safeBatchesPage === 1}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setBatchesPage((p) => Math.max(1, p - 1))}
                    disabled={safeBatchesPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground px-1.5 font-medium">
                    {safeBatchesPage} / {batchesTotalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setBatchesPage((p) => Math.min(batchesTotalPages, p + 1))}
                    disabled={safeBatchesPage === batchesTotalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setBatchesPage(batchesTotalPages)}
                    disabled={safeBatchesPage === batchesTotalPages}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Individual Shareholder Payouts Tab */}
        <TabsContent value="shareholders" className="space-y-4 mt-0">
          <div className="flex flex-wrap items-center gap-2.5 bg-card p-3 rounded-lg border">
            <div className="relative flex-1 min-w-[260px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by BOID (16 digits), Shareholder Name, Bank A/C, or Ref ID..."
                value={shareholderSearch}
                onChange={(e) => setShareholderSearch(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>
            <Select value={shareholderCompany} onValueChange={setShareholderCompany}>
              <SelectTrigger className="w-48 h-9 text-xs">
                <SelectValue placeholder="All Companies" />
              </SelectTrigger>
              <SelectContent className="max-h-60 overflow-y-auto">
                <SelectItem value="all">All Companies</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.company_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={shareholderStatus} onValueChange={setShareholderStatus}>
              <SelectTrigger className="w-36 h-9 text-xs">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="Completed">Completed / Paid</SelectItem>
                <SelectItem value="Processing">Processing (NCHL Clearing)</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="Failed">Failed / Bounced</SelectItem>
                <SelectItem value="Returned">Returned</SelectItem>
                <SelectItem value="Rejected">Rejected</SelectItem>
                <SelectItem value="Reversed">Reversed</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
              {filteredIndividualPayments.length.toLocaleString()} shareholder records
            </span>
          </div>

          <div className="border rounded-lg bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs">BOID</TableHead>
                  <TableHead className="text-xs">Shareholder Name</TableHead>
                  <TableHead className="text-xs">Company / Scheme</TableHead>
                  <TableHead className="text-right text-xs">Gross (NPR)</TableHead>
                  <TableHead className="text-right text-xs">Tax (TDS)</TableHead>
                  <TableHead className="text-right text-xs">Net Paid (NPR)</TableHead>
                  <TableHead className="text-xs">Bank Details</TableHead>
                  <TableHead className="text-xs">Date / Ref</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-right text-xs">Statement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isIndividualLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      Loading individual payments...
                    </TableCell>
                  </TableRow>
                ) : paginatedShareholders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      No shareholder transactions found matching your search.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedShareholders.map((p: any) => (
                    <TableRow key={p.id} className="hover:bg-muted/30 text-xs">
                      <TableCell className="font-mono font-semibold text-primary">
                        <button
                          type="button"
                          className="hover:underline cursor-pointer"
                          onClick={() => setSelectedStatementBoid(p.client?.boid || p.boid)}
                        >
                          {p.client?.boid || p.boid || "—"}
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{p.client?.full_name || "Shareholder"}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {p.client?.holder_type || "Public"}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-muted-foreground">
                        {p.company?.company_name || "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {Number(p.gross_amount || 0).toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell className="text-right font-mono text-amber-600">
                        {Number(p.tax_amount || 0).toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-emerald-600">
                        {Number(p.paid_amount || p.net_amount || 0).toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell>
                        <div className="truncate max-w-[150px]">
                          {p.bank_name || p.client?.bank_name || "—"}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {p.bank_account_no || p.client?.bank_account_no || "—"}
                        </div>
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">
                        <div>
                          {p.payment_date ? format(new Date(p.payment_date), "dd MMM yyyy") : "—"}
                        </div>
                        <div className="font-mono text-[10px]">
                          {p.payment_reference || p.connectips_ref || p.payment_method}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={statusVariant(p.status)}
                          className={`text-[10px] ${statusBadgeClass(p.status)}`}
                        >
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {(p.status === "Processing" ||
                            p.status === "Pending" ||
                            p.status === "Failed" ||
                            p.status === "Returned" ||
                            Boolean(p.connectips_ref || p.payment_reference)) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-sky-700 hover:text-sky-800 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/30 cursor-pointer"
                              title="Inquire & sync NCHL ConnectIPS status"
                              disabled={checkingPaymentId === p.id}
                              onClick={() =>
                                handleCheckSinglePaymentStatus({
                                  paymentId: p.id,
                                  referenceId: p.connectips_ref || p.payment_reference,
                                  batchId: p.batch_id,
                                })
                              }
                            >
                              {checkingPaymentId === p.id ? (
                                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5 mr-1" />
                              )}
                              Status
                            </Button>
                          )}
                          {(p.status === "Failed" ||
                            p.status === "Pending" ||
                            p.status === "Rejected") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-amber-700 hover:text-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/20 cursor-pointer"
                              title="Remediate Bank Details & Re-queue Payout"
                              onClick={() => {
                                setRemediationItems([
                                  {
                                    payable_id: p.payable_id || p.id,
                                    payable_type: (p.payable_type as any) || "interest",
                                    client_id: p.client_id || p.client?.id || null,
                                    full_name: p.client?.full_name || p.full_name || "Shareholder",
                                    boid: p.client?.boid || p.boid || null,
                                    pan_or_citizenship: p.client?.pan_or_citizenship || null,
                                    current_bank_name: p.bank_name || p.client?.bank_name || null,
                                    current_bank_account_no:
                                      p.bank_account_no || p.client?.bank_account_no || null,
                                    rejection_reason: p.remarks || "Payment failed / rejected",
                                    net_payable: Number(p.net_amount || p.amount || 0),
                                  },
                                ]);
                                setRemediationDialogOpen(true);
                              }}
                            >
                              <CreditCard className="w-3.5 h-3.5 mr-1 text-amber-600" />
                              Remediate
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-primary hover:bg-primary/10 cursor-pointer"
                            onClick={() => setSelectedStatementBoid(p.client?.boid || p.boid)}
                          >
                            <FileText className="w-3.5 h-3.5 mr-1" />
                            Statement
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {totalShareholders > 0 && (
              <div className="flex flex-wrap items-center justify-between border-t px-4 py-3 gap-2 bg-muted/20">
                <div className="text-xs text-muted-foreground">
                  Showing {(safeShareholderPage - 1) * shareholderPageSize + 1} to{" "}
                  {Math.min(safeShareholderPage * shareholderPageSize, totalShareholders)} of{" "}
                  {totalShareholders} transactions
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={shareholderPageSize}
                    onChange={(e) => {
                      setShareholderPageSize(Number(e.target.value));
                      setShareholderPage(1);
                    }}
                    className="h-8 rounded border bg-background px-2 text-xs"
                  >
                    <option value="15">15 / page</option>
                    <option value="25">25 / page</option>
                    <option value="50">50 / page</option>
                    <option value="100">100 / page</option>
                  </select>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setShareholderPage(1)}
                    disabled={safeShareholderPage === 1}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setShareholderPage((p) => Math.max(1, p - 1))}
                    disabled={safeShareholderPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground px-1.5 font-medium">
                    {safeShareholderPage} / {shareholderTotalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() =>
                      setShareholderPage((p) => Math.min(shareholderTotalPages, p + 1))
                    }
                    disabled={safeShareholderPage === shareholderTotalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setShareholderPage(shareholderTotalPages)}
                    disabled={safeShareholderPage === shareholderTotalPages}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Batch Detail Dialog */}
      <Dialog open={!!activeBatchId} onOpenChange={(open) => !open && setActiveBatchId(null)}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Batch Details</DialogTitle>
          </DialogHeader>
          {activeBatchData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3 border-b pb-3">
                <div>
                  <p className="text-xs text-muted-foreground">Batch Name</p>
                  <p className="text-sm font-medium">{activeBatchData.batch_name}</p>
                  {activeBatchData.cds_batch_ref && (
                    <p className="text-xs font-mono text-primary mt-0.5">
                      Ref: {activeBatchData.cds_batch_ref}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Company</p>
                  <p className="text-sm font-medium">
                    {(activeBatchData as any).companies?.company_code ||
                      (activeBatchData as any).companies?.company_name ||
                      (activeBatchData as any).company?.company_code ||
                      "All"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Payable Type / FY</p>
                  <p className="text-sm font-medium capitalize">
                    {activeBatchData.payable_type || "All"} ({activeBatchData.fiscal_year || "All"})
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Payment Method</p>
                  <p className="text-sm font-medium">{activeBatchData.payment_method}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge
                    variant={statusVariant(activeBatchData.status)}
                    className={statusBadgeClass(activeBatchData.status)}
                  >
                    {activeBatchData.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Amount</p>
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    NPR{" "}
                    {(activeBatchData.total_amount || 0).toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                </div>
              </div>

              {activeBatchData.status === "Draft" && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditBatchName(activeBatchData.batch_name || "");
                      setEditFiscalYear(activeBatchData.fiscal_year || "");
                      setEditPayableType(activeBatchData.payable_type || "dividend");
                      setEditPaymentMethod(
                        (activeBatchData.payment_method as PaymentMethod) || "ConnectIPS",
                      );
                      setEditCdsBatchRef(activeBatchData.cds_batch_ref || "");
                      setEditRegistrar(activeBatchData.registrar || "");
                      setEditBatchOpen(true);
                    }}
                  >
                    <Edit3 className="w-4 h-4 mr-1.5 text-sky-600" />
                    Edit Batch
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isAddingPayables || unbatchedPayablesForActiveBatch.length === 0}
                    onClick={() => {
                      if (
                        activeBatchId &&
                        confirm(
                          `Add all ${unbatchedPayablesForActiveBatch.length} matching pending payables to this batch?`,
                        )
                      ) {
                        addPayablesToBatch(activeBatchId);
                      }
                    }}
                  >
                    {isAddingPayables ? (
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4 mr-1.5 text-emerald-600" />
                    )}
                    Add Payables ({unbatchedPayablesForActiveBatch.length} available)
                  </Button>
                  <Button
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white font-medium shadow-sm"
                    onClick={() => {
                      const count =
                        activeBatchData?.total_payments != null &&
                        activeBatchData.total_payments > 0
                          ? activeBatchData.total_payments
                          : lineItems?.length || 0;
                      if (count === 0) {
                        toast.error("Cannot submit an empty batch. Please add payables first.");
                        return;
                      }
                      if (activeBatchId) {
                        updateBatchStatus({ batchId: activeBatchId, action: "submit" });
                      }
                    }}
                  >
                    <Send className="w-4 h-4 mr-1.5" />
                    Submit for Approval
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDownloadExcel(activeBatchData)}
                  >
                    <FileSpreadsheet className="w-4 h-4 mr-1.5 text-emerald-600" />
                    Export Excel (.xlsx)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:bg-destructive/10"
                    disabled={isDeletingBatch}
                    onClick={() => {
                      if (
                        confirm(
                          `Are you sure you want to delete draft batch "${activeBatchData.batch_name}"?`,
                        )
                      ) {
                        deleteBatch(activeBatchData.id);
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4 mr-1.5" />
                    Delete Batch
                  </Button>
                </div>
              )}

              {activeBatchData.status === "Pending" && (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 px-3 py-1.5 text-xs font-medium mr-2"
                  >
                    Awaiting Checker / Supervisor Approval
                  </Badge>
                  {canApprove && (
                    <>
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm"
                        onClick={() => {
                          if (activeBatchId) {
                            updateBatchStatus({ batchId: activeBatchId, action: "approve" });
                          }
                        }}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1.5" />
                        Approve Batch
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          if (activeBatchId) {
                            updateBatchStatus({ batchId: activeBatchId, action: "reject" });
                          }
                        }}
                      >
                        <XCircle className="w-4 h-4 mr-1.5" />
                        Reject Batch
                      </Button>
                    </>
                  )}
                  {canExport && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownloadExcel(activeBatchData)}
                    >
                      <FileSpreadsheet className="w-4 h-4 mr-1.5 text-emerald-600" />
                      Export Excel (.xlsx)
                    </Button>
                  )}
                </div>
              )}

              {activeBatchData.status === "Approved" && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm"
                    disabled={isDisbursing}
                    onClick={async () => {
                      const count =
                        activeBatchData?.total_payments != null &&
                        activeBatchData.total_payments > 0
                          ? activeBatchData.total_payments
                          : lineItems?.length || 0;
                      if (count === 0) {
                        toast.error("Cannot disburse an empty batch. Please add payables first.");
                        return;
                      }
                      const totalFormatted = Number(
                        activeBatchData.total_amount || 0,
                      ).toLocaleString("en-IN", { minimumFractionDigits: 2 });
                      if (
                        !confirm(
                          `Are you sure you want to disburse NPR ${totalFormatted} across ${count.toLocaleString()} payables directly via ConnectIPS API?`,
                        )
                      ) {
                        return;
                      }
                      setIsDisbursing(true);
                      setDisburseProgress(null);
                      try {
                        const { ConnectIPSService } =
                          await import("@/lib/services/connectips.service");
                        const res = await ConnectIPSService.disbursePaymentBatch(
                          activeBatchId!,
                          (done, total) => setDisburseProgress({ done, total }),
                        );
                        invalidatePaymentLedgers(activeBatchId);
                        if (res.success && (res.totalProcessing || 0) === 0) {
                          toast.success(
                            `Disbursed ${res.totalSuccess} payments (NPR ${res.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}) successfully via ConnectIPS.`,
                          );
                        } else if ((res.totalProcessing || 0) > 0 || res.totalSuccess > 0) {
                          toast.info(
                            `ConnectIPS batch processed: ${res.totalSuccess} settled, ${res.totalProcessing || 0} processing in NCHL clearing, ${res.totalFailed} failed.`,
                          );
                        } else {
                          toast.error(
                            `Disbursement failed: ${res.results[0]?.errorMessage || "Error executing gateway payment"}`,
                          );
                        }
                      } catch (err: any) {
                        toast.error(`ConnectIPS API error: ${err?.message || err}`);
                      } finally {
                        setIsDisbursing(false);
                        setDisburseProgress(null);
                      }
                    }}
                  >
                    {isDisbursing ? (
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4 mr-1.5" />
                    )}
                    {isDisbursing
                      ? disburseProgress
                        ? `Disbursing… ${disburseProgress.done}/${disburseProgress.total}`
                        : "Disbursing via ConnectIPS…"
                      : "Disburse via ConnectIPS API"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const count =
                        activeBatchData?.total_payments != null &&
                        activeBatchData.total_payments > 0
                          ? activeBatchData.total_payments
                          : lineItems?.length || 0;
                      if (count === 0) {
                        toast.error("Cannot process an empty batch.");
                        return;
                      }
                      if (activeBatchId) {
                        updateBatchStatus({ batchId: activeBatchId, status: "Processed" });
                      }
                    }}
                  >
                    Mark as Processed
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDownloadExcel(activeBatchData)}
                  >
                    <FileSpreadsheet className="w-4 h-4 mr-1.5 text-emerald-600" />
                    Export Excel (.xlsx)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDownloadPaymentFile(activeBatchData)}
                  >
                    <Download className="w-4 h-4 mr-1.5" />
                    Download {activeBatchData.payment_method} File
                  </Button>
                </div>
              )}

              {(activeBatchData.status === "Processed" ||
                activeBatchData.status === "Failed" ||
                activeBatchData.status === "Returned") && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-sky-300 text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-950/30"
                    disabled={isSyncingConnectIps}
                    onClick={() => activeBatchId && handleSyncBatchStatuses(activeBatchId)}
                  >
                    {isSyncingConnectIps ? (
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-1.5" />
                    )}
                    Sync ConnectIPS Status
                  </Button>
                  {activeBatchData.status === "Processed" && canApprove && (
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm"
                      onClick={() => {
                        if (activeBatchId) {
                          updateBatchStatus({ batchId: activeBatchId, action: "complete" });
                        }
                      }}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1.5" />
                      Complete Batch
                    </Button>
                  )}
                  {(lineItems || []).some(
                    (it) =>
                      it.status === "Failed" ||
                      it.status === "Rejected" ||
                      it.status === "Returned" ||
                      it.status === "Pending",
                  ) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isDisbursing}
                      onClick={async () => {
                        if (!activeBatchId) return;
                        setIsDisbursing(true);
                        setDisburseProgress(null);
                        try {
                          const res = await ConnectIPSService.disbursePaymentBatch(
                            activeBatchId,
                            (done, total) => setDisburseProgress({ done, total }),
                            { retryFailedOnly: false },
                          );
                          invalidatePaymentLedgers(activeBatchId);
                          if (res.success && (res.totalProcessing || 0) === 0) {
                            toast.success(`Retried & settled ${res.totalSuccess} payment(s).`);
                          } else {
                            toast.info(
                              `ConnectIPS retry: ${res.totalSuccess} settled, ${res.totalProcessing || 0} processing, ${res.totalFailed} failed.`,
                            );
                          }
                        } catch (err: any) {
                          toast.error(`Retry failed: ${err?.message || err}`);
                        } finally {
                          setIsDisbursing(false);
                          setDisburseProgress(null);
                        }
                      }}
                    >
                      {isDisbursing ? (
                        <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4 mr-1.5" />
                      )}
                      Retry Unsettled via ConnectIPS
                    </Button>
                  )}
                  {canExport && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownloadExcel(activeBatchData)}
                    >
                      <FileSpreadsheet className="w-4 h-4 mr-1.5 text-emerald-600" />
                      Export Excel (.xlsx)
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDownloadPaymentFile(activeBatchData)}
                  >
                    <Download className="w-4 h-4 mr-1.5" />
                    Download {activeBatchData.payment_method} File
                  </Button>
                </div>
              )}

              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Bank &amp; Reference</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Net Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lineItemsLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-4 text-muted-foreground">
                          Loading...
                        </TableCell>
                      </TableRow>
                    ) : paginatedLineItems && paginatedLineItems.length > 0 ? (
                      paginatedLineItems.map((item: PaymentLineItem) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm">
                                {item.clients?.full_name || "Shareholder"}
                              </p>
                              <p className="font-mono text-xs text-muted-foreground">
                                {item.clients?.boid || item.client_id.slice(0, 12)}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {item.bank_name || item.clients?.bank_name || "N/A"}
                            </div>
                            {(item.connectips_ref || item.payment_reference) && (
                              <div className="font-mono text-[11px] text-muted-foreground">
                                {item.connectips_ref || item.payment_reference}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {item.bank_account_no || item.clients?.bank_account_no || "N/A"}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums font-semibold">
                            NPR{" "}
                            {(item.net_amount || 0).toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                            })}
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <Badge
                                variant={statusVariant(item.status)}
                                className={statusBadgeClass(item.status)}
                              >
                                {item.status}
                              </Badge>
                              {item.remarks && item.status !== "Completed" && (
                                <p
                                  className="text-[11px] text-muted-foreground max-w-[180px] truncate"
                                  title={item.remarks}
                                >
                                  {item.remarks}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {(item.status === "Processing" ||
                                item.status === "Pending" ||
                                item.status === "Failed" ||
                                item.status === "Returned" ||
                                Boolean(item.connectips_ref || item.payment_reference)) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-sky-700 hover:text-sky-800 dark:text-sky-300"
                                  title="Check NCHL ConnectIPS Transaction Status"
                                  disabled={checkingPaymentId === item.id}
                                  onClick={() =>
                                    handleCheckSinglePaymentStatus({
                                      paymentId: item.id,
                                      referenceId: item.connectips_ref || item.payment_reference,
                                      batchId: activeBatchId,
                                    })
                                  }
                                >
                                  {checkingPaymentId === item.id ? (
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  ) : (
                                    <RefreshCw className="w-3 h-3 mr-1" />
                                  )}
                                  Check Status
                                </Button>
                              )}
                              {item.status !== "Reversed" &&
                                item.status !== "Failed" &&
                                item.status !== "Returned" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs text-destructive hover:text-destructive"
                                    onClick={() => setReverseDialogOpen(item)}
                                  >
                                    <X className="w-3 h-3 mr-1" />
                                    Reverse
                                  </Button>
                                )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No line items yet. Click "Add Payables" to add pending payments to this
                          batch.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {totalLineItems > 0 && (
                  <div className="flex flex-wrap items-center justify-between border-t px-4 py-2.5 gap-2 bg-muted/20">
                    <div className="text-xs text-muted-foreground">
                      Showing {(safeLineItemsPage - 1) * lineItemsPageSize + 1} to{" "}
                      {Math.min(safeLineItemsPage * lineItemsPageSize, totalLineItems)} of{" "}
                      {totalLineItems} payables in batch
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={lineItemsPageSize}
                        onChange={(e) => {
                          setLineItemsPageSize(Number(e.target.value));
                          setLineItemsPage(1);
                        }}
                        className="h-7 rounded border bg-background px-2 text-xs"
                      >
                        <option value="10">10 / page</option>
                        <option value="25">25 / page</option>
                        <option value="50">50 / page</option>
                      </select>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setLineItemsPage(1)}
                        disabled={safeLineItemsPage === 1}
                      >
                        <ChevronsLeft className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setLineItemsPage((p) => Math.max(1, p - 1))}
                        disabled={safeLineItemsPage === 1}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <span className="text-xs text-muted-foreground px-1 font-medium">
                        {safeLineItemsPage} / {lineItemsTotalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() =>
                          setLineItemsPage((p) => Math.min(lineItemsTotalPages, p + 1))
                        }
                        disabled={safeLineItemsPage === lineItemsTotalPages}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setLineItemsPage(lineItemsTotalPages)}
                        disabled={safeLineItemsPage === lineItemsTotalPages}
                      >
                        <ChevronsRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Draft Batch Dialog */}
      <EditBatchDialog
        open={editBatchOpen}
        onOpenChange={setEditBatchOpen}
        editBatchName={editBatchName}
        setEditBatchName={setEditBatchName}
        editPayableType={editPayableType}
        setEditPayableType={setEditPayableType}
        editFiscalYear={editFiscalYear}
        setEditFiscalYear={setEditFiscalYear}
        editPaymentMethod={editPaymentMethod}
        setEditPaymentMethod={setEditPaymentMethod}
        editCdsBatchRef={editCdsBatchRef}
        setEditCdsBatchRef={setEditCdsBatchRef}
        editRegistrar={editRegistrar}
        setEditRegistrar={setEditRegistrar}
        fiscalYears={fiscalYears}
        isUpdatingBatch={isUpdatingBatch}
        onSave={() => updateBatchSettings()}
      />

      {/* Reversal Confirmation Dialog */}
      <ReversePaymentDialog
        payment={reverseDialogOpen}
        onClose={() => setReverseDialogOpen(null)}
        reversalReason={reversalReason}
        setReversalReason={setReversalReason}
        onConfirm={() => executeReversal()}
      />

      {/* Sticky Approval Bar when a batch is selected */}
      {activeBatchId && activeBatchData && activeBatchData.status === "Draft" && (
        <ApprovalBar
          recordId={activeBatchId}
          tableName="payment_batches"
          canApprove={canApprove}
          onStatusChange={() => {
            setActiveBatchId(null);
            qc.invalidateQueries({ queryKey: ["payments"] });
          }}
        />
      )}

      {/* Shareholder SMS & Email Notification Broadcast Dialog */}
      <PaymentBroadcastDialog
        open={broadcastOpen}
        onOpenChange={setBroadcastOpen}
        broadcastSummary={broadcastSummary}
        setBroadcastSummary={setBroadcastSummary}
        broadcastTemplateType={broadcastTemplateType}
        onTemplateChange={handleTemplateChange}
        customMessageTemplate={customMessageTemplate}
        setCustomMessageTemplate={setCustomMessageTemplate}
      />

      {/* Shareholder Multi-Year Statement Dialog */}
      <ShareholderStatementDialog
        boid={selectedStatementBoid}
        open={!!selectedStatementBoid}
        onOpenChange={(open) => {
          if (!open) setSelectedStatementBoid(null);
        }}
      />

      {/* Account Remediation Dialog */}
      <AccountRemediationDialog
        open={remediationDialogOpen}
        onOpenChange={setRemediationDialogOpen}
        initialItems={remediationItems}
        companyName={
          selectedCompany !== "all"
            ? companies.find((c) => c.id === selectedCompany)?.company_name
            : "Selected Company"
        }
      />
    </div>
  );
}
