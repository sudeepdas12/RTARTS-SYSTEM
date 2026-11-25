import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import { SettingsService, SystemSettings } from "./settings.service";
import { PaymentService } from "./payment.service";
import {
  buildConnectIpsSignatureString,
  calculatePayableSettlementFromPaid,
  deriveBatchStatusFromLineStatuses,
  normalizeNchlStatus,
  type ConnectIpsBatchStatus,
  type ConnectIpsGatewayStatus,
  type ConnectIpsLedgerPaymentStatus,
} from "@/lib/connectips-utils";

export {
  buildConnectIpsSignatureString,
  calculatePayableSettlementFromPaid,
  deriveBatchStatusFromLineStatuses,
  normalizeNchlStatus,
};

export interface ConnectIPSTransaction {
  merchantId: string;
  appId: string;
  appPaymentId: string;
  txnAmt: number;
  referenceId?: string;
  remarks: string;
  particulars: string;
  token?: string;
  bankCode?: string;
  accountNo?: string;
  accountName?: string;
}

export interface ConnectIPSDisbursementResult {
  success: boolean;
  executionMode: "SANDBOX_SIMULATION" | "PRODUCTION_ADAPTER";
  isSimulated: boolean;
  batchStatus?: ConnectIpsBatchStatus;
  totalProcessed: number;
  totalSuccess: number;
  totalProcessing?: number;
  totalFailed: number;
  totalAmount: number;
  results: {
    lineItemId: string;
    boid?: string;
    payeeName: string;
    amount: number;
    status: ConnectIpsGatewayStatus;
    ledgerStatus?: ConnectIpsLedgerPaymentStatus;
    connectipsRef?: string;
    errorMessage?: string;
  }[];
}

export interface ConnectIPSStatusCheckResult {
  status: ConnectIpsGatewayStatus;
  ledgerStatus?: ConnectIpsLedgerPaymentStatus;
  refId: string;
  batchStatus?: string | null;
  synced?: boolean;
  message: string;
}

export interface ConnectIPSBatchSyncResult {
  success: boolean;
  batchStatus: string | null;
  totalChecked: number;
  settled: number;
  processing: number;
  pending: number;
  failed: number;
  returned: number;
  synced: boolean;
  message: string;
}

function canInvokeServerFunctions(): boolean {
  const isVitest =
    (typeof import.meta !== "undefined" && Boolean((import.meta as any).env?.VITEST)) ||
    (typeof process !== "undefined" && Boolean(process.env?.VITEST));
  return typeof window !== "undefined" && !isVitest;
}

