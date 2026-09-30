import { describe, it, expect } from "vitest";
import { validateNepaliBankAccount } from "./nepal-banks";

describe("Nepali Bank Account Validator", () => {
  it("validates Rastriya Banijya Bank (RBB) 16-digit accounts", () => {
    const valid = validateNepaliBankAccount("Rastriya Banijya Bank", "1234567890123456");
    expect(valid.isValid).toBe(true);
    expect(valid.matchedBank?.code).toBe("RBB");

    const invalidLength = validateNepaliBankAccount("RBB", "1234567890");
    expect(invalidLength.isValid).toBe(false);
    expect(invalidLength.warning).toContain("16 digits");
  });

  it("validates Nabil Bank 14-digit accounts", () => {
    const valid = validateNepaliBankAccount("Nabil Bank Limited", "12345678901234");
    expect(valid.isValid).toBe(true);
    expect(valid.matchedBank?.code).toBe("NABIL");

    const nonNumeric = validateNepaliBankAccount("NABIL", "1234567890123A");
    expect(nonNumeric.isValid).toBe(false);
    expect(nonNumeric.warning).toContain("must contain only digits");
  });

  it("detects placeholder or dummy accounts", () => {
    const zeroes = validateNepaliBankAccount("Global IME", "00000000000000");
    expect(zeroes.isValid).toBe(false);

    const testStr = validateNepaliBankAccount("Any Bank", "test");
    expect(testStr.isValid).toBe(false);
  });

  it("gracefully validates unknown/general banks within reasonable length bounds", () => {
    const res = validateNepaliBankAccount("Muktinath Bikas Bank", "12345678901234");
    expect(res.isValid).toBe(true);
  });
});
