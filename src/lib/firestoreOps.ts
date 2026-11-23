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
import {
  aggregateDeductions,
  calcPercentageAmount,
  calcProduct,
  computeGrossedUpBill,
  normalizeProductRateKey,
  sumProducts,
} from './money';
import { DEFAULT_IT_CODE, DEFAULT_NET_PAYABLE_CODE, DEFAULT_VAT_CODE } from './tr21Defaults';
import { isValidEconomicCode, normalizeEmail } from './validation';
import type {
  ActorRef,
  ActorSnapshot,
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
  ExpenseProduct,
  FyCodeTotalDoc,
  OfficeDoc,
  OfficeSettings,
  ProductRateDoc,
  ResponsibleEmployee,
  Role,
  SpendingDoc,
  SpendingLimitDoc,
  SpendingLimitType,
  Tr21P1S3Mode,
  UserStatus,
  VatTaxRateDoc,
  VatVariant,
} from '../types';

function toActorPayload(actor: AuditActor | ActorSnapshot): ActorRef {
  if ('role' in actor && actor.role) {
    return {
      uid: actor.uid,
      name: actor.name,
      designation: actor.designation || '',
      officeId: actor.officeId ?? null,
      role: actor.role,
      kind: actor.kind ?? null,
      workHistoryId: actor.workHistoryId ?? null,
    };
  }
  return actor.uid;
}

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

export function buildFyCodeTotalId(officeId: string, fiscalYear: string, economicCode: string): string {
  return officeId ? `${officeId}_${fiscalYear}_${economicCode}` : `${fiscalYear}_${economicCode}`;
}

export function buildCounterId(officeId: string, fiscalYear: string): string {
  return officeId ? `${officeId}_${fiscalYear}_bill` : `${fiscalYear}_bill`;
}

export interface CreateBudgetInput {
  officeId: string;
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
  const officeId = input.officeId.trim();
  const memoNo = input.memoNo.trim();
  const economicCode = input.economicCode.trim();
  const headName = input.headName.trim();
  const headNameBn = input.headNameBn.trim();

