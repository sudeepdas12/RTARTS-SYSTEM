import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { supabase } from '@/integrations/supabase/client';
import { PaymentGenerator } from '@/lib/payment-generator';
import { PaymentService, PaymentBatch, PaymentLineItem } from '@/lib/services/payment.service';
import { WorkflowEngine } from '@/lib/workflow-engine';
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
import { Download, Plus, CheckCircle2, FileSpreadsheet, Trash2, Eye, X } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ApprovalBar } from '@/components/workflow/approval-bar';

export const Route = createFileRoute('/_authenticated/payments')({
  component: PaymentsRoute,
});

type PaymentMethod = 'NEFT' | 'RTGS' | 'ConnectIPS' | 'Cheque' | 'Cash';

function PaymentsRoute() {
  const qc = useQueryClient();
  const { user, roles } = useAuth();
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
    queryKey: ['payables-for-payment', selectedCompany, selectedPayableType],
    queryFn: () => PaymentService.getPayablesForPayment(
      selectedCompany !== 'all' ? selectedCompany : undefined,
      selectedPayableType !== 'all' ? selectedPayableType : undefined
    ),
    enabled: createOpen || !!activeBatchId,
  });

  const { mutate: createBatch, isPending } = useMutation({
    mutationFn: async () => {
      const batch = await PaymentService.createBatch({
        batch_name: batchName || `Payment Batch ${new Date().toISOString().slice(0, 10)}`,
        company_id: selectedCompany !== 'all' ? selectedCompany : undefined,
        fiscal_year: fiscalYear || undefined,
        payable_type: selectedPayableType !== 'all' ? selectedPayableType : undefined,
        payment_method: paymentMethod,
      });
      
      if (!batch) throw new Error('Failed to create batch');

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
    onSuccess: () => {
      toast.success('Payment batch created as Draft.');
      setCreateOpen(false);
      setBatchName('');
      setFiscalYear('');
      setCdsBatchRef('');
      setRegistrar('');
      qc.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: () => toast.error('Failed to create batch.'),
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
    mutationFn: async ({ batchId, status }: { batchId: string; status: PaymentBatch['status'] }) => {
      const batchData = payments?.find((p: any) => p.id === batchId) || activeBatchData;
      const action = status === 'Approved' ? 'approve' : status === 'Processed' ? 'process' : status === 'Completed' ? 'complete' : 'submit';
      const result = await WorkflowEngine.processAction(batchId, 'payment_batches', action, undefined, currentUser);
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
      toast.success('Batch status updated.');
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['payment-batch'] });
      qc.invalidateQueries({ queryKey: ['payment-line-items'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to update batch status.'),
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

  const totalBatchAmount = payments?.reduce((sum: number, p: any) => sum + (p.total_amount || 0), 0) || 0;
  const totalBatchCount = payments?.length || 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <PageHeader
          title="Payments Module"
          description="Create payment batches, add payables, generate NEFT/RTGS/ConnectIPS/Cheque files, and manage payment workflows."
        />
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
                <p className="font-medium mb-1">Available Payables</p>
                <p className="text-muted-foreground">
                  {availablePayables.length} payables found matching your criteria.
                  {availablePayables.length > 0 && (
                    <span className="ml-2 text-primary font-medium">
                      Total: NPR {availablePayables.reduce((sum, p) => sum + (p.net_payable || 0), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button disabled={isPending} onClick={() => createBatch()}>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Create Draft Batch
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
            <p className="text-2xl font-bold">{payments?.filter((p: any) => p.status === 'Draft').length || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Approved</p>
            <p className="text-2xl font-bold">{payments?.filter((p: any) => p.status === 'Approved').length || 0}</p>
          </CardContent>
        </Card>
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
            ) : payments?.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No payment batches yet. Create one to begin.</TableCell></TableRow>
            ) : payments?.map((batch: any) => (
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
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleDownloadPaymentFile(batch)}
                      >
                        <Download className="w-3 h-3 mr-1" />
                        {batch.payment_method}
                      </Button>
                    )}
                    {batch.status === 'Draft' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-primary"
                        onClick={() => setActiveBatchId(batch.id === activeBatchId ? null : batch.id)}
                      >
                        <Eye className="w-3 h-3 mr-1" />
                        Manage
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

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
                <div className="flex gap-2">
                  <Button
                    size="sm"
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
                    variant="default"
                    onClick={() => {
                      if (!lineItems || lineItems.length === 0) {
                        toast.error('Cannot approve an empty batch. Please add payables first.');
                        return;
                      }
                      if (activeBatchId) {
                        updateBatchStatus({ batchId: activeBatchId, status: 'Approved' });
                      }
                    }}
                  >
                    Approve Batch
                  </Button>
                </div>
              )}

              {activeBatchData.status === 'Approved' && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="default"
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
                    onClick={() => handleDownloadPaymentFile(activeBatchData)}
                  >
                    <Download className="w-4 h-4 mr-2" />
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
    </div>
  );
}