import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import nodemailer from "nodemailer";
import {
  ShareholderNoticeService,
  type NoticeMissingType,
} from "@/lib/services/shareholder-notice.service";

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

async function getSmtpConfig(supabaseAdmin: any): Promise<SmtpConfig> {
  const { data: row } = await (supabaseAdmin as any)
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", "global")
    .maybeSingle();

  const existing = (row?.setting_value as Record<string, any>) || {};

  const host = (existing.smtp_host || "").trim();
  const port = Number(existing.smtp_port || 587);
  const user = (existing.smtp_user ?? "").trim();
  const pass = existing.smtp_pass || "";
  const from = (existing.smtp_from || user || "rta@rbbmbl.com.np").trim();

  if (!host) {
    throw new Error(
      "Outgoing SMTP server is not configured in Settings. Please configure SMTP host and credentials under Settings > System Settings.",
    );
  }

  return { host, port, user, pass, from };
}

function createTransporter(config: SmtpConfig) {
  const isSecure = config.port === 465;
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: isSecure,
    auth: config.user || config.pass ? { user: config.user, pass: config.pass } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: {
      rejectUnauthorized: false,
    },
  });
}

export interface SendShareholderNoticeInput {
  clientId: string;
  customSubject?: string;
  customMessage?: string;
  missingTypeOverride?: NoticeMissingType;
}

export interface SendShareholderNoticeResult {
  success: boolean;
  message: string;
  recipient: string;
  messageId?: string;
  missingType: NoticeMissingType;
}

/**
 * Server function to send a KYC / Bank detail update notice email to a single shareholder.
 */
export const sendShareholderNoticeServerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: SendShareholderNoticeInput) => data)
  .handler(async ({ data: input, context }): Promise<SendShareholderNoticeResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Fetch client record
    const { data: client, error: cErr } = await (supabaseAdmin as any)
      .from("clients")
      .select("*, company:companies(company_name, company_code)")
      .eq("id", input.clientId)
      .maybeSingle();

    if (cErr || !client) {
      throw new Error(`Shareholder record not found (ID: ${input.clientId})`);
    }

    const email = (client.email || "").trim();
    if (!ShareholderNoticeService.hasValidEmail(email)) {
      throw new Error(
        `Shareholder ${client.full_name} does not have a valid registered email address.`,
      );
    }

    // 2. Resolve missing issue type
    const resolvedType =
      input.missingTypeOverride ||
      ShareholderNoticeService.getMissingType({
        bank_account_no: client.bank_account_no,
        pan_no: client.pan_no,
        pan_or_citizenship: client.pan_or_citizenship,
      });

    if (!resolvedType) {
      throw new Error(
        `Shareholder ${client.full_name} already has complete bank details and PAN registered.`,
      );
    }

    // 3. Prepare SMTP transporter
    const smtp = await getSmtpConfig(supabaseAdmin);
    const transporter = createTransporter(smtp);

    const compName = client.company?.company_name || "RBB Merchant Banking Limited";
    const subject =
      input.customSubject?.trim() ||
      ShareholderNoticeService.generateSubject(compName, resolvedType);

    const html = ShareholderNoticeService.renderNoticeHtml({
      shareholderName: client.full_name || "Shareholder",
      boid: client.boid || "",
      email,
      companyName: compName,
      missingType: resolvedType,
      customMessage: input.customMessage?.trim() || undefined,
    });

    const text = ShareholderNoticeService.renderNoticeText({
      shareholderName: client.full_name || "Shareholder",
      boid: client.boid || "",
      email,
      companyName: compName,
      missingType: resolvedType,
      customMessage: input.customMessage?.trim() || undefined,
    });

    // 4. Send email
    const sender = smtp.from.includes("<")
      ? smtp.from
      : `RTA/RTS Department - RBB Merchant Banking <${smtp.from}>`;

    const info = await transporter.sendMail({
      from: sender,
      to: email,
      subject,
      text,
      html,
    });

    // 5. Record audit log
    try {
      await (supabaseAdmin as any).from("audit_logs").insert({
        user_id: context.userId || null,
        table_name: "clients",
        record_id: client.id,
        action: "SHAREHOLDER_KYC_NOTICE_SENT",
        new_value: {
          client_id: client.id,
          boid: client.boid,
          recipient_name: client.full_name,
          recipient_email: email,
          missing_type: resolvedType,
          subject,
          message_id: info.messageId,
          sent_at: new Date().toISOString(),
        },
      });
    } catch (auditErr) {
      console.warn("Could not insert audit log for notice dispatch:", auditErr);
    }

    return {
      success: true,
      message: `KYC update request email sent successfully to ${email}`,
      recipient: email,
      messageId: info.messageId,
      missingType: resolvedType,
    };
  });

export interface SendBatchNoticesInput {
  companyId?: string | null;
  targetIssue: "ALL" | "MISSING_BANK" | "MISSING_PAN" | "MISSING_BOTH";
  clientIds?: string[];
  limit?: number;
  customSubject?: string;
  customMessage?: string;
}

export interface SendBatchNoticesResult {
  success: boolean;
  totalProcessed: number;
  sentCount: number;
  failedCount: number;
  errors: string[];
  summary: Array<{
    id: string;
    name: string;
    boid: string;
    email: string;
    missingType: NoticeMissingType;
    status: "SENT" | "FAILED";
    error?: string;
  }>;
}

