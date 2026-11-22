import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Building2, Wallet } from 'lucide-react';
import { db } from '../lib/firebase';
import { Layout } from '../components/Layout';
import { Modal, ModalFooter } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { StatusChip } from '../components/StatusChip';
import { EconomicCodeSelect } from '../components/EconomicCodeSelect';
import { Field, Segmented, Select, TextInput, focusFirstInvalidField } from '../components/form';
import { useAuth } from '../contexts/AuthContext';
import { ALL_OFFICES_ID, LEGACY_UNMIGRATED_OFFICE_ID, useApp } from '../contexts/AppContext';
import { useFyData } from '../hooks/useFyData';
import { useAllOfficesSummary } from '../hooks/useAllOfficesSummary';
import { useEconomicCodes } from '../hooks/useEconomicCodes';
import { formatDateDisplay, todayYmd } from '../lib/dates';
import { isPermissionDeniedError, logFirestoreError, OperationType } from '../lib/firestoreError';
import {
  createSpendingLimitsForAllOfficesBatch,
  createSpendingLimitTx,
  withdrawSpendingLimit,
} from '../lib/firestoreOps';
import { formatNumberIN, formatTaka } from '../lib/money';
import { canManageLimits } from '../lib/permissions';
import type { EconomicCodeDoc, SpendingLimitDoc, SpendingLimitType } from '../types';

const ALL_ACTIVE_OFFICES_TARGET = '__ALL_ACTIVE__';

