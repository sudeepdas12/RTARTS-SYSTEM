import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildConnectIpsSignatureString,
  normalizeNchlStatus,
  type ConnectIpsGatewayStatus,
  type ConnectIpsLedgerPaymentStatus,
} from "@/lib/connectips-utils";

const DISBURSE_ALLOWED_ROLES = new Set(["admin", "supervisor", "approver"]);
const STATUS_ALLOWED_ROLES = new Set([
  "admin",
  "supervisor",
  "approver",
  "finance_operator",
  "operator",
  "reconciliation_officer",
]);

interface ServerConnectIpsConfig {
  enabled: boolean;
  mode: "SANDBOX" | "PRODUCTION";
  merchantId: string;
  appId: string;
  appName: string;
  baseUrl: string;
  token: string;
  certPass: string;
  privateKeyPem: string;
  hasApiKey: boolean;
}

const ConnectIpsTestInputSchema = z.object({
  connectips_enabled: z.boolean().optional(),
  connectips_mode: z.enum(["SANDBOX", "PRODUCTION"]).optional(),
  connectips_merchant_id: z.string().max(120).optional(),
  connectips_app_id: z.string().max(120).optional(),
  connectips_app_name: z.string().max(160).optional(),
  connectips_base_url: z.string().max(300).optional(),
  connectips_token: z.string().max(4000).optional(),
  connectips_cert_pass: z.string().max(1000).optional(),
});

const DisburseBatchInputSchema = z.object({
  batchId: z.string().uuid(),
  retryFailedOnly: z.boolean().optional(),
});

const CheckStatusInputSchema = z.object({
  batchId: z.string().uuid().optional(),
  paymentId: z.string().uuid().optional(),
  referenceId: z.string().max(160).optional(),
});

async function assertUserRoles(
  context: { supabase: any; userId: string },
  allowedRoles: Set<string>,
  actionLabel: string,
): Promise<string[]> {
  const { data: roleRows, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);

  if (error || !roleRows || roleRows.length === 0) {
    throw new Error(`Unauthorized: you do not have permission to ${actionLabel}.`);
  }

  const userRoles = roleRows.map((r: { role: string }) => String(r.role));
  if (!userRoles.some((role: string) => allowedRoles.has(role))) {
    throw new Error(`Unauthorized: insufficient role privileges to ${actionLabel}.`);
  }

  return userRoles;
}

async function assertCompanyScope(
  context: { supabase: any; userId: string },
  companyId: string | null | undefined,
  roles: string[],
): Promise<void> {
  if (!companyId || roles.includes("admin") || roles.includes("supervisor")) {
    return;
  }
  const { data: hasAccess } = await context.supabase.rpc("has_company_access", {
    _user_id: context.userId,
    _company_id: companyId,
  });
  if (hasAccess !== true) {
    throw new Error(`Unauthorized: access denied for company ${companyId}.`);
  }
}

function resolveSecretValue(
  overrideVal?: string | null,
  storedVal?: string | null,
  envVal?: string | null,
): string {
  if (overrideVal && overrideVal.trim() && overrideVal.trim() !== "••••••••••••") {
    return overrideVal.trim();
  }
  if (storedVal && storedVal.trim() && storedVal.trim() !== "••••••••••••") {
    return storedVal.trim();
  }
  if (envVal && envVal.trim()) {
    return envVal.trim();
  }
  return "";
}

