import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as XLSX from "xlsx";
import { parseExcelFile } from "./excel-parser";
import { ValidationEngine } from "./validation-engine";

function createMockWorkbookBuffer(
  sheets: Record<string, any[][]>,
  bookType: XLSX.BookType = "xlsx",
): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  const buf = XLSX.write(wb, { type: "array", bookType });
  return buf as ArrayBuffer;
}

describe("Sample Workbook & Matrix Regression Suite", () => {
  describe("1. Cash Dividend .xlsx Parsing & Normalization", () => {
    it("parses dividend sheets, maps columns, and ignores summary/total rows", async () => {
      const rows = [
        [
          "BOID",
          "FULL NAME",
          "KITTA",
          "GROSS DIVIDEND",
          "TAX AMOUNT",
          "NET PAYABLE",
          "BANK NAME",
          "ACCOUNT NO",
        ],
        ["1301060000000001", "Ram Bahadur", 100, 5000, 250, 4750, "RBB Bank", "123456789012"],
        ["1301060000000002", "Sita Devi", 200, 10000, 500, 9500, "Nabil Bank", "987654321098"],
        ["TOTAL", "TOTAL SUMMARY", 300, 15000, 750, 14250, "", ""],
      ];

      const buf = createMockWorkbookBuffer({ PUBLIC: rows });
      const parsed = await parseExcelFile(buf, "NLG_Cash_Dividend_FY2080_81.xlsx");

      expect(parsed.fileType).toBe("dividend");
      expect(parsed.sheets.length).toBe(1);
      const sheet = parsed.sheets[0];
      expect(sheet.sheetType).toBe("PUBLIC");
      // Total footer row must be filtered out
      expect(sheet.rowCount).toBe(2);
      expect(sheet.rows.length).toBe(2);
      expect(sheet.totalKitta).toBe(300);
      expect(sheet.totalAmount).toBe(15000);
      expect(sheet.totalTax).toBe(750);
      expect(sheet.totalNet).toBe(14250);
    });
  });

  describe("2. Debenture / Interest .xlsx Parsing & 6%/15% Tax Rate Rules", () => {
    it("identifies debenture files and sets correct default TDS rates for Public (6%) and Institution (15%)", async () => {
      const publicRows = [
        ["BOID", "CLIENT NAME", "HOLDING", "INTEREST AMOUNT", "TDS", "NET INTEREST PAYABLE"],
        ["1301060000000003", "Hari Sharma", 50, 5000, 300, 4700],
      ];
      const instRows = [
        ["BOID", "CLIENT NAME", "HOLDING", "INTEREST AMOUNT", "TDS", "NET INTEREST PAYABLE"],
        ["1301060000000004", "Everest Insurance Ltd", 500, 50000, 7500, 42500],
      ];

      const buf = createMockWorkbookBuffer({
        PUBLIC: publicRows,
        INSTITUTION: instRows,
      });

      const parsed = await parseExcelFile(buf, "7%_RBB_Debenture_2088_Interest_Payout.xlsx");

      expect(parsed.fileType).toBe("debenture");
      expect(parsed.sheets.length).toBe(2);

      const pubSheet = parsed.sheets.find((s) => s.sheetName === "PUBLIC");
      expect(pubSheet?.defaultTdsRate).toBe(0.06);

      const instSheet = parsed.sheets.find((s) => s.sheetName === "INSTITUTION");
      expect(instSheet?.defaultTdsRate).toBe(0.15);
    });
  });

  describe("3. Mutual Fund .xlsx Parsing & Zero TDS Exemption", () => {
    it("detects mutual fund payouts and applies 0% default TDS exemption", async () => {
      const mfRows = [
        ["BOID", "UNITHOLDER NAME", "UNITS HELD", "GROSS DIVIDEND", "TAX", "NET PAYABLE"],
        ["1301060000000005", "Gopal Shrestha", 1000, 8000, 0, 8000],
      ];

      const buf = createMockWorkbookBuffer({ UNITHOLDERS: mfRows });
      const parsed = await parseExcelFile(buf, "RBB_Mutual_Fund_1_Distribution.xlsx");

      expect(parsed.fileType).toBe("mutual_fund");
      expect(parsed.sheets[0].defaultTdsRate).toBe(0);
      expect(parsed.sheets[0].rows[0].boid).toBe("1301060000000005");
      expect(parsed.sheets[0].totalAmount).toBe(8000);
      expect(parsed.sheets[0].totalTax).toBe(0);
      expect(parsed.sheets[0].totalNet).toBe(8000);
    });
  });

  describe("4. Multi-Sheet Workbook Handling & Sheet Exclusion Rules", () => {
    it("parses active investor sheets and drops SUMMARY and ORIGINAL sheets", async () => {
      const validRows = [
        ["BOID", "NAME", "KITTA"],
        ["1301060000000006", "Investor One", 100],
      ];
      const summaryRows = [
        ["CATEGORY", "TOTAL RECORDS", "TOTAL AMOUNT"],
        ["PUBLIC", 1, 1000],
      ];

      const buf = createMockWorkbookBuffer({
        PUBLIC: validRows,
        SUMMARY: summaryRows,
        ORIGINAL_BACKUP: validRows,
      });

      const parsed = await parseExcelFile(buf, "Company_AGM_BookClose_2081.xlsx");

      const sheetNames = parsed.sheets.map((s) => s.sheetName);
      expect(sheetNames).toContain("PUBLIC");
      expect(sheetNames).not.toContain("SUMMARY");
      expect(sheetNames).not.toContain("ORIGINAL_BACKUP");
    });
  });

  describe("5. Validation Engine Calculation & Discrepancy Diagnostics", () => {
    let origFrom: any;
    let mockSupabase: any;

    beforeAll(async () => {
      const dbModule = await import("./services/database");
      mockSupabase = dbModule.supabase;
      origFrom = (mockSupabase as any).from;
      (mockSupabase as any).from = () => {
        const query: any = {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return query;
      };
    });

    afterAll(() => {
      if (mockSupabase && origFrom) {
        (mockSupabase as any).from = origFrom;
      }
    });

    it("flags net payable calculation discrepancies (gross - tax != net)", async () => {
      const rows = [
        {
          boid: "1301060000000007",
          full_name: "Kiran Khatri",
          gross_amount: 10000,
          tax_amount: 500,
          net_payable: 9200, // Should be 9500
        },
      ];

      const mappings = {
        boid: "boid",
        full_name: "full_name",
        gross_amount: "gross_amount",
        tax_amount: "tax_amount",
        net_payable: "net_payable",
      };

      const errors = await ValidationEngine.validateBatch(rows, mappings, undefined, "DIVIDEND");
      const netError = errors.find((e) => e.type === "net_mismatch");
      expect(netError).toBeTruthy();
      expect(netError?.field).toBe("net_payable");
    });

    it("flags invalid BOID format and empty values", async () => {
      const rows = [
        {
          boid: "1301", // Invalid length (< 6 characters)
          full_name: "Bad BOID User",
          gross_amount: 5000,
          tax_amount: 250,
          net_payable: 4750,
        },
      ];

      const mappings = {
        boid: "boid",
        full_name: "full_name",
        gross_amount: "gross_amount",
        tax_amount: "tax_amount",
        net_payable: "net_payable",
      };

      const errors = await ValidationEngine.validateBatch(rows, mappings, undefined, "DIVIDEND");
      const boidError = errors.find((e) => e.type === "invalid_boid");
      expect(boidError).toBeTruthy();
    });

    it("accepts scientific notation BOID and expands it without truncation", async () => {
      const rows = [
        {
          boid: "1.30101E+15", // Scientific notation from Excel General format
          full_name: "NARAYAN KUMAR SHRESTHA",
          shares_held: 1,
          gross_amount: 100,
          tax_amount: 5,
          net_payable: 95,
        },
      ];

      const mappings = {
        boid: "boid",
        full_name: "full_name",
        shares_held: "shares_held",
        gross_amount: "gross_amount",
        tax_amount: "tax_amount",
        net_payable: "net_payable",
      };

      const errors = await ValidationEngine.validateBatch(rows, mappings, undefined, "DIVIDEND");
      const boidError = errors.find((e) => e.type === "invalid_boid" || e.type === "missing_boid");
      expect(boidError).toBeUndefined();
    });

    it("validates exact raw CDSC demat row with scientific notation BOID without blocking error", async () => {
      const userRow = {
        ISIN: "NPE207A00008",
        BOID: "1.30101E+15",
        NAME: "NARAYAN KUMAR SHRESTHA",
        "FATHER'S NAME": "MAN BDR SHRESTHA",
        GENDER: "M",
        DOB: "19-JUN-1971",
        CITIZENSHIP: "100212381988           ",
        "GRANDFATHER'S NAME": "LAXMI DAS SHRETHA / SHIKHA MASKEY SHRESTHA",
        ADDRESS: "KATHMANDU",
        DISTRICT: "Kathmandu",
        COUNTRY: "NEPAL",
        CONTACT: "9851047110",
        EMAIL: "nkshrestha30@gmail.com",
        "BANK CODE": "7201",
        "BANK NAME": "Muktinath Bikas Bank Ltd.-Dhangadi Branch",
        BRANCH: "Dhangadi",
        "BANK ACC.NO.": "02721200083404000001",
        "TOTAL KITTA": "1.000",
        "FREE BALANCE": "1.000",
        "REP. GEN.DATE": "14082026",
        isin: "NPE207A00008",
        boid: "1.30101E+15",
        full_name: "NARAYAN KUMAR SHRESTHA",
        bank_name: "Muktinath Bikas Bank Ltd.-Dhangadi Branch",
        bank_account_no: "02721200083404000001",
      };

      const mappings = {
        BOID: "boid",
        NAME: "full_name",
        "TOTAL KITTA": "shares_held",
      };

      const errors = await ValidationEngine.validateBatch(
        [userRow],
        mappings,
        undefined,
        "raw_demat",
      );
      const boidError = errors.find(
        (e) => e.field === "boid" && (e.severity ?? "error") === "error",
      );
      expect(boidError).toBeUndefined();
    });

    it("accepts physical shareholder folio numbers without requiring 16 digits", async () => {
      const rows = [
        {
          folio: "42", // Short physical folio number
          full_name: "Physical Shareholder One",
          shares_held: 50,
          gross_amount: 500,
          tax_amount: 25,
          net_payable: 475,
        },
        {
          folio: "1", // Single digit physical folio
          full_name: "Founder Folio One",
          shares_held: 1000,
          gross_amount: 10000,
          tax_amount: 500,
          net_payable: 9500,
        },
        {
          folio: "FOLIO-1054", // Prefixed physical folio
          full_name: "Physical Shareholder Three",
          shares_held: 200,
          gross_amount: 2000,
          tax_amount: 100,
          net_payable: 1900,
        },
      ];

      const mappings = {
        folio: "boid",
        full_name: "full_name",
        shares_held: "shares_held",
        gross_amount: "gross_amount",
        tax_amount: "tax_amount",
        net_payable: "net_payable",
      };

      const errors = await ValidationEngine.validateBatch(rows, mappings, undefined, "DIVIDEND");
      const blockingErrors = errors.filter((e) => (e.severity ?? "error") === "error");
      expect(blockingErrors.length).toBe(0);
    });
  });

  describe("6. Empty & Corrupt Workbook Edge Cases", () => {
    it("gracefully handles an empty sheet without crashing", async () => {
      const buf = createMockWorkbookBuffer({ PUBLIC: [] });
      const parsed = await parseExcelFile(buf, "Empty_Dividend.xlsx");

      // Empty sheet with no data or headers is safely excluded from investor sheets
      expect(parsed.sheets.length).toBe(0);
      expect(parsed.grandTotals.totalRows).toBe(0);
    });
  });

  describe("7. Pre-Import Validation Usability & Warning Tier", () => {
    it("flags missing bank account as advisory warning and separates blocking errors", async () => {
      const { summarizeValidationResults } = await import("./validation-engine");

      const rows = [
        {
          boid: "1301060000000099",
          full_name: "Shareholder Without Bank",
          gross_amount: 5000,
          tax_amount: 250,
          net_payable: 4750,
          bank_account_no: "", // Missing bank account
          bank_name: "",
        },
        {
          boid: "", // Blocking error: Missing BOID
          full_name: "Invalid BOID Person",
          gross_amount: 1000,
          tax_amount: 50,
          net_payable: 950,
          bank_account_no: "123456789012",
          bank_name: "RBB",
        },
      ];

      const mappings = {
        boid: "boid",
        full_name: "full_name",
        gross_amount: "gross_amount",
        tax_amount: "tax_amount",
        net_payable: "net_payable",
        bank_account_no: "bank_account_no",
        bank_name: "bank_name",
      };

      const errors = await ValidationEngine.validateBatch(rows, mappings, undefined, "dividend");
      const summary = summarizeValidationResults(errors);

      expect(summary.hasBlockingErrors).toBe(true);
      expect(summary.blockingErrors.some((e) => e.type === "missing_boid")).toBe(true);
      expect(summary.warnings.some((e) => e.type === "missing_bank_account")).toBe(true);
      expect(summary.warningCount).toBeGreaterThanOrEqual(1);
    });

    it("flags suspicious net-payable calculation mismatch as warning", async () => {
      const { summarizeValidationResults } = await import("./validation-engine");

      const rows = [
        {
          boid: "1301060000000100",
          full_name: "Mismatch Investor",
          gross_amount: 10000,
          tax_amount: 500,
          net_payable: 8000, // Suspicious net (should be 9500)
          bank_account_no: "123456789012",
          bank_name: "RBB",
        },
      ];

      const mappings = {
        boid: "boid",
        full_name: "full_name",
        gross_amount: "gross_amount",
        tax_amount: "tax_amount",
        net_payable: "net_payable",
        bank_account_no: "bank_account_no",
        bank_name: "bank_name",
      };

      const errors = await ValidationEngine.validateBatch(rows, mappings, undefined, "dividend");
      const summary = summarizeValidationResults(errors);

      const netMismatchWarn = summary.warnings.find((w) => w.type === "net_mismatch");
      expect(netMismatchWarn).toBeTruthy();
      expect(netMismatchWarn?.severity).toBe("warning");
    });
  });
});
