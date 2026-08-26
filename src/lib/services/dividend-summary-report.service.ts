import * as XLSX from 'xlsx';
import { supabase, fetchAllRows } from './database';
import { PdfGenerator } from '@/lib/pdf-generator';
import { smartClassify } from './smart-classifier';

export interface AgmDividendSummaryRow {
  sn: number;
  particular: string; // e.g. "PROMOTER", "PUBLIC", "LOCAL UNVERIFIED", "INSTITUTION", "TAX EXEMPTED"
  shareholderCount: number;
  kitta: number;
  actualBonus: number;
  bonusRate: number;
  issuedBonus: number;
  remFraction: number;
  afterBonusKitta: number;
  grossDividend: number;
  dividendRate: number;
  bonTax: number;
  divTax: number;
  netDividend: number;
  composition: number;
}

export interface AgmDividendSummaryReport {
  companyName: string;
  companyCode: string;
  fiscalYear: string;
  detectedBonusRate: number;
  detectedDividendRate: number;
  rows: AgmDividendSummaryRow[];
  total: {
    shareholderCount: number;
    kitta: number;
    actualBonus: number;
    issuedBonus: number;
    remFraction: number;
    afterBonusKitta: number;
    grossDividend: number;
    bonTax: number;
    divTax: number;
    netDividend: number;
    composition: number;
  };
}

export type AgmParticular = 'PROMOTER' | 'PUBLIC' | 'LOCAL AFFECTED' | 'EMPLOYEE / STAFF' | 'INSTITUTION' | 'MUTUAL FUND (TAX EXEMPT)';

export function determineParticular(p: any): string {
  return determineAgmCategory(p);
}

export function determineAgmCategory(p: any): AgmParticular {
  // Check explicit lot segment first
  const lot = String(p.lot_name || '').trim().toUpperCase();
  const holder = String(p.client?.holder_type || p.holder_type || '').toUpperCase();
  const segment = String(p.payee_segment || p.client?.payee_segment || '').toUpperCase();

  if (lot.includes('PROMOTER') || lot.includes('PROMOT') || holder.includes('PROMOT') || segment === 'PROMOTER') return 'PROMOTER';
  if (lot.includes('LOCAL') || lot.includes('UNVERIFIED') || holder.includes('LOCAL') || segment === 'LOCAL') return 'LOCAL AFFECTED';
  if (lot.includes('STAFF') || lot.includes('EMPLOYEE') || holder.includes('EMPLOYEE') || holder.includes('STAFF') || segment === 'EMPLOYEE') return 'EMPLOYEE / STAFF';

  const result = smartClassify({
    full_name: p.client?.full_name || p.full_name,
    father_name: p.client?.father_name || p.father_name,
    grandfather_name: p.client?.grandfather_name || p.grandfather_name,
    citizenship: p.client?.citizenship || p.citizenship,
    holder_type: p.client?.holder_type || p.holder_type,
    payee_classification: p.payee_classification || p.client?.payee_classification,
    lot_name: p.lot_name,
  });

  if (result.payee_category === 'PROMOTER') return 'PROMOTER';
  if (result.payee_category === 'LOCAL') return 'LOCAL AFFECTED';
  if (result.payee_category === 'EMPLOYEE') return 'EMPLOYEE / STAFF';
  if (result.payee_classification === 'TAX_EXEMPT' || result.payee_category === 'MUTUAL_FUND' || result.payee_category === 'TAX_EXEMPT') return 'MUTUAL FUND (TAX EXEMPT)';
  if (result.payee_classification === 'COMPANY_INSTITUTION' || result.payee_category === 'INSTITUTION') return 'INSTITUTION';
  return 'PUBLIC';
}

