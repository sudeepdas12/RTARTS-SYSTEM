import { describe, it, expect } from "vitest";
import { generateCompanyCode } from "./company.service";

describe("generateCompanyCode", () => {
  it("generates correct NEPSE code for debentures with interest rate", () => {
    expect(generateCompanyCode("8.5% RBB Debentures 2083.xlsx")).toBe("RBBD8.5");
    expect(generateCompanyCode("8.5% RBB Debentures 2083")).toBe("RBBD8.5");
    expect(generateCompanyCode("RBB Debentures 8.5%")).toBe("RBBD8.5");
    expect(generateCompanyCode("7% RBB Debenture 2088")).toBe("RBBD7");
    expect(generateCompanyCode("10.25% KBL Debenture 2086")).toBe("KBLD10.25");
  });

  it("generates correct code when rate is passed as parameter", () => {
    expect(generateCompanyCode("RBB Debentures", "debenture", 8.5)).toBe("RBBD8.5");
  });

  it("generates correct NEPSE code for standard corporate banks and equities", () => {
    expect(generateCompanyCode("Nabil Bank Limited")).toBe("NABIL");
    expect(generateCompanyCode("NLG Insurance Company Limited")).toBe("NLG");
    expect(generateCompanyCode("Global IME Bank Limited")).toBe("GBIME");
    expect(generateCompanyCode("Nepal Life Insurance Company Limited")).toBe("NLIC");
    expect(generateCompanyCode("Everest Bank Limited")).toBe("EBL");
  });

  it("generates correct code for mutual funds", () => {
    expect(generateCompanyCode("Sanima Equity Fund", "mutual_fund")).toBe("SEF");
    expect(generateCompanyCode("Nabil Balanced Fund 2", "mutual_fund")).toBe("NBF2");
  });

  it("handles fallback and empty names gracefully", () => {
    expect(generateCompanyCode("")).toBe("COMP");
    expect(generateCompanyCode("   ")).toBe("COMP");
  });
});

describe("CompanyService.autoRegisterCompany and findMatchingCompany", () => {
  let createdCompanyId: string | null = null;
  const testName = "8.5% RBB Debentures 2083.xlsx";

  beforeAll(async () => {
    const { supabase } = await import("./database");
    await supabase.auth.signInWithPassword({
      email: "admin@rbbmbl.com.np",
      password: "Admin123!",
    });
  });

  afterEach(async () => {
    const { supabase } = await import("./database");
    if (createdCompanyId) {
      await (supabase as any).from("companies").delete().eq("id", createdCompanyId);
      createdCompanyId = null;
    }
    await (supabase as any)
      .from("companies")
      .delete()
      .ilike("company_name", "%RBB Debentures 2083%");
  });

  it("automatically registers an unregistered company with accurate metadata", async () => {
    const { CompanyService } = await import("./company.service");
    const comp = await CompanyService.autoRegisterCompany({
      name: testName,
      fileType: "debenture",
      rate: 8.5,
      isin: "NPE001TESTISIN",
    });

    expect(comp).toBeDefined();
    expect(comp.id).toBeDefined();
    createdCompanyId = comp.id;

    expect(comp.company_code).toBe("RBBD8.5");
    expect(comp.company_type).toBe("Debenture");
    expect(comp.sector_type).toBe("Institution");
    expect(comp.debenture_rate).toBe(8.5);
    expect(comp.isin).toBe("NPE001TESTISIN");

    // Test second call: should recognize existing company and return the exact same instance
    const comp2 = await CompanyService.autoRegisterCompany({
      name: "8.5% RBB Debentures 2083",
      fileType: "debenture",
    });

    expect(comp2.id).toBe(comp.id);
    expect(comp2.company_code).toBe("RBBD8.5");

    // Test findMatchingCompany
    const matched = await CompanyService.findMatchingCompany("RBB Debentures 8.5%");
    expect(matched).toBeDefined();
    expect(matched?.id).toBe(comp.id);
  });
});
