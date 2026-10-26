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

  beforeAll(async () => {
    await adminClient.from("clients").delete().ilike("client_code", "CL_SITA%");
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
    };

    const { data: stageData, error: stageErr } = await clientMakerA
      .from("import_staging")
      .insert({
        approval_id: approvalTicketAId,
        company_id: companyAId,
        target_table: "dividend_payables",
        file_name: "dividend_sheet_a.xlsx",
        file_hash: "hash_co_a_12345",
        total_rows: 1,
        source_gross: 15000,
        source_tax: 750,
        source_net: 14250,
        computed_gross: 15000,
        computed_tax: 750,
        computed_net: 14250,
        staged_rows: [stagedRow],
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
    expect(commitRes.rows_committed).toBe(1);
    expect(commitRes.status).toBe("Approved");

    // Verify pending_approvals was updated to Approved
    const { data: finalApproval } = await adminClient
      .from("pending_approvals")
      .select("status, reviewed_by, review_notes")
      .eq("id", approvalTicketAId)
      .single();
    expect(finalApproval?.status).toBe("Approved");
    expect(finalApproval?.reviewed_by).toBe(checkerAId);

    // Verify import_staging was updated to COMMITTED
    const { data: finalStaging } = await adminClient
      .from("import_staging")
      .select("status, committed_at")
      .eq("id", stagedImportAId)
      .single();
    expect(finalStaging?.status).toBe("COMMITTED");
    expect(finalStaging?.committed_at).not.toBeNull();

    // Verify the client record was created in public.clients
    const { data: clientRow } = await adminClient
      .from("clients")
      .select("id, full_name, boid, bank_name, bank_account_no")
      .eq("boid", testBoid1)
      .single();
    expect(clientRow).not.toBeNull();
    expect(clientRow?.full_name).toBe("Sita Sharma");
    expect(clientRow?.bank_name).toBe("Nabil Bank Ltd");

    // Verify the row was inserted into public.dividend_payables
    const { data: payableRow } = await adminClient
      .from("dividend_payables")
      .select("id, client_id, gross_dividend, tax_amount, net_payable, shares_held")
      .eq("company_id", companyAId)
      .eq("client_id", clientRow!.id)
      .single();

    expect(payableRow).not.toBeNull();
    expect(Number(payableRow?.gross_dividend)).toBe(15000);
    expect(Number(payableRow?.tax_amount)).toBe(750);
    expect(Number(payableRow?.net_payable)).toBe(14250);
    expect(Number(payableRow?.shares_held)).toBe(1500);

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

    expect(updatedSched?.delivery_status).toBe("DELIVERED");
    expect(updatedSched?.last_run_at).not.toBeNull();
    expect(updatedSched?.next_run_at).not.toBeNull();
    expect(updatedSched?.last_error).toBeNull();

    // Verify report_versions snapshot was created
    const { data: versionRow } = await adminClient
      .from("report_versions")
      .select("company_id, report_type, report_name")
      .eq("company_id", companyAId)
      .eq("report_type", "tax-register")
      .limit(1)
      .single();

    expect(versionRow).not.toBeNull();
    expect(versionRow?.company_id).toBe(companyAId);
  });
});