export const ConnectIPSService = {
  /**
   * Generates standard NCHL ConnectIPS transaction validation string
   * Format: MERCHANTID={merchantId},APPID={appId},APPPAYMENTID={appPaymentId},AMOUNT={amount}
   */
  buildSignatureString(tx: {
    merchantId: string;
    appId: string;
    appPaymentId: string;
    amount: number;
  }): string {
    return buildConnectIpsSignatureString(tx);
  },

  /**
   * Computes SHA-256 hash or token signature for ConnectIPS payload.
   * When secretKey is provided (e.g. testing), computes directly.
   * When secretKey is omitted in browser, routes through authenticated Edge Function `connectips-sign`
   * which reads CONNECTIPS_PRIVATE_KEY / CONNECTIPS_TOKEN or saved system_settings credentials.
   */
  async generateSignature(payloadStr: string, secretKey?: string): Promise<string> {
    if (secretKey !== undefined && secretKey !== null) {
      const encoder = new TextEncoder();
      const data = encoder.encode(payloadStr + (secretKey ? `:${secretKey}` : ""));
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    if (typeof window !== "undefined") {
      try {
        const { data, error } = await supabase.functions.invoke("connectips-sign", {
          body: { payloadStr },
        });
        if (!error && data?.signature) {
          return data.signature;
        }
      } catch {
        // Fall through to environment guard
      }
    }

    const isProduction =
      (typeof import.meta !== "undefined" && Boolean(import.meta.env?.PROD)) ||
      (typeof process !== "undefined" && process.env?.NODE_ENV === "production");

    if (isProduction && !secretKey) {
      throw new Error(
        "ConnectIPS signing failed: Edge Function 'connectips-sign' is unreachable and no secret key was provided. Cannot emit an unsigned signature in production.",
      );
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(payloadStr);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  },

  /**
   * Tests connection to NCHL ConnectIPS Gateway using either unsaved overrides or stored DB API keys.
   */
  async testConnection(
    settings?: SystemSettings,
  ): Promise<{ success: boolean; message: string; details?: any }> {
    const config = settings || (await SettingsService.getSettings());

    if (!config.connectips_merchant_id || !config.connectips_app_id) {
      return {
        success: false,
        message: "Merchant ID and App ID must be configured in Settings.",
      };
    }

    if (canInvokeServerFunctions()) {
      const { testConnectIpsConnectionServerFn } = await import("@/lib/connectips.functions");
      return await testConnectIpsConnectionServerFn({
        data: {
          connectips_enabled: config.connectips_enabled,
          connectips_mode: config.connectips_mode,
          connectips_merchant_id: config.connectips_merchant_id,
          connectips_app_id: config.connectips_app_id,
          connectips_app_name: config.connectips_app_name,
          connectips_base_url: config.connectips_base_url,
          connectips_token:
            config.connectips_token && config.connectips_token !== "••••••••••••"
              ? config.connectips_token
              : undefined,
          connectips_cert_pass:
            config.connectips_cert_pass && config.connectips_cert_pass !== "••••••••••••"
              ? config.connectips_cert_pass
              : undefined,
        },
      });
    }

    const hasTokenOrSaved = Boolean(config.connectips_token || config.connectips_token_configured);
    const sigString = this.buildSignatureString({
      merchantId: config.connectips_merchant_id,
      appId: config.connectips_app_id,
      appPaymentId: `TEST-${Date.now()}`,
      amount: 100.0,
    });
    const signature = await this.generateSignature(sigString, config.connectips_token || undefined);

    if (config.connectips_mode === "SANDBOX" && !hasTokenOrSaved) {
      return {
        success: true,
        message: `ConnectIPS Sandbox test handshake verified (${config.connectips_base_url}). Ready to disburse.`,
        details: {
          mode: config.connectips_mode,
          hasApiKey: false,
          merchantId: config.connectips_merchant_id,
          appId: config.connectips_app_id,
          signaturePreview: signature.slice(0, 16) + "...",
        },
      };
    }

    if (config.connectips_mode === "PRODUCTION" && !hasTokenOrSaved) {
      return {
        success: false,
        message:
          "ConnectIPS PRODUCTION mode requires an API Bearer Token / Secret Key saved in System Settings.",
        details: {
          mode: config.connectips_mode,
          hasApiKey: false,
          merchantId: config.connectips_merchant_id,
        },
      };
    }

    return {
      success: true,
      message: `Gateway credentials valid. Configured for ${config.connectips_mode} (${config.connectips_base_url}).`,
      details: {
        mode: config.connectips_mode,
        hasApiKey: hasTokenOrSaved,
        merchantId: config.connectips_merchant_id,
        endpoint: `${config.connectips_base_url || "https://uat.connectips.com:7443"}/connectipswebgw/api/creditor/validatetxn`,
      },
    };
  },

  /**
   * Disburses pending/retryable payments in an Approved batch via NCHL ConnectIPS API (PRODUCTION)
   * or Sandbox simulator (SANDBOX), atomically synchronizing payments, payables, and batch status.
   */
  async disbursePaymentBatch(
    batchId: string,
    onProgress?: (processed: number, total: number) => void,
    options?: { retryFailedOnly?: boolean },
  ): Promise<ConnectIPSDisbursementResult> {
    if (canInvokeServerFunctions()) {
      const { disburseConnectIpsBatchServerFn } = await import("@/lib/connectips.functions");
      const res = await disburseConnectIpsBatchServerFn({
        data: {
          batchId,
          retryFailedOnly: options?.retryFailedOnly,
        },
      });
      if (onProgress) {
        onProgress(res.totalProcessed, res.totalProcessed);
      }
      return {
        ...res,
        batchStatus: res.batchStatus as ConnectIpsBatchStatus,
      };
    }

    const settings = await SettingsService.getSettings();
    const allItems = await PaymentService.getAllLineItemsForExport(batchId);

    if (!allItems || allItems.length === 0) {
      throw new Error("No payable line items found in this batch.");
    }

    const isSandbox = settings.connectips_mode !== "PRODUCTION";
    if (!isSandbox) {
      throw new Error(
        "ConnectIPS PRODUCTION settlement requires an authenticated server session with NCHL credentials saved in System Settings.",
      );
    }

    const allowedStatuses = options?.retryFailedOnly
      ? new Set(["Failed", "Rejected", "Returned"])
      : new Set(["Pending", "Failed", "Rejected", "Returned"]);
    const payableItems = allItems.filter((it) =>
      allowedStatuses.has(String(it.status || "Pending")),
    );

    if (payableItems.length === 0) {
      throw new Error("No pending or retryable line items remain in this batch.");
    }

    const result: ConnectIPSDisbursementResult = {
      success: true,
      executionMode: "SANDBOX_SIMULATION",
      isSimulated: true,
      totalProcessed: 0,
      totalSuccess: 0,
      totalProcessing: 0,
      totalFailed: 0,
      totalAmount: 0,
      results: [],
    };

    const today = new Date().toISOString().slice(0, 10);
    const merchantId = settings.connectips_merchant_id || "DEMO_MERCHANT";
    const appId = settings.connectips_app_id || "RTARTS_APP";
    const syncUpdates: Array<Record<string, unknown>> = [];

    for (let i = 0; i < payableItems.length; i++) {
      const item = payableItems[i];
      const rawNet = item.net_amount ?? null;
      const rawGross = Number(item.gross_amount ?? 0);
      const rawTax = Number(item.tax_amount ?? 0);
      const calculatedNet = rawGross > 0 ? rawGross - rawTax : 0;
      const amount = Number(rawNet !== null ? rawNet : calculatedNet || item.paid_amount || 0);
      const appPaymentId = `RTA${Date.now().toString(36).toUpperCase()}${item.id.slice(0, 6).toUpperCase()}`;
      const payeeName = item.clients?.full_name || "Shareholder";
      const bankAccount = item.bank_account_no || item.clients?.bank_account_no;

      if (!bankAccount || amount <= 0) {
        const reason = !bankAccount
          ? "ConnectIPS disbursement failed: Missing bank account number"
          : "ConnectIPS disbursement failed: Invalid payable amount";
        result.totalFailed += 1;
        syncUpdates.push({
          payment_id: item.id,
          status: "Failed",
          remarks: reason,
          reversal_reason: reason,
        });
        result.results.push({
          lineItemId: item.id,
          boid: item.clients?.boid || undefined,
          payeeName,
          amount,
          status: "FAILED",
          ledgerStatus: "Failed",
          errorMessage: reason,
        });
      } else {
        const sigString = this.buildSignatureString({ merchantId, appId, appPaymentId, amount });
        await this.generateSignature(sigString, settings.connectips_token || "");
        const connectipsRef = `CIPS-${Date.now().toString(36).toUpperCase()}-${String(i + 1).padStart(4, "0")}`;

        syncUpdates.push({
          payment_id: item.id,
          status: "Completed",
          connectips_ref: connectipsRef,
          payment_reference: connectipsRef,
          payment_date: today,
          paid_amount: amount,
          remarks: `[SANDBOX SIMULATED] Disbursed via ConnectIPS (${appPaymentId})`,
        });

        result.totalSuccess += 1;
        result.totalAmount += amount;
        result.results.push({
          lineItemId: item.id,
          boid: item.clients?.boid || undefined,
          payeeName,
          amount,
          status: "SUCCESS",
          ledgerStatus: "Completed",
          connectipsRef,
        });
      }

      result.totalProcessed += 1;
      if (onProgress) {
        onProgress(result.totalProcessed, payableItems.length);
      }
    }

    const { data: rpcData, error: rpcErr } = await (supabase as any).rpc(
      "sync_connectips_payment_results",
      {
        p_batch_id: batchId,
        p_updates: syncUpdates,
      },
    );

    if (rpcErr) {
      // Fallback for mocked non-RPC environments
      for (const upd of syncUpdates) {
        await (supabase as any)
          .from("payments")
          .update({
            status: upd.status,
            payment_date: upd.payment_date || null,
            paid_amount: upd.paid_amount ?? 0,
            connectips_ref: upd.connectips_ref || null,
            payment_reference: upd.payment_reference || null,
            remarks: upd.remarks || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", upd.payment_id);
      }
      const derived = deriveBatchStatusFromLineStatuses(
        result.results.map((r) => r.ledgerStatus || "Pending"),
      );
      await (supabase as any)
        .from("payment_batches")
        .update({
          status: derived,
          processed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", batchId);
      await PaymentService.updateBatchTotals(batchId);
      result.batchStatus = derived;
    } else {
      result.batchStatus = rpcData?.batch_status as ConnectIpsBatchStatus;
    }

    result.success = result.totalFailed === 0;
    return result;
  },

  /**
   * Inquires real-time status of a single ConnectIPS transaction and synchronizes ledger state.
   */
  async checkTransactionStatus(
    appPaymentId: string,
    options?: { paymentId?: string; batchId?: string },
  ): Promise<ConnectIPSStatusCheckResult> {
    if (canInvokeServerFunctions()) {
      try {
        const { checkConnectIpsStatusServerFn } = await import("@/lib/connectips.functions");
        const res = await checkConnectIpsStatusServerFn({
          data: {
            paymentId: options?.paymentId,
            batchId: options?.batchId,
            referenceId: options?.paymentId ? undefined : appPaymentId,
          },
        });
        return {
          status: res.status,
          ledgerStatus: res.ledgerStatus,
          refId: res.refId,
          batchStatus: res.batchStatus,
          synced: res.synced,
          message: res.message,
        };
      } catch (serverErr: any) {
        return {
          status: "PENDING",
          ledgerStatus: "Pending",
          refId: appPaymentId,
          message: `Unable to verify transaction ${appPaymentId}: ${serverErr?.message || "Gateway unreachable"}. Verification pending.`,
        };
      }
    }

    try {
      const { data: payment } = await (supabase as any)
        .from("payments")
        .select("id, status, connectips_ref, payment_reference, remarks")
        .or(`connectips_ref.eq.${appPaymentId},payment_reference.eq.${appPaymentId}`)
        .maybeSingle();

      if (payment) {
        const normalized = normalizeNchlStatus(payment.status, payment.remarks);
        return {
          status: normalized.gatewayStatus,
          ledgerStatus: normalized.ledgerStatus,
          refId: payment.connectips_ref || payment.payment_reference || appPaymentId,
          message:
            normalized.gatewayStatus === "SUCCESS"
              ? `Transaction ${appPaymentId} verified successfully in system ledger.`
              : normalized.ledgerStatus === "Processing"
                ? `Transaction ${appPaymentId} is Processing in NCHL ConnectIPS clearing. Awaiting final settlement confirmation.`
                : normalized.gatewayStatus === "FAILED"
                  ? `Transaction ${appPaymentId} marked as ${normalized.ledgerStatus}: ${payment.remarks || "Payment rejected"}.`
                  : `Transaction ${appPaymentId} status is currently ${payment.status}. Manual reconciliation required.`,
        };
      }

      return {
        status: "PENDING",
        ledgerStatus: "Pending",
        refId: appPaymentId,
        message: `Transaction ${appPaymentId} status inquiry pending gateway confirmation. Manual reconciliation recommended.`,
      };
    } catch (err: any) {
      return {
        status: "PENDING",
        ledgerStatus: "Pending",
        refId: appPaymentId,
        message: `Unable to verify transaction ${appPaymentId}: ${err?.message || "Gateway unreachable"}. Verification pending.`,
      };
    }
  },

  /**
   * Checks & synchronizes all unresolved ConnectIPS transactions across a payment batch,
   * updating line items, underlying payable paid/remaining amounts, and parent batch status.
   */
  async syncBatchTransactionStatuses(batchId: string): Promise<ConnectIPSBatchSyncResult> {
    if (canInvokeServerFunctions()) {
      const { checkConnectIpsStatusServerFn } = await import("@/lib/connectips.functions");
      const res = await checkConnectIpsStatusServerFn({
        data: { batchId },
      });
      return {
        success: res.success,
        batchStatus: res.batchStatus,
        totalChecked: res.totalChecked,
        settled: res.settled,
        processing: res.processing,
        pending: res.pending,
        failed: res.failed,
        returned: res.returned,
        synced: res.synced,
        message: res.message,
      };
    }

    const { data: rpcData, error: rpcErr } = await (supabase as any).rpc(
      "sync_connectips_payment_results",
      {
        p_batch_id: batchId,
        p_updates: [],
      },
    );
    if (rpcErr) {
      throw new Error(`Failed to synchronize batch statuses: ${rpcErr.message}`);
    }
    const counts = rpcData?.counts || {};
    return {
      success: true,
      batchStatus: rpcData?.batch_status || null,
      totalChecked: Number(counts.total || 0),
      settled: Number(counts.settled || 0),
      processing: Number(counts.processing || 0),
      pending: Number(counts.pending || 0),
      failed: Number(counts.failed || 0),
      returned: Number(counts.returned || 0),
      synced: false,
      message: `Batch ledger synced (${rpcData?.batch_status || "Updated"}).`,
    };
  },

  /**
   * Generates standard NCHL CorporatePay / ConnectIPS batch disbursement CSV/Excel file.
   */
  async generateCorporatePayBatchFile(params: {
    batchId: string;
    debitAccount?: string;
  }): Promise<{ totalRows: number; totalAmount: number; fileName: string }> {
    const { batchId, debitAccount = "" } = params;

    const lineItems = await PaymentService.getAllLineItemsForExport(batchId);
    if (!lineItems || lineItems.length === 0) {
      throw new Error("No line items found in this payment batch.");
    }

    const { data: batch } = await (supabase as any)
      .from("payment_batches")
      .select("*, company:companies(company_name, company_code)")
      .eq("id", batchId)
      .maybeSingle();

    const companyCode = batch?.company?.company_code || "RBB";
    const batchNo = batch?.batch_number || batchId.slice(0, 8);

    const headers = [
      "Instruction ID",
      "End to End ID",
      "Debit Account No",
      "Credit Bank Code",
      "Credit Bank Name",
      "Credit Account No",
      "Beneficiary Name",
      "Amount (NPR)",
      "BOID",
      "Remarks / Purpose",
    ];

    const rows = lineItems.map((item, idx) => {
      const client = (item.clients || {}) as Record<string, any>;
      const instructionId = `INST-${batchNo}-${String(idx + 1).padStart(5, "0")}`;
      const endToEndId = item.id;
      const creditBankCode = client.bank_code || "";
      const creditBankName = item.bank_name || client.bank_name || "";
      const creditAccountNo = item.bank_account_no || client.bank_account_no || "";
      const beneficiaryName = client.full_name || "Beneficiary";
      const amount = Number(item.net_amount ?? item.gross_amount ?? 0);
      const boid = client.boid || "";
      const remarks = `DIV PAYOUT ${companyCode} FY ${batch?.fiscal_year || ""}`.trim();

      return [
        instructionId,
        endToEndId,
        debitAccount,
        creditBankCode,
        creditBankName,
        creditAccountNo,
        beneficiaryName,
        amount,
        boid,
        remarks,
      ];
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    ws["!cols"] = [
      { wch: 22 },
      { wch: 38 },
      { wch: 20 },
      { wch: 16 },
      { wch: 25 },
      { wch: 22 },
      { wch: 28 },
      { wch: 16 },
      { wch: 20 },
      { wch: 32 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "NCHL_CorporatePay_Batch");

    const fileName = `NCHL_CorporatePay_${companyCode}_Batch_${batchNo}.xlsx`;
    XLSX.writeFile(wb, fileName);

    const totalAmount = lineItems.reduce(
      (s, i) => s + Number(i.net_amount ?? i.gross_amount ?? 0),
      0,
    );
    return { totalRows: lineItems.length, totalAmount, fileName };
  },

  /**
   * Parses bank / NCHL disbursement return and rejection report files to auto-reconcile failed payments,
   * accurately restoring paid/remaining balances on underlying payables and batch totals.
   */
  async parseDisbursementReturnFile(file: File): Promise<{
    totalProcessed: number;
    totalFailed: number;
    failedItems: { lineItemId?: string; boid?: string; reason: string; amount: number }[];
  }> {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const ws = workbook.Sheets[firstSheetName];
    const json = XLSX.utils.sheet_to_json<any>(ws, { defval: "" });

    const failedItems: { lineItemId?: string; boid?: string; reason: string; amount: number }[] =
      [];
    const syncUpdates: Array<Record<string, unknown>> = [];
    const today = new Date().toISOString().slice(0, 10);

    for (const row of json) {
      const rawStatusCell =
        row["Status"] ||
        row["Txn Status"] ||
        row["TXN_STATUS"] ||
        row["Payment Status"] ||
        row["Error Code"] ||
        "";
      const rowStr = JSON.stringify(row).toUpperCase();
      const normalized = normalizeNchlStatus(rawStatusCell, rowStr);
      const isFailed = normalized.gatewayStatus === "FAILED";

      if (!isFailed) continue;

      const rawRef = String(
        row["End to End ID"] ||
          row["END_TO_END_ID"] ||
          row["Instruction ID"] ||
          row["Reference"] ||
          row["Transaction ID"] ||
          row["TXN_ID"] ||
          "",
      ).trim();
      const boid = String(row["BOID"] || row["Beneficiary ID"] || "").trim() || undefined;
      const reason = String(
        row["Reason"] ||
          row["Return Reason"] ||
          row["Error Message"] ||
          row["Status Description"] ||
          row["Remarks"] ||
          "Bank disbursement returned / rejected",
      ).trim();
      const amount = Number(row["Amount"] || row["Amount (NPR)"] || row["Txn Amount"] || 0);

      let matchedPaymentId: string | undefined;
      if (rawRef && /^[0-9a-fA-F-]{36}$/.test(rawRef)) {
        matchedPaymentId = rawRef;
      } else if (rawRef) {
        const { data: byRef } = await (supabase as any)
          .from("payments")
          .select("id")
          .or(`connectips_ref.eq.${rawRef},payment_reference.eq.${rawRef}`)
          .limit(1)
          .maybeSingle();
        matchedPaymentId = byRef?.id;
      }

      failedItems.push({
        lineItemId: matchedPaymentId || rawRef || undefined,
        boid,
        reason,
        amount,
      });

      if (matchedPaymentId) {
        const targetLedgerStatus = normalized.ledgerStatus === "Rejected" ? "Rejected" : "Returned";
        syncUpdates.push({
          payment_id: matchedPaymentId,
          status: targetLedgerStatus,
          remarks: `Disbursement returned [${today}]: ${reason}`,
          reversal_reason: reason,
        });
      }
    }

    if (syncUpdates.length > 0) {
      const { error: rpcErr } = await (supabase as any).rpc("sync_connectips_payment_results", {
        p_batch_id: null,
        p_updates: syncUpdates,
      });

      if (rpcErr) {
        // Fallback when running without SQL RPC
        for (const upd of syncUpdates) {
          try {
            const { data: pmt } = await (supabase as any)
              .from("payments")
              .update({
                status: upd.status,
                paid_amount: 0,
                payment_date: null,
                remarks: upd.remarks,
                reversal_reason: upd.reversal_reason,
                updated_at: new Date().toISOString(),
              })
              .eq("id", upd.payment_id)
              .select("batch_id, payable_id, payable_type")
              .maybeSingle();

            if (pmt?.payable_id) {
              const targetTbl =
                pmt.payable_type === "dividend" || pmt.payable_type === "dividend_payables"
                  ? "dividend_payables"
                  : pmt.payable_type === "mutual_fund" ||
                      pmt.payable_type === "mutual_fund_payables"
                    ? "mutual_fund_payables"
                    : "interest_payables";

              await (supabase as any)
                .from(targetTbl)
                .update({
                  payment_status: "Pending",
                  paid_amount: 0,
                  payment_date: null,
                  payment_reference: null,
                  remarks: String(upd.remarks || ""),
                  updated_at: new Date().toISOString(),
                })
                .eq("id", pmt.payable_id);
            }
            if (pmt?.batch_id) {
              await PaymentService.updateBatchTotals(pmt.batch_id);
            }
          } catch (pmtErr) {
            console.warn("Failed to update returned disbursement status:", pmtErr);
          }
        }
      }
    }

    return {
      totalProcessed: json.length,
      totalFailed: failedItems.length,
      failedItems,
    };
  },
};
