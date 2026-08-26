import { describe, it, expect, vi } from 'vitest';
import { WorkflowEngine } from './workflow-engine';

vi.mock('./services/database', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('./services/notification.service', () => ({
  NotificationService: {
    sendNotification: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('./services/settings.service', () => ({
  SettingsService: {
    getSettings: vi.fn().mockResolvedValue({ require_maker_checker: true }),
  },
}));

describe('WorkflowEngine', () => {
  it('defines valid transitions for payment_batches including Returned -> Pending resubmission', () => {
    const config = WorkflowEngine.getConfig('payment_batches');
    expect(config).toBeDefined();

    const returnedTransition = config?.transitions.find(
      t => t.from === 'Returned' && t.to === 'Pending' && t.action === 'submit'
    );
    expect(returnedTransition).toBeDefined();
    expect(returnedTransition?.requiredRole).toContain('maker');
  });

  it('rejects unauthenticated/null user from transitioning (fail-closed RBAC)', () => {
    const canDo = WorkflowEngine.canTransition(null, 'payment_batches', 'Draft', 'submit');
    expect(canDo).toBe(false);
  });

  it('allows authorized user to transition', () => {
    const user = {
      id: 'user-1',
      roles: ['maker'],
    } as any;

    const canSubmit = WorkflowEngine.canTransition(user, 'payment_batches', 'Draft', 'submit');
    expect(canSubmit).toBe(true);

    const canApprove = WorkflowEngine.canTransition(user, 'payment_batches', 'Pending', 'approve');
    expect(canApprove).toBe(false);
  });
});
