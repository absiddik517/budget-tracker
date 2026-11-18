import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Eye,
  FileDown,
  FileSpreadsheet,
  FileText,
  Lock,
  Plus,
  Printer,
  Search,
  Trash2,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { StatusChip, type ChipVariant } from '../components/StatusChip';
import { ActivityList } from '../components/ActivityList';
import { EconomicCodeSelect } from '../components/EconomicCodeSelect';
import { BillFormPreviewModal } from '../components/BillFormPreviewModal';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { useFyData } from '../hooks/useFyData';
import { useEconomicCodes } from '../hooks/useEconomicCodes';
import { useDocAuditLogs } from '../hooks/useAuditLogs';
import { buildTr21FormData, sanitizeBillFileSegment } from '../lib/billFormData';
import { computeCodeAvailable } from '../lib/computeAvailable';
import { formatDateDisplay } from '../lib/dates';
import {
  approveBillTx,
  cancelApprovedBillTx,
  deleteDraftBill,
  rejectBillTx,
  submitBillTx,
  updateDraftBillRates,
} from '../lib/firestoreOps';
import {
  calcPercentageAmount,
  formatNumberIN,
  formatPaisaInput,
  formatTaka,
  fromPaisa,
  toPaisa,
} from '../lib/money';
import { canApproveRejectCancelBill } from '../lib/permissions';
import {
  DEFAULT_IT_CODE,
  DEFAULT_NET_PAYABLE_CODE,
  DEFAULT_SECURITY_CODE,
  DEFAULT_VAT_CODE,
} from '../lib/tr21Defaults';
import { exportBillsPdf } from '../utils/exportPdf';
import { exportTr21Docx, exportTr21Pdf, printTr21Form } from '../utils/exportTr21';
import { saveAndShareFile } from '../utils/saveFile';
import type { BillDeductionLine, BillDoc, BillStatus } from '../types';

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

