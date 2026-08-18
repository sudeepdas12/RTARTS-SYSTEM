import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ValidationError, ValidationEngine } from '@/lib/validation-engine';

interface ValidationReportProps {
  errors: ValidationError[];
  fileName?: string;
}

export function ValidationReport({ errors, fileName = 'import' }: ValidationReportProps) {
  if (errors.length === 0) return null;

  const groupedErrors = errors.reduce((acc, curr) => {
    acc[curr.type] = (acc[curr.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const handleDownload = () => {
    ValidationEngine.downloadErrorReport(errors, fileName);
  };

  return (
    <Card className="border-destructive bg-destructive/5 mt-6">
      <CardHeader className="flex flex-row items-center justify-between py-4">
        <CardTitle className="text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          Validation Failed — {errors.length} Error{errors.length > 1 ? 's' : ''} Found
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground"
          onClick={handleDownload}
        >
          <Download className="w-4 h-4 mr-2" />
          Download Error Report (.xlsx)
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(groupedErrors).map(([type, count]) => (
            <Badge key={type} variant="destructive" className="capitalize">
              {type.replace(/_/g, ' ')}: {count}
            </Badge>
          ))}
        </div>

        <div className="max-h-[240px] overflow-y-auto rounded-md border border-destructive/20 bg-background text-sm">
          {errors.slice(0, 100).map((error, idx) => (
            <div key={idx} className="flex gap-4 p-2 border-b last:border-0 border-destructive/10 hover:bg-muted/30">
              <span className="font-medium min-w-[60px] text-muted-foreground">Row {error.row || 'File'}</span>
              <span className="font-semibold text-primary w-32 truncate capitalize">{error.field}</span>
              <span className="text-destructive flex-1">{error.message}</span>
            </div>
          ))}
          {errors.length > 100 && (
            <div className="p-3 text-center text-muted-foreground text-xs italic bg-muted/10">
              Showing first 100 errors. Download the full report to see all {errors.length}.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
