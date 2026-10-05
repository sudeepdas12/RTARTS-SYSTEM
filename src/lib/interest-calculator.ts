import { normalizeTaxRate, roundToPaisa } from "./dividend-calculator";

export interface InterestCalculationParams {
  debentureKitta: number; // Number of debentures held
  unitFaceValue?: number; // Default NPR 1000 per debenture
  annualInterestRate: number; // e.g. 7 for 7%
  fromDate?: Date;
  toDate?: Date;
  daysCount?: number; // explicit day count
  dayCountConvention?: "ACTUAL_365" | "30_360";
  couponFrequency?: "SEMI_ANNUAL" | "ANNUAL" | "DAY_COUNT";
  taxRate?: number; // e.g. 0.06 for 6% TDS
  taxCategory?:
    | "PUBLIC"
    | "PRIVATE"
    | "TAX_EXEMPT"
    | "MUTUAL_FUND"
    | "INSTITUTION"
    | "TAX_EXEMPTED"
    | "FOREIGN_INVESTOR"
    | "BANK_FI"
    | "PROMOTER"
    | "LOCAL"
    | "EMPLOYEE"
    | "CUSTOM";
}

export interface InterestResult {
  totalPrincipal: number;
  annualInterestAmount: number;
  dailyInterestRate: number;
  daysCount: number;
  grossPeriodInterest: number;
  tdsRate: number;
  taxAmount: number;
  netInterestPayable: number;
}

export const InterestCalculator = {
  calculate(params: InterestCalculationParams): InterestResult {
    const faceValue = Math.max(0, params.unitFaceValue ?? 1000);
    const debentureKitta = Math.max(0, params.debentureKitta ?? 0);
    const totalPrincipal = debentureKitta * faceValue;

    // Annual Interest (e.g. 7% of total principal)
    const annualInterestRate = Math.max(0, params.annualInterestRate ?? 0);
    const annualInterestAmount = (totalPrincipal * annualInterestRate) / 100;

    // Daily Interest based on convention (defaults to 365-day)
    const convention = params.dayCountConvention ?? "ACTUAL_365";
    const divisor = convention === "30_360" ? 360 : 365;
    const dailyInterestRate = divisor > 0 ? annualInterestAmount / divisor : 0;

    // Compute days from dates if not explicitly provided
    let days = Math.max(0, params.daysCount ?? 0);
    if (!days && params.fromDate && params.toDate) {
      const fromTime = params.fromDate.getTime();
      const toTime = params.toDate.getTime();
      if (!isNaN(fromTime) && !isNaN(toTime) && toTime > fromTime) {
        if (convention === "30_360") {
          let d1 = params.fromDate.getDate();
          let d2 = params.toDate.getDate();
          const m1 = params.fromDate.getMonth();
          const m2 = params.toDate.getMonth();
          const y1 = params.fromDate.getFullYear();
          const y2 = params.toDate.getFullYear();

          // Standard ISDA 30/360 day count convention month-end adjustments
          if (d1 === 31) d1 = 30;
          if (d2 === 31 && d1 >= 30) d2 = 30;

          // Handle February end (day 28 or 29)
          const isFeb1 = m1 === 1 && (d1 === 28 || d1 === 29);
          const isFeb2 = m2 === 1 && (d2 === 28 || d2 === 29);
          if (isFeb1) d1 = 30;
          if (isFeb2 && isFeb1) d2 = 30;

          days = Math.max(0, (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1));
        } else {
          const timeDiff = toTime - fromTime;
          days = Math.max(0, Math.round(timeDiff / (1000 * 3600 * 24)));
        }
      }
    }

    // High-precision Gross Period Interest (direct or fixed coupon frequency)
    let grossPeriodInterest = 0;
    if (params.couponFrequency === "SEMI_ANNUAL") {
      grossPeriodInterest = (totalPrincipal * annualInterestRate) / 200;
    } else if (params.couponFrequency === "ANNUAL") {
      grossPeriodInterest = annualInterestAmount;
    } else {
      grossPeriodInterest =
        days > 0 ? (totalPrincipal * annualInterestRate * days) / (100 * divisor) : 0;
    }

    // TDS rate logic
    let tdsRate = params.taxRate !== undefined ? normalizeTaxRate(params.taxRate) : 0.06;

    if (
      params.taxCategory === "TAX_EXEMPT" ||
      params.taxCategory === "TAX_EXEMPTED" ||
      params.taxCategory === "MUTUAL_FUND" ||
      params.taxCategory === "BANK_FI"
    ) {
      tdsRate = 0.0; // Tax Exempted / Mutual Fund / Inter-Bank FI (0% TDS)
    } else if (params.taxCategory === "INSTITUTION" || params.taxCategory === "FOREIGN_INVESTOR") {
      tdsRate = 0.15; // Legal Person / Foreign Investor (15%)
    } else if (
      params.taxCategory === "PUBLIC" ||
      params.taxCategory === "PRIVATE" ||
      params.taxCategory === "PROMOTER" ||
      params.taxCategory === "LOCAL" ||
      params.taxCategory === "EMPLOYEE"
    ) {
      tdsRate = 0.06; // Natural Person (6% on debenture coupon)
    } else if (params.taxCategory === "CUSTOM" && params.taxRate !== undefined) {
      tdsRate = normalizeTaxRate(params.taxRate);
    }

    // Round gross to paisa first, then compute tax from rounded gross (matching DB trigger parity)
    const rGross = roundToPaisa(grossPeriodInterest);
    const rawTaxAmount = rGross * tdsRate;
    const rTax = roundToPaisa(rawTaxAmount);
    const netInterestPayable = Math.max(0, roundToPaisa(rGross - rTax));

    return {
      totalPrincipal,
      annualInterestAmount: roundToPaisa(annualInterestAmount),
      dailyInterestRate: Math.round((dailyInterestRate + Number.EPSILON) * 1000000) / 1000000,
      daysCount: days,
      grossPeriodInterest: rGross,
      tdsRate,
      taxAmount: rTax,
      netInterestPayable,
    };
  },
};
