import * as XLSX from 'xlsx';

export type DetectedFileType = 'debenture' | 'dividend' | 'mutual_fund' | 'bonus_share' | 'cash_dividend' | 'right_share' | 'interest' | 'raw_demat' | 'unknown';
export type DetectedSheetType = 'PUBLIC' | 'PROMOTER' | 'INSTITUTION' | 'TAX_EXEMPTED' | 'LOCAL_UNVERIFIED' | 'PRIVATE' | 'REJECT_PENDING' | 'ORIGINAL' | 'SUMMARY' | 'UNKNOWN';

export interface ColumnMapping {
  boid?: string;
  full_name?: string;
  father_name?: string;
  grandfather_name?: string;
  citizenship?: string;
  pan?: string;
  date_of_birth?: string;
  gender?: string;
  occupation?: string;
  address?: string;
  province?: string;
  district?: string;
  municipality?: string;
  phone?: string;
  email?: string;
  shares_held?: string; // KITTA / ALLOTED_QUANTITY
  bonus_actual?: string; // ACTUAL_BONUS 7%
  bonus_issued?: string; // ISSUED BONUS
  bonus_fraction?: string; // REM FRACTION / FRACTION
  after_bonus_kitta?: string; // AFTER BONUS KITTA / T.KITTA
  cash_dividend?: string; // DIVIDEND / DIVIDEND 5.631 / AMOUNT
  bon_tax?: string; // BON_TAX
  div_tax?: string; // DIV_TAX / TAX @6% / TAX
  net_payable?: string; // NET_DIV. / NET INTEREST PAYABLE / NET DIVIDEND / ROUND UP DIV
  bank_code?: string;
  bank_name?: string;
  bank_branch?: string;
  bank_account_no?: string;
  account_type?: string;
  pledge?: string;
  lot_name?: string;
  investor_type?: string; // D-PUBLIC / P-PUBLIC / TYPE
  status?: string; // STATUS / REMARKS 1
  approve_date?: string;
  isin?: string;
  client_id?: string;
}

export interface ParsedSheetData {
  sheetName: string;
  sheetType: DetectedSheetType;
  defaultTdsRate: number; // 0, 0.05, 0.06, 0.15
  detectedDividendRate?: number; // e.g. 5.631 from header "DIVIDEND 5.631"
  rows: any[];
  headers: string[];
  mapping: Record<string, keyof ColumnMapping>;
  totalKitta: number;
  totalAmount: number;
  totalTax: number;
  totalNet: number;
  rowCount: number;
  isPreCalculated: boolean;
  isRawInputFile: boolean;
  detectedIsin?: string;
  calculationDiscrepancies?: { row: number; field: string; expected: number; actual: number; }[];
}

export interface ParsedExcelData {
  fileType: DetectedFileType;
  fileName: string;
  sheets: ParsedSheetData[];
  detectedCompanyName?: string;  // Company name extracted from title rows or file name
  detectedIsin?: string; // ISIN auto-detected from sheet columns or rows
  detectedRate?: number; // Rate auto-detected from filename
  grandTotals: {
    totalRows: number;
    totalKitta: number;
    totalAmount: number;
    totalTax: number;
    totalNet: number;
  };
}

