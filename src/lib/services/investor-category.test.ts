import { describe, it, expect } from 'vitest';
import {
  mapToHolderType,
  getInvestorDemographicGroup,
  demographicGroupLabel,
} from './investor-category';

describe('mapToHolderType (raw detected category -> granular DB value)', () => {
  it('maps natural person categories to granular natural-person values', () => {
    expect(mapToHolderType('PUBLIC')).toBe('Natural Person - Public');
    expect(mapToHolderType('LOCAL')).toBe('Natural Person - Local');
    expect(mapToHolderType('EMPLOYEE')).toBe('Natural Person - Employee');
    expect(mapToHolderType('STAFF')).toBe('Natural Person - Employee');
    expect(mapToHolderType('PROMOTER')).toBe('Natural Person - Promoter');
  });

  it('maps legal persons / companies to Legal Person', () => {
    expect(mapToHolderType('INSTITUTION')).toBe('Legal Person');
  });

  it('keeps mutual funds, tax-exempt and foreign investors distinct', () => {
    expect(mapToHolderType('MUTUAL_FUND')).toBe('Mutual Fund');
    expect(mapToHolderType('TAX_EXEMPT')).toBe('Tax Exempt');
    expect(mapToHolderType('FOREIGN')).toBe('Foreign');
  });

  it('does NOT squash mutual funds / foreign investors into the old Institution bucket', () => {
    expect(mapToHolderType('MUTUAL_FUND')).not.toBe('Institution');
    expect(mapToHolderType('FOREIGN')).not.toBe('Institution');
    expect(mapToHolderType('INSTITUTION')).not.toBe('Institution');
  });

  it('leaves unrecognised or empty categories for review', () => {
    expect(mapToHolderType('SOMETHING_ELSE')).toBeNull();
    expect(mapToHolderType('')).toBeNull();
  });
});

describe('getInvestorDemographicGroup (stored holder_type -> report bucket)', () => {
  it('groups granular natural-person values', () => {
    expect(getInvestorDemographicGroup('Natural Person - Public')).toBe('Natural Person');
    expect(getInvestorDemographicGroup('Natural Person - Promoter')).toBe('Natural Person');
    expect(getInvestorDemographicGroup('Natural Person - Local')).toBe('Natural Person');
    expect(getInvestorDemographicGroup('Natural Person - Employee')).toBe('Natural Person');
    expect(getInvestorDemographicGroup('Natural Person - Minor')).toBe('Natural Person');
    expect(getInvestorDemographicGroup('Natural Person - Joint Holder')).toBe('Natural Person');
    expect(getInvestorDemographicGroup('Legal Person - Promoter')).toBe('Legal Person');
  });

  it('maps legacy values to their best bucket', () => {
    expect(getInvestorDemographicGroup('Public')).toBe('Natural Person');
    expect(getInvestorDemographicGroup('Promoter')).toBe('Natural Person');
    expect(getInvestorDemographicGroup('Local')).toBe('Natural Person');
    expect(getInvestorDemographicGroup('Employee')).toBe('Natural Person');
    expect(getInvestorDemographicGroup('Institution')).toBe('Legal Person');
  });

  it('keeps the granular buckets distinct', () => {
    expect(getInvestorDemographicGroup('Legal Person')).toBe('Legal Person');
    expect(getInvestorDemographicGroup('Mutual Fund')).toBe('Mutual Fund');
    expect(getInvestorDemographicGroup('Tax Exempt')).toBe('Tax Exempt');
    expect(getInvestorDemographicGroup('Foreign')).toBe('Foreign');
  });

  it('handles null / undefined / unknown', () => {
    expect(getInvestorDemographicGroup(null)).toBe('Unknown');
    expect(getInvestorDemographicGroup(undefined)).toBe('Unknown');
    expect(getInvestorDemographicGroup('Completely Unknown')).toBe('Unknown');
  });
});

describe('demographicGroupLabel', () => {
  it('returns human-friendly labels', () => {
    expect(demographicGroupLabel('Natural Person')).toBe('Natural Person');
    expect(demographicGroupLabel('Legal Person')).toBe('Legal Person / Company');
    expect(demographicGroupLabel('Mutual Fund')).toBe('Mutual Fund');
  });
});
