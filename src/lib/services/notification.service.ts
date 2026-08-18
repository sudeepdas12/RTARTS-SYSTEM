import { supabase } from './database';

export interface NotificationRow {
  id: string;
  user_id: string | null;
  title: string;
  message: string;
  channel: string;
  category: string | null;
  reference_type: string | null;
  reference_id: string | null;
  is_read: boolean;
  read_at: string | null;
  sent_at: string | null;
  created_at: string;
}

export type NotificationChannel = 'Email' | 'SMS' | 'System';
export type NotificationCategory = 
  | 'interest_due' 
  | 'dividend_due' 
  | 'approval_pending' 
  | 'upload_failed' 
  | 'upload_success'
  | 'payment_failed' 
  | 'payment_success'
  | 'reconciliation_complete'
  | 'reconciliation_discrepancy'
  | 'system_alert';

export const NotificationService = {
  async getUnreadNotifications(userId: string): Promise<NotificationRow[]> {
    try {
      const { data, error } = await (supabase as any)
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .eq('is_read', false)
        .order('created_at', { ascending: false });
      if (error) { console.warn('Failed to fetch notifications:', error.message); return []; }
      return (data || []) as NotificationRow[];
    } catch (err: any) {
      console.warn('Failed to fetch notifications:', err?.message || err);
      return [];
    }
  },

  async getAllNotifications(userId: string, limit = 50): Promise<NotificationRow[]> {
    try {
      const { data, error } = await (supabase as any)
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) { console.warn('Failed to fetch notifications:', error.message); return []; }
      return (data || []) as NotificationRow[];
    } catch (err: any) {
      console.warn('Failed to fetch notifications:', err?.message || err);
      return [];
    }
  },

  async markAsRead(id: string): Promise<void> {
    try {
      const { error } = await (supabase as any)
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', id);
      if (error) console.warn('Failed to mark notification as read:', error.message);
    } catch (err: any) {
      console.warn('Failed to mark notification as read:', err?.message || err);
    }
  },

  async markAllAsRead(userId: string): Promise<void> {
    try {
      const { error } = await (supabase as any)
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('is_read', false);
      if (error) console.warn('Failed to mark all notifications as read:', error.message);
    } catch (err: any) {
      console.warn('Failed to mark all notifications as read:', err?.message || err);
    }
  },

  async sendNotification(notification: Record<string, any>): Promise<NotificationRow | null> {
    try {
      const { data, error } = await (supabase as any).from('notifications').insert(notification).select().single();
      if (error) { console.warn('Failed to send notification:', error.message); return null; }
      return data as NotificationRow;
    } catch (err: any) {
      console.warn('Failed to send notification:', err?.message || err);
      return null;
    }
  },

  /**
   * Send a notification across multiple channels (System, Email, SMS)
   */
  async sendMultiChannel(
    userId: string | null,
    title: string,
    message: string,
    category: NotificationCategory,
    referenceType?: string,
    referenceId?: string,
    channels: NotificationChannel[] = ['System']
  ): Promise<NotificationRow | null> {
    let result: NotificationRow | null = null;

    for (const channel of channels) {
      result = await this.sendNotification({
        user_id: userId,
        title,
        message,
        channel,
        category,
        reference_type: referenceType || null,
        reference_id: referenceId || null,
        sent_at: new Date().toISOString(),
      });
    }

    return result;
  },

  /**
   * Send approval-related notification
   */
  async sendApprovalNotification(
    userId: string | null,
    recordType: string,
    recordId: string,
    action: string,
    status: string
  ): Promise<void> {
    await this.sendMultiChannel(
      userId,
      `${recordType.replace('_', ' ')} ${action}`,
      `Record ${recordId.slice(0, 8)} was ${action}d. Status: ${status}`,
      'approval_pending',
      recordType,
      recordId,
      ['System', 'Email']
    );
  },

  /**
   * Send upload-related notification
   */
  async sendUploadNotification(
    userId: string | null,
    fileName: string,
    success: boolean,
    rowCount: number,
    errorCount: number
  ): Promise<void> {
    const category: NotificationCategory = success ? 'upload_success' : 'upload_failed';
    const title = success ? 'Upload Completed' : 'Upload Failed';
    const message = success
      ? `File "${fileName}" imported successfully with ${rowCount} rows.`
      : `File "${fileName}" failed with ${errorCount} errors.`;

    await this.sendMultiChannel(
      userId,
      title,
      message,
      category,
      'upload_history',
      undefined,
      ['System', 'Email']
    );
  },

  /**
   * Send payment-related notification
   */
  async sendPaymentNotification(
    userId: string | null,
    batchName: string,
    success: boolean,
    amount: number,
    paymentCount: number
  ): Promise<void> {
    const category: NotificationCategory = success ? 'payment_success' : 'payment_failed';
    const title = success ? 'Payment Batch Processed' : 'Payment Batch Failed';
    const message = success
      ? `Batch "${batchName}" processed: ${paymentCount} payments totaling NPR ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}.`
      : `Batch "${batchName}" failed to process.`;

    await this.sendMultiChannel(
      userId,
      title,
      message,
      category,
      'payment_batches',
      undefined,
      ['System', 'Email', 'SMS']
    );
  },

  /**
   * Send reconciliation-related notification
   */
  async sendReconciliationNotification(
    userId: string | null,
    fileName: string,
    matchedCount: number,
    discrepancyCount: number
  ): Promise<void> {
    const category: NotificationCategory = discrepancyCount > 0 ? 'reconciliation_discrepancy' : 'reconciliation_complete';
    const title = discrepancyCount > 0 ? 'Reconciliation Discrepancies Found' : 'Reconciliation Complete';
    const message = discrepancyCount > 0
      ? `File "${fileName}" reconciled with ${matchedCount} matches and ${discrepancyCount} discrepancies.`
      : `File "${fileName}" reconciled successfully with ${matchedCount} matches.`;

    await this.sendMultiChannel(
      userId,
      title,
      message,
      category,
      'reconciliation_results',
      undefined,
      ['System', 'Email']
    );
  }
};