import { supabase, throwIfError } from './database';

export const BackupService = {
  /**
   * Triggers a database backup via an Edge Function
   */
  async triggerBackup() {
    const { data, error } = await supabase.functions.invoke('trigger-backup', {
      body: {}
    });
    
    throwIfError(error, 'Failed to trigger backup');
    return data;
  }
};
