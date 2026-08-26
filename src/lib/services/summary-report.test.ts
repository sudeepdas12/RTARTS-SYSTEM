import { describe, it, expect } from 'vitest';
import { mfSummaryType } from './summary-report.service';

describe('mfSummaryType', () => {
  it('classifies an institution regardless of shareholder segment', () => {
    // Regression: a COMPANY_INSTITUTION whose segment is PUBLIC used to be
    // silently relabelled "PUBLIC" because segment was checked before classification.
    expect(
      mfSummaryType({ payee_classification: 'COMPANY_INSTITUTION', payee_segment: 'PUBLIC' }),
    ).toBe('INSTITUTION');
    expect(
      mfSummaryType({ payee_classification: 'COMPANY_INSTITUTION', payee_segment: null }),
    ).toBe('INSTITUTION');
  });

  it('classifies a tax-exempt payee regardless of shareholder segment', () => {
    expect(
      mfSummaryType({ payee_classification: 'TAX_EXEMPT', payee_segment: 'PUBLIC' }),
    ).toBe('MUTUAL FUND (TAX EXEMPT)');
  });

  it('classifies natural-person holders by segment', () => {
    expect(
      mfSummaryType({ payee_classification: 'NATURAL_PERSON', payee_segment: 'PUBLIC' }),
    ).toBe('PUBLIC');
    expect(
      mfSummaryType({ payee_classification: 'NATURAL_PERSON', payee_segment: 'PROMOTER' }),
    ).toBe('PROMOTER');
    expect(
      mfSummaryType({ payee_classification: 'NATURAL_PERSON', payee_segment: 'LOCAL' }),
    ).toBe('LOCAL AFFECTED');
    expect(
      mfSummaryType({ payee_classification: 'PUBLIC_LEGAL_PERSON', payee_segment: 'LOCAL' }),
    ).toBe('LOCAL AFFECTED');
    expect(
      mfSummaryType({ payee_classification: 'NATURAL_PERSON', payee_segment: 'EMPLOYEE' }),
    ).toBe('EMPLOYEE / STAFF');
  });

  it('falls back to OTHERS for unclassified payees', () => {
    expect(mfSummaryType({ payee_classification: 'UNCLASSIFIED', payee_segment: 'PUBLIC' })).toBe('OTHERS');
    expect(mfSummaryType({ payee_classification: null, payee_segment: null })).toBe('OTHERS');
  });
});
