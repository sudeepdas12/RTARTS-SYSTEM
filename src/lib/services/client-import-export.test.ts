import { describe, it, expect, afterAll, beforeAll } from "vitest";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { normalizeBoid } from "@/lib/validation-engine";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function getClientField(row: Record<string, unknown>, ...aliases: string[]): any {
  for (const [key, val] of Object.entries(row)) {
    const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const alias of aliases) {
      const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (
        cleanKey === cleanAlias &&
        val !== undefined &&
        val !== null &&
        String(val).trim() !== ""
      ) {
        return val;
      }
    }
  }
  return undefined;
}

function parseClientDate(val: any): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === "number" && val > 20000 && val < 60000) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const str = String(val).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : str || null;
}

describe("Client Import & Export End-to-End Suite", () => {
  let testCompanyId: string;
  const testCompanyCode = `CLT_CO_${Date.now().toString().slice(-4)}`;
  const testClientCode = `TST_CL_${Date.now().toString().slice(-4)}`;
  const testBoid = "1301300099887766";

  beforeAll(async () => {
    // Ensure we have a valid test company
    const { data: comp, error: compErr } = await adminClient
      .from("companies")
      .insert({
        company_code: testCompanyCode,
        company_name: `Test Holdings ${testCompanyCode}`,
        company_type: "Commercial Bank",
        sector_type: "Public",
        status: "Active",
      })
      .select("id")
      .single();

    if (compErr || !comp) {
      throw new Error(`Failed to create test company: ${compErr?.message}`);
    }
    testCompanyId = comp.id;
  });

  afterAll(async () => {
    if (testCompanyId) {
      await adminClient.from("clients").delete().eq("company_id", testCompanyId);
      await adminClient.from("companies").delete().eq("id", testCompanyId);
    }
  });

  it("normalizes diverse human Excel headers into standardized client attributes", () => {
    const rawRow = {
      "Shareholder Name": "RAM BAHADUR SHRESTHA",
      "Client Code": testClientCode,
      "Demat No.": "13013000-9988-7766",
      "Holding Kitta": 1500,
      "Holder Type": "Natural Person - Public",
      "Tax Classification": "NATURAL_PERSON",
      "Father Name": "KRISHNA BAHADUR SHRESTHA",
      "Grand Father Name": "HARKA BAHADUR SHRESTHA",
      "Date of Birth": 36526, // Excel date serial for 2000-01-01
      Gender: "MALE",
      Occupation: "Business",
      "PAN Number": "108094183",
      "Citizenship No.": "105103-1-040",
      "Phone / Mobile": "9851000000",
      "Email Address": "ram.shrestha@example.com",
      "Registered Bank": "Sanima Bank Ltd.",
      "Branch Name": "Satdobato Branch",
      "Account Number": "014011090005440",
      "Residential Status": "Resident",
      "KYC Verification": "Verified",
    };

    const name = getClientField(rawRow, "full_name", "shareholder_name", "name");
    const code = getClientField(rawRow, "client_code", "clientcode", "code");
    const rawBoid = getClientField(rawRow, "boid", "demat_no", "demat");
    const boid = rawBoid ? normalizeBoid(rawBoid) : null;
    const kitta = Number(getClientField(rawRow, "kitta", "holding_kitta", "shares"));
    const dob = parseClientDate(getClientField(rawRow, "date_of_birth", "dob"));
    const pan = getClientField(rawRow, "pan_no", "pan_number", "pan");
    const ctz = getClientField(rawRow, "citizenship_no", "citizenship");
    const bank = getClientField(rawRow, "bank_name", "registered_bank", "bank");
    const acct = getClientField(rawRow, "bank_account_no", "account_number", "acct_no");

    expect(name).toBe("RAM BAHADUR SHRESTHA");
    expect(code).toBe(testClientCode);
    expect(boid).toBe("1301300099887766");
    expect(kitta).toBe(1500);
    expect(dob).toBe("2000-01-01");
    expect(pan).toBe("108094183");
    expect(ctz).toBe("105103-1-040");
    expect(bank).toBe("Sanima Bank Ltd.");
    expect(acct).toBe("014011090005440");
  });

  it("generates an XLSX file with client records, reads it, and executes batch upsert cleanly to PostgreSQL", async () => {
    // 1. Build spreadsheet rows
    const testRow = {
      "Client Code": testClientCode,
      "Shareholder Name": "RAM BAHADUR SHRESTHA",
      BOID: testBoid,
      "Holding Kitta": 250,
      "Holder Type": "Natural Person - Public",
      "Tax Classification": "NATURAL_PERSON",
      "PAN Number": "108094183",
      "Citizenship No": "105103-1-040",
      "Phone Number": "9851000000",
      "Email Address": "ram.shrestha@example.com",
      "Bank Name": "Sanima Bank Ltd.",
      "Bank Branch": "Satdobato Branch",
      "Account Number": "014011090005440",
      "Verification Status": "Verified",
    };

    const ws = XLSX.utils.json_to_sheet([testRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clients");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    // 2. Read spreadsheet buffer back
    const parsedWb = XLSX.read(buffer, { type: "buffer" });
    const parsedRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      parsedWb.Sheets[parsedWb.SheetNames[0]],
    );
    expect(parsedRows.length).toBe(1);

    const r = parsedRows[0];
    const clientPayload = {
      client_code: String(getClientField(r, "client_code", "clientcode", "code")).trim(),
      company_id: testCompanyId,
      full_name: String(getClientField(r, "full_name", "shareholder_name", "name")).trim(),
      boid: normalizeBoid(getClientField(r, "boid", "demat_no")),
      kitta: Number(getClientField(r, "kitta", "holding_kitta") || 0),
      holder_type: "Natural Person - Public",
      payee_classification: "NATURAL_PERSON",
      pan_no: String(getClientField(r, "pan_no", "pan_number")).trim(),
      citizenship_no: String(getClientField(r, "citizenship_no")).trim(),
      pan_or_citizenship: "108094183",
      phone: String(getClientField(r, "phone", "phone_number")).trim(),
      email: String(getClientField(r, "email", "email_address")).trim(),
      bank_name: String(getClientField(r, "bank_name")).trim(),
      bank_branch: String(getClientField(r, "bank_branch")).trim(),
      bank_account_no: String(getClientField(r, "bank_account_no", "account_number")).trim(),
      verification_status: "Verified",
      status: "Active",
    };

    // 3. Upsert using the robust constraint "company_id,client_code"
    const { data: inserted, error: insertErr } = await adminClient
      .from("clients")
      .upsert([clientPayload], { onConflict: "company_id,client_code" })
      .select()
      .single();

    expect(insertErr).toBeNull();
    expect(inserted).not.toBeNull();
    expect(inserted?.client_code).toBe(testClientCode);
    expect(inserted?.company_id).toBe(testCompanyId);
    expect(inserted?.full_name).toBe("RAM BAHADUR SHRESTHA");
    expect(inserted?.boid).toBe(testBoid);
    expect(Number(inserted?.kitta)).toBe(250);

    // 4. Test updating the client via subsequent upsert
    const updatedPayload = {
      ...clientPayload,
      kitta: 500,
      email: "ram.updated@example.com",
    };

    const { data: updated, error: updateErr } = await adminClient
      .from("clients")
      .upsert([updatedPayload], { onConflict: "company_id,client_code" })
      .select()
      .single();

    expect(updateErr).toBeNull();
    expect(updated?.id).toBe(inserted?.id);
    expect(Number(updated?.kitta)).toBe(500);
    expect(updated?.email).toBe("ram.updated@example.com");
  });

  it("verifies dynamic aggregation and pagination for the company clients", async () => {
    // 1. Direct count query
    const { count, error } = await adminClient
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("company_id", testCompanyId);

    expect(error).toBeNull();
    expect(count).toBe(1);

    // 2. RPC get_clients_paginated
    const { data: pageRows, error: rpcErr } = await (adminClient as any).rpc(
      "get_clients_paginated",
      {
        p_company_id: testCompanyId,
        p_holder_type: "all",
        p_classification: "all",
        p_status: "all",
        p_verification: "all",
        p_search: "",
        p_limit: 10,
        p_offset: 0,
      },
    );

    expect(rpcErr).toBeNull();
    expect(pageRows).not.toBeNull();
    expect(pageRows.length).toBe(1);
    expect(pageRows[0].client_code).toBe(testClientCode);
    expect(pageRows[0].full_name).toBe("RAM BAHADUR SHRESTHA");
  });
});
