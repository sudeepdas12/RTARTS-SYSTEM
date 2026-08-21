import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkNecoKhimadevi() {
  console.log('--- Checking all records with BOID 1301060000048628 ---');
  const { data: clients } = await supabase
    .from('clients')
    .select('id, client_code, boid, full_name, holder_type, payee_classification, payee_segment')
    .ilike('boid', '%1301060000048628%');

  console.table(clients);

  if (clients && clients.length > 0) {
    const clientIds = clients.map(c => c.id);
    const { data: divPayables } = await supabase
      .from('dividend_payables')
      .select('id, company_id, client_id, gross_dividend, tax_amount, net_payable, payee_classification, payee_segment, companies(company_code, company_name)')
      .in('client_id', clientIds);

    console.log('--- Dividend Payables ---');
    console.table(divPayables);
  }
}

checkNecoKhimadevi();
