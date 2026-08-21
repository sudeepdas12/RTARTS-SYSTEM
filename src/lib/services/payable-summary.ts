import { smartClassify } from './smart-classifier';

export type PayeeCategory =
  | 'PUBLIC'
  | 'PROMOTER'
  | 'LOCAL'
  | 'INSTITUTION'
  | 'FOREIGN'
  | 'MUTUAL_FUND'
  | 'TAX_EXEMPT'
  | 'UNKNOWN';

export function normalizePayeeCategory(value?: string | null): PayeeCategory {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return 'UNKNOWN';

  // 1. Tax exempt and mutual funds must be matched before generic institutions
  if (/\bMUTUAL|\bMF\b|FOCUS\s*(40|30)|SELECT\s*30|SUPER\s*30|SAMRIDDHI|SAMUNNAT|PRAGATI|SAHABHAGITA|DHANABRIDDHI|SABAL|EQUITY\s*(FUND|SCHEME|ORIENTED)|GROWTH\s*(FUND|SCHEME)|BALANCED\s*(FUND|SCHEME)|BLUECHIP|LARGE\s*CAP|FLEXI\s*CAP|VALUE\s*FUND|DEBT\s*FUND|FIXED\s*INCOME|DYNAMIC\s*DEBT|SYSTEMATIC\s*INVESTMENT|YOJANA\b|SCHEME\b/i.test(raw)) return 'MUTUAL_FUND';
  if (/TAX.?EXEMPT|EXEMPT|RETIREMENT\s*FUND|PENSION|PROVIDENT|SANCHAYA\s*KOSH|NAGARIK|CITIZEN\s*INVESTMENT|\bCIT\b|\bEPF\b|\bSSF\b|SOCIAL\s*SECURITY|AWAKASH\s*KOSH|AWAKASH|GRATUITY|KALYAN\s*KOSH/i.test(raw)) return 'TAX_EXEMPT';
  
  // 2. Promoter & Local segments
  if (/PROMOT/i.test(raw)) return 'PROMOTER';
  if (/LOCAL/i.test(raw)) return 'LOCAL';
  if (/FOREIGN|NRN/i.test(raw)) return 'FOREIGN';

  // 3. Institution / Company
  if (/LEGAL PERSON|COMPANY|CORPORATION|LIMITED|\bLTD\b|PRIVATE LIMITED|INSTITUT|BANK|FINANCE|HYDRO|INSURANCE|CAPITAL|SECURITIES/i.test(raw)) return 'INSTITUTION';

  // 4. Natural person / Public
  if (/NATURAL PERSON|PUBLIC|INDIVIDUAL|GENERAL/.test(raw)) return 'PUBLIC';

  return 'UNKNOWN';
}

export function getPayeeCategoryLabel(category?: string | null): string {
  switch (String(category ?? '').toUpperCase()) {
    case 'NATURAL_PERSON': return 'Natural Person (Public)';
    case 'PUBLIC_LEGAL_PERSON': return 'Natural Person (Public)';
    case 'COMPANY_INSTITUTION': return 'Legal Person (Institution / Company)';
    case 'TAX_EXEMPT': return 'Tax Exempted (Mutual Fund / Retirement Fund)';
    case 'MUTUAL_FUND': return 'Mutual Fund (Tax Exempt)';
    case 'FOREIGN': return 'Foreign';
    case 'UNCLASSIFIED': return 'Review Required';
    case 'PROMOTER': return 'Promoter';
    case 'LOCAL': return 'Local';
    case 'PUBLIC': return 'Public (Natural Person)';
  }
  switch (normalizePayeeCategory(category)) {
    case 'PUBLIC':
    case 'PROMOTER':
    case 'LOCAL':
      return 'Natural Person (Public)';
    case 'INSTITUTION':
    case 'FOREIGN':
      return 'Legal Person (Institution / Company)';
    case 'MUTUAL_FUND':
      return 'Mutual Fund (Tax Exempt)';
    case 'TAX_EXEMPT':
      return 'Tax Exempt';
    default:
      return 'Unclassified';
  }
}

export interface PayableTotalsInput {
  grossAmount: number;
  taxAmount?: number | null;
  category?: string | null;
  isDebenture?: boolean;
  isMutualFund?: boolean;
  customTaxRate?: number | null;
}

export interface PayableTotalsResult {
  grossAmount: number;
  taxAmount: number;
  netPayable: number;
  taxRate: number;
  difference?: number;
  category?: PayeeCategory;
}

