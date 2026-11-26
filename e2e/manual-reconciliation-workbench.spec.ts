import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const TEST_PASSWORD = "Password123!";

function loadEnvFallback() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([^#=\s]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

async function getAdminSupabase() {
  loadEnvFallback();
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "http://127.0.0.1:54321";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe("Multi-Channel Reconciliation Workbench & BRS End-to-End", () => {
  const tag = `E2EMRW_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const makerEmail = `maker-${tag.toLowerCase()}@example.com`;
  const checkerEmail = `checker-${tag.toLowerCase()}@example.com`;

  let companyId = "";
  let makerId = "";
  let checkerId = "";
  let clientId = "";
  let payableXmlNet = 0;
  let payableManualNet = 0;

  test.beforeAll(async () => {
    const admin = await getAdminSupabase();
    if (!admin) return;

    const { data: comp, error: cErr } = await admin
      .from("companies")
      .insert({
        company_name: `E2E Recon Banc ${tag}`,
        company_code: `E2EMRW_${tag}`,
        company_type: "Commercial Bank",
        fiscal_year: "2082/83",
      })
      .select("id")
      .single();
    if (cErr) throw cErr;
    companyId = comp.id;

    // Provision distinct Maker (reconciliation_officer) & Checker (supervisor)
    const { data: mUser, error: mErr } = await admin.auth.admin.createUser({
      email: makerEmail,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `E2E Maker ${tag}` },
    });
    if (mErr) throw mErr;
    makerId = mUser.user.id;
    await admin
      .from("user_roles")
      .upsert({ user_id: makerId, role: "reconciliation_officer" }, { onConflict: "user_id,role" });
    await admin
      .from("user_company_access")
      .upsert({ user_id: makerId, company_id: companyId }, { onConflict: "user_id,company_id" });

    const { data: cUser, error: chErr } = await admin.auth.admin.createUser({
      email: checkerEmail,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `E2E Checker ${tag}` },
    });
    if (chErr) throw chErr;
    checkerId = cUser.user.id;
    await admin
      .from("user_roles")
      .upsert({ user_id: checkerId, role: "supervisor" }, { onConflict: "user_id,role" });
    await admin
      .from("user_company_access")
      .upsert({ user_id: checkerId, company_id: companyId }, { onConflict: "user_id,company_id" });

    const { data: cli, error: clErr } = await admin
      .from("clients")
      .insert({
        company_id: companyId,
        full_name: `KAMALA THAPA ${tag}`,
        client_code: `CLI_${tag}`,
        boid: `13019500${Math.floor(10000000 + Math.random() * 80000000)}`,
        holder_type: "Natural Person - Public",
        payee_classification: "NATURAL_PERSON",
        classification_status: "CONFIRMED",
        bank_name: "Rastriya Banijya Bank",
        bank_account_no: `99887766${tag.slice(-4)}`,
      })
      .select("id")
      .single();
    if (clErr) throw clErr;
    clientId = cli.id;

    // Two pending payables: 1 for ISO 20022 XML match, 1 for Manual Entry Maker-Checker workflow
    const { data: p1, error: p1Err } = await admin
      .from("dividend_payables")
      .insert({
        company_id: companyId,
        client_id: clientId,
        fiscal_year: "2082/83",
        shares_held: 500,
        dividend_rate: 10,
        gross_dividend: 5000,
        tax_amount: 250,
        bonus_tax: 0,
        net_payable: 4750,
        remaining_amount: 4750,
        tds_rate: 0.05,
        payment_status: "Pending",
        payee_classification: "NATURAL_PERSON",
        classification_status: "CONFIRMED",
      })
      .select("id, net_payable")
      .single();
    if (p1Err) throw p1Err;
    payableXmlNet = Number(p1.net_payable);

    const { data: p2, error: p2Err } = await admin
      .from("dividend_payables")
      .insert({
        company_id: companyId,
        client_id: clientId,
        fiscal_year: "2081/82",
        shares_held: 250,
        dividend_rate: 10,
        gross_dividend: 2500,
        tax_amount: 125,
        bonus_tax: 0,
        net_payable: 2375,
        remaining_amount: 2375,
        tds_rate: 0.05,
        payment_status: "Pending",
        payee_classification: "NATURAL_PERSON",
        classification_status: "CONFIRMED",
      })
      .select("id, net_payable")
      .single();
    if (p2Err) throw p2Err;
    payableManualNet = Number(p2.net_payable);
  });

  test.afterAll(async () => {
    const admin = await getAdminSupabase();
    if (!admin || !companyId) return;
    await admin.from("reconciliation_period_locks").delete().eq("company_id", companyId);
    await admin.from("reconciliation_exceptions").delete().eq("company_id", companyId);
    await admin.from("reconciliation_results").delete().eq("company_id", companyId);
    await admin.from("reconciliation_runs").delete().eq("company_id", companyId);
    await admin.from("payments").delete().eq("company_id", companyId);
    await admin.from("payment_batches").delete().eq("company_id", companyId);
    await admin.from("bank_statement_transactions").delete().eq("company_id", companyId);
    await admin.from("bank_statement_imports").delete().eq("company_id", companyId);
    if (makerId) {
      await admin.from("pending_approvals").delete().eq("requested_by", makerId);
    }
    if (checkerId) {
      await admin.from("pending_approvals").delete().eq("requested_by", checkerId);
    }
    await admin.from("dividend_payables").delete().eq("company_id", companyId);
    await admin.from("clients").delete().eq("company_id", companyId);
    await admin.from("user_company_access").delete().eq("company_id", companyId);
    await admin.from("companies").delete().eq("id", companyId);
    if (makerId) {
      await admin.from("user_roles").delete().eq("user_id", makerId);
      await admin.auth.admin.deleteUser(makerId).catch(() => {});
    }
    if (checkerId) {
      await admin.from("user_roles").delete().eq("user_id", checkerId);
      await admin.auth.admin.deleteUser(checkerId).catch(() => {});
    }
  });

  test("Full End-to-End: ISO 20022 XML Upload + Persistent Ledger + Manual Entry Maker->Checker + BRS Verification", async ({
    page,
    browser,
  }) => {
    test.setTimeout(90000);
    test.skip(!companyId, "Live Supabase service role key unavailable in environment");

    // 1. Maker signs in and visits /reconciliation
    await page.goto("/auth");
    await page.locator('input[type="email"]').fill(makerEmail);
    await page.locator('input[type="password"]').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/.*\/dashboard/, { timeout: 15000 });

    await page.goto("/reconciliation");
    await expect(page.locator("h1:has-text('Reconciliation Engine')").first()).toBeVisible({
      timeout: 10000,
    });

    // Verify new header controls & standard file extensions
    await expect(page.locator("button:has-text('Manual Entry / Match')").first()).toBeVisible();
    await expect(page.locator("button:has-text('Sync ConnectIPS')").first()).toBeVisible();
    const acceptAttr = await page.locator("#reconcile-bank-upload").getAttribute("accept");
    expect(acceptAttr).toContain(".xml");
    expect(acceptAttr).toContain(".mt940");

    // Scope to our single test company (maker only has companyId access, auto-resolved on upload too!)
    const camtXml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <Stmt>
      <Id>E2E-STMT-${tag}</Id>
      <Acct>
        <Id><Othr><Id>042000111222</Id></Othr></Id>
        <Ccy>NPR</Ccy>
        <Svcr><FinInstnId><Nm>Rastriya Banijya Bank</Nm></FinInstnId></Svcr>
      </Acct>
      <Bal>
        <Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="NPR">50000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-11-10</Dt></Dt>
      </Bal>
      <Bal>
        <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="NPR">${(50000 - payableXmlNet - 50).toFixed(2)}</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-11-10</Dt></Dt>
      </Bal>
      <Ntry>
        <NtryRef>XML-${tag}-01</NtryRef>
        <Amt Ccy="NPR">${payableXmlNet.toFixed(2)}</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>2026-11-10</Dt></BookgDt>
        <NtryDtls>
          <TxDtls>
            <Refs><InstrId>IPS-XML-${tag}</InstrId></Refs>
            <RltdPties>
              <Cdtr><Nm>KAMALA THAPA ${tag}</Nm></Cdtr>
              <CdtrAcct><Id><Othr><Id>99887766${tag.slice(-4)}</Id></Othr></Id></CdtrAcct>
            </RltdPties>
            <RmtInf><Ustrd>FY 2082/83 Dividend Payout</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <NtryRef>FEE-${tag}-01</NtryRef>
        <Amt Ccy="NPR">50.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>2026-11-10</Dt></BookgDt>
        <BkTxCd><Domn><Fmly><SubFmlyCd>CHRG</SubFmlyCd></Fmly></Domn></BkTxCd>
        <AddtlNtryInf>NCHL ConnectIPS Fee</AddtlNtryInf>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

    // 2. Upload ISO 20022 camt.053 XML bank statement directly via #reconcile-bank-upload
    await page.locator("#reconcile-bank-upload").setInputFiles({
      name: `camt053_${tag}.xml`,
      mimeType: "text/xml",
      buffer: Buffer.from(camtXml, "utf8"),
    });

    await expect(page.locator("text=Reconciliation Analysis").first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator(`text=KAMALA THAPA ${tag}`).first()).toBeVisible({ timeout: 10000 });

    // Apply matched ISO 20022 transaction to system
    await page.locator("button:has-text('Apply to System')").first().click();
    const postModal = page.locator("[role='dialog']");
    await expect(postModal).toBeVisible({ timeout: 5000 });
    await postModal.locator("#recon-ack").click();
    await postModal.locator("button:has-text('Confirm & Commit Posting')").click();
    await expect(postModal).toBeHidden({ timeout: 20000 });

    // Reload /reconciliation and verify persistent Bank Ledger & Manual Matching tab
    await page.reload();
    await expect(page.locator("text=Bank Ledger & Manual Matching Workbench").first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(`text=FEE-${tag}-01`).first()).toBeVisible({ timeout: 10000 });

    // Switch status filter to "All Statuses" to verify XML payout transitioned cleanly to reconciled!
    await page.getByRole("combobox").filter({ hasText: "Unreconciled" }).first().click();
    await page.getByRole("option", { name: "All Statuses", exact: true }).click();
    await expect(page.locator(`text=IPS-XML-${tag}`).first()).toBeVisible({ timeout: 10000 });

    // 3. Maker submits a controlled Manual Entry paired to the second pending payable (2375)
    const manualRef = `CHQ-MAN-${tag}`;
    await page.locator("button:has-text('Manual Entry / Match')").first().click();
    const manualDlg = page.locator("[role='dialog']");
    await expect(
      manualDlg.locator("text=Manual Reconciliation & Voucher Workbench").first(),
    ).toBeVisible({ timeout: 5000 });

    await manualDlg.locator("input[placeholder='0.00']").fill(String(payableManualNet));
    await manualDlg.locator("input[placeholder*='CHQ-40912']").fill(manualRef);
    await manualDlg.locator("input[placeholder*='Global IME Bank']").fill("Rastriya Banijya Bank");
    await manualDlg.locator("textarea").fill(`E2E counter cheque settlement for ${manualRef}`);

    // Wait for pending payable search row (FY 2081/82, remaining = 2375) and select its checkbox
    const payableSearchInput = manualDlg.locator("input[placeholder*='Search pending dividends']");
    await payableSearchInput.fill("2081/82");
    const targetPayableRow = manualDlg
      .locator(".divide-y > div", { hasText: `KAMALA THAPA ${tag}` })
      .filter({ hasText: "FY 2081/82" })
      .first();
    await expect(targetPayableRow).toBeVisible({ timeout: 10000 });
    await targetPayableRow.locator("button[role='checkbox']").first().click();

    await manualDlg.locator("button:has-text('Submit for Checker Approval')").click();
    await expect(manualDlg).toBeHidden({ timeout: 15000 });

    // 4. Verify Maker sees 'Pending Checker' badge in Bank Ledger
    await expect(page.locator(`text=${manualRef}`).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Pending Checker").first()).toBeVisible({ timeout: 10000 });

    // Check Exceptions & Variance Approvals + BRS tabs for Maker visibility
    await page
      .locator("button[role='tab']:has-text('Exceptions & Variance Approvals')")
      .first()
      .click();
    await expect(page.locator("text=Durable Exceptions Queue").first()).toBeVisible();
    await page.locator("button[role='tab']:has-text('BRS & Period Close')").first().click();
    await expect(
      page.locator("text=Formal Bank Reconciliation Statement (BRS) & Period Close").first(),
    ).toBeVisible();

    // 5. Checker (distinct context) logs in, reviews & approves on /approvals
    const checkerCtx = await browser.newContext();
    const checkerPage = await checkerCtx.newPage();
    try {
      await checkerPage.goto("/auth");
      await checkerPage.locator('input[type="email"]').fill(checkerEmail);
      await checkerPage.locator('input[type="password"]').fill(TEST_PASSWORD);
      await checkerPage.locator('button[type="submit"]').click();
      await checkerPage.waitForURL(/.*\/dashboard/, { timeout: 15000 });

      await checkerPage.goto("/approvals");
      await expect(
        checkerPage
          .locator("h1, h2")
          .filter({ hasText: /Approvals/i })
          .first(),
      ).toBeVisible({
        timeout: 10000,
      });

      const approvalRow = checkerPage
        .locator("tr")
        .filter({ hasText: "manual reconciliation" })
        .first();
      await expect(approvalRow).toBeVisible({ timeout: 10000 });
      await approvalRow.locator("button:has-text('Review')").click();

      const reviewDlg = checkerPage.locator("[role='dialog']");
      await expect(reviewDlg.locator(`text=${manualRef}`).first()).toBeVisible({ timeout: 5000 });
      await reviewDlg
        .locator("textarea")
        .fill("Verified CBS counterfoil and authorized settlement");
      await reviewDlg.locator("button:has-text('Approve & Execute')").click();
      await expect(reviewDlg).toBeHidden({ timeout: 15000 });

      // Checker visits /reconciliation -> Bank Ledger -> verifies CHQ-MAN became reconciled
      await checkerPage.goto("/reconciliation");
      await expect(
        checkerPage.locator("text=Bank Ledger & Manual Matching Workbench").first(),
      ).toBeVisible({ timeout: 10000 });
      await checkerPage.getByRole("combobox").filter({ hasText: "Unreconciled" }).first().click();
      await checkerPage.getByRole("option", { name: "Reconciled", exact: true }).click();
      await expect(checkerPage.locator(`text=${manualRef}`).first()).toBeVisible({
        timeout: 10000,
      });

      // Verify BRS shows combined settled debits
      await checkerPage
        .locator("button[role='tab']:has-text('BRS & Period Close')")
        .first()
        .click();
      await expect(checkerPage.locator("text=Unreconciled Aging Bucket").first()).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await checkerCtx.close();
    }

    // 6. Verify DB state directly via admin client: both payables MUST be Paid and ledger invariant 0 violations
    const admin = await getAdminSupabase();
    if (admin) {
      const { data: paidPayables } = await admin
        .from("dividend_payables")
        .select("payment_status, paid_amount")
        .eq("company_id", companyId);
      expect(paidPayables).toHaveLength(2);
      expect(paidPayables!.every((p: any) => p.payment_status === "Paid")).toBe(true);

      const { data: auditRes } = await admin.rpc("run_ledger_invariant_audit", {
        p_company_id: companyId,
      });
      expect(auditRes?.passed).toBe(true);
      expect(Number(auditRes?.total_violations ?? -1)).toBe(0);
    }
  });
});
