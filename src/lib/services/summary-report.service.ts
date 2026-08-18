import * as XLSX from 'xlsx';
import { supabase } from './database';
import { aggregatePayableCategorySummary, normalizePayeeCategory, validatePayableConsistency } from './payable-summary';

export interface CompanySummaryRow {
  company_id: string;
  company_name: string;
  company_code: string;
  dividend_count: number;
  dividend_gross: number;
  dividend_tax: number;
  dividend_net: number;
  interest_count: number;
  interest_gross: number;
  interest_tax: number;
  interest_net: number;
  total_count: number;
  total_gross: number;
  total_tax: number;
  total_net: number;
  category_totals?: Record<string, { transactionCount: number; grossPayable: number; tax: number; netPayable: number }>;
}

export interface CompanySummaryFilters {
  companyId?: string;
  startDate?: string;
  endDate?: string;
}

type SummarySourceRow = {
  company_id: string;
  gross_dividend?: number | null;
  gross_interest?: number | null;
  tax_amount?: number | null;
  net_payable?: number | null;
  payment_date?: string | null;
  due_date?: string | null;
  created_at?: string;
  holder_type?: string | null;
  payee_classification?: string | null;
  payee_segment?: string | null;
  client?: { holder_type?: string | null; payee_classification?: string | null } | null;
  companies?: { company_name?: string | null; company_code?: string | null } | null;
};

