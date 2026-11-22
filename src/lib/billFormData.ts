import {
  formatBanglaLongDate,
  formatBanglaPlainDate,
  formatFyShortBn,
  paisaToBanglaWords,
  splitPaisaForTr21,
  toBanglaDigits,
} from './banglaFormat';
import {
  DEFAULT_IT_CODE,
  DEFAULT_NET_PAYABLE_CODE,
  DEFAULT_SECURITY_CODE,
  DEFAULT_TR21_FOOTER_TEXT,
  DEFAULT_TR21_P1S3_INTRO_TEMPLATE,
  DEFAULT_VAT_CODE,
  resolveTr21Clauses,
  resolveTr21FontCss,
  resolveTr21FontFamily,
  resolveTr21FontSize,
  resolveTr21Margins,
} from './tr21Defaults';
import type {
  BillDeductionLine,
  BillDoc,
  BillSupplierInfo,
  BudgetDoc,
  CertificationClause,
  OfficeSettings,
  Tr21Margins,
  Tr21P1S3Mode,
} from '../types';

export interface Tr21ItemRow {
  indexBn: string;
  description: string;
  responsibleText: string;
  amountPaisa: number;
  takaStr: string;
  paisaStr: string;
}

export interface Tr21DeductionRow {
  id: string;
  code: string;
  codeBn: string;
  label: string;
  rate: number | null;
  amountPaisa: number;
  takaStr: string;
  paisaStr: string;
}

export interface Tr21AmountCell {
  amountPaisa: number | null;
  takaStr: string;
  paisaStr: string;
}

export interface Tr21FormData {
  billId: string;
  isDraft: boolean;
  status: BillDoc['status'];
  fiscalYear: string;
  fyBn: string;
  fyShortBn: string;
  ministryName: string;
  officeName: string;
  officeAddress: string;
  officeMobileNoBn: string;
  placeName: string;
  institutionalCodeRaw: string;
  institutionalCodeBoxes: string[]; // always 13 boxes
  institutionalCodeGroups: [string[], string[], string[], string[]]; // 1 - 4 - 4 - 4
  tokenNoBn: string;
  voucherNoBn: string;
  billDateYmd: string;
  billDateShortBn: string;
  economicCode: string;
  economicCodeBn: string;
  headName: string;
  headNameBn: string;
  memoNoBn: string;
  memoDateBn: string;
  purposeText: string;
  supplier: BillSupplierInfo | null;
  introText: string;
  p1s3Mode: Tr21P1S3Mode;
  voucherTitle: string;
  displayRows: Tr21ItemRow[];
  items: Tr21ItemRow[];
  gross: Tr21AmountCell;
  deductions: Tr21DeductionRow[];
  blankDeductionRowsCount: number;
  totalDeduction: Tr21AmountCell;
  netPayableCode: string;
  netPayableCodeBn: string;
  netPayable: Tr21AmountCell;
  netPayableInWords: string;
  payeeText: string;
  page1Clauses: CertificationClause[];
  page2Clauses: CertificationClause[];
  footerLeftText: string;
  fontFamily: string;
  fontFamilyCss: string;
  fontSize: number;
  margins: Tr21Margins;
  allocationSummary: {
    lastBillAmount: Tr21AmountCell;
    additionalAllocation: Tr21AmountCell;
    additionalRefNo: string;
    reducedAllocation: Tr21AmountCell;
    reducedRefNo: string;
    netTotalAllocation: Tr21AmountCell;
  };
  expenseSummary: {
    previousTotal: Tr21AmountCell;
    currentBillTotal: Tr21AmountCell;
    attachedWorksAmount: Tr21AmountCell;
    cumulativeTotal: Tr21AmountCell;
  };
}

function cellFromPaisa(paisa: number, blankWhenZero = false): Tr21AmountCell {
  const split = splitPaisaForTr21(paisa, { blankWhenZero, noComma: true });
  return {
    amountPaisa: blankWhenZero && paisa === 0 ? null : paisa,
    takaStr: split.takaStr,
    paisaStr: split.paisaStr,
  };
}

