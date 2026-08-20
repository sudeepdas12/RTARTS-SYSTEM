import { supabase, throwIfError } from './database';

export interface SystemSettings {
  enable_nepali_dates: boolean;
  dividend_tds_natural: number;
  dividend_tds_legal: number;
  interest_tds_natural: number;
  interest_tds_legal: number;
  require_maker_checker: boolean;
  require_final_approver: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_from: string;
  smtp_pass: string;
  sms_gateway_url: string;
  sms_api_key: string;
}

const DEFAULT_SETTINGS: SystemSettings = {
  enable_nepali_dates: true,
  dividend_tds_natural: 5.0,
  dividend_tds_legal: 5.0,
  interest_tds_natural: 6.0,
  interest_tds_legal: 15.0,
  require_maker_checker: true,
  require_final_approver: false,
  smtp_host: '',
  smtp_port: 587,
  smtp_user: '',
  smtp_from: '',
  smtp_pass: '',
  sms_gateway_url: '',
  sms_api_key: '',
};

const SETTINGS_KEY = 'global';

export const SettingsService = {
  async getSettings(): Promise<SystemSettings> {
    // Reads come from the safe view so the SMTP password is only visible to admins.
    const { data, error } = await (supabase as any)
      .from('system_settings_safe')
      .select('setting_value')
      .eq('setting_key', SETTINGS_KEY)
      .maybeSingle();

    if (error) {
      console.warn('Could not load settings, using defaults:', error.message);
      return DEFAULT_SETTINGS;
    }

    const settings: SystemSettings = {
      ...DEFAULT_SETTINGS,
      ...((data?.setting_value as Partial<SystemSettings>) || {}),
    };

    // TDS rates are authoritative in `payable_tax_rules` (the table the DB
    // trigger, the import engine and classification-review all read). Always
    // present the REAL effective rates in the settings UI rather than a
    // duplicated copy that could silently diverge.
    try {
      const { data: rules } = await (supabase as any)
        .from('payable_tax_rules')
        .select('payable_category, payee_classification, tax_rate')
        .eq('is_active', true);

      const ratePct = (category: string, classification: string): number | null => {
        const hit = (rules ?? []).find(
          (r: any) => r.payable_category === category && r.payee_classification === classification,
        );
        return hit?.tax_rate != null ? Number(hit.tax_rate) * 100 : null;
      };

      const mappings: Array<[keyof SystemSettings, string, string]> = [
        ['dividend_tds_natural', 'DIVIDEND', 'NATURAL_PERSON'],
        ['dividend_tds_legal', 'DIVIDEND', 'COMPANY_INSTITUTION'],
        ['interest_tds_natural', 'INTEREST', 'NATURAL_PERSON'],
        ['interest_tds_legal', 'INTEREST', 'COMPANY_INSTITUTION'],
      ];
      for (const [key, category, classification] of mappings) {
        const pct = ratePct(category, classification);
        // The four mapped keys are all numeric SystemSettings fields.
        if (pct != null) (settings as any)[key] = pct;
      }
    } catch (e) {
      console.warn('Could not load TDS rules from payable_tax_rules; using stored/default values.', e);
    }

    // SECURITY: never expose the stored SMTP password to the browser/client.
    settings.smtp_pass = '';

    return settings;
  },

  async saveSettings(settings: SystemSettings): Promise<void> {
    // SECURITY: preserve the existing stored SMTP password when the form submits
    // it as blank (password fields are intentionally cleared and never round-tripped).
    let resolved = { ...settings };
    const { data: existing } = await (supabase as any)
      .from('system_settings_safe')
      .select('setting_value')
      .eq('setting_key', SETTINGS_KEY)
      .maybeSingle();

    const existingVal = (existing?.setting_value as Partial<SystemSettings> | undefined) || {};
    if (!settings.smtp_pass) {
      resolved.smtp_pass = existingVal.smtp_pass ?? '';
    }

    const { error } = await (supabase as any)
      .from('system_settings')
      .upsert(
        { setting_key: SETTINGS_KEY, setting_value: resolved as any, updated_at: new Date().toISOString() },
        { onConflict: 'setting_key' }
      );
    throwIfError(error, 'Failed to save settings');

    // Persist the four TDS rates into `payable_tax_rules` so the settings page
    // is the single entry point that actually drives imports, the DB trigger
    // and reports — no more disconnected duplicate.
    const tdsUpdates: Array<[string, string, number]> = [
      ['DIVIDEND', 'NATURAL_PERSON', Number(settings.dividend_tds_natural) / 100],
      ['DIVIDEND', 'COMPANY_INSTITUTION', Number(settings.dividend_tds_legal) / 100],
      ['INTEREST', 'NATURAL_PERSON', Number(settings.interest_tds_natural) / 100],
      ['INTEREST', 'COMPANY_INSTITUTION', Number(settings.interest_tds_legal) / 100],
    ];
    for (const [category, classification, rawRate] of tdsUpdates) {
      const safeRate = Math.max(0, Math.min(1, Number(rawRate) || 0));
      const { error: ruleErr } = await (supabase as any)
        .from('payable_tax_rules')
        .update({ tax_rate: safeRate, updated_at: new Date().toISOString() })
        .eq('payable_category', category)
        .eq('payee_classification', classification);
      if (ruleErr) {
        // Surface the failure — otherwise TDS changes would silently not apply.
        throwIfError(ruleErr, `Failed to save TDS rate for ${category} / ${classification}`);
      }
    }
  },

  async sendTestEmail(to: string): Promise<void> {
    const { error } = await (supabase as any).functions.invoke('send-email', {
      body: {
        to,
        subject: 'RTARTS System - SMTP Test Email',
        text: 'RTARTS System SMTP Test. If you received this, email sending is working correctly.',
        html:
          '<h2>RTARTS System</h2>' +
          '<p>This is a test email sent to verify that the SMTP configuration is working correctly.</p>' +
          '<p>If you received this, email sending is confirmed.</p>',
      },
    });
    if (error) throw new Error((error as Error).message || 'Failed to send test email');
  },
};

