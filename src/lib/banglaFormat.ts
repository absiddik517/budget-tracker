const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'] as const;

const BN_MONTHS = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
] as const;

const ONES_AND_TENS_BN: string[] = [
  'শূন্য',
  'এক',
  'দুই',
  'তিন',
  'চার',
  'পাঁচ',
  'ছয়',
  'সাত',
  'আট',
  'নয়',
  'দশ',
  'এগারো',
  'বারো',
  'তেরো',
  'চৌদ্দ',
  'পনেরো',
  'ষোলো',
  'সতেরো',
  'আঠারো',
  'উনিশ',
  'বিশ',
  'একুশ',
  'বাইশ',
  'তেইশ',
  'চব্বিশ',
  'পঁচিশ',
  'ছাব্বিশ',
  'সাতাশ',
  'আটাশ',
  'ঊনত্রিশ',
  'ত্রিশ',
  'একত্রিশ',
  'বত্রিশ',
  'তেত্রিশ',
  'চৌত্রিশ',
  'পঁয়ত্রিশ',
  'ছত্রিশ',
  'সাঁইত্রিশ',
  'আটত্রিশ',
  'ঊনচল্লিশ',
  'চল্লিশ',
  'একচল্লিশ',
  'বিয়াল্লিশ',
  'তেতাল্লিশ',
  'চুয়াল্লিশ',
  'পঁয়তাল্লিশ',
  'ছেচল্লিশ',
  'সাতচল্লিশ',
  'আটচল্লিশ',
  'ঊনপঞ্চাশ',
  'পঞ্চাশ',
  'একান্ন',
  'বায়ান্ন',
  'তিপ্পান্ন',
  'চুয়ান্ন',
  'পঞ্চান্ন',
  'ছাপ্পান্ন',
  'সাতান্ন',
  'আটান্ন',
  'ঊনষাট',
  'ষাট',
  'একষট্টি',
  'বাষট্টি',
  'তেষট্টি',
  'চৌষট্টি',
  'পঁয়ষট্টি',
  'ছেষট্টি',
  'সাতষট্টি',
  'আটষট্টি',
  'ঊনসত্তর',
  'সত্তর',
  'একাত্তর',
  'বাহাত্তর',
  'তিয়াত্তর',
  'চুয়াত্তর',
  'পঁচাত্তর',
  'ছিয়াত্তর',
  'সাতাত্তর',
  'আটাত্তর',
  'ঊনআশি',
  'আশি',
  'একাশি',
  'বিরাশি',
  'তিরাশি',
  'চুরাশি',
  'পঁচাশি',
  'ছিয়াশি',
  'সাতাশি',
  'আটাশি',
  'ঊননব্বই',
  'নব্বই',
  'একানব্বই',
  'বিরানব্বই',
  'তিরানব্বই',
  'চুরানব্বই',
  'পঁচানব্বই',
  'ছিয়ানব্বই',
  'সাতানব্বই',
  'আটানব্বই',
  'নিরানব্বই',
];

export function toBanglaDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => BN_DIGITS[Number(d)] ?? d);
}

