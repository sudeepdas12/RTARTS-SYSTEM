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
}

export const ReconciliationService = {
  async getResults(limit = 100, offset = 0): Promise<ReconciliationResultRow[]> {
    try {
      const { data, error } = await (supabase as any)
        .from('reconciliation_results')
        .select('*')
        .order('reconciliation_date', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) { console.warn('Failed to fetch reconciliation results:', error.message); return []; }
      return (data || []) as ReconciliationResultRow[];
    } catch (err: any) {
      console.warn('Failed to fetch reconciliation results:', err?.message || err);
      return [];
    }
  },

  async saveResults(results: Record<string, any>[]): Promise<void> {
    if (!results.length) return;
    const chunkSize = 500;
    try {
      for (let i = 0; i < results.length; i += chunkSize) {
        const chunk = results.slice(i, i + chunkSize);
        const { error } = await (supabase as any).from('reconciliation_results').insert(chunk);
        if (error) {
          console.warn('Failed to save reconciliation results chunk:', error.message);
          break;
        }
      }
    } catch (err: any) {
      console.warn('Failed to save reconciliation results:', err?.message || err);
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
        const payableType = result.payable_type || dominantPayableType || 'dividend';
        const payableId = result.payable_id;
        if (!payableId) continue;

        const tableName = payableType === 'dividend'
          ? 'dividend_payables'
          : payableType === 'interest'
            ? 'interest_payables'
            : payableType === 'mutual_fund'
              ? 'mutual_fund_payables'
              : null;

        if (!tableName) {
          errors.push(`Unknown payable type: ${payableType}`);
          continue;
        }

        // Fetch payable details for accurate tax and gross numbers
        let payableTax = 0;
        let payableGross = Number(result.expected_amount ?? 0);
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
          // fallback to expected amount
        }

        // Determine the new payment status
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

        if (updateError) {
          errors.push(`Failed to update ${tableName} ${payableId}: ${updateError.message}`);
          continue;
        }
        updated += 1;

        // Idempotency: Check if payment already exists for this payable_id
        const { data: existingPayment } = await (supabase as any)
          .from('payments')
          .select('id')
          .eq('payable_id', payableId)
          .limit(1)
          .maybeSingle();

        if (existingPayment) {
          // Already has a payment record, update status and avoid duplicating
          await (supabase as any)
            .from('payments')
            .update({
              status: 'Completed',
              payment_date: new Date().toISOString().split('T')[0],
              paid_amount: Number(result.actual_amount ?? result.expected_amount ?? 0),
            })
            .eq('id', existingPayment.id);
          continue;
        }

        // Create a payment record with accurate gross, tax, and net
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

        if (paymentError) {
          errors.push(`Failed to create payment for ${payableId}: ${paymentError.message}`);
        } else {
          paymentsCreated += 1;
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

    return { updated, paymentsCreated, errors };
  },
};
