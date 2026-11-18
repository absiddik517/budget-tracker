import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
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

export function useFyData(fiscalYear: string): FyDataState {
  const { accessState } = useAuth();
  const { reportPermissionError, clearPermissionError } = useApp();
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
    if (accessState !== 'active' || !fiscalYear) return;

    setLoadedFlags({
      budgets: false,
      expenseItems: false,
      bills: false,
      rates: false,
      limits: false,
      totals: false,
    });

    const handleSnapshotError = (
      collectionPath: string,
      flagKey: keyof typeof loadedFlags
    ) => (err: unknown) => {
      logFirestoreError(err, OperationType.LIST, collectionPath);
      if (isPermissionDeniedError(err)) {
        reportPermissionError(collectionPath);
      }
      setLoadedFlags((prev) => ({ ...prev, [flagKey]: true }));
    };

    const unsubBudgets = onSnapshot(
      query(collection(db, 'budgets'), where('fiscalYear', '==', fiscalYear)),
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
      query(collection(db, 'expenseItems'), where('fiscalYear', '==', fiscalYear)),
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
      query(collection(db, 'bills'), where('fiscalYear', '==', fiscalYear)),
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
      handleSnapshotError('vatTaxRates', 'rates')
    );

    const unsubLimits = onSnapshot(
      query(collection(db, 'spendingLimits'), where('fiscalYear', '==', fiscalYear)),
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
      query(collection(db, 'fyCodeTotals'), where('fiscalYear', '==', fiscalYear)),
      (snap) => {
        clearPermissionError('fyCodeTotals');
        const rows = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as FyCodeTotalDoc)
        );
        setFyCodeTotals(rows);
        setLoadedFlags((prev) => ({ ...prev, totals: true }));
      },
      handleSnapshotError('fyCodeTotals', 'totals')
    );

    return () => {
      unsubBudgets();
      unsubItems();
      unsubBills();
      unsubRates();
      unsubLimits();
      unsubTotals();
    };
  }, [accessState, fiscalYear, clearPermissionError, reportPermissionError]);

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
