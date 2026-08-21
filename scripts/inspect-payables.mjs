import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const boids = [
    '1301950000064044', // KOSH RAJ ONTA
    '1301370000645872', // Rikosh Giri
    '1301370000614037', // Hikosh Giri
    '1301260001345527', // KIKOSH THAPA
    '1301120000305791', // Kosh Nath Adhikari
    '1301090000392663', // KOSH RAJ POKHAREAL
    '1301090000040742', // KOSH BYAWASTHAPAN COMPANY
    '1301080000016281', // kosh raj subedi
    '1301730001246204', // MEGA MUTUAL FUND -1
  ];

  console.log('--- CLIENTS TABLE ---');
  const { data: clients, error: cErr } = await supabase
    .from('clients')
    .select('id, boid, full_name, holder_type, payee_classification, payee_segment')
    .in('boid', boids);

  if (cErr) console.error(cErr);
  console.table(clients);

  const clientIds = (clients || []).map(c => c.id);

  console.log('--- DIVIDEND PAYABLES TABLE ---');
  const { data: payables, error: pErr } = await supabase
    .from('dividend_payables')
    .select('id, client_id, gross_dividend, tax_amount, net_payable, lot_name, payee_classification, payee_segment')
    .in('client_id', clientIds);

  if (pErr) console.error(pErr);
  console.table(payables);
}

check();
