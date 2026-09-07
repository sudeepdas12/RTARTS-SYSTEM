import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export interface RecordLoginAttemptPayload {
  email: string;
  userId?: string | null;
  status: "success" | "failed";
  failureReason?: string | null;
  browser?: string;
  device?: string;
  userAgent?: string;
}

/**
 * Server-side trusted login attempt recorder.
 * Bypasses RLS using the service-role client on the server, extracting
 * authentic IP address from request headers rather than client-reported hostnames.
 */
export const recordLoginAttemptServerFn = createServerFn({ method: "POST" })
  .validator((data: RecordLoginAttemptPayload) => data)
  .handler(async ({ data }) => {
    try {
      const request = getRequest();
      const headers = request?.headers;

      const rawForwarded = headers?.get("x-forwarded-for");
      const clientIp =
        headers?.get("cf-connecting-ip") ||
        (rawForwarded ? rawForwarded.split(",")[0].trim() : null) ||
        headers?.get("x-real-ip") ||
        "127.0.0.1";

      const resolvedUserAgent =
        headers?.get("user-agent") || data.userAgent || "Unknown";

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const insertData = {
        email: data.email.trim().toLowerCase(),
        user_id: data.userId || null,
        login_status: data.status,
        failure_reason: data.failureReason || null,
        browser: data.browser || "Unknown",
        device: data.device || "Unknown",
        user_agent: resolvedUserAgent,
        ip_address: clientIp,
        login_time: new Date().toISOString(),
      };

      const { error } = await (supabaseAdmin as any).from("login_logs").insert(insertData);
      if (error) {
        console.warn("[Audit] Failed to record login attempt:", error.message);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err: any) {
      console.warn("[Audit] Server error recording login attempt:", err?.message || err);
      return { success: false, error: err?.message };
    }
  });
