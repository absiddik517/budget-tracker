import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
} from 'firebase/firestore';
import { db } from './firebase';
import { deriveAccessFields } from './actor';
import { writeAuditLogInBatch, writeAuditLogInTx } from './audit';
import { todayYmd } from './dates';
import type {
  ActorSnapshot,
  OfficeDoc,
  OfficeRole,
  OfficeStatus,
  PostingKind,
  UserDoc,
  WorkHistoryDoc,
  WorkHistoryEndReason,
} from '../types';

function buildAssignedBy(actor: ActorSnapshot) {
  return { uid: actor.uid, name: actor.name };
}

async function fetchActiveWorkHistoryRefsByUser(userId: string): Promise<DocumentReference[]> {
  const snap = await getDocs(
    query(collection(db, 'workHistory'), where('userId', '==', userId), where('status', '==', 'active'))
  );
  return snap.docs.map((d) => d.ref);
}

function writeUserAccessInTx(
  tx: Parameters<Parameters<typeof runTransaction>[1]>[0],
  targetUserRef: DocumentReference,
  uData: Omit<UserDoc, 'id'>,
  activePostings: Array<{
    id: string;
    officeId: string;
    role: OfficeRole;
    kind: PostingKind;
    status: 'active' | 'ended';
    designation?: string;
  }>,
  actor: ActorSnapshot,
  overrideDesignation?: string
) {
  const derived = deriveAccessFields(activePostings);
  const regularPosting = activePostings.find((p) => p.status === 'active' && p.kind === 'regular');
  const nextDesignation = overrideDesignation || regularPosting?.designation || uData.designation || '';

  tx.update(targetUserRef, {
    access: derived.access,
    officeIds: derived.officeIds,
    homeOfficeId: derived.homeOfficeId,
    designation: nextDesignation,
    updatedAt: serverTimestamp(),
    updatedBy: actor,
  });
}

// ---------- Offices ----------

export async function createOffice(
  input: {
    name: string;
    nameBn: string;
    code: string;
    address: string;
    activeFiscalYear: string;
    fiscalYears: string[];
    ministryName?: string;
    officeMobileNo?: string;
    institutionalCode?: string;
    defaultPayeeText?: string;
    placeName?: string;
  },
  actor: ActorSnapshot
): Promise<string> {
  const cleanCode = input.code.trim();
  const cleanName = input.name.trim();
  const cleanNameBn = input.nameBn.trim() || cleanName;
  if (!cleanCode || !cleanName) {
    throw new Error('Office code and name are required.');
  }

  // Validate unique code
  const existing = await getDocs(query(collection(db, 'offices'), where('code', '==', cleanCode)));
  if (!existing.empty) {
    throw new Error(`Office code "${cleanCode}" already exists.`);
  }

  const officeRef = doc(collection(db, 'offices'));
  const payload = {
    name: cleanName,
    nameBn: cleanNameBn,
    code: cleanCode,
    address: input.address.trim(),
    status: 'active' as OfficeStatus,
    activeFiscalYear: input.activeFiscalYear,
    fiscalYears: input.fiscalYears,
    language: 'bn' as const,
    ministryName: input.ministryName?.trim() || '',
    officeMobileNo: input.officeMobileNo?.trim() || '',
    institutionalCode: input.institutionalCode?.trim() || '',
    defaultPayeeText: input.defaultPayeeText?.trim() || 'ডি.ডি.ও',
    placeName: input.placeName?.trim() || '',
    createdAt: serverTimestamp(),
    createdBy: actor,
    updatedAt: serverTimestamp(),
    updatedBy: actor,
  };

  const batch = writeBatch(db);
  batch.set(officeRef, payload);
  writeAuditLogInBatch(batch, {
    officeId: officeRef.id,
    collection: 'offices',
    docId: officeRef.id,
    action: 'create',
    before: null,
    after: { ...payload, id: officeRef.id },
    actor,
  });
  await batch.commit();
  return officeRef.id;
}

