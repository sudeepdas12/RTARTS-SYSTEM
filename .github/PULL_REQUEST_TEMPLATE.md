## Summary of Changes

<!-- Provide a brief description of what this PR introduces, fixes, or improves. -->

## Impact Area

- [ ] Classification & Categorization (smart-classifier.ts, investor-category.ts)
- [ ] Financial Calculation & Tax Rules (dividend-calculator.ts, interest-calculator.ts, tax-rules.service.ts)
- [ ] Payments & Settlement (payment.service.ts, bank-parser.ts, reconciliation-engine.ts)
- [ ] Workflow & Maker-Checker (workflow-engine.ts, approvals.tsx)
- [ ] Excel Import & Data Management (import.service.ts, chunk-processor.ts, data-management.service.ts)
- [ ] Reports & Registers (report.service.ts, reports.tsx)
- [ ] Database Migrations / Schema Changes

## Verification & Checklist

- [ ] npm run lint executed with **0 warnings / errors**
- [ ] npm run typecheck (tsc --noEmit) executed with **0 type errors**
- [ ] npx vitest run executed with **0 failures**
- [ ] npm run build completed successfully with **0 compilation errors**
- [ ] No regression in financial calculations (gross, tax, net balance verified)
- [ ] Maker-checker role segregation preserved
- [ ] Documentation / comments preserved