  if (!officeId) throw new Error('Office is required.');
  if (!memoNo) throw new Error('Memo number is required.');
  if (!isDateInFiscalYear(input.memoDate, input.fiscalYear)) {
    throw new Error(`Memo date must fall inside FY ${input.fiscalYear}.`);
  }
  if (!isValidEconomicCode(economicCode, false)) {
    throw new Error('Economic code must be exactly 7 digits.');
  }
  if (!headName && !headNameBn) throw new Error('ব্যয়ের খাত প্রয়োজন।');
  if (input.entryType === 'original' && input.allocated <= 0) {
    throw new Error('Original allocation amount must be greater than zero.');
  }
  if (input.entryType === 'revision' && input.allocated === 0) {
    throw new Error('Revision amount cannot be zero.');
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
  const resolvedHeadNameBn = masterData.headNameBn || headNameBn;
  const resolvedHeadName = masterData.headName || resolvedHeadNameBn || headName;

  const fyBudgetsSnap = await getDocs(
    query(
      collection(db, 'budgets'),
      where('officeId', '==', officeId),
      where('fiscalYear', '==', input.fiscalYear)
    )
  );
  const hasActiveDup = fyBudgetsSnap.docs.some((d) => {
    const data = d.data();
    return (
      !data.deleted &&
      data.memoNo === memoNo &&
      data.economicCode === economicCode &&
      (data.entryType || 'original') === input.entryType
    );
  });
  if (hasActiveDup) {
    throw new Error(
      `অর্থনৈতিক কোড ${economicCode}-এর জন্য স্মারক নং "${memoNo}" ইতোমধ্যে FY ${input.fiscalYear}-এ রয়েছে।`
    );
  }

  const budgetRef = doc(collection(db, 'budgets'));
  const fyTotalId = buildFyCodeTotalId(officeId, input.fiscalYear, economicCode);
  const fyTotalRef = doc(db, 'fyCodeTotals', fyTotalId);
  const actorPayload = toActorPayload(actor);

  await runTransaction(db, async (tx) => {
    const fyTotalSnap = await tx.get(fyTotalRef);
    let revTargetSnap = null;
    if (input.entryType === 'revision' && input.revisionOf) {
      revTargetSnap = await tx.get(doc(db, 'budgets', input.revisionOf));
      if (!revTargetSnap.exists() || revTargetSnap.data().deleted) {
        throw new Error('Selected target budget for revision was not found.');
      }
      if (revTargetSnap.data().officeId && revTargetSnap.data().officeId !== officeId) {
        throw new Error('Revision target budget belongs to a different office.');
      }
    }

    const prevAllocated = fyTotalSnap.exists() ? (fyTotalSnap.data().allocated as number) || 0 : 0;
    const prevSpent = fyTotalSnap.exists() ? (fyTotalSnap.data().spent as number) || 0 : 0;
    const prevPending = fyTotalSnap.exists() ? (fyTotalSnap.data().pendingAmount as number) || 0 : 0;

    const budgetPayload = {
      officeId,
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
      createdBy: actorPayload,
      updatedAt: serverTimestamp(),
      updatedBy: actorPayload,
    };

    tx.set(budgetRef, budgetPayload);

    tx.set(
      fyTotalRef,
      {
        officeId,
        fiscalYear: input.fiscalYear,
        economicCode,
        allocated: prevAllocated + input.allocated,
        spent: prevSpent,
        approvedSpent: prevSpent,
        pendingAmount: prevPending,
        createdAt: fyTotalSnap.exists() ? fyTotalSnap.data().createdAt : serverTimestamp(),
        createdBy: fyTotalSnap.exists() ? fyTotalSnap.data().createdBy : actorPayload,
        updatedAt: serverTimestamp(),
        updatedBy: actorPayload,
      },
      { merge: true }
    );

    writeAuditLogInTx(tx, {
      officeId,
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

export async function createBudgetsBatchTx(
  inputs: CreateBudgetInput[],
  actor: AuditActor
): Promise<string[]> {
  if (inputs.length === 0) {
    throw new Error('কমপক্ষে একটি অর্থনৈতিক কোড ও পরিমাণ যোগ করুন।');
  }
  if (inputs.length === 1) {
    const id = await createBudgetTx(inputs[0], actor);
    return [id];
  }

  const normalized = inputs.map((inp) => ({
    ...inp,
    officeId: inp.officeId.trim(),
    memoNo: inp.memoNo.trim(),
    economicCode: inp.economicCode.trim(),
    headName: inp.headName.trim(),
    headNameBn: inp.headNameBn.trim(),
  }));

  const officeId = normalized[0].officeId;
  if (!officeId) throw new Error('Office is required.');

  const batchEntryType = normalized[0].entryType;
  const seenCodeSet = new Set<string>();
  for (let i = 0; i < normalized.length; i++) {
    const item = normalized[i];
    if (item.officeId !== officeId) throw new Error('All batch rows must belong to the same office.');
    if (!item.memoNo) throw new Error('Memo number is required.');
    if (!isDateInFiscalYear(item.memoDate, item.fiscalYear)) {
      throw new Error(`Memo date must fall inside FY ${item.fiscalYear}.`);
    }
    if (!isValidEconomicCode(item.economicCode, false)) {
      throw new Error(`আইটেম #${i + 1}: বৈধ ৭-অঙ্কের অর্থনৈতিক কোড দিন।`);
    }
    if (!item.headName && !item.headNameBn) {
      throw new Error(`আইটেম #${i + 1}: ব্যয়ের খাত প্রয়োজন।`);
    }
    if (item.entryType !== batchEntryType) {
      throw new Error('একই ব্যাচে সব সারির ধরন (Original বা Revision) একই হতে হবে।');
    }
    if (item.entryType === 'original' && item.allocated <= 0) {
      throw new Error(`আইটেম #${i + 1} (${item.economicCode}): টাকার পরিমাণ ০ এর বেশি হতে হবে।`);
    }
    if (item.entryType === 'revision' && item.allocated === 0) {
      throw new Error(`আইটেম #${i + 1} (${item.economicCode}): সংশোধনের পরিমাণ ০ হতে পারে না।`);
    }
    if (seenCodeSet.has(item.economicCode)) {
      throw new Error(
        `একই ফর্মে একই অর্থনৈতিক কোড (${item.economicCode}) একাধিকবার যোগ করা যাবে না।`
      );
    }
    seenCodeSet.add(item.economicCode);
  }

  const fiscalYear = normalized[0].fiscalYear;
  const memoNo = normalized[0].memoNo;

  const masterSnaps = await Promise.all(
    normalized.map((item) => getDoc(doc(db, 'economicCodes', item.economicCode)))
  );
  const resolvedItems = normalized.map((item, idx) => {
    const snap = masterSnaps[idx];
    if (!snap.exists()) {
      throw new Error(`Economic code "${item.economicCode}" does not exist in Economic Codes.`);
    }
    const masterData = snap.data() as Omit<EconomicCodeDoc, 'id'>;
    if (masterData.special) {
      throw new Error('GENERAL-CONSTRUCTION cannot be used directly for a budget allocation.');
    }
    const resolvedBn = masterData.headNameBn || item.headNameBn;
    return {
      ...item,
      headName: masterData.headName || resolvedBn || item.headName,
      headNameBn: resolvedBn,
    };
  });

  const fyBudgetsSnap = await getDocs(
    query(
      collection(db, 'budgets'),
      where('officeId', '==', officeId),
      where('fiscalYear', '==', fiscalYear)
    )
  );
  for (const item of resolvedItems) {
    const hasActiveDup = fyBudgetsSnap.docs.some((d) => {
      const data = d.data();
      return (
        !data.deleted &&
        data.memoNo === memoNo &&
        data.economicCode === item.economicCode &&
        (data.entryType || 'original') === item.entryType
      );
    });
    if (hasActiveDup) {
      throw new Error(
        `অর্থনৈতিক কোড ${item.economicCode}-এর জন্য স্মারক নং "${memoNo}" ইতোমধ্যে FY ${fiscalYear}-এ রয়েছে।`
      );
    }
  }

  const createdIds: string[] = [];
  const budgetRefs = resolvedItems.map(() => doc(collection(db, 'budgets')));
  const fyTotalRefs = resolvedItems.map((item) =>
    doc(db, 'fyCodeTotals', buildFyCodeTotalId(officeId, item.fiscalYear, item.economicCode))
  );
  const uniqueRevTargetIds = Array.from(
    new Set(
      resolvedItems
        .filter((it) => it.entryType === 'revision' && it.revisionOf)
        .map((it) => it.revisionOf as string)
    )
  );
  const revTargetRefs = uniqueRevTargetIds.map((id) => doc(db, 'budgets', id));
  const actorPayload = toActorPayload(actor);

  await runTransaction(db, async (tx) => {
    const [fyTotalSnaps, revTargetSnaps] = await Promise.all([
      Promise.all(fyTotalRefs.map((r) => tx.get(r))),
      Promise.all(revTargetRefs.map((r) => tx.get(r))),
    ]);

    for (const revSnap of revTargetSnaps) {
      if (!revSnap.exists() || revSnap.data()?.deleted) {
        throw new Error('Selected target budget for revision was not found.');
      }
      if (revSnap.data()?.officeId && revSnap.data()?.officeId !== officeId) {
        throw new Error('Revision target budget belongs to a different office.');
      }
    }

    for (let i = 0; i < resolvedItems.length; i++) {
      const item = resolvedItems[i];
      const budgetRef = budgetRefs[i];
      const fyTotalRef = fyTotalRefs[i];
      const fyTotalSnap = fyTotalSnaps[i];

      const prevAllocated = fyTotalSnap.exists()
        ? (fyTotalSnap.data().allocated as number) || 0
        : 0;
      const prevSpent = fyTotalSnap.exists() ? (fyTotalSnap.data().spent as number) || 0 : 0;
      const prevPending = fyTotalSnap.exists()
        ? (fyTotalSnap.data().pendingAmount as number) || 0
        : 0;

      const budgetPayload = {
        officeId,
        fiscalYear: item.fiscalYear,
        memoNo: item.memoNo,
        memoDate: item.memoDate,
        economicCode: item.economicCode,
        headName: item.headName,
        headNameBn: item.headNameBn,
        allocated: item.allocated,
        entryType: item.entryType,
        revisionOf: item.entryType === 'revision' ? item.revisionOf || null : null,
        deductionRates: item.deductionRates,
        spent: 0,
        approvedSpent: 0,
        pendingAmount: 0,
        remaining: item.allocated,
        status: 'active' as BudgetStatus,
        deleted: false,
        createdAt: serverTimestamp(),
        createdBy: actorPayload,
        updatedAt: serverTimestamp(),
        updatedBy: actorPayload,
      };

      tx.set(budgetRef, budgetPayload);
      tx.set(
        fyTotalRef,
        {
          officeId,
          fiscalYear: item.fiscalYear,
          economicCode: item.economicCode,
          allocated: prevAllocated + item.allocated,
          spent: prevSpent,
          approvedSpent: prevSpent,
          pendingAmount: prevPending,
          createdAt: fyTotalSnap.exists() ? fyTotalSnap.data().createdAt : serverTimestamp(),
          createdBy: fyTotalSnap.exists() ? fyTotalSnap.data().createdBy : actorPayload,
          updatedAt: serverTimestamp(),
          updatedBy: actorPayload,
        },
        { merge: true }
      );

      writeAuditLogInTx(tx, {
        officeId,
        collection: 'budgets',
        docId: budgetRef.id,
        action: 'create',
        before: null,
        after: { id: budgetRef.id, ...budgetPayload },
        actor,
      });

      createdIds.push(budgetRef.id);
    }
  });

  return createdIds;
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
    correctionReason?: string;
  },
  actor: AuditActor
): Promise<void> {
  const memoNo = updates.memoNo.trim();
  const headName = updates.headName.trim();
  if (!memoNo) throw new Error('Memo number is required.');
  if (!headName && !updates.headNameBn.trim()) throw new Error('ব্যয়ের খাত প্রয়োজন।');

  const budgetRef = doc(db, 'budgets', budgetId);
  const actorPayload = toActorPayload(actor);

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

    const officeId = before.officeId || '';
    const fyTotalRef = doc(
      db,
      'fyCodeTotals',
      buildFyCodeTotalId(officeId, before.fiscalYear, before.economicCode)
    );
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
      headName: headName || updates.headNameBn.trim(),
      headNameBn: updates.headNameBn.trim(),
      allocated: updates.allocated,
      remaining: newRemaining,
      deductionRates: updates.deductionRates,
      updatedAt: serverTimestamp(),
      updatedBy: actorPayload,
    };

    tx.update(budgetRef, afterFields);
    tx.set(
      fyTotalRef,
      {
        officeId,
        fiscalYear: before.fiscalYear,
        economicCode: before.economicCode,
        allocated: prevFyAlloc + delta,
        spent: prevFySpent,
        approvedSpent: prevFySpent,
        pendingAmount: prevFyPending,
        updatedAt: serverTimestamp(),
        updatedBy: actorPayload,
      },
      { merge: true }
    );

    writeAuditLogInTx(tx, {
      officeId: officeId || null,
      collection: 'budgets',
      docId: budgetId,
      action: updates.correctionReason ? 'correct' : 'update',
      before: { id: budgetId, ...before },
      after: {
        id: budgetId,
        ...before,
        ...afterFields,
        ...(updates.correctionReason ? { correctionReason: updates.correctionReason.trim() } : {}),
      },
      actor,
    });
  });
}

export async function softDeleteBudgetTx(
  budgetId: string,
  actor: AuditActor,
  correctionReason?: string
): Promise<void> {
  const budgetRef = doc(db, 'budgets', budgetId);
  const actorPayload = toActorPayload(actor);

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

    const officeId = before.officeId || '';
    const fyTotalRef = doc(
      db,
      'fyCodeTotals',
      buildFyCodeTotalId(officeId, before.fiscalYear, before.economicCode)
    );
    const fyTotalSnap = await tx.get(fyTotalRef);
    const prevFyAlloc = fyTotalSnap.exists() ? (fyTotalSnap.data().allocated as number) || 0 : 0;

    tx.update(budgetRef, {
      deleted: true,
      updatedAt: serverTimestamp(),
      updatedBy: actorPayload,
    });

    if (fyTotalSnap.exists()) {
      tx.update(fyTotalRef, {
        allocated: prevFyAlloc - before.allocated,
        updatedAt: serverTimestamp(),
        updatedBy: actorPayload,
      });
    }

    writeAuditLogInTx(tx, {
      officeId: officeId || null,
      collection: 'budgets',
      docId: budgetId,
      action: correctionReason ? 'correct' : 'delete',
      before: { id: budgetId, ...before },
      after: {
        id: budgetId,
        ...before,
        deleted: true,
        ...(correctionReason ? { correctionReason: correctionReason.trim() } : {}),
      },
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
  const actorPayload = toActorPayload(actor);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(budgetRef);
    if (!snap.exists() || snap.data().deleted) {
      throw new Error('Budget not found.');
    }
    const before = snap.data() as Omit<BudgetDoc, 'id'>;
    tx.update(budgetRef, {
      status,
      updatedAt: serverTimestamp(),
      updatedBy: actorPayload,
    });
    writeAuditLogInTx(tx, {
      officeId: before.officeId || null,
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
  officeId: string;
  fiscalYear: string;
  economicCode: string;
  headName: string;
  headNameBn?: string;
  date: string;
  description: string;
  amount: number; // integer paisa (legacy: net expense; voucher: total voucher sum)
  amountBasis?: 'voucher';
  products?: ExpenseProduct[];
  baseTotal?: number;
  vatTotal?: number;
  itTotal?: number;
  deductionTotal?: number;
  responsibleEmployee: ResponsibleEmployee;
}

interface NormalizedExpenseProductFields {
  amount: number;
  amountBasis?: 'voucher';
  products?: ExpenseProduct[];
  baseTotal?: number;
  vatTotal?: number;
  itTotal?: number;
  deductionTotal?: number;
}

function validateAndNormalizeExpenseItemInput(
  input: ExpenseItemInput,
  indexLabel?: string
): NormalizedExpenseProductFields {
  const prefix = indexLabel ? `${indexLabel}: ` : '';
  if (!input.officeId?.trim()) {
    throw new Error(`${prefix}দপ্তর নির্বাচন আবশ্যক।`);
  }
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
  if (!input.responsibleEmployee.name.trim()) {
    throw new Error(`${prefix}দায়িত্বপ্রাপ্ত কর্মচারীর নাম আবশ্যক।`);
  }

  if (input.amountBasis === 'voucher') {
    const rawProducts = input.products || [];
    if (rawProducts.length === 0) {
      throw new Error(`${prefix}কমপক্ষে ১টি পণ্য বা ব্যয় যোগ করুন।`);
    }
    const normalizedProducts: ExpenseProduct[] = rawProducts.map((p, idx) => {
      const name = (p.name || '').trim();
      if (!name) {
        throw new Error(`${prefix}পণ্য #${idx + 1}: পণ্যের নাম আবশ্যক।`);
      }
      const by: 'x' | 'y' = p.lastEditedField === 'y' ? 'y' : 'x';
      const sourceAmt = by === 'y' ? p.voucherAmount : p.actualAmount;
      const computed = calcProduct({
        id: p.id || `prod_${idx + 1}`,
        name,
        amount: sourceAmt,
        by,
        vatRate: p.vatRate,
        itRate: p.itRate,
      });
      return {
        id: computed.id,
        name: computed.name,
        actualAmount: computed.actualAmount,
        voucherAmount: computed.voucherAmount,
        vatRate: computed.vatRate,
        itRate: computed.itRate,
        vatAmount: computed.vatAmount,
        itAmount: computed.itAmount,
        deductionAmount: computed.deductionAmount,
        lastEditedField: computed.lastEditedField,
      };
    });
    const totals = sumProducts(normalizedProducts);
    if (totals.baseTotal <= 0 || totals.voucherTotal <= 0) {
      throw new Error(`${prefix}মোট খরচ অবশ্যই ০ এর বেশি হতে হবে।`);
    }
    return {
      amount: totals.voucherTotal,
      amountBasis: 'voucher',
      products: normalizedProducts,
      baseTotal: totals.baseTotal,
      vatTotal: totals.vatTotal,
      itTotal: totals.itTotal,
      deductionTotal: totals.deductionTotal,
    };
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error(`${prefix}খরচের পরিমাণ অবশ্যই ০ এর বেশি হতে হবে।`);
  }
  return {
    amount: Math.round(input.amount),
  };
}

function upsertProductRatesInBatch(
  batch: ReturnType<typeof writeBatch>,
  officeId: string,
  economicCode: string,
  products: ExpenseProduct[] | undefined
): void {
  if (!officeId || !products || products.length === 0) return;
  const deduped = new Map<string, ExpenseProduct>();
  for (const p of products) {
    const key = normalizeProductRateKey(p.name);
    if (!key) continue;
    deduped.set(key, p);
  }
  for (const [key, p] of deduped.entries()) {
    const rateRef = doc(db, 'offices', officeId, 'productRates', key);
    batch.set(
      rateRef,
      {
        name: p.name.trim(),
        vatRate: Number(p.vatRate),
        itRate: Number(p.itRate),
        lastEconomicCode: economicCode.trim(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }
}

export async function fetchProductRate(
  officeId: string,
  productName: string
): Promise<ProductRateDoc | null> {
  const trimmedOffice = officeId.trim();
  const key = normalizeProductRateKey(productName);
  if (!trimmedOffice || !key) return null;
  const snap = await getDoc(doc(db, 'offices', trimmedOffice, 'productRates', key));
  if (!snap.exists()) return null;
  return {
    id: snap.id,
    ...(snap.data() as Omit<ProductRateDoc, 'id'>),
  };
}

export async function fetchOfficeProductRates(officeId: string): Promise<ProductRateDoc[]> {
  const trimmedOffice = officeId.trim();
  if (!trimmedOffice) return [];
  const snap = await getDocs(collection(db, 'offices', trimmedOffice, 'productRates'));
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<ProductRateDoc, 'id'>),
  }));
}

export async function createExpenseItemsBatch(
  items: ExpenseItemInput[],
  actor: AuditActor
): Promise<string[]> {
  if (items.length === 0) {
    throw new Error('কমপক্ষে একটি খরচ আইটেম যোগ করুন।');
  }
  const normalizedList = items.map((item, idx) =>
    validateAndNormalizeExpenseInputOrThrow(item, `আইটেম #${idx + 1}`)
  );

  const actorPayload = toActorPayload(actor);
  const createdIds: string[] = [];
  for (let i = 0; i < items.length; i += 120) {
    const chunk = items.slice(i, i + 120);
    const batch = writeBatch(db);
    chunk.forEach((item, offset) => {
      const normalized = normalizedList[i + offset];
      const ref = doc(collection(db, 'expenseItems'));
      const voucherFields =
        normalized.amountBasis === 'voucher'
          ? {
              amountBasis: 'voucher' as const,
              products: normalized.products!,
              baseTotal: normalized.baseTotal!,
              vatTotal: normalized.vatTotal!,
              itTotal: normalized.itTotal!,
              deductionTotal: normalized.deductionTotal!,
            }
          : {};
      const payload = {
        officeId: item.officeId.trim(),
        fiscalYear: item.fiscalYear,
        economicCode: item.economicCode.trim(),
        headName: item.headName.trim(),
        headNameBn: (item.headNameBn || '').trim(),
        date: item.date,
        description: item.description.trim(),
        amount: normalized.amount,
        ...voucherFields,
        responsibleEmployee: {
          userId: item.responsibleEmployee.userId || null,
          name: item.responsibleEmployee.name.trim(),
          designation: item.responsibleEmployee.designation.trim(),
        },
        status: 'listed' as const,
        billId: null,
        deleted: false,
        createdAt: serverTimestamp(),
        createdBy: actorPayload,
        createdByName: actor.name,
        updatedAt: serverTimestamp(),
        updatedBy: actorPayload,
      };
      batch.set(ref, payload);
      if (normalized.amountBasis === 'voucher') {
        upsertProductRatesInBatch(batch, item.officeId.trim(), item.economicCode, normalized.products);
      }
      writeAuditLogInBatch(batch, {
        officeId: item.officeId.trim(),
        collection: 'expenseItems',
        docId: ref.id,
        action: 'create',
        before: null,
        after: { id: ref.id, ...payload },
        actor,
      });
      createdIds.push(ref.id);
    });
    await batch.commit();
  }
  return createdIds;
}

function validateAndNormalizeExpenseInputOrThrow(
  input: ExpenseItemInput,
  indexLabel?: string
): NormalizedExpenseProductFields {
  return validateAndNormalizeExpenseItemInput(input, indexLabel);
}

export async function updateExpenseItem(
  existing: ExpenseItemDoc,
  updates: ExpenseItemInput,
  actor: AuditActor
): Promise<void> {
  if (existing.status === 'billed') {
    throw new Error('বিলে অন্তর্ভুক্ত (billed) খরচ সম্পাদনা করা যায় না।');
  }
  const normalized = validateAndNormalizeExpenseItemInput(updates);

  const actorPayload = toActorPayload(actor);
  const ref = doc(db, 'expenseItems', existing.id);
  const batch = writeBatch(db);
  const voucherFields =
    normalized.amountBasis === 'voucher'
      ? {
          amountBasis: 'voucher' as const,
          products: normalized.products!,
          baseTotal: normalized.baseTotal!,
          vatTotal: normalized.vatTotal!,
          itTotal: normalized.itTotal!,
          deductionTotal: normalized.deductionTotal!,
        }
      : {};
  const patch = {
    economicCode: updates.economicCode.trim(),
    headName: updates.headName.trim(),
    headNameBn: (updates.headNameBn || '').trim(),
    date: updates.date,
    description: updates.description.trim(),
    amount: normalized.amount,
    ...voucherFields,
    responsibleEmployee: {
      userId: updates.responsibleEmployee.userId || null,
      name: updates.responsibleEmployee.name.trim(),
      designation: updates.responsibleEmployee.designation.trim(),
    },
    updatedAt: serverTimestamp(),
    updatedBy: actorPayload,
  };
  batch.update(ref, patch);
  if (normalized.amountBasis === 'voucher') {
    upsertProductRatesInBatch(
      batch,
      existing.officeId || updates.officeId.trim(),
      updates.economicCode,
      normalized.products
    );
  }
  writeAuditLogInBatch(batch, {
    officeId: existing.officeId || updates.officeId || null,
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
  const actorPayload = toActorPayload(actor);
  const ref = doc(db, 'expenseItems', existing.id);
  const batch = writeBatch(db);
  batch.update(ref, {
    deleted: true,
    updatedAt: serverTimestamp(),
    updatedBy: actorPayload,
  });
  writeAuditLogInBatch(batch, {
    officeId: existing.officeId || null,
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
  officeId: string;
  fiscalYear: string;
  economicCode: string;
  headName: string;
  headNameBn?: string;
  date: string;
  billDate?: string;
  voucherNo?: string;
  tokenNo?: string;
  purposeText?: string;
  tr21P1S3Mode?: Tr21P1S3Mode | null;
  voucherTitle?: string;
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

function isVoucherItemLike(
  item: Pick<ExpenseItemDoc | BillItemSnapshot, 'amountBasis' | 'products'>
): boolean {
  return (
    item.amountBasis === 'voucher' &&
    Array.isArray(item.products) &&
    item.products.length > 0
  );
}

function mergeBillDeductionLines(lines: BillDeductionLine[]): BillDeductionLine[] {
  const grouped = new Map<string, BillDeductionLine>();
  for (const d of lines) {
    const kind = d.kind || 'other';
    const code = (d.code || '').trim();
    const hasRate = typeof d.rate === 'number' && Number.isFinite(d.rate);
    const rateKey = hasRate ? String(d.rate) : 'fixed';
    const key =
      kind === 'it' || kind === 'vat'
        ? `${kind}__${code}__${rateKey}`
        : `${kind}__${d.id}__${code}__${(d.name || '').trim()}__${rateKey}`;
    const existing = grouped.get(key);
    const amt = Math.max(0, Math.round(d.amount || 0));
    if (existing) {
      existing.amount += amt;
    } else {
      grouped.set(key, {
        id: d.id || key,
        code,
        name: (d.name || '').trim(),
        rate: hasRate ? d.rate! : null,
        amount: amt,
        kind,
      });
    }
  }
  const order: Record<string, number> = { it: 0, vat: 1, security: 2, other: 3 };
  return Array.from(grouped.values()).sort((a, b) => {
    const oa = order[a.kind || 'other'] ?? 3;
    const ob = order[b.kind || 'other'] ?? 3;
    if (oa !== ob) return oa - ob;
    const ra = typeof a.rate === 'number' ? a.rate : -1;
    const rb = typeof b.rate === 'number' ? b.rate : -1;
    return rb - ra;
  });
}

export function computeBillFinancialsFromItems(params: {
  items: ReadonlyArray<Pick<ExpenseItemDoc | BillItemSnapshot, 'amount' | 'amountBasis' | 'products' | 'baseTotal'>>;
  vatRate: number;
  itRate: number;
  customDeductions?: BillDeductionLine[];
  defaultItCode?: string;
  defaultVatCode?: string;
}): {
  amountBasis?: 'voucher' | 'mixed';
  grossAmount: number;
  deductions: BillDeductionLine[];
  vatAmount: number;
  itAmount: number;
  totalDeduction: number;
  netPayable: number;
  effectiveVatRate: number;
  effectiveItRate: number;
} {
  const itCode = params.defaultItCode || DEFAULT_IT_CODE;
  const vatCode = params.defaultVatCode || DEFAULT_VAT_CODE;
  const voucherItems = params.items.filter(isVoucherItemLike);
  const legacyItems = params.items.filter((i) => !isVoucherItemLike(i));

  // Pure legacy path
  if (voucherItems.length === 0) {
    const legacyTotal = legacyItems.reduce((sum, i) => sum + Math.round(i.amount || 0), 0);
    const legacyRes = computeGrossedUpBill({
      expenseTotalPaisa: legacyTotal,
      vatRate: params.vatRate,
      itRate: params.itRate,
      customDeductions: params.customDeductions,
      defaultItCode: itCode,
      defaultVatCode: vatCode,
    });
    return {
      grossAmount: legacyRes.grossAmount,
      deductions: legacyRes.deductions,
      vatAmount: legacyRes.vatAmount,
      itAmount: legacyRes.itAmount,
      totalDeduction: legacyRes.totalDeduction,
      netPayable: legacyRes.netPayable,
      effectiveVatRate: legacyRes.effectiveVatRate,
      effectiveItRate: legacyRes.effectiveItRate,
    };
  }

  // Extract voucher products & product deductions
  const allProducts = voucherItems.flatMap((i) => i.products || []);
  const prodTotals = sumProducts(allProducts);
  const productDeductions = aggregateDeductions(allProducts, { itCode, vatCode });

  // Extra non-VAT/IT fixed deductions (e.g., security deposit added on top of voucher amount)
  const extraNonVatItLines = (params.customDeductions || []).filter(
    (d) => d.kind !== 'it' && d.kind !== 'vat'
  );
  const fixedExtraLines: BillDeductionLine[] = [];
  const percentExtraLines: BillDeductionLine[] = [];
  for (let idx = 0; idx < extraNonVatItLines.length; idx++) {
    const d = extraNonVatItLines[idx];
    const hasRate = typeof d.rate === 'number' && Number.isFinite(d.rate) && d.rate >= 0;
    if (hasRate && legacyItems.length > 0) {
      percentExtraLines.push(d);
    } else if (!hasRate) {
      fixedExtraLines.push({
        id: d.id || `extra_${idx + 1}`,
        code: (d.code || '').trim(),
        name: (d.name || '').trim(),
        rate: null,
        amount: Math.max(0, Math.round(d.amount || 0)),
        kind: d.kind || 'other',
      });
    } else {
      // On pure voucher bills, extra percentage deduction is computed on voucher base gross and added on top
      const pctAmt = calcPercentageAmount(prodTotals.voucherTotal, d.rate!);
      fixedExtraLines.push({
        id: d.id || `extra_${idx + 1}`,
        code: (d.code || '').trim(),
        name: (d.name || '').trim(),
        rate: d.rate!,
        amount: pctAmt,
        kind: d.kind || 'other',
      });
    }
  }
  const fixedExtraTotal = fixedExtraLines.reduce((s, d) => s + d.amount, 0);

  // Pure voucher path
  if (legacyItems.length === 0) {
    const deductions = mergeBillDeductionLines([...productDeductions, ...fixedExtraLines]);
    const itLines = deductions.filter((d) => d.kind === 'it');
    const vatLines = deductions.filter((d) => d.kind === 'vat');
    const itAmount = itLines.reduce((s, d) => s + d.amount, 0);
    const vatAmount = vatLines.reduce((s, d) => s + d.amount, 0);
    const totalDeduction = deductions.reduce((s, d) => s + d.amount, 0);
    const grossAmount = prodTotals.voucherTotal + fixedExtraTotal;
    const netPayable = grossAmount - totalDeduction; // equals prodTotals.baseTotal
    return {
      amountBasis: 'voucher',
      grossAmount,
      deductions,
      vatAmount,
      itAmount,
      totalDeduction,
      netPayable,
      effectiveVatRate: vatLines.length === 1 ? vatLines[0].rate ?? 0 : 0,
      effectiveItRate: itLines.length === 1 ? itLines[0].rate ?? 0 : 0,
    };
  }

  // Mixed path: combine product deductions (for voucher items) + gross-up (for legacy items) + extra fixed
  const legacyTotal = legacyItems.reduce((sum, i) => sum + Math.round(i.amount || 0), 0);
  const legacyRateInputs = (params.customDeductions || []).filter(
    (d) => (d.kind === 'it' || d.kind === 'vat') && typeof d.rate === 'number' && Number.isFinite(d.rate)
  );
  const legacyCustom =
    legacyRateInputs.length > 0 || percentExtraLines.length > 0
      ? [...legacyRateInputs, ...percentExtraLines]
      : undefined;
  const legacyRes = computeGrossedUpBill({
    expenseTotalPaisa: legacyTotal,
    vatRate: params.vatRate,
    itRate: params.itRate,
    customDeductions: legacyCustom,
    defaultItCode: itCode,
    defaultVatCode: vatCode,
  });

  const deductions = mergeBillDeductionLines([
    ...productDeductions,
    ...legacyRes.deductions.filter((d) => d.amount > 0 || d.kind === 'security' || d.kind === 'other'),
    ...fixedExtraLines,
  ]);
  const itLines = deductions.filter((d) => d.kind === 'it');
  const vatLines = deductions.filter((d) => d.kind === 'vat');
  const itAmount = itLines.reduce((s, d) => s + d.amount, 0);
  const vatAmount = vatLines.reduce((s, d) => s + d.amount, 0);
  const totalDeduction = deductions.reduce((s, d) => s + d.amount, 0);
  const grossAmount = prodTotals.voucherTotal + legacyRes.grossAmount + fixedExtraTotal;
  const netPayable = grossAmount - totalDeduction;

  return {
    amountBasis: 'mixed',
    grossAmount,
    deductions,
    vatAmount,
    itAmount,
    totalDeduction,
    netPayable,
    effectiveVatRate: legacyRes.effectiveVatRate,
    effectiveItRate: legacyRes.effectiveItRate,
  };
}

export async function createDraftBillsFromItems(
  groups: DraftBillGroupInput[],
  actor: AuditActor
): Promise<string[]> {
  const nonEmptyGroups = groups.filter((g) => g.items.length > 0);
  if (nonEmptyGroups.length === 0) {
    throw new Error('বিল প্রস্তুত করতে কমপক্ষে একটি তালিকাভুক্ত (listed) খরচ নির্বাচন করুন।');
  }

  const distinctCodes = new Set(
    nonEmptyGroups.flatMap((g) => [g.economicCode, ...g.items.map((it) => it.economicCode)])
  );
  if (nonEmptyGroups.length > 1 || distinctCodes.size > 1) {
    throw new Error(
      'একটি বিলে শুধুমাত্র একই অর্থনৈতিক কোডের খরচ যুক্ত করা যাবে। একাধিক কোডের খরচ নিয়ে বিল হবে না।'
    );
  }

  const actorPayload = toActorPayload(actor);
  const createdBillIds: string[] = [];
  const batch = writeBatch(db);

  for (const group of nonEmptyGroups) {
    const officeId = group.officeId.trim();
    if (!officeId) throw new Error('দপ্তর নির্ধারিত নয়।');

    for (const item of group.items) {
      if (item.status !== 'listed' || item.deleted) {
        throw new Error(`আইটেম "${item.description}" ইতোমধ্যে অন্য বিলে যুক্ত হয়েছে।`);
      }
      if (item.officeId && item.officeId !== officeId) {
        throw new Error(`আইটেম "${item.description}" অন্য দপ্তরের।`);
      }
      if (item.economicCode !== group.economicCode) {
        throw new Error('একই বিলের সব আইটেম অবশ্যই একই অর্থনৈতিক কোডের হতে হবে।');
      }
    }
    if (!isDateInFiscalYear(group.date, group.fiscalYear)) {
      throw new Error(`বিলের তারিখ অর্থবছর ${group.fiscalYear} এর মধ্যে হতে হবে।`);
    }

    const expenseTotal = group.items.reduce((sum, item) => sum + item.amount, 0);
    if (expenseTotal <= 0) {
      throw new Error('মোট খরচের পরিমাণ ০ এর বেশি হতে হবে।');
    }
    const {
      amountBasis,
      grossAmount,
      deductions,
      vatAmount,
      itAmount,
      totalDeduction,
      netPayable,
      effectiveVatRate,
      effectiveItRate,
    } = computeBillFinancialsFromItems({
      items: group.items,
      vatRate: group.vatRate,
      itRate: group.itRate,
      customDeductions: group.deductions,
      defaultItCode: DEFAULT_IT_CODE,
      defaultVatCode: DEFAULT_VAT_CODE,
    });

    if (netPayable < 0) {
      throw new Error('মোট কর্তন বিলের চেয়ে বেশি হতে পারে না।');
    }

    const billRef = doc(collection(db, 'bills'));
    const snapshots: BillItemSnapshot[] = group.items.map((item) => {
      const snap: BillItemSnapshot = {
        id: item.id,
        date: item.date,
        description: item.description,
        amount: item.amount,
        responsibleEmployee: {
          userId: item.responsibleEmployee.userId || null,
          name: item.responsibleEmployee.name,
          designation: item.responsibleEmployee.designation,
        },
      };
      if (item.amountBasis === 'voucher' && item.products?.length) {
        snap.amountBasis = 'voucher';
        snap.products = item.products;
        snap.baseTotal = item.baseTotal;
        snap.vatTotal = item.vatTotal;
        snap.itTotal = item.itTotal;
        snap.deductionTotal = item.deductionTotal;
      }
      return snap;
    });

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
      officeId,
      billNo: '',
      voucherNo: (group.voucherNo || '').trim(),
      fiscalYear: group.fiscalYear,
      economicCode: group.economicCode,
      headName: group.headName,
      headNameBn: group.headNameBn || '',
      date: group.date,
      billDate: group.billDate || group.date,
      tokenNo: (group.tokenNo || '').trim(),
      purposeText: (group.purposeText || '').trim(),
      tr21P1S3Mode: group.tr21P1S3Mode ?? null,
      voucherTitle: (group.voucherTitle || '').trim(),
      payeeText: (group.payeeText || '').trim(),
      netPayableCode: (group.netPayableCode || DEFAULT_NET_PAYABLE_CODE).trim(),
      supplier: cleanSupplier,
      deductions,
      itemIds: group.items.map((i) => i.id),
      items: snapshots,
      ...(amountBasis ? { amountBasis } : {}),
      grossAmount,
      vatRate: effectiveVatRate,
      itRate: effectiveItRate,
      vatVariant:
        amountBasis === 'voucher' ? 'product-wise' : group.vatVariant || 'default',
      vatVariantLabel:
        amountBasis === 'voucher'
          ? 'পণ্যভিত্তিক হার'
          : group.vatVariantLabel || 'Standard',
      vatAmount,
      itAmount,
      totalDeduction,
      netPayable,
      status: 'draft' as BillStatus,
      submittedAt: null,
      submittedBy: null,
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectReason: null,
      cancelledBy: null,
      cancelledAt: null,
      cancelReason: null,
      pendingSlices: [],
      budgetDeductions: [],
      migratedFromSpendingId: null,
      deleted: false,
      createdAt: serverTimestamp(),
      createdBy: actorPayload,
      createdByName: actor.name,
      updatedAt: serverTimestamp(),
      updatedBy: actorPayload,
    };

    batch.set(billRef, billPayload);
    writeAuditLogInBatch(batch, {
      officeId,
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
        updatedBy: actorPayload,
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
    voucherNo?: string;
    vatVariant: string;
    vatVariantLabel: string;
    vatRate: number;
    itRate: number;
    tokenNo?: string;
    purposeText?: string;
    tr21P1S3Mode?: Tr21P1S3Mode | null;
    voucherTitle?: string;
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

  const itemsExpenseTotal = bill.items.reduce((sum, item) => sum + item.amount, 0);
  const hasItemBreakdown = bill.items.length > 0 && itemsExpenseTotal > 0;
  const computed = hasItemBreakdown
    ? computeBillFinancialsFromItems({
        items: bill.items,
        vatRate: updates.vatRate,
        itRate: updates.itRate,
        customDeductions: updates.deductions,
        defaultItCode: DEFAULT_IT_CODE,
        defaultVatCode: DEFAULT_VAT_CODE,
      })
    : {
        grossAmount: bill.grossAmount,
        ...summarizeBillDeductions(
          bill.grossAmount,
          updates.vatRate,
          updates.itRate,
          updates.deductions
        ),
      };

  const {
    grossAmount,
    deductions,
    vatAmount,
    itAmount,
    totalDeduction,
    netPayable,
    effectiveVatRate,
    effectiveItRate,
  } = computed;

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

  const isPureVoucher = bill.amountBasis === 'voucher' || computed.amountBasis === 'voucher';
  const actorPayload = toActorPayload(actor);
  const ref = doc(db, 'bills', bill.id);
  const patch = {
    date: updates.date,
    billDate: updates.billDate || updates.date,
    voucherNo: (updates.voucherNo ?? bill.voucherNo ?? '').trim(),
    tokenNo: (updates.tokenNo ?? bill.tokenNo ?? '').trim(),
    purposeText: (updates.purposeText ?? bill.purposeText ?? '').trim(),
    tr21P1S3Mode:
      updates.tr21P1S3Mode !== undefined ? updates.tr21P1S3Mode : bill.tr21P1S3Mode ?? null,
    voucherTitle: (updates.voucherTitle ?? bill.voucherTitle ?? '').trim(),
    payeeText: (updates.payeeText ?? bill.payeeText ?? '').trim(),
    netPayableCode: (updates.netPayableCode ?? bill.netPayableCode ?? DEFAULT_NET_PAYABLE_CODE).trim(),
    supplier: updates.supplier !== undefined ? cleanSupplier : bill.supplier ?? null,
    deductions,
    vatVariant: isPureVoucher ? bill.vatVariant || 'product-wise' : updates.vatVariant,
    vatVariantLabel: isPureVoucher
      ? bill.vatVariantLabel || 'পণ্যভিত্তিক হার'
      : updates.vatVariantLabel,
    vatRate: effectiveVatRate,
    itRate: effectiveItRate,
    grossAmount,
    vatAmount,
    itAmount,
    totalDeduction,
    netPayable,
    updatedAt: serverTimestamp(),
    updatedBy: actorPayload,
  };
  const batch = writeBatch(db);
  batch.update(ref, patch);
  writeAuditLogInBatch(batch, {
    officeId: bill.officeId || null,
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
  const actorPayload = toActorPayload(actor);
  const itemSnaps = await Promise.all(
    (bill.itemIds || []).map((itemId) => getDoc(doc(db, 'expenseItems', itemId)))
  );

  const batch = writeBatch(db);
  const billRef = doc(db, 'bills', bill.id);
  batch.update(billRef, {
    deleted: true,
    updatedAt: serverTimestamp(),
    updatedBy: actorPayload,
  });

  for (const itemSnap of itemSnaps) {
    if (!itemSnap.exists()) continue;
    const itemData = itemSnap.data();
    if (itemData?.deleted) continue;
    if (itemData?.status !== 'billed' || itemData?.billId !== bill.id) continue;
    batch.update(itemSnap.ref, {
      status: 'listed',
      billId: null,
      updatedAt: serverTimestamp(),
      updatedBy: actorPayload,
    });
  }

  writeAuditLogInBatch(batch, {
    officeId: bill.officeId || null,
    collection: 'bills',
    docId: bill.id,
    action: 'delete',
    before: bill as unknown as Record<string, unknown>,
    after: { ...bill, deleted: true } as unknown as Record<string, unknown>,
    actor,
  });
  await batch.commit();
}

export async function deleteSubmittedBillTx(
  billId: string,
  actor: AuditActor,
  reasonInput?: string
): Promise<void> {
  assertOnlineForTransaction('জমাকৃত বিল মুছে ফেলা');
  const reason = (reasonInput || '').trim();

  const billRef = doc(db, 'bills', billId);
  const preBillSnap = await getDoc(billRef);
  if (!preBillSnap.exists() || preBillSnap.data().deleted) {
    throw new Error('বিলটি পাওয়া যায়নি।');
  }
  const preBill = preBillSnap.data() as Omit<BillDoc, 'id'>;
  const officeId = preBill.officeId || '';

  const budgetRefs = (preBill.pendingSlices || []).map((sl) => doc(db, 'budgets', sl.budgetId));
  const itemRefs = (preBill.itemIds || []).map((id) => doc(db, 'expenseItems', id));
  const fyTotalRef = doc(
    db,
    'fyCodeTotals',
    buildFyCodeTotalId(officeId, preBill.fiscalYear, preBill.economicCode)
  );
  const actorPayload = toActorPayload(actor);

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
      throw new Error('শুধুমাত্র জমাকৃত (submitted) বিল এই অপারেশনের মাধ্যমে মুছে ফেলা যায়।');
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
      if (release <= 0) continue;
      const newPending = Math.max(0, (b.pendingAmount || 0) - release);
      const newRemaining = b.allocated - b.spent - newPending;
      tx.update(bSnap.ref, {
        pendingAmount: newPending,
        remaining: newRemaining,
        updatedAt: serverTimestamp(),
        updatedBy: actorPayload,
      });
    }

    if (fyTotalSnap.exists()) {
      const f = fyTotalSnap.data() as Omit<FyCodeTotalDoc, 'id'>;
      tx.update(fyTotalRef, {
        pendingAmount: Math.max(0, (f.pendingAmount || 0) - before.grossAmount),
        updatedAt: serverTimestamp(),
        updatedBy: actorPayload,
      });
    }

    for (const itemSnap of itemSnaps) {
      if (!itemSnap.exists()) continue;
      const itemData = itemSnap.data();
      if (itemData?.deleted) continue;
      if (itemData?.status !== 'billed' || (itemData?.billId && itemData.billId !== billId)) {
        continue;
      }
      tx.update(itemSnap.ref, {
        status: 'listed',
        billId: null,
        updatedAt: serverTimestamp(),
        updatedBy: actorPayload,
      });
    }

    const billPatch: Record<string, unknown> = {
      deleted: true,
      updatedAt: serverTimestamp(),
      updatedBy: actorPayload,
    };
    if (reason) {
      billPatch.cancelReason = reason;
    }

    tx.update(billRef, billPatch);
    writeAuditLogInTx(tx, {
      officeId: officeId || null,
      collection: 'bills',
      docId: billId,
      action: 'delete',
      before: { id: billId, ...before },
      after: { id: billId, ...before, deleted: true, ...(reason ? { cancelReason: reason } : {}) },
      actor,
    });
  });
}

export async function deleteClosedBill(
  bill: BillDoc,
  actor: AuditActor,
  reasonInput?: string
): Promise<void> {
  if (bill.status !== 'rejected' && bill.status !== 'cancelled') {
    throw new Error('শুধুমাত্র প্রত্যাখ্যাত বা বাতিল বিল এইভাবে মুছে ফেলা যায়।');
  }
  const reason = (reasonInput || '').trim();
  const actorPayload = toActorPayload(actor);
  const batch = writeBatch(db);
  const billRef = doc(db, 'bills', bill.id);
  const patch: Record<string, unknown> = {
    deleted: true,
    updatedAt: serverTimestamp(),
    updatedBy: actorPayload,
  };
  if (reason && !bill.cancelReason) {
    patch.cancelReason = reason;
  }

  batch.update(billRef, patch);
  writeAuditLogInBatch(batch, {
    officeId: bill.officeId || null,
    collection: 'bills',
    docId: bill.id,
    action: 'delete',
    before: bill as unknown as Record<string, unknown>,
    after: {
      ...bill,
      deleted: true,
      ...(reason && !bill.cancelReason ? { cancelReason: reason } : {}),
    } as unknown as Record<string, unknown>,
    actor,
  });
  await batch.commit();
}

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

export interface SubmitBillDetails {
  voucherNo?: string;
  billDate?: string;
  tokenNo?: string;
  purposeText?: string;
  payeeText?: string;
}

export async function submitBillTx(
  billId: string,
  actor: AuditActor,
  details?: SubmitBillDetails
): Promise<{ billNo: string }> {
  assertOnlineForTransaction('বিল জমা');

  const billRef = doc(db, 'bills', billId);
  const preBillSnap = await getDoc(billRef);
  if (!preBillSnap.exists() || preBillSnap.data().deleted) {
    throw new Error('বিলটি পাওয়া যায়নি।');
  }
  const preBill = preBillSnap.data() as Omit<BillDoc, 'id'>;
  const requestedDate = details?.billDate?.trim();
  if (requestedDate && !isDateInFiscalYear(requestedDate, preBill.fiscalYear)) {
    throw new Error(`বিলের তারিখ অর্থবছর ${preBill.fiscalYear} এর মধ্যে হতে হবে।`);
  }
  const officeId = preBill.officeId || '';

  const budgetsQuery = officeId
    ? query(
        collection(db, 'budgets'),
        where('officeId', '==', officeId),
        where('fiscalYear', '==', preBill.fiscalYear)
      )
    : query(collection(db, 'budgets'), where('fiscalYear', '==', preBill.fiscalYear));

  const budgetsSnap = await getDocs(budgetsQuery);
  const budgetRefs = budgetsSnap.docs
    .filter((d) => !d.data().deleted && d.data().economicCode === preBill.economicCode)
    .map((d) => d.ref);
  if (budgetRefs.length === 0) {
    throw new Error(
      `অর্থনৈতিক কোড ${preBill.economicCode} এর জন্য FY ${preBill.fiscalYear}-এ কোনো বাজেট বরাদ্দ নেই।`
    );
  }

  const fyTotalRef = doc(
    db,
    'fyCodeTotals',
    buildFyCodeTotalId(officeId, preBill.fiscalYear, preBill.economicCode)
  );
  const counterRef = doc(db, 'counters', buildCounterId(officeId, preBill.fiscalYear));
  const actorPayload = toActorPayload(actor);

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

    const effectiveDate = requestedDate || before.date;
    if (requestedDate && !isDateInFiscalYear(requestedDate, before.fiscalYear)) {
      throw new Error(`বিলের তারিখ অর্থবছর ${before.fiscalYear} এর মধ্যে হতে হবে।`);
    }

    const slices = distributeAmountAcrossBudgets(
      freshBudgets,
      before.grossAmount,
      'pending',
      [],
      effectiveDate
    );

    if (!before.billNo) {
      const nextNum = counterSnap.exists() ? (counterSnap.data().nextNumber as number) || 1 : 1;
      assignedBillNo = formatSequentialBillNo(before.fiscalYear, nextNum);
      tx.set(
        counterRef,
        {
          officeId,
          fiscalYear: before.fiscalYear,
          nextNumber: nextNum + 1,
          updatedAt: serverTimestamp(),
          updatedBy: actorPayload,
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
        updatedBy: actorPayload,
      });
    }

    const prevFyPending = fyTotalSnap.exists()
      ? Math.max(0, (fyTotalSnap.data().pendingAmount as number) || 0)
      : freshBudgets.reduce((sum, b) => sum + Math.max(0, b.pendingAmount || 0), 0);

    if (fyTotalSnap.exists()) {
      tx.update(fyTotalRef, {
        pendingAmount: prevFyPending + before.grossAmount,
        updatedAt: serverTimestamp(),
        updatedBy: actorPayload,
      });
    } else {
      const prevFyAlloc = freshBudgets.reduce((sum, b) => sum + b.allocated, 0);
      const prevFySpent = freshBudgets.reduce((sum, b) => sum + b.spent, 0);
      tx.set(fyTotalRef, {
        officeId,
        fiscalYear: before.fiscalYear,
        economicCode: before.economicCode,
        allocated: prevFyAlloc,
        spent: prevFySpent,
        approvedSpent: prevFySpent,
        pendingAmount: prevFyPending + before.grossAmount,
        updatedAt: serverTimestamp(),
        updatedBy: actorPayload,
      });
    }

    const pendingSlices: BillBudgetSlice[] = slices.map((s) => ({
      budgetId: s.budget.id,
      amount: s.amount,
    }));

    const nextVoucherNo =
      details?.voucherNo !== undefined ? details.voucherNo.trim() : (before.voucherNo || '').trim();
    const nextTokenNo =
      details?.tokenNo !== undefined ? details.tokenNo.trim() : (before.tokenNo || '').trim();
    const nextPurposeText =
      details?.purposeText !== undefined
        ? details.purposeText.trim()
        : (before.purposeText || '').trim();
    const nextPayeeText =
      details?.payeeText !== undefined ? details.payeeText.trim() : (before.payeeText || '').trim();

    const afterFields = {
      billNo: assignedBillNo,
      voucherNo: nextVoucherNo,
      date: effectiveDate,
      billDate: requestedDate || before.billDate || effectiveDate,
      tokenNo: nextTokenNo,
      purposeText: nextPurposeText,
      payeeText: nextPayeeText,
      status: 'submitted' as BillStatus,
      submittedAt: serverTimestamp(),
      submittedBy: actorPayload,
      rejectReason: null,
      pendingSlices,
      updatedAt: serverTimestamp(),
      updatedBy: actorPayload,
    };

    tx.update(billRef, afterFields);
    writeAuditLogInTx(tx, {
      officeId: officeId || null,
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
  const officeId = preBill.officeId || '';

  const budgetsQuery = officeId
    ? query(
        collection(db, 'budgets'),
        where('officeId', '==', officeId),
        where('fiscalYear', '==', preBill.fiscalYear)
      )
    : query(collection(db, 'budgets'), where('fiscalYear', '==', preBill.fiscalYear));

  const limitsQuery = officeId
    ? query(
        collection(db, 'spendingLimits'),
        where('officeId', '==', officeId),
        where('fiscalYear', '==', preBill.fiscalYear)
      )
    : query(collection(db, 'spendingLimits'), where('fiscalYear', '==', preBill.fiscalYear));

  const [budgetsSnap, limitsSnap] = await Promise.all([
    getDocs(budgetsQuery),
    getDocs(limitsQuery),
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
  const fyTotalRef = doc(
    db,
    'fyCodeTotals',
    buildFyCodeTotalId(officeId, preBill.fiscalYear, preBill.economicCode)
  );
  const actorPayload = toActorPayload(actor);

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

    const rawFyTotal: FyCodeTotalDoc = fyTotalSnap.exists()
      ? ({ id: fyTotalSnap.id, ...fyTotalSnap.data() } as FyCodeTotalDoc)
      : {
          id: fyTotalRef.id,
          officeId,
          fiscalYear: before.fiscalYear,
          economicCode: before.economicCode,
          allocated: freshBudgets.reduce((sum, b) => sum + b.allocated, 0),
          spent: freshBudgets.reduce((sum, b) => sum + b.spent, 0),
          pendingAmount: before.grossAmount,
        };

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

    const activeBudgets = freshBudgets.filter((b) => b.status === 'active');
    if (activeBudgets.length === 0) {
      throw new Error('এই কোডে কোনো সক্রিয় (active) বাজেট নেই। সম্পন্ন (executed) বাজেটে অনুমোদন দেওয়া যায় না।');
    }

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
        updatedBy: actorPayload,
      });
    }

    const newFySpent = (rawFyTotal.spent || 0) + before.grossAmount;
    const newFyPending = Math.max(0, (rawFyTotal.pendingAmount || 0) - before.grossAmount);

    tx.set(
      fyTotalRef,
      {
        officeId,
        fiscalYear: before.fiscalYear,
        economicCode: before.economicCode,
        allocated: rawFyTotal.allocated,
        spent: newFySpent,
        approvedSpent: newFySpent,
        pendingAmount: newFyPending,
        updatedAt: serverTimestamp(),
        updatedBy: actorPayload,
      },
      { merge: true }
    );

    const budgetDeductions: BillBudgetSlice[] = approveSlices.map((s) => ({
      budgetId: s.budget.id,
      amount: s.amount,
    }));

    const afterFields = {
      status: 'approved' as BillStatus,
      approvedBy: actorPayload,
      approvedAt: serverTimestamp(),
      pendingSlices: [],
      budgetDeductions,
      updatedAt: serverTimestamp(),
      updatedBy: actorPayload,
    };

    tx.update(billRef, afterFields);
    writeAuditLogInTx(tx, {
      officeId: officeId || null,
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
  const officeId = preBill.officeId || '';

  const budgetRefs = (preBill.pendingSlices || []).map((sl) => doc(db, 'budgets', sl.budgetId));
  const itemRefs = (preBill.itemIds || []).map((id) => doc(db, 'expenseItems', id));
  const fyTotalRef = doc(
    db,
    'fyCodeTotals',
    buildFyCodeTotalId(officeId, preBill.fiscalYear, preBill.economicCode)
  );
  const actorPayload = toActorPayload(actor);

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
        updatedBy: actorPayload,
      });
    }

    if (fyTotalSnap.exists()) {
      const f = fyTotalSnap.data() as Omit<FyCodeTotalDoc, 'id'>;
      tx.update(fyTotalRef, {
        pendingAmount: Math.max(0, (f.pendingAmount || 0) - before.grossAmount),
        updatedAt: serverTimestamp(),
        updatedBy: actorPayload,
      });
    }

    for (const itemSnap of itemSnaps) {
      if (!itemSnap.exists() || itemSnap.data()?.deleted) continue;
      tx.update(itemSnap.ref, {
        status: 'listed',
        billId: null,
        updatedAt: serverTimestamp(),
        updatedBy: actorPayload,
      });
    }

    const afterFields = {
      status: 'rejected' as BillStatus,
      rejectedBy: actorPayload,
      rejectedAt: serverTimestamp(),
      rejectReason: reason,
      pendingSlices: [],
      updatedAt: serverTimestamp(),
      updatedBy: actorPayload,
    };

    tx.update(billRef, afterFields);
    writeAuditLogInTx(tx, {
      officeId: officeId || null,
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
  const officeId = preBill.officeId || '';

  let budgetRefs: DocumentReference[] = (preBill.budgetDeductions || []).map((d) =>
    doc(db, 'budgets', d.budgetId)
  );
  if (budgetRefs.length === 0) {
    const q = officeId
      ? query(
          collection(db, 'budgets'),
          where('officeId', '==', officeId),
          where('fiscalYear', '==', preBill.fiscalYear)
        )
      : query(collection(db, 'budgets'), where('fiscalYear', '==', preBill.fiscalYear));
    const codeBudgetsSnap = await getDocs(q);
    budgetRefs = codeBudgetsSnap.docs
      .filter((d) => !d.data().deleted && d.data().economicCode === preBill.economicCode)
      .map((d) => d.ref);
  }
  const itemRefs = (preBill.itemIds || []).map((id) => doc(db, 'expenseItems', id));
  const fyTotalRef = doc(
    db,
    'fyCodeTotals',
    buildFyCodeTotalId(officeId, preBill.fiscalYear, preBill.economicCode)
  );
  const actorPayload = toActorPayload(actor);

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
          updatedBy: actorPayload,
        });
      }
    } else {
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
            updatedBy: actorPayload,
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
        updatedBy: actorPayload,
      });
    }

    for (const itemSnap of itemSnaps) {
      if (!itemSnap.exists() || itemSnap.data()?.deleted) continue;
      tx.update(itemSnap.ref, {
        status: 'listed',
        billId: null,
        updatedAt: serverTimestamp(),
        updatedBy: actorPayload,
      });
    }

    const afterFields = {
      status: 'cancelled' as BillStatus,
      cancelledBy: actorPayload,
      cancelledAt: serverTimestamp(),
      cancelReason: reason,
      updatedAt: serverTimestamp(),
      updatedBy: actorPayload,
    };

    tx.update(billRef, afterFields);
    writeAuditLogInTx(tx, {
      officeId: officeId || null,
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
 * SUPER ADMIN AUDITED CORRECTIONS ON APPROVED BILLS
 * ============================================================================ */

export async function correctApprovedBillTx(
  billId: string,
  updates: {
    date: string;
    billDate?: string;
    voucherNo?: string;
    vatVariant: string;
    vatVariantLabel: string;
    vatRate: number;
    itRate: number;
    tokenNo?: string;
    purposeText?: string;
    tr21P1S3Mode?: Tr21P1S3Mode | null;
    voucherTitle?: string;
    payeeText?: string;
    netPayableCode?: string;
    supplier?: BillSupplierInfo | null;
    deductions?: BillDeductionLine[];
    correctionReason: string;
  },
  actor: AuditActor
): Promise<void> {
  assertOnlineForTransaction('অনুমোদিত বিল সংশোধন');
  const reason = updates.correctionReason.trim();
  if (!reason) throw new Error('সংশোধনের কারণ উল্লেখ করা আবশ্যক।');

  const billRef = doc(db, 'bills', billId);
  const preSnap = await getDoc(billRef);
  if (!preSnap.exists() || preSnap.data().deleted) {
    throw new Error('বিলটি পাওয়া যায়নি।');
  }
  const preBill = preSnap.data() as Omit<BillDoc, 'id'>;
  if (preBill.status !== 'approved') {
    throw new Error('শুধুমাত্র অনুমোদিত (approved) বিল সুপার অ্যাডমিন দ্বারা সংশোধন করা যায়।');
  }
  const officeId = preBill.officeId || '';

  const fyTotalRef = doc(
    db,
    'fyCodeTotals',
    buildFyCodeTotalId(officeId, preBill.fiscalYear, preBill.economicCode)
  );
  let budgetRefs: DocumentReference[] = (preBill.budgetDeductions || []).map((d) =>
    doc(db, 'budgets', d.budgetId)
  );
  if (budgetRefs.length === 0) {
    const q = officeId
      ? query(
          collection(db, 'budgets'),
          where('officeId', '==', officeId),
          where('fiscalYear', '==', preBill.fiscalYear)
        )
      : query(collection(db, 'budgets'), where('fiscalYear', '==', preBill.fiscalYear));
    const snap = await getDocs(q);
    budgetRefs = snap.docs
      .filter((d) => !d.data().deleted && d.data().economicCode === preBill.economicCode)
      .map((d) => d.ref);
  }
  const actorPayload = toActorPayload(actor);

  await runTransaction(db, async (tx) => {
    const [billSnap, fyTotalSnap, ...budgetSnaps] = await Promise.all([
      tx.get(billRef),
      tx.get(fyTotalRef),
      ...budgetRefs.map((r) => tx.get(r)),
    ]);
    if (!billSnap.exists() || billSnap.data().deleted) {
      throw new Error('বিলটি পাওয়া যায়নি।');
    }
    const before = billSnap.data() as Omit<BillDoc, 'id'>;
    if (!isDateInFiscalYear(updates.date, before.fiscalYear)) {
      throw new Error(`বিলের তারিখ অর্থবছর ${before.fiscalYear} এর মধ্যে হতে হবে।`);
    }

    const itemsExpenseTotal = before.items.reduce((sum, item) => sum + item.amount, 0);
    const hasItemBreakdown = before.items.length > 0 && itemsExpenseTotal > 0;
    const computed = hasItemBreakdown
      ? computeBillFinancialsFromItems({
          items: before.items,
          vatRate: updates.vatRate,
          itRate: updates.itRate,
          customDeductions: updates.deductions,
          defaultItCode: DEFAULT_IT_CODE,
          defaultVatCode: DEFAULT_VAT_CODE,
        })
      : {
          grossAmount: before.grossAmount,
          ...summarizeBillDeductions(
            before.grossAmount,
            updates.vatRate,
            updates.itRate,
            updates.deductions
          ),
        };

    if (computed.netPayable < 0) {
      throw new Error('মোট কর্তন বিলের চেয়ে বেশি হতে পারে না।');
    }

    const deltaGross = computed.grossAmount - before.grossAmount;
    const updatedBudgetDeductions = [...(before.budgetDeductions || [])];

    if (deltaGross !== 0 && budgetSnaps.length > 0) {
      // Adjust primary budget deduction slice safely
      const targetBudgetSnap = budgetSnaps.find((s) => s.exists());
      if (targetBudgetSnap && targetBudgetSnap.exists()) {
        const b = targetBudgetSnap.data() as Omit<BudgetDoc, 'id'>;
        const newSpent = Math.max(0, b.spent + deltaGross);
        const pending = Math.max(0, b.pendingAmount || 0);
        tx.update(targetBudgetSnap.ref, {
          spent: newSpent,
          approvedSpent: newSpent,
          remaining: b.allocated - newSpent - pending,
          updatedAt: serverTimestamp(),
          updatedBy: actorPayload,
        });
        const idx = updatedBudgetDeductions.findIndex((sl) => sl.budgetId === targetBudgetSnap.id);
        if (idx >= 0) {
          updatedBudgetDeductions[idx] = {
            ...updatedBudgetDeductions[idx],
            amount: Math.max(0, updatedBudgetDeductions[idx].amount + deltaGross),
          };
        }
      }

      if (fyTotalSnap.exists()) {
        const f = fyTotalSnap.data() as Omit<FyCodeTotalDoc, 'id'>;
        const nextSpent = Math.max(0, (f.spent || 0) + deltaGross);
        tx.update(fyTotalRef, {
          spent: nextSpent,
          approvedSpent: nextSpent,
          updatedAt: serverTimestamp(),
          updatedBy: actorPayload,
        });
      }
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

    const isPureVoucher = before.amountBasis === 'voucher' || ('amountBasis' in computed && computed.amountBasis === 'voucher');
    const afterFields = {
      date: updates.date,
      billDate: updates.billDate || updates.date,
      voucherNo: (updates.voucherNo ?? before.voucherNo ?? '').trim(),
      tokenNo: (updates.tokenNo ?? before.tokenNo ?? '').trim(),
      purposeText: (updates.purposeText ?? before.purposeText ?? '').trim(),
      tr21P1S3Mode:
        updates.tr21P1S3Mode !== undefined ? updates.tr21P1S3Mode : before.tr21P1S3Mode ?? null,
      voucherTitle: (updates.voucherTitle ?? before.voucherTitle ?? '').trim(),
      payeeText: (updates.payeeText ?? before.payeeText ?? '').trim(),
      netPayableCode: (
        updates.netPayableCode ??
        before.netPayableCode ??
        DEFAULT_NET_PAYABLE_CODE
      ).trim(),
      supplier: updates.supplier !== undefined ? cleanSupplier : before.supplier ?? null,
      deductions: computed.deductions,
      vatVariant: isPureVoucher ? before.vatVariant || 'product-wise' : updates.vatVariant,
      vatVariantLabel: isPureVoucher
        ? before.vatVariantLabel || 'পণ্যভিত্তিক হার'
        : updates.vatVariantLabel,
      vatRate: computed.effectiveVatRate,
      itRate: computed.effectiveItRate,
      grossAmount: computed.grossAmount,
      vatAmount: computed.vatAmount,
      itAmount: computed.itAmount,
      totalDeduction: computed.totalDeduction,
      netPayable: computed.netPayable,
      budgetDeductions: updatedBudgetDeductions,
      updatedAt: serverTimestamp(),
      updatedBy: actorPayload,
    };

    tx.update(billRef, afterFields);
    writeAuditLogInTx(tx, {
      officeId: officeId || null,
      collection: 'bills',
      docId: billId,
      action: 'correct',
      before: { id: billId, ...before },
      after: { id: billId, ...before, ...afterFields, correctionReason: reason },
      actor,
    });
  });
}

export async function softDeleteApprovedBillTx(
  billId: string,
  reasonInput: string,
  actor: AuditActor
): Promise<void> {
  assertOnlineForTransaction('অনুমোদিত বিল মুছে ফেলা');
  const reason = reasonInput.trim();
  if (!reason) throw new Error('কারণ উল্লেখ করা আবশ্যক।');

  const billRef = doc(db, 'bills', billId);
  const preBillSnap = await getDoc(billRef);
  if (!preBillSnap.exists() || preBillSnap.data().deleted) {
    throw new Error('বিলটি পাওয়া যায়নি।');
  }
  const preBill = preBillSnap.data() as Omit<BillDoc, 'id'>;
  const officeId = preBill.officeId || '';

  let budgetRefs: DocumentReference[] = (preBill.budgetDeductions || []).map((d) =>
    doc(db, 'budgets', d.budgetId)
  );
  if (budgetRefs.length === 0) {
    const q = officeId
      ? query(
          collection(db, 'budgets'),
          where('officeId', '==', officeId),
          where('fiscalYear', '==', preBill.fiscalYear)
        )
      : query(collection(db, 'budgets'), where('fiscalYear', '==', preBill.fiscalYear));
    const codeBudgetsSnap = await getDocs(q);
    budgetRefs = codeBudgetsSnap.docs
      .filter((d) => !d.data().deleted && d.data().economicCode === preBill.economicCode)
      .map((d) => d.ref);
  }
  const itemRefs = (preBill.itemIds || []).map((id) => doc(db, 'expenseItems', id));
  const fyTotalRef = doc(
    db,
    'fyCodeTotals',
    buildFyCodeTotalId(officeId, preBill.fiscalYear, preBill.economicCode)
  );
  const actorPayload = toActorPayload(actor);

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
      throw new Error('শুধুমাত্র অনুমোদিত (approved) বিল এই অপারেশনের মাধ্যমে মুছে ফেলা যায়।');
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
        tx.update(bSnap.ref, {
          spent: newSpent,
          approvedSpent: newSpent,
          remaining: b.allocated - newSpent - pending,
          updatedAt: serverTimestamp(),
          updatedBy: actorPayload,
        });
      }
    } else {
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
            updatedBy: actorPayload,
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
        updatedBy: actorPayload,
      });
    }

    for (const itemSnap of itemSnaps) {
      if (!itemSnap.exists()) continue;
      const itemData = itemSnap.data();
      if (itemData?.deleted) continue;
      if (itemData?.status !== 'billed' || (itemData?.billId && itemData.billId !== billId)) {
        continue;
      }
      tx.update(itemSnap.ref, {
        status: 'listed',
        billId: null,
        updatedAt: serverTimestamp(),
        updatedBy: actorPayload,
      });
    }

    tx.update(billRef, {
      deleted: true,
      cancelReason: reason,
      updatedAt: serverTimestamp(),
      updatedBy: actorPayload,
    });

    writeAuditLogInTx(tx, {
      officeId: officeId || null,
      collection: 'bills',
      docId: billId,
      action: 'correct',
      before: { id: billId, ...before },
      after: { id: billId, ...before, deleted: true, correctionReason: reason },
      actor,
    });
  });
}

export async function deleteBill(
  bill: BillDoc,
  actor: AuditActor,
  reasonInput?: string
): Promise<void> {
  switch (bill.status) {
    case 'draft':
      await deleteDraftBill(bill, actor);
      return;
    case 'rejected':
    case 'cancelled':
      await deleteClosedBill(bill, actor, reasonInput);
      return;
    default:
      throw new Error('শুধুমাত্র খসড়া (draft), প্রত্যাখ্যাত (rejected) অথবা বাতিল (cancelled) বিল মুছে ফেলা যায়।');
  }
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
  actor: AuditActor,
  fallbackOfficeId = ''
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

  const pendingDeltaByBudget = new Map<string, number>();
  const pendingDeltaByFyCode = new Map<string, number>();

  const toCreate: Array<{
    billId: string;
    itemId: string;
    billPayload: Record<string, unknown>;
    itemPayload: Record<string, unknown> | null;
  }> = [];

  let skippedExisting = 0;
  const actorPayload = toActorPayload(actor);

  for (const sp of activeSpendings) {
    const detBillId = `mig_bill_${sp.id}`;
    const detItemId = `mig_item_${sp.id}`;
    if (existingBillIds.has(detBillId) || existingMigratedIds.has(sp.id)) {
      skippedExisting++;
      continue;
    }

    const spOfficeId = sp.officeId || fallbackOfficeId;
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
          officeId: spOfficeId,
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
          createdBy: sp.createdBy || actorPayload,
          createdByName: sp.createdByName || actor.name,
          updatedAt: serverTimestamp(),
          updatedBy: actorPayload,
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
      const fyCodeKey = buildFyCodeTotalId(spOfficeId, sp.fiscalYear, sp.economicCode);
      pendingDeltaByFyCode.set(fyCodeKey, (pendingDeltaByFyCode.get(fyCodeKey) || 0) + sp.gross);
    }

    const billPayload = {
      officeId: spOfficeId,
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
      submittedBy: sp.createdBy || actorPayload,
      approvedBy: sp.approvedBy || null,
      approvedAt: sp.approvedAt || null,
      rejectReason: sp.rejectReason || null,
      cancelledBy: sp.status === 'voided' ? sp.voidedBy || actorPayload : null,
      cancelledAt: sp.status === 'voided' ? sp.voidedAt || serverTimestamp() : null,
      cancelReason: sp.status === 'voided' ? sp.voidReason || 'Legacy voided entry' : null,
      pendingSlices,
      budgetDeductions,
      migratedFromSpendingId: sp.id,
      deleted: false,
      createdAt: sp.createdAt || serverTimestamp(),
      createdBy: sp.createdBy || actorPayload,
      createdByName: sp.createdByName || actor.name,
      updatedAt: serverTimestamp(),
      updatedBy: actorPayload,
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
        updatedBy: actorPayload,
      });
      syncedBudgets++;
    }
    await batch.commit();
  }

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
        updatedBy: actorPayload,
      });
      syncedFyTotals++;
    }
    await batch.commit();
  }

  const auditBatch = writeBatch(db);
  writeAuditLogInBatch(auditBatch, {
    officeId: fallbackOfficeId || null,
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
  const actorPayload = toActorPayload(actor);

  const batch = writeBatch(db);
  const payload = {
    fiscalYear: input.fiscalYear,
    economicCode: code,
    description: resolvedDesc,
    descriptionBn: resolvedDescBn,
    incomeTax: input.incomeTax,
    vat: input.vat,
    updatedAt: serverTimestamp(),
    updatedBy: actorPayload,
    ...(isNew ? { createdAt: serverTimestamp(), createdBy: actorPayload } : {}),
  };
  batch.set(ref, payload, { merge: true });
  writeAuditLogInBatch(batch, {
    officeId: null,
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
  const actorPayload = toActorPayload(actor);
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
      createdBy: actorPayload,
      updatedAt: serverTimestamp(),
      updatedBy: actorPayload,
    };
    batch.set(ref, payload, { merge: true });
    writeAuditLogInBatch(batch, {
      officeId: null,
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
    officeId: string;
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
  const officeId = input.officeId.trim();
  if (!officeId) throw new Error('Office is required.');

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

  const actorPayload = toActorPayload(actor);
  const ref = doc(collection(db, 'spendingLimits'));
  const batch = writeBatch(db);
  const payload = {
    officeId,
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
    createdBy: actorPayload,
    updatedAt: serverTimestamp(),
    updatedBy: actorPayload,
  };
  batch.set(ref, payload);
  writeAuditLogInBatch(batch, {
    officeId,
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

export async function createSpendingLimitsForAllOfficesBatch(
  input: {
    offices: OfficeDoc[];
    fiscalYear: string;
    economicCode: string;
    headName: string;
    headNameBn: string;
    rate: number;
    effectiveDate: string;
    refNo: string;
  },
  actor: AuditActor
): Promise<number> {
  const activeOffices = input.offices.filter((o) => o.status === 'active');
  if (activeOffices.length === 0) throw new Error('No active offices available.');
  const code = input.economicCode.trim();
  if (!isValidEconomicCode(code, false)) throw new Error('Economic code must be 7 digits.');
  const masterSnap = await getDoc(doc(db, 'economicCodes', code));
  if (!masterSnap.exists()) throw new Error(`Economic code "${code}" does not exist.`);
  const masterData = masterSnap.data() as Omit<EconomicCodeDoc, 'id'>;
  if (masterData.special) throw new Error('GENERAL-CONSTRUCTION cannot be used for a spending limit.');
  if (input.rate <= 0 || input.rate > 100) throw new Error('Rate must be between 1 and 100 percent.');
  if (!isDateInFiscalYear(input.effectiveDate, input.fiscalYear)) {
    throw new Error(`Effective date must fall inside FY ${input.fiscalYear}.`);
  }
  if (!input.refNo.trim()) throw new Error('Letter / reference number is required.');

  const actorPayload = toActorPayload(actor);
  let count = 0;
  for (let i = 0; i < activeOffices.length; i += 200) {
    const chunk = activeOffices.slice(i, i + 200);
    const batch = writeBatch(db);
    for (const off of chunk) {
      const ref = doc(collection(db, 'spendingLimits'));
      const payload = {
        officeId: off.id,
        type: 'code' as const,
        budgetId: null,
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
        createdBy: actorPayload,
        updatedAt: serverTimestamp(),
        updatedBy: actorPayload,
      };
      batch.set(ref, payload);
      writeAuditLogInBatch(batch, {
        officeId: off.id,
        collection: 'spendingLimits',
        docId: ref.id,
        action: 'create',
        before: null,
        after: { id: ref.id, ...payload },
        actor,
      });
      count++;
    }
    await batch.commit();
  }
  return count;
}

export async function withdrawSpendingLimit(
  limitDoc: SpendingLimitDoc,
  actor: AuditActor
): Promise<void> {
  const actorPayload = toActorPayload(actor);
  const batch = writeBatch(db);
  const ref = doc(db, 'spendingLimits', limitDoc.id);
  batch.update(ref, {
    status: 'withdrawn',
    updatedAt: serverTimestamp(),
    updatedBy: actorPayload,
  });
  writeAuditLogInBatch(batch, {
    officeId: limitDoc.officeId || null,
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
  input: {
    email: string;
    name?: string;
    designation: string;
    role: 'ddo' | 'employee';
    officeId: string;
    kind?: 'regular' | 'additionalCharge';
    orderNo?: string;
    orderDate?: string;
  },
  actor: AuditActor
): Promise<void> {
  const emailLower = normalizeEmail(input.email);
  if (!emailLower || !emailLower.includes('@')) {
    throw new Error('Enter a valid email address.');
  }
  if (!input.designation.trim()) {
    throw new Error('Designation is required.');
  }
  if (!input.officeId) throw new Error('Office is required.');

  const actorPayload = toActorPayload(actor);
  const ref = doc(db, 'invites', emailLower);
  const batch = writeBatch(db);
  const payload = {
    email: emailLower,
    name: input.name?.trim() || '',
    designation: input.designation.trim(),
    officeId: input.officeId,
    role: input.role,
    kind: input.kind || 'regular',
    orderNo: (input.orderNo || '').trim(),
    orderDate: (input.orderDate || '').trim(),
    invitedBy: actorPayload,
    createdAt: serverTimestamp(),
    createdBy: actorPayload,
    updatedAt: serverTimestamp(),
    updatedBy: actorPayload,
  };
  batch.set(ref, payload);
  writeAuditLogInBatch(batch, {
    officeId: input.officeId,
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
    officeId: actor.officeId ?? null,
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
  const actorPayload = toActorPayload(actor);
  const batch = writeBatch(db);
  const ref = doc(db, 'users', userId);
  const patch = {
    ...updates,
    updatedAt: serverTimestamp(),
    updatedBy: actorPayload,
  };
  batch.update(ref, patch);
  writeAuditLogInBatch(batch, {
    officeId: actor.officeId ?? null,
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
  actor: AuditActor,
  targetOfficeId?: string | null
): Promise<void> {
  const actorPayload = toActorPayload(actor);
  const batch = writeBatch(db);
  const effectiveOfficeId = targetOfficeId || settings.officeId || null;

  if (effectiveOfficeId) {
    const officeRef = doc(db, 'offices', effectiveOfficeId);
    const officePatch: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
      updatedBy: actorPayload,
    };
    if (settings.officeName !== undefined) officePatch.name = settings.officeName.trim();
    if (settings.officeNameBn !== undefined) officePatch.nameBn = settings.officeNameBn.trim();
    if (settings.officeCode !== undefined) officePatch.code = settings.officeCode.trim();
    if (settings.address !== undefined) officePatch.address = settings.address;
    if (settings.activeFiscalYear !== undefined) officePatch.activeFiscalYear = settings.activeFiscalYear;
    if (settings.fiscalYears !== undefined) officePatch.fiscalYears = settings.fiscalYears;
    if (settings.language !== undefined) officePatch.language = settings.language;
    if (settings.ministryName !== undefined) officePatch.ministryName = settings.ministryName;
    if (settings.officeMobileNo !== undefined) officePatch.officeMobileNo = settings.officeMobileNo;
    if (settings.institutionalCode !== undefined)
      officePatch.institutionalCode = settings.institutionalCode;
    if (settings.defaultPayeeText !== undefined) officePatch.defaultPayeeText = settings.defaultPayeeText;
    if (settings.placeName !== undefined) officePatch.placeName = settings.placeName;
    if (settings.defaultNetPayableCode !== undefined)
      officePatch.defaultNetPayableCode = settings.defaultNetPayableCode;
    if (settings.defaultItCode !== undefined) officePatch.defaultItCode = settings.defaultItCode;
    if (settings.defaultVatCode !== undefined) officePatch.defaultVatCode = settings.defaultVatCode;
    if (settings.defaultSecurityCode !== undefined)
      officePatch.defaultSecurityCode = settings.defaultSecurityCode;
    if (settings.tr21FooterText !== undefined) officePatch.tr21FooterText = settings.tr21FooterText;
    if (settings.tr21FontFamily !== undefined) officePatch.tr21FontFamily = settings.tr21FontFamily;
    if (settings.tr21FontSize !== undefined) officePatch.tr21FontSize = settings.tr21FontSize;
    if (settings.tr21P1S3Mode !== undefined) officePatch.tr21P1S3Mode = settings.tr21P1S3Mode;
    if (settings.tr21VoucherLabel !== undefined) officePatch.tr21VoucherLabel = settings.tr21VoucherLabel;
    if (settings.tr21Clauses !== undefined) officePatch.tr21Clauses = settings.tr21Clauses;

    batch.update(officeRef, officePatch);
    writeAuditLogInBatch(batch, {
      officeId: effectiveOfficeId,
      collection: 'offices',
      docId: effectiveOfficeId,
      action: 'update',
      before: null,
      after: officePatch,
      actor,
    });
  } else {
    const ref = doc(db, 'settings', 'office');
    const patch = {
      ...settings,
      updatedAt: serverTimestamp(),
      updatedBy: actorPayload,
    };
    batch.set(ref, patch, { merge: true });
    writeAuditLogInBatch(batch, {
      officeId: null,
      collection: 'settings',
      docId: 'office',
      action: 'update',
      before: null,
      after: patch,
      actor,
    });
  }
  await batch.commit();
}

export async function upsertEconomicCode(
  input: {
    code: string;
    headName?: string;
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
  const headNameBn = input.headNameBn.trim();
  const headName = (input.headName || '').trim() || headNameBn;
  if (!headNameBn && !headName) throw new Error('ব্যয়ের খাত প্রয়োজন।');

  const ref = doc(db, 'economicCodes', code);
  const existingSnap = await getDoc(ref);
  const exists = existingSnap.exists();
  const before = exists
    ? ({ id: existingSnap.id, ...existingSnap.data() } as Record<string, unknown>)
    : null;
  const actorPayload = toActorPayload(actor);

  const payload = {
    code,
    headName,
    headNameBn,
    active: input.active,
    special: isSpecial,
    updatedAt: serverTimestamp(),
    updatedBy: actorPayload,
    ...(exists ? {} : { createdAt: serverTimestamp(), createdBy: actorPayload }),
  };

  const batch = writeBatch(db);
  batch.set(ref, payload, { merge: true });
  writeAuditLogInBatch(batch, {
    officeId: null,
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
  const actorPayload = toActorPayload(actor);
  const ref = doc(db, 'economicCodes', entry.code);
  const batch = writeBatch(db);
  batch.update(ref, {
    active,
    updatedAt: serverTimestamp(),
    updatedBy: actorPayload,
  });
  writeAuditLogInBatch(batch, {
    officeId: null,
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
    officeId: null,
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
  const actorPayload = toActorPayload(actor);
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
        createdBy: actorPayload,
        updatedAt: serverTimestamp(),
        updatedBy: actorPayload,
      };
      batch.set(ref, payload);
      writeAuditLogInBatch(batch, {
        officeId: null,
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

export type DeletableDbTableKey =
  | 'budgets'
  | 'fyCodeTotals'
  | 'expenseItems'
  | 'bills'
  | 'counters'
  | 'vatTaxRates'
  | 'spendingLimits'
  | 'economicCodes'
  | 'spendings'
  | 'invites';

export interface DbTableDescriptor {
  key: DeletableDbTableKey;
  labelBn: string;
  descriptionBn: string;
  category: 'transactional' | 'master';
  officeScoped: boolean;
}

export const DELETABLE_DB_TABLES: DbTableDescriptor[] = [
  {
    key: 'bills',
    labelBn: 'বিলসমূহ (Bills)',
    descriptionBn: 'সকল খসড়া, জমা, অনুমোদিত, প্রত্যাখ্যাত ও বাতিল বিল',
    category: 'transactional',
    officeScoped: true,
  },
  {
    key: 'expenseItems',
    labelBn: 'খরচ তালিকা (Expense Items)',
    descriptionBn: 'তালিকাভুক্ত ও বিলকৃত সকল খরচের আইটেম',
    category: 'transactional',
    officeScoped: true,
  },
  {
    key: 'budgets',
    labelBn: 'বরাদ্দকৃত বাজেট (Budgets)',
    descriptionBn: 'সকল মূল বাজেট বরাদ্দ ও সংশোধন এন্ট্রি',
    category: 'transactional',
    officeScoped: true,
  },
  {
    key: 'fyCodeTotals',
    labelBn: 'কোডভিত্তিক মোট হিসাব (FY Code Totals)',
    descriptionBn: 'অর্থবছর ও অর্থনৈতিক কোড অনুযায়ী সংরক্ষিত বরাদ্দ/ব্যয় সমষ্টি',
    category: 'transactional',
    officeScoped: true,
  },
  {
    key: 'counters',
    labelBn: 'বিল নম্বর কাউন্টার (Counters)',
    descriptionBn: 'অর্থবছর অনুযায়ী ক্রমিক বিল নম্বরের কাউন্টার',
    category: 'transactional',
    officeScoped: true,
  },
  {
    key: 'spendingLimits',
    labelBn: 'ব্যয়ের সীমা (Spending Limits)',
    descriptionBn: 'কোড ও বাজেটভিত্তিক সর্বোচ্চ ব্যয়ের সীমা',
    category: 'transactional',
    officeScoped: true,
  },
  {
    key: 'vatTaxRates',
    labelBn: 'ভ্যাট ও আয়কর হার (VAT & Tax Rates)',
    descriptionBn: 'অর্থবছর অনুযায়ী নির্ধারিত ভ্যাট ও আয়করের হার (গ্লোবাল)',
    category: 'master',
    officeScoped: false,
  },
  {
    key: 'economicCodes',
    labelBn: 'অর্থনৈতিক কোড (Economic Codes)',
    descriptionBn: 'মাস্টার অর্থনৈতিক কোড ও ব্যয়ের খাত তালিকা (গ্লোবাল)',
    category: 'master',
    officeScoped: false,
  },
  {
    key: 'spendings',
    labelBn: 'পুরনো ব্যয় রেকর্ড (Legacy Spendings)',
    descriptionBn: 'মাইগ্রেশনের আগের পুরনো spendings কালেকশন',
    category: 'transactional',
    officeScoped: true,
  },
  {
    key: 'invites',
    labelBn: 'ব্যবহারকারী আমন্ত্রণ (Invites)',
    descriptionBn: 'অপেক্ষমান ইমেইল আমন্ত্রণ তালিকা',
    category: 'master',
    officeScoped: true,
  },
];

const DELETABLE_KEY_SET = new Set<DeletableDbTableKey>(DELETABLE_DB_TABLES.map((t) => t.key));

export async function fetchDbTableCounts(
  officeIdFilter?: string | null
): Promise<Record<DeletableDbTableKey, number>> {
  const snaps = await Promise.all(
    DELETABLE_DB_TABLES.map(async (t) => {
      const q =
        officeIdFilter && officeIdFilter !== 'ALL' && t.officeScoped
          ? query(collection(db, t.key), where('officeId', '==', officeIdFilter))
          : collection(db, t.key);
      const snap = await getDocs(q);
      return [t.key, snap.size] as const;
    })
  );
  const result = {} as Record<DeletableDbTableKey, number>;
  for (const [k, count] of snaps) {
    result[k] = count;
  }
  return result;
}

export async function clearDbTables(
  tableKeys: DeletableDbTableKey[],
  actor: AuditActor,
  officeIdFilter?: string | null
): Promise<Array<{ table: DeletableDbTableKey; deletedCount: number }>> {
  assertOnlineForTransaction('টেবিল অনুযায়ী সকল ডেটা মুছা');

  const uniqueKeys = Array.from(new Set(tableKeys)).filter((k) => DELETABLE_KEY_SET.has(k));
  if (uniqueKeys.length === 0) {
    throw new Error('মুছার জন্য অন্তত একটি টেবিল নির্বাচন করুন।');
  }

  const descriptorMap = new Map(DELETABLE_DB_TABLES.map((t) => [t.key, t]));
  const results: Array<{ table: DeletableDbTableKey; deletedCount: number }> = [];
  const CHUNK_SIZE = 450;

  for (const tableKey of uniqueKeys) {
    const desc = descriptorMap.get(tableKey);
    const scoped = Boolean(officeIdFilter && officeIdFilter !== 'ALL' && desc?.officeScoped);
    const q = scoped
      ? query(collection(db, tableKey), where('officeId', '==', officeIdFilter))
      : collection(db, tableKey);

    const snap = await getDocs(q);
    const docs = snap.docs;
    if (docs.length === 0) {
      results.push({ table: tableKey, deletedCount: 0 });
      continue;
    }

    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
      const chunk = docs.slice(i, i + CHUNK_SIZE);
      const isLastChunk = i + CHUNK_SIZE >= docs.length;
      const batch = writeBatch(db);
      for (const d of chunk) {
        batch.delete(d.ref);
      }
      if (isLastChunk) {
        writeAuditLogInBatch(batch, {
          officeId: scoped ? officeIdFilter || null : null,
          collection: tableKey,
          docId: scoped ? `BULK_DELETE_${officeIdFilter}` : 'BULK_DELETE_ALL',
          action: 'delete',
          before: { deletedCount: docs.length },
          after: null,
          actor,
        });
      }
      await batch.commit();
    }

    results.push({ table: tableKey, deletedCount: docs.length });
  }

  return results;
}