const COLUMN_ALIASES: Record<keyof ColumnMapping, string[]> = {
  boid: ['BOID', 'BENEFICIARY ID', 'CLIENT ID', 'BENEFICIARY_ID', 'CLIENT_ID', 'DP ID', 'DPID', 'BO ID', 'BO_ID', 'BENEFICIARY_NO', 'BENEFICIARY NO', 'BENEFICIARY', 'CLIENT CODE', 'CLIENT_CODE', 'DMAT A/C', 'DEMAT A/C', 'DEMAT_ACCOUNT', 'DEMAT', 'BOID NO', 'BOID NO.'],
  full_name: ['NAME', 'APPLICANT_NAME', 'APPLICANT NAME', 'SHAREHOLDER NAME', 'SHARE HOLDER NAME', 'NAME ', 'HOLDER NAME', 'UNIT HOLDER NAME', 'UNITHOLDER NAME', 'DEBENTURE HOLDER', 'INVESTOR NAME', 'ACCOUNT HOLDER', 'CLIENT NAME', 'BENEFICIARY NAME', 'FULL NAME', 'FULL_NAME', 'INVESTOR_NAME', 'PARTY NAME', 'MEMBER NAME'],
  father_name: ["FATHER'S NAME", 'FATHERS NAME', 'FATHER_NAME', 'FATHER NAME', "FATHER'S NAME ", 'FATHER_NAME_MOTHER_NAME', 'FATHER/HUSBAND NAME'],
  grandfather_name: ["GRANDFATHER'S NAME", 'GRANDFATHERS NAME', 'GRANDFATHER_NAME', 'GRANDFATHER NAME', "GRANDFATHER'S NAME ", 'GRANDFATHER_NAME_SPOUSE_NAME', 'GRAND FATHER NAME', "GRAND FATHER'S NAME"],
  citizenship: ['CITIZENSHIP', 'CITIZENSHIP_NUMBER', 'CITIZENSHIP NUMBER', 'CITIZENSHIP NO', 'CITIZENSHIP_NO', 'CITIZENSHIP NO.', 'CITIZENSHIP/REG NO', 'CITIZENSHIP_REG_NO'],
  pan: ['PAN', 'PAN NO', 'PAN NUMBER', 'PAN_NO', 'PAN_NUMBER', 'PAN NO.', 'PAN/REG NO', 'PAN_REG_NO', 'REGISTRATION NO', 'COMPANY REG NO'],
  date_of_birth: ['DOB', 'DATE OF BIRTH', 'DATE_OF_BIRTH', 'BIRTH DATE', 'BIRTH_DATE', 'D.O.B', 'D.O.B.', 'DOB (BS)', 'DOB (AD)', 'BIRTHDATE', 'DATE_OF_BIRTH_BS', 'DATE_OF_BIRTH_AD', 'BIRTH_DT'],
  gender: ['GENDER', 'SEX'],
  occupation: ['OCCUPATION', 'PROFESSION'],
  address: ['ADDRESS', 'LOCATION', 'PERMANENT ADDRESS', 'ADDRESS1', 'FULL ADDRESS', 'STREET', 'CURRENT ADDRESS'],
  province: ['PROVINCE', 'STATE', 'PROVINCE NO', 'PROVINCE_NO'],
  district: ['DISTRICT'],
  municipality: ['MUNICIPALITY', 'VDC', 'MUNICIPALITY / VDC', 'MUNICIPALITY/VDC', 'LOCAL BODY', 'MUNICIPALITY_VDC', 'VDC_MUNICIPALITY'],
  phone: ['CONTACT', 'PHONE', 'MOBILE', 'CONTACT NO', 'CONTACT ', 'CONTACT 2', 'MOBILE NO', 'MOBILE_NO', 'PHONE NO', 'PHONE_NO', 'MOBILE NUMBER', 'PHONE NUMBER', 'CONTACT NUMBER', 'TEL NO'],
  email: ['EMAIL', 'EMAIL ADDRESS', 'EMAIL_ADDRESS', 'E-MAIL', 'E-MAIL ADDRESS', 'EMAIL ID', 'E_MAIL'],
  shares_held: ['TOTAL KITTA', 'TOTA KITTA', 'ALLOTED_QUANTITY', 'ALLOTTED_QUANTITY', 'ALLOTED QUANTITY', 'ALLOTTED QUANTITY', 'SHARES', 'TOTAL SHARES', 'KITTA', 'TOTAL_KITTA', 'TOT_KITTA', 'UNITS HELD', 'UNIT HELD', 'UNITS', 'NO OF UNITS', 'NO. OF UNITS', 'NO_OF_UNITS', 'TOTAL UNITS', 'TOTAL UNIT', 'TOTAL_UNITS', 'TOT_UNITS', 'UNIT BALANCE', 'BALANCE UNITS', 'BALANCE', 'HOLDING', 'HOLDINGS', 'CURRENT HOLDING', 'HOLDING_QTY', 'QTY', 'QUANTITY', 'TOTAL QTY', 'TOT_QTY', 'FREE BALANCE', 'FREE_BALANCE', 'SAFEKEEP', 'SAFEKEEP_BALANCE', 'FACE VALUE UNITS', 'DEBENTURE UNITS', 'PRINCIPAL AMOUNT', 'NOMINAL VALUE', 'NO. OF SHARES', 'NO OF SHARES', 'NO_OF_SHARES'],
  bonus_actual: ['ACTUAL_BONUS 7%', 'ACTUAL_BONUS', 'BONUS KITTA', 'ACTUAL BONUS', 'BONUS_KITTA'],
  bonus_issued: ['ISSUED BONUS', 'ISSUED_BONUS'],
  bonus_fraction: ['REM FRACTION', 'FRACTION', 'REMAINING FRACTION', 'REM_FRACTION'],
  after_bonus_kitta: ['AFTER BONUS KITTA', 'T.KITTA', 'AFTER_BONUS_KITTA', 'TOTAL AFTER BONUS'],
  cash_dividend: ['DIVIDEND 5.631', 'DIVIDEND', 'AMOUNT/DIVIDEND', 'AMOUNT', 'DIVIDEND AMOUNT', 'DIVIDEND_AMOUNT', 'GROSS AMOUNT', 'GROSS_AMOUNT', 'GROSS DIVIDEND', 'GROSS_DIVIDEND', 'GROSS INTEREST', 'GROSS_INTEREST', 'GROSS PAYABLE', 'GROSS_PAYABLE', 'PAYABLE AMOUNT', 'DISTRIBUTION AMOUNT', 'DISTRIBUTION', 'TOTAL AMOUNT', 'TOTAL_AMOUNT', 'RETURN AMOUNT', 'RETURN', 'INTEREST-PUMORI', 'INTEREST PUMORI', 'INT. @ 7%', 'INTEREST AMOUNT', 'INT AMOUNT', 'INTEREST @ 7%', 'COUPON AMOUNT'],
  bon_tax: ['BON_TAX', 'BONUS TAX', 'BONUS_TAX'],
  div_tax: ['DIV_TAX', 'DIVIDEND TAX', 'TAX @6%', 'TAX', 'TAX AMOUNT', 'TAX_AMOUNT', 'TDS', 'TDS AMOUNT', 'TDS_AMOUNT', 'WITHHOLDING TAX', 'WHT', 'TAX DEDUCTED'],
  net_payable: ['NET_DIV.', 'NET_DIV', 'NET INTEREST PAYABLE', 'NET DIVIDEND', 'NET_DIVIDEND', 'NET PAYABLE', 'NET_PAYABLE', 'NET AMOUNT', 'NET_AMOUNT', 'ROUND UP DIV', 'ROUNDUP', 'NET', 'NET INT', 'NET INTEREST', 'NET DISTRIBUTION', 'PAYABLE NET', 'TOTAL NET', 'TOTAL_NET'],
  bank_code: ['BANK CODE', 'BANK_CODE'],
  bank_name: ['BANK NAME', 'BANK NAME ', 'BANK', 'BANK_NAME', 'BANKNAME', 'NAME OF BANK', 'BANK/FINANCIAL INSTITUTION', 'BANK / FINANCIAL INSTITUTION', 'BANK DETAILS', 'BANK_TITLE'],
  bank_branch: ['BANK BRANCH', 'BRANCH NAME', 'BRANCH', 'BANK_BRANCH', 'BANK BRANCH NAME', 'BRANCH_NAME', 'BRANCHNAME'],
  bank_account_no: ['BANK A/C NO.', 'BANK A/C NO', 'BANK_A/C_NO', 'ACCOUNT_NUMBER', 'ACCOUNT NUMBER', 'ACCOUNT NO', 'ACCOUNT NO.', 'BANK ACCOUNT NO.', 'BANK ACCOUNT NO', 'BANK_ACCOUNT_NO', 'BANK ACC NO', 'BANK ACC NO.', 'BANK ACC NUMBER', 'BANK ACCOUNT NUMBER', 'A/C NO', 'A/C NO.', 'ACC NO', 'ACC NO.', 'A/C NUMBER', 'ACC NUMBER', 'BANK A/C.', 'BANK ACC', 'A/C_NO', 'ACC_NO', 'ACCOUNT_NO', 'ACCT_NO', 'ACCT NO'],
  account_type: ['ACCOUNT TYPE', 'ACCOUNT_TYPE', 'A/C TYPE', 'ACC TYPE', 'A/C_TYPE'],
  pledge: ['PLEDGE', 'REMARKS', 'FREEZE STATUS', 'PLEDGED'],
  lot_name: ['LOT', 'LOT NAME', 'LOT_NAME'],
  investor_type: ['TYPE', 'CATEGORY', 'INVESTOR TYPE', 'HOLDER TYPE', 'SHAREHOLDER TYPE', 'INVESTOR_TYPE', 'HOLDER_TYPE'],
  status: ['STATUS', 'REMARKS 1', 'STATUS / REMARKS 1'],
  approve_date: ['APPROVED DATE', 'APPROVE DATE', 'APPROVAL_DATE'],
  isin: ['ISIN NO.', 'ISIN NO', 'ISIN', 'ISIN_NO', 'ISIN CODE', 'SECURITY CODE'],
  client_id: ['CLIENT ID', 'CLIENT_ID', 'CLIENT NO', 'CLIENT_NO', 'CLIENT NO.', 'MEMBER ID', 'MEMBER_ID']
};