export interface CategoryTotalsRow {
  company_id: string;
  company_name: string;
  payee_category: string;
  gross_amount: number;
  tax_amount: number;
  net_payable: number;
  transaction_count?: number;
}

export interface CategorySummaryResult {
  category: string;
  transactionCount: number;
  grossPayable: number;
  tax: number;
  netPayable: number;
}

export function detectPayeeCategory(row: any, sheetType?: string | null): PayeeCategory {
  if (!row || typeof row !== 'object') return 'UNKNOWN';

  const result = smartClassify({
    ...row,
    sheetType,
  });

  return result.payee_category;
}

export function getPayeeTaxRate(
  category: string | null | undefined,
  isDebenture = false,
  customTaxRate?: number | null,
  isMutualFund = false,
): number {
  if (customTaxRate !== undefined && customTaxRate !== null) return Number(customTaxRate) || 0;
  const sanitized = (category || 'UNKNOWN').toUpperCase();

  switch (sanitized) {
    case 'PROMOTER':
    case 'NATURAL_PERSON':
      return isDebenture ? 0.06 : 0.05;
    case 'PUBLIC':
    case 'PUBLIC_LEGAL_PERSON':
    case 'LOCAL':
      return isDebenture ? 0.06 : 0.05;
    case 'INSTITUTION':
    case 'COMPANY_INSTITUTION':
    case 'FOREIGN':
      // Mutual-fund institutional distributions are taxed at 15% (per the
      // RMF sample file); ordinary dividends stay at 5%.
      return isMutualFund || isDebenture ? 0.15 : 0.05;
    case 'MUTUAL_FUND':
    case 'TAX_EXEMPT':
      return 0;
    default:
      return 0;
  }
}

export function calculatePayableTotals(input: PayableTotalsInput): PayableTotalsResult {
  const grossAmount = Number(input.grossAmount ?? 0);
  const category = (input.category || 'UNKNOWN').toUpperCase() as PayeeCategory;
  const taxRate = getPayeeTaxRate(
    category,
    Boolean(input.isDebenture),
    input.customTaxRate,
    Boolean(input.isMutualFund),
  );
  const taxAmountFromInput = input.taxAmount !== undefined && input.taxAmount !== null ? Number(input.taxAmount ?? 0) : null;
  const taxAmount = taxAmountFromInput !== null ? taxAmountFromInput : Math.round(grossAmount * taxRate * 100) / 100;
  const netPayable = Math.round((grossAmount - taxAmount) * 100) / 100;

  return {
    grossAmount,
    taxAmount,
    netPayable,
    taxRate,
    category,
  };
}

export function validatePayableConsistency(input: { gross_amount: number; tax_amount: number; net_payable: number }): {
  valid: boolean;
  difference: number;
  expectedNet: number;
} {
  const gross = Number(input.gross_amount ?? 0);
  const tax = Number(input.tax_amount ?? 0);
  const net = Number(input.net_payable ?? 0);
  const expectedNet = Math.round((gross - tax) * 100) / 100;
  return {
    valid: Math.abs(net - expectedNet) < 0.01,
    difference: Math.round((net - expectedNet) * 100) / 100,
    expectedNet,
  };
}

export function aggregatePayableCategorySummary(rows: CategoryTotalsRow[]): CategorySummaryResult[] {
  const map = new Map<string, CategorySummaryResult>();

  for (const row of rows) {
    const category = String(row.payee_category || 'UNKNOWN').toUpperCase();
    const existing = map.get(category) || {
      category,
      transactionCount: 0,
      grossPayable: 0,
      tax: 0,
      netPayable: 0,
    };

    existing.transactionCount += Number(row.transaction_count || 1);
    existing.grossPayable += Number(row.gross_amount || 0);
    existing.tax += Number(row.tax_amount || 0);
    existing.netPayable += Number(row.net_payable || 0);
    map.set(category, existing);
  }

  const categoryOrder: Record<string, number> = {
    PUBLIC: 0,
    NATURAL_PERSON: 0,
    PUBLIC_LEGAL_PERSON: 1,
    PROMOTER: 1,
    LOCAL: 2,
    INSTITUTION: 3,
    COMPANY_INSTITUTION: 3,
    FOREIGN: 4,
    MUTUAL_FUND: 5,
    TAX_EXEMPT: 6,
    UNKNOWN: 99,
  };

  return Array.from(map.values()).sort((a, b) => {
    const orderDiff = (categoryOrder[a.category] ?? 99) - (categoryOrder[b.category] ?? 99);
    return orderDiff !== 0 ? orderDiff : a.category.localeCompare(b.category);
  });
}
