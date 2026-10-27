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
});
