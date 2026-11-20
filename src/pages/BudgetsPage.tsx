import React, { useMemo, useState } from 'react';
import { ChevronRight, Plus, Search, Trash2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { StatusChip } from '../components/StatusChip';
import { ActivityList } from '../components/ActivityList';
import { EconomicCodeSelect } from '../components/EconomicCodeSelect';
import { useAuth } from '../contexts/AuthContext';
import { ALL_OFFICES_ID, LEGACY_UNMIGRATED_OFFICE_ID, useApp } from '../contexts/AppContext';
import { useFyData } from '../hooks/useFyData';
import { useEconomicCodes } from '../hooks/useEconomicCodes';
import { useDocAuditLogs } from '../hooks/useAuditLogs';
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
import type { BudgetDoc, BudgetEntryType, DeductionRates, EconomicCodeDoc } from '../types';

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
  const [allocationRows, setAllocationRows] = useState<BudgetAllocationRowDraft[]>([
    makeEmptyAllocationRow(),
  ]);
  const [correctionReason, setCorrectionReason] = useState('');
  const [saving, setSaving] = useState(false);

  // Super Admin audited delete confirmation modal
  const [deletingBudget, setDeletingBudget] = useState<BudgetDoc | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deletingSaving, setDeletingSaving] = useState(false);

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
    setMobileDetailOpen(false);
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
      setMobileDetailOpen(false);
      pushToast('success', 'Budget deleted.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to delete budget.');
    } finally {
      setDeletingSaving(false);
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
            <p className="text-xs text-[var(--muted)] mt-0.5 tabular-nums break-words bn">
              {selectedBudget.economicCode} ·{' '}
              {
                getHead(selectedBudget.economicCode, {
                  headName: selectedBudget.headName,
                  headNameBn: selectedBudget.headNameBn,
                }).displayName
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

        <div className="text-xs text-[var(--muted)] bn pt-1 border-t border-[var(--line)]/60">
          প্রস্তুতকারী: <span className="font-medium text-[var(--text)]">{formatActorBrief(selectedBudget.createdBy, officesById)}</span>
        </div>

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
              onClick={() => openDeleteBudgetModal(selectedBudget)}
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

  return (
    <Layout title={t('navBudgets')}>
      <PageHeader title={t('navBudgets')} actions={actions} />
      <div className="space-y-3.5 md:space-y-4">
        {isLegacyPreMigration && (
          <div className="card-surface px-4 py-3 border-l-4 border-[var(--warn)] text-xs text-[var(--text)]">
            মাল্টি-অফিস মাইগ্রেশন সম্পন্ন করার আগে নতুন বাজেট এন্ট্রি তৈরি করা যাবে না। Settings থেকে মাইগ্রেশন সম্পন্ন করুন।
          </div>
        )}
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
              placeholder="স্মারক, কোড বা ব্যয়ের খাত খুঁজুন…"
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
                            <span className="bn">{head.displayName}</span>
                          </div>
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
                              <span className="tabular-nums">{b.economicCode}</span>{' '}
                              <span className="bn">{head.displayName}</span>
                            </div>
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
                className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
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
                        {b.memoNo} · {b.economicCode} {head.displayName} ({formatTaka(b.allocated)})
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
              {sameMemoBudgets.length > 0 ? (
                <p className="text-[11px] text-[var(--accent)] mt-1 bn">
                  এই স্মারকে আরও {sameMemoBudgets.length}টি কোড আছে ({sameMemoBudgets.map((b) => b.economicCode).join(', ')}) — ভিন্ন কোডে যুক্ত করা যাবে।
                </p>
              ) : !editingBudget ? (
                <p className="text-[11px] text-[var(--muted)] mt-1 bn">
                  একই স্মারক নম্বরে একাধিক অর্থনৈতিক কোডে বাজেট এন্ট্রি দেওয়া যাবে।
                </p>
              ) : null}
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
                    className="p-3.5 rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)]/60 space-y-3"
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
                        className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
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
                  <div className="text-[11px] font-medium text-[var(--muted)]">
                    ব্যয়ের খাত
                  </div>
                  <div className="text-sm font-medium text-[var(--text)] mt-0.5 bn break-words">
                    {getHead(economicCode, { headName, headNameBn }).displayName}
                  </div>
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

              {/* Editable Deduction Rates shown only when editing an existing budget */}
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
                      className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm bn"
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
            <label htmlFor="budget-delete-reason" className="block text-xs font-medium text-[var(--muted)] mb-1">
              কারণ (আবশ্যক)
            </label>
            <textarea
              id="budget-delete-reason"
              rows={3}
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="কেন এই বাজেটটি মুছা হচ্ছে…"
              className="w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm bn"
            />
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
