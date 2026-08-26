import * as XLSX from 'xlsx';

const parseCsvRow = (row: string): string[] => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i += 1) {
    const char = row[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
};

const normalizeAmount = (value: string | number | undefined | null): number => {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return value;
  const sanitized = value.replace(/[,\s]/g, '').replace(/\(\s*(\d+)\s*\)/, '-$1');
  // Handle "NPRs 25679.85" format
  const nprMatch = sanitized.match(/NPRs?\s*([\d.]+)/i);
  const num = Number(nprMatch ? nprMatch[1] : sanitized);
  return Number.isNaN(num) ? 0 : num;
};

const cleanPattern = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

const findColumnIndexByPriority = (header: string[], patternGroups: string[][]): number => {
  for (const group of patternGroups) {
    const idx = header.findIndex((col) => {
      const cleanCol = cleanPattern(col);
      return group.some((pattern) => {
        const cleanPat = cleanPattern(pattern);
        return cleanCol === cleanPat || cleanCol.includes(cleanPat) || col.toLowerCase().includes(pattern.toLowerCase());
      });
    });
    if (idx >= 0) return idx;
  }
  return -1;
};

const findColumnIndex = (header: string[], patterns: string[]): number => {
  return findColumnIndexByPriority(header, [patterns]);
};

export interface BankTransaction {
  id: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  bankName?: string;
  accountNo?: string;
  beneficiaryName?: string;
  status?: string; // e.g. 'ACSC', 'RJCT', 'Success', 'Rejected'
  referenceId?: string;
  batchId?: string;
  instructionId?: string;
  category?: 'PAYOUT_DEBIT' | 'REJECT_RETURN' | 'FUNDING_DEPOSIT' | 'BANK_CHARGES' | 'NRB_CIRCULAR' | 'OTHER';
  isLiquiditySweep?: boolean;
  accountHolder?: string;
}

export const BankParser = {
  /**
   * Parse a bank statement or ACH payment settlement report.
   * Supports:
   *  - CSV/TXT bank statements (date, description, debit, credit, balance)
   *  - Excel (.xls/.xlsx) ACH settlement reports & ConnectIPS files
   *  - RBB and commercial bank Electronic Account Statements (with header metadata, circular sweep filtering)
   */
  async parseBankStatement(file: File, options: { includeCircularSweeps?: boolean } = {}): Promise<BankTransaction[]> {
    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith('.xls') || fileName.endsWith('.xlsx') || fileName.endsWith('.xlsm');

    if (isExcel) {
      return this.parseExcelSettlement(file, options);
    }

    // CSV/TXT parsing
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) return [];

    const headerRow = parseCsvRow(lines[0]);
    const indices = {
      date: findColumnIndexByPriority(headerRow, [
        ['settlementdt', 'settlement date', 'created on', 'transaction date', 'date']
      ]),
      description: findColumnIndexByPriority(headerRow, [
        ['remarks', 'particulars', 'instructionid', 'instruction id', 'description', 'narration', 'endtoendid']
      ]),
      debit: findColumnIndexByPriority(headerRow, [['debit', 'withdrawal', 'withdraw', 'payment']]),
      credit: findColumnIndexByPriority(headerRow, [
        ['transaction amount', 'transactionamount', 'amt'],
        ['credit', 'deposit', 'amount', 'net amount']
      ]),
      balance: findColumnIndexByPriority(headerRow, [['balance']]),
      bankName: findColumnIndexByPriority(headerRow, [
        ['creditor bank', 'creditorbank', 'creditor agent', 'creditoragent', 'instgbranch'],
        ['bank', 'bank name']
      ]),
      accountNo: findColumnIndexByPriority(headerRow, [
        ['creditor account', 'creditoraccount', 'beneficiary account'],
        ['account no', 'account number', 'a/c', 'account'],
        ['debtor account', 'debtoraccount']
      ]),
      beneficiaryName: findColumnIndexByPriority(headerRow, [
        ['creditor name', 'creditorname', 'beneficiary name', 'payee name'],
        ['name', 'shareholder name', 'beneficiary'],
        ['debtor name', 'debtorname']
      ]),
      status: findColumnIndexByPriority(headerRow, [
        ['credit status', 'creditstatus', 'achstatus.description', 'achstatus', 'status', 'tx status']
      ]),
      instructionId: findColumnIndexByPriority(headerRow, [
        ['instruction id', 'instructionid', 'transaction id', 'transid', 'reference id', 'referenceid']
      ]),
    };

    const transactions: BankTransaction[] = [];
    for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
      const line = lines[rowIndex];
      const columns = parseCsvRow(line);
      if (!columns.length) continue;

      const debit = indices.debit >= 0 ? normalizeAmount(columns[indices.debit]) : 0;
      const credit = indices.credit >= 0 ? normalizeAmount(columns[indices.credit]) : 0;
      const balance = indices.balance >= 0 ? normalizeAmount(columns[indices.balance]) : 0;
      const status = indices.status >= 0 ? String(columns[indices.status] || '').trim() : undefined;
      const beneficiaryName = indices.beneficiaryName >= 0 ? String(columns[indices.beneficiaryName] || '').trim() : undefined;
      const instructionId = indices.instructionId >= 0 ? String(columns[indices.instructionId] || '').trim() : undefined;
      const desc = indices.description >= 0 ? columns[indices.description] : (beneficiaryName || columns.slice(1, 4).join(' '));

      const isCircular = desc.toUpperCase().includes('NRB CIRCULAR');
      if (isCircular && !options.includeCircularSweeps) {
        continue;
      }

      transactions.push({
        id: `txn-${rowIndex}`,
        date: indices.date >= 0 ? columns[indices.date] : '',
        description: desc,
        debit,
        credit,
        balance,
        bankName: indices.bankName >= 0 ? columns[indices.bankName] : undefined,
        accountNo: indices.accountNo >= 0 ? columns[indices.accountNo] : undefined,
        beneficiaryName,
        status,
        instructionId,
        isLiquiditySweep: isCircular,
        category: isCircular ? 'NRB_CIRCULAR' : (desc.toUpperCase().includes('REJECT') ? 'REJECT_RETURN' : 'PAYOUT_DEBIT'),
      });
    }

    return transactions;
  },

  /**
   * Parse Excel ACH settlement reports, ConnectIPS status files, and Electronic Bank Statements.
   */
  parseExcelSettlement(file: File, options: { includeCircularSweeps?: boolean } = {}): Promise<BankTransaction[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const transactions: BankTransaction[] = [];

          // Choose the primary sheet
          let sheetsToProcess = workbook.SheetNames;
          const nchlSheet = workbook.SheetNames.find(s => s.toLowerCase().includes('nchl') || s.toLowerCase().includes('bankcentral') || s.toLowerCase().includes('thapathali'));
          if (nchlSheet) {
            sheetsToProcess = [nchlSheet];
          } else if (workbook.SheetNames.includes('Statement') && workbook.SheetNames.length > 1) {
            sheetsToProcess = ['Statement'];
          } else if (workbook.SheetNames.includes('Sheet1') && workbook.SheetNames.length > 1) {
            sheetsToProcess = ['Sheet1'];
          }

          for (const sheetName of sheetsToProcess) {
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
            if (!rows.length) continue;

            // 1. Scan metadata in the first 20 rows (Account Holder, Account Number)
            let detectedAccountHolder = '';
            let detectedAccountNo = '';
            let headerRowIndex = 0;

            for (let i = 0; i < Math.min(25, rows.length); i++) {
              const r = rows[i];
              if (!Array.isArray(r)) continue;
              const lineText = r.map(c => String(c).trim()).join(' ');

              if (lineText.includes("Account Holder's Name:") || lineText.includes("Account Name:")) {
                const m = lineText.match(/Account\s*(?:Holder's\s*)?Name:\s*([^:]+?)(?:\s+From:|\s+To:|$)/i);
                if (m && m[1]) detectedAccountHolder = m[1].trim();
              }
              if (lineText.includes("Account Number:") || lineText.includes("Account No:")) {
                const m = lineText.match(/Account\s*(?:Number|No):\s*([0-9A-Za-z]+)/i);
                if (m && m[1]) detectedAccountNo = m[1].trim();
              }

              // Check if this row is the actual table header row
              const cleanCells = r.map(c => cleanPattern(String(c)));
              const hasDateCol = cleanCells.some(c => c.includes('date') || c.includes('txndate') || c.includes('settlement'));
              const hasAmountOrDesc = cleanCells.some(c => c.includes('desc') || c.includes('particular') || c.includes('withdraw') || c.includes('debit') || c.includes('amount') || c.includes('deposit'));

              if (hasDateCol && hasAmountOrDesc) {
                headerRowIndex = i;
                break;
              }
            }

            const headerRow = rows[headerRowIndex].map((h: any) => String(h).trim().toLowerCase());
            const indices = {
              amount: findColumnIndexByPriority(headerRow, [
                ['transaction amount', 'transactionamount', 'amt'],
                ['amount', 'net amount']
              ]),
              date: findColumnIndexByPriority(headerRow, [
                ['created on', 'settlementdt', 'settlement date', 'transaction date', 'txndate', 'date', 'creationdate']
              ]),
              description: findColumnIndexByPriority(headerRow, [
                ['remarks', 'particulars', 'instructionid', 'instruction id', 'description', 'narration', 'endtoendid']
              ]),
              debit: findColumnIndexByPriority(headerRow, [['withdraw', 'withdrawal', 'debit', 'payment']]),
              credit: findColumnIndexByPriority(headerRow, [
                ['transaction amount', 'transactionamount', 'amt'],
                ['deposit', 'credit', 'amount', 'net amount']
              ]),
              balance: findColumnIndexByPriority(headerRow, [['balance']]),
              bankName: findColumnIndexByPriority(headerRow, [
                ['creditor bank', 'creditorbank', 'creditor agent', 'creditoragent', 'instgbranch'],
                ['bank', 'bank name']
              ]),
              accountNo: findColumnIndexByPriority(headerRow, [
                ['creditor account', 'creditoraccount', 'beneficiary account'],
                ['account no', 'account number', 'a/c', 'account'],
                ['debtor account', 'debtoraccount']
              ]),
              creditorName: findColumnIndexByPriority(headerRow, [
                ['creditor name', 'creditorname', 'beneficiary name', 'payee name'],
                ['name', 'shareholder name', 'beneficiary'],
                ['debtor name', 'debtorname']
              ]),
              status: findColumnIndexByPriority(headerRow, [
                ['credit status', 'creditstatus', 'achstatus.description', 'achstatus', 'status', 'tx status']
              ]),
              instructionId: findColumnIndexByPriority(headerRow, [
                ['instruction id', 'instructionid', 'transaction id', 'transid', 'reference id', 'referenceid', 'endtoendid']
              ]),
              batchId: findColumnIndexByPriority(headerRow, [['batch id', 'batchid', 'batch.sessionid']]),
            };

            for (let i = headerRowIndex + 1; i < rows.length; i++) {
              const row = rows[i];
              if (!row || (Array.isArray(row) && row.every((c) => c === '' || c === null || c === undefined))) continue;

              const rowValues = Array.isArray(row) ? row : Object.values(row);
              const rowText = rowValues.map(String).join(' ').toUpperCase();
              if (rowText.includes('TOTAL') || rowText.includes('SUMMARY') || rowText.includes('OPENING BALANCE') || rowText.includes('CLOSING BALANCE')) {
                continue;
              }

              const rawDesc = indices.description >= 0 && row[indices.description] ? String(row[indices.description] || '').trim() : '';
              const withdrawVal = indices.debit >= 0 ? normalizeAmount(row[indices.debit]) : 0;
              const depositVal = indices.credit >= 0 ? normalizeAmount(row[indices.credit]) : (indices.amount >= 0 ? normalizeAmount(row[indices.amount]) : 0);
              const balanceVal = indices.balance >= 0 ? normalizeAmount(row[indices.balance]) : 0;

              if (withdrawVal === 0 && depositVal === 0 && !row[indices.accountNo] && !row[indices.creditorName]) {
                continue;
              }

              // Intelligent Classification
              const upperDesc = rawDesc.toUpperCase();
              const isCircular = upperDesc.includes('NRB CIRCULAR');
              
              // If options specify to exclude circular sweeps, skip them
              if (isCircular && !options.includeCircularSweeps) {
                continue;
              }

              let category: BankTransaction['category'] = 'OTHER';
              let autoStatus: string | undefined = undefined;

              if (isCircular) {
                category = 'NRB_CIRCULAR';
              } else if (upperDesc.includes('INCORRECT A/C') || upperDesc.includes('REJECT') || upperDesc.includes('RETURN') || upperDesc.includes('BOUNCE') || upperDesc.includes('RJCT')) {
                category = 'REJECT_RETURN';
                autoStatus = 'RJCT';
              } else if (upperDesc.includes('INTEREST') || upperDesc.includes('DEBENTURE') || upperDesc.includes('DIVIDEND') || upperDesc.includes('MUTUAL FUND') || upperDesc.includes('IPS DR') || upperDesc.includes('CHQ') || upperDesc.includes('REINSURANCE') || upperDesc.includes('KOSH') || upperDesc.includes('FUND')) {
                category = 'PAYOUT_DEBIT';
                autoStatus = 'ACSC';
              } else if (upperDesc.includes('CHG') || upperDesc.includes('COMMISSION') || upperDesc.includes('FEE')) {
                category = 'BANK_CHARGES';
              } else if (depositVal > 0 && withdrawVal === 0) {
                category = 'FUNDING_DEPOSIT';
              } else if (withdrawVal > 0) {
                category = 'PAYOUT_DEBIT';
              }

              // Extract account number from description if not in dedicated column
              let extractedAccountNo = indices.accountNo >= 0 ? String(row[indices.accountNo] || '').trim() : '';
              if (!extractedAccountNo) {
                const accMatch = rawDesc.match(/(?:A\/C|AC|ACC|ACCOUNT|:)\s*([0-9]{10,20})/i) || rawDesc.match(/\b([0-9]{16})\b/);
                if (accMatch && accMatch[1]) {
                  extractedAccountNo = accMatch[1];
                }
              }

              // Extract beneficiary / institutional name from description
              let extractedName = indices.creditorName >= 0 ? String(row[indices.creditorName] || '').trim() : '';
              if (!extractedName) {
                if (upperDesc.includes('NEPAL REINSURANCE')) extractedName = 'NEPAL REINSURANCE COMPANY LTD';
                else if (upperDesc.includes('CONTRIBUTION FUND')) extractedName = 'CITIZEN INVESTMENT TRUST (CONTRIBUTION FUND)';
                else if (upperDesc.includes('SAINIK KALYANKARI')) extractedName = 'SAINIK KALYANKARI KOSH';
                else if (upperDesc.includes('LAXMI SUNRISE CAPITAL')) extractedName = 'LAXMI SUNRISE CAPITAL LTD';
              }

              const status = (indices.status >= 0 && row[indices.status]) ? String(row[indices.status]).trim() : autoStatus;
              const instructionId = indices.instructionId >= 0 ? String(row[indices.instructionId] || '').trim() : undefined;
              const batchId = indices.batchId >= 0 ? String(row[indices.batchId] || '').trim() : undefined;
              const description = rawDesc || extractedName || (withdrawVal > 0 ? `Debit Payment ${withdrawVal}` : `Credit Settlement ${depositVal}`);

              transactions.push({
                id: `txn-${sheetName}-${i}`,
                date: indices.date >= 0 ? String(row[indices.date] || '').trim() : '',
                description,
                debit: withdrawVal,
                credit: depositVal,
                balance: balanceVal,
                bankName: indices.bankName >= 0 ? String(row[indices.bankName] || '').trim() : undefined,
                accountNo: extractedAccountNo || undefined,
                beneficiaryName: extractedName || undefined,
                status,
                instructionId,
                batchId,
                category,
                isLiquiditySweep: isCircular,
                accountHolder: detectedAccountHolder || undefined,
              });
            }
          }

          resolve(transactions);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  },
};