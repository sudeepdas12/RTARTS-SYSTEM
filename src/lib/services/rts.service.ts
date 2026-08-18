import { supabase } from '@/integrations/supabase/client';

/**
 * Service responsible for communicating with the RTS (Regulatory Transfer System)
 * to submit dividend distribution details.
 *
 * The endpoint and authentication method are expected to be provided via
 * environment variables:
 *   - VITE_RTS_API_URL: Base URL of the RTS API (e.g. https://rts.example.com/api)
 *   - VITE_RTS_API_KEY: API key for authentication (if required)
 */
export const RtsService = {
  /**
   * Submit a dividend record to the RTS system.
   *
   * @param payload Object containing the minimal required fields.
   *   - company_id: ID of the company issuing the dividend
   *   - client_id: ID of the client (shareholder) receiving the dividend
   *   - amount: Net payable amount to be transferred
   *   - fiscal_year: FY string used for reporting
   *   - payment_reference?: Optional reference/cheque number
   *   - payment_date?: ISO date string of the payment
   */
  async submitDividend(payload: {
    company_id: string;
    client_id: string;
    amount: number;
    fiscal_year: string;
    payment_reference?: string | null;
    payment_date?: string | null;
  }): Promise<void> {
    const baseUrl = import.meta.env.VITE_RTS_API_URL;
    const apiKey = import.meta.env.VITE_RTS_API_KEY;
    if (!baseUrl) {
      console.warn('RTS API URL not configured');
      return;
    }
    try {
      const response = await fetch(`${baseUrl}/dividends`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`RTS submission failed: ${response.status} ${errText}`);
      }
    } catch (err) {
      console.error('Error submitting dividend to RTS:', err);
      // Re‑throw so callers can react (e.g., show toast)
      throw err;
    }
  },
};
