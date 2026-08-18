import { supabase, throwIfError } from './database';
import { Database } from '@/integrations/supabase/types';

export const AuditService = {
  async getLoginLogs(limit = 100) {
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

  async getAuditLogs(limit = 100, tableName?: string) {
    try {
      let query = (supabase as any)
        .from('audit_logs')
        .select('*')
        .order('action_time', { ascending: false })
        .limit(limit);
      
      if (tableName) {
        query = query.eq('table_name', tableName);
      }
      
      const { data, error } = await query;
      if (error) { console.warn('Failed to fetch audit logs:', error.message); return []; }
      return data || [];
    } catch (err: any) {
      console.warn('Failed to fetch audit logs:', err?.message || err);
      return [];
    }
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
