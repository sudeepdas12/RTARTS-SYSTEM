import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('Connecting to database at:', SUPABASE_URL);

  // 1. Specifically search for any client whose name contains 'kosh' or who is TAX_EXEMPT
  let allClients = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('clients')
      .select('id, boid, full_name, father_name, grandfather_name, payee_classification, holder_type')
      .or('payee_classification.eq.TAX_EXEMPT,holder_type.eq.Tax Exempt,holder_type.eq.Mutual Fund')
      .range(from, from + pageSize - 1);

    if (error) {
      console.error('Error fetching batch:', error.message);
      break;
    }

    if (data && data.length > 0) {
      allClients = allClients.concat(data);
      from += pageSize;
      if (data.length < pageSize) hasMore = false;
    } else {
      hasMore = false;
    }
  }

  console.log(`Found ${allClients.length} total clients marked as TAX_EXEMPT in database.`);

  const eligible = allClients.filter((c) => {
    const hasFather = Boolean(c.father_name && String(c.father_name).trim());
    const hasGrandfather = Boolean(c.grandfather_name && String(c.grandfather_name).trim());
    const name = String(c.full_name || '').toUpperCase();
    const isRealFund = /(MUTUAL\s*FUND|\bMF\b|FOCUS\s*(40|30)|SELECT\s*30|SUPER\s*30|SAMRIDDHI|SAMUNNAT|PRAGATI|SAHABHAGITA|DHANABRIDDHI|SABAL|EQUITY\s*(FUND|SCHEME|ORIENTED)|GROWTH\s*(FUND|SCHEME)|BALANCED\s*(FUND|SCHEME)|BLUECHIP|LARGE\s*CAP|FLEXI\s*CAP|VALUE\s*FUND|DEBT\s*FUND|FIXED\s*INCOME|DYNAMIC\s*DEBT|SYSTEMATIC\s*INVESTMENT|SANCHAYA\s*KOSH|NAGARIK\s*LAGANI|CITIZEN\s*INVESTMENT|\bCIT\b|\bEPF\b|\bSSF\b|SOCIAL\s*SECURITY\s*FUND|AWAKASH\s*KOSH|AWAKASH\s*FUND|KALYAN\s*KOSH|KOSH\s*BYAWASTHAPAN)/i.test(name);
    return (hasFather || hasGrandfather) && !isRealFund;
  });

  console.log(`Found ${eligible.length} individual shareholders with family lineage currently marked as Tax Exempt.`);

  for (const person of eligible) {
    console.log(` -> BOID: ${person.boid} | Name: ${person.full_name} | Father: ${person.father_name || person.grandfather_name}`);
  }

  if (eligible.length > 0) {
    const ids = eligible.map((c) => c.id);

    // Update in chunks of 500
    for (let i = 0; i < ids.length; i += 500) {
      const chunkIds = ids.slice(i, i + 500);
      const { error: updateErr } = await supabase
        .from('clients')
        .update({
          payee_classification: 'NATURAL_PERSON',
          holder_type: 'Natural Person - Public',
          payee_segment: 'PUBLIC',
          classification_status: 'AUTO_CLASSIFIED',
          classification_source: 'Family Lineage Verification',
        })
        .in('id', chunkIds);

      if (updateErr) {
        console.error('Update error on clients chunk:', updateErr.message);
      } else {
        console.log(`Updated chunk ${i / 500 + 1} (${chunkIds.length} shareholders).`);
      }
    }

    // Also update any linked payables
    const { error: divErr } = await supabase
      .from('dividend_payables')
      .update({
        payee_classification: 'NATURAL_PERSON',
        payee_category: 'PUBLIC',
      })
      .in('client_id', ids)
      .eq('payee_classification', 'TAX_EXEMPT');

    if (!divErr) console.log('Updated associated dividend payables.');

    const { error: intErr } = await supabase
      .from('interest_payables')
      .update({
        payee_classification: 'NATURAL_PERSON',
        payee_category: 'PUBLIC',
      })
      .in('client_id', ids)
      .eq('payee_classification', 'TAX_EXEMPT');

    if (!intErr) console.log('Updated associated interest payables.');
  }

  console.log('Done!');
}

run();
