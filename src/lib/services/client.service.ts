import { supabase, throwIfError } from './database';
import { Database } from '@/integrations/supabase/types';

type Client = Database['public']['Tables']['clients']['Row'];
type ClientInsert = Database['public']['Tables']['clients']['Insert'];
type ClientUpdate = Database['public']['Tables']['clients']['Update'];

export const ClientService = {
  async getClients(limit = 100, offset = 0): Promise<Client[]> {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .order('full_name')
      .range(offset, offset + limit - 1);
    throwIfError(error, 'Failed to fetch clients');
    return data || [];
  },

  async getClientById(id: string): Promise<Client | null> {
    const { data, error } = await supabase.from('clients').select('*').eq('id', id).single();
    if (error && error.code !== 'PGRST116') {
      throwIfError(error, 'Failed to fetch client');
    }
    return data;
  },

  async createClient(client: ClientInsert): Promise<Client> {
    const { data, error } = await supabase.from('clients').insert(client).select().single();
    throwIfError(error, 'Failed to create client');
    return data!;
  },

  async updateClient(id: string, updates: ClientUpdate): Promise<Client> {
    const { data, error } = await supabase.from('clients').update(updates).eq('id', id).select().single();
    throwIfError(error, 'Failed to update client');
    return data!;
  },

  async searchClients(query: string): Promise<Client[]> {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .or(`full_name.ilike.%${query}%,boid.ilike.%${query}%,pan_or_citizenship.ilike.%${query}%`)
      .limit(50);
    throwIfError(error, 'Failed to search clients');
    return data || [];
  }
};
