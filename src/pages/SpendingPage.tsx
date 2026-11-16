import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Trash2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { StatusChip, type ChipVariant } from '../components/StatusChip';
import { ActivityList } from '../components/ActivityList';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { useFyData } from '../hooks/useFyData';
import { useDocAuditLogs } from '../hooks/useAuditLogs';
import { computeAvailable } from '../lib/computeAvailable';
import { formatDateDisplay, todayYmd } from '../lib/dates';
import {
  approveSpendingTx,
  deleteDraftSpending,
  editApprovedSpendingTx,
  rejectSpendingTx,
  saveSpendingDraftOrSubmit,
  softDeleteApprovedSpendingTx,
  submitExistingSpending,
  voidSpendingTx,
} from '../lib/firestoreOps';
import {
  calcPercentageAmount,
  formatNumberIN,
  formatPaisaInput,
  formatTaka,
  toPaisa,
} from '../lib/money';
import {
  canApproveRejectVoid,
  canEditDeleteApprovedSpending,
} from '../lib/permissions';
import type { BudgetDoc, OtherDeduction, SpendingDoc, SpendingStatus } from '../types';

function statusToChip(status: SpendingStatus): ChipVariant {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'draft':
      return 'draft';
    case 'submitted':
      return 'submitted';
    case 'rejected':
      return 'rejected';
    case 'voided':
      return 'voided';
  }
}

