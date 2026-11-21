import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Plus, Search, Trash2, Wallet } from 'lucide-react';
import { ActivityList } from '../components/ActivityList';
import { EconomicCodeSelect } from '../components/EconomicCodeSelect';
import { EmptyState } from '../components/EmptyState';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { SegmentedChips } from '../components/SegmentedChips';
import { StatusChip, type ChipVariant } from '../components/StatusChip';
import { useAuth } from '../contexts/AuthContext';
import { ALL_OFFICES_ID, LEGACY_UNMIGRATED_OFFICE_ID, useApp } from '../contexts/AppContext';
import { useDocAuditLogs } from '../hooks/useAuditLogs';
import { useEconomicCodes } from '../hooks/useEconomicCodes';
import { useFyData } from '../hooks/useFyData';
import { formatActorBrief } from '../lib/actor';
import { formatDateDisplay, todayYmd } from '../lib/dates';
import {
  createBudgetsBatchTx,
  createBudgetTx,
  markBudgetStatusTx,
  softDeleteBudgetTx,
  updateBudgetTx,
  type CreateBudgetInput,
} from '../lib/firestoreOps';
import { formatNumberIN, formatPaisaInput, formatTaka, toPaisa } from '../lib/money';
import {
  canCreateBudgets,
  canEditDeleteBudgets,
  canMarkBudgetExecuted,
} from '../lib/permissions';
import type {
  BillStatus,
  BudgetDoc,
  BudgetEntryType,
  DeductionRates,
  EconomicCodeDoc,
} from '../types';

const DEFAULT_DEDUCTION_RATES: DeductionRates = {
  basis: 'gross',
  incomeTax: 0,
  vat: [{ key: 'default', label: 'Standard', rate: 0 }],
  serviceCharge: 0,
};

interface BudgetAllocationRowDraft {
  key: string;
  economicCode: string;
  headName: string;
  headNameBn: string;
  amountStr: string;
  codeError: string;
}

function makeEmptyAllocationRow(): BudgetAllocationRowDraft {
  return {
    key: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    economicCode: '',
    headName: '',
    headNameBn: '',
    amountStr: '',
    codeError: '',
  };
}

function computeBarShares(allocated: number, approved: number, pending: number) {
  if (allocated <= 0) {
    return { approvedPct: 0, pendingPct: 0, usedPct: 0 };
  }
  const approvedPct = Math.min(100, Math.max(0, (approved / allocated) * 100));
  const rawPendingPct = Math.max(0, (pending / allocated) * 100);
  const pendingPct = Math.min(Math.max(0, 100 - approvedPct), rawPendingPct);
  const usedPct = Math.min(100, Math.max(0, Math.round(((approved + pending) / allocated) * 100)));
  return { approvedPct, pendingPct, usedPct };
}

function billStatusVariant(status: BillStatus): ChipVariant {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'draft':
      return 'draft';
    case 'submitted':
      return 'submitted';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
      return 'cancelled';
  }
}

