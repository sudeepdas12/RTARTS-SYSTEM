import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// 1. Load environment variables
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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 2. Parse CLI arguments: --company=<symbol_or_id>
const args = process.argv.slice(2);
let targetCompanyArg = null;
for (const arg of args) {
  if (arg.startsWith("--company=")) {
    targetCompanyArg = arg.split("=")[1].trim();
  }
}

async function auditCompany(company) {
  console.log(`\n======================================================`);
  console.log(`AUDITING COMPANY: ${company.company_name} (${company.company_code || company.id})`);
  console.log(`======================================================`);

  // 1. Tax Exempt payables
  const { data: taxExemptRows, count: taxExemptCount } = await supabase
    .from("mutual_fund_payables")
    .select("id, client_id, shares_held, gross_dividend, tax_amount, net_payable, tds_rate, payee_classification, client:clients(full_name, boid)", { count: "exact" })
    .eq("company_id", company.id)
    .eq("payee_classification", "TAX_EXEMPT");

  console.log(`- Tax-Exempt Rows: ${taxExemptCount || taxExemptRows?.length || 0}`);
  if (taxExemptRows && taxExemptRows.length > 0) {
    console.table(taxExemptRows.slice(0, 5).map(r => ({
      BOID: r.client?.boid,
      Name: r.client?.full_name,
      Shares: r.shares_held,
      Gross: r.gross_dividend,
      Tax: r.tax_amount,
      Net: r.net_payable,
    })));
  }

  // 2. Top Institutional Payees
  const { data: instRows, count: instCount } = await supabase
    .from("mutual_fund_payables")
    .select("id, client_id, shares_held, gross_dividend, tax_amount, net_payable, tds_rate, payee_classification, client:clients(full_name, boid)", { count: "exact" })
    .eq("company_id", company.id)
    .eq("payee_classification", "COMPANY_INSTITUTION")
    .order("shares_held", { ascending: false })
    .limit(5);

  console.log(`- Institutional Payees Count: ${instCount || 0} (Showing Top 5)`);
  if (instRows && instRows.length > 0) {
    console.table(instRows.map(r => ({
      BOID: r.client?.boid,
      Name: r.client?.full_name,
      Shares: r.shares_held,
      Gross: r.gross_dividend,
      Tax: r.tax_amount,
      TDS_Rate: r.tds_rate,
    })));
  }

  // 3. Scan for Potential Misclassifications
  const { count: naturalCount } = await supabase
    .from("mutual_fund_payables")
    .select("id", { count: "exact", head: true })
    .eq("company_id", company.id)
    .eq("payee_classification", "NATURAL_PERSON");

  console.log(`- Natural Person Payees Count: ${naturalCount || 0}`);
}

async function main() {
  const { data: companies, error } = await supabase
    .from("companies")
    .select("id, company_code, company_name")
    .order("company_name");

  if (error || !companies || companies.length === 0) {
    console.error("No companies found in database or query failed:", error?.message);
    process.exit(1);
  }

  let selectedCompanies = companies;
  if (targetCompanyArg && targetCompanyArg.toLowerCase() !== "all") {
    selectedCompanies = companies.filter(
      c => c.id === targetCompanyArg || 
           c.company_code?.toLowerCase() === targetCompanyArg.toLowerCase() ||
           c.company_name?.toLowerCase().includes(targetCompanyArg.toLowerCase())
    );

    if (selectedCompanies.length === 0) {
      console.error(`Company "${targetCompanyArg}" not found. Available companies:`);
      companies.forEach(c => console.log(` - ${c.company_code || c.id}: ${c.company_name}`));
      process.exit(1);
    }
  }

  for (const company of selectedCompanies) {
    await auditCompany(company);
  }

  console.log(`\nAudit completed successfully across ${selectedCompanies.length} company/fund(s).`);
}

main().catch(console.error);
