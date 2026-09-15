/**
 * Period Calculator for Nepal Debentures, Deposits, and Distribution Payables
 * Supports 3 Months (Quarterly), 6 Months (Semi-Annual / Asar End / Poush End),
 * 9 Months, 12 Months (Annual), and Custom Date/Day Ranges.
 */

export type PeriodPreset = "3M" | "6M" | "9M" | "12M" | "CUSTOM";

export interface PeriodConfig {
  preset: PeriodPreset;
  label: string;
  days: number;
  description: string;
}

export const STANDARD_PERIODS: Record<PeriodPreset, PeriodConfig> = {
  "3M": {
    preset: "3M",
    label: "3 Months (Quarterly)",
    days: 91,
    description: "Quarterly payout (approx. 91 days / 1 quarter)",
  },
  "6M": {
    preset: "6M",
    label: "6 Months (Semi-Annual / 183d)",
    days: 183,
    description: "Half-yearly payout (183 days / Asar End or Poush End)",
  },
  "9M": {
    preset: "9M",
    label: "9 Months (3 Quarters)",
    days: 274,
    description: "Nine-month period payout (approx. 274 days / 3 quarters)",
  },
  "12M": {
    preset: "12M",
    label: "12 Months (Annual)",
    days: 365,
    description: "Full annual coupon period (365 days)",
  },
  CUSTOM: {
    preset: "CUSTOM",
    label: "Custom Range",
    days: 0,
    description: "Custom date or day range",
  },
};

export interface PeriodInterestResult {
  principalAmount: number;
  couponRate: number;
  annualInterest: number;
  dailyInterest: number;
  periodDays: number;
  dayCountConvention: "ACTUAL_365" | "30_360";
  grossPeriodInterest: number;
  tdsRate: number;
  taxAmount: number;
  netPayable: number;
}

/**
 * Calculates exact days between two dates.
 * Defaults to inclusive counting (+1) to match financial period convention,
 * or interval counting when options.inclusive is explicitly false.
 */
export function calculateDaysBetween(
  fromDateStr: string,
  toDateStr: string,
  options: { inclusive?: boolean } = { inclusive: true },
): number {
  if (!fromDateStr || !toDateStr) return 0;
  const start = new Date(fromDateStr);
  const end = new Date(toDateStr);
  const diffTime = end.getTime() - start.getTime();
  if (isNaN(diffTime) || diffTime < 0) return 0;
  const isInclusive = options.inclusive !== false;
  return Math.round(diffTime / (1000 * 60 * 60 * 24)) + (isInclusive ? 1 : 0);
}

/**
 * Calculates interest for a given principal, coupon rate, period days, and TDS rate.
 * Supports both ACTUAL_365 and 30_360 day count conventions.
 */
export function calculatePeriodInterest({
  kitta = 0,
  faceValue = 1000,
  principalAmount,
  couponRatePercent = 8.5,
  periodDays = 365,
  tdsRatePercent = 6,
  dayCountConvention = "ACTUAL_365",
}: {
  kitta?: number;
  faceValue?: number;
  principalAmount?: number;
  couponRatePercent: number;
  periodDays: number;
  tdsRatePercent: number;
  dayCountConvention?: "ACTUAL_365" | "30_360";
}): PeriodInterestResult {
  const principal = principalAmount ?? kitta * faceValue;
  const annualInterest = Math.round(principal * (couponRatePercent / 100) * 100) / 100;
  const divisor = dayCountConvention === "30_360" ? 360 : 365;
  const dailyInterest = divisor > 0 ? annualInterest / divisor : 0;
  const days = periodDays > 0 ? periodDays : divisor;

  const grossPeriodInterest =
    days === divisor
      ? annualInterest
      : Math.round(
          ((principal * couponRatePercent * days) / (100 * divisor) + Number.EPSILON) * 100,
        ) / 100;

  const taxAmount =
    Math.round((grossPeriodInterest * (tdsRatePercent / 100) + Number.EPSILON) * 100) / 100;
  const netPayable = Math.round((grossPeriodInterest - taxAmount + Number.EPSILON) * 100) / 100;

  return {
    principalAmount: principal,
    couponRate: couponRatePercent,
    annualInterest,
    dailyInterest: Math.round((dailyInterest + Number.EPSILON) * 100) / 100,
    periodDays: days,
    dayCountConvention,
    grossPeriodInterest,
    tdsRate: tdsRatePercent / 100,
    taxAmount,
    netPayable,
  };
}