export function sanitizeBillFileSegment(bill: Pick<BillDoc, 'id' | 'billNo' | 'status'>): string {
  const raw = bill.billNo?.trim() || `draft-${bill.id.slice(0, 8)}`;
  return raw.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'bill';
}

function formatDeductionLabel(d: BillDeductionLine): string {
  if (d.kind === 'security' || d.id === 'security') {
    if (d.amount === 0) {
      return `${d.name || 'ঠিকাদার নিরাপত্তা জমা'}: (০ টাকা)`;
    }
    const hasRate = typeof d.rate === 'number' && Number.isFinite(d.rate) && d.rate > 0;
    return hasRate
      ? `${d.name || 'ঠিকাদার নিরাপত্তা জমা'}: (${toBanglaDigits(d.rate!)}% হারে)`
      : d.name || 'ঠিকাদার নিরাপত্তা জমা';
  }
  const hasRate = typeof d.rate === 'number' && Number.isFinite(d.rate) && d.rate > 0;
  const cleanName = (d.name || '').replace(/:+$/, '');
  return hasRate ? `${cleanName}: (${toBanglaDigits(d.rate!)}% হারে)` : cleanName;
}

export function formatOfficePossessiveBn(officeName: string): string {
  const clean = officeName.trim();
  if (!clean) return 'দপ্তরের';
  if (
    clean.endsWith(' এর') ||
    clean.endsWith('-এর') ||
    clean.endsWith("'র") ||
    clean.endsWith('’র')
  ) {
    return clean;
  }
  return `${clean} এর`;
}

export function buildTr21IntroText(params: {
  template?: string | null;
  officeName: string;
  officeAddress?: string | null;
  fiscalYear: string;
  memoNo?: string | null;
  memoDate?: string | null;
  purposeText: string;
  headName?: string | null;
  economicCode?: string | null;
  billNo?: string | null;
  billDate?: string | null;
}): string {
  const officeNameClean = params.officeName.trim() || 'দপ্তর';
  const officeAddressClean = (params.officeAddress || '').trim();
  const officePossessive = formatOfficePossessiveBn(officeNameClean);
  const fyBn = toBanglaDigits((params.fiscalYear || '').trim());
  const memoNoBn = params.memoNo ? toBanglaDigits(params.memoNo.trim()) : '';
  const memoDateBn = params.memoDate ? formatBanglaLongDate(params.memoDate.trim()) : '';
  const cleanPurpose = params.purposeText.trim();
  const headNameBn = (params.headName || '').trim();
  const economicCodeBn = params.economicCode ? toBanglaDigits(params.economicCode.trim()) : '';
  const billNoBn = params.billNo ? toBanglaDigits(params.billNo.trim()) : '';
  const billDateBn = params.billDate ? formatBanglaLongDate(params.billDate.trim()) : '';

  const rawTemplate = (params.template || '').trim();
  if (!rawTemplate || rawTemplate === DEFAULT_TR21_P1S3_INTRO_TEMPLATE) {
    let memoPart = 'বরাদ্দকৃত অর্থ থেকে ';
    if (memoDateBn && memoNoBn) {
      memoPart = `${memoDateBn} তারিখের ${memoNoBn} নং স্মারকে বরাদ্দকৃত অর্থ থেকে `;
    } else if (memoNoBn) {
      memoPart = `${memoNoBn} নং স্মারকে বরাদ্দকৃত অর্থ থেকে `;
    } else if (memoDateBn) {
      memoPart = `${memoDateBn} তারিখের স্মারকে বরাদ্দকৃত অর্থ থেকে `;
    }
    return `${officePossessive} অনুকূলে চলতি ${fyBn} অর্থ বছরের ${memoPart}${cleanPurpose}`;
  }

  let working = rawTemplate;

  // Clean comma/paren wrappers if officeAddress is empty
  if (!officeAddressClean) {
    working = working
      .replace(/,\s*\{\{\s*(?:officeAddress|address)\s*\}\}/gi, '')
      .replace(/\{\{\s*(?:officeAddress|address)\s*\}\}\s*,/gi, '')
      .replace(/\(\s*\{\{\s*(?:officeAddress|address)\s*\}\}\s*\)/gi, '');
  }

  // Clean empty memo date/number wrappers cleanly so no dangling 'ইং তারিখের' or 'নং' remains
  if (!memoDateBn) {
    working = working.replace(
      /\{\{\s*(?:BudgetMemuDates?|budgetMemoDates?|memoDate)\s*\}\}\s*(?:ইং\s*)?(?:তারিখের\s*)?/gi,
      ''
    );
  }
  if (!memoNoBn) {
    working = working.replace(
      /\{\{\s*(?:budgetMemuNumber|budgetMemoNumber|budgetMemoNo|memoNo|memoNumber)\s*\}\}\s*(?:নং\s*)?/gi,
      ''
    );
  }

  const values: Record<string, string> = {
    officename: officeNameClean,
    officenamepossessive: officePossessive,
    officeaddress: officeAddressClean,
    address: officeAddressClean,
    budgetfiscalyear: fyBn,
    fiscalyear: fyBn,
    fy: fyBn,
    budgetmemudates: memoDateBn,
    budgetmemudate: memoDateBn,
    budgetmemodates: memoDateBn,
    budgetmemodate: memoDateBn,
    memodate: memoDateBn,
    budgetmemunumber: memoNoBn,
    budgetmemonumber: memoNoBn,
    budgetmemono: memoNoBn,
    memono: memoNoBn,
    memonumber: memoNoBn,
    purposetext: cleanPurpose,
    purpose: cleanPurpose,
    headname: headNameBn,
    headnamebn: headNameBn,
    economiccode: economicCodeBn,
    code: economicCodeBn,
    billno: billNoBn,
    billdate: billDateBn,
  };

  let rendered = working.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    const normalized = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(values, normalized) ? values[normalized] : match;
  });

  rendered = rendered
    .replace(/\s+এর\s+এর(\s|$)/g, ' এর$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,।.])/g, '$1')
    .trim();

  return rendered;
}

