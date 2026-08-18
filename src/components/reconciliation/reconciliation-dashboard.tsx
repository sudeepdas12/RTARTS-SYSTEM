import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ComprehensiveReconciliationReport } from '@/lib/reconciliation-engine';
import { ShieldAlert, CheckCircle2, AlertTriangle, FileSpreadsheet, Building2, Users } from 'lucide-react';

interface ReconciliationDashboardProps {
  report: ComprehensiveReconciliationReport;
}

export function ReconciliationDashboard({ report }: ReconciliationDashboardProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('ALL');

  if (!report || !report.categories.length) return null;

  const filteredMatches = report.matches.filter(m => {
    const catMatch = selectedCategory === 'ALL' || m.category === selectedCategory;
    const statusMatch = selectedStatusFilter === 'ALL' || m.status === selectedStatusFilter;
    return catMatch && statusMatch;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Matched':
        return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-300">Matched</Badge>;
      case 'Pledged':
        return <Badge className="bg-amber-500/15 text-amber-700 border-amber-300">Pledged Shares</Badge>;
      case 'Rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      case 'Pending':
        return <Badge variant="outline" className="text-blue-600 border-blue-300">Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* File Overview Header */}
      <Card className="bg-card/50 border-primary/20">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-8 h-8 text-primary" />
            <div>
              <h3 className="font-semibold text-lg">{report.fileName}</h3>
              <p className="text-xs text-muted-foreground capitalize">
                File Type: <span className="font-medium text-foreground">{report.fileType}</span> • {report.sourceType === 'bank_statement' ? `${report.grandTotal.totalRecords.toLocaleString()} record(s) analyzed` : `${report.categories.length} sheet(s) analyzed`}
              </p>
            </div>
          </div>
          <div className="flex gap-6 text-right">
            <div>
              <p className="text-xs text-muted-foreground uppercase">Total Records</p>
              <p className="text-xl font-bold">{report.grandTotal.totalRecords.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Total Kitta</p>
              <p className="text-xl font-bold">{report.grandTotal.totalKitta.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Net Payable</p>
              <p className="text-xl font-bold text-primary">NPR {report.grandTotal.totalNetPayable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards by Status */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelectedStatusFilter('ALL')}>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs text-muted-foreground uppercase">Total Records</CardTitle>
            <Users className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{report.grandTotal.totalRecords.toLocaleString()}</div></CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-emerald-500 transition-colors" onClick={() => setSelectedStatusFilter('Matched')}>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs text-emerald-700 uppercase font-medium">Matched / Success</CardTitle>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-emerald-600">{report.grandTotal.matchedRecords.toLocaleString()}</div></CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-amber-500 transition-colors" onClick={() => setSelectedStatusFilter('Pledged')}>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs text-amber-700 uppercase font-medium">Pledged Accounts</CardTitle>
            <ShieldAlert className="w-4 h-4 text-amber-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-amber-600">{report.grandTotal.pledgedCount.toLocaleString()}</div></CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-red-500 transition-colors" onClick={() => setSelectedStatusFilter('Rejected')}>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs text-destructive uppercase font-medium">Rejected / Failed</CardTitle>
            <AlertTriangle className="w-4 h-4 text-destructive" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-destructive">{report.grandTotal.rejectedCount.toLocaleString()}</div></CardContent>
        </Card>
      </div>

      {/* Category Breakdown Table (Matching Excel Summary Sheet) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="w-4 h-4 text-primary" />
            Category Summary Breakdown (Matching Excel Summary Sheet)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category / Sheet Name</TableHead>
                  <TableHead className="text-right">Shareholders</TableHead>
                  <TableHead className="text-right">Total Kitta</TableHead>
                  <TableHead className="text-right">Gross Amount (NPR)</TableHead>
                  <TableHead className="text-right">TDS Tax (NPR)</TableHead>
                  <TableHead className="text-right">Net Payable (NPR)</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.categories.map((cat) => (
                  <TableRow
                    key={cat.categoryName}
                    className={`cursor-pointer hover:bg-muted/50 ${selectedCategory === cat.categoryName ? 'bg-primary/5 font-medium' : ''}`}
                    onClick={() => setSelectedCategory(selectedCategory === cat.categoryName ? 'ALL' : cat.categoryName)}
                  >
                    <TableCell className="font-semibold">{cat.categoryName}</TableCell>
                    <TableCell className="text-right font-mono">{cat.rowCount.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{cat.totalKitta.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">
                      {cat.totalGrossAmount > 0 ? cat.totalGrossAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {cat.totalTaxAmount > 0 ? cat.totalTaxAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-primary">
                      {cat.totalNetPayable > 0 ? cat.totalNetPayable.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      {cat.pledgedCount > 0 && (
                        <Badge variant="outline" className="text-amber-700 bg-amber-50">
                          {cat.pledgedCount} Pledged
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Investor Records Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Investor Level Breakdown</CardTitle>
          <div className="flex gap-2">
            {['ALL', 'Matched', 'Pledged', 'Rejected', 'Pending'].map(status => (
              <Badge
                key={status}
                variant={selectedStatusFilter === status ? 'default' : 'outline'}
                className="cursor-pointer capitalize"
                onClick={() => setSelectedStatusFilter(status)}
              >
                {status}
              </Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>BOID</TableHead>
                  <TableHead>Shareholder Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Kitta</TableHead>
                  <TableHead className="text-right">Net Payable</TableHead>
                  <TableHead>Bank / Account</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMatches.slice(0, 100).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.boid}</TableCell>
                    <TableCell className="font-medium">{row.shareholderName}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{row.category}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">{row.kitta.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono font-bold">
                      NPR {row.excelAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.bankName ? `${row.bankName} (${row.bankAccountNo})` : '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      {getStatusBadge(row.status)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {filteredMatches.length > 100 && (
            <div className="text-center p-4 text-xs text-muted-foreground">
              Showing first 100 of {filteredMatches.length.toLocaleString()} matching records.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
