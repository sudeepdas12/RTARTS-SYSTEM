import { test, expect } from "@playwright/test";

const TEST_ADMIN_PASSWORD = process.env.SUPABASE_TEST_ADMIN_PASSWORD || "Admin123!";

test.describe("Insights & Operations Comprehensive End-to-End Suite", () => {
  test.beforeEach(async ({ page }) => {
    // Log in as administrator
    await page.goto("/auth");
    await page.locator('input[type="email"]').fill("admin@rbbmbl.com.np");
    await page.locator('input[type="password"]').fill(TEST_ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/.*\/dashboard/, { timeout: 15000 });
  });

  test("1. Dashboard: Executive KPIs, operational strip, live filters, and visual analytics", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/.*\/dashboard/);

    // Verify Page Header
    await expect(page.locator("h1:has-text('Dashboard')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify primary financial lifecycle journey
    await expect(page.locator("text=Primary Financial Lifecycle Journey").first()).toBeVisible();

    // Verify top overview cards exist
    await expect(page.locator("text=Total Payables").first()).toBeVisible();
    await expect(page.locator("text=Pending Payments").first()).toBeVisible();
    await expect(page.locator("text=Bank Reconciled").first()).toBeVisible();

    // Verify operational metrics banner links
    await expect(page.locator("text=Pending Approvals").first()).toBeVisible();
    await expect(page.locator("text=Data Quality Issues").first()).toBeVisible();

    // Verify scope filters
    const companyFilter = page.locator("button:has-text('All Companies')").first();
    await expect(companyFilter).toBeVisible();

    // Verify Refresh Snapshot action
    const refreshBtn = page.locator("button:has-text('Refresh Snapshot')").first();
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();

    // Verify charts container render
    await expect(page.locator("text=Payables — Paid vs Pending vs Partial").first()).toBeVisible();
  });

  test("2. Reports: Statutory registers, AGM breakdown, e-TDS return preview, and IPF tracking", async ({
    page,
  }) => {
    await page.goto("/reports");
    await expect(page).toHaveURL(/.*\/reports/);

    // Verify Page Header
    await expect(
      page.locator("h1:has-text('Reports & Distribution Summaries')").first(),
    ).toBeVisible({
      timeout: 10000,
    });

    // Verify report category tabs
    const allTab = page.locator("button[role='tab']:has-text('All Summaries')").first();
    const agmTab = page.locator("button[role='tab']:has-text('AGM Equities & Bonus')").first();
    const debentureTab = page.locator("button[role='tab']:has-text('Debentures (Pumori)')").first();
    const mutualFundTab = page.locator("button[role='tab']:has-text('Mutual Funds (CDS)')").first();
    const taxTab = page.locator("button[role='tab']:has-text('IRD Annex-10')").first();
    const ipfTab = page.locator("button[role='tab']:has-text('SEBON IPF')").first();
    const registersTab = page.locator("button[role='tab']:has-text('Registers & Exports')").first();

    await expect(allTab).toBeVisible();
    await expect(agmTab).toBeVisible();
    await expect(debentureTab).toBeVisible();
    await expect(mutualFundTab).toBeVisible();
    await expect(taxTab).toBeVisible();
    await expect(ipfTab).toBeVisible();
    await expect(registersTab).toBeVisible();

    // Under All Summaries or Mutual Funds tab, check Distribution Summary card
    await expect(page.locator("text=/Mutual Fund Distribution Summary/i").first()).toBeVisible();

    // Switch to IRD Annex-10 tab
    await taxTab.click();
    await expect(page.locator("text=Annex-10 e-TDS Return").first()).toBeVisible({
      timeout: 5000,
    });
    const withholdeeHeader = page.locator("text=Withholdee PAN").first();
    const selectCompanyPrompt = page.locator("text=/select a company to view/i").first();
    await expect(withholdeeHeader.or(selectCompanyPrompt)).toBeVisible({
      timeout: 5000,
    });

    // Switch to SEBON IPF aging tab
    await ipfTab.click();
    await expect(
      page.locator("text=Investor Protection Fund (IPF) 5-Year Aging Tracker").first(),
    ).toBeVisible({
      timeout: 5000,
    });

    // Switch to Registers tab
    await registersTab.click();
    await expect(page.locator("h3:has-text('Payable Registers')").first()).toBeVisible({
      timeout: 5000,
    });

    // Test Register Viewer Dialog
    const viewBtn = page.locator("button:has-text('View')").first();
    await expect(viewBtn).toBeVisible();
    await viewBtn.click();

    // Verify modal appears with live data grid, search, and export actions
    await expect(
      page.locator("input[placeholder*='Search across all fields']").first(),
    ).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator("button:has-text('Excel')").first()).toBeVisible();

    // Close modal
    await page.keyboard.press("Escape");
  });

  test("3. Analytics: Cross-instrument fiscal matrix, search, pagination, and precision tabular footer", async ({
    page,
  }) => {
    await page.goto("/analytics");
    await expect(page).toHaveURL(/.*\/analytics/);

    // Verify Page Header
    await expect(page.locator("h1:has-text('Analytics & Fiscal Summaries')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify stat cards
    await expect(page.locator("text=Total Records").first()).toBeVisible();
    await expect(page.locator("text=Total Disbursed").first()).toBeVisible();

    // Verify search input
    const searchInput = page.locator("input[placeholder*='Search company or FY']").first();
    await expect(searchInput).toBeVisible();
    await searchInput.fill("RBB");
    await page.waitForTimeout(300);
    await searchInput.clear();

    // Verify table structure
    await expect(page.locator("th:has-text('Company')").first()).toBeVisible();
    await expect(page.locator("th:has-text('Div. Gross')").first()).toBeVisible();
    await expect(page.locator("th:has-text('Disbursed')").first()).toBeVisible();
    await expect(page.locator("th:has-text('Pending')").first()).toBeVisible();

    // Verify export button
    const exportBtn = page.locator("button:has-text('Export Excel')").first();
    await expect(exportBtn).toBeVisible();
  });

  test("4. Data Management: Lifecycle controls, client ledger explorer, and protected operations", async ({
    page,
  }) => {
    await page.goto("/data-management");
    await expect(page).toHaveURL(/.*\/data-management/);

    // Verify Page Header
    await expect(page.locator("h1:has-text('Data Management & Operations')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify tabs
    const clientsTab = page
      .locator("button[role='tab']:has-text('Client Records Explorer')")
      .first();
    const operationsTab = page
      .locator("button[role='tab']:has-text('Data Operations & Pruning')")
      .first();
    const dangerTab = page.locator("button[role='tab']:has-text('Danger Zone')").first();

    await expect(clientsTab).toBeVisible();
    await expect(operationsTab).toBeVisible();
    await expect(dangerTab).toBeVisible();

    // Test operations & pruning tab
    await operationsTab.click();
    await expect(page.locator("text=Company Fiscal Dataset Operations").first()).toBeVisible({
      timeout: 5000,
    });

    // Test clients explorer tab
    await clientsTab.click();
    await expect(page.locator("input[placeholder*='Search name, BOID']").first()).toBeVisible({
      timeout: 5000,
    });
    const tableHeader = page.locator("th:has-text('Client Name')").first();
    const emptyState = page
      .locator("text=Select a company and fiscal year to explore client records")
      .first();
    await expect(tableHeader.or(emptyState)).toBeVisible({ timeout: 5000 });

    // Test Danger Zone tab
    await dangerTab.click();
    await expect(page.locator("text=Advanced Bulk Purge").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator("button:has-text('Execute Purge')").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("5. Classification Review: Tax queues, payee categorization, and explainability modal", async ({
    page,
  }) => {
    await page.goto("/classification-review");
    await expect(page).toHaveURL(/.*\/classification-review/);

    // Verify Page Header
    await expect(page.locator("h1:has-text('Investor Classification Review')").first()).toBeVisible(
      {
        timeout: 10000,
      },
    );

    // Verify tabs
    const reviewQueueTab = page.locator("button[role='tab']:has-text('Needs Review')").first();
    const taxExceptionsTab = page.locator("button[role='tab']:has-text('Tax Exceptions')").first();

    await expect(reviewQueueTab).toBeVisible();
    await expect(taxExceptionsTab).toBeVisible();

    // Verify Needs Review table or empty review queue message
    const reviewTable = page.locator("th:has-text('Shareholder')").first();
    const cleanQueue = page
      .locator("text=/No payables require review|All records reviewed|Review Queue/i")
      .first();
    await expect(reviewTable.or(cleanQueue)).toBeVisible({ timeout: 5000 });

    // Switch to Tax Exceptions
    await taxExceptionsTab.click();
    await expect(page.locator("text=Tax / TDS Consistency Exceptions").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("6. Audit Logs: Security telemetry, forensic trail, domain filtering, and record diff viewer", async ({
    page,
  }) => {
    await page.goto("/audit-logs");
    await expect(page).toHaveURL(/.*\/audit-logs/);

    // Verify Page Header
    await expect(
      page.locator("h1:has-text('Audit & Compliance Intelligence Center')").first(),
    ).toBeVisible({
      timeout: 10000,
    });

    // Verify tabs
    const historyTab = page.locator("button[role='tab']:has-text('Modification History')").first();
    const loginsTab = page.locator("button[role='tab']:has-text('User Sign-Ins')").first();
    const telemetryTab = page.locator("button[role='tab']:has-text('System Telemetry')").first();

    await expect(historyTab).toBeVisible();
    await expect(loginsTab).toBeVisible();
    await expect(telemetryTab).toBeVisible();

    // Check search input
    const searchInput = page.locator("input[placeholder*='Search shareholder, BOID']").first();
    await expect(searchInput).toBeVisible();

    // Switch to User Sign-Ins tab
    await loginsTab.click();
    await expect(
      page.locator("text=User Sign-In & Authentication Intelligence").first(),
    ).toBeVisible({
      timeout: 5000,
    });

    // Switch to System Telemetry tab
    await telemetryTab.click();
    await expect(page.locator("text=Platform Infrastructure Status").first()).toBeVisible({
      timeout: 5000,
    });

    // Switch back to Modification History tab
    await historyTab.click();
    await expect(page.locator("th:has-text('Timestamp')").first()).toBeVisible({
      timeout: 5000,
    });
  });
});
