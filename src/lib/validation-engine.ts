import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import { z } from "zod";
import { detectPayeeCategory } from "./services/payable-summary";
import { getTaxRateFromRules, investorCategoryToClassification, isExemptFromTax } from "./services/tax-rules.service";

export const excelRowSchema = z
  .object({
    boid: z
      .string()
      .min(8, "BOID must be at least 8 alphanumeric characters")
      .regex(/^[0-9A-Za-z]+$/, "Invalid BOID format"),
    full_name: z.string().min(1, "Shareholder full name is required"),
    client_code: z
      .string()
      .regex(/^[A-Z0-9]{3,20}$/i, "Client code must be 3-20 alphanumeric characters")
      .optional()
      .or(z.literal("")),
    isin: z
      .string()
      .regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/, "ISIN must be 12 characters")
      .optional()
      .or(z.literal("")),
    gross_amount: z.number().min(0, "Gross amount cannot be negative").optional(),
    tax_amount: z.number().min(0, "Tax amount cannot be negative").optional(),
    net_payable: z.number().min(0, "Net payable cannot be negative").optional(),
    shares_held: z.number().min(0, "Shares held cannot be negative").optional(),
  })
  .refine(
    (data) => {
      if (data.gross_amount !== undefined && data.tax_amount !== undefined) {
        return data.tax_amount <= data.gross_amount;
      }
      return true;
    },
    {
      message: "Tax amount cannot exceed gross amount",
      path: ["tax_amount"],
    },
  )
  .refine(
    (data) => {
      if (data.gross_amount !== undefined && data.net_payable !== undefined) {
        return data.net_payable <= data.gross_amount;
      }
      return true;
    },
    {
      message: "Net payable cannot exceed gross amount",
      path: ["net_payable"],
    },
  );

export interface ValidationError {
  row: number;
  field: string;
  type: string;
  message: string;
  rawData?: Record<string, unknown>;
}

interface ValidationContext {
  existingBoids: Set<string>;
  existingClientCodes: Set<string>;
  existingISINs: Set<string>;
  existingPans: Set<string>;
  activeCompanies: Map<
    string,
    {
      coupon_rate?: number;
      dividend_rate?: number;
      isin?: string;
      company_type?: string;
      fiscal_year?: string;
    }
  >;
  activeFiscalYear: string | null;
  systemTdsRates: { dividend: number; interest: number };
  taxRules: any[];
}

const PAYABLE_TABLES = ["dividend_payables", "interest_payables", "mutual_fund_payables"] as const;

async function hasActiveRowsForUpload(
  uploadId: string,
  targetTable?: string | null,
): Promise<boolean> {
  const tables =
    targetTable && PAYABLE_TABLES.includes(targetTable as any) ? [targetTable] : PAYABLE_TABLES;

  for (const table of tables) {
    const { count, error } = await (supabase as any)
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("upload_id", uploadId);

    if (error) {
      console.warn(`Duplicate-check row probe failed for ${table}:`, error.message);
      continue;
    }

    if ((count || 0) > 0) {
      return true;
    }
  }

  return false;
}

async function hasActiveDuplicateFileHash(fileHash: string): Promise<boolean> {
  const { data: uploads, error } = await (supabase as any)
    .from("upload_history")
    .select("id, target_table")
    .eq("file_hash", fileHash)
    .eq("status", "Completed");

  if (error) {
    console.warn("Duplicate-check hash probe failed:", error.message);
    return false;
  }

  for (const upload of uploads || []) {
    if (await hasActiveRowsForUpload(upload.id, upload.target_table)) {
      return true;
    }
  }

  return false;
}

const normalizeString = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const cleanNumeric = (value: unknown): string =>
  normalizeString(value).replace(/,/g, "").replace(/\s+/g, "");

const parseNumber = (value: unknown): number | null => {
  const cleaned = cleanNumeric(value);
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
};

const isValidDateString = (value: string): boolean => {
  if (!value) return true;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
};

const isValidBoid = (value: string): boolean => {
  return value.length >= 6 && /^[0-9A-Za-z]+$/.test(value);
};

const isValidPAN = (value: string): boolean => {
  // Nepali PAN format: 9 digits + 1 letter (e.g., 123456789A)
  return /^[0-9]{9}[A-Z]$/.test(value);
};