export function BillsPage() {
  const { userDoc } = useAuth();
  const { selectedFy, officeSettings, pushToast, t } = useApp();
  const { budgets, bills, vatTaxRates, spendingLimits, fyCodeTotals, loading } =
    useFyData(selectedFy);
  const { getHead } = useEconomicCodes();
  const [searchParams, setSearchParams] = useSearchParams();

  const isDdo = userDoc ? canApproveRejectCancelBill(userDoc.role) : false;

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
    }
  }, [searchParams]);

  const [codeFilter, setCodeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const selectedBill = useMemo(
    () => (selectedBillId ? bills.find((b) => b.id === selectedBillId) || null : null),
    [bills, selectedBillId]
  );
  const { logs: billLogs, loading: logsLoading } = useDocAuditLogs(
    'bills',
    selectedBill?.id || null
  );

  // Draft editing state
  const [editDraftDate, setEditDraftDate] = useState('');
  const [editDraftVariantKey, setEditDraftVariantKey] = useState('');
  const [editTokenNo, setEditTokenNo] = useState('');
  const [editPurposeText, setEditPurposeText] = useState('');
  const [editPayeeText, setEditPayeeText] = useState('');
  const [editNetPayableCode, setEditNetPayableCode] = useState(DEFAULT_NET_PAYABLE_CODE);
  const [editSupplierName, setEditSupplierName] = useState('');
  const [editSupplierAddress, setEditSupplierAddress] = useState('');
  const [editSupplierTinBin, setEditSupplierTinBin] = useState('');
  const [editDeductions, setEditDeductions] = useState<BillDeductionLine[]>([]);
  const [savingDraftEdit, setSavingDraftEdit] = useState(false);

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

  // Workflow action state
  const [acting, setActing] = useState(false);
  const [reasonMode, setReasonMode] = useState<'reject' | 'cancel' | null>(null);
  const [reasonText, setReasonText] = useState('');

  // Export state
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  useEffect(() => {
    if (!selectedBill) {
      setReasonMode(null);
      setReasonText('');
      return;
    }
    setEditDraftDate(selectedBill.date);
    setEditDraftVariantKey(selectedBill.vatVariant || 'default');
    setEditTokenNo(selectedBill.tokenNo || '');
    setEditPurposeText(selectedBill.purposeText || '');
    setEditPayeeText(selectedBill.payeeText || officeSettings.defaultPayeeText || '');
    setEditNetPayableCode(
      selectedBill.netPayableCode || officeSettings.defaultNetPayableCode || DEFAULT_NET_PAYABLE_CODE
    );
    setEditSupplierName(selectedBill.supplier?.name || '');
    setEditSupplierAddress(selectedBill.supplier?.address || '');
    setEditSupplierTinBin(selectedBill.supplier?.tinBin || '');
    setEditDeductions(
      Array.isArray(selectedBill.deductions) && selectedBill.deductions.length > 0
        ? selectedBill.deductions.map((d) => ({ ...d }))
        : [
            {
              id: 'it',
              code: DEFAULT_IT_CODE,
              name: 'ব্যক্তি কর্তৃক দেয় আয়কর',
              rate: selectedBill.itRate,
              amount: selectedBill.itAmount,
              kind: 'it',
            },
            {
              id: 'vat',
              code: DEFAULT_VAT_CODE,
              name: 'দেশজ পণ্য ও সেবার ওপর মূসক',
              rate: selectedBill.vatRate,
              amount: selectedBill.vatAmount,
              kind: 'vat',
            },
          ]
    );
    setReasonMode(null);
    setReasonText('');
  }, [selectedBill, officeSettings.defaultPayeeText, officeSettings.defaultNetPayableCode]);

  const filteredBills = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bills.filter((b) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (codeFilter && b.economicCode !== codeFilter) return false;
      if (!q) return true;
      const head = getHead(b.economicCode, { headName: b.headName, headNameBn: b.headNameBn });
      const itemsText = b.items
        .map((it) => `${it.description} ${it.responsibleEmployee.name}`)
        .join(' ')
        .toLowerCase();
      return (
        (b.billNo || '').toLowerCase().includes(q) ||
        b.economicCode.toLowerCase().includes(q) ||
        head.headName.toLowerCase().includes(q) ||
        head.headNameBn.toLowerCase().includes(q) ||
        itemsText.includes(q)
      );
    });
  }, [bills, statusFilter, codeFilter, search, getHead]);

  const pagedBills = useMemo(() => {
    const start = (page - 1) * 50;
    return filteredBills.slice(start, start + 50);
  }, [filteredBills, page]);

  // Resolve available VAT variants for selected draft bill
  const selectedBillRates = useMemo(() => {
    if (!selectedBill) return null;
    const fyRate = vatTaxRates.find((r) => r.economicCode === selectedBill.economicCode);
    if (fyRate && fyRate.vat.length > 0) {
      return { incomeTax: fyRate.incomeTax, vat: fyRate.vat };
    }
    const activeBudget = budgets.find(
      (b) => b.economicCode === selectedBill.economicCode && b.status === 'active'
    );
    if (activeBudget && activeBudget.deductionRates.vat.length > 0) {
      return {
        incomeTax: activeBudget.deductionRates.incomeTax,
        vat: activeBudget.deductionRates.vat,
      };
    }
    return {
      incomeTax: selectedBill.itRate,
      vat: [
        {
          key: selectedBill.vatVariant || 'default',
          label: selectedBill.vatVariantLabel || 'Standard',
          rate: selectedBill.vatRate,
        },
      ],
    };
  }, [selectedBill, vatTaxRates, budgets]);

  // Live availability check for draft/submitted selected bill
  const selectedBillAvailability = useMemo(() => {
    if (!selectedBill) return null;
    const fyTotal = fyCodeTotals.find((f) => f.economicCode === selectedBill.economicCode);
    return computeCodeAvailable({
      fiscalYear: selectedBill.fiscalYear,
      economicCode: selectedBill.economicCode,
      budgets,
      fyCodeTotal: fyTotal,
      spendingLimits,
      date: selectedBill.date,
      gross: selectedBill.grossAmount,
      excludePendingAmount: selectedBill.status === 'submitted' ? selectedBill.grossAmount : 0,
    });
  }, [selectedBill, fyCodeTotals, budgets, spendingLimits]);

  const handleDirectTr21Output = async (
    bill: BillDoc,
    mode: 'print' | 'pdf' | 'docx'
  ) => {
    const key = `${bill.id}:${mode}`;
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
      if (mode === 'print') {
        const res = await printTr21Form(formData, fileSeg);
        if (res.status === 'shared') {
          pushToast('success', 'PDF তৈরি হয়েছে — প্রিন্ট বা সেভ করার অ্যাপ বেছে নিন।');
        }
      } else if (mode === 'pdf') {
        const res = await exportTr21Pdf(formData, fileSeg);
        if (res.status === 'shared') {
          pushToast('success', 'টি.আর. ২১ PDF তৈরি হয়েছে — শেয়ার বা সেভ করুন।');
        } else if (res.status === 'downloaded') {
          pushToast('success', `${res.fileName} ডাউনলোড হয়েছে।`);
        }
      } else {
        const res = await exportTr21Docx(formData, fileSeg);
        if (res.status === 'shared') {
          pushToast('success', 'টি.আর. ২১ Word (.docx) তৈরি হয়েছে — ওপেন বা সেভ করুন।');
        } else if (res.status === 'downloaded') {
          pushToast('success', `${res.fileName} ডাউনলোড হয়েছে।`);
        }
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'TR 21 export failed.');
    } finally {
      setTr21Busy(null);
    }
  };

  const handleSaveDraftRates = async () => {
    if (!userDoc || !selectedBill || selectedBill.status !== 'draft' || !selectedBillRates) return;
    const variant =
      selectedBillRates.vat.find((v) => v.key === editDraftVariantKey) || selectedBillRates.vat[0];
    setSavingDraftEdit(true);
    try {
      const supplierPayload =
        editSupplierName.trim() || editSupplierAddress.trim() || editSupplierTinBin.trim()
          ? {
              name: editSupplierName.trim(),
              address: editSupplierAddress.trim(),
              tinBin: editSupplierTinBin.trim(),
            }
          : null;

      await updateDraftBillRates(
        selectedBill,
        {
          date: editDraftDate,
          billDate: editDraftDate,
          vatVariant: variant.key,
          vatVariantLabel: variant.label,
          vatRate: variant.rate,
          itRate: selectedBillRates.incomeTax,
          tokenNo: editTokenNo.trim(),
          purposeText: editPurposeText.trim(),
          payeeText: editPayeeText.trim(),
          netPayableCode: editNetPayableCode.trim() || DEFAULT_NET_PAYABLE_CODE,
          supplier: supplierPayload,
          deductions: editDeductions,
        },
        { uid: userDoc.id, name: userDoc.name }
      );
      pushToast('success', 'খসড়া বিল ও টি.আর. ২১ তথ্য হালনাগাদ হয়েছে।');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'হালনাগাদ ব্যর্থ হয়েছে।');
    } finally {
      setSavingDraftEdit(false);
    }
  };

  const handleDeleteDraft = async (bill: BillDoc) => {
    if (!userDoc || bill.status !== 'draft') return;
    setActing(true);
    try {
      await deleteDraftBill(bill, { uid: userDoc.id, name: userDoc.name });
      pushToast('success', 'খসড়া বিল মুছে ফেলা হয়েছে; খরচ আইটেম তালিকায় ফিরে গেছে।');
      setSelectedBillId(null);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'মুছে ফেলা ব্যর্থ হয়েছে।');
    } finally {
      setActing(false);
    }
  };

  const handleSubmitDraft = async (bill: BillDoc) => {
    if (!userDoc || bill.status !== 'draft') return;
    if (!isOnline) {
      pushToast('error', 'বিল জমা দিতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    setActing(true);
    try {
      const res = await submitBillTx(bill.id, { uid: userDoc.id, name: userDoc.name });
      pushToast('success', `বিল নং ${res.billNo} অনুমোদনের জন্য জমা হয়েছে।`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'বিল জমা দেওয়া যায়নি।');
    } finally {
      setActing(false);
    }
  };

  const handleApproveBill = async (bill: BillDoc) => {
    if (!userDoc || !isDdo || bill.status !== 'submitted') return;
    if (!isOnline) {
      pushToast('error', 'বিল অনুমোদন করতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    setActing(true);
    try {
      await approveBillTx(bill.id, { uid: userDoc.id, name: userDoc.name });
      pushToast('success', `বিল নং ${bill.billNo} অনুমোদিত হয়েছে ও বাজেট থেকে কর্তন হয়েছে।`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'বিল অনুমোদন করা যায়নি।');
    } finally {
      setActing(false);
    }
  };

  const handleConfirmReasonAction = async () => {
    if (!userDoc || !isDdo || !selectedBill || !reasonMode) return;
    if (!isOnline) {
      pushToast('error', 'এই কাজটি করতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    if (!reasonText.trim()) {
      pushToast('error', 'কারণ উল্লেখ করা আবশ্যক।');
      return;
    }
    setActing(true);
    try {
      if (reasonMode === 'reject') {
        await rejectBillTx(selectedBill.id, reasonText, {
          uid: userDoc.id,
          name: userDoc.name,
        });
        pushToast('success', `বিল ${selectedBill.billNo} প্রত্যাখ্যাত হয়েছে; আইটেম তালিকায় ফিরে গেছে।`);
      } else {
        await cancelApprovedBillTx(selectedBill.id, reasonText, {
          uid: userDoc.id,
          name: userDoc.name,
        });
        pushToast(
          'success',
          `অনুমোদিত বিল ${selectedBill.billNo} বাতিল হয়েছে; বাজেট ফেরত যোগ হয়েছে।`
        );
      }
      setReasonMode(null);
      setReasonText('');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'কার্যক্রম ব্যর্থ হয়েছে।');
    } finally {
      setActing(false);
    }
  };

  const handleExportPdf = async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      const outcome = await exportBillsPdf({
        bills: filteredBills,
        selectedFy,
        officeName: officeSettings.officeName,
        officeAddress: officeSettings.address,
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
    setExportingExcel(true);
    try {
      const excelRows = filteredBills.map((b) => {
        const head = getHead(b.economicCode, { headName: b.headName, headNameBn: b.headNameBn });
        return {
          'Bill No': b.billNo || 'Draft',
          Date: formatDateDisplay(b.date),
          'Economic Code': b.economicCode,
          Head: head.headName,
          'Head (Bangla)': head.headNameBn,
          'Items Count': b.items.length,
          'Gross (BDT)': fromPaisa(b.grossAmount),
          'VAT %': b.vatRate,
          'VAT (BDT)': fromPaisa(b.vatAmount),
          'IT %': b.itRate,
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

  const actions = (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleExportPdf}
        disabled={exportingPdf}
        title="Export PDF"
        aria-label="Export PDF"
        className="min-h-[44px] md:min-h-[40px] px-2.5 md:px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
      >
        <FileText className="w-4 h-4 shrink-0" />
        <span className="hidden sm:inline">{exportingPdf ? 'PDF…' : 'PDF'}</span>
      </button>
      <button
        type="button"
        onClick={handleExportExcel}
        disabled={exportingExcel}
        title="Export Excel"
        aria-label="Export Excel"
        className="min-h-[44px] md:min-h-[40px] px-2.5 md:px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
      >
        <FileSpreadsheet className="w-4 h-4 shrink-0" />
        <span className="hidden sm:inline">{exportingExcel ? 'Excel…' : 'Excel'}</span>
      </button>
      <Link
        to="/expense-items"
        className="min-h-[44px] md:min-h-[40px] px-3.5 md:px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
      >
        <Plus className="w-4 h-4 shrink-0" />
        <span>খরচ থেকে বিল</span>
      </Link>
    </div>
  );

  const previewDraftRate = useMemo(() => {
    if (!selectedBill || !selectedBillRates) return null;
    const variant =
      selectedBillRates.vat.find((v) => v.key === editDraftVariantKey) || selectedBillRates.vat[0];
    const deductions =
      editDeductions.length > 0
        ? editDeductions
        : [
            {
              id: 'it',
              code: DEFAULT_IT_CODE,
              name: 'ব্যক্তি কর্তৃক দেয় আয়কর',
              rate: selectedBillRates.incomeTax,
              amount: calcPercentageAmount(selectedBill.grossAmount, selectedBillRates.incomeTax),
              kind: 'it' as const,
            },
            {
              id: 'vat',
              code: DEFAULT_VAT_CODE,
              name: 'দেশজ পণ্য ও সেবার ওপর মূসক',
              rate: variant.rate,
              amount: calcPercentageAmount(selectedBill.grossAmount, variant.rate),
              kind: 'vat' as const,
            },
          ];
    const vatAmt = deductions.filter((d) => d.kind === 'vat').reduce((s, d) => s + d.amount, 0);
    const itAmt = deductions.filter((d) => d.kind === 'it').reduce((s, d) => s + d.amount, 0);
    const totalDed = deductions.reduce((s, d) => s + d.amount, 0);
    return {
      vatRate: variant.rate,
      itRate: selectedBillRates.incomeTax,
      deductions,
      vatAmt,
      itAmt,
      totalDed,
      netPayable: selectedBill.grossAmount - totalDed,
    };
  }, [selectedBill, selectedBillRates, editDraftVariantKey, editDeductions]);

  return (
    <Layout title={t('navBills')} actions={actions}>
      <div className="space-y-3.5 md:space-y-4">
        {!isOnline && (
          <div className="px-3.5 py-2.5 rounded-[14px] bg-[var(--warn-bg)] text-[var(--warn-text)] text-xs font-medium flex items-center gap-2">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>
              অফলাইন মোড: বিল জমা (Submit), অনুমোদন (Approve), প্রত্যাখ্যান বা বাতিল করতে ইন্টারনেট সংযোগ চালু করুন।
            </span>
          </div>
        )}

        {/* Filter Bar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 md:gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {(['all', 'draft', 'submitted', 'approved', 'rejected', 'cancelled'] as const).map(
              (st) => {
                const active = statusFilter === st;
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => {
                      setStatusFilter(st);
                      setPage(1);
                      if (st === 'all') searchParams.delete('status');
                      else searchParams.set('status', st);
                      setSearchParams(searchParams, { replace: true });
                    }}
                    className={`min-h-[44px] md:min-h-[38px] px-3.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                        : 'bg-[var(--card)] border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    {t(st)}
                  </button>
                );
              }
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
            <div className="w-full sm:w-64">
              <EconomicCodeSelect
                value={codeFilter}
                onChange={(code) => {
                  setCodeFilter(code);
                  setPage(1);
                }}
                placeholder="সকল অর্থনৈতিক কোড"
                clearable
                includeInactive
              />
            </div>
            <div className="relative w-full sm:w-60">
              <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="বিল নং, খাত, আইটেম…"
                aria-label="Search bills"
                className="w-full min-h-[48px] sm:min-h-[44px] pl-9 pr-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
          </div>
        </div>

        {/* Bills List Card */}
        <div className="card-surface overflow-hidden">
          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-[var(--line)]">
            {loading ? (
              <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                বিল তালিকা লোড হচ্ছে…
              </div>
            ) : pagedBills.length === 0 ? (
              <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                {t('noDataFound')}
              </div>
            ) : (
              pagedBills.map((b) => {
                const head = getHead(b.economicCode, {
                  headName: b.headName,
                  headNameBn: b.headNameBn,
                });
                return (
                  <div
                    key={b.id}
                    onClick={() => setSelectedBillId(b.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedBillId(b.id);
                      }
                    }}
                    className="w-full text-left p-3.5 space-y-2 hover:bg-[var(--surface-subtle)] active:bg-[var(--surface-subtle)] transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
                          <span className="font-bold text-[var(--text)] tabular-nums">
                            {b.billNo || 'খসড়া (Draft)'}
                          </span>
                          <span className="tabular-nums">· {formatDateDisplay(b.date)}</span>
                          <span>· {b.items.length}টি আইটেম</span>
                        </div>
                        <div className="text-sm font-medium text-[var(--text)] mt-1 break-words">
                          <span className="tabular-nums font-semibold">{b.economicCode}</span>{' '}
                          {head.headName}
                        </div>
                        {head.headNameBn && (
                          <div className="bn mt-0.5 break-words">{head.headNameBn}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <StatusChip variant={billStatusToChip(b.status)}>{t(b.status)}</StatusChip>
                        <ChevronRight className="w-4 h-4 text-[var(--muted)]" />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-1.5 border-t border-[var(--line)]/60 text-xs">
                      <div className="min-w-0">
                        <div className="text-[11px] text-[var(--muted)]">{t('gross')}</div>
                        <div className="font-medium tabular-nums truncate">
                          {formatNumberIN(b.grossAmount)}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] text-[var(--muted)]">মোট কর্তন</div>
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

                    <div
                      className="flex flex-wrap items-center justify-end gap-1.5 pt-1.5 border-t border-[var(--line)]/40"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => setTr21BillId(b.id)}
                        className="min-h-[36px] px-2.5 rounded-md border border-[var(--accent)] text-[var(--accent)] text-[11px] font-semibold inline-flex items-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>ফর্ম (টি.আর. ২১)</span>
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(tr21Busy)}
                        onClick={() => handleDirectTr21Output(b, 'pdf')}
                        className="min-h-[36px] px-2.5 rounded-md border border-[var(--line)] bg-[var(--card)] text-[11px] font-medium inline-flex items-center gap-1 disabled:opacity-60"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        <span>PDF</span>
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(tr21Busy)}
                        onClick={() => handleDirectTr21Output(b, 'docx')}
                        className="min-h-[36px] px-2.5 rounded-md border border-[var(--line)] bg-[var(--card)] text-[11px] font-medium inline-flex items-center gap-1 disabled:opacity-60"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Word</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
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
                  <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                    ফর্ম (টি.আর. ২১)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                      বিল তালিকা লোড হচ্ছে…
                    </td>
                  </tr>
                ) : pagedBills.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                      {t('noDataFound')}
                    </td>
                  </tr>
                ) : (
                  pagedBills.map((b) => {
                    const head = getHead(b.economicCode, {
                      headName: b.headName,
                      headNameBn: b.headNameBn,
                    });
                    return (
                      <tr
                        key={b.id}
                        onClick={() => setSelectedBillId(b.id)}
                        className="group cursor-pointer hover:bg-[var(--surface-subtle)] transition-colors"
                      >
                        <td className="sticky left-0 z-10 bg-[var(--card)] group-hover:bg-[var(--surface-subtle)] py-3 px-4 font-semibold tabular-nums whitespace-nowrap transition-colors">
                          {b.billNo || <span className="text-[var(--muted)] font-normal">খসড়া</span>}
                        </td>
                        <td className="py-3 px-4 tabular-nums whitespace-nowrap text-[var(--muted)]">
                          {formatDateDisplay(b.date)}
                        </td>
                        <td className="py-3 px-4 min-w-[200px]">
                          <div className="font-medium text-[var(--text)]">
                            <span className="tabular-nums">{b.economicCode}</span> {head.headName}
                          </div>
                          {head.headNameBn && <div className="bn">{head.headNameBn}</div>}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums">{b.items.length}</td>
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
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setTr21BillId(b.id)}
                              title="টি.আর. ফরম নং-২১ প্রিভিউ"
                              className="min-h-[32px] px-2 rounded-md border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-soft)] text-xs font-semibold inline-flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>প্রিভিউ</span>
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(tr21Busy)}
                              onClick={() => handleDirectTr21Output(b, 'print')}
                              title="Print"
                              aria-label="Print T.R. Form 21"
                              className="min-h-[32px] px-2 rounded-md border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--bg)] text-xs inline-flex items-center justify-center disabled:opacity-60"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(tr21Busy)}
                              onClick={() => handleDirectTr21Output(b, 'pdf')}
                              title="PDF"
                              aria-label="Export T.R. Form 21 PDF"
                              className="min-h-[32px] px-2 rounded-md border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--bg)] text-xs inline-flex items-center justify-center disabled:opacity-60"
                            >
                              <FileDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(tr21Busy)}
                              onClick={() => handleDirectTr21Output(b, 'docx')}
                              title="Word (.docx)"
                              aria-label="Export T.R. Form 21 Word"
                              className="min-h-[32px] px-2 rounded-md border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--bg)] text-xs inline-flex items-center justify-center disabled:opacity-60"
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <Pagination page={page} totalItems={filteredBills.length} onPageChange={setPage} />
        </div>
      </div>

      {/* Bill Detail & Workflow Modal */}
      <Modal
        open={Boolean(selectedBill)}
        onClose={() => setSelectedBillId(null)}
        title={
          selectedBill
            ? selectedBill.billNo
              ? `বিল নং ${selectedBill.billNo}`
              : 'খসড়া বিল (Draft)'
            : ''
        }
        subtitle={
          selectedBill
            ? `${selectedBill.economicCode} · ${formatDateDisplay(selectedBill.date)}`
            : ''
        }
        fullScreenOnMobile
        maxWidthClass="md:max-w-2xl"
      >
        {selectedBill && (
          <div className="space-y-4">
            {/* Status & Head Header */}
            <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-[var(--line)]">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--text)]">
                  <span className="tabular-nums">{selectedBill.economicCode}</span>{' '}
                  {
                    getHead(selectedBill.economicCode, {
                      headName: selectedBill.headName,
                      headNameBn: selectedBill.headNameBn,
                    }).headName
                  }
                </div>
                {getHead(selectedBill.economicCode, {
                  headName: selectedBill.headName,
                  headNameBn: selectedBill.headNameBn,
                }).headNameBn && (
                  <div className="bn mt-0.5">
                    {
                      getHead(selectedBill.economicCode, {
                        headName: selectedBill.headName,
                        headNameBn: selectedBill.headNameBn,
                      }).headNameBn
                    }
                  </div>
                )}
                {selectedBill.createdByName && (
                  <div className="text-xs text-[var(--muted)] mt-1">
                    প্রস্তুতকারী: {selectedBill.createdByName}
                  </div>
                )}
              </div>
              <StatusChip variant={billStatusToChip(selectedBill.status)}>
                {t(selectedBill.status)}
              </StatusChip>
            </div>

            {/* T.R. Form No. 21 Quick Actions Bar */}
            <div className="p-3 rounded-xl bg-[var(--accent-soft)]/50 border border-[var(--accent)]/30 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-[var(--text)]">
                টি.আর. ফরম নং-২১ (সংযুক্ত সরকারি বিল ফর্ম · {selectedBill.status === 'draft' ? 'খসড়া ওয়াটারমার্কসহ' : 'চূড়ান্ত ফরম'})
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setTr21BillId(selectedBill.id)}
                  className="min-h-[38px] px-3 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>প্রিভিউ</span>
                </button>
                <button
                  type="button"
                  disabled={Boolean(tr21Busy)}
                  onClick={() => handleDirectTr21Output(selectedBill, 'print')}
                  className="min-h-[38px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-60"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
                <button
                  type="button"
                  disabled={Boolean(tr21Busy)}
                  onClick={() => handleDirectTr21Output(selectedBill, 'pdf')}
                  className="min-h-[38px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-60"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  disabled={Boolean(tr21Busy)}
                  onClick={() => handleDirectTr21Output(selectedBill, 'docx')}
                  className="min-h-[38px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-60"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Word</span>
                </button>
              </div>
            </div>

            {/* Reject / Cancel Reason Banners */}
            {selectedBill.status === 'rejected' && selectedBill.rejectReason && (
              <div className="p-3 rounded-lg bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs space-y-1">
                <div className="font-bold">প্রত্যাখ্যানের কারণ:</div>
                <div className="bn">{selectedBill.rejectReason}</div>
              </div>
            )}
            {selectedBill.status === 'cancelled' && selectedBill.cancelReason && (
              <div className="p-3 rounded-lg bg-[var(--surface-subtle)] border border-[var(--line)] text-xs space-y-1">
                <div className="font-bold text-[var(--text)]">বাতিলের কারণ:</div>
                <div className="bn text-[var(--muted)]">{selectedBill.cancelReason}</div>
              </div>
            )}

            {/* Itemized Expense List */}
            <div>
              <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
                অন্তর্ভুক্ত খরচ আইটেমসমূহ ({selectedBill.items.length}টি)
              </h3>
              <div className="rounded-xl border border-[var(--line)] divide-y divide-[var(--line)]">
                {selectedBill.items.map((it) => (
                  <div key={it.id} className="p-3 flex items-start justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium bn text-[var(--text)] break-words">
                        {it.description}
                      </div>
                      <div className="text-[var(--muted)] mt-0.5">
                        <span className="tabular-nums">{formatDateDisplay(it.date)}</span> ·{' '}
                        <span className="bn">{it.responsibleEmployee.name}</span>
                        {it.responsibleEmployee.designation
                          ? ` (${it.responsibleEmployee.designation})`
                          : ''}
                      </div>
                    </div>
                    <div className="font-semibold tabular-nums shrink-0">
                      {formatTaka(it.amount)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Draft Edit VAT Variant, TR 21 Metadata & Custom Deductions */}
            {selectedBill.status === 'draft' && selectedBillRates && (
              <div className="p-3.5 rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)] space-y-3">
                <div className="text-xs font-semibold text-[var(--text)]">
                  খসড়া বিল সম্পাদনা (তারিখ, ভ্যাট/কর্তন ও টি.আর. ২১ তথ্য)
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-[var(--muted)] mb-1">তারিখ</label>
                    <input
                      type="date"
                      value={editDraftDate}
                      onChange={(e) => setEditDraftDate(e.target.value)}
                      className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--muted)] mb-1">
                      টোকেন নং (ঐচ্ছিক)
                    </label>
                    <input
                      type="text"
                      value={editTokenNo}
                      onChange={(e) => setEditTokenNo(e.target.value)}
                      placeholder="টোকেন নং"
                      className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--muted)] mb-1">
                      ভ্যাটের ধরন ({previewDraftRate?.vatRate ?? selectedBill.vatRate}%)
                    </label>
                    <select
                      value={editDraftVariantKey}
                      onChange={(e) => {
                        const key = e.target.value;
                        setEditDraftVariantKey(key);
                        const chosen =
                          selectedBillRates.vat.find((v) => v.key === key) ||
                          selectedBillRates.vat[0];
                        if (chosen) {
                          setEditDeductions((prev) =>
                            prev.map((d) =>
                              d.kind === 'vat'
                                ? {
                                    ...d,
                                    rate: chosen.rate,
                                    amount: calcPercentageAmount(
                                      selectedBill.grossAmount,
                                      chosen.rate
                                    ),
                                  }
                                : d
                            )
                          );
                        }
                      }}
                      className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs"
                    >
                      {selectedBillRates.vat.map((v) => (
                        <option key={v.key} value={v.key}>
                          {v.label} ({v.rate}%)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-[var(--muted)] mb-1">
                    ব্যয়ের উদ্দেশ্য (টি.আর. ২১ বিবরণ)
                  </label>
                  <input
                    type="text"
                    value={editPurposeText}
                    onChange={(e) => setEditPurposeText(e.target.value)}
                    placeholder="যেমন: ময়মনসিংহ জেলা কার্যালয়ের আসবাবপত্র ক্রয় বাবদ বিল।"
                    className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs bn"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-[var(--muted)] mb-1">
                      যার নামে চেক ইস্যু করা হবে (ধারা ১২)
                    </label>
                    <input
                      type="text"
                      value={editPayeeText}
                      onChange={(e) => setEditPayeeText(e.target.value)}
                      placeholder="সহকারী পরিচালক, জেলা উপানুষ্ঠানিক শিক্ষা ব্যুরো..."
                      className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs bn"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--muted)] mb-1">
                      প্রদেয় কোড (ক-খ)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editNetPayableCode}
                      onChange={(e) =>
                        setEditNetPayableCode(e.target.value.replace(/\D+/g, '').slice(0, 10))
                      }
                      className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs tabular-nums"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={editSupplierName}
                    onChange={(e) => setEditSupplierName(e.target.value)}
                    placeholder="সরবরাহকারীর নাম (ঐচ্ছিক)"
                    className="w-full min-h-[40px] px-2.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs bn"
                  />
                  <input
                    type="text"
                    value={editSupplierAddress}
                    onChange={(e) => setEditSupplierAddress(e.target.value)}
                    placeholder="ঠিকানা (ঐচ্ছিক)"
                    className="w-full min-h-[40px] px-2.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs bn"
                  />
                  <input
                    type="text"
                    value={editSupplierTinBin}
                    onChange={(e) => setEditSupplierTinBin(e.target.value)}
                    placeholder="TIN/BIN (ঐচ্ছিক)"
                    className="w-full min-h-[40px] px-2.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs tabular-nums"
                  />
                </div>

                {/* Editable Deduction Rows */}
                <div className="space-y-2 pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-[var(--muted)]">
                      কর্তনের সারি সমূহ (কোড, বিবরণ, হার %, টাকা)
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {!editDeductions.some((d) => d.code === DEFAULT_SECURITY_CODE) && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditDeductions((prev) => [
                              ...prev,
                              {
                                id: `sec_${Date.now()}`,
                                code: DEFAULT_SECURITY_CODE,
                                name: 'ঠিকাদারের নিরাপত্তা জমা',
                                rate: null,
                                amount: 0,
                                kind: 'security',
                              },
                            ])
                          }
                          className="min-h-[30px] px-2 rounded border border-[var(--line)] bg-[var(--card)] text-[11px] font-medium"
                        >
                          + নিরাপত্তা জমা (8113301)
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setEditDeductions((prev) => [
                            ...prev,
                            {
                              id: `ded_${Date.now()}`,
                              code: '',
                              name: '',
                              rate: null,
                              amount: 0,
                              kind: 'other',
                            },
                          ])
                        }
                        className="min-h-[30px] px-2 rounded border border-[var(--accent)] text-[var(--accent)] text-[11px] font-semibold"
                      >
                        + নতুন কর্তন
                      </button>
                    </div>
                  </div>

                  {editDeductions.map((d, dIdx) => (
                    <div
                      key={d.id}
                      className="p-2 rounded-lg bg-[var(--card)] border border-[var(--line)] grid grid-cols-12 gap-1.5 items-center"
                    >
                      <div className="col-span-4 sm:col-span-2">
                        <input
                          type="text"
                          value={d.code}
                          onChange={(e) =>
                            setEditDeductions((prev) =>
                              prev.map((row, i) => (i === dIdx ? { ...row, code: e.target.value } : row))
                            )
                          }
                          placeholder="কোড"
                          className="w-full min-h-[36px] px-2 rounded border border-[var(--line)] bg-[var(--bg)] text-base md:text-xs tabular-nums"
                        />
                      </div>
                      <div className="col-span-8 sm:col-span-5">
                        <input
                          type="text"
                          value={d.name}
                          onChange={(e) =>
                            setEditDeductions((prev) =>
                              prev.map((row, i) => (i === dIdx ? { ...row, name: e.target.value } : row))
                            )
                          }
                          placeholder="বিবরণ"
                          className="w-full min-h-[36px] px-2 rounded border border-[var(--line)] bg-[var(--bg)] text-base md:text-xs bn"
                        />
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={d.rate ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const nextRate = raw === '' ? null : Number(raw);
                            setEditDeductions((prev) =>
                              prev.map((row, i) =>
                                i === dIdx
                                  ? {
                                      ...row,
                                      rate: nextRate,
                                      amount:
                                        nextRate !== null && Number.isFinite(nextRate)
                                          ? calcPercentageAmount(selectedBill.grossAmount, nextRate)
                                          : row.amount,
                                    }
                                  : row
                              )
                            );
                          }}
                          placeholder="%"
                          className="w-full min-h-[36px] px-2 rounded border border-[var(--line)] bg-[var(--bg)] text-base md:text-xs tabular-nums"
                        />
                      </div>
                      <div className="col-span-6 sm:col-span-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={formatPaisaInput(d.amount)}
                          onChange={(e) => {
                            const nextPaisa = toPaisa(e.target.value);
                            setEditDeductions((prev) =>
                              prev.map((row, i) =>
                                i === dIdx
                                  ? {
                                      ...row,
                                      amount: Number.isFinite(nextPaisa) && nextPaisa >= 0 ? nextPaisa : 0,
                                    }
                                  : row
                              )
                            );
                          }}
                          placeholder="টাকা"
                          className="w-full min-h-[36px] px-2 rounded border border-[var(--line)] bg-[var(--bg)] text-base md:text-xs tabular-nums text-right"
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-1 flex justify-end">
                        {editDeductions.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setEditDeductions((prev) => prev.filter((_, i) => i !== dIdx))
                            }
                            aria-label="Remove deduction"
                            className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={savingDraftEdit}
                    onClick={handleSaveDraftRates}
                    className="min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs font-semibold hover:bg-[var(--bg)] disabled:opacity-60"
                  >
                    {savingDraftEdit ? 'সংরক্ষণ হচ্ছে…' : 'হার ও ফর্ম তথ্য সংরক্ষণ করুন'}
                  </button>
                </div>
              </div>
            )}

            {/* Financial Deduction Summary */}
            <div className="p-3.5 rounded-xl bg-[var(--surface-subtle)] space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">মোট বিল (Gross Amount)</span>
                <span className="font-bold tabular-nums">
                  {formatTaka(selectedBill.grossAmount)}
                </span>
              </div>
              {(() => {
                const displayDeductions =
                  selectedBill.status === 'draft' && previewDraftRate
                    ? previewDraftRate.deductions
                    : Array.isArray(selectedBill.deductions) && selectedBill.deductions.length > 0
                    ? selectedBill.deductions
                    : [
                        {
                          id: 'vat',
                          code: DEFAULT_VAT_CODE,
                          name: `ভ্যাট${selectedBill.vatVariantLabel ? ` · ${selectedBill.vatVariantLabel}` : ''}`,
                          rate: selectedBill.vatRate,
                          amount: selectedBill.vatAmount,
                        },
                        {
                          id: 'it',
                          code: DEFAULT_IT_CODE,
                          name: 'আয়কর / IT',
                          rate: selectedBill.itRate,
                          amount: selectedBill.itAmount,
                        },
                      ];
                return displayDeductions.map((d) => (
                  <div key={d.id} className="flex justify-between gap-2">
                    <span className="text-[var(--muted)] bn">
                      {d.code ? `${d.code} · ` : ''}
                      {d.name}
                      {typeof d.rate === 'number' && d.rate > 0 ? ` (${d.rate}%)` : ''}
                    </span>
                    <span className="tabular-nums shrink-0">− {formatTaka(d.amount)}</span>
                  </div>
                ));
              })()}
              <div className="flex justify-between border-t border-[var(--line)] pt-2">
                <span className="font-semibold text-[var(--text)]">মোট কর্তন (Total Deduction)</span>
                <span className="font-semibold tabular-nums">
                  {formatTaka(selectedBill.status === 'draft' && previewDraftRate ? previewDraftRate.totalDed : selectedBill.totalDeduction)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="font-bold text-[var(--text)]">নিট প্রদেয় (Net Payable)</span>
                <span className="font-bold text-[var(--accent)] tabular-nums">
                  {formatTaka(selectedBill.status === 'draft' && previewDraftRate ? previewDraftRate.netPayable : selectedBill.netPayable)}
                </span>
              </div>
            </div>

            {/* Live Budget & Cap Availability Box for Draft/Submitted */}
            {(selectedBill.status === 'draft' || selectedBill.status === 'submitted') &&
              selectedBillAvailability && (
                <div
                  className={`p-3 rounded-xl border text-xs space-y-1 ${
                    selectedBillAvailability.allowed
                      ? 'bg-[var(--card)] border-[var(--line)]'
                      : 'bg-[var(--danger-bg)] border-[var(--danger-text)]/40 text-[var(--danger-text)]'
                  }`}
                >
                  <div className="font-semibold flex items-center gap-1.5">
                    {!selectedBillAvailability.allowed && (
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                    )}
                    <span>
                      বাজেট যাচাই ({selectedBill.economicCode}):{' '}
                      {selectedBillAvailability.allowed
                        ? 'অনুমোদনযোগ্য'
                        : 'বাজেট/সীমা অতিক্রম করেছে'}
                    </span>
                  </div>
                  <div className="tabular-nums">
                    বরাদ্দ {formatTaka(selectedBillAvailability.allocation)} · অনুমোদিত{' '}
                    {formatTaka(selectedBillAvailability.approvedSpent)} · উপলব্ধ{' '}
                    {formatTaka(selectedBillAvailability.available)}
                  </div>
                  {!selectedBillAvailability.allowed && (
                    <div className="font-medium">
                      {selectedBillAvailability.limitingConstraint.exceededMessage}
                    </div>
                  )}
                </div>
              )}

            {/* Reason input for Reject / Cancel */}
            {reasonMode && (
              <div className="p-3.5 rounded-xl border border-[var(--danger-text)]/40 bg-[var(--danger-bg)]/30 space-y-2.5">
                <label className="block text-xs font-semibold text-[var(--text)]">
                  {reasonMode === 'reject'
                    ? 'প্রত্যাখ্যানের কারণ (বাধ্যতামূলক)'
                    : 'অনুমোদিত বিল বাতিলের কারণ (বাধ্যতামূলক)'}
                </label>
                <textarea
                  rows={2}
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  placeholder="কারণ লিখুন…"
                  className="w-full p-2.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs bn"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setReasonMode(null);
                      setReasonText('');
                    }}
                    className="min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs font-medium"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="button"
                    disabled={acting || !reasonText.trim() || !isOnline}
                    onClick={handleConfirmReasonAction}
                    className="min-h-[40px] px-4 rounded-lg bg-[var(--danger-text)] text-white text-xs font-semibold disabled:opacity-60"
                  >
                    {acting
                      ? 'সম্পন্ন হচ্ছে…'
                      : reasonMode === 'reject'
                      ? 'প্রত্যাখ্যান নিশ্চিত করুন'
                      : 'বিল বাতিল নিশ্চিত করুন'}
                  </button>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--line)]">
              {selectedBill.status === 'draft' && (
                <>
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => handleDeleteDraft(selectedBill)}
                    className="min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40 inline-flex items-center gap-1.5"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>খসড়া মুছুন</span>
                  </button>
                  <button
                    type="button"
                    disabled={acting || !isOnline}
                    onClick={() => handleSubmitDraft(selectedBill)}
                    className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
                  >
                    {acting ? 'জমা হচ্ছে…' : 'জমা দিন (Submit)'}
                  </button>
                </>
              )}

              {selectedBill.status === 'submitted' && (
                <>
                  {isDdo ? (
                    <div className="w-full flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        disabled={acting || !isOnline}
                        onClick={() => setReasonMode('reject')}
                        className="min-h-[44px] px-4 rounded-lg border border-[var(--danger-text)]/50 text-[var(--danger-text)] text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>{t('reject')}</span>
                      </button>
                      <button
                        type="button"
                        disabled={acting || !isOnline || !selectedBillAvailability?.allowed}
                        onClick={() => handleApproveBill(selectedBill)}
                        className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{acting ? 'অনুমোদন হচ্ছে…' : t('approve')}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="w-full p-2.5 rounded-lg bg-[var(--surface-subtle)] text-xs text-[var(--muted)] flex items-center gap-2">
                      <Lock className="w-4 h-4 shrink-0" />
                      <span>শুধুমাত্র DDO এই বিলটি অনুমোদন বা প্রত্যাখ্যান করতে পারবেন।</span>
                    </div>
                  )}
                </>
              )}

              {selectedBill.status === 'approved' && (
                <div className="w-full flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
                    <Lock className="w-3.5 h-3.5" />
                    <span>অনুমোদিত বিল অপরিবর্তনীয় (Immutable)</span>
                  </div>
                  {isDdo && !reasonMode && (
                    <button
                      type="button"
                      disabled={acting || !isOnline}
                      onClick={() => setReasonMode('cancel')}
                      className="min-h-[44px] px-4 rounded-lg border border-[var(--danger-text)]/50 text-[var(--danger-text)] text-xs font-semibold hover:bg-[var(--danger-bg)]/40 disabled:opacity-60"
                    >
                      {t('cancelBill')}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Audit Trail */}
            <div className="border-t border-[var(--line)] pt-3">
              <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1">
                {t('activity')}
              </h3>
              <ActivityList logs={billLogs} loading={logsLoading} />
            </div>
          </div>
        )}
      </Modal>

      <BillFormPreviewModal
        open={Boolean(tr21Bill && tr21FormData)}
        onClose={() => setTr21BillId(null)}
        bill={tr21Bill}
        formData={tr21FormData}
      />
    </Layout>
  );
}
