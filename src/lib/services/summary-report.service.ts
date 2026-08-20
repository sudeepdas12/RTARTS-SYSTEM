import * as XLSX from 'xlsx';
import { supabase, fetchAllRows } from './database';
import { normalizePayeeCategory, validatePayableConsistency } from './payable-summary';

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
    addCategory(categoryKey);
    if (row.payee_segment) addCategory(row.payee_segment);
    existing.category_totals = currentCategoryMap;

    map.set(key, existing);
  }
}

export interface MutualFundSummaryRow {
  sn?: number;
  type: string;
  transaction_count: number;
  kitta: number;
  gross: number;
  tax: number;
  net: number;
  composition?: number;
}

export function mfSummaryType(row: {
  payee_classification?: string | null;
  payee_segment?: string | null;
  lot_name?: string | null;
  client?: {
    full_name?: string | null;
    holder_type?: string | null;
    payee_classification?: string | null;
  } | null;
}): string {
  const lot = (row.lot_name || '').toUpperCase();
  if (lot.includes('PROMOT')) return 'PROMOTER';
  if (lot.includes('INSTITUT')) return 'INSTITUTION';
  if (lot.includes('TAX EXEMPT') || lot.includes('MUTUAL')) return 'TAX EXEMPTED';
  if (lot.includes('LOCAL')) return 'LOCAL UNVERIFIED';
  if (lot.includes('PUBLIC')) return 'PUBLIC';

  const cls = (row.payee_classification || row.client?.payee_classification || '').trim().toUpperCase();
  if (cls === 'COMPANY_INSTITUTION' || cls.includes('INSTITUTION')) return 'INSTITUTION';
  if (cls === 'TAX_EXEMPT' || cls.includes('TAX_EXEMPT') || cls.includes('MUTUAL_FUND')) return 'TAX EXEMPTED';
  if (cls === 'NATURAL_PERSON' || cls === 'PUBLIC_LEGAL_PERSON' || (cls.includes('PUBLIC') && cls !== 'UNCLASSIFIED')) {
    if (row.payee_segment === 'PROMOTER') return 'PROMOTER';
    if (row.payee_segment === 'LOCAL') return 'LOCAL UNVERIFIED';
    return 'PUBLIC';
  }
  if (cls === 'UNCLASSIFIED') return 'OTHERS';

  const holder = (row.client?.holder_type || '').toUpperCase();
  if (holder.includes('PROMOT')) return 'PROMOTER';
  if (holder.includes('LEGAL') || holder.includes('INSTITUT')) return 'INSTITUTION';
  if (holder.includes('EXEMPT') || holder.includes('MUTUAL')) return 'TAX EXEMPTED';
  if (holder.includes('LOCAL')) return 'LOCAL UNVERIFIED';
  if (holder.includes('PUBLIC')) return 'PUBLIC';

  const clientName = (row.client?.full_name || '').toUpperCase();
  if (/(MUTUAL\s*FUND|RETIREMENT\s*FUND|PENSION\s*FUND|PROVIDENT\s*FUND|KOSH\b|SANCHAYA\s*KOSH|NAGARIK\s*LAGANI|\bCIT\b|\bEPF\b|SAMRIDDHI\s*FUND|EQUITY\s*FUND|GROWTH\s*FUND|SCHEME\b)/i.test(clientName)) {
    return 'TAX EXEMPTED';
  }
  if (/(PVT\.?LTD|PRIVATE LIMITED|\bLIMITED\b|\bLTD\.?\b|\bCOMPANY\b|CORPORATION|ASSOCIATES|FOUNDATION|\bGROUP\b|HOLDINGS|\bTRUST\b|\bBANK\b|FINANCE|MICROFINANCE|HYDROPOWER|INSURANCE|INSTITUTE|SOCIETY|COOPERATIVE|SAHAKARI|ENTERPRISES|VENTURES|INVESTMENT|CAPITAL|SECURITIES)/i.test(clientName)) {
    return 'INSTITUTION';
  }

  return 'OTHERS';
}

