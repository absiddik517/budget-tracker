import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  CheckSquare,
  ClipboardList,
  Download,
  Edit2,
  FileSpreadsheet,
  FileText,
  Plus,
  ReceiptText,
  Square,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { StatusChip } from '../components/StatusChip';
import { SegmentedChips } from '../components/SegmentedChips';
import { FilterBar } from '../components/FilterBar';
import { EmptyState } from '../components/EmptyState';
import { EconomicCodeSelect } from '../components/EconomicCodeSelect';
import { SubmitBillModal, type SubmitBillFormValues } from '../components/SubmitBillModal';
import { useAuth } from '../contexts/AuthContext';
import { ALL_OFFICES_ID, LEGACY_UNMIGRATED_OFFICE_ID, useApp } from '../contexts/AppContext';
import { useFyData } from '../hooks/useFyData';
import { useEconomicCodes } from '../hooks/useEconomicCodes';
import { useActiveUsers } from '../hooks/useActiveUsers';
import { formatActorBrief, getActorUid } from '../lib/actor';
import { computeCodeAvailable } from '../lib/computeAvailable';
import { formatDateDisplay, todayYmd } from '../lib/dates';
import { isDateInFiscalYear } from '../lib/fy';
import {
  createDraftBillsFromItems,
  createExpenseItemsBatch,
  deleteExpenseItem,
  submitBillTx,
  updateExpenseItem,
  type DraftBillGroupInput,
} from '../lib/firestoreOps';
import {
  computeGrossedUpBill,
  formatNumberIN,
  formatPaisaInput,
  formatTaka,
  fromPaisa,
  toPaisa,
} from '../lib/money';
import {
  canApproveRejectCancelBill,
  canCreateDraftBill,
  canCreateExpenseItems,
} from '../lib/permissions';
import {
  DEFAULT_IT_CODE,
  DEFAULT_NET_PAYABLE_CODE,
  DEFAULT_SECURITY_CODE,
  DEFAULT_VAT_CODE,
} from '../lib/tr21Defaults';
import { toBanglaDigits } from '../lib/banglaFormat';
import { buildTr21IntroText, resolveBillPrimaryBudget } from '../lib/billFormData';
import { exportExpenseItemsPdf } from '../utils/exportPdf';
import { saveAndShareFile } from '../utils/saveFile';
import type {
  BillDeductionLine,
  EconomicCodeDoc,
  ExpenseItemDoc,
  VatVariant,
} from '../types';

interface EntryRowDraft {
  key: string;
  economicCode: string;
  headName: string;
  headNameBn: string;
  date: string;
  description: string;
  amountStr: string;
  employeeMode: 'user' | 'manual';
  userId: string;
  employeeName: string;
  employeeDesignation: string;
}

function makeEmptyRow(prev?: EntryRowDraft): EntryRowDraft {
  return {
    key: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    economicCode: prev?.economicCode || '',
    headName: prev?.headName || '',
    headNameBn: prev?.headNameBn || '',
    date: prev?.date || todayYmd(),
    description: '',
    amountStr: '',
    employeeMode: prev?.employeeMode || 'user',
    userId: prev?.userId || '',
    employeeName: prev?.employeeName || '',
    employeeDesignation: prev?.employeeDesignation || '',
  };
}

