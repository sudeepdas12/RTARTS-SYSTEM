import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "./database";
import { bulkUpdateByIds, chunkArray } from "../bulk-ops";
import { BULK_CHUNK_SIZE } from "../constants";
import { getPayeeTaxRate } from "./payable-summary";

export interface PaymentBatch {
  id: string;
  batch_name: string;
  company_id: string | null;
  fiscal_year: string | null;
  payable_type: string | null;
  total_payments: number;
  total_amount: number;
  total_tax: number;
  status:
    | "Draft"
    | "Pending"
    | "Approved"
    | "Rejected"
    | "Returned"
    | "Processed"
    | "Completed"
    | "Failed";
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
    bank_branch?: string | null;
    pan_or_citizenship?: string | null;
    pan_no?: string | null;
    citizenship_no?: string | null;
    payee_classification?: string | null;
    payee_segment?: string | null;
    kitta?: number | null;
  } | null;
}

export const PaymentService = {
  async getBatches(limit = 50, offset = 0): Promise<PaymentBatch[]> {
    try {
      const { data, error } = await (supabase as any)
        .from("payment_batches")
        .select("*")
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error("Failed to fetch payment batches:", error.message);
        throw error;
      }
      return (data || []) as PaymentBatch[];
    } catch (err: any) {
      console.error("Failed to fetch payment batches:", err?.message || err);
      throw err;
    }
  },

  async getBatchesPaginated(
    page = 1,
    pageSize = 50,
    companyId?: string,
  ): Promise<{
    data: PaymentBatch[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let query = (supabase as any)
      .from("payment_batches")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (companyId && companyId !== "all") {
      query = query.eq("company_id", companyId);
    }

    const { data, count, error } = await query;
    if (error) {
      console.error("Failed to fetch paginated payment batches:", error.message);
      throw error;
    }
    const total = count || 0;
    return {
      data: (data || []) as PaymentBatch[],
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  },

  async getBatchById(batchId: string): Promise<PaymentBatch | null> {
    try {
      const { data, error } = await (supabase as any)
        .from("payment_batches")
        .select("*, companies(*)")
        .eq("id", batchId)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null;
        console.error("Failed to fetch batch:", error.message);
        throw error;
      }
      return data as PaymentBatch;
    } catch (err: any) {
      console.error("Failed to fetch batch:", err?.message || err);
      throw err;
    }
  },

  async getLineItems(batchId: string, limit?: number): Promise<PaymentLineItem[]> {
    try {
      if (limit !== undefined && limit > 0) {
        // UI pagination / preview mode
        const { data, error } = await (supabase as any)
          .from("payments")
          .select("*, clients(id, boid, full_name, bank_name, bank_account_no)")
          .eq("batch_id", batchId)
          .order("created_at", { ascending: true })
          .range(0, limit - 1);

        if (error) {
          console.error("Failed to fetch line items:", error.message);
          throw error;
        }
        return (data || []) as PaymentLineItem[];
      }

      // Default: fetch the complete dataset using repeated 1,000-row batches.
      // Never silently truncates at 2,000 rows — ensures 100% of payment rows are included.
      return await this.getAllLineItemsForExport(batchId);
    } catch (err: any) {
      console.error("Failed to fetch line items:", err?.message || err);
      throw err;
    }
  },

  async getAllLineItemsForExport(batchId: string): Promise<PaymentLineItem[]> {
    try {
      const data = await fetchAllRows<any>(
        (from, to) => {
          return (supabase as any)
            .from("payments")
            .select(
              "*, clients(id, boid, full_name, bank_name, bank_account_no, bank_branch, pan_or_citizenship, pan_no, citizenship_no, payee_classification, payee_segment, kitta), companies(id, company_name, company_code)",
            )
            .eq("batch_id", batchId)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to);
        },
        1000,
        200000,
      );
      return (data || []) as PaymentLineItem[];
    } catch (err: any) {
      console.error("Failed to fetch all line items for export:", err?.message || err);
      throw err;
    }
  },

  async createBatch(batchData: {
    batch_name: string;
    company_id?: string;
    fiscal_year?: string;
    payable_type?: string;
    payment_method: string;
  }): Promise<PaymentBatch> {
    const { data, error } = await (supabase as any)
      .from("payment_batches")
      .insert({
        batch_name: batchData.batch_name,
        company_id: batchData.company_id,
        fiscal_year: batchData.fiscal_year,
        payable_type: batchData.payable_type,
        payment_method: batchData.payment_method,
        status: "Draft",
        total_payments: 0,
        total_amount: 0,
        total_tax: 0,
      })
      .select()
      .single();

    if (error) {
      console.error("Failed to create batch:", error.message);
      throw new Error(`Failed to create payment batch: ${error.message}`);
    }
    return data as PaymentBatch;
  },

  /**
   * Fast server-side preview of available payables count and total amounts (< 50ms)
   */
  async getAvailablePayablesPreview(
    companyId?: string,
    payableType?: string,
    options?: {
      fiscalYear?: string;
      fromDate?: string;
      toDate?: string;
    },
  ): Promise<{
    count: number;
    totalAmount: number;
    totalGross: number;
    totalTax: number;
    mfCount: number;
    divCount: number;
    intCount: number;
  }> {
    try {
      const { data, error } = await (supabase as any).rpc("get_available_payables_preview", {
        p_company_id: companyId && companyId !== "all" ? companyId : null,
        p_payable_type: payableType && payableType !== "all" ? payableType : "all",
        p_fiscal_year:
          options?.fiscalYear && options.fiscalYear !== "all" ? options.fiscalYear : "all",
        p_from_date: options?.fromDate || null,
        p_to_date: options?.toDate || null,
      });

      if (error) throw error;
      return {
        count: Number(data?.count || 0),
        totalAmount: Number(data?.totalAmount || 0),
        totalGross: Number(data?.totalGross || 0),
        totalTax: Number(data?.totalTax || 0),
        mfCount: Number(data?.mfCount || 0),
        divCount: Number(data?.divCount || 0),
        intCount: Number(data?.intCount || 0),
      };
    } catch (err: any) {
      console.warn("get_available_payables_preview error:", err?.message || err);
      return {
        count: 0,
        totalAmount: 0,
        totalGross: 0,
        totalTax: 0,
        mfCount: 0,
        divCount: 0,
        intCount: 0,
      };
    }
  },

  /**
   * Fast server-side payment batch creation using safe chunked population (< 2s per chunk).
   * Prevents statement timeout on large datasets (50,000+ records) and supports progress callbacks.
   */
  async createBatchAtomic(
    params: {
      batch_name: string;
      company_id?: string;
      fiscal_year?: string;
      payable_type?: string;
      payment_method?: string;
      installment_tag?: string;
      cds_batch_ref?: string;
      registrar?: string;
      max_items?: number;
    },
    onProgress?: (inserted: number, totalExpected: number) => void,
  ): Promise<PaymentBatch> {
    // 1. Create the Batch Header in Draft status
    const { data: batch, error: batchErr } = await (supabase as any)
      .from("payment_batches")
      .insert({
        batch_name: params.batch_name.trim(),
        company_id: params.company_id && params.company_id !== "all" ? params.company_id : null,
        fiscal_year: params.fiscal_year && params.fiscal_year !== "all" ? params.fiscal_year : null,
        payable_type:
          params.payable_type && params.payable_type !== "all" ? params.payable_type : "all",
        payment_method: params.payment_method || "ConnectIPS",
        status: "Draft",
        total_payments: 0,
        total_amount: 0,
        total_tax: 0,
        cds_batch_ref: params.cds_batch_ref?.trim() || null,
        registrar: params.registrar?.trim() || null,
      })
      .select()
      .single();

    if (batchErr || !batch) {
      throw new Error(`Failed to create batch header: ${batchErr?.message || "Unknown error"}`);
    }

    // 2. Populate line items in safe, fast sub-2-second chunks (2,500 rows per chunk)
    const chunkSize = 2500;
    let hasMore = true;
    let totalInserted = 0;

    while (hasMore) {
      const { data: chunk, error: chunkErr } = await (supabase as any).rpc(
        "populate_payment_batch_chunk",
        {
          p_batch_id: batch.id,
          p_company_id: params.company_id && params.company_id !== "all" ? params.company_id : null,
          p_fiscal_year:
            params.fiscal_year && params.fiscal_year !== "all" ? params.fiscal_year : null,
          p_payable_type:
            params.payable_type && params.payable_type !== "all" ? params.payable_type : "all",
          p_payment_method: params.payment_method || "ConnectIPS",
          p_installment_tag: params.installment_tag || "FULL",
          p_limit: chunkSize,
        },
      );

      if (chunkErr) {
        console.error("Chunk population error:", chunkErr);
        if (totalInserted === 0) {
          await (supabase as any).from("payment_batches").delete().eq("id", batch.id);
        }
        throw new Error(`Failed to populate batch items: ${chunkErr.message}`);
      }

      totalInserted = Number(chunk?.total_in_batch || 0);
      hasMore = Boolean(chunk?.has_more) && Number(chunk?.inserted_count || 0) > 0;

      if (onProgress) {
        onProgress(totalInserted, totalInserted);
      }
    }

    // 3. Return updated batch
    const { data: finalBatch } = await (supabase as any)
      .from("payment_batches")
      .select("*")
      .eq("id", batch.id)
      .single();

    return (finalBatch || batch) as PaymentBatch;
  },

  /**
   * Transactional batch creation with automatic rollback if line item insertion fails.
   */
  async createBatchWithLineItems(
    batchData: {
      batch_name: string;
      company_id?: string;
      fiscal_year?: string;
      payable_type?: string;
      payment_method: string;
    },
    lineItems: Omit<PaymentLineItem, "id" | "batch_id" | "created_at" | "updated_at">[],
  ): Promise<PaymentBatch> {
    const batch = await this.createBatch(batchData);
    if (!batch?.id) {
      throw new Error("Failed to initialize payment batch");
    }

    try {
      if (lineItems.length > 0) {
        await this.addLineItems(batch.id, lineItems);
      }
      const reloaded = await this.getBatchById(batch.id);
      return reloaded || batch;
    } catch (insertErr) {
      console.error("Error inserting line items for batch; rolling back draft batch:", insertErr);
      // Rollback: delete line items and draft batch header
      await this.deleteBatch(batch.id).catch((rollbackErr) => {
        console.error("Rollback failed for batch:", batch.id, rollbackErr);
      });
      throw insertErr;
    }
  },

  /**
   * Delete a draft or canceled batch and remove its line items
   */
  async deleteBatch(batchId: string): Promise<boolean> {
    // 1. Delete associated payments / line items
    const { error: lineItemsError } = await (supabase as any)
      .from("payments")
      .delete()
      .eq("batch_id", batchId);

    if (lineItemsError) {
      console.error("Failed to delete payment line items:", lineItemsError.message);
      throw new Error(`Failed to delete line items: ${lineItemsError.message}`);
    }

    // 2. Delete the batch header
    const { error: batchError } = await (supabase as any)
      .from("payment_batches")
      .delete()
      .eq("id", batchId);

    if (batchError) {
      console.error("Failed to delete payment batch:", batchError.message);
      throw new Error(`Failed to delete batch: ${batchError.message}`);
    }

    return true;
  },

  /**
   * Revert a payment batch (Completed, Approved, or Processed)
   * Resets all associated payables back to 'Pending', removes payment line items,
   * and deletes the batch record.
   */
  async revertBatch(
    batchId: string,
    userId?: string,
    reason?: string,
  ): Promise<{ success: boolean; revertedPayables: number }> {
    try {
      // 1. Primary: Use atomic database transaction procedure
      const { data: rpcData, error: rpcErr } = await (supabase as any).rpc(
        "revert_payment_batch_atomic",
        {
          p_batch_id: batchId,
          p_user_id: userId || null,
          p_reason: reason || "Manual Batch Revert",
        },
      );

      if (!rpcErr && rpcData?.success) {
        return {
          success: true,
          revertedPayables: Number(rpcData.reverted_payables ?? 0),
        };
      }

      if (rpcErr) {
        console.warn(
          "revert_payment_batch_atomic RPC failed or unavailable, using fallback:",
          rpcErr.message,
        );
      }

      // 2. Fallback: Multi-step rollback if RPC unavailable
      const { data: lineItems, error: fetchErr } = await (supabase as any)
        .from("payments")
        .select("id, payable_id, payable_type, net_amount, status")
        .eq("batch_id", batchId);

      if (fetchErr) {
        throw new Error(`Failed to fetch batch line items: ${fetchErr.message}`);
      }

      const items = lineItems || [];
      const divIds: string[] = [];
      const intIds: string[] = [];
      const mfIds: string[] = [];

      for (const item of items) {
        if (!item.payable_id) continue;
        const pType = String(item.payable_type || "").toLowerCase();
        if (pType === "dividend" || pType === "dividend_payables") {
          divIds.push(item.payable_id);
        } else if (pType === "interest" || pType === "interest_payables" || pType === "debenture") {
          intIds.push(item.payable_id);
        } else if (pType === "mutual_fund" || pType === "mutual_fund_payables") {
          mfIds.push(item.payable_id);
        } else {
          intIds.push(item.payable_id);
        }
      }

      let revertedPayables = 0;

      // 2. Reset dividend payables back to Pending
      if (divIds.length > 0) {
        const { error: divErr } = await (supabase as any)
          .from("dividend_payables")
          .update({
            payment_status: "Pending",
            payment_date: null,
            payment_reference: null,
            updated_at: new Date().toISOString(),
          })
          .in("id", divIds);
        if (divErr) console.warn("Failed to reset dividend payables:", divErr.message);
        else revertedPayables += divIds.length;
      }

      // 3. Reset interest payables back to Pending
      if (intIds.length > 0) {
        const { error: intErr } = await (supabase as any)
          .from("interest_payables")
          .update({
            payment_status: "Pending",
            payment_date: null,
            payment_reference: null,
            updated_at: new Date().toISOString(),
          })
          .in("id", intIds);
        if (intErr) console.warn("Failed to reset interest payables:", intErr.message);
        else revertedPayables += intIds.length;
      }

      // 4. Reset mutual fund payables back to Pending
      if (mfIds.length > 0) {
        const { error: mfErr } = await (supabase as any)
          .from("mutual_fund_payables")
          .update({
            payment_status: "Pending",
            payment_date: null,
            payment_reference: null,
            updated_at: new Date().toISOString(),
          })
          .in("id", mfIds);
        if (mfErr) console.warn("Failed to reset mutual fund payables:", mfErr.message);
        else revertedPayables += mfIds.length;
      }

      // 5. Delete payment line items
      await (supabase as any).from("payments").delete().eq("batch_id", batchId);

      // 6. Delete the payment batch header
      await (supabase as any).from("payment_batches").delete().eq("id", batchId);

      return { success: true, revertedPayables };
    } catch (err: any) {
      console.error("Failed to revert payment batch:", err);
      throw err;
    }
  },

  async addLineItems(
    batchId: string,
    lineItems: Omit<PaymentLineItem, "id" | "batch_id" | "created_at" | "updated_at">[],
  ): Promise<boolean> {
    try {
      // 1. In-memory duplicate guards
      const payableIds = lineItems.map((item) => item.payable_id).filter(Boolean);
      const uniquePayableIds = new Set(payableIds);
      if (uniquePayableIds.size < payableIds.length) {
        throw new Error(
          "Duplicate payout attempt detected: batch contains duplicate payable records in line items.",
        );
      }

      const paymentRefs = lineItems
        .map((item) => item.payment_reference?.trim())
        .filter(Boolean) as string[];
      const uniquePaymentRefs = new Set(paymentRefs);
      if (uniquePaymentRefs.size < paymentRefs.length) {
        throw new Error(
          "Duplicate payment reference detected: batch contains duplicate payment references in line items.",
        );
      }

      // 2. Database duplicate protection checks
      if (payableIds.length > 0) {
        const { data: existingPayments, error: dupCheckErr } = await (supabase as any)
          .from("payments")
          .select("payable_id, status")
          .in("payable_id", payableIds.slice(0, 1000))
          .not("status", "in", '("Failed","Reversed","Cancelled")')
          .limit(10);

        if (!dupCheckErr && existingPayments && existingPayments.length > 0) {
          const dupId = existingPayments[0].payable_id;
          throw new Error(
            `Duplicate payout attempt detected: payable ${dupId} already has an active or completed payment record (status: ${existingPayments[0].status}).`,
          );
        }
      }

      if (paymentRefs.length > 0) {
        const { data: existingRefs, error: refCheckErr } = await (supabase as any)
          .from("payments")
          .select("payment_reference, status")
          .in("payment_reference", paymentRefs.slice(0, 1000))
          .not("status", "in", '("Failed","Reversed","Cancelled")')
          .limit(10);

        if (!refCheckErr && existingRefs && existingRefs.length > 0) {
          const dupRef = existingRefs[0].payment_reference;
          throw new Error(
            `Duplicate payment reference detected: reference "${dupRef}" is already in use by an active payment.`,
          );
        }
      }

      const items = lineItems.map((item) => ({
        ...item,
        batch_id: batchId,
      }));

      const chunks = chunkArray(items, BULK_CHUNK_SIZE);
      for (const chunk of chunks) {
        const { error } = await (supabase as any).from("payments").insert(chunk);

        if (error) {
          console.warn("Failed to add line items chunk:", error.message);
          throw new Error(`Failed to insert payment line items: ${error.message}`);
        }
      }

      // Update batch totals
      await this.updateBatchTotals(batchId);
      return true;
    } catch (err: any) {
      console.warn("Failed to add line items:", err?.message || err);
      throw err;
    }
  },

  async updateBatchTotals(batchId: string): Promise<void> {
    try {
      // Get all active payments for this batch (excluding Reversed, Failed, Cancelled)
      const payments = await fetchAllRows<any>((from, to) => {
        return (supabase as any)
          .from("payments")
          .select("net_amount, tax_amount, gross_amount, status")
          .eq("batch_id", batchId)
          .not("status", "in", '("Reversed","Failed","Cancelled")')
          .range(from, to);
      });

      const totalAmount = (payments || []).reduce(
        (sum: number, p: any) => sum + (p.net_amount || 0),
        0,
      );
      const totalTax = (payments || []).reduce(
        (sum: number, p: any) => sum + (p.tax_amount || 0),
        0,
      );
      const totalPayments = (payments || []).length;

      // Update batch
      await (supabase as any)
        .from("payment_batches")
        .update({
          total_amount: totalAmount,
          total_tax: totalTax,
          total_payments: totalPayments,
        })
        .eq("id", batchId);
    } catch (err: any) {
      console.warn("Failed to update batch totals:", err?.message || err);
    }
  },

  async updateBatchStatus(
    batchId: string,
    status: PaymentBatch["status"],
    userId?: string,
  ): Promise<boolean> {
    // When completing a batch, require atomic database-level transaction:
    if (status === "Completed") {
      const { data: rpcRes, error: rpcErr } = await (supabase as any).rpc(
        "complete_payment_batch_atomic",
        {
          p_batch_id: batchId,
          p_user_id: userId || null,
        },
      );

      if (rpcErr || !rpcRes?.success) {
        const msg = rpcErr?.message || rpcRes?.error || "Unknown RPC error";
        console.error(
          "Failed to complete payment batch: atomic completion RPC required and rejected:",
          msg,
        );
        throw new Error(`Atomic batch completion failed: ${msg}`);
      }

      return true;
    }

    // Non-Completed status updates (Draft, Pending, Approved, Processed, Rejected, etc.)
    const { data: currentBatch } = await (supabase as any)
      .from("payment_batches")
      .select("status")
      .eq("id", batchId)
      .maybeSingle();

    if (currentBatch && currentBatch.status === "Completed") {
      throw new Error(`Cannot modify batch ${batchId}: batch is Completed and permanently locked.`);
    }

    const updateData: any = { status };

    if (status === "Approved" && userId) {
      updateData.approved_by = userId;
      updateData.approved_at = new Date().toISOString();
    } else if (status === "Processed") {
      updateData.processed_at = new Date().toISOString();
    }

    const { error } = await (supabase as any)
      .from("payment_batches")
      .update(updateData)
      .eq("id", batchId);

    if (error) {
      console.error("Failed to update batch status:", error.message);
      throw new Error(`Failed to update batch status: ${error.message}`);
    }

    return true;
  },

  async updateBatch(
    batchId: string,
    updates: {
      batch_name?: string;
      fiscal_year?: string;
      payable_type?: string;
      payment_method?: string;
      company_id?: string;
      cds_batch_ref?: string | null;
      registrar?: string | null;
    },
  ): Promise<PaymentBatch> {
    const { data, error } = await (supabase as any)
      .from("payment_batches")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId)
      .select()
      .single();

    if (error) {
      console.error("Failed to update batch:", error.message);
      throw new Error(`Failed to update batch: ${error.message}`);
    }
    return data as PaymentBatch;
  },

  async updatePaymentStatus(
    paymentId: string,
    status: string,
    additionalData: Record<string, any> = {},
  ): Promise<boolean> {
    const { error } = await (supabase as any)
      .from("payments")
      .update({
        status,
        ...additionalData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentId);

    if (error) {
      console.error("Failed to update payment status:", error.message);
      throw new Error(`Failed to update payment status: ${error.message}`);
    }
    return true;
  },

  /**
   * Reverse a payment - marks it as Reversed and restores the payable status
   */
  async reversePayment(paymentId: string, reason: string, userId?: string): Promise<boolean> {
    // Get the payment record
    const { data: payment, error: fetchError } = await (supabase as any)
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .single();

    if (fetchError || !payment) {
      const msg = fetchError?.message || "Payment not found";
      console.error("Failed to fetch payment for reversal:", msg);
      throw new Error(`Failed to fetch payment for reversal: ${msg}`);
    }

    if (payment.status === "Reversed") {
      throw new Error(`Payment ${paymentId} is already reversed`);
    }

    // Update payment status to Reversed
    const { error: updateError } = await (supabase as any)
      .from("payments")
      .update({
        status: "Reversed",
        reversal_reason: reason,
        reversed_by: userId || null,
        reversed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentId);

    if (updateError) {
      console.error("Failed to reverse payment:", updateError.message);
      throw new Error(`Failed to reverse payment: ${updateError.message}`);
    }

    // Restore the payable status to Pending
    if (payment.payable_type && payment.payable_id) {
      const tableName =
        payment.payable_type === "dividend"
          ? "dividend_payables"
          : payment.payable_type === "interest"
            ? "interest_payables"
            : payment.payable_type === "mutual_fund"
              ? "mutual_fund_payables"
              : null;

      if (tableName) {
        const { error: restoreErr } = await (supabase as any)
          .from(tableName)
          .update({ payment_status: "Pending" })
          .eq("id", payment.payable_id);

        if (restoreErr) {
          console.error("Failed to restore payable status:", restoreErr.message);
          throw new Error(`Failed to restore payable status: ${restoreErr.message}`);
        }
      }
    }

    // Log the reversal
    try {
      await (supabase as any).from("payment_logs").insert({
        payment_id: paymentId,
        action: "reversed",
        previous_status: payment.status,
        new_status: "Reversed",
        amount: payment.net_amount,
        notes: reason,
        performed_by: userId || null,
      });
    } catch (logErr) {
      console.warn("Failed to log payment reversal:", logErr);
    }

    // Synchronize parent batch totals and lifecycle status if batch exists
    if (payment.batch_id) {
      try {
        await this.updateBatchTotals(payment.batch_id);

        const { data: batchPayments } = await (supabase as any)
          .from("payments")
          .select("status")
          .eq("batch_id", payment.batch_id);

        if (batchPayments && batchPayments.length > 0) {
          const allReversed = batchPayments.every(
            (p: any) => p.status === "Reversed" || p.status === "Failed" || p.status === "Returned",
          );
          if (allReversed) {
            await (supabase as any)
              .from("payment_batches")
              .update({ status: "Returned", updated_at: new Date().toISOString() })
              .eq("id", payment.batch_id);
          }
        }
      } catch (batchSyncErr) {
        console.warn("Could not synchronize parent batch after reversal:", batchSyncErr);
      }
    }

    return true;
  },

  /**
   * Retry a failed payment - resets status to Pending for reprocessing
   */
  async retryPayment(paymentId: string, userId?: string): Promise<boolean> {
    try {
      const { data: currentPayment } = await (supabase as any)
        .from("payments")
        .select("status")
        .eq("id", paymentId)
        .single();

      const prevStatus = currentPayment?.status || "Failed";

      const { error } = await (supabase as any)
        .from("payments")
        .update({
          status: "Pending",
          updated_at: new Date().toISOString(),
        })
        .eq("id", paymentId);

      if (error) {
        console.warn("Failed to retry payment:", error.message);
        return false;
      }

      try {
        await (supabase as any).from("payment_logs").insert({
          payment_id: paymentId,
          action: "retried",
          previous_status: prevStatus,
          new_status: "Pending",
          performed_by: userId || null,
        });
      } catch (logErr) {
        console.warn("Failed to log payment retry:", logErr);
      }

      return true;
    } catch (err: any) {
      console.warn("Failed to retry payment:", err?.message || err);
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
      limit?: number;
    },
  ): Promise<any[]> {
    try {
      // 1. Fetch payable IDs that are currently locked in unfinalized batches (Draft, Pending, Approved)
      let batchedPayableIds = new Set<string>();
      try {
        const existingPayments = await fetchAllRows<any>((from, to) => {
          let paymentsQ = (supabase as any)
            .from("payments")
            .select("payable_id")
            .in("status", ["Draft", "Pending", "Approved"])
            .range(from, to);

          if (companyId && companyId !== "all") {
            paymentsQ = paymentsQ.eq("company_id", companyId);
          }
          return paymentsQ;
        });

        if (existingPayments && Array.isArray(existingPayments)) {
          batchedPayableIds = new Set(
            existingPayments.map((p: any) => p.payable_id).filter(Boolean),
          );
        }
      } catch (checkErr) {
        console.warn("Could not check existing batched payments:", checkErr);
      }

      const payables: any[] = [];
      const fetchDividends = !payableType || payableType === "dividend" || payableType === "all";
      const fetchInterest = !payableType || payableType === "interest" || payableType === "all";
      const fetchMutualFund =
        !payableType || payableType === "mutual_fund" || payableType === "all";

      const clientSelect =
        "clients(id, boid, full_name, bank_name, bank_account_no, bank_branch, pan_or_citizenship, pan_no, citizenship_no, payee_classification, payee_segment, kitta)";
      const companySelect = "companies(id, company_name, company_code)";
      const payablesLimit = options?.limit ?? 200000;

      if (fetchDividends) {
        let dividendData: any[] = [];
        try {
          dividendData = await fetchAllRows<any>(
            (from, to) => {
              let query = (supabase as any)
                .from("dividend_payables")
                .select(`*, ${clientSelect}, ${companySelect}`)
                .in("payment_status", ["Pending", "Partial"])
                .order("created_at", { ascending: true })
                .order("id", { ascending: true })
                .range(from, to);

              if (companyId && companyId !== "all") {
                query = query.eq("company_id", companyId);
              }
              if (options?.fiscalYear && options.fiscalYear !== "all") {
                query = query.eq("fiscal_year", options.fiscalYear);
              }
              return query;
            },
            1000,
            payablesLimit,
          );
        } catch (dividendError: any) {
          console.warn("Failed to fetch dividend payables:", dividendError.message);
        }
        if (dividendData) {
          payables.push(
            ...dividendData.map((p: any) => {
              const origGross = Number(p.gross_dividend ?? 0);
              const origTax = Number(p.tax_amount ?? 0);
              const origNet = Number(p.net_payable ?? origGross - origTax);
              const isPartial = p.payment_status === "Partial";
              const rem = p.remaining_amount != null ? Number(p.remaining_amount) : origNet;

              let gross = origGross;
              let tax = origTax;
              let net = origNet;

              if (isPartial && rem > 0 && rem < origNet && origNet > 0) {
                net = rem;
                const ratio = net / origNet;
                gross = Math.round(origGross * ratio * 100) / 100;
                tax = Number((gross - net).toFixed(2));
                gross = Number((net + tax).toFixed(2));
              }

              return {
                ...p,
                payable_type: "dividend",
                gross_dividend: gross,
                tax_amount: tax,
                net_payable: net,
              };
            }),
          );
        }
      }

      if (fetchInterest) {
        let interestData: any[] = [];
        try {
          interestData = await fetchAllRows<any>(
            (from, to) => {
              let interestQuery = (supabase as any)
                .from("interest_payables")
                .select(`*, ${clientSelect}, ${companySelect}`)
                .in("payment_status", ["Pending", "Partial"])
                .order("created_at", { ascending: true })
                .order("id", { ascending: true })
                .range(from, to);

              if (companyId && companyId !== "all") {
                interestQuery = interestQuery.eq("company_id", companyId);
              }
              if (options?.fiscalYear && options.fiscalYear !== "all") {
                interestQuery = interestQuery.eq("fiscal_year", options.fiscalYear);
              }
              if (options?.fromDate) {
                interestQuery = interestQuery.gte("due_date", options.fromDate);
              }
              if (options?.toDate) {
                interestQuery = interestQuery.lte("due_date", options.toDate);
              }
              return interestQuery;
            },
            1000,
            payablesLimit,
          );
        } catch (interestError: any) {
          console.warn("Failed to fetch interest payables:", interestError.message);
        }
        if (interestData) {
          const days =
            options?.periodDays && options.periodDays > 0
              ? options.periodDays
              : options?.periodPreset === "3M"
                ? 91
                : options?.periodPreset === "6M"
                  ? 183
                  : options?.periodPreset === "9M"
                    ? 274
                    : 365;

          if (days > 0 && days !== 365) {
            // High-precision proration with exact statutory paisa balancing
            const interestItems = interestData.map((p: any) => {
              const annualGross = Number(p.gross_interest ?? 0);
              const annualTax = Number(p.tax_amount ?? 0);
              const gross = (annualGross / 365) * days;
              // Respect the explicitly uploaded/stored tax rate instead of blindly enforcing statutory
              // This is critical because some payees might have tax exemption certificates
              const rate =
                annualGross > 0
                  ? annualTax / annualGross
                  : getPayeeTaxRate(p.payee_classification, true, null, false);
              const tax = gross * rate;
              const net = gross - tax;
              return {
                ...p,
                payable_type: "interest",
                period_days: days,
                _rawGross: gross,
                _rawTax: tax,
                _rawNet: net,
              };
            });

            const totalNetPaisa = interestItems.reduce(
              (s: number, r: any) => s + Math.round(r._rawNet * 100),
              0,
            );
            const totalTaxPaisa = interestItems.reduce(
              (s: number, r: any) => s + Math.round(r._rawTax * 100),
              0,
            );

            // Distribute net paisa with largest remainder method
            let currentNetFloor = 0;
            interestItems.forEach((r: any) => {
              const pFloat = r._rawNet * 100;
              r._floorNetPaisa = Math.floor(pFloat);
              r._netRemainder = pFloat - r._floorNetPaisa;
              currentNetFloor += r._floorNetPaisa;
            });
            const missingNetPaisa = totalNetPaisa - currentNetFloor;
            const sortedByNetRem = [...interestItems].sort(
              (a: any, b: any) => b._netRemainder - a._netRemainder,
            );
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
            const sortedByTaxRem = [...interestItems].sort(
              (a: any, b: any) => b._taxRemainder - a._taxRemainder,
            );
            for (let i = 0; i < missingTaxPaisa; i++) {
              sortedByTaxRem[i]._floorTaxPaisa += 1;
            }

            interestItems.forEach((r: any) => {
              let net = r._floorNetPaisa / 100;
              let tax = r._floorTaxPaisa / 100;
              let gross = Math.round((net + tax) * 100) / 100;

              const isPartial = r.payment_status === "Partial";
              const rem =
                r.remaining_amount != null
                  ? Number(r.remaining_amount)
                  : Number(r.net_payable ?? 0);
              if (isPartial && rem > 0 && rem < net) {
                net = rem;
                const ratio = net / (r._floorNetPaisa / 100 || 1);
                gross = Math.round(gross * ratio * 100) / 100;
                tax = Number((gross - net).toFixed(2));
                gross = Number((net + tax).toFixed(2));
              }

              payables.push({
                ...r,
                gross_interest: gross,
                tax_amount: tax,
                net_payable: net,
                installment_leg: isPartial
                  ? "2nd Installment (Asar End)"
                  : days === 183
                    ? "1st Installment (Poush End)"
                    : "Full Settlement",
              });
            });
          } else {
            for (const p of interestData) {
              const origGross = Number(p.gross_interest ?? 0);
              const origTax = Number(p.tax_amount ?? 0);
              const origNet = Number(p.net_payable ?? p.net_interest ?? origGross - origTax);
              const isPartial = p.payment_status === "Partial";
              const rem = p.remaining_amount != null ? Number(p.remaining_amount) : origNet;

              let gross = origGross;
              let tax = origTax;
              let net = origNet;

              if (isPartial && rem > 0 && rem < origNet && origNet > 0) {
                net = rem;
                const ratio = net / origNet;
                gross = Math.round(origGross * ratio * 100) / 100;
                tax = Number((gross - net).toFixed(2));
                gross = Number((net + tax).toFixed(2));
              }

              payables.push({
                ...p,
                payable_type: "interest",
                gross_interest: gross,
                tax_amount: tax,
                net_payable: net,
                period_days: 365,
                installment_leg: isPartial ? "2nd Installment (Asar End)" : "Full Settlement",
              });
            }
          }
        }
      }

      if (fetchMutualFund) {
        let mfData: any[] = [];
        try {
          mfData = await fetchAllRows<any>(
            (from, to) => {
              let mfQuery = (supabase as any)
                .from("mutual_fund_payables")
                .select(`*, ${clientSelect}, ${companySelect}`)
                .in("payment_status", ["Pending", "Partial"])
                .order("created_at", { ascending: true })
                .order("id", { ascending: true })
                .range(from, to);

              if (companyId && companyId !== "all") {
                mfQuery = mfQuery.eq("company_id", companyId);
              }
              if (options?.fiscalYear && options.fiscalYear !== "all") {
                mfQuery = mfQuery.eq("fiscal_year", options.fiscalYear);
              }
              return mfQuery;
            },
            1000,
            payablesLimit,
          );
        } catch (mfError: any) {
          console.warn("Failed to fetch mutual fund payables:", mfError.message);
        }
        if (mfData) {
          payables.push(
            ...mfData.map((p: any) => {
              const origGross = Number(p.gross_dividend ?? 0);
              const origTax = Number(p.tax_amount ?? 0);
              const origNet = Number(p.net_payable ?? origGross - origTax);
              const isPartial = p.payment_status === "Partial";
              const rem = p.remaining_amount != null ? Number(p.remaining_amount) : origNet;

              let gross = origGross;
              let tax = origTax;
              let net = origNet;

              if (isPartial && rem > 0 && rem < origNet && origNet > 0) {
                net = rem;
                const ratio = net / origNet;
                gross = Math.round(origGross * ratio * 100) / 100;
                tax = Number((gross - net).toFixed(2));
                gross = Number((net + tax).toFixed(2));
              }

              return {
                ...p,
                payable_type: "mutual_fund",
                gross_dividend: gross,
                tax_amount: tax,
                net_payable: net,
                installment_leg: isPartial ? "2nd Installment" : "Full Settlement",
              };
            }),
          );
        }
      }

      // Filter out payables that are already part of an active payment batch
      return payables.filter((p) => !batchedPayableIds.has(p.id));
    } catch (err: any) {
      console.error("Failed to fetch payables for payment:", err?.message || err);
      throw err;
    }
  },
};
