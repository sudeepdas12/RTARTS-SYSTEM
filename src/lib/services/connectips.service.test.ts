import { describe, it, expect } from 'vitest';
import { ConnectIPSService } from './connectips.service';

describe('ConnectIPSService', () => {
  it('builds standard NCHL ConnectIPS signature string correctly', () => {
    const sigStr = ConnectIPSService.buildSignatureString({
      merchantId: 'M101',
      appId: 'APP_RTARTS',
      appPaymentId: 'PAY-001',
      amount: 15500.5,
    });

    expect(sigStr).toBe('MERCHANTID=M101,APPID=APP_RTARTS,APPPAYMENTID=PAY-001,AMOUNT=15500.50');
  });

  it('generates SHA-256 hash signature for transaction payload', async () => {
    const sig = await ConnectIPSService.generateSignature('TEST_PAYLOAD_STRING', 'SECRET_KEY');
    expect(typeof sig).toBe('string');
    expect(sig.length).toBe(64); // SHA-256 hex length
  });

  it('performs gateway test connection handshake', async () => {
    const res = await ConnectIPSService.testConnection({
      enable_nepali_dates: true,
      dividend_tds_natural: 5,
      dividend_tds_legal: 5,
      interest_tds_natural: 6,
      interest_tds_legal: 15,
      require_maker_checker: true,
      require_final_approver: false,
      smtp_host: '',
      smtp_port: 587,
      smtp_user: '',
      smtp_from: '',
      smtp_pass: '',
      sms_gateway_url: '',
      sms_api_key: '',
      connectips_enabled: true,
      connectips_mode: 'SANDBOX',
      connectips_merchant_id: 'MERCHANT_DEMO',
      connectips_app_id: 'APP_DEMO',
      connectips_app_name: 'RTARTS System',
      connectips_base_url: 'https://uat.connectips.com:7443',
      connectips_token: '',
      connectips_cert_pass: '',
    });

    expect(res.success).toBe(true);
    expect(res.message).toContain('ConnectIPS Sandbox test handshake verified');
  });
});
