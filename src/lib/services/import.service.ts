import { supabase, throwIfError } from "./database";
import { mapToHolderType } from "./investor-category";
import { calculatePayableTotals, detectPayeeCategory, getPayeeTaxRate } from "./payable-summary";

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

async function fetchClientIdsByBoids(boids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < boids.length; i += CLIENT_LOOKUP_BATCH) {
    const part = boids.slice(i, i + CLIENT_LOOKUP_BATCH);
    const { data } = await (supabase as any).from("clients").select("id, boid").in("boid", part);
    for (const c of data || []) {
      if (c?.boid) map.set(String(c.boid), c.id);
    }
  }
  return map;
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
function getCategoryTdsRate(category: string, isDebenture: boolean): number {
  return getPayeeTaxRate(category, isDebenture);
}

function payableClassification(category: string): string {
  if (category === 'INSTITUTION' || category === 'FOREIGN') return 'COMPANY_INSTITUTION';
  if (category === 'MUTUAL_FUND' || category === 'TAX_EXEMPT') return 'TAX_EXEMPT';
  if (category === 'PUBLIC') return 'PUBLIC_LEGAL_PERSON';
  if (category === 'PROMOTER' || category === 'LOCAL') return 'NATURAL_PERSON';
  return 'UNCLASSIFIED';
}

