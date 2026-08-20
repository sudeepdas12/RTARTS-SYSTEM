import * as XLSX from 'xlsx';
import { PdfGenerator } from '@/lib/pdf-generator';

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
  // 1. Lot name / Sheet name
  const lot = String(p.lot_name || '').trim().toUpperCase();
  if (lot.includes('MUTUAL') || lot.includes('EXEMPT') || lot.includes('RETIREMENT')) return 'MUTUAL_FUND';
  if (lot.includes('PRIVATE') || lot.includes('INSTITUT') || lot.includes('COMPANY') || lot.includes('LEGAL')) return 'PRIVATE';
  if (lot.includes('PUBLIC')) return 'PUBLIC';

  // 2. Classification
  const cls = String(p.payee_classification || p.client?.payee_classification || '').trim().toUpperCase();
  if (cls.includes('TAX_EXEMPT') || cls.includes('MUTUAL_FUND')) return 'MUTUAL_FUND';
  if (cls.includes('INSTITUTION') || cls.includes('COMPANY') || cls.includes('PRIVATE')) return 'PRIVATE';
  if (cls.includes('NATURAL') || cls.includes('PUBLIC')) return 'PUBLIC';

  // 3. Holder type
  const holder = String(p.client?.holder_type || '').trim().toUpperCase();
  if (holder.includes('EXEMPT') || holder.includes('MUTUAL')) return 'MUTUAL_FUND';
  if (holder.includes('LEGAL') || holder.includes('INSTITUT') || holder.includes('PRIVATE')) return 'PRIVATE';
  if (holder.includes('PUBLIC')) return 'PUBLIC';

  // 4. Name heuristics
  const name = String(p.client?.full_name || p.full_name || '').trim().toUpperCase();
  if (/(MUTUAL\s*FUND|RETIREMENT\s*FUND|PENSION\s*FUND|PROVIDENT\s*FUND|KOSH\b|SANCHAYA\s*KOSH|NAGARIK\s*LAGANI|\bCIT\b|\bEPF\b|SAMRIDDHI\s*FUND|EQUITY\s*FUND|GROWTH\s*FUND|SCHEME\b)/i.test(name)) {
    return 'MUTUAL_FUND';
  }
  if (/(PVT\.?LTD|PRIVATE LIMITED|\bLIMITED\b|\bLTD\.?\b|\bCOMPANY\b|CORPORATION|ASSOCIATES|FOUNDATION|\bGROUP\b|HOLDINGS|\bTRUST\b|\bBANK\b|FINANCE|MICROFINANCE|HYDROPOWER|INSURANCE|INSTITUTE|SOCIETY|COOPERATIVE|SAHAKARI|ENTERPRISES|VENTURES|INVESTMENT|CAPITAL|SECURITIES)/i.test(name)) {
    return 'PRIVATE';
  }

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
    if (!detectedCouponRate) {
      for (const p of payables) {
        const rate = Number(p.interest_rate_value || p.tds_rate || p.interest_rate || 0);
        if (rate > 0 && rate <= 30) {
          detectedCouponRate = rate;
          break;
        }
      }
    }
    if (!detectedCouponRate) detectedCouponRate = 7; // Standard default 7%

    const groups: Record<
      'PUBLIC' | 'PRIVATE' | 'MUTUAL_FUND',
      {
        kitta: number;
        gross: number;
        tax: number;
        net: number;
        unitholders: Set<string>;
      }
    > = {
      PUBLIC: { kitta: 0, gross: 0, tax: 0, net: 0, unitholders: new Set() },
      PRIVATE: { kitta: 0, gross: 0, tax: 0, net: 0, unitholders: new Set() },
      MUTUAL_FUND: { kitta: 0, gross: 0, tax: 0, net: 0, unitholders: new Set() },
    };

    let grandKitta = 0;

    for (const p of payables) {
      const cat = determineDebentureCategory(p);
      const clientId = p.client_id || p.id || crypto.randomUUID();
      
      // Units held / kitta
      let kitta = Number(p.shares_held || p.kitta || 0);
      let gross = Number(p.gross_interest || 0);
      let tax = Number(p.tax_amount || 0);
      let net = Number(p.net_payable || (gross - tax));

      // If kitta is 0 but gross exists, derive kitta approximately or vice versa
      if (kitta === 0 && gross > 0 && detectedCouponRate > 0) {
        if (overrideDays && overrideDays > 0) {
          kitta = Math.round((gross * 365) / (fv * (detectedCouponRate / 100) * overrideDays));
        } else {
          kitta = Math.round(gross / (fv * (detectedCouponRate / 100)));
        }
      }

      // If gross is 0 but kitta exists, calculate gross
      if (gross === 0 && kitta > 0) {
        const annual = kitta * fv * (detectedCouponRate / 100);
        if (overrideDays && overrideDays > 0) {
          gross = Math.round((annual / 365) * overrideDays * 100) / 100;
        } else {
          gross = annual;
        }
      }

      // Calculate TDS based on category: Public 6%, Private 15%, Mutual Fund 0%
      if (tax === 0 && gross > 0) {
        if (cat === 'PUBLIC') {
          tax = Math.round(gross * 0.06 * 100) / 100;
        } else if (cat === 'PRIVATE') {
          tax = Math.round(gross * 0.15 * 100) / 100;
        } else {
          tax = 0;
        }
      }

      if (net === 0 && gross > 0) {
        net = gross - tax;
      }

      groups[cat].kitta += kitta;
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
      { key: 'PUBLIC', label: 'Public', taxRatePercent: 6 },
      { key: 'PRIVATE', label: 'Institution', taxRatePercent: 15 },
      { key: 'MUTUAL_FUND', label: 'Tax Exempted', taxRatePercent: 0 },
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
      const principal = g.kitta * fv;
      const annualInt = principal * (detectedCouponRate / 100);
      const intPerDay = Math.round((annualInt / 365) * 100) / 100;
      const comp = grandKitta > 0 ? Math.round((g.kitta / grandKitta) * 10000) / 100 : 0;

      rows.push({
        name: cfg.label,
        category: cfg.key,
        kitta: g.kitta,
        principalAmount: principal,
        annualInterest: annualInt,
        interestPerDay: intPerDay,
        grossInterest: g.gross,
        taxAmount: g.tax,
        netInterestPayable: g.net,
        taxRatePercent: cfg.taxRatePercent,
        unitholderCount: g.unitholders.size,
        composition: comp,
      });

      total.kitta += g.kitta;
      total.principalAmount += principal;
      total.annualInterest += annualInt;
      total.interestPerDay += intPerDay;
      total.grossInterest += g.gross;
      total.taxAmount += g.tax;
      total.netInterestPayable += g.net;
      total.unitholderCount += g.unitholders.size;
    }

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
    const rateHeader = 'INT. @ ' + report.couponRate + '%';
    const aoa: (string | number)[][] = [
      ['NAME', 'KITTA', 'AMOUNT', rateHeader, 'INT. PER DAY', 'INTEREST PUMORI', 'TAX', 'NET INTEREST PAYABLE'],
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
      { wch: 18 }, // INT @ RATE
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
      n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const rateHeader = 'INT. @ ' + report.couponRate + '%';

    const columns = [
      { header: 'NAME', dataKey: 'name' },
      { header: 'KITTA', dataKey: 'kitta' },
      { header: 'AMOUNT', dataKey: 'principalAmount' },
      { header: rateHeader, dataKey: 'annualInterest' },
      { header: 'INT. PER DAY', dataKey: 'interestPerDay' },
      { header: 'INTEREST PUMORI', dataKey: 'grossInterest' },
      { header: 'TAX', dataKey: 'taxAmount' },
      { header: 'NET INTEREST PAYABLE', dataKey: 'netInterestPayable' },
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
