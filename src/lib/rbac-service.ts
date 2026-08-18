export type AppRole = 'admin' | 'supervisor' | 'operator' | 'maker' | 'checker' | 'approver' | 'auditor' | 'read_only';

export interface UserContext {
  id: string;
  roles: AppRole[];
  companyIds?: string[]; // If restricted
}

export type Permission =
  | 'view_dashboard'
  | 'view_companies'
  | 'manage_companies'
  | 'view_clients'
  | 'manage_clients'
  | 'upload_data'
  | 'validate_data'
  | 'import_data'
  | 'rollback_upload'
  | 'view_payments'
  | 'create_payment_batch'
  | 'approve_payment_batch'
  | 'process_payment_batch'
  | 'view_reconciliation'
  | 'run_reconciliation'
  | 'apply_reconciliation'
  | 'view_reports'
  | 'export_reports'
  | 'manage_users'
  | 'view_audit_logs'
  | 'manage_settings'
  | 'view_approvals'
  | 'manage_approvals';

const ROLE_PERMISSIONS: Record<AppRole, Permission[]> = {
  admin: [
    'view_dashboard', 'view_companies', 'manage_companies', 'view_clients', 'manage_clients',
    'upload_data', 'validate_data', 'import_data', 'rollback_upload',
    'view_payments', 'create_payment_batch', 'approve_payment_batch', 'process_payment_batch',
    'view_reconciliation', 'run_reconciliation', 'apply_reconciliation',
    'view_reports', 'export_reports', 'manage_users', 'view_audit_logs', 'manage_settings',
    'view_approvals', 'manage_approvals'
  ],
  supervisor: [
    'view_dashboard', 'view_companies', 'view_clients',
    'upload_data', 'validate_data', 'import_data', 'rollback_upload',
    'view_payments', 'create_payment_batch', 'approve_payment_batch', 'process_payment_batch',
    'view_reconciliation', 'run_reconciliation', 'apply_reconciliation',
    'view_reports', 'export_reports', 'view_audit_logs', 'view_approvals', 'manage_approvals'
  ],
  operator: [
    'view_dashboard', 'view_companies', 'view_clients',
    'upload_data', 'validate_data', 'import_data',
    'view_payments', 'create_payment_batch',
    'view_reconciliation', 'run_reconciliation',
    'view_reports', 'export_reports'
  ],
  maker: [
    'view_dashboard', 'view_companies', 'view_clients',
    'upload_data', 'validate_data', 'import_data',
    'view_payments', 'create_payment_batch',
    'view_reconciliation', 'run_reconciliation',
    'view_reports', 'export_reports'
  ],
  checker: [
    'view_dashboard', 'view_companies', 'view_clients',
    'view_payments', 'view_reconciliation',
    'view_reports', 'view_approvals'
  ],
  approver: [
    'view_dashboard', 'view_companies', 'view_clients',
    'view_payments', 'approve_payment_batch', 'process_payment_batch',
    'view_reconciliation', 'apply_reconciliation',
    'view_reports', 'view_approvals', 'manage_approvals'
  ],
  auditor: [
    'view_dashboard', 'view_companies', 'view_clients',
    'view_payments', 'view_reconciliation',
    'view_reports', 'view_audit_logs', 'view_approvals'
  ],
  read_only: [
    'view_dashboard', 'view_companies', 'view_clients',
    'view_payments', 'view_reconciliation', 'view_reports'
  ]
};

export const RBACService = {
  hasRole(user: UserContext | null, requiredRoles: AppRole[]): boolean {
    if (!user) return false;
    if (user.roles.includes('admin')) return true;
    return requiredRoles.some(role => user.roles.includes(role));
  },

  hasPermission(user: UserContext | null, permission: Permission): boolean {
    if (!user) return false;
    if (user.roles.includes('admin')) return true;
    return user.roles.some(role => ROLE_PERMISSIONS[role]?.includes(permission));
  },

  hasAnyPermission(user: UserContext | null, permissions: Permission[]): boolean {
    if (!user) return false;
    if (user.roles.includes('admin')) return true;
    return permissions.some(permission => this.hasPermission(user, permission));
  },

  canAccessCompany(user: UserContext | null, companyId: string): boolean {
    if (!user) return false;
    if (user.roles.includes('admin')) return true;
    if (!user.companyIds || user.companyIds.length === 0) return true;
    return user.companyIds.includes(companyId);
  },

  canApprove(user: UserContext | null, recordType: string): boolean {
    if (!user) return false;
    if (user.roles.includes('admin')) return true;
    if (user.roles.includes('approver')) return true;
    if (user.roles.includes('supervisor')) return true;
    if (recordType === 'payment_batches' && user.roles.includes('checker')) return true;
    return false;
  },

  canCreate(user: UserContext | null, recordType: string): boolean {
    if (!user) return false;
    if (user.roles.includes('admin')) return true;
    if (user.roles.includes('maker')) return true;
    if (user.roles.includes('operator')) return true;
    if (user.roles.includes('supervisor')) return true;
    return false;
  },

  canProcess(user: UserContext | null, recordType: string): boolean {
    if (!user) return false;
    if (user.roles.includes('admin')) return true;
    if (user.roles.includes('approver')) return true;
    if (user.roles.includes('supervisor')) return true;
    return false;
  },

  getRolePermissions(role: AppRole): Permission[] {
    return ROLE_PERMISSIONS[role] || [];
  },

  getAllRoles(): AppRole[] {
    return ['admin', 'supervisor', 'operator', 'maker', 'checker', 'approver', 'auditor', 'read_only'];
  }
};