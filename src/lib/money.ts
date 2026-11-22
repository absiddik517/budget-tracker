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

export interface GrossUpDeductionInput {
  id: string;
  code: string;
  name: string;
  rate?: number | null;
  amount: number;
  kind?: 'it' | 'vat' | 'security' | 'other';
}

export interface ComputedDeductionLine {
  id: string;
  code: string;
  name: string;
  rate: number | null;
  amount: number;
  kind: 'it' | 'vat' | 'security' | 'other';
}

/**
 * Gross-up formula:
 *   Gross = ((NetExpense + FixedDeductions) * 100) / (100 - TotalPercentRate)
 * Example: Expense = 500, VAT = 5%, IT = 10% -> (500 * 100) / (100 - 15) = 588.24
 */
export function calcGrossFromNetExpense(
  netExpensePaisa: number,
  totalPercentRate: number,
  fixedDeductionsPaisa = 0
): number {
  if (
    !Number.isFinite(netExpensePaisa) ||
    !Number.isFinite(totalPercentRate) ||
    !Number.isFinite(fixedDeductionsPaisa)
  ) {
    return 0;
  }
  const safeRate = Math.max(0, totalPercentRate);
  if (safeRate >= 100) {
    throw new Error('মোট কর্তনের হার ১০০% বা তার বেশি হতে পারে না।');
  }
  const base =
    Math.max(0, Math.round(netExpensePaisa)) + Math.max(0, Math.round(fixedDeductionsPaisa));
  if (base <= 0) return 0;
  if (safeRate === 0) return base;
  return Math.round((base * 100) / (100 - safeRate));
}

export function computeGrossedUpBill(params: {
  expenseTotalPaisa: number;
  vatRate: number;
  itRate: number;
  customDeductions?: GrossUpDeductionInput[];
  defaultItCode?: string;
  defaultVatCode?: string;
}): {
  expenseTotal: number;
  grossAmount: number;
  deductions: ComputedDeductionLine[];
  vatAmount: number;
  itAmount: number;
  totalDeduction: number;
  netPayable: number;
  effectiveVatRate: number;
  effectiveItRate: number;
  totalPercentRate: number;
} {
  const expenseTotal = Math.max(0, Math.round(params.expenseTotalPaisa || 0));
  const rawList: GrossUpDeductionInput[] =
    Array.isArray(params.customDeductions) && params.customDeductions.length > 0
      ? params.customDeductions
      : [
          {
            id: 'it',
            code: params.defaultItCode || '1111101',
            name: 'ব্যক্তি কর্তৃক দেয় আয়কর',
            rate: Math.max(0, Number.isFinite(params.itRate) ? params.itRate : 0),
            amount: 0,
            kind: 'it',
          },
          {
            id: 'vat',
            code: params.defaultVatCode || '1141101',
            name: 'দেশজ পণ্য ও সেবার ওপর মূসক',
            rate: Math.max(0, Number.isFinite(params.vatRate) ? params.vatRate : 0),
            amount: 0,
            kind: 'vat',
          },
        ];

  let totalPercentRate = 0;
  let fixedDeductionsPaisa = 0;

  for (const d of rawList) {
    if (typeof d.rate === 'number' && Number.isFinite(d.rate) && d.rate >= 0) {
      totalPercentRate += d.rate;
    } else {
      fixedDeductionsPaisa += Math.max(0, Math.round(d.amount || 0));
    }
  }

  const grossAmount = calcGrossFromNetExpense(
    expenseTotal,
    totalPercentRate,
    fixedDeductionsPaisa
  );

  const deductions: ComputedDeductionLine[] = rawList.map((d, idx) => {
    const hasRate = typeof d.rate === 'number' && Number.isFinite(d.rate) && d.rate >= 0;
    const rateVal = hasRate ? d.rate! : null;
    const amountVal = hasRate
      ? rateVal! > 0
        ? calcPercentageAmount(grossAmount, rateVal!)
        : 0
      : Math.max(0, Math.round(d.amount || 0));
    return {
      id: d.id || `ded_${idx + 1}`,
      code: (d.code || '').trim(),
      name: (d.name || '').trim(),
      rate: rateVal,
      amount: amountVal,
      kind: d.kind || 'other',
    };
  });

  const itLines = deductions.filter((d) => d.kind === 'it');
  const vatLines = deductions.filter((d) => d.kind === 'vat');
  const itAmount = itLines.reduce((sum, d) => sum + d.amount, 0);
  const vatAmount = vatLines.reduce((sum, d) => sum + d.amount, 0);
  const totalDeduction = deductions.reduce((sum, d) => sum + d.amount, 0);
  const netPayable = grossAmount - totalDeduction;

  return {
    expenseTotal,
    grossAmount,
    deductions,
    vatAmount,
    itAmount,
    totalDeduction,
    netPayable,
    effectiveVatRate: vatLines[0]?.rate ?? params.vatRate,
    effectiveItRate: itLines[0]?.rate ?? params.itRate,
    totalPercentRate,
  };
}

export interface CalcProductInput {
  id?: string;
  name?: string;
  amount: number; // integer paisa
  by: 'x' | 'y';
  vatRate: number;
  itRate: number;
}

export interface ComputedProductAmounts {
  id: string;
  name: string;
  actualAmount: number; // x (integer paisa)
  voucherAmount: number; // y (integer paisa)
  vatRate: number;
  itRate: number;
  vatAmount: number; // integer paisa
  itAmount: number; // integer paisa
  deductionAmount: number; // integer paisa (vatAmount + itAmount)
  lastEditedField: 'x' | 'y';
}

