import * as XLSX from 'xlsx';

// ──────────────────────────────────────────────
// CDSC Types & Specifications
// ──────────────────────────────────────────────

export type LockInReasonCode =
  | '00' // Free / No Lock-in
  | '01' // Promoter Share Lock-in
  | '02' // Employee Quota Lock-in
  | '03' // Mutual Fund Lock-in
  | '04' // Institutional / Strategic Lock-in
  | '09' // Local Affected Residents Lock-in
  | '99'; // Custom Lock-in

export interface LockInPreset {
  code: LockInReasonCode;
  reason: string;
  defaultExpiryYears?: number;
  isLocked: boolean;
}

export const LOCK_IN_PRESETS: Record<string, LockInPreset> = {
  PUBLIC: {
    code: '00',
    reason: '',
    isLocked: false,
  },
  LOCAL: {
    code: '09',
    reason: 'Local Affected',
    defaultExpiryYears: 3,
    isLocked: true,
  },
  EMPLOYEE: {
    code: '02',
    reason: 'Employee Quota',
    defaultExpiryYears: 3,
    isLocked: true,
  },
  PROMOTER: {
    code: '01',
    reason: 'Promoter Share',
    defaultExpiryYears: 3,
    isLocked: true,
  },
  MUTUAL_FUND: {
    code: '03',
    reason: 'Mutual Fund Allocation',
    defaultExpiryYears: 0.5,
    isLocked: true,
  },
  CUSTOM: {
    code: '99',
    reason: 'Custom Lock-in',
    isLocked: true,
  },
};

export interface IafRecord {
  boid: string;
  name?: string;
  currentKitta: number;
  lockInKitta: number;
  lockInReasonCode: string;
  lockInReason: string;
  lockInExpiryDate: string; // DDMMYYYY format or 00000000
  rtaIntRefNo: string;
  category?: string;
  applicantNo?: string;
  lotName?: string;
  errors?: string[];
  isValid?: boolean;
}

export interface IpfRecord {
  boid: string;
  rtaRefNo: string;
  debitIsin: string;
  debitCurrentQty: number;
  debitFrozenQty: number;
  debitLockInQty: number;
  debitLockCode: string;
  debitLockReason: string;
  debitLockExpiry: string;
  debitCrDb: 'C' | 'D';
  creditIsin: string;
  creditCurrentQty: number;
  creditFrozenQty: number;
  creditLockInQty: number;
  creditLockCode: string;
  creditLockReason: string;
  creditLockExpiry: string;
  creditCrDb: 'C' | 'D';
}

export interface AllotmentSummary {
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  totalAllottedKitta: number;
  totalLockInKitta: number;
  totalFreeKitta: number;
  categoryBreakdown: Record<string, { count: number; allottedKitta: number; lockedKitta: number }>;
}

// ──────────────────────────────────────────────
// Formatting Utilities (Exact CDSC Spec)
// ──────────────────────────────────────────────

/**
 * Format quantity into exact CDSC fixed-width format (16 chars):
 * 12 integer digits + '.' + 3 decimal digits, zero-padded on the left.
 * Example: 100 -> "000000000100.000"
 */
export function formatIafQuantity(qty: number): string {
  const safeQty = Math.max(0, isNaN(qty) ? 0 : qty);
  const parts = safeQty.toFixed(3).split('.');
  const intPart = parts[0].padStart(12, '0');
  const decPart = (parts[1] || '000').slice(0, 3).padEnd(3, '0');
  return `${intPart}.${decPart}`;
}

/**
 * Normalize Date to CDSC DDMMYYYY format (8 chars)
 */
