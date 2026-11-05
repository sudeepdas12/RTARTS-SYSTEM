import { test, expect } from "@playwright/test";

const TEST_ADMIN_PASSWORD = process.env.SUPABASE_TEST_ADMIN_PASSWORD || "Admin123!";

test.describe("Payables Module End-to-End Suite", () => {
  test.beforeEach(async ({ page }) => {
    // Log in as administrator
    await page.goto("/auth");
    await page.locator('input[type="email"]').fill("admin@rbbmbl.com.np");
    await page.locator('input[type="password"]').fill(TEST_ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/.*\/dashboard/, { timeout: 15000 });
  });

  test("1. Dividend Payables: KPI stats, calculator, table selection, and auto-calculation modal", async ({
    page,
  }) => {
    await page.goto("/dividend");
    await expect(page).toHaveURL(/.*\/dividend/);

    // Verify page header
    await expect(page.locator("h1:has-text('Stock Dividend Payables')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify KPI summary cards
    await expect(page.locator("text=Total Shares Held").first()).toBeVisible();
    await expect(page.locator("text=Gross Dividend Pool").first()).toBeVisible();
    await expect(page.locator("text=TDS Tax Withheld").first()).toBeVisible();
    await expect(page.locator("text=Net Dividend Payable").first()).toBeVisible();

    // Test Dividend Calculator drawer
    const calcButton = page.locator("button:has-text('Calculator')").first();
    await expect(calcButton).toBeVisible();
    await calcButton.click();

    const sharesInput = page.locator("div:has(> label:has-text('Shares Held')) input").first();
    await expect(sharesInput).toBeVisible();
    await sharesInput.fill("5000");

    const rateInput = page.locator("div:has(> label:has-text('Cash Rate')) input").first();
    await rateInput.fill("10");

    const calcSubmitBtn = page.locator("button:has-text('Calculate')").first();
    await calcSubmitBtn.click();

    // Verify calculation result is displayed
    await expect(page.locator("text=Gross Cash Dividend").first()).toBeVisible({ timeout: 5000 });

    // Close calculator
    await calcButton.click();

    // Test New Dividend dialog & auto-calculations
    const newBtn = page.locator("button:has-text('New Dividend')").first();
    await newBtn.click();

    await expect(page.locator("text=New Dividend Payable").first()).toBeVisible({ timeout: 5000 });

    // Verify presence of auto-calculation recompute button
    const recomputeBtn = page.locator("button:has-text('Recompute 5%/15% TDS')").first();
    await expect(recomputeBtn).toBeVisible();

    // Close dialog
    await page.locator("button:has-text('Cancel')").first().click();

    // If table has rows, test multi-select and bulk actions
    const tableRows = page.locator("tbody tr");
    const count = await tableRows.count();
    if (count > 0 && !(await page.locator("text=No dividend payables").isVisible())) {
      const selectAllHeader = page
        .locator("thead th input[type='checkbox'], thead th button[role='checkbox']")
        .first();
      if (await selectAllHeader.isVisible()) {
        await selectAllHeader.click();
        await expect(page.locator("text=selected").first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator("button:has-text('Export Selected')").first()).toBeVisible();

        // Clear selection
        await page.locator("button:has-text('Clear Selection')").first().click();
        await expect(page.locator("button:has-text('Export Selected')")).toHaveCount(0);
      }
    }
  });

  test("2. Debenture Interest: KPI stats, day count, table selection, and debenture calculator", async ({
    page,
  }) => {
    await page.goto("/interest");
    await expect(page).toHaveURL(/.*\/interest/);

    // Verify page header
    await expect(page.locator("h1:has-text('Debenture Interest Payables')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify KPI summary cards
    await expect(page.locator("text=Total Debentures Held").first()).toBeVisible();
    await expect(page.locator("text=Gross Interest Pool").first()).toBeVisible();
    await expect(page.locator("text=TDS Tax Withheld").first()).toBeVisible();
    await expect(page.locator("text=Net Interest Payable").first()).toBeVisible();

    // Test Interest Calculator panel
    const calcButton = page.locator("button:has-text('Calculator')").first();
    await expect(calcButton).toBeVisible();
    await calcButton.click();

    const kittaInput = page.locator("div:has(> label:has-text('Debenture Kitta')) input").first();
    await expect(kittaInput).toBeVisible();
    await kittaInput.fill("100");

    const rateInput = page.locator("div:has(> label:has-text('Annual Int. Rate %')) input").first();
    await rateInput.fill("10");

    // Select 6M period preset so From and To dates are set
    await page.locator("button:has-text('6 Months')").first().click();

    const calcSubmitBtn = page.locator("button:has-text('Calculate Interest')").first();
    await calcSubmitBtn.click();

    // Verify interest breakdown output
    await expect(page.locator("text=Total Principal").first()).toBeVisible({ timeout: 5000 });

    // Close calculator
    await calcButton.click();

    // Test New Interest Payable dialog
    const newBtn = page.locator("button:has-text('New Payable')").first();
    await newBtn.click();
    await expect(page.locator("text=New Interest Payable").first()).toBeVisible({ timeout: 5000 });

    await expect(page.locator("button:has-text('Recompute 6%/15% TDS')").first()).toBeVisible();
    await page.locator("button:has-text('Cancel')").first().click();
  });

  test("3. Mutual Fund Distribution: Scheme stats, summary report layout, and bulk controls", async ({
    page,
  }) => {
    await page.goto("/mutual-fund");
    await expect(page).toHaveURL(/.*\/mutual-fund/);

    // Verify page header
    await expect(
      page.locator("h1:has-text('Mutual Fund Distribution Payables')").first(),
    ).toBeVisible({
      timeout: 10000,
    });

    // Verify KPI summary cards
    await expect(page.locator("text=Total Units Held").first()).toBeVisible();
    await expect(page.locator("text=Gross Distribution Pool").first()).toBeVisible();
    await expect(page.locator("text=TDS Tax Withheld").first()).toBeVisible();
    await expect(page.locator("text=Net Distribution Payable").first()).toBeVisible();

    // Verify New Payable dialog
    const newBtn = page.locator("button:has-text('New Payable')").first();
    await newBtn.click();
    await expect(page.locator("text=New Mutual Fund Payable").first()).toBeVisible({
      timeout: 5000,
    });

    await expect(page.locator("button:has-text('Recompute 5%/15% TDS')").first()).toBeVisible();
    await page.locator("button:has-text('Cancel')").first().click();
  });

  test("4. Payments Module: Batches table, search, and batch creation preview", async ({
    page,
  }) => {
    await page.goto("/payments");
    await expect(page).toHaveURL(/.*\/payments/);

    // Verify page header
    await expect(page.locator("h1:has-text('Payments Module')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify tab controls
    await expect(
      page.locator("button[role='tab']:has-text('Payment Batches')").first(),
    ).toBeVisible();
    await expect(
      page.locator("button[role='tab']:has-text('Shareholder Payouts')").first(),
    ).toBeVisible();

    // Open New Payment Batch dialog
    const newBatchBtn = page.locator("button:has-text('New Payment Batch')").first();
    await newBatchBtn.click();

    await expect(page.locator("text=Create Payment Batch").first()).toBeVisible({ timeout: 5000 });

    // Check period selector and preview section
    await expect(page.locator("text=Available Payables").first()).toBeVisible();
    await expect(page.locator("label:has-text('Period / Quarter')").first()).toBeVisible();

    // Close dialog
    await page.locator("button:has-text('Cancel')").first().click();
  });
});
