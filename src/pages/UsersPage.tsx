import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { StatusChip } from '../components/StatusChip';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { db } from '../lib/firebase';
import { todayYmd, formatDateDisplay } from '../lib/dates';
import { isPermissionDeniedError, logFirestoreError, OperationType } from '../lib/firestoreError';
import {
  assignDdoTx,
  correctWorkHistoryEntry,
  createMultiOfficeInvite,
  disableUserTx,
  enableUserTx,
  endRegularPostingTx,
  grantAdditionalChargeTx,
  revokeInvite,
  transferUserTx,
  withdrawAdditionalChargeTx,
} from '../lib/officeOps';
import { formatRoleLabel } from '../lib/permissions';
import type {
  InviteDoc,
  OfficeRole,
  PostingKind,
  UserDoc,
  WorkHistoryDoc,
  WorkHistoryEndReason,
} from '../types';

type PostingActionTab = 'ddo' | 'transfer' | 'additionalCharge';

export function UsersPage() {
  const { userDoc, accessState } = useAuth();
  const {
    offices,
    officesById,
    actorSnapshot,
    pushToast,
    t,
    reportPermissionError,
    clearPermissionError,
  } = useApp();

  const [users, setUsers] = useState<UserDoc[]>([]);
  const [invites, setInvites] = useState<InviteDoc[]>([]);
  const [workHistory, setWorkHistory] = useState<WorkHistoryDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [officeFilter, setOfficeFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');

  // Invite modal state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invEmail, setInvEmail] = useState('');
  const [invName, setInvName] = useState('');
  const [invPhone, setInvPhone] = useState('');
  const [invOfficeId, setInvOfficeId] = useState('');
  const [invRole, setInvRole] = useState<OfficeRole>('employee');
  const [invKind, setInvKind] = useState<PostingKind>('regular');
  const [invDesignation, setInvDesignation] = useState('');
  const [invOrderNo, setInvOrderNo] = useState('');
  const [invOrderDate, setInvOrderDate] = useState(todayYmd());
  const [savingInvite, setSavingInvite] = useState(false);

  // User Detail & Postings modal state
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [actionTab, setActionTab] = useState<PostingActionTab>('ddo');
  const [actOfficeId, setActOfficeId] = useState('');
  const [actRole, setActRole] = useState<OfficeRole>('employee');
  const [actKind, setActKind] = useState<PostingKind>('regular');
  const [actDesignation, setActDesignation] = useState('');
  const [actOrderNo, setActOrderNo] = useState('');
  const [actOrderDate, setActOrderDate] = useState(todayYmd());
  const [actRemarks, setActRemarks] = useState('');
  const [acting, setActing] = useState(false);

  // End regular posting inline state
  const [endingWhId, setEndingWhId] = useState<string | null>(null);
  const [endReason, setEndReason] = useState<WorkHistoryEndReason>('retired');
  const [endRemarks, setEndRemarks] = useState('');

  // Correct work history inline state
  const [editingWhId, setEditingWhId] = useState<string | null>(null);
  const [editOrderNo, setEditOrderNo] = useState('');
  const [editOrderDate, setEditOrderDate] = useState('');
  const [editRemarks, setEditRemarks] = useState('');

  useEffect(() => {
    if (accessState !== 'active') return;
    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      (snap) => {
        clearPermissionError('users');
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as UserDoc))
          .sort((a, b) => a.name.localeCompare(b.name));
        setUsers(list);
        setLoading(false);
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'users');
        if (isPermissionDeniedError(err)) reportPermissionError('users');
        setLoading(false);
      }
    );
    const unsubInvites = onSnapshot(
      collection(db, 'invites'),
      (snap) => {
        clearPermissionError('invites');
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as InviteDoc))
          .sort((a, b) => a.email.localeCompare(b.email));
        setInvites(list);
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'invites');
        if (isPermissionDeniedError(err)) reportPermissionError('invites');
      }
    );
    const unsubWh = onSnapshot(
      collection(db, 'workHistory'),
      (snap) => {
        clearPermissionError('workHistory');
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkHistoryDoc));
        setWorkHistory(list);
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'workHistory');
        if (isPermissionDeniedError(err)) reportPermissionError('workHistory');
      }
    );
    return () => {
      unsubUsers();
      unsubInvites();
      unsubWh();
    };
  }, [accessState, clearPermissionError, reportPermissionError]);

  const activeOffices = useMemo(
    () => offices.filter((o) => o.status === 'active'),
    [offices]
  );

  // Active postings grouped by userId and by officeId
  const activePostingsByUser = useMemo(() => {
    const map = new Map<string, WorkHistoryDoc[]>();
    for (const wh of workHistory) {
      if (wh.status !== 'active') continue;
      const arr = map.get(wh.userId) || [];
      arr.push(wh);
      map.set(wh.userId, arr);
    }
    return map;
  }, [workHistory]);

  const activeDdoByOffice = useMemo(() => {
    const map = new Map<string, WorkHistoryDoc>();
    for (const wh of workHistory) {
      if (wh.status === 'active' && wh.role === 'ddo') {
        map.set(wh.officeId, wh);
      }
    }
    return map;
  }, [workHistory]);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) || null,
    [users, selectedUserId]
  );

  const selectedUserHistory = useMemo(() => {
    if (!selectedUser) return [];
    return workHistory
      .filter((w) => w.userId === selectedUser.id)
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
        return (b.startDate || '').localeCompare(a.startDate || '');
      });
  }, [workHistory, selectedUser]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const isSA = u.globalRole === 'superAdmin' || u.role === 'superAdmin';
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;

      if (officeFilter !== 'all') {
        const hasOffice =
          Boolean(u.access?.[officeFilter]) || u.homeOfficeId === officeFilter;
        if (!hasOffice) return false;
      }

      if (roleFilter === 'superAdmin' && !isSA) return false;
      if (roleFilter === 'ddo') {
        const hasDdo = Object.values(u.access || {}).some((r) => r === 'ddo') || u.role === 'ddo';
        if (!hasDdo) return false;
      }
      if (roleFilter === 'employee') {
        const hasEmp =
          Object.values(u.access || {}).some((r) => r === 'employee') || u.role === 'employee';
        if (!hasEmp) return false;
      }

      if (q) {
        const hay = [u.name, u.email, u.designation || '', u.phone || '']
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [users, search, officeFilter, roleFilter, statusFilter]);

  const openInviteModal = () => {
    setInvEmail('');
    setInvName('');
    setInvPhone('');
    setInvOfficeId(activeOffices[0]?.id || offices[0]?.id || '');
    setInvRole('employee');
    setInvKind('regular');
    setInvDesignation('');
    setInvOrderNo('');
    setInvOrderDate(todayYmd());
    setInviteOpen(true);
  };

  const openUserDetail = (u: UserDoc) => {
    setSelectedUserId(u.id);
    setActionTab('ddo');
    const defaultOff = activeOffices[0]?.id || offices[0]?.id || '';
    setActOfficeId(defaultOff);
    setActRole('employee');
    setActKind('regular');
    setActDesignation(u.designation || '');
    setActOrderNo('');
    setActOrderDate(todayYmd());
    setActRemarks('');
    setEndingWhId(null);
    setEditingWhId(null);
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorSnapshot) return;
    setSavingInvite(true);
    try {
      await createMultiOfficeInvite({
        email: invEmail,
        name: invName,
        phone: invPhone,
        officeId: invOfficeId,
        role: invRole,
        kind: invKind,
        designation: invDesignation,
        orderNo: invOrderNo,
        orderDate: invOrderDate,
        actor: actorSnapshot,
      });
      pushToast('success', `${invEmail.toLowerCase()}-এর জন্য আমন্ত্রণ তৈরি হয়েছে।`);
      setInviteOpen(false);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to invite user.');
    } finally {
      setSavingInvite(false);
    }
  };

  const handleRevokeInvite = async (inv: InviteDoc) => {
    if (!actorSnapshot) return;
    try {
      await revokeInvite(inv.id, actorSnapshot, inv.officeId || null);
      pushToast('success', `${inv.email}-এর আমন্ত্রণ বাতিল করা হয়েছে।`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to revoke invite.');
    }
  };

  const handlePostingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !actorSnapshot || !actOfficeId) return;
    setActing(true);
    try {
      if (actionTab === 'ddo') {
        await assignDdoTx({
          userId: selectedUser.id,
          targetOfficeId: actOfficeId,
          kind: actKind,
          designation: actDesignation || selectedUser.designation || 'DDO',
          orderNo: actOrderNo,
          orderDate: actOrderDate,
          remarks: actRemarks,
          actor: actorSnapshot,
        });
        pushToast('success', `${selectedUser.name}-কে DDO হিসেবে পদায়ন করা হয়েছে।`);
      } else if (actionTab === 'transfer') {
        await transferUserTx({
          userId: selectedUser.id,
          targetOfficeId: actOfficeId,
          role: actRole,
          designation: actDesignation || selectedUser.designation || '',
          orderNo: actOrderNo,
          orderDate: actOrderDate,
          remarks: actRemarks,
          actor: actorSnapshot,
        });
        pushToast('success', `${selectedUser.name}-এর বদলি সম্পন্ন হয়েছে।`);
      } else {
        await grantAdditionalChargeTx({
          userId: selectedUser.id,
          targetOfficeId: actOfficeId,
          role: actRole,
          designation: actDesignation || selectedUser.designation || '',
          orderNo: actOrderNo,
          orderDate: actOrderDate,
          remarks: actRemarks,
          actor: actorSnapshot,
        });
        pushToast('success', `${selectedUser.name}-কে অতিরিক্ত দায়িত্ব প্রদান করা হয়েছে।`);
      }
      setActOrderNo('');
      setActRemarks('');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setActing(false);
    }
  };

  const handleWithdrawCharge = async (wh: WorkHistoryDoc) => {
    if (!actorSnapshot) return;
    setActing(true);
    try {
      await withdrawAdditionalChargeTx({
        workHistoryId: wh.id,
        userId: wh.userId,
        actor: actorSnapshot,
      });
      pushToast('success', 'অতিরিক্ত দায়িত্ব প্রত্যাহার করা হয়েছে।');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to withdraw charge.');
    } finally {
      setActing(false);
    }
  };

  const handleEndRegularConfirm = async (wh: WorkHistoryDoc) => {
    if (!actorSnapshot) return;
    setActing(true);
    try {
      await endRegularPostingTx({
        workHistoryId: wh.id,
        userId: wh.userId,
        endReason,
        remarks: endRemarks,
        actor: actorSnapshot,
      });
      pushToast('success', 'নিয়মিত পদায়ন সমাপ্ত করা হয়েছে।');
      setEndingWhId(null);
      setEndRemarks('');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to end posting.');
    } finally {
      setActing(false);
    }
  };

  const handleSaveWhCorrection = async (wh: WorkHistoryDoc) => {
    if (!actorSnapshot) return;
    setActing(true);
    try {
      await correctWorkHistoryEntry({
        workHistoryId: wh.id,
        orderNo: editOrderNo,
        orderDate: editOrderDate,
        remarks: editRemarks,
        actor: actorSnapshot,
      });
      pushToast('success', 'কর্ম-ইতিহাস সংশোধন ও অডিট লগ সংরক্ষিত হয়েছে।');
      setEditingWhId(null);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to correct work history.');
    } finally {
      setActing(false);
    }
  };

  const handleToggleUserStatus = async (target: UserDoc) => {
    if (!actorSnapshot || !userDoc) return;
    if (target.id === userDoc.id) {
      pushToast('error', 'আপনি নিজের অ্যাকাউন্ট নিষ্ক্রিয় করতে পারবেন না।');
      return;
    }
    setActing(true);
    try {
      if (target.status === 'disabled') {
        await enableUserTx({ userId: target.id, actor: actorSnapshot });
        pushToast('success', `${target.name} সক্রিয় করা হয়েছে।`);
      } else {
        await disableUserTx({ userId: target.id, actor: actorSnapshot });
        pushToast('success', `${target.name} নিষ্ক্রিয় করা হয়েছে এবং সক্রিয় পদায়ন সমাপ্ত হয়েছে।`);
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Status update failed.');
    } finally {
      setActing(false);
    }
  };

  const currentDdoConflict = useMemo(() => {
    if (!actOfficeId) return null;
    const isAssigningDdo =
      actionTab === 'ddo' ||
      ((actionTab === 'transfer' || actionTab === 'additionalCharge') && actRole === 'ddo');
    if (!isAssigningDdo) return null;
    const existing = activeDdoByOffice.get(actOfficeId);
    if (!existing || existing.userId === selectedUser?.id) return null;
    return existing;
  }, [actOfficeId, actionTab, actRole, activeDdoByOffice, selectedUser?.id]);

  const actions = (
    <button
      type="button"
      onClick={openInviteModal}
      disabled={offices.length === 0}
      className="min-h-[44px] md:min-h-[40px] px-3.5 md:px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold whitespace-nowrap disabled:opacity-50"
    >
      + {t('newUser')}
    </button>
  );

  return (
    <Layout title={t('navUsers')} actions={actions}>
      <div className="space-y-4 md:space-y-5">
        {offices.length === 0 && (
          <div className="card-surface p-4 text-sm text-[var(--warn-text)] bg-[var(--warn-bg)]/40 border border-[var(--line)]">
            প্রথমে «কার্যালয়সমূহ» পেইজ থেকে অন্তত একটি কার্যালয় তৈরি করুন অথবা সেটিংস থেকে মাইগ্রেশন সম্পন্ন করুন।
          </div>
        )}

        {/* Filters */}
        <div className="card-surface p-3.5 md:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="নাম, ইমেইল, পদবি বা ফোন খুঁজুন…"
            className="min-h-[42px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
          />
          <select
            value={officeFilter}
            onChange={(e) => setOfficeFilter(e.target.value)}
            aria-label="Filter by office"
            className="min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
          >
            <option value="all">সকল কার্যালয়</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nameBn || o.name} ({o.code})
              </option>
            ))}
          </select>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label="Filter by role"
            className="min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
          >
            <option value="all">সকল ভূমিকা</option>
            <option value="superAdmin">Super Admin</option>
            <option value="ddo">DDO</option>
            <option value="employee">Employee</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'disabled')}
            aria-label="Filter by status"
            className="min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
          >
            <option value="all">সকল অবস্থা</option>
            <option value="active">{t('active')}</option>
            <option value="disabled">{t('disabled')}</option>
          </select>
        </div>

        {/* Users Table / Cards */}
        <div className="card-surface overflow-hidden">
          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-[var(--line)]">
            {loading ? (
              <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                ব্যবহারকারী লোড হচ্ছে…
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                {t('noDataFound')}
              </div>
            ) : (
              filteredUsers.map((u) => {
                const isSA = u.globalRole === 'superAdmin' || u.role === 'superAdmin';
                const postings = activePostingsByUser.get(u.id) || [];
                const homeOffice = u.homeOfficeId ? officesById.get(u.homeOfficeId) : null;
                return (
                  <div key={u.id} className="p-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[var(--text)] break-words">
                          {u.name}
                        </div>
                        {u.designation && (
                          <div className="text-xs text-[var(--muted)] mt-0.5 break-words">
                            {u.designation}
                          </div>
                        )}
                        <div className="text-xs text-[var(--muted)] mt-0.5 break-all">
                          {u.email}
                          {u.phone ? ` · ${u.phone}` : ''}
                        </div>
                      </div>
                      <StatusChip variant={u.status === 'active' ? 'active' : 'disabled'}>
                        {u.status === 'active' ? t('active') : t('disabled')}
                      </StatusChip>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {isSA ? (
                        <StatusChip variant="roleAccent">Super Admin</StatusChip>
                      ) : postings.length > 0 ? (
                        postings.map((p) => {
                          const off = officesById.get(p.officeId);
                          return (
                            <StatusChip
                              key={p.id}
                              variant={p.role === 'ddo' ? 'roleAccent' : 'roleNeutral'}
                            >
                              {off?.nameBn || off?.name || p.officeName || p.officeId} ·{' '}
                              {formatRoleLabel(p.role)}
                              {p.kind === 'additionalCharge' ? ' (অতিরিক্ত)' : ''}
                            </StatusChip>
                          );
                        })
                      ) : homeOffice ? (
                        <StatusChip variant="roleNeutral">
                          {homeOffice.nameBn || homeOffice.name}
                        </StatusChip>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">কোনো সক্রিয় পদায়ন নেই</span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => openUserDetail(u)}
                        className="flex-1 min-h-[42px] px-3 rounded-lg border border-[var(--line)] text-xs font-semibold hover:bg-[var(--surface-subtle)]"
                      >
                        পদায়ন ও ইতিহাস
                      </button>
                      {u.id !== userDoc?.id && !isSA && (
                        <button
                          type="button"
                          onClick={() => handleToggleUserStatus(u)}
                          disabled={acting}
                          className="min-h-[42px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium hover:bg-[var(--surface-subtle)]"
                        >
                          {u.status === 'disabled' ? 'Enable' : 'Disable'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                  <th className="sticky left-0 z-10 bg-[var(--card)] py-3 px-4 font-medium whitespace-nowrap">
                    নাম ও পদবি
                  </th>
                  <th className="py-3 px-4 font-medium whitespace-nowrap">ইমেইল / ফোন</th>
                  <th className="py-3 px-4 font-medium whitespace-nowrap">মূল কার্যালয়</th>
                  <th className="py-3 px-4 font-medium">সক্রিয় পদায়নসমূহ</th>
                  <th className="py-3 px-4 font-medium whitespace-nowrap">অবস্থা</th>
                  <th className="py-3 px-4 font-medium text-right whitespace-nowrap">কার্যক্রম</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                      ব্যবহারকারী লোড হচ্ছে…
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                      {t('noDataFound')}
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const isSA = u.globalRole === 'superAdmin' || u.role === 'superAdmin';
                    const postings = activePostingsByUser.get(u.id) || [];
                    const homeOffice = u.homeOfficeId ? officesById.get(u.homeOfficeId) : null;
                    return (
                      <tr key={u.id} className="group hover:bg-[var(--surface-subtle)] transition-colors">
                        <td className="sticky left-0 z-10 bg-[var(--card)] group-hover:bg-[var(--surface-subtle)] py-3 px-4 transition-colors">
                          <div className="font-medium text-[var(--text)]">{u.name}</div>
                          {u.designation && (
                            <div className="text-xs text-[var(--muted)]">{u.designation}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-[var(--muted)]">
                          <div className="text-xs">{u.email}</div>
                          {u.phone && <div className="text-xs">{u.phone}</div>}
                        </td>
                        <td className="py-3 px-4 text-xs text-[var(--text)]">
                          {isSA ? (
                            <StatusChip variant="roleAccent">Super Admin (গ্লোবাল)</StatusChip>
                          ) : homeOffice ? (
                            <span className="bn">{homeOffice.nameBn || homeOffice.name}</span>
                          ) : (
                            <span className="text-[var(--muted)]">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {isSA ? (
                            <span className="text-xs text-[var(--muted)]">সকল কার্যালয় (পঠনযোগ্য)</span>
                          ) : postings.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {postings.map((p) => {
                                const off = officesById.get(p.officeId);
                                return (
                                  <StatusChip
                                    key={p.id}
                                    variant={p.role === 'ddo' ? 'roleAccent' : 'roleNeutral'}
                                  >
                                    {off?.nameBn || off?.name || p.officeName || p.officeId} ·{' '}
                                    {formatRoleLabel(p.role)}
                                    {p.kind === 'additionalCharge' ? ' (অতিরিক্ত)' : ''}
                                  </StatusChip>
                                );
                              })}
                            </div>
                          ) : Object.keys(u.access || {}).length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {Object.entries(u.access || {}).map(([offId, r]) => {
                                const off = officesById.get(offId);
                                return (
                                  <StatusChip
                                    key={offId}
                                    variant={r === 'ddo' ? 'roleAccent' : 'roleNeutral'}
                                  >
                                    {off?.nameBn || off?.name || offId} · {formatRoleLabel(r)}
                                  </StatusChip>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-xs text-[var(--muted)]">কোনো সক্রিয় পদায়ন নেই</span>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <StatusChip variant={u.status === 'active' ? 'active' : 'disabled'}>
                            {u.status === 'active' ? t('active') : t('disabled')}
                          </StatusChip>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                          <button
                            type="button"
                            onClick={() => openUserDetail(u)}
                            className="min-h-[34px] px-3 rounded-lg border border-[var(--line)] text-xs font-semibold hover:bg-[var(--surface-subtle)]"
                          >
                            {isSA ? 'তথ্য' : 'পদায়ন / বদলি'}
                          </button>
                          {u.id !== userDoc?.id && !isSA && (
                            <button
                              type="button"
                              onClick={() => handleToggleUserStatus(u)}
                              disabled={acting}
                              className="min-h-[34px] px-3 rounded-lg border border-[var(--line)] text-xs font-medium hover:bg-[var(--surface-subtle)]"
                            >
                              {u.status === 'disabled' ? 'Enable' : 'Disable'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pending Invites */}
        {invites.length > 0 && (
          <section className="card-surface overflow-hidden">
            <div className="px-4 md:px-5 py-3.5 border-b border-[var(--line)] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text)]">
                অপেক্ষমান আমন্ত্রণসমূহ ({invites.length})
              </h2>
            </div>
            <div className="divide-y divide-[var(--line)]">
              {invites.map((inv) => {
                const off = inv.officeId ? officesById.get(inv.officeId) : null;
                return (
                  <div
                    key={inv.id}
                    className="p-3.5 md:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--text)]">
                          {inv.name || inv.email.split('@')[0]}
                        </span>
                        <StatusChip variant="invited">{t('invited')}</StatusChip>
                        <StatusChip variant={inv.role === 'ddo' ? 'roleAccent' : 'roleNeutral'}>
                          {formatRoleLabel(inv.role)}
                          {inv.kind === 'additionalCharge' ? ' (অতিরিক্ত)' : ''}
                        </StatusChip>
                      </div>
                      <div className="text-xs text-[var(--muted)] break-all">
                        {inv.email}
                        {inv.designation ? ` · ${inv.designation}` : ''}
                        {off ? ` · ${off.nameBn || off.name}` : ''}
                        {inv.orderNo ? ` · আদেশ নং: ${inv.orderNo}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevokeInvite(inv)}
                      className="min-h-[38px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40 shrink-0 self-start sm:self-center"
                    >
                      আমন্ত্রণ বাতিল
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* Invite User Modal */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="নতুন ব্যবহারকারী আমন্ত্রণ"
        subtitle="প্রথমবার সাইন-ইন করার সাথে সাথেই ব্যবহারকারী নির্ধারিত কার্যালয়ে পদায়ন পাবেন।"
        maxWidthClass="md:max-w-lg"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setInviteOpen(false)}
              className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="invite-user-form"
              disabled={savingInvite}
              className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
            >
              {savingInvite ? 'পাঠানো হচ্ছে…' : 'আমন্ত্রণ পাঠান'}
            </button>
          </div>
        }
      >
        <form id="invite-user-form" onSubmit={handleInviteSubmit} className="space-y-4">
          <div>
            <label htmlFor="inv-email" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
              ইমেইল ঠিকানা *
            </label>
            <input
              id="inv-email"
              type="email"
              required
              value={invEmail}
              onChange={(e) => setInvEmail(e.target.value)}
              placeholder="officer@office.gov.bd"
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label htmlFor="inv-name" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                নাম (ঐচ্ছিক)
              </label>
              <input
                id="inv-name"
                type="text"
                value={invName}
                onChange={(e) => setInvName(e.target.value)}
                placeholder="পূর্ণ নাম"
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
              />
            </div>
            <div>
              <label htmlFor="inv-phone" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                ফোন নম্বর (ঐচ্ছিক)
              </label>
              <input
                id="inv-phone"
                type="text"
                value={invPhone}
                onChange={(e) => setInvPhone(e.target.value)}
                placeholder="01XXXXXXXXX"
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="inv-office" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
              কার্যালয় *
            </label>
            <select
              id="inv-office"
              required
              value={invOfficeId}
              onChange={(e) => setInvOfficeId(e.target.value)}
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
            >
              {offices.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nameBn || o.name} ({o.code})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label htmlFor="inv-role" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                ভূমিকা *
              </label>
              <select
                id="inv-role"
                value={invRole}
                onChange={(e) => setInvRole(e.target.value as OfficeRole)}
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
              >
                <option value="employee">Employee</option>
                <option value="ddo">DDO</option>
              </select>
            </div>
            <div>
              <label htmlFor="inv-kind" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                পদায়নের ধরন *
              </label>
              <select
                id="inv-kind"
                value={invKind}
                onChange={(e) => setInvKind(e.target.value as PostingKind)}
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
              >
                <option value="regular">নিয়মিত (Regular)</option>
                <option value="additionalCharge">অতিরিক্ত দায়িত্ব (Additional Charge)</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="inv-desig" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
              পদবি *
            </label>
            <input
              id="inv-desig"
              type="text"
              required
              value={invDesignation}
              onChange={(e) => setInvDesignation(e.target.value)}
              placeholder="উপজেলা নির্বাহী অফিসার / হিসাবরক্ষক"
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label htmlFor="inv-order-no" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                আদেশ নং (ঐচ্ছিক)
              </label>
              <input
                id="inv-order-no"
                type="text"
                value={invOrderNo}
                onChange={(e) => setInvOrderNo(e.target.value)}
                placeholder="পদায়ন / বদলি আদেশ নং"
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
              />
            </div>
            <div>
              <label htmlFor="inv-order-date" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                আদেশের তারিখ
              </label>
              <input
                id="inv-order-date"
                type="date"
                value={invOrderDate}
                onChange={(e) => setInvOrderDate(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
              />
            </div>
          </div>
        </form>
      </Modal>

      {/* User Detail, Postings & Work History Modal */}
      <Modal
        open={Boolean(selectedUser)}
        onClose={() => setSelectedUserId(null)}
        title={selectedUser ? `${selectedUser.name}` : ''}
        subtitle={
          selectedUser
            ? `${selectedUser.email}${selectedUser.designation ? ` · ${selectedUser.designation}` : ''}`
            : ''
        }
        maxWidthClass="md:max-w-3xl"
      >
        {selectedUser && (
          <div className="space-y-5">
            {/* Account Header Strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-[var(--surface-subtle)] border border-[var(--line)]">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusChip variant={selectedUser.status === 'active' ? 'active' : 'disabled'}>
                  {selectedUser.status === 'active' ? t('active') : t('disabled')}
                </StatusChip>
                {selectedUser.globalRole === 'superAdmin' && (
                  <StatusChip variant="roleAccent">Super Admin</StatusChip>
                )}
                {selectedUser.phone && (
                  <span className="text-[var(--muted)]">ফোন: {selectedUser.phone}</span>
                )}
              </div>
              {selectedUser.id !== userDoc?.id &&
                selectedUser.globalRole !== 'superAdmin' && (
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => handleToggleUserStatus(selectedUser)}
                    className="min-h-[36px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs font-medium hover:bg-[var(--surface-subtle)]"
                  >
                    {selectedUser.status === 'disabled'
                      ? 'অ্যাকাউন্ট সক্রিয় করুন'
                      : 'অ্যাকাউন্ট নিষ্ক্রিয় করুন'}
                  </button>
                )}
            </div>

            {/* Posting Actions for non-SuperAdmin active users */}
            {selectedUser.globalRole !== 'superAdmin' &&
              selectedUser.status === 'active' &&
              offices.length > 0 && (
                <div className="border border-[var(--line)] rounded-xl p-4 space-y-3.5">
                  <div className="flex flex-wrap gap-1.5 border-b border-[var(--line)] pb-2.5">
                    <button
                      type="button"
                      onClick={() => setActionTab('ddo')}
                      className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors ${
                        actionTab === 'ddo'
                          ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                          : 'bg-[var(--surface-subtle)] text-[var(--text)]'
                      }`}
                    >
                      DDO পদায়ন / হস্তান্তর
                    </button>
                    <button
                      type="button"
                      onClick={() => setActionTab('transfer')}
                      className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors ${
                        actionTab === 'transfer'
                          ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                          : 'bg-[var(--surface-subtle)] text-[var(--text)]'
                      }`}
                    >
                      বদলি (Transfer)
                    </button>
                    <button
                      type="button"
                      onClick={() => setActionTab('additionalCharge')}
                      className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors ${
                        actionTab === 'additionalCharge'
                          ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                          : 'bg-[var(--surface-subtle)] text-[var(--text)]'
                      }`}
                    >
                      অতিরিক্ত দায়িত্ব (Additional Charge)
                    </button>
                  </div>

                  {currentDdoConflict && (
                    <div className="p-3 rounded-lg bg-[var(--warn-bg)] text-[var(--warn-text)] text-xs font-medium">
                      সতর্কতা: এই কার্যালয়ে বর্তমানে <strong>{currentDdoConflict.userName}</strong>{' '}
                      সক্রিয় DDO হিসেবে দায়িত্বরত আছেন। নতুন DDO পদায়ন করলে একই লেনদেনে পূর্বের DDO-এর পদায়ন সমাপ্ত (Handover) হয়ে যাবে।
                    </div>
                  )}

                  <form onSubmit={handlePostingSubmit} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                          লক্ষ্য কার্যালয় *
                        </label>
                        <select
                          required
                          value={actOfficeId}
                          onChange={(e) => setActOfficeId(e.target.value)}
                          className="w-full min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
                        >
                          {offices.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.nameBn || o.name} ({o.code})
                            </option>
                          ))}
                        </select>
                      </div>

                      {actionTab === 'ddo' ? (
                        <div>
                          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                            পদায়নের ধরন *
                          </label>
                          <select
                            value={actKind}
                            onChange={(e) => setActKind(e.target.value as PostingKind)}
                            className="w-full min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
                          >
                            <option value="regular">নিয়মিত (Regular)</option>
                            <option value="additionalCharge">অতিরিক্ত দায়িত্ব (Additional Charge)</option>
                          </select>
                        </div>
                      ) : (
                        <div>
                          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                            ভূমিকা *
                          </label>
                          <select
                            value={actRole}
                            onChange={(e) => setActRole(e.target.value as OfficeRole)}
                            className="w-full min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
                          >
                            <option value="employee">Employee</option>
                            <option value="ddo">DDO</option>
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                          পদবি *
                        </label>
                        <input
                          type="text"
                          required
                          value={actDesignation}
                          onChange={(e) => setActDesignation(e.target.value)}
                          placeholder="পদবি"
                          className="w-full min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                          আদেশ নং *
                        </label>
                        <input
                          type="text"
                          required
                          value={actOrderNo}
                          onChange={(e) => setActOrderNo(e.target.value)}
                          placeholder="অফিস আদেশ নং"
                          className="w-full min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                          আদেশের তারিখ *
                        </label>
                        <input
                          type="date"
                          required
                          value={actOrderDate}
                          onChange={(e) => setActOrderDate(e.target.value)}
                          className="w-full min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                        মন্তব্য (ঐচ্ছিক)
                      </label>
                      <input
                        type="text"
                        value={actRemarks}
                        onChange={(e) => setActRemarks(e.target.value)}
                        placeholder="প্রয়োজনে মন্তব্য লিখুন"
                        className="w-full min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
                      />
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={acting}
                        className="min-h-[40px] px-4 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-xs font-semibold disabled:opacity-60"
                      >
                        {acting
                          ? 'সংরক্ষণ হচ্ছে…'
                          : actionTab === 'ddo'
                            ? 'DDO পদায়ন নিশ্চিত করুন'
                            : actionTab === 'transfer'
                              ? 'বদলি সম্পন্ন করুন'
                              : 'অতিরিক্ত দায়িত্ব দিন'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

            {/* Work History Timeline */}
            <div className="space-y-2.5">
              <h3 className="text-sm font-semibold text-[var(--text)]">
                কর্ম-ইতিহাস ({selectedUserHistory.length})
              </h3>
              {selectedUserHistory.length === 0 ? (
                <p className="text-xs text-[var(--muted)] py-3">
                  এখনো কোনো পদায়ন ইতিহাস নথিভুক্ত নেই।
                </p>
              ) : (
                <div className="space-y-2.5">
                  {selectedUserHistory.map((wh) => {
                    const off = officesById.get(wh.officeId);
                    const offName = off?.nameBn || off?.name || wh.officeName || wh.officeId;
                    const isEditingThis = editingWhId === wh.id;
                    const isEndingThis = endingWhId === wh.id;

                    return (
                      <div
                        key={wh.id}
                        className={`p-3 rounded-lg border ${
                          wh.status === 'active'
                            ? 'border-[var(--accent)]/40 bg-[var(--accent-soft)]/25'
                            : 'border-[var(--line)] bg-[var(--card)]'
                        } space-y-2`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="space-y-0.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-semibold text-[var(--text)] bn">
                                {offName}
                              </span>
                              <StatusChip variant={wh.role === 'ddo' ? 'roleAccent' : 'roleNeutral'}>
                                {formatRoleLabel(wh.role)}
                              </StatusChip>
                              <StatusChip variant={wh.status === 'active' ? 'active' : 'roleNeutral'}>
                                {wh.kind === 'additionalCharge' ? 'অতিরিক্ত দায়িত্ব' : 'নিয়মিত'}
                              </StatusChip>
                              <StatusChip variant={wh.status === 'active' ? 'approved' : 'roleNeutral'}>
                                {wh.status === 'active' ? 'সক্রিয়' : 'সমাপ্ত'}
                              </StatusChip>
                            </div>
                            <div className="text-xs text-[var(--muted)]">
                              পদবি: {wh.designation} · শুরু: {formatDateDisplay(wh.startDate)}
                              {wh.endDate ? ` · সমাপ্তি: ${formatDateDisplay(wh.endDate)}` : ''}
                              {wh.endReason ? ` (${wh.endReason})` : ''}
                            </div>
                            {(wh.orderNo || wh.remarks) && (
                              <div className="text-xs text-[var(--muted)]">
                                {wh.orderNo ? `আদেশ: ${wh.orderNo}` : ''}
                                {wh.orderDate ? ` (${formatDateDisplay(wh.orderDate)})` : ''}
                                {wh.remarks ? ` · ${wh.remarks}` : ''}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            {wh.status === 'active' && wh.kind === 'additionalCharge' && (
                              <button
                                type="button"
                                disabled={acting}
                                onClick={() => handleWithdrawCharge(wh)}
                                className="min-h-[32px] px-2.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs font-medium text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40"
                              >
                                দায়িত্ব প্রত্যাহার
                              </button>
                            )}
                            {wh.status === 'active' && wh.kind === 'regular' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEndingWhId(isEndingThis ? null : wh.id);
                                  setEndReason('retired');
                                  setEndRemarks('');
                                }}
                                className="min-h-[32px] px-2.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs font-medium hover:bg-[var(--surface-subtle)]"
                              >
                                পদায়ন সমাপ্ত
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                if (isEditingThis) {
                                  setEditingWhId(null);
                                } else {
                                  setEditingWhId(wh.id);
                                  setEditOrderNo(wh.orderNo || '');
                                  setEditOrderDate(wh.orderDate || '');
                                  setEditRemarks(wh.remarks || '');
                                }
                              }}
                              className="min-h-[32px] px-2.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs font-medium hover:bg-[var(--surface-subtle)]"
                            >
                              সংশোধন
                            </button>
                          </div>
                        </div>

                        {isEndingThis && (
                          <div className="pt-2 border-t border-[var(--line)] flex flex-wrap items-end gap-2">
                            <div>
                              <label className="block text-[11px] text-[var(--muted)] mb-1">কারণ</label>
                              <select
                                value={endReason}
                                onChange={(e) => setEndReason(e.target.value as WorkHistoryEndReason)}
                                className="min-h-[34px] px-2.5 rounded border border-[var(--line)] bg-[var(--card)] text-xs"
                              >
                                <option value="retired">অবসর (retired)</option>
                                <option value="relieved">অব্যাহতি (relieved)</option>
                                <option value="transferred">বদলি (transferred)</option>
                                <option value="other">অন্যান্য (other)</option>
                              </select>
                            </div>
                            <div className="flex-1 min-w-[160px]">
                              <label className="block text-[11px] text-[var(--muted)] mb-1">মন্তব্য</label>
                              <input
                                type="text"
                                value={endRemarks}
                                onChange={(e) => setEndRemarks(e.target.value)}
                                className="w-full min-h-[34px] px-2.5 rounded border border-[var(--line)] bg-[var(--card)] text-xs"
                              />
                            </div>
                            <button
                              type="button"
                              disabled={acting}
                              onClick={() => handleEndRegularConfirm(wh)}
                              className="min-h-[34px] px-3 rounded bg-[var(--danger-text)] text-white text-xs font-semibold"
                            >
                              নিশ্চিত
                            </button>
                          </div>
                        )}

                        {isEditingThis && (
                          <div className="pt-2 border-t border-[var(--line)] grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input
                              type="text"
                              value={editOrderNo}
                              onChange={(e) => setEditOrderNo(e.target.value)}
                              placeholder="আদেশ নং"
                              className="min-h-[34px] px-2.5 rounded border border-[var(--line)] bg-[var(--card)] text-xs"
                            />
                            <input
                              type="date"
                              value={editOrderDate}
                              onChange={(e) => setEditOrderDate(e.target.value)}
                              className="min-h-[34px] px-2.5 rounded border border-[var(--line)] bg-[var(--card)] text-xs"
                            />
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                value={editRemarks}
                                onChange={(e) => setEditRemarks(e.target.value)}
                                placeholder="সংশোধনের মন্তব্য"
                                className="flex-1 min-h-[34px] px-2.5 rounded border border-[var(--line)] bg-[var(--card)] text-xs"
                              />
                              <button
                                type="button"
                                disabled={acting}
                                onClick={() => handleSaveWhCorrection(wh)}
                                className="min-h-[34px] px-3 rounded bg-[var(--accent)] text-[var(--on-accent)] text-xs font-semibold"
                              >
                                সংরক্ষণ
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
