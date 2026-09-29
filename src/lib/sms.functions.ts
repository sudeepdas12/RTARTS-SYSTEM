import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SmsBroadcastService } from "@/lib/services/sms-broadcast.service";

async function assertAdmin(context: { supabase: any; userId: string }) {
  try {
    const { data, error } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });

    if (!error && data === true) {
      return;
    }
  } catch {
    // Fall back to direct query
  }

  const { data: roleRow } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();

  if (!roleRow) {
    throw new Error("You need administrator privileges to test SMS settings.");
  }
}

export interface SendTestSmsInput {
  phone: string;
  provider?: "sparrow" | "aakash" | "smstonepal" | "custom";
  gateway_url?: string;
  sender_id?: string;
  api_key?: string;
}

export interface SendTestSmsResult {
  success: boolean;
  message: string;
  details?: {
    phone: string;
    provider: string;
    senderId: string;
    response?: string;
  };
}

export const sendTestSmsServerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: SendTestSmsInput) => data)
  .handler(async ({ data: input, context }): Promise<SendTestSmsResult> => {
    await assertAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Fetch existing settings to support testing with stored credentials
    const { data: row } = await supabaseAdmin
      .from("system_settings")
      .select("setting_value")
      .eq("setting_key", "global")
      .maybeSingle();

    const existing = (row?.setting_value as Record<string, any>) || {};

    const phoneValidation = SmsBroadcastService.sanitizeNepalPhone(input.phone);
    if (!phoneValidation.isValid) {
      throw new Error(
        "Invalid Nepali mobile number. Please enter a 10-digit number starting with 98, 97, or 96.",
      );
    }

    const provider = input.provider || existing.sms_provider || "sparrow";
    const gatewayUrl = (input.gateway_url || existing.sms_gateway_url || "").trim();
    const senderId = (input.sender_id || existing.sms_sender_id || "RBBMBL").trim();
    const apiKey =
      input.api_key && input.api_key !== "••••••••••••"
        ? input.api_key
        : existing.sms_api_key || "";

    if (!gatewayUrl) {
      throw new Error(
        "SMS Gateway URL is required. Please select a provider or enter a valid URL.",
      );
    }

    if (!apiKey) {
      throw new Error(
        "SMS API Token / Key is required. Please enter an API key for your SMS gateway.",
      );
    }

    const messageText = `RTARTS System Test: Outgoing SMS delivery verified for ${phoneValidation.cleanPhone}. Sender: ${senderId}. Ref: ${Date.now().toString().slice(-6)}`;

    // Dispatch to SMS Gateway
    try {
      let responseText = "";
      if (provider === "sparrow") {
        const params = new URLSearchParams({
          token: apiKey,
          from: senderId,
          to: phoneValidation.cleanPhone,
          text: messageText,
        });

        const res = await fetch(gatewayUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        responseText = await res.text();
        if (!res.ok) {
          throw new Error(`Sparrow SMS Gateway returned HTTP ${res.status}: ${responseText}`);
        }
      } else if (provider === "aakash") {
        const res = await fetch(gatewayUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth_token: apiKey,
            to: phoneValidation.cleanPhone,
            text: messageText,
          }),
        });
        responseText = await res.text();
        if (!res.ok) {
          throw new Error(`Aakash SMS Gateway returned HTTP ${res.status}: ${responseText}`);
        }
      } else {
        // Generic / Custom Webhook
        const res = await fetch(gatewayUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "x-api-key": apiKey,
          },
          body: JSON.stringify({
            to: phoneValidation.cleanPhone,
            text: messageText,
            sender: senderId,
          }),
        });
        responseText = await res.text();
        if (!res.ok) {
          throw new Error(`SMS Gateway returned HTTP ${res.status}: ${responseText}`);
        }
      }

      return {
        success: true,
        message: `Test SMS dispatched successfully to ${phoneValidation.cleanPhone}`,
        details: {
          phone: phoneValidation.cleanPhone,
          provider,
          senderId,
          response: responseText.slice(0, 200),
        },
      };
    } catch (err: any) {
      throw new Error(err.message || "Failed to communicate with SMS gateway.");
    }
  });
