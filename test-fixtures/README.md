# Test Fixtures — auto-generated upload matrices

> [!IMPORTANT]
> The spreadsheet fixtures **are not committed**. All `*.xlsx` / `*.xls` / `*.csv`
> files are gitignored project-wide in `.gitignore` because this system handles real
> shareholder / bank / financial data and we never want sample payloads that look
> like production data to end up in version control.

Instead, every fixture is generated deterministically from a single source of truth:
`scripts/generate_all_test_fixtures.mjs`.

## Regenerate everything

```powershell
npm run fixtures:generate
```

The `e2e/uploads-all-sections.spec.ts` Playwright suite also auto-regenerates any
missing fixtures on startup, so a fresh checkout works with zero manual steps.

## Fixture matrix

| #      | Section / edge case                     | File                                    | Parser / flow covered                                                                              |
| ------ | --------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1      | Dividend Payables                       | `section1_dividend_payables.xlsx`       | `ExcelParser` → Universal Wizard `/upload` (natural 5%, corporate 15%, tax-exempt 0%, foreign 15%) |
| 2      | Debenture Interest Payables             | `section2_debenture_interest.xlsx`      | `ExcelParser` → `/upload` debenture detection + TDS                                                |
| 3      | Mutual Fund Payables                    | `section3_mutual_fund.xlsx`             | `ExcelParser` → `/upload` mutual fund detection                                                    |
| 4      | Bank Statement                          | `section4_bank_statement.xlsx` + `.csv` | `BankParser.parseExcelSettlement` / `parseBankStatement` → `/reconciliation`                       |
| 5      | Clients Master Data                     | `section5_clients_master.xlsx`          | `importFromExcel` → `/clients`                                                                     |
| 6      | Companies Master Data                   | `section6_companies_master.xlsx`        | `importFromExcel` → `/companies`                                                                   |
| Edge 1 | Arithmetic mismatch (gross − tax ≠ net) | `edge_case_math_mismatch.xlsx`          | `ValidationEngine` → `net_mismatch`                                                                |
| Edge 2 | Invalid / truncated Demat BOID          | `edge_case_invalid_boid.xlsx`           | `ValidationEngine` → `invalid_boid`                                                                |

## Parse-check every fixture without a browser

```powershell
npm run fixtures:generate
npm run test:fixtures   # runs scripts/verify_upload_fixtures.ts against every parser
```
