import { supabase } from '@/integrations/supabase/client';

export interface ScheduledReport {
  id: string;
  report_type: string;
  report_name: string;
  filters: Record<string, unknown>;
  schedule_type: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  schedule_time: string; // HH:MM format
  schedule_day?: number; // 0-6 for weekly (0=Sunday), 1-31 for monthly
  schedule_month?: number; // 1-12 for quarterly
  recipients: string[]; // email addresses
  export_format: 'pdf' | 'excel' | 'both';
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ReportVersion {
  id: string;
  report_type: string;
  report_name: string;
  filters: Record<string, unknown>;
  export_format: 'pdf' | 'excel';
  file_url: string | null;
  file_size: number | null;
  record_count: number;
  generated_by: string;
  generated_at: string;
  parameters: Record<string, unknown>;
}

export const ScheduledReportService = {
  async getScheduledReports(): Promise<ScheduledReport[]> {
    try {
      const { data, error } = await (supabase as any)
        .from('scheduled_reports')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.warn('Failed to fetch scheduled reports:', error.message);
        return [];
      }
      return (data || []) as ScheduledReport[];
    } catch (err: any) {
      console.warn('Failed to fetch scheduled reports:', err?.message || err);
      return [];
    }
  },

  async getScheduledReportById(id: string): Promise<ScheduledReport | null> {
    try {
      const { data, error } = await (supabase as any)
        .from('scheduled_reports')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) {
        console.warn('Failed to fetch scheduled report:', error.message);
        return null;
      }
      return data as ScheduledReport;
    } catch (err: any) {
      console.warn('Failed to fetch scheduled report:', err?.message || err);
      return null;
    }
  },

  async createScheduledReport(report: Omit<ScheduledReport, 'id' | 'created_at' | 'updated_at' | 'last_run_at' | 'next_run_at'>): Promise<ScheduledReport | null> {
    try {
      const { data, error } = await (supabase as any)
        .from('scheduled_reports')
        .insert({
          ...report,
          last_run_at: null,
          next_run_at: null,
        })
        .select()
        .single();
      
      if (error) {
        console.warn('Failed to create scheduled report:', error.message);
        return null;
      }
      return data as ScheduledReport;
    } catch (err: any) {
      console.warn('Failed to create scheduled report:', err?.message || err);
      return null;
    }
  },

  async updateScheduledReport(id: string, updates: Partial<ScheduledReport>): Promise<boolean> {
    try {
      const { error } = await (supabase as any)
        .from('scheduled_reports')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      
      if (error) {
        console.warn('Failed to update scheduled report:', error.message);
        return false;
      }
      return true;
    } catch (err: any) {
      console.warn('Failed to update scheduled report:', err?.message || err);
      return false;
    }
  },

  async deleteScheduledReport(id: string): Promise<boolean> {
    try {
      const { error } = await (supabase as any)
        .from('scheduled_reports')
        .delete()
        .eq('id', id);
      
      if (error) {
        console.warn('Failed to delete scheduled report:', error.message);
        return false;
      }
      return true;
    } catch (err: any) {
      console.warn('Failed to delete scheduled report:', err?.message || err);
      return false;
    }
  },

  async toggleScheduledReport(id: string, isActive: boolean): Promise<boolean> {
    return this.updateScheduledReport(id, { is_active: isActive });
  },

  // ─── Report Versioning ───────────────────────────────────────────────────────

  async getReportVersions(reportType?: string, limit = 50): Promise<ReportVersion[]> {
    try {
      let query = (supabase as any)
        .from('report_versions')
        .select('*')
        .order('generated_at', { ascending: false })
        .limit(limit);
      
      if (reportType) {
        query = query.eq('report_type', reportType);
      }
      
      const { data, error } = await query;
      
      if (error) {
        console.warn('Failed to fetch report versions:', error.message);
        return [];
      }
      return (data || []) as ReportVersion[];
    } catch (err: any) {
      console.warn('Failed to fetch report versions:', err?.message || err);
      return [];
    }
  },

  async getReportVersionById(id: string): Promise<ReportVersion | null> {
    try {
      const { data, error } = await (supabase as any)
        .from('report_versions')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) {
        console.warn('Failed to fetch report version:', error.message);
        return null;
      }
      return data as ReportVersion;
    } catch (err: any) {
      console.warn('Failed to fetch report version:', err?.message || err);
      return null;
    }
  },

  async saveReportVersion(version: Omit<ReportVersion, 'id' | 'generated_at'>): Promise<ReportVersion | null> {
    try {
      const { data, error } = await (supabase as any)
        .from('report_versions')
        .insert({
          ...version,
          generated_at: new Date().toISOString(),
        })
        .select()
        .single();
      
      if (error) {
        console.warn('Failed to save report version:', error.message);
        return null;
      }
      return data as ReportVersion;
    } catch (err: any) {
      console.warn('Failed to save report version:', err?.message || err);
      return null;
    }
  },

  async deleteReportVersion(id: string): Promise<boolean> {
    try {
      const { error } = await (supabase as any)
        .from('report_versions')
        .delete()
        .eq('id', id);
      
      if (error) {
        console.warn('Failed to delete report version:', error.message);
        return false;
      }
      return true;
    } catch (err: any) {
      console.warn('Failed to delete report version:', err?.message || err);
      return false;
    }
  },

  async getReportVersionStats(): Promise<{
    totalReports: number;
    totalByType: Record<string, number>;
    recentReports: ReportVersion[];
  }> {
    try {
      const { data, error } = await (supabase as any)
        .from('report_versions')
        .select('*')
        .order('generated_at', { ascending: false })
        .limit(100);
      
      if (error) {
        console.warn('Failed to fetch report version stats:', error.message);
        return { totalReports: 0, totalByType: {}, recentReports: [] };
      }
      
      const versions = (data || []) as ReportVersion[];
      const totalByType: Record<string, number> = {};
      versions.forEach(v => {
        totalByType[v.report_type] = (totalByType[v.report_type] || 0) + 1;
      });
      
      return {
        totalReports: versions.length,
        totalByType,
        recentReports: versions.slice(0, 10),
      };
    } catch (err: any) {
      console.warn('Failed to fetch report version stats:', err?.message || err);
      return { totalReports: 0, totalByType: {}, recentReports: [] };
    }
  }
};