import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function fixKhimadevi() {
  console.log('Fixing KHIMADEVI in clients and dividend_payables...');

  // Update client
  const { error: cErr } = await supabase
    .from('clients')
    .update({
      holder_type: 'Legal Person',
      payee_classification: 'COMPANY_INSTITUTION',
      payee_segment: null,
      classification_status: 'CONFIRMED',
      classification_source: 'Manual Verification - PVT LTD Company',
    })
    .eq('id', '0fb35689-e069-404e-9965-b483e991625d');

  if (cErr) console.error('Client update error:', cErr);

  // Update dividend payable
  const { error: pErr } = await supabase
    .from('dividend_payables')
    .update({
      payee_classification: 'COMPANY_INSTITUTION',
      tax_amount: 3637.20,
      net_payable: 69106.80,
    })
    .eq('id', 'b5f8478a-6810-4527-8ebf-731aba124f87');

  if (pErr) console.error('Payable update error:', pErr);

  console.log('Done!');
}

fixKhimadevi();
