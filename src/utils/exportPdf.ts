import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import { formatActorBrief, formatApprovedByLine } from '../lib/actor';
import { formatDateDisplay } from '../lib/dates';
import { formatNumberIN } from '../lib/money';
import type { BillDoc, BudgetDoc, ExpenseItemDoc, OfficeDoc } from '../types';
import { saveAndShareFile, type SaveAndShareOutcome } from './saveFile';

export type ReportTabKey =
  | 'officesOverview'
  | 'allocations'
  | 'summary'
  | 'headBills'
  | 'deductions'
  | 'expenseItems';

export interface OfficesOverviewRowPdf {
  officeId: string;
  officeName: string;
  officeCode: string;
  allocated: number;
  approvedSpent: number;
  pendingAmount: number;
  available: number;
  usedPct: number;
}

export interface AllocationGroupPdf {
  economicCode: string;
  headName: string;
  headNameBn: string;
  entries: BudgetDoc[];
  allocated: number;
  approvedSpent: number;
  pendingAmount: number;
  available: number;
}

export interface SummaryRowPdf {
  economicCode: string;
  headName: string;
  headNameBn: string;
  allocated: number;
  approvedSpent: number;
  pendingAmount: number;
  available: number;
  usedPct: number;
}

export interface HeadBillRowPdf {
  economicCode: string;
  headName: string;
  headNameBn?: string;
  count: number;
  gross: number;
  deductions: number;
  net: number;
}

export interface DeductionRowPdf {
  economicCode: string;
  headName: string;
  headNameBn?: string;
  gross: number;
  vat: number;
  it: number;
  totalDeduction: number;
  netPayable: number;
}

export interface ExportReportPdfPayload {
  tab: ReportTabKey;
  selectedFy: string;
  officeName: string;
  officeAddress?: string;
  officesById?: Map<string, OfficeDoc>;
  officesOverviewRows?: OfficesOverviewRowPdf[];
  officesOverviewTotals?: {
    allocated: number;
    approvedSpent: number;
    pendingAmount: number;
    available: number;
    usedPct: number;
  };
  selectedCode?: string;
  budgetStatusFilter?: 'all' | 'active' | 'executed';
  fromDate?: string;
  toDate?: string;
  getHead: (
    code: string,
    fallback?: { headName?: string; headNameBn?: string }
  ) => { headName: string; headNameBn: string };
  allocationsGrouped: AllocationGroupPdf[];
  summaryRows: SummaryRowPdf[];
  summaryTotals: {
    allocated: number;
    approvedSpent: number;
    pendingAmount: number;
    available: number;
    usedPct: number;
  };
  headWiseTotals: HeadBillRowPdf[];
  approvedBills?: BillDoc[];
  deductionRows: DeductionRowPdf[];
  deductionTotals: {
    gross: number;
    vat: number;
    it: number;
    totalDeduction: number;
    netPayable: number;
  };
  expenseItems?: ExpenseItemDoc[];
}

let fontsLoadedPromise: Promise<void> | null = null;

function resolveAssetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '');
  try {
    return new URL(clean, document.baseURI || window.location.href).href;
  } catch {
    return `/${clean}`;
  }
}

