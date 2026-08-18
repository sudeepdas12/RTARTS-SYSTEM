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
   * This is the "adjust data stored in system" step: the system pulls data from
   * the Excel payment bill, matches it against stored payables, and then updates
   * the payable records and creates payment records accordingly.
   */
  async applyReconciliation(results: ReconciliationResultRow[]): Promise<{ updated: number; paymentsCreated: number; errors: string[] }> {
    const matchedResults = results.filter(r => r.result === 'Matched' || r.result === 'Over_Paid' || r.result === 'Under_Paid');
    if (!matchedResults.length) {
      return { updated: 0, paymentsCreated: 0, errors: [] };
    }

    let updated = 0;
    let paymentsCreated = 0;
    const errors: string[] = [];

    for (const result of matchedResults) {
      try {
        const payableType = result.payable_type;
        const payableId = result.payable_id;
        if (!payableType || !payableId) continue;

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

        // Determine the new payment status
        const newStatus = result.result === 'Matched' ? 'Paid' : 'Partial';

        // Update the payable's payment_status
        const { error: updateError } = await (supabase as any)
          .from(tableName)
          .update({ payment_status: newStatus })
          .eq('id', payableId);

        if (updateError) {
          errors.push(`Failed to update ${tableName} ${payableId}: ${updateError.message}`);
          continue;
        }
        updated += 1;

        // Create a payment record
        const actualAmount = Number(result.actual_amount ?? 0);
        const expectedAmount = Number(result.expected_amount ?? 0);
        const { error: paymentError } = await (supabase as any)
          .from('payments')
          .insert({
            company_id: result.company_id,
            client_id: result.client_id,
            payable_type: payableType,
            payable_id: payableId,
            gross_amount: expectedAmount,
            tax_amount: 0,
            net_amount: expectedAmount,
            paid_amount: actualAmount,
            payment_method: 'NEFT',
            payment_date: new Date().toISOString().split('T')[0],
            payment_reference: `RECON-${result.id?.slice(0, 8) || 'auto'}`,
            status: 'Approved',
            remarks: `Auto-created from reconciliation (${result.result})`,
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

    return { updated, paymentsCreated, errors };
  },
};
