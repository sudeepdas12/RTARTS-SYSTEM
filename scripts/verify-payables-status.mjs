import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  console.log('=== 1. DIVIDEND PAYABLES SUMMARY BY CLASSIFICATION ===');
  let divRows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('dividend_payables')
      .select('payee_classification, payee_segment, gross_dividend, tax_amount, net_payable, client:clients(full_name, holder_type)')
      .range(from, from + 999);
    if (error) {
      console.error('Div error:', error);
      break;
    }
    if (!data || data.length === 0) break;
    divRows = divRows.concat(data);
    from += 1000;
    if (data.length < 1000) break;
  }

  const divSummary = {};
  for (const r of divRows || []) {
    const key = (r.payee_classification || 'NULL') + ' | ' + (r.payee_segment || 'DEFAULT');
    if (!divSummary[key]) divSummary[key] = { count: 0, gross: 0, tax: 0, net: 0, samples: [] };
    divSummary[key].count++;
    divSummary[key].gross += Number(r.gross_dividend || 0);
    divSummary[key].tax += Number(r.tax_amount || 0);
    divSummary[key].net += Number(r.net_payable || 0);
    if (divSummary[key].samples.length < 2 && r.client?.full_name) {
      divSummary[key].samples.push(r.client.full_name);
    }
  }
  console.table(
    Object.entries(divSummary).map(([k, v]) => ({
      Category: k,
      Count: v.count,
      Gross: v.gross.toFixed(2),
      Tax: v.tax.toFixed(2),
      Net: v.net.toFixed(2),
      TaxRatePct: v.gross > 0 ? ((v.tax / v.gross) * 100).toFixed(2) + '%' : '0%',
      Samples: v.samples.join(', '),
    }))
  );

  console.log('\n=== 2. INTEREST PAYABLES SUMMARY BY CLASSIFICATION ===');
  let intRows = [];
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('interest_payables')
      .select('payee_classification, payee_segment, gross_interest, tax_amount, net_interest, client:clients(full_name, holder_type)')
      .range(from, from + 999);
    if (error) {
      console.error('Int error:', error);
      break;
    }
    if (!data || data.length === 0) break;
    intRows = intRows.concat(data);
    from += 1000;
    if (data.length < 1000) break;
  }

  const intSummary = {};
  for (const r of intRows || []) {
    const key = (r.payee_classification || 'NULL') + ' | ' + (r.payee_segment || 'DEFAULT');
    if (!intSummary[key]) intSummary[key] = { count: 0, gross: 0, tax: 0, net: 0, samples: [] };
    intSummary[key].count++;
    intSummary[key].gross += Number(r.gross_interest || 0);
    intSummary[key].tax += Number(r.tax_amount || 0);
    intSummary[key].net += Number(r.net_interest || 0);
    if (intSummary[key].samples.length < 2 && r.client?.full_name) {
      intSummary[key].samples.push(r.client.full_name);
    }
  }
  console.table(
    Object.entries(intSummary).map(([k, v]) => ({
      Category: k,
      Count: v.count,
      Gross: v.gross.toFixed(2),
      Tax: v.tax.toFixed(2),
      Net: v.net.toFixed(2),
      TaxRatePct: v.gross > 0 ? ((v.tax / v.gross) * 100).toFixed(2) + '%' : '0%',
      Samples: v.samples.join(', '),
    }))
  );

  console.log('\n=== 3. VERIFYING TAX_EXEMPT ENTITIES IN DIVIDEND PAYABLES ===');
  const taxExemptDivs = (divRows || []).filter((r) => r.payee_classification === 'TAX_EXEMPT');
  console.log('Total Tax Exempt records:', taxExemptDivs.length);
  const distinctTaxExemptNames = [...new Set(taxExemptDivs.map((r) => r.client?.full_name).filter(Boolean))];
  console.log('Unique Tax Exempt Names:', distinctTaxExemptNames);

  const nonZeroTdsInTaxExempt = taxExemptDivs.filter((r) => Number(r.tax_amount) > 0);
  console.log('Tax Exempt records with non-zero tax (MUST BE 0):', nonZeroTdsInTaxExempt.length);

  const invalidHumansInTaxExempt = taxExemptDivs.filter((r) => {
    const name = (r.client?.full_name || '').toUpperCase();
    return /(GIRI|THAPA|ONTA|POKHAREL|ADHIKARI|SHRESTHA|SUBEDI)\b/i.test(name);
  });
  console.log('Individual humans wrongly under Tax Exempt (MUST BE 0):', invalidHumansInTaxExempt.length);

  console.log('\n=== 4. VERIFYING KHIMADEVI LAGANI KOSH PVT.LTD ===');
  const khimadevi = (divRows || []).filter((r) => (r.client?.full_name || '').includes('KHIMADEVI'));
  console.log('Khimadevi record count:', khimadevi.length);
  khimadevi.forEach((k) =>
    console.log({
      name: k.client?.full_name,
      classification: k.payee_classification,
      segment: k.payee_segment,
      gross: k.gross_dividend,
      tax: k.tax_amount,
      net: k.net_payable,
      taxRate: ((Number(k.tax_amount) / Number(k.gross_dividend)) * 100).toFixed(1) + '%',
    })
  );

  console.log('\n=== 5. VERIFYING INDIVIDUALS WITH "KOSH" IN NAME (e.g. Rikosh, Hikosh, Kosh Raj) ===');
  const koshIndividuals = (divRows || []).filter((r) => {
    const name = (r.client?.full_name || '').toUpperCase();
    return /(RIKOSH|HIKOSH|KIKOSH|KOSH RAJ|KOSH NATH)\b/i.test(name);
  });
  console.log('Kosh individuals count:', koshIndividuals.length);
  koshIndividuals.forEach((k) =>
    console.log({
      name: k.client?.full_name,
      classification: k.payee_classification,
      gross: k.gross_dividend,
      tax: k.tax_amount,
      net: k.net_payable,
      taxRate: ((Number(k.tax_amount) / Number(k.gross_dividend)) * 100).toFixed(1) + '%',
    })
  );
}

check();
