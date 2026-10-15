/**
 * Standard currency and number formatting utilities for Nepal (en-IN numbering system).
 * Uses Lakhs and Crores grouping conventions (e.g. 10,00,000.00).
 */

export function formatCurrencyNPR(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = Number(value);
  if (isNaN(num)) return "—";
  return num.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatCount(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = Number(value);
  if (isNaN(num) || num === 0) return "—";
  return num.toLocaleString("en-IN");
}

export function parseFormattedNumber(value: string | null | undefined): number {
  if (!value) return 0;
  const clean = value.replace(/,/g, "").trim();
  const num = Number(clean);
  return isNaN(num) ? 0 : num;
}

/**
 * Standardizes exact paisa rounding using toPrecision(15) half-up rounding
 * to match PostgreSQL ROUND(val::numeric, 2) without binary float noise.
 */
export function roundToPaisa(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  const sign = amount < 0 ? -1 : 1;
  const scaled = Number((Math.abs(amount) * 100).toPrecision(15));
  return sign * (Math.round(scaled) / 100);
}

/**
 * Converts a rupee amount to integer paisa (e.g. 100.25 -> 10025).
 */
export function toPaisa(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  const sign = amount < 0 ? -1 : 1;
  const scaled = Number((Math.abs(amount) * 100).toPrecision(15));
  return sign * Math.round(scaled);
}

/**
 * Converts an integer paisa amount back to decimal rupees (e.g. 10025 -> 100.25).
 */
export function fromPaisa(paisa: number): number {
  if (!Number.isFinite(paisa)) return 0;
  return roundToPaisa(paisa / 100);
}

/**
 * Sums an array of rupee amounts in integer paisa to eliminate floating-point drift.
 */
export function sumInPaisa(amounts: (number | null | undefined)[]): number {
  if (!Array.isArray(amounts) || amounts.length === 0) return 0;
  const totalPaisa = amounts.reduce<number>((acc: number, curr) => acc + toPaisa(curr ?? 0), 0);
  return fromPaisa(totalPaisa);
}
