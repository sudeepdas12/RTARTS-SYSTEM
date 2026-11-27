import { describe, it, expect, vi } from "vitest";
import { WorkflowEngine } from "./workflow-engine";
import { supabase } from "./services/database";

vi.mock("./services/database", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock("./services/notification.service", () => ({
  NotificationService: {
    sendNotification: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock("./services/settings.service", () => ({
  SettingsService: {
    getSettings: vi.fn().mockResolvedValue({ require_maker_checker: true }),
  },
}));

describe("WorkflowEngine", () => {
  it("defines valid transitions for payment_batches including Returned -> Pending resubmission", () => {
    const config = WorkflowEngine.getConfig("payment_batches");
    expect(config).toBeDefined();

    const returnedTransition = config?.transitions.find(
      (t) => t.from === "Returned" && t.to === "Pending" && t.action === "submit",
    );
    expect(returnedTransition).toBeDefined();
    expect(returnedTransition?.requiredRole).toContain("maker");
  });

  it("rejects unauthenticated/null user from transitioning (fail-closed RBAC)", () => {
    const canDo = WorkflowEngine.canTransition(null, "payment_batches", "Draft", "submit");
    expect(canDo).toBe(false);
  });

  it("allows authorized user to transition", () => {
    const user = {
      id: "user-1",
      roles: ["maker"],
    } as any;

    const canSubmit = WorkflowEngine.canTransition(user, "payment_batches", "Draft", "submit");
    expect(canSubmit).toBe(true);

    const canApprove = WorkflowEngine.canTransition(user, "payment_batches", "Pending", "approve");
    expect(canApprove).toBe(false);
  });

  it("returns notFound=true cleanly via maybeSingle() when target batch no longer exists", async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
    (supabase.from as any).mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: maybeSingleMock,
        }),
      }),
    });

    const checker = { id: "checker-1", roles: ["supervisor"] } as any;
    const res = await WorkflowEngine.processAction(
      "00000000-0000-0000-0000-000000000099",
      "payment_batches",
      "approve",
      "ok",
      checker,
    );

    expect(maybeSingleMock).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(false);
    expect(res.notFound).toBe(true);
    expect(res.error).toContain("no longer exists");
  });
});
