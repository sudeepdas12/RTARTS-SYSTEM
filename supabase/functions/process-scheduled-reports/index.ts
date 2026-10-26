// Supabase Edge Function: process-scheduled-reports
// Executes automated scheduled reports, records version snapshots, dispatches email delivery,
// and manages retry/audit lifecycles with strict authentication and multi-tenant isolation.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function getCorsHeaders(req: Request) {
  const allowedOrigin = Deno.env.get("APP_URL") || "";
  const requestOrigin = req.headers.get("origin") || "";
  const isAllowed = Boolean(allowedOrigin && requestOrigin === allowedOrigin);

  return {
    "Access-Control-Allow-Origin": isAllowed ? requestOrigin : "null",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

interface ProcessPayload {
  schedule_id?: string;
  force?: boolean;
  dry_run?: boolean;
}

function constantTimeCompare(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
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
  const corsHeaders = getCorsHeaders(req);

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

  // 1. Enforce Authentication (constant-time x-cron-secret check OR authenticated JWT with RBAC)
  // Hardcoded fallback removed: an injected secret is strictly required for scheduler access.
  let cronSecret = (Deno.env.get("CRON_SECRET") || Deno.env.get("X_CRON_SECRET") || "").trim();
  if (!cronSecret) {
    try {
      const { data: dbSecret } = await supabaseAdmin.rpc("get_cron_secret");
      if (typeof dbSecret === "string") {
        cronSecret = dbSecret.trim();
      }
    } catch {
      // Database secret lookup fallback
    }
  }

  const providedCronSecret = (req.headers.get("x-cron-secret") || "").trim();
  const isCronAuthorized = Boolean(
    cronSecret && providedCronSecret && constantTimeCompare(providedCronSecret, cronSecret),
  );

  let authenticatedUserId: string | null = null;
  let isPrivilegedUser = false;

  if (!isCronAuthorized) {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized: Missing x-cron-secret or Bearer authorization header",
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !authData?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid authentication credentials" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    authenticatedUserId = authData.user.id;

    // Retrieve user roles for RBAC
    const { data: userRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", authenticatedUserId);

    const roles = (userRoles || []).map((r: { role: string }) => r.role);
    isPrivilegedUser = roles.includes("admin") || roles.includes("supervisor");
  }

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

    // 2. Validate multi-tenant access for manual requests
    if (!isCronAuthorized) {
      if (payload.schedule_id) {
        const { data: targetSchedule } = await supabaseAdmin
          .from("scheduled_reports")
          .select("company_id")
          .eq("id", payload.schedule_id)
          .maybeSingle();

        if (!targetSchedule) {
          return new Response(JSON.stringify({ error: "Schedule not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (!isPrivilegedUser) {
          const { data: hasAccess } = await supabaseAdmin.rpc("has_company_access", {
            p_user_id: authenticatedUserId,
            p_company_id: targetSchedule.company_id,
          });

          if (!hasAccess) {
            return new Response(
              JSON.stringify({
                error: "Forbidden: Caller does not have access to schedule company",
              }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }
      } else {
        // Bulk manual invocation of all active schedules requires admin or supervisor
        if (!isPrivilegedUser) {
          return new Response(
            JSON.stringify({
              error:
                "Forbidden: Bulk execution of scheduled reports requires admin or supervisor role",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    }

    // 3. Query due active schedules
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
      delivery_status?: string;
      error?: string;
    }> = [];

    // 4. Process each due schedule
    for (const schedule of schedules) {
      try {
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
            delivery_status: "DRY_RUN",
          });
          continue;
        }

        // 5. Generate actual report file artifact from database records
        const { data: reportRecords } = await supabaseAdmin
          .from(targetTable)
          .select("*")
          .eq("company_id", schedule.company_id)
          .limit(2000);

        // Helper to format rows into standard RFC 4180 CSV
        const formatAsCsv = (records: Record<string, unknown>[]): string => {
          if (!records || records.length === 0) return "No records found\r\n";
          const keys = Object.keys(records[0]);
          const escapeCell = (val: unknown): string => {
            if (val === null || val === undefined) return "";
            const str = typeof val === "object" ? JSON.stringify(val) : String(val);
            if (
              str.includes(",") ||
              str.includes('"') ||
              str.includes("\n") ||
              str.includes("\r")
            ) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          };
          const header = keys.map(escapeCell).join(",");
          const lines = records.map((row) => keys.map((k) => escapeCell(row[k])).join(","));
          return [header, ...lines].join("\r\n");
        };

        const fileContent = formatAsCsv(reportRecords || []);
        const fileBytes = new TextEncoder().encode(fileContent);
        const fileSize = fileBytes.byteLength;
        const requestedFormat = (schedule.export_format || "csv").toLowerCase();
        const fileExt =
          requestedFormat === "excel" || requestedFormat === "xlsx" ? "csv" : requestedFormat;
        const timestamp = Date.now();
        const storagePath = `${schedule.company_id}/${schedule.id}_${timestamp}.${fileExt}`;

        let signedFileUrl: string | null = null;
        try {
          const { error: uploadErr } = await supabaseAdmin.storage
            .from("reports")
            .upload(storagePath, fileBytes, {
              contentType: "text/csv",
              upsert: true,
            });

          if (!uploadErr) {
            const { data: signedData } = await supabaseAdmin.storage
              .from("reports")
              .createSignedUrl(storagePath, 60 * 60 * 24 * 7); // 7-day secure access link
            signedFileUrl = signedData?.signedUrl || null;
          } else {
            console.warn(`Storage upload warning for schedule ${schedule.id}:`, uploadErr.message);
          }
        } catch (storageErr: any) {
          console.warn(
            `Storage upload exception for schedule ${schedule.id}:`,
            storageErr?.message,
          );
        }

        const artifactSummary = {
          target_table: targetTable,
          total_records: recordCount,
          records_in_artifact: reportRecords?.length || 0,
          storage_path: storagePath,
          file_size_bytes: fileSize,
          generated_at: new Date().toISOString(),
        };

        // 6. Record report_versions row with durable file_url & file_size
        const { error: versionErr } = await supabaseAdmin.from("report_versions").insert({
          company_id: schedule.company_id,
          report_type: schedule.report_type,
          report_name: schedule.report_name,
          filters: schedule.filters || {},
          export_format: schedule.export_format || "excel",
          file_url: signedFileUrl,
          file_size: fileSize,
          record_count: recordCount,
          generated_by: authenticatedUserId || schedule.created_by || null,
          parameters: {
            delivery_mode: "SCHEDULED_AUTOMATION",
            recipients: schedule.recipients,
            schedule_type: schedule.schedule_type,
            artifact_summary: artifactSummary,
            storage_path: storagePath,
          },
        });

        if (versionErr) {
          console.warn(`Could not save report version for ${schedule.id}:`, versionErr.message);
        }

        // 7. Calculate next run timestamp
        const nextRun = calculateNextRun(
          schedule.schedule_type,
          schedule.schedule_time,
          schedule.schedule_day,
        );

        // 8. Attempt email dispatch using explicit x-send-token if recipients configured
        let deliveryStatus = "GENERATED";
        let deliveryNotes = "Report version generated and archived";

        const recipients = Array.isArray(schedule.recipients) ? schedule.recipients : [];
        if (recipients.length > 0) {
          try {
            const { data: settingsRow } = await supabaseAdmin
              .from("system_settings")
              .select("setting_value")
              .eq("setting_key", "global")
              .maybeSingle();

            const v = (settingsRow?.setting_value || {}) as Record<string, unknown>;
            const hasSmtp = Boolean(v.smtp_user && v.smtp_pass);

            if (hasSmtp) {
              const sendEmailToken = (
                Deno.env.get("SEND_EMAIL_TOKEN") ||
                Deno.env.get("X_SEND_TOKEN") ||
                ""
              ).trim();

              const emailHeaders: Record<string, string> = {
                Authorization: `Bearer ${serviceRoleKey}`,
                "Content-Type": "application/json",
              };
              if (sendEmailToken) {
                emailHeaders["x-send-token"] = sendEmailToken;
              }

              const downloadHtml = signedFileUrl
                ? `<div style="margin: 20px 0; padding: 16px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
                     <p style="margin: 0 0 12px 0; font-weight: 600; color: #1e293b;">Your report is compiled and ready to download:</p>
                     <a href="${signedFileUrl}" style="display: inline-block; background-color: #0f172a; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">
                       Download ${schedule.report_name} (${(fileSize / 1024).toFixed(1)} KB)
                     </a>
                     <p style="margin: 8px 0 0 0; font-size: 12px; color: #64748b;">This secure download link is valid for 7 days.</p>
                   </div>`
                : `<p style="color: #64748b;">Report data archived in system database.</p>`;

              const emailRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
                method: "POST",
                headers: emailHeaders,
                body: JSON.stringify({
                  to: recipients,
                  subject: `[RTARTS Automated Report] ${schedule.report_name}`,
                  html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
                      <h2 style="color: #0f172a; margin-top: 0;">Automated Report Delivery</h2>
                      <p><strong>Report:</strong> ${schedule.report_name}</p>
                      <p><strong>Type:</strong> ${schedule.report_type}</p>
                      <p><strong>Total Records:</strong> ${recordCount.toLocaleString()}</p>
                      <p><strong>Generated At:</strong> ${new Date().toUTCString()}</p>
                      ${downloadHtml}
                      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
                      <p style="font-size: 11px; color: #94a3b8; margin: 0;">This is an automated notification from the RBB Merchant Banking Limited RTARTS Management System.</p>
                    </div>
                  `,
                }),
              });

              if (emailRes.ok) {
                deliveryStatus = "DELIVERED";
                deliveryNotes = `Dispatched to ${recipients.join(", ")}`;
              } else {
                deliveryStatus = "GENERATED";
                deliveryNotes = `Generated; email service returned HTTP ${emailRes.status}`;
              }
            } else {
              deliveryStatus = "GENERATED";
              deliveryNotes = "Generated; SMTP credentials not configured";
            }
          } catch (e: any) {
            deliveryStatus = "GENERATED";
            deliveryNotes = `Generated; email dispatch error: ${e?.message}`;
          }
        }

        // 9. Update scheduled_reports state with GENERATED (or DELIVERED if sent)
        const { error: updateErr } = await supabaseAdmin
          .from("scheduled_reports")
          .update({
            last_run_at: new Date().toISOString(),
            next_run_at: nextRun.toISOString(),
            delivery_status: deliveryStatus,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", schedule.id);

        if (updateErr) {
          throw updateErr;
        }

        // 10. Record audit log
        await supabaseAdmin.from("audit_logs").insert({
          user_id: authenticatedUserId || schedule.created_by || null,
          action: "SCHEDULED_REPORT_EXECUTED",
          table_name: "scheduled_reports",
          record_id: schedule.id,
          new_value: {
            report_name: schedule.report_name,
            company_id: schedule.company_id,
            recipients: schedule.recipients,
            record_count: recordCount,
            delivery_status: deliveryStatus,
            delivery_notes: deliveryNotes,
            next_run_at: nextRun.toISOString(),
          },
          action_time: new Date().toISOString(),
        });

        results.push({
          id: schedule.id,
          report_name: schedule.report_name,
          status: "SUCCESS",
          record_count: recordCount,
          delivery_status: deliveryStatus,
        });
      } catch (err: any) {
        console.error(`Failed processing schedule ${schedule.id}:`, err);

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
          user_id: authenticatedUserId || schedule.created_by || null,
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
