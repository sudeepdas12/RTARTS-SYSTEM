import { supabase, throwIfError } from './database';
import { Database } from '@/integrations/supabase/types';

export interface AuditUserProfile {
  id: string;
  full_name: string;
  email: string;
}

export interface AuditFieldDiff {
  field: string;
  oldValue: any;
  newValue: any;
  isChanged: boolean;
}

function parseClientInfo(): { browser: string; device: string; userAgent: string } {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { browser: 'System API', device: 'Server Environment', userAgent: 'Node/Runtime' };
  }
  const ua = navigator.userAgent || '';
  let browser = 'Web Browser';
  if (ua.includes('Edg/')) browser = 'Microsoft Edge';
  else if (ua.includes('Chrome/')) browser = 'Google Chrome';
  else if (ua.includes('Firefox/')) browser = 'Mozilla Firefox';
  else if (ua.includes('Safari/') && !ua.includes('Chrome/')) browser = 'Apple Safari';
  else if (ua.includes('OPR/') || ua.includes('Opera/')) browser = 'Opera';

  let device = 'Desktop PC';
  if (/Android/i.test(ua)) device = 'Android Mobile';
  else if (/iPhone|iPad|iPod/i.test(ua)) device = 'iOS Mobile';
  else if (/Windows NT 10.0/i.test(ua)) device = 'Windows 10/11';
  else if (/Windows/i.test(ua)) device = 'Windows';
  else if (/Macintosh/i.test(ua)) device = 'macOS';
  else if (/Linux/i.test(ua)) device = 'Linux Workstation';

  return { browser, device, userAgent: ua.slice(0, 500) };
}

