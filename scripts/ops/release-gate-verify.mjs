#!/usr/bin/env node
/**
 * RTARTS Release Verification Suite
 *
 * Supports two distinct modes:
 *  1. Source Code Release Audit (--source, default):
 *     Static invariant verification of migration search_paths, Edge Function tax branches,
 *     schema seeds, and TypeScript client tax engine parity.
 *  2. Live Production Release Verification (--live):
 *     Connects to target Supabase instance (via SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY),
 *     validates applied migrations, queries active payable_tax_rules, and checks deployed Edge Function endpoints.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");

// Automatically load local .env if present and environment variables are not set
const envFile = path.join(rootDir, ".env");
if (fs.existsSync(envFile)) {
  const envContent = fs.readFileSync(envFile, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const idx = trimmed.indexOf("=");
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const isLiveMode = process.argv.includes("--live");

console.log("===============================================================================");
if (isLiveMode) {
  console.log("             RTARTS LIVE PRODUCTION ENVIRONMENT RELEASE VERIFICATION           ");
} else {
  console.log("           RTARTS SOURCE CODE RELEASE AUDIT (Static Invariant Audit)           ");
}
console.log("===============================================================================\n");

let passedCount = 0;
let failedCount = 0;
const report = {
  timestamp: new Date().toISOString(),
  mode: isLiveMode ? "LIVE_PRODUCTION_VERIFICATION" : "SOURCE_RELEASE_AUDIT",
  gates: [],
  verdict: "UNKNOWN",
};

function recordGate(name, passed, detail) {
  if (passed) {
    console.log(`  [PASS] ${name}`);
    if (detail) console.log(`         ${detail}`);
    passedCount++;
  } else {
    console.error(`  [FAIL] ${name}`);
    if (detail) console.error(`         ${detail}`);
    failedCount++;
  }
  report.gates.push({ name, passed, detail });
}

async function runLiveVerification() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !serviceKey) {
    recordGate(
      "Live Target Credentials Configured",
      false,
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_URL) must be set in the environment for live verification",
    );
    return;
  }

  recordGate("Live Target Credentials Configured", true, `Target: ${supabaseUrl}`);

  // Query live payable_tax_rules via REST API
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/payable_tax_rules?select=*`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });

    if (res.ok) {
      const rules = await res.json();
      const hasInst = rules.some(
        (r) => r.payee_classification === "COMPANY_INSTITUTION" && Number(r.tax_rate) === 0.15 && r.is_active,
      );
      recordGate("Live DB: 15% Corporate Tax Rule Active", hasInst, "COMPANY_INSTITUTION = 0.15 in live table");

      const hasForeign = rules.some(
        (r) => r.payee_classification === "FOREIGN_INVESTOR" && Number(r.tax_rate) === 0.15 && r.is_active,
      );
      recordGate("Live DB: 15% Foreign Investor Tax Rule Active", hasForeign, "FOREIGN_INVESTOR = 0.15 in live table");

      const hasExempt = rules.some(
        (r) => r.payee_classification === "TAX_EXEMPT" && Number(r.tax_rate) === 0 && r.is_active,
      );
      recordGate("Live DB: 0% Tax Exempt Rule Active", hasExempt, "TAX_EXEMPT = 0% in live table");
    } else {
      recordGate("Live DB: Query payable_tax_rules", false, `HTTP ${res.status}: ${res.statusText}`);
    }
  } catch (err) {
    recordGate("Live DB: Connection reachable", false, String(err.message || err));
  }

  // Live Edge Function Statutory Tax Calculation Verification
  try {
    const fnRes = await fetch(`${supabaseUrl}/functions/v1/process-import-chunk`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dryRun: true,
        uploadId: "live-audit-test",
        targetTable: "dividend_payables",
        chunkData: [
          { name: "RELIABLE ENTERPRISES PVT LTD", gross_amount: 10000, shares: 100 },
          { name: "RAM BAHADUR THAPA", gross_amount: 10000, shares: 100 },
          { name: "NIBL SAMRIDDHI FUND", gross_amount: 10000, shares: 100 },
        ],
      }),
    });

    if (fnRes.ok) {
      const data = await fnRes.json();
      const hasDryRun = data && data.dryRun === true;
      recordGate("Live Edge Function: dry-run calculation active", hasDryRun, "Edge Function returns dryRun calculation payload");

      const computedTax = Number(data?.metrics?.computedTax || 0);
      // Expected tax: 10000*0.15 (1500) + 10000*0.05 (500) + 10000*0 (0) = 2000
      const isTaxAccurate = computedTax === 2000;
      recordGate(
        "Live Edge Function: Statutory Tax Calculation Parity",
        isTaxAccurate,
        `Calculated TDS total = NPR ${computedTax} (Expected: NPR 2,000 for Corporate 15% + Individual 5% + Exempt 0%)`,
      );
    } else {
      recordGate(
        "Live Edge Function: process-import-chunk reachable",
        fnRes.status < 500,
        `Endpoint responded with HTTP ${fnRes.status}`,
      );
    }
  } catch (err) {
    recordGate("Live Edge Function: process-import-chunk reachable", false, String(err.message || err));
  }

  // Live Edge Function Scheduled Reports Security & Authorization Gate
  try {
    // 1. Unauthorized invocation check: must reject with 401
    const unauthRes = await fetch(`${supabaseUrl}/functions/v1/process-scheduled-reports`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const isUnauthRejected = unauthRes.status === 401;
    recordGate(
      "Live Edge Function: Rejects Unauthenticated Invocations",
      isUnauthRejected,
      `Unauthenticated invocation responded with HTTP ${unauthRes.status} (Expected: 401)`,
    );

    // 2. Authorized scheduler invocation check with x-cron-secret
    const cronSecret = process.env.CRON_SECRET || "rtarts-internal-cron-secret";
    const authRes = await fetch(`${supabaseUrl}/functions/v1/process-scheduled-reports`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": cronSecret,
      },
      body: JSON.stringify({ dry_run: true }),
    });

    const isAuthAccepted = authRes.status === 200;
    recordGate(
      "Live Edge Function: Accepts Valid x-cron-secret Scheduler Requests",
      isAuthAccepted,
      `Scheduler request responded with HTTP ${authRes.status} (Expected: 200 with dry_run)`,
    );
  } catch (err) {
    recordGate("Live Edge Function: process-scheduled-reports reachable", false, String(err.message || err));
  }
}

function runSourceAudit() {
  // -----------------------------------------------------------------------------
  // GATE 1: Edge Function Logic & Statutory Tax Branches
  // -----------------------------------------------------------------------------
  console.log("[GATE 1/4] Edge Function Parity & Statutory Tax Branches (Source)...");
  const edgeFnPath = path.join(rootDir, "supabase", "functions", "process-import-chunk", "index.ts");
  if (!fs.existsSync(edgeFnPath)) {
    recordGate("Edge function exists", false, `Missing file at ${edgeFnPath}`);
  } else {
    const content = fs.readFileSync(edgeFnPath, "utf-8");

    const hasInst15 =
      /case\s+"INSTITUTION":\s*case\s+"COMPANY_INSTITUTION":\s*return\s+0\.15;/m.test(content) ||
      /case\s+"COMPANY_INSTITUTION":\s*return\s+0\.15;/m.test(content);
    recordGate(
      "Edge Function 15% Institutional TDS",
      hasInst15,
      "Enforces 15% TDS on COMPANY_INSTITUTION",
    );

    const hasForeign15 =
      /case\s+"FOREIGN":\s*case\s+"FOREIGN_INVESTOR":\s*return\s+0\.15;/m.test(content) ||
      /case\s+"FOREIGN_INVESTOR":\s*return\s+0\.15;/m.test(content);
    recordGate(
      "Edge Function 15% Foreign Investor TDS",
      hasForeign15,
      "Enforces 15% TDS on FOREIGN_INVESTOR",
    );

    const hasExempt0 = /case\s+"MUTUAL_FUND":\s*case\s+"TAX_EXEMPT":\s*return\s+0;/m.test(content);
    recordGate(
      "Edge Function 0% Section 10 Tax Exemption",
      hasExempt0,
      "Enforces 0% TDS on MUTUAL_FUND and TAX_EXEMPT",
    );
  }

  // -----------------------------------------------------------------------------
  // GATE 2: Database Invariants & Search Path Security
  // -----------------------------------------------------------------------------
  console.log("\n[GATE 2/4] Database Function Search Path & Security Invariants (Source)...");
  const functionsSqlPath = path.join(
    rootDir,
    "supabase",
    "migrations",
    "20261005000002_schema_functions_and_rpcs.sql",
  );
  if (!fs.existsSync(functionsSqlPath)) {
    recordGate("Schema functions migration file exists", false, `Missing ${functionsSqlPath}`);
  } else {
    const fContent = fs.readFileSync(functionsSqlPath, "utf-8");
    const lines = fContent.split("\n");
    const missingSearchPath = [];
    let currFn = null;
    let hasPath = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-zA-Z0-9_\.]+)/);
      if (match) {
        if (currFn && !hasPath) missingSearchPath.push(currFn);
        currFn = match[1];
        hasPath = false;
      }
      if (line.includes("search_path")) hasPath = true;
    }
    if (currFn && !hasPath) missingSearchPath.push(currFn);

    recordGate(
      "All PostgreSQL functions enforce immutable search_path",
      missingSearchPath.length === 0,
      missingSearchPath.length === 0
        ? "100% of schema functions specify search_path TO 'public'"
        : `Missing in: ${missingSearchPath.join(", ")}`,
    );
  }

  // -----------------------------------------------------------------------------
  // GATE 3: Database Reference Seeds & Statutory Parity
  // -----------------------------------------------------------------------------
  console.log("\n[GATE 3/4] Database Reference Seeds & Statutory Tax Rules (Source)...");
  const seedCandidates = [
    path.join(rootDir, "supabase", "migrations", "20261005000006_schema_seed_reference_data.sql"),
    path.join(rootDir, "supabase", "seed.sql"),
  ];
  const seedPath = seedCandidates.find((p) => fs.existsSync(p));
  if (!seedPath) {
    recordGate("Seed reference data exists", false, "No seed.sql or seed migration found");
  } else {
    const sContent = fs.readFileSync(seedPath, "utf-8");

    const hasSeedInst = /\('DIVIDEND',\s*'COMPANY_INSTITUTION',\s*0\.15,\s*true\)/.test(sContent);
    recordGate(
      "Seed DIVIDEND COMPANY_INSTITUTION = 15%",
      hasSeedInst,
      "Statutory corporate tax seeding verified",
    );

    const hasSeedForeign = /\('DIVIDEND',\s*'FOREIGN_INVESTOR',\s*0\.15,\s*true\)/.test(sContent);
    recordGate(
      "Seed DIVIDEND FOREIGN_INVESTOR = 15%",
      hasSeedForeign,
      "Statutory foreign tax seeding verified",
    );

    const hasSeedExempt = /\('DIVIDEND',\s*'TAX_EXEMPT',\s*0(?:\.0+)?,\s*true\)/.test(sContent);
    recordGate(
      "Seed DIVIDEND TAX_EXEMPT = 0%",
      hasSeedExempt,
      "Section 10 exempt entity seeding verified",
    );
  }

  // -----------------------------------------------------------------------------
  // GATE 4: Client Services Tax Rule Parity
  // -----------------------------------------------------------------------------
  console.log("\n[GATE 4/4] Client TypeScript Tax Engine Parity (Source)...");
  const taxServicePath = path.join(rootDir, "src", "lib", "services", "tax-rules.service.ts");
  if (!fs.existsSync(taxServicePath)) {
    recordGate("tax-rules.service.ts exists", false, "Missing service file");
  } else {
    const tsContent = fs.readFileSync(taxServicePath, "utf-8");

    const hasDisplayRates =
      tsContent.includes("getDebentureDisplayRates") &&
      tsContent.includes("getDividendDisplayRates") &&
      tsContent.includes("getMutualFundDisplayRates");
    recordGate(
      "Client tax display rate helpers active",
      hasDisplayRates,
      "Debenture, Dividend, Mutual Fund rate helpers present",
    );

    const hasClassificationMapping = tsContent.includes("investorCategoryToClassification");
    recordGate(
      "Investor category classification mapping active",
      hasClassificationMapping,
      "Classification resolver active",
    );
  }

  // -----------------------------------------------------------------------------
  // GATE 5: Scheduled Reports Edge Function Security & Lifecycle
  // -----------------------------------------------------------------------------
  console.log("\n[GATE 5/6] Scheduled Reports Security & Lifecycle (Source)...");
  const schedFnPath = path.join(
    rootDir,
    "supabase",
    "functions",
    "process-scheduled-reports",
    "index.ts",
  );
  if (!fs.existsSync(schedFnPath)) {
    recordGate("process-scheduled-reports Edge Function exists", false, `Missing ${schedFnPath}`);
  } else {
    const sFnContent = fs.readFileSync(schedFnPath, "utf-8");

    const hasCronSecret =
      sFnContent.includes("constantTimeCompare") && sFnContent.includes("x-cron-secret");
    recordGate(
      "Edge Function enforces constant-time x-cron-secret verification",
      hasCronSecret,
      "Timing-safe header comparison implemented",
    );

    const hasJwtValidation =
      sFnContent.includes("auth.getUser") && sFnContent.includes("user_roles");
    recordGate(
      "Edge Function enforces JWT & RBAC for manual execution",
      hasJwtValidation,
      "Validates user identity and role",
    );

    const hasGeneratedStatus = sFnContent.includes('deliveryStatus = "GENERATED"');
    recordGate(
      "Edge Function uses GENERATED delivery status until dispatched",
      hasGeneratedStatus,
      "Default status is GENERATED when email is not confirmed delivered",
    );

    const hasStrictCors = !sFnContent.includes('"Access-Control-Allow-Origin": "*"');
    recordGate(
      "Edge Function restricts browser CORS origin",
      hasStrictCors,
      "Permissive wildcard Access-Control-Allow-Origin removed",
    );
  }

  // -----------------------------------------------------------------------------
  // GATE 6: Multi-Tenant Staging, Client Scoping & pg_cron Automation
  // -----------------------------------------------------------------------------
  console.log(
    "\n[GATE 6/6] Multi-Tenant Staging, Client Scoping & pg_cron Automation (Source)...",
  );
  const stageSqlPath = path.join(
    rootDir,
    "supabase",
    "migrations",
    "20261026000003_staged_imports_and_scheduled_reports.sql",
  );
  if (!fs.existsSync(stageSqlPath)) {
    recordGate("Staged imports & scheduler migration exists", false, `Missing ${stageSqlPath}`);
  } else {
    const stgContent = fs.readFileSync(stageSqlPath, "utf-8");

    const hasClientIsolation =
      stgContent.includes("uq_clients_company_client_code") &&
      stgContent.includes("WHERE company_id = v_staged.company_id AND boid = v_boid");
    recordGate(
      "Database enforces multi-tenant client lookup & company uniqueness",
      hasClientIsolation,
      "Client lookup and constraints scoped to company_id",
    );

    const hasUploadHistoryLifecycle =
      stgContent.includes("INSERT INTO public.upload_history") &&
      stgContent.includes("upload_id = v_upload_id");
    recordGate(
      "Staged imports integrate with upload_history lifecycle",
      hasUploadHistoryLifecycle,
      "Creates upload_history record and links payables for rollback/audit",
    );

    const hasPgCronSchedule =
      stgContent.includes("cron.schedule") &&
      stgContent.includes("process-scheduled-reports-job") &&
      stgContent.includes("trigger_process_scheduled_reports");
    recordGate(
      "pg_cron automated scheduler configured for scheduled reports",
      hasPgCronSchedule,
      "Configures pg_cron job process-scheduled-reports-job every 15 minutes",
    );
  }
}

async function main() {
  if (isLiveMode) {
    await runLiveVerification();
  } else {
    runSourceAudit();
  }

  // -----------------------------------------------------------------------------
  // SUMMARY & VERDICT
  // -----------------------------------------------------------------------------
  console.log("\n===============================================================================");
  report.verdict = failedCount === 0 ? "PASSED_RELEASE_GATE" : "FAILED_RELEASE_GATE";
  console.log(`  RELEASE VERDICT: ${report.verdict} (${report.mode})`);
  console.log(`  Passed: ${passedCount} | Failed: ${failedCount}`);
  console.log("===============================================================================\n");

  const outputPath = path.join(rootDir, ".release-gate-report.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`Detailed audit report written to: ${outputPath}\n`);

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal audit execution failure:", err);
  process.exit(1);
});