export function formatIndianGroupingAscii(intValue: number): string {
  const safe = Number.isFinite(intValue) ? Math.trunc(intValue) : 0;
  const sign = safe < 0 ? '-' : '';
  const absStr = String(Math.abs(safe));
  if (absStr.length <= 3) return `${sign}${absStr}`;
  const lastThree = absStr.slice(-3);
  const rest = absStr.slice(0, -3);
  const groupedRest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}${groupedRest},${lastThree}`;
}

/**
 * Formats integer Taka (NOT paisa) with Bangladeshi/Indian comma grouping in Bangla digits.
 * Example: 54700 -> "৫৪,৭০০", 123456 -> "১,২৩,৪৫৬".
 */
export function formatBanglaGroupedInt(takaInt: number): string {
  return toBanglaDigits(formatIndianGroupingAscii(takaInt));
}

/**
 * Splits integer paisa into Bangla Taka string (with "/-") and Bangla Paisa string.
 * Whole-taka amounts return empty paisaStr ("") to match T.R. Form 21 conventions unless showZeroPaisa is true.
 */
export function splitPaisaForTr21(
  paisa: number,
  options?: { blankWhenZero?: boolean; showZeroPaisa?: boolean }
): { takaStr: string; paisaStr: string } {
  const safe = Number.isFinite(paisa) ? Math.round(paisa) : 0;
  if (safe === 0 && options?.blankWhenZero) {
    return { takaStr: '', paisaStr: '' };
  }
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  const takaInt = Math.floor(abs / 100);
  const remPaisa = abs % 100;

  const takaStr = `${sign}${formatBanglaGroupedInt(takaInt)}/-`;
  let paisaStr = '';
  if (remPaisa > 0) {
    paisaStr = toBanglaDigits(String(remPaisa).padStart(2, '0'));
  } else if (options?.showZeroPaisa) {
    paisaStr = '০০';
  }
  return { takaStr, paisaStr };
}

/**
 * Converts a non-negative integer (< 10^14) into Bangla words using Bangladeshi
 * কোটি / লক্ষ / হাজার / শত grouping.
 */
export function integerToBanglaWords(num: number): string {
  if (!Number.isFinite(num)) return ONES_AND_TENS_BN[0];
  const n = Math.floor(Math.abs(num));
  if (n === 0) return ONES_AND_TENS_BN[0];

  const convertBelowCrore = (val: number): string => {
    const parts: string[] = [];
    let rem = val;

    const lakh = Math.floor(rem / 100000);
    if (lakh > 0) {
      parts.push(`${ONES_AND_TENS_BN[lakh]} লক্ষ`);
      rem %= 100000;
    }

    const thousand = Math.floor(rem / 1000);
    if (thousand > 0) {
      parts.push(`${ONES_AND_TENS_BN[thousand]} হাজার`);
      rem %= 1000;
    }

    const hundred = Math.floor(rem / 100);
    if (hundred > 0) {
      parts.push(`${ONES_AND_TENS_BN[hundred]}শত`);
      rem %= 100;
    }

    if (rem > 0) {
      parts.push(ONES_AND_TENS_BN[rem]);
    }

    return parts.join(' ');
  };

  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const rem = n % 10000000;

  if (crore > 0) {
    const croreWords = crore >= 100 ? integerToBanglaWords(crore) : ONES_AND_TENS_BN[crore];
    parts.push(`${croreWords} কোটি`);
  }
  if (rem > 0) {
    parts.push(convertBelowCrore(rem));
  }

  return parts.join(' ').trim();
}

/**
 * Converts integer paisa into standard Bangladeshi official bill wording.
 * Example: 5890000 (৳ 58,900) -> "আটান্ন হাজার নয়শত টাকা মাত্র"
 */
export function paisaToBanglaWords(paisa: number): string {
  const safe = Number.isFinite(paisa) ? Math.round(paisa) : 0;
  const prefix = safe < 0 ? 'ঋণাত্মক ' : '';
  const abs = Math.abs(safe);
  const taka = Math.floor(abs / 100);
  const remPaisa = abs % 100;

  const takaWords = `${integerToBanglaWords(taka)} টাকা`;
  if (remPaisa > 0) {
    return `${prefix}${takaWords} ${integerToBanglaWords(remPaisa)} পয়সা মাত্র`;
  }
  return `${prefix}${takaWords} মাত্র`;
}

/**
 * Formats YYYY-MM-DD as "২৩ অক্টোবর ২০২৫"
 */
export function formatBanglaLongDate(ymd?: string | null): string {
  if (!ymd) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return toBanglaDigits(ymd);
  const year = toBanglaDigits(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const day = toBanglaDigits(Number(m[3]));
  const monthName = BN_MONTHS[monthIdx] || toBanglaDigits(m[2]);
  return `${day} ${monthName} ${year}`;
}

/**
 * Formats YYYY-MM-DD as "১৫/১২/২০২৫ খ্রি."
 */
export function formatBanglaShortDate(ymd?: string | null): string {
  if (!ymd) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return toBanglaDigits(ymd);
  return `${toBanglaDigits(m[3])}/${toBanglaDigits(m[2])}/${toBanglaDigits(m[1])} খ্রি.`;
}

/**
 * "2025-26" -> "২৫-২৬"
 */
export function formatFyShortBn(fy: string): string {
  const trimmed = (fy || '').trim();
  const m = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (m) {
    return toBanglaDigits(`${m[1].slice(2)}-${m[2]}`);
  }
  return toBanglaDigits(trimmed);
}