export const AgmDividendSummaryReportService = {
  /**
   * Generates the AGM Summary Report from an array of dividend payable records
   */
  generateReportFromPayables(
    payables: any[],
    companyName = 'All Companies',
    companyCode = '',
    fiscalYear = '',
    overrideBonusRate?: number,
    overrideDividendRate?: number
  ): AgmDividendSummaryReport {
    if (!payables.length) {
      return {
        companyName,
        companyCode,
        fiscalYear,
        detectedBonusRate: overrideBonusRate || 0,
        detectedDividendRate: overrideDividendRate || 0,
        rows: [],
        total: {
          shareholderCount: 0,
          kitta: 0,
          actualBonus: 0,
          issuedBonus: 0,
          remFraction: 0,
          afterBonusKitta: 0,
          grossDividend: 0,
          bonTax: 0,
          divTax: 0,
          netDividend: 0,
          composition: 0,
        },
      };
    }

    // Determine representative rates
    let detectedBonusRate = overrideBonusRate || 0;
    let detectedDividendRate = overrideDividendRate || 0;

    if (!detectedDividendRate) {
      for (const p of payables) {
        if (Number(p.dividend_rate || 0) > 0) {
          detectedDividendRate = Number(p.dividend_rate);
          break;
        }
      }
    }

    if (!detectedBonusRate) {
      for (const p of payables) {
        if (Number(p.shares_held || 0) > 0 && Number(p.bonus_actual || 0) > 0) {
          detectedBonusRate = Math.round((Number(p.bonus_actual) / Number(p.shares_held)) * 10000) / 100;
          break;
        }
      }
    }

    // Group records by Particular
    const groupOrder: AgmParticular[] = ['PROMOTER', 'PUBLIC', 'LOCAL AFFECTED', 'EMPLOYEE / STAFF', 'INSTITUTION', 'MUTUAL FUND (TAX EXEMPT)'];
    const groups = new Map<
      string,
      {
        shareholders: Set<string>;
        kitta: number;
        actualBonus: number;
        issuedBonus: number;
        remFraction: number;
        afterBonusKitta: number;
        grossDividend: number;
        bonTax: number;
        divTax: number;
        netDividend: number;
      }
    >();

    let grandKitta = 0;

    for (const p of payables) {
      const particular = determineParticular(p);
      const clientId = p.client_id || p.id || crypto.randomUUID();
      const shares = Number(p.shares_held || 0);

      // Bonus calculations
      let actualB = Number(p.bonus_actual || 0);
      if (actualB === 0 && detectedBonusRate > 0 && shares > 0) {
        actualB = (shares * detectedBonusRate) / 100;
      }
      let issuedB = Number(p.bonus_issued || 0);
      if (issuedB === 0 && actualB > 0) {
        issuedB = Math.floor(actualB);
      }
      let remFrac = Number(p.bonus_fraction || 0);
      if (remFrac === 0 && actualB > 0) {
        remFrac = Math.round((actualB - issuedB) * 10000) / 10000;
      }
      let afterB = Number(p.after_bonus_kitta || 0);
      if (afterB === 0) {
        afterB = shares + issuedB;
      }

      // Cash Dividend & Tax calculations
      let gross = Number(p.gross_dividend || 0);
      if (gross === 0 && detectedDividendRate > 0 && shares > 0) {
        gross = shares * detectedDividendRate;
      }
      let divTax = Number(p.tax_amount || 0);
      if (divTax === 0 && gross > 0 && particular !== 'MUTUAL FUND (TAX EXEMPT)' && particular !== 'TAX EXEMPTED') {
        divTax = Math.round(gross * 0.05 * 100) / 100;
      }
      let bonusTax = Number(p.bonus_tax || 0);
      if (bonusTax === 0 && actualB > 0 && particular !== 'MUTUAL FUND (TAX EXEMPT)' && particular !== 'TAX EXEMPTED') {
        bonusTax = Math.round(actualB * 100 * 0.05 * 100) / 100;
      }
      let net = Number(p.net_payable || (gross - divTax));
      if (net === 0 && gross > 0) {
        net = gross - divTax;
      }

      grandKitta += shares;

      let g = groups.get(particular);
      if (!g) {
        g = {
          shareholders: new Set<string>(),
          kitta: 0,
          actualBonus: 0,
          issuedBonus: 0,
          remFraction: 0,
          afterBonusKitta: 0,
          grossDividend: 0,
          bonTax: 0,
          divTax: 0,
          netDividend: 0,
        };
        groups.set(particular, g);
      }

      g.shareholders.add(clientId);
      g.kitta += shares;
      g.actualBonus += actualB;
      g.issuedBonus += issuedB;
      g.remFraction += remFrac;
      g.afterBonusKitta += afterB;
      g.grossDividend += gross;
      g.bonTax += bonusTax;
      g.divTax += divTax;
      g.netDividend += net;
    }

    // Sort according to standard RTA groupOrder
    const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
      const idxA = groupOrder.indexOf(a);
      const idxB = groupOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    const rows: AgmDividendSummaryRow[] = [];
    let totShareholders = 0;
    let totKitta = 0;
    let totActualBonus = 0;
    let totIssuedBonus = 0;
    let totRemFraction = 0;
    let totAfterBonusKitta = 0;
    let totGrossDividend = 0;
    let totBonTax = 0;
    let totDivTax = 0;
    let totNetDividend = 0;

    let sn = 1;
    for (const key of sortedKeys) {
      const g = groups.get(key)!;
      const shCount = g.shareholders.size;
      const comp = grandKitta > 0 ? (g.kitta / grandKitta) * 100 : 0;

      rows.push({
        sn: sn++,
        particular: key,
        shareholderCount: shCount,
        kitta: Math.round(g.kitta * 100) / 100,
        actualBonus: Math.round(g.actualBonus * 100) / 100,
        bonusRate: detectedBonusRate,
        issuedBonus: Math.round(g.issuedBonus * 100) / 100,
        remFraction: Math.round(g.remFraction * 100) / 100,
        afterBonusKitta: Math.round(g.afterBonusKitta * 100) / 100,
        grossDividend: Math.round(g.grossDividend * 100) / 100,
        dividendRate: detectedDividendRate,
        bonTax: Math.round(g.bonTax * 100) / 100,
        divTax: Math.round(g.divTax * 100) / 100,
        netDividend: Math.round(g.netDividend * 100) / 100,
        composition: Math.round(comp * 100) / 100,
      });

      totShareholders += shCount;
      totKitta += g.kitta;
      totActualBonus += g.actualBonus;
      totIssuedBonus += g.issuedBonus;
      totRemFraction += g.remFraction;
      totAfterBonusKitta += g.afterBonusKitta;
      totGrossDividend += g.grossDividend;
      totBonTax += g.bonTax;
      totDivTax += g.divTax;
      totNetDividend += g.netDividend;
    }

    return {
      companyName,
      companyCode,
      fiscalYear,
      detectedBonusRate,
      detectedDividendRate,
      rows,
      total: {
        shareholderCount: totShareholders,
        kitta: Math.round(totKitta * 100) / 100,
        actualBonus: Math.round(totActualBonus * 100) / 100,
        issuedBonus: Math.round(totIssuedBonus * 100) / 100,
        remFraction: Math.round(totRemFraction * 100) / 100,
        afterBonusKitta: Math.round(totAfterBonusKitta * 100) / 100,
        grossDividend: Math.round(totGrossDividend * 100) / 100,
        bonTax: Math.round(totBonTax * 100) / 100,
        divTax: Math.round(totDivTax * 100) / 100,
        netDividend: Math.round(totNetDividend * 100) / 100,
        composition: 100.0,
      },
    };
  },

  /**
   * Generates separate individual company reports when multiple companies exist in the dataset
   */
  generateMultiCompanyReports(payables: any[]): AgmDividendSummaryReport[] {
    if (!payables.length) return [];
    const companyGroups = new Map<string, any[]>();
    for (const p of payables) {
      const companyId = p.company_id || 'unknown';
      if (!companyGroups.has(companyId)) companyGroups.set(companyId, []);
      companyGroups.get(companyId)!.push(p);
    }
    const reports: AgmDividendSummaryReport[] = [];
    for (const [, list] of companyGroups) {
      const cName = list[0]?.company?.company_name || 'Unknown Company';
      const cCode = list[0]?.company?.company_code || '';
      const fy = list[0]?.fiscal_year || '';
      reports.push(this.generateReportFromPayables(list, cName, cCode, fy));
    }
    return reports.sort((a, b) => a.companyName.localeCompare(b.companyName));
  },

  /**
   * Fetches payables for a specific company and fiscal year, and generates the report
   */
  async getCompanySummary(companyId?: string, fiscalYear?: string): Promise<AgmDividendSummaryReport> {
    const data = await fetchAllRows<any>((from, to) => {
      let query = (supabase as any)
        .from('dividend_payables')
        .select('id, client_id, company_id, shares_held, dividend_rate, gross_dividend, tax_amount, net_payable, fiscal_year, dividend_type, bonus_actual, bonus_issued, bonus_fraction, after_bonus_kitta, bonus_tax, lot_name, payee_classification, payee_segment, client:clients(id, full_name, holder_type, payee_classification, payee_segment), company:companies(id, company_code, company_name)')
        .range(from, to);

      if (companyId && companyId !== 'all') {
        query = query.eq('company_id', companyId);
      }
      if (fiscalYear && fiscalYear !== 'all') {
        query = query.eq('fiscal_year', fiscalYear);
      }
      return query;
    });

    const companyName = data?.[0]?.company?.company_name || 'All Companies';
    const companyCode = data?.[0]?.company?.company_code || '';
    const fy = fiscalYear && fiscalYear !== 'all' ? fiscalYear : data?.[0]?.fiscal_year || '';

    return this.generateReportFromPayables(data || [], companyName, companyCode, fy);
  },

  /**
   * Exports the summary report to an exact Excel file
   */
  exportToExcel(report: AgmDividendSummaryReport): void {
    const bonusColHeader = report.detectedBonusRate ? `ACTUAL_BONUS ${report.detectedBonusRate}%` : 'ACTUAL_BONUS';
    const divColHeader = report.detectedDividendRate ? `DIVIDEND ${report.detectedDividendRate}` : 'DIVIDEND';

    const excelRows = report.rows.map((r) => ({
      'S.N.': r.sn,
      'PARTICULAR': r.particular,
      'NO. OF SHAREHOLDER': r.shareholderCount,
      'KITTA': r.kitta,
      [bonusColHeader]: r.actualBonus,
      'ISSUED BONUS': r.issuedBonus,
      'REM FRACTION': r.remFraction,
      'AFTER BONUS KITTA': r.afterBonusKitta,
      [divColHeader]: r.grossDividend,
      'BON_TAX': r.bonTax,
      'DIV_TAX': r.divTax,
      'NET_DIV.': r.netDividend,
      'COMPOSITION': r.composition,
    }));

    // Append TOTAL row
    excelRows.push({
      'S.N.': '' as any,
      'PARTICULAR': 'TOTAL',
      'NO. OF SHAREHOLDER': report.total.shareholderCount,
      'KITTA': report.total.kitta,
      [bonusColHeader]: report.total.actualBonus,
      'ISSUED BONUS': report.total.issuedBonus,
      'REM FRACTION': report.total.remFraction,
      'AFTER BONUS KITTA': report.total.afterBonusKitta,
      [divColHeader]: report.total.grossDividend,
      'BON_TAX': report.total.bonTax,
      'DIV_TAX': report.total.divTax,
      'NET_DIV.': report.total.netDividend,
      'COMPOSITION': report.total.composition,
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelRows);

    // Set column widths
    ws['!cols'] = [
      { wch: 6 },  // S.N.
      { wch: 20 }, // PARTICULAR
      { wch: 20 }, // NO. OF SHAREHOLDER
      { wch: 16 }, // KITTA
      { wch: 18 }, // ACTUAL_BONUS
      { wch: 16 }, // ISSUED BONUS
      { wch: 16 }, // REM FRACTION
      { wch: 20 }, // AFTER BONUS KITTA
      { wch: 18 }, // DIVIDEND
      { wch: 16 }, // BON_TAX
      { wch: 16 }, // DIV_TAX
      { wch: 18 }, // NET_DIV.
      { wch: 14 }, // COMPOSITION
    ];

    const fileName = `${report.companyCode || 'Summary'}_Dividend_Distribution_Summary_${report.fiscalYear || 'All'}.xlsx`;
    XLSX.utils.book_append_sheet(wb, ws, 'Distribution Summary');
    XLSX.writeFile(wb, fileName);
  },

  /**
   * Exports the summary report to a clean, landscape PDF report
   */
  exportToPdf(report: AgmDividendSummaryReport): void {
    const bonusColHeader = report.detectedBonusRate ? `ACTUAL_BONUS ${report.detectedBonusRate}%` : 'ACTUAL_BONUS';
    const divColHeader = report.detectedDividendRate ? `DIVIDEND ${report.detectedDividendRate}` : 'DIVIDEND';

    const columns = [
      { header: 'S.N.', dataKey: 'sn' },
      { header: 'PARTICULAR', dataKey: 'particular' },
      { header: 'NO. OF SHAREHOLDER', dataKey: 'shareholderCount' },
      { header: 'KITTA', dataKey: 'kitta' },
      { header: bonusColHeader, dataKey: 'actualBonus' },
      { header: 'ISSUED BONUS', dataKey: 'issuedBonus' },
      { header: 'REM FRACTION', dataKey: 'remFraction' },
      { header: 'AFTER BONUS KITTA', dataKey: 'afterBonusKitta' },
      { header: divColHeader, dataKey: 'grossDividend' },
      { header: 'BON_TAX', dataKey: 'bonTax' },
      { header: 'DIV_TAX', dataKey: 'divTax' },
      { header: 'NET_DIV.', dataKey: 'netDividend' },
      { header: 'COMPOSITION', dataKey: 'composition' },
    ];

    const fmtNr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const tableData = report.rows.map((r) => ({
      sn: r.sn,
      particular: r.particular,
      shareholderCount: r.shareholderCount.toLocaleString('en-IN'),
      kitta: fmtNr(r.kitta),
      actualBonus: fmtNr(r.actualBonus),
      issuedBonus: fmtNr(r.issuedBonus),
      remFraction: fmtNr(r.remFraction),
      afterBonusKitta: fmtNr(r.afterBonusKitta),
      grossDividend: fmtNr(r.grossDividend),
      bonTax: fmtNr(r.bonTax),
      divTax: fmtNr(r.divTax),
      netDividend: fmtNr(r.netDividend),
      composition: `${r.composition.toFixed(2)}%`,
    }));

    tableData.push({
      sn: '' as any,
      particular: 'TOTAL',
      shareholderCount: report.total.shareholderCount.toLocaleString('en-IN'),
      kitta: fmtNr(report.total.kitta),
      actualBonus: fmtNr(report.total.actualBonus),
      issuedBonus: fmtNr(report.total.issuedBonus),
      remFraction: fmtNr(report.total.remFraction),
      afterBonusKitta: fmtNr(report.total.afterBonusKitta),
      grossDividend: fmtNr(report.total.grossDividend),
      bonTax: fmtNr(report.total.bonTax),
      divTax: fmtNr(report.total.divTax),
      netDividend: fmtNr(report.total.netDividend),
      composition: `${report.total.composition.toFixed(2)}%`,
    });

    PdfGenerator.generate(
      {
        title: 'AGM Dividend & Bonus Distribution Summary Report',
        subtitle: `${report.companyName} (${report.companyCode}) — FY ${report.fiscalYear || 'All'}`,
        companyName: report.companyName || 'RTARTS System',
        generatedBy: 'RTARTS System',
      },
      columns,
      tableData
    );
  },
};