function payableSegment(category: string): string | null {
  return category === 'PROMOTER' || category === 'LOCAL' || category === 'PUBLIC' ? category : null;
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
      fileHash?: string;
      sheetType?: string; // Sheet type/name for fallback category detection (e.g. 'D-PUBLIC', 'INSTITUTION')
      fileName?: string;
      fileSize?: number;
      fileType?: string;
      sheetName?: string;
      totalRows?: number;
      userId?: string;
    },
    sharedContext?: {
      companyId?: string;
      clientIdCache?: Map<string, string>;
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
    // Priority: sharedContext.companyId (set from ChunkOptions.companyId) > RPC name lookup.
    let companyId = sharedContext?.companyId || options?.companyId || "";

    if (!companyId) {
      // 1. If company name was detected from file, try to find or create it (via RPC to bypass RLS)
      if (options?.companyName) {
        const cleanName = options.companyName.trim();
        const code = cleanName
          .replace(/[^A-Za-z]/g, "")
          .substring(0, 4)
          .toUpperCase();
        try {
          const { data: rpcCompany, error: companyRpcErr } = await (supabase as any).rpc(
            "bulk_upsert_company",
            {
              p_company_name: cleanName,
              p_company_code: code || "UNKN",
            },
          );
          if (companyRpcErr) {
            console.warn("bulk_upsert_company RPC failed:", companyRpcErr);
          } else if (rpcCompany?.success) {
            companyId = rpcCompany.company_id;
          } else {
            console.warn("bulk_upsert_company returned error:", rpcCompany?.error);
          }
        } catch (companyEx: any) {
          console.warn("bulk_upsert_company exception:", companyEx?.message);
        }
      }
      // 2. Fallback to first existing company or create default
      if (!companyId) {
        const { data: companies } = await supabase.from("companies").select("id").limit(1);
        if (companies && companies.length > 0) {
          companyId = companies[0].id;
        } else {
          try {
            const { data: rpcCompany2, error: companyRpcErr2 } = await (supabase as any).rpc(
              "bulk_upsert_company",
              {
                p_company_name: "Supermai Hydropower Ltd.",
                p_company_code: "SMHL",
              },
            );
            if (companyRpcErr2) {
              console.warn("Fallback company RPC failed:", companyRpcErr2);
              throw new Error("No company configured. Please create a company first.");
            }
            companyId = rpcCompany2?.company_id || "";
            if (!companyId) {
              throw new Error("No company configured. Please create a company first.");
            }
          } catch (compEx: any) {
            console.warn("Could not create company:", compEx?.message);
            throw new Error("No company configured. Please create a company first.");
          }
        }
      }

      if (sharedContext) {
        sharedContext.companyId = companyId;
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
    const existingBoidMap =
      missingBoids.length > 0 ? await fetchClientIdsByBoids(missingBoids) : new Map<string, string>();

    for (const [boid, cid] of existingBoidMap) {
      sharedContext?.clientIdCache?.set(boid, cid);
    }

    // Prepare new client records
    const newClientRecords: any[] = [];
    const resolvedClientIds = new Map<string, string>();

    for (const boid of uniqueBoids) {
      const cachedClientId = sharedContext?.clientIdCache?.get(boid);
      if (cachedClientId) {
        resolvedClientIds.set(boid, cachedClientId);
      } else if (existingBoidMap.has(boid)) {
        const clientId = existingBoidMap.get(boid)!;
        sharedContext?.clientIdCache?.set(boid, clientId);
        resolvedClientIds.set(boid, clientId);
      } else {
        const row = boidMap.get(boid);
        const tempId = crypto.randomUUID();
        sharedContext?.clientIdCache?.set(boid, tempId);
        resolvedClientIds.set(boid, tempId);
        // Smart categorization: detect investor type from row data or sheet name
        const investorCategory = detectInvestorCategory(row, options?.sheetType);
        const holderType = mapToHolderType(investorCategory);
        newClientRecords.push({
          id: tempId,
          boid,
          company_id: companyId,
          full_name: String(
            row.full_name ||
              row.name ||
              row.NAME ||
              row["SHAREHOLDER NAME"] ||
              row["HOLDER NAME"] ||
              row["UNIT HOLDER NAME"] ||
              row["DEBENTURE HOLDER"] ||
              row["INVESTOR NAME"] ||
              row["ACCOUNT HOLDER"] ||
              row.APPLICANT_NAME ||
              row.ApplicantName ||
              "Unknown Investor",
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
          phone: row.phone || row.contact || row.CONTACT || row.phone_number || "",
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
            row["ACCOUNT NUMBER"] ||
            "",
          holder_type: holderType,
          payee_classification: payableClassification(investorCategory),
          payee_segment: payableSegment(investorCategory),
          classification_status: investorCategory === 'UNKNOWN' ? 'REVIEW_REQUIRED' : 'AUTO_CLASSIFIED',
          classification_source: investorCategory === 'UNKNOWN' ? 'upload_requires_review' : 'upload_evidence',
          status: "Active",
          verification_status: "Verified",
        });
      }
    }

    // Batch insert new clients using SECURITY DEFINER RPC (bypasses RLS)
    let clientsInserted = 0;
    if (newClientRecords.length > 0) {
      try {
        const { data: rpcResult, error: rpcErr } = await (supabase as any).rpc(
          "bulk_insert_clients",
          { p_clients: newClientRecords },
        );
        if (rpcErr) {
          console.error("bulk_insert_clients RPC failed:", rpcErr);
          // Fail fast: RPC should be available and run as SECURITY DEFINER.
          // Avoid client-side direct inserts which will be blocked by RLS for non-privileged users.
          throw new Error(
            "bulk_insert_clients RPC failed: " + (rpcErr?.message || JSON.stringify(rpcErr)),
          );
        } else {
          // RPC returned without transport error
          if (rpcResult?.errors && rpcResult.errors.length > 0) {
            console.warn("Some client inserts failed:", rpcResult.errors);
          }
          clientsInserted = Number(rpcResult?.inserted ?? newClientRecords.length ?? 0);
          if (clientsInserted === 0) {
            throw new Error("Client import completed without inserting any rows.");
          }
        }
      } catch (rpcEx: any) {
        console.error("bulk_insert_clients RPC exception:", rpcEx);
        throw new Error("bulk_insert_clients RPC exception: " + (rpcEx?.message || String(rpcEx)));
      }

      // CRITICAL: Re-fetch actual client IDs from the database.
      // The bulk_insert_clients RPC uses ON CONFLICT (boid) DO UPDATE,
      // which means existing clients keep their original IDs, not the temp IDs
      // we generated. We must update resolvedClientIds with the real database IDs
      // so the payables insert doesn't fail with an FK violation on client_id.
      // Note: lookups are batched — a single .in() with ~1000 BOIDs exceeds the
      // URL length limit ("URI too long") and silently returns no rows.
      const newBoids = newClientRecords.map((c) => c.boid);
      const actualClientIds = await fetchClientIdsByBoids(newBoids);
      for (const [boid, cid] of actualClientIds) {
        resolvedClientIds.set(boid, cid);
        sharedContext?.clientIdCache?.set(boid, cid);
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
          resolvedClientIds.delete(boid);
          sharedContext?.clientIdCache?.delete(boid);
        }
      }
    }

    // Prepare batch payables with auto-calculation fallback
    const payablesToInsert: any[] = [];
    const isDebenture = targetTable === "interest_payables";

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

      // Read raw values from Excel (may be 0 or NaN if formula failed).
      // Aliases cover standard CDS exports, RBB Debenture, and Mutual Fund formats.
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
        row["ACCOUNT NUMBER"] ||
        "";
      const lotName = row.lot_name || row.lot || row.LOT || "";
      const status = row.status || row.STATUS || "Pending";

      // *** SMART ROW-LEVEL CATEGORIZATION ***
      // Detect investor category from this specific row's TYPE/CATEGORY column
      const investorCategory = detectInvestorCategory(row, options?.sheetType);
      // Determine TDS rate: row-level category → sheet-level override → default
      const rowTdsRate =
        options?.tdsRate !== undefined
          ? options.tdsRate // User explicitly set a sheet-level override — respect it
          : getCategoryTdsRate(investorCategory, isDebenture); // Auto-detect from row data

      // Auto-calculate: if gross is 0 but we have shares × rate, compute it
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
        });
      } else if (targetTable === "interest_payables") {
        if (!options?.isPreCalculated) {
          if (!grossAmount && sharesHeld && options?.dividendRate) {
            // For debentures, Face Value is typically 1000. 
            // If the user enters 8.75 (percentage), rate per share = 1000 * 8.75 / 100 = 87.5
            // If they enter 87.5 directly, then we might over-multiply, but standard is entering %.
            // We'll assume if rate is <= 20 it's a percentage, multiply by 1000 / 100 = 10.
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
          payment_status: status === "SUCCESS" ? "Paid" : "Pending",
        });
      }
    }

    // Batch insert payables using SECURITY DEFINER RPC (bypasses RLS)
    let payablesInserted = 0;
    if (payablesToInsert.length > 0) {
      try {
        const rpcName =
          targetTable === "interest_payables"
            ? "bulk_insert_interest_payables"
            : targetTable === "mutual_fund_payables"
              ? "bulk_insert_mutual_fund_payables"
              : "bulk_insert_dividend_payables";
        const { data: rpcResult, error: rpcErr } = await (supabase as any).rpc(rpcName, {
          p_payables: payablesToInsert,
        });
        if (rpcErr) {
          console.error(rpcName + " RPC failed:", rpcErr);
          // Fail fast: RPC should handle payables insertion with SECURITY DEFINER.
          throw new Error(rpcName + " RPC failed: " + (rpcErr?.message || JSON.stringify(rpcErr)));
        } else {
          payablesInserted = Number(rpcResult?.inserted ?? 0);
          const rpcErrors = Array.isArray(rpcResult?.errors) ? rpcResult.errors : [];
          if (rpcErrors.length > 0) {
            // Surface the REAL per-row SQL errors returned by the RPC instead of
            // hiding them behind a single chunk-wide "inserted: 0" exception that
            // lumps the entire 1,000-row chunk into one giant, un-actionable error.
            console.warn("Some payable inserts failed:", rpcErrors);

            // client_id -> boid -> row_number reverse lookups so each rejected
            // row points back at its original Excel row for the error download.
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

          // Guard against a silently empty insert: only escalate to a chunk-level
          // exception when the RPC inserted nothing AND returned no per-row detail.
          // (When per-row errors ARE present, chunk-processor counts exactly those
          // rows instead of the whole chunk, so no throw is needed.)
          if (payablesInserted === 0 && rpcErrors.length === 0) {
            throw new Error("Payable import completed without inserting any rows.");
          }
        }
      } catch (rpcEx: any) {
        console.error("Payable RPC exception:", rpcEx);
        throw new Error("Payable RPC exception: " + (rpcEx?.message || String(rpcEx)));
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
