import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  ChevronRight,
  Download,
  Eye,
  FileDown,
  FileSpreadsheet,
  FileText,
  Plus,
  ReceiptText,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { StatusChip, type ChipVariant } from '../components/StatusChip';
import { SegmentedChips } from '../components/SegmentedChips';
import { FilterBar } from '../components/FilterBar';
import { EmptyState } from '../components/EmptyState';
import { BillFormPreviewModal } from '../components/BillFormPreviewModal';
import { DeleteBillModal } from '../components/DeleteBillModal';
import { useAuth } from '../contexts/AuthContext';
import { ALL_OFFICES_ID, LEGACY_UNMIGRATED_OFFICE_ID, useApp } from '../contexts/AppContext';
import { useFyData } from '../hooks/useFyData';
import { useEconomicCodes } from '../hooks/useEconomicCodes';
import { formatActorBrief, formatApprovedByLine, getActorUid } from '../lib/actor';
import {
  buildTr21FormData,
  formatVoucherNoForTr21,
  sanitizeBillFileSegment,
} from '../lib/billFormData';
import { formatDateDisplay } from '../lib/dates';
import { deleteBill } from '../lib/firestoreOps';
import { formatNumberIN, formatTaka, fromPaisa } from '../lib/money';
import { canCreateDraftBill, canDeleteBill } from '../lib/permissions';
import { exportBillsPdf } from '../utils/exportPdf';
import { exportTr21Pdf } from '../utils/exportTr21';
import { saveAndShareFile } from '../utils/saveFile';
import type { BillDoc, BillStatus } from '../types';

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

function formatBillRateForExcel(bill: BillDoc, kind: 'vat' | 'it'): string | number {
  if (bill.amountBasis === 'voucher' || bill.amountBasis === 'mixed') {
    const lines = (bill.deductions || []).filter(
      (d) => d.kind === kind && typeof d.rate === 'number' && Number.isFinite(d.rate)
    );
    if (lines.length > 1) {
      return lines.map((l) => `${l.rate}%`).join(', ');
    }
    if (lines.length === 1 && typeof lines[0].rate === 'number') {
      return lines[0].rate;
    }
    return 'পণ্যভিত্তিক';
  }
  return kind === 'vat' ? bill.vatRate : bill.itRate;
}

