import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
  type DocumentReference,
} from 'firebase/firestore';
import { db } from './firebase';
import { writeAuditLogInBatch, type AuditActor } from './audit';
import { todayYmd } from './dates';
import { buildCounterId, buildFyCodeTotalId } from './firestoreOps';
import type {
  ActorRef,
  ActorSnapshot,
  OfficeDoc,
  OfficeRole,
  OfficeSettings,
  Role,
  UserDoc,
} from '../types';

export const DEFAULT_MIGRATED_OFFICE_ID = 'default_office';

const GLOBAL_COLLECTIONS = new Set([
  'economicCodes',
  'vatTaxRates',
  'users',
  'offices',
  'settings',
  'workHistory',
]);

export interface MultiOfficeMigrationPreview {
  alreadyHasOffices: number;
  willCreateDefaultOffice: boolean;
  defaultOfficeName: string;
  usersNeedingMigration: number;
  workHistoryToCreate: number;
  budgetsToTag: number;
  expenseItemsToTag: number;
  billsToTag: number;
  limitsToTag: number;
  spendingsToTag: number;
  auditLogsToTag: number;
  fyTotalsToRekey: number;
  countersToRekey: number;
  docsWithStringActorSnapshots: number;
}

export interface MultiOfficeMigrationResult {
  officeId: string;
  officeCreated: boolean;
  usersMigrated: number;
  workHistoryCreated: number;
  budgetsUpdated: number;
  expenseItemsUpdated: number;
  billsUpdated: number;
  limitsUpdated: number;
  spendingsUpdated: number;
  auditLogsUpdated: number;
  fyTotalsRekeyed: number;
  countersRekeyed: number;
}

function needsActorUpgrade(ref: ActorRef | null | undefined): boolean {
  return typeof ref === 'string' && ref.trim().length > 0;
}

export async function previewMultiOfficeMigration(): Promise<MultiOfficeMigrationPreview> {
  const [
    settingsSnap,
    officesSnap,
    usersSnap,
    whSnap,
    budgetsSnap,
    itemsSnap,
    billsSnap,
    limitsSnap,
    spendingsSnap,
    fyTotalsSnap,
    countersSnap,
    auditSnap,
  ] = await Promise.all([
    getDoc(doc(db, 'settings', 'office')),
    getDocs(collection(db, 'offices')),
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'workHistory')),
    getDocs(collection(db, 'budgets')),
    getDocs(collection(db, 'expenseItems')),
    getDocs(collection(db, 'bills')),
    getDocs(collection(db, 'spendingLimits')),
    getDocs(collection(db, 'spendings')),
    getDocs(collection(db, 'fyCodeTotals')),
    getDocs(collection(db, 'counters')),
    getDocs(collection(db, 'auditLogs')),
  ]);

  const legacySettings = settingsSnap.exists() ? (settingsSnap.data() as OfficeSettings) : null;
  const targetOfficeId = officesSnap.empty ? DEFAULT_MIGRATED_OFFICE_ID : officesSnap.docs[0].id;
  const existingWhIds = new Set(whSnap.docs.map((d) => d.id));

  let usersNeedingMigration = 0;
  let workHistoryToCreate = 0;

  for (const d of usersSnap.docs) {
    const u = d.data() as Partial<UserDoc> & { role?: Role };
    const needsUserPatch =
      u.role !== undefined ||
      u.globalRole === undefined ||
      u.access === undefined ||
      u.officeIds === undefined;
    if (needsUserPatch) usersNeedingMigration++;

    const resolvedRole = u.role || (u.globalRole === 'superAdmin' ? 'superAdmin' : undefined);
    if (resolvedRole === 'ddo' || resolvedRole === 'employee') {
      const detWhId = `mig_wh_${d.id}_${targetOfficeId}`;
      if (!existingWhIds.has(detWhId) && !u.access?.[targetOfficeId]) {
        workHistoryToCreate++;
      }
    }
  }

  let docsWithStringActorSnapshots = 0;

  const countTagAndSnap = (docs: typeof budgetsSnap.docs) => {
    let tagCount = 0;
    for (const d of docs) {
      const data = d.data();
      if (!data.officeId) tagCount++;
      if (
        needsActorUpgrade(data.createdBy) ||
        needsActorUpgrade(data.updatedBy) ||
        needsActorUpgrade(data.submittedBy) ||
        needsActorUpgrade(data.approvedBy) ||
        needsActorUpgrade(data.rejectedBy) ||
        needsActorUpgrade(data.cancelledBy)
      ) {
        docsWithStringActorSnapshots++;
      }
    }
    return tagCount;
  };

  const budgetsToTag = countTagAndSnap(budgetsSnap.docs);
  const expenseItemsToTag = countTagAndSnap(itemsSnap.docs);
  const billsToTag = countTagAndSnap(billsSnap.docs);
  const limitsToTag = countTagAndSnap(limitsSnap.docs);
  const spendingsToTag = countTagAndSnap(spendingsSnap.docs);

  let auditLogsToTag = 0;
  for (const d of auditSnap.docs) {
    const data = d.data();
    if (data.officeId === undefined || !data.actor) {
      auditLogsToTag++;
    }
  }

  const fyTotalsToRekey = fyTotalsSnap.docs.filter((d) => {
    const data = d.data();
    const expected = buildFyCodeTotalId(
      (data.officeId as string) || targetOfficeId,
      String(data.fiscalYear || ''),
      String(data.economicCode || '')
    );
    return !data.officeId || d.id !== expected;
  }).length;

  const countersToRekey = countersSnap.docs.filter((d) => {
    const data = d.data();
    const expected = buildCounterId(
      (data.officeId as string) || targetOfficeId,
      String(data.fiscalYear || '')
    );
    return !data.officeId || d.id !== expected;
  }).length;

  return {
    alreadyHasOffices: officesSnap.size,
    willCreateDefaultOffice: officesSnap.empty,
    defaultOfficeName:
      legacySettings?.officeName || (officesSnap.empty ? 'Primary Office' : (officesSnap.docs[0].data() as OfficeDoc).name),
    usersNeedingMigration,
    workHistoryToCreate,
    budgetsToTag,
    expenseItemsToTag,
    billsToTag,
    limitsToTag,
    spendingsToTag,
    auditLogsToTag,
    fyTotalsToRekey,
    countersToRekey,
    docsWithStringActorSnapshots,
  };
}

