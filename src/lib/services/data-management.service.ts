import { supabase } from './database';
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
  payable_type: 'dividend' | 'interest';
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
 * Delete rows from a table via the bulk_delete RPC (SECURITY DEFINER, authorized,
 * table-whitelisted, audited). Never falls back to direct client-side deletes,
 * which are subject to RLS and would silently fail for non-admins.
 */
async function deleteViaRpc(
  operations: { table: string; filters: { field: string; value: string; op?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' }[] }[]
): Promise<BulkDeleteResult[]> {
  const results: BulkDeleteResult[] = [];

  for (const op of operations) {
    try {
      const filtersJson = op.filters.map((f) => ({ field: f.field, value: f.value, op: f.op || 'eq' }));
      const { data, error } = await (supabase as any).rpc('bulk_delete', {
        p_table: op.table,
        p_filters: JSON.stringify(filtersJson),
      });

      if (error) {
        if (error.message?.includes('function') || error.code === 'PGRST202') {
          results.push({ table: op.table, deleted: 0, error: `bulk_delete RPC is not deployed. Run migration 20260728000000_bulk_delete_rpc.sql and 20260831000000_harden_bulk_delete.sql.` });
        } else {
          results.push({ table: op.table, deleted: 0, error: error.message });
        }
        continue;
      }

      const result = data as any;
      results.push({
        table: op.table,
        deleted: result?.deleted ?? 0,
        ...(result?.error ? { error: result.error } : {}),
        ...(!result?.success && !result?.error ? { error: 'Delete returned no result' } : {}),
      });
    } catch (err: any) {
      results.push({ table: op.table, deleted: 0, error: err?.message || 'Unknown error' });
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
      let dividendQuery = (supabase as any)
        .from('dividend_payables')
        .select(`
          company_id,
          companies!inner(company_name, company_code),
          fiscal_year,
          gross_dividend,
          tax_amount,
          net_payable,
          payment_status
        `);

      let interestQuery = (supabase as any)
        .from('interest_payables')
        .select(`
          company_id,
          companies!inner(company_name, company_code),
          fiscal_year,
          gross_interest,
          tax_amount,
          net_payable,
          payment_status
        `);

      if (fiscalYear) {
        dividendQuery = dividendQuery.eq('fiscal_year', fiscalYear);
        interestQuery = interestQuery.eq('fiscal_year', fiscalYear);
      }

      const [dividendRes, interestRes] = await Promise.all([
        dividendQuery,
        interestQuery,
      ]);

      if (dividendRes.error) throw dividendRes.error;
      if (interestRes.error) throw interestRes.error;

      const dividends: any[] = dividendRes.data || [];
      const interests: any[] = interestRes.data || [];

      const divMap = new Map<string, CompanyFiscalData>();
      for (const d of dividends) {
        const key = `${d.company_id}|${d.fiscal_year || 'unknown'}`;
        const existing = divMap.get(key) || {
          company_id: d.company_id,
          company_name: d.companies?.company_name || 'Unknown',
          company_code: d.companies?.company_code || '',
          fiscal_year: d.fiscal_year || 'unknown',
          dividend_count: 0,
          dividend_gross: 0,
          dividend_net: 0,
          interest_count: 0,
          interest_gross: 0,
          interest_net: 0,
          total_paid: 0,
          total_pending: 0,
        };
        existing.dividend_count += 1;
        existing.dividend_gross += Number(d.gross_dividend || 0);
        existing.dividend_net += Number(d.net_payable || 0);
        if (d.payment_status === 'Paid') existing.total_paid += Number(d.net_payable || 0);
        else existing.total_pending += Number(d.net_payable || 0);
        divMap.set(key, existing);
      }

      for (const i of interests) {
        const key = `${i.company_id}|${i.fiscal_year || 'unknown'}`;
        const existing = divMap.get(key) || {
          company_id: i.company_id,
          company_name: i.companies?.company_name || 'Unknown',
          company_code: i.companies?.company_code || '',
          fiscal_year: i.fiscal_year || 'unknown',
          dividend_count: 0,
          dividend_gross: 0,
          dividend_net: 0,
          interest_count: 0,
          interest_gross: 0,
          interest_net: 0,
          total_paid: 0,
          total_pending: 0,
        };
        existing.interest_count += 1;
        existing.interest_gross += Number(i.gross_interest || 0);
        existing.interest_net += Number(i.net_payable || 0);
        if (i.payment_status === 'Paid') existing.total_paid += Number(i.net_payable || 0);
        else existing.total_pending += Number(i.net_payable || 0);
        divMap.set(key, existing);
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
    payableType?: 'dividend' | 'interest'
  ): Promise<ClientFiscalData[]> {
    try {
      const results: ClientFiscalData[] = [];

      if (!payableType || payableType === 'dividend') {
        const { data, error } = await (supabase as any)
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
          .eq('fiscal_year', fiscalYear);

        if (error) throw error;
        if (data) {
          for (const row of data) {
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
      }

      if (!payableType || payableType === 'interest') {
        const { data, error } = await (supabase as any)
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
          .eq('fiscal_year', fiscalYear);

        if (error) throw error;
        if (data) {
          for (const row of data) {
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
    const tables = ['dividend_payables', 'mutual_fund_payables', 'interest_payables', 'payments', 'reconciliation_results'];
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
    deleteClients?: boolean;
    deleteOrphans?: boolean;
    deleteCompany?: boolean;
    importedAfter?: string;
  }): Promise<BulkDeleteResult[]> {
    const results: BulkDeleteResult[] = [];
    const operations: DeleteOperation[] = [];
    const isAll = options.companyId === "all";

    // Scope filters for company-specific deletes.
    const scopeFilters: DeleteFilter[] = [];
    if (!isAll && options.companyId) scopeFilters.push({ field: 'company_id', value: options.companyId });
    if (options.importedAfter) scopeFilters.push({ field: 'created_at', value: `${options.importedAfter}T00:00:00`, op: 'gte' });

    if (options.deleteDividends) operations.push({ table: 'dividend_payables', filters: [...scopeFilters] });
    if (options.deleteInterests) operations.push({ table: 'interest_payables', filters: [...scopeFilters] });

    // Global client deletion (admin-only full purge).
    if (options.deleteClients) {
      if (!isAll) {
        throw new Error("Clients are global and cannot be deleted for a specific company. Please select 'All Companies' to delete clients globally.");
      }
      operations.push({
        table: 'clients',
        filters: options.importedAfter ? [{ field: 'created_at', value: `${options.importedAfter}T00:00:00`, op: 'gte' }] : [],
      });
    }

    // Delete payables (+ clients if requested) via the authorized RPC.
    if (operations.length) results.push(...(await deleteViaRpc(operations)));

    // Delete the company record itself (admin-only, scoped by id).
    if (options.deleteCompany && !isAll && options.companyId) {
      results.push(...(await deleteViaRpc([{ table: 'companies', filters: [{ field: 'id', value: options.companyId }] }])));
    }

    // Server-side orphan cleanup.
    if (options.deleteOrphans) {
      const { data, error } = await (supabase as any).rpc('delete_orphan_clients', {
        p_company_id: isAll ? null : options.companyId,
        p_fiscal_year: null,
        p_imported_after: options.importedAfter ? new Date(`${options.importedAfter}T00:00:00`).toISOString() : null,
      });
      if (error) {
        results.push({ table: 'clients (orphans)', deleted: 0, error: error.message });
      } else {
        const deleted = data?.deleted ?? 0;
        if (deleted > 0) results.push({ table: 'clients (orphans)', deleted });
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