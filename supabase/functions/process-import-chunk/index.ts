// Follow this setup guide to integrate with Supabase:
// https://supabase.com/docs/guides/functions

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface ChunkPayload {
  uploadId: string;
  chunkData: any[];
  targetTable: string;
  companyName?: string;
  fiscalYear?: string;
  dividendRate?: number;
  tdsRate?: number;
  dividendType?: "Cash" | "Stock" | "Bonus" | "Right";
  sheetType?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  sheetName?: string;
  totalRows?: number;
  userId?: string;
}

/**
 * Ensure the upload_history record exists before inserting payables.
 * The edge function uses the service_role key which bypasses RLS,
 * so it can create the record even when the frontend client (subject to RLS) cannot.
 */
async function ensureUploadRecord(
  supabase: any,
  uploadId: string,
  payload: ChunkPayload
): Promise<void> {
  // Check if the record already exists
  const { data: existing, error: checkErr } = await supabase
    .from("upload_history")
    .select("id")
    .eq("id", uploadId)
    .maybeSingle();

  if (checkErr) {
    console.warn("Could not check upload_history (continuing):", checkErr.message);
    return;
  }

  if (existing) return; // Record already exists

  // Create it using service_role (bypasses RLS)
  const { error: insertErr } = await supabase
    .from("upload_history")
    .insert({
      id: uploadId,
      user_id: payload.userId || null,
      file_name: payload.fileName || "import.xlsx",
      file_size: payload.fileSize || 0,
      file_type: payload.fileType || null,
      sheet_name: payload.sheetName || payload.sheetType || null,
      total_rows: payload.totalRows || payload.chunkData?.length || 0,
      success_rows: 0,
      error_rows: 0,
      target_table: payload.targetTable,
      status: "Processing",
    });

  if (insertErr) {
    console.warn("Could not create upload_history record:", insertErr.message);
  }
}

function getMissingColumnName(error: any): string | null {
  const message = error?.message || "";
  const match = message.match(/Could not find the '([^']+)' column/i) || message.match(/column '([^']+)' of '([^']+)'/i);
  return match?.[1] ?? null;
}

function buildClientCode(row: any, boid: string): string {
  const rawBase = String(row.client_code || row.clientCode || row.client_id || row.clientId || row.clientNo || row.client_no || boid || "INV").trim();
  const base = rawBase.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
  const suffix = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  return base ? `${base}-${suffix}` : `INV-${suffix}`;
}

/**
 * Smart Row-Level Investor Category Detection.
 * Reads the investor type from row data (TYPE/CATEGORY column) or falls back to the sheet name.
 *
 * How Legal Persons (companies) are identified:
 *  1. TYPE/CATEGORY/INVESTOR_TYPE column contains "INSTITUTION", "INSTIT*"
 *  2. Sheet name contains "INSTITUTION"
 *  3. Row has NO father_name/grandfather_name AND no citizenship number
 *     (companies never have father names or citizenship — only individuals do)
 *
 * Note: PAN numbers are NOT used for classification because both individuals
 * and companies in Nepal have identical 9-digit numeric PANs issued by IRD.
 */
