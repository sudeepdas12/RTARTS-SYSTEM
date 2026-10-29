import { describe, it, expect } from "vitest";
import {
  amountEqualsPaisa,
  extractReconciliationExceptions,
  ReconciliationMatch,
  ReconciliationEngine,
} from "./reconciliation-engine";

describe("ReconciliationEngine Memory & Multi-Company Tests", () => {
  it("compares currency paisa amounts accurately within tolerance", () => {
    expect(amountEqualsPaisa(500.0, 500.0)).toBe(true);
    expect(amountEqualsPaisa(500.004, 500.009)).toBe(true);
    expect(amountEqualsPaisa(500.0, 502.0)).toBe(false);
  });

  it("caps extractReconciliationExceptions memory allocation to 500 items while maintaining accurate total count", () => {
    const fakeMatches: ReconciliationMatch[] = [];
    for (let i = 0; i < 2000; i++) {
      fakeMatches.push({
        id: `match-${i}`,
        boid: `130123000000${i.toString().padStart(4, "0")}`,
        shareholderName: `Shareholder ${i}`,
        category: "PAYOUT_DEBIT",
        kitta: 10,
        excelAmount: 1000 + i,
        systemAmount: 0,
        difference: 1000 + i,
        status: "Missing",
        bankName: "RBB",
        bankAccountNo: `001${i}`,
        lotName: "Test Lot",
        sourceType: "bank_statement",
      });
    }

    const summary = extractReconciliationExceptions(fakeMatches, 1.0, 500);

    // Total count must be 2000
    expect(summary.totalExceptions).toBe(2000);
    expect(summary.unmatchedBankTxnCount).toBe(2000);
    // But exception items in memory must be capped to 500
    expect(summary.exceptions.length).toBe(500);
  });

  it("accepts companyIds array for multi-company filtering", async () => {
    const mockDb: any = {
      from: (table: string) => {
        const query: any = {
          select: () => query,
          in: (col: string, vals: any[]) => {
            expect(col).toBe("company_id");
            expect(vals).toEqual(["comp-1", "comp-2"]);
            return query;
          },
          order: () => query,
          range: () => query,
          or: (condition: string) => {
            expect(condition).toContain("comp-1");
            expect(condition).toContain("comp-2");
            return query;
          },
          then: (resolve: any) => resolve({ data: [], count: 0 }),
        };
        return query;
      },
    };

    const res = await ReconciliationEngine.analyzeBankStatement(
      [
        {
          id: "txn-1",
          date: "2026-02-01",
          description: "Payout",
          debit: 500,
          credit: 0,
          balance: 10000,
          accountNo: "123456789",
        },
      ],
      {
        companyIds: ["comp-1", "comp-2"],
        client: mockDb,
      },
    );

    expect(res).toBeDefined();
    expect(res.matches.length).toBe(1);
    expect(res.matches[0].status).toBe("Missing");
  });
});