export function SpendingPage() {
  const { userDoc } = useAuth();
  const { selectedFy, pushToast, t } = useApp();
  const { budgets, spendings, spendingLimits, fyCodeTotals, loading } = useFyData(selectedFy);
  const [searchParams, setSearchParams] = useSearchParams();

  const canReview = userDoc ? canApproveRejectVoid(userDoc.role) : false;
  const isSuperAdmin = userDoc ? canEditDeleteApprovedSpending(userDoc.role) : false;

  const initialStatus = searchParams.get('status');
  const [statusFilter, setStatusFilter] = useState<'all' | SpendingStatus>(
    initialStatus === 'submitted' ||
      initialStatus === 'draft' ||
      initialStatus === 'approved' ||
      initialStatus === 'rejected' ||
      initialStatus === 'voided'
      ? initialStatus
      : 'all'
  );
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const param = searchParams.get('status');
    if (
      param === 'submitted' ||
      param === 'draft' ||
      param === 'approved' ||
      param === 'rejected' ||
      param === 'voided'
    ) {
      setStatusFilter(param);
    }
  }, [searchParams]);

  // Selected spending for Detail Modal
  const [detailId, setDetailId] = useState<string | null>(null);
  const selectedSpending = useMemo(
    () => spendings.find((s) => s.id === detailId) || null,
    [spendings, detailId]
  );
  const { logs: spendingLogs, loading: logsLoading } = useDocAuditLogs(
    'spendings',
    selectedSpending?.id || null
  );

  // Action prompts inside Detail Modal (Cheque / Reject reason / Void reason)
  const [actionMode, setActionMode] = useState<'none' | 'approve' | 'reject' | 'void'>('none');
  const [actionInput, setActionInput] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  // Create / Edit Form Modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingSpending, setEditingSpending] = useState<SpendingDoc | null>(null);
  const [formBudgetId, setFormBudgetId] = useState('');
  const [formDate, setFormDate] = useState(todayYmd());
  const [formBillNo, setFormBillNo] = useState('');
  const [formChequeNo, setFormChequeNo] = useState('');
  const [formPayee, setFormPayee] = useState('');
  const [formGrossStr, setFormGrossStr] = useState('');
  const [formVatVariantKey, setFormVatVariantKey] = useState('default');
  const [formVatStr, setFormVatStr] = useState('0');
  const [formItStr, setFormItStr] = useState('0');
  const [formScStr, setFormScStr] = useState('0');
  const [vatManuallyEdited, setVatManuallyEdited] = useState(false);
  const [itManuallyEdited, setItManuallyEdited] = useState(false);
  const [scManuallyEdited, setScManuallyEdited] = useState(false);
  const [otherRows, setOtherRows] = useState<Array<{ label: string; amountStr: string }>>([]);
  const [formSaving, setFormSaving] = useState(false);

  const activeBudgets = useMemo(
    () => budgets.filter((b) => b.status === 'active'),
    [budgets]
  );

  const filteredSpendings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return spendings.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (!q) return true;
      return (
        s.payee.toLowerCase().includes(q) ||
        s.billNo.toLowerCase().includes(q) ||
        (s.chequeNo || '').toLowerCase().includes(q) ||
        s.headName.toLowerCase().includes(q) ||
        s.economicCode.toLowerCase().includes(q)
      );
    });
  }, [spendings, statusFilter, search]);

  const pagedSpendings = useMemo(() => {
    const start = (page - 1) * 50;
    return filteredSpendings.slice(start, start + 50);
  }, [filteredSpendings, page]);

  // Budget chosen in the Spending form
  const formBudget: BudgetDoc | undefined = useMemo(
    () => budgets.find((b) => b.id === formBudgetId),
    [budgets, formBudgetId]
  );

  // Recalculate automatic deductions when gross, budget, or VAT variant changes (unless user overrode)
  const formGrossPaisa = toPaisa(formGrossStr || '0');
  const validGrossPaisa = Number.isNaN(formGrossPaisa) ? 0 : formGrossPaisa;

  const selectedVatObj = useMemo(() => {
    if (!formBudget) return { key: 'default', label: 'Standard', rate: 0 };
    return (
      formBudget.deductionRates.vat.find((v) => v.key === formVatVariantKey) ||
      formBudget.deductionRates.vat[0] || { key: 'default', label: 'Standard', rate: 0 }
    );
  }, [formBudget, formVatVariantKey]);

  useEffect(() => {
    if (!formOpen || !formBudget) return;
    if (!vatManuallyEdited) {
      const amt = calcPercentageAmount(validGrossPaisa, selectedVatObj.rate);
      setFormVatStr(formatPaisaInput(amt));
    }
    if (!itManuallyEdited) {
      const amt = calcPercentageAmount(validGrossPaisa, formBudget.deductionRates.incomeTax);
      setFormItStr(formatPaisaInput(amt));
    }
    if (!scManuallyEdited) {
      const amt = calcPercentageAmount(validGrossPaisa, formBudget.deductionRates.serviceCharge);
      setFormScStr(formatPaisaInput(amt));
    }
  }, [
    formOpen,
    formBudget,
    validGrossPaisa,
    selectedVatObj.rate,
    vatManuallyEdited,
    itManuallyEdited,
    scManuallyEdited,
  ]);

  const formVatPaisa = Math.max(0, toPaisa(formVatStr || '0') || 0);
  const formItPaisa = Math.max(0, toPaisa(formItStr || '0') || 0);
  const formScPaisa = Math.max(0, toPaisa(formScStr || '0') || 0);
  const formOthersParsed: OtherDeduction[] = useMemo(
    () =>
      otherRows
        .filter((r) => r.label.trim() || (toPaisa(r.amountStr || '0') || 0) > 0)
        .map((r) => ({
          label: r.label.trim() || 'Other deduction',
          amount: Math.max(0, toPaisa(r.amountStr || '0') || 0),
        })),
    [otherRows]
  );
  const totalDeductionsPaisa =
    formVatPaisa +
    formItPaisa +
    formScPaisa +
    formOthersParsed.reduce((sum, o) => sum + o.amount, 0);
  const formNetPayablePaisa = validGrossPaisa - totalDeductionsPaisa;

  // Live computeAvailable check in the form
  const formAvailability = useMemo(() => {
    if (!formBudget) return null;
    const isEditingApproved = editingSpending?.status === 'approved';
    const sameBudget = isEditingApproved && editingSpending.budgetId === formBudget.id;
    const sameCode = isEditingApproved && editingSpending.economicCode === formBudget.economicCode;

    const existingFyTotal = fyCodeTotals.find(
      (f) => f.economicCode === formBudget.economicCode
    );
    const adjustedBudget = {
      ...formBudget,
      spent: sameBudget ? Math.max(0, formBudget.spent - editingSpending!.gross) : formBudget.spent,
    };
    const adjustedFyTotal = existingFyTotal
      ? {
          ...existingFyTotal,
          spent: sameCode
            ? Math.max(0, existingFyTotal.spent - editingSpending!.gross)
            : existingFyTotal.spent,
        }
      : { allocated: formBudget.allocated, spent: adjustedBudget.spent };

    return computeAvailable({
      budget: adjustedBudget,
      fyCodeTotal: adjustedFyTotal,
      spendingLimits,
      date: formDate,
      gross: validGrossPaisa,
    });
  }, [formBudget, editingSpending, fyCodeTotals, spendingLimits, formDate, validGrossPaisa]);

  const openNewSpending = () => {
    setEditingSpending(null);
    const firstActive = activeBudgets[0];
    setFormBudgetId(firstActive?.id || '');
    setFormDate(todayYmd());
    setFormBillNo('');
    setFormChequeNo('');
    setFormPayee('');
    setFormGrossStr('');
    setFormVatVariantKey(firstActive?.deductionRates.vat[0]?.key || 'default');
    setFormVatStr('0');
    setFormItStr('0');
    setFormScStr('0');
    setVatManuallyEdited(false);
    setItManuallyEdited(false);
    setScManuallyEdited(false);
    setOtherRows([]);
    setFormOpen(true);
  };

  const openEditSpending = (s: SpendingDoc) => {
    setEditingSpending(s);
    setFormBudgetId(s.budgetId);
    setFormDate(s.date);
    setFormBillNo(s.billNo);
    setFormChequeNo(s.chequeNo || '');
    setFormPayee(s.payee);
    setFormGrossStr(formatPaisaInput(s.gross));
    setFormVatVariantKey(s.vatVariant || 'default');
    setFormVatStr(formatPaisaInput(s.deductions.vat));
    setFormItStr(formatPaisaInput(s.deductions.it));
    setFormScStr(formatPaisaInput(s.deductions.serviceCharge));
    setVatManuallyEdited(true);
    setItManuallyEdited(true);
    setScManuallyEdited(true);
    setOtherRows(
      (s.deductions.others || []).map((o) => ({
        label: o.label,
        amountStr: formatPaisaInput(o.amount),
      }))
    );
    setDetailId(null);
    setFormOpen(true);
  };

  const handleBudgetSelectChange = (nextBudgetId: string) => {
    setFormBudgetId(nextBudgetId);
    const b = budgets.find((item) => item.id === nextBudgetId);
    if (b) {
      setFormVatVariantKey(b.deductionRates.vat[0]?.key || 'default');
      setVatManuallyEdited(false);
      setItManuallyEdited(false);
      setScManuallyEdited(false);
    }
  };

  const handleSaveSpending = async (mode: 'draft' | 'submitted' | 'editApproved') => {
    if (!userDoc || !formBudget) {
      pushToast('error', 'Select an active budget head.');
      return;
    }
    if (validGrossPaisa <= 0) {
      pushToast('error', 'Gross bill must be greater than zero.');
      return;
    }
    if (formNetPayablePaisa < 0) {
      pushToast('error', 'Net payable cannot be negative.');
      return;
    }

    setFormSaving(true);
    try {
      const actor = { uid: userDoc.id, name: userDoc.name };
      const payload = {
        budgetId: formBudget.id,
        fiscalYear: selectedFy,
        economicCode: formBudget.economicCode,
        headName: formBudget.headName,
        headNameBn: formBudget.headNameBn,
        date: formDate,
        billNo: formBillNo,
        chequeNo: mode === 'editApproved' ? formChequeNo : null,
        payee: formPayee,
        gross: validGrossPaisa,
        vatVariant: selectedVatObj.key,
        deductions: {
          vat: formVatPaisa,
          it: formItPaisa,
          serviceCharge: formScPaisa,
          others: formOthersParsed,
        },
        netPayable: formNetPayablePaisa,
        deductionsApplied: {
          vatRate: selectedVatObj.rate,
          itRate: formBudget.deductionRates.incomeTax,
          serviceChargeRate: formBudget.deductionRates.serviceCharge,
        },
      };

      if (mode === 'editApproved' && editingSpending) {
        await editApprovedSpendingTx(editingSpending.id, payload, actor);
        pushToast('success', 'Approved spending updated and budget totals adjusted.');
      } else {
        await saveSpendingDraftOrSubmit(
          payload,
          mode === 'submitted' ? 'submitted' : 'draft',
          editingSpending ? editingSpending.id : null,
          actor
        );
        if (mode === 'submitted' && formAvailability && !formAvailability.allowed) {
          pushToast(
            'warning',
            `Submitted with cap warning: ${formAvailability.limitingConstraint.exceededMessage}`
          );
        } else {
          pushToast(
            'success',
            mode === 'submitted' ? 'Spending submitted for approval.' : 'Draft saved.'
          );
        }
      }
      setFormOpen(false);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to save spending.');
    } finally {
      setFormSaving(false);
    }
  };

  const handleDetailApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userDoc || !selectedSpending) return;
    setActionBusy(true);
    try {
      await approveSpendingTx(selectedSpending.id, actionInput, {
        uid: userDoc.id,
        name: userDoc.name,
      });
      pushToast('success', 'Spending approved and budget balances updated.');
      setActionMode('none');
      setActionInput('');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Approval blocked.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDetailReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userDoc || !selectedSpending) return;
    setActionBusy(true);
    try {
      await rejectSpendingTx(selectedSpending.id, actionInput, {
        uid: userDoc.id,
        name: userDoc.name,
      });
      pushToast('success', 'Spending rejected and returned to creator.');
      setActionMode('none');
      setActionInput('');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to reject.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDetailVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userDoc || !selectedSpending) return;
    setActionBusy(true);
    try {
      await voidSpendingTx(selectedSpending.id, actionInput, {
        uid: userDoc.id,
        name: userDoc.name,
      });
      pushToast('success', 'Spending voided and budget remaining restored.');
      setActionMode('none');
      setActionInput('');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to void.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleSubmitFromDetail = async (s: SpendingDoc) => {
    if (!userDoc) return;
    const budget = budgets.find((b) => b.id === s.budgetId);
    const fyTotal = fyCodeTotals.find((f) => f.economicCode === s.economicCode);
    const capRes = budget
      ? computeAvailable({
          budget,
          fyCodeTotal: fyTotal,
          spendingLimits,
          date: s.date,
          gross: s.gross,
        })
      : null;

    try {
      await submitExistingSpending(s, { uid: userDoc.id, name: userDoc.name });
      if (capRes && !capRes.allowed) {
        pushToast(
          'warning',
          `Submitted with cap warning: ${capRes.limitingConstraint.exceededMessage}`
        );
      } else {
        pushToast('success', 'Spending submitted for approval.');
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to submit.');
    }
  };

  const handleDeleteSpending = async (s: SpendingDoc) => {
    if (!userDoc) return;
    try {
      if (s.status === 'approved') {
        await softDeleteApprovedSpendingTx(s.id, {
          uid: userDoc.id,
          name: userDoc.name,
        });
        pushToast('success', 'Approved spending deleted and totals reversed.');
      } else {
        await deleteDraftSpending(s, { uid: userDoc.id, name: userDoc.name });
        pushToast('success', 'Entry deleted.');
      }
      setDetailId(null);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to delete.');
    }
  };

  const actions = (
    <button
      type="button"
      onClick={openNewSpending}
      className="min-h-[40px] px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold whitespace-nowrap"
    >
      {t('newSpending')}
    </button>
  );

  return (
    <Layout title={t('navSpending')} actions={actions}>
      <div className="space-y-4">
        {/* Filters & Search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['all', 'draft', 'submitted', 'approved', 'rejected', 'voided'] as const).map((st) => {
              const active = statusFilter === st;
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => {
                    setStatusFilter(st);
                    setPage(1);
                    if (st === 'all') {
                      searchParams.delete('status');
                      setSearchParams(searchParams, { replace: true });
                    } else {
                      setSearchParams({ status: st }, { replace: true });
                    }
                  }}
                  className={`min-h-[38px] px-3.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                      : 'bg-[var(--card)] border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {t(st)}
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
              placeholder="Search payee, bill, cheque…"
              aria-label="Search spendings"
              className="w-full min-h-[40px] pl-9 pr-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
        </div>

        {/* Table Card */}
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                  <th className="py-3 px-4 font-medium whitespace-nowrap">{t('date')}</th>
                  <th className="py-3 px-4 font-medium whitespace-nowrap">{t('bill')}</th>
                  <th className="py-3 px-4 font-medium whitespace-nowrap">{t('cheque')}</th>
                  <th className="py-3 px-4 font-medium">{t('payee')}</th>
                  <th className="py-3 px-4 font-medium">{t('head')}</th>
                  <th className="py-3 px-4 font-medium text-right whitespace-nowrap">{t('gross')}</th>
                  <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Deduct.</th>
                  <th className="py-3 px-4 font-medium text-right whitespace-nowrap">{t('net')}</th>
                  <th className="py-3 px-4 font-medium whitespace-nowrap">{t('status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                      Loading spendings…
                    </td>
                  </tr>
                ) : pagedSpendings.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                      {t('noDataFound')}
                    </td>
                  </tr>
                ) : (
                  pagedSpendings.map((s) => {
                    const deductTotal = s.gross - s.netPayable;
                    return (
                      <tr
                        key={s.id}
                        onClick={() => {
                          setDetailId(s.id);
                          setActionMode('none');
                          setActionInput('');
                        }}
                        className="cursor-pointer hover:bg-[var(--surface-subtle)] transition-colors"
                      >
                        <td className="py-3 px-4 tabular-nums whitespace-nowrap text-[var(--muted)]">
                          {formatDateDisplay(s.date)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap font-medium">{s.billNo}</td>
                        <td className="py-3 px-4 whitespace-nowrap text-[var(--muted)]">
                          {s.chequeNo || '—'}
                        </td>
                        <td className="py-3 px-4 font-medium">{s.payee}</td>
                        <td className="py-3 px-4 min-w-[140px]">
                          <div>{s.headName}</div>
                          {s.headNameBn && <div className="bn">{s.headNameBn}</div>}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                          {formatNumberIN(s.gross)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap text-[var(--muted)]">
                          {formatNumberIN(deductTotal)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap font-medium">
                          {formatNumberIN(s.netPayable)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <StatusChip variant={statusToChip(s.status)}>
                            {t(s.status)}
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
            totalItems={filteredSpendings.length}
            onPageChange={setPage}
          />
        </div>
      </div>

      {/* Create / Edit Spending Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={
          editingSpending
            ? editingSpending.status === 'approved'
              ? `Edit Approved Spending · ${editingSpending.billNo}`
              : `Edit Spending · ${editingSpending.billNo}`
            : 'New Spending'
        }
        subtitle={`FY ${selectedFy}`}
        maxWidthClass="lg:max-w-2xl"
      >
        <div className="space-y-4">
          <div className="space-y-3.5">
            <div>
              <label htmlFor="sp-budget" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                Budget head
              </label>
              <select
                id="sp-budget"
                value={formBudgetId}
                onChange={(e) => handleBudgetSelectChange(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
              >
                <option value="">Select active budget…</option>
                {(editingSpending?.status === 'approved' ? budgets : activeBudgets).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.economicCode} · {b.headName} ({b.memoNo} · Rem {formatTaka(b.remaining)})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="sp-date" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                  Date
                </label>
                <input
                  id="sp-date"
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="sp-bill" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                  Bill no.
                </label>
                <input
                  id="sp-bill"
                  type="text"
                  value={formBillNo}
                  onChange={(e) => setFormBillNo(e.target.value)}
                  placeholder="B-101"
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
                />
              </div>
              <div>
                <label htmlFor="sp-payee" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                  Payee
                </label>
                <input
                  id="sp-payee"
                  type="text"
                  value={formPayee}
                  onChange={(e) => setFormPayee(e.target.value)}
                  placeholder="Payee name"
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
                />
              </div>
            </div>

            {editingSpending?.status === 'approved' && (
              <div>
                <label htmlFor="sp-cheque" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                  Cheque no.
                </label>
                <input
                  id="sp-cheque"
                  type="text"
                  value={formChequeNo}
                  onChange={(e) => setFormChequeNo(e.target.value)}
                  placeholder="C-5521"
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
                />
              </div>
            )}

            <div>
              <label htmlFor="sp-gross" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                Gross bill (৳)
              </label>
              <input
                id="sp-gross"
                type="number"
                step="0.01"
                min="0"
                value={formGrossStr}
                onChange={(e) => setFormGrossStr(e.target.value)}
                placeholder="10000"
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base font-medium tabular-nums"
              />
            </div>

            {formBudget && formBudget.deductionRates.vat.length > 1 && (
              <div>
                <div className="text-xs font-medium text-[var(--muted)] mb-1.5">VAT variant</div>
                <div className="flex flex-wrap gap-2">
                  {formBudget.deductionRates.vat.map((v) => {
                    const active = formVatVariantKey === v.key;
                    return (
                      <button
                        key={v.key}
                        type="button"
                        onClick={() => {
                          setFormVatVariantKey(v.key);
                          setVatManuallyEdited(false);
                        }}
                        className={`min-h-[40px] px-3.5 rounded-lg text-xs font-semibold transition-colors ${
                          active
                            ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                            : 'border border-[var(--line)] text-[var(--text)] hover:bg-[var(--surface-subtle)]'
                        }`}
                      >
                        {v.label} {v.rate}%
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {formAvailability && (
              <div
                className={`px-3.5 py-2.5 rounded-lg text-xs font-medium ${
                  validGrossPaisa > 0 && !formAvailability.allowed
                    ? 'bg-[var(--warn-bg)] text-[var(--warn-text)]'
                    : 'bg-[var(--surface-subtle)] text-[var(--muted)]'
                }`}
              >
                {validGrossPaisa > 0 && !formAvailability.allowed
                  ? formAvailability.limitingConstraint.exceededMessage
                  : formAvailability.limitingConstraint.message}
              </div>
            )}
          </div>

          {/* Deductions Card (matches Screenshot 10) */}
          <div className="p-4 rounded-[14px] border border-[var(--line)] space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--text)]">{t('deductions')}</h3>
              {(vatManuallyEdited || itManuallyEdited || scManuallyEdited) && (
                <button
                  type="button"
                  onClick={() => {
                    setVatManuallyEdited(false);
                    setItManuallyEdited(false);
                    setScManuallyEdited(false);
                  }}
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  Recalculate from rates
                </button>
              )}
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="ded-vat" className="text-sm text-[var(--text)]">
                  VAT ({selectedVatObj.rate}%)
                </label>
                <input
                  id="ded-vat"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formVatStr}
                  onChange={(e) => {
                    setVatManuallyEdited(true);
                    setFormVatStr(e.target.value);
                  }}
                  className="w-36 min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-right text-sm tabular-nums"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <label htmlFor="ded-it" className="text-sm text-[var(--text)]">
                  Income tax ({formBudget?.deductionRates.incomeTax ?? 0}%)
                </label>
                <input
                  id="ded-it"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formItStr}
                  onChange={(e) => {
                    setItManuallyEdited(true);
                    setFormItStr(e.target.value);
                  }}
                  className="w-36 min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-right text-sm tabular-nums"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <label htmlFor="ded-sc" className="text-sm text-[var(--text)]">
                  Service charge ({formBudget?.deductionRates.serviceCharge ?? 0}%)
                </label>
                <input
                  id="ded-sc"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formScStr}
                  onChange={(e) => {
                    setScManuallyEdited(true);
                    setFormScStr(e.target.value);
                  }}
                  className="w-36 min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-right text-sm tabular-nums"
                />
              </div>

              {otherRows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.label}
                    onChange={(e) => {
                      const next = [...otherRows];
                      next[idx] = { ...row, label: e.target.value };
                      setOtherRows(next);
                    }}
                    placeholder="Other (e.g. Security deposit)"
                    className="flex-1 min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.amountStr}
                    onChange={(e) => {
                      const next = [...otherRows];
                      next[idx] = { ...row, amountStr: e.target.value };
                      setOtherRows(next);
                    }}
                    placeholder="0"
                    className="w-28 min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-right text-sm tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => setOtherRows(otherRows.filter((_, i) => i !== idx))}
                    aria-label="Remove other deduction"
                    className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--danger-text)]"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setOtherRows([...otherRows, { label: '', amountStr: '0' }])}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline pt-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add other deduction</span>
              </button>
            </div>

            <div className="pt-3 border-t border-[var(--line)] flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--accent)]">
                {t('netPayable')}
              </span>
              <span
                className={`text-lg font-bold tabular-nums ${
                  formNetPayablePaisa < 0 ? 'text-[var(--danger-text)]' : 'text-[var(--accent)]'
                }`}
              >
                {formatTaka(formNetPayablePaisa)}
              </span>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2">
            {editingSpending?.status === 'approved' ? (
              <>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium"
                >
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  disabled={formSaving}
                  onClick={() => handleSaveSpending('editApproved')}
                  className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
                >
                  {formSaving ? 'Saving…' : 'Save approved changes'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={formSaving}
                  onClick={() => handleSaveSpending('draft')}
                  className="min-h-[44px] px-5 rounded-lg border border-[var(--line)] text-sm font-semibold hover:bg-[var(--surface-subtle)] disabled:opacity-60"
                >
                  {t('saveDraft')}
                </button>
                <button
                  type="button"
                  disabled={formSaving}
                  onClick={() => handleSaveSpending('submitted')}
                  className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
                >
                  {t('submit')}
                </button>
              </>
            )}
          </div>
        </div>
      </Modal>

      {/* Spending Detail Modal */}
      <Modal
        open={Boolean(selectedSpending)}
        onClose={() => {
          setDetailId(null);
          setActionMode('none');
        }}
        title={selectedSpending ? `Bill ${selectedSpending.billNo} · ${selectedSpending.payee}` : ''}
        subtitle={
          selectedSpending
            ? `${selectedSpending.economicCode} ${selectedSpending.headName} · ${formatDateDisplay(
                selectedSpending.date
              )}`
            : ''
        }
        maxWidthClass="lg:max-w-xl"
      >
        {selectedSpending && (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <StatusChip variant={statusToChip(selectedSpending.status)}>
                {t(selectedSpending.status)}
              </StatusChip>
              {selectedSpending.chequeNo && (
                <span className="text-xs text-[var(--muted)]">
                  Cheque: <strong className="text-[var(--text)]">{selectedSpending.chequeNo}</strong>
                </span>
              )}
            </div>

            {selectedSpending.rejectReason && (
              <div className="px-3.5 py-2.5 rounded-lg bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs">
                <strong>Rejection reason:</strong> {selectedSpending.rejectReason}
              </div>
            )}

            {selectedSpending.voidReason && (
              <div className="px-3.5 py-2.5 rounded-lg bg-[var(--surface-subtle)] text-[var(--muted)] text-xs">
                <strong>Void reason:</strong> {selectedSpending.voidReason}
              </div>
            )}

            {/* Deduction Breakdown */}
            <div className="p-4 rounded-[14px] border border-[var(--line)] space-y-2 text-sm">
              <div className="flex justify-between font-medium">
                <span>Gross bill</span>
                <span className="tabular-nums">{formatTaka(selectedSpending.gross)}</span>
              </div>
              <div className="flex justify-between text-[var(--muted)]">
                <span>VAT ({selectedSpending.deductionsApplied.vatRate}%)</span>
                <span className="tabular-nums">− {formatTaka(selectedSpending.deductions.vat)}</span>
              </div>
              <div className="flex justify-between text-[var(--muted)]">
                <span>Income tax ({selectedSpending.deductionsApplied.itRate}%)</span>
                <span className="tabular-nums">− {formatTaka(selectedSpending.deductions.it)}</span>
              </div>
              {selectedSpending.deductions.serviceCharge > 0 && (
                <div className="flex justify-between text-[var(--muted)]">
                  <span>Service charge</span>
                  <span className="tabular-nums">
                    − {formatTaka(selectedSpending.deductions.serviceCharge)}
                  </span>
                </div>
              )}
              {(selectedSpending.deductions.others || []).map((o, i) => (
                <div key={i} className="flex justify-between text-[var(--muted)]">
                  <span>Other: {o.label}</span>
                  <span className="tabular-nums">− {formatTaka(o.amount)}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-[var(--line)] flex justify-between font-bold text-[var(--accent)]">
                <span>{t('netPayable')}</span>
                <span className="tabular-nums">{formatTaka(selectedSpending.netPayable)}</span>
              </div>
            </div>

            {/* Action subforms */}
            {actionMode === 'approve' && (
              <form onSubmit={handleDetailApprove} className="p-4 rounded-xl bg-[var(--surface-subtle)] space-y-3">
                <label htmlFor="approve-cheque" className="block text-xs font-medium text-[var(--text)]">
                  Cheque number (required for approval)
                </label>
                <input
                  id="approve-cheque"
                  type="text"
                  required
                  value={actionInput}
                  onChange={(e) => setActionInput(e.target.value)}
                  placeholder="C-5521"
                  className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setActionMode('none')}
                    className="min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={actionBusy}
                    className="min-h-[40px] px-4 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-xs font-semibold"
                  >
                    {actionBusy ? 'Approving…' : 'Confirm Approve'}
                  </button>
                </div>
              </form>
            )}

            {actionMode === 'reject' && (
              <form onSubmit={handleDetailReject} className="p-4 rounded-xl bg-[var(--surface-subtle)] space-y-3">
                <label htmlFor="reject-reason" className="block text-xs font-medium text-[var(--text)]">
                  Reason for rejection
                </label>
                <input
                  id="reject-reason"
                  type="text"
                  required
                  value={actionInput}
                  onChange={(e) => setActionInput(e.target.value)}
                  placeholder="Missing supporting voucher"
                  className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setActionMode('none')}
                    className="min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={actionBusy}
                    className="min-h-[40px] px-4 rounded-lg bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs font-semibold"
                  >
                    {actionBusy ? 'Rejecting…' : 'Confirm Reject'}
                  </button>
                </div>
              </form>
            )}

            {actionMode === 'void' && (
              <form onSubmit={handleDetailVoid} className="p-4 rounded-xl bg-[var(--surface-subtle)] space-y-3">
                <label htmlFor="void-reason" className="block text-xs font-medium text-[var(--text)]">
                  Reason for voiding this approved entry
                </label>
                <input
                  id="void-reason"
                  type="text"
                  required
                  value={actionInput}
                  onChange={(e) => setActionInput(e.target.value)}
                  placeholder="Cheque cancelled"
                  className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setActionMode('none')}
                    className="min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={actionBusy}
                    className="min-h-[40px] px-4 rounded-lg bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs font-semibold"
                  >
                    {actionBusy ? 'Voiding…' : 'Confirm Void'}
                  </button>
                </div>
              </form>
            )}

            {/* Role-gated action bar */}
            {actionMode === 'none' && (
              <div className="flex flex-wrap gap-2">
                {(selectedSpending.status === 'draft' || selectedSpending.status === 'rejected') &&
                  (selectedSpending.createdBy === userDoc?.id || isSuperAdmin) && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditSpending(selectedSpending)}
                        className="min-h-[42px] px-4 rounded-lg border border-[var(--line)] text-xs font-medium"
                      >
                        {t('edit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSubmitFromDetail(selectedSpending)}
                        className="min-h-[42px] px-4 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-xs font-semibold"
                      >
                        {t('submit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSpending(selectedSpending)}
                        className="min-h-[42px] px-4 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--danger-text)]"
                      >
                        {t('delete')}
                      </button>
                    </>
                  )}

                {selectedSpending.status === 'submitted' && canReview && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setActionMode('approve');
                        setActionInput('');
                      }}
                      className="min-h-[42px] px-4 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-xs font-semibold"
                    >
                      {t('approve')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActionMode('reject');
                        setActionInput('');
                      }}
                      className="min-h-[42px] px-4 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--danger-text)]"
                    >
                      {t('reject')}
                    </button>
                  </>
                )}

                {selectedSpending.status === 'approved' && canReview && (
                  <button
                    type="button"
                    onClick={() => {
                      setActionMode('void');
                      setActionInput('');
                    }}
                    className="min-h-[42px] px-4 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--danger-text)]"
                  >
                    {t('void')}
                  </button>
                )}

                {selectedSpending.status === 'approved' && isSuperAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={() => openEditSpending(selectedSpending)}
                      className="min-h-[42px] px-4 rounded-lg border border-[var(--line)] text-xs font-medium"
                    >
                      {t('edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSpending(selectedSpending)}
                      className="min-h-[42px] px-4 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--danger-text)]"
                    >
                      {t('delete')}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Activity Timeline */}
            <div className="border-t border-[var(--line)] pt-3">
              <h4 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1">
                {t('activity')}
              </h4>
              <ActivityList logs={spendingLogs} loading={logsLoading} />
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
