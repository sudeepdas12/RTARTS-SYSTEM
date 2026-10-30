import { describe, it, expect } from "vitest";
import { ReconciliationEngine, extractReconciliationExceptions } from "../reconciliation-engine";
import {
  SANITIZED_MF_PAYABLES,
  SANITIZED_BANK_TRANSACTIONS,
  SAMPLE_BENCHMARKS,
  MUTUAL_FUND_COMPANY_ID,
  SanitizedPayableRow,
} from "./__fixtures__/mutual-fund-sample-fixture";
import type { BankTransaction } from "../bank-parser";

function createMockDb(mfPayables: SanitizedPayableRow[] = SANITIZED_MF_PAYABLES) {
  const formattedPayables = mfPayables.map((p) => ({
    id: p.id,
    company_id: p.company_id,
    client_id: p.client_id,
    net_payable: p.net_payable,
    payment_status: p.payment_status,
    fiscal_year: p.fiscal_year,
    bank_name: p.bank_name,
    bank_account_no: p.bank_account,
    paid_amount: 0,
    remaining_amount: p.net_payable,
    clients: {
      id: p.client_id,
      boid: p.boid,
      full_name: p.holder_name,
      bank_name: p.bank_name,
      bank_account_no: p.bank_account,
    },
  }));

  return {
    from: (table: string) => {
      const query: any = {
        select: () => query,
        eq: () => query,
        in: () => query,
        or: () => query,
        order: () => query,
        range: () => query,
        then: (resolve: (val: any) => void) => {
          if (table === "mutual_fund_payables") {
            return Promise.resolve({ data: formattedPayables, error: null }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return query;
    },
  };
}

describe("Mutual Fund Sample Reconciliation End-to-End Suite", () => {
  it("verifies Mutual Fund 0% TDS rule: net_payable strictly equals gross_dividend", () => {
    for (const payable of SANITIZED_MF_PAYABLES) {
      expect(payable.tax_amount).toBe(0);
      expect(payable.net_payable).toBe(payable.gross_dividend);
      expect(payable.payee_classification).toBe("MUTUAL_FUND");
    }

    const totalGross = SANITIZED_MF_PAYABLES.reduce((s, p) => s + p.gross_dividend, 0);
    const totalNet = SANITIZED_MF_PAYABLES.reduce((s, p) => s + p.net_payable, 0);
    const totalTax = SANITIZED_MF_PAYABLES.reduce((s, p) => s + p.tax_amount, 0);

    expect(totalTax).toBe(0);
    expect(totalGross).toBe(totalNet);
  });

  it("verifies sample benchmark specifications for real mutual fund reports", () => {
    // 1. MER 4.xls expectations
    expect(SAMPLE_BENCHMARKS.mer4.acceptedCount).toBe(56);
    expect(SAMPLE_BENCHMARKS.mer4.rejectedCount).toBe(2);
    expect(SAMPLE_BENCHMARKS.mer4.totalAcceptedAmt).toBe(14756304.11);
    expect(SAMPLE_BENCHMARKS.mer4.totalRejectedAmt).toBe(48409.62);

    // 2. ERROR REPORT expectations
    expect(SAMPLE_BENCHMARKS.errorReport.rowCount).toBe(24);
    expect(SAMPLE_BENCHMARKS.errorReport.totalAmt).toBe(1593.53);

    // 3. Late Return settlement total
    expect(SAMPLE_BENCHMARKS.lateReturn.totalAmt).toBe(9850.0);

    // 4. NRB Circular sweep invariants
    expect(SAMPLE_BENCHMARKS.nrbCircular.sweepAmount).toBe(1216412.39);
    expect(
      SAMPLE_BENCHMARKS.nrbCircular.openingBalance + SAMPLE_BENCHMARKS.nrbCircular.sweepAmount,
    ).toBeCloseTo(SAMPLE_BENCHMARKS.nrbCircular.closingBalance, 2);
  });

  it("excludes non-payout operations (NRB_CIRCULAR, BANK_CHARGES, FUNDING_DEPOSIT) from payable matching", async () => {
    const rawBankTxs = SANITIZED_BANK_TRANSACTIONS.map((tx) => ({
      id: tx.id,
      date: tx.date,
      description: tx.description,
      debit: tx.debit,
      credit: tx.credit,
      balance: tx.balance,
      accountNo: tx.accountNo,
      beneficiaryName: tx.beneficiaryName,
      instructionId: tx.instructionId,
      status: tx.status,
      category: tx.category,
      fileName: tx.fileName,
    })) as unknown as BankTransaction[];

    const mockDb = createMockDb();

    // Perform reconciliation analysis
    const report = await ReconciliationEngine.analyzeBankStatement(rawBankTxs, {
      companyId: MUTUAL_FUND_COMPANY_ID,
      client: mockDb,
    });
    const results = report.matches;

    // 1. Excluded transactions must NOT match any payable
    const excludedResults = results.filter((r) =>
      r.transactionDescription?.startsWith("EXCLUDED:"),
    );
    expect(excludedResults.length).toBeGreaterThanOrEqual(4);

    for (const excluded of excludedResults) {
      expect(excluded.payableId).toBeFalsy();
      expect(excluded.status).toBe("Pending");
      expect(excluded.requiresManualApproval).toBe(true);
      expect(excluded.transactionDescription).toMatch(
        /EXCLUDED: .* Excluded from payable matching\./,
      );
    }

    // 2. Legitimate payouts match the payables
    const bashudevMatch = results.find(
      (r) => r.shareholderName?.includes("BASHUDEV") || r.excelAmount === 702.39,
    );
    expect(bashudevMatch).toBeDefined();
    expect(bashudevMatch?.payableId).toBe("mf-pay-003");
    expect(bashudevMatch?.status).toBe("Matched");
    expect(bashudevMatch?.payableType).toBe("mutual_fund");

    const kolayMatch = results.find(
      (r) => r.shareholderName?.includes("KOLAY") || r.excelAmount === 9850.0,
    );
    expect(kolayMatch).toBeDefined();
    expect(kolayMatch?.payableId).toBe("mf-pay-004");
    expect(kolayMatch?.status).toBe("Matched");
    expect(kolayMatch?.payableType).toBe("mutual_fund");

    // 3. Rejected items are identified
    const rejectedItems = results.filter((r) => r.status === "Rejected");
    expect(rejectedItems).toHaveLength(2);
  });

  it("handles ambiguous debit/credit rows by quarantining them with manual approval flag", async () => {
    const malformedTx: BankTransaction = {
      id: "malformed-tx-1",
      date: "2026-10-05",
      description: "CORRUPTED ROW WITH BOTH DEBIT AND CREDIT",
      debit: 1000.0,
      credit: 500.0,
      balance: 10000.0,
      status: "Pending",
      category: "PAYOUT_DEBIT",
    };

    const mockDb = createMockDb();

    const report = await ReconciliationEngine.analyzeBankStatement([malformedTx], {
      companyId: MUTUAL_FUND_COMPANY_ID,
      client: mockDb,
    });
    const results = report.matches;

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe("Ambiguous Debit/Credit");
    expect(results[0].status).toBe("Pending");
    expect(results[0].requiresManualApproval).toBe(true);
    expect(results[0].payableId).toBeFalsy();
    expect(results[0].transactionDescription).toContain(
      "AMBIGUOUS: Both debit (1000) and credit (500) are non-zero",
    );
  });

  it("calculates exact summary statistics and extracts reconciliation exceptions", async () => {
    const rawBankTxs = SANITIZED_BANK_TRANSACTIONS.map((tx) => ({
      id: tx.id,
      date: tx.date,
      description: tx.description,
      debit: tx.debit,
      credit: tx.credit,
      balance: tx.balance,
      accountNo: tx.accountNo,
      beneficiaryName: tx.beneficiaryName,
      instructionId: tx.instructionId,
      status: tx.status,
      category: tx.category,
      fileName: tx.fileName,
    })) as unknown as BankTransaction[];

    const mockDb = createMockDb();

    const report = await ReconciliationEngine.analyzeBankStatement(rawBankTxs, {
      companyId: MUTUAL_FUND_COMPANY_ID,
      client: mockDb,
    });
    const results = report.matches;

    const matchedCount = results.filter((r) => r.status === "Matched").length;
    const rejectedCount = results.filter((r) => r.status === "Rejected").length;
    const pendingCount = results.filter((r) => r.status === "Pending").length;

    expect(results.length).toBe(rawBankTxs.length);
    expect(matchedCount).toBe(2);
    expect(rejectedCount).toBe(2);
    expect(pendingCount).toBe(4); // 4 quarantined non-payout operations

    // Invariant: total matched + rejected + pending === total records
    expect(matchedCount + rejectedCount + pendingCount).toBe(results.length);

    // Extract exceptions
    const exceptions = extractReconciliationExceptions(results);
    expect(exceptions.totalExceptions).toBe(rejectedCount + pendingCount);
  });
});
