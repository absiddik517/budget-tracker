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
import type { AuditLogDoc } from '../types';

export function useDocAuditLogs(collectionName: string, docId: string | null) {
  const [logs, setLogs] = useState<AuditLogDoc[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!docId) {
      setLogs([]);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, 'auditLogs'),
      where('collection', '==', collectionName),
      where('docId', '==', docId),
      orderBy('timestamp', 'desc'),
      limit(50)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuditLogDoc)));
        setLoading(false);
      },
      () => {
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
      () => {
        setLoading(false);
      }
    );
    return () => unsub();
  }, [enabled, maxCount]);

  return { logs, loading };
}
