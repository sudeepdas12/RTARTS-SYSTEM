import { describe, it, expect } from 'vitest';
import {
  IafGeneratorService,
  formatIafQuantity,
  formatIafHeader,
  formatIafDetailLine,
  normalizeDateToDDMMYYYY,
  IafRecord,
} from './iaf-generator.service';

describe('IafGeneratorService — CDSC Allotment Engine', () => {
  describe('formatIafQuantity', () => {
    it('formats quantity to exact 16-character fixed-width string (12.3)', () => {
      const res = formatIafQuantity(100);
      expect(res).toBe('000000000100.000');
      expect(res.length).toBe(16);
    });

    it('formats decimal fractions with 3 decimals zero-padded', () => {
      const res = formatIafQuantity(492610.5);
      expect(res).toBe('000000492610.500');
      expect(res.length).toBe(16);
    });

    it('handles zero quantity', () => {
      const res = formatIafQuantity(0);
      expect(res).toBe('000000000000.000');
      expect(res.length).toBe(16);
    });
  });

  describe('normalizeDateToDDMMYYYY', () => {
    it('normalizes YYYY-MM-DD to DDMMYYYY', () => {
      expect(normalizeDateToDDMMYYYY('2029-04-19')).toBe('19042029');
    });

    it('handles clean DDMMYYYY string directly', () => {
      expect(normalizeDateToDDMMYYYY('19042029')).toBe('19042029');
    });

    it('handles null or empty date with 00000000', () => {
      expect(normalizeDateToDDMMYYYY(null)).toBe('00000000');
      expect(normalizeDateToDDMMYYYY('')).toBe('00000000');
    });
  });

  describe('formatIafHeader', () => {
    it('creates exact 42-character CDSC Control Record', () => {
      const header = formatIafHeader(1695, 492610, 492610);
      expect(header.length).toBe(42);
      expect(header).toBe('0000001695000000492610.000000000492610.000');
    });

    it('creates header for free shares with zero lock-in', () => {
      const header = formatIafHeader(43827, 106250000, 0);
      expect(header.length).toBe(42);
      expect(header).toBe('0000043827000106250000.000000000000000.000');
    });
  });

  describe('formatIafDetailLine', () => {
    it('creates exact 124-character CDSC Detail Record for Local Affected', () => {
      const rec: IafRecord = {
        boid: '1301060001177626',
        currentKitta: 100,
        lockInKitta: 100,
        lockInReasonCode: '09',
        lockInReason: 'Local Affected',
        lockInExpiryDate: '19042029',
        rtaIntRefNo: 'KHPL IPO 2082',
      };

      const line = formatIafDetailLine(rec);
      expect(line.length).toBe(124);
      expect(line.slice(0, 16)).toBe('1301060001177626');
      expect(line.slice(16, 32)).toBe('000000000100.000');
      expect(line.slice(32, 48)).toBe('000000000100.000');
      expect(line.slice(48, 50)).toBe('09');
      expect(line.slice(50, 100)).toBe('Local Affected                                    ');
      expect(line.slice(100, 108)).toBe('19042029');
      expect(line.slice(108, 124)).toBe('KHPL IPO 2082   ');
    });

    it('creates exact 124-character CDSC Detail Record for Free Public Shares', () => {
      const rec: IafRecord = {
        boid: '1301150000048068',
        currentKitta: 100,
        lockInKitta: 0,
        lockInReasonCode: '00',
        lockInReason: '',
        lockInExpiryDate: '00000000',
        rtaIntRefNo: 'RBBF4008283',
      };

      const line = formatIafDetailLine(rec);
      expect(line.length).toBe(124);
      expect(line.slice(0, 16)).toBe('1301150000048068');
      expect(line.slice(16, 32)).toBe('000000000100.000');
      expect(line.slice(32, 48)).toBe('000000000000.000');
      expect(line.slice(48, 50)).toBe('00');
      expect(line.slice(50, 100)).toBe('                                                  ');
      expect(line.slice(100, 108)).toBe('00000000');
      expect(line.slice(108, 124)).toBe('RBBF4008283     ');
    });
  });

  describe('generateIvfContent', () => {
    it('generates 10-char header and 16-char BOID detail lines', () => {
      const records = [
        { boid: '1301010000000402' },
        { boid: '1301010000003251' },
        { boid: '1301010000006495' },
      ];

      const ivf = IafGeneratorService.generateIvfContent(records);
      const lines = ivf.trim().split('\r\n');
      expect(lines[0]).toBe('0000000003');
      expect(lines[1]).toBe('1301010000000402');
      expect(lines[2]).toBe('1301010000003251');
      expect(lines[3]).toBe('1301010000006495');
    });
  });

  describe('generateAllotmentSummary', () => {
    it('computes correct totals and categories', () => {
      const records: IafRecord[] = [
        { boid: '1301060001177626', currentKitta: 500, lockInKitta: 500, lockInReasonCode: '09', lockInReason: 'Local', lockInExpiryDate: '19042029', rtaIntRefNo: 'TEST', category: 'LOCAL' },
        { boid: '1301060001177627', currentKitta: 300, lockInKitta: 0, lockInReasonCode: '00', lockInReason: '', lockInExpiryDate: '00000000', rtaIntRefNo: 'TEST', category: 'PUBLIC' },
      ];

      const summary = IafGeneratorService.generateAllotmentSummary(records);
      expect(summary.totalRecords).toBe(2);
      expect(summary.totalAllottedKitta).toBe(800);
      expect(summary.totalLockInKitta).toBe(500);
      expect(summary.totalFreeKitta).toBe(300);
      expect(summary.categoryBreakdown['LOCAL'].count).toBe(1);
      expect(summary.categoryBreakdown['PUBLIC'].count).toBe(1);
    });
  });
});
