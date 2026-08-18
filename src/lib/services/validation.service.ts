import { supabase } from './database';

export type ValidationError = {
  row: number;
  field: string;
  type: string;
  message: string;
};

export const ValidationService = {
  /**
   * Validates if a BOID already exists in the system.
   */
  async checkDuplicateBOID(boid: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('clients')
      .select('id')
      .eq('boid', boid)
      .limit(1)
      .maybeSingle();
      
    if (error && error.code !== 'PGRST116') return false;
    return !!data;
  },
  
  /**
   * Validates if an ISIN exists in the system.
   */
  async checkISINExists(isin: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('companies')
      .select('id')
      .eq('isin', isin)
      .limit(1)
      .maybeSingle();
      
    if (error && error.code !== 'PGRST116') return false;
    return !!data;
  },

  /**
   * Example offline validation logic for a generic amount
   */
  validateAmount(amount: number | null | undefined): ValidationError | null {
    if (amount === null || amount === undefined || amount === 0) {
      return { row: 0, field: 'amount', type: 'missing', message: 'Amount cannot be empty or zero' };
    }
    if (amount < 0) {
      return { row: 0, field: 'amount', type: 'negative', message: 'Amount cannot be negative' };
    }
    return null;
  }
};
