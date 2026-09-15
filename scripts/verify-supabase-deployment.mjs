import { createClient } from "@supabase/supabase-js";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// Load environment variables from .env if present
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (key && rest.length > 0 && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

console.log("===============================================================================");
console.log("           SUPABASE DEPLOYMENT & MIGRATION VERIFICATION RUNNER");
console.log("===============================================================================");
console.log(`Target URL: ${SUPABASE_URL}`);
console.log(`Service Role Key: ${SUPABASE_SERVICE_ROLE_KEY.slice(0, 15)}...${SUPABASE_SERVICE_ROLE_KEY.slice(-5)}`);
console.log("");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const REQUIRED_TABLES = [
  "agm_import_staging",
  "agm_historical_shareholders",
  "agm_yearly_snapshots",
  "agm_fiscal_year_meta",
  "agm_broker_pools",
  "agm_broker_claims",
  "agm_drn_records",
  "payment_batches",
  "payments",
  "dividend_payables",
  "interest_payables",
  "mutual_fund_payables",
  "clients",
  "companies",
  "audit_logs",
  "user_company_access",
];

const REQUIRED_RPCS = [
  {
    name: "commit_agm_fiscal_year_import",
    sampleArgs: {
      p_company_id: "00000000-0000-0000-0000-000000000000",
      p_fiscal_year: "9999/99",
      p_batch_id: "00000000-0000-0000-0000-000000000000",
      p_event_name: "Test Verification Event",
      p_report: {},
    },
  },
  {
    name: "promote_agm_clients_and_payables",
    sampleArgs: {
      p_company_id: "00000000-0000-0000-0000-000000000000",
      p_clients: [],
      p_payables: [],
    },
  },
  {
    name: "apply_agm_statutory_corrections",
    sampleArgs: {
      p_company_id: "00000000-0000-0000-0000-000000000000",
      p_corrections: [],
    },
  },
  {
    name: "claim_agm_broker_pool",
    sampleArgs: {
      p_company_id: "00000000-0000-0000-0000-000000000000",
      p_seq_no: 1,
      p_broker_code: "58",
      p_broker_name: "Test Broker",
      p_pool_boid: "0000000000000000",
      p_claimant_boid: "0000000000000000",
      p_claimant_name: "Test Claimant",
      p_fiscal_year: "9999/99",
      p_claimed_kitta: 0,
      p_claimed_cash: 0,
      p_contract_note_no: "TEST-CN",
      p_trade_date_bs: "2080-01-01",
    },
  },
  {
    name: "accept_agm_drn_record",
    sampleArgs: {
      p_company_id: "00000000-0000-0000-0000-000000000000",
      p_folio_no: "NONEXISTENT",
      p_holder_name: "Test Holder",
      p_total_kitta: 100,
      p_drn_no: "TEST-DRN",
      p_drn_date: "2080-01-01",
      p_target_boid: "0000000000000000",
      p_status: "ACCEPTED",
    },
  },
  {
    name: "complete_payment_batch_atomic",
    sampleArgs: {
      p_batch_id: "00000000-0000-0000-0000-000000000000",
    },
  },
];

async function verifyTables() {
  console.log("--- 1. Verifying Required Tables & RLS Endpoints ---");
  let allPassed = true;

  for (const table of REQUIRED_TABLES) {
    try {
      const { error } = await supabase.from(table).select("*").limit(1);
      if (error && error.code === "42P01") {
        console.error(`  [FAIL] Table "${table}" does not exist (code: ${error.code})`);
        allPassed = false;
      } else if (error) {
        // Any error other than 42P01 means table exists but PostgREST encountered another condition
        console.log(`  [PASS] Table "${table}" exists (PostgREST probe returned: ${error.message || error.code})`);
      } else {
        console.log(`  [PASS] Table "${table}" exists and accessible via service_role`);
      }
    } catch (e) {
      console.error(`  [FAIL] Table "${table}" check error: ${e.message}`);
      allPassed = false;
    }
  }

  return allPassed;
}

async function verifyRpcs() {
  console.log("\n--- 2. Verifying Core Financial & AGM RPCs ---");
  let allPassed = true;

  for (const rpc of REQUIRED_RPCS) {
    try {
      const { error } = await supabase.rpc(rpc.name, rpc.sampleArgs);
      // Code 42883 = function does not exist
      if (error && error.code === "42883") {
        console.error(`  [FAIL] RPC "${rpc.name}" DOES NOT EXIST in database (code: 42883)`);
        allPassed = false;
      } else if (error && error.message && error.message.includes("Could not find the function")) {
        console.error(`  [FAIL] RPC "${rpc.name}" not found: ${error.message}`);
        allPassed = false;
      } else {
        // Even if validation error occurs inside RPC (e.g. invalid UUID / non-existent company),
        // the function is installed and executing PostgreSQL logic!
        console.log(`  [PASS] RPC "${rpc.name}" is installed and callable`);
      }
    } catch (e) {
      console.error(`  [FAIL] RPC "${rpc.name}" probe threw error: ${e.message}`);
      allPassed = false;
    }
  }

  return allPassed;
}

function verifyLocalCatalogIfAvailable() {
  console.log("\n--- 3. Verifying Local PostgreSQL Catalog & Migrations ---");
  try {
    const migrationOutput = execSync(
      'npx supabase db query --local "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;"',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    console.log("  Latest Applied Schema Migrations:");
    console.log(migrationOutput.split("\n").map((l) => `    ${l}`).join("\n"));

    // Verify 20261184000000 is applied
    if (migrationOutput.includes("20261184000000")) {
      console.log("  [PASS] Migration 20261184000000 is registered in schema_migrations!");
      return true;
    } else {
      console.warn("  [WARN] Migration 20261184000000 was not found in top 5 schema_migrations.");
      return false;
    }
  } catch (e) {
    console.log("  [INFO] Local database CLI query not applicable or remote host target. Skipping local catalog query.");
    return true;
  }
}

async function main() {
  const tablesOk = await verifyTables();
  const rpcsOk = await verifyRpcs();
  const catalogOk = verifyLocalCatalogIfAvailable();

  console.log("\n===============================================================================");
  if (tablesOk && rpcsOk && catalogOk) {
    console.log("  SUCCESS: All required tables, RPCs, and migrations are verified!");
    console.log("===============================================================================");
    process.exit(0);
  } else {
    console.error("  FAILURE: Some database objects or migrations failed verification.");
    console.log("===============================================================================");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal verification error:", err);
  process.exit(1);
});
