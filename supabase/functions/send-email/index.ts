// Supabase Edge Function — send-email
// Sends email via SMTP using the SMTP configuration saved in System Settings
// (system_settings.global) with fallback to Edge Function secrets.
// Deploy: supabase functions deploy send-email

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-send-token",
};

interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

async function sendViaSMTP(config: SmtpConfig, payload: EmailPayload): Promise<void> {
  // Uses the Deno SMTP client — works with most SMTP providers.
  const { SMTPClient } = await import("https://deno.land/x/denomailer@1.6.0/mod.ts");

  const client = new SMTPClient({
    connection: {
      hostname: config.host,
      port: config.port,
      tls: config.port === 465,
      auth: {
        username: config.user,
        password: config.pass,
      },
    },
  });

  const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];

  for (const recipient of recipients) {
    await client.send({
      from: payload.from || config.from,
      to: recipient,
      subject: payload.subject,
      content: payload.text || "Please view this email in an HTML-capable email client.",
      html: payload.html,
    });
  }

  await client.close();
}

// Load SMTP settings from the saved web configuration (system_settings.global),
// falling back to Edge Function secrets for backward compatibility.
async function loadSmtpConfig(): Promise<SmtpConfig> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data } = await supabase
        .from("system_settings")
        .select("setting_value")
        .eq("setting_key", "global")
        .maybeSingle();

      const v = (data?.setting_value || {}) as Record<string, unknown>;
      return {
        host: (v.smtp_host as string) || Deno.env.get("SMTP_HOST") || "smtp.gmail.com",
        port: Number(v.smtp_port) || parseInt(Deno.env.get("SMTP_PORT") || "587"),
        user: (v.smtp_user as string) || Deno.env.get("SMTP_USER") || "",
        pass: (v.smtp_pass as string) || Deno.env.get("SMTP_PASS") || "",
        from: (v.smtp_from as string) || Deno.env.get("SMTP_FROM") || (v.smtp_user as string) || Deno.env.get("SMTP_USER") || "",
      };
    } catch {
      // DB read failed — fall through to env secrets.
    }
  }

  return {
    host: Deno.env.get("SMTP_HOST") || "smtp.gmail.com",
    port: parseInt(Deno.env.get("SMTP_PORT") || "587"),
    user: Deno.env.get("SMTP_USER") || "",
    pass: Deno.env.get("SMTP_PASS") || "",
    from: Deno.env.get("SMTP_FROM") || Deno.env.get("SMTP_USER") || "",
  };
}

// Lightweight authorization guard: if SEND_EMAIL_TOKEN is configured, require it in
// the x-send-token header (constant-time compare). This prevents anyone from using
// the public anon key to trigger emails/spam through your SMTP account.
function isAuthorized(req: Request): boolean {
  const token = Deno.env.get("SEND_EMAIL_TOKEN");
  if (!token) return true; // not configured -> allow (compat mode)
  const provided = req.headers.get("x-send-token") || "";
  if (provided.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= provided.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!isAuthorized(req)) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload: EmailPayload = await req.json();
    const smtpConfig = await loadSmtpConfig();

    if (!smtpConfig.user || !smtpConfig.pass) {
      throw new Error("SMTP credentials not configured. Add the SMTP password in System Settings > Notifications.");
    }

    if (!payload.to || !payload.subject || !payload.html) {
      throw new Error("Missing required fields: to, subject, html");
    }

    await sendViaSMTP(smtpConfig, payload);

    return new Response(
      JSON.stringify({ success: true, message: "Email sent successfully" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Email send error:", error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

