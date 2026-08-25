import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Download, User } from 'lucide-react';
import { exportToExcel } from '@/lib/xlsx-utils';
import { format } from 'date-fns';

interface ShareholderStatementDialogProps {
  boid?: string | null;
  clientId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareholderStatementDialog({
  boid,
  clientId,
  open,
  onOpenChange,
}: ShareholderStatementDialogProps) {
  const { data: clientInfo, isLoading: isClientLoading } = useQuery({
    queryKey: ['shareholder-info', boid, clientId],
    queryFn: async () => {
      if (!boid && !clientId) return null;
      let q = supabase.from('clients').select('*, company:companies(company_name, company_code)');
      if (boid) q = q.eq('boid', boid);
      else if (clientId) q = q.eq('id', clientId);
      const { data, error } = await q.maybeSingle();
      if (error) return null;
      return data;
    },
    enabled: open && (!!boid || !!clientId),
  });

  const resolvedClientId = clientInfo?.id || clientId;
  const resolvedBoid = clientInfo?.boid || boid;

  const { data: statementRecords = [], isLoading: isStatementLoading } = useQuery({
    queryKey: ['shareholder-statement-ledger', resolvedClientId],
    queryFn: async () => {
      if (!resolvedClientId) return [];

      // 1. Fetch Payments to link actual payment references and dates
      const { data: paymentRows } = await (supabase as any)
        .from('payments')
        .select('*')
        .eq('client_id', resolvedClientId);

      const paymentMap = new Map<string, any>();
      for (const p of paymentRows || []) {
        if (p.payable_id) paymentMap.set(p.payable_id, p);
      }

      // 2. Fetch Interest Payables
      const { data: interestRows } = await (supabase as any)
        .from('interest_payables')
        .select('*, company:companies(company_name, company_code)')
        .eq('client_id', resolvedClientId);

      // 3. Fetch Dividend Payables
      const { data: dividendRows } = await (supabase as any)
        .from('dividend_payables')
        .select('*, company:companies(company_name, company_code)')
        .eq('client_id', resolvedClientId);

      // 4. Fetch Mutual Fund Payables
      const { data: mutualFundRows } = await (supabase as any)
        .from('mutual_fund_payables')
        .select('*, company:companies(company_name, company_code)')
        .eq('client_id', resolvedClientId);

      const records: Array<{
        id: string;
        type: 'Debenture Interest' | 'Stock Dividend' | 'Mutual Fund';
        companyName: string;
        fiscalYear: string;
        grossAmount: number;
        taxAmount: number;
        netAmount: number;
        status: string;
        paymentDate: string | null;
        paymentRef: string | null;
        bankDetails: string | null;
      }> = [];

      for (const r of interestRows || []) {
        const linkedPay = paymentMap.get(r.id);
        records.push({
          id: r.id,
          type: 'Debenture Interest',
          companyName: r.company?.company_name || '8 5% RBB Debentures 2083',
          fiscalYear: r.fiscal_year || '2082/83',
          grossAmount: Number(r.gross_interest || 0),
          taxAmount: Number(r.tax_amount || 0),
          netAmount: Number(r.net_payable || 0),
          status: r.payment_status || (linkedPay ? 'Paid' : 'Pending'),
          paymentDate: r.payment_date || linkedPay?.payment_date || null,
          paymentRef: r.payment_reference || linkedPay?.payment_reference || linkedPay?.connectips_ref || (r.payment_status === 'Paid' ? 'RECON-AUTO' : null),
          bankDetails: r.bank_account_no ? `${r.bank_name || ''} (${r.bank_account_no})` : null,
        });
      }

      for (const r of dividendRows || []) {
        const linkedPay = paymentMap.get(r.id);
        records.push({
          id: r.id,
          type: 'Stock Dividend',
          companyName: r.company?.company_name || 'Equities',
          fiscalYear: r.fiscal_year || '2081/82',
          grossAmount: Number(r.gross_dividend || 0),
          taxAmount: Number(r.tax_amount || 0),
          netAmount: Number(r.net_payable || 0),
          status: r.payment_status || (linkedPay ? 'Paid' : 'Pending'),
          paymentDate: r.payment_date || linkedPay?.payment_date || null,
          paymentRef: r.payment_reference || linkedPay?.payment_reference || linkedPay?.connectips_ref || null,
          bankDetails: r.bank_account_no ? `${r.bank_name || ''} (${r.bank_account_no})` : null,
        });
      }

      for (const r of mutualFundRows || []) {
        const linkedPay = paymentMap.get(r.id);
        records.push({
          id: r.id,
          type: 'Mutual Fund',
          companyName: r.company?.company_name || 'Mutual Funds',
          fiscalYear: r.fiscal_year || '2081/82',
          grossAmount: Number(r.gross_dividend || 0),
          taxAmount: Number(r.tax_amount || 0),
          netAmount: Number(r.net_payable || 0),
          status: r.payment_status || (linkedPay ? 'Paid' : 'Pending'),
          paymentDate: r.payment_date || linkedPay?.payment_date || null,
          paymentRef: r.payment_reference || linkedPay?.payment_reference || linkedPay?.connectips_ref || null,
          bankDetails: r.bank_account_no ? `${r.bank_name || ''} (${r.bank_account_no})` : null,
        });
      }

      return records;
    },
    enabled: open && !!resolvedClientId,
  });

  const totals = useMemo(() => {
    let gross = 0, tax = 0, net = 0, paid = 0, pending = 0;
    for (const r of statementRecords) {
      gross += r.grossAmount;
      tax += r.taxAmount;
      net += r.netAmount;
      if (r.status === 'Paid') paid += r.netAmount;
      else pending += r.netAmount;
    }
    return { gross, tax, net, paid, pending };
  }, [statementRecords]);

  const handleExport = () => {
    if (!statementRecords.length) return;
    const exportData = statementRecords.map((r, i) => ({
      'S.N.': i + 1,
      'Shareholder Name': clientInfo?.full_name || 'Shareholder',
      'BOID': resolvedBoid || '',
      'Company / Scheme': r.companyName,
      'Distribution Type': r.type,
      'Fiscal Year': r.fiscalYear,
      'Gross Amount (NPR)': r.grossAmount,
      'TDS Tax Deducted (NPR)': r.taxAmount,
      'Net Entitlement (NPR)': r.netAmount,
      'Payment Status': r.status,
      'Payment Date': r.paymentDate ? format(new Date(r.paymentDate), 'dd MMM yyyy') : '—',
      'Payment Reference': r.paymentRef || '—',
      'Bank Account': r.bankDetails || clientInfo?.bank_account_no || '—',
    }));

    exportToExcel(exportData, `Statement_${resolvedBoid || 'Shareholder'}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between pb-2 border-b">
          <div>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              Shareholder Payout & Distribution Statement (लाभांश / ब्याज विवरण)
            </DialogTitle>
            <DialogDescription className="text-xs">
              Complete historical transaction ledger across all fiscal years and schemes.
            </DialogDescription>
          </div>
          {statementRecords.length > 0 && (
            <Button size="sm" variant="outline" className="h-8 text-xs cursor-pointer" onClick={handleExport}>
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Export Statement (Excel)
            </Button>
          )}
        </DialogHeader>

        {/* Shareholder Metadata Header */}
        <div className="bg-muted/30 p-3.5 rounded-lg border text-xs grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <span className="text-muted-foreground block text-[11px]">Shareholder Name</span>
            <span className="font-bold text-foreground text-sm">{clientInfo?.full_name || '—'}</span>
            {clientInfo?.father_name && (
              <span className="text-[10px] text-muted-foreground block">s/o {clientInfo.father_name}</span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">BOID (Demat No.)</span>
            <span className="font-mono font-semibold text-foreground">{resolvedBoid || '—'}</span>
            <Badge variant="outline" className="text-[10px] mt-0.5">
              {clientInfo?.holder_type || 'Public'}
            </Badge>
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">Bank Account</span>
            <span className="font-medium text-foreground">{clientInfo?.bank_name || '—'}</span>
            <span className="font-mono text-[11px] text-muted-foreground block">{clientInfo?.bank_account_no || '—'}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">PAN / Citizenship</span>
            <span className="font-mono text-foreground font-medium">{clientInfo?.pan_no || clientInfo?.citizenship_no || clientInfo?.pan_or_citizenship || '—'}</span>
            {clientInfo?.phone && (
              <span className="text-[10px] text-muted-foreground block">Phone: {clientInfo.phone}</span>
            )}
          </div>
        </div>

        {/* Summary Metric Strips */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <Card className="p-2.5 bg-card">
            <span className="text-[11px] text-muted-foreground block">Total Gross Earnings</span>
            <span className="text-sm font-bold font-mono">
              NPR {totals.gross.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </Card>
          <Card className="p-2.5 bg-card">
            <span className="text-[11px] text-muted-foreground block">Total Tax (TDS) Withheld</span>
            <span className="text-sm font-bold font-mono text-amber-600">
              NPR {totals.tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </Card>
          <Card className="p-2.5 bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200">
            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 block">Total Net Paid (Settled)</span>
            <span className="text-sm font-bold font-mono text-emerald-600">
              NPR {totals.paid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </Card>
          <Card className="p-2.5 bg-rose-50/50 dark:bg-rose-950/20 border-rose-200">
            <span className="text-[11px] text-rose-700 dark:text-rose-400 block">Total Pending (Due)</span>
            <span className="text-sm font-bold font-mono text-rose-600">
              NPR {totals.pending.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </Card>
        </div>

        {/* Historical Distribution Table */}
        <div className="border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 text-xs">
                <TableHead>Fiscal Year</TableHead>
                <TableHead>Scheme / Company</TableHead>
                <TableHead>Distribution Type</TableHead>
                <TableHead className="text-right">Gross (NPR)</TableHead>
                <TableHead className="text-right">TDS (NPR)</TableHead>
                <TableHead className="text-right">Net Payable</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment Ref / Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isStatementLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-xs text-muted-foreground">
                    Loading historical statement...
                  </TableCell>
                </TableRow>
              ) : statementRecords.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-xs text-muted-foreground">
                    No distribution or payment records found for this shareholder.
                  </TableCell>
                </TableRow>
              ) : (
                statementRecords.map((r) => (
                  <TableRow key={r.id} className="text-xs hover:bg-muted/30">
                    <TableCell className="font-semibold font-mono">{r.fiscalYear}</TableCell>
                    <TableCell className="font-medium">{r.companyName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {r.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {r.grossAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-amber-600">
                      {r.taxAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-foreground">
                      {r.netAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={r.status === 'Paid' ? 'default' : r.status === 'Rejected' ? 'destructive' : 'secondary'}
                        className="text-[10px]"
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-[11px]">
                      {r.paymentDate && (
                        <div className="text-foreground font-medium">
                          {format(new Date(r.paymentDate), 'dd MMM yyyy')}
                        </div>
                      )}
                      {r.paymentRef && (
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {r.paymentRef}
                        </div>
                      )}
                      {!r.paymentDate && !r.paymentRef && '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
