import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Layout } from '../components/Layout';
import { useApp } from '../contexts/AppContext';
import { useFyData } from '../hooks/useFyData';
import { formatDateDisplay } from '../lib/dates';
import { fromPaisa, formatNumberIN } from '../lib/money';

type ReportTab = 'allocations' | 'summary' | 'headSpending' | 'deductions';

export function ReportsPage() {
  const { selectedFy, t } = useApp();
  const { budgets, spendings, loading } = useFyData(selectedFy);

  const [tab, setTab] = useState<ReportTab>('allocations');
  const [budgetStatusFilter, setBudgetStatusFilter] = useState<'all' | 'active' | 'executed'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const filteredBudgets = useMemo(() => {
    return budgets.filter((b) => {
      if (budgetStatusFilter !== 'all' && b.status !== budgetStatusFilter) return false;
      return true;
    });
  }, [budgets, budgetStatusFilter]);

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
      const existing = map.get(b.economicCode);
      if (existing) {
        existing.entries.push(b);
        existing.allocated += b.allocated;
        existing.spent += b.spent;
        existing.remaining += b.remaining;
      } else {
        map.set(b.economicCode, {
          economicCode: b.economicCode,
          headName: b.headName,
          headNameBn: b.headNameBn,
          entries: [b],
          allocated: b.allocated,
          spent: b.spent,
          remaining: b.remaining,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.economicCode.localeCompare(b.economicCode));
  }, [filteredBudgets]);

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
      if (fromDate && s.date < fromDate) return false;
      if (toDate && s.date > toDate) return false;
      return true;
    });
  }, [spendings, fromDate, toDate]);

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
          headName: s.headName,
          count: 1,
          gross: s.gross,
          deductions: ded,
          net: s.netPayable,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.economicCode.localeCompare(b.economicCode));
  }, [approvedSpendings]);

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
    for (const s of spendings.filter((sp) => sp.status === 'approved')) {
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
          headName: s.headName,
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
  }, [spendings]);

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
      rows = filteredBudgets.map((b) => ({
        'Economic Code': b.economicCode,
        Head: b.headName,
        'Memo No': b.memoNo,
        'Memo Date': formatDateDisplay(b.memoDate),
        Type: b.entryType,
        'Allocated (BDT)': fromPaisa(b.allocated),
        'Spent (BDT)': fromPaisa(b.spent),
        'Remaining (BDT)': fromPaisa(b.remaining),
        Status: b.status,
      }));
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
      rows = approvedSpendings.map((s) => ({
        Date: formatDateDisplay(s.date),
        Bill: s.billNo,
        Cheque: s.chequeNo || '',
        Payee: s.payee,
        Head: `${s.economicCode} ${s.headName}`,
        'Gross (BDT)': fromPaisa(s.gross),
        'Deductions (BDT)': fromPaisa(s.gross - s.netPayable),
        'Net (BDT)': fromPaisa(s.netPayable),
      }));
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
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleExportPdf}
        className="min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text)] whitespace-nowrap"
      >
        PDF
      </button>
      <button
        type="button"
        onClick={handleExportExcel}
        className="min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text)] whitespace-nowrap"
      >
        Excel
      </button>
    </div>
  );

  return (
    <Layout title={t('navReports')} actions={actions}>
      <div className="space-y-4">
        {/* Report Tabs */}
        <div className="flex items-center gap-1.5 flex-wrap no-print">
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
                className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
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
        <div className="flex items-center gap-2.5 flex-wrap no-print">
          <span className="px-3 py-1 rounded-full text-xs border border-[var(--line)] text-[var(--muted)] tabular-nums">
            FY {selectedFy}
          </span>

          {(tab === 'allocations' || tab === 'summary') && (
            <select
              value={budgetStatusFilter}
              onChange={(e) =>
                setBudgetStatusFilter(e.target.value as 'all' | 'active' | 'executed')
              }
              aria-label="Filter budget status"
              className="min-h-[34px] px-3 rounded-full text-xs border border-[var(--line)] bg-[var(--card)] text-[var(--text)]"
            >
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="executed">Executed only</option>
            </select>
          )}

          {tab === 'headSpending' && (
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs text-[var(--muted)]">From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="min-h-[34px] px-2.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs tabular-nums"
              />
              <label className="text-xs text-[var(--muted)]">To</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="min-h-[34px] px-2.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs tabular-nums"
              />
            </div>
          )}
        </div>

        {/* Report Tables */}
        <div className="card-surface overflow-hidden">
          {loading ? (
            <p className="p-6 text-sm text-[var(--muted)]">Loading report data…</p>
          ) : tab === 'allocations' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                    <th className="py-3 px-4 font-medium">Head</th>
                    <th className="py-3 px-4 font-medium">Memo No</th>
                    <th className="py-3 px-4 font-medium">Date</th>
                    <th className="py-3 px-4 font-medium">Type</th>
                    <th className="py-3 px-4 font-medium text-right">Allocated</th>
                    <th className="py-3 px-4 font-medium text-right">Spent</th>
                    <th className="py-3 px-4 font-medium text-right">Remaining</th>
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
                      ...group.entries.map((entry) => (
                        <tr key={entry.id}>
                          <td className="py-2.5 px-4">
                            <span className="tabular-nums font-medium">{entry.economicCode}</span>{' '}
                            {entry.headName}
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
                      )),
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
          ) : tab === 'summary' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                    <th className="py-3 px-4 font-medium">Head</th>
                    <th className="py-3 px-4 font-medium text-right">Allocated</th>
                    <th className="py-3 px-4 font-medium text-right">Spent</th>
                    <th className="py-3 px-4 font-medium text-right">Remaining</th>
                    <th className="py-3 px-4 font-medium text-right">Used</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {summaryRows.map((r) => (
                    <tr key={r.economicCode}>
                      <td className="py-3 px-4 font-medium">
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
                    <td className="py-3 px-4">Total</td>
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
          ) : tab === 'headSpending' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                    <th className="py-3 px-4 font-medium">Head</th>
                    <th className="py-3 px-4 font-medium text-right">Approved Bills</th>
                    <th className="py-3 px-4 font-medium text-right">Gross</th>
                    <th className="py-3 px-4 font-medium text-right">Deductions</th>
                    <th className="py-3 px-4 font-medium text-right">Net Paid</th>
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
                        <td className="py-3 px-4 font-medium">
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
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                    <th className="py-3 px-4 font-medium">Head</th>
                    <th className="py-3 px-4 font-medium text-right">Gross</th>
                    <th className="py-3 px-4 font-medium text-right">VAT</th>
                    <th className="py-3 px-4 font-medium text-right">Income Tax</th>
                    <th className="py-3 px-4 font-medium text-right">Service Charge</th>
                    <th className="py-3 px-4 font-medium text-right">Others</th>
                    <th className="py-3 px-4 font-medium text-right">Net Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {deductionRows.map((r) => (
                    <tr key={r.economicCode}>
                      <td className="py-3 px-4 font-medium">
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
                    <td className="py-3 px-4">Total</td>
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
          )}
        </div>
      </div>
    </Layout>
  );
}
