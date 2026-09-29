import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import nodemailer from "nodemailer";

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
    throw new Error("You need administrator privileges to manage email settings.");
  }
}

export interface SendTestEmailInput {
  to: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  smtp_pass?: string;
  smtp_from?: string;
}

export interface SendTestEmailResult {
  success: boolean;
  message: string;
  details?: {
    host: string;
    port: number;
    user: string;
    from: string;
    messageId?: string;
  };
}

export const sendTestEmailServerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: SendTestEmailInput) => data)
  .handler(async ({ data: input, context }): Promise<SendTestEmailResult> => {
    await assertAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Fetch existing settings to support testing with stored credentials
    const { data: row } = await supabaseAdmin
      .from("system_settings")
      .select("setting_value")
      .eq("setting_key", "global")
      .maybeSingle();

    const existing = (row?.setting_value as Record<string, any>) || {};

    const host = (input.smtp_host || existing.smtp_host || "").trim();
    const port = Number(input.smtp_port || existing.smtp_port || 587);
    const user = (
      input.smtp_user !== undefined ? input.smtp_user : (existing.smtp_user ?? "")
    ).trim();
    const pass =
      input.smtp_pass && input.smtp_pass !== "••••••••••••"
        ? input.smtp_pass
        : existing.smtp_pass || "";
    const from = (input.smtp_from || existing.smtp_from || user || "noreply@rtarts.com").trim();
    const to = (input.to || "").trim();

    if (!to || !to.includes("@")) {
      throw new Error("A valid recipient email address is required.");
    }

    if (!host) {
      throw new Error("SMTP Host is not configured. Please enter an SMTP host.");
    }

    const isSecure = port === 465;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: isSecure,
      auth: user || pass ? { user, pass } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      tls: {
        rejectUnauthorized: false,
      },
    });

    try {
      // 1. Verify SMTP connection & authentication
      await transporter.verify();

      // 2. Send test email
      const info = await transporter.sendMail({
        from: from.includes("<") ? from : `RTARTS System <${from}>`,
        to,
        subject: "RTARTS System - SMTP Test Email",
        text: `RTARTS System SMTP Test\n\nHost: ${host}:${port}\nUser: ${user || "(none)"}\nTimestamp: ${new Date().toISOString()}\n\nIf you received this email, outgoing SMTP delivery is functioning correctly.`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
            <div style="margin-bottom: 20px; border-bottom: 2px solid #4f46e5; padding-bottom: 12px;">
              <h2 style="color: #1e293b; margin: 0; font-size: 20px;">RTARTS System</h2>
              <p style="color: #64748b; margin: 4px 0 0 0; font-size: 13px;">RBB Merchant Banking Limited</p>
            </div>
            <p style="font-size: 15px; color: #334155; line-height: 1.5;">
              This is a test email sent to verify that the outgoing SMTP configuration is configured properly.
            </p>
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px; margin: 20px 0; font-size: 13px; color: #475569;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 3px 0; font-weight: 600; width: 100px;">SMTP Host:</td><td>${host}:${port}</td></tr>
                <tr><td style="padding: 3px 0; font-weight: 600;">Username:</td><td>${user || "(none)"}</td></tr>
                <tr><td style="padding: 3px 0; font-weight: 600;">Sender:</td><td>${from}</td></tr>
                <tr><td style="padding: 3px 0; font-weight: 600;">Timestamp:</td><td>${new Date().toISOString()}</td></tr>
              </table>
            </div>
            <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 12px; margin-top: 20px;">
              <p style="margin: 0; color: #065f46; font-size: 13px; font-weight: 600;">
                ✓ Verification Successful: SMTP connection and email delivery confirmed.
              </p>
            </div>
          </div>
        `,
      });

      return {
        success: true,
        message: `Test email sent successfully to ${to}`,
        details: {
          host,
          port,
          user,
          from,
          messageId: info.messageId,
        },
      };
    } catch (err: any) {
      const code = err.code || "";
      let message = err.message || "Failed to send test email";

      if (code === "EAUTH") {
        message = `SMTP Authentication failed: Invalid username or password for ${user || "host"}.`;
      } else if (code === "ECONNREFUSED") {
        message = `Connection refused: Unable to connect to SMTP host ${host}:${port}. Please verify the server address and port.`;
      } else if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
        message = `Connection timed out: SMTP host ${host}:${port} did not respond within 15 seconds.`;
      } else if (code === "ENOTFOUND") {
        message = `Host not found: Could not resolve SMTP host "${host}". Please verify the hostname.`;
      }

      throw new Error(message);
    }
  });
