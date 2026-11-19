import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { ALL_OFFICES_ID, LEGACY_UNMIGRATED_OFFICE_ID, useApp } from '../contexts/AppContext';
import { isPermissionDeniedError, logFirestoreError, OperationType } from '../lib/firestoreError';
import type {
  BillDoc,
  BudgetDoc,
  ExpenseItemDoc,
  FyCodeTotalDoc,
  SpendingLimitDoc,
  VatTaxRateDoc,
} from '../types';

export interface FyDataState {
  budgets: BudgetDoc[];
  expenseItems: ExpenseItemDoc[];
  bills: BillDoc[];
  vatTaxRates: VatTaxRateDoc[];
  spendingLimits: SpendingLimitDoc[];
  fyCodeTotals: FyCodeTotalDoc[];
  loading: boolean;
}

export function useFyData(fiscalYear: string, overrideOfficeId?: string | null): FyDataState {
  const { accessState } = useAuth();
  const { currentOfficeId, reportPermissionError, clearPermissionError } = useApp();
  const targetOfficeId = overrideOfficeId !== undefined ? overrideOfficeId : currentOfficeId;

  const [budgets, setBudgets] = useState<BudgetDoc[]>([]);
  const [expenseItems, setExpenseItems] = useState<ExpenseItemDoc[]>([]);
  const [bills, setBills] = useState<BillDoc[]>([]);
  const [vatTaxRates, setVatTaxRates] = useState<VatTaxRateDoc[]>([]);
  const [spendingLimits, setSpendingLimits] = useState<SpendingLimitDoc[]>([]);
  const [fyCodeTotals, setFyCodeTotals] = useState<FyCodeTotalDoc[]>([]);
  const [loadedFlags, setLoadedFlags] = useState({
    budgets: false,
    expenseItems: false,
    bills: false,
    rates: false,
    limits: false,
    totals: false,
  });

  useEffect(() => {
    if (accessState !== 'active' || !fiscalYear) {
      return;
    }

    // Always keep global VAT/Tax rates listener active while signed in
    const unsubRates = onSnapshot(
      query(collection(db, 'vatTaxRates'), where('fiscalYear', '==', fiscalYear)),
      (snap) => {
        clearPermissionError('vatTaxRates');
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as VatTaxRateDoc))
          .sort((a, b) => a.economicCode.localeCompare(b.economicCode));
        setVatTaxRates(rows);
        setLoadedFlags((prev) => ({ ...prev, rates: true }));
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'vatTaxRates');
        if (isPermissionDeniedError(err)) reportPermissionError('vatTaxRates');
        setLoadedFlags((prev) => ({ ...prev, rates: true }));
      }
    );

    if (!targetOfficeId || targetOfficeId === ALL_OFFICES_ID) {
      setBudgets([]);
      setExpenseItems([]);
      setBills([]);
      setSpendingLimits([]);
      setFyCodeTotals([]);
      setLoadedFlags((prev) => ({
        ...prev,
        budgets: true,
        expenseItems: true,
        bills: true,
        limits: true,
        totals: true,
      }));
      return () => {
        unsubRates();
      };
    }

    setLoadedFlags((prev) => ({
      ...prev,
      budgets: false,
      expenseItems: false,
      bills: false,
      limits: false,
      totals: false,
    }));

    const isLegacy = targetOfficeId === LEGACY_UNMIGRATED_OFFICE_ID;
    const buildOfficeQuery = (colName: string) =>
      isLegacy
        ? query(collection(db, colName), where('fiscalYear', '==', fiscalYear))
        : query(
            collection(db, colName),
            where('officeId', '==', targetOfficeId),
            where('fiscalYear', '==', fiscalYear)
          );

    const handleSnapshotError =
      (collectionPath: string, flagKey: keyof typeof loadedFlags) => (err: unknown) => {
        logFirestoreError(err, OperationType.LIST, collectionPath);
        if (isPermissionDeniedError(err)) {
          reportPermissionError(collectionPath);
        }
        setLoadedFlags((prev) => ({ ...prev, [flagKey]: true }));
      };

    const unsubBudgets = onSnapshot(
      buildOfficeQuery('budgets'),
      (snap) => {
        clearPermissionError('budgets');
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as BudgetDoc))
          .filter((b) => !b.deleted)
          .sort((a, b) => b.memoDate.localeCompare(a.memoDate));
        setBudgets(rows);
        setLoadedFlags((prev) => ({ ...prev, budgets: true }));
      },
      handleSnapshotError('budgets', 'budgets')
    );

    const unsubItems = onSnapshot(
      buildOfficeQuery('expenseItems'),
      (snap) => {
        clearPermissionError('expenseItems');
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as ExpenseItemDoc))
          .filter((item) => !item.deleted)
          .sort((a, b) => b.date.localeCompare(a.date));
        setExpenseItems(rows);
        setLoadedFlags((prev) => ({ ...prev, expenseItems: true }));
      },
      handleSnapshotError('expenseItems', 'expenseItems')
    );

    const unsubBills = onSnapshot(
      buildOfficeQuery('bills'),
      (snap) => {
        clearPermissionError('bills');
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as BillDoc))
          .filter((b) => !b.deleted)
          .sort((a, b) => {
            const dateCmp = (b.date || '').localeCompare(a.date || '');
            if (dateCmp !== 0) return dateCmp;
            return (b.billNo || '').localeCompare(a.billNo || '');
          });
        setBills(rows);
        setLoadedFlags((prev) => ({ ...prev, bills: true }));
      },
      handleSnapshotError('bills', 'bills')
    );

    const unsubLimits = onSnapshot(
      buildOfficeQuery('spendingLimits'),
      (snap) => {
        clearPermissionError('spendingLimits');
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as SpendingLimitDoc))
          .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
        setSpendingLimits(rows);
        setLoadedFlags((prev) => ({ ...prev, limits: true }));
      },
      handleSnapshotError('spendingLimits', 'limits')
    );

    const unsubTotals = onSnapshot(
      buildOfficeQuery('fyCodeTotals'),
      (snap) => {
        clearPermissionError('fyCodeTotals');
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as FyCodeTotalDoc));
        setFyCodeTotals(rows);
        setLoadedFlags((prev) => ({ ...prev, totals: true }));
      },
      handleSnapshotError('fyCodeTotals', 'totals')
    );

    return () => {
      unsubRates();
      unsubBudgets();
      unsubItems();
      unsubBills();
      unsubLimits();
      unsubTotals();
    };
  }, [accessState, fiscalYear, targetOfficeId, clearPermissionError, reportPermissionError]);

  const loading = !(
    loadedFlags.budgets &&
    loadedFlags.expenseItems &&
    loadedFlags.bills &&
    loadedFlags.rates &&
    loadedFlags.limits &&
    loadedFlags.totals
  );

  return {
    budgets,
    expenseItems,
    bills,
    vatTaxRates,
    spendingLimits,
    fyCodeTotals,
    loading,
  };
}