function detectInvestorCategory(row: any, sheetType?: string): string {
  const rawType = String(
    row.investor_type || row.type || row.TYPE || row.CATEGORY || row.category ||
    row.holder_type || row.HOLDER_TYPE || row.shareholder_type || row.SHAREHOLDER_TYPE || ""
  ).trim().toUpperCase();

  if (rawType) {
    if (/MUTUAL|MF|FUND/i.test(rawType)) return "MUTUAL_FUND";
    if (/TAX.?EXEMPT|EXEMPT/i.test(rawType)) return "TAX_EXEMPT";
    if (/PROMOT/i.test(rawType)) return "PROMOTER";
    if (/INSTIT/i.test(rawType)) return "INSTITUTION";
    if (/LOCAL/i.test(rawType)) return "LOCAL";
    if (/PUBLIC|GENERAL|INDIVIDUAL/i.test(rawType)) return "PUBLIC";
    if (/FOREIGN|NRN/i.test(rawType)) return "FOREIGN";
    // D-PUBLIC, P-PUBLIC patterns from CDS files
    if (/D-PUBLIC|P-PUBLIC/.test(rawType)) return "PUBLIC";
    // D-PROMOTER pattern
    if (/D-PROMOT/.test(rawType)) return "PROMOTER";
  }

  // 1. Natural Person indicators MUST take precedence over name heuristics.
  // Humans have father/grandfather names or citizenship; companies & mutual funds NEVER do.
  const fatherName = String(
    row.father_name || row.fatherName || row.FATHER_NAME || row["FATHER'S NAME"] || ""
  ).trim();
  const grandfatherName = String(
    row.grandfather_name || row.grandfatherName || row.GRANDFATHER_NAME || row["GRANDFATHER'S NAME"] || ""
  ).trim();
  const citizenship = String(row.citizenship || row.CITIZENSHIP || row.citizenship_no || row.CITIZENSHIP_NO || "").trim();

  if (fatherName || grandfatherName) {
    return "PUBLIC";
  }
  if (citizenship && /[-a-zA-Z0-9]/.test(citizenship)) {
    return "PUBLIC";
  }

  const legalPersonName = String(
    row.full_name || row.fullName || row.name || row.NAME || row.client_name || row.clientName ||
    row.company_name || row.companyName || row.company || ""
  ).trim();

  // 2. Corporate suffixes & Partnerships
  const isCorporateSuffix = /(PVT\.?\s*LTD|PRIVATE\s*LIMITED|P\.?\s*LTD|\bLIMITED\b|\bLTD\.?\b|\bCOMPANY\b|\bCORP\b|CORPORATION|\bINC\.?\b|\bLLC\b|\bPLC\b|\bPARTNERS\b|\bPARTNERSHIP\b)/i.test(legalPersonName);
  const isMutualFundScheme = /(MUTUAL\s*FUND|\bMF\b|FOCUS\s*(40|30|25|\d+)|SELECT\s*(30|40|\d+)|SUPER\s*(30|40|\d+)|\bNMB\s*(50|HYBRID|SARAL|SULAV|SAMRIDDHI)|\b50\b|SAMRIDDHI\s*FUND|SAMUNNAT\s*SCHEME|PRAGATI\s*FUND|SAHABHAGITA\s*FUND|DHANABRIDDHI\s*YOJANA|SABAL\s*FUND|UNNATI\s*FUND|SARAL\s*(BACHAT|FUND)|SHUBHA\s*LAXMI\s*KOSH|EQUITY\s*(FUND|SCHEME|ORIENTED)|GROWTH\s*(FUND|SCHEME)|BALANCED\s*(FUND|SCHEME)|BLUECHIP\s*(FUND|SCHEME)|LARGE\s*CAP(\s*FUND)?|FLEXI\s*CAP(\s*FUND)?|VALUE\s*FUND|DEBT\s*FUND|FIXED\s*INCOME|DYNAMIC\s*DEBT(\s*FUND)?|SYSTEMATIC\s*INVESTMENT|DIVIDEND\s*YIELD\s*FUND|MONEY\s*MARKET\s*FUND|INDEX\s*FUND|CWEDA\s*EQUITY\s*FUND|STABLE\s*FUND|RESOURCE\s*FUND|HYBRID\s*FUND|SMART\s*FUND|\bYOJANA\b|\bSSIS\b)/i.test(legalPersonName);

  if (isCorporateSuffix && !isMutualFundScheme) {
    return "INSTITUTION";
  }

  // 3. Tax Exempted / Mutual Fund detection from compound institutional name
  if (fatherName || grandfatherName || (citizenship && /[-a-zA-Z0-9]/.test(citizenship))) {
    return "PUBLIC";
  }

  // 1. Tax Exempt Funds (Mutual funds & Statutory Social Funds)
  if (
    /\b(MUTUAL\s*FUND|MF|FOCUS\s*(40|30|\d+)|SELECT\s*(30|40|\d+)|SUPER\s*(30|40|\d+)|NMB\s*(50|HYBRID|SARAL)|\b50\b|SAMRIDDHI\s*FUND|DHANABRIDDHI|EQUITY\s*FUND|DYNAMIC\s*DEBT|LARGE\s*CAP|CITIZEN\s*INVESTMENT\s*TRUST|\bCIT\b|KARMACHARI\s*SANCHAYA\s*KOSH|\bEPF\b|SOCIAL\s*SECURITY\s*FUND|\bSSF\b)\b/i.test(
      name
    ) ||
    /MUTUAL|MF\b|TAX.?EXEMPT/i.test(explicitType)
  ) {
    return 'TAX_EXEMPT';
  }

  // 2. Corporate Suffixes & Partnerships
  if (
    /\b(PVT\.?\s*LTD|PRIVATE\s*LIMITED|P\.?\s*LTD|LIMITED|LTD\.?|COMPANY|CORP|CORPORATION|INC\.?|LLC|PLC|PARTNERS|PARTNERSHIP|HOLDINGS\s*COMPANY)\b/i.test(
      name
    )
  ) {
    return 'COMPANY_INSTITUTION';
  }

  // 3. Institutional Organizations (including Army Welfare & Police Welfare trusts)
  if (
    /\b(BANK|FINANCE|MICROFINANCE|LAGHUBITTA|BITTIYA|BIMA|BEEMA|INSURANCE|REINSURANCE|HYDROPOWER|DOORSANCHAR|TELECOM|CLEARING\s*HOUSE|STOCK\s*EXCHANGE|CDS|COOPERATIVE|SAHAKARI|ENTERPRISES|TRADING|TRADERS|SECURITIES|BROKER|ARMY\s*WELFARE|SAINIK\s*KALYAN|POLICE\s*WELFARE|PRAHARI\s*KALYAN)\b/i.test(
      name
    ) ||
    /LEGAL|INSTIT|COMPANY|CORPORAT/i.test(explicitType)
  ) {
    return 'COMPANY_INSTITUTION';
  }

  // 5. Sheet Type
  if (sheetType) {
    const upper = sheetType.toUpperCase();
    if (upper.includes("MUTUAL") || upper.includes("MF")) return "MUTUAL_FUND";
    if (upper.includes("TAX") && upper.includes("EXEMPT")) return "TAX_EXEMPT";
    if (upper.includes("PROMOT")) return "PROMOTER";
    if (upper.includes("INSTIT")) return "INSTITUTION";
    if (upper.includes("LOCAL")) return "LOCAL";
    if (upper.includes("PUBLIC")) return "PUBLIC";
  }

  return "UNKNOWN";
}

