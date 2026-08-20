import { supabase, throwIfError } from './database';
import { Database } from '@/integrations/supabase/types';

type Company = Database['public']['Tables']['companies']['Row'];
type CompanyInsert = Database['public']['Tables']['companies']['Insert'];
type CompanyUpdate = Database['public']['Tables']['companies']['Update'];

export const CompanyService = {
  async getCompanies(): Promise<Company[]> {
    const { data, error } = await supabase.from('companies').select('*').order('company_name');
    throwIfError(error, 'Failed to fetch companies');
    return data || [];
  },

  async getCompanyById(id: string): Promise<Company | null> {
    const { data, error } = await supabase.from('companies').select('*').eq('id', id).single();
    if (error && error.code !== 'PGRST116') {
      throwIfError(error, 'Failed to fetch company');
    }
    return data;
  },

  async createCompany(company: CompanyInsert): Promise<Company> {
    const { data, error } = await supabase.from('companies').insert(company).select().single();
    throwIfError(error, 'Failed to create company');
    return data!;
  },

  async updateCompany(id: string, updates: CompanyUpdate): Promise<Company> {
    const { data, error } = await supabase.from('companies').update(updates).eq('id', id).select().single();
    throwIfError(error, 'Failed to update company');
    return data!;
  },
  
  async deleteCompany(id: string): Promise<void> {
    const { DataManagementService } = await import('./data-management.service');
    const results = await DataManagementService.customBulkDelete({
      companyId: id,
      deleteDividends: true,
      deleteMutualFunds: true,
      deleteInterests: true,
      deleteClients: true,
      deleteCompany: true,
      deleteOrphans: true,
    });
    const errors = results.filter((r) => r.error);
    if (errors.length > 0) {
      throw new Error(errors.map((e) => `${e.table}: ${e.error}`).join(", "));
    }
  }
};
