import { describe, it, expect } from "vitest";
import { DividendCalculator } from "./dividend-calculator";
import { InterestCalculator } from "./interest-calculator";
import { formatCurrencyNPR, formatCount, parseFormattedNumber } from "./currency";

describe("DividendCalculator Precision", () => {
  it("calculates exact paisa without floating point net discrepancy", () => {
    const result = DividendCalculator.calculate({
      sharesHeld: 153,
      dividendType: "Cash",
      cashDividendRate: 5.631,
      cashRateIsPerShare: true,
      taxCategory: "PUBLIC",
    });

    expect(result.grossCashDividend).toBe(861.54);
    expect(result.cashTaxAmount).toBe(43.08);
    expect(result.netCashPayable).toBe(818.46);
    expect(Math.round((result.grossCashDividend - result.totalTaxAmount) * 100) / 100).toBe(result.netCashPayable);
  });

  it("handles combined bonus and cash dividends correctly", () => {
    const result = DividendCalculator.calculate({
      sharesHeld: 1000,
      dividendType: "Combined",
      bonusRatio: 0.10, // 10% bonus
      cashDividendRate: 5, // 5% cash
      cashRateIsPerShare: false, // 5% of Rs 100 face value
      taxCategory: "PUBLIC",
    });

    expect(result.issuedBonusShares).toBe(100);
    expect(result.afterBonusKitta).toBe(1100);
    // Cash dividend on after-bonus kitta: 1100 * 100 * 5% = 5500
    expect(result.grossCashDividend).toBe(5500);
    // Bonus Tax: 100 * 100 * 5% = 500
    expect(result.bonusTaxAmount).toBe(500);
    // Cash Tax: 5500 * 5% = 275
    expect(result.cashTaxAmount).toBe(275);
    expect(result.totalTaxAmount).toBe(775);
    expect(result.netCashPayable).toBe(4725);
    expect(Math.round((result.grossCashDividend - result.totalTaxAmount) * 100) / 100).toBe(result.netCashPayable);
  });
});

describe("InterestCalculator Precision", () => {
  it("calculates daily coupon interest with exact rounded net payable", () => {
    const result = InterestCalculator.calculate({
      debentureKitta: 250,
      unitFaceValue: 1000,
      annualInterestRate: 8.5,
      daysCount: 91, // 91 days
      taxCategory: "PUBLIC", // 6% debenture TDS
    });

    expect(result.totalPrincipal).toBe(250000);
    expect(result.annualInterestAmount).toBe(21250);
    expect(result.grossPeriodInterest).toBe(5297.95);
    expect(result.taxAmount).toBe(317.88);
    expect(result.netInterestPayable).toBe(4980.07);
    expect(Math.round((result.grossPeriodInterest - result.taxAmount) * 100) / 100).toBe(result.netInterestPayable);
  });

  it("exempts mutual funds from debenture coupon tax", () => {
    const result = InterestCalculator.calculate({
      debentureKitta: 500,
      unitFaceValue: 1000,
      annualInterestRate: 7,
      daysCount: 182,
      taxCategory: "MUTUAL_FUND",
    });

    expect(result.tdsRate).toBe(0.0);
    expect(result.taxAmount).toBe(0);
    expect(result.netInterestPayable).toBe(result.grossPeriodInterest);
  });
});

describe("Currency formatting utilities", () => {
  it("formats numbers in en-IN lakhs/crores format", () => {
    expect(formatCurrencyNPR(1000000)).toBe("10,00,000.00");
    expect(formatCurrencyNPR(5300.68)).toBe("5,300.68");
    expect(formatCurrencyNPR(null)).toBe("—");
    expect(formatCount(1500000)).toBe("15,00,000");
    expect(parseFormattedNumber("10,00,000.00")).toBe(1000000);
  });
});
