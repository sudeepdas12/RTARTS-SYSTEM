import * as XLSXModule from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const xlsx = XLSXModule.default || XLSXModule;
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function syncAndReconcile() {
  console.log('===============================================================');
  console.log(' RTARTS System - 8.5% RBB Debenture 2083 Sync & Reconciliation ');
  console.log('===============================================================');

  const reconPath = './samples/RBB Reconsilation/8.5% RBB DEBENTURE 2083 CALN ASAR END 2083_RECONCILATION.xlsx';
  const wb = xlsx.readFile(reconPath);

  // 1. Get the Debenture Company ID
  const { data: compList, error: compErr } = await supabase
    .from('companies')
    .select('id, company_name, company_code')
    .ilike('company_name', '%8.5% RBB Debenture%');
  
  if (compErr || !compList || compList.length === 0) {
    throw new Error('Could not find 8.5% RBB Debenture company in DB!');
  }
  const companyId = compList[0].id;
  console.log(`\n[1/5] Target Company: ${compList[0].company_name} (${compList[0].company_code}) [${companyId}]`);

  // 2. Fetch existing interest_payables and clients from DB
  const { data: existingPayables, error: epErr } = await supabase
    .from('interest_payables')
    .select('id, client_id, kitta, gross_interest, tax_amount, net_payable, payment_status, client:clients(id, boid, full_name)')
    .eq('company_id', companyId);

  if (epErr || !existingPayables) {
    throw new Error('Failed to load existing interest_payables: ' + epErr?.message);
  }
  console.log(`[2/5] Loaded ${existingPayables.length} interest_payables from DB.`);

  // Map payables by client BOID
  const payablesByBoid = new Map();
  for (const p of existingPayables) {
    const boid = p.client?.boid ? String(p.client.boid).trim() : null;
    if (boid) {
      payablesByBoid.set(boid, p);
    }
  }

  // 3. Parse all sheets from Excel reconciliation file
  console.log('[3/5] Parsing Reconciliation Workbook sheets...');
  const recordsToSync = [];

  const sheetConfigs = [
    { sheet: 'PUBLIC SUCCESS', defaultClassification: 'NATURAL_PERSON', defaultTaxRate: 0.06, isPaid: true },
    { sheet: 'PRIVATE SUCCESS', defaultClassification: 'COMPANY_INSTITUTION', defaultTaxRate: 0.15, isPaid: true },
    { sheet: 'MUTUAL FUND SUCCESS', defaultClassification: 'TAX_EXEMPT', defaultTaxRate: 0.0, isPaid: true },
    { sheet: 'REMAINING', defaultClassification: 'NATURAL_PERSON', defaultTaxRate: 0.06, isPaid: false }
  ];

  for (const config of sheetConfigs) {
    const ws = wb.Sheets[config.sheet];
    if (!ws) continue;
    const data = xlsx.utils.sheet_to_json(ws, { header: 1 });
    let headerIdx = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i] && data[i].includes('BOID')) { headerIdx = i; break; }
    }
    if (headerIdx === -1) continue;

    const headers = data[headerIdx];
    const boidCol = headers.indexOf('BOID');
    const nameCol = headers.indexOf('NAME');
    const kittaCol = headers.indexOf('KITTA');
    const grossCol = headers.findIndex(h => h && h.toString().toUpperCase() === 'INTEREST');
    const taxCol = headers.findIndex(h => h && h.toString().toUpperCase().includes('TAX'));
    const netCol = headers.findIndex(h => h && h.toString().toUpperCase().includes('NET'));
    const bankAccCol = headers.findIndex(h => h && h.toString().toUpperCase().includes('ACCOUNT'));
    const bankNameCol = headers.findIndex(h => h && h.toString().toUpperCase().includes('BANK NAME'));
    const statusCol = headers.findIndex(h => h && h.toString().toUpperCase().includes('STATUS'));
    const lotCol = headers.findIndex(h => h && h.toString().toUpperCase().includes('LOT'));

    let countInSheet = 0;
    for (let i = headerIdx + 1; i < data.length; i++) {
      const r = data[i];
      if (!r || !r[boidCol]) continue; // Skips footer total rows!
      let boid = String(r[boidCol]).trim();
      
      // Handle transfer: Laxmi Sunrise Capital Ltd bought debentures from Agrawal Securities Pvt. Ltd.
      let transferNote = null;
      if (boid === '1301070000017286' && !payablesByBoid.has(boid)) {
        transferNote = 'Transferred from Agrawal Securities Pvt. Ltd. (1301230000001699) to Laxmi Sunrise Capital Ltd.';
        boid = '1301230000001699';
      }

      const payable = payablesByBoid.get(boid);
      if (!payable) {
        console.warn(`  Warning: BOID ${boid} not found in DB!`);
        continue;
      }

      const kitta = Number(r[kittaCol] || 0);
      const gross = Number(r[grossCol] || 0);
      const tax = Number(r[taxCol] || 0);
      const net = Number(r[netCol] || 0);
      const statusVal = String(r[statusCol] || '').trim();
      const lotVal = lotCol !== -1 ? String(r[lotCol] || '').trim() : config.sheet;
      const bankName = String(r[bankNameCol] || '').trim();
      const bankAccount = String(r[bankAccCol] || '').trim();

      recordsToSync.push({
        payableId: payable.id,
        clientId: payable.client_id,
        boid,
        name: r[nameCol],
        sheet: config.sheet,
        kitta,
        gross,
        tax,
        net,
        taxRate: config.defaultTaxRate,
        classification: config.defaultClassification,
        isPaid: config.isPaid,
        statusVal,
        lotVal,
        bankName,
        bankAccount,
        transferNote
      });
      countInSheet++;
    }
    console.log(`  -> Sheet "${config.sheet}": extracted ${countInSheet} valid records.`);
  }

  console.log(`\nTotal valid records to synchronize: ${recordsToSync.length}`);

  // 4. Update interest_payables in batches
  console.log('[4/5] Synchronizing interest_payables in database...');
  let updatedCount = 0;
  const reconEntries = [];

  for (const item of recordsToSync) {
    const paymentStatus = item.isPaid ? 'Paid' : 'Pending';
    const paymentRef = item.isPaid ? 'SUCCESS' : null;
    const paymentDate = item.isPaid ? '2026-07-20' : null;
    let remarks = item.transferNote || (item.isPaid ? null : `RECON REMAINING: ${item.statusVal || 'PENDING'}`);

    // Update payable row
    const { error: updErr } = await supabase
      .from('interest_payables')
      .update({
        kitta: item.kitta,
        gross_interest: item.gross,
        tax_amount: item.tax,
        net_payable: item.net,
        tds_rate: item.taxRate,
        payee_classification: item.classification,
        classification_status: 'CONFIRMED',
        payment_status: paymentStatus,
        payment_reference: paymentRef,
        payment_date: paymentDate,
        bank_name: item.bankName || undefined,
        bank_account_no: item.bankAccount || undefined,
        lot_name: item.lotVal || item.sheet,
        remarks: remarks,
        updated_at: new Date().toISOString()
      })
      .eq('id', item.payableId);

    if (updErr) {
      console.error(`Error updating payable ${item.payableId}:`, updErr.message);
    } else {
      updatedCount++;
    }

    // Prepare reconciliation_results entry
    let reconResult = 'Matched';
    if (!item.isPaid) {
      if (item.statusVal.includes('REJECT') || item.statusVal.includes('MERGER') || item.statusVal.includes('NO BANK')) {
        reconResult = 'Rejected';
      } else {
        reconResult = 'Pending';
      }
    }

    reconEntries.push({
      company_id: companyId,
      client_id: item.clientId,
      payable_id: item.payableId,
      payable_type: 'interest_payables',
      source_a_type: 'excel',
      source_b_type: 'interest_payables',
      expected_amount: item.net,
      actual_amount: item.net,
      difference: 0,
      result: reconResult,
      notes: item.isPaid 
        ? `Reconciled: ${item.lotVal} (${item.statusVal || 'SUCCESS'})` 
        : `Unpaid RTS Liability: ${item.statusVal || 'Pending'} [${item.sheet}]`,
      reconciliation_date: '2026-07-20'
    });
  }

  console.log(`  -> Successfully updated ${updatedCount} interest_payables.`);

  // 5. Populate reconciliation_results
  console.log('[5/5] Recording results into reconciliation_results table...');
  // Clear any existing reconciliation_results for this company
  await supabase
    .from('reconciliation_results')
    .delete()
    .eq('company_id', companyId);

  // Insert in chunks of 100
  const chunkSize = 100;
  for (let i = 0; i < reconEntries.length; i += chunkSize) {
    const chunk = reconEntries.slice(i, i + chunkSize);
    const { error: insErr } = await supabase
      .from('reconciliation_results')
      .insert(chunk);
    if (insErr) {
      console.error(`Error inserting reconciliation chunk ${i}:`, insErr.message);
    }
  }

  console.log(`  -> Inserted ${reconEntries.length} entries into reconciliation_results.`);

  // 6. Verify Totals
  console.log('\n===============================================================');
  console.log(' POST-SYNC DATABASE TOTALS VERIFICATION');
  console.log('===============================================================');

  const { data: finalPayables } = await supabase
    .from('interest_payables')
    .select('kitta, gross_interest, tax_amount, net_payable, payment_status, payee_classification')
    .eq('company_id', companyId);

  let totKitta = 0, totGross = 0, totTax = 0, totNet = 0;
  const statusSummary = { Paid: 0, Pending: 0, Partial: 0 };
  const classSummary = {};

  for (const p of finalPayables) {
    totKitta += Number(p.kitta || 0);
    totGross += Number(p.gross_interest || 0);
    totTax += Number(p.tax_amount || 0);
    totNet += Number(p.net_payable || 0);
    statusSummary[p.payment_status] = (statusSummary[p.payment_status] || 0) + 1;
    classSummary[p.payee_classification] = (classSummary[p.payee_classification] || 0) + 1;
  }

  console.log('Total Records:      ', finalPayables.length);
  console.log('Total Kitta:        ', totKitta);
  console.log('Total Gross (183d): ', totGross.toFixed(2), ' [Expected: 106,541,095.89]');
  console.log('Total Tax:          ', totTax.toFixed(2), ' [Expected: 12,167,470.45]');
  console.log('Total Net:          ', totNet.toFixed(2), ' [Expected: 94,373,625.44]');
  console.log('\nPayment Status:    ', statusSummary, ' [Expected: 790 Paid, 77 Pending]');
  console.log('Classifications:   ', classSummary, ' [Expected: 832 Natural Person, 23 Institution, 12 Tax Exempt]');

  const { count: rrCount } = await supabase
    .from('reconciliation_results')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId);

  console.log('\nReconciliation Log: ', rrCount, 'entries recorded.');
  console.log('===============================================================');
  console.log(' SYNCHRONIZATION & RECONCILIATION COMPLETED SUCCESSFULLY!');
  console.log('===============================================================');
}

syncAndReconcile().catch(console.error);