export async function updateOffice(
  officeId: string,
  updates: Partial<Omit<OfficeDoc, 'id' | 'createdAt' | 'createdBy'>>,
  actor: ActorSnapshot
): Promise<void> {
  if (updates.code) {
    const cleanCode = updates.code.trim();
    const dupSnap = await getDocs(query(collection(db, 'offices'), where('code', '==', cleanCode)));
    const hasConflict = dupSnap.docs.some((d) => d.id !== officeId);
    if (hasConflict) {
      throw new Error(`Office code "${cleanCode}" is already used by another office.`);
    }
  }

  const officeRef = doc(db, 'offices', officeId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(officeRef);
    if (!snap.exists()) throw new Error('Office not found.');
    const before = snap.data() as Record<string, unknown>;
    const cleanUpdates: Record<string, unknown> = {
      ...updates,
      updatedAt: serverTimestamp(),
      updatedBy: actor,
    };
    if (typeof updates.name === 'string') cleanUpdates.name = updates.name.trim();
    if (typeof updates.nameBn === 'string') cleanUpdates.nameBn = updates.nameBn.trim();
    if (typeof updates.code === 'string') cleanUpdates.code = updates.code.trim();
    if (typeof updates.address === 'string') cleanUpdates.address = updates.address.trim();

    tx.update(officeRef, cleanUpdates);
    writeAuditLogInTx(tx, {
      officeId,
      collection: 'offices',
      docId: officeId,
      action: 'update',
      before,
      after: { ...before, ...cleanUpdates },
      actor,
    });
  });
}

export async function setOfficeStatus(
  officeId: string,
  status: OfficeStatus,
  actor: ActorSnapshot
): Promise<void> {
  await updateOffice(officeId, { status }, actor);
}

// ---------- Work History & Postings ----------

/**
 * Assign a DDO (regular or additionalCharge) to targetOfficeId.
 * Atomically ends any prior active DDO posting in targetOfficeId (handover).
 * If kind == 'regular', also ends the target user's own previous active regular posting (transferred).
 */
