import { supabase, throwIfError } from "./database";
import { mapToHolderType } from "./investor-category";
import { calculatePayableTotals, detectPayeeCategory, getPayeeTaxRate, normalizePayeeCategory } from "./payable-summary";
import {
  getTaxRateFromRules,
  investorCategoryToClassification,
  loadTaxRules,
  type TaxRule,
} from "./tax-rules.service";

const EDGE_CHUNK_TIMEOUT_MS = 30000;

function getMissingColumnName(error: any): string | null {
  const message = error?.message || "";
  const match =
    message.match(/Could not find the '([^']+)' column/i) ||
    message.match(/column '([^']+)' of '([^']+)'/i);
  return match?.[1] ?? null;
}

/**
 * Look up real client IDs for a set of BOIDs.
 *
 * PostgREST renders `.in()` as a URL query string; a chunk of ~1000 BOIDs
 * (≈16 KB of URL) exceeds the server URL-length limit and returns "URI too
 * long" — silently yielding NO rows. That would leave the temporary UUIDs in
 * `resolvedClientIds`, and every payable insert would then fail its
 * `client_id` foreign key (the exact "Payable import completed without
 * inserting any rows." failure seen on large files). Batched lookups keep
 * each request small so even 1000-row chunks resolve reliably.
 */
const CLIENT_LOOKUP_BATCH = 300;

export interface ClientRecordMeta {
  id: string;
  boid: string;
  holder_type?: string | null;
  payee_classification?: string | null;
  payee_segment?: string | null;
  nid_number?: string | null;
  pan_no?: string | null;
  citizenship_no?: string | null;
}

async function fetchClientInfoByBoids(boids: string[]): Promise<Map<string, ClientRecordMeta>> {
  const map = new Map<string, ClientRecordMeta>();
  for (let i = 0; i < boids.length; i += CLIENT_LOOKUP_BATCH) {
    const part = boids.slice(i, i + CLIENT_LOOKUP_BATCH);
    const { data } = await (supabase as any)
      .from("clients")
      .select("id, boid, holder_type, payee_classification, payee_segment, nid_number, pan_no, citizenship_no")
      .in("boid", part);
    for (const c of data || []) {
      if (c?.boid) map.set(String(c.boid), c);
    }
  }
  return map;
}

async function fetchClientIdsByBoids(boids: string[]): Promise<Map<string, string>> {
  const infoMap = await fetchClientInfoByBoids(boids);
  const idMap = new Map<string, string>();
  for (const [boid, info] of infoMap) {
    idMap.set(boid, info.id);
  }
  return idMap;
}