export function normalizeDateToDDMMYYYY(dateInput?: string | Date | number | null): string {
  if (!dateInput) return '00000000';

  if (typeof dateInput === 'string') {
    const raw = dateInput.trim();
    if (!raw || raw === '00000000' || raw === '0') return '00000000';

    // Handle delimited strings: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD, YYYY/MM/DD
    const delimMatch = raw.match(/^(\d{1,4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,4})$/);
    if (delimMatch) {
      const p1 = delimMatch[1];
      const p2 = delimMatch[2];
      const p3 = delimMatch[3];
      if (p1.length === 4) {
        // YYYY-MM-DD
        const yyyy = p1;
        const mm = p2.padStart(2, '0');
        const dd = p3.padStart(2, '0');
        return `${dd}${mm}${yyyy}`;
      } else {
        // DD/MM/YYYY
        const dd = p1.padStart(2, '0');
        const mm = p2.padStart(2, '0');
        const yyyy = p3.length === 2 ? `20${p3}` : p3.padStart(4, '20');
        return `${dd}${mm}${yyyy}`;
      }
    }

    const clean = raw.replace(/[^0-9]/g, '');
    if (clean.length === 8) {
      // If ends with 4-digit year 19XX or 20XX (e.g. 19042029 or 20112026), it is already DDMMYYYY
      const endYear = clean.slice(4, 8);
      if (endYear.startsWith('20') || endYear.startsWith('19')) {
        return clean;
      }
      // If starts with 4-digit year (e.g. 20290419), convert YYYYMMDD to DDMMYYYY
      const startYear = clean.slice(0, 4);
      if (startYear.startsWith('20') || startYear.startsWith('19')) {
        const yyyy = startYear;
        const mm = clean.slice(4, 6);
        const dd = clean.slice(6, 8);
        return `${dd}${mm}${yyyy}`;
      }
      return clean;
    }
  }

  // Handle Excel Serial date number
  if (typeof dateInput === 'number' && dateInput > 30000 && dateInput < 60000) {
    const jsDate = new Date((dateInput - 25569) * 86400 * 1000);
    const dd = String(jsDate.getUTCDate()).padStart(2, '0');
    const mm = String(jsDate.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = String(jsDate.getUTCFullYear());
    return `${dd}${mm}${yyyy}`;
  }

  const parsed = new Date(dateInput);
  if (isNaN(parsed.getTime())) return '00000000';

  const dd = String(parsed.getDate()).padStart(2, '0');
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const yyyy = String(parsed.getFullYear());
  return `${dd}${mm}${yyyy}`;
}

/**
 * Generate CDSC Control Record (Header Line — Exactly 42 Characters)
 * Format: TotalRecords(10) + TotalCurrentQty(16.3) + TotalLockInQty(16.3)
 */
export function formatIafHeader(totalRecords: number, totalCurrentQty: number, totalLockInQty: number): string {
  const recStr = String(Math.max(0, totalRecords)).padStart(10, '0');
  const currStr = formatIafQuantity(totalCurrentQty);
  const lockStr = formatIafQuantity(totalLockInQty);
  return `${recStr}${currStr}${lockStr}`;
}

/**
 * Generate CDSC Detail Record (Line 2..N — Exactly 124 Characters)
 * Fields:
 * - BOID: Char(16)
 * - CURRENT QUANTITY: Number(16, 3)
 * - LOCK IN QUANTITY: Number(16, 3)
 * - LOCK IN REASON CODE: Number(2)
 * - LOCK IN REASON: Char(50) - space padded
 * - LOCK IN EXPIRY DATE: Char(8) - DDMMYYYY
 * - RTA INT REF NO: Char(16) - space padded
 */
export function formatIafDetailLine(record: IafRecord, defaultRtaRef = ''): string {
  const boid = String(record.boid || '').trim().replace(/[^0-9A-Za-z]/g, '').padStart(16, '0').slice(0, 16);
  const currentQty = formatIafQuantity(record.currentKitta);
  const lockInQty = formatIafQuantity(record.lockInKitta);
  
  let lockCode = '00';
  let reason = ''.padEnd(50, ' ');
  let expiry = '00000000';

  if (record.lockInKitta > 0) {
    lockCode = String(record.lockInReasonCode || '09').padStart(2, '0').slice(0, 2);
    const rawReason = record.lockInReason || 'Local Affected';
    reason = rawReason.padEnd(50, ' ').slice(0, 50);
    expiry = normalizeDateToDDMMYYYY(record.lockInExpiryDate || '00000000').padEnd(8, '0').slice(0, 8);
  }

  const rawRef = (record.rtaIntRefNo || defaultRtaRef || '').trim();
  const rtaRef = rawRef.slice(0, 16).padStart(16, ' ');

  return `${boid}${currentQty}${lockInQty}${lockCode}${reason}${expiry}${rtaRef}`;
}

/**
 * Generate Corporate Action Allotment Control Record (IPF Header Line — Exactly 58 Characters)
 * Format: TotalRecords(10) + TotalDebit/CreditQty(16.3) + TotalFrozenQty(16.3) + TotalLockInQty(16.3)
 */
export function formatIpfHeader(
  totalRecords: number,
  totalQty: number,
  totalFrozenQty = 0,
  totalLockQty = 0
): string {
  const recStr = String(Math.max(0, totalRecords)).padStart(10, '0');
  const qtyStr = formatIafQuantity(totalQty);
  const frozStr = formatIafQuantity(totalFrozenQty);
  const lockStr = formatIafQuantity(totalLockQty);
  return `${recStr}${qtyStr}${frozStr}${lockStr}`;
}

/**
 * Generate Corporate Action Allotment Detail Record (IPF Line 2..N — Exactly 274 Characters)
 */
export function formatIpfDetailLine(record: IpfRecord): string {
  const boid = String(record.boid || '').trim().replace(/[^0-9A-Za-z]/g, '').padStart(16, '0').slice(0, 16);
  const rtaRef = String(record.rtaRefNo || '').trim().slice(0, 16).padEnd(16, ' ');

  // Debit fields
  const debitIsin = String(record.debitIsin || '').trim().padEnd(12, ' ').slice(0, 12);
  const debitCurr = formatIafQuantity(record.debitCurrentQty);
  const debitFroz = formatIafQuantity(record.debitFrozenQty);
  const debitLock = formatIafQuantity(record.debitLockInQty);
  const debitCode = String(record.debitLockCode || '00').padStart(2, '0').slice(0, 2);
  const debitReason = (record.debitLockReason || '').padEnd(50, ' ').slice(0, 50);
  const debitExpiry = normalizeDateToDDMMYYYY(record.debitLockExpiry || '00000000').padEnd(8, '0').slice(0, 8);
  const debitCrDb = (record.debitCrDb || 'C').slice(0, 1).toUpperCase();

  // Credit fields
  const creditIsin = String(record.creditIsin || '').trim().padEnd(12, ' ').slice(0, 12);
  const creditCurr = formatIafQuantity(record.creditCurrentQty);
  const creditFroz = formatIafQuantity(record.creditFrozenQty);
  const creditLock = formatIafQuantity(record.creditLockInQty);
  const creditCode = String(record.creditLockCode || '00').padStart(2, '0').slice(0, 2);
  const creditReason = (record.creditLockReason || '').padEnd(50, ' ').slice(0, 50);
  const creditExpiry = normalizeDateToDDMMYYYY(record.creditLockExpiry || '00000000').padEnd(8, '0').slice(0, 8);
  const creditCrDb = (record.creditCrDb || 'C').slice(0, 1).toUpperCase();

  return `${boid}${rtaRef}${debitIsin}${debitCurr}${debitFroz}${debitLock}${debitCode}${debitReason}${debitExpiry}${debitCrDb}${creditIsin}${creditCurr}${creditFroz}${creditLock}${creditCode}${creditReason}${creditExpiry}${creditCrDb}`;
}

// ──────────────────────────────────────────────
// Service Implementation
// ──────────────────────────────────────────────

export const IafGeneratorService = {
  formatIafHeader,
  formatIafDetailLine,
  formatIafQuantity,
  formatIpfHeader,
  formatIpfDetailLine,
  normalizeDateToDDMMYYYY,

  /**
   * Universal Excel / CSV Allotment Parser
   * Supports standard column aliases for BOID, Kitta, Lock-in, Category, and References.
   */
  async parseAllotmentExcel(
    fileOrBuffer: File | ArrayBuffer,
    options?: {
      defaultLockPreset?: LockInPreset;
      defaultRtaRef?: string;
      customExpiryDate?: string;
    }
  ): Promise<{ records: IafRecord[]; summary: AllotmentSummary; detectedRtaRef?: string }> {
    let data: ArrayBuffer;
    if (fileOrBuffer instanceof File) {
      data = await fileOrBuffer.arrayBuffer();
    } else {
      data = fileOrBuffer;
    }

    const workbook = XLSX.read(data, { type: 'array' });
    const records: IafRecord[] = [];
    let detectedRtaRef = options?.defaultRtaRef || '';

    for (const sheetName of workbook.SheetNames) {
      if (/SUMMARY|TOTAL/i.test(sheetName)) continue;
      const ws = workbook.Sheets[sheetName];
      const rawRows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

      for (const row of rawRows) {
        // Find BOID from aliases
        const rawBoid = String(
          row['boid'] ??
          row['BOID'] ??
          row['bo acct no '] ??
          row['bo acct no'] ??
          row['BO ACCT NO'] ??
          row['BENEFICIARY ID'] ??
          row['CLIENT ID'] ??
          row['CLIENT_ID'] ??
          row['BENEFICIARY_ID'] ??
          row['Demat Account'] ??
          row['Demat'] ??
          row['DEMAT'] ??
          ''
        ).trim().replace(/[^0-9A-Za-z]/g, '');

        if (!rawBoid) continue;

        // Find Current / Allotted Kitta
        const rawCurrentKitta = Number(
          row['curr_kitta'] ??
          row['AllotedKitta'] ??
          row['alloted_kitta'] ??
          row['ALLOTED_KITTA'] ??
          row['ALLOTTED_KITTA'] ??
          row['Allotted Kitta'] ??
          row['Alloted Kitta'] ??
          row['current quan'] ??
          row['CURRENT_QTY'] ??
          row['kitta'] ??
          row['KITTA'] ??
          row['shares'] ??
          row['SHARES'] ??
          row['Total Shares'] ??
          0
        );

        if (isNaN(rawCurrentKitta) || rawCurrentKitta <= 0) continue;

        // Find Lock-in Kitta
        let rawLockKitta = row['lock_kitta'] ?? row['lock in quan'] ?? row['LOCK_IN_KITTA'] ?? row['Locked Kitta'];
        let lockInKitta = rawLockKitta !== undefined && rawLockKitta !== '' ? Number(rawLockKitta) : 0;

        // Lock code
        let lockCode = String(row['lock_code'] ?? row['lock code'] ?? row['LOCK_CODE'] ?? '').trim();
        // Lock reason
        let lockReason = String(row['lock_reason'] ?? row['lock in reason'] ?? row['LOCK_REASON'] ?? '').trim();
        // Lock date
        let rawLockDate = row['lock_date'] ?? row['lock in expiry'] ?? row['expiry'] ?? row['LOCK_EXPIRY'];

        // RTA Ref
        const rtaRef = String(row['rta_reg'] ?? row['rtarefno'] ?? row['RTA_REF'] ?? row['RTA_REF_NO'] ?? options?.defaultRtaRef ?? '').trim();
        if (rtaRef && !detectedRtaRef) detectedRtaRef = rtaRef;

        // Apply preset if lock columns not specified in sheet
        if (options?.defaultLockPreset) {
          if (options.defaultLockPreset.isLocked) {
            if (lockInKitta <= 0) lockInKitta = rawCurrentKitta;
            if (!lockCode) lockCode = options.defaultLockPreset.code;
            if (!lockReason) lockReason = options.defaultLockPreset.reason;
          } else {
            // Free Public / No lock-in
            lockInKitta = 0;
            lockCode = '00';
            lockReason = '';
            rawLockDate = '00000000';
          }
        }

        const name = String(row['name'] ?? row['NAME'] ?? row['shareholder_name'] ?? row['APPLICANT NAME'] ?? '').trim();
        const applicantNo = String(row['applicant_no'] ?? row['APPLICANT_NO'] ?? row['APP_NO'] ?? '').trim();
        const category = String(row['category'] ?? row['CATEGORY'] ?? sheetName).trim();

        // Validation errors
        const errors: string[] = [];
        if (rawBoid.length !== 16) {
          errors.push(`Invalid BOID length (${rawBoid.length} digits, expected 16)`);
        }
        if (lockInKitta > rawCurrentKitta) {
          errors.push(`Lock-in kitta (${lockInKitta}) exceeds total allotted kitta (${rawCurrentKitta})`);
        }

        records.push({
          boid: rawBoid,
          name,
          currentKitta: rawCurrentKitta,
          lockInKitta: Math.max(0, lockInKitta),
          lockInReasonCode: lockCode || (lockInKitta > 0 ? '09' : '00'),
          lockInReason: lockReason || (lockInKitta > 0 ? 'Local Affected' : ''),
          lockInExpiryDate: normalizeDateToDDMMYYYY(rawLockDate || options?.customExpiryDate),
          rtaIntRefNo: rtaRef || detectedRtaRef,
          category,
          applicantNo,
          lotName: sheetName,
          errors,
          isValid: errors.length === 0,
        });
      }
    }

    const summary = this.generateAllotmentSummary(records);
    return { records, summary, detectedRtaRef };
  },

  /**
   * Generate Summary Analytics from records
   */
  generateAllotmentSummary(records: IafRecord[]): AllotmentSummary {
    let totalAllotted = 0;
    let totalLocked = 0;
    let validCount = 0;
    let invalidCount = 0;
    const categoryBreakdown: AllotmentSummary['categoryBreakdown'] = {};

    for (const r of records) {
      totalAllotted += r.currentKitta;
      totalLocked += r.lockInKitta;
      if (r.isValid !== false && (!r.errors || r.errors.length === 0)) {
        validCount++;
      } else {
        invalidCount++;
      }

      const cat = r.category || r.lotName || 'General';
      if (!categoryBreakdown[cat]) {
        categoryBreakdown[cat] = { count: 0, allottedKitta: 0, lockedKitta: 0 };
      }
      categoryBreakdown[cat].count++;
      categoryBreakdown[cat].allottedKitta += r.currentKitta;
      categoryBreakdown[cat].lockedKitta += r.lockInKitta;
    }

    return {
      totalRecords: records.length,
      validRecords: validCount,
      invalidRecords: invalidCount,
      totalAllottedKitta: Math.round(totalAllotted * 1000) / 1000,
      totalLockInKitta: Math.round(totalLocked * 1000) / 1000,
      totalFreeKitta: Math.round((totalAllotted - totalLocked) * 1000) / 1000,
      categoryBreakdown,
    };
  },

  /**
   * Generate complete `.iaf` File Content (Header + Detail Records)
   */
  generateIafContent(
    records: IafRecord[],
    options?: {
      rtaRef?: string;
      lockCode?: string;
      lockReason?: string;
      lockExpiryDate?: string;
      lockAll?: boolean;
    }
  ): string {
    const validRecords = records.filter(r => r.currentKitta > 0);
    const totalRecords = validRecords.length;

    let totalCurrent = 0;
    let totalLocked = 0;

    const lines: string[] = [];

    for (const rec of validRecords) {
      const currentKitta = rec.currentKitta;
      let lockKitta = rec.lockInKitta;

      if (options?.lockCode === '00') {
        lockKitta = 0;
      } else if (options?.lockAll === true) {
        lockKitta = currentKitta;
      }

      if (lockKitta > currentKitta) lockKitta = currentKitta;

      totalCurrent += currentKitta;
      totalLocked += lockKitta;

      const recordToFormat: IafRecord = {
        ...rec,
        lockInKitta: lockKitta,
        lockInReasonCode: lockKitta > 0 ? (options?.lockCode || rec.lockInReasonCode || '09') : '00',
        lockInReason: lockKitta > 0 ? (options?.lockReason !== undefined ? options.lockReason : rec.lockInReason) : '',
        lockInExpiryDate: lockKitta > 0 ? (options?.lockExpiryDate ? normalizeDateToDDMMYYYY(options.lockExpiryDate) : rec.lockInExpiryDate) : '00000000',
        rtaIntRefNo: options?.rtaRef || rec.rtaIntRefNo,
      };

      lines.push(formatIafDetailLine(recordToFormat, options?.rtaRef));
    }

    const header = formatIafHeader(totalRecords, totalCurrent, totalLocked);
    return [header, ...lines].join('\r\n') + '\r\n';
  },

  /**
   * Generate complete `.ivf` File Content (Verification File)
   * Header: RecordCount(10)
   * Lines: BOID(16)
   */
  generateIvfContent(records: Array<{ boid: string }>): string {
    const validBoids = records
      .map(r => String(r.boid || '').trim().replace(/[^0-9A-Za-z]/g, ''))
      .filter(b => b.length === 16);

    const header = String(validBoids.length).padStart(10, '0');
    const lines = validBoids.map(b => b.padStart(16, '0'));
    return [header, ...lines].join('\r\n') + '\r\n';
  },

  /**
   * Generate Web Allotee CSV Content (for CDS online result upload)
   */
  generateWebAlloteeCsv(records: IafRecord[]): string {
    const headers = ['BOID', 'AllotedKitta', 'ShareholderName', 'Status'];
    const rows = records.map(r => [
      `"${r.boid}"`,
      r.currentKitta,
      `"${(r.name || '').replace(/"/g, '""')}"`,
      r.lockInKitta > 0 ? '"Allotted (Locked)"' : '"Allotted (Free)"',
    ]);
    return [headers.join(','), ...rows.map(row => row.join(','))].join('\r\n');
  },

  /**
   * Split a large record set into multiple CDSC lots
   */
  splitRecordsByLot(records: IafRecord[], maxPerLot = 50000): Array<{ lotNumber: number; records: IafRecord[] }> {
    const lots: Array<{ lotNumber: number; records: IafRecord[] }> = [];
    for (let i = 0; i < records.length; i += maxPerLot) {
      lots.push({
        lotNumber: Math.floor(i / maxPerLot) + 1,
        records: records.slice(i, i + maxPerLot),
      });
    }
    return lots;
  },

  /**
   * Trigger browser file download
   */
  downloadFile(content: string, filename: string, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
