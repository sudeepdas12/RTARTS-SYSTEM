import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ValidationEngine } from "./validation-engine";
import { aggregatePayableCategorySummary } from "./services/payable-summary";

// Local Supabase configuration - strictly read from environment without hardcoded fallbacks
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

const isSupabaseConfigured = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY);

const adminClient = isSupabaseConfigured
  ? createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : (null as any);

describe.skipIf(!isSupabaseConfigured)("Integration Financial & Security Invariants", () => {
  let companyAId: string;
  let companyBId: string;
  let clientAId: string;
  let clientBId: string;
  let adminUserId: string;
  let uploadRecordId: string | undefined;
  let paymentBatchId: string | undefined;
  const createdPaymentIds: string[] = [];
  const createdPayableIds: { table: string; id: string }[] = [];

  beforeAll(async () => {
    if (!adminClient) return;

    const runId = Math.random().toString(36).substring(2, 7).toUpperCase();

    // 1. Create test companies with unique run ID
    const { data: compA, error: compAErr } = await adminClient
      .from("companies")
      .insert({
        company_name: `Test Financial Bank ${runId} Ltd`,
        company_code: `T${runId}A`,
        company_type: "Commercial Bank",
        fiscal_year: "2081/82",
        isin: `NPE${runId}A001`,
      })
      .select("id")
      .single();

    if (compAErr) throw new Error(`Failed to create Company A: ${compAErr.message}`);
    companyAId = compA.id;

    const { data: compB, error: compBErr } = await adminClient
      .from("companies")
      .insert({
        company_name: `Isolated Manufacturing ${runId} Co Ltd`,
        company_code: `T${runId}B`,
        company_type: "Manufacturing",
        fiscal_year: "2081/82",
        isin: `NPE${runId}B002`,
      })
      .select("id")
      .single();

    if (compBErr) throw new Error(`Failed to create Company B: ${compBErr.message}`);
    companyBId = compB.id;

    // 2. Fetch an existing admin user
    const { data: adminUser } = await adminClient.from("profiles").select("id").limit(1).single();
    adminUserId = adminUser?.id;

    // 3. Create test clients
    const { data: clA, error: clAErr } = await adminClient
      .from("clients")
      .insert({
        company_id: companyAId,
        boid: `130100${Date.now().toString().slice(-8)}1`,
        client_code: `CL_${runId}_A`,
        full_name: "Ram Sharma",
        holder_type: "Natural Person - Public",
        payee_classification: "NATURAL_PERSON",
      })
      .select("id")
      .single();
    if (clAErr) throw new Error(`Failed to create Client A: ${clAErr.message}`);
    clientAId = clA.id;

    const { data: clB, error: clBErr } = await adminClient
      .from("clients")
      .insert({
        company_id: companyBId,
        boid: `130100${Date.now().toString().slice(-8)}2`,
        client_code: `CL_${runId}_B`,
        full_name: "Hari Thapa",
        holder_type: "Legal Person",
        payee_classification: "COMPANY_INSTITUTION",
      })
      .select("id")
      .single();
    if (clBErr) throw new Error(`Failed to create Client B: ${clBErr.message}`);
    clientBId = clB.id;
  });

  afterAll(async () => {
    if (!adminClient) return;

    // Teardown all business records in reverse foreign-key dependency order
    try {
      // 1. Delete payment line items
      if (paymentBatchId) {
        await adminClient.from("payments").delete().eq("batch_id", paymentBatchId);
      }
      for (const payId of createdPaymentIds) {
        await adminClient.from("payments").delete().eq("id", payId);
      }

      // 2. Delete payment batch
      if (paymentBatchId) {
        await adminClient.from("payment_batches").delete().eq("id", paymentBatchId);
      }

      // 3. Delete underlying payables
      for (const { table, id } of createdPayableIds) {
        await adminClient.from(table).delete().eq("id", id);
      }

      // 4. Delete upload history record
      if (uploadRecordId) {
        await adminClient.from("upload_history").delete().eq("id", uploadRecordId);
      }

      // 5. Delete clients
      if (clientAId) {
        await adminClient.from("clients").delete().eq("id", clientAId);
      }
      if (clientBId) {
        await adminClient.from("clients").delete().eq("id", clientBId);
      }

      // 6. Delete company access and companies
      if (companyAId) {
        await adminClient.from("user_company_access").delete().eq("company_id", companyAId);
        await adminClient.from("companies").delete().eq("id", companyAId);
      }
      if (companyBId) {
        await adminClient.from("user_company_access").delete().eq("company_id", companyBId);
        await adminClient.from("companies").delete().eq("id", companyBId);
      }
    } catch (cleanupErr) {
      console.warn("Integration test teardown notice:", cleanupErr);
    }
  });

  describe("1. complete_payment_batch_atomic across dividend, interest, mutual_fund", () => {
    it("completes payment batch and updates all 3 payable types to Paid atomically", async () => {
      // 1. Create 1 dividend payable
      const { data: div, error: divErr } = await adminClient
        .from("dividend_payables")
        .insert({
          company_id: companyAId,
          client_id: clientAId,
          fiscal_year: "2081/82",
          gross_dividend: 10000,
          tax_amount: 500,
          net_payable: 9500,
          payment_status: "Pending",
        })
        .select("id")
        .single();
      expect(divErr).toBeNull();
      createdPayableIds.push({ table: "dividend_payables", id: div.id });

      // 1b. Create an upload_history record for foreign key integrity
      const { data: uploadRec } = await adminClient
        .from("upload_history")
        .insert({
          file_name: "test_multi_type_seed.xlsx",
          file_size: 1024,
          status: "Completed",
          total_rows: 3,
          success_rows: 3,
          error_rows: 0,
        })
        .select("id")
        .single();
      uploadRecordId = uploadRec?.id;

      // 2. Create 1 interest payable (requires due_date)
      const { data: intPay, error: intErr } = await adminClient
        .from("interest_payables")
        .insert({
          company_id: companyAId,
          client_id: clientAId,
          fiscal_year: "2081/82",
          gross_interest: 5000,
          tax_amount: 300,
          net_payable: 4700,
          payment_status: "Pending",
          due_date: new Date().toISOString().split("T")[0],
        })
        .select("id")
        .single();
      expect(intErr).toBeNull();
      createdPayableIds.push({ table: "interest_payables", id: intPay.id });

      // 3. Create 1 mutual fund payable (requires upload_id, gross_dividend)
      const { data: mf, error: mfErr } = await adminClient
        .from("mutual_fund_payables")
        .insert({
          upload_id: uploadRec?.id,
          company_id: companyAId,
          client_id: clientAId,
          fiscal_year: "2081/82",
          gross_dividend: 8000,
          tax_amount: 0,
          net_payable: 8000,
          payment_status: "Pending",
        })
        .select("id")
        .single();
      expect(mfErr).toBeNull();
      createdPayableIds.push({ table: "mutual_fund_payables", id: mf.id });

      // 4. Create payment batch
      const { data: batch, error: batchErr } = await adminClient
        .from("payment_batches")
        .insert({
          company_id: companyAId,
          batch_name: "Mixed Multi-Type Batch 001",
          status: "Processed",
          total_payments: 3,
          total_amount: 22200,
          total_tax: 800,
          payment_method: "ConnectIPS",
        })
        .select("id")
        .single();
      expect(batchErr).toBeNull();
      paymentBatchId = batch.id;

      // 5. Create payments line items with logical types ('dividend', 'interest', 'mutual_fund')
      const payments = [
        {
          batch_id: batch.id,
          company_id: companyAId,
          client_id: clientAId,
          payable_type: "dividend",
          payable_id: div.id,
          gross_amount: 10000,
          tax_amount: 500,
          net_amount: 9500,
          paid_amount: 9500,
          payment_method: "ConnectIPS",
          status: "Processed",
        },
        {
          batch_id: batch.id,
          company_id: companyAId,
          client_id: clientAId,
          payable_type: "interest",
          payable_id: intPay.id,
          gross_amount: 5000,
          tax_amount: 300,
          net_amount: 4700,
          paid_amount: 4700,
          payment_method: "ConnectIPS",
          status: "Processed",
        },
        {
          batch_id: batch.id,
          company_id: companyAId,
          client_id: clientAId,
          payable_type: "mutual_fund",
          payable_id: mf.id,
          gross_amount: 8000,
          tax_amount: 0,
          net_amount: 8000,
          paid_amount: 8000,
          payment_method: "ConnectIPS",
          status: "Processed",
        },
      ];

      const { error: pInsertErr } = await adminClient.from("payments").insert(payments);
      expect(pInsertErr).toBeNull();

      // 6. Call complete_payment_batch_atomic RPC
      const { data: rpcRes, error: rpcErr } = await adminClient.rpc(
        "complete_payment_batch_atomic",
        {
          p_batch_id: batch.id,
          p_user_id: adminUserId || null,
        },
      );

      expect(rpcErr).toBeNull();
      expect(rpcRes).toMatchObject({
        success: true,
        batch_id: batch.id,
        payments_updated: 3,
        dividend_payables_updated: 1,
        interest_payables_updated: 1,
        mutual_fund_payables_updated: 1,
      });

      // 7. Verify batch status in payment_batches
      const { data: verifiedBatch } = await adminClient
        .from("payment_batches")
        .select("status, processed_at")
        .eq("id", batch.id)
        .single();
      expect(verifiedBatch?.status).toBe("Completed");
      expect(verifiedBatch?.processed_at).toBeTruthy();

      // 8. Verify all 3 payments are Completed
      const { data: verifiedPayments } = await adminClient
        .from("payments")
        .select("status, payment_date")
        .eq("batch_id", batch.id);
      expect(verifiedPayments?.length).toBe(3);
      for (const p of verifiedPayments || []) {
        expect(p.status).toBe("Completed");
        expect(p.payment_date).toBeTruthy();
      }

      // 9. Verify underlying dividend payable is Paid
      const { data: verifiedDiv } = await adminClient
        .from("dividend_payables")
        .select("payment_status, payment_date")
        .eq("id", div.id)
        .single();
      expect(verifiedDiv?.payment_status).toBe("Paid");
      expect(verifiedDiv?.payment_date).toBeTruthy();

      // 10. Verify underlying interest payable is Paid
      const { data: verifiedInt } = await adminClient
        .from("interest_payables")
        .select("payment_status, payment_date")
        .eq("id", intPay.id)
        .single();
      expect(verifiedInt?.payment_status).toBe("Paid");
      expect(verifiedInt?.payment_date).toBeTruthy();

      // 11. Verify underlying mutual fund payable is Paid
      const { data: verifiedMf } = await adminClient
        .from("mutual_fund_payables")
        .select("payment_status, payment_date")
        .eq("id", mf.id)
        .single();
      expect(verifiedMf?.payment_status).toBe("Paid");
      expect(verifiedMf?.payment_date).toBeTruthy();

      // 12. Verify audit log entry
      const { data: auditLog } = await adminClient
        .from("audit_logs")
        .select("action, table_name, record_id, new_value")
        .eq("record_id", batch.id)
        .eq("action", "COMPLETE_BATCH")
        .order("action_time", { ascending: false })
        .limit(1)
        .single();
      expect(auditLog).toBeTruthy();
      expect(auditLog?.new_value?.status).toBe("Completed");
      expect(auditLog?.new_value?.dividend_updated).toBe(1);
      expect(auditLog?.new_value?.interest_updated).toBe(1);
      expect(auditLog?.new_value?.mutual_fund_updated).toBe(1);
    });
  });

  describe("2. Authenticated Cross-Company RLS Enforcement", () => {
    it("strictly isolates company data for non-admin users with specific company assignment", async () => {
      // 1. Create a non-admin operator user
      const operatorEmail = `operator_${Date.now()}@rbbmbl.com.np`;
      const { data: authUser, error: userErr } = await adminClient.auth.admin.createUser({
        email: operatorEmail,
        password: "OperatorPassword123!",
        email_confirm: true,
      });
      expect(userErr).toBeNull();
      const operatorId = authUser.user.id;

      try {
        // 2. Assign role 'finance_operator'
        await adminClient.from("user_roles").insert({
          user_id: operatorId,
          role: "finance_operator",
        });

        // 3. Assign company access strictly to Company A
        await adminClient.from("user_company_access").insert({
          user_id: operatorId,
          company_id: companyAId,
        });

        // 4. Authenticate as the operator
        const operatorClient = createClient(SUPABASE_URL!, ANON_KEY!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: loginRes, error: loginErr } = await operatorClient.auth.signInWithPassword({
          email: operatorEmail,
          password: "OperatorPassword123!",
        });
        expect(loginErr).toBeNull();
        expect(loginRes.session).toBeTruthy();

        // 5. Query clients: should see Company A clients, but Company B clients must NOT be returned
        const { data: accessibleClients, error: cErr } = await operatorClient
          .from("clients")
          .select("id, company_id");
        expect(cErr).toBeNull();
        const clientIds = (accessibleClients || []).map((c) => c.id);
        expect(clientIds).toContain(clientAId);
        expect(clientIds).not.toContain(clientBId);

        // 6. Direct query for Company B client by id must return nothing (RLS filters it out)
        const { data: isolatedClient } = await operatorClient
          .from("clients")
          .select("id")
          .eq("id", clientBId)
          .maybeSingle();
        expect(isolatedClient).toBeNull();
      } finally {
        // 7. Clean up operator and its access records
        await adminClient.from("user_company_access").delete().eq("user_id", operatorId);
        await adminClient.from("user_roles").delete().eq("user_id", operatorId);
        await adminClient.auth.admin.deleteUser(operatorId);
      }
    });
  });

  describe("3. Workbook Validation & Net Figure Integrity", () => {
    it("rejects invalid net calculations and identifies mismatched calculations", async () => {
      const rows = [
        {
          boid: "1301000000000001",
          full_name: "Ram Sharma",
          gross_amount: 10000,
          tax_amount: 500,
          net_payable: 9000, // Error: 10000 - 500 != 9000 (should be 9500)
        },
      ];

      const mappings = {
        boid: "boid",
        full_name: "full_name",
        gross_amount: "gross_amount",
        tax_amount: "tax_amount",
        net_payable: "net_payable",
      };

      const errors = await ValidationEngine.validateBatch(rows, mappings, undefined, "DIVIDEND");
      const netMismatch = errors.find((e) => e.type === "net_mismatch");
      expect(netMismatch).toBeTruthy();
      expect(netMismatch?.field).toBe("net_payable");
    });

    it("detects missing BOID as a blocking error", async () => {
      const rows = [
        {
          boid: "",
          full_name: "Missing Boid Investor",
          gross_amount: 5000,
          tax_amount: 250,
          net_payable: 4750,
        },
      ];

      const errors = await ValidationEngine.validateBatch(rows, {}, undefined, "DIVIDEND");
      const missingBoid = errors.find((e) => e.type === "missing_boid");
      expect(missingBoid).toBeTruthy();
    });

    it("accepts all real-world Nepalese alphanumeric bank account formats without false notice", async () => {
      const sampleNepaliAccounts = [
        "D107010002342",
        "00103911SA",
        "005000012100U",
        "005000001440L",
        "07900054AD",
        "001-803SP",
        "002144722W",
        "N087004168452401",
        "10DB027786NPR003",
        "15SH039541NPR001",
        "19SB026158NPR001",
        "01610397 GB",
        "20591",
        "01CA000093NPR008",
      ];

      const rows = sampleNepaliAccounts.map((acct, idx) => ({
        boid: `130101000000000${idx + 1}`.slice(0, 16),
        full_name: `Investor ${idx + 1}`,
        bank_account_no: acct,
        gross_amount: 1000,
        tax_amount: 50,
        net_payable: 950,
      }));

      const errors = await ValidationEngine.validateBatch(rows, {}, undefined, "DIVIDEND");
      const bankNotices = errors.filter((e) => e.type === "invalid_bank_account");
      expect(bankNotices.length).toBe(0);
    });

    it("safely skips trailing blank and footer rows without raising false missing BOID/name errors", async () => {
      const rowsWithTrailingBlanks = [
        {
          boid: "1301010000000001",
          full_name: "Genuine Investor",
          gross_amount: 5000,
          tax_amount: 250,
          net_payable: 4750,
        },
        // Trailing empty rows (like rows 868 to 885 in user export)
        {},
        { boid: "", full_name: "" },
        { boid: null, full_name: null, gross_amount: null },
        // Trailing footer / signatory row
        { full_name: "TOTAL", gross_amount: 5000, net_payable: 4750 },
        { full_name: "AUTHORISED SIGNATORY", boid: "" },
      ];

      const errors = await ValidationEngine.validateBatch(
        rowsWithTrailingBlanks,
        {},
        undefined,
        "DIVIDEND",
      );
      const boidErrors = errors.filter((e) => e.type === "missing_boid");
      const nameErrors = errors.filter((e) => e.type === "missing_name");

      // Only 1 real row was provided, so no missing BOID/name errors should be produced for the trailing/footer rows
      expect(boidErrors.length).toBe(0);
      expect(nameErrors.length).toBe(0);
    });

    it("still catches genuinely invalid bank accounts like N/A, NONE, or non-alphanumerics", async () => {
      const invalidRows = [
        {
          boid: "1301010000000001",
          full_name: "Test Investor 1",
          bank_account_no: "N/A",
          gross_amount: 1000,
          tax_amount: 50,
          net_payable: 950,
        },
        {
          boid: "1301010000000002",
          full_name: "Test Investor 2",
          bank_account_no: "???",
          gross_amount: 1000,
          tax_amount: 50,
          net_payable: 950,
        },
      ];

      const errors = await ValidationEngine.validateBatch(invalidRows, {}, undefined, "DIVIDEND");
      const bankNotices = errors.filter((e) => e.type === "invalid_bank_account");
      expect(bankNotices.length).toBe(2);
    });
  });

  describe("4. Report-Total & Summary Aggregation Invariants", () => {
    it("ensures aggregate category summary totals equal individual sum components", () => {
      const payables = [
        {
          company_id: "c1",
          company_name: "Company 1",
          payee_category: "PUBLIC",
          gross_amount: 15000,
          tax_amount: 750,
          net_payable: 14250,
        },
        {
          company_id: "c1",
          company_name: "Company 1",
          payee_category: "INSTITUTION",
          gross_amount: 20000,
          tax_amount: 1000,
          net_payable: 19000,
        },
        {
          company_id: "c1",
          company_name: "Company 1",
          payee_category: "TAX_EXEMPT",
          gross_amount: 5000,
          tax_amount: 0,
          net_payable: 5000,
        },
      ];

      const summary = aggregatePayableCategorySummary(payables);
      const totalGross = summary.reduce((sum, s) => sum + s.grossPayable, 0);
      const totalTax = summary.reduce((sum, s) => sum + s.tax, 0);
      const totalNet = summary.reduce((sum, s) => sum + s.netPayable, 0);

      expect(totalGross).toBe(40000);
      expect(totalTax).toBe(1750);
      expect(totalNet).toBe(38250);
      expect(totalGross - totalTax).toBe(totalNet);
    });
  });
});
