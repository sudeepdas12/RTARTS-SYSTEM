import { supabase } from '@/integrations/supabase/client';
import { RtsService } from '@/lib/services/rts.service';

/**
 * Service for dividend related backend actions beyond the UI.
 * Currently handles pushing a paid dividend payable to the RTS system
 * and updating the RTS submission tracking columns.
 */
export const DividendService = {
  /**
   * Push a dividend payable identified by `payableId` to the RTS system.
   * Updates the `rts_submitted`, `rts_attempts` and `rts_error` fields.
   */
  async pushToRts(payableId: string): Promise<void> {
    // 1. Load the payable record
    const { data: payable, error: fetchError } = await supabase
      .from('dividend_payables')
      .select('*')
      .eq('id', payableId)
      .single();
    if (fetchError) {
      throw new Error(`Failed to load payable: ${fetchError.message}`);
    }
    // 2. Prepare payload for RTS
    const payload = {
      company_id: payable.company_id!,
      client_id: payable.client_id!,
      amount: Number(payable.gross_dividend ?? 0) - Number(payable.tax_amount ?? 0),
      fiscal_year: payable.fiscal_year ?? '',
      payment_reference: payable.payment_reference ?? null,
      payment_date: payable.payment_date ?? new Date().toISOString().slice(0, 10),
    };
    // 3. Attempt RTS submission
    try {
      await RtsService.submitDividend(payload);
      // 4. On success, mark as submitted and clear error
      const { error: updateError } = await supabase
        .from('dividend_payables')
        .update({
          rts_submitted: true,
          rts_attempts: (payable as any).rts_attempts ?? 0 + 1,
          rts_error: null,
        } as any)
        .eq('id', payableId);
      if (updateError) {
        throw new Error(`Failed to update RTS status: ${updateError.message}`);
      }
    } catch (err: any) {
      // 5. On failure, increment attempts and store error message
      const { error: updateError } = await supabase
        .from('dividend_payables')
        .update({
          rts_submitted: false,
          rts_attempts: (payable as any).rts_attempts ?? 0 + 1,
          rts_error: err?.message ?? String(err),
        } as any)
        .eq('id', payableId);
      if (updateError) {
        // If we cannot store the error, surface the original error
        console.error('Failed to record RTS error:', updateError);
      }
      // Re‑throw to let UI show a toast
      throw err;
    }
  },
};
