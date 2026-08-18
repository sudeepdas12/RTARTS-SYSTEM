import React from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ParsedExcelData } from '@/lib/excel-parser';

interface ManualMapperProps {
  data: ParsedExcelData;
  selectedSheetIndex: number;
  onMappingChange: (header: string, dbField: string) => void;
}

const DB_FIELDS = [
  'boid', 'full_name', 'father_name', 'grandfather_name', 'pan_or_citizenship',
  'address', 'district', 'phone', 'shares_held', 'amount', 'bonus_shares',
  'dividend_rate', 'gross_interest', 'tax_amount', 'net_payable',
  'bank_code', 'bank_name', 'bank_account_no', 'payment_status', 'payment_date'
];

export function ManualMapper({ data, selectedSheetIndex, onMappingChange }: ManualMapperProps) {
  if (!data || !data.sheets[selectedSheetIndex]) return null;
  const sheet = data.sheets[selectedSheetIndex];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4 border rounded-lg bg-card mt-4">
      <div className="col-span-full mb-2">
        <h3 className="font-semibold text-lg">Manual Column Mapping</h3>
        <p className="text-sm text-muted-foreground">Adjust the automatic mapping if it is incorrect.</p>
      </div>
      
      {sheet.headers.map((header) => (
        <div key={header} className="flex flex-col gap-2">
          <Label className="truncate" title={header}>{header}</Label>
          <Select 
            value={sheet.mapping[header] || 'unmapped'} 
            onValueChange={(val) => onMappingChange(header, val === 'unmapped' ? '' : val)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select field..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unmapped" className="text-muted-foreground italic">Skip (Unmapped)</SelectItem>
              {DB_FIELDS.map(field => (
                <SelectItem key={field} value={field}>{field}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}
