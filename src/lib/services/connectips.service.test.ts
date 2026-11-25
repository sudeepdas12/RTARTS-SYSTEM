import { describe, it, expect, vi } from "vitest";
import {
  ConnectIPSService,
  calculatePayableSettlementFromPaid,
  deriveBatchStatusFromLineStatuses,
  normalizeNchlStatus,
} from "./connectips.service";
import { supabase } from "@/integrations/supabase/client";

describe("ConnectIPSService", () => {
  it("builds standard NCHL ConnectIPS signature string correctly", () => {
    const sigStr = ConnectIPSService.buildSignatureString({
      merchantId: "M101",
      appId: "APP_RTARTS",
      appPaymentId: "PAY-001",
      amount: 15500.5,
    });

    expect(sigStr).toBe("MERCHANTID=M101,APPID=APP_RTARTS,APPPAYMENTID=PAY-001,AMOUNT=15500.50");
  });

  it("generates SHA-256 hash signature for transaction payload", async () => {
    const sig = await ConnectIPSService.generateSignature("TEST_PAYLOAD_STRING", "SECRET_KEY");
    expect(typeof sig).toBe("string");
    expect(sig.length).toBe(64); // SHA-256 hex length
  });

  it("performs gateway test connection handshake in Sandbox and blocks unconfigured Production", async () => {
    const baseSettings = {
      enable_nepali_dates: true,
      dividend_tds_natural: 5,
      dividend_tds_legal: 5,
      interest_tds_natural: 6,
      interest_tds_legal: 15,
      require_maker_checker: true,
      require_final_approver: false,
      smtp_host: "",
      smtp_port: 587,
      smtp_user: "",
      smtp_from: "",
      smtp_pass: "",
      sms_gateway_url: "",
      sms_api_key: "",
      connectips_enabled: true,
      connectips_mode: "SANDBOX" as const,
      connectips_merchant_id: "MERCHANT_DEMO",
      connectips_app_id: "APP_DEMO",
      connectips_app_name: "RTARTS System",
      connectips_base_url: "https://uat.connectips.com:7443",
      connectips_token: "",
      connectips_cert_pass: "",
    };

    const sandboxRes = await ConnectIPSService.testConnection(baseSettings);
    expect(sandboxRes.success).toBe(true);
    expect(sandboxRes.message).toContain("ConnectIPS Sandbox test handshake verified");

    const unconfiguredProdRes = await ConnectIPSService.testConnection({
      ...baseSettings,
      connectips_mode: "PRODUCTION",
      connectips_base_url: "https://login.connectips.com:7443",
    });
    expect(unconfiguredProdRes.success).toBe(false);
    expect(unconfiguredProdRes.message).toContain("requires an API Bearer Token");

    const savedKeyProdRes = await ConnectIPSService.testConnection({
      ...baseSettings,
      connectips_mode: "PRODUCTION",
      connectips_base_url: "https://login.connectips.com:7443",
      connectips_token_configured: true,
    });
    expect(savedKeyProdRes.success).toBe(true);
    expect(savedKeyProdRes.details?.hasApiKey).toBe(true);
  });

  it("normalizes all NCHL ConnectIPS response codes into accurate gateway and ledger statuses", () => {
    expect(normalizeNchlStatus("SUCCESS")).toMatchObject({
      gatewayStatus: "SUCCESS",
      ledgerStatus: "Completed",
    });
    expect(normalizeNchlStatus("000", "Credit Success")).toMatchObject({
      gatewayStatus: "SUCCESS",
      ledgerStatus: "Completed",
    });
    expect(normalizeNchlStatus("PROCESSING")).toMatchObject({
      gatewayStatus: "PENDING",
      ledgerStatus: "Processing",
    });
    expect(normalizeNchlStatus("ACCEPTED", "Debited in clearing")).toMatchObject({
      gatewayStatus: "PENDING",
      ledgerStatus: "Processing",
    });
    expect(normalizeNchlStatus("RETURNED", "Account Dormant")).toMatchObject({
      gatewayStatus: "FAILED",
      ledgerStatus: "Returned",
    });
    expect(normalizeNchlStatus("RJCT")).toMatchObject({
      gatewayStatus: "FAILED",
      ledgerStatus: "Rejected",
    });
    expect(normalizeNchlStatus("ERROR", "Insufficient funds")).toMatchObject({
      gatewayStatus: "FAILED",
      ledgerStatus: "Failed",
    });
  });

  it("derives batch status and payable installment balances accurately from line statuses", () => {
    expect(deriveBatchStatusFromLineStatuses(["Completed", "Completed"])).toBe("Completed");
    expect(deriveBatchStatusFromLineStatuses(["Completed", "Processing"])).toBe("Processed");
    expect(deriveBatchStatusFromLineStatuses(["Completed", "Failed"])).toBe("Processed");
    expect(deriveBatchStatusFromLineStatuses(["Failed", "Rejected"])).toBe("Failed");
    expect(deriveBatchStatusFromLineStatuses(["Returned", "Failed"])).toBe("Returned");

    expect(calculatePayableSettlementFromPaid(1000, 1000)).toEqual({
      paidAmount: 1000,
      remainingAmount: 0,
      paymentStatus: "Paid",
    });
    expect(calculatePayableSettlementFromPaid(1000, 500)).toEqual({
      paidAmount: 500,
      remainingAmount: 500,
      paymentStatus: "Partial",
    });
    expect(calculatePayableSettlementFromPaid(1000, 0)).toEqual({
      paidAmount: 0,
      remainingAmount: 1000,
      paymentStatus: "Pending",
    });
  });

  it("inquires transaction status accurately for Processing, Returned, Completed, and missing references", async () => {
    const origFrom = (supabase as any).from;
    let mockRow: any = null;
    (supabase as any).from = (table: string) => {
      if (table === "payments") {
        return {
          select: vi.fn().mockReturnValue({
            or: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockImplementation(async () => ({ data: mockRow, error: null })),
            }),
          }),
        };
      }
      return origFrom ? origFrom.call(supabase, table) : ({} as any);
    };

    try {
      const missingRes = await ConnectIPSService.checkTransactionStatus("CIPS-NON-EXISTENT-TXN");
      expect(missingRes.status).toBe("PENDING");
      expect(missingRes.refId).toBe("CIPS-NON-EXISTENT-TXN");

      mockRow = {
        id: "pmt-1",
        status: "Processing",
        connectips_ref: "NCHL-001",
        remarks: "In clearing",
      };
      const procRes = await ConnectIPSService.checkTransactionStatus("NCHL-001");
      expect(procRes.status).toBe("PENDING");
      expect(procRes.ledgerStatus).toBe("Processing");
      expect(procRes.message).toContain("Processing");

      mockRow = {
        id: "pmt-2",
        status: "Returned",
        connectips_ref: "NCHL-002",
        remarks: "Account closed",
      };
      const retRes = await ConnectIPSService.checkTransactionStatus("NCHL-002");
      expect(retRes.status).toBe("FAILED");
      expect(retRes.ledgerStatus).toBe("Returned");

      mockRow = {
        id: "pmt-3",
        status: "Completed",
        connectips_ref: "NCHL-003",
        remarks: "Settled",
      };
      const okRes = await ConnectIPSService.checkTransactionStatus("NCHL-003");
      expect(okRes.status).toBe("SUCCESS");
      expect(okRes.ledgerStatus).toBe("Completed");
    } finally {
      (supabase as any).from = origFrom;
    }
  });

  it("skips already completed/processing payments in disbursePaymentBatch and passes paid_amount to sync RPC", async () => {
    const { PaymentService } = await import("./payment.service");
    const { SettingsService } = await import("./settings.service");

    const settingsSpy = vi.spyOn(SettingsService, "getSettings").mockResolvedValue({
      enable_nepali_dates: true,
      dividend_tds_natural: 5,
      dividend_tds_legal: 5,
      interest_tds_natural: 6,
      interest_tds_legal: 15,
      require_maker_checker: true,
      require_final_approver: false,
      smtp_host: "",
      smtp_port: 587,
      smtp_user: "",
      smtp_from: "",
      smtp_pass: "",
      sms_gateway_url: "",
      sms_api_key: "",
      connectips_enabled: true,
      connectips_mode: "SANDBOX",
      connectips_merchant_id: "M_TEST",
      connectips_app_id: "APP_TEST",
      connectips_app_name: "RTARTS",
      connectips_base_url: "https://uat.connectips.com:7443",
      connectips_token: "",
      connectips_cert_pass: "",
    });

    const exportSpy = vi.spyOn(PaymentService, "getAllLineItemsForExport").mockResolvedValue([
      {
        id: "pay-already-done",
        status: "Completed",
        gross_amount: 1000,
        tax_amount: 50,
        net_amount: 950,
        paid_amount: 950,
        bank_account_no: "00112233",
        clients: { boid: "1301010000000001", full_name: "Already Settled" },
      } as any,
      {
        id: "pay-in-clearing",
        status: "Processing",
        gross_amount: 1000,
        tax_amount: 50,
        net_amount: 950,
        paid_amount: 0,
        bank_account_no: "00112234",
        clients: { boid: "1301010000000002", full_name: "In Clearing" },
      } as any,
      {
        id: "pay-pending-ok",
        status: "Pending",
        gross_amount: 2000,
        tax_amount: 100,
        net_amount: 1900,
        paid_amount: 0,
        bank_account_no: "00112235",
        clients: { boid: "1301010000000003", full_name: "Ready Payee" },
      } as any,
      {
        id: "pay-pending-no-bank",
        status: "Pending",
        gross_amount: 500,
        tax_amount: 25,
        net_amount: 475,
        paid_amount: 0,
        bank_account_no: "",
        clients: { boid: "1301010000000004", full_name: "Missing Bank Payee" },
      } as any,
    ]);

    const rpcSpy = vi.spyOn(supabase, "rpc").mockResolvedValue({
      data: { success: true, batch_status: "Processed" },
      error: null,
    } as any);

    try {
      const res = await ConnectIPSService.disbursePaymentBatch("batch-sync-test");
      expect(res.totalProcessed).toBe(2); // Skips Completed & Processing!
      expect(res.totalSuccess).toBe(1);
      expect(res.totalFailed).toBe(1);
      expect(res.totalAmount).toBe(1900);
      expect(res.batchStatus).toBe("Processed");

      expect(rpcSpy).toHaveBeenCalledWith(
        "sync_connectips_payment_results",
        expect.objectContaining({
          p_batch_id: "batch-sync-test",
          p_updates: expect.arrayContaining([
            expect.objectContaining({
              payment_id: "pay-pending-ok",
              status: "Completed",
              paid_amount: 1900,
            }),
            expect.objectContaining({
              payment_id: "pay-pending-no-bank",
              status: "Failed",
            }),
          ]),
        }),
      );
    } finally {
      settingsSpy.mockRestore();
      exportSpy.mockRestore();
      rpcSpy.mockRestore();
    }
  });

  it("handles edge function signing error when unauthenticated or role denied", async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Unauthorized: payment authorization privileges required" },
    });
    const functionsSpy = vi.spyOn(supabase, "functions", "get").mockReturnValue({
      invoke: mockInvoke,
    } as any);

    try {
      const { error } = await supabase.functions.invoke("connectips-sign", {
        body: { payloadStr: "TEST_PAYLOAD" },
      });
      expect(error).toBeDefined();
      expect(error?.message).toContain("Unauthorized: payment authorization privileges required");
    } finally {
      functionsSpy.mockRestore();
    }
  });
});