export const AuditService = {
  async getUserProfiles(): Promise<Record<string, AuditUserProfile>> {
    try {
      const { data, error } = await (supabase as any)
        .from('profiles')
        .select('id, full_name, email');
      if (error || !data) return {};
      const map: Record<string, AuditUserProfile> = {};
      data.forEach((p: any) => {
        if (p.id) map[p.id] = { id: p.id, full_name: p.full_name || 'User', email: p.email || '' };
      });
      return map;
    } catch {
      return {};
    }
  },

  /**
   * Records a user authentication attempt (both successful sign-ins and rejected/failed attempts)
   */
  async recordLoginAttempt(opts: {
    email: string;
    userId?: string | null;
    status: 'success' | 'failed';
    failureReason?: string | null;
  }) {
    try {
      const clientInfo = parseClientInfo();
      const ipAddress =
        typeof window !== 'undefined'
          ? (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
              ? '127.0.0.1 (Localhost)'
              : window.location.hostname)
          : '127.0.0.1';

      const payload: Record<string, any> = {
        email: opts.email.trim().toLowerCase(),
        login_status: opts.status,
        failure_reason: opts.failureReason || null,
        browser: clientInfo.browser,
        device: clientInfo.device,
        user_agent: clientInfo.userAgent,
        ip_address: ipAddress,
        login_time: new Date().toISOString(),
      };

      if (opts.userId) {
        payload.user_id = opts.userId;
      }

      const { error } = await (supabase as any).from('login_logs').insert(payload);
      if (error) {
        console.warn('Failed to record login attempt:', error.message);
      }
    } catch (err) {
      console.warn('Error recording login attempt:', err);
    }
  },

  async getLoginLogs(limit = 200) {
    try {
      const { data, error } = await (supabase as any).from('login_logs').select('*').order('login_time', { ascending: false }).limit(limit);
      if (error) { console.warn('Failed to fetch login logs:', error.message); return []; }
      return data || [];
    } catch (err: any) {
      console.warn('Failed to fetch login logs:', err?.message || err);
      return [];
    }
  },

  async getApiLogs(limit = 100) {
    try {
      const { data, error } = await (supabase as any).from('api_logs').select('*').order('created_at', { ascending: false }).limit(limit);
      if (error) { console.warn('Failed to fetch API logs:', error.message); return []; }
      return data || [];
    } catch (err: any) {
      console.warn('Failed to fetch API logs:', err?.message || err);
      return [];
    }
  },

  async getErrorLogs(limit = 100) {
    try {
      const { data, error } = await (supabase as any).from('error_logs').select('*').order('created_at', { ascending: false }).limit(limit);
      if (error) { console.warn('Failed to fetch error logs:', error.message); return []; }
      return data || [];
    } catch (err: any) {
      console.warn('Failed to fetch error logs:', err?.message || err);
      return [];
    }
  },

  async getAuditLogs(
    options: {
      limit?: number;
      offset?: number;
      tableName?: string;
      action?: string;
      userId?: string;
      fromDate?: string;
      toDate?: string;
    } | number = 1000
  ) {
    try {
      const opts = typeof options === 'number' ? { limit: options } : options;
      let query = (supabase as any)
        .from('audit_logs')
        .select('*')
        .order('action_time', { ascending: false })
        .limit(opts.limit || 1000);
      
      if (opts.tableName && opts.tableName !== 'all') {
        query = query.eq('table_name', opts.tableName);
      }
      if (opts.action && opts.action !== 'all') {
        query = query.eq('action', opts.action.toUpperCase());
      }
      if (opts.userId && opts.userId !== 'all') {
        query = query.eq('user_id', opts.userId);
      }
      if (opts.fromDate) {
        query = query.gte('action_time', `${opts.fromDate}T00:00:00.000Z`);
      }
      if (opts.toDate) {
        query = query.lte('action_time', `${opts.toDate}T23:59:59.999Z`);
      }
      
      const { data, error } = await query;
      if (error) { console.warn('Failed to fetch audit logs:', error.message); return []; }
      return data || [];
    } catch (err: any) {
      console.warn('Failed to fetch audit logs:', err?.message || err);
      return [];
    }
  },

  /**
   * Generates a descriptive, intelligent human-readable summary of what changed
   */
  formatAuditSummary(row: {
    table_name: string;
    action: string;
    old_value?: any;
    new_value?: any;
    record_id?: string | null;
  }): { title: string; subtitle?: string; badge?: string; badgeVariant?: 'default' | 'secondary' | 'destructive' | 'outline' } {
    const val = row.new_value || row.old_value || {};
    const old = row.old_value || {};
    const table = row.table_name || '';
    const act = row.action?.toUpperCase();

    if (table === 'dividend_payables' || table === 'interest_payables' || table === 'mutual_fund_payables') {
      const typeLabel = table === 'dividend_payables' ? 'Dividend' : table === 'interest_payables' ? 'Debenture Interest' : 'Mutual Fund Payout';
      const amount = val.net_payable ?? val.net_interest ?? val.gross_dividend ?? val.gross_interest ?? val.amount;
      const status = val.payment_status || (val.is_paid ? 'Paid' : 'Pending');
      const shares = val.shares_held ? `${Number(val.shares_held).toLocaleString()} kitta` : null;
      const formattedAmount = amount !== undefined && amount !== null ? `NPR ${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : null;
      
      let statusDiff = '';
      if (act === 'UPDATE' && old.payment_status && val.payment_status && old.payment_status !== val.payment_status) {
        statusDiff = `Status changed: ${old.payment_status} → ${val.payment_status}`;
      }

      return {
        title: `${typeLabel} ${formattedAmount ? `• ${formattedAmount}` : ''}`,
        subtitle: statusDiff || [status ? `Status: ${status}` : '', shares, val.payment_reference ? `Ref: ${val.payment_reference}` : ''].filter(Boolean).join(' · '),
        badge: status || typeLabel,
        badgeVariant: status === 'Paid' ? 'default' : status === 'Pending' ? 'outline' : 'secondary',
      };
    }

    if (table === 'clients') {
      const name = val.full_name || 'Shareholder';
      const boid = val.boid ? `BOID: ${val.boid}` : null;
      const clientCode = val.client_code ? `Code: ${val.client_code}` : null;
      const pan = val.pan_no || val.pan_or_citizenship ? `PAN/ID: ${val.pan_no || val.pan_or_citizenship}` : null;
      const holder = val.holder_type || val.payee_classification;

      return {
        title: name,
        subtitle: [boid, clientCode, pan, holder].filter(Boolean).join(' · '),
        badge: val.verification_status || val.status || 'Client',
        badgeVariant: 'outline',
      };
    }

    if (table === 'reconciliation_results') {
      const result = val.result || (act === 'DELETE' ? 'Recon Deleted' : 'Recon Entry');
      const expected = val.expected_amount !== undefined ? `Expected: NPR ${Number(val.expected_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '';
      const actual = val.actual_amount !== undefined ? `Actual: NPR ${Number(val.actual_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '';
      const notes = val.notes ? String(val.notes).slice(0, 70) : '';

      return {
        title: `Reconciliation ${val.payable_type ? `(${val.payable_type})` : ''} • ${result}`,
        subtitle: [expected, actual, notes].filter(Boolean).join(' · '),
        badge: result,
        badgeVariant: result === 'Matched' ? 'default' : result === 'Rejected' ? 'destructive' : 'secondary',
      };
    }

    if (table === 'companies') {
      return {
        title: val.company_name || 'Company Record',
        subtitle: [val.company_code ? `Code: ${val.company_code}` : '', val.sector_type ? `Sector: ${val.sector_type}` : '', val.status ? `Status: ${val.status}` : ''].filter(Boolean).join(' · '),
        badge: val.company_code || 'Company',
        badgeVariant: 'secondary',
      };
    }

    if (table === 'payment_batches' || table === 'payments') {
      const name = val.batch_name || (table === 'payments' ? 'Payment Transaction' : 'Payment Batch');
      const total = val.total_amount ? `NPR ${Number(val.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '';
      const method = val.payment_method;
      const status = val.status;

      return {
        title: name,
        subtitle: [total, method, status ? `Status: ${status}` : ''].filter(Boolean).join(' · '),
        badge: status || method || 'Payment',
        badgeVariant: 'default',
      };
    }

    if (table === 'upload_history') {
      return {
        title: val.file_name || 'File Upload',
        subtitle: [val.status ? `Status: ${val.status}` : '', val.row_count ? `Rows: ${Number(val.row_count).toLocaleString()}` : ''].filter(Boolean).join(' · '),
        badge: val.status || 'Upload',
        badgeVariant: 'outline',
      };
    }

    return {
      title: `${table} Record (${row.record_id ? row.record_id.slice(0, 8) + '…' : 'ID'})`,
      subtitle: act === 'DELETE' ? 'Record was removed from database' : act === 'INSERT' ? 'New record inserted' : 'Record attributes updated',
      badge: act,
      badgeVariant: act === 'DELETE' ? 'destructive' : act === 'INSERT' ? 'default' : 'secondary',
    };
  },

  /**
   * Compares old_value and new_value objects to compute field-by-field differences
   */
  calculateFieldDiffs(oldVal: any, newVal: any): AuditFieldDiff[] {
    const oldObj = (oldVal && typeof oldVal === 'object') ? oldVal : {};
    const newObj = (newVal && typeof newVal === 'object') ? newVal : {};
    const allKeys = Array.from(new Set([...Object.keys(oldObj), ...Object.keys(newObj)])).sort();

    return allKeys.map(k => {
      const o = oldObj[k];
      const n = newObj[k];
      const isChanged = JSON.stringify(o) !== JSON.stringify(n);
      return {
        field: k,
        oldValue: o !== undefined ? o : null,
        newValue: n !== undefined ? n : null,
        isChanged,
      };
    });
  },

  async deleteAllClients() {
    // First, get count of clients to delete
    const { count, error: countError } = await (supabase as any)
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', '2026-07-27 00:00:00');
    
    if (countError) {
      console.error('Error counting clients:', countError);
      throw countError;
    }
    
    console.log(`Found ${count} clients to delete`);
    
    if (!count || count === 0) {
      console.log('No clients to delete');
      return { deletedCount: 0, totalCount: 0 };
    }
    
    // Delete all clients from 2026-07-27 onwards
    const { error, data } = await (supabase as any)
      .from('clients')
      .delete()
      .gte('created_at', '2026-07-27 00:00:00');
    
    if (error) {
      console.error('Error deleting clients:', error);
      throw error;
    }
    
    // Verify deletion by counting again
    const { count: afterCount } = await (supabase as any)
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', '2026-07-27 00:00:00');
    
    const deletedCount = (count || 0) - (afterCount || 0);
    console.log(`Successfully deleted ${deletedCount} clients (was ${count}, now ${afterCount})`);
    
    return { deletedCount, totalCount: count };
  }
};
