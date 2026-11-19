import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Edit2, Mail, Plus, Trash2, UserCheck, UserMinus } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { StatusChip } from '../components/StatusChip';
import { useApp } from '../contexts/AppContext';
import { useActiveUsers } from '../hooks/useActiveUsers';
import { useOfficeWorkHistory } from '../hooks/useWorkHistory';
import { formatDateDisplay, todayYmd } from '../lib/dates';
import {
  createMultiOfficeInvite,
  endRegularPostingTx,
  revokeInvite,
  updateStaffDesignationTx,
} from '../lib/officeOps';
import { formatRoleLabel } from '../lib/permissions';
import { db } from '../lib/firebase';
import type { InviteDoc, WorkHistoryDoc, WorkHistoryEndReason } from '../types';

export function StaffPage() {
  const { currentOfficeId, currentOffice, actorSnapshot, pushToast, t } = useApp();
  const { users } = useActiveUsers(currentOfficeId);
  const { records: officePostings, loading } = useOfficeWorkHistory(currentOfficeId);

  const [invites, setInvites] = useState<InviteDoc[]>([]);
  useEffect(() => {
    if (!currentOfficeId || currentOfficeId === 'ALL' || currentOfficeId === '__LEGACY__') {
      setInvites([]);
      return;
    }
    const q = query(collection(db, 'invites'), where('officeId', '==', currentOfficeId));
    const unsub = onSnapshot(q, (snap) => {
      setInvites(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InviteDoc)));
    });
    return () => unsub();
  }, [currentOfficeId]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [invEmail, setInvEmail] = useState('');
  const [invName, setInvName] = useState('');
  const [invDesig, setInvDesig] = useState('');
  const [invPhone, setInvPhone] = useState('');
  const [invOrderNo, setInvOrderNo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [editTarget, setEditTarget] = useState<WorkHistoryDoc | null>(null);
  const [editDesig, setEditDesig] = useState('');
  const [editPhone, setEditPhone] = useState('');

  const [endTarget, setEndTarget] = useState<WorkHistoryDoc | null>(null);
  const [endReason, setEndReason] = useState<WorkHistoryEndReason>('relieved');
  const [endRemarks, setEndRemarks] = useState('');

  const usersById = useMemo(() => {
    const map = new Map<string, (typeof users)[number]>();
    for (const u of users) map.set(u.id, u);
    return map;
  }, [users]);

  const activeRegularStaff = useMemo(
    () =>
      officePostings.filter(
        (wh) => wh.status === 'active' && wh.role === 'employee' && wh.kind === 'regular'
      ),
    [officePostings]
  );

  const additionalChargeHolders = useMemo(
    () =>
      officePostings.filter(
        (wh) => wh.status === 'active' && wh.kind === 'additionalCharge'
      ),
    [officePostings]
  );

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorSnapshot || !currentOfficeId) return;
    setSubmitting(true);
    try {
      await createMultiOfficeInvite({
        email: invEmail,
        name: invName,
        phone: invPhone,
        officeId: currentOfficeId,
        role: 'employee',
        kind: 'regular',
        designation: invDesig,
        orderNo: invOrderNo,
        orderDate: todayYmd(),
        actor: actorSnapshot,
      });
      pushToast('success', 'কর্মচারী আমন্ত্রণ পাঠানো হয়েছে।');
      setInviteOpen(false);
      setInvEmail('');
      setInvName('');
      setInvDesig('');
      setInvPhone('');
      setInvOrderNo('');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'আমন্ত্রণ তৈরি করা যায়নি।');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorSnapshot || !editTarget) return;
    setSubmitting(true);
    try {
      await updateStaffDesignationTx({
        userId: editTarget.userId,
        designation: editDesig,
        phone: editPhone,
        workHistoryId: editTarget.id,
        actor: actorSnapshot,
      });
      pushToast('success', 'কর্মচারীর পদবী ও তথ্য আপডেট হয়েছে।');
      setEditTarget(null);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'আপডেট ব্যর্থ হয়েছে।');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEndPosting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorSnapshot || !endTarget) return;
    setSubmitting(true);
    try {
      await endRegularPostingTx({
        workHistoryId: endTarget.id,
        userId: endTarget.userId,
        endReason,
        remarks: endRemarks,
        actor: actorSnapshot,
      });
      pushToast('success', 'কর্মচারীর পদায়ন সমাপ্ত করা হয়েছে।');
      setEndTarget(null);
      setEndRemarks('');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'পদায়ন সমাপ্ত করা যায়নি।');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeInvite = async (email: string) => {
    if (!actorSnapshot) return;
    try {
      await revokeInvite(email, actorSnapshot, currentOfficeId);
      pushToast('info', 'আমন্ত্রণ বাতিল করা হয়েছে।');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'আমন্ত্রণ বাতিল করা যায়নি।');
    }
  };

  const headerActions = (
    <button
      type="button"
      onClick={() => setInviteOpen(true)}
      className="min-h-[44px] md:min-h-[40px] px-3.5 md:px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
    >
      <Plus className="w-4 h-4" />
      <span>+ কর্মচারী আমন্ত্রণ</span>
    </button>
  );

  return (
    <Layout title={t('navStaff')} actions={headerActions}>
      <div className="space-y-4">
        <div className="px-3.5 py-2.5 rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)] text-xs text-[var(--muted)]">
          অফিস:{' '}
          <strong className="text-[var(--text)]">
            {currentOffice ? currentOffice.nameBn || currentOffice.name : '—'}
          </strong>{' '}
          · আপনি এই অফিসের নিয়মিত কর্মচারী যুক্ত ও পরিচালনা করতে পারবেন। অতিরিক্ত দায়িত্বপ্রাপ্ত কর্মকর্তাগণ শুধু দেখার জন্য তালিকাভুক্ত থাকেন।
        </div>

        {/* Regular Employees */}
        <div className="card-surface overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--line)] flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-[var(--accent)]" />
              <span>নিয়মিত কর্মচারী ({activeRegularStaff.length})</span>
            </h2>
          </div>

          {loading ? (
            <div className="p-6 text-center text-sm text-[var(--muted)]">লোড হচ্ছে…</div>
          ) : activeRegularStaff.length === 0 ? (
            <div className="p-6 text-center text-sm text-[var(--muted)]">
              এই অফিসে কোনো নিয়মিত কর্মচারী নেই।
            </div>
          ) : (
            <div className="divide-y divide-[var(--line)]">
              {activeRegularStaff.map((wh) => {
                const u = usersById.get(wh.userId);
                return (
                  <div
                    key={wh.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="font-semibold text-sm text-[var(--text)]">{wh.userName}</div>
                      <div className="text-xs text-[var(--muted)]">
                        {wh.designation} · {u?.email || '—'}
                        {u?.phone ? ` · ${u.phone}` : ''}
                      </div>
                      <div className="text-[11px] text-[var(--muted)] tabular-nums">
                        যোগদান: {formatDateDisplay(wh.startDate)} · আদেশ: {wh.orderNo || '—'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditTarget(wh);
                          setEditDesig(wh.designation);
                          setEditPhone(u?.phone || '');
                        }}
                        className="min-h-[38px] px-3 rounded-lg border border-[var(--line)] text-xs font-medium inline-flex items-center gap-1"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>{t('edit')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEndTarget(wh);
                          setEndReason('relieved');
                          setEndRemarks('');
                        }}
                        className="min-h-[38px] px-3 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--danger-text)] inline-flex items-center gap-1"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                        <span>অব্যাহতি</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Additional Charge Holders (Read-only) */}
        {additionalChargeHolders.length > 0 && (
          <div className="card-surface overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--line)]">
              <h2 className="text-sm font-semibold">
                অতিরিক্ত দায়িত্বপ্রাপ্ত কর্মকর্তা (Read-only · {additionalChargeHolders.length})
              </h2>
            </div>
            <div className="divide-y divide-[var(--line)]">
              {additionalChargeHolders.map((wh) => (
                <div key={wh.id} className="p-4 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="font-semibold text-sm text-[var(--text)]">{wh.userName}</div>
                    <div className="text-[var(--muted)]">
                      {wh.designation} · {formatRoleLabel(wh.role)} (অতিরিক্ত দায়িত্ব)
                    </div>
                  </div>
                  <div className="text-[var(--muted)] tabular-nums">
                    {formatDateDisplay(wh.startDate)} থেকে
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pending Office Invites */}
        {invites.length > 0 && (
          <div className="card-surface overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--line)]">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Mail className="w-4 h-4 text-[var(--accent)]" />
                <span>অপেক্ষমান আমন্ত্রণ ({invites.length})</span>
              </h2>
            </div>
            <div className="divide-y divide-[var(--line)]">
              {invites.map((inv) => (
                <div key={inv.id} className="p-4 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="font-semibold text-[var(--text)]">{inv.email}</div>
                    <div className="text-[var(--muted)]">
                      {inv.name ? `${inv.name} · ` : ''}
                      {inv.designation} · <StatusChip variant="invited">{inv.role}</StatusChip>
                    </div>
                  </div>
                  {inv.role === 'employee' && inv.kind === 'regular' && (
                    <button
                      type="button"
                      onClick={() => handleRevokeInvite(inv.id)}
                      className="min-h-[36px] px-2.5 rounded-lg border border-[var(--line)] text-[var(--danger-text)] inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>বাতিল</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Invite Regular Employee Modal */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="নতুন কর্মচারী আমন্ত্রণ (নিয়মিত)"
        subtitle={currentOffice ? currentOffice.nameBn || currentOffice.name : undefined}
        fullScreenOnMobile
        footer={
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setInviteOpen(false)}
              className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="ddo-invite-form"
              disabled={submitting}
              className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
            >
              {submitting ? 'পাঠানো হচ্ছে…' : 'আমন্ত্রণ পাঠান'}
            </button>
          </div>
        }
      >
        <form id="ddo-invite-form" onSubmit={handleInviteSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Email *</label>
            <input
              type="email"
              required
              value={invEmail}
              onChange={(e) => setInvEmail(e.target.value)}
              placeholder="staff@example.com"
              className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Name</label>
            <input
              type="text"
              value={invName}
              onChange={(e) => setInvName(e.target.value)}
              placeholder="নাম"
              className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                Designation *
              </label>
              <input
                type="text"
                required
                value={invDesig}
                onChange={(e) => setInvDesig(e.target.value)}
                placeholder="হিসাবরক্ষক / উচ্চমান সহকারী"
                className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--muted)] mb-1">Phone</label>
              <input
                type="tel"
                value={invPhone}
                onChange={(e) => setInvPhone(e.target.value)}
                placeholder="017XXXXXXXX"
                className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">
              যোগদান / আদেশ নং
            </label>
            <input
              type="text"
              value={invOrderNo}
              onChange={(e) => setInvOrderNo(e.target.value)}
              placeholder="Order No (ঐচ্ছিক)"
              className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
            />
          </div>
        </form>
      </Modal>

      {/* Edit Staff Modal */}
      <Modal
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        title="কর্মচারীর তথ্য সংশোধন"
        subtitle={editTarget?.userName}
        footer={
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setEditTarget(null)}
              className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="ddo-edit-staff-form"
              disabled={submitting}
              className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold"
            >
              {t('save')}
            </button>
          </div>
        }
      >
        <form id="ddo-edit-staff-form" onSubmit={handleSaveEdit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">
              Designation *
            </label>
            <input
              type="text"
              required
              value={editDesig}
              onChange={(e) => setEditDesig(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Phone</label>
            <input
              type="tel"
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
            />
          </div>
        </form>
      </Modal>

      {/* End Posting Modal */}
      <Modal
        open={Boolean(endTarget)}
        onClose={() => setEndTarget(null)}
        title="কর্মচারীর পদায়ন সমাপ্ত করুন"
        subtitle={endTarget?.userName}
        footer={
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setEndTarget(null)}
              className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="ddo-end-posting-form"
              disabled={submitting}
              className="min-h-[44px] px-5 rounded-lg bg-[var(--danger-text)] text-white text-sm font-semibold"
            >
              পদায়ন সমাপ্ত করুন
            </button>
          </div>
        }
      >
        <form id="ddo-end-posting-form" onSubmit={handleEndPosting} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">কারণ *</label>
            <select
              value={endReason}
              onChange={(e) => setEndReason(e.target.value as WorkHistoryEndReason)}
              className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
            >
              <option value="relieved">Relieved (অব্যাহতি)</option>
              <option value="transferred">Transferred (বদলি)</option>
              <option value="retired">Retired (অবসর)</option>
              <option value="other">Other (অন্যান্য)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">মন্তব্য</label>
            <input
              type="text"
              value={endRemarks}
              onChange={(e) => setEndRemarks(e.target.value)}
              placeholder="আদেশ নং বা মন্তব্য"
              className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
            />
          </div>
        </form>
      </Modal>
    </Layout>
  );
}