export const SummaryReportService = {
  async getCompanySummary(filters: CompanySummaryFilters = {}): Promise<CompanySummaryRow[]> {
    const [dividendRows, interestRows, mutualFundRows] = await Promise.all([
      fetchAllRows<SummarySourceRow>((from, to) =>
        (supabase as any)
          .from('dividend_payables')
          .select('company_id, gross_dividend, tax_amount, net_payable, payee_classification, payee_segment, payment_date, created_at, client:clients(holder_type, payee_classification), companies!inner(company_name, company_code)')
          .range(from, to)
      ),
      fetchAllRows<SummarySourceRow>((from, to) =>
        (supabase as any)
          .from('interest_payables')
          .select('company_id, gross_interest, tax_amount, net_payable, payee_classification, payee_segment, payment_date, due_date, created_at, client:clients(holder_type, payee_classification), companies!inner(company_name, company_code)')
          .range(from, to)
      ),
      fetchAllRows<SummarySourceRow>((from, to) =>
        (supabase as any)
          .from('mutual_fund_payables')
          .select('company_id, gross_dividend, tax_amount, net_payable, payee_classification, payee_segment, payment_date, created_at, client:clients(holder_type, payee_classification), companies!inner(company_name, company_code)')
          .range(from, to)
      ),
    ]);

    const rowsByCompany = new Map<string, CompanySummaryRow>();

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

  /**
   * Mutual-fund distribution summary in the exact layout of the CDS "SUMMARY"
   * sheet (S.N. | TYPE | NO. OF UNITHOLDERS | KITTA | AMOUNT/DIVIDEND | TAX | NET DIVIDEND | COMPOSITION),
   * reproduced from the per-holder rows in `mutual_fund_payables` with client heuristic fallback.
   */
  async getMutualFundSummary(
    filters: { companyId?: string; fiscalYear?: string } = {},
  ): Promise<MutualFundSummaryRow[]> {
    const data = await fetchAllRows<any>((from, to) => {
      let query = (supabase as any)
        .from('mutual_fund_payables')
        .select(
          'shares_held, gross_dividend, tax_amount, net_payable, payee_classification, payee_segment, lot_name, client:clients(id, full_name, holder_type, payee_classification)',
        )
        .range(from, to);
      if (filters.companyId && filters.companyId !== 'all') {
        query = query.eq('company_id', filters.companyId);
      }
      if (filters.fiscalYear && filters.fiscalYear !== 'all') {
        query = query.eq('fiscal_year', filters.fiscalYear);
      }
      return query;
    });

    let totalKitta = 0;
    const map = new Map<string, MutualFundSummaryRow>();
    for (const row of data ?? []) {
      const type = mfSummaryType(row);
      const kitta = Number(row.shares_held ?? 0);
      totalKitta += kitta;

      const entry =
        map.get(type) ||
        ({ type, transaction_count: 0, kitta: 0, gross: 0, tax: 0, net: 0, composition: 0 } as MutualFundSummaryRow);
      entry.transaction_count += 1;
      entry.kitta += kitta;
      entry.gross += Number(row.gross_dividend ?? 0);
      entry.tax += Number(row.tax_amount ?? 0);
      entry.net += Number(row.net_payable ?? 0);
      map.set(type, entry);
    }

    const order = ['PUBLIC', 'PROMOTER', 'LOCAL UNVERIFIED', 'INSTITUTION', 'TAX EXEMPTED'];
    const sorted = Array.from(map.values()).sort((a, b) => {
      const ai = order.indexOf(a.type);
      const bi = order.indexOf(b.type);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.type.localeCompare(b.type);
    });

    let sn = 1;
    for (const item of sorted) {
      item.sn = sn++;
      item.composition = totalKitta > 0 ? Math.round((item.kitta / totalKitta) * 10000) / 100 : 0;
    }

    return sorted;
  },

  /**
   * Export the mutual-fund summary to Excel with the same columns/format as the
   * CDS "SUMMARY" sheet, including the TOTAL row and comma-formatted amounts.
   */
  exportMutualFundSummaryToExcel(data: MutualFundSummaryRow[], fileName: string): void {
    const total = data.reduce(
      (acc, r) => ({
        transaction_count: acc.transaction_count + r.transaction_count,
        kitta: acc.kitta + r.kitta,
        gross: acc.gross + r.gross,
        tax: acc.tax + r.tax,
        net: acc.net + r.net,
      }),
      { transaction_count: 0, kitta: 0, gross: 0, tax: 0, net: 0 },
    );

    const aoa: (string | number)[][] = [
      ['S.N.', 'TYPE', 'NO. OF UNITHOLDERS', 'KITTA / UNITS', 'AMOUNT/DIVIDEND', 'TAX', 'NET DIVIDEND', 'COMPOSITION %'],
      ...data.map((r) => [r.sn ?? '', r.type, r.transaction_count, r.kitta, r.gross, r.tax, r.net, `${(r.composition ?? 0).toFixed(2)}%`]),
      ['', 'TOTAL', total.transaction_count, total.kitta, total.gross, total.tax, total.net, '100.00%'],
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 8 }, { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 16 }];
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let c = 2; c <= 6; c++) {
      for (let r = 1; r <= range.e.r; r++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (ws[addr] && typeof ws[addr].v === 'number') ws[addr].z = '#,##0.00';
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SUMMARY');
    XLSX.writeFile(wb, `${fileName.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`);
  },

  /**
   * Export the mutual-fund summary to PDF
   */
  exportMutualFundSummaryToPdf(data: MutualFundSummaryRow[], companyName = 'RTARTS System', subtitle = 'Mutual Fund Distribution Summary'): void {
    const total = data.reduce(
      (acc, r) => ({
        transaction_count: acc.transaction_count + r.transaction_count,
        kitta: acc.kitta + r.kitta,
        gross: acc.gross + r.gross,
        tax: acc.tax + r.tax,
        net: acc.net + r.net,
      }),
      { transaction_count: 0, kitta: 0, gross: 0, tax: 0, net: 0 },
    );

    const fmtNr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const columns = [
      { header: 'S.N.', dataKey: 'sn' },
      { header: 'TYPE', dataKey: 'type' },
      { header: 'NO. OF UNITHOLDERS', dataKey: 'transaction_count' },
      { header: 'KITTA / UNITS', dataKey: 'kitta' },
      { header: 'AMOUNT/DIVIDEND', dataKey: 'gross' },
      { header: 'TAX', dataKey: 'tax' },
      { header: 'NET DIVIDEND', dataKey: 'net' },
      { header: 'COMPOSITION', dataKey: 'composition' },
    ];

    const tableData = data.map((r) => ({
      sn: r.sn ?? '',
      type: r.type,
      transaction_count: r.transaction_count.toLocaleString('en-IN'),
      kitta: fmtNr(r.kitta),
      gross: fmtNr(r.gross),
      tax: fmtNr(r.tax),
      net: fmtNr(r.net),
      composition: `${(r.composition ?? 0).toFixed(2)}%`,
    }));

    tableData.push({
      sn: '' as any,
      type: 'TOTAL',
      transaction_count: total.transaction_count.toLocaleString('en-IN'),
      kitta: fmtNr(total.kitta),
      gross: fmtNr(total.gross),
      tax: fmtNr(total.tax),
      net: fmtNr(total.net),
      composition: '100.00%',
    });

    PdfGenerator.generate(
      {
        title: 'Mutual Fund Distribution Summary Report',
        subtitle,
        companyName,
        generatedBy: 'RTARTS System',
      },
      columns,
      tableData
    );
  },
};
