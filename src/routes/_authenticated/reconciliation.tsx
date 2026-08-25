import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { ExcelParser } from '@/lib/excel-parser';
import { BankParser } from '@/lib/bank-parser';
import { ReconciliationEngine, ComprehensiveReconciliationReport, ReconciliationMatch } from '@/lib/reconciliation-engine';
import { ReconciliationService, ReconciliationResultRow } from '@/lib/services/reconciliation.service';
import { useAuth } from '@/hooks/use-auth';
import { Upload, FileSpreadsheet, RefreshCw, Play, Download, Filter, Search, X, CheckCircle2, AlertTriangle, XCircle, RotateCcw, Trash2, CheckSquare, Square, CreditCard, Building2, ChevronDown, ChevronUp, Layers, ExternalLink } from 'lucide-react';
import { ReconciliationGroupedLot } from '@/lib/services/reconciliation.service';
import { toast } from 'sonner';

export const Route = createFileRoute('/_authenticated/reconciliation')({
  component: ReconciliationRoute,
});

export function ReconciliationRoute() {
  const qc = useQueryClient();
  const [report, setReport] = useState<ComprehensiveReconciliationReport | null>(null);
  const [savedResults, setSavedResults] = useState<ReconciliationResultRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [historyVisibleCount, setHistoryVisibleCount] = useState(15);
  const [expandedLotKey, setExpandedLotKey] = useState<string | null>(null);
  const [historySearchQuery, setHistorySearchQuery] = useState<string>('');
  const [historyCompanyFilter, setHistoryCompanyFilter] = useState<string>('all');
  const [historySourceFilter, setHistorySourceFilter] = useState<string>('all');
  const [lotDetailTabs, setLotDetailTabs] = useState<Record<string, 'all' | 'matched' | 'rejected' | 'discrepancy'>>({});

  const { hasAny, isAdmin } = useAuth();
  const canApply = hasAny(['admin', 'finance_operator', 'reconciliation_officer']);
  const canDelete = isAdmin;

  const groupedLots = useMemo(() => {
    return ReconciliationService.groupResultsIntoLots(savedResults);
  }, [savedResults]);

  const { data: registeredCompanies = [] } = useQuery<string[]>({
    queryKey: ['registered_companies_recon'],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('id, company_name, company_code').order('company_name');
      if (error) return [];
      return (data || []).map((c: any) => c.company_name).filter(Boolean);
    },
  });

  const historyCompanies = useMemo(() => {
    if (registeredCompanies.length > 0) return registeredCompanies;
    const set = new Set<string>();
    for (const lot of groupedLots) {
      if (lot.companyName && lot.companyName !== 'General Payables') set.add(lot.companyName);
    }
    return Array.from(set).sort();
  }, [registeredCompanies, groupedLots]);

  const filteredGroupedLots = useMemo(() => {
    let list = groupedLots;
    if (historyCompanyFilter !== 'all') {
      list = list.filter(l => l.companyName === historyCompanyFilter);
    }
    if (historySourceFilter === 'bank_statement') {
      list = list.filter(l =>
        (l.fileName && l.fileName.toLowerCase().includes('statement')) ||
        l.lotName.toLowerCase().includes('statement') ||
        l.records.some(r => r.source_a_type === 'bank_statement' || (r.notes && r.notes.toLowerCase().includes('statement')))
      );
    } else if (historySourceFilter === 'connectips') {
      list = list.filter(l =>
        !((l.fileName && l.fileName.toLowerCase().includes('statement')) || l.lotName.toLowerCase().includes('statement')) &&
        ((l.fileName && l.fileName.toLowerCase().includes('ips')) ||
          l.lotName.toLowerCase().includes('ips') ||
          l.lotName.toLowerCase().includes('lot') ||
          l.lotName.toLowerCase().includes('batch') ||
          l.records.some(r => r.notes && r.notes.toLowerCase().includes('connectips')))
      );
    }
    return list;
  }, [groupedLots, historyCompanyFilter, historySourceFilter]);

  const handleRevertLot = async (lot: ReconciliationGroupedLot) => {
    if (!isAdmin) {
      toast.error('Only administrators are authorized to revert and remove reconciliation lots.');
      return;
    }
    if (!window.confirm(`Are you sure you want to revert and remove "${lot.lotName}"? This will reset all its payables back to "Pending" and remove this lot from history.`)) return;
    setIsApplying(true);
    try {
      const res = await ReconciliationService.revertLot(lot);
      if (res.success) {
        toast.success(`Reverted "${lot.lotName}": ${res.revertedPayables} payables reset to Pending.`);
        const deletedIds = new Set(lot.records.map(r => r.id));
        setSavedResults(prev => prev.filter(r => !deletedIds.has(r.id)));
        qc.invalidateQueries({ queryKey: ['payments'] });
        qc.invalidateQueries({ queryKey: ['payables'] });
        qc.invalidateQueries({ queryKey: ['interest_payables'] });
        qc.invalidateQueries({ queryKey: ['dividend_payables'] });
        qc.invalidateQueries({ queryKey: ['mutual_fund_payables'] });
        loadHistory();
      } else {
        toast.error('Failed to revert lot.');
      }
    } finally {
      setIsApplying(false);
    }
  };

  const handleDeleteLot = async (lot: ReconciliationGroupedLot) => {
    if (!isAdmin) {
      toast.error('Only administrators are authorized to delete reconciliation records.');
      return;
    }
    if (!window.confirm(`Are you sure you want to delete history for "${lot.lotName}" (${lot.totalRecords} records)?`)) return;
    setIsLoadingHistory(true);
    try {
      const ids = lot.records.map(r => r.id);
      const ok = await ReconciliationService.deleteRecords(ids);
      if (ok) {
        toast.success(`Deleted lot "${lot.lotName}"`);
        const deletedIds = new Set(ids);
        setSavedResults(prev => prev.filter(r => !deletedIds.has(r.id)));
        loadHistory();
      } else {
        toast.error('Failed to delete lot');
      }
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleExportLot = (lot: ReconciliationGroupedLot) => {
    const csvContent = [
      ['BOID', 'Shareholder Name', 'Company', 'Payable Type', 'Status', 'Expected Amount', 'Actual Amount', 'Difference', 'Bank Name', 'Account No', 'Notes'].join(','),
      ...lot.records.map(r => [
        r.client?.boid || '',
        `"${r.client?.full_name || ''}"`,
        `"${r.company?.company_name || lot.companyName}"`,
        r.payable_type || lot.payableType,
        r.result,
        (r.expected_amount || 0).toFixed(2),
        (r.actual_amount || 0).toFixed(2),
        (r.difference || 0).toFixed(2),
        `"${r.client?.bank_name || ''}"`,
        `"${r.client?.bank_account_no || ''}"`,
        `"${r.notes || ''}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconciliation-${lot.lotName.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success(`Exported ${lot.records.length} records for ${lot.lotName}`);
  };

  const loadHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const results = await ReconciliationService.getResults(10000, 0);
      setSavedResults(results);
    } catch (error) {
      console.warn('Could not load reconciliation history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      // First try checking if it is a Bank / ConnectIPS settlement file
      const fileName = file.name.toLowerCase();
      const isBankReport = fileName.includes('ips') || fileName.includes('report') || fileName.includes('bank') || fileName.includes('statement') || fileName.includes('batch');

      if (isBankReport) {
        try {
          const transactions = await BankParser.parseBankStatement(file);
          if (transactions.length > 0) {
            const rep = await ReconciliationEngine.analyzeBankStatement(transactions);
            setReport(rep);
            toast.success(`Successfully analyzed ${file.name} (${transactions.length} transactions)`);
            setIsProcessing(false);
            return;
          }
        } catch (bErr) {
          console.warn('Bank parser fallback to Excel parser:', bErr);
        }
      }

      const parsedData = await ExcelParser.parseFile(file);
      const rep = await ReconciliationEngine.analyzeParsedExcel(parsedData);
      setReport(rep);
      toast.success(`Successfully analyzed ${file.name}`);
    } catch (error) {
      console.error(error);
      toast.error('Failed to parse Excel file for reconciliation');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBankStatementUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      const transactions = await BankParser.parseBankStatement(file);
      const rep = await ReconciliationEngine.analyzeBankStatement(transactions);
      setReport(rep);
      toast.success(`Successfully analyzed settlement / statement ${file.name} (${transactions.length} transactions)`);
    } catch (error) {
      console.error(error);
      toast.error('Failed to parse bank statement file for reconciliation');
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredMatches = useMemo(() => {
    if (!report?.matches) return [];

    return report.matches.filter(match => {
      const matchesSearch = !searchQuery ||
        match.boid.toLowerCase().includes(searchQuery.toLowerCase()) ||
        match.shareholderName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        match.category.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus = statusFilter === 'all' || match.status === statusFilter;
      const matchesSource = sourceFilter === 'all' || match.sourceType === sourceFilter;

      return matchesSearch && matchesStatus && matchesSource;
    });
  }, [report, searchQuery, statusFilter, sourceFilter]);

  const unmatchedBankMatches = useMemo(() => {
    return filteredMatches.filter(m => m.sourceType === 'bank_statement' && m.status === 'Missing');
  }, [filteredMatches]);

  const rejectedMatches = useMemo(() => {
    return filteredMatches.filter(m => m.status === 'Rejected');
  }, [filteredMatches]);

  const matchedOnlyMatches = useMemo(() => {
    return filteredMatches.filter(m => m.status === 'Matched');
  }, [filteredMatches]);

  const isUUID = (str: any): boolean =>
    typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

  const buildResults = (targetMatches?: ReconciliationMatch[]) => {
    const matchesToConvert = targetMatches || report?.matches || [];
    if (!matchesToConvert.length) return [];
    const today = new Date().toISOString().slice(0, 10);
    return matchesToConvert.map(match => {
      const isBankStatement = report?.sourceType === 'bank_statement';
      const clientId = isUUID(match.clientId) ? match.clientId : null;
      const companyId = isUUID(match.companyId) ? match.companyId : null;
      const payableId = isUUID(match.payableId) ? match.payableId : null;
      const paymentId = isUUID(match.paymentId) ? match.paymentId : null;
      const sourceBId = isBankStatement ? (paymentId || payableId) : payableId;

      const fileNamePrefix = report?.fileName ? `File: ${report.fileName}` : '';
      const lotPrefix = match.lotName ? `Lot: ${match.lotName}` : '';
      const contextPrefix = [fileNamePrefix, lotPrefix].filter(Boolean).join(' | ');

      return {
        reconciliation_date: today,
        source_a_type: isBankStatement ? 'bank_statement' : 'excel',
        source_a_id: null,
        source_b_type: isBankStatement ? (paymentId ? 'payment' : 'payable') : 'payable',
        source_b_id: sourceBId,
        client_id: clientId,
        company_id: companyId,
        payable_type: match.payableType || 'dividend',
        payable_id: payableId,
        expected_amount: isBankStatement ? match.systemAmount : match.excelAmount,
        actual_amount: isBankStatement ? match.excelAmount : match.systemAmount,
        difference: match.difference,
        result: match.status,
        notes: `${contextPrefix ? `[${contextPrefix}] ` : ''}Category: ${match.category}${isBankStatement ? ` / Bank Transaction ${match.transactionDate ?? ''}` : ''}${match.matchSources ? ` / Sources: ${match.matchSources.join(', ')}` : ''}`.trim(),
        matched_by: null,
        matched_at: null,
      };
    });
  };

  const handleSaveReconciliation = async () => {
    if (!report?.matches?.length) {
      toast.error('No reconciliation report to save.');
      return;
    }

    setIsSaving(true);
    try {
      const results = buildResults();
      await ReconciliationService.saveResults(results);
      toast.success(`Saved ${results.length.toLocaleString()} reconciliation records.`);
      await loadHistory();
    } catch (error) {
      console.error('Save reconciliation failed:', error);
      toast.error('Failed to save reconciliation results.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearHistory = async () => {
    if (!isAdmin) {
      toast.error('Only administrators are authorized to clear reconciliation history.');
      return;
    }
    if (!window.confirm('Are you sure you want to clear saved reconciliation history logs?')) return;
    setIsLoadingHistory(true);
    try {
      const ok = await ReconciliationService.clearHistory();
      if (ok) {
        toast.success('Reconciliation history cleared.');
        setSavedResults([]);
      } else {
        toast.error('Failed to clear history.');
      }
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleRevertReconciliation = async () => {
    if (!isAdmin) {
      toast.error('Only administrators are authorized to revert reconciliation.');
      return;
    }
    if (!window.confirm('Are you sure you want to revert auto-reconciled payments? This will set payables back to "Pending" and delete auto-created reconciliation payments.')) return;
    setIsApplying(true);
    try {
      const res = await ReconciliationService.revertReconciliation();
      if (res.success) {
        toast.success(`Reverted: ${res.revertedPayables} payables reset to Pending, ${res.deletedPayments} payment records removed.`);
        qc.invalidateQueries({ queryKey: ['payments'] });
        qc.invalidateQueries({ queryKey: ['payables'] });
        qc.invalidateQueries({ queryKey: ['interest_payables'] });
        qc.invalidateQueries({ queryKey: ['dividend_payables'] });
        qc.invalidateQueries({ queryKey: ['mutual_fund_payables'] });
        await loadHistory();
      } else {
        toast.error('Failed to revert reconciliation payments.');
      }
    } finally {
      setIsApplying(false);
    }
  };

  const handleApplyReconciliation = async () => {
    if (!report?.matches?.length) {
      toast.error('No reconciliation report to apply.');
      return;
    }

    setIsApplying(true);
    try {
      const results = buildResults(report.matches);
      const applyRes = await ReconciliationService.applyReconciliation(results as ReconciliationResultRow[]);
      await ReconciliationService.saveResults(results);
      toast.success(`Applied reconciliation: ${applyRes.updated} payables updated, ${applyRes.paymentsCreated} payments created.`);
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['payables'] });
      qc.invalidateQueries({ queryKey: ['interest_payables'] });
      qc.invalidateQueries({ queryKey: ['dividend_payables'] });
      qc.invalidateQueries({ queryKey: ['mutual_fund_payables'] });
      await loadHistory();
    } catch (err: any) {
      console.error('Failed to apply reconciliation:', err);
      toast.error(`Failed to apply reconciliation: ${err?.message || err}`);
    } finally {
      setIsApplying(false);
    }
  };

  const handleExportReport = () => {
    if (!report?.matches) return;

    const csvContent = [
      ['BOID', 'Name', 'Category', 'Status', 'Excel Amount', 'System Amount', 'Difference', 'Match Sources'].join(','),
      ...filteredMatches.map(m => [
        m.boid,
        `"${m.shareholderName}"`,
        `"${m.category}"`,
        m.status,
        m.excelAmount.toFixed(2),
        m.systemAmount.toFixed(2),
        m.difference.toFixed(2),
        m.matchSources?.join(';') || 'None'
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconciliation-${report.fileName}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success('Report exported successfully');
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'Matched': return 'default';
      case 'Missing': return 'destructive';
      case 'Over_Paid':
      case 'Under_Paid': return 'outline';
      case 'Pledged': return 'secondary';
      case 'Rejected': return 'destructive';
      case 'Pending': return 'outline';
      default: return 'outline';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Matched': return <CheckCircle2 className="w-4 h-4 text-green-600" />;
      case 'Missing': return <XCircle className="w-4 h-4 text-red-600" />;
      case 'Over_Paid':
      case 'Under_Paid': return <AlertTriangle className="w-4 h-4 text-amber-600" />;
      default: return null;
    }
  };

  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(new Set());

  const toggleSelectMatch = (id: string) => {
    setSelectedMatchIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    if (selectedMatchIds.size === filteredMatches.length) {
      setSelectedMatchIds(new Set());
    } else {
      setSelectedMatchIds(new Set(filteredMatches.map(m => m.id)));
    }
  };

  const selectOnlyMatched = () => {
    setSelectedMatchIds(new Set(matchedOnlyMatches.map(m => m.id)));
  };

  const selectOnlyRejected = () => {
    setSelectedMatchIds(new Set(rejectedMatches.map(m => m.id)));
  };

  const clearSelection = () => {
    setSelectedMatchIds(new Set());
  };

  const handleApplySelected = async () => {
    if (selectedMatchIds.size === 0) return;
    const selectedMatches = (report?.matches || []).filter(m => selectedMatchIds.has(m.id));
    if (selectedMatches.length === 0) return;

    setIsApplying(true);
    try {
      const allSelectedResults = buildResults(selectedMatches);
      const applyRes = await ReconciliationService.applyReconciliation(allSelectedResults as ReconciliationResultRow[]);
      await ReconciliationService.saveResults(allSelectedResults);
      const rejectedCount = allSelectedResults.filter(r => r.result === 'Rejected').length;
      toast.success(
        `Applied ${allSelectedResults.length} records: ${applyRes.updated} payables updated to Paid${rejectedCount > 0 ? `, ${rejectedCount} rejected recorded in history` : ''}.`
      );
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['payables'] });
      qc.invalidateQueries({ queryKey: ['interest_payables'] });
      qc.invalidateQueries({ queryKey: ['dividend_payables'] });
      qc.invalidateQueries({ queryKey: ['mutual_fund_payables'] });
      await loadHistory();
      clearSelection();
    } catch (err: any) {
      console.error('Failed to apply selected:', err);
      toast.error(`Failed to apply selected records: ${err?.message || err}`);
    } finally {
      setIsApplying(false);
    }
  };

  const handleExportSelected = () => {
    const toExport = (report?.matches || []).filter(m => selectedMatchIds.has(m.id));
    if (toExport.length === 0) return;

    const csvContent = [
      ['BOID', 'Name', 'Category', 'Status', 'Excel / Bank Amount', 'System Amount', 'Difference', 'Bank Name', 'Account No', 'Match Sources'].join(','),
      ...toExport.map(m => [
        m.boid,
        `"${m.shareholderName}"`,
        `"${m.category}"`,
        m.status,
        m.excelAmount.toFixed(2),
        m.systemAmount.toFixed(2),
        m.difference.toFixed(2),
        `"${m.bankName || ''}"`,
        `"${m.bankAccountNo || ''}"`,
        m.matchSources?.join(';') || 'None'
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconciliation-selected-${toExport.length}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success(`Exported ${toExport.length} selected records`);
  };

  const renderMatchRow = (match: ReconciliationMatch) => {
    const isSelected = selectedMatchIds.has(match.id);

    return (
      <div
        key={match.id}
        className={`rounded-lg border p-3.5 transition-all ${
          isSelected
            ? 'border-primary/50 bg-primary/5 shadow-sm'
            : 'bg-background hover:bg-muted/30'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="pt-0.5">
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggleSelectMatch(match.id)}
              aria-label={`Select ${match.shareholderName}`}
            />
          </div>
          <div className="flex-1 min-w-0">
            {/* Header: Name, BOID, Status Badges */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-foreground">
                  {match.shareholderName || 'Unknown Shareholder'}
                </span>
                <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground border">
                  BOID: {match.boid}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge variant={getStatusBadgeVariant(match.status)} className="text-xs">
                  {match.status.replace('_', ' ')}
                </Badge>
                {match.matchSources && match.matchSources.length > 0 && (
                  <div className="flex gap-1">
                    {match.matchSources.map(source => (
                      <Badge key={source} variant="outline" className="text-[10px] h-5 capitalize">
                        {source}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Sub-row: Bank details & Category info */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-muted-foreground">
              {(match.bankName || match.bankAccountNo) && (
                <div className="flex items-center gap-1">
                  <CreditCard className="w-3.5 h-3.5 text-muted-foreground/70" />
                  <span>
                    <strong>{match.bankName || 'Bank'}</strong>
                    {match.bankAccountNo ? ` • A/C: ${match.bankAccountNo}` : ''}
                  </span>
                </div>
              )}
              {match.payableType && (
                <div className="flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground/70" />
                  <span className="capitalize">{match.payableType} Payable</span>
                </div>
              )}
              {match.category && (
                <div>
                  <span>Category: <strong className="text-foreground">{match.category}</strong></span>
                </div>
              )}
              {match.transactionDate && (
                <div>
                  <span>Txn Date: {match.transactionDate}</span>
                </div>
              )}
            </div>

            {/* Financial comparison grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2.5 p-2 bg-muted/20 rounded-md border text-xs">
              <div>
                <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Excel / Bank</span>
                <span className="font-mono font-semibold text-foreground">
                  NPR {match.excelAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">System Amount</span>
                <span className="font-mono font-semibold text-foreground">
                  NPR {match.systemAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Difference</span>
                <span
                  className={`font-mono font-bold ${
                    match.difference !== 0
                      ? 'text-destructive'
                      : 'text-green-600 dark:text-green-400'
                  }`}
                >
                  {match.difference !== 0
                    ? (match.difference > 0 ? '+' : '') +
                      match.difference.toLocaleString('en-IN', { minimumFractionDigits: 2 })
                    : '0.00'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Status in DB</span>
                <span className="font-medium text-foreground">
                  {match.paymentStatus ? (
                    <Badge variant={match.paymentStatus === 'Paid' ? 'default' : 'outline'} className="text-[10px] h-4">
                      {match.paymentStatus}
                    </Badge>
                  ) : (
                    'Unpaid / Pending'
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <PageHeader
          title="Reconciliation Engine"
          description="5-way reconciliation: Excel vs Payables, Payments, Bank Statements with multi-source matching and discrepancy detection."
        />
        <div className="flex flex-wrap gap-2">
          <label htmlFor="reconcile-excel-upload">
            <Button variant="default" className="cursor-pointer" asChild disabled={isProcessing || isSaving || isApplying}>
              <span>
                <Upload className="w-4 h-4 mr-2" />
                {isProcessing ? 'Analyzing...' : 'Upload Excel File'}
              </span>
            </Button>
          </label>
          <input id="reconcile-excel-upload" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload} />
          <label htmlFor="reconcile-bank-upload">
            <Button variant="outline" className="cursor-pointer" asChild disabled={isProcessing || isSaving || isApplying}>
              <span>
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                {isProcessing ? 'Analyzing...' : 'Upload Bank Statement'}
              </span>
            </Button>
          </label>
          <input id="reconcile-bank-upload" type="file" accept=".xls,.xlsx,.xlsm,.csv,.txt" className="hidden" onChange={handleBankStatementUpload} />
        </div>
      </div>

      {report ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-bold tracking-tight">Reconciliation Analysis</h2>
              <p className="text-sm text-muted-foreground">
                {report.sourceType === 'excel' ? 'Excel' : 'Bank Statement'} • {report.fileName} • {report.matches.length.toLocaleString()} records
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={handleSaveReconciliation} disabled={isSaving || isProcessing || isApplying}>
                {isSaving ? 'Saving...' : 'Save Reconciliation'}
              </Button>
              {canApply && (
                <Button variant="default" size="sm" onClick={handleApplyReconciliation} disabled={isApplying || isProcessing || isSaving}>
                  {isApplying ? 'Applying...' : <><Play className="w-3 h-3 mr-1" /> Apply to System</>}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleExportReport}>
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => setReport(null)}>
                <RefreshCw className="w-4 h-4 mr-2" />
                New Analysis
              </Button>
            </div>
          </div>

          {report.summary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground">Matched (Payable)</p>
                  <p className="text-lg font-bold text-green-600">{report.summary.matchedFromPayable}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground">Matched (Payment)</p>
                  <p className="text-lg font-bold text-blue-600">{report.summary.matchedFromPayment}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground">Matched (Bank)</p>
                  <p className="text-lg font-bold text-purple-600">{report.summary.matchedFromBank}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground">Missing in System</p>
                  <p className="text-lg font-bold text-red-600">{report.summary.missingInSystem}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground">Discrepancies</p>
                  <p className="text-lg font-bold text-amber-600">{report.grandTotal.discrepancyCount}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {report.summary && (
            <Card className="bg-muted/30">
              <CardContent className="py-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">Overall Match Rate</span>
                  <span className="font-medium text-primary">
                    {Math.round((report.grandTotal.matchedRecords / Math.max(1, report.grandTotal.totalRecords)) * 100)}%
                  </span>
                </div>
                <div className="h-4 w-full bg-muted rounded-full overflow-hidden flex">
                  <div className="bg-green-500 h-full transition-all" style={{ width: `${(report.summary.matchedFromPayable / Math.max(1, report.grandTotal.totalRecords)) * 100}%` }} title="Matched from Payable" />
                  <div className="bg-blue-500 h-full transition-all" style={{ width: `${(report.summary.matchedFromPayment / Math.max(1, report.grandTotal.totalRecords)) * 100}%` }} title="Matched from Payment" />
                  <div className="bg-purple-500 h-full transition-all" style={{ width: `${(report.summary.matchedFromBank / Math.max(1, report.grandTotal.totalRecords)) * 100}%` }} title="Matched from Bank" />
                  <div className="bg-amber-400 h-full transition-all" style={{ width: `${(report.grandTotal.discrepancyCount / Math.max(1, report.grandTotal.totalRecords)) * 100}%` }} title="Discrepancies" />
                  <div className="bg-red-500 h-full transition-all" style={{ width: `${(report.summary.missingInSystem / Math.max(1, report.grandTotal.totalRecords)) * 100}%` }} title="Missing" />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-muted-foreground">
                  <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-green-500 mr-1" /> Payable Match</div>
                  <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-blue-500 mr-1" /> Payment Match</div>
                  <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-purple-500 mr-1" /> Bank Match</div>
                  <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-amber-400 mr-1" /> Discrepancies</div>
                  <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-red-500 mr-1" /> Missing</div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Filter & Search
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Search (BOID/Name/Category)</Label>
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="Matched">Matched</SelectItem>
                      <SelectItem value="Missing">Missing</SelectItem>
                      <SelectItem value="Over_Paid">Over Paid</SelectItem>
                      <SelectItem value="Under_Paid">Under Paid</SelectItem>
                      <SelectItem value="Pledged">Pledged</SelectItem>
                      <SelectItem value="Rejected">Rejected</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Source Type</Label>
                  <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sources</SelectItem>
                      <SelectItem value="excel">Excel Files</SelectItem>
                      <SelectItem value="bank_statement">Bank Statements</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {(searchQuery || statusFilter !== 'all' || sourceFilter !== 'all') && (
                <div className="mt-3 text-sm text-muted-foreground">
                  Showing {filteredMatches.length} of {report.matches.length} records
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle className="text-sm">Detailed Reconciliation Matches</CardTitle>
                  <CardDescription>
                    5-way matching: Payables • Payments • Bank Statements • Cross-references
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Smart Bulk Selection & Quick Actions Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 mb-3 bg-muted/30 rounded-lg border">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-medium cursor-pointer"
                    onClick={selectAllFiltered}
                  >
                    <CheckSquare className="w-3.5 h-3.5 mr-1.5" />
                    {selectedMatchIds.size === filteredMatches.length && filteredMatches.length > 0
                      ? 'Deselect All'
                      : `Select All (${filteredMatches.length})`}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs cursor-pointer text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/20"
                    onClick={selectOnlyMatched}
                  >
                    Select Matched ({matchedOnlyMatches.length})
                  </Button>
                  {rejectedMatches.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs cursor-pointer text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                      onClick={selectOnlyRejected}
                    >
                      Select Rejected ({rejectedMatches.length})
                    </Button>
                  )}
                  {selectedMatchIds.size > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                      onClick={clearSelection}
                    >
                      Clear ({selectedMatchIds.size})
                    </Button>
                  )}
                </div>

                {selectedMatchIds.size > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-primary">
                      {selectedMatchIds.size} selected
                    </span>
                    {canApply && (
                      <Button
                        size="sm"
                        className="h-8 text-xs font-medium cursor-pointer"
                        onClick={handleApplySelected}
                        disabled={isApplying}
                      >
                        <Play className="w-3.5 h-3.5 mr-1.5" />
                        Apply Selected ({(report.matches || []).filter(m => selectedMatchIds.has(m.id) && m.status === 'Matched').length})
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs font-medium cursor-pointer"
                      onClick={handleExportSelected}
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      Export Selected ({selectedMatchIds.size})
                    </Button>
                  </div>
                )}
              </div>

              <Tabs defaultValue="all" className="w-full">
                <TabsList className="mb-4">
                  <TabsTrigger value="all">All Records ({filteredMatches.length})</TabsTrigger>
                  <TabsTrigger value="matched">
                    Matched / Paid ({matchedOnlyMatches.length})
                  </TabsTrigger>
                  <TabsTrigger value="rejected">
                    Rejected / Bounced ({rejectedMatches.length})
                    {rejectedMatches.length > 0 && (
                      <Badge variant="destructive" className="ml-2 h-5 text-[10px] rounded-full px-1.5 min-w-[20px] justify-center">
                        {rejectedMatches.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="unmatched_bank">
                    Unmatched Bank Txns 
                    {unmatchedBankMatches.length > 0 && (
                      <Badge variant="destructive" className="ml-2 h-5 text-[10px] rounded-full px-1.5 min-w-[20px] justify-center">
                        {unmatchedBankMatches.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="all" className="m-0 space-y-2 max-h-[600px] overflow-y-auto pr-1">
                  {filteredMatches.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No matches found for current filters.</p>
                  ) : (
                    filteredMatches.map(renderMatchRow)
                  )}
                </TabsContent>
                <TabsContent value="matched" className="m-0 space-y-2 max-h-[600px] overflow-y-auto pr-1">
                  {matchedOnlyMatches.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No matched records found.</p>
                  ) : (
                    matchedOnlyMatches.map(renderMatchRow)
                  )}
                </TabsContent>
                <TabsContent value="rejected" className="m-0 space-y-2 max-h-[600px] overflow-y-auto pr-1">
                  {rejectedMatches.length === 0 ? (
                    <div className="text-center py-10 bg-green-50/50 rounded-lg border border-green-100 dark:bg-green-950/10 dark:border-green-900/30">
                      <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-2 opacity-80" />
                      <p className="text-sm font-medium text-green-700 dark:text-green-400">No Rejected Transactions</p>
                      <p className="text-xs text-green-600/70 dark:text-green-500/70 mt-1">All bank settlement payouts were accepted successfully.</p>
                    </div>
                  ) : (
                    <>
                      <Alert variant="destructive" className="mb-3">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          These {rejectedMatches.length} payouts were rejected by the destination bank (status: RJCT). When you click "Apply to System", these will remain unpaid for retry.
                        </AlertDescription>
                      </Alert>
                      {rejectedMatches.map(renderMatchRow)}
                    </>
                  )}
                </TabsContent>
                <TabsContent value="unmatched_bank" className="m-0 space-y-2 max-h-[600px] overflow-y-auto pr-1">
                  {unmatchedBankMatches.length === 0 ? (
                    <div className="text-center py-10 bg-green-50/50 rounded-lg border border-green-100 dark:bg-green-950/10 dark:border-green-900/30">
                      <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-2 opacity-80" />
                      <p className="text-sm font-medium text-green-700 dark:text-green-400">All Bank Transactions Reconciled</p>
                      <p className="text-xs text-green-600/70 dark:text-green-500/70 mt-1">There are no missing bank transactions in the system.</p>
                    </div>
                  ) : (
                    <>
                      <Alert variant="destructive" className="mb-3">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          These bank transactions could not be matched to any payables, payments, or clients in the system. They require manual review.
                        </AlertDescription>
                      </Alert>
                      {unmatchedBankMatches.map(renderMatchRow)}
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="border-dashed border-2 p-8 text-center bg-muted/10">
          <CardContent className="flex flex-col items-center gap-4 py-8">
            <FileSpreadsheet className="w-16 h-16 text-muted-foreground/60 animate-pulse" />
            <div>
              <CardTitle className="text-xl">Upload Files for 5-Way Reconciliation</CardTitle>
              <CardDescription className="max-w-md mx-auto mt-2">
                Upload Excel payment files or bank statements to perform comprehensive reconciliation across Payables, Payments, and Bank Statements.
                The system will match records using multiple sources and detect discrepancies.
              </CardDescription>
            </div>
            <div className="flex gap-3 mt-2">
              <label htmlFor="reconcile-file-upload-body" className="cursor-pointer">
                <Button size="lg" className="cursor-pointer" asChild disabled={isProcessing}>
                  <span>
                    <Upload className="w-5 h-5 mr-2" />
                    Select Excel File
                  </span>
                </Button>
              </label>
              <input id="reconcile-file-upload-body" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload} />
              <label htmlFor="reconcile-bank-upload-body" className="cursor-pointer">
                <Button size="lg" variant="outline" className="cursor-pointer" asChild disabled={isProcessing}>
                  <span>
                    <FileSpreadsheet className="w-5 h-5 mr-2" />
                    Bank Statement
                  </span>
                </Button>
              </label>
              <input id="reconcile-bank-upload-body" type="file" accept=".xls,.xlsx,.xlsm,.csv,.txt" className="hidden" onChange={handleBankStatementUpload} />
            </div>
            <Alert className="max-w-md mt-4">
              <AlertDescription className="text-xs">
                <strong>5-Way Matching:</strong> Each record is matched against Payables, Payments, and Bank Statements.
                The system tracks which sources matched each record and identifies discrepancies, missing records, and over/under payments.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      <Card className="border mt-4">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Reconciliation History</CardTitle>
            <CardDescription>
              {isLoadingHistory
                ? 'Loading latest saved reconciliation lots...'
                : `${groupedLots.length} saved lot${groupedLots.length === 1 ? '' : 's'} (${savedResults.length.toLocaleString()} records) loaded.`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => loadHistory()} disabled={isLoadingHistory}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoadingHistory ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingHistory ? (
            <div className="text-center py-8 text-sm text-muted-foreground flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Loading saved reconciliation lots...
            </div>
          ) : filteredGroupedLots.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              <p>No saved reconciliation history lots match the selected filter.</p>
              {historyCompanyFilter !== 'all' && (
                <Button
                  variant="link"
                  size="sm"
                  className="mt-1 text-xs"
                  onClick={() => setHistoryCompanyFilter('all')}
                >
                  Clear company filter
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* History Search & Company Filter Controls */}
              <div className="flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search in history by Shareholder, BOID, Bank Account, or Batch..."
                    value={historySearchQuery}
                    onChange={e => setHistorySearchQuery(e.target.value)}
                    className="pl-8 text-xs h-8"
                  />
                  {historySearchQuery && (
                    <button
                      onClick={() => setHistorySearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {historyCompanies.length > 0 && (
                  <Select value={historyCompanyFilter} onValueChange={setHistoryCompanyFilter}>
                    <SelectTrigger className="w-52 h-8 text-xs">
                      <SelectValue placeholder="All Companies" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Companies ({groupedLots.length} lots)</SelectItem>
                      {historyCompanies.map(c => (
                        <SelectItem key={c} value={c} className="text-xs">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <Select value={historySourceFilter} onValueChange={setHistorySourceFilter}>
                  <SelectTrigger className="w-48 h-8 text-xs">
                    <SelectValue placeholder="All Sources" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Settlement Types</SelectItem>
                    <SelectItem value="connectips" className="text-xs">ConnectIPS Payout Lots</SelectItem>
                    <SelectItem value="bank_statement" className="text-xs">Bank Statements</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Grouped Lot Accordion List */}
              <div className="space-y-3">
                {filteredGroupedLots.map(lot => {
                  const isExpanded = expandedLotKey === lot.lotKey;
                  const currentDetailTab = lotDetailTabs[lot.lotKey] || 'all';

                  const filteredLotRecords = lot.records.filter(r => {
                    if (currentDetailTab === 'matched' && r.result !== 'Matched') return false;
                    if (currentDetailTab === 'rejected' && r.result !== 'Rejected') return false;
                    if (currentDetailTab === 'discrepancy' && (r.result === 'Matched' || r.result === 'Rejected')) return false;

                    if (!historySearchQuery) return true;
                    const q = historySearchQuery.toLowerCase();
                    return (
                      (r.client?.full_name && r.client.full_name.toLowerCase().includes(q)) ||
                      (r.client?.boid && r.client.boid.toLowerCase().includes(q)) ||
                      (r.client?.bank_account_no && r.client.bank_account_no.toLowerCase().includes(q)) ||
                      (r.notes && r.notes.toLowerCase().includes(q)) ||
                      lot.lotName.toLowerCase().includes(q)
                    );
                  });

                  // If user is searching and this lot has no matching records, skip it
                  if (historySearchQuery && filteredLotRecords.length === 0 && currentDetailTab === 'all') return null;

                  return (
                    <div
                      key={lot.lotKey}
                      className="rounded-xl border bg-card text-card-foreground shadow-sm transition-all overflow-hidden"
                    >
                      {/* Lot Header */}
                      <div className="p-4 bg-muted/20 border-b flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-start gap-3 flex-1 min-w-[280px]">
                          <div className="p-2 rounded-lg bg-primary/10 text-primary mt-0.5">
                            <Layers className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="text-sm font-bold text-foreground">{lot.lotName}</h4>
                              <Badge variant="outline" className="text-[11px] font-semibold text-primary">
                                {lot.companyName}
                              </Badge>
                              {lot.fileName && (
                                <span className="inline-flex items-center text-[11px] text-muted-foreground font-mono bg-muted/60 px-2 py-0.5 rounded border">
                                  <FileSpreadsheet className="w-3 h-3 mr-1 text-primary" />
                                  {lot.fileName}
                                </span>
                              )}
                              <Badge variant="outline" className="text-[11px]">
                                {lot.date}
                              </Badge>
                              <Badge variant="secondary" className="text-[10px] capitalize">
                                {lot.payableType}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs">
                              <span className="text-muted-foreground">
                                Total: <strong className="text-foreground">{lot.totalRecords} records</strong> (NPR {lot.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })})
                              </span>
                              <span className="text-green-600 dark:text-green-400 font-medium">
                                ✓ {lot.matchedCount} Matched (NPR {lot.matchedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })})
                              </span>
                              {lot.rejectedCount > 0 && (
                                <span className="text-red-600 dark:text-red-400 font-medium">
                                  ✕ {lot.rejectedCount} Rejected (NPR {lot.rejectedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })})
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Lot Actions */}
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant={isExpanded ? 'secondary' : 'default'}
                            size="sm"
                            className="h-8 text-xs cursor-pointer font-medium"
                            onClick={() => setExpandedLotKey(isExpanded ? null : lot.lotKey)}
                          >
                            {isExpanded ? (
                              <>
                                <ChevronUp className="w-3.5 h-3.5 mr-1.5" />
                                Hide Details
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3.5 h-3.5 mr-1.5" />
                                View Details ({lot.totalRecords})
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs cursor-pointer"
                            onClick={() => handleExportLot(lot)}
                          >
                            <Download className="w-3.5 h-3.5 mr-1.5" />
                            Export CSV
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 cursor-pointer"
                              onClick={() => handleRevertLot(lot)}
                              disabled={isApplying}
                              title="Revert payables and remove this lot (Admin Only)"
                            >
                              <RotateCcw className="w-3.5 h-3.5 mr-1" />
                              Revert
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs text-destructive hover:bg-destructive/10 cursor-pointer"
                              onClick={() => handleDeleteLot(lot)}
                              title="Delete lot history (Admin Only)"
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-1" />
                              Delete
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Expandable Lot Detailed View */}
                      {isExpanded && (
                        <div className="p-4 space-y-3 bg-background max-h-[600px] overflow-y-auto">
                          {/* Detail Sub-Tabs */}
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b">
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="sm"
                                variant={currentDetailTab === 'all' ? 'default' : 'outline'}
                                className="h-7 text-xs px-2.5"
                                onClick={() => setLotDetailTabs(prev => ({ ...prev, [lot.lotKey]: 'all' }))}
                              >
                                All Records ({lot.totalRecords})
                              </Button>
                              <Button
                                size="sm"
                                variant={currentDetailTab === 'matched' ? 'default' : 'outline'}
                                className="h-7 text-xs px-2.5 text-green-700 dark:text-green-400"
                                onClick={() => setLotDetailTabs(prev => ({ ...prev, [lot.lotKey]: 'matched' }))}
                              >
                                Matched ({lot.matchedCount})
                              </Button>
                              {lot.rejectedCount > 0 && (
                                <Button
                                  size="sm"
                                  variant={currentDetailTab === 'rejected' ? 'destructive' : 'outline'}
                                  className="h-7 text-xs px-2.5 text-red-600"
                                  onClick={() => setLotDetailTabs(prev => ({ ...prev, [lot.lotKey]: 'rejected' }))}
                                >
                                  Rejected / Bounced ({lot.rejectedCount})
                                </Button>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              Showing {filteredLotRecords.length} records in this view
                            </span>
                          </div>

                          <div className="space-y-2 pt-1">
                            {filteredLotRecords.length === 0 ? (
                              <p className="text-xs text-muted-foreground text-center py-6">No records found for the selected tab filter.</p>
                            ) : (
                              filteredLotRecords.map((r, idx) => (
                                <div
                                  key={r.id || idx}
                                  className="rounded-lg border p-3 bg-muted/10 hover:bg-muted/30 transition-colors text-xs"
                                >
                                  <div className="flex items-start justify-between gap-3 flex-wrap">
                                    <div className="flex-1 min-w-[200px]">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-bold text-sm text-foreground">
                                          {r.client?.full_name || 'Shareholder'}
                                        </span>
                                        {r.client?.boid && (
                                          <span className="font-mono text-[11px] bg-muted px-2 py-0.5 rounded text-muted-foreground border">
                                            BOID: {r.client.boid}
                                          </span>
                                        )}
                                        <Badge
                                          variant={r.result === 'Matched' ? 'default' : 'destructive'}
                                          className="text-[10px] h-4"
                                        >
                                          {r.result}
                                        </Badge>
                                      </div>

                                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-muted-foreground">
                                        {(r.client?.bank_name || r.client?.bank_account_no) && (
                                          <div className="flex items-center gap-1">
                                            <CreditCard className="w-3.5 h-3.5" />
                                            <span>
                                              {r.client.bank_name} {r.client.bank_account_no ? `(A/C: ${r.client.bank_account_no})` : ''}
                                            </span>
                                          </div>
                                        )}
                                        {r.notes && (
                                          <span className="text-[11px] text-muted-foreground/80">
                                            {r.notes}
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-4 text-right">
                                      <div>
                                        <span className="text-[10px] text-muted-foreground block">
                                          {r.result === 'Rejected' ? 'Attempted Txn' : 'Actual Paid'}
                                        </span>
                                        <span className={`font-mono font-bold text-sm ${r.result === 'Rejected' ? 'text-destructive line-through' : 'text-foreground'}`}>
                                          NPR {(r.actual_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                        </span>
                                        {r.result === 'Rejected' && (
                                          <span className="text-[10px] text-destructive block font-semibold">
                                            NPR 0.00 (Bounced)
                                          </span>
                                        )}
                                      </div>
                                      <div>
                                        <span className="text-[10px] text-muted-foreground block">System Expected</span>
                                        <span className="font-mono text-muted-foreground">
                                          NPR {(r.expected_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}