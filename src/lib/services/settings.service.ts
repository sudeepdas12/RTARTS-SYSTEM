import { supabase, throwIfError } from "./database";

export interface SystemSettings {
  enable_nepali_dates: boolean;
  dividend_tds_natural: number;
  dividend_tds_legal: number;
  interest_tds_natural: number;
  interest_tds_legal: number;
  require_maker_checker: boolean;
  require_final_approver: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_from: string;
  smtp_pass: string;
  smtp_pass_configured?: boolean;
  // SMS Gateway Settings
  sms_enabled?: boolean;
  sms_provider?: "sparrow" | "aakash" | "smstonepal" | "custom";
  sms_gateway_url: string;
  sms_sender_id?: string;
  sms_api_key: string;
  sms_api_key_configured?: boolean;
  // ConnectIPS Banking Gateway Settings
  connectips_enabled: boolean;
  connectips_mode: "SANDBOX" | "PRODUCTION";
  connectips_merchant_id: string;
  connectips_app_id: string;
  connectips_app_name: string;
  connectips_base_url: string;
  connectips_token: string;
  connectips_cert_pass: string;
}

const DEFAULT_SETTINGS: SystemSettings = {
  enable_nepali_dates: true,
  dividend_tds_natural: 5.0,
  dividend_tds_legal: 5.0,
  interest_tds_natural: 6.0,
  interest_tds_legal: 15.0,
  require_maker_checker: true,
  require_final_approver: false,
  smtp_host: "",
  smtp_port: 587,
  smtp_user: "",
  smtp_from: "",
  smtp_pass: "",
  sms_enabled: false,
  sms_provider: "sparrow",
  sms_gateway_url: "https://api.sparrowsms.com/v2/sms/",
  sms_sender_id: "RBBMBL",
  sms_api_key: "",
  connectips_enabled: false,
  connectips_mode: "SANDBOX",
  connectips_merchant_id: "",
  connectips_app_id: "",
  connectips_app_name: "RTARTS System",
  connectips_base_url: "https://uat.connectips.com:7443",
  connectips_token: "",
  connectips_cert_pass: "",
};

const SETTINGS_KEY = "global";
const SETTINGS_CACHE_TTL_MS = 30_000;
let cachedSettings: { settings: SystemSettings; at: number } | null = null;

export function invalidateSettingsCache(): void {
  cachedSettings = null;
}

