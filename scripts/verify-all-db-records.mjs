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
  console.log('=== VERIFYING ALL INTEREST / DEBENTURE PAYABLES IN DATABASE ===');
  const payables = await fetchAll(
    'interest_payables',
    'id, company_id, client_id, gross_interest, tax_amount, net_interest, tds_rate, payee_classification, client:clients(id, full_name, boid, holder_type, payee_classification)'
  );

  let discrepancies = 0;
  const mismatchedList = [];

  for (const p of payables) {
    const smart = smartClassify({
      full_name: p.client?.full_name,
      holder_type: p.client?.holder_type,
    });

    const expectedRate =
      smart.payee_classification === 'TAX_EXEMPT'
        ? 0.0
        : smart.payee_classification === 'COMPANY_INSTITUTION'
        ? 0.15
        : 0.06;
    const gross = Number(p.gross_interest || 0);
    const expectedTax = Math.round(gross * expectedRate * 100) / 100;
    const expectedNet = Math.round((gross - expectedTax) * 100) / 100;

    const isMatch =
      p.payee_classification === smart.payee_classification &&
      Math.abs(Number(p.tax_amount) - expectedTax) <= 0.05 &&
      Math.abs(Number(p.net_interest) - expectedNet) <= 0.05;

    if (!isMatch) {
      discrepancies++;
      mismatchedList.push({
        id: p.id,
        name: p.client?.full_name,
        boid: p.client?.boid,
        currentCls: p.payee_classification,
        expectedCls: smart.payee_classification,
        currentTax: p.tax_amount,
        expectedTax,
        currentNet: p.net_interest,
        expectedNet,
        rate: expectedRate,
      });
    }
  }

  console.log(`Total Debenture / Interest Rows: ${payables.length}`);
  console.log(`Total Discrepancies Found: ${discrepancies}`);

  if (discrepancies > 0) {
    console.log('Fixing remaining discrepancies...');
    for (let i = 0; i < mismatchedList.length; i += 50) {
      const chunk = mismatchedList.slice(i, i + 50);
      await Promise.all(
        chunk.map(m =>
          supabase
            .from('interest_payables')
            .update({
              payee_classification: m.expectedCls,
              tds_rate: m.rate,
              tax_amount: m.expectedTax,
              net_interest: m.expectedNet,
              net_payable: m.expectedNet,
              classification_status: 'CONFIRMED',
            })
            .eq('id', m.id)
        )
      );
    }
    console.log('Fixed all remaining debenture payables in DB.');
  }

  console.log('\n=== VERIFYING TARGET ROWS DIRECTLY IN DB ===');
  const targetBoids = ['1302010000081864', '1301100001322301', '1301100000986776'];
  const { data: targetRows } = await supabase
    .from('interest_payables')
    .select('id, gross_interest, tax_amount, net_interest, tds_rate, payee_classification, client:clients(full_name, boid, holder_type, payee_classification)')
    .in('client.boid', targetBoids);

  console.table(
    (targetRows || []).map(r => ({
      Name: r.client?.full_name,
      BOID: r.client?.boid,
      ClientHolderType: r.client?.holder_type,
      PayableClassification: r.payee_classification,
      Gross: r.gross_interest,
      Tax: r.tax_amount,
      Net: r.net_interest,
      TaxRate: (Number(r.tds_rate) * 100).toFixed(0) + '%',
    }))
  );
}

run();
