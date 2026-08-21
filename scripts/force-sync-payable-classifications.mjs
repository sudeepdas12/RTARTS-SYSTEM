import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('Finding natural person clients who currently have TAX_EXEMPT payables...');

  // 1. Fetch only clients whose payables are currently TAX_EXEMPT
  let taxExemptPayables = [];
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from('dividend_payables')
      .select('id, client_id, gross_dividend, tax_amount, net_payable')
      .eq('payee_classification', 'TAX_EXEMPT')
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    taxExemptPayables = taxExemptPayables.concat(data);
    from += 1000;
    if (data.length < 1000) break;
  }

  console.log(`Found ${taxExemptPayables.length} dividend payables currently marked as TAX_EXEMPT.`);

  const clientIds = Array.from(new Set(taxExemptPayables.map(p => p.client_id)));
  console.log(`Checking ${clientIds.length} distinct client records...`);

  // Fetch client classifications for these specific clients
  let clients = [];
  for (let i = 0; i < clientIds.length; i += 50) {
    const chunk = clientIds.slice(i, i + 50);
    const { data } = await supabase
      .from('clients')
      .select('id, boid, full_name, payee_classification, payee_segment')
      .in('id', chunk);
    if (data) clients = clients.concat(data);
  }

  const clientMap = new Map();
  for (const c of clients) {
    clientMap.set(c.id, c);
  }

  let naturalPersonPayableIds = [];
  let mutualFundPayableIds = [];

  for (const p of taxExemptPayables) {
    const client = clientMap.get(p.client_id);
    if (!client) continue;

    if (client.payee_classification === 'NATURAL_PERSON') {
      naturalPersonPayableIds.push(p.id);
      console.log(` -> Natural Person to fix: ${client.full_name} (${client.boid})`);
    } else if (client.payee_classification === 'TAX_EXEMPT') {
      // Genuine Mutual Fund -> Ensure TDS is 0
      const gross = Number(p.gross_dividend || 0);
      if (Number(p.tax_amount) > 0) {
        mutualFundPayableIds.push({ id: p.id, gross });
        console.log(` -> Mutual Fund 0% TDS fix: ${client.full_name} (Gross: ${gross})`);
      }
    }
  }

  console.log(`Fixing ${naturalPersonPayableIds.length} natural person dividend payables...`);

  for (let i = 0; i < naturalPersonPayableIds.length; i += 50) {
    const chunk = naturalPersonPayableIds.slice(i, i + 50);
    await supabase
      .from('dividend_payables')
      .update({
        payee_classification: 'NATURAL_PERSON',
        payee_segment: 'PUBLIC',
      })
      .in('id', chunk);
  }

  console.log(`Fixing ${mutualFundPayableIds.length} mutual fund dividend payables to 0% TDS...`);

  for (const item of mutualFundPayableIds) {
    await supabase
      .from('dividend_payables')
      .update({
        tax_amount: 0,
        net_payable: item.gross,
      })
      .eq('id', item.id);
  }

  console.log('All done!');
}

run();
