// Supabase Edge Function — send-sms
// Supports multiple SMS gateways via configurable HTTP API
// Compatible with: Sparrow SMS (Nepal), Aakash SMS, or any HTTP SMS provider
// Deploy: supabase functions deploy send-sms

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-send-token",
};

interface SmsPayload {
  to: string | string[]; // Phone numbers with country code e.g. +977-9800000000
  message: string;
}

async function sendViaSparrowSMS(
  token: string,
  from: string,
  to: string,
  message: string,
): Promise<void> {
  const url = `https://api.sparrowsms.com/v2/sms/?token=${token}&from=${from}&to=${to}&text=${encodeURIComponent(message)}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`Sparrow SMS error: ${res.status} ${await res.text()}`);
}

async function sendViaGenericHTTP(
  apiUrl: string,
  apiKey: string,
  to: string,
  message: string,
): Promise<void> {
  // Generic HTTP POST gateway (many providers use this format)
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ to, message }),
  });
  if (!res.ok) throw new Error(`SMS gateway error: ${res.status} ${await res.text()}`);
}

async function isAuthorized(req: Request): Promise<boolean> {
  // 1. Check x-send-token if configured
  const sendToken = Deno.env.get("SEND_SMS_TOKEN") || Deno.env.get("SEND_EMAIL_TOKEN");
  const provided = req.headers.get("x-send-token") || "";
  if (sendToken && provided && provided.length === sendToken.length) {
    let diff = 0;
    for (let i = 0; i < sendToken.length; i++) diff |= provided.charCodeAt(i) ^ sendToken.charCodeAt(i);
    if (diff === 0) return true;
  }

  // 2. Check Bearer token with Supabase Auth
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && supabaseAnonKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { data, error } = await supabase.auth.getUser(token);
        if (!error && data?.user) return true;
      } catch {
        // Fall through
      }
    }
  }

  // 3. Backward-compatibility: if no sendToken configured and in local development, allow
  const isDev = !Deno.env.get("DENO_DEPLOYMENT_ID");
  if (!sendToken && isDev) {
    return true;
  }

  return false;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authorized = await isAuthorized(req);
    if (!authorized) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload: SmsPayload = await req.json();
    const gateway = Deno.env.get("SMS_GATEWAY") || "sparrow"; // 'sparrow' | 'generic'
    const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];

    for (const recipient of recipients) {
      if (gateway === "sparrow") {
        const token = Deno.env.get("SMS_API_KEY") || "";
        const from = Deno.env.get("SMS_FROM") || "RTARTS";
        if (!token) throw new Error("SMS_API_KEY not configured.");
        await sendViaSparrowSMS(token, from, recipient, payload.message);
      } else {
        const apiUrl = Deno.env.get("SMS_GATEWAY_URL") || "";
        const apiKey = Deno.env.get("SMS_API_KEY") || "";
        if (!apiUrl) throw new Error("SMS_GATEWAY_URL not configured.");
        await sendViaGenericHTTP(apiUrl, apiKey, recipient, payload.message);
      }
    }

    return new Response(JSON.stringify({ success: true, sent_to: recipients.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("SMS send error:", error);
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
