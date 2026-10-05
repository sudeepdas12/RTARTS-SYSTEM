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

  let from = 0;
  const batchSize = 1000;
  let taxMismatchCount = 0;
  const sampleMismatches = [];

  while (true) {
    const { data, error } = await supabase
      .from('mutual_fund_payables')
      .select('id, client_id, shares_held, dividend_rate, gross_dividend, tax_amount, net_payable, tds_rate, payee_classification')
      .eq('company_id', rmf1Id)
      .eq('payee_classification', 'NATURAL_PERSON')
      .range(from, from + batchSize - 1);

    if (error || !data || data.length === 0) break;

    for (const r of data) {
      const gross = Number(r.gross_dividend || 0);
      const tax = Number(r.tax_amount || 0);
      const expectedTax = Math.round(gross * 0.05 * 100) / 100;
      if (Math.abs(tax - expectedTax) > 0.01) {
        taxMismatchCount++;
        if (sampleMismatches.length < 10) {
          sampleMismatches.push({
            id: r.id,
            shares: r.shares_held,
            gross,
            actualTax: tax,
            expectedTax,
            tdsRate: r.tds_rate,
            diff: tax - expectedTax
          });
        }
      }
    }

    if (data.length < batchSize) break;
    from += batchSize;
  }

  console.log(`Tax mismatch count among NATURAL_PERSON: ${taxMismatchCount}`);
  if (sampleMismatches.length > 0) {
    console.log("Sample mismatches:", sampleMismatches);
  }
}

main().catch(console.error);
