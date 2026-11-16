import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import type {
  BudgetDoc,
  FyCodeTotalDoc,
  SpendingDoc,
  SpendingLimitDoc,
  VatTaxRateDoc,
} from '../types';

export interface FyDataState {
  budgets: BudgetDoc[];
  spendings: SpendingDoc[];
  vatTaxRates: VatTaxRateDoc[];
  spendingLimits: SpendingLimitDoc[];
  fyCodeTotals: FyCodeTotalDoc[];
  loading: boolean;
}

export function useFyData(fiscalYear: string): FyDataState {
  const { accessState } = useAuth();
  const [budgets, setBudgets] = useState<BudgetDoc[]>([]);
  const [spendings, setSpendings] = useState<SpendingDoc[]>([]);
  const [vatTaxRates, setVatTaxRates] = useState<VatTaxRateDoc[]>([]);
  const [spendingLimits, setSpendingLimits] = useState<SpendingLimitDoc[]>([]);
  const [fyCodeTotals, setFyCodeTotals] = useState<FyCodeTotalDoc[]>([]);
  const [loadedFlags, setLoadedFlags] = useState({
    budgets: false,
    spendings: false,
    rates: false,
    limits: false,
    totals: false,
  });

  useEffect(() => {
    if (accessState !== 'active' || !fiscalYear) return;

    setLoadedFlags({
      budgets: false,
      spendings: false,
      rates: false,
      limits: false,
      totals: false,
    });

    const unsubBudgets = onSnapshot(
      query(collection(db, 'budgets'), where('fiscalYear', '==', fiscalYear)),
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as BudgetDoc))
          .filter((b) => !b.deleted)
          .sort((a, b) => b.memoDate.localeCompare(a.memoDate));
        setBudgets(rows);
        setLoadedFlags((prev) => ({ ...prev, budgets: true }));
      }
    );

    const unsubSpendings = onSnapshot(
      query(collection(db, 'spendings'), where('fiscalYear', '==', fiscalYear)),
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as SpendingDoc))
          .filter((s) => !s.deleted)
          .sort((a, b) => b.date.localeCompare(a.date));
        setSpendings(rows);
        setLoadedFlags((prev) => ({ ...prev, spendings: true }));
      }
    );

    const unsubRates = onSnapshot(
      query(collection(db, 'vatTaxRates'), where('fiscalYear', '==', fiscalYear)),
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as VatTaxRateDoc))
          .sort((a, b) => a.economicCode.localeCompare(b.economicCode));
        setVatTaxRates(rows);
        setLoadedFlags((prev) => ({ ...prev, rates: true }));
      }
    );

    const unsubLimits = onSnapshot(
      query(collection(db, 'spendingLimits'), where('fiscalYear', '==', fiscalYear)),
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as SpendingLimitDoc))
          .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
        setSpendingLimits(rows);
        setLoadedFlags((prev) => ({ ...prev, limits: true }));
      }
    );

    const unsubTotals = onSnapshot(
      query(collection(db, 'fyCodeTotals'), where('fiscalYear', '==', fiscalYear)),
      (snap) => {
        const rows = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as FyCodeTotalDoc)
        );
        setFyCodeTotals(rows);
        setLoadedFlags((prev) => ({ ...prev, totals: true }));
      }
    );

    return () => {
      unsubBudgets();
      unsubSpendings();
      unsubRates();
      unsubLimits();
      unsubTotals();
    };
  }, [accessState, fiscalYear]);

  const loading = !(
    loadedFlags.budgets &&
    loadedFlags.spendings &&
    loadedFlags.rates &&
    loadedFlags.limits &&
    loadedFlags.totals
  );

  return {
    budgets,
    spendings,
    vatTaxRates,
    spendingLimits,
    fyCodeTotals,
    loading,
  };
}
