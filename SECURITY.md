# Security Policy

## Reporting a Vulnerability

The security of financial operations, investor personally identifiable information (PII), bank accounts, and settlement data in the RTARTS System is of utmost importance.

If you discover a security vulnerability or sensitive data exposure risk, **please DO NOT create a public issue**.

### How to Report

Please report security concerns privately:
- **Email**: security@rtarts-system.local (or your assigned security admin)
- **Details to Include**:
  - Description of the vulnerability or risk
  - Steps to reproduce or proof-of-concept
  - Affected components or API endpoints (e.g., Supabase RLS, workflow state machine, payment generation)
  - Potential impact assessment

### Response Timeline

- **Initial Acknowledgment**: Within 24 hours
- **Severity Assessment & Triaging**: Within 48 hours
- **Resolution / Hotfix Deployment**: Prioritized based on risk level

### Security Standards & Best Practices

1. **Maker-Checker Segregation**: Workflow review actions (pprove, process, complete, eject, eturn) enforce strict segregation of duties between operators and supervisors.
2. **Access Control**: Role-based access control (RBAC) is enforced server-side with fail-closed authentication.
3. **Data Protection**: Client PII, BOIDs, bank account details, and payment histories are guarded by Postgres Row Level Security (RLS) policies.