export function resolveBillPrimaryBudget(params: {
  budgets: BudgetDoc[];
  fiscalYear: string;
  economicCode: string;
  bill?: Pick<BillDoc, 'budgetDeductions' | 'pendingSlices'> | null;
}): BudgetDoc | null {
  const codeBudgets = params.budgets
    .filter(
      (b) =>
        !b.deleted &&
        b.fiscalYear === params.fiscalYear &&
        b.economicCode === params.economicCode
    )
    .sort((a, b) => a.memoDate.localeCompare(b.memoDate));

  const sliceIds = (
    (params.bill?.budgetDeductions && params.bill.budgetDeductions.length > 0
      ? params.bill.budgetDeductions
      : params.bill?.pendingSlices) || []
  ).map((s) => s.budgetId);
  const sliceBudgets = sliceIds
    .map((id) => codeBudgets.find((b) => b.id === id))
    .filter((b): b is BudgetDoc => Boolean(b));

  const originalBudgets = codeBudgets.filter((b) => b.entryType === 'original');
  return sliceBudgets[0] || originalBudgets[0] || codeBudgets[0] || null;
}

export function formatVoucherNoForTr21(
  voucherNo?: string | null,
  billNo?: string | null,
  fiscalYear?: string | null
): string {
  const explicit = (voucherNo || '').trim();
  const rawBillNo = (billNo || '').trim();
  const slashIdx = rawBillNo.lastIndexOf('/');
  const billNoBase = rawBillNo
    ? slashIdx >= 0
      ? rawBillNo.slice(slashIdx + 1).trim()
      : rawBillNo
    : '';
  const base = explicit || billNoBase;
  if (!base) return '';

  const baseBn = toBanglaDigits(base);
  const fyBn = toBanglaDigits((fiscalYear || '').trim());
  if (!fyBn) return baseBn;

  if (baseBn.endsWith(`(${fyBn})`) || baseBn.includes(`(${fyBn})`)) {
    return baseBn;
  }
  return `${baseBn} (${fyBn})`;
}

