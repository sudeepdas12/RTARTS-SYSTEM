import { describe, it, expect } from "vitest";
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
});
