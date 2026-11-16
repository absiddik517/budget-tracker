import React, { useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { StatusChip } from '../components/StatusChip';
import { EconomicCodeSelect } from '../components/EconomicCodeSelect';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { useFyData } from '../hooks/useFyData';
import { useEconomicCodes } from '../hooks/useEconomicCodes';
import { formatDateDisplay, todayYmd } from '../lib/dates';
import { createSpendingLimitTx, withdrawSpendingLimit } from '../lib/firestoreOps';
import { formatNumberIN, formatTaka } from '../lib/money';
import { canManageLimits } from '../lib/permissions';
import type { EconomicCodeDoc, SpendingLimitDoc, SpendingLimitType } from '../types';

export function SpendingLimitsPage() {
  const { userDoc } = useAuth();
  const { selectedFy, pushToast, t } = useApp();
  const { budgets, fyCodeTotals, spendingLimits, loading } = useFyData(selectedFy);
  const { getCodeEntry, getHead } = useEconomicCodes();

  const canManage = userDoc ? canManageLimits(userDoc.role) : false;

  const [filter, setFilter] = useState<'all' | 'code' | 'budget' | 'withdrawn'>('all');
  const [page, setPage] = useState(1);
  const [mobileAddOpen, setMobileAddOpen] = useState(false);

  // Add limit form state
  const [limitType, setLimitType] = useState<SpendingLimitType>('code');
  const [economicCode, setEconomicCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [headName, setHeadName] = useState('');
  const [headNameBn, setHeadNameBn] = useState('');
  const [budgetId, setBudgetId] = useState('');
  const [rateStr, setRateStr] = useState('80');
  const [effectiveDate, setEffectiveDate] = useState(todayYmd());
  const [refNo, setRefNo] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredLimits = useMemo(() => {
    return spendingLimits.filter((l) => {
      if (filter === 'all') return true;
      if (filter === 'withdrawn') return l.status === 'withdrawn';
      if (filter === 'code') return l.type === 'code' && l.status === 'active';
      if (filter === 'budget') return l.type === 'budget' && l.status === 'active';
      return true;
    });
  }, [spendingLimits, filter]);

  const pagedLimits = useMemo(() => {
    const start = (page - 1) * 50;
    return filteredLimits.slice(start, start + 50);
  }, [filteredLimits, page]);

  const handleCodeChange = (val: string, entry: EconomicCodeDoc | null) => {
    setEconomicCode(val);
    setCodeError('');
    setHeadName(entry?.headName || '');
    setHeadNameBn(entry?.headNameBn || '');
    if (limitType === 'budget') {
      const matchingBudget = budgets.find(
        (b) => b.economicCode === val.trim() && b.status === 'active'
      );
      setBudgetId(matchingBudget ? matchingBudget.id : '');
    }
  };

  const handleSelectBudget = (id: string) => {
    setBudgetId(id);
    setCodeError('');
    const b = budgets.find((item) => item.id === id);
    if (b) {
      const head = getHead(b.economicCode, { headName: b.headName, headNameBn: b.headNameBn });
      setEconomicCode(b.economicCode);
      setHeadName(head.headName);
      setHeadNameBn(head.headNameBn);
    }
  };

  const previewStats = useMemo(() => {
    const rate = parseFloat(rateStr) || 0;
    let allocated = 0;
    let spent = 0;
    if (limitType === 'code' && economicCode.trim()) {
      const tot = fyCodeTotals.find((f) => f.economicCode === economicCode.trim());
      if (tot) {
        allocated = tot.allocated;
        spent = tot.spent;
      } else {
        const matching = budgets.filter((b) => b.economicCode === economicCode.trim());
        allocated = matching.reduce((acc, b) => acc + b.allocated, 0);
        spent = matching.reduce((acc, b) => acc + b.spent, 0);
      }
    } else if (limitType === 'budget' && budgetId) {
      const b = budgets.find((item) => item.id === budgetId);
      if (b) {
        allocated = b.allocated;
        spent = b.spent;
      }
    }
    const cap = Math.round((allocated * rate) / 100);
    const spendable = cap - spent;
    const pctUsedOfCap = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;
    return { allocated, spent, cap, spendable, pctUsedOfCap };
  }, [limitType, economicCode, budgetId, rateStr, fyCodeTotals, budgets]);

  const resetForm = () => {
    setLimitType('code');
    setEconomicCode('');
    setCodeError('');
    setHeadName('');
    setHeadNameBn('');
    setBudgetId('');
    setRateStr('80');
    setEffectiveDate(todayYmd());
    setRefNo('');
  };

  const handleSaveLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userDoc || !canManage) return;
    const code = economicCode.trim();
    const masterEntry = getCodeEntry(code);
    if (!masterEntry) {
      setCodeError('Select a valid economic code from Economic Codes.');
      pushToast('error', 'Select a valid economic code.');
      return;
    }
    if (masterEntry.special) {
      setCodeError('GENERAL-CONSTRUCTION cannot be used for a spending limit.');
      pushToast('error', 'GENERAL-CONSTRUCTION cannot be used for a spending limit.');
      return;
    }

    setSaving(true);
    try {
      await createSpendingLimitTx(
        {
          type: limitType,
          budgetId: limitType === 'budget' ? budgetId : null,
          fiscalYear: selectedFy,
          economicCode: code,
          headName: masterEntry.headName,
          headNameBn: masterEntry.headNameBn,
          rate: parseFloat(rateStr) || 0,
          effectiveDate,
          refNo,
        },
        { uid: userDoc.id, name: userDoc.name }
      );
      pushToast('success', 'Spending limit saved.');
      resetForm();
      setMobileAddOpen(false);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to save limit.');
    } finally {
      setSaving(false);
    }
  };

  const handleWithdraw = async (limit: SpendingLimitDoc) => {
    if (!userDoc || !canManage) return;
    try {
      await withdrawSpendingLimit(limit, { uid: userDoc.id, name: userDoc.name });
      pushToast('success', 'Spending limit withdrawn.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to withdraw limit.');
    }
  };

  const computeRowNumbers = (l: SpendingLimitDoc) => {
    let allocated = 0;
    let spent = 0;
    let budgetLabel = 'All entries';
    if (l.type === 'code') {
      const tot = fyCodeTotals.find((f) => f.economicCode === l.economicCode);
      allocated = tot
        ? tot.allocated
        : budgets
            .filter((b) => b.economicCode === l.economicCode)
            .reduce((s, b) => s + b.allocated, 0);
      spent = tot
        ? tot.spent
        : budgets
            .filter((b) => b.economicCode === l.economicCode)
            .reduce((s, b) => s + b.spent, 0);
    } else if (l.budgetId) {
      const b = budgets.find((item) => item.id === l.budgetId);
      if (b) {
        allocated = b.allocated;
        spent = b.spent;
        budgetLabel = b.memoNo;
      } else {
        budgetLabel = l.budgetId;
      }
    }
    const cap = Math.round((allocated * l.rate) / 100);
    const spendable = cap - spent;
    return { cap, spent, spendable, budgetLabel };
  };

  const renderAddLimitForm = (formId: string, showInlineButtons: boolean) => (
    <form id={formId} onSubmit={handleSaveLimit} className="space-y-3.5">
      <div>
        <div className="text-xs font-medium text-[var(--muted)] mb-1.5">Type</div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => {
              setLimitType('code');
              setBudgetId('');
            }}
            className={`min-h-[44px] md:min-h-[40px] px-2.5 rounded-lg text-xs font-semibold transition-colors ${
              limitType === 'code'
                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                : 'border border-[var(--line)] text-[var(--text)]'
            }`}
          >
            On economic code
          </button>
          <button
            type="button"
            onClick={() => setLimitType('budget')}
            className={`min-h-[44px] md:min-h-[40px] px-2.5 rounded-lg text-xs font-semibold transition-colors ${
              limitType === 'budget'
                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                : 'border border-[var(--line)] text-[var(--text)]'
            }`}
          >
            On single budget
          </button>
        </div>
      </div>

      <EconomicCodeSelect
        label="Economic code"
        value={economicCode}
        onChange={handleCodeChange}
        error={codeError}
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

      {limitType === 'budget' && (
        <div>
          <label htmlFor={`${formId}-budget`} className="block text-xs font-medium text-[var(--muted)] mb-1">
            Budget entry
          </label>
          <select
            id={`${formId}-budget`}
            required
            value={budgetId}
            onChange={(e) => handleSelectBudget(e.target.value)}
            className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
          >
            <option value="">Select budget…</option>
            {budgets
              .filter((b) => !economicCode.trim() || b.economicCode === economicCode.trim())
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

      <div>
        <label htmlFor={`${formId}-rate`} className="block text-xs font-medium text-[var(--muted)] mb-1">
          Rate (% of allocation)
        </label>
        <input
          id={`${formId}-rate`}
          type="number"
          step="0.01"
          min="1"
          max="100"
          required
          value={rateStr}
          onChange={(e) => setRateStr(e.target.value)}
          className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
        />
      </div>

      <div>
        <label htmlFor={`${formId}-date`} className="block text-xs font-medium text-[var(--muted)] mb-1">
          Effective date
        </label>
        <input
          id={`${formId}-date`}
          type="date"
          required
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
          className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
        />
      </div>

      <div>
        <label htmlFor={`${formId}-ref`} className="block text-xs font-medium text-[var(--muted)] mb-1">
          Letter / reference no.
        </label>
        <input
          id={`${formId}-ref`}
          type="text"
          required
          value={refNo}
          onChange={(e) => setRefNo(e.target.value)}
          placeholder="Ref-001"
          className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
        />
      </div>

      {/* Live Preview */}
      <div className="pt-2 space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium">
          <span className="tabular-nums">Cap {formatTaka(previewStats.cap)}</span>
          <span className="tabular-nums text-[var(--accent)]">
            Spendable {formatTaka(previewStats.spendable)}
          </span>
        </div>
        <div className="h-2 rounded-full bg-[var(--surface-subtle)] overflow-hidden">
          <div
            className="h-full bg-[var(--accent)] transition-all"
            style={{ width: `${Math.max(0, Math.min(100, previewStats.pctUsedOfCap))}%` }}
          />
        </div>
      </div>

      {showInlineButtons && (
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              resetForm();
              setMobileAddOpen(false);
            }}
            className="flex-1 min-h-[44px] rounded-lg border border-[var(--line)] text-sm font-medium"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 min-h-[44px] rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save limit'}
          </button>
        </div>
      )}
    </form>
  );

  const actions = canManage ? (
    <button
      type="button"
      onClick={() => setMobileAddOpen(true)}
      className="xl:hidden min-h-[44px] md:min-h-[40px] px-3.5 md:px-4 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold whitespace-nowrap"
    >
      {t('newLimit')}
    </button>
  ) : null;

  return (
    <Layout title={t('navLimits')} actions={actions}>
      <div className="space-y-3.5 md:space-y-4">
        <div className="card-surface px-3.5 md:px-4 py-3 text-xs text-[var(--muted)]">
          Caps set by the ministry or directorate. Spending on a code or budget cannot exceed rate × allocation. If both a code cap and a budget cap apply, the stricter one wins.
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {([
            { id: 'all', label: t('all') },
            { id: 'code', label: t('onCode') },
            { id: 'budget', label: t('onSingleBudget') },
            { id: 'withdrawn', label: t('withdrawn') },
          ] as const).map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setFilter(tab.id);
                  setPage(1);
                }}
                className={`min-h-[44px] md:min-h-[38px] px-3.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'bg-[var(--card)] border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Table / Mobile Cards */}
          <div className={`${canManage ? 'xl:col-span-8' : 'xl:col-span-12'} card-surface overflow-hidden`}>
            {/* Mobile Card List */}
            <div className="md:hidden divide-y divide-[var(--line)]">
              {loading ? (
                <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                  Loading spending limits…
                </div>
              ) : pagedLimits.length === 0 ? (
                <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                  No spending limits for FY {selectedFy}.
                </div>
              ) : (
                pagedLimits.map((l) => {
                  const stats = computeRowNumbers(l);
                  const head = getHead(l.economicCode, {
                    headName: l.headName,
                    headNameBn: l.headNameBn,
                  });
                  return (
                    <div key={l.id} className="p-3.5 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border border-[var(--line)] text-[var(--muted)]">
                              {l.type === 'code' ? 'On code' : 'On budget'}
                            </span>
                            <span>· {stats.budgetLabel}</span>
                            <span className="tabular-nums">· Eff. {formatDateDisplay(l.effectiveDate)}</span>
                          </div>
                          <div className="text-sm font-medium text-[var(--text)] mt-1.5 break-words">
                            <span className="tabular-nums font-semibold">{l.economicCode}</span>{' '}
                            {head.headName}
                          </div>
                          {head.headNameBn && (
                            <div className="bn mt-0.5 break-words">{head.headNameBn}</div>
                          )}
                        </div>
                        <StatusChip variant={l.status === 'active' ? 'active' : 'withdrawn'}>
                          {l.status === 'active' ? t('active') : t('withdrawn')}
                        </StatusChip>
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-1.5 text-xs border-t border-[var(--line)]/60">
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">Rate · Cap</div>
                          <div className="font-medium tabular-nums truncate">
                            {l.rate}% · {formatNumberIN(stats.cap)}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">Spent</div>
                          <div className="font-medium tabular-nums truncate">
                            {l.status === 'active' ? formatNumberIN(stats.spent) : '—'}
                          </div>
                        </div>
                        <div className="min-w-0 text-right">
                          <div className="text-[11px] text-[var(--muted)]">Spendable</div>
                          <div className="font-semibold text-[var(--accent)] tabular-nums truncate">
                            {l.status === 'active' ? formatNumberIN(stats.spendable) : '—'}
                          </div>
                        </div>
                      </div>

                      {canManage && l.status === 'active' && (
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => handleWithdraw(l)}
                            className="min-h-[44px] w-full rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)]"
                          >
                            {t('withdraw')}
                          </button>
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
                    <th className="sticky left-0 z-10 bg-[var(--card)] py-3 px-4 font-medium whitespace-nowrap">Type</th>
                    <th className="py-3 px-4 font-medium">Code · Head</th>
                    <th className="py-3 px-4 font-medium">Budget</th>
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Rate</th>
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Cap</th>
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Spent</th>
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Spendable</th>
                    <th className="py-3 px-4 font-medium whitespace-nowrap">Effective</th>
                    <th className="py-3 px-4 font-medium whitespace-nowrap">Status</th>
                    {canManage && <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {loading ? (
                    <tr>
                      <td colSpan={canManage ? 10 : 9} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                        Loading spending limits…
                      </td>
                    </tr>
                  ) : pagedLimits.length === 0 ? (
                    <tr>
                      <td colSpan={canManage ? 10 : 9} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                        No spending limits for FY {selectedFy}.
                      </td>
                    </tr>
                  ) : (
                    pagedLimits.map((l) => {
                      const stats = computeRowNumbers(l);
                      const head = getHead(l.economicCode, {
                        headName: l.headName,
                        headNameBn: l.headNameBn,
                      });
                      return (
                        <tr key={l.id} className="group hover:bg-[var(--surface-subtle)] transition-colors">
                          <td className="sticky left-0 z-10 bg-[var(--card)] group-hover:bg-[var(--surface-subtle)] py-3 px-4 whitespace-nowrap transition-colors">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs border border-[var(--line)] text-[var(--muted)]">
                              {l.type === 'code' ? 'On code' : 'On budget'}
                            </span>
                          </td>
                          <td className="py-3 px-4 min-w-[180px]">
                            <div className="font-medium text-[var(--text)]">
                              <span className="tabular-nums">{l.economicCode}</span> {head.headName}
                            </div>
                            {head.headNameBn && <div className="bn">{head.headNameBn}</div>}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-xs text-[var(--muted)]">
                            {stats.budgetLabel}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                            {l.rate}%
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                            {formatNumberIN(stats.cap)}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                            {l.status === 'active' ? formatNumberIN(stats.spent) : '—'}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap font-medium">
                            {l.status === 'active' ? formatNumberIN(stats.spendable) : '—'}
                          </td>
                          <td className="py-3 px-4 tabular-nums whitespace-nowrap text-xs text-[var(--muted)]">
                            {formatDateDisplay(l.effectiveDate)}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <StatusChip variant={l.status === 'active' ? 'active' : 'withdrawn'}>
                              {l.status === 'active' ? t('active') : t('withdrawn')}
                            </StatusChip>
                          </td>
                          {canManage && (
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              {l.status === 'active' ? (
                                <button
                                  type="button"
                                  onClick={() => handleWithdraw(l)}
                                  className="min-h-[34px] px-2.5 rounded-md border border-[var(--line)] text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)]"
                                >
                                  {t('withdraw')}
                                </button>
                              ) : (
                                <span className="text-xs text-[var(--muted)]">—</span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              totalItems={filteredLimits.length}
              onPageChange={setPage}
            />
          </div>

          {/* Desktop Side Form */}
          {canManage && (
            <div className="hidden xl:block xl:col-span-4 card-surface p-5">
              <h2 className="text-base font-semibold text-[var(--text)] mb-3">Add limit</h2>
              {renderAddLimitForm('desktop-limit-form', true)}
            </div>
          )}
        </div>
      </div>

      {/* Mobile Add Limit Modal */}
      <Modal
        open={mobileAddOpen}
        onClose={() => setMobileAddOpen(false)}
        title="Add limit"
        subtitle={`FY ${selectedFy}`}
        maxWidthClass="md:max-w-lg"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                resetForm();
                setMobileAddOpen(false);
              }}
              className="flex-1 min-h-[44px] rounded-lg border border-[var(--line)] text-sm font-medium"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="mobile-limit-form"
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save limit'}
            </button>
          </div>
        }
      >
        {renderAddLimitForm('mobile-limit-form', false)}
      </Modal>
    </Layout>
  );
}
