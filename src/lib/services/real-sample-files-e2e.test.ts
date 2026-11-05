import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import { BankParser, classifyReconciliationFile } from "../bank-parser";
import { ReconciliationService } from "./reconciliation.service";
import { supabase } from "./database";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || "injected-via-env-only", {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sampleFileCheck = path.resolve(
  process.cwd(),
  "samples/MUTUAL FUND REPORTS 82.83/ERROR REPORT 2026.10.05.xls",
);
const hasSamples = fs.existsSync(sampleFileCheck);

const isLiveDb = Boolean(SERVICE_ROLE_KEY && hasSamples);

function loadSampleFile(relativePath: string): File {
  const fullPath = path.resolve(process.cwd(), relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Sample file not found on disk: ${relativePath}`);
  }
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
  describe.skipIf(!hasSamples)(
    "1. Real File Parsing & Classification from samples/MUTUAL FUND REPORTS 82.83",
    () => {
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
          [
            "boid,shareholder_name,kitta,interest_amount\n1301230000000001,RAM SHRESTHA,100,8500.00",
          ],
          "Debenture_Holder_Registry_2080.xlsx",
          { type: "text/csv" },
        );
        expect(await classifyReconciliationFile(debentureRegistry)).toBe("shareholder_registry");

        // Ambiguous dummy file fails closed
        const ambiguousFile = new File(["random,notes,data\n1,foo,bar"], "notes_report.xlsx", {
          type: "text/csv",
        });
        expect(await classifyReconciliationFile(ambiguousFile)).toBe("ambiguous");

        // Corrupt or unreadable spreadsheet fails closed as ambiguous even with bank filename keywords
        const corruptFile = new File(
          [new Uint8Array([0x50, 0x4b, 0x00, 0x00, 0x99, 0x88, 0x77])],
          "ips_settlement_corrupt.xlsx",
          {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        );
        expect(await classifyReconciliationFile(corruptFile)).toBe("ambiguous");
      });

      it("parses ERROR REPORT 2026.10.05.xls into 24 rejected transactions totaling NPR 1,593.53", async () => {
        const file = loadSampleFile(
          "samples/MUTUAL FUND REPORTS 82.83/ERROR REPORT 2026.10.05.xls",
        );
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
    },
  );

  describe.skipIf(!isLiveDb)(
    "2. Real Database Apply, Snapshot Preservation & Safe Reversal",
    () => {
      let testCompanyId: string;
      let testClientId: string;
      let testPayableId: string;
      let testRunId: string;
      const testTag = `RT_${Date.now()}`;

      beforeAll(async () => {
        // Authenticate service client for RPCs requiring authenticated / admin role
        await supabase.auth.signInWithPassword({
          email: "admin@rbbmbl.com.np",
          password: process.env.SUPABASE_TEST_ADMIN_PASSWORD || "Admin123!",
        });

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
            "prior_paid_amount, prior_payment_status, prior_payment_date, prior_payment_reference, prior_snapshot",
          )
          .eq("run_id", testRunId)
          .eq("payable_id", testPayableId)
          .single();

        expect(reconResult).toBeDefined();
        expect(Number(reconResult!.prior_paid_amount)).toBe(50.0);
        expect(reconResult!.prior_payment_status).toBe("Partial");
        expect(reconResult!.prior_payment_date).toBe("2026-09-01");
        expect(reconResult!.prior_payment_reference).toBe("INITIAL-PARTIAL-001");
        expect(reconResult!.prior_snapshot).toBeDefined();
        expect(Number((reconResult!.prior_snapshot as any).paid_amount)).toBe(50);
        expect(Number((reconResult!.prior_snapshot as any).shares_held)).toBe(1000);
        expect((reconResult!.prior_snapshot as any).payment_status).toBe("Partial");

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

      it("short-circuits already-paid payables without creating duplicate payment records", async () => {
        // First mark testPayableId as Paid
        await db
          .from("mutual_fund_payables")
          .update({
            payment_status: "Paid",
            paid_amount: 250.0,
            remaining_amount: 0.0,
          })
          .eq("id", testPayableId);

        const dupTag = `DUP_${Date.now()}`;
        const { data: dupRes, error: dupErr } = await db.rpc(
          "apply_and_record_reconciliation_batch",
          {
            p_run_info: {
              company_id: testCompanyId,
              fiscal_year: "2082/83",
              source_type: "bank_statement",
              file_name: "MER 4.xls",
              file_hash_sha256: "test_hash_dup",
              idempotency_key: `test_dup_${dupTag}`,
              row_count: 1,
              total_amount: 250.0,
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
                actual_amount: 250.0,
                expected_amount: 250.0,
                difference: 0,
                payment_reference: `RECON-DUP-${dupTag.slice(-6)}`,
                instruction_id: `INS-DUP-${dupTag.slice(-6)}`,
                match_method: "instruction_id",
                match_confidence: 100,
                source_reference: `SRC-DUP-${dupTag}`,
              },
            ],
            p_batch_info: null,
          },
        );

        expect(dupErr).toBeNull();
        expect(dupRes.success).toBe(true);
        // Assert short-circuit behavior:
        expect(dupRes.payables_updated).toBe(0);
        expect(dupRes.already_paid_skipped).toBe(1);
        expect(dupRes.payments_created).toBe(0);

        const dupRunId = dupRes.run_id;

        // Verify NO duplicate payment record was inserted for this run
        const { data: paymentsForRun } = await db
          .from("payments")
          .select("id")
          .eq("reconciliation_run_id", dupRunId);

        expect(paymentsForRun).toEqual([]);

        // Verify reconciliation_result notes state
        const { data: dupResult } = await db
          .from("reconciliation_results")
          .select("payment_id, notes, prior_payment_status")
          .eq("run_id", dupRunId)
          .eq("payable_id", testPayableId)
          .single();

        expect(dupResult).toBeDefined();
        expect(dupResult!.payment_id).toBeNull();
        expect(dupResult!.prior_payment_status).toBe("Paid");
        expect(dupResult!.notes).toContain("Payable already Paid");

        // Clean up
        await db.from("reconciliation_results").delete().eq("run_id", dupRunId);
        await db.from("reconciliation_runs").delete().eq("id", dupRunId);
      });

      it("preserves pre-run baseline snapshot across multi-item runs on the same payable and safely rolls back", async () => {
        // Create a new client and payable: 500.00 net, 0 paid, Pending
        const multiTag = `MULTI_${Date.now()}`;
        const { data: multiClient, error: clientErr } = await db
          .from("clients")
          .insert({
            client_code: `CLI_M_${multiTag.slice(-6)}`,
            full_name: `Investor Multi ${multiTag}`,
            boid: `130123000${multiTag.slice(-7)}`,
            bank_name: "Rastriya Banijya Bank",
            bank_account_no: `0110020${multiTag.slice(-6)}`,
          })
          .select("id")
          .single();
        if (clientErr) throw clientErr;

        const { data: newPay, error: newPayErr } = await db
          .from("mutual_fund_payables")
          .insert({
            company_id: testCompanyId,
            client_id: multiClient.id,
            fiscal_year: "2082/83",
            shares_held: 2000,
            gross_dividend: 500.0,
            tax_amount: 0.0,
            net_payable: 500.0,
            paid_amount: 0.0,
            remaining_amount: 500.0,
            payment_status: "Pending",
          })
          .select("id")
          .single();
        if (newPayErr) throw newPayErr;

        const multiPayId = newPay.id;

        // Apply a batch with 2 items touching the same payable:
        // Item 1: REJECTED (100.00)
        // Item 2: MATCHED (400.00)
        const { data: multiRes, error: multiErr } = await db.rpc(
          "apply_and_record_reconciliation_batch",
          {
            p_run_info: {
              company_id: testCompanyId,
              fiscal_year: "2082/83",
              source_type: "bank_statement",
              file_name: "MER 4.xls",
              file_hash_sha256: "test_hash_multi",
              idempotency_key: `test_multi_${multiTag}`,
              row_count: 2,
              total_amount: 500.0,
              chunk_index: 0,
              total_chunks: 1,
              is_final_chunk: true,
            },
            p_items: [
              {
                payable_id: multiPayId,
                client_id: multiClient.id,
                target_table: "mutual_fund",
                payable_type: "mutual_fund",
                result: "REJECTED",
                actual_amount: 100.0,
                expected_amount: 100.0,
                difference: 0,
                payment_reference: `REJ-${multiTag.slice(-6)}`,
                instruction_id: `INS-REJ-${multiTag.slice(-6)}`,
                match_method: "instruction_id",
                match_confidence: 95,
                source_reference: `SRC-REJ-${multiTag}`,
              },
              {
                payable_id: multiPayId,
                client_id: multiClient.id,
                target_table: "mutual_fund",
                payable_type: "mutual_fund",
                result: "MATCHED",
                actual_amount: 400.0,
                expected_amount: 400.0,
                difference: 0,
                payment_reference: `RECON-${multiTag.slice(-6)}`,
                instruction_id: `INS-MAT-${multiTag.slice(-6)}`,
                match_method: "instruction_id",
                match_confidence: 100,
                source_reference: `SRC-MAT-${multiTag}`,
              },
            ],
            p_batch_info: null,
          },
        );

        expect(multiErr).toBeNull();
        expect(multiRes.success).toBe(true);
        expect(multiRes.payables_updated).toBe(1);
        expect(multiRes.rejected_count).toBe(1);
        expect(multiRes.exceptions_created).toBe(1);

        const multiRunId = multiRes.run_id;

        // Verify the payable is now Partial (400 paid of 500 net)
        const { data: settledPay } = await db
          .from("mutual_fund_payables")
          .select("payment_status, paid_amount, remaining_amount")
          .eq("id", multiPayId)
          .single();
        expect(settledPay!.payment_status).toBe("Partial");
        expect(Number(settledPay!.paid_amount)).toBe(400.0);
        expect(Number(settledPay!.remaining_amount)).toBe(100.0);

        // Verify results recorded the true pre-run baseline (Pending / 0 paid)
        const { data: itemResults } = await db
          .from("reconciliation_results")
          .select("source_reference, prior_payment_status, prior_paid_amount, prior_snapshot")
          .eq("run_id", multiRunId)
          .order("id", { ascending: true });

        expect(itemResults?.length).toBe(2);
        for (const res of itemResults!) {
          expect(res.prior_payment_status).toBe("Pending");
          expect(Number(res.prior_paid_amount)).toBe(0);
          expect((res.prior_snapshot as any).payment_status).toBe("Pending");
          expect(Number((res.prior_snapshot as any).paid_amount)).toBe(0);
        }

        // Now revert the multi-item run
        const { data: revMulti, error: revMultiErr } = await db.rpc(
          "revert_reconciliation_run_atomic",
          {
            p_run_id: multiRunId,
            p_force: true,
          },
        );

        expect(revMultiErr).toBeNull();
        expect(revMulti.success).toBe(true);
        expect(revMulti.reverted_payables).toBe(1);

        // Verify payable is restored to exact initial baseline (Pending / 0 paid, remaining 500)
        const { data: restoredMultiPay } = await db
          .from("mutual_fund_payables")
          .select("payment_status, paid_amount, remaining_amount")
          .eq("id", multiPayId)
          .single();

        expect(restoredMultiPay!.payment_status).toBe("Pending");
        expect(Number(restoredMultiPay!.paid_amount)).toBe(0);
        expect(Number(restoredMultiPay!.remaining_amount)).toBe(500.0);

        // Clean up
        await db.from("reconciliation_exceptions").delete().eq("run_id", multiRunId);
        await db.from("reconciliation_results").delete().eq("run_id", multiRunId);
        await db.from("reconciliation_runs").delete().eq("id", multiRunId);
        await db.from("mutual_fund_payables").delete().eq("id", multiPayId);
        await db.from("clients").delete().eq("id", multiClient.id);
      });

      it("imports bank statement ledger atomically with valid balance and status imported", async () => {
        const importTag = `IMP_${Date.now()}`;
        const opening = 1000.0;
        const credit = 500.0;
        const debit = 200.0;
        const closing = 1300.0; // 1000 + 500 - 200 = 1300

        const { data: impRes, error: impErr } = await db.rpc(
          "import_bank_statement_ledger_atomic",
          {
            p_import_info: {
              company_id: testCompanyId,
              bank_name: "Nabil Bank Ltd",
              account_no: "01234567890123",
              file_name: `Statement_${importTag}.csv`,
              file_hash_sha256: `hash_${importTag}`,
              opening_balance: opening,
              closing_balance: closing,
              total_debit: debit,
              total_credit: credit,
              row_count: 2,
              parser_metadata: { source: "test" },
            },
            p_transactions: [
              {
                transaction_date: "2026-01-10",
                description: "Service Charge",
                debit_amount: 200.0,
                credit_amount: 0.0,
                balance: 800.0,
                transaction_fingerprint: `fp_deb_${importTag}`,
                raw_data: {},
              },
              {
                transaction_date: "2026-01-11",
                description: "Dividend Settlement",
                debit_amount: 0.0,
                credit_amount: 500.0,
                balance: 1300.0,
                transaction_fingerprint: `fp_crd_${importTag}`,
                raw_data: {},
              },
            ],
          },
        );

        expect(impErr).toBeNull();
        expect(impRes.success).toBe(true);
        expect(impRes.inserted_count).toBe(2);
        const importId = impRes.import_id;

        // Verify stored import row matches schema constraints
        const { data: storedImport } = await db
          .from("bank_statement_imports")
          .select("status, bank_name, account_no, opening_balance, closing_balance")
          .eq("id", importId)
          .single();

        expect(storedImport).toBeDefined();
        expect(storedImport!.status).toBe("imported");
        expect(storedImport!.bank_name).toBe("Nabil Bank Ltd");
        expect(storedImport!.account_no).toBe("01234567890123");
        expect(Number(storedImport!.opening_balance)).toBe(1000.0);
        expect(Number(storedImport!.closing_balance)).toBe(1300.0);

        // Clean up
        await db.from("bank_statement_transactions").delete().eq("import_id", importId);
        await db.from("bank_statement_imports").delete().eq("id", importId);
      });

      it("rejects bank statements that violate the balance equation (opening + credit - debit != closing)", async () => {
        const invalidTag = `INV_${Date.now()}`;
        // 1000 + 500 - 200 = 1300 != 9999
        const { error: balanceErr } = await db.rpc("import_bank_statement_ledger_atomic", {
          p_import_info: {
            company_id: testCompanyId,
            bank_name: "Test Bank",
            account_no: "111222333",
            file_name: `Invalid_${invalidTag}.csv`,
            file_hash_sha256: `hash_inv_${invalidTag}`,
            opening_balance: 1000.0,
            closing_balance: 9999.0, // Deliberate mismatch
            total_debit: 200.0,
            total_credit: 500.0,
            row_count: 1,
            parser_metadata: {},
          },
          p_transactions: [
            {
              transaction_date: "2026-01-10",
              debit_amount: 200.0,
              credit_amount: 500.0,
              transaction_fingerprint: `fp_bad_${invalidTag}`,
              raw_data: {},
            },
          ],
        });

        expect(balanceErr).not.toBeNull();
        expect(balanceErr!.message).toContain("balance integrity violation");
      });

      it("rejects chunk retry when chunk content has been altered (SQLSTATE 23514)", async () => {
        const retryTag = `RETRY_${Date.now()}`;
        // Initial chunk 0 submission
        const { data: firstRes, error: firstErr } = await db.rpc(
          "apply_and_record_reconciliation_batch",
          {
            p_run_info: {
              company_id: testCompanyId,
              fiscal_year: "2082/83",
              source_type: "bank_statement",
              file_name: `retry_test_${retryTag}.xlsx`,
              file_hash_sha256: `hash_${retryTag}`,
              idempotency_key: `key_${retryTag}`,
              row_count: 2,
              total_amount: 100.0,
              chunk_index: 0,
              total_chunks: 2,
              is_final_chunk: false,
            },
            p_items: [
              {
                payable_id: testPayableId,
                client_id: testClientId,
                target_table: "mutual_fund",
                payable_type: "mutual_fund",
                result: "MATCHED",
                actual_amount: 50.0,
                expected_amount: 50.0,
                difference: 0,
                payment_reference: `RETRY-1-${retryTag.slice(-6)}`,
                source_reference: `SRC-RETRY-1-${retryTag}`,
              },
            ],
            p_batch_info: null,
          },
        );

        expect(firstErr).toBeNull();
        expect(firstRes.success).toBe(true);
        const retryRunId = firstRes.run_id;

        // Attempt resubmitting chunk 0 with altered items (tampered amount)
        const { error: tamperErr } = await db.rpc("apply_and_record_reconciliation_batch", {
          p_run_info: {
            run_id: retryRunId,
            company_id: testCompanyId,
            fiscal_year: "2082/83",
            source_type: "bank_statement",
            file_name: `retry_test_${retryTag}.xlsx`,
            file_hash_sha256: `hash_${retryTag}`,
            idempotency_key: `key_${retryTag}`,
            row_count: 2,
            total_amount: 100.0,
            chunk_index: 0,
            total_chunks: 2,
            is_final_chunk: false,
          },
          p_items: [
            {
              payable_id: testPayableId,
              client_id: testClientId,
              target_table: "mutual_fund",
              payable_type: "mutual_fund",
              result: "MATCHED",
              actual_amount: 999.0, // Altered payload
              expected_amount: 50.0,
              difference: 0,
              payment_reference: `TAMPER-${retryTag.slice(-6)}`,
              source_reference: `SRC-TAMPER-${retryTag}`,
            },
          ],
          p_batch_info: null,
        });

        expect(tamperErr).not.toBeNull();
        expect(tamperErr!.message).toContain("payload collision");

        // Attempt resubmitting with altered company_id
        const dummyOtherCompanyId = "00000000-0000-0000-0000-000000000001";
        const { error: companyMismatchErr } = await db.rpc(
          "apply_and_record_reconciliation_batch",
          {
            p_run_info: {
              run_id: retryRunId,
              company_id: dummyOtherCompanyId,
              fiscal_year: "2082/83",
              source_type: "bank_statement",
              file_name: `retry_test_${retryTag}.xlsx`,
              file_hash_sha256: `hash_${retryTag}`,
              idempotency_key: `key_${retryTag}`,
              row_count: 2,
              total_amount: 100.0,
              chunk_index: 0,
              total_chunks: 2,
              is_final_chunk: false,
            },
            p_items: [],
            p_batch_info: null,
          },
        );

        expect(companyMismatchErr).not.toBeNull();
        expect(companyMismatchErr!.message).toContain("Run metadata mismatch");

        // Clean up
        await db.from("reconciliation_results").delete().eq("run_id", retryRunId);
        await db.from("reconciliation_runs").delete().eq("id", retryRunId);
      });

      it("allows controlled draft creation via create_reconciliation_draft_run_atomic", async () => {
        const draftTag = `DRAFT_${Date.now()}`;
        const { data: draftRes, error: draftErr } = await db.rpc(
          "create_reconciliation_draft_run_atomic",
          {
            p_run_info: {
              company_id: testCompanyId,
              source_type: "manual",
              file_name: `manual_${draftTag}.csv`,
              row_count: 5,
              total_amount: 2500.0,
              matched_count: 3,
              partial_count: 1,
              rejected_count: 1,
              unmatched_count: 0,
            },
          },
        );

        expect(draftErr).toBeNull();
        expect(draftRes.success).toBe(true);
        expect(draftRes.run_id).toBeDefined();

        const draftRunId = draftRes.run_id;
        const { data: runRow } = await db
          .from("reconciliation_runs")
          .select("status, total_amount, row_count")
          .eq("id", draftRunId)
          .single();

        expect(runRow).toBeDefined();
        expect(runRow!.status).toBe("draft");
        expect(Number(runRow!.total_amount)).toBe(2500.0);
        expect(runRow!.row_count).toBe(5);

        // Clean up
        await db.from("reconciliation_runs").delete().eq("id", draftRunId);
      });

      it("blocks automatic reversal when subsequent payments exist on the payable unless p_force=true", async () => {
        const concTag = `CONC_${Date.now()}`;
        // 1. Create a fresh client and payable
        const { data: concClient } = await db
          .from("clients")
          .insert({
            client_code: `CLI_C_${concTag.slice(-6)}`,
            full_name: `Concurrency Investor ${concTag}`,
            boid: `130123000${concTag.slice(-7)}`,
          })
          .select("id")
          .single();

        const { data: concPayable } = await db
          .from("mutual_fund_payables")
          .insert({
            company_id: testCompanyId,
            client_id: concClient!.id,
            fiscal_year: "2082/83",
            shares_held: 500,
            gross_dividend: 100.0,
            tax_amount: 0.0,
            net_payable: 100.0,
            paid_amount: 0.0,
            remaining_amount: 100.0,
            payment_status: "Pending",
          })
          .select("id")
          .single();

        // 2. Apply reconciliation run
        const { data: applyRes } = await db.rpc("apply_and_record_reconciliation_batch", {
          p_run_info: {
            company_id: testCompanyId,
            fiscal_year: "2082/83",
            source_type: "bank_statement",
            file_name: `conc_${concTag}.xlsx`,
            file_hash_sha256: `hash_conc_${concTag}`,
            idempotency_key: `key_conc_${concTag}`,
            row_count: 1,
            total_amount: 50.0,
            chunk_index: 0,
            total_chunks: 1,
            is_final_chunk: true,
          },
          p_items: [
            {
              payable_id: concPayable!.id,
              client_id: concClient!.id,
              target_table: "mutual_fund",
              payable_type: "mutual_fund",
              result: "REJECTED",
              actual_amount: 50.0,
              expected_amount: 50.0,
              difference: 0,
              payment_reference: `CONC-REJ-${concTag.slice(-6)}`,
              source_reference: `SRC-CONC-${concTag}`,
            },
          ],
          p_batch_info: null,
        });

        const concRunId = applyRes.run_id;

        // 3. Simulate a subsequent payment created AFTER this run
        const { data: subPayment, error: subPayErr } = await db
          .from("payments")
          .insert({
            company_id: testCompanyId,
            client_id: concClient!.id,
            payable_id: concPayable!.id,
            payable_type: "mutual_fund",
            payment_date: "2026-10-15",
            gross_amount: 25.0,
            net_amount: 25.0,
            tax_amount: 0.0,
            status: "Completed",
            payment_reference: `SUBSEQ-PAY-${concTag.slice(-6)}`,
          })
          .select("id")
          .single();

        expect(subPayErr).toBeNull();

        // 4. Attempt automatic revert WITHOUT p_force -> MUST FAIL DUE TO CONCURRENCY CONFLICT
        const { data: noForceRes, error: noForceErr } = await db.rpc(
          "revert_reconciliation_run_atomic",
          {
            p_run_id: concRunId,
            p_force: false,
          },
        );

        expect(noForceErr).not.toBeNull();
        expect(noForceErr!.message).toContain("Concurrency conflict");

        // 5. Revert WITH p_force = true -> MUST SUCCEED
        const { data: forceRes, error: forceErr } = await db.rpc(
          "revert_reconciliation_run_atomic",
          {
            p_run_id: concRunId,
            p_force: true,
          },
        );

        expect(forceErr).toBeNull();
        expect(forceRes.success).toBe(true);

        // Clean up
        await db.from("payments").delete().eq("id", subPayment!.id);
        await db.from("reconciliation_results").delete().eq("run_id", concRunId);
        await db.from("reconciliation_runs").delete().eq("id", concRunId);
        await db.from("mutual_fund_payables").delete().eq("id", concPayable!.id);
        await db.from("clients").delete().eq("id", concClient!.id);
      });

      it("generates isolated run IDs per company during multi-company reconciliation apply", async () => {
        const multiTag = `MC_${Date.now()}`;

        // Create Company A
        const { data: compA } = await db
          .from("companies")
          .insert({
            company_name: `Multi Company A ${multiTag}`,
            company_code: `MA_${multiTag.slice(-5)}`,
            company_type: "Mutual Fund",
            fiscal_year: "2082/83",
          })
          .select("id")
          .single();

        // Create Company B
        const { data: compB } = await db
          .from("companies")
          .insert({
            company_name: `Multi Company B ${multiTag}`,
            company_code: `MB_${multiTag.slice(-5)}`,
            company_type: "Mutual Fund",
            fiscal_year: "2082/83",
          })
          .select("id")
          .single();

        // Create Client & Payable for Company A
        const { data: cliA } = await db
          .from("clients")
          .insert({
            client_code: `CLI_A_${multiTag.slice(-5)}`,
            full_name: `Investor A ${multiTag}`,
            boid: `130123000${multiTag.slice(-7)}1`,
          })
          .select("id")
          .single();

        const { data: payA } = await db
          .from("mutual_fund_payables")
          .insert({
            company_id: compA!.id,
            client_id: cliA!.id,
            fiscal_year: "2082/83",
            shares_held: 100,
            gross_dividend: 50.0,
            tax_amount: 0.0,
            net_payable: 50.0,
            paid_amount: 0.0,
            remaining_amount: 50.0,
            payment_status: "Pending",
          })
          .select("id")
          .single();

        // Create Client & Payable for Company B
        const { data: cliB } = await db
          .from("clients")
          .insert({
            client_code: `CLI_B_${multiTag.slice(-5)}`,
            full_name: `Investor B ${multiTag}`,
            boid: `130123000${multiTag.slice(-7)}2`,
          })
          .select("id")
          .single();

        const { data: payB } = await db
          .from("mutual_fund_payables")
          .insert({
            company_id: compB!.id,
            client_id: cliB!.id,
            fiscal_year: "2082/83",
            shares_held: 200,
            gross_dividend: 100.0,
            tax_amount: 0.0,
            net_payable: 100.0,
            paid_amount: 0.0,
            remaining_amount: 100.0,
            payment_status: "Pending",
          })
          .select("id")
          .single();

        // Apply reconciliation containing records for both companies
        const res = await ReconciliationService.applyReconciliation(
          [
            {
              id: `recon_a_${multiTag}`,
              payable_id: payA!.id,
              company_id: compA!.id,
              client_id: cliA!.id,
              payable_type: "mutual_fund",
              result: "Matched",
              actual_amount: 50.0,
              expected_amount: 50.0,
              difference: 0,
              source_reference: `SRC-A-${multiTag}`,
            } as any,
            {
              id: `recon_b_${multiTag}`,
              payable_id: payB!.id,
              company_id: compB!.id,
              client_id: cliB!.id,
              payable_type: "mutual_fund",
              result: "Matched",
              actual_amount: 100.0,
              expected_amount: 100.0,
              difference: 0,
              source_reference: `SRC-B-${multiTag}`,
            } as any,
          ],
          "ConnectIPS",
          {
            fileName: `multi_company_${multiTag}.xlsx`,
            sourceType: "bank_statement",
            fiscalYear: "2082/83",
          },
        );

        expect(res.errors).toEqual([]);
        expect(res.updated).toBe(2);
        expect(res.runIds).toBeDefined();
        expect(res.runIds!.length).toBe(2);
        expect(res.runIds![0]).not.toBe(res.runIds![1]);

        // Verify each run record is associated with its respective company
        const { data: runA } = await db
          .from("reconciliation_runs")
          .select("id, company_id")
          .eq("id", res.runIds![0])
          .single();

        const { data: runB } = await db
          .from("reconciliation_runs")
          .select("id, company_id")
          .eq("id", res.runIds![1])
          .single();

        const companyIdsInRuns = new Set([runA!.company_id, runB!.company_id]);
        expect(companyIdsInRuns.has(compA!.id)).toBe(true);
        expect(companyIdsInRuns.has(compB!.id)).toBe(true);

        // Clean up
        for (const rid of res.runIds!) {
          await db.from("payments").delete().eq("reconciliation_run_id", rid);
          await db.from("reconciliation_results").delete().eq("run_id", rid);
          await db.from("reconciliation_runs").delete().eq("id", rid);
        }
        await db.from("mutual_fund_payables").delete().eq("id", payA!.id);
        await db.from("mutual_fund_payables").delete().eq("id", payB!.id);
        await db.from("clients").delete().eq("id", cliA!.id);
        await db.from("clients").delete().eq("id", cliB!.id);
        await db.from("companies").delete().eq("id", compA!.id);
        await db.from("companies").delete().eq("id", compB!.id);
      });

      it("enforces that underpayments remain Partial or Exception and require approval before settlement", async () => {
        const underTag = `UND_${Date.now()}`;
        const { data: undClient } = await db
          .from("clients")
          .insert({
            client_code: `CLI_U_${underTag.slice(-6)}`,
            full_name: `Underpay Investor ${underTag}`,
            boid: `130123000${underTag.slice(-7)}`,
          })
          .select("id")
          .single();

        const { data: undPayable } = await db
          .from("mutual_fund_payables")
          .insert({
            company_id: testCompanyId,
            client_id: undClient!.id,
            fiscal_year: "2082/83",
            shares_held: 1000,
            gross_dividend: 500.0,
            tax_amount: 0.0,
            net_payable: 500.0,
            paid_amount: 0.0,
            remaining_amount: 500.0,
            payment_status: "Pending",
          })
          .select("id")
          .single();

        // 1. Unapproved UNDER_PAID: should NOT mutate payable, must flag requires_manual_approval and create exception
        const { data: unapprovedRes, error: unapprovedErr } = await db.rpc(
          "apply_and_record_reconciliation_batch",
          {
            p_run_info: {
              company_id: testCompanyId,
              fiscal_year: "2082/83",
              source_type: "bank_statement",
              file_name: `underpay_${underTag}.xlsx`,
              file_hash_sha256: `hash_under_${underTag}`,
              idempotency_key: `key_under_${underTag}`,
              row_count: 1,
              total_amount: 200.0,
              chunk_index: 0,
              total_chunks: 1,
              is_final_chunk: true,
            },
            p_items: [
              {
                payable_id: undPayable!.id,
                client_id: undClient!.id,
                target_table: "mutual_fund",
                payable_type: "mutual_fund",
                result: "UNDER_PAID",
                actual_amount: 200.0,
                expected_amount: 500.0,
                difference: -300.0,
                payment_reference: `UND-REF-1-${underTag.slice(-6)}`,
                source_reference: `SRC-UND-1-${underTag}`,
                approved: false, // Not approved
              },
            ],
            p_batch_info: null,
          },
        );

        expect(unapprovedErr).toBeNull();
        expect(unapprovedRes.success).toBe(true);
        expect(unapprovedRes.payables_updated).toBe(0); // NOT mutated
        expect(unapprovedRes.exceptions_created).toBe(1); // Exception logged

        // Verify payable remained Pending / 0 paid
        const { data: payableUnchanged } = await db
          .from("mutual_fund_payables")
          .select("payment_status, paid_amount, remaining_amount")
          .eq("id", undPayable!.id)
          .single();
        expect(payableUnchanged!.payment_status).toBe("Pending");
        expect(Number(payableUnchanged!.paid_amount)).toBe(0.0);

        // 2. Approved UNDER_PAID: when supervisor approves via maker-checker RPC, must settle as 'Partial' (NEVER 'Paid')
        const { data: dftRun } = await db.rpc("create_reconciliation_draft_run_atomic", {
          p_run_info: {
            company_id: testCompanyId,
            source_type: "bank_statement",
            file_name: `underpay_app_${underTag}.xlsx`,
            file_hash_sha256: `hash_under_app_${underTag}`,
            row_count: 1,
            total_amount: 200.0,
          },
        });

        // Persist draft reconciliation result row so approval derives values server-side
        await db.rpc("save_reconciliation_draft_results_atomic", {
          p_run_info: {
            run_id: dftRun.run_id,
            company_id: testCompanyId,
            source_type: "bank_statement",
            file_name: `underpay_app_${underTag}.xlsx`,
            file_hash_sha256: `hash_under_app_${underTag}`,
            row_count: 1,
            total_amount: 200.0,
          },
          p_results: [
            {
              payable_id: undPayable!.id,
              client_id: undClient!.id,
              payable_type: "mutual_fund_payables",
              result: "UNDER_PAID",
              actual_amount: 200.0,
              expected_amount: 500.0,
              difference: -300.0,
              source_reference: `SRC-UND-2-${underTag}`,
            },
          ],
        });

        const { error: appErr } = await db.rpc("approve_reconciliation_variance_atomic", {
          p_approval_info: {
            run_id: dftRun.run_id,
            payable_id: undPayable!.id,
            source_reference: `SRC-UND-2-${underTag}`,
            maker_id: "00000000-0000-0000-0000-000000000001",
            approved_by: "00000000-0000-0000-0000-000000000002",
            approval_reason: "Supervisor approved underpayment for partial settlement",
          },
        });
        expect(appErr).toBeNull();

        const { data: approvedRes, error: approvedErr } = await db.rpc(
          "apply_and_record_reconciliation_batch",
          {
            p_run_info: {
              run_id: dftRun.run_id,
              company_id: testCompanyId,
              fiscal_year: "2082/83",
              source_type: "bank_statement",
              file_name: `underpay_app_${underTag}.xlsx`,
              file_hash_sha256: `hash_under_app_${underTag}`,
              idempotency_key: `key_under_app_${underTag}`,
              row_count: 1,
              total_amount: 200.0,
              chunk_index: 0,
              total_chunks: 1,
              is_final_chunk: true,
            },
            p_items: [
              {
                payable_id: undPayable!.id,
                client_id: undClient!.id,
                target_table: "mutual_fund",
                payable_type: "mutual_fund",
                result: "UNDER_PAID",
                actual_amount: 200.0,
                expected_amount: 500.0,
                difference: -300.0,
                payment_reference: `UND-REF-2-${underTag.slice(-6)}`,
                source_reference: `SRC-UND-2-${underTag}`,
              },
            ],
            p_batch_info: null,
          },
        );

        expect(approvedErr).toBeNull();
        expect(approvedRes.success).toBe(true);
        expect(approvedRes.payables_updated).toBe(1);

        // Verify payable is marked Partial (NOT Paid) with exactly 200 paid and 300 remaining
        const { data: payableSettledPartial } = await db
          .from("mutual_fund_payables")
          .select("payment_status, paid_amount, remaining_amount")
          .eq("id", undPayable!.id)
          .single();
        expect(payableSettledPartial!.payment_status).toBe("Partial");
        expect(Number(payableSettledPartial!.paid_amount)).toBe(200.0);
        expect(Number(payableSettledPartial!.remaining_amount)).toBe(300.0);

        // Clean up
        await db.from("payments").delete().eq("reconciliation_run_id", approvedRes.run_id);
        await db.from("reconciliation_results").delete().eq("run_id", approvedRes.run_id);
        await db.from("reconciliation_runs").delete().eq("id", approvedRes.run_id);
        await db.from("reconciliation_exceptions").delete().eq("run_id", unapprovedRes.run_id);
        await db.from("reconciliation_results").delete().eq("run_id", unapprovedRes.run_id);
        await db.from("reconciliation_runs").delete().eq("id", unapprovedRes.run_id);
        await db.from("mutual_fund_payables").delete().eq("id", undPayable!.id);
        await db.from("clients").delete().eq("id", undClient!.id);
      });

      it("rejects chunk retry when changed chunk count is submitted (SQLSTATE 23514)", async () => {
        const chunkTag = `CHK_${Date.now()}`;
        // Submit chunk 0 with total_chunks = 3
        const { data: initialChunk, error: initialErr } = await db.rpc(
          "apply_and_record_reconciliation_batch",
          {
            p_run_info: {
              company_id: testCompanyId,
              fiscal_year: "2082/83",
              source_type: "bank_statement",
              file_name: `chunk_test_${chunkTag}.xlsx`,
              file_hash_sha256: `hash_${chunkTag}`,
              idempotency_key: `key_${chunkTag}`,
              row_count: 3,
              total_amount: 30.0,
              chunk_index: 0,
              total_chunks: 3,
              is_final_chunk: false,
            },
            p_items: [
              {
                payable_id: testPayableId,
                client_id: testClientId,
                target_table: "mutual_fund",
                payable_type: "mutual_fund",
                result: "MATCHED",
                actual_amount: 10.0,
                expected_amount: 10.0,
                difference: 0,
                payment_reference: `CHK-1-${chunkTag.slice(-6)}`,
                source_reference: `SRC-CHK-1-${chunkTag}`,
              },
            ],
            p_batch_info: null,
          },
        );

        expect(initialErr).toBeNull();
        expect(initialChunk.success).toBe(true);
        const chunkRunId = initialChunk.run_id;

        // Submit chunk 1 to same run_id but with total_chunks = 5 (divergent chunk count)
        const { error: divergentErr } = await db.rpc("apply_and_record_reconciliation_batch", {
          p_run_info: {
            run_id: chunkRunId,
            company_id: testCompanyId,
            fiscal_year: "2082/83",
            source_type: "bank_statement",
            file_name: `chunk_test_${chunkTag}.xlsx`,
            file_hash_sha256: `hash_${chunkTag}`,
            idempotency_key: `key_${chunkTag}`,
            row_count: 3,
            total_amount: 30.0,
            chunk_index: 1,
            total_chunks: 5, // Deliberately altered from 3
            is_final_chunk: false,
          },
          p_items: [
            {
              payable_id: testPayableId,
              client_id: testClientId,
              target_table: "mutual_fund",
              payable_type: "mutual_fund",
              result: "MATCHED",
              actual_amount: 10.0,
              expected_amount: 10.0,
              difference: 0,
              payment_reference: `CHK-2-${chunkTag.slice(-6)}`,
              source_reference: `SRC-CHK-2-${chunkTag}`,
            },
          ],
          p_batch_info: null,
        });

        expect(divergentErr).not.toBeNull();
        expect(divergentErr!.message).toContain(
          "total_chunks 5 does not match expected_chunk_count 3",
        );

        // Clean up
        await db.from("reconciliation_results").delete().eq("run_id", chunkRunId);
        await db.from("reconciliation_runs").delete().eq("id", chunkRunId);
      });

      it("detects duplicate source rows before mutation and causes no second financial mutation", async () => {
        const dupRowTag = `DUP_ROW_${Date.now()}`;
        const { data: dupClient } = await db
          .from("clients")
          .insert({
            client_code: `CLI_D_${dupRowTag.slice(-6)}`,
            full_name: `DupRow Investor ${dupRowTag}`,
            boid: `130123000${dupRowTag.slice(-7)}`,
          })
          .select("id")
          .single();

        const { data: dupPayable } = await db
          .from("mutual_fund_payables")
          .insert({
            company_id: testCompanyId,
            client_id: dupClient!.id,
            fiscal_year: "2082/83",
            shares_held: 1000,
            gross_dividend: 500.0,
            tax_amount: 0.0,
            net_payable: 500.0,
            paid_amount: 0.0,
            remaining_amount: 500.0,
            payment_status: "Pending",
          })
          .select("id")
          .single();

        // Submit a batch where two items share the identical source_reference
        const sharedSourceRef = `SHARED-SRC-${dupRowTag}`;
        const { data: batchRes, error: batchErr } = await db.rpc(
          "apply_and_record_reconciliation_batch",
          {
            p_run_info: {
              company_id: testCompanyId,
              fiscal_year: "2082/83",
              source_type: "bank_statement",
              file_name: `dup_source_${dupRowTag}.xlsx`,
              file_hash_sha256: `hash_dup_src_${dupRowTag}`,
              idempotency_key: `key_dup_src_${dupRowTag}`,
              row_count: 2,
              total_amount: 200.0,
              chunk_index: 0,
              total_chunks: 1,
              is_final_chunk: true,
            },
            p_items: [
              {
                payable_id: dupPayable!.id,
                client_id: dupClient!.id,
                target_table: "mutual_fund",
                payable_type: "mutual_fund",
                result: "MATCHED",
                actual_amount: 100.0,
                expected_amount: 500.0,
                difference: -400.0,
                payment_reference: `PAY-1-${dupRowTag.slice(-6)}`,
                source_reference: sharedSourceRef,
              },
              {
                payable_id: dupPayable!.id,
                client_id: dupClient!.id,
                target_table: "mutual_fund",
                payable_type: "mutual_fund",
                result: "MATCHED",
                actual_amount: 100.0,
                expected_amount: 500.0,
                difference: -400.0,
                payment_reference: `PAY-2-${dupRowTag.slice(-6)}`,
                source_reference: sharedSourceRef, // Identical duplicate source reference
              },
            ],
            p_batch_info: null,
          },
        );

        expect(batchErr).toBeNull();
        expect(batchRes.success).toBe(true);
        expect(batchRes.payables_updated).toBe(1); // Only ONE update executed
        expect(batchRes.exceptions_created).toBe(1); // Duplicate row logged as exception

        // Verify financial mutation occurred only ONCE: paid_amount is 100.00, NOT 200.00!
        const { data: payableAfterDup } = await db
          .from("mutual_fund_payables")
          .select("paid_amount, remaining_amount")
          .eq("id", dupPayable!.id)
          .single();

        expect(Number(payableAfterDup!.paid_amount)).toBe(100.0);
        expect(Number(payableAfterDup!.remaining_amount)).toBe(400.0);

        // Clean up
        await db.from("payments").delete().eq("reconciliation_run_id", batchRes.run_id);
        await db.from("reconciliation_exceptions").delete().eq("run_id", batchRes.run_id);
        await db.from("reconciliation_results").delete().eq("run_id", batchRes.run_id);
        await db.from("reconciliation_runs").delete().eq("id", batchRes.run_id);
        await db.from("mutual_fund_payables").delete().eq("id", dupPayable!.id);
        await db.from("clients").delete().eq("id", dupClient!.id);
      });

      it("allows rejected bank imports to be cleanly retried and reset to imported", async () => {
        const retryTag = `REJ_RETRY_${Date.now()}`;
        const fileHash = `hash_rej_${retryTag}`;

        // 1. Initial bank import
        const { data: imp1, error: err1 } = await db.rpc("import_bank_statement_ledger_atomic", {
          p_import_info: {
            company_id: testCompanyId,
            bank_name: "Test Bank",
            account_no: "12345",
            file_name: `file_${retryTag}.csv`,
            file_hash_sha256: fileHash,
            opening_balance: 1000.0,
            closing_balance: 1200.0,
            total_debit: 0.0,
            total_credit: 200.0,
            row_count: 1,
            parser_metadata: {},
          },
          p_transactions: [
            {
              transaction_date: "2026-02-01",
              credit_amount: 200.0,
              debit_amount: 0.0,
              transaction_fingerprint: `fp_1_${retryTag}`,
              raw_data: {},
            },
          ],
        });

        expect(err1).toBeNull();
        expect(imp1.success).toBe(true);
        const importId = imp1.import_id;

        // 2. Mark import record as rejected (simulating processing/validation failure)
        await db
          .from("bank_statement_imports")
          .update({ status: "rejected", parser_metadata: { error: "Processing failed" } })
          .eq("id", importId);

        // 3. Retry import of the exact same file (same file_hash_sha256)
        const { data: retryRes, error: retryErr } = await db.rpc(
          "import_bank_statement_ledger_atomic",
          {
            p_import_info: {
              company_id: testCompanyId,
              bank_name: "Test Bank Corrected",
              account_no: "12345",
              file_name: `file_${retryTag}.csv`,
              file_hash_sha256: fileHash,
              opening_balance: 1000.0,
              closing_balance: 1200.0,
              total_debit: 0.0,
              total_credit: 200.0,
              row_count: 1,
              parser_metadata: { retry: true },
            },
            p_transactions: [
              {
                transaction_date: "2026-02-01",
                credit_amount: 200.0,
                debit_amount: 0.0,
                transaction_fingerprint: `fp_1_retry_${retryTag}`,
                raw_data: {},
              },
            ],
          },
        );

        // Must succeed without unique constraint collision
        expect(retryErr).toBeNull();
        expect(retryRes.success).toBe(true);
        expect(retryRes.import_id).toBe(importId);

        // Verify status was reset to 'imported' and metadata was updated
        const { data: updatedImport } = await db
          .from("bank_statement_imports")
          .select("status, bank_name")
          .eq("id", importId)
          .single();

        expect(updatedImport!.status).toBe("imported");
        expect(updatedImport!.bank_name).toBe("Test Bank Corrected");

        // Clean up
        await db.from("bank_statement_transactions").delete().eq("import_id", importId);
        await db.from("bank_statement_imports").delete().eq("id", importId);
      });

      it("blocks automatic reversal when the payable has been modified after reconciliation", async () => {
        const postTag = `POST_${Date.now()}`;
        const { data: postClient } = await db
          .from("clients")
          .insert({
            client_code: `CLI_P_${postTag.slice(-6)}`,
            full_name: `Post State Investor ${postTag}`,
            boid: `130123000${postTag.slice(-7)}`,
          })
          .select("id")
          .single();

        const { data: postPayable } = await db
          .from("mutual_fund_payables")
          .insert({
            company_id: testCompanyId,
            client_id: postClient!.id,
            fiscal_year: "2082/83",
            shares_held: 500,
            gross_dividend: 150.0,
            tax_amount: 0.0,
            net_payable: 150.0,
            paid_amount: 0.0,
            remaining_amount: 150.0,
            payment_status: "Pending",
          })
          .select("id")
          .single();

        // 1. Apply reconciliation run
        const { data: postApply } = await db.rpc("apply_and_record_reconciliation_batch", {
          p_run_info: {
            company_id: testCompanyId,
            fiscal_year: "2082/83",
            source_type: "bank_statement",
            file_name: `post_mod_${postTag}.xlsx`,
            file_hash_sha256: `hash_post_${postTag}`,
            idempotency_key: `key_post_${postTag}`,
            row_count: 1,
            total_amount: 150.0,
            chunk_index: 0,
            total_chunks: 1,
            is_final_chunk: true,
          },
          p_items: [
            {
              payable_id: postPayable!.id,
              client_id: postClient!.id,
              target_table: "mutual_fund",
              payable_type: "mutual_fund",
              result: "MATCHED",
              actual_amount: 150.0,
              expected_amount: 150.0,
              difference: 0,
              payment_reference: `POST-REF-${postTag.slice(-6)}`,
              source_reference: `SRC-POST-${postTag}`,
            },
          ],
          p_batch_info: null,
        });

        const postRunId = postApply.run_id;

        // 2. Simulate subsequent independent mutation on the payable record
        await db
          .from("mutual_fund_payables")
          .update({
            remarks: "Independent post-reconciliation ledger adjustment",
            updated_at: new Date(Date.now() + 10000).toISOString(),
          })
          .eq("id", postPayable!.id);

        // 3. Attempt reversal WITHOUT p_force -> MUST FAIL
        const { error: postRevertErr } = await db.rpc("revert_reconciliation_run_atomic", {
          p_run_id: postRunId,
          p_force: false,
        });

        expect(postRevertErr).not.toBeNull();
        expect(postRevertErr!.message).toContain("Concurrency conflict: payable");
        expect(postRevertErr!.message).toContain("modified after reconciliation was applied");

        // 4. Reversal WITH p_force = true -> SUCCEEDS
        const { data: forcedRevert, error: forcedErr } = await db.rpc(
          "revert_reconciliation_run_atomic",
          {
            p_run_id: postRunId,
            p_force: true,
          },
        );

        expect(forcedErr).toBeNull();
        expect(forcedRevert.success).toBe(true);

        // Clean up
        await db.from("reconciliation_results").delete().eq("run_id", postRunId);
        await db.from("reconciliation_runs").delete().eq("id", postRunId);
        await db.from("mutual_fund_payables").delete().eq("id", postPayable!.id);
        await db.from("clients").delete().eq("id", postClient!.id);
      });

      it("enforces server-side maker-checker policy and variance limits for reconciliation approvals", async () => {
        const mcTag = `MC_${Date.now()}`;
        const { data: mcClient } = await db
          .from("clients")
          .insert({
            client_code: `CLI_MC_${mcTag.slice(-6)}`,
            full_name: `Maker Checker Investor ${mcTag}`,
            boid: `130123000${mcTag.slice(-7)}`,
          })
          .select("id")
          .single();

        const { data: mcPayable } = await db
          .from("dividend_payables")
          .insert({
            company_id: testCompanyId,
            client_id: mcClient!.id,
            fiscal_year: "2082/83",
            gross_dividend: 100000.0,
            tax_amount: 5000.0,
            net_payable: 95000.0,
            paid_amount: 0.0,
            payment_status: "Pending",
          })
          .select("id")
          .single();

        // 1. Create a draft run by Maker (admin user)
        const { data: draftRun } = await db.rpc("create_reconciliation_draft_run_atomic", {
          p_run_info: {
            company_id: testCompanyId,
            source_type: "excel",
            file_name: `mc_recon_${mcTag}.xlsx`,
            file_hash_sha256: `hash_mc_${mcTag}`,
            row_count: 1,
            total_amount: 30000.0,
          },
        });

        const runId = draftRun.run_id;

        // Fetch current user ID (maker)
        const { data: authData } = await supabase.auth.getUser();
        const currentUid = authData.user!.id;

        // Persist draft result row so variance approval is anchored to stored server results
        await db.rpc("save_reconciliation_draft_results_atomic", {
          p_run_info: {
            run_id: runId,
            company_id: testCompanyId,
            source_type: "excel",
            file_name: `mc_recon_${mcTag}.xlsx`,
            file_hash_sha256: `hash_mc_${mcTag}`,
            row_count: 1,
            total_amount: 30000.0,
          },
          p_results: [
            {
              payable_id: mcPayable!.id,
              client_id: mcClient!.id,
              payable_type: "dividend_payables",
              result: "UNDER_PAID",
              actual_amount: 30000.0,
              expected_amount: 95000.0,
              difference: -65000.0,
              source_reference: `REF-MC-${mcTag}`,
            },
          ],
        });

        // 2. Maker attempts to approve their own variance -> MUST FAIL (Maker-Checker violation)
        const { error: selfApproveErr } = await db.rpc("approve_reconciliation_variance_atomic", {
          p_approval_info: {
            run_id: runId,
            payable_id: mcPayable!.id,
            source_reference: `REF-MC-${mcTag}`,
            maker_id: currentUid, // Same as approver
            approved_by: currentUid,
            approval_reason: "Self approval attempt by maker",
          },
        });

        expect(selfApproveErr).not.toBeNull();
        expect(selfApproveErr!.message).toContain("Maker-checker policy violation");

        // 3. Approval with reason < 5 characters -> MUST FAIL
        const { error: reasonErr } = await db.rpc("approve_reconciliation_variance_atomic", {
          p_approval_info: {
            run_id: runId,
            payable_id: mcPayable!.id,
            source_reference: `REF-MC-${mcTag}`,
            variance_type: "UNDER_PAID",
            expected_amount: 95000.0,
            actual_amount: 30000.0,
            maker_id: "00000000-0000-0000-0000-000000000001",
            approved_by: currentUid,
            approval_reason: "ok",
          },
        });

        expect(reasonErr).not.toBeNull();
        expect(reasonErr!.message).toContain(
          "Detailed approval reason of at least 5 characters is mandatory",
        );

        // 4. Legitimate maker-checker approval with distinct supervisor/admin -> SUCCEEDS
        const { data: validApproval, error: validApproveErr } = await db.rpc(
          "approve_reconciliation_variance_atomic",
          {
            p_approval_info: {
              run_id: runId,
              payable_id: mcPayable!.id,
              payable_type: "dividend_payables",
              source_reference: `REF-MC-${mcTag}`,
              variance_type: "UNDER_PAID",
              expected_amount: 95000.0,
              actual_amount: 30000.0,
              maker_id: "00000000-0000-0000-0000-000000000001", // Different maker
              approved_by: currentUid,
              approval_reason: "Authorized partial payout under special resolution 4B",
            },
          },
        );

        expect(validApproveErr).toBeNull();
        expect(validApproval.success).toBe(true);

        // 5. Apply batch with verified server approval -> settles as Partial
        const { data: applyRes, error: applyErr } = await db.rpc(
          "apply_and_record_reconciliation_batch",
          {
            p_run_info: {
              run_id: runId,
              company_id: testCompanyId,
              fiscal_year: "2082/83",
              source_type: "excel",
              file_name: `mc_recon_${mcTag}.xlsx`,
              file_hash_sha256: `hash_mc_${mcTag}`,
              idempotency_key: `key_mc_${mcTag}`,
              row_count: 1,
              total_amount: 30000.0,
              chunk_index: 0,
              total_chunks: 1,
              is_final_chunk: true,
            },
            p_items: [
              {
                payable_id: mcPayable!.id,
                client_id: mcClient!.id,
                target_table: "dividend",
                payable_type: "dividend",
                result: "UNDER_PAID",
                actual_amount: 30000.0,
                expected_amount: 95000.0,
                difference: -65000.0,
                payment_reference: `PAY-MC-${mcTag}`,
                source_reference: `REF-MC-${mcTag}`,
              },
            ],
            p_batch_info: null,
          },
        );

        expect(applyErr).toBeNull();
        expect(applyRes.payables_updated).toBe(1);

        // Verify payable is marked Partial
        const { data: updatedPayable } = await db
          .from("dividend_payables")
          .select("payment_status, paid_amount, remaining_amount")
          .eq("id", mcPayable!.id)
          .single();

        expect(updatedPayable!.payment_status).toBe("Partial");
        expect(Number(updatedPayable!.paid_amount)).toBe(30000.0);
        expect(Number(updatedPayable!.remaining_amount)).toBe(70000.0);

        // Clean up
        await db.from("reconciliation_variance_approvals").delete().eq("run_id", applyRes.run_id);
        await db.from("payments").delete().eq("reconciliation_run_id", applyRes.run_id);
        await db.from("reconciliation_results").delete().eq("run_id", applyRes.run_id);
        await db.from("reconciliation_runs").delete().eq("id", applyRes.run_id);
        await db.from("reconciliation_runs").delete().eq("id", runId);
        await db.from("dividend_payables").delete().eq("id", mcPayable!.id);
        await db.from("clients").delete().eq("id", mcClient!.id);
      });

      it("quarantines duplicate bank statement transactions as explicit exceptions without silent drops", async () => {
        const dupTag = `DUP_${Date.now()}`;
        const dupHash = `hash_dup_bank_${dupTag}`;

        // 1. Submit bank import containing 3 items where 2 have identical transaction fingerprints
        const { data: impRes, error: impErr } = await db.rpc(
          "import_bank_statement_ledger_atomic",
          {
            p_import_info: {
              company_id: testCompanyId,
              bank_name: "Nepal Bank Ltd",
              account_no: `NBL-${dupTag.slice(-6)}`,
              file_name: `bank_stmt_${dupTag}.xlsx`,
              file_hash_sha256: dupHash,
              opening_balance: 0,
              closing_balance: 0,
              total_debit: 0,
              total_credit: 300.0,
              row_count: 3,
            },
            p_transactions: [
              {
                transaction_date: "2026-10-05",
                description: "Dividend payout 1",
                reference: `TXN-DUP-${dupTag}-01`,
                credit_amount: 100.0,
                debit_amount: 0,
                transaction_fingerprint: `fp_dup_1_${dupTag}`,
              },
              {
                transaction_date: "2026-10-05",
                description: "Dividend payout 2",
                reference: `TXN-DUP-${dupTag}-02`,
                credit_amount: 100.0,
                debit_amount: 0,
                transaction_fingerprint: `fp_dup_2_${dupTag}`,
              },
              {
                // Duplicate fingerprint matching transaction 1
                transaction_date: "2026-10-05",
                description: "Dividend payout 1 Duplicate",
                reference: `TXN-DUP-${dupTag}-01-RETRY`,
                credit_amount: 100.0,
                debit_amount: 0,
                transaction_fingerprint: `fp_dup_1_${dupTag}`,
              },
            ],
          },
        );

        expect(impErr).toBeNull();
        expect(impRes.success).toBe(true);
        expect(impRes.inserted_count).toBe(2);
        expect(impRes.duplicate_count).toBe(1);
        expect(impRes.total_rows).toBe(3);

        // Verify explicit exception was logged in reconciliation_exceptions
        const { data: exceptions } = await db
          .from("reconciliation_exceptions")
          .select("exception_reason, source_reference, amount")
          .eq("company_id", testCompanyId)
          .ilike(
            "exception_reason",
            `%Duplicate bank statement transaction fingerprint (fp_dup_1_${dupTag})%`,
          );

        expect(exceptions).not.toBeNull();
        expect(exceptions!.length).toBeGreaterThanOrEqual(1);

        // Clean up
        await db
          .from("reconciliation_exceptions")
          .delete()
          .eq("company_id", testCompanyId)
          .ilike("exception_reason", `%${dupTag}%`);
        await db.from("bank_statement_transactions").delete().eq("import_id", impRes.import_id);
        await db.from("bank_statement_imports").delete().eq("id", impRes.import_id);
      });

      it("transitions bank statement transactions and imports to reconciled and resets them on reversal", async () => {
        const lcTag = `LC_${Date.now()}`;
        const lcHash = `hash_lc_${lcTag}`;
        const lcRef = `TXN-LC-${lcTag}`;

        // 1. Ingest bank statement import
        const { data: impData } = await db.rpc("import_bank_statement_ledger_atomic", {
          p_import_info: {
            company_id: testCompanyId,
            bank_name: "Rastriya Banijya Bank",
            account_no: `RBB-${lcTag.slice(-6)}`,
            file_name: `lifecycle_${lcTag}.xlsx`,
            file_hash_sha256: lcHash,
            opening_balance: 0,
            closing_balance: 0,
            total_debit: 0,
            total_credit: 500.0,
            row_count: 1,
          },
          p_transactions: [
            {
              transaction_date: "2026-10-05",
              description: "Dividend direct settlement",
              reference: lcRef,
              credit_amount: 500.0,
              debit_amount: 0,
              transaction_fingerprint: `fp_lc_${lcTag}`,
            },
          ],
        });

        const importId = impData.import_id;

        // Check import initial status
        const { data: impInitial } = await db
          .from("bank_statement_imports")
          .select("status")
          .eq("id", importId)
          .single();
        expect(impInitial!.status).toBe("imported");

        // Create client and payable
        const { data: lcClient } = await db
          .from("clients")
          .insert({
            client_code: `CLI_LC_${lcTag.slice(-6)}`,
            full_name: `Lifecycle Investor ${lcTag}`,
            boid: `130123000${lcTag.slice(-7)}`,
          })
          .select("id")
          .single();

        const { data: lcPayable } = await db
          .from("dividend_payables")
          .insert({
            company_id: testCompanyId,
            client_id: lcClient!.id,
            fiscal_year: "2082/83",
            gross_dividend: 500.0,
            tax_amount: 0,
            net_payable: 500.0,
            paid_amount: 0,
            payment_status: "Pending",
          })
          .select("id")
          .single();

        // 2. Apply reconciliation run referencing this transaction
        const { data: lcApply } = await db.rpc("apply_and_record_reconciliation_batch", {
          p_run_info: {
            company_id: testCompanyId,
            fiscal_year: "2082/83",
            source_type: "bank_statement",
            file_name: `lifecycle_${lcTag}.xlsx`,
            file_hash_sha256: lcHash,
            idempotency_key: `key_lc_${lcTag}`,
            row_count: 1,
            total_amount: 500.0,
            chunk_index: 0,
            total_chunks: 1,
            is_final_chunk: true,
          },
          p_items: [
            {
              payable_id: lcPayable!.id,
              client_id: lcClient!.id,
              target_table: "dividend",
              payable_type: "dividend",
              result: "MATCHED",
              actual_amount: 500.0,
              expected_amount: 500.0,
              difference: 0,
              payment_reference: `PAY-LC-${lcTag}`,
              source_reference: lcRef,
            },
          ],
          p_batch_info: null,
        });

        const reconRunId = lcApply.run_id;

        // 3. Verify bank transaction is reconciled and linked to run_id
        const { data: bstReconciled } = await db
          .from("bank_statement_transactions")
          .select("reconciliation_status, reconciliation_run_id")
          .eq("import_id", importId)
          .single();

        expect(bstReconciled!.reconciliation_status).toBe("reconciled");
        expect(bstReconciled!.reconciliation_run_id).toBe(reconRunId);

        // 4. Verify bank statement import status transitioned to reconciled
        const { data: impReconciled } = await db
          .from("bank_statement_imports")
          .select("status")
          .eq("id", importId)
          .single();

        expect(impReconciled!.status).toBe("reconciled");

        // 5. Revert the reconciliation run
        const { data: revertRes, error: revErr } = await db.rpc(
          "revert_reconciliation_run_atomic",
          {
            p_run_id: reconRunId,
            p_force: false,
          },
        );

        expect(revErr).toBeNull();
        expect(revertRes.success).toBe(true);

        // 6. Verify bank transaction reset to unreconciled and unlinked
        const { data: bstReverted } = await db
          .from("bank_statement_transactions")
          .select("reconciliation_status, reconciliation_run_id")
          .eq("import_id", importId)
          .single();

        expect(bstReverted!.reconciliation_status).toBe("unreconciled");
        expect(bstReverted!.reconciliation_run_id).toBeNull();

        // 7. Verify import reset back to imported
        const { data: impReverted } = await db
          .from("bank_statement_imports")
          .select("status")
          .eq("id", importId)
          .single();

        expect(impReverted!.status).toBe("imported");

        // Clean up
        await db.from("reconciliation_results").delete().eq("run_id", reconRunId);
        await db.from("reconciliation_runs").delete().eq("id", reconRunId);
        await db.from("dividend_payables").delete().eq("id", lcPayable!.id);
        await db.from("clients").delete().eq("id", lcClient!.id);
        await db.from("bank_statement_transactions").delete().eq("import_id", importId);
        await db.from("bank_statement_imports").delete().eq("id", importId);
      });

      it("persists draft reconciliation batches atomically via save_reconciliation_draft_results_atomic", async () => {
        const draftTag = `DFT_${Date.now()}`;

        const { data: dftRes, error: dftErr } = await db.rpc(
          "save_reconciliation_draft_results_atomic",
          {
            p_run_info: {
              company_id: testCompanyId,
              fiscal_year: "2082/83",
              source_type: "manual",
              file_name: `draft_${draftTag}.xlsx`,
              file_hash_sha256: `hash_draft_${draftTag}`,
              row_count: 2,
              total_amount: 1200.0,
            },
            p_results: [
              {
                reconciliation_date: "2026-10-05",
                source_reference: `REF-DFT-${draftTag}-1`,
                expected_amount: 600.0,
                actual_amount: 600.0,
                result: "MATCHED",
                notes: "Draft item 1",
              },
              {
                reconciliation_date: "2026-10-05",
                source_reference: `REF-DFT-${draftTag}-2`,
                expected_amount: 600.0,
                actual_amount: 600.0,
                result: "MATCHED",
                notes: "Draft item 2",
              },
            ],
          },
        );

        expect(dftErr).toBeNull();
        expect(dftRes.success).toBe(true);
        expect(dftRes.saved_count).toBe(2);

        // Verify draft run exists in draft status
        const { data: dftRun } = await db
          .from("reconciliation_runs")
          .select("status, row_count, total_amount")
          .eq("id", dftRes.run_id)
          .single();

        expect(dftRun!.status).toBe("draft");
        expect(dftRun!.row_count).toBe(2);

        // Clean up
        await db.from("reconciliation_results").delete().eq("run_id", dftRes.run_id);
        await db.from("reconciliation_runs").delete().eq("id", dftRes.run_id);
      });

      it("strictly rejects null company_id during bank statement ingestion at database level", async () => {
        const nullTag = `NULL_${Date.now()}`;
        const { error: nullCompErr } = await db.rpc("import_bank_statement_ledger_atomic", {
          p_import_info: {
            company_id: null,
            bank_name: "Null Bank",
            account_no: "NULL_ACCT",
            file_name: `null_stmt_${nullTag}.xlsx`,
            file_hash_sha256: `hash_null_${nullTag}`,
            row_count: 1,
          },
          p_transactions: [
            {
              transaction_date: "2026-10-05",
              description: "Null company item",
              reference: `TXN-NULL-${nullTag}`,
              credit_amount: 100.0,
              debit_amount: 0,
            },
          ],
        });

        expect(nullCompErr).not.toBeNull();
        expect(nullCompErr!.code).toBe("23502"); // NOT NULL violation
      });

      it("rejects forged approval amounts or payable identity when attempting to approve reconciliation variance", async () => {
        const forgeTag = `FORGE_${Date.now()}`;
        const { data: forgeClient } = await db
          .from("clients")
          .insert({
            client_code: `CLI_FG_${forgeTag.slice(-6)}`,
            full_name: `Forge Investor ${forgeTag}`,
            boid: `130123000${forgeTag.slice(-7)}`,
          })
          .select("id")
          .single();

        const { data: forgePayable } = await db
          .from("mutual_fund_payables")
          .insert({
            company_id: testCompanyId,
            client_id: forgeClient!.id,
            fiscal_year: "2082/83",
            gross_dividend: 500.0,
            tax_amount: 0.0,
            net_payable: 500.0,
            paid_amount: 0.0,
            payment_status: "Pending",
          })
          .select("id")
          .single();

        const { data: dftRun } = await db.rpc("create_reconciliation_draft_run_atomic", {
          p_run_info: {
            company_id: testCompanyId,
            source_type: "excel",
            file_name: `forge_${forgeTag}.xlsx`,
            file_hash_sha256: `hash_forge_${forgeTag}`,
            row_count: 1,
            total_amount: 200.0,
          },
        });

        // Save legitimate draft result row: expected 500, actual 200
        await db.rpc("save_reconciliation_draft_results_atomic", {
          p_run_info: {
            run_id: dftRun.run_id,
            company_id: testCompanyId,
            source_type: "excel",
            file_name: `forge_${forgeTag}.xlsx`,
            file_hash_sha256: `hash_forge_${forgeTag}`,
            row_count: 1,
            total_amount: 200.0,
          },
          p_results: [
            {
              payable_id: forgePayable!.id,
              client_id: forgeClient!.id,
              payable_type: "mutual_fund_payables",
              result: "UNDER_PAID",
              actual_amount: 200.0,
              expected_amount: 500.0,
              difference: -300.0,
              source_reference: `SRC-FG-${forgeTag}`,
            },
          ],
        });

        // Attack 1: Attacker attempts to forge actual_amount (claiming 450.0 instead of persisted 200.0) -> MUST FAIL
        const { error: forgeAmtErr } = await db.rpc("approve_reconciliation_variance_atomic", {
          p_approval_info: {
            run_id: dftRun.run_id,
            payable_id: forgePayable!.id,
            source_reference: `SRC-FG-${forgeTag}`,
            actual_amount: 450.0, // Forged amount
            maker_id: "00000000-0000-0000-0000-000000000001",
            approved_by: "00000000-0000-0000-0000-000000000002",
            approval_reason: "Forged approval amount attempt",
          },
        });

        expect(forgeAmtErr).not.toBeNull();
        expect(forgeAmtErr!.message).toContain(
          "Tampering detected: caller actual_amount does not match persisted result",
        );

        // Attack 2: Attacker attempts to approve without referencing a persisted result -> MUST FAIL
        const { error: nonExistentErr } = await db.rpc("approve_reconciliation_variance_atomic", {
          p_approval_info: {
            run_id: dftRun.run_id,
            payable_id: "00000000-0000-0000-0000-999999999999",
            source_reference: "NON-EXISTENT",
            maker_id: "00000000-0000-0000-0000-000000000001",
            approved_by: "00000000-0000-0000-0000-000000000002",
            approval_reason: "Attempt with non-existent result",
          },
        });

        expect(nonExistentErr).not.toBeNull();
        expect(nonExistentErr!.message).toContain(
          "Persisted reconciliation result not found for approval",
        );

        // Attack 3: Service role attempts to approve without specifying an explicit approver ID -> MUST FAIL (no silent fallback UUID)
        const { error: noActorErr } = await db.rpc("approve_reconciliation_variance_atomic", {
          p_approval_info: {
            run_id: dftRun.run_id,
            payable_id: forgePayable!.id,
            source_reference: `SRC-FG-${forgeTag}`,
            maker_id: "00000000-0000-0000-0000-000000000001",
            approval_reason: "Missing explicit approver identity attempt",
          },
        });

        expect(noActorErr).not.toBeNull();
        expect(noActorErr!.message).toContain(
          "Approver identity must be authenticated via valid session or explicitly provided in trusted service context",
        );

        // Clean up
        await db.from("reconciliation_results").delete().eq("run_id", dftRun.run_id);
        await db.from("reconciliation_runs").delete().eq("id", dftRun.run_id);
        await db.from("mutual_fund_payables").delete().eq("id", forgePayable!.id);
        await db.from("clients").delete().eq("id", forgeClient!.id);
      });

      it("blocks direct table insert and update on reconciliation_variance_approvals by authenticated users", async () => {
        // Direct insert via authenticated role (NOT service_role) must be rejected by RLS / revoked privileges
        const { error: insertErr } = await (supabase as any)
          .from("reconciliation_variance_approvals")
          .insert({
            company_id: testCompanyId,
            run_id: "00000000-0000-0000-0000-000000000001",
            payable_id: "00000000-0000-0000-0000-000000000002",
            payable_type: "dividend_payables",
            variance_type: "UNDER_PAID",
            expected_amount: 1000.0,
            actual_amount: 500.0,
            variance_amount: 500.0,
            maker_id: "00000000-0000-0000-0000-000000000001",
            approved_by: "00000000-0000-0000-0000-000000000002",
            approval_reason: "Unauthorized direct table insertion attempt",
          });

        expect(insertErr).not.toBeNull();
        // PostgREST / Postgres returns 42501 (permission denied) or RLS policy violation
        expect(["42501", "PGRST301", "PGRST204", "42501"]).toContain(insertErr!.code);
      });

      it("rejects batch apply when current batch amounts do not match previously approved variance amounts", async () => {
        const misTag = `MIS_${Date.now()}`;
        const { data: misClient } = await db
          .from("clients")
          .insert({
            client_code: `CLI_MS_${misTag.slice(-6)}`,
            full_name: `Mismatch Investor ${misTag}`,
            boid: `130123000${misTag.slice(-7)}`,
          })
          .select("id")
          .single();

        const { data: misPayable } = await db
          .from("mutual_fund_payables")
          .insert({
            company_id: testCompanyId,
            client_id: misClient!.id,
            fiscal_year: "2082/83",
            gross_dividend: 500.0,
            tax_amount: 0.0,
            net_payable: 500.0,
            paid_amount: 0.0,
            payment_status: "Pending",
          })
          .select("id")
          .single();

        const { data: misRun } = await db.rpc("create_reconciliation_draft_run_atomic", {
          p_run_info: {
            company_id: testCompanyId,
            source_type: "bank_statement",
            file_name: `mismatch_${misTag}.xlsx`,
            file_hash_sha256: `hash_mis_${misTag}`,
            row_count: 1,
            total_amount: 200.0,
          },
        });

        // Persist draft result row with actual 200.0, expected 500.0
        await db.rpc("save_reconciliation_draft_results_atomic", {
          p_run_info: {
            run_id: misRun.run_id,
            company_id: testCompanyId,
            source_type: "bank_statement",
            file_name: `mismatch_${misTag}.xlsx`,
            file_hash_sha256: `hash_mis_${misTag}`,
            row_count: 1,
            total_amount: 200.0,
          },
          p_results: [
            {
              payable_id: misPayable!.id,
              client_id: misClient!.id,
              payable_type: "mutual_fund_payables",
              result: "UNDER_PAID",
              actual_amount: 200.0,
              expected_amount: 500.0,
              difference: -300.0,
              source_reference: `SRC-MIS-${misTag}`,
            },
          ],
        });

        // Legitimate approval of variance 300.0 (actual 200.0, expected 500.0)
        const { error: misAppErr } = await db.rpc("approve_reconciliation_variance_atomic", {
          p_approval_info: {
            run_id: misRun.run_id,
            payable_id: misPayable!.id,
            source_reference: `SRC-MIS-${misTag}`,
            maker_id: "00000000-0000-0000-0000-000000000001",
            approved_by: "00000000-0000-0000-0000-000000000002",
            approval_reason: "Approved 200.0 actual payment",
          },
        });
        expect(misAppErr).toBeNull();

        // Duplicate approval attempt on same result must fail (immutable append-only policy)
        const { error: dupAppErr } = await db.rpc("approve_reconciliation_variance_atomic", {
          p_approval_info: {
            run_id: misRun.run_id,
            payable_id: misPayable!.id,
            source_reference: `SRC-MIS-${misTag}`,
            maker_id: "00000000-0000-0000-0000-000000000001",
            approved_by: "00000000-0000-0000-0000-000000000002",
            approval_reason: "Second approval attempt should be rejected",
          },
        });
        expect(dupAppErr).not.toBeNull();
        expect(dupAppErr!.message).toContain("Approvals are immutable");

        // Now attempt to apply batch with altered actual amount (350.0 instead of approved 200.0)
        const { data: applyMismatchRes, error: applyMismatchErr } = await db.rpc(
          "apply_and_record_reconciliation_batch",
          {
            p_run_info: {
              run_id: misRun.run_id,
              company_id: testCompanyId,
              fiscal_year: "2082/83",
              source_type: "bank_statement",
              file_name: `mismatch_${misTag}.xlsx`,
              file_hash_sha256: `hash_mis_${misTag}`,
              idempotency_key: `key_mis_${misTag}`,
              row_count: 1,
              total_amount: 350.0,
              chunk_index: 0,
              total_chunks: 1,
              is_final_chunk: true,
            },
            p_items: [
              {
                payable_id: misPayable!.id,
                client_id: misClient!.id,
                target_table: "mutual_fund",
                payable_type: "mutual_fund",
                result: "UNDER_PAID",
                actual_amount: 350.0, // Altered from approved 200.0
                expected_amount: 500.0,
                difference: -150.0,
                payment_reference: `MIS-REF-${misTag.slice(-6)}`,
                source_reference: `SRC-MIS-${misTag}`,
              },
            ],
            p_batch_info: null,
          },
        );

        expect(applyMismatchErr).toBeNull();
        // The altered transaction must NOT be applied to payables: payables_updated must be 0 and exception created!
        expect(applyMismatchRes.payables_updated).toBe(0);
        expect(applyMismatchRes.exceptions_created).toBe(1);

        // Verify payable remained Pending / 0 paid
        const { data: unmutatedPayable } = await db
          .from("mutual_fund_payables")
          .select("payment_status, paid_amount")
          .eq("id", misPayable!.id)
          .single();
        expect(unmutatedPayable!.payment_status).toBe("Pending");
        expect(Number(unmutatedPayable!.paid_amount)).toBe(0.0);

        // Clean up
        await db.from("reconciliation_exceptions").delete().eq("run_id", misRun.run_id);
        await db.from("reconciliation_variance_approvals").delete().eq("run_id", misRun.run_id);
        await db.from("reconciliation_results").delete().eq("run_id", misRun.run_id);
        await db.from("reconciliation_runs").delete().eq("id", misRun.run_id);
        await db.from("mutual_fund_payables").delete().eq("id", misPayable!.id);
        await db.from("clients").delete().eq("id", misClient!.id);
      });
    },
  );
});