function buildClientCode(row: any, boid: string): string {
  const rawBase = String(
    row.client_code ||
      row.clientCode ||
      row.client_id ||
      row.clientId ||
      row.clientNo ||
      row.client_no ||
      boid ||
      "INV",
  ).trim();
  const base = rawBase.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
  const suffix = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  return base ? `${base}-${suffix}` : `INV-${suffix}`;
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

/**
 * Smart Row-Level Investor Category Detection.
 * Reads the investor type from row data (TYPE/CATEGORY column) or falls back to the sheet name.
 *
 * How Legal Persons (companies) are identified:
 *  1. TYPE/CATEGORY/INVESTOR_TYPE column in Excel contains "INSTITUTION", "INSTIT*"
 *  2. Sheet name contains "INSTITUTION"
 *  3. Row has NO father_name/grandfather_name AND has NO citizenship number
 *     (companies don't have father names or citizenship — only individuals do)
 *
 * Note: PAN numbers are NOT used for classification because both individuals
 * and companies in Nepal have identical 9-digit numeric PANs issued by IRD.
 *
 * Returns a normalized category string.
 */
function detectInvestorCategory(row: any, sheetType?: string): string {
  return detectPayeeCategory(row, sheetType);
}

/**
 * Map investor category to the correct TDS rate.
 * Used when the row doesn't already have pre-calculated tax values.
 *
 * Debenture TDS rules:
 *   Natural Person (Public, Promoter, Local, etc.): 6%
 *   Legal Person / Company (Institution, Foreign):  15%
 *   Tax Exempt / Mutual Fund:                        0%
 *
 * Dividend TDS rules:
 *   Natural Person (Public, Promoter, Local, etc.): 5%
 *   Legal Person / Company (Institution):           5%  ← same as natural person
 *   Mutual Fund / Tax Exempt:                        0%
 */
function getCategoryTdsRate(category: string, isDebenture: boolean, isMutualFund = false, rules?: TaxRule[]): number {
  // Authoritative: centralized payable_tax_rules. Fall back to the hardcoded
  // map only when rules can't be loaded or the category is unknown.
  if (rules && rules.length) {
    const payableCategory = isMutualFund ? "MUTUAL_FUND" : isDebenture ? "INTEREST" : "DIVIDEND";
    const classification = investorCategoryToClassification(category);
    if (classification) {
      const rate = getTaxRateFromRules(rules, payableCategory, classification);
      if (rate != null) return rate;
    }
  }
  return getPayeeTaxRate(category, isDebenture, undefined, isMutualFund);
}

function payableClassification(category: string): string {
  const upper = String(category || '').trim().toUpperCase();
  if (upper === 'INSTITUTION' || upper === 'FOREIGN' || upper === 'COMPANY_INSTITUTION') return 'COMPANY_INSTITUTION';
  if (upper === 'MUTUAL_FUND' || upper === 'TAX_EXEMPT' || upper === 'TAX_EXEMPTED') return 'TAX_EXEMPT';
  if (upper === 'PUBLIC' || upper === 'NATURAL_PERSON' || upper === 'PUBLIC_LEGAL_PERSON') return 'NATURAL_PERSON';
  if (upper === 'PROMOTER' || upper === 'LOCAL') return 'NATURAL_PERSON';
  return 'UNCLASSIFIED';
}

function payableSegment(category: string): string | null {
  const upper = String(category || '').trim().toUpperCase();
  if (upper === 'PROMOTER') return 'PROMOTER';
  if (upper === 'LOCAL') return 'LOCAL';
  if (upper === 'PUBLIC') return 'PUBLIC';
  return null;
}

/**
 * Map a detected investor category to the granular holder_type enum value
 * persisted in the database. Implemented in ./investor-category so it is
 * shared with the report layer and covered by unit tests.
 *
 * Previously this collapsed Mutual Funds, Foreign investors and Legal Persons
 * into "Institution", which is why the demographics report could not tell them
 * apart. It now emits the granular values instead.
 */

async function insertRowsWithSchemaFallback(targetTable: string, rows: any[]) {
  const { error: batchError } = await (supabase.from(targetTable as any) as any).insert(
    rows as any,
  );

  if (!batchError) return rows.length;

  console.warn(`Batch ${targetTable} insert failed; retrying row by row:`, batchError.message);

  let insertedCount = 0;

  for (const row of rows) {
    let currentRow = { ...row };
    let attempts = 0;

    while (attempts < 4) {
      const { error } = await (supabase.from(targetTable as any) as any).insert(currentRow as any);
      if (!error) {
        insertedCount += 1;
        break;
      }

      const missingColumn = getMissingColumnName(error);
      if (!missingColumn || currentRow[missingColumn] === undefined) {
        console.error("Failed to insert payable row:", error.message);
        break;
      }

      delete currentRow[missingColumn];
      attempts += 1;
    }
  }

  return insertedCount;
}

export const ImportService = {
  /**
   * Invokes an Edge Function to process a chunk of Excel data in the background.
   * If the function is not deployed or fails, it falls back to direct client-side processing.
   */
  async processChunk(
    uploadId: string,
    chunkData: any[],
    targetTable: string,
    options?: {
      fiscalYear?: string;
      dividendRate?: number;
      tdsRate?: number; // Per-sheet TDS rate (0, 0.05, 0.06, 0.15, etc.) — used as fallback when no row-level category
      dividendType?: "Cash" | "Stock" | "Bonus" | "Right";
      companyId?: string; // Direct company UUID — bypasses name-based lookup
      companyName?: string;
      companyIsin?: string;
      fileHash?: string;
      sheetType?: string; // Sheet type/name for fallback category detection (e.g. 'D-PUBLIC', 'INSTITUTION')
      fileName?: string;
      fileSize?: number;
      fileType?: string;
      sheetName?: string;
      totalRows?: number;
      userId?: string;
      isPreCalculated?: boolean;
      isRawInputFile?: boolean;
    },
    sharedContext?: {
      companyId?: string;
      clientIdCache?: Map<string, string>;
      clientInfoCache?: Map<string, ClientRecordMeta>;
    },
  ) {
    // Filter out footer/total/summary rows that carry no BOID but contain
    // "TOTAL" / "SUMMARY" markers (e.g. the trailing "NAME = TOTAL" row in
    // many CDS/Excel export files). These are not investor rows and should
    // be skipped rather than counted as import errors.
    chunkData = chunkData.filter((row) => {
      if (!row || typeof row !== "object") return false;
      const boid = String(
        row.boid ||
          row.BOID ||
          row["BENEFICIARY ID"] ||
          row["CLIENT ID"] ||
          row["DP ID"] ||
          row["DPID"] ||
          row["BO ID"] ||
          row.client_code ||
          row.ClientCode ||
          "",
      ).trim();
      if (boid) return true; // has a BOID — keep it
      // No BOID: treat as a footer/summary row if a "TOTAL"/"SUMMARY" marker is present
      const allValues = Object.values(row).filter((v) => v !== null && v !== undefined);
      return !allValues.some((v) => {
        const s = String(v).trim().toUpperCase();
        return (
          s === "TOTAL" || s === "SUMMARY" || s.startsWith("TOTAL ") || s.startsWith("SUMMARY ")
        );
      });
    });

    if (options?.fileHash) {
      try {
        const duplicate = await this.checkDuplicateFile(options.fileHash, uploadId);
        if (duplicate) {
          return { success: true, skipped: chunkData.length, duplicate: true };
        }
      } catch (err: any) {
        console.warn("Duplicate-file check skipped for chunk:", err?.message || err);
      }
    }

    try {
      const edgeCall = supabase.functions.invoke("process-import-chunk", {
        body: {
          uploadId,
          chunkData,
          targetTable,
          companyName: options?.companyName,
          companyIsin: options?.companyIsin,
          fiscalYear: options?.fiscalYear,
          dividendRate: options?.dividendRate,
          tdsRate: options?.tdsRate,
          dividendType: options?.dividendType,
          sheetType: options?.sheetType,
          fileName: options?.fileName,
          fileSize: options?.fileSize,
          fileType: options?.fileType,
          sheetName: options?.sheetName,
          totalRows: options?.totalRows,
          userId: options?.userId,
        },
      });

      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Edge chunk timeout after ${EDGE_CHUNK_TIMEOUT_MS}ms`));
        }, EDGE_CHUNK_TIMEOUT_MS);
      });

      const { data, error } = (await Promise.race([edgeCall, timeout])) as {
        data: any;
        error: any;
      };
      const edgeRowsProcessed = Number(
        data?.rowsProcessed ?? data?.inserted ?? data?.clientsCreated ?? 0,
      );
      if (
        !error &&
        data &&
        data.success !== false &&
        (chunkData.length === 0 ||
          edgeRowsProcessed > 0 ||
          data.duplicate ||
          data.skipped === chunkData.length)
      ) {
        return data;
      }
      console.warn(
        "Edge function returned no usable result, falling back to batched client-side processing:",
        error?.message || data?.error || "unknown error",
      );
    } catch (err: any) {
      console.warn("Edge function invocation failed:", err?.message);
    }

    // --- BATCHED CLIENT-SIDE FALLBACK ---
    // Resolve company once per upload session and reuse it for subsequent chunks.
    let companyId = sharedContext?.companyId || options?.companyId || "";
    const detectedIsin =
      options?.companyIsin ||
      (chunkData[0]?.isin || chunkData[0]?.["ISIN NO."] || chunkData[0]?.["ISIN NO"] || chunkData[0]?.["ISIN"]
        ? String(chunkData[0]?.isin || chunkData[0]?.["ISIN NO."] || chunkData[0]?.["ISIN NO"] || chunkData[0]?.["ISIN"]).trim()
        : undefined);

    if (!companyId) {
      const cleanName = (options?.companyName || "NECO Insurance Ltd.").trim();
      
      // Generate a distinct code for new companies (e.g., "PRIM10" or "NECO")
      const words = cleanName.split(/\s+/).filter(Boolean);
      let baseCode = "";
      if (words.length >= 2) {
        baseCode = (words[0].slice(0, 3) + words[1].replace(/[^A-Za-z0-9]/g, "").slice(0, 3)).toUpperCase();
      } else {
        baseCode = cleanName.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "COMP";
      }

      // 1. If ISIN detected, try lookup by exact ISIN
      if (detectedIsin) {
        try {
          const { data: isinComp } = await (supabase as any)
            .from("companies")
            .select("id")
            .eq("isin", detectedIsin)
            .limit(1);
          if (isinComp && isinComp.length > 0) {
            companyId = isinComp[0].id;
          }
        } catch (isinErr) {
          console.warn("ISIN company lookup failed:", isinErr);
        }
      }

      // 2. Lookup by exact company_name (case-insensitive)
      if (!companyId) {
        try {
          const { data: nameComp } = await (supabase as any)
            .from("companies")
            .select("id")
            .ilike("company_name", cleanName)
            .limit(1);
          if (nameComp && nameComp.length > 0) {
            companyId = nameComp[0].id;
          }
        } catch (nameErr) {
          console.warn("Exact name company lookup failed:", nameErr);
        }
      }

      // 3. Fallback: Direct insert as a new company
      if (!companyId) {
        try {
          // Ensure company_code is unique
          let candidateCode = baseCode;
          const { data: existingCode } = await (supabase as any)
            .from("companies")
            .select("id")
            .eq("company_code", candidateCode)
            .limit(1);
          if (existingCode && existingCode.length > 0) {
            candidateCode = `${baseCode.slice(0, 4)}${Math.floor(10 + Math.random() * 90)}`;
          }

          const { data: createdComp, error: createErr } = await (supabase as any)
            .from("companies")
            .insert({
              company_name: cleanName,
              company_code: candidateCode,
              isin: detectedIsin || null,
              status: "Active",
              debenture_rate: targetTable === "interest_payables" && options?.dividendRate ? Number(options.dividendRate) : null,
              coupon_rate: targetTable === "interest_payables" && options?.dividendRate ? Number(options.dividendRate) : null,
            })
            .select("id")
            .maybeSingle();

          if (!createErr && createdComp?.id) {
            companyId = createdComp.id;
          }
        } catch (cErr) {
          console.warn("Direct company insert failed:", cErr);
        }
      }

      // 4. Fallback if insert failed
      if (!companyId) {
        const { data: companies } = await supabase.from("companies").select("id").limit(1);
        if (companies && companies.length > 0) {
          companyId = companies[0].id;
        }
      }

      if (sharedContext) {
        sharedContext.companyId = companyId;
      }
    }

    // If company exists and an ISIN was detected from the sheet, update ISIN if it is empty
    if (companyId && detectedIsin) {
      try {
        await (supabase as any)
          .from("companies")
          .update({ isin: detectedIsin })
          .eq("id", companyId)
          .is("isin", null);
      } catch (err: any) {
        console.warn("Could not update company ISIN:", err?.message);
      }
    }

    // Collect unique BOIDs and their row data
    const boidMap = new Map<string, any>();
    const rowErrors: Record<string, any>[] = [];
    for (const row of chunkData) {
      const boid = String(
        row.boid ||
          row.BOID ||
          row["BENEFICIARY ID"] ||
          row["CLIENT ID"] ||
          row["DP ID"] ||
          row["DPID"] ||
          row["BO ID"] ||
          row.client_code ||
          row.ClientCode ||
          "",
      ).trim();
      // Accept BOID lengths 6–20 (CDS IDs can be 8 or 16 digits; older records may be shorter)
      if (boid && boid.length >= 6 && boid.length <= 20) {
        if (!boidMap.has(boid)) {
          boidMap.set(boid, row);
        }
      } else {
        rowErrors.push({
          row_number: chunkData.indexOf(row) + 1,
          field_name: "boid",
          error_type: "missing_boid",
          error_message: boid
            ? `BOID "${boid}" has invalid length (${boid.length}). Expected 6–20 digits.`
            : "BOID is empty or missing.",
          raw_data: row,
        });
      }
    }
    const uniqueBoids = Array.from(boidMap.keys());

    if (uniqueBoids.length === 0)
      return { success: true, skipped: chunkData.length, errors: rowErrors };

    const missingBoids = uniqueBoids.filter((boid) => !sharedContext?.clientIdCache?.has(boid));
    const existingClientMap =
      missingBoids.length > 0 ? await fetchClientInfoByBoids(missingBoids) : new Map<string, ClientRecordMeta>();

    if (sharedContext && !sharedContext.clientInfoCache) {
      sharedContext.clientInfoCache = new Map<string, ClientRecordMeta>();
    }

    for (const [boid, clientMeta] of existingClientMap) {
      sharedContext?.clientIdCache?.set(boid, clientMeta.id);
      sharedContext?.clientInfoCache?.set(boid, clientMeta);
    }

    // Prepare new client records
    const newClientRecords: any[] = [];
    const resolvedClientIds = new Map<string, string>();

function extractRowField(row: any, keys: string[]): string {
  if (!row || typeof row !== "object") return "";
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") {
      return String(row[k]).trim();
    }
  }
  // Case-insensitive / normalized lookup
  const rowKeys = Object.keys(row);
  for (const targetKey of keys) {
    const cleanTarget = targetKey.toUpperCase().replace(/[_\s\-\.\/]/g, "");
    for (const rk of rowKeys) {
      const cleanRk = rk.toUpperCase().replace(/[_\s\-\.\/]/g, "");
      if (
        cleanRk === cleanTarget &&
        row[rk] !== undefined &&
        row[rk] !== null &&
        String(row[rk]).trim() !== ""
      ) {
        return String(row[rk]).trim();
      }
    }
  }
  return "";
}

    for (const boid of uniqueBoids) {
      const row = boidMap.get(boid);
      const nidNumber = extractRowField(row, [
        "nid_number",
        "nid",
        "NID",
        "NID_NO",
        "NID NO",
        "NID NO.",
        "NID_NUMBER",
        "NATIONAL ID",
        "NATIONAL_ID",
        "NATIONAL ID NO",
        "NATIONAL ID NUMBER",
        "RASTRIYA PARICHAYAPATRA",
        "RASTRIYA_PARICHAYAPATRA",
      ]);

      const panNo = extractRowField(row, [
        "pan_no",
        "pan",
        "PAN",
        "PAN NO",
        "PAN NO.",
        "PAN_NO",
        "PERMANENT ACCOUNT NUMBER",
        "PERMANENT_ACCOUNT_NUMBER",
      ]);

      const citizenshipNo = extractRowField(row, [
        "citizenship_no",
        "citizenship",
        "CITIZENSHIP",
        "CITIZENSHIP NO",
        "CITIZENSHIP NO.",
        "CITIZENSHIP_NO",
        "CITIZENSHIP NUMBER",
        "NAGARIKTA NO",
        "NAGARIKTA_NO",
        "NAGARIKTA",
      ]);

      const cachedClientId = sharedContext?.clientIdCache?.get(boid);
      if (cachedClientId) {
        resolvedClientIds.set(boid, cachedClientId);
      } else if (existingClientMap.has(boid)) {
        const clientMeta = existingClientMap.get(boid)!;
        sharedContext?.clientIdCache?.set(boid, clientMeta.id);
        sharedContext?.clientInfoCache?.set(boid, clientMeta);
        resolvedClientIds.set(boid, clientMeta.id);

        // If existing client lacks NID, PAN, or Citizenship and this sheet provides it, queue update
        const needsNidUpdate = nidNumber && !clientMeta.nid_number;
        const needsPanUpdate = panNo && !clientMeta.pan_no;
        const needsCtzUpdate = citizenshipNo && !clientMeta.citizenship_no;

        if (needsNidUpdate || needsPanUpdate || needsCtzUpdate) {
          newClientRecords.push({
            id: clientMeta.id,
            boid: boid,
            nid_number: nidNumber || clientMeta.nid_number || null,
            pan_no: panNo || clientMeta.pan_no || null,
            citizenship_no: citizenshipNo || clientMeta.citizenship_no || null,
            pan_or_citizenship: panNo || citizenshipNo || null,
            client_code: buildClientCode(row, boid),
            full_name: extractRowField(row, ["full_name", "name", "NAME", "SHAREHOLDER NAME"]) || "Existing Investor",
          });
          if (needsNidUpdate) clientMeta.nid_number = nidNumber;
          if (needsPanUpdate) clientMeta.pan_no = panNo;
          if (needsCtzUpdate) clientMeta.citizenship_no = citizenshipNo;
        }
      } else {
        const tempId = crypto.randomUUID();
        sharedContext?.clientIdCache?.set(boid, tempId);
        resolvedClientIds.set(boid, tempId);
        // Smart categorization: detect investor type from row data or sheet name
        const investorCategory = detectInvestorCategory(row, options?.sheetType);
        const holderType = mapToHolderType(investorCategory);

        const fullName =
          extractRowField(row, [
            "full_name",
            "name",
            "NAME",
            "SHAREHOLDER NAME",
            "HOLDER NAME",
            "UNIT HOLDER NAME",
            "DEBENTURE HOLDER",
            "INVESTOR NAME",
            "ACCOUNT HOLDER",
            "APPLICANT_NAME",
            "ApplicantName",
          ]) || "Unknown Investor";

        const dob = extractRowField(row, [
          "date_of_birth",
          "dob",
          "DATE OF BIRTH",
          "DATE_OF_BIRTH",
          "BIRTH DATE",
          "BIRTH_DATE",
          "D.O.B",
          "D.O.B.",
          "DOB (BS)",
          "DOB (AD)",
          "BIRTHDATE",
          "DATE_OF_BIRTH_BS",
          "DATE_OF_BIRTH_AD",
        ]);

        const bankName = extractRowField(row, [
          "bank_name",
          "bank",
          "BANK NAME",
          "BANK",
          "NAME OF BANK",
          "BANK/FINANCIAL INSTITUTION",
          "BANK / FINANCIAL INSTITUTION",
          "BANK DETAILS",
          "BANK_TITLE",
        ]);

        let bankBranch = extractRowField(row, [
          "bank_branch",
          "branch",
          "BANK BRANCH",
          "BRANCH NAME",
          "BRANCH",
          "BANK_BRANCH",
          "BANK BRANCH NAME",
          "BRANCH ",
          "CREDITOR BRANCH",
          "CREDITORBRANCH",
          "BRANCH_TITLE",
        ]);

        // Auto-extract branch from combined Bank Name (e.g. "Prime Commercial Bank Ltd.-New Road Branch")
        if (!bankBranch && bankName) {
          if (bankName.includes(" - ") || bankName.includes(".-") || (bankName.includes("-") && bankName.toLowerCase().includes("branch"))) {
            const parts = bankName.split(/-\s*|\.-\s*/);
            if (parts.length > 1 && parts[parts.length - 1].toLowerCase().includes("branch")) {
              bankBranch = parts[parts.length - 1].trim();
            }
          }
        }

        const bankAccountNo = extractRowField(row, [
          "bank_account_no",
          "bank_account",
          "account_number",
          "account_no",
          "acc_no",
          "ac_no",
          "BANK A/C NO.",
          "BANK A/C NO",
          "BANK ACCOUNT NO",
          "BANK ACCOUNT NO.",
          "ACCOUNT NUMBER",
          "ACCOUNT NO",
          "A/C NO",
          "A/C NO.",
          "ACC NO",
          "ACC NO.",
          "BANK ACC NO",
          "BANK ACC NO.",
          "BANK A/C NUMBER",
          "BANK ACCOUNT NUMBER",
        ]);

        const rawAccountType = extractRowField(row, [
          "account_type",
          "ACCOUNT TYPE",
          "A/C TYPE",
          "ACC TYPE",
          "A/C_TYPE",
          "AC_TYPE",
          "ACCOUNT_TYPE",
          "ACC_TYPE",
          "SCHEME_TYPE",
          "TYPE OF ACCOUNT",
          "ACCOUNT_TITLE",
        ]);

        let accountType = rawAccountType || null;
        if (rawAccountType) {
          const upperAcc = rawAccountType.toUpperCase().trim();
          if (upperAcc === "01" || upperAcc === "SB" || upperAcc.includes("SAVING")) accountType = "Savings";
          else if (upperAcc === "02" || upperAcc === "CA" || upperAcc.includes("CURRENT")) accountType = "Current";
          else if (upperAcc === "03" || upperAcc.includes("CALL")) accountType = "Call";
        }

        const panNo = extractRowField(row, [
          "pan_no",
          "pan",
          "PAN",
          "PAN NO",
          "PAN NO.",
          "PAN_NO",
          "PERMANENT ACCOUNT NUMBER",
          "PERMANENT_ACCOUNT_NUMBER",
        ]);

        const citizenshipNo = extractRowField(row, [
          "citizenship_no",
          "citizenship",
          "CITIZENSHIP",
          "CITIZENSHIP NO",
          "CITIZENSHIP NO.",
          "CITIZENSHIP_NO",
          "CITIZENSHIP NUMBER",
          "NAGARIKTA NO",
          "NAGARIKTA_NO",
          "NAGARIKTA",
        ]);

        const panOrCitizenship = panNo || citizenshipNo || extractRowField(row, [
          "pan_or_citizenship",
          "REGISTRATION NO",
          "COMPANY REG NO",
        ]);

        const nidNumber = extractRowField(row, [
          "nid_number",
          "nid",
          "NID",
          "NID_NO",
          "NID NO",
          "NID NO.",
          "NID_NUMBER",
          "NATIONAL ID",
          "NATIONAL_ID",
          "NATIONAL ID NO",
          "NATIONAL ID NUMBER",
          "RASTRIYA PARICHAYAPATRA",
          "RASTRIYA_PARICHAYAPATRA",
        ]);

        const fatherName = extractRowField(row, [
          "father_name",
          "fatherName",
          "FATHER'S NAME",
          "FATHERS NAME",
          "FATHER_NAME",
          "FATHER NAME",
          "FATHER",
        ]);

        const grandfatherName = extractRowField(row, [
          "grandfather_name",
          "grandfatherName",
          "GRANDFATHER'S NAME",
          "GRANDFATHERS NAME",
          "GRANDFATHER_NAME",
          "GRANDFATHER NAME",
          "GRAND FATHER NAME",
          "GRAND FATHER'S NAME",
        ]);

        const rawGender = extractRowField(row, ["gender", "GENDER", "SEX", "M/F", "GENDER (M/F)", "GENDER(M/F)"]);
        let gender: string | null = null;
        if (rawGender) {
          const upperGen = rawGender.toUpperCase().trim();
          if (upperGen === "M" || upperGen === "MALE" || upperGen === "M." || upperGen.startsWith("M /") || upperGen === "PURUSH") {
            gender = "Male";
          } else if (upperGen === "F" || upperGen === "FEMALE" || upperGen === "F." || upperGen.startsWith("F /") || upperGen === "MAHILA") {
            gender = "Female";
          } else if (upperGen === "O" || upperGen === "OTHER" || upperGen === "OTHERS" || upperGen === "T" || upperGen === "THIRD" || upperGen === "ENTITY") {
            gender = "Other";
          } else {
            gender = rawGender.trim();
          }
        }

        const occupation = extractRowField(row, [
          "occupation",
          "OCCUPATION",
          "PROFESSION",
          "OCCUPATION / PROFESSION",
          "OCCUPATION/PROFESSION",
          "DESIGNATION",
        ]);
        const address = extractRowField(row, [
          "address",
          "ADDRESS",
          "FULL ADDRESS",
          "PERMANENT ADDRESS",
          "LOCATION",
        ]);
        const province = extractRowField(row, ["province", "PROVINCE", "STATE", "PROVINCE NO"]);
        const district = extractRowField(row, ["district", "DISTRICT"]);
        const municipality = extractRowField(row, [
          "municipality",
          "MUNICIPALITY",
          "VDC",
          "MUNICIPALITY / VDC",
          "LOCAL BODY",
        ]);
        const phone = extractRowField(row, [
          "phone",
          "mobile",
          "contact",
          "PHONE",
          "MOBILE",
          "CONTACT",
          "MOBILE NO",
          "PHONE NO",
          "CONTACT NO",
          "MOBILE NUMBER",
          "PHONE NUMBER",
        ]);
        const email = extractRowField(row, [
          "email",
          "EMAIL",
          "EMAIL ADDRESS",
          "E-MAIL",
          "E-MAIL ADDRESS",
          "EMAIL ID",
        ]);
        const clientId = extractRowField(row, [
          "client_id",
          "clientId",
          "CLIENT ID",
          "CLIENT NO",
          "MEMBER ID",
        ]);

        newClientRecords.push({
          id: tempId,
          boid,
          company_id: companyId,
          full_name: fullName,
          client_code: buildClientCode(row, boid),
          client_id: clientId || null,
          father_name: fatherName || null,
          grandfather_name: grandfatherName || null,
          pan_no: panNo || null,
          citizenship_no: citizenshipNo || null,
          pan_or_citizenship: panOrCitizenship || null,
          nid_number: nidNumber || null,
          date_of_birth: dob || null,
          gender: gender || null,
          occupation: occupation || null,
          address: address || null,
          province: province || null,
          district: district || null,
          municipality: municipality || null,
          phone: phone || null,
          email: email || null,
          bank_name: bankName || null,
          bank_branch: bankBranch || null,
          bank_account_no: bankAccountNo || null,
          account_type: accountType || null,
          holder_type: holderType,
          payee_classification: payableClassification(investorCategory),
          payee_segment: payableSegment(investorCategory),
          classification_status: investorCategory === "UNKNOWN" ? "REVIEW_REQUIRED" : "AUTO_CLASSIFIED",
          classification_source: investorCategory === "UNKNOWN" ? "upload_requires_review" : "upload_evidence",
          status: "Active",
          verification_status: "Verified",
        });
      }
    }

    // Batch insert new clients using SECURITY DEFINER RPC with direct fallback
    let clientsInserted = 0;
    if (newClientRecords.length > 0) {
      try {
        const { data: rpcResult, error: rpcErr } = await (supabase as any).rpc(
          "bulk_insert_clients",
          { p_clients: newClientRecords },
        );
        if (rpcErr) {
          console.warn("bulk_insert_clients RPC failed, falling back to direct upserts:", rpcErr.message);
        } else {
          if (rpcResult?.errors && rpcResult.errors.length > 0) {
            console.warn("Some client inserts reported RPC errors:", rpcResult.errors);
          }
          clientsInserted = Number(rpcResult?.inserted ?? 0);
        }
      } catch (rpcEx: any) {
        console.warn("bulk_insert_clients RPC exception, falling back to direct upserts:", rpcEx?.message);
      }

      // Direct fallback if RPC inserted 0 or failed
      if (clientsInserted === 0) {
        for (const clientRec of newClientRecords) {
          try {
            const { error: insErr } = await (supabase as any)
              .from("clients")
              .upsert(clientRec, { onConflict: "boid" });
            if (!insErr) {
              clientsInserted++;
            } else {
              // Strip dynamic columns if table doesn't have them
              const baseClient = {
                id: clientRec.id,
                boid: clientRec.boid,
                company_id: clientRec.company_id || null,
                full_name: clientRec.full_name,
                client_code: clientRec.client_code,
                father_name: clientRec.father_name,
                grandfather_name: clientRec.grandfather_name,
                pan_or_citizenship: clientRec.pan_or_citizenship,
                address: clientRec.address,
                district: clientRec.district,
                phone: clientRec.phone,
                bank_name: clientRec.bank_name,
                bank_account_no: clientRec.bank_account_no,
                holder_type: clientRec.holder_type,
                payee_classification: clientRec.payee_classification,
                payee_segment: clientRec.payee_segment,
                status: clientRec.status,
                verification_status: clientRec.verification_status,
              };
              const { error: insErr2 } = await (supabase as any)
                .from("clients")
                .upsert(baseClient, { onConflict: "boid" });
              if (!insErr2) clientsInserted++;
            }
          } catch (cEx) {
            console.warn("Direct client upsert error:", cEx);
          }
        }
      }

      // CRITICAL: Re-fetch actual client IDs and metadata from the database.
      const newBoids = newClientRecords.map((c) => c.boid);
      const actualClientInfo = await fetchClientInfoByBoids(newBoids);
      for (const [boid, info] of actualClientInfo) {
        resolvedClientIds.set(boid, info.id);
        sharedContext?.clientIdCache?.set(boid, info.id);
        sharedContext?.clientInfoCache?.set(boid, info);
      }

      let unconfirmedCount = 0;
      for (const boid of newBoids) {
        if (!actualClientInfo.has(boid)) {
          resolvedClientIds.delete(boid);
          sharedContext?.clientIdCache?.delete(boid);
          sharedContext?.clientInfoCache?.delete(boid);
          unconfirmedCount++;
        }
      }
      if (unconfirmedCount > 0) {
        console.warn(`Warning: ${unconfirmedCount}/${newBoids.length} newly inserted BOIDs could not be confirmed in DB.`);
      }
    }

    // Prepare batch payables with auto-calculation fallback
    const payablesToInsert: any[] = [];
    const isDebenture = targetTable === "interest_payables";

    const taxRules: TaxRule[] | undefined = await loadTaxRules().catch(() => undefined);

    for (const row of chunkData) {
      const boid = String(
        row.boid ||
          row.BOID ||
          row["BENEFICIARY ID"] ||
          row["CLIENT ID"] ||
          row["DP ID"] ||
          row["DPID"] ||
          row["BO ID"] ||
          row.client_code ||
          row.ClientCode ||
          "",
      ).trim();
      if (!boid || boid.length < 6) continue;
      const clientId = resolvedClientIds.get(boid);
      if (!clientId) {
        rowErrors.push({
          row_number: chunkData.indexOf(row) + 1,
          field_name: "client",
          error_type: "client_not_found",
          error_message: `Client could not be created/resolved for BOID ${boid}.`,
          raw_data: row,
        });
        continue;
      }

      const sharesHeld = Number(
        row.shares_held ||
          row.kitta ||
          row.KITTA ||
          row["TOTA KITTA"] ||
          row.alloted_quantity ||
          row.ALLOTED_QUANTITY ||
          row["UNITS HELD"] ||
          row["UNIT HELD"] ||
          row["UNITS"] ||
          row["NO OF UNITS"] ||
          row["DEBENTURE UNITS"] ||
          row["FACE VALUE UNITS"] ||
          0,
      );
      const rawGross = Number(
        row.gross_amount ||
          row.amount ||
          row.AMOUNT ||
          row.payable_amount ||
          row.cash_dividend ||
          row["INTEREST AMOUNT"] ||
          row["GROSS INTEREST"] ||
          row["GROSS AMOUNT"] ||
          row["DISTRIBUTION AMOUNT"] ||
          row["INT AMOUNT"] ||
          row["COUPON AMOUNT"] ||
          0,
      );
      const rawTax = Number(
        row.tax_amount ||
          row.tax ||
          row.TAX ||
          row.bon_tax ||
          row.div_tax ||
          row["TDS"] ||
          row["TDS AMOUNT"] ||
          row["WITHHOLDING TAX"] ||
          row["TAX DEDUCTED"] ||
          0,
      );
      const rawNet = Number(
        row.net_payable ||
          row.net ||
          row.NET ||
          row.ROUNDUP ||
          row.ROUND_UP_DIV ||
          row["NET INT"] ||
          row["NET AMOUNT"] ||
          row["NET INTEREST"] ||
          row["NET DISTRIBUTION"] ||
          0,
      );
      const bankName = extractRowField(row, [
        "bank_name",
        "bankName",
        "bank",
        "BANK",
        "BANK NAME",
        "NAME OF BANK",
        "BANK/FINANCIAL INSTITUTION",
        "BANK DETAILS",
      ]);
      const bankAccountNo = extractRowField(row, [
        "bank_account_no",
        "bank_account",
        "bankAccount",
        "account_number",
        "account_no",
        "acc_no",
        "ac_no",
        "BANK A/C NO.",
        "BANK A/C NO",
        "BANK ACCOUNT NO",
        "BANK ACCOUNT NO.",
        "ACCOUNT NUMBER",
        "ACCOUNT NO",
        "A/C NO",
        "ACC NO",
        "BANK ACC NO",
        "BANK ACC NO.",
        "BANK A/C NUMBER",
      ]);
      let bankBranch = extractRowField(row, [
        "bank_branch",
        "branch",
        "BANK BRANCH",
        "BRANCH NAME",
        "BRANCH",
        "BANK_BRANCH",
        "BANK BRANCH NAME",
        "BRANCH ",
        "CREDITOR BRANCH",
        "CREDITORBRANCH",
        "BRANCH_TITLE",
      ]);

      if (!bankBranch && bankName) {
        if (bankName.includes(" - ") || bankName.includes(".-") || (bankName.includes("-") && bankName.toLowerCase().includes("branch"))) {
          const parts = bankName.split(/-\s*|\.-\s*/);
          if (parts.length > 1 && parts[parts.length - 1].toLowerCase().includes("branch")) {
            bankBranch = parts[parts.length - 1].trim();
          }
        }
      }
      const lotName = extractRowField(row, ["lot_name", "lot", "LOT", "LOT NAME"]);
      const status = extractRowField(row, ["status", "STATUS"]) || "Pending";

      let investorCategory = detectInvestorCategory(row, options?.sheetType);
      if (investorCategory === "UNKNOWN") {
        const cachedClient = sharedContext?.clientInfoCache?.get(boid);
        if (cachedClient) {
          if (cachedClient.payee_classification && cachedClient.payee_classification !== "UNCLASSIFIED") {
            investorCategory = cachedClient.payee_classification;
          } else if (cachedClient.holder_type) {
            investorCategory = normalizePayeeCategory(cachedClient.holder_type);
          }
        }
      }

      const rowTdsRate =
        options?.tdsRate !== undefined
          ? options.tdsRate
          : getCategoryTdsRate(investorCategory, isDebenture, targetTable === 'mutual_fund_payables', taxRules);

      let grossAmount = rawGross;
      let taxAmount = rawTax;
      let netPayable = rawNet;

      if (targetTable === "dividend_payables" || targetTable === "mutual_fund_payables") {
        if (!options?.isPreCalculated) {
          if (!grossAmount && sharesHeld && options?.dividendRate) {
            grossAmount = Math.round(sharesHeld * options.dividendRate * 100) / 100;
          }
          if (!taxAmount && grossAmount && rowTdsRate > 0) {
            taxAmount = Math.round(grossAmount * rowTdsRate * 100) / 100;
          }
          if (!netPayable && grossAmount) {
            netPayable = Math.round((grossAmount - taxAmount) * 100) / 100;
          }
          if (!grossAmount) grossAmount = netPayable || 0;
          if (!netPayable) netPayable = Math.round((grossAmount - taxAmount) * 100) / 100;
        }

        const totals = options?.isPreCalculated && rawGross > 0 ? 
          { grossAmount: rawGross, taxAmount: rawTax, netPayable: rawNet, taxRate: rowTdsRate, category: investorCategory } :
          calculatePayableTotals({
            grossAmount,
            taxAmount,
            category: investorCategory,
            isDebenture: false,
            isMutualFund: targetTable === 'mutual_fund_payables',
            customTaxRate: options?.tdsRate,
          });

        payablesToInsert.push({
          upload_id: uploadId,
          company_id: companyId,
          client_id: clientId,
          gross_dividend: totals.grossAmount,
          tax_amount: totals.taxAmount,
          net_payable: totals.netPayable,
          shares_held: sharesHeld,
          dividend_rate: options?.dividendRate ?? null,
          tds_rate: totals.taxRate,
          dividend_type: options?.dividendType || "Cash",
          fiscal_year: options?.fiscalYear ?? null,
          bonus_actual: Number(row.bonus_actual || 0) || null,
          bonus_issued: Number(row.bonus_issued || 0) || null,
          bonus_fraction: Number(row.bonus_fraction || 0) || null,
          after_bonus_kitta: Number(row.after_bonus_kitta || 0) || null,
          bonus_tax: Number(row.bon_tax || 0) || null,
          bank_name: bankName || null,
          bank_account_no: bankAccountNo || null,
          lot_name: lotName || null,
          payment_status: status === "SUCCESS" ? "Paid" : "Pending",
          payee_classification: payableClassification(investorCategory),
          payee_segment: payableSegment(investorCategory),
          classification_status: investorCategory === "UNKNOWN" ? "REVIEW_REQUIRED" : "AUTO_CLASSIFIED",
        });
      } else if (targetTable === "interest_payables") {
        if (!options?.isPreCalculated) {
          if (!grossAmount && sharesHeld && options?.dividendRate) {
            const multiplier = options.dividendRate <= 20 ? 10 : 1;
            grossAmount = Math.round(sharesHeld * (options.dividendRate * multiplier) * 100) / 100;
          }
          if (!taxAmount && grossAmount && rowTdsRate > 0) {
            taxAmount = Math.round(grossAmount * rowTdsRate * 100) / 100;
          }
          if (!netPayable && grossAmount) {
            netPayable = Math.round((grossAmount - taxAmount) * 100) / 100;
          }
          if (!grossAmount) grossAmount = netPayable || 0;
          if (!netPayable) netPayable = Math.round((grossAmount - taxAmount) * 100) / 100;
        }

        const totals = options?.isPreCalculated && rawGross > 0 ? 
          { grossAmount: rawGross, taxAmount: rawTax, netPayable: rawNet, taxRate: rowTdsRate, category: investorCategory } :
          calculatePayableTotals({
            grossAmount,
            taxAmount,
            category: investorCategory,
            isDebenture: true,
            customTaxRate: options?.tdsRate,
          });

        payablesToInsert.push({
          upload_id: uploadId,
          company_id: companyId,
          client_id: clientId,
          gross_interest: totals.grossAmount,
          tax_amount: totals.taxAmount,
          net_payable: totals.netPayable,
          tds_rate: totals.taxRate,
          due_date: new Date().toISOString().split("T")[0],
          fiscal_year: options?.fiscalYear ?? null,
          bank_name: bankName || null,
          bank_account_no: bankAccountNo || null,
          bank_branch: bankBranch || null,
          lot_name: lotName || null,
          payment_status: status === "SUCCESS" ? "Paid" : "Pending",
          payee_classification: payableClassification(investorCategory),
          payee_segment: payableSegment(investorCategory),
          classification_status: investorCategory === "UNKNOWN" ? "REVIEW_REQUIRED" : "AUTO_CLASSIFIED",
        });
      }
    }

    // Batch insert payables with RPC and direct fallback
    let payablesInserted = 0;
    if (payablesToInsert.length > 0) {
      const rpcName =
        targetTable === "interest_payables"
          ? "bulk_insert_interest_payables"
          : targetTable === "mutual_fund_payables"
            ? "bulk_insert_mutual_fund_payables"
            : "bulk_insert_dividend_payables";

      try {
        const { data: rpcResult, error: rpcErr } = await (supabase as any).rpc(rpcName, {
          p_payables: payablesToInsert,
        });

        if (!rpcErr && rpcResult) {
          payablesInserted = Number(rpcResult?.inserted ?? 0);
          const rpcErrors = Array.isArray(rpcResult?.errors) ? rpcResult.errors : [];
          if (rpcErrors.length > 0) {
            console.warn("Some payable inserts reported RPC errors:", rpcErrors);
            const clientIdToBoid = new Map<string, string>();
            for (const [boid, cid] of resolvedClientIds) clientIdToBoid.set(cid, boid);
            const boidToRowNum = new Map<string, number>();
            chunkData.forEach((row, idx) => {
              const b = String(
                row.boid || row.BOID || row["BENEFICIARY ID"] || row["CLIENT ID"] || row.client_code || row.ClientCode || "",
              ).trim();
              if (b && !boidToRowNum.has(b)) boidToRowNum.set(b, idx + 1);
            });

            for (const e of rpcErrors) {
              const cid = String(e?.client_id ?? "");
              const boid = clientIdToBoid.get(cid);
              const rowNum = boid ? boidToRowNum.get(boid) : undefined;
              rowErrors.push({
                row_number: rowNum ?? 0,
                field_name: "payable",
                error_type: "payable_rpc",
                error_message: String(e?.error || "Payable insert failed (see SQL error)."),
                raw_data: boid && rowNum ? chunkData[rowNum - 1] : undefined,
              });
            }
          }
        } else if (rpcErr) {
          console.warn(`${rpcName} RPC failed, attempting direct table insert fallback:`, rpcErr.message);
        }
      } catch (rpcEx: any) {
        console.warn(`${rpcName} RPC exception, attempting direct table insert fallback:`, rpcEx?.message);
      }

      // Direct fallback if RPC inserted 0 rows
      if (payablesInserted === 0 && payablesToInsert.length > 0) {
        try {
          console.log(`Running direct insert fallback for ${payablesToInsert.length} ${targetTable} rows...`);
          payablesInserted = await insertRowsWithSchemaFallback(targetTable, payablesToInsert);
        } catch (fallbackEx: any) {
          console.error("Direct payable insert fallback failed:", fallbackEx);
          throw new Error("Payable insert failed: " + (fallbackEx?.message || String(fallbackEx)));
        }
      }
    }

    return {
      success: true,
      rowsProcessed: payablesInserted,
      clientsCreated: clientsInserted,
      errors: rowErrors,
    };
  },

  /**
   * Utility to check if a file has been uploaded before by its SHA256 hash.
   */
  async checkDuplicateFile(fileHash: string, currentUploadId?: string): Promise<boolean> {
    let query = (supabase as any)
      .from("upload_history")
      .select("id, target_table")
      .eq("file_hash", fileHash)
      .eq("status", "Completed"); // Only completed uploads are duplicates

    if (currentUploadId) {
      query = query.neq("id", currentUploadId);
    }

    const { data, error } = await query;

    if (error) {
      throwIfError(error, "Failed to check duplicate file");
    }

    for (const upload of data || []) {
      if (await hasActiveRowsForUpload(upload.id, upload.target_table)) {
        return true;
      }
    }

    return false;
  },
};
