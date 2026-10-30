import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import { BankParser, classifyReconciliationFile } from "../bank-parser";
import { ReconciliationService } from "./reconciliation.service";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const isLiveDb =
  !process.env.CI ||
  Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_URL !== "http://127.0.0.1:54321",
  );

function loadSampleFile(relativePath: string): File {
  const fullPath = path.resolve(process.cwd(), relativePath);
  const buffer = fs.readFileSync(fullPath);
  const fileName = path.basename(fullPath);
  return new File([buffer], fileName, {
    type: fileName.endsWith(".xlsx")
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : fileName.endsWith(".xls")
        ? "application/vnd.ms-excel"
        : "text/csv",
  });
}

describe("Real Sample Files & Database-Backed Reconciliation Invariants", () => {
  describe("1. Real File Parsing & Classification from samples/MUTUAL FUND REPORTS 82.83", () => {
    it("correctly classifies real settlement reports and fails closed on ambiguous files", async () => {
      const errorReportFile = loadSampleFile(
        "samples/MUTUAL FUND REPORTS 82.83/ERROR REPORT 2026.10.05.xls",
      );
      const mer4File = loadSampleFile("samples/MUTUAL FUND REPORTS 82.83/MER 4.xls");
      const bishalFile = loadSampleFile("samples/MUTUAL FUND REPORTS 82.83/BISHAL SIR.xlsx");

      expect(await classifyReconciliationFile(errorReportFile)).toBe("bank_statement");
      expect(await classifyReconciliationFile(mer4File)).toBe("bank_statement");
      expect(await classifyReconciliationFile(bishalFile)).toBe("bank_statement");

      // Debenture registry file should NOT be misclassified as bank_statement
      const debentureRegistry = new File(
        ["boid,shareholder_name,kitta,interest_amount\n1301230000000001,RAM SHRESTHA,100,8500.00"],
        "Debenture_Holder_Registry_2080.xlsx",
        { type: "text/csv" },
      );
      expect(await classifyReconciliationFile(debentureRegistry)).toBe("shareholder_registry");

      // Ambiguous dummy file fails closed
      const ambiguousFile = new File(["random,notes,data\n1,foo,bar"], "notes_report.xlsx", {
        type: "text/csv",
      });
      expect(await classifyReconciliationFile(ambiguousFile)).toBe("ambiguous");
    });

    it("parses ERROR REPORT 2026.10.05.xls into 24 rejected transactions totaling NPR 1,593.53", async () => {
      const file = loadSampleFile("samples/MUTUAL FUND REPORTS 82.83/ERROR REPORT 2026.10.05.xls");
      const txns = await BankParser.parseBankStatement(file);

      expect(txns.length).toBe(24);

      const totalAmt = txns.reduce((sum, t) => sum + (t.debit || t.credit || 0), 0);
      expect(Math.round(totalAmt * 100) / 100).toBe(1593.53);

      for (const t of txns) {
        expect(t.status === "Rejected" || t.status === "RJCT").toBe(true);
        expect(t.debit || t.credit).toBeGreaterThan(0);
      }
    });

    it("parses MER 4.xls into 58 settlement transactions", async () => {
      const file = loadSampleFile("samples/MUTUAL FUND REPORTS 82.83/MER 4.xls");
      const txns = await BankParser.parseBankStatement(file);

      expect(txns.length).toBe(58);

      const accepted = txns.filter((t) => t.status !== "Rejected" && t.status !== "RJCT");
      const rejected = txns.filter((t) => t.status === "Rejected" || t.status === "RJCT");

      expect(accepted.length).toBe(56);
      expect(rejected.length).toBe(2);

      const acceptedSum = accepted.reduce((s, t) => s + (t.debit || t.credit || 0), 0);
      const rejectedSum = rejected.reduce((s, t) => s + (t.debit || t.credit || 0), 0);

      expect(Math.round(acceptedSum * 100) / 100).toBe(14756304.11);
      expect(Math.round(rejectedSum * 100) / 100).toBe(48409.62);
    });
  });

  describe.skipIf(!isLiveDb)(
    "2. Real Database Apply, Snapshot Preservation & Safe Reversal",
    () => {
      let testCompanyId: string;
      let testClientId: string;
      let testPayableId: string;
      let testRunId: string;
      const testTag = `RT_${Date.now()}`;

      beforeAll(async () => {
        // Create test company
        const { data: comp, error: compErr } = await db
          .from("companies")
          .insert({
            company_name: `Test Recon Company ${testTag}`,
            company_code: `C_${testTag.slice(-6)}`,
            company_type: "Mutual Fund",
            fiscal_year: "2082/83",
          })
          .select("id")
          .single();
        if (compErr) throw compErr;
        testCompanyId = comp.id;

        // Create test client
        const { data: client, error: clientErr } = await db
          .from("clients")
          .insert({
            client_code: `CLI_${testTag.slice(-6)}`,
            full_name: `Investor ${testTag}`,
            boid: `130123000${testTag.slice(-7)}`,
            bank_name: "Rastriya Banijya Bank",
            bank_account_no: `0110020${testTag.slice(-6)}`,
          })
          .select("id")
          .single();
        if (clientErr) throw clientErr;
        testClientId = client.id;

        // Create a mutual fund payable with pre-existing PARTIAL payment
        // Net payable = 250.00, already paid = 50.00, remaining = 200.00
        const { data: pay, error: payErr } = await db
          .from("mutual_fund_payables")
          .insert({
            company_id: testCompanyId,
            client_id: testClientId,
            fiscal_year: "2082/83",
            shares_held: 1000,
            gross_dividend: 250.0,
            tax_amount: 0.0,
            net_payable: 250.0,
            paid_amount: 50.0,
            remaining_amount: 200.0,
            payment_status: "Partial",
            payment_date: "2026-09-01",
            payment_reference: "INITIAL-PARTIAL-001",
          })
          .select("id")
          .single();
        if (payErr) throw payErr;
        testPayableId = pay.id;
      });

      afterAll(async () => {
        if (testRunId) {
          await db.from("reconciliation_results").delete().eq("run_id", testRunId);
          await db.from("reconciliation_runs").delete().eq("id", testRunId);
        }
        if (testPayableId) {
          await db.from("payments").delete().eq("payable_id", testPayableId);
          await db.from("mutual_fund_payables").delete().eq("id", testPayableId);
        }
        if (testClientId) await db.from("clients").delete().eq("id", testClientId);
        if (testCompanyId) await db.from("companies").delete().eq("id", testCompanyId);
      });

      it("applies remaining 200.00, snapshotting prior 50.00 partial state and preventing total amount duplication", async () => {
        // Apply the final 200.00 settlement
        const { data: rpcRes, error: rpcErr } = await db.rpc(
          "apply_and_record_reconciliation_batch",
          {
            p_run_info: {
              company_id: testCompanyId,
              fiscal_year: "2082/83",
              source_type: "bank_statement",
              file_name: "MER 4.xls",
              file_hash_sha256: "test_hash_mer4",
              idempotency_key: `test_mer4_${testTag}`,
              row_count: 1,
              total_amount: 200.0,
              chunk_index: 0,
              total_chunks: 1,
              is_final_chunk: true,
            },
            p_items: [
              {
                payable_id: testPayableId,
                client_id: testClientId,
                target_table: "mutual_fund",
                payable_type: "mutual_fund",
                result: "MATCHED",
                actual_amount: 200.0,
                expected_amount: 200.0,
                difference: 0,
                payment_reference: `RECON-${testTag.slice(-8)}`,
                instruction_id: `INS-${testTag.slice(-8)}`,
                match_method: "instruction_id",
                match_confidence: 100,
                source_reference: `SRC-${testTag}`,
              },
            ],
            p_batch_info: null,
          },
        );

        expect(rpcErr).toBeNull();
        expect(rpcRes.success).toBe(true);
        expect(rpcRes.payables_updated).toBe(1);
        testRunId = rpcRes.run_id;

        // 1. Verify payable reached Paid with exact 250.00 total paid
        const { data: payableAfter } = await db
          .from("mutual_fund_payables")
          .select("payment_status, paid_amount, remaining_amount, payment_reference")
          .eq("id", testPayableId)
          .single();

        expect(payableAfter).toBeDefined();
        expect(payableAfter!.payment_status).toBe("Paid");
        expect(Number(payableAfter!.paid_amount)).toBe(250.0);
        expect(Number(payableAfter!.remaining_amount)).toBe(0.0);

        // 2. Verify prior partial snapshot was captured in reconciliation_results
        const { data: reconResult } = await db
          .from("reconciliation_results")
          .select(
            "prior_paid_amount, prior_payment_status, prior_payment_date, prior_payment_reference",
          )
          .eq("run_id", testRunId)
          .eq("payable_id", testPayableId)
          .single();

        expect(reconResult).toBeDefined();
        expect(Number(reconResult!.prior_paid_amount)).toBe(50.0);
        expect(reconResult!.prior_payment_status).toBe("Partial");
        expect(reconResult!.prior_payment_date).toBe("2026-09-01");
        expect(reconResult!.prior_payment_reference).toBe("INITIAL-PARTIAL-001");

        // 3. Verify reconciliation_runs total_amount is 200.00 (NOT duplicated to 400.00)
        const { data: runRecord } = await db
          .from("reconciliation_runs")
          .select("total_amount, matched_count")
          .eq("id", testRunId)
          .single();

        expect(runRecord).toBeDefined();
        expect(Number(runRecord!.total_amount)).toBe(200.0);
        expect(runRecord!.matched_count).toBe(1);
      });

      it("reverts run safely and restores the exact pre-existing partial payment state", async () => {
        // Revert the run
        const { data: revertRes, error: revertErr } = await db.rpc(
          "revert_reconciliation_run_atomic",
          {
            p_run_id: testRunId,
            p_force: true,
          },
        );

        expect(revertErr).toBeNull();
        expect(revertRes.success).toBe(true);
        expect(revertRes.reverted_payables).toBe(1);

        // Verify payable has been restored to prior partial state (NOT reset to 0/Pending!)
        const { data: restoredPayable } = await db
          .from("mutual_fund_payables")
          .select("payment_status, paid_amount, remaining_amount, payment_date, payment_reference")
          .eq("id", testPayableId)
          .single();

        expect(restoredPayable).toBeDefined();
        expect(restoredPayable!.payment_status).toBe("Partial");
        expect(Number(restoredPayable!.paid_amount)).toBe(50.0);
        expect(Number(restoredPayable!.remaining_amount)).toBe(200.0);
        expect(restoredPayable!.payment_date).toBe("2026-09-01");
        expect(restoredPayable!.payment_reference).toBe("INITIAL-PARTIAL-001");
      });

      it("processes a rejected-only payout file, creating auditable run, exception, and status counters", async () => {
        const rejectTag = `REJ_${Date.now()}`;
        const { data: rejRes, error: rejErr } = await db.rpc(
          "apply_and_record_reconciliation_batch",
          {
            p_run_info: {
              company_id: testCompanyId,
              fiscal_year: "2082/83",
              source_type: "bank_statement",
              file_name: "ERROR REPORT 2026.10.05.xls",
              file_hash_sha256: "test_hash_error_report",
              idempotency_key: `test_err_${rejectTag}`,
              row_count: 1,
              total_amount: 26.12,
              chunk_index: 0,
              total_chunks: 1,
              is_final_chunk: true,
            },
            p_items: [
              {
                payable_id: testPayableId,
                client_id: testClientId,
                target_table: "mutual_fund",
                payable_type: "mutual_fund",
                result: "REJECTED",
                actual_amount: 26.12,
                expected_amount: 26.12,
                difference: 0,
                payment_reference: `REJ-${rejectTag.slice(-8)}`,
                instruction_id: `INS-REJ-${rejectTag.slice(-8)}`,
                match_method: "instruction_id",
                match_confidence: 90,
                source_reference: `SRC-REJ-${rejectTag}`,
              },
            ],
            p_batch_info: null,
          },
        );

        expect(rejErr).toBeNull();
        expect(rejRes.success).toBe(true);
        expect(rejRes.rejected_count).toBe(1);
        expect(rejRes.exceptions_created).toBe(1);
        expect(rejRes.payables_updated).toBe(0);

        const rejRunId = rejRes.run_id;

        // Verify exception record created
        const { data: exc } = await db
          .from("reconciliation_exceptions")
          .select("id, run_id, payable_id, amount, status")
          .eq("run_id", rejRunId)
          .single();

        expect(exc).toBeDefined();
        expect(exc!.status).toBe("Open");
        expect(Number(exc!.amount)).toBe(26.12);

        // Clean up rejected test run
        await db.from("reconciliation_exceptions").delete().eq("run_id", rejRunId);
        await db.from("reconciliation_results").delete().eq("run_id", rejRunId);
        await db.from("reconciliation_runs").delete().eq("id", rejRunId);
      });
    },
  );
});
