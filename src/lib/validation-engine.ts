import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import { z } from "zod";
import { RECONCILIATION_TOLERANCE_NPR } from "./constants";
import { chunkArray } from "./bulk-ops";
import { detectPayeeCategory } from "./services/payable-summary";
import {
  getTaxRateFromRules,
  investorCategoryToClassification,
  isExemptFromTax,
} from "./services/tax-rules.service";

export const excelRowSchema = z
  .object({
    boid: z
      .string()
      .min(1, "BOID or Folio identifier is required")
      .max(24, "BOID or Folio identifier cannot exceed 24 characters")
      .regex(
        /^[0-9A-Za-z_-]+$/,
        "Invalid BOID format (must be 16-digit Demat BOID or valid Folio identifier)",
      ),
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
  severity?: "error" | "warning";
  rawData?: Record<string, unknown>;
}

export function summarizeValidationResults(errors: ValidationError[]): {
  errorCount: number;
  warningCount: number;
  blockingErrors: ValidationError[];
  warnings: ValidationError[];
  hasBlockingErrors: boolean;
} {
  const blockingErrors = errors.filter((e) => (e.severity ?? "error") === "error");
  const warnings = errors.filter((e) => e.severity === "warning");
  return {
    errorCount: blockingErrors.length,
    warningCount: warnings.length,
    blockingErrors,
    warnings,
    hasBlockingErrors: blockingErrors.length > 0,
  };
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

export const BOID_ALIASES = [
  "boid",
  "BOID",
  "BENEFICIARY ID",
  "CLIENT ID",
  "BENEFICIARY_ID",
  "CLIENT_ID",
  "DP ID",
  "DPID",
  "BO ID",
  "BO_ID",
  "BENEFICIARY_NO",
  "BENEFICIARY NO",
  "BENEFICIARY NO.",
  "BENEFICIARY",
  "BENEFICIARY ACC NO",
  "BENEFICIARY ACCOUNT NO",
  "BENEFICIARY ACCOUNT NUMBER",
  "BENEFICIARY A/C",
  "BENEFICIARY A/C NO",
  "CLIENT CODE",
  "CLIENT_CODE",
  "CLIENTCODE",
  "CLIENT NO",
  "CLIENT_NO",
  "CLIENT NO.",
  "DP CLIENT ID",
  "DP_CLIENT_ID",
  "DPCLIENTID",
  "DP-CLIENT-ID",
  "DMAT A/C",
  "DEMAT A/C",
  "DEMAT AC",
  "DEMAT ACCOUNT",
  "DEMAT_ACCOUNT",
  "DEMAT",
  "DEMAT NO",
  "DEMAT NO.",
  "DEMAT_NO",
  "DMAT",
  "DMAT NO",
  "DMAT NO.",
  "DMAT_NO",
  "DMAT AC",
  "DMAT ACCOUNT",
  "DMAT_ACCOUNT",
  "BOID NO",
  "BOID NO.",
  "BOIDNO",
  "FOLIO",
  "FOLIO NO",
  "FOLIO NO.",
  "FOLIO_NO",
  "FOLIONO",
  "FOLIO NUMBER",
  "SH NO",
  "SH_NO",
  "SH.NO",
  "SH. NO.",
  "SH HOLDER NO",
  "SHAREHOLDER NO",
  "SHARE HOLDER NO",
  "SHAREHOLDER ID",
  "HOLDER NO",
  "HOLDER NO.",
  "HOLDER_NO",
  "HOLDER NUMBER",
  "HOLDER ID",
  "BOID / FOLIO",
  "BOID/FOLIO",
  "BOID/FOLIO NO",
  "REG NO",
  "REG_NO",
  "REGISTRATION NO",
];

export function expandScientificNotation(raw: string): string {
  const trimmed = String(raw || "").trim();
  const match = trimmed.match(/^([+-]?\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!match) return trimmed;
  const [, intPart, decPart = "", expStr] = match;
  const exp = parseInt(expStr, 10);
  if (exp > 0) {
    if (exp >= decPart.length) {
      return intPart + decPart + "0".repeat(exp - decPart.length);
    } else {
      return intPart + decPart.slice(0, exp) + "." + decPart.slice(exp);
    }
  }
  return trimmed;
}

export function normalizeBoid(raw: unknown): string | null {
  if (!raw) return null;
  let str = expandScientificNotation(String(raw)).trim().replace(/[\s-]/g, "");
  if (!str) return null;
  if (/^\d+$/.test(str) && str.length >= 8 && str.length < 16) {
    str = str.padStart(16, "0");
  }
  return str;
}

export function cleanBoidString(raw: string): string {
  if (raw === null || raw === undefined) return "";
  let str = String(raw).trim().replace(/[, ]/g, "");
  if (!str) return "";

  // 1. Expand exponential / scientific notation FIRST before splitting any decimal
  if (/[eE]/.test(str)) {
    str = expandScientificNotation(str);
  }

  // 2. If it still contains a decimal point (e.g. "12345.00"), strip the fraction
  if (str.includes(".")) {
    str = str.split(".")[0];
  }

  // 3. Remove hyphens for standard comparison
  return str.replace(/[-]/g, "");
}

export function extractCanonicalBoid(row: any, mappings?: Record<string, string>): string {
  if (!row) return "";
  if (mappings) {
    const mappedKey = Object.entries(mappings).find(([_, v]) => v === "boid")?.[0];
    if (mappedKey && row[mappedKey] !== undefined && row[mappedKey] !== null) {
      const val = cleanBoidString(row[mappedKey]);
      if (val) return val;
    }
  }

  for (const alias of BOID_ALIASES) {
    if (row[alias] !== undefined && row[alias] !== null && String(row[alias]).trim() !== "") {
      return cleanBoidString(String(row[alias]));
    }
  }

  // Fallback: check case-insensitively
  for (const [key, val] of Object.entries(row)) {
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      const cleanKey = key
        .trim()
        .toUpperCase()
        .replace(/[\s_.-]/g, "");
      if (
        cleanKey === "BOID" ||
        cleanKey === "BENEFICIARYID" ||
        cleanKey === "DEMATAC" ||
        cleanKey === "CLIENTID"
      ) {
        return cleanBoidString(String(val));
      }
    }
  }

  return "";
}

async function hasActiveRowsForUpload(
  uploadId: string,
  targetTable?: string | null,
): Promise<boolean> {
  const tables =
    targetTable && PAYABLE_TABLES.includes(targetTable as any) ? [targetTable] : PAYABLE_TABLES;

  const probeTable = async (table: string) => {
    const { count, error } = await (supabase as any)
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("upload_id", uploadId);

    if (error) {
      console.error(
        `Duplicate-check row probe failed for ${table} (failing closed):`,
        error.message,
      );
      throw new Error(`Duplicate-check row probe failed for ${table}: ${error.message}`);
    }

    return (count || 0) > 0;
  };

  const results = await Promise.all(tables.map(probeTable));
  return results.some(Boolean);
}

async function hasActiveDuplicateFileHash(fileHash: string): Promise<boolean> {
  let timer: any;
  const timeoutPromise = new Promise<boolean>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Duplicate file hash check timed out")), 5000);
  });

  const checkPromise = (async () => {
    const { data, error } = await (supabase as any)
      .from("upload_history")
      .select("id, target_table")
      .eq("file_hash", fileHash)
      .eq("status", "Completed");

    if (error) {
      console.error("Failed to check duplicate file hash (failing closed):", error.message);
      throw new Error(`Failed to check duplicate file hash: ${error.message}`);
    }

    if (!data || data.length === 0) return false;

    // Check all matching uploads in parallel
    const checks = data.map((upload: any) =>
      hasActiveRowsForUpload(upload.id, upload.target_table),
    );
    const results = await Promise.all(checks);
    return results.some(Boolean);
  })();

  try {
    return await Promise.race([checkPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

const normalizeString = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const cleanNumeric = (value: unknown): string =>
  normalizeString(value).replace(/,/g, "").replace(/\s+/g, "");

const parseNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
};

const isValidDateString = (value: string): boolean => {
  if (!value) return true;
  const str = value.trim();
  // Standard ISO/Nepali date format check: YYYY-MM-DD or YYYY/MM/DD or DD-MM-YYYY or DD/MM/YYYY
  const isFormatted =
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(str) || /^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(str);
  if (!isFormatted) return false;

  // Bikram Sambat (BS) calendar check (years 2050 - 2150)
  const parts = str.split(/[-/]/).map(Number);
  const isYearFirst = parts[0] > 1000;
  const year = isYearFirst ? parts[0] : parts[2];
  if (year >= 2050 && year <= 2150) {
    const month = parts[1];
    const day = isYearFirst ? parts[2] : parts[0];
    return month >= 1 && month <= 12 && day >= 1 && day <= 32;
  }

  const date = new Date(str);
  return !Number.isNaN(date.getTime());
};

export const isValidBoid = (value: string, isPhysicalOrFolio: boolean = false): boolean => {
  if (!value) return false;
  const v = cleanBoidString(value);
  if (!v) return false;

  // If explicitly designated as physical folio / shareholder number:
  if (isPhysicalOrFolio) {
    return /^[0-9A-Za-z_-]{1,24}$/.test(v);
  }

  // CDSC Nepal Demat BOID: exactly 16 numeric digits
  if (/^\d{16}$/.test(v)) {
    return true;
  }

  // Truncated Demat BOID: starts with '130' (standard Nepal DP prefix) but is under 16 digits
  if (/^130\d*$/.test(v) && v.length < 16) {
    return false;
  }

  // Physical Folio / Shareholder / Certificate identifier (1 to 24 characters)
  // Folio numbers can be integers like 1, 42, 1054 or codes like FOLIO-1, SH-42
  return /^[0-9A-Za-z_-]{1,24}$/.test(v);
};

const isValidPAN = (value: string): boolean => {
  // Nepal IRD PAN format: exactly 9 numeric digits
  return /^[0-9]{9}$/.test(value.trim());
};

const isValidNID = (value: string): boolean => {
  // Nepal National ID (Rastriya Parichayapatra): exactly 11 numeric digits
  // Old-format NIDs issued before 2021 reform are 10 digits — normalizeNID pads them
  const trimmed = value.trim();
  return /^[0-9]{11}$/.test(trimmed) || /^[0-9]{10}$/.test(trimmed);
};

/**
 * Normalize a Nepal NID to 11 digits.
 * Old-format NIDs from before the 2021 digital ID system are 10 numeric digits.
 * They are valid — just need a leading zero to reach the 11-digit standard.
 */
export const normalizeNID = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim().replace(/\s+/g, "");
  if (/^[0-9]{10}$/.test(trimmed)) return trimmed.padStart(11, "0");
  if (/^[0-9]{11}$/.test(trimmed)) return trimmed;
  return trimmed; // not numeric / other format — return as-is
};

const isValidCitizenship = (value: string): boolean => {
  // Nepali citizenship: various formats, typically alphanumeric with hyphens or slashes
  return value.length >= 4 && /^[A-Za-z0-9/-]+$/.test(value.trim());
};

const isValidPhone = (value: string): boolean => {
  // Nepali phone: 10 digits starting with 98 or 97, or landline, or with country code +977
  const cleaned = value.replace(/[\s-]/g, "");
  return (
    /^(\+977)?[97][0-9]{9}$/.test(cleaned) ||
    /^[0-9]{10}$/.test(cleaned) ||
    /^0[1-9][0-9]{7,8}$/.test(cleaned)
  );
};

const isValidEmail = (value: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
};

const INVALID_ACCOUNT_PLACEHOLDERS = new Set([
  "N/A",
  "NA",
  "NONE",
  "NULL",
  "NIL",
  "UNKNOWN",
  "PENDING",
  "CASH",
  "CHEQUE",
  "NO ACCOUNT",
  "NOT AVAILABLE",
  "-",
  "--",
  "0",
  "000000",
]);

export const isValidAccountNumber = (value: string): boolean => {
  if (!value) return false;
  const trimmed = value.trim();
  if (INVALID_ACCOUNT_PLACEHOLDERS.has(trimmed.toUpperCase())) {
    return false;
  }

  // Remove common punctuation and separators like spaces, hyphens, slashes, periods
  const cleaned = trimmed.replace(/[\s\-_/.]/g, "");

  // Bank account numbers across Nepalese Commercial Banks, CBS (Pumori/Finacle/T24), and CDS exports:
  // - Typically 5 to 26 alphanumeric characters
  // - Pure numeric (e.g. "01234567890123", "20591")
  // - Branch/product alphanumeric codes (e.g. "00103911SA", "D107010002342", "005000012100U")
  // - Standard Chartered format (e.g. "10DB027786NPR003", "15SH039541NPR001")
  // - Must have at least 3 digits to distinguish from non-numeric text codes
  const isAlphanumeric = /^[a-zA-Z0-9]{5,26}$/.test(cleaned);
  const digitCount = (cleaned.match(/[0-9]/g) || []).length;

  return isAlphanumeric && digitCount >= 3;
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

  async buildContext(
    rows: any[],
    fileType?: string,
    mappings?: Record<string, string>,
  ): Promise<ValidationContext> {
    const rawBoids = rows.map((r) => extractCanonicalBoid(r, mappings)).filter(Boolean);
    const uniqueBoids = Array.from(new Set(rawBoids));

    const existingBoids = new Set<string>();
    const existingClientCodes = new Set<string>();
    const existingPans = new Set<string>();

    // Helper to safely execute a query with a strict timeout and fallback
    const isTestOrCi =
      process.env.NODE_ENV === "test" || Boolean(process.env.VITEST) || Boolean(process.env.CI);
    const defaultTimeoutMs = isTestOrCi ? 150 : 4500;
    const safeQuery = async <T>(
      promise: Promise<T>,
      fallback: T,
      ms = defaultTimeoutMs,
    ): Promise<T> => {
      let timer: any;
      const timeoutPromise = new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      });
      return Promise.race([
        promise
          .then((res) => {
            clearTimeout(timer);
            return res;
          })
          .catch((err) => {
            clearTimeout(timer);
            console.warn("Validation query fallback triggered:", err);
            return fallback;
          }),
        timeoutPromise,
      ]);
    };

    // Check a sample of up to 100 BOIDs safely without causing '414 URI Too Long' or network stalls
    if (uniqueBoids.length > 0) {
      try {
        const sampleBoids = uniqueBoids.slice(0, 100);
        const { data: clients } = await safeQuery(
          supabase.from("clients").select("boid").in("boid", sampleBoids) as any,
          { data: [] } as any,
          defaultTimeoutMs,
        );

        clients?.forEach((c: any) => {
          if (c.boid) existingBoids.add(c.boid);
        });
      } catch (err) {
        console.warn("Could not check existing BOID sample:", err);
      }
    }

    // Parallel fetch with fail-safe fallbacks and per-query timeouts
    const [companiesRes, fyRes, rulesRes] = await Promise.all([
      safeQuery(
        supabase
          .from("companies")
          .select("isin, coupon_rate, dividend_rate, id, company_type, fiscal_year") as any,
        { data: [] } as any,
        defaultTimeoutMs,
      ),
      safeQuery(
        supabase
          .from("fiscal_years")
          .select("fiscal_year")
          .eq("is_active", true)
          .maybeSingle() as any,
        { data: null } as any,
        defaultTimeoutMs,
      ),
      safeQuery(
        (supabase as any)
          .from("payable_tax_rules")
          .select("payable_category, payee_classification, tax_rate, is_active")
          .eq("is_active", true),
        { data: [] } as any,
        defaultTimeoutMs,
      ),
    ]);

    const companies = companiesRes.data || [];
    const existingISINs = new Set<string>(
      companies.map((c: any) => c.isin).filter((i: any): i is string => i !== null),
    );
    const activeCompanies = new Map<string, any>(
      companies.filter((c: any) => c.isin !== null).map((c: any) => [c.isin as string, c]),
    );

    const activeFiscalYear = fyRes.data?.fiscal_year || null;

    const systemTdsRates = { dividend: 5, interest: 6 };
    const taxRules: any[] = rulesRes.data || [];
    try {
      const ratePct = (category: string, classification: string): number | null => {
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
      console.warn("Could not parse payable_tax_rules for validation context", e);
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
    },
  ): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    if (fileHash) {
      try {
        if (await hasActiveDuplicateFileHash(fileHash)) {
          errors.push({
            row: 0,
            field: "file",
            type: "duplicate_upload",
            message: "This file has already been uploaded.",
            rawData: {},
          });
          return errors;
        }
      } catch (checkErr: any) {
        errors.push({
          row: 0,
          field: "file",
          type: "duplicate_check_error",
          message: `Unable to verify duplicate upload status: ${checkErr?.message || checkErr}. Upload blocked for safety.`,
          rawData: {},
        });
        return errors;
      }
    }

    const ctx = await this.buildContext(rows, fileType, mappings);

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

      const boid = extractCanonicalBoid(row, mappings);

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

      // Filter out completely blank rows or summary/footer rows that do not contain investor records
      const allRowValues = Object.values(row).filter(
        (v) => v !== null && v !== undefined && String(v).trim() !== "",
      );
      if (allRowValues.length === 0) {
        return; // Blank row (e.g. trailing empty lines in Excel)
      }

      const isSummaryOrFooter = allRowValues.some((v) => {
        const s = String(v).trim().toUpperCase();
        return (
          s === "TOTAL" ||
          s === "GRAND TOTAL" ||
          s === "SUMMARY" ||
          s.startsWith("TOTAL ") ||
          s.startsWith("SUMMARY ") ||
          s.includes("AUTHORISED SIGNATORY") ||
          s.includes("AUTHORIZED SIGNATORY") ||
          s.includes("PREPARED BY") ||
          s.includes("CHECKED BY") ||
          s.includes("VERIFIED BY")
        );
      });
      if (isSummaryOrFooter) {
        return; // Summary or signature footer row
      }

      // Check for genuine investor data: A row without identity and without holdings/amounts is an empty trailing row
      const hasInvestorData = Boolean(
        boid ||
        fullName ||
        clientCode ||
        bankAccount ||
        pan ||
        (sharesHeld !== null && sharesHeld > 0) ||
        (gross !== null && gross > 0) ||
        (net !== null && net > 0),
      );

      if (!hasInvestorData) {
        return; // Skip trailing non-data row
      }

      const isFolioOrPhysical =
        Boolean(
          mappings &&
          Object.entries(mappings).some(
            ([k, v]) => v === "boid" && /FOLIO|SH|SHAREHOLDER|CERTIFICATE|HOLDER/i.test(k),
          ),
        ) ||
        Boolean(
          row["FOLIO"] ||
          row["FOLIO NO"] ||
          row["FOLIO_NO"] ||
          row["SH NO"] ||
          row["SH_NO"] ||
          row["SHAREHOLDER NO"],
        );

      // RULE 1: BOID is required (Core essential)
      if (!boid) {
        errors.push({
          row: rowNum,
          field: "boid",
          type: "missing_boid",
          severity: "error",
          message: isFolioOrPhysical
            ? "Folio / Shareholder number is required for every row."
            : "BOID is required for every row.",
          rawData,
        });
      }
      // RULE 2: BOID format validation (Core essential)
      else if (!isValidBoid(boid, isFolioOrPhysical)) {
        errors.push({
          row: rowNum,
          field: "boid",
          type: "invalid_boid",
          severity: "error",
          message:
            /^130\d*$/.test(boid) && boid.length < 16
              ? `Demat BOID starting with 130 must be exactly 16 digits (found ${boid.length} digits).`
              : "BOID or Folio identifier must be valid (16-digit Demat BOID or physical Folio identifier).",
          rawData,
        });
      }
      // RULE 3: Duplicate BOID within file (Warning tier)
      else if (seenBoids.has(boid)) {
        errors.push({
          row: rowNum,
          field: "boid",
          type: "duplicate_boid_in_file",
          severity: "warning",
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

      // RULE 7: PAN/Citizenship/NID validation (Soft notice)
      const panNo = normalizeString(
        get("pan_no") || get("pan") || (pan && /^[0-9]{9}$/.test(pan) ? pan : ""),
      );
      const rawNid = normalizeString(get("nid_number") || get("nid"));
      // Auto-normalize: 10-digit numeric NID → pad to 11 (pre-2021 legacy format)
      const nidNo = rawNid ? (normalizeNID(rawNid) ?? rawNid) : rawNid;

      if (panNo && !isValidPAN(panNo)) {
        errors.push({
          row: rowNum,
          field: "pan",
          type: "invalid_pan",
          message: `PAN "${panNo}" notice (expected 9 numeric digits).`,
          rawData,
        });
      }
      if (nidNo && !isValidNID(nidNo)) {
        errors.push({
          row: rowNum,
          field: "nid_number",
          type: "invalid_nid",
          message: `NID "${nidNo}" format notice (expected 10 or 11 numeric digits; non-numeric characters found).`,
          rawData,
        });
      }
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

      // RULE 10: Numeric field validations & precision checks (Soft notice)
      if (gross !== null && (isNaN(gross) || gross < 0)) {
        errors.push({
          row: rowNum,
          field: "gross_amount",
          type: "invalid_gross",
          message: "Gross amount must be a valid non-negative number.",
          rawData,
        });
      } else if (gross !== null && !hasValidAmountPrecision(gross)) {
        errors.push({
          row: rowNum,
          field: "gross_amount",
          type: "invalid_precision",
          message: `Gross amount ${gross} has more than 2 decimal places (fractional paisa).`,
          rawData,
        });
      }

      if (tax !== null && (isNaN(tax) || tax < 0)) {
        errors.push({
          row: rowNum,
          field: "tax_amount",
          type: "invalid_tax",
          message: "Tax amount must be a valid non-negative number.",
          rawData,
        });
      } else if (tax !== null && !hasValidAmountPrecision(tax)) {
        errors.push({
          row: rowNum,
          field: "tax_amount",
          type: "invalid_precision",
          message: `Tax amount ${tax} has more than 2 decimal places (fractional paisa).`,
          rawData,
        });
      }

      if (net !== null && (isNaN(net) || net < 0)) {
        errors.push({
          row: rowNum,
          field: "net_payable",
          type: "invalid_net",
          message: "Net payable must be a valid non-negative number.",
          rawData,
        });
      } else if (net !== null && !hasValidAmountPrecision(net)) {
        errors.push({
          row: rowNum,
          field: "net_payable",
          type: "invalid_precision",
          message: `Net payable ${net} has more than 2 decimal places (fractional paisa).`,
          rawData,
        });
      }

      if (sharesHeld !== null && (isNaN(sharesHeld) || sharesHeld < 0)) {
        errors.push({
          row: rowNum,
          field: "shares_held",
          type: "invalid_shares",
          message: "Shares / Units held must be a valid non-negative number.",
          rawData,
        });
      }

      // RULE 10B: Payee classification enum validation
      const rawClassification = get("payee_classification");
      if (rawClassification) {
        const validClassifications = new Set([
          "NATURAL_PERSON",
          "PUBLIC_LEGAL_PERSON",
          "COMPANY_INSTITUTION",
          "FOREIGN_INVESTOR",
          "TAX_EXEMPT",
          "UNCLASSIFIED",
        ]);
        if (!validClassifications.has(rawClassification.toUpperCase())) {
          errors.push({
            row: rowNum,
            field: "payee_classification",
            type: "invalid_payee_classification",
            message: `Payee classification "${rawClassification}" is not a recognized classification. Expected one of NATURAL_PERSON, PUBLIC_LEGAL_PERSON, COMPANY_INSTITUTION, FOREIGN_INVESTOR, TAX_EXEMPT, UNCLASSIFIED.`,
            rawData,
          });
        }
      }

      // RULE 11: Net = Gross - Tax calculation check (Warning tier)
      if (!options?.isRawInputFile && !options?.isPreCalculated) {
        if (gross !== null && tax !== null && net !== null) {
          const expectedNet = Math.round((gross - tax) * 100) / 100;
          if (Math.abs(expectedNet - net) > RECONCILIATION_TOLERANCE_NPR) {
            errors.push({
              row: rowNum,
              field: "net_payable",
              type: "net_mismatch",
              severity: "warning",
              message: `Suspicious net payable notice: expected ${expectedNet.toFixed(2)} (gross ${gross.toFixed(2)} − tax ${tax.toFixed(2)}), sheet has ${net.toFixed(2)}.`,
              rawData,
            });
          }
        }
      }

      // RULE 12: Tax calculation check (Warning tier)
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
              severity: "warning",
              message: `Tax calculation notice: expected ${expectedTax.toFixed(2)} based on ${(tdsForTaxCheck * 100).toFixed(0)}% rate, sheet has ${tax.toFixed(2)}.`,
              rawData,
            });
          }
        }
      }

      // RULE 13: Financial fields check (Warning tier)
      if (!options?.isRawInputFile) {
        if (gross === null && net === null && sharesHeld === null && !options?.dividendRate) {
          errors.push({
            row: rowNum,
            field: "amount",
            type: "missing_financial_data",
            severity: "warning",
            message: "No financial amount or shares detected (will default to 0).",
            rawData,
          });
        }
      }

      // RULE 14: Bank account & routing checks (Warning tier)
      if (!bankAccount && ((gross !== null && gross > 0) || (net !== null && net > 0))) {
        errors.push({
          row: rowNum,
          field: "bank_account_no",
          type: "missing_bank_account",
          severity: "warning",
          message:
            "Bank account is empty for payable record (payout routing requires bank details).",
          rawData,
        });
      } else if (bankAccount && !isValidAccountNumber(bankAccount)) {
        errors.push({
          row: rowNum,
          field: "bank_account_no",
          type: "invalid_bank_account",
          severity: "warning",
          message: `Bank account "${bankAccount}" has non-standard format (expected 8-30 alphanumeric characters).`,
          rawData,
        });
      }

      if (bankAccount && !bankName) {
        errors.push({
          row: rowNum,
          field: "bank_name",
          type: "missing_bank_name",
          severity: "warning",
          message: "Bank name is empty for specified account number.",
          rawData,
        });
      }

      // RULE 15: Email check (Warning tier)
      if (email && !isValidEmail(email)) {
        errors.push({
          row: rowNum,
          field: "email",
          type: "invalid_email",
          severity: "warning",
          message: `Email "${email}" notice.`,
          rawData,
        });
      }

      // RULE 16: Address recommended (Warning tier)
      if (!address && fullName) {
        errors.push({
          row: rowNum,
          field: "address",
          type: "missing_address",
          severity: "warning",
          message: "Address recommended.",
          rawData,
        });
      }

      // RULE 17: Existing BOID in system (Warning tier)
      if (boid && ctx.existingBoids.has(boid)) {
        errors.push({
          row: rowNum,
          field: "boid",
          type: "existing_boid_across_system",
          severity: "warning",
          message: `BOID ${boid} already exists in client master (record will be updated).`,
          rawData,
        });
      }
    });

    return errors;
  },
};
