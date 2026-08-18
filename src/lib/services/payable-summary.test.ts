import { describe, expect, it } from 'vitest';
import {
  calculatePayableTotals,
  detectPayeeCategory,
  getPayeeTaxRate,
  validatePayableConsistency,
  aggregatePayableCategorySummary,
} from './payable-summary';

describe('payee classification and payable totals', () => {
  it('detects payee categories consistently from row and sheet metadata', () => {
    expect(detectPayeeCategory({ type: 'INSTITUTION' }, 'DEBENTURE')).toBe('INSTITUTION');
    expect(detectPayeeCategory({ father_name: 'Hari' }, 'DIVIDEND')).toBe('PUBLIC');
    expect(detectPayeeCategory({ investor_type: 'MUTUAL FUND' }, 'DIVIDEND')).toBe('MUTUAL_FUND');
    expect(detectPayeeCategory({ full_name: 'A TO Z BUSINESS SOLUTION PVT.LTD' }, 'DIVIDEND')).toBe('INSTITUTION');
    expect(detectPayeeCategory({ holder_type: 'Legal Person' }, 'DIVIDEND')).toBe('INSTITUTION');
    expect(detectPayeeCategory({ holder_type: 'Mutual Fund' }, 'DIVIDEND')).toBe('MUTUAL_FUND');
    expect(detectPayeeCategory({ holder_type: 'Tax Exempt' }, 'DIVIDEND')).toBe('TAX_EXEMPT');
    expect(detectPayeeCategory({ full_name: 'Ram Shyam' }, 'DIVIDEND')).toBe('UNKNOWN');
  });

  it('calculates category-wise tax and net amounts correctly', () => {
    const result = calculatePayableTotals({
      grossAmount: 1000,
      taxAmount: undefined,
      category: 'PUBLIC',
      isDebenture: true,
    });

    expect(result.grossAmount).toBe(1000);
    expect(result.taxAmount).toBe(60);
    expect(result.netPayable).toBe(940);
  });

  it('keeps tax logic reusable across categories', () => {
    expect(getPayeeTaxRate('PUBLIC', true)).toBeCloseTo(0.06, 6);
    expect(getPayeeTaxRate('INSTITUTION', true)).toBeCloseTo(0.15, 6);
    expect(getPayeeTaxRate('MUTUAL_FUND', true)).toBe(0);
  });

  it('validates that gross minus tax equals net and total sums remain consistent', () => {
    const validation = validatePayableConsistency({ gross_amount: 1000, tax_amount: 60, net_payable: 940 });
    expect(validation.valid).toBe(true);
    expect(validation.difference).toBe(0);

    const summary = aggregatePayableCategorySummary([
      { company_id: 'c1', company_name: 'Company A', payee_category: 'PUBLIC', gross_amount: 1000, tax_amount: 60, net_payable: 940 },
      { company_id: 'c1', company_name: 'Company A', payee_category: 'PUBLIC', gross_amount: 2000, tax_amount: 120, net_payable: 1880 },
      { company_id: 'c1', company_name: 'Company A', payee_category: 'INSTITUTION', gross_amount: 500, tax_amount: 75, net_payable: 425 },
    ]);

    expect(summary[0].transactionCount).toBe(2);
    expect(summary[0].grossPayable).toBe(3000);
    expect(summary[0].tax).toBe(180);
    expect(summary[0].netPayable).toBe(2820);
  });
});
