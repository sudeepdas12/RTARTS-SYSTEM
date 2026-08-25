import { describe, it, expect } from 'vitest';
import { calculatePeriodInterest, calculateDaysBetween, STANDARD_PERIODS } from './period-calculator';

describe('Period Calculator', () => {
  it('calculates full annual (12M) interest correctly', () => {
    // 50,000 units @ Rs 1000 = Rs 5,00,00,000 principal @ 8.5% = Rs 42,50,000 annual
    const res = calculatePeriodInterest({
      kitta: 50000,
      faceValue: 1000,
      couponRatePercent: 8.5,
      periodDays: 365,
      tdsRatePercent: 15,
    });

    expect(res.principalAmount).toBe(50000000);
    expect(res.annualInterest).toBe(4250000);
    expect(res.grossPeriodInterest).toBe(4250000);
    expect(res.taxAmount).toBe(637500); // 15% TDS
    expect(res.netPayable).toBe(3612500);
  });

  it('calculates 6 months (183 days) Asar End semi-annual payout correctly matching Excel', () => {
    // 72,275 kitta @ Rs 1000 = 7,22,75,000 @ 8.5%
    const res = calculatePeriodInterest({
      principalAmount: 72275000,
      couponRatePercent: 8.5,
      periodDays: 183,
      tdsRatePercent: 6,
    });

    expect(res.annualInterest).toBe(6143375);
    expect(res.grossPeriodInterest).toBe(3080103.08);
    expect(res.taxAmount).toBe(184806.18);
    expect(res.netPayable).toBe(2895296.90);
  });

  it('calculates 3 months (quarterly / 91 days) interest correctly', () => {
    const res = calculatePeriodInterest({
      principalAmount: 1000000,
      couponRatePercent: 10,
      periodDays: 91,
      tdsRatePercent: 6,
    });

    expect(res.annualInterest).toBe(100000);
    expect(res.grossPeriodInterest).toBe(24931.51); // (100000/365)*91
    expect(res.taxAmount).toBe(1495.89);
    expect(res.netPayable).toBe(23435.62);
  });

  it('calculates days between dates correctly', () => {
    // 2026-01-01 to 2026-01-31 = 31 days inclusive
    expect(calculateDaysBetween('2026-01-01', '2026-01-31')).toBe(31);
    expect(calculateDaysBetween('2026-01-15', '2026-07-16')).toBe(183);
  });
});
