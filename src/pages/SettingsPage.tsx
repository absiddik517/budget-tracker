import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  FileSpreadsheet,
  History,
  Loader2,
  RefreshCw,
  Search,
  Square,
  Trash2,
} from 'lucide-react';
import { BottomSheet } from '../components/BottomSheet';
import { Layout } from '../components/Layout';
import { Modal, ModalFooter } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Banner, Field, Section, Select, TextInput, focusFirstInvalidField } from '../components/form';
import { useAuth } from '../contexts/AuthContext';
import { ALL_OFFICES_ID, LEGACY_UNMIGRATED_OFFICE_ID, useApp } from '../contexts/AppContext';
import { useTheme } from '../contexts/ThemeContext';
import { useGlobalAuditLogs } from '../hooks/useAuditLogs';
import { useFyOptions } from '../hooks/useFyOptions';
import { db } from '../lib/firebase';
import {
  buildEconomicCodesFromExistingData,
  clearDbTables,
  DELETABLE_DB_TABLES,
  fetchDbTableCounts,
  previewLegacySpendingsMigration,
  runLegacySpendingsMigration,
  saveOfficeSettings,
  type DeletableDbTableKey,
  type MigrationPreviewReport,
  type MigrationRunResult,
} from '../lib/firestoreOps';
import { isValidFiscalYear } from '../lib/fy';
import {
  previewMultiOfficeMigration,
  runMultiOfficeMigration,
  type MultiOfficeMigrationPreview,
  type MultiOfficeMigrationResult,
} from '../lib/migration';
import { loadSampleData } from '../lib/seedData';
import { saveAndShareFile } from '../utils/saveFile';
import type { LanguageCode, ThemeMode } from '../types';

