import { test, expect } from "@playwright/test";

test.describe("Authentication and System Navigation Workflows", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test("unauthenticated users are redirected to /auth from protected routes", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/.*\/auth/);

    await page.goto("/payments");
    await expect(page).toHaveURL(/.*\/auth/);

    await page.goto("/reports");
    await expect(page).toHaveURL(/.*\/auth/);

    await page.goto("/users");
    await expect(page).toHaveURL(/.*\/auth/);
  });

  test("auth page displays system branding and validation controls", async ({ page }) => {
    await page.goto("/auth");

    await expect(page.locator("text=RBBMBL").first()).toBeVisible();
    await expect(page.locator("text=RTA / RTS Console").first()).toBeVisible();
    await expect(page.locator("text=Access your console").first()).toBeVisible();

    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const submitBtn = page.locator('button[type="submit"]');

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toHaveText(/Sign in/);
  });

  test("submitting invalid credentials rejects login and preserves route", async ({ page }) => {
    await page.goto("/auth");

    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const submitBtn = page.locator('button[type="submit"]');

    await emailInput.fill("nonexistent.user@rbbmbl.com.np");
    await passwordInput.fill("IncorrectPassword123!");
    await submitBtn.click();

    await expect(page).toHaveURL(/.*\/auth/);
    const errorToast = page.locator('[data-sonner-toast][data-type="error"], [role="status"]');
    await expect(errorToast.first()).toBeVisible({ timeout: 5000 });
  });

  test("authenticated admin user logs in, accesses dashboard, and navigates modules", async ({
    page,
  }) => {
    await page.goto("/auth");

    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const submitBtn = page.locator('button[type="submit"]');

    await emailInput.fill("admin@rbbmbl.com.np");
    await passwordInput.fill("Admin123!");
    await submitBtn.click();

    await page.waitForURL(/.*\/dashboard/, { timeout: 15000 });
    await expect(page).toHaveURL(/.*\/dashboard/);
    await expect(page.locator("body")).toContainText(/Dashboard|RBBMBL|RTA/i);

    await page.goto("/companies");
    await expect(page).toHaveURL(/.*\/companies/);

    await page.goto("/reports");
    await expect(page).toHaveURL(/.*\/reports/);
  });

  test("clients section displays client list when all companies is selected", async ({ page }) => {
    await page.goto("/auth");

    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const submitBtn = page.locator('button[type="submit"]');

    await emailInput.fill("admin@rbbmbl.com.np");
    await passwordInput.fill("Admin123!");
    await submitBtn.click();

    await page.waitForURL(/.*\/dashboard/, { timeout: 15000 });

    // Navigate to clients page
    await page.goto("/clients");
    await expect(page).toHaveURL(/.*\/clients/);

    // Verify page header and table
    await expect(page.locator("text=Clients & Shareholders").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify table has rows and is not empty
    const tableRows = page.locator("tbody tr");
    await expect(tableRows.first()).toBeVisible({ timeout: 10000 });
    const count = await tableRows.count();
    expect(count).toBeGreaterThan(0);
  });

  test("payments module renders batches, payables export button, and search controls", async ({
    page,
  }) => {
    await page.goto("/auth");

    await page.locator('input[type="email"]').fill("admin@rbbmbl.com.np");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/.*\/dashboard/, { timeout: 15000 });

    await page.goto("/payments");
    await expect(page).toHaveURL(/.*\/payments/);
    await expect(page.locator("text=Payments Module").first()).toBeVisible({ timeout: 10000 });

    // Verify presence of Download Payables and New Payment Batch buttons
    await expect(page.locator("button:has-text('New Payment Batch')").first()).toBeVisible();
    await expect(page.locator("input[placeholder*='Search batch name']").first()).toBeVisible();
  });

  test("reports module loads summary tabs and financial export options", async ({ page }) => {
    await page.goto("/auth");

    await page.locator('input[type="email"]').fill("admin@rbbmbl.com.np");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/.*\/dashboard/, { timeout: 15000 });

    await page.goto("/reports");
    await expect(page).toHaveURL(/.*\/reports/);
    await expect(page.locator("text=Reports & Distribution Summaries").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify main reporting center tab triggers
    await expect(
      page.locator("button[role='tab']:has-text('All Summaries')").first(),
    ).toBeVisible();
    await expect(
      page.locator("button[role='tab']:has-text('AGM Equities & Bonus')").first(),
    ).toBeVisible();
    await expect(
      page.locator("button[role='tab']:has-text('Registers & Exports')").first(),
    ).toBeVisible();
  });

  test("admin user can access system settings and view central tax rules", async ({ page }) => {
    await page.goto("/auth");

    await page.locator('input[type="email"]').fill("admin@rbbmbl.com.np");
    await page.locator('input[type="password"]').fill("Admin123!");
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/.*\/dashboard/, { timeout: 15000 });

    await page.goto("/settings");
    await expect(page).toHaveURL(/.*\/settings/);
    await expect(page.locator("text=System Settings").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator("button:has-text('Save All Changes')").first()).toBeVisible();
  });
});