async function loadServerConnectIpsConfig(
  supabaseAdmin: any,
  overrides?: Partial<z.infer<typeof ConnectIpsTestInputSchema>>,
): Promise<ServerConnectIpsConfig> {
  const { data: row } = await supabaseAdmin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", "global")
    .maybeSingle();

  const existing = (row?.setting_value as Record<string, any> | null) || {};
  const rawMode =
    overrides?.connectips_mode ||
    existing.connectips_mode ||
    (process.env.CONNECTIPS_MODE === "PRODUCTION" ? "PRODUCTION" : "SANDBOX");
  const mode: "SANDBOX" | "PRODUCTION" = rawMode === "PRODUCTION" ? "PRODUCTION" : "SANDBOX";

  const defaultBaseUrl =
    mode === "PRODUCTION" ? "https://login.connectips.com:7443" : "https://uat.connectips.com:7443";

  const baseUrl = String(
    overrides?.connectips_base_url?.trim() ||
      existing.connectips_base_url ||
      process.env.CONNECTIPS_BASE_URL ||
      defaultBaseUrl,
  )
    .trim()
    .replace(/\/+$/, "");

  const token = resolveSecretValue(
    overrides?.connectips_token,
    existing.connectips_token,
    process.env.CONNECTIPS_TOKEN,
  );
  const certPass = resolveSecretValue(
    overrides?.connectips_cert_pass,
    existing.connectips_cert_pass,
    process.env.CONNECTIPS_CERT_PASS,
  );
  const privateKeyPem = resolveSecretValue(
    undefined,
    existing.connectips_private_key,
    process.env.CONNECTIPS_PRIVATE_KEY,
  );

  return {
    enabled: Boolean(overrides?.connectips_enabled ?? existing.connectips_enabled ?? false),
    mode,
    merchantId: String(
      overrides?.connectips_merchant_id?.trim() ||
        existing.connectips_merchant_id ||
        process.env.CONNECTIPS_MERCHANT_ID ||
        "",
    ).trim(),
    appId: String(
      overrides?.connectips_app_id?.trim() ||
        existing.connectips_app_id ||
        process.env.CONNECTIPS_APP_ID ||
        "",
    ).trim(),
    appName: String(
      overrides?.connectips_app_name?.trim() ||
        existing.connectips_app_name ||
        process.env.CONNECTIPS_APP_NAME ||
        "RTARTS System",
    ).trim(),
    baseUrl,
    token,
    certPass,
    privateKeyPem,
    hasApiKey: Boolean(token || privateKeyPem),
  };
}

async function signConnectIpsPayloadServer(
  payloadStr: string,
  token: string,
  privateKeyPem: string,
): Promise<{ signature: string; algorithm: string }> {
  if (privateKeyPem) {
    const cleanPem = privateKeyPem
      .replace(/-----BEGIN[ A-Z0-9_-]+-----/g, "")
      .replace(/-----END[ A-Z0-9_-]+-----/g, "")
      .replace(/\s+/g, "");
    const binaryStr = atob(cleanPem);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i += 1) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      bytes.buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureBuffer = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      new TextEncoder().encode(payloadStr),
    );
    const sigBytes = new Uint8Array(signatureBuffer);
    let binarySig = "";
    for (const byte of sigBytes) {
      binarySig += String.fromCharCode(byte);
    }
    return { signature: btoa(binarySig), algorithm: "SHA256withRSA" };
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(`${payloadStr}${token ? `:${token}` : ""}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const signature = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { signature, algorithm: token ? "SHA-256-TOKEN" : "SHA-256" };
}

async function callNchlGatewayEndpoint(params: {
  url: string;
  appId: string;
  token: string;
  body: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<{ ok: boolean; status: number; data: Record<string, any> | null; rawText: string }> {
  if (!/^https?:\/\//i.test(params.url)) {
    throw new Error(`Invalid NCHL ConnectIPS gateway URL scheme: ${params.url}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 10_000);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (params.appId && params.token) {
      const creds = `${params.appId}:${params.token}`;
      const encoded =
        typeof Buffer !== "undefined"
          ? Buffer.from(creds, "utf-8").toString("base64")
          : btoa(creds);
      headers.Authorization = `Basic ${encoded}`;
    } else if (params.token) {
      headers.Authorization = `Bearer ${params.token}`;
    }

    const response = await fetch(params.url, {
      method: "POST",
      headers,
      body: JSON.stringify(params.body),
      signal: controller.signal,
    });
    const rawText = await response.text();
    let parsed: Record<string, any> | null = null;
    try {
      parsed = rawText ? (JSON.parse(rawText) as Record<string, any>) : null;
    } catch {
      parsed = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      data: parsed,
      rawText: rawText.slice(0, 400),
    };
  } finally {
    clearTimeout(timer);
  }
}

export const testConnectIpsConnectionServerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((payload: z.infer<typeof ConnectIpsTestInputSchema>) =>
    ConnectIpsTestInputSchema.parse(payload ?? {}),
  )
  .handler(async ({ data: input, context }) => {
    await assertUserRoles(context, new Set(["admin"]), "test ConnectIPS gateway settings");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const config = await loadServerConnectIpsConfig(supabaseAdmin, input);

    if (!config.merchantId || !config.appId) {
      return {
        success: false,
        message: "Merchant ID and App ID must be configured in Settings.",
      };
    }

    const sigString = buildConnectIpsSignatureString({
      merchantId: config.merchantId,
      appId: config.appId,
      appPaymentId: `TEST-${Date.now()}`,
      amount: 100.0,
    });
    const { signature, algorithm } = await signConnectIpsPayloadServer(
      sigString,
      config.token,
      config.privateKeyPem,
    );

    if (config.mode === "SANDBOX" && !config.hasApiKey) {
      return {
        success: true,
        message: `ConnectIPS Sandbox test handshake verified (${config.baseUrl}). Ready to disburse in Sandbox mode; save an API token when switching to live banking.`,
        details: {
          mode: config.mode,
          hasApiKey: false,
          merchantId: config.merchantId,
          appId: config.appId,
          algorithm,
          signaturePreview: `${signature.slice(0, 16)}...`,
        },
      };
    }

    if (config.mode === "PRODUCTION" && !config.hasApiKey) {
      return {
        success: false,
        message:
          "ConnectIPS PRODUCTION mode requires an API Bearer Token / Secret Key saved in System Settings (or server private key).",
        details: {
          mode: config.mode,
          hasApiKey: false,
          merchantId: config.merchantId,
          appId: config.appId,
        },
      };
    }

    const endpoint = `${config.baseUrl}/connectipswebgw/api/creditor/validatetxn`;
    try {
      const probe = await callNchlGatewayEndpoint({
        url: endpoint,
        appId: config.appId,
        token: config.token,
        body: {
          merchantId: config.merchantId,
          appId: config.appId,
          referenceId: `PROBE-${Date.now()}`,
          txnAmt: "100",
          token: signature,
        },
        timeoutMs: 8000,
      });

      if (probe.status === 401 || probe.status === 403) {
        return {
          success: false,
          message: `NCHL ConnectIPS gateway rejected credentials (HTTP ${probe.status}). Verify Merchant ID, App ID, and saved API token.`,
          details: {
            mode: config.mode,
            hasApiKey: true,
            httpStatus: probe.status,
            endpoint,
          },
        };
      }

      if (probe.ok) {
        return {
          success: true,
          message: `NCHL ConnectIPS gateway credentials verified & endpoint reachable (${config.baseUrl}).`,
          details: {
            mode: config.mode,
            hasApiKey: true,
            httpStatus: probe.status,
            merchantId: config.merchantId,
            algorithm,
            endpoint,
          },
        };
      }

      return {
        success: false,
        message: `API key is saved and payload signing succeeded locally, but gateway returned HTTP ${probe.status} from ${config.baseUrl}.`,
        details: {
          mode: config.mode,
          hasApiKey: true,
          httpStatus: probe.status,
          endpoint,
          gatewayMessage: probe.data?.statusDesc || probe.data?.message || probe.rawText,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        message: `API key is saved in System Settings and payload signing (${algorithm}) is active, but live gateway (${config.baseUrl}) is unreachable: ${err?.message || "Connection failed"}`,
        details: {
          mode: config.mode,
          hasApiKey: true,
          merchantId: config.merchantId,
          algorithm,
          endpoint,
        },
      };
    }
  });

export const disburseConnectIpsBatchServerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((payload: z.infer<typeof DisburseBatchInputSchema>) =>
    DisburseBatchInputSchema.parse(payload),
  )
  .handler(async ({ data: input, context }) => {
    const roles = await assertUserRoles(
      context,
      DISBURSE_ALLOWED_ROLES,
      "disburse payment batches via ConnectIPS",
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adminDb = supabaseAdmin as any;

    const { data: batch, error: batchErr } = await adminDb
      .from("payment_batches")
      .select("*")
      .eq("id", input.batchId)
      .maybeSingle();

    if (batchErr || !batch) {
      throw new Error(`Payment batch not found: ${batchErr?.message || input.batchId}`);
    }

    await assertCompanyScope(context, batch.company_id, roles);

    if (batch.status === "Draft" || batch.status === "Pending" || batch.status === "Rejected") {
      throw new Error(
        `Batch "${batch.batch_name}" is currently "${batch.status}". Only Approved batches can be disbursed via ConnectIPS.`,
      );
    }

    if (batch.status === "Completed") {
      throw new Error(`Batch "${batch.batch_name}" is already Completed and settled.`);
    }

    const { data: allItems, error: itemsErr } = await adminDb
      .from("payments")
      .select("*, clients(id, boid, full_name, bank_name, bank_account_no, bank_branch)")
      .eq("batch_id", input.batchId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (itemsErr || !allItems || allItems.length === 0) {
      throw new Error("No payable line items found in this batch.");
    }

    const config = await loadServerConnectIpsConfig(supabaseAdmin);
    const isProduction = config.mode === "PRODUCTION";

    if (isProduction) {
      if (!config.enabled) {
        throw new Error(
          "ConnectIPS Gateway is disabled in System Settings. Enable Gateway Active under Administration -> System Settings -> Banking (ConnectIPS).",
        );
      }
      if (!config.merchantId || !config.appId || !config.hasApiKey) {
        throw new Error(
          "NCHL ConnectIPS PRODUCTION credentials (Merchant ID, App ID, and API Key/Token) are not saved in System Settings yet.",
        );
      }
    }

    const targetStatuses = input.retryFailedOnly
      ? new Set(["Failed", "Rejected", "Returned"])
      : new Set(["Pending", "Failed", "Rejected", "Returned"]);

    const payableItems = allItems.filter((item: any) =>
      targetStatuses.has(String(item.status || "Pending")),
    );
    const alreadyProcessing = allItems.filter((item: any) => item.status === "Processing").length;

    if (payableItems.length === 0) {
      if (alreadyProcessing > 0) {
        throw new Error(
          `${alreadyProcessing} payment(s) are already Processing in NCHL clearing. Use "Sync ConnectIPS Status" to confirm settlement without double-paying.`,
        );
      }
      throw new Error("All payments in this batch are already finalized or reversed.");
    }

    const today = new Date().toISOString().slice(0, 10);
    const merchantId = config.merchantId || "DEMO_MERCHANT";
    const appId = config.appId || "RTARTS_APP";

    const syncUpdates: Array<Record<string, unknown>> = [];
    const results: Array<{
      lineItemId: string;
      boid?: string;
      payeeName: string;
      amount: number;
      status: ConnectIpsGatewayStatus;
      ledgerStatus: ConnectIpsLedgerPaymentStatus;
      connectipsRef?: string;
      errorMessage?: string;
    }> = [];

    let totalSuccess = 0;
    let totalProcessing = 0;
    let totalFailed = 0;
    let totalSettledAmount = 0;

    for (let i = 0; i < payableItems.length; i += 1) {
      const item = payableItems[i];
      const rawNet = item.net_amount ?? null;
      const rawGross = Number(item.gross_amount ?? 0);
      const rawTax = Number(item.tax_amount ?? 0);
      const calculatedNet = rawGross > 0 ? rawGross - rawTax : 0;
      const amount = Number(rawNet !== null ? rawNet : calculatedNet || item.paid_amount || 0);
      const payeeName = item.clients?.full_name || "Shareholder";
      const bankAccount = item.bank_account_no || item.clients?.bank_account_no;

      if (!bankAccount || amount <= 0) {
        const reason = !bankAccount
          ? "ConnectIPS disbursement failed: Missing bank account number"
          : "ConnectIPS disbursement failed: Non-positive payable amount";
        totalFailed += 1;
        syncUpdates.push({
          payment_id: item.id,
          status: "Failed",
          remarks: reason,
          reversal_reason: reason,
        });
        results.push({
          lineItemId: item.id,
          boid: item.clients?.boid || undefined,
          payeeName,
          amount,
          status: "FAILED",
          ledgerStatus: "Failed",
          errorMessage: reason,
        });
        continue;
      }

      const attemptSuffix =
        item.status === "Failed" || item.status === "Rejected" || item.status === "Returned"
          ? `R${Date.now().toString(36).slice(-4).toUpperCase()}`
          : "";
      const appPaymentId = `RTA${String(item.id).replace(/-/g, "").slice(0, 12).toUpperCase()}${attemptSuffix}`;
      const sigString = buildConnectIpsSignatureString({
        merchantId,
        appId,
        appPaymentId,
        amount,
      });
      const { signature } = await signConnectIpsPayloadServer(
        sigString,
        config.token,
        config.privateKeyPem,
      );

      if (!isProduction) {
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
        totalSuccess += 1;
        totalSettledAmount += amount;
        results.push({
          lineItemId: item.id,
          boid: item.clients?.boid || undefined,
          payeeName,
          amount,
          status: "SUCCESS",
          ledgerStatus: "Completed",
          connectipsRef,
        });
        continue;
      }

      try {
        const gatewayRes = await callNchlGatewayEndpoint({
          url: `${config.baseUrl}/connectipswebgw/api/v2/credittransfer`,
          appId,
          token: config.token,
          body: {
            merchantId,
            appId,
            appName: config.appName,
            referenceId: appPaymentId,
            txnAmt: Math.round(amount * 100),
            txnCurrency: "NPR",
            creditAccountNo: bankAccount,
            creditAccountName: payeeName,
            creditBankName: item.bank_name || item.clients?.bank_name || "",
            particulars: batch.batch_name || `Batch ${batch.id.slice(0, 8)}`,
            remarks: `RTARTS ${batch.payable_type || "payout"} ${item.clients?.boid || ""}`.trim(),
            token: signature,
          },
          timeoutMs: 12_000,
        });

        const rawStatus =
          gatewayRes.data?.status ||
          gatewayRes.data?.txnStatus ||
          gatewayRes.data?.responseCode ||
          (gatewayRes.ok ? "PROCESSING" : "FAILED");
        const gatewayMessage =
          gatewayRes.data?.statusDesc ||
          gatewayRes.data?.message ||
          gatewayRes.data?.error ||
          (gatewayRes.ok
            ? `Accepted by NCHL ConnectIPS (${appPaymentId})`
            : `NCHL gateway HTTP ${gatewayRes.status}`);

        const normalized = normalizeNchlStatus(rawStatus, gatewayMessage);
        const gatewayRef = String(
          gatewayRes.data?.txnId ||
            gatewayRes.data?.cipsTxnId ||
            gatewayRes.data?.referenceId ||
            appPaymentId,
        );

        syncUpdates.push({
          payment_id: item.id,
          status: normalized.ledgerStatus,
          connectips_ref: gatewayRef,
          payment_reference: appPaymentId,
          payment_date: normalized.ledgerStatus === "Completed" ? today : undefined,
          paid_amount: normalized.ledgerStatus === "Completed" ? amount : 0,
          remarks: `[NCHL PRODUCTION] ${normalized.label}: ${gatewayMessage}`,
          reversal_reason: normalized.gatewayStatus === "FAILED" ? gatewayMessage : undefined,
        });

        if (normalized.ledgerStatus === "Completed") {
          totalSuccess += 1;
          totalSettledAmount += amount;
        } else if (
          normalized.ledgerStatus === "Processing" ||
          normalized.ledgerStatus === "Pending"
        ) {
          totalProcessing += 1;
        } else {
          totalFailed += 1;
        }

        results.push({
          lineItemId: item.id,
          boid: item.clients?.boid || undefined,
          payeeName,
          amount,
          status: normalized.gatewayStatus,
          ledgerStatus: normalized.ledgerStatus,
          connectipsRef: gatewayRef,
          errorMessage: normalized.gatewayStatus === "FAILED" ? gatewayMessage : undefined,
        });
      } catch (err: any) {
        const errMsg = err?.message || "NCHL ConnectIPS gateway request failed";
        totalFailed += 1;
        syncUpdates.push({
          payment_id: item.id,
          status: "Failed",
          payment_reference: appPaymentId,
          remarks: `[NCHL PRODUCTION] Request failed: ${errMsg}`,
          reversal_reason: errMsg,
        });
        results.push({
          lineItemId: item.id,
          boid: item.clients?.boid || undefined,
          payeeName,
          amount,
          status: "FAILED",
          ledgerStatus: "Failed",
          errorMessage: errMsg,
        });
      }
    }

    const { data: syncRes, error: syncErr } = await (supabaseAdmin as any).rpc(
      "sync_connectips_payment_results",
      {
        p_batch_id: input.batchId,
        p_updates: syncUpdates,
        p_user_id: context.userId,
      },
    );

    if (syncErr) {
      throw new Error(`Failed to persist ConnectIPS disbursement statuses: ${syncErr.message}`);
    }

    return {
      success: totalFailed === 0,
      executionMode: (isProduction ? "PRODUCTION_ADAPTER" : "SANDBOX_SIMULATION") as
        "PRODUCTION_ADAPTER" | "SANDBOX_SIMULATION",
      isSimulated: !isProduction,
      batchStatus:
        (syncRes?.batch_status as string) || (totalProcessing > 0 ? "Processed" : "Completed"),
      totalProcessed: payableItems.length,
      totalSuccess,
      totalProcessing,
      totalFailed,
      totalAmount: Number(totalSettledAmount.toFixed(2)),
      results,
    };
  });

export const checkConnectIpsStatusServerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((payload: z.infer<typeof CheckStatusInputSchema>) =>
    CheckStatusInputSchema.parse(payload),
  )
  .handler(async ({ data: input, context }) => {
    const roles = await assertUserRoles(
      context,
      STATUS_ALLOWED_ROLES,
      "check NCHL ConnectIPS payment statuses",
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adminDb = supabaseAdmin as any;
    const config = await loadServerConnectIpsConfig(adminDb);

    let targetPayments: any[] = [];
    if (input.paymentId) {
      const { data, error } = await adminDb.from("payments").select("*").eq("id", input.paymentId);
      if (error) throw new Error(error.message);
      targetPayments = data || [];
    } else if (input.batchId) {
      const { data: batch } = await adminDb
        .from("payment_batches")
        .select("company_id")
        .eq("id", input.batchId)
        .maybeSingle();
      if (batch) {
        await assertCompanyScope(context, batch.company_id, roles);
      }
      const { data, error } = await adminDb
        .from("payments")
        .select("*")
        .eq("batch_id", input.batchId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      targetPayments = data || [];
    } else if (input.referenceId) {
      const ref = input.referenceId.trim();
      const { data, error } = await adminDb
        .from("payments")
        .select("*")
        .or(`connectips_ref.eq.${ref},payment_reference.eq.${ref}`)
        .limit(20);
      if (error) throw new Error(error.message);
      targetPayments = data || [];
    }

    if (targetPayments.length === 0) {
      const fallbackRef = input.referenceId || input.paymentId || input.batchId || "UNKNOWN";
      return {
        success: false,
        status: "PENDING" as ConnectIpsGatewayStatus,
        ledgerStatus: "Pending" as ConnectIpsLedgerPaymentStatus,
        refId: fallbackRef,
        batchStatus: null,
        totalChecked: 0,
        settled: 0,
        processing: 0,
        pending: 0,
        failed: 0,
        returned: 0,
        synced: false,
        message: `Transaction ${fallbackRef} not found in payment ledger. Manual reconciliation recommended.`,
      };
    }

    for (const p of targetPayments) {
      await assertCompanyScope(context, p.company_id, roles);
    }

    const today = new Date().toISOString().slice(0, 10);
    const syncUpdates: Array<Record<string, unknown>> = [];
    const shouldQueryGateway =
      config.mode === "PRODUCTION" && config.hasApiKey && config.merchantId && config.appId;

    if (shouldQueryGateway) {
      for (const p of targetPayments) {
        const st = String(p.status || "Pending");
        if (st === "Completed" || st === "Paid" || st === "Reversed" || st === "Cancelled") {
          continue;
        }
        const inquiryRef = p.payment_reference || p.connectips_ref;
        if (!inquiryRef) continue;

        const amount = Number(p.net_amount || p.paid_amount || 0);
        const sigString = buildConnectIpsSignatureString({
          merchantId: config.merchantId,
          appId: config.appId,
          appPaymentId: inquiryRef,
          amount,
        });
        const { signature } = await signConnectIpsPayloadServer(
          sigString,
          config.token,
          config.privateKeyPem,
        );

        try {
          const gatewayRes = await callNchlGatewayEndpoint({
            url: `${config.baseUrl}/connectipswebgw/api/creditor/validatetxn`,
            appId: config.appId,
            token: config.token,
            body: {
              merchantId: config.merchantId,
              appId: config.appId,
              referenceId: inquiryRef,
              txnAmt: Math.round(amount * 100),
              token: signature,
            },
            timeoutMs: 10_000,
          });

          if (gatewayRes.ok && gatewayRes.data) {
            const rawStatus =
              gatewayRes.data.status ||
              gatewayRes.data.txnStatus ||
              gatewayRes.data.responseCode ||
              "";
            const gatewayDesc =
              gatewayRes.data.statusDesc ||
              gatewayRes.data.message ||
              gatewayRes.data.remarks ||
              "";
            if (rawStatus) {
              const normalized = normalizeNchlStatus(rawStatus, gatewayDesc);
              const gatewayRef =
                gatewayRes.data.txnId ||
                gatewayRes.data.cipsTxnId ||
                p.connectips_ref ||
                inquiryRef;

              syncUpdates.push({
                payment_id: p.id,
                status: normalized.ledgerStatus,
                connectips_ref: String(gatewayRef),
                payment_date: normalized.ledgerStatus === "Completed" ? today : undefined,
                paid_amount: normalized.ledgerStatus === "Completed" ? amount : 0,
                remarks: `[NCHL STATUS SYNC ${today}] ${normalized.label}${gatewayDesc ? `: ${gatewayDesc}` : ""}`,
                reversal_reason:
                  normalized.gatewayStatus === "FAILED"
                    ? gatewayDesc || normalized.label
                    : undefined,
              });
            }
          }
        } catch {
          // Leave in current ledger state if gateway inquiry timed out or is temporarily unreachable
        }
      }
    }

    const effectiveBatchId = input.batchId || targetPayments[0]?.batch_id || null;
    let syncRes: any = null;
    if (syncUpdates.length > 0 || effectiveBatchId) {
      const { data: rpcData, error: rpcErr } = await (supabaseAdmin as any).rpc(
        "sync_connectips_payment_results",
        {
          p_batch_id: effectiveBatchId,
          p_updates: syncUpdates,
          p_user_id: context.userId,
        },
      );
      if (rpcErr) {
        throw new Error(`Failed to synchronize ConnectIPS payment statuses: ${rpcErr.message}`);
      }
      syncRes = rpcData;
    }

    // Re-read updated target payment states
    const ids = targetPayments.map((p) => p.id);
    const { data: refreshed } = await adminDb.from("payments").select("*").in("id", ids);
    const latest = refreshed && refreshed.length > 0 ? refreshed : targetPayments;

    const settled = latest.filter(
      (p: any) => p.status === "Completed" || p.status === "Paid",
    ).length;
    const processing = latest.filter((p: any) => p.status === "Processing").length;
    const pending = latest.filter((p: any) => p.status === "Pending").length;
    const failed = latest.filter(
      (p: any) => p.status === "Failed" || p.status === "Rejected",
    ).length;
    const returned = latest.filter(
      (p: any) => p.status === "Returned" || p.status === "Reversed",
    ).length;

    const primary = latest[0];
    const normalizedPrimary = normalizeNchlStatus(primary?.status, primary?.remarks);
    const refId =
      primary?.connectips_ref ||
      primary?.payment_reference ||
      input.referenceId ||
      input.paymentId ||
      input.batchId ||
      "BATCH";

    const message = input.batchId
      ? `Synced ${latest.length} payment(s): ${settled} completed, ${processing} processing, ${pending} pending, ${failed} failed, ${returned} returned.`
      : normalizedPrimary.gatewayStatus === "SUCCESS"
        ? `Transaction ${refId} settled successfully (${normalizedPrimary.ledgerStatus}).`
        : normalizedPrimary.ledgerStatus === "Processing"
          ? `Transaction ${refId} is Processing in NCHL clearing. Awaiting final bank confirmation.`
          : normalizedPrimary.gatewayStatus === "FAILED"
            ? `Transaction ${refId} is marked ${normalizedPrimary.ledgerStatus}: ${primary?.remarks || "Gateway rejected or returned"}.`
            : `Transaction ${refId} status is currently ${primary?.status || "Pending"}.`;

    return {
      success: true,
      status: normalizedPrimary.gatewayStatus,
      ledgerStatus: normalizedPrimary.ledgerStatus,
      refId,
      batchStatus: (syncRes?.batch_status as string | null) ?? null,
      totalChecked: latest.length,
      settled,
      processing,
      pending,
      failed,
      returned,
      synced: syncUpdates.length > 0,
      message,
    };
  });
