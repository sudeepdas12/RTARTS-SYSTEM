import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { ExcelParser } from "./excel-parser";
import { ValidationEngine } from "./validation-engine";
import { BankParser } from "./bank-parser";
import { BankErrorProcessorService } from "./services/bank-error-processor.service";
import { smartClassify } from "./services/smart-classifier";
import { determineDebentureCategory } from "./services/debenture-summary-report.service";
import { mfSummaryType } from "./services/summary-report.service";
import { CdscBonusService } from "./services/cdsc-bonus.service";
import { ConnectIPSService } from "./services/connectips.service";
import { isIdentifierColumn } from "@/components/upload/import-preview";
import { PaymentService } from "./services/payment.service";
import { IpfService } from "./services/ipf.service";
import { vi } from "vitest";

function makeXlsxBuffer(sheets: Record<string, any[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

function makeWorkbookFile(sheets: Record<string, any[][]>, fileName: string): File {
  const buf = makeXlsxBuffer(sheets);
  return new File([buf], fileName, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("Stage 2: Real-World Parser, Classifier & Reconciliation Regressions", () => {
  it("P1: rejects bank statements uploaded as payable dividend files (RBB MF Electronic Account Statement pattern)", async () => {
    const buf = makeXlsxBuffer({
      Statement: [
        ["RASTRIYA BANIJYA BANK LIMITED"],
        ["ELECTRONIC ACCOUNT STATEMENT"],
        ["Account Holder Name:", "RBB MUTUAL FUND 1(CASH DIVIDEND)"],
        ["Account Number:", "1700100002650001"],
        ["Date", "Description", "Debit", "Credit", "Balance"],
        ["2026-08-01", "IPS Settlement", 50000, 0, 150000],
        ["2026-08-02", "Interest Credit", 0, 1200, 151200],
      ],
    });

    await expect(ExcelParser.parseBuffer(buf, "RBB MF 1 Cash Dividend.xlsx")).rejects.toThrow(
      /bank statement/i,
    );
  });

  it("P2: debenture sheet maps INT_AMT instead of AMOUNT (principal) and detects 8.5% coupon rate", async () => {
    const buf = makeXlsxBuffer({
      Public: [
        ["S.N.", "BOID", "NAME", "KITTA", "AMOUNT", "INT_AMT", "TAX", "NET_INT"],
        [1, "1301010000000001", "SITA RAM SHARMA", 1000, 1000000, 42500, 2550, 39950],
      ],
    });

    const parsed = await ExcelParser.parseBuffer(
      buf,
      "8.5% RBB DEBENTURE 2083 CALN ASAR END 2083_ORIGINAL.xlsx",
    );
    expect(parsed.fileType).toBe("debenture");
    expect(parsed.detectedRate).toBe(8.5);
    expect(parsed.sheets[0].totalAmount).toBe(42500);
    expect(parsed.sheets[0].totalNet).toBe(39950);
  });

  it("P3: protects TAX EXEMPTED retirement funds/trusts and classifies institutional suppliers at 15%", () => {
    const fund1 = smartClassify({
      full_name: "Nepal Bank Karmachari Awakash Kosh Byawasthapan Trust",
      sheetType: "TAX_EXEMPTED",
      lot_name: "TAX EXEMPTED",
    });
    expect(fund1.payee_classification).toBe("TAX_EXEMPT");
    expect(fund1.tds_rate_dividend).toBe(0);

    const fund2 = smartClassify({
      full_name: "RASTRIYA BANIJYA BANK RETIREMENT FUND",
      sheetType: "TAX_EXEMPTED",
      lot_name: "TAX EXEMPTED",
    });
    expect(fund2.payee_classification).toBe("TAX_EXEMPT");
    expect(fund2.tds_rate_dividend).toBe(0);

    const inst = smartClassify({
      full_name: "VALLEY VIEW SUPPLIER",
      sheetType: "INSTITUTION",
      lot_name: "INSTITUTION",
    });
    expect(inst.payee_classification).toBe("COMPANY_INSTITUTION");
    expect(inst.tds_rate_dividend).toBe(0.15);
  });

  it("P4: prioritizes shareholder NAME column over FATHER'S NAME on bonus calculation sheets", async () => {
    const buf = makeXlsxBuffer({
      "D-PROMOTER": [
        [
          "S.N.",
          "BOID",
          "FATHER'S NAME",
          "SHAREHOLDER NAME",
          "KITTA",
          "ACTUAL BONUS",
          "ISSUED BONUS",
        ],
        [1, "1301010000000002", "HARI BAHADUR THAPA", "KRISHNA THAPA", 100, 10, 10],
      ],
    });

    const parsed = await ExcelParser.parseBuffer(buf, "NLG BONUS CALCULATION LIST FY 2081-82.xlsx");
    const sheet = parsed.sheets[0];
    const mappedFullNameHeader = Object.entries(sheet.mapping).find(
      ([, field]) => field === "full_name",
    )?.[0];
    expect(mappedFullNameHeader?.toUpperCase()).toContain("SHAREHOLDER");
    expect(mappedFullNameHeader?.toUpperCase()).not.toContain("FATHER");
  });

  it("P5: ValidationEngine accounts for BON_TAX in net_mismatch verification", async () => {
    const mappings: Record<string, string> = {
      BOID: "boid",
      NAME: "full_name",
      GROSS: "cash_dividend",
      DIV_TAX: "div_tax",
      BON_TAX: "bon_tax",
      NET_PAY: "net_payable",
    };
    const rows = [
      {
        BOID: "1301010000000003",
        NAME: "GITA REGMI",
        GROSS: 10000,
        DIV_TAX: 500,
        BON_TAX: 250,
        NET_PAY: 9250,
      },
    ];

    const errors = await ValidationEngine.validateBatch(rows, mappings, undefined, "dividend", {
      isPreCalculated: false,
    });
    const mismatches = errors.filter((e) => e.type === "net_mismatch");
    expect(mismatches).toHaveLength(0);
  });

  it("P6: BankErrorProcessorService handles headerless sparse error rows and detects ACSC late returns", async () => {
    // 1. Headerless sparse ERROR REPORT with leading undefined/null cells
    const errFile = makeWorkbookFile(
      {
        Sheet1: [
          [undefined, null, "101", "AC_ERR_1", 5000, "FAILED", "Account closed"],
          [undefined, null, "102", "AC_ERR_2", 7500, "REJECTED", "Invalid account name"],
        ],
      },
      "ERROR REPORT 2026.10.05.xls",
    );
    const parsedErr = await BankErrorProcessorService.parseBankResponseFile(errFile);
    expect(parsedErr.errorRows.length).toBe(2);

    // 2. Late Return sheet where NCHL sets achStatus = ACSC
    const lateRtnFile = makeWorkbookFile(
      {
        "Late Return": [
          [
            "Instruction ID",
            "Account No",
            "Beneficiary Name",
            "Amount",
            "ACH Status",
            "Return Remarks",
          ],
          [
            "INS-LATE-1",
            "1002003004",
            "BIMAL ADHIKARI",
            4250,
            "ACSC - Accepted Settlement Completed",
            "Beneficiary A/C Dormant",
          ],
        ],
      },
      "20261005 late rtn.xlsx",
    );
    const parsedLate = await BankErrorProcessorService.parseBankResponseFile(lateRtnFile);
    expect(parsedLate.errorRows.length).toBe(1);
    expect(parsedLate.errorRows[0].amount).toBe(4250);
  });

  it("P7: BankParser validates reverse-chronological statement balance and recognizes Accepted Settlement Completed in CSV", async () => {
    const revChronFile = makeWorkbookFile(
      {
        Statement: [
          ["RASTRIYA BANIJYA BANK LIMITED"],
          ["Opening Balance:", "10000.00", "Closing Balance:", "8500.00"],
          ["Date", "Description", "Debit", "Credit", "Balance"],
          // Reverse chronological: newest first!
          ["2026-08-05", "IPS Payout 2", 1000, 0, 8500],
          ["2026-08-03", "IPS Payout 1", 500, 0, 9500],
        ],
      },
      "statement-2026-08-01-to-2026-08-10.xlsx",
    );
    const parsedMeta = await BankParser.parseBankStatementWithMetadata(revChronFile);
    expect(parsedMeta.metadata.isBalanced).toBe(true);

    const csvFile = new File(
      [
        "Instruction ID,Account Number,Beneficiary Name,Amount,Status,Remarks\n" +
          "CIPS-991,111222333,RAM THAPA,1500.00,Accepted Settlement Completed,Debenture Interest\n",
      ],
      "RBB DEBENTURE2026.10.06 ARKO 3.csv",
      { type: "text/csv" },
    );
    const csvTxns = await BankParser.parseBankStatement(csvFile);
    expect(csvTxns).toHaveLength(1);
    expect(csvTxns[0].status).toBe("ACSC");
  });

  it("P8: DebentureSummaryReportService does not misclassify BANK_FI (0% TDS) as MUTUAL FUND", () => {
    const cat = determineDebentureCategory({
      payee_classification: "BANK_FI",
      tds_rate: 0,
      client: { full_name: "RASTRIYA BANIJYA BANK LIMITED", holder_type: "Bank / FI" },
    });
    expect(cat).toBe("INSTITUTION");
  });

  it("P9: SummaryReportService.mfSummaryType routes UNCLASSIFIED to OTHERS and BANK_FI to INSTITUTION", () => {
    expect(mfSummaryType({ payee_classification: "UNCLASSIFIED", shares_held: 100 })).toBe(
      "OTHERS",
    );
    expect(mfSummaryType({ payee_classification: "BANK_FI", shares_held: 100 })).toBe(
      "INSTITUTION",
    );
    expect(mfSummaryType({ payee_classification: "TAX_EXEMPT", shares_held: 100 })).toBe(
      "MUTUAL FUND",
    );
  });

  it("P10: CdscBonusService generates CDSC RT tilde format (00~/01~/02~) alongside CAS fixed-width", () => {
    const rt = CdscBonusService.generateCdscRtTildeFile({
      companyId: "comp-1",
      companyName: "Test Hydro Ltd",
      companyCode: "THL",
      isin: "NP0000000001",
      fiscalYear: "2081/82",
      bonusRatio: 10,
      cashDividendRatio: 5,
      faceValue: 100,
      taxMode: "CASH_ADJUSTED",
      totalEligibleShareholders: 2,
      totalExistingKitta: 1000,
      totalGrossBonusShares: 100,
      totalCreditedBonusKitta: 100,
      totalFreeBonusKitta: 40,
      totalLockedBonusKitta: 60,
      totalFractionalKitta: 0,
      totalBonusShareTax: 500,
      totalFractionalGrossCash: 0,
      totalFractionalTaxAmount: 0,
      totalFractionalNetPayable: 0,
      totalInvestorTaxPayable: 0,
      validBoidCount: 2,
      invalidBoidCount: 0,
      rows: [
        {
          sn: 1,
          clientId: "c1",
          boid: "1301010000000001",
          shareholderName: "PUBLIC HOLDER",
          holderType: "Natural Person - Public",
          lockInCode: "00",
          lockInReason: "",
          lockInExpiryDate: "00000000",
          existingKitta: 400,
          bonusRatio: 10,
          cashDividendRatio: 5,
          grossBonusShares: 40,
          creditedBonusKitta: 40,
          fractionalKitta: 0,
          afterBonusKitta: 440,
          postBonusKitta: 440,
          faceValue: 100,
          bonusTaxRate: 0.05,
          bonusShareTaxPayable: 200,
          fractionalGrossCash: 0,
          fractionalTaxAmount: 0,
          fractionalNetPayable: 0,
          grossCashDividend: 2000,
          cashDividendTds: 100,
          netCashPayableCombined: 1700,
          taxPayableByInvestor: 0,
          validationStatus: "VALID",
        },
        {
          sn: 2,
          clientId: "c2",
          boid: "1301010000000002",
          shareholderName: "PROMOTER HOLDER",
          holderType: "Natural Person - Promoter",
          lockInCode: "01",
          lockInReason: "PROMOTER LOCKIN",
          lockInExpiryDate: "31122027",
          existingKitta: 600,
          bonusRatio: 10,
          cashDividendRatio: 5,
          grossBonusShares: 60,
          creditedBonusKitta: 60,
          fractionalKitta: 0,
          afterBonusKitta: 660,
          postBonusKitta: 660,
          faceValue: 100,
          bonusTaxRate: 0.05,
          bonusShareTaxPayable: 300,
          fractionalGrossCash: 0,
          fractionalTaxAmount: 0,
          fractionalNetPayable: 0,
          grossCashDividend: 3000,
          cashDividendTds: 150,
          netCashPayableCombined: 2550,
          taxPayableByInvestor: 0,
          validationStatus: "VALID",
        },
      ],
    });
    const lines = rt.trim().split(/\r?\n/);
    expect(lines[0]).toMatch(/^00~NP0000000001~THL~2~40\.000~60\.000/);
    expect(lines[1]).toBe("01~1301010000000001~40.000~10");
    expect(lines[2]).toBe("02~1301010000000002~60.000~01~31122027~PROMOTER LOCKIN");
  });

  it("P11: ImportPreview preserves BOID/PAN/Account identifiers without currency formatting and ConnectIPS refuses silent simulated PROD payout", async () => {
    expect(isIdentifierColumn("BOID", "boid")).toBe(true);
    expect(isIdentifierColumn("BANK A/C NO.", "bank_account_no")).toBe(true);
    expect(isIdentifierColumn("GROSS DIVIDEND", "cash_dividend")).toBe(false);

    const { SettingsService } = await import("./services/settings.service");
    const getSettingsSpy = vi.spyOn(SettingsService, "getSettings").mockResolvedValue({
      connectips_enabled: true,
      connectips_mode: "PRODUCTION",
      connectips_merchant_id: "M1",
      connectips_app_id: "A1",
    } as any);
    const exportSpy = vi
      .spyOn(PaymentService, "getAllLineItemsForExport")
      .mockResolvedValue([{ id: "item-1", net_amount: 500, bank_account_no: "12345" }] as any);

    await expect(ConnectIPSService.disbursePaymentBatch("batch-1")).rejects.toThrow(
      /PRODUCTION|mTLS|SANDBOX/i,
    );

    getSettingsSpy.mockRestore();
    exportSpy.mockRestore();
  });

  it("P12: IpfService includes interest_payables and PaymentService.getPayablesForPayment prevents double-proration on stored semi-annual coupons", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const sampleInterestRow = {
      id: "int-183",
      company_id: "comp-1",
      client_id: "cli-1",
      gross_interest: 50000,
      tax_amount: 3000,
      net_payable: 47000,
      remaining_amount: 47000,
      days_count: 183,
      payment_status: "Pending",
      created_at: "2020-01-01T00:00:00Z",
      client: { id: "cli-1", full_name: "RAM SHARMA", boid: "1301010000000009" },
      company: { company_name: "RBB Debenture", company_code: "RBBD" },
    };

    const makeChain = (rows: any[]) => {
      const chain: any = {
        select: () => chain,
        in: () => chain,
        eq: () => chain,
        neq: () => chain,
        gte: () => chain,
        lte: () => chain,
        order: () => chain,
        range: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: any, reject?: any) =>
          Promise.resolve({ data: rows, error: null }).then(resolve, reject),
      };
      return chain;
    };

    const fromSpy = vi.spyOn(supabase, "from").mockImplementation((table: string) => {
      if (table === "interest_payables") return makeChain([sampleInterestRow]);
      return makeChain([]);
    });

    const ipf = await IpfService.getIpfAgingReport({ asOfDate: new Date("2026-06-01T00:00:00Z") });
    expect(ipf.totalUnclaimedCount).toBe(1);
    expect(ipf.items[0].paymentType).toBe("INTEREST");
    expect(ipf.items[0].netPayable).toBe(47000);

    const payableItems = await PaymentService.getPayablesForPayment("comp-1", "interest", {
      periodPreset: "6M",
      periodDays: 183,
    });
    expect(payableItems).toHaveLength(1);
    // Stored days_count=183 gross=50000 must stay 50000 (never re-divided by 365 * 183)
    expect(Number(payableItems[0].gross_interest)).toBe(50000);
    expect(Number(payableItems[0].tax_amount)).toBe(3000);
    expect(Number(payableItems[0].net_payable)).toBe(47000);

    fromSpy.mockRestore();
  });
});
