import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";
import { ReconciliationEngine, amountEqualsPaisa } from "../reconciliation-engine";
import { BankParser } from "../bank-parser";
import {
  ReconciliationService,
  computeSha256,
  type ReconciliationGroupedLot,
  type ReconciliationResultRow,
} from "./reconciliation.service";
import { supabase } from "./database";

describe("Reconciliation Audit Remediation Invariants", () => {
  describe("1. SHA-256 Fingerprinting & Run Identity", () => {
    it("computes deterministic SHA-256 hash for files and transaction strings", async () => {
      const sampleText = "CompanyA|2026-03-01|Payout Div 2082|0201260720JRL7|5000|0";
      const hash1 = await computeSha256(sampleText);
      const hash2 = await computeSha256(sampleText);

      expect(hash1).toBeDefined();
      expect(hash1).toHaveLength(64); // Standard SHA-256 hex string length
      expect(hash1).toBe(hash2);
      expect(/^[0-9a-f]{64}$/.test(hash1)).toBe(true);
    });

    it("generates different fingerprints for distinct transaction amounts or references", async () => {
      const hashA = await computeSha256("Txn|Amount=5000.00|Ref=REF001");
      const hashB = await computeSha256("Txn|Amount=5000.01|Ref=REF001");
      const hashC = await computeSha256("Txn|Amount=5000.00|Ref=REF002");

      expect(hashA).not.toBe(hashB);
      expect(hashA).not.toBe(hashC);
    });
  });

  describe("2. Match Explainability & Approval Safety Invariants", () => {
    it("flags unique-amount-only matches with requiresManualApproval and lower confidence", async () => {
      const mockDb: any = {
        from: (table: string) => {
          const query: any = {
            select: () => query,
            in: () => query,
            eq: () => query,
            order: () => query,
            range: () => query,
            or: () => query,
            then: (resolve: any) => {
              if (table === "dividend_payables") {
                // Return exactly 1 unassigned payable matching the amount
                resolve({
                  data: [
                    {
                      id: "pay-101",
                      company_id: "comp-1",
                      fiscal_year: "2082/83",
                      net_payable: 7777.5,
                      payment_status: "Pending",
                    },
                  ],
                  count: 1,
                });
              } else {
                resolve({ data: [], count: 0 });
              }
            },
          };
          return query;
        },
      };

      const res = await ReconciliationEngine.analyzeBankStatement(
        [
          {
            id: "txn-unique",
            date: "2026-02-15",
            description: "Direct Bank Payout",
            debit: 7777.5,
            credit: 0,
            balance: 90000,
          },
        ],
        {
          companyId: "comp-1",
          client: mockDb,
          allowUniqueAmountOnly: true,
        },
      );

      expect(res.matches).toHaveLength(1);
      const match = res.matches[0];
      expect(match.matchMethod).toBe("unique_amount");
      expect(match.requiresManualApproval).toBe(true);
      expect(match.confidenceScore).toBeLessThanOrEqual(60);
      expect(match.ruleVersion).toBe("2.0.0");
    });

    it("assigns instruction_id match method with high confidence when instruction reference matches", async () => {
      const mockDb: any = {
        from: (table: string) => {
          const query: any = {
            select: () => query,
            in: () => query,
            eq: () => query,
            order: () => query,
            range: () => query,
            or: () => query,
            then: (resolve: any) => {
              if (table === "payments") {
                resolve({
                  data: [
                    {
                      id: "pmt-202",
                      company_id: "comp-1",
                      connectips_ref: "INSTR-889900",
                      net_amount: 1500,
                      status: "Pending",
                    },
                  ],
                  count: 1,
                });
              } else {
                resolve({ data: [], count: 0 });
              }
            },
          };
          return query;
        },
      };

      const res = await ReconciliationEngine.analyzeBankStatement(
        [
          {
            id: "txn-instr",
            date: "2026-02-15",
            description: "ConnectIPS Payout",
            instructionId: "INSTR-889900",
            debit: 1500,
            credit: 0,
            balance: 50000,
          },
        ],
        {
          companyId: "comp-1",
          client: mockDb,
        },
      );

      expect(res.matches).toHaveLength(1);
      const match = res.matches[0];
      expect(match.status).toBe("Matched");
      expect(match.matchMethod).toBe("instruction_id");
      expect(match.confidenceScore).toBeGreaterThanOrEqual(70);
    });
  });

  describe("3. Safe Operation-Scoped Revert & Fail-Closed Invariants", () => {
    it("fails closed and throws error when atomic lot revert RPC fails, preventing un-transactional data corruption", async () => {
      const fakeLot: ReconciliationGroupedLot = {
        lotKey: "lot-1",
        lotName: "Lot 1 (DIVIDEND)",
        date: "2026-03-01",
        companyName: "Test Company",
        payableType: "DIVIDEND",
        totalRecords: 1,
        matchedCount: 1,
        rejectedCount: 0,
        discrepancyCount: 0,
        totalAmount: 5000,
        matchedAmount: 5000,
        rejectedAmount: 0,
        records: [
          {
            id: "00000000-0000-0000-0000-000000000001",
            reconciliation_date: "2026-03-01",
            source_a_type: "bank_statement",
            source_a_id: null,
            source_b_type: "payable",
            source_b_id: "pay-1",
            client_id: "cli-1",
            company_id: "comp-1",
            payable_type: "dividend",
            payable_id: "pay-1",
            payment_id: "pmt-1",
            expected_amount: 5000,
            actual_amount: 5000,
            difference: 0,
            result: "Matched",
            notes: "Test",
            matched_by: null,
            matched_at: null,
            created_at: new Date().toISOString(),
          },
        ],
      };

      const spy = vi.spyOn(supabase, "rpc").mockResolvedValueOnce({
        data: null,
        error: {
          message: "Safety violation: 1 payments in this lot are already completed/settled",
        } as any,
      });

      await expect(ReconciliationService.revertLot(fakeLot)).rejects.toThrow(
        /Atomic reconciliation lot revert failed/i,
      );

      spy.mockRestore();
    });

    it("routes run-scoped lots to revert_reconciliation_run_atomic", async () => {
      const spy = vi.spyOn(supabase, "rpc").mockResolvedValueOnce({
        data: { success: true, reverted_payables: 5, deleted_payments: 5 },
        error: null,
      } as any);

      const lotWithRun: ReconciliationGroupedLot = {
        lotKey: "00000000-0000-0000-0000-000000000002",
        runId: "00000000-0000-0000-0000-000000000002",
        lotName: "Run 1234",
        date: "2026-03-01",
        companyName: "Test Co",
        payableType: "DIVIDEND",
        totalRecords: 5,
        matchedCount: 5,
        rejectedCount: 0,
        discrepancyCount: 0,
        totalAmount: 25000,
        matchedAmount: 25000,
        rejectedAmount: 0,
        records: [],
      };

      const result = await ReconciliationService.revertLot(lotWithRun);

      expect(spy).toHaveBeenCalledWith("revert_reconciliation_run_atomic", {
        p_run_id: "00000000-0000-0000-0000-000000000002",
        p_force: false,
      });
      expect(result.success).toBe(true);
      expect(result.revertedPayables).toBe(5);

      spy.mockRestore();
    });
  });

  describe("4. Unified Atomic Apply & History Grouping", () => {
    it("groups records into lots by runId when run_id is present", () => {
      const records: ReconciliationResultRow[] = [
        {
          id: "r1",
          run_id: "run-abc-123",
          reconciliation_date: "2026-03-01",
          source_a_type: "excel",
          source_a_id: null,
          source_b_type: "payable",
          source_b_id: "p1",
          client_id: "c1",
          company_id: "comp-1",
          payable_type: "dividend",
          payable_id: "p1",
          expected_amount: 1000,
          actual_amount: 1000,
          difference: 0,
          result: "Matched",
          notes: "Lot A",
          matched_by: null,
          matched_at: null,
          created_at: "2026-03-01T10:00:00Z",
        },
        {
          id: "r2",
          run_id: "run-abc-123",
          reconciliation_date: "2026-03-01",
          source_a_type: "excel",
          source_a_id: null,
          source_b_type: "payable",
          source_b_id: "p2",
          client_id: "c2",
          company_id: "comp-1",
          payable_type: "dividend",
          payable_id: "p2",
          expected_amount: 2000,
          actual_amount: 2000,
          difference: 0,
          result: "Matched",
          notes: "Lot A",
          matched_by: null,
          matched_at: null,
          created_at: "2026-03-01T10:00:00Z",
        },
      ];

      const lots = ReconciliationService.groupResultsIntoLots(records);
      expect(lots).toHaveLength(1);
      expect(lots[0].runId).toBe("run-abc-123");
      expect(lots[0].lotKey).toBe("run-abc-123");
      expect(lots[0].totalRecords).toBe(2);
      expect(lots[0].totalAmount).toBe(3000);
    });

    it("fails closed without falling back to legacy RPC if apply_and_record_reconciliation_batch fails", async () => {
      const rpcSpy = vi.spyOn(supabase, "rpc").mockImplementation(async (name: string) => {
        if (name === "apply_and_record_reconciliation_batch") {
          return {
            data: null,
            error: { message: "Database connection timeout or schema constraint" },
          } as any;
        }
        if (name === "apply_reconciliation_batch") {
          // If legacy fallback is incorrectly triggered, this would be called
          return { data: { success: true, updated_payables: 1 }, error: null } as any;
        }
        return { data: null, error: null } as any;
      });

      const dummyItems = [
        {
          id: "00000000-0000-0000-0000-000000000001",
          company_id: "00000000-0000-0000-0000-000000000001",
          client_id: "00000000-0000-0000-0000-000000000002",
          payable_type: "dividend",
          payable_id: "00000000-0000-0000-0000-000000000003",
          result: "Matched",
          actual_amount: 5000,
          expected_amount: 5000,
          match_method: "instruction_id",
          match_confidence: 95,
        },
      ];

      await expect(
        ReconciliationService.applyReconciliation(dummyItems as any, "Batch Test"),
      ).rejects.toThrow(/Atomic reconciliation batch failed/i);

      // Verify that legacy apply_reconciliation_batch was NEVER called
      expect(rpcSpy).not.toHaveBeenCalledWith("apply_reconciliation_batch", expect.anything());

      rpcSpy.mockRestore();
    });

    it("uses company:companies(company_name) when falling back to table query", async () => {
      let selectedFields = "";
      const selectMock: any = {
        order: () => selectMock,
        range: () =>
          Promise.resolve({
            data: [
              {
                id: "run-1",
                file_name: "Test.xlsx",
                file_hash_sha256: "hash-123",
                company: { company_name: "Nepal Hydro Ltd" },
              },
            ],
            count: 1,
            error: null,
          }),
      };

      const fromSpy = vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        if (table === "reconciliation_runs") {
          return {
            select: (fields: string) => {
              selectedFields = fields;
              return selectMock;
            },
          } as any;
        }
        return {} as any;
      });

      // Force RPC to fail so it uses table fallback
      const rpcSpy = vi.spyOn(supabase, "rpc").mockRejectedValueOnce(new Error("RPC not found"));

      const res = await ReconciliationService.getReconciliationRuns();

      expect(selectedFields).toContain("company:companies(company_name)");
      expect(res.runs[0].company_name).toBe("Nepal Hydro Ltd");

      fromSpy.mockRestore();
      rpcSpy.mockRestore();
    });
  });

  describe("5. Bank Settlement Sheet Selection & Content-Hash Deduplication", () => {
    it("selects named settlement sheet over phantom Sheet1 when both exist in workbook", async () => {
      const wb = XLSX.utils.book_new();
      // Phantom Sheet1 with no settlement header
      const emptySheet = XLSX.utils.aoa_to_sheet([["Generic Header", "Value"]]);
      // Named dataset sheet with settlement columns
      const settlementSheet = XLSX.utils.aoa_to_sheet([
        ["Instruction Id", "Amount", "Beneficiary Bank", "Account Number"],
        ["INSTR-99901", "12500.00", "RBB", "1700100000036006"],
      ]);

      XLSX.utils.book_append_sheet(wb, emptySheet, "Sheet1");
      XLSX.utils.book_append_sheet(wb, settlementSheet, "Credit_Transactions__Thapathali");

      const wbBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      const mockFile = new File([wbBuf], "settlement_report.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const txns = await BankParser.parseExcelSettlement(mockFile);
      expect(txns).toHaveLength(1);
      expect(txns[0].instructionId).toBe("INSTR-99901");
      expect(txns[0].debit).toBe(12500);
    });

    it("deduplicates identical files with different names using SHA-256 content hash", async () => {
      const csvData = [
        "Instruction ID,Debit,Credit,Date,Description",
        "INSTR-TEST-001,4500,0,2026-03-01,Dividend Payment",
      ].join("\n");

      const file1 = new File([csvData], "file_alpha.csv", { type: "text/csv" });
      const file2 = new File([csvData], "file_beta_renamed_copy.csv", { type: "text/csv" });

      const txns = await BankParser.parseMultipleFiles([file1, file2]);
      // Content-hash deduplication ensures file2 is skipped completely
      expect(txns).toHaveLength(1);
      expect(txns[0].instructionId).toBe("INSTR-TEST-001");
    });
  });
});
