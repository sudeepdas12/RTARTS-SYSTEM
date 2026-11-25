import type { ColumnMapping, ParsedExcelData, ParsedSheetData } from "./excel-parser";

export type TriageSeverity = "info" | "warning" | "error";

export interface PreImportTriageFinding {
  code: string;
  severity: TriageSeverity;
  sheetName?: string;
  message: string;
}

export interface PreImportTriageReport {
  detectedFileType: ParsedExcelData["fileType"];
  sheetCount: number;
  totalRows: number;
  taxExemptSheetCount: number;
  reviewSuspectCount: number;
  suspiciousBoidCount: number;
  findings: PreImportTriageFinding[];
}

export interface MappedSheetColumns {
  grossCol?: string;
  cashTaxCol?: string;
  bonusTaxCol?: string;
  netCol?: string;
  nameCol?: string;
  kittaCol?: string;
  boidCol?: string;
}

type MappableSheet = {
  headers: string[];
  mapping?: Record<string, keyof ColumnMapping | string>;
};

/**
 * Invert `sheet.mapping` (ExcelHeader -> CanonicalField) cleanly, falling back
 * to conservative header patterns that avoid FATHER/GRANDFATHER or AMOUNT principal collisions.
 */
export function resolveMappedSheetColumns(sheet: MappableSheet): MappedSheetColumns {
  const inverse: Record<string, string> = {};
  if (sheet.mapping) {
    for (const [excelHeader, canonicalField] of Object.entries(sheet.mapping)) {
      const key = String(canonicalField || "");
      if (key && !inverse[key]) {
        inverse[key] = excelHeader;
      }
    }
  }

  const headers: string[] = Array.isArray(sheet.headers) ? sheet.headers : [];
  const findFallback = (pattern: RegExp, exclude?: RegExp): string | undefined =>
    headers.find((h) => pattern.test(h) && (!exclude || !exclude.test(h)));

  const grossCol =
    inverse.cash_dividend ||
    inverse.gross_dividend ||
    inverse.gross_amount ||
    findFallback(
      /gross|int_amt|interest|cash.?div|div.?amt|dividend.?amount/i,
      /net|tax|rate|@|annual|principal|face|per.?day/i,
    ) ||
    findFallback(/amount/i, /net|tax|rate|principal/i);

  const cashTaxCol =
    inverse.div_tax ||
    inverse.tax_amount ||
    findFallback(/div.?tax|tds|tax_amount|^tax$/i, /bon|bonus|rate|after|exempt/i);

  const bonusTaxCol = inverse.bon_tax || findFallback(/bon.?tax|bonus.?tax/i);

  const netCol =
    inverse.net_payable ||
    findFallback(/net.?pay|net.?int|net.?div|roundup|payable.?amt/i, /gross|rate/i);

  const nameCol =
    inverse.full_name ||
    findFallback(
      /shareholder.?name|holder.?name|investor.?name|unit.?holder|applicant|full.?name|^name$/i,
      /father|grand|mother|spouse|nominee|guardian|bank|company/i,
    );

  const kittaCol =
    inverse.shares_held ||
    inverse.kitta ||
    findFallback(/kitta|shares|units|holding|qty|quantity/i, /after|bonus/i);

  const boidCol = inverse.boid || findFallback(/boid|beneficiary.?id|demat|dp.?id|folio/i, /date/i);

  return { grossCol, cashTaxCol, bonusTaxCol, netCol, nameCol, kittaCol, boidCol };
}

/**
 * Deterministic pre-import workbook triage analyzer. Inspects headers, mappings,
 * sheet contexts, identifier formatting, and classification edge cases without mutating math.
 */
export function evaluateWorkbookTriage(parsed: ParsedExcelData | null): PreImportTriageReport {
  if (!parsed || !parsed.sheets || parsed.sheets.length === 0) {
    return {
      detectedFileType: parsed?.fileType || "unknown",
      sheetCount: 0,
      totalRows: 0,
      taxExemptSheetCount: 0,
      reviewSuspectCount: 0,
      suspiciousBoidCount: 0,
      findings: [],
    };
  }

  const dataSheets: ParsedSheetData[] = parsed.sheets.filter((s) => s.sheetType !== "SUMMARY");
  const findings: PreImportTriageFinding[] = [];
  let totalRows = 0;
  let taxExemptSheetCount = 0;
  let reviewSuspectCount = 0;
  let suspiciousBoidCount = 0;

  for (const sheet of dataSheets) {
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    totalRows += rows.length;
    const cols = resolveMappedSheetColumns(sheet);

    if (sheet.sheetType === "TAX_EXEMPTED" || /TAX.?EXEMPT/i.test(sheet.sheetName)) {
      taxExemptSheetCount++;
    }

    if (cols.nameCol && /(father|grand.?father|spouse|nominee)/i.test(cols.nameCol)) {
      findings.push({
        code: "FATHER_NAME_COLLISION",
        severity: "error",
        sheetName: sheet.sheetName,
        message: `Sheet "${sheet.sheetName}" mapped "${cols.nameCol}" as Shareholder Name. Remap to the holder name column.`,
      });
    }

    if (
      parsed.fileType === "debenture" &&
      cols.grossCol &&
      /^amount$/i.test(cols.grossCol.trim())
    ) {
      findings.push({
        code: "DEBENTURE_PRINCIPAL_AMOUNT_RISK",
        severity: "warning",
        sheetName: sheet.sheetName,
        message: `Sheet "${sheet.sheetName}" uses column "${cols.grossCol}" as interest gross. Confirm it is period coupon interest and not debenture face-value principal.`,
      });
    }

    let sheetBadBoids = 0;
    let sheetBankRetirements = 0;

    for (const row of rows) {
      const boidRaw = cols.boidCol ? String(row?.[cols.boidCol] ?? "").trim() : "";
      if (boidRaw) {
        if (/e\+/i.test(boidRaw) || (/^130\d+$/.test(boidRaw) && boidRaw.length !== 16)) {
          sheetBadBoids++;
        }
      }
      const nameRaw = cols.nameCol ? String(row?.[cols.nameCol] ?? "").trim() : "";
      if (
        nameRaw &&
        /\b(BANK|BIKAS|FINANCE)\b.*\b(RETIREMENT|PENSION|GRATUITY|AWAKASH)\b/i.test(nameRaw) &&
        sheet.sheetType !== "TAX_EXEMPTED"
      ) {
        sheetBankRetirements++;
      }
    }

    suspiciousBoidCount += sheetBadBoids;
    reviewSuspectCount += sheetBankRetirements;

    if (sheetBadBoids > 0) {
      findings.push({
        code: "IDENTIFIER_PRECISION_RISK",
        severity: "warning",
        sheetName: sheet.sheetName,
        message: `${sheetBadBoids} row(s) in "${sheet.sheetName}" have scientific-notation or non-16-digit Demat BOIDs starting with 130.`,
      });
    }

    if (sheetBankRetirements > 0) {
      findings.push({
        code: "RETIREMENT_FUND_VERIFICATION",
        severity: "info",
        sheetName: sheet.sheetName,
        message: `${sheetBankRetirements} bank retirement/awakash trust row(s) detected on "${sheet.sheetName}". Verify statutory Section 10 exemption before approval.`,
      });
    }
  }

  return {
    detectedFileType: parsed.fileType,
    sheetCount: dataSheets.length,
    totalRows,
    taxExemptSheetCount,
    reviewSuspectCount,
    suspiciousBoidCount,
    findings,
  };
}
