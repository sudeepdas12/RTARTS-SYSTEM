import * as XLSX from 'xlsx';
import { PdfGenerator } from '@/lib/pdf-generator';
import { smartClassify } from './smart-classifier';

export interface DebentureSummaryRow {
  name: string;
  category: 'PUBLIC' | 'PRIVATE' | 'MUTUAL_FUND' | 'TAX_EXEMPTED' | 'OTHER';
  kitta: number;
  principalAmount: number;
  annualInterest: number;
  interestPerDay: number;
  grossInterest: number; // Pumori / Coupon Interest
  taxAmount: number;
  netInterestPayable: number;
  taxRatePercent: number;
  unitholderCount: number;
  composition: number;
}

export interface DebentureSummaryReport {
  companyName: string;
  companyCode: string;
  fiscalYear: string;
  couponRate: number;
  faceValue: number;
  daysCount?: number;
  rows: DebentureSummaryRow[];
  total: {
    kitta: number;
    principalAmount: number;
    annualInterest: number;
    interestPerDay: number;
    grossInterest: number;
    taxAmount: number;
    netInterestPayable: number;
    unitholderCount: number;
    composition: number;
  };
}

export function determineDebentureCategory(p: any): 'PUBLIC' | 'PRIVATE' | 'MUTUAL_FUND' {
  const explicitClass = p.payee_classification || p.client?.payee_classification;
  if (explicitClass === 'TAX_EXEMPT') return 'MUTUAL_FUND';
  if (explicitClass === 'COMPANY_INSTITUTION') return 'PRIVATE';
  if (explicitClass === 'NATURAL_PERSON' || explicitClass === 'PUBLIC_LEGAL_PERSON') return 'PUBLIC';

  const result = smartClassify({
    full_name: p.client?.full_name || p.full_name,
    father_name: p.client?.father_name || p.father_name,
    grandfather_name: p.client?.grandfather_name || p.grandfather_name,
    citizenship: p.client?.citizenship || p.citizenship,
    holder_type: p.client?.holder_type || p.holder_type,
    payee_classification: explicitClass,
    lot_name: p.lot_name,
  });

  if (result.payee_classification === 'TAX_EXEMPT') return 'MUTUAL_FUND';
  if (result.payee_classification === 'COMPANY_INSTITUTION') return 'PRIVATE';
  return 'PUBLIC';
}

