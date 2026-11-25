#!/usr/bin/env node
/**
 * Runs Supabase SQL static/runtime lint and security/performance advisors
 * against the local Supabase database and fails non-zero on any ERROR finding.
 */
import { execSync } from "node:child_process";

function extractJsonArray(raw, label) {
  const cleaned = raw
    .split(/\r?\n/)
    .filter(
      (line) =>
        !line.startsWith("Connecting to ") &&
        !line.startsWith("Linting schema:") &&
        !line.startsWith("A new version of Supabase CLI") &&
        !line.startsWith("We recommend updating"),
    )
    .join("\n")
    .trim();

  if (!cleaned) return [];
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Unable to parse JSON array from ${label}: ${cleaned.slice(0, 300)}`);
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function main() {
  let failed = false;

  console.log("[1/2] Running supabase db lint --local --output json...");
  const lintOut = execSync("npx supabase db lint --local --output json", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lintItems = extractJsonArray(lintOut, "supabase db lint");
  const lintErrors = [];
  for (const fnItem of lintItems) {
    for (const issue of fnItem.issues || []) {
      if (String(issue.level || "").toLowerCase() === "error") {
        lintErrors.push({ function: fnItem.function, ...issue });
      }
    }
  }
  if (lintErrors.length > 0) {
    failed = true;
    console.error(`  [FAIL] ${lintErrors.length} SQL lint error(s):`);
    for (const err of lintErrors) {
      console.error(`    - ${err.function} (${err.sqlState || "unknown"}): ${err.message}`);
    }
  } else {
    console.log("  [PASS] 0 SQL lint errors.");
  }

  console.log("[2/2] Running supabase db advisors --local --output json...");
  const advOut = execSync("npx supabase db advisors --local --output json", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const advisors = extractJsonArray(advOut, "supabase db advisors");
  const advErrors = advisors.filter((a) => String(a.level || "").toUpperCase() === "ERROR");
  const advWarns = advisors.filter((a) => String(a.level || "").toUpperCase() === "WARN");
  console.log(`  Found ${advErrors.length} ERROR advisor(s), ${advWarns.length} WARN advisor(s).`);
  if (advErrors.length > 0) {
    failed = true;
    for (const err of advErrors) {
      console.error(`    - [ERROR] ${err.name}: ${err.detail || err.description}`);
    }
  } else {
    console.log("  [PASS] 0 security/advisor ERROR findings.");
  }

  if (failed) {
    process.exit(1);
  }
}

main();
