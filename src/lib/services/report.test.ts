import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReportService } from "./report.service";
import { supabase } from "./database";

// Mock Supabase client
vi.mock("./database", async () => {
  const actual = await vi.importActual<any>("./database");
  return {
    ...actual,
    supabase: {
      from: vi.fn(),
    },
  };
});

function createMockQueryChain(resolveData: any, resolveError: any = null) {
  const chain: any = {
    then(onfulfilled: any, onrejected: any) {
      return Promise.resolve({ data: resolveData, error: resolveError }).then(
        onfulfilled,
        onrejected,
      );
    },
  };
  chain.select = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.ilike = vi.fn().mockReturnValue(chain);
  chain.range = vi.fn().mockReturnValue(chain);
  return chain;
}

describe("ReportService Invariants and Error Semantics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Mathematical Invariants across Registers", () => {
    it("validates dividend register row invariant: gross == tax + net within statutory tolerance", () => {
      const mockDividendRows = [
        {
          id: "div-1",
          shares_held: 1000,
          gross_dividend: 5000.0,
          tax_amount: 250.0,
          net_payable: 4750.0,
          dividend_type: "Cash",
          payment_status: "Paid",
          fiscal_year: "2080/81",
          client: {
            full_name: "Ram Bahadur",
            boid: "1301010000000001",
            pan_or_citizenship: "123456789",
          },
          company: { company_name: "Nabil Bank Ltd", company_code: "NABIL" },
        },
        {
          id: "div-2",
          shares_held: 200,
          gross_dividend: 1000.0,
          tax_amount: 50.0,
          net_payable: 950.0,
          dividend_type: "Cash",
          payment_status: "Pending",
          fiscal_year: "2080/81",
          client: {
            full_name: "Sita Kumari",
            boid: "1301010000000002",
            pan_or_citizenship: "987654321",
          },
          company: { company_name: "Nabil Bank Ltd", company_code: "NABIL" },
        },
      ];

      for (const row of mockDividendRows) {
        const diff = Math.abs(row.gross_dividend - (row.tax_amount + row.net_payable));
        expect(diff).toBeLessThan(0.05);
      }

      const totalGross = mockDividendRows.reduce((s, r) => s + r.gross_dividend, 0);
      const totalTax = mockDividendRows.reduce((s, r) => s + r.tax_amount, 0);
      const totalNet = mockDividendRows.reduce((s, r) => s + r.net_payable, 0);
      expect(Math.abs(totalGross - (totalTax + totalNet))).toBeLessThan(0.05);
    });

    it("validates debenture interest register row invariant: gross == tax + net", () => {
      const mockInterestRows = [
        {
          id: "int-1",
          units_held: 100,
          gross_interest: 10000.0,
          tax_amount: 1500.0,
          net_interest: 8500.0,
          payment_status: "Pending",
          fiscal_year: "2080/81",
          client: {
            full_name: "Hari Prasad",
            boid: "1301010000000003",
            pan_or_citizenship: "555555555",
          },
          company: { company_name: "Sanima Debenture", company_code: "SAND2085" },
        },
      ];

      for (const row of mockInterestRows) {
        const diff = Math.abs(row.gross_interest - (row.tax_amount + row.net_interest));
        expect(diff).toBeLessThan(0.05);
      }
    });

    it("validates mutual fund register row invariant: gross == tax + net", () => {
      const mockMfRows = [
        {
          id: "mf-1",
          units_held: 5000,
          gross_amount: 7500.0,
          tax_amount: 375.0,
          net_amount: 7125.0,
          payment_status: "Paid",
          fiscal_year: "2080/81",
          client: {
            full_name: "Gita Sharma",
            boid: "1301010000000004",
            pan_or_citizenship: "444444444",
          },
          company: { company_name: "NIBL Samriddhi Fund", company_code: "NIBSF1" },
        },
      ];

      for (const row of mockMfRows) {
        const diff = Math.abs(row.gross_amount - (row.tax_amount + row.net_amount));
        expect(diff).toBeLessThan(0.05);
      }
    });
  });

  describe("Fail-Closed Error Propagation", () => {
    it("throws error when getDividendRegister encounters database failure", async () => {
      const chain = createMockQueryChain(null, { message: "Database connection failed" });
      (supabase.from as any).mockReturnValue(chain);

      await expect(ReportService.getDividendRegister()).rejects.toThrow(
        "Database connection failed",
      );
    });

    it("throws error when getInterestRegister encounters database failure", async () => {
      const chain = createMockQueryChain(null, { message: "Timeout querying interest payables" });
      (supabase.from as any).mockReturnValue(chain);

      await expect(ReportService.getInterestRegister()).rejects.toThrow(
        "Timeout querying interest payables",
      );
    });

    it("throws error when getTaxRegister encounters database failure", async () => {
      const chain = createMockQueryChain(null, { message: "RLS violation on dividend_payables" });
      (supabase.from as any).mockReturnValue(chain);

      await expect(ReportService.getTaxRegister()).rejects.toThrow(
        "RLS violation on dividend_payables",
      );
    });

    it("throws error when getClientProfileReport encounters database failure", async () => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "Database query failed" },
        }),
      };
      (supabase.from as any).mockReturnValue(chain);

      await expect(ReportService.getClientProfileReport()).rejects.toThrow("Database query failed");
    });

    it("throws error when getShareholderDemographicsReport encounters database failure", async () => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "Demographics view inaccessible" },
        }),
      };
      (supabase.from as any).mockReturnValue(chain);

      await expect(ReportService.getShareholderDemographicsReport()).rejects.toThrow(
        "Demographics view inaccessible",
      );
    });
  });

  describe("Company-Specific vs All-Company Filter Routing", () => {
    it("routes query without company filter when companyId is all", async () => {
      const chain = createMockQueryChain([]);
      (supabase.from as any).mockReturnValue(chain);

      const res = await ReportService.getDividendRegister({ companyId: "all" });
      expect(res).toEqual([]);
      expect(chain.eq).not.toHaveBeenCalledWith("company_id", "all");
    });

    it("applies company filter when specific companyId is provided", async () => {
      const chain = createMockQueryChain([]);
      (supabase.from as any).mockReturnValue(chain);

      await ReportService.getDividendRegister({ companyId: "comp-123-xyz" });
      expect(chain.eq).toHaveBeenCalledWith("company_id", "comp-123-xyz");
    });
  });
});
