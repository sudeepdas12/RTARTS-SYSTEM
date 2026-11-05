import { test, expect } from "@playwright/test";

const TEST_ADMIN_PASSWORD = process.env.SUPABASE_TEST_ADMIN_PASSWORD || "Admin123!";

test.describe("Operations Section Comprehensive End-to-End Suite", () => {
  test.beforeEach(async ({ page }) => {
    // Log in as administrator
    await page.goto("/auth");
    await page.locator('input[type="email"]').fill("admin@rbbmbl.com.np");
    await page.locator('input[type="password"]').fill(TEST_ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/.*\/dashboard/, { timeout: 15000 });
  });

  test("1. Payments: Batches management, period presets, installment legs, and shareholder search", async ({
    page,
  }) => {
    await page.goto("/payments");
    await expect(page).toHaveURL(/.*\/payments/);

    // Verify Page Header
    await expect(page.locator("h1:has-text('Payments Module')").first()).toBeVisible({
      timeout: 10000,
    });

    // Check tabs
    const batchesTab = page.locator("button[role='tab']:has-text('Payment Batches')").first();
    const shareholdersTab = page
      .locator("button[role='tab']:has-text('Shareholder Payouts')")
      .first();
    await expect(batchesTab).toBeVisible();
    await expect(shareholdersTab).toBeVisible();

    // Verify New Payment Batch modal with period selection and installment tags
    const newBatchBtn = page.locator("button:has-text('New Payment Batch')").first();
    await newBatchBtn.click();
    await expect(page.locator("text=Create Payment Batch").first()).toBeVisible({ timeout: 5000 });

    // Verify installment / payout leg selector
    await expect(
      page.locator("label:has-text('Installment / Payout Leg Tag')").first(),
    ).toBeVisible();

    // Verify period / quarter options
    await expect(page.locator("label:has-text('Period / Quarter')").first()).toBeVisible();
    await expect(page.locator("text=Available Payables").first()).toBeVisible();

    // Close modal
    await page.locator("button:has-text('Cancel')").first().click();

    // Switch to Shareholder Payouts & BOID Search tab
    await shareholdersTab.click();
    await expect(page.locator("input[placeholder*='Search by BOID']").first()).toBeVisible({
      timeout: 5000,
    });

    // Switch back to batches tab
    await batchesTab.click();
  });

  test("2. Bank Reconciliation: 5-way matching upload controls and audit trail ledger", async ({
    page,
  }) => {
    await page.goto("/reconciliation");
    await expect(page).toHaveURL(/.*\/reconciliation/);

    // Verify Page Header
    await expect(page.locator("h1:has-text('Reconciliation Engine')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify Upload Control Area
    await expect(page.locator("text=Upload Files for 5-Way Reconciliation").first()).toBeVisible();
    await expect(page.locator("button:has-text('Upload Excel File(s)')").first()).toBeVisible();
    await expect(page.locator("button:has-text('Upload Bank Statement(s)')").first()).toBeVisible();

    // Verify Reconciliation History & Audit Trail Section
    await expect(page.locator("text=Reconciliation History & Audit Trail").first()).toBeVisible();
    await expect(page.locator("text=Total Ingested Amount").first()).toBeVisible();
    await expect(
      page.locator("input[placeholder*='Search runs by file name']").first(),
    ).toBeVisible();
  });

  test("3. CDSC & IAF Allotments: Lock-in presets, quota calc, CAS bonus, and specs", async ({
    page,
  }) => {
    await page.goto("/allocations");
    await expect(page).toHaveURL(/.*\/allocations/);

    // Verify Page Header
    await expect(page.locator("h1:has-text('CDSC & IAF Allotment Engine')").first()).toBeVisible({
      timeout: 10000,
    });

    // Check main tabs
    await expect(
      page.locator("button[role='tab']:has-text('CDSC Generator')").first(),
    ).toBeVisible();
    await expect(
      page.locator("button[role='tab']:has-text('CDSC Bonus (CAS)')").first(),
    ).toBeVisible();
    await expect(
      page.locator("button[role='tab']:has-text('Share Conversions')").first(),
    ).toBeVisible();
    await expect(page.locator("button[role='tab']:has-text('Quota Calc')").first()).toBeVisible();
    await expect(
      page.locator("button[role='tab']:has-text('Specs & Rules')").first(),
    ).toBeVisible();

    // Test Quota Calculator Tab
    await page.locator("button[role='tab']:has-text('Quota Calc')").first().click();
    await expect(
      page.locator("text=IPO & Corporate Action Allotment Quota Calculator").first(),
    ).toBeVisible({
      timeout: 5000,
    });

    // Test Specs & Rules Tab
    await page.locator("button[role='tab']:has-text('Specs & Rules')").first().click();
    await expect(page.locator("text=Official CDSC File Specifications").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator("text=1. Issue Allotment File (.iaf)").first()).toBeVisible();
    await expect(page.locator("text=2. Investor Verification File (.ivf)").first()).toBeVisible();

    // Switch back to CDSC Generator tab
    await page.locator("button[role='tab']:has-text('CDSC Generator')").first().click();
    await expect(page.locator("text=CDSC Parameters & Lock-in Presets").first()).toBeVisible();
  });

  test("4. AGM Historical Studio: Statutory FY ledger, corporate action timeline, and multi-year registry", async ({
    page,
  }) => {
    await page.goto("/agm-studio");
    await expect(page).toHaveURL(/.*\/agm-studio/);

    // Verify Page Header
    await expect(page.locator("h1:has-text('AGM Historical Studio')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify Company Selector & FY Ledger Tab
    const fyLedgerTab = page.locator("button[role='tab']:has-text('FY Ledger')").first();
    await expect(fyLedgerTab).toBeVisible();
    await fyLedgerTab.click();

    await expect(page.locator("text=Statutory Fiscal Year Ledger").first()).toBeVisible({
      timeout: 5000,
    });

    // Verify CA Timeline Tab
    const caTimelineTab = page.locator("button[role='tab']:has-text('Company & CA')").first();
    await expect(caTimelineTab).toBeVisible();
    await caTimelineTab.click();

    await expect(
      page.locator("text=Company Profile & Corporate Action Timeline Configurator").first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("5. Pending Approvals: Maker-checker queue, status filters, and structured review dialog", async ({
    page,
  }) => {
    await page.goto("/approvals");
    await expect(page).toHaveURL(/.*\/approvals/);

    // Verify Page Header
    await expect(page.locator("h1:has-text('Pending Approvals')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify KPI Cards
    await expect(page.locator("text=Pending Review").first()).toBeVisible();
    await expect(page.locator("text=Approved").first()).toBeVisible();
    await expect(page.locator("text=Rejected").first()).toBeVisible();
    await expect(page.locator("text=Pending Payment Batches").first()).toBeVisible();

    // Verify Search & Status Filter
    await expect(page.locator("input[placeholder*='Search approvals']").first()).toBeVisible();

    // If approvals table has rows, test review dialog
    const viewButtons = page.locator("button:has-text('Review')");
    const count = await viewButtons.count();
    if (count > 0) {
      await viewButtons.first().click();
      await expect(page.locator("text=Approval Request Review").first()).toBeVisible({
        timeout: 5000,
      });
      await expect(page.locator("text=Reviewer Notes / Remarks").first()).toBeVisible();

      // Test raw JSON toggle if available
      const rawJsonToggle = page.locator("button:has-text('View Raw JSON')").first();
      if (await rawJsonToggle.isVisible()) {
        await rawJsonToggle.click();
        await expect(page.locator("pre").first()).toBeVisible();
      }

      await page.locator("button:has-text('Close')").first().click();
    }
  });

  test("6. Upload Data & Upload History: Wizard step flow, history table, and error inspection", async ({
    page,
  }) => {
    // 1. Check Upload Data Wizard
    await page.goto("/upload");
    await expect(page).toHaveURL(/.*\/upload/);

    await expect(page.locator("h1:has-text('Upload Data')").first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=Click to upload or drag and drop").first()).toBeVisible();
    await expect(page.locator("button:has-text('Browse Files')").first()).toBeVisible();
    await expect(page.locator("text=Supported Data Import Formats").first()).toBeVisible();

    // 2. Check Upload History
    await page.goto("/upload-history");
    await expect(page).toHaveURL(/.*\/upload-history/);

    await expect(page.locator("h1:has-text('Upload History')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify KPI stats
    await expect(page.locator("text=Total Uploads").first()).toBeVisible();
    await expect(page.locator("text=Active Completed").first()).toBeVisible();
    await expect(page.locator("text=Active Rows in System").first()).toBeVisible();

    // Verify Table Headers
    await expect(page.locator("th:has-text('File Name')").first()).toBeVisible();
    await expect(page.locator("th:has-text('Total Rows')").first()).toBeVisible();
    await expect(page.locator("th:has-text('Status')").first()).toBeVisible();
  });
});
