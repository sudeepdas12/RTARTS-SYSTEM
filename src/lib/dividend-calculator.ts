export interface DividendCalculationParams {
  sharesHeld: number;
  dividendType: 'Cash' | 'Stock' | 'Bonus' | 'Right' | 'Combined';
  cashDividendRate?: number; // e.g. 5.631 for Rs 5.631 per share OR 10 for 10%
  cashRateIsPerShare?: boolean; // true if Rs 5.631 per share, false if percentage of face value
  bonusRatio?: number;       // e.g. 0.07 for 7% bonus
  taxCategory?: 'PUBLIC' | 'INSTITUTION' | 'TAX_EXEMPTED' | 'MUTUAL_FUND' | 'PROMOTER' | 'LOCAL' | 'EMPLOYEE' | 'CUSTOM';
  customTaxRate?: number;    // e.g. 0.15 for 15%
  faceValue?: number;        // Default 100
}

export interface DividendResult {
  exactBonusShares: number;
  issuedBonusShares: number;
  fractionBonusShares: number;
  afterBonusKitta: number;
  grossCashDividend: number;
  bonusTaxAmount: number;
  cashTaxAmount: number;
  totalTaxAmount: number;
  netCashPayable: number;
  appliedTdsRate: number;
}

export const DividendCalculator = {
  calculate(params: DividendCalculationParams): DividendResult {
    const faceValue = Math.max(0, params.faceValue || 100);
    const sharesHeld = Math.max(0, params.sharesHeld || 0);
    
    // Determine TDS Rate by Category
    let appliedTdsRate = 0.05; // Default 5% for Public, Institution, Promoter, Local, Employee
    if (params.taxCategory === 'TAX_EXEMPTED' || params.taxCategory === 'MUTUAL_FUND') {
      appliedTdsRate = 0.0; // 0% for Mutual Fund (Tax Exempted)
    } else if (params.taxCategory === 'CUSTOM' && params.customTaxRate !== undefined) {
      appliedTdsRate = Math.max(0, params.customTaxRate);
    }

    // 1. Bonus / Right Share Calculations
    let exactBonusShares = 0;
    let issuedBonusShares = 0;
    let fractionBonusShares = 0;
    let afterBonusKitta = sharesHeld;

    const bonusRatio = Math.max(0, params.bonusRatio || 0);
    if ((params.dividendType === 'Bonus' || params.dividendType === 'Stock' || params.dividendType === 'Combined' || params.dividendType === 'Right') && bonusRatio > 0) {
      exactBonusShares = sharesHeld * bonusRatio;
      issuedBonusShares = Math.floor(exactBonusShares);
      fractionBonusShares = exactBonusShares - issuedBonusShares;
      // Only whole shares are issued
      afterBonusKitta = sharesHeld + issuedBonusShares;
    }

    // 2. Gross Cash Dividend Calculation
    let grossCashDividend = 0;
    const cashDividendRate = Math.max(0, params.cashDividendRate || 0);
    if (cashDividendRate > 0) {
      // For combined/bonus, cash dividend is often paid on the post-bonus capital, but in some markets it's paid on pre-bonus. 
      // Typically if they provide a rate per share or percentage, it applies to the pre-bonus capital for Cash, and post-bonus for Combined.
      const kittaForCash = (params.dividendType === 'Combined') ? afterBonusKitta : sharesHeld;
      
      if (params.cashRateIsPerShare) {
        grossCashDividend = kittaForCash * cashDividendRate;
      } else {
        // Percentage of face value (e.g. 10% of Rs 100 face value)
        grossCashDividend = (kittaForCash * faceValue * cashDividendRate) / 100;
      }
    }

    // 3. Tax Calculations (Bonus Tax + Cash Dividend Tax)
    // Bonus Tax: Issued Bonus Shares * Face Value * TDS Rate
    let bonusTaxAmount = 0;
    if (params.dividendType === 'Bonus' || params.dividendType === 'Stock' || params.dividendType === 'Combined') {
        bonusTaxAmount = (issuedBonusShares * faceValue) * appliedTdsRate;
    }
    
    // Cash Dividend Tax: Gross Cash Dividend * TDS Rate
    const cashTaxAmount = grossCashDividend * appliedTdsRate;

    // Round individual financial components to paisa (2 decimal places) before calculating totals and net
    const rGross = Math.round(grossCashDividend * 100) / 100;
    const rCashTax = Math.round(cashTaxAmount * 100) / 100;
    const rBonusTax = Math.round(bonusTaxAmount * 100) / 100;
    const rTotalTax = Math.round((rCashTax + rBonusTax) * 100) / 100;
    
    // Net Cash Payable: Cash dividend minus total tax on cash and bonus
    const netCashPayable = Math.max(0, Math.round((rGross - rTotalTax) * 100) / 100);

    return {
      exactBonusShares: Math.round(exactBonusShares * 10000) / 10000,
      issuedBonusShares,
      fractionBonusShares: Math.round(fractionBonusShares * 10000) / 10000,
      afterBonusKitta: Math.round(afterBonusKitta * 10000) / 10000,
      grossCashDividend: rGross,
      bonusTaxAmount: rBonusTax,
      cashTaxAmount: rCashTax,
      totalTaxAmount: rTotalTax,
      netCashPayable,
      appliedTdsRate
    };
  }
};

