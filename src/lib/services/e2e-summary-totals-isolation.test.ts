import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const isLiveDb =
  !process.env.CI ||
  Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_URL !== "http://127.0.0.1:54321",
  );

const adminClient = isLiveDb
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : (null as any);

describe.skipIf(!isLiveDb)("E2E Summary Totals & Tenant Isolation Invariants", () => {
  let companyAId: string;
  let companyBId: string;
  let testUserId: string;
  let userClient: any;

  beforeAll(async () => {
    const runId = Math.random().toString(36).substring(2, 7).toUpperCase();

    // 1. Create two test companies
    const { data: compA, error: errA } = await adminClient
      .from("companies")
      .insert({
        company_name: `Isolation Test Co A ${runId}`,
        company_code: `ISOA${runId}`,
        company_type: "Mutual Fund",
      })
      .select("id")
      .single();
    if (errA) throw errA;
    companyAId = compA.id;

    const { data: compB, error: errB } = await adminClient
      .from("companies")
      .insert({
        company_name: `Isolation Test Co B ${runId}`,
        company_code: `ISOB${runId}`,
        company_type: "Mutual Fund",
      })
      .select("id")
      .single();
    if (errB) throw errB;
    companyBId = compB.id;

    // 2. Create clients for Company B
    const { data: client1, error: c1Err } = await adminClient
      .from("clients")
      .insert({
        company_id: companyBId,
        client_code: `C1_${runId}`,
        full_name: "Test Holder Natural",
        holder_type: "Natural Person - Public",
        payee_classification: "NATURAL_PERSON",
        classification_status: "AUTO_CLASSIFIED",
      })
      .select("id")
      .single();
    if (c1Err) throw c1Err;

    const { data: client2, error: c2Err } = await adminClient
      .from("clients")
      .insert({
        company_id: companyBId,
        client_code: `C2_${runId}`,
        full_name: "Test Holder Institution",
        holder_type: "Legal Person",
        payee_classification: "COMPANY_INSTITUTION",
        classification_status: "AUTO_CLASSIFIED",
      })
      .select("id")
      .single();
    if (c2Err) throw c2Err;

    // 3. Insert test payables into Company B
    const { error: insErr } = await adminClient.from("mutual_fund_payables").insert([
      {
        company_id: companyBId,
        client_id: client1.id,
        fiscal_year: "2081/82",
        shares_held: 1000,
        gross_dividend: 5000,
        tds_rate: 0.05,
        tax_amount: 250,
        net_payable: 4750,
        paid_amount: 1000,
        remaining_amount: 3750,
        payment_status: "Partial",
        payee_classification: "NATURAL_PERSON",
        classification_status: "AUTO_CLASSIFIED",
      },
      {
        company_id: companyBId,
        client_id: client2.id,
        fiscal_year: "2081/82",
        shares_held: 2000,
        gross_dividend: 10000,
        tds_rate: 0.15,
        tax_amount: 1500,
        net_payable: 8500,
        paid_amount: 0,
        remaining_amount: 8500,
        payment_status: "Pending",
        payee_classification: "COMPANY_INSTITUTION",
        classification_status: "AUTO_CLASSIFIED",
      },
    ]);
    if (insErr) throw insErr;

    // 3. Create a restricted test user with maker role assigned ONLY to Company A
    const testEmail = `iso-user-${runId.toLowerCase()}@example.com`;
    const { data: userAuth, error: uErr } = await adminClient.auth.admin.createUser({
      email: testEmail,
      password: "Password123!",
      email_confirm: true,
    });
    if (uErr) throw uErr;
    testUserId = userAuth.user.id;

    await adminClient.from("user_roles").insert({ user_id: testUserId, role: "maker" });
    await adminClient
      .from("user_company_access")
      .insert({ user_id: testUserId, company_id: companyAId });

    // Client logged in as test user
    const loginClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: loginData, error: loginErr } = await loginClient.auth.signInWithPassword({
      email: testEmail,
      password: "Password123!",
    });
    if (loginErr) throw loginErr;
    const token = loginData.session!.access_token;
    userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  });

  afterAll(async () => {
    if (testUserId) {
      await adminClient.from("user_company_access").delete().eq("user_id", testUserId);
      await adminClient.from("user_roles").delete().eq("user_id", testUserId);
      await adminClient.auth.admin.deleteUser(testUserId);
    }
    if (companyBId) {
      await adminClient.from("mutual_fund_payables").delete().eq("company_id", companyBId);
      await adminClient.from("clients").delete().eq("company_id", companyBId);
      await adminClient.from("companies").delete().eq("id", companyBId);
    }
    if (companyAId) {
      await adminClient.from("companies").delete().eq("id", companyAId);
    }
  });

  it("strictly hides Company B payables totals from user restricted to Company A", async () => {
    const { data: totals, error } = await userClient.rpc("get_mutual_fund_payables_totals", {
      p_company_id: companyBId,
    });
    expect(error).toBeNull();
    expect(totals.count).toBe(0);
    expect(totals.net).toBe(0);
    expect(totals.remaining).toBe(0);
  });

  it("strictly hides Company B distribution summary from user restricted to Company A", async () => {
    const { data: summary, error } = await userClient.rpc("get_mutual_fund_distribution_summary", {
      p_company_id: companyBId,
    });
    expect(error).toBeNull();
    expect(summary).toEqual([]);
  });

  it("calculates exact partial payment remaining amount in get_available_payables_preview and get_mutual_fund_payables_totals", async () => {
    const { data: totals, error: totErr } = await adminClient.rpc(
      "get_mutual_fund_payables_totals",
      {
        p_company_id: companyBId,
      },
    );
    expect(totErr).toBeNull();
    expect(totals.count).toBe(2);
    expect(totals.partialCount).toBe(1);
    expect(totals.pendingCount).toBe(1);
    expect(totals.gross).toBe(15000);
    expect(totals.tax).toBe(1750);
    expect(totals.net).toBe(13250);
    expect(totals.disbursed).toBe(1000);
    // Remaining = 3750 + 8500 = 12250 (NOT 13250)
    expect(totals.remaining).toBe(12250);

    const { data: preview, error: prevErr } = await adminClient.rpc(
      "get_available_payables_preview",
      {
        p_company_id: companyBId,
        p_payable_type: "mutual_fund",
      },
    );
    expect(prevErr).toBeNull();
    expect(preview.count).toBe(2);
    // totalAmount must match remaining available disbursement balance (12250)
    expect(preview.totalAmount).toBe(12250);
  });

  it("reveals Company B data once company access is granted to user", async () => {
    // Grant access to Company B
    await adminClient
      .from("user_company_access")
      .insert({ user_id: testUserId, company_id: companyBId });

    const { data: totals, error } = await userClient.rpc("get_mutual_fund_payables_totals", {
      p_company_id: companyBId,
    });
    expect(error).toBeNull();
    expect(totals.count).toBe(2);
    expect(totals.net).toBe(13250);
    expect(totals.remaining).toBe(12250);

    const { data: summary, error: sumErr } = await userClient.rpc(
      "get_mutual_fund_distribution_summary",
      {
        p_company_id: companyBId,
      },
    );
    expect(sumErr).toBeNull();
    expect(summary.length).toBe(2);
    const pub = summary.find((s: any) => s.type === "PUBLIC");
    const inst = summary.find((s: any) => s.type === "INSTITUTION");
    expect(pub).toBeDefined();
    expect(pub.net).toBe(4750);
    expect(inst).toBeDefined();
    expect(inst.net).toBe(8500);
  });
});