export async function assignDdoTx(params: {
  userId: string;
  targetOfficeId: string;
  kind: PostingKind;
  designation: string;
  orderNo: string;
  orderDate: string;
  remarks?: string;
  actor: ActorSnapshot;
}): Promise<string> {
  const { userId, targetOfficeId, kind, designation, orderNo, orderDate, remarks = '', actor } = params;
  if (!orderNo.trim()) throw new Error('Order no. is required.');

  const [targetUserWhRefs, priorDdoSnap] = await Promise.all([
    fetchActiveWorkHistoryRefsByUser(userId),
    getDocs(
      query(
        collection(db, 'workHistory'),
        where('officeId', '==', targetOfficeId),
        where('role', '==', 'ddo'),
        where('status', '==', 'active')
      )
    ),
  ]);

  const targetOfficeDdoRefs = priorDdoSnap.docs.map((d) => d.ref);
  const priorDdoUserIds = Array.from(
    new Set(priorDdoSnap.docs.map((d) => (d.data() as WorkHistoryDoc).userId).filter((id) => id !== userId))
  );
  const priorDdoUsersActiveRefs = await Promise.all(
    priorDdoUserIds.map(async (uid) => ({
      uid,
      refs: await fetchActiveWorkHistoryRefsByUser(uid),
    }))
  );

  const today = todayYmd();
  const newWhRef = doc(collection(db, 'workHistory'));

  await runTransaction(db, async (tx) => {
    // Phase 1: Execute ALL reads before any writes
    const userRef = doc(db, 'users', userId);
    const officeRef = doc(db, 'offices', targetOfficeId);
    const [userSnap, officeSnap, targetUserSnaps, officeDdoSnaps, priorUsersData] = await Promise.all([
      tx.get(userRef),
      tx.get(officeRef),
      Promise.all(targetUserWhRefs.map((r) => tx.get(r))),
      Promise.all(targetOfficeDdoRefs.map((r) => tx.get(r))),
      Promise.all(
        priorDdoUsersActiveRefs.map(async (entry) => {
          const priorUserRef = doc(db, 'users', entry.uid);
          const [priorUserSnap, whSnaps] = await Promise.all([
            tx.get(priorUserRef),
            Promise.all(entry.refs.map((r) => tx.get(r))),
          ]);
          return {
            uid: entry.uid,
            userRef: priorUserRef,
            userSnap: priorUserSnap,
            whSnaps,
          };
        })
      ),
    ]);

    if (!userSnap.exists()) throw new Error('Target user not found.');
    if (!officeSnap.exists()) throw new Error('Target office not found.');
    const userData = userSnap.data() as Omit<UserDoc, 'id'>;
    if (userData.status === 'disabled') throw new Error('Cannot post a disabled user.');
    if (userData.globalRole === 'superAdmin') {
      throw new Error('Super Admin does not hold office postings.');
    }
    const officeData = officeSnap.data() as Omit<OfficeDoc, 'id'>;

    // Phase 2: Execute ALL writes
    const endedIds = new Set<string>();

    // 1. Handover: end any existing active DDO in targetOfficeId
    for (const ddoSnap of officeDdoSnaps) {
      if (!ddoSnap.exists()) continue;
      const ddoWh = { id: ddoSnap.id, ...(ddoSnap.data() as Omit<WorkHistoryDoc, 'id'>) };
      if (ddoWh.status !== 'active') continue;
      const endReason: WorkHistoryEndReason =
        ddoWh.kind === 'additionalCharge' ? 'charge withdrawn' : 'relieved';
      tx.update(ddoSnap.ref, {
        status: 'ended',
        endDate: today,
        endReason,
        updatedAt: serverTimestamp(),
        updatedBy: actor,
      });
      endedIds.add(ddoWh.id);
      writeAuditLogInTx(tx, {
        officeId: targetOfficeId,
        collection: 'workHistory',
        docId: ddoWh.id,
        action: 'handover',
        before: ddoWh as unknown as Record<string, unknown>,
        after: { ...ddoWh, status: 'ended', endDate: today, endReason },
        actor,
      });
    }

    // 2. If new posting is 'regular', end user's existing active regular posting (if not already ended above)
    const targetUserActivePostings: WorkHistoryDoc[] = [];
    for (const s of targetUserSnaps) {
      if (!s.exists()) continue;
      const wh = { id: s.id, ...(s.data() as Omit<WorkHistoryDoc, 'id'>) };
      if (wh.status !== 'active' || endedIds.has(wh.id)) continue;
      if (kind === 'regular' && wh.kind === 'regular') {
        const endReason: WorkHistoryEndReason = 'transferred';
        tx.update(s.ref, {
          status: 'ended',
          endDate: today,
          endReason,
          updatedAt: serverTimestamp(),
          updatedBy: actor,
        });
        endedIds.add(wh.id);
        writeAuditLogInTx(tx, {
          officeId: wh.officeId,
          collection: 'workHistory',
          docId: wh.id,
          action: 'transfer',
          before: wh as unknown as Record<string, unknown>,
          after: { ...wh, status: 'ended', endDate: today, endReason },
          actor,
        });
      } else if (wh.officeId === targetOfficeId && wh.kind === 'additionalCharge') {
        // Replace existing additionalCharge in same office cleanly
        tx.update(s.ref, {
          status: 'ended',
          endDate: today,
          endReason: 'charge withdrawn',
          updatedAt: serverTimestamp(),
          updatedBy: actor,
        });
        endedIds.add(wh.id);
      } else {
        targetUserActivePostings.push(wh);
      }
    }

    // 3. Create new workHistory posting
    const newWhPayload: Omit<WorkHistoryDoc, 'id'> = {
      userId,
      userName: userData.name,
      officeId: targetOfficeId,
      officeName: officeData.nameBn || officeData.name,
      role: 'ddo',
      kind,
      designation: designation.trim() || userData.designation || 'DDO',
      startDate: today,
      endDate: null,
      status: 'active',
      orderNo: orderNo.trim(),
      orderDate: orderDate || today,
      endReason: null,
      assignedBy: buildAssignedBy(actor),
      remarks: remarks.trim(),
      createdAt: serverTimestamp() as never,
      createdBy: actor,
      updatedAt: serverTimestamp() as never,
      updatedBy: actor,
    };
    tx.set(newWhRef, newWhPayload);

    writeAuditLogInTx(tx, {
      officeId: targetOfficeId,
      collection: 'workHistory',
      docId: newWhRef.id,
      action: kind === 'additionalCharge' ? 'chargeGrant' : 'create',
      before: null,
      after: { id: newWhRef.id, ...newWhPayload },
      actor,
    });

    // 4. Recompute target user access map
    const updatedTargetPostings = [
      ...targetUserActivePostings,
      { id: newWhRef.id, ...newWhPayload },
    ];
    writeUserAccessInTx(
      tx,
      userRef,
      userData,
      updatedTargetPostings,
      actor,
      kind === 'regular' ? newWhPayload.designation : undefined
    );

    // 5. Recompute prior DDO users' access maps
    for (const pEntry of priorUsersData) {
      if (!pEntry.userSnap.exists()) continue;
      const pUserData = pEntry.userSnap.data() as Omit<UserDoc, 'id'>;
      const remaining = pEntry.whSnaps
        .filter((s) => s.exists())
        .map((s) => ({ id: s.id, ...(s.data() as Omit<WorkHistoryDoc, 'id'>) }))
        .filter((wh) => wh.status === 'active' && !endedIds.has(wh.id));
      writeUserAccessInTx(tx, pEntry.userRef, pUserData, remaining, actor);
    }
  });

  return newWhRef.id;
}

