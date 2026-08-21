import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function fixPvtLtd() {
  console.log('Checking for any PVT.LTD or Company mistakenly marked as TAX_EXEMPT...');

  // 1. Fetch all clients marked as TAX_EXEMPT
  const { data: clients, error: cErr } = await supabase
    .from('clients')
    .select('id, boid, full_name, holder_type, payee_classification')
    .or('payee_classification.eq.TAX_EXEMPT,holder_type.eq.Tax Exempt,holder_type.eq.Mutual Fund');

  if (cErr) {
    console.error(cErr);
    return;
  }

  // Find private companies (PVT LTD, PRIVATE LIMITED, LTD) that are NOT mutual fund schemes
  const pvtLtdCompanies = (clients || []).filter(c => {
    const name = String(c.full_name || '').toUpperCase();
    const isPvtLtd = /PVT\.?\s*LTD|PRIVATE\s*LIMITED/i.test(name);
    const isMutualFund = /MUTUAL\s*FUND|\bMF\b|SAMRIDDHI|SAMUNNAT|PRAGATI|SAHABHAGITA|DHANABRIDDHI|SABAL|EQUITY\s*FUND|GROWTH\s*FUND|BALANCED\s*FUND|BLUECHIP|LARGE\s*CAP|FLEXI\s*CAP|FOCUS\s*(40|30)|SELECT\s*30/i.test(name);
    return isPvtLtd && !isMutualFund;
  });

  console.log(`Found ${pvtLtdCompanies.length} private limited companies marked as Tax Exempt:`);
  console.table(pvtLtdCompanies);

  for (const comp of pvtLtdCompanies) {
    console.log(`Updating ${comp.full_name} (${comp.boid}) to COMPANY_INSTITUTION...`);

    // 1. Update client master
    await supabase
      .from('clients')
      .update({
        payee_classification: 'COMPANY_INSTITUTION',
        holder_type: 'Legal Person - Corporate / Institution',
        payee_segment: null,
        classification_status: 'AUTO_CLASSIFIED',
        classification_source: 'Corporate Entity Verification (PVT LTD)',
      })
      .eq('id', comp.id);

    // 2. Update linked dividend payables (5% TDS)
    const { data: divPayables } = await supabase
      .from('dividend_payables')
      .select('id, gross_dividend')
      .eq('client_id', comp.id);

    for (const p of (divPayables || [])) {
      const gross = Number(p.gross_dividend || 0);
      const tax = Math.round(gross * 0.05 * 100) / 100;
      const net = Math.round((gross - tax) * 100) / 100;

      await supabase
        .from('dividend_payables')
        .update({
          payee_classification: 'COMPANY_INSTITUTION',
          tax_amount: tax,
          net_payable: net,
        })
        .eq('id', p.id);

      console.log(` -> Updated dividend payable: Gross ${gross}, Tax ${tax} (5%), Net ${net}`);
    }

    // 3. Update linked interest payables (15% TDS)
    const { data: intPayables } = await supabase
      .from('interest_payables')
      .select('id, gross_interest')
      .eq('client_id', comp.id);

    for (const p of (intPayables || [])) {
      const gross = Number(p.gross_interest || 0);
      const tax = Math.round(gross * 0.15 * 100) / 100;
      const net = Math.round((gross - tax) * 100) / 100;

      await supabase
        .from('interest_payables')
        .update({
          payee_classification: 'COMPANY_INSTITUTION',
          tax_amount: tax,
          net_payable: net,
        })
        .eq('id', p.id);

      console.log(` -> Updated interest payable: Gross ${gross}, Tax ${tax} (15%), Net ${net}`);
    }
  }

  console.log('All done!');
}

fixPvtLtd();
