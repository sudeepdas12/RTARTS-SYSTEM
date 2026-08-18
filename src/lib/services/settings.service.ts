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

    if (!data) return DEFAULT_SETTINGS;

    const settings = { ...DEFAULT_SETTINGS, ...(data.setting_value as Partial<SystemSettings>) };

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