export async function ensureBengaliFontsLoaded(): Promise<void> {
  if (!fontsLoadedPromise) {
    fontsLoadedPromise = (async () => {
      try {
        if ('fonts' in document) {
          const toLoad: Array<{ family: string; file: string; weight: string }> = [
            { family: 'NikoshBAN', file: 'fonts/NikoshBAN.ttf', weight: '400' },
            { family: 'NikoshBAN', file: 'fonts/NikoshBAN.ttf', weight: '700' },
            { family: 'Nikosh', file: 'fonts/Nikosh.ttf', weight: '400' },
            { family: 'Nikosh', file: 'fonts/Nikosh.ttf', weight: '700' },
            { family: 'Noto Sans Bengali', file: 'fonts/NotoSansBengali-Regular.ttf', weight: '400' },
            { family: 'Noto Sans Bengali', file: 'fonts/NotoSansBengali-Bold.ttf', weight: '700' },
          ];
          await Promise.allSettled(
            toLoad.map(async (spec) => {
              const font = new FontFace(spec.family, `url("${resolveAssetUrl(spec.file)}")`, {
                weight: spec.weight,
                style: 'normal',
              });
              const loaded = await font.load();
              document.fonts.add(loaded);
            })
          );
          await document.fonts.ready;
        }
      } catch {
        // Non-fatal fallback
      }
    })();
  }
  await fontsLoadedPromise;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTabTitle(tab: ReportTabKey): string {
  switch (tab) {
    case 'officesOverview':
      return 'All Offices Budget Overview';
    case 'allocations':
      return 'FY Allocations Report';
    case 'summary':
      return 'Budget Summary Report';
    case 'headBills':
      return 'Head-wise Approved Bills Report';
    case 'deductions':
      return 'VAT & Income Tax Deductions Report';
    case 'expenseItems':
      return 'Expense Items Report (খরচ তালিকা)';
  }
}

interface TableColumn {
  label: string;
  align?: 'left' | 'right';
  width?: string;
}

interface BuiltReportTable {
  columns: TableColumn[];
  rowsHtml: string[];
}

function tdStyle(align: 'left' | 'right' = 'left', extra = ''): string {
  return `padding: 7px 10px; border-bottom: 1px solid #DDE5E1; text-align: ${align}; vertical-align: top; color: #14201D; font-size: 12px; line-height: 1.5; ${extra}`;
}

function buildHeadCell(code: string, nameEn: string, nameBn?: string): string {
  const displayHead = nameBn || nameEn;
  return `<div style="font-weight: 600; color: #14201D; word-break: break-word;"><span style="font-variant-numeric: tabular-nums;">${esc(code)}</span> <span style="font-family: 'Nikosh', 'Noto Sans Bengali', sans-serif;">${esc(displayHead)}</span></div>`;
}

function buildReportTable(payload: ExportReportPdfPayload): BuiltReportTable {
  const { tab } = payload;

  if (tab === 'officesOverview') {
    const columns: TableColumn[] = [
      { label: 'Office', align: 'left', width: '28%' },
      { label: 'Code', align: 'left', width: '10%' },
      { label: 'Allocated (৳)', align: 'right', width: '14%' },
      { label: 'Approved (৳)', align: 'right', width: '14%' },
      { label: 'Pending (৳)', align: 'right', width: '13%' },
      { label: 'Available (৳)', align: 'right', width: '14%' },
      { label: 'Used', align: 'right', width: '7%' },
    ];
    const rows = payload.officesOverviewRows || [];
    const rowsHtml = rows.map(
      (r) => `<tr>
        <td style="${tdStyle('left', "font-weight: 600; font-family: 'Nikosh', 'Noto Sans Bengali', sans-serif;")}">${esc(r.officeName)}</td>
        <td style="${tdStyle('left', 'white-space: nowrap; color: #55655F; font-variant-numeric: tabular-nums;')}">${esc(r.officeCode)}</td>
        <td style="${tdStyle('right', 'white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(r.allocated))}</td>
        <td style="${tdStyle('right', 'white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(r.approvedSpent))}</td>
        <td style="${tdStyle('right', 'white-space: nowrap; color: #92400E; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(r.pendingAmount))}</td>
        <td style="${tdStyle('right', 'white-space: nowrap; font-weight: 600; color: #0F766E; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(r.available))}</td>
        <td style="${tdStyle('right', 'white-space: nowrap; font-variant-numeric: tabular-nums;')}">${r.usedPct}%</td>
      </tr>`
    );

    if (rowsHtml.length === 0) {
      rowsHtml.push(
        `<tr><td colspan="7" style="${tdStyle('left', 'text-align: center; padding: 24px; color: #55655F;')}">No office totals available for FY ${esc(payload.selectedFy)}.</td></tr>`
      );
    } else if (payload.officesOverviewTotals) {
      const tot = payload.officesOverviewTotals;
      rowsHtml.push(
        `<tr style="background-color: #EDF2EF;">
          <td colspan="2" style="${tdStyle('left', 'font-weight: 700;')}">Grand Total (${rows.length} offices)</td>
          <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(tot.allocated))}</td>
          <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(tot.approvedSpent))}</td>
          <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(tot.pendingAmount))}</td>
          <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(tot.available))}</td>
          <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${tot.usedPct}%</td>
        </tr>`
      );
    }

    return { columns, rowsHtml };
  }

  if (tab === 'allocations') {
    const columns: TableColumn[] = [
      { label: 'ব্যয়ের খাত', align: 'left', width: '24%' },
      { label: 'Memo No', align: 'left', width: '12%' },
      { label: 'Date', align: 'left', width: '9%' },
      { label: 'Type', align: 'left', width: '7%' },
      { label: 'Responsible', align: 'left', width: '14%' },
      { label: 'Allocated (৳)', align: 'right', width: '8.5%' },
      { label: 'Approved (৳)', align: 'right', width: '8.5%' },
      { label: 'Pending (৳)', align: 'right', width: '8.5%' },
      { label: 'Available (৳)', align: 'right', width: '8.5%' },
    ];

    const rowsHtml: string[] = [];
    for (const group of payload.allocationsGrouped) {
      for (const entry of group.entries) {
        const head = payload.getHead(entry.economicCode, {
          headName: entry.headName,
          headNameBn: entry.headNameBn,
        });
        const pending = Math.max(0, entry.pendingAmount || 0);
        const actorStr = formatActorBrief(entry.createdBy, payload.officesById);
        rowsHtml.push(
          `<tr>
            <td style="${tdStyle('left')}">${buildHeadCell(entry.economicCode, head.headName, head.headNameBn)}</td>
            <td style="${tdStyle('left', 'white-space: nowrap;')}">${esc(entry.memoNo)}</td>
            <td style="${tdStyle('left', 'white-space: nowrap; color: #55655F; font-variant-numeric: tabular-nums;')}">${esc(formatDateDisplay(entry.memoDate))}</td>
            <td style="${tdStyle('left', 'text-transform: capitalize; color: #55655F;')}">${esc(entry.entryType)}</td>
            <td style="${tdStyle('left', "font-size: 11px; color: #34433E; font-family: 'Nikosh', 'Noto Sans Bengali', sans-serif;")}">${esc(actorStr)}</td>
            <td style="${tdStyle('right', 'white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(entry.allocated))}</td>
            <td style="${tdStyle('right', 'white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(entry.spent))}</td>
            <td style="${tdStyle('right', 'white-space: nowrap; color: #92400E; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(pending))}</td>
            <td style="${tdStyle('right', 'white-space: nowrap; font-weight: 600; color: #0F766E; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(entry.remaining))}</td>
          </tr>`
        );
      }

      if (group.entries.length > 1) {
        rowsHtml.push(
          `<tr style="background-color: #EDF2EF;">
            <td colspan="5" style="${tdStyle('left', 'font-weight: 700; font-size: 11.5px;')}">Subtotal · ${esc(group.economicCode)} ${esc(group.headNameBn || group.headName)}</td>
            <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(group.allocated))}</td>
            <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(group.approvedSpent))}</td>
            <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(group.pendingAmount))}</td>
            <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(group.available))}</td>
          </tr>`
        );
      }
    }

    if (rowsHtml.length === 0) {
      rowsHtml.push(
        `<tr><td colspan="9" style="${tdStyle('left', 'text-align: center; padding: 24px; color: #55655F;')}">No records match your current filter.</td></tr>`
      );
    }

    return { columns, rowsHtml };
  }

  if (tab === 'summary') {
    const columns: TableColumn[] = [
      { label: 'ব্যয়ের খাত', align: 'left', width: '38%' },
      { label: 'Allocated (৳)', align: 'right', width: '14%' },
      { label: 'Approved (৳)', align: 'right', width: '14%' },
      { label: 'Pending (৳)', align: 'right', width: '13%' },
      { label: 'Available (৳)', align: 'right', width: '14%' },
      { label: 'Used', align: 'right', width: '7%' },
    ];

    const rowsHtml = payload.summaryRows.map(
      (r) =>
        `<tr>
          <td style="${tdStyle('left')}">${buildHeadCell(r.economicCode, r.headName, r.headNameBn)}</td>
          <td style="${tdStyle('right', 'white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(r.allocated))}</td>
          <td style="${tdStyle('right', 'white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(r.approvedSpent))}</td>
          <td style="${tdStyle('right', 'white-space: nowrap; color: #92400E; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(r.pendingAmount))}</td>
          <td style="${tdStyle('right', 'white-space: nowrap; font-weight: 600; color: #0F766E; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(r.available))}</td>
          <td style="${tdStyle('right', 'white-space: nowrap; font-variant-numeric: tabular-nums;')}">${r.usedPct}%</td>
        </tr>`
    );

    rowsHtml.push(
      `<tr style="background-color: #EDF2EF;">
        <td style="${tdStyle('left', 'font-weight: 700;')}">Total</td>
        <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(payload.summaryTotals.allocated))}</td>
        <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(payload.summaryTotals.approvedSpent))}</td>
        <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(payload.summaryTotals.pendingAmount))}</td>
        <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(payload.summaryTotals.available))}</td>
        <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${payload.summaryTotals.usedPct}%</td>
      </tr>`
    );

    return { columns, rowsHtml };
  }

  if (tab === 'headBills') {
    const columns: TableColumn[] = [
      { label: 'ব্যয়ের খাত', align: 'left', width: '46%' },
      { label: 'Approved Bills', align: 'right', width: '12%' },
      { label: 'Gross (৳)', align: 'right', width: '14%' },
      { label: 'VAT + IT (৳)', align: 'right', width: '14%' },
      { label: 'Net Paid (৳)', align: 'right', width: '14%' },
    ];

    const rowsHtml = payload.headWiseTotals.map((h) => {
      const resolved = payload.getHead(h.economicCode, {
        headName: h.headName,
        headNameBn: h.headNameBn,
      });
      return `<tr>
        <td style="${tdStyle('left')}">${buildHeadCell(h.economicCode, resolved.headName, resolved.headNameBn)}</td>
        <td style="${tdStyle('right', 'font-variant-numeric: tabular-nums;')}">${h.count}</td>
        <td style="${tdStyle('right', 'white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(h.gross))}</td>
        <td style="${tdStyle('right', 'white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(h.deductions))}</td>
        <td style="${tdStyle('right', 'white-space: nowrap; font-weight: 600; color: #0F766E; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(h.net))}</td>
      </tr>`;
    });

    if (rowsHtml.length === 0) {
      rowsHtml.push(
        `<tr><td colspan="5" style="${tdStyle('left', 'text-align: center; padding: 24px; color: #55655F;')}">No approved bills in selected period.</td></tr>`
      );
    }

    return { columns, rowsHtml };
  }

  if (tab === 'expenseItems') {
    const items = payload.expenseItems || [];
    const columns: TableColumn[] = [
      { label: 'Date', align: 'left', width: '11%' },
      { label: 'ব্যয়ের খাত', align: 'left', width: '28%' },
      { label: 'Description', align: 'left', width: '25%' },
      { label: 'Responsible', align: 'left', width: '16%' },
      { label: 'Amount (৳)', align: 'right', width: '11%' },
      { label: 'Status', align: 'left', width: '9%' },
    ];

    const rowsHtml = items.map((item) => {
      const resolved = payload.getHead(item.economicCode, {
        headName: item.headName,
        headNameBn: item.headNameBn,
      });
      const resp = item.responsibleEmployee.designation
        ? `${item.responsibleEmployee.name} (${item.responsibleEmployee.designation})`
        : item.responsibleEmployee.name;
      return `<tr>
        <td style="${tdStyle('left', 'white-space: nowrap; color: #55655F; font-variant-numeric: tabular-nums;')}">${esc(formatDateDisplay(item.date))}</td>
        <td style="${tdStyle('left')}">${buildHeadCell(item.economicCode, resolved.headName, resolved.headNameBn)}</td>
        <td style="${tdStyle('left', "font-family: 'Nikosh', 'Noto Sans Bengali', sans-serif;")}">${esc(item.description)}</td>
        <td style="${tdStyle('left', "font-family: 'Nikosh', 'Noto Sans Bengali', sans-serif;")}">${esc(resp)}</td>
        <td style="${tdStyle('right', 'white-space: nowrap; font-weight: 600; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(item.amount))}</td>
        <td style="${tdStyle('left', 'text-transform: capitalize;')}">${esc(item.status)}</td>
      </tr>`;
    });

    if (rowsHtml.length === 0) {
      rowsHtml.push(
        `<tr><td colspan="6" style="${tdStyle('left', 'text-align: center; padding: 24px; color: #55655F;')}">No expense items match your filter.</td></tr>`
      );
    } else {
      const totalAmt = items.reduce((s, i) => s + i.amount, 0);
      rowsHtml.push(
        `<tr style="background-color: #EDF2EF;">
          <td colspan="4" style="${tdStyle('left', 'font-weight: 700;')}">Total (${items.length} items)</td>
          <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(totalAmt))}</td>
          <td style="${tdStyle('left')}"></td>
        </tr>`
      );
    }

    return { columns, rowsHtml };
  }

  // deductions
  const columns: TableColumn[] = [
    { label: 'ব্যয়ের খাত', align: 'left', width: '36%' },
    { label: 'Gross (৳)', align: 'right', width: '13%' },
    { label: 'VAT (৳)', align: 'right', width: '12%' },
    { label: 'Income Tax (৳)', align: 'right', width: '13%' },
    { label: 'Total Ded. (৳)', align: 'right', width: '13%' },
    { label: 'Net Paid (৳)', align: 'right', width: '13%' },
  ];

  const rowsHtml = payload.deductionRows.map((r) => {
    const resolved = payload.getHead(r.economicCode, {
      headName: r.headName,
      headNameBn: r.headNameBn,
    });
    return `<tr>
      <td style="${tdStyle('left')}">${buildHeadCell(r.economicCode, resolved.headName, resolved.headNameBn)}</td>
      <td style="${tdStyle('right', 'white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(r.gross))}</td>
      <td style="${tdStyle('right', 'white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(r.vat))}</td>
      <td style="${tdStyle('right', 'white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(r.it))}</td>
      <td style="${tdStyle('right', 'white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(r.totalDeduction))}</td>
      <td style="${tdStyle('right', 'white-space: nowrap; font-weight: 600; color: #0F766E; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(r.netPayable))}</td>
    </tr>`;
  });

  rowsHtml.push(
    `<tr style="background-color: #EDF2EF;">
      <td style="${tdStyle('left', 'font-weight: 700;')}">Total</td>
      <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(payload.deductionTotals.gross))}</td>
      <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(payload.deductionTotals.vat))}</td>
      <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(payload.deductionTotals.it))}</td>
      <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(payload.deductionTotals.totalDeduction))}</td>
      <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(payload.deductionTotals.netPayable))}</td>
    </tr>`
  );

  return { columns, rowsHtml };
}

function buildFilterSummary(payload: ExportReportPdfPayload): string {
  const parts: string[] = [`FY ${payload.selectedFy}`];
  if (
    (payload.tab === 'allocations' || payload.tab === 'summary') &&
    payload.budgetStatusFilter &&
    payload.budgetStatusFilter !== 'all'
  ) {
    parts.push(`Status: ${payload.budgetStatusFilter}`);
  }
  if (payload.selectedCode) {
    const h = payload.getHead(payload.selectedCode);
    const label = h.headNameBn || h.headName;
    parts.push(`Code: ${payload.selectedCode}${label ? ` (${label})` : ''}`);
  }
  if ((payload.tab === 'headBills' || payload.tab === 'expenseItems') && (payload.fromDate || payload.toDate)) {
    const from = payload.fromDate ? formatDateDisplay(payload.fromDate) : '…';
    const to = payload.toDate ? formatDateDisplay(payload.toDate) : '…';
    parts.push(`Period: ${from} – ${to}`);
  }
  return parts.join('  •  ');
}

function buildTheadHtml(columns: TableColumn[]): string {
  const cells = columns
    .map(
      (col) =>
        `<th style="padding: 8px 10px; text-align: ${col.align || 'left'}; font-size: 11px; font-weight: 700; color: #55655F; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 2px solid #0F766E; background-color: #F3F6F4; ${col.width ? `width: ${col.width};` : ''}">${esc(col.label)}</th>`
    )
    .join('');
  return `<thead><tr>${cells}</tr></thead>`;
}

function buildPageHeaderHtml(
  officeName: string,
  officeAddress: string | undefined,
  title: string,
  filters: string,
  selectedFy: string,
  pageNumber: number,
  totalPages: number,
  generatedLabel: string
): string {
  if (pageNumber === 1) {
    return `
      <div style="border-bottom: 2px solid #0F766E; padding-bottom: 10px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px;">
        <div>
          <div style="font-size: 17px; font-weight: 700; color: #14201D; line-height: 1.3;">${esc(officeName || 'Government Office')}</div>
          ${officeAddress ? `<div style="font-size: 11.5px; color: #55655F; margin-top: 2px;">${esc(officeAddress)}</div>` : ''}
          <div style="font-size: 13.5px; font-weight: 700; color: #0F766E; margin-top: 6px;">${esc(title)}</div>
          <div style="font-size: 11px; color: #55655F; margin-top: 2px;">${esc(filters)}</div>
        </div>
        <div style="text-align: right; font-size: 11px; color: #55655F; white-space: nowrap;">
          <div>Generated: ${esc(generatedLabel)}</div>
          <div style="margin-top: 2px;">Page ${pageNumber} of ${totalPages}</div>
        </div>
      </div>
    `;
  }

  return `
    <div style="border-bottom: 1px solid #DDE5E1; padding-bottom: 6px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #55655F;">
      <div><strong style="color: #14201D;">${esc(officeName || 'Budget Tracker')}</strong> · ${esc(title)} · FY ${esc(selectedFy)}</div>
      <div>Page ${pageNumber} of ${totalPages}</div>
    </div>
  `;
}

function paginateRowsByMeasuredHeight(
  columns: TableColumn[],
  rowsHtml: string[],
  pageWidthPx: number,
  firstPageMaxBodyPx: number,
  nextPageMaxBodyPx: number
): string[][] {
  if (rowsHtml.length === 0) return [[]];

  const measurer = document.createElement('div');
  measurer.style.cssText = [
    'position: fixed',
    'left: -10000px',
    'top: 0',
    `width: ${pageWidthPx}px`,
    'background: #FFFFFF',
    "font-family: 'Nikosh', 'Noto Sans Bengali', Inter, sans-serif",
    'visibility: hidden',
    'pointer-events: none',
  ].join(';');

  measurer.innerHTML = `<table style="width: 100%; border-collapse: collapse; table-layout: fixed;">${buildTheadHtml(columns)}<tbody>${rowsHtml.join('')}</tbody></table>`;
  document.body.appendChild(measurer);

  try {
    const trNodes = Array.from(measurer.querySelectorAll('tbody > tr'));
    const pages: string[][] = [];
    let currentBucket: string[] = [];
    let currentHeight = 0;

    trNodes.forEach((tr, idx) => {
      const rowHeight = Math.max(24, tr.getBoundingClientRect().height);
      const maxHeight = pages.length === 0 ? firstPageMaxBodyPx : nextPageMaxBodyPx;

      if (currentBucket.length > 0 && currentHeight + rowHeight > maxHeight) {
        pages.push(currentBucket);
        currentBucket = [rowsHtml[idx]];
        currentHeight = rowHeight;
      } else {
        currentBucket.push(rowsHtml[idx]);
        currentHeight += rowHeight;
      }
    });

    if (currentBucket.length > 0) {
      pages.push(currentBucket);
    }

    return pages;
  } finally {
    document.body.removeChild(measurer);
  }
}

async function renderPaginatedLandscapePdf(params: {
  officeName: string;
  officeAddress?: string;
  title: string;
  filters: string;
  selectedFy: string;
  columns: TableColumn[];
  rowsHtml: string[];
  fileName: string;
}): Promise<SaveAndShareOutcome> {
  await ensureBengaliFontsLoaded();

  const PAGE_WIDTH_PX = 1040;
  const FIRST_PAGE_BODY_MAX_PX = 530;
  const NEXT_PAGE_BODY_MAX_PX = 600;

  const pageBuckets = paginateRowsByMeasuredHeight(
    params.columns,
    params.rowsHtml,
    PAGE_WIDTH_PX,
    FIRST_PAGE_BODY_MAX_PX,
    NEXT_PAGE_BODY_MAX_PX
  );

  const now = new Date();
  const generatedLabel = `${String(now.getDate()).padStart(2, '0')}/${String(
    now.getMonth() + 1
  ).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes()
  ).padStart(2, '0')}`;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pageWidthMm = doc.internal.pageSize.getWidth();
  const pageHeightMm = doc.internal.pageSize.getHeight();
  const marginMm = 10;
  const printableWidthMm = pageWidthMm - marginMm * 2;
  const printableHeightMm = pageHeightMm - marginMm * 2;

  const renderHost = document.createElement('div');
  renderHost.style.cssText = [
    'position: fixed',
    'left: -10000px',
    'top: 0',
    `width: ${PAGE_WIDTH_PX}px`,
    'padding: 16px 20px',
    'background: #FFFFFF',
    'color: #14201D',
    "font-family: 'Nikosh', 'Noto Sans Bengali', Inter, sans-serif",
    'box-sizing: border-box',
  ].join(';');
  document.body.appendChild(renderHost);

  try {
    const theadHtml = buildTheadHtml(params.columns);

    for (let i = 0; i < pageBuckets.length; i++) {
      if (i > 0) {
        doc.addPage('a4', 'landscape');
      }

      renderHost.innerHTML = `
        ${buildPageHeaderHtml(
          params.officeName,
          params.officeAddress,
          params.title,
          params.filters,
          params.selectedFy,
          i + 1,
          pageBuckets.length,
          generatedLabel
        )}
        <table style="width: 100%; border-collapse: collapse; table-layout: fixed;">
          ${theadHtml}
          <tbody>${pageBuckets[i].join('')}</tbody>
        </table>
      `;

      const canvas = await html2canvas(renderHost, {
        scale: 2,
        backgroundColor: '#FFFFFF',
        useCORS: true,
        logging: false,
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.94);
      const naturalHeightMm = (canvas.height * printableWidthMm) / canvas.width;
      const drawHeightMm = Math.min(naturalHeightMm, printableHeightMm);
      const drawWidthMm =
        naturalHeightMm > printableHeightMm
          ? (canvas.width * printableHeightMm) / canvas.height
          : printableWidthMm;

      doc.addImage(imgData, 'JPEG', marginMm, marginMm, drawWidthMm, drawHeightMm, undefined, 'FAST');

      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    document.body.removeChild(renderHost);
  }

  const pdfBuffer = doc.output('arraybuffer');
  return saveAndShareFile({
    data: new Uint8Array(pdfBuffer),
    fileName: params.fileName,
    mimeType: 'application/pdf',
    title: `${params.title} (FY ${params.selectedFy})`,
  });
}

export async function exportReportPdf(
  payload: ExportReportPdfPayload
): Promise<SaveAndShareOutcome> {
  const { columns, rowsHtml } = buildReportTable(payload);
  return renderPaginatedLandscapePdf({
    officeName: payload.officeName,
    officeAddress: payload.officeAddress,
    title: getTabTitle(payload.tab),
    filters: buildFilterSummary(payload),
    selectedFy: payload.selectedFy,
    columns,
    rowsHtml,
    fileName: `budget-report-${payload.tab}-FY-${payload.selectedFy}.pdf`,
  });
}

export async function exportExpenseItemsPdf(params: {
  items: ExpenseItemDoc[];
  selectedFy: string;
  officeName: string;
  officeAddress?: string;
  selectedCode?: string;
  statusFilter?: string;
  getHead: (
    code: string,
    fallback?: { headName?: string; headNameBn?: string }
  ) => { headName: string; headNameBn: string };
}): Promise<SaveAndShareOutcome> {
  const columns: TableColumn[] = [
    { label: 'Date', align: 'left', width: '11%' },
    { label: 'ব্যয়ের খাত', align: 'left', width: '28%' },
    { label: 'Description', align: 'left', width: '25%' },
    { label: 'Responsible', align: 'left', width: '16%' },
    { label: 'Amount (৳)', align: 'right', width: '11%' },
    { label: 'Status', align: 'left', width: '9%' },
  ];

  const rowsHtml = params.items.map((item) => {
    const resolved = params.getHead(item.economicCode, {
      headName: item.headName,
      headNameBn: item.headNameBn,
    });
    const resp = item.responsibleEmployee.designation
      ? `${item.responsibleEmployee.name} (${item.responsibleEmployee.designation})`
      : item.responsibleEmployee.name;
    return `<tr>
      <td style="${tdStyle('left', 'white-space: nowrap; color: #55655F; font-variant-numeric: tabular-nums;')}">${esc(formatDateDisplay(item.date))}</td>
      <td style="${tdStyle('left')}">${buildHeadCell(item.economicCode, resolved.headName, resolved.headNameBn)}</td>
      <td style="${tdStyle('left', "font-family: 'Nikosh', 'Noto Sans Bengali', sans-serif;")}">${esc(item.description)}</td>
      <td style="${tdStyle('left', "font-family: 'Nikosh', 'Noto Sans Bengali', sans-serif;")}">${esc(resp)}</td>
      <td style="${tdStyle('right', 'white-space: nowrap; font-weight: 600; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(item.amount))}</td>
      <td style="${tdStyle('left', 'text-transform: capitalize;')}">${esc(item.status)}</td>
    </tr>`;
  });

  if (rowsHtml.length === 0) {
    rowsHtml.push(
      `<tr><td colspan="6" style="${tdStyle('left', 'text-align: center; padding: 24px; color: #55655F;')}">No expense items found.</td></tr>`
    );
  } else {
    const total = params.items.reduce((s, i) => s + i.amount, 0);
    rowsHtml.push(
      `<tr style="background-color: #EDF2EF;">
        <td colspan="4" style="${tdStyle('left', 'font-weight: 700;')}">Total (${params.items.length} items)</td>
        <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(total))}</td>
        <td style="${tdStyle('left')}"></td>
      </tr>`
    );
  }

  const filterParts = [`FY ${params.selectedFy}`];
  if (params.statusFilter && params.statusFilter !== 'all') {
    filterParts.push(`Status: ${params.statusFilter}`);
  }
  if (params.selectedCode) filterParts.push(`Code: ${params.selectedCode}`);

  return renderPaginatedLandscapePdf({
    officeName: params.officeName,
    officeAddress: params.officeAddress,
    title: 'Expense List (খরচ তালিকা)',
    filters: filterParts.join('  •  '),
    selectedFy: params.selectedFy,
    columns,
    rowsHtml,
    fileName: `expense-items-FY-${params.selectedFy}.pdf`,
  });
}

export async function exportBillsPdf(params: {
  bills: BillDoc[];
  selectedFy: string;
  officeName: string;
  officeAddress?: string;
  officesById?: Map<string, OfficeDoc>;
  selectedCode?: string;
  statusFilter?: string;
  getHead: (
    code: string,
    fallback?: { headName?: string; headNameBn?: string }
  ) => { headName: string; headNameBn: string };
}): Promise<SaveAndShareOutcome> {
  const columns: TableColumn[] = [
    { label: 'Bill No', align: 'left', width: '11%' },
    { label: 'Date', align: 'left', width: '9%' },
    { label: 'ব্যয়ের খাত', align: 'left', width: '21%' },
    { label: 'Prepared / Approved By', align: 'left', width: '20%' },
    { label: 'Items', align: 'right', width: '6%' },
    { label: 'Gross (৳)', align: 'right', width: '8.5%' },
    { label: 'VAT+IT (৳)', align: 'right', width: '8.5%' },
    { label: 'Net Payable (৳)', align: 'right', width: '9%' },
    { label: 'Status', align: 'left', width: '7%' },
  ];

  const rowsHtml = params.bills.map((b) => {
    const resolved = params.getHead(b.economicCode, {
      headName: b.headName,
      headNameBn: b.headNameBn,
    });
    const prepStr = formatActorBrief(b.createdBy, params.officesById, b.createdByName);
    const apprStr = b.approvedBy ? formatApprovedByLine(b.approvedBy, params.officesById) : '';
    const actorHtml = `<div style="font-size: 11px; line-height: 1.4; font-family: 'Nikosh', 'Noto Sans Bengali', sans-serif;"><div>${esc(prepStr)}</div>${
      apprStr ? `<div style="color: #0F766E; margin-top: 2px;">✓ ${esc(apprStr)}</div>` : ''
    }</div>`;
    return `<tr>
      <td style="${tdStyle('left', 'white-space: nowrap; font-weight: 600;')}">${esc(b.billNo || 'Draft')}</td>
      <td style="${tdStyle('left', 'white-space: nowrap; color: #55655F; font-variant-numeric: tabular-nums;')}">${esc(formatDateDisplay(b.date))}</td>
      <td style="${tdStyle('left')}">${buildHeadCell(b.economicCode, resolved.headName, resolved.headNameBn)}</td>
      <td style="${tdStyle('left')}">${actorHtml}</td>
      <td style="${tdStyle('right', 'font-variant-numeric: tabular-nums;')}">${b.items.length}</td>
      <td style="${tdStyle('right', 'white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(b.grossAmount))}</td>
      <td style="${tdStyle('right', 'white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(b.totalDeduction))}</td>
      <td style="${tdStyle('right', 'white-space: nowrap; font-weight: 600; color: #0F766E; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(b.netPayable))}</td>
      <td style="${tdStyle('left', 'text-transform: capitalize;')}">${esc(b.status)}</td>
    </tr>`;
  });

  if (rowsHtml.length === 0) {
    rowsHtml.push(
      `<tr><td colspan="9" style="${tdStyle('left', 'text-align: center; padding: 24px; color: #55655F;')}">No bills found.</td></tr>`
    );
  } else {
    const grossSum = params.bills.reduce((s, b) => s + b.grossAmount, 0);
    const dedSum = params.bills.reduce((s, b) => s + b.totalDeduction, 0);
    const netSum = params.bills.reduce((s, b) => s + b.netPayable, 0);
    rowsHtml.push(
      `<tr style="background-color: #EDF2EF;">
        <td colspan="5" style="${tdStyle('left', 'font-weight: 700;')}">Total (${params.bills.length} bills)</td>
        <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(grossSum))}</td>
        <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(dedSum))}</td>
        <td style="${tdStyle('right', 'font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums;')}">${esc(formatNumberIN(netSum))}</td>
        <td style="${tdStyle('left')}"></td>
      </tr>`
    );
  }

  const filterParts = [`FY ${params.selectedFy}`];
  if (params.statusFilter && params.statusFilter !== 'all') {
    filterParts.push(`Status: ${params.statusFilter}`);
  }
  if (params.selectedCode) filterParts.push(`Code: ${params.selectedCode}`);

  return renderPaginatedLandscapePdf({
    officeName: params.officeName,
    officeAddress: params.officeAddress,
    title: 'Bills Register (বিল তালিকা)',
    filters: filterParts.join('  •  '),
    selectedFy: params.selectedFy,
    columns,
    rowsHtml,
    fileName: `bills-FY-${params.selectedFy}.pdf`,
  });
}
