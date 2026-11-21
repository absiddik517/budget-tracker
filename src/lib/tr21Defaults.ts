import { toBanglaDigits } from './banglaFormat';
import type { CertificationClause, Tr21Margins, Tr21P1S3Mode } from '../types';

export const DEFAULT_INSTITUTIONAL_CODE = '1240303000000';
export const DEFAULT_NET_PAYABLE_CODE = '8172108';
export const DEFAULT_IT_CODE = '1111101';
export const DEFAULT_VAT_CODE = '1141101';
export const DEFAULT_SECURITY_CODE = '8113301';
export const DEFAULT_TR21_FOOTER_TEXT = 'Print By: Budget Tracker';
export const DEFAULT_TR21_FONT_FAMILY = 'NikoshBAN';
export const DEFAULT_TR21_FONT_SIZE = 11;
export const DEFAULT_TR21_P1S3_MODE: Tr21P1S3Mode = 'items';
export const DEFAULT_TR21_VOUCHER_LABEL = '';
export const DEFAULT_TR21_MARGINS: Tr21Margins = {
  top: 0.35,
  right: 0.4,
  bottom: 0.3,
  left: 0.4,
};

const TR21_MARGINS_LABEL_PREFIX = '__margins__:';

export function clampTr21Margin(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(2.5, Math.max(0, Number(num.toFixed(2))));
}

export function serializeTr21MarginsToLabel(margins: Tr21Margins): string {
  const top = clampTr21Margin(margins.top, DEFAULT_TR21_MARGINS.top);
  const right = clampTr21Margin(margins.right, DEFAULT_TR21_MARGINS.right);
  const bottom = clampTr21Margin(margins.bottom, DEFAULT_TR21_MARGINS.bottom);
  const left = clampTr21Margin(margins.left, DEFAULT_TR21_MARGINS.left);
  return `${TR21_MARGINS_LABEL_PREFIX}${top},${right},${bottom},${left}`;
}

export function resolveTr21Margins(
  margins?: Partial<Tr21Margins> | null,
  encodedLabel?: string | null
): Tr21Margins {
  if (
    margins &&
    (margins.top !== undefined ||
      margins.right !== undefined ||
      margins.bottom !== undefined ||
      margins.left !== undefined)
  ) {
    return {
      top: clampTr21Margin(margins.top, DEFAULT_TR21_MARGINS.top),
      right: clampTr21Margin(margins.right, DEFAULT_TR21_MARGINS.right),
      bottom: clampTr21Margin(margins.bottom, DEFAULT_TR21_MARGINS.bottom),
      left: clampTr21Margin(margins.left, DEFAULT_TR21_MARGINS.left),
    };
  }
  const raw = (encodedLabel || '').trim();
  if (raw.startsWith(TR21_MARGINS_LABEL_PREFIX)) {
    const parts = raw.slice(TR21_MARGINS_LABEL_PREFIX.length).split(',');
    if (parts.length === 4) {
      return {
        top: clampTr21Margin(parts[0], DEFAULT_TR21_MARGINS.top),
        right: clampTr21Margin(parts[1], DEFAULT_TR21_MARGINS.right),
        bottom: clampTr21Margin(parts[2], DEFAULT_TR21_MARGINS.bottom),
        left: clampTr21Margin(parts[3], DEFAULT_TR21_MARGINS.left),
      };
    }
  }
  return { ...DEFAULT_TR21_MARGINS };
}

export function resolveTr21P1S3Mode(_value?: string | null): Tr21P1S3Mode {
  return 'items';
}

export function resolveTr21VoucherLabel(value?: string | null): string {
  return (value || '').trim();
}

export interface Tr21FontOption {
  value: string;
  label: string;
  cssStack: string;
}

