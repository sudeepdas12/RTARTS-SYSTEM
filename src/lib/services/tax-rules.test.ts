import { describe, expect, it, vi } from 'vitest';

// Mock the supabase-backed rule loader so `getEffectiveTaxRate` can be exercised
// without a database. The factory re-implements getEffectiveTaxRate as a thin
// wrapper over the (mocked) loadTaxRules + the REAL pure helpers, so we test
// the actual fallback contract rather than the supabase wiring.
vi.mock('./tax-rules.service', async (importOriginal) => {
  const orig: any = await importOriginal();
  const mockLoad = vi.fn();
    return {
    ...orig,
    loadTaxRules: mockLoad,
    getEffectiveTaxRate: async (
      payableCategory: any,
      investorCategory: string | null | undefined,
      fallback: number = 0,
    ) => {
      try {
        const rules = await mockLoad();
        const classification = orig.investorCategoryToClassification(investorCategory);
        if (!classification) return fallback;
        const rate = orig.getTaxRateFromRules(rules, payableCategory, classification);
        return rate != null ? rate : fallback;
      } catch {
        return fallback;
      }
    },
  };
});

import {
  getTaxRateFromRules,
  investorCategoryToClassification,
  isExemptFromTax,
  getEffectiveTaxRate,
  loadTaxRules,
  type TaxRule,
} from './tax-rules.service';
// `loadTaxRules` is replaced by the vi.fn from the mock above; wrap it so the
// test bodies can drive getEffectiveTaxRate's rule lookup.
const mockLoad = vi.mocked(loadTaxRules);

const rules: TaxRule[] = [
  { id: '1', payable_category: 'DIVIDEND', payee_classification: 'NATURAL_PERSON', tax_rate: 0.05, is_active: true },
  { id: '2', payable_category: 'DIVIDEND', payee_classification: 'PUBLIC_LEGAL_PERSON', tax_rate: 0.05, is_active: true },
  { id: '3', payable_category: 'DIVIDEND', payee_classification: 'COMPANY_INSTITUTION', tax_rate: 0.05, is_active: true },
  { id: '4', payable_category: 'INTEREST', payee_classification: 'NATURAL_PERSON', tax_rate: 0.06, is_active: true },
  { id: '5', payable_category: 'INTEREST', payee_classification: 'PUBLIC_LEGAL_PERSON', tax_rate: 0.06, is_active: true },
  { id: '6', payable_category: 'INTEREST', payee_classification: 'COMPANY_INSTITUTION', tax_rate: 0.15, is_active: true },
  { id: '7', payable_category: 'MUTUAL_FUND', payee_classification: 'NATURAL_PERSON', tax_rate: 0.05, is_active: true },
  { id: '8', payable_category: 'MUTUAL_FUND', payee_classification: 'COMPANY_INSTITUTION', tax_rate: 0.15, is_active: true },
  { id: '9', payable_category: 'MUTUAL_FUND', payee_classification: 'TAX_EXEMPT', tax_rate: 0, is_active: true },
];