/**
 * Transfer user's regular posting to a new office as Employee or DDO.
 * Preserves any active additionalCharge postings in other offices unless superseded by DDO role.
 */
export async function transferUserTx(params: {
  userId: string;
  targetOfficeId: string;
  role: OfficeRole;
  designation: string;
  orderNo: string;
  orderDate: string;
  remarks?: string;
  actor: ActorSnapshot;
}): Promise<string> {
  if (params.role === 'ddo') {
    return assignDdoTx({
      ...params,
      kind: 'regular',
    });
  }

  const { userId, targetOfficeId, designation, orderNo, orderDate, remarks = '', actor } = params;
  if (!orderNo.trim()) throw new Error('Transfer order no. is required.');

  const activeRefs = await fetchActiveWorkHistoryRefsByUser(userId);
  const today = todayYmd();
  const newWhRef = doc(collection(db, 'workHistory'));

  await runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', userId);
    const officeRef = doc(db, 'offices', targetOfficeId);
    const [userSnap, officeSnap, activeSnaps] = await Promise.all([
      tx.get(userRef),
      tx.get(officeRef),
      Promise.all(activeRefs.map((r) => tx.get(r))),
    ]);
    if (!userSnap.exists()) throw new Error('User not found.');
    if (!officeSnap.exists()) throw new Error('Target office not found.');
    const userData = userSnap.data() as Omit<UserDoc, 'id'>;
    if (userData.status === 'disabled') throw new Error('Cannot transfer a disabled user.');
    if (userData.globalRole === 'superAdmin') throw new Error('Super Admin cannot be transferred to an office.');
    const officeData = officeSnap.data() as Omit<OfficeDoc, 'id'>;

    const keptPostings: WorkHistoryDoc[] = [];

    for (const s of activeSnaps) {
      if (!s.exists()) continue;
      const wh = { id: s.id, ...(s.data() as Omit<WorkHistoryDoc, 'id'>) };
      if (wh.status !== 'active') continue;
      if (wh.kind === 'regular') {
        tx.update(s.ref, {
          status: 'ended',
          endDate: today,
          endReason: 'transferred',
          updatedAt: serverTimestamp(),
          updatedBy: actor,
        });
        writeAuditLogInTx(tx, {
          officeId: wh.officeId,
          collection: 'workHistory',
          docId: wh.id,
          action: 'transfer',
          before: wh as unknown as Record<string, unknown>,
          after: { ...wh, status: 'ended', endDate: today, endReason: 'transferred' },
          actor,
        });
      } else {
        keptPostings.push(wh);
      }
    }

    const newWhPayload: Omit<WorkHistoryDoc, 'id'> = {
      userId,
      userName: userData.name,
      officeId: targetOfficeId,
      officeName: officeData.nameBn || officeData.name,
      role: 'employee',
      kind: 'regular',
      designation: designation.trim() || userData.designation || 'Employee',
      startDate: today,
      endDate: null,
      status: 'active',
      orderNo: orderNo.trim(),
      orderDate: orderDate || today,
      endReason: null,
      assignedBy: buildAssignedBy(actor),
      remarks: remarks.trim(),
      createdAt: serverTimestamp() as never,
      createdBy: actor,
      updatedAt: serverTimestamp() as never,
      updatedBy: actor,
    };
    tx.set(newWhRef, newWhPayload);

    writeAuditLogInTx(tx, {
      officeId: targetOfficeId,
      collection: 'workHistory',
      docId: newWhRef.id,
      action: 'transfer',
      before: null,
      after: { id: newWhRef.id, ...newWhPayload },
      actor,
    });

    writeUserAccessInTx(
      tx,
      userRef,
      userData,
      [...keptPostings, { id: newWhRef.id, ...newWhPayload }],
      actor,
      newWhPayload.designation
    );
  });

  return newWhRef.id;
}

