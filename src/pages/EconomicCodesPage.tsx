import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Search, Upload } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
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
import { canEditDeleteBudgets, canManageRates } from '../lib/permissions';
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
  const { userDoc, accessState } = useAuth();
  const { pushToast, t, reportPermissionError, clearPermissionError } = useApp();
  const { economicCodes, loading } = useEconomicCodes();

  const canEdit = userDoc ? canManageRates(userDoc.role) : false;
  const isSuperAdmin = userDoc ? canEditDeleteBudgets(userDoc.role) : false;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);

  // Usage counts across all FYs (budgets count + used in rates/limits)
  const [budgetUsageMap, setBudgetUsageMap] = useState<Map<string, number>>(new Map());
  const [otherUsedCodes, setOtherUsedCodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (accessState !== 'active') return;

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
  }, [accessState, clearPermissionError, reportPermissionError]);

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

  const fileInputRef = useRef<HTMLInputElement>(null);

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
    try {
      await upsertEconomicCode(
        {
          code: trimmedCode,
          headName: headNameBnInput,
          headNameBn: headNameBnInput,
          active: activeInput,
        },
        { uid: userDoc.id, name: userDoc.name }
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
    try {
      await setEconomicCodeActive(entry, !entry.active, {
        uid: userDoc.id,
        name: userDoc.name,
      });
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
    try {
      await deleteEconomicCodeIfUnused(entry, {
        uid: userDoc.id,
        name: userDoc.name,
      });
      pushToast('success', `Deleted economic code ${entry.code}.`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to delete code.');
    }
  };

  const handleCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userDoc || !canEdit) return;
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
          { uid: userDoc.id, name: userDoc.name }
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
    <button
      type="button"
      onClick={openCreateModal}
      className="min-h-[44px] md:min-h-[40px] px-3.5 md:px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold whitespace-nowrap"
    >
      {t('newEconomicCode')}
    </button>
  ) : null;

  return (
    <Layout title={t('navEconomicCodes')} actions={actions}>
      <div className="space-y-3.5 md:space-y-4">
        {canEdit && (
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleCsvFile}
            className="hidden"
          />
        )}

        {/* Filters, Search & CSV Import */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 md:gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {(['all', 'active', 'inactive'] as const).map((f) => {
              const active = statusFilter === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setStatusFilter(f);
                    setPage(1);
                  }}
                  className={`min-h-[44px] md:min-h-[38px] px-3.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                      : 'bg-[var(--card)] border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {t(f)}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="relative flex-1 min-w-0 md:w-72">
              <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="কোড বা ব্যয়ের খাত খুঁজুন…"
                aria-label="Search economic codes"
                className="w-full min-h-[44px] md:min-h-[40px] pl-9 pr-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>

            {canEdit && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[44px] md:min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-medium text-[var(--text)] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{t('importCsv')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Table / Mobile Cards */}
        <div className="card-surface overflow-hidden">
          {/* Mobile Card List */}
          <div className="md:hidden divide-y divide-[var(--line)]">
            {loading ? (
              <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                Loading economic codes…
              </div>
            ) : paged.length === 0 ? (
              <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                {t('noDataFound')}
              </div>
            ) : (
              paged.map((item) => {
                const budgetCount = budgetUsageMap.get(item.code) || 0;
                const usedAnywhere = isCodeUsedAnywhere(item.code);
                return (
                  <div key={item.code} className="p-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold tabular-nums text-[var(--text)]">
                            {item.code}
                          </span>
                          <span className="text-xs text-[var(--muted)] tabular-nums">
                            · {budgetCount} {budgetCount === 1 ? 'budget' : 'budgets'}
                          </span>
                        </div>
                        <div
                          className="text-sm font-medium text-[var(--text)] mt-1 break-words bn"
                          style={{ fontFamily: "Nikosh, 'Noto Sans Bengali', sans-serif" }}
                        >
                          {item.headNameBn || item.headName}
                        </div>
                      </div>
                      <StatusChip variant={item.active ? 'active' : 'withdrawn'}>
                        {item.active ? t('active') : t('inactive')}
                      </StatusChip>
                    </div>

                    {canEdit && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => openEditModal(item)}
                          className="min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium hover:bg-[var(--surface-subtle)]"
                        >
                          {t('edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleActive(item)}
                          className="min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium hover:bg-[var(--surface-subtle)]"
                        >
                          {item.active ? 'Deactivate' : 'Activate'}
                        </button>
                        {isSuperAdmin && !usedAnywhere && (
                          <button
                            type="button"
                            onClick={() => handleDelete(item)}
                            className="min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40"
                          >
                            {t('delete')}
                          </button>
                        )}
                      </div>
                    )}
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
                  <th className="sticky left-0 z-10 bg-[var(--card)] py-3 px-4 font-medium whitespace-nowrap">Code</th>
                  <th className="py-3 px-4 font-medium">ব্যয়ের খাত</th>
                  <th className="py-3 px-4 font-medium whitespace-nowrap">{t('status')}</th>
                  <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Used in</th>
                  {canEdit && (
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {loading ? (
                  <tr>
                    <td colSpan={canEdit ? 5 : 4} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                      Loading economic codes…
                    </td>
                  </tr>
                ) : paged.length === 0 ? (
                  <tr>
                    <td colSpan={canEdit ? 5 : 4} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                      {t('noDataFound')}
                    </td>
                  </tr>
                ) : (
                  paged.map((item) => {
                    const budgetCount = budgetUsageMap.get(item.code) || 0;
                    const usedAnywhere = isCodeUsedAnywhere(item.code);
                    return (
                      <tr
                        key={item.code}
                        className="group hover:bg-[var(--surface-subtle)] transition-colors"
                      >
                        <td className="sticky left-0 z-10 bg-[var(--card)] group-hover:bg-[var(--surface-subtle)] py-3 px-4 font-semibold tabular-nums whitespace-nowrap transition-colors">
                          {item.code}
                        </td>
                        <td
                          className="py-3 px-4 font-medium text-[var(--text)]"
                          style={{ fontFamily: "Nikosh, 'Noto Sans Bengali', sans-serif" }}
                        >
                          {item.headNameBn || item.headName || '—'}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <StatusChip variant={item.active ? 'active' : 'withdrawn'}>
                            {item.active ? t('active') : t('inactive')}
                          </StatusChip>
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap text-[var(--muted)]">
                          {budgetCount} {budgetCount === 1 ? 'budget' : 'budgets'}
                        </td>
                        {canEdit && (
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEditModal(item)}
                                className="min-h-[34px] px-2.5 rounded-md border border-[var(--line)] text-xs font-medium hover:bg-[var(--card)]"
                              >
                                {t('edit')}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleActive(item)}
                                className="min-h-[34px] px-2.5 rounded-md border border-[var(--line)] text-xs font-medium hover:bg-[var(--card)]"
                              >
                                {item.active ? 'Deactivate' : 'Activate'}
                              </button>
                              {isSuperAdmin && !usedAnywhere && (
                                <button
                                  type="button"
                                  onClick={() => handleDelete(item)}
                                  className="min-h-[34px] px-2.5 rounded-md border border-[var(--line)] text-xs font-medium text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40"
                                >
                                  {t('delete')}
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalItems={filtered.length} onPageChange={setPage} />
        </div>
      </div>

      {/* Add / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingEntry ? `Edit Code · ${editingEntry.code}` : 'New Economic Code'}
        subtitle="Master economic code entry"
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
              className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
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
              disabled={Boolean(editingEntry)}
              pattern={editingEntry?.special ? undefined : '\\d{7}'}
              title="Economic code must be 7 digits"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="3211106"
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums disabled:opacity-60"
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
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
            />
          </div>

          <div className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--text)]">Active</div>
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
