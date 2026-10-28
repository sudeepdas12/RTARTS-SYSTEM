export type AppRole =
  | "admin"
  | "supervisor"
  | "operator"
  | "maker"
  | "checker"
  | "approver"
  | "auditor"
  | "read_only"
  | "finance_operator"
  | "reconciliation_officer"
  | "report_viewer";

export interface UserContext {
  id: string;
  roles: AppRole[];
  companyIds?: string[]; // If restricted
}

export type Permission =
  | "view_dashboard"
  | "view_companies"
  | "manage_companies"
  | "view_clients"
  | "manage_clients"
  | "upload_data"
  | "validate_data"
  | "import_data"
  | "rollback_upload"
  | "view_payments"
  | "create_payment_batch"
  | "approve_payment_batch"
  | "process_payment_batch"
  | "view_reconciliation"
  | "run_reconciliation"
  | "apply_reconciliation"
  | "view_reports"
  | "export_reports"
  | "manage_users"
  | "view_audit_logs"
  | "manage_settings"
  | "view_approvals"
  | "manage_approvals";

const ROLE_PERMISSIONS: Record<AppRole, Permission[]> = {
  admin: [
    "view_dashboard",
    "view_companies",
    "manage_companies",
    "view_clients",
    "manage_clients",
    "upload_data",
    "validate_data",
    "import_data",
    "rollback_upload",
    "view_payments",
    "create_payment_batch",
    "approve_payment_batch",
    "process_payment_batch",
    "view_reconciliation",
    "run_reconciliation",
    "apply_reconciliation",
    "view_reports",
    "export_reports",
    "manage_users",
    "view_audit_logs",
    "manage_settings",
    "view_approvals",
    "manage_approvals",
  ],
  supervisor: [
    "view_dashboard",
    "view_companies",
    "view_clients",
    "upload_data",
    "validate_data",
    "import_data",
    "view_payments",
    "create_payment_batch",
    "approve_payment_batch",
    "process_payment_batch",
    "view_reconciliation",
    "run_reconciliation",
    "apply_reconciliation",
    "view_reports",
    "export_reports",
    "view_audit_logs",
    "view_approvals",
    "manage_approvals",
  ],
  operator: [
    "view_dashboard",
    "view_companies",
    "view_clients",
    "upload_data",
    "validate_data",
    "import_data",
    "view_payments",
    "create_payment_batch",
    "view_reconciliation",
    "run_reconciliation",
    "view_reports",
    "export_reports",
  ],
  finance_operator: [
    "view_dashboard",
    "view_companies",
    "manage_companies",
    "view_clients",
    "manage_clients",
    "upload_data",
    "validate_data",
    "import_data",
    "view_payments",
    "create_payment_batch",
    "view_reconciliation",
    "run_reconciliation",
    "view_reports",
    "export_reports",
  ],
  reconciliation_officer: [
    "view_dashboard",
    "view_companies",
    "view_clients",
    "view_payments",
    "view_reconciliation",
    "run_reconciliation",
    "apply_reconciliation",
    "view_reports",
    "export_reports",
  ],
  maker: [
    "view_dashboard",
    "view_companies",
    "view_clients",
    "upload_data",
    "validate_data",
    "import_data",
    "view_payments",
    "create_payment_batch",
    "view_reconciliation",
    "run_reconciliation",
    "view_reports",
    "export_reports",
  ],
  checker: [
    "view_dashboard",
    "view_companies",
    "view_clients",
    "view_payments",
    "approve_payment_batch",
    "view_reconciliation",
    "view_reports",
    "view_approvals",
    "manage_approvals",
  ],
  approver: [
    "view_dashboard",
    "view_companies",
    "view_clients",
    "view_payments",
    "approve_payment_batch",
    "process_payment_batch",
    "view_reconciliation",
    "apply_reconciliation",
    "view_reports",
    "view_approvals",
    "manage_approvals",
  ],
  auditor: [
    "view_dashboard",
    "view_companies",
    "view_clients",
    "view_payments",
    "view_reconciliation",
    "view_reports",
    "export_reports",
    "view_audit_logs",
    "view_approvals",
  ],
  report_viewer: [
    "view_dashboard",
    "view_companies",
    "view_clients",
    "view_reports",
    "export_reports",
  ],
  read_only: [
    "view_dashboard",
    "view_companies",
    "view_clients",
    "view_payments",
    "view_reconciliation",
    "view_reports",
  ],
};

