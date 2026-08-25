import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { supabase } from '@/integrations/supabase/client';
import { PaymentGenerator } from '@/lib/payment-generator';
import { exportToExcel } from '@/lib/xlsx-utils';
import { PaymentService, PaymentBatch, PaymentLineItem } from '@/lib/services/payment.service';
import { WorkflowEngine, ApprovalAction } from '@/lib/workflow-engine';
import { NotificationService } from '@/lib/services/notification.service';
import { UserContext } from '@/lib/rbac-service';
import { useAuth } from '@/hooks/use-auth';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShareholderStatementDialog } from '@/components/shareholder-statement-dialog';
import { Download, Plus, CheckCircle2, XCircle, FileSpreadsheet, Trash2, Eye, X, Loader2, Send, Search, User, CreditCard, Layers, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ApprovalBar } from '@/components/workflow/approval-bar';
import { STANDARD_PERIODS, type PeriodPreset } from '@/lib/services/period-calculator';

export const Route = createFileRoute('/_authenticated/payments')({
  component: PaymentsRoute,
});

type PaymentMethod = 'NEFT' | 'RTGS' | 'ConnectIPS' | 'Cheque' | 'Cash';

function PaymentsRoute() {
  const qc = useQueryClient();
  const { user, roles, isAdmin } = useAuth();
  const currentUser: UserContext | null = user ? { id: user.id, roles: (roles as any) || ['read_only'] } : null;
  const [createOpen, setCreateOpen] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('ConnectIPS');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [selectedPayableType, setSelectedPayableType] = useState<string>('all');
  const [batchName, setBatchName] = useState('');
  const [fiscalYear, setFiscalYear] = useState('');
  const [cdsBatchRef, setCdsBatchRef] = useState('');
  const [registrar, setRegistrar] = useState('');
  const [reverseDialogOpen, setReverseDialogOpen] = useState<PaymentLineItem | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [periodPreset, setPeriodPreset] = useState<string>('12M');
  const [periodDays, setPeriodDays] = useState<string>('365');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [isDisbursing, setIsDisbursing] = useState(false);

  // Active top tab (Batches vs Individual Shareholder Search)
  const [paymentsActiveTab, setPaymentsActiveTab] = useState<'batches' | 'shareholders'>('batches');
  const [selectedStatementBoid, setSelectedStatementBoid] = useState<string | null>(null);

  // Main table filters
  const [tableSearch, setTableSearch] = useState<string>('');
  const [tableStatusFilter, setTableStatusFilter] = useState<string>('all');
  const [tableFromDate, setTableFromDate] = useState<string>('');
  const [tableToDate, setTableToDate] = useState<string>('');
  const [tablePeriodPreset, setTablePeriodPreset] = useState<PeriodPreset | 'ALL'>('ALL');

  // Individual Shareholder Transactions Query
  const [shareholderSearch, setShareholderSearch] = useState<string>('');
  const [shareholderCompany, setShareholderCompany] = useState<string>('all');
  const [shareholderStatus, setShareholderStatus] = useState<string>('all');

  const { data: allIndividualPayments = [], isLoading: isIndividualLoading } = useQuery({
    queryKey: ['all-individual-payments', shareholderCompany, shareholderStatus],
    queryFn: async () => {
      let q = (supabase as any)
        .from('payments')
        .select(`
          *,
          client:clients(id, full_name, boid, bank_name, bank_account_no, pan_no, citizenship_no, phone, holder_type),
          company:companies(id, company_name, company_code)
        `)
        .order('created_at', { ascending: false })
        .limit(2000);

      if (shareholderCompany !== 'all') q = q.eq('company_id', shareholderCompany);
      if (shareholderStatus !== 'all') q = q.eq('status', shareholderStatus);
      const { data, error } = await q;
      if (error) {
        console.error('Error fetching payments:', error);
        return [];
      }
      return data || [];
    },
  });

  const filteredIndividualPayments = useMemo(() => {
    const q = (shareholderSearch || tableSearch).toLowerCase().trim();
    if (!q) return allIndividualPayments;
    return allIndividualPayments.filter((p: any) => {
      return (
        (p.client?.boid && p.client.boid.toLowerCase().includes(q)) ||
        (p.client?.full_name && p.client.full_name.toLowerCase().includes(q)) ||
        (p.client?.bank_account_no && p.client.bank_account_no.toLowerCase().includes(q)) ||
        (p.bank_account_no && p.bank_account_no.toLowerCase().includes(q)) ||
        (p.payment_reference && p.payment_reference.toLowerCase().includes(q)) ||
        (p.connectips_ref && p.connectips_ref.toLowerCase().includes(q)) ||
        (p.client?.citizenship_no && p.client.citizenship_no.toLowerCase().includes(q)) ||
        (p.client?.pan_no && p.client.pan_no.toLowerCase().includes(q)) ||
        (p.company?.company_name && p.company.company_name.toLowerCase().includes(q))
      );
    });
  }, [allIndividualPayments, shareholderSearch, tableSearch]);

  const { data: payments, isLoading } = useQuery({
    queryKey: ['payments'],
    queryFn: () => PaymentService.getBatches(100, 0),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ['companies-lookup'],
    queryFn: async () => {
      const { data } = await supabase.from('companies').select('id, company_name, company_code').order('company_name');
      return data || [];
    },
  });

  const { data: fiscalYears = [] } = useQuery({
    queryKey: ['payments-fiscal-years'],
    queryFn: async () => {
      const { data } = await supabase.from('fiscal_years').select('fiscal_year').order('fiscal_year', { ascending: false });
      return (data || []).map(f => f.fiscal_year);
    },
  });

  const { data: activeBatchData } = useQuery({
    queryKey: ['payment-batch', activeBatchId],
    queryFn: () => PaymentService.getBatchById(activeBatchId!),
    enabled: !!activeBatchId,
  });

  const { data: lineItems, isLoading: lineItemsLoading } = useQuery({
    queryKey: ['payment-line-items', activeBatchId],
    queryFn: () => PaymentService.getLineItems(activeBatchId!),
    enabled: !!activeBatchId,
  });

  const { data: availablePayables = [] } = useQuery({
    queryKey: ['payables-for-payment', selectedCompany, selectedPayableType, fiscalYear, periodPreset, periodDays, fromDate, toDate],
    queryFn: () => PaymentService.getPayablesForPayment(
      selectedCompany !== 'all' ? selectedCompany : undefined,
      selectedPayableType !== 'all' ? selectedPayableType : undefined,
      {
        fiscalYear: fiscalYear || undefined,
        periodPreset,
        periodDays: periodDays ? Number(periodDays) : undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      }
    ),
    enabled: createOpen || !!activeBatchId,
  });

  const { mutate: createBatch, isPending } = useMutation({
    mutationFn: async () => {
      const generatedName = batchName.trim() || `${selectedCompany !== 'all' ? (companies.find(c => c.id === selectedCompany)?.company_code || '') : 'ALL'} ${selectedPayableType !== 'all' ? selectedPayableType.toUpperCase() : 'PAYMENT'} ${periodPreset !== '12M' ? periodPreset : ''} ${fiscalYear || new Date().toISOString().slice(0, 10)}`.trim();
      const batch = await PaymentService.createBatch({
        batch_name: generatedName,
        company_id: selectedCompany !== 'all' ? selectedCompany : undefined,
        fiscal_year: fiscalYear || undefined,
        payable_type: selectedPayableType !== 'all' ? selectedPayableType : undefined,
        payment_method: paymentMethod,
      });
      
      if (!batch) throw new Error('Failed to create batch');

      // Auto-populate all matching payables into the created batch
      if (availablePayables.length > 0) {
        const items = availablePayables.map(payable => {
          const grossAmount = Number(payable.gross_dividend ?? payable.gross_interest ?? 0);
          const netAmount = Number(payable.net_payable ?? 0);
          const taxAmount = Number(payable.tax_amount ?? (grossAmount - netAmount));
          return {
            company_id: payable.company_id,
            client_id: payable.client_id,
            payable_type: payable.payable_type || (selectedPayableType !== 'all' ? selectedPayableType : 'dividend'),
            payable_id: payable.id,
            gross_amount: grossAmount,
            tax_amount: taxAmount,
            net_amount: netAmount,
            paid_amount: netAmount,
            payment_method: paymentMethod,
            payment_date: null,
            payment_reference: null,
            bank_name: payable.clients?.bank_name || payable.bank_name || null,
            bank_account_no: payable.clients?.bank_account_no || payable.bank_account_no || null,
            neft_ref: null,
            connectips_ref: null,
            rtgs_ref: null,
            cheque_no: null,
            status: 'Pending',
            remarks: null,
          };
        });

        await PaymentService.addLineItems(batch.id, items);
      }

      // Update cds_batch_ref and registrar if provided
      if (cdsBatchRef || registrar) {
        await (supabase as any)
          .from('payment_batches')
          .update({
            cds_batch_ref: cdsBatchRef.trim() || null,
            registrar: registrar.trim() || null,
          })
          .eq('id', batch.id);
      }

      return batch;
    },
    onSuccess: (batch: any) => {
      toast.success(`Payment batch created with ${availablePayables.length} payables.`);
      setCreateOpen(false);
      setBatchName('');
      setFiscalYear('');
      setCdsBatchRef('');
      setRegistrar('');
      qc.invalidateQueries({ queryKey: ['payments'] });
      if (batch?.id) {
        setActiveBatchId(batch.id);
      }
    },
    onError: (err: any) => toast.error(`Failed to create batch: ${err?.message || err}`),
  });

  const { mutate: addPayablesToBatch } = useMutation({
    mutationFn: async (batchId: string) => {
      const items = availablePayables.map(payable => {
        const grossAmount = Number(payable.gross_dividend ?? payable.gross_interest ?? 0);
        const netAmount = Number(payable.net_payable ?? 0);
        const taxAmount = Number(payable.tax_amount ?? (grossAmount - netAmount));
        return {
          company_id: payable.company_id,
          client_id: payable.client_id,
          payable_type: payable.payable_type || 'dividend',
          payable_id: payable.id,
          gross_amount: grossAmount,
          tax_amount: taxAmount,
          net_amount: netAmount,
          paid_amount: netAmount,
          payment_method: activeBatchData?.payment_method || 'ConnectIPS',
          payment_date: null,
          payment_reference: null,
          bank_name: payable.clients?.bank_name || payable.bank_name || null,
          bank_account_no: payable.clients?.bank_account_no || payable.bank_account_no || null,
          neft_ref: null,
          connectips_ref: null,
          rtgs_ref: null,
          cheque_no: null,
          status: 'Pending',
          remarks: null,
        };
      });

      const success = await PaymentService.addLineItems(batchId, items);
      if (!success) throw new Error('Failed to add line items');
    },
    onSuccess: () => {
      toast.success('Payables added to batch.');
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['payment-batch'] });
      qc.invalidateQueries({ queryKey: ['payment-line-items'] });
      qc.invalidateQueries({ queryKey: ['payables-for-payment'] });
    },
    onError: () => toast.error('Failed to add payables to batch.'),
  });

  const { mutate: updateBatchStatus } = useMutation({
    mutationFn: async ({ batchId, status, action }: { batchId: string; status?: PaymentBatch['status']; action?: ApprovalAction }) => {
      const batchData = payments?.find((p: any) => p.id === batchId) || activeBatchData;
      let effectiveAction: ApprovalAction = action || 'submit';
      if (!action && status) {
        if (status === 'Pending') effectiveAction = 'submit';
        else if (status === 'Approved') effectiveAction = 'approve';
        else if (status === 'Rejected') effectiveAction = 'reject';
        else if (status === 'Processed') effectiveAction = 'process';
        else if (status === 'Completed') effectiveAction = 'complete';
      }
      const result = await WorkflowEngine.processAction(batchId, 'payment_batches', effectiveAction, undefined, currentUser);
      if (!result.success) throw new Error(result.error || 'Failed to update status');
      
      await NotificationService.sendPaymentNotification(
        currentUser?.id || null,
        batchId.slice(0, 8),
        result.success,
        batchData?.total_amount || 0,
        batchData?.total_payments || 0
      );
    },
    onSuccess: () => {
      toast.success('Batch workflow status updated successfully.');
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['payment-batch'] });
      qc.invalidateQueries({ queryKey: ['payment-line-items'] });
      qc.invalidateQueries({ queryKey: ['pending_approvals_all'] });
      qc.invalidateQueries({ queryKey: ['pending_batches_count'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to update batch status.'),
  });

  const { mutate: deleteBatch, isPending: isDeletingBatch } = useMutation({
    mutationFn: async (batchId: string) => {
      const ok = await PaymentService.deleteBatch(batchId);
      if (!ok) throw new Error('Failed to delete batch');
      return batchId;
    },
    onSuccess: () => {
      toast.success('Payment batch deleted successfully.');
      setActiveBatchId(null);
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['payables-for-payment'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to delete batch.'),
  });

  const { mutate: executeReversal } = useMutation({
    mutationFn: async () => {
      if (!reverseDialogOpen) return;
      const success = await PaymentService.reversePayment(
        reverseDialogOpen.id,
        reversalReason || 'Manual Reversal by Operator',
        currentUser?.id
      );
      if (!success) throw new Error('Failed to reverse payment');
    },
    onSuccess: () => {
      toast.success('Payment successfully reversed and payable restored.');
      setReverseDialogOpen(null);
      setReversalReason('');
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['payment-batch'] });
      qc.invalidateQueries({ queryKey: ['payment-line-items'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Reversal failed'),
  });

  const handleDownloadPaymentFile = async (batch: PaymentBatch) => {
    let itemsToExport = lineItems;
    if (!itemsToExport || itemsToExport.length === 0 || activeBatchId !== batch.id) {
      itemsToExport = await PaymentService.getLineItems(batch.id);
    }

    if (!itemsToExport || itemsToExport.length === 0) {
      toast.error('No line items found in this batch.');
      return;
    }

    let content: string;
    const batchName = batch.batch_name || `Batch_${batch.id.slice(0, 8)}`;

    switch (batch.payment_method) {
      case 'ConnectIPS':
        content = PaymentGenerator.generateConnectIPS(itemsToExport, batchName);
        break;
      case 'RTGS':
        content = PaymentGenerator.generateNEFT(itemsToExport, batchName);
        break;
      case 'Cheque':
        content = PaymentGenerator.generateCheque(itemsToExport, batchName);
        break;
      case 'Cash':
        content = PaymentGenerator.generateCash(itemsToExport, batchName);
        break;
      default:
        content = PaymentGenerator.generateNEFT(itemsToExport, batchName);
    }

    PaymentGenerator.downloadPaymentFile(content, batch.payment_method || 'NEFT', batchName);
    toast.success(`${batch.payment_method || 'NEFT'} file downloaded.`);
  };

  const handleDownloadExcel = async (batch: PaymentBatch) => {
    let itemsToExport = lineItems;
    if (!itemsToExport || itemsToExport.length === 0 || activeBatchId !== batch.id) {
      itemsToExport = await PaymentService.getLineItems(batch.id);
    }

    if (!itemsToExport || itemsToExport.length === 0) {
      toast.error('No line items found in this batch.');
      return;
    }

    const rows = itemsToExport.map((item, idx) => ({
      'S.N': idx + 1,
      'Payee Name': item.clients?.full_name || 'Shareholder',
      'BOID': item.clients?.boid || '',
      'Bank Name': item.bank_name || item.clients?.bank_name || '',
      'Bank Account No': item.bank_account_no || item.clients?.bank_account_no || '',
      'Gross Amount': item.gross_amount,
      'Tax / TDS Amount': item.tax_amount,
      'Net Payable': item.net_amount,
      'Payment Method': item.payment_method || batch.payment_method,
      'Status': item.status,
      'Reference': item.connectips_ref || item.payment_reference || '',
      'Payment Date': item.payment_date || '',
    }));

    exportToExcel(rows, `Payment_Batch_${(batch.batch_name || batch.id.slice(0, 8)).replace(/[^a-zA-Z0-9_-]/g, '_')}_${new Date().toISOString().slice(0, 10)}`);
    toast.success('Payment batch exported to Excel.');
  };

  const handleExportAvailablePayables = () => {
    if (availablePayables.length === 0) {
      toast.error('No payables available to export with current filters.');
      return;
    }

    const rows = availablePayables.map((p, idx) => {
      const gross = Number(p.gross_dividend ?? p.gross_interest ?? 0);
      const tax = Number(p.tax_amount ?? 0);
      const net = Number(p.net_payable ?? (gross - tax));
      return {
        'S.N': idx + 1,
        'Company': p.companies?.company_code || '',
        'Payee Name': p.clients?.full_name || p.full_name || 'Shareholder',
        'BOID': p.clients?.boid || p.boid || '',
        'Classification': p.payee_classification || p.clients?.payee_classification || '',
        'Bank Name': p.bank_name || p.clients?.bank_name || '',
        'Bank Account No': p.bank_account_no || p.clients?.bank_account_no || '',
        'Payable Type': p.payable_type || selectedPayableType,
        'Gross Amount': gross,
        'Tax Amount': tax,
        'Net Payable': net,
        'Status': p.payment_status || 'Pending',
        'Fiscal Year': p.fiscal_year || fiscalYear,
      };
    });

    exportToExcel(rows, `Available_Payables_List_${new Date().toISOString().slice(0, 10)}`);
    toast.success(`Exported ${availablePayables.length} payables to Excel.`);
  };

  const statusVariant = (status: string) => {
    switch (status) {
      case 'Completed': return 'default';
      case 'Approved': return 'secondary';
      case 'Processed': return 'outline';
      case 'Draft': return 'outline';
      default: return 'destructive';
    }
  };

  const batchTotals = useMemo(() => {
    if (!lineItems) return { count: 0, total: 0 };
    return {
      count: lineItems.length,
      total: lineItems.reduce((sum, item) => sum + (item.net_amount || 0), 0),
    };
  }, [lineItems]);

  const filteredBatches = useMemo(() => {
    if (!payments) return [];
    return payments.filter((b: any) => {
      if (tableStatusFilter !== 'all' && (b.status || 'Draft') !== tableStatusFilter) return false;
      if (tableSearch) {
        const q = tableSearch.toLowerCase();
        const matchesName = b.batch_name?.toLowerCase().includes(q);
        const matchesRef = b.cds_batch_ref?.toLowerCase().includes(q);
        const matchesMethod = b.payment_method?.toLowerCase().includes(q);
        if (!matchesName && !matchesRef && !matchesMethod) return false;
      }
      if (tableFromDate) {
        const batchDate = b.created_at ? b.created_at.slice(0, 10) : '';
        if (batchDate && batchDate < tableFromDate) return false;
      }
      if (tableToDate) {
        const batchDate = b.created_at ? b.created_at.slice(0, 10) : '';
        if (batchDate && batchDate > tableToDate) return false;
      }
      return true;
    });
  }, [payments, tableStatusFilter, tableSearch, tableFromDate, tableToDate]);

  const totalBatchAmount = filteredBatches.reduce((sum: number, p: any) => sum + (p.total_amount || 0), 0);
  const totalBatchCount = filteredBatches.length;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <PageHeader
          title="Payments Module"
          description="Create payment batches, add payables, generate NEFT/RTGS/ConnectIPS/Cheque files, and manage payment workflows."
        />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleExportAvailablePayables}
            disabled={availablePayables.length === 0}
          >
            <FileSpreadsheet className="w-4 h-4 mr-2 text-emerald-600" />
            Download Payables ({availablePayables.length})
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                New Payment Batch
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Create Payment Batch</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Batch Name</Label>
                <Input
                  placeholder="e.g., Dividend Payment Batch Q1 2081/82"
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Company</Label>
                  <Select value={selectedCompany} onValueChange={setSelectedCompany}>
                    <SelectTrigger>
                      <SelectValue placeholder="All companies" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All companies</SelectItem>
                      {companies.map((company) => (
                        <SelectItem key={company.id} value={company.id}>
                          {company.company_code} — {company.company_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Payable Type</Label>
                  <Select value={selectedPayableType} onValueChange={setSelectedPayableType}>
                    <SelectTrigger>
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="dividend">Dividend</SelectItem>
                      <SelectItem value="interest">Interest</SelectItem>
                      <SelectItem value="mutual_fund">Mutual Fund</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Period / Quarter</Label>
                  <Select
                    value={periodPreset}
                    onValueChange={(v) => {
                      setPeriodPreset(v);
                      if (v === '3M') setPeriodDays('91');
                      else if (v === '6M') setPeriodDays('183');
                      else if (v === '9M') setPeriodDays('274');
                      else if (v === '12M') setPeriodDays('365');
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="12M">Full Period / Annual (12 Months / 365 Days)</SelectItem>
                      <SelectItem value="3M">Q1 (1st Quarter / 3 Months / ~91 Days)</SelectItem>
                      <SelectItem value="6M">Q2 (2nd Quarter / 6 Months / 183 Days / Semi-Annual)</SelectItem>
                      <SelectItem value="9M">Q3 (3rd Quarter / 9 Months / ~274 Days)</SelectItem>
                      <SelectItem value="CUSTOM">Custom Day / Date Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {periodPreset === 'CUSTOM' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">From Date</Label>
                      <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">To Date</Label>
                      <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9 text-xs" />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Period Days</Label>
                    <Input
                      type="number"
                      value={periodDays}
                      onChange={(e) => {
                        setPeriodDays(e.target.value);
                        setPeriodPreset('CUSTOM');
                      }}
                      placeholder="365"
                    />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Fiscal Year</Label>
                  <Select value={fiscalYear} onValueChange={setFiscalYear}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select fiscal year" />
                    </SelectTrigger>
                    <SelectContent>
                      {fiscalYears.map((fy) => (
                        <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['NEFT', 'RTGS', 'ConnectIPS', 'Cheque', 'Cash'] as PaymentMethod[]).map(m => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="rounded-md border bg-muted/20 p-3 text-sm">
                <div className="flex items-center justify-between font-medium mb-1">
                  <span>Available Payables</span>
                  <span className="text-xs text-muted-foreground">
                    {periodPreset !== '12M' ? `Prorated for ${periodDays} Days` : 'Full Period (365 Days)'}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  {availablePayables.length} payables found matching your criteria.
                  {availablePayables.length > 0 && (
                    <span className="ml-2 text-primary font-semibold">
                      Total: NPR {availablePayables.reduce((sum, p) => sum + (p.net_payable || 0), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <DialogFooter className="flex sm:justify-between items-center w-full gap-2 pt-2 border-t">
              <Button
                variant="outline"
                type="button"
                onClick={handleExportAvailablePayables}
                disabled={availablePayables.length === 0}
                className="text-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                Download Payable List (Excel)
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button disabled={isPending} onClick={() => createBatch()}>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Create Payment Batch
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total Batches</p>
            <p className="text-2xl font-bold">{totalBatchCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total Amount</p>
            <p className="text-2xl font-bold">NPR {totalBatchAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Drafts</p>
            <p className="text-2xl font-bold">{filteredBatches.filter((p: any) => p.status === 'Draft').length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Approved / Ready</p>
            <p className="text-2xl font-bold">{filteredBatches.filter((p: any) => p.status === 'Approved').length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Navigation Tabs */}
      <Tabs value={paymentsActiveTab} onValueChange={(v: any) => setPaymentsActiveTab(v)} className="space-y-4">
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
                <SelectItem value="Processed">Processed</SelectItem>
                <SelectItem value="Completed">Completed</SelectItem>
                <SelectItem value="Rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>

            {/* Period Quick Presets */}
            <div className="flex items-center gap-1 bg-background border rounded px-1.5 py-0.5 h-9">
              <span className="text-[11px] text-muted-foreground whitespace-nowrap mr-0.5">Period:</span>
              {(['3M', '6M', '9M', '12M'] as PeriodPreset[]).map((p) => {
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
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>

            {/* Date Range Search */}
            <div className="flex items-center gap-1 bg-background border rounded px-2 h-9 text-xs">
              <span className="text-[11px] text-muted-foreground">From:</span>
              <input
                type="date"
                value={tableFromDate}
                onChange={(e) => {
                  setTableFromDate(e.target.value);
                  setTablePeriodPreset('CUSTOM');
                }}
                className="bg-transparent text-xs outline-none"
              />
              <span className="text-[11px] text-muted-foreground ml-1">To:</span>
              <input
                type="date"
                value={tableToDate}
                onChange={(e) => {
                  setTableToDate(e.target.value);
                  setTablePeriodPreset('CUSTOM');
                }}
                className="bg-transparent text-xs outline-none"
              />
              {(tableFromDate || tableToDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setTableFromDate('');
                    setTableToDate('');
                    setTablePeriodPreset('ALL');
                  }}
                  className="ml-1 text-[11px] text-destructive hover:underline font-medium"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Batches Table */}
          <div className="border rounded-lg bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch Name</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Payments</TableHead>
                  <TableHead className="text-right">Total Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : filteredBatches.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No payment batches match the selected filters.</TableCell></TableRow>
                ) : filteredBatches.map((batch: any) => (
                  <TableRow key={batch.id} className={activeBatchId === batch.id ? 'bg-muted/30' : ''}>
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
                      <Badge variant="outline" className="capitalize">{batch.payment_method}</Badge>
                    </TableCell>
                    <TableCell>{batch.total_payments || 0}</TableCell>
                    <TableCell className="text-right font-semibold">
                      NPR {(batch.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(batch.status || 'Draft')}>{batch.status || 'Draft'}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(batch.created_at || new Date()), 'dd MMM yyyy')}
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
                        {(batch.status === 'Approved' || batch.status === 'Draft' || batch.status === 'Processed' || batch.status === 'Completed') && (
                          <>
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
                              className="h-7 text-xs"
                              onClick={() => handleDownloadPaymentFile(batch)}
                            >
                              <Download className="w-3 h-3 mr-1" />
                              {batch.payment_method}
                            </Button>
                          </>
                        )}
                        {batch.status === 'Draft' && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950"
                              title="Submit for Maker/Checker Approval"
                              onClick={() => {
                                updateBatchStatus({ batchId: batch.id, action: 'submit' });
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
                                  if (confirm(`Are you sure you want to delete draft batch "${batch.batch_name}"?`)) {
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
                        {batch.status === 'Pending' && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                              title="Approve Batch"
                              onClick={() => {
                                updateBatchStatus({ batchId: batch.id, action: 'approve' });
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
                                updateBatchStatus({ batchId: batch.id, action: 'reject' });
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
                ))}
              </TableBody>
            </Table>
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
              <SelectContent>
                <SelectItem value="all">All Companies</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>
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
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="Failed">Failed / Bounced</SelectItem>
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
                  <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Loading individual payments...</TableCell></TableRow>
                ) : filteredIndividualPayments.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No shareholder transactions found matching your search.</TableCell></TableRow>
                ) : (
                  filteredIndividualPayments.map((p: any) => (
                    <TableRow key={p.id} className="hover:bg-muted/30 text-xs">
                      <TableCell className="font-mono font-semibold text-primary">
                        <button
                          type="button"
                          className="hover:underline cursor-pointer"
                          onClick={() => setSelectedStatementBoid(p.client?.boid || p.boid)}
                        >
                          {p.client?.boid || p.boid || '—'}
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{p.client?.full_name || 'Shareholder'}</div>
                        <div className="text-[10px] text-muted-foreground">{p.client?.holder_type || 'Public'}</div>
                      </TableCell>
                      <TableCell className="font-medium text-muted-foreground">
                        {p.company?.company_name || '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {Number(p.gross_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono text-amber-600">
                        {Number(p.tax_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-emerald-600">
                        {Number(p.paid_amount || p.net_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        <div className="truncate max-w-[150px]">{p.bank_name || p.client?.bank_name || '—'}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{p.bank_account_no || p.client?.bank_account_no || '—'}</div>
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">
                        <div>{p.payment_date ? format(new Date(p.payment_date), 'dd MMM yyyy') : '—'}</div>
                        <div className="font-mono text-[10px]">{p.payment_reference || p.connectips_ref || p.payment_method}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.status === 'Completed' ? 'default' : p.status === 'Failed' ? 'destructive' : 'secondary'} className="text-[10px]">
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-primary hover:bg-primary/10 cursor-pointer"
                          onClick={() => setSelectedStatementBoid(p.client?.boid || p.boid)}
                        >
                          <FileText className="w-3.5 h-3.5 mr-1" />
                          Statement
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Batch Name</p>
                  <p className="text-sm font-medium">{activeBatchData.batch_name}</p>
                  {activeBatchData.cds_batch_ref && (
                    <p className="text-xs font-mono text-primary mt-0.5">Ref: {activeBatchData.cds_batch_ref}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Payment Method</p>
                  <p className="text-sm font-medium">{activeBatchData.payment_method}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge variant={statusVariant(activeBatchData.status)}>{activeBatchData.status}</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Amount</p>
                  <p className="text-sm font-medium">NPR {(activeBatchData.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                </div>
              </div>

              {activeBatchData.status === 'Draft' && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (activeBatchId && confirm('Add all matching payables to this batch?')) {
                        addPayablesToBatch(activeBatchId);
                      }
                    }}
                  >
                    Add Payables ({availablePayables.length} available)
                  </Button>
                  <Button
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white font-medium shadow-sm"
                    onClick={() => {
                      if (!lineItems || lineItems.length === 0) {
                        toast.error('Cannot submit an empty batch. Please add payables first.');
                        return;
                      }
                      if (activeBatchId) {
                        updateBatchStatus({ batchId: activeBatchId, action: 'submit' });
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
                      if (confirm(`Are you sure you want to delete draft batch "${activeBatchData.batch_name}"?`)) {
                        deleteBatch(activeBatchData.id);
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4 mr-1.5" />
                    Delete Batch
                  </Button>
                </div>
              )}

              {activeBatchData.status === 'Pending' && (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 px-3 py-1.5 text-xs font-medium mr-2">
                    Awaiting Checker / Supervisor Approval
                  </Badge>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm"
                    onClick={() => {
                      if (activeBatchId) {
                        updateBatchStatus({ batchId: activeBatchId, action: 'approve' });
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
                        updateBatchStatus({ batchId: activeBatchId, action: 'reject' });
                      }
                    }}
                  >
                    <XCircle className="w-4 h-4 mr-1.5" />
                    Reject Batch
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDownloadExcel(activeBatchData)}
                  >
                    <FileSpreadsheet className="w-4 h-4 mr-1.5 text-emerald-600" />
                    Export Excel (.xlsx)
                  </Button>
                </div>
              )}

              {activeBatchData.status === 'Approved' && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm"
                    disabled={isDisbursing}
                    onClick={async () => {
                      if (!lineItems || lineItems.length === 0) {
                        toast.error('Cannot disburse an empty batch. Please add payables first.');
                        return;
                      }
                      const totalFormatted = Number(activeBatchData.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
                      if (!confirm(`Are you sure you want to disburse NPR ${totalFormatted} across ${lineItems.length} payables directly via ConnectIPS API?`)) {
                        return;
                      }
                      setIsDisbursing(true);
                      try {
                        const { ConnectIPSService } = await import('@/lib/services/connectips.service');
                        const res = await ConnectIPSService.disbursePaymentBatch(activeBatchId!);
                        if (res.success || res.totalSuccess > 0) {
                          toast.success(`Disbursed ${res.totalSuccess} payments (NPR ${res.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}) successfully via ConnectIPS.`);
                          qc.invalidateQueries({ queryKey: ['payments'] });
                          qc.invalidateQueries({ queryKey: ['payment-batch', activeBatchId] });
                          qc.invalidateQueries({ queryKey: ['payment-line-items', activeBatchId] });
                        } else {
                          toast.error(`Disbursement failed: ${res.results[0]?.errorMessage || 'Error executing gateway payment'}`);
                        }
                      } catch (err: any) {
                        toast.error(`ConnectIPS API error: ${err?.message || err}`);
                      } finally {
                        setIsDisbursing(false);
                      }
                    }}
                  >
                    {isDisbursing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
                    {isDisbursing ? 'Disbursing via ConnectIPS…' : 'Disburse via ConnectIPS API'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (!lineItems || lineItems.length === 0) {
                        toast.error('Cannot process an empty batch.');
                        return;
                      }
                      if (activeBatchId) {
                        updateBatchStatus({ batchId: activeBatchId, status: 'Processed' });
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

              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Bank</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Net Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lineItemsLoading ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-4 text-muted-foreground">Loading...</TableCell></TableRow>
                    ) : lineItems && lineItems.length > 0 ? (
                      lineItems.map((item: PaymentLineItem) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm">{item.clients?.full_name || 'Shareholder'}</p>
                              <p className="font-mono text-xs text-muted-foreground">{item.clients?.boid || item.client_id.slice(0, 12)}</p>
                            </div>
                          </TableCell>
                          <TableCell>{item.bank_name || item.clients?.bank_name || 'N/A'}</TableCell>
                          <TableCell className="font-mono text-xs">{item.bank_account_no || item.clients?.bank_account_no || 'N/A'}</TableCell>
                          <TableCell className="text-right font-medium">
                            NPR {(item.net_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {item.status !== 'Reversed' && item.status !== 'Failed' && (
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
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No line items yet. Click "Add Payables" to add pending payments to this batch.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reversal Confirmation Dialog */}
      <Dialog open={!!reverseDialogOpen} onOpenChange={(open) => !open && setReverseDialogOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to reverse this payment of <strong>NPR {Number(reverseDialogOpen?.net_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong> for {reverseDialogOpen?.clients?.full_name || 'this investor'}?
            </p>
            <div className="space-y-1.5">
              <Label>Reversal Reason</Label>
              <Input
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                placeholder="e.g. Account closed / Bank rejected / Wrong A/C"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setReverseDialogOpen(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => executeReversal()}>Confirm Reversal</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sticky Approval Bar when a batch is selected */}
      {activeBatchId && activeBatchData && activeBatchData.status === 'Draft' && (
        <ApprovalBar
          recordId={activeBatchId}
          tableName="payment_batches"
          canApprove={true}
          onStatusChange={() => {
            setActiveBatchId(null);
            qc.invalidateQueries({ queryKey: ['payments'] });
          }}
        />
      )}

      {/* Shareholder Multi-Year Statement Dialog */}
      <ShareholderStatementDialog
        boid={selectedStatementBoid}
        open={!!selectedStatementBoid}
        onOpenChange={(open) => {
          if (!open) setSelectedStatementBoid(null);
        }}
      />
    </div>
  );
}