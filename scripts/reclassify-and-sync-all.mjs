import { createClient } from '@supabase/supabase-js';
import { smartClassify } from '../src/lib/services/smart-classifier.ts';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

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

async function run() {
  console.log('===================================================================');
  console.log('   RECLASSIFYING & SYNCHRONIZING ALL CLIENTS & PAYABLES (RBBD / ALL) ');
  console.log('===================================================================\n');

  // 1. Fetch all clients
  const clients = await fetchAll(
    'clients',
    'id, boid, full_name, holder_type, payee_classification, payee_segment, father_name, grandfather_name, citizenship_no, pan_no, pan_or_citizenship, date_of_birth, gender, occupation, bank_name, company_id'
  );
  console.log(`Loaded ${clients.length} total client records.`);

  const clientUpdates = [];
  const clientMap = new Map();

  for (const c of clients) {
    const smart = smartClassify({
      full_name: c.full_name,
      father_name: c.father_name,
      grandfather_name: c.grandfather_name,
      citizenship: c.citizenship_no || c.pan_or_citizenship,
      pan: c.pan_no,
      date_of_birth: c.date_of_birth,
      gender: c.gender,
      occupation: c.occupation,
      holder_type: c.holder_type,
    });

    const needsUpdate =
      c.payee_classification !== smart.payee_classification ||
      c.holder_type !== smart.holder_type ||
      c.payee_segment !== smart.payee_segment;

    const updatedClient = {
      ...c,
      payee_classification: smart.payee_classification,
      holder_type: smart.holder_type,
      payee_segment: smart.payee_segment,
    };
    clientMap.set(c.id, updatedClient);

    if (needsUpdate) {
      clientUpdates.push({
        id: c.id,
        boid: c.boid,
        full_name: c.full_name,
        old_cls: c.payee_classification,
        new_cls: smart.payee_classification,
        old_holder: c.holder_type,
        new_holder: smart.holder_type,
        rule: smart.rule_matched,
      });
    }
  }

  console.log(`Identified ${clientUpdates.length} clients needing classification updates.`);
  if (clientUpdates.length > 0) {
    console.log('Sample updated clients:');
    console.table(clientUpdates.slice(0, 15).map(u => ({
      Name: u.full_name,
      BOID: u.boid,
      OldClass: u.old_cls,
      NewClass: u.new_cls,
      NewHolder: u.new_holder,
      Rule: u.rule,
    })));

    console.log('Applying batch updates to clients table...');
    const BATCH_SIZE = 100;
    for (let i = 0; i < clientUpdates.length; i += BATCH_SIZE) {
      const chunk = clientUpdates.slice(i, i + BATCH_SIZE);
      await Promise.all(
        chunk.map(u =>
          supabase
            .from('clients')
            .update({
              payee_classification: u.new_cls,
              holder_type: u.new_holder,
              classification_status: 'CONFIRMED',
            })
            .eq('id', u.id)
        )
      );
    }
    console.log('Clients update complete.\n');
  }

  // 2. Synchronize all Interest / Debenture Payables
  console.log('2. SYNCHRONIZING DEBENTURE / INTEREST PAYABLES...');
  const interestPayables = await fetchAll(
    'interest_payables',
    'id, company_id, client_id, gross_interest, tax_amount, net_interest, payee_classification, payee_segment, tds_rate'
  );
  console.log(`Loaded ${interestPayables.length} interest payable records.`);

  const intUpdates = [];
  for (const p of interestPayables) {
    const client = clientMap.get(p.client_id);
    const cls = client?.payee_classification || p.payee_classification || 'NATURAL_PERSON';
    const seg = client?.payee_segment || p.payee_segment || 'PUBLIC';
    const gross = Number(p.gross_interest || 0);

    let rate = 0.06;
    let tax = 0;
    if (cls === 'TAX_EXEMPT') {
      rate = 0.0;
      tax = 0.0;
    } else if (cls === 'COMPANY_INSTITUTION') {
      rate = 0.15;
      tax = Math.round(gross * 0.15 * 100) / 100;
    } else {
      rate = 0.06;
      tax = Math.round(gross * 0.06 * 100) / 100;
    }
    const net = Math.round((gross - tax) * 100) / 100;

    const needsIntUpdate =
      p.payee_classification !== cls ||
      Number(p.tds_rate) !== rate ||
      Math.abs(Number(p.tax_amount) - tax) > 0.05 ||
      Math.abs(Number(p.net_interest) - net) > 0.05;

    if (needsIntUpdate) {
      intUpdates.push({
        id: p.id,
        name: client?.full_name,
        gross,
        old_tax: p.tax_amount,
        new_tax: tax,
        old_cls: p.payee_classification,
        new_cls: cls,
        rate,
        net,
      });
    }
  }

  console.log(`Identified ${intUpdates.length} interest payables needing updates.`);
  if (intUpdates.length > 0) {
    console.log('Sample updated interest payables:');
    console.table(intUpdates.slice(0, 15).map(u => ({
      Name: u.name,
      Gross: u.gross,
      OldTax: u.old_tax,
      NewTax: u.new_tax,
      OldCls: u.old_cls,
      NewCls: u.new_cls,
      Rate: (u.rate * 100).toFixed(0) + '%',
      Net: u.net,
    })));

    console.log('Applying batch updates to interest_payables table...');
    const BATCH_SIZE = 100;
    for (let i = 0; i < intUpdates.length; i += BATCH_SIZE) {
      const chunk = intUpdates.slice(i, i + BATCH_SIZE);
      await Promise.all(
        chunk.map(u =>
          supabase
            .from('interest_payables')
            .update({
              payee_classification: u.new_cls,
              tds_rate: u.rate,
              tax_amount: u.new_tax,
              net_interest: u.net,
              net_payable: u.net,
              classification_status: 'CONFIRMED',
            })
            .eq('id', u.id)
        )
      );
    }
    console.log('Interest payables update complete.\n');
  }

  // 3. Verify the Target Entities directly
  console.log('3. VERIFYING TARGET ENTITIES:');
  const { data: verifiedGrowth } = await supabase
    .from('clients')
    .select('boid, full_name, holder_type, payee_classification')
    .ilike('full_name', '%GROWTH EQUITY%');
  console.log('GROWTH EQUITY PARTNERS in clients:', verifiedGrowth);

  const { data: verifiedNmb50 } = await supabase
    .from('clients')
    .select('boid, full_name, holder_type, payee_classification')
    .ilike('full_name', '%NMB 50%');
  console.log('NMB 50 in clients:', verifiedNmb50);

  const { data: targetPayables } = await supabase
    .from('interest_payables')
    .select('id, gross_interest, tax_amount, net_interest, tds_rate, payee_classification, client:clients(full_name, boid)')
    .or('client_id.in.(' + [...verifiedGrowth || [], ...verifiedNmb50 || []].map(c => c.id || '').filter(Boolean).join(',') + ')');

  console.log('\nTarget Payables in database:');
  for (const tp of targetPayables || []) {
    console.log({
      name: tp.client?.full_name,
      boid: tp.client?.boid,
      cls: tp.payee_classification,
      gross: tp.gross_interest,
      tax: tp.tax_amount,
      net: tp.net_interest,
      rate: tp.tds_rate,
    });
  }
}

run();
