import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { WorkflowEngine } from "../workflow-engine";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "";

const isLiveDb = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY);

const adminClient = isLiveDb
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : (null as any);

describe.skipIf(!isLiveDb)("Stage 2: Financial Ledger & Security Invariants (Live DB)", () => {
  const runId = `S2_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  let companyId: string;
  let companyOtherId: string;
  let hidclCompanyId: string | null = null;
  let adminUserId: string;
  let restrictedMakerId: string;
  let restrictedMakerClient: any;
  let approverUserId: string;
  let approverClient: any;
  let clientNatId: string;
  let clientInstId: string;
  let clientMfId: string;
  let divDeclarationId: string;
  let intDeclarationId: string;

  const createdBatchIds: string[] = [];
  const createdClientIds: string[] = [];

  beforeAll(async () => {
    const { data: comp, error: compErr } = await adminClient
      .from("companies")
      .insert({
        company_name: `Audit Invariant Co ${runId}`,
        company_code: `AIC_${runId}`,
        company_type: "Hydropower",
        fiscal_year: "2081/82",
      })
      .select("id")
      .single();
    if (compErr) throw compErr;
    companyId = comp.id;

    const { data: compOther, error: compOtherErr } = await adminClient
      .from("companies")
      .insert({
        company_name: `Other Confidential Co ${runId}`,
        company_code: `OCC_${runId}`,
        company_type: "Commercial Bank",
        fiscal_year: "2081/82",
      })
      .select("id")
      .single();
    if (compOtherErr) throw compOtherErr;
    companyOtherId = compOther.id;

    // Look up seeded admin user
    const { data: adminProfile } = await adminClient
      .from("profiles")
      .select("id")
      .eq("email", "admin@rbbmbl.com.np")
      .single();
    adminUserId = adminProfile.id;

    // Create restricted maker with ZERO user_company_access mappings
    const { data: uMaker, error: uMakerErr } = await adminClient.auth.admin.createUser({
      email: `restricted-maker-${runId.toLowerCase()}@example.com`,
      password: "Password123!",
      email_confirm: true,
    });
    if (uMakerErr) throw uMakerErr;
    restrictedMakerId = uMaker.user.id;
    await adminClient
      .from("user_roles")
      .upsert({ user_id: restrictedMakerId, role: "maker" }, { onConflict: "user_id,role" });

    restrictedMakerClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await restrictedMakerClient.auth.signInWithPassword({
      email: `restricted-maker-${runId.toLowerCase()}@example.com`,
      password: "Password123!",
    });

    // Create dedicated approver mapped to companyId
    const { data: uApp, error: uAppErr } = await adminClient.auth.admin.createUser({
      email: `approver-${runId.toLowerCase()}@example.com`,
      password: "Password123!",
      email_confirm: true,
    });
    if (uAppErr) throw uAppErr;
    approverUserId = uApp.user.id;
    await adminClient
      .from("user_roles")
      .upsert({ user_id: approverUserId, role: "approver" }, { onConflict: "user_id,role" });
    await adminClient
      .from("user_company_access")
      .upsert(
        { user_id: approverUserId, company_id: companyId },
        { onConflict: "user_id,company_id" },
      );

    approverClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await approverClient.auth.signInWithPassword({
      email: `approver-${runId.toLowerCase()}@example.com`,
      password: "Password123!",
    });

    // Seed clients
    const boidBase = `13019900${Math.floor(10000000 + Math.random() * 80000000)}`;
    const { data: cNat, error: e1 } = await adminClient
      .from("clients")
      .insert({
        company_id: companyId,
        full_name: `RAM PRASAD SHARMA ${runId}`,
        client_code: `CNAT_${runId}`,
        boid: boidBase,
        holder_type: "Natural Person - Public",
        payee_classification: "NATURAL_PERSON",
        classification_status: "CONFIRMED",
        bank_name: "Rastriya Banijya Bank",
        bank_account_no: "1001001001",
      })
      .select("id")
      .single();
    if (e1) throw e1;
    clientNatId = cNat.id;
    createdClientIds.push(clientNatId);

    const { data: cInst, error: e2 } = await adminClient
      .from("clients")
      .insert({
        company_id: companyId,
        full_name: `EVEREST HOLDINGS PVT LTD ${runId}`,
        client_code: `CINST_${runId}`,
        boid: `13018800${Math.floor(10000000 + Math.random() * 80000000)}`,
        holder_type: "Legal Person",
        payee_classification: "COMPANY_INSTITUTION",
        classification_status: "CONFIRMED",
        bank_name: "Rastriya Banijya Bank",
        bank_account_no: "2002002002",
      })
      .select("id")
      .single();
    if (e2) throw e2;
    clientInstId = cInst.id;
    createdClientIds.push(clientInstId);

    const { data: cMf, error: e3 } = await adminClient
      .from("clients")
      .insert({
        company_id: companyId,
        full_name: `NABIL BALANCED FUND ${runId}`,
        client_code: `CMF_${runId}`,
        boid: `13017700${Math.floor(10000000 + Math.random() * 80000000)}`,
        holder_type: "Mutual Fund",
        payee_classification: "TAX_EXEMPT",
        classification_status: "CONFIRMED",
        bank_name: "Nabil Bank",
        bank_account_no: "3003003003",
      })
      .select("id")
      .single();
    if (e3) throw e3;
    clientMfId = cMf.id;
    createdClientIds.push(clientMfId);

    // Declarations
    const { data: dDec, error: ddErr } = await adminClient
      .from("corporate_declarations")
      .insert({
        company_id: companyId,
        declaration_code: `DEC_DIV_${runId}`,
        declaration_type: "Dividend",
        sub_type: "Combined",
        fiscal_year: "2081/82",
        declaration_date: "2026-01-15",
        rate_per_share: 10,
      })
      .select("id")
      .single();
    if (ddErr) throw ddErr;
    divDeclarationId = dDec.id;

    const { data: iDec, error: idErr } = await adminClient
      .from("corporate_declarations")
      .insert({
        company_id: companyId,
        declaration_code: `DEC_INT_${runId}`,
        declaration_type: "Interest",
        sub_type: "Semi-Annual",
        fiscal_year: "2081/82",
        declaration_date: "2026-01-15",
        rate_per_share: 8.5,
      })
      .select("id")
      .single();
    if (idErr) throw idErr;
    intDeclarationId = iDec.id;
  });

  afterAll(async () => {
    if (!adminClient) return;
    if (createdBatchIds.length > 0) {
      await adminClient.from("payments").delete().in("batch_id", createdBatchIds);
      await adminClient.from("payment_batches").delete().in("id", createdBatchIds);
    }
    const targetCompanyIds = [companyId, companyOtherId, hidclCompanyId].filter(Boolean);
    if (targetCompanyIds.length > 0) {
      await adminClient.from("payments").delete().in("company_id", targetCompanyIds);
      await adminClient.from("payment_batches").delete().in("company_id", targetCompanyIds);
      await adminClient.from("dividend_payables").delete().in("company_id", targetCompanyIds);
      await adminClient.from("interest_payables").delete().in("company_id", targetCompanyIds);
      await adminClient.from("mutual_fund_payables").delete().in("company_id", targetCompanyIds);
      await adminClient.from("corporate_declarations").delete().in("company_id", targetCompanyIds);
      await adminClient.from("clients").delete().in("company_id", targetCompanyIds);
      await adminClient.from("user_company_access").delete().in("company_id", targetCompanyIds);
      await adminClient.from("companies").delete().in("id", targetCompanyIds);
    }
    if (restrictedMakerId) {
      await adminClient.from("user_roles").delete().eq("user_id", restrictedMakerId);
      await adminClient.auth.admin.deleteUser(restrictedMakerId).catch(() => {});
    }
    if (approverUserId) {
      await adminClient.from("user_roles").delete().eq("user_id", approverUserId);
      await adminClient.auth.admin.deleteUser(approverUserId).catch(() => {});
    }
  });

  it("T1: preserves bonus_tax deduction and declaration_id through bulk_insert_dividend_payables and triggers", async () => {
    const { data: rpcRes, error: rpcErr } = await adminClient.rpc("bulk_insert_dividend_payables", {
      p_payables: [
        {
          company_id: companyId,
          client_id: clientNatId,
          declaration_id: divDeclarationId,
          fiscal_year: "2081/82",
          shares_held: 1000,
          dividend_rate: 10,
          bonus_rate: 5,
          gross_dividend: 10000,
          tax_amount: 500,
          bonus_tax: 250,
          net_payable: 9250,
          tds_rate: 0.05,
          payee_classification: "NATURAL_PERSON",
          classification_status: "CONFIRMED",
          remarks: `BONUS_TAX_TEST_${runId}`,
        },
      ],
    });
    expect(rpcErr).toBeNull();
    expect(rpcRes?.inserted).toBe(1);

    const { data: row } = await adminClient
      .from("dividend_payables")
      .select(
        "gross_dividend, tax_amount, bonus_tax, net_payable, remaining_amount, declaration_id",
      )
      .eq("company_id", companyId)
      .eq("client_id", clientNatId)
      .eq("remarks", `BONUS_TAX_TEST_${runId}`)
      .single();

    expect(Number(row.net_payable)).toBe(9250);
    expect(Number(row.remaining_amount)).toBe(9250);
    expect(Number(row.bonus_tax)).toBe(250);
    expect(row.declaration_id).toBe(divDeclarationId);
  });

  it("T2: completes an approved/processed payment batch via WorkflowEngine and marks payments & payables Paid", async () => {
    const { data: dp, error: dpErr } = await adminClient
      .from("dividend_payables")
      .insert({
        company_id: companyId,
        client_id: clientNatId,
        fiscal_year: "2081/82",
        shares_held: 500,
        dividend_rate: 10,
        gross_dividend: 5000,
        tax_amount: 250,
        bonus_tax: 0,
        net_payable: 4750,
        remaining_amount: 4750,
        tds_rate: 0.05,
        payment_status: "Pending",
        payee_classification: "NATURAL_PERSON",
        classification_status: "CONFIRMED",
        remarks: `COMPLETE_FLOW_${runId}`,
      })
      .select("id")
      .single();
    expect(dpErr).toBeNull();

    const { data: batch, error: bErr } = await adminClient
      .from("payment_batches")
      .insert({
        batch_name: `COMPLETE_BATCH_${runId}`,
        company_id: companyId,
        fiscal_year: "2081/82",
        payable_type: "dividend",
        payment_method: "ConnectIPS",
        status: "Processed",
        total_payments: 1,
        total_amount: 4750,
        total_tax: 250,
        created_by: restrictedMakerId,
      })
      .select("id")
      .single();
    expect(bErr).toBeNull();
    createdBatchIds.push(batch.id);

    const { error: pErr } = await adminClient.from("payments").insert({
      batch_id: batch.id,
      company_id: companyId,
      client_id: clientNatId,
      payable_type: "dividend",
      payable_id: dp.id,
      gross_amount: 5000,
      tax_amount: 250,
      net_amount: 4750,
      paid_amount: 0,
      payment_method: "ConnectIPS",
      status: "Pending",
      created_by: restrictedMakerId,
    });
    expect(pErr).toBeNull();

    // Sign in workflow engine session as approver or call admin-context user
    // Note WorkflowEngine runs through client supabase instance; verify both WorkflowEngine.processAction & direct RPC
    await import("../services/database").then(async ({ supabase }) => {
      await supabase.auth.signInWithPassword({
        email: `approver-${runId.toLowerCase()}@example.com`,
        password: "Password123!",
      });
      const result = await WorkflowEngine.processAction(
        batch.id,
        "payment_batches",
        "complete",
        "Settled in bank",
        {
          id: approverUserId,
          email: `approver-${runId.toLowerCase()}@example.com`,
          full_name: "Test Approver",
          roles: ["approver"],
          primaryRole: "approver",
        } as any,
      );
      await supabase.auth.signOut();
      expect(result.success).toBe(true);
    });

    const { data: updatedBatch } = await adminClient
      .from("payment_batches")
      .select("status")
      .eq("id", batch.id)
      .single();
    const { data: updatedPayment } = await adminClient
      .from("payments")
      .select("status, paid_amount")
      .eq("batch_id", batch.id)
      .single();
    const { data: updatedDp } = await adminClient
      .from("dividend_payables")
      .select("payment_status, paid_amount, remaining_amount")
      .eq("id", dp.id)
      .single();

    expect(updatedBatch.status).toBe("Completed");
    expect(updatedPayment.status).toBe("Completed");
    expect(Number(updatedPayment.paid_amount)).toBe(4750);
    expect(updatedDp.payment_status).toBe("Paid");
    expect(Number(updatedDp.paid_amount)).toBe(4750);
    expect(Number(updatedDp.remaining_amount)).toBe(0);
  });

  it("T3: supports multi-leg SEMI_1 and SEMI_2 installments on one payable without unique constraint violation", async () => {
    const { data: ip, error: ipErr } = await adminClient
      .from("interest_payables")
      .insert({
        company_id: companyId,
        client_id: clientNatId,
        fiscal_year: "2081/82",
        shares_held: 100,
        kitta: 100,
        interest_rate_value: 8.5,
        due_date: "2026-07-16",
        days_count: 365,
        gross_interest: 8500,
        tax_amount: 510,
        net_payable: 7990,
        remaining_amount: 7990,
        tds_rate: 0.06,
        payment_status: "Pending",
        payee_classification: "NATURAL_PERSON",
        classification_status: "CONFIRMED",
        instrument_ref: `SEMI_${runId}`,
      })
      .select("id")
      .single();
    expect(ipErr).toBeNull();

    const { data: b1 } = await adminClient
      .from("payment_batches")
      .insert({
        batch_name: `SEMI_1_${runId}`,
        company_id: companyId,
        fiscal_year: "2081/82",
        payable_type: "interest",
        payment_method: "ConnectIPS",
        status: "Completed",
        total_payments: 1,
        total_amount: 3995,
        total_tax: 255,
      })
      .select("id")
      .single();
    const { data: b2 } = await adminClient
      .from("payment_batches")
      .insert({
        batch_name: `SEMI_2_${runId}`,
        company_id: companyId,
        fiscal_year: "2081/82",
        payable_type: "interest",
        payment_method: "ConnectIPS",
        status: "Draft",
        total_payments: 1,
        total_amount: 3995,
        total_tax: 255,
      })
      .select("id")
      .single();
    createdBatchIds.push(b1.id, b2.id);

    const { error: leg1Err } = await adminClient.from("payments").insert({
      batch_id: b1.id,
      company_id: companyId,
      client_id: clientNatId,
      payable_type: "interest",
      payable_id: ip.id,
      gross_amount: 4250,
      tax_amount: 255,
      net_amount: 3995,
      paid_amount: 3995,
      payment_method: "ConnectIPS",
      status: "Completed",
    });
    expect(leg1Err).toBeNull();

    const { error: leg2Err } = await adminClient.from("payments").insert({
      batch_id: b2.id,
      company_id: companyId,
      client_id: clientNatId,
      payable_type: "interest",
      payable_id: ip.id,
      gross_amount: 4250,
      tax_amount: 255,
      net_amount: 3995,
      paid_amount: 0,
      payment_method: "ConnectIPS",
      status: "Pending",
    });
    expect(leg2Err).toBeNull();
  });

  it("T4: populate_payment_batch_chunk excludes UNCLASSIFIED and REVIEW_REQUIRED rows across dividend and interest tables", async () => {
    const { data: unclassClient, error: ucErr } = await adminClient
      .from("clients")
      .insert({
        company_id: companyId,
        full_name: `AMBIGUOUS ENTITY ${runId}`,
        client_code: `CUNC_${runId}`,
        boid: `13016600${Math.floor(10000000 + Math.random() * 80000000)}`,
        payee_classification: "UNCLASSIFIED",
        classification_status: "REVIEW_REQUIRED",
        bank_name: "Rastriya Banijya Bank",
        bank_account_no: "4004004004",
      })
      .select("id")
      .single();
    expect(ucErr).toBeNull();

    const { data: unclassDiv, error: uErr } = await adminClient
      .from("dividend_payables")
      .insert({
        company_id: companyId,
        client_id: unclassClient.id,
        fiscal_year: "2081/82",
        shares_held: 100,
        dividend_rate: 50,
        gross_dividend: 5000,
        tax_amount: 0,
        net_payable: 5000,
        remaining_amount: 5000,
        payment_status: "Pending",
        payee_classification: "UNCLASSIFIED",
        classification_status: "REVIEW_REQUIRED",
        remarks: `UNCLASS_DIV_${runId}`,
      })
      .select("id")
      .single();
    expect(uErr).toBeNull();

    const { data: unclassInt, error: uiErr } = await adminClient
      .from("interest_payables")
      .insert({
        company_id: companyId,
        client_id: unclassClient.id,
        fiscal_year: "2081/82",
        due_date: "2026-07-16",
        gross_interest: 3000,
        tax_amount: 0,
        net_payable: 3000,
        remaining_amount: 3000,
        payment_status: "Pending",
        payee_classification: "UNCLASSIFIED",
        classification_status: "REVIEW_REQUIRED",
        remarks: `UNCLASS_INT_${runId}`,
      })
      .select("id")
      .single();
    expect(uiErr).toBeNull();

    const { data: batch } = await adminClient
      .from("payment_batches")
      .insert({
        batch_name: `CHUNK_GUARD_${runId}`,
        company_id: companyId,
        fiscal_year: "2081/82",
        payable_type: "all",
        payment_method: "ConnectIPS",
        status: "Draft",
      })
      .select("id")
      .single();
    createdBatchIds.push(batch.id);

    await adminClient.rpc("populate_payment_batch_chunk", {
      p_batch_id: batch.id,
      p_company_id: companyId,
      p_fiscal_year: "2081/82",
      p_payable_type: "all",
      p_payment_method: "ConnectIPS",
      p_installment_tag: "FULL",
      p_limit: 500,
    });

    const { data: badPayments } = await adminClient
      .from("payments")
      .select("id")
      .eq("batch_id", batch.id)
      .in("payable_id", [unclassDiv.id, unclassInt.id]);

    expect(badPayments || []).toHaveLength(0);
  });

  it("T5: 3-arg revert_payment_batch_atomic resets mutual_fund_payables to Pending with paid_amount=0", async () => {
    const { data: mf, error: mfErr } = await adminClient
      .from("mutual_fund_payables")
      .insert({
        company_id: companyId,
        client_id: clientMfId,
        fiscal_year: "2081/82",
        shares_held: 100,
        dividend_rate: 10,
        gross_dividend: 1000,
        tax_amount: 0,
        net_payable: 1000,
        paid_amount: 1000,
        remaining_amount: 0,
        tds_rate: 0,
        payment_status: "Paid",
        payee_classification: "TAX_EXEMPT",
        classification_status: "CONFIRMED",
        lot_name: `RMF_${runId}`,
      })
      .select("id")
      .single();
    expect(mfErr).toBeNull();

    const { data: batch } = await adminClient
      .from("payment_batches")
      .insert({
        batch_name: `REVERT_MF_${runId}`,
        company_id: companyId,
        fiscal_year: "2081/82",
        payable_type: "mutual_fund",
        payment_method: "ConnectIPS",
        status: "Completed",
        total_payments: 1,
        total_amount: 1000,
        total_tax: 0,
      })
      .select("id")
      .single();
    createdBatchIds.push(batch.id);

    await adminClient.from("payments").insert({
      batch_id: batch.id,
      company_id: companyId,
      client_id: clientMfId,
      payable_type: "mutual_fund",
      payable_id: mf.id,
      gross_amount: 1000,
      tax_amount: 0,
      net_amount: 1000,
      paid_amount: 1000,
      payment_method: "ConnectIPS",
      status: "Completed",
    });

    const { error: revErr } = await adminClient.rpc("revert_payment_batch_atomic", {
      p_batch_id: batch.id,
      p_user_id: adminUserId,
      p_reason: "Testing MF reversal integrity",
    });
    expect(revErr).toBeNull();

    const { data: revertedMf } = await adminClient
      .from("mutual_fund_payables")
      .select("payment_status, paid_amount, remaining_amount")
      .eq("id", mf.id)
      .single();

    expect(revertedMf.payment_status).toBe("Pending");
    expect(Number(revertedMf.paid_amount)).toBe(0);
    expect(Number(revertedMf.remaining_amount)).toBe(1000);
  });

  it("T6: sync_all_classifications_and_taxes never mutates Paid rows or flattens 15% corporate tax to 5%", async () => {
    const { data: paidCorp, error: pcErr } = await adminClient
      .from("dividend_payables")
      .insert({
        company_id: companyId,
        client_id: clientInstId,
        fiscal_year: "2081/82",
        shares_held: 1000,
        dividend_rate: 10,
        gross_dividend: 10000,
        tax_amount: 1500,
        bonus_tax: 0,
        net_payable: 8500,
        paid_amount: 8500,
        remaining_amount: 0,
        tds_rate: 0.15,
        payment_status: "Paid",
        payee_classification: "COMPANY_INSTITUTION",
        classification_status: "CONFIRMED",
        remarks: `PAID_IMMUTABLE_${runId}`,
      })
      .select("id")
      .single();
    expect(pcErr).toBeNull();

    await adminClient.rpc("sync_all_classifications_and_taxes");

    const { data: after } = await adminClient
      .from("dividend_payables")
      .select("tds_rate, tax_amount, net_payable, payment_status")
      .eq("id", paidCorp.id)
      .single();

    expect(Number(after.tds_rate)).toBe(0.15);
    expect(Number(after.tax_amount)).toBe(1500);
    expect(Number(after.net_payable)).toBe(8500);
    expect(after.payment_status).toBe("Paid");
  });

  it("T7 & T8: bulk_upsert_company preserves face_value=100 for HIDCL; declaration and MF scheme summaries execute cleanly", async () => {
    const { data: upRes, error: upErr } = await adminClient.rpc("bulk_upsert_company", {
      p_company_name: `Hydropower Investment ${runId}`,
      p_company_code: `HIDCL_${runId}`,
      p_isin: `NPEHIDCL${runId.slice(0, 4)}`,
    });
    expect(upErr).toBeNull();
    expect(upRes?.success).toBe(true);
    hidclCompanyId = upRes.company_id;

    const { data: hidclRow } = await adminClient
      .from("companies")
      .select("face_value")
      .eq("id", hidclCompanyId)
      .single();
    expect(Number(hidclRow.face_value)).toBe(100);

    const { data: decSum, error: decSumErr } = await adminClient.rpc("get_declaration_summary", {
      p_declaration_id: intDeclarationId,
    });
    expect(decSumErr).toBeNull();
    expect(decSum?.declaration_id).toBe(intDeclarationId);

    const { error: mfSumErr } = await adminClient.rpc("get_mutual_fund_schemes_summary", {
      p_fiscal_year: "all",
    });
    expect(mfSumErr).toBeNull();
  });

  it("T9: blocks anonymous secret/view leaks and denies unmapped restricted users from seeing other companies", async () => {
    // 1. Anon HTTP REST check for get_cron_secret
    const cronRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_cron_secret`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const cronBody = await cronRes.text();
    expect(cronRes.ok).toBe(false);
    expect(cronBody).not.toContain("rtarts-internal-cron-secret");

    // 2. Anon HTTP REST check for upload_logs and reconciliation_lots views
    const logsRes = await fetch(`${SUPABASE_URL}/rest/v1/upload_logs?limit=5`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    expect(logsRes.ok).toBe(false);

    const lotsRes = await fetch(`${SUPABASE_URL}/rest/v1/reconciliation_lots?limit=5`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    expect(lotsRes.ok).toBe(false);

    // 3. Restricted maker with zero user_company_access mappings must see ZERO companies
    const { data: visCompanies, error: visErr } = await restrictedMakerClient
      .from("companies")
      .select("id")
      .in("id", [companyId, companyOtherId]);
    expect(visErr).toBeNull();
    expect(visCompanies || []).toHaveLength(0);
  });

  it("T10: run_ledger_invariant_audit verifies 0 violations on valid data and denies maker role", async () => {
    const { data: auditRes, error: auditErr } = await adminClient.rpc(
      "run_ledger_invariant_audit",
      { p_company_id: companyId },
    );
    expect(auditErr).toBeNull();
    expect(auditRes?.passed).toBe(true);
    expect(Number(auditRes?.total_violations ?? -1)).toBe(0);
    expect(Array.isArray(auditRes?.checks)).toBe(true);
    expect(auditRes.checks.length).toBe(7);

    // Restricted maker lacks admin/supervisor/auditor/finance_operator role
    const { error: makerAuditErr } = await restrictedMakerClient.rpc("run_ledger_invariant_audit", {
      p_company_id: null,
    });
    expect(makerAuditErr).not.toBeNull();
  });

  it("T11: blocks direct API queries on materialized view company_client_map and scopes get_company_client_counts", async () => {
    const anonMapRes = await fetch(`${SUPABASE_URL}/rest/v1/company_client_map?limit=5`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    expect(anonMapRes.ok).toBe(false);

    const { error: authDirectErr } = await restrictedMakerClient
      .from("company_client_map")
      .select("company_id")
      .limit(1);
    expect(authDirectErr).not.toBeNull();

    const { data: makerCounts, error: makerCountErr } = await restrictedMakerClient.rpc(
      "get_company_client_counts",
      { p_company_ids: [companyId, companyOtherId] },
    );
    expect(makerCountErr).toBeNull();
    expect(makerCounts || []).toHaveLength(0);
  });
});