/**
 * Grant Additional Charge to a user in targetOfficeId (DDO or Employee).
 * If role == 'ddo', automatically hands over from prior DDO in targetOfficeId in same transaction.
 */
export async function grantAdditionalChargeTx(params: {
  userId: string;
  targetOfficeId: string;
  role: OfficeRole;
  designation: string;
  orderNo: string;
  orderDate: string;
  remarks?: string;
  actor: ActorSnapshot;
}): Promise<string> {
  if (params.role === 'ddo') {
    return assignDdoTx({
      ...params,
      kind: 'additionalCharge',
    });
  }

  const { userId, targetOfficeId, designation, orderNo, orderDate, remarks = '', actor } = params;
  if (!orderNo.trim()) throw new Error('Order no. is required.');

  const activeRefs = await fetchActiveWorkHistoryRefsByUser(userId);
  const today = todayYmd();
  const newWhRef = doc(collection(db, 'workHistory'));

  await runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', userId);
    const officeRef = doc(db, 'offices', targetOfficeId);
    const [userSnap, officeSnap, activeSnaps] = await Promise.all([
      tx.get(userRef),
      tx.get(officeRef),
      Promise.all(activeRefs.map((r) => tx.get(r))),
    ]);
    if (!userSnap.exists()) throw new Error('User not found.');
    if (!officeSnap.exists()) throw new Error('Target office not found.');
    const userData = userSnap.data() as Omit<UserDoc, 'id'>;
    if (userData.status === 'disabled') throw new Error('Cannot assign charge to a disabled user.');
    if (userData.globalRole === 'superAdmin') throw new Error('Super Admin does not take office postings.');
    const officeData = officeSnap.data() as Omit<OfficeDoc, 'id'>;

    const keptPostings: WorkHistoryDoc[] = [];

    for (const s of activeSnaps) {
      if (!s.exists()) continue;
      const wh = { id: s.id, ...(s.data() as Omit<WorkHistoryDoc, 'id'>) };
      if (wh.status !== 'active') continue;
      if (wh.officeId === targetOfficeId && wh.kind === 'regular') {
        throw new Error('User already has a regular posting in this office.');
      }
      if (wh.officeId === targetOfficeId && wh.kind === 'additionalCharge') {
        tx.update(s.ref, {
          status: 'ended',
          endDate: today,
          endReason: 'charge withdrawn',
          updatedAt: serverTimestamp(),
          updatedBy: actor,
        });
      } else {
        keptPostings.push(wh);
      }
    }

    const newWhPayload: Omit<WorkHistoryDoc, 'id'> = {
      userId,
      userName: userData.name,
      officeId: targetOfficeId,
      officeName: officeData.nameBn || officeData.name,
      role: 'employee',
      kind: 'additionalCharge',
      designation: designation.trim() || userData.designation || 'Additional Charge',
      startDate: today,
      endDate: null,
      status: 'active',
      orderNo: orderNo.trim(),
      orderDate: orderDate || today,
      endReason: null,
      assignedBy: buildAssignedBy(actor),
      remarks: remarks.trim(),
      createdAt: serverTimestamp() as never,
      createdBy: actor,
      updatedAt: serverTimestamp() as never,
      updatedBy: actor,
    };
    tx.set(newWhRef, newWhPayload);

    writeAuditLogInTx(tx, {
      officeId: targetOfficeId,
      collection: 'workHistory',
      docId: newWhRef.id,
      action: 'chargeGrant',
      before: null,
      after: { id: newWhRef.id, ...newWhPayload },
      actor,
    });

    writeUserAccessInTx(
      tx,
      userRef,
      userData,
      [...keptPostings, { id: newWhRef.id, ...newWhPayload }],
      actor
    );
  });

  return newWhRef.id;
}

