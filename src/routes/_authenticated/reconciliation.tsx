import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExcelParser } from '@/lib/excel-parser';
import { BankParser } from '@/lib/bank-parser';
import { ReconciliationEngine, ComprehensiveReconciliationReport, ReconciliationMatch } from '@/lib/reconciliation-engine';
import { ReconciliationService, ReconciliationResultRow } from '@/lib/services/reconciliation.service';
import { useAuth } from '@/hooks/use-auth';
import { Upload, FileSpreadsheet, RefreshCw, Play, Download, Filter, Search, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { toast } from 'sonner';

export const Route = createFileRoute('/_authenticated/reconciliation')({
  component: ReconciliationRoute,
});

export function ReconciliationRoute() {
  const qc = useQueryClient();
  const { hasAny } = useAuth();
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

  const canApply = hasAny(['admin', 'finance_operator', 'reconciliation_officer']);

  const loadHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const results = await ReconciliationService.getResults(50, 0);
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
      toast.success(`Successfully analyzed bank statement ${file.name}`);
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

  const buildResults = () => {
    if (!report?.matches?.length) return [];
    const today = new Date().toISOString().slice(0, 10);
    return report.matches.map(match => {
      const isBankStatement = report.sourceType === 'bank_statement';
      return {
        id: match.id,
        reconciliation_date: today,
        source_a_type: isBankStatement ? 'bank_statement' : 'excel',
        source_a_id: null,
        source_b_type: isBankStatement ? 'payment' : 'payable',
        source_b_id: isBankStatement ? match.paymentId : match.payableId,
        client_id: match.clientId,
        company_id: match.companyId,
        payable_type: isBankStatement ? null : match.payableType,
        payable_id: isBankStatement ? null : match.payableId,
        expected_amount: isBankStatement ? match.systemAmount : match.excelAmount,
        actual_amount: isBankStatement ? match.excelAmount : match.systemAmount,
        difference: match.difference,
        result: match.status,
        notes: `Category: ${match.category}${isBankStatement ? ` / Bank Transaction ${match.transactionDate ?? ''}` : ''}${match.matchSources ? ` / Sources: ${match.matchSources.join(', ')}` : ''}`.trim(),
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
      loadHistory();
    } catch (error) {
      console.error('Save reconciliation failed:', error);
      toast.error('Failed to save reconciliation results.');
    } finally {
      setIsSaving(false);
    }
  };

  const { mutate: applyReconciliation } = useMutation({
    mutationFn: (results: ReconciliationResultRow[]) =>
      ReconciliationService.applyReconciliation(results),
    onSuccess: (result) => {
      toast.success(`Applied reconciliation: ${result.updated} payables updated, ${result.paymentsCreated} payments created.`);
      if (result.errors.length > 0) {
        console.warn('Apply reconciliation errors:', result.errors);
        toast.error(`${result.errors.length} errors occurred during application.`);
      }
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['payables'] });
    },
    onError: () => toast.error('Failed to apply reconciliation.'),
  });

  const handleApplyReconciliation = async () => {
    if (!report?.matches?.length) {
      toast.error('No reconciliation report to apply.');
      return;
    }

    setIsApplying(true);
    try {
      const results = buildResults();
      await applyReconciliation(results as ReconciliationResultRow[]);
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

  const renderMatchRow = (match: ReconciliationMatch) => {
    return (
      <div key={match.id} className="rounded-lg border p-3 bg-background hover:bg-muted/20 transition-colors">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1">
            {getStatusIcon(match.status)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{match.boid}</span>
                <Badge variant={getStatusBadgeVariant(match.status)} className="text-xs">
                  {match.status.replace('_', ' ')}
                </Badge>
                {match.matchSources && match.matchSources.length > 0 && (
                  <div className="flex gap-1">
                    {match.matchSources.map(source => (
                      <Badge key={source} variant="outline" className="text-[10px] h-5">
                        {source}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{match.shareholderName}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Category:</span>
                  <span className="ml-1">{match.category}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Excel:</span>
                  <span className="ml-1 font-mono">NPR {match.excelAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">System:</span>
                  <span className="ml-1 font-mono">NPR {match.systemAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Diff:</span>
                  <span className={`ml-1 font-mono font-medium ${match.difference !== 0 ? 'text-amber-600' : 'text-green-600'}`}>
                    {match.difference !== 0 ? (match.difference > 0 ? '+' : '') + match.difference.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
                  </span>
                </div>
              </div>
              {match.paymentStatus && (
                <div className="mt-1 text-xs">
                  <span className="text-muted-foreground">Payment Status:</span>
                  <Badge variant="outline" className="ml-1 text-[10px] h-4">{match.paymentStatus}</Badge>
                </div>
              )}
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
              <Tabs defaultValue="all" className="w-full">
                <TabsList className="mb-4">
                  <TabsTrigger value="all">All Matches ({filteredMatches.length})</TabsTrigger>
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
                ? 'Loading latest saved reconciliation records...'
                : `${savedResults.length.toLocaleString()} saved record${savedResults.length === 1 ? '' : 's'} loaded.`}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => loadHistory()} disabled={isLoadingHistory}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoadingHistory ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {isLoadingHistory ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : savedResults.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved reconciliation history is available yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {savedResults.slice(0, historyVisibleCount).map(result => (
                  <div key={result.id} className="rounded-lg border p-3 bg-background">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">{result.reconciliation_date}</span>
                      <Badge variant={result.result === 'Matched' ? 'default' : 'outline'} className="text-xs">
                        {result.result}
                      </Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground space-y-1">
                      <div className="flex justify-between"><span>Payable Type:</span> <strong className="text-foreground capitalize">{result.payable_type ?? 'N/A'}</strong></div>
                      <div className="flex justify-between"><span>Expected:</span> <span>NPR {result.expected_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) ?? '0.00'}</span></div>
                      <div className="flex justify-between"><span>Actual:</span> <span className="font-semibold text-foreground">NPR {result.actual_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) ?? '0.00'}</span></div>
                      {result.difference !== 0 && (
                        <div className="flex justify-between text-destructive"><span>Difference:</span> <span>NPR {result.difference?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) ?? '0.00'}</span></div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {savedResults.length > historyVisibleCount && (
                <div className="pt-2 flex justify-center">
                  <Button variant="outline" size="sm" onClick={() => setHistoryVisibleCount(prev => prev + 15)}>
                    Load More ({savedResults.length - historyVisibleCount} remaining)
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}