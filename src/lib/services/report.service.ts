import { supabase, fetchAllRows } from './database';
import { getInvestorDemographicGroup } from './investor-category';

export interface ReportFilters {
  companyId?: string;
  startDate?: string;
  endDate?: string;
  fiscalYear?: string;
  status?: string;
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

function applyDateFilter(query: any, field: string, startDate?: string, endDate?: string) {
  if (startDate) query = query.gte(field, startDate);
  if (endDate) query = query.lte(field, endDate + 'T23:59:59');
  return query;
}

function nr(v: unknown): number {
  return Number(v ?? 0);
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface DividendRegisterRow {
  id: string;
  boid: string | null;
  full_name: string;
  company_name: string;
  shares_held: number;
  dividend_rate: number;
  dividend_type: string;
  gross_dividend: number;
  tax_amount: number;
  net_payable: number;
  payment_status: string;
  payment_date: string | null;
  payment_reference: string | null;
  fiscal_year: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  pan_or_citizenship: string | null;
}

export interface InterestRegisterRow {
  id: string;
  boid: string | null;
  full_name: string;
  company_name: string;
  instrument_ref: string | null;
  gross_interest: number;
  tax_amount: number;
  net_payable: number;
  payment_status: string;
  due_date: string | null;
  payment_date: string | null;
  payment_reference: string | null;
  fiscal_year: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  pan_or_citizenship: string | null;
}

export interface TaxRegisterRow {
  id: string;
  boid: string | null;
  full_name: string;
  pan_or_citizenship: string | null;
  company_name: string;
  payable_type: string;
  gross_amount: number;
  tds_rate: number;
  tax_amount: number;
  net_payable: number;
  fiscal_year: string | null;
  payment_date: string | null;
}

export interface PendingPaymentRow {
  id: string;
  boid: string | null;
  full_name: string;
  company_name: string;
  payable_type: string;
  gross_amount: number;
  tax_amount: number;
  net_payable: number;
  fiscal_year: string | null;
  due_date: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
}

export interface PaymentRegisterRow {
  id: string;
  batch_name: string;
  payment_method: string;
  status: string;
  total_payments: number;
  total_amount: number;
  fiscal_year: string | null;
  created_at: string;
  approved_at: string | null;
  processed_at: string | null;
}

export interface BonusShareRow {
  id: string;
  boid: string | null;
  full_name: string;
  company_name: string;
  shares_held: number;
  dividend_type: string;
  bonus_actual: number;
  bonus_issued: number;
  bonus_fraction: number;
  after_bonus_kitta: number;
  bonus_tax: number;
  net_payable: number;
  fiscal_year: string | null;
  payment_status: string;
}

export interface ReconciliationReportRow {
  id: string;
  boid: string | null;
  shareholder_name: string | null;
  category: string | null;
  excel_amount: number;
  system_amount: number;
  difference: number;
  status: string;
  created_at: string;
}

export interface UploadHistoryRow {
  id: string;
  file_name: string;
  file_type: string | null;
  status: string;
  rows_processed: number;
  rows_failed: number;
  created_at: string;
}

export interface AuditReportRow {
  id: string;
  action: string;
  previous_status: string | null;
  new_status: string | null;
  remarks: string | null;
  performed_by: string | null;
  performed_at: string;
}

// ─── Service ───────────────────────────────────────────────────────────────────

export const ReportService = {

  // 1. Dividend Register
  async getDividendRegister(filters: ReportFilters = {}): Promise<DividendRegisterRow[]> {
    try {
      const data = await fetchAllRows<any>((from, to) => {
        let query = supabase
          .from('dividend_payables')
          .select('id, shares_held, dividend_rate, dividend_type, gross_dividend, tax_amount, net_payable, payment_status, payment_date, payment_reference, fiscal_year, client:clients(boid, full_name, pan_or_citizenship, bank_name, bank_account_no), company:companies(company_name)')
          .order('created_at', { ascending: false })
          .range(from, to);

        if (filters.companyId && filters.companyId !== 'all') query = query.eq('company_id', filters.companyId);
        if (filters.fiscalYear && filters.fiscalYear !== 'all') query = query.eq('fiscal_year', filters.fiscalYear);
        if (filters.status && filters.status !== 'all') query = (query as any).eq('payment_status', filters.status as any);
        query = applyDateFilter(query, 'payment_date', filters.startDate, filters.endDate);
        return query;
      });

      return (data || []).map((row: any) => ({
        id: row.id,
        boid: row.client?.boid ?? null,
        full_name: row.client?.full_name ?? 'Unknown',
        company_name: row.company?.company_name ?? 'Unknown',
        shares_held: nr(row.shares_held),
        dividend_rate: nr(row.dividend_rate),
        dividend_type: row.dividend_type ?? 'Cash',
        gross_dividend: nr(row.gross_dividend),
        tax_amount: nr(row.tax_amount),
        net_payable: nr(row.net_payable),
        payment_status: row.payment_status ?? 'Pending',
        payment_date: row.payment_date ?? null,
        payment_reference: row.payment_reference ?? null,
        fiscal_year: row.fiscal_year ?? null,
        bank_name: row.client?.bank_name ?? null,
        bank_account_no: row.client?.bank_account_no ?? null,
        pan_or_citizenship: row.client?.pan_or_citizenship ?? null,
      }));
    } catch (err) {
      console.error('getDividendRegister error:', err);
      return [];
    }
  },

  // 1b. Mutual Fund Register
  async getMutualFundRegister(filters: ReportFilters = {}): Promise<DividendRegisterRow[]> {
    try {
      const data = await fetchAllRows<any>((from, to) => {
        let query = (supabase as any)
          .from('mutual_fund_payables')
          .select('id, shares_held, dividend_rate, dividend_type, gross_dividend, tax_amount, net_payable, payment_status, payment_date, payment_reference, fiscal_year, client:clients(boid, full_name, pan_or_citizenship, bank_name, bank_account_no), company:companies(company_name)')
          .order('created_at', { ascending: false })
          .range(from, to);

        if (filters.companyId && filters.companyId !== 'all') query = query.eq('company_id', filters.companyId);
        if (filters.fiscalYear && filters.fiscalYear !== 'all') query = query.eq('fiscal_year', filters.fiscalYear);
        if (filters.status && filters.status !== 'all') query = (query as any).eq('payment_status', filters.status as any);
        query = applyDateFilter(query, 'payment_date', filters.startDate, filters.endDate);
        return query;
      });

      return (data || []).map((row: any) => ({
        id: row.id,
        boid: row.client?.boid ?? null,
        full_name: row.client?.full_name ?? 'Unknown',
        company_name: row.company?.company_name ?? 'Unknown',
        shares_held: nr(row.shares_held),
        dividend_rate: nr(row.dividend_rate),
        dividend_type: row.dividend_type ?? 'Distribution',
        gross_dividend: nr(row.gross_dividend),
        tax_amount: nr(row.tax_amount),
        net_payable: nr(row.net_payable),
        payment_status: row.payment_status ?? 'Pending',
        payment_date: row.payment_date ?? null,
        payment_reference: row.payment_reference ?? null,
        fiscal_year: row.fiscal_year ?? null,
        bank_name: row.client?.bank_name ?? null,
        bank_account_no: row.client?.bank_account_no ?? null,
        pan_or_citizenship: row.client?.pan_or_citizenship ?? null,
      }));
    } catch (err) {
      console.error('getMutualFundRegister error:', err);
      return [];
    }
  },

  // 2. Interest Register
  async getInterestRegister(filters: ReportFilters = {}): Promise<InterestRegisterRow[]> {
    try {
      const data = await fetchAllRows<any>((from, to) => {
        let query = supabase
          .from('interest_payables')
          .select('id, instrument_ref, gross_interest, tax_amount, net_payable, payment_status, due_date, payment_date, payment_reference, fiscal_year, client:clients(boid, full_name, pan_or_citizenship, bank_name, bank_account_no), company:companies(company_name)')
          .order('due_date', { ascending: false })
          .range(from, to);

        if (filters.companyId && filters.companyId !== 'all') query = query.eq('company_id', filters.companyId);
        if (filters.fiscalYear && filters.fiscalYear !== 'all') query = query.eq('fiscal_year', filters.fiscalYear);
        if (filters.status && filters.status !== 'all') query = (query as any).eq('payment_status', filters.status as any);
        query = applyDateFilter(query, 'due_date', filters.startDate, filters.endDate);
        return query;
      });

      return (data || []).map((row: any) => ({
        id: row.id,
        boid: row.client?.boid ?? null,
        full_name: row.client?.full_name ?? 'Unknown',
        company_name: row.company?.company_name ?? 'Unknown',
        instrument_ref: row.instrument_ref ?? null,
        gross_interest: nr(row.gross_interest),
        tax_amount: nr(row.tax_amount),
        net_payable: nr(row.net_payable),
        payment_status: row.payment_status ?? 'Pending',
        due_date: row.due_date ?? null,
        payment_date: row.payment_date ?? null,
        payment_reference: row.payment_reference ?? null,
        fiscal_year: row.fiscal_year ?? null,
        bank_name: row.client?.bank_name ?? null,
        bank_account_no: row.client?.bank_account_no ?? null,
        pan_or_citizenship: row.client?.pan_or_citizenship ?? null,
      }));
    } catch (err) {
      console.error('getInterestRegister error:', err);
      return [];
    }
  },

  // 3. TDS / Tax Register (combined dividend + interest)
  // 3. TDS / Tax Register (combined dividend + interest + mutual fund)
  async getTaxRegister(filters: ReportFilters = {}): Promise<TaxRegisterRow[]> {
    try {
      const [divData, intData, mutualFundData] = await Promise.all([
        fetchAllRows<any>((from, to) => {
          let q = supabase
            .from('dividend_payables')
            .select('id, gross_dividend, tax_amount, net_payable, fiscal_year, payment_date, client:clients(boid, full_name, pan_or_citizenship), company:companies(company_name)')
            .order('created_at', { ascending: false })
            .range(from, to);
          if (filters.companyId && filters.companyId !== 'all') q = q.eq('company_id', filters.companyId);
          if (filters.fiscalYear && filters.fiscalYear !== 'all') q = q.eq('fiscal_year', filters.fiscalYear);
          return applyDateFilter(q, 'payment_date', filters.startDate, filters.endDate);
        }),
        fetchAllRows<any>((from, to) => {
          let q = supabase
            .from('interest_payables')
            .select('id, gross_interest, tax_amount, net_payable, fiscal_year, payment_date, client:clients(boid, full_name, pan_or_citizenship), company:companies(company_name)')
            .order('created_at', { ascending: false })
            .range(from, to);
          if (filters.companyId && filters.companyId !== 'all') q = q.eq('company_id', filters.companyId);
          if (filters.fiscalYear && filters.fiscalYear !== 'all') q = q.eq('fiscal_year', filters.fiscalYear);
          return applyDateFilter(q, 'payment_date', filters.startDate, filters.endDate);
        }),
        fetchAllRows<any>((from, to) => {
          let q = (supabase as any)
            .from('mutual_fund_payables')
            .select('id, gross_dividend, tax_amount, net_payable, fiscal_year, payment_date, client:clients(boid, full_name, pan_or_citizenship), company:companies(company_name)')
            .order('created_at', { ascending: false })
            .range(from, to);
          if (filters.companyId && filters.companyId !== 'all') q = q.eq('company_id', filters.companyId);
          if (filters.fiscalYear && filters.fiscalYear !== 'all') q = q.eq('fiscal_year', filters.fiscalYear);
          return applyDateFilter(q, 'payment_date', filters.startDate, filters.endDate);
        }),
      ]);

      const rows: TaxRegisterRow[] = [];

      (divData || []).forEach((row: any) => {
        const gross = nr(row.gross_dividend);
        const tax = nr(row.tax_amount);
        rows.push({
          id: row.id,
          boid: row.client?.boid ?? null,
          full_name: row.client?.full_name ?? 'Unknown',
          pan_or_citizenship: row.client?.pan_or_citizenship ?? null,
          company_name: row.company?.company_name ?? 'Unknown',
          payable_type: 'Dividend',
          gross_amount: gross,
          tds_rate: gross > 0 ? Math.round((tax / gross) * 100 * 100) / 100 : 0,
          tax_amount: tax,
          net_payable: nr(row.net_payable),
          fiscal_year: row.fiscal_year ?? null,
          payment_date: row.payment_date ?? null,
        });
      });

      (intData || []).forEach((row: any) => {
        const gross = nr(row.gross_interest);
        const tax = nr(row.tax_amount);
        rows.push({
          id: row.id,
          boid: row.client?.boid ?? null,
          full_name: row.client?.full_name ?? 'Unknown',
          pan_or_citizenship: row.client?.pan_or_citizenship ?? null,
          company_name: row.company?.company_name ?? 'Unknown',
          payable_type: 'Interest',
          gross_amount: gross,
          tds_rate: gross > 0 ? Math.round((tax / gross) * 100 * 100) / 100 : 0,
          tax_amount: tax,
          net_payable: nr(row.net_payable),
          fiscal_year: row.fiscal_year ?? null,
          payment_date: row.payment_date ?? null,
        });
      });

      (mutualFundData || []).forEach((row: any) => {
        const gross = nr(row.gross_dividend);
        const tax = nr(row.tax_amount);
        rows.push({
          id: row.id,
          boid: row.client?.boid ?? null,
          full_name: row.client?.full_name ?? 'Unknown',
          pan_or_citizenship: row.client?.pan_or_citizenship ?? null,
          company_name: row.company?.company_name ?? 'Unknown',
          payable_type: 'Mutual Fund',
          gross_amount: gross,
          tds_rate: gross > 0 ? Math.round((tax / gross) * 100 * 100) / 100 : 0,
          tax_amount: tax,
          net_payable: nr(row.net_payable),
          fiscal_year: row.fiscal_year ?? null,
          payment_date: row.payment_date ?? null,
        });
      });

      return rows;
    } catch (err) {
      console.error('getTaxRegister error:', err);
      return [];
    }
  },

  // 4. Pending Payments
  async getPendingPayments(filters: ReportFilters = {}): Promise<PendingPaymentRow[]> {
    try {
      const [divData, mfData, intData] = await Promise.all([
        fetchAllRows<any>((from, to) => {
          let q = supabase
            .from('dividend_payables')
            .select('id, gross_dividend, tax_amount, net_payable, fiscal_year, client:clients(boid, full_name, bank_name, bank_account_no), company:companies(company_name)')
            .eq('payment_status', 'Pending')
            .order('created_at', { ascending: false })
            .range(from, to);
          if (filters.companyId && filters.companyId !== 'all') q = q.eq('company_id', filters.companyId);
          if (filters.fiscalYear && filters.fiscalYear !== 'all') q = q.eq('fiscal_year', filters.fiscalYear);
          return q;
        }),
        fetchAllRows<any>((from, to) => {
          let q = (supabase as any)
            .from('mutual_fund_payables')
            .select('id, gross_dividend, tax_amount, net_payable, fiscal_year, client:clients(boid, full_name, bank_name, bank_account_no), company:companies(company_name)')
            .eq('payment_status', 'Pending')
            .order('created_at', { ascending: false })
            .range(from, to);
          if (filters.companyId && filters.companyId !== 'all') q = q.eq('company_id', filters.companyId);
          if (filters.fiscalYear && filters.fiscalYear !== 'all') q = q.eq('fiscal_year', filters.fiscalYear);
          return q;
        }),
        fetchAllRows<any>((from, to) => {
          let q = supabase
            .from('interest_payables')
            .select('id, gross_interest, tax_amount, net_payable, fiscal_year, due_date, client:clients(boid, full_name, bank_name, bank_account_no), company:companies(company_name)')
            .eq('payment_status', 'Pending')
            .order('due_date', { ascending: true })
            .range(from, to);
          if (filters.companyId && filters.companyId !== 'all') q = q.eq('company_id', filters.companyId);
          if (filters.fiscalYear && filters.fiscalYear !== 'all') q = q.eq('fiscal_year', filters.fiscalYear);
          return q;
        }),
      ]);

      const rows: PendingPaymentRow[] = [];
      (divData || []).forEach((row: any) => {
        rows.push({
          id: row.id,
          boid: row.client?.boid ?? null,
          full_name: row.client?.full_name ?? 'Unknown',
          company_name: row.company?.company_name ?? 'Unknown',
          payable_type: 'Dividend',
          gross_amount: nr(row.gross_dividend),
          tax_amount: nr(row.tax_amount),
          net_payable: nr(row.net_payable),
          fiscal_year: row.fiscal_year ?? null,
          due_date: null,
          bank_name: row.client?.bank_name ?? null,
          bank_account_no: row.client?.bank_account_no ?? null,
        });
      });
      (intData || []).forEach((row: any) => {
        rows.push({
          id: row.id,
          boid: row.client?.boid ?? null,
          full_name: row.client?.full_name ?? 'Unknown',
          company_name: row.company?.company_name ?? 'Unknown',
          payable_type: 'Interest',
          gross_amount: nr(row.gross_interest),
          tax_amount: nr(row.tax_amount),
          net_payable: nr(row.net_payable),
          fiscal_year: row.fiscal_year ?? null,
          due_date: row.due_date ?? null,
          bank_name: row.client?.bank_name ?? null,
          bank_account_no: row.client?.bank_account_no ?? null,
        });
      });
      (mfData || []).forEach((row: any) => {
        rows.push({
          id: row.id,
          boid: row.client?.boid ?? null,
          full_name: row.client?.full_name ?? 'Unknown',
          company_name: row.company?.company_name ?? 'Unknown',
          payable_type: 'Mutual Fund',
          gross_amount: nr(row.gross_dividend),
          tax_amount: nr(row.tax_amount),
          net_payable: nr(row.net_payable),
          fiscal_year: row.fiscal_year ?? null,
          due_date: null,
          bank_name: row.client?.bank_name ?? null,
          bank_account_no: row.client?.bank_account_no ?? null,
        });
      });

      return rows;
    } catch (err) {
      console.error('getPendingPayments error:', err);
      return [];
    }
  },

  // 5. Payment Batch Register
  async getPaymentRegister(filters: ReportFilters = {}): Promise<PaymentRegisterRow[]> {
    try {
      const data = await fetchAllRows<any>((from, to) => {
        let query = (supabase as any)
          .from('payment_batches')
          .select('id, batch_name, payment_method, status, total_payments, total_amount, fiscal_year, created_at, approved_at, processed_at')
          .order('created_at', { ascending: false })
          .range(from, to);

        if (filters.companyId && filters.companyId !== 'all') query = query.eq('company_id', filters.companyId);
        if (filters.status && filters.status !== 'all') query = (query as any).eq('status', filters.status as any);
        query = applyDateFilter(query, 'created_at', filters.startDate, filters.endDate);
        return query;
      });

      return (data || []).map((row: any) => ({
        id: row.id,
        batch_name: row.batch_name ?? '',
        payment_method: row.payment_method ?? 'NEFT',
        status: row.status ?? 'Draft',
        total_payments: nr(row.total_payments),
        total_amount: nr(row.total_amount),
        fiscal_year: row.fiscal_year ?? null,
        created_at: row.created_at,
        approved_at: row.approved_at ?? null,
        processed_at: row.processed_at ?? null,
      }));
    } catch (err) {
      console.error('getPaymentRegister error:', err);
      return [];
    }
  },

  // 6. Bonus Share Report
  async getBonusShareReport(filters: ReportFilters = {}): Promise<BonusShareRow[]> {
    try {
      let query = supabase
        .from('dividend_payables')
        .select('id, shares_held, dividend_type, bonus_actual, bonus_issued, bonus_fraction, after_bonus_kitta, bonus_tax, net_payable, fiscal_year, payment_status, client:clients(boid, full_name), company:companies(company_name)')
        .in('dividend_type', ['Bonus', 'Stock', 'Combined'])
        .order('created_at', { ascending: false });

      if (filters.companyId && filters.companyId !== 'all') query = query.eq('company_id', filters.companyId);
      if (filters.fiscalYear && filters.fiscalYear !== 'all') query = query.eq('fiscal_year', filters.fiscalYear);

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((row: any) => ({
        id: row.id,
        boid: row.client?.boid ?? null,
        full_name: row.client?.full_name ?? 'Unknown',
        company_name: row.company?.company_name ?? 'Unknown',
        shares_held: nr(row.shares_held),
        dividend_type: row.dividend_type ?? 'Bonus',
        bonus_actual: nr(row.bonus_actual),
        bonus_issued: nr(row.bonus_issued),
        bonus_fraction: nr(row.bonus_fraction),
        after_bonus_kitta: nr(row.after_bonus_kitta),
        bonus_tax: nr(row.bonus_tax),
        net_payable: nr(row.net_payable),
        fiscal_year: row.fiscal_year ?? null,
        payment_status: row.payment_status ?? 'Pending',
      }));
    } catch (err) {
      console.error('getBonusShareReport error:', err);
      return [];
    }
  },

  // 7. Cash Dividend Report
  async getCashDividendReport(filters: ReportFilters = {}): Promise<DividendRegisterRow[]> {
    return this.getDividendRegister({ ...filters, status: undefined }).then(rows =>
      rows.filter(r => r.dividend_type === 'Cash' || !r.dividend_type)
    );
  },

  // 8. Right Share Report
  async getRightShareReport(filters: ReportFilters = {}): Promise<DividendRegisterRow[]> {
    return this.getDividendRegister(filters).then(rows =>
      rows.filter(r => r.dividend_type === 'Right')
    );
  },

  // 9. Reconciliation Report
  async getReconciliationReport(filters: ReportFilters = {}): Promise<ReconciliationReportRow[]> {
    try {
      let query = (supabase as any)
        .from('reconciliation_results')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);

      if (filters.status && filters.status !== 'all') query = (query as any).eq('result', filters.status as any);
      query = applyDateFilter(query, 'created_at', filters.startDate, filters.endDate);

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((row: any) => ({
        id: row.id,
        boid: row.boid ?? null,
        shareholder_name: row.shareholder_name ?? null,
        category: row.category ?? null,
        excel_amount: nr(row.excel_amount),
        system_amount: nr(row.system_amount),
        difference: nr(row.difference),
        status: row.result ?? 'Pending',
        created_at: row.created_at,
      }));
    } catch (err) {
      console.error('getReconciliationReport error:', err);
      return [];
    }
  },

  // 10. Upload History Report
  async getUploadHistoryReport(filters: ReportFilters = {}): Promise<UploadHistoryRow[]> {
    try {
      let query = (supabase as any)
        .from('upload_history')
        .select('id, file_name, file_type, status, rows_processed, rows_failed, created_at')
        .order('created_at', { ascending: false })
        .limit(500);

      if (filters.status && filters.status !== 'all') query = (query as any).eq('status', filters.status as any);
      query = applyDateFilter(query, 'created_at', filters.startDate, filters.endDate);

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((row: any) => ({
        id: row.id,
        file_name: row.file_name ?? '',
        file_type: row.file_type ?? null,
        status: row.status ?? '',
        rows_processed: nr(row.rows_processed),
        rows_failed: nr(row.rows_failed),
        created_at: row.created_at,
      }));
    } catch (err) {
      console.error('getUploadHistoryReport error:', err);
      return [];
    }
  },

  // 11. Audit Report
  async getAuditReport(filters: ReportFilters = {}): Promise<AuditReportRow[]> {
    try {
      let query = (supabase as any)
        .from('approval_logs')
        .select('id, action, previous_status, new_status, remarks, performed_by, performed_at')
        .order('performed_at', { ascending: false })
        .limit(500);

      query = applyDateFilter(query, 'performed_at', filters.startDate, filters.endDate);

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((row: any) => ({
        id: row.id,
        action: row.action ?? '',
        previous_status: row.previous_status ?? null,
        new_status: row.new_status ?? null,
        remarks: row.remarks ?? null,
        performed_by: row.performed_by ?? null,
        performed_at: row.performed_at,
      }));
    } catch (err) {
      console.error('getAuditReport error:', err);
      return [];
    }
  },

  // 12. Company Report
  async getCompanyReport(filters: ReportFilters = {}): Promise<any[]> {
    try {
      let query = supabase
        .from('companies')
        .select('id, company_code, company_name, company_type, isin, listed_date, sector_type, registrar, fiscal_year, dividend_rate, debenture_rate, contact_person, phone, email, address')
        .order('company_name', { ascending: true });

      if (filters.companyId && filters.companyId !== 'all') query = query.eq('id', filters.companyId);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('getCompanyReport error:', err);
      return [];
    }
  },

  // 13. Client Profile Report
  async getClientProfileReport(filters: ReportFilters = {}): Promise<any[]> {
    try {
      let query = supabase
        .from('clients')
        .select('id, client_code, full_name, boid, father_name, grandfather_name, pan_or_citizenship, address, district, phone, email, bank_name, bank_account_no, company_id, company:companies(company_name)')
        .order('full_name', { ascending: true });

      if (filters.companyId && filters.companyId !== 'all') {
        (query as any).eq('company_id', filters.companyId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('getClientProfileReport error:', err);
      return [];
    }
  },

  // 14. Returned Payments Report
  async getReturnedPaymentsReport(filters: ReportFilters = {}): Promise<any[]> {
    try {
      let query = (supabase as any)
        .from('payments')
        .select('id, batch_id, net_amount, bank_name, bank_account_no, payment_status, payment_reference, payment_date, client:clients(full_name, boid), company:companies(company_name)')
        .eq('payment_status', 'Returned')
        .order('payment_date', { ascending: false })
        .limit(500);

      if (filters.companyId && filters.companyId !== 'all') query = query.eq('company_id', filters.companyId);
      query = applyDateFilter(query, 'payment_date', filters.startDate, filters.endDate);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('getReturnedPaymentsReport error:', err);
      return [];
    }
  },

  // 15. Bounced Cheques Report
  async getBouncedChequesReport(filters: ReportFilters = {}): Promise<any[]> {
    try {
      let query = (supabase as any)
        .from('payments')
        .select('id, batch_id, net_amount, bank_name, bank_account_no, cheque_no, payment_status, payment_reference, payment_date, client:clients(full_name, boid), company:companies(company_name)')
        .eq('payment_status', 'Bounced')
        .order('payment_date', { ascending: false })
        .limit(500);

      if (filters.companyId && filters.companyId !== 'all') query = query.eq('company_id', filters.companyId);
      query = applyDateFilter(query, 'payment_date', filters.startDate, filters.endDate);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('getBouncedChequesReport error:', err);
      return [];
    }
  },

  // 16. Share Allocation Report
  async getAllocationReport(filters: ReportFilters = {}): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('dividend_payables')
        .select('id, shares_held, dividend_type, bonus_actual, bonus_issued, after_bonus_kitta, fiscal_year, client:clients(full_name, boid), company:companies(company_name)')
        .in('dividend_type', ['Bonus', 'Stock', 'Combined'])
        .order('created_at', { ascending: false })
        .limit(1000);

      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('getAllocationReport error:', err);
      return [];
    }
  },

  // 17. CDSC Report
  async getCdscReport(filters: ReportFilters = {}): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('dividend_payables')
        .select('id, client_id, company_id, shares_held, gross_dividend, tax_amount, net_payable, payment_status, fiscal_year, client:clients(boid, full_name, pan_or_citizenship), company:companies(company_name, company_code)')
        .order('created_at', { ascending: false })
        .limit(1000);

      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('getCdscReport error:', err);
      return [];
    }
  },

  // 18. Bank Statement Summary Report
  async getBankStatementReport(filters: ReportFilters = {}): Promise<any[]> {
    try {
      let query = (supabase as any)
        .from('bank_statements')
        .select('id, bank_name, account_no, statement_date, file_name, total_transactions, total_credit, total_debit, is_reconciled, created_at')
        .order('statement_date', { ascending: false })
        .limit(100);

      query = applyDateFilter(query, 'statement_date', filters.startDate, filters.endDate);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('getBankStatementReport error:', err);
      return [];
    }
  },

  // 19. Shareholder Demographics Report
  // Lists every holder for a company broken down by demographic group
  // (Natural Person / Legal Person / Mutual Fund / Tax Exempt / Foreign).
  async getShareholderDemographicsReport(filters: ReportFilters = {}): Promise<any[]> {
    try {
      let query = supabase
        .from('clients')
        .select('id, client_code, boid, full_name, father_name, grandfather_name, pan_or_citizenship, address, district, phone, bank_name, bank_account_no, holder_type, company_id, company:companies(company_name, company_code)')
        .order('full_name', { ascending: true });

      if (filters.companyId && filters.companyId !== 'all') {
        query = (query as any).eq('company_id', filters.companyId);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((c: any) => ({
        id: c.id,
        client_code: c.client_code ?? '',
        boid: c.boid ?? '',
        full_name: c.full_name ?? '',
        father_name: c.father_name ?? '',
        grandfather_name: c.grandfather_name ?? '',
        pan_or_citizenship: c.pan_or_citizenship ?? '',
        address: c.address ?? '',
        district: c.district ?? '',
        phone: c.phone ?? '',
        bank_name: c.bank_name ?? '',
        bank_account_no: c.bank_account_no ?? '',
        holder_type: c.holder_type ?? '',
        investor_type: getInvestorDemographicGroup(c.holder_type),
        demographic_group: getInvestorDemographicGroup(c.holder_type),
        company_id: c.company_id ?? '',
        company_name: c.company?.company_name ?? '',
        company_code: c.company?.company_code ?? '',
      }));
    } catch (err) {
      console.error('getShareholderDemographicsReport error:', err);
      return [];
    }
  },
};
