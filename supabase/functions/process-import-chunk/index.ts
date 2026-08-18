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
    if (/PROMOT/i.test(rawType)) return "PROMOTER";
    if (/INSTIT/i.test(rawType)) return "INSTITUTION";
    if (/MUTUAL|MF|FUND/i.test(rawType)) return "MUTUAL_FUND";
    if (/TAX.?EXEMPT|EXEMPT/i.test(rawType)) return "TAX_EXEMPT";
    if (/LOCAL/i.test(rawType)) return "LOCAL";
    if (/PUBLIC|GENERAL|INDIVIDUAL/i.test(rawType)) return "PUBLIC";
    if (/FOREIGN|NRN/i.test(rawType)) return "FOREIGN";
    // D-PUBLIC, P-PUBLIC patterns from CDS files
    if (/D-PUBLIC|P-PUBLIC/.test(rawType)) return "PUBLIC";
    // D-PROMOTER pattern
    if (/D-PROMOT/.test(rawType)) return "PROMOTER";
    if (rawType.length > 1) return rawType;
  }

  // Check for Natural Person indicators.
  // Companies do NOT have father/grandfather names or citizenship numbers.
  // Note: PAN is NOT used — both individuals and companies have identical
  // 9-digit numeric PANs in Nepal (issued by IRD), so it cannot distinguish.
  const fatherName = String(
    row.father_name || row.fatherName || row.FATHER_NAME || row["FATHER'S NAME"] || ""
  ).trim();
  const grandfatherName = String(
    row.grandfather_name || row.grandfatherName || row.GRANDFATHER_NAME || row["GRANDFATHER'S NAME"] || ""
  ).trim();
  const citizenship = String(row.citizenship || row.CITIZENSHIP || "").trim();

  if (fatherName || grandfatherName) {
    return "PUBLIC"; // Has family names → Natural Person
  }
  // Citizenship numbers contain dashes or letters (e.g. "25-01-77-12345" or "KA-12345")
  if (citizenship && /[-a-zA-Z]/.test(citizenship)) {
    return "PUBLIC"; // Has citizenship format → Natural Person
  }

  if (sheetType) {
    const upper = sheetType.toUpperCase();
    if (upper.includes("PROMOT")) return "PROMOTER";
    if (upper.includes("INSTIT")) return "INSTITUTION";
    if (upper.includes("MUTUAL") || upper.includes("MF")) return "MUTUAL_FUND";
    if (upper.includes("TAX") && upper.includes("EXEMPT")) return "TAX_EXEMPT";
    if (upper.includes("LOCAL")) return "LOCAL";
    if (upper.includes("PUBLIC")) return "PUBLIC";
  }

  // Never invent a tax-bearing category for an ambiguous row.  It will be
  // retained in the master data as review-required until an operator confirms it.
  return "UNKNOWN";
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

        newClients.push({
          id: tempId,
          boid,
          company_id: companyId,
          full_name: String(
            row.full_name ||
              row.name ||
              row.NAME ||
              row["SHAREHOLDER NAME"] ||
              row.APPLICANT_NAME ||
              row.ApplicantName ||
              "Unknown Investor"
          ),
          client_code: buildClientCode(row, boid),
          father_name:
            row.father_name || row.fatherName || row.FATHER_NAME || row["FATHER'S NAME"] || "",
          grandfather_name:
            row.grandfather_name ||
            row.grandfatherName ||
            row.GRANDFATHER_NAME ||
            row["GRANDFATHER'S NAME"] ||
            "",
          pan_or_citizenship:
            row.pan_or_citizenship ||
            row.citizenship ||
            row.pan ||
            row.PAN ||
            row.CITIZENSHIP ||
            "",
          address: row.address || row.ADDRESS || "",
          district: row.district || row.DISTRICT || "",
          phone:
            row.phone || row.contact || row.CONTACT || row.phone_number || "",
          bank_name:
            row.bank_name || row.bankName || row.bank || row.BANK || row["BANK NAME"] || "",
          bank_account_no:
            row.bank_account_no ||
            row.bank_account ||
            row.bankAccount ||
            row.ACCOUNT_NUMBER ||
            row.account_number ||
            row["BANK A/C NO."] ||
            row["BANK A/C NO"] ||
            "",
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

      // Read raw values from Excel (may be 0 or NaN if formula failed)
      const sharesHeld = Number(
        row.shares_held ||
          row.kitta ||
          row.KITTA ||
          row["TOTA KITTA"] ||
          row.alloted_quantity ||
          row.ALLOTED_QUANTITY ||
          0
      );
      const rawGross = Number(
        row.gross_amount ||
          row.amount ||
          row.AMOUNT ||
          row.payable_amount ||
          row.cash_dividend ||
          0
      );
      const rawTax = Number(
        row.tax_amount || row.tax || row.TAX || row.bon_tax || row.div_tax || 0
      );
      const rawNet = Number(
        row.net_payable ||
          row.net ||
          row.NET ||
          row.ROUNDUP ||
          row.ROUND_UP_DIV ||
          0
      );
      const bankName =
        row.bank_name || row.bankName || row.bank || row.BANK || row["BANK NAME"] || "";
      const bankAccountNo =
        row.bank_account_no ||
        row.bank_account ||
        row.bankAccount ||
        row.ACCOUNT_NUMBER ||
        row.account_number ||
        row["BANK A/C NO."] ||
        row["BANK A/C NO"] ||
        "";
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
          payment_status: status === "SUCCESS" ? "Paid" : "Pending",
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
