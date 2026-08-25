import { describe, it, expect } from 'vitest';
import { ReportService } from './report.service';

describe('ReportService Export and Filtering', () => {
  it('defines ReportService with register export methods', () => {
    expect(typeof ReportService.getDividendRegister).toBe('function');
    expect(typeof ReportService.getInterestRegister).toBe('function');
    expect(typeof ReportService.getMutualFundRegister).toBe('function');
    expect(typeof ReportService.getTaxRegister).toBe('function');
  });
});
