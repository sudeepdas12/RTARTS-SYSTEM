export interface InterestCalculationParams {
  debentureKitta: number;       // Number of debentures held
  unitFaceValue?: number;       // Default NPR 1000 per debenture
  annualInterestRate: number;   // e.g. 7 for 7%
  fromDate?: Date;
  toDate?: Date;
  daysCount?: number;           // explicit day count
  taxRate?: number;             // e.g. 0.06 for 6% TDS
  taxCategory?: 'PUBLIC' | 'PRIVATE' | 'MUTUAL_FUND' | 'INSTITUTION' | 'TAX_EXEMPTED' | 'PROMOTER' | 'LOCAL' | 'EMPLOYEE' | 'CUSTOM';
}

export interface InterestResult {
  totalPrincipal: number;
  annualInterestAmount: number;
  dailyInterestRate: number;
  daysCount: number;
  grossPeriodInterest: number;
  tdsRate: number;
  taxAmount: number;
  netInterestPayable: number;
}

export const InterestCalculator = {
  calculate(params: InterestCalculationParams): InterestResult {
    const faceValue = Math.max(0, params.unitFaceValue || 1000);
    const debentureKitta = Math.max(0, params.debentureKitta || 0);
    const totalPrincipal = debentureKitta * faceValue;

    // Annual Interest (e.g. 7% of total principal)
    const annualInterestRate = Math.max(0, params.annualInterestRate || 0);
    const annualInterestAmount = (totalPrincipal * annualInterestRate) / 100;

    // Daily Interest (365-day convention)
    const dailyInterestRate = annualInterestAmount / 365;

    // Compute days from dates if not explicitly provided
    let days = Math.max(0, params.daysCount ?? 0);
    if (!days && params.fromDate && params.toDate) {
      const fromTime = params.fromDate.getTime();
      const toTime = params.toDate.getTime();
      if (!isNaN(fromTime) && !isNaN(toTime) && toTime > fromTime) {
        const timeDiff = toTime - fromTime;
        days = Math.max(0, Math.ceil(timeDiff / (1000 * 3600 * 24)));
      }
    }

    // Gross Period Interest
    const grossPeriodInterest = dailyInterestRate * days;

    // TDS rate logic
    let tdsRate = params.taxRate !== undefined ? params.taxRate : 0.06;
    
    if (params.taxCategory === 'TAX_EXEMPTED' || params.taxCategory === 'MUTUAL_FUND') {
      tdsRate = 0.0; // Tax Exempted / Mutual Fund
    } else if (params.taxCategory === 'INSTITUTION') {
      tdsRate = 0.15; // Legal Person / Company
    } else if (
      params.taxCategory === 'PUBLIC' ||
      params.taxCategory === 'PRIVATE' ||
      params.taxCategory === 'PROMOTER' ||
      params.taxCategory === 'LOCAL' ||
      params.taxCategory === 'EMPLOYEE'
    ) {
      tdsRate = 0.06; // Natural Person (6% on debenture coupon)
    } else if (params.taxCategory === 'CUSTOM' && params.taxRate !== undefined) {
      tdsRate = params.taxRate;
    }

    const rawTaxAmount = grossPeriodInterest * tdsRate;
    const rGross = Math.round(grossPeriodInterest * 100) / 100;
    const rTax = Math.round(rawTaxAmount * 100) / 100;
    const netInterestPayable = Math.max(0, Math.round((rGross - rTax) * 100) / 100);

    return {
      totalPrincipal,
      annualInterestAmount: Math.round(annualInterestAmount * 100) / 100,
      dailyInterestRate: Math.round(dailyInterestRate * 1000000) / 1000000,
      daysCount: days,
      grossPeriodInterest: rGross,
      tdsRate,
      taxAmount: rTax,
      netInterestPayable
    };
  }
};
