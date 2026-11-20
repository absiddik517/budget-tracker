import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  FileDown,
  FileText,
  Layers,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { BillForm, TR21_FORM_SECTIONS } from '../components/BillForm';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { useAuth } from '../contexts/AuthContext';
import { ALL_OFFICES_ID, LEGACY_UNMIGRATED_OFFICE_ID, useApp } from '../contexts/AppContext';
import { toBanglaDigits } from '../lib/banglaFormat';
import { buildTr21FormData, sanitizeBillFileSegment } from '../lib/billFormData';
import { db } from '../lib/firebase';
import { isPermissionDeniedError, logFirestoreError, OperationType } from '../lib/firestoreError';
import { saveOfficeSettings } from '../lib/firestoreOps';
import { canEditOfficeBasic } from '../lib/permissions';
import {
  cloneDefaultTr21Clauses,
  DEFAULT_INSTITUTIONAL_CODE,
  DEFAULT_IT_CODE,
  DEFAULT_NET_PAYABLE_CODE,
  DEFAULT_SECURITY_CODE,
  DEFAULT_TR21_FONT_FAMILY,
  DEFAULT_TR21_FONT_SIZE,
  DEFAULT_TR21_FOOTER_TEXT,
  DEFAULT_VAT_CODE,
  resolveTr21Clauses,
  resolveTr21FontFamily,
  resolveTr21FontSize,
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
} from '../types';

const A4_WIDTH_PX = 794;

type ClauseFilter = 'all' | 'page1' | 'page2';
type MobilePane = 'setup' | 'preview';

interface ClauseModalState {
  mode: 'create' | 'edit';
  index: number | null;
  id: string;
  numberBn: string;
  page: 1 | 2;
  enabled: boolean;
  text: string;
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

  // Editable form state synced from officeSettings
  const [ministryName, setMinistryName] = useState(officeSettings.ministryName || '');
  const [officeName, setOfficeName] = useState(officeSettings.officeName);
  const [officeAddress, setOfficeAddress] = useState(officeSettings.address || '');
  const [officeMobileNo, setOfficeMobileNo] = useState(officeSettings.officeMobileNo || '');
  const [institutionalCode, setInstitutionalCode] = useState(
    officeSettings.institutionalCode || ''
  );
  const [defaultPayeeText, setDefaultPayeeText] = useState(
    officeSettings.defaultPayeeText || ''
  );
  const [placeName, setPlaceName] = useState(officeSettings.placeName || '');
  const [defaultNetPayableCode, setDefaultNetPayableCode] = useState(
    officeSettings.defaultNetPayableCode || DEFAULT_NET_PAYABLE_CODE
  );
  const [defaultItCode, setDefaultItCode] = useState(
    officeSettings.defaultItCode || DEFAULT_IT_CODE
  );
  const [defaultVatCode, setDefaultVatCode] = useState(
    officeSettings.defaultVatCode || DEFAULT_VAT_CODE
  );
  const [defaultSecurityCode, setDefaultSecurityCode] = useState(
    officeSettings.defaultSecurityCode || DEFAULT_SECURITY_CODE
  );
  const [tr21FooterText, setTr21FooterText] = useState(
    officeSettings.tr21FooterText || DEFAULT_TR21_FOOTER_TEXT
  );
  const [tr21FontFamily, setTr21FontFamily] = useState(
    resolveTr21FontFamily(officeSettings.tr21FontFamily)
  );
  const [tr21FontSize, setTr21FontSize] = useState(
    resolveTr21FontSize(officeSettings.tr21FontSize)
  );
  const [tr21Clauses, setTr21Clauses] = useState<CertificationClause[]>(() =>
    resolveTr21Clauses(officeSettings.tr21Clauses)
  );
  const [saving, setSaving] = useState(false);

