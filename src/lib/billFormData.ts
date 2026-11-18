import {
  formatBanglaLongDate,
  formatBanglaShortDate,
  formatFyShortBn,
  paisaToBanglaWords,
  splitPaisaForTr21,
  toBanglaDigits,
} from './banglaFormat';
import {
  DEFAULT_IT_CODE,
  DEFAULT_NET_PAYABLE_CODE,
  DEFAULT_VAT_CODE,
  resolveTr21Clauses,
} from './tr21Defaults';
import type {
  BillDeductionLine,
  BillDoc,
  BillSupplierInfo,
  BudgetDoc,
  CertificationClause,
  OfficeSettings,
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
  officeName: string;
  placeName: string;
  institutionalCodeRaw: string;
  institutionalCodeBoxes: string[]; // always 13 boxes
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

function emptyCell(): Tr21AmountCell {
  return { amountPaisa: null, takaStr: '', paisaStr: '' };
}

function cellFromPaisa(paisa: number, blankWhenZero = false): Tr21AmountCell {
  const split = splitPaisaForTr21(paisa, { blankWhenZero });
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

  const officeName = (officeSettings.officeName || '').trim() || 'জেলা উপানুষ্ঠানিক শিক্ষা ব্যুরো';
  const placeName = (officeSettings.placeName || '').trim();
  const institutionalCodeRaw = (officeSettings.institutionalCode || '').replace(/\s+/g, '');
  const institutionalCodeBoxes = Array.from({ length: 13 }, (_, idx) => {
    const ch = institutionalCodeRaw[idx];
    return ch ? toBanglaDigits(ch) : '';
  });

  const head = getHead(bill.economicCode, {
    headName: bill.headName,
    headNameBn: bill.headNameBn,
  });

  // Resolve matching budgets for this FY + economicCode
  const codeBudgets = budgets
    .filter((b) => !b.deleted && b.fiscalYear === bill.fiscalYear && b.economicCode === bill.economicCode)
    .sort((a, b) => a.memoDate.localeCompare(b.memoDate));

  const originalBudgets = codeBudgets.filter((b) => b.entryType === 'original');
  const primaryBudget = originalBudgets[0] || codeBudgets[0] || null;
  const positiveRevisions = codeBudgets.filter((b) => b.entryType === 'revision' && b.allocated > 0);
  const negativeRevisions = codeBudgets.filter((b) => b.entryType === 'revision' && b.allocated < 0);

  const memoNoRaw = primaryBudget?.memoNo || '';
  const memoDateRaw = primaryBudget?.memoDate || '';
  const memoNoBn = toBanglaDigits(memoNoRaw);
  const memoDateBn = formatBanglaLongDate(memoDateRaw);

  const fyBn = toBanglaDigits(bill.fiscalYear);
  const fyShortBn = formatFyShortBn(bill.fiscalYear);
  const billDateYmd = bill.billDate || bill.date;
  const billDateShortBn = formatBanglaShortDate(billDateYmd);

  // Extract sequential suffix from billNo if format is YYYY-YY/NNN, else show full billNo in Bangla
  const rawBillNo = (bill.billNo || '').trim();
  const slashIdx = rawBillNo.lastIndexOf('/');
  const voucherNoBn = rawBillNo
    ? toBanglaDigits(slashIdx >= 0 ? rawBillNo.slice(slashIdx + 1) : rawBillNo)
    : '';

  const purposeText =
    (bill.purposeText || '').trim() ||
    (head.headNameBn
      ? `${head.headNameBn} বাবদ ব্যয়ের বিল।`
      : `${head.headName} বাবদ ব্যয়ের বিল।`);

  const memoPart =
    memoDateBn && memoNoBn
      ? `${memoDateBn} তারিখের ${memoNoBn} নং স্মারকে বরাদ্দকৃত অর্থ হতে `
      : memoNoBn
      ? `${memoNoBn} নং স্মারকে বরাদ্দকৃত অর্থ হতে `
      : 'বরাদ্দকৃত অর্থ হতে ';

  const introText = `${officeName}-এর অনুকূলে চলতি ${fyBn} অর্থ বছরের ${memoPart}${purposeText}`;

  const items: Tr21ItemRow[] = (bill.items || []).map((item, idx) => {
    const split = splitPaisaForTr21(item.amount);
    const emp = item.responsibleEmployee?.name
      ? item.responsibleEmployee.designation
        ? `${item.responsibleEmployee.name} (${item.responsibleEmployee.designation})`
        : item.responsibleEmployee.name
      : '';
    return {
      indexBn: toBanglaDigits(idx + 1),
      description: item.description,
      responsibleText: emp,
      amountPaisa: item.amount,
      takaStr: split.takaStr,
      paisaStr: split.paisaStr,
    };
  });

  const computedGross =
    items.length > 0 ? items.reduce((sum, it) => sum + it.amountPaisa, 0) : bill.grossAmount;

  const rawDeductions: BillDeductionLine[] =
    Array.isArray(bill.deductions) && bill.deductions.length > 0
      ? bill.deductions
      : [
          {
            id: 'it',
            code: DEFAULT_IT_CODE,
            name: 'ব্যক্তি কর্তৃক দেয় আয়কর',
            rate: bill.itRate,
            amount: bill.itAmount,
            kind: 'it',
          },
          {
            id: 'vat',
            code: DEFAULT_VAT_CODE,
            name: 'দেশজ পণ্য ও সেবার ওপর মূসক',
            rate: bill.vatRate,
            amount: bill.vatAmount,
            kind: 'vat',
          },
        ];

  const deductions: Tr21DeductionRow[] = rawDeductions.map((d) => {
    const hasRate = typeof d.rate === 'number' && Number.isFinite(d.rate) && d.rate > 0;
    const rateLabel = hasRate ? ` (${toBanglaDigits(d.rate!)}%)` : '';
    const split = splitPaisaForTr21(d.amount, { blankWhenZero: d.amount === 0 });
    return {
      id: d.id,
      code: d.code,
      codeBn: toBanglaDigits(d.code),
      label: `${d.name}${rateLabel}`,
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
    officeName,
    placeName,
    institutionalCodeRaw,
    institutionalCodeBoxes,
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
    items,
    gross: cellFromPaisa(computedGross),
    deductions,
    blankDeductionRowsCount: 2,
    totalDeduction: cellFromPaisa(totalDeductionPaisa),
    netPayableCode,
    netPayableCodeBn: toBanglaDigits(netPayableCode),
    netPayable: cellFromPaisa(netPayablePaisa),
    netPayableInWords: paisaToBanglaWords(netPayablePaisa),
    payeeText,
    page1Clauses: allClauses.filter((c) => c.page === 1),
    page2Clauses: allClauses.filter((c) => c.page === 2),
    allocationSummary: {
      lastBillAmount: latestPriorBill ? cellFromPaisa(latestPriorBill.grossAmount) : emptyCell(),
      additionalAllocation:
        additionalAllocTotal > 0 ? cellFromPaisa(additionalAllocTotal) : emptyCell(),
      additionalRefNo,
      reducedAllocation: reducedAllocTotal > 0 ? cellFromPaisa(reducedAllocTotal) : emptyCell(),
      reducedRefNo,
      netTotalAllocation: codeBudgets.length > 0 ? cellFromPaisa(netAllocTotal) : emptyCell(),
    },
    expenseSummary: {
      previousTotal: cellFromPaisa(spentExclThis),
      currentBillTotal: cellFromPaisa(computedGross),
      attachedWorksAmount: emptyCell(),
      cumulativeTotal: cellFromPaisa(spentExclThis + computedGross),
    },
  };
}
