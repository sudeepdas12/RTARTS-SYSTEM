import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { BankParser } from "./bank-parser";
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

  it("matches Excel bank statement rows embedding 16-digit CDS BOIDs or full names without misclassifying BOIDs as account numbers", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        {
          Date: "2026-11-27",
          Description: "DIV PAYOUT - Ram Prasad Sharma (1301020000000001)",
          "Reference / Txn ID": "CIPS-QA-0001",
          Debit: 4750,
          Credit: 0,
          Balance: 995250,
        },
        {
          Date: "2026-11-27",
          Description: "DIV PAYOUT - HIMALAYAN INVESTMENTS PVT LTD",
          "Reference / Txn ID": "CIPS-QA-0002",
          Debit: 21250,
          Credit: 0,
          Balance: 974000,
        },
        {
          Date: "2026-11-27",
          Description: "BANK CLEARING SETTLEMENT FEE",
          "Reference / Txn ID": "FEE-QA-001",
          Debit: 150,
          Credit: 0,
          Balance: 973850,
        },
      ]),
      "Bank_Statement",
    );
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const file = new File([buf], "qa_recon_bank.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const parsed = await BankParser.parseBankStatementWithMetadata(file);
    expect(parsed.transactions).toHaveLength(3);
    expect(parsed.transactions[0].boid).toBe("1301020000000001");
    expect(parsed.transactions[0].accountNo).toBeUndefined();
    expect(parsed.transactions[0].referenceId).toBe("CIPS-QA-0001");

    const mockDb: any = {
      from: (table: string) => {
        const query: any = {
          select: () => query,
          eq: () => query,
          in: () => query,
          order: () => query,
          range: () => query,
          or: () => query,
          then: (resolve: any) => {
            if (table === "dividend_payables") {
              resolve({
                data: [
                  {
                    id: "pay-ram",
                    company_id: "comp-qa",
                    client_id: "cli-ram",
                    net_payable: 4750,
                    payment_status: "Pending",
                    fiscal_year: "2082/83",
                    bank_account_no: "109000123456",
                    clients: {
                      id: "cli-ram",
                      boid: "1301020000000001",
                      full_name: "Ram Prasad Sharma",
                      bank_account_no: "109000123456",
                    },
                  },
                  {
                    id: "pay-himalayan",
                    company_id: "comp-qa",
                    client_id: "cli-himalayan",
                    net_payable: 21250,
                    payment_status: "Pending",
                    fiscal_year: "2082/83",
                    bank_account_no: "010010002345",
                    clients: {
                      id: "cli-himalayan",
                      boid: "1301020000000002",
                      full_name: "HIMALAYAN INVESTMENTS PVT LTD",
                      bank_account_no: "010010002345",
                    },
                  },
                ],
                count: 2,
              });
            } else {
              resolve({ data: [], count: 0 });
            }
          },
        };
        return query;
      },
    };

    const report = await ReconciliationEngine.analyzeBankStatement(parsed.transactions, {
      companyId: "comp-qa",
      client: mockDb,
      fileName: "qa_recon_bank.xlsx",
    });

    expect(report.matches).toHaveLength(3);
    expect(report.matches[0].status).toBe("Matched");
    expect(report.matches[0].matchMethod).toBe("boid_and_amount");
    expect(report.matches[0].referenceId).toBe("CIPS-QA-0001");
    expect(report.matches[1].status).toBe("Matched");
    expect(report.matches[1].matchMethod).toBe("name_and_amount");
    expect(report.matches[1].referenceId).toBe("CIPS-QA-0002");

    const exceptions = extractReconciliationExceptions(report);
    expect(exceptions.exceptions).toHaveLength(1);
    expect(exceptions.exceptions[0].type).toBe("UNMATCHED_BANK_DEBIT");
    expect(exceptions.exceptions[0].bankReference).toBe("FEE-QA-001");
  });
});