export const RBACService = {
  hasRole(user: UserContext | null, requiredRoles: AppRole[]): boolean {
    if (!user) return false;
    if (user.roles.includes("admin")) return true;
    return requiredRoles.some((role) => user.roles.includes(role));
  },

  hasPermission(user: UserContext | null, permission: Permission): boolean {
    if (!user) return false;
    if (user.roles.includes("admin")) return true;
    return user.roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission));
  },

  hasAnyPermission(user: UserContext | null, permissions: Permission[]): boolean {
    if (!user) return false;
    if (user.roles.includes("admin")) return true;
    return permissions.some((permission) => this.hasPermission(user, permission));
  },

  canAccessCompany(user: UserContext | null, companyId: string): boolean {
    if (!user) return false;
    if (user.roles.includes("admin")) return true;
    if (!user.companyIds || user.companyIds.length === 0) return true;
    return user.companyIds.includes(companyId);
  },

  canApprove(user: UserContext | null, recordType: string): boolean {
    if (!user) return false;
    if (user.roles.includes("admin")) return true;
    if (user.roles.includes("approver")) return true;
    if (user.roles.includes("supervisor")) return true;
    if (recordType === "payment_batches" && user.roles.includes("checker")) return true;
    return false;
  },

  canCreate(user: UserContext | null, recordType: string): boolean {
    if (!user) return false;
    if (user.roles.includes("admin")) return true;
    if (user.roles.includes("maker")) return true;
    if (user.roles.includes("operator")) return true;
    if (user.roles.includes("finance_operator")) return true;
    if (user.roles.includes("supervisor")) return true;
    return false;
  },

  canProcess(user: UserContext | null, recordType: string): boolean {
    if (!user) return false;
    if (user.roles.includes("admin")) return true;
    if (user.roles.includes("approver")) return true;
    if (user.roles.includes("supervisor")) return true;
    return false;
  },

  canRead(user: UserContext | null, domain: string): boolean {
    if (!user) return false;
    if (user.roles.includes("admin")) return true;
    const permMap: Record<string, Permission> = {
      companies: "view_companies",
      clients: "view_clients",
      payments: "view_payments",
      reconciliation: "view_reconciliation",
      reports: "view_reports",
      audit_logs: "view_audit_logs",
      audit: "view_audit_logs",
      settings: "manage_settings",
      approvals: "view_approvals",
      dashboard: "view_dashboard",
    };
    const perm = permMap[domain];
    return perm ? this.hasPermission(user, perm) : true;
  },

  canWrite(user: UserContext | null, domain: string): boolean {
    if (!user) return false;
    if (user.roles.includes("admin")) return true;
    const permMap: Record<string, Permission[]> = {
      companies: ["manage_companies"],
      clients: ["manage_clients"],
      payments: ["create_payment_batch"],
      reconciliation: ["run_reconciliation", "apply_reconciliation"],
      settings: ["manage_settings"],
      approvals: ["manage_approvals"],
      uploads: ["upload_data", "import_data"],
      validation: ["validate_data"],
    };
    const perms = permMap[domain];
    return perms ? this.hasAnyPermission(user, perms) : false;
  },

  canExport(user: UserContext | null, _domain = "reports"): boolean {
    if (!user) return false;
    if (user.roles.includes("admin")) return true;
    return this.hasPermission(user, "export_reports");
  },

  getRolePermissions(role: AppRole): Permission[] {
    return ROLE_PERMISSIONS[role] || [];
  },

  getAllRoles(): AppRole[] {
    return [
      "admin",
      "supervisor",
      "approver",
      "checker",
      "maker",
      "operator",
      "finance_operator",
      "reconciliation_officer",
      "auditor",
      "report_viewer",
      "read_only",
    ];
  },
};

/**
 * Authoritative system route access policies by route path.
 * Shared across the authenticated route guard (route.tsx), the application
 * sidebar (app-sidebar.tsx), and the quick-action command palette (command-palette.tsx).
 */
export const ROUTE_PERMISSIONS: Record<string, AppRole[]> = {
  "/users": ["admin"],
  "/settings": ["admin"],
  "/settings/fiscal-years": ["admin"],
  "/data-management": ["admin"],
  "/backup": ["admin"],
  "/approvals": ["admin", "supervisor", "approver", "checker", "auditor"],
  "/audit-logs": ["admin", "auditor", "supervisor"],
  "/companies": [
    "admin",
    "supervisor",
    "operator",
    "finance_operator",
    "maker",
    "checker",
    "approver",
    "auditor",
    "read_only",
  ],
  "/clients": [
    "admin",
    "supervisor",
    "operator",
    "finance_operator",
    "maker",
    "checker",
    "approver",
    "auditor",
    "read_only",
  ],
  "/dividend": [
    "admin",
    "supervisor",
    "operator",
    "maker",
    "checker",
    "approver",
    "finance_operator",
    "auditor",
    "read_only",
  ],
  "/interest": [
    "admin",
    "supervisor",
    "operator",
    "maker",
    "checker",
    "approver",
    "finance_operator",
    "auditor",
    "read_only",
  ],
  "/mutual-fund": [
    "admin",
    "supervisor",
    "operator",
    "maker",
    "checker",
    "approver",
    "finance_operator",
    "auditor",
    "read_only",
  ],
  "/payments": [
    "admin",
    "supervisor",
    "finance_operator",
    "maker",
    "checker",
    "approver",
    "auditor",
    "read_only",
  ],
  "/reconciliation": [
    "admin",
    "supervisor",
    "reconciliation_officer",
    "finance_operator",
    "operator",
    "auditor",
    "read_only",
  ],
  "/allocations": [
    "admin",
    "supervisor",
    "finance_operator",
    "operator",
    "maker",
    "checker",
    "approver",
    "auditor",
    "read_only",
  ],
  "/agm-studio": ["admin", "supervisor", "operator", "finance_operator", "auditor", "read_only"],
  "/upload": ["admin", "supervisor", "operator", "maker", "finance_operator"],
  "/upload-history": ["admin", "supervisor", "operator", "maker", "finance_operator", "auditor"],
  "/reports": [
    "admin",
    "supervisor",
    "report_viewer",
    "auditor",
    "finance_operator",
    "read_only",
    "maker",
    "operator",
    "checker",
    "approver",
  ],
  "/analytics": [
    "admin",
    "supervisor",
    "finance_operator",
    "report_viewer",
    "auditor",
    "read_only",
  ],
  "/classification-review": ["admin", "supervisor", "checker", "approver", "operator", "auditor"],
};
