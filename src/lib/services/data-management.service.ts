import { supabase, fetchAllRows } from './database';
import * as XLSX from 'xlsx';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface CompanyFiscalData {
  company_id: string;
  company_name: string;
  company_code: string;
  fiscal_year: string;
  dividend_count: number;
  dividend_gross: number;
  dividend_net: number;
  interest_count: number;
  interest_gross: number;
  interest_net: number;
  mutual_fund_count: number;
  mutual_fund_gross: number;
  mutual_fund_net: number;
  total_paid: number;
  total_pending: number;
}

export interface ClientFiscalData {
  client_id: string;
  full_name: string;
  boid: string;
  client_code: string;
  company_name: string;
  fiscal_year: string;
  payable_type: 'dividend' | 'interest' | 'mutual_fund';
  gross_amount: number;
  tax_amount: number;
  net_amount: number;
  payment_status: string;
}

export interface BulkDeleteResult {
  table: string;
  deleted: number;
  error?: string;
}

export type DeleteOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';

export interface DeleteFilter {
  field: string;
  value: string;
  op?: DeleteOperator;
}

export interface DeleteOperation {
  table: string;
  filters: DeleteFilter[];
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function downloadExcel(rows: Record<string, any>[], fileName: string, sheetName: string): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  const colWidths = Object.keys(rows[0] || {}).map((key) => ({
    wch: Math.max(key.length, 12),
  }));
  ws['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${fileName.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`);
}

/**
 * Deletes matching records in small batches to prevent PostgreSQL statement timeouts.
 */
async function deleteInBatches(
  table: string,
  filters: { field: string; value: string; op?: string }[],
  batchSize = 250
): Promise<number> {
  let totalDeleted = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = (supabase as any).from(table).select('id');
    for (const f of filters) {
      const op = f.op || 'eq';
      if (op === 'eq') query = query.eq(f.field, f.value);
      else if (op === 'neq') query = query.neq(f.field, f.value);
      else if (op === 'gt') query = query.gt(f.field, f.value);
      else if (op === 'gte') query = query.gte(f.field, f.value);
      else if (op === 'lt') query = query.lt(f.field, f.value);
      else if (op === 'lte') query = query.lte(f.field, f.value);
    }
    const { data: rows, error: selErr } = await query.limit(batchSize);
    if (selErr) throw selErr;
    if (!rows || rows.length === 0) break;

    const ids = rows.map((r: any) => r.id);
    const { error: delErr } = await (supabase as any).from(table).delete().in('id', ids);
    if (delErr) throw delErr;
    totalDeleted += ids.length;
    if (rows.length < batchSize) break;
  }
  return totalDeleted;
}

/**
 * Safely finds and deletes orphan clients in small chunks without locking or timing out.
 */
async function deleteOrphanClientsBatched(companyId?: string, batchSize = 100): Promise<number> {
  let totalDeleted = 0;

  let query = (supabase as any).from('clients').select('id');
  if (companyId && companyId !== 'all') {
    query = query.eq('company_id', companyId);
  }

  const { data: clients, error } = await query;
  if (error || !clients || clients.length === 0) return 0;

  const candidateIds = clients.map((c: any) => c.id);
  const CHUNK_SIZE = 200;

  for (let i = 0; i < candidateIds.length; i += CHUNK_SIZE) {
    const chunk = candidateIds.slice(i, i + CHUNK_SIZE);
    const [divRes, intRes, mfRes] = await Promise.all([
      (supabase as any).from('dividend_payables').select('client_id').in('client_id', chunk),
      (supabase as any).from('interest_payables').select('client_id').in('client_id', chunk),
      (supabase as any).from('mutual_fund_payables').select('client_id').in('client_id', chunk),
    ]);

    const activeSet = new Set<string>();
    for (const r of divRes.data || []) activeSet.add(r.client_id);
    for (const r of intRes.data || []) activeSet.add(r.client_id);
    for (const r of mfRes.data || []) activeSet.add(r.client_id);

    const orphansToDelete = chunk.filter((id) => !activeSet.has(id));
    if (orphansToDelete.length > 0) {
      for (let j = 0; j < orphansToDelete.length; j += batchSize) {
        const delBatch = orphansToDelete.slice(j, j + batchSize);
        const { error: delErr } = await (supabase as any).from('clients').delete().in('id', delBatch);
        if (!delErr) {
          totalDeleted += delBatch.length;
        }
      }
    }
  }

  return totalDeleted;
}

/**
 * Deletes rows reliably in small batches to guarantee no locks, no network drops, and no statement timeouts.
 */
