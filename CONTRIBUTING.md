# Contributing to RTARTS System

Thank you for contributing to the RTARTS System codebase.

## Engineering Workflow & Guidelines

### 1. Branch Strategy & Git Rules
- **Standalone History**: Never force push (git push --force) or rewrite published commits on main.
- **Working State**: Keep branches in a compiling and working state at all times.
- **Feature Branches**: Create descriptive branches (e.g., eature/payout-reconciliation, ix/tax-rate-calc).

### 2. Code Quality & Standards
- **Framework**: TanStack Start / React 19, Tailwind CSS, TypeScript, Supabase PostgreSQL.
- **Strict Calculations**: Financial and tax arithmetic must use bounded formulas, roundings (Math.round(val * 100) / 100), and non-negative guards.
- **No Direct Mutation**: State updates and cache mutations must flow through TanStack Query (invalidateQueries) and validated service layers.

### 3. Verification & Testing
Before submitting a Pull Request, verify:
`ash
# 1. Run all unit tests
npx vitest run

# 2. Verify full production build
npm run build
`
All unit tests must pass with **0 failures**, and the production build must compile with **0 errors**.

### 4. Code Review & Maker-Checker
- All financial, tax, or workflow modifications require review from a designated system maintainer before merging into main.
