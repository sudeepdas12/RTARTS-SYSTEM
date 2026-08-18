import { supabase } from '@/integrations/supabase/client';

export interface PaymentBatch {
  id: string;
  batch_name: string;
  company_id: string | null;
  fiscal_year: string | null;
  payable_type: string | null;
  total_payments: number;
  total_amount: number;
  total_tax: number;
  status: 'Draft' | 'Approved' | 'Processed' | 'Completed' | 'Failed';
  payment_method: string;
  neft_file_url: string | null;
  connectips_file_url: string | null;
  rtgs_file_url: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentLineItem {
  id: string;
  batch_id: string;
  company_id: string;
  client_id: string;
  payable_type: string;
  payable_id: string;
  gross_amount: number;
  tax_amount: number;
  net_amount: number;
  paid_amount: number;
  payment_method: string;
  payment_date: string | null;
  payment_reference: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  neft_ref: string | null;
  connectips_ref: string | null;
  rtgs_ref: string | null;
  cheque_no: string | null;
  status: string;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

export const PaymentService = {
  async getBatches(limit = 50, offset = 0): Promise<PaymentBatch[]> {
    try {
      const { data, error } = await (supabase as any)
        .from('payment_batches')
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      
      if (error) {
        console.warn('Failed to fetch payment batches:', error.message);
        return [];
      }
      return (data || []) as PaymentBatch[];
    } catch (err: any) {
      console.warn('Failed to fetch payment batches:', err?.message || err);
      return [];
    }
  },

  async getBatchById(batchId: string): Promise<PaymentBatch | null> {
    try {
      const { data, error } = await (supabase as any)
        .from('payment_batches')
        .select('*')
        .eq('id', batchId)
        .single();
      
      if (error) {
        console.warn('Failed to fetch batch:', error.message);
        return null;
      }
      return data as PaymentBatch;
    } catch (err: any) {
      console.warn('Failed to fetch batch:', err?.message || err);
      return null;
    }
  },

  async getLineItems(batchId: string): Promise<PaymentLineItem[]> {
    try {
      const { data, error } = await (supabase as any)
        .from('payments')
        .select('*')
        .eq('batch_id', batchId)
        .order('created_at', { ascending: true });
      
      if (error) {
        console.warn('Failed to fetch line items:', error.message);
        return [];
      }
      return (data || []) as PaymentLineItem[];
    } catch (err: any) {
      console.warn('Failed to fetch line items:', err?.message || err);
      return [];
    }
  },

  async createBatch(batchData: {
    batch_name: string;
    company_id?: string;
    fiscal_year?: string;
    payable_type?: string;
    payment_method: string;
  }): Promise<PaymentBatch | null> {
    try {
      const { data, error } = await (supabase as any)
        .from('payment_batches')
        .insert({
          batch_name: batchData.batch_name,
          company_id: batchData.company_id,
          fiscal_year: batchData.fiscal_year,
          payable_type: batchData.payable_type,
          payment_method: batchData.payment_method,
          status: 'Draft',
          total_payments: 0,
          total_amount: 0,
          total_tax: 0,
        })
        .select()
        .single();
      
      if (error) {
        console.warn('Failed to create batch:', error.message);
        return null;
      }
      return data as PaymentBatch;
    } catch (err: any) {
      console.warn('Failed to create batch:', err?.message || err);
      return null;
    }
  },

  async addLineItems(batchId: string, lineItems: Omit<PaymentLineItem, 'id' | 'batch_id' | 'created_at' | 'updated_at'>[]): Promise<boolean> {
    try {
      const items = lineItems.map(item => ({
        ...item,
        batch_id: batchId,
      }));
      
      const { error } = await (supabase as any)
        .from('payments')
        .insert(items);
      
      if (error) {
        console.warn('Failed to add line items:', error.message);
        return false;
      }
      
      // Update batch totals
      await this.updateBatchTotals(batchId);
      return true;
    } catch (err: any) {
      console.warn('Failed to add line items:', err?.message || err);
      return false;
    }
  },

  async updateBatchTotals(batchId: string): Promise<void> {
    try {
      // Get all payments for this batch
      const { data: payments, error: paymentError } = await (supabase as any)
        .from('payments')
        .select('net_amount, tax_amount, gross_amount')
        .eq('batch_id', batchId);
      
      if (paymentError) {
        console.warn('Failed to fetch payments for batch total:', paymentError.message);
        return;
      }
      
      const totalAmount = (payments || []).reduce((sum: number, p: any) => sum + (p.net_amount || 0), 0);
      const totalTax = (payments || []).reduce((sum: number, p: any) => sum + (p.tax_amount || 0), 0);
      const totalPayments = (payments || []).length;
      
      // Update batch
      await (supabase as any)
        .from('payment_batches')
        .update({
          total_amount: totalAmount,
          total_tax: totalTax,
          total_payments: totalPayments,
        })
        .eq('id', batchId);
    } catch (err: any) {
      console.warn('Failed to update batch totals:', err?.message || err);
    }
  },

  async updateBatchStatus(batchId: string, status: PaymentBatch['status'], userId?: string): Promise<boolean> {
    try {
      const updateData: any = { status };
      
      if (status === 'Approved' && userId) {
        updateData.approved_by = userId;
        updateData.approved_at = new Date().toISOString();
      } else if (status === 'Processed' || status === 'Completed') {
        updateData.processed_at = new Date().toISOString();
      }
      
      const { error } = await (supabase as any)
        .from('payment_batches')
        .update(updateData)
        .eq('id', batchId);
      
      if (error) {
        console.warn('Failed to update batch status:', error.message);
        return false;
      }
      return true;
    } catch (err: any) {
      console.warn('Failed to update batch status:', err?.message || err);
      return false;
    }
  },

  async updatePaymentStatus(paymentId: string, status: string, additionalData: Record<string, any> = {}): Promise<boolean> {
    try {
      const { error } = await (supabase as any)
        .from('payments')
        .update({
          status,
          ...additionalData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', paymentId);
      
      if (error) {
        console.warn('Failed to update payment status:', error.message);
        return false;
      }
      return true;
    } catch (err: any) {
      console.warn('Failed to update payment status:', err?.message || err);
      return false;
    }
  },

  /**
   * Reverse a payment - marks it as Reversed and restores the payable status
   */
  async reversePayment(paymentId: string, reason: string, userId?: string): Promise<boolean> {
    try {
      // Get the payment record
      const { data: payment, error: fetchError } = await (supabase as any)
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();

      if (fetchError || !payment) {
        console.warn('Failed to fetch payment for reversal:', fetchError?.message);
        return false;
      }

      // Update payment status to Reversed
      const { error: updateError } = await (supabase as any)
        .from('payments')
        .update({
          status: 'Reversed',
          reversal_reason: reason,
          reversed_by: userId || null,
          reversed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', paymentId);

      if (updateError) {
        console.warn('Failed to reverse payment:', updateError.message);
        return false;
      }

      // Restore the payable status to Pending
      if (payment.payable_type && payment.payable_id) {
        const tableName = payment.payable_type === 'dividend'
          ? 'dividend_payables'
          : payment.payable_type === 'interest'
            ? 'interest_payables'
            : payment.payable_type === 'mutual_fund'
              ? 'mutual_fund_payables'
              : null;

        if (tableName) {
          await (supabase as any)
            .from(tableName)
            .update({ payment_status: 'Pending' })
            .eq('id', payment.payable_id);
        }
      }

      // Log the reversal
      try {
        await (supabase as any).from('payment_logs').insert({
          payment_id: paymentId,
          action: 'reversed',
          previous_status: payment.status,
          new_status: 'Reversed',
          amount: payment.net_amount,
          notes: reason,
          performed_by: userId || null,
        });
      } catch (logErr) {
        console.warn('Failed to log payment reversal:', logErr);
      }

      return true;
    } catch (err: any) {
      console.warn('Failed to reverse payment:', err?.message || err);
      return false;
    }
  },

  /**
   * Retry a failed payment - resets status to Pending for reprocessing
   */
  async retryPayment(paymentId: string, userId?: string): Promise<boolean> {
    try {
      const { error } = await (supabase as any)
        .from('payments')
        .update({
          status: 'Pending',
          updated_at: new Date().toISOString(),
        })
        .eq('id', paymentId);

      if (error) {
        console.warn('Failed to retry payment:', error.message);
        return false;
      }

      try {
        await (supabase as any).from('payment_logs').insert({
          payment_id: paymentId,
          action: 'retried',
          previous_status: 'Failed',
          new_status: 'Pending',
          performed_by: userId || null,
        });
      } catch (logErr) {
        console.warn('Failed to log payment retry:', logErr);
      }

      return true;
    } catch (err: any) {
      console.warn('Failed to retry payment:', err?.message || err);
      return false;
    }
  },

  async getPayablesForPayment(companyId?: string, payableType?: string): Promise<any[]> {
    try {
      let query = (supabase as any)
        .from('dividend_payables')
        .select('*, clients(*), companies(*)')
        .in('payment_status', ['Pending', 'Partial'])
        .order('created_at', { ascending: true });
      
      if (companyId && companyId !== 'all') {
        query = query.eq('company_id', companyId);
      }
      
      const { data: dividendData, error: dividendError } = await query;
      
      // Also fetch interest payables
      let interestQuery = (supabase as any)
        .from('interest_payables')
        .select('*, clients(*), companies(*)')
        .in('payment_status', ['Pending', 'Partial'])
        .order('created_at', { ascending: true });
      
      if (companyId && companyId !== 'all') {
        interestQuery = interestQuery.eq('company_id', companyId);
      }
      
      const { data: interestData, error: interestError } = await interestQuery;
      
      if (dividendError) {
        console.warn('Failed to fetch dividend payables:', dividendError.message);
      }
      if (interestError) {
        console.warn('Failed to fetch interest payables:', interestError.message);
      }
      
      const payables = [
        ...(dividendData || []).map((p: any) => ({ ...p, payable_type: 'dividend' })),
        ...(interestData || []).map((p: any) => ({ ...p, payable_type: 'interest' })),
      ];
      
      return payables;
    } catch (err: any) {
      console.warn('Failed to fetch payables:', err?.message || err);
      return [];
    }
  },
};