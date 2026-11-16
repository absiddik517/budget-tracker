import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { StatusChip } from '../components/StatusChip';
import { ActivityList } from '../components/ActivityList';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { useFyData } from '../hooks/useFyData';
import { useDocAuditLogs } from '../hooks/useAuditLogs';
import { formatDateDisplay, todayYmd } from '../lib/dates';
import {
  createBudgetTx,
  markBudgetStatusTx,
  softDeleteBudgetTx,
  updateBudgetTx,
} from '../lib/firestoreOps';
import { formatNumberIN, formatPaisaInput, formatTaka, toPaisa } from '../lib/money';
import {
  canCreateBudgets,
  canEditDeleteBudgets,
  canMarkBudgetExecuted,
} from '../lib/permissions';
import type { BudgetDoc, BudgetEntryType, DeductionRates } from '../types';

export function BudgetsPage() {
  const { userDoc } = useAuth();
  const { selectedFy, pushToast, t } = useApp();
  const { budgets, spendings, vatTaxRates, spendingLimits, loading } = useFyData(selectedFy);

  const canCreate = userDoc ? canCreateBudgets(userDoc.role) : false;
  const canEditDelete = userDoc ? canEditDeleteBudgets(userDoc.role) : false;
  const canExecute = userDoc ? canMarkBudgetExecuted(userDoc.role) : false;

  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'executed'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);

  // Form Modal (Create or Super Admin Edit)
  const [formOpen, setFormOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetDoc | null>(null);
  const [memoNo, setMemoNo] = useState('');
  const [memoDate, setMemoDate] = useState(todayYmd());
  const [economicCode, setEconomicCode] = useState('');
  const [headName, setHeadName] = useState('');
  const [headNameBn, setHeadNameBn] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [entryType, setEntryType] = useState<BudgetEntryType>('original');
  const [revisionOf, setRevisionOf] = useState<string>('');
  const [deductionRates, setDeductionRates] = useState<DeductionRates>({
    basis: 'gross',
    incomeTax: 5,
    vat: [{ key: 'default', label: 'Standard', rate: 10 }],
    serviceCharge: 0,
  });
  const [saving, setSaving] = useState(false);

  // Edit Rates only modal (for Super Admin)
  const [ratesOnlyOpen, setRatesOnlyOpen] = useState(false);

  const filteredBudgets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return budgets.filter((b) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (!q) return true;
      return (
        b.memoNo.toLowerCase().includes(q) ||
        b.economicCode.toLowerCase().includes(q) ||
        b.headName.toLowerCase().includes(q) ||
        b.headNameBn.toLowerCase().includes(q)
      );
    });
  }, [budgets, statusFilter, search]);

  const pagedBudgets = useMemo(() => {
    const start = (page - 1) * 50;
    return filteredBudgets.slice(start, start + 50);
  }, [filteredBudgets, page]);

  const selectedBudget = useMemo(() => {
    if (selectedBudgetId) {
      return budgets.find((b) => b.id === selectedBudgetId) || budgets[0] || null;
    }
    return budgets[0] || null;
  }, [budgets, selectedBudgetId]);

  const { logs: selectedBudgetLogs, loading: logsLoading } = useDocAuditLogs(
    'budgets',
    selectedBudget?.id || null
  );

  const revisionChain = useMemo(() => {
    if (!selectedBudget) return [];
    const rootId = selectedBudget.revisionOf || selectedBudget.id;
    return budgets.filter((b) => b.id === rootId || b.revisionOf === rootId);
  }, [budgets, selectedBudget]);

  const linkedSpendings = useMemo(() => {
    if (!selectedBudget) return [];
    return spendings.filter((s) => s.budgetId === selectedBudget.id);
  }, [spendings, selectedBudget]);

  const applicableLimits = useMemo(() => {
    if (!selectedBudget) return [];
    return spendingLimits.filter(
      (l) =>
        l.status === 'active' &&
        ((l.type === 'code' && l.economicCode === selectedBudget.economicCode) ||
          (l.type === 'budget' && l.budgetId === selectedBudget.id))
    );
  }, [spendingLimits, selectedBudget]);

  const openNewBudgetModal = () => {
    setEditingBudget(null);
    setMemoNo('');
    setMemoDate(todayYmd());
    setEconomicCode('');
    setHeadName('');
    setHeadNameBn('');
    setAmountStr('');
    setEntryType('original');
    setRevisionOf('');
    setDeductionRates({
      basis: 'gross',
      incomeTax: 5,
      vat: [{ key: 'default', label: 'Standard', rate: 10 }],
      serviceCharge: 0,
    });
    setFormOpen(true);
  };

  const openEditBudgetModal = (b: BudgetDoc) => {
    setEditingBudget(b);
    setMemoNo(b.memoNo);
    setMemoDate(b.memoDate);
    setEconomicCode(b.economicCode);
    setHeadName(b.headName);
    setHeadNameBn(b.headNameBn);
    setAmountStr(formatPaisaInput(b.allocated));
    setEntryType(b.entryType);
    setRevisionOf(b.revisionOf || '');
    setDeductionRates(JSON.parse(JSON.stringify(b.deductionRates)) as DeductionRates);
    setFormOpen(true);
  };

  const handleEconomicCodeChange = (val: string) => {
    setEconomicCode(val);
    const match = vatTaxRates.find((r) => r.economicCode === val.trim());
    if (match) {
      setHeadName(match.description);
      setHeadNameBn(match.descriptionBn);
      setDeductionRates({
        basis: 'gross',
        incomeTax: match.incomeTax,
        vat: match.vat.map((v) => ({ ...v })),
        serviceCharge: 0,
      });
    }
  };

  const handleRevisionTargetChange = (targetId: string) => {
    setRevisionOf(targetId);
    const target = budgets.find((b) => b.id === targetId);
    if (target) {
      setEconomicCode(target.economicCode);
      setHeadName(target.headName);
      setHeadNameBn(target.headNameBn);
      setDeductionRates(JSON.parse(JSON.stringify(target.deductionRates)) as DeductionRates);
    }
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userDoc) return;
    const allocatedPaisa = toPaisa(amountStr);
    if (Number.isNaN(allocatedPaisa)) {
      pushToast('error', 'Enter a valid taka amount.');
      return;
    }

    setSaving(true);
    try {
      const actor = { uid: userDoc.id, name: userDoc.name };
      if (editingBudget) {
        await updateBudgetTx(
          editingBudget.id,
          {
            memoNo,
            memoDate,
            headName,
            headNameBn,
            allocated: allocatedPaisa,
            deductionRates,
          },
          actor
        );
        pushToast('success', 'Budget updated.');
      } else {
        const newId = await createBudgetTx(
          {
            fiscalYear: selectedFy,
            memoNo,
            memoDate,
            economicCode,
            headName,
            headNameBn,
            allocated: allocatedPaisa,
            entryType,
            revisionOf: entryType === 'revision' ? revisionOf : null,
            deductionRates,
          },
          actor
        );
        setSelectedBudgetId(newId);
        pushToast('success', 'Budget created.');
      }
      setFormOpen(false);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to save budget.');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkExecuted = async (b: BudgetDoc) => {
    if (!userDoc || !canExecute) return;
    const nextStatus = b.status === 'active' ? 'executed' : 'active';
    try {
      await markBudgetStatusTx(b.id, nextStatus, {
        uid: userDoc.id,
        name: userDoc.name,
      });
      pushToast(
        'success',
        nextStatus === 'executed' ? 'Budget marked Executed.' : 'Budget reopened as Active.'
      );
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to update status.');
    }
  };

  const handleDeleteBudget = async (b: BudgetDoc) => {
    if (!userDoc || !canEditDelete) return;
    try {
      await softDeleteBudgetTx(b.id, { uid: userDoc.id, name: userDoc.name });
      if (selectedBudgetId === b.id) setSelectedBudgetId(null);
      pushToast('success', 'Budget deleted.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to delete budget.');
    }
  };

  const actions = canCreate ? (
    <button
      type="button"
      onClick={openNewBudgetModal}
      className="min-h-[40px] px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold whitespace-nowrap"
    >
      {t('newBudget')}
    </button>
  ) : null;

  return (
    <Layout title={t('navBudgets')} actions={actions}>
      <div className="space-y-4">
        {/* Filter chips and search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['all', 'active', 'executed'] as const).map((f) => {
              const active = statusFilter === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setStatusFilter(f);
                    setPage(1);
                  }}
                  className={`min-h-[38px] px-3.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
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

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search memo, code, head…"
              aria-label="Search budgets"
              className="w-full min-h-[40px] pl-9 pr-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
        </div>

        {/* Main 2-column grid matching Screenshot 2 */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Budgets Table Card */}
          <div className="xl:col-span-8 card-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                    <th className="py-3 px-4 font-medium whitespace-nowrap">{t('memoNo')}</th>
                    <th className="py-3 px-4 font-medium whitespace-nowrap">{t('date')}</th>
                    <th className="py-3 px-4 font-medium">{t('head')}</th>
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">{t('allocated')}</th>
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">{t('spent')}</th>
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">{t('remaining')}</th>
                    <th className="py-3 px-4 font-medium whitespace-nowrap">{t('status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                        Loading budgets…
                      </td>
                    </tr>
                  ) : pagedBudgets.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                        {t('noDataFound')}
                      </td>
                    </tr>
                  ) : (
                    pagedBudgets.map((b) => {
                      const isSelected = selectedBudget?.id === b.id;
                      return (
                        <tr
                          key={b.id}
                          onClick={() => setSelectedBudgetId(b.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[var(--accent-soft)]/50'
                              : 'hover:bg-[var(--surface-subtle)]'
                          }`}
                        >
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-medium text-[var(--text)]">{b.memoNo}</div>
                            {b.entryType === 'revision' && (
                              <div className="text-[11px] text-[var(--muted)]">Revision</div>
                            )}
                          </td>
                          <td className="py-3 px-4 tabular-nums whitespace-nowrap text-[var(--muted)]">
                            {formatDateDisplay(b.memoDate)}
                          </td>
                          <td className="py-3 px-4 min-w-[190px]">
                            <div className="font-medium text-[var(--text)]">
                              <span className="tabular-nums">{b.economicCode}</span> {b.headName}
                            </div>
                            {b.headNameBn && <div className="bn">{b.headNameBn}</div>}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                            {formatNumberIN(b.allocated)}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                            {formatNumberIN(b.spent)}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                            {formatNumberIN(b.remaining)}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <StatusChip variant={b.status === 'active' ? 'active' : 'executed'}>
                              {b.status === 'active' ? t('active') : t('executed')}
                            </StatusChip>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              totalItems={filteredBudgets.length}
              onPageChange={setPage}
            />
          </div>

          {/* Right Detail Panel */}
          <div className="xl:col-span-4 space-y-4">
            {selectedBudget ? (
              <>
                {/* Deduction Rates Card (matches Screenshot 2) */}
                <div className="card-surface p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-[var(--text)]">
                        Deduction rates
                      </h2>
                      <p className="text-xs text-[var(--muted)] mt-0.5 tabular-nums">
                        {selectedBudget.economicCode} · from Vat &amp; Tax Model
                      </p>
                    </div>
                    <StatusChip
                      variant={selectedBudget.status === 'active' ? 'active' : 'executed'}
                    >
                      {selectedBudget.status === 'active' ? t('active') : t('executed')}
                    </StatusChip>
                  </div>

                  <dl className="space-y-2 text-sm pt-1">
                    <div className="flex justify-between">
                      <dt className="text-[var(--muted)]">Income Tax</dt>
                      <dd className="font-medium tabular-nums">
                        {selectedBudget.deductionRates.incomeTax}%
                      </dd>
                    </div>
                    {selectedBudget.deductionRates.vat.map((v) => (
                      <div key={v.key} className="flex justify-between">
                        <dt className="text-[var(--muted)]">
                          VAT {selectedBudget.deductionRates.vat.length > 1 ? `(${v.label})` : ''}
                        </dt>
                        <dd className="font-medium tabular-nums">{v.rate}%</dd>
                      </div>
                    ))}
                    {selectedBudget.deductionRates.serviceCharge > 0 && (
                      <div className="flex justify-between">
                        <dt className="text-[var(--muted)]">Service Charge</dt>
                        <dd className="font-medium tabular-nums">
                          {selectedBudget.deductionRates.serviceCharge}%
                        </dd>
                      </div>
                    )}
                  </dl>

                  <p className="text-xs text-[var(--muted)] pt-1">
                    Rates are saved with this budget, so later rate changes will not alter it.
                  </p>

                  <div className="flex flex-wrap gap-2 pt-2">
                    {canEditDelete && (
                      <button
                        type="button"
                        onClick={() => openEditBudgetModal(selectedBudget)}
                        className="min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)]"
                      >
                        Edit rates / budget
                      </button>
                    )}
                    {canExecute && (
                      <button
                        type="button"
                        onClick={() => handleMarkExecuted(selectedBudget)}
                        className="min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)]"
                      >
                        {selectedBudget.status === 'active'
                          ? t('markExecuted')
                          : 'Reopen Active'}
                      </button>
                    )}
                    {canEditDelete && (
                      <button
                        type="button"
                        onClick={() => handleDeleteBudget(selectedBudget)}
                        className="min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40"
                      >
                        {t('delete')}
                      </button>
                    )}
                  </div>
                </div>

                {/* Revision Chain & Limits & Linked Spendings & Activity */}
                <div className="card-surface p-5 space-y-4">
                  <div>
                    <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
                      Revision chain ({revisionChain.length})
                    </h3>
                    <ul className="space-y-1.5 text-xs">
                      {revisionChain.map((item) => (
                        <li
                          key={item.id}
                          className="flex items-center justify-between gap-2 py-1"
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedBudgetId(item.id)}
                            className={`text-left hover:underline ${
                              item.id === selectedBudget.id
                                ? 'font-semibold text-[var(--accent)]'
                                : 'text-[var(--text)]'
                            }`}
                          >
                            {item.memoNo} ({item.entryType})
                          </button>
                          <span className="tabular-nums font-medium">
                            {formatTaka(item.allocated)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="border-t border-[var(--line)] pt-3">
                    <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
                      Applicable spending limits ({applicableLimits.length})
                    </h3>
                    {applicableLimits.length === 0 ? (
                      <p className="text-xs text-[var(--muted)]">No active caps on this head.</p>
                    ) : (
                      <ul className="space-y-1.5 text-xs">
                        {applicableLimits.map((l) => (
                          <li key={l.id} className="flex justify-between gap-2">
                            <span>
                              {l.type === 'code' ? 'On code' : 'On budget'} · Ref {l.refNo}
                            </span>
                            <span className="font-semibold tabular-nums">
                              {l.rate}% (eff. {formatDateDisplay(l.effectiveDate)})
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="border-t border-[var(--line)] pt-3">
                    <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
                      Linked spendings ({linkedSpendings.length})
                    </h3>
                    {linkedSpendings.length === 0 ? (
                      <p className="text-xs text-[var(--muted)]">No spendings recorded yet.</p>
                    ) : (
                      <ul className="space-y-1.5 text-xs">
                        {linkedSpendings.slice(0, 6).map((s) => (
                          <li key={s.id} className="flex justify-between gap-2">
                            <span className="truncate">
                              {formatDateDisplay(s.date)} · {s.payee}
                            </span>
                            <span className="tabular-nums font-medium shrink-0">
                              {formatTaka(s.gross)} ({s.status})
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="border-t border-[var(--line)] pt-3">
                    <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1">
                      {t('activity')}
                    </h3>
                    <ActivityList logs={selectedBudgetLogs} loading={logsLoading} />
                  </div>
                </div>
              </>
            ) : (
              <div className="card-surface p-5 text-sm text-[var(--muted)]">
                Select a budget row to inspect deduction rates, revision chain, and activity.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create / Edit Budget Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingBudget ? `Edit Budget · ${editingBudget.memoNo}` : 'New Budget Allocation'}
        subtitle={`FY ${selectedFy}`}
      >
        <form onSubmit={handleSubmitForm} className="space-y-4">
          {!editingBudget && (
            <div>
              <div className="text-xs font-medium text-[var(--muted)] mb-1.5">Entry type</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEntryType('original');
                    setRevisionOf('');
                  }}
                  className={`min-h-[42px] rounded-lg text-xs font-semibold transition-colors ${
                    entryType === 'original'
                      ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                      : 'border border-[var(--line)] text-[var(--text)]'
                  }`}
                >
                  Original allocation
                </button>
                <button
                  type="button"
                  onClick={() => setEntryType('revision')}
                  className={`min-h-[42px] rounded-lg text-xs font-semibold transition-colors ${
                    entryType === 'revision'
                      ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                      : 'border border-[var(--line)] text-[var(--text)]'
                  }`}
                >
                  Revision
                </button>
              </div>
            </div>
          )}

          {!editingBudget && entryType === 'revision' && (
            <div>
              <label htmlFor="budget-rev-of" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                Revision of budget entry
              </label>
              <select
                id="budget-rev-of"
                required
                value={revisionOf}
                onChange={(e) => handleRevisionTargetChange(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
              >
                <option value="">Select original budget…</option>
                {budgets
                  .filter((b) => b.entryType === 'original')
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.memoNo} · {b.economicCode} {b.headName} ({formatTaka(b.allocated)})
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="budget-memo-no" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                Memo No
              </label>
              <input
                id="budget-memo-no"
                type="text"
                required
                value={memoNo}
                onChange={(e) => setMemoNo(e.target.value)}
                placeholder="Memo 01/26"
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
              />
            </div>
            <div>
              <label htmlFor="budget-memo-date" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                Memo Date (inside FY {selectedFy})
              </label>
              <input
                id="budget-memo-date"
                type="date"
                required
                value={memoDate}
                onChange={(e) => setMemoDate(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm tabular-nums"
              />
            </div>
          </div>

          <div>
            <label htmlFor="budget-code" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
              Economic code (7 digits, autocomplete from Vat &amp; Tax Model)
            </label>
            <input
              id="budget-code"
              type="text"
              required
              disabled={Boolean(editingBudget)}
              list="vat-tax-codes"
              value={economicCode}
              onChange={(e) => handleEconomicCodeChange(e.target.value)}
              placeholder="3211106"
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm tabular-nums disabled:opacity-60"
            />
            <datalist id="vat-tax-codes">
              {vatTaxRates.map((r) => (
                <option key={r.id} value={r.economicCode}>
                  {r.description} {r.descriptionBn}
                </option>
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="budget-head" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                Head name (English)
              </label>
              <input
                id="budget-head"
                type="text"
                required
                value={headName}
                onChange={(e) => setHeadName(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
              />
            </div>
            <div>
              <label htmlFor="budget-head-bn" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                Head name (Bengali)
              </label>
              <input
                id="budget-head-bn"
                type="text"
                value={headNameBn}
                onChange={(e) => setHeadNameBn(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="budget-amount" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
              Amount (৳){entryType === 'revision' ? ' · negative allowed for reduction' : ''}
            </label>
            <input
              id="budget-amount"
              type="number"
              step="0.01"
              required
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="300000"
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm tabular-nums"
            />
          </div>

          {/* Editable Deduction Rates copied from Vat & Tax Model */}
          <div className="p-3.5 rounded-xl bg-[var(--surface-subtle)] space-y-3">
            <div className="text-xs font-semibold text-[var(--text)]">
              Deduction rates (saved with this budget)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-[var(--muted)] mb-1">Income Tax (%)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={deductionRates.incomeTax}
                  onChange={(e) =>
                    setDeductionRates({
                      ...deductionRates,
                      incomeTax: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--muted)] mb-1">Service Charge (%)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={deductionRates.serviceCharge}
                  onChange={(e) =>
                    setDeductionRates({
                      ...deductionRates,
                      serviceCharge: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm tabular-nums"
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] text-[var(--muted)]">VAT rates (%)</div>
              {deductionRates.vat.map((v, idx) => (
                <div key={v.key} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={v.label}
                    onChange={(e) => {
                      const nextVat = [...deductionRates.vat];
                      nextVat[idx] = { ...v, label: e.target.value };
                      setDeductionRates({ ...deductionRates, vat: nextVat });
                    }}
                    className="flex-1 min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={v.rate}
                    onChange={(e) => {
                      const nextVat = [...deductionRates.vat];
                      nextVat[idx] = { ...v, rate: parseFloat(e.target.value) || 0 };
                      setDeductionRates({ ...deductionRates, vat: nextVat });
                    }}
                    className="w-24 min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs tabular-nums"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--line)]">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
            >
              {saving ? 'Saving…' : t('save')}
            </button>
          </div>
        </form>
      </Modal>
    </Layout>
  );
}
