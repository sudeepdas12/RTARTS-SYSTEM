import React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ParsedExcelData } from "@/lib/excel-parser";

interface ManualMapperProps {
  data: ParsedExcelData;
  selectedSheetIndex: number;
  onMappingChange: (header: string, dbField: string) => void;
}

const DB_FIELDS: { key: string; label: string }[] = [
  { key: "boid", label: "BOID / Beneficiary ID" },
  { key: "full_name", label: "Full Name" },
  { key: "father_name", label: "Father's Name" },
  { key: "grandfather_name", label: "Grandfather's Name" },
  { key: "nid_number", label: "NID Number (National ID)" },
  { key: "pan", label: "PAN Number" },
  { key: "citizenship", label: "Citizenship Number" },
  { key: "pan_or_citizenship", label: "PAN / Citizenship" },
  { key: "date_of_birth", label: "Date of Birth" },
  { key: "gender", label: "Gender" },
  { key: "occupation", label: "Occupation" },
  { key: "address", label: "Address" },
  { key: "province", label: "Province" },
  { key: "district", label: "District" },
  { key: "municipality", label: "Municipality" },
  { key: "phone", label: "Phone / Mobile" },
  { key: "email", label: "Email Address" },
  { key: "shares_held", label: "Shares / Kitta / Units" },
  { key: "cash_dividend", label: "Gross Amount / Dividend / Interest" },
  { key: "div_tax", label: "TDS / Tax Amount" },
  { key: "bon_tax", label: "Bonus Tax" },
  { key: "net_payable", label: "Net Payable" },
  { key: "bonus_actual", label: "Actual Bonus" },
  { key: "bonus_issued", label: "Issued Bonus" },
  { key: "bonus_fraction", label: "Bonus Fraction" },
  { key: "after_bonus_kitta", label: "After Bonus Kitta" },
  { key: "dividend_rate", label: "Dividend Rate" },
  { key: "bank_code", label: "Bank Code" },
  { key: "bank_name", label: "Bank Name" },
  { key: "bank_branch", label: "Bank Branch" },
  { key: "bank_account_no", label: "Bank Account Number" },
  { key: "account_type", label: "Account Type" },
  { key: "investor_type", label: "Investor Type / Category" },
  { key: "lot_name", label: "Lot Name" },
  { key: "due_date", label: "Due Date" },
  { key: "instrument_ref", label: "Instrument Reference" },
  { key: "remarks", label: "Remarks" },
  { key: "residency", label: "Residency" },
  { key: "status", label: "Payment Status" },
];

export function ManualMapper({ data, selectedSheetIndex, onMappingChange }: ManualMapperProps) {
  if (!data || !data.sheets[selectedSheetIndex]) return null;
  const sheet = data.sheets[selectedSheetIndex];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4 border rounded-lg bg-card mt-4">
      <div className="col-span-full mb-2">
        <h3 className="font-semibold text-lg">Manual Column Mapping</h3>
        <p className="text-sm text-muted-foreground">
          Adjust the automatic mapping if it is incorrect.
        </p>
      </div>

      {sheet.headers.map((header) => (
        <div key={header} className="flex flex-col gap-2">
          <Label className="truncate" title={header}>
            {header}
          </Label>
          <Select
            value={sheet.mapping[header] || "unmapped"}
            onValueChange={(val) => onMappingChange(header, val === "unmapped" ? "" : val)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select field..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unmapped" className="text-muted-foreground italic">
                Skip (Unmapped)
              </SelectItem>
              {DB_FIELDS.map((field) => (
                <SelectItem key={field.key} value={field.key}>
                  {field.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}
