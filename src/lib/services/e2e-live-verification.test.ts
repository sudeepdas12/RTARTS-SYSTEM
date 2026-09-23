import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ReconciliationEngine } from "@/lib/reconciliation-engine";
import { UploadService } from "@/lib/services/upload.service";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

describe("Comprehensive End-to-End Pipeline Verification", () => {
  const runId = Math.random().toString(36).substring(2, 7).toUpperCase();
  const testHash = `hash_${runId}_${Date.now()}`;
  let companyId: string = "";
  let uploadId: string = "";
  let clientId1: string = "";
  let clientId2: string = "";
  let paymentBatchId: string = "";
  let divPayId: string = "";
  let intPayId: string = "";
  const paymentRef1 = `CIPS-${runId}-001`;
  const paymentRef2 = `CIPS-${runId}-002`;

  beforeAll(async () => {
    // 1. Company Registration
    const { data: comp, error: compErr } = await supabase
      .from("companies")
      .insert({
        company_name: `E2E Verified Bank ${runId} Ltd`,
        company_code: `E2E_${runId}`,
        company_type: "Commercial Bank",
        fiscal_year: "2081/82",
        isin: `NPE2E${runId}01`,
      })
      .select("id")
      .single();

    if (compErr || !comp) throw new Error(`Company registration failed: ${compErr?.message}`);
    companyId = comp.id;

    // 2. Upload Record creation with admin client
    const { data: uploadRec, error: upErr } = await supabase
      .from("upload_history")
      .insert({
        file_name: `E2E_Test_${runId}.xlsx`,
        file_size: 2048,
        file_type: "dividend",
        sheet_name: "PUBLIC_INVESTORS",
        target_table: "dividend_payables",
        total_rows: 2,
        status: "Completed",
        file_hash: testHash,
      })
      .select("id")
      .single();

    if (upErr || !uploadRec) throw new Error(`Upload record creation failed: ${upErr?.message}`);
    uploadId = uploadRec.id;

    // 3. Client Seeding
    const boid1 = `130100${Date.now().toString().slice(-8)}1`;
    const boid2 = `130100${Date.now().toString().slice(-8)}2`;

    const { data: clients, error: clErr } = await supabase
      .from("clients")
      .insert([
        {
          company_id: companyId,
          boid: boid1,
          client_code: `C_${runId}_1`,
          full_name: "Aarav Shrestha",
          holder_type: "Natural Person - Public",
          bank_name: "Rastriya Banijya Bank",
          bank_account_no: "12345678901234",
          pan_no: "100234567",
          payee_classification: "NATURAL_PERSON",
        },
        {
          company_id: companyId,
          boid: boid2,
          client_code: `C_${runId}_2`,
          full_name: "Himalayan Capital Investments",
          holder_type: "Legal Person",
          bank_name: "Nabil Bank Ltd",
          bank_account_no: "98765432109876",
          pan_no: "600987654",
          payee_classification: "COMPANY_INSTITUTION",
        },
      ])
      .select("id, boid, full_name");

    if (clErr || !clients || clients.length < 2)
      throw new Error(`Client seeding failed: ${clErr?.message}`);
    clientId1 = clients[0].id;
    clientId2 = clients[1].id;
  });

  afterAll(async () => {
    // Teardown
    try {
      if (paymentBatchId) {
        await supabase.from("payments").delete().eq("batch_id", paymentBatchId);
        await supabase.from("payment_batches").delete().eq("id", paymentBatchId);
      }
      if (uploadId) {
        await supabase.from("dividend_payables").delete().eq("upload_id", uploadId);
        await supabase.from("interest_payables").delete().eq("upload_id", uploadId);
        await supabase.from("upload_history").delete().eq("id", uploadId);
      }
      if (clientId1) await supabase.from("clients").delete().eq("id", clientId1);
      if (clientId2) await supabase.from("clients").delete().eq("id", clientId2);
      if (companyId) await supabase.from("companies").delete().eq("id", companyId);
    } catch (e) {
      console.warn("Cleanup warning:", e);
    }
  });

  it("1. Upload & Seeding: validates duplicate hash blocking and inserts payables with strict financial invariants", async () => {
    // Attempt duplicate insert on active hash
    const { error: dupErr } = await supabase.from("upload_history").insert({
      file_name: `Duplicate_${runId}.xlsx`,
      file_size: 2048,
      file_type: "dividend",
      target_table: "dividend_payables",
      file_hash: testHash,
      status: "Completed",
    });
    expect(dupErr).not.toBeNull();
    expect(dupErr?.code).toBe("23505");

    // Seed Dividend Payable (10,000 gross, 500 tax 5%, 9,500 net, 50 bonus kitta)
    const { data: div, error: divErr } = await supabase
      .from("dividend_payables")
      .insert({
        upload_id: uploadId,
        company_id: companyId,
        client_id: clientId1,
        fiscal_year: "2081/82",
        shares_held: 1000,
        dividend_rate: 10.0,
        gross_dividend: 10000,
        tax_amount: 500,
        net_payable: 9500,
        bonus_issued: 50,
        after_bonus_kitta: 1050,
        payment_status: "Pending",
        bank_name: "Rastriya Banijya Bank",
        bank_account_no: "12345678901234",
      })
      .select("id")
      .single();
    expect(divErr).toBeNull();
    divPayId = div.id;

    // Seed Interest Payable (5,000 gross, 750 tax 15%, 4,250 net, explicit due_date)
    const { data: intPay, error: intErr } = await supabase
      .from("interest_payables")
      .insert({
        upload_id: uploadId,
        company_id: companyId,
        client_id: clientId2,
        fiscal_year: "2081/82",
        shares_held: 50,
        gross_interest: 5000,
        tax_amount: 750,
        net_payable: 4250,
        tds_rate: 0.15,
        due_date: "2082-04-15",
        payment_status: "Pending",
        bank_name: "Nabil Bank Ltd",
        bank_account_no: "98765432109876",
      })
      .select("id, due_date")
      .single();
    expect(intErr).toBeNull();
    intPayId = intPay.id;
    expect(intPay.due_date).toBe("2082-04-15");
  });

  it("2. Payment Flow: dispatches batch and updates payables atomically via RPC", async () => {
    // Create payment batch
    const { data: batch, error: bErr } = await supabase
      .from("payment_batches")
      .insert({
        company_id: companyId,
        batch_name: `Batch_${runId}`,
        status: "Processed",
        total_payments: 2,
        total_amount: 13750,
        total_tax: 1250,
        payment_method: "ConnectIPS",
      })
      .select("id")
      .single();
    expect(bErr).toBeNull();
    paymentBatchId = batch.id;

    // Insert payments
    const { error: pErr } = await supabase.from("payments").insert([
      {
        batch_id: batch.id,
        company_id: companyId,
        client_id: clientId1,
        payable_type: "dividend",
        payable_id: divPayId,
        gross_amount: 10000,
        tax_amount: 500,
        net_amount: 9500,
        paid_amount: 9500,
        payment_reference: paymentRef1,
        connectips_ref: paymentRef1,
        payment_method: "ConnectIPS",
        bank_name: "Rastriya Banijya Bank",
        bank_account_no: "12345678901234",
        status: "Completed",
        payment_date: new Date().toISOString().split("T")[0],
      },
      {
        batch_id: batch.id,
        company_id: companyId,
        client_id: clientId2,
        payable_type: "interest",
        payable_id: intPayId,
        gross_amount: 5000,
        tax_amount: 750,
        net_amount: 4250,
        paid_amount: 4250,
        payment_reference: paymentRef2,
        connectips_ref: paymentRef2,
        payment_method: "ConnectIPS",
        bank_name: "Nabil Bank Ltd",
        bank_account_no: "98765432109876",
        status: "Completed",
        payment_date: new Date().toISOString().split("T")[0],
      },
    ]);
    expect(pErr).toBeNull();

    // Call RPC to complete atomically
    const { error: rpcErr } = await supabase.rpc("complete_payment_batch_atomic", {
      p_batch_id: batch.id,
      p_user_id: null,
    });
    expect(rpcErr).toBeNull();

    // Verify payables transitioned to 'Paid'
    const { data: divAfter } = await supabase
      .from("dividend_payables")
      .select("payment_status")
      .eq("id", divPayId)
      .single();
    const { data: intAfter } = await supabase
      .from("interest_payables")
      .select("payment_status")
      .eq("id", intPayId)
      .single();
    expect(divAfter?.payment_status).toBe("Paid");
    expect(intAfter?.payment_status).toBe("Paid");
  });

  it("3. Reconciliation: matches bank settlement statement and isolates returns/rejections", async () => {
    const txns = [
      {
        id: "txn-1",
        date: "2026-09-22",
        description: `ConnectIPS Ref ${paymentRef1} Aarav Shrestha`,
        debit: 9500,
        credit: 0,
        balance: 1000000,
        accountNo: "12345678901234",
        category: "PAYOUT_DEBIT" as const,
        referenceId: paymentRef1,
      },
      {
        id: "txn-2",
        date: "2026-09-22",
        description: `NCHL Return Unpaid RTS ${paymentRef2}`,
        debit: 0,
        credit: 4250,
        balance: 1004250,
        accountNo: "98765432109876",
        category: "REJECT_RETURN" as const,
        referenceId: paymentRef2,
      },
    ];

    const report = await ReconciliationEngine.analyzeBankStatement(txns, {
      companyId,
      fileName: "bank_test.csv",
      client: supabase,
    });

    expect(report.matches).toHaveLength(2);
    expect(report.grandTotal.matchedRecords).toBeGreaterThanOrEqual(1);
    expect(report.grandTotal.rejectedCount).toBe(1);
  });

  it("4. Statement Ledger: retrieves unified shareholder entitlement ledger with bonus and cash", async () => {
    const { data: records, error } = await supabase
      .from("dividend_payables")
      .select("*, company:companies(company_name, company_code)")
      .eq("client_id", clientId1);

    expect(error).toBeNull();
    expect(records).toHaveLength(1);
    const r = records![0];
    expect(r.gross_dividend).toBe(10000);
    expect(r.tax_amount).toBe(500);
    expect(r.net_payable).toBe(9500);
    expect(r.payment_status).toBe("Paid");
    expect(r.bonus_issued).toBe(50);
    expect(r.after_bonus_kitta).toBe(1050);
    expect(r.company.company_code).toBe(`E2E_${runId}`);
  });

  it("5. Rollback & Re-upload: rolls back payables, preserves company/shareholder master records, and unblocks duplicate hash", async () => {
    // 1. Roll back the upload
    // Delete payments first to satisfy foreign keys if any
    await supabase.from("payments").delete().eq("payable_id", divPayId);

    const rollbackRes = await UploadService.rollbackUpload(uploadId, "dividend_payables");
    expect(rollbackRes.success).toBe(true);

    // 2. Verify payables linked to this upload are deleted
    const { data: payAfter } = await supabase
      .from("dividend_payables")
      .select("id")
      .eq("upload_id", uploadId);
    expect(payAfter).toHaveLength(0);

    // 3. Verify company is preserved and orphan clients are cleaned up cleanly
    const { data: compCheck } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .single();
    expect(compCheck?.id).toBe(companyId);
    expect(rollbackRes.clientsDeleted).toBeGreaterThanOrEqual(1);

    // 4. Verify upload_history status is 'RolledBack'
    const { data: upCheck } = await supabase
      .from("upload_history")
      .select("status")
      .eq("id", uploadId)
      .single();
    expect(upCheck?.status).toBe("RolledBack");

    // 5. Re-upload with the EXACT SAME file_hash: must SUCCEED without duplicate key violation
    const { data: newUpload, error: reUpErr } = await supabase
      .from("upload_history")
      .insert({
        file_name: `ReUpload_${runId}.xlsx`,
        file_size: 2048,
        file_type: "dividend",
        sheet_name: "PUBLIC_INVESTORS",
        target_table: "dividend_payables",
        total_rows: 2,
        status: "Completed",
        file_hash: testHash,
      })
      .select("id")
      .single();

    expect(reUpErr).toBeNull();
    expect(newUpload?.id).toBeDefined();

    // Clean up new upload
    if (newUpload?.id) {
      await supabase.from("upload_history").delete().eq("id", newUpload.id);
    }
  });
});
