import { test, expect } from "@playwright/test";

const TEST_ADMIN_PASSWORD = process.env.SUPABASE_TEST_ADMIN_PASSWORD || "Admin123!";

test.describe("Multi-Channel Reconciliation Workbench & BRS E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth");
    await page.locator('input[type="email"]').fill("admin@rbbmbl.com.np");
    await page.locator('input[type="password"]').fill(TEST_ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/.*\/dashboard/, { timeout: 15000 });
  });

  test("Reconciliation workbenches, Manual Entry modal, Exceptions, and BRS Period Lock UI render cleanly", async ({
    page,
  }) => {
    await page.goto("/reconciliation");
    await expect(page.locator("h1:has-text('Reconciliation Engine')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify new header buttons & extended bank statement file accept filter
    await expect(page.locator("button:has-text('Manual Entry / Match')").first()).toBeVisible();
    await expect(page.locator("button:has-text('Sync ConnectIPS')").first()).toBeVisible();
    const acceptAttr = await page.locator("#reconcile-bank-upload").getAttribute("accept");
    expect(acceptAttr).toContain(".xml");
    expect(acceptAttr).toContain(".mt940");

    // Verify default workbench tab: Bank Ledger & Manual Matching
    await expect(
      page.locator("text=Bank Ledger & Manual Matching Workbench").first(),
    ).toBeVisible();

    // Open Manual Reconciliation Dialog via header action
    await page.locator("button:has-text('Manual Entry / Match')").first().click();
    await expect(
      page.locator("text=Manual Reconciliation & Voucher Workbench").first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator("button[role='tab']:has-text('New Manual Entry')").first(),
    ).toBeVisible();
    await page.locator("button:has-text('Cancel')").first().click();

    // Switch to Exceptions & Variance Approvals tab
    await page
      .locator("button[role='tab']:has-text('Exceptions & Variance Approvals')")
      .first()
      .click();
    await expect(page.locator("text=Durable Exceptions Queue").first()).toBeVisible();
    await expect(page.locator("text=Maker-Checker Variance Approvals").first()).toBeVisible();

    // Switch to BRS & Period Close tab
    await page.locator("button[role='tab']:has-text('BRS & Period Close')").first().click();
    await expect(
      page.locator("text=Formal Bank Reconciliation Statement (BRS) & Period Close").first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(page.locator("button:has-text('Export BRS (.xlsx)')").first()).toBeVisible();
    await expect(page.locator("text=Unreconciled Aging Bucket").first()).toBeVisible();

    // Also visit /approvals to confirm page loads cleanly with manual_reconciliation support
    await page.goto("/approvals");
    await expect(
      page
        .locator("h1, h2")
        .filter({ hasText: /Approvals/i })
        .first(),
    ).toBeVisible({
      timeout: 10000,
    });
  });
});
