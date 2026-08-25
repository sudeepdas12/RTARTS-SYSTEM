import { createClient } from '@supabase/supabase-js';
import { smartClassify } from '../src/lib/services/smart-classifier.ts';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('=== 1. FETCHING RBBD PAYABLES & LINKED CLIENTS ===');
  const RBBD_COMPANY_ID = 'df9080a1-4f6c-4ca0-8a30-8d3b5de24ed6';

  const { data: rbbdPayables, error: pErr } = await supabase
    .from('interest_payables')
    .select('id, client_id, gross_interest, tax_amount, net_interest, payee_classification, tds_rate')
    .eq('company_id', RBBD_COMPANY_ID);

  if (pErr) {
    console.error('Error fetching RBBD payables:', pErr);
    return;
  }
  console.log(`Loaded ${rbbdPayables.length} RBBD interest payable records.`);

  const clientIds = Array.from(new Set(rbbdPayables.map(p => p.client_id).filter(Boolean)));
  console.log(`Loaded ${clientIds.length} unique client IDs linked to RBBD.`);

  const clientMap = new Map();
  const clientUpdates = [];

  // Fetch clients in chunks
  const CHUNK_SIZE = 100;
  for (let i = 0; i < clientIds.length; i += CHUNK_SIZE) {
    const chunkIds = clientIds.slice(i, i + CHUNK_SIZE);
    const { data: clients, error: cErr } = await supabase
      .from('clients')
      .select('id, boid, full_name, holder_type, payee_classification, payee_segment, father_name, grandfather_name, citizenship_no, pan_no, pan_or_citizenship, date_of_birth, gender, occupation, bank_name')
      .in('id', chunkIds);

    if (cErr) {
      console.error('Error fetching clients chunk:', cErr);
      continue;
    }

    for (const c of clients || []) {
      const smart = smartClassify({
        full_name: c.full_name,
        father_name: c.father_name,
        grandfather_name: c.grandfather_name,
        citizenship: c.citizenship_no || c.pan_or_citizenship,
        pan: c.pan_no,
        date_of_birth: c.date_of_birth,
        gender: c.gender,
        occupation: c.occupation,
      });

      clientMap.set(c.id, {
        ...c,
        new_classification: smart.payee_classification,
        new_holder_type: smart.holder_type,
        new_segment: smart.payee_segment,
        rule: smart.rule_matched,
      });

      if (
        c.payee_classification !== smart.payee_classification ||
        c.holder_type !== smart.holder_type ||
        c.payee_segment !== smart.payee_segment
      ) {
        clientUpdates.push({
          id: c.id,
          name: c.full_name,
          boid: c.boid,
          old_cls: c.payee_classification,
          new_cls: smart.payee_classification,
          old_holder: c.holder_type,
          new_holder: smart.holder_type,
          rule: smart.rule_matched,
        });
      }
    }
  }

  console.log(`Identified ${clientUpdates.length} clients needing updates.`);
  for (let i = 0; i < clientUpdates.length; i += 50) {
    const chunk = clientUpdates.slice(i, i + 50);
    await Promise.all(
      chunk.map(cu =>
        supabase
          .from('clients')
          .update({
            payee_classification: cu.new_cls,
            holder_type: cu.new_holder,
            payee_segment: cu.new_segment || null,
            classification_status: 'CONFIRMED',
          })
          .eq('id', cu.id)
      )
    );
  }
  console.log('Client updates finished.');

  console.log('\n=== 2. UPDATING RBBD INTEREST PAYABLES ===');
  const payableUpdates = [];
  for (const p of rbbdPayables) {
    const client = clientMap.get(p.client_id);
    const cls = client?.new_classification || p.payee_classification || 'NATURAL_PERSON';
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

    payableUpdates.push({
      id: p.id,
      payee_classification: cls,
      payee_segment: client?.new_segment || null,
      tds_rate: rate,
      tax_amount: tax,
      net_interest: net,
      net_payable: net,
    });
  }

  console.log(`Updating ${payableUpdates.length} interest payables concurrently...`);
  for (let i = 0; i < payableUpdates.length; i += 50) {
    const chunk = payableUpdates.slice(i, i + 50);
    await Promise.all(
      chunk.map(pu =>
        supabase
          .from('interest_payables')
          .update({
            payee_classification: pu.payee_classification,
            payee_segment: pu.payee_segment,
            tds_rate: pu.tds_rate,
            tax_amount: pu.tax_amount,
            net_interest: pu.net_interest,
            net_payable: pu.net_payable,
            classification_status: 'CONFIRMED',
          })
          .eq('id', pu.id)
      )
    );
  }
  console.log('RBBD interest payables update complete.');

  console.log('\n=== 3. VERIFYING RBBD SUMMARY BREAKDOWN ===');
  const { data: verifiedPayables } = await supabase
    .from('interest_payables')
    .select('id, gross_interest, tax_amount, net_interest, tds_rate, payee_classification, client:clients(full_name, boid, holder_type)')
    .eq('company_id', RBBD_COMPANY_ID);

  const nonPublic = (verifiedPayables || []).filter(
    p => p.payee_classification !== 'NATURAL_PERSON' || (p.client?.full_name || '').includes('GROWTH') || (p.client?.full_name || '').includes('NMB 50')
  );

  console.table(
    nonPublic.map(p => ({
      Name: p.client?.full_name,
      BOID: p.client?.boid,
      HolderType: p.client?.holder_type,
      Classification: p.payee_classification,
      Gross: p.gross_interest,
      Tax: p.tax_amount,
      Net: p.net_interest,
      TaxRate: (p.tds_rate * 100).toFixed(0) + '%',
    }))
  );
}

run();
