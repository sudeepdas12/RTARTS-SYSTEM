export interface DividendCalculationParams {
  sharesHeld: number;
  dividendType: 'Cash' | 'Stock' | 'Bonus' | 'Right' | 'Combined';
  cashDividendRate?: number; // e.g. 5.631 for Rs 5.631 per share OR 10 for 10%
  cashRateIsPerShare?: boolean; // true if Rs 5.631 per share, false if percentage of face value
  bonusRatio?: number;       // e.g. 0.07 for 7% bonus
  taxCategory?: 'PUBLIC' | 'INSTITUTION' | 'TAX_EXEMPTED' | 'PROMOTER' | 'CUSTOM';
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
    const faceValue = params.faceValue || 100;
    
    // Determine TDS Rate by Category
    let appliedTdsRate = 0.05; // Default 5% for Natural Person (Public) and Legal Person (Institution)
    if (params.taxCategory === 'TAX_EXEMPTED') appliedTdsRate = 0.0; // 0% for Mutual Fund (Tax Exempted)
    else if (params.taxCategory === 'PROMOTER') appliedTdsRate = 0.05; // Explicitly 5% for Promoter dividend
    else if (params.taxCategory === 'CUSTOM' && params.customTaxRate !== undefined) appliedTdsRate = params.customTaxRate;

    // 1. Bonus / Right Share Calculations
    let exactBonusShares = 0;
    let issuedBonusShares = 0;
    let fractionBonusShares = 0;
    let afterBonusKitta = params.sharesHeld;

    if ((params.dividendType === 'Bonus' || params.dividendType === 'Stock' || params.dividendType === 'Combined' || params.dividendType === 'Right') && params.bonusRatio) {
      exactBonusShares = params.sharesHeld * params.bonusRatio;
      issuedBonusShares = Math.floor(exactBonusShares);
      fractionBonusShares = exactBonusShares - issuedBonusShares;
      // Only whole shares are issued
      afterBonusKitta = params.sharesHeld + issuedBonusShares;
    }

    // 2. Gross Cash Dividend Calculation
    let grossCashDividend = 0;
    if (params.cashDividendRate) {
      // For combined/bonus, cash dividend is often paid on the post-bonus capital, but in some markets it's paid on pre-bonus. 
      // Typically if they provide a rate per share or percentage, it applies to the pre-bonus capital for Cash, and post-bonus for Combined.
      const kittaForCash = (params.dividendType === 'Combined') ? afterBonusKitta : params.sharesHeld;
      
      if (params.cashRateIsPerShare) {
        grossCashDividend = kittaForCash * params.cashDividendRate;
      } else {
        // Percentage of face value (e.g. 10% of Rs 100 face value)
        grossCashDividend = (kittaForCash * faceValue * params.cashDividendRate) / 100;
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
    
    const totalTaxAmount = bonusTaxAmount + cashTaxAmount;
    
    // Net Cash Payable: Cash dividend minus the tax on the cash dividend
    // The bonus tax should be deducted from the net cash payable if it's a combined dividend where the cash component covers the bonus tax.
    // If it's a bonus-only dividend, the cash dividend is 0, so deducting totalTaxAmount from 0 would yield negative (floor to 0).
    const netCashPayable = Math.max(0, grossCashDividend - cashTaxAmount - bonusTaxAmount);

    return {
      exactBonusShares: Math.round(exactBonusShares * 10000) / 10000,
      issuedBonusShares,
      fractionBonusShares: Math.round(fractionBonusShares * 10000) / 10000,
      afterBonusKitta: Math.round(afterBonusKitta * 10000) / 10000,
      grossCashDividend: Math.round(grossCashDividend * 100) / 100,
      bonusTaxAmount: Math.round(bonusTaxAmount * 100) / 100,
      cashTaxAmount: Math.round(cashTaxAmount * 100) / 100,
      totalTaxAmount: Math.round(totalTaxAmount * 100) / 100,
      netCashPayable: Math.round(netCashPayable * 100) / 100,
      appliedTdsRate
    };
  }
};

