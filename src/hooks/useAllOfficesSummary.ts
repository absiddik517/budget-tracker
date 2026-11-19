import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { isPermissionDeniedError, logFirestoreError, OperationType } from '../lib/firestoreError';
import { useApp } from '../contexts/AppContext';
import type { FyCodeTotalDoc } from '../types';

/**
 * Super Admin cross-office overview listener: reads aggregated `fyCodeTotals`
 * for the selected fiscal year without scanning individual budgets or bills.
 */
export function useAllOfficesSummary(fiscalYear: string, enabled: boolean) {
  const { accessState, isSuperAdmin } = useAuth();
  const { reportPermissionError, clearPermissionError } = useApp();
  const [totals, setTotals] = useState<FyCodeTotalDoc[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (accessState !== 'active' || !isSuperAdmin || !enabled || !fiscalYear) {
      setTotals([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(collection(db, 'fyCodeTotals'), where('fiscalYear', '==', fiscalYear));
    const unsub = onSnapshot(
      q,
      (snap) => {
        clearPermissionError('fyCodeTotals');
        setTotals(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FyCodeTotalDoc)));
        setLoading(false);
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'fyCodeTotals');
        if (isPermissionDeniedError(err)) reportPermissionError('fyCodeTotals');
        setLoading(false);
      }
    );

    return () => unsub();
  }, [accessState, isSuperAdmin, enabled, fiscalYear, clearPermissionError, reportPermissionError]);

  return { totals, loading };
}
