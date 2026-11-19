import { collection, doc, serverTimestamp, type Transaction, type WriteBatch } from 'firebase/firestore';
import { db } from './firebase';
import type { ActorSnapshot, AuditAction } from '../types';

export interface AuditActor {
  uid: string;
  name: string;
  designation?: string;
  officeId?: string | null;
  role?: ActorSnapshot['role'];
  kind?: ActorSnapshot['kind'];
  workHistoryId?: string | null;
}

export interface AuditEntryInput {
  officeId?: string | null;
  collection: string;
  docId: string;
  action: AuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: AuditActor | ActorSnapshot;
}

export function sanitizeForAudit(
  obj: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!obj) return null;
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (
      v &&
      typeof v === 'object' &&
      'toDate' in v &&
      typeof (v as { toDate: () => Date }).toDate === 'function'
    ) {
      copy[k] = (v as { toDate: () => Date }).toDate().toISOString();
    } else {
      copy[k] = v;
    }
  }
  return copy;
}

function buildAuditPayload(entry: AuditEntryInput) {
  const actorSnap: ActorSnapshot | null =
    'role' in entry.actor && entry.actor.role
      ? {
          uid: entry.actor.uid,
          name: entry.actor.name,
          designation: entry.actor.designation || '',
          officeId: entry.actor.officeId ?? null,
          role: entry.actor.role,
          kind: entry.actor.kind ?? null,
          workHistoryId: entry.actor.workHistoryId ?? null,
        }
      : null;

  return {
    officeId: entry.officeId ?? actorSnap?.officeId ?? null,
    collection: entry.collection,
    docId: entry.docId,
    action: entry.action,
    before: sanitizeForAudit(entry.before),
    after: sanitizeForAudit(entry.after),
    userId: entry.actor.uid,
    userName: entry.actor.name,
    actor: actorSnap,
    timestamp: serverTimestamp(),
  };
}

export function writeAuditLogInTx(tx: Transaction, entry: AuditEntryInput): void {
  const ref = doc(collection(db, 'auditLogs'));
  tx.set(ref, buildAuditPayload(entry));
}

export function writeAuditLogInBatch(batch: WriteBatch, entry: AuditEntryInput): void {
  const ref = doc(collection(db, 'auditLogs'));
  batch.set(ref, buildAuditPayload(entry));
}
