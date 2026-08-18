import { supabase } from './services/database';
import { RBACService, UserContext } from './rbac-service';
import { NotificationService } from './services/notification.service';
import { SettingsService } from './services/settings.service';

export type ApprovalAction = 'submit' | 'approve' | 'reject' | 'return' | 'process' | 'complete';
export type ApprovalStatus = 'Draft' | 'Pending' | 'Approved' | 'Rejected' | 'Returned' | 'Processed' | 'Completed' | 'Processing' | 'Failed' | 'Matched' | 'Not_Matched' | 'Missing' | 'Duplicate' | 'Over_Paid' | 'Under_Paid';

export interface WorkflowTransition {
  from: ApprovalStatus;
  to: ApprovalStatus;
  action: ApprovalAction;
  requiredRole: string[];
}

export interface WorkflowConfig {
  table: string;
  statusField: string;
  transitions: WorkflowTransition[];
}

const WORKFLOW_CONFIGS: Record<string, WorkflowConfig> = {
  payment_batches: {
    table: 'payment_batches',
    statusField: 'status',
    transitions: [
      { from: 'Draft', to: 'Pending', action: 'submit', requiredRole: ['maker', 'operator', 'supervisor', 'admin'] },
      { from: 'Pending', to: 'Approved', action: 'approve', requiredRole: ['checker', 'approver', 'supervisor', 'admin'] },
      { from: 'Pending', to: 'Rejected', action: 'reject', requiredRole: ['checker', 'approver', 'supervisor', 'admin'] },
      { from: 'Pending', to: 'Returned', action: 'return', requiredRole: ['checker', 'approver', 'supervisor', 'admin'] },
      { from: 'Approved', to: 'Processed', action: 'process', requiredRole: ['approver', 'supervisor', 'admin'] },
      { from: 'Processed', to: 'Completed', action: 'complete', requiredRole: ['approver', 'supervisor', 'admin'] },
    ],
  },
  upload_history: {
    table: 'upload_history',
    statusField: 'status',
    transitions: [
      { from: 'Processing', to: 'Completed', action: 'complete', requiredRole: ['operator', 'supervisor', 'admin'] },
      { from: 'Processing', to: 'Failed', action: 'reject', requiredRole: ['operator', 'supervisor', 'admin'] },
    ],
  },
  reconciliation_results: {
    table: 'reconciliation_results',
    statusField: 'result',
    transitions: [
      { from: 'Pending', to: 'Matched', action: 'approve', requiredRole: ['reconciliation_officer', 'supervisor', 'admin'] },
      { from: 'Pending', to: 'Rejected', action: 'reject', requiredRole: ['reconciliation_officer', 'supervisor', 'admin'] },
    ],
  },
};

export const WorkflowEngine = {
  getConfig(table: string): WorkflowConfig | null {
    return WORKFLOW_CONFIGS[table] || null;
  },

  canTransition(user: UserContext | null, table: string, from: ApprovalStatus, action: ApprovalAction): boolean {
    const config = this.getConfig(table);
    if (!config) return false;
    
    const transition = config.transitions.find(t => t.from === from && t.action === action);
    if (!transition) return false;
    
    return RBACService.hasRole(user, transition.requiredRole as any);
  },

  async processAction(
    recordId: string,
    table: string,
    action: ApprovalAction,
    remarks?: string,
    user?: UserContext | null
  ): Promise<{ success: boolean; newStatus?: ApprovalStatus; error?: string }> {
    const config = this.getConfig(table);
    if (!config) {
      return { success: false, error: `No workflow configured for table: ${table}` };
    }

    // Fetch current record status
    const { data: record, error: fetchError } = await (supabase as any)
      .from(config.table)
      .select(config.statusField)
      .eq('id', recordId)
      .single();

    if (fetchError || !record) {
      return { success: false, error: `Failed to fetch record: ${fetchError?.message || 'not found'}` };
    }

    const currentStatus = record[config.statusField] as ApprovalStatus;
    const transition = config.transitions.find(t => t.from === currentStatus && t.action === action);

    if (!transition) {
      return { success: false, error: `Invalid transition: ${currentStatus} → ${action}` };
    }

    // Check role permission
    if (user && !RBACService.hasRole(user, transition.requiredRole as any)) {
      return { success: false, error: 'Insufficient permissions for this action' };
    }

    // ─── MAKER-CHECKER SEGREGATION ─────────────────────────────────────────────
    // If require_maker_checker is enabled globally, block approve/process/complete
    // actions when the acting user is the same as the record's creator.
    if (action === 'approve' || action === 'process' || action === 'complete') {
      try {
        const settings = await SettingsService.getSettings();
        if (settings.require_maker_checker && user) {
          // Fetch the created_by field to compare with the acting user
          const { data: creatorData } = await (supabase as any)
            .from(config.table)
            .select('created_by')
            .eq('id', recordId)
            .single();

          const createdBy = creatorData?.created_by;
          if (createdBy && createdBy === user.id) {
            return {
              success: false,
              error: 'Maker and Checker cannot be the same user. This batch was created by you and must be approved by a different user.'
            };
          }
        }
      } catch (settingsErr) {
        console.warn('Failed to check maker-checker settings:', settingsErr);
      }
    }

    const newStatus = transition.to;

    // Update the record status
    const updateData: any = { [config.statusField]: newStatus };
    if (action === 'approve') {
      updateData.approved_by = user?.id || null;
      updateData.approved_at = new Date().toISOString();
    } else if (action === 'process' || action === 'complete') {
      updateData.processed_at = new Date().toISOString();
    }

    const { error: updateError } = await (supabase as any)
      .from(config.table)
      .update(updateData)
      .eq('id', recordId);

    if (updateError) {
      return { success: false, error: `Failed to update record: ${updateError.message}` };
    }

    // Log the approval action
    try {
      await (supabase as any).from('approval_logs').insert({
        approval_id: recordId,
        action,
        previous_status: currentStatus,
        new_status: newStatus,
        remarks: remarks || null,
        performed_by: user?.id || null,
      });
    } catch (logErr) {
      console.warn('Failed to write approval log:', logErr);
    }

    // Send notification
    try {
      await NotificationService.sendNotification({
        user_id: user?.id || null,
        title: `${table.replace('_', ' ')} ${action}`,
        message: `Record ${recordId.slice(0, 8)} was ${action}d. Status: ${currentStatus} → ${newStatus}`,
        channel: 'System',
        category: 'approval_pending',
        reference_type: table,
        reference_id: recordId,
      });
    } catch (notifErr) {
      console.warn('Failed to send notification:', notifErr);
    }

    return { success: true, newStatus };
  },

  async getApprovalLogs(recordId: string, limit = 20): Promise<any[]> {
    try {
      const { data, error } = await (supabase as any)
        .from('approval_logs')
        .select('*')
        .eq('approval_id', recordId)
        .order('performed_at', { ascending: false })
        .limit(limit);
      
      if (error) {
        console.warn('Failed to fetch approval logs:', error.message);
        return [];
      }
      return data || [];
    } catch (err: any) {
      console.warn('Failed to fetch approval logs:', err?.message || err);
      return [];
    }
  },

  getAvailableActions(table: string, currentStatus: ApprovalStatus): ApprovalAction[] {
    const config = this.getConfig(table);
    if (!config) return [];
    return config.transitions
      .filter(t => t.from === currentStatus)
      .map(t => t.action);
  }
};