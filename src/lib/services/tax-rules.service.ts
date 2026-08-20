import { supabase, throwIfError } from "./database";

/**
 * Centralized tax / TDS rules.
 *
 * Single source of truth = `payable_tax_rules` table:
 *   payable_category (DIVIDEND | INTEREST | MUTUAL_FUND)
 *   × payee_classification (NATURAL_PERSON | PUBLIC_LEGAL_PERSON | COMPANY_INSTITUTION | TAX_EXEMPT)
 *   → tax_rate (0..1)
 *
 * The DB trigger (`apply_payable_classification_and_tax`) enforces these rules
 * on every payable insert/update. These helpers give the import engine, the
 * validation engine and the System Settings page the SAME rules so no part of
 * the app hardcodes a rate that can drift from what the database applies.
 *
 * "Debenture" is stored under the INTEREST category; Mutual Fund distributions
 * are their own category with institutional TDS at 15% (per the RMF sample).
 */

export type TaxPayableCategory = "DIVIDEND" | "INTEREST" | "MUTUAL_FUND";

export type TaxClassification =
  | "NATURAL_PERSON"
  | "PUBLIC_LEGAL_PERSON"
  | "COMPANY_INSTITUTION"
  | "TAX_EXEMPT";

export interface TaxRule {
  id: string;
  payable_category: TaxPayableCategory;
  payee_classification: TaxClassification;
  tax_rate: number;
  is_active: boolean;
}

export const TAX_CATEGORY_LABEL: Record<TaxPayableCategory, string> = {
  DIVIDEND: "Dividend",
  INTEREST: "Debenture / Interest",
  MUTUAL_FUND: "Mutual Fund",
};

export const TAX_CLASSIFICATION_LABEL: Record<TaxClassification, string> = {
  NATURAL_PERSON: "Natural Person (Individual)",
  PUBLIC_LEGAL_PERSON: "Public / Legal Person",
  COMPANY_INSTITUTION: "Company / Institution",
  TAX_EXEMPT: "Tax Exempt (Mutual Fund)",
};

const CACHE_TTL_MS = 60_000;
let cache: { rules: TaxRule[]; at: number } | null = null;

/** Fetch all active rules once per minute per browser tab (single source). */
export async function loadTaxRules(force = false): Promise<TaxRule[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rules;
  const { data, error } = await (supabase as any)
    .from("payable_tax_rules")
    .select("id, payable_category, payee_classification, tax_rate, is_active")
    .order("payable_category")
    .order("payee_classification");
  throwIfError(error, "Failed to load tax rules");
  cache = { rules: (data ?? []) as TaxRule[], at: Date.now() };
  return cache.rules;
}

export function invalidateTaxRuleCache(): void {
  cache = null;
}

/** Look up a rate from a rule list (pure). Returns null when no active rule matches. */
export function getTaxRateFromRules(
  rules: TaxRule[] | null | undefined,
  payableCategory: TaxPayableCategory,
  classification: TaxClassification,
): number | null {
  const hit = (rules ?? []).find(
    (r) =>
      r.payable_category === payableCategory &&
      r.payee_classification === classification &&
      r.is_active,
  );
  return hit?.tax_rate != null ? Number(hit.tax_rate) : null;
}

/**
 * Centralised tax-exempt check. Returns true when the resolved tax
 * classification carries a 0% TDS liability (e.g. Mutual Fund / Tax Exempt).
 * Pure & side-effect-free so the import engine, validation engine and
 * summary reports all agree on what counts as exempt.
 */
export function isExemptFromTax(
  classification: TaxClassification | null | undefined,
): boolean {
  return classification === "TAX_EXEMPT";
}

/**
 * Map an import/UI investor category to its tax classification.
 * Returns null for truly unknown categories so the caller never guesses a
 * tax-bearing bucket (those rows go to operator review instead).
 */
export function investorCategoryToClassification(
  category: string | null | undefined,
): TaxClassification | null {
  switch (String(category ?? "").trim().toUpperCase()) {
    case "INSTITUTION":
    case "COMPANY_INSTITUTION":
    case "LEGAL PERSON":
    case "FOREIGN":
      return "COMPANY_INSTITUTION";
    case "MUTUAL_FUND":
    case "TAX_EXEMPT":
    case "TAX_EXEMPTED":
      return "TAX_EXEMPT";
    case "PUBLIC":
    case "PUBLIC_LEGAL_PERSON":
      return "PUBLIC_LEGAL_PERSON";
    case "PROMOTER":
    case "LOCAL":
    case "NATURAL_PERSON":
      return "NATURAL_PERSON";
    default:
      return null;
  }
}

/**
 * One-liner used by callers that want the authoritative rate for a row:
 *   Payable Type + Investor Category → Applicable Tax Rate
 * Falls back to `fallback` (or 0) if rules are unavailable.
 */
export async function getEffectiveTaxRate(
  payableCategory: TaxPayableCategory,
  investorCategory: string | null | undefined,
  fallback: number = 0,
): Promise<number> {
  try {
    const rules = await loadTaxRules();
    const classification = investorCategoryToClassification(investorCategory);
    if (!classification) return fallback;
    const rate = getTaxRateFromRules(rules, payableCategory, classification);
    return rate != null ? rate : fallback;
  } catch (e) {
    console.warn("Could not load tax rules; using fallback.", e);
    return fallback;
  }
}

/** Persist a rule change from the System Settings page (admin-only via RLS). */
export async function updateTaxRule(
  id: string,
  patch: { tax_rate?: number; is_active?: boolean },
): Promise<void> {
  const { error } = await (supabase as any)
    .from("payable_tax_rules")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  throwIfError(error, "Failed to update tax rule");
  invalidateTaxRuleCache();
}
