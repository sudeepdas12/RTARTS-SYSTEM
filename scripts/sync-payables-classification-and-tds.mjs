import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function fetchAll(table, columns) {
  let allRows = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);

    if (error) {
      console.error(`Error loading ${table}:`, error.message);
      break;
    }

    if (data && data.length > 0) {
      allRows = allRows.concat(data);
      from += pageSize;
      if (data.length < pageSize) hasMore = false;
    } else {
      hasMore = false;
    }
  }

  return allRows;
}

async function sync() {
  console.log('Connecting to database and fetching all records...');

  // 1. Fetch all clients
  const clients = await fetchAll('clients', 'id, boid, full_name, holder_type, payee_classification, payee_segment');
  const clientMap = new Map();
  for (const c of clients) {
    clientMap.set(c.id, c);
  }
  console.log(`Loaded ${clients.length} total clients.`);

  // 2. Fetch all dividend payables
  const payables = await fetchAll('dividend_payables', 'id, client_id, gross_dividend, tax_amount, net_payable, payee_classification, payee_segment');
  console.log(`Loaded ${payables.length} total dividend payables.`);

  let updatedCount = 0;

  for (const p of payables) {
    const client = clientMap.get(p.client_id);
    if (!client) continue;

    const correctClassification = client.payee_classification || 'NATURAL_PERSON';
    const correctSegment = client.payee_segment || (correctClassification === 'NATURAL_PERSON' ? 'PUBLIC' : null);
    const gross = Number(p.gross_dividend || 0);

    let correctTax = 0;
    let correctNet = gross;

    if (correctClassification === 'TAX_EXEMPT') {
      correctTax = 0;
      correctNet = gross;
    } else {
      // Natural Person (5%) or Company/Institution (5%)
      correctTax = Math.round(gross * 0.05 * 100) / 100;
      correctNet = Math.round((gross - correctTax) * 100) / 100;
    }

    const needsUpdate =
      p.payee_classification !== correctClassification ||
      p.payee_segment !== correctSegment ||
      Math.abs(Number(p.tax_amount) - correctTax) > 0.001 ||
      Math.abs(Number(p.net_payable) - correctNet) > 0.001;

    if (needsUpdate) {
      console.log(`Syncing: ${client.full_name} (${client.boid}) | Class: ${correctClassification} | Gross: ${gross} | Tax: ${p.tax_amount} -> ${correctTax} | Net: ${p.net_payable} -> ${correctNet}`);

      await supabase
        .from('dividend_payables')
        .update({
          payee_classification: correctClassification,
          payee_segment: correctSegment,
          tax_amount: correctTax,
          net_payable: correctNet,
        })
        .eq('id', p.id);

      updatedCount++;
    }
  }

  // 3. Also sync interest payables
  const interestPayables = await fetchAll('interest_payables', 'id, client_id, gross_interest, tax_amount, net_payable, payee_classification, payee_segment');
  console.log(`Loaded ${interestPayables.length} total interest payables.`);

  let updatedInterestCount = 0;

  for (const p of interestPayables) {
    const client = clientMap.get(p.client_id);
    if (!client) continue;

    const correctClassification = client.payee_classification || 'NATURAL_PERSON';
    const correctSegment = client.payee_segment || (correctClassification === 'NATURAL_PERSON' ? 'PUBLIC' : null);
    const gross = Number(p.gross_interest || 0);

    let correctTax = 0;
    let correctNet = gross;

    if (correctClassification === 'TAX_EXEMPT') {
      correctTax = 0;
      correctNet = gross;
    } else if (correctClassification === 'COMPANY_INSTITUTION') {
      // 15% TDS on debentures
      correctTax = Math.round(gross * 0.15 * 100) / 100;
      correctNet = Math.round((gross - correctTax) * 100) / 100;
    } else {
      // Natural Person 6% TDS on debentures
      correctTax = Math.round(gross * 0.06 * 100) / 100;
      correctNet = Math.round((gross - correctTax) * 100) / 100;
    }

    const needsUpdate =
      p.payee_classification !== correctClassification ||
      p.payee_segment !== correctSegment ||
      Math.abs(Number(p.tax_amount) - correctTax) > 0.001 ||
      Math.abs(Number(p.net_payable) - correctNet) > 0.001;

    if (needsUpdate) {
      await supabase
        .from('interest_payables')
        .update({
          payee_classification: correctClassification,
          payee_segment: correctSegment,
          tax_amount: correctTax,
          net_payable: correctNet,
        })
        .eq('id', p.id);

      updatedInterestCount++;
    }
  }

  console.log(`Done! Synced ${updatedCount} dividend payables and ${updatedInterestCount} interest payables.`);
}

sync();
