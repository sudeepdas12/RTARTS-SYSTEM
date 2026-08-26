import { describe, it, expect } from 'vitest';
import { smartClassify } from './smart-classifier';

describe('Smart Shareholder Classification Engine (Ultra-Smart & Multi-Tier)', () => {
  describe('1. Natural Person (Public & Individuals)', () => {
    it('correctly classifies human names containing "kosh" when family lineage is present', () => {
      const rikosh = smartClassify({ full_name: 'Rikosh Giri', father_name: 'Himalaya Giri' });
      expect(rikosh.payee_classification).toBe('NATURAL_PERSON');
      expect(rikosh.payee_category).toBe('PUBLIC');
      expect(rikosh.tds_rate_dividend).toBe(0.05);
      expect(rikosh.tds_rate_debenture).toBe(0.06);

      const hikosh = smartClassify({ full_name: 'Hikosh Giri', father_name: 'Himalaya Giri' });
      expect(hikosh.payee_classification).toBe('NATURAL_PERSON');
      expect(hikosh.tds_rate_dividend).toBe(0.05);

      const kikosh = smartClassify({ full_name: 'KIKOSH THAPA', father_name: 'SANJU SINGH THAPA' });
      expect(kikosh.payee_classification).toBe('NATURAL_PERSON');

      const koshRaj = smartClassify({ full_name: 'KOSH RAJ ONTA', grandfather_name: 'BHOJ RAJ ONTA' });
      expect(koshRaj.payee_classification).toBe('NATURAL_PERSON');

      const koshNath = smartClassify({ full_name: 'Kosh Nath Adhikari', citizenship_no: '105648411985' });
      expect(koshNath.payee_classification).toBe('NATURAL_PERSON');
    });

    it('correctly classifies minors with guardian details', () => {
      const minor = smartClassify({
        full_name: 'Aayush Shrestha',
        guardian_name: 'Suman Shrestha',
        guardian_relation: 'Father',
      });
      expect(minor.payee_classification).toBe('NATURAL_PERSON');
      expect(minor.holder_type).toBe('Natural Person - Minor');
      expect(minor.tds_rate_dividend).toBe(0.05);
      expect(minor.tds_rate_debenture).toBe(0.06);
    });

    it('correctly classifies personal titles (Dr, Er, Prof, CA, Adv, Mr, Mrs)', () => {
      const dr = smartClassify({ full_name: 'Dr. Ram Prasad Sharma' });
      expect(dr.payee_classification).toBe('NATURAL_PERSON');
      expect(dr.tds_rate_dividend).toBe(0.05);

      const er = smartClassify({ full_name: 'Er. Krishna Karki' });
      expect(er.payee_classification).toBe('NATURAL_PERSON');

      const ca = smartClassify({ full_name: 'CA. Binod Adhikari' });
      expect(ca.payee_classification).toBe('NATURAL_PERSON');
    });

    it('correctly classifies inline lineage phrases (s/o, d/o, w/o, minor)', () => {
      const so = smartClassify({ full_name: 'Rikosh Giri s/o Himalaya Giri' });
      expect(so.payee_classification).toBe('NATURAL_PERSON');
      expect(so.tds_rate_dividend).toBe(0.05);

      const wo = smartClassify({ full_name: 'Sunita Thapa w/o Rajesh Thapa' });
      expect(wo.payee_classification).toBe('NATURAL_PERSON');
    });

    it('correctly classifies joint human accounts', () => {
      const joint = smartClassify({ full_name: 'Ram Bahadur Shrestha / Sita Kumari Shrestha' });
      expect(joint.payee_classification).toBe('NATURAL_PERSON');
      expect(joint.holder_type).toBe('Natural Person - Joint Holder');
      expect(joint.tds_rate_dividend).toBe(0.05);
    });

    it('correctly classifies based on human demographics (gender, marital status, occupation)', () => {
      const female = smartClassify({ full_name: 'Anjali Sharma', gender: 'FEMALE' });
      expect(female.payee_classification).toBe('NATURAL_PERSON');

      const student = smartClassify({ full_name: 'Pradeep KC', occupation: 'Student' });
      expect(student.payee_classification).toBe('NATURAL_PERSON');
    });

    it('correctly classifies standard Nepali surnames', () => {
      const santosh = smartClassify({ full_name: 'Santosh Pokharel' });
      expect(santosh.payee_classification).toBe('NATURAL_PERSON');
      expect(santosh.tds_rate_dividend).toBe(0.05);
      expect(santosh.tds_rate_debenture).toBe(0.06);
    });
  });

  describe('2. Legal Person (Private Limited / Corporate Entities)', () => {
    it('strictly classifies PVT LTD companies with "Kosh" or "Lagani" as COMPANY_INSTITUTION', () => {
      const khimadevi = smartClassify({ full_name: 'KHIMADEVI LAGANI KOSH PVT.LTD' });
      expect(khimadevi.payee_classification).toBe('COMPANY_INSTITUTION');
      expect(khimadevi.payee_category).toBe('INSTITUTION');
      expect(khimadevi.tds_rate_dividend).toBe(0.05);
      expect(khimadevi.tds_rate_debenture).toBe(0.15);

      const koshByawasthapan = smartClassify({ full_name: 'KOSH BYAWASTHAPAN COMPANY' });
      expect(koshByawasthapan.payee_classification).toBe('COMPANY_INSTITUTION');
      expect(koshByawasthapan.tds_rate_debenture).toBe(0.15);

      const shubhaLagani = smartClassify({ full_name: 'SHUBHA LAGANI PVT. LTD.' });
      expect(shubhaLagani.payee_classification).toBe('COMPANY_INSTITUTION');
    });

    it('classifies banks, insurance, hydropower, cooperatives, and institutional organizations as COMPANY_INSTITUTION', () => {
      const bank = smartClassify({ full_name: 'NABIL BANK LIMITED' });
      expect(bank.payee_classification).toBe('COMPANY_INSTITUTION');
      expect(bank.tds_rate_debenture).toBe(0.15);

      const hydro = smartClassify({ full_name: 'CHILIME HYDROPOWER COMPANY LIMITED' });
      expect(hydro.payee_classification).toBe('COMPANY_INSTITUTION');

      const insurance = smartClassify({ full_name: 'NECO INSURANCE LIMITED' });
      expect(insurance.payee_classification).toBe('COMPANY_INSTITUTION');

      const sahakari = smartClassify({ full_name: 'JANAKALYAN BACHAT TATHA RIN SAHAKARI SANSTHA LTD' });
      expect(sahakari.payee_classification).toBe('COMPANY_INSTITUTION');
    });
  });

  describe('3. Tax Exempted Entities (SEBON Mutual Funds & Statutory Funds)', () => {
    it('classifies all SEBON Mutual Fund schemes as TAX_EXEMPT with 0% TDS', () => {
      const rbbFocus = smartClassify({ full_name: 'RBB FOCUS 40' });
      expect(rbbFocus.payee_classification).toBe('TAX_EXEMPT');
      expect(rbbFocus.payee_category).toBe('MUTUAL_FUND');
      expect(rbbFocus.tds_rate_dividend).toBe(0.0);
      expect(rbbFocus.tds_rate_debenture).toBe(0.0);

      const mega = smartClassify({ full_name: 'MEGA MUTUAL FUND -1' });
      expect(mega.payee_classification).toBe('TAX_EXEMPT');
      expect(mega.tds_rate_dividend).toBe(0.0);

      const niblSamriddhi = smartClassify({ full_name: 'NIBL SAMRIDDHI FUND-II' });
      expect(niblSamriddhi.payee_classification).toBe('TAX_EXEMPT');
      expect(niblSamriddhi.tds_rate_dividend).toBe(0.0);

      const sanimaGrowth = smartClassify({ full_name: 'SANIMA GROWTH FUND' });
      expect(sanimaGrowth.payee_classification).toBe('TAX_EXEMPT');

      const siddharthaSys = smartClassify({ full_name: 'SIDDHARTHA SYSTEMATIC INVESTMENT SCHEME' });
      expect(siddharthaSys.payee_classification).toBe('TAX_EXEMPT');

      const himalayan8020 = smartClassify({ full_name: 'HIMALAYAN 80-20' });
      expect(himalayan8020.payee_classification).toBe('TAX_EXEMPT');
      expect(himalayan8020.payee_category).toBe('MUTUAL_FUND');
      expect(himalayan8020.tds_rate_dividend).toBe(0.0);
      expect(himalayan8020.tds_rate_debenture).toBe(0.0);

      const himalayanColon = smartClassify({ full_name: 'HIMALAYAN 80:20' });
      expect(himalayanColon.payee_classification).toBe('TAX_EXEMPT');
      expect(himalayanColon.tds_rate_debenture).toBe(0.0);

      const prabhuSelect = smartClassify({ full_name: 'PRABHU SELECT FUND' });
      expect(prabhuSelect.payee_classification).toBe('TAX_EXEMPT');
      expect(prabhuSelect.tds_rate_debenture).toBe(0.0);

      const prabhuSmart = smartClassify({ full_name: 'PRABHU SMART FUND' });
      expect(prabhuSmart.payee_classification).toBe('TAX_EXEMPT');
      expect(prabhuSmart.tds_rate_debenture).toBe(0.0);

      const sunriseBlue = smartClassify({ full_name: 'SUNRISE BLUECHIP FUND' });
      expect(sunriseBlue.payee_classification).toBe('TAX_EXEMPT');

      const laxmiUnnati = smartClassify({ full_name: 'LAXMI UNNATI KOSH' });
      expect(laxmiUnnati.payee_classification).toBe('TAX_EXEMPT');

      const kumariDhan = smartClassify({ full_name: 'KUMARI DHANABRIDDHI YOJANA' });
      expect(kumariDhan.payee_classification).toBe('TAX_EXEMPT');

      const shubhaLaxmi = smartClassify({ full_name: 'Shubha Laxmi Kosh' });
      expect(shubhaLaxmi.payee_classification).toBe('TAX_EXEMPT');
    });

    it('classifies statutory retirement and pension trusts as TAX_EXEMPT with 0% TDS', () => {
      const cit = smartClassify({ full_name: 'NAGARIK LAGANI KOSH' });
      expect(cit.payee_classification).toBe('TAX_EXEMPT');
      expect(cit.tds_rate_dividend).toBe(0.0);
      expect(cit.tds_rate_debenture).toBe(0.0);

      const epf = smartClassify({ full_name: 'KARMACHARI SANCHAYA KOSH' });
      expect(epf.payee_classification).toBe('TAX_EXEMPT');

      const ssf = smartClassify({ full_name: 'SAMAJIK SURAKSHA KOSH' });
      expect(ssf.payee_classification).toBe('TAX_EXEMPT');

      const nblTrust = smartClassify({ full_name: 'NEPAL BANK KARMACHARI AWAKASH KOSH BYAWASTHAPAN TRUST' });
      expect(nblTrust.payee_classification).toBe('TAX_EXEMPT');
    });
  });

  describe('4. Promoter & Local Segments', () => {
    it('classifies individual promoter correctly', () => {
      const prom = smartClassify({
        full_name: 'Hari Prasad Sharma',
        father_name: 'Krishna Prasad Sharma',
        lot_name: 'PROMOTER LOT 1',
      });
      expect(prom.payee_classification).toBe('NATURAL_PERSON');
      expect(prom.payee_category).toBe('PROMOTER');
      expect(prom.payee_segment).toBe('PROMOTER');
      expect(prom.tds_rate_dividend).toBe(0.05);
      expect(prom.tds_rate_debenture).toBe(0.06);
    });

    it('classifies local resident correctly', () => {
      const local = smartClassify({
        full_name: 'Pasang Tamang',
        father_name: 'Dorje Tamang',
        lot_name: 'LOCAL AFFECTED AREA',
      });
      expect(local.payee_classification).toBe('NATURAL_PERSON');
      expect(local.payee_category).toBe('LOCAL');
      expect(local.payee_segment).toBe('LOCAL');
      expect(local.tds_rate_dividend).toBe(0.05);
    });
  });

  describe('5. Database Classification Precedence (Tier 0)', () => {
    it('respects explicit database classification even when full name is present', () => {
      const dbCompany = smartClassify({
        full_name: 'Ram Bahadur Shrestha',
        payee_classification: 'COMPANY_INSTITUTION',
      });
      expect(dbCompany.payee_classification).toBe('COMPANY_INSTITUTION');
      expect(dbCompany.payee_category).toBe('INSTITUTION');
      expect(dbCompany.tds_rate_debenture).toBe(0.15);

      const dbTaxExempt = smartClassify({
        full_name: 'Shrestha Enterprises',
        payee_classification: 'TAX_EXEMPT',
      });
      expect(dbTaxExempt.payee_classification).toBe('TAX_EXEMPT');
      expect(dbTaxExempt.tds_rate_dividend).toBe(0.0);

      const dbPublicLegal = smartClassify({
        full_name: 'Government Entity',
        payee_classification: 'PUBLIC_LEGAL_PERSON',
      });
      expect(dbPublicLegal.payee_classification).toBe('PUBLIC_LEGAL_PERSON');
    });
  });

  describe('6. Edge Cases & Metadata Precedence', () => {
    it('handles PRIVATE PROMOTER without erroneously categorizing as institution', () => {
      const privatePromoter = smartClassify({
        full_name: 'Bishnu Prasad',
        holder_type: 'PRIVATE PROMOTER',
      });
      expect(privatePromoter.payee_classification).toBe('NATURAL_PERSON');
      expect(privatePromoter.payee_category).toBe('PROMOTER');
    });

    it('correctly classifies FOREIGN metadata', () => {
      const foreign = smartClassify({
        full_name: 'John Doe',
        holder_type: 'FOREIGN INVESTOR',
      });
      expect(foreign.payee_classification).toBe('COMPANY_INSTITUTION');
      expect(foreign.payee_category).toBe('FOREIGN');
    });
  });
});

