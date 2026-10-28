/**
 * Shareholder Missing Details (KYC & Bank) Notification Service
 *
 * Handles detection of missing compliance information (Bank Account, PAN)
 * and generates official RBB Merchant Banking Limited RTA/RTS branded email notices.
 */

export type NoticeMissingType = "MISSING_BANK" | "MISSING_PAN" | "MISSING_BOTH";

export interface ShareholderNoticeClient {
  id?: string;
  full_name?: string | null;
  boid?: string | null;
  email?: string | null;
  phone?: string | null;
  bank_name?: string | null;
  bank_account_no?: string | null;
  pan_no?: string | null;
  pan_or_citizenship?: string | null;
  citizenship_no?: string | null;
  company_name?: string | null;
  company_code?: string | null;
}

export interface RenderNoticeParams {
  shareholderName: string;
  boid: string;
  email: string;
  companyName: string;
  missingType: NoticeMissingType;
  customMessage?: string;
  supportEmail?: string;
  supportPhone?: string;
}

export const ShareholderNoticeService = {
  /**
   * Validates if email address has a standard valid syntax
   */
  hasValidEmail(email?: string | null): boolean {
    if (!email) return false;
    const clean = email.trim();
    return clean.length >= 5 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean);
  },

  /**
   * Checks if bank account number is missing or empty
   */
  isMissingBank(client: { bank_account_no?: string | null }): boolean {
    return !client.bank_account_no || client.bank_account_no.trim() === "";
  },

  /**
   * Checks if a valid 9-digit Nepal IRD PAN is missing
   */
  isMissingPan(client: { pan_no?: string | null; pan_or_citizenship?: string | null }): boolean {
    const rawPan = (client.pan_no || "").trim();
    if (/^\d{9}$/.test(rawPan)) return false;

    // Fallback: check pan_or_citizenship if exactly 9 digits
    const rawPoc = (client.pan_or_citizenship || "").trim();
    if (/^\d{9}$/.test(rawPoc)) return false;

    return true;
  },

  /**
   * Resolves the specific missing issue type for a client
   */
  getMissingType(client: ShareholderNoticeClient): NoticeMissingType | null {
    const missingBank = this.isMissingBank(client);
    const missingPan = this.isMissingPan(client);

    if (missingBank && missingPan) return "MISSING_BOTH";
    if (missingBank) return "MISSING_BANK";
    if (missingPan) return "MISSING_PAN";
    return null;
  },

  /**
   * Returns human-readable labels for the missing items
   */
  getMissingLabels(type: NoticeMissingType): {
    title: string;
    items: string[];
    description: string;
  } {
    switch (type) {
      case "MISSING_BANK":
        return {
          title: "Bank Account Details Required",
          items: ["Bank Name", "Branch Name", "Bank Account Number"],
          description:
            "Your registered Demat account currently lacks verified bank account details. Without an active bank account, upcoming cash dividends and entitlements cannot be credited to your account via ConnectIPS/ACH.",
        };
      case "MISSING_PAN":
        return {
          title: "PAN Number Required for Tax (TDS) Credit",
          items: ["9-Digit Permanent Account Number (PAN)"],
          description:
            "Under the Nepal Income Tax Act, 2058 and Inland Revenue Department (IRD) directives, dividend withholding tax (TDS) credit cannot be reconciled to your tax ledger without a registered 9-digit PAN.",
        };
      case "MISSING_BOTH":
        return {
          title: "Bank Account & PAN Details Required",
          items: ["Bank Account Details (Bank, Branch, Account No)", "9-Digit PAN Number"],
          description:
            "Your shareholder profile currently lacks both verified bank account details and a registered PAN number. These details are essential for electronic dividend crediting and official tax withholding credit.",
        };
    }
  },

  /**
   * Generates default email subject line
   */
  generateSubject(companyName: string, missingType: NoticeMissingType): string {
    const scope = companyName ? `${companyName} / ` : "";
    switch (missingType) {
      case "MISSING_BANK":
        return `[Action Required] Update Your Registered Bank Account — ${scope}RBB Merchant Banking`;
      case "MISSING_PAN":
        return `[Action Required] Update Your PAN Number — ${scope}RBB Merchant Banking`;
      case "MISSING_BOTH":
        return `[Action Required] Update Bank Details & PAN Number — ${scope}RBB Merchant Banking`;
    }
  },

  /**
   * Generates official responsive HTML email template
   */
  renderNoticeHtml(params: RenderNoticeParams): string {
    const {
      shareholderName,
      boid,
      companyName,
      missingType,
      customMessage,
      supportEmail = "rta@rbbmbl.com.np",
      supportPhone = "01-4240842, 01-4240843",
    } = params;

    const { title, items, description } = this.getMissingLabels(missingType);

    const itemsListHtml = items
      .map(
        (it) => `
        <li style="margin-bottom: 6px; color: #0f172a; font-weight: 600;">
          <span style="color: #dc2626; margin-right: 6px;">✕</span> ${it}
        </li>`,
      )
      .join("");

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.generateSubject(companyName, missingType)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.5;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 24px 12px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 620px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <!-- Official Header Bar -->
          <tr>
            <td style="background-color: #0f2744; padding: 20px 24px; text-align: left; border-bottom: 3px solid #0284c7;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <h1 style="color: #ffffff; margin: 0; font-size: 18px; font-weight: 700; letter-spacing: 0.5px;">RBB MERCHANT BANKING LIMITED</h1>
                    <p style="color: #94a3b8; margin: 3px 0 0 0; font-size: 12px; font-weight: 500;">RTA / RTS (Registrar to Shares) Department · Central Office</p>
                  </td>
                  <td align="right" style="vertical-align: middle;">
                    <span style="background-color: #0284c7; color: #ffffff; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Official Notice</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 24px 28px;">
              <p style="margin: 0 0 16px 0; font-size: 15px; color: #334155;">
                Dear <strong>${shareholderName || "Valued Shareholder"}</strong>,
              </p>

              <!-- Shareholder Identification Box -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 16px; margin-bottom: 20px; font-size: 13px;">
                <tr>
                  <td style="padding: 4px 0; color: #64748b; font-weight: 600; width: 140px;">BOID (Demat No.):</td>
                  <td style="padding: 4px 0; font-family: monospace; font-weight: 700; color: #0284c7; font-size: 14px;">${boid || "—"}</td>
                </tr>
                ${
                  companyName
                    ? `
                <tr>
                  <td style="padding: 4px 0; color: #64748b; font-weight: 600;">Entity / Scheme:</td>
                  <td style="padding: 4px 0; font-weight: 600; color: #0f172a;">${companyName}</td>
                </tr>`
                    : ""
                }
                <tr>
                  <td style="padding: 4px 0; color: #64748b; font-weight: 600;">Notice Subject:</td>
                  <td style="padding: 4px 0; font-weight: 700; color: #dc2626;">${title}</td>
                </tr>
              </table>

              <!-- Notice Description -->
              <p style="margin: 0 0 14px 0; font-size: 14px; color: #334155; line-height: 1.6;">
                ${description}
              </p>

              <!-- Missing Fields Alert Box -->
              <div style="background-color: #fff1f2; border: 1px solid #fecdd3; border-left: 4px solid #e11d48; border-radius: 6px; padding: 14px 18px; margin: 18px 0;">
                <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 700; color: #9f1239; text-transform: uppercase; letter-spacing: 0.5px;">
                  Action Required: The following information is missing in your record:
                </p>
                <ul style="margin: 0; padding-left: 18px; font-size: 13.5px;">
                  ${itemsListHtml}
                </ul>
              </div>

              ${
                customMessage
                  ? `
              <!-- Custom Operational Note -->
              <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 12px 16px; margin-bottom: 20px;">
                <p style="margin: 0 0 4px 0; font-size: 11px; font-weight: 700; color: #166534; text-transform: uppercase;">Note from RTS Department:</p>
                <p style="margin: 0; font-size: 13px; color: #14532d;">${customMessage}</p>
              </div>`
                  : ""
              }

              <!-- Remediation Steps -->
              <h3 style="margin: 24px 0 10px 0; font-size: 14px; color: #0f172a; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                How to update your details:
              </h3>

              <ol style="margin: 0 0 20px 0; padding-left: 20px; font-size: 13px; color: #334155; line-height: 1.6;">
                <li style="margin-bottom: 8px;">
                  <strong>Through your Depository Participant (DP):</strong> Update your bank account details and PAN directly with your Demat DP (where your BOID was opened). CDSC will synchronize the updated details automatically.
                </li>
                <li style="margin-bottom: 8px;">
                  <strong>Via Official Email:</strong> Reply to this email or send a clear scan/photo of your Cheque leaf (or Bank Statement) and PAN Card to <a href="mailto:${supportEmail}" style="color: #0284c7; font-weight: 600; text-decoration: underline;">${supportEmail}</a> along with your 16-digit BOID.
                </li>
                <li style="margin-bottom: 8px;">
                  <strong>In-Person Counter:</strong> Visit the RTA/RTS Department, RBB Merchant Banking Limited (Central Office, Teku, Kathmandu) or your nearest Rastriya Banijya Bank branch with your citizenship and bank details.
                </li>
              </ol>

              <!-- Assistance Footer Block -->
              <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 24px; font-size: 12px; color: #64748b;">
                <p style="margin: 0 0 4px 0;">For inquiries or assistance regarding Demat linkage, dividend settlement, or verification:</p>
                <p style="margin: 0; font-weight: 600; color: #334155;">
                  RTA/RTS Department · RBB Merchant Banking Limited<br>
                  Phone: ${supportPhone} · Email: <a href="mailto:${supportEmail}" style="color: #0284c7; text-decoration: none;">${supportEmail}</a>
                </p>
              </div>
            </td>
          </tr>

          <!-- Legal & Disclaimer Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 14px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8;">
              <p style="margin: 0 0 4px 0;">This is an authentic system-generated notification from the RTA/RTS Department, RBB Merchant Banking Limited.</p>
              <p style="margin: 0;">Please do not share your bank passwords or OTPs with anyone. We only require Bank Account Number and PAN for dividend processing.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
  },

  /**
   * Generates plaintext fallback version of the notice
   */
  renderNoticeText(params: RenderNoticeParams): string {
    const {
      shareholderName,
      boid,
      companyName,
      missingType,
      customMessage,
      supportEmail = "rta@rbbmbl.com.np",
      supportPhone = "01-4240842",
    } = params;

    const { title, items, description } = this.getMissingLabels(missingType);

    return `
================================================================================
RBB MERCHANT BANKING LIMITED — RTA/RTS DEPARTMENT
OFFICIAL SHAREHOLDER COMPLIANCE NOTICE: ${title.toUpperCase()}
================================================================================

Dear ${shareholderName || "Valued Shareholder"},

BOID (Demat Number): ${boid || "—"}
Entity / Scheme: ${companyName || "Portfolio"}
Notice Type: ${title}

${description}

ACTION REQUIRED:
The following information is missing in your shareholder record:
${items.map((i) => `* ${i}`).join("\n")}

${customMessage ? `Note from RTS Department:\n${customMessage}\n` : ""}

HOW TO UPDATE YOUR DETAILS:
1. Through your Depository Participant (DP): Update your bank details & PAN with your Demat DP.
2. Via Email: Send a copy of your cheque leaf and PAN card to ${supportEmail} with your BOID.
3. In-Person: Visit RBB Merchant Banking Limited, Teku, Kathmandu or any RBB branch.

For assistance, please contact:
RTA/RTS Department, RBB Merchant Banking Limited
Phone: ${supportPhone} | Email: ${supportEmail}

--------------------------------------------------------------------------------
This is an authentic system-generated notice. Never share passwords or PINs.
================================================================================
    `.trim();
  },
};
