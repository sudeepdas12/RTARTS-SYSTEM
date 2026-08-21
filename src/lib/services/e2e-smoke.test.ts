import { describe, it, expect } from 'vitest';
import { calculatePayableTotals, detectPayeeCategory, getPayeeTaxRate, getPayeeCategoryLabel } from '@/lib/services/payable-summary';
import { mapToHolderType, getInvestorDemographicGroup } from '@/lib/services/investor-category';
import { determineDebentureCategory, DebentureSummaryReportService } from '@/lib/services/debenture-summary-report.service';

describe('End-to-End System Smoke Test', () => {
  describe('1. Shareholder Category & Uniform Labels', () => {
    it('correctly maps and labels Natural Person (Public)', () => {
      expect(getPayeeCategoryLabel('NATURAL_PERSON')).toBe('Natural Person (Public)');
      expect(getPayeeCategoryLabel('PUBLIC')).toBe('Public (Natural Person)');
      expect(mapToHolderType('PUBLIC')).toBe('Natural Person - Public');
      expect(getInvestorDemographicGroup('Natural Person - Public')).toBe('Natural Person');
    });

    it('correctly maps and labels Legal Person (Institution / Company)', () => {
      expect(getPayeeCategoryLabel('COMPANY_INSTITUTION')).toBe('Legal Person (Institution / Company)');
      expect(getPayeeCategoryLabel('INSTITUTION')).toBe('Legal Person (Institution / Company)');
      expect(mapToHolderType('INSTITUTION')).toBe('Legal Person');
      expect(getInvestorDemographicGroup('Legal Person')).toBe('Legal Person');
    });

    it('correctly maps and labels Tax Exempted (Mutual Fund / Retirement)', () => {
      expect(getPayeeCategoryLabel('TAX_EXEMPT')).toBe('Tax Exempted (Mutual Fund / Retirement Fund)');
      expect(getPayeeCategoryLabel('MUTUAL_FUND')).toBe('Mutual Fund (Tax Exempt)');
      expect(mapToHolderType('MUTUAL_FUND')).toBe('Mutual Fund');
      expect(mapToHolderType('TAX_EXEMPT')).toBe('Tax Exempt');
      expect(getInvestorDemographicGroup('Mutual Fund')).toBe('Mutual Fund');
      expect(getInvestorDemographicGroup('Tax Exempt')).toBe('Tax Exempt');
    });
  });

  describe('2. Equity Dividend TDS Calculation (5% Public, 5% Institution, 0% Tax Exempt)', () => {
    it('calculates 5% TDS for Public / Individual on Dividend', () => {
      const result = calculatePayableTotals({
        grossAmount: 100000,
        category: 'PUBLIC',
        isDebenture: false,
      });
      expect(result.grossAmount).toBe(100000);
      expect(result.taxAmount).toBe(5000); // 5%
      expect(result.netPayable).toBe(95000);
      expect(getPayeeTaxRate('PUBLIC', false)).toBe(0.05);
    });

    it('calculates 5% TDS for Institution / Corporate on Dividend', () => {
      const result = calculatePayableTotals({
        grossAmount: 100000,
        category: 'INSTITUTION',
        isDebenture: false,
      });
      expect(result.grossAmount).toBe(100000);
      expect(result.taxAmount).toBe(5000); // 5%
      expect(result.netPayable).toBe(95000);
      expect(getPayeeTaxRate('INSTITUTION', false)).toBe(0.05);
    });

    it('calculates 0% TDS for Tax Exempt / Mutual Fund on Dividend', () => {
      const result = calculatePayableTotals({
        grossAmount: 100000,
        category: 'TAX_EXEMPT',
        isDebenture: false,
      });
      expect(result.grossAmount).toBe(100000);
      expect(result.taxAmount).toBe(0); // 0%
      expect(result.netPayable).toBe(100000);
      expect(getPayeeTaxRate('TAX_EXEMPT', false)).toBe(0);
      expect(getPayeeTaxRate('MUTUAL_FUND', false)).toBe(0);
    });
  });

  describe('3. Debenture Interest TDS Calculation (6% Public, 15% Institution, 0% Tax Exempt)', () => {
    it('calculates 6% TDS for Public / Individual on Debenture Coupon', () => {
      const result = calculatePayableTotals({
        grossAmount: 100000,
        category: 'PUBLIC',
        isDebenture: true,
      });
      expect(result.grossAmount).toBe(100000);
      expect(result.taxAmount).toBe(6000); // 6%
      expect(result.netPayable).toBe(94000);
      expect(getPayeeTaxRate('PUBLIC', true)).toBe(0.06);
    });

    it('calculates 15% TDS for Institution / Corporate on Debenture Coupon', () => {
      const result = calculatePayableTotals({
        grossAmount: 100000,
        category: 'INSTITUTION',
        isDebenture: true,
      });
      expect(result.grossAmount).toBe(100000);
      expect(result.taxAmount).toBe(15000); // 15%
      expect(result.netPayable).toBe(85000);
      expect(getPayeeTaxRate('INSTITUTION', true)).toBe(0.15);
    });

    it('calculates 0% TDS for Tax Exempt / Mutual Fund on Debenture Coupon', () => {
      const result = calculatePayableTotals({
        grossAmount: 100000,
        category: 'TAX_EXEMPT',
        isDebenture: true,
      });
      expect(result.grossAmount).toBe(100000);
      expect(result.taxAmount).toBe(0); // 0%
      expect(result.netPayable).toBe(100000);
      expect(getPayeeTaxRate('TAX_EXEMPT', true)).toBe(0);
      expect(getPayeeTaxRate('MUTUAL_FUND', true)).toBe(0);
    });
  });

  describe('4. Debenture Summary Report Service (Pumori Format)', () => {
    it('generates accurate 3-tier Pumori debenture summary breakdown', () => {
      const samplePayables = [
        {
          id: '1',
          shares_held: 1000,
          gross_interest: 87500,
          tax_amount: 5250, // 6%
          net_payable: 82250,
          lot_name: 'PUBLIC',
          client: { full_name: 'Subash Shrestha', holder_type: 'Natural Person - Public' }
        },
        {
          id: '2',
          shares_held: 5000,
          gross_interest: 437500,
          tax_amount: 65625, // 15%
          net_payable: 371875,
          lot_name: 'PRIVATE',
          client: { full_name: 'Neco Insurance Ltd', holder_type: 'Legal Person' }
        },
        {
          id: '3',
          shares_held: 2000,
          gross_interest: 175000,
          tax_amount: 0, // 0%
          net_payable: 175000,
          lot_name: 'TAX EXEMPTED',
          client: { full_name: 'RBB Mutual Fund 1', holder_type: 'Mutual Fund' }
        }
      ];

      const report = DebentureSummaryReportService.generateReportFromPayables(
        samplePayables,
        'Prime Debenture 8.75%',
        'PRIME875',
        '2081/82',
        8.75
      );

      expect(report.rows.length).toBe(3);

      const pubRow = report.rows.find(r => r.category === 'PUBLIC');
      expect(pubRow?.taxRatePercent).toBe(6);
      expect(pubRow?.grossInterest).toBe(87500);
      expect(pubRow?.taxAmount).toBe(5250);

      const instRow = report.rows.find(r => r.category === 'PRIVATE');
      expect(instRow?.taxRatePercent).toBe(15);
      expect(instRow?.grossInterest).toBe(437500);
      expect(instRow?.taxAmount).toBe(65625);

      const exemptRow = report.rows.find(r => r.category === 'MUTUAL_FUND');
      expect(exemptRow?.taxRatePercent).toBe(0);
      expect(exemptRow?.grossInterest).toBe(175000);
      expect(exemptRow?.taxAmount).toBe(0);

      expect(report.total.grossInterest).toBe(700000);
      expect(report.total.taxAmount).toBe(70875);
      expect(report.total.netInterestPayable).toBe(629125);
    });
  });

  describe('5. Heuristic Detection of Shareholder Categories', () => {
    it('detects corporate legal persons by name keywords', () => {
      expect(determineDebentureCategory({ client: { full_name: 'SHIVAM CEMENTS LIMITED' } })).toBe('PRIVATE');
      expect(determineDebentureCategory({ client: { full_name: 'SURYA JYOTI LIFE INSURANCE CO. LTD.' } })).toBe('PRIVATE');
      expect(determineDebentureCategory({ client: { full_name: 'KUMARI BANK LIMITED' } })).toBe('PRIVATE');
    });

    it('detects mutual funds and tax-exempt funds by name keywords', () => {
      // Direct user mention: RBB Focus 40
      expect(determineDebentureCategory({ client: { full_name: 'RBB FOCUS 40' } })).toBe('MUTUAL_FUND');
      expect(detectPayeeCategory({ full_name: 'RBB Focus 40' })).toBe('MUTUAL_FUND');
      
      // All other unique SEBON mutual funds
      expect(determineDebentureCategory({ client: { full_name: 'RBB MUTUAL FUND 1' } })).toBe('MUTUAL_FUND');
      expect(determineDebentureCategory({ client: { full_name: 'NIC ASIA SELECT 30' } })).toBe('MUTUAL_FUND');
      expect(determineDebentureCategory({ client: { full_name: 'CITIZENS SUPER 30 MUTUAL FUND' } })).toBe('MUTUAL_FUND');
      expect(determineDebentureCategory({ client: { full_name: 'NIBL SAMRIDDHI FUND 2' } })).toBe('MUTUAL_FUND');
      expect(determineDebentureCategory({ client: { full_name: 'GLOBAL IME SAMUNNAT SCHEME 1' } })).toBe('MUTUAL_FUND');
      expect(determineDebentureCategory({ client: { full_name: 'NIBL PRAGATI FUND' } })).toBe('MUTUAL_FUND');
      expect(determineDebentureCategory({ client: { full_name: 'KUMARI DHANABRIDDHI YOJANA' } })).toBe('MUTUAL_FUND');
      expect(determineDebentureCategory({ client: { full_name: 'SUNRISE BLUECHIP FUND' } })).toBe('MUTUAL_FUND');
      expect(determineDebentureCategory({ client: { full_name: 'NABIL FLEXI CAP FUND' } })).toBe('MUTUAL_FUND');
      expect(determineDebentureCategory({ client: { full_name: 'SANIMA LARGE CAP FUND' } })).toBe('MUTUAL_FUND');
      expect(determineDebentureCategory({ client: { full_name: 'SIDDHARTHA SYSTEMATIC INVESTMENT SCHEME' } })).toBe('MUTUAL_FUND');
      
      // Statutory Tax-Exempt / Retirement Funds
      expect(determineDebentureCategory({ client: { full_name: 'CITIZEN INVESTMENT TRUST' } })).toBe('MUTUAL_FUND');
      expect(determineDebentureCategory({ client: { full_name: 'EMPLOYEES PROVIDENT FUND' } })).toBe('MUTUAL_FUND');
      expect(determineDebentureCategory({ client: { full_name: 'NAGARIK LAGANI KOSH' } })).toBe('MUTUAL_FUND');
      expect(determineDebentureCategory({ client: { full_name: 'SOCIAL SECURITY FUND' } })).toBe('MUTUAL_FUND');
      expect(determineDebentureCategory({ client: { full_name: 'NEPAL BANK KARMACHARI AWAKASH KOSH BYAWASTHAPAN TRUST' } })).toBe('MUTUAL_FUND');
    });

    it('detects natural persons as default public and avoids false positives on names containing kosh', () => {
      expect(determineDebentureCategory({ client: { full_name: 'RAM BAHADUR SHRESTHA' } })).toBe('PUBLIC');
      expect(determineDebentureCategory({ client: { full_name: 'SITA DEVI POUDEL' } })).toBe('PUBLIC');
      
      // Real Nepali human names containing 'kosh' (e.g. Rikosh, Hikosh, Kikosh, Kosh Raj, Kosh Nath)
      expect(determineDebentureCategory({ client: { full_name: 'Rikosh Giri', father_name: 'Himalaya Giri' } })).toBe('PUBLIC');
      expect(detectPayeeCategory({ full_name: 'Rikosh Giri', father_name: 'Himalaya Giri' })).toBe('PUBLIC');

      expect(determineDebentureCategory({ client: { full_name: 'Hikosh Giri', father_name: 'Himalaya Giri' } })).toBe('PUBLIC');
      expect(detectPayeeCategory({ full_name: 'Hikosh Giri', father_name: 'Himalaya Giri' })).toBe('PUBLIC');

      expect(determineDebentureCategory({ client: { full_name: 'KIKOSH THAPA', father_name: 'SANJU SINGH THAPA' } })).toBe('PUBLIC');
      expect(detectPayeeCategory({ full_name: 'KIKOSH THAPA', father_name: 'SANJU SINGH THAPA' })).toBe('PUBLIC');

      expect(determineDebentureCategory({ client: { full_name: 'Kosh Nath Adhikari', father_name: 'Mani Nath Adhikari' } })).toBe('PUBLIC');
      expect(detectPayeeCategory({ full_name: 'Kosh Nath Adhikari', father_name: 'Mani Nath Adhikari' })).toBe('PUBLIC');

      expect(determineDebentureCategory({ client: { full_name: 'KOSH RAJ POKHAREAL', father_name: 'BHOJ RAJ POKHAREAL' } })).toBe('PUBLIC');
      expect(detectPayeeCategory({ full_name: 'KOSH RAJ POKHAREAL', father_name: 'BHOJ RAJ POKHAREAL' })).toBe('PUBLIC');

      expect(determineDebentureCategory({ client: { full_name: 'kosh raj subedi', father_name: 'chandra Kanta Subedi' } })).toBe('PUBLIC');
      expect(detectPayeeCategory({ full_name: 'kosh raj subedi', father_name: 'chandra Kanta Subedi' })).toBe('PUBLIC');
    });

    it('classifies private limited companies with fund/kosh in name as INSTITUTION', () => {
      expect(determineDebentureCategory({ client: { full_name: 'KHIMADEVI LAGANI KOSH PVT.LTD' } })).toBe('PRIVATE');
      expect(detectPayeeCategory({ full_name: 'KHIMADEVI LAGANI KOSH PVT.LTD' })).toBe('INSTITUTION');

      expect(determineDebentureCategory({ client: { full_name: 'KOSH BYAWASTHAPAN COMPANY' } })).toBe('PRIVATE');
      expect(detectPayeeCategory({ full_name: 'KOSH BYAWASTHAPAN COMPANY' })).toBe('INSTITUTION');

      expect(determineDebentureCategory({ client: { full_name: 'SHUBHA LAGANI PVT. LTD.' } })).toBe('PRIVATE');
      expect(detectPayeeCategory({ full_name: 'SHUBHA LAGANI PVT. LTD.' })).toBe('INSTITUTION');
    });
  });
});
