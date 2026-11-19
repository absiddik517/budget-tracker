import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  Building2,
  Edit2,
  Eye,
  Plus,
  Power,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { StatusChip } from '../components/StatusChip';
import { useApp } from '../contexts/AppContext';
import { useAllWorkHistory } from '../hooks/useWorkHistory';
import { formatDateDisplay } from '../lib/dates';
import { getCurrentFiscalYear } from '../lib/fy';
import { createOffice, setOfficeStatus, updateOffice } from '../lib/officeOps';
import { formatRoleLabel } from '../lib/permissions';
import { db } from '../lib/firebase';
import type { OfficeDoc, UserDoc } from '../types';

export function OfficesPage() {
  const { offices, actorSnapshot, setCurrentOfficeId, pushToast, t } = useApp();
  const { records: allPostings } = useAllWorkHistory(true);
  const navigate = useNavigate();

  const [allUsers, setAllUsers] = useState<UserDoc[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      setAllUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as UserDoc)));
    });
    return () => unsub();
  }, []);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editingOffice, setEditingOffice] = useState<OfficeDoc | null>(null);
  const [name, setName] = useState('');
  const [nameBn, setNameBn] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [activeFy, setActiveFy] = useState(getCurrentFiscalYear());
  const [fiscalYearsStr, setFiscalYearsStr] = useState('2024-25, 2025-26, 2026-27');
  const [ministryName, setMinistryName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [detailOffice, setDetailOffice] = useState<OfficeDoc | null>(null);

  const usersById = useMemo(() => {
    const map = new Map<string, UserDoc>();
    for (const u of allUsers) map.set(u.id, u);
    return map;
  }, [allUsers]);

  const activePostingsByOffice = useMemo(() => {
    const map = new Map<string, typeof allPostings>();
    for (const wh of allPostings) {
      if (wh.status !== 'active') continue;
      const list = map.get(wh.officeId) || [];
      list.push(wh);
      map.set(wh.officeId, list);
    }
    return map;
  }, [allPostings]);

  const filteredOffices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return offices.filter((o) => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (!q) return true;
      return (
        o.name.toLowerCase().includes(q) ||
        (o.nameBn || '').toLowerCase().includes(q) ||
        o.code.toLowerCase().includes(q) ||
        (o.address || '').toLowerCase().includes(q)
      );
    });
  }, [offices, statusFilter, search]);

  const openCreateModal = () => {
    setEditingOffice(null);
    setName('');
    setNameBn('');
    setCode('');
    setAddress('');
    const fy = getCurrentFiscalYear();
    setActiveFy(fy);
    setFiscalYearsStr(`2024-25, ${fy}, 2026-27`);
    setMinistryName('');
    setFormOpen(true);
  };

  const openEditModal = (office: OfficeDoc) => {
    setEditingOffice(office);
    setName(office.name);
    setNameBn(office.nameBn || office.name);
    setCode(office.code);
    setAddress(office.address || '');
    setActiveFy(office.activeFiscalYear);
    setFiscalYearsStr((office.fiscalYears || [office.activeFiscalYear]).join(', '));
    setMinistryName(office.ministryName || '');
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorSnapshot) return;

    const fiscalYears = Array.from(
      new Set([
        activeFy.trim(),
        ...fiscalYearsStr
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ])
    ).filter(Boolean);

    setSubmitting(true);
    try {
      if (editingOffice) {
        await updateOffice(
          editingOffice.id,
          {
            name,
            nameBn: nameBn || name,
            code,
            address,
            activeFiscalYear: activeFy.trim(),
            fiscalYears,
            ministryName: ministryName.trim(),
          },
          actorSnapshot
        );
        pushToast('success', 'অফিসের তথ্য আপডেট হয়েছে।');
      } else {
        await createOffice(
          {
            name,
            nameBn: nameBn || name,
            code,
            address,
            activeFiscalYear: activeFy.trim(),
            fiscalYears,
            ministryName: ministryName.trim(),
          },
          actorSnapshot
        );
        pushToast('success', 'নতুন অফিস তৈরি হয়েছে।');
      }
      setFormOpen(false);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'সংরক্ষণ করা যায়নি।');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (office: OfficeDoc) => {
    if (!actorSnapshot) return;
    const next = office.status === 'active' ? 'inactive' : 'active';
    try {
      await setOfficeStatus(office.id, next, actorSnapshot);
      pushToast('success', `${office.nameBn || office.name} ${next === 'active' ? 'সক্রিয়' : 'নিষ্ক্রিয়'} করা হয়েছে।`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'অবস্থা পরিবর্তন করা যায়নি।');
    }
  };

  const handleOpenOfficeView = (officeId: string) => {
    setCurrentOfficeId(officeId);
    navigate('/');
  };

  const detailPostings = useMemo(() => {
    if (!detailOffice) return [];
    return allPostings.filter((wh) => wh.officeId === detailOffice.id);
  }, [detailOffice, allPostings]);

  const headerActions = (
    <button
      type="button"
      onClick={openCreateModal}
      className="min-h-[44px] md:min-h-[40px] px-3.5 md:px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
    >
      <Plus className="w-4 h-4" />
      <span>{t('newOffice')}</span>
    </button>
  );

  return (
    <Layout title={t('navOffices')} actions={headerActions}>
      <div className="space-y-4">
        {/* Filters */}
        <div className="card-surface p-3.5 flex flex-col sm:flex-row gap-2.5 sm:items-center justify-between">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="অফিসের নাম, কোড বা ঠিকানা খুঁজুন…"
            className="w-full sm:max-w-xs min-h-[44px] md:min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-sm"
          />
          <div className="inline-flex p-1 rounded-lg bg-[var(--surface-subtle)] border border-[var(--line)] self-start sm:self-auto">
            {(['all', 'active', 'inactive'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`min-h-[34px] px-3 rounded-md text-xs font-semibold transition-colors ${
                  statusFilter === st
                    ? 'bg-[var(--card)] text-[var(--text)] shadow-sm'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                {t(st)}
              </button>
            ))}
          </div>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden space-y-2.5">
          {filteredOffices.length === 0 ? (
            <div className="card-surface p-6 text-center text-sm text-[var(--muted)]">
              {t('noDataFound')}
            </div>
          ) : (
            filteredOffices.map((off) => {
              const activeWh = activePostingsByOffice.get(off.id) || [];
              const ddoWh = activeWh.find((p) => p.role === 'ddo');
              const empCount = activeWh.filter((p) => p.role === 'employee').length;
              return (
                <div key={off.id} className="card-surface p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-[var(--text)] bn">
                        {off.nameBn || off.name}
                      </div>
                      <div className="text-xs text-[var(--muted)]">
                        Code: <span className="font-mono font-medium">{off.code}</span> · FY{' '}
                        {off.activeFiscalYear}
                      </div>
                    </div>
                    <StatusChip variant={off.status === 'active' ? 'active' : 'disabled'}>
                      {t(off.status)}
                    </StatusChip>
                  </div>

                  <div className="text-xs space-y-1 text-[var(--muted)]">
                    <div>
                      DDO:{' '}
                      <span className="font-medium text-[var(--text)]">
                        {ddoWh
                          ? `${ddoWh.userName}${ddoWh.kind === 'additionalCharge' ? ' (Addl. Charge)' : ''}`
                          : 'অনির্ধারিত'}
                      </span>
                    </div>
                    <div>
                      কর্মচারী: <span className="font-medium text-[var(--text)]">{empCount}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1 border-t border-[var(--line)]/60">
                    <button
                      type="button"
                      onClick={() => handleOpenOfficeView(off.id)}
                      className="min-h-[38px] px-3 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] text-xs font-semibold inline-flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>দেখুন</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailOffice(off)}
                      className="min-h-[38px] px-3 rounded-lg border border-[var(--line)] text-xs font-medium inline-flex items-center gap-1"
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>পদায়ন</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditModal(off)}
                      className="min-h-[38px] px-3 rounded-lg border border-[var(--line)] text-xs font-medium inline-flex items-center gap-1"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>{t('edit')}</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block card-surface overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                <th className="py-3 px-4 font-medium">অফিস</th>
                <th className="py-3 px-4 font-medium">কোড</th>
                <th className="py-3 px-4 font-medium">বর্তমান DDO</th>
                <th className="py-3 px-4 font-medium">কর্মচারী</th>
                <th className="py-3 px-4 font-medium">চলতি FY</th>
                <th className="py-3 px-4 font-medium">অবস্থা</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {filteredOffices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                    {t('noDataFound')}
                  </td>
                </tr>
              ) : (
                filteredOffices.map((off) => {
                  const activeWh = activePostingsByOffice.get(off.id) || [];
                  const ddoWh = activeWh.find((p) => p.role === 'ddo');
                  const empCount = activeWh.filter((p) => p.role === 'employee').length;
                  return (
                    <tr key={off.id} className="hover:bg-[var(--surface-subtle)]/50">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[var(--text)] bn">
                          {off.nameBn || off.name}
                        </div>
                        {off.nameBn && off.name !== off.nameBn && (
                          <div className="text-xs text-[var(--muted)]">{off.name}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs">{off.code}</td>
                      <td className="py-3 px-4 text-xs">
                        {ddoWh ? (
                          <div>
                            <div className="font-medium text-[var(--text)]">{ddoWh.userName}</div>
                            <div className="text-[var(--muted)]">
                              {ddoWh.kind === 'additionalCharge' ? 'অতিরিক্ত দায়িত্ব' : 'নিয়মিত'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[var(--warning-text)]">অনির্ধারিত</span>
                        )}
                      </td>
                      <td className="py-3 px-4 tabular-nums">{empCount}</td>
                      <td className="py-3 px-4 tabular-nums">{off.activeFiscalYear}</td>
                      <td className="py-3 px-4">
                        <StatusChip variant={off.status === 'active' ? 'active' : 'disabled'}>
                          {t(off.status)}
                        </StatusChip>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenOfficeView(off.id)}
                          className="min-h-[34px] px-2.5 rounded-md bg-[var(--accent-soft)] text-[var(--accent)] text-xs font-semibold inline-flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>অফিস দেখুন</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDetailOffice(off)}
                          className="min-h-[34px] px-2.5 rounded-md border border-[var(--line)] text-xs font-medium"
                        >
                          বিস্তারিত
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(off)}
                          className="min-h-[34px] px-2.5 rounded-md border border-[var(--line)] text-xs font-medium"
                        >
                          {t('edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(off)}
                          className="min-h-[34px] px-2.5 rounded-md border border-[var(--line)] text-xs font-medium"
                          title={off.status === 'active' ? 'Deactivate' : 'Activate'}
                        >
                          <Power className="w-3.5 h-3.5 inline" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Office Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingOffice ? 'অফিস সম্পাদনা' : 'নতুন অফিস তৈরি করুন'}
        fullScreenOnMobile
        footer={
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="office-form"
              disabled={submitting}
              className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
            >
              {submitting ? 'সংরক্ষণ হচ্ছে…' : t('save')}
            </button>
          </div>
        }
      >
        <form id="office-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                Office Name (English) *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="District Primary Education Office, Mymensingh"
                className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                অফিসের নাম (বাংলা) *
              </label>
              <input
                type="text"
                required
                value={nameBn}
                onChange={(e) => setNameBn(e.target.value)}
                placeholder="জেলা উপানুষ্ঠানিক শিক্ষা ব্যুরো, ময়মনসিংহ"
                className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm bn"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                Office Code (Unique) *
              </label>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="OFF-MYM-01"
                className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                চলতি অর্থবছর *
              </label>
              <input
                type="text"
                required
                value={activeFy}
                onChange={(e) => setActiveFy(e.target.value)}
                placeholder="2025-26"
                className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm tabular-nums"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">
              ঠিকানা (Address)
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="ময়মনসিংহ সদর, ময়মনসিংহ"
              className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm bn"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">
              মন্ত্রণালয় / বিভাগ
            </label>
            <input
              type="text"
              value={ministryName}
              onChange={(e) => setMinistryName(e.target.value)}
              placeholder="প্রাথমিক ও গণশিক্ষা মন্ত্রণালয়"
              className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm bn"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">
              সকল অর্থবছর তালিকা (কমা দিয়ে আলাদা করুন)
            </label>
            <input
              type="text"
              value={fiscalYearsStr}
              onChange={(e) => setFiscalYearsStr(e.target.value)}
              placeholder="2024-25, 2025-26, 2026-27"
              className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm tabular-nums"
            />
          </div>
        </form>
      </Modal>

      {/* Office Detail Modal */}
      <Modal
        open={Boolean(detailOffice)}
        onClose={() => setDetailOffice(null)}
        title={detailOffice ? detailOffice.nameBn || detailOffice.name : ''}
        subtitle={detailOffice ? `Code: ${detailOffice.code} · FY ${detailOffice.activeFiscalYear}` : undefined}
        maxWidthClass="md:max-w-2xl"
        fullScreenOnMobile
      >
        {detailOffice && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)]">
                <div className="text-[var(--muted)] flex items-center gap-1.5 mb-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>বর্তমান DDO</span>
                </div>
                {(() => {
                  const ddo = detailPostings.find((p) => p.status === 'active' && p.role === 'ddo');
                  if (!ddo) return <div className="font-semibold text-[var(--warning-text)]">অনির্ধারিত</div>;
                  const u = usersById.get(ddo.userId);
                  return (
                    <div>
                      <div className="font-semibold text-[var(--text)]">{ddo.userName}</div>
                      <div className="text-[var(--muted)]">
                        {ddo.designation} · {ddo.kind === 'additionalCharge' ? 'অতিরিক্ত দায়িত্ব' : 'নিয়মিত'}
                      </div>
                      {u?.email && <div className="text-[var(--muted)]">{u.email}</div>}
                    </div>
                  );
                })()}
              </div>

              <div className="p-3 rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)]">
                <div className="text-[var(--muted)] flex items-center gap-1.5 mb-1">
                  <Building2 className="w-3.5 h-3.5" />
                  <span>অফিসের তথ্য</span>
                </div>
                <div className="font-medium text-[var(--text)] bn">{detailOffice.address || '—'}</div>
                <div className="text-[var(--muted)] mt-0.5">{detailOffice.ministryName || ''}</div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)] mb-2 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5" />
                <span>কর্মরত কর্মকর্তা ও কর্মচারী ({detailPostings.filter((p) => p.status === 'active').length})</span>
              </h3>
              <div className="divide-y divide-[var(--line)] border border-[var(--line)] rounded-xl overflow-hidden">
                {detailPostings.filter((p) => p.status === 'active').length === 0 ? (
                  <div className="p-4 text-xs text-[var(--muted)] text-center">
                    এই অফিসে কোনো সক্রিয় পদায়ন নেই।
                  </div>
                ) : (
                  detailPostings
                    .filter((p) => p.status === 'active')
                    .map((p) => (
                      <div key={p.id} className="p-3 text-xs flex items-center justify-between gap-2 bg-[var(--card)]">
                        <div>
                          <div className="font-semibold text-[var(--text)]">{p.userName}</div>
                          <div className="text-[var(--muted)]">
                            {p.designation} · {formatRoleLabel(p.role)} ·{' '}
                            {p.kind === 'additionalCharge' ? 'অতিরিক্ত দায়িত্ব' : 'নিয়মিত'}
                          </div>
                        </div>
                        <div className="text-right text-[var(--muted)] tabular-nums">
                          <div>{formatDateDisplay(p.startDate)} থেকে</div>
                          <div>আদেশ: {p.orderNo || '—'}</div>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)] mb-2">
                পূর্ববর্তী পদায়ন ইতিহাস ({detailPostings.filter((p) => p.status === 'ended').length})
              </h3>
              <div className="divide-y divide-[var(--line)] border border-[var(--line)] rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                {detailPostings.filter((p) => p.status === 'ended').length === 0 ? (
                  <div className="p-4 text-xs text-[var(--muted)] text-center">কোনো পূর্ববর্তী ইতিহাস নেই।</div>
                ) : (
                  detailPostings
                    .filter((p) => p.status === 'ended')
                    .map((p) => (
                      <div key={p.id} className="p-3 text-xs flex items-center justify-between gap-2 bg-[var(--card)]">
                        <div>
                          <div className="font-medium text-[var(--text)]">{p.userName}</div>
                          <div className="text-[var(--muted)]">
                            {formatRoleLabel(p.role)} ({p.kind === 'additionalCharge' ? 'Addl.' : 'Regular'}) ·{' '}
                            {p.endReason || 'ended'}
                          </div>
                        </div>
                        <div className="text-right text-[var(--muted)] tabular-nums">
                          {formatDateDisplay(p.startDate)} → {formatDateDisplay(p.endDate)}
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
