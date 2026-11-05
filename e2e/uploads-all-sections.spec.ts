import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";

const TEST_ADMIN_PASSWORD = process.env.SUPABASE_TEST_ADMIN_PASSWORD || "Admin123!";
const FIXTURES_DIR = path.resolve(process.cwd(), "test-fixtures");

const REQUIRED_FIXTURES = [
  "section1_dividend_payables.xlsx",
  "section2_debenture_interest.xlsx",
  "section3_mutual_fund.xlsx",
  "section4_bank_statement.xlsx",
  "section4_bank_statement.csv",
  "section5_clients_master.xlsx",
  "section6_companies_master.xlsx",
  "edge_case_math_mismatch.xlsx",
  "edge_case_invalid_boid.xlsx",
];

/**
 * The spreadsheet fixtures live in test-fixtures/ but are intentionally gitignored
 * (*.xlsx / *.xls / *.csv, see .gitignore) because they resemble financial data.
 * They are regenerated deterministically from scripts/generate_all_test_fixtures.mjs.
 * Regenerate them on demand so a fresh checkout always has a complete matrix.
 */
function ensureFixtures(): void {
  const missing = REQUIRED_FIXTURES.filter((file) => !fs.existsSync(path.join(FIXTURES_DIR, file)));
  if (missing.length === 0) return;
  console.log(
    `[uploads-all-sections] ${missing.length} fixture(s) missing (${missing.join(", ")}) — regenerating…`,
  );
  execSync("node scripts/generate_all_test_fixtures.mjs", {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

ensureFixtures();

test.describe("Comprehensive Upload & Ingestion Across All Sections", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    // Log in as admin
    await page.goto("/auth");
    await page.locator('input[type="email"]').fill("admin@rbbmbl.com.np");
    await page.locator('input[type="password"]').fill(TEST_ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/.*\/dashboard/, { timeout: 15000 });
  });

  test.afterAll(async () => {
    // Idempotent cleanup for local runs: remove any test-specific upload artifacts
    try {
      const url = process.env.VITE_SUPABASE_URL || "http://127.0.0.1:54321";
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!key) return;
      const { createClient } = await import("@supabase/supabase-js");
      const adminClient = createClient(url, key);

      // Clean up in FK-safe reverse dependency order:
      // 1. Payment line items & payment batches linked to test files
      const { data: batches } = await adminClient
        .from("payment_batches")
        .select("id")
        .ilike("batch_name", "%section%");
      if (batches && batches.length > 0) {
        const bIds = batches.map((b) => b.id);
        await adminClient.from("payment_line_items").delete().in("batch_id", bIds);
        await adminClient.from("payment_batches").delete().in("id", bIds);
      }

      // 2. Payables created by tests
      await adminClient.from("dividend_payables").delete().ilike("remarks", "%section%");
      await adminClient.from("interest_payables").delete().ilike("remarks", "%section%");

      // 3. Staging and history records
      await adminClient.from("import_staging").delete().ilike("file_name", "section%");
      await adminClient.from("upload_history").delete().ilike("file_name", "section%");
      await adminClient.from("upload_history").delete().ilike("file_name", "edge_case%");

      // 4. Test clients (boids starting with test prefix 130102000000000)
      await adminClient.from("clients").delete().ilike("boid", "130102000000000%");

      // 5. Test companies
      await adminClient.from("companies").delete().ilike("company_code", "TESTCO");
      await adminClient.from("companies").delete().ilike("company_name", "section1 payables%");
      await adminClient
        .from("companies")
        .delete()
        .ilike("company_name", "Test Commercial Corporation%");

      // 6. Verification probe: verify test companies are purged.
      // Two separate filters (instead of `.or(...)`) to avoid `.or()` value-space parsing quirks.
      const [probeCode, probeName] = await Promise.all([
        adminClient.from("companies").select("id").eq("company_code", "TESTCO"),
        adminClient.from("companies").select("id").ilike("company_name", "section1 payables%"),
      ]);
      const remainingComps = [...(probeCode.data || []), ...(probeName.data || [])];
      if (remainingComps.length > 0) {
        console.warn(
          `[uploads-all-sections] Cleanup probe: ${remainingComps.length} company row(s) still remain.`,
        );
      }
    } catch (cleanErr) {
      console.warn("[uploads-all-sections] Cleanup warning:", cleanErr);
    }
  });

  test("1. Universal Wizard (/upload) handles Dividend Payables with full review flow", async ({
    page,
  }) => {
    await page.goto("/upload");
    await expect(page).toHaveURL(/.*\/upload/);
    await expect(page.locator("text=Upload Data").first()).toBeVisible();

    // Upload section1_dividend_payables.xlsx
    const fileInput = page.locator('input[type="file"]').first();
    const filePath = path.join(FIXTURES_DIR, "section1_dividend_payables.xlsx");
    await fileInput.setInputFiles(filePath);

    // Verify file parsed toast or sheet preview appears
    await expect(
      page.locator("text=Dividend_Payables").or(page.locator("text=File parsed")).first(),
    ).toBeVisible({ timeout: 15000 });

    // Verify parsed data card and preview table
    await expect(page.locator("text=Ram Prasad Sharma").first()).toBeVisible();
    await expect(page.locator("text=HIMALAYAN INVESTMENTS PVT LTD").first()).toBeVisible();

    // Trigger Import Review
    const importButton = page.locator("button:has-text('Import')").first();
    await expect(importButton).toBeEnabled();
    await importButton.click();

    // Verify Pre-Import Review dialog opens
    const reviewDialog = page.locator("[role='dialog']");
    await expect(reviewDialog).toBeVisible({ timeout: 8000 });
    await expect(reviewDialog).toContainText(/Pre-Import Financial & Statutory Checkpoint/i);

    // Check operator acknowledgment checkbox
    const ackCheckbox = reviewDialog.locator("#ack-import");
    if (await ackCheckbox.isVisible()) {
      await ackCheckbox.check();
    }

    // If checker acknowledgment is needed (e.g., material import), check it
    const checkerAck = reviewDialog.locator("#checker-ack");
    if (await checkerAck.isVisible()) {
      await checkerAck.check();
    }

    // Click confirm / commit button
    const confirmBtn = reviewDialog
      .locator("button:has-text('Commit Import'), button:has-text('Authorize & Commit')")
      .first();
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // Verify progress or completion toast or summary
    await expect(
      page
        .locator("text=Import Complete")
        .or(page.locator("text=imported successfully"))
        .or(page.locator("[data-sonner-toast]"))
        .first(),
    ).toBeVisible({ timeout: 20000 });
  });

  test("2. Universal Wizard flags Edge Case 1: Mathematical Discrepancy", async ({ page }) => {
    await page.goto("/upload");
    const fileInput = page.locator('input[type="file"]').first();
    const filePath = path.join(FIXTURES_DIR, "edge_case_math_mismatch.xlsx");
    await fileInput.setInputFiles(filePath);

    await expect(page.locator("text=Mismatch").first()).toBeVisible({ timeout: 15000 });

    // Click "Validate Only" to run ValidationEngine
    const validateBtn = page.locator("button:has-text('Validate Only')");
    await expect(validateBtn).toBeVisible({ timeout: 5000 });
    await validateBtn.click();

    // Verify math mismatch validation error report appears
    const validationWarning = page
      .locator("text=Suspicious net payable")
      .or(page.locator("text=net_mismatch"))
      .or(page.locator("text=Validation Issues"));
    await expect(validationWarning.first()).toBeVisible({ timeout: 10000 });
  });

  test("3. Universal Wizard flags Edge Case 2: Invalid/Truncated Demat BOID", async ({ page }) => {
    await page.goto("/upload");
    const fileInput = page.locator('input[type="file"]').first();
    const filePath = path.join(FIXTURES_DIR, "edge_case_invalid_boid.xlsx");
    await fileInput.setInputFiles(filePath);

    await expect(page.locator("text=InvalidBOID").first()).toBeVisible({ timeout: 15000 });

    // Click "Validate Only" to run ValidationEngine
    const validateBtn = page.locator("button:has-text('Validate Only')");
    await expect(validateBtn).toBeVisible({ timeout: 5000 });
    await validateBtn.click();

    // Verify BOID validation error is surfaced
    const boidError = page
      .locator("text=Demat BOID")
      .or(page.locator("text=invalid_boid"))
      .or(page.locator("text=16 digits"));
    await expect(boidError.first()).toBeVisible({ timeout: 10000 });
  });

  test("4. Universal Wizard correctly detects Debenture and Mutual Fund file types", async ({
    page,
  }) => {
    await page.goto("/upload");

    // Debenture
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(path.join(FIXTURES_DIR, "section2_debenture_interest.xlsx"));
    await expect(page.locator("text=Debenture_Interest").first()).toBeVisible({ timeout: 15000 });
    // Verify Debenture rate/type selected
    await expect(page.locator("text=Debenture").first()).toBeVisible();

    // Refresh and test Mutual Fund
    await page.goto("/upload");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(path.join(FIXTURES_DIR, "section3_mutual_fund.xlsx"));
    await expect(page.locator("text=Mutual_Fund_Distribution").first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator("text=Mutual Fund").first()).toBeVisible();
  });

  test("5. Clients Master Data import parses and saves shareholders", async ({ page }) => {
    await page.goto("/clients");
    await expect(page).toHaveURL(/.*\/clients/);
    await expect(page.locator("text=Clients & Shareholders").first()).toBeVisible({
      timeout: 10000,
    });

    const clientFileInput = page.locator('input[type="file"]').first();
    await clientFileInput.setInputFiles(path.join(FIXTURES_DIR, "section5_clients_master.xlsx"));

    // Verify toast or notification of import success
    await expect(
      page
        .locator("text=imported")
        .or(page.locator("text=Successfully").or(page.locator("[data-sonner-toast]"))),
    ).toBeVisible({ timeout: 15000 });
  });

  test("6. Companies Master Data import parses and registers new company", async ({ page }) => {
    await page.goto("/companies");
    await expect(page).toHaveURL(/.*\/companies/);
    await expect(page.locator("text=Companies & Issuers").first()).toBeVisible({ timeout: 10000 });

    const compFileInput = page.locator('input[type="file"]').first();
    await compFileInput.setInputFiles(path.join(FIXTURES_DIR, "section6_companies_master.xlsx"));

    // Verify toast or notification of company import
    await expect(
      page
        .locator("text=imported")
        .or(page.locator("text=saved").or(page.locator("[data-sonner-toast]"))),
    ).toBeVisible({ timeout: 15000 });
  });

  test("7. Bank Statement upload on /reconciliation parses transactions", async ({ page }) => {
    await page.goto("/reconciliation");
    await expect(page).toHaveURL(/.*\/reconciliation/);
    await expect(page.locator("text=Bank Reconciliation").first()).toBeVisible({ timeout: 10000 });

    // Target #reconcile-bank-upload
    const bankFileInput = page.locator("#reconcile-bank-upload");
    await bankFileInput.setInputFiles(path.join(FIXTURES_DIR, "section4_bank_statement.xlsx"));

    // Verify bank statement processed or transaction summary shows up
    await expect(
      page
        .locator("text=DIVIDEND PAYOUT BATCH 1")
        .or(page.locator("text=section4_bank_statement.xlsx"))
        .or(page.locator("[data-sonner-toast]")),
    ).toBeVisible({ timeout: 15000 });
  });
});