function payableClassification(category: string): string {
  const upper = String(category || "").trim().toUpperCase();
  if (upper === "INSTITUTION" || upper === "FOREIGN" || upper === "COMPANY_INSTITUTION") return "COMPANY_INSTITUTION";
  if (upper === "MUTUAL_FUND" || upper === "TAX_EXEMPT" || upper === "TAX_EXEMPTED") return "TAX_EXEMPT";
  if (upper === "PUBLIC" || upper === "NATURAL_PERSON" || upper === "PUBLIC_LEGAL_PERSON") return "NATURAL_PERSON";
  if (upper === "PROMOTER" || upper === "LOCAL") return "NATURAL_PERSON";
  return "UNCLASSIFIED";
}

function payableSegment(category: string): string | null {
  const upper = String(category || "").trim().toUpperCase();
  if (upper === "PROMOTER") return "PROMOTER";
  if (upper === "LOCAL") return "LOCAL";
  if (upper === "PUBLIC") return "PUBLIC";
  return null;
}

/**
 * Debenture TDS rules:
 *   Natural Person (Public, Promoter, Local): 6%
 *   Legal Person / Company (Institution, Foreign): 15%
 *   Tax Exempt / Mutual Fund: 0%
 *
 * Dividend TDS rules:
 *   Natural Person (Public, Promoter, Local): 5%
 *   Legal Person / Company (Institution): 5%  ← same as natural person for dividend
 *   Mutual Fund / Tax Exempt: 0%
 */
function getCategoryTdsRate(category: string, isDebenture: boolean): number {
  switch (category) {
    case "PROMOTER": return isDebenture ? 0.06 : 0.05;
    case "PUBLIC": return isDebenture ? 0.06 : 0.05;
    case "LOCAL": return isDebenture ? 0.06 : 0.05;
    case "INSTITUTION": return isDebenture ? 0.15 : 0.05; // 15% for debenture, 5% for dividend
    case "FOREIGN": return isDebenture ? 0.15 : 0.05;    // Foreign same as institution
    case "MUTUAL_FUND": return 0;
    case "TAX_EXEMPT": return 0;
    default: return isDebenture ? 0.06 : 0.05;
  }
}

function mapToHolderType(category: string): string | null {
  switch (category) {
    case "PROMOTER": return "Natural Person - Promoter";
    case "PUBLIC": return "Natural Person - Public";
    case "LOCAL": return "Natural Person - Public";
    case "INSTITUTION": return "Legal Person";
    case "MUTUAL_FUND": return "Mutual Fund";
    case "TAX_EXEMPT": return "Tax Exempt";
    case "FOREIGN": return "Foreign";
    default: return null;
  }
}