export const TR21_FONT_OPTIONS: Tr21FontOption[] = [
  {
    value: 'NikoshBAN',
    label: 'NikoshBAN (ডিফল্ট)',
    cssStack: "'NikoshBAN', 'Nikosh', 'Noto Sans Bengali', sans-serif",
  },
  {
    value: 'Nikosh',
    label: 'Nikosh',
    cssStack: "'Nikosh', 'NikoshBAN', 'Noto Sans Bengali', sans-serif",
  },
  {
    value: 'Noto Sans Bengali',
    label: 'Noto Sans Bengali',
    cssStack: "'Noto Sans Bengali', 'NikoshBAN', 'Nikosh', sans-serif",
  },
  {
    value: 'Kalpurush',
    label: 'Kalpurush',
    cssStack: "'Kalpurush', 'NikoshBAN', 'Noto Sans Bengali', sans-serif",
  },
  {
    value: 'SolaimanLipi',
    label: 'SolaimanLipi',
    cssStack: "'SolaimanLipi', 'NikoshBAN', 'Noto Sans Bengali', sans-serif",
  },
];

export const TR21_FONT_SIZE_OPTIONS = [9, 10, 11, 12, 13, 14] as const;

export function resolveTr21FontFamily(value?: string | null): string {
  const trimmed = (value || '').trim();
  const match = TR21_FONT_OPTIONS.find((opt) => opt.value === trimmed);
  return match ? match.value : DEFAULT_TR21_FONT_FAMILY;
}

export function resolveTr21FontCss(value?: string | null): string {
  const trimmed = (value || '').trim();
  const match = TR21_FONT_OPTIONS.find((opt) => opt.value === trimmed);
  return match ? match.cssStack : TR21_FONT_OPTIONS[0].cssStack;
}

export function resolveTr21FontSize(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_TR21_FONT_SIZE;
  }
  return Math.min(16, Math.max(8, Math.round(value)));
}

