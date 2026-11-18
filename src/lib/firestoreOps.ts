import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentReference,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { writeAuditLogInBatch, writeAuditLogInTx, type AuditActor } from './audit';
import { computeAvailable, computeCodeAvailable, pickLatestEffectiveLimit } from './computeAvailable';
import { isDateInFiscalYear } from './fy';
import { calcPercentageAmount } from './money';
import { DEFAULT_IT_CODE, DEFAULT_NET_PAYABLE_CODE, DEFAULT_VAT_CODE } from './tr21Defaults';
import { isValidEconomicCode, normalizeEmail } from './validation';
import type {
  BillBudgetSlice,
  BillDeductionLine,
  BillDoc,
  BillItemSnapshot,
  BillStatus,
  BillSupplierInfo,
  BudgetDoc,
  BudgetEntryType,
  BudgetStatus,
  DeductionRates,
  EconomicCodeDoc,
  ExpenseItemDoc,
  FyCodeTotalDoc,
  OfficeSettings,
  ResponsibleEmployee,
  Role,
  SpendingDoc,
  SpendingLimitDoc,
  SpendingLimitType,
  UserStatus,
  VatTaxRateDoc,
  VatVariant,
} from '../types';

function assertOnlineForTransaction(actionLabel: string): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error(
      `অফলাইনে "${actionLabel}" সম্পন্ন করা যায় না। ইন্টারনেট সংযোগ চালু করে আবার চেষ্টা করুন।`
    );
  }
}

export function formatSequentialBillNo(fiscalYear: string, seq: number): string {
  return `${fiscalYear}/${String(Math.max(1, seq)).padStart(3, '0')}`;
}

export interface CreateBudgetInput {
  fiscalYear: string;
  memoNo: string;
  memoDate: string;
  economicCode: string;
  headName: string;
  headNameBn: string;
  allocated: number; // integer paisa
  entryType: BudgetEntryType;
  revisionOf: string | null;
  deductionRates: DeductionRates;
}

export async function createBudgetTx(
  input: CreateBudgetInput,
  actor: AuditActor
): Promise<string> {
  const memoNo = input.memoNo.trim();
  const economicCode = input.economicCode.trim();
  const headName = input.headName.trim();
  const headNameBn = input.headNameBn.trim();

  if (!memoNo) throw new Error('Memo number is required.');
  if (!isDateInFiscalYear(input.memoDate, input.fiscalYear)) {
    throw new Error(`Memo date must fall inside FY ${input.fiscalYear}.`);
  }
  if (!isValidEconomicCode(economicCode, false)) {
    throw new Error('Economic code must be exactly 7 digits.');
  }
  if (!headName) throw new Error('Head name is required.');
  if (input.entryType === 'original' && input.allocated <= 0) {
    throw new Error('Original allocation amount must be greater than zero.');
  }
  if (input.entryType === 'revision' && input.allocated === 0) {
    throw new Error('Revision amount cannot be zero.');
  }
  if (input.entryType === 'revision' && !input.revisionOf) {
    throw new Error('Select the original budget entry being revised.');
  }

  const masterRef = doc(db, 'economicCodes', economicCode);
  const masterSnap = await getDoc(masterRef);
  if (!masterSnap.exists()) {
    throw new Error(`Economic code "${economicCode}" does not exist in Economic Codes.`);
  }
  const masterData = masterSnap.data() as Omit<EconomicCodeDoc, 'id'>;
  if (masterData.special) {
    throw new Error('GENERAL-CONSTRUCTION cannot be used directly for a budget allocation.');
  }
  const resolvedHeadName = masterData.headName || headName;
  const resolvedHeadNameBn = masterData.headNameBn || headNameBn;

  const fyBudgetsSnap = await getDocs(
    query(collection(db, 'budgets'), where('fiscalYear', '==', input.fiscalYear))
  );
  const hasActiveDup = fyBudgetsSnap.docs.some((d) => {
    const data = d.data();
    return !data.deleted && data.memoNo === memoNo;
  });
  if (hasActiveDup) {
    throw new Error(`Duplicate memo number "${memoNo}" in FY ${input.fiscalYear}.`);
  }

  const budgetRef = doc(collection(db, 'budgets'));
  const fyTotalId = `${input.fiscalYear}_${economicCode}`;
  const fyTotalRef = doc(db, 'fyCodeTotals', fyTotalId);

  await runTransaction(db, async (tx) => {
    const fyTotalSnap = await tx.get(fyTotalRef);
    let revTargetSnap = null;
    if (input.entryType === 'revision' && input.revisionOf) {
      revTargetSnap = await tx.get(doc(db, 'budgets', input.revisionOf));
      if (!revTargetSnap.exists() || revTargetSnap.data().deleted) {
        throw new Error('Selected target budget for revision was not found.');
      }
    }

    const prevAllocated = fyTotalSnap.exists() ? (fyTotalSnap.data().allocated as number) || 0 : 0;
    const prevSpent = fyTotalSnap.exists() ? (fyTotalSnap.data().spent as number) || 0 : 0;
    const prevPending = fyTotalSnap.exists() ? (fyTotalSnap.data().pendingAmount as number) || 0 : 0;

    const budgetPayload = {
      fiscalYear: input.fiscalYear,
      memoNo,
      memoDate: input.memoDate,
      economicCode,
      headName: resolvedHeadName,
      headNameBn: resolvedHeadNameBn,
      allocated: input.allocated,
      entryType: input.entryType,
      revisionOf: input.entryType === 'revision' ? input.revisionOf : null,
      deductionRates: input.deductionRates,
      spent: 0,
      approvedSpent: 0,
      pendingAmount: 0,
      remaining: input.allocated,
      status: 'active' as BudgetStatus,
      deleted: false,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };

    tx.set(budgetRef, budgetPayload);

    tx.set(
      fyTotalRef,
      {
        fiscalYear: input.fiscalYear,
        economicCode,
        allocated: prevAllocated + input.allocated,
        spent: prevSpent,
        approvedSpent: prevSpent,
        pendingAmount: prevPending,
        createdAt: fyTotalSnap.exists() ? fyTotalSnap.data().createdAt : serverTimestamp(),
        createdBy: fyTotalSnap.exists() ? fyTotalSnap.data().createdBy : actor.uid,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      },
      { merge: true }
    );

    writeAuditLogInTx(tx, {
      collection: 'budgets',
      docId: budgetRef.id,
      action: 'create',
      before: null,
      after: { id: budgetRef.id, ...budgetPayload },
      actor,
    });
  });

  return budgetRef.id;
}

export async function updateBudgetTx(
  budgetId: string,
  updates: {
    memoNo: string;
    memoDate: string;
    headName: string;
    headNameBn: string;
    allocated: number;
    deductionRates: DeductionRates;
  },
  actor: AuditActor
): Promise<void> {
  const memoNo = updates.memoNo.trim();
  const headName = updates.headName.trim();
  if (!memoNo) throw new Error('Memo number is required.');
  if (!headName) throw new Error('Head name is required.');

  const budgetRef = doc(db, 'budgets', budgetId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(budgetRef);
    if (!snap.exists() || snap.data().deleted) {
      throw new Error('Budget not found.');
    }
    const before = snap.data() as Omit<BudgetDoc, 'id'>;
    if (!isDateInFiscalYear(updates.memoDate, before.fiscalYear)) {
      throw new Error(`Memo date must fall inside FY ${before.fiscalYear}.`);
    }
    const pendingAmt = Math.max(0, before.pendingAmount || 0);
    if (updates.allocated < before.spent + pendingAmt) {
      throw new Error(
        'Allocated amount cannot be less than already approved spent plus pending bills.'
      );
    }

    const fyTotalRef = doc(db, 'fyCodeTotals', `${before.fiscalYear}_${before.economicCode}`);
    const fyTotalSnap = await tx.get(fyTotalRef);
    const prevFyAlloc = fyTotalSnap.exists() ? (fyTotalSnap.data().allocated as number) || 0 : 0;
    const prevFySpent = fyTotalSnap.exists() ? (fyTotalSnap.data().spent as number) || 0 : before.spent;
    const prevFyPending = fyTotalSnap.exists()
      ? (fyTotalSnap.data().pendingAmount as number) || 0
      : pendingAmt;
    const delta = updates.allocated - before.allocated;
    const newRemaining = updates.allocated - before.spent - pendingAmt;

    const afterFields = {
      memoNo,
      memoDate: updates.memoDate,
      headName,
      headNameBn: updates.headNameBn.trim(),
      allocated: updates.allocated,
      remaining: newRemaining,
      deductionRates: updates.deductionRates,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };

    tx.update(budgetRef, afterFields);
    tx.set(
      fyTotalRef,
      {
        fiscalYear: before.fiscalYear,
        economicCode: before.economicCode,
        allocated: prevFyAlloc + delta,
        spent: prevFySpent,
        approvedSpent: prevFySpent,
        pendingAmount: prevFyPending,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      },
      { merge: true }
    );

    writeAuditLogInTx(tx, {
      collection: 'budgets',
      docId: budgetId,
      action: 'update',
      before: { id: budgetId, ...before },
      after: { id: budgetId, ...before, ...afterFields },
      actor,
    });
  });
}

