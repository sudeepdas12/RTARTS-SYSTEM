import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function listAllTaxExemptPayables() {
  const { data: payables, error } = await supabase
    .from('dividend_payables')
    .select('id, gross_dividend, tax_amount, net_payable, payee_classification, client:clients(full_name, boid, holder_type, payee_classification)')
    .eq('payee_classification', 'TAX_EXEMPT');

  if (error) {
    console.error(error);
    return;
  }

  console.log(`--- All Remaining TAX_EXEMPT Dividend Payables (${payables.length}) ---`);
  const rows = payables.map(p => ({
    name: p.client?.full_name,
    boid: p.client?.boid,
    gross: p.gross_dividend,
    tax: p.tax_amount,
    net: p.net_payable,
    classification: p.payee_classification,
  }));
  console.table(rows);
}

listAllTaxExemptPayables();
