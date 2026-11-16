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
} from 'firebase/firestore';
import { db } from './firebase';
import { writeAuditLogInBatch, writeAuditLogInTx, type AuditActor } from './audit';
import { computeAvailable } from './computeAvailable';
import { isDateInFiscalYear } from './fy';
import { isValidEconomicCode, normalizeEmail } from './validation';
import type {
  BudgetDoc,
  BudgetEntryType,
  BudgetStatus,
  DeductionRates,
  DeductionsApplied,
  EconomicCodeDoc,
  FyCodeTotalDoc,
  OfficeSettings,
  Role,
  SpendingDeductions,
  SpendingDoc,
  SpendingLimitDoc,
  SpendingLimitType,
  UserStatus,
  VatTaxRateDoc,
  VatVariant,
} from '../types';

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

  // Validate economic code exists in master economicCodes collection
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

  // Check duplicate memoNo within the same FY (non-deleted)
  const dupSnap = await getDocs(
    query(
      collection(db, 'budgets'),
      where('fiscalYear', '==', input.fiscalYear),
      where('memoNo', '==', memoNo)
    )
  );
  const hasActiveDup = dupSnap.docs.some((d) => !d.data().deleted);
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
    if (updates.allocated < before.spent) {
      throw new Error('Allocated amount cannot be less than already spent amount.');
    }

    const fyTotalRef = doc(db, 'fyCodeTotals', `${before.fiscalYear}_${before.economicCode}`);
    const fyTotalSnap = await tx.get(fyTotalRef);
    const prevFyAlloc = fyTotalSnap.exists() ? (fyTotalSnap.data().allocated as number) || 0 : 0;
    const delta = updates.allocated - before.allocated;
    const newRemaining = updates.allocated - before.spent;

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
        spent: fyTotalSnap.exists() ? (fyTotalSnap.data().spent as number) || 0 : before.spent,
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
    if (before.spent > 0) {
      throw new Error('Cannot delete a budget with approved spendings. Void or delete those spendings first.');
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

export interface SpendingFormPayload {
  budgetId: string;
  fiscalYear: string;
  economicCode: string;
  headName: string;
  headNameBn?: string;
  date: string;
  billNo: string;
  chequeNo?: string | null;
  payee: string;
  gross: number;
  vatVariant: string;
  deductions: SpendingDeductions;
  netPayable: number;
  deductionsApplied: DeductionsApplied;
}

export async function saveSpendingDraftOrSubmit(
  payload: SpendingFormPayload,
  mode: 'draft' | 'submitted',
  existingId: string | null,
  actor: AuditActor
): Promise<string> {
  if (!payload.budgetId) throw new Error('Select a budget head.');
  if (!isDateInFiscalYear(payload.date, payload.fiscalYear)) {
    throw new Error(`Date must fall inside FY ${payload.fiscalYear}.`);
  }
  if (!payload.billNo.trim()) throw new Error('Bill number is required.');
  if (!payload.payee.trim()) throw new Error('Payee is required.');
  if (payload.gross <= 0) throw new Error('Gross bill must be greater than zero.');
  if (payload.netPayable < 0) throw new Error('Net payable cannot be negative.');

  const batch = writeBatch(db);
  const targetRef = existingId
    ? doc(db, 'spendings', existingId)
    : doc(collection(db, 'spendings'));

  const commonFields = {
    budgetId: payload.budgetId,
    fiscalYear: payload.fiscalYear,
    economicCode: payload.economicCode,
    headName: payload.headName,
    headNameBn: payload.headNameBn || '',
    date: payload.date,
    billNo: payload.billNo.trim(),
    chequeNo: payload.chequeNo?.trim() || null,
    payee: payload.payee.trim(),
    gross: payload.gross,
    vatVariant: payload.vatVariant,
    deductions: payload.deductions,
    netPayable: payload.netPayable,
    deductionsApplied: payload.deductionsApplied,
    status: mode,
    submittedAt: mode === 'submitted' ? serverTimestamp() : null,
    rejectReason: null,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  };

  if (existingId) {
    batch.update(targetRef, commonFields);
    writeAuditLogInBatch(batch, {
      collection: 'spendings',
      docId: existingId,
      action: mode === 'submitted' ? 'submit' : 'update',
      before: null,
      after: { id: existingId, ...commonFields },
      actor,
    });
  } else {
    const createFields = {
      ...commonFields,
      approvedBy: null,
      approvedAt: null,
      voidedBy: null,
      voidedAt: null,
      voidReason: null,
      deleted: false,
      createdAt: serverTimestamp(),
      createdBy: actor.uid,
      createdByName: actor.name,
    };
    batch.set(targetRef, createFields);
    writeAuditLogInBatch(batch, {
      collection: 'spendings',
      docId: targetRef.id,
      action: mode === 'submitted' ? 'submit' : 'create',
      before: null,
      after: { id: targetRef.id, ...createFields },
      actor,
    });
  }

  await batch.commit();
  return targetRef.id;
}

export async function submitExistingSpending(
  spending: SpendingDoc,
  actor: AuditActor
): Promise<void> {
  const batch = writeBatch(db);
  const ref = doc(db, 'spendings', spending.id);
  batch.update(ref, {
    status: 'submitted',
    submittedAt: serverTimestamp(),
    rejectReason: null,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });
  writeAuditLogInBatch(batch, {
    collection: 'spendings',
    docId: spending.id,
    action: 'submit',
    before: spending as unknown as Record<string, unknown>,
    after: { ...spending, status: 'submitted' } as unknown as Record<string, unknown>,
    actor,
  });
  await batch.commit();
}

export async function deleteDraftSpending(
  spending: SpendingDoc,
  actor: AuditActor
): Promise<void> {
  const batch = writeBatch(db);
  const ref = doc(db, 'spendings', spending.id);
  batch.update(ref, {
    deleted: true,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });
  writeAuditLogInBatch(batch, {
    collection: 'spendings',
    docId: spending.id,
    action: 'delete',
    before: spending as unknown as Record<string, unknown>,
    after: { ...spending, deleted: true } as unknown as Record<string, unknown>,
    actor,
  });
  await batch.commit();
}

export async function approveSpendingTx(
  spendingId: string,
  chequeNoInput: string,
  actor: AuditActor
): Promise<void> {
  const chequeNo = chequeNoInput.trim();
  if (!chequeNo) {
    throw new Error('Cheque number is required to approve a spending entry.');
  }

  const spendingRef = doc(db, 'spendings', spendingId);

  // Pre-fetch spending to know FY and economic code for candidate limits
  const preLimitSnap = await getDocs(
    query(collection(db, 'spendingLimits'), where('status', '==', 'active'))
  );
  const candidateLimitRefs = preLimitSnap.docs.map((d) => d.ref);

  await runTransaction(db, async (tx) => {
    const spSnap = await tx.get(spendingRef);
    if (!spSnap.exists() || spSnap.data().deleted) {
      throw new Error('Spending entry not found.');
    }
    const before = spSnap.data() as Omit<SpendingDoc, 'id'>;
    if (before.status !== 'submitted') {
      throw new Error('Only submitted entries can be approved.');
    }

    const budgetRef = doc(db, 'budgets', before.budgetId);
    const fyTotalRef = doc(db, 'fyCodeTotals', `${before.fiscalYear}_${before.economicCode}`);

    const [budgetSnap, fyTotalSnap, ...limitSnaps] = await Promise.all([
      tx.get(budgetRef),
      tx.get(fyTotalRef),
      ...candidateLimitRefs.map((r) => tx.get(r)),
    ]);

    if (!budgetSnap.exists() || budgetSnap.data().deleted) {
      throw new Error('Linked budget entry not found.');
    }
    const budgetData = budgetSnap.data() as Omit<BudgetDoc, 'id'>;
    if (budgetData.status !== 'active') {
      throw new Error('Cannot approve spending on an Executed budget.');
    }

    const fyCodeTotalData: FyCodeTotalDoc = fyTotalSnap.exists()
      ? ({ id: fyTotalSnap.id, ...fyTotalSnap.data() } as FyCodeTotalDoc)
      : {
          id: fyTotalRef.id,
          fiscalYear: before.fiscalYear,
          economicCode: before.economicCode,
          allocated: budgetData.allocated,
          spent: budgetData.spent,
        };

    const freshLimits: SpendingLimitDoc[] = limitSnaps
      .filter((s) => s.exists())
      .map((s) => ({ id: s.id, ...s.data() } as SpendingLimitDoc));

    const capResult = computeAvailable({
      budget: { id: budgetSnap.id, ...budgetData },
      fyCodeTotal: fyCodeTotalData,
      spendingLimits: freshLimits,
      date: before.date,
      gross: before.gross,
    });

    if (!capResult.allowed) {
      throw new Error(capResult.limitingConstraint.exceededMessage);
    }

    const newBudgetSpent = budgetData.spent + before.gross;
    const newBudgetRemaining = budgetData.allocated - newBudgetSpent;
    const newFySpent = (fyCodeTotalData.spent || 0) + before.gross;

    tx.update(budgetRef, {
      spent: newBudgetSpent,
      remaining: newBudgetRemaining,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });

    tx.set(
      fyTotalRef,
      {
        fiscalYear: before.fiscalYear,
        economicCode: before.economicCode,
        allocated: fyCodeTotalData.allocated,
        spent: newFySpent,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      },
      { merge: true }
    );

    const afterFields = {
      status: 'approved',
      chequeNo,
      approvedBy: actor.uid,
      approvedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.update(spendingRef, afterFields);

    writeAuditLogInTx(tx, {
      collection: 'spendings',
      docId: spendingId,
      action: 'approve',
      before: { id: spendingId, ...before },
      after: { id: spendingId, ...before, ...afterFields },
      actor,
    });
  });
}

export async function rejectSpendingTx(
  spendingId: string,
  reasonInput: string,
  actor: AuditActor
): Promise<void> {
  const reason = reasonInput.trim();
  if (!reason) throw new Error('Rejection reason is required.');
  const spendingRef = doc(db, 'spendings', spendingId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(spendingRef);
    if (!snap.exists() || snap.data().deleted) {
      throw new Error('Spending entry not found.');
    }
    const before = snap.data() as Omit<SpendingDoc, 'id'>;
    if (before.status !== 'submitted') {
      throw new Error('Only submitted entries can be rejected.');
    }

    tx.update(spendingRef, {
      status: 'rejected',
      rejectReason: reason,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });

    writeAuditLogInTx(tx, {
      collection: 'spendings',
      docId: spendingId,
      action: 'reject',
      before: { id: spendingId, ...before },
      after: { id: spendingId, ...before, status: 'rejected', rejectReason: reason },
      actor,
    });
  });
}

export async function voidSpendingTx(
  spendingId: string,
  reasonInput: string,
  actor: AuditActor
): Promise<void> {
  const reason = reasonInput.trim();
  if (!reason) throw new Error('Void reason is required.');
  const spendingRef = doc(db, 'spendings', spendingId);

  await runTransaction(db, async (tx) => {
    const spSnap = await tx.get(spendingRef);
    if (!spSnap.exists() || spSnap.data().deleted) {
      throw new Error('Spending entry not found.');
    }
    const before = spSnap.data() as Omit<SpendingDoc, 'id'>;
    if (before.status !== 'approved') {
      throw new Error('Only approved entries can be voided.');
    }

    const budgetRef = doc(db, 'budgets', before.budgetId);
    const fyTotalRef = doc(db, 'fyCodeTotals', `${before.fiscalYear}_${before.economicCode}`);

    const [budgetSnap, fyTotalSnap] = await Promise.all([
      tx.get(budgetRef),
      tx.get(fyTotalRef),
    ]);

    if (budgetSnap.exists()) {
      const bData = budgetSnap.data() as Omit<BudgetDoc, 'id'>;
      const newSpent = Math.max(0, bData.spent - before.gross);
      const newRemaining = bData.allocated - newSpent;
      tx.update(budgetRef, {
        spent: newSpent,
        remaining: newRemaining,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    }

    if (fyTotalSnap.exists()) {
      const fData = fyTotalSnap.data() as Omit<FyCodeTotalDoc, 'id'>;
      tx.update(fyTotalRef, {
        spent: Math.max(0, (fData.spent || 0) - before.gross),
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    }

    const afterFields = {
      status: 'voided',
      voidedBy: actor.uid,
      voidedAt: serverTimestamp(),
      voidReason: reason,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };
    tx.update(spendingRef, afterFields);

    writeAuditLogInTx(tx, {
      collection: 'spendings',
      docId: spendingId,
      action: 'void',
      before: { id: spendingId, ...before },
      after: { id: spendingId, ...before, ...afterFields },
      actor,
    });
  });
}

export async function editApprovedSpendingTx(
  spendingId: string,
  payload: SpendingFormPayload,
  actor: AuditActor
): Promise<void> {
  if (!payload.chequeNo?.trim()) throw new Error('Cheque number is required.');
  if (!payload.billNo.trim()) throw new Error('Bill number is required.');
  if (!payload.payee.trim()) throw new Error('Payee is required.');
  if (payload.gross <= 0) throw new Error('Gross bill must be greater than zero.');
  if (payload.netPayable < 0) throw new Error('Net payable cannot be negative.');
  if (!isDateInFiscalYear(payload.date, payload.fiscalYear)) {
    throw new Error(`Date must fall inside FY ${payload.fiscalYear}.`);
  }

  const spendingRef = doc(db, 'spendings', spendingId);
  const preLimitSnap = await getDocs(
    query(collection(db, 'spendingLimits'), where('status', '==', 'active'))
  );
  const candidateLimitRefs = preLimitSnap.docs.map((d) => d.ref);

  await runTransaction(db, async (tx) => {
    const spSnap = await tx.get(spendingRef);
    if (!spSnap.exists() || spSnap.data().deleted) {
      throw new Error('Spending entry not found.');
    }
    const before = spSnap.data() as Omit<SpendingDoc, 'id'>;
    if (before.status !== 'approved') {
      throw new Error('Entry is not in approved state.');
    }

    const oldBudgetRef = doc(db, 'budgets', before.budgetId);
    const newBudgetRef = doc(db, 'budgets', payload.budgetId);
    const oldFyRef = doc(db, 'fyCodeTotals', `${before.fiscalYear}_${before.economicCode}`);
    const newFyRef = doc(db, 'fyCodeTotals', `${payload.fiscalYear}_${payload.economicCode}`);

    const sameBudget = oldBudgetRef.id === newBudgetRef.id;
    const sameFyCode = oldFyRef.id === newFyRef.id;

    const [oldBudgetSnap, newBudgetSnap, oldFySnap, newFySnap, ...limitSnaps] =
      await Promise.all([
        tx.get(oldBudgetRef),
        sameBudget ? Promise.resolve(null) : tx.get(newBudgetRef),
        tx.get(oldFyRef),
        sameFyCode ? Promise.resolve(null) : tx.get(newFyRef),
        ...candidateLimitRefs.map((r) => tx.get(r)),
      ]);

    const effectiveNewBudgetSnap = sameBudget ? oldBudgetSnap : newBudgetSnap!;
    if (!effectiveNewBudgetSnap.exists() || effectiveNewBudgetSnap.data().deleted) {
      throw new Error('Target budget not found.');
    }
    const oldBudgetData = oldBudgetSnap.exists() ? (oldBudgetSnap.data() as Omit<BudgetDoc, 'id'>) : null;
    const newBudgetData = effectiveNewBudgetSnap.data() as Omit<BudgetDoc, 'id'>;

    const effectiveNewFySnap = sameFyCode ? oldFySnap : newFySnap!;
    const oldFySpent = oldFySnap.exists() ? (oldFySnap.data().spent as number) || 0 : 0;
    const newFyAlloc = effectiveNewFySnap.exists()
      ? (effectiveNewFySnap.data().allocated as number) || 0
      : newBudgetData.allocated;
    const newFySpentBase = effectiveNewFySnap.exists()
      ? (effectiveNewFySnap.data().spent as number) || 0
      : 0;

    // Reverse old spending impact first in memory for cap check
    const targetBudgetSpentAfterReverse = sameBudget
      ? Math.max(0, newBudgetData.spent - before.gross)
      : newBudgetData.spent;
    const targetFySpentAfterReverse = sameFyCode
      ? Math.max(0, newFySpentBase - before.gross)
      : newFySpentBase;

    const freshLimits: SpendingLimitDoc[] = limitSnaps
      .filter((s) => s.exists())
      .map((s) => ({ id: s.id, ...s.data() } as SpendingLimitDoc));

    const capResult = computeAvailable({
      budget: {
        id: effectiveNewBudgetSnap.id,
        fiscalYear: newBudgetData.fiscalYear,
        economicCode: newBudgetData.economicCode,
        memoNo: newBudgetData.memoNo,
        allocated: newBudgetData.allocated,
        spent: targetBudgetSpentAfterReverse,
        status: newBudgetData.status,
      },
      fyCodeTotal: {
        allocated: newFyAlloc,
        spent: targetFySpentAfterReverse,
      },
      spendingLimits: freshLimits,
      date: payload.date,
      gross: payload.gross,
    });

    if (!capResult.allowed) {
      throw new Error(capResult.limitingConstraint.exceededMessage);
    }

    // Apply Firestore writes
    if (sameBudget) {
      const updatedSpent = targetBudgetSpentAfterReverse + payload.gross;
      tx.update(newBudgetRef, {
        spent: updatedSpent,
        remaining: newBudgetData.allocated - updatedSpent,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    } else {
      if (oldBudgetData) {
        const oldUpdatedSpent = Math.max(0, oldBudgetData.spent - before.gross);
        tx.update(oldBudgetRef, {
          spent: oldUpdatedSpent,
          remaining: oldBudgetData.allocated - oldUpdatedSpent,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        });
      }
      const newUpdatedSpent = newBudgetData.spent + payload.gross;
      tx.update(newBudgetRef, {
        spent: newUpdatedSpent,
        remaining: newBudgetData.allocated - newUpdatedSpent,
        updatedAt: serverTimestamp(),
        updatedBy: actor.uid,
      });
    }

    if (sameFyCode) {
      tx.set(
        newFyRef,
        {
          fiscalYear: payload.fiscalYear,
          economicCode: payload.economicCode,
          allocated: newFyAlloc,
          spent: targetFySpentAfterReverse + payload.gross,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        },
        { merge: true }
      );
    } else {
      if (oldFySnap.exists()) {
        tx.update(oldFyRef, {
          spent: Math.max(0, oldFySpent - before.gross),
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        });
      }
      tx.set(
        newFyRef,
        {
          fiscalYear: payload.fiscalYear,
          economicCode: payload.economicCode,
          allocated: newFyAlloc,
          spent: newFySpentBase + payload.gross,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        },
        { merge: true }
      );
    }

    const afterFields = {
      budgetId: payload.budgetId,
      fiscalYear: payload.fiscalYear,
      economicCode: payload.economicCode,
      headName: payload.headName,
      headNameBn: payload.headNameBn || '',
      date: payload.date,
      billNo: payload.billNo.trim(),
      chequeNo: payload.chequeNo?.trim() || null,
      payee: payload.payee.trim(),
      gross: payload.gross,
      vatVariant: payload.vatVariant,
      deductions: payload.deductions,
      netPayable: payload.netPayable,
      deductionsApplied: payload.deductionsApplied,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    };

    tx.update(spendingRef, afterFields);
    writeAuditLogInTx(tx, {
      collection: 'spendings',
      docId: spendingId,
      action: 'update',
      before: { id: spendingId, ...before },
      after: { id: spendingId, ...before, ...afterFields },
      actor,
    });
  });
}

export async function softDeleteApprovedSpendingTx(
  spendingId: string,
  actor: AuditActor
): Promise<void> {
  const spendingRef = doc(db, 'spendings', spendingId);

  await runTransaction(db, async (tx) => {
    const spSnap = await tx.get(spendingRef);
    if (!spSnap.exists() || spSnap.data().deleted) {
      throw new Error('Spending entry not found.');
    }
    const before = spSnap.data() as Omit<SpendingDoc, 'id'>;

    if (before.status === 'approved') {
      const budgetRef = doc(db, 'budgets', before.budgetId);
      const fyRef = doc(db, 'fyCodeTotals', `${before.fiscalYear}_${before.economicCode}`);
      const [budgetSnap, fySnap] = await Promise.all([tx.get(budgetRef), tx.get(fyRef)]);

      if (budgetSnap.exists()) {
        const b = budgetSnap.data() as Omit<BudgetDoc, 'id'>;
        const newSpent = Math.max(0, b.spent - before.gross);
        tx.update(budgetRef, {
          spent: newSpent,
          remaining: b.allocated - newSpent,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        });
      }
      if (fySnap.exists()) {
        const f = fySnap.data() as Omit<FyCodeTotalDoc, 'id'>;
        tx.update(fyRef, {
          spent: Math.max(0, (f.spent || 0) - before.gross),
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        });
      }
    }

    tx.update(spendingRef, {
      deleted: true,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });

    writeAuditLogInTx(tx, {
      collection: 'spendings',
      docId: spendingId,
      action: 'delete',
      before: { id: spendingId, ...before },
      after: { id: spendingId, ...before, deleted: true },
      actor,
    });
  });
}

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
  limit: SpendingLimitDoc,
  actor: AuditActor
): Promise<void> {
  const batch = writeBatch(db);
  const ref = doc(db, 'spendingLimits', limit.id);
  batch.update(ref, {
    status: 'withdrawn',
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  });
  writeAuditLogInBatch(batch, {
    collection: 'spendingLimits',
    docId: limit.id,
    action: 'update',
    before: limit as unknown as Record<string, unknown>,
    after: { ...limit, status: 'withdrawn' } as unknown as Record<string, unknown>,
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
  const before = exists ? ({ id: existingSnap.id, ...existingSnap.data() } as Record<string, unknown>) : null;

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
  const [budgetsSnap, ratesSnap, limitsSnap] = await Promise.all([
    getDocs(query(collection(db, 'budgets'), where('economicCode', '==', entry.code))),
    getDocs(query(collection(db, 'vatTaxRates'), where('economicCode', '==', entry.code), limit(1))),
    getDocs(query(collection(db, 'spendingLimits'), where('economicCode', '==', entry.code), limit(1))),
  ]);

  const activeBudgetCount = budgetsSnap.docs.filter((d) => !d.data().deleted).length;
  if (activeBudgetCount > 0 || !ratesSnap.empty || !limitsSnap.empty) {
    throw new Error(
      'This economic code is referenced by existing budgets, VAT/IT rates, or spending limits and cannot be deleted. Deactivate it instead.'
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

  // Seed GENERAL-CONSTRUCTION special entry
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

  // Firestore writeBatch limit is 500 ops (2 ops per code: set + auditLog -> chunk by 200)
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
