import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { BookOpen, MoreVertical, Pencil, Plus, Power, Search, Trash2, Upload } from 'lucide-react';
import { BottomSheet } from '../components/BottomSheet';
import { EmptyState } from '../components/EmptyState';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { SegmentedChips } from '../components/SegmentedChips';
import { StatusChip } from '../components/StatusChip';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { useEconomicCodes } from '../hooks/useEconomicCodes';
import { db } from '../lib/firebase';
import { isPermissionDeniedError, logFirestoreError, OperationType } from '../lib/firestoreError';
import {
  deleteEconomicCodeIfUnused,
  setEconomicCodeActive,
  upsertEconomicCode,
} from '../lib/firestoreOps';
import { canManageRates } from '../lib/permissions';
import type { EconomicCodeDoc } from '../types';

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

export function EconomicCodesPage() {
  const { userDoc, accessState, isSuperAdmin } = useAuth();
  const {
    currentOfficeRole,
    actorSnapshot,
    pushToast,
    t,
    reportPermissionError,
    clearPermissionError,
  } = useApp();
  const { economicCodes, loading } = useEconomicCodes();

  const canEdit = canManageRates({ isSuperAdmin, officeRole: currentOfficeRole });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);

  // Usage counts across all offices/FYs (Super Admin only; non-admins cannot list global budgets/limits)
  const [budgetUsageMap, setBudgetUsageMap] = useState<Map<string, number>>(new Map());
  const [otherUsedCodes, setOtherUsedCodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (accessState !== 'active' || !isSuperAdmin) {
      setBudgetUsageMap(new Map());
      setOtherUsedCodes(new Set());
      return;
    }

    const unsubBudgets = onSnapshot(
      collection(db, 'budgets'),
      (snap) => {
        clearPermissionError('budgets');
        const map = new Map<string, number>();
        for (const d of snap.docs) {
          const data = d.data();
          if (data.deleted) continue;
          const c = String(data.economicCode || '').trim();
          if (c) map.set(c, (map.get(c) || 0) + 1);
        }
        setBudgetUsageMap(map);
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'budgets');
        if (isPermissionDeniedError(err)) reportPermissionError('budgets');
      }
    );

    const unsubRates = onSnapshot(
      collection(db, 'vatTaxRates'),
      (snap) => {
        clearPermissionError('vatTaxRates');
        setOtherUsedCodes((prev) => {
          const next = new Set(prev);
          for (const d of snap.docs) {
            const c = String(d.data().economicCode || '').trim();
            if (c) next.add(`rate:${c}`);
          }
          return next;
        });
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'vatTaxRates');
        if (isPermissionDeniedError(err)) reportPermissionError('vatTaxRates');
      }
    );

    const unsubLimits = onSnapshot(
      collection(db, 'spendingLimits'),
      (snap) => {
        clearPermissionError('spendingLimits');
        setOtherUsedCodes((prev) => {
          const next = new Set(prev);
          for (const d of snap.docs) {
            const c = String(d.data().economicCode || '').trim();
            if (c) next.add(`limit:${c}`);
          }
          return next;
        });
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'spendingLimits');
        if (isPermissionDeniedError(err)) reportPermissionError('spendingLimits');
      }
    );

    return () => {
      unsubBudgets();
      unsubRates();
      unsubLimits();
    };
  }, [accessState, isSuperAdmin, clearPermissionError, reportPermissionError]);

  const isCodeUsedAnywhere = (code: string): boolean => {
    return (
      (budgetUsageMap.get(code) || 0) > 0 ||
      otherUsedCodes.has(`rate:${code}`) ||
      otherUsedCodes.has(`limit:${code}`)
    );
  };

  // Add / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<EconomicCodeDoc | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [headNameBnInput, setHeadNameBnInput] = useState('');
  const [activeInput, setActiveInput] = useState(true);
  const [saving, setSaving] = useState(false);

  // 3-dot Action Menu Sheet
  const [menuEntry, setMenuEntry] = useState<EconomicCodeDoc | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const statusCounts = useMemo(() => {
    let activeCount = 0;
    for (const item of economicCodes) {
      if (item.active) activeCount += 1;
    }
    return {
      all: economicCodes.length,
      active: activeCount,
      inactive: economicCodes.length - activeCount,
    };
  }, [economicCodes]);

  const filtered = useMemo(() => {
    const q = search.trim().replace(/\s+/g, ' ').toLowerCase();
    return economicCodes.filter((item) => {
      if (statusFilter === 'active' && !item.active) return false;
      if (statusFilter === 'inactive' && item.active) return false;
      if (!q) return true;
      return (
        item.code.toLowerCase().includes(q) ||
        item.headName.toLowerCase().includes(q) ||
        item.headNameBn.toLowerCase().includes(q)
      );
    });
  }, [economicCodes, statusFilter, search]);

  const paged = useMemo(() => {
    const start = (page - 1) * 50;
    return filtered.slice(start, start + 50);
  }, [filtered, page]);

  const openCreateModal = () => {
    setEditingEntry(null);
    setCodeInput('');
    setHeadNameBnInput('');
    setActiveInput(true);
    setModalOpen(true);
  };

  const openEditModal = (entry: EconomicCodeDoc) => {
    if (!canEdit) return;
    setMenuEntry(null);
    setEditingEntry(entry);
    setCodeInput(entry.code);
    setHeadNameBnInput(entry.headNameBn || entry.headName);
    setActiveInput(entry.active);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userDoc || !canEdit) return;
    const trimmedCode = codeInput.trim();
    if (!editingEntry && trimmedCode === 'GENERAL-CONSTRUCTION') {
      pushToast('error', 'Enter a 7-digit economic code.');
      return;
    }
    setSaving(true);
    const actor = actorSnapshot || { uid: userDoc.id, name: userDoc.name };
    try {
      await upsertEconomicCode(
        {
          code: trimmedCode,
          headName: headNameBnInput,
          headNameBn: headNameBnInput,
          active: activeInput,
        },
        actor
      );
      pushToast('success', editingEntry ? 'Economic code updated.' : 'Economic code added.');
      setModalOpen(false);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to save economic code.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (entry: EconomicCodeDoc) => {
    if (!userDoc || !canEdit) return;
    setMenuEntry(null);
    const actor = actorSnapshot || { uid: userDoc.id, name: userDoc.name };
    try {
      await setEconomicCodeActive(entry, !entry.active, actor);
      pushToast(
        'success',
        entry.active ? `${entry.code} deactivated.` : `${entry.code} activated.`
      );
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to update status.');
    }
  };

  const handleDelete = async (entry: EconomicCodeDoc) => {
    if (!userDoc || !isSuperAdmin) return;
    setMenuEntry(null);
    const actor = actorSnapshot || { uid: userDoc.id, name: userDoc.name };
    try {
      await deleteEconomicCodeIfUnused(entry, actor);
      pushToast('success', `Deleted economic code ${entry.code}.`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to delete code.');
    }
  };

  const handleCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userDoc || !canEdit) return;
    const actor = actorSnapshot || { uid: userDoc.id, name: userDoc.name };
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        pushToast('error', 'CSV must have a header row and at least one data row.');
        return;
      }
      const headers = parseCsvLine(lines[0]);
      const cIdx = headers.indexOf('code');
      const bnIdx = headers.indexOf('headNameBn');
      const enIdx = headers.indexOf('headName');
      if (cIdx === -1 || (bnIdx === -1 && enIdx === -1)) {
        pushToast('error', 'CSV must include columns: code, headNameBn.');
        return;
      }

      let imported = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        const rowCode = (cols[cIdx] || '').trim();
        const rowHeadBn = bnIdx >= 0 ? (cols[bnIdx] || '').trim() : '';
        const rowHeadFallback = enIdx >= 0 ? (cols[enIdx] || '').trim() : '';
        const finalHead = rowHeadBn || rowHeadFallback;
        if (!rowCode || !finalHead) continue;

        await upsertEconomicCode(
          {
            code: rowCode,
            headName: finalHead,
            headNameBn: finalHead,
            active: true,
          },
          actor
        );
        imported++;
      }
      pushToast('success', `Imported ${imported} economic codes.`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'CSV import failed.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const actions = canEdit ? (
    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="min-h-[44px] md:min-h-[40px] flex-1 sm:flex-initial px-3.5 rounded-[10px] border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-sm font-semibold text-[var(--text)] inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <Upload className="w-4 h-4 shrink-0" />
        <span>{t('importCsv')}</span>
      </button>
      <button
        type="button"
        onClick={openCreateModal}
        className="min-h-[44px] md:min-h-[40px] flex-1 sm:flex-initial px-4 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <Plus className="w-4 h-4 shrink-0" />
        <span>{t('newEconomicCode')}</span>
      </button>
    </div>
  ) : null;

  return (
    <Layout title={t('navEconomicCodes')}>
      <PageHeader title={t('navEconomicCodes')} actions={actions} />

      <div className="space-y-3.5">
        {canEdit && (
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleCsvFile}
            className="hidden"
          />
        )}

        {/* Filter Chips */}
        <SegmentedChips
          ariaLabel="Filter economic codes by status"
          value={statusFilter}
          onChange={(next) => {
            setStatusFilter(next);
            setPage(1);
          }}
          options={[
            { value: 'all', label: t('all'), count: statusCounts.all },
            { value: 'active', label: t('active'), count: statusCounts.active },
            { value: 'inactive', label: t('inactive'), count: statusCounts.inactive },
          ]}
        />

        {/* Full-width Search Bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-[var(--muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="কোড বা ব্যয়ের খাত খুঁজুন…"
            aria-label="Search economic codes"
            className="w-full min-h-[44px] pl-10 pr-3.5 rounded-[12px] border border-[var(--line)] bg-[var(--card)] text-base md:text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>

        {/* 2-column Responsive Card Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="card-surface p-4 space-y-2.5 animate-pulse"
                aria-hidden="true"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="h-4 w-24 rounded bg-[var(--surface-subtle)]" />
                  <div className="h-5 w-16 rounded-full bg-[var(--surface-subtle)]" />
                </div>
                <div className="h-4 w-3/4 rounded bg-[var(--surface-subtle)]" />
                <div className="h-3 w-1/3 rounded bg-[var(--surface-subtle)]" />
              </div>
            ))}
          </div>
        ) : paged.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="w-5 h-5" />}
            title={t('noDataFound')}
            description={
              search || statusFilter !== 'all'
                ? 'অন্য কোড বা স্ট্যাটাস দিয়ে খুঁজে দেখুন।'
                : 'এখনো কোনো অর্থনৈতিক কোড যোগ করা হয়নি।'
            }
            action={
              canEdit && !search && statusFilter === 'all' ? (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="min-h-[44px] px-4 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t('newEconomicCode')}</span>
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {paged.map((item) => {
                const budgetCount = budgetUsageMap.get(item.code) || 0;
                const displayName = item.headNameBn || item.headName || '—';

                const cardMainContent = (
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-bold tabular-nums tracking-[0.01em] text-[var(--text)]">
                        {item.code}
                      </span>
                      <StatusChip variant={item.active ? 'active' : 'withdrawn'}>
                        {item.active ? t('active') : t('inactive')}
                      </StatusChip>
                    </div>
                    <div
                      className="text-[15px] font-medium text-[var(--text)] bn leading-snug"
                      style={{ fontFamily: "Nikosh, 'Noto Sans Bengali', sans-serif" }}
                    >
                      {displayName}
                    </div>
                    <div className="text-xs text-[var(--muted)] tabular-nums">
                      {isSuperAdmin
                        ? `Used in ${budgetCount} ${budgetCount === 1 ? 'budget' : 'budgets'}`
                        : item.special
                        ? 'Special economic code'
                        : 'Global economic code'}
                    </div>
                  </div>
                );

                return (
                  <div
                    key={item.code}
                    className={`card-surface flex items-center gap-2 transition-colors ${
                      canEdit ? 'hover:border-[var(--muted)]/45 py-3 pl-4 pr-2' : 'p-4'
                    }`}
                  >
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => openEditModal(item)}
                        className="flex-1 min-w-0 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      >
                        {cardMainContent}
                      </button>
                    ) : (
                      cardMainContent
                    )}

                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setMenuEntry(item)}
                        aria-label={`Actions for ${item.code}`}
                        aria-haspopup="dialog"
                        className="min-h-[44px] min-w-[44px] rounded-xl inline-flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      >
                        <MoreVertical className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {filtered.length > 50 && (
              <div className="card-surface overflow-hidden">
                <Pagination page={page} totalItems={filtered.length} onPageChange={setPage} />
              </div>
            )}
          </>
        )}

        <p className="text-xs text-[var(--muted)] text-center pt-1">
          Global list, shared by all offices. Only Super Admin can add or edit.
        </p>
      </div>

      {/* 3-dot Action Menu BottomSheet */}
      <BottomSheet
        open={Boolean(menuEntry)}
        onClose={() => setMenuEntry(null)}
        title={menuEntry?.code}
        subtitle={menuEntry ? menuEntry.headNameBn || menuEntry.headName : undefined}
        desktopMode="center"
        closeLabel={t('closeLabel')}
      >
        {menuEntry && (
          <div className="p-2 divide-y divide-[var(--line)]">
            <button
              type="button"
              onClick={() => openEditModal(menuEntry)}
              className="w-full min-h-[52px] px-3 flex items-center gap-3 text-left text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)] rounded-lg transition-colors"
            >
              <Pencil className="w-4 h-4 text-[var(--muted)] shrink-0" />
              <span>{t('edit')}</span>
            </button>
            <button
              type="button"
              onClick={() => handleToggleActive(menuEntry)}
              className="w-full min-h-[52px] px-3 flex items-center gap-3 text-left text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)] rounded-lg transition-colors"
            >
              <Power className="w-4 h-4 text-[var(--muted)] shrink-0" />
              <span>{menuEntry.active ? 'Deactivate' : 'Activate'}</span>
            </button>
            {isSuperAdmin && !isCodeUsedAnywhere(menuEntry.code) && (
              <button
                type="button"
                onClick={() => handleDelete(menuEntry)}
                className="w-full min-h-[52px] px-3 flex items-center gap-3 text-left text-sm font-medium text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40 rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                <span>{t('delete')}</span>
              </button>
            )}
          </div>
        )}
      </BottomSheet>

      {/* Add / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingEntry ? `Edit Code · ${editingEntry.code}` : 'New Economic Code'}
        subtitle="Master entry, shared by all offices"
        maxWidthClass="md:max-w-lg"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="economic-code-form"
              disabled={saving}
              className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
            >
              {saving ? 'Saving…' : t('save')}
            </button>
          </div>
        }
      >
        <form id="economic-code-form" onSubmit={handleSave} className="space-y-4">
          <div>
            <label htmlFor="ec-code" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
              Code (7 digits)
            </label>
            <input
              id="ec-code"
              type="text"
              required
              inputMode="numeric"
              maxLength={editingEntry?.special ? undefined : 7}
              disabled={Boolean(editingEntry)}
              pattern={editingEntry?.special ? undefined : '\\d{7}'}
              title="Economic code must be 7 digits"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="3211106"
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          <div>
            <label htmlFor="ec-bn" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
              ব্যয়ের খাত
            </label>
            <input
              id="ec-bn"
              type="text"
              required
              value={headNameBnInput}
              onChange={(e) => setHeadNameBnInput(e.target.value)}
              placeholder="আপ্যায়ন ব্যয়"
              style={{ fontFamily: "Nikosh, 'Noto Sans Bengali', sans-serif" }}
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          <div className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--text)]">{t('active')}</div>
              <div className="text-xs text-[var(--muted)]">
                Inactive codes are hidden from selects while existing records keep their name.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={activeInput}
              aria-label="Toggle code active"
              onClick={() => setActiveInput((prev) => !prev)}
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${
                activeInput ? 'bg-[var(--accent)]' : 'bg-[var(--line)]'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${
                  activeInput ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </form>
      </Modal>
    </Layout>
  );
}
