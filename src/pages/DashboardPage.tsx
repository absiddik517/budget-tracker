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
import { canApproveRejectVoid } from '../lib/permissions';
import type { SpendingStatus } from '../types';

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

export function DashboardPage() {
  const { userDoc } = useAuth();
  const { selectedFy, t } = useApp();
  const { budgets, spendings, spendingLimits, loading } = useFyData(selectedFy);
  const { getHead } = useEconomicCodes();

  const canReview = userDoc ? canApproveRejectVoid(userDoc.role) : false;

  const totals = useMemo(() => {
    const totalAllocated = budgets.reduce((sum, b) => sum + b.allocated, 0);
    const totalSpent = budgets.reduce((sum, b) => sum + b.spent, 0);
    const remaining = totalAllocated - totalSpent;
    const netPaid = spendings
      .filter((s) => s.status === 'approved')
      .reduce((sum, s) => sum + s.netPayable, 0);
    const pendingCount = spendings.filter((s) => s.status === 'submitted').length;
    const pctUsed = totalAllocated > 0 ? Math.min(100, Math.round((totalSpent / totalAllocated) * 100)) : 0;
    return { totalAllocated, totalSpent, remaining, netPaid, pendingCount, pctUsed };
  }, [budgets, spendings]);

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
      }
    >();

    for (const b of budgets) {
      const resolved = getHead(b.economicCode, {
        headName: b.headName,
        headNameBn: b.headNameBn,
      });
      const existing = map.get(b.economicCode);
      if (existing) {
        existing.allocated += b.allocated;
        existing.spent += b.spent;
      } else {
        map.set(b.economicCode, {
          economicCode: b.economicCode,
          headName: resolved.headName,
          headNameBn: resolved.headNameBn,
          allocated: b.allocated,
          spent: b.spent,
        });
      }
    }

    return Array.from(map.values())
      .map((item) => {
        const pct = item.allocated > 0 ? Math.round((item.spent / item.allocated) * 100) : 0;
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
        const nearCap = capAmount !== null && capAmount > 0 ? item.spent / capAmount >= 0.8 : false;
        const nearAlloc = item.allocated > 0 ? item.spent / item.allocated >= 0.8 : false;

        return {
          ...item,
          pct,
          capRate: activeCap?.rate ?? null,
          nearLimit: nearCap || nearAlloc,
        };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [budgets, spendingLimits, getHead]);

  const recentSpendings = useMemo(() => spendings.slice(0, 5), [spendings]);

  return (
    <Layout title={t('navDashboard')}>
      <div className="space-y-3.5 md:space-y-5">
        {/* Pending Approval Banner for DDO & Super Admin */}
        {canReview && totals.pendingCount > 0 && (
          <Link
            to="/spending?status=submitted"
            className="card-surface px-3.5 md:px-4 py-3 min-h-[44px] flex items-center justify-between gap-3 hover:bg-[var(--surface-subtle)] transition-colors"
          >
            <div className="text-sm font-medium text-[var(--text)] min-w-0">
              <span className="font-bold text-[var(--accent)] tabular-nums">
                {totals.pendingCount}
              </span>{' '}
              {t('pendingApproval').toLowerCase()}
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] shrink-0">
              <span>Review</span>
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
            {loading ? '—' : formatTaka(totals.remaining)}
          </div>
          <div className="h-2 rounded-full bg-[var(--surface-subtle)] overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] rounded-full transition-all"
              style={{ width: `${totals.pctUsed}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs text-[var(--muted)] tabular-nums">
            <span>Spent {formatTaka(totals.totalSpent)}</span>
            <span>of {formatTaka(totals.totalAllocated)}</span>
          </div>
        </div>

        {/* Desktop 4 KPI Cards */}
        <div className="hidden lg:grid lg:grid-cols-4 gap-4">
          <div className="card-surface p-5">
            <div className="text-xs font-medium text-[var(--muted)]">{t('totalAllocation')}</div>
            <div className="text-2xl font-bold text-[var(--text)] mt-1.5 tabular-nums">
              {loading ? '—' : formatTaka(totals.totalAllocated)}
            </div>
          </div>
          <div className="card-surface p-5">
            <div className="text-xs font-medium text-[var(--muted)]">{t('totalSpent')}</div>
            <div className="text-2xl font-bold text-[var(--text)] mt-1.5 tabular-nums">
              {loading ? '—' : formatTaka(totals.totalSpent)}
            </div>
          </div>
          <div className="card-surface p-5">
            <div className="text-xs font-medium text-[var(--muted)]">{t('remaining')}</div>
            <div className="text-2xl font-bold text-[var(--accent)] mt-1.5 tabular-nums">
              {loading ? '—' : formatTaka(totals.remaining)}
            </div>
          </div>
          <div className="card-surface p-5">
            <div className="text-xs font-medium text-[var(--muted)]">{t('netPaid')}</div>
            <div className="text-2xl font-bold text-[var(--text)] mt-1.5 tabular-nums">
              {loading ? '—' : formatTaka(totals.netPaid)}
            </div>
          </div>
        </div>

        {/* Spending by head */}
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
                      </span>
                      {item.nearLimit && (
                        <StatusChip variant="nearLimit">{t('nearLimit')}</StatusChip>
                      )}
                    </div>
                  </div>

                  <div className="relative h-2.5 rounded-full bg-[var(--surface-subtle)] overflow-visible">
                    <div
                      className="h-full rounded-full bg-[var(--accent)] transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, item.pct))}%` }}
                    />
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

        {/* Recent spending */}
        <section className="card-surface overflow-hidden">
          <div className="px-4 md:px-5 pt-4 md:pt-5 pb-2.5 md:pb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[var(--text)]">{t('recentSpending')}</h2>
            <Link
              to="/spending"
              className="min-h-[36px] inline-flex items-center text-xs font-medium text-[var(--accent)] hover:underline shrink-0"
            >
              View all
            </Link>
          </div>

          {loading ? (
            <p className="px-4 md:px-5 pb-4 md:pb-5 text-sm text-[var(--muted)]">Loading recent spending…</p>
          ) : recentSpendings.length === 0 ? (
            <p className="px-4 md:px-5 pb-4 md:pb-5 text-sm text-[var(--muted)]">
              No spending entries recorded in FY {selectedFy}.
            </p>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                      <th className="sticky left-0 z-10 bg-[var(--card)] py-2.5 px-5 font-medium whitespace-nowrap">{t('date')}</th>
                      <th className="py-2.5 px-4 font-medium">{t('payee')}</th>
                      <th className="py-2.5 px-4 font-medium">{t('head')}</th>
                      <th className="py-2.5 px-4 font-medium text-right whitespace-nowrap">{t('gross')}</th>
                      <th className="py-2.5 px-4 font-medium text-right whitespace-nowrap">{t('net')}</th>
                      <th className="py-2.5 px-5 font-medium">{t('status')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {recentSpendings.map((s) => {
                      const head = getHead(s.economicCode, {
                        headName: s.headName,
                        headNameBn: s.headNameBn,
                      });
                      return (
                        <tr key={s.id} className="group hover:bg-[var(--surface-subtle)] transition-colors">
                          <td className="sticky left-0 z-10 bg-[var(--card)] group-hover:bg-[var(--surface-subtle)] py-3 px-5 tabular-nums whitespace-nowrap text-[var(--muted)] transition-colors">
                            {formatDateDisplay(s.date)}
                          </td>
                          <td className="py-3 px-4 font-medium">{s.payee}</td>
                          <td className="py-3 px-4">{head.headName}</td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                            {formatNumberIN(s.gross)}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                            {formatNumberIN(s.netPayable)}
                          </td>
                          <td className="py-3 px-5 whitespace-nowrap">
                            <StatusChip variant={statusToChip(s.status)}>
                              {t(s.status)}
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
                {recentSpendings.map((s) => {
                  const head = getHead(s.economicCode, {
                    headName: s.headName,
                    headNameBn: s.headNameBn,
                  });
                  return (
                    <div key={s.id} className="px-4 py-2.5 flex items-center justify-between gap-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--text)] truncate">
                          {head.headName}
                        </div>
                        <div className="text-xs text-[var(--muted)] truncate mt-0.5">
                          {formatDateDisplay(s.date)} · {s.payee} · {t(s.status)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold tabular-nums">
                          {formatTaka(s.gross)}
                        </div>
                        <div className="text-xs text-[var(--muted)] tabular-nums mt-0.5">
                          Net {formatNumberIN(s.netPayable)}
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