interface QueuedOp {
  type: 'set' | 'update' | 'delete';
  ref: DocumentReference;
  data?: Record<string, unknown>;
}

async function commitQueuedOps(ops: QueuedOp[]): Promise<void> {
  const CHUNK = 350;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const slice = ops.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const op of slice) {
      if (op.type === 'set' && op.data) {
        batch.set(op.ref, op.data, { merge: true });
      } else if (op.type === 'update' && op.data) {
        batch.update(op.ref, op.data);
      } else if (op.type === 'delete') {
        batch.delete(op.ref);
      }
    }
    await batch.commit();
  }
}

export async function runMultiOfficeMigration(
  actor: AuditActor | ActorSnapshot
): Promise<MultiOfficeMigrationResult> {
  const [
    settingsSnap,
    officesSnap,
    usersSnap,
    whSnap,
    budgetsSnap,
    itemsSnap,
    billsSnap,
    limitsSnap,
    spendingsSnap,
    fyTotalsSnap,
    countersSnap,
    auditSnap,
  ] = await Promise.all([
    getDoc(doc(db, 'settings', 'office')),
    getDocs(collection(db, 'offices')),
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'workHistory')),
    getDocs(collection(db, 'budgets')),
    getDocs(collection(db, 'expenseItems')),
    getDocs(collection(db, 'bills')),
    getDocs(collection(db, 'spendingLimits')),
    getDocs(collection(db, 'spendings')),
    getDocs(collection(db, 'fyCodeTotals')),
    getDocs(collection(db, 'counters')),
    getDocs(collection(db, 'auditLogs')),
  ]);

  const legacySettings = settingsSnap.exists() ? (settingsSnap.data() as Partial<OfficeSettings>) : {};
  let officeId = DEFAULT_MIGRATED_OFFICE_ID;
  let officeCreated = false;
  const ops: QueuedOp[] = [];
  const today = todayYmd();

  const superAdminActorSnap: ActorSnapshot = {
    uid: actor.uid,
    name: actor.name,
    designation: ('designation' in actor && actor.designation) || 'Super Admin',
    officeId: null,
    role: 'superAdmin',
    kind: null,
    workHistoryId: null,
  };

  let officeDisplayName = 'প্রধান কার্যালয়';

  // 1. Ensure primary office exists
  if (officesSnap.empty) {
    officeCreated = true;
    const officeRef = doc(db, 'offices', officeId);
    const cleanName = legacySettings.officeName?.trim() || 'Primary Office';
    const cleanNameBn = legacySettings.officeNameBn?.trim() || cleanName;
    officeDisplayName = cleanNameBn;

    const officePayload: Record<string, unknown> = {
      name: cleanName,
      nameBn: cleanNameBn,
      code: legacySettings.officeCode?.trim() || 'OFF-001',
      address: legacySettings.address || '',
      status: 'active',
      activeFiscalYear: legacySettings.activeFiscalYear || '2025-26',
      fiscalYears:
        legacySettings.fiscalYears && legacySettings.fiscalYears.length > 0
          ? legacySettings.fiscalYears
          : ['2024-25', '2025-26', '2026-27'],
      language: legacySettings.language || 'bn',
      ministryName: legacySettings.ministryName || '',
      officeMobileNo: legacySettings.officeMobileNo || '',
      institutionalCode: legacySettings.institutionalCode || '',
      defaultPayeeText: legacySettings.defaultPayeeText || 'ডি.ডি.ও',
      placeName: legacySettings.placeName || '',
      defaultNetPayableCode: legacySettings.defaultNetPayableCode || '',
      defaultItCode: legacySettings.defaultItCode || '',
      defaultVatCode: legacySettings.defaultVatCode || '',
      defaultSecurityCode: legacySettings.defaultSecurityCode || '',
      tr21FooterText: legacySettings.tr21FooterText || '',
      tr21FontFamily: legacySettings.tr21FontFamily || '',
      tr21FontSize: legacySettings.tr21FontSize || 11.5,
      tr21P1S3Mode: legacySettings.tr21P1S3Mode || 'items',
      tr21VoucherLabel: legacySettings.tr21VoucherLabel || '',
      ...(legacySettings.tr21Clauses ? { tr21Clauses: legacySettings.tr21Clauses } : {}),
      createdAt: serverTimestamp(),
      createdBy: superAdminActorSnap,
      updatedAt: serverTimestamp(),
      updatedBy: superAdminActorSnap,
    };
    ops.push({ type: 'set', ref: officeRef, data: officePayload });
  } else {
    const firstOffice = officesSnap.docs[0];
    officeId = firstOffice.id;
    const oData = firstOffice.data() as OfficeDoc;
    officeDisplayName = oData.nameBn || oData.name;
  }

  // Build user snapshot lookup map
  const existingWhById = new Map(whSnap.docs.map((d) => [d.id, d.data()]));
  const snapshotByUid = new Map<string, ActorSnapshot>();

  let usersMigrated = 0;
  let workHistoryCreated = 0;

  // 2. Migrate users & create initial workHistory postings
  for (const d of usersSnap.docs) {
    const u = d.data() as Partial<UserDoc> & { role?: Role };
    const legacyRole: Role | undefined = u.role;
    const isSA = legacyRole === 'superAdmin' || u.globalRole === 'superAdmin';

    if (isSA) {
      snapshotByUid.set(d.id, {
        uid: d.id,
        name: u.name || 'Super Admin',
        designation: u.designation || 'Super Admin',
        officeId: null,
        role: 'superAdmin',
        kind: null,
        workHistoryId: null,
      });

      if (u.role !== undefined || u.globalRole !== 'superAdmin' || u.access === undefined || u.officeIds === undefined) {
        ops.push({
          type: 'update',
          ref: d.ref,
          data: {
            globalRole: 'superAdmin',
            homeOfficeId: null,
            access: {},
            officeIds: [],
            role: deleteField(),
            updatedAt: serverTimestamp(),
            updatedBy: superAdminActorSnap,
          },
        });
        usersMigrated++;
      }
    } else {
      const existingAccess = u.access || {};
      const resolvedOfficeRole: OfficeRole =
        legacyRole === 'ddo' || legacyRole === 'employee'
          ? legacyRole
          : existingAccess[officeId] || 'employee';

      const detWhId = `mig_wh_${d.id}_${officeId}`;
      const existingWh = existingWhById.get(detWhId);
      const userHasAnyAccess = Object.keys(existingAccess).length > 0;

      if (!existingWh && !userHasAnyAccess) {
        ops.push({
          type: 'set',
          ref: doc(db, 'workHistory', detWhId),
          data: {
            userId: d.id,
            userName: u.name || u.email || 'User',
            officeId,
            officeName: officeDisplayName,
            role: resolvedOfficeRole,
            kind: 'regular',
            designation: u.designation || (resolvedOfficeRole === 'ddo' ? 'DDO' : 'Employee'),
            startDate: today,
            endDate: null,
            status: u.status === 'disabled' ? 'ended' : 'active',
            orderNo: 'MIGRATION-INITIAL',
            orderDate: today,
            endReason: u.status === 'disabled' ? 'relieved' : null,
            assignedBy: { uid: actor.uid, name: actor.name },
            remarks: 'Migrated from single-office deployment',
            createdAt: serverTimestamp(),
            createdBy: superAdminActorSnap,
            updatedAt: serverTimestamp(),
            updatedBy: superAdminActorSnap,
          },
        });
        workHistoryCreated++;
      }

      const finalAccess: Record<string, OfficeRole> =
        Object.keys(existingAccess).length > 0
          ? existingAccess
          : u.status === 'disabled'
            ? {}
            : { [officeId]: resolvedOfficeRole };
      const finalOfficeIds = Object.keys(finalAccess);
      const finalHome = u.homeOfficeId !== undefined ? u.homeOfficeId : finalOfficeIds[0] || null;

      snapshotByUid.set(d.id, {
        uid: d.id,
        name: u.name || u.email || 'User',
        designation: u.designation || '',
        officeId: finalHome || officeId,
        role: finalAccess[finalHome || officeId] || resolvedOfficeRole,
        kind: 'regular',
        workHistoryId: existingWh ? detWhId : !userHasAnyAccess ? detWhId : null,
      });

      if (
        u.role !== undefined ||
        u.globalRole === undefined ||
        u.access === undefined ||
        u.officeIds === undefined
      ) {
        ops.push({
          type: 'update',
          ref: d.ref,
          data: {
            globalRole: null,
            homeOfficeId: finalHome,
            access: finalAccess,
            officeIds: finalOfficeIds,
            role: deleteField(),
            updatedAt: serverTimestamp(),
            updatedBy: superAdminActorSnap,
          },
        });
        usersMigrated++;
      }
    }
  }

  const resolveSnap = (ref: unknown, fallbackName?: string): ActorSnapshot | undefined => {
    if (!ref) return undefined;
    if (typeof ref === 'object' && 'uid' in (ref as Record<string, unknown>)) {
      return ref as ActorSnapshot;
    }
    if (typeof ref === 'string') {
      const uid = ref.trim();
      if (!uid) return undefined;
      return (
        snapshotByUid.get(uid) || {
          uid,
          name: fallbackName || uid,
          designation: '',
          officeId,
          role: 'employee',
          kind: 'regular',
          workHistoryId: null,
        }
      );
    }
    return undefined;
  };

  // Helper to tag & convert actor refs on collections
  const processDocs = (docs: typeof budgetsSnap.docs): number => {
    let count = 0;
    for (const d of docs) {
      const data = d.data();
      const patch: Record<string, unknown> = {};
      if (!data.officeId) patch.officeId = officeId;

      const actorFields = [
        'createdBy',
        'updatedBy',
        'submittedBy',
        'approvedBy',
        'rejectedBy',
        'cancelledBy',
      ] as const;

      for (const f of actorFields) {
        if (needsActorUpgrade(data[f])) {
          const snap = resolveSnap(data[f], f === 'createdBy' ? data.createdByName : undefined);
          if (snap) patch[f] = snap;
        }
      }

      if (Object.keys(patch).length > 0) {
        ops.push({ type: 'update', ref: d.ref, data: patch });
        count++;
      }
    }
    return count;
  };

  const budgetsUpdated = processDocs(budgetsSnap.docs);
  const expenseItemsUpdated = processDocs(itemsSnap.docs);
  const billsUpdated = processDocs(billsSnap.docs);
  const limitsUpdated = processDocs(limitsSnap.docs);
  const spendingsUpdated = processDocs(spendingsSnap.docs);

  // 4. Tag & upgrade auditLogs
  let auditLogsUpdated = 0;
  for (const d of auditSnap.docs) {
    const data = d.data();
    const patch: Record<string, unknown> = {};
    if (data.officeId === undefined) {
      patch.officeId = GLOBAL_COLLECTIONS.has(String(data.collection || '')) ? null : officeId;
    }
    if (!data.actor && data.userId) {
      patch.actor = resolveSnap(data.userId, data.userName);
    }
    if (Object.keys(patch).length > 0) {
      ops.push({ type: 'update', ref: d.ref, data: patch });
      auditLogsUpdated++;
    }
  }

  // 5. Re-key fyCodeTotals to {officeId}_{fy}_{economicCode}
  let fyTotalsRekeyed = 0;
  const existingFyIds = new Set(fyTotalsSnap.docs.map((d) => d.id));
  for (const d of fyTotalsSnap.docs) {
    const data = d.data();
    const docOfficeId = (data.officeId as string) || officeId;
    const fy = String(data.fiscalYear || '');
    const code = String(data.economicCode || '');
    if (!fy || !code) continue;
    const targetId = buildFyCodeTotalId(docOfficeId, fy, code);
    if (d.id !== targetId) {
      if (!existingFyIds.has(targetId)) {
        ops.push({
          type: 'set',
          ref: doc(db, 'fyCodeTotals', targetId),
          data: {
            ...data,
            officeId: docOfficeId,
            createdBy: resolveSnap(data.createdBy) || data.createdBy || superAdminActorSnap,
            updatedBy: resolveSnap(data.updatedBy) || superAdminActorSnap,
          },
        });
      }
      ops.push({ type: 'delete', ref: d.ref });
      fyTotalsRekeyed++;
    } else if (!data.officeId) {
      ops.push({ type: 'update', ref: d.ref, data: { officeId: docOfficeId } });
      fyTotalsRekeyed++;
    }
  }

  // 6. Re-key counters to {officeId}_{fy}_bill
  let countersRekeyed = 0;
  const existingCounterIds = new Set(countersSnap.docs.map((d) => d.id));
  for (const d of countersSnap.docs) {
    const data = d.data();
    const docOfficeId = (data.officeId as string) || officeId;
    const fy = String(data.fiscalYear || '');
    if (!fy) continue;
    const targetId = buildCounterId(docOfficeId, fy);
    if (d.id !== targetId) {
      if (!existingCounterIds.has(targetId)) {
        ops.push({
          type: 'set',
          ref: doc(db, 'counters', targetId),
          data: {
            ...data,
            officeId: docOfficeId,
            updatedBy: resolveSnap(data.updatedBy) || superAdminActorSnap,
          },
        });
      }
      ops.push({ type: 'delete', ref: d.ref });
      countersRekeyed++;
    } else if (!data.officeId) {
      ops.push({ type: 'update', ref: d.ref, data: { officeId: docOfficeId } });
      countersRekeyed++;
    }
  }

  // Execute all queued operations; stops immediately on first error
  await commitQueuedOps(ops);

  const summaryBatch = writeBatch(db);
  writeAuditLogInBatch(summaryBatch, {
    officeId: null,
    collection: 'offices',
    docId: 'multi_office_migration',
    action: 'migrate',
    before: null,
    after: {
      officeId,
      officeCreated,
      usersMigrated,
      workHistoryCreated,
      budgetsUpdated,
      expenseItemsUpdated,
      billsUpdated,
      limitsUpdated,
      spendingsUpdated,
      auditLogsUpdated,
      fyTotalsRekeyed,
      countersRekeyed,
    },
    actor: superAdminActorSnap,
  });
  await summaryBatch.commit();

  return {
    officeId,
    officeCreated,
    usersMigrated,
    workHistoryCreated,
    budgetsUpdated,
    expenseItemsUpdated,
    billsUpdated,
    limitsUpdated,
    spendingsUpdated,
    auditLogsUpdated,
    fyTotalsRekeyed,
    countersRekeyed,
  };
}