export function buildTr21FormData(params: {
  bill: BillDoc;
  officeSettings: OfficeSettings;
  budgets: BudgetDoc[];
  allBillsInFy: BillDoc[];
  getHead: (
    code: string,
    fallback?: { headName?: string; headNameBn?: string }
  ) => { headName: string; headNameBn: string };
}): Tr21FormData {
  const { bill, officeSettings, budgets, allBillsInFy, getHead } = params;

  const ministryName = (officeSettings.ministryName || '').trim();
  const officeName = (officeSettings.officeName || '').trim() || 'উপজেলা উপানুষ্ঠানিক শিক্ষা ব্যুরো';
  const officeAddress = (officeSettings.address || '').trim();
  const officeMobileNoBn = officeSettings.officeMobileNo
    ? toBanglaDigits(officeSettings.officeMobileNo.trim())
    : '';
  const placeName = (officeSettings.placeName || '').trim();
  const footerLeftText =
    (officeSettings.tr21FooterText || '').trim() || DEFAULT_TR21_FOOTER_TEXT;

  const institutionalCodeRaw = (officeSettings.institutionalCode || '').replace(/\s+/g, '');
  const institutionalCodeBoxes = Array.from({ length: 13 }, (_, idx) => {
    const ch = institutionalCodeRaw[idx];
    return ch ? toBanglaDigits(ch) : '';
  });
  const institutionalCodeGroups: [string[], string[], string[], string[]] = [
    institutionalCodeBoxes.slice(0, 1),
    institutionalCodeBoxes.slice(1, 5),
    institutionalCodeBoxes.slice(5, 9),
    institutionalCodeBoxes.slice(9, 13),
  ];

  const head = getHead(bill.economicCode, {
    headName: bill.headName,
    headNameBn: bill.headNameBn,
  });

  // Resolve matching budgets for this FY + economicCode (preferring slices actually charged by this bill)
  const codeBudgets = budgets
    .filter((b) => !b.deleted && b.fiscalYear === bill.fiscalYear && b.economicCode === bill.economicCode)
    .sort((a, b) => a.memoDate.localeCompare(b.memoDate));

  const primaryBudget = resolveBillPrimaryBudget({
    budgets: codeBudgets,
    fiscalYear: bill.fiscalYear,
    economicCode: bill.economicCode,
    bill,
  });
  const positiveRevisions = codeBudgets.filter((b) => b.entryType === 'revision' && b.allocated > 0);
  const negativeRevisions = codeBudgets.filter((b) => b.entryType === 'revision' && b.allocated < 0);

  const memoNoRaw = primaryBudget?.memoNo || '';
  const memoDateRaw = primaryBudget?.memoDate || '';
  const memoNoBn = toBanglaDigits(memoNoRaw);
  const memoDateBn = formatBanglaLongDate(memoDateRaw);

  const fyBn = toBanglaDigits(bill.fiscalYear);
  const fyShortBn = formatFyShortBn(bill.fiscalYear);
  const billDateYmd = bill.billDate || bill.date;
  const billDateShortBn = formatBanglaPlainDate(billDateYmd);

  const voucherNoBn = formatVoucherNoForTr21(bill.voucherNo, bill.billNo, bill.fiscalYear);

  const purposeText =
    (bill.purposeText || '').trim() ||
    (head.headNameBn
      ? `${head.headNameBn} বাবদ ব্যয়ের বিল।`
      : `${head.headName} বাবদ ব্যয়ের বিল।`);

  const introText = buildTr21IntroText({
    template: officeSettings.tr21P1S3IntroTemplate,
    officeName,
    officeAddress,
    fiscalYear: bill.fiscalYear,
    memoNo: memoNoRaw,
    memoDate: memoDateRaw,
    purposeText,
    headName: head.headNameBn || head.headName,
    economicCode: bill.economicCode,
    billNo: bill.billNo,
    billDate: billDateYmd,
  });

  const rawItems = bill.items || [];
  const rawItemsSum = rawItems.reduce((sum, item) => sum + item.amount, 0);
  const computedGross = bill.grossAmount > 0 ? bill.grossAmount : rawItemsSum;

  let allocatedItemGross = 0;
  const items: Tr21ItemRow[] = rawItems.map((item, idx) => {
    let displayAmount = item.amount;
    if (rawItemsSum > 0 && computedGross !== rawItemsSum) {
      if (idx === rawItems.length - 1) {
        displayAmount = Math.max(0, computedGross - allocatedItemGross);
      } else {
        displayAmount = Math.round((item.amount * computedGross) / rawItemsSum);
        allocatedItemGross += displayAmount;
      }
    }
    const split = splitPaisaForTr21(displayAmount, { noComma: true });
    const emp = item.responsibleEmployee?.name
      ? item.responsibleEmployee.designation
        ? `${item.responsibleEmployee.name} (${item.responsibleEmployee.designation})`
        : item.responsibleEmployee.name
      : '';
    return {
      indexBn: toBanglaDigits(idx + 1),
      description: item.description,
      responsibleText: emp,
      amountPaisa: displayAmount,
      takaStr: split.takaStr,
      paisaStr: split.paisaStr,
    };
  });

  const p1s3Mode: Tr21P1S3Mode = 'items';
  const voucherTitle = '';
  const grossCell = cellFromPaisa(computedGross);
  const displayRows: Tr21ItemRow[] =
    items.length > 0
      ? items
      : [
          {
            indexBn: '১',
            description: purposeText,
            responsibleText: '',
            amountPaisa: computedGross,
            takaStr: grossCell.takaStr,
            paisaStr: grossCell.paisaStr,
          },
        ];

  const itDefaultCode = officeSettings.defaultItCode || DEFAULT_IT_CODE;
  const vatDefaultCode = officeSettings.defaultVatCode || DEFAULT_VAT_CODE;
  const securityDefaultCode = officeSettings.defaultSecurityCode || DEFAULT_SECURITY_CODE;

  const baseDeductions: BillDeductionLine[] =
    Array.isArray(bill.deductions) && bill.deductions.length > 0
      ? [...bill.deductions]
      : [
          {
            id: 'it',
            code: itDefaultCode,
            name: 'ব্যক্তি কর্তৃক দেয় আয়কর',
            rate: bill.itRate,
            amount: bill.itAmount,
            kind: 'it',
          },
          {
            id: 'vat',
            code: vatDefaultCode,
            name: 'দেশজ পণ্য ও সেবার ওপর মূসক',
            rate: bill.vatRate,
            amount: bill.vatAmount,
            kind: 'vat',
          },
        ];

  const hasSecurityRow = baseDeductions.some((d) => d.kind === 'security' || d.id === 'security');
  if (!hasSecurityRow) {
    baseDeductions.push({
      id: 'security',
      code: securityDefaultCode,
      name: 'ঠিকাদার নিরাপত্তা জমা',
      rate: 0,
      amount: 0,
      kind: 'security',
    });
  }

  const deductions: Tr21DeductionRow[] = baseDeductions.map((d) => {
    const split = splitPaisaForTr21(d.amount, { noComma: true });
    return {
      id: d.id,
      code: d.code,
      codeBn: toBanglaDigits(d.code),
      label: formatDeductionLabel(d),
      rate: d.rate ?? null,
      amountPaisa: d.amount,
      takaStr: split.takaStr,
      paisaStr: split.paisaStr,
    };
  });

  const totalDeductionPaisa = deductions.reduce((sum, d) => sum + d.amountPaisa, 0);
  const netPayablePaisa = computedGross - totalDeductionPaisa;

  const netPayableCode =
    (bill.netPayableCode || officeSettings.defaultNetPayableCode || DEFAULT_NET_PAYABLE_CODE).trim();

  const payeeText = (bill.payeeText || officeSettings.defaultPayeeText || '').trim();

  const allClauses = resolveTr21Clauses(officeSettings.tr21Clauses)
    .filter((c) => c.enabled)
    .map((c) => ({
      ...c,
      text: c.text.replace(/\{\{payeeText\}\}/g, payeeText),
    }));

  // Prior approved bills for the same FY & economicCode (excluding this bill)
  const priorApprovedBills = allBillsInFy
    .filter(
      (b) =>
        !b.deleted &&
        b.status === 'approved' &&
        b.fiscalYear === bill.fiscalYear &&
        b.economicCode === bill.economicCode &&
        b.id !== bill.id
    )
    .sort((a, b) => {
      const da = (a.billDate || a.date).localeCompare(b.billDate || b.date);
      if (da !== 0) return da;
      return (a.billNo || '').localeCompare(b.billNo || '');
    });

  const latestPriorBill =
    priorApprovedBills.length > 0 ? priorApprovedBills[priorApprovedBills.length - 1] : null;
  const approvedBillsSumExclThis = priorApprovedBills.reduce((s, b) => s + b.grossAmount, 0);

  // Fallback check against budget.spent for migrated or historical spent totals
  const budgetSpentTotal = codeBudgets.reduce((s, b) => s + (b.spent || 0), 0);
  const spentExclThis = Math.max(
    approvedBillsSumExclThis,
    Math.max(0, budgetSpentTotal - (bill.status === 'approved' ? computedGross : 0))
  );

  const additionalAllocTotal = positiveRevisions.reduce((s, b) => s + b.allocated, 0);
  const reducedAllocTotal = negativeRevisions.reduce((s, b) => s + Math.abs(b.allocated), 0);
  const netAllocTotal = codeBudgets.reduce((s, b) => s + b.allocated, 0);

  const additionalRefNo = positiveRevisions.map((r) => toBanglaDigits(r.memoNo)).join(', ');
  const reducedRefNo = negativeRevisions.map((r) => toBanglaDigits(r.memoNo)).join(', ');

  return {
    billId: bill.id,
    isDraft: bill.status === 'draft',
    status: bill.status,
    fiscalYear: bill.fiscalYear,
    fyBn,
    fyShortBn,
    ministryName,
    officeName,
    officeAddress,
    officeMobileNoBn,
    placeName,
    institutionalCodeRaw,
    institutionalCodeBoxes,
    institutionalCodeGroups,
    tokenNoBn: bill.tokenNo ? toBanglaDigits(bill.tokenNo.trim()) : '',
    voucherNoBn,
    billDateYmd,
    billDateShortBn,
    economicCode: bill.economicCode,
    economicCodeBn: toBanglaDigits(bill.economicCode),
    headName: head.headName,
    headNameBn: head.headNameBn,
    memoNoBn,
    memoDateBn,
    purposeText,
    supplier: bill.supplier || null,
    introText,
    p1s3Mode,
    voucherTitle,
    displayRows,
    items,
    gross: grossCell,
    deductions,
    blankDeductionRowsCount: 0,
    totalDeduction: cellFromPaisa(totalDeductionPaisa),
    netPayableCode,
    netPayableCodeBn: toBanglaDigits(netPayableCode),
    netPayable: cellFromPaisa(netPayablePaisa),
    netPayableInWords: paisaToBanglaWords(netPayablePaisa),
    payeeText,
    page1Clauses: allClauses.filter((c) => c.page === 1),
    page2Clauses: allClauses.filter((c) => c.page === 2),
    footerLeftText,
    fontFamily: resolveTr21FontFamily(officeSettings.tr21FontFamily),
    fontFamilyCss: resolveTr21FontCss(officeSettings.tr21FontFamily),
    fontSize: resolveTr21FontSize(officeSettings.tr21FontSize),
    margins: resolveTr21Margins(officeSettings.tr21Margins, officeSettings.tr21VoucherLabel),
    allocationSummary: {
      lastBillAmount: latestPriorBill
        ? cellFromPaisa(latestPriorBill.grossAmount)
        : cellFromPaisa(0),
      additionalAllocation: cellFromPaisa(additionalAllocTotal),
      additionalRefNo,
      reducedAllocation: cellFromPaisa(reducedAllocTotal),
      reducedRefNo,
      netTotalAllocation: codeBudgets.length > 0 ? cellFromPaisa(netAllocTotal) : cellFromPaisa(0),
    },
    expenseSummary: {
      previousTotal: cellFromPaisa(spentExclThis),
      currentBillTotal: cellFromPaisa(computedGross),
      attachedWorksAmount: cellFromPaisa(0),
      cumulativeTotal: cellFromPaisa(spentExclThis + computedGross),
    },
  };
}