export async function withdrawAdditionalChargeTx(params: {
  workHistoryId: string;
  userId: string;
  remarks?: string;
  actor: ActorSnapshot;
}): Promise<void> {
  const { workHistoryId, userId, remarks, actor } = params;
  const activeRefs = await fetchActiveWorkHistoryRefsByUser(userId);
  const today = todayYmd();

  await runTransaction(db, async (tx) => {
    const whRef = doc(db, 'workHistory', workHistoryId);
    const userRef = doc(db, 'users', userId);
    const [whSnap, userSnap, activeSnaps] = await Promise.all([
      tx.get(whRef),
      tx.get(userRef),
      Promise.all(activeRefs.map((r) => tx.get(r))),
    ]);
    if (!whSnap.exists()) throw new Error('Posting record not found.');
    if (!userSnap.exists()) throw new Error('User record does not exist.');
    const wh = { id: whSnap.id, ...(whSnap.data() as Omit<WorkHistoryDoc, 'id'>) };
    if (wh.status !== 'active' || wh.kind !== 'additionalCharge') {
      throw new Error('Only an active additional-charge posting can be withdrawn.');
    }
    const userData = userSnap.data() as Omit<UserDoc, 'id'>;

    const remaining: WorkHistoryDoc[] = [];
    for (const s of activeSnaps) {
      if (!s.exists() || s.id === workHistoryId) continue;
      const d = { id: s.id, ...(s.data() as Omit<WorkHistoryDoc, 'id'>) };
      if (d.status === 'active') remaining.push(d);
    }

    tx.update(whRef, {
      status: 'ended',
      endDate: today,
      endReason: 'charge withdrawn',
      remarks: remarks !== undefined ? remarks.trim() : wh.remarks,
      updatedAt: serverTimestamp(),
      updatedBy: actor,
    });

    writeAuditLogInTx(tx, {
      officeId: wh.officeId,
      collection: 'workHistory',
      docId: wh.id,
      action: 'chargeWithdraw',
      before: wh as unknown as Record<string, unknown>,
      after: { ...wh, status: 'ended', endDate: today, endReason: 'charge withdrawn' },
      actor,
    });

    writeUserAccessInTx(tx, userRef, userData, remaining, actor);
  });
}

export async function endRegularPostingTx(params: {
  workHistoryId: string;
  userId: string;
  endReason: WorkHistoryEndReason;
  remarks?: string;
  actor: ActorSnapshot;
}): Promise<void> {
  const { workHistoryId, userId, endReason, remarks, actor } = params;
  const activeRefs = await fetchActiveWorkHistoryRefsByUser(userId);
  const today = todayYmd();

  await runTransaction(db, async (tx) => {
    const whRef = doc(db, 'workHistory', workHistoryId);
    const userRef = doc(db, 'users', userId);
    const [whSnap, userSnap, activeSnaps] = await Promise.all([
      tx.get(whRef),
      tx.get(userRef),
      Promise.all(activeRefs.map((r) => tx.get(r))),
    ]);
    if (!whSnap.exists()) throw new Error('Posting record not found.');
    if (!userSnap.exists()) throw new Error('User record does not exist.');
    const wh = { id: whSnap.id, ...(whSnap.data() as Omit<WorkHistoryDoc, 'id'>) };
    if (wh.status !== 'active') throw new Error('Posting is already ended.');
    const userData = userSnap.data() as Omit<UserDoc, 'id'>;

    // Enforce DDO boundary client-side as well
    if (actor.role === 'ddo') {
      if (wh.officeId !== actor.officeId || wh.role !== 'employee' || wh.kind !== 'regular') {
        throw new Error('DDO can only end regular employee postings in their own office.');
      }
    }

    const remaining: WorkHistoryDoc[] = [];
    for (const s of activeSnaps) {
      if (!s.exists() || s.id === workHistoryId) continue;
      const d = { id: s.id, ...(s.data() as Omit<WorkHistoryDoc, 'id'>) };
      if (d.status === 'active') remaining.push(d);
    }

    tx.update(whRef, {
      status: 'ended',
      endDate: today,
      endReason,
      remarks: remarks !== undefined ? remarks.trim() : wh.remarks,
      updatedAt: serverTimestamp(),
      updatedBy: actor,
    });

    writeAuditLogInTx(tx, {
      officeId: wh.officeId,
      collection: 'workHistory',
      docId: wh.id,
      action: 'update',
      before: wh as unknown as Record<string, unknown>,
      after: { ...wh, status: 'ended', endDate: today, endReason },
      actor,
    });

    writeUserAccessInTx(tx, userRef, userData, remaining, actor);
  });
}