export function SettingsPage() {
  const { userDoc, isSuperAdmin, needsOfficeSetup, clearOfficeSetupFlag } = useAuth();
  const {
    currentOfficeId,
    currentOfficeRole,
    isAllOfficesMode,
    isLegacyPreMigration,
    offices,
    actorSnapshot,
    officeSettings,
    language,
    setLanguage,
    selectedFy,
    setSelectedFy,
    pushToast,
    t,
  } = useApp();
  const { theme, setTheme } = useTheme();
  const fyOptions = useFyOptions();

  const realOfficeId =
    currentOfficeId &&
    currentOfficeId !== ALL_OFFICES_ID &&
    currentOfficeId !== LEGACY_UNMIGRATED_OFFICE_ID
      ? currentOfficeId
      : '';

  const isOfficeDdo =
    !isSuperAdmin &&
    !isAllOfficesMode &&
    !isLegacyPreMigration &&
    currentOfficeRole === 'ddo' &&
    Boolean(realOfficeId);

  const canEditOfficeConfig = Boolean(
    (isSuperAdmin || isOfficeDdo) &&
      (realOfficeId || (isLegacyPreMigration && isSuperAdmin))
  );

  const effectiveActor =
    actorSnapshot || (userDoc ? { uid: userDoc.id, name: userDoc.name } : null);

  const [officeName, setOfficeName] = useState(officeSettings.officeName);
  const [address, setAddress] = useState(officeSettings.address);
  const [activeFiscalYear, setActiveFiscalYear] = useState(officeSettings.activeFiscalYear);
  const [fiscalYears, setFiscalYears] = useState<string[]>(officeSettings.fiscalYears);
  const [newFyInput, setNewFyInput] = useState('');
  const [newFyError, setNewFyError] = useState('');
  const [addFyModalOpen, setAddFyModalOpen] = useState(false);
  const addFyFormRef = useRef<HTMLFormElement>(null);
  const [fyPickerOpen, setFyPickerOpen] = useState(false);
  const [fySearch, setFySearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [migratingCodes, setMigratingCodes] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sampleToolsOpen, setSampleToolsOpen] = useState(false);
  const [activityModalOpen, setActivityModalOpen] = useState(false);

  // Multi-office migration state (Super Admin only)
  const [multiPreviewLoading, setMultiPreviewLoading] = useState(false);
  const [multiRunning, setMultiRunning] = useState(false);
  const [multiPreview, setMultiPreview] = useState<MultiOfficeMigrationPreview | null>(null);
  const [multiResult, setMultiResult] = useState<MultiOfficeMigrationResult | null>(null);

  // Legacy spendings -> bills + expenseItems migration state
  const [previewLoading, setPreviewLoading] = useState(false);
  const [runningMigration, setRunningMigration] = useState(false);
  const [migrationPreview, setMigrationPreview] = useState<MigrationPreviewReport | null>(null);
  const [migrationResult, setMigrationResult] = useState<MigrationRunResult | null>(null);

  // Table-wise DB cleanup state (Super Admin only)
  const [wipeOfficeFilter, setWipeOfficeFilter] = useState<string>(ALL_OFFICES_ID);
  const [tableCounts, setTableCounts] = useState<Partial<Record<DeletableDbTableKey, number>>>({});
  const [countsLoading, setCountsLoading] = useState(false);
  const [selectedTables, setSelectedTables] = useState<Set<DeletableDbTableKey>>(new Set());
  const [confirmTables, setConfirmTables] = useState<DeletableDbTableKey[] | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [clearingTables, setClearingTables] = useState(false);

  const { logs: globalLogs, loading: logsLoading } = useGlobalAuditLogs(
    isSuperAdmin && activityModalOpen,
    'ALL',
    120
  );

  const loadTableCounts = useCallback(async () => {
    if (!isSuperAdmin) return;
    setCountsLoading(true);
    try {
      const counts = await fetchDbTableCounts(wipeOfficeFilter);
      setTableCounts(counts);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'টেবিলের তথ্য লোড করা যায়নি।');
    } finally {
      setCountsLoading(false);
    }
  }, [isSuperAdmin, wipeOfficeFilter, pushToast]);

  useEffect(() => {
    if (isSuperAdmin) {
      loadTableCounts();
    }
  }, [isSuperAdmin, loadTableCounts]);

  const resetOfficeForm = useCallback(() => {
    setOfficeName(officeSettings.officeName);
    setAddress(officeSettings.address);
    setActiveFiscalYear(officeSettings.activeFiscalYear);
    setFiscalYears(officeSettings.fiscalYears);
  }, [officeSettings]);

  useEffect(() => {
    resetOfficeForm();
  }, [resetOfficeForm]);

  const isDirty = useMemo(() => {
    const savedSortedFys = [...officeSettings.fiscalYears].sort().join(',');
    const currentSortedFys = [...fiscalYears].sort().join(',');
    const nameChanged = isSuperAdmin
      ? officeName.trim() !== (officeSettings.officeName || '').trim()
      : false;
    return (
      nameChanged ||
      address.trim() !== (officeSettings.address || '').trim() ||
      activeFiscalYear !== officeSettings.activeFiscalYear ||
      currentSortedFys !== savedSortedFys
    );
  }, [officeSettings, isSuperAdmin, officeName, address, activeFiscalYear, fiscalYears]);

  const filteredFyOptions = useMemo(() => {
    const q = fySearch.trim().toLowerCase();
    if (!q) return fyOptions;
    return fyOptions.filter((fy) => `fy ${fy}`.toLowerCase().includes(q));
  }, [fyOptions, fySearch]);

  const handleAddFiscalYear = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = newFyInput.trim();
    if (!isValidFiscalYear(trimmed)) {
      setNewFyError('Enter a valid fiscal year format like 2026-27.');
      pushToast('error', 'Enter a valid fiscal year format like 2026-27.');
      requestAnimationFrame(() => focusFirstInvalidField(addFyFormRef.current));
      return;
    }
    setNewFyError('');
    if (!fiscalYears.includes(trimmed)) {
      setFiscalYears((prev) => [...prev, trimmed].sort());
    }
    setActiveFiscalYear(trimmed);
    setNewFyInput('');
    setAddFyModalOpen(false);
  };

  const handleSave = async () => {
    if (!effectiveActor || !canEditOfficeConfig) return;
    if (isSuperAdmin && !officeName.trim()) {
      pushToast('error', 'Office name is required.');
      return;
    }
    setSaving(true);
    try {
      const mergedFys = Array.from(new Set([...fiscalYears, activeFiscalYear])).sort();
      const targetOfficeId = isLegacyPreMigration ? undefined : realOfficeId || undefined;
      await saveOfficeSettings(
        isSuperAdmin
          ? {
              officeName: officeName.trim(),
              address: address.trim(),
              activeFiscalYear,
              fiscalYears: mergedFys,
              language,
            }
          : {
              // DDO rules strictly disallow modifying office name/code
              address: address.trim(),
              activeFiscalYear,
              fiscalYears: mergedFys,
              language,
            },
        effectiveActor,
        targetOfficeId
      );
      setSelectedFy(activeFiscalYear);
      clearOfficeSetupFlag();
      pushToast('success', 'Settings saved.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadSampleData = async () => {
    if (!effectiveActor || !isSuperAdmin) return;
    if (!realOfficeId && !isLegacyPreMigration) {
      pushToast('error', 'স্যাম্পল ডেটা লোড করতে হেডার থেকে একটি নির্দিষ্ট অফিস নির্বাচন করুন।');
      return;
    }
    setSeeding(true);
    try {
      await loadSampleData(effectiveActor, realOfficeId || undefined);
      setSelectedFy('2025-26');
      pushToast('success', 'Sample data loaded for FY 2025-26.');
      loadTableCounts();
      setSampleToolsOpen(false);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to load sample data.');
    } finally {
      setSeeding(false);
    }
  };

  const handleBuildEconomicCodes = async () => {
    if (!effectiveActor || !isSuperAdmin) return;
    setMigratingCodes(true);
    try {
      const res = await buildEconomicCodesFromExistingData(effectiveActor);
      pushToast(
        'success',
        `Economic codes synced: ${res.created} created, ${res.skipped} already existed.`
      );
      setSampleToolsOpen(false);
    } catch (err) {
      pushToast(
        'error',
        err instanceof Error ? err.message : 'Failed to build economic codes.'
      );
    } finally {
      setMigratingCodes(false);
    }
  };

  const handlePreviewMultiOfficeMigration = async () => {
    if (!isSuperAdmin) return;
    setMultiPreviewLoading(true);
    setMultiResult(null);
    try {
      const report = await previewMultiOfficeMigration();
      setMultiPreview(report);
    } catch (err) {
      pushToast(
        'error',
        err instanceof Error ? err.message : 'Failed to scan multi-office migration.'
      );
    } finally {
      setMultiPreviewLoading(false);
    }
  };

  const handleRunMultiOfficeMigration = async () => {
    if (!effectiveActor || !isSuperAdmin) return;
    setMultiRunning(true);
    try {
      const res = await runMultiOfficeMigration(effectiveActor);
      setMultiResult(res);
      const updated = await previewMultiOfficeMigration();
      setMultiPreview(updated);
      await loadTableCounts();
      pushToast(
        'success',
        `মাল্টি-অফিস মাইগ্রেশন সম্পন্ন: ${res.usersMigrated} জন ব্যবহারকারী ও ${res.budgetsUpdated + res.billsUpdated}টি রেকর্ড আপডেট হয়েছে।`
      );
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Multi-office migration failed.');
    } finally {
      setMultiRunning(false);
    }
  };

  const handlePreviewMigration = async () => {
    if (!isSuperAdmin) return;
    setPreviewLoading(true);
    setMigrationResult(null);
    try {
      const report = await previewLegacySpendingsMigration();
      setMigrationPreview(report);
    } catch (err) {
      pushToast(
        'error',
        err instanceof Error ? err.message : 'Failed to preview legacy spendings.'
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRunMigration = async () => {
    if (!effectiveActor || !isSuperAdmin) return;
    setRunningMigration(true);
    try {
      const res = await runLegacySpendingsMigration(
        effectiveActor,
        realOfficeId || undefined
      );
      setMigrationResult(res);
      const updatedPreview = await previewLegacySpendingsMigration();
      setMigrationPreview(updatedPreview);
      pushToast(
        'success',
        `মাইগ্রেশন সম্পন্ন: ${res.migratedBills}টি বিল, ${res.migratedItems}টি খরচ আইটেম তৈরি হয়েছে।`
      );
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Migration failed.');
    } finally {
      setRunningMigration(false);
    }
  };

  const handleExportBackup = async () => {
    if (!isSuperAdmin && !realOfficeId) {
      pushToast('error', 'ব্যাকআপ নিতে একটি নির্দিষ্ট অফিস নির্বাচন করুন।');
      return;
    }
    setExporting(true);
    try {
      const scopedOffice = !isAllOfficesMode && realOfficeId ? realOfficeId : null;
      const [
        budgetsSnap,
        itemsSnap,
        billsSnap,
        countersSnap,
        ratesSnap,
        limitsSnap,
        totalsSnap,
        codesSnap,
      ] = await Promise.all([
        getDocs(
          scopedOffice
            ? query(
                collection(db, 'budgets'),
                where('officeId', '==', scopedOffice),
                where('deleted', '==', false)
              )
            : query(collection(db, 'budgets'), where('deleted', '==', false))
        ),
        getDocs(
          scopedOffice
            ? query(
                collection(db, 'expenseItems'),
                where('officeId', '==', scopedOffice),
                where('deleted', '==', false)
              )
            : query(collection(db, 'expenseItems'), where('deleted', '==', false))
        ),
        getDocs(
          scopedOffice
            ? query(
                collection(db, 'bills'),
                where('officeId', '==', scopedOffice),
                where('deleted', '==', false)
              )
            : query(collection(db, 'bills'), where('deleted', '==', false))
        ),
        getDocs(
          scopedOffice
            ? query(collection(db, 'counters'), where('officeId', '==', scopedOffice))
            : collection(db, 'counters')
        ),
        getDocs(collection(db, 'vatTaxRates')),
        getDocs(
          scopedOffice
            ? query(collection(db, 'spendingLimits'), where('officeId', '==', scopedOffice))
            : collection(db, 'spendingLimits')
        ),
        getDocs(
          scopedOffice
            ? query(collection(db, 'fyCodeTotals'), where('officeId', '==', scopedOffice))
            : collection(db, 'fyCodeTotals')
        ),
        getDocs(collection(db, 'economicCodes')),
      ]);
      const backup = {
        exportedAt: new Date().toISOString(),
        officeScope: scopedOffice || 'ALL',
        officeSettings,
        economicCodes: codesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        budgets: budgetsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        expenseItems: itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        bills: billsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        counters: countersSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        vatTaxRates: ratesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        spendingLimits: limitsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        fyCodeTotals: totalsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      };
      const jsonText = JSON.stringify(backup, null, 2);
      const outcome = await saveAndShareFile({
        data: jsonText,
        fileName: `budget-tracker-backup-${scopedOffice || 'all'}-${new Date()
          .toISOString()
          .slice(0, 10)}.json`,
        mimeType: 'application/json',
        title: 'Budget Tracker Backup',
      });
      if (outcome.status === 'shared') {
        pushToast('success', 'JSON backup ready — choose an app to save or share.');
      } else if (outcome.status === 'downloaded') {
        pushToast('success', 'JSON backup exported.');
      } else {
        pushToast('info', 'Backup export cancelled.');
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  const handleLanguageChange = (lang: LanguageCode) => {
    setLanguage(lang);
  };

  const toggleTableSelection = (key: DeletableDbTableKey) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectTablesByCategory = (mode: 'transactional' | 'all' | 'none') => {
    if (mode === 'none') {
      setSelectedTables(new Set());
      return;
    }
    const next = new Set<DeletableDbTableKey>();
    for (const tbl of DELETABLE_DB_TABLES) {
      if (mode === 'transactional' && tbl.category !== 'transactional') continue;
      if ((tableCounts[tbl.key] ?? 0) > 0) {
        next.add(tbl.key);
      }
    }
    setSelectedTables(next);
  };

  const openClearConfirmModal = (tables: DeletableDbTableKey[]) => {
    if (tables.length === 0) return;
    setConfirmTables(tables);
    setConfirmText('');
  };

  const confirmPhraseValid = (() => {
    const v = confirmText.trim();
    return v.toUpperCase() === 'DELETE' || v === 'মুছুন';
  })();

  const handleConfirmClearTables = async () => {
    if (!effectiveActor || !isSuperAdmin || !confirmTables || confirmTables.length === 0) return;
    if (!confirmPhraseValid) return;

    setClearingTables(true);
    try {
      const results = await clearDbTables(
        confirmTables,
        effectiveActor,
        wipeOfficeFilter
      );
      const totalDeleted = results.reduce((sum, r) => sum + r.deletedCount, 0);
      setSelectedTables((prev) => {
        const next = new Set(prev);
        for (const k of confirmTables) next.delete(k);
        return next;
      });
      setConfirmTables(null);
      setConfirmText('');
      await loadTableCounts();
      pushToast(
        'success',
        `${results.length}টি টেবিল থেকে মোট ${totalDeleted}টি রেকর্ড স্থায়ীভাবে মুছে ফেলা হয়েছে।`
      );
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'টেবিলের ডেটা মুছা যায়নি।');
    } finally {
      setClearingTables(false);
    }
  };

  const jumpToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const jumpChips = [
    { id: 's-fy', label: t('fiscalYear'), visible: true },
    { id: 's-off', label: t('office'), visible: canEditOfficeConfig },
    { id: 's-app', label: t('appearance'), visible: true },
    { id: 's-dat', label: t('data'), visible: isSuperAdmin || isOfficeDdo },
    { id: 's-adv', label: 'Advanced', visible: isSuperAdmin },
  ].filter((c) => c.visible);

  return (
    <Layout
      title={t('navSettings')}
      saveBar={{
        visible: canEditOfficeConfig && isDirty,
        saving,
        onSave: handleSave,
        onDiscard: resetOfficeForm,
      }}
    >
      <div className="max-w-[720px] mx-auto">
        <PageHeader title={t('navSettings')} />

        <div className="space-y-3.5">
          {/* Quick-jump section chips */}
          <div
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5"
            aria-label="Settings sections"
          >
            {jumpChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => jumpToSection(chip.id)}
                className="min-h-[40px] px-4 rounded-full border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)] whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {chip.label}
              </button>
            ))}
          </div>

          {needsOfficeSetup && isSuperAdmin && (
            <div className="px-4 py-3 rounded-[14px] bg-[var(--accent-soft)] text-[var(--accent)] text-sm font-medium">
              Welcome! You are the first administrator. Please fill in your office name and fiscal
              year below and save, or create offices in the Offices page.
            </div>
          )}

          {isSuperAdmin && isAllOfficesMode && (
            <div className="px-4 py-3 rounded-[14px] bg-[var(--surface-subtle)] border border-[var(--line)] text-xs text-[var(--muted)]">
              একটি নির্দিষ্ট দপ্তরের ঠিকানা, অর্থবছর ও টি.আর. ফরম-২১ সেটআপ সম্পাদনা করতে হেডার অফিস সুইচার থেকে সেই দপ্তরটি নির্বাচন করুন অথবা{' '}
              <Link to="/offices" className="text-[var(--accent)] font-semibold hover:underline">
                দপ্তরসমূহ
              </Link>{' '}
              পেইজে যান।
            </div>
          )}

          {/* 1. Viewing Fiscal Year (all roles) */}
          <section id="s-fy" className="card-surface p-4 md:p-5 scroll-mt-4">
            <h2 className="text-base font-semibold text-[var(--text)]">
              {t('viewingFiscalYear')}
            </h2>
            <p className="text-xs text-[var(--muted)] mt-0.5 mb-3.5">
              {t('viewingFiscalYearHelp')}
            </p>
            <button
              type="button"
              onClick={() => {
                setFySearch('');
                setFyPickerOpen(true);
              }}
              aria-haspopup="dialog"
              className="w-full min-h-[64px] px-4 py-2 rounded-xl border border-[var(--line)] bg-[var(--card)] hover:border-[var(--accent)] flex items-center justify-between gap-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <span className="min-w-0">
                <span className="block text-[11px] font-medium text-[var(--muted)]">
                  {t('currentBadge')}
                </span>
                <span className="block text-[17px] font-bold tabular-nums text-[var(--text)]">
                  FY {selectedFy}
                </span>
              </span>
              <ChevronDown className="w-5 h-5 text-[var(--muted)] shrink-0" />
            </button>
          </section>

          {/* 2. Office (Super Admin & Office DDO) */}
          {canEditOfficeConfig && (
            <section id="s-off" className="card-surface p-4 md:p-5 space-y-3.5 scroll-mt-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--text)]">{t('office')}</h2>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  Shown on forms and reports.
                </p>
              </div>

              <div>
                <label
                  htmlFor="office-name"
                  className="block text-xs font-semibold text-[var(--muted)] mb-1.5"
                >
                  {t('officeName')}
                </label>
                <input
                  id="office-name"
                  type="text"
                  disabled={!isSuperAdmin}
                  value={officeName}
                  onChange={(e) => setOfficeName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-[10px] border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn text-[var(--text)] disabled:opacity-65 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                {!isSuperAdmin && (
                  <p className="text-[11px] text-[var(--muted)] mt-1 bn">
                    দপ্তরের নাম ও কোড শুধুমাত্র সুপার অ্যাডমিন পরিবর্তন করতে পারবেন।
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="office-address"
                  className="block text-xs font-semibold text-[var(--muted)] mb-1.5"
                >
                  {t('address')}
                </label>
                <input
                  id="office-address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-[10px] border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <div>
                  <label
                    htmlFor="active-fy"
                    className="block text-xs font-semibold text-[var(--muted)] mb-1.5"
                  >
                    {t('activeFiscalYearOfficeDefault')}
                  </label>
                  <Select
                    id="active-fy"
                    modalTitle={t('activeFiscalYearOfficeDefault')}
                    value={activeFiscalYear}
                    onChange={(e) => setActiveFiscalYear(e.target.value)}
                    clearable={false}
                    options={Array.from(new Set([...fiscalYears, activeFiscalYear]))
                      .sort()
                      .reverse()
                      .map((fy) => ({
                        value: fy,
                        label: `অর্থবছর ${fy}`,
                        metaRight: fy === activeFiscalYear ? 'সক্রিয়' : undefined,
                        keywords: fy,
                      }))}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setNewFyInput('');
                    setAddFyModalOpen(true);
                  }}
                  className="min-h-[44px] px-4 rounded-[10px] border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-sm font-semibold text-[var(--text)] transition-colors whitespace-nowrap"
                >
                  Add fiscal year
                </button>
              </div>

              <div className="pt-3 border-t border-[var(--line)] flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[var(--text)]">
                    টি.আর. ফরম নং-২১ কনফিগারেশন
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    প্রাতিষ্ঠানিক কোড, প্রাপক, হিসাব কোড ও প্রত্যয়ন ধারা সেটআপ করুন।
                  </div>
                </div>
                <Link
                  to="/tr21-setup"
                  className="min-h-[40px] px-3.5 rounded-[10px] border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-soft)] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                  <span>টি.আর. ফরম ২১ সেটআপ</span>
                  <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                </Link>
              </div>
            </section>
          )}

          {/* 3. Appearance (all roles) */}
          <section id="s-app" className="card-surface p-4 md:p-5 space-y-4 scroll-mt-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--text)]">{t('appearance')}</h2>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Theme and language for this device.
              </p>
            </div>

            <div>
              <div className="text-xs font-semibold text-[var(--muted)] mb-2">{t('theme')}</div>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)]">
                {(['system', 'light', 'dark'] as ThemeMode[]).map((mode) => {
                  const active = theme === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setTheme(mode)}
                      className={`min-h-[40px] rounded-[9px] text-sm font-semibold transition-colors ${
                        active
                          ? 'bg-[var(--card)] text-[var(--text)] shadow-sm'
                          : 'text-[var(--muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      {t(mode)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-[var(--muted)] mb-2">{t('language')}</div>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)]">
                <button
                  type="button"
                  aria-pressed={language === 'en'}
                  onClick={() => handleLanguageChange('en')}
                  className={`min-h-[40px] rounded-[9px] text-sm font-semibold transition-colors ${
                    language === 'en'
                      ? 'bg-[var(--card)] text-[var(--text)] shadow-sm'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  English
                </button>
                <button
                  type="button"
                  aria-pressed={language === 'bn'}
                  onClick={() => handleLanguageChange('bn')}
                  className={`min-h-[40px] rounded-[9px] text-sm font-semibold transition-colors ${
                    language === 'bn'
                      ? 'bg-[var(--card)] text-[var(--text)] shadow-sm'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  বাংলা
                </button>
              </div>
            </div>
          </section>

          {/* 4. Data Navigation List Card */}
          {(isSuperAdmin || isOfficeDdo) && (
            <section
              id="s-dat"
              className="card-surface px-4 py-1.5 divide-y divide-[var(--line)] scroll-mt-4"
            >
              <button
                type="button"
                disabled={exporting}
                onClick={handleExportBackup}
                className="w-full min-h-[60px] py-2 flex items-center gap-3.5 text-left hover:opacity-85 disabled:opacity-60 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-lg"
              >
                <Download className="w-5 h-5 text-[var(--muted)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--text)]">
                    {exporting ? 'Exporting JSON backup…' : 'Download JSON backup'}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    Budgets, expense items and bills
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-[var(--muted)] shrink-0" />
              </button>

              {isSuperAdmin && (
                <>
                  <button
                    type="button"
                    onClick={() => setSampleToolsOpen(true)}
                    className="w-full min-h-[60px] py-2 flex items-center gap-3.5 text-left hover:opacity-85 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-lg"
                  >
                    <Database className="w-5 h-5 text-[var(--muted)] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--text)]">
                        Sample data &amp; global codes
                      </div>
                      <div className="text-xs text-[var(--muted)]">Super Admin only</div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-[var(--muted)] shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setActivityModalOpen(true)}
                    className="w-full min-h-[60px] py-2 flex items-center gap-3.5 text-left hover:opacity-85 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-lg"
                  >
                    <History className="w-5 h-5 text-[var(--muted)] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--text)]">
                        {t('globalActivity')}
                      </div>
                      <div className="text-xs text-[var(--muted)]">
                        Audit trail across all records
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-[var(--muted)] shrink-0" />
                  </button>
                </>
              )}
            </section>
          )}

          {/* 5. Advanced (Super Admin only) */}
          {isSuperAdmin && (
            <section id="s-adv" className="card-surface p-4 md:p-5 scroll-mt-4">
              <h2 className="text-base font-semibold text-[var(--text)]">Advanced</h2>
              <p className="text-xs text-[var(--muted)] mt-0.5 mb-3">
                Super Admin tools. Back up before running anything here.
              </p>

              <div className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
                {/* Multi-office migration */}
                <details className="group py-1">
                  <summary className="min-h-[50px] flex items-center justify-between gap-2 cursor-pointer text-sm font-semibold text-[var(--text)] list-none">
                    <span>Multi-office migration</span>
                    <ChevronDown className="w-4 h-4 text-[var(--muted)] transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="pb-4 space-y-3">
                    <p className="text-xs text-[var(--muted)] leading-relaxed">
                      পুরনো এক-অফিস ডেটা (<code className="font-mono">settings/office</code>,{' '}
                      <code className="font-mono">users.role</code>,{' '}
                      <code className="font-mono">budgets</code>,{' '}
                      <code className="font-mono">bills</code>,{' '}
                      <code className="font-mono">fyCodeTotals</code>,{' '}
                      <code className="font-mono">counters</code>) নিরাপদ ও Idempotent ভাবে{' '}
                      <code className="font-mono">offices</code>,{' '}
                      <code className="font-mono">workHistory</code>,{' '}
                      <code className="font-mono">access</code> ও{' '}
                      <code className="font-mono">officeId</code>-এ রূপান্তর করে।
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handlePreviewMultiOfficeMigration}
                        disabled={multiPreviewLoading || multiRunning}
                        className="min-h-[44px] px-4 rounded-[10px] border border-[var(--line)] text-sm font-medium hover:bg-[var(--surface-subtle)] inline-flex items-center gap-2 disabled:opacity-60"
                      >
                        <RefreshCw
                          className={`w-4 h-4 ${multiPreviewLoading ? 'animate-spin' : ''}`}
                        />
                        <span>{multiPreviewLoading ? 'স্ক্যান হচ্ছে…' : 'Dry-Run প্রিভিউ'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleRunMultiOfficeMigration}
                        disabled={multiRunning || multiPreviewLoading}
                        className="min-h-[44px] px-4 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
                      >
                        {multiRunning ? 'মাইগ্রেশন চলছে…' : 'Migrate to multi-office'}
                      </button>
                    </div>

                    {multiPreview && (
                      <div className="p-3.5 rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)] text-xs space-y-2">
                        <div className="font-semibold text-[var(--text)]">
                          Dry-Run ফলাফল: বিদ্যমান অফিস {multiPreview.alreadyHasOffices}টি ·{' '}
                          {multiPreview.willCreateDefaultOffice
                            ? `নতুন ডিফল্ট অফিস "${multiPreview.defaultOfficeName}" তৈরি হবে`
                            : 'প্রথম অফিসকে ডিফল্ট হিসেবে ব্যবহার করা হবে'}
                        </div>
                        <div className="flex flex-wrap gap-3 text-[var(--muted)] tabular-nums">
                          <span>Users: {multiPreview.usersNeedingMigration}</span>
                          <span>Work History: {multiPreview.workHistoryToCreate}</span>
                          <span>Budgets: {multiPreview.budgetsToTag}</span>
                          <span>Expense Items: {multiPreview.expenseItemsToTag}</span>
                          <span>Bills: {multiPreview.billsToTag}</span>
                          <span>Limits: {multiPreview.limitsToTag}</span>
                          <span>Spendings: {multiPreview.spendingsToTag}</span>
                          <span>FY Totals re-key: {multiPreview.fyTotalsToRekey}</span>
                          <span>Counters re-key: {multiPreview.countersToRekey}</span>
                          <span>Actor snapshots: {multiPreview.docsWithStringActorSnapshots}</span>
                        </div>
                      </div>
                    )}

                    {multiResult && (
                      <div className="p-3 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] text-xs font-medium tabular-nums">
                        মাইগ্রেশন সম্পন্ন: অফিস {multiResult.officeId} · Users:{' '}
                        {multiResult.usersMigrated} · WorkHistory: {multiResult.workHistoryCreated} ·
                        Budgets: {multiResult.budgetsUpdated} · Items:{' '}
                        {multiResult.expenseItemsUpdated} · Bills: {multiResult.billsUpdated} · FY
                        Totals: {multiResult.fyTotalsRekeyed} · Counters:{' '}
                        {multiResult.countersRekeyed}
                      </div>
                    )}
                  </div>
                </details>

                {/* Legacy spendings migration */}
                <details className="group py-1">
                  <summary className="min-h-[50px] flex items-center justify-between gap-2 cursor-pointer text-sm font-semibold text-[var(--text)] list-none">
                    <span>Legacy data migration (Spendings → Bills)</span>
                    <ChevronDown className="w-4 h-4 text-[var(--muted)] transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="pb-4 space-y-3">
                    <p className="text-xs text-[var(--muted)] leading-relaxed">
                      পুরনো <code className="font-mono">spendings</code> কালেকশনের ডেটা নিরাপদ ও
                      Idempotent ভাবে <code className="font-mono">bills</code> ও{' '}
                      <code className="font-mono">expenseItems</code>-এ রূপান্তর করে (ইতোমধ্যে
                      অনুমোদিত বাজেট পুনরায় কাটা হয় না)।
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handlePreviewMigration}
                        disabled={previewLoading || runningMigration}
                        className="min-h-[44px] px-4 rounded-[10px] border border-[var(--line)] text-sm font-medium hover:bg-[var(--surface-subtle)] inline-flex items-center gap-2 disabled:opacity-60"
                      >
                        <RefreshCw className={`w-4 h-4 ${previewLoading ? 'animate-spin' : ''}`} />
                        <span>{previewLoading ? 'স্ক্যান হচ্ছে…' : 'Dry-Run প্রিভিউ'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleRunMigration}
                        disabled={runningMigration || previewLoading}
                        className="min-h-[44px] px-4 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
                      >
                        {runningMigration ? 'মাইগ্রেশন চলছে…' : 'মাইগ্রেশন চালান'}
                      </button>
                    </div>

                    {migrationPreview && (
                      <div className="p-3.5 rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)] text-xs space-y-2">
                        <div className="font-semibold text-[var(--text)]">
                          Dry-Run ফলাফল: মোট পুরনো এন্ট্রি {migrationPreview.totalLegacySpendings}টি
                          · ইতোমধ্যে মাইগ্রেটেড {migrationPreview.alreadyMigratedCount}টি · বাকি{' '}
                          {migrationPreview.toMigrateCount}টি
                        </div>
                        <div className="flex flex-wrap gap-3 text-[var(--muted)] tabular-nums">
                          <span>Approved: {migrationPreview.byStatus.approved}</span>
                          <span>Submitted: {migrationPreview.byStatus.submitted}</span>
                          <span>Draft: {migrationPreview.byStatus.draft}</span>
                          <span>Rejected: {migrationPreview.byStatus.rejected}</span>
                          <span>
                            Voided→Cancelled: {migrationPreview.byStatus.cancelledFromVoided}
                          </span>
                          <span>Budgets sync needed: {migrationPreview.budgetsNeedingSync}</span>
                          <span>
                            FY Totals sync needed: {migrationPreview.fyTotalsNeedingSync}
                          </span>
                        </div>
                      </div>
                    )}

                    {migrationResult && (
                      <div className="p-3 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] text-xs font-medium tabular-nums">
                        সম্পন্ন: {migrationResult.migratedBills}টি বিল,{' '}
                        {migrationResult.migratedItems}টি খরচ আইটেম তৈরি হয়েছে ·{' '}
                        {migrationResult.skippedExisting}টি আগে থেকেই ছিল ·{' '}
                        {migrationResult.syncedBudgets}টি বাজেট ও{' '}
                        {migrationResult.syncedFyTotals}টি কোড টোটাল সিঙ্ক হয়েছে।
                      </div>
                    )}
                  </div>
                </details>

                {/* Danger zone */}
                <details className="group py-1">
                  <summary className="min-h-[50px] flex items-center justify-between gap-2 cursor-pointer text-sm font-semibold text-[var(--danger-text)] list-none">
                    <span className="inline-flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>Danger zone</span>
                    </span>
                    <ChevronDown className="w-4 h-4 text-[var(--danger-text)] transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="pb-3 space-y-3">
                    <p className="text-xs text-[var(--muted)] leading-relaxed">
                      নির্দিষ্ট দপ্তর বা সকল দপ্তরের টেবিলের রেকর্ড স্থায়ীভাবে মুছে ফেলুন। ব্যবহারকারী
                      (users), কর্ম-ইতিহাস (workHistory), দপ্তর (offices) ও অডিট লগ (auditLogs)
                      সুরক্ষিত থাকবে।
                    </p>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-[220px] flex-1 sm:flex-initial">
                        <Select
                          variant="compact"
                          modalTitle="দপ্তর নির্বাচন করুন"
                          value={wipeOfficeFilter}
                          onChange={(e) => {
                            setWipeOfficeFilter(e.target.value);
                            setSelectedTables(new Set());
                          }}
                          aria-label="Filter wipe by office"
                          options={[
                            { value: ALL_OFFICES_ID, label: 'সকল দপ্তর + গ্লোবাল' },
                            ...offices.map((o) => ({
                              value: o.id,
                              label: o.nameBn || o.name,
                              subtitle: `কোড: ${o.code}`,
                              keywords: `${o.name} ${o.nameBn} ${o.code}`,
                            })),
                          ]}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={loadTableCounts}
                        disabled={countsLoading || clearingTables}
                        className="min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-60"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${countsLoading ? 'animate-spin' : ''}`}
                        />
                        <span>রিফ্রেশ</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => selectTablesByCategory('transactional')}
                        disabled={countsLoading || clearingTables}
                        className="min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-medium disabled:opacity-60"
                      >
                        লেনদেন টেবিল বাছুন
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          selectTablesByCategory(selectedTables.size > 0 ? 'none' : 'all')
                        }
                        disabled={countsLoading || clearingTables}
                        className="min-h-[40px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-xs font-medium disabled:opacity-60"
                      >
                        {selectedTables.size > 0 ? 'বাছাই বাতিল' : 'সব বাছুন'}
                      </button>
                      {selectedTables.size > 0 && (
                        <button
                          type="button"
                          onClick={() => openClearConfirmModal(Array.from(selectedTables))}
                          disabled={clearingTables}
                          className="min-h-[40px] px-3.5 rounded-lg bg-[var(--danger-text)] text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90 disabled:opacity-60"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>নির্বাচিত ({selectedTables.size}) মুছুন</span>
                        </button>
                      )}
                    </div>

                    <div className="rounded-xl border border-[var(--line)] overflow-hidden divide-y divide-[var(--line)]">
                      {DELETABLE_DB_TABLES.map((tbl) => {
                        const count = tableCounts[tbl.key];
                        const checked = selectedTables.has(tbl.key);
                        const isEmpty = count === 0;
                        return (
                          <div
                            key={tbl.key}
                            className={`p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-colors ${
                              checked
                                ? 'bg-[var(--danger-bg)]/30'
                                : 'bg-[var(--card)] hover:bg-[var(--surface-subtle)]/60'
                            }`}
                          >
                            <div className="flex items-start gap-2.5 min-w-0 flex-1">
                              <button
                                type="button"
                                onClick={() => toggleTableSelection(tbl.key)}
                                aria-label={`Select ${tbl.labelBn}`}
                                className="mt-0.5 min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded-md text-[var(--muted)] hover:text-[var(--text)] shrink-0"
                              >
                                {checked ? (
                                  <CheckSquare className="w-4 h-4 text-[var(--danger-text)]" />
                                ) : (
                                  <Square className="w-4 h-4" />
                                )}
                              </button>

                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold text-[var(--text)] bn">
                                    {tbl.labelBn}
                                  </span>
                                  <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface-subtle)] text-[var(--muted)]">
                                    {tbl.key}
                                  </code>
                                  {wipeOfficeFilter !== ALL_OFFICES_ID && tbl.officeScoped && (
                                    <span className="text-[11px] text-[var(--accent)]">
                                      · Filtered
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-[var(--muted)] mt-0.5 bn">
                                  {tbl.descriptionBn}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-2.5 pl-9 sm:pl-0 shrink-0">
                              <span
                                className={`text-xs font-semibold tabular-nums px-2.5 py-1 rounded-full border ${
                                  isEmpty
                                    ? 'border-[var(--line)] text-[var(--muted)] bg-[var(--surface-subtle)]'
                                    : 'border-[var(--line)] text-[var(--text)] bg-[var(--card)]'
                                }`}
                              >
                                {countsLoading && count === undefined
                                  ? '…'
                                  : count === undefined
                                  ? '—'
                                  : count === 0
                                  ? 'ফাঁকা (০)'
                                  : `${count}টি রেকর্ড`}
                              </span>

                              <button
                                type="button"
                                disabled={clearingTables || isEmpty || countsLoading}
                                onClick={() => openClearConfirmModal([tbl.key])}
                                className="min-h-[38px] px-3 rounded-lg border border-[var(--danger-text)]/40 text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/50 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>সব মুছুন</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </details>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Viewing Fiscal Year Picker BottomSheet */}
      <BottomSheet
        open={fyPickerOpen}
        onClose={() => setFyPickerOpen(false)}
        title={t('fiscalYear')}
        subtitle="Choose the year to view"
        desktopMode="center"
        closeLabel={t('closeLabel')}
      >
        <div className="p-3 space-y-2.5">
          {fyOptions.length > 5 && (
            <div className="relative">
              <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={fySearch}
                onChange={(e) => setFySearch(e.target.value)}
                placeholder="Search fiscal year…"
                aria-label="Search fiscal year"
                className="w-full min-h-[44px] pl-9 pr-3 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-base md:text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
          )}

          <div role="radiogroup" aria-label={t('viewingFiscalYear')} className="space-y-1.5">
            {filteredFyOptions.length === 0 ? (
              <p className="text-sm text-[var(--muted)] text-center py-5">{t('noDataFound')}</p>
            ) : (
              filteredFyOptions.map((fy) => {
                const selected = selectedFy === fy;
                const isDefault = fy === officeSettings.activeFiscalYear;
                return (
                  <button
                    key={fy}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setSelectedFy(fy);
                      setFyPickerOpen(false);
                      pushToast('success', `${t('switchedToFy')} ${fy}`);
                    }}
                    className={`w-full min-h-[52px] px-4 rounded-xl border flex items-center justify-between gap-3 text-left transition-colors ${
                      selected
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                        : 'border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-[var(--text)] font-medium'
                    }`}
                  >
                    <span className="tabular-nums text-sm">FY {fy}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      {isDefault && (
                        <span className="text-xs text-[var(--muted)]">{t('currentBadge')}</span>
                      )}
                      {selected && <Check className="w-4 h-4 shrink-0" />}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </BottomSheet>

      {/* Add Fiscal Year Modal */}
      <Modal
        open={addFyModalOpen}
        onClose={() => {
          setAddFyModalOpen(false);
          setNewFyError('');
        }}
        title="Add fiscal year"
        subtitle="Format: YYYY-YY (runs July to June)"
        size="sm"
        confirmClose={Boolean(newFyInput.trim())}
        footer={
          <ModalFooter
            secondary={{
              label: t('cancel'),
              onClick: () => {
                setAddFyModalOpen(false);
                setNewFyError('');
              },
            }}
            primary={{
              label: 'Add FY',
              type: 'submit',
              form: 'add-fy-form',
            }}
          />
        }
      >
        <form
          ref={addFyFormRef}
          id="add-fy-form"
          onSubmit={handleAddFiscalYear}
          noValidate
          className="space-y-4"
        >
          <Field label="Fiscal year" required error={newFyError}>
            <TextInput
              type="text"
              value={newFyInput}
              onChange={(e) => {
                setNewFyInput(e.target.value);
                if (newFyError) setNewFyError('');
              }}
              placeholder="2026-27"
              className="tabular-nums"
            />
          </Field>
        </form>
      </Modal>

      {/* Sample Data & Global Codes Modal (Super Admin) */}
      <Modal
        open={sampleToolsOpen}
        onClose={() => setSampleToolsOpen(false)}
        title="Sample data & global codes"
        subtitle="Super Admin tools"
        size="sm"
      >
        <div className="space-y-3">
          <Section
            title={t('loadSampleData')}
            description="Seeds demo budgets, expenses, bills and economic codes for FY 2025-26 in the selected office."
          >
            <button
              type="button"
              onClick={handleLoadSampleData}
              disabled={seeding}
              aria-busy={seeding}
              className="min-h-[44px] w-full px-4 rounded-xl border border-[var(--border-strong)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-sm font-semibold text-[var(--text)] inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {seeding ? (
                <Loader2 className="w-4 h-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Database className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span>{seeding ? 'Loading…' : t('loadSampleData')}</span>
            </button>
          </Section>

          <Section
            title="Build economic codes from existing data"
            description="Scans existing budgets, rates, limits and bills to backfill missing global master economic codes."
          >
            <button
              type="button"
              onClick={handleBuildEconomicCodes}
              disabled={migratingCodes}
              aria-busy={migratingCodes}
              className="min-h-[44px] w-full px-4 rounded-xl border border-[var(--border-strong)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-sm font-semibold text-[var(--text)] inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {migratingCodes ? (
                <Loader2 className="w-4 h-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Database className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span>{migratingCodes ? 'Building codes…' : 'Sync global codes'}</span>
            </button>
          </Section>
        </div>
      </Modal>

      {/* Super Admin Global Activity Log Modal */}
      <Modal
        open={activityModalOpen}
        onClose={() => setActivityModalOpen(false)}
        title={t('globalActivity')}
        subtitle="Audit trail across budgets, expense items, bills, rates, limits, and users"
        fullScreenOnMobile
        size="lg"
      >
        {logsLoading ? (
          <p className="text-sm text-[var(--muted)]">Loading activity log…</p>
        ) : globalLogs.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No audit logs recorded yet.</p>
        ) : (
          <>
            {/* Mobile Activity Cards */}
            <div className="md:hidden rounded-xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)]">
              {globalLogs.map((log) => {
                const ts = log.timestamp
                  ? (() => {
                      const d = log.timestamp.toDate();
                      return `${String(d.getDate()).padStart(2, '0')}/${String(
                        d.getMonth() + 1
                      ).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(
                        2,
                        '0'
                      )}:${String(d.getMinutes()).padStart(2, '0')}`;
                    })()
                  : 'Pending';
                return (
                  <div key={log.id} className="p-3.5 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--text)] capitalize">
                        {log.action} · {log.collection}
                      </span>
                      <span className="tabular-nums text-[var(--muted)] shrink-0">{ts}</span>
                    </div>
                    <div className="text-[var(--text)]">
                      By <span className="font-medium">{log.userName || log.userId}</span>
                    </div>
                    <div className="font-mono text-[11px] text-[var(--muted)] break-all">
                      {log.docId}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--card)]">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--line)] text-[var(--muted)]">
                    <th className="sticky left-0 z-10 bg-[var(--card)] py-2.5 px-3 font-medium whitespace-nowrap">
                      Time
                    </th>
                    <th className="py-2.5 pr-3 font-medium whitespace-nowrap">User</th>
                    <th className="py-2.5 pr-3 font-medium whitespace-nowrap">Action</th>
                    <th className="py-2.5 pr-3 font-medium whitespace-nowrap">Collection</th>
                    <th className="py-2.5 pr-3 font-medium whitespace-nowrap">Document ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {globalLogs.map((log) => {
                    const ts = log.timestamp
                      ? (() => {
                          const d = log.timestamp.toDate();
                          return `${String(d.getDate()).padStart(2, '0')}/${String(
                            d.getMonth() + 1
                          ).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(
                            2,
                            '0'
                          )}:${String(d.getMinutes()).padStart(2, '0')}`;
                        })()
                      : 'Pending';
                    return (
                      <tr key={log.id}>
                        <td className="sticky left-0 z-10 bg-[var(--card)] py-2.5 px-3 tabular-nums whitespace-nowrap text-[var(--muted)]">
                          {ts}
                        </td>
                        <td className="py-2.5 pr-3 font-medium text-[var(--text)] whitespace-nowrap">
                          {log.userName || log.userId}
                        </td>
                        <td className="py-2.5 pr-3 capitalize whitespace-nowrap">{log.action}</td>
                        <td className="py-2.5 pr-3 text-[var(--muted)] whitespace-nowrap">
                          {log.collection}
                        </td>
                        <td className="py-2.5 pr-3 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">
                          {log.docId}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>

      {/* Confirm Table-wise Database Delete Modal */}
      <Modal
        open={Boolean(confirmTables && confirmTables.length > 0)}
        onClose={() => !clearingTables && setConfirmTables(null)}
        title="ডাটাবেইজ টেবিল মুছে ফেলার নিশ্চিতকরণ"
        subtitle="এই কাজটি পূর্বাবস্থায় ফেরানো যাবে না"
        size="sm"
        confirmClose={Boolean(confirmText.trim()) && !clearingTables}
        footer={
          <ModalFooter
            danger
            loading={clearingTables}
            secondary={{
              label: t('cancel'),
              disabled: clearingTables,
              onClick: () => setConfirmTables(null),
            }}
            primary={{
              label: clearingTables ? 'মুছে ফেলা হচ্ছে…' : 'স্থায়ীভাবে মুছুন',
              icon: <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />,
              disabled: !confirmPhraseValid,
              onClick: handleConfirmClearTables,
            }}
          />
        }
      >
        {confirmTables && (
          <div className="space-y-4">
            <div
              aria-hidden="true"
              className="w-14 h-14 rounded-full bg-[var(--danger-bg)] text-[var(--danger-text)] flex items-center justify-center mx-auto"
            >
              <AlertTriangle className="w-7 h-7" />
            </div>
            <Banner
              variant="danger"
              title="সতর্কতা: নিচের টেবিল(গুলোর) সকল ডকুমেন্ট ডাটাবেইজ থেকে স্থায়ীভাবে মুছে যাবে।"
            >
              প্রয়োজনে আগে উপরের <strong>Download JSON backup</strong> বাটন থেকে JSON ব্যাকআপ সংরক্ষণ করুন।
            </Banner>

            <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)] text-xs">
              {confirmTables.map((k) => {
                const meta = DELETABLE_DB_TABLES.find((item) => item.key === k);
                const cnt = tableCounts[k] ?? 0;
                return (
                  <div key={k} className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-[var(--text)] bn">
                        {meta?.labelBn || k}
                      </div>
                      <div className="font-mono text-[11px] text-[var(--muted)]">{k}</div>
                    </div>
                    <span className="font-bold tabular-nums text-[var(--danger-text)] shrink-0">
                      {cnt}টি রেকর্ড
                    </span>
                  </div>
                );
              })}
            </div>

            <Field
              label={
                <>
                  নিশ্চিত করতে নিচে <strong className="text-[var(--text)]">DELETE</strong> অথবা{' '}
                  <strong className="text-[var(--text)]">মুছুন</strong> লিখুন:
                </>
              }
              required
            >
              <TextInput
                type="text"
                autoComplete="off"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE বা মুছুন লিখুন…"
              />
            </Field>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
