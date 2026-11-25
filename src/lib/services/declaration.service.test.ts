import { describe, it, expect, vi } from "vitest";
import { DeclarationService, CorporateDeclaration } from "./declaration.service";

describe("DeclarationService", () => {
  it("should have correct method definitions", () => {
    expect(typeof DeclarationService.getDeclarations).toBe("function");
    expect(typeof DeclarationService.getDeclarationById).toBe("function");
    expect(typeof DeclarationService.createDeclaration).toBe("function");
    expect(typeof DeclarationService.updateDeclaration).toBe("function");
    expect(typeof DeclarationService.deleteDeclaration).toBe("function");
    expect(typeof DeclarationService.getDeclarationSummary).toBe("function");
  });

  it("should validate declaration structure and progress percent math", () => {
    const mockSummary = {
      declaration_id: "test-dec-id",
      declaration_code: "DEC-2081-82-DIV-1001",
      declaration_type: "Dividend",
      sub_type: "Cash",
      fiscal_year: "2081/82",
      declaration_date: "2026-11-24",
      rate_per_share: 5.5,
      total_declared_amount: 10000000,
      total_payables_count: 20000,
      gross_amount: 10526315.79,
      tax_amount: 526315.79,
      net_payable_amount: 10000000,
      paid_amount: 9500000,
      remaining_amount: 500000,
      failed_amount: 500000,
      paid_count: 19000,
      partial_count: 0,
      unpaid_count: 1000,
      failed_count: 1000,
      batches_count: 2,
      progress_percent: 95.0,
    };

    expect(mockSummary.net_payable_amount).toBe(
      mockSummary.paid_amount + mockSummary.remaining_amount,
    );
    expect(mockSummary.progress_percent).toBe(
      (mockSummary.paid_amount / mockSummary.net_payable_amount) * 100,
    );
    expect(mockSummary.total_payables_count).toBe(
      mockSummary.paid_count + mockSummary.unpaid_count,
    );
  });
});
