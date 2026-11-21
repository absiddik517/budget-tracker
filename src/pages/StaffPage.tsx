import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Edit2, Mail, Plus, Trash2, UserCheck, UserMinus } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Modal, ModalFooter } from '../components/Modal';
import {
  Banner,
  Field,
  OptionCardList,
  TextInput,
  focusFirstInvalidField,
} from '../components/form';
import { PageHeader } from '../components/PageHeader';
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
  const [inviteErrors, setInviteErrors] = useState<{ email?: string; designation?: string }>({});
  const inviteFormRef = useRef<HTMLFormElement>(null);
  const [submitting, setSubmitting] = useState(false);

  const [editTarget, setEditTarget] = useState<WorkHistoryDoc | null>(null);
  const [editDesig, setEditDesig] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editErrors, setEditErrors] = useState<{ designation?: string }>({});
  const editFormRef = useRef<HTMLFormElement>(null);

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

  const isInviteDirty = Boolean(
    invEmail.trim() || invName.trim() || invDesig.trim() || invPhone.trim() || invOrderNo.trim()
  );

  const isEditDirty = Boolean(
    editTarget &&
      (editDesig !== editTarget.designation ||
        editPhone !== (usersById.get(editTarget.userId)?.phone || ''))
  );

  const isEndDirty = Boolean(endTarget && (endRemarks.trim() !== '' || endReason !== 'relieved'));

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorSnapshot || !currentOfficeId) return;

    const nextErrors: { email?: string; designation?: string } = {};
    const emailTrimmed = invEmail.trim();
    if (!emailTrimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      nextErrors.email = 'সঠিক ইমেইল ঠিকানা লিখুন।';
    }
    if (!invDesig.trim()) {
      nextErrors.designation = 'পদবী আবশ্যক।';
    }
    if (Object.keys(nextErrors).length > 0) {
      setInviteErrors(nextErrors);
      window.requestAnimationFrame(() => focusFirstInvalidField(inviteFormRef.current));
      return;
    }

    setInviteErrors({});
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

    if (!editDesig.trim()) {
      setEditErrors({ designation: 'পদবী আবশ্যক।' });
      window.requestAnimationFrame(() => focusFirstInvalidField(editFormRef.current));
      return;
    }

    setEditErrors({});
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
      onClick={() => {
        setInviteErrors({});
        setInviteOpen(true);
      }}
      className="min-h-[44px] md:min-h-[40px] px-3.5 md:px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
    >
      <Plus className="w-4 h-4" />
      <span>+ কর্মচারী আমন্ত্রণ</span>
    </button>
  );

  return (
    <Layout title={t('navStaff')}>
      <PageHeader title={t('navStaff')} actions={headerActions} />
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
                          setEditErrors({});
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
        onClose={() => !submitting && setInviteOpen(false)}
        title="নতুন কর্মচারী আমন্ত্রণ (নিয়মিত)"
        subtitle={currentOffice ? currentOffice.nameBn || currentOffice.name : undefined}
        size="md"
        fullScreenOnMobile
        confirmClose={isInviteDirty && !submitting}
        footer={
          <ModalFooter
            loading={submitting}
            secondary={{
              label: t('cancel'),
              onClick: () => setInviteOpen(false),
              disabled: submitting,
            }}
            primary={{
              label: submitting ? 'পাঠানো হচ্ছে…' : 'আমন্ত্রণ পাঠান',
              type: 'submit',
              form: 'ddo-invite-form',
            }}
          />
        }
      >
        <form
          ref={inviteFormRef}
          id="ddo-invite-form"
          onSubmit={handleInviteSubmit}
          noValidate
          className="space-y-4"
        >
          <Field
            label="Email"
            htmlFor="staff-inv-email"
            required
            error={inviteErrors.email}
          >
            <TextInput
              id="staff-inv-email"
              type="email"
              required
              value={invEmail}
              onChange={(e) => {
                setInvEmail(e.target.value);
                if (inviteErrors.email) {
                  setInviteErrors((prev) => ({ ...prev, email: undefined }));
                }
              }}
              placeholder="staff@example.com"
            />
          </Field>

          <Field label="Name" htmlFor="staff-inv-name">
            <TextInput
              id="staff-inv-name"
              type="text"
              value={invName}
              onChange={(e) => setInvName(e.target.value)}
              placeholder="নাম"
              className="bn"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Field
              label="Designation"
              htmlFor="staff-inv-desig"
              required
              error={inviteErrors.designation}
            >
              <TextInput
                id="staff-inv-desig"
                type="text"
                required
                value={invDesig}
                onChange={(e) => {
                  setInvDesig(e.target.value);
                  if (inviteErrors.designation) {
                    setInviteErrors((prev) => ({ ...prev, designation: undefined }));
                  }
                }}
                placeholder="হিসাবরক্ষক / উচ্চমান সহকারী"
                className="bn"
              />
            </Field>
            <Field label="Phone" htmlFor="staff-inv-phone">
              <TextInput
                id="staff-inv-phone"
                type="tel"
                value={invPhone}
                onChange={(e) => setInvPhone(e.target.value)}
                placeholder="017XXXXXXXX"
              />
            </Field>
          </div>

          <Field label="যোগদান / আদেশ নং" htmlFor="staff-inv-order-no">
            <TextInput
              id="staff-inv-order-no"
              type="text"
              value={invOrderNo}
              onChange={(e) => setInvOrderNo(e.target.value)}
              placeholder="Order No (ঐচ্ছিক)"
            />
          </Field>
        </form>
      </Modal>

      {/* Edit Staff Modal */}
      <Modal
        open={Boolean(editTarget)}
        onClose={() => !submitting && setEditTarget(null)}
        title="কর্মচারীর তথ্য সংশোধন"
        subtitle={editTarget?.userName}
        size="sm"
        confirmClose={isEditDirty && !submitting}
        footer={
          <ModalFooter
            loading={submitting}
            secondary={{
              label: t('cancel'),
              onClick: () => setEditTarget(null),
              disabled: submitting,
            }}
            primary={{
              label: submitting ? 'সংরক্ষণ হচ্ছে…' : t('save'),
              type: 'submit',
              form: 'ddo-edit-staff-form',
            }}
          />
        }
      >
        <form
          ref={editFormRef}
          id="ddo-edit-staff-form"
          onSubmit={handleSaveEdit}
          noValidate
          className="space-y-4"
        >
          <Field
            label="Designation"
            htmlFor="staff-edit-desig"
            required
            error={editErrors.designation}
          >
            <TextInput
              id="staff-edit-desig"
              type="text"
              required
              value={editDesig}
              onChange={(e) => {
                setEditDesig(e.target.value);
                if (editErrors.designation) {
                  setEditErrors((prev) => ({ ...prev, designation: undefined }));
                }
              }}
              className="bn"
            />
          </Field>
          <Field label="Phone" htmlFor="staff-edit-phone">
            <TextInput
              id="staff-edit-phone"
              type="tel"
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
            />
          </Field>
        </form>
      </Modal>

      {/* End Posting Modal */}
      <Modal
        open={Boolean(endTarget)}
        onClose={() => !submitting && setEndTarget(null)}
        title="কর্মচারীর পদায়ন সমাপ্ত করুন"
        subtitle={endTarget?.userName}
        size="sm"
        confirmClose={isEndDirty && !submitting}
        footer={
          <ModalFooter
            danger
            loading={submitting}
            secondary={{
              label: t('cancel'),
              onClick: () => setEndTarget(null),
              disabled: submitting,
            }}
            primary={{
              label: submitting ? 'সমাপ্ত করা হচ্ছে…' : 'পদায়ন সমাপ্ত করুন',
              type: 'submit',
              form: 'ddo-end-posting-form',
            }}
          />
        }
      >
        <form
          id="ddo-end-posting-form"
          onSubmit={handleEndPosting}
          noValidate
          className="space-y-4"
        >
          <Banner variant="warn">
            পদায়ন সমাপ্ত করলে এই অফিসে কর্মচারীর প্রবেশাধিকার অবিলম্বে বন্ধ হয়ে যাবে।
          </Banner>

          <Field label="কারণ" labelAs="span" required>
            <OptionCardList
              ariaLabel="পদায়ন সমাপ্তির কারণ"
              value={endReason}
              onChange={(val) => setEndReason(val)}
              options={[
                { value: 'relieved', title: 'Relieved (অব্যাহতি)' },
                { value: 'transferred', title: 'Transferred (বদলি)' },
                { value: 'retired', title: 'Retired (অবসর)' },
                { value: 'other', title: 'Other (অন্যান্য)' },
              ]}
            />
          </Field>

          <Field label="মন্তব্য" htmlFor="staff-end-remarks">
            <TextInput
              id="staff-end-remarks"
              type="text"
              value={endRemarks}
              onChange={(e) => setEndRemarks(e.target.value)}
              placeholder="আদেশ নং বা মন্তব্য"
              className="bn"
            />
          </Field>
        </form>
      </Modal>
    </Layout>
  );
}
