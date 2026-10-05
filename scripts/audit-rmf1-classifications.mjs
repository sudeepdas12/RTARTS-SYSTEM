import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

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

async function main() {
  const rmf1Id = '177ae652-36a1-4b1b-a745-230096a5908e';

  console.log("=== 1. TAX EXEMPT ROWS IN RMF1 ===");
  const { data: taxExemptRows } = await supabase
    .from('mutual_fund_payables')
    .select('id, client_id, shares_held, gross_dividend, tax_amount, net_payable, tds_rate, payee_classification, client:clients(full_name, boid, payee_classification, holder_type)')
    .eq('company_id', rmf1Id)
    .eq('payee_classification', 'TAX_EXEMPT');
  console.log(taxExemptRows);

  console.log("\n=== 2. INSTITUTIONS IN RMF1 (TOP 20 BY SHARES) ===");
  const { data: instRows } = await supabase
    .from('mutual_fund_payables')
    .select('id, client_id, shares_held, gross_dividend, tax_amount, net_payable, tds_rate, payee_classification, client:clients(full_name, boid, payee_classification, holder_type)')
    .eq('company_id', rmf1Id)
    .eq('payee_classification', 'COMPANY_INSTITUTION')
    .order('shares_held', { ascending: false })
    .limit(20);
  console.log(instRows?.map(r => ({
    name: r.client?.full_name,
    boid: r.client?.boid,
    shares: r.shares_held,
    gross: r.gross_dividend,
    tax: r.tax_amount,
    net: r.net_payable,
    tds_rate: r.tds_rate
  })));

  console.log("\n=== 3. SCANNING NATURAL_PERSON FOR CORPORATE KEYWORDS ===");
  // Fetch rows where client name might contain corporate keywords like LTD, LIMITED, BANK, FUND, TRUST, PVT, CO, INVESTMENT
  // Let's do pagination over all 42027 rows to find any potential misclassifications
  let from = 0;
  const batchSize = 1000;
  const potentialCorporateInPublic = [];

  while (true) {
    const { data, error } = await supabase
      .from('mutual_fund_payables')
      .select('id, client_id, shares_held, gross_dividend, tax_amount, net_payable, tds_rate, payee_classification, client:clients(full_name, boid, payee_classification, holder_type)')
      .eq('company_id', rmf1Id)
      .eq('payee_classification', 'NATURAL_PERSON')
      .range(from, from + batchSize - 1);

    if (error || !data || data.length === 0) break;

    for (const r of data) {
      const name = (r.client?.full_name || '').toUpperCase();
      if (
        /\b(LTD|LIMITED|PVT|PRIVATE|COMPANY|CORP|BANK|FINANCE|INVESTMENT|HOLDINGS|CAPITAL|KOSH|FUND|TRUST|SANSTHA)\b/.test(name) &&
        !/\b(RAM|SHYAM|HARI|BAHADUR|PRASAD|KUMARI|DEVI|MAYA)\b/.test(name)
      ) {
        potentialCorporateInPublic.push({
          id: r.id,
          name: r.client?.full_name,
          boid: r.client?.boid,
          shares: r.shares_held,
          gross: r.gross_dividend,
          tax: r.tax_amount,
          tds_rate: r.tds_rate
        });
      }
    }

    if (data.length < batchSize) break;
    from += batchSize;
  }

  console.log(`Found ${potentialCorporateInPublic.length} potential corporate names classified as NATURAL_PERSON:`);
  console.log(potentialCorporateInPublic.slice(0, 30));
}

main().catch(console.error);