export async function updateStaffDesignationTx(params: {
  userId: string;
  designation: string;
  phone?: string;
  workHistoryId?: string;
  actor: ActorSnapshot;
}): Promise<void> {
  const { userId, designation, phone, workHistoryId, actor } = params;
  const cleanDesig = designation.trim();
  if (!cleanDesig) throw new Error('Designation is required.');

  await runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', userId);
    const uSnap = await tx.get(userRef);
    if (!uSnap.exists()) throw new Error('User not found.');
    const uBefore = uSnap.data() as Omit<UserDoc, 'id'>;

    let whBefore: Record<string, unknown> | null = null;
    if (workHistoryId) {
      const whRef = doc(db, 'workHistory', workHistoryId);
      const whSnap = await tx.get(whRef);
      if (whSnap.exists()) {
        whBefore = whSnap.data() as Record<string, unknown>;
        tx.update(whRef, {
          designation: cleanDesig,
          updatedAt: serverTimestamp(),
          updatedBy: actor,
        });
        writeAuditLogInTx(tx, {
          officeId: (whBefore.officeId as string) || actor.officeId,
          collection: 'workHistory',
          docId: workHistoryId,
          action: 'correct',
          before: whBefore,
          after: { ...whBefore, designation: cleanDesig },
          actor,
        });
      }
    }

    const userUpdates: Record<string, unknown> = {
      designation: cleanDesig,
      updatedAt: serverTimestamp(),
      updatedBy: actor,
    };
    if (phone !== undefined) userUpdates.phone = phone.trim();

    tx.update(userRef, userUpdates);
    writeAuditLogInTx(tx, {
      officeId: actor.officeId,
      collection: 'users',
      docId: userId,
      action: 'update',
      before: uBefore as unknown as Record<string, unknown>,
      after: { ...uBefore, ...userUpdates },
      actor,
    });
  });
}

export async function correctWorkHistoryEntry(params: {
  workHistoryId: string;
  orderNo: string;
  orderDate: string;
  remarks: string;
  actor: ActorSnapshot;
}): Promise<void> {
  const { workHistoryId, orderNo, orderDate, remarks, actor } = params;
  const whRef = doc(db, 'workHistory', workHistoryId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(whRef);
    if (!snap.exists()) throw new Error('Work history entry not found.');
    const before = snap.data() as Record<string, unknown>;
    const updates = {
      orderNo: orderNo.trim(),
      orderDate: orderDate.trim(),
      remarks: remarks.trim(),
      updatedAt: serverTimestamp(),
      updatedBy: actor,
    };
    tx.update(whRef, updates);
    writeAuditLogInTx(tx, {
      officeId: (before.officeId as string) || null,
      collection: 'workHistory',
      docId: workHistoryId,
      action: 'correct',
      before,
      after: { ...before, ...updates },
      actor,
    });
  });
}

export async function disableUserTx(params: {
  userId: string;
  reason?: string;
  actor: ActorSnapshot;
}): Promise<void> {
  const { userId, reason = 'Disabled by Super Admin', actor } = params;
  const activeRefs = await fetchActiveWorkHistoryRefsByUser(userId);
  const today = todayYmd();

  await runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', userId);
    const uSnap = await tx.get(userRef);
    if (!uSnap.exists()) throw new Error('User not found.');
    const uBefore = uSnap.data() as Omit<UserDoc, 'id'>;
    if (uBefore.globalRole === 'superAdmin') {
      throw new Error('Cannot disable a Super Admin from here.');
    }

    const activeSnaps = await Promise.all(activeRefs.map((r) => tx.get(r)));
    for (const s of activeSnaps) {
      if (!s.exists()) continue;
      const wh = { id: s.id, ...(s.data() as Omit<WorkHistoryDoc, 'id'>) };
      if (wh.status !== 'active') continue;
      tx.update(s.ref, {
        status: 'ended',
        endDate: today,
        endReason: wh.kind === 'additionalCharge' ? 'charge withdrawn' : 'relieved',
        remarks: wh.remarks ? `${wh.remarks} · ${reason}` : reason,
        updatedAt: serverTimestamp(),
        updatedBy: actor,
      });
      writeAuditLogInTx(tx, {
        officeId: wh.officeId,
        collection: 'workHistory',
        docId: wh.id,
        action: 'disable',
        before: wh as unknown as Record<string, unknown>,
        after: { ...wh, status: 'ended', endDate: today },
        actor,
      });
    }

    tx.update(userRef, {
      status: 'disabled',
      access: {},
      officeIds: [],
      homeOfficeId: null,
      updatedAt: serverTimestamp(),
      updatedBy: actor,
    });

    writeAuditLogInTx(tx, {
      officeId: null,
      collection: 'users',
      docId: userId,
      action: 'disable',
      before: uBefore as unknown as Record<string, unknown>,
      after: { ...uBefore, status: 'disabled', access: {}, officeIds: [], homeOfficeId: null },
      actor,
    });
  });
}

