import { test, expect } from "@playwright/test";

const TEST_ADMIN_PASSWORD = process.env.SUPABASE_TEST_ADMIN_PASSWORD || "Admin123!";

test.describe("Overview — Dashboard Comprehensive End-to-End Suite", () => {
  test.beforeEach(async ({ page }) => {
    // Log in as administrator
    await page.goto("/auth");
    await page.locator('input[type="email"]').fill("admin@rbbmbl.com.np");
    await page.locator('input[type="password"]').fill(TEST_ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/.*\/dashboard/, { timeout: 15000 });
  });

  test("1. Core Dashboard Layout & 7 Primary KPI Cards", async ({ page }) => {
    // Page Header
    await expect(page.locator("h1:has-text('Dashboard')").first()).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator("text=Live view of payables, reconciliation, payments, and approvals"),
    ).toBeVisible();

    // Verify all 7 KPI cards
    const kpiTitles = [
      "Companies",
      "Clients",
      "Total Payables",
      "Pending Payments",
      "Bank Reconciled",
      "Classification Review",
      "Pending Approvals",
    ];

    for (const title of kpiTitles) {
      const card = page.locator(`div.glass-card:has-text('${title}')`).first();
      await expect(card).toBeVisible();
    }

    // Verify formatted values in KPI cards are non-empty and not NaN
    const totalPayablesCard = page.locator("div.glass-card:has-text('Total Payables')").first();
    const payablesValue = await totalPayablesCard.locator(".tabular-nums").first().textContent();
    expect(payablesValue).toBeTruthy();
    expect(payablesValue?.includes("₨") || payablesValue === "—").toBe(true);
    expect(payablesValue).not.toContain("NaN");

    const pendingPaymentsCard = page.locator("div.glass-card:has-text('Pending Payments')").first();
    const pendingValue = await pendingPaymentsCard.locator(".tabular-nums").first().textContent();
    expect(pendingValue).toBeTruthy();
    expect(pendingValue?.includes("₨") || pendingValue === "—").toBe(true);
    expect(pendingValue).not.toContain("NaN");
  });

  test("2. Operational Workflow Hub, SLA Priority Banner & Refresh Mechanism", async ({ page }) => {
    // Verify Scope and Timestamp bar
    await expect(page.locator("text=Scope:").first()).toBeVisible();
    await expect(page.locator("text=Data as of:").first()).toBeVisible();

    // Verify Refresh Snapshot button works
    const refreshBtn = page.locator("button:has-text('Refresh Snapshot')").first();
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();
    await page.waitForTimeout(500);
    await expect(refreshBtn).toBeEnabled();

    // Verify Primary Financial Lifecycle Journey (7 sequential steps)
    await expect(page.locator("text=Primary Financial Lifecycle Journey")).toBeVisible();
    const steps = [
      "Upload & Map",
      "Validate & Tax",
      "Authorize",
      "Create Batch",
      "Disburse",
      "Reconcile",
      "Statutory Reports",
    ];

    for (const step of steps) {
      await expect(page.locator(`span:has-text('${step}')`).first()).toBeVisible();
    }

    // Verify Operational Priority Action Banner
    await expect(page.locator("text=SLA").first()).toBeVisible();
    await expect(page.locator("text=Owner:").first()).toBeVisible();

    // Verify 4 Quick Operational Drill-Down metric cards
    await expect(page.locator("text=Pending Approvals").first()).toBeVisible();
    await expect(page.locator("text=Active Batches").first()).toBeVisible();
    await expect(page.locator("text=Data Quality Issues").first()).toBeVisible();
    await expect(page.locator("text=Unreconciled Queue").first()).toBeVisible();
  });

  test("3. Quick Access Modules Navigation & Routing", async ({ page }) => {
    // Verify all 6 Quick Access tiles
    await expect(page.locator("text=Stock Dividends").first()).toBeVisible();
    await expect(page.locator("text=Debentures").first()).toBeVisible();
    await expect(page.locator("text=Mutual Funds").first()).toBeVisible();
    await expect(page.locator("text=Regulatory Reports").first()).toBeVisible();
    await expect(page.locator("text=Tax Review").first()).toBeVisible();
    await expect(page.locator("text=Audit Trail").first()).toBeVisible();

    // Test clicking Regulatory Reports
    await page.locator("text=Regulatory Reports").first().click();
    await page.waitForURL(/.*\/reports/, { timeout: 10000 });
    await expect(page).toHaveURL(/.*\/reports/);

    // Navigate back to Dashboard
    await page.goto("/dashboard");
    await page.waitForURL(/.*\/dashboard/, { timeout: 10000 });

    // Test clicking Stock Dividends
    await page.locator("text=Stock Dividends").first().click();
    await page.waitForURL(/.*\/dividend/, { timeout: 10000 });
    await expect(page).toHaveURL(/.*\/dividend/);

    // Return to Dashboard
    await page.goto("/dashboard");
    await page.waitForURL(/.*\/dashboard/, { timeout: 10000 });
  });

  test("4. Scope Filtering & Dynamic Reactivity", async ({ page }) => {
    // Header action buttons
    const uploadBtn = page.locator("button:has-text('Upload Data')").first();
    const reconcileBtn = page.locator("button:has-text('Reconcile')").first();
    await expect(uploadBtn).toBeVisible();
    await expect(reconcileBtn).toBeVisible();

    // Test Company Select dropdown interaction
    const companySelect = page.locator("button:has-text('All Companies')").first();
    if (await companySelect.isVisible()) {
      await companySelect.click();
      await page.waitForTimeout(400);

      // Select 'All Companies' option or first available company
      const options = page.locator("[role='option']");
      const optionCount = await options.count();
      expect(optionCount).toBeGreaterThanOrEqual(1);

      // Select first option
      await options.first().click();
      await page.waitForTimeout(500);
    }

    // Test Fiscal Year dropdown interaction
    const fySelect = page.locator("button:has-text('All Fiscal Years')").first();
    if (await fySelect.isVisible()) {
      await fySelect.click();
      await page.waitForTimeout(400);

      const fyOptions = page.locator("[role='option']");
      const fyCount = await fyOptions.count();
      expect(fyCount).toBeGreaterThanOrEqual(1);
      await fyOptions.first().click();
      await page.waitForTimeout(500);
    }
  });

  test("5. Charts Rendering & Payment Completion Progress", async ({ page }) => {
    // Payables Bar Chart
    await expect(page.locator("text=Payables — Paid vs Pending vs Partial").first()).toBeVisible();
    await expect(page.locator("text=Distribution of interest and dividend payables")).toBeVisible();

    // Payment Status Distribution (Pie Chart or empty state)
    await expect(page.locator("text=Payment Status Distribution").first()).toBeVisible();
    await expect(page.locator("text=Overall payment completion status").first()).toBeVisible();

    // Payment Completion Card & Progress Bars
    await expect(page.locator("text=Payment Completion").first()).toBeVisible();
    await expect(page.locator("text=Funds Disbursed").first()).toBeVisible();
    await expect(page.locator("text=Bank Reconciliation").first()).toBeVisible();
    await expect(page.locator("text=Total Disbursed").first()).toBeVisible();
    await expect(page.locator("text=Fully Settled").first()).toBeVisible();
    await expect(page.locator("text=Total Pending").first()).toBeVisible();

    // Recent Payments & Recent Activity Cards
    await expect(page.locator("text=Recent Payments").first()).toBeVisible();
    await expect(page.locator("text=Recent Activity").first()).toBeVisible();
  });
});
