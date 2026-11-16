import { collection, doc, serverTimestamp, type Transaction, type WriteBatch } from 'firebase/firestore';
import { db } from './firebase';
import type { AuditAction } from '../types';

export interface AuditActor {
  uid: string;
  name: string;
}

export interface AuditEntryInput {
  collection: string;
  docId: string;
  action: AuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: AuditActor;
}

export function sanitizeForAudit(obj: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!obj) return null;
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function') {
      copy[k] = (v as { toDate: () => Date }).toDate().toISOString();
    } else {
      copy[k] = v;
    }
  }
  return copy;
}

export function writeAuditLogInTx(tx: Transaction, entry: AuditEntryInput): void {
  const ref = doc(collection(db, 'auditLogs'));
  tx.set(ref, {
    collection: entry.collection,
    docId: entry.docId,
    action: entry.action,
    before: sanitizeForAudit(entry.before),
    after: sanitizeForAudit(entry.after),
    userId: entry.actor.uid,
    userName: entry.actor.name,
    timestamp: serverTimestamp(),
  });
}

export function writeAuditLogInBatch(batch: WriteBatch, entry: AuditEntryInput): void {
  const ref = doc(collection(db, 'auditLogs'));
  batch.set(ref, {
    collection: entry.collection,
    docId: entry.docId,
    action: entry.action,
    before: sanitizeForAudit(entry.before),
    after: sanitizeForAudit(entry.after),
    userId: entry.actor.uid,
    userName: entry.actor.name,
    timestamp: serverTimestamp(),
  });
}
