import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, type Timestamp } from 'firebase/firestore';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Eye,
  FileDown,
  FileText,
  Lock,
  Printer,
  Send,
  Trash2,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Modal, ModalFooter } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { StatusChip, type ChipVariant } from '../components/StatusChip';
import { Timeline, type TimelineStep } from '../components/Timeline';
import { ActivityList } from '../components/ActivityList';
import { Banner, Field, Select, Textarea, focusFirstInvalidField } from '../components/form';
import { BillFormPreviewModal } from '../components/BillFormPreviewModal';
import { SubmitBillModal, type SubmitBillFormValues } from '../components/SubmitBillModal';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { ALL_OFFICES_ID, LEGACY_UNMIGRATED_OFFICE_ID, useApp } from '../contexts/AppContext';
import { useFyData } from '../hooks/useFyData';
import { useEconomicCodes } from '../hooks/useEconomicCodes';
import { useDocAuditLogs } from '../hooks/useAuditLogs';
import {
  formatActorBrief,
  formatApprovedByLine,
  getActorUid,
  isActorSnapshot,
} from '../lib/actor';
import {
  buildTr21FormData,
  buildTr21IntroText,
  formatVoucherNoForTr21,
  resolveBillPrimaryBudget,
  sanitizeBillFileSegment,
} from '../lib/billFormData';
import { computeCodeAvailable } from '../lib/computeAvailable';
import { formatDateDisplay } from '../lib/dates';
import {
  approveBillTx,
  cancelApprovedBillTx,
  correctApprovedBillTx,
  deleteDraftBill,
  rejectBillTx,
  softDeleteApprovedBillTx,
  submitBillTx,
  updateDraftBillRates,
} from '../lib/firestoreOps';
import {
  calcPercentageAmount,
  computeGrossedUpBill,
  formatPaisaInput,
  formatTaka,
  toPaisa,
} from '../lib/money';
import {
  canApproveRejectCancelBill,
  canCreateDraftBill,
  canEditDeleteApprovedSpending,
} from '../lib/permissions';
import {
  DEFAULT_IT_CODE,
  DEFAULT_NET_PAYABLE_CODE,
  DEFAULT_SECURITY_CODE,
  DEFAULT_VAT_CODE,
} from '../lib/tr21Defaults';
import { toBanglaDigits } from '../lib/banglaFormat';
import { exportTr21Docx, exportTr21Pdf, printTr21Form } from '../utils/exportTr21';
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

