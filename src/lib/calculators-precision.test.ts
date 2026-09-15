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
    expect(Math.round((result.grossCashDividend - result.totalTaxAmount) * 100) / 100).toBe(
      result.netCashPayable,
    );
  });

  it("handles combined bonus and cash dividends correctly", () => {
    const result = DividendCalculator.calculate({
      sharesHeld: 1000,
      dividendType: "Combined",
      bonusRatio: 0.1, // 10% bonus
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
    expect(Math.round((result.grossCashDividend - result.totalTaxAmount) * 100) / 100).toBe(
      result.netCashPayable,
    );
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
    expect(Math.round((result.grossPeriodInterest - result.taxAmount) * 100) / 100).toBe(
      result.netInterestPayable,
    );
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

describe("DividendCalculator & InterestCalculator Edge Cases", () => {
  it("supports custom face values such as Rs 10 and Rs 50", () => {
    const result = DividendCalculator.calculate({
      sharesHeld: 1000,
      dividendType: "Bonus",
      bonusRatio: 0.1, // 100 shares bonus
      faceValue: 10, // Rs 10 face value
      taxCategory: "PUBLIC", // 5%
    });

    expect(result.issuedBonusShares).toBe(100);
    // 100 bonus shares * Rs 10 face value * 5% tax = Rs 50 bonus tax (not Rs 500)
    expect(result.bonusTaxAmount).toBe(50);
  });

  it("calculates exact calendar days between fromDate and toDate without DST overshoot", () => {
    const fromDate = new Date("2026-01-01T00:00:00Z");
    const toDate = new Date("2026-04-01T00:00:00Z"); // 90 days

    const result = InterestCalculator.calculate({
      debentureKitta: 100,
      unitFaceValue: 1000,
      annualInterestRate: 10,
      fromDate,
      toDate,
      taxCategory: "PUBLIC",
    });

    expect(result.daysCount).toBe(90);
    expect(result.grossPeriodInterest).toBe(2465.75);
    expect(result.taxAmount).toBe(147.95);
    expect(result.netInterestPayable).toBe(2317.8);
  });

  it("caps and normalizes tax rates (handles negative, whole percentage, and over 100%)", () => {
    // Negative rate clamped to 0
    const negResult = DividendCalculator.calculate({
      sharesHeld: 100,
      dividendType: "Cash",
      cashDividendRate: 10,
      cashRateIsPerShare: true,
      taxCategory: "CUSTOM",
      customTaxRate: -0.1,
    });
    expect(negResult.appliedTdsRate).toBe(0);
    expect(negResult.totalTaxAmount).toBe(0);

    // Whole percentage (e.g. 15 for 15%) normalized to 0.15
    const pctResult = DividendCalculator.calculate({
      sharesHeld: 100,
      dividendType: "Cash",
      cashDividendRate: 10,
      cashRateIsPerShare: true,
      taxCategory: "CUSTOM",
      customTaxRate: 15,
    });
    expect(pctResult.appliedTdsRate).toBe(0.15);
    expect(pctResult.totalTaxAmount).toBe(150);

    // Over 100% capped at 1.0 (100%)
    const over100Result = DividendCalculator.calculate({
      sharesHeld: 100,
      dividendType: "Cash",
      cashDividendRate: 10,
      cashRateIsPerShare: true,
      taxCategory: "CUSTOM",
      customTaxRate: 150,
    });
    expect(over100Result.appliedTdsRate).toBe(1.0);
    expect(over100Result.totalTaxAmount).toBe(1000);
    expect(over100Result.netCashPayable).toBe(0);

    // Interest calculator normalization
    const intResult = InterestCalculator.calculate({
      debentureKitta: 100,
      unitFaceValue: 1000,
      annualInterestRate: 10,
      daysCount: 365,
      taxCategory: "CUSTOM",
      taxRate: 20, // 20%
    });
    expect(intResult.tdsRate).toBe(0.2);
    expect(intResult.taxAmount).toBe(2000);
  });
});
