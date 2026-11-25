import React, { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ParsedExcelData } from "@/lib/excel-parser";
import {
  loadTaxRules,
  TaxRule,
  TaxPayableCategory,
  TaxClassification,
  investorCategoryToClassification,
  getTaxRateFromRules,
  TAX_CLASSIFICATION_LABEL,
} from "@/lib/services/tax-rules.service";

interface ImportPreviewProps {
  data: ParsedExcelData;
  selectedSheetIndex: number;
}

function formatNumber(value: any): string {
  if (value === null || value === undefined || value === "") return "";
  const num = Number(value);
  if (isNaN(num) || typeof value === "boolean") return String(value);
  return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function isIdentifierColumn(header: string, mappedField?: string): boolean {
  const mappedIds = new Set([
    "boid",
    "client_id",
    "client_code",
    "pan",
    "citizenship",
    "nid_number",
    "phone",
    "bank_account_no",
    "bank_code",
    "isin",
    "fiscal_year",
    "due_date",
    "approve_date",
    "instruction_id",
    "batch_id",
  ]);
  if (mappedField && mappedIds.has(mappedField)) return true;
  return /\b(s\.?\s*n\.?|serial|boid|demat|folio|pan|citizenship|nid|a\/c|acc(ount)?(\s*no)?|phone|mobile|isin|client\s*(id|code|no)|fiscal|year|date|batch|instruction|ref|code)\b/i.test(
    header,
  );
}

function isQuantityColumn(header: string, mappedField?: string): boolean {
  const qtyFields = new Set([
    "shares_held",
    "bonus_actual",
    "bonus_issued",
    "bonus_fraction",
    "after_bonus_kitta",
  ]);
  if (mappedField && qtyFields.has(mappedField)) return true;
  return /\b(kitta|shares|units|qty|quantity)\b/i.test(header);
}

function resolvePayableCategory(fileType: string): TaxPayableCategory {
  if (fileType === "debenture" || fileType === "interest") return "INTEREST";
  if (fileType === "mutual_fund") return "MUTUAL_FUND";
  return "DIVIDEND";
}

function resolveDefaultClassificationForSheet(sheetType: string): TaxClassification {
  const norm = String(sheetType || "")
    .trim()
    .toUpperCase();
  if (norm.includes("INSTITUTION") || norm.includes("COMPANY") || norm.includes("LEGAL")) {
    return "COMPANY_INSTITUTION";
  }
  if (norm.includes("EXEMPT")) {
    return "TAX_EXEMPT";
  }
  if (norm.includes("FOREIGN")) {
    return "FOREIGN_INVESTOR";
  }
  return "NATURAL_PERSON";
}

export function ImportPreview({ data, selectedSheetIndex }: ImportPreviewProps) {
  const [taxRules, setTaxRules] = useState<TaxRule[]>([]);

  useEffect(() => {
    let isMounted = true;
    loadTaxRules()
      .then((rules) => {
        if (isMounted) setTaxRules(rules);
      })
      .catch((err) => {
        console.warn("Could not load tax rules in ImportPreview:", err);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  if (!data || !data.sheets[selectedSheetIndex]) return null;

  const sheet = data.sheets[selectedSheetIndex];
  const previewRows = sheet.rows.slice(0, 10); // Show first 10 rows

  // Identify financial columns for highlighting
  const financialColumns = [
    "gross_amount",
    "tax_amount",
    "net_payable",
    "amount",
    "AMOUNT",
    "TAX",
    "NET",
    "ROUNDUP",
    "ROUND_UP_DIV",
  ];
  const hasFinancialData = sheet.headers.some((h) => financialColumns.includes(h));

  const fileTypeLabels: Record<string, string> = {
    debenture: "Debenture / Interest",
    dividend: "Dividend",
    mutual_fund: "Mutual Fund",
    bonus_share: "Bonus Share",
    cash_dividend: "Cash Dividend",
    right_share: "Right Share",
    raw_demat: "Raw Demat",
    unknown: "Unknown",
  };

  const payableCategory = resolvePayableCategory(data.fileType);
  const defaultSheetClassification = resolveDefaultClassificationForSheet(sheet.sheetType);
  const defaultSheetRate = getTaxRateFromRules(
    taxRules,
    payableCategory,
    defaultSheetClassification,
  );
  const sheetRateDisplay =
    defaultSheetRate != null ? `${(defaultSheetRate * 100).toFixed(0)}%` : "Rule-based";

  // Dynamic summary of current tax rules
  const naturalRate = getTaxRateFromRules(taxRules, payableCategory, "NATURAL_PERSON");
  const institutionRate = getTaxRateFromRules(taxRules, payableCategory, "COMPANY_INSTITUTION");
  const exemptRate = getTaxRateFromRules(taxRules, payableCategory, "TAX_EXEMPT");

  const rulesSummary = [
    `Natural Person ${naturalRate != null ? `${(naturalRate * 100).toFixed(0)}%` : "5/6%"}`,
    `Institution ${institutionRate != null ? `${(institutionRate * 100).toFixed(0)}%` : "15%"}`,
    `Tax Exempt ${exemptRate != null ? `${(exemptRate * 100).toFixed(0)}%` : "0%"}`,
  ].join(", ");

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between py-4">
        <CardTitle className="text-lg">
          Data Preview{" "}
          <span className="text-sm font-normal text-muted-foreground ml-2">(First 10 rows)</span>
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            Detected: {fileTypeLabels[data.fileType] ?? data.fileType}
          </Badge>
          <Badge variant="secondary">Sheet: {sheet.sheetType}</Badge>
          <Badge variant="outline" className="border-blue-500/40 text-blue-700 dark:text-blue-300">
            Resolved TDS: {sheetRateDisplay} (
            {TAX_CLASSIFICATION_LABEL[defaultSheetClassification]?.split(" (")[0] ||
              defaultSheetClassification}
            )
          </Badge>
          {hasFinancialData && (
            <Badge variant="default" className="bg-green-600">
              Auto-calculate enabled
            </Badge>
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
                      {sheet.mapping[header] ? `Mapped: ${sheet.mapping[header]}` : "Unmapped"}
                    </span>
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {previewRows.map((row, rowIdx) => {
              // Attempt to resolve row-specific classification if row has category column
              const investorTypeHeader = Object.entries(sheet.mapping).find(
                ([, field]) => field === "investor_type",
              )?.[0];
              const rowInvestorType =
                (investorTypeHeader ? row[investorTypeHeader] : undefined) ||
                row["investor_type"] ||
                row["INVESTOR_TYPE"] ||
                row["HOLDER_TYPE"] ||
                row["CATEGORY"];
              const rowClassification = rowInvestorType
                ? investorCategoryToClassification(String(rowInvestorType)) ||
                  defaultSheetClassification
                : defaultSheetClassification;
              const rowTaxRate = getTaxRateFromRules(taxRules, payableCategory, rowClassification);

              return (
                <TableRow key={rowIdx}>
                  {sheet.headers.map((header, colIdx) => {
                    const value = row[header];
                    const mappedField = sheet.mapping[header];
                    const isFinancial = financialColumns.includes(header);
                    const isIdentifier = isIdentifierColumn(header, mappedField);
                    const isQuantity = isQuantityColumn(header, mappedField);
                    const isFormulaObject = typeof value === "object" && value !== null;
                    const isTaxCol = header.toUpperCase().includes("TAX");

                    let displayValue: string;
                    if (isFormulaObject) {
                      displayValue = "[object Object]";
                    } else if (isIdentifier || typeof value !== "number") {
                      const rawStr = String(value ?? "");
                      const numericCandidate =
                        !isIdentifier && rawStr.trim() !== "" && !isNaN(Number(rawStr));
                      if (numericCandidate && isQuantity) {
                        displayValue = Number(rawStr).toLocaleString("en-IN", {
                          maximumFractionDigits: 4,
                        });
                      } else if (numericCandidate && (isFinancial || isTaxCol)) {
                        displayValue = formatNumber(rawStr);
                      } else {
                        displayValue = rawStr;
                      }
                    } else if (isQuantity) {
                      displayValue = value.toLocaleString("en-IN", { maximumFractionDigits: 4 });
                    } else {
                      displayValue = formatNumber(value);
                    }

                    return (
                      <TableCell
                        key={colIdx}
                        className={`whitespace-nowrap max-w-[200px] truncate ${
                          isFormulaObject
                            ? "bg-red-50 dark:bg-red-950/20 text-red-600 font-mono text-xs"
                            : ""
                        } ${(isFinancial || isIdentifier) && !isFormulaObject ? "font-mono" : ""}`}
                        title={
                          isTaxCol && rowTaxRate != null
                            ? `Calculated from current tax rules: ${(rowTaxRate * 100).toFixed(0)}% (${rowClassification})`
                            : undefined
                        }
                      >
                        {displayValue}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {hasFinancialData && (
          <div className="p-3 bg-muted/30 border-t text-xs text-muted-foreground">
            <strong className="text-foreground">Note:</strong> Financial columns (Gross, Tax, Net)
            will be auto-calculated during import if Excel formulas are missing or invalid. The
            system computes:{" "}
            <code className="bg-background px-1 rounded">Gross = Shares × Rate</code>,{" "}
            <code className="bg-background px-1 rounded">Tax = Gross × TDS Rate</code>{" "}
            <span className="text-foreground font-medium">
              (calculated from current tax rules: {rulesSummary})
            </span>
            , <code className="bg-background px-1 rounded">Net = Gross - Tax</code>. Actual TDS
            varies by taxpayer classification and instrument, not a fixed 5%.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