function downloadExcel(rows: Record<string, any>[], fileName: string, sheetName: string): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = Object.keys(rows[0] || {}).map((key) => ({ wch: Math.max(key.length, 12) }));
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${fileName.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`);
}

function isWithinRange(dateValue: string | null | undefined, startDate?: string, endDate?: string): boolean {
  if (!startDate && !endDate) return true;
  if (!dateValue) return false;
  const current = new Date(dateValue);
  if (Number.isNaN(current.getTime())) return false;
  if (startDate && current < new Date(startDate)) return false;
  if (endDate) {
    const boundary = new Date(endDate);
    boundary.setHours(23, 59, 59, 999);
    if (current > boundary) return false;
  }
  return true;
}

function getRowDate(row: SummarySourceRow): string | null {
  return row.payment_date || row.due_date || row.created_at || null;
}

function aggregateRows(rows: SummarySourceRow[], kind: 'dividend' | 'interest', map: Map<string, CompanySummaryRow>): void {
  for (const row of rows) {
    const companyId = row.company_id;
    const companyName = row.companies?.company_name || 'Unknown';
    const companyCode = row.companies?.company_code || '';
    const key = companyId;
    const existing = map.get(key) || {
      company_id: companyId,
      company_name: companyName,
      company_code: companyCode,
      dividend_count: 0,
      dividend_gross: 0,
      dividend_tax: 0,
      dividend_net: 0,
      interest_count: 0,
      interest_gross: 0,
      interest_tax: 0,
      interest_net: 0,
      total_count: 0,
      total_gross: 0,
      total_tax: 0,
      total_net: 0,
      category_totals: {},
    };

    const grossAmount = Number(kind === 'dividend' ? row.gross_dividend || 0 : row.gross_interest || 0);
    const taxAmount = Number(row.tax_amount || 0);
    const netPayable = Number(row.net_payable || 0);
    const categoryKey = row.payee_classification || row.client?.payee_classification || normalizePayeeCategory(row.holder_type || row.client?.holder_type || 'UNKNOWN');
    const consistency = validatePayableConsistency({ gross_amount: grossAmount, tax_amount: taxAmount, net_payable: netPayable });
    if (!consistency.valid) {
      console.warn('Payable consistency mismatch detected in company summary:', { companyId, categoryKey, consistency });
    }

    if (kind === 'dividend') {
      existing.dividend_count += 1;
      existing.dividend_gross += grossAmount;
      existing.dividend_tax += taxAmount;
      existing.dividend_net += netPayable;
    } else {
      existing.interest_count += 1;
      existing.interest_gross += grossAmount;
      existing.interest_tax += taxAmount;
      existing.interest_net += netPayable;
    }

    existing.total_count += 1;
    existing.total_gross += grossAmount;
    existing.total_tax += taxAmount;
    existing.total_net += netPayable;

    const currentCategoryMap = existing.category_totals || {};
    const addCategory = (key: string) => {
      const entry = currentCategoryMap[key] || { transactionCount: 0, grossPayable: 0, tax: 0, netPayable: 0 };
      entry.transactionCount += 1;
      entry.grossPayable += grossAmount;
      entry.tax += taxAmount;
      entry.netPayable += netPayable;
      currentCategoryMap[key] = entry;
    };
    // Classification and ownership segment are two report dimensions. Keeping
    // both lets finance see the four requested entity totals and the
    // Promoter/Local/Public breakdown without reclassifying a transaction.
    addCategory(categoryKey);
    if (row.payee_segment) addCategory(row.payee_segment);
    existing.category_totals = currentCategoryMap;

    map.set(key, existing);
  }
}

export const SummaryReportService = {
  async getCompanySummary(filters: CompanySummaryFilters = {}): Promise<CompanySummaryRow[]> {
    const [dividendRes, interestRes, mutualFundRes] = await Promise.all([
      (supabase as any)
        .from('dividend_payables')
        .select('company_id, gross_dividend, tax_amount, net_payable, payee_classification, payee_segment, payment_date, created_at, client:clients(holder_type, payee_classification), companies!inner(company_name, company_code)')
        .order('created_at', { ascending: false }),
      (supabase as any)
        .from('interest_payables')
        .select('company_id, gross_interest, tax_amount, net_payable, payee_classification, payee_segment, payment_date, due_date, created_at, client:clients(holder_type, payee_classification), companies!inner(company_name, company_code)')
        .order('created_at', { ascending: false }),
      (supabase as any)
        .from('mutual_fund_payables')
        .select('company_id, gross_dividend, tax_amount, net_payable, payee_classification, payee_segment, payment_date, created_at, client:clients(holder_type, payee_classification), companies!inner(company_name, company_code)')
        .order('created_at', { ascending: false }),
    ]);

    if (dividendRes.error) throw dividendRes.error;
    if (interestRes.error) throw interestRes.error;
    if (mutualFundRes.error) throw mutualFundRes.error;

    const rowsByCompany = new Map<string, CompanySummaryRow>();
    const dividendRows = (dividendRes.data || []) as SummarySourceRow[];
    const interestRows = (interestRes.data || []) as SummarySourceRow[];
    const mutualFundRows = (mutualFundRes.data || []) as SummarySourceRow[];

    aggregateRows(
      dividendRows.filter((row) => {
        if (filters.companyId && filters.companyId !== 'all' && row.company_id !== filters.companyId) return false;
        return isWithinRange(getRowDate(row), filters.startDate, filters.endDate);
      }),
      'dividend',
      rowsByCompany,
    );

    aggregateRows(
      interestRows.filter((row) => {
        if (filters.companyId && filters.companyId !== 'all' && row.company_id !== filters.companyId) return false;
        return isWithinRange(getRowDate(row), filters.startDate, filters.endDate);
      }),
      'interest',
      rowsByCompany,
    );
    aggregateRows(
      mutualFundRows.filter((row) => {
        if (filters.companyId && filters.companyId !== 'all' && row.company_id !== filters.companyId) return false;
        return isWithinRange(getRowDate(row), filters.startDate, filters.endDate);
      }),
      'dividend',
      rowsByCompany,
    );

    return Array.from(rowsByCompany.values()).sort((a, b) => {
      const companyCompare = a.company_name.localeCompare(b.company_name);
      return companyCompare !== 0 ? companyCompare : a.company_code.localeCompare(b.company_code);
    });
  },

  exportCompanySummaryToExcel(data: CompanySummaryRow[], fileName: string): void {
    const rows = data.map((row) => ({
      'Company Name': row.company_name,
      'Company Code': row.company_code,
      'Dividend Count': row.dividend_count,
      'Dividend Gross': row.dividend_gross,
      'Dividend Tax': row.dividend_tax,
      'Dividend Net': row.dividend_net,
      'Interest Count': row.interest_count,
      'Interest Gross': row.interest_gross,
      'Interest Tax': row.interest_tax,
      'Interest Net': row.interest_net,
      'Total Count': row.total_count,
      'Total Gross': row.total_gross,
      'Total Tax': row.total_tax,
      'Total Net': row.total_net,
      'Category Totals': JSON.stringify(row.category_totals || {}),
    }));

    downloadExcel(rows, fileName, 'Company Summary');
  },
};
