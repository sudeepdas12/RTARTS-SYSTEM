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

export function formatNepaliDate(date: Date | string): string {
  const resolved = typeof date === 'string' ? new Date(date) : date;
  return new NepaliDate(resolved).format('DD MMMM YYYY', 'np');
}

export function bsDateToAdDate(bsDate: string): Date | null {
  if (!bsDate) return null;
  try {
    return new NepaliDate(bsDate).toJsDate();
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
