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
