import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";

const TEST_ADMIN_PASSWORD = process.env.SUPABASE_TEST_ADMIN_PASSWORD || "Admin123!";
const FIXTURES_DIR = path.resolve(process.cwd(), "test-fixtures");

function ensureDividendAndBankFixtures(): void {
  const needed = ["section1_dividend_payables.xlsx", "section4_bank_statement.xlsx"];
  const missing = needed.filter((f) => !fs.existsSync(path.join(FIXTURES_DIR, f)));
  if (missing.length > 0) {
    execSync("node scripts/verify/generate-all-test-fixtures.mjs", {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  }
}

async function getAdminSupabase() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "http://127.0.0.1:54321";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function cleanupLifecycleData(): Promise<void> {
  const adminClient = await getAdminSupabase();
  if (!adminClient) return;

  const { data: comp } = await adminClient
    .from("companies")
    .select("id")
    .eq("company_code", "E2ELIFE")
    .maybeSingle();

  if (comp?.id) {
    const { data: batches } = await adminClient
      .from("payment_batches")
      .select("id")
      .eq("company_id", comp.id);
    if (batches && batches.length > 0) {
      const bIds = batches.map((b: any) => b.id);
      await adminClient.from("payments").delete().in("batch_id", bIds);
      await adminClient.from("payment_batches").delete().in("id", bIds);
    }
    await adminClient.from("dividend_payables").delete().eq("company_id", comp.id);
    await adminClient.from("bank_statements").delete().eq("company_id", comp.id);
    await adminClient.from("import_staging").delete().eq("company_id", comp.id);
    await adminClient.from("clients").delete().eq("company_id", comp.id);
    await adminClient.from("companies").delete().eq("id", comp.id);
  }

  // Fallback cleanup for batch created under All Schemes scope
  await adminClient.from("payment_batches").delete().ilike("batch_name", "%All Schemes Payout%");
  await adminClient.from("upload_history").delete().ilike("file_name", "section1_dividend%");
  await adminClient.from("clients").delete().ilike("boid", "130102000000000%");
}

ensureDividendAndBankFixtures();

test.describe("Full Financial Lifecycle E2E (Upload -> Batch -> ConnectIPS -> Recon -> Revert -> Sentinel)", () => {
  test.beforeAll(async () => {
    await cleanupLifecycleData();
    const adminClient = await getAdminSupabase();
    if (!adminClient) return;
    const { error } = await adminClient.from("companies").insert({
      company_code: "E2ELIFE",
      company_name: "E2E Lifecycle Assurance Ltd",
      company_type: "Life Insurance",
      fiscal_year: "2081/82",
    });
    if (error) throw error;
  });

  test.afterAll(async () => {
    await cleanupLifecycleData();
  });

  test("executes complete lifecycle and passes ledger invariant sentinel before and after settlement and reversal", async ({
    page,
  }) => {
    test.setTimeout(90000);
    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    // 1. Authenticate as administrator
    await page.goto("/auth");
    await page.locator('input[type="email"]').fill("admin@rbbmbl.com.np");
    await page.locator('input[type="password"]').fill(TEST_ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/.*\/dashboard/, { timeout: 15000 });

    // 2. Verify initial Ledger Invariant Sentinel state on /audit-logs
    await page.goto("/audit-logs");
    await expect(page).toHaveURL(/.*\/audit-logs/);
    await page.locator("button[role='tab']:has-text('System Telemetry')").first().click();
    await expect(page.locator("text=Deterministic Ledger Invariant Sentinel").first()).toBeVisible({
      timeout: 10000,
    });
    await page.locator("button:has-text('Run Audit')").first().click();
    await expect(page.locator("text=ALL INVARIANTS VERIFIED").first()).toBeVisible({
      timeout: 10000,
    });

    // 3. Upload Dividend Payables into E2ELIFE company
    await page.goto("/upload");
    await expect(page).toHaveURL(/.*\/upload/);
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(path.join(FIXTURES_DIR, "section1_dividend_payables.xlsx"));
    await expect(page.locator("text=Dividend_Payables").first()).toBeVisible({ timeout: 15000 });

    const companyTrigger = page
      .locator("div:has(> label:has-text('Assign to Company')) button[role='combobox']")
      .first();
    await companyTrigger.click();
    await page.locator("[role='option']:has-text('E2ELIFE')").first().click();

    const importBtn = page.locator("button:has-text('Import')").first();
    await expect(importBtn).toBeEnabled();
    await importBtn.click();

    const reviewDialog = page.locator("[role='dialog']");
    await expect(reviewDialog).toBeVisible({ timeout: 8000 });
    await expect(
      reviewDialog.locator("text=All rows satisfy mathematical & statutory rules").first(),
    ).toBeVisible({ timeout: 8000 });
    await reviewDialog.locator("#ack-import").check();
    const checkerAck = reviewDialog.locator("#checker-ack");
    if (await checkerAck.isVisible()) {
      await checkerAck.check();
    }
    await reviewDialog
      .locator("button:has-text('Commit Import'), button:has-text('Authorize & Commit')")
      .first()
      .click();

    await expect(reviewDialog).toBeHidden({ timeout: 25000 });
    await expect(page.locator("text=Import Complete").first()).toBeVisible({ timeout: 25000 });

    // 4. Verify uploaded rows appear on /dividend
    await page.goto("/dividend");
    await expect(page.locator("text=Ram Prasad Sharma").first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=HIMALAYAN INVESTMENTS PVT LTD").first()).toBeVisible();

    // 5. Create, Submit, Approve & Complete Payment Batch via ConnectIPS API
    await page.goto("/payments");
    await expect(page.locator("h1:has-text('Payments Module')").first()).toBeVisible({
      timeout: 10000,
    });
    await page.locator("button:has-text('New Payment Batch')").first().click();
    const createDialog = page.locator("[role='dialog']");
    await expect(createDialog.locator("text=Create Payment Batch").first()).toBeVisible({
      timeout: 5000,
    });
    await createDialog.locator("button:has-text('All Schemes')").first().click();
    await expect(createDialog.locator("text=4 payables found matching").first()).toBeVisible({
      timeout: 10000,
    });
    await createDialog.locator("button:has-text('Create Payment Batch')").first().click();
    await expect(page.locator("[role='dialog']:has-text('Create Payment Batch')")).toBeHidden({
      timeout: 15000,
    });

    const autoBatchDialog = page.locator("[role='dialog']:has-text('Batch Details')");
    if (await autoBatchDialog.isVisible()) {
      await page.keyboard.press("Escape");
      await expect(autoBatchDialog).toBeHidden({ timeout: 5000 });
    }

    const batchRow = page.locator("tbody tr", { hasText: "All Schemes Payout" }).first();
    await expect(batchRow).toBeVisible({ timeout: 15000 });
    await batchRow.locator("button:has-text('Submit')").first().click();
    await expect(batchRow.locator("text=Pending").first()).toBeVisible({ timeout: 10000 });

    await batchRow.locator("button:has-text('Approve')").first().click();
    await expect(batchRow.locator("text=Approved").first()).toBeVisible({ timeout: 10000 });

    await batchRow.locator("button:has-text('View')").first().click();
    const batchDialog = page.locator("[role='dialog']");
    await expect(batchDialog.locator("text=Batch Details").first()).toBeVisible({ timeout: 5000 });
    await batchDialog.locator("button:has-text('Disburse via ConnectIPS API')").first().click();
    await expect(batchDialog.locator("text=Completed").first()).toBeVisible({ timeout: 25000 });
    await page.keyboard.press("Escape");
    await expect(batchRow.locator("text=Completed").first()).toBeVisible({ timeout: 10000 });

    // 6. Verify Ledger Invariant Sentinel passes after settlement
    await page.goto("/audit-logs");
    await page.locator("button[role='tab']:has-text('System Telemetry')").first().click();
    await page.locator("button:has-text('Run Audit')").first().click();
    await expect(page.locator("text=ALL INVARIANTS VERIFIED").first()).toBeVisible({
      timeout: 10000,
    });

    // 7. Parse Bank Statement on /reconciliation
    await page.goto("/reconciliation");
    await page
      .locator("#reconcile-bank-upload")
      .setInputFiles(path.join(FIXTURES_DIR, "section4_bank_statement.xlsx"));
    const targetCompDlg = page.locator("[role='dialog']:has-text('Select Target Company')");
    if (await targetCompDlg.isVisible({ timeout: 3000 }).catch(() => false)) {
      await targetCompDlg.locator("button:has-text('E2ELIFE')").first().click();
    }
    await expect(
      page
        .locator("text=DIVIDEND PAYOUT BATCH 1")
        .or(page.locator("text=section4_bank_statement.xlsx"))
        .first(),
    ).toBeVisible({ timeout: 15000 });

    // 8. Revert settled batch on /payments and verify payables return to Pending
    await page.goto("/payments");
    const completedBatchRow = page.locator("tbody tr", { hasText: "All Schemes Payout" }).first();
    await completedBatchRow.locator("button:has-text('Revert')").first().click();
    await expect(completedBatchRow).toBeHidden({ timeout: 20000 });

    await page.goto("/dividend");
    const ramRow = page.locator("tbody tr", { hasText: "Ram Prasad Sharma" }).first();
    await expect(ramRow.locator("text=Pending").first()).toBeVisible({ timeout: 15000 });

    await page.goto("/audit-logs");
    await page.locator("button[role='tab']:has-text('System Telemetry')").first().click();
    await page.locator("button:has-text('Run Audit')").first().click();
    await expect(page.locator("text=ALL INVARIANTS VERIFIED").first()).toBeVisible({
      timeout: 10000,
    });
  });
});
