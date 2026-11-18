import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Layout } from '../components/Layout';
import { EconomicCodeSelect } from '../components/EconomicCodeSelect';
import { StatusChip } from '../components/StatusChip';
import { useApp } from '../contexts/AppContext';
import { useFyData } from '../hooks/useFyData';
import { useEconomicCodes } from '../hooks/useEconomicCodes';
import { formatDateDisplay } from '../lib/dates';
import { fromPaisa, formatNumberIN } from '../lib/money';
import { exportReportPdf, type ReportTabKey } from '../utils/exportPdf';
import { saveAndShareFile } from '../utils/saveFile';

export function ReportsPage() {
  const { selectedFy, officeSettings, pushToast, t } = useApp();
  const { budgets, bills, expenseItems, loading } = useFyData(selectedFy);
  const { getHead } = useEconomicCodes();

  const [tab, setTab] = useState<ReportTabKey>('allocations');
  const [selectedCode, setSelectedCode] = useState('');
  const [budgetStatusFilter, setBudgetStatusFilter] = useState<'all' | 'active' | 'executed'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  const filteredBudgets = useMemo(() => {
    return budgets.filter((b) => {
      if (budgetStatusFilter !== 'all' && b.status !== budgetStatusFilter) return false;
      if (selectedCode && b.economicCode !== selectedCode) return false;
      return true;
    });
  }, [budgets, budgetStatusFilter, selectedCode]);

  // 1. FY Allocations grouped by economic code
  const allocationsGrouped = useMemo(() => {
    const map = new Map<
      string,
      {
        economicCode: string;
        headName: string;
        headNameBn: string;
        entries: typeof filteredBudgets;
        allocated: number;
        approvedSpent: number;
        pendingAmount: number;
        available: number;
      }
    >();
    for (const b of filteredBudgets) {
      const head = getHead(b.economicCode, { headName: b.headName, headNameBn: b.headNameBn });
      const pending = Math.max(0, b.pendingAmount || 0);
      const existing = map.get(b.economicCode);
      if (existing) {
        existing.entries.push(b);
        existing.allocated += b.allocated;
        existing.approvedSpent += b.spent;
        existing.pendingAmount += pending;
        existing.available += b.remaining;
      } else {
        map.set(b.economicCode, {
          economicCode: b.economicCode,
          headName: head.headName,
          headNameBn: head.headNameBn,
          entries: [b],
          allocated: b.allocated,
          approvedSpent: b.spent,
          pendingAmount: pending,
          available: b.remaining,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.economicCode.localeCompare(b.economicCode));
  }, [filteredBudgets, getHead]);

  // 2. Budget Summary per head
  const summaryRows = useMemo(() => {
    return allocationsGrouped.map((g) => ({
      economicCode: g.economicCode,
      headName: g.headName,
      headNameBn: g.headNameBn,
      allocated: g.allocated,
      approvedSpent: g.approvedSpent,
      pendingAmount: g.pendingAmount,
      available: g.available,
      usedPct: g.allocated > 0 ? Math.round((g.approvedSpent / g.allocated) * 100) : 0,
    }));
  }, [allocationsGrouped]);

  const summaryTotals = useMemo(() => {
    const allocated = summaryRows.reduce((s, r) => s + r.allocated, 0);
    const approvedSpent = summaryRows.reduce((s, r) => s + r.approvedSpent, 0);
    const pendingAmount = summaryRows.reduce((s, r) => s + r.pendingAmount, 0);
    const available = allocated - approvedSpent - pendingAmount;
    const usedPct = allocated > 0 ? Math.round((approvedSpent / allocated) * 100) : 0;
    return { allocated, approvedSpent, pendingAmount, available, usedPct };
  }, [summaryRows]);

  // 3. Head-wise Approved Bills (optional date range)
  const approvedBills = useMemo(() => {
    return bills.filter((b) => {
      if (b.status !== 'approved') return false;
      if (selectedCode && b.economicCode !== selectedCode) return false;
      if (fromDate && b.date < fromDate) return false;
      if (toDate && b.date > toDate) return false;
      return true;
    });
  }, [bills, selectedCode, fromDate, toDate]);

  const headWiseTotals = useMemo(() => {
    const map = new Map<
      string,
      {
        economicCode: string;
        headName: string;
        headNameBn: string;
        count: number;
        gross: number;
        deductions: number;
        net: number;
      }
    >();
    for (const b of approvedBills) {
      const head = getHead(b.economicCode, { headName: b.headName, headNameBn: b.headNameBn });
      const cur = map.get(b.economicCode);
      if (cur) {
        cur.count += 1;
        cur.gross += b.grossAmount;
        cur.deductions += b.totalDeduction;
        cur.net += b.netPayable;
      } else {
        map.set(b.economicCode, {
          economicCode: b.economicCode,
          headName: head.headName,
          headNameBn: head.headNameBn,
          count: 1,
          gross: b.grossAmount,
          deductions: b.totalDeduction,
          net: b.netPayable,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.economicCode.localeCompare(b.economicCode));
  }, [approvedBills, getHead]);

  // 4. VAT / IT Deductions per head (from approved bills)
  const deductionRows = useMemo(() => {
    const map = new Map<
      string,
      {
        economicCode: string;
        headName: string;
        headNameBn: string;
        gross: number;
        vat: number;
        it: number;
        totalDeduction: number;
        netPayable: number;
      }
    >();
    for (const b of bills.filter(
      (bill) => bill.status === 'approved' && (!selectedCode || bill.economicCode === selectedCode)
    )) {
      const head = getHead(b.economicCode, { headName: b.headName, headNameBn: b.headNameBn });
      const cur = map.get(b.economicCode);
      if (cur) {
        cur.gross += b.grossAmount;
        cur.vat += b.vatAmount;
        cur.it += b.itAmount;
        cur.totalDeduction += b.totalDeduction;
        cur.netPayable += b.netPayable;
      } else {
        map.set(b.economicCode, {
          economicCode: b.economicCode,
          headName: head.headName,
          headNameBn: head.headNameBn,
          gross: b.grossAmount,
          vat: b.vatAmount,
          it: b.itAmount,
          totalDeduction: b.totalDeduction,
          netPayable: b.netPayable,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.economicCode.localeCompare(b.economicCode));
  }, [bills, selectedCode, getHead]);

  const deductionTotals = useMemo(() => {
    return deductionRows.reduce(
      (acc, r) => ({
        gross: acc.gross + r.gross,
        vat: acc.vat + r.vat,
        it: acc.it + r.it,
        totalDeduction: acc.totalDeduction + r.totalDeduction,
        netPayable: acc.netPayable + r.netPayable,
      }),
      { gross: 0, vat: 0, it: 0, totalDeduction: 0, netPayable: 0 }
    );
  }, [deductionRows]);

  // 5. Filtered Expense Items
  const filteredExpenseItems = useMemo(() => {
    return expenseItems.filter((item) => {
      if (selectedCode && item.economicCode !== selectedCode) return false;
      if (fromDate && item.date < fromDate) return false;
      if (toDate && item.date > toDate) return false;
      return true;
    });
  }, [expenseItems, selectedCode, fromDate, toDate]);

  const handleExportPdf = async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      const outcome = await exportReportPdf({
        tab,
        selectedFy,
        officeName: officeSettings.officeName,
        officeAddress: officeSettings.address,
        selectedCode,
        budgetStatusFilter,
        fromDate,
        toDate,
        getHead,
        allocationsGrouped,
        summaryRows,
        summaryTotals,
        headWiseTotals,
        approvedBills,
        deductionRows,
        deductionTotals,
        expenseItems: filteredExpenseItems,
      });
      if (outcome.status === 'shared') {
        pushToast('success', 'PDF ready — choose an app to open or save.');
      } else if (outcome.status === 'downloaded') {
        pushToast('success', 'PDF downloaded.');
      } else {
        pushToast('info', 'PDF export cancelled.');
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'PDF export failed.');
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportExcel = async () => {
    if (exportingExcel) return;
    setExportingExcel(true);
    try {
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
            'Approved Spent (BDT)': fromPaisa(b.spent),
            'Pending (BDT)': fromPaisa(b.pendingAmount || 0),
            'Available (BDT)': fromPaisa(b.remaining),
            Status: b.status,
          };
        });
      } else if (tab === 'summary') {
        sheetName = 'Budget Summary';
        rows = summaryRows.map((r) => ({
          Head: `${r.economicCode} ${r.headName}`,
          'Allocated (BDT)': fromPaisa(r.allocated),
          'Approved Spent (BDT)': fromPaisa(r.approvedSpent),
          'Pending (BDT)': fromPaisa(r.pendingAmount),
          'Available (BDT)': fromPaisa(r.available),
          'Used (%)': `${r.usedPct}%`,
        }));
      } else if (tab === 'headBills') {
        sheetName = 'Approved Bills';
        rows = approvedBills.map((b) => {
          const head = getHead(b.economicCode, { headName: b.headName, headNameBn: b.headNameBn });
          return {
            Date: formatDateDisplay(b.date),
            'Bill No': b.billNo || 'Draft',
            Head: `${b.economicCode} ${head.headName}`,
            'Items Count': b.items.length,
            'Gross (BDT)': fromPaisa(b.grossAmount),
            'VAT (BDT)': fromPaisa(b.vatAmount),
            'Income Tax (BDT)': fromPaisa(b.itAmount),
            'Total Deduction (BDT)': fromPaisa(b.totalDeduction),
            'Net Payable (BDT)': fromPaisa(b.netPayable),
          };
        });
      } else if (tab === 'expenseItems') {
        sheetName = 'Expense Items';
        rows = filteredExpenseItems.map((item) => {
          const head = getHead(item.economicCode, {
            headName: item.headName,
            headNameBn: item.headNameBn,
          });
          return {
            Date: formatDateDisplay(item.date),
            Head: `${item.economicCode} ${head.headName}`,
            Description: item.description,
            'Responsible Employee': item.responsibleEmployee.name,
            Designation: item.responsibleEmployee.designation,
            'Amount (BDT)': fromPaisa(item.amount),
            Status: item.status,
          };
        });
      } else {
        sheetName = 'VAT IT Deductions';
        rows = deductionRows.map((r) => ({
          Head: `${r.economicCode} ${r.headName}`,
          'Gross (BDT)': fromPaisa(r.gross),
          'VAT (BDT)': fromPaisa(r.vat),
          'Income Tax (BDT)': fromPaisa(r.it),
          'Total Deduction (BDT)': fromPaisa(r.totalDeduction),
          'Net Payable (BDT)': fromPaisa(r.netPayable),
        }));
      }

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      const wbArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;

      const outcome = await saveAndShareFile({
        data: new Uint8Array(wbArray),
        fileName: `budget-report-${tab}-FY-${selectedFy}.xlsx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        title: `${sheetName} (FY ${selectedFy})`,
      });

      if (outcome.status === 'shared') {
        pushToast('success', 'Excel file ready — choose an app to open or save.');
      } else if (outcome.status === 'downloaded') {
        pushToast('success', 'Excel file downloaded.');
      } else {
        pushToast('info', 'Excel export cancelled.');
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Excel export failed.');
    } finally {
      setExportingExcel(false);
    }
  };

  const actions = (
    <div className="flex items-center gap-1.5 sm:gap-2">
      <button
        type="button"
        onClick={handleExportPdf}
        disabled={exportingPdf}
        className="min-h-[44px] md:min-h-[40px] px-3 sm:px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text)] whitespace-nowrap disabled:opacity-60"
      >
        {exportingPdf ? 'PDF…' : 'PDF'}
      </button>
      <button
        type="button"
        onClick={handleExportExcel}
        disabled={exportingExcel}
        className="min-h-[44px] md:min-h-[40px] px-3 sm:px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text)] whitespace-nowrap disabled:opacity-60"
      >
        {exportingExcel ? 'Excel…' : 'Excel'}
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
              { id: 'headBills', label: 'Head-wise Bills' },
              { id: 'deductions', label: 'VAT / IT Deductions' },
              { id: 'expenseItems', label: 'খরচ তালিকা' },
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

          {(tab === 'headBills' || tab === 'expenseItems') && (
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
                                {entry.memoNo}{' '}
                                <span className="capitalize font-normal text-[var(--muted)]">
                                  ({entry.entryType})
                                </span>
                              </span>
                              <span className="tabular-nums text-[var(--muted)]">
                                {formatDateDisplay(entry.memoDate)}
                              </span>
                            </div>
                            <div className="grid grid-cols-4 gap-1.5">
                              <div className="min-w-0">
                                <div className="text-[11px] text-[var(--muted)]">Allocated</div>
                                <div className="font-medium tabular-nums truncate">
                                  {formatNumberIN(entry.allocated)}
                                </div>
                              </div>
                              <div className="min-w-0">
                                <div className="text-[11px] text-[var(--muted)]">Approved</div>
                                <div className="font-medium tabular-nums truncate">
                                  {formatNumberIN(entry.spent)}
                                </div>
                              </div>
                              <div className="min-w-0">
                                <div className="text-[11px] text-[var(--muted)]">Pending</div>
                                <div className="font-medium text-[var(--warn-text)] tabular-nums truncate">
                                  {formatNumberIN(entry.pendingAmount || 0)}
                                </div>
                              </div>
                              <div className="min-w-0 text-right">
                                <div className="text-[11px] text-[var(--muted)]">Available</div>
                                <div className="font-semibold text-[var(--accent)] tabular-nums truncate">
                                  {formatNumberIN(entry.remaining)}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      {group.entries.length > 1 && (
                        <div className="grid grid-cols-4 gap-1.5 pt-1.5 text-xs border-t border-[var(--line)] font-semibold">
                          <div className="min-w-0">
                            <div className="text-[11px] text-[var(--muted)] font-normal">Alloc</div>
                            <div className="tabular-nums truncate">
                              {formatNumberIN(group.allocated)}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[11px] text-[var(--muted)] font-normal">Appr</div>
                            <div className="tabular-nums truncate">
                              {formatNumberIN(group.approvedSpent)}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[11px] text-[var(--muted)] font-normal">Pend</div>
                            <div className="tabular-nums truncate">
                              {formatNumberIN(group.pendingAmount)}
                            </div>
                          </div>
                          <div className="min-w-0 text-right">
                            <div className="text-[11px] text-[var(--muted)] font-normal">Avail</div>
                            <div className="tabular-nums text-[var(--accent)] truncate">
                              {formatNumberIN(group.available)}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="hidden md:block print:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                      <th className="sticky left-0 print:static z-10 bg-[var(--card)] py-3 px-4 font-medium">
                        Head
                      </th>
                      <th className="py-3 px-4 font-medium whitespace-nowrap">Memo No</th>
                      <th className="py-3 px-4 font-medium whitespace-nowrap">Date</th>
                      <th className="py-3 px-4 font-medium whitespace-nowrap">Type</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                        Allocated
                      </th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                        Approved
                      </th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                        Pending
                      </th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                        Available
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {allocationsGrouped.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="py-8 px-4 text-center text-sm text-[var(--muted)]"
                        >
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
                                <span className="tabular-nums font-medium">
                                  {entry.economicCode}
                                </span>{' '}
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
                              <td className="py-2.5 px-4 text-right tabular-nums whitespace-nowrap text-[var(--warn-text)]">
                                {formatNumberIN(entry.pendingAmount || 0)}
                              </td>
                              <td className="py-2.5 px-4 text-right tabular-nums whitespace-nowrap font-semibold text-[var(--accent)]">
                                {formatNumberIN(entry.remaining)}
                              </td>
                            </tr>
                          );
                        }),
                        group.entries.length > 1 ? (
                          <tr
                            key={`${group.economicCode}_subtotal`}
                            className="bg-[var(--surface-subtle)] font-semibold"
                          >
                            <td colSpan={4} className="py-2 px-4 text-xs">
                              Subtotal · {group.economicCode} {group.headName}
                            </td>
                            <td className="py-2 px-4 text-right tabular-nums text-xs">
                              {formatNumberIN(group.allocated)}
                            </td>
                            <td className="py-2 px-4 text-right tabular-nums text-xs">
                              {formatNumberIN(group.approvedSpent)}
                            </td>
                            <td className="py-2 px-4 text-right tabular-nums text-xs">
                              {formatNumberIN(group.pendingAmount)}
                            </td>
                            <td className="py-2 px-4 text-right tabular-nums text-xs">
                              {formatNumberIN(group.available)}
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
              <div className="md:hidden print:hidden divide-y divide-[var(--line)]">
                <div className="p-3.5 bg-[var(--surface-subtle)] space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Total ({summaryRows.length} heads)</span>
                    <span className="tabular-nums text-[var(--accent)]">
                      {summaryTotals.usedPct}% used
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 text-xs">
                    <div className="min-w-0">
                      <div className="text-[11px] text-[var(--muted)]">Alloc</div>
                      <div className="font-semibold tabular-nums truncate">
                        {formatNumberIN(summaryTotals.allocated)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] text-[var(--muted)]">Appr</div>
                      <div className="font-semibold tabular-nums truncate">
                        {formatNumberIN(summaryTotals.approvedSpent)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] text-[var(--muted)]">Pend</div>
                      <div className="font-semibold text-[var(--warn-text)] tabular-nums truncate">
                        {formatNumberIN(summaryTotals.pendingAmount)}
                      </div>
                    </div>
                    <div className="min-w-0 text-right">
                      <div className="text-[11px] text-[var(--muted)]">Avail</div>
                      <div className="font-semibold text-[var(--accent)] tabular-nums truncate">
                        {formatNumberIN(summaryTotals.available)}
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
                      <div className="grid grid-cols-4 gap-1.5 text-xs pt-1 border-t border-[var(--line)]/60">
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">Alloc</div>
                          <div className="font-medium tabular-nums truncate">
                            {formatNumberIN(r.allocated)}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">Appr</div>
                          <div className="font-medium tabular-nums truncate">
                            {formatNumberIN(r.approvedSpent)}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">Pend</div>
                          <div className="font-medium text-[var(--warn-text)] tabular-nums truncate">
                            {formatNumberIN(r.pendingAmount)}
                          </div>
                        </div>
                        <div className="min-w-0 text-right">
                          <div className="text-[11px] text-[var(--muted)]">Avail</div>
                          <div className="font-semibold text-[var(--accent)] tabular-nums truncate">
                            {formatNumberIN(r.available)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="hidden md:block print:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                      <th className="sticky left-0 print:static z-10 bg-[var(--card)] py-3 px-4 font-medium">
                        Head
                      </th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                        Allocated
                      </th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                        Approved
                      </th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                        Pending
                      </th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                        Available
                      </th>
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
                          {formatNumberIN(r.approvedSpent)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap text-[var(--warn-text)]">
                          {formatNumberIN(r.pendingAmount)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap font-semibold text-[var(--accent)]">
                          {formatNumberIN(r.available)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                          {r.usedPct}%
                        </td>
                      </tr>
                    ))}
                    <tr className="font-bold bg-[var(--surface-subtle)]">
                      <td className="sticky left-0 print:static z-10 bg-[var(--surface-subtle)] py-3 px-4">
                        Total
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                        {formatNumberIN(summaryTotals.allocated)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                        {formatNumberIN(summaryTotals.approvedSpent)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                        {formatNumberIN(summaryTotals.pendingAmount)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                        {formatNumberIN(summaryTotals.available)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                        {summaryTotals.usedPct}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ) : tab === 'headBills' ? (
            <>
              <div className="md:hidden print:hidden divide-y divide-[var(--line)]">
                {headWiseTotals.length === 0 ? (
                  <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                    No approved bills in selected period.
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
                          <div className="font-medium tabular-nums truncate">
                            {formatNumberIN(h.gross)}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">VAT + IT</div>
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

              <div className="hidden md:block print:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                      <th className="sticky left-0 print:static z-10 bg-[var(--card)] py-3 px-4 font-medium">
                        Head
                      </th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                        Approved Bills
                      </th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Gross</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                        VAT + IT
                      </th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                        Net Paid
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {headWiseTotals.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="py-8 px-4 text-center text-sm text-[var(--muted)]"
                        >
                          No approved bills in selected period.
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
                          <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap font-semibold text-[var(--accent)]">
                            {formatNumberIN(h.net)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : tab === 'expenseItems' ? (
            <>
              <div className="md:hidden print:hidden divide-y divide-[var(--line)]">
                {filteredExpenseItems.length === 0 ? (
                  <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                    {t('noDataFound')}
                  </div>
                ) : (
                  filteredExpenseItems.map((item) => {
                    const head = getHead(item.economicCode, {
                      headName: item.headName,
                      headNameBn: item.headNameBn,
                    });
                    return (
                      <div key={item.id} className="p-3.5 space-y-1.5 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-semibold text-[var(--text)] bn">
                            {item.description}
                          </div>
                          <StatusChip variant={item.status}>{t(item.status)}</StatusChip>
                        </div>
                        <div className="text-[var(--muted)]">
                          <span className="tabular-nums font-medium text-[var(--text)]">
                            {item.economicCode}
                          </span>{' '}
                          {head.headName}
                        </div>
                        <div className="flex justify-between pt-1 border-t border-[var(--line)]/60">
                          <span className="text-[var(--muted)]">
                            {formatDateDisplay(item.date)} · {item.responsibleEmployee.name}
                          </span>
                          <span className="font-bold tabular-nums">
                            {formatNumberIN(item.amount)}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="hidden md:block print:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                      <th className="py-3 px-4 font-medium whitespace-nowrap">Date</th>
                      <th className="py-3 px-4 font-medium">Head</th>
                      <th className="py-3 px-4 font-medium">Description</th>
                      <th className="py-3 px-4 font-medium">Responsible</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Amount</th>
                      <th className="py-3 px-4 font-medium whitespace-nowrap">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {filteredExpenseItems.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="py-8 px-4 text-center text-sm text-[var(--muted)]"
                        >
                          {t('noDataFound')}
                        </td>
                      </tr>
                    ) : (
                      filteredExpenseItems.map((item) => {
                        const head = getHead(item.economicCode, {
                          headName: item.headName,
                          headNameBn: item.headNameBn,
                        });
                        return (
                          <tr key={item.id}>
                            <td className="py-3 px-4 tabular-nums whitespace-nowrap text-[var(--muted)]">
                              {formatDateDisplay(item.date)}
                            </td>
                            <td className="py-3 px-4">
                              <span className="tabular-nums font-medium">{item.economicCode}</span>{' '}
                              {head.headName}
                            </td>
                            <td className="py-3 px-4 bn">{item.description}</td>
                            <td className="py-3 px-4 bn">{item.responsibleEmployee.name}</td>
                            <td className="py-3 px-4 text-right tabular-nums font-semibold">
                              {formatNumberIN(item.amount)}
                            </td>
                            <td className="py-3 px-4">
                              <StatusChip variant={item.status}>{t(item.status)}</StatusChip>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div className="md:hidden print:hidden divide-y divide-[var(--line)]">
                <div className="p-3.5 bg-[var(--surface-subtle)] space-y-2">
                  <div className="text-xs font-semibold">
                    Total Deductions ({deductionRows.length} heads)
                  </div>
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
                      <div className="text-[11px] text-[var(--muted)]">Total Ded.</div>
                      <div className="font-medium tabular-nums truncate">
                        {formatNumberIN(deductionTotals.totalDeduction)}
                      </div>
                    </div>
                    <div className="col-span-2 text-right">
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
                          <div className="font-medium tabular-nums truncate">
                            {formatNumberIN(r.gross)}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">VAT</div>
                          <div className="font-medium tabular-nums truncate">
                            {formatNumberIN(r.vat)}
                          </div>
                        </div>
                        <div className="min-w-0 text-right">
                          <div className="text-[11px] text-[var(--muted)]">Income Tax</div>
                          <div className="font-medium tabular-nums truncate">
                            {formatNumberIN(r.it)}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">Total Ded.</div>
                          <div className="font-medium tabular-nums truncate">
                            {formatNumberIN(r.totalDeduction)}
                          </div>
                        </div>
                        <div className="col-span-2 text-right">
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

              <div className="hidden md:block print:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                      <th className="sticky left-0 print:static z-10 bg-[var(--card)] py-3 px-4 font-medium">
                        Head
                      </th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Gross</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">VAT</th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                        Income Tax
                      </th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                        Total Ded.
                      </th>
                      <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                        Net Paid
                      </th>
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
                          {formatNumberIN(r.totalDeduction)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums font-semibold text-[var(--accent)]">
                          {formatNumberIN(r.netPayable)}
                        </td>
                      </tr>
                    ))}
                    <tr className="font-bold bg-[var(--surface-subtle)]">
                      <td className="sticky left-0 print:static z-10 bg-[var(--surface-subtle)] py-3 px-4">
                        Total
                      </td>
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
                        {formatNumberIN(deductionTotals.totalDeduction)}
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
