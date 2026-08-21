import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: clients } = await supabase
    .from('clients')
    .select('id, boid, full_name, holder_type, payee_classification, payee_segment')
    .ilike('full_name', '%KHIMADEVI%');

  console.log('--- KHIMADEVI in clients table ---');
  console.table(clients);

  if (clients && clients.length > 0) {
    const { data: payables } = await supabase
      .from('dividend_payables')
      .select('id, gross_dividend, tax_amount, net_payable, payee_classification')
      .in('client_id', clients.map(c => c.id));

    console.log('--- KHIMADEVI in dividend_payables table ---');
    console.table(payables);
  }
}

check();
