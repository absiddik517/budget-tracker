import React, { useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { StatusChip } from '../components/StatusChip';
import { ActivityList } from '../components/ActivityList';
import { EconomicCodeSelect } from '../components/EconomicCodeSelect';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { useFyData } from '../hooks/useFyData';
import { useEconomicCodes } from '../hooks/useEconomicCodes';
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
import type { BudgetDoc, BudgetEntryType, DeductionRates, EconomicCodeDoc } from '../types';

const DEFAULT_DEDUCTION_RATES: DeductionRates = {
  basis: 'gross',
  incomeTax: 5,
  vat: [{ key: 'default', label: 'Standard', rate: 10 }],
  serviceCharge: 0,
};

export function BudgetsPage() {
  const { userDoc } = useAuth();
  const { selectedFy, pushToast, t } = useApp();
  const { budgets, bills, vatTaxRates, spendingLimits, loading } = useFyData(selectedFy);
  const { getCodeEntry, getHead } = useEconomicCodes();

  const canCreate = userDoc ? canCreateBudgets(userDoc.role) : false;
  const canEditDelete = userDoc ? canEditDeleteBudgets(userDoc.role) : false;
  const canExecute = userDoc ? canMarkBudgetExecuted(userDoc.role) : false;

  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'executed'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  // Form Modal (Create or Super Admin Edit)
  const [formOpen, setFormOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetDoc | null>(null);
  const [memoNo, setMemoNo] = useState('');
  const [memoDate, setMemoDate] = useState(todayYmd());
  const [economicCode, setEconomicCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [headName, setHeadName] = useState('');
  const [headNameBn, setHeadNameBn] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [entryType, setEntryType] = useState<BudgetEntryType>('original');
  const [revisionOf, setRevisionOf] = useState<string>('');
  const [deductionRates, setDeductionRates] = useState<DeductionRates>(DEFAULT_DEDUCTION_RATES);
  const [saving, setSaving] = useState(false);

  const filteredBudgets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return budgets.filter((b) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (!q) return true;
      const head = getHead(b.economicCode, { headName: b.headName, headNameBn: b.headNameBn });
      return (
        b.memoNo.toLowerCase().includes(q) ||
        b.economicCode.toLowerCase().includes(q) ||
        head.headName.toLowerCase().includes(q) ||
        head.headNameBn.toLowerCase().includes(q)
      );
    });
  }, [budgets, statusFilter, search, getHead]);

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

  const linkedBills = useMemo(() => {
    if (!selectedBudget) return [];
    return bills.filter((bill) => {
      const hasDedSlice = bill.budgetDeductions?.some((s) => s.budgetId === selectedBudget.id);
      const hasPendSlice = bill.pendingSlices?.some((s) => s.budgetId === selectedBudget.id);
      if (hasDedSlice || hasPendSlice) return true;
      return bill.economicCode === selectedBudget.economicCode;
    });
  }, [bills, selectedBudget]);

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
    setCodeError('');
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
    const head = getHead(b.economicCode, { headName: b.headName, headNameBn: b.headNameBn });
    setEditingBudget(b);
    setMemoNo(b.memoNo);
    setMemoDate(b.memoDate);
    setEconomicCode(b.economicCode);
    setCodeError('');
    setHeadName(head.headName);
    setHeadNameBn(head.headNameBn);
    setAmountStr(formatPaisaInput(b.allocated));
    setEntryType(b.entryType);
    setRevisionOf(b.revisionOf || '');
    setDeductionRates(JSON.parse(JSON.stringify(b.deductionRates)) as DeductionRates);
    setMobileDetailOpen(false);
    setFormOpen(true);
  };

  const handleEconomicCodeChange = (val: string, entry: EconomicCodeDoc | null) => {
    setEconomicCode(val);
    setCodeError('');
    if (entry) {
      setHeadName(entry.headName);
      setHeadNameBn(entry.headNameBn);
    } else {
      setHeadName('');
      setHeadNameBn('');
    }
    const match = vatTaxRates.find((r) => r.economicCode === val.trim());
    if (match) {
      setDeductionRates({
        basis: 'gross',
        incomeTax: match.incomeTax,
        vat: match.vat.map((v) => ({ ...v })),
        serviceCharge: 0,
      });
    } else {
      setDeductionRates({
        basis: 'gross',
        incomeTax: 5,
        vat: [{ key: 'default', label: 'Standard', rate: 10 }],
        serviceCharge: 0,
      });
    }
  };

  const handleRevisionTargetChange = (targetId: string) => {
    setRevisionOf(targetId);
    setCodeError('');
    const target = budgets.find((b) => b.id === targetId);
    if (target) {
      const head = getHead(target.economicCode, {
        headName: target.headName,
        headNameBn: target.headNameBn,
      });
      setEconomicCode(target.economicCode);
      setHeadName(head.headName);
      setHeadNameBn(head.headNameBn);
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

    const code = economicCode.trim();
    if (!editingBudget) {
      const masterEntry = getCodeEntry(code);
      if (!masterEntry) {
        setCodeError('Select a valid economic code from Economic Codes.');
        pushToast('error', 'Select a valid economic code.');
        return;
      }
      if (masterEntry.special) {
        setCodeError('GENERAL-CONSTRUCTION cannot be used on budgets.');
        pushToast('error', 'GENERAL-CONSTRUCTION cannot be used on budgets.');
        return;
      }
    }

    const resolvedHead = getHead(code, { headName, headNameBn });

    setSaving(true);
    try {
      const actor = { uid: userDoc.id, name: userDoc.name };
      if (editingBudget) {
        await updateBudgetTx(
          editingBudget.id,
          {
            memoNo,
            memoDate,
            headName: resolvedHead.headName,
            headNameBn: resolvedHead.headNameBn,
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
            economicCode: code,
            headName: resolvedHead.headName,
            headNameBn: resolvedHead.headNameBn,
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
      setMobileDetailOpen(false);
      pushToast('success', 'Budget deleted.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to delete budget.');
    }
  };

  const handleSelectBudgetRow = (id: string) => {
    setSelectedBudgetId(id);
    if (typeof window !== 'undefined' && window.innerWidth < 1280) {
      setMobileDetailOpen(true);
    }
  };

  const actions = canCreate ? (
    <button
      type="button"
      onClick={openNewBudgetModal}
      className="min-h-[44px] md:min-h-[40px] px-3.5 md:px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold whitespace-nowrap"
    >
      {t('newBudget')}
    </button>
  ) : null;

  const budgetDetailContent = selectedBudget ? (
    <>
      {/* Deduction Rates Card */}
      <div className="card-surface p-4 md:p-5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--text)]">
              Deduction rates
            </h2>
            <p className="text-xs text-[var(--muted)] mt-0.5 tabular-nums break-words">
              {selectedBudget.economicCode} ·{' '}
              {
                getHead(selectedBudget.economicCode, {
                  headName: selectedBudget.headName,
                  headNameBn: selectedBudget.headNameBn,
                }).headName
              }
            </p>
          </div>
          <StatusChip
            variant={selectedBudget.status === 'active' ? 'active' : 'executed'}
          >
            {selectedBudget.status === 'active' ? t('active') : t('executed')}
          </StatusChip>
        </div>

        <dl className="space-y-2 text-sm pt-1">
          <div className="flex justify-between gap-2">
            <dt className="text-[var(--muted)]">Income Tax</dt>
            <dd className="font-medium tabular-nums">
              {selectedBudget.deductionRates.incomeTax}%
            </dd>
          </div>
          {selectedBudget.deductionRates.vat.map((v) => (
            <div key={v.key} className="flex justify-between gap-2">
              <dt className="text-[var(--muted)]">
                VAT {selectedBudget.deductionRates.vat.length > 1 ? `(${v.label})` : ''}
              </dt>
              <dd className="font-medium tabular-nums">{v.rate}%</dd>
            </div>
          ))}
          {selectedBudget.deductionRates.serviceCharge > 0 && (
            <div className="flex justify-between gap-2">
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
              className="min-h-[44px] md:min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)]"
            >
              Edit rates / budget
            </button>
          )}
          {canExecute && (
            <button
              type="button"
              onClick={() => handleMarkExecuted(selectedBudget)}
              className="min-h-[44px] md:min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)]"
            >
              {selectedBudget.status === 'active' ? t('markExecuted') : 'Reopen Active'}
            </button>
          )}
          {canEditDelete && (
            <button
              type="button"
              onClick={() => handleDeleteBudget(selectedBudget)}
              className="min-h-[44px] md:min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40"
            >
              {t('delete')}
            </button>
          )}
        </div>
      </div>

      {/* Revision Chain & Limits & Linked Spendings & Activity */}
      <div className="card-surface p-4 md:p-5 space-y-4">
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
                  className={`min-h-[36px] text-left hover:underline min-w-0 break-words ${
                    item.id === selectedBudget.id
                      ? 'font-semibold text-[var(--accent)]'
                      : 'text-[var(--text)]'
                  }`}
                >
                  {item.memoNo} ({item.entryType})
                </button>
                <span className="tabular-nums font-medium shrink-0">
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
                <li key={l.id} className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
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
            Linked bills ({linkedBills.length})
          </h3>
          {linkedBills.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">No bills recorded yet.</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {linkedBills.slice(0, 6).map((bill) => (
                <li key={bill.id} className="flex justify-between gap-2">
                  <span className="truncate min-w-0">
                    {bill.billNo || 'Draft'} · {formatDateDisplay(bill.date)} ({bill.items.length}টি)
                  </span>
                  <span className="tabular-nums font-medium shrink-0">
                    {formatTaka(bill.grossAmount)} ({bill.status})
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
  );

  return (
    <Layout title={t('navBudgets')} actions={actions}>
      <div className="space-y-3.5 md:space-y-4">
        {/* Filter chips and search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 md:gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
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

          <div className="relative w-full md:w-64">
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
              className="w-full min-h-[44px] md:min-h-[40px] pl-9 pr-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
        </div>

        {/* Main 2-column grid */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Budgets Table / Mobile Cards */}
          <div className="xl:col-span-8 card-surface overflow-hidden">
            {/* Mobile Card List */}
            <div className="md:hidden divide-y divide-[var(--line)]">
              {loading ? (
                <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                  Loading budgets…
                </div>
              ) : pagedBudgets.length === 0 ? (
                <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                  {t('noDataFound')}
                </div>
              ) : (
                pagedBudgets.map((b) => {
                  const head = getHead(b.economicCode, {
                    headName: b.headName,
                    headNameBn: b.headNameBn,
                  });
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => handleSelectBudgetRow(b.id)}
                      className="w-full text-left p-3.5 space-y-2 hover:bg-[var(--surface-subtle)] active:bg-[var(--surface-subtle)] transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--muted)]">
                            <span className="font-semibold text-[var(--text)]">{b.memoNo}</span>
                            {b.entryType === 'revision' && <span>· Revision</span>}
                            <span className="tabular-nums">· {formatDateDisplay(b.memoDate)}</span>
                          </div>
                          <div className="text-sm font-medium text-[var(--text)] mt-1 break-words">
                            <span className="tabular-nums font-semibold">{b.economicCode}</span>{' '}
                            {head.headName}
                          </div>
                          {head.headNameBn && (
                            <div className="bn mt-0.5 break-words">{head.headNameBn}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <StatusChip variant={b.status === 'active' ? 'active' : 'executed'}>
                            {b.status === 'active' ? t('active') : t('executed')}
                          </StatusChip>
                          <ChevronRight className="w-4 h-4 text-[var(--muted)]" />
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2 pt-1 text-xs border-t border-[var(--line)]/60">
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">{t('allocated')}</div>
                          <div className="font-medium tabular-nums truncate">
                            {formatNumberIN(b.allocated)}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">{t('approvedSpent')}</div>
                          <div className="font-medium tabular-nums truncate">
                            {formatNumberIN(b.spent)}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">{t('pendingAmount')}</div>
                          <div className="font-medium text-[var(--warn-text)] tabular-nums truncate">
                            {formatNumberIN(b.pendingAmount || 0)}
                          </div>
                        </div>
                        <div className="min-w-0 text-right">
                          <div className="text-[11px] text-[var(--muted)]">{t('available')}</div>
                          <div className="font-semibold text-[var(--accent)] tabular-nums truncate">
                            {formatNumberIN(b.remaining)}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                    <th className="sticky left-0 z-10 bg-[var(--card)] py-3 px-4 font-medium whitespace-nowrap">{t('memoNo')}</th>
                    <th className="py-3 px-4 font-medium whitespace-nowrap">{t('date')}</th>
                    <th className="py-3 px-4 font-medium">{t('head')}</th>
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">{t('allocated')}</th>
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">{t('approvedSpent')}</th>
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">{t('pendingAmount')}</th>
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">{t('available')}</th>
                    <th className="py-3 px-4 font-medium whitespace-nowrap">{t('status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                        Loading budgets…
                      </td>
                    </tr>
                  ) : pagedBudgets.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                        {t('noDataFound')}
                      </td>
                    </tr>
                  ) : (
                    pagedBudgets.map((b) => {
                      const isSelected = selectedBudget?.id === b.id;
                      const head = getHead(b.economicCode, {
                        headName: b.headName,
                        headNameBn: b.headNameBn,
                      });
                      return (
                        <tr
                          key={b.id}
                          onClick={() => handleSelectBudgetRow(b.id)}
                          className={`group cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[var(--accent-soft)]/50'
                              : 'hover:bg-[var(--surface-subtle)]'
                          }`}
                        >
                          <td
                            className={`sticky left-0 z-10 py-3 px-4 whitespace-nowrap transition-colors ${
                              isSelected
                                ? 'bg-[var(--accent-soft)]'
                                : 'bg-[var(--card)] group-hover:bg-[var(--surface-subtle)]'
                            }`}
                          >
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
                              <span className="tabular-nums">{b.economicCode}</span> {head.headName}
                            </div>
                            {head.headNameBn && <div className="bn">{head.headNameBn}</div>}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                            {formatNumberIN(b.allocated)}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                            {formatNumberIN(b.spent)}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap text-[var(--warn-text)]">
                            {formatNumberIN(b.pendingAmount || 0)}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap font-semibold text-[var(--accent)]">
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

          {/* Right Detail Panel (Desktop xl+) */}
          <div className="hidden xl:block xl:col-span-4 space-y-4">
            {budgetDetailContent}
          </div>
        </div>
      </div>

      {/* Mobile / Tablet Budget Detail Sheet */}
      <Modal
        open={mobileDetailOpen && Boolean(selectedBudget)}
        onClose={() => setMobileDetailOpen(false)}
        title={selectedBudget ? `Memo ${selectedBudget.memoNo}` : ''}
        subtitle={
          selectedBudget
            ? `${selectedBudget.economicCode} · ${formatDateDisplay(selectedBudget.memoDate)}`
            : ''
        }
        fullScreenOnMobile
        maxWidthClass="md:max-w-xl"
      >
        <div className="space-y-4">{budgetDetailContent}</div>
      </Modal>

      {/* Create / Edit Budget Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingBudget ? `Edit Budget · ${editingBudget.memoNo}` : 'New Budget Allocation'}
        subtitle={`FY ${selectedFy}`}
        maxWidthClass="md:max-w-lg"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="budget-form"
              disabled={saving}
              className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
            >
              {saving ? 'Saving…' : t('save')}
            </button>
          </div>
        }
      >
        <form id="budget-form" onSubmit={handleSubmitForm} className="space-y-4">
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
                  .map((b) => {
                    const head = getHead(b.economicCode, {
                      headName: b.headName,
                      headNameBn: b.headNameBn,
                    });
                    return (
                      <option key={b.id} value={b.id}>
                        {b.memoNo} · {b.economicCode} {head.headName} ({formatTaka(b.allocated)})
                      </option>
                    );
                  })}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
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
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
              />
            </div>
          </div>

          <EconomicCodeSelect
            label="Economic code"
            value={economicCode}
            onChange={handleEconomicCodeChange}
            error={codeError}
            disabled={Boolean(editingBudget) || (entryType === 'revision' && Boolean(revisionOf))}
            includeInactive={Boolean(editingBudget)}
            includeSpecial={false}
            placeholder="Select economic code…"
          />

          {economicCode && (
            <div className="px-3.5 py-2.5 rounded-lg bg-[var(--surface-subtle)] border border-[var(--line)]">
              <div className="text-[11px] font-medium text-[var(--muted)]">
                Head of expenditure (from Economic Codes)
              </div>
              <div className="text-sm font-medium text-[var(--text)] mt-0.5 break-words">
                {headName || getHead(economicCode).headName}
              </div>
              {(headNameBn || getHead(economicCode).headNameBn) && (
                <div className="bn mt-0.5 break-words">{headNameBn || getHead(economicCode).headNameBn}</div>
              )}
            </div>
          )}

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
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
            />
          </div>

          {/* Editable Deduction Rates copied from Vat & Tax Model */}
          <div className="p-3.5 rounded-xl bg-[var(--surface-subtle)] space-y-3">
            <div className="text-xs font-semibold text-[var(--text)]">
              Deduction rates (saved with this budget)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  className="w-full min-h-[44px] md:min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
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
                  className="w-full min-h-[44px] md:min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
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
                    className="min-w-0 flex-1 min-h-[44px] md:min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs"
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
                    className="w-24 shrink-0 min-h-[44px] md:min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs tabular-nums"
                  />
                </div>
              ))}
            </div>
          </div>
        </form>
      </Modal>
    </Layout>
  );
}