export function SpendingLimitsPage() {
  const { userDoc, isSuperAdmin } = useAuth();
  const {
    selectedFy,
    currentOfficeId,
    currentOfficeRole,
    offices,
    officesById,
    isAllOfficesMode,
    isLegacyPreMigration,
    actorSnapshot,
    reportPermissionError,
    clearPermissionError,
    pushToast,
    t,
  } = useApp();

  const { budgets, fyCodeTotals, spendingLimits, loading } = useFyData(selectedFy);
  const { totals: allOfficesFyTotals, loading: allTotalsLoading } = useAllOfficesSummary(
    selectedFy,
    Boolean(isSuperAdmin && isAllOfficesMode)
  );
  const { getCodeEntry, getHead } = useEconomicCodes();

  const realOfficeId =
    currentOfficeId &&
    currentOfficeId !== ALL_OFFICES_ID &&
    currentOfficeId !== LEGACY_UNMIGRATED_OFFICE_ID
      ? currentOfficeId
      : '';

  const permCtx = { isSuperAdmin, officeRole: currentOfficeRole };
  const canManage =
    canManageLimits(permCtx) &&
    !isLegacyPreMigration &&
    Boolean(isSuperAdmin || realOfficeId);

  const effectiveActor =
    actorSnapshot || (userDoc ? { uid: userDoc.id, name: userDoc.name } : null);

  // Cross-office spendingLimits listener only when Super Admin is in All Offices mode
  const [allOfficesLimits, setAllOfficesLimits] = useState<SpendingLimitDoc[]>([]);
  const [allLimitsLoading, setAllLimitsLoading] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin || !isAllOfficesMode || !selectedFy) {
      setAllOfficesLimits([]);
      setAllLimitsLoading(false);
      return;
    }
    setAllLimitsLoading(true);
    const q = query(
      collection(db, 'spendingLimits'),
      where('fiscalYear', '==', selectedFy)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        clearPermissionError('spendingLimits');
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as SpendingLimitDoc))
          .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
        setAllOfficesLimits(list);
        setAllLimitsLoading(false);
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'spendingLimits');
        if (isPermissionDeniedError(err)) reportPermissionError('spendingLimits');
        setAllLimitsLoading(false);
      }
    );
    return () => unsub();
  }, [isSuperAdmin, isAllOfficesMode, selectedFy, clearPermissionError, reportPermissionError]);

  const displayedLimits =
    isSuperAdmin && isAllOfficesMode ? allOfficesLimits : spendingLimits;
  const displayedLoading =
    isSuperAdmin && isAllOfficesMode ? allLimitsLoading || allTotalsLoading : loading;

  const [filter, setFilter] = useState<'all' | 'code' | 'budget' | 'withdrawn'>('all');
  const [page, setPage] = useState(1);
  const [mobileAddOpen, setMobileAddOpen] = useState(false);

  // Add limit form state
  const [targetScope, setTargetScope] = useState<string>(
    realOfficeId || ALL_ACTIVE_OFFICES_TARGET
  );
  const [limitType, setLimitType] = useState<SpendingLimitType>('code');
  const [economicCode, setEconomicCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [headName, setHeadName] = useState('');
  const [headNameBn, setHeadNameBn] = useState('');
  const [budgetId, setBudgetId] = useState('');
  const [rateStr, setRateStr] = useState('80');
  const [effectiveDate, setEffectiveDate] = useState(todayYmd());
  const [refNo, setRefNo] = useState('');
  const [budgetError, setBudgetError] = useState('');
  const [rateError, setRateError] = useState('');
  const [dateError, setDateError] = useState('');
  const [refError, setRefError] = useState('');
  const [saving, setSaving] = useState(false);

  // Sync default targetScope when header office changes
  useEffect(() => {
    if (isSuperAdmin) {
      setTargetScope(realOfficeId || ALL_ACTIVE_OFFICES_TARGET);
    } else if (realOfficeId) {
      setTargetScope(realOfficeId);
    }
  }, [isSuperAdmin, realOfficeId]);

  const isBatchAllOffices =
    isSuperAdmin && targetScope === ALL_ACTIVE_OFFICES_TARGET;

  // Enforce 'code' limit type when targeting all offices or another office without loaded budgets
  useEffect(() => {
    if (isBatchAllOffices || (isSuperAdmin && targetScope !== realOfficeId)) {
      setLimitType('code');
      setBudgetId('');
    }
  }, [isBatchAllOffices, isSuperAdmin, targetScope, realOfficeId]);

  const activeOffices = useMemo(
    () => offices.filter((o) => o.status === 'active'),
    [offices]
  );

  const filteredLimits = useMemo(() => {
    return displayedLimits.filter((l) => {
      if (filter === 'all') return true;
      if (filter === 'withdrawn') return l.status === 'withdrawn';
      if (filter === 'code') return l.type === 'code' && l.status === 'active';
      if (filter === 'budget') return l.type === 'budget' && l.status === 'active';
      return true;
    });
  }, [displayedLimits, filter]);

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
    setBudgetError('');
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
    let pending = 0;
    const code = economicCode.trim();

    if (limitType === 'code' && code) {
      if (isBatchAllOffices && isAllOfficesMode) {
        const matchingTotals = allOfficesFyTotals.filter((f) => f.economicCode === code);
        allocated = matchingTotals.reduce((s, f) => s + f.allocated, 0);
        spent = matchingTotals.reduce((s, f) => s + f.spent, 0);
        pending = matchingTotals.reduce((s, f) => s + Math.max(0, f.pendingAmount || 0), 0);
      } else if (isSuperAdmin && isAllOfficesMode && targetScope) {
        const tot = allOfficesFyTotals.find(
          (f) => f.officeId === targetScope && f.economicCode === code
        );
        if (tot) {
          allocated = tot.allocated;
          spent = tot.spent;
          pending = Math.max(0, tot.pendingAmount || 0);
        }
      } else if (targetScope === realOfficeId) {
        const tot = fyCodeTotals.find((f) => f.economicCode === code);
        if (tot) {
          allocated = tot.allocated;
          spent = tot.spent;
          pending = Math.max(0, tot.pendingAmount || 0);
        } else {
          const matching = budgets.filter((b) => b.economicCode === code);
          allocated = matching.reduce((acc, b) => acc + b.allocated, 0);
          spent = matching.reduce((acc, b) => acc + b.spent, 0);
          pending = matching.reduce((acc, b) => acc + Math.max(0, b.pendingAmount || 0), 0);
        }
      }
    } else if (limitType === 'budget' && budgetId) {
      const b = budgets.find((item) => item.id === budgetId);
      if (b) {
        allocated = b.allocated;
        spent = b.spent;
        pending = Math.max(0, b.pendingAmount || 0);
      }
    }
    const cap = Math.round((allocated * rate) / 100);
    const spendable = cap - spent - pending;
    const pctUsedOfCap =
      cap > 0 ? Math.min(100, Math.round(((spent + pending) / cap) * 100)) : 0;
    return { allocated, spent, pending, cap, spendable, pctUsedOfCap };
  }, [
    limitType,
    economicCode,
    budgetId,
    rateStr,
    fyCodeTotals,
    budgets,
    isBatchAllOffices,
    isAllOfficesMode,
    isSuperAdmin,
    targetScope,
    realOfficeId,
    allOfficesFyTotals,
  ]);

  const resetForm = () => {
    setLimitType('code');
    setEconomicCode('');
    setCodeError('');
    setBudgetError('');
    setRateError('');
    setDateError('');
    setRefError('');
    setHeadName('');
    setHeadNameBn('');
    setBudgetId('');
    setRateStr('80');
    setEffectiveDate(todayYmd());
    setRefNo('');
  };

  const isLimitDirty = useMemo(
    () =>
      Boolean(
        economicCode.trim() ||
          budgetId ||
          rateStr !== '80' ||
          refNo.trim() ||
          limitType !== 'code'
      ),
    [economicCode, budgetId, rateStr, refNo, limitType]
  );

  const handleSaveLimit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!effectiveActor || !canManage) return;
    const formEl = e.currentTarget;
    const code = economicCode.trim();
    const masterEntry = getCodeEntry(code);
    const rateParsed = parseFloat(rateStr);

    let hasError = false;
    if (!masterEntry) {
      setCodeError('Select a valid economic code from Economic Codes.');
      hasError = true;
    } else if (masterEntry.special) {
      setCodeError('GENERAL-CONSTRUCTION cannot be used for a spending limit.');
      hasError = true;
    } else {
      setCodeError('');
    }

    if (limitType === 'budget' && !budgetId) {
      setBudgetError('Select a budget entry.');
      hasError = true;
    } else {
      setBudgetError('');
    }

    if (Number.isNaN(rateParsed) || rateParsed < 1 || rateParsed > 100) {
      setRateError('Enter a rate between 1 and 100%.');
      hasError = true;
    } else {
      setRateError('');
    }

    if (!effectiveDate) {
      setDateError('Effective date is required.');
      hasError = true;
    } else {
      setDateError('');
    }

    if (!refNo.trim()) {
      setRefError('Letter / reference no. is required.');
      hasError = true;
    } else {
      setRefError('');
    }

    if (hasError || !masterEntry || masterEntry.special) {
      if (!masterEntry) pushToast('error', 'Select a valid economic code.');
      else if (masterEntry.special) pushToast('error', 'GENERAL-CONSTRUCTION cannot be used for a spending limit.');
      requestAnimationFrame(() => focusFirstInvalidField(formEl));
      return;
    }

    setSaving(true);
    try {
      if (isBatchAllOffices) {
        const count = await createSpendingLimitsForAllOfficesBatch(
          {
            offices,
            fiscalYear: selectedFy,
            economicCode: code,
            headName: masterEntry.headName,
            headNameBn: masterEntry.headNameBn,
            rate: parseFloat(rateStr) || 0,
            effectiveDate,
            refNo,
          },
          effectiveActor
        );
        pushToast('success', `Spending limit applied to ${count} active office(s).`);
      } else {
        const targetOfficeId = isSuperAdmin ? targetScope : realOfficeId;
        if (!targetOfficeId || targetOfficeId === ALL_ACTIVE_OFFICES_TARGET) {
          throw new Error('Select a valid office.');
        }
        await createSpendingLimitTx(
          {
            officeId: targetOfficeId,
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
          effectiveActor
        );
        pushToast('success', 'Spending limit saved.');
      }
      resetForm();
      setMobileAddOpen(false);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to save limit.');
    } finally {
      setSaving(false);
    }
  };

  const handleWithdraw = async (limit: SpendingLimitDoc) => {
    if (!effectiveActor || !canManage) return;
    try {
      await withdrawSpendingLimit(limit, effectiveActor);
      pushToast('success', 'Spending limit withdrawn.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to withdraw limit.');
    }
  };

  const computeRowNumbers = (l: SpendingLimitDoc) => {
    let allocated = 0;
    let spent = 0;
    let pending = 0;
    let budgetLabel = 'All entries';
    let hasStats = false;

    if (l.type === 'code') {
      if (isAllOfficesMode) {
        const tot = allOfficesFyTotals.find(
          (f) => f.officeId === l.officeId && f.economicCode === l.economicCode
        );
        if (tot) {
          allocated = tot.allocated;
          spent = tot.spent;
          pending = Math.max(0, tot.pendingAmount || 0);
          hasStats = true;
        }
      } else {
        const tot = fyCodeTotals.find((f) => f.economicCode === l.economicCode);
        if (tot) {
          allocated = tot.allocated;
          spent = tot.spent;
          pending = Math.max(0, tot.pendingAmount || 0);
          hasStats = true;
        } else {
          const matching = budgets.filter((b) => b.economicCode === l.economicCode);
          allocated = matching.reduce((s, b) => s + b.allocated, 0);
          spent = matching.reduce((s, b) => s + b.spent, 0);
          pending = matching.reduce((s, b) => s + Math.max(0, b.pendingAmount || 0), 0);
          hasStats = matching.length > 0;
        }
      }
    } else if (l.budgetId) {
      const b = budgets.find((item) => item.id === l.budgetId);
      if (b) {
        allocated = b.allocated;
        spent = b.spent;
        pending = Math.max(0, b.pendingAmount || 0);
        budgetLabel = b.memoNo;
        hasStats = true;
      } else {
        budgetLabel = l.budgetId;
      }
    }
    const cap = Math.round((allocated * l.rate) / 100);
    const spendable = cap - spent - pending;
    return { cap, spent, pending, spendable, budgetLabel, hasStats };
  };

  const singleBudgetDisabled =
    isBatchAllOffices || (isSuperAdmin && targetScope !== realOfficeId);

  const renderAddLimitForm = (formId: string, showInlineButtons: boolean) => (
    <form id={formId} onSubmit={handleSaveLimit} noValidate className="space-y-4">
      {isSuperAdmin && (
        <Field
          label="Target Office"
          htmlFor={`${formId}-office`}
          hint={
            isBatchAllOffices
              ? 'Applies an economic-code limit to every active office simultaneously.'
              : undefined
          }
        >
          <Select
            id={`${formId}-office`}
            modalTitle="Select Target Office"
            modalIcon={<Building2 className="w-5 h-5" />}
            optionIcon={<Building2 className="w-4 h-4" />}
            clearable={false}
            value={targetScope}
            onChange={(e) => setTargetScope(e.target.value)}
            options={[
              {
                value: ALL_ACTIVE_OFFICES_TARGET,
                label: `All active offices (${activeOffices.length})`,
                subtitle: 'Applies to all active offices simultaneously',
              },
              ...activeOffices.map((off) => ({
                value: off.id,
                label: off.nameBn || off.name,
                subtitle: `কোড: ${off.code}`,
                keywords: `${off.name} ${off.nameBn} ${off.code}`,
              })),
            ]}
          />
        </Field>
      )}

      <Field label="Type" labelAs="span">
        <Segmented
          ariaLabel="Limit type"
          value={limitType}
          onChange={(next) => {
            setLimitType(next);
            if (next === 'code') {
              setBudgetId('');
              setBudgetError('');
            }
          }}
          options={[
            { value: 'code', label: 'On economic code' },
            { value: 'budget', label: 'On single budget', disabled: singleBudgetDisabled },
          ]}
        />
      </Field>

      <Field label="Economic code" labelAs="span" required error={codeError}>
        <EconomicCodeSelect
          label=""
          value={economicCode}
          onChange={handleCodeChange}
          includeSpecial={false}
          placeholder="Select economic code…"
        />
      </Field>

      {limitType === 'budget' && (
        <Field label="Budget entry" htmlFor={`${formId}-budget`} required error={budgetError}>
          <Select
            id={`${formId}-budget`}
            placeholder="Select budget…"
            modalTitle="Select Budget Entry"
            modalIcon={<Wallet className="w-5 h-5" />}
            emptyIcon={<Wallet className="w-4 h-4" />}
            optionIcon={<Wallet className="w-4 h-4" />}
            clearable
            value={budgetId}
            onChange={(e) => handleSelectBudget(e.target.value)}
            options={budgets
              .filter((b) => !economicCode.trim() || b.economicCode === economicCode.trim())
              .map((b) => {
                const head = getHead(b.economicCode, {
                  headName: b.headName,
                  headNameBn: b.headNameBn,
                });
                return {
                  value: b.id,
                  label: `${b.memoNo} · ${b.economicCode}`,
                  subtitle: head.displayName,
                  metaRight: formatTaka(b.allocated),
                  keywords: `${b.memoNo} ${b.economicCode} ${head.displayName}`,
                };
              })}
          />
        </Field>
      )}

      <Field label="Rate (% of allocation)" htmlFor={`${formId}-rate`} required error={rateError}>
        <TextInput
          id={`${formId}-rate`}
          type="number"
          step="0.01"
          min="1"
          max="100"
          value={rateStr}
          onChange={(e) => {
            setRateStr(e.target.value);
            if (rateError) setRateError('');
          }}
          className="tabular-nums"
        />
      </Field>

      <Field label="Effective date" htmlFor={`${formId}-date`} required error={dateError}>
        <TextInput
          id={`${formId}-date`}
          type="date"
          value={effectiveDate}
          onChange={(e) => {
            setEffectiveDate(e.target.value);
            if (dateError) setDateError('');
          }}
          className="tabular-nums"
        />
      </Field>

      <Field label="Letter / reference no." htmlFor={`${formId}-ref`} required error={refError}>
        <TextInput
          id={`${formId}-ref`}
          type="text"
          value={refNo}
          onChange={(e) => {
            setRefNo(e.target.value);
            if (refError) setRefError('');
          }}
          placeholder="Ref-001"
        />
      </Field>

      {/* Live Preview */}
      <div className="pt-1 space-y-1.5">
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
        <div className="flex gap-2.5 pt-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              resetForm();
              setMobileAddOpen(false);
            }}
            className="flex-1 min-h-[44px] rounded-xl border border-[var(--border-strong)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--surface-subtle)] text-sm font-medium transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 min-h-[44px] rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
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
    <Layout title={t('navLimits')}>
      <PageHeader title={t('navLimits')} actions={actions} />
      <div className="space-y-3.5 md:space-y-4">
        <div className="card-surface px-3.5 md:px-4 py-3 text-xs text-[var(--muted)]">
          Caps set by the ministry or directorate. Spending on a code or budget cannot exceed rate × allocation. If both a code cap and a budget cap apply, the stricter one wins.
        </div>

        {isLegacyPreMigration && (
          <div className="card-surface px-4 py-3 border-l-4 border-[var(--warn)] text-xs text-[var(--text)]">
            Complete the Multi-Office Migration in Settings before creating or managing office spending limits.
          </div>
        )}

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
              {displayedLoading ? (
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
                  const office = l.officeId ? officesById.get(l.officeId) : undefined;
                  return (
                    <div key={l.id} className="p-3.5 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border border-[var(--line)] text-[var(--muted)]">
                              {l.type === 'code' ? 'On code' : 'On budget'}
                            </span>
                            {office && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-[var(--surface-subtle)] text-[var(--text)] bn">
                                {office.nameBn || office.name}
                              </span>
                            )}
                            <span>· {stats.budgetLabel}</span>
                            <span className="tabular-nums">· Eff. {formatDateDisplay(l.effectiveDate)}</span>
                          </div>
                          <div className="text-sm font-medium text-[var(--text)] mt-1.5 break-words">
                            <span className="tabular-nums font-semibold">{l.economicCode}</span>{' '}
                            <span className="bn">{head.displayName}</span>
                          </div>
                        </div>
                        <StatusChip variant={l.status === 'active' ? 'active' : 'withdrawn'}>
                          {l.status === 'active' ? t('active') : t('withdrawn')}
                        </StatusChip>
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-1.5 text-xs border-t border-[var(--line)]/60">
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">Rate · Cap</div>
                          <div className="font-medium tabular-nums truncate">
                            {l.rate}% · {stats.hasStats ? formatNumberIN(stats.cap) : '—'}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">Spent</div>
                          <div className="font-medium tabular-nums truncate">
                            {l.status === 'active' && stats.hasStats ? formatNumberIN(stats.spent) : '—'}
                          </div>
                        </div>
                        <div className="min-w-0 text-right">
                          <div className="text-[11px] text-[var(--muted)]">Spendable</div>
                          <div className="font-semibold text-[var(--accent)] tabular-nums truncate">
                            {l.status === 'active' && stats.hasStats ? formatNumberIN(stats.spendable) : '—'}
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
                    {isAllOfficesMode && (
                      <th className="py-3 px-4 font-medium whitespace-nowrap">Office</th>
                    )}
                    <th className="py-3 px-4 font-medium">কোড · ব্যয়ের খাত</th>
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
                  {displayedLoading ? (
                    <tr>
                      <td
                        colSpan={(canManage ? 10 : 9) + (isAllOfficesMode ? 1 : 0)}
                        className="py-8 px-4 text-center text-sm text-[var(--muted)]"
                      >
                        Loading spending limits…
                      </td>
                    </tr>
                  ) : pagedLimits.length === 0 ? (
                    <tr>
                      <td
                        colSpan={(canManage ? 10 : 9) + (isAllOfficesMode ? 1 : 0)}
                        className="py-8 px-4 text-center text-sm text-[var(--muted)]"
                      >
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
                      const office = l.officeId ? officesById.get(l.officeId) : undefined;
                      return (
                        <tr key={l.id} className="group hover:bg-[var(--surface-subtle)] transition-colors">
                          <td className="sticky left-0 z-10 bg-[var(--card)] group-hover:bg-[var(--surface-subtle)] py-3 px-4 whitespace-nowrap transition-colors">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs border border-[var(--line)] text-[var(--muted)]">
                              {l.type === 'code' ? 'On code' : 'On budget'}
                            </span>
                          </td>
                          {isAllOfficesMode && (
                            <td className="py-3 px-4 whitespace-nowrap text-xs bn text-[var(--text)]">
                              {office ? office.nameBn || office.name : l.officeId || '—'}
                            </td>
                          )}
                          <td className="py-3 px-4 min-w-[180px]">
                            <div className="font-medium text-[var(--text)]">
                              <span className="tabular-nums">{l.economicCode}</span>{' '}
                              <span className="bn">{head.displayName}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-xs text-[var(--muted)]">
                            {stats.budgetLabel}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                            {l.rate}%
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                            {stats.hasStats ? formatNumberIN(stats.cap) : '—'}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                            {l.status === 'active' && stats.hasStats ? formatNumberIN(stats.spent) : '—'}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap font-medium">
                            {l.status === 'active' && stats.hasStats ? formatNumberIN(stats.spendable) : '—'}
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
        onClose={() => !saving && setMobileAddOpen(false)}
        title="Add limit"
        subtitle={`FY ${selectedFy}`}
        size="md"
        fullScreenOnMobile
        confirmClose={isLimitDirty && !saving}
        footer={
          <ModalFooter
            loading={saving}
            secondary={{
              label: t('cancel'),
              disabled: saving,
              onClick: () => {
                resetForm();
                setMobileAddOpen(false);
              },
            }}
            primary={{
              label: saving ? 'Saving…' : 'Save limit',
              type: 'submit',
              form: 'mobile-limit-form',
            }}
          />
        }
      >
        {renderAddLimitForm('mobile-limit-form', false)}
      </Modal>
    </Layout>
  );
}