export function normalizeProductName(name: string): string {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Firestore-safe document ID for offices/{officeId}/productRates/{rateKey}.
 * Preserves readable Unicode characters while replacing '/' and guarding '.' / '..'.
 */
export function normalizeProductRateKey(name: string): string {
  const norm = normalizeProductName(name).replace(/\//g, '_');
  if (!norm) return '';
  const guarded = norm === '.' || norm === '..' ? `_${norm}` : norm;
  return guarded.slice(0, 240);
}

/**
 * Per-product forward & reverse VAT+IT math (integer paisa):
 *  - z = v + t
 *  - x-driven: vat = round(x * v / 100), it = round(x * t / 100), d = vat + it, y = x + d
 *  - y-driven: x = round(y * 100 / (100 + z)), d = y - x, vat = z > 0 ? round(d * v / z) : 0, it = d - vat
 */
export function calcProduct(params: CalcProductInput): ComputedProductAmounts {
  const v = Number(params.vatRate);
  const t = Number(params.itRate);
  if (!Number.isFinite(v) || v < 0 || v > 100) {
    throw new Error('ভ্যাট হার ০ থেকে ১০০% এর মধ্যে হতে হবে।');
  }
  if (!Number.isFinite(t) || t < 0 || t > 100) {
    throw new Error('আয়কর হার ০ থেকে ১০০% এর মধ্যে হতে হবে।');
  }
  const rawAmt = Number(params.amount);
  if (!Number.isFinite(rawAmt) || Math.round(rawAmt) <= 0) {
    throw new Error('পণ্যের টাকার পরিমাণ শূন্যের বেশি হতে হবে।');
  }

  const z = v + t;
  let actualAmount: number;
  let voucherAmount: number;
  let vatAmount: number;
  let itAmount: number;
  let deductionAmount: number;

  if (params.by === 'y') {
    voucherAmount = Math.round(rawAmt);
    actualAmount = Math.round((voucherAmount * 100) / (100 + z));
    if (actualAmount <= 0) {
      throw new Error('পণ্যের প্রকৃত খরচ শূন্যের বেশি হতে হবে।');
    }
    deductionAmount = voucherAmount - actualAmount;
    vatAmount = z > 0 ? Math.round((deductionAmount * v) / z) : 0;
    itAmount = deductionAmount - vatAmount;
  } else {
    actualAmount = Math.round(rawAmt);
    vatAmount = Math.round((actualAmount * v) / 100);
    itAmount = Math.round((actualAmount * t) / 100);
    deductionAmount = vatAmount + itAmount;
    voucherAmount = actualAmount + deductionAmount;
  }

  return {
    id: params.id || '',
    name: (params.name || '').trim(),
    actualAmount,
    voucherAmount,
    vatRate: v,
    itRate: t,
    vatAmount,
    itAmount,
    deductionAmount,
    lastEditedField: params.by,
  };
}

export function sumProducts(
  products: ReadonlyArray<{
    actualAmount: number;
    voucherAmount: number;
    vatAmount: number;
    itAmount: number;
    deductionAmount: number;
  }>
): {
  baseTotal: number;
  vatTotal: number;
  itTotal: number;
  deductionTotal: number;
  voucherTotal: number;
} {
  let baseTotal = 0;
  let vatTotal = 0;
  let itTotal = 0;
  let deductionTotal = 0;
  let voucherTotal = 0;
  for (const p of products) {
    baseTotal += Math.round(p.actualAmount || 0);
    vatTotal += Math.round(p.vatAmount || 0);
    itTotal += Math.round(p.itAmount || 0);
    deductionTotal += Math.round(p.deductionAmount || 0);
    voucherTotal += Math.round(p.voucherAmount || 0);
  }
  return {
    baseTotal,
    vatTotal,
    itTotal,
    deductionTotal,
    voucherTotal,
  };
}

export function aggregateDeductions(
  products: ReadonlyArray<{
    vatRate: number;
    itRate: number;
    vatAmount: number;
    itAmount: number;
  }>,
  opts?: {
    itCode?: string;
    vatCode?: string;
  }
): ComputedDeductionLine[] {
  const itByRate = new Map<number, number>();
  const vatByRate = new Map<number, number>();

  for (const p of products) {
    const itAmt = Math.round(p.itAmount || 0);
    if (itAmt > 0) {
      const r = Number.isFinite(p.itRate) ? p.itRate : 0;
      itByRate.set(r, (itByRate.get(r) || 0) + itAmt);
    }
    const vatAmt = Math.round(p.vatAmount || 0);
    if (vatAmt > 0) {
      const r = Number.isFinite(p.vatRate) ? p.vatRate : 0;
      vatByRate.set(r, (vatByRate.get(r) || 0) + vatAmt);
    }
  }

  const lines: ComputedDeductionLine[] = [];
  const itCode = (opts?.itCode || '1111101').trim() || '1111101';
  const vatCode = (opts?.vatCode || '1141101').trim() || '1141101';

  const sortedItRates = Array.from(itByRate.keys()).sort((a, b) => b - a);
  for (const rate of sortedItRates) {
    const amount = itByRate.get(rate) || 0;
    if (amount <= 0) continue;
    lines.push({
      id: `it_${String(rate).replace(/\./g, '_')}`,
      code: itCode,
      name: 'ব্যক্তি কর্তৃক দেয় আয়কর',
      rate,
      amount,
      kind: 'it',
    });
  }

  const sortedVatRates = Array.from(vatByRate.keys()).sort((a, b) => b - a);
  for (const rate of sortedVatRates) {
    const amount = vatByRate.get(rate) || 0;
    if (amount <= 0) continue;
    lines.push({
      id: `vat_${String(rate).replace(/\./g, '_')}`,
      code: vatCode,
      name: 'দেশজ পণ্য ও সেবার ওপর মূসক',
      rate,
      amount,
      kind: 'vat',
    });
  }

  return lines;
}