export const ExcelParser = {
  async parseFile(file: File): Promise<ParsedExcelData> {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    
    let fileType: DetectedFileType = 'unknown';
    const fileNameLower = file.name.toLowerCase();
    let detectedRate: number | undefined;

    // Detect rate from filename, e.g., "PRIME DEBENTURE_8.75%.xlsx" -> 8.75
    const rateMatch = file.name.match(/(\d+(?:\.\d+)?)\s*%/);
    if (rateMatch && rateMatch[1]) {
      detectedRate = Number(rateMatch[1]);
    }

    // --- Filename-based detection (strong signals first) ---
    // NOTE: 'agm' is NOT a bonus signal. AGM files are typically cash dividend distributions.
    // Only 'bonus' in the filename explicitly means bonus shares.
    if (fileNameLower.includes('debenture') || fileNameLower.includes('interest')) {
      fileType = 'debenture';
    } else if (fileNameLower.includes('mutual fund') || fileNameLower.includes('rmf') || fileNameLower.includes('mf ') || fileNameLower.includes('mf-')) {
      fileType = 'mutual_fund';
    } else if (fileNameLower.includes('bonus share') || (fileNameLower.includes('bonus') && !fileNameLower.includes('dividend'))) {
      fileType = 'bonus_share';
    } else if (fileNameLower.includes('right share') || (fileNameLower.includes('right') && !fileNameLower.includes('copyright'))) {
      fileType = 'right_share';
    } else if (
      fileNameLower.includes('dividend') ||
      fileNameLower.includes('book close') ||
      fileNameLower.includes('agm') ||  // AGM distributions are cash dividends
      fileNameLower.includes('div ') || // "DIV " prefix
      fileNameLower.includes('batch') ||
      fileNameLower.includes('report') ||
      fileNameLower.includes('arko') ||
      fileNameLower.includes('neco') ||
      fileNameLower.includes('payout')
    ) {
      fileType = 'dividend';
    }

    // --- Content-based detection (when filename is ambiguous) ---
    // IMPORTANT: FREE BALANCE, SAFEKEEP, ISIN are standard CDS demat export columns that
    // appear in ALL file types (dividend, debenture, bonus). Do NOT use them alone to
    // classify a file as debenture — they are not debenture-specific.
    if (fileType === 'unknown') {
      for (const sheetName of workbook.SheetNames.slice(0, 5)) {
        const ws = workbook.Sheets[sheetName];
        const json2 = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
        if (!json2 || json2.length === 0) continue;

        const sampleText = json2.slice(0, 15)
          .flat()
          .filter(c => c !== null && c !== undefined)
          .map(c => String(c).toUpperCase())
          .join(' ');
        const sheetUpper = sheetName.toUpperCase();

        // Mutual fund — strong column signals
        if (/MUTUAL|RETIREMENT|RMF|UNIT HOLDER|UNIT BALANCE|DISTRIBUTION AMOUNT/.test(sheetUpper + ' ' + sampleText)) {
          fileType = 'mutual_fund';
          break;
        }

        // Debenture — requires EXPLICIT debenture markers, not generic CDS columns.
        // FREE BALANCE / SAFEKEEP / ISIN alone are NOT debenture indicators.
        if (/DEBENTURE|COUPON|COUPON AMOUNT|INT\.\s*@\s*\d|GROSS INTEREST|NET INTEREST/.test(sheetUpper + ' ' + sampleText)) {
          fileType = 'debenture';
          break;
        }

        // Bonus share — must have bonus-specific calculation columns
        if (/ACTUAL_BONUS|ISSUED BONUS|AFTER BONUS KITTA|BON_TAX|BONUS KITTA/.test(sampleText)) {
          fileType = 'bonus_share';
          break;
        }

        // Dividend — standard CDS cash dividend indicators
        if (/DIVIDEND|DIV_TAX|NET_DIV|TOTA KITTA|TOTAL KITTA|GROSS DIVIDEND|DIVIDEND AMOUNT/.test(sampleText)) {
          fileType = 'dividend';
          break;
        }

        // Raw demat / CDS shareholder register — BOID + FREE BALANCE but no financial columns
        if (/FREE BALANCE|SAFEKEEP|TOTAL KITTA/.test(sampleText) && !/DIVIDEND|DEBENTURE|COUPON|BONUS/.test(sampleText)) {
          fileType = 'raw_demat';
          break;
        }
      }
    }

    const sheets: ParsedSheetData[] = [];
    const grandTotals = { totalRows: 0, totalKitta: 0, totalAmount: 0, totalTax: 0, totalNet: 0 };

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
      if (!json || json.length === 0) continue;

      const sheetNameUpper = sheetName.toUpperCase();
      let sheetType: DetectedSheetType = 'UNKNOWN';

      if (sheetNameUpper.includes('PUBLIC')) {
        sheetType = 'PUBLIC';
      } else if (sheetNameUpper.includes('PROMOTER')) {
        sheetType = 'PROMOTER';
      } else if (sheetNameUpper.includes('INSTITUTION')) {
        sheetType = 'INSTITUTION';
      } else if (sheetNameUpper.includes('TAX EXEMPT') || sheetNameUpper.includes('EXEMPTED') || sheetNameUpper.includes('MUTUAL FUND')) {
        sheetType = 'TAX_EXEMPTED';
      } else if (sheetNameUpper.includes('LOCAL')) {
        sheetType = 'LOCAL_UNVERIFIED';
      } else if (sheetNameUpper.includes('PRIVATE')) {
        sheetType = 'PRIVATE';
      } else if (sheetNameUpper.includes('REJECT') || sheetNameUpper.includes('PENDING')) {
        sheetType = 'REJECT_PENDING';
      } else if (sheetNameUpper.includes('ORIGINAL')) {
        sheetType = 'ORIGINAL';
      } else if (sheetNameUpper.includes('SUMMARY')) {
        sheetType = 'SUMMARY';
      }

      // Ignore Summary, Original, and Reject/Pending sheets entirely — they contain roll-up
      // figures or non-final/raw data and must never be validated or imported.
      if (sheetType === 'SUMMARY' || sheetType === 'ORIGINAL' || sheetType === 'REJECT_PENDING') continue;

      let defaultTdsRate = 0.05;
      if (fileType === 'debenture') {
        if (sheetType === 'INSTITUTION') defaultTdsRate = 0.15; // Legal Person
        else if (sheetType === 'TAX_EXEMPTED') defaultTdsRate = 0; // Tax Exempted
        else defaultTdsRate = 0.06; // Natural Person (Public, Promoter, etc) pays 6% for debenture
      } else {
        // Dividend, Bonus Share, Mutual Fund
        if (sheetType === 'TAX_EXEMPTED' || fileType === 'mutual_fund') defaultTdsRate = 0; // Mutual Fund 0%
        else defaultTdsRate = 0.05; // Both Natural and Legal Persons pay 5% for dividend
      }

      // Find Header Row (first row with >=3 non-empty string column names)
      let headerRowIndex = 0;
      let headers: string[] = [];
      for (let i = 0; i < Math.min(12, json.length); i++) {
        const row = json[i] as any[];
        if (row && row.length >= 3 && row.some(c => typeof c === 'string' && c.trim().length > 0)) {
          // Check if this row looks like actual column titles (not title banner)
          const strCount = row.filter(c => typeof c === 'string' && c.trim().length > 0).length;
          if (strCount >= 3) {
            headers = row.map(h => (h !== undefined && h !== null ? h.toString().trim() : ''));
            headerRowIndex = i;
            break;
          }
        }
      }

      // Column Auto-Mapping - with priority to prevent overwrites
      const mapping: Record<string, keyof ColumnMapping> = {};
      // Priority order for fields that could have multiple matching columns
      const fieldPriority: Record<string, string[]> = {
        net_payable: ['NET_DIV.', 'NET PAYABLE', 'NET DIVIDEND', 'NET INTEREST PAYABLE', 'NET', 'ROUND UP DIV', 'ROUNDUP'],
        // Interest-amount columns MUST out-rank the generic "AMOUNT" column:
        // in reconciliation files "AMOUNT" is the debenture FACE VALUE (e.g. 50,000),
        // NOT the taxable interest, and "INTEREST-Pumori" is the accrued interest
        // the NET/TDS actually derive from. Without this, gross is read from the
        // face-value column and every row fails net=gross-tax validation.
        cash_dividend: ['INTEREST-PUMORI', 'INTEREST PUMORI', 'INTEREST AMOUNT', 'INTEREST @ 7%', 'INT. @ 7%', 'COUPON AMOUNT', 'GROSS INTEREST', 'GROSS AMOUNT', 'INT AMOUNT', 'DIVIDEND', 'DIVIDEND 5.631', 'AMOUNT/DIVIDEND', 'AMOUNT'],
        full_name: ['NAME', 'SHAREHOLDER NAME', 'APPLICANT_NAME'],
        father_name: ["FATHER'S NAME", 'FATHER_NAME', 'FATHER NAME', 'FATHER_NAME_MOTHER_NAME'],
        grandfather_name: ["GRANDFATHER'S NAME", 'GRANDFATHER_NAME', 'GRANDFATHER NAME', 'GRANDFATHER_NAME_SPOUSE_NAME'],
      };

      // First pass: map headers to fields
      const headerToField = new Map<string, { field: string; alias: string }>();
      headers.forEach(header => {
        if (!header) return;
        const upperHeader = header.toUpperCase().trim();
        
        for (const [dbField, aliases] of Object.entries(COLUMN_ALIASES)) {
          const key = dbField as keyof ColumnMapping;
          // Exact match first
          if (aliases.some(alias => upperHeader === alias)) {
            if (!headerToField.has(key)) {
              headerToField.set(key, { field: key, alias: upperHeader });
              mapping[header] = key;
            } else {
              // Already mapped - check if this new header has higher priority
              const existing = headerToField.get(key)!;
              const priorityList = fieldPriority[key];
              if (priorityList) {
                const existingIdx = priorityList.indexOf(existing.alias);
                const newIdx = priorityList.indexOf(upperHeader);
                if (newIdx >= 0 && (existingIdx < 0 || newIdx < existingIdx)) {
                  // New header has higher priority - find and remove old mapping
                  for (const [hdr, mappedField] of Object.entries(mapping)) {
                    if (mappedField === key && hdr !== header) {
                      delete mapping[hdr];
                      break;
                    }
                  }
                  headerToField.set(key, { field: key, alias: upperHeader });
                  mapping[header] = key;
                }
                // else keep existing priority - skip this mapping
              }
            }
            break;
          }
        }
      });

      // Second pass: try startsWith matching for headers not yet mapped
      const mappedHeaders = new Set(Object.keys(mapping));
      headers.forEach(header => {
        if (!header) return;
        if (mappedHeaders.has(header)) return; // already mapped in first pass
        const upperHeader = header.toUpperCase().trim();

        for (const [dbField, aliases] of Object.entries(COLUMN_ALIASES)) {
          const key = dbField as keyof ColumnMapping;
          if (headerToField.has(key)) continue; // already have a mapping for this field
          if (aliases.some(alias => upperHeader.startsWith(alias))) {
            headerToField.set(key, { field: key, alias: upperHeader });
            mapping[header] = key;
            break;
          }
        }
      });

      // Third pass: Try to extract dividend/interest rate from headers like "DIVIDEND 5.631" or "INT. @ 7%"
      let detectedDividendRate: number | undefined;
      headers.forEach(header => {
        if (!header) return;
        const upperHeader = header.toUpperCase().trim();
        if (upperHeader.includes('DIVIDEND') || upperHeader.includes('INT.') || upperHeader.includes('BONUS')) {
          const match = upperHeader.match(/[\d.]+/);
          if (match && !isNaN(Number(match[0]))) {
            detectedDividendRate = Number(match[0]);
          }
        }
      });

      // --- Make headers unique to handle duplicate column names (e.g., "REMARKS" appearing twice) ---
      const uniqueHeaders: string[] = [];
      const headerCountMap = new Map<string, number>();
      for (const h of headers) {
        if (!h) {
          uniqueHeaders.push('');
          continue;
        }
        const count = (headerCountMap.get(h) || 0) + 1;
        headerCountMap.set(h, count);
        uniqueHeaders.push(count > 1 ? `${h} (${count})` : h);
      }

      // Rebuild mapping with unique header names; also try to map duplicate headers to unmapped fields
      const uniqueMapping: Record<string, keyof ColumnMapping> = {};
      const mappedFieldsSeen = new Set<keyof ColumnMapping>();
      for (let idx = 0; idx < headers.length; idx++) {
        const origHeader = headers[idx];
        const uniqueHeader = uniqueHeaders[idx];
        if (mapping[origHeader] && !mappedFieldsSeen.has(mapping[origHeader])) {
          uniqueMapping[uniqueHeader] = mapping[origHeader];
          mappedFieldsSeen.add(mapping[origHeader]);
        }
      }
      // Try to map duplicate headers to other unmapped fields (e.g., second "REMARKS" → status)
      for (let idx = 0; idx < headers.length; idx++) {
        const origHeader = headers[idx];
        const uniqueHeader = uniqueHeaders[idx];
        if (uniqueMapping[uniqueHeader]) continue;
        if (!origHeader) continue;
        const upperHeader = origHeader.toUpperCase().trim();
        for (const [dbField, aliases] of Object.entries(COLUMN_ALIASES)) {
          const key = dbField as keyof ColumnMapping;
          if (mappedFieldsSeen.has(key)) continue;
          if (aliases.some(alias => upperHeader === alias || upperHeader.startsWith(alias))) {
            uniqueMapping[uniqueHeader] = key;
            mappedFieldsSeen.add(key);
            break;
          }
        }
      }

      // Replace headers and mapping with unique versions
      headers = uniqueHeaders;
      Object.keys(mapping).forEach(k => delete mapping[k]);
      Object.assign(mapping, uniqueMapping);

      // Report-only / reference sheets (e.g. bank totals, VAT, cover tabs) have
      // no BOID column and therefore no investor data. Skip them so they are
      // never shown for validation or sent to the import pipeline.
      if (!Object.values(mapping).some((f) => f === 'boid')) continue;

      // --- Build rows from array data (handles duplicate headers correctly) ---
      // Also add normalized field names so the import service can access data consistently
      // e.g., row.boid = row["BOID"], row.full_name = row["NAME"], row.cash_dividend = row["DIVIDEND 5.631"]
      const rawRows: Record<string, any>[] = [];
      for (let i = headerRowIndex + 1; i < json.length; i++) {
        const rowArr = json[i] as any[];
        if (!rowArr || rowArr.every(c => c === undefined || c === null || c === '')) continue;

        const row: Record<string, any> = {};
        for (let j = 0; j < headers.length; j++) {
          const header = headers[j];
          if (!header) continue;
          let val = rowArr[j];
          // Handle formula cells that XLSX returns as objects like { f: 'A1+B1', v: 123 }
          if (val !== null && val !== undefined && typeof val === 'object') {
            if ('v' in val && val.v !== undefined) {
              val = val.v;
            } else if ('f' in val) {
              val = 0;
            } else {
              val = String(val);
            }
          }
          row[header] = val;
        }

        // Add normalized field names based on mapping (e.g., row.boid = row["BOID"])
        for (const [colName, mappedField] of Object.entries(mapping)) {
          if (row[colName] !== undefined && row[mappedField] === undefined) {
            row[mappedField] = row[colName];
          }
        }

        rawRows.push(row);
      }

      let sheetKitta = 0;
      let sheetAmount = 0;
      let sheetTax = 0;
      let sheetNet = 0;
      let validRowCount = 0;

      const processedRows = rawRows.filter(r => {
        // Filter out summary/total rows at the bottom.
        // Check ALL string values in the row (not just the first), since RMF files
        // often place "TOTAL" in the NAME column rather than the first column.
        const allValues = Object.values(r).filter(v => v !== null && v !== undefined);
        const hasTotalMarker = allValues.some(v => {
          const s = String(v).trim().toUpperCase();
          return s === 'TOTAL' || s === 'SUMMARY' || s.startsWith('TOTAL ') || s.startsWith('SUMMARY ');
        });
        if (hasTotalMarker) return false;

        validRowCount++;
        
        // Sum aggregates
        for (const [colName, mappedField] of Object.entries(mapping)) {
          const val = Number(r[colName]);
          if (!isNaN(val)) {
            if (mappedField === 'shares_held') sheetKitta += val;
            if (mappedField === 'cash_dividend') sheetAmount += val;
            if (mappedField === 'div_tax' || mappedField === 'bon_tax') sheetTax += val;
            if (mappedField === 'net_payable') sheetNet += val;
          }
        }

        return true;
      });

      // Determine if file is raw input or pre-calculated
      const hasFinancialColumns = Object.values(mapping).some(m => m === 'cash_dividend' || m === 'div_tax' || m === 'bon_tax' || m === 'net_payable');
      const hasKitta = Object.values(mapping).some(m => m === 'shares_held');
      
      let isPreCalculated = false;
      if (hasFinancialColumns && processedRows.length > 0) {
        let rowsWithFinancials = 0;
        for (const r of processedRows) {
          const gross = Number(r[mapping['cash_dividend' as keyof ColumnMapping] || '']);
          const tax = Number(r[mapping['div_tax' as keyof ColumnMapping] || '']) || Number(r[mapping['bon_tax' as keyof ColumnMapping] || '']);
          const net = Number(r[mapping['net_payable' as keyof ColumnMapping] || '']);
          if (!isNaN(gross) && !isNaN(tax) && !isNaN(net) && (gross > 0 || net > 0)) {
            rowsWithFinancials++;
          }
        }
        isPreCalculated = rowsWithFinancials / processedRows.length > 0.8; // >80% rows have financial data
      }
      
      const isRawInputFile = !hasFinancialColumns && hasKitta;

      let detectedIsin: string | undefined;
      for (const r of processedRows.slice(0, 50)) {
        const val = String(r.isin || r['ISIN NO.'] || r['ISIN NO'] || r['ISIN'] || '').trim();
        if (val && val.length >= 6 && val.toUpperCase() !== 'ISIN' && val.toUpperCase() !== 'ISIN NO.') {
          detectedIsin = val;
          break;
        }
      }

      sheets.push({
        sheetName,
        sheetType,
        defaultTdsRate,
        detectedDividendRate,
        headers,
        mapping,
        rows: processedRows,
        rowCount: validRowCount,
        totalKitta: Math.round(sheetKitta),
        totalAmount: Math.round(sheetAmount * 100) / 100,
        totalTax: Math.round(sheetTax * 100) / 100,
        totalNet: Math.round(sheetNet * 100) / 100,
        isPreCalculated,
        isRawInputFile,
        detectedIsin,
      });

      // SUMMARY / report-only sheets are skipped above, so always accumulate.
      grandTotals.totalRows += validRowCount;
      grandTotals.totalKitta += Math.round(sheetKitta);
      grandTotals.totalAmount += Math.round(sheetAmount * 100) / 100;
      grandTotals.totalTax += Math.round(sheetTax * 100) / 100;
      grandTotals.totalNet += Math.round(sheetNet * 100) / 100;
    }

    // --- Company Name Detection ---
    // Strategy: Look at title rows (before header row) in the first data sheet for company name
    let detectedCompanyName: string | undefined;
    
    // 1. Try to extract from title rows before header in first non-summary sheet
    for (const wsName of workbook.SheetNames) {
      const ws = workbook.Sheets[wsName];
      const json2 = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
      if (!json2 || json2.length === 0) continue;
      
      const sheetNameUpper = wsName.toUpperCase();
      if (sheetNameUpper.includes('SUMMARY')) continue; // Skip summary sheets for title row search
      
      // Check first 3 rows for single-cell title text that looks like a company name
      for (let i = 0; i < Math.min(3, json2.length); i++) {
        const row = json2[i] as any[];
        if (!row || row.length === 0) continue;
        
        // Filter non-null, non-empty cells with string values
        const cells = row.filter(c => c !== null && c !== undefined && String(c).trim().length > 0);
        
        // A company name title row typically has 1-3 cells, with the first being the company name
        if (cells.length >= 1 && cells.length <= 3) {
          const firstCell = String(cells[0]).trim();
          // Check if it looks like a company name (contains LTD, Ltd, Company, Bank, etc. or is relatively long)
          const companyKeywords = ['ltd', 'limited', 'bank', 'company', 'hydropower', 'finance', 'insurance', 'microfinance', 'debenture', 'fund'];
          const hasKeyword = companyKeywords.some(k => firstCell.toLowerCase().includes(k));
          // Also check if it's a long title text (not a column header like "S.N" or "BOID")
          const isLongText = firstCell.length > 15;
          const isNotHeader = !['S.N', 'S.NO', 'SN', 'BOID', 'TYPE', 'PARTICULAR'].includes(firstCell.toUpperCase().trim());
          
          if ((hasKeyword || isLongText) && isNotHeader) {
            detectedCompanyName = firstCell;
            break;
          }
        }
      }
      if (detectedCompanyName) break;
    }
    
    // 2. Fallback: Try to extract from file name
    if (!detectedCompanyName) {
      // Common patterns: "COMPANY NAME - TYPE" or "TYPE - COMPANY NAME" or "COMPANY TYPE"
      const fileNameNoExt = file.name.replace(/\.[^/.]+$/, ''); // remove extension
      
      // Remove common suffixes/prefixes that are not company names
      const cleanName = fileNameNoExt
        .replace(/RECONCILATION|RECONCILIATION|RECON|BOOK CLOSE|DIVIDEND|BONUS|AGM|FY \d+|FY-\d+|\d{4}-\d{2}/gi, '')
        .replace(/[-_().]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (cleanName.length > 3) {
        detectedCompanyName = cleanName;
      }
    }
    
    const overallIsin = sheets.find(s => s.detectedIsin)?.detectedIsin;

    return {
      fileType,
      fileName: file.name,
      sheets,
      detectedCompanyName,
      detectedIsin: overallIsin,
      detectedRate,
      grandTotals,
    };
  }
};