export const DebentureSummaryReportService = {
  /**
   * Generates the Pumori / CDS Debenture Interest Distribution Summary
   */
  generateReportFromPayables(
    payables: any[],
    companyName = 'All Debentures',
    companyCode = '',
    fiscalYear = '',
    overrideCouponRate?: number,
    overrideFaceValue = 1000,
    overrideDays?: number
  ): DebentureSummaryReport {
    const fv = overrideFaceValue || 1000;

    if (!payables.length) {
      return {
        companyName,
        companyCode,
        fiscalYear,
        couponRate: overrideCouponRate || 0,
        faceValue: fv,
        daysCount: overrideDays,
        rows: [],
        total: {
          kitta: 0,
          principalAmount: 0,
          annualInterest: 0,
          interestPerDay: 0,
          grossInterest: 0,
          taxAmount: 0,
          netInterestPayable: 0,
          unitholderCount: 0,
          composition: 0,
        },
      };
    }

    // Detect coupon rate if not overridden
    let detectedCouponRate = overrideCouponRate || 0;
    const isAll = !companyCode || companyCode === 'All' || (companyName || '').toLowerCase().includes('all');

    if (!detectedCouponRate && !isAll) {
      // 1. Try to extract coupon rate from company name (e.g. "8.5% RBB", "8 5%", "8.75% PRIME", "10% DEBENTURE")
      const nameMatch = (companyName || '').match(/(\d+(?:[.\s]\d+)?)\s*%/);
      if (nameMatch) {
        detectedCouponRate = parseFloat(nameMatch[1].replace(/\s+/, '.'));
      }
    }
    if (!detectedCouponRate && !isAll) {
      for (const p of payables) {
        const refMatch = (p.instrument_ref || '').match(/(\d+(?:[.\s]\d+)?)\s*%/);
        if (refMatch) {
          detectedCouponRate = parseFloat(refMatch[1].replace(/\s+/, '.'));
          break;
        }
        const rate = Number(p.interest_rate_value || p.interest_rate || 0);
        if (rate > 0 && rate <= 30) {
          detectedCouponRate = rate;
          break;
        }
      }
    }

    const groups: Record<
      'PUBLIC' | 'PRIVATE' | 'MUTUAL_FUND',
      {
        kitta: number;
        principal: number;
        annualInterest: number;
        gross: number;
        tax: number;
        net: number;
        unitholders: Set<string>;
      }
    > = {
      PUBLIC: { kitta: 0, principal: 0, annualInterest: 0, gross: 0, tax: 0, net: 0, unitholders: new Set() },
      PRIVATE: { kitta: 0, principal: 0, annualInterest: 0, gross: 0, tax: 0, net: 0, unitholders: new Set() },
      MUTUAL_FUND: { kitta: 0, principal: 0, annualInterest: 0, gross: 0, tax: 0, net: 0, unitholders: new Set() },
    };

    let grandKitta = 0;

    for (const p of payables) {
      const cat = determineDebentureCategory(p);
      const clientId = p.client_id || p.id || crypto.randomUUID();
      
      let kitta = Number(p.shares_held || p.kitta || 0);
      let gross = Number(p.gross_interest || 0);
      let tax = Number(p.tax_amount || 0);
      let net = Number(p.net_payable || 0);
      let rowRate = Number(p.interest_rate_value || p.interest_rate || detectedCouponRate || 0);

      // If kitta is 0 but gross exists, derive exact kitta from coupon if rate exists
      if (kitta === 0 && gross > 0 && rowRate > 0) {
        kitta = Math.round(gross / (fv * (rowRate / 100)));
      }

      const principal = kitta * fv;
      let annualInt = rowRate > 0 ? principal * (rowRate / 100) : gross;

      if (gross === 0 && kitta > 0) {
        gross = annualInt;
      }
      if (tax === 0 && gross > 0 && cat !== 'MUTUAL_FUND') {
        const ratePct = cat === 'PUBLIC' ? 0.06 : 0.15;
        tax = Math.round(gross * ratePct * 100) / 100;
      }
      if (net === 0 && gross > 0) {
        net = Math.round((gross - tax) * 100) / 100;
      }

      groups[cat].kitta += kitta;
      groups[cat].principal += principal;
      groups[cat].annualInterest += annualInt;
      groups[cat].gross += gross;
      groups[cat].tax += tax;
      groups[cat].net += net;
      groups[cat].unitholders.add(clientId);

      grandKitta += kitta;
    }

    const categoryConfigs: Array<{
      key: 'PUBLIC' | 'PRIVATE' | 'MUTUAL_FUND';
      label: string;
      taxRatePercent: number;
    }> = [
      { key: 'PUBLIC', label: 'PUBLIC', taxRatePercent: 6 },
      { key: 'PRIVATE', label: 'INSTITUTION', taxRatePercent: 15 },
      { key: 'MUTUAL_FUND', label: 'MUTUAL FUND', taxRatePercent: 0 },
    ];

    const rows: DebentureSummaryRow[] = [];
    const total = {
      kitta: 0,
      principalAmount: 0,
      annualInterest: 0,
      interestPerDay: 0,
      grossInterest: 0,
      taxAmount: 0,
      netInterestPayable: 0,
      unitholderCount: 0,
      composition: 100,
    };

    for (const cfg of categoryConfigs) {
      const g = groups[cfg.key];
      const principal = g.principal;
      const annualInt = g.annualInterest;
      const intPerDay = Math.round((annualInt / 365) * 100) / 100;
      const comp = grandKitta > 0 ? Math.round((g.kitta / grandKitta) * 10000) / 100 : 0;

      const periodGross = overrideDays && overrideDays > 0 ? Math.round(intPerDay * overrideDays * 100) / 100 : g.gross;
      const periodTax = g.tax > 0 ? g.tax : Math.round(periodGross * (cfg.taxRatePercent / 100) * 100) / 100;
      const periodNet = g.net > 0 ? g.net : Math.round((periodGross - periodTax) * 100) / 100;

      rows.push({
        name: cfg.label,
        category: cfg.key,
        kitta: g.kitta,
        principalAmount: principal,
        annualInterest: annualInt,
        interestPerDay: intPerDay,
        grossInterest: periodGross,
        taxAmount: periodTax,
        netInterestPayable: periodNet,
        taxRatePercent: cfg.taxRatePercent,
        unitholderCount: g.unitholders.size,
        composition: comp,
      });

      total.kitta += g.kitta;
      total.principalAmount += principal;
      total.annualInterest += annualInt;
      total.interestPerDay += intPerDay;
      total.grossInterest += periodGross;
      total.taxAmount += periodTax;
      total.netInterestPayable += periodNet;
      total.unitholderCount += g.unitholders.size;
    }

    total.interestPerDay = Math.round(total.interestPerDay * 100) / 100;
    total.grossInterest = Math.round(total.grossInterest * 100) / 100;
    total.taxAmount = Math.round(total.taxAmount * 100) / 100;
    total.netInterestPayable = Math.round(total.netInterestPayable * 100) / 100;

    return {
      companyName,
      companyCode,
      fiscalYear,
      couponRate: detectedCouponRate,
      faceValue: fv,
      daysCount: overrideDays,
      rows,
      total,
    };
  },

  /**
   * Export debenture summary report to Excel in exact Pumori / CDS tabular format
   */
  exportToExcel(report: DebentureSummaryReport): void {
    const aoa: (string | number)[][] = [
      ['NAME', 'KITTA', 'AMOUNT', 'ANNUAL INTEREST', 'INT. PER DAY', 'INTEREST PUMORI', 'TAX', 'NET INTEREST PAYABLE'],
      ...report.rows.map((r) => [
        r.name,
        r.kitta,
        r.principalAmount,
        r.annualInterest,
        r.interestPerDay,
        r.grossInterest,
        r.taxAmount > 0 ? r.taxAmount : '-',
        r.netInterestPayable,
      ]),
      [
        'TOTAL',
        report.total.kitta,
        report.total.principalAmount,
        report.total.annualInterest,
        report.total.interestPerDay,
        report.total.grossInterest,
        report.total.taxAmount,
        report.total.netInterestPayable,
      ],
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 22 }, // NAME
      { wch: 18 }, // KITTA
      { wch: 22 }, // AMOUNT
      { wch: 18 }, // ANNUAL INTEREST
      { wch: 16 }, // INT PER DAY
      { wch: 20 }, // INTEREST PUMORI
      { wch: 16 }, // TAX
      { wch: 22 }, // NET INTEREST PAYABLE
    ];

    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let c = 1; c <= 7; c++) {
      for (let r = 1; r <= range.e.r; r++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (ws[addr] && typeof ws[addr].v === 'number') {
          ws[addr].z = '#,##0.00';
        }
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DEBENTURE SUMMARY');
    const safeCode = (report.companyCode || report.companyName || 'Debenture').replace(/[^a-zA-Z0-9_-]/g, '_');
    XLSX.writeFile(wb, safeCode + '_Debenture_Interest_Summary.xlsx');
  },

  /**
   * Export debenture summary report to PDF
   */
  exportToPdf(report: DebentureSummaryReport): void {
    const fmtNr = (n: number) =>
      Number(n || 0).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    const columns = [
      { header: 'Holder Category', dataKey: 'name' },
      { header: 'Kitta', dataKey: 'kitta' },
      { header: 'Principal Amount', dataKey: 'principalAmount' },
      { header: 'Annual Interest', dataKey: 'annualInterest' },
      { header: 'Int. Per Day', dataKey: 'interestPerDay' },
      { header: 'Gross Interest', dataKey: 'grossInterest' },
      { header: 'Tax Withheld', dataKey: 'taxAmount' },
      { header: 'Net Payable', dataKey: 'netInterestPayable' },
    ];

    const tableData = report.rows.map((r) => ({
      name: r.name,
      kitta: fmtNr(r.kitta),
      principalAmount: fmtNr(r.principalAmount),
      annualInterest: fmtNr(r.annualInterest),
      interestPerDay: fmtNr(r.interestPerDay),
      grossInterest: fmtNr(r.grossInterest),
      taxAmount: r.taxAmount > 0 ? fmtNr(r.taxAmount) : '-',
      netInterestPayable: fmtNr(r.netInterestPayable),
    }));

    tableData.push({
      name: 'TOTAL',
      kitta: fmtNr(report.total.kitta),
      principalAmount: fmtNr(report.total.principalAmount),
      annualInterest: fmtNr(report.total.annualInterest),
      interestPerDay: fmtNr(report.total.interestPerDay),
      grossInterest: fmtNr(report.total.grossInterest),
      taxAmount: fmtNr(report.total.taxAmount),
      netInterestPayable: fmtNr(report.total.netInterestPayable),
    });

    PdfGenerator.generate(
      {
        title: 'Debenture Interest Distribution Summary Report',
        subtitle: (report.companyName || '') + ' (' + (report.companyCode || 'ALL') + ')' + (report.fiscalYear ? ' — FY ' + report.fiscalYear : ''),
        companyName: report.companyName || 'RTARTS System',
        generatedBy: 'RTARTS System',
      },
      columns,
      tableData
    );
  },
};