  // UI & Preview controls
  const [clauseFilter, setClauseFilter] = useState<ClauseFilter>('all');
  const [rangeFrom, setRangeFrom] = useState<number>(1);
  const [rangeTo, setRangeTo] = useState<number>(4);
  const [rangePage, setRangePage] = useState<1 | 2>(1);
  const [clauseModal, setClauseModal] = useState<ClauseModalState | null>(null);
  const [confirmDeleteClause, setConfirmDeleteClause] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>('setup');
  const [previewSourceId, setPreviewSourceId] = useState<'sample' | string>('sample');
  const [sampleAsDraft, setSampleAsDraft] = useState(false);
  const [showSectionGuides, setShowSectionGuides] = useState(true);
  const [fitToWidth, setFitToWidth] = useState(true);
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
    setMinistryName(officeSettings.ministryName || '');
    setOfficeName(officeSettings.officeName);
    setOfficeAddress(officeSettings.address || '');
    setOfficeMobileNo(officeSettings.officeMobileNo || '');
    setInstitutionalCode(officeSettings.institutionalCode || '');
    setDefaultPayeeText(officeSettings.defaultPayeeText || '');
    setPlaceName(officeSettings.placeName || '');
    setDefaultNetPayableCode(officeSettings.defaultNetPayableCode || DEFAULT_NET_PAYABLE_CODE);
    setDefaultItCode(officeSettings.defaultItCode || DEFAULT_IT_CODE);
    setDefaultVatCode(officeSettings.defaultVatCode || DEFAULT_VAT_CODE);
    setDefaultSecurityCode(officeSettings.defaultSecurityCode || DEFAULT_SECURITY_CODE);
    setTr21FooterText(officeSettings.tr21FooterText || DEFAULT_TR21_FOOTER_TEXT);
    setTr21FontFamily(resolveTr21FontFamily(officeSettings.tr21FontFamily));
    setTr21FontSize(resolveTr21FontSize(officeSettings.tr21FontSize));
    setTr21Clauses(resolveTr21Clauses(officeSettings.tr21Clauses));
  }, [officeSettings]);

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
  }, [selectedFy, currentOfficeId, isAllOfficesMode, isLegacyPreMigration, clearPermissionError, reportPermissionError]);

  useEffect(() => {
    const vp = viewportRef.current;
    const inner = innerRef.current;
    if (!vp) return;

    const updateSizes = () => {
      setViewportWidth(vp.clientWidth || A4_WIDTH_PX);
      if (inner) {
        setInnerHeight(inner.scrollHeight || 2260);
      }
    };
    updateSizes();

    const ro = new ResizeObserver(() => updateSizes());
    ro.observe(vp);
    if (inner) ro.observe(inner);
    return () => ro.disconnect();
  }, [mobilePane, showSectionGuides, previewSourceId]);

  const isDirty = useMemo(() => {
    const savedMinistry = officeSettings.ministryName || '';
    const savedAddress = officeSettings.address || '';
    const savedMobile = officeSettings.officeMobileNo || '';
    const savedCode = officeSettings.institutionalCode || '';
    const savedPayee = officeSettings.defaultPayeeText || '';
    const savedPlace = officeSettings.placeName || '';
    const savedNet = officeSettings.defaultNetPayableCode || DEFAULT_NET_PAYABLE_CODE;
    const savedIt = officeSettings.defaultItCode || DEFAULT_IT_CODE;
    const savedVat = officeSettings.defaultVatCode || DEFAULT_VAT_CODE;
    const savedSecurity = officeSettings.defaultSecurityCode || DEFAULT_SECURITY_CODE;
    const savedFooter = officeSettings.tr21FooterText || DEFAULT_TR21_FOOTER_TEXT;
    const savedFontFamily = resolveTr21FontFamily(officeSettings.tr21FontFamily);
    const savedFontSize = resolveTr21FontSize(officeSettings.tr21FontSize);
    const savedClauses = JSON.stringify(resolveTr21Clauses(officeSettings.tr21Clauses));
    const currentClauses = JSON.stringify(tr21Clauses);
    return (
      ministryName.trim() !== savedMinistry.trim() ||
      (canEditOfficeName && officeName.trim() !== (officeSettings.officeName || '').trim()) ||
      officeAddress.trim() !== savedAddress.trim() ||
      officeMobileNo.trim() !== savedMobile.trim() ||
      institutionalCode !== savedCode ||
      defaultPayeeText.trim() !== savedPayee.trim() ||
      placeName.trim() !== savedPlace.trim() ||
      defaultNetPayableCode !== savedNet ||
      defaultItCode !== savedIt ||
      defaultVatCode !== savedVat ||
      defaultSecurityCode !== savedSecurity ||
      tr21FooterText.trim() !== savedFooter.trim() ||
      tr21FontFamily !== savedFontFamily ||
      tr21FontSize !== savedFontSize ||
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
    defaultPayeeText,
    placeName,
    defaultNetPayableCode,
    defaultItCode,
    defaultVatCode,
    defaultSecurityCode,
    tr21FooterText,
    tr21FontFamily,
    tr21FontSize,
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
      defaultPayeeText: defaultPayeeText.trim(),
      placeName: placeName.trim(),
      defaultNetPayableCode: defaultNetPayableCode.trim() || DEFAULT_NET_PAYABLE_CODE,
      defaultItCode: defaultItCode.trim() || DEFAULT_IT_CODE,
      defaultVatCode: defaultVatCode.trim() || DEFAULT_VAT_CODE,
      defaultSecurityCode: defaultSecurityCode.trim() || DEFAULT_SECURITY_CODE,
      tr21FooterText: tr21FooterText.trim() || DEFAULT_TR21_FOOTER_TEXT,
      tr21FontFamily,
      tr21FontSize,
      tr21Clauses,
    }),
    [
      officeSettings,
      ministryName,
      officeName,
      officeAddress,
      officeMobileNo,
      institutionalCode,
      defaultPayeeText,
      placeName,
      defaultNetPayableCode,
      defaultItCode,
      defaultVatCode,
      defaultSecurityCode,
      tr21FooterText,
      tr21FontFamily,
      tr21FontSize,
      tr21Clauses,
    ]
  );

  const sampleBill: BillDoc = useMemo(() => {
    const fyStartYear = parseInt(selectedFy.split('-')[0], 10) || 2025;
    const billYmd = `${fyStartYear}-09-21`;
    const itCode = defaultItCode.trim() || DEFAULT_IT_CODE;
    const vatCode = defaultVatCode.trim() || DEFAULT_VAT_CODE;
    const secCode = defaultSecurityCode.trim() || DEFAULT_SECURITY_CODE;
    const netCode = defaultNetPayableCode.trim() || DEFAULT_NET_PAYABLE_CODE;
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
      payeeText: defaultPayeeText.trim() || 'ডি.ডি.ও',
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
    defaultItCode,
    defaultVatCode,
    defaultSecurityCode,
    defaultNetPayableCode,
    defaultPayeeText,
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

  const scale = useMemo(() => {
    if (!fitToWidth) return 1;
    const available = Math.max(250, viewportWidth - 16);
    return Math.min(1, available / A4_WIDTH_PX);
  }, [fitToWidth, viewportWidth]);

  useEffect(() => {
    const maxPos = Math.max(1, tr21Clauses.length);
    setRangeFrom((prev) => Math.min(Math.max(1, prev), maxPos));
    setRangeTo((prev) => Math.min(Math.max(1, prev), maxPos));
  }, [tr21Clauses.length]);

  const clauseStats = useMemo(() => {
    const p1 = tr21Clauses.filter((c) => c.page === 1);
    const p2 = tr21Clauses.filter((c) => c.page === 2);
    const enabledCount = tr21Clauses.filter((c) => c.enabled).length;

    // Detect if clauses form a clean contiguous Page 1 prefix followed by Page 2
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
    setConfirmDeleteClause(false);
    setClauseModal({
      mode: 'create',
      index: null,
      id: `clause-${Date.now()}`,
      numberBn: toBanglaDigits(tr21Clauses.length + 1),
      page: clauseFilter === 'page1' ? 1 : 2,
      enabled: true,
      text: '',
    });
  };

  const openEditClauseModal = (clause: CertificationClause, index: number) => {
    setConfirmDeleteClause(false);
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
    setConfirmDeleteClause(false);
  };

  const handleSaveClauseModal = () => {
    if (!canEditTr21 || !clauseModal) return;
    const cleanText = clauseModal.text.trim();
    if (!cleanText) {
      pushToast('error', 'ধারার বিবরণ লিখুন।');
      return;
    }
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
      pushToast('success', `ধারা ${cleanNum} যুক্ত হয়েছে। স্থায়ী করতে উপরে "সংরক্ষণ" চাপুন।`);
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

  const codeGroupsPreview = useMemo(() => {
    const boxes = Array.from({ length: 13 }, (_, idx) => {
      const ch = institutionalCode[idx];
      return ch ? toBanglaDigits(ch) : '';
    });
    return [boxes.slice(0, 1), boxes.slice(1, 5), boxes.slice(5, 9), boxes.slice(9, 13)];
  }, [institutionalCode]);

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
          institutionalCode: institutionalCode.replace(/\D+/g, '').slice(0, 13),
          defaultPayeeText: defaultPayeeText.trim(),
          placeName: placeName.trim(),
          defaultNetPayableCode: defaultNetPayableCode.trim() || DEFAULT_NET_PAYABLE_CODE,
          defaultItCode: defaultItCode.trim() || DEFAULT_IT_CODE,
          defaultVatCode: defaultVatCode.trim() || DEFAULT_VAT_CODE,
          defaultSecurityCode: defaultSecurityCode.trim() || DEFAULT_SECURITY_CODE,
          tr21FooterText: tr21FooterText.trim() || DEFAULT_TR21_FOOTER_TEXT,
          tr21FontFamily: tr21FontFamily || DEFAULT_TR21_FONT_FAMILY,
          tr21FontSize: tr21FontSize || DEFAULT_TR21_FONT_SIZE,
          tr21Clauses,
        },
        effectiveActor,
        isLegacyPreMigration ? undefined : realOfficeId
      );
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
        <div className="mb-4 px-3.5 py-3 rounded-[14px] border border-[var(--line)] bg-[var(--card)] text-xs md:text-sm text-[var(--muted)]">
          শুধুমাত্র সুপার অ্যাডমিন বা সংশ্লিষ্ট অফিসের DDO টি.আর. ফরম নং-২১ সেটআপ পরিবর্তন ও সংরক্ষণ করতে পারবেন। আপনি বর্তমান কনফিগারেশন ও লাইভ প্রিভিউ দেখতে এবং টেস্ট এক্সপোর্ট করতে পারেন।
        </div>
      )}

      {/* Mobile / Tablet Pane Switcher */}
      <div className="xl:hidden mb-3.5 inline-flex p-1 rounded-lg bg-[var(--surface-subtle)] border border-[var(--line)]">
        <button
          type="button"
          onClick={() => setMobilePane('setup')}
          className={`min-h-[38px] px-3.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
            mobilePane === 'setup'
              ? 'bg-[var(--card)] text-[var(--text)] shadow-sm'
              : 'text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          ফরম সেটআপ
        </button>
        <button
          type="button"
          onClick={() => setMobilePane('preview')}
          className={`min-h-[38px] px-3.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
            mobilePane === 'preview'
              ? 'bg-[var(--card)] text-[var(--text)] shadow-sm'
              : 'text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          লাইভ ফরম প্রিভিউ
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 md:gap-5 items-start">
        {/* ================= LEFT COLUMN: FORM SETUP ================= */}
        <div
          className={`xl:col-span-5 space-y-4 ${
            mobilePane === 'setup' ? 'block' : 'hidden xl:block'
          }`}
        >
          {/* 1. Office Header & Institutional Code (P1-S1 & P1-S2) */}
          <section className="card-surface p-4 md:p-5 space-y-3.5">
            <div className="space-y-0.5">
              <div className="text-xs text-[var(--muted)]">পাতা ১ · সেকশন P1-S1 ও P1-S2</div>
              <h2 className="text-base font-semibold text-[var(--text)]">
                শিরোনাম, দপ্তর ও কোড নং
              </h2>
            </div>

            <div>
              <label
                htmlFor="tr21-ministry-name"
                className="block text-xs font-medium text-[var(--muted)] mb-1.5"
              >
                মন্ত্রণালয় / ঊর্ধ্বতন দপ্তর
              </label>
              <input
                id="tr21-ministry-name"
                type="text"
                disabled={!canEditTr21}
                value={ministryName}
                onChange={(e) => setMinistryName(e.target.value)}
                placeholder="প্রাথমিক ও গণশিক্ষা মন্ত্রণালয়"
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
              />
            </div>

            <div>
              <label
                htmlFor="tr21-office-name"
                className="block text-xs font-medium text-[var(--muted)] mb-1.5"
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
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
              />
              {!canEditOfficeName && canEditTr21 && (
                <p className="text-[11px] text-[var(--muted)] mt-1">
                  দপ্তরের নাম শুধুমাত্র সুপার অ্যাডমিন পরিবর্তন করতে পারবেন।
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="tr21-office-address"
                  className="block text-xs font-medium text-[var(--muted)] mb-1.5"
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
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
                />
              </div>

              <div>
                <label
                  htmlFor="tr21-mobile-no"
                  className="block text-xs font-medium text-[var(--muted)] mb-1.5"
                >
                  মোবাইল নং (ডান শীর্ষে)
                </label>
                <input
                  id="tr21-mobile-no"
                  type="text"
                  disabled={!canEditTr21}
                  value={officeMobileNo}
                  onChange={(e) => setOfficeMobileNo(e.target.value)}
                  placeholder="০১৯৬৭৫০০১০৫"
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor="tr21-inst-code"
                  className="block text-xs font-medium text-[var(--muted)]"
                >
                  কোড নং (১৩ ডিজিট · ১-৪-৪-৪ বিন্যাস)
                </label>
                {canEditTr21 && institutionalCode !== DEFAULT_INSTITUTIONAL_CODE && (
                  <button
                    type="button"
                    onClick={() => setInstitutionalCode(DEFAULT_INSTITUTIONAL_CODE)}
                    className="text-xs font-medium text-[var(--accent)] hover:underline whitespace-nowrap"
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
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm text-[var(--text)] tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
              />
              <div
                className="flex flex-wrap items-center gap-1.5 mt-2"
                aria-label="১-৪-৪-৪ কোড বক্স প্রিভিউ"
              >
                {codeGroupsPreview.map((grp, gIdx) => (
                  <div key={gIdx} className="inline-flex items-center gap-1">
                    {gIdx > 0 && <span className="text-xs font-bold text-[var(--muted)]">-</span>}
                    <div className="inline-flex">
                      {grp.map((ch, dIdx) => (
                        <span
                          key={dIdx}
                          className="w-6 h-6 inline-flex items-center justify-center border border-[var(--line)] text-xs font-semibold tabular-nums bg-[var(--surface-subtle)] text-[var(--text)]"
                        >
                          {ch}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--line)] space-y-3.5">
              <div className="space-y-0.5">
                <div className="text-xs text-[var(--muted)]">
                  পাতা ১ ও ২ · সেকশন P1-S4, P2-S1, P2-S2
                </div>
                <h3 className="text-sm font-semibold text-[var(--text)]">
                  ডিফল্ট প্রাপক, স্থান, হিসাব কোড ও ফুটার
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="tr21-default-payee"
                    className="block text-xs font-medium text-[var(--muted)] mb-1.5"
                  >
                    যাহার নামে ইস্যু করা হইবে (৭ নং ধারা)
                  </label>
                  <input
                    id="tr21-default-payee"
                    type="text"
                    disabled={!canEditTr21}
                    value={defaultPayeeText}
                    onChange={(e) => setDefaultPayeeText(e.target.value)}
                    placeholder="ডি.ডি.ও"
                    className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
                  />
                </div>

                <div>
                  <label
                    htmlFor="tr21-place-name"
                    className="block text-xs font-medium text-[var(--muted)] mb-1.5"
                  >
                    স্থান (আয়ন ব্যয়ন কর্মকর্তার স্বাক্ষরে)
                  </label>
                  <input
                    id="tr21-place-name"
                    type="text"
                    disabled={!canEditTr21}
                    value={placeName}
                    onChange={(e) => setPlaceName(e.target.value)}
                    placeholder="তারাকান্দা, ময়মনসিংহ"
                    className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label
                    htmlFor="tr21-net-code"
                    className="block text-xs font-medium text-[var(--muted)] mb-1.5"
                  >
                    প্রদেয় বিল (ক-খ)
                  </label>
                  <input
                    id="tr21-net-code"
                    type="text"
                    inputMode="numeric"
                    disabled={!canEditTr21}
                    value={defaultNetPayableCode}
                    onChange={(e) =>
                      setDefaultNetPayableCode(e.target.value.replace(/\D+/g, '').slice(0, 10))
                    }
                    placeholder={DEFAULT_NET_PAYABLE_CODE}
                    className="w-full min-h-[42px] px-2.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
                  />
                </div>
                <div>
                  <label
                    htmlFor="tr21-it-code"
                    className="block text-xs font-medium text-[var(--muted)] mb-1.5"
                  >
                    আয়কর (IT)
                  </label>
                  <input
                    id="tr21-it-code"
                    type="text"
                    inputMode="numeric"
                    disabled={!canEditTr21}
                    value={defaultItCode}
                    onChange={(e) =>
                      setDefaultItCode(e.target.value.replace(/\D+/g, '').slice(0, 10))
                    }
                    placeholder={DEFAULT_IT_CODE}
                    className="w-full min-h-[42px] px-2.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
                  />
                </div>
                <div>
                  <label
                    htmlFor="tr21-vat-code"
                    className="block text-xs font-medium text-[var(--muted)] mb-1.5"
                  >
                    মূসক (VAT)
                  </label>
                  <input
                    id="tr21-vat-code"
                    type="text"
                    inputMode="numeric"
                    disabled={!canEditTr21}
                    value={defaultVatCode}
                    onChange={(e) =>
                      setDefaultVatCode(e.target.value.replace(/\D+/g, '').slice(0, 10))
                    }
                    placeholder={DEFAULT_VAT_CODE}
                    className="w-full min-h-[42px] px-2.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
                  />
                </div>
                <div>
                  <label
                    htmlFor="tr21-security-code"
                    className="block text-xs font-medium text-[var(--muted)] mb-1.5"
                  >
                    নিরাপত্তা জমা
                  </label>
                  <input
                    id="tr21-security-code"
                    type="text"
                    inputMode="numeric"
                    disabled={!canEditTr21}
                    value={defaultSecurityCode}
                    onChange={(e) =>
                      setDefaultSecurityCode(e.target.value.replace(/\D+/g, '').slice(0, 10))
                    }
                    placeholder={DEFAULT_SECURITY_CODE}
                    className="w-full min-h-[42px] px-2.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="tr21-footer-text"
                  className="block text-xs font-medium text-[var(--muted)] mb-1.5"
                >
                  পাতার নিচের বাম লেখা (Footer)
                </label>
                <input
                  id="tr21-footer-text"
                  type="text"
                  disabled={!canEditTr21}
                  value={tr21FooterText}
                  onChange={(e) => setTr21FooterText(e.target.value)}
                  placeholder="Print By: DPE Accounting Information System"
                  className="w-full min-h-[42px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
                />
              </div>

              {/* Font Family & Font Size */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label
                    htmlFor="tr21-font-family"
                    className="block text-xs font-medium text-[var(--muted)] mb-1.5"
                  >
                    ফর্মের ফন্ট (Font)
                  </label>
                  <select
                    id="tr21-font-family"
                    disabled={!canEditTr21}
                    value={tr21FontFamily}
                    onChange={(e) => setTr21FontFamily(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
                  >
                    {TR21_FONT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="tr21-font-size"
                    className="block text-xs font-medium text-[var(--muted)] mb-1.5"
                  >
                    ফন্ট সাইজ (Font Size)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <select
                      id="tr21-font-size"
                      disabled={!canEditTr21}
                      value={tr21FontSize}
                      onChange={(e) => setTr21FontSize(resolveTr21FontSize(Number(e.target.value)))}
                      className="flex-1 min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
                    >
                      {TR21_FONT_SIZE_OPTIONS.map((sz) => (
                        <option key={sz} value={sz}>
                          {toBanglaDigits(sz)} px{sz === DEFAULT_TR21_FONT_SIZE ? ' (ডিফল্ট)' : ''}
                        </option>
                      ))}
                    </select>
                    {canEditTr21 &&
                      (tr21FontFamily !== DEFAULT_TR21_FONT_FAMILY ||
                        tr21FontSize !== DEFAULT_TR21_FONT_SIZE) && (
                        <button
                          type="button"
                          onClick={() => {
                            setTr21FontFamily(DEFAULT_TR21_FONT_FAMILY);
                            setTr21FontSize(DEFAULT_TR21_FONT_SIZE);
                          }}
                          title="ডিফল্ট ফন্ট ও সাইজে ফিরুন"
                          className="min-h-[42px] px-2.5 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-subtle)] shrink-0"
                        >
                          রিসেট
                        </button>
                      )}
                  </div>
                </div>
              </div>

            </div>
          </section>

          {/* 2. Certification Clauses Editor (P1-S5 & P2-S1) */}
          <section className="card-surface p-4 md:p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2.5">
              <div className="space-y-0.5">
                <div className="text-xs text-[var(--muted)] tabular-nums">
                  পাতা ১ ও ২ · সক্রিয় {toBanglaDigits(clauseStats.enabledCount)}/
                  {toBanglaDigits(tr21Clauses.length)}টি
                </div>
                <h2 className="text-base font-semibold text-[var(--text)]">
                  প্রত্যয়ন ও শর্তাবলি ধারা ({toBanglaDigits(tr21Clauses.length)}টি)
                </h2>
              </div>

              {canEditTr21 && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={openCreateClauseModal}
                    className="min-h-[38px] px-3 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span>নতুন ধারা</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTr21Clauses(cloneDefaultTr21Clauses())}
                    className="min-h-[38px] px-2.5 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)] inline-flex items-center gap-1.5 whitespace-nowrap"
                    title="ডিফল্ট ১–৭ ধারা পুনরুদ্ধার করুন"
                  >
                    <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                    <span>ডিফল্ট</span>
                  </button>
                </div>
              )}
            </div>

            {/* Page Range Control: কত নম্বর থেকে কত নম্বর পর্যন্ত কোন page-এ যাবে */}
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
                <span className="font-semibold text-[var(--text)]">
                  পাতা বিন্যাস (কোন ধারা কোন পাতায় যাবে)
                </span>
                <span className="text-[var(--muted)] tabular-nums">
                  পাতা ১: {clauseStats.page1Numbers} · পাতা ২: {clauseStats.page2Numbers}
                </span>
              </div>

              {canEditTr21 && tr21Clauses.length > 0 && (
                <div className="space-y-2 pt-1 border-t border-[var(--line)]">
                  {/* Quick Prefix Split */}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label
                      htmlFor="tr21-quick-split"
                      className="text-[var(--muted)] whitespace-nowrap"
                    >
                      পাতা ১-এ প্রথম থেকে:
                    </label>
                    <select
                      id="tr21-quick-split"
                      value={clauseStats.contiguousSplitEnd}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (val >= 0) handleQuickPageSplit(val);
                      }}
                      className="min-h-[34px] px-2.5 rounded-md border border-[var(--line)] bg-[var(--card)] text-xs font-medium text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
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
                    </select>
                  </div>

                  {/* Custom Range Assignment */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-[var(--muted)]">রেঞ্জ:</span>
                    <select
                      aria-label="শুরু ধারা"
                      value={rangeFrom}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setRangeFrom(v);
                        if (v > rangeTo) setRangeTo(v);
                      }}
                      className="min-h-[34px] px-2 rounded-md border border-[var(--line)] bg-[var(--card)] text-xs text-[var(--text)]"
                    >
                      {tr21Clauses.map((c, idx) => (
                        <option key={c.id} value={idx + 1}>
                          ধারা {c.numberBn}
                        </option>
                      ))}
                    </select>
                    <span className="text-[var(--muted)]">থেকে</span>
                    <select
                      aria-label="শেষ ধারা"
                      value={rangeTo}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setRangeTo(v);
                        if (v < rangeFrom) setRangeFrom(v);
                      }}
                      className="min-h-[34px] px-2 rounded-md border border-[var(--line)] bg-[var(--card)] text-xs text-[var(--text)]"
                    >
                      {tr21Clauses.map((c, idx) => (
                        <option key={c.id} value={idx + 1}>
                          ধারা {c.numberBn}
                        </option>
                      ))}
                    </select>
                    <span className="text-[var(--muted)]">→</span>
                    <select
                      aria-label="গন্তব্য পাতা"
                      value={rangePage}
                      onChange={(e) => setRangePage(Number(e.target.value) === 2 ? 2 : 1)}
                      className="min-h-[34px] px-2 rounded-md border border-[var(--line)] bg-[var(--card)] text-xs text-[var(--text)]"
                    >
                      <option value={1}>পাতা ১ (P1-S5)</option>
                      <option value={2}>পাতা ২ (P2-S1)</option>
                    </select>
                    <button
                      type="button"
                      onClick={handleApplyRange}
                      className="min-h-[34px] px-2.5 rounded-md border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-soft)] text-xs font-semibold whitespace-nowrap"
                    >
                      প্রয়োগ
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Segmented Filter */}
            <div className="inline-flex p-1 rounded-lg bg-[var(--surface-subtle)] border border-[var(--line)]">
              {(
                [
                  { id: 'all', label: `সকল (${toBanglaDigits(tr21Clauses.length)})` },
                  { id: 'page1', label: `পাতা ১ (${toBanglaDigits(clauseStats.page1Count)})` },
                  { id: 'page2', label: `পাতা ২ (${toBanglaDigits(clauseStats.page2Count)})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setClauseFilter(tab.id)}
                  className={`min-h-[34px] px-3 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    clauseFilter === tab.id
                      ? 'bg-[var(--card)] text-[var(--text)] shadow-sm'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Compact Clause List — Content hidden by default; Edit opens Modal */}
            <div className="divide-y divide-[var(--line)] max-h-[480px] overflow-y-auto pr-1">
              {filteredClauses.length === 0 ? (
                <div className="py-6 text-center text-xs text-[var(--muted)]">
                  এই পাতায় কোনো ধারা নেই।
                </div>
              ) : (
                filteredClauses.map(({ clause, index }) => (
                  <div
                    key={clause.id}
                    className={`py-2.5 first:pt-1 last:pb-1 flex items-center justify-between gap-2 transition-opacity ${
                      clause.enabled ? 'opacity-100' : 'opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {canEditTr21 && (
                        <div className="flex flex-col shrink-0">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => handleMoveClause(index, -1)}
                            aria-label={`ধারা ${clause.numberBn} উপরে নিন`}
                            className="p-0.5 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-25"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            disabled={index === tr21Clauses.length - 1}
                            onClick={() => handleMoveClause(index, 1)}
                            aria-label={`ধারা ${clause.numberBn} নিচে নিন`}
                            className="p-0.5 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-25"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      <div className="min-w-0 space-y-0.5">
                        <div className="text-sm font-semibold text-[var(--text)] truncate">
                          ধারা {clause.numberBn}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
                          <span>পাতা {clause.page === 1 ? '১' : '২'}</span>
                          <span aria-hidden="true">·</span>
                          <span>{clause.page === 1 ? 'P1-S5' : 'P2-S1'}</span>
                          {!clause.enabled && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>পেজে লুকানো</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-medium select-none text-[var(--text)]">
                        <input
                          type="checkbox"
                          disabled={!canEditTr21}
                          checked={clause.enabled}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setTr21Clauses((prev) =>
                              prev.map((c, cIdx) =>
                                cIdx === index ? { ...c, enabled: checked } : c
                              )
                            );
                          }}
                          className="w-4 h-4 accent-[var(--accent)]"
                        />
                        <span>{clause.enabled ? 'দেখাবে' : 'লুকানো'}</span>
                      </label>

                      <button
                        type="button"
                        onClick={() => openEditClauseModal(clause, index)}
                        className="min-h-[34px] px-2.5 rounded-lg border border-[var(--line)] hover:bg-[var(--surface-subtle)] text-xs font-medium text-[var(--text)] inline-flex items-center gap-1 whitespace-nowrap"
                      >
                        {canEditTr21 ? (
                          <>
                            <Pencil className="w-3.5 h-3.5 shrink-0" />
                            <span>সম্পাদনা</span>
                          </>
                        ) : (
                          <>
                            <Eye className="w-3.5 h-3.5 shrink-0" />
                            <span>দেখুন</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* 3. Section Directory Reference */}
          <section className="card-surface p-4 md:p-5 space-y-3">
            <div className="space-y-0.5">
              <div className="text-xs text-[var(--muted)]">রেফারেন্স সূচি</div>
              <h2 className="text-base font-semibold text-[var(--text)]">
                ফর্মের সেকশনসমূহ (P1-S1 থেকে P2-S5)
              </h2>
            </div>
            <div className="divide-y divide-[var(--line)] text-xs">
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
          </section>
        </div>

        {/* ================= RIGHT COLUMN: LIVE PREVIEW & EXPORT TEST ================= */}
        <div
          className={`xl:col-span-7 space-y-3 ${
            mobilePane === 'preview' ? 'block' : 'hidden xl:block'
          }`}
        >
          <section className="card-surface p-3.5 md:p-4 space-y-3">
            {/* Preview Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <label htmlFor="tr21-preview-source" className="sr-only">
                  প্রিভিউ ডেটা সোর্স
                </label>
                <select
                  id="tr21-preview-source"
                  value={previewSourceId}
                  onChange={(e) => setPreviewSourceId(e.target.value)}
                  className="min-h-[40px] max-w-[230px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs font-medium text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="sample">নমুনা বিল (টেমপ্লেট টেস্ট)</option>
                  {fyBills.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.billNo ? `বিল ${b.billNo}` : `খসড়া (${b.economicCode})`} · {b.date}
                    </option>
                  ))}
                </select>

                {previewSourceId === 'sample' && (
                  <div className="inline-flex p-0.5 rounded-lg bg-[var(--surface-subtle)] border border-[var(--line)]">
                    <button
                      type="button"
                      onClick={() => setSampleAsDraft(false)}
                      className={`min-h-[34px] px-2.5 rounded-md text-xs font-medium whitespace-nowrap ${
                        !sampleAsDraft
                          ? 'bg-[var(--card)] text-[var(--text)] shadow-sm'
                          : 'text-[var(--muted)]'
                      }`}
                    >
                      চূড়ান্ত
                    </button>
                    <button
                      type="button"
                      onClick={() => setSampleAsDraft(true)}
                      className={`min-h-[34px] px-2.5 rounded-md text-xs font-medium whitespace-nowrap ${
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
                  onClick={() => setShowSectionGuides((v) => !v)}
                  className={`min-h-[40px] px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap ${
                    showSectionGuides
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'border-[var(--line)] text-[var(--text)] hover:bg-[var(--surface-subtle)]'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span>{showSectionGuides ? 'সেকশন গাইড চালু' : 'সেকশন গাইড'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFitToWidth((v) => !v)}
                  className="min-h-[40px] px-3 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--text)] inline-flex items-center gap-1.5 hover:bg-[var(--surface-subtle)] whitespace-nowrap"
                >
                  {fitToWidth ? (
                    <Maximize2 className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <Minimize2 className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{fitToWidth ? '১০০% জুম' : 'স্ক্রিন ফিট'}</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={handlePrint}
                  className="min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--text)] inline-flex items-center gap-1.5 disabled:opacity-60 whitespace-nowrap"
                >
                  <Printer className="w-3.5 h-3.5 shrink-0" />
                  <span>{busyAction === 'print' ? 'প্রিন্ট…' : 'Print'}</span>
                </button>

                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={handleExportPdf}
                  className="min-h-[40px] px-3 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 whitespace-nowrap"
                >
                  <FileDown className="w-3.5 h-3.5 shrink-0" />
                  <span>{busyAction === 'pdf' ? 'PDF হচ্ছে…' : 'PDF'}</span>
                </button>

                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={handleExportDocx}
                  className="min-h-[40px] px-3 rounded-lg border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-soft)] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 whitespace-nowrap"
                >
                  <FileText className="w-3.5 h-3.5 shrink-0" />
                  <span>{busyAction === 'docx' ? 'Word হচ্ছে…' : 'Word (.docx)'}</span>
                </button>
              </div>
            </div>

            {/* Live Scaled A4 Preview Viewport */}
            <div
              ref={viewportRef}
              className="w-full overflow-x-auto rounded-xl bg-neutral-200 dark:bg-neutral-900 p-2 sm:p-3.5 flex justify-center"
            >
              <div
                style={{
                  width: `${Math.round(A4_WIDTH_PX * scale)}px`,
                  height: `${Math.round(innerHeight * scale)}px`,
                  position: 'relative',
                  flexShrink: 0,
                }}
              >
                <div
                  ref={innerRef}
                  style={{
                    width: `${A4_WIDTH_PX}px`,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                  }}
                  className="tr21-preview-sheet"
                >
                  <BillForm data={previewFormData} showSectionGuides={showSectionGuides} />
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
        maxWidthClass="md:max-w-xl"
        footer={
          clauseModal && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {canEditTr21 && clauseModal.mode === 'edit' && tr21Clauses.length > 1 && (
                  <button
                    type="button"
                    onClick={handleDeleteClauseFromModal}
                    className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                      confirmDeleteClause
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'border border-[var(--line)] text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30'
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{confirmDeleteClause ? 'নিশ্চিত মুছুন' : 'মুছে ফেলুন'}</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeClauseModal}
                  className="min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-subtle)]"
                >
                  {canEditTr21 ? 'বাতিল' : 'বন্ধ করুন'}
                </button>
                {canEditTr21 && (
                  <button
                    type="button"
                    onClick={handleSaveClauseModal}
                    className="min-h-[40px] px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    <span>{clauseModal.mode === 'create' ? 'যোগ করুন' : 'প্রয়োগ করুন'}</span>
                  </button>
                )}
              </div>
            </div>
          )
        }
      >
        {clauseModal && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="clause-modal-number"
                  className="block text-xs font-medium text-[var(--muted)] mb-1.5"
                >
                  ধারা নম্বর
                </label>
                <input
                  id="clause-modal-number"
                  type="text"
                  disabled={!canEditTr21}
                  value={clauseModal.numberBn}
                  onChange={(e) =>
                    setClauseModal((prev) =>
                      prev ? { ...prev, numberBn: e.target.value } : prev
                    )
                  }
                  placeholder="৮"
                  className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-base md:text-sm bn text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
                />
              </div>

              <div>
                <span className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                  কোন পাতায় যাবে
                </span>
                <div className="inline-flex w-full p-1 rounded-lg bg-[var(--surface-subtle)] border border-[var(--line)]">
                  {([1, 2] as const).map((pg) => (
                    <button
                      key={pg}
                      type="button"
                      disabled={!canEditTr21}
                      onClick={() =>
                        setClauseModal((prev) => (prev ? { ...prev, page: pg } : prev))
                      }
                      className={`flex-1 min-h-[34px] px-2 rounded-md text-xs font-medium transition-colors ${
                        clauseModal.page === pg
                          ? 'bg-[var(--card)] text-[var(--text)] shadow-sm'
                          : 'text-[var(--muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      পাতা {pg === 1 ? '১ (P1-S5)' : '২ (P2-S1)'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-medium select-none text-[var(--text)]">
              <input
                type="checkbox"
                disabled={!canEditTr21}
                checked={clauseModal.enabled}
                onChange={(e) =>
                  setClauseModal((prev) =>
                    prev ? { ...prev, enabled: e.target.checked } : prev
                  )
                }
                className="w-4 h-4 accent-[var(--accent)]"
              />
              <span>টি.আর. ফরম নং-২১ পাতায় দেখাবে</span>
            </label>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor="clause-modal-text"
                  className="block text-xs font-medium text-[var(--muted)]"
                >
                  ধারার বিবরণ
                </label>
                {canEditTr21 &&
                  (clauseModal.id === '7' || clauseModal.id === '12') &&
                  !clauseModal.text.includes('{{payeeText}}') && (
                    <button
                      type="button"
                      onClick={() =>
                        setClauseModal((prev) =>
                          prev
                            ? { ...prev, text: `${prev.text.trimEnd()} {{payeeText}}` }
                            : prev
                        )
                      }
                      className="text-xs font-medium text-[var(--accent)] hover:underline whitespace-nowrap"
                    >
                      + {'{{payeeText}}'}
                    </button>
                  )}
              </div>
              <textarea
                id="clause-modal-text"
                rows={6}
                disabled={!canEditTr21}
                value={clauseModal.text}
                onChange={(e) =>
                  setClauseModal((prev) => (prev ? { ...prev, text: e.target.value } : prev))
                }
                placeholder="ধারার পূর্ণ বিবরণ লিখুন। প্রয়োজনে নতুন লাইনে (ক), (খ) উপ-ধারা লিখতে পারেন।"
                className="w-full p-3 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-base md:text-sm bn text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-65"
              />
              <p className="mt-1.5 text-xs text-[var(--muted)] leading-relaxed">
                নতুন লাইনে <code className="font-mono text-[var(--text)]">(ক)</code>,{' '}
                <code className="font-mono text-[var(--text)]">(খ)</code> লিখলে ফরমে স্বয়ংক্রিয়ভাবে ইনডেন্ট হবে এবং{' '}
                <code className="font-mono text-[var(--text)]">{'{{payeeText}}'}</code> দিলে বিলের প্রাপকের নাম বসবে।
              </p>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
