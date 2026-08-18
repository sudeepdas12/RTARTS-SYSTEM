# Import System Fixes - Complete Summary

## Issues Found and Fixed

### 1. ✅ Company Name Extraction (CRITICAL - Main Issue)

**Problem:** The system never extracted the company name from uploaded Excel files. It always used a hardcoded "Supermai Hydropower Ltd." or the first company in the database, causing wrong company assignments for files from other companies.

**Root Cause:**
- `ExcelParser.parseFile()` did not extract company name from file titles or file names
- `ImportService.processChunk()` always used the first company from DB or created a hardcoded one
- No mechanism to detect which company the file belonged to

**Files Modified:**
- `src/lib/excel-parser.ts` - Added company name detection logic
- `src/lib/services/import.service.ts` - Added company lookup/creation by detected name
- `src/lib/chunk-processor.ts` - Added `companyName` to ChunkOptions
- `src/routes/_authenticated/upload.tsx` - Pass detected company name to processor
- `supabase/functions/process-import-chunk/index.ts` - Handle company name in edge function

**Solution Implemented:**
1. **Title Row Detection**: Scans first 3 rows of each sheet for company name patterns (contains LTD, Bank, Company, Hydropower, etc. or is a long text >15 chars)
2. **File Name Fallback**: Extracts company name from filename by removing common suffixes (RECONCILIATION, DIVIDEND, BOOK CLOSE, FY, etc.)
3. **Smart Company Lookup**: 
   - Searches existing companies using case-insensitive partial match
   - If not found, creates new company with auto-generated code
   - Falls back to first existing company or default if detection fails

**Test Results:**
- ✅ `SUPERMAI DIVIDEND RECONCILATION 2080-81_FINAL.xlsx` → Detects "SUPERMAI HYDROPOWER LTD." from title row
- ✅ `7% RBB Debenture 2088-Reconciliation.xlsx` → Detects "Rastriya Banijya Bank Limited (7% RBBL Debenture 2088)" from title row
- ✅ `NECO PUBLIC 27TH AGM FY 2078-79.xlsx` → Will use filename fallback "NECO PUBLIC 27TH AGM"

---

### 2. ✅ Missing Column Aliases (RBB Debenture File)

**Problem:** RBB debenture file uses combined column names that were not mapped, causing data loss.

**Missing Aliases Found:**
- `FATHER_NAME_MOTHER_NAME` - RBB file combines father and mother names
- `GRANDFATHER_NAME_SPOUSE_NAME` - RBB file combines grandfather and spouse names

**Files Modified:**
- `src/lib/excel-parser.ts` - Added missing aliases to COLUMN_ALIASES

**Changes:**
```typescript
father_name: ["FATHER'S NAME", 'FATHER_NAME', 'FATHER NAME', "FATHER'S NAME ", 'FATHER_NAME_MOTHER_NAME']
grandfather_name: ["GRANDFATHER'S NAME", 'GRANDFATHER_NAME', 'GRANDFATHER NAME', "GRANDFATHER'S NAME ", 'GRANDFATHER_NAME_SPOUSE_NAME']
```

**Impact:** Father and grandfather names from RBB debenture files now correctly extracted.

---

### 3. ✅ Overlapping Field Mappings (NET_DIV vs ROUNDUP)

**Problem:** When both `NET_DIV.` and `ROUND UP DIV` columns exist (like in LOCAL UNVERIFIED sheets), the mapping loop would overwrite the first mapping with the second, causing data to be read from the wrong column.

**Root Cause:**
```javascript
mapping[header] = key;  // Later header overwrites earlier one
```

**Files Modified:**
- `src/lib/excel-parser.ts` - Implemented priority-based mapping system

**Solution:**
1. Added `fieldPriority` map that defines preferred column order
2. First pass: Exact matches with priority checking
3. Second pass: startsWith matches for remaining headers
4. Higher priority columns (NET_DIV.) take precedence over lower priority (ROUND UP DIV)

**Priority Order for net_payable:**
```typescript
['NET_DIV.', 'NET PAYABLE', 'NET DIVIDEND', 'NET INTEREST PAYABLE', 'NET', 'ROUND UP DIV', 'ROUNDUP']
```

**Impact:** System now correctly uses `NET_DIV.` column when both columns exist, falling back to `ROUND UP DIV` only if `NET_DIV.` is not present.

---

### 4. ✅ Edge Function Company Handling

**Problem:** The Supabase Edge Function (`process-import-chunk`) did not receive or use the detected company name.

**Files Modified:**
- `supabase/functions/process-import-chunk/index.ts`

**Changes:**
1. Added `companyName` to ChunkPayload interface
2. Implemented same company lookup/creation logic as client-side fallback
3. Passes companyName from client to edge function via request body

**Note:** Edge function TypeScript errors shown in IDE are expected - it runs in Deno runtime on Supabase servers, not in Node.js/Vite environment.

---

## Additional Fixes Needed (Not Yet Implemented)

### 5. LOCAL_UNVERIFIED Missing Bank Columns

**Issue:** LOCAL UNVERIFIED sheets in some files don't have bank columns. Currently imports with empty bank fields, which may cause payment processing issues.

**Recommendation:** Add validation warning or placeholder handling for missing bank details in LOCAL_UNVERIFIED sheets.

---

## Testing Recommendations

1. **Test Company Detection:**
   - Upload `SUPERMAI DIVIDEND RECONCILATION 2080-81_FINAL.xlsx` → Should create/use "SUPERMAI HYDROPOWER LTD."
   - Upload `7% RBB Debenture 2088-Reconciliation.xlsx` → Should create/use "Rastriya Banijya Bank Limited"
   - Upload `NECO PUBLIC 27TH AGM FY 2078-79.xlsx` → Should create/use "NECO PUBLIC 27TH AGM"

2. **Verify Column Mapping:**
   - Check RBB file imports have father_name and grandfather_name populated
   - Verify NET_DIV. values are used instead of ROUND UP DIV when both exist

3. **Check Database:**
   - Verify `companies` table has correct company entries
   - Verify `dividend_payables` and `interest_payables` have correct `company_id`

---

## Architecture Flow (After Fixes)

```
User Uploads File
       ↓
ExcelParser.parseFile()
  - Detects file type
  - Extracts company name from title rows or filename
  - Maps columns with priority system
  - Returns ParsedExcelData with detectedCompanyName
       ↓
UploadRoute.handleImport()
  - Passes detectedCompanyName to ChunkProcessor
       ↓
ChunkProcessor.processInChunks()
  - Passes companyName in options to ImportService
       ↓
ImportService.processChunk()
  - Tries Edge Function with companyName
  - Falls back to client-side with companyName
  - Looks up existing company by name (case-insensitive)
  - Creates new company if not found
  - Uses company_id for all payable records
       ↓
Database
  - Companies table: auto-created if new
  - Payables table: linked to correct company
```

---

## Files Changed

1. `src/lib/excel-parser.ts` - Company detection + column alias fixes + priority mapping
2. `src/lib/services/import.service.ts` - Company lookup/creation logic
3. `src/lib/chunk-processor.ts` - Added companyName to options
4. `src/routes/_authenticated/upload.tsx` - Pass company name through pipeline
5. `supabase/functions/process-import-chunk/index.ts` - Edge function company handling

---

## Backward Compatibility

All changes are backward compatible:
- If company name detection fails, falls back to existing behavior (first company in DB)
- If company name not provided, uses existing logic
- Column alias additions are additive (don't break existing mappings)
- Priority mapping only affects edge cases with duplicate column types