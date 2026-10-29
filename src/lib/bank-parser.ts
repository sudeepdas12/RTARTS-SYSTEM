import * as XLSX from "xlsx";

const parseCsvRow = (row: string): string[] => {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < row.length; i += 1) {
    const char = row[i];
    if (char === '"') {
      if (inQuotes && i + 1 < row.length && row[i + 1] === '"') {
        current += '"';
        i += 1; // skip second quote in escaped pair ""
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
};

const normalizeAmount = (value: string | number | undefined | null): number => {
  if (value === undefined || value === null) return 0;
  if (typeof value === "number") return value;
  let str = String(value).trim();
  // Detect DR/CR suffix before stripping so we can negate debits
  const isDr = /DR$/i.test(str);
  str = str
    .replace(/[,\s]/g, "")
    .replace(/\(\s*([\d.]+)\s*\)/, "-$1")
    .replace(/(?:CR|DR)$/i, "");
  // Handle "NPRs 25679.85" format
  const nprMatch = str.match(/NPRs?\s*([\d.]+)/i);
  const num = Number(nprMatch ? nprMatch[1] : str);
  if (Number.isNaN(num)) return 0;
  // DR = debit = money out = negative; CR = credit = money in = positive
  return isDr ? -Math.abs(num) : num;
};

const formatDateParts = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const normalizeDate = (raw: string | number | undefined | null | Date): string => {
  if (!raw) return "";
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return "";
    return formatDateParts(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  }
  if (typeof raw === "number") {
    // Handle 5-digit Excel serial dates (approx 1954 to 2077)
    if (raw >= 20000 && raw <= 70000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const date = new Date(excelEpoch.getTime() + raw * 86400000);
      return formatDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }
  }
  const str = String(raw).trim();
  if (/^\d{5}$/.test(str)) {
    const serial = Number(str);
    if (serial >= 20000 && serial <= 70000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const date = new Date(excelEpoch.getTime() + serial * 86400000);
      return formatDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }
  }
  // Handle named months e.g. "15-Aug-2024", "15-AUG-24", "15 Aug 2024"
  const MONTH_MAP: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };
  const monMatch = str.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{2,4})$/);
  if (monMatch) {
    const d = monMatch[1].padStart(2, "0");
    const mStr = monMatch[2].slice(0, 3).toLowerCase();
    const m = MONTH_MAP[mStr];
    let y = monMatch[3];
    if (y.length === 2) y = `20${y}`;
    if (m) return `${y}-${m}-${d}`;
  }

  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(str)) {
    const parts = str.split(/[-/]/);
    return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
  }
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(str)) {
    const parts = str.split(/[-/]/);
    const n1 = parseInt(parts[0], 10);
    const n2 = parseInt(parts[1], 10);
    const y = parts[2];
    if (n1 > 12 && n2 <= 12) {
      // Unambiguously DD/MM/YYYY
      return `${y}-${String(n2).padStart(2, "0")}-${String(n1).padStart(2, "0")}`;
    } else if (n2 > 12 && n1 <= 12) {
      // Unambiguously MM/DD/YYYY
      return `${y}-${String(n1).padStart(2, "0")}-${String(n2).padStart(2, "0")}`;
    } else {
      // Default to DD/MM/YYYY (standard in Nepal banking / NCHL / ConnectIPS)
      return `${y}-${String(n2).padStart(2, "0")}-${String(n1).padStart(2, "0")}`;
    }
  }
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return formatDateParts(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }
  return str;
};

const cleanPattern = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, "");

