import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Layout } from '../components/Layout';
import { EconomicCodeSelect } from '../components/EconomicCodeSelect';
import { useApp } from '../contexts/AppContext';
import { useFyData } from '../hooks/useFyData';
import { useEconomicCodes } from '../hooks/useEconomicCodes';
import { formatDateDisplay } from '../lib/dates';
import { fromPaisa, formatNumberIN } from '../lib/money';

type ReportTab = 'allocations' | 'summary' | 'headSpending' | 'deductions';

export function ReportsPage() {
  const { selectedFy, t } = useApp();
  const { budgets, spendings, loading } = useFyData(selectedFy);
  const { getHead } = useEconomicCodes();

  const [tab, setTab] = useState<ReportTab>('allocations');
  const [selectedCode, setSelectedCode] = useState('');
  const [budgetStatusFilter, setBudgetStatusFilter] = useState<'all' | 'active' | 'executed'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const filteredBudgets = useMemo(() => {
    return budgets.filter((b) => {
      if (budgetStatusFilter !== 'all' && b.status !== budgetStatusFilter) return false;
      if (selectedCode && b.economicCode !== selectedCode) return false;
      return true;
    });
  }, [budgets, budgetStatusFilter, selectedCode]);

  // 1. FY Allocations grouped by economic code (including revisions)
  const allocationsGrouped = useMemo(() => {
    const map = new Map<
      string,
      {
        economicCode: string;
        headName: string;
        headNameBn: string;
        entries: typeof filteredBudgets;
        allocated: number;
        spent: number;
        remaining: number;
      }
    >();
    for (const b of filteredBudgets) {
      const head = getHead(b.economicCode, { headName: b.headName, headNameBn: b.headNameBn });
      const existing = map.get(b.economicCode);
      if (existing) {
        existing.entries.push(b);
        existing.allocated += b.allocated;
        existing.spent += b.spent;
        existing.remaining += b.remaining;
      } else {
        map.set(b.economicCode, {
          economicCode: b.economicCode,
          headName: head.headName,
          headNameBn: head.headNameBn,
          entries: [b],
          allocated: b.allocated,
          spent: b.spent,
          remaining: b.remaining,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.economicCode.localeCompare(b.economicCode));
  }, [filteredBudgets, getHead]);

  // 2. Budget Summary per head with totals
  const summaryRows = useMemo(() => {
    return allocationsGrouped.map((g) => ({
      economicCode: g.economicCode,
      headName: g.headName,
      headNameBn: g.headNameBn,
      allocated: g.allocated,
      spent: g.spent,
      remaining: g.remaining,
      usedPct: g.allocated > 0 ? Math.round((g.spent / g.allocated) * 100) : 0,
    }));
  }, [allocationsGrouped]);

  const summaryTotals = useMemo(() => {
    const allocated = summaryRows.reduce((s, r) => s + r.allocated, 0);
    const spent = summaryRows.reduce((s, r) => s + r.spent, 0);
    const remaining = allocated - spent;
    const usedPct = allocated > 0 ? Math.round((spent / allocated) * 100) : 0;
    return { allocated, spent, remaining, usedPct };
  }, [summaryRows]);

  // 3. Head-wise Spending (approved only, optional date range)
  const approvedSpendings = useMemo(() => {
    return spendings.filter((s) => {
      if (s.status !== 'approved') return false;
      if (selectedCode && s.economicCode !== selectedCode) return false;
      if (fromDate && s.date < fromDate) return false;
      if (toDate && s.date > toDate) return false;
      return true;
    });
  }, [spendings, selectedCode, fromDate, toDate]);

  const headWiseTotals = useMemo(() => {
    const map = new Map<
      string,
      {
        economicCode: string;
        headName: string;
        count: number;
        gross: number;
        deductions: number;
        net: number;
      }
    >();
    for (const s of approvedSpendings) {
      const head = getHead(s.economicCode, { headName: s.headName, headNameBn: s.headNameBn });
      const ded = s.gross - s.netPayable;
      const cur = map.get(s.economicCode);
      if (cur) {
        cur.count += 1;
        cur.gross += s.gross;
        cur.deductions += ded;
        cur.net += s.netPayable;
      } else {
        map.set(s.economicCode, {
          economicCode: s.economicCode,
          headName: head.headName,
          count: 1,
          gross: s.gross,
          deductions: ded,
          net: s.netPayable,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.economicCode.localeCompare(b.economicCode));
  }, [approvedSpendings, getHead]);

  // 4. VAT / IT Deductions per head and overall
  const deductionRows = useMemo(() => {
    const map = new Map<
      string,
      {
        economicCode: string;
        headName: string;
        gross: number;
        vat: number;
        it: number;
        serviceCharge: number;
        others: number;
        netPayable: number;
      }
    >();
    for (const s of spendings.filter(
      (sp) => sp.status === 'approved' && (!selectedCode || sp.economicCode === selectedCode)
    )) {
      const head = getHead(s.economicCode, { headName: s.headName, headNameBn: s.headNameBn });
      const othersAmt = (s.deductions.others || []).reduce((acc, o) => acc + o.amount, 0);
      const cur = map.get(s.economicCode);
      if (cur) {
        cur.gross += s.gross;
        cur.vat += s.deductions.vat;
        cur.it += s.deductions.it;
        cur.serviceCharge += s.deductions.serviceCharge;
        cur.others += othersAmt;
        cur.netPayable += s.netPayable;
      } else {
        map.set(s.economicCode, {
          economicCode: s.economicCode,
          headName: head.headName,
          gross: s.gross,
          vat: s.deductions.vat,
          it: s.deductions.it,
          serviceCharge: s.deductions.serviceCharge,
          others: othersAmt,
          netPayable: s.netPayable,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.economicCode.localeCompare(b.economicCode));
  }, [spendings, selectedCode, getHead]);

  const deductionTotals = useMemo(() => {
    return deductionRows.reduce(
      (acc, r) => ({
        gross: acc.gross + r.gross,
        vat: acc.vat + r.vat,
        it: acc.it + r.it,
        serviceCharge: acc.serviceCharge + r.serviceCharge,
        others: acc.others + r.others,
        netPayable: acc.netPayable + r.netPayable,
      }),
      { gross: 0, vat: 0, it: 0, serviceCharge: 0, others: 0, netPayable: 0 }
    );
  }, [deductionRows]);

  const handleExportPdf = () => {
    window.print();
  };

  const handleExportExcel = () => {
    let rows: Array<Record<string, string | number>> = [];
    let sheetName = 'Report';

    if (tab === 'allocations') {
      sheetName = 'FY Allocations';
      rows = filteredBudgets.map((b) => {
        const head = getHead(b.economicCode, { headName: b.headName, headNameBn: b.headNameBn });
        return {
          'Economic Code': b.economicCode,
          Head: head.headName,
          'Memo No': b.memoNo,
          'Memo Date': formatDateDisplay(b.memoDate),
          Type: b.entryType,
          'Allocated (BDT)': fromPaisa(b.allocated),
          'Spent (BDT)': fromPaisa(b.spent),
          'Remaining (BDT)': fromPaisa(b.remaining),
          Status: b.status,
        };
      });
    } else if (tab === 'summary') {
      sheetName = 'Budget Summary';
      rows = summaryRows.map((r) => ({
        Head: `${r.economicCode} ${r.headName}`,
        'Allocated (BDT)': fromPaisa(r.allocated),
        'Spent (BDT)': fromPaisa(r.spent),
        'Remaining (BDT)': fromPaisa(r.remaining),
        'Used (%)': `${r.usedPct}%`,
      }));
    } else if (tab === 'headSpending') {
      sheetName = 'Head-wise Spending';
      rows = approvedSpendings.map((s) => {
        const head = getHead(s.economicCode, { headName: s.headName, headNameBn: s.headNameBn });
        return {
          Date: formatDateDisplay(s.date),
          Bill: s.billNo,
          Cheque: s.chequeNo || '',
          Payee: s.payee,
          Head: `${s.economicCode} ${head.headName}`,
          'Gross (BDT)': fromPaisa(s.gross),
          'Deductions (BDT)': fromPaisa(s.gross - s.netPayable),
          'Net (BDT)': fromPaisa(s.netPayable),
        };
      });
    } else {
      sheetName = 'VAT IT Deductions';
      rows = deductionRows.map((r) => ({
        Head: `${r.economicCode} ${r.headName}`,
        'Gross (BDT)': fromPaisa(r.gross),
        'VAT (BDT)': fromPaisa(r.vat),
        'Income Tax (BDT)': fromPaisa(r.it),
        'Service Charge (BDT)': fromPaisa(r.serviceCharge),
        'Others (BDT)': fromPaisa(r.others),
        'Net Payable (BDT)': fromPaisa(r.netPayable),
      }));
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `budget-report-${tab}-FY-${selectedFy}.xlsx`);
  };

  const actions = (
    <div className="flex items-center gap-1.5 sm:gap-2">
      <button
        type="button"
        onClick={handleExportPdf}
        className="min-h-[44px] md:min-h-[40px] px-3 sm:px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text)] whitespace-nowrap"
      >
        PDF
      </button>
      <button
        type="button"
        onClick={handleExportExcel}
        className="min-h-[44px] md:min-h-[40px] px-3 sm:px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text)] whitespace-nowrap"
      >
        Excel
      </button>
    </div>
  );

  return (
    <Layout title={t('navReports')} actions={actions}>
      <div className="space-y-3.5 md:space-y-4">
        {/* Report Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 no-print">
          {(
            [
              { id: 'allocations', label: 'FY Allocations' },
              { id: 'summary', label: 'Budget Summary' },
              { id: 'headSpending', label: 'Head-wise Spending' },
              { id: 'deductions', label: 'VAT / IT Deductions' },
            ] as const
          ).map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`min-h-[44px] md:min-h-[38px] px-3.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'bg-[var(--card)] border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Sub-filters */}
        <div className="flex flex-col md:flex-row md:items-center gap-2.5 flex-wrap no-print">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="min-h-[34px] inline-flex items-center px-3 py-1 rounded-full text-xs border border-[var(--line)] text-[var(--muted)] tabular-nums">
              FY {selectedFy}
            </span>

            {(tab === 'allocations' || tab === 'summary') && (
              <select
                value={budgetStatusFilter}
                onChange={(e) =>
                  setBudgetStatusFilter(e.target.value as 'all' | 'active' | 'executed')
                }
                aria-label="Filter budget status"
                className="min-h-[44px] md:min-h-[36px] px-3 rounded-lg md:rounded-full text-base md:text-xs border border-[var(--line)] bg-[var(--card)] text-[var(--text)]"
              >
                <option value="all">All statuses</option>
                <option value="active">Active only</option>
                <option value="executed">Executed only</option>
              </select>
            )}
          </div>

          <div className="w-full md:w-72">
            <EconomicCodeSelect
              value={selectedCode}
              onChange={(code) => setSelectedCode(code)}
              placeholder="All economic codes"
              clearable
              includeInactive
            />
          </div>

          {tab === 'headSpending' && (
            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full md:w-auto">
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 min-w-0">
                <label className="text-xs text-[var(--muted)]">From</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full min-w-0 min-h-[44px] md:min-h-[36px] px-2.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs tabular-nums"
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 min-w-0">
                <label className="text-xs text-[var(--muted)]">To</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full min-w-0 min-h-[44px] md:min-h-[36px] px-2.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs tabular-nums"
                />
              </div>
            </div>
          )}
        </div>

        {/* Report Content */}
        <div className="card-surface overflow-hidden">
          {loading ? (
            <p className="p-6 text-sm text-[var(--muted)]">Loading report data…</p>
          ) : tab === 'allocations' ? (
            <>
              {/* Mobile Cards (screen only) */}
              <div className="md:hidden print:hidden divide-y divide-[var(--line)]">
                {allocationsGrouped.length === 0 ? (
                  <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                    {t('noDataFound')}
                  </div>
                ) : (
                  allocationsGrouped.map((group) => (
                    <div key={group.economicCode} className="p-3.5 space-y-2.5">
                      <div className="min-w-0">
                        <div className="text-xs font-bold tabular-nums text-[var(--accent)]">
                          {group.economicCode}
                        </div>
                        <div className="text-sm font-semibold text-[var(--text)] break-words">
                          {group.headName}
                        </div>
                        {group.headNameBn && (
                          <div className="bn mt-0.5 break-words">{group.headNameBn}</div>
                        )}
                      </div>

                      <div className="space-y-2">
                        {group.entries.map((entry) => (
                          <div
                            key={entry.id}
                            className="p-2.5 rounded-lg bg-[var(--surface-subtle)] space-y-1.5 text-xs"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold text-[var(--text)]">
                                {entry.memoNo} <span className="capitalize font-normal text-[var(--muted)]">({entry.entryType})</span>
                              </span>
                              <span className="tabular-nums text-[var(--muted)]">
                                {formatDateDisplay(entry.memoDate)}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <div className="min-w-0">
                                <div className="text-[11px] text-[var(--muted)]">Allocated</div>
                                <div className="font-medium tabular-nums truncate">
                                  {formatNumberIN(entry.allocated)}
                                </div>
                              </div>
                              <div className="min-w-0">
                                <div className="text-[11px] text-[var(--muted)]">Spent</div>
                                <div className="font-medium tabular-nums truncate">
                                  {formatNumberIN(entry.spent)}
                                </div>
                              </div>
                              <div className="min-w-0 text-right">
                                <div className="text-[11px] text-[var(--muted)]">Remaining</div>
                                <div className="font-semibold text-[var(--accent)] tabular-nums truncate">
                                  {formatNumberIN(entry.remaining)}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      {group.entries.length > 1 && (
                        <div className="grid grid-cols-3 gap-2 pt-1.5 text-xs border-t border-[var(--line)] font-semibold">
                          <div className="min-w-0">
                            <div className="text-[11px] text-[var(--muted)] font-normal">Subtotal Alloc</div>
                            <div className="tabular-nums truncate">{formatNumberIN(group.allocated)}</div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[11px] text-[var(--muted)] font-normal">Subtotal Spent</div>
                            <div className="tabular-nums truncate">{formatNumberIN(group.spent)}</div>
                          </div>
                          <div className="min-w-0 text-right">
                            <div className="text-[11px] text-[var(--muted)] font-normal">Subtotal Rem</div>
                            <div className="tabular-nums text-[var(--accent)] truncate">
                              {formatNumberIN(group.remaining)}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Desktop & Print Table */}
              <div className="hidden md:block print:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                      <th className="sticky left-0 print:static z-10 bg-[var(--card)] py-3 px-4 font-medium">Head</th>
                      <th className="py-3 px-4 font-medium whitespace-nowrap">Memo No</th>
                      <th className="py-3 px-4 font-medium whitespace-nowrap">Date</th>
                      <th className="py-3 px-4 font-medium whitespace-nowrap">Type</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Allocated</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Spent</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Remaining</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {allocationsGrouped.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                          {t('noDataFound')}
                        </td>
                      </tr>
                    ) : (
                      allocationsGrouped.flatMap((group) => [
                        ...group.entries.map((entry) => {
                          const entryHead = getHead(entry.economicCode, {
                            headName: entry.headName,
                            headNameBn: entry.headNameBn,
                          });
                          return (
                            <tr key={entry.id}>
                              <td className="sticky left-0 print:static z-10 bg-[var(--card)] py-2.5 px-4 max-w-[220px]">
                                <span className="tabular-nums font-medium">{entry.economicCode}</span>{' '}
                                {entryHead.headName}
                              </td>
                              <td className="py-2.5 px-4 whitespace-nowrap">{entry.memoNo}</td>
                              <td className="py-2.5 px-4 tabular-nums whitespace-nowrap text-[var(--muted)]">
                                {formatDateDisplay(entry.memoDate)}
                              </td>
                              <td className="py-2.5 px-4 capitalize text-xs text-[var(--muted)]">
                                {entry.entryType}
                              </td>
                              <td className="py-2.5 px-4 text-right tabular-nums whitespace-nowrap">
                                {formatNumberIN(entry.allocated)}
                              </td>
                              <td className="py-2.5 px-4 text-right tabular-nums whitespace-nowrap">
                                {formatNumberIN(entry.spent)}
                              </td>
                              <td className="py-2.5 px-4 text-right tabular-nums whitespace-nowrap">
                                {formatNumberIN(entry.remaining)}
                              </td>
                            </tr>
                          );
                        }),
                        group.entries.length > 1 ? (
                          <tr key={`${group.economicCode}_subtotal`} className="bg-[var(--surface-subtle)] font-semibold">
                            <td colSpan={4} className="py-2 px-4 text-xs">
                              Subtotal · {group.economicCode} {group.headName}
                            </td>
                            <td className="py-2 px-4 text-right tabular-nums text-xs">
                              {formatNumberIN(group.allocated)}
                            </td>
                            <td className="py-2 px-4 text-right tabular-nums text-xs">
                              {formatNumberIN(group.spent)}
                            </td>
                            <td className="py-2 px-4 text-right tabular-nums text-xs">
                              {formatNumberIN(group.remaining)}
                            </td>
                          </tr>
                        ) : null,
                      ])
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : tab === 'summary' ? (
            <>
              {/* Mobile Cards (screen only) */}
              <div className="md:hidden print:hidden divide-y divide-[var(--line)]">
                <div className="p-3.5 bg-[var(--surface-subtle)] space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Total ({summaryRows.length} heads)</span>
                    <span className="tabular-nums text-[var(--accent)]">{summaryTotals.usedPct}% used</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="text-[11px] text-[var(--muted)]">Allocated</div>
                      <div className="font-semibold tabular-nums truncate">
                        {formatNumberIN(summaryTotals.allocated)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] text-[var(--muted)]">Spent</div>
                      <div className="font-semibold tabular-nums truncate">
                        {formatNumberIN(summaryTotals.spent)}
                      </div>
                    </div>
                    <div className="min-w-0 text-right">
                      <div className="text-[11px] text-[var(--muted)]">Remaining</div>
                      <div className="font-semibold text-[var(--accent)] tabular-nums truncate">
                        {formatNumberIN(summaryTotals.remaining)}
                      </div>
                    </div>
                  </div>
                </div>

                {summaryRows.length === 0 ? (
                  <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                    {t('noDataFound')}
                  </div>
                ) : (
                  summaryRows.map((r) => (
                    <div key={r.economicCode} className="p-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-[var(--text)] break-words">
                            <span className="tabular-nums font-semibold">{r.economicCode}</span>{' '}
                            {r.headName}
                          </div>
                          {r.headNameBn && (
                            <div className="bn mt-0.5 break-words">{r.headNameBn}</div>
                          )}
                        </div>
                        <span className="text-xs font-semibold tabular-nums text-[var(--accent)] shrink-0">
                          {r.usedPct}%
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs pt-1 border-t border-[var(--line)]/60">
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">Allocated</div>
                          <div className="font-medium tabular-nums truncate">{formatNumberIN(r.allocated)}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">Spent</div>
                          <div className="font-medium tabular-nums truncate">{formatNumberIN(r.spent)}</div>
                        </div>
                        <div className="min-w-0 text-right">
                          <div className="text-[11px] text-[var(--muted)]">Remaining</div>
                          <div className="font-semibold text-[var(--accent)] tabular-nums truncate">
                            {formatNumberIN(r.remaining)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Desktop & Print Table */}
              <div className="hidden md:block print:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                      <th className="sticky left-0 print:static z-10 bg-[var(--card)] py-3 px-4 font-medium">Head</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Allocated</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Spent</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Remaining</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Used</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {summaryRows.map((r) => (
                      <tr key={r.economicCode}>
                        <td className="sticky left-0 print:static z-10 bg-[var(--card)] py-3 px-4 font-medium">
                          <span className="tabular-nums">{r.economicCode}</span> {r.headName}
                          {r.headNameBn && <span className="bn ml-1.5">{r.headNameBn}</span>}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                          {formatNumberIN(r.allocated)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                          {formatNumberIN(r.spent)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                          {formatNumberIN(r.remaining)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                          {r.usedPct}%
                        </td>
                      </tr>
                    ))}
                    <tr className="font-bold bg-[var(--surface-subtle)]">
                      <td className="sticky left-0 print:static z-10 bg-[var(--surface-subtle)] py-3 px-4">Total</td>
                      <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                        {formatNumberIN(summaryTotals.allocated)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                        {formatNumberIN(summaryTotals.spent)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                        {formatNumberIN(summaryTotals.remaining)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                        {summaryTotals.usedPct}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ) : tab === 'headSpending' ? (
            <>
              {/* Mobile Cards (screen only) */}
              <div className="md:hidden print:hidden divide-y divide-[var(--line)]">
                {headWiseTotals.length === 0 ? (
                  <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                    No approved spending in selected period.
                  </div>
                ) : (
                  headWiseTotals.map((h) => (
                    <div key={h.economicCode} className="p-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-medium text-[var(--text)] min-w-0 flex-1 break-words">
                          <span className="tabular-nums font-semibold">{h.economicCode}</span>{' '}
                          {h.headName}
                        </div>
                        <span className="text-xs text-[var(--muted)] tabular-nums shrink-0">
                          {h.count} {h.count === 1 ? 'bill' : 'bills'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs pt-1 border-t border-[var(--line)]/60">
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">Gross</div>
                          <div className="font-medium tabular-nums truncate">{formatNumberIN(h.gross)}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">Deductions</div>
                          <div className="font-medium text-[var(--muted)] tabular-nums truncate">
                            {formatNumberIN(h.deductions)}
                          </div>
                        </div>
                        <div className="min-w-0 text-right">
                          <div className="text-[11px] text-[var(--muted)]">Net Paid</div>
                          <div className="font-semibold text-[var(--accent)] tabular-nums truncate">
                            {formatNumberIN(h.net)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Desktop & Print Table */}
              <div className="hidden md:block print:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                      <th className="sticky left-0 print:static z-10 bg-[var(--card)] py-3 px-4 font-medium">Head</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Approved Bills</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Gross</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Deductions</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Net Paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {headWiseTotals.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                          No approved spending in selected period.
                        </td>
                      </tr>
                    ) : (
                      headWiseTotals.map((h) => (
                        <tr key={h.economicCode}>
                          <td className="sticky left-0 print:static z-10 bg-[var(--card)] py-3 px-4 font-medium">
                            <span className="tabular-nums">{h.economicCode}</span> {h.headName}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums">{h.count}</td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                            {formatNumberIN(h.gross)}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                            {formatNumberIN(h.deductions)}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                            {formatNumberIN(h.net)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              {/* Mobile Cards (screen only) */}
              <div className="md:hidden print:hidden divide-y divide-[var(--line)]">
                <div className="p-3.5 bg-[var(--surface-subtle)] space-y-2">
                  <div className="text-xs font-semibold">Total Deductions ({deductionRows.length} heads)</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="text-[11px] text-[var(--muted)]">Gross</div>
                      <div className="font-semibold tabular-nums truncate">
                        {formatNumberIN(deductionTotals.gross)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] text-[var(--muted)]">VAT</div>
                      <div className="font-semibold tabular-nums truncate">
                        {formatNumberIN(deductionTotals.vat)}
                      </div>
                    </div>
                    <div className="min-w-0 text-right">
                      <div className="text-[11px] text-[var(--muted)]">Income Tax</div>
                      <div className="font-semibold tabular-nums truncate">
                        {formatNumberIN(deductionTotals.it)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] text-[var(--muted)]">Service Chg</div>
                      <div className="font-medium tabular-nums truncate">
                        {formatNumberIN(deductionTotals.serviceCharge)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] text-[var(--muted)]">Others</div>
                      <div className="font-medium tabular-nums truncate">
                        {formatNumberIN(deductionTotals.others)}
                      </div>
                    </div>
                    <div className="min-w-0 text-right">
                      <div className="text-[11px] text-[var(--muted)]">Net Paid</div>
                      <div className="font-bold text-[var(--accent)] tabular-nums truncate">
                        {formatNumberIN(deductionTotals.netPayable)}
                      </div>
                    </div>
                  </div>
                </div>

                {deductionRows.length === 0 ? (
                  <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                    {t('noDataFound')}
                  </div>
                ) : (
                  deductionRows.map((r) => (
                    <div key={r.economicCode} className="p-3.5 space-y-2">
                      <div className="text-sm font-medium text-[var(--text)] break-words">
                        <span className="tabular-nums font-semibold">{r.economicCode}</span>{' '}
                        {r.headName}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs pt-1 border-t border-[var(--line)]/60">
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">Gross</div>
                          <div className="font-medium tabular-nums truncate">{formatNumberIN(r.gross)}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">VAT</div>
                          <div className="font-medium tabular-nums truncate">{formatNumberIN(r.vat)}</div>
                        </div>
                        <div className="min-w-0 text-right">
                          <div className="text-[11px] text-[var(--muted)]">Income Tax</div>
                          <div className="font-medium tabular-nums truncate">{formatNumberIN(r.it)}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">Service Chg</div>
                          <div className="font-medium tabular-nums truncate">
                            {formatNumberIN(r.serviceCharge)}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">Others</div>
                          <div className="font-medium tabular-nums truncate">{formatNumberIN(r.others)}</div>
                        </div>
                        <div className="min-w-0 text-right">
                          <div className="text-[11px] text-[var(--muted)]">Net Paid</div>
                          <div className="font-semibold text-[var(--accent)] tabular-nums truncate">
                            {formatNumberIN(r.netPayable)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Desktop & Print Table */}
              <div className="hidden md:block print:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                      <th className="sticky left-0 print:static z-10 bg-[var(--card)] py-3 px-4 font-medium">Head</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Gross</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">VAT</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Income Tax</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Service Charge</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Others</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Net Paid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {deductionRows.map((r) => (
                      <tr key={r.economicCode}>
                        <td className="sticky left-0 print:static z-10 bg-[var(--card)] py-3 px-4 font-medium">
                          <span className="tabular-nums">{r.economicCode}</span> {r.headName}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums">
                          {formatNumberIN(r.gross)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums">
                          {formatNumberIN(r.vat)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums">
                          {formatNumberIN(r.it)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums">
                          {formatNumberIN(r.serviceCharge)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums">
                          {formatNumberIN(r.others)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums">
                          {formatNumberIN(r.netPayable)}
                        </td>
                      </tr>
                    ))}
                    <tr className="font-bold bg-[var(--surface-subtle)]">
                      <td className="sticky left-0 print:static z-10 bg-[var(--surface-subtle)] py-3 px-4">Total</td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        {formatNumberIN(deductionTotals.gross)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        {formatNumberIN(deductionTotals.vat)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        {formatNumberIN(deductionTotals.it)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        {formatNumberIN(deductionTotals.serviceCharge)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        {formatNumberIN(deductionTotals.others)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        {formatNumberIN(deductionTotals.netPayable)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
