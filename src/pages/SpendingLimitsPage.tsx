import React, { useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { StatusChip } from '../components/StatusChip';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { useFyData } from '../hooks/useFyData';
import { formatDateDisplay, todayYmd } from '../lib/dates';
import { createSpendingLimitTx, withdrawSpendingLimit } from '../lib/firestoreOps';
import { formatNumberIN, formatTaka } from '../lib/money';
import { canManageLimits } from '../lib/permissions';
import type { SpendingLimitDoc, SpendingLimitType } from '../types';

export function SpendingLimitsPage() {
  const { userDoc } = useAuth();
  const { selectedFy, pushToast, t } = useApp();
  const { budgets, fyCodeTotals, spendingLimits, vatTaxRates, loading } = useFyData(selectedFy);

  const canManage = userDoc ? canManageLimits(userDoc.role) : false;

  const [filter, setFilter] = useState<'all' | 'code' | 'budget' | 'withdrawn'>('all');
  const [page, setPage] = useState(1);
  const [mobileAddOpen, setMobileAddOpen] = useState(false);

  // Add limit form state
  const [limitType, setLimitType] = useState<SpendingLimitType>('code');
  const [economicCode, setEconomicCode] = useState('');
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

  // Code options from budgets + vatTaxRates in FY
  const codeOptions = useMemo(() => {
    const map = new Map<string, { code: string; head: string; headBn: string }>();
    for (const b of budgets) {
      map.set(b.economicCode, {
        code: b.economicCode,
        head: b.headName,
        headBn: b.headNameBn,
      });
    }
    for (const r of vatTaxRates) {
      if (/^\d{7}$/.test(r.economicCode) && !map.has(r.economicCode)) {
        map.set(r.economicCode, {
          code: r.economicCode,
          head: r.description,
          headBn: r.descriptionBn,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [budgets, vatTaxRates]);

  const handleCodeChange = (val: string) => {
    setEconomicCode(val);
    const found = codeOptions.find((c) => c.code === val.trim());
    if (found) {
      setHeadName(found.head);
      setHeadNameBn(found.headBn);
    }
    if (limitType === 'budget') {
      const matchingBudget = budgets.find(
        (b) => b.economicCode === val.trim() && b.status === 'active'
      );
      if (matchingBudget) setBudgetId(matchingBudget.id);
    }
  };

  const handleSelectBudget = (id: string) => {
    setBudgetId(id);
    const b = budgets.find((item) => item.id === id);
    if (b) {
      setEconomicCode(b.economicCode);
      setHeadName(b.headName);
      setHeadNameBn(b.headNameBn);
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
    setSaving(true);
    try {
      await createSpendingLimitTx(
        {
          type: limitType,
          budgetId: limitType === 'budget' ? budgetId : null,
          fiscalYear: selectedFy,
          economicCode,
          headName,
          headNameBn,
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

  const addLimitFormContent = (
    <form onSubmit={handleSaveLimit} className="space-y-3.5">
      <div>
        <div className="text-xs font-medium text-[var(--muted)] mb-1.5">Type</div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => {
              setLimitType('code');
              setBudgetId('');
            }}
            className={`min-h-[40px] px-2.5 rounded-lg text-xs font-semibold transition-colors ${
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
            className={`min-h-[40px] px-2.5 rounded-lg text-xs font-semibold transition-colors ${
              limitType === 'budget'
                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                : 'border border-[var(--line)] text-[var(--text)]'
            }`}
          >
            On single budget
          </button>
        </div>
      </div>

      <div>
        <label htmlFor="limit-code" className="block text-xs font-medium text-[var(--muted)] mb-1">
          Economic code
        </label>
        <input
          id="limit-code"
          type="text"
          required
          list="limit-code-list"
          value={economicCode}
          onChange={(e) => handleCodeChange(e.target.value)}
          placeholder="3211106"
          className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm tabular-nums"
        />
        <datalist id="limit-code-list">
          {codeOptions.map((c) => (
            <option key={c.code} value={c.code}>
              {c.head} {c.headBn}
            </option>
          ))}
        </datalist>
      </div>

      <div>
        <label htmlFor="limit-head" className="block text-xs font-medium text-[var(--muted)] mb-1">
          Head (ব্যয়ের খাত)
        </label>
        <input
          id="limit-head"
          type="text"
          required
          value={headName}
          onChange={(e) => setHeadName(e.target.value)}
          placeholder="Entertainment"
          className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
        />
        {headNameBn && <div className="bn mt-1">{headNameBn}</div>}
      </div>

      {limitType === 'budget' && (
        <div>
          <label htmlFor="limit-budget" className="block text-xs font-medium text-[var(--muted)] mb-1">
            Budget entry
          </label>
          <select
            id="limit-budget"
            required
            value={budgetId}
            onChange={(e) => handleSelectBudget(e.target.value)}
            className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
          >
            <option value="">Select budget…</option>
            {budgets
              .filter((b) => !economicCode.trim() || b.economicCode === economicCode.trim())
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.memoNo} · {b.economicCode} {b.headName} ({formatTaka(b.allocated)})
                </option>
              ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="limit-rate" className="block text-xs font-medium text-[var(--muted)] mb-1">
          Rate (% of allocation)
        </label>
        <input
          id="limit-rate"
          type="number"
          step="0.01"
          min="1"
          max="100"
          required
          value={rateStr}
          onChange={(e) => setRateStr(e.target.value)}
          className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm tabular-nums"
        />
      </div>

      <div>
        <label htmlFor="limit-date" className="block text-xs font-medium text-[var(--muted)] mb-1">
          Effective date
        </label>
        <input
          id="limit-date"
          type="date"
          required
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
          className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm tabular-nums"
        />
      </div>

      <div>
        <label htmlFor="limit-ref" className="block text-xs font-medium text-[var(--muted)] mb-1">
          Letter / reference no.
        </label>
        <input
          id="limit-ref"
          type="text"
          required
          value={refNo}
          onChange={(e) => setRefNo(e.target.value)}
          placeholder="Ref-001"
          className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
        />
      </div>

      {/* Live Preview */}
      <div className="pt-2 space-y-1.5">
        <div className="flex items-center justify-between text-xs font-medium">
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

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={() => {
            resetForm();
            setMobileAddOpen(false);
          }}
          className="flex-1 min-h-[42px] rounded-lg border border-[var(--line)] text-sm font-medium"
        >
          {t('cancel')}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 min-h-[42px] rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save limit'}
        </button>
      </div>
    </form>
  );

  const actions = canManage ? (
    <button
      type="button"
      onClick={() => setMobileAddOpen(true)}
      className="xl:hidden min-h-[40px] px-4 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold whitespace-nowrap"
    >
      {t('newLimit')}
    </button>
  ) : null;

  return (
    <Layout title={t('navLimits')} actions={actions}>
      <div className="space-y-4">
        <div className="card-surface px-4 py-3 text-xs text-[var(--muted)]">
          Caps set by the ministry or directorate. Spending on a code or budget cannot exceed rate × allocation. If both a code cap and a budget cap apply, the stricter one wins.
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
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
                className={`min-h-[38px] px-3.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
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
          {/* Table */}
          <div className={`${canManage ? 'xl:col-span-8' : 'xl:col-span-12'} card-surface overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                    <th className="py-3 px-4 font-medium">Type</th>
                    <th className="py-3 px-4 font-medium">Code · Head</th>
                    <th className="py-3 px-4 font-medium">Budget</th>
                    <th className="py-3 px-4 font-medium text-right">Rate</th>
                    <th className="py-3 px-4 font-medium text-right">Cap</th>
                    <th className="py-3 px-4 font-medium text-right">Spent</th>
                    <th className="py-3 px-4 font-medium text-right">Spendable</th>
                    <th className="py-3 px-4 font-medium whitespace-nowrap">Effective</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    {canManage && <th className="py-3 px-4 font-medium text-right">Action</th>}
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
                      return (
                        <tr key={l.id} className="hover:bg-[var(--surface-subtle)] transition-colors">
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs border border-[var(--line)] text-[var(--muted)]">
                              {l.type === 'code' ? 'On code' : 'On budget'}
                            </span>
                          </td>
                          <td className="py-3 px-4 min-w-[180px]">
                            <div className="font-medium text-[var(--text)]">
                              <span className="tabular-nums">{l.economicCode}</span> {l.headName}
                            </div>
                            {l.headNameBn && <div className="bn">{l.headNameBn}</div>}
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
              {addLimitFormContent}
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
      >
        {addLimitFormContent}
      </Modal>
    </Layout>
  );
}
