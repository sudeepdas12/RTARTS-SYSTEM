import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ParsedExcelData } from '@/lib/excel-parser';

interface ImportPreviewProps {
  data: ParsedExcelData;
  selectedSheetIndex: number;
}

function formatNumber(value: any): string {
  const num = Number(value);
  if (isNaN(num)) return String(value ?? '');
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ImportPreview({ data, selectedSheetIndex }: ImportPreviewProps) {
  if (!data || !data.sheets[selectedSheetIndex]) return null;

  const sheet = data.sheets[selectedSheetIndex];
  const previewRows = sheet.rows.slice(0, 10); // Show first 10 rows

  // Identify financial columns for highlighting
  const financialColumns = ['gross_amount', 'tax_amount', 'net_payable', 'amount', 'AMOUNT', 'TAX', 'NET', 'ROUNDUP', 'ROUND_UP_DIV'];
  const hasFinancialData = sheet.headers.some(h => financialColumns.includes(h));

  const fileTypeLabels: Record<string, string> = {
    debenture: 'Debenture / Interest',
    dividend: 'Dividend',
    mutual_fund: 'Mutual Fund',
    bonus_share: 'Bonus Share',
    cash_dividend: 'Cash Dividend',
    right_share: 'Right Share',
    raw_demat: 'Raw Demat',
    unknown: 'Unknown'
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between py-4">
        <CardTitle className="text-lg">
          Data Preview <span className="text-sm font-normal text-muted-foreground ml-2">(First 10 rows)</span>
        </CardTitle>
        <div className="flex gap-2">
          <Badge variant="outline">Detected: {fileTypeLabels[data.fileType] ?? data.fileType}</Badge>
          <Badge variant="secondary">Sheet: {sheet.sheetType}</Badge>
          {hasFinancialData && (
            <Badge variant="default" className="bg-green-600">Auto-calculate enabled</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="overflow-auto max-h-[400px] p-0 relative">
        <Table>
          <TableHeader className="sticky top-0 bg-background/95 backdrop-blur z-10 shadow-sm">
            <TableRow>
              {sheet.headers.map((header, idx) => (
                <TableHead key={idx} className="whitespace-nowrap">
                  <div className="flex flex-col">
                    <span className="font-semibold text-primary">{header}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {sheet.mapping[header] ? `Mapped: ${sheet.mapping[header]}` : 'Unmapped'}
                    </span>
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {previewRows.map((row, rowIdx) => (
              <TableRow key={rowIdx}>
                {sheet.headers.map((header, colIdx) => {
                  const value = row[header];
                  const isFinancial = financialColumns.includes(header);
                  const displayValue = value !== undefined ? String(value) : '';
                  const isFormulaObject = typeof value === 'object' && value !== null;
                  
                  return (
                    <TableCell 
                      key={colIdx} 
                      className={`whitespace-nowrap max-w-[200px] truncate ${
                        isFormulaObject ? 'bg-red-50 dark:bg-red-950/20 text-red-600 font-mono text-xs' : ''
                      } ${isFinancial && !isFormulaObject ? 'font-mono' : ''}`}
                    >
                      {isFormulaObject ? '[object Object]' : formatNumber(value)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {hasFinancialData && (
          <div className="p-3 bg-muted/30 border-t text-xs text-muted-foreground">
            <strong className="text-foreground">Note:</strong> Financial columns (Gross, Tax, Net) will be auto-calculated during import if Excel formulas are missing or invalid. 
            The system will compute: <code className="bg-background px-1 rounded">Gross = Shares × Rate</code>, <code className="bg-background px-1 rounded">Tax = Gross × 5%</code>, <code className="bg-background px-1 rounded">Net = Gross - Tax</code>.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
