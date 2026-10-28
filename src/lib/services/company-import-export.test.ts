import { describe, it, expect, afterAll } from "vitest";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function getField(row: Record<string, unknown>, ...aliases: string[]): any {
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

function parseExcelDate(val: any): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === "number" && val > 20000 && val < 60000) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const str = String(val).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : str || null;
}

describe("Company Import & Export End-to-End Suite", () => {
  const testCompanyCode = `T_E2E_${Date.now().toString().slice(-4)}`;
  let testCompanyId: string | null = null;

  afterAll(async () => {
    if (testCompanyCode) {
      await adminClient.from("companies").delete().eq("company_code", testCompanyCode);
    }
  });

  it("normalizes flexible, human-formatted spreadsheet headers accurately", () => {
    const rawRow = {
      "Company Code": testCompanyCode,
      "Company Name": "Apex Commercial Bank Limited",
      "Company Type": "Commercial Bank",
      "ISIN Code": "NPE999TEST01",
      "Sector Type": "Public",
      Registrar: "RBB Merchant Banking Limited",
      "Fiscal Year": "2081/82",
      "Dividend Rate": 14.5,
      "Debenture Rate": 8.5,
      "Coupon Rate": 7.0,
      "Maturity Date": "2032-12-31",
      "Face Value": 100,
      "Issue Size": 8500000,
      "Interest Tax Status": "Taxable",
      "PAN No": "609988776",
      "Bank Name": "Rastriya Banijya Bank Ltd.",
      "Bank Account No": "1090008877665544",
      "Email Address": "investor.relations@apexbank.com.np",
      "Contact No": "01-4433221",
      Website: "https://apexbank.com.np",
      "Head Office Address": "Durbar Marg, Kathmandu",
      Status: "Active",
    };

    const parsedCode = getField(rawRow, "company_code", "companycode", "code", "symbol");
    const parsedName = getField(rawRow, "company_name", "companyname", "name");
    const parsedDiv = getField(rawRow, "dividend_rate", "dividendrate", "div_rate");
    const parsedEmail = getField(rawRow, "email", "email_address");
    const parsedAccount = getField(rawRow, "bank_account_no", "bankaccountno", "account_no");
    const parsedAddress = getField(rawRow, "address", "head_office_address", "location");

    expect(parsedCode).toBe(testCompanyCode);
    expect(parsedName).toBe("Apex Commercial Bank Limited");
    expect(Number(parsedDiv)).toBe(14.5);
    expect(parsedEmail).toBe("investor.relations@apexbank.com.np");
    expect(parsedAccount).toBe("1090008877665544");
    expect(parsedAddress).toBe("Durbar Marg, Kathmandu");
  });

  it("converts Excel date serials and standard ISO dates correctly", () => {
    // 44927 is 2023-01-01 in Excel 1900 date system
    const serial = 44927;
    expect(parseExcelDate(serial)).toBe("2023-01-01");
    expect(parseExcelDate("2030-04-15")).toBe("2030-04-15");
    expect(parseExcelDate(null)).toBeNull();
  });

  it("generates an XLSX binary file, parses it back, and commits cleanly to PostgreSQL", async () => {
    // 1. Create simulated Excel workbook with human column headers
    const rawData = [
      {
        "Company Code": testCompanyCode,
        "Company Name": "Apex Commercial Bank Limited",
        "Company Type": "Commercial Bank",
        ISIN: "NPE999TEST01",
        Sector: "Public",
        Registrar: "RBB Merchant Banking Limited",
        "Fiscal Year": "2081/82",
        "Div Rate": 14.5,
        "Deb Rate": 8.5,
        "Coupon Rate": 7.0,
        "Maturity Date": "2032-12-31",
        "Face Value": 100,
        "Total Units": 8500000,
        "Tax Status": "Taxable",
        PAN: "609988776",
        "Bank Name": "Rastriya Banijya Bank Ltd.",
        "Bank Account No": "1090008877665544",
        "Email Address": "investor.relations@apexbank.com.np",
        Phone: "01-4433221",
        Website: "https://apexbank.com.np",
        Address: "Durbar Marg, Kathmandu",
        Status: "Active",
      },
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rawData);
    XLSX.utils.book_append_sheet(wb, ws, "CompaniesMaster");
    const fileBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    // 2. Simulate reading back the file buffer as importFromExcel does
    const readWb = XLSX.read(fileBuffer, { type: "buffer" });
    const readRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      readWb.Sheets[readWb.SheetNames[0]],
      { defval: null },
    );

    expect(readRows.length).toBe(1);

    // 3. Map with our normalized parser
    const clean = readRows.map((r) => ({
      company_code: String(getField(r, "company_code", "code", "symbol"))
        .trim()
        .toUpperCase(),
      company_name: String(getField(r, "company_name", "name")).trim(),
      company_type: getField(r, "company_type", "type") || null,
      isin: getField(r, "isin") || null,
      sector_type: getField(r, "sector_type", "sector") || "Public",
      registrar: getField(r, "registrar", "rta", "rts") || "RBB Merchant Banking Limited",
      fiscal_year: getField(r, "fiscal_year", "fy") || null,
      dividend_rate: Number(getField(r, "dividend_rate", "div_rate")),
      debenture_rate: Number(getField(r, "debenture_rate", "deb_rate")),
      coupon_rate: Number(getField(r, "coupon_rate")),
      maturity_date: parseExcelDate(getField(r, "maturity_date")),
      face_value: Number(getField(r, "face_value")) || 100,
      issue_size: Number(getField(r, "issue_size", "total_units")),
      interest_tax_status: getField(r, "interest_tax_status", "tax_status") || "Taxable",
      pan_no: getField(r, "pan_no", "pan") || null,
      bank_name: getField(r, "bank_name", "bank") || null,
      bank_account_no: getField(r, "bank_account_no", "account_no") || null,
      email: getField(r, "email", "email_address") || null,
      phone: getField(r, "phone", "contact_no") || null,
      website: getField(r, "website") || null,
      address: getField(r, "address") || null,
      status: "Active" as const,
    }));

    // 4. Upsert into database
    const { data: upserted, error: upsertErr } = await adminClient
      .from("companies")
      .upsert(clean, { onConflict: "company_code" })
      .select()
      .single();

    expect(upsertErr).toBeNull();
    expect(upserted).toBeDefined();
    expect(upserted.company_code).toBe(testCompanyCode);
    expect(upserted.email).toBe("investor.relations@apexbank.com.np");
    expect(upserted.bank_account_no).toBe("1090008877665544");
    expect(upserted.dividend_rate).toBe(14.5);
    expect(upserted.face_value).toBe(100);
    expect(upserted.issue_size).toBe(8500000);

    testCompanyId = upserted.id;

    // 5. Query back from database to verify persistence
    const { data: verified, error: verifyErr } = await adminClient
      .from("companies")
      .select("*")
      .eq("company_code", testCompanyCode)
      .single();

    expect(verifyErr).toBeNull();
    expect(verified.company_name).toBe("Apex Commercial Bank Limited");
    expect(verified.address).toBe("Durbar Marg, Kathmandu");
    expect(verified.phone).toBe("01-4433221");

    // 6. Clean up
    await adminClient.from("companies").delete().eq("id", testCompanyId);
  });
});
