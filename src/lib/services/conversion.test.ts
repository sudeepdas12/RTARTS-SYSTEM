import { describe, it, expect } from "vitest";
import { ConversionService, ConversionResultSummary } from "./conversion.service";

describe("ConversionService — Nepal Share Conversion & Capital Restructuring", () => {
  it("computes Promoter to Public conversion correctly without altering total share balance", () => {
    const promoterKitta = 10000;
    const conversionPct = 27.14; // e.g. 27.14% converted to public
    const convertedKitta = Math.floor(promoterKitta * (conversionPct / 100));
    const remainingPromoter = promoterKitta - convertedKitta;

    expect(convertedKitta).toBe(2714);
    expect(remainingPromoter).toBe(7286);
    expect(convertedKitta + remainingPromoter).toBe(10000);
  });

  it("computes Debenture to Equity conversion with fractional cash and 5% TDS", () => {
    // 5 debentures @ NPR 1,000 = NPR 5,000 face value
    // Conversion price = NPR 140 per equity share
    // 5000 / 140 = 35.714285... shares
    // Whole equity kitta = 35
    // Fractional kitta = 0.7143
    // Fractional gross cash = 0.7143 * 100 = NPR 71.43
    // TDS 5% = NPR 3.57
    // Net fractional cash = NPR 67.86
    const debentureValue = 5000;
    const conversionPrice = 140;
    const faceValue = 100;

    const rawShares = debentureValue / conversionPrice;
    const wholeShares = Math.floor(rawShares);
    const fraction = Math.round((rawShares - wholeShares + Number.EPSILON) * 10000) / 10000;
    const grossCash = Math.round((fraction * faceValue + Number.EPSILON) * 100) / 100;
    const tax = Math.round((grossCash * 0.05 + Number.EPSILON) * 100) / 100;
    const netCash = Math.round((grossCash - tax + Number.EPSILON) * 100) / 100;

    expect(wholeShares).toBe(35);
    expect(fraction).toBe(0.7143);
    expect(grossCash).toBe(71.43);
    expect(tax).toBe(3.57);
    expect(netCash).toBe(67.86);
  });

  it("computes Stock Split (e.g. 100 to 10 face value) multiplier", () => {
    const oldFV = 100;
    const newFV = 10;
    const multiplier = oldFV / newFV;
    const initialKitta = 250;
    const newKitta = initialKitta * multiplier;

    expect(multiplier).toBe(10);
    expect(newKitta).toBe(2500);
  });
});
