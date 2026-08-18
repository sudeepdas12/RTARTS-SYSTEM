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

  if (/LEGAL PERSON|COMPANY|CORPORATION|LIMITED|LTD|PRIVATE LIMITED|INSTITUT/i.test(raw)) return 'INSTITUTION';
  if (/NATURAL PERSON|PUBLIC|INDIVIDUAL/.test(raw)) return 'PUBLIC';
  if (/PROMOT/i.test(raw)) return 'PROMOTER';
  if (/LOCAL/.test(raw)) return 'LOCAL';
  if (/FOREIGN|NRN/.test(raw)) return 'FOREIGN';
  if (/MUTUAL|MF|FUND/.test(raw)) return 'MUTUAL_FUND';
  if (/TAX.?EXEMPT|EXEMPT/.test(raw)) return 'TAX_EXEMPT';

  return 'UNKNOWN';
}

export function getPayeeCategoryLabel(category?: string | null): string {
  switch (String(category ?? '').toUpperCase()) {
    case 'NATURAL_PERSON': return 'Natural Person';
    case 'PUBLIC_LEGAL_PERSON': return 'Public Legal Person';
    case 'COMPANY_INSTITUTION': return 'Company / Institution';
    case 'TAX_EXEMPT': return 'Tax Exempted';
    case 'UNCLASSIFIED': return 'Review Required';
    case 'PROMOTER': return 'Promoter';
    case 'LOCAL': return 'Local';
    case 'PUBLIC': return 'Public';
  }
  switch (normalizePayeeCategory(category)) {
    case 'PUBLIC':
    case 'PROMOTER':
    case 'LOCAL':
      return 'Person / Public';
    case 'INSTITUTION':
    case 'FOREIGN':
      return 'Company / Institution';
    case 'MUTUAL_FUND':
      return 'Mutual Fund';
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
  customTaxRate?: number | null;
}

export interface PayableTotalsResult {
  grossAmount: number;
  taxAmount: number;
  netPayable: number;
  taxRate: number;
  category: PayeeCategory;
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

export function detectPayeeCategory(row: Record<string, any> = {}, sheetType?: string): PayeeCategory {
  const rawType = String(
    row.investor_type || row.type || row.TYPE || row.CATEGORY || row.category ||
    row.holder_type || row.HOLDER_TYPE || row.shareholder_type || row.SHAREHOLDER_TYPE || ''
  ).trim();

  const normalizedRaw = normalizePayeeCategory(rawType);
  if (normalizedRaw !== 'UNKNOWN') return normalizedRaw;

  if (rawType) {
    const upper = rawType.toUpperCase();
    if (/PROMOT/i.test(upper)) return 'PROMOTER';
    if (/INSTIT/i.test(upper)) return 'INSTITUTION';
    if (/MUTUAL|MF|FUND/i.test(upper)) return 'MUTUAL_FUND';
    if (/TAX.?EXEMPT|EXEMPT/i.test(upper)) return 'TAX_EXEMPT';
    if (/LOCAL/i.test(upper)) return 'LOCAL';
    if (/PUBLIC|GENERAL|INDIVIDUAL/i.test(upper)) return 'PUBLIC';
    if (/FOREIGN|NRN/i.test(upper)) return 'FOREIGN';
    if (/D-PUBLIC|P-PUBLIC/.test(upper)) return 'PUBLIC';
    if (/D-PROMOT/.test(upper)) return 'PROMOTER';
    if (upper.length > 1) return upper as PayeeCategory;
  }

  const legalPersonName = String(
    row.full_name || row.fullName || row.name || row.NAME || row.client_name || row.clientName ||
    row.company_name || row.companyName || row.company || ''
  ).trim();

  const legalPersonSignals = /(PVT\.?LTD|PRIVATE LIMITED|LIMITED|LTD\.?|COMPANY|CORPORATION|ASSOCIATES|FOUNDATION|GROUP|HOLDINGS|TRUST|BANK|FINANCE|MICROFINANCE|HYDROPOWER|INSURANCE|INSTITUTE|SOCIETY)/i;
  if (legalPersonName && legalPersonSignals.test(legalPersonName)) {
    return 'INSTITUTION';
  }

  const fatherName = String(row.father_name || row.fatherName || row.FATHER_NAME || row["FATHER'S NAME"] || row['FATHER_NAME_MOTHER_NAME'] || '').trim();
  const grandfatherName = String(row.grandfather_name || row.grandfatherName || row.GRANDFATHER_NAME || row["GRANDFATHER'S NAME"] || row['GRANDFATHER_NAME_SPOUSE_NAME'] || '').trim();
  const citizenship = String(row.citizenship || row.CITIZENSHIP || '').trim();

  if (fatherName || grandfatherName) return 'PUBLIC';
  if (citizenship && /[-a-zA-Z]/.test(citizenship)) return 'PUBLIC';

  if (sheetType) {
    const upper = sheetType.toUpperCase();
    if (upper.includes('PROMOT')) return 'PROMOTER';
    if (upper.includes('INSTIT')) return 'INSTITUTION';
    if (upper.includes('MUTUAL') || upper.includes('MF')) return 'MUTUAL_FUND';
    if (upper.includes('TAX') && upper.includes('EXEMPT')) return 'TAX_EXEMPT';
    if (upper.includes('LOCAL')) return 'LOCAL';
    if (upper.includes('PUBLIC')) return 'PUBLIC';
  }

  // Classification must be evidence-based.  A record without an explicit type,
  // master-data match, or person/company indicator is sent to review instead
  // of silently receiving an individual tax rate.
  return 'UNKNOWN';
}

export function getPayeeTaxRate(category: string | null | undefined, isDebenture = false, customTaxRate?: number | null): number {
  const sanitized = (category || 'UNKNOWN').toUpperCase();
  if (customTaxRate !== undefined && customTaxRate !== null) return Number(customTaxRate) || 0;

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
      return isDebenture ? 0.15 : 0.05;
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
  const taxRate = getPayeeTaxRate(category, Boolean(input.isDebenture), input.customTaxRate);
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
