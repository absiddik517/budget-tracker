import { useEffect, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { ALL_OFFICES_ID, LEGACY_UNMIGRATED_OFFICE_ID, useApp } from '../contexts/AppContext';
import { isPermissionDeniedError, logFirestoreError, OperationType } from '../lib/firestoreError';
import type { UserDoc, WorkHistoryDoc } from '../types';

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

    const useScopedQuery =
      Boolean(targetOfficeId) &&
      targetOfficeId !== ALL_OFFICES_ID &&
      targetOfficeId !== LEGACY_UNMIGRATED_OFFICE_ID;

    if (!isSuperAdmin && !useScopedQuery) {
      clearPermissionError('users');
      setUsers([]);
      setLoading(false);
      return;
    }

    // Super Admin can list users directly (either scoped to an office or across all offices)
    if (isSuperAdmin) {
      const q = useScopedQuery
        ? query(collection(db, 'users'), where('officeIds', 'array-contains', targetOfficeId))
        : collection(db, 'users');

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
    }

    // For office DDO/Employee: resolve active members from this office's workHistory
    // and fetch each user doc via getDoc (allow get), avoiding Firestore list-query restrictions
    // on array-contains vs userData().officeIds.hasAny().
    let cancelled = false;
    setLoading(true);
    const whQuery = query(
      collection(db, 'workHistory'),
      where('officeId', '==', targetOfficeId as string)
    );

    const unsub = onSnapshot(
      whQuery,
      async (snap) => {
        if (cancelled) return;
        const activePostings = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as WorkHistoryDoc))
          .filter((wh) => wh.status === 'active');

        const postingByUserId = new Map<string, WorkHistoryDoc>();
        for (const wh of activePostings) {
          if (wh.userId && !postingByUserId.has(wh.userId)) {
            postingByUserId.set(wh.userId, wh);
          }
        }

        const uniqueUserIds = Array.from(postingByUserId.keys());
        if (uniqueUserIds.length === 0) {
          clearPermissionError('users');
          if (!cancelled) {
            setUsers([]);
            setLoading(false);
          }
          return;
        }

        try {
          const results = await Promise.all(
            uniqueUserIds.map(async (uid) => {
              const fallbackWh = postingByUserId.get(uid)!;
              try {
                const uSnap = await getDoc(doc(db, 'users', uid));
                if (uSnap.exists()) {
                  return { id: uSnap.id, ...uSnap.data() } as UserDoc;
                }
              } catch (err) {
                logFirestoreError(err, OperationType.GET, `users/${uid}`);
              }
              return {
                id: uid,
                name: fallbackWh.userName || 'User',
                designation: fallbackWh.designation || '',
                email: '',
                status: 'active',
                globalRole: null,
                homeOfficeId: targetOfficeId as string,
                access: { [targetOfficeId as string]: fallbackWh.role },
                officeIds: [targetOfficeId as string],
              } as UserDoc;
            })
          );

          if (!cancelled) {
            clearPermissionError('users');
            setUsers(
              results
                .filter((u) => u.status === 'active')
                .sort((a, b) => a.name.localeCompare(b.name))
            );
            setLoading(false);
          }
        } catch (err) {
          logFirestoreError(err, OperationType.GET, 'users');
          if (!cancelled) {
            setLoading(false);
          }
        }
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'workHistory');
        if (isPermissionDeniedError(err)) {
          reportPermissionError('workHistory');
        }
        if (!cancelled) {
          setLoading(false);
        }
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [accessState, isSuperAdmin, targetOfficeId, clearPermissionError, reportPermissionError]);

  return { users, loading };
}
