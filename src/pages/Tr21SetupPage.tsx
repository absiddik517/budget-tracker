import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Eye,
  FileDown,
  FileText,
  Layers,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { BillForm, TR21_FORM_SECTIONS } from '../components/BillForm';
import { Modal, ModalFooter } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { SegmentedChips } from '../components/SegmentedChips';
import { Field, Segmented, Select, TextInput, Textarea, Toggle, focusFirstInvalidField } from '../components/form';
import { useAuth } from '../contexts/AuthContext';
import { ALL_OFFICES_ID, LEGACY_UNMIGRATED_OFFICE_ID, useApp } from '../contexts/AppContext';
import { toBanglaDigits } from '../lib/banglaFormat';
import { buildTr21FormData, sanitizeBillFileSegment } from '../lib/billFormData';
import { db } from '../lib/firebase';
import { isPermissionDeniedError, logFirestoreError, OperationType } from '../lib/firestoreError';
import { saveOfficeSettings } from '../lib/firestoreOps';
import { canEditOfficeBasic } from '../lib/permissions';
import {
  clampTr21Margin,
  cloneDefaultTr21Clauses,
  DEFAULT_INSTITUTIONAL_CODE,
  DEFAULT_IT_CODE,
  DEFAULT_NET_PAYABLE_CODE,
  DEFAULT_SECURITY_CODE,
  DEFAULT_TR21_FONT_FAMILY,
  DEFAULT_TR21_FONT_SIZE,
  DEFAULT_TR21_FOOTER_TEXT,
  DEFAULT_TR21_MARGINS,
  DEFAULT_VAT_CODE,
  resolveTr21Clauses,
  resolveTr21FontFamily,
  resolveTr21FontSize,
  resolveTr21Margins,
  serializeTr21MarginsToLabel,
  TR21_FONT_OPTIONS,
  TR21_FONT_SIZE_OPTIONS,
} from '../lib/tr21Defaults';
import { ensureBengaliFontsLoaded } from '../utils/exportPdf';
import { exportTr21Docx, exportTr21Pdf, printTr21Form } from '../utils/exportTr21';
import type {
  BillDoc,
  BudgetDoc,
  CertificationClause,
  OfficeSettings,
  Tr21Margins,
} from '../types';

const A4_WIDTH_PX = 794;
const DEFAULT_MINISTRY_FALLBACK = 'প্রাথমিক ও গণশিক্ষা মন্ত্রণালয়';
const DEFAULT_MOBILE_FALLBACK = '০১৯৬৭৫০০১০৫';

type ClauseFilter = 'all' | 'page1' | 'page2';
type MobilePane = 'setup' | 'preview';
type AccordionStep = 1 | 2 | 3;

interface MarginInputStrings {
  top: string;
  bottom: string;
  left: string;
  right: string;
}

interface ClauseModalState {
  mode: 'create' | 'edit';
  index: number | null;
  id: string;
  numberBn: string;
  page: 1 | 2;
  enabled: boolean;
  text: string;
}

function marginsToStrings(m: Tr21Margins): MarginInputStrings {
  return {
    top: String(m.top),
    bottom: String(m.bottom),
    left: String(m.left),
    right: String(m.right),
  };
}

