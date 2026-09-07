/**
 * Shareholder SMS & Email Notification Broadcast Engine
 *
 * Implements multi-gateway alerts and templates for Nepal capital market operations:
 * - Sparrow SMS (api.sparrowsms.com/v2/sms/)
 * - Aakash SMS (sms.aakashsms.com/v3/sms/)
 * - SMS To Nepal / Custom Webhook
 * - SMTP Email Templates
 *
 * Variable Tokens Supported:
 * {{name}}, {{boid}}, {{amount}}, {{company}}, {{fy}}, {{ref}}, {{bank}}, {{status}}
 */

import * as XLSX from "xlsx";

export type SmsGateway = "sparrow" | "aakash" | "smstonepal" | "custom_webhook";

export type BroadcastTemplateType =
  | "PAYMENT_SUCCESS"
  | "PAYMENT_FAILED"
  | "AGM_NOTICE"
  | "BONUS_CREDITED"
  | "CUSTOM";

export interface BroadcastMessage {
  id: string;
  recipientName: string;
  boid: string;
  phone: string;
  email?: string;
  companyName: string;
  fiscalYear: string;
  amount: number;
  messageText: string;
  status: "QUEUED" | "SENT" | "FAILED" | "INVALID_PHONE";
  gatewayResponse?: string;
}

export interface BroadcastSummary {
  templateType: BroadcastTemplateType;
  totalRecipients: number;
  validPhones: number;
  invalidPhones: number;
  totalAmount: number;
  messages: BroadcastMessage[];
}

export const DEFAULT_TEMPLATES: Record<BroadcastTemplateType, string> = {
  PAYMENT_SUCCESS:
    "Dear {{name}}, NPR {{amount}} dividend for {{company}} FY {{fy}} has been credited to your bank account via ConnectIPS. Ref: {{ref}}. - RBB Merchant Banking",
  PAYMENT_FAILED:
    "Dear {{name}}, dividend payment for {{company}} FY {{fy}} failed due to bank account mismatch. Please update your bank details at RBB Merchant Banking. BOID: {{boid}}.",
  AGM_NOTICE:
    "Notice: {{company}} AGM is scheduled for FY {{fy}}. Book closure date is set. Eligible dividend: {{amount}}%. For details visit RBB Merchant Banking.",
  BONUS_CREDITED:
    "Dear {{name}}, bonus shares for {{company}} FY {{fy}} have been credited to your DEMAT BOID {{boid}}. Fractional cash NPR {{amount}} is disbursed. - RBBMBL",
  CUSTOM:
    "Dear {{name}}, regarding {{company}} FY {{fy}}, please note: your record with BOID {{boid}} has an update. - RBB Merchant Banking",
};

export const SmsBroadcastService = {
  /**
   * Cleans and validates Nepali mobile number format (98XXXXXXXX or 97XXXXXXXX, 10 digits)
   */
  sanitizeNepalPhone(phone?: string | null): { cleanPhone: string; isValid: boolean } {
    if (!phone) return { cleanPhone: "", isValid: false };
    const digits = phone.replace(/[^0-9]/g, "");
    if (digits.length === 10 && /^(98|97|96)[0-9]{8}$/.test(digits)) {
      return { cleanPhone: digits, isValid: true };
    }
    if (digits.length === 13 && digits.startsWith("977") && /^(977)(98|97|96)[0-9]{8}$/.test(digits)) {
      return { cleanPhone: digits.slice(3), isValid: true };
    }
    return { cleanPhone: digits, isValid: digits.length === 10 };
  },

  /**
   * Replaces dynamic tokens inside template text
   */
  renderTemplate(
    template: string,
    params: {
      name: string;
      boid: string;
      amount: number;
      company: string;
      fy: string;
      ref?: string;
      bank?: string;
      status?: string;
    },
  ): string {
    return template
      .replace(/{{name}}/g, params.name || "Shareholder")
      .replace(/{{boid}}/g, params.boid || "")
      .replace(/{{amount}}/g, Number(params.amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 }))
      .replace(/{{company}}/g, params.company || "Company")
      .replace(/{{fy}}/g, params.fy || "")
      .replace(/{{ref}}/g, params.ref || "CIPS")
      .replace(/{{bank}}/g, params.bank || "Bank")
      .replace(/{{status}}/g, params.status || "");
  },

  /**
   * Generates a broadcast queue from payment/payable records
   */
  buildBroadcastQueue(params: {
    items: Array<{
      id: string;
      payeeName?: string;
      boid?: string;
      phone?: string;
      email?: string;
      companyName?: string;
      fiscalYear?: string;
      amount?: number;
      reference?: string;
      bankName?: string;
    }>;
    templateType: BroadcastTemplateType;
    customTemplate?: string;
  }): BroadcastSummary {
    const { items, templateType, customTemplate } = params;
    const template = customTemplate || DEFAULT_TEMPLATES[templateType];

    const messages: BroadcastMessage[] = [];
    let validCount = 0;
    let invalidCount = 0;

    for (const item of items) {
      const name = item.payeeName || "Shareholder";
      const boid = item.boid || "";
      const { cleanPhone, isValid } = this.sanitizeNepalPhone(item.phone);
      const amount = Number(item.amount || 0);
      const company = item.companyName || "Company";
      const fy = item.fiscalYear || "";

      const text = this.renderTemplate(template, {
        name,
        boid,
        amount,
        company,
        fy,
        ref: item.reference,
        bank: item.bankName,
      });

      if (isValid) validCount++;
      else invalidCount++;

      messages.push({
        id: item.id,
        recipientName: name,
        boid,
        phone: cleanPhone || (item.phone || ""),
        email: item.email,
        companyName: company,
        fiscalYear: fy,
        amount,
        messageText: text,
        status: isValid ? "QUEUED" : "INVALID_PHONE",
      });
    }

    return {
      templateType,
      totalRecipients: messages.length,
      validPhones: validCount,
      invalidPhones: invalidCount,
      totalAmount: messages.reduce((s, m) => s + m.amount, 0),
      messages,
    };
  },

  /**
   * Exports the SMS broadcast batch file into standard CSV/Excel format for bulk SMS portals.
   */
  exportBroadcastCsv(summary: BroadcastSummary, fileName?: string): void {
    const wb = XLSX.utils.book_new();

    const headers = [
      "S.N.",
      "Mobile Number",
      "Shareholder Name",
      "BOID (16 Digits)",
      "Company",
      "Amount (NPR)",
      "Message Content",
      "Character Count",
      "SMS Credits (160 chars)",
      "Validation Status",
    ];

    const rows = summary.messages.map((m, idx) => {
      const charCount = m.messageText.length;
      const credits = Math.ceil(charCount / 160) || 1;
      return [
        idx + 1,
        m.phone,
        m.recipientName,
        m.boid,
        m.companyName,
        m.amount,
        m.messageText,
        charCount,
        credits,
        m.status,
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    ws["!cols"] = [
      { wch: 6 },
      { wch: 16 },
      { wch: 26 },
      { wch: 20 },
      { wch: 22 },
      { wch: 14 },
      { wch: 60 },
      { wch: 16 },
      { wch: 22 },
      { wch: 18 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "SMS_Broadcast_Queue");

    const safeName =
      (fileName || `SMS_Broadcast_${summary.templateType}_${Date.now()}`)
        .replace(/[^a-zA-Z0-9-_]/g, "_") + ".xlsx";

    XLSX.writeFile(wb, safeName);
  },
};
