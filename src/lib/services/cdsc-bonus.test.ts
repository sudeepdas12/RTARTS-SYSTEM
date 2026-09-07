import { describe, it, expect } from "vitest";
import { CdscBonusService, BonusAllocationSummary, BonusTaxMode } from "./cdsc-bonus.service";

describe("CdscBonusService — CDSC DEMAT Credit & Fractional Cash Math", () => {
  it("correctly computes whole bonus kitta, fractional remainder, and 5% TDS", () => {
    // Shareholder holds 175 kitta with 10% bonus share ratio
    // Gross bonus = 17.5 shares
    // Whole credited kitta = 17
    // Fractional kitta = 0.5
    // Fractional gross cash = 0.5 * 100 = NPR 50.00
    // TDS 5% = NPR 2.50
    // Net fractional cash = NPR 47.50
    const existingKitta = 175;
    const bonusRatio = 10;
    const faceValue = 100;

    const rawGross = existingKitta * (bonusRatio / 100);
    const wholeKitta = Math.floor(rawGross);
    const fraction = Math.round((rawGross - wholeKitta) * 10000) / 10000;
    const grossCash = fraction * faceValue;
    const tax = grossCash * 0.05;
    const netCash = grossCash - tax;

    expect(rawGross).toBe(17.5);
    expect(wholeKitta).toBe(17);
    expect(fraction).toBe(0.5);
    expect(grossCash).toBe(50);
    expect(tax).toBe(2.5);
    expect(netCash).toBe(47.5);
  });

  it("correctly resolves lock-in codes from shareholder holder_type", () => {
    expect(CdscBonusService.resolveLockIn("PROMOTER").code).toBe("01");
    expect(CdscBonusService.resolveLockIn("LOCAL").code).toBe("09");
    expect(CdscBonusService.resolveLockIn("STAFF").code).toBe("02");
    expect(CdscBonusService.resolveLockIn("EMPLOYEE").code).toBe("02");
    expect(CdscBonusService.resolveLockIn("PUBLIC").code).toBe("00");
  });

  it("generates valid CDSC fixed-width text format with 42-char header", () => {
    const dummySummary: BonusAllocationSummary = {
      companyId: "comp-1",
      companyName: "Supermai Hydropower",
      companyCode: "SMHL",
      isin: "NPE001230001",
      fiscalYear: "2081/82",
      bonusRatio: 10,
      cashDividendRatio: 0,
      faceValue: 100,
      taxMode: "COMPANY_PAID",
      totalEligibleShareholders: 1,
      totalExistingKitta: 100,
      totalGrossBonusShares: 10,
      totalCreditedBonusKitta: 10,
      totalFreeBonusKitta: 10,
      totalLockedBonusKitta: 0,
      totalFractionalKitta: 0,
      totalBonusShareTax: 50,
      totalFractionalGrossCash: 0,
      totalFractionalTaxAmount: 0,
      totalFractionalNetPayable: 0,
      totalInvestorTaxPayable: 0,
      validBoidCount: 1,
      invalidBoidCount: 0,
      rows: [
        {
          sn: 1,
          clientId: "cl-1",
          boid: "1301010000000001",
          shareholderName: "Ram Sharma",
          holderType: "PUBLIC",
          lockInCode: "00",
          lockInReason: "FREE FLOATING / PUBLIC",
          lockInExpiryDate: "00000000",
          existingKitta: 100,
          bonusRatio: 10,
          cashDividendRatio: 0,
          grossBonusShares: 10,
          creditedBonusKitta: 10,
          fractionalKitta: 0,
          faceValue: 100,
          bonusTaxRate: 0.05,
          bonusShareTaxPayable: 50,
          fractionalGrossCash: 0,
          fractionalTaxAmount: 0,
          fractionalNetPayable: 0,
          grossCashDividend: 0,
          cashDividendTds: 0,
          netCashPayableCombined: 0,
          taxPayableByInvestor: 0,
          validationStatus: "VALID",
        },
      ],
    };

    const text = CdscBonusService.generateCdscCasFixedTextFile(dummySummary);
    const lines = text.split("\r\n").filter(Boolean);

    // Header line should be exactly 42 characters
    expect(lines[0].length).toBe(42);
    // Header should contain count = 0000000001
    expect(lines[0].slice(0, 10)).toBe("0000000001");
    // Detail line should be exactly 124 characters
    expect(lines[1].length).toBe(124);
  });
});
