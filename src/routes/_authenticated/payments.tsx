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
import { Download, Plus, CheckCircle2, FileSpreadsheet, Trash2, Eye } from 'lucide-react';
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
  const [viewBatchId, setViewBatchId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('NEFT');
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [selectedPayableType, setSelectedPayableType] = useState<string>('all');
  const [batchName, setBatchName] = useState('');
  const [fiscalYear, setFiscalYear] = useState('');

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

  const { data: lineItems, isLoading: lineItemsLoading } = useQuery({
    queryKey: ['payment-line-items', viewBatchId],
    queryFn: () => PaymentService.getLineItems(viewBatchId!),
    enabled: !!viewBatchId,
  });

  const { data: selectedBatchData } = useQuery({
    queryKey: ['payment-batch', selectedBatch],
    queryFn: () => PaymentService.getBatchById(selectedBatch!),
    enabled: !!selectedBatch,
  });

  const { data: availablePayables = [] } = useQuery({
    queryKey: ['payables-for-payment', selectedCompany, selectedPayableType],
    queryFn: () => PaymentService.getPayablesForPayment(
      selectedCompany !== 'all' ? selectedCompany : undefined,
      selectedPayableType !== 'all' ? selectedPayableType : undefined
    ),
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
      return batch;
    },
    onSuccess: () => {
      toast.success('Payment batch created as Draft.');
      setCreateOpen(false);
      setBatchName('');
      setFiscalYear('');
      qc.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: () => toast.error('Failed to create batch.'),
  });

  const { mutate: addPayablesToBatch } = useMutation({
    mutationFn: async (batchId: string) => {
      if (!selectedBatchData) return;
      
      const lineItems = availablePayables.map(payable => {
        const grossAmount = Number(payable.gross_dividend ?? payable.gross_interest ?? 0);
        const netAmount = Number(payable.net_payable ?? 0);
        // Derive actual tax from gross - net; fallback to payable.tax_amount if available
        const taxAmount = Number(payable.tax_amount ?? (grossAmount - netAmount));
        return {
          company_id: payable.company_id,
          client_id: payable.client_id,
          payable_type: payable.payable_type,
          payable_id: payable.id,
          gross_amount: grossAmount,
          tax_amount: taxAmount,
          net_amount: netAmount,
          paid_amount: 0,
          payment_method: selectedBatchData.payment_method,
          payment_date: null,
          payment_reference: null,
          bank_name: payable.clients?.bank_name || null,
          bank_account_no: payable.clients?.bank_account_no || null,
          neft_ref: null,
          connectips_ref: null,
          rtgs_ref: null,
          cheque_no: null,
          status: 'Pending',
          remarks: `Auto-created from ${payable.payable_type} payable`,
        };
      });
      
      const success = await PaymentService.addLineItems(batchId, lineItems);
      if (!success) throw new Error('Failed to add line items');
    },
    onSuccess: () => {
      toast.success('Payables added to batch.');
      qc.invalidateQueries({ queryKey: ['payment-line-items'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: () => toast.error('Failed to add payables to batch.'),
  });

  const { mutate: updateBatchStatus } = useMutation({
    mutationFn: async ({ batchId, status }: { batchId: string; status: PaymentBatch['status'] }) => {
      // Use the workflow engine for proper maker/checker/approver transitions
      const action = status === 'Approved' ? 'approve' : status === 'Processed' ? 'process' : status === 'Completed' ? 'complete' : 'submit';
      const result = await WorkflowEngine.processAction(batchId, 'payment_batches', action, undefined, currentUser);
      if (!result.success) throw new Error(result.error || 'Failed to update status');
      
      // Send notification
      await NotificationService.sendPaymentNotification(
        currentUser?.id || null,
        batchId.slice(0, 8),
        result.success,
        0,
        0
      );
    },
    onSuccess: () => {
      toast.success('Batch status updated.');
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['payment-batch'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to update batch status.'),
  });

  const handleDownloadPaymentFile = (batch: PaymentBatch) => {
    if (!lineItems || lineItems.length === 0) {
      toast.error('No line items in batch.');
      return;
    }

    let content: string;
    const batchName = batch.batch_name || `Batch_${batch.id.slice(0, 8)}`;

    switch (batch.payment_method) {
      case 'ConnectIPS':
        content = PaymentGenerator.generateConnectIPS(lineItems, batchName);
        break;
      case 'RTGS':
        content = PaymentGenerator.generateNEFT(lineItems, batchName);
        break;
      case 'Cheque':
        content = PaymentGenerator.generateCheque(lineItems, batchName);
        break;
      case 'Cash':
        content = PaymentGenerator.generateCash(lineItems, batchName);
        break;
      default:
        content = PaymentGenerator.generateNEFT(lineItems, batchName);
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
                  <Input
                    placeholder="2081/82"
                    value={fiscalYear}
                    onChange={(e) => setFiscalYear(e.target.value)}
                  />
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
                    <span className="ml-2 text-primary">
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
              <TableRow key={batch.id} className={selectedBatch === batch.id ? 'bg-muted/30' : ''}>
                <TableCell className="font-medium">{batch.batch_name}</TableCell>
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
                      onClick={() => setViewBatchId(batch.id)}
                    >
                      <Eye className="w-3 h-3 mr-1" />
                      View
                    </Button>
                    {(batch.status === 'Approved' || batch.status === 'Draft') && (
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
                        onClick={() => setSelectedBatch(batch.id === selectedBatch ? null : batch.id)}
                      >
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Approve
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
      <Dialog open={!!viewBatchId} onOpenChange={(open) => !open && setViewBatchId(null)}>
        <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Batch Details</DialogTitle>
          </DialogHeader>
          {selectedBatchData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Batch Name</p>
                  <p className="text-sm font-medium">{selectedBatchData.batch_name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Payment Method</p>
                  <p className="text-sm font-medium">{selectedBatchData.payment_method}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge variant={statusVariant(selectedBatchData.status)}>{selectedBatchData.status}</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Amount</p>
                  <p className="text-sm font-medium">NPR {(selectedBatchData.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                </div>
              </div>

              {selectedBatchData.status === 'Draft' && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      if (viewBatchId && confirm('Add all matching payables to this batch?')) {
                        addPayablesToBatch(viewBatchId);
                      }
                    }}
                  >
                    Add Payables ({availablePayables.length} available)
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => {
                      if (viewBatchId) {
                        updateBatchStatus({ batchId: viewBatchId, status: 'Approved' });
                      }
                    }}
                  >
                    Approve Batch
                  </Button>
                </div>
              )}

              {selectedBatchData.status === 'Approved' && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => {
                      if (viewBatchId) {
                        updateBatchStatus({ batchId: viewBatchId, status: 'Processed' });
                      }
                    }}
                  >
                    Mark as Processed
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDownloadPaymentFile(selectedBatchData)}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download {selectedBatchData.payment_method} File
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lineItemsLoading ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-4 text-muted-foreground">Loading...</TableCell></TableRow>
                    ) : lineItems && lineItems.length > 0 ? (
                      lineItems.map((item: PaymentLineItem) => (
                        <TableRow key={item.id}>
                          <TableCell>{item.client_id.slice(0, 8)}…</TableCell>
                          <TableCell>{item.bank_name || 'N/A'}</TableCell>
                          <TableCell className="font-mono text-xs">{item.bank_account_no || 'N/A'}</TableCell>
                          <TableCell className="text-right font-medium">
                            NPR {(item.net_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
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

      {/* Sticky Approval Bar when a batch is selected */}
      {selectedBatch && selectedBatchData && (
        <ApprovalBar
          recordId={selectedBatch}
          tableName="payment_batches"
          canApprove={true}
          onStatusChange={() => {
            setSelectedBatch(null);
            qc.invalidateQueries({ queryKey: ['payments'] });
          }}
        />
      )}
    </div>
  );
}