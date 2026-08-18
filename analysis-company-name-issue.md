# Analysis: Company Name Extraction & Other Issues Found During Import

## Issue 1: Company Name Extraction (Main Issue)

### Root Cause
The system **never extracts the company name from the uploaded Excel file**. Tracing the import flow:

1. **`ExcelParser.parseFile()`** - Parses the file columns/rows but does NOT extract company name from anywhere (file name, sheet title rows, etc.)
2. **`ImportService.processChunk()`** (client-side) / **Edge Function** (server-side):
   - Fetches the first company from `companies` table
   - If none exists, creates a **hardcoded** company: `"Supermai Hydropower Ltd."` (code: `"SMHL"`)
3. All payable records are created with this company_id regardless of what file was uploaded

### Evidence from Sample Files:
| File Name | Actual Company | System Action |
|---|---|---|
| `SUPERMAI DIVIDEND RECONCILATION 2080-81_FINAL.xlsx` | Supermai Hydropower Ltd. | Works (matches hardcoded fallback) |
| `NECO PUBLIC 27TH AGM FY 2078-79.xlsx` | Nepal Community (NECO) | **FAILS** - uses wrong company |
| `7% RBB Debenture 2088-Reconciliation.xlsx` | Rastriya Banijya Bank Ltd. | **FAILS** - uses wrong company |

### When It Fails:
- If a company already exists in DB → uses that company (could be completely unrelated)
- If no company exists → creates "Supermai Hydropower Ltd." for ALL files
- The SUMMARY sheet in Supermai file shows "SUPERMAI HYDROPOWER LTD." as a title row, but this data is discarded during parsing

## Issue 2: Missing Column Aliases (RBB Debenture File)

### `FATHER_NAME_MOTHER_NAME` not mapped
- RBB file header: `"FATHER_NAME_MOTHER_NAME"`
- COLUMN_ALIASES for `father_name` only has: `["FATHER'S NAME", "FATHER_NAME", "FATHER NAME", "FATHER'S NAME "]`
- Does NOT include `"FATHER_NAME_MOTHER_NAME"`
- **Result**: father_name data is NOT extracted from RBB debenture files

### `GRANDFATHER_NAME_SPOUSE_NAME` not mapped
- RBB file header: `"GRANDFATHER_NAME_SPOUSE_NAME"`
- COLUMN_ALIASES for `grandfather_name` only has: `["GRANDFATHER'S NAME", "GRANDFATHER_NAME", "GRANDFATHER NAME", "GRANDFATHER'S NAME "]`
- Does NOT include `"GRANDFATHER_NAME_SPOUSE_NAME"`
- **Result**: grandfather_name data is NOT extracted from RBB debenture files

## Issue 3: Overlapping Field Mappings in LOCAL UNVERIFIED Sheet

In the Supermai file's LOCAL UNVERIFIED sheet, BOTH `NET_DIV.` and `ROUND UP DIV` columns appear. Both map to `net_payable` in COLUMN_ALIASES:

```javascript
net_payable: ['NET_DIV.', 'NET INTEREST PAYABLE', 'NET DIVIDEND', 'NET PAYABLE', 'ROUND UP DIV', 'ROUNDUP', 'NET']
```

The mapping loop processes headers in order, so `ROUND UP DIV` **overwrites** the `NET_DIV.` mapping:
```javascript
mapping[header] = key;  // Later header with same key overwrites earlier
```

**Impact**: The `net_payable` value is read from `ROUND UP DIV` column instead of `NET_DIV.`. In practice these are close (rounded vs unrounded), but technically incorrect.

## Issue 4: LOCAL UNVERIFIED Sheet Missing Bank Details

The LOCAL UNVERIFIED sheet in Supermai file has **no bank columns** (no bank_code, bank_name, bank_account_no). The code currently allows imports without bank details ("do not block files with missing bank details"), but these records are inserted with empty bank fields. This could cause issues during payment processing.

## Issue 5: `TOTA KITTA` Alias for shares_held

The Supermai file uses `"TOTA KITTA"` as header. The COLUMN_ALIASES for `shares_held` has `'TOTA KITTA'` in its list: `['TOTA KITTA', 'ALLOTED_QUANTITY', 'SHARES', 'TOTAL SHARES', 'KITTA']`
- This one IS mapped correctly and works.

## Summary of Fixes Needed

1. **Extract company name from file** - Either from file name, sheet name, or title rows in sheets
2. **Add `FATHER_NAME_MOTHER_NAME`** to father_name aliases
3. **Add `GRANDFATHER_NAME_SPOUSE_NAME`** to grandfather_name aliases
4. **Fix overlapping mappings** - Skip field if already mapped, or handle NET_DIV vs ROUNDUP properly
5. **Add bank columns fallback** for LOCAL_UNVERIFIED sheets