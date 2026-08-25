import { supabase } from './database';

export interface ReconciliationResultRow {
  id: string;
  reconciliation_date: string;
  source_a_type: string;
  source_a_id: string | null;
  source_b_type: string;
  source_b_id: string | null;
  client_id: string | null;
  company_id: string | null;
  payable_type: string | null;
  payable_id: string | null;
  expected_amount: number | null;
  actual_amount: number | null;
  difference: number;
  result: string;
  notes: string | null;
  matched_by: string | null;
  matched_at: string | null;
  created_at: string;
  client?: {
    full_name?: string;
    boid?: string;
    bank_name?: string;
    bank_account_no?: string;
  } | null;
  company?: {
    company_name?: string;
    company_code?: string;
  } | null;
}

export interface ReconciliationGroupedLot {
  lotKey: string;
  lotName: string;
  date: string;
  companyName: string;
  payableType: string;
  fileName?: string;
  batchRef?: string;
  totalRecords: number;
  matchedCount: number;
  rejectedCount: number;
  discrepancyCount: number;
  totalAmount: number;
  matchedAmount: number;
  rejectedAmount: number;
  records: ReconciliationResultRow[];
}

export const ReconciliationService = {
  async getResults(limit = 10000, offset = 0): Promise<ReconciliationResultRow[]> {
    try {
      const { data, error } = await (supabase as any)
        .from('reconciliation_results')
        .select(`
          *,
          client:clients(full_name, boid, bank_name, bank_account_no),
          company:companies(company_name, company_code)
        `)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) { console.warn('Failed to fetch reconciliation results:', error.message); return []; }
      return (data || []) as ReconciliationResultRow[];
    } catch (err: any) {
      console.warn('Failed to fetch reconciliation results:', err?.message || err);
      return [];
    }
  },

  groupResultsIntoLots(results: ReconciliationResultRow[]): ReconciliationGroupedLot[] {
    const map = new Map<string, ReconciliationGroupedLot>();

    for (const r of results) {
      // Extract batch ID, lot name, and file name from notes if present
      let batchRef = 'Lot Settlement';
      let extractedFileName: string | undefined = undefined;

      if (r.notes) {
        if (r.notes.includes('[File:')) {
          const m = r.notes.match(/\[File:\s*([^\]|]+)/i);
          if (m && m[1]) {
            extractedFileName = m[1].trim();
            batchRef = extractedFileName.replace(/\.xlsx?$|\.csv$/i, '');
          }
        }
        if (r.notes.includes('Lot:')) {
          const m = r.notes.match(/Lot:\s*([^\]|]+)/i);
          if (m && m[1]) {
            const rawLot = m[1].trim();
            batchRef = rawLot.toLowerCase().startsWith('lot') || rawLot.toLowerCase().startsWith('bank') || rawLot.toLowerCase().startsWith('ips') ? rawLot : `Lot ${rawLot}`;
          }
        } else if (r.notes.includes('Batch:')) {
          const m = r.notes.match(/Batch:\s*([^\s|]+)/i);
          if (m && m[1]) {
            batchRef = `Batch ${m[1]}`;
          }
        } else if (r.notes.includes('ConnectIPS')) {
          if (!extractedFileName) batchRef = 'ConnectIPS Settlement';
        }
      }

      const dateStr = r.reconciliation_date || r.created_at?.slice(0, 10) || 'Unknown Date';
      const companyName = r.company?.company_name || 'General Payables';
      const payableType = (r.payable_type || 'interest').toUpperCase();

      // Cluster key by Date + Batch/File + Company + Payable Type
      const lotKey = `${dateStr}__${batchRef}__${companyName}__${payableType}`;
      const lotName = `${batchRef} (${payableType})`;

      if (!map.has(lotKey)) {
        map.set(lotKey, {
          lotKey,
          lotName,
          date: dateStr,
          companyName,
          payableType,
          fileName: extractedFileName,
          batchRef,
          totalRecords: 0,
          matchedCount: 0,
          rejectedCount: 0,
          discrepancyCount: 0,
          totalAmount: 0,
          matchedAmount: 0,
          rejectedAmount: 0,
          records: [],
        });
      }

      const lot = map.get(lotKey)!;
      lot.totalRecords += 1;
      const actualAmt = Number(r.actual_amount || r.expected_amount || 0);
      lot.totalAmount += actualAmt;
      lot.records.push(r);

      if (r.result === 'Matched') {
        lot.matchedCount += 1;
        lot.matchedAmount += actualAmt;
      } else if (r.result === 'Rejected') {
        lot.rejectedCount += 1;
        lot.rejectedAmount += actualAmt;
      } else {
        lot.discrepancyCount += 1;
      }
    }

    return Array.from(map.values());
  },

  async saveResults(results: Record<string, any>[]): Promise<{ savedCount: number; error: string | null }> {
    if (!results.length) return { savedCount: 0, error: null };
    const chunkSize = 200;
    let savedCount = 0;
    try {
      for (let i = 0; i < results.length; i += chunkSize) {
        const chunk = results.slice(i, i + chunkSize);
        const { error } = await (supabase as any).from('reconciliation_results').insert(chunk);
        if (error) {
          console.error('Failed to save reconciliation results chunk:', error.message);
          return { savedCount, error: error.message };
        }
        savedCount += chunk.length;
      }
      return { savedCount, error: null };
    } catch (err: any) {
      console.error('Failed to save reconciliation results:', err?.message || err);
      return { savedCount, error: err?.message || String(err) };
    }
  },

  async deleteRecords(ids: string[]): Promise<boolean> {
    if (!ids.length) return true;
    try {
      const chunkSize = 100;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const { error } = await (supabase as any).from('reconciliation_results').delete().in('id', chunk);
        if (error) {
          console.error('Failed to delete chunk:', error.message);
          return false;
        }
      }
      return true;
    } catch (err) {
      console.warn('Failed to delete reconciliation records:', err);
      return false;
    }
  },

  async revertLot(
    lot: ReconciliationGroupedLot
  ): Promise<{ revertedPayables: number; deletedPayments: number; historyDeleted: boolean; success: boolean }> {
    let revertedPayables = 0;
    let deletedPayments = 0;

    try {
      const payableIdsByTable: Record<string, string[]> = {
        dividend_payables: [],
        interest_payables: [],
        mutual_fund_payables: [],
      };

      for (const r of lot.records) {
        if (r.payable_id) {
          const type = r.payable_type?.toLowerCase() || 'interest';
          if (type === 'dividend') payableIdsByTable.dividend_payables.push(r.payable_id);
          else if (type === 'mutual_fund') payableIdsByTable.mutual_fund_payables.push(r.payable_id);
          else payableIdsByTable.interest_payables.push(r.payable_id);
        }
      }

      const allPayableIds = [
        ...payableIdsByTable.dividend_payables,
        ...payableIdsByTable.interest_payables,
        ...payableIdsByTable.mutual_fund_payables,
      ];

      // 1. Reset payables back to Pending
      for (const [table, ids] of Object.entries(payableIdsByTable)) {
        if (!ids.length) continue;
        const chunkSize = 100;
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
          const { error } = await (supabase as any)
            .from(table)
            .update({
              payment_status: 'Pending',
              payment_date: null,
              payment_reference: null,
              remarks: null,
            })
            .in('id', chunk);

          if (!error) {
            revertedPayables += chunk.length;
          }
        }
      }

      // 2. Reset associated payment records
      if (allPayableIds.length > 0) {
        const chunkSize = 100;
        for (let i = 0; i < allPayableIds.length; i += chunkSize) {
          const chunk = allPayableIds.slice(i, i + chunkSize);
          const { data: pList } = await (supabase as any)
            .from('payments')
            .select('id')
            .in('payable_id', chunk);

          if (pList && pList.length > 0) {
            const pIds = pList.map((p: any) => p.id);
            await (supabase as any)
              .from('payments')
              .update({
                status: 'Pending',
                payment_date: null,
                paid_amount: 0,
                remarks: null,
                payment_reference: null,
              })
              .in('id', pIds);
            deletedPayments += pIds.length;
          }
        }
      }

      // 3. Delete reconciliation history records for this lot
      const resultIds = lot.records.map(r => r.id);
      const historyDeleted = await this.deleteRecords(resultIds);

      return { revertedPayables, deletedPayments, historyDeleted, success: true };
    } catch (err: any) {
      console.error('Failed to revert lot:', err);
      return { revertedPayables, deletedPayments, historyDeleted: false, success: false };
    }
  },

  async clearHistory(date?: string): Promise<boolean> {
    try {
      let q = (supabase as any).from('reconciliation_results').delete();
      if (date) {
        q = q.eq('reconciliation_date', date);
      } else {
        q = q.neq('id', '00000000-0000-0000-0000-000000000000');
      }
      const { error } = await q;
      return !error;
    } catch (err) {
      console.warn('Failed to clear reconciliation history:', err);
      return false;
    }
  },

  /**
   * Revert an applied reconciliation batch or results:
   * - Reverts associated payables back to "Pending" (clears payment_date, payment_reference)
   * - Sets associated payments back to "Pending" or deletes auto-created payment batches
   */
  async revertReconciliation(
    batchIdOrDate?: string
  ): Promise<{ revertedPayables: number; deletedPayments: number; success: boolean }> {
    let revertedPayables = 0;
    let deletedPayments = 0;

    try {
      // 1. Find all payables across dividend, interest, mutual fund with RECON references
      const payableTables = ['dividend_payables', 'interest_payables', 'mutual_fund_payables'] as const;
      const revertedPayableIds: string[] = [];

      for (const table of payableTables) {
        let q = (supabase as any).from(table).select('id, payment_reference');
        if (batchIdOrDate) {
          q = q.or(`payment_reference.ilike.%${batchIdOrDate}%,payment_reference.ilike.RECON-%`);
        } else {
          q = q.ilike('payment_reference', 'RECON-%');
        }

        const { data: rows, error: qErr } = await q;
        if (!qErr && rows && rows.length > 0) {
          const ids = rows.map((r: any) => r.id);
          const chunkSize = 100;
          for (let i = 0; i < ids.length; i += chunkSize) {
            const chunkIds = ids.slice(i, i + chunkSize);
            const { error: updErr } = await (supabase as any)
              .from(table)
              .update({
                payment_status: 'Pending',
                payment_date: null,
                payment_reference: null,
              })
              .in('id', chunkIds);

            if (!updErr) {
              revertedPayables += chunkIds.length;
              revertedPayableIds.push(...chunkIds);
            }
          }
        }
      }

      // 2. Reset or delete associated payment records
      if (revertedPayableIds.length > 0) {
        // Chunk lookup in payments table
        const chunkSize = 200;
        for (let i = 0; i < revertedPayableIds.length; i += chunkSize) {
          const chunkIds = revertedPayableIds.slice(i, i + chunkSize);
          const { data: pList } = await (supabase as any)
            .from('payments')
            .select('id, batch_id, remarks, payment_reference')
            .in('payable_id', chunkIds);

          if (pList && pList.length > 0) {
            const pIds = pList.map((p: any) => p.id);
            const { error: pUpdErr } = await (supabase as any)
              .from('payments')
              .update({
                status: 'Pending',
                payment_date: null,
                paid_amount: 0,
                remarks: null,
                payment_reference: null,
              })
              .in('id', pIds);

            if (!pUpdErr) {
              deletedPayments += pIds.length;
            }
          }
        }
      }

      // 3. Delete any auto-created Reconciliation batches
      const { data: autoBatches } = await (supabase as any)
        .from('payment_batches')
        .select('id')
        .or("cds_batch_ref.eq.RECON-APPLY,batch_name.ilike.%Reconciliation Auto-Batch%");

      if (autoBatches && autoBatches.length > 0) {
        const autoBatchIds = autoBatches.map((b: any) => b.id);
        await (supabase as any).from('payments').delete().in('batch_id', autoBatchIds);
        await (supabase as any).from('payment_batches').delete().in('id', autoBatchIds);
      }

      return { revertedPayables, deletedPayments, success: true };
    } catch (err: any) {
      console.error('Revert reconciliation failed:', err);
      return { revertedPayables, deletedPayments, success: false };
    }
  },

  /**
   * Apply reconciliation results to the system:
   * - For "Matched" records: update the payable's payment_status to "Paid"
   *   and create a corresponding record in the payments table.
   * - For "Over_Paid"/"Under_Paid": update the payable's payment_status to "Partial"
   *   and create a payment record with the actual paid amount.
   * - For "Missing": no system changes (the payable was not found in the payment bill).
   *
   * Creates a tracking batch for the reconciliation payments and includes idempotency protection.
   */
  async applyReconciliation(
    results: ReconciliationResultRow[],
    paymentMethod: string = 'ConnectIPS'
  ): Promise<{ updated: number; paymentsCreated: number; errors: string[] }> {
    const matchedResults = results.filter(r => r.result === 'Matched' || r.result === 'Over_Paid' || r.result === 'Under_Paid');
    if (!matchedResults.length) {
      return { updated: 0, paymentsCreated: 0, errors: [] };
    }

    let updated = 0;
    let paymentsCreated = 0;
    const errors: string[] = [];

    // 1. Determine dominant payable type across matched results
    const typeCounts = matchedResults.reduce((acc, r) => {
      const t = r.payable_type || 'dividend';
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const dominantPayableType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'dividend';

    // 2. Group by company to create clean reconciliation batches
    const companyId = matchedResults.find(r => r.company_id)?.company_id || null;
    let reconBatchId: string | null = null;

    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const { data: newBatch, error: batchErr } = await (supabase as any)
        .from('payment_batches')
        .insert({
          batch_name: `Reconciliation Auto-Batch ${todayStr}`,
          company_id: companyId,
          payable_type: dominantPayableType,
          payment_method: paymentMethod,
          total_records: matchedResults.length,
          total_gross: matchedResults.reduce((acc, r) => acc + Number(r.expected_amount || 0), 0),
          total_tax: 0,
          total_net: matchedResults.reduce((acc, r) => acc + Number(r.actual_amount || r.expected_amount || 0), 0),
          status: 'Completed',
          processed_at: new Date().toISOString(),
          cds_batch_ref: 'RECON-APPLY',
        })
        .select('id')
        .single();

      if (!batchErr && newBatch) {
        reconBatchId = newBatch.id;
      }
    } catch (bErr) {
      console.warn('Could not create reconciliation tracking batch:', bErr);
    }

    let batchTotalGross = 0;
    let batchTotalTax = 0;
    let batchTotalNet = 0;

    for (const result of matchedResults) {
      try {
        let payableType = result.payable_type || dominantPayableType || 'dividend';
        let payableId = result.payable_id;
        let matchedPaymentId: string | null = null;

        // If payable_id was not directly set, check if source_b_id was a payment or payable
        if (!payableId && result.source_b_id) {
          // Check if source_b_id is a payment record
          const { data: pRec } = await (supabase as any)
            .from('payments')
            .select('id, payable_id, payable_type, company_id, client_id')
            .eq('id', result.source_b_id)
            .maybeSingle();

          if (pRec) {
            matchedPaymentId = pRec.id;
            payableId = pRec.payable_id || payableId;
            payableType = pRec.payable_type || payableType;
          } else {
            // source_b_id might be the payable ID directly
            payableId = result.source_b_id;
          }
        }

        // If still missing, attempt lookup by client_id in all payable tables
        if (!payableId && result.client_id) {
          for (const tbl of ['interest_payables', 'dividend_payables', 'mutual_fund_payables']) {
            let q = (supabase as any).from(tbl).select('id').eq('client_id', result.client_id);
            if (result.company_id) q = q.eq('company_id', result.company_id);
            const { data: foundP } = await q.limit(1).maybeSingle();
            if (foundP) {
              payableId = foundP.id;
              payableType = tbl === 'interest_payables' ? 'interest' : tbl === 'mutual_fund_payables' ? 'mutual_fund' : 'dividend';
              break;
            }
          }
        }

        const tableName = payableType === 'dividend'
          ? 'dividend_payables'
          : payableType === 'interest'
            ? 'interest_payables'
            : payableType === 'mutual_fund'
              ? 'mutual_fund_payables'
              : null;

        let payableTax = 0;
        let payableGross = Number(result.expected_amount ?? 0);

        if (tableName && payableId) {
          try {
            const { data: pRow } = await (supabase as any)
              .from(tableName)
              .select('tax_amount, gross_dividend, gross_interest, net_payable')
              .eq('id', payableId)
              .maybeSingle();

            if (pRow) {
              payableTax = Number(pRow.tax_amount || 0);
              payableGross = Number(pRow.gross_dividend ?? pRow.gross_interest ?? (Number(pRow.net_payable || 0) + payableTax));
            }
          } catch {
            // fallback
          }

          // Determine new payment status
          const newStatus = result.result === 'Matched' ? 'Paid' : 'Partial';

          // Update the payable's payment_status
          const { error: updateError } = await (supabase as any)
            .from(tableName)
            .update({ 
              payment_status: newStatus,
              payment_date: new Date().toISOString().split('T')[0],
              payment_reference: `RECON-${result.id ? String(result.id).slice(0, 8) : 'AUTO'}`
            })
            .eq('id', payableId);

          if (!updateError) {
            updated += 1;
          } else {
            errors.push(`Failed to update ${tableName} ${payableId}: ${updateError.message}`);
          }
        }

        // Handle payment creation / update
        if (matchedPaymentId) {
          await (supabase as any)
            .from('payments')
            .update({
              status: 'Completed',
              payment_date: new Date().toISOString().split('T')[0],
              paid_amount: Number(result.actual_amount ?? result.expected_amount ?? 0),
            })
            .eq('id', matchedPaymentId);
          paymentsCreated += 1;
        } else if (payableId) {
          // Idempotency: Check if payment already exists for this payable_id
          const { data: existingPayment } = await (supabase as any)
            .from('payments')
            .select('id')
            .eq('payable_id', payableId)
            .limit(1)
            .maybeSingle();

          if (existingPayment) {
            await (supabase as any)
              .from('payments')
              .update({
                status: 'Completed',
                payment_date: new Date().toISOString().split('T')[0],
                paid_amount: Number(result.actual_amount ?? result.expected_amount ?? 0),
              })
              .eq('id', existingPayment.id);
            paymentsCreated += 1;
          } else {
            const actualAmount = Number(result.actual_amount ?? 0);
            const expectedAmount = Number(result.expected_amount ?? 0);
            const netAmount = expectedAmount;
            const grossAmount = payableGross || netAmount;
            const taxAmount = payableTax;
            const paidAmount = actualAmount || expectedAmount;

            batchTotalGross += grossAmount;
            batchTotalTax += taxAmount;
            batchTotalNet += paidAmount;

            const { error: paymentError } = await (supabase as any)
              .from('payments')
              .insert({
                batch_id: reconBatchId,
                company_id: result.company_id,
                client_id: result.client_id,
                payable_type: payableType,
                payable_id: payableId,
                gross_amount: grossAmount,
                tax_amount: taxAmount,
                net_amount: netAmount,
                paid_amount: paidAmount,
                payment_method: paymentMethod,
                payment_date: new Date().toISOString().split('T')[0],
                payment_reference: `RECON-${result.id ? String(result.id).slice(0, 8) : 'auto'}`,
                status: 'Completed',
                remarks: `Auto-reconciled (${result.result})`,
              });

            if (!paymentError) {
              paymentsCreated += 1;
            } else {
              errors.push(`Failed to create payment for ${payableId}: ${paymentError.message}`);
            }
          }
        }
      } catch (err: any) {
        errors.push(`Exception for result ${result.id}: ${err?.message || String(err)}`);
      }
    }

    // Update batch totals with computed tax & gross if batch was created
    if (reconBatchId && paymentsCreated > 0) {
      try {
        await (supabase as any)
          .from('payment_batches')
          .update({
            total_gross: batchTotalGross,
            total_tax: batchTotalTax,
            total_net: batchTotalNet,
            total_amount: batchTotalNet,
            total_payments: paymentsCreated,
          })
          .eq('id', reconBatchId);
      } catch {
        // non-blocking
      }
    }

    // 3. Process and update remarks for Rejected transactions
    const rejectedResults = results.filter(r => r.result === 'Rejected');
    for (const rej of rejectedResults) {
      try {
        let payableType = rej.payable_type || dominantPayableType || 'dividend';
        let payableId = rej.payable_id;

        if (!payableId && rej.client_id) {
          for (const tbl of ['interest_payables', 'dividend_payables', 'mutual_fund_payables']) {
            let q = (supabase as any).from(tbl).select('id').eq('client_id', rej.client_id);
            if (rej.company_id) q = q.eq('company_id', rej.company_id);
            const { data: foundP } = await q.limit(1).maybeSingle();
            if (foundP) {
              payableId = foundP.id;
              payableType = tbl === 'interest_payables' ? 'interest' : tbl === 'mutual_fund_payables' ? 'mutual_fund' : 'dividend';
              break;
            }
          }
        }

        const tableName = payableType === 'dividend'
          ? 'dividend_payables'
          : payableType === 'interest'
            ? 'interest_payables'
            : payableType === 'mutual_fund'
              ? 'mutual_fund_payables'
              : null;

        if (tableName && payableId) {
          const rejectRemarks = `Bank Payout Rejected (RJCT): ${rej.notes || 'Settlement Bounced'} [${new Date().toISOString().split('T')[0]}]`;

          await (supabase as any)
            .from(tableName)
            .update({
              payment_status: 'Pending',
              remarks: rejectRemarks,
            })
            .eq('id', payableId);

          await (supabase as any)
            .from('payments')
            .update({
              status: 'Pending',
              remarks: rejectRemarks,
            })
            .eq('payable_id', payableId);
        }
      } catch (rejErr) {
        console.warn('Could not update reject remarks:', rejErr);
      }
    }

    return { updated, paymentsCreated, errors };
  },
};