export const SettingsService = {
  async getSettings(force = false): Promise<SystemSettings> {
    if (!force && cachedSettings && Date.now() - cachedSettings.at < SETTINGS_CACHE_TTL_MS) {
      return { ...cachedSettings.settings };
    }

    // Reads come from the safe view so the SMTP password is only visible to admins.
    const { data, error } = await (supabase as any)
      .from("system_settings_safe")
      .select("setting_value")
      .eq("setting_key", SETTINGS_KEY)
      .maybeSingle();

    if (error) {
      console.warn("Could not load settings, using defaults:", error.message);
      return DEFAULT_SETTINGS;
    }

    const rawVal = ((data?.setting_value as Partial<SystemSettings>) || {}) as any;
    const settings: SystemSettings = {
      ...DEFAULT_SETTINGS,
      ...rawVal,
      smtp_pass_configured: Boolean(rawVal.smtp_pass_configured || rawVal.smtp_pass),
      sms_api_key_configured: Boolean(rawVal.sms_api_key_configured || rawVal.sms_api_key),
    };

    // TDS rates are authoritative in `payable_tax_rules` (the table the DB
    // trigger, the import engine and classification-review all read). Always
    // present the REAL effective rates in the settings UI rather than a
    // duplicated copy that could silently diverge.
    try {
      const { data: rules } = await (supabase as any)
        .from("payable_tax_rules")
        .select("payable_category, payee_classification, tax_rate")
        .eq("is_active", true);

      const ratePct = (category: string, classification: string): number | null => {
        const hit = (rules ?? []).find(
          (r: any) => r.payable_category === category && r.payee_classification === classification,
        );
        return hit?.tax_rate != null ? Number(hit.tax_rate) * 100 : null;
      };

      const mappings: Array<[keyof SystemSettings, string, string]> = [
        ["dividend_tds_natural", "DIVIDEND", "NATURAL_PERSON"],
        ["dividend_tds_legal", "DIVIDEND", "COMPANY_INSTITUTION"],
        ["interest_tds_natural", "INTEREST", "NATURAL_PERSON"],
        ["interest_tds_legal", "INTEREST", "COMPANY_INSTITUTION"],
      ];
      for (const [key, category, classification] of mappings) {
        const pct = ratePct(category, classification);
        // The four mapped keys are all numeric SystemSettings fields.
        if (pct != null) (settings as any)[key] = pct;
      }
    } catch (e) {
      console.warn(
        "Could not load TDS rules from payable_tax_rules; using stored/default values.",
        e,
      );
    }

    // SECURITY: never expose stored secrets to the browser/client.
    settings.smtp_pass = "";
    settings.sms_api_key = "";

    cachedSettings = { settings: { ...settings }, at: Date.now() };
    return settings;
  },

  async saveSettings(settings: SystemSettings): Promise<void> {
    invalidateSettingsCache();

    // 1) Atomically save settings using safe DB RPC which automatically preserves
    // existing secrets (smtp_pass, connectips_token, connectips_cert_pass, sms_api_key)
    // when empty or placeholder values are passed from the UI.
    const resolved = { ...settings };
    const { error: rpcError } = await (supabase as any).rpc("save_system_settings_global", {
      p_settings: resolved,
    });

    if (rpcError) {
      // Fallback to direct upsert if RPC is unavailable
      const { data: existing } = await (supabase as any)
        .from("system_settings")
        .select("setting_value")
        .eq("setting_key", SETTINGS_KEY)
        .maybeSingle();

      const existingVal = (existing?.setting_value as Partial<SystemSettings> | undefined) || {};
      if (!settings.smtp_pass || settings.smtp_pass === "••••••••••••") {
        resolved.smtp_pass = existingVal.smtp_pass ?? "";
      }
      if (!settings.connectips_token || settings.connectips_token === "••••••••••••") {
        resolved.connectips_token = existingVal.connectips_token ?? "";
      }
      if (!settings.connectips_cert_pass || settings.connectips_cert_pass === "••••••••••••") {
        resolved.connectips_cert_pass = existingVal.connectips_cert_pass ?? "";
      }
      if (!settings.sms_api_key || settings.sms_api_key === "••••••••••••") {
        resolved.sms_api_key = existingVal.sms_api_key ?? "";
      }

      const { error } = await (supabase as any).from("system_settings").upsert(
        {
          setting_key: SETTINGS_KEY,
          setting_value: resolved as any,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "setting_key" },
      );
      throwIfError(error, "Failed to save settings");
    }

    // Persist the four TDS rates into `payable_tax_rules` so the settings page
    // is the single entry point that actually drives imports, the DB trigger
    // and reports — no more disconnected duplicate.
    const tdsUpdates: Array<[string, string, number]> = [
      ["DIVIDEND", "NATURAL_PERSON", Number(settings.dividend_tds_natural) / 100],
      ["DIVIDEND", "COMPANY_INSTITUTION", Number(settings.dividend_tds_legal) / 100],
      ["INTEREST", "NATURAL_PERSON", Number(settings.interest_tds_natural) / 100],
      ["INTEREST", "COMPANY_INSTITUTION", Number(settings.interest_tds_legal) / 100],
    ];
    for (const [category, classification, rawRate] of tdsUpdates) {
      const safeRate = Math.max(0, Math.min(1, Number(rawRate) || 0));
      const { error: ruleErr } = await (supabase as any)
        .from("payable_tax_rules")
        .update({ tax_rate: safeRate, updated_at: new Date().toISOString() })
        .eq("payable_category", category)
        .eq("payee_classification", classification);
      if (ruleErr) {
        // Surface the failure — otherwise TDS changes would silently not apply.
        throwIfError(ruleErr, `Failed to save TDS rate for ${category} / ${classification}`);
      }
    }
  },

  async sendTestEmail(
    to: string,
    overrides?: Partial<SystemSettings>,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const { sendTestEmailServerFn } = await import("@/lib/email.functions");
      const res = await sendTestEmailServerFn({
        data: {
          to,
          smtp_host: overrides?.smtp_host,
          smtp_port: overrides?.smtp_port,
          smtp_user: overrides?.smtp_user,
          smtp_pass: overrides?.smtp_pass,
          smtp_from: overrides?.smtp_from,
        },
      });
      return res;
    } catch (serverErr: any) {
      // If error is an explicit SMTP or validation error, throw immediately
      if (
        serverErr?.message &&
        !serverErr.message.includes("fetch failed") &&
        !serverErr.message.includes("Failed to fetch")
      ) {
        throw serverErr;
      }

      // Edge Function fallback if server function cannot connect to host
      const { error } = await (supabase as any).functions.invoke("send-email", {
        body: {
          to,
          subject: "RTARTS System - SMTP Test Email",
          text: "RTARTS System SMTP Test. If you received this, email sending is working correctly.",
          html:
            "<h2>RTARTS System</h2>" +
            "<p>This is a test email sent to verify that the SMTP configuration is working correctly.</p>" +
            "<p>If you received this, email sending is confirmed.</p>",
        },
      });
      if (error)
        throw new Error(
          (error as Error).message || serverErr?.message || "Failed to send test email",
        );
      return { success: true, message: `Test email sent successfully to ${to}` };
    }
  },

  async sendTestSms(
    phone: string,
    overrides?: Partial<SystemSettings>,
  ): Promise<{ success: boolean; message: string }> {
    const { sendTestSmsServerFn } = await import("@/lib/sms.functions");
    return sendTestSmsServerFn({
      data: {
        phone,
        provider: overrides?.sms_provider,
        gateway_url: overrides?.sms_gateway_url,
        sender_id: overrides?.sms_sender_id,
        api_key: overrides?.sms_api_key,
      },
    });
  },
};