function formatTimestampDisplay(ts?: Timestamp | null, fallbackDate?: string): string {
  if (ts && typeof ts.toDate === 'function') {
    const d = ts.toDate();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} · ${hh}:${min}`;
  }
  return fallbackDate ? formatDateDisplay(fallbackDate) : '';
}

export function BillDetailPage() {
  const { billId } = useParams<{ billId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { userDoc, isSuperAdmin } = useAuth();
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

  const [fallbackFy, setFallbackFy] = useState<string | null>(null);
  const effectiveFy = fallbackFy || selectedFy;

  const { budgets, bills, vatTaxRates, spendingLimits, fyCodeTotals, loading } =
    useFyData(effectiveFy);
  const { getHead } = useEconomicCodes();

  const fromSearch = (location.state as { fromSearch?: string } | null)?.fromSearch || '';
  const backTo = `/bills${fromSearch}`;

  const matchedBill = useMemo(
    () => (billId ? bills.find((b) => b.id === billId) || null : null),
    [bills, billId]
  );

  const [fallbackBill, setFallbackBill] = useState<BillDoc | null>(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    setFallbackBill(null);
    setFallbackFy(null);
  }, [billId]);

  useEffect(() => {
    if (!billId || loading || matchedBill) return;
    let active = true;
    setFallbackLoading(true);
    getDoc(doc(db, 'bills', billId))
      .then((snap) => {
        if (!active) return;
        if (!snap.exists()) {
          setFallbackBill(null);
          return;
        }
        const data = { id: snap.id, ...snap.data() } as BillDoc;
        if (data.deleted) {
          setFallbackBill(null);
          return;
        }
        setFallbackBill(data);
        if (data.fiscalYear && data.fiscalYear !== effectiveFy) {
          setFallbackFy(data.fiscalYear);
        }
      })
      .catch(() => {
        if (active) setFallbackBill(null);
      })
      .finally(() => {
        if (active) setFallbackLoading(false);
      });
    return () => {
      active = false;
    };
  }, [billId, loading, matchedBill, reloadTick, effectiveFy]);

  const bill = matchedBill || fallbackBill;
  const { logs: billLogs, loading: logsLoading } = useDocAuditLogs('bills', bill?.id || null);

  const realOfficeId =
    currentOfficeId &&
    currentOfficeId !== ALL_OFFICES_ID &&
    currentOfficeId !== LEGACY_UNMIGRATED_OFFICE_ID
      ? currentOfficeId
      : '';

  const permCtx = { isSuperAdmin, officeRole: currentOfficeRole };
  const isDdo =
    !isAllOfficesMode &&
    !isLegacyPreMigration &&
    Boolean(realOfficeId) &&
    canApproveRejectCancelBill(permCtx);
  const canDraftBill =
    !isAllOfficesMode &&
    !isLegacyPreMigration &&
    Boolean(realOfficeId) &&
    canCreateDraftBill(permCtx);
  const canSuperCorrect =
    !isAllOfficesMode &&
    !isLegacyPreMigration &&
    Boolean(realOfficeId) &&
    canEditDeleteApprovedSpending(permCtx);

  const effectiveActor =
    actorSnapshot || (userDoc ? { uid: userDoc.id, name: userDoc.name } : null);

  const canModifyDraft = (b: BillDoc) =>
    !isSuperAdmin &&
    !isAllOfficesMode &&
    !isLegacyPreMigration &&
    Boolean(realOfficeId) &&
    b.status === 'draft' &&
    (isDdo || !b.createdBy || getActorUid(b.createdBy) === userDoc?.id);

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

  // Draft / SuperAdmin Edit state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editDraftDate, setEditDraftDate] = useState('');
  const [editDraftVariantKey, setEditDraftVariantKey] = useState('');
  const [editVoucherNo, setEditVoucherNo] = useState('');
  const [editTokenNo, setEditTokenNo] = useState('');
  const [editPurposeText, setEditPurposeText] = useState('');
  const [editPayeeText, setEditPayeeText] = useState('');
  const [editNetPayableCode, setEditNetPayableCode] = useState(DEFAULT_NET_PAYABLE_CODE);
  const [editSupplierName, setEditSupplierName] = useState('');
  const [editSupplierAddress, setEditSupplierAddress] = useState('');
  const [editSupplierTinBin, setEditSupplierTinBin] = useState('');
  const [editDeductions, setEditDeductions] = useState<BillDeductionLine[]>([]);
  const [savingDraftEdit, setSavingDraftEdit] = useState(false);

  // T.R. 21 Preview & direct export
  const [tr21PreviewOpen, setTr21PreviewOpen] = useState(false);
  const [tr21Busy, setTr21Busy] = useState<'print' | 'pdf' | 'docx' | null>(null);

  // Workflow Modals
  const [acting, setActing] = useState(false);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [deleteDraftOpen, setDeleteDraftOpen] = useState(false);
  const [reasonMode, setReasonMode] = useState<'reject' | 'cancel' | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [superCorrectMode, setSuperCorrectMode] = useState<'edit' | 'delete' | null>(null);
  const [superReason, setSuperReason] = useState('');

  useEffect(() => {
    if (!bill) return;
    setEditDraftDate(bill.billDate || bill.date);
    setEditDraftVariantKey(bill.vatVariant || 'default');
    setEditVoucherNo(bill.voucherNo || '');
    setEditTokenNo(bill.tokenNo || '');
    setEditPurposeText(bill.purposeText || '');
    setEditPayeeText(bill.payeeText || officeSettings.defaultPayeeText || '');
    setEditNetPayableCode(
      bill.netPayableCode || officeSettings.defaultNetPayableCode || DEFAULT_NET_PAYABLE_CODE
    );
    setEditSupplierName(bill.supplier?.name || '');
    setEditSupplierAddress(bill.supplier?.address || '');
    setEditSupplierTinBin(bill.supplier?.tinBin || '');
    setEditDeductions(
      Array.isArray(bill.deductions) && bill.deductions.length > 0
        ? bill.deductions.map((d) => ({ ...d }))
        : [
            {
              id: 'it',
              code: officeSettings.defaultItCode || DEFAULT_IT_CODE,
              name: 'ব্যক্তি কর্তৃক দেয় আয়কর',
              rate: bill.itRate,
              amount: bill.itAmount,
              kind: 'it',
            },
            {
              id: 'vat',
              code: officeSettings.defaultVatCode || DEFAULT_VAT_CODE,
              name: 'দেশজ পণ্য ও সেবার ওপর মূসক',
              rate: bill.vatRate,
              amount: bill.vatAmount,
              kind: 'vat',
            },
          ]
    );
  }, [
    bill,
    officeSettings.defaultPayeeText,
    officeSettings.defaultNetPayableCode,
    officeSettings.defaultItCode,
    officeSettings.defaultVatCode,
  ]);

  const billRates = useMemo(() => {
    if (!bill) return null;
    const fyRate = vatTaxRates.find((r) => r.economicCode === bill.economicCode);
    if (fyRate && fyRate.vat.length > 0) {
      return { incomeTax: fyRate.incomeTax, vat: fyRate.vat };
    }
    const activeBudget = budgets.find(
      (b) => b.economicCode === bill.economicCode && b.status === 'active'
    );
    if (activeBudget && activeBudget.deductionRates.vat.length > 0) {
      return {
        incomeTax: activeBudget.deductionRates.incomeTax,
        vat: activeBudget.deductionRates.vat,
      };
    }
    return {
      incomeTax: bill.itRate,
      vat: [
        {
          key: bill.vatVariant || 'default',
          label: bill.vatVariantLabel || 'Standard',
          rate: bill.vatRate,
        },
      ],
    };
  }, [bill, vatTaxRates, budgets]);

  const billExpenseTotal = useMemo(() => {
    if (!bill) return 0;
    return bill.items.reduce((s, it) => s + it.amount, 0);
  }, [bill]);

  const previewDraftRate = useMemo(() => {
    if (!bill || !billRates) return null;
    const variant = billRates.vat.find((v) => v.key === editDraftVariantKey) || billRates.vat[0];
    const hasItems = bill.items.length > 0 && billExpenseTotal > 0;

    if (hasItems) {
      try {
        const calc = computeGrossedUpBill({
          expenseTotalPaisa: billExpenseTotal,
          vatRate: variant.rate,
          itRate: billRates.incomeTax,
          customDeductions: editDeductions.length > 0 ? editDeductions : undefined,
          defaultItCode: officeSettings.defaultItCode || DEFAULT_IT_CODE,
          defaultVatCode: officeSettings.defaultVatCode || DEFAULT_VAT_CODE,
        });
        return {
          grossAmount: calc.grossAmount,
          vatRate: calc.effectiveVatRate,
          itRate: calc.effectiveItRate,
          totalPercentRate: calc.totalPercentRate,
          deductions: calc.deductions,
          vatAmt: calc.vatAmount,
          itAmt: calc.itAmount,
          totalDed: calc.totalDeduction,
          netPayable: calc.netPayable,
          rateError: '',
        };
      } catch (err) {
        return {
          grossAmount: bill.grossAmount,
          vatRate: variant.rate,
          itRate: billRates.incomeTax,
          totalPercentRate: 0,
          deductions: editDeductions,
          vatAmt: 0,
          itAmt: 0,
          totalDed: 0,
          netPayable: bill.grossAmount,
          rateError:
            err instanceof Error ? err.message : 'মোট কর্তনের হার ১০০% বা তার বেশি হতে পারে না।',
        };
      }
    }

    const deductions =
      editDeductions.length > 0
        ? editDeductions
        : [
            {
              id: 'it',
              code: officeSettings.defaultItCode || DEFAULT_IT_CODE,
              name: 'ব্যক্তি কর্তৃক দেয় আয়কর',
              rate: billRates.incomeTax,
              amount: calcPercentageAmount(bill.grossAmount, billRates.incomeTax),
              kind: 'it' as const,
            },
            {
              id: 'vat',
              code: officeSettings.defaultVatCode || DEFAULT_VAT_CODE,
              name: 'দেশজ পণ্য ও সেবার ওপর মূসক',
              rate: variant.rate,
              amount: calcPercentageAmount(bill.grossAmount, variant.rate),
              kind: 'vat' as const,
            },
          ];
    const vatAmt = deductions.filter((d) => d.kind === 'vat').reduce((s, d) => s + d.amount, 0);
    const itAmt = deductions.filter((d) => d.kind === 'it').reduce((s, d) => s + d.amount, 0);
    const totalDed = deductions.reduce((s, d) => s + d.amount, 0);
    return {
      grossAmount: bill.grossAmount,
      vatRate: variant.rate,
      itRate: billRates.incomeTax,
      totalPercentRate: 0,
      deductions,
      vatAmt,
      itAmt,
      totalDed,
      netPayable: bill.grossAmount - totalDed,
      rateError: '',
    };
  }, [
    bill,
    billRates,
    billExpenseTotal,
    editDraftVariantKey,
    editDeductions,
    officeSettings.defaultItCode,
    officeSettings.defaultVatCode,
  ]);

  const billAvailability = useMemo(() => {
    if (!bill) return null;
    const fyTotal = fyCodeTotals.find(
      (f) =>
        f.economicCode === bill.economicCode &&
        (!realOfficeId || !f.officeId || f.officeId === realOfficeId)
    );
    const effectiveGross =
      bill.status === 'draft' && editorOpen && previewDraftRate && !previewDraftRate.rateError
        ? previewDraftRate.grossAmount
        : bill.grossAmount;
    return computeCodeAvailable({
      fiscalYear: bill.fiscalYear,
      economicCode: bill.economicCode,
      budgets,
      fyCodeTotal: fyTotal,
      spendingLimits,
      date: bill.date,
      gross: effectiveGross,
      excludePendingAmount: bill.status === 'submitted' ? bill.grossAmount : 0,
    });
  }, [bill, editorOpen, previewDraftRate, fyCodeTotals, realOfficeId, budgets, spendingLimits]);

  const tr21FormData = useMemo(() => {
    if (!bill) return null;
    return buildTr21FormData({
      bill,
      officeSettings,
      budgets,
      allBillsInFy: bills,
      getHead,
    });
  }, [bill, officeSettings, budgets, bills, getHead]);

  const head = useMemo(() => {
    if (!bill) return { headName: '', headNameBn: '', displayName: '' };
    return getHead(bill.economicCode, {
      headName: bill.headName,
      headNameBn: bill.headNameBn,
    });
  }, [bill, getHead]);

  const timelineSteps = useMemo<TimelineStep[]>(() => {
    if (!bill) return [];
    const steps: TimelineStep[] = [
      {
        id: 'prepared',
        title: t('stepPrepared'),
        actor: formatActorBrief(bill.createdBy, officesById, bill.createdByName),
        date: formatTimestampDisplay(bill.createdAt, bill.date),
        badge:
          isActorSnapshot(bill.createdBy) && bill.createdBy.kind === 'additionalCharge'
            ? t('additionalChargeTag')
            : undefined,
        state: 'done',
      },
    ];

    if (bill.submittedBy || bill.submittedAt || bill.status !== 'draft') {
      steps.push({
        id: 'submitted',
        title: t('stepSubmitted'),
        actor: bill.submittedBy ? formatActorBrief(bill.submittedBy, officesById) : undefined,
        date: formatTimestampDisplay(bill.submittedAt),
        badge:
          isActorSnapshot(bill.submittedBy) && bill.submittedBy.kind === 'additionalCharge'
            ? t('additionalChargeTag')
            : undefined,
        state: 'done',
      });
    }

    if (bill.status === 'submitted') {
      steps.push({
        id: 'awaiting',
        title: t('awaitingDdoApproval'),
        state: 'awaiting',
      });
    } else if (bill.status === 'approved') {
      steps.push({
        id: 'approved',
        title: t('stepApproved'),
        actor: formatApprovedByLine(bill.approvedBy, officesById),
        date: formatTimestampDisplay(bill.approvedAt),
        badge:
          isActorSnapshot(bill.approvedBy) && bill.approvedBy.kind === 'additionalCharge'
            ? t('additionalChargeTag')
            : undefined,
        state: 'approved',
      });
    } else if (bill.status === 'rejected') {
      steps.push({
        id: 'rejected',
        title: t('stepRejected'),
        actor: bill.rejectedBy ? formatActorBrief(bill.rejectedBy, officesById) : undefined,
        date: formatTimestampDisplay(bill.rejectedAt),
        badge:
          isActorSnapshot(bill.rejectedBy) && bill.rejectedBy.kind === 'additionalCharge'
            ? t('additionalChargeTag')
            : undefined,
        state: 'rejected',
      });
    } else if (bill.status === 'cancelled') {
      steps.push({
        id: 'cancelled',
        title: t('stepCancelled'),
        actor: bill.cancelledBy ? formatActorBrief(bill.cancelledBy, officesById) : undefined,
        date: formatTimestampDisplay(bill.cancelledAt),
        badge:
          isActorSnapshot(bill.cancelledBy) && bill.cancelledBy.kind === 'additionalCharge'
            ? t('additionalChargeTag')
            : undefined,
        state: 'cancelled',
      });
    }

    return steps;
  }, [bill, officesById, t]);

  const refreshFallbackIfNeeded = () => {
    if (!matchedBill) setReloadTick((n) => n + 1);
  };

  const handleDirectTr21Output = async (mode: 'print' | 'pdf' | 'docx') => {
    if (!bill || !tr21FormData || tr21Busy) return;
    setTr21Busy(mode);
    try {
      const fileSeg = sanitizeBillFileSegment(bill);
      if (mode === 'print') {
        const res = await printTr21Form(tr21FormData, fileSeg);
        if (res.status === 'shared') {
          pushToast('success', 'PDF তৈরি হয়েছে — প্রিন্ট বা সেভ করার অ্যাপ বেছে নিন।');
        }
      } else if (mode === 'pdf') {
        const res = await exportTr21Pdf(tr21FormData, fileSeg);
        if (res.status === 'shared') {
          pushToast('success', 'টি.আর. ২১ PDF তৈরি হয়েছে — শেয়ার বা সেভ করুন।');
        } else if (res.status === 'downloaded') {
          pushToast('success', `${res.fileName} ডাউনলোড হয়েছে।`);
        }
      } else {
        const res = await exportTr21Docx(tr21FormData, fileSeg);
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
    if (!userDoc || !effectiveActor || !bill || !canModifyDraft(bill) || !billRates) return;
    if (previewDraftRate?.rateError) {
      pushToast('error', previewDraftRate.rateError);
      return;
    }
    const variant = billRates.vat.find((v) => v.key === editDraftVariantKey) || billRates.vat[0];
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
        bill,
        {
          date: editDraftDate,
          billDate: editDraftDate,
          vatVariant: variant.key,
          vatVariantLabel: variant.label,
          vatRate: variant.rate,
          itRate: billRates.incomeTax,
          voucherNo: editVoucherNo.trim(),
          tokenNo: editTokenNo.trim(),
          purposeText: editPurposeText.trim(),
          payeeText: editPayeeText.trim(),
          netPayableCode: editNetPayableCode.trim() || DEFAULT_NET_PAYABLE_CODE,
          supplier: supplierPayload,
          deductions: editDeductions,
        },
        effectiveActor
      );
      pushToast('success', 'খসড়া বিল ও টি.আর. ২১ তথ্য হালনাগাদ হয়েছে।');
      setEditorOpen(false);
      refreshFallbackIfNeeded();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'হালনাগাদ ব্যর্থ হয়েছে।');
    } finally {
      setSavingDraftEdit(false);
    }
  };

  const handleSaveSuperCorrection = async () => {
    if (
      !userDoc ||
      !effectiveActor ||
      !canSuperCorrect ||
      !bill ||
      bill.status !== 'approved' ||
      !billRates
    ) {
      return;
    }
    if (!isOnline) {
      pushToast('error', 'অনুমোদিত বিল সংশোধন করতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    if (!superReason.trim()) {
      pushToast('error', 'সংশোধনের কারণ উল্লেখ করা আবশ্যক।');
      return;
    }
    if (previewDraftRate?.rateError) {
      pushToast('error', previewDraftRate.rateError);
      return;
    }
    const variant = billRates.vat.find((v) => v.key === editDraftVariantKey) || billRates.vat[0];
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

      await correctApprovedBillTx(
        bill.id,
        {
          date: editDraftDate,
          billDate: editDraftDate,
          vatVariant: variant.key,
          vatVariantLabel: variant.label,
          vatRate: variant.rate,
          itRate: billRates.incomeTax,
          voucherNo: editVoucherNo.trim(),
          tokenNo: editTokenNo.trim(),
          purposeText: editPurposeText.trim(),
          payeeText: editPayeeText.trim(),
          netPayableCode: editNetPayableCode.trim() || DEFAULT_NET_PAYABLE_CODE,
          supplier: supplierPayload,
          deductions: editDeductions,
          correctionReason: superReason.trim(),
        },
        effectiveActor
      );
      pushToast('success', `বিল ${bill.billNo || ''} অডিটেড সংশোধিত হয়েছে।`);
      setSuperCorrectMode(null);
      setSuperReason('');
      refreshFallbackIfNeeded();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'সংশোধন ব্যর্থ হয়েছে।');
    } finally {
      setSavingDraftEdit(false);
    }
  };
  const [reasonError, setReasonError] = useState('');
  const [superDeleteError, setSuperDeleteError] = useState('');
  const reasonFormRef = useRef<HTMLFormElement>(null);
  const superDeleteFormRef = useRef<HTMLFormElement>(null);

  const handleConfirmSuperDelete = async () => {
    if (!userDoc || !effectiveActor || !canSuperCorrect || !bill || bill.status !== 'approved') {
      return;
    }
    if (!isOnline) {
      pushToast('error', 'অনুমোদিত বিল মুছে ফেলতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    if (!superReason.trim()) {
      setSuperDeleteError('কারণ উল্লেখ করা আবশ্যক।');
      pushToast('error', 'কারণ উল্লেখ করা আবশ্যক।');
      requestAnimationFrame(() => focusFirstInvalidField(superDeleteFormRef.current));
      return;
    }
    setSuperDeleteError('');
    setActing(true);
    try {
      await softDeleteApprovedBillTx(bill.id, superReason.trim(), effectiveActor);
      pushToast('success', `অনুমোদিত বিল ${bill.billNo || ''} অডিটেড মুছে ফেলা হয়েছে।`);
      setSuperCorrectMode(null);
      setSuperReason('');
      navigate(backTo);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'মুছে ফেলা ব্যর্থ হয়েছে।');
    } finally {
      setActing(false);
    }
  };

  const handleConfirmDeleteDraft = async () => {
    if (!userDoc || !effectiveActor || !bill || !canModifyDraft(bill)) return;
    setActing(true);
    try {
      await deleteDraftBill(bill, effectiveActor);
      pushToast('success', 'খসড়া বিল মুছে ফেলা হয়েছে; খরচ আইটেম তালিকায় ফিরে গেছে।');
      setDeleteDraftOpen(false);
      navigate(backTo);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'মুছে ফেলা ব্যর্থ হয়েছে।');
    } finally {
      setActing(false);
    }
  };

  const handleConfirmSubmitBill = async (values: SubmitBillFormValues) => {
    if (!userDoc || !effectiveActor || !bill || !canModifyDraft(bill)) return;
    if (!isOnline) {
      pushToast('error', 'বিল জমা দিতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    setActing(true);
    try {
      const res = await submitBillTx(bill.id, effectiveActor, values);
      const formattedVoucher = formatVoucherNoForTr21(
        values.voucherNo,
        res.billNo,
        bill.fiscalYear
      );
      pushToast(
        'success',
        `বিল নং ${res.billNo}${formattedVoucher ? ` (ভাউচার: ${formattedVoucher})` : ''} অনুমোদনের জন্য জমা হয়েছে।`
      );
      setSubmitModalOpen(false);
      setEditorOpen(false);
      refreshFallbackIfNeeded();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'বিল জমা দেওয়া যায়নি।');
    } finally {
      setActing(false);
    }
  };

  const handleApproveBill = async () => {
    if (!userDoc || !effectiveActor || !isDdo || !bill || bill.status !== 'submitted') return;
    if (!isOnline) {
      pushToast('error', 'বিল অনুমোদন করতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    setActing(true);
    try {
      await approveBillTx(bill.id, effectiveActor);
      pushToast('success', `বিল নং ${bill.billNo} অনুমোদিত হয়েছে ও বাজেট থেকে কর্তন হয়েছে।`);
      refreshFallbackIfNeeded();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'বিল অনুমোদন করা যায়নি।');
    } finally {
      setActing(false);
    }
  };

  const handleConfirmReasonAction = async () => {
    if (!userDoc || !effectiveActor || !isDdo || !bill || !reasonMode) return;
    if (!isOnline) {
      pushToast('error', 'এই কাজটি করতে ইন্টারনেট সংযোগ প্রয়োজন।');
      return;
    }
    if (!reasonText.trim()) {
      setReasonError('কারণ উল্লেখ করা আবশ্যক।');
      pushToast('error', 'কারণ উল্লেখ করা আবশ্যক।');
      requestAnimationFrame(() => focusFirstInvalidField(reasonFormRef.current));
      return;
    }
    setReasonError('');
    setActing(true);
    try {
      if (reasonMode === 'reject') {
        await rejectBillTx(bill.id, reasonText, effectiveActor);
        pushToast('success', `বিল ${bill.billNo} প্রত্যাখ্যাত হয়েছে; আইটেম তালিকায় ফিরে গেছে।`);
      } else {
        await cancelApprovedBillTx(bill.id, reasonText, effectiveActor);
        pushToast(
          'success',
          `অনুমোদিত বিল ${bill.billNo} বাতিল হয়েছে; বাজেট ফেরত যোগ হয়েছে।`
        );
      }
      setReasonMode(null);
      setReasonText('');
      refreshFallbackIfNeeded();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'কার্যক্রম ব্যর্থ হয়েছে।');
    } finally {
      setActing(false);
    }
  };

  // Loading State
  if ((loading && !bill) || fallbackLoading) {
    return (
      <Layout title={t('navBills')}>
        <PageHeader title={t('navBills')} backTo={backTo} backLabel={t('backToBills')} subtitle={null} />
        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
          <div className="space-y-4">
            <div className="card-surface p-5 h-32 animate-pulse bg-[var(--surface-subtle)]" />
            <div className="card-surface p-5 h-48 animate-pulse bg-[var(--surface-subtle)]" />
          </div>
          <div className="space-y-4">
            <div className="card-surface p-5 h-44 animate-pulse bg-[var(--surface-subtle)]" />
            <div className="card-surface p-5 h-40 animate-pulse bg-[var(--surface-subtle)]" />
          </div>
        </div>
      </Layout>
    );
  }

  // Not found
  if (!bill) {
    return (
      <Layout title={t('billNotFound')}>
        <PageHeader title={t('billNotFound')} backTo={backTo} backLabel={t('backToBills')} subtitle={null} />
        <EmptyState
          icon={<FileText className="w-5 h-5" />}
          title={t('billNotFound')}
          description={t('billNotFoundDesc')}
          action={
            <Link
              to={backTo}
              className="min-h-[44px] px-4 rounded-xl bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center"
            >
              {t('backToBills')}
            </Link>
          }
        />
      </Layout>
    );
  }

  // Wrong office guard
  const wrongOffice = Boolean(
    bill.officeId &&
      !isAllOfficesMode &&
      !isLegacyPreMigration &&
      realOfficeId &&
      bill.officeId !== realOfficeId
  );

  if (wrongOffice) {
    const billOffice = officesById.get(bill.officeId);
    return (
      <Layout title={bill.billNo || 'খসড়া বিল'}>
        <PageHeader
          title={bill.billNo || 'খসড়া বিল'}
          backTo={backTo}
          backLabel={t('backToBills')}
          subtitle={billOffice ? billOffice.nameBn || billOffice.name : null}
        />
        <EmptyState
          icon={<Lock className="w-5 h-5" />}
          title={t('billWrongOffice')}
          description={t('billWrongOfficeHint')}
          action={
            <Link
              to={backTo}
              className="min-h-[44px] px-4 rounded-xl bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center"
            >
              {t('backToBills')}
            </Link>
          }
        />
      </Layout>
    );
  }

  const isDraftEditable = bill.status === 'draft' && canModifyDraft(bill);
  const isSuperEditing = bill.status === 'approved' && canSuperCorrect && superCorrectMode === 'edit';
  const showEditor = (isDraftEditable && editorOpen) || isSuperEditing;

  const activeGross =
    bill.status === 'draft' && editorOpen && previewDraftRate
      ? previewDraftRate.grossAmount
      : bill.grossAmount;
  const activeTotalDed =
    bill.status === 'draft' && editorOpen && previewDraftRate
      ? previewDraftRate.totalDed
      : bill.totalDeduction;
  const activeNet =
    bill.status === 'draft' && editorOpen && previewDraftRate
      ? previewDraftRate.netPayable
      : bill.netPayable;
  const activeDeductions: BillDeductionLine[] =
    bill.status === 'draft' && editorOpen && previewDraftRate
      ? previewDraftRate.deductions
      : Array.isArray(bill.deductions) && bill.deductions.length > 0
      ? bill.deductions
      : [
          {
            id: 'vat',
            code: officeSettings.defaultVatCode || DEFAULT_VAT_CODE,
            name: `ভ্যাট${bill.vatVariantLabel ? ` · ${bill.vatVariantLabel}` : ''}`,
            rate: bill.vatRate,
            amount: bill.vatAmount,
          },
          {
            id: 'it',
            code: officeSettings.defaultItCode || DEFAULT_IT_CODE,
            name: 'আয়কর / IT',
            rate: bill.itRate,
            amount: bill.itAmount,
          },
        ];

  const budgetSlices =
    bill.status === 'approved' && Array.isArray(bill.budgetDeductions) && bill.budgetDeductions.length > 0
      ? bill.budgetDeductions
      : bill.status === 'submitted' && Array.isArray(bill.pendingSlices) && bill.pendingSlices.length > 0
      ? bill.pendingSlices
      : [];

  const formattedVoucher = bill.voucherNo
    ? formatVoucherNoForTr21(bill.voucherNo, null, bill.fiscalYear)
    : '—';

  const stickyMobileDdoBar = bill.status === 'submitted' && isDdo;

  return (
    <Layout title={bill.billNo || 'খসড়া বিল'}>
      <div className={stickyMobileDdoBar ? 'pb-24 lg:pb-0' : ''}>
        <PageHeader
          backTo={backTo}
          backLabel={t('backToBills')}
          title={bill.billNo || 'খসড়া বিল (Draft)'}
          subtitle={`${formatDateDisplay(bill.billDate || bill.date)} · ${bill.economicCode} · ${head.headNameBn || head.headName}`}
          statusChip={<StatusChip variant={billStatusToChip(bill.status)}>{t(bill.status)}</StatusChip>}
        />

        {!isOnline && (
          <div className="mb-4 px-3.5 py-2.5 rounded-[14px] bg-[var(--warn-bg)] text-[var(--warn-text)] text-xs font-medium flex items-center gap-2 no-print">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>
              অফলাইন মোড: বিল জমা (Submit), অনুমোদন (Approve), প্রত্যাখ্যান বা বাতিল করতে ইন্টারনেট সংযোগ চালু করুন।
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4 lg:gap-5 items-start">
          {/* LEFT / PRIMARY COLUMN (Mobile order 1 -> 5) */}
          <div className="space-y-4 min-w-0">
            {/* 1. Rejected / Cancelled Banner */}
            {bill.status === 'rejected' && (
              <div className="rounded-[14px] border border-[var(--danger-text)]/30 bg-[var(--danger-bg)] p-4 text-xs sm:text-sm text-[var(--danger-text)] space-y-2">
                <div className="font-bold flex items-center gap-1.5">
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>প্রত্যাখ্যানের কারণ</span>
                </div>
                <p className="bn text-[var(--text)] leading-relaxed">
                  {bill.rejectReason || '—'}
                </p>
                {canDraftBill && (
                  <div className="pt-1 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--danger-text)]/20">
                    <span className="text-xs text-[var(--text)]/80">
                      অন্তর্ভুক্ত খরচ আইটেমগুলো তালিকাভুক্ত অবস্থায় ফিরে গেছে — খরচ তালিকা থেকে নতুন বিল প্রস্তুত করুন।
                    </span>
                    <Link
                      to="/expense-items"
                      className="min-h-[38px] px-3 rounded-lg bg-[var(--card)] border border-[var(--line)] text-[var(--text)] text-xs font-semibold inline-flex items-center hover:bg-[var(--surface-subtle)]"
                    >
                      খরচ তালিকায় যান →
                    </Link>
                  </div>
                )}
              </div>
            )}

            {bill.status === 'cancelled' && (
              <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-subtle)] p-4 text-xs sm:text-sm space-y-1">
                <div className="font-bold text-[var(--text)]">বাতিলের কারণ</div>
                <p className="bn text-[var(--muted)] leading-relaxed">
                  {bill.cancelReason || '—'}
                </p>
              </div>
            )}

            {/* 2. Summary Card */}
            <div className="card-surface p-4 md:p-5 space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="text-xs text-[var(--muted)]">{t('netPayable')}</div>
                  <div className="text-2xl md:text-3xl font-bold text-[var(--accent)] tabular-nums mt-0.5">
                    {formatTaka(activeNet)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[var(--muted)]">অর্থবছর</div>
                  <div className="text-sm font-semibold text-[var(--text)] tabular-nums">
                    FY {bill.fiscalYear}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 pt-3 border-t border-[var(--line)] text-xs">
                <div className="min-w-0">
                  <div className="text-[var(--muted)]">{t('gross')}</div>
                  <div className="font-semibold text-[var(--text)] tabular-nums truncate mt-0.5">
                    {formatTaka(activeGross)}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[var(--muted)]">কর্তন</div>
                  <div className="font-semibold text-[var(--muted)] tabular-nums truncate mt-0.5">
                    {formatTaka(activeTotalDed)}
                  </div>
                </div>
                <div className="min-w-0 text-right">
                  <div className="text-[var(--muted)]">{t('itemsSection')}</div>
                  <div className="font-semibold text-[var(--text)] tabular-nums mt-0.5">
                    {bill.items.length}টি
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Actions Row (TR21 Form + Workflow Actions) */}
            <div className="card-surface p-3.5 md:p-4 space-y-3 no-print">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTr21PreviewOpen(true)}
                  className="min-h-[44px] px-4 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5"
                >
                  <Eye className="w-4 h-4 shrink-0" />
                  <span>ফর্ম (টি.আর. ২১) দেখুন</span>
                </button>
                <button
                  type="button"
                  disabled={Boolean(tr21Busy)}
                  onClick={() => handleDirectTr21Output('pdf')}
                  className="min-h-[44px] px-3.5 rounded-xl border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-60"
                >
                  <FileDown className="w-4 h-4 shrink-0" />
                  <span>{tr21Busy === 'pdf' ? 'PDF…' : 'PDF'}</span>
                </button>
                <button
                  type="button"
                  disabled={Boolean(tr21Busy)}
                  onClick={() => handleDirectTr21Output('docx')}
                  className="min-h-[44px] px-3.5 rounded-xl border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-60"
                >
                  <FileText className="w-4 h-4 shrink-0" />
                  <span>{tr21Busy === 'docx' ? 'Word…' : 'Word'}</span>
                </button>
                <button
                  type="button"
                  disabled={Boolean(tr21Busy)}
                  onClick={() => handleDirectTr21Output('print')}
                  className="min-h-[44px] px-3.5 rounded-xl border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-60"
                >
                  <Printer className="w-4 h-4 shrink-0" />
                  <span>{tr21Busy === 'print' ? 'প্রিন্ট…' : 'Print'}</span>
                </button>
              </div>

              {/* Draft Actions */}
              {bill.status === 'draft' && (
                <div className="pt-3 border-t border-[var(--line)] flex flex-wrap items-center justify-between gap-2">
                  {canModifyDraft(bill) ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditorOpen((v) => !v)}
                          className="min-h-[44px] px-3.5 rounded-xl border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs sm:text-sm font-medium inline-flex items-center gap-1.5"
                        >
                          <Edit3 className="w-4 h-4 shrink-0" />
                          <span>{editorOpen ? t('hideEditFormBtn') : t('editDraftRatesBtn')}</span>
                        </button>
                        <button
                          type="button"
                          disabled={acting}
                          onClick={() => setDeleteDraftOpen(true)}
                          className="min-h-[44px] px-3.5 rounded-xl border border-[var(--line)] text-xs sm:text-sm font-medium text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40 inline-flex items-center gap-1.5"
                        >
                          <Trash2 className="w-4 h-4 shrink-0" />
                          <span>{t('confirmDeleteBtn')}</span>
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={acting || !isOnline}
                        onClick={() => setSubmitModalOpen(true)}
                        className="min-h-[44px] px-5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
                      >
                        <Send className="w-4 h-4 shrink-0" />
                        <span>{acting ? 'জমা হচ্ছে…' : t('submit')}</span>
                      </button>
                    </>
                  ) : (
                    <div className="w-full p-2.5 rounded-lg bg-[var(--surface-subtle)] text-xs text-[var(--muted)] flex items-center gap-2">
                      <Lock className="w-4 h-4 shrink-0" />
                      <span>
                        {isSuperAdmin
                          ? 'সুপার অ্যাডমিন খসড়া বিল সম্পাদনা বা জমা দেন না (শুধু দেখতে পারবেন)।'
                          : 'শুধুমাত্র এই খসড়া বিলের প্রস্তুতকারী অথবা দপ্তরের DDO এটি সম্পাদনা বা জমা দিতে পারবেন।'}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Submitted Actions (Desktop visible; Mobile uses sticky bar) */}
              {bill.status === 'submitted' && (
                <div className="pt-3 border-t border-[var(--line)]">
                  {isDdo ? (
                    <div className="hidden lg:flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={acting || !isOnline}
                        onClick={() => {
                          setReasonText('');
                          setReasonMode('reject');
                        }}
                        className="min-h-[44px] px-4 rounded-xl border border-[var(--danger-text)]/50 text-[var(--danger-text)] text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-[var(--danger-bg)]/30 disabled:opacity-60"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>{t('reject')}</span>
                      </button>
                      <button
                        type="button"
                        disabled={acting || !isOnline || !billAvailability?.allowed}
                        onClick={handleApproveBill}
                        className="min-h-[44px] px-5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{acting ? 'অনুমোদন হচ্ছে…' : t('approve')}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-lg bg-[var(--surface-subtle)] text-xs text-[var(--muted)] flex items-center gap-2">
                      <Lock className="w-4 h-4 shrink-0" />
                      <span>শুধুমাত্র এই অফিসের DDO এই বিলটি অনুমোদন বা প্রত্যাখ্যান করতে পারবেন।</span>
                    </div>
                  )}
                  {isDdo && (
                    <p className="lg:hidden text-xs text-[var(--muted)]">
                      নিচের অ্যাকশন বার থেকে এই বিলটি অনুমোদন অথবা প্রত্যাখ্যান করুন।
                    </p>
                  )}
                </div>
              )}

              {/* Approved Actions */}
              {bill.status === 'approved' && (
                <div className="pt-3 border-t border-[var(--line)] flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    <span>অনুমোদিত বিল অপরিবর্তনীয় (Immutable)</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {isDdo && (
                      <button
                        type="button"
                        disabled={acting || !isOnline}
                        onClick={() => {
                          setReasonText('');
                          setReasonMode('cancel');
                        }}
                        className="min-h-[44px] px-4 rounded-xl border border-[var(--danger-text)]/50 text-[var(--danger-text)] text-xs sm:text-sm font-semibold hover:bg-[var(--danger-bg)]/40 disabled:opacity-60"
                      >
                        {t('cancelBill')}
                      </button>
                    )}
                    {canSuperCorrect && !superCorrectMode && (
                      <>
                        <button
                          type="button"
                          disabled={acting || !isOnline}
                          onClick={() => {
                            setSuperReason('');
                            setSuperCorrectMode('edit');
                          }}
                          className="min-h-[44px] px-3.5 rounded-xl border border-[var(--accent)] text-[var(--accent)] text-xs font-semibold hover:bg-[var(--accent-soft)] disabled:opacity-60"
                        >
                          সুপার অ্যাডমিন সংশোধন
                        </button>
                        <button
                          type="button"
                          disabled={acting || !isOnline}
                          onClick={() => {
                            setSuperReason('');
                            setSuperCorrectMode('delete');
                          }}
                          className="min-h-[44px] px-3.5 rounded-xl border border-[var(--danger-text)]/50 text-[var(--danger-text)] text-xs font-semibold hover:bg-[var(--danger-bg)]/40 disabled:opacity-60"
                        >
                          অডিটেড মুছুন
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Live Budget & Cap Availability Box for Draft/Submitted */}
            {(bill.status === 'draft' || bill.status === 'submitted') && billAvailability && (
              <div
                className={`p-3.5 rounded-[14px] border text-xs space-y-1 ${
                  billAvailability.allowed
                    ? 'bg-[var(--card)] border-[var(--line)]'
                    : 'bg-[var(--danger-bg)] border-[var(--danger-text)]/40 text-[var(--danger-text)]'
                }`}
              >
                <div className="font-semibold flex items-center gap-1.5">
                  {!billAvailability.allowed && <AlertTriangle className="w-4 h-4 shrink-0" />}
                  <span>
                    বাজেট যাচাই ({bill.economicCode}):{' '}
                    {billAvailability.allowed ? 'অনুমোদনযোগ্য' : 'বাজেট/সীমা অতিক্রম করেছে'}
                  </span>
                </div>
                <div className="tabular-nums text-[var(--muted)]">
                  বরাদ্দ {formatTaka(billAvailability.allocation)} · অনুমোদিত{' '}
                  {formatTaka(billAvailability.approvedSpent)} · উপলব্ধ{' '}
                  {formatTaka(billAvailability.available)}
                </div>
                {!billAvailability.allowed && (
                  <div className="font-medium">
                    {billAvailability.limitingConstraint.exceededMessage}
                  </div>
                )}
              </div>
            )}

            {/* 4. Items Card */}
            <div className="card-surface overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--line)] flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-[var(--text)]">
                  {t('itemsSection')} ({bill.items.length})
                </h2>
                <span className="text-xs text-[var(--muted)] tabular-nums">
                  {formatTaka(billExpenseTotal)}
                </span>
              </div>
              <div className="divide-y divide-[var(--line)]">
                {bill.items.map((it) => (
                  <div key={it.id} className="p-3.5 md:px-4 flex items-start justify-between gap-3 text-xs sm:text-sm">
                    <div className="min-w-0">
                      <div className="font-medium bn text-[var(--text)] break-words">
                        {it.description}
                      </div>
                      <div className="text-xs text-[var(--muted)] mt-0.5">
                        <span className="tabular-nums">{formatDateDisplay(it.date)}</span> ·{' '}
                        <span className="bn">{it.responsibleEmployee.name}</span>
                        {it.responsibleEmployee.designation
                          ? ` (${it.responsibleEmployee.designation})`
                          : ''}
                      </div>
                    </div>
                    <div className="font-semibold tabular-nums shrink-0 text-[var(--text)]">
                      {formatTaka(it.amount)}
                    </div>
                  </div>
                ))}
                <div className="px-3.5 py-2.5 md:px-4 bg-[var(--surface-subtle)] flex items-center justify-between text-xs font-semibold">
                  <span className="text-[var(--muted)]">{t('grossTotalRow')}</span>
                  <span className="tabular-nums text-[var(--text)]">
                    {formatTaka(billExpenseTotal)}
                  </span>
                </div>
              </div>
            </div>

            {/* 5. Deductions Card & Draft/SuperAdmin Editor */}
            <div className="card-surface p-4 md:p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-[var(--text)]">{t('deductionsSection')}</h2>
                {(isDraftEditable || (bill.status === 'approved' && canSuperCorrect)) && !showEditor && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isDraftEditable) setEditorOpen(true);
                      else {
                        setSuperReason('');
                        setSuperCorrectMode('edit');
                      }
                    }}
                    className="text-xs font-semibold text-[var(--accent)] hover:underline"
                  >
                    {t('edit')}
                  </button>
                )}
              </div>

              <div className="space-y-2 text-xs sm:text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-[var(--muted)]">{t('gross')}</span>
                  <span className="font-semibold tabular-nums text-[var(--text)]">
                    {formatTaka(activeGross)}
                  </span>
                </div>

                {activeDeductions.map((d) => (
                  <div key={d.id} className="flex justify-between gap-2 text-xs">
                    <span className="text-[var(--muted)] bn min-w-0 break-words">
                      {d.code ? `${d.code} · ` : ''}
                      {d.name}
                      {typeof d.rate === 'number' && d.rate > 0 ? ` (${d.rate}%)` : ''}
                    </span>
                    <span className="tabular-nums shrink-0 text-[var(--text)]">
                      − {formatTaka(d.amount)}
                    </span>
                  </div>
                ))}

                <div className="flex justify-between gap-2 border-t border-[var(--line)] pt-2 text-xs">
                  <span className="font-semibold text-[var(--text)]">{t('totalDeductionsRow')}</span>
                  <span className="font-semibold tabular-nums text-[var(--text)]">
                    {formatTaka(activeTotalDed)}
                  </span>
                </div>

                <div className="flex justify-between gap-2 text-sm pt-0.5">
                  <span className="font-bold text-[var(--text)]">{t('netPayable')}</span>
                  <span className="font-bold text-[var(--accent)] tabular-nums">
                    {formatTaka(activeNet)}
                  </span>
                </div>
              </div>

              {/* Draft Edit OR Super Admin Audited Edit Form */}
              {showEditor && billRates && (
                <div className="mt-3 p-3.5 rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-[var(--text)]">
                      {bill.status === 'approved'
                        ? 'সুপার অ্যাডমিন অডিটেড সংশোধন (অনুমোদিত বিল)'
                        : 'খসড়া বিল সম্পাদনা (তারিখ, ভ্যাট/কর্তন ও টি.আর. ২১ তথ্য)'}
                    </div>
                    {bill.status === 'draft' &&
                      isDdo &&
                      bill.createdBy &&
                      getActorUid(bill.createdBy) !== userDoc?.id && (
                        <span className="px-2 py-0.5 rounded bg-[var(--warn-bg)] text-[var(--warn-text)] text-[11px] font-medium">
                          DDO হিসেবে অন্য কর্মচারীর খসড়া সম্পাদনা করছেন
                        </span>
                      )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                        ভাউচার নং (ঐচ্ছিক)
                      </label>
                      <input
                        type="text"
                        value={editVoucherNo}
                        onChange={(e) => setEditVoucherNo(e.target.value)}
                        placeholder="যেমন: ০০১"
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
                        ভ্যাটের ধরন ({previewDraftRate?.vatRate ?? bill.vatRate}%)
                      </label>
                      <Select
                        modalTitle="ভ্যাটের ধরন নির্বাচন করুন"
                        searchable={false}
                        clearable={false}
                        value={editDraftVariantKey}
                        onChange={(e) => {
                          const key = e.target.value;
                          setEditDraftVariantKey(key);
                          const chosen =
                            billRates.vat.find((v) => v.key === key) || billRates.vat[0];
                          if (chosen) {
                            setEditDeductions((prev) =>
                              prev.map((d) =>
                                d.kind === 'vat' ? { ...d, rate: chosen.rate } : d
                              )
                            );
                          }
                        }}
                        options={billRates.vat.map((v) => ({
                          value: v.key,
                          label: v.label,
                          metaRight: `${v.rate}%`,
                        }))}
                      />
                    </div>
                  </div>

                  <div className="space-y-2.5">
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

                    {(() => {
                      const primaryBudget = resolveBillPrimaryBudget({
                        budgets,
                        fiscalYear: bill.fiscalYear,
                        economicCode: bill.economicCode,
                        bill,
                      });
                      const previewIntro = buildTr21IntroText({
                        template: officeSettings.tr21P1S3IntroTemplate,
                        officeName: officeSettings.officeName,
                        officeAddress: officeSettings.address,
                        fiscalYear: bill.fiscalYear,
                        memoNo: primaryBudget?.memoNo || '',
                        memoDate: primaryBudget?.memoDate || '',
                        purposeText:
                          editPurposeText.trim() ||
                          `${head.headNameBn || head.headName} বাবদ ব্যয়ের বিল।`,
                        headName: head.headNameBn || head.headName,
                        economicCode: bill.economicCode,
                        billNo: bill.billNo,
                        billDate: bill.billDate || bill.date,
                      });
                      return (
                        <div className="p-2.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs bn leading-relaxed">
                          <div className="text-[11px] font-semibold text-[var(--muted)] mb-1">
                            টি.আর. ২১ (P1-S3) বিবরণ প্রিভিউ:
                          </div>
                          <p className="text-[var(--text)]">{previewIntro}</p>
                          <div className="mt-1.5 space-y-0.5 pl-3 text-[var(--muted)]">
                            {bill.items.map((it, i) => (
                              <div key={it.id} className="flex items-baseline justify-between gap-2">
                                <span className="truncate">
                                  {toBanglaDigits(i + 1)}) {it.description}
                                </span>
                                <span className="tabular-nums shrink-0">{formatTaka(it.amount)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
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

                    {editDeductions.map((d, dIdx) => {
                      const liveAmount = previewDraftRate?.deductions[dIdx]?.amount ?? d.amount;
                      return (
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
                                  prev.map((row, i) =>
                                    i === dIdx ? { ...row, code: e.target.value } : row
                                  )
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
                                  prev.map((row, i) =>
                                    i === dIdx ? { ...row, name: e.target.value } : row
                                  )
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
                                    i === dIdx ? { ...row, rate: nextRate } : row
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
                              value={formatPaisaInput(liveAmount)}
                              onChange={(e) => {
                                const nextPaisa = toPaisa(e.target.value);
                                setEditDeductions((prev) =>
                                  prev.map((row, i) =>
                                    i === dIdx
                                      ? {
                                          ...row,
                                          rate: null,
                                          amount:
                                            Number.isFinite(nextPaisa) && nextPaisa >= 0
                                              ? nextPaisa
                                              : 0,
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
                      );
                    })}
                  </div>

                  {previewDraftRate?.rateError && (
                    <div className="p-2.5 rounded-lg bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs font-semibold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{previewDraftRate.rateError}</span>
                    </div>
                  )}

                  {bill.status === 'approved' && superCorrectMode === 'edit' ? (
                    <div className="space-y-2.5 pt-1 border-t border-[var(--line)]">
                      <div>
                        <label className="block text-[11px] font-semibold text-[var(--text)] mb-1">
                          সংশোধনের কারণ (অডিট লগে সংরক্ষিত হবে · বাধ্যতামূলক)
                        </label>
                        <textarea
                          rows={2}
                          value={superReason}
                          onChange={(e) => setSuperReason(e.target.value)}
                          placeholder="কেন অনুমোদিত বিলটি সংশোধন করা হচ্ছে তা লিখুন…"
                          className="w-full p-2.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs bn"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSuperCorrectMode(null);
                            setSuperReason('');
                          }}
                          className="min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs font-medium"
                        >
                          {t('cancel')}
                        </button>
                        <button
                          type="button"
                          disabled={
                            savingDraftEdit ||
                            !isOnline ||
                            !superReason.trim() ||
                            Boolean(previewDraftRate?.rateError)
                          }
                          onClick={handleSaveSuperCorrection}
                          className="min-h-[40px] px-4 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-xs font-semibold disabled:opacity-60"
                        >
                          {savingDraftEdit ? 'সংশোধন সংরক্ষণ হচ্ছে…' : 'সংশোধন সংরক্ষণ করুন'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditorOpen(false)}
                        className="min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs font-medium"
                      >
                        {t('cancel')}
                      </button>
                      <button
                        type="button"
                        disabled={savingDraftEdit || Boolean(previewDraftRate?.rateError)}
                        onClick={handleSaveDraftRates}
                        className="min-h-[40px] px-4 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-xs font-semibold disabled:opacity-60"
                      >
                        {savingDraftEdit ? 'সংরক্ষণ হচ্ছে…' : 'হার ও ফর্ম তথ্য সংরক্ষণ করুন'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT / SECONDARY COLUMN (Mobile order 6 -> 9) */}
          <div className="space-y-4 min-w-0">
            {/* 6. Details Card */}
            <div className="card-surface p-4 md:p-5 space-y-3">
              <h2 className="text-sm font-bold text-[var(--text)]">{t('detailsSection')}</h2>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--muted)] shrink-0">{t('voucherNoLabel')}</dt>
                  <dd className="text-right font-medium text-[var(--text)] bn tabular-nums">
                    {formattedVoucher}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--muted)] shrink-0">{t('billDateLabel')}</dt>
                  <dd className="text-right font-medium text-[var(--text)] tabular-nums">
                    {formatDateDisplay(bill.billDate || bill.date)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--muted)] shrink-0">{t('tokenNoLabel')}</dt>
                  <dd className="text-right font-medium text-[var(--text)] tabular-nums">
                    {bill.tokenNo || '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--muted)] shrink-0">{t('payee')}</dt>
                  <dd className="text-right font-medium text-[var(--text)] bn break-words max-w-[65%]">
                    {bill.payeeText || '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--muted)] shrink-0">{t('netPayableCodeLabel')}</dt>
                  <dd className="text-right font-medium text-[var(--text)] tabular-nums">
                    {bill.netPayableCode || DEFAULT_NET_PAYABLE_CODE}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--muted)] shrink-0">{t('supplierLabel')}</dt>
                  <dd className="text-right font-medium text-[var(--text)] bn break-words max-w-[65%]">
                    {bill.supplier?.name || bill.supplier?.address || bill.supplier?.tinBin
                      ? [
                          bill.supplier?.name,
                          bill.supplier?.address,
                          bill.supplier?.tinBin ? `TIN/BIN: ${bill.supplier.tinBin}` : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : '—'}
                  </dd>
                </div>
                <div className="pt-2 border-t border-[var(--line)]/70 space-y-1">
                  <dt className="text-[var(--muted)]">{t('purposeLabel')}</dt>
                  <dd className="font-medium text-[var(--text)] bn break-words leading-relaxed">
                    {bill.purposeText || `${head.headNameBn || head.headName} বাবদ ব্যয়ের বিল।`}
                  </dd>
                </div>
              </dl>
            </div>

            {/* 7. Charged to Budget */}
            <div className="card-surface p-4 md:p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-[var(--text)]">
                  {t('chargedToBudgetSection')}
                </h2>
                <Link
                  to="/budgets"
                  className="text-xs font-semibold text-[var(--accent)] hover:underline"
                >
                  {t('navBudgetsShort')} →
                </Link>
              </div>
              {budgetSlices.length > 0 ? (
                <div className="space-y-2">
                  {budgetSlices.map((slice) => {
                    const bud = budgets.find((b) => b.id === slice.budgetId);
                    return (
                      <Link
                        key={slice.budgetId}
                        to="/budgets"
                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--surface-subtle)] hover:bg-[var(--accent-soft)]/50 transition-colors text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-[var(--text)] bn truncate">
                            {bud ? `${bud.economicCode} · ${bud.headNameBn || bud.headName}` : `${bill.economicCode} · ${head.headNameBn || head.headName}`}
                          </div>
                          {bud?.memoNo && (
                            <div className="text-[11px] text-[var(--muted)] tabular-nums">
                              স্মারক: {bud.memoNo}
                            </div>
                          )}
                        </div>
                        <span className="font-bold tabular-nums text-[var(--text)] shrink-0">
                          {formatTaka(slice.amount)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <Link
                  to="/budgets"
                  className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--surface-subtle)] hover:bg-[var(--accent-soft)]/50 transition-colors text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-[var(--text)] bn truncate">
                      {bill.economicCode} · {head.headNameBn || head.headName}
                    </div>
                    <div className="text-[11px] text-[var(--muted)]">
                      {bill.status === 'draft'
                        ? 'জমা ও অনুমোদনের পর বাজেট থেকে সমন্বয় হবে'
                        : 'বাজেট বরাদ্দ দেখুন'}
                    </div>
                  </div>
                  <span className="font-bold tabular-nums text-[var(--text)] shrink-0">
                    {formatTaka(activeGross)}
                  </span>
                </Link>
              )}
            </div>

            {/* 8. Approval Trail */}
            <div className="card-surface p-4 md:p-5 space-y-3">
              <h2 className="text-sm font-bold text-[var(--text)]">{t('approvalTrailSection')}</h2>
              <Timeline steps={timelineSteps} note={t('auditTrailNote')} />
            </div>

            {/* 9. Activity */}
            <div className="card-surface p-4 md:p-5 space-y-2">
              <h2 className="text-sm font-bold text-[var(--text)]">{t('activity')}</h2>
              <ActivityList logs={billLogs} loading={logsLoading} />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Sticky DDO Action Bar (Submitted Bills) */}
      {stickyMobileDdoBar && (
        <div className="lg:hidden fixed inset-x-3 bottom-[calc(56px+env(safe-area-inset-bottom,0px)+8px)] z-30 flex items-center gap-2 p-2 rounded-2xl bg-[var(--card)]/95 backdrop-blur border border-[var(--line)] shadow-lg no-print">
          <button
            type="button"
            disabled={acting || !isOnline}
            onClick={() => {
              setReasonText('');
              setReasonMode('reject');
            }}
            className="flex-1 min-h-[44px] px-3 rounded-xl border border-[var(--danger-text)]/50 text-[var(--danger-text)] text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            <XCircle className="w-4 h-4 shrink-0" />
            <span>{t('reject')}</span>
          </button>
          <button
            type="button"
            disabled={acting || !isOnline || !billAvailability?.allowed}
            onClick={handleApproveBill}
            className="flex-1 min-h-[44px] px-3 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{acting ? 'অনুমোদন হচ্ছে…' : t('approve')}</span>
          </button>
        </div>
      )}

      {/* Confirm Delete Draft Modal */}
      <Modal
        open={deleteDraftOpen}
        onClose={() => {
          if (!acting) setDeleteDraftOpen(false);
        }}
        title={t('deleteDraftConfirmTitle')}
        size="sm"
        footer={
          <ModalFooter
            danger
            loading={acting}
            secondary={{
              label: t('cancel'),
              disabled: acting,
              onClick: () => setDeleteDraftOpen(false),
            }}
            primary={{
              label: acting ? 'মুছে ফেলা হচ্ছে…' : t('confirmDeleteBtn'),
              onClick: handleConfirmDeleteDraft,
            }}
          />
        }
      >
        <div className="space-y-4">
          <div
            aria-hidden="true"
            className="w-14 h-14 rounded-full bg-[var(--danger-bg)] text-[var(--danger-text)] flex items-center justify-center mx-auto"
          >
            <AlertTriangle className="w-7 h-7" />
          </div>
          <Banner variant="danger">
            {t('deleteDraftConfirmBody')}
          </Banner>
        </div>
      </Modal>

      {/* Reject / Cancel Reason Modal */}
      <Modal
        open={Boolean(reasonMode)}
        onClose={() => {
          if (!acting) {
            setReasonMode(null);
            setReasonText('');
            setReasonError('');
          }
        }}
        title={
          reasonMode === 'reject'
            ? 'বিল প্রত্যাখ্যানের কারণ'
            : 'অনুমোদিত বিল বাতিলের কারণ'
        }
        size="sm"
        confirmClose={Boolean(reasonText.trim()) && !acting}
        footer={
          <ModalFooter
            danger
            loading={acting}
            secondary={{
              label: t('cancel'),
              disabled: acting,
              onClick: () => {
                setReasonMode(null);
                setReasonText('');
                setReasonError('');
              },
            }}
            primary={{
              label: acting
                ? 'সম্পন্ন হচ্ছে…'
                : reasonMode === 'reject'
                ? 'প্রত্যাখ্যান নিশ্চিত করুন'
                : 'বিল বাতিল নিশ্চিত করুন',
              type: 'submit',
              form: 'bill-reason-form',
              disabled: !isOnline,
            }}
          />
        }
      >
        <form
          ref={reasonFormRef}
          id="bill-reason-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleConfirmReasonAction();
          }}
          noValidate
          className="space-y-4"
        >
          {!isOnline && (
            <Banner variant="warn">
              এই কাজটি করতে ইন্টারনেট সংযোগ প্রয়োজন।
            </Banner>
          )}
          <Field
            label={
              reasonMode === 'reject'
                ? 'প্রত্যাখ্যানের কারণ লিখুন (বাধ্যতামূলক)'
                : 'অনুমোদিত বিল বাতিলের কারণ লিখুন (বাধ্যতামূলক)'
            }
            required
            error={reasonError}
          >
            <Textarea
              rows={3}
              value={reasonText}
              onChange={(e) => {
                setReasonText(e.target.value);
                if (reasonError) setReasonError('');
              }}
              placeholder="কারণ লিখুন…"
              className="bn"
            />
          </Field>
        </form>
      </Modal>

      {/* Super Admin Audited Delete Modal */}
      <Modal
        open={superCorrectMode === 'delete'}
        onClose={() => {
          if (!acting) {
            setSuperCorrectMode(null);
            setSuperReason('');
            setSuperDeleteError('');
          }
        }}
        title="সুপার অ্যাডমিন অডিটেড বিল মুছে ফেলা"
        size="sm"
        confirmClose={Boolean(superReason.trim()) && !acting}
        footer={
          <ModalFooter
            danger
            loading={acting}
            secondary={{
              label: t('cancel'),
              disabled: acting,
              onClick: () => {
                setSuperCorrectMode(null);
                setSuperReason('');
                setSuperDeleteError('');
              },
            }}
            primary={{
              label: acting ? 'মুছে ফেলা হচ্ছে…' : 'অডিটেড মুছুন নিশ্চিত করুন',
              type: 'submit',
              form: 'super-delete-form',
              disabled: !isOnline,
            }}
          />
        }
      >
        <form
          ref={superDeleteFormRef}
          id="super-delete-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleConfirmSuperDelete();
          }}
          noValidate
          className="space-y-4"
        >
          {!isOnline && (
            <Banner variant="warn">
              অনুমোদিত বিল মুছে ফেলতে ইন্টারনেট সংযোগ প্রয়োজন।
            </Banner>
          )}
          <div
            aria-hidden="true"
            className="w-14 h-14 rounded-full bg-[var(--danger-bg)] text-[var(--danger-text)] flex items-center justify-center mx-auto"
          >
            <AlertTriangle className="w-7 h-7" />
          </div>
          <Banner variant="danger">
            বিলটি মুছে ফেলা হলে বাজেটের ব্যয়িত অর্থ ফেরত আসবে, অন্তর্ভুক্ত খরচ আইটেমগুলো তালিকাভুক্ত অবস্থায় ফিরে যাবে এবং অডিট লগে রেকর্ড থাকবে।
          </Banner>
          <Field label="মুছে ফেলার কারণ (বাধ্যতামূলক)" required error={superDeleteError}>
            <Textarea
              rows={3}
              value={superReason}
              onChange={(e) => {
                setSuperReason(e.target.value);
                if (superDeleteError) setSuperDeleteError('');
              }}
              placeholder="মুছে ফেলার সুনির্দিষ্ট কারণ লিখুন…"
              className="bn"
            />
          </Field>
        </form>
      </Modal>

      {/* Submit Draft Modal */}
      <SubmitBillModal
        open={submitModalOpen}
        onClose={() => {
          if (!acting) setSubmitModalOpen(false);
        }}
        onConfirm={handleConfirmSubmitBill}
        submitting={acting}
        isOnline={isOnline}
        fiscalYear={bill.fiscalYear}
        economicCode={bill.economicCode}
        headName={bill.headName}
        headNameBn={bill.headNameBn}
        grossAmount={bill.grossAmount}
        netPayable={bill.netPayable}
        initialValues={{
          voucherNo: editVoucherNo || bill.voucherNo || '',
          billDate: editDraftDate || bill.billDate || bill.date,
          tokenNo: editTokenNo || bill.tokenNo || '',
          purposeText: editPurposeText || bill.purposeText || '',
          payeeText: editPayeeText || bill.payeeText || officeSettings.defaultPayeeText || '',
        }}
      />

      {/* T.R. 21 Preview Modal */}
      <BillFormPreviewModal
        open={tr21PreviewOpen && Boolean(tr21FormData)}
        onClose={() => setTr21PreviewOpen(false)}
        bill={bill}
        formData={tr21FormData}
      />
    </Layout>
  );
}