function normalizeDesc(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function ExpenseItemsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const { budgets, expenseItems, vatTaxRates, spendingLimits, fyCodeTotals, loading } =
    useFyData(selectedFy);
  const { getCodeEntry, getHead } = useEconomicCodes();
  const { users: activeUsers } = useActiveUsers();

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
  const canCreate =
    !isAllOfficesMode &&
    !isLegacyPreMigration &&
    Boolean(realOfficeId) &&
    canCreateExpenseItems(permCtx);
  const canDraftBill =
    !isAllOfficesMode &&
    !isLegacyPreMigration &&
    Boolean(realOfficeId) &&
    canCreateDraftBill(permCtx);

  const effectiveActor =
    actorSnapshot || (userDoc ? { uid: userDoc.id, name: userDoc.name } : null);

  const canModifyItem = (item: ExpenseItemDoc) =>
    !isSuperAdmin &&
    !isAllOfficesMode &&
    !isLegacyPreMigration &&
    Boolean(realOfficeId) &&
    item.status === 'listed' &&
    (isDdo || !item.createdBy || getActorUid(item.createdBy) === userDoc?.id);

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

  // List & filter state
  const [statusFilter, setStatusFilter] = useState<'listed' | 'billed' | 'all'>('listed');
  const [codeFilter, setCodeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

  // Multi-row Entry Modal
  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [rows, setRows] = useState<EntryRowDraft[]>([]);
  const [savingBatch, setSavingBatch] = useState(false);

  // Edit Single Item Modal
  const [editingItem, setEditingItem] = useState<ExpenseItemDoc | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editHeadName, setEditHeadName] = useState('');
  const [editHeadNameBn, setEditHeadNameBn] = useState('');
  const [editDate, setEditDate] = useState(todayYmd());
  const [editDescription, setEditDescription] = useState('');
  const [editAmountStr, setEditAmountStr] = useState('');
  const [editEmpMode, setEditEmpMode] = useState<'user' | 'manual'>('user');
  const [editUserId, setEditUserId] = useState('');
  const [editEmpName, setEditEmpName] = useState('');
  const [editEmpDesig, setEditEmpDesig] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Bill Preview / Prepare Modal
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [billDate, setBillDate] = useState(todayYmd());
  const [tokenNoInput, setTokenNoInput] = useState('');
  const [payeeTextInput, setPayeeTextInput] = useState('');
  const [netPayableCodeInput, setNetPayableCodeInput] = useState(DEFAULT_NET_PAYABLE_CODE);
  const [supplierName, setSupplierName] = useState('');
  const [supplierAddress, setSupplierAddress] = useState('');
  const [supplierTinBin, setSupplierTinBin] = useState('');
  const [showSupplierFields, setShowSupplierFields] = useState(false);
  const [purposeByCode, setPurposeByCode] = useState<Record<string, string>>({});
  const [deductionsByCode, setDeductionsByCode] = useState<Record<string, BillDeductionLine[]>>({});
  const [selectedVariantByCode, setSelectedVariantByCode] = useState<Record<string, string>>({});
  const [preparingAction, setPreparingAction] = useState<'draft' | 'submit' | null>(null);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);

  // Clear invalid selections if items get billed/deleted
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const listedSet = new Set(
        expenseItems.filter((i) => i.status === 'listed').map((i) => i.id)
      );
      const next = new Set(Array.from(prev).filter((id) => listedSet.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [expenseItems]);

  const searchAndCodeMatchedItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenseItems.filter((item) => {
      if (codeFilter && item.economicCode !== codeFilter) return false;
      if (!q) return true;
      const head = getHead(item.economicCode, {
        headName: item.headName,
        headNameBn: item.headNameBn,
      });
      return (
        item.economicCode.toLowerCase().includes(q) ||
        head.headName.toLowerCase().includes(q) ||
        head.headNameBn.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.responsibleEmployee.name.toLowerCase().includes(q) ||
        item.responsibleEmployee.designation.toLowerCase().includes(q)
      );
    });
  }, [expenseItems, codeFilter, search, getHead]);

  const statusChipOptions = useMemo(() => {
    let listed = 0;
    let billed = 0;
    for (const it of searchAndCodeMatchedItems) {
      if (it.status === 'listed') listed += 1;
      else if (it.status === 'billed') billed += 1;
    }
    return [
      { value: 'listed' as const, label: t('listed'), count: listed },
      { value: 'billed' as const, label: t('billed'), count: billed },
      { value: 'all' as const, label: t('all'), count: searchAndCodeMatchedItems.length },
    ];
  }, [searchAndCodeMatchedItems, t]);

  const filteredItems = useMemo(() => {
    if (statusFilter === 'all') return searchAndCodeMatchedItems;
    return searchAndCodeMatchedItems.filter((item) => item.status === statusFilter);
  }, [searchAndCodeMatchedItems, statusFilter]);

  const filteredTotalPaisa = useMemo(
    () => filteredItems.reduce((sum, item) => sum + item.amount, 0),
    [filteredItems]
  );

  const pagedItems = useMemo(() => {
    const start = (page - 1) * 50;
    return filteredItems.slice(start, start + 50);
  }, [filteredItems, page]);

  const selectableFilteredItems = useMemo(
    () => filteredItems.filter((i) => i.status === 'listed'),
    [filteredItems]
  );

  const selectedItems = useMemo(
    () => expenseItems.filter((i) => selectedIds.has(i.id) && i.status === 'listed'),
    [expenseItems, selectedIds]
  );

  const selectedTotalPaisa = useMemo(
    () => selectedItems.reduce((sum, i) => sum + i.amount, 0),
    [selectedItems]
  );

  const selectedDistinctCodeCount = useMemo(
    () => new Set(selectedItems.map((i) => i.economicCode)).size,
    [selectedItems]
  );

  const selectedEconomicCode = useMemo(() => {
    if (selectedItems.length === 0) return null;
    const codes = Array.from(new Set(selectedItems.map((i) => i.economicCode)));
    return codes.length === 1 ? codes[0] : null;
  }, [selectedItems]);

  const selectablePoolForToggle = useMemo(
    () =>
      selectedEconomicCode
        ? selectableFilteredItems.filter((i) => i.economicCode === selectedEconomicCode)
        : selectableFilteredItems,
    [selectableFilteredItems, selectedEconomicCode]
  );

  const allFilteredListedSelected =
    selectablePoolForToggle.length > 0 &&
    selectablePoolForToggle.every((i) => selectedIds.has(i.id));

  const toggleSelectAllFiltered = () => {
    if (allFilteredListedSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const item of selectablePoolForToggle) next.delete(item.id);
        return next;
      });
      return;
    }

    if (selectedEconomicCode) {
      if (selectablePoolForToggle.length === 0) {
        pushToast(
          'error',
          `ফিল্টার তালিকায় কোড ${selectedEconomicCode}-এর কোনো তালিকাভুক্ত খরচ নেই।`
        );
        return;
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const item of selectablePoolForToggle) next.add(item.id);
        return next;
      });
      return;
    }

    const distinctFilteredCodes = new Set(selectableFilteredItems.map((i) => i.economicCode));
    if (distinctFilteredCodes.size > 1) {
      pushToast(
        'error',
        'একটি বিলে শুধু একই কোডের খরচ নেওয়া যাবে। সব নির্বাচন করতে আগে অর্থনৈতিক কোড ফিল্টার করুন।'
      );
      return;
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of selectableFilteredItems) next.add(item.id);
      return next;
    });
  };

  const toggleSelectOne = (id: string) => {
    const target = expenseItems.find((i) => i.id === id);
    if (!target) return;

    if (selectedIds.has(id)) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return;
    }

    if (
      selectedItems.length > 0 &&
      selectedItems.some((it) => it.economicCode !== target.economicCode)
    ) {
      pushToast(
        'error',
        'একটি বিলে শুধুমাত্র একই অর্থনৈতিক কোডের খরচ যুক্ত করা যাবে। একাধিক কোডের খরচ নেওয়া যাবে না।'
      );
      return;
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  // Helper to resolve VAT/IT rates for a given code in active FY
  const resolveCodeRates = (economicCode: string) => {
    const fyRate = vatTaxRates.find((r) => r.economicCode === economicCode);
    if (fyRate) {
      return {
        incomeTax: fyRate.incomeTax,
        vat: fyRate.vat.length > 0 ? fyRate.vat : [{ key: 'default', label: 'Standard', rate: 0 }],
      };
    }
    const activeBudget = budgets.find(
      (b) => b.economicCode === economicCode && b.status === 'active'
    );
    if (activeBudget) {
      return {
        incomeTax: activeBudget.deductionRates.incomeTax,
        vat:
          activeBudget.deductionRates.vat.length > 0
            ? activeBudget.deductionRates.vat
            : [{ key: 'default', label: 'Standard', rate: 0 }],
      };
    }
    return {
      incomeTax: 0,
      vat: [{ key: 'default', label: 'Standard (0%)', rate: 0 }],
    };
  };

  // Grouped Bill Preview data
  const billPreviewGroups = useMemo(() => {
    const map = new Map<string, ExpenseItemDoc[]>();
    for (const item of selectedItems) {
      const list = map.get(item.economicCode) || [];
      list.push(item);
      map.set(item.economicCode, list);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([economicCode, items]) => {
        const head = getHead(economicCode, {
          headName: items[0].headName,
          headNameBn: items[0].headNameBn,
        });
        const rates = resolveCodeRates(economicCode);
        const chosenKey = selectedVariantByCode[economicCode];
        const variant: VatVariant =
          rates.vat.find((v) => v.key === chosenKey) || rates.vat[0];
        const expenseTotal = items.reduce((sum, i) => sum + i.amount, 0);

        const defaultDeductions: BillDeductionLine[] = [
          {
            id: 'it',
            code: officeSettings.defaultItCode || DEFAULT_IT_CODE,
            name: 'ব্যক্তি কর্তৃক দেয় আয়কর',
            rate: rates.incomeTax,
            amount: 0,
            kind: 'it',
          },
          {
            id: 'vat',
            code: officeSettings.defaultVatCode || DEFAULT_VAT_CODE,
            name: 'দেশজ পণ্য ও সেবার ওপর মূসক',
            rate: variant.rate,
            amount: 0,
            kind: 'vat',
          },
        ];

        const customList = deductionsByCode[economicCode];
        const inputDeductions =
          Array.isArray(customList) && customList.length > 0 ? customList : defaultDeductions;

        let rateError = '';
        let grossAmount = expenseTotal;
        let deductions = inputDeductions;
        let vatAmount = 0;
        let itAmount = 0;
        let totalDeduction = 0;
        let netPayable = expenseTotal;
        let effectiveVatRate = variant.rate;
        let effectiveItRate = rates.incomeTax;
        let totalPercentRate = 0;

        try {
          const calc = computeGrossedUpBill({
            expenseTotalPaisa: expenseTotal,
            vatRate: variant.rate,
            itRate: rates.incomeTax,
            customDeductions: inputDeductions,
            defaultItCode: officeSettings.defaultItCode || DEFAULT_IT_CODE,
            defaultVatCode: officeSettings.defaultVatCode || DEFAULT_VAT_CODE,
          });
          grossAmount = calc.grossAmount;
          deductions = calc.deductions;
          vatAmount = calc.vatAmount;
          itAmount = calc.itAmount;
          totalDeduction = calc.totalDeduction;
          netPayable = calc.netPayable;
          effectiveVatRate = calc.effectiveVatRate;
          effectiveItRate = calc.effectiveItRate;
          totalPercentRate = calc.totalPercentRate;
        } catch (err) {
          rateError =
            err instanceof Error ? err.message : 'মোট কর্তনের হার ১০০% বা তার বেশি হতে পারে না।';
        }

        const fyTotal = fyCodeTotals.find(
          (f) =>
            f.economicCode === economicCode &&
            (!realOfficeId || !f.officeId || f.officeId === realOfficeId)
        );
        const avail = computeCodeAvailable({
          fiscalYear: selectedFy,
          economicCode,
          budgets,
          fyCodeTotal: fyTotal,
          spendingLimits,
          date: billDate || todayYmd(),
          gross: grossAmount,
        });
        const hasActiveBudget = budgets.some(
          (b) => b.economicCode === economicCode && b.status === 'active'
        );

        return {
          economicCode,
          headName: head.headName,
          headNameBn: head.headNameBn,
          items,
          vatVariants: rates.vat,
          selectedVariant: variant,
          vatRate: effectiveVatRate,
          itRate: effectiveItRate,
          totalPercentRate,
          expenseTotal,
          grossAmount,
          deductions,
          vatAmount,
          itAmount,
          totalDeduction,
          netPayable,
          rateError,
          avail,
          hasActiveBudget,
        };
      });
  }, [
    selectedItems,
    selectedVariantByCode,
    deductionsByCode,
    getHead,
    vatTaxRates,
    budgets,
    fyCodeTotals,
    realOfficeId,
    spendingLimits,
    selectedFy,
    billDate,
    officeSettings.defaultItCode,
    officeSettings.defaultVatCode,
  ]);

  // Multi-row Entry Modal helpers & live Stage 1 checks
  const openEntryModal = () => {
    const defaultUser = activeUsers.find((u) => u.id === userDoc?.id) || activeUsers[0];
    setRows([
      {
        ...makeEmptyRow(),
        employeeMode: defaultUser ? 'user' : 'manual',
        userId: defaultUser?.id || '',
        employeeName: defaultUser?.name || userDoc?.name || '',
        employeeDesignation: defaultUser?.designation || userDoc?.designation || '',
      },
    ]);
    setEntryModalOpen(true);
  };

  useEffect(() => {
    if (searchParams.get('new') === '1' && canCreate) {
      openEntryModal();
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, canCreate]);

  const updateRow = (idx: number, patch: Partial<EntryRowDraft>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const entryBatchSummary = useMemo(() => {
    const totalsByCode = new Map<string, { amount: number; date: string; headName: string }>();
    let grandTotal = 0;

    for (const r of rows) {
      const amt = toPaisa(r.amountStr);
      const validAmt = Number.isFinite(amt) && amt > 0 ? amt : 0;
      grandTotal += validAmt;
      const code = r.economicCode.trim();
      if (code) {
        const prev = totalsByCode.get(code);
        const head = getHead(code, { headName: r.headName, headNameBn: r.headNameBn });
        totalsByCode.set(code, {
          amount: (prev?.amount || 0) + validAmt,
          date: prev?.date || r.date || todayYmd(),
          headName: head.displayName,
        });
      }
    }

    const codeStatuses = Array.from(totalsByCode.entries()).map(([code, info]) => {
      const fyTotal = fyCodeTotals.find(
        (f) =>
          f.economicCode === code &&
          (!realOfficeId || !f.officeId || f.officeId === realOfficeId)
      );
      const avail = computeCodeAvailable({
        fiscalYear: selectedFy,
        economicCode: code,
        budgets,
        fyCodeTotal: fyTotal,
        spendingLimits,
        date: info.date,
        gross: info.amount,
      });
      const hasBudget = budgets.some((b) => b.economicCode === code && b.status === 'active');
      const exceeds = !hasBudget || (info.amount > 0 && info.amount > avail.available);
      return {
        code,
        headName: info.headName,
        enteredAmount: info.amount,
        available: avail.available,
        hasBudget,
        exceeds,
        message: !hasBudget
          ? `${code}: কোনো সক্রিয় বাজেট বরাদ্দ নেই`
          : avail.limitingConstraint.exceededMessage,
      };
    });

    // Duplicate detection (non-blocking warning)
    const duplicateWarnings: string[] = [];
    rows.forEach((r, idx) => {
      const amt = toPaisa(r.amountStr);
      const desc = normalizeDesc(r.description);
      if (!r.economicCode || !r.date || !Number.isFinite(amt) || amt <= 0 || !desc) return;

      const matchesExisting = expenseItems.some(
        (ex) =>
          ex.economicCode === r.economicCode &&
          ex.date === r.date &&
          ex.amount === amt &&
          normalizeDesc(ex.description) === desc
      );
      const matchesSibling = rows.some(
        (other, oIdx) =>
          oIdx !== idx &&
          other.economicCode === r.economicCode &&
          other.date === r.date &&
          toPaisa(other.amountStr) === amt &&
          normalizeDesc(other.description) === desc
      );
      if (matchesExisting || matchesSibling) {
        duplicateWarnings.push(
          `আইটেম #${idx + 1} (${r.economicCode}, ${formatDateDisplay(r.date)}, ${formatTaka(amt)}) একই ধরনের একটি খরচের সাথে মিলে গেছে।`
        );
      }
    });

    return {
      grandTotal,
      codeStatuses,
      hasBudgetWarning: codeStatuses.some((c) => c.exceeds),
      duplicateWarnings,
    };
  }, [rows, budgets, fyCodeTotals, realOfficeId, spendingLimits, selectedFy, expenseItems, getHead]);

  const handleSaveBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userDoc || !canCreate || !realOfficeId || !effectiveActor) return;

    const prepared = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const master = getCodeEntry(r.economicCode.trim());
      if (!master || master.special) {
        pushToast('error', `আইটেম #${i + 1}: বৈধ ৭-অঙ্কের অর্থনৈতিক কোড নির্বাচন করুন।`);
        return;
      }
      if (!isDateInFiscalYear(r.date, selectedFy)) {
        pushToast('error', `আইটেম #${i + 1}: তারিখ FY ${selectedFy} এর মধ্যে হতে হবে।`);
        return;
      }
      const amt = toPaisa(r.amountStr);
      if (!Number.isFinite(amt) || amt <= 0) {
        pushToast('error', `আইটেম #${i + 1}: ০ এর বেশি টাকার পরিমাণ দিন।`);
        return;
      }
      if (!r.description.trim()) {
        pushToast('error', `আইটেম #${i + 1}: খরচের বিবরণ লিখুন।`);
        return;
      }
      if (!r.employeeName.trim()) {
        pushToast('error', `আইটেম #${i + 1}: দায়িত্বপ্রাপ্ত কর্মচারীর নাম দিন।`);
        return;
      }
      prepared.push({
        officeId: realOfficeId,
        fiscalYear: selectedFy,
        economicCode: master.code,
        headName: master.headName,
        headNameBn: master.headNameBn,
        date: r.date,
        description: r.description.trim(),
        amount: amt,
        responsibleEmployee: {
          userId: r.employeeMode === 'user' ? r.userId || null : null,
          name: r.employeeName.trim(),
          designation: r.employeeDesignation.trim(),
        },
      });
    }

    setSavingBatch(true);
    try {
      await createExpenseItemsBatch(prepared, effectiveActor);
      pushToast('success', `${prepared.length}টি খরচ আইটেম তালিকায় যুক্ত হয়েছে।`);
      setEntryModalOpen(false);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'খরচ সংরক্ষণ ব্যর্থ হয়েছে।');
    } finally {
      setSavingBatch(false);
    }
  };

  // Single item edit & delete
  const openEditModal = (item: ExpenseItemDoc) => {
    if (item.status !== 'listed') return;
    const head = getHead(item.economicCode, {
      headName: item.headName,
      headNameBn: item.headNameBn,
    });
    setEditingItem(item);
    setEditCode(item.economicCode);
    setEditHeadName(head.headName);
    setEditHeadNameBn(head.headNameBn);
    setEditDate(item.date);
    setEditDescription(item.description);
    setEditAmountStr(formatPaisaInput(item.amount));
    const hasLinkedUser = Boolean(
      item.responsibleEmployee.userId &&
        activeUsers.some((u) => u.id === item.responsibleEmployee.userId)
    );
    setEditEmpMode(hasLinkedUser ? 'user' : 'manual');
    setEditUserId(item.responsibleEmployee.userId || '');
    setEditEmpName(item.responsibleEmployee.name);
    setEditEmpDesig(item.responsibleEmployee.designation);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userDoc || !editingItem || !effectiveActor || !canModifyItem(editingItem)) return;
    const master = getCodeEntry(editCode.trim());
    if (!master || master.special) {
      pushToast('error', 'বৈধ অর্থনৈতিক কোড নির্বাচন করুন।');
      return;
    }
    const amt = toPaisa(editAmountStr);
    if (!Number.isFinite(amt) || amt <= 0) {
      pushToast('error', 'সঠিক টাকার পরিমাণ দিন।');
      return;
    }
    setSavingEdit(true);
    try {
      await updateExpenseItem(
        editingItem,
        {
          officeId: editingItem.officeId || realOfficeId,
          fiscalYear: selectedFy,
          economicCode: master.code,
          headName: master.headName,
          headNameBn: master.headNameBn,
          date: editDate,
          description: editDescription,
          amount: amt,
          responsibleEmployee: {
            userId: editEmpMode === 'user' ? editUserId || null : null,
            name: editEmpName,
            designation: editEmpDesig,
          },
        },
        effectiveActor
      );
      pushToast('success', 'খরচ আইটেম হালনাগাদ হয়েছে।');
      setEditingItem(null);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'হালনাগাদ ব্যর্থ হয়েছে।');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteItem = async (item: ExpenseItemDoc) => {
    if (!userDoc || !effectiveActor || !canModifyItem(item)) return;
    try {
      await deleteExpenseItem(item, effectiveActor);
      pushToast('success', 'খরচ আইটেম মুছে ফেলা হয়েছে।');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'মুছে ফেলা ব্যর্থ হয়েছে।');
    }
  };

  // Bill preparation submit / save draft
  const openPrepareModal = () => {
    if (selectedItems.length === 0) return;
    if (selectedDistinctCodeCount > 1) {
      pushToast(
        'error',
        'একটি বিলে শুধুমাত্র একই অর্থনৈতিক কোডের খরচ যুক্ত করা যাবে। একাধিক কোডের খরচ নেওয়া যাবে না।'
      );
      return;
    }
    setBillDate(todayYmd());
    setTokenNoInput('');
    setPayeeTextInput(officeSettings.defaultPayeeText || '');
    setNetPayableCodeInput(officeSettings.defaultNetPayableCode || DEFAULT_NET_PAYABLE_CODE);
    setSupplierName('');
    setSupplierAddress('');
    setSupplierTinBin('');
    setShowSupplierFields(false);

    const initVariants: Record<string, string> = {};
    const initPurposes: Record<string, string> = {};
    const initDeductions: Record<string, BillDeductionLine[]> = {};

    const grouped = new Map<string, ExpenseItemDoc[]>();
    for (const item of selectedItems) {
      const arr = grouped.get(item.economicCode) || [];
      arr.push(item);
      grouped.set(item.economicCode, arr);
    }

    grouped.forEach((items, code) => {
      const r = resolveCodeRates(code);
      const firstVat = r.vat[0] || { key: 'default', label: 'Standard', rate: 0 };
      initVariants[code] = firstVat.key;
      const head = getHead(code, { headName: items[0].headName, headNameBn: items[0].headNameBn });
      const headBn = head.headNameBn || head.headName;
      initPurposes[code] = `${headBn} বাবদ ব্যয়ের বিল।`;

      const expenseTotal = items.reduce((s, it) => s + it.amount, 0);
      try {
        const calc = computeGrossedUpBill({
          expenseTotalPaisa: expenseTotal,
          vatRate: firstVat.rate,
          itRate: r.incomeTax,
          defaultItCode: officeSettings.defaultItCode || DEFAULT_IT_CODE,
          defaultVatCode: officeSettings.defaultVatCode || DEFAULT_VAT_CODE,
        });
        initDeductions[code] = calc.deductions;
      } catch {
        initDeductions[code] = [
          {
            id: 'it',
            code: officeSettings.defaultItCode || DEFAULT_IT_CODE,
            name: 'ব্যক্তি কর্তৃক দেয় আয়কর',
            rate: r.incomeTax,
            amount: 0,
            kind: 'it',
          },
          {
            id: 'vat',
            code: officeSettings.defaultVatCode || DEFAULT_VAT_CODE,
            name: 'দেশজ পণ্য ও সেবার ওপর মূসক',
            rate: firstVat.rate,
            amount: 0,
            kind: 'vat',
          },
        ];
      }
    });

    setSelectedVariantByCode(initVariants);
    setPurposeByCode(initPurposes);
    setDeductionsByCode(initDeductions);
    setPrepareOpen(true);
  };

  const handleCreateBills = async (mode: 'draft' | 'submit', submitValues?: SubmitBillFormValues) => {
    if (
      !userDoc ||
      !canDraftBill ||
      !realOfficeId ||
      !effectiveActor ||
      billPreviewGroups.length === 0
    ) {
      return;
    }
    if (billPreviewGroups.length > 1) {
      pushToast(
        'error',
        'একটি বিলে শুধুমাত্র একই অর্থনৈতিক কোডের খরচ যুক্ত করা যাবে।'
      );
      return;
    }
    const invalidRateGroup = billPreviewGroups.find((g) => Boolean(g.rateError));
    if (invalidRateGroup) {
      pushToast('error', invalidRateGroup.rateError);
      return;
    }
    if (mode === 'submit' && !isOnline) {
      pushToast(
        'error',
        'অফলাইনে বিল জমা দেওয়া যায় না। খসড়া হিসেবে সংরক্ষণ করুন অথবা অনলাইন হয়ে জমা দিন।'
      );
      return;
    }
    if (mode === 'submit' && !submitValues) {
      setSubmitConfirmOpen(true);
      return;
    }

    setPreparingAction(mode);
    try {
      const effectiveDate = submitValues?.billDate || billDate;
      const effectiveTokenNo =
        submitValues !== undefined ? submitValues.tokenNo : tokenNoInput.trim();
      const effectivePayee =
        submitValues !== undefined ? submitValues.payeeText : payeeTextInput.trim();
      const effectiveVoucherNo = submitValues?.voucherNo?.trim() || '';

      const supplierPayload =
        supplierName.trim() || supplierAddress.trim() || supplierTinBin.trim()
          ? {
              name: supplierName.trim(),
              address: supplierAddress.trim(),
              tinBin: supplierTinBin.trim(),
            }
          : null;

      const groupInputs: DraftBillGroupInput[] = billPreviewGroups.map((g) => ({
        officeId: realOfficeId,
        fiscalYear: selectedFy,
        economicCode: g.economicCode,
        headName: g.headName,
        headNameBn: g.headNameBn,
        date: effectiveDate,
        billDate: effectiveDate,
        voucherNo: effectiveVoucherNo,
        tokenNo: effectiveTokenNo,
        purposeText:
          submitValues !== undefined
            ? submitValues.purposeText
            : (purposeByCode[g.economicCode] || '').trim(),
        payeeText: effectivePayee,
        netPayableCode: netPayableCodeInput.trim() || DEFAULT_NET_PAYABLE_CODE,
        supplier: supplierPayload,
        deductions: g.deductions,
        items: g.items,
        vatRate: g.vatRate,
        itRate: g.itRate,
        vatVariant: g.selectedVariant.key,
        vatVariantLabel: g.selectedVariant.label,
      }));

      const createdBillIds = await createDraftBillsFromItems(groupInputs, effectiveActor);

      if (mode === 'submit') {
        const assignedNumbers: string[] = [];
        try {
          for (const billId of createdBillIds) {
            const res = await submitBillTx(billId, effectiveActor, submitValues);
            assignedNumbers.push(res.billNo);
          }
        } catch (submitErr) {
          setSelectedIds(new Set());
          setSubmitConfirmOpen(false);
          setPrepareOpen(false);
          pushToast(
            'error',
            `বিলটি খসড়া হিসেবে তৈরি হয়েছে, কিন্তু জমা দেওয়া যায়নি: ${
              submitErr instanceof Error ? submitErr.message : 'ত্রুটি ঘটেছে।'
            }`
          );
          navigate('/bills?status=draft');
          return;
        }
        pushToast(
          'success',
          `${assignedNumbers.length}টি বিল জমা হয়েছে (${assignedNumbers.join(', ')})।`
        );
        setSelectedIds(new Set());
        setSubmitConfirmOpen(false);
        setPrepareOpen(false);
        navigate('/bills?status=submitted');
      } else {
        pushToast('success', `${createdBillIds.length}টি খসড়া বিল প্রস্তুত হয়েছে।`);
        setSelectedIds(new Set());
        setPrepareOpen(false);
        navigate('/bills?status=draft');
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'বিল প্রস্তুত করা যায়নি।');
    } finally {
      setPreparingAction(null);
    }
  };

  // Exports
  const handleExportPdf = async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      const outcome = await exportExpenseItemsPdf({
        items: filteredItems,
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
        pushToast('success', 'Expense items PDF downloaded.');
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
      const excelRows = filteredItems.map((item) => {
        const head = getHead(item.economicCode, {
          headName: item.headName,
          headNameBn: item.headNameBn,
        });
        return {
          Date: formatDateDisplay(item.date),
          'Economic Code': item.economicCode,
          'ব্যয়ের খাত': head.displayName,
          Description: item.description,
          'Responsible Employee': item.responsibleEmployee.name,
          Designation: item.responsibleEmployee.designation,
          'Entered By': formatActorBrief(item.createdBy, officesById, item.createdByName),
          'Amount (BDT)': fromPaisa(item.amount),
          Status: item.status,
          'Bill ID': item.billId || '',
        };
      });
      const ws = XLSX.utils.json_to_sheet(excelRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Expense Items');
      const wbArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
      const outcome = await saveAndShareFile({
        data: new Uint8Array(wbArray),
        fileName: `expense-items-FY-${selectedFy}.xlsx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        title: `Expense List (FY ${selectedFy})`,
      });
      if (outcome.status === 'shared') {
        pushToast('success', 'Excel ready — choose an app to open or save.');
      } else if (outcome.status === 'downloaded') {
        pushToast('success', 'Expense items Excel downloaded.');
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
              onClick={() => {
                setExportMenuOpen(false);
                void handleExportPdf();
              }}
              className="w-full min-h-[44px] px-3 rounded-lg hover:bg-[var(--surface-subtle)] text-left text-xs font-medium inline-flex items-center gap-2 disabled:opacity-60"
            >
              <FileText className="w-4 h-4 text-[var(--muted)] shrink-0" />
              <span>{exportingPdf ? 'PDF…' : t('exportPdfList')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={exportingExcel}
              onClick={() => {
                setExportMenuOpen(false);
                void handleExportExcel();
              }}
              className="w-full min-h-[44px] px-3 rounded-lg hover:bg-[var(--surface-subtle)] text-left text-xs font-medium inline-flex items-center gap-2 disabled:opacity-60"
            >
              <FileSpreadsheet className="w-4 h-4 text-[var(--muted)] shrink-0" />
              <span>{exportingExcel ? 'Excel…' : t('exportExcelList')}</span>
            </button>
          </div>
        )}
      </div>
      {canCreate && (
        <button
          type="button"
          onClick={openEntryModal}
          className="min-h-[44px] px-4 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span>{t('addExpenseItems')}</span>
        </button>
      )}
    </div>
  );

  if (isAllOfficesMode || (!currentOfficeId && !isLegacyPreMigration)) {
    return (
      <Layout title={t('navExpenseItems')}>
        <PageHeader title={t('navExpenseItems')} subtitle={null} />
        <div className="card-surface p-6 text-center space-y-2 max-w-lg mx-auto">
          <h2 className="text-base font-bold text-[var(--text)]">একটি অফিস নির্বাচন করুন</h2>
          <p className="text-xs sm:text-sm text-[var(--muted)]">
            {isSuperAdmin
              ? 'খরচের তালিকা দেখতে এবং প্রিন্ট/এক্সপোর্ট করতে উপরের অফিস সুইচার থেকে যেকোনো একটি নির্দিষ্ট অফিস নির্বাচন করুন।'
              : 'আপনার জন্য কোনো সক্রিয় অফিস নির্ধারিত নেই। অনুগ্রহ করে সুপার অ্যাডমিন বা দপ্তর প্রধানের সাথে যোগাযোগ করুন।'}
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={t('navExpenseItems')}>
      <PageHeader
        title={t('navExpenseItems')}
        subtitle={`FY ${selectedFy} · ${expenseItems.length} ${t('itemsCountLabel')}`}
        actions={headerActions}
      />

      <div className={`space-y-4 ${selectedItems.length > 0 && canDraftBill ? 'pb-24' : ''}`}>
        {isLegacyPreMigration && (
          <div className="px-3.5 py-2.5 rounded-[14px] bg-[var(--warn-bg)] text-[var(--warn-text)] text-xs font-medium">
            মাল্টি-অফিস মাইগ্রেশন সম্পন্ন হয়নি। নতুন খরচ এন্ট্রি বা বিল তৈরি করতে সুপার অ্যাডমিন সেটিংস থেকে &ldquo;Migrate to multi-office&rdquo; চালান।
          </div>
        )}

        {!isOnline && (
          <div className="px-3.5 py-2.5 rounded-[14px] bg-[var(--warn-bg)] text-[var(--warn-text)] text-xs font-medium flex items-center gap-2">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>
              অফলাইন মোড: খরচ আইটেম যুক্ত/সম্পাদনা ও খসড়া বিল তৈরি করা যাবে; বিল জমা (Submit) দিতে ইন্টারনেট প্রয়োজন।
            </span>
          </div>
        )}

        {/* Current Filter Summary Card */}
        <div className="card-surface p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-[var(--muted)]">
              {t('currentFilterLabel')} · {t(statusFilter)}
            </div>
            <div className="text-sm font-medium text-[var(--text)] tabular-nums mt-0.5">
              {filteredItems.length} {t('itemsCountLabel')}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-[var(--muted)]">{t('amount')}</div>
            <div className="text-lg md:text-xl font-bold text-[var(--accent)] tabular-nums">
              {formatTaka(filteredTotalPaisa)}
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <SegmentedChips
            options={statusChipOptions}
            value={statusFilter}
            onChange={(st) => {
              setStatusFilter(st);
              setPage(1);
            }}
            ariaLabel="Filter expense items by status"
            trailing={
              canDraftBill && selectableFilteredItems.length > 0 ? (
                <button
                  type="button"
                  onClick={toggleSelectAllFiltered}
                  className="min-h-[44px] md:min-h-[40px] px-3 rounded-full border border-[var(--line)] bg-[var(--card)] text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  {allFilteredListedSelected ? (
                    <CheckSquare className="w-4 h-4 text-[var(--accent)]" />
                  ) : (
                    <Square className="w-4 h-4 text-[var(--muted)]" />
                  )}
                  <span>{allFilteredListedSelected ? 'সব বাদ দিন' : 'সব নির্বাচন'}</span>
                </button>
              ) : null
            }
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
            searchPlaceholder="বিবরণ, কর্মচারী, কোড…"
            searchAriaLabel="Search expense items"
          />
        </div>

        {/* List Card */}
        {loading ? (
          <div className="card-surface p-8 text-center text-sm text-[var(--muted)]">
            খরচ তালিকা লোড হচ্ছে…
          </div>
        ) : pagedItems.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="w-5 h-5" />}
            title={t('noDataFound')}
            action={
              expenseItems.length === 0 && canCreate ? (
                <button
                  type="button"
                  onClick={openEntryModal}
                  className="min-h-[44px] px-4 rounded-xl bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t('addExpenseItems')}</span>
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="card-surface overflow-hidden">
            {/* Mobile Cards (< 1024px) */}
            <div className="lg:hidden divide-y divide-[var(--line)]">
              {pagedItems.map((item) => {
                const head = getHead(item.economicCode, {
                  headName: item.headName,
                  headNameBn: item.headNameBn,
                });
                const isListed = item.status === 'listed';
                const checked = selectedIds.has(item.id);
                const diffCode = Boolean(
                  selectedEconomicCode && item.economicCode !== selectedEconomicCode && !checked
                );
                return (
                  <div
                    key={item.id}
                    className={`p-3.5 space-y-2 transition-colors ${
                      checked ? 'bg-[var(--accent-soft)]/35' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {canDraftBill && isListed ? (
                        <button
                          type="button"
                          onClick={() => toggleSelectOne(item.id)}
                          title={
                            diffCode
                              ? 'অন্য অর্থনৈতিক কোড — একটি বিলে শুধু একই কোডের খরচ যুক্ত করা যাবে'
                              : undefined
                          }
                          aria-label={`Select ${item.description}`}
                          className={`min-h-[44px] min-w-[44px] -ml-1.5 -mt-1.5 inline-flex items-center justify-center rounded-lg shrink-0 ${
                            diffCode
                              ? 'text-[var(--muted)]/40 cursor-not-allowed'
                              : 'text-[var(--accent)]'
                          }`}
                        >
                          {checked ? (
                            <CheckSquare className="w-5 h-5" />
                          ) : (
                            <Square
                              className={`w-5 h-5 ${
                                diffCode ? 'text-[var(--muted)]/40' : 'text-[var(--muted)]'
                              }`}
                            />
                          )}
                        </button>
                      ) : (
                        <div className="w-2 shrink-0" />
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm font-semibold text-[var(--text)] bn break-words">
                            {item.description}
                          </div>
                          <StatusChip variant={item.status}>{t(item.status)}</StatusChip>
                        </div>

                        <div className="text-xs text-[var(--muted)] mt-1 break-words">
                          <span className="tabular-nums font-semibold text-[var(--text)]">
                            {item.economicCode}
                          </span>{' '}
                          <span className="bn">{head.displayName}</span>
                        </div>

                        <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-[var(--line)]/60 text-xs">
                          <div className="min-w-0 text-[var(--muted)] truncate">
                            <span className="tabular-nums">{formatDateDisplay(item.date)}</span> ·{' '}
                            <span className="bn text-[var(--text)] font-medium">
                              {item.responsibleEmployee.name}
                            </span>
                            {item.responsibleEmployee.designation && (
                              <span> ({item.responsibleEmployee.designation})</span>
                            )}
                          </div>
                          <div className="font-bold text-sm text-[var(--text)] tabular-nums shrink-0">
                            {formatTaka(item.amount)}
                          </div>
                        </div>

                        {(item.createdBy || item.createdByName) && (
                          <div className="text-[11px] text-[var(--muted)] mt-1 truncate">
                            এন্ট্রি: {formatActorBrief(item.createdBy, officesById, item.createdByName)}
                          </div>
                        )}

                        <div className="flex items-center justify-end gap-2 mt-2">
                          {isListed ? (
                            canModifyItem(item) ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditModal(item)}
                                  className="min-h-[44px] px-3 rounded-lg border border-[var(--line)] text-xs font-medium inline-flex items-center gap-1"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                  <span>{t('edit')}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteItem(item)}
                                  className="min-h-[44px] px-3 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--danger-text)] inline-flex items-center gap-1"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>{t('delete')}</span>
                                </button>
                              </>
                            ) : null
                          ) : (
                            <Link
                              to={item.billId ? `/bills/${item.billId}` : '/bills'}
                              className="min-h-[44px] inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)] hover:underline"
                            >
                              <ReceiptText className="w-3.5 h-3.5" />
                              <span>বিলে যুক্ত · দেখুন</span>
                            </Link>
                          )}
                        </div>
                      </div>
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
                    <th className="py-3 pl-4 pr-2 w-10">
                      {canDraftBill && (
                        <button
                          type="button"
                          onClick={toggleSelectAllFiltered}
                          disabled={selectableFilteredItems.length === 0}
                          aria-label="Toggle select all listed items"
                          className="inline-flex items-center justify-center p-1 rounded disabled:opacity-40"
                        >
                          {allFilteredListedSelected ? (
                            <CheckSquare className="w-4 h-4 text-[var(--accent)]" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </th>
                    <th className="py-3 px-3 font-medium whitespace-nowrap">{t('date')}</th>
                    <th className="py-3 px-3 font-medium">{t('description')}</th>
                    <th className="py-3 px-3 font-medium">{t('head')}</th>
                    <th className="py-3 px-3 font-medium">{t('responsibleEmployee')}</th>
                    <th className="py-3 px-3 font-medium text-right whitespace-nowrap">
                      {t('amount')}
                    </th>
                    <th className="py-3 px-3 font-medium whitespace-nowrap">{t('status')}</th>
                    <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {pagedItems.map((item) => {
                    const head = getHead(item.economicCode, {
                      headName: item.headName,
                      headNameBn: item.headNameBn,
                    });
                    const isListed = item.status === 'listed';
                    const checked = selectedIds.has(item.id);
                    const diffCode = Boolean(
                      selectedEconomicCode && item.economicCode !== selectedEconomicCode && !checked
                    );
                    return (
                      <tr
                        key={item.id}
                        className={`transition-colors ${
                          checked ? 'bg-[var(--accent-soft)]/35' : 'hover:bg-[var(--surface-subtle)]'
                        }`}
                      >
                        <td className="py-3 pl-4 pr-2">
                          {canDraftBill && isListed && (
                            <button
                              type="button"
                              onClick={() => toggleSelectOne(item.id)}
                              title={
                                diffCode
                                  ? 'অন্য অর্থনৈতিক কোড — একটি বিলে শুধু একই কোডের খরচ যুক্ত করা যাবে'
                                  : undefined
                              }
                              aria-label={`Select ${item.description}`}
                              className={`inline-flex items-center justify-center p-1 rounded ${
                                diffCode ? 'opacity-40 cursor-not-allowed' : ''
                              }`}
                            >
                              {checked ? (
                                <CheckSquare className="w-4 h-4 text-[var(--accent)]" />
                              ) : (
                                <Square className="w-4 h-4 text-[var(--muted)]" />
                              )}
                            </button>
                          )}
                        </td>
                        <td className="py-3 px-3 tabular-nums whitespace-nowrap text-[var(--muted)]">
                          {formatDateDisplay(item.date)}
                        </td>
                        <td className="py-3 px-3 bn max-w-[240px] break-words">
                          <div className="font-medium text-[var(--text)]">{item.description}</div>
                          {(item.createdBy || item.createdByName) && (
                            <div className="text-[11px] text-[var(--muted)] mt-0.5">
                              এন্ট্রি: {formatActorBrief(item.createdBy, officesById, item.createdByName)}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 min-w-[180px]">
                          <div className="font-medium text-[var(--text)]">
                            <span className="tabular-nums">{item.economicCode}</span>{' '}
                            <span className="bn">{head.displayName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium bn">{item.responsibleEmployee.name}</div>
                          {item.responsibleEmployee.designation && (
                            <div className="text-xs text-[var(--muted)]">
                              {item.responsibleEmployee.designation}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-semibold tabular-nums whitespace-nowrap">
                          {formatTaka(item.amount)}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <StatusChip variant={item.status}>{t(item.status)}</StatusChip>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {isListed ? (
                            canModifyItem(item) ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openEditModal(item)}
                                  className="min-h-[34px] px-2.5 rounded-md border border-[var(--line)] text-xs font-medium hover:bg-[var(--surface-subtle)]"
                                >
                                  {t('edit')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteItem(item)}
                                  className="min-h-[34px] px-2.5 rounded-md border border-[var(--line)] text-xs font-medium text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40"
                                >
                                  {t('delete')}
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-[var(--muted)]">—</span>
                            )
                          ) : (
                            <Link
                              to={item.billId ? `/bills/${item.billId}` : '/bills'}
                              className="text-xs font-semibold text-[var(--accent)] hover:underline"
                            >
                              বিলে যুক্ত · দেখুন
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination page={page} totalItems={filteredItems.length} onPageChange={setPage} />
          </div>
        )}
      </div>

      {/* Sticky Bottom Bill Selection Bar */}
      {canDraftBill && selectedItems.length > 0 && (
        <div className="sticky bottom-2 lg:bottom-4 z-20 mt-3 card-surface border-2 border-[var(--accent)] p-3 md:p-4 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="min-w-0">
            <div className="text-sm font-bold text-[var(--text)] tabular-nums">
              {t('createBillSelectedPrefix')} {selectedItems.length} {t('createBillSelectedSuffix')} ·{' '}
              {formatTaka(selectedTotalPaisa)}
            </div>
            <div
              className={`text-xs ${
                selectedDistinctCodeCount > 1
                  ? 'text-[var(--danger-text)] font-semibold'
                  : 'text-[var(--muted)]'
              }`}
            >
              {selectedDistinctCodeCount > 1
                ? 'একাধিক অর্থনৈতিক কোড নির্বাচিত হয়েছে — একটি বিলে শুধু একই কোডের খরচ নেওয়া যাবে।'
                : `কোড ${selectedEconomicCode} এর জন্য ১টি বিল প্রস্তুত হবে (কর্তন যোগ করে মোট বিল হিসাব হবে)`}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="min-h-[44px] px-3.5 rounded-xl border border-[var(--line)] text-xs font-medium"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              disabled={selectedDistinctCodeCount > 1}
              onClick={openPrepareModal}
              className="min-h-[44px] px-4 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <ReceiptText className="w-4 h-4 shrink-0" />
              <span>{t('prepareBill')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Multi-Row Expense Entry Modal */}
      <Modal
        open={entryModalOpen}
        onClose={() => setEntryModalOpen(false)}
        title="নতুন খরচ যোগ করুন (খরচ তালিকা)"
        subtitle={`FY ${selectedFy} · এখানে শুধু মূল খরচ লিখুন (বিল করার সময় ভ্যাট/ট্যাক্স যোগ করে মোট বিল হিসাব হবে)`}
        fullScreenOnMobile
        maxWidthClass="md:max-w-3xl"
        footer={
          <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setRows((prev) => [...prev, makeEmptyRow(prev[prev.length - 1])])}
              className="w-full sm:w-auto min-h-[44px] px-4 rounded-lg border border-[var(--accent)] text-[var(--accent)] text-sm font-semibold inline-flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>আরেকটি যোগ করুন</span>
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEntryModalOpen(false)}
                className="flex-1 sm:flex-initial min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                form="expense-batch-form"
                disabled={savingBatch}
                className="flex-1 sm:flex-initial min-h-[44px] px-5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
              >
                {savingBatch ? 'সংরক্ষণ হচ্ছে…' : `সংরক্ষণ করুন (${rows.length})`}
              </button>
            </div>
          </div>
        }
      >
        <form id="expense-batch-form" onSubmit={handleSaveBatch} className="space-y-4">
          {/* Live Sticky Summary & Stage 1 Warning */}
          <div className="p-3 rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)] space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
              <span>মোট আইটেম: {rows.length}টি</span>
              <span className="tabular-nums text-sm text-[var(--accent)]">
                সর্বমোট: {formatTaka(entryBatchSummary.grandTotal)}
              </span>
            </div>

            {entryBatchSummary.codeStatuses.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {entryBatchSummary.codeStatuses.map((cs) => (
                  <div
                    key={cs.code}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium tabular-nums border ${
                      cs.exceeds
                        ? 'bg-[var(--danger-bg)] text-[var(--danger-text)] border-[var(--danger-text)]/40'
                        : 'bg-[var(--card)] text-[var(--text)] border-[var(--line)]'
                    }`}
                  >
                    {cs.code}: উপলব্ধ {formatTaka(cs.available)} · এন্ট্রি{' '}
                    {formatTaka(cs.enteredAmount)}
                  </div>
                ))}
              </div>
            )}

            {entryBatchSummary.hasBudgetWarning && (
              <div className="p-2.5 rounded-lg bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs font-medium flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-bold">সতর্কতা (Stage 1): উপলব্ধ বাজেট অতিক্রম করেছে</div>
                  {entryBatchSummary.codeStatuses
                    .filter((c) => c.exceeds)
                    .map((c) => (
                      <div key={c.code}>{c.message}</div>
                    ))}
                </div>
              </div>
            )}

            {entryBatchSummary.duplicateWarnings.length > 0 && (
              <div className="p-2.5 rounded-lg bg-[var(--warn-bg)] text-[var(--warn-text)] text-xs font-medium flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-bold">সম্ভাব্য ডুপ্লিকেট সতর্কতা (সংরক্ষণ করা যাবে):</div>
                  {entryBatchSummary.duplicateWarnings.map((w, idx) => (
                    <div key={idx}>{w}</div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Repeater Rows */}
          <div className="space-y-3.5">
            {rows.map((row, idx) => {
              const dateOutOfFy = row.date ? !isDateInFiscalYear(row.date, selectedFy) : false;
              return (
                <div
                  key={row.key}
                  className="p-3.5 rounded-xl border border-[var(--line)] bg-[var(--card)] space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[var(--accent)]">
                      খরচ আইটেম #{idx + 1}
                    </span>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                        className="min-h-[36px] px-2.5 rounded-lg text-xs font-medium text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40 inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>সরান</span>
                      </button>
                    )}
                  </div>

                  <EconomicCodeSelect
                    label="অর্থনৈতিক কোড"
                    value={row.economicCode}
                    onChange={(code, entry: EconomicCodeDoc | null) =>
                      updateRow(idx, {
                        economicCode: code,
                        headName: entry?.headName || '',
                        headNameBn: entry?.headNameBn || '',
                      })
                    }
                    includeSpecial={false}
                    placeholder="৭-অঙ্কের কোড খুঁজুন…"
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                        তারিখ (FY {selectedFy})
                      </label>
                      <input
                        type="date"
                        required
                        value={row.date}
                        onChange={(e) => updateRow(idx, { date: e.target.value })}
                        className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-base md:text-sm tabular-nums"
                      />
                      {dateOutOfFy && (
                        <p className="text-[11px] text-[var(--danger-text)] mt-1">
                          তারিখটি FY {selectedFy} এর বাইরে।
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                        পরিমাণ (৳ · মূল খরচ)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={row.amountStr}
                        onChange={(e) => updateRow(idx, { amountStr: e.target.value })}
                        placeholder="5000"
                        className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-base md:text-sm tabular-nums"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                      খরচের বিবরণ
                    </label>
                    <input
                      type="text"
                      required
                      value={row.description}
                      onChange={(e) => updateRow(idx, { description: e.target.value })}
                      placeholder="যেমন: অফিস স্টেশনারি ক্রয় বা আপ্যায়ন সামগ্রী"
                      className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-base md:text-sm bn"
                    />
                  </div>

                  {/* Responsible Employee Picker */}
                  <div className="p-2.5 rounded-lg bg-[var(--surface-subtle)] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[var(--muted)]">
                        দায়িত্বপ্রাপ্ত কর্মচারী
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateRow(idx, {
                            employeeMode: row.employeeMode === 'user' ? 'manual' : 'user',
                            userId: '',
                          })
                        }
                        className="text-xs font-semibold text-[var(--accent)] hover:underline"
                      >
                        {row.employeeMode === 'user' ? 'হাতে লিখুন' : 'তালিকা থেকে বাছুন'}
                      </button>
                    </div>

                    {row.employeeMode === 'user' && activeUsers.length > 0 ? (
                      <select
                        value={row.userId}
                        onChange={(e) => {
                          const u = activeUsers.find((usr) => usr.id === e.target.value);
                          updateRow(idx, {
                            userId: e.target.value,
                            employeeName: u?.name || '',
                            employeeDesignation: u?.designation || '',
                          });
                        }}
                        className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
                      >
                        <option value="">কর্মচারী নির্বাচন করুন…</option>
                        {activeUsers.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} {u.designation ? `(${u.designation})` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          required
                          value={row.employeeName}
                          onChange={(e) => updateRow(idx, { employeeName: e.target.value })}
                          placeholder="কর্মচারীর নাম"
                          className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn"
                        />
                        <input
                          type="text"
                          value={row.employeeDesignation}
                          onChange={(e) => updateRow(idx, { employeeDesignation: e.target.value })}
                          placeholder="পদবি (যেমন: অফিস সহায়ক)"
                          className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </form>
      </Modal>

      {/* Edit Single Listed Item Modal */}
      <Modal
        open={Boolean(editingItem)}
        onClose={() => setEditingItem(null)}
        title="খরচ আইটেম সম্পাদনা"
        subtitle={editingItem ? `${editingItem.economicCode} · ${formatDateDisplay(editingItem.date)}` : ''}
        maxWidthClass="md:max-w-lg"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingItem(null)}
              className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="edit-expense-form"
              disabled={savingEdit}
              className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
            >
              {savingEdit ? 'সংরক্ষণ হচ্ছে…' : t('saveChanges')}
            </button>
          </div>
        }
      >
        <form id="edit-expense-form" onSubmit={handleSaveEdit} className="space-y-4">
          <EconomicCodeSelect
            label="অর্থনৈতিক কোড"
            value={editCode}
            onChange={(code, entry) => {
              setEditCode(code);
              setEditHeadName(entry?.headName || '');
              setEditHeadNameBn(entry?.headNameBn || '');
            }}
            includeSpecial={false}
          />
          {editCode && (
            <div className="text-xs text-[var(--muted)] bn">
              {getHead(editCode, { headName: editHeadName, headNameBn: editHeadNameBn }).displayName}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--muted)] mb-1">তারিখ</label>
              <input
                type="date"
                required
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--muted)] mb-1">পরিমাণ (৳)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={editAmountStr}
                onChange={(e) => setEditAmountStr(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">বিবরণ</label>
            <input
              type="text"
              required
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn"
            />
          </div>

          <div className="p-3 rounded-lg bg-[var(--surface-subtle)] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--muted)]">দায়িত্বপ্রাপ্ত কর্মচারী</span>
              <button
                type="button"
                onClick={() => setEditEmpMode((m) => (m === 'user' ? 'manual' : 'user'))}
                className="text-xs font-semibold text-[var(--accent)] hover:underline"
              >
                {editEmpMode === 'user' ? 'হাতে লিখুন' : 'তালিকা থেকে বাছুন'}
              </button>
            </div>
            {editEmpMode === 'user' && activeUsers.length > 0 ? (
              <select
                value={editUserId}
                onChange={(e) => {
                  const u = activeUsers.find((usr) => usr.id === e.target.value);
                  setEditUserId(e.target.value);
                  setEditEmpName(u?.name || '');
                  setEditEmpDesig(u?.designation || '');
                }}
                className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
              >
                <option value="">কর্মচারী নির্বাচন করুন…</option>
                {activeUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} {u.designation ? `(${u.designation})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  value={editEmpName}
                  onChange={(e) => setEditEmpName(e.target.value)}
                  placeholder="নাম"
                  className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn"
                />
                <input
                  type="text"
                  value={editEmpDesig}
                  onChange={(e) => setEditEmpDesig(e.target.value)}
                  placeholder="পদবি"
                  className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn"
                />
              </div>
            )}
          </div>
        </form>
      </Modal>

      {/* Bill Preview & Prepare Modal */}
      <Modal
        open={prepareOpen && !submitConfirmOpen}
        onClose={() => setPrepareOpen(false)}
        title="বিল প্রস্তুত ও প্রিভিউ"
        subtitle={
          billPreviewGroups[0]
            ? `কোড ${billPreviewGroups[0].economicCode} · একই কোডের খরচের জন্য ১টি বিল তৈরি হবে`
            : 'একটি অর্থনৈতিক কোডের বিল তৈরি হবে'
        }
        fullScreenOnMobile
        maxWidthClass="md:max-w-3xl"
        footer={
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="text-xs text-[var(--muted)]">
              {!isOnline && 'অফলাইনে শুধু খসড়া সংরক্ষণ করা যাবে।'}
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={() => setPrepareOpen(false)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={
                  Boolean(preparingAction) ||
                  billPreviewGroups.length !== 1 ||
                  billPreviewGroups.some((g) => Boolean(g.rateError))
                }
                onClick={() => handleCreateBills('draft')}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--accent)] text-[var(--accent)] text-sm font-semibold disabled:opacity-60"
              >
                {preparingAction === 'draft' ? 'সংরক্ষণ হচ্ছে…' : t('saveDraft')}
              </button>
              <button
                type="button"
                disabled={
                  Boolean(preparingAction) ||
                  !isOnline ||
                  billPreviewGroups.length !== 1 ||
                  billPreviewGroups.some((g) => Boolean(g.rateError))
                }
                onClick={() => handleCreateBills('submit')}
                className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
              >
                {preparingAction === 'submit' ? 'জমা হচ্ছে…' : 'সংরক্ষণ ও জমা দিন'}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Common Bill Metadata & T.R. 21 Header Fields */}
          <div className="p-3.5 rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)] space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                  বিলের তারিখ (FY {selectedFy})
                </label>
                <input
                  type="date"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                  টোকেন নং (ঐচ্ছিক)
                </label>
                <input
                  type="text"
                  value={tokenNoInput}
                  onChange={(e) => setTokenNoInput(e.target.value)}
                  placeholder="যেমন: ১২৩"
                  className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                  প্রদেয় কোড (ক-খ)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={netPayableCodeInput}
                  onChange={(e) =>
                    setNetPayableCodeInput(e.target.value.replace(/\D+/g, '').slice(0, 10))
                  }
                  placeholder="8172108"
                  className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                যার নামে চেক ইস্যু করা হবে (টি.আর. ২১ ধারা ১২)
              </label>
              <input
                type="text"
                value={payeeTextInput}
                onChange={(e) => setPayeeTextInput(e.target.value)}
                placeholder="সহকারী পরিচালক, জেলা উপানুষ্ঠানিক শিক্ষা ব্যুরো, ময়মনসিংহ"
                className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn"
              />
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowSupplierFields((v) => !v)}
                className="text-xs font-semibold text-[var(--accent)] hover:underline"
              >
                {showSupplierFields
                  ? 'সরবরাহকারীর তথ্য লুকান'
                  : '+ সরবরাহকারীর তথ্য যোগ করুন (ঐচ্ছিক)'}
              </button>
              {showSupplierFields && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-2">
                  <input
                    type="text"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder="সরবরাহকারী / প্রতিষ্ঠানের নাম"
                    className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs bn"
                  />
                  <input
                    type="text"
                    value={supplierAddress}
                    onChange={(e) => setSupplierAddress(e.target.value)}
                    placeholder="ঠিকানা"
                    className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs bn"
                  />
                  <input
                    type="text"
                    value={supplierTinBin}
                    onChange={(e) => setSupplierTinBin(e.target.value)}
                    placeholder="TIN / BIN"
                    className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-xs tabular-nums"
                  />
                </div>
              )}
            </div>

            <div className="text-xs text-[var(--muted)]">
              বিল নম্বর (যেমন {selectedFy}/001) শুধুমাত্র <strong className="text-[var(--text)]">জমা (Submit)</strong> দেওয়ার সময় স্বয়ংক্রিয়ভাবে বরাদ্দ হবে।
            </div>
          </div>

          {billPreviewGroups.map((group, idx) => {
            const exceeds = !group.hasActiveBudget || !group.avail.allowed;
            const updateCodeDeductions = (updater: (list: BillDeductionLine[]) => BillDeductionLine[]) => {
              setDeductionsByCode((prev) => {
                const current = prev[group.economicCode] || group.deductions;
                return { ...prev, [group.economicCode]: updater(current) };
              });
            };
            return (
              <div
                key={group.economicCode}
                className="p-4 rounded-xl border border-[var(--line)] bg-[var(--card)] space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-[var(--accent)] tabular-nums">
                      বিল #{idx + 1} · কোড {group.economicCode}
                    </div>
                    <div className="text-sm font-semibold text-[var(--text)] bn">
                      {group.headNameBn || group.headName}
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <div className="text-[var(--muted)]">উপলব্ধ বাজেট</div>
                    <div
                      className={`font-bold tabular-nums ${
                        exceeds ? 'text-[var(--danger-text)]' : 'text-[var(--accent)]'
                      }`}
                    >
                      {formatTaka(group.avail.available)}
                    </div>
                  </div>
                </div>

                {exceeds && (
                  <div className="p-2.5 rounded-lg bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs font-medium flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      {!group.hasActiveBudget
                        ? `কোড ${group.economicCode} এর জন্য কোনো সক্রিয় বাজেট নেই।`
                        : group.avail.limitingConstraint.exceededMessage}
                    </span>
                  </div>
                )}

                {/* Purpose Text & P1-S3 Live Preview for TR21 */}
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                      ব্যয়ের উদ্দেশ্য / বিবরণ শিরোনাম (টি.আর. ২১ ফরম)
                    </label>
                    <input
                      type="text"
                      value={purposeByCode[group.economicCode] || ''}
                      onChange={(e) =>
                        setPurposeByCode((prev) => ({
                          ...prev,
                          [group.economicCode]: e.target.value,
                        }))
                      }
                      placeholder="যেমন: ময়মনসিংহ জেলা কার্যালয়ের আসবাবপত্র ক্রয় বাবদ বিল।"
                      className="w-full min-h-[42px] px-3 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-base md:text-xs bn"
                    />
                  </div>

                  {(() => {
                    const matchedBudget = resolveBillPrimaryBudget({
                      budgets,
                      fiscalYear: selectedFy,
                      economicCode: group.economicCode,
                    });
                    const previewIntro = buildTr21IntroText({
                      officeName: officeSettings.officeName,
                      fiscalYear: selectedFy,
                      memoNo: matchedBudget?.memoNo || '',
                      memoDate: matchedBudget?.memoDate || '',
                      purposeText:
                        (purposeByCode[group.economicCode] || '').trim() ||
                        `${group.headNameBn || group.headName} বাবদ ব্যয়ের বিল।`,
                    });
                    return (
                      <div className="p-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface-subtle)] text-xs bn leading-relaxed">
                        <div className="text-[11px] font-semibold text-[var(--muted)] mb-1">
                          টি.আর. ২১ (P1-S3) বিবরণ প্রিভিউ:
                        </div>
                        <p className="text-[var(--text)]">{previewIntro}</p>
                        <div className="mt-1.5 space-y-0.5 pl-3 text-[var(--muted)]">
                          {group.items.map((it, i) => (
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

                {/* VAT Variant Selector if multiple (e.g. AC / Non-AC) */}
                {group.vatVariants.length > 1 && (
                  <div>
                    <div className="text-xs font-medium text-[var(--muted)] mb-1.5">
                      ভ্যাটের ধরন নির্বাচন করুন
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.vatVariants.map((v) => {
                        const active = group.selectedVariant.key === v.key;
                        return (
                          <button
                            key={v.key}
                            type="button"
                            onClick={() => {
                              setSelectedVariantByCode((prev) => ({
                                ...prev,
                                [group.economicCode]: v.key,
                              }));
                              updateCodeDeductions((list) =>
                                list.map((d) =>
                                  d.kind === 'vat'
                                    ? {
                                        ...d,
                                        rate: v.rate,
                                      }
                                    : d
                                )
                              );
                            }}
                            className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold transition-colors ${
                              active
                                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                                : 'border border-[var(--line)] text-[var(--text)]'
                            }`}
                          >
                            {v.label} ({v.rate}%)
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Items List */}
                <div className="rounded-lg border border-[var(--line)] divide-y divide-[var(--line)]">
                  {group.items.map((item) => (
                    <div
                      key={item.id}
                      className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium bn text-[var(--text)] truncate">
                          {item.description}
                        </div>
                        <div className="text-[var(--muted)] truncate">
                          {formatDateDisplay(item.date)} · {item.responsibleEmployee.name}
                        </div>
                      </div>
                      <div className="font-semibold tabular-nums shrink-0">
                        {formatTaka(item.amount)}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Editable Deductions Table (IT, VAT, Security Deposit / Custom) */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--text)]">
                      কর্তন ও পরিশোধ (স্বয়ংক্রিয় হিসাব + কাস্টম সারি)
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {!group.deductions.some((d) => d.code === DEFAULT_SECURITY_CODE) && (
                        <button
                          type="button"
                          onClick={() =>
                            updateCodeDeductions((list) => [
                              ...list,
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
                          className="min-h-[32px] px-2.5 rounded-md border border-[var(--line)] text-[11px] font-medium hover:bg-[var(--surface-subtle)]"
                        >
                          + নিরাপত্তা জমা (8113301)
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          updateCodeDeductions((list) => [
                            ...list,
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
                        className="min-h-[32px] px-2.5 rounded-md border border-[var(--accent)] text-[var(--accent)] text-[11px] font-semibold hover:bg-[var(--accent-soft)]"
                      >
                        + নতুন কর্তন
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {group.deductions.map((d, dIdx) => (
                      <div
                        key={d.id}
                        className="p-2.5 rounded-lg bg-[var(--surface-subtle)] border border-[var(--line)] grid grid-cols-12 gap-2 items-center"
                      >
                        <div className="col-span-4 sm:col-span-2">
                          <input
                            type="text"
                            value={d.code}
                            onChange={(e) =>
                              updateCodeDeductions((list) =>
                                list.map((row, idx2) =>
                                  idx2 === dIdx ? { ...row, code: e.target.value } : row
                                )
                              )
                            }
                            placeholder="কোড"
                            aria-label="Deduction code"
                            className="w-full min-h-[38px] px-2 rounded border border-[var(--line)] bg-[var(--card)] text-base md:text-xs tabular-nums"
                          />
                        </div>
                        <div className="col-span-8 sm:col-span-5">
                          <input
                            type="text"
                            value={d.name}
                            onChange={(e) =>
                              updateCodeDeductions((list) =>
                                list.map((row, idx2) =>
                                  idx2 === dIdx ? { ...row, name: e.target.value } : row
                                )
                              )
                            }
                            placeholder="কর্তনের বিবরণ"
                            aria-label="Deduction description"
                            className="w-full min-h-[38px] px-2 rounded border border-[var(--line)] bg-[var(--card)] text-base md:text-xs bn"
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
                              updateCodeDeductions((list) =>
                                list.map((row, idx2) =>
                                  idx2 === dIdx
                                    ? {
                                        ...row,
                                        rate: nextRate,
                                      }
                                    : row
                                )
                              );
                            }}
                            placeholder="হার %"
                            aria-label="Deduction rate percent"
                            className="w-full min-h-[38px] px-2 rounded border border-[var(--line)] bg-[var(--card)] text-base md:text-xs tabular-nums"
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
                              updateCodeDeductions((list) =>
                                list.map((row, idx2) =>
                                  idx2 === dIdx
                                    ? {
                                        ...row,
                                        rate: null,
                                        amount: Number.isFinite(nextPaisa) && nextPaisa >= 0 ? nextPaisa : 0,
                                      }
                                    : row
                                )
                              );
                            }}
                            placeholder="টাকা"
                            aria-label="Deduction amount"
                            className="w-full min-h-[38px] px-2 rounded border border-[var(--line)] bg-[var(--card)] text-base md:text-xs tabular-nums text-right"
                          />
                        </div>
                        <div className="col-span-2 sm:col-span-1 flex justify-end">
                          {group.deductions.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                updateCodeDeductions((list) =>
                                  list.filter((_, idx2) => idx2 !== dIdx)
                                )
                              }
                              aria-label="Remove deduction row"
                              className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {group.rateError && (
                  <div className="p-2.5 rounded-lg bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{group.rateError}</span>
                  </div>
                )}

                {/* VAT/IT Financial Breakdown */}
                <div className="p-3 rounded-lg bg-[var(--surface-subtle)] space-y-2 text-xs">
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                    <div>
                      <div className="text-[var(--muted)]">মূল খরচ</div>
                      <div className="font-semibold tabular-nums">
                        {formatTaka(group.expenseTotal)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--muted)]">মোট বিল (Gross)</div>
                      <div className="font-bold text-[var(--text)] tabular-nums">
                        {formatTaka(group.grossAmount)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--muted)]">ভ্যাট ({group.vatRate}%)</div>
                      <div className="font-semibold tabular-nums">{formatTaka(group.vatAmount)}</div>
                    </div>
                    <div>
                      <div className="text-[var(--muted)]">আয়কর ({group.itRate}%)</div>
                      <div className="font-semibold tabular-nums">{formatTaka(group.itAmount)}</div>
                    </div>
                    <div>
                      <div className="text-[var(--muted)]">মোট কর্তন</div>
                      <div className="font-semibold tabular-nums">
                        {formatTaka(group.totalDeduction)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--muted)]">নিট প্রদেয়</div>
                      <div className="font-bold text-[var(--accent)] tabular-nums">
                        {formatTaka(group.netPayable)}
                      </div>
                    </div>
                  </div>
                  {group.totalPercentRate > 0 && !group.rateError && (
                    <div className="text-[11px] text-[var(--muted)] tabular-nums border-t border-[var(--line)]/60 pt-1.5">
                      হিসাব: ({formatNumberIN(group.expenseTotal)} × 100) / (100 −{' '}
                      {group.totalPercentRate}%) = {formatTaka(group.grossAmount)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

      <SubmitBillModal
        open={submitConfirmOpen && billPreviewGroups.length === 1}
        onClose={() => {
          if (preparingAction !== 'submit') {
            setSubmitConfirmOpen(false);
          }
        }}
        onConfirm={(values) => handleCreateBills('submit', values)}
        submitting={preparingAction === 'submit'}
        isOnline={isOnline}
        fiscalYear={selectedFy}
        economicCode={billPreviewGroups[0]?.economicCode || ''}
        headName={billPreviewGroups[0]?.headName || ''}
        headNameBn={billPreviewGroups[0]?.headNameBn}
        grossAmount={billPreviewGroups[0]?.grossAmount || 0}
        netPayable={billPreviewGroups[0]?.netPayable || 0}
        initialValues={{
          voucherNo: '',
          billDate,
          tokenNo: tokenNoInput,
          purposeText: billPreviewGroups[0]
            ? purposeByCode[billPreviewGroups[0].economicCode] || ''
            : '',
          payeeText: payeeTextInput,
        }}
      />
    </Layout>
  );
}
