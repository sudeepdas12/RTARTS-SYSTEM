import { supabase, throwIfError } from './database';

export const SearchService = {
  async globalSearch(query: string) {
    // Basic implementation that could search multiple tables
    const clientSearch = await supabase.from('clients').select('*').or(`full_name.ilike.%${query}%,boid.ilike.%${query}%`).limit(10);
    const companySearch = await supabase.from('companies').select('*').or(`company_name.ilike.%${query}%,isin.ilike.%${query}%`).limit(10);
    
    return {
      clients: clientSearch.data || [],
      companies: companySearch.data || [],
    };
  }
};
