import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { supabase } from "./database";
import { UploadService } from "./upload.service";

const isLiveDb =
  !process.env.CI ||
  Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_URL !== "http://127.0.0.1:54321",
  );

describe.skipIf(!isLiveDb)("UploadService.rollbackUpload integration test", () => {
  let testCompanyId: string;
  let testClientId: string;
  let testUploadId: string;

  beforeAll(async () => {
    // Authenticate as admin
    await supabase.auth.signInWithPassword({
      email: "admin@rbbmbl.com.np",
      password: "Admin123!",
    });

    // Cleanup any lingering test uploads
    await (supabase as any).from("upload_history").delete().ilike("file_hash", "%mockhash%");
    const { data: comp, error: compErr } = await (supabase as any)
      .from("companies")
      .insert({
        company_name: "Mock Rollback Test Company Ltd",
        company_code: "MRTC",
        status: "Active",
      })
      .select()
      .single();

    if (compErr) throw compErr;
    testCompanyId = comp.id;
  });

  async function ensureClient(code = "MRTC-001", boid = "1301090099999991") {
    const { data: existing } = await (supabase as any)
      .from("clients")
      .select("id")
      .eq("company_id", testCompanyId)
      .eq("boid", boid)
      .maybeSingle();

    if (existing) return existing.id;

    const { data: client, error: clientErr } = await (supabase as any)
      .from("clients")
      .insert({
        company_id: testCompanyId,
        client_code: code,
        boid,
        full_name: "Test Rollback Shareholder",
        bank_name: "Rastriya Banijya Bank",
        bank_account_no: "111000999888",
      })
      .select()
      .single();

    if (clientErr) throw clientErr;
    return client.id;
  }

  afterAll(async () => {
    // Cleanup
    if (testCompanyId) {
      await (supabase as any).from("companies").delete().eq("id", testCompanyId);
    }
  });

  it("atomically rolls back uploaded payables, errors, and marks upload as RolledBack", async () => {
    testClientId = await ensureClient();
    const uniqueHash = `mockhash-${Date.now()}-PUBLIC`;
    const { data: uploadRec, error: uploadErr } = await (supabase as any)
      .from("upload_history")
      .insert({
        file_name: `test-rollback-${Date.now()}.xlsx`,
        file_size: 1024,
        file_type: "debenture",
        sheet_name: "PUBLIC",
        target_table: "interest_payables",
        total_rows: 2,
        success_rows: 2,
        status: "Completed",
        file_hash: uniqueHash,
      })
      .select()
      .single();

    expect(uploadErr).toBeNull();
    testUploadId = uploadRec.id;

    // 2. Insert test payables with this upload_id
    const { error: payErr } = await (supabase as any).from("interest_payables").insert([
      {
        upload_id: testUploadId,
        company_id: testCompanyId,
        client_id: testClientId,
        gross_interest: 1000,
        tax_amount: 60,
        net_payable: 940,
        shares_held: 100,
        due_date: "2026-07-15",
        payment_status: "Pending",
      },
      {
        upload_id: testUploadId,
        company_id: testCompanyId,
        client_id: testClientId,
        gross_interest: 2000,
        tax_amount: 120,
        net_payable: 1880,
        shares_held: 200,
        due_date: "2026-07-15",
        payment_status: "Pending",
      },
    ]);
    expect(payErr).toBeNull();

    // 3. Insert a mock upload error record
    await (supabase as any).from("upload_errors").insert([
      {
        upload_id: testUploadId,
        row_number: 1,
        field_name: "test",
        error_type: "validation",
        error_message: "Test error message",
      },
    ]);

    // Verify records exist before rollback
    const { count: countBefore } = await (supabase as any)
      .from("interest_payables")
      .select("id", { count: "exact", head: true })
      .eq("upload_id", testUploadId);
    expect(countBefore).toBe(2);

    // 4. Perform rollback
    const result = await UploadService.rollbackUpload(testUploadId, "interest_payables");
    expect(result.success).toBe(true);
    expect(result.payablesDeleted).toBe(2);

    // 5. Verify payables are deleted
    const { count: countAfter } = await (supabase as any)
      .from("interest_payables")
      .select("id", { count: "exact", head: true })
      .eq("upload_id", testUploadId);
    expect(countAfter).toBe(0);

    // 6. Verify upload_errors are deleted
    const { count: errCountAfter } = await (supabase as any)
      .from("upload_errors")
      .select("id", { count: "exact", head: true })
      .eq("upload_id", testUploadId);
    expect(errCountAfter).toBe(0);

    // 7. Verify upload_history record status is RolledBack
    const { data: updatedRec } = await (supabase as any)
      .from("upload_history")
      .select("status, completed_at")
      .eq("id", testUploadId)
      .single();
    expect(updatedRec.status).toBe("RolledBack");
    expect(updatedRec.completed_at).not.toBeNull();

    // 8. Test idempotency: rolling back an already rolled back upload succeeds gracefully
    const secondResult = await UploadService.rollbackUpload(testUploadId, "interest_payables");
    expect(secondResult.success).toBe(true);

    // Cleanup upload record
    await (supabase as any).from("upload_history").delete().eq("id", testUploadId);
  });

  it("rolls back all sheets of a multi-sheet workbook atomically with rollbackEntireFile", async () => {
    const baseHash = "a1b2c3d4e5f60718293a4b5c6d7e8f90" + Date.now();
    const fileName = `multi-sheet-test-${Date.now()}.xlsx`;

    // 1. Create two sheets in upload_history for the same file
    const { data: rec1, error: e1 } = await (supabase as any)
      .from("upload_history")
      .insert({
        file_name: fileName,
        file_size: 2048,
        file_type: "debenture",
        sheet_name: "PUBLIC",
        target_table: "interest_payables",
        total_rows: 1,
        success_rows: 1,
        status: "Completed",
        file_hash: `${baseHash}-PUBLIC`,
      })
      .select()
      .single();
    expect(e1).toBeNull();

    const { data: rec2, error: e2 } = await (supabase as any)
      .from("upload_history")
      .insert({
        file_name: fileName,
        file_size: 2048,
        file_type: "debenture",
        sheet_name: "PRIVATE",
        target_table: "interest_payables",
        total_rows: 1,
        success_rows: 1,
        status: "Completed",
        file_hash: `${baseHash}-PRIVATE`,
      })
      .select()
      .single();
    expect(e2).toBeNull();

    // 2. Insert payables for each sheet
    testClientId = await ensureClient();
    const { error: insErr } = await (supabase as any).from("interest_payables").insert([
      {
        upload_id: rec1.id,
        company_id: testCompanyId,
        client_id: testClientId,
        gross_interest: 500,
        tax_amount: 30,
        net_payable: 470,
        shares_held: 50,
        due_date: "2026-07-15",
        payment_status: "Pending",
      },
      {
        upload_id: rec2.id,
        company_id: testCompanyId,
        client_id: testClientId,
        gross_interest: 700,
        tax_amount: 42,
        net_payable: 658,
        shares_held: 70,
        due_date: "2026-07-15",
        payment_status: "Pending",
      },
    ]);
    expect(insErr).toBeNull();

    // 3. Rollback the entire file at once
    const rollbackRes = await UploadService.rollbackEntireFile({ fileName });
    expect(rollbackRes.success).toBe(true);
    expect(rollbackRes.sheetsRolledBack).toBe(2);
    expect(rollbackRes.payablesDeleted).toBe(2);

    // 4. Verify all payables are gone
    const { count: c1 } = await (supabase as any)
      .from("interest_payables")
      .select("id", { count: "exact", head: true })
      .eq("upload_id", rec1.id);
    const { count: c2 } = await (supabase as any)
      .from("interest_payables")
      .select("id", { count: "exact", head: true })
      .eq("upload_id", rec2.id);
    expect(c1).toBe(0);
    expect(c2).toBe(0);

    // 5. Verify both records are marked RolledBack
    const { data: recs } = await (supabase as any)
      .from("upload_history")
      .select("status")
      .in("id", [rec1.id, rec2.id]);
    expect(recs?.every((r: any) => r.status === "RolledBack")).toBe(true);

    // Cleanup
    await (supabase as any).from("upload_history").delete().in("id", [rec1.id, rec2.id]);
  });
});
