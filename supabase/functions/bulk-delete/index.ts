// Edge Function for bulk delete operations
// Uses service_role key to bypass RLS

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface DeletePayload {
  table: string;
  filters: { field: string; value: string }[];
}

serve(async (req) => {
  try {
    const payload: { operations: DeletePayload[] } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const results: { table: string; deleted: number; error?: string }[] = [];

    for (const op of payload.operations) {
      try {
        // Count matching rows first
        let countQuery = supabase
          .from(op.table as any)
          .select("*", { count: "exact", head: true });
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
        let deleteQuery = supabase
          .from(op.table as any)
          .delete();
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
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});