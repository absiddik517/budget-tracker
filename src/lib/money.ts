const inFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 0,
});

const inDecimalFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Convert a taka string or number (up to 2 decimals) into integer paisa.
 * Avoids floating-point rounding bugs via string splitting.
 */
export function toPaisa(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return 0;
    return Math.round(input * 100);
  }
  const cleaned = input.replace(/[,\s৳]/g, '').trim();
  if (!cleaned || cleaned === '-') return 0;
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return NaN;
  const sign = match[1] ? -1 : 1;
  const whole = match[2] ? parseInt(match[2], 10) : 0;
  const fracRaw = match[3] || '';
  const fracPadded = (fracRaw + '00').slice(0, 2);
  const frac = parseInt(fracPadded, 10);
  return sign * (whole * 100 + frac);
}

export function fromPaisa(paisa: number): number {
  return paisa / 100;
}

export function formatPaisaInput(paisa: number): string {
  if (!Number.isFinite(paisa)) return '0';
  const sign = paisa < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paisa));
  const whole = Math.floor(abs / 100);
  const rem = abs % 100;
  if (rem === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(rem).padStart(2, '0')}`;
}

export function formatNumberIN(paisa: number): string {
  const safe = Number.isFinite(paisa) ? Math.round(paisa) : 0;
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  const taka = abs / 100;
  if (abs % 100 === 0) {
    return `${sign}${inFormatter.format(taka)}`;
  }
  return `${sign}${inDecimalFormatter.format(taka)}`;
}

export function formatTaka(paisa: number): string {
  const safe = Number.isFinite(paisa) ? Math.round(paisa) : 0;
  if (safe < 0) {
    return `-৳ ${formatNumberIN(Math.abs(safe))}`;
  }
  return `৳ ${formatNumberIN(safe)}`;
}

export function calcPercentageAmount(grossPaisa: number, ratePercent: number): number {
  if (!Number.isFinite(grossPaisa) || !Number.isFinite(ratePercent)) return 0;
  return Math.round((grossPaisa * ratePercent) / 100);
}
