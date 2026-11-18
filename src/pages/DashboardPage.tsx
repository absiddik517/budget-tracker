import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Layout } from '../components/Layout';
import { StatusChip, type ChipVariant } from '../components/StatusChip';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { useFyData } from '../hooks/useFyData';
import { useEconomicCodes } from '../hooks/useEconomicCodes';
import { formatDateDisplay, todayYmd } from '../lib/dates';
import { formatNumberIN, formatTaka } from '../lib/money';
import { canApproveRejectCancelBill } from '../lib/permissions';
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
  const { userDoc } = useAuth();
  const { selectedFy, t } = useApp();
  const { budgets, expenseItems, bills, spendingLimits, loading } = useFyData(selectedFy);
  const { getHead } = useEconomicCodes();

  const canReview = userDoc ? canApproveRejectCancelBill(userDoc.role) : false;

  const totals = useMemo(() => {
    const totalAllocated = budgets.reduce((sum, b) => sum + b.allocated, 0);
    const approvedSpent = budgets.reduce((sum, b) => sum + b.spent, 0);
    const pendingAmount = budgets.reduce((sum, b) => sum + Math.max(0, b.pendingAmount || 0), 0);
    const available = totalAllocated - approvedSpent - pendingAmount;
    const netPaid = bills
      .filter((b) => b.status === 'approved')
      .reduce((sum, b) => sum + b.netPayable, 0);
    const pendingCount = bills.filter((b) => b.status === 'submitted').length;
    const listedItemsCount = expenseItems.filter((i) => i.status === 'listed').length;
    const pctApproved =
      totalAllocated > 0 ? Math.min(100, Math.round((approvedSpent / totalAllocated) * 100)) : 0;
    const pctPending =
      totalAllocated > 0
        ? Math.min(100 - pctApproved, Math.round((pendingAmount / totalAllocated) * 100))
        : 0;
    return {
      totalAllocated,
      approvedSpent,
      pendingAmount,
      available,
      netPaid,
      pendingCount,
      listedItemsCount,
      pctApproved,
      pctPending,
    };
  }, [budgets, bills, expenseItems]);

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

  const recentBills = useMemo(() => bills.slice(0, 5), [bills]);

  return (
    <Layout title={t('navDashboard')}>
      <div className="space-y-3.5 md:space-y-5">
        {/* Pending Approval Banner for DDO */}
        {canReview && totals.pendingCount > 0 && (
          <Link
            to="/bills?status=submitted"
            className="card-surface px-3.5 md:px-4 py-3 min-h-[44px] flex items-center justify-between gap-3 hover:bg-[var(--surface-subtle)] transition-colors"
          >
            <div className="text-sm font-medium text-[var(--text)] min-w-0">
              <span className="font-bold text-[var(--accent)] tabular-nums">
                {totals.pendingCount}
              </span>{' '}
              {t('pendingApproval')}
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] shrink-0">
              <span>পর্যালোচনা</span>
              <ChevronRight className="w-4 h-4" />
            </span>
          </Link>
        )}

        {/* Quick Link if listed expense items await bill creation */}
        {totals.listedItemsCount > 0 && (
          <Link
            to="/expense-items"
            className="card-surface px-3.5 md:px-4 py-2.5 min-h-[44px] flex items-center justify-between gap-3 hover:bg-[var(--surface-subtle)] transition-colors"
          >
            <div className="text-xs md:text-sm text-[var(--muted)] min-w-0">
              <span className="font-bold text-[var(--text)] tabular-nums">
                {totals.listedItemsCount}টি
              </span>{' '}
              তালিকাভুক্ত খরচ আইটেম বিল প্রস্তুতের জন্য অপেক্ষমান
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] shrink-0">
              <span>বিল প্রস্তুত</span>
              <ChevronRight className="w-4 h-4" />
            </span>
          </Link>
        )}

        {/* Mobile Hero Card */}
        <div className="lg:hidden card-surface p-4 sm:p-5 space-y-2.5">
          <div className="text-xs font-medium text-[var(--muted)]">
            {t('remainingAllocation')}
          </div>
          <div className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--accent)] tabular-nums break-words">
            {loading ? '—' : formatTaka(totals.available)}
          </div>
          <div className="h-2 rounded-full bg-[var(--surface-subtle)] overflow-hidden flex">
            <div
              className="h-full bg-[var(--accent)] transition-all"
              style={{ width: `${totals.pctApproved}%` }}
            />
            <div
              className="h-full bg-[var(--warn-text)]/70 transition-all"
              style={{ width: `${totals.pctPending}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs text-[var(--muted)] tabular-nums">
            <span>
              {t('approvedSpent')}: {formatTaka(totals.approvedSpent)} · {t('pendingAmount')}:{' '}
              {formatTaka(totals.pendingAmount)}
            </span>
            <span>
              {t('totalAllocation')}: {formatTaka(totals.totalAllocated)}
            </span>
          </div>
        </div>

        {/* Desktop 5 KPI Cards */}
        <div className="hidden lg:grid lg:grid-cols-5 gap-4">
          <div className="card-surface p-4">
            <div className="text-xs font-medium text-[var(--muted)]">{t('totalAllocation')}</div>
            <div className="text-xl font-bold text-[var(--text)] mt-1.5 tabular-nums">
              {loading ? '—' : formatTaka(totals.totalAllocated)}
            </div>
          </div>
          <div className="card-surface p-4">
            <div className="text-xs font-medium text-[var(--muted)]">{t('approvedSpent')}</div>
            <div className="text-xl font-bold text-[var(--text)] mt-1.5 tabular-nums">
              {loading ? '—' : formatTaka(totals.approvedSpent)}
            </div>
          </div>
          <div className="card-surface p-4">
            <div className="text-xs font-medium text-[var(--muted)]">{t('pendingAmount')}</div>
            <div className="text-xl font-bold text-[var(--warn-text)] mt-1.5 tabular-nums">
              {loading ? '—' : formatTaka(totals.pendingAmount)}
            </div>
          </div>
          <div className="card-surface p-4">
            <div className="text-xs font-medium text-[var(--muted)]">{t('available')}</div>
            <div className="text-xl font-bold text-[var(--accent)] mt-1.5 tabular-nums">
              {loading ? '—' : formatTaka(totals.available)}
            </div>
          </div>
          <div className="card-surface p-4">
            <div className="text-xs font-medium text-[var(--muted)]">{t('netPaid')}</div>
            <div className="text-xl font-bold text-[var(--text)] mt-1.5 tabular-nums">
              {loading ? '—' : formatTaka(totals.netPaid)}
            </div>
          </div>
        </div>

        {/* Budget Utilization by head */}
        <section className="card-surface p-4 md:p-5 space-y-3.5 md:space-y-4">
          <h2 className="text-base font-semibold text-[var(--text)]">{t('spendingByHead')}</h2>

          {loading ? (
            <p className="text-sm text-[var(--muted)]">Loading budget utilization…</p>
          ) : headProgress.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No allocations found for FY {selectedFy}.
            </p>
          ) : (
            <div className="space-y-3.5 md:space-y-4">
              {headProgress.map((item) => (
                <div key={item.economicCode} className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="min-w-0 flex-1 break-words">
                      <span className="text-sm font-medium text-[var(--text)]">
                        {item.headName}
                      </span>{' '}
                      {item.headNameBn && (
                        <span className="bn inline-block ml-0.5 break-words">{item.headNameBn}</span>
                      )}
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

                  <div className="relative h-2.5 rounded-full bg-[var(--surface-subtle)] overflow-visible flex">
                    <div
                      className="h-full rounded-l-full bg-[var(--accent)] transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, item.pct))}%` }}
                    />
                    {item.pendingPct > 0 && (
                      <div
                        className="h-full bg-[var(--warn-text)]/70 transition-all"
                        style={{ width: `${item.pendingPct}%` }}
                      />
                    )}
                    {item.capRate !== null && item.capRate > 0 && item.capRate <= 100 && (
                      <div
                        title={`Ministry cap: ${item.capRate}%`}
                        className="absolute -top-1 -bottom-1 w-[2px] bg-[var(--warn-text)] rounded-full"
                        style={{ left: `${item.capRate}%` }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent Bills */}
        <section className="card-surface overflow-hidden">
          <div className="px-4 md:px-5 pt-4 md:pt-5 pb-2.5 md:pb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[var(--text)]">{t('recentBills')}</h2>
            <Link
              to="/bills"
              className="min-h-[36px] inline-flex items-center text-xs font-medium text-[var(--accent)] hover:underline shrink-0"
            >
              সব দেখুন
            </Link>
          </div>

          {loading ? (
            <p className="px-4 md:px-5 pb-4 md:pb-5 text-sm text-[var(--muted)]">
              সাম্প্রতিক বিল লোড হচ্ছে…
            </p>
          ) : recentBills.length === 0 ? (
            <p className="px-4 md:px-5 pb-4 md:pb-5 text-sm text-[var(--muted)]">
              FY {selectedFy}-এ এখনো কোনো বিল প্রস্তুত হয়নি।
            </p>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                      <th className="sticky left-0 z-10 bg-[var(--card)] py-2.5 px-5 font-medium whitespace-nowrap">
                        {t('billNo')}
                      </th>
                      <th className="py-2.5 px-4 font-medium whitespace-nowrap">{t('date')}</th>
                      <th className="py-2.5 px-4 font-medium">{t('head')}</th>
                      <th className="py-2.5 px-4 font-medium text-right whitespace-nowrap">
                        {t('gross')}
                      </th>
                      <th className="py-2.5 px-4 font-medium text-right whitespace-nowrap">
                        {t('netPayable')}
                      </th>
                      <th className="py-2.5 px-5 font-medium">{t('status')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {recentBills.map((b) => {
                      const head = getHead(b.economicCode, {
                        headName: b.headName,
                        headNameBn: b.headNameBn,
                      });
                      return (
                        <tr
                          key={b.id}
                          className="group hover:bg-[var(--surface-subtle)] transition-colors"
                        >
                          <td className="sticky left-0 z-10 bg-[var(--card)] group-hover:bg-[var(--surface-subtle)] py-3 px-5 font-semibold tabular-nums whitespace-nowrap transition-colors">
                            {b.billNo || 'খসড়া'}
                          </td>
                          <td className="py-3 px-4 tabular-nums whitespace-nowrap text-[var(--muted)]">
                            {formatDateDisplay(b.date)}
                          </td>
                          <td className="py-3 px-4">
                            {b.economicCode} {head.headName}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                            {formatNumberIN(b.grossAmount)}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap font-medium">
                            {formatNumberIN(b.netPayable)}
                          </td>
                          <td className="py-3 px-5 whitespace-nowrap">
                            <StatusChip variant={billStatusToChip(b.status)}>
                              {t(b.status)}
                            </StatusChip>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Compact List */}
              <div className="sm:hidden divide-y divide-[var(--line)]">
                {recentBills.map((b) => {
                  const head = getHead(b.economicCode, {
                    headName: b.headName,
                    headNameBn: b.headNameBn,
                  });
                  return (
                    <div
                      key={b.id}
                      className="px-4 py-2.5 flex items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--text)] truncate">
                          {b.billNo || 'খসড়া'} · {head.headName}
                        </div>
                        <div className="text-xs text-[var(--muted)] truncate mt-0.5">
                          {formatDateDisplay(b.date)} · {b.items.length}টি আইটেম · {t(b.status)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold tabular-nums">
                          {formatTaka(b.grossAmount)}
                        </div>
                        <div className="text-xs text-[var(--muted)] tabular-nums mt-0.5">
                          নিট {formatNumberIN(b.netPayable)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </Layout>
  );
}
