import { describe, it, expect } from "vitest";
import { RBACService } from "./rbac-service";
import type { UserContext } from "./rbac-service";

describe("RBACService Security Matrix", () => {
  const adminUser: UserContext = { id: "user-admin", roles: ["admin"] };
  const supervisorUser: UserContext = { id: "user-supervisor", roles: ["supervisor"] };
  const makerUser: UserContext = { id: "user-maker", roles: ["maker"] };
  const checkerUser: UserContext = { id: "user-checker", roles: ["checker"] };
  const readOnlyUser: UserContext = { id: "user-readonly", roles: ["read_only"] };
  const auditorUser: UserContext = { id: "user-auditor", roles: ["auditor"] };

  describe("canRead", () => {
    it("allows admin to read any domain", () => {
      expect(RBACService.canRead(adminUser, "payments")).toBe(true);
      expect(RBACService.canRead(adminUser, "companies")).toBe(true);
      expect(RBACService.canRead(adminUser, "audit_logs")).toBe(true);
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

    it("allows auditor to read audit logs and reports", () => {
      expect(RBACService.canRead(auditorUser, "audit_logs")).toBe(true);
      expect(RBACService.canRead(auditorUser, "reports")).toBe(true);
    });

    it("returns false if user context is null", () => {
      expect(RBACService.canRead(null, "payments")).toBe(false);
    });
  });

  describe("canWrite", () => {
    it("allows admin to write to all domains", () => {
      expect(RBACService.canWrite(adminUser, "payments")).toBe(true);
      expect(RBACService.canWrite(adminUser, "companies")).toBe(true);
      expect(RBACService.canWrite(adminUser, "clients")).toBe(true);
    });

    it("allows maker to create payments", () => {
      expect(RBACService.canWrite(makerUser, "payments")).toBe(true);
    });

    it("denies read_only user from writing to any domain", () => {
      expect(RBACService.canWrite(readOnlyUser, "payments")).toBe(false);
      expect(RBACService.canWrite(readOnlyUser, "companies")).toBe(false);
      expect(RBACService.canWrite(readOnlyUser, "clients")).toBe(false);
    });

    it("denies auditor from writing to payments", () => {
      expect(RBACService.canWrite(auditorUser, "payments")).toBe(false);
    });
  });

  describe("canApprove", () => {
    it("allows admin, supervisor, and checker to approve payment batches", () => {
      expect(RBACService.canApprove(adminUser, "payment_batches")).toBe(true);
      expect(RBACService.canApprove(supervisorUser, "payment_batches")).toBe(true);
      expect(RBACService.canApprove(checkerUser, "payment_batches")).toBe(true);
      expect(RBACService.hasPermission(checkerUser, "approve_payment_batch")).toBe(true);
      expect(RBACService.hasPermission(checkerUser, "manage_approvals")).toBe(true);
    });

    it("denies maker from approving payment batches", () => {
      expect(RBACService.canApprove(makerUser, "payment_batches")).toBe(false);
    });

    it("denies read_only and auditor from approving", () => {
      expect(RBACService.canApprove(readOnlyUser, "payment_batches")).toBe(false);
      expect(RBACService.canApprove(auditorUser, "payment_batches")).toBe(false);
    });
  });

  describe("canExport", () => {
    it("allows admin and supervisor to export reports", () => {
      expect(RBACService.canExport(adminUser)).toBe(true);
      expect(RBACService.canExport(supervisorUser)).toBe(true);
    });

    it("denies read_only user from exporting reports", () => {
      expect(RBACService.canExport(readOnlyUser)).toBe(false);
    });
  });

  describe("canAccessCompany", () => {
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

  describe("Route-level RBAC role authorization", () => {
    const uploadAllowedRoles = ["admin", "supervisor", "operator", "maker"] as const;
    const paymentsAllowedRoles = [
      "admin",
      "supervisor",
      "finance_operator",
      "maker",
      "checker",
      "approver",
      "read_only",
    ] as const;
    const settingsAllowedRoles = ["admin"] as const;

    it("allows authorized roles on /upload and rejects unauthorized roles", () => {
      expect(RBACService.hasRole(adminUser, uploadAllowedRoles as any)).toBe(true);
      expect(RBACService.hasRole(supervisorUser, uploadAllowedRoles as any)).toBe(true);
      expect(RBACService.hasRole(makerUser, uploadAllowedRoles as any)).toBe(true);
      expect(RBACService.hasRole(readOnlyUser, uploadAllowedRoles as any)).toBe(false);
      expect(RBACService.hasRole(auditorUser, uploadAllowedRoles as any)).toBe(false);
    });

    it("allows authorized roles on /payments", () => {
      expect(RBACService.hasRole(adminUser, paymentsAllowedRoles as any)).toBe(true);
      expect(RBACService.hasRole(makerUser, paymentsAllowedRoles as any)).toBe(true);
      expect(RBACService.hasRole(checkerUser, paymentsAllowedRoles as any)).toBe(true);
      expect(RBACService.hasRole(readOnlyUser, paymentsAllowedRoles as any)).toBe(true);
      expect(RBACService.hasRole(auditorUser, paymentsAllowedRoles as any)).toBe(false);
    });

    it("restricts /settings to admin only", () => {
      expect(RBACService.hasRole(adminUser, settingsAllowedRoles as any)).toBe(true);
      expect(RBACService.hasRole(supervisorUser, settingsAllowedRoles as any)).toBe(false);
      expect(RBACService.hasRole(makerUser, settingsAllowedRoles as any)).toBe(false);
      expect(RBACService.hasRole(readOnlyUser, settingsAllowedRoles as any)).toBe(false);
    });

    it("verifies permissions for finance_operator, reconciliation_officer, and report_viewer", () => {
      const financeUser: UserContext = { id: "user-finance", roles: ["finance_operator"] };
      const reconUser: UserContext = { id: "user-recon", roles: ["reconciliation_officer"] };
      const reportUser: UserContext = { id: "user-report", roles: ["report_viewer"] };

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

    it("verifies restricted routes /users, /audit-logs, /agm-studio, /reconciliation", () => {
      const financeUser: UserContext = { id: "user-finance", roles: ["finance_operator"] };
      const reconUser: UserContext = { id: "user-recon", roles: ["reconciliation_officer"] };

      // /users is admin only
      expect(RBACService.hasRole(adminUser, ["admin"])).toBe(true);
      expect(RBACService.hasRole(supervisorUser, ["admin"])).toBe(false);

      // /audit-logs allows admin, auditor, supervisor
      const auditRoles = ["admin", "auditor", "supervisor"] as const;
      expect(RBACService.hasRole(auditorUser, auditRoles as any)).toBe(true);
      expect(RBACService.hasRole(makerUser, auditRoles as any)).toBe(false);

      // /agm-studio allows admin, supervisor, operator, finance_operator
      const agmRoles = ["admin", "supervisor", "operator", "finance_operator"] as const;
      expect(RBACService.hasRole(financeUser, agmRoles as any)).toBe(true);
      expect(RBACService.hasRole(readOnlyUser, agmRoles as any)).toBe(false);

      // /reconciliation allows admin, supervisor, reconciliation_officer, finance_operator
      const reconRoles = [
        "admin",
        "supervisor",
        "reconciliation_officer",
        "finance_operator",
      ] as const;
      expect(RBACService.hasRole(reconUser, reconRoles as any)).toBe(true);
      expect(RBACService.hasRole(makerUser, reconRoles as any)).toBe(false);
    });
  });
});
