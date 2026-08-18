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

const findColumnIndex = (header: string[], patterns: string[]): number => {
  return header.findIndex((col) => patterns.some((pattern) => col.toLowerCase().includes(pattern)));
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
}

export const BankParser = {
  /**
   * Parse a bank statement or ACH payment settlement report.
   * Supports:
   *  - CSV/TXT bank statements (date, description, debit, credit, balance)
   *  - Excel (.xls/.xlsx) ACH settlement reports with columns:
   *    statusId, achStatus.description, transId, endtoEndID, instructionID, amount,
   *    batch.settlementDt, batch.currency, instgBranch, instgAgent, ...
   *  - Excel batch payout files with columns:
   *    InstructionID, endtoEndId, amount, Purpose, creditorAgent, creditorBranch,
   *    creditorName, creditorAccount, ...
   */
  async parseBankStatement(file: File): Promise<BankTransaction[]> {
    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith('.xls') || fileName.endsWith('.xlsx') || fileName.endsWith('.xlsm');

    if (isExcel) {
      return this.parseExcelSettlement(file);
    }

    // CSV/TXT parsing
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) return [];

    const headerRow = parseCsvRow(lines[0]);
    const headerPatterns = {
      date: ['date', 'transaction date', 'settlementdt', 'settlement date'],
      description: ['description', 'narration', 'particulars', 'transaction details', 'instructionid', 'endtoendid'],
      debit: ['debit', 'withdrawal', 'payment'],
      credit: ['credit', 'deposit', 'amount'],
      balance: ['balance'],
      bankName: ['bank', 'bank name', 'instgbranch'],
      accountNo: ['account', 'account no', 'a/c', 'account number', 'creditoraccount'],
    };

    const indices = {
      date: findColumnIndex(headerRow, headerPatterns.date),
      description: findColumnIndex(headerRow, headerPatterns.description),
      debit: findColumnIndex(headerRow, headerPatterns.debit),
      credit: findColumnIndex(headerRow, headerPatterns.credit),
      balance: findColumnIndex(headerRow, headerPatterns.balance),
      bankName: findColumnIndex(headerRow, headerPatterns.bankName),
      accountNo: findColumnIndex(headerRow, headerPatterns.accountNo),
    };

    const transactions: BankTransaction[] = [];
    for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
      const line = lines[rowIndex];
      const columns = parseCsvRow(line);
      if (!columns.length) continue;

      const debit = indices.debit >= 0 ? normalizeAmount(columns[indices.debit]) : 0;
      const credit = indices.credit >= 0 ? normalizeAmount(columns[indices.credit]) : 0;
      const balance = indices.balance >= 0 ? normalizeAmount(columns[indices.balance]) : 0;

      transactions.push({
        id: `txn-${rowIndex}`,
        date: indices.date >= 0 ? columns[indices.date] : '',
        description: indices.description >= 0 ? columns[indices.description] : columns.slice(1, 4).join(' '),
        debit,
        credit,
        balance,
        bankName: indices.bankName >= 0 ? columns[indices.bankName] : undefined,
        accountNo: indices.accountNo >= 0 ? columns[indices.accountNo] : undefined,
      });
    }

    return transactions;
  },

  /**
   * Parse Excel ACH settlement reports and batch payout files.
   */
  parseExcelSettlement(file: File): Promise<BankTransaction[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const transactions: BankTransaction[] = [];

          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
            if (!rows.length) continue;

            const headerRow = rows[0].map((h: any) => String(h).trim().toLowerCase());
            const indices = {
              amount: findColumnIndex(headerRow, ['amount']),
              date: findColumnIndex(headerRow, ['settlementdt', 'settlement date', 'date']),
              description: findColumnIndex(headerRow, ['instructionid', 'description', 'endtoendid']),
              debit: findColumnIndex(headerRow, ['debit', 'withdrawal', 'payment']),
              credit: findColumnIndex(headerRow, ['credit', 'deposit', 'amount']),
              balance: findColumnIndex(headerRow, ['balance']),
              bankName: findColumnIndex(headerRow, ['instgbranch', 'bank', 'bank name']),
              accountNo: findColumnIndex(headerRow, ['creditoraccount', 'account no', 'a/c', 'account number']),
              creditorName: findColumnIndex(headerRow, ['creditorname', 'creditor name']),
            };

            // Detect report type
            const isBatchPayout = headerRow.some(h => h.includes('creditorname') || h.includes('creditoraccount'));
            const isSettlement = headerRow.some(h => h.includes('achstatus') || h.includes('transid') || h.includes('instructionid'));

            for (let i = 1; i < rows.length; i++) {
              const row = rows[i];
              if (!row || (Array.isArray(row) && row.every((c) => c === '' || c === null || c === undefined))) continue;

              // Skip TOTAL rows
              const rowValues = Array.isArray(row) ? row : Object.values(row);
              const rowText = rowValues.map(String).join(' ').toUpperCase();
              if (rowText.includes('TOTAL') || rowText.includes('SUMMARY')) continue;

              const amount = indices.amount >= 0 ? normalizeAmount(row[indices.amount]) : 0;

              // For settlement reports, amount is credit (incoming payment to beneficiary)
              // For batch payout files, amount is credit too
              let bankName = indices.bankName >= 0 ? String(row[indices.bankName] || '') : '';
              let accountNo = indices.accountNo >= 0 ? String(row[indices.accountNo] || '') : '';

              // For batch payout files, use creditorBranch as bank name
              if (isBatchPayout && !bankName) {
                const creditorBranchIdx = findColumnIndex(headerRow, ['creditorbranch']);
                bankName = creditorBranchIdx >= 0 ? String(row[creditorBranchIdx] || '') : '';
              }
              // For batch payout files, creditorName is the description
              let description = indices.description >= 0 ? String(row[indices.description] || '') : '';
              if (isBatchPayout && indices.creditorName >= 0 && !description) {
                description = String(row[indices.creditorName] || '');
              }

              transactions.push({
                id: `txn-${sheetName}-${i}`,
                date: indices.date >= 0 ? String(row[indices.date] || '') : '',
                description,
                debit: indices.debit >= 0 ? normalizeAmount(row[indices.debit]) : 0,
                credit: amount,
                balance: indices.balance >= 0 ? normalizeAmount(row[indices.balance]) : 0,
                bankName: bankName || undefined,
                accountNo: accountNo || undefined,
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