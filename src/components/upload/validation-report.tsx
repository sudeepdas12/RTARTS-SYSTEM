import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, AlertTriangle, CheckCircle, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ValidationError, ValidationEngine } from '@/lib/validation-engine';

const SOFT_ERROR_TYPES = new Set([
  "missing_address",
  "invalid_precision",
  "invalid_bank_account",
  "missing_bank_account",
  "missing_bank_name",
  "wrong_isin",
  "invalid_isin_format",
  "missing_financial_data",
  "invalid_email",
  "invalid_client_code",
  "duplicate_client_code",
  "duplicate_boid_in_file",
  "existing_boid",
  "existing_client_code",
  "net_mismatch",
  "tax_calc_mismatch",
  "tax_above_gross",
  "net_above_gross",
  "calculation_discrepancy",
  "invalid_tds_rate",
  "invalid_fiscal_year",
  "invalid_payment_date",
  "invalid_due_date",
  "payment_before_due",
  "negative_gross",
  "negative_tax",
  "negative_net",
  "negative_shares",
  "invalid_gross",
  "invalid_tax",
  "invalid_net",
  "invalid_shares",
  "missing_name",
]);

interface ValidationReportProps {
  errors: ValidationError[];
  fileName?: string;
}

export function ValidationReport({ errors, fileName = 'import' }: ValidationReportProps) {
  if (errors.length === 0) return null;

  const hardErrors = errors.filter(e => !SOFT_ERROR_TYPES.has(e.type));
  const softErrors = errors.filter(e => SOFT_ERROR_TYPES.has(e.type));
  const isBlocking = hardErrors.length > 0;

  const groupedErrors = errors.reduce((acc, curr) => {
    acc[curr.type] = (acc[curr.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const handleDownload = () => {
    ValidationEngine.downloadErrorReport(errors, fileName);
  };

  return (
    <Card className={isBlocking ? "border-destructive bg-destructive/5 mt-6" : "border-amber-400/50 bg-amber-500/5 mt-6"}>
      <CardHeader className="flex flex-row items-center justify-between py-4">
        <CardTitle className={`flex items-center gap-2 ${isBlocking ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}>
          {isBlocking ? (
            <>
              <AlertCircle className="h-5 w-5" />
              Validation Blocked — {hardErrors.length} Fatal Error{hardErrors.length > 1 ? 's' : ''} Found
            </>
          ) : (
            <>
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              Validation Notice — {softErrors.length} Non-blocking Notice{softErrors.length > 1 ? 's' : ''} (Ready to Import)
            </>
          )}
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          className={isBlocking ? "text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground" : "text-amber-700 dark:text-amber-300 border-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/40"}
          onClick={handleDownload}
        >
          <Download className="w-4 h-4 mr-2" />
          Download Report (.xlsx)
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(groupedErrors).map(([type, count]) => {
            const isHard = !SOFT_ERROR_TYPES.has(type);
            return (
              <Badge
                key={type}
                variant={isHard ? "destructive" : "secondary"}
                className={`capitalize ${!isHard ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300 dark:border-amber-700" : ""}`}
              >
                {type.replace(/_/g, ' ')}: {count}
              </Badge>
            );
          })}
        </div>

        <div className="max-h-[240px] overflow-y-auto rounded-md border border-muted bg-background text-sm">
          {errors.slice(0, 100).map((error, idx) => {
            const isHard = !SOFT_ERROR_TYPES.has(error.type);
            return (
              <div key={idx} className="flex gap-4 p-2 border-b last:border-0 border-muted/50 hover:bg-muted/30">
                <span className="font-medium min-w-[60px] text-muted-foreground">Row {error.row || 'File'}</span>
                <span className="font-semibold text-primary w-36 truncate capitalize">{error.field}</span>
                <span className={isHard ? "text-destructive flex-1 font-medium" : "text-muted-foreground flex-1"}>
                  {error.message}
                </span>
              </div>
            );
          })}
          {errors.length > 100 && (
            <div className="p-3 text-center text-muted-foreground text-xs italic bg-muted/10">
              Showing first 100 notices/errors. Download the full report to see all {errors.length}.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