export function BudgetsPage() {
  const { userDoc, isSuperAdmin } = useAuth();
  const {
    selectedFy,
    currentOfficeId,
    currentOfficeRole,
    isAllOfficesMode,
    isLegacyPreMigration,
    actorSnapshot,
    officesById,
    pushToast,
    t,
  } = useApp();
  const { budgets, bills, vatTaxRates, spendingLimits, loading } = useFyData(selectedFy);
  const { getCodeEntry, getHead } = useEconomicCodes();

  const realOfficeId =
    currentOfficeId &&
    currentOfficeId !== ALL_OFFICES_ID &&
    currentOfficeId !== LEGACY_UNMIGRATED_OFFICE_ID
      ? currentOfficeId
      : '';

  const permCtx = { isSuperAdmin, officeRole: currentOfficeRole };
  const canCreate =
    !isAllOfficesMode &&
    !isLegacyPreMigration &&
    Boolean(realOfficeId) &&
    canCreateBudgets(permCtx);
  const canEditDelete =
    !isAllOfficesMode &&
    !isLegacyPreMigration &&
    Boolean(realOfficeId) &&
    canEditDeleteBudgets(permCtx);
  const canExecute =
    !isAllOfficesMode &&
    !isLegacyPreMigration &&
    Boolean(realOfficeId) &&
    canMarkBudgetExecuted(permCtx);

  const effectiveActor =
    actorSnapshot || (userDoc ? { uid: userDoc.id, name: userDoc.name } : null);

  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'executed'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

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
  const [allocationRows, setAllocationRows] = useState<BudgetAllocationRowDraft[]>([
    makeEmptyAllocationRow(),
  ]);
  const [correctionReason, setCorrectionReason] = useState('');
  const [saving, setSaving] = useState(false);

  // Super Admin audited delete confirmation modal
  const [deletingBudget, setDeletingBudget] = useState<BudgetDoc | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deletingSaving, setDeletingSaving] = useState(false);

  const fySummary = useMemo(() => {
    let allocated = 0;
    let spent = 0;
    let pending = 0;
    let remaining = 0;
    let activeCount = 0;
    let executedCount = 0;

    for (const b of budgets) {
      allocated += b.allocated;
      spent += b.spent;
      pending += b.pendingAmount || 0;
      remaining += b.remaining;
      if (b.status === 'active') activeCount += 1;
      else executedCount += 1;
    }
    const { approvedPct, pendingPct, usedPct } = computeBarShares(allocated, spent, pending);
    return {
      allocated,
      spent,
      pending,
      remaining,
      approvedPct,
      pendingPct,
      usedPct,
      totalHeads: budgets.length,
      activeCount,
      executedCount,
    };
  }, [budgets]);

  const sameMemoBudgets = useMemo(() => {
    const trimmed = memoNo.trim();
    if (!trimmed) return [];
    return budgets.filter(
      (b) => b.memoNo === trimmed && (!editingBudget || b.id !== editingBudget.id)
    );
  }, [budgets, memoNo, editingBudget]);

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

  const groupedBudgets = useMemo(() => {
    const groups: Array<{
      key: string;
      memoNo: string;
      memoDate: string;
      totalAllocated: number;
      items: BudgetDoc[];
    }> = [];
    const byKey = new Map<string, number>();

    for (const b of pagedBudgets) {
      const k = `${b.memoNo}|${b.memoDate}`;
      const existingIdx = byKey.get(k);
      if (existingIdx === undefined) {
        byKey.set(k, groups.length);
        groups.push({
          key: k,
          memoNo: b.memoNo,
          memoDate: b.memoDate,
          totalAllocated: b.allocated,
          items: [b],
        });
      } else {
        groups[existingIdx].items.push(b);
        groups[existingIdx].totalAllocated += b.allocated;
      }
    }
    return groups;
  }, [pagedBudgets]);

  const selectedBudget = useMemo(() => {
    if (!selectedBudgetId) return null;
    return budgets.find((b) => b.id === selectedBudgetId) || null;
  }, [budgets, selectedBudgetId]);

  const { logs: selectedBudgetLogs, loading: logsLoading } = useDocAuditLogs(
    'budgets',
    detailOpen && selectedBudget ? selectedBudget.id : null
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

  const resolveDeductionRatesForCode = (code: string): DeductionRates => {
    const match = vatTaxRates.find((r) => r.economicCode === code.trim());
    if (match) {
      return {
        basis: 'gross',
        incomeTax: match.incomeTax,
        vat:
          match.vat.length > 0
            ? match.vat.map((v) => ({ ...v }))
            : [{ key: 'default', label: 'Standard', rate: 0 }],
        serviceCharge: 0,
      };
    }
    return {
      basis: 'gross',
      incomeTax: 0,
      vat: [{ key: 'default', label: 'Standard', rate: 0 }],
      serviceCharge: 0,
    };
  };

  const allocationBatchTotalPaisa = useMemo(() => {
    return allocationRows.reduce((sum, row) => {
      const p = toPaisa(row.amountStr);
      return Number.isFinite(p) && p > 0 ? sum + p : sum;
    }, 0);
  }, [allocationRows]);

  const updateAllocationRow = (idx: number, patch: Partial<BudgetAllocationRowDraft>) => {
    setAllocationRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

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
    setDeductionRates(DEFAULT_DEDUCTION_RATES);
    setAllocationRows([makeEmptyAllocationRow()]);
    setCorrectionReason('');
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
    setCorrectionReason('');
    setDetailOpen(false);
    setFormOpen(true);
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
      const match = vatTaxRates.find((r) => r.economicCode === target.economicCode);
      setDeductionRates(
        match
          ? resolveDeductionRatesForCode(target.economicCode)
          : (JSON.parse(JSON.stringify(target.deductionRates)) as DeductionRates)
      );
    }
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveActor) return;

    if (editingBudget) {
      if (isSuperAdmin && !correctionReason.trim()) {
        pushToast('error', 'সংশোধনের কারণ উল্লেখ করা আবশ্যক।');
        return;
      }
      const allocatedPaisa = toPaisa(amountStr);
      if (Number.isNaN(allocatedPaisa)) {
        pushToast('error', 'Enter a valid taka amount.');
        return;
      }
      const code = economicCode.trim();
      const resolvedHead = getHead(code, { headName, headNameBn });
      setSaving(true);
      try {
        await updateBudgetTx(
          editingBudget.id,
          {
            memoNo,
            memoDate,
            headName: resolvedHead.headName,
            headNameBn: resolvedHead.headNameBn,
            allocated: allocatedPaisa,
            deductionRates,
            correctionReason: correctionReason.trim() || undefined,
          },
          effectiveActor
        );
        pushToast('success', 'Budget updated.');
        setFormOpen(false);
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : 'Failed to save budget.');
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!realOfficeId) {
      pushToast('error', 'প্রথমে একটি নির্দিষ্ট দপ্তর নির্বাচন করুন।');
      return;
    }

    if (entryType === 'revision') {
      const allocatedPaisa = toPaisa(amountStr);
      if (Number.isNaN(allocatedPaisa)) {
        pushToast('error', 'Enter a valid taka amount.');
        return;
      }
      const code = economicCode.trim();
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
      const resolvedHead = getHead(code, { headName, headNameBn });
      setSaving(true);
      try {
        const newId = await createBudgetTx(
          {
            officeId: realOfficeId,
            fiscalYear: selectedFy,
            memoNo,
            memoDate,
            economicCode: code,
            headName: resolvedHead.headName,
            headNameBn: resolvedHead.headNameBn,
            allocated: allocatedPaisa,
            entryType: 'revision',
            revisionOf,
            deductionRates: resolveDeductionRatesForCode(code),
          },
          effectiveActor
        );
        setSelectedBudgetId(newId);
        pushToast('success', 'Budget revision created.');
        setFormOpen(false);
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : 'Failed to save budget.');
      } finally {
        setSaving(false);
      }
      return;
    }

    // New Original Allocation (supports 1 or more economic code + amount rows under same memo)
    const batchInputs: CreateBudgetInput[] = [];
    const seenCodes = new Set<string>();
    let hasRowError = false;

    const nextRows = allocationRows.map((row) => ({ ...row, codeError: '' }));
    for (let i = 0; i < nextRows.length; i++) {
      const row = nextRows[i];
      const code = row.economicCode.trim();
      const masterEntry = getCodeEntry(code);
      if (!masterEntry) {
        row.codeError = 'বৈধ ৭-অঙ্কের অর্থনৈতিক কোড নির্বাচন করুন।';
        hasRowError = true;
        continue;
      }
      if (masterEntry.special) {
        row.codeError = 'GENERAL-CONSTRUCTION বাজেটে ব্যবহার করা যাবে না।';
        hasRowError = true;
        continue;
      }
      if (seenCodes.has(code)) {
        row.codeError = `কোড ${code} ইতোমধ্যে উপরের সারিতে যোগ করা হয়েছে।`;
        hasRowError = true;
        continue;
      }
      seenCodes.add(code);

      const allocatedPaisa = toPaisa(row.amountStr);
      if (Number.isNaN(allocatedPaisa) || allocatedPaisa <= 0) {
        pushToast('error', `আইটেম #${i + 1} (${code}): ০ এর বেশি টাকার পরিমাণ দিন।`);
        setAllocationRows(nextRows);
        return;
      }

      const resolvedHead = getHead(code, {
        headName: row.headName || masterEntry.headName,
        headNameBn: row.headNameBn || masterEntry.headNameBn,
      });

      batchInputs.push({
        officeId: realOfficeId,
        fiscalYear: selectedFy,
        memoNo,
        memoDate,
        economicCode: code,
        headName: resolvedHead.headName,
        headNameBn: resolvedHead.headNameBn,
        allocated: allocatedPaisa,
        entryType: 'original',
        revisionOf: null,
        deductionRates: resolveDeductionRatesForCode(code),
      });
    }

    if (hasRowError) {
      setAllocationRows(nextRows);
      pushToast('error', 'অনুগ্রহ করে চিহ্নিত অর্থনৈতিক কোডগুলো সঠিকভাবে নির্বাচন করুন।');
      return;
    }

    setSaving(true);
    try {
      const createdIds = await createBudgetsBatchTx(batchInputs, effectiveActor);
      if (createdIds[0]) setSelectedBudgetId(createdIds[0]);
      pushToast(
        'success',
        createdIds.length > 1
          ? `${createdIds.length}টি অর্থনৈতিক কোডে বাজেট বরাদ্দ সংরক্ষণ হয়েছে।`
          : 'Budget created.'
      );
      setFormOpen(false);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to save budget.');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkExecuted = async (b: BudgetDoc) => {
    if (!effectiveActor || !canExecute) return;
    const nextStatus = b.status === 'active' ? 'executed' : 'active';
    try {
      await markBudgetStatusTx(b.id, nextStatus, effectiveActor);
      pushToast(
        'success',
        nextStatus === 'executed' ? 'Budget marked Executed.' : 'Budget reopened as Active.'
      );
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to update status.');
    }
  };

  const openDeleteBudgetModal = (b: BudgetDoc) => {
    if (!canEditDelete) return;
    setDetailOpen(false);
    setDeletingBudget(b);
    setDeleteReason('');
  };

  const handleConfirmDeleteBudget = async () => {
    if (!effectiveActor || !canEditDelete || !deletingBudget) return;
    if (!deleteReason.trim()) {
      pushToast('error', 'বাজেট মুছার কারণ লিখুন।');
      return;
    }
    setDeletingSaving(true);
    try {
      await softDeleteBudgetTx(deletingBudget.id, effectiveActor, deleteReason.trim());
      if (selectedBudgetId === deletingBudget.id) setSelectedBudgetId(null);
      setDeletingBudget(null);
      setDeleteReason('');
      setDetailOpen(false);
      pushToast('success', 'Budget deleted.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to delete budget.');
    } finally {
      setDeletingSaving(false);
    }
  };

  const handleOpenDetail = (id: string) => {
    setSelectedBudgetId(id);
    setDetailOpen(true);
  };

  const actions = canCreate ? (
    <button
      type="button"
      onClick={openNewBudgetModal}
      className="min-h-[44px] md:min-h-[40px] w-full sm:w-auto px-4 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <Plus className="w-4 h-4 shrink-0" />
      <span>{t('newBudget')}</span>
    </button>
  ) : null;

  if (isAllOfficesMode || (!currentOfficeId && !isLegacyPreMigration)) {
    return (
      <Layout title={t('navBudgets')}>
        <PageHeader title={t('navBudgets')} />
        <div className="card-surface p-6 text-center space-y-2 max-w-lg mx-auto my-6">
          <h2 className="text-base font-semibold text-[var(--text)] bn">
            একটি নির্দিষ্ট দপ্তর নির্বাচন করুন
          </h2>
          <p className="text-xs text-[var(--muted)] bn">
            বাজেট বরাদ্দ দেখতে বা পরিচালনা করতে উপরের হেডার অফিস সুইচার থেকে একটি নির্দিষ্ট দপ্তর বাছাই করুন। সামগ্রিক তুলনা দেখতে ড্যাশবোর্ড বা রিপোর্ট ব্যবহার করুন।
          </p>
        </div>
      </Layout>
    );
  }

  const selectedHead = selectedBudget
    ? getHead(selectedBudget.economicCode, {
        headName: selectedBudget.headName,
        headNameBn: selectedBudget.headNameBn,
      })
    : null;
  const selectedShares = selectedBudget
    ? computeBarShares(
        selectedBudget.allocated,
        selectedBudget.spent,
        selectedBudget.pendingAmount || 0
      )
    : { approvedPct: 0, pendingPct: 0, usedPct: 0 };

  return (
    <Layout title={t('navBudgets')}>
      <PageHeader title={t('navBudgets')} actions={actions} />

      <div className="space-y-3.5">
        {isLegacyPreMigration && (
          <div className="rounded-[14px] border border-[var(--warn-text)]/25 bg-[var(--warn-bg)] px-4 py-3 text-xs text-[var(--warn-text)]">
            মাল্টি-অফিস মাইগ্রেশন সম্পন্ন করার আগে নতুন বাজেট এন্ট্রি তৈরি করা যাবে না। Settings থেকে মাইগ্রেশন সম্পন্ন করুন।
          </div>
        )}

        {/* Hero Summary Card */}
        <section className="card-surface p-4 md:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
                {t('remainingAllocation')} · FY {selectedFy}
              </div>
              <div className="text-[28px] md:text-[30px] font-bold tracking-tight leading-tight text-[var(--text)] tabular-nums mt-0.5">
                {formatTaka(fySummary.remaining)}
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--surface-subtle)] text-[var(--muted)] tabular-nums whitespace-nowrap shrink-0">
              {fySummary.usedPct}% used
            </span>
          </div>

          <div
            className="h-2 rounded-full bg-[var(--surface-subtle)] border border-[var(--line)]/50 overflow-hidden flex my-3"
            role="img"
            aria-label="Approved and pending share of allocation"
          >
            {fySummary.approvedPct > 0 && (
              <span
                className="h-full bg-[var(--accent)] transition-all"
                style={{ width: `${fySummary.approvedPct}%` }}
              />
            )}
            {fySummary.pendingPct > 0 && (
              <span
                className="h-full bg-amber-500 transition-all"
                style={{ width: `${fySummary.pendingPct}%` }}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--muted)] tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--accent)]" aria-hidden="true" />
              <span>{t('approved')}</span>
              <strong className="text-[var(--text)] font-semibold">
                {formatNumberIN(fySummary.spent)}
              </strong>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden="true" />
              <span>{t('pendingAmount')}</span>
              <strong className="text-[var(--text)] font-semibold">
                {formatNumberIN(fySummary.pending)}
              </strong>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--line)]" aria-hidden="true" />
              <span>{t('allocated')}</span>
              <strong className="text-[var(--text)] font-semibold">
                {formatNumberIN(fySummary.allocated)}
              </strong>
            </span>
            <span>
              {fySummary.totalHeads} {fySummary.totalHeads === 1 ? 'head' : 'heads'}
            </span>
          </div>
        </section>

        {/* Status Chips */}
        <SegmentedChips
          ariaLabel="Filter budgets by status"
          value={statusFilter}
          onChange={(next) => {
            setStatusFilter(next);
            setPage(1);
          }}
          options={[
            { value: 'all', label: t('all'), count: fySummary.totalHeads },
            { value: 'active', label: t('active'), count: fySummary.activeCount },
            { value: 'executed', label: t('executed'), count: fySummary.executedCount },
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
            placeholder="স্মারক, কোড বা ব্যয়ের খাত খুঁজুন…"
            aria-label="Search budgets"
            className="w-full min-h-[44px] pl-10 pr-3.5 rounded-[12px] border border-[var(--line)] bg-[var(--card)] text-base md:text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>

        {/* Memo-Grouped Budget List */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, idx) => (
              <div key={idx} className="card-surface overflow-hidden animate-pulse" aria-hidden="true">
                <div className="px-4 py-3.5 bg-[var(--surface-subtle)] border-b border-[var(--line)] space-y-2">
                  <div className="h-3 w-16 rounded bg-[var(--line)]" />
                  <div className="h-4 w-56 rounded bg-[var(--line)]" />
                  <div className="h-3 w-40 rounded bg-[var(--line)]" />
                </div>
                <div className="p-4 space-y-3">
                  <div className="h-4 w-3/4 rounded bg-[var(--surface-subtle)]" />
                  <div className="h-1.5 w-full rounded bg-[var(--surface-subtle)]" />
                  <div className="h-3 w-1/2 rounded bg-[var(--surface-subtle)]" />
                </div>
              </div>
            ))}
          </div>
        ) : pagedBudgets.length === 0 ? (
          <EmptyState
            icon={<Wallet className="w-5 h-5" />}
            title={t('noDataFound')}
            description={
              search || statusFilter !== 'all'
                ? 'অন্য স্মারক, কোড বা স্ট্যাটাস দিয়ে খুঁজে দেখুন।'
                : `FY ${selectedFy}-এ এখনো কোনো বাজেট বরাদ্দ যুক্ত করা হয়নি।`
            }
            action={
              canCreate && !search && statusFilter === 'all' ? (
                <button
                  type="button"
                  onClick={openNewBudgetModal}
                  className="min-h-[44px] px-4 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t('newBudget')}</span>
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="space-y-3.5">
              {groupedBudgets.map((grp) => (
                <section key={grp.key} className="card-surface overflow-hidden">
                  <div className="px-4 py-3.5 bg-[var(--surface-subtle)] border-b border-[var(--line)]">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
                      {t('memoNo')}
                    </div>
                    <div className="text-[15px] font-bold text-[var(--text)] break-words mt-0.5">
                      {grp.memoNo}
                    </div>
                    <div className="text-xs text-[var(--muted)] tabular-nums mt-0.5">
                      {formatDateDisplay(grp.memoDate)} · {grp.items.length}{' '}
                      {grp.items.length === 1 ? 'head' : 'heads'} ·{' '}
                      {formatTaka(grp.totalAllocated)} allocated
                    </div>
                  </div>

                  <div className="divide-y divide-[var(--line)]">
                    {grp.items.map((b) => {
                      const head = getHead(b.economicCode, {
                        headName: b.headName,
                        headNameBn: b.headNameBn,
                      });
                      const rowShares = computeBarShares(
                        b.allocated,
                        b.spent,
                        b.pendingAmount || 0
                      );

                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => handleOpenDetail(b.id)}
                          className="w-full text-left px-4 py-3.5 hover:bg-[var(--surface-subtle)]/70 active:bg-[var(--surface-subtle)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <span className="text-[15px] font-bold tabular-nums text-[var(--text)] mr-2">
                                {b.economicCode}
                              </span>
                              <span className="text-[15px] font-medium text-[var(--text)] bn">
                                {head.displayName}
                              </span>
                              {b.entryType === 'revision' && (
                                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--warn-bg)] text-[var(--warn-text)]">
                                  Revision
                                </span>
                              )}
                            </div>

                            <div className="text-right shrink-0">
                              <div className="text-base font-bold tabular-nums text-[var(--accent)] leading-tight">
                                {formatNumberIN(b.remaining)}
                              </div>
                              <div className="text-[11px] text-[var(--muted)]">
                                {t('available')}
                              </div>
                            </div>
                          </div>

                          <div
                            className="h-1.5 rounded-full bg-[var(--surface-subtle)] border border-[var(--line)]/40 overflow-hidden flex my-2.5"
                            aria-hidden="true"
                          >
                            {rowShares.approvedPct > 0 && (
                              <span
                                className="h-full bg-[var(--accent)]"
                                style={{ width: `${rowShares.approvedPct}%` }}
                              />
                            )}
                            {rowShares.pendingPct > 0 && (
                              <span
                                className="h-full bg-amber-500"
                                style={{ width: `${rowShares.pendingPct}%` }}
                              />
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)] tabular-nums">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-full bg-[var(--accent)]"
                                aria-hidden="true"
                              />
                              <span>{t('approved')}</span>
                              <strong className="text-[var(--text)] font-semibold">
                                {formatNumberIN(b.spent)}
                              </strong>
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-full bg-amber-500"
                                aria-hidden="true"
                              />
                              <span>{t('pendingAmount')}</span>
                              <strong className="text-[var(--text)] font-semibold">
                                {formatNumberIN(b.pendingAmount || 0)}
                              </strong>
                            </span>
                            <span className="ml-auto">of {formatNumberIN(b.allocated)}</span>
                            <StatusChip variant={b.status === 'active' ? 'active' : 'executed'}>
                              {b.status === 'active' ? t('active') : t('executed')}
                            </StatusChip>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            {filteredBudgets.length > 50 && (
              <div className="card-surface overflow-hidden">
                <Pagination page={page} totalItems={filteredBudgets.length} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Budget Detail Sheet / Modal */}
      <Modal
        open={detailOpen && Boolean(selectedBudget)}
        onClose={() => setDetailOpen(false)}
        title={
          selectedBudget && selectedHead
            ? `${selectedBudget.economicCode} ${selectedHead.displayName}`
            : ''
        }
        subtitle={
          selectedBudget
            ? `Memo ${selectedBudget.memoNo} · ${formatDateDisplay(selectedBudget.memoDate)}`
            : ''
        }
        maxWidthClass="md:max-w-xl"
        footer={
          selectedBudget && (canEditDelete || canExecute) ? (
            <div className="flex flex-wrap items-center gap-2">
              {canEditDelete && (
                <button
                  type="button"
                  onClick={() => openEditBudgetModal(selectedBudget)}
                  className="min-h-[44px] flex-1 px-3.5 rounded-[10px] border border-[var(--line)] text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors whitespace-nowrap"
                >
                  {t('edit')}
                </button>
              )}
              {canExecute && (
                <button
                  type="button"
                  onClick={() => handleMarkExecuted(selectedBudget)}
                  className="min-h-[44px] flex-1 px-3.5 rounded-[10px] border border-[var(--line)] text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors whitespace-nowrap"
                >
                  {selectedBudget.status === 'active' ? t('markExecuted') : 'Reopen'}
                </button>
              )}
              {canEditDelete && (
                <button
                  type="button"
                  onClick={() => openDeleteBudgetModal(selectedBudget)}
                  className="min-h-[44px] flex-1 px-3.5 rounded-[10px] border border-[var(--danger-text)]/40 text-sm font-semibold text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40 transition-colors whitespace-nowrap"
                >
                  {t('delete')}
                </button>
              )}
            </div>
          ) : undefined
        }
      >
        {selectedBudget && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-[var(--muted)] bn">
                প্রস্তুতকারী:{' '}
                <span className="font-medium text-[var(--text)]">
                  {formatActorBrief(selectedBudget.createdBy, officesById)}
                </span>
              </div>
              <StatusChip variant={selectedBudget.status === 'active' ? 'active' : 'executed'}>
                {selectedBudget.status === 'active' ? t('active') : t('executed')}
              </StatusChip>
            </div>

            <div
              className="h-2 rounded-full bg-[var(--surface-subtle)] border border-[var(--line)]/50 overflow-hidden flex"
              aria-hidden="true"
            >
              {selectedShares.approvedPct > 0 && (
                <span
                  className="h-full bg-[var(--accent)]"
                  style={{ width: `${selectedShares.approvedPct}%` }}
                />
              )}
              {selectedShares.pendingPct > 0 && (
                <span
                  className="h-full bg-amber-500"
                  style={{ width: `${selectedShares.pendingPct}%` }}
                />
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm tabular-nums">
              <div>
                <div className="text-[11px] font-medium text-[var(--muted)]">{t('allocated')}</div>
                <div className="font-semibold text-[var(--text)]">
                  {formatNumberIN(selectedBudget.allocated)}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-[var(--muted)]">{t('approved')}</div>
                <div className="font-semibold text-[var(--text)]">
                  {formatNumberIN(selectedBudget.spent)}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-[var(--muted)]">
                  {t('pendingAmount')}
                </div>
                <div className="font-semibold text-[var(--warn-text)]">
                  {formatNumberIN(selectedBudget.pendingAmount || 0)}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-[var(--muted)]">{t('available')}</div>
                <div className="font-bold text-[var(--accent)]">
                  {formatNumberIN(selectedBudget.remaining)}
                </div>
              </div>
            </div>

            <div className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
              <details open className="group py-1">
                <summary className="min-h-[48px] flex items-center justify-between gap-2 cursor-pointer text-sm font-semibold text-[var(--text)] list-none">
                  <span>Deduction rates</span>
                  <ChevronDown className="w-4 h-4 text-[var(--muted)] transition-transform group-open:rotate-180" />
                </summary>
                <div className="pb-3 space-y-2.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)] px-3.5 py-2.5">
                      <div className="text-[11px] text-[var(--muted)]">Income Tax</div>
                      <div className="text-base font-bold tabular-nums text-[var(--text)]">
                        {selectedBudget.deductionRates.incomeTax}%
                      </div>
                    </div>
                    {selectedBudget.deductionRates.vat.map((v) => (
                      <div
                        key={v.key}
                        className="rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)] px-3.5 py-2.5"
                      >
                        <div className="text-[11px] text-[var(--muted)] truncate">
                          VAT {selectedBudget.deductionRates.vat.length > 1 ? `(${v.label})` : ''}
                        </div>
                        <div className="text-base font-bold tabular-nums text-[var(--text)]">
                          {v.rate}%
                        </div>
                      </div>
                    ))}
                    {selectedBudget.deductionRates.serviceCharge > 0 && (
                      <div className="rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)] px-3.5 py-2.5">
                        <div className="text-[11px] text-[var(--muted)]">Service Charge</div>
                        <div className="text-base font-bold tabular-nums text-[var(--text)]">
                          {selectedBudget.deductionRates.serviceCharge}%
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    Saved with this budget, so later rate changes do not alter it.
                  </p>
                </div>
              </details>

              <details className="group py-1">
                <summary className="min-h-[48px] flex items-center justify-between gap-2 cursor-pointer text-sm font-semibold text-[var(--text)] list-none">
                  <span>Revision chain ({revisionChain.length})</span>
                  <ChevronDown className="w-4 h-4 text-[var(--muted)] transition-transform group-open:rotate-180" />
                </summary>
                <div className="pb-3">
                  <ul className="space-y-1.5 text-xs">
                    {revisionChain.map((item) => (
                      <li key={item.id} className="flex items-center justify-between gap-2">
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
              </details>

              <details className="group py-1">
                <summary className="min-h-[48px] flex items-center justify-between gap-2 cursor-pointer text-sm font-semibold text-[var(--text)] list-none">
                  <span>Applicable spending limits ({applicableLimits.length})</span>
                  <ChevronDown className="w-4 h-4 text-[var(--muted)] transition-transform group-open:rotate-180" />
                </summary>
                <div className="pb-3">
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
              </details>

              <details className="group py-1">
                <summary className="min-h-[48px] flex items-center justify-between gap-2 cursor-pointer text-sm font-semibold text-[var(--text)] list-none">
                  <span>Linked bills ({linkedBills.length})</span>
                  <ChevronDown className="w-4 h-4 text-[var(--muted)] transition-transform group-open:rotate-180" />
                </summary>
                <div className="pb-3">
                  {linkedBills.length === 0 ? (
                    <p className="text-xs text-[var(--muted)]">No bills recorded yet.</p>
                  ) : (
                    <ul className="space-y-1.5 text-xs">
                      {linkedBills.slice(0, 8).map((bill) => (
                        <li key={bill.id}>
                          <Link
                            to={`/bills/${bill.id}`}
                            onClick={() => setDetailOpen(false)}
                            className="min-h-[38px] px-2.5 py-1.5 rounded-lg hover:bg-[var(--surface-subtle)] flex items-center justify-between gap-2 transition-colors"
                          >
                            <span className="truncate min-w-0 text-[var(--text)] font-medium">
                              {bill.billNo || t('draft')} · {formatDateDisplay(bill.date)} (
                              {bill.items.length}টি)
                            </span>
                            <span className="inline-flex items-center gap-2 shrink-0">
                              <span className="tabular-nums font-semibold text-[var(--text)]">
                                {formatTaka(bill.grossAmount)}
                              </span>
                              <StatusChip variant={billStatusVariant(bill.status)}>
                                {t(bill.status)}
                              </StatusChip>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>

              <details className="group py-1">
                <summary className="min-h-[48px] flex items-center justify-between gap-2 cursor-pointer text-sm font-semibold text-[var(--text)] list-none">
                  <span>{t('activity')}</span>
                  <ChevronDown className="w-4 h-4 text-[var(--muted)] transition-transform group-open:rotate-180" />
                </summary>
                <div className="pb-2">
                  <ActivityList logs={selectedBudgetLogs} loading={logsLoading} />
                </div>
              </details>
            </div>
          </div>
        )}
      </Modal>

      {/* Create / Edit Budget Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingBudget ? `Edit Budget · ${editingBudget.memoNo}` : 'New Budget Allocation'}
        subtitle={`FY ${selectedFy}`}
        fullScreenOnMobile
        maxWidthClass="md:max-w-2xl"
        footer={
          <div className="flex items-center justify-between gap-2">
            {!editingBudget && entryType === 'original' ? (
              <div className="text-xs text-[var(--muted)] tabular-nums truncate">
                মোট {allocationRows.length}টি কোড ·{' '}
                <strong className="text-[var(--text)]">
                  {formatTaka(allocationBatchTotalPaisa)}
                </strong>
              </div>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2 shrink-0">
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
                className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
              >
                {saving
                  ? 'Saving…'
                  : !editingBudget && entryType === 'original' && allocationRows.length > 1
                  ? `${t('save')} (${allocationRows.length})`
                  : t('save')}
              </button>
            </div>
          </div>
        }
      >
        <form id="budget-form" onSubmit={handleSubmitForm} className="space-y-4">
          {!editingBudget && (
            <div>
              <div className="text-xs font-medium text-[var(--muted)] mb-1.5">Entry type</div>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)]">
                <button
                  type="button"
                  onClick={() => {
                    setEntryType('original');
                    setRevisionOf('');
                  }}
                  className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                    entryType === 'original'
                      ? 'bg-[var(--card)] text-[var(--text)] shadow-sm'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  Original allocation
                </button>
                <button
                  type="button"
                  onClick={() => setEntryType('revision')}
                  className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                    entryType === 'revision'
                      ? 'bg-[var(--card)] text-[var(--text)] shadow-sm'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  Revision
                </button>
              </div>
            </div>
          )}

          {!editingBudget && entryType === 'revision' && (
            <div>
              <label
                htmlFor="budget-rev-of"
                className="block text-xs font-medium text-[var(--muted)] mb-1.5"
              >
                Revision of budget entry
              </label>
              <select
                id="budget-rev-of"
                required
                value={revisionOf}
                onChange={(e) => handleRevisionTargetChange(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
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
                        {b.memoNo} · {b.economicCode} {head.displayName} ({formatTaka(b.allocated)})
                      </option>
                    );
                  })}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="budget-memo-no"
                className="block text-xs font-medium text-[var(--muted)] mb-1.5"
              >
                Memo No
              </label>
              <input
                id="budget-memo-no"
                type="text"
                required
                value={memoNo}
                onChange={(e) => setMemoNo(e.target.value)}
                placeholder="30.00.0000.302.02.222.25-343"
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              {sameMemoBudgets.length > 0 ? (
                <p className="text-[11px] text-[var(--accent)] mt-1 bn">
                  এই স্মারকে আরও {sameMemoBudgets.length}টি কোড আছে (
                  {sameMemoBudgets.map((b) => b.economicCode).join(', ')}) — ভিন্ন কোডে যুক্ত করা যাবে।
                </p>
              ) : !editingBudget ? (
                <p className="text-[11px] text-[var(--muted)] mt-1 bn">
                  একই স্মারক নম্বরে একাধিক অর্থনৈতিক কোডে বাজেট এন্ট্রি দেওয়া যাবে।
                </p>
              ) : null}
            </div>
            <div>
              <label
                htmlFor="budget-memo-date"
                className="block text-xs font-medium text-[var(--muted)] mb-1.5"
              >
                Memo Date (inside FY {selectedFy})
              </label>
              <input
                id="budget-memo-date"
                type="date"
                required
                value={memoDate}
                onChange={(e) => setMemoDate(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
          </div>

          {!editingBudget && entryType === 'original' ? (
            <div className="space-y-3">
              {allocationRows.map((row, idx) => {
                const resolvedHead = row.economicCode
                  ? getHead(row.economicCode, {
                      headName: row.headName,
                      headNameBn: row.headNameBn,
                    })
                  : null;
                const excludedForRow = allocationRows
                  .filter((_, otherIdx) => otherIdx !== idx)
                  .map((r) => r.economicCode.trim())
                  .filter(Boolean);

                return (
                  <div
                    key={row.key}
                    className="p-3.5 rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)]/70 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[var(--accent)]">
                        অর্থনৈতিক কোড #{idx + 1}
                      </span>
                      {allocationRows.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setAllocationRows((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="min-h-[34px] px-2.5 rounded-lg text-xs font-medium text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40 inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>সরান</span>
                        </button>
                      )}
                    </div>

                    <EconomicCodeSelect
                      label="Economic code"
                      value={row.economicCode}
                      onChange={(code, entry: EconomicCodeDoc | null) => {
                        const trimmed = code.trim();
                        const dupInOther =
                          Boolean(trimmed) &&
                          allocationRows.some(
                            (r, otherIdx) => otherIdx !== idx && r.economicCode.trim() === trimmed
                          );
                        updateAllocationRow(idx, {
                          economicCode: dupInOther ? '' : code,
                          headName: dupInOther ? '' : entry?.headName || '',
                          headNameBn: dupInOther ? '' : entry?.headNameBn || '',
                          codeError: dupInOther
                            ? `কোড ${trimmed} ইতোমধ্যে অন্য সারিতে যোগ করা হয়েছে।`
                            : '',
                        });
                      }}
                      error={row.codeError}
                      includeInactive={false}
                      includeSpecial={false}
                      excludeCodes={excludedForRow}
                      placeholder="Select economic code…"
                    />

                    {row.economicCode && resolvedHead && (
                      <div className="px-3 py-2 rounded-lg bg-[var(--card)] border border-[var(--line)] text-xs space-y-0.5">
                        <div className="text-[11px] font-medium text-[var(--muted)]">
                          ব্যয়ের খাত
                        </div>
                        <div className="font-medium text-[var(--text)] bn break-words">
                          {resolvedHead.displayName}
                        </div>
                      </div>
                    )}

                    <div>
                      <label
                        htmlFor={`budget-amount-${row.key}`}
                        className="block text-xs font-medium text-[var(--muted)] mb-1.5"
                      >
                        Amount (৳)
                      </label>
                      <input
                        id={`budget-amount-${row.key}`}
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={row.amountStr}
                        onChange={(e) => updateAllocationRow(idx, { amountStr: e.target.value })}
                        placeholder="300000"
                        className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      />
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={() => setAllocationRows((prev) => [...prev, makeEmptyAllocationRow()])}
                className="w-full min-h-[44px] px-4 rounded-xl border border-dashed border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-soft)]/50 text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>আরেকটি কোড ও টাকা যোগ করুন</span>
              </button>
            </div>
          ) : (
            <>
              <EconomicCodeSelect
                label="Economic code"
                value={economicCode}
                onChange={(val, entry) => {
                  setEconomicCode(val);
                  setCodeError('');
                  setHeadName(entry?.headName || '');
                  setHeadNameBn(entry?.headNameBn || '');
                }}
                error={codeError}
                disabled={Boolean(editingBudget) || (entryType === 'revision' && Boolean(revisionOf))}
                includeInactive={Boolean(editingBudget)}
                includeSpecial={false}
                placeholder="Select economic code…"
              />

              {economicCode && (
                <div className="px-3.5 py-2.5 rounded-lg bg-[var(--surface-subtle)] border border-[var(--line)]">
                  <div className="text-[11px] font-medium text-[var(--muted)]">ব্যয়ের খাত</div>
                  <div className="text-sm font-medium text-[var(--text)] mt-0.5 bn break-words">
                    {getHead(economicCode, { headName, headNameBn }).displayName}
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="budget-amount"
                  className="block text-xs font-medium text-[var(--muted)] mb-1.5"
                >
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
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>

              {Boolean(editingBudget) && (
                <div className="p-3.5 rounded-xl bg-[var(--surface-subtle)] space-y-3">
                  <div className="text-xs font-semibold text-[var(--text)]">
                    Deduction rates (saved with this budget)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-[var(--muted)] mb-1">
                        Income Tax (%)
                      </label>
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
                      <label className="block text-[11px] text-[var(--muted)] mb-1">
                        Service Charge (%)
                      </label>
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

                  <div>
                    <label
                      htmlFor="budget-correction-reason"
                      className="block text-xs font-medium text-[var(--muted)] mb-1.5"
                    >
                      সংশোধনের কারণ (অডিট লগের জন্য বাধ্যতামূলক)
                    </label>
                    <textarea
                      id="budget-correction-reason"
                      rows={2}
                      required={isSuperAdmin}
                      value={correctionReason}
                      onChange={(e) => setCorrectionReason(e.target.value)}
                      placeholder="সংশোধনের স্পষ্ট কারণ লিখুন…"
                      className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </form>
      </Modal>

      {/* Super Admin Audited Delete Budget Modal */}
      <Modal
        open={Boolean(deletingBudget)}
        onClose={() => !deletingSaving && setDeletingBudget(null)}
        title={deletingBudget ? `বাজেট মুছুন · ${deletingBudget.memoNo}` : ''}
        subtitle={deletingBudget ? `${deletingBudget.economicCode} · অডিট লগসহ মুছা হবে` : ''}
        maxWidthClass="md:max-w-md"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={deletingSaving}
              onClick={() => setDeletingBudget(null)}
              className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              disabled={deletingSaving || !deleteReason.trim()}
              onClick={handleConfirmDeleteBudget}
              className="min-h-[44px] px-4 rounded-lg bg-[var(--danger-text)] text-white text-sm font-semibold disabled:opacity-45"
            >
              {deletingSaving ? 'মুছা হচ্ছে…' : 'নিশ্চিত মুছুন'}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-[var(--muted)] bn">
            অনুমোদিত/সক্রিয় বাজেট রেকর্ড মুছার জন্য সুস্পষ্ট কারণ প্রদান করতে হবে, যা অডিট লগে সংরক্ষিত থাকবে।
          </p>
          <div>
            <label
              htmlFor="budget-delete-reason"
              className="block text-xs font-medium text-[var(--muted)] mb-1"
            >
              কারণ (আবশ্যক)
            </label>
            <textarea
              id="budget-delete-reason"
              rows={3}
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="কেন এই বাজেটটি মুছা হচ্ছে…"
              className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn"
            />
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
