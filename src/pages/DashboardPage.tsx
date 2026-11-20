import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Plus,
  ReceiptText,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { StatusChip, type ChipVariant } from '../components/StatusChip';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { useAllOfficesSummary } from '../hooks/useAllOfficesSummary';
import { useEconomicCodes } from '../hooks/useEconomicCodes';
import { useFyData } from '../hooks/useFyData';
import { getActorUid } from '../lib/actor';
import { formatDateDisplay, todayYmd } from '../lib/dates';
import { formatNumberIN, formatTaka } from '../lib/money';
import {
  canApproveRejectCancelBill,
  canCreateBudgets,
  canCreateDraftBill,
  canCreateExpenseItems,
} from '../lib/permissions';
import type { BillStatus } from '../types';

function billStatusToChip(status: BillStatus): ChipVariant {
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

export function DashboardPage() {
  const { userDoc, isSuperAdmin } = useAuth();
  const {
    selectedFy,
    offices,
    currentOffice,
    currentOfficeRole,
    setCurrentOfficeId,
    isAllOfficesMode,
    isLegacyPreMigration,
    t,
  } = useApp();

  const { budgets, expenseItems, bills, spendingLimits, loading } = useFyData(selectedFy);
  const { totals: allOfficesTotals, loading: allOfficesLoading } = useAllOfficesSummary(
    selectedFy,
    isAllOfficesMode
  );
  const { getHead } = useEconomicCodes();
  const [showAllHeads, setShowAllHeads] = useState(false);

  const permCtx = { isSuperAdmin, officeRole: currentOfficeRole };
  const isDdo = !isAllOfficesMode && !isLegacyPreMigration && canApproveRejectCancelBill(permCtx);
  const canCreateBudget = !isAllOfficesMode && !isLegacyPreMigration && canCreateBudgets(permCtx);
  const canCreateExpense = !isAllOfficesMode && !isLegacyPreMigration && canCreateExpenseItems(permCtx);
  const canCreateBill = !isAllOfficesMode && !isLegacyPreMigration && canCreateDraftBill(permCtx);

  // All Offices aggregated overview (Super Admin only)
  const allOfficesRows = useMemo(() => {
    if (!isAllOfficesMode) return [];
    const byOffice = new Map<string, { allocated: number; spent: number; pendingAmount: number }>();
    for (const row of allOfficesTotals) {
      const offId = row.officeId || '';
      if (!offId) continue;
      const cur = byOffice.get(offId) || { allocated: 0, spent: 0, pendingAmount: 0 };
      cur.allocated += row.allocated || 0;
      cur.spent += row.spent || 0;
      cur.pendingAmount += Math.max(0, row.pendingAmount || 0);
      byOffice.set(offId, cur);
    }
    return offices.map((office) => {
      const agg = byOffice.get(office.id) || { allocated: 0, spent: 0, pendingAmount: 0 };
      const available = agg.allocated - agg.spent - agg.pendingAmount;
      const utilPct =
        agg.allocated > 0 ? Math.min(100, Math.round((agg.spent / agg.allocated) * 100)) : 0;
      return {
        office,
        ...agg,
        available,
        utilPct,
      };
    });
  }, [isAllOfficesMode, offices, allOfficesTotals]);

  const allOfficesGrand = useMemo(() => {
    const allocated = allOfficesRows.reduce((s, r) => s + r.allocated, 0);
    const spent = allOfficesRows.reduce((s, r) => s + r.spent, 0);
    const pendingAmount = allOfficesRows.reduce((s, r) => s + r.pendingAmount, 0);
    const available = allocated - spent - pendingAmount;
    return { allocated, spent, pendingAmount, available };
  }, [allOfficesRows]);

  const totals = useMemo(() => {
    const totalAllocated = budgets.reduce((sum, b) => sum + b.allocated, 0);
    const approvedSpent = budgets.reduce((sum, b) => sum + b.spent, 0);
    const pendingAmount = budgets.reduce((sum, b) => sum + Math.max(0, b.pendingAmount || 0), 0);
    const available = totalAllocated - approvedSpent - pendingAmount;
    const billedExpensesCount = expenseItems.filter((i) => i.status === 'billed').length;
    const submittedCount = bills.filter((b) => b.status === 'submitted').length;
    const rejectedCountAll = bills.filter((b) => b.status === 'rejected').length;
    const myRejectedCount = userDoc
      ? bills.filter((b) => b.status === 'rejected' && getActorUid(b.createdBy) === userDoc.id)
          .length
      : 0;
    const pctApproved =
      totalAllocated > 0 ? Math.min(100, Math.round((approvedSpent / totalAllocated) * 100)) : 0;
    const pctPending =
      totalAllocated > 0
        ? Math.min(100 - pctApproved, Math.round((pendingAmount / totalAllocated) * 100))
        : 0;
    const pctUsedTotal = Math.min(100, pctApproved + pctPending);

    return {
      totalAllocated,
      approvedSpent,
      pendingAmount,
      available,
      billedExpensesCount,
      submittedCount,
      rejectedCountAll,
      myRejectedCount,
      pctApproved,
      pctPending,
      pctUsedTotal,
    };
  }, [budgets, bills, expenseItems, userDoc]);

  const headProgress = useMemo(() => {
    const today = todayYmd();
    const map = new Map<
      string,
      {
        economicCode: string;
        headName: string;
        headNameBn: string;
        allocated: number;
        spent: number;
        pending: number;
      }
    >();

    for (const b of budgets) {
      const resolved = getHead(b.economicCode, {
        headName: b.headName,
        headNameBn: b.headNameBn,
      });
      const existing = map.get(b.economicCode);
      const bPending = Math.max(0, b.pendingAmount || 0);
      if (existing) {
        existing.allocated += b.allocated;
        existing.spent += b.spent;
        existing.pending += bPending;
      } else {
        map.set(b.economicCode, {
          economicCode: b.economicCode,
          headName: resolved.headName,
          headNameBn: resolved.headNameBn,
          allocated: b.allocated,
          spent: b.spent,
          pending: bPending,
        });
      }
    }

    return Array.from(map.values())
      .map((item) => {
        const pct = item.allocated > 0 ? Math.round((item.spent / item.allocated) * 100) : 0;
        const pendingPct =
          item.allocated > 0
            ? Math.min(Math.max(0, 100 - pct), Math.round((item.pending / item.allocated) * 100))
            : 0;
        const activeCodeLimits = spendingLimits
          .filter(
            (l) =>
              l.type === 'code' &&
              l.status === 'active' &&
              l.economicCode === item.economicCode &&
              l.effectiveDate <= today
          )
          .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
        const activeCap = activeCodeLimits[0] || null;
        const capAmount = activeCap ? Math.round((item.allocated * activeCap.rate) / 100) : null;
        const committed = item.spent + item.pending;
        const nearCap = capAmount !== null && capAmount > 0 ? committed / capAmount >= 0.8 : false;
        const nearAlloc = item.allocated > 0 ? committed / item.allocated >= 0.8 : false;

        return {
          ...item,
          pct,
          pendingPct,
          capRate: activeCap?.rate ?? null,
          nearLimit: nearCap || nearAlloc,
        };
      })
      .sort((a, b) => b.pct + b.pendingPct - (a.pct + a.pendingPct));
  }, [budgets, spendingLimits, getHead]);

  const visibleHeads = useMemo(
    () => (showAllHeads ? headProgress : headProgress.slice(0, 7)),
    [headProgress, showAllHeads]
  );

  const recentBills = useMemo(() => bills.slice(0, 3), [bills]);

  const attentionItems = useMemo(() => {
    const items: Array<{ key: string; to: string; text: string }> = [];
    if (isDdo) {
      if (totals.submittedCount > 0) {
        items.push({
          key: 'submitted',
          to: '/bills?status=submitted',
          text:
            totals.submittedCount === 1
              ? t('waitingForApprovalSingle')
              : `${totals.submittedCount} ${t('waitingForApprovalSuffix')}`,
        });
      }
      if (totals.rejectedCountAll > 0) {
        items.push({
          key: 'rejected',
          to: '/bills?status=rejected',
          text:
            totals.rejectedCountAll === 1
              ? t('rejectedBillsSingle')
              : `${totals.rejectedCountAll} ${t('rejectedBillsSuffix')}`,
        });
      }
    } else if (!isSuperAdmin && totals.myRejectedCount > 0) {
      items.push({
        key: 'my-rejected',
        to: '/bills?status=rejected',
        text:
          totals.myRejectedCount === 1
            ? t('rejectedBillsSingle')
            : `${totals.myRejectedCount} ${t('rejectedBillsSuffix')}`,
      });
    }
    return items;
  }, [isDdo, isSuperAdmin, totals.submittedCount, totals.rejectedCountAll, totals.myRejectedCount, t]);

  if (isAllOfficesMode) {
    return (
      <Layout title={`${t('navDashboard')} · ${t('allOffices')}`}>
        <PageHeader
          title={t('navDashboard')}
          subtitle={`FY ${selectedFy} · ${t('allOffices')}`}
          actions={
            <Link
              to="/offices"
              className="min-h-[44px] px-4 rounded-xl border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs sm:text-sm font-semibold text-[var(--accent)] inline-flex items-center gap-1.5"
            >
              <span>কার্যালয় পরিচালনা</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          }
        />

        <div className="space-y-4 md:space-y-5">
          <div className="card-surface px-4 py-3 flex items-center gap-2.5 bg-[var(--accent-soft)]/30 text-xs sm:text-sm font-medium text-[var(--text)]">
            <ShieldCheck className="w-4 h-4 text-[var(--accent)] shrink-0" />
            <span>
              {t('readOnlySuperAdmin')} · {t('allOffices')} (FY {selectedFy})
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <StatCard
              label={t('totalAllocation')}
              value={allOfficesLoading ? '—' : formatTaka(allOfficesGrand.allocated)}
            />
            <StatCard
              label={t('approvedSpent')}
              value={allOfficesLoading ? '—' : formatTaka(allOfficesGrand.spent)}
            />
            <StatCard
              label={t('pendingAmount')}
              value={allOfficesLoading ? '—' : formatTaka(allOfficesGrand.pendingAmount)}
              tone="warn"
            />
            <StatCard
              label={t('available')}
              value={allOfficesLoading ? '—' : formatTaka(allOfficesGrand.available)}
              tone="accent"
            />
          </div>

          <section className="card-surface overflow-hidden">
            <div className="px-4 md:px-5 py-3.5 border-b border-[var(--line)] flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-[var(--text)]">
                কার্যালয়ভিত্তিক বাজেট সারসংক্ষেপ ({allOfficesRows.length})
              </h2>
              <span className="text-xs text-[var(--muted)]">
                যেকোনো কার্যালয়ে ক্লিক করে বিস্তারিত দেখুন
              </span>
            </div>

            {allOfficesLoading ? (
              <div className="p-6 text-sm text-[var(--muted)]">তথ্য লোড হচ্ছে…</div>
            ) : allOfficesRows.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={<Building2 className="w-5 h-5" />}
                  title="কোনো কার্যালয় পাওয়া যায়নি"
                  description="কার্যালয়সমূহ থেকে নতুন কার্যালয় যোগ করুন বা মাইগ্রেশন চালান।"
                  action={
                    <Link
                      to="/offices"
                      className="min-h-[44px] px-4 rounded-xl bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-1.5"
                    >
                      <span>কার্যালয়সমূহ</span>
                    </Link>
                  }
                />
              </div>
            ) : (
              <>
                {/* Mobile Cards (< 1024px) */}
                <div className="lg:hidden divide-y divide-[var(--line)]">
                  {allOfficesRows.map((row) => (
                    <button
                      key={row.office.id}
                      type="button"
                      onClick={() => setCurrentOfficeId(row.office.id)}
                      className="w-full text-left p-4 space-y-2 hover:bg-[var(--surface-subtle)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 font-semibold text-sm text-[var(--text)]">
                            <Building2 className="w-4 h-4 text-[var(--accent)] shrink-0" />
                            <span className="bn truncate">{row.office.nameBn || row.office.name}</span>
                          </div>
                          <div className="text-xs text-[var(--muted)] tabular-nums mt-0.5">
                            {row.office.code} · {row.utilPct}% ব্যবহার
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {row.office.status === 'inactive' && (
                            <StatusChip variant="disabled">নিষ্ক্রিয়</StatusChip>
                          )}
                          <ChevronRight className="w-4 h-4 text-[var(--muted)]" />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--line)]/60 text-xs">
                        <div>
                          <div className="text-[11px] text-[var(--muted)]">{t('allocated')}</div>
                          <div className="font-medium tabular-nums truncate">
                            {formatNumberIN(row.allocated)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-[var(--muted)]">{t('spent')}</div>
                          <div className="font-medium tabular-nums truncate">
                            {formatNumberIN(row.spent)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] text-[var(--muted)]">{t('available')}</div>
                          <div className="font-bold text-[var(--accent)] tabular-nums truncate">
                            {formatNumberIN(row.available)}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Desktop Table (>= 1024px) */}
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                        <th className="py-3 px-4 font-medium">কার্যালয়</th>
                        <th className="py-3 px-4 font-medium">কোড</th>
                        <th className="py-3 px-4 font-medium text-right">{t('totalAllocation')}</th>
                        <th className="py-3 px-4 font-medium text-right">{t('approvedSpent')}</th>
                        <th className="py-3 px-4 font-medium text-right">{t('pendingAmount')}</th>
                        <th className="py-3 px-4 font-medium text-right">{t('available')}</th>
                        <th className="py-3 px-4 font-medium text-right">ব্যবহার %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--line)]">
                      {allOfficesRows.map((row) => (
                        <tr
                          key={row.office.id}
                          onClick={() => setCurrentOfficeId(row.office.id)}
                          className="cursor-pointer hover:bg-[var(--surface-subtle)] transition-colors"
                        >
                          <td className="py-3 px-4 font-medium text-[var(--text)]">
                            <div className="flex items-center gap-2">
                              <Building2 className="w-4 h-4 text-[var(--accent)] shrink-0" />
                              <span className="bn">{row.office.nameBn || row.office.name}</span>
                              {row.office.status === 'inactive' && (
                                <StatusChip variant="disabled">নিষ্ক্রিয়</StatusChip>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 tabular-nums text-xs text-[var(--muted)]">
                            {row.office.code}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums">
                            {formatNumberIN(row.allocated)}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums">
                            {formatNumberIN(row.spent)}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums text-[var(--warn-text)]">
                            {formatNumberIN(row.pendingAmount)}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums font-semibold text-[var(--accent)]">
                            {formatNumberIN(row.available)}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums font-semibold">
                            {row.utilPct}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={t('navDashboard')}>
      <PageHeader title={t('navDashboard')} />

      {isSuperAdmin && currentOffice && (
        <div className="mb-4 card-surface px-3.5 md:px-4 py-2.5 flex items-center gap-2 bg-[var(--accent-soft)]/25 text-xs md:text-sm font-medium text-[var(--text)]">
          <ShieldCheck className="w-4 h-4 text-[var(--accent)] shrink-0" />
          <span className="bn truncate">
            {t('readOnlySuperAdmin')} · {currentOffice.nameBn || currentOffice.name}
          </span>
        </div>
      )}

      {/* Mobile order: hero, attention, quick actions, KPI row, heads utilization, recent bills.
          Desktop (>= 1024px): 2 columns (1.6fr / 1fr): hero + heads left, everything else right. */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1.6fr_1fr] lg:gap-5 lg:items-start">
        <div className="contents lg:flex lg:flex-col lg:gap-5">
          {/* 1. Hero Card */}
          <section className="order-1 lg:order-none rounded-[16px] p-5 md:p-6 space-y-3.5 bg-gradient-to-br from-[#0B5D56] to-[#14948A] text-white shadow-sm">
            <div className="text-xs font-medium text-white/90 tabular-nums">
              {t('remainingAllocation')} · FY {selectedFy}
            </div>

            <div className="text-3xl sm:text-4xl font-bold tracking-tight tabular-nums break-words">
              {loading ? '—' : formatTaka(totals.available)}
            </div>

            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={totals.pctUsedTotal}
              aria-label={`${totals.pctUsedTotal}% used`}
              className="h-2.5 rounded-full bg-white/25 overflow-hidden flex gap-0.5"
            >
              {totals.pctApproved > 0 && (
                <div
                  className="h-full bg-white transition-all motion-reduce:transition-none"
                  style={{ width: `${totals.pctApproved}%` }}
                />
              )}
              {totals.pctPending > 0 && (
                <div
                  className="h-full bg-amber-300 transition-all motion-reduce:transition-none"
                  style={{ width: `${totals.pctPending}%` }}
                />
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-white/15 text-xs tabular-nums">
              <div className="min-w-0">
                <div className="text-white/80 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-white/50 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t('totalAllocation')}</span>
                </div>
                <div className="font-bold text-sm mt-0.5 truncate">
                  {loading ? '—' : formatTaka(totals.totalAllocated)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-white/80 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-white shrink-0" aria-hidden="true" />
                  <span className="truncate">{t('approvedSpent')}</span>
                </div>
                <div className="font-bold text-sm mt-0.5 truncate">
                  {loading ? '—' : formatTaka(totals.approvedSpent)}
                </div>
              </div>
              <div className="min-w-0 text-right">
                <div className="text-white/80 inline-flex items-center justify-end gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-300 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t('pendingAmount')}</span>
                </div>
                <div className="font-bold text-sm mt-0.5 truncate">
                  {loading ? '—' : formatTaka(totals.pendingAmount)}
                </div>
              </div>
            </div>
          </section>

          {/* 5. Budget Utilization by Head */}
          <section className="order-5 lg:order-none card-surface p-4 md:p-5 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-[var(--text)]">{t('spendingByHead')}</h2>
              {headProgress.length > 0 && (
                <span className="text-xs text-[var(--muted)] tabular-nums">
                  {headProgress.length}
                </span>
              )}
            </div>

            {loading ? (
              <div className="space-y-3 py-2">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="space-y-1.5 animate-pulse">
                    <div className="h-4 w-2/3 rounded bg-[var(--surface-subtle)]" />
                    <div className="h-2.5 w-full rounded-full bg-[var(--surface-subtle)]" />
                  </div>
                ))}
              </div>
            ) : headProgress.length === 0 ? (
              <EmptyState
                icon={<Wallet className="w-5 h-5" />}
                title={`${t('noAllocationsForFy')} ${selectedFy} ${t('noAllocationsForFyEnd')}`.trim()}
                action={
                  canCreateBudget ? (
                    <Link
                      to="/budgets"
                      className="min-h-[44px] px-4 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      <Plus className="w-4 h-4" />
                      <span>{t('addBudgetBtn')}</span>
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <>
                <div className="space-y-3.5">
                  {visibleHeads.map((item) => (
                    <div key={item.economicCode} className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="min-w-0 flex-1 break-words">
                          <span className="text-sm font-medium text-[var(--text)] bn">
                            {item.headNameBn || item.headName}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-sm font-semibold text-[var(--text)] tabular-nums">
                            {item.pct}%
                            {item.pendingPct > 0 && (
                              <span className="text-xs text-[var(--warn-text)]">
                                +{item.pendingPct}%
                              </span>
                            )}
                          </span>
                          {item.nearLimit && (
                            <StatusChip variant="nearLimit">{t('nearLimit')}</StatusChip>
                          )}
                        </div>
                      </div>

                      <div className="relative h-2 rounded-full bg-[var(--surface-subtle)] overflow-visible flex">
                        <div
                          className="h-full rounded-l-full bg-[var(--accent)] transition-all motion-reduce:transition-none"
                          style={{ width: `${Math.max(0, Math.min(100, item.pct))}%` }}
                        />
                        {item.pendingPct > 0 && (
                          <div
                            className="h-full bg-[var(--warn-text)]/70 transition-all motion-reduce:transition-none"
                            style={{ width: `${item.pendingPct}%` }}
                          />
                        )}
                        {item.capRate !== null && item.capRate > 0 && item.capRate <= 100 && (
                          <div
                            title={`Ministry cap: ${item.capRate}%`}
                            className="absolute -top-0.5 -bottom-0.5 w-[2px] bg-[var(--warn-text)] rounded-full"
                            style={{ left: `${item.capRate}%` }}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {headProgress.length > 7 && (
                  <button
                    type="button"
                    onClick={() => setShowAllHeads((v) => !v)}
                    className="min-h-[44px] w-full rounded-xl border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--accent)] inline-flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    {showAllHeads ? (
                      <>
                        <ChevronUp className="w-4 h-4" />
                        <span>{t('showFewerHeads')}</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4" />
                        <span>
                          {t('showAllHeads')} ({headProgress.length})
                        </span>
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </section>
        </div>

        <div className="contents lg:flex lg:flex-col lg:gap-5">
          {/* 2. Attention Card (hidden when nothing to show) */}
          {attentionItems.length > 0 && (
            <section className="order-2 lg:order-none rounded-[14px] border border-[var(--warn-text)]/30 bg-[var(--warn-bg)] text-[var(--warn-text)] overflow-hidden divide-y divide-[var(--warn-text)]/15">
              {attentionItems.map((item) => (
                <Link
                  key={item.key}
                  to={item.to}
                  className="min-h-[48px] px-4 py-3 flex items-center justify-between gap-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span className="text-xs sm:text-sm font-semibold break-words">
                      {item.text}
                    </span>
                  </div>
                  <ChevronRight className="w-4 h-4 shrink-0" />
                </Link>
              ))}
            </section>
          )}

          {/* 3. Quick Actions */}
          {(canCreateBill || canCreateExpense) && (
            <div className="order-3 lg:order-none grid grid-cols-2 gap-2.5">
              {canCreateBill && (
                <Link
                  to="/expense-items"
                  className="min-h-[44px] px-3.5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <ReceiptText className="w-4 h-4 shrink-0" />
                  <span className="truncate">খরচ থেকে বিল</span>
                </Link>
              )}
              {canCreateExpense && (
                <Link
                  to="/expense-items?new=1"
                  className="min-h-[44px] px-3.5 rounded-xl border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-[var(--text)] text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t('addExpenseBtn')}</span>
                </Link>
              )}
            </div>
          )}

          {/* 4. KPI Row (3 small StatCards) */}
          <div className="order-4 lg:order-none grid grid-cols-3 gap-2.5 md:gap-3">
            <StatCard
              label={t('billsKpiLabel')}
              value={loading ? '—' : bills.length}
            />
            <StatCard
              label={t('expensesBilledKpiLabel')}
              value={loading ? '—' : totals.billedExpensesCount}
            />
            <StatCard
              label={t('headsKpiLabel')}
              value={loading ? '—' : headProgress.length}
            />
          </div>

          {/* 6. Recent Bills (last 3) */}
          <section className="order-6 lg:order-none card-surface overflow-hidden">
            <div className="px-4 py-3.5 border-b border-[var(--line)] flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-[var(--text)]">{t('recentBills')}</h2>
              <Link
                to="/bills"
                className="min-h-[44px] px-2 -mr-2 inline-flex items-center text-xs font-semibold text-[var(--accent)] hover:underline shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-lg"
              >
                সব দেখুন
              </Link>
            </div>

            {loading ? (
              <div className="p-4 text-sm text-[var(--muted)]">সাম্প্রতিক বিল লোড হচ্ছে…</div>
            ) : recentBills.length === 0 ? (
              <div className="p-4 text-sm text-[var(--muted)]">
                FY {selectedFy}-এ এখনো কোনো বিল প্রস্তুত হয়নি।
              </div>
            ) : (
              <div className="divide-y divide-[var(--line)]">
                {recentBills.map((b) => {
                  const head = getHead(b.economicCode, {
                    headName: b.headName,
                    headNameBn: b.headNameBn,
                  });
                  return (
                    <Link
                      key={b.id}
                      to={`/bills/${b.id}`}
                      className="min-h-[56px] px-4 py-3 flex items-center justify-between gap-3 hover:bg-[var(--surface-subtle)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--text)] tabular-nums truncate">
                            {b.billNo || t('draft')}
                          </span>
                          <span className="text-xs text-[var(--muted)] tabular-nums shrink-0">
                            {formatDateDisplay(b.date)}
                          </span>
                        </div>
                        <div className="text-xs text-[var(--muted)] truncate bn mt-0.5">
                          {head.headNameBn || head.headName}
                        </div>
                      </div>
                      <div className="text-right shrink-0 space-y-1">
                        <div className="text-sm font-bold text-[var(--text)] tabular-nums">
                          {formatTaka(b.netPayable)}
                        </div>
                        <div>
                          <StatusChip variant={billStatusToChip(b.status)}>
                            {t(b.status)}
                          </StatusChip>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </Layout>
  );
}
