// Supabase Edge Function — send-sms
// Supports multiple SMS gateways via configurable HTTP API
// Compatible with: Sparrow SMS (Nepal), Aakash SMS, or any HTTP SMS provider
// Deploy: supabase functions deploy send-sms

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SmsPayload {
  to: string | string[];   // Phone numbers with country code e.g. +977-9800000000
  message: string;
}

async function sendViaSparrowSMS(token: string, from: string, to: string, message: string): Promise<void> {
  const url = `https://api.sparrowsms.com/v2/sms/?token=${token}&from=${from}&to=${to}&text=${encodeURIComponent(message)}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`Sparrow SMS error: ${res.status} ${await res.text()}`);
}

async function sendViaGenericHTTP(apiUrl: string, apiKey: string, to: string, message: string): Promise<void> {
  // Generic HTTP POST gateway (many providers use this format)
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ to, message }),
  });
  if (!res.ok) throw new Error(`SMS gateway error: ${res.status} ${await res.text()}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
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

    return new Response(
      JSON.stringify({ success: true, sent_to: recipients.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("SMS send error:", error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
