import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Modal, ModalFooter } from '../components/Modal';
import {
  Banner,
  Field,
  Section,
  Segmented,
  Select,
  TextInput,
  focusFirstInvalidField,
} from '../components/form';
import { PageHeader } from '../components/PageHeader';
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
  const [inviteErrors, setInviteErrors] = useState<{
    email?: string;
    officeId?: string;
    designation?: string;
  }>({});
  const inviteFormRef = useRef<HTMLFormElement>(null);
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
  const [postingErrors, setPostingErrors] = useState<{
    officeId?: string;
    designation?: string;
    orderNo?: string;
    orderDate?: string;
  }>({});
  const postingFormRef = useRef<HTMLFormElement>(null);
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
    setInviteErrors({});
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
    setPostingErrors({});
    setEndingWhId(null);
    setEditingWhId(null);
  };

  const isInviteDirty = Boolean(
    invEmail.trim() || invName.trim() || invPhone.trim() || invDesignation.trim() || invOrderNo.trim()
  );

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorSnapshot) return;

    const nextErrors: { email?: string; officeId?: string; designation?: string } = {};
    const emailTrimmed = invEmail.trim();
    if (!emailTrimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      nextErrors.email = 'সঠিক ইমেইল ঠিকানা লিখুন।';
    }
    if (!invOfficeId) {
      nextErrors.officeId = 'কার্যালয় নির্বাচন করুন।';
    }
    if (!invDesignation.trim()) {
      nextErrors.designation = 'পদবি আবশ্যক।';
    }
    if (Object.keys(nextErrors).length > 0) {
      setInviteErrors(nextErrors);
      window.requestAnimationFrame(() => focusFirstInvalidField(inviteFormRef.current));
      return;
    }

    setInviteErrors({});
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
    if (!selectedUser || !actorSnapshot) return;

    const nextErrors: {
      officeId?: string;
      designation?: string;
      orderNo?: string;
      orderDate?: string;
    } = {};
    if (!actOfficeId) nextErrors.officeId = 'লক্ষ্য কার্যালয় নির্বাচন করুন।';
    if (!actDesignation.trim()) nextErrors.designation = 'পদবি আবশ্যক।';
    if (!actOrderNo.trim()) nextErrors.orderNo = 'আদেশ নং আবশ্যক।';
    if (!actOrderDate) nextErrors.orderDate = 'আদেশের তারিখ আবশ্যক।';

    if (Object.keys(nextErrors).length > 0) {
      setPostingErrors(nextErrors);
      window.requestAnimationFrame(() => focusFirstInvalidField(postingFormRef.current));
      return;
    }

    setPostingErrors({});
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
    <Layout title={t('navUsers')}>
      <PageHeader title={t('navUsers')} actions={actions} />
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
          <Select
            variant="compact"
            modalTitle="কার্যালয় ফিল্টার"
            value={officeFilter}
            onChange={(e) => setOfficeFilter(e.target.value)}
            aria-label="Filter by office"
            options={[
              { value: 'all', label: 'সকল কার্যালয়' },
              ...offices.map((o) => ({
                value: o.id,
                label: o.nameBn || o.name,
                subtitle: `কোড: ${o.code}`,
                keywords: `${o.name} ${o.nameBn} ${o.code}`,
              })),
            ]}
          />
          <Select
            variant="compact"
            modalTitle="ভূমিকা ফিল্টার"
            searchable={false}
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label="Filter by role"
          >
            <option value="all">সকল ভূমিকা</option>
            <option value="superAdmin">Super Admin</option>
            <option value="ddo">DDO</option>
            <option value="employee">Employee</option>
          </Select>
          <Select
            variant="compact"
            modalTitle="অবস্থা ফিল্টার"
            searchable={false}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'disabled')}
            aria-label="Filter by status"
          >
            <option value="all">সকল অবস্থা</option>
            <option value="active">{t('active')}</option>
            <option value="disabled">{t('disabled')}</option>
          </Select>
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
        onClose={() => !savingInvite && setInviteOpen(false)}
        title="নতুন ব্যবহারকারী আমন্ত্রণ"
        subtitle="প্রথমবার সাইন-ইন করার সাথে সাথেই ব্যবহারকারী নির্ধারিত কার্যালয়ে পদায়ন পাবেন।"
        size="md"
        fullScreenOnMobile
        confirmClose={isInviteDirty && !savingInvite}
        footer={
          <ModalFooter
            loading={savingInvite}
            secondary={{
              label: t('cancel'),
              onClick: () => setInviteOpen(false),
              disabled: savingInvite,
            }}
            primary={{
              label: savingInvite ? 'পাঠানো হচ্ছে…' : 'আমন্ত্রণ পাঠান',
              type: 'submit',
              form: 'invite-user-form',
            }}
          />
        }
      >
        <form
          ref={inviteFormRef}
          id="invite-user-form"
          onSubmit={handleInviteSubmit}
          noValidate
          className="space-y-4"
        >
          <Field
            label="ইমেইল ঠিকানা"
            htmlFor="inv-email"
            required
            error={inviteErrors.email}
          >
            <TextInput
              id="inv-email"
              type="email"
              required
              value={invEmail}
              onChange={(e) => {
                setInvEmail(e.target.value);
                if (inviteErrors.email) {
                  setInviteErrors((prev) => ({ ...prev, email: undefined }));
                }
              }}
              placeholder="officer@office.gov.bd"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Field label="নাম (ঐচ্ছিক)" htmlFor="inv-name">
              <TextInput
                id="inv-name"
                type="text"
                value={invName}
                onChange={(e) => setInvName(e.target.value)}
                placeholder="পূর্ণ নাম"
                className="bn"
              />
            </Field>
            <Field label="ফোন নম্বর (ঐচ্ছিক)" htmlFor="inv-phone">
              <TextInput
                id="inv-phone"
                type="tel"
                value={invPhone}
                onChange={(e) => setInvPhone(e.target.value)}
                placeholder="01XXXXXXXXX"
              />
            </Field>
          </div>

          <Field
            label="কার্যালয়"
            htmlFor="inv-office"
            required
            error={inviteErrors.officeId}
          >
            <Select
              id="inv-office"
              required
              value={invOfficeId}
              onChange={(e) => {
                setInvOfficeId(e.target.value);
                if (inviteErrors.officeId) {
                  setInviteErrors((prev) => ({ ...prev, officeId: undefined }));
                }
              }}
            >
              {offices.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nameBn || o.name} ({o.code})
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Field label="ভূমিকা" htmlFor="inv-role" required>
              <Select
                id="inv-role"
                value={invRole}
                onChange={(e) => setInvRole(e.target.value as OfficeRole)}
              >
                <option value="employee">Employee</option>
                <option value="ddo">DDO</option>
              </Select>
            </Field>
            <Field label="পদায়নের ধরন" htmlFor="inv-kind" required>
              <Select
                id="inv-kind"
                value={invKind}
                onChange={(e) => setInvKind(e.target.value as PostingKind)}
              >
                <option value="regular">নিয়মিত (Regular)</option>
                <option value="additionalCharge">অতিরিক্ত দায়িত্ব (Additional Charge)</option>
              </Select>
            </Field>
          </div>

          <Field
            label="পদবি"
            htmlFor="inv-desig"
            required
            error={inviteErrors.designation}
          >
            <TextInput
              id="inv-desig"
              type="text"
              required
              value={invDesignation}
              onChange={(e) => {
                setInvDesignation(e.target.value);
                if (inviteErrors.designation) {
                  setInviteErrors((prev) => ({ ...prev, designation: undefined }));
                }
              }}
              placeholder="উপজেলা নির্বাহী অফিসার / হিসাবরক্ষক"
              className="bn"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Field label="আদেশ নং (ঐচ্ছিক)" htmlFor="inv-order-no">
              <TextInput
                id="inv-order-no"
                type="text"
                value={invOrderNo}
                onChange={(e) => setInvOrderNo(e.target.value)}
                placeholder="পদায়ন / বদলি আদেশ নং"
              />
            </Field>
            <Field label="আদেশের তারিখ" htmlFor="inv-order-date">
              <TextInput
                id="inv-order-date"
                type="date"
                value={invOrderDate}
                onChange={(e) => setInvOrderDate(e.target.value)}
                className="tabular-nums"
              />
            </Field>
          </div>
        </form>
      </Modal>

      {/* User Detail, Postings & Work History Modal */}
      <Modal
        open={Boolean(selectedUser)}
        onClose={() => !acting && setSelectedUserId(null)}
        title={selectedUser ? `${selectedUser.name}` : ''}
        subtitle={
          selectedUser
            ? `${selectedUser.email}${selectedUser.designation ? ` · ${selectedUser.designation}` : ''}`
            : ''
        }
        size="lg"
        fullScreenOnMobile
      >
        {selectedUser && (
          <div className="space-y-4">
            {/* Account Header Strip */}
            <Section>
              <div className="flex flex-wrap items-center justify-between gap-2.5">
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
                      className="min-h-[44px] px-3.5 rounded-xl border border-[var(--border-strong)] bg-[var(--card)] text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    >
                      {selectedUser.status === 'disabled'
                        ? 'অ্যাকাউন্ট সক্রিয় করুন'
                        : 'অ্যাকাউন্ট নিষ্ক্রিয় করুন'}
                    </button>
                  )}
              </div>
            </Section>

            {/* Posting Actions for non-SuperAdmin active users */}
            {selectedUser.globalRole !== 'superAdmin' &&
              selectedUser.status === 'active' &&
              offices.length > 0 && (
                <Section title="পদায়ন ও বদলি">
                  <Segmented
                    ariaLabel="পদায়ন কার্যক্রম"
                    fullWidth={false}
                    className="w-full"
                    value={actionTab}
                    onChange={(tab) => {
                      setActionTab(tab);
                      setPostingErrors({});
                    }}
                    options={[
                      { value: 'ddo', label: 'DDO পদায়ন / হস্তান্তর' },
                      { value: 'transfer', label: 'বদলি (Transfer)' },
                      { value: 'additionalCharge', label: 'অতিরিক্ত দায়িত্ব (Additional Charge)' },
                    ]}
                  />

                  {currentDdoConflict && (
                    <Banner variant="warn">
                      সতর্কতা: এই কার্যালয়ে বর্তমানে <strong>{currentDdoConflict.userName}</strong>{' '}
                      সক্রিয় DDO হিসেবে দায়িত্বরত আছেন। নতুন DDO পদায়ন করলে একই লেনদেনে পূর্বের DDO-এর পদায়ন সমাপ্ত (Handover) হয়ে যাবে।
                    </Banner>
                  )}

                  <form
                    ref={postingFormRef}
                    onSubmit={handlePostingSubmit}
                    noValidate
                    className="space-y-3.5"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <Field
                        label="লক্ষ্য কার্যালয়"
                        htmlFor="user-act-office"
                        required
                        error={postingErrors.officeId}
                      >
                        <Select
                          id="user-act-office"
                          required
                          value={actOfficeId}
                          onChange={(e) => {
                            setActOfficeId(e.target.value);
                            if (postingErrors.officeId) {
                              setPostingErrors((prev) => ({ ...prev, officeId: undefined }));
                            }
                          }}
                        >
                          {offices.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.nameBn || o.name} ({o.code})
                            </option>
                          ))}
                        </Select>
                      </Field>

                      {actionTab === 'ddo' ? (
                        <Field label="পদায়নের ধরন" htmlFor="user-act-kind" required>
                          <Select
                            id="user-act-kind"
                            value={actKind}
                            onChange={(e) => setActKind(e.target.value as PostingKind)}
                          >
                            <option value="regular">নিয়মিত (Regular)</option>
                            <option value="additionalCharge">অতিরিক্ত দায়িত্ব (Additional Charge)</option>
                          </Select>
                        </Field>
                      ) : (
                        <Field label="ভূমিকা" htmlFor="user-act-role" required>
                          <Select
                            id="user-act-role"
                            value={actRole}
                            onChange={(e) => setActRole(e.target.value as OfficeRole)}
                          >
                            <option value="employee">Employee</option>
                            <option value="ddo">DDO</option>
                          </Select>
                        </Field>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                      <Field
                        label="পদবি"
                        htmlFor="user-act-desig"
                        required
                        error={postingErrors.designation}
                      >
                        <TextInput
                          id="user-act-desig"
                          type="text"
                          required
                          value={actDesignation}
                          onChange={(e) => {
                            setActDesignation(e.target.value);
                            if (postingErrors.designation) {
                              setPostingErrors((prev) => ({ ...prev, designation: undefined }));
                            }
                          }}
                          placeholder="পদবি"
                          className="bn"
                        />
                      </Field>
                      <Field
                        label="আদেশ নং"
                        htmlFor="user-act-order-no"
                        required
                        error={postingErrors.orderNo}
                      >
                        <TextInput
                          id="user-act-order-no"
                          type="text"
                          required
                          value={actOrderNo}
                          onChange={(e) => {
                            setActOrderNo(e.target.value);
                            if (postingErrors.orderNo) {
                              setPostingErrors((prev) => ({ ...prev, orderNo: undefined }));
                            }
                          }}
                          placeholder="অফিস আদেশ নং"
                        />
                      </Field>
                      <Field
                        label="আদেশের তারিখ"
                        htmlFor="user-act-order-date"
                        required
                        error={postingErrors.orderDate}
                      >
                        <TextInput
                          id="user-act-order-date"
                          type="date"
                          required
                          value={actOrderDate}
                          onChange={(e) => {
                            setActOrderDate(e.target.value);
                            if (postingErrors.orderDate) {
                              setPostingErrors((prev) => ({ ...prev, orderDate: undefined }));
                            }
                          }}
                          className="tabular-nums"
                        />
                      </Field>
                    </div>

                    <Field label="মন্তব্য (ঐচ্ছিক)" htmlFor="user-act-remarks">
                      <TextInput
                        id="user-act-remarks"
                        type="text"
                        value={actRemarks}
                        onChange={(e) => setActRemarks(e.target.value)}
                        placeholder="প্রয়োজনে মন্তব্য লিখুন"
                        className="bn"
                      />
                    </Field>

                    <div className="flex justify-end pt-1">
                      <button
                        type="submit"
                        disabled={acting}
                        className="w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                      >
                        {acting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                        <span>
                          {acting
                            ? 'সংরক্ষণ হচ্ছে…'
                            : actionTab === 'ddo'
                              ? 'DDO পদায়ন নিশ্চিত করুন'
                              : actionTab === 'transfer'
                                ? 'বদলি সম্পন্ন করুন'
                                : 'অতিরিক্ত দায়িত্ব দিন'}
                        </span>
                      </button>
                    </div>
                  </form>
                </Section>
              )}

            {/* Work History Timeline */}
            <Section title={`কর্ম-ইতিহাস (${selectedUserHistory.length})`}>
              {selectedUserHistory.length === 0 ? (
                <p className="text-xs text-[var(--muted)] py-2">
                  এখনো কোনো পদায়ন ইতিহাস নথিভুক্ত নেই।
                </p>
              ) : (
                <div className="space-y-3">
                  {selectedUserHistory.map((wh) => {
                    const off = officesById.get(wh.officeId);
                    const offName = off?.nameBn || off?.name || wh.officeName || wh.officeId;
                    const isEditingThis = editingWhId === wh.id;
                    const isEndingThis = endingWhId === wh.id;

                    return (
                      <div
                        key={wh.id}
                        className={`p-3.5 rounded-xl border ${
                          wh.status === 'active'
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                            : 'border-[var(--line)] bg-[var(--card)]'
                        } space-y-2.5`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2.5">
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-semibold text-[var(--text)] bn break-words">
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
                            <div className="text-xs text-[var(--muted)] break-words">
                              পদবি: {wh.designation} · শুরু: {formatDateDisplay(wh.startDate)}
                              {wh.endDate ? ` · সমাপ্তি: ${formatDateDisplay(wh.endDate)}` : ''}
                              {wh.endReason ? ` (${wh.endReason})` : ''}
                            </div>
                            {(wh.orderNo || wh.remarks) && (
                              <div className="text-xs text-[var(--muted)] break-words">
                                {wh.orderNo ? `আদেশ: ${wh.orderNo}` : ''}
                                {wh.orderDate ? ` (${formatDateDisplay(wh.orderDate)})` : ''}
                                {wh.remarks ? ` · ${wh.remarks}` : ''}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {wh.status === 'active' && wh.kind === 'additionalCharge' && (
                              <button
                                type="button"
                                disabled={acting}
                                onClick={() => handleWithdrawCharge(wh)}
                                className="min-h-[44px] px-3 rounded-xl border border-[var(--border-strong)] bg-[var(--card)] text-xs font-semibold text-[var(--danger-text)] hover:bg-[var(--danger-bg)] transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
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
                                className="min-h-[44px] px-3 rounded-xl border border-[var(--border-strong)] bg-[var(--card)] text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
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
                              className="min-h-[44px] px-3 rounded-xl border border-[var(--border-strong)] bg-[var(--card)] text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                            >
                              সংশোধন
                            </button>
                          </div>
                        </div>

                        {isEndingThis && (
                          <div className="pt-3 border-t border-[var(--line)] grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                            <div className="sm:col-span-4">
                              <Field label="কারণ" htmlFor={`wh-end-reason-${wh.id}`}>
                                <Select
                                  id={`wh-end-reason-${wh.id}`}
                                  value={endReason}
                                  onChange={(e) => setEndReason(e.target.value as WorkHistoryEndReason)}
                                >
                                  <option value="retired">অবসর (retired)</option>
                                  <option value="relieved">অব্যাহতি (relieved)</option>
                                  <option value="transferred">বদলি (transferred)</option>
                                  <option value="other">অন্যান্য (other)</option>
                                </Select>
                              </Field>
                            </div>
                            <div className="sm:col-span-5">
                              <Field label="মন্তব্য" htmlFor={`wh-end-remarks-${wh.id}`}>
                                <TextInput
                                  id={`wh-end-remarks-${wh.id}`}
                                  type="text"
                                  value={endRemarks}
                                  onChange={(e) => setEndRemarks(e.target.value)}
                                  placeholder="আদেশ নং বা মন্তব্য"
                                  className="bn"
                                />
                              </Field>
                            </div>
                            <div className="sm:col-span-3">
                              <button
                                type="button"
                                disabled={acting}
                                onClick={() => handleEndRegularConfirm(wh)}
                                className="w-full min-h-[48px] px-4 rounded-xl bg-[var(--danger-solid)] text-[var(--on-danger)] hover:opacity-90 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-opacity disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                              >
                                {acting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                                <span>নিশ্চিত</span>
                              </button>
                            </div>
                          </div>
                        )}

                        {isEditingThis && (
                          <div className="pt-3 border-t border-[var(--line)] space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <Field label="আদেশ নং" htmlFor={`wh-edit-order-${wh.id}`}>
                                <TextInput
                                  id={`wh-edit-order-${wh.id}`}
                                  type="text"
                                  value={editOrderNo}
                                  onChange={(e) => setEditOrderNo(e.target.value)}
                                  placeholder="আদেশ নং"
                                />
                              </Field>
                              <Field label="আদেশের তারিখ" htmlFor={`wh-edit-date-${wh.id}`}>
                                <TextInput
                                  id={`wh-edit-date-${wh.id}`}
                                  type="date"
                                  value={editOrderDate}
                                  onChange={(e) => setEditOrderDate(e.target.value)}
                                  className="tabular-nums"
                                />
                              </Field>
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                              <div className="flex-1 min-w-0">
                                <Field label="সংশোধনের মন্তব্য" htmlFor={`wh-edit-remarks-${wh.id}`}>
                                  <TextInput
                                    id={`wh-edit-remarks-${wh.id}`}
                                    type="text"
                                    value={editRemarks}
                                    onChange={(e) => setEditRemarks(e.target.value)}
                                    placeholder="সংশোধনের মন্তব্য"
                                    className="bn"
                                  />
                                </Field>
                              </div>
                              <button
                                type="button"
                                disabled={acting}
                                onClick={() => handleSaveWhCorrection(wh)}
                                className="min-h-[48px] px-5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center justify-center gap-2 shrink-0 transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                              >
                                {acting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                                <span>সংরক্ষণ</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
