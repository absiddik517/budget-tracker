import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { ALL_OFFICES_ID, LEGACY_UNMIGRATED_OFFICE_ID, useApp } from '../contexts/AppContext';
import { isPermissionDeniedError, logFirestoreError, OperationType } from '../lib/firestoreError';
import type { UserDoc } from '../types';

export function useActiveUsers(overrideOfficeId?: string | null): {
  users: UserDoc[];
  loading: boolean;
} {
  const { accessState, isSuperAdmin } = useAuth();
  const { currentOfficeId, reportPermissionError, clearPermissionError } = useApp();
  const targetOfficeId = overrideOfficeId !== undefined ? overrideOfficeId : currentOfficeId;

  const [users, setUsers] = useState<UserDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (accessState !== 'active') return;

    if (!isSuperAdmin && (!targetOfficeId || targetOfficeId === ALL_OFFICES_ID)) {
      setUsers([]);
      setLoading(false);
      return;
    }

    const useScopedQuery =
      targetOfficeId &&
      targetOfficeId !== ALL_OFFICES_ID &&
      targetOfficeId !== LEGACY_UNMIGRATED_OFFICE_ID;

    const q = useScopedQuery
      ? query(collection(db, 'users'), where('officeIds', 'array-contains', targetOfficeId))
      : isSuperAdmin || targetOfficeId === LEGACY_UNMIGRATED_OFFICE_ID
        ? collection(db, 'users')
        : null;

    if (!q) {
      setUsers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = onSnapshot(
      q,
      (snap) => {
        clearPermissionError('users');
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as UserDoc))
          .filter((u) => u.status === 'active')
          .sort((a, b) => a.name.localeCompare(b.name));
        setUsers(list);
        setLoading(false);
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'users');
        if (isPermissionDeniedError(err)) {
          reportPermissionError('users');
        }
        setLoading(false);
      }
    );
    return () => unsub();
  }, [accessState, isSuperAdmin, targetOfficeId, clearPermissionError, reportPermissionError]);

  return { users, loading };
}
