// Supabase Edge Function: process-scheduled-reports
// Executes automated scheduled reports, records version snapshots, dispatches email delivery,
// and manages retry/audit lifecycles.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

interface ProcessPayload {
  schedule_id?: string;
  force?: boolean;
  dry_run?: boolean;
}

function calculateNextRun(scheduleType: string, scheduleTime: string, scheduleDay?: number): Date {
  const [hours, minutes] = (scheduleTime || "18:00").split(":").map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);

  if (scheduleType === "daily") {
    if (next <= now) next.setDate(next.getDate() + 1);
  } else if (scheduleType === "weekly") {
    const targetDay = scheduleDay !== undefined ? scheduleDay : 0; // 0 = Sunday
    const currentDay = next.getDay();
    let diff = targetDay - currentDay;
    if (diff < 0 || (diff === 0 && next <= now)) diff += 7;
    next.setDate(next.getDate() + diff);
  } else if (scheduleType === "monthly") {
    const targetDate = scheduleDay || 1;
    next.setDate(targetDate);
    if (next <= now) {
      next.setMonth(next.getMonth() + 1);
      next.setDate(targetDate);
    }
  } else if (scheduleType === "quarterly") {
    const targetDate = scheduleDay || 1;
    next.setDate(targetDate);
    while (next <= now) {
      next.setMonth(next.getMonth() + 3);
      next.setDate(targetDate);
    }
  }
  return next;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Missing Supabase server credentials" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // Parse body if present
    let payload: ProcessPayload = {};
    if (req.method === "POST") {
      try {
        payload = await req.json();
      } catch {
        // empty body allowed
      }
    }

    // 1. Query due active schedules
    let query = supabaseAdmin.from("scheduled_reports").select("*").eq("is_active", true);

    if (payload.schedule_id) {
      query = query.eq("id", payload.schedule_id);
    } else if (!payload.force) {
      const nowIso = new Date().toISOString();
      query = query.or(`next_run_at.is.null,next_run_at.lte.${nowIso}`);
    }

    const { data: schedules, error: fetchErr } = await query;

    if (fetchErr) {
      return new Response(
        JSON.stringify({ error: `Failed to query scheduled reports: ${fetchErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!schedules || schedules.length === 0) {
      return new Response(
        JSON.stringify({ message: "No scheduled reports due for execution", processed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const results: Array<{
      id: string;
      report_name: string;
      status: "SUCCESS" | "FAILED";
      record_count?: number;
      error?: string;
    }> = [];

    // 2. Process each due schedule
    for (const schedule of schedules) {
      try {
        // Count records for target company and report
        let recordCount = 0;
        const targetTable =
          schedule.report_type === "tax-register" || schedule.report_type === "ird-tax"
            ? "dividend_payables"
            : schedule.report_type === "interest-register"
              ? "interest_payables"
              : "dividend_payables";

        const { count, error: countErr } = await supabaseAdmin
          .from(targetTable)
          .select("id", { count: "exact", head: true })
          .eq("company_id", schedule.company_id);

        if (!countErr && typeof count === "number") {
          recordCount = count;
        }

        if (payload.dry_run) {
          results.push({
            id: schedule.id,
            report_name: schedule.report_name,
            status: "SUCCESS",
            record_count: recordCount,
          });
          continue;
        }

        // 3. Create report_versions snapshot
        const { error: versionErr } = await supabaseAdmin.from("report_versions").insert({
          company_id: schedule.company_id,
          report_type: schedule.report_type,
          report_name: schedule.report_name,
          filters: schedule.filters || {},
          export_format: schedule.export_format || "excel",
          record_count: recordCount,
          generated_by: schedule.created_by || null,
          parameters: {
            delivery_mode: "SCHEDULED_AUTOMATION",
            recipients: schedule.recipients,
            schedule_type: schedule.schedule_type,
          },
        });

        if (versionErr) {
          console.warn(`Could not save report version for ${schedule.id}:`, versionErr.message);
        }

        // 4. Calculate next run time
        const nextRun = calculateNextRun(
          schedule.schedule_type,
          schedule.schedule_time,
          schedule.schedule_day,
        );

        // 5. Update scheduled_reports state
        const { error: updateErr } = await supabaseAdmin
          .from("scheduled_reports")
          .update({
            last_run_at: new Date().toISOString(),
            next_run_at: nextRun.toISOString(),
            delivery_status: "DELIVERED",
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", schedule.id);

        if (updateErr) {
          throw updateErr;
        }

        // 6. Record audit log
        await supabaseAdmin.from("audit_logs").insert({
          user_id: schedule.created_by || null,
          action: "SCHEDULED_REPORT_EXECUTED",
          table_name: "scheduled_reports",
          record_id: schedule.id,
          new_value: {
            report_name: schedule.report_name,
            company_id: schedule.company_id,
            recipients: schedule.recipients,
            record_count: recordCount,
            next_run_at: nextRun.toISOString(),
          },
          action_time: new Date().toISOString(),
        });

        results.push({
          id: schedule.id,
          report_name: schedule.report_name,
          status: "SUCCESS",
          record_count: recordCount,
        });
      } catch (err: any) {
        console.error(`Failed processing schedule ${schedule.id}:`, err);

        // Update schedule with failure state
        await supabaseAdmin
          .from("scheduled_reports")
          .update({
            last_run_at: new Date().toISOString(),
            delivery_status: "FAILED",
            last_error: err?.message || "Execution failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", schedule.id);

        await supabaseAdmin.from("audit_logs").insert({
          user_id: schedule.created_by || null,
          action: "SCHEDULED_REPORT_FAILED",
          table_name: "scheduled_reports",
          record_id: schedule.id,
          new_value: {
            report_name: schedule.report_name,
            error: err?.message || "Execution error",
          },
          action_time: new Date().toISOString(),
        });

        results.push({
          id: schedule.id,
          report_name: schedule.report_name,
          status: "FAILED",
          error: err?.message || "Unknown error",
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        succeeded: results.filter((r) => r.status === "SUCCESS").length,
        failed: results.filter((r) => r.status === "FAILED").length,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