export const DEFAULT_TR21_CLAUSES: CertificationClause[] = [
  {
    id: '1',
    numberBn: '১',
    page: 1,
    enabled: true,
    text: 'প্রত্যয়ন করা যাইতেছে যে, জনস্বার্থে এই ব্যয় অপরিহার্য ছিল। আমি আরও প্রত্যয়ন করিতেছি যে, আমার জ্ঞান ও বিশ্বাস মতে, এই বিলে উল্লিখিত প্রদত্ত অর্থ নিম্নবর্ণিত ক্ষেত্র ব্যতীত প্রকৃত প্রাপককে প্রদান করা হইয়াছে, তবে স্থায়ী অগ্রিমের টাকা অপেক্ষা দায় বেশী হওয়ায়, অবশিষ্ট পাওনা এই বিলে দাবিকৃত টাকা প্রাপ্তির পর প্রদান করা হইবে। আমি যথাসম্ভব সকল ভাউচার গ্রহণ করিয়াছি এবং সেগুলি এমনভাবে বাতিল করা হইয়াছে যেন পুনরায় ব্যবহার করা না যায়। ২৫ টাকার উর্ধ্বের সকল ভাউচারসমূহ এমনভাবে সংরক্ষণ করা হইয়াছে, যেন প্রয়োজনমত ৩ বৎসরের মধ্যে এইগুলি পেশ করা যায়। সকল পূর্তকর্মের বিল সঙ্গে সংযুক্ত করা হইল।',
  },
  {
    id: '2',
    numberBn: '২',
    page: 1,
    enabled: true,
    text: 'প্রত্যয়ন করা যাইতেছে যে, যে সকল দ্রব্যের জন্য স্টোর একাউন্টস সংরক্ষণ করা হয় সে সব দ্রব্যাদি স্টক রেজিস্টারে অন্তর্ভুক্ত করা হইয়াছে।',
  },
  {
    id: '3',
    numberBn: '৩',
    page: 1,
    enabled: true,
    text: 'প্রত্যয়ন করা যাইতেছে যে, যে সব দ্রব্যাদি ক্রয়ের বিল পেশ করা হইয়াছে, সে সব দ্রব্যের পরিমাণ সঠিক, গুণগতমান ভাল, যে দরে ক্রয় করা হইয়াছে, তাহা বাজার দরের অধিক নহে এবং কার্যাদেশ বা চালান (ইনভয়েস) এর যথাস্থানে লিপিবদ্ধ করা হইয়াছে। যাহাতে একই দ্রব্যের জন্য দ্বিতীয় বার (ডুপ্লিকেট) অর্থ প্রদান এড়ানো যায়।',
  },
  {
    id: '4',
    numberBn: '৪',
    page: 1,
    enabled: true,
    text: 'প্রত্যয়ন করা যাইতেছে যে-\n(ক) এই বিলে দাবিকৃত পরিবহন ভাড়া প্রকৃতপক্ষে দেওয়া হইয়াছে এবং ইহা অপরিহার্য ছিল এবং ভাড়ার হার প্রচলিত যানবাহন ভাড়ার হারের মধ্যেই; এবং\n(খ) সংশ্লিষ্ট সরকারী কর্মচারী সাধারণ বিধিবলে এই ভ্রমণের জন্য ভ্রমণ ব্যয় প্রাপ্য হন না, এবং এর অতিরিক্ত কোন বিশেষ পারিশ্রমিক, এই দায়িত্ব পালনের জন্য প্রাপ্য হইবেন না।',
  },
  {
    id: '5',
    numberBn: '৫',
    page: 2,
    enabled: true,
    text: 'প্রত্যয়ন করা যাইতেছে যে, যে সকল অধঃস্তন কর্মচারীর বেতন এই বিলে দাবী করা হইয়াছে তাহারা এই সময়ে প্রকৃতই সরকারী কাজে নিয়োজিত ছিলেন (এস, আর, ১৭১)।',
  },
  {
    id: '6',
    numberBn: '৬',
    page: 2,
    enabled: true,
    text: 'প্রত্যয়ন করা যাইতেছে যে-\n(ক) মনোহারী দ্রব্য বা স্ট্যাম্প বাবদ ২০ টাকা অধিক কোন ক্রয় স্থানীয়ভাবে করা হয় নাই।\n(খ) ব্যক্তিগত কাজে ব্যবহৃত তাঁবু বহনের কোন খরচ এই বিলে অন্তর্ভুক্ত করা হয় নাই।\n(গ) আবাসিক ভবনে ব্যবহৃত কোন বিদ্যুৎ বাবদ খরচ এই বিলে অন্তর্ভুক্ত হয় নাই।\n(ঘ) এই বৎসরে প্রসেস সার্ভারদের প্রদত্ত পারিতোষিক টাকা ................................. (যা গত ৩ বৎসরের জরিমানা বাবদ প্রাপ্তির গড় টাকার অপেক্ষা অধিক হইবে না)।',
  },
  {
    id: '7',
    numberBn: '৭',
    page: 2,
    enabled: true,
    text: 'যাহার নামে ইস্যু করা হইবে (প্রযোজ্য ক্ষেত্রে): {{payeeText}}',
  },
];

export function cloneDefaultTr21Clauses(): CertificationClause[] {
  return DEFAULT_TR21_CLAUSES.map((c) => ({ ...c }));
}

export function resolveTr21Clauses(saved?: CertificationClause[] | null): CertificationClause[] {
  if (!Array.isArray(saved) || saved.length === 0) {
    return cloneDefaultTr21Clauses();
  }
  // Automatically upgrade legacy 12-clause unedited template (where 6-10 mirrored 1-5)
  if (
    saved.length === 12 &&
    saved[11]?.id === '12' &&
    saved[5]?.text === saved[0]?.text
  ) {
    const legacyPayeeText = saved[11]?.text || '';
    const fresh = cloneDefaultTr21Clauses();
    if (legacyPayeeText && !legacyPayeeText.includes('যার নামে চেক ইস্যু করা হবে')) {
      fresh[6].text = legacyPayeeText;
    }
    return fresh;
  }
  return saved.map((c, idx) => ({
    id: String(c.id || idx + 1),
    numberBn: c.numberBn || DEFAULT_TR21_CLAUSES[idx]?.numberBn || toBanglaDigits(idx + 1),
    page: c.page === 2 ? 2 : 1,
    enabled: c.enabled !== false,
    text: String(c.text || ''),
  }));
}
