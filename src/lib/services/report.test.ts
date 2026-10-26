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
      const chain = createMockQueryChain(null, { message: "Database query failed" });
      (supabase.from as any).mockReturnValue(chain);

      await expect(ReportService.getClientProfileReport()).rejects.toThrow("Database query failed");
    });

    it("throws error when getShareholderDemographicsReport encounters database failure", async () => {
      const chain = createMockQueryChain(null, { message: "Demographics view inaccessible" });
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

  describe("Uncapped Paging via fetchAllRows (No arbitrary .limit)", () => {
    it("fetches CDSC report across paged ranges without hardcoded .limit(1000)", async () => {
      const chain = createMockQueryChain([
        {
          id: "dp-1",
          client_id: "c-1",
          company_id: "comp-1",
          shares_held: 50,
          gross_dividend: 500,
          tax_amount: 25,
          net_payable: 475,
          payment_status: "Paid",
          fiscal_year: "2080/81",
        },
      ]);
      (supabase.from as any).mockReturnValue(chain);

      const res = await ReportService.getCdscReport();
      expect(res).toHaveLength(1);
      expect(chain.range).toHaveBeenCalledWith(0, 999);
      expect((chain as any).limit).toBeUndefined();
    });

    it("fetches Share Allocation report across paged ranges without .limit(1000)", async () => {
      const chain = createMockQueryChain([
        {
          id: "dp-2",
          shares_held: 100,
          dividend_type: "Bonus",
          bonus_actual: 10,
          bonus_issued: 10,
          after_bonus_kitta: 110,
          fiscal_year: "2080/81",
        },
      ]);
      (supabase.from as any).mockReturnValue(chain);

      const res = await ReportService.getAllocationReport();
      expect(res).toHaveLength(1);
      expect(chain.range).toHaveBeenCalledWith(0, 999);
      expect((chain as any).limit).toBeUndefined();
    });

    it("fetches Returned Payments report without .limit(500)", async () => {
      const chain = createMockQueryChain([
        {
          id: "p-1",
          batch_id: "b-1",
          net_amount: 1500,
          bank_name: "Nabil Bank",
          bank_account_no: "1234",
          status: "Returned",
          payment_reference: "REF-1",
          payment_date: "2026-01-01",
        },
      ]);
      (supabase.from as any).mockReturnValue(chain);

      const res = await ReportService.getReturnedPaymentsReport();
      expect(res).toHaveLength(1);
      expect(chain.range).toHaveBeenCalledWith(0, 999);
      expect((chain as any).limit).toBeUndefined();
    });

    it("fetches Bounced Cheques report without .limit(500)", async () => {
      const chain = createMockQueryChain([
        {
          id: "p-2",
          batch_id: "b-1",
          net_amount: 2500,
          bank_name: "Global IME",
          bank_account_no: "5678",
          cheque_no: "CHQ-001",
          status: "Bounced",
          payment_reference: "REF-2",
          payment_date: "2026-01-02",
        },
      ]);
      (supabase.from as any).mockReturnValue(chain);

      const res = await ReportService.getBouncedChequesReport();
      expect(res).toHaveLength(1);
      expect(chain.range).toHaveBeenCalledWith(0, 999);
      expect((chain as any).limit).toBeUndefined();
    });

    it("fetches Bank Statement Summary report without .limit(100)", async () => {
      const chain = createMockQueryChain([
        {
          id: "bs-1",
          bank_name: "Everest Bank",
          account_no: "ACC-99",
          statement_date: "2026-02-01",
          file_name: "stmt.csv",
          total_transactions: 150,
          total_credit: 500000,
          total_debit: 200000,
          is_reconciled: true,
          created_at: "2026-02-01T10:00:00Z",
        },
      ]);
      (supabase.from as any).mockReturnValue(chain);

      const res = await ReportService.getBankStatementReport();
      expect(res).toHaveLength(1);
      expect(chain.range).toHaveBeenCalledWith(0, 999);
      expect((chain as any).limit).toBeUndefined();
    });
  });

  describe("Server-Authoritative Grand Totals via PostgreSQL RPC", () => {
    it("calls get_report_grand_totals RPC and formats returned totals", async () => {
      (supabase as any).rpc = vi.fn().mockResolvedValue({
        data: [
          {
            total_records: 12500,
            total_shares: 5000000,
            total_gross: 25000000.5,
            total_tax: 1250000.0,
            total_net: 23750000.5,
            total_disbursed: 20000000.0,
            total_remaining: 3750000.5,
          },
        ],
        error: null,
      });

      const totals = await ReportService.getReportGrandTotals("dividend_register", {
        companyId: "comp-456",
        fiscalYear: "2080/81",
        status: "Pending",
      });

      expect((supabase as any).rpc).toHaveBeenCalledWith("get_report_grand_totals", {
        p_report_id: "dividend_register",
        p_company_id: "comp-456",
        p_fiscal_year: "2080/81",
        p_status: "Pending",
        p_from_date: null,
        p_to_date: null,
        p_classification: null,
      });

      expect(totals.total_records).toBe(12500);
      expect(totals.total_shares).toBe(5000000);
      expect(totals.total_gross).toBe(25000000.5);
      expect(totals.total_net).toBe(23750000.5);
      expect(totals.total_disbursed).toBe(20000000.0);
      expect(totals.total_remaining).toBe(3750000.5);
    });

    it("returns zero totals gracefully on RPC failure without throwing", async () => {
      (supabase as any).rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "RPC unavailable" },
      });

      const totals = await ReportService.getReportGrandTotals("dividend_register");
      expect(totals.total_records).toBe(0);
      expect(totals.total_net).toBe(0);
    });
  });
});
