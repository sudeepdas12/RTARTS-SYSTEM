import { supabase } from './database';

export interface SearchPayablesOptions {
  query?: string;
  companyId?: string;
  fromDate?: string;
  toDate?: string;
  fiscalYear?: string;
  classification?: string;
  limit?: number;
}

export const SearchService = {
  /**
   * Search clients and companies by keyword
   */
  async globalSearch(query: string) {
    if (!query || !query.trim()) {
      return { clients: [], companies: [], interestPayables: [], dividendPayables: [] };
    }
    const cleanQuery = query.trim();

    const [clientRes, companyRes] = await Promise.all([
      supabase
        .from('clients')
        .select('id, full_name, boid, holder_type, payee_classification, pan_or_citizenship, bank_name, bank_account_no')
        .or(`full_name.ilike.%${cleanQuery}%,boid.ilike.%${cleanQuery}%,pan_or_citizenship.ilike.%${cleanQuery}%,bank_account_no.ilike.%${cleanQuery}%`)
        .limit(20),
      supabase
        .from('companies')
        .select('id, company_code, company_name, isin, sector')
        .or(`company_name.ilike.%${cleanQuery}%,company_code.ilike.%${cleanQuery}%,isin.ilike.%${cleanQuery}%`)
        .limit(10),
    ]);

    return {
      clients: clientRes.data || [],
      companies: companyRes.data || [],
    };
  },

  /**
   * Search interest/debenture payables with date ranges and keyword filters
   */
  async searchInterestPayables(options: SearchPayablesOptions) {
    const { query, companyId, fromDate, toDate, fiscalYear, classification, limit = 50 } = options;

    let q = (supabase as any)
      .from('interest_payables')
      .select('id, gross_interest, tax_amount, net_payable, net_interest, tds_rate, due_date, payment_date, payment_status, fiscal_year, instrument_ref, payee_classification, client:clients(id, full_name, boid, pan_or_citizenship, bank_name, bank_account_no), company:companies(id, company_code, company_name)');

    if (companyId && companyId !== 'all') {
      q = q.eq('company_id', companyId);
    }
    if (fiscalYear && fiscalYear !== 'all') {
      q = q.eq('fiscal_year', fiscalYear);
    }
    if (classification && classification !== 'all') {
      q = q.eq('payee_classification', classification);
    }
    if (fromDate) {
      q = q.gte('due_date', fromDate);
    }
    if (toDate) {
      q = q.lte('due_date', toDate);
    }
    if (query && query.trim()) {
      const clean = query.trim();
      q = q.or(`instrument_ref.ilike.%${clean}%,payment_reference.ilike.%${clean}%,fiscal_year.ilike.%${clean}%`);
    }

    q = q.order('due_date', { ascending: false, nullsFirst: false }).limit(limit);

    const { data, error } = await q;
    if (error) {
      console.error('Error searching interest payables:', error);
      return [];
    }
    return data || [];
  },

  /**
   * Search dividend payables with date ranges and keyword filters
   */
  async searchDividendPayables(options: SearchPayablesOptions) {
    const { query, companyId, fiscalYear, classification, limit = 50 } = options;

    let q = (supabase as any)
      .from('dividend_payables')
      .select('id, gross_dividend, tax_amount, net_payable, tds_rate, payment_status, fiscal_year, dividend_type, payee_classification, client:clients(id, full_name, boid, pan_or_citizenship, bank_name, bank_account_no), company:companies(id, company_code, company_name)');

    if (companyId && companyId !== 'all') {
      q = q.eq('company_id', companyId);
    }
    if (fiscalYear && fiscalYear !== 'all') {
      q = q.eq('fiscal_year', fiscalYear);
    }
    if (classification && classification !== 'all') {
      q = q.eq('payee_classification', classification);
    }
    if (query && query.trim()) {
      const clean = query.trim();
      q = q.or(`payment_reference.ilike.%${clean}%,fiscal_year.ilike.%${clean}%`);
    }

    q = q.order('created_at', { ascending: false }).limit(limit);

    const { data, error } = await q;
    if (error) {
      console.error('Error searching dividend payables:', error);
      return [];
    }
    return data || [];
  },
};
