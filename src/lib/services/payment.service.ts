import { supabase } from '@/integrations/supabase/client';
import { bulkUpdateByIds } from '../bulk-ops';
import { getPayeeTaxRate } from './payable-summary';

export interface PaymentBatch {
  id: string;
  batch_name: string;
  company_id: string | null;
  fiscal_year: string | null;
  payable_type: string | null;
  total_payments: number;
  total_amount: number;
  total_tax: number;
  status: 'Draft' | 'Pending' | 'Approved' | 'Rejected' | 'Returned' | 'Processed' | 'Completed' | 'Failed';
  payment_method: string;
  cds_batch_ref?: string | null;
  registrar?: string | null;
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
  reversal_reason?: string | null;
  reversed_at?: string | null;
  created_at: string;
  updated_at: string;
  clients?: {
    id: string;
    boid: string | null;
    full_name: string;
    bank_name: string | null;
    bank_account_no: string | null;
  } | null;
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
        .select('*, clients(id, boid, full_name, bank_name, bank_account_no)')
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

  /**
   * Delete a draft or canceled batch and remove its line items
   */
  async deleteBatch(batchId: string): Promise<boolean> {
    try {
      // 1. Delete associated payments / line items
      const { error: lineItemsError } = await (supabase as any)
        .from('payments')
        .delete()
        .eq('batch_id', batchId);

      if (lineItemsError) {
        console.warn('Failed to delete payment line items:', lineItemsError.message);
        return false;
      }

      // 2. Delete the batch header
      const { error: batchError } = await (supabase as any)
        .from('payment_batches')
        .delete()
        .eq('id', batchId);

      if (batchError) {
        console.warn('Failed to delete payment batch:', batchError.message);
        return false;
      }

      return true;
    } catch (err: any) {
      console.warn('Failed to delete batch:', err?.message || err);
      return false;
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

      // When a batch is Completed, synchronize linked line items and underlying payables
      if (status === 'Completed') {
        try {
          const { data: lineItems } = await (supabase as any)
            .from('payments')
            .select('id, payable_type, payable_id, status')
            .eq('batch_id', batchId);

          const today = new Date().toISOString().split('T')[0];

          // Update pending payments in this batch to Completed
          await (supabase as any)
            .from('payments')
            .update({ status: 'Completed', payment_date: today, updated_at: new Date().toISOString() })
            .eq('batch_id', batchId)
            .eq('status', 'Pending');

          // Update underlying payables to Paid in bulk chunks
          const payablesByTable: Record<string, string[]> = {
            dividend_payables: [],
            interest_payables: [],
            mutual_fund_payables: [],
          };

          for (const item of lineItems || []) {
            if (!item.payable_id) continue;
            if (item.payable_type === 'dividend') payablesByTable.dividend_payables.push(item.payable_id);
            else if (item.payable_type === 'interest') payablesByTable.interest_payables.push(item.payable_id);
            else if (item.payable_type === 'mutual_fund') payablesByTable.mutual_fund_payables.push(item.payable_id);
          }

          for (const [table, ids] of Object.entries(payablesByTable)) {
            if (ids.length > 0) {
              await bulkUpdateByIds(table, ids, { payment_status: 'Paid', payment_date: today });
            }
          }
        } catch (syncErr) {
          console.warn('Failed to cascade batch completion to payables:', syncErr);
        }
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

      if (payment.status === 'Reversed') {
        console.warn('Payment is already reversed:', paymentId);
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
      const { data: currentPayment } = await (supabase as any)
        .from('payments')
        .select('status')
        .eq('id', paymentId)
        .single();

      const prevStatus = currentPayment?.status || 'Failed';

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
          previous_status: prevStatus,
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

  async getPayablesForPayment(
    companyId?: string,
    payableType?: string,
    options?: {
      fiscalYear?: string;
      periodPreset?: string;
      periodDays?: number;
      fromDate?: string;
      toDate?: string;
    }
  ): Promise<any[]> {
    try {
      // 1. Fetch payable IDs that are already present in existing active payment records (not Reversed / Failed)
      let batchedPayableIds = new Set<string>();
      try {
        const { data: existingPayments } = await (supabase as any)
          .from('payments')
          .select('payable_id')
          .not('status', 'in', ['Reversed', 'Failed']);

        if (existingPayments && Array.isArray(existingPayments)) {
          batchedPayableIds = new Set(existingPayments.map((p: any) => p.payable_id).filter(Boolean));
        }
      } catch (checkErr) {
        console.warn('Could not check existing batched payments:', checkErr);
      }

      const payables: any[] = [];
      const fetchDividends = !payableType || payableType === 'dividend' || payableType === 'all';
      const fetchInterest = !payableType || payableType === 'interest' || payableType === 'all';
      const fetchMutualFund = !payableType || payableType === 'mutual_fund' || payableType === 'all';

      if (fetchDividends) {
        let query = (supabase as any)
          .from('dividend_payables')
          .select('*, clients(*), companies(*)')
          .in('payment_status', ['Pending', 'Partial'])
          .order('created_at', { ascending: true });
        
        if (companyId && companyId !== 'all') {
          query = query.eq('company_id', companyId);
        }
        if (options?.fiscalYear && options.fiscalYear !== 'all') {
          query = query.eq('fiscal_year', options.fiscalYear);
        }
        
        const { data: dividendData, error: dividendError } = await query;
        if (dividendError) console.warn('Failed to fetch dividend payables:', dividendError.message);
        if (dividendData) {
          payables.push(...dividendData.map((p: any) => ({ ...p, payable_type: 'dividend' })));
        }
      }

      if (fetchInterest) {
        let interestQuery = (supabase as any)
          .from('interest_payables')
          .select('*, clients(*), companies(*)')
          .in('payment_status', ['Pending', 'Partial'])
          .order('created_at', { ascending: true });
        
        if (companyId && companyId !== 'all') {
          interestQuery = interestQuery.eq('company_id', companyId);
        }
        if (options?.fiscalYear && options.fiscalYear !== 'all') {
          interestQuery = interestQuery.eq('fiscal_year', options.fiscalYear);
        }
        if (options?.fromDate) {
          interestQuery = interestQuery.gte('due_date', options.fromDate);
        }
        if (options?.toDate) {
          interestQuery = interestQuery.lte('due_date', options.toDate);
        }
        
        const { data: interestData, error: interestError } = await interestQuery;
        if (interestError) console.warn('Failed to fetch interest payables:', interestError.message);
        if (interestData) {
          const days = options?.periodDays || (options?.periodPreset === '3M' ? 91 : options?.periodPreset === '6M' ? 183 : options?.periodPreset === '9M' ? 274 : 365);
          
          if (days > 0 && days !== 365) {
            // High-precision proration with exact statutory paisa balancing
            const interestItems = interestData.map((p: any) => {
              const annualGross = Number(p.gross_interest ?? 0);
              const gross = (annualGross / 365) * days;
              const rate = getPayeeTaxRate(p.payee_classification, true, null, false);
              const tax = gross * rate;
              const net = gross - tax;
              return {
                ...p,
                payable_type: 'interest',
                period_days: days,
                _rawGross: gross,
                _rawTax: tax,
                _rawNet: net,
              };
            });

            const totalNetPaisa = interestItems.reduce((s: number, r: any) => s + Math.round(r._rawNet * 100), 0);
            const totalTaxPaisa = interestItems.reduce((s: number, r: any) => s + Math.round(r._rawTax * 100), 0);

            // Distribute net paisa with largest remainder method
            let currentNetFloor = 0;
            interestItems.forEach((r: any) => {
              const pFloat = r._rawNet * 100;
              r._floorNetPaisa = Math.floor(pFloat);
              r._netRemainder = pFloat - r._floorNetPaisa;
              currentNetFloor += r._floorNetPaisa;
            });
            const missingNetPaisa = totalNetPaisa - currentNetFloor;
            const sortedByNetRem = [...interestItems].sort((a: any, b: any) => b._netRemainder - a._netRemainder);
            for (let i = 0; i < missingNetPaisa; i++) {
              sortedByNetRem[i]._floorNetPaisa += 1;
            }

            // Distribute tax paisa with largest remainder method
            let currentTaxFloor = 0;
            interestItems.forEach((r: any) => {
              const pFloat = r._rawTax * 100;
              r._floorTaxPaisa = Math.floor(pFloat);
              r._taxRemainder = pFloat - r._floorTaxPaisa;
              currentTaxFloor += r._floorTaxPaisa;
            });
            const missingTaxPaisa = totalTaxPaisa - currentTaxFloor;
            const sortedByTaxRem = [...interestItems].sort((a: any, b: any) => b._taxRemainder - a._taxRemainder);
            for (let i = 0; i < missingTaxPaisa; i++) {
              sortedByTaxRem[i]._floorTaxPaisa += 1;
            }

            interestItems.forEach((r: any) => {
              const net = r._floorNetPaisa / 100;
              const tax = r._floorTaxPaisa / 100;
              const gross = Math.round((net + tax) * 100) / 100;
              payables.push({
                ...r,
                gross_interest: gross,
                tax_amount: tax,
                net_payable: net,
              });
            });
          } else {
            for (const p of interestData) {
              const gross = Number(p.gross_interest ?? 0);
              const tax = Number(p.tax_amount ?? 0);
              const net = Number(p.net_payable ?? p.net_interest ?? (gross - tax));
              payables.push({
                ...p,
                payable_type: 'interest',
                gross_interest: gross,
                tax_amount: tax,
                net_payable: net,
                period_days: 365,
              });
            }
          }
        }
      }

      if (fetchMutualFund) {
        let mfQuery = (supabase as any)
          .from('mutual_fund_payables')
          .select('*, clients(*), companies(*)')
          .in('payment_status', ['Pending', 'Partial'])
          .order('created_at', { ascending: true });
        
        if (companyId && companyId !== 'all') {
          mfQuery = mfQuery.eq('company_id', companyId);
        }
        if (options?.fiscalYear && options.fiscalYear !== 'all') {
          mfQuery = mfQuery.eq('fiscal_year', options.fiscalYear);
        }
        
        const { data: mfData, error: mfError } = await mfQuery;
        if (mfError) console.warn('Failed to fetch mutual fund payables:', mfError.message);
        if (mfData) {
          payables.push(...mfData.map((p: any) => ({ ...p, payable_type: 'mutual_fund' })));
        }
      }
      
      // Filter out payables that are already part of an active payment batch
      return payables.filter(p => !batchedPayableIds.has(p.id));
    } catch (err: any) {
      console.warn('Failed to fetch payables:', err?.message || err);
      return [];
    }
  },
};