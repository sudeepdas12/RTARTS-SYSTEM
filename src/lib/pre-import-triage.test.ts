import { describe, expect, it } from "vitest";
import type { ParsedExcelData } from "./excel-parser";
import { evaluateWorkbookTriage, resolveMappedSheetColumns } from "./pre-import-triage";

describe("pre-import-triage & column resolution", () => {
  it("resolves inverted mapping and captures both div_tax and bon_tax", () => {
    const cols = resolveMappedSheetColumns({
      headers: ["BOID", "SHAREHOLDER NAME", "GROSS DIV", "DIV_TAX", "BON_TAX", "NET PAYABLE"],
      mapping: {
        BOID: "boid",
        "SHAREHOLDER NAME": "full_name",
        "GROSS DIV": "cash_dividend",
        DIV_TAX: "div_tax",
        BON_TAX: "bon_tax",
        "NET PAYABLE": "net_payable",
      },
    });
    expect(cols.boidCol).toBe("BOID");
    expect(cols.nameCol).toBe("SHAREHOLDER NAME");
    expect(cols.grossCol).toBe("GROSS DIV");
    expect(cols.cashTaxCol).toBe("DIV_TAX");
    expect(cols.bonusTaxCol).toBe("BON_TAX");
    expect(cols.netCol).toBe("NET PAYABLE");
  });

  it("flags father's name collisions, scientific BOIDs, debenture principal AMOUNT, and retirement trust verification", () => {
    const parsed: ParsedExcelData = {
      fileType: "debenture",
      fileName: "DEBENTURE_TEST.xlsx",
      sheets: [
        {
          sheetName: "PUBLIC",
          sheetType: "PUBLIC",
          defaultTdsRate: 0.06,
          headers: ["BOID", "FATHER'S NAME", "AMOUNT", "NET"],
          mapping: {
            BOID: "boid",
            "FATHER'S NAME": "full_name",
            AMOUNT: "cash_dividend",
            NET: "net_payable",
          },
          rows: [
            {
              BOID: "1.30102E+15",
              "FATHER'S NAME": "RASTRIYA BANIJYA BANK RETIREMENT FUND",
              AMOUNT: 5000000,
              NET: 425000,
            },
          ],
          rowCount: 1,
          totalKitta: 0,
          totalAmount: 5000000,
          totalTax: 0,
          totalNet: 425000,
          isPreCalculated: true,
          isRawInputFile: false,
        },
        {
          sheetName: "TAX_EXEMPTED",
          sheetType: "TAX_EXEMPTED",
          defaultTdsRate: 0,
          headers: ["BOID", "NAME", "INT_AMT", "NET"],
          mapping: {
            BOID: "boid",
            NAME: "full_name",
            INT_AMT: "cash_dividend",
            NET: "net_payable",
          },
          rows: [
            {
              BOID: "1301020000000001",
              NAME: "CITIZEN INVESTMENT TRUST",
              INT_AMT: 100000,
              NET: 100000,
            },
          ],
          rowCount: 1,
          totalKitta: 0,
          totalAmount: 100000,
          totalTax: 0,
          totalNet: 100000,
          isPreCalculated: true,
          isRawInputFile: false,
        },
      ],
      grandTotals: {
        totalRows: 2,
        totalKitta: 0,
        totalAmount: 5100000,
        totalTax: 0,
        totalNet: 525000,
      },
    };

    const report = evaluateWorkbookTriage(parsed);
    expect(report.detectedFileType).toBe("debenture");
    expect(report.taxExemptSheetCount).toBe(1);
    expect(report.suspiciousBoidCount).toBe(1);
    expect(report.reviewSuspectCount).toBe(1);
    const codes = report.findings.map((f) => f.code);
    expect(codes).toContain("FATHER_NAME_COLLISION");
    expect(codes).toContain("DEBENTURE_PRINCIPAL_AMOUNT_RISK");
    expect(codes).toContain("IDENTIFIER_PRECISION_RISK");
    expect(codes).toContain("RETIREMENT_FUND_VERIFICATION");
  });
});
