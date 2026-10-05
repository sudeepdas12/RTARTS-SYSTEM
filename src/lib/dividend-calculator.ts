export interface DividendCalculationParams {
  sharesHeld: number;
  dividendType: "Cash" | "Stock" | "Bonus" | "Right" | "Combined";
  cashDividendRate?: number; // e.g. 5.631 for Rs 5.631 per share OR 10 for 10%
  cashRateIsPerShare?: boolean; // true if Rs 5.631 per share, false if percentage of face value
  bonusRatio?: number; // e.g. 0.07 for 7% bonus
  taxCategory?:
    | "PUBLIC"
    | "INSTITUTION"
    | "TAX_EXEMPT"
    | "TAX_EXEMPTED"
    | "MUTUAL_FUND"
    | "PROMOTER"
    | "LOCAL"
    | "EMPLOYEE"
    | "FOREIGN"
    | "FOREIGN_INVESTOR"
    | "CUSTOM";
  customTaxRate?: number; // e.g. 0.15 for 15%
  faceValue?: number; // Default 100
  cashOnPreBonus?: boolean; // Default false; if true, calculates cash on pre-bonus capital
}

export interface DividendResult {
  exactBonusShares: number;
  issuedBonusShares: number;
  fractionBonusShares: number;
  afterBonusKitta: number;
  preBonusKitta: number;
  kittaForCash: number;
  grossCashDividend: number;
  bonusTaxAmount: number;
  cashTaxAmount: number;
  totalTaxAmount: number;
  netCashPayable: number;
  taxPayableByInvestor: number;
  appliedTdsRate: number;
}

/**
 * Round a money value to 2 decimals (paisa), half away from zero, exactly like Postgres round(numeric, 2).
 * Plain Math.round(x * 100) mis-rounds values such as 2256.345 or 16932.255 because of binary float noise;
 * toPrecision(15) strips that noise before rounding.
 */
export function roundToPaisa(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = Number((Math.abs(value) * 100).toPrecision(15));
  const rounded = Math.round(scaled) / 100;
  return value < 0 ? -rounded : rounded;
}

export function normalizeTaxRate(rate: number): number {
  if (isNaN(rate) || rate <= 0) return 0;
  // Fractions below 1 (0.05, 0.15) are decimal rates and values from 2 to 100 are whole percentages.
  // Exactly 1 is ambiguous; a 100% TDS rate is never legitimate, so it is read as "1%" rather than 100%.
  if (rate === 1) return 0.01;
  if (rate > 1 && rate <= 100) return rate / 100;
  // Above 100 is capped at 100% (existing contract; see calculators-precision.test.ts)
  return Math.min(1.0, rate);
}

export const DividendCalculator = {
  calculate(params: DividendCalculationParams): DividendResult {
    const faceValue = Math.max(0, params.faceValue ?? 100);
    const sharesHeld = Math.max(0, params.sharesHeld ?? 0);

    // Determine TDS Rate by Category (Nepal Income Tax Act)
    let appliedTdsRate = 0.05; // Default 5% for Natural Person (Public, Promoter, Local, Employee)
    if (
      params.taxCategory === "TAX_EXEMPT" ||
      params.taxCategory === "TAX_EXEMPTED" ||
      params.taxCategory === "MUTUAL_FUND"
    ) {
      appliedTdsRate = 0.0; // 0% for Mutual Fund / Tax Exempt (Section 88(4))
    } else if (params.taxCategory === "INSTITUTION") {
      appliedTdsRate = 0.05; // 5% for Corporate / Institutional resident dividends (Income Tax Act Sec 88(2)(ka))
    } else if (params.taxCategory === "FOREIGN_INVESTOR") {
      appliedTdsRate = 0.05; // 5% for Foreign Investors (Sec 92 final withholding)
    } else if (params.taxCategory === "FOREIGN") {
      appliedTdsRate = 0.05; // 5% for individual foreign nationals (same as public)
    } else if (params.taxCategory === "CUSTOM" && params.customTaxRate !== undefined) {
      appliedTdsRate = normalizeTaxRate(params.customTaxRate);
    }

    // 1. Bonus / Right Share Calculations
    let exactBonusShares = 0;
    let issuedBonusShares = 0;
    let fractionBonusShares = 0;
    let afterBonusKitta = sharesHeld;

    const bonusRatio = Math.max(0, params.bonusRatio ?? 0);
    if (
      (params.dividendType === "Bonus" ||
        params.dividendType === "Stock" ||
        params.dividendType === "Combined") &&
      bonusRatio > 0
    ) {
      exactBonusShares = sharesHeld * bonusRatio;
      issuedBonusShares = Math.floor(Math.round(exactBonusShares * 1e8) / 1e8);
      fractionBonusShares = Number((exactBonusShares - issuedBonusShares).toFixed(6));
      // Only whole shares are issued
      afterBonusKitta = sharesHeld + issuedBonusShares;
    }

    // 2. Gross Cash Dividend Calculation
    let grossCashDividend = 0;
    const cashDividendRate = Math.max(0, params.cashDividendRate ?? 0);
    const kittaForCash = params.cashOnPreBonus
      ? sharesHeld
      : params.dividendType === "Combined"
        ? afterBonusKitta
        : sharesHeld;

    if (cashDividendRate > 0) {
      if (params.cashRateIsPerShare) {
        grossCashDividend = kittaForCash * cashDividendRate;
      } else {
        // Percentage of face value (e.g. 10% of Rs 100 face value)
        grossCashDividend = (kittaForCash * faceValue * cashDividendRate) / 100;
      }
    }

    // Round gross financial component to exact paisa first (database trigger parity)
    const rGross = roundToPaisa(grossCashDividend);

    // 3. Tax Calculations (Bonus Tax + Cash Dividend Tax)
    // Bonus Tax: Issued Bonus Shares * Face Value * TDS Rate
    let bonusTaxAmount = 0;
    if (
      params.dividendType === "Bonus" ||
      params.dividendType === "Stock" ||
      params.dividendType === "Combined"
    ) {
      bonusTaxAmount = issuedBonusShares * faceValue * appliedTdsRate;
    }

    // Cash Dividend Tax: Computed from rounded Gross * TDS Rate
    const cashTaxAmount = rGross * appliedTdsRate;
    const rCashTax = roundToPaisa(cashTaxAmount);
    const rBonusTax = roundToPaisa(bonusTaxAmount);
    const rTotalTax = roundToPaisa(rCashTax + rBonusTax);

    // Net Cash Payable: Cash dividend minus total tax on cash and bonus
    const rawNet = roundToPaisa(rGross - rTotalTax);
    const netCashPayable = Math.max(0, rawNet);
    const taxPayableByInvestor = rawNet < 0 ? Math.abs(rawNet) : 0;

    return {
      exactBonusShares: Math.round(exactBonusShares * 10000) / 10000,
      issuedBonusShares,
      fractionBonusShares: Math.round(fractionBonusShares * 10000) / 10000,
      afterBonusKitta: Math.round(afterBonusKitta * 10000) / 10000,
      preBonusKitta: sharesHeld,
      kittaForCash,
      grossCashDividend: rGross,
      bonusTaxAmount: rBonusTax,
      cashTaxAmount: rCashTax,
      totalTaxAmount: rTotalTax,
      netCashPayable,
      taxPayableByInvestor,
      appliedTdsRate,
    };
  },
};
