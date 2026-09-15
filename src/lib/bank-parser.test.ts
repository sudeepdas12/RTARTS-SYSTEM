import { describe, it, expect } from "vitest";
import { BankParser } from "./bank-parser";

// Helper to create a browser-compatible File mock
function createMockFile(content: string, name: string): File {
  return new File([content], name, { type: "text/plain" });
}

describe("BankParser Comprehensive Unit Tests", () => {
  it("parses standard CSV bank statement correctly", async () => {
    const csvContent = [
      "Date,Description,Debit,Credit,Balance,Account No,Beneficiary Name,Status",
      "2026-01-15,Dividend Payout Batch 1,50000.00,0.00,1000000.00,00100100234,Ram Bahadur Shrestha,Success",
      "2026-01-16,Dividend Payout Batch 1,25000.00,0.00,975000.00,00100100567,Sita Kumari KC,Success",
    ].join("\n");

    const file = createMockFile(csvContent, "statement.csv");
    const txs = await BankParser.parseBankStatement(file);

    expect(txs).toHaveLength(2);
    expect(txs[0].date).toBe("2026-01-15");
    expect(txs[0].debit).toBe(50000);
    expect(txs[0].credit).toBe(0);
    expect(txs[0].balance).toBe(1000000);
    expect(txs[0].accountNo).toBe("00100100234");
    expect(txs[0].beneficiaryName).toBe("Ram Bahadur Shrestha");
    expect(txs[0].category).toBe("PAYOUT_DEBIT");

    expect(txs[1].debit).toBe(25000);
    expect(txs[1].beneficiaryName).toBe("Sita Kumari KC");
  });

  it("handles Nepal-specific currency strings and parentheses for negative values", async () => {
    const csvContent = [
      "Date,Particulars,Withdrawal,Deposit,Balance",
      '2026-02-01,Fund Inward,0,"NPRs 500,000.00",500000',
      '2026-02-02,Return of Unpaid Dividend,0,"12,345.50",512345.50',
    ].join("\n");

    const file = createMockFile(csvContent, "rbb_statement.csv");
    const txs = await BankParser.parseBankStatement(file);

    expect(txs).toHaveLength(2);
    expect(txs[0].credit).toBe(500000);
    expect(txs[1].credit).toBe(12345.5);
  });

  it("correctly identifies REJECT_RETURN transactions", async () => {
    const csvContent = [
      "Date,Description,Debit,Credit,Balance",
      "2026-03-01,ACH RET INCORRECT A/C NUMBER,0,1500.00,101500.00",
      "2026-03-02,ACH REJECT BOID MISMATCH,0,2500.00,104000.00",
    ].join("\n");

    const file = createMockFile(csvContent, "rejects.csv");
    const txs = await BankParser.parseBankStatement(file);

    expect(txs).toHaveLength(2);
    expect(txs[0].category).toBe("REJECT_RETURN");
    expect(txs[0].status).toBe("Rejected");
    expect(txs[1].category).toBe("REJECT_RETURN");
  });

  it("filters out NRB circular sweep entries when includeCircularSweeps is false", async () => {
    const csvContent = [
      "Date,Description,Debit,Credit,Balance",
      "2026-03-05,NRB CIRCULAR SWEEP TO POOL,100000,0,0",
      "2026-03-05,NORMAL DIVIDEND PAYOUT,5000,0,95000",
    ].join("\n");

    const file = createMockFile(csvContent, "circular.csv");
    const txsFiltered = await BankParser.parseBankStatement(file, { includeCircularSweeps: false });
    expect(txsFiltered).toHaveLength(1);
    expect(txsFiltered[0].description).toBe("NORMAL DIVIDEND PAYOUT");

    const txsIncluded = await BankParser.parseBankStatement(file, { includeCircularSweeps: true });
    expect(txsIncluded).toHaveLength(2);
    expect(txsIncluded[0].category).toBe("NRB_CIRCULAR");
  });

  it("skips summary and header rows gracefully", async () => {
    const csvContent = [
      "Transaction Date,Narration,Withdraw,Deposit,Balance",
      "2026-04-01,OPENING BALANCE,0,0,100000",
      "2026-04-02,Valid Payout,4500,0,95500",
      "2026-04-03,CLOSING BALANCE,0,0,95500",
      "TOTAL,,,4500,",
    ].join("\n");

    const file = createMockFile(csvContent, "with_totals.csv");
    const txs = await BankParser.parseBankStatement(file);

    expect(txs).toHaveLength(1);
    expect(txs[0].description).toBe("Valid Payout");
    expect(txs[0].debit).toBe(4500);
  });

  it("handles dates in DD/MM/YYYY format and converts to ISO standard", async () => {
    const csvContent = [
      "Date,Description,Debit,Credit,Balance",
      "15/04/2026,Coupon Payout,1000,0,99000",
    ].join("\n");

    const file = createMockFile(csvContent, "dates.csv");
    const txs = await BankParser.parseBankStatement(file);

    expect(txs).toHaveLength(1);
    expect(txs[0].date).toBe("2026-04-15");
  });
});
