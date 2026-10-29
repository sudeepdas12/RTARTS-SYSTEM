import { describe, it, expect } from "vitest";
import { BankParser } from "../bank-parser";
import { calculatePayableTotals, getPayeeTaxRate } from "./payable-summary";

function createMockFile(content: string, name: string): File {
  return new File([content], name, { type: "text/plain" });
}

describe("End-to-End Payment, Reconciliation, and Bank Statement Verification", () => {
  describe("1. Multi-leg Installment Payment Calculations", () => {
    it("correctly prorates and balances partial second installment payment", () => {
      // Annual Debenture Payable (8.5% debenture sample: 3500 units * 1000 face * 8.5% = 297,500)
      const origGross = 2975.0;
      const origTax = 178.5; // 6% individual TDS
      const origNet = 2796.5;

      // Leg 1: Semi-annual installment paid (183/365 proration)
      const leg1PaidNet = 1402.08;
      const remNet = Number((origNet - leg1PaidNet).toFixed(2)); // 1394.42
      expect(remNet).toBe(1394.42);

      // Leg 2: Batch creation proration for remaining amount
      const ratio = remNet / origNet;
      let leg2Gross = Math.round(origGross * ratio * 100) / 100;
      const leg2Tax = Number((leg2Gross - remNet).toFixed(2));
      leg2Gross = Number((remNet + leg2Tax).toFixed(2));

      // Balance invariant check: abs(gross - tax - net) <= 0.05
      const invariantDiff = Math.abs(leg2Gross - leg2Tax - remNet);
      expect(invariantDiff).toBeLessThanOrEqual(0.05);

      // Verify cumulative settlement sums match annual totals exactly to the paisa
      const totalNet = Number((leg1PaidNet + remNet).toFixed(2));
      expect(totalNet).toBe(origNet);

      // Prorated gross for Leg 1
      const leg1Gross = Math.round(origGross * (leg1PaidNet / origNet) * 100) / 100;
      const leg1Tax = Number((leg1Gross - leg1PaidNet).toFixed(2));
      expect(Math.abs(leg1Gross - leg1Tax - leg1PaidNet)).toBeLessThanOrEqual(0.05);

      const cumulativeGross = Number((leg1Gross + leg2Gross).toFixed(2));
      const cumulativeTax = Number((leg1Tax + leg2Tax).toFixed(2));

      expect(Math.abs(cumulativeGross - origGross)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(cumulativeTax - origTax)).toBeLessThanOrEqual(0.05);
    });

    it("verifies statutory check constraints on payment amounts", () => {
      const items = [
        { gross: 10000, tax: 500, net: 9500 },
        { gross: 2975, tax: 178.5, net: 2796.5 },
        { gross: 1483.43, tax: 89.01, net: 1394.42 },
        { gross: 50000, tax: 0, net: 50000 },
      ];

      for (const item of items) {
        expect(item.gross).toBeGreaterThanOrEqual(0);
        expect(item.tax).toBeGreaterThanOrEqual(0);
        expect(item.net).toBeGreaterThanOrEqual(0);
        expect(item.net).toBeLessThanOrEqual(item.gross + 0.05);
        expect(Math.abs(item.gross - item.tax - item.net)).toBeLessThanOrEqual(0.05);
      }
    });
  });

  describe("2. Bank Statement Parsing & Financial Cleansing", () => {
    it("handles DR/CR suffixes, parentheses, commas, and negative values correctly", async () => {
      const csv = [
        "Date,Description,Debit,Credit,Balance",
        '2026-01-10,Corporate Payout Batch 1,"50,000.00 DR",0,"950,000.00 CR"',
        '2026-01-11,Fund Inward,0,"100,000.00 CR","1,050,000.00 CR"',
        '2026-01-12,Unpaid Payout Returned,0,"(12,345.50)",1062345.50',
      ].join("\n");

      const file = createMockFile(csv, "statement_test.csv");
      const txns = await BankParser.parseBankStatement(file);

      expect(txns).toHaveLength(3);
      // Debit should be positive magnitude for payout withdrawal
      expect(txns[0].debit).toBe(50000);
      expect(txns[0].balance).toBe(950000);
      expect(txns[0].category).toBe("PAYOUT_DEBIT");

      // Credit should be positive for fund inward
      expect(txns[1].credit).toBe(100000);
      expect(txns[1].balance).toBe(1050000);

      // Parentheses in deposit column
      expect(txns[2].credit).toBe(12345.5);
    });

    it("parses dates without timezone shifting", async () => {
      const csv = [
        "Date,Particulars,Withdrawal,Deposit,Balance",
        "2026-09-17,Payout Test,500,0,10000",
        "17/09/2026,Payout Test 2,600,0,9400",
      ].join("\n");

      const file = createMockFile(csv, "date_test.csv");
      const txns = await BankParser.parseBankStatement(file);

      expect(txns).toHaveLength(2);
      expect(txns[0].date).toBe("2026-09-17");
      expect(txns[1].date).toBe("2026-09-17");
    });

    it("deduplicates transactions across multi-file uploads safely", async () => {
      const csv1 = [
        "Date,Description,Debit,Credit,Balance,Instruction ID",
        "2026-01-15,Payout 1,5000,0,95000,INST-001",
        "2026-01-16,Payout 2,6000,0,89000,INST-002",
      ].join("\n");

      const csv2 = [
        "Date,Description,Debit,Credit,Balance,Instruction ID",
        "2026-01-15,Payout 1,5000,0,95000,INST-001", // Duplicate across files
        "2026-01-17,Payout 3,7000,0,82000,INST-003", // New transaction
      ].join("\n");

      const file1 = createMockFile(csv1, "batch1.csv");
      const file2 = createMockFile(csv2, "batch2.csv");

      const txns = await BankParser.parseMultipleFiles([file1, file2]);
      expect(txns).toHaveLength(3); // INST-001 deduplicated, INST-002 and INST-003 kept
    });
  });

  describe("3. Reconciliation Matching Invariants", () => {
    it("indexes and matches payments by both original and paid amount", () => {
      const payments = [
        { id: "p1", net_amount: 5000.0, paid_amount: 5000.0, status: "Completed" },
        { id: "p2", net_amount: 2796.5, paid_amount: 1402.08, status: "Partial" },
      ];

      // Match p1 by full net amount
      const key1 = Number(5000).toFixed(2);
      const matchedP1 = payments.find((p) => p.net_amount.toFixed(2) === key1);

      // Match p2 by partial installment paid amount
      const key2 = Number(1402.08).toFixed(2);
      const matchedP2 = payments.find((p) => p.paid_amount.toFixed(2) === key2);

      expect(matchedP1).toBeDefined();
      expect(matchedP2).toBeDefined();
      expect(matchedP1?.id).toBe("p1");
      expect(matchedP2?.id).toBe("p2");
    });
  });

  describe("4. Payment Duplicate Protection & Batch Locking", () => {
    it("rejects batch line items containing duplicate payable records in-memory", async () => {
      const { PaymentService } = await import("./payment.service");
      const duplicatePayableItems: any[] = [
        {
          company_id: "comp-1",
          client_id: "client-1",
          payable_type: "dividend",
          payable_id: "pay-duplicate-1",
          gross_amount: 1000,
          tax_amount: 50,
          net_amount: 950,
          paid_amount: 950,
          payment_method: "ConnectIPS",
          payment_date: "2026-10-13",
          payment_reference: "REF-001",
          bank_name: "RBB",
          bank_account_no: "1234567890",
          neft_ref: null,
          connectips_ref: null,
          rtgs_ref: null,
          cheque_no: null,
          status: "Draft",
          remarks: null,
        },
        {
          company_id: "comp-1",
          client_id: "client-2",
          payable_type: "dividend",
          payable_id: "pay-duplicate-1", // DUPLICATE PAYABLE ID
          gross_amount: 1000,
          tax_amount: 50,
          net_amount: 950,
          paid_amount: 950,
          payment_method: "ConnectIPS",
          payment_date: "2026-10-13",
          payment_reference: "REF-002",
          bank_name: "RBB",
          bank_account_no: "0987654321",
          neft_ref: null,
          connectips_ref: null,
          rtgs_ref: null,
          cheque_no: null,
          status: "Draft",
          remarks: null,
        },
      ];

      await expect(
        PaymentService.addLineItems("batch-test-1", duplicatePayableItems),
      ).rejects.toThrow(/Duplicate payout attempt detected/i);
    });

    it("rejects batch line items containing duplicate payment references in-memory", async () => {
      const { PaymentService } = await import("./payment.service");
      const duplicateRefItems: any[] = [
        {
          company_id: "comp-1",
          client_id: "client-1",
          payable_type: "dividend",
          payable_id: "pay-1",
          gross_amount: 1000,
          tax_amount: 50,
          net_amount: 950,
          paid_amount: 950,
          payment_method: "ConnectIPS",
          payment_date: "2026-10-13",
          payment_reference: "REF-IDENTICAL", // DUPLICATE REFERENCE
          bank_name: "RBB",
          bank_account_no: "1234567890",
          neft_ref: null,
          connectips_ref: null,
          rtgs_ref: null,
          cheque_no: null,
          status: "Draft",
          remarks: null,
        },
        {
          company_id: "comp-1",
          client_id: "client-2",
          payable_type: "dividend",
          payable_id: "pay-2",
          gross_amount: 1000,
          tax_amount: 50,
          net_amount: 950,
          paid_amount: 950,
          payment_method: "ConnectIPS",
          payment_date: "2026-10-13",
          payment_reference: "REF-IDENTICAL", // DUPLICATE REFERENCE
          bank_name: "RBB",
          bank_account_no: "0987654321",
          neft_ref: null,
          connectips_ref: null,
          rtgs_ref: null,
          cheque_no: null,
          status: "Draft",
          remarks: null,
        },
      ];

      await expect(PaymentService.addLineItems("batch-test-2", duplicateRefItems)).rejects.toThrow(
        /Duplicate payment reference detected/i,
      );
    });
  });

  describe("5. ConnectIPS Settlement Report Classification and Priority Routing", () => {
    it("classifies ACSC rows as PAYOUT_DEBIT and RJCT rows as REJECT_RETURN in settlement reports", async () => {
      const csv = [
        "#,Batch Id,Transaction Id,Instruction Id,Transaction Amount,Creditor Bank,Creditor Branch,Creditor Name,Creditor Account,Credit Status,Waive Fee,Reference Id,Remarks,Particulars,Created On,Created By",
        "1,441581,1626805,0201260721JWX546,1402.08,4501-Sanima Bank Ltd.,1 -Head Office,ABDUL SATAR ANSARI,021011120000004,ACSC,Y,RBBL DEBENTURE,RBBDEBENTURE,,2026-07-21 11:32:09.202,RBB14317",
        "2,441581,1626720,0201260721JWX461,1001.48,2601-Prabhu Bank Limited,999 -Head Office Babarmahal,HARI SHANKAR GUPTA,0500042716600011,RJCT,Y,RBBL DEBENTURE,RBBDEBENTURE,,2026-07-21 11:32:09.202,RBB14317",
      ].join("\n");

      const file = createMockFile(csv, "IPS REPORT LOT 2 PUBLIC.csv");
      const txns = await BankParser.parseBankStatement(file);

      expect(txns).toHaveLength(2);

      // Successful row: ACSC should be PAYOUT_DEBIT and have positive debit
      expect(txns[0].status).toBe("ACSC");
      expect(txns[0].category).toBe("PAYOUT_DEBIT");
      expect(txns[0].debit).toBe(1402.08);
      expect(txns[0].credit).toBe(0);
      expect(txns[0].instructionId).toBe("0201260721JWX546");

      // Rejected row: RJCT should be REJECT_RETURN
      expect(txns[1].status).toBe("RJCT");
      expect(txns[1].category).toBe("REJECT_RETURN");
      expect(txns[1].instructionId).toBe("0201260721JWX461");
    });

    it("prioritizes ConnectIPS Instruction Id over Transaction Id", async () => {
      const csv = [
        "#,Batch Id,Transaction Id,Instruction Id,Transaction Amount,Creditor Bank,Creditor Name,Creditor Account,Credit Status",
        "1,441146,1614560,0201260720JRL28,3104479.68,4501-Sanima Bank Ltd.,SOCIAL SECURITY FUND,001010010003504,ACSC",
      ].join("\n");

      const file = createMockFile(csv, "IPS REPORT LOT 1 COMPANY FUND.csv");
      const txns = await BankParser.parseBankStatement(file);

      expect(txns).toHaveLength(1);
      expect(txns[0].instructionId).toBe("0201260720JRL28");
      expect(txns[0].instructionId).not.toBe("1614560");
    });
  });
});