function payableClassification(category: string): string {
  if (category === "INSTITUTION" || category === "FOREIGN") return "COMPANY_INSTITUTION";
  if (category === "MUTUAL_FUND" || category === "TAX_EXEMPT") return "TAX_EXEMPT";
  if (category === "PUBLIC") return "PUBLIC_LEGAL_PERSON";
  if (category === "PROMOTER" || category === "LOCAL") return "NATURAL_PERSON";
  return "UNCLASSIFIED";
}

function payableSegment(category: string): string | null {
  return category === "PROMOTER" || category === "LOCAL" || category === "PUBLIC" ? category : null;
}

/**
 * Look up real client IDs for a set of BOIDs.
 *
 * PostgREST renders `.in()` as a URL query string; a chunk of ~1000 BOIDs
 * (≈16 KB of URL) exceeds the server URL-length limit and returns "URI too
 * long" — silently yielding NO rows. That leaves the temporary UUIDs in
 * clientIdMap, and every payable insert then fails its `client_id` foreign
 * key. Batched lookups keep each request small so large chunks resolve
 * reliably.
 */
const CLIENT_LOOKUP_BATCH = 300;

async function fetchClientIdsByBoids(
  supabase: any,
  boids: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < boids.length; i += CLIENT_LOOKUP_BATCH) {
    const part = boids.slice(i, i + CLIENT_LOOKUP_BATCH);
    const { data } = await supabase
      .from("clients")
      .select("id, boid")
      .in("boid", part);
    for (const c of data || []) {
      if (c?.boid) map.set(String(c.boid), c.id);
    }
  }
  return map;
}

async function insertRowsWithSchemaFallback(supabase: any, tableName: string, rows: any[]) {
  const { error: batchError } = await supabase.from(tableName).insert(rows);
  if (!batchError) return { inserted: rows.length, errors: [] as any[] };

  console.warn(`Batch ${tableName} insert failed; retrying row by row:`, batchError.message);

  let insertedCount = 0;
  const errors: any[] = [];

  rows.forEach((row, rowIndex) => {
    let currentRow = { ...row };
    let attempts = 0;

    while (attempts < 4) {
      attempts += 1;
      currentRow = { ...currentRow }; // fresh copy each attempt
      const { error } = await supabase.from(tableName).insert(currentRow).maybeSingle();
      if (!error) {
        insertedCount += 1;
        return;
      }

      const missingColumn = getMissingColumnName(error);
      if (!missingColumn || currentRow[missingColumn] === undefined) {
        // Not a recoverable missing-column issue — record the real per-row error
        // so the chunk reports exactly which rows failed and why (instead of
        // lumping the whole chunk into one generic "imported 0 rows" exception).
        console.error(`Failed to insert ${tableName} row:`, error.message);
        errors.push({
          row_number: rowIndex + 1,
          error: error.message,
          client_id: row?.client_id ?? null,
        });
        return;
      }

      delete currentRow[missingColumn];
    }
  });

  return { inserted: insertedCount, errors };
}