export function BillsPage() {
  const { userDoc, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    selectedFy,
    officeSettings,
    currentOfficeId,
    currentOfficeRole,
    isAllOfficesMode,
    isLegacyPreMigration,
    actorSnapshot,
    officesById,
    pushToast,
    t,
  } = useApp();
  const { budgets, bills, loading } = useFyData(selectedFy);
  const { getHead } = useEconomicCodes();
  const [searchParams, setSearchParams] = useSearchParams();

  const realOfficeId =
    currentOfficeId &&
    currentOfficeId !== ALL_OFFICES_ID &&
    currentOfficeId !== LEGACY_UNMIGRATED_OFFICE_ID
      ? currentOfficeId
      : '';

  const permCtx = { isSuperAdmin, officeRole: currentOfficeRole };
  const canDraftBill =
    !isAllOfficesMode &&
    !isLegacyPreMigration &&
    Boolean(realOfficeId) &&
    canCreateDraftBill(permCtx);

  const effectiveActor =
    actorSnapshot || (userDoc ? { uid: userDoc.id, name: userDoc.name } : null);

  const canDeleteRowBill = (b: BillDoc) =>
    !isAllOfficesMode &&
    !isLegacyPreMigration &&
    Boolean(realOfficeId) &&
    canDeleteBill(
      permCtx,
      b.status,
      Boolean(b.createdBy && getActorUid(b.createdBy) === userDoc?.id)
    );

  const [deleteTargetBillId, setDeleteTargetBillId] = useState<string | null>(null);
  const [deletingBill, setDeletingBill] = useState(false);
  const deleteTargetBill = useMemo(
    () => (deleteTargetBillId ? bills.find((b) => b.id === deleteTargetBillId) || null : null),
    [bills, deleteTargetBillId]
  );

  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const initialStatusParam = searchParams.get('status') as 'all' | BillStatus | null;
  const [statusFilter, setStatusFilter] = useState<'all' | BillStatus>(
    initialStatusParam &&
      ['all', 'draft', 'submitted', 'approved', 'rejected', 'cancelled'].includes(initialStatusParam)
      ? initialStatusParam
      : 'all'
  );
  useEffect(() => {
    const param = searchParams.get('status') as 'all' | BillStatus | null;
    if (
      param &&
      ['all', 'draft', 'submitted', 'approved', 'rejected', 'cancelled'].includes(param)
    ) {
      setStatusFilter(param);
    } else if (!param) {
      setStatusFilter('all');
    }
  }, [searchParams]);

  const [codeFilter, setCodeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // T.R. Form No. 21 preview & export state
  const [tr21BillId, setTr21BillId] = useState<string | null>(null);
  const [tr21Busy, setTr21Busy] = useState<string | null>(null);
  const tr21Bill = useMemo(
    () => (tr21BillId ? bills.find((b) => b.id === tr21BillId) || null : null),
    [bills, tr21BillId]
  );
  const tr21FormData = useMemo(() => {
    if (!tr21Bill) return null;
    return buildTr21FormData({
      bill: tr21Bill,
      officeSettings,
      budgets,
      allBillsInFy: bills,
      getHead,
    });
  }, [tr21Bill, officeSettings, budgets, bills, getHead]);

  // Export menu state
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [exportMenuOpen]);

  const approvedSummary = useMemo(() => {
    let gross = 0;
    let deduction = 0;
    let net = 0;
    let count = 0;
    for (const b of bills) {
      if (b.status !== 'approved') continue;
      count += 1;
      gross += b.grossAmount;
      deduction += b.totalDeduction;
      net += b.netPayable;
    }
    return { count, gross, deduction, net };
  }, [bills]);

  const searchAndCodeMatchedBills = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bills.filter((b) => {
      if (codeFilter && b.economicCode !== codeFilter) return false;
      if (!q) return true;
      const head = getHead(b.economicCode, { headName: b.headName, headNameBn: b.headNameBn });
      const itemsText = b.items
        .map((it) => `${it.description} ${it.responsibleEmployee.name}`)
        .join(' ')
        .toLowerCase();
      const voucherDisplay = formatVoucherNoForTr21(b.voucherNo, b.billNo, b.fiscalYear).toLowerCase();
      return (
        (b.billNo || '').toLowerCase().includes(q) ||
        (b.voucherNo || '').toLowerCase().includes(q) ||
        voucherDisplay.includes(q) ||
        b.economicCode.toLowerCase().includes(q) ||
        head.headName.toLowerCase().includes(q) ||
        head.headNameBn.toLowerCase().includes(q) ||
        itemsText.includes(q)
      );
    });
  }, [bills, codeFilter, search, getHead]);

  const statusChipOptions = useMemo(() => {
    const counts: Record<'all' | BillStatus, number> = {
      all: searchAndCodeMatchedBills.length,
      draft: 0,
      submitted: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
    };
    for (const b of searchAndCodeMatchedBills) {
      counts[b.status] += 1;
    }
    return (['all', 'draft', 'submitted', 'approved', 'rejected', 'cancelled'] as const).map(
      (st) => ({
        value: st,
        label: t(st),
        count: counts[st],
      })
    );
  }, [searchAndCodeMatchedBills, t]);

  const filteredBills = useMemo(() => {
    if (statusFilter === 'all') return searchAndCodeMatchedBills;
    return searchAndCodeMatchedBills.filter((b) => b.status === statusFilter);
  }, [searchAndCodeMatchedBills, statusFilter]);

  const pagedBills = useMemo(() => {
    const start = (page - 1) * 50;
    return filteredBills.slice(start, start + 50);
  }, [filteredBills, page]);

  const handleDirectTr21Pdf = async (bill: BillDoc) => {
    const key = `${bill.id}:pdf`;
    if (tr21Busy) return;
    setTr21Busy(key);
    try {
      const formData = buildTr21FormData({
        bill,
        officeSettings,
        budgets,
        allBillsInFy: bills,
        getHead,
      });
      const fileSeg = sanitizeBillFileSegment(bill);
      const res = await exportTr21Pdf(formData, fileSeg);
      if (res.status === 'shared') {
        pushToast('success', 'টি.আর. ২১ PDF তৈরি হয়েছে — শেয়ার বা সেভ করুন।');
      } else if (res.status === 'downloaded') {
        pushToast('success', `${res.fileName} ডাউনলোড হয়েছে।`);
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'TR 21 export failed.');
    } finally {
      setTr21Busy(null);
    }
  };

  const handleConfirmDeleteBill = async (reason?: string) => {
    if (!deleteTargetBill || !effectiveActor || !canDeleteRowBill(deleteTargetBill)) return;
    setDeletingBill(true);
    try {
      await deleteBill(deleteTargetBill, effectiveActor, reason);
      const msg =
        deleteTargetBill.status === 'draft'
          ? 'খসড়া বিল মুছে ফেলা হয়েছে; খরচ আইটেম তালিকায় ফিরে গেছে।'
          : deleteTargetBill.status === 'submitted'
          ? `জমাকৃত বিল ${deleteTargetBill.billNo || ''} মুছে ফেলা হয়েছে; আটকে থাকা বাজেট মুক্ত হয়েছে।`
          : deleteTargetBill.status === 'approved'
          ? `অনুমোদিত বিল ${deleteTargetBill.billNo || ''} মুছে ফেলা হয়েছে ও বাজেট সমন্বয় হয়েছে।`
          : t('billDeletedToast');
      pushToast('success', msg);
      setDeleteTargetBillId(null);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'বিল মুছে ফেলা যায়নি।');
    } finally {
      setDeletingBill(false);
    }
  };

  const handleExportPdf = async () => {
    if (exportingPdf) return;
    setExportMenuOpen(false);
    setExportingPdf(true);
    try {
      const outcome = await exportBillsPdf({
        bills: filteredBills,
        selectedFy,
        officeName: officeSettings.officeName,
        officeAddress: officeSettings.address,
        officesById,
        selectedCode: codeFilter,
        statusFilter,
        getHead,
      });
      if (outcome.status === 'shared') {
        pushToast('success', 'PDF ready — choose an app to open or save.');
      } else if (outcome.status === 'downloaded') {
        pushToast('success', 'Bills PDF downloaded.');
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'PDF export failed.');
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportExcel = async () => {
    if (exportingExcel) return;
    setExportMenuOpen(false);
    setExportingExcel(true);
    try {
      const excelRows = filteredBills.map((b) => {
        const head = getHead(b.economicCode, { headName: b.headName, headNameBn: b.headNameBn });
        return {
          'Bill No': b.billNo || 'Draft',
          'Voucher No': b.voucherNo
            ? formatVoucherNoForTr21(b.voucherNo, null, b.fiscalYear)
            : '',
          Date: formatDateDisplay(b.date),
          'Economic Code': b.economicCode,
          'ব্যয়ের খাত': head.displayName,
          প্রস্তুতকারী: formatActorBrief(b.createdBy, officesById, b.createdByName),
          অনুমোদনকারী: b.approvedBy ? formatApprovedByLine(b.approvedBy, officesById) : '',
          'Items Count': b.items.length,
          'Gross (BDT)': fromPaisa(b.grossAmount),
          'VAT %': formatBillRateForExcel(b, 'vat'),
          'VAT (BDT)': fromPaisa(b.vatAmount),
          'IT %': formatBillRateForExcel(b, 'it'),
          'IT (BDT)': fromPaisa(b.itAmount),
          'Total Deduction (BDT)': fromPaisa(b.totalDeduction),
          'Net Payable (BDT)': fromPaisa(b.netPayable),
          Status: b.status,
          'Reject / Cancel Reason': b.rejectReason || b.cancelReason || '',
        };
      });
      const ws = XLSX.utils.json_to_sheet(excelRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Bills');
      const wbArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
      const outcome = await saveAndShareFile({
        data: new Uint8Array(wbArray),
        fileName: `bills-FY-${selectedFy}.xlsx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        title: `Bills Register (FY ${selectedFy})`,
      });
      if (outcome.status === 'shared') {
        pushToast('success', 'Excel ready — choose an app to open or save.');
      } else if (outcome.status === 'downloaded') {
        pushToast('success', 'Bills Excel downloaded.');
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Excel export failed.');
    } finally {
      setExportingExcel(false);
    }
  };

  const headerActions = (
    <div className="flex items-center gap-2">
      <div className="relative" ref={exportMenuRef}>
        <button
          type="button"
          onClick={() => setExportMenuOpen((v) => !v)}
          aria-label={t('exportLabel')}
          title={t('exportLabel')}
          aria-haspopup="menu"
          aria-expanded={exportMenuOpen}
          className="min-h-[44px] min-w-[44px] px-3 rounded-xl border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold inline-flex items-center justify-center gap-1.5"
        >
          <Download className="w-4 h-4 shrink-0" />
          <span className="hidden sm:inline">{t('exportLabel')}</span>
        </button>
        {exportMenuOpen && (
          <div
            role="menu"
            className="absolute right-0 mt-1.5 w-48 rounded-xl border border-[var(--line)] bg-[var(--card)] shadow-lg p-1.5 z-30 space-y-1"
          >
            <button
              type="button"
              role="menuitem"
              disabled={exportingPdf}
              onClick={handleExportPdf}
              className="w-full min-h-[44px] px-3 rounded-lg hover:bg-[var(--surface-subtle)] text-left text-xs font-medium inline-flex items-center gap-2 disabled:opacity-60"
            >
              <FileText className="w-4 h-4 text-[var(--muted)] shrink-0" />
              <span>{exportingPdf ? 'PDF…' : t('exportPdfList')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={exportingExcel}
              onClick={handleExportExcel}
              className="w-full min-h-[44px] px-3 rounded-lg hover:bg-[var(--surface-subtle)] text-left text-xs font-medium inline-flex items-center gap-2 disabled:opacity-60"
            >
              <FileSpreadsheet className="w-4 h-4 text-[var(--muted)] shrink-0" />
              <span>{exportingExcel ? 'Excel…' : t('exportExcelList')}</span>
            </button>
          </div>
        )}
      </div>

      {canDraftBill && (
        <Link
          to="/expense-items"
          className="min-h-[44px] px-4 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span>খরচ থেকে বিল</span>
        </Link>
      )}
    </div>
  );

  if (isAllOfficesMode || (!currentOfficeId && !isLegacyPreMigration)) {
    return (
      <Layout title={t('navBills')}>
        <PageHeader title={t('navBills')} subtitle={null} />
        <div className="card-surface p-6 text-center space-y-2 max-w-lg mx-auto">
          <h2 className="text-base font-bold text-[var(--text)]">একটি অফিস নির্বাচন করুন</h2>
          <p className="text-xs sm:text-sm text-[var(--muted)]">
            {isSuperAdmin
              ? 'বিলসমূহ দেখতে, প্রিন্ট/এক্সপোর্ট করতে অথবা অনুমোদিত বিল সংশোধন করতে উপরের অফিস সুইচার থেকে একটি নির্দিষ্ট অফিস নির্বাচন করুন।'
              : 'আপনার জন্য কোনো সক্রিয় অফিস নির্ধারিত নেই। অনুগ্রহ করে সুপার অ্যাডমিন বা দপ্তর প্রধানের সাথে যোগাযোগ করুন।'}
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={t('navBills')}>
      <PageHeader
        title={t('navBills')}
        subtitle={`FY ${selectedFy} · ${filteredBills.length} ${t('billsCountLabel')}`}
        actions={headerActions}
      />

      <div className="space-y-4">
        {isLegacyPreMigration && (
          <div className="px-3.5 py-2.5 rounded-[14px] bg-[var(--warn-bg)] text-[var(--warn-text)] text-xs font-medium">
            মাল্টি-অফিস মাইগ্রেশন সম্পন্ন হয়নি। বিল অনুমোদন বা নতুন বিল তৈরি করতে সুপার অ্যাডমিন সেটিংস থেকে &ldquo;Migrate to multi-office&rdquo; চালান।
          </div>
        )}

        {!isOnline && (
          <div className="px-3.5 py-2.5 rounded-[14px] bg-[var(--warn-bg)] text-[var(--warn-text)] text-xs font-medium flex items-center gap-2">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>
              অফলাইন মোড: বিল জমা (Submit), অনুমোদন (Approve), প্রত্যাখ্যান বা বাতিল করতে ইন্টারনেট সংযোগ চালু করুন।
            </span>
          </div>
        )}

        {/* Approved Bills Summary Card */}
        <div className="card-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <span className="text-xs font-semibold text-[var(--muted)]">
              {t('approvedBillsSummary')} · FY {selectedFy}
            </span>
            <span className="text-xs text-[var(--muted)] tabular-nums">
              {approvedSummary.count} {t('billsCountLabel')}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs sm:text-sm">
            <div className="min-w-0">
              <div className="text-[11px] text-[var(--muted)]">{t('gross')}</div>
              <div className="font-bold text-[var(--text)] tabular-nums truncate mt-0.5">
                {formatTaka(approvedSummary.gross)}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-[var(--muted)]">কর্তন</div>
              <div className="font-bold text-[var(--muted)] tabular-nums truncate mt-0.5">
                {formatTaka(approvedSummary.deduction)}
              </div>
            </div>
            <div className="min-w-0 text-right">
              <div className="text-[11px] text-[var(--muted)]">{t('netPayable')}</div>
              <div className="font-bold text-[var(--accent)] tabular-nums truncate mt-0.5">
                {formatTaka(approvedSummary.net)}
              </div>
            </div>
          </div>
        </div>

        {/* Status Chips & Filters */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <SegmentedChips
            options={statusChipOptions}
            value={statusFilter}
            onChange={(st) => {
              setStatusFilter(st);
              setPage(1);
              if (st === 'all') searchParams.delete('status');
              else searchParams.set('status', st);
              setSearchParams(searchParams, { replace: true });
            }}
            ariaLabel="Filter bills by status"
          />

          <FilterBar
            codeFilter={codeFilter}
            onCodeChange={(code) => {
              setCodeFilter(code);
              setPage(1);
            }}
            search={search}
            onSearchChange={(val) => {
              setSearch(val);
              setPage(1);
            }}
            searchPlaceholder="বিল নং, খাত, আইটেম…"
            searchAriaLabel="Search bills"
          />
        </div>

        {/* Bills List */}
        {loading ? (
          <div className="card-surface p-8 text-center text-sm text-[var(--muted)]">
            বিল তালিকা লোড হচ্ছে…
          </div>
        ) : pagedBills.length === 0 ? (
          <EmptyState
            icon={<ReceiptText className="w-5 h-5" />}
            title={t('noDataFound')}
            action={
              bills.length === 0 && canDraftBill ? (
                <Link
                  to="/expense-items"
                  className="min-h-[44px] px-4 rounded-xl bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>খরচ থেকে বিল</span>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="card-surface overflow-hidden">
            {/* Mobile Cards (< 1024px) */}
            <div className="lg:hidden divide-y divide-[var(--line)]">
              {pagedBills.map((b) => {
                const head = getHead(b.economicCode, {
                  headName: b.headName,
                  headNameBn: b.headNameBn,
                });
                const detailLinkState = { fromSearch: location.search };
                return (
                  <div key={b.id} className="p-3.5 space-y-2.5">
                    <Link
                      to={`/bills/${b.id}`}
                      state={detailLinkState}
                      className="block space-y-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
                            <span className="font-bold text-sm text-[var(--text)] tabular-nums">
                              {b.billNo || 'খসড়া (Draft)'}
                            </span>
                            {b.voucherNo && (
                              <span className="px-1.5 py-0.5 rounded bg-[var(--surface-subtle)] border border-[var(--line)] text-[11px] font-medium text-[var(--text)] bn tabular-nums">
                                ভাউচার: {formatVoucherNoForTr21(b.voucherNo, null, b.fiscalYear)}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[var(--muted)] mt-0.5 tabular-nums">
                            {formatDateDisplay(b.date)} · {b.items.length}টি আইটেম
                            {b.amountBasis === 'voucher' ? ' · পণ্যভিত্তিক হার' : ''}
                          </div>
                          <div className="text-sm font-medium text-[var(--text)] mt-1 break-words">
                            <span className="tabular-nums font-semibold">{b.economicCode}</span>{' '}
                            <span className="bn">{head.displayName}</span>
                          </div>
                          <div className="text-[11px] text-[var(--muted)] mt-1 truncate">
                            প্রস্তুত: {formatActorBrief(b.createdBy, officesById, b.createdByName)}
                            {b.approvedBy &&
                              ` · অনুমোদন: ${formatApprovedByLine(b.approvedBy, officesById)}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <StatusChip variant={billStatusToChip(b.status)}>{t(b.status)}</StatusChip>
                          <ChevronRight className="w-4 h-4 text-[var(--muted)]" />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--line)]/60 text-xs">
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">{t('gross')}</div>
                          <div className="font-medium tabular-nums truncate">
                            {formatNumberIN(b.grossAmount)}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--muted)]">কর্তন</div>
                          <div className="font-medium text-[var(--muted)] tabular-nums truncate">
                            {formatNumberIN(b.totalDeduction)}
                          </div>
                        </div>
                        <div className="min-w-0 text-right">
                          <div className="text-[11px] text-[var(--muted)]">{t('netPayable')}</div>
                          <div className="font-bold text-[var(--accent)] tabular-nums truncate">
                            {formatNumberIN(b.netPayable)}
                          </div>
                        </div>
                      </div>
                    </Link>

                    <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-[var(--line)]/40">
                      <Link
                        to={`/bills/${b.id}`}
                        state={detailLinkState}
                        className="min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold inline-flex items-center"
                      >
                        {t('openLabel')}
                      </Link>
                      <button
                        type="button"
                        onClick={() => setTr21BillId(b.id)}
                        className="min-h-[44px] px-3 rounded-lg border border-[var(--accent)] text-[var(--accent)] text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5 shrink-0" />
                        <span>ফর্ম (টি.আর. ২১)</span>
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(tr21Busy)}
                        onClick={() => handleDirectTr21Pdf(b)}
                        className="min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-60"
                      >
                        <FileDown className="w-3.5 h-3.5 shrink-0" />
                        <span>PDF</span>
                      </button>
                      {canDeleteRowBill(b) && (
                        <button
                          type="button"
                          onClick={() => setDeleteTargetBillId(b.id)}
                          aria-label={t('deleteBillBtn')}
                          title={t('deleteBillBtn')}
                          className="min-h-[44px] min-w-[44px] px-2.5 rounded-lg border border-[var(--danger-text)]/40 text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40 inline-flex items-center justify-center"
                        >
                          <Trash2 className="w-4 h-4 shrink-0" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table (>= 1024px) */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                    <th className="sticky left-0 z-10 bg-[var(--card)] py-3 px-4 font-medium whitespace-nowrap">
                      {t('billNo')}
                    </th>
                    <th className="py-3 px-4 font-medium whitespace-nowrap">{t('date')}</th>
                    <th className="py-3 px-4 font-medium">{t('head')}</th>
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">আইটেম</th>
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                      {t('gross')}
                    </th>
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">কর্তন</th>
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                      {t('netPayable')}
                    </th>
                    <th className="py-3 px-4 font-medium whitespace-nowrap">{t('status')}</th>
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {pagedBills.map((b) => {
                    const head = getHead(b.economicCode, {
                      headName: b.headName,
                      headNameBn: b.headNameBn,
                    });
                    const detailState = { fromSearch: location.search };
                    return (
                      <tr
                        key={b.id}
                        onClick={() => navigate(`/bills/${b.id}`, { state: detailState })}
                        className="group cursor-pointer hover:bg-[var(--surface-subtle)] transition-colors"
                      >
                        <td className="sticky left-0 z-10 bg-[var(--card)] group-hover:bg-[var(--surface-subtle)] py-3 px-4 font-semibold tabular-nums whitespace-nowrap transition-colors">
                          <div>
                            {b.billNo || <span className="text-[var(--muted)] font-normal">খসড়া</span>}
                          </div>
                          {b.voucherNo && (
                            <div className="text-[11px] font-normal text-[var(--muted)] bn">
                              ভাউচার: {formatVoucherNoForTr21(b.voucherNo, null, b.fiscalYear)}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 tabular-nums whitespace-nowrap text-[var(--muted)]">
                          {formatDateDisplay(b.date)}
                        </td>
                        <td className="py-3 px-4 min-w-[200px]">
                          <div className="font-medium text-[var(--text)]">
                            <span className="tabular-nums">{b.economicCode}</span>{' '}
                            <span className="bn">{head.displayName}</span>
                          </div>
                          <div className="text-[11px] text-[var(--muted)] mt-0.5 truncate max-w-[280px]">
                            প্রস্তুত: {formatActorBrief(b.createdBy, officesById, b.createdByName)}
                            {b.approvedBy &&
                              ` · ✓ ${formatApprovedByLine(b.approvedBy, officesById)}`}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums">
                          <div>{b.items.length}</div>
                          {b.amountBasis === 'voucher' && (
                            <div className="text-[10px] text-[var(--muted)] bn whitespace-nowrap">
                              পণ্যভিত্তিক
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                          {formatNumberIN(b.grossAmount)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap text-[var(--muted)]">
                          {formatNumberIN(b.totalDeduction)}
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-[var(--accent)] tabular-nums whitespace-nowrap">
                          {formatNumberIN(b.netPayable)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <StatusChip variant={billStatusToChip(b.status)}>{t(b.status)}</StatusChip>
                        </td>
                        <td
                          className="py-3 px-4 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center gap-1.5">
                            <Link
                              to={`/bills/${b.id}`}
                              state={detailState}
                              className="min-h-[34px] px-2.5 rounded-md border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--bg)] text-xs font-semibold inline-flex items-center"
                            >
                              {t('openLabel')}
                            </Link>
                            <button
                              type="button"
                              onClick={() => setTr21BillId(b.id)}
                              title="ফর্ম (টি.আর. ২১)"
                              aria-label="Preview T.R. Form 21"
                              className="min-h-[34px] px-2.5 rounded-md border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-soft)] text-xs font-semibold inline-flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>টি.আর. ২১</span>
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(tr21Busy)}
                              onClick={() => handleDirectTr21Pdf(b)}
                              title="PDF"
                              aria-label="Export T.R. Form 21 PDF"
                              className="min-h-[34px] px-2.5 rounded-md border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--bg)] text-xs inline-flex items-center justify-center disabled:opacity-60"
                            >
                              <FileDown className="w-3.5 h-3.5" />
                            </button>
                            {canDeleteRowBill(b) && (
                              <button
                                type="button"
                                onClick={() => setDeleteTargetBillId(b.id)}
                                title={t('deleteBillBtn')}
                                aria-label={t('deleteBillBtn')}
                                className="min-h-[34px] min-w-[34px] px-2 rounded-md border border-[var(--danger-text)]/40 text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40 text-xs inline-flex items-center justify-center"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination page={page} totalItems={filteredBills.length} onPageChange={setPage} />
          </div>
        )}
      </div>

      <BillFormPreviewModal
        open={Boolean(tr21Bill && tr21FormData)}
        onClose={() => setTr21BillId(null)}
        bill={tr21Bill}
        formData={tr21FormData}
      />

      <DeleteBillModal
        open={Boolean(deleteTargetBill)}
        onClose={() => {
          if (!deletingBill) setDeleteTargetBillId(null);
        }}
        bill={deleteTargetBill}
        isOnline={isOnline}
        deleting={deletingBill}
        onConfirm={handleConfirmDeleteBill}
      />
    </Layout>
  );
}
