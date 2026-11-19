import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { isPermissionDeniedError, logFirestoreError, OperationType } from '../lib/firestoreError';
import { useApp } from '../contexts/AppContext';
import type { WorkHistoryDoc } from '../types';

function sortHistoryDesc(rows: WorkHistoryDoc[]): WorkHistoryDoc[] {
  return rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    const dateCmp = (b.startDate || '').localeCompare(a.startDate || '');
    if (dateCmp !== 0) return dateCmp;
    return (b.orderDate || '').localeCompare(a.orderDate || '');
  });
}

export function useMyWorkHistory() {
  const { accessState, userDoc } = useAuth();
  const [records, setRecords] = useState<WorkHistoryDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (accessState !== 'active' || !userDoc) {
      setRecords([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(collection(db, 'workHistory'), where('userId', '==', userDoc.id));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRecords(sortHistoryDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkHistoryDoc))));
        setLoading(false);
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'workHistory');
        setLoading(false);
      }
    );

    return () => unsub();
  }, [accessState, userDoc]);

  return { records, loading };
}

export function useOfficeWorkHistory(officeId: string | null | undefined) {
  const { accessState } = useAuth();
  const { reportPermissionError, clearPermissionError } = useApp();
  const [records, setRecords] = useState<WorkHistoryDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (accessState !== 'active' || !officeId || officeId === 'ALL' || officeId === '__LEGACY__') {
      setRecords([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(collection(db, 'workHistory'), where('officeId', '==', officeId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        clearPermissionError('workHistory');
        setRecords(sortHistoryDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkHistoryDoc))));
        setLoading(false);
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'workHistory');
        if (isPermissionDeniedError(err)) reportPermissionError('workHistory');
        setLoading(false);
      }
    );

    return () => unsub();
  }, [accessState, officeId, clearPermissionError, reportPermissionError]);

  return { records, loading };
}

export function useAllWorkHistory(enabled: boolean) {
  const { accessState, isSuperAdmin } = useAuth();
  const [records, setRecords] = useState<WorkHistoryDoc[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (accessState !== 'active' || !isSuperAdmin || !enabled) {
      setRecords([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = onSnapshot(
      collection(db, 'workHistory'),
      (snap) => {
        setRecords(sortHistoryDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkHistoryDoc))));
        setLoading(false);
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'workHistory');
        setLoading(false);
      }
    );

    return () => unsub();
  }, [accessState, isSuperAdmin, enabled]);

  return { records, loading };
}