async function deleteViaRpc(
  operations: { table: string; filters: { field: string; value: string; op?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' }[] }[]
): Promise<BulkDeleteResult[]> {
  const results: BulkDeleteResult[] = [];

  for (const op of operations) {
    try {
      const deleted = await deleteInBatches(op.table, op.filters, 100);
      results.push({ table: op.table, deleted });
    } catch (batchErr: any) {
      console.warn(`Batched delete error on table ${op.table}:`, batchErr?.message);
      // Fallback: direct delete
      try {
        let query = (supabase as any).from(op.table).delete({ count: 'exact' });
        for (const f of op.filters) {
          query = query.eq(f.field, f.value);
        }
        const { count, error } = await query;
        if (error) {
          results.push({ table: op.table, deleted: 0, error: error.message });
        } else {
          results.push({ table: op.table, deleted: Number(count ?? 0) });
        }
      } catch (err: any) {
        results.push({ table: op.table, deleted: 0, error: err?.message || 'Delete failed' });
      }
    }
  }

  return results;
}

// ──────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────

export const DataManagementService = {

  // ── FISCAL YEAR DATA ────────────────────────

  async getCompanyFiscalSummary(fiscalYear?: string): Promise<CompanyFiscalData[]> {
    try {
      const [dividends, interests, mutualFunds] = await Promise.all([
        fetchAllRows<any>((from, to) => {
          let q = (supabase as any)
            .from('dividend_payables')
            .select(`
              company_id,
              companies!inner(company_name, company_code),
              fiscal_year,
              gross_dividend,
              tax_amount,
              net_payable,
              payment_status
            `)
            .range(from, to);
          if (fiscalYear && fiscalYear !== 'all') q = q.eq('fiscal_year', fiscalYear);
          return q;
        }),
        fetchAllRows<any>((from, to) => {
          let q = (supabase as any)
            .from('interest_payables')
            .select(`
              company_id,
              companies!inner(company_name, company_code),
              fiscal_year,
              gross_interest,
              tax_amount,
              net_payable,
              payment_status
            `)
            .range(from, to);
          if (fiscalYear && fiscalYear !== 'all') q = q.eq('fiscal_year', fiscalYear);
          return q;
        }),
        fetchAllRows<any>((from, to) => {
          let q = (supabase as any)
            .from('mutual_fund_payables')
            .select(`
              company_id,
              companies!inner(company_name, company_code),
              fiscal_year,
              gross_dividend,
              tax_amount,
              net_payable,
              payment_status
            `)
            .range(from, to);
          if (fiscalYear && fiscalYear !== 'all') q = q.eq('fiscal_year', fiscalYear);
          return q;
        }),
      ]);

      const divMap = new Map<string, CompanyFiscalData>();

      const getEntry = (companyId: string, companyName: string, companyCode: string, fy: string) => {
        const key = `${companyId}|${fy || 'unknown'}`;
        let existing = divMap.get(key);
        if (!existing) {
          existing = {
            company_id: companyId,
            company_name: companyName || 'Unknown',
            company_code: companyCode || '',
            fiscal_year: fy || 'unknown',
            dividend_count: 0,
            dividend_gross: 0,
            dividend_net: 0,
            interest_count: 0,
            interest_gross: 0,
            interest_net: 0,
            mutual_fund_count: 0,
            mutual_fund_gross: 0,
            mutual_fund_net: 0,
            total_paid: 0,
            total_pending: 0,
          };
          divMap.set(key, existing);
        }
        return existing;
      };

      for (const d of dividends) {
        const e = getEntry(d.company_id, d.companies?.company_name, d.companies?.company_code, d.fiscal_year);
        e.dividend_count += 1;
        e.dividend_gross += Number(d.gross_dividend || 0);
        e.dividend_net += Number(d.net_payable || 0);
        if (d.payment_status === 'Paid') e.total_paid += Number(d.net_payable || 0);
        else e.total_pending += Number(d.net_payable || 0);
      }

      for (const i of interests) {
        const e = getEntry(i.company_id, i.companies?.company_name, i.companies?.company_code, i.fiscal_year);
        e.interest_count += 1;
        e.interest_gross += Number(i.gross_interest || 0);
        e.interest_net += Number(i.net_payable || 0);
        if (i.payment_status === 'Paid') e.total_paid += Number(i.net_payable || 0);
        else e.total_pending += Number(i.net_payable || 0);
      }

      for (const m of mutualFunds) {
        const e = getEntry(m.company_id, m.companies?.company_name, m.companies?.company_code, m.fiscal_year);
        e.mutual_fund_count += 1;
        e.mutual_fund_gross += Number(m.gross_dividend || 0);
        e.mutual_fund_net += Number(m.net_payable || 0);
        if (m.payment_status === 'Paid') e.total_paid += Number(m.net_payable || 0);
        else e.total_pending += Number(m.net_payable || 0);
      }

      return Array.from(divMap.values()).sort((a, b) =>
        a.company_name.localeCompare(b.company_name) || a.fiscal_year.localeCompare(b.fiscal_year)
      );
    } catch (err: any) {
      console.warn('Failed to get company fiscal summary:', err?.message || err);
      return [];
    }
  },

  async getClientFiscalDetail(
    companyId: string,
    fiscalYear: string,
    payableType?: 'dividend' | 'interest' | 'mutual_fund'
  ): Promise<ClientFiscalData[]> {
    try {
      const results: ClientFiscalData[] = [];

      if (!payableType || payableType === 'dividend') {
        const data = await fetchAllRows<any>((from, to) =>
          (supabase as any)
            .from('dividend_payables')
            .select(`
              client_id,
              clients!inner(full_name, boid, client_code),
              companies!inner(company_name),
              fiscal_year,
              gross_dividend,
              tax_amount,
              net_payable,
              payment_status
            `)
            .eq('company_id', companyId)
            .eq('fiscal_year', fiscalYear)
            .range(from, to)
        );

        for (const row of data || []) {
          results.push({
            client_id: row.client_id,
            full_name: row.clients?.full_name || 'Unknown',
            boid: row.clients?.boid || '',
            client_code: row.clients?.client_code || '',
            company_name: row.companies?.company_name || '',
            fiscal_year: row.fiscal_year || fiscalYear,
            payable_type: 'dividend',
            gross_amount: Number(row.gross_dividend || 0),
            tax_amount: Number(row.tax_amount || 0),
            net_amount: Number(row.net_payable || 0),
            payment_status: row.payment_status || 'Pending',
          });
        }
      }

      if (!payableType || payableType === 'interest') {
        const data = await fetchAllRows<any>((from, to) =>
          (supabase as any)
            .from('interest_payables')
            .select(`
              client_id,
              clients!inner(full_name, boid, client_code),
              companies!inner(company_name),
              fiscal_year,
              gross_interest,
              tax_amount,
              net_payable,
              payment_status
            `)
            .eq('company_id', companyId)
            .eq('fiscal_year', fiscalYear)
            .range(from, to)
        );

        for (const row of data || []) {
          results.push({
            client_id: row.client_id,
            full_name: row.clients?.full_name || 'Unknown',
            boid: row.clients?.boid || '',
            client_code: row.clients?.client_code || '',
            company_name: row.companies?.company_name || '',
            fiscal_year: row.fiscal_year || fiscalYear,
            payable_type: 'interest',
            gross_amount: Number(row.gross_interest || 0),
            tax_amount: Number(row.tax_amount || 0),
            net_amount: Number(row.net_payable || 0),
            payment_status: row.payment_status || 'Pending',
          });
        }
      }

      if (!payableType || payableType === 'mutual_fund') {
        const data = await fetchAllRows<any>((from, to) =>
          (supabase as any)
            .from('mutual_fund_payables')
            .select(`
              client_id,
              clients!inner(full_name, boid, client_code),
              companies!inner(company_name),
              fiscal_year,
              gross_dividend,
              tax_amount,
              net_payable,
              payment_status
            `)
            .eq('company_id', companyId)
            .eq('fiscal_year', fiscalYear)
            .range(from, to)
        );

        for (const row of data || []) {
          results.push({
            client_id: row.client_id,
            full_name: row.clients?.full_name || 'Unknown',
            boid: row.clients?.boid || '',
            client_code: row.clients?.client_code || '',
            company_name: row.companies?.company_name || '',
            fiscal_year: row.fiscal_year || fiscalYear,
            payable_type: 'mutual_fund',
            gross_amount: Number(row.gross_dividend || 0),
            tax_amount: Number(row.tax_amount || 0),
            net_amount: Number(row.net_payable || 0),
            payment_status: row.payment_status || 'Pending',
          });
        }
      }

      return results;
    } catch (err: any) {
      console.warn('Failed to get client fiscal detail:', err?.message || err);
      return [];
    }
  },

  async getDistinctFiscalYears(): Promise<string[]> {
    try {
      const [divRes, intRes, mfRes] = await Promise.all([
        (supabase as any).from('dividend_payables').select('fiscal_year').not('fiscal_year', 'is', null),
        (supabase as any).from('interest_payables').select('fiscal_year').not('fiscal_year', 'is', null),
        (supabase as any).from('mutual_fund_payables').select('fiscal_year').not('fiscal_year', 'is', null),
      ]);

      const years = new Set<string>();
      for (const r of (divRes.data || [])) if (r.fiscal_year) years.add(r.fiscal_year);
      for (const r of (intRes.data || [])) if (r.fiscal_year) years.add(r.fiscal_year);
      for (const r of (mfRes.data || [])) if (r.fiscal_year) years.add(r.fiscal_year);

      return Array.from(years).sort((a, b) => b.localeCompare(a));
    } catch {
      return [];
    }
  },

  // ── BULK DELETE ─────────────────────────────
  // All deletions run server-side via the authorized, table-whitelisted,
  // audited SECURITY DEFINER RPCs (bulk_delete / delete_orphan_clients).

  async deleteByCompanyAndFiscalYear(
    companyId: string,
    fiscalYear: string,
    options?: { deleteOrphanClients?: boolean }
  ): Promise<BulkDeleteResult[]> {
    const operations: { table: string; filters: { field: string; value: string }[] }[] = [
      { table: 'dividend_payables', filters: [{ field: 'company_id', value: companyId }, { field: 'fiscal_year', value: fiscalYear }] },
      { table: 'mutual_fund_payables', filters: [{ field: 'company_id', value: companyId }, { field: 'fiscal_year', value: fiscalYear }] },
      { table: 'interest_payables', filters: [{ field: 'company_id', value: companyId }, { field: 'fiscal_year', value: fiscalYear }] },
    ];

    // Delete payables via the authorized RPC.
    const results = await deleteViaRpc(operations);

    if (options?.deleteOrphanClients) {
      // Server-side orphan cleanup (authorized, no direct client-side deletes).
      const { data, error } = await (supabase as any).rpc('delete_orphan_clients', {
        p_company_id: companyId,
        p_fiscal_year: fiscalYear,
        p_imported_after: null,
      });
      if (error) {
        results.push({ table: 'clients (orphans)', deleted: 0, error: error.message });
      } else {
        results.push({ table: 'clients (orphans)', deleted: data?.deleted ?? 0 });
      }
    }

    return results;
  },

  async deleteAllCompanyData(companyId: string): Promise<BulkDeleteResult[]> {
    try {
      const { data, error } = await (supabase as any).rpc('delete_company_completely', {
        p_company_id: companyId,
        p_delete_clients: false,
        p_delete_orphans: true,
      });
      if (!error && data?.success && Array.isArray(data.results)) {
        return data.results;
      }
    } catch {
      // fallback to deleteViaRpc
    }

    const tables = ['payments', 'payment_batches', 'reconciliation_results', 'dividend_payables', 'mutual_fund_payables', 'interest_payables', 'iaf_allocations'];
    const operations = tables.map((table) => ({
      table,
      filters: [{ field: 'company_id', value: companyId }],
    }));
    return deleteViaRpc(operations);
  },

  async deleteByFiscalYear(fiscalYear: string): Promise<BulkDeleteResult[]> {
    const operations = [
      { table: 'dividend_payables', filters: [{ field: 'fiscal_year', value: fiscalYear }] },
      { table: 'mutual_fund_payables', filters: [{ field: 'fiscal_year', value: fiscalYear }] },
      { table: 'interest_payables', filters: [{ field: 'fiscal_year', value: fiscalYear }] },
    ];
    return deleteViaRpc(operations);
  },

  async customBulkDelete(options: {
    companyId: string;
    deleteDividends?: boolean;
    deleteInterests?: boolean;
    deleteMutualFunds?: boolean;
    deleteClients?: boolean;
    deleteOrphans?: boolean;
    deleteCompany?: boolean;
    importedAfter?: string;
  }): Promise<BulkDeleteResult[]> {
    const results: BulkDeleteResult[] = [];
    const isAll = options.companyId === "all";

    const operations: DeleteOperation[] = [];

    // Scope filters for company-specific deletes.
    const scopeFilters: DeleteFilter[] = [];
    if (!isAll && options.companyId) scopeFilters.push({ field: 'company_id', value: options.companyId });
    if (options.importedAfter) scopeFilters.push({ field: 'created_at', value: `${options.importedAfter}T00:00:00`, op: 'gte' });

    // 1. Delete dependent records first in batches if company deletion requested
    if (options.deleteCompany && !isAll && options.companyId) {
      operations.push({ table: 'payments', filters: [{ field: 'company_id', value: options.companyId }] });
      operations.push({ table: 'payment_batches', filters: [{ field: 'company_id', value: options.companyId }] });
      operations.push({ table: 'reconciliation_results', filters: [{ field: 'company_id', value: options.companyId }] });
      operations.push({ table: 'iaf_allocations', filters: [{ field: 'company_id', value: options.companyId }] });
    }

    if (options.deleteDividends || options.deleteCompany) operations.push({ table: 'dividend_payables', filters: [...scopeFilters] });
    if (options.deleteMutualFunds || options.deleteCompany) operations.push({ table: 'mutual_fund_payables', filters: [...scopeFilters] });
    if (options.deleteInterests || options.deleteCompany) operations.push({ table: 'interest_payables', filters: [...scopeFilters] });

    // Client deletion
    if (options.deleteClients) {
      if (isAll) {
        // Global client purge
        operations.push({
          table: 'clients',
          filters: options.importedAfter ? [{ field: 'created_at', value: `${options.importedAfter}T00:00:00`, op: 'gte' }] : [],
        });
      } else if (options.companyId) {
        // Delete clients registered under this specific company
        operations.push({
          table: 'clients',
          filters: [{ field: 'company_id', value: options.companyId }],
        });
      }
    }

    // Execute payables + clients deletes via non-blocking batched operations
    if (operations.length) {
      results.push(...(await deleteViaRpc(operations)));
    }

    // Delete the company record itself
    if (options.deleteCompany && !isAll && options.companyId) {
      try {
        // Unlink any remaining clients that might reference this company_id
        await (supabase as any).from('clients').update({ company_id: null }).eq('company_id', options.companyId);
        
        const { count, error } = await (supabase as any).from('companies').delete({ count: 'exact' }).eq('id', options.companyId);
        if (error) {
          results.push({ table: 'companies', deleted: 0, error: error.message });
        } else {
          results.push({ table: 'companies', deleted: Number(count ?? 1) });
        }
      } catch (cErr: any) {
        results.push({ table: 'companies', deleted: 0, error: cErr?.message || 'Failed to delete company' });
      }
    }

    // Orphan client cleanup in small chunks
    if (options.deleteOrphans || (options.deleteCompany && !isAll)) {
      try {
        const orphanDeleted = await deleteOrphanClientsBatched(isAll ? undefined : options.companyId);
        if (orphanDeleted > 0) {
          results.push({ table: 'clients (orphans)', deleted: orphanDeleted });
        }
      } catch (bErr: any) {
        console.warn('Orphan cleanup warning:', bErr);
      }
    }

    return results;
  },
  // ── EXPORT ──────────────────────────────────

  exportCompanyFiscalToExcel(data: CompanyFiscalData[], fileName: string): void {
    const rows = data.map((d) => ({
      'Company Name': d.company_name,
      'Company Code': d.company_code,
      'Fiscal Year': d.fiscal_year,
      'Dividend Count': d.dividend_count,
      'Dividend Gross': d.dividend_gross,
      'Dividend Net': d.dividend_net,
      'Interest Count': d.interest_count,
      'Interest Gross': d.interest_gross,
      'Interest Net': d.interest_net,
      'Mutual Fund Count': d.mutual_fund_count || 0,
      'Mutual Fund Gross': d.mutual_fund_gross || 0,
      'Mutual Fund Net': d.mutual_fund_net || 0,
      'Total Paid': d.total_paid,
      'Total Pending': d.total_pending,
    }));
    downloadExcel(rows, fileName, 'Company Fiscal Summary');
  },

  exportClientFiscalToExcel(data: ClientFiscalData[], fileName: string): void {
    const rows = data.map((d) => ({
      'Client Name': d.full_name,
      'BOID': d.boid,
      'Client Code': d.client_code,
      'Company': d.company_name,
      'Fiscal Year': d.fiscal_year,
      'Type': d.payable_type,
      'Gross Amount': d.gross_amount,
      'Tax Amount': d.tax_amount,
      'Net Amount': d.net_amount,
      'Status': d.payment_status,
    }));
    downloadExcel(rows, fileName, 'Client Fiscal Detail');
  },

  exportDeleteResultsToExcel(results: BulkDeleteResult[], fileName: string): void {
    const rows = results.map((r) => ({
      'Table': r.table,
      'Deleted': r.deleted,
      'Error': r.error || '',
    }));
    downloadExcel(rows, fileName, 'Delete Results');
  },
};