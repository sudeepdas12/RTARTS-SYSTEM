# Security Policy

## Supported Versions

Please refer to the table below for the current maintenance and security status of RTARTS System releases:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

The security of financial operations, investor personally identifiable information (PII), bank account records, and payout transactions in the RTARTS System is of utmost importance.

If you discover a security vulnerability or sensitive data exposure risk, **please do NOT report it through public GitHub issues**.

### How to Report

Please report all security vulnerabilities privately:
- **Contact**: Contact the system administrator or repository maintainer privately.
- **Email**: security@rtarts-system.local
- **Information to include**:
  - Summary of the vulnerability or security flaw
  - Step-by-step reproduction instructions or proof-of-concept
  - Affected modules (e.g., Supabase RLS, authentication, maker-checker workflow, ConnectIPS file generation)
  - Estimated impact and severity assessment

### Response SLA

- **Initial Triage & Acknowledgment**: Within 24 hours
- **Impact Assessment**: Within 48 hours
- **Patch & Security Advisory**: Deployed promptly based on severity

### Security Architecture

- **Maker-Checker Segregation**: Critical workflow actions (`approve`, `process`, `complete`, `reject`, `return`) enforce role segregation between makers and reviewers.
- **Fail-Closed RBAC**: Authorization checks fail closed if user identity is missing or unverified.
- **Database Row Level Security (RLS)**: Client PII, BOIDs, bank accounts, and payment histories are strictly protected at the database tier.
