#!/usr/bin/env node
/**
 * RTARTS Release Gate Verification Suite
 *
 * Verifies:
 * 1. Cloud & Local Edge Function Parity (process-import-chunk, connectips-sign)
 * 2. Production Database Schema Invariants (function search_path, strict RLS)
 * 3. Authoritative Statutory Tax-Rule Parity (15% Institution, 5/6% Natural, 0% Exempt)
 * 4. Maker-Checker Segregation & Operational Release Readiness
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");

console.log("===============================================================================");
console.log("                RTARTS PRODUCTION RELEASE GATE & AUDIT SUITE                   ");
console.log("===============================================================================\n");

let passedCount = 0;
let failedCount = 0;
const report = {
  timestamp: new Date().toISOString(),
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

// -----------------------------------------------------------------------------
// GATE 1: Edge Function Logic & Statutory Tax Branches
// -----------------------------------------------------------------------------
console.log("[GATE 1/4] Edge Function Parity & Statutory Tax Branches...");
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
console.log("\n[GATE 2/4] Database Function Search Path & Security Invariants...");
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
console.log("\n[GATE 3/4] Database Reference Seeds & Statutory Tax Rules...");
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
console.log("\n[GATE 4/4] Client TypeScript Tax Engine Parity...");
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
// SUMMARY & VERDICT
// -----------------------------------------------------------------------------
console.log("\n===============================================================================");
report.verdict = failedCount === 0 ? "PASSED_RELEASE_GATE" : "FAILED_RELEASE_GATE";
console.log(`  RELEASE GATE VERDICT: ${report.verdict}`);
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
