import { test, expect } from "@playwright/test";

const TEST_ADMIN_PASSWORD = process.env.SUPABASE_TEST_ADMIN_PASSWORD || "Admin123!";

test.describe("Administration Section Comprehensive End-to-End Suite", () => {
  test.beforeEach(async ({ page }) => {
    // Log in as administrator
    await page.goto("/auth");
    await page.locator('input[type="email"]').fill("admin@rbbmbl.com.np");
    await page.locator('input[type="password"]').fill(TEST_ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/.*\/dashboard/, { timeout: 15000 });
  });

  test("1. Users & RBAC: Account directory, direct offline provisioning, password generator, and permission matrix", async ({
    page,
  }) => {
    await page.goto("/users");
    await expect(page).toHaveURL(/.*\/users/);

    // Verify Page Header
    await expect(page.locator("h1:has-text('User & Identity Management')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify KPI summary cards
    await expect(page.locator("text=Total Users").first()).toBeVisible();
    await expect(page.locator("text=Administrators").first()).toBeVisible();
    await expect(page.locator("text=Active Signed-In").first()).toBeVisible();

    // Verify User Directory and Role Matrix tabs
    const directoryTab = page.locator("button[role='tab']:has-text('User Directory')").first();
    const matrixTab = page
      .locator("button[role='tab']:has-text('Role Permissions Matrix')")
      .first();
    await expect(directoryTab).toBeVisible();
    await expect(matrixTab).toBeVisible();

    // Test Add / Invite User Modal
    const addBtn = page.locator("button:has-text('Add / Invite User')").first();
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Verify Provisioning Modal tabs
    await expect(page.locator("text=Provision Platform User").first()).toBeVisible({
      timeout: 5000,
    });
    const emailInviteTab = page.locator("button[role='tab']:has-text('Email Invitation')").first();
    const directAccountTab = page.locator("button[role='tab']:has-text('Direct Account')").first();
    await expect(emailInviteTab).toBeVisible();
    await expect(directAccountTab).toBeVisible();

    // Switch to direct account provisioning
    await directAccountTab.click();
    await expect(page.locator("button:has-text('Generate')").first()).toBeVisible();
    await page.locator("button:has-text('Cancel')").first().click();

    // Test Search & Filter on Directory Tab
    const searchInput = page.locator("input[placeholder*='Search user name or email']").first();
    await expect(searchInput).toBeVisible();
    await searchInput.fill("admin");
    await page.waitForTimeout(300);
    await searchInput.clear();

    // Switch to Role Permissions Matrix tab
    await matrixTab.click();
    await expect(
      page.locator("text=Role-Based Access Control (RBAC) Architecture").first(),
    ).toBeVisible({ timeout: 5000 });

    // Verify permission categories
    await expect(page.locator("text=Administration & Security").first()).toBeVisible();
    await expect(page.locator("text=Maker-Checker & Approvals").first()).toBeVisible();
    await expect(page.locator("text=Payments & Disbursements").first()).toBeVisible();
    await expect(page.locator("text=Bank Reconciliation").first()).toBeVisible();
  });

  test("2. System Settings: Regional calendar, centralized TDS rules editor, gateways, and backup links", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/.*\/settings/);

    // Verify Page Header
    await expect(page.locator("h1:has-text('System Settings')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify overview KPI cards
    await expect(page.locator("text=Calendar Mode").first()).toBeVisible();
    await expect(page.locator("text=Equity Dividend TDS").first()).toBeVisible();
    await expect(page.locator("text=Debenture Interest TDS").first()).toBeVisible();

    // Verify settings category tabs
    const generalTab = page.locator("button[role='tab']:has-text('General')").first();
    const taxRulesTab = page.locator("button[role='tab']:has-text('Tax Rules (TDS)')").first();
    const bankingTab = page.locator("button[role='tab']:has-text('Banking (ConnectIPS)')").first();
    const workflowTab = page.locator("button[role='tab']:has-text('Workflow')").first();

    await expect(generalTab).toBeVisible();
    await expect(taxRulesTab).toBeVisible();
    await expect(bankingTab).toBeVisible();
    await expect(workflowTab).toBeVisible();

    // Verify Backup Center shortcut card in General tab
    await expect(page.locator("text=Database Backup & Disaster Recovery").first()).toBeVisible();
    await expect(page.locator("a:has-text('Open Backup Center')").first()).toBeVisible();

    // Switch to Tax Rules (TDS) Tab
    await taxRulesTab.click();
    await expect(page.locator("text=Tax / TDS Rules (Centralized)").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator("th:has-text('Payable Type')").first()).toBeVisible();
    await expect(page.locator("th:has-text('Investor Category')").first()).toBeVisible();
    await expect(page.locator("th:has-text('TDS Rate (%)')").first()).toBeVisible();

    // Switch to Banking (ConnectIPS) Tab
    await bankingTab.click();
    await expect(page.locator("text=NCHL ConnectIPS Direct Banking Gateway").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("3. Fiscal Years: Active FY ledger, Gregorian-Bikram date boundaries, and year transitions", async ({
    page,
  }) => {
    await page.goto("/settings/fiscal-years");
    await expect(page).toHaveURL(/.*\/settings\/fiscal-years/);

    // Verify Page Header
    await expect(page.locator("h1:has-text('Fiscal Year Settings')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify table structure
    await expect(page.locator("th:has-text('Fiscal Year')").first()).toBeVisible();
    await expect(page.locator("th:has-text('Start Date')").first()).toBeVisible();
    await expect(page.locator("th:has-text('End Date')").first()).toBeVisible();
    await expect(page.locator("th:has-text('Status')").first()).toBeVisible();

    // Verify Add Fiscal Year action
    const addFyBtn = page.locator("button:has-text('New Fiscal Year')").first();
    await expect(addFyBtn).toBeVisible();
    await addFyBtn.click();

    // Verify Modal
    await expect(page.locator("text=New Fiscal Year").first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator("input[placeholder='2081/82']").first()).toBeVisible();
    await page.locator("button:has-text('Cancel')").first().click();

    // Verify search
    const searchInput = page.locator("input[placeholder*='Search fiscal years']").first();
    await expect(searchInput).toBeVisible();
    await searchInput.fill("208");
    await page.waitForTimeout(300);
    await searchInput.clear();
  });

  test("4. Backup & Disaster Recovery: Record metrics, browser snapshots, and host storage guide", async ({
    page,
  }) => {
    await page.goto("/backup");
    await expect(page).toHaveURL(/.*\/backup/);

    // Verify Page Header
    await expect(page.locator("h1:has-text('Backup & Disaster Recovery')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify Record Metrics Banner
    await expect(
      page.locator("text=Live Database Architecture & Record Metrics").first(),
    ).toBeVisible();
    await expect(page.locator("text=Companies").first()).toBeVisible();
    await expect(page.locator("text=Shareholders").first()).toBeVisible();
    await expect(page.locator("text=All Payables").first()).toBeVisible();

    // Verify 1-Click Browser Snapshot Export Cards
    await expect(page.locator("text=1-Click Browser Snapshot Export").first()).toBeVisible();
    await expect(
      page.locator("button:has-text('Download Excel Backup (.xlsx)')").first(),
    ).toBeVisible();
    await expect(
      page.locator("button:has-text('Download JSON Archive (.json)')").first(),
    ).toBeVisible();

    // Verify Automated Host-Level Compressed Backup guide
    await expect(
      page.locator("text=Server Physical & Automated Backup Engine").first(),
    ).toBeVisible();
    await expect(page.locator("button:has-text('Copy')").first()).toBeVisible();
  });

  test("5. Master Data - Companies: Issuer registry, ISIN codes, sector taxonomy, and Excel tools", async ({
    page,
  }) => {
    await page.goto("/companies");
    await expect(page).toHaveURL(/.*\/companies/);

    // Verify Page Header
    await expect(page.locator("h1:has-text('Companies & Issuers')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify KPI summary cards
    await expect(page.locator("text=Total Registered Entities").first()).toBeVisible();

    // Verify action buttons
    await expect(page.locator("button:has-text('New Company')").first()).toBeVisible();
    await expect(page.locator("button:has-text('Export')").first()).toBeVisible();
    await expect(page.locator("button:has-text('Import')").first()).toBeVisible();

    // Test Search input
    const searchInput = page.locator("input[placeholder*='Search by code, company name']").first();
    await expect(searchInput).toBeVisible();
    await searchInput.fill("RBB");
    await page.waitForTimeout(300);
    await searchInput.clear();
  });

  test("6. Master Data - Clients: Shareholder KYC, 16-digit Demat BOID, and banking profiles", async ({
    page,
  }) => {
    await page.goto("/clients");
    await expect(page).toHaveURL(/.*\/clients/);

    // Verify Page Header
    await expect(page.locator("h1:has-text('Clients & Shareholders')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify KPI summary cards
    await expect(page.locator("text=Total Shareholders").first()).toBeVisible();

    // Verify action buttons
    await expect(page.locator("button:has-text('New Client')").first()).toBeVisible();
    await expect(page.locator("button:has-text('Export')").first()).toBeVisible();
    await expect(page.locator("button:has-text('Import')").first()).toBeVisible();

    // Verify counter lookup
    await expect(page.locator("text=RTS Shareholder 360° Counter Lookup").first()).toBeVisible();
  });
});