const isValidCitizenship = (value: string): boolean => {
  // Nepali citizenship: various formats, typically alphanumeric
  return value.length >= 6 && /^[A-Za-z0-9\-\/]+$/.test(value);
};

const isValidPhone = (value: string): boolean => {
  // Nepali phone: 10 digits starting with 98 or 97, or with country code +977
  const cleaned = value.replace(/[\s\-]/g, "");
  return /^(\+977)?[97][0-9]{8}$/.test(cleaned) || /^[0-9]{10}$/.test(cleaned);
};

const isValidEmail = (value: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

const isValidAccountNumber = (value: string): boolean => {
  // Bank account numbers: typically 10-20 digits
  const cleaned = value.replace(/[\s\-]/g, "");
  return /^[0-9]{10,25}$/.test(cleaned);
};

const hasValidAmountPrecision = (value: number | null): boolean => {
  if (value === null) return true;
  const decimalPart = String(value).split(".")[1];
  return !decimalPart || decimalPart.length <= 2;
};

export const ValidationEngine = {
  getMappedKey(dbField: string, mappings: Record<string, string>): string {
    const entry = Object.entries(mappings).find(([_, value]) => value === dbField);
    return entry ? entry[0] : dbField;
  },

  async buildContext(rows: any[], fileType?: string): Promise<ValidationContext> {
    const boids = rows.map((r) => r["BOID"] || r["boid"]).filter(Boolean);
    const { data: clients } = await supabase
      .from("clients")
      .select("boid, client_code, pan_or_citizenship")
      .in("boid", boids);
    const existingBoids = new Set<string>(
      clients?.map((c) => c.boid).filter((b): b is string => b !== null) || [],
    );
    const existingClientCodes = new Set<string>(
      clients?.map((c) => c.client_code).filter((c): c is string => c !== null) || [],
    );
    const existingPans = new Set<string>(
      clients?.map((c) => c.pan_or_citizenship).filter((p): p is string => p !== null) || [],
    );

    const { data: companies } = await supabase
      .from("companies")
      .select("isin, coupon_rate, dividend_rate, id, company_type, fiscal_year");
    const existingISINs = new Set<string>(
      companies?.map((c) => c.isin).filter((i): i is string => i !== null) || [],
    );
    const activeCompanies = new Map<string, any>(
      companies?.filter((c) => c.isin !== null).map((c) => [c.isin as string, c]) || [],
    );

    const { data: fy } = await supabase
      .from("fiscal_years")
      .select("fiscal_year")
      .eq("is_active", true)
      .maybeSingle();
    const activeFiscalYear = fy?.fiscal_year || null;

    // Get system TDS rates from settings (safe view keeps SMTP password hidden)
    // Authoritative tax rates live in `payable_tax_rules` (the table the DB
    // trigger actually reads). Reading from the legacy `system_settings.tax_rate`
    // blob risked a second source of truth that could silently diverge from the
    // rates applied at insert time. Derive the expected rates from the rules
    // table instead, keeping the same {dividend, interest} (percent) shape.
    let systemTdsRates = { dividend: 5, interest: 6 };
    let taxRules: any[] = [];
    try {
      const { data: rules } = await (supabase as any)
        .from("payable_tax_rules")
        .select("payable_category, payee_classification, tax_rate, is_active")
        .eq("is_active", true);
      taxRules = (rules ?? []) as any[];

      const ratePct =
        (category: string, classification: string): number | null => {
          const hit = taxRules.find(
            (r: any) => r.payable_category === category && r.payee_classification === classification,
          );
          return hit?.tax_rate != null ? Number(hit.tax_rate) * 100 : null;
        };

      const dividendNatural = ratePct("DIVIDEND", "NATURAL_PERSON");
      const interestNatural = ratePct("INTEREST", "NATURAL_PERSON");
      if (dividendNatural != null) systemTdsRates.dividend = dividendNatural;
      if (interestNatural != null) systemTdsRates.interest = interestNatural;
    } catch (e) {
      // Fall back to the defaults above.
      console.warn("Could not load payable_tax_rules for validation context", e);
    }

    return {
      existingBoids,
      existingClientCodes,
      existingISINs,
      existingPans,
      activeCompanies,
      activeFiscalYear,
      systemTdsRates,
      taxRules,
    };
  },

  downloadErrorReport(errors: ValidationError[], fileName: string = "import"): void {
    const safeName = fileName.replace(/[^a-zA-Z0-9-_]/g, "_").replace(/\.[^.]+$/, "") || "import";
    const data = errors.map((e) => ({
      Row: e.row || "File",
      Field: e.field,
      Type: e.type,
      Message: e.message,
      Raw_Data: e.rawData ? JSON.stringify(e.rawData) : "",
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 8 }, { wch: 20 }, { wch: 20 }, { wch: 60 }, { wch: 60 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Errors");
    XLSX.writeFile(wb, `${safeName}-errors.xlsx`);
  },

  async validateBatch(
    rows: any[],
    mappings: Record<string, string>,
    fileHash?: string,
    fileType?: string,
    options?: {
      isRawInputFile?: boolean;
      isPreCalculated?: boolean;
      dividendRate?: number;
    }
  ): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    if (fileHash && (await hasActiveDuplicateFileHash(fileHash))) {
      errors.push({
        row: 0,
        field: "file",
        type: "duplicate_upload",
        message: "This file has already been uploaded.",
        rawData: {},
      });
      return errors;
    }

    const ctx = await this.buildContext(rows, fileType);

    // Derive a TDS rate from the TAX column's header when it encodes the rate
    // (e.g. "TAX @6%", "TAX @15%") so we can cross-check tax = gross × rate
    // without depending on a per-row tds_rate column.
    const taxHeaderForRate = Object.entries(mappings).find(
      ([, f]) => f === "div_tax" || f === "bon_tax",
    )?.[0];
    const tdsRateMatch = taxHeaderForRate?.toUpperCase().match(/@\s*([\d.]+)\s*%/);
    const tdsFromHeader =
      tdsRateMatch && !isNaN(Number(tdsRateMatch[1])) ? Number(tdsRateMatch[1]) / 100 : null;

    const seenBoids = new Set<string>();
    const seenClientCodes = new Set<string>();
    const seenPans = new Set<string>();

    rows.forEach((row, index) => {
      const rowNum = index + 1;
      const get = (field: string) => {
        const mappedKey = this.getMappedKey(field, mappings);
        return row[mappedKey] ?? row[field];
      };

      // Clean up BOID: strip commas, spaces, decimals, and fix scientific notation if any
      let rawBoid = normalizeString(get("boid") || get("BOID"));
      rawBoid = rawBoid.replace(/[, \-]/g, "").split(".")[0]; // Remove commas/spaces/dashes, drop decimals
      if (rawBoid.includes("e") || rawBoid.includes("E")) {
        // If Excel converted large number to scientific notation (e.g. 1.30123e+15)
        const num = Number(rawBoid);
        if (!isNaN(num)) {
          rawBoid = num.toLocaleString("fullwide", { useGrouping: false });
        }
      }
      const boid = rawBoid;

      const fullName = normalizeString(get("full_name") || get("NAME"));
      const clientCode = normalizeString(get("client_code") || get("CLIENT_CODE"));
      const isin = normalizeString(get("isin") || row["ISIN"] || row["ISIN NO."] || row["ISIN NO"]);
      const pan = normalizeString(get("pan_or_citizenship") || get("PAN") || get("CITIZENSHIP"));
      const bankName = normalizeString(get("bank_name") || get("BANK"));
      const bankAccount = normalizeString(get("bank_account_no") || get("ACCOUNT_NUMBER"));
      const paymentDate = normalizeString(get("payment_date") || row["PAYMENT_DATE"]);
      const dueDate = normalizeString(get("due_date") || row["DUE_DATE"]);
      const fiscalYear = normalizeString(get("fiscal_year") || row["fiscal_year"]);
      const address = normalizeString(get("address") || get("ADDRESS"));
      const phone = normalizeString(get("phone") || get("PHONE") || get("MOBILE"));
      const email = normalizeString(get("email") || get("EMAIL"));

      // NOTE: The parser maps amount/gross to the "cash_dividend" field and tax
      // to "div_tax"/"bon_tax". Read THOSE mapped fields (via their header) so the
      // calculation cross-checks actually receive real numbers.
      const gross = parseNumber(
        get("cash_dividend") ??
          get("gross_amount") ??
          get("gross_dividend") ??
          get("gross_interest") ??
          get("amount"),
      );
      const tax = parseNumber(get("div_tax") ?? get("bon_tax") ?? get("tax_amount") ?? get("tax"));
      const net = parseNumber(get("net_payable") ?? get("net"));
      const sharesHeld = parseNumber(get("shares_held") ?? get("kitta") ?? get("QUANTITY"));
      const tdsRate = parseNumber(get("tds_rate") ?? get("TDS_RATE"));

      const rawData = row;

      // RULE 1: BOID is required (Core essential)
      if (!boid) {
        errors.push({
          row: rowNum,
          field: "boid",
          type: "missing_boid",
          message: "BOID is required for every row.",
          rawData,
        });
      }
      // RULE 2: BOID format validation (Core essential)
      else if (!isValidBoid(boid)) {
        errors.push({
          row: rowNum,
          field: "boid",
          type: "invalid_boid",
          message: "BOID must be at least 6 alphanumeric characters.",
          rawData,
        });
      }
      // RULE 3: Duplicate BOID within file (Soft notice)
      else if (seenBoids.has(boid)) {
        errors.push({
          row: rowNum,
          field: "boid",
          type: "duplicate_boid_in_file",
          message: `Duplicate BOID ${boid} in file (first occurrence will be used).`,
          rawData,
        });
      }
      if (boid) seenBoids.add(boid);

      // RULE 4: Full name (Soft notice - fallback provided during import)
      if (!fullName) {
        errors.push({
          row: rowNum,
          field: "full_name",
          type: "missing_name",
          message: "Shareholder name is missing (will default to 'Unknown Investor').",
          rawData,
        });
      }

      // RULE 5: Client code (Soft notice)
      if (clientCode) {
        if (!/^[A-Z0-9_-]{2,30}$/i.test(clientCode)) {
          errors.push({
            row: rowNum,
            field: "client_code",
            type: "invalid_client_code",
            message: "Client code contains special characters.",
            rawData,
          });
        }
        if (seenClientCodes.has(clientCode)) {
          errors.push({
            row: rowNum,
            field: "client_code",
            type: "duplicate_client_code",
            message: `Duplicate client code ${clientCode} in file.`,
            rawData,
          });
        }
        seenClientCodes.add(clientCode);
      }

      // RULE 6: ISIN validation (Soft notice - never blocks upload)
      if (isin) {
        if (!/^[A-Z0-9]{6,16}$/i.test(isin)) {
          errors.push({
            row: rowNum,
            field: "isin",
            type: "invalid_isin_format",
            message: `ISIN "${isin}" format notice.`,
            rawData,
          });
        }
      }

      // RULE 7: PAN/Citizenship validation (Soft notice)
      if (pan) {
        seenPans.add(pan);
      }

      // RULE 8: Date validations (Soft notice)
      if (paymentDate && !isValidDateString(paymentDate)) {
        errors.push({
          row: rowNum,
          field: "payment_date",
          type: "invalid_payment_date",
          message: "Payment date format notice (expected YYYY-MM-DD).",
          rawData,
        });
      }
      if (dueDate && !isValidDateString(dueDate)) {
        errors.push({
          row: rowNum,
          field: "due_date",
          type: "invalid_due_date",
          message: "Due date format notice (expected YYYY-MM-DD).",
          rawData,
        });
      }

      // RULE 9: Fiscal year format (Soft notice)
      if (fiscalYear && !/^[0-9]{4}\/([0-9]{2}|[0-9]{4})$/.test(fiscalYear)) {
        errors.push({
          row: rowNum,
          field: "fiscal_year",
          type: "invalid_fiscal_year",
          message: "Fiscal year notice (e.g., 2081/82).",
          rawData,
        });
      }

      // RULE 10: Numeric field validations (Soft notice)
      if (gross !== null && isNaN(gross)) {
        errors.push({
          row: rowNum,
          field: "gross_amount",
          type: "invalid_gross",
          message: "Gross amount must be numeric.",
          rawData,
        });
      }
      if (tax !== null && isNaN(tax)) {
        errors.push({
          row: rowNum,
          field: "tax_amount",
          type: "invalid_tax",
          message: "Tax amount must be numeric.",
          rawData,
        });
      }
      if (net !== null && isNaN(net)) {
        errors.push({
          row: rowNum,
          field: "net_payable",
          type: "invalid_net",
          message: "Net payable must be numeric.",
          rawData,
        });
      }
      if (sharesHeld !== null && isNaN(sharesHeld)) {
        errors.push({
          row: rowNum,
          field: "shares_held",
          type: "invalid_shares",
          message: "Shares / Units held must be numeric.",
          rawData,
        });
      }

      // RULE 11: Net = Gross - Tax calculation check (Soft notice)
      if (!options?.isRawInputFile && !options?.isPreCalculated) {
        if (gross !== null && tax !== null && net !== null) {
          const expectedNet = Math.round((gross - tax) * 100) / 100;
          if (Math.abs(expectedNet - net) > 1) {
            errors.push({
              row: rowNum,
              field: "net_payable",
              type: "net_mismatch",
              message: `Net payable notice: expected ${expectedNet.toFixed(2)} (gross ${gross.toFixed(2)} − tax ${tax.toFixed(2)}), sheet has ${net.toFixed(2)}.`,
              rawData,
            });
          }
        }
      }

            // RULE 12: Tax calculation check (Soft notice)
      if (!options?.isRawInputFile && !options?.isPreCalculated) {
        const detectedCategory = detectPayeeCategory(row, fileType);
        const classification = investorCategoryToClassification(detectedCategory);
        const isExempt = isExemptFromTax(classification);
        let tdsForTaxCheck = tdsRate !== null ? tdsRate : tdsFromHeader;
        const payableCategory =
          fileType === "mutual_fund"
            ? "MUTUAL_FUND"
            : fileType === "debenture" || fileType === "interest"
              ? "INTEREST"
              : "DIVIDEND";
        if (tdsForTaxCheck === null && classification) {
          // Centralized fallback: Payable Type + Investor Category → rate.
          const ruleRate = getTaxRateFromRules(ctx.taxRules, payableCategory, classification);
          if (ruleRate != null) tdsForTaxCheck = ruleRate;
        }
        if (!isExempt && tax !== null && gross !== null && tdsForTaxCheck !== null) {
          const expectedTax = Math.round(gross * tdsForTaxCheck * 100) / 100;
          if (Math.abs(expectedTax - tax) > 0.5) {
            errors.push({
              row: rowNum,
              field: "tax_amount",
              type: "tax_calc_mismatch",
              message: `Tax calculation notice: expected ${expectedTax.toFixed(2)} based on ${(tdsForTaxCheck * 100).toFixed(0)}% rate, sheet has ${tax.toFixed(2)}.`,
              rawData,
            });
          }
        }
      }

      // RULE 13: Financial fields check (Soft notice only - values will default to 0 / calculated)
      if (!options?.isRawInputFile) {
        if (gross === null && net === null && sharesHeld === null && !options?.dividendRate) {
          errors.push({
            row: rowNum,
            field: "amount",
            type: "missing_financial_data",
            message: "No financial amount or shares detected (will default to 0).",
            rawData,
          });
        }
      }

      // RULE 14: Bank account format check (Soft notice only - accounts may be empty in CDS records)
      if (bankAccount && !isValidAccountNumber(bankAccount)) {
        errors.push({
          row: rowNum,
          field: "bank_account_no",
          type: "invalid_bank_account",
          message: `Bank account "${bankAccount}" notice.`,
          rawData,
        });
      }

      // RULE 15: Email check (Soft notice only)
      if (email && !isValidEmail(email)) {
        errors.push({
          row: rowNum,
          field: "email",
          type: "invalid_email",
          message: `Email "${email}" notice.`,
          rawData,
        });
      }

      // RULE 16: Address recommended (Soft notice only)
      if (!address && fullName) {
        errors.push({
          row: rowNum,
          field: "address",
          type: "missing_address",
          message: "Address recommended.",
          rawData,
        });
      }

      // RULE 17: Existing BOID in system (Soft notice)
      if (boid && ctx.existingBoids.has(boid)) {
        errors.push({
          row: rowNum,
          field: "boid",
          type: "existing_boid",
          message: `BOID ${boid} exists in system (record will be updated).`,
          rawData,
        });
      }
    });

    return errors;
  },
};
