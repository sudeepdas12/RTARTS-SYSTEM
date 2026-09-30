/**
 * Nepal Currency & Number Formatting Utility
 *
 * Implements South Asian / Vedic numeral system (Lakhs & Crores) standards
 * required by the Inland Revenue Department (IRD), SEBON, and Nepali BFIs.
 */

/**
 * Formats a numeric amount using the South Asian comma placement (en-IN).
 * Example: 10000000 -> "1,00,00,000.00"
 */
export function fmtNpr(
  amount: number | string | null | undefined,
  options?: {
    showPrefix?: boolean;
    decimals?: number;
    fallback?: string;
  },
): string {
  const { showPrefix = false, decimals = 2, fallback = "—" } = options || {};

  if (amount === null || amount === undefined || amount === "") {
    return fallback;
  }

  const num = typeof amount === "string" ? Number(amount) : amount;
  if (isNaN(num)) return fallback;

  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);

  return showPrefix ? `NPR ${formatted}` : formatted;
}

/**
 * Compact formatting for large sums (Cr = Crore, L = Lakh, K = Thousand).
 * Example: 12500000 -> "1.25 Cr"
 */
export function fmtNprCompact(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const num = typeof amount === "string" ? Number(amount) : amount;
  if (isNaN(num)) return "—";

  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";

  if (abs >= 10000000) {
    const cr = abs / 10000000;
    return `${sign}${parseFloat(cr.toFixed(2))} Cr`;
  }
  if (abs >= 100000) {
    const l = abs / 100000;
    return `${sign}${parseFloat(l.toFixed(2))} L`;
  }
  if (abs >= 1000) {
    const k = abs / 1000;
    return `${sign}${parseFloat(k.toFixed(2))} K`;
  }

  return `${sign}${num.toFixed(2)}`;
}

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigitsToWords(n: number): string {
  if (n < 20) return ONES[n];
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return one > 0 ? `${TENS[ten]} ${ONES[one]}` : TENS[ten];
}

function threeDigitsToWords(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const hundredStr = hundred > 0 ? `${ONES[hundred]} Hundred` : "";
  const restStr = rest > 0 ? twoDigitsToWords(rest) : "";

  if (hundredStr && restStr) return `${hundredStr} and ${restStr}`;
  return hundredStr || restStr;
}

/**
 * Converts a numeric amount into English words using Lakhs, Crores, and Arbas.
 * Suitable for bank cheques, payment receipts, and statutory dividend counter vouchers.
 * Example: 125500.50 -> "One Lakh Twenty Five Thousand Five Hundred Rupees and Fifty Paisa Only"
 */
export function fmtNprWords(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "Zero Rupees Only";
  const num = typeof amount === "string" ? Number(amount) : amount;
  if (isNaN(num) || num === 0) return "Zero Rupees Only";

  const isNegative = num < 0;
  const absNum = Math.abs(num);

  const rupees = Math.floor(absNum);
  const paisa = Math.round((absNum - rupees) * 100);

  if (rupees === 0 && paisa === 0) return "Zero Rupees Only";

  // Break rupees into Vedic units:
  // Arba (10^9), Crore (10^7), Lakh (10^5), Thousand (10^3), Remainder (< 1000)
  let remaining = rupees;

  const arba = Math.floor(remaining / 1000000000);
  remaining %= 1000000000;

  const crore = Math.floor(remaining / 10000000);
  remaining %= 10000000;

  const lakh = Math.floor(remaining / 100000);
  remaining %= 100000;

  const thousand = Math.floor(remaining / 1000);
  const units = remaining % 1000;

  const parts: string[] = [];

  if (arba > 0) parts.push(`${twoDigitsToWords(arba)} Arba`);
  if (crore > 0) parts.push(`${twoDigitsToWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigitsToWords(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigitsToWords(thousand)} Thousand`);
  if (units > 0) parts.push(threeDigitsToWords(units));

  const rupeeString = parts.length > 0 ? `${parts.join(" ")} Rupees` : "";
  const paisaString = paisa > 0 ? `${twoDigitsToWords(paisa)} Paisa` : "";

  let result = "";
  if (rupeeString && paisaString) {
    result = `${rupeeString} and ${paisaString} Only`;
  } else if (rupeeString) {
    result = `${rupeeString} Only`;
  } else if (paisaString) {
    result = `${paisaString} Only`;
  } else {
    result = "Zero Rupees Only";
  }

  return isNegative ? `Minus ${result}` : result;
}
