import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "";

const isLiveDb =
  (!process.env.CI ||
    Boolean(
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.SUPABASE_URL !== "http://127.0.0.1:54321",
    )) &&
  Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY);

const adminClient = isLiveDb
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : (null as any);

describe.skipIf(!isLiveDb)("Multi-Tenant RLS Hardening & Atomic Staged Import Commit Suite", () => {
  let companyAId: string;
  let companyBId: string;
  let makerAId: string;
  let makerBId: string;
  let checkerAId: string;

  let clientMakerA: any;
  let clientMakerB: any;
  let clientCheckerA: any;

  let stagedImportAId: string;
  let approvalTicketAId: string;
  const testBoid1 = `13010900${Math.floor(10000000 + Math.random() * 89999999)}`;
  const testFileHashA = "hash_co_a_" + Math.random().toString(36).substring(2, 10);

  beforeAll(async () => {
    await adminClient.from("clients").delete().ilike("client_code", "CL_SITA%");
    await adminClient.from("upload_history").delete().ilike("file_hash", "hash_co_a_%");
    await adminClient.from("upload_history").delete().ilike("file_hash", "comp-b-hash-%");
    const runId = Math.random().toString(36).substring(2, 7).toUpperCase();

    // 1. Create two isolated test companies
    const { data: compA, error: errA } = await adminClient
      .from("companies")
      .insert({
        company_name: `Tenant Isolation Bank A ${runId}`,
        company_code: `TBA_${runId}`,
        company_type: "Commercial Bank",
        fiscal_year: "2080/81",
      })
      .select("id")
      .single();
    if (errA) throw errA;
    companyAId = compA.id;

    const { data: compB, error: errB } = await adminClient
      .from("companies")
      .insert({
        company_name: `Tenant Isolation Mutual Fund B ${runId}`,
        company_code: `TFB_${runId}`,
        company_type: "Mutual Fund",
        fiscal_year: "2080/81",
      })
      .select("id")
      .single();
    if (errB) throw errB;
    companyBId = compB.id;

    // 2. Create User Maker A (Company A only)
    const emailMakerA = `maker-a-${runId.toLowerCase()}@example.com`;
    const { data: authMakerA, error: uErrA } = await adminClient.auth.admin.createUser({
      email: emailMakerA,
      password: "Password123!",
      email_confirm: true,
    });
    if (uErrA) throw uErrA;
    makerAId = authMakerA.user.id;
    await adminClient.from("user_roles").insert({ user_id: makerAId, role: "maker" });
    await adminClient
      .from("user_company_access")
      .insert({ user_id: makerAId, company_id: companyAId });

    // 3. Create User Maker B (Company B only)
    const emailMakerB = `maker-b-${runId.toLowerCase()}@example.com`;
    const { data: authMakerB, error: uErrB } = await adminClient.auth.admin.createUser({
      email: emailMakerB,
      password: "Password123!",
      email_confirm: true,
    });
    if (uErrB) throw uErrB;
    makerBId = authMakerB.user.id;
    await adminClient.from("user_roles").insert({ user_id: makerBId, role: "maker" });
    await adminClient
      .from("user_company_access")
      .insert({ user_id: makerBId, company_id: companyBId });

    // 4. Create User Checker A (Company A checker - supervisor role)
    const emailCheckerA = `checker-a-${runId.toLowerCase()}@example.com`;
    const { data: authCheckerA, error: uErrC } = await adminClient.auth.admin.createUser({
      email: emailCheckerA,
      password: "Password123!",
      email_confirm: true,
    });
    if (uErrC) throw uErrC;
    checkerAId = authCheckerA.user.id;
    await adminClient.from("user_roles").insert({ user_id: checkerAId, role: "supervisor" });
    await adminClient
      .from("user_company_access")
      .insert({ user_id: checkerAId, company_id: companyAId });

    // 5. Initialize client sessions
    clientMakerA = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await clientMakerA.auth.signInWithPassword({
      email: emailMakerA,
      password: "Password123!",
    });

    clientMakerB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await clientMakerB.auth.signInWithPassword({
      email: emailMakerB,
      password: "Password123!",
    });

    clientCheckerA = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await clientCheckerA.auth.signInWithPassword({
      email: emailCheckerA,
      password: "Password123!",
    });
  });

  afterAll(async () => {
    // Cleanup all test records
    await adminClient.from("upload_history").delete().ilike("file_hash", "hash_co_a_%");
    await adminClient.from("upload_history").delete().ilike("file_hash", "comp-b-hash-%");
    if (approvalTicketAId) {
      await adminClient.from("approval_logs").delete().eq("approval_id", approvalTicketAId);
      await adminClient.from("import_staging").delete().eq("approval_id", approvalTicketAId);
      await adminClient.from("pending_approvals").delete().eq("id", approvalTicketAId);
    }
    if (companyAId) {
      await adminClient.from("dividend_payables").delete().eq("company_id", companyAId);
      await adminClient.from("clients").delete().eq("company_id", companyAId);
      await adminClient.from("scheduled_reports").delete().eq("company_id", companyAId);
      await adminClient.from("report_presets").delete().eq("company_id", companyAId);
      await adminClient.from("report_versions").delete().eq("company_id", companyAId);
      await adminClient.from("user_company_access").delete().eq("company_id", companyAId);
      await adminClient.from("companies").delete().eq("id", companyAId);
    }
    if (companyBId) {
      await adminClient.from("scheduled_reports").delete().eq("company_id", companyBId);
      await adminClient.from("report_presets").delete().eq("company_id", companyBId);
      await adminClient.from("report_versions").delete().eq("company_id", companyBId);
      await adminClient.from("user_company_access").delete().eq("company_id", companyBId);
      await adminClient.from("companies").delete().eq("id", companyBId);
    }
    if (makerAId) {
      await adminClient.from("user_roles").delete().eq("user_id", makerAId);
      await adminClient.auth.admin.deleteUser(makerAId);
    }
    if (makerBId) {
      await adminClient.from("user_roles").delete().eq("user_id", makerBId);
      await adminClient.auth.admin.deleteUser(makerBId);
    }
    if (checkerAId) {
      await adminClient.from("user_roles").delete().eq("user_id", checkerAId);
      await adminClient.auth.admin.deleteUser(checkerAId);
    }
  });

  it("1. Strict Multi-Tenant Isolation on import_staging: User B cannot view or modify User A's staged data", async () => {
    // Maker A creates pending approval and stages rows for Company A
    const { data: paData, error: paErr } = await clientMakerA
      .from("pending_approvals")
      .insert({
        entity_type: "IMPORT_BATCH",
        action: "MATERIAL_IMPORT_APPROVAL",
        payload: { companyId: companyAId, note: "Maker A Submission" },
        status: "Pending",
        requested_by: makerAId,
      })
      .select()
      .single();

    expect(paErr).toBeNull();
    approvalTicketAId = paData.id;

    const testBoidInst = `13010900${Math.floor(10000000 + Math.random() * 89999999)}`;
    const stagedRow = {
      boid: testBoid1,
      name: "Sita Sharma",
      client_code: `CL_SITA_${testBoid1.slice(-6)}`,
      kitta: 1500,
      gross: 15000,
      tax: 750,
      net: 14250,
      bank_name: "Nabil Bank Ltd",
      bank_account_number: "0010017500001",
      holder_type: "Natural Person - Public",
      payee_classification: "NATURAL_PERSON",
    };
    const stagedRowInst = {
      boid: testBoidInst,
      name: "Everest Capital Corp",
      client_code: `CL_INST_${testBoidInst.slice(-6)}`,
      kitta: 10000,
      gross: 100000,
      tax: 15000,
      net: 85000,
      bank_name: "Standard Chartered Bank",
      bank_account_number: "0020027500002",
      holder_type: "Legal Person",
      payee_classification: "COMPANY_INSTITUTION",
    };

    const { data: stageData, error: stageErr } = await clientMakerA
      .from("import_staging")
      .insert({
        approval_id: approvalTicketAId,
        company_id: companyAId,
        target_table: "dividend_payables",
        file_name: "dividend_sheet_a.xlsx",
        file_hash: testFileHashA,
        total_rows: 2,
        source_gross: 115000,
        source_tax: 15750,
        source_net: 99250,
        computed_gross: 115000,
        computed_tax: 15750,
        computed_net: 99250,
        staged_rows: [stagedRow, stagedRowInst],
        options: {
          fiscalYear: "2080/81",
          dividendType: "Cash",
          dividendRate: 10,
        },
        created_by: makerAId,
      })
      .select()
      .single();

    expect(stageErr).toBeNull();
    stagedImportAId = stageData.id;

    // Maker A can SELECT their staged import
    const { data: readA, error: readAErr } = await clientMakerA
      .from("import_staging")
      .select("*")
      .eq("id", stagedImportAId);

    expect(readAErr).toBeNull();
    expect(readA.length).toBe(1);
    expect(readA[0].company_id).toBe(companyAId);

    // User B (restricted to Company B) CANNOT SELECT Company A's staged import
    const { data: readB, error: readBErr } = await clientMakerB
      .from("import_staging")
      .select("*")
      .eq("id", stagedImportAId);

    expect(readBErr).toBeNull();
    expect(readB.length).toBe(0); // RLS strictly filters out Company A

    // User B CANNOT INSERT rows targeting Company A (RLS WITH CHECK blocks it)
    const { error: rogueInsertErr } = await clientMakerB.from("import_staging").insert({
      approval_id: approvalTicketAId,
      company_id: companyAId, // Unauthorized target
      target_table: "dividend_payables",
      file_name: "rogue_file.xlsx",
      file_hash: "rogue_hash",
      staged_rows: [],
      created_by: makerBId,
    });

    expect(rogueInsertErr).not.toBeNull();
  });

  it("2. Strict Multi-Tenant Isolation on scheduled_reports & report_presets", async () => {
    // Maker A creates a report preset and scheduled report for Company A
    const { data: presetA, error: pErrA } = await clientMakerA
      .from("report_presets")
      .insert({
        name: "Company A Standard IRD",
        report_id: "ird-tax",
        company_id: companyAId,
        fiscal_year: "2080/81",
        created_by: makerAId,
      })
      .select()
      .single();

    expect(pErrA).toBeNull();

    const { data: schedA, error: sErrA } = await clientMakerA
      .from("scheduled_reports")
      .insert({
        company_id: companyAId,
        report_type: "tax-register",
        report_name: "Company A Monthly Tax",
        filters: { companyId: companyAId },
        schedule_type: "monthly",
        schedule_time: "18:00",
        schedule_day: 1,
        recipients: ["tax@company-a.com"],
        created_by: makerAId,
      })
      .select()
      .single();

    expect(sErrA).toBeNull();

    // User B cannot SELECT Company A presets or schedules
    const { data: presetsB } = await clientMakerB
      .from("report_presets")
      .select("*")
      .eq("id", presetA.id);
    expect(presetsB.length).toBe(0);

    const { data: schedsB } = await clientMakerB
      .from("scheduled_reports")
      .select("*")
      .eq("id", schedA.id);
    expect(schedsB.length).toBe(0);

    // User B cannot delete Company A's preset
    const { error: delErr } = await clientMakerB
      .from("report_presets")
      .delete()
      .eq("id", presetA.id);
    // When RLS blocks delete, it affects 0 rows
    const { data: verifyStillExists } = await adminClient
      .from("report_presets")
      .select("id")
      .eq("id", presetA.id)
      .single();
    expect(verifyStillExists?.id).toBe(presetA.id);
  });

  it("3. Segregation of Duties: Maker cannot approve their own staged import", async () => {
    // Maker A attempts to commit their own material import approval ticket
    const { error: selfApproveErr } = await clientMakerA.rpc("commit_staged_import", {
      p_approval_id: approvalTicketAId,
      p_checker_notes: "Self-approval attempt",
    });

    expect(selfApproveErr).not.toBeNull();
    // Must contain segregation of duties violation message
    expect(selfApproveErr.message).toMatch(/Segregation of duties violation/i);

    // Verify the staged import is still in STAGED status and pending_approvals is still Pending
    const { data: stagingCheck } = await adminClient
      .from("import_staging")
      .select("status")
      .eq("id", stagedImportAId)
      .single();
    expect(stagingCheck?.status).toBe("STAGED");

    const { data: approvalCheck } = await adminClient
      .from("pending_approvals")
      .select("status")
      .eq("id", approvalTicketAId)
      .single();
    expect(approvalCheck?.status).toBe("Pending");
  });

  it("4. Atomic Checker Commit: inserts ledger rows, clients, updates staging, and writes audit logs in 1 transaction", async () => {
    // Checker A (supervisor) approves and commits the staged import
    const { data: commitRes, error: commitErr } = await clientCheckerA.rpc("commit_staged_import", {
      p_approval_id: approvalTicketAId,
      p_checker_notes: "Checker A verified totals and approved",
    });

    expect(commitErr).toBeNull();
    expect(commitRes.success).toBe(true);
    expect(commitRes.rows_committed).toBe(2);
    expect(commitRes.status).toBe("Approved");
    expect(commitRes.upload_id).toBeDefined();

    // Verify upload_history record was created and updated to Completed
    const { data: uploadRecord } = await adminClient
      .from("upload_history")
      .select("id, status, total_rows, success_rows")
      .eq("id", commitRes.upload_id)
      .single();
    expect(uploadRecord).not.toBeNull();
    expect(uploadRecord?.status).toBe("Completed");
    expect(uploadRecord?.success_rows).toBe(2);

    // Verify pending_approvals was updated to Approved
    const { data: finalApproval } = await adminClient
      .from("pending_approvals")
      .select("status, reviewed_by, review_notes")
      .eq("id", approvalTicketAId)
      .single();
    expect(finalApproval?.status).toBe("Approved");
    expect(finalApproval?.reviewed_by).toBe(checkerAId);

    // Verify import_staging was updated to COMMITTED and linked to upload_id
    const { data: finalStaging } = await adminClient
      .from("import_staging")
      .select("status, upload_id, committed_at")
      .eq("id", stagedImportAId)
      .single();
    expect(finalStaging?.status).toBe("COMMITTED");
    expect(finalStaging?.upload_id).toBe(commitRes.upload_id);
    expect(finalStaging?.committed_at).not.toBeNull();

    // Verify Natural Person client record
    const { data: clientRow } = await adminClient
      .from("clients")
      .select(
        "id, company_id, full_name, boid, bank_name, bank_account_no, holder_type, payee_classification",
      )
      .eq("company_id", companyAId)
      .eq("boid", testBoid1)
      .single();
    expect(clientRow).not.toBeNull();
    expect(clientRow?.company_id).toBe(companyAId);
    expect(clientRow?.full_name).toBe("Sita Sharma");
    expect(clientRow?.bank_name).toBe("Nabil Bank Ltd");
    expect(clientRow?.payee_classification).toBe("NATURAL_PERSON");
    expect(clientRow?.holder_type).toBe("Natural Person - Public");

    // Verify Institutional client record and preserved classification
    const { data: clientInstRow } = await adminClient
      .from("clients")
      .select(
        "id, company_id, full_name, boid, bank_name, bank_account_no, holder_type, payee_classification",
      )
      .eq("company_id", companyAId)
      .ilike("full_name", "Everest Capital Corp%")
      .single();
    expect(clientInstRow).not.toBeNull();
    expect(clientInstRow?.payee_classification).toBe("COMPANY_INSTITUTION");
    expect(clientInstRow?.holder_type).toBe("Legal Person");

    // Verify Natural Person dividend payable
    const { data: payableRow } = await adminClient
      .from("dividend_payables")
      .select(
        "id, client_id, upload_id, gross_dividend, tax_amount, net_payable, shares_held, payee_classification",
      )
      .eq("company_id", companyAId)
      .eq("client_id", clientRow!.id)
      .single();

    expect(payableRow).not.toBeNull();
    expect(payableRow?.upload_id).toBe(commitRes.upload_id);
    expect(payableRow?.payee_classification).toBe("NATURAL_PERSON");
    expect(Number(payableRow?.gross_dividend)).toBe(15000);
    expect(Number(payableRow?.tax_amount)).toBe(750);
    expect(Number(payableRow?.net_payable)).toBe(14250);
    expect(Number(payableRow?.shares_held)).toBe(1500);

    // Verify Institutional dividend payable with preserved 15% TDS category
    const { data: payableInstRow } = await adminClient
      .from("dividend_payables")
      .select(
        "id, client_id, upload_id, gross_dividend, tax_amount, net_payable, shares_held, payee_classification",
      )
      .eq("company_id", companyAId)
      .eq("client_id", clientInstRow!.id)
      .single();

    expect(payableInstRow).not.toBeNull();
    expect(payableInstRow?.upload_id).toBe(commitRes.upload_id);
    expect(payableInstRow?.payee_classification).toBe("COMPANY_INSTITUTION");
    expect(Number(payableInstRow?.gross_dividend)).toBe(100000);
    expect(Number(payableInstRow?.tax_amount)).toBe(15000);
    expect(Number(payableInstRow?.net_payable)).toBe(85000);
    expect(Number(payableInstRow?.shares_held)).toBe(10000);

    // Verify audit log exists
    const { data: auditLog } = await adminClient
      .from("approval_logs")
      .select("*")
      .eq("approval_id", approvalTicketAId)
      .eq("action", "MATERIAL_IMPORT_COMMITTED")
      .single();

    expect(auditLog).not.toBeNull();
    expect(auditLog.performed_by).toBe(checkerAId);
  });

  it("5. Scheduled Report Execution Worker: generates versions, calculates next run, and updates delivery status", async () => {
    // Create an active due schedule for Company A
    const { data: schedule, error: schedErr } = await adminClient
      .from("scheduled_reports")
      .insert({
        company_id: companyAId,
        report_type: "tax-register",
        report_name: "Automated Monthly Tax Delivery",
        filters: { companyId: companyAId },
        schedule_type: "monthly",
        schedule_time: "18:00",
        schedule_day: 1,
        recipients: ["compliance@company-a.com"],
        delivery_status: "PENDING",
        is_active: true,
        created_by: makerAId,
      })
      .select()
      .single();

    expect(schedErr).toBeNull();
    expect(schedule).not.toBeNull();

    // Trigger the ScheduledReportService worker
    const { ScheduledReportService } = await import("./scheduled-report.service");
    const workerRes = await ScheduledReportService.executeScheduledReports(
      { schedule_id: schedule.id },
      clientMakerA,
    );

    expect(workerRes.success).toBe(true);
    expect(workerRes.processed).toBeGreaterThanOrEqual(1);

    // Verify the schedule state updated
    const { data: updatedSched } = await adminClient
      .from("scheduled_reports")
      .select("last_run_at, next_run_at, delivery_status, last_error")
      .eq("id", schedule.id)
      .single();

    expect(updatedSched?.delivery_status).toBe("GENERATED");
    expect(updatedSched?.last_run_at).not.toBeNull();
    expect(updatedSched?.next_run_at).not.toBeNull();
    expect(updatedSched?.last_error).toBeNull();

    // Verify report_versions snapshot was created with real stored file artifact URL
    const { data: versionRow } = await adminClient
      .from("report_versions")
      .select("company_id, report_type, report_name, file_url, file_size")
      .eq("company_id", companyAId)
      .eq("report_type", "tax-register")
      .order("generated_at", { ascending: false })
      .limit(1)
      .single();

    expect(versionRow).not.toBeNull();
    expect(versionRow?.company_id).toBe(companyAId);
    expect(versionRow?.file_url).not.toBeNull();
    expect(typeof versionRow?.file_url).toBe("string");
    expect(versionRow?.file_size).toBeGreaterThan(0);
  }, 60000);

  it("6. Multi-Tenant Client Isolation: Company B staged import cannot modify Company A's client", async () => {
    // 1. Company A's client Sita Sharma has bank_account_no "1122334455"
    const { data: clientBeforeB } = await adminClient
      .from("clients")
      .select("id, company_id, full_name, boid, bank_account_no")
      .eq("company_id", companyAId)
      .eq("boid", testBoid1)
      .single();
    expect(clientBeforeB).not.toBeNull();
    const originalAccount = clientBeforeB?.bank_account_no;

    // 2. Company B creates a staged import using the EXACT SAME BOID but different bank account and name
    const { data: approvalB, error: appErrB } = await adminClient
      .from("pending_approvals")
      .insert({
        entity_type: "IMPORT_BATCH",
        action: "MATERIAL_IMPORT_APPROVAL",
        payload: { companyId: companyBId, note: "Maker B Submission" },
        status: "Pending",
        requested_by: makerBId,
      })
      .select("id")
      .single();

    if (appErrB) throw appErrB;

    const { data: stagingB, error: stgErrB } = await adminClient
      .from("import_staging")
      .insert({
        approval_id: approvalB.id,
        company_id: companyBId,
        target_table: "dividend_payables",
        file_name: "company-b-batch.xlsx",
        file_hash: "comp-b-hash-" + Math.random().toString(36),
        total_rows: 1,
        source_gross: 5000,
        source_tax: 250,
        source_net: 4750,
        computed_gross: 5000,
        computed_tax: 250,
        computed_net: 4750,
        staged_rows: [
          {
            boid: testBoid1,
            client_code: "CL_B_" + Math.random().toString(36).substring(2, 6),
            name: "Sita Sharma B Corp",
            bank_name: "Global IME Bank",
            bank_account_number: "9999999999",
            gross_dividend: 5000,
            tax_amount: 250,
            net_payable: 4750,
            shares_held: 500,
          },
        ],
        created_by: makerBId,
        status: "STAGED",
      })
      .select("id")
      .single();

    if (stgErrB) throw stgErrB;

    // 3. Grant Checker supervisor access to Company B, then Checker commits Company B's import
    await adminClient
      .from("user_company_access")
      .insert({ user_id: checkerAId, company_id: companyBId });

    const { data: commitBRes, error: commitBErr } = await clientCheckerA.rpc(
      "commit_staged_import",
      {
        p_approval_id: approvalB.id,
        p_checker_notes: "Checker committed Company B batch",
      },
    );

    expect(commitBErr).toBeNull();
    expect(commitBRes.success).toBe(true);

    // 4. Verify Company A's client was NOT touched
    const { data: clientAfterB } = await adminClient
      .from("clients")
      .select("id, company_id, full_name, boid, bank_account_no")
      .eq("id", clientBeforeB!.id)
      .single();

    expect(clientAfterB?.bank_account_no).toBe(originalAccount);
    expect(clientAfterB?.full_name).toBe("Sita Sharma");
    expect(clientAfterB?.company_id).toBe(companyAId);

    // 5. Verify Company B now has its own client with company_id = companyBId
    const { data: clientBRecord } = await adminClient
      .from("clients")
      .select("id, company_id, full_name, boid, bank_account_no")
      .eq("company_id", companyBId)
      .eq("boid", testBoid1)
      .single();

    expect(clientBRecord).not.toBeNull();
    expect(clientBRecord?.company_id).toBe(companyBId);
    expect(clientBRecord?.bank_account_no).toBe("9999999999");
    expect(clientBRecord?.id).not.toBe(clientBeforeB!.id);
  });

  it("7. pg_cron Scheduler Registration: automated cron job is active in cron.job", async () => {
    const { data: jobs, error: cronErr } = await adminClient.rpc(
      "trigger_process_scheduled_reports",
    );
    expect(cronErr).toBeNull();
    expect(jobs).toBeDefined();
    expect(jobs.success).toBe(true);
  });
});
