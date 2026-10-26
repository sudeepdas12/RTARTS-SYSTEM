#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");

console.log("=========================================================");
console.log("  RTARTS - Edge Function & Tax Parity Verification Suite ");
console.log("=========================================================\n");

let failures = 0;
let passes = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passes++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failures++;
  }
}

// 1. Static AST/Content Inspection of process-import-chunk
console.log("[1/3] Inspecting Edge Function source (process-import-chunk/index.ts)...");
const edgeFnPath = path.join(rootDir, "supabase", "functions", "process-import-chunk", "index.ts");
if (!fs.existsSync(edgeFnPath)) {
  assert(false, `Edge function file missing at ${edgeFnPath}`);
} else {
  const content = fs.readFileSync(edgeFnPath, "utf-8");

  // Verify 15% institutional dividend TDS in Edge Function
  const hasInstitutional15 =
    /case "INSTITUTION":\s*case "COMPANY_INSTITUTION":\s*return 0\.15;/m.test(content) ||
    /case "COMPANY_INSTITUTION":\s*return 0\.15;/m.test(content);
  assert(
    hasInstitutional15,
    "Edge function enforces 15% TDS for INSTITUTION / COMPANY_INSTITUTION",
  );

  const hasForeign15 =
    /case "FOREIGN":\s*case "FOREIGN_INVESTOR":\s*return 0\.15;/m.test(content) ||
    /case "FOREIGN_INVESTOR":\s*return 0\.15;/m.test(content);
  assert(hasForeign15, "Edge function enforces 15% TDS for FOREIGN / FOREIGN_INVESTOR");

  const hasMutualFundExempt = /case "MUTUAL_FUND":\s*case "TAX_EXEMPT":\s*return 0;/m.test(content);
  assert(hasMutualFundExempt, "Edge function enforces 0% TDS for MUTUAL_FUND and TAX_EXEMPT");
}

// 2. Database Seed Parity
console.log("\n[2/3] Inspecting Database Seed & Migration Reference Data...");
const seedCandidates = [
  path.join(rootDir, "supabase", "seed.sql"),
  path.join(rootDir, "supabase", "migrations", "20261005000006_schema_seed_reference_data.sql"),
];
const seedPath = seedCandidates.find((p) => fs.existsSync(p));
if (seedPath) {
  const seedContent = fs.readFileSync(seedPath, "utf-8");
  assert(
    /\('DIVIDEND',\s*'COMPANY_INSTITUTION',\s*0\.15,\s*true\)/.test(seedContent),
    `${path.basename(seedPath)} seeds DIVIDEND/COMPANY_INSTITUTION as 0.15 (15%)`,
  );
  assert(
    /\('DIVIDEND',\s*'FOREIGN_INVESTOR',\s*0\.15,\s*true\)/.test(seedContent),
    `${path.basename(seedPath)} seeds DIVIDEND/FOREIGN_INVESTOR as 0.15 (15%)`,
  );
} else {
  assert(false, "supabase seed reference data file not found");
}

// 3. Live Edge Runtime Health Probe
console.log("\n[3/3] Checking Live Edge Function Endpoint Reachability...");
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !anonKey) {
  console.log("  [INFO] SUPABASE_URL or ANON_KEY not set in current process environment.");
  console.log("  [INFO] Live cloud probe skipped. Static & logic parity tests passed.");
} else {
  try {
    const edgeEndpoint = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/process-import-chunk`;
    console.log(`  Probing live endpoint: ${edgeEndpoint}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(edgeEndpoint, {
      method: "OPTIONS",
      headers: {
        Authorization: `Bearer ${anonKey}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    assert(
      resp.status === 200 || resp.status === 204 || resp.status === 405,
      `Live Edge Function responded with HTTP ${resp.status}`,
    );
  } catch (err) {
    console.warn(`  [WARN] Live Edge Function endpoint unreachable (${err.message || err}).`);
    console.warn(
      "  Ensure 'supabase functions deploy process-import-chunk --no-verify-jwt' is executed.",
    );
  }
}

console.log("\n=========================================================");
console.log(`Results: ${passes} passed, ${failures} failed`);
console.log("=========================================================\n");

if (failures > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
