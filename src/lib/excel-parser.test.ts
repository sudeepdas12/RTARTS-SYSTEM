import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { ExcelParser } from "./excel-parser";

describe("ExcelParser Resilience and Memory Protection", () => {
  it("parses CSV buffers safely without RangeError: Invalid string length", async () => {
    const csvContent =
      "BOID,SHAREHOLDER NAME,TOTAL KITTA,DIVIDEND\n" +
      "1301010000000001,RAM BAHADUR SHRESTHA,100,500\n" +
      "1301010000000002,SITA KUMARI DAHAL,200,1000\n";

    const encoder = new TextEncoder();
    const buffer = encoder.encode(csvContent);

    const result = await ExcelParser.parseBuffer(buffer, "cds_export.csv");
    expect(result.sheets.length).toBeGreaterThanOrEqual(1);
    expect(result.grandTotals.totalRows).toBe(2);
    expect(result.grandTotals.totalKitta).toBe(300);
  });

  it("handles inflated worksheet !ref (e.g. A1:Z1048576) without memory explosion", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["BOID", "SHAREHOLDER NAME", "TOTAL KITTA"],
      ["1301010000000001", "RAM BAHADUR", 100],
      ["1301010000000002", "SITA KUMARI", 200],
    ]);
    // Simulate Excel saving formatted empty columns down to max row
    ws["!ref"] = "A1:Z1048576";
    XLSX.utils.book_append_sheet(wb, ws, "PUBLIC");

    const result = ExcelParser.parseWorkbook(wb, "NABIL_DIVIDEND.xlsx");
    expect(result.sheets.length).toBe(1);
    const sheet = result.sheets[0];
    // Must NOT have 1 million rows
    expect(sheet.rows.length).toBe(2);
    expect(sheet.totalKitta).toBe(300);
  });

  it("correctly identifies file types using constrained range sampling", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["BOID", "NAME", "COUPON AMOUNT", "NET INTEREST"],
      ["1301010000000001", "INVESTOR A", 5000, 4700],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

    const result = ExcelParser.parseWorkbook(wb, "statement.xlsx");
    expect(result.fileType).toBe("debenture");
  });

  it("retains standalone summary reports (e.g. FY_Summary_Report) without returning 0 sheets", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["TEST COMPANY — MULTI-YEAR STATUTORY FISCAL RECONCILIATION SUMMARY"],
      ["Generated at: 10/27/2026, 9:13:38 AM"],
      [],
      [
        "Fiscal Year",
        "Corporate Event Name",
        "Total Holding Kitta",
        "Gross Cash Dividend (NPR)",
        "Tax Withheld (NPR)",
        "Net Cash Payable (NPR)",
      ],
      ["2072/73", "11th AGM", 100, 50, 2.5, 47.5],
      ["2073/74", "12th AGM", 120, 60, 3.0, 57.0],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "FY_Summary_Report");

    const result = ExcelParser.parseWorkbook(wb, "test.xlsx");
    expect(result.sheets.length).toBe(1);
    expect(result.sheets[0].sheetName).toBe("FY_Summary_Report");
    expect(result.sheets[0].sheetType).toBe("SUMMARY");
    expect(result.sheets[0].rows.length).toBe(2);
    expect(result.sheets[0].totalKitta).toBe(220);
    expect(result.sheets[0].totalAmount).toBe(110);
  });

  it("recovers 16-digit integers without precision loss from scientific notation cells", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["BOID", "NAME", "TOTAL KITTA"],
      ["1.30101E+15", "NARAYAN KUMAR SHRESTHA", 100],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "PUBLIC");

    const result = ExcelParser.parseWorkbook(wb, "dividend.xlsx");
    expect(result.sheets.length).toBe(1);
    expect(result.sheets[0].rows[0].boid).toBe("1301010000000000");
  });

  it("safely handles corrupted astronomical scientific notation without Invalid string length error", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["BOID", "NAME", "CITIZENSHIP", "TOTAL KITTA"],
      ["1301010000000001", "BHUWAN SHRESTHA", "1.044E+331782000", 100],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "PUBLIC");

    const result = ExcelParser.parseWorkbook(wb, "dividend.xlsx");
    expect(result.sheets.length).toBe(1);
    expect(result.sheets[0].rows[0].citizenship).toBe("1.044E+331782000");
    // Ensure serialization works without RangeError
    const serialized = JSON.stringify(result);
    expect(serialized.length).toBeGreaterThan(0);
  });

  it("caps oversized cell values exceeding 1,000 characters to protect memory and payloads", () => {
    const wb = XLSX.utils.book_new();
    const giantString = "A".repeat(5000);
    const ws = XLSX.utils.aoa_to_sheet([
      ["BOID", "NAME", "REMARKS", "TOTAL KITTA"],
      ["1301010000000001", "TEST USER", giantString, 50],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "PUBLIC");

    const result = ExcelParser.parseWorkbook(wb, "oversized.xlsx");
    const row = result.sheets[0].rows[0];
    const remarksVal = row.remarks || row["REMARKS"];
    expect(remarksVal).toBeDefined();
    expect(remarksVal.length).toBe(1000);
  });
});
