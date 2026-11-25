import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SettingsService } from "./settings.service";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const isLiveDb = Boolean(SERVICE_ROLE_KEY && !process.env.CI);

const adminClient = isLiveDb
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : (null as any);

describe.skipIf(!isLiveDb)("Live DB: ConnectIPS Secret Masking & Payment Status Sync", () => {
  const runId = `CIPS_${Date.now()}`;
  let originalSettingsValue: Record<string, any> | null = null;
  let companyId: string | null = null;
  let batchId: string | null = null;

  beforeAll(async () => {
    const { data: settingsRow } = await adminClient
      .from("system_settings")
      .select("setting_value")
      .eq("setting_key", "global")
      .maybeSingle();
    originalSettingsValue = settingsRow?.setting_value
      ? JSON.parse(JSON.stringify(settingsRow.setting_value))
      : null;

    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.signInWithPassword({
      email: "admin@rbbmbl.com.np",
      password: process.env.SUPABASE_TEST_ADMIN_PASSWORD || "Admin123!",
    });
  });

  afterAll(async () => {
    if (!isLiveDb) return;

    if (batchId) {
      await adminClient.from("payments").delete().eq("batch_id", batchId);
      await adminClient.from("payment_batches").delete().eq("id", batchId);
    }
    if (companyId) {
      await adminClient.from("dividend_payables").delete().eq("company_id", companyId);
      await adminClient.from("clients").delete().eq("company_id", companyId);
      await adminClient.from("companies").delete().eq("id", companyId);
    }

    if (originalSettingsValue) {
      await adminClient
        .from("system_settings")
        .update({ setting_value: originalSettingsValue })
        .eq("setting_key", "global");
    } else {
      await adminClient.from("system_settings").delete().eq("setting_key", "global");
    }
  });

  it("persists ConnectIPS token securely, masks plaintext from safe view, and preserves on unrelated saves", async () => {
    const testSecretToken = `SECRET_NCHL_${runId}`;
    const testCertPass = `CERT_PASS_${runId}`;

    const { data: savedSafe, error: saveErr } = await adminClient.rpc(
      "save_system_settings_global",
      {
        p_settings: {
          connectips_enabled: true,
          connectips_mode: "SANDBOX",
          connectips_merchant_id: "M_LIVE_TEST",
          connectips_app_id: "APP_LIVE_TEST",
          connectips_token: testSecretToken,
          connectips_cert_pass: testCertPass,
          connectips_token_configured: true,
        },
      },
    );

    expect(saveErr).toBeNull();
    // RPC returns masked payload & strips transient *_configured from raw JSONB
    expect(savedSafe.connectips_token).toBeUndefined();
    expect(savedSafe.connectips_cert_pass).toBeUndefined();
    expect(savedSafe.connectips_token_configured).toBe(true);
    expect(savedSafe.connectips_cert_pass_configured).toBe(true);

    // Safe view exposes only *_configured indicators, never raw keys
    const { data: safeRow, error: viewErr } = await adminClient
      .from("system_settings_safe")
      .select("setting_value")
      .eq("setting_key", "global")
      .single();
    expect(viewErr).toBeNull();
    expect(safeRow.setting_value.connectips_token).toBeUndefined();
    expect(safeRow.setting_value.connectips_cert_pass).toBeUndefined();
    expect(safeRow.setting_value.connectips_token_configured).toBe(true);
    expect(safeRow.setting_value.connectips_cert_pass_configured).toBe(true);

    // Client SettingsService exposes flags while stripping plaintext secrets
    const clientSettings = await SettingsService.getSettings(true);
    expect(clientSettings.connectips_token).toBe("");
    expect(clientSettings.connectips_cert_pass).toBe("");
    expect(clientSettings.connectips_token_configured).toBe(true);
    expect(clientSettings.connectips_cert_pass_configured).toBe(true);

    // Saving with placeholder preserves raw secret in database
    await adminClient.rpc("save_system_settings_global", {
      p_settings: {
        connectips_token: "••••••••••••",
        connectips_cert_pass: "",
        connectips_app_name: "PreservedApp",
      },
    });
    const { data: rawRow } = await adminClient
      .from("system_settings")
      .select("setting_value")
      .eq("setting_key", "global")
      .single();
    expect(rawRow.setting_value.connectips_token).toBe(testSecretToken);
    expect(rawRow.setting_value.connectips_cert_pass).toBe(testCertPass);
    expect(rawRow.setting_value.connectips_app_name).toBe("PreservedApp");
    expect(rawRow.setting_value.connectips_token_configured).toBeUndefined();

    // Explicit clear flag removes stored key and flips configured flag to false
    const { data: clearedSafe, error: clearErr } = await adminClient.rpc(
      "save_system_settings_global",
      {
        p_settings: {
          connectips_token_clear: true,
        },
      },
    );
    expect(clearErr).toBeNull();
    expect(clearedSafe.connectips_token_configured).toBe(false);
    expect(clearedSafe.connectips_token_clear).toBeUndefined();
  });

  it("synchronizes Processing -> Partial Return -> Settled Completion -> Batch Revert while passing Ledger Sentinel", async () => {
    const { data: comp, error: cErr } = await adminClient
      .from("companies")
      .insert({
        company_name: `ConnectIPS Live Test ${runId}`,
        company_code: `CIPS${Date.now().toString().slice(-6)}`,
        company_type: "Commercial Bank",
        fiscal_year: "2081/82",
      })
      .select("id")
      .single();
    expect(cErr).toBeNull();
    companyId = comp.id;

    const { data: clients, error: clErr } = await adminClient
      .from("clients")
      .insert([
        {
          company_id: companyId,
          client_code: `CL-${runId}-1`,
          boid: `130109${Date.now().toString().slice(-9)}1`,
          full_name: "Aarav Test Settled",
          holder_type: "Public",
          payee_classification: "NATURAL_PERSON",
          classification_status: "CONFIRMED",
          bank_name: "RBB Bank",
          bank_account_no: "001001001",
        },
        {
          company_id: companyId,
          client_code: `CL-${runId}-2`,
          boid: `130109${Date.now().toString().slice(-9)}2`,
          full_name: "Binita Test Returned",
          holder_type: "Public",
          payee_classification: "NATURAL_PERSON",
          classification_status: "CONFIRMED",
          bank_name: "Nabil Bank",
          bank_account_no: "002002002",
        },
      ])
      .select("id");
    expect(clErr).toBeNull();

    const { data: payables, error: pErr } = await adminClient
      .from("dividend_payables")
      .insert([
        {
          company_id: companyId,
          client_id: clients[0].id,
          fiscal_year: "2081/82",
          gross_dividend: 1000,
          tax_amount: 50,
          net_payable: 950,
          payment_status: "Pending",
          payee_classification: "NATURAL_PERSON",
          classification_status: "CONFIRMED",
        },
        {
          company_id: companyId,
          client_id: clients[1].id,
          fiscal_year: "2081/82",
          gross_dividend: 500,
          tax_amount: 25,
          net_payable: 475,
          payment_status: "Pending",
          payee_classification: "NATURAL_PERSON",
          classification_status: "CONFIRMED",
        },
      ])
      .select("id, client_id, net_payable");
    expect(pErr).toBeNull();

    const { data: batch, error: bErr } = await adminClient
      .from("payment_batches")
      .insert({
        batch_name: `NCHL Status Batch ${runId}`,
        company_id: companyId,
        fiscal_year: "2081/82",
        payable_type: "dividend",
        payment_method: "ConnectIPS",
        status: "Approved",
        total_payments: 2,
        total_amount: 1425,
        total_tax: 75,
      })
      .select("id")
      .single();
    expect(bErr).toBeNull();
    batchId = batch.id;

    const { data: pmtRows, error: insPmtErr } = await adminClient
      .from("payments")
      .insert([
        {
          batch_id: batchId,
          company_id: companyId,
          client_id: payables[0].client_id,
          payable_type: "dividend",
          payable_id: payables[0].id,
          gross_amount: 1000,
          tax_amount: 50,
          net_amount: 950,
          paid_amount: 0,
          payment_method: "ConnectIPS",
          status: "Pending",
          bank_account_no: "001001001",
        },
        {
          batch_id: batchId,
          company_id: companyId,
          client_id: payables[1].client_id,
          payable_type: "dividend",
          payable_id: payables[1].id,
          gross_amount: 500,
          tax_amount: 25,
          net_amount: 475,
          paid_amount: 0,
          payment_method: "ConnectIPS",
          status: "Pending",
          bank_account_no: "002002002",
        },
      ])
      .select("id, payable_id");
    expect(insPmtErr).toBeNull();

    const pmt1 = pmtRows.find((r: any) => r.payable_id === payables[0].id);
    const pmt2 = pmtRows.find((r: any) => r.payable_id === payables[1].id);

    // 1. Both accepted into NCHL clearing ('Processing') -> batch becomes 'Processed', payables stay 'Pending'
    const { data: step1, error: s1Err } = await adminClient.rpc("sync_connectips_payment_results", {
      p_batch_id: batchId,
      p_updates: [
        {
          payment_id: pmt1.id,
          status: "PROCESSING",
          connectips_ref: `NCHL-${runId}-1`,
          remarks: "Accepted into NCHL clearing",
        },
        {
          payment_id: pmt2.id,
          status: "ACCEPTED",
          connectips_ref: `NCHL-${runId}-2`,
          remarks: "Accepted into NCHL clearing",
        },
      ],
    });
    expect(s1Err).toBeNull();
    expect(step1.batch_status).toBe("Processed");
    expect(step1.counts).toMatchObject({ processing: 2, settled: 0 });

    const { data: divAfterProc } = await adminClient
      .from("dividend_payables")
      .select("payment_status, paid_amount")
      .eq("company_id", companyId);
    expect(
      divAfterProc.every((d: any) => d.payment_status === "Pending" && Number(d.paid_amount) === 0),
    ).toBe(true);

    // 2. First item settles ('SUCCESS'), second item bounces ('RETURNED')
    const { data: step2, error: s2Err } = await adminClient.rpc("sync_connectips_payment_results", {
      p_batch_id: batchId,
      p_updates: [
        {
          payment_id: pmt1.id,
          status: "SUCCESS",
          connectips_ref: `NCHL-${runId}-1`,
        },
        {
          payment_id: pmt2.id,
          status: "RETURNED",
          remarks: "Account closed",
        },
      ],
    });
    expect(s2Err).toBeNull();
    expect(step2.batch_status).toBe("Processed");

    const { data: p1After } = await adminClient
      .from("dividend_payables")
      .select("payment_status, paid_amount, remaining_amount")
      .eq("id", payables[0].id)
      .single();
    expect(p1After.payment_status).toBe("Paid");
    expect(Number(p1After.paid_amount)).toBe(950);
    expect(Number(p1After.remaining_amount)).toBe(0);

    const { data: p2After } = await adminClient
      .from("dividend_payables")
      .select("payment_status, paid_amount, remaining_amount")
      .eq("id", payables[1].id)
      .single();
    expect(p2After.payment_status).toBe("Pending");
    expect(Number(p2After.paid_amount)).toBe(0);
    expect(Number(p2After.remaining_amount)).toBe(475);

    // Ledger sentinel passes even mid-settlement with 1 settled + 1 returned item!
    const { data: auditMid, error: auditMidErr } = await adminClient.rpc(
      "run_ledger_invariant_audit",
      { p_company_id: companyId },
    );
    expect(auditMidErr).toBeNull();
    expect(auditMid.passed).toBe(true);
    expect(auditMid.total_violations).toBe(0);

    // 3. Remediate & settle second item -> batch transitions automatically to 'Completed'
    const { data: step3, error: s3Err } = await adminClient.rpc("sync_connectips_payment_results", {
      p_batch_id: batchId,
      p_updates: [
        {
          payment_id: pmt2.id,
          status: "Completed",
          connectips_ref: `NCHL-${runId}-2R`,
        },
      ],
    });
    expect(s3Err).toBeNull();
    expect(step3.batch_status).toBe("Completed");
    expect(step3.counts).toMatchObject({ settled: 2, processing: 0, failed: 0, returned: 0 });

    const { data: auditFinal, error: auditFinalErr } = await adminClient.rpc(
      "run_ledger_invariant_audit",
      { p_company_id: companyId },
    );
    expect(auditFinalErr).toBeNull();
    expect(auditFinal.passed).toBe(true);

    // 4. Revert batch even with immutable payment_logs rows attached -> FK ON DELETE SET NULL succeeds!
    const { data: revertRes, error: revErr } = await adminClient.rpc(
      "revert_payment_batch_atomic",
      {
        p_batch_id: batchId,
        p_reason: "ConnectIPS Live Test Cleanup",
      },
    );
    expect(revErr).toBeNull();
    expect(revertRes.success).toBe(true);
    batchId = null;

    const { data: divAfterRev } = await adminClient
      .from("dividend_payables")
      .select("payment_status, paid_amount, remaining_amount")
      .eq("company_id", companyId);
    expect(
      divAfterRev.every((d: any) => d.payment_status === "Pending" && Number(d.paid_amount) === 0),
    ).toBe(true);
  });
});
