// Edge Function for ConnectIPS payload signing
// Requires authenticated user with payment/admin role (admin, finance_operator, supervisor, approver, maker)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ROLES = new Set(["admin", "finance_operator", "supervisor", "approver", "maker"]);

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowedOrigins = [
    Deno.env.get("APP_URL") || "",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
  ].filter(Boolean);

  const isAllowed = allowedOrigins.includes(origin) || allowedOrigins.includes("*");
  const allowOrigin = isAllowed ? origin : allowedOrigins[0] || "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

/**
 * Sign payload using NCHL standard SHA256withRSA (RSASSA-PKCS1-v1_5)
 * Expects a PKCS#8 private key in PEM format.
 */
async function signWithRsa(payloadStr: string, privateKeyPem: string): Promise<string> {
  const cleanPem = privateKeyPem
    .replace(/-----BEGIN[ A-Z0-9_-]+-----/g, "")
    .replace(/-----END[ A-Z0-9_-]+-----/g, "")
    .replace(/\s+/g, "");
  const binaryDer = Uint8Array.from(atob(cleanPem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const encoder = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(payloadStr),
  );
  return btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Authentication Guard
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");

    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing authorization token" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ success: false, error: "Invalid or expired session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Role Guard: must have payment/admin role
    const { data: roleRows, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);

    if (roleError || !roleRows || roleRows.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Unauthorized: payment authorization privileges required",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const hasAllowedRole = roleRows.some((r: { role: string }) => ALLOWED_ROLES.has(r.role));
    if (!hasAllowedRole) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Unauthorized: insufficient role to sign payment payloads",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 3. Payload validation (caller secretKey is strictly ignored / rejected)
    const { payloadStr } = await req.json();

    if (!payloadStr || typeof payloadStr !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "payloadStr is required and must be a string" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 4. Server-held signing
    // In production, NCHL ConnectIPS mandates SHA256withRSA digital signing using an NCHL-issued client certificate (.pfx/.p12 converted to PKCS#8 PEM).
    // The CONNECTIPS_TOKEN secret is supported as a fallback for sandbox testing.
    const privateKeyPem = Deno.env.get("CONNECTIPS_PRIVATE_KEY");
    const serverSecret = Deno.env.get("CONNECTIPS_TOKEN");

    if (!privateKeyPem && !serverSecret) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Neither CONNECTIPS_PRIVATE_KEY nor CONNECTIPS_TOKEN is configured in environment",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let signature: string;
    let algorithm: string;

    if (privateKeyPem) {
      signature = await signWithRsa(payloadStr, privateKeyPem);
      algorithm = "SHA256withRSA";
    } else {
      const encoder = new TextEncoder();
      const data = encoder.encode(`${payloadStr}:${serverSecret}`);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      signature = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      algorithm = "SHA-256-TOKEN";
    }

    return new Response(JSON.stringify({ success: true, signature, algorithm }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
