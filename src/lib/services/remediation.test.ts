import { describe, it, expect } from "vitest";

describe("Account Remediation & Merger Mapping Suite", () => {
  const MERGER_RULES = [
    { pattern: /century/i, newBank: "Prabhu Bank Limited" },
    { pattern: /mega\s*bank/i, newBank: "Nepal Investment Mega Bank Ltd." },
    { pattern: /bank\s*of\s*kathmandu|bok/i, newBank: "Global IME Bank Limited" },
    { pattern: /nepal\s*bangladesh|nb\s*bank/i, newBank: "Nabil Bank Limited" },
    { pattern: /civil\s*bank/i, newBank: "Himalayan Bank Limited" },
    { pattern: /sunrise\s*bank/i, newBank: "Laxmi Sunrise Bank Limited" },
    { pattern: /ncc\s*bank|nepal\s*credit/i, newBank: "Kumari Bank Limited" },
    { pattern: /janata\s*bank/i, newBank: "Global IME Bank Limited" },
  ];

  it("correctly identifies Century Commercial Bank and maps to Prabhu Bank", () => {
    const rawBank = "Century Commercial Bank Limited.-Narayangarh Branch";
    const rule = MERGER_RULES.find((r) => r.pattern.test(rawBank));
    expect(rule).toBeDefined();
    expect(rule?.newBank).toBe("Prabhu Bank Limited");
  });

  it("correctly maps Mega Bank Nepal to Nepal Investment Mega Bank", () => {
    const rawBank = "Mega Bank Nepal Ltd - Birgunj";
    const rule = MERGER_RULES.find((r) => r.pattern.test(rawBank));
    expect(rule).toBeDefined();
    expect(rule?.newBank).toBe("Nepal Investment Mega Bank Ltd.");
  });

  it("correctly maps Bank of Kathmandu to Global IME Bank", () => {
    const rawBank = "Bank of Kathmandu Limited (BOK)";
    const rule = MERGER_RULES.find((r) => r.pattern.test(rawBank));
    expect(rule).toBeDefined();
    expect(rule?.newBank).toBe("Global IME Bank Limited");
  });

  it("leaves standard unmerged banks untouched", () => {
    const standardBank = "Nabil Bank Limited - Teendhara Branch";
    const rule = MERGER_RULES.find((r) => r.pattern.test(standardBank));
    expect(rule).toBeUndefined();
  });
});