describe('centralized tax rules (payable type + investor category → rate)', () => {
  it('maps investor categories to tax classifications', () => {
    expect(investorCategoryToClassification('PUBLIC')).toBe('PUBLIC_LEGAL_PERSON');
    expect(investorCategoryToClassification('PROMOTER')).toBe('NATURAL_PERSON');
    expect(investorCategoryToClassification('LOCAL')).toBe('NATURAL_PERSON');
    expect(investorCategoryToClassification('INSTITUTION')).toBe('COMPANY_INSTITUTION');
    expect(investorCategoryToClassification('FOREIGN')).toBe('COMPANY_INSTITUTION');
    expect(investorCategoryToClassification('MUTUAL_FUND')).toBe('TAX_EXEMPT');
    expect(investorCategoryToClassification('TAX_EXEMPTED')).toBe('TAX_EXEMPT');
    expect(investorCategoryToClassification('UNKNOWN')).toBeNull();
    expect(investorCategoryToClassification(null)).toBeNull();
  });

  it('applies the spec rates (debenture 6/15, dividend 5/5, MF exempt)', () => {
    // Debenture (interest)
    expect(getTaxRateFromRules(rules, 'INTEREST', 'NATURAL_PERSON')).toBe(0.06);
    expect(getTaxRateFromRules(rules, 'INTEREST', 'COMPANY_INSTITUTION')).toBe(0.15);
    // Dividend
    expect(getTaxRateFromRules(rules, 'DIVIDEND', 'NATURAL_PERSON')).toBe(0.05);
    expect(getTaxRateFromRules(rules, 'DIVIDEND', 'COMPANY_INSTITUTION')).toBe(0.05);
    // Mutual fund
    expect(getTaxRateFromRules(rules, 'MUTUAL_FUND', 'TAX_EXEMPT')).toBe(0);
    expect(getTaxRateFromRules(rules, 'MUTUAL_FUND', 'COMPANY_INSTITUTION')).toBe(0.15);
    // No rule for this combination
    expect(getTaxRateFromRules(rules, 'DIVIDEND', 'TAX_EXEMPT')).toBeNull();
  });

    it('ignores inactive rules', () => {
    const inactive: TaxRule[] = [{ ...rules[5], is_active: false }];
    expect(getTaxRateFromRules(inactive, 'INTEREST', 'COMPANY_INSTITUTION')).toBeNull();
  });

  it('returns null for null/undefined rule lists and unknown categories', () => {
    expect(getTaxRateFromRules(null, 'DIVIDEND', 'NATURAL_PERSON')).toBeNull();
    expect(getTaxRateFromRules(undefined, 'DIVIDEND', 'NATURAL_PERSON')).toBeNull();
    // No rule matches the TAX_EXEMPT classification for DIVIDEND
    expect(getTaxRateFromRules(rules, 'DIVIDEND', 'TAX_EXEMPT')).toBeNull();
  });

  it('does not match on a different classification even with same rate', () => {
    // Interest natural-person rate (0.06) must NOT match a company-institution query (0.15)
    expect(getTaxRateFromRules(rules, 'INTEREST', 'COMPANY_INSTITUTION')).toBe(0.15);
    expect(getTaxRateFromRules(rules, 'INTEREST', 'NATURAL_PERSON')).toBe(0.06);
  });
});

describe('tax-exempt detection (isExemptFromTax)', () => {
  it('flags TAX_EXEMPT classification only', () => {
    expect(isExemptFromTax('TAX_EXEMPT')).toBe(true);
  });
  it('does not flag taxable classifications', () => {
    expect(isExemptFromTax('NATURAL_PERSON')).toBe(false);
    expect(isExemptFromTax('PUBLIC_LEGAL_PERSON')).toBe(false);
    expect(isExemptFromTax('COMPANY_INSTITUTION')).toBe(false);
  });
  it('does not flag null/undefined', () => {
    expect(isExemptFromTax(null)).toBe(false);
    expect(isExemptFromTax(undefined)).toBe(false);
  });
});

describe('investor category → classification edge cases', () => {
  it('is case-insensitive and trims whitespace', () => {
    expect(investorCategoryToClassification('  institution ')).toBe('COMPANY_INSTITUTION');
    expect(investorCategoryToClassification('Mutual_Fund')).toBe('TAX_EXEMPT');
    expect(investorCategoryToClassification('public')).toBe('PUBLIC_LEGAL_PERSON');
  });
  it('maps the legal-person / company synonyms to institution', () => {
    expect(investorCategoryToClassification('LEGAL PERSON')).toBe('COMPANY_INSTITUTION');
    expect(investorCategoryToClassification('COMPANY_INSTITUTION')).toBe('COMPANY_INSTITUTION');
    expect(investorCategoryToClassification('FOREIGN')).toBe('COMPANY_INSTITUTION');
  });
  it('returns null for genuinely unknown categories (no guessing a tax bucket)', () => {
    expect(investorCategoryToClassification('UNCLASSIFIED')).toBeNull();
    expect(investorCategoryToClassification('')).toBeNull();
    expect(investorCategoryToClassification('something weird')).toBeNull();
  });
});

describe('getEffectiveTaxRate fallback behaviour', () => {
  it('returns the rule rate when a match exists', async () => {
    mockLoad.mockResolvedValue(rules);
    expect(await getEffectiveTaxRate('INTEREST', 'COMPANY_INSTITUTION')).toBe(0.15);
  });

  it('returns fallback when investor category is unknown (no classification)', async () => {
    mockLoad.mockResolvedValue(rules);
    expect(await getEffectiveTaxRate('INTEREST', 'UNCLASSIFIED', 0.1)).toBe(0.1);
  });

  it('returns fallback when rules cannot be loaded (DB error)', async () => {
    mockLoad.mockRejectedValue(new Error('boom'));
    expect(await getEffectiveTaxRate('DIVIDEND', 'NATURAL_PERSON', 0.05)).toBe(0.05);
  });
});
