import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import { z } from "zod";

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
  return value.length >= 8 && /^[0-9A-Za-z]+$/.test(value);
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
    const { data: settings } = await (supabase as any)
      .from("system_settings_safe")
      .select("setting_value")
      .in("setting_key", ["tax_rate"])
      .maybeSingle();
    let systemTdsRates = { dividend: 5, interest: 6 };
    if (settings?.setting_value) {
      const rates = settings.setting_value as any;
      systemTdsRates = {
        dividend: rates.tds_dividend || 5,
        interest: rates.tds_interest || 6,
      };
    }

    return {
      existingBoids,
      existingClientCodes,
      existingISINs,
      existingPans,
      activeCompanies,
      activeFiscalYear,
      systemTdsRates,
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

      // RULE 1: BOID is required
      if (!boid) {
        errors.push({
          row: rowNum,
          field: "boid",
          type: "missing_boid",
          message: "BOID is required for every row.",
          rawData,
        });
      }
      // RULE 2: BOID format validation
      else if (!isValidBoid(boid)) {
        errors.push({
          row: rowNum,
          field: "boid",
          type: "invalid_boid",
          message: "BOID must be at least 8 alphanumeric characters.",
          rawData,
        });
      }
      // RULE 3: Duplicate BOID within file (warning, not blocking)
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

      // RULE 4: Full name is required
      if (!fullName) {
        errors.push({
          row: rowNum,
          field: "full_name",
          type: "missing_name",
          message: "Shareholder full name is required.",
          rawData,
        });
      }

      // RULE 5: Client code format and uniqueness
      if (clientCode) {
        if (!/^[A-Z0-9]{3,20}$/i.test(clientCode)) {
          errors.push({
            row: rowNum,
            field: "client_code",
            type: "invalid_client_code",
            message: "Client code must be 3-20 alphanumeric characters.",
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

      // RULE 6: ISIN validation
      if (isin) {
        if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) {
          errors.push({
            row: rowNum,
            field: "isin",
            type: "invalid_isin_format",
            message: "ISIN must be 12 characters (2 letters + 9 alphanumeric + 1 digit).",
            rawData,
          });
        } else if (!ctx.existingISINs.has(isin)) {
          errors.push({
            row: rowNum,
            field: "isin",
            type: "wrong_isin",
            message: `ISIN ${isin} does not match a registered company.`,
            rawData,
          });
        }
      }

      // RULE 7: PAN/Citizenship validation (Relaxed for bulk upload)
      // We no longer strictly validate format or block duplicates here to prevent mass upload failures.
      // These details can be updated later from the Client Profile.
      if (pan) {
        seenPans.add(pan);
      }

      // RULE 8: Date validations
      if (paymentDate && !isValidDateString(paymentDate)) {
        errors.push({
          row: rowNum,
          field: "payment_date",
          type: "invalid_payment_date",
          message: "Payment date must be a valid date (YYYY-MM-DD).",
          rawData,
        });
      }
      if (dueDate && !isValidDateString(dueDate)) {
        errors.push({
          row: rowNum,
          field: "due_date",
          type: "invalid_due_date",
          message: "Due date must be a valid date (YYYY-MM-DD).",
          rawData,
        });
      }
      if (paymentDate && dueDate && paymentDate > dueDate) {
        errors.push({
          row: rowNum,
          field: "payment_date",
          type: "payment_before_due",
          message: "Payment date cannot be before due date.",
          rawData,
        });
      }

      // RULE 9: Fiscal year format
      if (fiscalYear && !/^[0-9]{4}\/([0-9]{2}|[0-9]{4})$/.test(fiscalYear)) {
        errors.push({
          row: rowNum,
          field: "fiscal_year",
          type: "invalid_fiscal_year",
          message: "Fiscal year should be in format 2081/82 or 2081/2082.",
          rawData,
        });
      }

      // RULE 10: Numeric field validations
      if (gross !== null && isNaN(gross)) {
        errors.push({
          row: rowNum,
          field: "gross_amount",
          type: "invalid_gross",
          message: "Gross amount must be a number.",
          rawData,
        });
      }
      if (tax !== null && isNaN(tax)) {
        errors.push({
          row: rowNum,
          field: "tax_amount",
          type: "invalid_tax",
          message: "Tax amount must be a number.",
          rawData,
        });
      }
      if (net !== null && isNaN(net)) {
        errors.push({
          row: rowNum,
          field: "net_payable",
          type: "invalid_net",
          message: "Net payable must be a number.",
          rawData,
        });
      }
      if (sharesHeld !== null && isNaN(sharesHeld)) {
        errors.push({
          row: rowNum,
          field: "shares_held",
          type: "invalid_shares",
          message: "Shares held must be a number.",
          rawData,
        });
      }

      // RULE 11: Negative value checks
      if (gross !== null && gross < 0) {
        errors.push({
          row: rowNum,
          field: "gross_amount",
          type: "negative_gross",
          message: "Gross amount cannot be negative.",
          rawData,
        });
      }
      if (tax !== null && tax < 0) {
        errors.push({
          row: rowNum,
          field: "tax_amount",
          type: "negative_tax",
          message: "Tax amount cannot be negative.",
          rawData,
        });
      }
      if (net !== null && net < 0) {
        errors.push({
          row: rowNum,
          field: "net_payable",
          type: "negative_net",
          message: "Net payable cannot be negative.",
          rawData,
        });
      }
      if (sharesHeld !== null && sharesHeld < 0) {
        errors.push({
          row: rowNum,
          field: "shares_held",
          type: "negative_shares",
          message: "Shares held cannot be negative.",
          rawData,
        });
      }

      // RULE 12: Tax cannot exceed gross
      if (gross !== null && tax !== null && tax > gross) {
        errors.push({
          row: rowNum,
          field: "tax_amount",
          type: "tax_above_gross",
          message: "Tax amount cannot exceed gross amount.",
          rawData,
        });
      }

      // RULE 13: Net cannot exceed gross
      if (gross !== null && net !== null && net > gross) {
        errors.push({
          row: rowNum,
          field: "net_payable",
          type: "net_above_gross",
          message: "Net payable cannot exceed gross amount.",
          rawData,
        });
      }

      // RULE 14: Net = Gross - Tax validation
      if (!options?.isRawInputFile && !options?.isPreCalculated) {
        if (gross !== null && tax !== null && net !== null) {
          const expectedNet = Math.round((gross - tax) * 100) / 100;
          if (Math.abs(expectedNet - net) > 1) {
            errors.push({
              row: rowNum,
              field: "net_payable",
              type: "net_mismatch",
              message: `Net payable does not match gross minus tax (expected ${expectedNet.toFixed(2)}=gross ${gross.toFixed(2)}−tax ${tax.toFixed(2)}, got ${net.toFixed(2)}). Check the sheet's calculation.`,
              rawData,
            });
          }
        }
      }

      // RULE 14b: Tax calculation cross-check
      if (!options?.isRawInputFile && !options?.isPreCalculated) {
        const tdsForTaxCheck = tdsRate !== null ? tdsRate : tdsFromHeader;
        if (tax !== null && gross !== null && tdsForTaxCheck !== null) {
          const expectedTax = Math.round(gross * tdsForTaxCheck * 100) / 100;
          if (Math.abs(expectedTax - tax) > 0.05) {
            errors.push({
              row: rowNum,
              field: "tax_amount",
              type: "tax_calc_mismatch",
              message: `Tax does not match ${(tdsForTaxCheck * 100).toFixed(0)}% of gross (expected ${expectedTax.toFixed(2)} = ${gross.toFixed(2)} × ${tdsForTaxCheck}, got ${tax.toFixed(2)}). Check the sheet's calculation.`,
              rawData,
            });
          }
        }
      }
      
      // RULE 14c: Pre-calculation verification (Soft warning)
      if (options?.isPreCalculated && options?.dividendRate !== undefined && sharesHeld !== null) {
        // Just verify gross if rate is provided
        const expectedGross = Math.round(sharesHeld * options.dividendRate * 100) / 100;
        if (gross !== null && Math.abs(expectedGross - gross) > 1) {
          errors.push({
            row: rowNum,
            field: "gross_amount",
            type: "calculation_discrepancy", // soft error
            message: `Pre-calculated gross does not match expected based on configured rate (expected ${expectedGross.toFixed(2)}, got ${gross.toFixed(2)}).`,
            rawData,
          });
        }
      }

      // RULE 15: Amount precision (max 2 decimal places)
      if (gross !== null && !hasValidAmountPrecision(gross)) {
        errors.push({
          row: rowNum,
          field: "gross_amount",
          type: "invalid_precision",
          message: "Gross amount must have maximum 2 decimal places.",
          rawData,
        });
      }
      if (net !== null && !hasValidAmountPrecision(net)) {
        errors.push({
          row: rowNum,
          field: "net_payable",
          type: "invalid_precision",
          message: "Net payable must have maximum 2 decimal places.",
          rawData,
        });
      }

      // RULE 16: TDS rate validation
      if (tdsRate !== null) {
        if (tdsRate < 0 || tdsRate > 100) {
          errors.push({
            row: rowNum,
            field: "tds_rate",
            type: "invalid_tds_rate",
            message: "TDS rate must be between 0 and 100.",
            rawData,
          });
        }
      }

      // RULE 17: At least one financial field required
      if (!options?.isRawInputFile) {
        if (gross === null && net === null && sharesHeld === null) {
          errors.push({
            row: rowNum,
            field: "amount",
            type: "missing_financial_data",
            message: "Row must contain gross/net amount or shares held.",
            rawData,
          });
        }
      }

      // RULE 18: Bank account format validation
      if (bankAccount && !isValidAccountNumber(bankAccount)) {
        errors.push({
          row: rowNum,
          field: "bank_account_no",
          type: "invalid_bank_account",
          message: "Bank account number must be 10-25 digits.",
          rawData,
        });
      }

      // RULE 19: Bank name and account consistency
      if (bankAccount && !bankName) {
        errors.push({
          row: rowNum,
          field: "bank_name",
          type: "missing_bank_name",
          message: "Bank name is required when bank account is present.",
          rawData,
        });
      }
      if (bankName && !bankAccount) {
        errors.push({
          row: rowNum,
          field: "bank_account_no",
          type: "missing_bank_account",
          message: "Bank account number is required when bank name is present.",
          rawData,
        });
      }

      // RULE 20: Phone validation (Relaxed for bulk upload)
      // Details can be edited later from the client profile.
      // if (phone && !isValidPhone(phone)) {
      //   errors.push({ row: rowNum, field: 'phone', type: 'invalid_phone', message: 'Invalid phone number format (expected 10-digit Nepali number).', rawData });
      // }

      // RULE 21: Email validation (if provided)
      if (email && !isValidEmail(email)) {
        errors.push({
          row: rowNum,
          field: "email",
          type: "invalid_email",
          message: "Invalid email address format.",
          rawData,
        });
      }

      // RULE 22: Address is recommended
      if (!address && fullName) {
        errors.push({
          row: rowNum,
          field: "address",
          type: "missing_address",
          message: "Address is recommended for all shareholders.",
          rawData,
        });
      }

      // RULE 23: BOID already exists in system (warning)
      if (boid && ctx.existingBoids.has(boid)) {
        errors.push({
          row: rowNum,
          field: "boid",
          type: "existing_boid",
          message: `BOID ${boid} already exists in system (will update existing record).`,
          rawData,
        });
      }

      // RULE 24: Client code already exists
      if (clientCode && ctx.existingClientCodes.has(clientCode)) {
        errors.push({
          row: rowNum,
          field: "client_code",
          type: "existing_client_code",
          message: `Client code ${clientCode} already exists in system.`,
          rawData,
        });
      }
    });

    return errors;
  },
};
