import { describe, it, expect } from "vitest";
import { RBACService, ROUTE_PERMISSIONS } from "./rbac-service";
import type { UserContext } from "./rbac-service";

describe("RBACService Security Matrix", () => {
  const adminUser: UserContext = { id: "user-admin", roles: ["admin"] };
  const supervisorUser: UserContext = { id: "user-supervisor", roles: ["supervisor"] };
  const makerUser: UserContext = { id: "user-maker", roles: ["maker"] };
  const checkerUser: UserContext = { id: "user-checker", roles: ["checker"] };
  const approverUser: UserContext = { id: "user-approver", roles: ["approver"] };
  const operatorUser: UserContext = { id: "user-operator", roles: ["operator"] };
  const readOnlyUser: UserContext = { id: "user-readonly", roles: ["read_only"] };
  const auditorUser: UserContext = { id: "user-auditor", roles: ["auditor"] };
  const financeUser: UserContext = { id: "user-finance", roles: ["finance_operator"] };
  const reconUser: UserContext = { id: "user-recon", roles: ["reconciliation_officer"] };
  const reportUser: UserContext = { id: "user-report", roles: ["report_viewer"] };

  describe("canRead (Read-Only Domains & Auditor Access)", () => {
    it("allows admin to read any domain", () => {
      expect(RBACService.canRead(adminUser, "payments")).toBe(true);
      expect(RBACService.canRead(adminUser, "companies")).toBe(true);
      expect(RBACService.canRead(adminUser, "audit_logs")).toBe(true);
      expect(RBACService.canRead(adminUser, "reconciliation")).toBe(true);
    });

    it("allows read_only user to read standard domains", () => {
      expect(RBACService.canRead(readOnlyUser, "payments")).toBe(true);
      expect(RBACService.canRead(readOnlyUser, "companies")).toBe(true);
      expect(RBACService.canRead(readOnlyUser, "reports")).toBe(true);
    });

    it("disallows read_only user from admin/audit domains", () => {
      expect(RBACService.canRead(readOnlyUser, "audit_logs")).toBe(false);
      expect(RBACService.canRead(readOnlyUser, "settings")).toBe(false);
    });

    it("allows auditor to read-only access all financial records, reconciliation results, and audit trails", () => {
      expect(RBACService.canRead(auditorUser, "audit_logs")).toBe(true);
      expect(RBACService.canRead(auditorUser, "audit")).toBe(true);
      expect(RBACService.canRead(auditorUser, "reports")).toBe(true);
      expect(RBACService.canRead(auditorUser, "payments")).toBe(true);
      expect(RBACService.canRead(auditorUser, "reconciliation")).toBe(true);
      expect(RBACService.canRead(auditorUser, "companies")).toBe(true);
      expect(RBACService.canRead(auditorUser, "clients")).toBe(true);
      expect(RBACService.canRead(auditorUser, "approvals")).toBe(true);
      expect(RBACService.canRead(auditorUser, "dashboard")).toBe(true);
    });

    it("returns false if user context is null", () => {
      expect(RBACService.canRead(null, "payments")).toBe(false);
    });
  });

  describe("canWrite & Action Permissions (Strict Modification Guard)", () => {
    it("allows admin to write to all operational and management domains", () => {
      expect(RBACService.canWrite(adminUser, "payments")).toBe(true);
      expect(RBACService.canWrite(adminUser, "companies")).toBe(true);
      expect(RBACService.canWrite(adminUser, "clients")).toBe(true);
      expect(RBACService.canWrite(adminUser, "uploads")).toBe(true);
      expect(RBACService.canWrite(adminUser, "settings")).toBe(true);
    });

    it("allows maker and operator to create payments and upload data", () => {
      expect(RBACService.canWrite(makerUser, "payments")).toBe(true);
      expect(RBACService.canWrite(makerUser, "uploads")).toBe(true);
      expect(RBACService.canWrite(operatorUser, "payments")).toBe(true);
      expect(RBACService.canWrite(operatorUser, "uploads")).toBe(true);
    });

    it("strictly denies auditor from writing to ANY operational domain", () => {
      expect(RBACService.canWrite(auditorUser, "payments")).toBe(false);
      expect(RBACService.canWrite(auditorUser, "companies")).toBe(false);
      expect(RBACService.canWrite(auditorUser, "clients")).toBe(false);
      expect(RBACService.canWrite(auditorUser, "uploads")).toBe(false);
      expect(RBACService.canWrite(auditorUser, "reconciliation")).toBe(false);
      expect(RBACService.canWrite(auditorUser, "settings")).toBe(false);
      expect(RBACService.canWrite(auditorUser, "approvals")).toBe(false);
    });

    it("denies read_only user from writing to any domain", () => {
      expect(RBACService.canWrite(readOnlyUser, "payments")).toBe(false);
      expect(RBACService.canWrite(readOnlyUser, "companies")).toBe(false);
      expect(RBACService.canWrite(readOnlyUser, "clients")).toBe(false);
    });
  });

  describe("canApprove (Maker-Checker & Approver Separation)", () => {
    it("allows admin, supervisor, and checker to approve payment batches", () => {
      expect(RBACService.canApprove(adminUser, "payment_batches")).toBe(true);
      expect(RBACService.canApprove(supervisorUser, "payment_batches")).toBe(true);
      expect(RBACService.canApprove(checkerUser, "payment_batches")).toBe(true);
      expect(RBACService.canApprove(approverUser, "payment_batches")).toBe(true);
      expect(RBACService.hasPermission(checkerUser, "approve_payment_batch")).toBe(true);
      expect(RBACService.hasPermission(checkerUser, "manage_approvals")).toBe(true);
    });

    it("denies maker from approving payment batches", () => {
      expect(RBACService.canApprove(makerUser, "payment_batches")).toBe(false);
    });

    it("strictly denies auditor and read_only from approving anything", () => {
      expect(RBACService.canApprove(readOnlyUser, "payment_batches")).toBe(false);
      expect(RBACService.canApprove(auditorUser, "payment_batches")).toBe(false);
      expect(RBACService.canApprove(auditorUser, "approvals")).toBe(false);
    });
  });

  describe("Rollback Upload Permissions (Exclusively Admin)", () => {
    it("strictly reserves rollback_upload permission for admin only", () => {
      expect(RBACService.hasPermission(adminUser, "rollback_upload")).toBe(true);
      expect(RBACService.hasPermission(supervisorUser, "rollback_upload")).toBe(false);
      expect(RBACService.hasPermission(auditorUser, "rollback_upload")).toBe(false);
      expect(RBACService.hasPermission(makerUser, "rollback_upload")).toBe(false);
      expect(RBACService.hasPermission(operatorUser, "rollback_upload")).toBe(false);
      expect(RBACService.hasPermission(financeUser, "rollback_upload")).toBe(false);
      expect(RBACService.hasPermission(readOnlyUser, "rollback_upload")).toBe(false);
    });
  });

  describe("canExport Reports & Audit Documentation", () => {
    it("allows admin, supervisor, report_viewer, and auditor to export reports", () => {
      expect(RBACService.canExport(adminUser)).toBe(true);
      expect(RBACService.canExport(supervisorUser)).toBe(true);
      expect(RBACService.canExport(reportUser)).toBe(true);
      expect(RBACService.canExport(auditorUser)).toBe(true);
      expect(RBACService.canExport(financeUser)).toBe(true);
    });

    it("denies read_only user from exporting reports", () => {
      expect(RBACService.canExport(readOnlyUser)).toBe(false);
    });
  });

  describe("canAccessCompany (Multi-Tenant Access Isolation)", () => {
    it("allows admin to access any company", () => {
      expect(RBACService.canAccessCompany(adminUser, "company-123")).toBe(true);
    });

    it("allows unrestricted user to access any company", () => {
      expect(RBACService.canAccessCompany(supervisorUser, "company-123")).toBe(true);
    });

    it("restricts user with explicit companyIds list", () => {
      const restrictedUser: UserContext = {
        id: "user-restricted",
        roles: ["operator"],
        companyIds: ["comp-A", "comp-B"],
      };
      expect(RBACService.canAccessCompany(restrictedUser, "comp-A")).toBe(true);
      expect(RBACService.canAccessCompany(restrictedUser, "comp-B")).toBe(true);
      expect(RBACService.canAccessCompany(restrictedUser, "comp-C")).toBe(false);
    });
  });

  describe("Route-level RBAC role authorization (ROUTE_PERMISSIONS Catalog)", () => {
    it("restricts /settings, /backup, /data-management, and /users to admin ONLY", () => {
      expect(ROUTE_PERMISSIONS["/users"]).toEqual(["admin"]);
      expect(ROUTE_PERMISSIONS["/settings"]).toEqual(["admin"]);
      expect(ROUTE_PERMISSIONS["/settings/fiscal-years"]).toEqual(["admin"]);
      expect(ROUTE_PERMISSIONS["/data-management"]).toEqual(["admin"]);
      expect(ROUTE_PERMISSIONS["/backup"]).toEqual(["admin"]);

      expect(RBACService.hasRole(adminUser, ROUTE_PERMISSIONS["/users"])).toBe(true);
      expect(RBACService.hasRole(supervisorUser, ROUTE_PERMISSIONS["/users"])).toBe(false);
      expect(RBACService.hasRole(auditorUser, ROUTE_PERMISSIONS["/users"])).toBe(false);
      expect(RBACService.hasRole(auditorUser, ROUTE_PERMISSIONS["/backup"])).toBe(false);
      expect(RBACService.hasRole(auditorUser, ROUTE_PERMISSIONS["/data-management"])).toBe(false);
      expect(RBACService.hasRole(auditorUser, ROUTE_PERMISSIONS["/settings"])).toBe(false);
    });

    it("allows auditor read-only access on records, history, reconciliation, and audit logs", () => {
      expect(RBACService.hasRole(auditorUser, ROUTE_PERMISSIONS["/companies"])).toBe(true);
      expect(RBACService.hasRole(auditorUser, ROUTE_PERMISSIONS["/clients"])).toBe(true);
      expect(RBACService.hasRole(auditorUser, ROUTE_PERMISSIONS["/dividend"])).toBe(true);
      expect(RBACService.hasRole(auditorUser, ROUTE_PERMISSIONS["/interest"])).toBe(true);
      expect(RBACService.hasRole(auditorUser, ROUTE_PERMISSIONS["/mutual-fund"])).toBe(true);
      expect(RBACService.hasRole(auditorUser, ROUTE_PERMISSIONS["/payments"])).toBe(true);
      expect(RBACService.hasRole(auditorUser, ROUTE_PERMISSIONS["/reconciliation"])).toBe(true);
      expect(RBACService.hasRole(auditorUser, ROUTE_PERMISSIONS["/upload-history"])).toBe(true);
      expect(RBACService.hasRole(auditorUser, ROUTE_PERMISSIONS["/reports"])).toBe(true);
      expect(RBACService.hasRole(auditorUser, ROUTE_PERMISSIONS["/audit-logs"])).toBe(true);
      expect(RBACService.hasRole(auditorUser, ROUTE_PERMISSIONS["/approvals"])).toBe(true);
    });

    it("denies auditor from modification and upload routes", () => {
      expect(RBACService.hasRole(auditorUser, ROUTE_PERMISSIONS["/upload"])).toBe(false);
    });

    it("verifies permissions for finance_operator, reconciliation_officer, and report_viewer", () => {
      // Finance operator can write payments and export reports
      expect(RBACService.canWrite(financeUser, "payments")).toBe(true);
      expect(RBACService.canExport(financeUser)).toBe(true);
      expect(RBACService.canApprove(financeUser, "payment_batches")).toBe(false);

      // Reconciliation officer can run recon but not write payments
      expect(RBACService.canRead(reconUser, "reconciliation")).toBe(true);
      expect(RBACService.canWrite(reconUser, "payments")).toBe(false);

      // Report viewer can read and export reports, cannot write or approve
      expect(RBACService.canRead(reportUser, "reports")).toBe(true);
      expect(RBACService.canExport(reportUser)).toBe(true);
      expect(RBACService.canWrite(reportUser, "reports")).toBe(false);
      expect(RBACService.canApprove(reportUser, "payment_batches")).toBe(false);
    });
  });
});
