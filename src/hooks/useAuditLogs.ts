import { useEffect, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { logFirestoreError, OperationType } from '../lib/firestoreError';
import type { AuditLogDoc } from '../types';

function getTimestampMs(ts: unknown): number {
  if (!ts) return Number.MAX_SAFE_INTEGER;
  if (typeof ts === 'object' && ts !== null) {
    if ('toMillis' in ts && typeof (ts as { toMillis: unknown }).toMillis === 'function') {
      return (ts as { toMillis: () => number }).toMillis();
    }
    if ('seconds' in ts && typeof (ts as { seconds: unknown }).seconds === 'number') {
      return (ts as { seconds: number }).seconds * 1000;
    }
  }
  return 0;
}

export function useDocAuditLogs(collectionName: string, docId: string | null) {
  const [logs, setLogs] = useState<AuditLogDoc[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!docId) {
      setLogs([]);
      return;
    }
    setLoading(true);
    // Single-field equality query requires no composite index; filter collection & sort client-side.
    const q = query(collection(db, 'auditLogs'), where('docId', '==', docId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as AuditLogDoc))
          .filter((item) => item.collection === collectionName)
          .sort((a, b) => getTimestampMs(b.timestamp) - getTimestampMs(a.timestamp))
          .slice(0, 50);
        setLogs(list);
        setLoading(false);
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, `auditLogs/${collectionName}/${docId}`);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [collectionName, docId]);

  return { logs, loading };
}

export function useGlobalAuditLogs(enabled: boolean, maxCount = 100) {
  const [logs, setLogs] = useState<AuditLogDoc[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    const q = query(
      collection(db, 'auditLogs'),
      orderBy('timestamp', 'desc'),
      limit(maxCount)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuditLogDoc)));
        setLoading(false);
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'auditLogs');
        setLoading(false);
      }
    );
    return () => unsub();
  }, [enabled, maxCount]);

  return { logs, loading };
}
