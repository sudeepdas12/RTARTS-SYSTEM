import NepaliDate from 'nepali-date-converter';

export const NEPALI_MONTHS = [
  'Baisakh',
  'Jestha',
  'Asar',
  'Shrawan',
  'Bhadra',
  'Ashwin',
  'Kartik',
  'Mangsir',
  'Poush',
  'Magh',
  'Falgun',
  'Chaitra',
];

export const NEPALI_QUARTERS = [
  { id: 'q1', label: 'Q1 · Baisakh to Asar', startMonth: 0, endMonth: 2 },
  { id: 'q2', label: 'Q2 · Shrawan to Ashwin', startMonth: 3, endMonth: 5 },
  { id: 'q3', label: 'Q3 · Kartik to Poush', startMonth: 6, endMonth: 8 },
  { id: 'q4', label: 'Q4 · Magh to Chaitra', startMonth: 9, endMonth: 11 },
] as const;

export type NepaliQuarterId = (typeof NEPALI_QUARTERS)[number]['id'];

export function getCurrentNepaliYear(): number {
  return new NepaliDate().getYear();
}

/** Formats a date in Nepali Devanagari script (e.g. ४ भदौ २०८३) */
export function formatNepaliDate(date: Date | string): string {
  if (!date) return '';
  const resolved = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(resolved.getTime())) return String(date);
  return new NepaliDate(resolved).format('DD MMMM YYYY', 'np');
}

/** Formats a date in English BS script (e.g. 04 Bhadra 2083 BS) */
export function formatNepaliDateEn(date: Date | string): string {
  if (!date) return '';
  const resolved = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(resolved.getTime())) return String(date);
  const nd = new NepaliDate(resolved);
  const day = String(nd.getDate()).padStart(2, '0');
  const month = NEPALI_MONTHS[nd.getMonth()] || '';
  const year = nd.getYear();
  return `${day} ${month} ${year} BS`;
}

/** Formats date into standard ISO-like BS date string YYYY-MM-DD (e.g. 2081-04-15) */
export function adDateToBsString(date: Date | string): string {
  if (!date) return '';
  const resolved = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(resolved.getTime())) return '';
  const nd = new NepaliDate(resolved);
  const y = nd.getYear();
  const m = String(nd.getMonth() + 1).padStart(2, '0');
  const d = String(nd.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Calculates the current or date-specific Nepali Fiscal Year (e.g. '2081/82') */
export function getNepaliFiscalYear(date?: Date | string): string {
  const resolved = date ? (typeof date === 'string' ? new Date(date) : date) : new Date();
  const nd = new NepaliDate(resolved);
  const bsYear = nd.getYear();
  const bsMonth = nd.getMonth(); // 0 = Baisakh, 3 = Shrawan

  // In Nepal, Fiscal Year starts 1st Shrawan (Month index 3)
  if (bsMonth >= 3) {
    const nextShort = String((bsYear + 1) % 100).padStart(2, '0');
    return `${bsYear}/${nextShort}`;
  } else {
    const prevYear = bsYear - 1;
    const currShort = String(bsYear % 100).padStart(2, '0');
    return `${prevYear}/${currShort}`;
  }
}

/** Converts BS string (e.g. '2081-04-15' or '2081/04/15') to JavaScript Date (AD) */
export function bsDateToAdDate(bsDate: string): Date | null {
  if (!bsDate) return null;
  try {
    const sanitized = bsDate.replace(/\//g, '-').trim();
    return new NepaliDate(sanitized).toJsDate();
  } catch {
    return null;
  }
}

export function bsComponentsToAdDate(year: number, monthIndex: number, date: number): Date | null {
  try {
    return new NepaliDate(year, monthIndex, date).toJsDate();
  } catch {
    return null;
  }
}

export function getBsMonthRange(bsYear: number, monthIndex: number): { startDate: Date; endDate: Date } {
  const startDate = new NepaliDate(bsYear, monthIndex, 1).toJsDate();
  const endDate = new NepaliDate(bsYear, monthIndex + 1, 1).toJsDate();
  endDate.setDate(endDate.getDate() - 1);
  return { startDate, endDate };
}

export function getBsMonthLength(bsYear: number, monthIndex: number): number {
  const { startDate, endDate } = getBsMonthRange(bsYear, monthIndex);
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
}

export function getBsQuarterRange(bsYear: number, quarterId: NepaliQuarterId): { startDate: Date; endDate: Date } {
  const quarter = NEPALI_QUARTERS.find((item) => item.id === quarterId) ?? NEPALI_QUARTERS[0];
  const endRange = getBsMonthRange(bsYear, quarter.endMonth);
  return {
    startDate: new NepaliDate(bsYear, quarter.startMonth, 1).toJsDate(),
    endDate: endRange.endDate,
  };
}
