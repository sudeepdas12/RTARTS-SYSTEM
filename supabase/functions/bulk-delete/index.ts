// Edge Function for bulk delete operations
// Requires authenticated user with admin role

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DeletePayload {
  table: string;
  filters: { field: string; value: string }[];
}

const ALLOWED_TABLES = new Set([
  "dividend_payables",
  "interest_payables",
  "mutual_fund_payables",
  "payments",
  "payment_batches",
  "reconciliation_results",
  "clients",
  "companies",
  "iaf_allocations",
  "upload_history",
  "upload_errors",
  "bank_transactions",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authentication Guard
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");

    if (!token) {
      return new Response(JSON.stringify({ success: false, error: "Missing authorization token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ success: false, error: "Invalid or expired session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Role Guard: must be admin
    const { data: roleRow, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError || !roleRow) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized: administrator privileges required" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const payload: { operations: DeletePayload[] } = await req.json();
    if (!payload?.operations || !Array.isArray(payload.operations)) {
      return new Response(JSON.stringify({ success: false, error: "Invalid operations payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: { table: string; deleted: number; error?: string }[] = [];

    for (const op of payload.operations) {
      try {
        if (!ALLOWED_TABLES.has(op.table)) {
          results.push({ table: op.table, deleted: 0, error: `Table '${op.table}' is not permitted for deletion.` });
          continue;
        }

        // Count matching rows first
        let countQuery = supabase.from(op.table as any).select("*", { count: "exact", head: true });
        for (const f of op.filters) {
          countQuery = (countQuery as any).eq(f.field, f.value);
        }
        const beforeRes = await countQuery;
        const beforeCount = (beforeRes as any).count ?? 0;

        if (beforeCount === 0) {
          results.push({ table: op.table, deleted: 0 });
          continue;
        }

        // Execute delete
        let deleteQuery = supabase.from(op.table as any).delete();
        for (const f of op.filters) {
          deleteQuery = (deleteQuery as any).eq(f.field, f.value);
        }
        const { error: delErr } = await deleteQuery;

        if (delErr) {
          results.push({ table: op.table, deleted: 0, error: delErr.message });
          continue;
        }

        results.push({ table: op.table, deleted: beforeCount });
      } catch (tableErr: any) {
        results.push({ table: op.table, deleted: 0, error: tableErr.message });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