interface AccordionCardProps {
  step: AccordionStep;
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function AccordionCard({
  step,
  title,
  subtitle,
  open,
  onToggle,
  children,
}: AccordionCardProps) {
  return (
    <section className="card-surface overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full min-h-[68px] px-4 sm:px-5 py-3 flex items-center gap-3.5 text-left hover:bg-[var(--surface-subtle)]/60 transition-colors"
      >
        <span className="w-8 h-8 rounded-[9px] bg-[var(--accent-soft)] text-[var(--accent)] font-bold text-sm flex items-center justify-center shrink-0 tabular-nums">
          {step}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-semibold text-[var(--text)] leading-snug">
            {title}
          </span>
          <span className="block text-xs text-[var(--muted)] truncate mt-0.5">
            {subtitle}
          </span>
        </span>
        <ChevronDown
          className={`w-5 h-5 text-[var(--muted)] shrink-0 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div className="px-4 sm:px-5 pb-5 pt-4 border-t border-[var(--line)] space-y-3.5">
          {children}
        </div>
      )}
    </section>
  );
}

interface ToggleSwitchProps {
  checked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (checked: boolean) => void;
}

function ToggleSwitch({ checked, disabled = false, ariaLabel, onChange }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50 ${
        checked ? 'bg-[var(--accent)]' : 'bg-[var(--line)] dark:bg-neutral-700'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function summarizeClauseNumbers(clauses: CertificationClause[]): string {
  if (clauses.length === 0) return 'কোনোটি নেই';
  if (clauses.length === 1) return clauses[0].numberBn;
  return clauses.map((c) => c.numberBn).join(', ');
}

export function Tr21SetupPage() {
  const { userDoc, isSuperAdmin } = useAuth();
  const {
    officeSettings,
    selectedFy,
    currentOfficeId,
    currentOfficeRole,
    isAllOfficesMode,
    isLegacyPreMigration,
    actorSnapshot,
    getHead,
    pushToast,
    t,
    reportPermissionError,
    clearPermissionError,
  } = useApp();

  const realOfficeId =
    currentOfficeId &&
    currentOfficeId !== ALL_OFFICES_ID &&
    currentOfficeId !== LEGACY_UNMIGRATED_OFFICE_ID
      ? currentOfficeId
      : '';

  const canEditOfficeName = isSuperAdmin;
  const canEditTr21 = Boolean(
    canEditOfficeBasic({ isSuperAdmin, officeRole: currentOfficeRole }) &&
      (realOfficeId || (isLegacyPreMigration && isSuperAdmin))
  );
  const effectiveActor =
    actorSnapshot || (userDoc ? { uid: userDoc.id, name: userDoc.name } : null);

  // Refs to preserve ministry/mobile values across Show switch toggles without adding disallowed Firestore keys
  const savedMinistryRef = useRef(officeSettings.ministryName || DEFAULT_MINISTRY_FALLBACK);
  const savedMobileRef = useRef(officeSettings.officeMobileNo || DEFAULT_MOBILE_FALLBACK);

  const savedMarginsFromSettings = useMemo(
    () => resolveTr21Margins(officeSettings.tr21Margins, officeSettings.tr21VoucherLabel),
    [officeSettings.tr21Margins, officeSettings.tr21VoucherLabel]
  );

  // Editable form state synced from officeSettings
  const [ministryName, setMinistryName] = useState(officeSettings.ministryName || '');
  const [officeName, setOfficeName] = useState(officeSettings.officeName);
  const [officeAddress, setOfficeAddress] = useState(officeSettings.address || '');
  const [officeMobileNo, setOfficeMobileNo] = useState(officeSettings.officeMobileNo || '');
  const [institutionalCode, setInstitutionalCode] = useState(
    officeSettings.institutionalCode || ''
  );
  const [tr21FontFamily, setTr21FontFamily] = useState(
    resolveTr21FontFamily(officeSettings.tr21FontFamily)
  );
  const [tr21FontSize, setTr21FontSize] = useState(
    resolveTr21FontSize(officeSettings.tr21FontSize)
  );
  const [marginInputs, setMarginInputs] = useState<MarginInputStrings>(() =>
    marginsToStrings(savedMarginsFromSettings)
  );
  const [tr21FooterText, setTr21FooterText] = useState(
    officeSettings.tr21FooterText || DEFAULT_TR21_FOOTER_TEXT
  );
  const [tr21Clauses, setTr21Clauses] = useState<CertificationClause[]>(() =>
    resolveTr21Clauses(officeSettings.tr21Clauses)
  );
  const [saving, setSaving] = useState(false);

  // Accordion state (Step 1 open by default)
  const [openSteps, setOpenSteps] = useState<Record<AccordionStep, boolean>>({
    1: true,
    2: false,
    3: false,
  });

  // UI & Preview controls
  const [clauseFilter, setClauseFilter] = useState<ClauseFilter>('all');
  const [rangeFrom, setRangeFrom] = useState<number>(1);
  const [rangeTo, setRangeTo] = useState<number>(4);
  const [rangePage, setRangePage] = useState<1 | 2>(1);
  const [clauseModal, setClauseModal] = useState<ClauseModalState | null>(null);
  const [clauseInitial, setClauseInitial] = useState<Pick<
    ClauseModalState,
    'numberBn' | 'page' | 'enabled' | 'text'
  > | null>(null);
  const [clauseTextError, setClauseTextError] = useState('');
  const clauseFormRef = useRef<HTMLFormElement>(null);
  const [confirmDeleteClause, setConfirmDeleteClause] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>('setup');
  const [previewSourceId, setPreviewSourceId] = useState<'sample' | string>('sample');
  const [sampleAsDraft, setSampleAsDraft] = useState(false);
  const [showSectionGuides, setShowSectionGuides] = useState(false);
  const [zoomMultiplier, setZoomMultiplier] = useState(1);
  const [busyAction, setBusyAction] = useState<'print' | 'pdf' | 'docx' | null>(null);

  // Live Firestore bills & budgets for real-bill previewing
  const [fyBills, setFyBills] = useState<BillDoc[]>([]);
  const [fyBudgets, setFyBudgets] = useState<BudgetDoc[]>([]);

  // Scaled preview viewport measurement
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(A4_WIDTH_PX);
  const [innerHeight, setInnerHeight] = useState(2260);

  useEffect(() => {
    void ensureBengaliFontsLoaded();
  }, []);

  const resetFields = useCallback(() => {
    const nextMin = officeSettings.ministryName || '';
    const nextMob = officeSettings.officeMobileNo || '';
    if (nextMin.trim()) savedMinistryRef.current = nextMin;
    if (nextMob.trim()) savedMobileRef.current = nextMob;

    setMinistryName(nextMin);
    setOfficeName(officeSettings.officeName);
    setOfficeAddress(officeSettings.address || '');
    setOfficeMobileNo(nextMob);
    setInstitutionalCode(officeSettings.institutionalCode || '');
    setTr21FontFamily(resolveTr21FontFamily(officeSettings.tr21FontFamily));
    setTr21FontSize(resolveTr21FontSize(officeSettings.tr21FontSize));
    setMarginInputs(marginsToStrings(savedMarginsFromSettings));
    setTr21FooterText(officeSettings.tr21FooterText || DEFAULT_TR21_FOOTER_TEXT);
    setTr21Clauses(resolveTr21Clauses(officeSettings.tr21Clauses));
  }, [officeSettings, savedMarginsFromSettings]);

  useEffect(() => {
    resetFields();
  }, [resetFields]);

  useEffect(() => {
    if (!currentOfficeId || isAllOfficesMode) {
      setFyBills([]);
      setFyBudgets([]);
      return;
    }

    const qBills = isLegacyPreMigration
      ? query(
          collection(db, 'bills'),
          where('fiscalYear', '==', selectedFy),
          where('deleted', '==', false)
        )
      : query(
          collection(db, 'bills'),
          where('officeId', '==', currentOfficeId),
          where('fiscalYear', '==', selectedFy),
          where('deleted', '==', false)
        );
    const unsubBills = onSnapshot(
      qBills,
      (snap) => {
        clearPermissionError('bills');
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as BillDoc))
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setFyBills(list);
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'bills');
        if (isPermissionDeniedError(err)) reportPermissionError('bills');
      }
    );

    const qBudgets = isLegacyPreMigration
      ? query(
          collection(db, 'budgets'),
          where('fiscalYear', '==', selectedFy),
          where('deleted', '==', false)
        )
      : query(
          collection(db, 'budgets'),
          where('officeId', '==', currentOfficeId),
          where('fiscalYear', '==', selectedFy),
          where('deleted', '==', false)
        );
    const unsubBudgets = onSnapshot(
      qBudgets,
      (snap) => {
        clearPermissionError('budgets');
        setFyBudgets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetDoc)));
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, 'budgets');
        if (isPermissionDeniedError(err)) reportPermissionError('budgets');
      }
    );

    return () => {
      unsubBills();
      unsubBudgets();
    };
  }, [
    selectedFy,
    currentOfficeId,
    isAllOfficesMode,
    isLegacyPreMigration,
    clearPermissionError,
    reportPermissionError,
  ]);

  useEffect(() => {
    const vp = viewportRef.current;
    const inner = innerRef.current;
    if (!vp) return;

    const updateSizes = () => {
      if (vp.clientWidth > 0) {
        setViewportWidth(vp.clientWidth);
      }
      if (inner && inner.scrollHeight > 0) {
        setInnerHeight(inner.scrollHeight);
      }
    };
    updateSizes();

    const ro = new ResizeObserver(() => updateSizes());
    ro.observe(vp);
    if (inner) ro.observe(inner);
    return () => ro.disconnect();
  }, [mobilePane, showSectionGuides, previewSourceId]);

  const parsedMargins: Tr21Margins = useMemo(
    () => ({
      top: clampTr21Margin(
        marginInputs.top === '' ? savedMarginsFromSettings.top : marginInputs.top,
        savedMarginsFromSettings.top
      ),
      right: clampTr21Margin(
        marginInputs.right === '' ? savedMarginsFromSettings.right : marginInputs.right,
        savedMarginsFromSettings.right
      ),
      bottom: clampTr21Margin(
        marginInputs.bottom === '' ? savedMarginsFromSettings.bottom : marginInputs.bottom,
        savedMarginsFromSettings.bottom
      ),
      left: clampTr21Margin(
        marginInputs.left === '' ? savedMarginsFromSettings.left : marginInputs.left,
        savedMarginsFromSettings.left
      ),
    }),
    [marginInputs, savedMarginsFromSettings]
  );

  const isDirty = useMemo(() => {
    const savedMinistry = officeSettings.ministryName || '';
    const savedAddress = officeSettings.address || '';
    const savedMobile = officeSettings.officeMobileNo || '';
    const savedCode = officeSettings.institutionalCode || '';
    const savedFooter = officeSettings.tr21FooterText || DEFAULT_TR21_FOOTER_TEXT;
    const savedFontFamily = resolveTr21FontFamily(officeSettings.tr21FontFamily);
    const savedFontSize = resolveTr21FontSize(officeSettings.tr21FontSize);
    const savedClauses = JSON.stringify(resolveTr21Clauses(officeSettings.tr21Clauses));
    const currentClauses = JSON.stringify(tr21Clauses);
    const marginsDirty =
      parsedMargins.top !== savedMarginsFromSettings.top ||
      parsedMargins.right !== savedMarginsFromSettings.right ||
      parsedMargins.bottom !== savedMarginsFromSettings.bottom ||
      parsedMargins.left !== savedMarginsFromSettings.left;

    return (
      ministryName.trim() !== savedMinistry.trim() ||
      (canEditOfficeName && officeName.trim() !== (officeSettings.officeName || '').trim()) ||
      officeAddress.trim() !== savedAddress.trim() ||
      officeMobileNo.trim() !== savedMobile.trim() ||
      institutionalCode !== savedCode ||
      tr21FooterText.trim() !== savedFooter.trim() ||
      tr21FontFamily !== savedFontFamily ||
      tr21FontSize !== savedFontSize ||
      marginsDirty ||
      currentClauses !== savedClauses
    );
  }, [
    officeSettings,
    canEditOfficeName,
    ministryName,
    officeName,
    officeAddress,
    officeMobileNo,
    institutionalCode,
    tr21FooterText,
    tr21FontFamily,
    tr21FontSize,
    parsedMargins,
    savedMarginsFromSettings,
    tr21Clauses,
  ]);

  const draftOfficeSettings: OfficeSettings = useMemo(
    () => ({
      ...officeSettings,
      ministryName: ministryName.trim(),
      officeName: officeName.trim() || officeSettings.officeName,
      address: officeAddress.trim(),
      officeMobileNo: officeMobileNo.trim(),
      institutionalCode: institutionalCode.replace(/\D+/g, '').slice(0, 13),
      tr21FooterText: tr21FooterText.trim() || DEFAULT_TR21_FOOTER_TEXT,
      tr21FontFamily,
      tr21FontSize,
      tr21Margins: parsedMargins,
      tr21VoucherLabel: serializeTr21MarginsToLabel(parsedMargins),
      tr21Clauses,
    }),
    [
      officeSettings,
      ministryName,
      officeName,
      officeAddress,
      officeMobileNo,
      institutionalCode,
      tr21FooterText,
      tr21FontFamily,
      tr21FontSize,
      parsedMargins,
      tr21Clauses,
    ]
  );

  const sampleBill: BillDoc = useMemo(() => {
    const fyStartYear = parseInt(selectedFy.split('-')[0], 10) || 2025;
    const billYmd = `${fyStartYear}-09-21`;
    const itCode = officeSettings.defaultItCode || DEFAULT_IT_CODE;
    const vatCode = officeSettings.defaultVatCode || DEFAULT_VAT_CODE;
    const secCode = officeSettings.defaultSecurityCode || DEFAULT_SECURITY_CODE;
    const netCode = officeSettings.defaultNetPayableCode || DEFAULT_NET_PAYABLE_CODE;
    const gross = 700000; // 7,000 টাকা
    const itAmt = 35000; // 5% = 350 টাকা
    const vatAmt = 70000; // 10% = 700 টাকা
    return {
      id: 'sample-tr21',
      officeId: realOfficeId || 'sample-office',
      billNo: sampleAsDraft ? '' : `${selectedFy}/04`,
      fiscalYear: selectedFy,
      economicCode: '3257301',
      headName: 'Ceremony & Festivals',
      headNameBn: 'অনুষ্ঠান / উৎসবাদি',
      date: billYmd,
      billDate: billYmd,
      tokenNo: '',
      purposeText: 'অনুষ্ঠান / উৎসবাদি বাবদ ব্যয়ের বিল।',
      payeeText: officeSettings.defaultPayeeText || 'ডি.ডি.ও',
      netPayableCode: netCode,
      supplier: null,
      deductions: [
        {
          id: 'it',
          code: itCode,
          name: 'ব্যক্তি কর্তৃক দেয় আয়কর',
          rate: 5,
          amount: itAmt,
          kind: 'it',
        },
        {
          id: 'vat',
          code: vatCode,
          name: 'দেশজ পণ্য ও সেবার ওপর মূসক',
          rate: 10,
          amount: vatAmt,
          kind: 'vat',
        },
        {
          id: 'security',
          code: secCode,
          name: 'ঠিকাদার নিরাপত্তা জমা',
          rate: 0,
          amount: 0,
          kind: 'security',
        },
      ],
      itemIds: ['sample-1', 'sample-2', 'sample-3', 'sample-4'],
      items: [
        {
          id: 'sample-1',
          date: billYmd,
          description: 'ব্যানার (৩×৮)',
          amount: 60000,
          responsibleEmployee: { name: 'মোঃ রফিকুল ইসলাম', designation: 'উচ্চমান সহকারী' },
        },
        {
          id: 'sample-2',
          date: billYmd,
          description: 'কেক ১৪×১৩০',
          amount: 182000,
          responsibleEmployee: { name: 'মোঃ রফিকুল ইসলাম', designation: 'উচ্চমান সহকারী' },
        },
        {
          id: 'sample-3',
          date: billYmd,
          description: 'মিষ্টি ৪×৩২০',
          amount: 128000,
          responsibleEmployee: { name: 'মোঃ রফিকুল ইসলাম', designation: 'উচ্চমান সহকারী' },
        },
        {
          id: 'sample-4',
          date: billYmd,
          description: 'অন্যান্য আপ্যায়ন সামগ্রী (পানি, বিস্কিট, চা)',
          amount: 330000,
          responsibleEmployee: { name: 'মোঃ রফিকুল ইসলাম', designation: 'উচ্চমান সহকারী' },
        },
      ],
      grossAmount: gross,
      vatRate: 10,
      itRate: 5,
      vatVariant: 'services',
      vatVariantLabel: 'সেবা',
      vatAmount: vatAmt,
      itAmount: itAmt,
      totalDeduction: itAmt + vatAmt,
      netPayable: gross - (itAmt + vatAmt),
      status: sampleAsDraft ? 'draft' : 'approved',
      submittedAt: null,
      approvedBy: null,
      approvedAt: null,
      rejectReason: null,
      cancelledBy: null,
      cancelledAt: null,
      cancelReason: null,
      deleted: false,
    };
  }, [
    realOfficeId,
    selectedFy,
    sampleAsDraft,
    officeSettings.defaultItCode,
    officeSettings.defaultVatCode,
    officeSettings.defaultSecurityCode,
    officeSettings.defaultNetPayableCode,
    officeSettings.defaultPayeeText,
  ]);

  const sampleBudget: BudgetDoc = useMemo(() => {
    const fyStartYear = parseInt(selectedFy.split('-')[0], 10) || 2025;
    return {
      id: 'sample-budget-tr21',
      officeId: realOfficeId || 'sample-office',
      fiscalYear: selectedFy,
      memoNo: '৩৮.০১.০০০০.০০৫.২০.০১১.২৫-৪২০',
      memoDate: `${fyStartYear}-07-24`,
      economicCode: '3257301',
      headName: 'Ceremony & Festivals',
      headNameBn: 'অনুষ্ঠান / উৎসবাদি',
      allocated: 700000,
      entryType: 'revision',
      revisionOf: null,
      deductionRates: {
        basis: 'gross',
        incomeTax: 5,
        vat: [{ key: 'services', label: 'সেবা (১০%)', rate: 10 }],
        serviceCharge: 0,
      },
      spent: 700000,
      approvedSpent: 700000,
      pendingAmount: 0,
      remaining: 0,
      status: 'active',
      deleted: false,
    };
  }, [realOfficeId, selectedFy]);

  const selectedRealBill = useMemo(
    () => (previewSourceId === 'sample' ? null : fyBills.find((b) => b.id === previewSourceId) || null),
    [previewSourceId, fyBills]
  );

  const previewFormData = useMemo(() => {
    if (selectedRealBill) {
      return buildTr21FormData({
        bill: selectedRealBill,
        officeSettings: draftOfficeSettings,
        budgets: fyBudgets,
        allBillsInFy: fyBills,
        getHead,
      });
    }
    return buildTr21FormData({
      bill: sampleBill,
      officeSettings: draftOfficeSettings,
      budgets: [sampleBudget],
      allBillsInFy: [],
      getHead,
    });
  }, [selectedRealBill, draftOfficeSettings, fyBudgets, fyBills, getHead, sampleBill, sampleBudget]);

  const baseFitScale = useMemo(() => {
    const available = Math.max(240, viewportWidth - 28);
    return Math.min(1.25, Math.max(0.25, available / A4_WIDTH_PX));
  }, [viewportWidth]);

  const effectiveScale = useMemo(
    () => Math.min(2, Math.max(0.2, baseFitScale * zoomMultiplier)),
    [baseFitScale, zoomMultiplier]
  );

  useEffect(() => {
    const maxPos = Math.max(1, tr21Clauses.length);
    setRangeFrom((prev) => Math.min(Math.max(1, prev), maxPos));
    setRangeTo((prev) => Math.min(Math.max(1, prev), maxPos));
  }, [tr21Clauses.length]);

  const clauseStats = useMemo(() => {
    const p1 = tr21Clauses.filter((c) => c.page === 1);
    const p2 = tr21Clauses.filter((c) => c.page === 2);
    const enabledCount = tr21Clauses.filter((c) => c.enabled).length;

    let firstPage2Idx = tr21Clauses.findIndex((c) => c.page === 2);
    if (firstPage2Idx === -1) firstPage2Idx = tr21Clauses.length;
    const isContiguousSplit = tr21Clauses.every((c, idx) =>
      idx < firstPage2Idx ? c.page === 1 : c.page === 2
    );

    return {
      page1Count: p1.length,
      page2Count: p2.length,
      enabledCount,
      page1Numbers: summarizeClauseNumbers(p1),
      page2Numbers: summarizeClauseNumbers(p2),
      contiguousSplitEnd: isContiguousSplit ? firstPage2Idx : -1,
    };
  }, [tr21Clauses]);

  const filteredClauses = useMemo(() => {
    return tr21Clauses
      .map((clause, index) => ({ clause, index }))
      .filter(({ clause }) => {
        if (clauseFilter === 'page1') return clause.page === 1;
        if (clauseFilter === 'page2') return clause.page === 2;
        return true;
      });
  }, [tr21Clauses, clauseFilter]);

  const toggleAccordionStep = (step: AccordionStep) => {
    setOpenSteps((prev) => ({ ...prev, [step]: !prev[step] }));
  };

  const handleQuickPageSplit = (p1EndCount: number) => {
    if (!canEditTr21) return;
    setTr21Clauses((prev) =>
      prev.map((c, idx) => ({
        ...c,
        page: idx < p1EndCount ? 1 : 2,
      }))
    );
  };

  const handleApplyRange = () => {
    if (!canEditTr21 || tr21Clauses.length === 0) return;
    const startPos = Math.min(rangeFrom, rangeTo);
    const endPos = Math.max(rangeFrom, rangeTo);
    setTr21Clauses((prev) =>
      prev.map((c, idx) => {
        const pos = idx + 1;
        if (pos >= startPos && pos <= endPos) {
          return { ...c, page: rangePage };
        }
        return c;
      })
    );
    pushToast(
      'success',
      `ক্রম ${toBanglaDigits(startPos)} থেকে ${toBanglaDigits(endPos)} পর্যন্ত ধারা পাতা ${
        rangePage === 1 ? '১' : '২'
      }-এ নির্ধারণ করা হয়েছে।`
    );
  };

  const handleMoveClause = (index: number, delta: -1 | 1) => {
    if (!canEditTr21) return;
    const target = index + delta;
    if (target < 0 || target >= tr21Clauses.length) return;
    setTr21Clauses((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const openCreateClauseModal = () => {
    if (!canEditTr21) return;
    const defaultNum = toBanglaDigits(tr21Clauses.length + 1);
    const defaultPage: 1 | 2 = clauseFilter === 'page1' ? 1 : 2;
    setConfirmDeleteClause(false);
    setClauseTextError('');
    setClauseInitial({
      numberBn: defaultNum,
      page: defaultPage,
      enabled: true,
      text: '',
    });
    setClauseModal({
      mode: 'create',
      index: null,
      id: `clause-${Date.now()}`,
      numberBn: defaultNum,
      page: defaultPage,
      enabled: true,
      text: '',
    });
  };

  const openEditClauseModal = (clause: CertificationClause, index: number) => {
    setConfirmDeleteClause(false);
    setClauseTextError('');
    setClauseInitial({
      numberBn: clause.numberBn,
      page: clause.page,
      enabled: clause.enabled,
      text: clause.text,
    });
    setClauseModal({
      mode: 'edit',
      index,
      id: clause.id,
      numberBn: clause.numberBn,
      page: clause.page,
      enabled: clause.enabled,
      text: clause.text,
    });
  };

  const closeClauseModal = () => {
    setClauseModal(null);
    setClauseInitial(null);
    setClauseTextError('');
    setConfirmDeleteClause(false);
  };

  const isClauseModalDirty = useMemo(() => {
    if (!clauseModal || !clauseInitial || !canEditTr21) return false;
    return (
      clauseModal.numberBn !== clauseInitial.numberBn ||
      clauseModal.page !== clauseInitial.page ||
      clauseModal.enabled !== clauseInitial.enabled ||
      clauseModal.text !== clauseInitial.text
    );
  }, [clauseModal, clauseInitial, canEditTr21]);

  const handleSaveClauseModal = () => {
    if (!canEditTr21 || !clauseModal) return;
    const cleanText = clauseModal.text.trim();
    if (!cleanText) {
      setClauseTextError('ধারার বিবরণ লিখুন।');
      pushToast('error', 'ধারার বিবরণ লিখুন।');
      requestAnimationFrame(() => focusFirstInvalidField(clauseFormRef.current));
      return;
    }
    setClauseTextError('');
    const cleanNum =
      clauseModal.numberBn.trim() ||
      toBanglaDigits(
        clauseModal.mode === 'create' ? tr21Clauses.length + 1 : (clauseModal.index ?? 0) + 1
      );

    if (clauseModal.mode === 'create') {
      setTr21Clauses((prev) => [
        ...prev,
        {
          id: clauseModal.id,
          numberBn: cleanNum,
          page: clauseModal.page,
          enabled: clauseModal.enabled,
          text: cleanText,
        },
      ]);
      pushToast('success', `ধারা ${cleanNum} যুক্ত হয়েছে। স্থায়ী করতে Save চাপুন।`);
    } else if (clauseModal.index !== null) {
      const targetIdx = clauseModal.index;
      setTr21Clauses((prev) =>
        prev.map((c, idx) =>
          idx === targetIdx
            ? {
                ...c,
                numberBn: cleanNum,
                page: clauseModal.page,
                enabled: clauseModal.enabled,
                text: cleanText,
              }
            : c
        )
      );
    }
    closeClauseModal();
  };

  const handleDeleteClauseFromModal = () => {
    if (!canEditTr21 || !clauseModal || clauseModal.mode !== 'edit' || clauseModal.index === null) {
      return;
    }
    if (tr21Clauses.length <= 1) {
      pushToast('error', 'অন্তত একটি ধারা রাখতে হবে।');
      return;
    }
    if (!confirmDeleteClause) {
      setConfirmDeleteClause(true);
      return;
    }
    const targetIdx = clauseModal.index;
    const removedNum = clauseModal.numberBn;
    setTr21Clauses((prev) => prev.filter((_, idx) => idx !== targetIdx));
    closeClauseModal();
    pushToast('info', `ধারা ${removedNum} তালিকা থেকে বাদ দেওয়া হয়েছে।`);
  };

  const cleanInstCode = useMemo(
    () => institutionalCode.replace(/\D+/g, '').slice(0, 13),
    [institutionalCode]
  );

  const codeSegmentPills = useMemo(() => {
    const padded = cleanInstCode.padEnd(13, '·');
    return [padded.slice(0, 1), padded.slice(1, 5), padded.slice(5, 9), padded.slice(9, 13)].map(
      (grp) => toBanglaDigits(grp)
    );
  }, [cleanInstCode]);

  const handleSave = async () => {
    if (!userDoc || !canEditTr21 || !effectiveActor) return;
    if (canEditOfficeName && !officeName.trim()) {
      pushToast('error', 'দপ্তরের নাম আবশ্যক।');
      return;
    }
    setSaving(true);
    try {
      await saveOfficeSettings(
        {
          ...(canEditOfficeName ? { officeName: officeName.trim() } : {}),
          ministryName: ministryName.trim(),
          address: officeAddress.trim(),
          officeMobileNo: officeMobileNo.trim(),
          institutionalCode: cleanInstCode,
          tr21FooterText: tr21FooterText.trim() || DEFAULT_TR21_FOOTER_TEXT,
          tr21FontFamily: tr21FontFamily || DEFAULT_TR21_FONT_FAMILY,
          tr21FontSize: tr21FontSize || DEFAULT_TR21_FONT_SIZE,
          tr21VoucherLabel: serializeTr21MarginsToLabel(parsedMargins),
          tr21Clauses,
        },
        effectiveActor,
        isLegacyPreMigration ? undefined : realOfficeId
      );
      setMarginInputs(marginsToStrings(parsedMargins));
      pushToast('success', 'টি.আর. ফরম নং-২১ সেটআপ সংরক্ষিত হয়েছে।');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'সংরক্ষণ করা যায়নি।');
    } finally {
      setSaving(false);
    }
  };

  const fileSegment = selectedRealBill ? sanitizeBillFileSegment(selectedRealBill) : 'tr21-sample';

  const handlePrint = async () => {
    if (busyAction) return;
    setBusyAction('print');
    try {
      const res = await printTr21Form(previewFormData, fileSegment);
      if (res.status === 'shared') {
        pushToast('success', 'PDF তৈরি হয়েছে — প্রিন্ট বা সেভ করার অ্যাপ বেছে নিন।');
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Print failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportPdf = async () => {
    if (busyAction) return;
    setBusyAction('pdf');
    try {
      const res = await exportTr21Pdf(previewFormData, fileSegment);
      if (res.status === 'shared') {
        pushToast('success', 'PDF তৈরি হয়েছে — সংরক্ষণ বা শেয়ার করুন।');
      } else if (res.status === 'downloaded') {
        pushToast('success', `${res.fileName} ডাউনলোড হয়েছে।`);
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'PDF export failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportDocx = async () => {
    if (busyAction) return;
    setBusyAction('docx');
    try {
      const res = await exportTr21Docx(previewFormData, fileSegment);
      if (res.status === 'shared') {
        pushToast('success', 'Word (.docx) ফাইল তৈরি হয়েছে — ওপেন বা সেভ করুন।');
      } else if (res.status === 'downloaded') {
        pushToast('success', `${res.fileName} ডাউনলোড হয়েছে।`);
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Word export failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const showMinistry = Boolean(ministryName.trim());
  const showMobile = Boolean(officeMobileNo.trim());
  const activeFontLabel =
    TR21_FONT_OPTIONS.find((opt) => opt.value === tr21FontFamily)?.label || tr21FontFamily;
  const isDefaultTypographyAndMargins =
    tr21FontFamily === DEFAULT_TR21_FONT_FAMILY &&
    tr21FontSize === DEFAULT_TR21_FONT_SIZE &&
    parsedMargins.top === DEFAULT_TR21_MARGINS.top &&
    parsedMargins.right === DEFAULT_TR21_MARGINS.right &&
    parsedMargins.bottom === DEFAULT_TR21_MARGINS.bottom &&
    parsedMargins.left === DEFAULT_TR21_MARGINS.left;

  const updateMarginInput = (side: keyof MarginInputStrings, value: string) => {
    setMarginInputs((prev) => ({ ...prev, [side]: value }));
  };

  const normalizeMarginOnBlur = (side: keyof MarginInputStrings) => {
    const fallback = DEFAULT_TR21_MARGINS[side];
    const clamped = clampTr21Margin(marginInputs[side], fallback);
    setMarginInputs((prev) => ({ ...prev, [side]: String(clamped) }));
  };

  if (isAllOfficesMode || (!currentOfficeId && !isLegacyPreMigration)) {
    return (
      <Layout title={t('navTr21Setup')}>
        <PageHeader title={t('navTr21Setup')} />
        <div className="card-surface p-6 text-center space-y-2 max-w-lg mx-auto">
          <h2 className="text-base font-bold text-[var(--text)]">একটি অফিস নির্বাচন করুন</h2>
          <p className="text-xs sm:text-sm text-[var(--muted)]">
            {isSuperAdmin
              ? 'কোনো অফিসের টি.আর. ফরম নং-২১ সেটআপ দেখতে বা সম্পাদনা করতে উপরের অফিস সুইচার থেকে একটি নির্দিষ্ট অফিস নির্বাচন করুন।'
              : 'আপনার জন্য কোনো সক্রিয় অফিস নির্ধারিত নেই।'}
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      title={t('navTr21Setup')}
      saveBar={{
        visible: canEditTr21 && isDirty,
        saving,
        onSave: handleSave,
        onDiscard: resetFields,
      }}
    >
      <PageHeader title={t('navTr21Setup')} />

      {!canEditTr21 && (
        <div className="mb-4 px-4 py-3 rounded-[14px] border border-[var(--line)] bg-[var(--card)] text-xs md:text-sm text-[var(--muted)]">
          শুধুমাত্র সুপার অ্যাডমিন বা সংশ্লিষ্ট অফিসের DDO টি.আর. ফরম নং-২১ সেটআপ পরিবর্তন ও সংরক্ষণ করতে পারবেন। আপনি বর্তমান কনফিগারেশন ও লাইভ প্রিভিউ দেখতে এবং টেস্ট এক্সপোর্ট করতে পারেন।
        </div>
      )}

      {/* Mobile Segmented Tab Bar */}
      <div
        role="tablist"
        aria-label="টি.আর. ফরম ২১ ভিউ"
        className="md:hidden mb-3.5 grid grid-cols-2 gap-1 p-1 rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)]"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'setup'}
          onClick={() => setMobilePane('setup')}
          className={`min-h-[40px] px-3 rounded-[9px] text-xs font-semibold transition-all ${
            mobilePane === 'setup'
              ? 'bg-[var(--card)] text-[var(--text)] shadow-sm'
              : 'text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          ফরম সেটআপ
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'preview'}
          onClick={() => setMobilePane('preview')}
          className={`min-h-[40px] px-3 rounded-[9px] text-xs font-semibold transition-all ${
            mobilePane === 'preview'
              ? 'bg-[var(--card)] text-[var(--text)] shadow-sm'
              : 'text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          লাইভ প্রিভিউ
        </button>
      </div>

      {/* Main 2-column grid on md+ with sticky live preview */}
      <div className="grid grid-cols-1 md:grid-cols-[minmax(300px,2fr)_minmax(0,3fr)] gap-4 lg:gap-5 items-start">
        {/* ================= LEFT COLUMN: 3 ACCORDION CARDS ================= */}
        <div
          className={`min-w-0 space-y-3.5 ${
            mobilePane === 'setup' ? 'block' : 'hidden md:block'
          }`}
        >
          {/* 1. Header & office */}
          <AccordionCard
            step={1}
            title="শিরোনাম, দপ্তর ও কোড নং"
            subtitle={officeName || 'দপ্তরের নাম লিখুন'}
            open={openSteps[1]}
            onToggle={() => toggleAccordionStep(1)}
          >
            {/* Ministry + Show switch */}
            <div className="flex items-end gap-3">
              <div className="flex-1 min-w-0">
                <label
                  htmlFor="tr21-ministry-name"
                  className="block text-xs font-semibold text-[var(--muted)] mb-1.5"
                >
                  মন্ত্রণালয় / ঊর্ধ্বতন দপ্তর
                </label>
                <input
                  id="tr21-ministry-name"
                  type="text"
                  disabled={!canEditTr21}
                  value={ministryName}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.trim()) savedMinistryRef.current = val;
                    setMinistryName(val);
                  }}
                  placeholder={DEFAULT_MINISTRY_FALLBACK}
                  className="w-full min-h-[44px] px-3.5 rounded-[10px] border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
                />
              </div>
              <div className="flex flex-col items-center shrink-0 pb-1.5">
                <span className="text-[11px] font-semibold text-[var(--muted)] mb-1">
                  দেখাবে
                </span>
                <ToggleSwitch
                  checked={showMinistry}
                  disabled={!canEditTr21}
                  ariaLabel="ফরমে মন্ত্রণালয়ের নাম দেখান"
                  onChange={(next) => {
                    if (next) {
                      setMinistryName(savedMinistryRef.current || DEFAULT_MINISTRY_FALLBACK);
                    } else {
                      if (ministryName.trim()) savedMinistryRef.current = ministryName;
                      setMinistryName('');
                    }
                  }}
                />
              </div>
            </div>

            {/* Office name */}
            <div>
              <label
                htmlFor="tr21-office-name"
                className="block text-xs font-semibold text-[var(--muted)] mb-1.5"
              >
                দপ্তরের নাম
              </label>
              <input
                id="tr21-office-name"
                type="text"
                disabled={!canEditOfficeName}
                value={officeName}
                onChange={(e) => setOfficeName(e.target.value)}
                placeholder="উপজেলা উপানুষ্ঠানিক শিক্ষা ব্যুরো"
                className="w-full min-h-[44px] px-3.5 rounded-[10px] border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
              />
              {!canEditOfficeName && canEditTr21 && (
                <p className="text-[11px] text-[var(--muted)] mt-1">
                  দপ্তরের নাম শুধুমাত্র সুপার অ্যাডমিন পরিবর্তন করতে পারবেন।
                </p>
              )}
            </div>

            {/* Address */}
            <div>
              <label
                htmlFor="tr21-office-address"
                className="block text-xs font-semibold text-[var(--muted)] mb-1.5"
              >
                দপ্তরের ঠিকানা
              </label>
              <input
                id="tr21-office-address"
                type="text"
                disabled={!canEditTr21}
                value={officeAddress}
                onChange={(e) => setOfficeAddress(e.target.value)}
                placeholder="তারাকান্দা, ময়মনসিংহ"
                className="w-full min-h-[44px] px-3.5 rounded-[10px] border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
              />
            </div>

            {/* Mobile + Show switch */}
            <div className="flex items-end gap-3">
              <div className="flex-1 min-w-0">
                <label
                  htmlFor="tr21-mobile-no"
                  className="block text-xs font-semibold text-[var(--muted)] mb-1.5"
                >
                  মোবাইল নং (ডান শীর্ষে)
                </label>
                <input
                  id="tr21-mobile-no"
                  type="text"
                  inputMode="tel"
                  disabled={!canEditTr21}
                  value={officeMobileNo}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.trim()) savedMobileRef.current = val;
                    setOfficeMobileNo(val);
                  }}
                  placeholder={DEFAULT_MOBILE_FALLBACK}
                  className="w-full min-h-[44px] px-3.5 rounded-[10px] border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
                />
              </div>
              <div className="flex flex-col items-center shrink-0 pb-1.5">
                <span className="text-[11px] font-semibold text-[var(--muted)] mb-1">
                  দেখাবে
                </span>
                <ToggleSwitch
                  checked={showMobile}
                  disabled={!canEditTr21}
                  ariaLabel="ফরমে মোবাইল নম্বর দেখান"
                  onChange={(next) => {
                    if (next) {
                      setOfficeMobileNo(savedMobileRef.current || DEFAULT_MOBILE_FALLBACK);
                    } else {
                      if (officeMobileNo.trim()) savedMobileRef.current = officeMobileNo;
                      setOfficeMobileNo('');
                    }
                  }}
                />
              </div>
            </div>

            {/* Institutional Code 13-digit + segmented pills preview */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor="tr21-inst-code"
                  className="block text-xs font-semibold text-[var(--muted)]"
                >
                  কোড নং · ১৩ ডিজিট, ১-৪-৪-৪ বিন্যাস
                </label>
                {canEditTr21 && institutionalCode !== DEFAULT_INSTITUTIONAL_CODE && (
                  <button
                    type="button"
                    onClick={() => setInstitutionalCode(DEFAULT_INSTITUTIONAL_CODE)}
                    className="text-xs font-semibold text-[var(--accent)] hover:underline whitespace-nowrap"
                  >
                    নমুনা কোড
                  </button>
                )}
              </div>
              <input
                id="tr21-inst-code"
                type="text"
                inputMode="numeric"
                maxLength={13}
                disabled={!canEditTr21}
                value={institutionalCode}
                onChange={(e) =>
                  setInstitutionalCode(e.target.value.replace(/\D+/g, '').slice(0, 13))
                }
                placeholder="1240303000000"
                className="w-full min-h-[44px] px-3.5 rounded-[10px] border border-[var(--line)] bg-[var(--card)] text-base md:text-sm text-[var(--text)] tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
              />
              <div
                className="flex flex-wrap items-center gap-1.5 mt-2.5 font-bold text-[var(--accent)]"
                aria-label="১-৪-৪-৪ কোড বক্স প্রিভিউ"
              >
                {codeSegmentPills.map((seg, idx) => (
                  <React.Fragment key={idx}>
                    {idx > 0 && <span className="text-[var(--muted)]">–</span>}
                    <span className="px-2.5 py-1 rounded-lg bg-[var(--accent-soft)] text-xs sm:text-sm tracking-wider tabular-nums">
                      {seg}
                    </span>
                  </React.Fragment>
                ))}
              </div>
              <p
                className={`text-xs mt-1.5 tabular-nums ${
                  cleanInstCode.length === 13
                    ? 'text-[var(--muted)]'
                    : 'text-[var(--danger-text)] font-medium'
                }`}
              >
                {cleanInstCode.length === 13
                  ? '১৩ ডিজিট সম্পূর্ণ হয়েছে'
                  : `আরও ${toBanglaDigits(13 - cleanInstCode.length)}টি ডিজিট প্রয়োজন`}
              </p>
            </div>
          </AccordionCard>

          {/* 2. Font, size, margin (inch) & footer */}
          <AccordionCard
            step={2}
            title="ফন্ট, সাইজ, মার্জিন ও ফুটার"
            subtitle={`${activeFontLabel} · ${toBanglaDigits(tr21FontSize)} px · মার্জিন ${parsedMargins.top}″/${parsedMargins.right}″/${parsedMargins.bottom}″/${parsedMargins.left}″`}
            open={openSteps[2]}
            onToggle={() => toggleAccordionStep(2)}
          >
            {/* Font & Size */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="tr21-font-family"
                  className="block text-xs font-semibold text-[var(--muted)] mb-1.5"
                >
                  ফর্মের ফন্ট
                </label>
                <Select
                  id="tr21-font-family"
                  modalTitle="ফর্মের ফন্ট নির্বাচন করুন"
                  searchable={false}
                  clearable={false}
                  disabled={!canEditTr21}
                  value={tr21FontFamily}
                  onChange={(e) => setTr21FontFamily(e.target.value)}
                >
                  {TR21_FONT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label
                  htmlFor="tr21-font-size"
                  className="block text-xs font-semibold text-[var(--muted)] mb-1.5"
                >
                  ফন্ট সাইজ
                </label>
                <Select
                  id="tr21-font-size"
                  modalTitle="ফন্ট সাইজ নির্বাচন করুন"
                  searchable={false}
                  clearable={false}
                  disabled={!canEditTr21}
                  value={String(tr21FontSize)}
                  onChange={(e) => setTr21FontSize(resolveTr21FontSize(Number(e.target.value)))}
                >
                  {TR21_FONT_SIZE_OPTIONS.map((sz) => (
                    <option key={sz} value={sz}>
                      {toBanglaDigits(sz)} px{sz === DEFAULT_TR21_FONT_SIZE ? ' (ডিফল্ট)' : ''}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Page Margins (inch) */}
            <div className="pt-1 border-t border-[var(--line)]">
              <div className="flex items-center justify-between gap-2 mb-2 pt-2">
                <span className="text-xs font-semibold text-[var(--muted)]">
                  পাতার মার্জিন (একক: ইঞ্চি / inch)
                </span>
                {canEditTr21 && !isDefaultTypographyAndMargins && (
                  <button
                    type="button"
                    onClick={() => {
                      setTr21FontFamily(DEFAULT_TR21_FONT_FAMILY);
                      setTr21FontSize(DEFAULT_TR21_FONT_SIZE);
                      setMarginInputs(marginsToStrings(DEFAULT_TR21_MARGINS));
                    }}
                    className="text-xs font-semibold text-[var(--accent)] hover:underline whitespace-nowrap"
                  >
                    ডিফল্ট রিসেট
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {(
                  [
                    { key: 'top', label: 'Top (উপরে)' },
                    { key: 'bottom', label: 'Bottom (নিচে)' },
                    { key: 'left', label: 'Left (বামে)' },
                    { key: 'right', label: 'Right (ডানে)' },
                  ] as const
                ).map((item) => (
                  <div key={item.key}>
                    <label
                      htmlFor={`tr21-margin-${item.key}`}
                      className="block text-[11px] font-semibold text-[var(--muted)] mb-1"
                    >
                      {item.label}
                    </label>
                    <div className="relative flex items-center">
                      <input
                        id={`tr21-margin-${item.key}`}
                        type="number"
                        inputMode="decimal"
                        step="0.05"
                        min="0"
                        max="2.5"
                        disabled={!canEditTr21}
                        value={marginInputs[item.key]}
                        onChange={(e) => updateMarginInput(item.key, e.target.value)}
                        onBlur={() => normalizeMarginOnBlur(item.key)}
                        className="w-full min-h-[44px] pl-3 pr-10 rounded-[10px] border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
                      />
                      <span className="absolute right-2.5 text-[11px] font-medium text-[var(--muted)] pointer-events-none">
                        inch
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer Text (moved here) */}
            <div className="pt-1 border-t border-[var(--line)]">
              <label
                htmlFor="tr21-footer-text"
                className="block text-xs font-semibold text-[var(--muted)] mb-1.5 pt-2"
              >
                ফুটার লেখা (Footer)
              </label>
              <input
                id="tr21-footer-text"
                type="text"
                disabled={!canEditTr21}
                value={tr21FooterText}
                onChange={(e) => setTr21FooterText(e.target.value)}
                placeholder="Print By: DPE Accounting Information System"
                className="w-full min-h-[44px] px-3.5 rounded-[10px] border border-[var(--line)] bg-[var(--card)] text-base md:text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
              />
            </div>
          </AccordionCard>

          {/* 3. Declaration clauses */}
          <AccordionCard
            step={3}
            title="প্রত্যয়ন ও শর্তাবলি ধারা"
            subtitle={`${toBanglaDigits(clauseStats.enabledCount)} / ${toBanglaDigits(
              tr21Clauses.length
            )}টি সক্রিয় · পাতা ১ (${clauseStats.page1Numbers}) · পাতা ২ (${clauseStats.page2Numbers})`}
            open={openSteps[3]}
            onToggle={() => toggleAccordionStep(3)}
          >
            {/* Quick prefix split */}
            {canEditTr21 && tr21Clauses.length > 0 && (
              <div className="space-y-2.5">
                <div>
                  <label
                    htmlFor="tr21-quick-split"
                    className="block text-xs font-semibold text-[var(--muted)] mb-1.5"
                  >
                    পাতা ১-এ কত নম্বর ধারা পর্যন্ত থাকবে
                  </label>
                  <Select
                    id="tr21-quick-split"
                    modalTitle="পাতা ১-এ কত নম্বর ধারা পর্যন্ত থাকবে"
                    searchable={false}
                    clearable={false}
                    value={String(clauseStats.contiguousSplitEnd)}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 0) handleQuickPageSplit(val);
                    }}
                  >
                    {clauseStats.contiguousSplitEnd === -1 && (
                      <option value={-1}>কাস্টম বিন্যাস</option>
                    )}
                    <option value={0}>০টি (সবগুলো পাতা ২-এ)</option>
                    {tr21Clauses.map((c, idx) => (
                      <option key={c.id} value={idx + 1}>
                        {toBanglaDigits(idx + 1)} নম্বর ধারা পর্যন্ত (বাকি পাতা ২-এ)
                      </option>
                    ))}
                  </Select>
                </div>

                {/* Expandable Range assignment */}
                <details className="rounded-[10px] border border-[var(--line)] bg-[var(--surface-subtle)] px-3 py-1">
                  <summary className="min-h-[40px] flex items-center text-xs font-semibold text-[var(--muted)] cursor-pointer select-none">
                    কাস্টম রেঞ্জ দিয়ে পাতা নির্ধারণ
                  </summary>
                  <div className="pb-2.5 pt-1 flex flex-wrap items-center gap-2 text-xs">
                    <div className="min-w-[100px]">
                      <Select
                        variant="compact"
                        modalTitle="শুরু ধারা"
                        aria-label="শুরু ধারা"
                        searchable={false}
                        clearable={false}
                        value={String(rangeFrom)}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setRangeFrom(v);
                          if (v > rangeTo) setRangeTo(v);
                        }}
                      >
                        {tr21Clauses.map((c, idx) => (
                          <option key={c.id} value={idx + 1}>
                            ধারা {c.numberBn}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <span className="text-[var(--muted)]">থেকে</span>
                    <div className="min-w-[100px]">
                      <Select
                        variant="compact"
                        modalTitle="শেষ ধারা"
                        aria-label="শেষ ধারা"
                        searchable={false}
                        clearable={false}
                        value={String(rangeTo)}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setRangeTo(v);
                          if (v < rangeFrom) setRangeFrom(v);
                        }}
                      >
                        {tr21Clauses.map((c, idx) => (
                          <option key={c.id} value={idx + 1}>
                            ধারা {c.numberBn}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <span className="text-[var(--muted)]">→</span>
                    <div className="min-w-[130px]">
                      <Select
                        variant="compact"
                        modalTitle="গন্তব্য পাতা"
                        aria-label="গন্তব্য পাতা"
                        searchable={false}
                        clearable={false}
                        value={String(rangePage)}
                        onChange={(e) => setRangePage(Number(e.target.value) === 2 ? 2 : 1)}
                      >
                        <option value={1}>পাতা ১ (P1-S5)</option>
                        <option value={2}>পাতা ২ (P2-S1)</option>
                      </Select>
                    </div>
                    <button
                      type="button"
                      onClick={handleApplyRange}
                      className="min-h-[38px] px-3 rounded-lg border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-soft)] text-xs font-semibold whitespace-nowrap"
                    >
                      প্রয়োগ
                    </button>
                  </div>
                </details>
              </div>
            )}

            {/* Page Filter Chips */}
            <SegmentedChips
              ariaLabel="ধারা ফিল্টার"
              value={clauseFilter}
              onChange={setClauseFilter}
              options={[
                { value: 'all', label: 'সকল', count: tr21Clauses.length },
                { value: 'page1', label: 'পাতা ১', count: clauseStats.page1Count },
                { value: 'page2', label: 'পাতা ২', count: clauseStats.page2Count },
              ]}
            />

            {/* Compact Clause Rows */}
            <div className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
              {filteredClauses.length === 0 ? (
                <div className="py-6 text-center text-xs text-[var(--muted)]">
                  এই পাতায় কোনো ধারা নেই।
                </div>
              ) : (
                filteredClauses.map(({ clause, index }) => (
                  <div
                    key={clause.id}
                    className={`py-2.5 flex items-center gap-2.5 transition-opacity ${
                      clause.enabled ? 'opacity-100' : 'opacity-60'
                    }`}
                  >
                    {/* Numbered badge: teal-soft for Page 1, warm amber for Page 2 */}
                    <span
                      className={`w-8 h-8 rounded-[9px] flex items-center justify-center font-bold text-xs shrink-0 bn tabular-nums ${
                        clause.page === 2
                          ? 'bg-[var(--warn-bg)] text-[var(--warn-text)]'
                          : 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      }`}
                      title={`পাতা ${clause.page === 1 ? '১' : '২'}`}
                    >
                      {clause.numberBn}
                    </span>

                    {/* Clause summary text */}
                    <button
                      type="button"
                      onClick={() => openEditClauseModal(clause, index)}
                      className="flex-1 min-w-0 text-left group py-0.5"
                    >
                      <span className="block text-[13px] bn text-[var(--text)] line-clamp-2 group-hover:text-[var(--accent)] transition-colors">
                        {clause.text}
                      </span>
                      <span className="block text-[11px] text-[var(--muted)] mt-0.5">
                        পাতা {clause.page === 1 ? '১ · P1-S5' : '২ · P2-S1'}
                        {!clause.enabled ? ' · পেজে লুকানো' : ''}
                      </span>
                    </button>

                    {/* Reorder + Edit + Visibility Switch */}
                    <div className="flex items-center gap-1 shrink-0">
                      {canEditTr21 && (
                        <div className="flex flex-col">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => handleMoveClause(index, -1)}
                            aria-label={`ধারা ${clause.numberBn} উপরে নিন`}
                            className="p-1 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-25"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={index === tr21Clauses.length - 1}
                            onClick={() => handleMoveClause(index, 1)}
                            aria-label={`ধারা ${clause.numberBn} নিচে নিন`}
                            className="p-1 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-25"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => openEditClauseModal(clause, index)}
                        aria-label={
                          canEditTr21
                            ? `ধারা ${clause.numberBn} সম্পাদনা`
                            : `ধারা ${clause.numberBn} দেখুন`
                        }
                        className="w-9 h-9 rounded-lg border border-[var(--line)] hover:bg-[var(--surface-subtle)] text-[var(--text)] inline-flex items-center justify-center shrink-0"
                      >
                        {canEditTr21 ? (
                          <Pencil className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <ToggleSwitch
                        checked={clause.enabled}
                        disabled={!canEditTr21}
                        ariaLabel={`ধারা ${clause.numberBn} দেখান`}
                        onChange={(checked) => {
                          setTr21Clauses((prev) =>
                            prev.map((c, cIdx) =>
                              cIdx === index ? { ...c, enabled: checked } : c
                            )
                          );
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>

            {canEditTr21 && (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={openCreateClauseModal}
                  className="min-h-[42px] px-4 rounded-[10px] border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text)] inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>নতুন ধারা</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTr21Clauses(cloneDefaultTr21Clauses())}
                  className="min-h-[42px] px-4 rounded-[10px] border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text)] inline-flex items-center gap-1.5"
                  title="ডিফল্ট ১–৭ ধারা পুনরুদ্ধার করুন"
                >
                  <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                  <span>ডিফল্ট পুনরুদ্ধার</span>
                </button>
              </div>
            )}
          </AccordionCard>

          {/* Collapsible Section Directory Reference */}
          <details className="card-surface px-4 sm:px-5 py-2">
            <summary className="min-h-[48px] flex items-center justify-between gap-2 text-sm font-semibold text-[var(--text)] cursor-pointer select-none">
              <span>ফর্মের সেকশন সূচি (P1-S1 থেকে P2-S5)</span>
              <span className="text-xs font-normal text-[var(--muted)]">
                {toBanglaDigits(TR21_FORM_SECTIONS.length)}টি সেকশন
              </span>
            </summary>
            <div className="divide-y divide-[var(--line)] border-t border-[var(--line)] pt-1 pb-2 text-xs">
              {TR21_FORM_SECTIONS.map((sec) => (
                <div key={sec.id} className="py-2 flex items-start gap-2.5">
                  <span
                    className="font-mono font-semibold shrink-0 tabular-nums"
                    style={{ color: sec.color }}
                  >
                    {sec.id}
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <div className="font-semibold text-[var(--text)]">
                      {sec.titleBn} · পাতা {sec.page === 1 ? '১' : '২'}
                    </div>
                    <div className="text-[var(--muted)] leading-snug">{sec.summaryBn}</div>
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>

        {/* ================= RIGHT COLUMN: STICKY PREVIEW & EXPORTS ================= */}
        <div
          className={`min-w-0 space-y-3 md:sticky md:top-20 ${
            mobilePane === 'preview' ? 'block' : 'hidden md:block'
          }`}
        >
          {/* Preview Controls + Export Actions Card */}
          <section className="card-surface p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="tr21-preview-source" className="sr-only">
                প্রিভিউ ডেটা সোর্স
              </label>
              <div className="flex-1 min-w-[180px]">
                <Select
                  id="tr21-preview-source"
                  variant="compact"
                  modalTitle="প্রিভিউ ডেটা সোর্স নির্বাচন করুন"
                  clearable={false}
                  value={previewSourceId}
                  onChange={(e) => setPreviewSourceId(e.target.value)}
                  options={[
                    { value: 'sample', label: 'নমুনা বিল (টেমপ্লেট)' },
                    ...fyBills.map((b) => ({
                      value: b.id,
                      label: b.billNo ? `বিল ${b.billNo}` : `খসড়া (${b.economicCode})`,
                      subtitle: `কোড: ${b.economicCode}`,
                      metaRight: b.date,
                      keywords: `${b.billNo || ''} ${b.economicCode} ${b.date}`,
                    })),
                  ]}
                />
              </div>

              {previewSourceId === 'sample' && (
                <div
                  className="inline-flex p-1 rounded-[10px] bg-[var(--surface-subtle)] border border-[var(--line)] shrink-0"
                  role="group"
                  aria-label="নমুনা বিলের ধরন"
                >
                  <button
                    type="button"
                    aria-pressed={!sampleAsDraft}
                    onClick={() => setSampleAsDraft(false)}
                    className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-all ${
                      !sampleAsDraft
                        ? 'bg-[var(--card)] text-[var(--text)] shadow-sm'
                        : 'text-[var(--muted)]'
                    }`}
                  >
                    চূড়ান্ত
                  </button>
                  <button
                    type="button"
                    aria-pressed={sampleAsDraft}
                    onClick={() => setSampleAsDraft(true)}
                    className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-all ${
                      sampleAsDraft
                        ? 'bg-[var(--card)] text-[var(--text)] shadow-sm'
                        : 'text-[var(--muted)]'
                    }`}
                  >
                    খসড়া
                  </button>
                </div>
              )}

              <button
                type="button"
                aria-pressed={showSectionGuides}
                onClick={() => setShowSectionGuides((v) => !v)}
                className={`min-h-[42px] px-3 rounded-[10px] border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                  showSectionGuides
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'border-[var(--line)] text-[var(--text)] hover:bg-[var(--surface-subtle)]'
                }`}
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span>গাইড</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={handlePrint}
                className="min-h-[42px] px-3 rounded-[10px] border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text)] inline-flex items-center justify-center gap-1.5 disabled:opacity-60 whitespace-nowrap"
              >
                <Printer className="w-4 h-4 shrink-0" />
                <span>{busyAction === 'print' ? 'প্রিন্ট…' : 'Print'}</span>
              </button>

              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={handleExportPdf}
                className="min-h-[42px] px-3 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60 whitespace-nowrap"
              >
                <FileDown className="w-4 h-4 shrink-0" />
                <span>{busyAction === 'pdf' ? 'PDF হচ্ছে…' : 'PDF'}</span>
              </button>

              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={handleExportDocx}
                className="min-h-[42px] px-3 rounded-[10px] border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text)] inline-flex items-center justify-center gap-1.5 disabled:opacity-60 whitespace-nowrap"
              >
                <FileText className="w-4 h-4 shrink-0" />
                <span>{busyAction === 'docx' ? 'Word হচ্ছে…' : 'Word'}</span>
              </button>
            </div>
          </section>

          {/* A4 Preview Frame */}
          <section className="card-surface overflow-hidden flex flex-col h-[70dvh] min-h-[420px] md:h-[calc(100dvh-250px)] md:min-h-[380px]">
            {/* Frame Toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--line)]">
              <span className="text-xs font-bold text-[var(--text)]">A4 প্রিভিউ</span>
              <span className="text-xs text-[var(--muted)]">২ পাতা</span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() =>
                  setZoomMultiplier((z) => Math.max(0.5, Number((z / 1.2).toFixed(3))))
                }
                aria-label="জুম কমান"
                className="w-9 h-9 rounded-[10px] border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-base font-semibold text-[var(--text)] inline-flex items-center justify-center"
              >
                &minus;
              </button>
              <span className="min-w-[46px] text-center text-xs font-semibold tabular-nums text-[var(--text)]">
                {Math.round(effectiveScale * 100)}%
              </span>
              <button
                type="button"
                onClick={() =>
                  setZoomMultiplier((z) => Math.min(2.5, Number((z * 1.2).toFixed(3))))
                }
                aria-label="জুম বাড়ান"
                className="w-9 h-9 rounded-[10px] border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-base font-semibold text-[var(--text)] inline-flex items-center justify-center"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setZoomMultiplier(1)}
                className="min-h-[36px] px-3 rounded-[10px] border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text)]"
              >
                Fit
              </button>
            </div>

            {/* Scrollable Preview Viewport */}
            <div
              ref={viewportRef}
              className="flex-1 min-h-0 overflow-auto bg-[var(--surface-subtle)] dark:bg-neutral-900 overscroll-contain touch-pan-x touch-pan-y"
            >
              <div className="min-w-full w-max p-3 flex justify-center">
                <div
                  style={{
                    width: `${Math.round(A4_WIDTH_PX * effectiveScale)}px`,
                    height: `${Math.round(innerHeight * effectiveScale)}px`,
                    position: 'relative',
                    flexShrink: 0,
                  }}
                >
                  <div
                    ref={innerRef}
                    style={{
                      width: `${A4_WIDTH_PX}px`,
                      transform: `scale(${effectiveScale})`,
                      transformOrigin: 'top left',
                    }}
                    className="tr21-preview-sheet"
                  >
                    <BillForm data={previewFormData} showSectionGuides={showSectionGuides} />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Add / Edit Clause Modal */}
      <Modal
        open={Boolean(clauseModal)}
        onClose={closeClauseModal}
        title={
          clauseModal?.mode === 'create'
            ? 'নতুন ধারা যোগ করুন'
            : `ধারা ${clauseModal?.numberBn || ''} ${canEditTr21 ? 'সম্পাদনা' : 'বিবরণ'}`
        }
        subtitle={
          clauseModal
            ? `পাতা ${clauseModal.page === 1 ? '১ (P1-S5)' : '২ (P2-S1)'} · টি.আর. ফরম নং-২১`
            : undefined
        }
        size="md"
        fullScreenOnMobile
        confirmClose={isClauseModalDirty}
        footer={
          clauseModal && (
            <ModalFooter
              extra={
                canEditTr21 && clauseModal.mode === 'edit' && tr21Clauses.length > 1 ? (
                  <button
                    type="button"
                    onClick={handleDeleteClauseFromModal}
                    className={`min-h-[44px] px-3.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                      confirmDeleteClause
                        ? 'bg-[var(--danger-solid)] text-[var(--on-danger)] hover:opacity-90'
                        : 'border border-[var(--border-strong)] bg-[var(--card)] text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40'
                    }`}
                  >
                    <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{confirmDeleteClause ? 'নিশ্চিত মুছুন' : 'মুছে ফেলুন'}</span>
                  </button>
                ) : undefined
              }
              secondary={{
                label: canEditTr21 ? 'বাতিল' : 'বন্ধ করুন',
                onClick: closeClauseModal,
              }}
              primary={
                canEditTr21
                  ? {
                      label: clauseModal.mode === 'create' ? 'যোগ করুন' : 'প্রয়োগ করুন',
                      type: 'submit',
                      form: 'tr21-clause-form',
                      icon: <Check className="w-4 h-4 shrink-0" aria-hidden="true" />,
                    }
                  : undefined
              }
            />
          )
        }
      >
        {clauseModal && (
          <form
            ref={clauseFormRef}
            id="tr21-clause-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveClauseModal();
            }}
            noValidate
            className="space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <Field label="ধারা নম্বর">
                <TextInput
                  type="text"
                  disabled={!canEditTr21}
                  value={clauseModal.numberBn}
                  onChange={(e) =>
                    setClauseModal((prev) =>
                      prev ? { ...prev, numberBn: e.target.value } : prev
                    )
                  }
                  placeholder="৮"
                  className="bn"
                />
              </Field>

              <Field label="কোন পাতায় যাবে" labelAs="span">
                <Segmented<'1' | '2'>
                  ariaLabel="কোন পাতায় যাবে"
                  fullWidth
                  value={clauseModal.page === 1 ? '1' : '2'}
                  onChange={(pg) =>
                    setClauseModal((prev) =>
                      prev ? { ...prev, page: pg === '1' ? 1 : 2 } : prev
                    )
                  }
                  options={[
                    { value: '1', label: 'পাতা ১ (P1-S5)', disabled: !canEditTr21 },
                    { value: '2', label: 'পাতা ২ (P2-S1)', disabled: !canEditTr21 },
                  ]}
                />
              </Field>
            </div>

            <Toggle
              checked={clauseModal.enabled}
              disabled={!canEditTr21}
              label="টি.আর. ফরম নং-২১ পাতায় দেখাবে"
              aria-label="টি.আর. ফরম নং-২১ পাতায় দেখাবে"
              onChange={(checked) =>
                setClauseModal((prev) =>
                  prev ? { ...prev, enabled: checked } : prev
                )
              }
            />

            <Field
              label="ধারার বিবরণ"
              required={canEditTr21}
              error={clauseTextError}
              labelAction={
                canEditTr21 &&
                (clauseModal.id === '7' || clauseModal.id === '12') &&
                !clauseModal.text.includes('{{payeeText}}') ? (
                  <button
                    type="button"
                    onClick={() =>
                      setClauseModal((prev) =>
                        prev
                          ? { ...prev, text: `${prev.text.trimEnd()} {{payeeText}}` }
                          : prev
                      )
                    }
                    className="min-h-[44px] px-2 text-xs font-semibold text-[var(--accent)] hover:underline whitespace-nowrap rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  >
                    + {'{{payeeText}}'}
                  </button>
                ) : undefined
              }
              hint={
                <>
                  নতুন লাইনে <code className="font-mono text-[var(--text)]">(ক)</code>,{' '}
                  <code className="font-mono text-[var(--text)]">(খ)</code> লিখলে ফরমে স্বয়ংক্রিয়ভাবে ইনডেন্ট হবে এবং{' '}
                  <code className="font-mono text-[var(--text)]">{'{{payeeText}}'}</code> দিলে বিলের প্রাপকের নাম বসবে।
                </>
              }
            >
              <Textarea
                rows={6}
                disabled={!canEditTr21}
                value={clauseModal.text}
                onChange={(e) => {
                  setClauseModal((prev) => (prev ? { ...prev, text: e.target.value } : prev));
                  if (clauseTextError) setClauseTextError('');
                }}
                placeholder="ধারার পূর্ণ বিবরণ লিখুন। প্রয়োজনে নতুন লাইনে (ক), (খ) উপ-ধারা লিখতে পারেন।"
                className="bn"
              />
            </Field>
          </form>
        )}
      </Modal>
    </Layout>
  );
}