export async function softDeleteBudgetTx(
  budgetId: string,
  actor: AuditActor
): Promise<void> {
  const budgetRef = doc(db, 'budgets', budgetId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(budgetRef);
    if (!snap.exists() || snap.data().deleted) {
      throw new Error('Budget not found.');
    }
    const before = snap.data() as Omit<BudgetDoc, 'id'>;
    if (before.spent > 0 || (before.pendingAmount || 0) > 0) {
      throw new Error(
        'Cannot delete a budget with approved or pending bills. Cancel or reject those bills first.'
      );
    }

    const fyTotalRef = doc(db, 'fyCodeTotals', `${before.fiscalYear}_${before.economicCode}`);
    const fyTotalSnap = await tx.get(fyTotalRef);
    const prevFyAlloc = fyTotalSnap.exists() ? (fyTotalSnap.data().allocated as number) || 0 : 0;

    tx.update(budgetRef, {
      deleted: true,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });

    if (fyTotalSnap.exists()) {
      tx.update(fyTotalRef, {
        allocated: prevFyAlloc - before.allocated,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    }

    writeAuditLogInTx(tx, {
      collection: 'budgets',
      docId: budgetId,
      action: 'delete',
      before: { id: budgetId, ...before },
      after: { id: budgetId, ...before, deleted: true },
      actor,
    });
  });
}

export async function markBudgetStatusTx(
  budgetId: string,
  status: BudgetStatus,
  actor: AuditActor
): Promise<void> {
  const budgetRef = doc(db, 'budgets', budgetId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(budgetRef);
    if (!snap.exists() || snap.data().deleted) {
      throw new Error('Budget not found.');
    }
    const before = snap.data() as Omit<BudgetDoc, 'id'>;
    tx.update(budgetRef, {
      status,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
    writeAuditLogInTx(tx, {
      collection: 'budgets',
      docId: budgetId,
      action: 'update',
      before: { id: budgetId, ...before },
      after: { id: budgetId, ...before, status },
      actor,
    });
  });
}

/* ============================================================================
 * EXPENSE ITEMS (খরচ তালিকা) - Offline-capable CRUD
 * ============================================================================ */

export interface ExpenseItemInput {
  fiscalYear: string;
  economicCode: string;
  headName: string;
  headNameBn?: string;
  date: string;
  description: string;
  amount: number; // integer paisa (> 0, gross only, NO VAT/IT)
  responsibleEmployee: ResponsibleEmployee;
}

function validateExpenseItemInput(input: ExpenseItemInput, indexLabel?: string): void {
  const prefix = indexLabel ? `${indexLabel}: ` : '';
  const code = input.economicCode.trim();
  if (!isValidEconomicCode(code, false)) {
    throw new Error(`${prefix}৭-অঙ্কের বৈধ অর্থনৈতিক কোড নির্বাচন করুন।`);
  }
  if (!isDateInFiscalYear(input.date, input.fiscalYear)) {
    throw new Error(`${prefix}তারিখ অর্থবছর ${input.fiscalYear} এর মধ্যে হতে হবে।`);
  }
  if (!input.description.trim()) {
    throw new Error(`${prefix}খরচের বিবরণ আবশ্যক।`);
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error(`${prefix}খরচের পরিমাণ অবশ্যই ০ এর বেশি হতে হবে।`);
  }
  if (!input.responsibleEmployee.name.trim()) {
    throw new Error(`${prefix}দায়িত্বপ্রাপ্ত কর্মচারীর নাম আবশ্যক।`);
  }
}

export async function createExpenseItemsBatch(
  items: ExpenseItemInput[],
  actor: AuditActor
): Promise<string[]> {
  if (items.length === 0) {
    throw new Error('কমপক্ষে একটি খরচ আইটেম যোগ করুন।');
  }
  items.forEach((item, idx) => validateExpenseItemInput(item, `আইটেম #${idx + 1}`));

  const createdIds: string[] = [];
  // Chunk by 200 items per batch (2 writes per item -> 400 ops < 500 Firestore batch limit)
  for (let i = 0; i < items.length; i += 200) {
    const chunk = items.slice(i, i + 200);
    const batch = writeBatch(db);
    for (const item of chunk) {
      const ref = doc(collection(db, 'expenseItems'));
      const payload = {
        fiscalYear: item.fiscalYear,
        economicCode: item.economicCode.trim(),
        headName: item.headName.trim(),
        headNameBn: (item.headNameBn || '').trim(),
        date: item.date,
        description: item.description.trim(),
        amount: Math.round(item.amount),
        responsibleEmployee: {
          userId: item.responsibleEmployee.userId || null,
          name: item.responsibleEmployee.name.trim(),
          designation: item.responsibleEmployee.designation.trim(),
        },
        status: 'listed' as const,
        billId: null,
        deleted: false,
        createdAt: serverTimestamp(),
        createdBy: actor.uid,
        createdByName: actor.name,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      };
      batch.set(ref, payload);
      writeAuditLogInBatch(batch, {
        collection: 'expenseItems',
        docId: ref.id,
        action: 'create',
        before: null,
        after: { id: ref.id, ...payload },
        actor,
      });
      createdIds.push(ref.id);
    }
    await batch.commit();
  }
  return createdIds;
}

export async function updateExpenseItem(
  existing: ExpenseItemDoc,
  updates: ExpenseItemInput,
  actor: AuditActor
): Promise<void> {
  if (existing.status === 'billed') {
    throw new Error('বিলে অন্তর্ভুক্ত (billed) খরচ সম্পাদনা করা যায় না।');
  }
  validateExpenseItemInput(updates);

  const ref = doc(db, 'expenseItems', existing.id);
  const batch = writeBatch(db);
  const patch = {
    economicCode: updates.economicCode.trim(),
    headName: updates.headName.trim(),
    headNameBn: (updates.headNameBn || '').trim(),
    date: updates.date,
    description: updates.description.trim(),
    amount: Math.round(updates.amount),
    responsibleEmployee: {
      userId: updates.responsibleEmployee.userId || null,
      name: updates.responsibleEmployee.name.trim(),
      designation: updates.responsibleEmployee.designation.trim(),
    },
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  };
  batch.update(ref, patch);
  writeAuditLogInBatch(batch, {
    collection: 'expenseItems',
    docId: existing.id,
    action: 'update',
    before: existing as unknown as Record<string, unknown>,
    after: { ...existing, ...patch } as unknown as Record<string, unknown>,
    actor,
  });
  await batch.commit();
}

export async function deleteExpenseItem(
  existing: ExpenseItemDoc,
  actor: AuditActor
): Promise<void> {
  if (existing.status === 'billed') {
    throw new Error('বিলে অন্তর্ভুক্ত (billed) খরচ মুছে ফেলা যায় না।');
  }
  const ref = doc(db, 'expenseItems', existing.id);
  const batch = writeBatch(db);
  batch.update(ref, {
    deleted: true,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });
  writeAuditLogInBatch(batch, {
    collection: 'expenseItems',
    docId: existing.id,
    action: 'delete',
    before: existing as unknown as Record<string, unknown>,
    after: { ...existing, deleted: true } as unknown as Record<string, unknown>,
    actor,
  });
  await batch.commit();
}

/* ============================================================================
 * BILLS (বিল) - Draft creation (offline-safe) + Submit/Approve/Reject/Cancel Tx
 * ============================================================================ */

export interface DraftBillGroupInput {
  fiscalYear: string;
  economicCode: string;
  headName: string;
  headNameBn?: string;
  date: string;
  billDate?: string;
  tokenNo?: string;
  purposeText?: string;
  payeeText?: string;
  netPayableCode?: string;
  supplier?: BillSupplierInfo | null;
  deductions?: BillDeductionLine[];
  items: ExpenseItemDoc[];
  vatRate: number;
  itRate: number;
  vatVariant: string;
  vatVariantLabel?: string;
}

function summarizeBillDeductions(
  grossAmount: number,
  vatRate: number,
  itRate: number,
  customDeductions?: BillDeductionLine[]
): {
  deductions: BillDeductionLine[];
  vatAmount: number;
  itAmount: number;
  totalDeduction: number;
  netPayable: number;
  effectiveVatRate: number;
  effectiveItRate: number;
} {
  let deductions: BillDeductionLine[];
  if (Array.isArray(customDeductions) && customDeductions.length > 0) {
    deductions = customDeductions.map((d, idx) => ({
      id: d.id || `ded_${idx + 1}`,
      code: (d.code || '').trim(),
      name: (d.name || '').trim(),
      rate: d.rate ?? null,
      amount: Math.max(0, Math.round(d.amount || 0)),
      kind: d.kind || 'other',
    }));
  } else {
    const itAmt = calcPercentageAmount(grossAmount, itRate);
    const vatAmt = calcPercentageAmount(grossAmount, vatRate);
    deductions = [
      {
        id: 'it',
        code: DEFAULT_IT_CODE,
        name: 'ব্যক্তি কর্তৃক দেয় আয়কর',
        rate: itRate,
        amount: itAmt,
        kind: 'it',
      },
      {
        id: 'vat',
        code: DEFAULT_VAT_CODE,
        name: 'দেশজ পণ্য ও সেবার ওপর মূসক',
        rate: vatRate,
        amount: vatAmt,
        kind: 'vat',
      },
    ];
  }

  const itLines = deductions.filter((d) => d.kind === 'it');
  const vatLines = deductions.filter((d) => d.kind === 'vat');
  const itAmount = itLines.reduce((sum, d) => sum + d.amount, 0);
  const vatAmount = vatLines.reduce((sum, d) => sum + d.amount, 0);
  const totalDeduction = deductions.reduce((sum, d) => sum + d.amount, 0);
  const netPayable = grossAmount - totalDeduction;

  return {
    deductions,
    vatAmount,
    itAmount,
    totalDeduction,
    netPayable,
    effectiveVatRate: vatLines[0]?.rate ?? vatRate,
    effectiveItRate: itLines[0]?.rate ?? itRate,
  };
}

export async function createDraftBillsFromItems(
  groups: DraftBillGroupInput[],
  actor: AuditActor
): Promise<string[]> {
  if (groups.length === 0) {
    throw new Error('বিল প্রস্তুত করতে কমপক্ষে একটি তালিকাভুক্ত (listed) খরচ নির্বাচন করুন।');
  }

  const createdBillIds: string[] = [];
  const batch = writeBatch(db);

  for (const group of groups) {
    if (group.items.length === 0) continue;
    for (const item of group.items) {
      if (item.status !== 'listed' || item.deleted) {
        throw new Error(`আইটেম "${item.description}" ইতোমধ্যে অন্য বিলে যুক্ত হয়েছে।`);
      }
      if (item.economicCode !== group.economicCode) {
        throw new Error('একই বিলের সব আইটেম অবশ্যই একই অর্থনৈতিক কোডের হতে হবে।');
      }
    }
    if (!isDateInFiscalYear(group.date, group.fiscalYear)) {
      throw new Error(`বিলের তারিখ অর্থবছর ${group.fiscalYear} এর মধ্যে হতে হবে।`);
    }

    const grossAmount = group.items.reduce((sum, item) => sum + item.amount, 0);
    if (grossAmount <= 0) {
      throw new Error('মোট বিলের পরিমাণ ০ এর বেশি হতে হবে।');
    }
    const {
      deductions,
      vatAmount,
      itAmount,
      totalDeduction,
      netPayable,
      effectiveVatRate,
      effectiveItRate,
    } = summarizeBillDeductions(grossAmount, group.vatRate, group.itRate, group.deductions);

    if (netPayable < 0) {
      throw new Error('মোট কর্তন বিলের চেয়ে বেশি হতে পারে না।');
    }

    const billRef = doc(collection(db, 'bills'));
    const snapshots: BillItemSnapshot[] = group.items.map((item) => ({
      id: item.id,
      date: item.date,
      description: item.description,
      amount: item.amount,
      responsibleEmployee: {
        userId: item.responsibleEmployee.userId || null,
        name: item.responsibleEmployee.name,
        designation: item.responsibleEmployee.designation,
      },
    }));

    const cleanSupplier =
      group.supplier &&
      (group.supplier.name?.trim() || group.supplier.address?.trim() || group.supplier.tinBin?.trim())
        ? {
            name: (group.supplier.name || '').trim(),
            address: (group.supplier.address || '').trim(),
            tinBin: (group.supplier.tinBin || '').trim(),
          }
        : null;

    const billPayload = {
      billNo: '', // Assigned sequentially on Submit
      fiscalYear: group.fiscalYear,
      economicCode: group.economicCode,
      headName: group.headName,
      headNameBn: group.headNameBn || '',
      date: group.date,
      billDate: group.billDate || group.date,
      tokenNo: (group.tokenNo || '').trim(),
      purposeText: (group.purposeText || '').trim(),
      payeeText: (group.payeeText || '').trim(),
      netPayableCode: (group.netPayableCode || DEFAULT_NET_PAYABLE_CODE).trim(),
      supplier: cleanSupplier,
      deductions,
      itemIds: group.items.map((i) => i.id),
      items: snapshots,
      grossAmount,
      vatRate: effectiveVatRate,
      itRate: effectiveItRate,
      vatVariant: group.vatVariant || 'default',
      vatVariantLabel: group.vatVariantLabel || 'Standard',
      vatAmount,
      itAmount,
      totalDeduction,
      netPayable,
      status: 'draft' as BillStatus,
      submittedAt: null,
      submittedBy: null,
      approvedBy: null,
      approvedAt: null,
      rejectReason: null,
      cancelledBy: null,
      cancelledAt: null,
      cancelReason: null,
      pendingSlices: [],
      budgetDeductions: [],
      migratedFromSpendingId: null,
      deleted: false,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      createdByName: actor.name,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };

    batch.set(billRef, billPayload);
    writeAuditLogInBatch(batch, {
      collection: 'bills',
      docId: billRef.id,
      action: 'create',
      before: null,
      after: { id: billRef.id, ...billPayload },
      actor,
    });

    for (const item of group.items) {
      const itemRef = doc(db, 'expenseItems', item.id);
      batch.update(itemRef, {
        status: 'billed',
        billId: billRef.id,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    }

    createdBillIds.push(billRef.id);
  }

  await batch.commit();
  return createdBillIds;
}

export async function updateDraftBillRates(
  bill: BillDoc,
  updates: {
    date: string;
    billDate?: string;
    vatVariant: string;
    vatVariantLabel: string;
    vatRate: number;
    itRate: number;
    tokenNo?: string;
    purposeText?: string;
    payeeText?: string;
    netPayableCode?: string;
    supplier?: BillSupplierInfo | null;
    deductions?: BillDeductionLine[];
  },
  actor: AuditActor
): Promise<void> {
  if (bill.status !== 'draft') {
    throw new Error('শুধুমাত্র খসড়া (draft) বিল সম্পাদনা করা যায়।');
  }
  if (!isDateInFiscalYear(updates.date, bill.fiscalYear)) {
    throw new Error(`বিলের তারিখ অর্থবছর ${bill.fiscalYear} এর মধ্যে হতে হবে।`);
  }

  const grossAmount = bill.items.reduce((sum, item) => sum + item.amount, 0) || bill.grossAmount;
  const {
    deductions,
    vatAmount,
    itAmount,
    totalDeduction,
    netPayable,
    effectiveVatRate,
    effectiveItRate,
  } = summarizeBillDeductions(grossAmount, updates.vatRate, updates.itRate, updates.deductions);

  if (netPayable < 0) {
    throw new Error('মোট কর্তন বিলের চেয়ে বেশি হতে পারে না।');
  }

  const cleanSupplier =
    updates.supplier &&
    (updates.supplier.name?.trim() ||
      updates.supplier.address?.trim() ||
      updates.supplier.tinBin?.trim())
      ? {
          name: (updates.supplier.name || '').trim(),
          address: (updates.supplier.address || '').trim(),
          tinBin: (updates.supplier.tinBin || '').trim(),
        }
      : null;

  const ref = doc(db, 'bills', bill.id);
  const patch = {
    date: updates.date,
    billDate: updates.billDate || updates.date,
    tokenNo: (updates.tokenNo ?? bill.tokenNo ?? '').trim(),
    purposeText: (updates.purposeText ?? bill.purposeText ?? '').trim(),
    payeeText: (updates.payeeText ?? bill.payeeText ?? '').trim(),
    netPayableCode: (updates.netPayableCode ?? bill.netPayableCode ?? DEFAULT_NET_PAYABLE_CODE).trim(),
    supplier: updates.supplier !== undefined ? cleanSupplier : bill.supplier ?? null,
    deductions,
    vatVariant: updates.vatVariant,
    vatVariantLabel: updates.vatVariantLabel,
    vatRate: effectiveVatRate,
    itRate: effectiveItRate,
    grossAmount,
    vatAmount,
    itAmount,
    totalDeduction,
    netPayable,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  };
  const batch = writeBatch(db);
  batch.update(ref, patch);
  writeAuditLogInBatch(batch, {
    collection: 'bills',
    docId: bill.id,
    action: 'update',
    before: bill as unknown as Record<string, unknown>,
    after: { ...bill, ...patch } as unknown as Record<string, unknown>,
    actor,
  });
  await batch.commit();
}

export async function deleteDraftBill(bill: BillDoc, actor: AuditActor): Promise<void> {
  if (bill.status !== 'draft') {
    throw new Error('শুধুমাত্র খসড়া (draft) বিল মুছে ফেলা যায়।');
  }
  const batch = writeBatch(db);
  const billRef = doc(db, 'bills', bill.id);
  batch.update(billRef, {
    deleted: true,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });

  for (const itemId of bill.itemIds) {
    const itemRef = doc(db, 'expenseItems', itemId);
    batch.update(itemRef, {
      status: 'listed',
      billId: null,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
  }

  writeAuditLogInBatch(batch, {
    collection: 'bills',
    docId: bill.id,
    action: 'delete',
    before: bill as unknown as Record<string, unknown>,
    after: { ...bill, deleted: true } as unknown as Record<string, unknown>,
    actor,
  });
  await batch.commit();
}

/**
 * Distributes `totalAmount` across active budgets (FIFO by memoDate), capping each budget
 * up to its available capacity first and assigning any remainder to the first active budget.
 */
function distributeAmountAcrossBudgets(
  budgets: Array<BudgetDoc & { ref: DocumentReference }>,
  totalAmount: number,
  mode: 'pending' | 'approve',
  spendingLimits: SpendingLimitDoc[],
  date: string
): Array<{ budget: BudgetDoc & { ref: DocumentReference }; amount: number }> {
  const active = budgets
    .filter((b) => !b.deleted && b.status === 'active')
    .sort((a, b) => a.memoDate.localeCompare(b.memoDate));

  if (active.length === 0) {
    throw new Error('এই অর্থনৈতিক কোডের জন্য কোনো সক্রিয় বাজেট বরাদ্দ নেই।');
  }

  const slices: Array<{ budget: BudgetDoc & { ref: DocumentReference }; amount: number }> = [];
  let remainingToAllocate = totalAmount;

  for (const b of active) {
    if (remainingToAllocate <= 0) break;
    const pending = Math.max(0, b.pendingAmount || 0);
    let capacity = b.allocated - b.spent - pending;

    if (mode === 'approve') {
      const bLimits = spendingLimits.filter(
        (l) => l.type === 'budget' && l.fiscalYear === b.fiscalYear && l.budgetId === b.id
      );
      const activeBLimit = pickLatestEffectiveLimit(bLimits, date);
      if (activeBLimit) {
        const cap = Math.round((b.allocated * activeBLimit.rate) / 100);
        capacity = Math.min(capacity, cap - b.spent - pending);
      }
    }

    const take = Math.max(0, Math.min(remainingToAllocate, capacity));
    if (take > 0) {
      slices.push({ budget: b, amount: take });
      remainingToAllocate -= take;
    }
  }

  // If still remaining (only possible during Stage 1 submit warning or mixed revisions), attach to primary active budget
  if (remainingToAllocate > 0) {
    const primary = active[0];
    const existing = slices.find((s) => s.budget.id === primary.id);
    if (existing) {
      existing.amount += remainingToAllocate;
    } else {
      slices.push({ budget: primary, amount: remainingToAllocate });
    }
  }

  return slices;
}

export async function submitBillTx(
  billId: string,
  actor: AuditActor
): Promise<{ billNo: string }> {
  assertOnlineForTransaction('বিল জমা');

  const billRef = doc(db, 'bills', billId);
  const preBillSnap = await getDoc(billRef);
  if (!preBillSnap.exists() || preBillSnap.data().deleted) {
    throw new Error('বিলটি পাওয়া যায়নি।');
  }
  const preBill = preBillSnap.data() as Omit<BillDoc, 'id'>;

  const budgetsSnap = await getDocs(
    query(collection(db, 'budgets'), where('fiscalYear', '==', preBill.fiscalYear))
  );
  const budgetRefs = budgetsSnap.docs
    .filter((d) => !d.data().deleted && d.data().economicCode === preBill.economicCode)
    .map((d) => d.ref);
  if (budgetRefs.length === 0) {
    throw new Error(
      `অর্থনৈতিক কোড ${preBill.economicCode} এর জন্য FY ${preBill.fiscalYear}-এ কোনো বাজেট বরাদ্দ নেই।`
    );
  }

  const fyTotalRef = doc(db, 'fyCodeTotals', `${preBill.fiscalYear}_${preBill.economicCode}`);
  const counterRef = doc(db, 'counters', `${preBill.fiscalYear}_bill`);

  let assignedBillNo = preBill.billNo || '';

  await runTransaction(db, async (tx) => {
    const [billSnap, fyTotalSnap, counterSnap, ...budgetSnaps] = await Promise.all([
      tx.get(billRef),
      tx.get(fyTotalRef),
      tx.get(counterRef),
      ...budgetRefs.map((r) => tx.get(r)),
    ]);

    if (!billSnap.exists() || billSnap.data().deleted) {
      throw new Error('বিলটি পাওয়া যায়নি।');
    }
    const before = billSnap.data() as Omit<BillDoc, 'id'>;
    if (before.status !== 'draft') {
      throw new Error('শুধুমাত্র খসড়া (draft) বিল জমা দেওয়া যায়।');
    }

    const freshBudgets = budgetSnaps
      .filter((s) => s.exists() && !s.data()!.deleted)
      .map((s) => ({
        ...(s.data() as Omit<BudgetDoc, 'id'>),
        id: s.id,
        ref: s.ref,
      }));

    const slices = distributeAmountAcrossBudgets(
      freshBudgets,
      before.grossAmount,
      'pending',
      [],
      before.date
    );

    if (!before.billNo) {
      const nextNum = counterSnap.exists() ? (counterSnap.data().nextNumber as number) || 1 : 1;
      assignedBillNo = formatSequentialBillNo(before.fiscalYear, nextNum);
      tx.set(
        counterRef,
        {
          fiscalYear: before.fiscalYear,
          nextNumber: nextNum + 1,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        },
        { merge: true }
      );
    } else {
      assignedBillNo = before.billNo;
    }

    for (const s of slices) {
      const prevPending = Math.max(0, s.budget.pendingAmount || 0);
      const newPending = prevPending + s.amount;
      const newRemaining = s.budget.allocated - s.budget.spent - newPending;
      tx.update(s.budget.ref, {
        pendingAmount: newPending,
        remaining: newRemaining,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    }

    const prevFyPending = fyTotalSnap.exists()
      ? Math.max(0, (fyTotalSnap.data().pendingAmount as number) || 0)
      : freshBudgets.reduce((sum, b) => sum + Math.max(0, b.pendingAmount || 0), 0);

    if (fyTotalSnap.exists()) {
      tx.update(fyTotalRef, {
        pendingAmount: prevFyPending + before.grossAmount,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    } else {
      const prevFyAlloc = freshBudgets.reduce((sum, b) => sum + b.allocated, 0);
      const prevFySpent = freshBudgets.reduce((sum, b) => sum + b.spent, 0);
      tx.set(fyTotalRef, {
        fiscalYear: before.fiscalYear,
        economicCode: before.economicCode,
        allocated: prevFyAlloc,
        spent: prevFySpent,
        approvedSpent: prevFySpent,
        pendingAmount: prevFyPending + before.grossAmount,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    }

    const pendingSlices: BillBudgetSlice[] = slices.map((s) => ({
      budgetId: s.budget.id,
      amount: s.amount,
    }));

    const afterFields = {
      billNo: assignedBillNo,
      status: 'submitted' as BillStatus,
      submittedAt: serverTimestamp(),
      submittedBy: actor.uid,
      rejectReason: null,
      pendingSlices,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };

    tx.update(billRef, afterFields);
    writeAuditLogInTx(tx, {
      collection: 'bills',
      docId: billId,
      action: 'submit',
      before: { id: billId, ...before },
      after: { id: billId, ...before, ...afterFields },
      actor,
    });
  });

  return { billNo: assignedBillNo };
}

export async function approveBillTx(billId: string, actor: AuditActor): Promise<void> {
  assertOnlineForTransaction('বিল অনুমোদন');

  const billRef = doc(db, 'bills', billId);
  const preBillSnap = await getDoc(billRef);
  if (!preBillSnap.exists() || preBillSnap.data().deleted) {
    throw new Error('বিলটি পাওয়া যায়নি।');
  }
  const preBill = preBillSnap.data() as Omit<BillDoc, 'id'>;

  const [budgetsSnap, limitsSnap] = await Promise.all([
    getDocs(query(collection(db, 'budgets'), where('fiscalYear', '==', preBill.fiscalYear))),
    getDocs(query(collection(db, 'spendingLimits'), where('fiscalYear', '==', preBill.fiscalYear))),
  ]);

  const budgetRefMap = new Map<string, DocumentReference>();
  for (const d of budgetsSnap.docs) {
    if (!d.data().deleted && d.data().economicCode === preBill.economicCode) {
      budgetRefMap.set(d.id, d.ref);
    }
  }
  for (const sl of preBill.pendingSlices || []) {
    if (!budgetRefMap.has(sl.budgetId)) {
      budgetRefMap.set(sl.budgetId, doc(db, 'budgets', sl.budgetId));
    }
  }
  const budgetRefs = Array.from(budgetRefMap.values());
  const limitRefs = limitsSnap.docs
    .filter((d) => d.data().status === 'active')
    .map((d) => d.ref);
  const fyTotalRef = doc(db, 'fyCodeTotals', `${preBill.fiscalYear}_${preBill.economicCode}`);

  await runTransaction(db, async (tx) => {
    const [billSnap, fyTotalSnap, ...restSnaps] = await Promise.all([
      tx.get(billRef),
      tx.get(fyTotalRef),
      ...budgetRefs.map((r) => tx.get(r)),
      ...limitRefs.map((r) => tx.get(r)),
    ]);

    if (!billSnap.exists() || billSnap.data().deleted) {
      throw new Error('বিলটি পাওয়া যায়নি।');
    }
    const before = billSnap.data() as Omit<BillDoc, 'id'>;
    if (before.status !== 'submitted') {
      throw new Error('শুধুমাত্র জমাকৃত (submitted) বিল অনুমোদন করা যায়।');
    }

    const budgetSnaps = restSnaps.slice(0, budgetRefs.length) as DocumentSnapshot[];
    const limitSnaps = restSnaps.slice(budgetRefs.length) as DocumentSnapshot[];

    const freshLimits: SpendingLimitDoc[] = limitSnaps
      .filter((s) => s.exists())
      .map((s) => ({ id: s.id, ...s.data() } as SpendingLimitDoc));

    // Step 1: Reverse this bill's own pendingSlices in memory first
    const pendingReleaseMap = new Map<string, number>();
    for (const sl of before.pendingSlices || []) {
      pendingReleaseMap.set(sl.budgetId, (pendingReleaseMap.get(sl.budgetId) || 0) + sl.amount);
    }

    const freshBudgets = budgetSnaps
      .filter((s) => s.exists() && !s.data()!.deleted)
      .map((s) => {
        const b = s.data() as Omit<BudgetDoc, 'id'>;
        const release = pendingReleaseMap.get(s.id) || 0;
        const adjustedPending = Math.max(0, (b.pendingAmount || 0) - release);
        return {
          ...b,
          id: s.id,
          pendingAmount: adjustedPending,
          ref: s.ref,
        };
      });

    const rawFyTotal = fyTotalSnap.exists()
      ? ({ id: fyTotalSnap.id, ...fyTotalSnap.data() } as FyCodeTotalDoc)
      : {
          id: fyTotalRef.id,
          fiscalYear: before.fiscalYear,
          economicCode: before.economicCode,
          allocated: freshBudgets.reduce((sum, b) => sum + b.allocated, 0),
          spent: freshBudgets.reduce((sum, b) => sum + b.spent, 0),
          pendingAmount: before.grossAmount,
        };

    // Step 2: Re-validate final available budget & all active ministry caps (excluding this bill's own pending hold)
    const capCheck = computeCodeAvailable({
      fiscalYear: before.fiscalYear,
      economicCode: before.economicCode,
      budgets: freshBudgets,
      fyCodeTotal: rawFyTotal,
      spendingLimits: freshLimits,
      date: before.date,
      gross: before.grossAmount,
      excludePendingAmount: before.grossAmount,
    });

    if (!capCheck.allowed) {
      throw new Error(capCheck.limitingConstraint.exceededMessage);
    }

    // Step 3: Allocate approvedSpent across active budgets (respecting budget-level caps)
    const activeBudgets = freshBudgets.filter((b) => b.status === 'active');
    if (activeBudgets.length === 0) {
      throw new Error('এই কোডে কোনো সক্রিয় (active) বাজেট নেই। সম্পন্ন (executed) বাজেটে অনুমোদন দেওয়া যায় না।');
    }

    // Check individual budget capacities under budget-level caps
    const totalIndividualCap = activeBudgets.reduce((sum, b) => {
      const res = computeAvailable({
        budget: b,
        fyCodeTotal: {
          ...rawFyTotal,
          pendingAmount: Math.max(0, (rawFyTotal.pendingAmount || 0) - before.grossAmount),
        },
        spendingLimits: freshLimits,
        date: before.date,
        gross: before.grossAmount,
      });
      return sum + Math.max(0, res.budgetLimitHeadroom ?? res.budgetHeadroom);
    }, 0);

    if (before.grossAmount > totalIndividualCap) {
      throw new Error(
        `সক্রিয় বাজেট ও বাজেট-স্তরের সীমার কারণে ${before.economicCode} কোডের এই বিল অনুমোদন করা যাচ্ছে না।`
      );
    }

    const approveSlices = distributeAmountAcrossBudgets(
      freshBudgets,
      before.grossAmount,
      'approve',
      freshLimits,
      before.date
    );

    const approveAddMap = new Map<string, number>();
    for (const s of approveSlices) {
      approveAddMap.set(s.budget.id, (approveAddMap.get(s.budget.id) || 0) + s.amount);
    }

    for (const b of freshBudgets) {
      const hadPendingRelease = pendingReleaseMap.has(b.id);
      const addApproved = approveAddMap.get(b.id) || 0;
      if (!hadPendingRelease && addApproved === 0) continue;

      const newSpent = b.spent + addApproved;
      const newPending = Math.max(0, b.pendingAmount || 0);
      const newRemaining = b.allocated - newSpent - newPending;

      tx.update(b.ref, {
        spent: newSpent,
        approvedSpent: newSpent,
        pendingAmount: newPending,
        remaining: newRemaining,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    }

    const newFySpent = (rawFyTotal.spent || 0) + before.grossAmount;
    const newFyPending = Math.max(0, (rawFyTotal.pendingAmount || 0) - before.grossAmount);

    tx.set(
      fyTotalRef,
      {
        fiscalYear: before.fiscalYear,
        economicCode: before.economicCode,
        allocated: rawFyTotal.allocated,
        spent: newFySpent,
        approvedSpent: newFySpent,
        pendingAmount: newFyPending,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      },
      { merge: true }
    );

    const budgetDeductions: BillBudgetSlice[] = approveSlices.map((s) => ({
      budgetId: s.budget.id,
      amount: s.amount,
    }));

    const afterFields = {
      status: 'approved' as BillStatus,
      approvedBy: actor.uid,
      approvedAt: serverTimestamp(),
      pendingSlices: [],
      budgetDeductions,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };

    tx.update(billRef, afterFields);
    writeAuditLogInTx(tx, {
      collection: 'bills',
      docId: billId,
      action: 'approve',
      before: { id: billId, ...before },
      after: { id: billId, ...before, ...afterFields },
      actor,
    });
  });
}

export async function rejectBillTx(
  billId: string,
  reasonInput: string,
  actor: AuditActor
): Promise<void> {
  assertOnlineForTransaction('বিল প্রত্যাখ্যান');
  const reason = reasonInput.trim();
  if (!reason) throw new Error('প্রত্যাখ্যানের কারণ উল্লেখ করা আবশ্যক।');

  const billRef = doc(db, 'bills', billId);
  const preBillSnap = await getDoc(billRef);
  if (!preBillSnap.exists() || preBillSnap.data().deleted) {
    throw new Error('বিলটি পাওয়া যায়নি।');
  }
  const preBill = preBillSnap.data() as Omit<BillDoc, 'id'>;

  const budgetRefs = (preBill.pendingSlices || []).map((sl) => doc(db, 'budgets', sl.budgetId));
  const itemRefs = (preBill.itemIds || []).map((id) => doc(db, 'expenseItems', id));
  const fyTotalRef = doc(db, 'fyCodeTotals', `${preBill.fiscalYear}_${preBill.economicCode}`);

  await runTransaction(db, async (tx) => {
    const [billSnap, fyTotalSnap, ...otherSnaps] = await Promise.all([
      tx.get(billRef),
      tx.get(fyTotalRef),
      ...budgetRefs.map((r) => tx.get(r)),
      ...itemRefs.map((r) => tx.get(r)),
    ]);

    if (!billSnap.exists() || billSnap.data().deleted) {
      throw new Error('বিলটি পাওয়া যায়নি।');
    }
    const before = billSnap.data() as Omit<BillDoc, 'id'>;
    if (before.status !== 'submitted') {
      throw new Error('শুধুমাত্র জমাকৃত (submitted) বিল প্রত্যাখ্যান করা যায়।');
    }

    const budgetSnaps = otherSnaps.slice(0, budgetRefs.length) as DocumentSnapshot[];
    const itemSnaps = otherSnaps.slice(budgetRefs.length) as DocumentSnapshot[];

    const sliceMap = new Map<string, number>();
    for (const sl of before.pendingSlices || []) {
      sliceMap.set(sl.budgetId, (sliceMap.get(sl.budgetId) || 0) + sl.amount);
    }

    for (const bSnap of budgetSnaps) {
      if (!bSnap.exists()) continue;
      const b = bSnap.data() as Omit<BudgetDoc, 'id'>;
      const release = sliceMap.get(bSnap.id) || 0;
      const newPending = Math.max(0, (b.pendingAmount || 0) - release);
      const newRemaining = b.allocated - b.spent - newPending;
      tx.update(bSnap.ref, {
        pendingAmount: newPending,
        remaining: newRemaining,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    }

    if (fyTotalSnap.exists()) {
      const f = fyTotalSnap.data() as Omit<FyCodeTotalDoc, 'id'>;
      tx.update(fyTotalRef, {
        pendingAmount: Math.max(0, (f.pendingAmount || 0) - before.grossAmount),
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    }

    for (const itemSnap of itemSnaps) {
      if (!itemSnap.exists() || itemSnap.data()?.deleted) continue;
      tx.update(itemSnap.ref, {
        status: 'listed',
        billId: null,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    }

    const afterFields = {
      status: 'rejected' as BillStatus,
      rejectReason: reason,
      pendingSlices: [],
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };

    tx.update(billRef, afterFields);
    writeAuditLogInTx(tx, {
      collection: 'bills',
      docId: billId,
      action: 'reject',
      before: { id: billId, ...before },
      after: { id: billId, ...before, ...afterFields },
      actor,
    });
  });
}

export async function cancelApprovedBillTx(
  billId: string,
  reasonInput: string,
  actor: AuditActor
): Promise<void> {
  assertOnlineForTransaction('অনুমোদিত বিল বাতিল');
  const reason = reasonInput.trim();
  if (!reason) throw new Error('বিল বাতিলের কারণ উল্লেখ করা আবশ্যক।');

  const billRef = doc(db, 'bills', billId);
  const preBillSnap = await getDoc(billRef);
  if (!preBillSnap.exists() || preBillSnap.data().deleted) {
    throw new Error('বিলটি পাওয়া যায়নি।');
  }
  const preBill = preBillSnap.data() as Omit<BillDoc, 'id'>;

  let budgetRefs: DocumentReference[] = (preBill.budgetDeductions || []).map((d) =>
    doc(db, 'budgets', d.budgetId)
  );
  if (budgetRefs.length === 0) {
    const codeBudgetsSnap = await getDocs(
      query(collection(db, 'budgets'), where('fiscalYear', '==', preBill.fiscalYear))
    );
    budgetRefs = codeBudgetsSnap.docs
      .filter((d) => !d.data().deleted && d.data().economicCode === preBill.economicCode)
      .map((d) => d.ref);
  }
  const itemRefs = (preBill.itemIds || []).map((id) => doc(db, 'expenseItems', id));
  const fyTotalRef = doc(db, 'fyCodeTotals', `${preBill.fiscalYear}_${preBill.economicCode}`);

  await runTransaction(db, async (tx) => {
    const [billSnap, fyTotalSnap, ...otherSnaps] = await Promise.all([
      tx.get(billRef),
      tx.get(fyTotalRef),
      ...budgetRefs.map((r) => tx.get(r)),
      ...itemRefs.map((r) => tx.get(r)),
    ]);

    if (!billSnap.exists() || billSnap.data().deleted) {
      throw new Error('বিলটি পাওয়া যায়নি।');
    }
    const before = billSnap.data() as Omit<BillDoc, 'id'>;
    if (before.status !== 'approved') {
      throw new Error('শুধুমাত্র অনুমোদিত (approved) বিল বাতিল করা যায়।');
    }

    const budgetSnaps = otherSnaps.slice(0, budgetRefs.length) as DocumentSnapshot[];
    const itemSnaps = otherSnaps.slice(budgetRefs.length) as DocumentSnapshot[];

    if (before.budgetDeductions && before.budgetDeductions.length > 0) {
      const dedMap = new Map<string, number>();
      for (const sl of before.budgetDeductions) {
        dedMap.set(sl.budgetId, (dedMap.get(sl.budgetId) || 0) + sl.amount);
      }
      for (const bSnap of budgetSnaps) {
        if (!bSnap.exists()) continue;
        const b = bSnap.data() as Omit<BudgetDoc, 'id'>;
        const restore = dedMap.get(bSnap.id) || 0;
        const newSpent = Math.max(0, b.spent - restore);
        const pending = Math.max(0, b.pendingAmount || 0);
        const newRemaining = b.allocated - newSpent - pending;
        tx.update(bSnap.ref, {
          spent: newSpent,
          approvedSpent: newSpent,
          remaining: newRemaining,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        });
      }
    } else {
      // Fallback reversal across code's budgets if migrated without budgetDeductions
      let toRestore = before.grossAmount;
      for (const bSnap of budgetSnaps) {
        if (!bSnap.exists() || toRestore <= 0) continue;
        const b = bSnap.data() as Omit<BudgetDoc, 'id'>;
        const take = Math.min(toRestore, Math.max(0, b.spent));
        if (take > 0) {
          const newSpent = b.spent - take;
          const pending = Math.max(0, b.pendingAmount || 0);
          tx.update(bSnap.ref, {
            spent: newSpent,
            approvedSpent: newSpent,
            remaining: b.allocated - newSpent - pending,
            updatedAt: serverTimestamp(),
            updatedBy: actor.uid,
          });
          toRestore -= take;
        }
      }
    }

    if (fyTotalSnap.exists()) {
      const f = fyTotalSnap.data() as Omit<FyCodeTotalDoc, 'id'>;
      const newFySpent = Math.max(0, (f.spent || 0) - before.grossAmount);
      tx.update(fyTotalRef, {
        spent: newFySpent,
        approvedSpent: newFySpent,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    }

    for (const itemSnap of itemSnaps) {
      if (!itemSnap.exists() || itemSnap.data()?.deleted) continue;
      tx.update(itemSnap.ref, {
        status: 'listed',
        billId: null,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    }

    const afterFields = {
      status: 'cancelled' as BillStatus,
      cancelledBy: actor.uid,
      cancelledAt: serverTimestamp(),
      cancelReason: reason,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };

    tx.update(billRef, afterFields);
    writeAuditLogInTx(tx, {
      collection: 'bills',
      docId: billId,
      action: 'cancel',
      before: { id: billId, ...before },
      after: { id: billId, ...before, ...afterFields },
      actor,
    });
  });
}

/* ============================================================================
 * IDEMPOTENT MIGRATION: Legacy `spendings` -> `bills` + `expenseItems`
 * ============================================================================ */

export interface MigrationPreviewReport {
  totalLegacySpendings: number;
  alreadyMigratedCount: number;
  toMigrateCount: number;
  byStatus: {
    approved: number;
    submitted: number;
    draft: number;
    rejected: number;
    cancelledFromVoided: number;
  };
  budgetsNeedingSync: number;
  fyTotalsNeedingSync: number;
}

export interface MigrationRunResult {
  migratedBills: number;
  migratedItems: number;
  skippedExisting: number;
  syncedBudgets: number;
  syncedFyTotals: number;
}

function mapLegacyStatusToBillStatus(status: SpendingDoc['status']): BillStatus {
  return status === 'voided' ? 'cancelled' : status;
}

export async function previewLegacySpendingsMigration(): Promise<MigrationPreviewReport> {
  const [spendingsSnap, billsSnap, budgetsSnap, fyTotalsSnap] = await Promise.all([
    getDocs(collection(db, 'spendings')),
    getDocs(collection(db, 'bills')),
    getDocs(collection(db, 'budgets')),
    getDocs(collection(db, 'fyCodeTotals')),
  ]);

  const activeSpendings = spendingsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() } as SpendingDoc))
    .filter((s) => !s.deleted);

  const existingBillIds = new Set(billsSnap.docs.map((d) => d.id));
  const existingMigratedIds = new Set(
    billsSnap.docs
      .map((d) => d.data().migratedFromSpendingId as string | undefined)
      .filter(Boolean)
  );

  const byStatus = {
    approved: 0,
    submitted: 0,
    draft: 0,
    rejected: 0,
    cancelledFromVoided: 0,
  };
  let alreadyMigratedCount = 0;
  let toMigrateCount = 0;

  for (const sp of activeSpendings) {
    const detBillId = `mig_bill_${sp.id}`;
    if (existingBillIds.has(detBillId) || existingMigratedIds.has(sp.id)) {
      alreadyMigratedCount++;
      continue;
    }
    toMigrateCount++;
    if (sp.status === 'approved') byStatus.approved++;
    else if (sp.status === 'submitted') byStatus.submitted++;
    else if (sp.status === 'draft') byStatus.draft++;
    else if (sp.status === 'rejected') byStatus.rejected++;
    else if (sp.status === 'voided') byStatus.cancelledFromVoided++;
  }

  let budgetsNeedingSync = 0;
  for (const d of budgetsSnap.docs) {
    const b = d.data() as BudgetDoc;
    if (b.deleted) continue;
    if (b.approvedSpent === undefined || b.pendingAmount === undefined) {
      budgetsNeedingSync++;
    }
  }

  let fyTotalsNeedingSync = 0;
  for (const d of fyTotalsSnap.docs) {
    const f = d.data() as FyCodeTotalDoc;
    if (f.approvedSpent === undefined || f.pendingAmount === undefined) {
      fyTotalsNeedingSync++;
    }
  }

  return {
    totalLegacySpendings: activeSpendings.length,
    alreadyMigratedCount,
    toMigrateCount,
    byStatus,
    budgetsNeedingSync,
    fyTotalsNeedingSync,
  };
}

export async function runLegacySpendingsMigration(
  actor: AuditActor
): Promise<MigrationRunResult> {
  const [spendingsSnap, billsSnap, itemsSnap, budgetsSnap, fyTotalsSnap] = await Promise.all([
    getDocs(collection(db, 'spendings')),
    getDocs(collection(db, 'bills')),
    getDocs(collection(db, 'expenseItems')),
    getDocs(collection(db, 'budgets')),
    getDocs(collection(db, 'fyCodeTotals')),
  ]);

  const activeSpendings = spendingsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() } as SpendingDoc))
    .filter((s) => !s.deleted);

  const existingBillIds = new Set(billsSnap.docs.map((d) => d.id));
  const existingItemIds = new Set(itemsSnap.docs.map((d) => d.id));
  const existingMigratedIds = new Set(
    billsSnap.docs
      .map((d) => d.data().migratedFromSpendingId as string | undefined)
      .filter(Boolean)
  );

  // Track submitted legacy bills to add into pendingAmount ONLY for newly migrated submitted entries
  const pendingDeltaByBudget = new Map<string, number>();
  const pendingDeltaByFyCode = new Map<string, number>();

  const toCreate: Array<{
    billId: string;
    itemId: string;
    billPayload: Record<string, unknown>;
    itemPayload: Record<string, unknown> | null;
  }> = [];

  let skippedExisting = 0;

  for (const sp of activeSpendings) {
    const detBillId = `mig_bill_${sp.id}`;
    const detItemId = `mig_item_${sp.id}`;
    if (existingBillIds.has(detBillId) || existingMigratedIds.has(sp.id)) {
      skippedExisting++;
      continue;
    }

    const mappedStatus = mapLegacyStatusToBillStatus(sp.status);
    const vatAmt = sp.deductions?.vat || 0;
    const itAmt = sp.deductions?.it || 0;
    const extraAmt =
      (sp.deductions?.serviceCharge || 0) +
      (sp.deductions?.others || []).reduce((s, o) => s + o.amount, 0);
    const totalDeduction = vatAmt + itAmt + extraAmt;
    const netPayable = sp.netPayable ?? sp.gross - totalDeduction;

    const itemStatus =
      mappedStatus === 'rejected' || mappedStatus === 'cancelled' ? 'listed' : 'billed';

    const desc = sp.chequeNo ? `${sp.payee} (Cheque: ${sp.chequeNo})` : sp.payee;
    const employee: ResponsibleEmployee = {
      userId: null,
      name: sp.payee || 'Legacy Payee',
      designation: 'Legacy Record',
    };

    const itemPayload = existingItemIds.has(detItemId)
      ? null
      : {
          fiscalYear: sp.fiscalYear,
          economicCode: sp.economicCode,
          headName: sp.headName,
          headNameBn: sp.headNameBn || '',
          date: sp.date,
          description: desc,
          amount: sp.gross,
          responsibleEmployee: employee,
          status: itemStatus,
          billId: itemStatus === 'billed' ? detBillId : null,
          deleted: false,
          createdAt: sp.createdAt || serverTimestamp(),
          createdBy: sp.createdBy || actor.uid,
          createdByName: sp.createdByName || actor.name,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        };

    const pendingSlices: BillBudgetSlice[] =
      mappedStatus === 'submitted' && sp.budgetId
        ? [{ budgetId: sp.budgetId, amount: sp.gross }]
        : [];
    const budgetDeductions: BillBudgetSlice[] =
      mappedStatus === 'approved' && sp.budgetId
        ? [{ budgetId: sp.budgetId, amount: sp.gross }]
        : [];

    if (mappedStatus === 'submitted') {
      if (sp.budgetId) {
        pendingDeltaByBudget.set(
          sp.budgetId,
          (pendingDeltaByBudget.get(sp.budgetId) || 0) + sp.gross
        );
      }
      const fyCodeKey = `${sp.fiscalYear}_${sp.economicCode}`;
      pendingDeltaByFyCode.set(fyCodeKey, (pendingDeltaByFyCode.get(fyCodeKey) || 0) + sp.gross);
    }

    const billPayload = {
      billNo: sp.billNo || (mappedStatus === 'draft' ? '' : `LEG-${sp.id.slice(0, 6)}`),
      fiscalYear: sp.fiscalYear,
      economicCode: sp.economicCode,
      headName: sp.headName,
      headNameBn: sp.headNameBn || '',
      date: sp.date,
      itemIds: [detItemId],
      items: [
        {
          id: detItemId,
          date: sp.date,
          description: desc,
          amount: sp.gross,
          responsibleEmployee: employee,
        },
      ],
      grossAmount: sp.gross,
      vatRate: sp.deductionsApplied?.vatRate || 0,
      itRate: sp.deductionsApplied?.itRate || 0,
      vatVariant: sp.vatVariant || 'default',
      vatVariantLabel: sp.vatVariant || 'Standard',
      vatAmount: vatAmt,
      itAmount: itAmt,
      totalDeduction,
      netPayable,
      status: mappedStatus,
      submittedAt: sp.submittedAt || null,
      submittedBy: sp.createdBy || actor.uid,
      approvedBy: sp.approvedBy || null,
      approvedAt: sp.approvedAt || null,
      rejectReason: sp.rejectReason || null,
      cancelledBy: sp.status === 'voided' ? sp.voidedBy || actor.uid : null,
      cancelledAt: sp.status === 'voided' ? sp.voidedAt || serverTimestamp() : null,
      cancelReason: sp.status === 'voided' ? sp.voidReason || 'Legacy voided entry' : null,
      pendingSlices,
      budgetDeductions,
      migratedFromSpendingId: sp.id,
      deleted: false,
      createdAt: sp.createdAt || serverTimestamp(),
      createdBy: sp.createdBy || actor.uid,
      createdByName: sp.createdByName || actor.name,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };

    toCreate.push({ billId: detBillId, itemId: detItemId, billPayload, itemPayload });
  }

  let migratedBills = 0;
  let migratedItems = 0;

  for (let i = 0; i < toCreate.length; i += 150) {
    const chunk = toCreate.slice(i, i + 150);
    const batch = writeBatch(db);
    for (const entry of chunk) {
      batch.set(doc(db, 'bills', entry.billId), entry.billPayload);
      migratedBills++;
      if (entry.itemPayload) {
        batch.set(doc(db, 'expenseItems', entry.itemId), entry.itemPayload);
        migratedItems++;
      }
    }
    await batch.commit();
  }

  // Sync budgets (do NOT re-deduct already approved spent; only ensure approvedSpent/pendingAmount/remaining fields match)
  let syncedBudgets = 0;
  const budgetDocsToUpdate = budgetsSnap.docs.filter((d) => {
    const b = d.data() as BudgetDoc;
    if (b.deleted) return false;
    return (
      pendingDeltaByBudget.has(d.id) ||
      b.approvedSpent === undefined ||
      b.pendingAmount === undefined
    );
  });

  for (let i = 0; i < budgetDocsToUpdate.length; i += 350) {
    const chunk = budgetDocsToUpdate.slice(i, i + 350);
    const batch = writeBatch(db);
    for (const d of chunk) {
      const b = d.data() as BudgetDoc;
      const pending = Math.max(0, b.pendingAmount || 0) + (pendingDeltaByBudget.get(d.id) || 0);
      const spent = b.spent || 0;
      batch.update(d.ref, {
        approvedSpent: spent,
        pendingAmount: pending,
        remaining: b.allocated - spent - pending,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
      syncedBudgets++;
    }
    await batch.commit();
  }

  // Sync fyCodeTotals
  let syncedFyTotals = 0;
  const fyDocsToUpdate = fyTotalsSnap.docs.filter((d) => {
    const f = d.data() as FyCodeTotalDoc;
    return (
      pendingDeltaByFyCode.has(d.id) ||
      f.approvedSpent === undefined ||
      f.pendingAmount === undefined
    );
  });

  for (let i = 0; i < fyDocsToUpdate.length; i += 350) {
    const chunk = fyDocsToUpdate.slice(i, i + 350);
    const batch = writeBatch(db);
    for (const d of chunk) {
      const f = d.data() as FyCodeTotalDoc;
      const pending = Math.max(0, f.pendingAmount || 0) + (pendingDeltaByFyCode.get(d.id) || 0);
      const spent = f.spent || 0;
      batch.update(d.ref, {
        approvedSpent: spent,
        pendingAmount: pending,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
      syncedFyTotals++;
    }
    await batch.commit();
  }

  // Write audit summary
  const auditBatch = writeBatch(db);
  writeAuditLogInBatch(auditBatch, {
    collection: 'bills',
    docId: 'legacy_spendings_migration',
    action: 'migrate',
    before: null,
    after: {
      migratedBills,
      migratedItems,
      skippedExisting,
      syncedBudgets,
      syncedFyTotals,
    },
    actor,
  });
  await auditBatch.commit();

  return {
    migratedBills,
    migratedItems,
    skippedExisting,
    syncedBudgets,
    syncedFyTotals,
  };
}

/* ============================================================================
 * VAT & TAX RATES, SPENDING LIMITS, USERS, INVITES, SETTINGS, ECONOMIC CODES
 * ============================================================================ */

export async function upsertVatTaxRate(
  input: {
    fiscalYear: string;
    economicCode: string;
    description: string;
    descriptionBn: string;
    incomeTax: number;
    vat: VatVariant[];
  },
  isNew: boolean,
  actor: AuditActor
): Promise<void> {
  const code = input.economicCode.trim();
  if (!isValidEconomicCode(code, true)) {
    throw new Error('Economic code must be 7 digits or GENERAL-CONSTRUCTION.');
  }
  if (input.vat.length === 0) throw new Error('At least one VAT rate entry is required.');

  const masterSnap = await getDoc(doc(db, 'economicCodes', code));
  if (!masterSnap.exists()) {
    throw new Error(`Economic code "${code}" does not exist in Economic Codes.`);
  }
  const masterData = masterSnap.data() as Omit<EconomicCodeDoc, 'id'>;
  const resolvedDesc = masterData.headName || input.description.trim();
  const resolvedDescBn = masterData.headNameBn || input.descriptionBn.trim();
  if (!resolvedDesc) throw new Error('Head name is required.');

  const docId = `${input.fiscalYear}_${code}`;
  const ref = doc(db, 'vatTaxRates', docId);

  const batch = writeBatch(db);
  const payload = {
    fiscalYear: input.fiscalYear,
    economicCode: code,
    description: resolvedDesc,
    descriptionBn: resolvedDescBn,
    incomeTax: input.incomeTax,
    vat: input.vat,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
    ...(isNew ? { createdAt: serverTimestamp(), createdBy: actor.uid } : {}),
  };
  batch.set(ref, payload, { merge: true });
  writeAuditLogInBatch(batch, {
    collection: 'vatTaxRates',
    docId,
    action: isNew ? 'create' : 'update',
    before: null,
    after: { id: docId, ...payload },
    actor,
  });
  await batch.commit();
}

export async function copyVatTaxRatesToFy(
  rates: VatTaxRateDoc[],
  targetFy: string,
  actor: AuditActor
): Promise<number> {
  if (rates.length === 0) return 0;
  const batch = writeBatch(db);
  for (const r of rates) {
    const newId = `${targetFy}_${r.economicCode}`;
    const ref = doc(db, 'vatTaxRates', newId);
    const payload = {
      fiscalYear: targetFy,
      economicCode: r.economicCode,
      description: r.description,
      descriptionBn: r.descriptionBn,
      incomeTax: r.incomeTax,
      vat: r.vat,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    batch.set(ref, payload, { merge: true });
    writeAuditLogInBatch(batch, {
      collection: 'vatTaxRates',
      docId: newId,
      action: 'create',
      before: null,
      after: { id: newId, ...payload },
      actor,
    });
  }
  await batch.commit();
  return rates.length;
}

export async function createSpendingLimitTx(
  input: {
    type: SpendingLimitType;
    budgetId: string | null;
    fiscalYear: string;
    economicCode: string;
    headName: string;
    headNameBn: string;
    rate: number;
    effectiveDate: string;
    refNo: string;
  },
  actor: AuditActor
): Promise<string> {
  const code = input.economicCode.trim();
  if (!isValidEconomicCode(code, false)) {
    throw new Error('Economic code must be 7 digits.');
  }
  const masterSnap = await getDoc(doc(db, 'economicCodes', code));
  if (!masterSnap.exists()) {
    throw new Error(`Economic code "${code}" does not exist in Economic Codes.`);
  }
  const masterData = masterSnap.data() as Omit<EconomicCodeDoc, 'id'>;
  if (masterData.special) {
    throw new Error('GENERAL-CONSTRUCTION cannot be used for a spending limit.');
  }

  if (input.type === 'budget' && !input.budgetId) {
    throw new Error('Select a budget for a single-budget limit.');
  }
  if (input.rate <= 0 || input.rate > 100) {
    throw new Error('Rate must be between 1 and 100 percent.');
  }
  if (!isDateInFiscalYear(input.effectiveDate, input.fiscalYear)) {
    throw new Error(`Effective date must fall inside FY ${input.fiscalYear}.`);
  }
  if (!input.refNo.trim()) throw new Error('Letter / reference number is required.');

  const ref = doc(collection(db, 'spendingLimits'));
  const batch = writeBatch(db);
  const payload = {
    type: input.type,
    budgetId: input.type === 'budget' ? input.budgetId : null,
    fiscalYear: input.fiscalYear,
    economicCode: code,
    headName: masterData.headName || input.headName.trim(),
    headNameBn: masterData.headNameBn || input.headNameBn.trim(),
    rate: input.rate,
    unit: 'percent' as const,
    effectiveDate: input.effectiveDate,
    refNo: input.refNo.trim(),
    status: 'active' as const,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  };
  batch.set(ref, payload);
  writeAuditLogInBatch(batch, {
    collection: 'spendingLimits',
    docId: ref.id,
    action: 'create',
    before: null,
    after: { id: ref.id, ...payload },
    actor,
  });
  await batch.commit();
  return ref.id;
}

export async function withdrawSpendingLimit(
  limitDoc: SpendingLimitDoc,
  actor: AuditActor
): Promise<void> {
  const batch = writeBatch(db);
  const ref = doc(db, 'spendingLimits', limitDoc.id);
  batch.update(ref, {
    status: 'withdrawn',
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });
  writeAuditLogInBatch(batch, {
    collection: 'spendingLimits',
    docId: limitDoc.id,
    action: 'update',
    before: limitDoc as unknown as Record<string, unknown>,
    after: { ...limitDoc, status: 'withdrawn' } as unknown as Record<string, unknown>,
    actor,
  });
  await batch.commit();
}

export async function createInvite(
  input: { email: string; name?: string; designation: string; role: Role },
  actor: AuditActor
): Promise<void> {
  const emailLower = normalizeEmail(input.email);
  if (!emailLower || !emailLower.includes('@')) {
    throw new Error('Enter a valid email address.');
  }
  if (!input.designation.trim()) {
    throw new Error('Designation is required.');
  }
  const ref = doc(db, 'invites', emailLower);
  const batch = writeBatch(db);
  const payload = {
    email: emailLower,
    name: input.name?.trim() || '',
    designation: input.designation.trim(),
    role: input.role,
    invitedBy: actor.uid,
    createdAt: serverTimestamp(),
    createdBy: actor.uid,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  };
  batch.set(ref, payload);
  writeAuditLogInBatch(batch, {
    collection: 'invites',
    docId: emailLower,
    action: 'create',
    before: null,
    after: { id: emailLower, ...payload },
    actor,
  });
  await batch.commit();
}

export async function deleteInvite(emailLower: string, actor: AuditActor): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'invites', emailLower));
  writeAuditLogInBatch(batch, {
    collection: 'invites',
    docId: emailLower,
    action: 'delete',
    before: { email: emailLower },
    after: null,
    actor,
  });
  await batch.commit();
}

export async function updateUserRoleOrStatus(
  userId: string,
  updates: { role?: Role; status?: UserStatus; designation?: string },
  beforeUser: Record<string, unknown>,
  actor: AuditActor
): Promise<void> {
  const batch = writeBatch(db);
  const ref = doc(db, 'users', userId);
  const patch = {
    ...updates,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  };
  batch.update(ref, patch);
  writeAuditLogInBatch(batch, {
    collection: 'users',
    docId: userId,
    action: 'update',
    before: beforeUser,
    after: { ...beforeUser, ...patch },
    actor,
  });
  await batch.commit();
}

export async function saveOfficeSettings(
  settings: Partial<OfficeSettings>,
  actor: AuditActor
): Promise<void> {
  const batch = writeBatch(db);
  const ref = doc(db, 'settings', 'office');
  const patch = {
    ...settings,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  };
  batch.set(ref, patch, { merge: true });
  writeAuditLogInBatch(batch, {
    collection: 'settings',
    docId: 'office',
    action: 'update',
    before: null,
    after: patch,
    actor,
  });
  await batch.commit();
}

export async function upsertEconomicCode(
  input: {
    code: string;
    headName: string;
    headNameBn: string;
    active: boolean;
  },
  actor: AuditActor
): Promise<EconomicCodeDoc> {
  const code = input.code.trim();
  const isSpecial = code === 'GENERAL-CONSTRUCTION';
  if (!isValidEconomicCode(code, true)) {
    throw new Error('Economic code must be exactly 7 digits.');
  }
  const headName = input.headName.trim();
  const headNameBn = input.headNameBn.trim();
  if (!headName) throw new Error('Head of expenditure (English) is required.');

  const ref = doc(db, 'economicCodes', code);
  const existingSnap = await getDoc(ref);
  const exists = existingSnap.exists();
  const before = exists
    ? ({ id: existingSnap.id, ...existingSnap.data() } as Record<string, unknown>)
    : null;

  const payload = {
    code,
    headName,
    headNameBn,
    active: input.active,
    special: isSpecial,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
    ...(exists ? {} : { createdAt: serverTimestamp(), createdBy: actor.uid }),
  };

  const batch = writeBatch(db);
  batch.set(ref, payload, { merge: true });
  writeAuditLogInBatch(batch, {
    collection: 'economicCodes',
    docId: code,
    action: exists ? 'update' : 'create',
    before,
    after: { id: code, ...payload },
    actor,
  });
  await batch.commit();

  return {
    id: code,
    code,
    headName,
    headNameBn,
    active: input.active,
    special: isSpecial,
  };
}

export async function setEconomicCodeActive(
  entry: EconomicCodeDoc,
  active: boolean,
  actor: AuditActor
): Promise<void> {
  const ref = doc(db, 'economicCodes', entry.code);
  const batch = writeBatch(db);
  batch.update(ref, {
    active,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });
  writeAuditLogInBatch(batch, {
    collection: 'economicCodes',
    docId: entry.code,
    action: 'update',
    before: entry as unknown as Record<string, unknown>,
    after: { ...entry, active } as unknown as Record<string, unknown>,
    actor,
  });
  await batch.commit();
}

export async function deleteEconomicCodeIfUnused(
  entry: EconomicCodeDoc,
  actor: AuditActor
): Promise<void> {
  const [budgetsSnap, ratesSnap, limitsSnap, itemsSnap, billsSnap] = await Promise.all([
    getDocs(query(collection(db, 'budgets'), where('economicCode', '==', entry.code))),
    getDocs(query(collection(db, 'vatTaxRates'), where('economicCode', '==', entry.code), limit(1))),
    getDocs(query(collection(db, 'spendingLimits'), where('economicCode', '==', entry.code), limit(1))),
    getDocs(query(collection(db, 'expenseItems'), where('economicCode', '==', entry.code))),
    getDocs(query(collection(db, 'bills'), where('economicCode', '==', entry.code))),
  ]);

  const activeBudgetCount = budgetsSnap.docs.filter((d) => !d.data().deleted).length;
  const activeItemCount = itemsSnap.docs.filter((d) => !d.data().deleted).length;
  const activeBillCount = billsSnap.docs.filter((d) => !d.data().deleted).length;
  if (
    activeBudgetCount > 0 ||
    activeItemCount > 0 ||
    activeBillCount > 0 ||
    !ratesSnap.empty ||
    !limitsSnap.empty
  ) {
    throw new Error(
      'This economic code is referenced by existing budgets, expense items, bills, VAT/IT rates, or limits and cannot be deleted. Deactivate it instead.'
    );
  }

  const ref = doc(db, 'economicCodes', entry.code);
  const batch = writeBatch(db);
  batch.delete(ref);
  writeAuditLogInBatch(batch, {
    collection: 'economicCodes',
    docId: entry.code,
    action: 'delete',
    before: entry as unknown as Record<string, unknown>,
    after: null,
    actor,
  });
  await batch.commit();
}

export async function buildEconomicCodesFromExistingData(
  actor: AuditActor
): Promise<{ created: number; skipped: number }> {
  const [existingSnap, budgetsSnap, ratesSnap, limitsSnap] = await Promise.all([
    getDocs(collection(db, 'economicCodes')),
    getDocs(collection(db, 'budgets')),
    getDocs(collection(db, 'vatTaxRates')),
    getDocs(collection(db, 'spendingLimits')),
  ]);

  const existingIds = new Set(existingSnap.docs.map((d) => d.id));
  const collected = new Map<string, { headName: string; headNameBn: string; special: boolean }>();

  collected.set('GENERAL-CONSTRUCTION', {
    headName: 'Construction materials or works',
    headNameBn: 'নির্মাণ সামগ্রী বা পূর্ত কাজ',
    special: true,
  });

  for (const d of ratesSnap.docs) {
    const data = d.data();
    const code = String(data.economicCode || '').trim();
    if (!code) continue;
    collected.set(code, {
      headName: String(data.description || code).trim(),
      headNameBn: String(data.descriptionBn || '').trim(),
      special: code === 'GENERAL-CONSTRUCTION',
    });
  }

  for (const d of budgetsSnap.docs) {
    const data = d.data();
    if (data.deleted) continue;
    const code = String(data.economicCode || '').trim();
    if (!code) continue;
    const prev = collected.get(code);
    collected.set(code, {
      headName: String(data.headName || prev?.headName || code).trim(),
      headNameBn: String(data.headNameBn || prev?.headNameBn || '').trim(),
      special: code === 'GENERAL-CONSTRUCTION',
    });
  }

  for (const d of limitsSnap.docs) {
    const data = d.data();
    const code = String(data.economicCode || '').trim();
    if (!code) continue;
    const prev = collected.get(code);
    if (!prev) {
      collected.set(code, {
        headName: String(data.headName || code).trim(),
        headNameBn: String(data.headNameBn || '').trim(),
        special: code === 'GENERAL-CONSTRUCTION',
      });
    }
  }

  let created = 0;
  let skipped = 0;
  const entries = Array.from(collected.entries()).filter(([code]) => {
    if (existingIds.has(code)) {
      skipped++;
      return false;
    }
    return isValidEconomicCode(code, true);
  });

  for (let i = 0; i < entries.length; i += 200) {
    const chunk = entries.slice(i, i + 200);
    const batch = writeBatch(db);
    for (const [code, info] of chunk) {
      const ref = doc(db, 'economicCodes', code);
      const payload = {
        code,
        headName: info.headName,
        headNameBn: info.headNameBn,
        active: true,
        special: info.special,
        createdAt: serverTimestamp(),
        createdBy: actor.uid,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      };
      batch.set(ref, payload);
      writeAuditLogInBatch(batch, {
        collection: 'economicCodes',
        docId: code,
        action: 'create',
        before: null,
        after: { id: code, ...payload },
        actor,
      });
      created++;
    }
    await batch.commit();
  }

  return { created, skipped };
}