export async function enableUserTx(params: {
  userId: string;
  actor: ActorSnapshot;
}): Promise<void> {
  const { userId, actor } = params;
  const userRef = doc(db, 'users', userId);
  await runTransaction(db, async (tx) => {
    const uSnap = await tx.get(userRef);
    if (!uSnap.exists()) throw new Error('User not found.');
    const uBefore = uSnap.data() as Omit<UserDoc, 'id'>;
    tx.update(userRef, {
      status: 'active',
      updatedAt: serverTimestamp(),
      updatedBy: actor,
    });
    writeAuditLogInTx(tx, {
      officeId: null,
      collection: 'users',
      docId: userId,
      action: 'enable',
      before: uBefore as unknown as Record<string, unknown>,
      after: { ...uBefore, status: 'active' },
      actor,
    });
  });
}

// ---------- Invites ----------

export async function createMultiOfficeInvite(params: {
  email: string;
  name?: string;
  phone?: string;
  officeId: string;
  role: OfficeRole;
  kind: PostingKind;
  designation: string;
  orderNo?: string;
  orderDate?: string;
  actor: ActorSnapshot;
}): Promise<void> {
  const emailLower = params.email.trim().toLowerCase();
  if (!emailLower || !emailLower.includes('@')) {
    throw new Error('Valid email is required.');
  }
  if (!params.officeId) throw new Error('Office is required.');

  if (params.actor.role === 'ddo') {
    if (
      params.officeId !== params.actor.officeId ||
      params.role !== 'employee' ||
      params.kind !== 'regular'
    ) {
      throw new Error('DDO can only invite regular employees for their own office.');
    }
  }

  const inviteRef = doc(db, 'invites', emailLower);
  const payload = {
    email: emailLower,
    name: (params.name || '').trim(),
    phone: (params.phone || '').trim(),
    officeId: params.officeId,
    role: params.role,
    kind: params.kind,
    designation: params.designation.trim(),
    orderNo: (params.orderNo || '').trim(),
    orderDate: (params.orderDate || todayYmd()).trim(),
    invitedBy: params.actor,
    createdAt: serverTimestamp(),
    createdBy: params.actor,
  };

  await setDoc(inviteRef, payload);

  const batch = writeBatch(db);
  writeAuditLogInBatch(batch, {
    officeId: params.officeId,
    collection: 'invites',
    docId: emailLower,
    action: 'create',
    before: null,
    after: payload,
    actor: params.actor,
  });
  await batch.commit();
}

export async function revokeInvite(emailLower: string, actor: ActorSnapshot, officeId: string | null): Promise<void> {
  await deleteDoc(doc(db, 'invites', emailLower.trim().toLowerCase()));
  const batch = writeBatch(db);
  writeAuditLogInBatch(batch, {
    officeId,
    collection: 'invites',
    docId: emailLower,
    action: 'delete',
    before: { email: emailLower },
    after: null,
    actor,
  });
  await batch.commit();
}

export async function updateUserSelfProfile(uid: string, name: string, phone?: string): Promise<void> {
  const updates: Record<string, unknown> = {
    name: name.trim(),
    updatedAt: serverTimestamp(),
  };
  if (phone !== undefined) updates.phone = phone.trim();
  await updateDoc(doc(db, 'users', uid), updates);
}