serve(async (req) => {
  try {
    const payload: ChunkPayload = await req.json();
    const {
      uploadId,
      targetTable,
      companyName,
      fiscalYear,
      dividendRate,
      tdsRate,
      dividendType,
      sheetType,
    } = payload;

    // Health-check / misconfigured calls should return a clear error instead of crashing
    if (!uploadId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required field: uploadId" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    let chunkData = Array.isArray(payload.chunkData) ? payload.chunkData : [];

    // Create Supabase client with service_role key for bypassing RLS
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const isDebenture = targetTable === "interest_payables";

    // Filter out footer/total/summary rows that carry no BOID but contain
    // "TOTAL" / "SUMMARY" markers (e.g. the trailing "NAME = TOTAL" row in
    // many CDS/Excel export files). These are not investor rows and should
    // be skipped rather than counted as import errors.
    const filteredData = chunkData.filter((row: any) => {
      if (!row || typeof row !== "object") return false;
      const boid = String(
        row.boid || row.BOID || row["BENEFICIARY ID"] || row["CLIENT ID"] || row.client_code || row.ClientCode || ""
      ).trim();
      if (boid) return true; // has a BOID — keep it
      // No BOID: treat as a footer/summary row if a "TOTAL"/"SUMMARY" marker is present
      const allValues = Object.values(row).filter((v) => v !== null && v !== undefined);
      return !allValues.some((v) => {
        const s = String(v).trim().toUpperCase();
        return s === "TOTAL" || s === "SUMMARY" || s.startsWith("TOTAL ") || s.startsWith("SUMMARY ");
      });
    });
    // Mutate chunkData to the filtered set so the rest of the function processes only investor rows
    chunkData = filteredData;

    // 0. Ensure the upload_history record exists (bypasses RLS via service_role)
    // This prevents FK constraint violations when the frontend client couldn't create it
    await ensureUploadRecord(supabase, uploadId, payload);

    // 1. Resolve company: try to find/create by detected name, or fallback to default
    let companyId = "";

    // 1a. If company name was detected from file, try to find or create it
    if (companyName) {
      const cleanName = companyName.trim();
      const { data: matchedCompanies } = await supabase
        .from("companies")
        .select("id, company_name")
        .ilike("company_name", `%${cleanName}%`);

      if (matchedCompanies && matchedCompanies.length > 0) {
        companyId = matchedCompanies[0].id;
      } else {
        // Generate a short code from company name (max 4 chars)
        const code = cleanName.replace(/[^A-Za-z]/g, "").substring(0, 4).toUpperCase();
        const { data: newCompany, error: compErr } = await supabase
          .from("companies")
          .insert({
            company_name: cleanName,
            company_code: code || "UNKN",
            status: "Active",
          })
          .select("id")
          .single();

        if (!compErr) {
          companyId = newCompany.id;
        } else {
          console.warn("Could not create company from detected name:", compErr.message);
        }
      }
    }

    // 1b. Fallback to first existing company or create default
    if (!companyId) {
      const { data: companies } = await supabase
        .from("companies")
        .select("id")
        .limit(1);

      if (companies && companies.length > 0) {
        companyId = companies[0].id;
      } else {
        const { data: newCompany, error: compErr } = await supabase
          .from("companies")
          .insert({
            company_name: "Supermai Hydropower Ltd.",
            company_code: "SMHL",
            status: "Active",
          })
          .select("id")
          .single();

        if (compErr) {
          throw new Error(`Failed to create company: ${compErr.message}`);
        }
        companyId = newCompany.id;
      }
    }

    // 2. Collect all unique BOIDs from the chunk
    const rowErrors: Record<string, any>[] = [];
    const boids = chunkData
      .map((row: any, idx: number) => {
        const boid = String(
          row.boid || row.BOID || row["BENEFICIARY ID"] || row["CLIENT ID"] || row.client_code || row.ClientCode || ""
        ).trim();
        if (boid.length < 8) {
          rowErrors.push({
            row_number: idx + 1,
            field_name: "boid",
            error_type: "missing_boid",
            error_message: "BOID is empty or invalid.",
            raw_data: row,
          });
          return null;
        }
        return boid;
      })
      .filter(Boolean);

    if (boids.length === 0) {
      return new Response(JSON.stringify({ success: true, rowsProcessed: 0, errors: rowErrors }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. Batch fetch existing clients by BOID.
    //    (chunked — a single .in() with ~1000 BOIDs returns "URI too long"
    //    and silently yields no rows)
    const existingClientMap = await fetchClientIdsByBoids(supabase, boids);

    // 4. Prepare client inserts for new BOIDs
    const newClients: any[] = [];
    const clientIdMap = new Map<string, string>();

    for (const row of chunkData) {
      const boid = String(
        row.boid || row.BOID || row["BENEFICIARY ID"] || row["CLIENT ID"] || row.client_code || row.ClientCode || ""
      ).trim();
      if (!boid || boid.length < 8) continue;

      if (existingClientMap.has(boid)) {
        clientIdMap.set(boid, existingClientMap.get(boid)!);
      } else if (!clientIdMap.has(boid)) {
        // Will be inserted in batch
        const tempId = crypto.randomUUID();
        clientIdMap.set(boid, tempId);

        // Smart categorization: detect investor type from row data or sheet name
        const investorCategory = detectInvestorCategory(row, sheetType);
        const holderType = mapToHolderType(investorCategory);

        function extractRowField(r: any, keys: string[]): string {
          if (!r || typeof r !== "object") return "";
          for (const k of keys) {
            if (r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== "") {
              return String(r[k]).trim();
            }
          }
          const rowKeys = Object.keys(r);
          for (const targetKey of keys) {
            const cleanTarget = targetKey.toUpperCase().replace(/[_\s\-\.\/]/g, "");
            for (const rk of rowKeys) {
              const cleanRk = rk.toUpperCase().replace(/[_\s\-\.\/]/g, "");
              if (
                cleanRk === cleanTarget &&
                r[rk] !== undefined &&
                r[rk] !== null &&
                String(r[rk]).trim() !== ""
              ) {
                return String(r[rk]).trim();
              }
            }
          }
          return "";
        }

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
        ]);

        const bankName = extractRowField(row, [
          "bank_name",
          "bank",
          "BANK NAME",
          "BANK",
          "NAME OF BANK",
          "BANK/FINANCIAL INSTITUTION",
          "BANK DETAILS",
        ]);

        const bankBranch = extractRowField(row, [
          "bank_branch",
          "branch",
          "BANK BRANCH",
          "BRANCH NAME",
          "BRANCH",
          "BANK_BRANCH",
        ]);

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
          "ACC NO",
          "BANK ACC NO",
          "BANK ACC NO.",
        ]);

        const accountType = extractRowField(row, [
          "account_type",
          "ACCOUNT TYPE",
          "A/C TYPE",
          "ACC TYPE",
        ]);

        const panOrCitizenship = extractRowField(row, [
          "pan_or_citizenship",
          "pan",
          "citizenship",
          "pan_no",
          "citizenship_no",
          "PAN",
          "CITIZENSHIP",
          "PAN NO",
          "PAN NO.",
          "CITIZENSHIP NO",
          "CITIZENSHIP NO.",
          "REGISTRATION NO",
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
        ]);

        const gender = extractRowField(row, ["gender", "GENDER", "SEX"]);
        const occupation = extractRowField(row, ["occupation", "OCCUPATION", "PROFESSION"]);
        const address = extractRowField(row, [
          "address",
          "ADDRESS",
          "FULL ADDRESS",
          "PERMANENT ADDRESS",
          "LOCATION",
        ]);
        const province = extractRowField(row, ["province", "PROVINCE", "STATE"]);
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
        ]);
        const email = extractRowField(row, [
          "email",
          "EMAIL",
          "EMAIL ADDRESS",
          "E-MAIL",
          "E-MAIL ADDRESS",
        ]);
        const clientId = extractRowField(row, [
          "client_id",
          "clientId",
          "CLIENT ID",
          "CLIENT NO",
          "MEMBER ID",
        ]);

        newClients.push({
          id: tempId,
          boid,
          company_id: companyId,
          full_name: fullName,
          client_code: buildClientCode(row, boid),
          client_id: clientId || null,
          father_name: fatherName || null,
          grandfather_name: grandfatherName || null,
          pan_or_citizenship: panOrCitizenship || null,
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

    // 5. Batch insert new clients using the bulk_insert_clients RPC
    // which uses ON CONFLICT (boid) DO UPDATE to handle existing clients gracefully
    let clientsInserted = 0;

    if (newClients.length > 0) {
      const { data: rpcResult, error: rpcErr } = await supabase
        .rpc("bulk_insert_clients", { p_clients: newClients });

      if (rpcErr) {
        console.error("bulk_insert_clients RPC failed:", rpcErr);
        // Fall back to individual inserts for the ones that failed
        for (const client of newClients) {
          const { error } = await supabase.from("clients").insert(client);
          if (error) {
            console.error(`Failed to insert client ${client.boid}:`, error);
            clientIdMap.delete(client.boid);
          } else {
            clientsInserted += 1;
          }
        }
      } else {
        clientsInserted = Number(rpcResult?.inserted ?? newClients.length ?? 0);
        // If RPC reported errors for some clients, remove them from the map
        if (rpcResult?.errors && rpcResult.errors.length > 0) {
          for (const err of rpcResult.errors) {
            if (err?.boid) {
              clientIdMap.delete(err.boid);
            }
          }
        }
      }

      // CRITICAL: Re-fetch actual client IDs from the database.
      // The bulk_insert_clients RPC uses ON CONFLICT (boid) DO UPDATE,
      // which means existing clients keep their original IDs, not the temp IDs
      // we generated. We must update clientIdMap with the real database IDs.
      // (chunked lookups to avoid "URI too long" on big chunks)
      const newBoids = newClients.map((c) => c.boid);
      const actualClientIds = await fetchClientIdsByBoids(supabase, newBoids);
      for (const [boid, cid] of actualClientIds) {
        clientIdMap.set(boid, cid);
      }

      // CRITICAL: Any client whose real row could not be confirmed in the DB
      // must NOT keep its temporary (in-memory only) UUID. If we used that
      // phantom ID as the payable's client_id, every payable in the chunk would
      // fail the client_id foreign key and the whole 1,000-row chunk would be
      // reported as "inserted: 0" -> a giant, un-actionable 16,000-row error.
      // Drop the unconfirmed ID so the rows fall through to a clear, per-row
      // client_not_found error below instead.
      for (const boid of newBoids) {
        if (!actualClientIds.has(boid)) {
          clientIdMap.delete(boid);
        }
      }
    }

    // 6. Prepare batch inserts for target table — WITH upload_id and all metadata
    const payables: any[] = [];

    for (const row of chunkData) {
      const boid = String(
        row.boid || row.BOID || row["BENEFICIARY ID"] || row["CLIENT ID"] || row.client_code || row.ClientCode || ""
      ).trim();
      if (!boid || boid.length < 8) continue;

      const clientId = clientIdMap.get(boid);
      if (!clientId) {
        rowErrors.push({
          row_number: chunkData.indexOf(row) + 1,
          field_name: "client",
          error_type: "client_not_found",
          error_message: `Client could not be created/resolved for BOID ${boid}.`,
          raw_data: row,
        });
        continue; // Skip if client creation failed
      }

      // Read raw values from Excel — aliases cover CDS, Mutual Fund AMC and Debenture export formats
      const sharesHeld = Number(
        row.shares_held || row.kitta || row.KITTA || row["TOTA KITTA"] || row["TOTAL KITTA"] ||
          row.alloted_quantity || row.ALLOTED_QUANTITY ||
          row["UNITS HELD"] || row["UNIT HELD"] || row["UNITS"] || row["UNIT"] ||
          row["NO OF UNITS"] || row["NO. OF UNITS"] || row["NUMBER OF UNITS"] ||
          row["UNIT BALANCE"] || row["BALANCE UNITS"] || row["FREE BALANCE"] ||
          row["UNIT HOLDING"] || row["CURRENT HOLDING"] || row["HOLDINGS"] ||
          row["QTY"] || row["QUANTITY"] || row["DEBENTURE UNITS"] || row["FACE VALUE UNITS"] || 0
      );
      const rawGross = Number(
        row.gross_amount || row.amount || row.AMOUNT || row.payable_amount || row.cash_dividend ||
          row["INTEREST AMOUNT"] || row["GROSS INTEREST"] || row["GROSS AMOUNT"] ||
          row["DISTRIBUTION AMOUNT"] || row["INT AMOUNT"] || row["COUPON AMOUNT"] || 0
      );
      const rawTax = Number(
        row.tax_amount || row.tax || row.TAX || row.bon_tax || row.div_tax ||
          row["TDS"] || row["TDS AMOUNT"] || row["WITHHOLDING TAX"] || row["TAX DEDUCTED"] || 0
      );
      const rawNet = Number(
        row.net_payable || row.net || row.NET || row.ROUNDUP || row.ROUND_UP_DIV ||
          row["NET INT"] || row["NET AMOUNT"] || row["NET INTEREST"] || row["NET DISTRIBUTION"] || 0
      );
      const bankName = row.bank_name || row.bankName || row.bank || row.BANK || row["BANK NAME"] || "";
      const bankAccountNo =
        row.bank_account_no || row.bank_account || row.bankAccount ||
        row.ACCOUNT_NUMBER || row.account_number || row["BANK A/C NO."] || row["BANK A/C NO"] || "";
      const lotName = row.lot_name || row.lot || row.LOT || "";
      const status = row.status || row.STATUS || "Pending";

      // *** SMART ROW-LEVEL CATEGORIZATION ***
      const investorCategory = detectInvestorCategory(row, sheetType);
      // Determine TDS rate: explicit sheet-level override → auto-detect from row data
      const rowTdsRate = tdsRate !== undefined
        ? tdsRate
        : getCategoryTdsRate(investorCategory, isDebenture);

      // Auto-calculate: if gross is 0 but we have shares × rate, compute it
      let grossAmount = rawGross;
      let taxAmount = rawTax;
      let netPayable = rawNet;

      if (targetTable === "dividend_payables" || targetTable === "mutual_fund_payables") {
        // Auto-calculate gross from shares × dividend rate if gross is missing
        if (!grossAmount && sharesHeld && dividendRate) {
          grossAmount = Math.round(sharesHeld * dividendRate * 100) / 100;
        }
        // Auto-calculate tax from gross using the ROW-LEVEL TDS rate
        if (!taxAmount && grossAmount && rowTdsRate > 0) {
          taxAmount = Math.round(grossAmount * rowTdsRate * 100) / 100;
        }
        // Auto-calculate net = gross - tax if net is missing
        if (!netPayable && grossAmount) {
          netPayable = Math.round((grossAmount - taxAmount) * 100) / 100;
        }
        if (!grossAmount) grossAmount = netPayable || 0;
        if (!netPayable) netPayable = Math.round((grossAmount - taxAmount) * 100) / 100;

        payables.push({
          upload_id: uploadId,
          company_id: companyId,
          client_id: clientId,
          gross_dividend: grossAmount,
          tax_amount: taxAmount,
          net_payable: netPayable,
          shares_held: sharesHeld,
          dividend_rate: dividendRate ?? null,
          tds_rate: rowTdsRate,
          dividend_type: dividendType || "Cash",
          fiscal_year: fiscalYear ?? null,
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
        // Auto-calculate from shares × rate if gross missing
        if (!grossAmount && sharesHeld && dividendRate) {
          grossAmount = Math.round(sharesHeld * dividendRate * 100) / 100;
        }
        // Auto-calculate tax using ROW-LEVEL TDS rate
        if (!taxAmount && grossAmount && rowTdsRate > 0) {
          taxAmount = Math.round(grossAmount * rowTdsRate * 100) / 100;
        }
        if (!netPayable && grossAmount) {
          netPayable = Math.round((grossAmount - taxAmount) * 100) / 100;
        }
        if (!grossAmount) grossAmount = netPayable || 0;
        if (!netPayable) netPayable = Math.round((grossAmount - taxAmount) * 100) / 100;

        payables.push({
          upload_id: uploadId,
          company_id: companyId,
          client_id: clientId,
          gross_interest: grossAmount,
          tax_amount: taxAmount,
          net_payable: netPayable,
          tds_rate: rowTdsRate,
          due_date: new Date().toISOString().split("T")[0],
          fiscal_year: fiscalYear ?? null,
          bank_name: bankName || null,
          bank_account_no: bankAccountNo || null,
          lot_name: lotName || null,
          payment_status: status === "SUCCESS" ? "Paid" : "Pending",
          payee_classification: payableClassification(investorCategory),
          payee_segment: payableSegment(investorCategory),
          classification_status: investorCategory === "UNKNOWN" ? "REVIEW_REQUIRED" : "AUTO_CLASSIFIED",
        });
      }
    }

    // 7. Batch insert payables with schema fallback
    let payablesInserted = 0;

    if (payables.length > 0) {
      const payableResult = await insertRowsWithSchemaFallback(supabase, targetTable, payables);
      payablesInserted = payableResult.inserted;

      // Surface the REAL per-row errors instead of lumping the whole chunk into
      // one generic "imported 0 rows" exception. Each entry points back at the
      // original row so the error download shows exactly what failed and why.
      for (const perRowErr of payableResult.errors) {
        const rowNumber = Number(perRowErr?.row_number ?? 0);
        rowErrors.push({
          row_number: rowNumber,
          field_name: "payable",
          error_type: "payable_rpc",
          error_message: String(perRowErr?.error || "Payable insert failed (see SQL error)."),
          raw_data: rowNumber > 0 ? payables[rowNumber - 1] : undefined,
        });
      }
    }

    // Note: clientsInserted may be 0 if all clients already existed (ON CONFLICT DO UPDATE).
    // The RPC succeeding without error means clients were upserted successfully.
    // Only fail if payables couldn't be inserted AND we have no per-row detail.
    if (payables.length > 0 && payablesInserted === 0 && rowErrors.length === 0) {
      const tableLabel =
        targetTable === "dividend_payables"
          ? "dividend"
          : targetTable === "mutual_fund_payables"
            ? "mutual fund"
            : "interest";
      throw new Error(`Import completed without writing any ${tableLabel} rows.`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        rowsProcessed: payablesInserted,
        clientsCreated: clientsInserted,
        errors: rowErrors,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Edge function error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
