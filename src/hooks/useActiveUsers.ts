import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { isPermissionDeniedError, logFirestoreError, OperationType } from '../lib/firestoreError';
import type { UserDoc } from '../types';

export function useActiveUsers(): { users: UserDoc[]; loading: boolean } {
  const { accessState } = useAuth();
  const { reportPermissionError, clearPermissionError } = useApp();
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (accessState !== 'active') return;
    const unsub = onSnapshot(
      collection(db, 'users'),
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
  }, [accessState, clearPermissionError, reportPermissionError]);

  return { users, loading };
}