/**
 * Server function to send KYC / Bank update notices to a batch of eligible shareholders.
 */
export const sendShareholderBatchNoticesServerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: SendBatchNoticesInput) => data)
  .handler(async ({ data: input, context }): Promise<SendBatchNoticesResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Fetch SMTP config first to fail-fast if unconfigured
    const smtp = await getSmtpConfig(supabaseAdmin);
    const transporter = createTransporter(smtp);

    // 2. Query candidates
    let query = (supabaseAdmin as any)
      .from("clients")
      .select(
        "id, full_name, boid, email, bank_account_no, pan_no, pan_or_citizenship, company:companies(company_name, company_code)",
      )
      .not("email", "is", null)
      .neq("email", "");

    if (input.clientIds && input.clientIds.length > 0) {
      query = query.in("id", input.clientIds);
    } else {
      if (input.companyId && input.companyId !== "all") {
        query = query.eq("company_id", input.companyId);
      }
      const fetchLimit = Math.min(input.limit || 100, 500);
      query = query.limit(fetchLimit);
    }

    const { data: rawCandidates, error: qErr } = await query;
    if (qErr) {
      throw new Error(`Database error fetching candidates: ${qErr.message}`);
    }

    // 3. Filter candidates based on targetIssue
    const candidates: Array<{
      client: any;
      missingType: NoticeMissingType;
    }> = [];

    for (const c of rawCandidates || []) {
      const email = (c.email || "").trim();
      if (!ShareholderNoticeService.hasValidEmail(email)) continue;

      const missingType = ShareholderNoticeService.getMissingType({
        bank_account_no: c.bank_account_no,
        pan_no: c.pan_no,
        pan_or_citizenship: c.pan_or_citizenship,
      });

      if (!missingType) continue;

      if (input.targetIssue === "ALL") {
        candidates.push({ client: c, missingType });
      } else if (
        input.targetIssue === "MISSING_BANK" &&
        (missingType === "MISSING_BANK" || missingType === "MISSING_BOTH")
      ) {
        candidates.push({ client: c, missingType });
      } else if (
        input.targetIssue === "MISSING_PAN" &&
        (missingType === "MISSING_PAN" || missingType === "MISSING_BOTH")
      ) {
        candidates.push({ client: c, missingType });
      } else if (input.targetIssue === "MISSING_BOTH" && missingType === "MISSING_BOTH") {
        candidates.push({ client: c, missingType });
      }
    }

    if (candidates.length === 0) {
      return {
        success: true,
        totalProcessed: 0,
        sentCount: 0,
        failedCount: 0,
        errors: [],
        summary: [],
      };
    }

    const sender = smtp.from.includes("<")
      ? smtp.from
      : `RTA/RTS Department - RBB Merchant Banking <${smtp.from}>`;

    const summary: SendBatchNoticesResult["summary"] = [];
    let sentCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    // 4. Send emails in throttled sequence to avoid SMTP socket exhaustion
    for (const item of candidates) {
      const { client, missingType } = item;
      const compName = client.company?.company_name || "RBB Merchant Banking Limited";
      const subject =
        input.customSubject?.trim() ||
        ShareholderNoticeService.generateSubject(compName, missingType);

      const html = ShareholderNoticeService.renderNoticeHtml({
        shareholderName: client.full_name || "Shareholder",
        boid: client.boid || "",
        email: client.email,
        companyName: compName,
        missingType,
        customMessage: input.customMessage?.trim() || undefined,
      });

      const text = ShareholderNoticeService.renderNoticeText({
        shareholderName: client.full_name || "Shareholder",
        boid: client.boid || "",
        email: client.email,
        companyName: compName,
        missingType,
        customMessage: input.customMessage?.trim() || undefined,
      });

      try {
        await transporter.sendMail({
          from: sender,
          to: client.email,
          subject,
          text,
          html,
        });

        sentCount++;
        summary.push({
          id: client.id,
          name: client.full_name,
          boid: client.boid,
          email: client.email,
          missingType,
          status: "SENT",
        });

        // Throttle 150ms between outgoing emails
        await new Promise((res) => setTimeout(res, 150));
      } catch (sendErr: any) {
        failedCount++;
        const msg = `${client.full_name} (${client.email}): ${sendErr.message || "Failed"}`;
        errors.push(msg);
        summary.push({
          id: client.id,
          name: client.full_name,
          boid: client.boid,
          email: client.email,
          missingType,
          status: "FAILED",
          error: sendErr.message,
        });
      }
    }

    // 5. Record batch audit summary
    try {
      await (supabaseAdmin as any).from("audit_logs").insert({
        user_id: context.userId || null,
        table_name: "clients",
        action: "SHAREHOLDER_KYC_BATCH_NOTICES_SENT",
        new_value: {
          target_issue: input.targetIssue,
          company_id: input.companyId,
          total_candidates: candidates.length,
          sent_count: sentCount,
          failed_count: failedCount,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (auditErr) {
      console.warn("Could not record batch audit log:", auditErr);
    }

    return {
      success: true,
      totalProcessed: candidates.length,
      sentCount,
      failedCount,
      errors: errors.slice(0, 10),
      summary,
    };
  });
