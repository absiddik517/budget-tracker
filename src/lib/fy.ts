import { isValidYmd, todayYmd } from './dates';

/**
 * Fiscal year runs 1 July to 30 June, e.g. "2025-26".
 * 2025-07-01 .. 2026-06-30 => "2025-26"
 */
export function deriveFiscalYear(ymd: string): string {
  if (!isValidYmd(ymd)) {
    return getCurrentFiscalYear();
  }
  const [yearStr, monthStr] = ymd.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const startYear = month >= 7 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYearShort}`;
}

export function getCurrentFiscalYear(): string {
  const today = todayYmd();
  const [yearStr, monthStr] = today.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const startYear = month >= 7 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYearShort}`;
}

export function isValidFiscalYear(fy: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(fy.trim());
  if (!match) return false;
  const startYear = parseInt(match[1], 10);
  const endShort = parseInt(match[2], 10);
  return (startYear + 1) % 100 === endShort;
}

export function getFiscalYearBounds(fy: string): { start: string; end: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(fy.trim());
  if (!match) {
    const cur = getCurrentFiscalYear();
    return getFiscalYearBounds(cur);
  }
  const startYear = parseInt(match[1], 10);
  const endYear = startYear + 1;
  return {
    start: `${startYear}-07-01`,
    end: `${endYear}-06-30`,
  };
}

export function isDateInFiscalYear(ymd: string, fy: string): boolean {
  if (!isValidYmd(ymd) || !isValidFiscalYear(fy)) return false;
  const { start, end } = getFiscalYearBounds(fy);
  return ymd >= start && ymd <= end;
}

export function getNextFiscalYear(fy: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(fy.trim());
  if (!match) return getCurrentFiscalYear();
  const startYear = parseInt(match[1], 10) + 1;
  const endShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endShort}`;
}