const findColumnIndexByPriority = (header: string[], patternGroups: string[][]): number => {
  for (const group of patternGroups) {
    const idx = header.findIndex((col) => {
      const cleanCol = cleanPattern(col);
      const lowerCol = col.toLowerCase().trim();
      return group.some((pattern) => {
        const cleanPat = cleanPattern(pattern);
        const lowerPat = pattern.toLowerCase().trim();
        if (cleanCol === cleanPat || lowerCol === lowerPat) return true;
        // Avoid short substrings (<= 3 chars, e.g. "ac", "a/c", "amt") matching inside words like "transactiondate"
        if (cleanPat.length <= 3) {
          const regex = new RegExp(`\\b${cleanPat}\\b|\\ba/c\\b`, "i");
          return regex.test(col);
        }
        return cleanCol.includes(cleanPat) || lowerCol.includes(lowerPat);
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
  fileName?: string;
  category?:
    | "PAYOUT_DEBIT"
    | "REJECT_RETURN"
    | "FUNDING_DEPOSIT"
    | "BANK_CHARGES"
    | "NRB_CIRCULAR"
    | "OTHER";
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
  async parseBankStatement(
    file: File,
    options: { includeCircularSweeps?: boolean } = {},
  ): Promise<BankTransaction[]> {
    const fileName = file.name.toLowerCase();
    const isExcel =
      fileName.endsWith(".xls") || fileName.endsWith(".xlsx") || fileName.endsWith(".xlsm");

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
        ["settlementdt", "settlement date", "created on", "transaction date", "date"],
      ]),
      description: findColumnIndexByPriority(headerRow, [
        [
          "remarks",
          "particulars",
          "instructionid",
          "instruction id",
          "description",
          "narration",
          "endtoendid",
        ],
      ]),
      debit: findColumnIndexByPriority(headerRow, [["debit", "withdrawal", "withdraw", "payment"]]),
      credit: findColumnIndexByPriority(headerRow, [
        ["transaction amount", "transactionamount", "amt"],
        ["credit", "deposit", "amount", "net amount"],
      ]),
      balance: findColumnIndexByPriority(headerRow, [["balance"]]),
      bankName: findColumnIndexByPriority(headerRow, [
        ["creditor bank", "creditorbank", "creditor agent", "creditoragent", "instgbranch"],
        ["bank", "bank name"],
      ]),
      accountNo: findColumnIndexByPriority(headerRow, [
        ["creditor account", "creditoraccount", "beneficiary account"],
        ["account no", "account number", "a/c", "account"],
        ["debtor account", "debtoraccount"],
      ]),
      beneficiaryName: findColumnIndexByPriority(headerRow, [
        ["creditor name", "creditorname", "beneficiary name", "payee name"],
        ["name", "shareholder name", "beneficiary"],
        ["debtor name", "debtorname"],
      ]),
      status: findColumnIndexByPriority(headerRow, [
        [
          "credit status",
          "creditstatus",
          "achstatus.description",
          "achstatus",
          "status",
          "tx status",
        ],
      ]),
      transId: findColumnIndexByPriority(headerRow, [
        ["transid", "transaction id", "transactionid"],
      ]),
      instructionId: findColumnIndexByPriority(headerRow, [
        ["instruction id", "instructionid"],
        ["reference id", "referenceid", "endtoendid"],
        ["transaction id", "transid"],
      ]),
      batchId: findColumnIndexByPriority(headerRow, [
        ["batch id", "batchid", "batch.sessionid", "batch"],
      ]),
      referenceId: findColumnIndexByPriority(headerRow, [
        ["reference id", "referenceid", "ref no", "ref id"],
      ]),
      reason: findColumnIndexByPriority(headerRow, [
        [
          "return reason",
          "returnreason",
          "rejection reason",
          "rejectionreason",
          "reason",
          "error message",
          "errormessage",
          "reject remarks",
          "status remarks",
        ],
      ]),
    };

    const transactions: BankTransaction[] = [];
    for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
      const line = lines[rowIndex];
      const columns = parseCsvRow(line);
      if (!columns.length) continue;

      const rowText = columns.join(" ").toUpperCase();
      if (
        rowText.includes("TOTAL") ||
        rowText.includes("SUMMARY") ||
        rowText.includes("OPENING BALANCE") ||
        rowText.includes("CLOSING BALANCE")
      ) {
        continue;
      }

      const debit = indices.debit >= 0 ? Math.abs(normalizeAmount(columns[indices.debit])) : 0;
      const credit = indices.credit >= 0 ? Math.abs(normalizeAmount(columns[indices.credit])) : 0;
      const balance = indices.balance >= 0 ? normalizeAmount(columns[indices.balance]) : 0;
      const status = indices.status >= 0 ? String(columns[indices.status] || "").trim() : undefined;
      const beneficiaryName =
        indices.beneficiaryName >= 0
          ? String(columns[indices.beneficiaryName] || "").trim()
          : undefined;
      let instructionId =
        indices.instructionId >= 0
          ? String(columns[indices.instructionId] || "").trim()
          : undefined;
      // If transId matches ConnectIPS pattern (/^0201\d{6}[A-Za-z0-9]+$/), prioritize it over static scheme name in instructionId
      if (indices.transId >= 0 && columns[indices.transId]) {
        const transVal = String(columns[indices.transId] || "").trim();
        if (/^0201\d{6}[A-Za-z0-9]+$/i.test(transVal)) {
          instructionId = transVal;
        }
      }
      const rawReason = indices.reason >= 0 ? String(columns[indices.reason] || "").trim() : "";
      let desc =
        indices.description >= 0
          ? columns[indices.description]
          : beneficiaryName || columns.slice(1, 4).join(" ");
      if (
        rawReason &&
        !String(desc || "")
          .toUpperCase()
          .includes(rawReason.toUpperCase())
      ) {
        desc = desc ? `${desc} [Reason: ${rawReason}]` : `[Reason: ${rawReason}]`;
      }

      const upperDesc = String(desc || "").toUpperCase();
      const isCircular = upperDesc.includes("NRB CIRCULAR");
      if (isCircular && !options.includeCircularSweeps) {
        continue;
      }

      const isReject =
        upperDesc.includes("REJECT") ||
        upperDesc.includes("RETURN") ||
        upperDesc.includes("INCORRECT A/C") ||
        upperDesc.includes("BOID MISMATCH") ||
        (status && (status.toUpperCase() === "REJECTED" || status.toUpperCase() === "RJCT"));

      const isFunding =
        credit > 0 &&
        (upperDesc.includes("FUND") ||
          upperDesc.includes("DEPOSIT") ||
          upperDesc.includes("INWARD"));

      const category: BankTransaction["category"] = isCircular
        ? "NRB_CIRCULAR"
        : isReject
          ? "REJECT_RETURN"
          : isFunding
            ? "FUNDING_DEPOSIT"
            : "PAYOUT_DEBIT";

      let finalDebit = debit;
      let finalCredit = credit;
      if (indices.debit < 0 && finalDebit === 0 && finalCredit > 0 && category === "PAYOUT_DEBIT") {
        finalDebit = finalCredit;
        finalCredit = 0;
      }

      const resolvedStatus = status || (isReject ? "Rejected" : undefined);

      transactions.push({
        id: `txn-${rowIndex}`,
        date: indices.date >= 0 ? normalizeDate(columns[indices.date]) : "",
        description: desc,
        debit: finalDebit,
        credit: finalCredit,
        balance,
        bankName: indices.bankName >= 0 ? columns[indices.bankName] : undefined,
        accountNo: indices.accountNo >= 0 ? columns[indices.accountNo] : undefined,
        beneficiaryName,
        status: resolvedStatus,
        instructionId,
        batchId: indices.batchId >= 0 ? String(columns[indices.batchId] || "").trim() : undefined,
        fileName: file.name,
        isLiquiditySweep: isCircular,
        category,
      });
    }

    return transactions;
  },

  /**
   * Parse Excel ACH settlement reports, ConnectIPS status files, and Electronic Bank Statements.
   */
  async parseExcelSettlement(
    file: File,
    options: { includeCircularSweeps?: boolean } = {},
  ): Promise<BankTransaction[]> {
    let rawBuffer: ArrayBuffer;
    if (typeof file.arrayBuffer === "function") {
      rawBuffer = await file.arrayBuffer();
    } else {
      rawBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsArrayBuffer(file);
      });
    }

    const data = new Uint8Array(rawBuffer);
    const workbook = XLSX.read(data, { type: "array", cellDates: true });
    const transactions: BankTransaction[] = [];

    // Choose sheets to process
    let sheetsToProcess = workbook.SheetNames;
    const isMultiBankLateRtn = workbook.SheetNames.some((s) => /LATE\s*RTN/i.test(s));
    const isMultiLotWorkbook =
      !workbook.SheetNames.some(
        (s) => s.toLowerCase().includes("thapathali") || s.toLowerCase().includes("nchl"),
      ) &&
      workbook.SheetNames.some((s) => /^Sheet\d+$/i.test(s)) &&
      workbook.SheetNames.length > 1;

    if (isMultiBankLateRtn || isMultiLotWorkbook) {
      // Process all sheets in multi-bank late return or multi-lot files
      sheetsToProcess = workbook.SheetNames;
    } else {
      const nchlSheet = workbook.SheetNames.find(
        (s) =>
          s.toLowerCase().includes("nchl") ||
          s.toLowerCase().includes("bankcentral") ||
          s.toLowerCase().includes("thapathali"),
      );
      if (nchlSheet) {
        sheetsToProcess = [nchlSheet];
      } else if (workbook.SheetNames.includes("Statement") && workbook.SheetNames.length > 1) {
        sheetsToProcess = ["Statement"];
      } else if (workbook.SheetNames.includes("Sheet1") && workbook.SheetNames.length > 1) {
        sheetsToProcess = ["Sheet1"];
      }
    }

    for (const sheetName of sheetsToProcess) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
      if (!rows.length) continue;

      // 1. Scan metadata in the first 20 rows (Account Holder, Account Number)
      let detectedAccountHolder = "";
      let detectedAccountNo = "";
      let headerRowIndex = 0;

      for (let i = 0; i < Math.min(25, rows.length); i++) {
        const r = rows[i];
        if (!Array.isArray(r)) continue;
        const lineText = r.map((c) => String(c).trim()).join(" ");

        if (lineText.includes("Account Holder's Name:") || lineText.includes("Account Name:")) {
          const m = lineText.match(
            /Account\s*(?:Holder's\s*)?Name:\s*([^:]+?)(?:\s+From:|\s+To:|$)/i,
          );
          if (m && m[1]) detectedAccountHolder = m[1].trim();
        }
        if (lineText.includes("Account Number:") || lineText.includes("Account No:")) {
          const m = lineText.match(/Account\s*(?:Number|No):\s*([0-9A-Za-z]+)/i);
          if (m && m[1]) detectedAccountNo = m[1].trim();
        }

        // Check if this row is the actual table header row
        const cleanCells = r.map((c) => cleanPattern(String(c)));
        const hasDateCol = cleanCells.some(
          (c) => c.includes("date") || c.includes("txndate") || c.includes("settlement"),
        );
        const hasAmountOrDesc = cleanCells.some(
          (c) =>
            c.includes("desc") ||
            c.includes("particular") ||
            c.includes("withdraw") ||
            c.includes("debit") ||
            c.includes("amount") ||
            c.includes("deposit") ||
            c.includes("txnamt") ||
            c.includes("amt"),
        );

        if (hasDateCol && hasAmountOrDesc) {
          headerRowIndex = i;
          break;
        }
      }

      // Check for specialized headerless reject file (e.g. ERROR REPORT with Scheme, Batch, Amount, BankCode, Name, Account)
      const firstRow = rows[0];
      const isHeaderlessCipsReject =
        Array.isArray(firstRow) &&
        firstRow.length >= 8 &&
        typeof firstRow[2] === "number" &&
        (String(firstRow[0]).toUpperCase().includes("MUTUAL FUND") ||
          String(firstRow[1]).toUpperCase().includes("DIV")) &&
        String(firstRow[7]).replace(/[^0-9A-Za-z]/g, "").length >= 6;

      if (isHeaderlessCipsReject) {
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          if (!r || !Array.isArray(r) || r.length < 8) continue;
          const scheme = String(r[0] || "").trim();
          const batchId = String(r[1] || "").trim();
          const amount = normalizeAmount(r[2]);
          if (amount === 0) continue;
          const beneficiaryName = String(r[6] || "").trim();
          const accountNo = String(r[7] || "").trim();
          const debtorAccount = r[15] ? String(r[15]).trim() : undefined;
          const metadata = r[22] ? String(r[22]).trim() : "";
          const dateMatch = metadata.match(/\b(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})\b/);
          const date = dateMatch ? normalizeDate(dateMatch[1]) : "";

          transactions.push({
            id: `txn-${sheetName}-${i}`,
            date,
            description: `${scheme} Reject: ${beneficiaryName} (${batchId})`,
            debit: amount,
            credit: 0,
            balance: 0,
            accountNo: accountNo || undefined,
            beneficiaryName: beneficiaryName || undefined,
            status: "RJCT",
            batchId: batchId || undefined,
            fileName: file.name,
            category: "REJECT_RETURN",
            isLiquiditySweep: false,
            accountHolder: debtorAccount,
          });
        }
        continue;
      }

      // If sheet contains a BOID or Shareholder Registry column, it is a payee list / ConnectIPS lot file, not an account statement.
      const rawHeaderStrings = rows[headerRowIndex].map((h: any) => cleanPattern(String(h)));
      const isShareholderLotSheet = rawHeaderStrings.some(
        (c) =>
          c === "boid" ||
          c === "beneficiaryid" ||
          c === "clientid" ||
          c === "kitta" ||
          c === "sharesheld",
      );
      if (isShareholderLotSheet) {
        console.info(
          `[BankParser] Skipping sheet "${sheetName}": detected shareholder/BOID registry column. File should be processed by ExcelParser.`,
        );
        continue;
      }

      const headerRow = rows[headerRowIndex].map((h: any) => String(h).trim().toLowerCase());
      const indices = {
        amount: findColumnIndexByPriority(headerRow, [
          ["transaction amount", "transactionamount", "amt", "txnamt", "txn amt"],
          ["amount", "net amount"],
        ]),
        date: findColumnIndexByPriority(headerRow, [
          [
            "created on",
            "settlementdt",
            "settlement date",
            "transaction date",
            "txndate",
            "date",
            "creationdate",
          ],
        ]),
        description: findColumnIndexByPriority(headerRow, [
          ["particulars", "narration", "description"],
          ["remarks"],
          ["instructionid", "instruction id", "endtoendid"],
        ]),
        debit: findColumnIndexByPriority(headerRow, [
          ["withdraw", "withdrawal", "debit", "payment"],
        ]),
        credit: findColumnIndexByPriority(headerRow, [
          ["transaction amount", "transactionamount", "amt"],
          ["deposit", "credit", "amount", "net amount"],
        ]),
        balance: findColumnIndexByPriority(headerRow, [["balance"]]),
        bankName: findColumnIndexByPriority(headerRow, [
          ["creditor bank", "creditorbank", "creditor agent", "creditoragent", "instgbranch"],
          ["bank", "bank name"],
        ]),
        accountNo: findColumnIndexByPriority(headerRow, [
          ["creditor account", "creditoraccount", "beneficiary account"],
          ["account no", "account number", "a/c", "account"],
          ["debtor account", "debtoraccount"],
        ]),
        creditorName: findColumnIndexByPriority(headerRow, [
          ["creditor name", "creditorname", "beneficiary name", "payee name"],
          ["name", "shareholder name", "beneficiary"],
          ["debtor name", "debtorname"],
        ]),
        status: findColumnIndexByPriority(headerRow, [
          [
            "credit status",
            "creditstatus",
            "achstatus.description",
            "achstatus",
            "status",
            "tx status",
          ],
        ]),
        transId: findColumnIndexByPriority(headerRow, [
          ["transid", "transaction id", "transactionid", "txn id", "txnid"],
        ]),
        instructionId: findColumnIndexByPriority(headerRow, [
          ["instruction id", "instructionid"],
          ["reference id", "referenceid", "endtoendid"],
          ["transaction id", "transid"],
        ]),
        batchId: findColumnIndexByPriority(headerRow, [["batch id", "batchid", "batch.sessionid"]]),
        referenceId: findColumnIndexByPriority(headerRow, [
          ["reference id", "referenceid", "ref no", "ref id"],
        ]),
        reason: findColumnIndexByPriority(headerRow, [
          [
            "return reason",
            "returnreason",
            "rejection reason",
            "rejectionreason",
            "reason",
            "error message",
            "errormessage",
            "reject remarks",
            "status remarks",
          ],
        ]),
      };

      // Detect multiple description columns (e.g., DESC 1, DESC 2, DESC 3 in RBB electronic statements)
      const descIndices: number[] = [];
      headerRow.forEach((col: string, idx: number) => {
        const norm = col.trim().toLowerCase();
        if (
          norm.startsWith("desc") ||
          norm.startsWith("narration") ||
          norm.startsWith("particular")
        ) {
          descIndices.push(idx);
        }
      });

      for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        if (
          !row ||
          (Array.isArray(row) && row.every((c) => c === "" || c === null || c === undefined))
        )
          continue;

        const rowValues = Array.isArray(row) ? row : Object.values(row);
        const rowText = rowValues.map(String).join(" ").toUpperCase();
        if (
          rowText.includes("TOTAL") ||
          rowText.includes("SUMMARY") ||
          rowText.includes("OPENING BALANCE") ||
          rowText.includes("CLOSING BALANCE")
        ) {
          continue;
        }

        const rawReason =
          indices.reason >= 0 && row[indices.reason]
            ? String(row[indices.reason] || "").trim()
            : "";
        let rawDesc = "";
        if (descIndices.length > 1) {
          const parts = descIndices
            .map((idx) => String(row[idx] || "").trim())
            .filter((p) => p && p !== "-");
          rawDesc = parts.join(" ");
        } else if (indices.description >= 0 && row[indices.description]) {
          rawDesc = String(row[indices.description] || "").trim();
        }
        if (rawReason && !rawDesc.toUpperCase().includes(rawReason.toUpperCase())) {
          rawDesc = rawDesc ? `${rawDesc} [Reason: ${rawReason}]` : `[Reason: ${rawReason}]`;
        }
        const withdrawVal = indices.debit >= 0 ? Math.abs(normalizeAmount(row[indices.debit])) : 0;
        const depositVal =
          indices.credit >= 0
            ? Math.abs(normalizeAmount(row[indices.credit]))
            : indices.amount >= 0
              ? Math.abs(normalizeAmount(row[indices.amount]))
              : 0;
        const balanceVal = indices.balance >= 0 ? normalizeAmount(row[indices.balance]) : 0;

        if (
          withdrawVal === 0 &&
          depositVal === 0 &&
          !row[indices.accountNo] &&
          !row[indices.creditorName]
        ) {
          continue;
        }

        // Intelligent Classification
        const upperDesc = rawDesc.toUpperCase();
        const upperFileName = file.name.toUpperCase();
        const upperSheetName = sheetName.toUpperCase();
        const rowStatus =
          indices.status >= 0 && row[indices.status]
            ? String(row[indices.status]).trim().toUpperCase()
            : "";
        const isCircular = upperDesc.includes("NRB CIRCULAR");

        // If options specify to exclude circular sweeps, skip them
        if (isCircular && !options.includeCircularSweeps) {
          continue;
        }

        let category: BankTransaction["category"] = "OTHER";
        let autoStatus: string | undefined = undefined;

        const isLateReturnDoc =
          upperFileName.includes("LATE RTN") ||
          upperFileName.includes("LATE_RTN") ||
          upperFileName.includes("LATE RETURN") ||
          upperSheetName.includes("LATE RTN") ||
          upperSheetName.includes("LATE_RTN") ||
          upperSheetName.includes("LATERETURN");

        const isSettlementReport =
          !isLateReturnDoc &&
          (indices.creditorName >= 0 ||
            indices.batchId >= 0 ||
            upperFileName.includes("IPS") ||
            upperFileName.includes("SETTLEMENT") ||
            upperFileName.includes("LOT"));

        const isReject =
          isLateReturnDoc ||
          rowStatus === "RJCT" ||
          rowStatus.includes("REJECT") ||
          rowStatus.includes("FAIL") ||
          upperDesc.includes("INCORRECT A/C") ||
          upperDesc.includes("INCORRECT ACCOUNT") ||
          upperDesc.includes("REJECT") ||
          upperDesc.includes("RETURN") ||
          upperDesc.includes("BOUNCE") ||
          upperDesc.includes("RJCT") ||
          upperDesc.includes("SUTRA REV") ||
          upperDesc.includes("REV(") ||
          upperDesc.includes("REVERSAL") ||
          upperDesc.includes("LATE RTN");

        // Detect ConnectIPS returned deposits (e.g. 16868722 0201260721JWX461... deposit) in bank statements
        const isConnectIpsReturn =
          !isSettlementReport &&
          depositVal > 0 &&
          withdrawVal === 0 &&
          (isReject ||
            upperDesc.includes("REV") ||
            upperDesc.includes("RTN") ||
            /\b0201\d{6}[A-Z0-9]+\s+0201\d{6}/i.test(rawDesc));

        const isIssuerFundingOrBatch =
          upperDesc.includes("TRF FROM") ||
          upperDesc.includes("TRF TO") ||
          upperDesc.includes("NET INTEREST AMOUNT") ||
          upperDesc.includes("NET INT ") ||
          upperDesc.includes("INTEREST SHRAWAN") ||
          upperDesc.includes("INTEREST ASAR") ||
          upperDesc.includes("DIVIDEND REVERSAL") ||
          upperDesc.includes("RECTIFIED") ||
          (depositVal > 10000000 && !rawDesc.includes("0201"));

        if (isCircular) {
          category = "NRB_CIRCULAR";
        } else if (isSettlementReport) {
          if (isReject) {
            category = "REJECT_RETURN";
            autoStatus = "RJCT";
          } else {
            category = "PAYOUT_DEBIT";
            autoStatus = rowStatus || "ACSC";
          }
        } else if (
          isReject ||
          isConnectIpsReturn ||
          (!isSettlementReport &&
            rowStatus !== "ACSC" &&
            depositVal > 0 &&
            withdrawVal === 0 &&
            rawDesc.includes("0201") &&
            !isIssuerFundingOrBatch)
        ) {
          category = "REJECT_RETURN";
          autoStatus = "RJCT";
        } else if (isIssuerFundingOrBatch && depositVal > 0) {
          category = "FUNDING_DEPOSIT";
        } else if (
          (upperDesc.includes("INTEREST") ||
            upperDesc.includes("DEBENTURE") ||
            upperDesc.includes("DIVIDEND") ||
            upperDesc.includes("MUTUAL FUND") ||
            upperDesc.includes("IPS DR") ||
            upperDesc.includes("CHQ") ||
            upperDesc.includes("REINSURANCE") ||
            upperDesc.includes("KOSH") ||
            upperDesc.includes("FUND")) &&
          withdrawVal > 0
        ) {
          category = "PAYOUT_DEBIT";
          autoStatus = "ACSC";
        } else if (
          upperDesc.includes("CHG") ||
          upperDesc.includes("COMMISSION") ||
          upperDesc.includes("FEE")
        ) {
          category = "BANK_CHARGES";
        } else if (depositVal > 0 && withdrawVal === 0) {
          category = "FUNDING_DEPOSIT";
        } else if (withdrawVal > 0) {
          category = "PAYOUT_DEBIT";
        }

        let finalDebit = withdrawVal;
        let finalCredit = depositVal;

        // If settlement report or payout with a single amount column, map amount to debit
        if (
          indices.debit < 0 &&
          finalDebit === 0 &&
          finalCredit > 0 &&
          (category === "PAYOUT_DEBIT" || isSettlementReport)
        ) {
          finalDebit = finalCredit;
          finalCredit = 0;
        }

        // Extract account number from description if not in dedicated column
        let extractedAccountNo =
          indices.accountNo >= 0 ? String(row[indices.accountNo] || "").trim() : "";
        if (!extractedAccountNo) {
          const accMatch =
            rawDesc.match(/(?:A\/C|AC|ACC|ACCOUNT|:|\.)\s*([0-9A-Za-z]{8,20})/i) ||
            rawDesc.match(/\b([0-9]{10,20})\b/);
          if (accMatch && accMatch[1]) {
            extractedAccountNo = accMatch[1];
          }
        }

        // Extract beneficiary / institutional name from description
        let extractedName =
          indices.creditorName >= 0 ? String(row[indices.creditorName] || "").trim() : "";
        if (!extractedName) {
          if (
            upperDesc.includes("NEPAL REINSURANCE") ||
            upperDesc.includes("NEPAL RE INSURANCE") ||
            upperDesc.includes("0129218139") ||
            upperDesc.includes("0079175657")
          )
            extractedName = "NEPAL RE INSURANCE COMPANY LIMITED";
          else if (
            upperDesc.includes("CONTRIBUTION FUND") ||
            upperDesc.includes("CITIZEN INVESTMENT")
          )
            extractedName = "CITIZEN INVESTMENT TRUST (CONTRIBUTION FUND)";
          else if (upperDesc.includes("SAINIK KALYANKARI"))
            extractedName = "SAINIK KALYANKARI KOSH";
          else if (upperDesc.includes("LAXMI SUNRISE CAPITAL"))
            extractedName = "LAXMI SUNRISE CAPITAL LTD";
          else if (upperDesc.includes("SOCIAL SECURITY FUND") || upperDesc.includes("SSF"))
            extractedName = "SOCIAL SECURITY FUND";
          else if (upperDesc.includes("NEA RETIREMENT FUND"))
            extractedName = "NEA RETIREMENT FUND MGMT SECT";
          else if (upperDesc.includes("NIC ASIA BALANCED"))
            extractedName = "NIC ASIA BALANCED FUND";
          else if (upperDesc.includes("HIMALAYAN LIFE"))
            extractedName = "HIMALAYAN LIFE INSURANCE LIMITED";
          else if (upperDesc.includes("CITIZEN LIFE"))
            extractedName = "CITIZEN LIFE INSURANCE CO.LTD";
        }

        const status =
          indices.status >= 0 && row[indices.status]
            ? String(row[indices.status]).trim()
            : autoStatus;

        // Extract ConnectIPS instruction ID or reference ID from description if not in dedicated column
        let instructionId =
          indices.instructionId >= 0 ? String(row[indices.instructionId] || "").trim() : undefined;
        // If transId matches ConnectIPS pattern (/^0201\d{6}[A-Za-z0-9]+$/), prioritize it over static scheme name in instructionId
        if (indices.transId >= 0 && row[indices.transId]) {
          const transVal = String(row[indices.transId] || "").trim();
          if (/^0201\d{6}[A-Za-z0-9]+$/i.test(transVal)) {
            instructionId = transVal;
          }
        }
        if (!instructionId && rawDesc) {
          const cipsMatch =
            rawDesc.match(/\b(0201\d{6}[A-Za-z0-9]{3,20})\b/) ||
            rawDesc.match(/\b([0-9]{4,}[A-Za-z0-9]{8,24})\b/);
          if (cipsMatch) {
            instructionId = cipsMatch[1];
          }
        }

        // Extract ConnectIPS batch ID from description or instruction ID
        let batchId = indices.batchId >= 0 ? String(row[indices.batchId] || "").trim() : undefined;
        if (!batchId && rawDesc) {
          const batchMatch =
            rawDesc.match(/BATCH\s*(?:ID)?\s*([0-9A-Za-z_-]+)/i) ||
            rawDesc.match(/\b(0201\d{6}[A-Za-z]{3})\b/);
          if (batchMatch) {
            batchId = batchMatch[1];
          }
        }

        const referenceId =
          indices.referenceId >= 0 ? String(row[indices.referenceId] || "").trim() : undefined;

        const description =
          rawDesc ||
          extractedName ||
          (finalDebit > 0 ? `Debit Payment ${finalDebit}` : `Credit Settlement ${finalCredit}`);

        transactions.push({
          id: `txn-${sheetName}-${i}`,
          date: indices.date >= 0 ? normalizeDate(row[indices.date]) : "",
          description,
          debit: finalDebit,
          credit: finalCredit,
          balance: balanceVal,
          bankName: indices.bankName >= 0 ? String(row[indices.bankName] || "").trim() : undefined,
          accountNo: extractedAccountNo || undefined,
          beneficiaryName: extractedName || undefined,
          status,
          instructionId,
          referenceId,
          batchId,
          fileName: file.name,
          category,
          isLiquiditySweep: isCircular,
          accountHolder: detectedAccountHolder || undefined,
        });
      }
    }

    return transactions;
  },

  /**
   * Parse multiple bank statement or ACH settlement files concurrently/sequentially,
   * attach fileName, deduplicate, and combine into a unified transaction list.
   */
  async parseMultipleFiles(
    files: File[],
    options: {
      includeCircularSweeps?: boolean;
      onProgress?: (current: number, total: number, fileName: string) => void;
    } = {},
  ): Promise<BankTransaction[]> {
    if (!files.length) return [];
    if (files.length === 1) {
      return this.parseBankStatement(files[0], options);
    }

    const allTransactions: BankTransaction[] = [];
    const seenInstructionIds = new Set<string>();
    const seenFileSignatures = new Set<string>();
    const seenCrossFileLedger = new Set<string>();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileSig = `${file.name}_${file.size}`;
      if (seenFileSignatures.has(fileSig)) {
        continue;
      }
      seenFileSignatures.add(fileSig);

      options.onProgress?.(i + 1, files.length, file.name);

      try {
        const txns = await this.parseBankStatement(file, options);
        for (const t of txns) {
          const idRef = t.instructionId || t.referenceId;
          if (idRef && idRef.trim()) {
            const instKey = `${idRef.trim().toUpperCase()}_${t.category || ""}_${t.debit}_${t.credit}`;
            if (seenInstructionIds.has(instKey)) {
              continue;
            }
            seenInstructionIds.add(instKey);
          } else if (i > 0 && t.balance !== 0 && t.accountNo) {
            const ledgerKey = `${t.accountNo}_${t.date}_${t.debit}_${t.credit}_${t.balance}_${t.description.trim()}`;
            if (seenCrossFileLedger.has(ledgerKey)) {
              continue;
            }
            seenCrossFileLedger.add(ledgerKey);
          } else if (t.balance !== 0 && t.accountNo) {
            const ledgerKey = `${t.accountNo}_${t.date}_${t.debit}_${t.credit}_${t.balance}_${t.description.trim()}`;
            seenCrossFileLedger.add(ledgerKey);
          }

          allTransactions.push(t);
        }
      } catch (err) {
        console.warn(`Failed to parse file ${file.name}:`, err);
      }
    }

    return allTransactions;
  },
};
