// Edge Function for ConnectIPS payload signing
// Requires authenticated user with payment/admin role (admin, finance_operator, supervisor, approver, maker)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ROLES = new Set(["admin", "finance_operator", "supervisor", "approver", "maker"]);

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
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

    // 4. Server-held secret signing
    // NOTE (NCHL Spec): In production, NCHL ConnectIPS mandates SHA256withRSA
    // digital signing using an NCHL-issued client certificate (.pfx/.p12).
    // The CONNECTIPS_TOKEN secret is used for token-based authentication and sandbox testing.
    const serverSecret = Deno.env.get("CONNECTIPS_TOKEN");
    if (!serverSecret) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "CONNECTIPS_TOKEN server secret is not configured in environment",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(`${payloadStr}:${serverSecret}`);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const signature = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    return new Response(JSON.stringify({ success: true, signature }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
