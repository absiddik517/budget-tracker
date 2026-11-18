import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Download, Database, History, RefreshCw, RotateCcw } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { useTheme } from '../contexts/ThemeContext';
import { useGlobalAuditLogs } from '../hooks/useAuditLogs';
import { toBanglaDigits } from '../lib/banglaFormat';
import { db } from '../lib/firebase';
import {
  buildEconomicCodesFromExistingData,
  previewLegacySpendingsMigration,
  runLegacySpendingsMigration,
  saveOfficeSettings,
  type MigrationPreviewReport,
  type MigrationRunResult,
} from '../lib/firestoreOps';
import { isValidFiscalYear } from '../lib/fy';
import { canManageUsersSettings } from '../lib/permissions';
import { loadSampleData } from '../lib/seedData';
import {
  cloneDefaultTr21Clauses,
  DEFAULT_NET_PAYABLE_CODE,
  resolveTr21Clauses,
} from '../lib/tr21Defaults';
import { saveAndShareFile } from '../utils/saveFile';
import type { CertificationClause, LanguageCode, ThemeMode } from '../types';

export function SettingsPage() {
  const { userDoc, needsOfficeSetup, clearOfficeSetupFlag } = useAuth();
  const { officeSettings, language, setLanguage, setSelectedFy, pushToast, t } = useApp();
  const { theme, setTheme } = useTheme();

  const isSuperAdmin = userDoc ? canManageUsersSettings(userDoc.role) : false;

  const [officeName, setOfficeName] = useState(officeSettings.officeName);
  const [address, setAddress] = useState(officeSettings.address);
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
  const [tr21Clauses, setTr21Clauses] = useState<CertificationClause[]>(() =>
    resolveTr21Clauses(officeSettings.tr21Clauses)
  );
  const [activeFiscalYear, setActiveFiscalYear] = useState(officeSettings.activeFiscalYear);
  const [fiscalYears, setFiscalYears] = useState<string[]>(officeSettings.fiscalYears);
  const [newFyInput, setNewFyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [migratingCodes, setMigratingCodes] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activityModalOpen, setActivityModalOpen] = useState(false);

  // Legacy spendings -> bills + expenseItems migration state
  const [previewLoading, setPreviewLoading] = useState(false);
  const [runningMigration, setRunningMigration] = useState(false);
  const [migrationPreview, setMigrationPreview] = useState<MigrationPreviewReport | null>(null);
  const [migrationResult, setMigrationResult] = useState<MigrationRunResult | null>(null);

  const { logs: globalLogs, loading: logsLoading } = useGlobalAuditLogs(
    isSuperAdmin && activityModalOpen,
    120
  );

  useEffect(() => {
    setOfficeName(officeSettings.officeName);
    setAddress(officeSettings.address);
    setInstitutionalCode(officeSettings.institutionalCode || '');
    setDefaultPayeeText(officeSettings.defaultPayeeText || '');
    setPlaceName(officeSettings.placeName || '');
    setDefaultNetPayableCode(officeSettings.defaultNetPayableCode || DEFAULT_NET_PAYABLE_CODE);
    setTr21Clauses(resolveTr21Clauses(officeSettings.tr21Clauses));
    setActiveFiscalYear(officeSettings.activeFiscalYear);
    setFiscalYears(officeSettings.fiscalYears);
  }, [officeSettings]);

  const handleAddFiscalYear = () => {
    const trimmed = newFyInput.trim();
    if (!isValidFiscalYear(trimmed)) {
      pushToast('error', 'Enter a valid fiscal year format like 2026-27.');
      return;
    }
    if (!fiscalYears.includes(trimmed)) {
      setFiscalYears((prev) => [...prev, trimmed].sort());
    }
    setActiveFiscalYear(trimmed);
    setNewFyInput('');
  };

  const handleSave = async () => {
    if (!userDoc || !isSuperAdmin) return;
    if (!officeName.trim()) {
      pushToast('error', 'Office name is required.');
      return;
    }
    setSaving(true);
    try {
      const mergedFys = Array.from(new Set([...fiscalYears, activeFiscalYear])).sort();
      await saveOfficeSettings(
        {
          officeName: officeName.trim(),
          address: address.trim(),
          institutionalCode: institutionalCode.replace(/\D+/g, '').slice(0, 13),
          defaultPayeeText: defaultPayeeText.trim(),
          placeName: placeName.trim(),
          defaultNetPayableCode: defaultNetPayableCode.trim() || DEFAULT_NET_PAYABLE_CODE,
          tr21Clauses,
          activeFiscalYear,
          fiscalYears: mergedFys,
          language,
        },
        { uid: userDoc.id, name: userDoc.name }
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
    if (!userDoc || !isSuperAdmin) return;
    setSeeding(true);
    try {
      await loadSampleData({ uid: userDoc.id, name: userDoc.name });
      setSelectedFy('2025-26');
      pushToast('success', 'Sample data loaded for FY 2025-26.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to load sample data.');
    } finally {
      setSeeding(false);
    }
  };

  const handleBuildEconomicCodes = async () => {
    if (!userDoc || !isSuperAdmin) return;
    setMigratingCodes(true);
    try {
      const res = await buildEconomicCodesFromExistingData({
        uid: userDoc.id,
        name: userDoc.name,
      });
      pushToast(
        'success',
        `Economic codes synced: ${res.created} created, ${res.skipped} already existed.`
      );
    } catch (err) {
      pushToast(
        'error',
        err instanceof Error ? err.message : 'Failed to build economic codes.'
      );
    } finally {
      setMigratingCodes(false);
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
    if (!userDoc || !isSuperAdmin) return;
    setRunningMigration(true);
    try {
      const res = await runLegacySpendingsMigration({
        uid: userDoc.id,
        name: userDoc.name,
      });
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
    setExporting(true);
    try {
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
        getDocs(query(collection(db, 'budgets'), where('deleted', '==', false))),
        getDocs(query(collection(db, 'expenseItems'), where('deleted', '==', false))),
        getDocs(query(collection(db, 'bills'), where('deleted', '==', false))),
        getDocs(collection(db, 'counters')),
        getDocs(collection(db, 'vatTaxRates')),
        getDocs(collection(db, 'spendingLimits')),
        getDocs(collection(db, 'fyCodeTotals')),
        getDocs(collection(db, 'economicCodes')),
      ]);
      const backup = {
        exportedAt: new Date().toISOString(),
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
        fileName: `budget-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`,
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

  const headerActions = isSuperAdmin ? (
    <button
      type="button"
      onClick={handleSave}
      disabled={saving}
      className="min-h-[44px] md:min-h-[40px] px-3.5 md:px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold transition-colors disabled:opacity-60 whitespace-nowrap"
    >
      {saving ? 'Saving…' : t('saveChanges')}
    </button>
  ) : null;

  return (
    <Layout title={t('navSettings')} actions={headerActions}>
      {needsOfficeSetup && isSuperAdmin && (
        <div className="mb-4 md:mb-5 px-3.5 md:px-4 py-3 rounded-[14px] bg-[var(--accent-soft)] text-[var(--accent)] text-sm font-medium">
          Welcome! You are the first administrator. Please fill in your office name and fiscal year below and save.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 md:gap-5">
        {isSuperAdmin && (
          <section className="card-surface p-4 md:p-5 space-y-4">
            <h2 className="text-base font-semibold text-[var(--text)]">{t('office')}</h2>
            <div>
              <label htmlFor="office-name" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                {t('officeName')}
              </label>
              <input
                id="office-name"
                type="text"
                value={officeName}
                onChange={(e) => setOfficeName(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
            <div>
              <label htmlFor="office-address" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                {t('address')}
              </label>
              <input
                id="office-address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>

            <div>
              <label
                htmlFor="institutional-code"
                className="block text-xs font-medium text-[var(--muted)] mb-1.5"
              >
                প্রাতিষ্ঠানিক / অপারেশন কোড (সর্বোচ্চ ১৩ ডিজিট · টি.আর. ফরম ২১)
              </label>
              <input
                id="institutional-code"
                type="text"
                inputMode="numeric"
                maxLength={13}
                value={institutionalCode}
                onChange={(e) =>
                  setInstitutionalCode(e.target.value.replace(/\D+/g, '').slice(0, 13))
                }
                placeholder="যেমন: 120001417"
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm text-[var(--text)] tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              <div className="flex flex-wrap gap-0.5 mt-2">
                {Array.from({ length: 13 }, (_, idx) => {
                  const ch = institutionalCode[idx];
                  return (
                    <span
                      key={idx}
                      className="w-6 h-6 inline-flex items-center justify-center border border-[var(--line)] rounded text-xs font-semibold bg-[var(--surface-subtle)]"
                    >
                      {ch ? toBanglaDigits(ch) : ''}
                    </span>
                  );
                })}
              </div>
            </div>

            <div>
              <label
                htmlFor="default-payee"
                className="block text-xs font-medium text-[var(--muted)] mb-1.5"
              >
                ডিফল্ট চেক প্রাপক (যার নামে চেক ইস্যু করা হবে)
              </label>
              <input
                id="default-payee"
                type="text"
                value={defaultPayeeText}
                onChange={(e) => setDefaultPayeeText(e.target.value)}
                placeholder="সহকারী পরিচালক, জেলা উপানুষ্ঠানিক শিক্ষা ব্যুরো, ময়মনসিংহ"
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="place-name"
                  className="block text-xs font-medium text-[var(--muted)] mb-1.5"
                >
                  স্থান (Place Name)
                </label>
                <input
                  id="place-name"
                  type="text"
                  value={placeName}
                  onChange={(e) => setPlaceName(e.target.value)}
                  placeholder="ময়মনসিংহ"
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm bn text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <div>
                <label
                  htmlFor="net-payable-code"
                  className="block text-xs font-medium text-[var(--muted)] mb-1.5"
                >
                  ডিফল্ট প্রদেয় কোড (ক-খ)
                </label>
                <input
                  id="net-payable-code"
                  type="text"
                  inputMode="numeric"
                  value={defaultNetPayableCode}
                  onChange={(e) =>
                    setDefaultNetPayableCode(e.target.value.replace(/\D+/g, '').slice(0, 10))
                  }
                  placeholder="8172108"
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm tabular-nums text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
            </div>
          </section>
        )}

        {isSuperAdmin && (
          <section className="card-surface p-4 md:p-5 space-y-4">
            <h2 className="text-base font-semibold text-[var(--text)]">{t('fiscalYear')}</h2>
            <div>
              <label htmlFor="active-fy" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                {t('activeFiscalYear')}
              </label>
              <select
                id="active-fy"
                value={activeFiscalYear}
                onChange={(e) => setActiveFiscalYear(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm text-[var(--text)] tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              >
                {Array.from(new Set([...fiscalYears, activeFiscalYear]))
                  .sort()
                  .reverse()
                  .map((fy) => (
                    <option key={fy} value={fy}>
                      {fy}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newFyInput}
                onChange={(e) => setNewFyInput(e.target.value)}
                placeholder="Add FY (e.g. 2026-27)"
                aria-label="New fiscal year"
                className="min-w-0 flex-1 min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm text-[var(--text)] tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              <button
                type="button"
                onClick={handleAddFiscalYear}
                className="min-h-[44px] px-4 shrink-0 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors whitespace-nowrap"
              >
                Add FY
              </button>
            </div>
            <p className="text-xs text-[var(--muted)]">
              Runs July to June. Close old budgets as Executed when the year ends.
            </p>
          </section>
        )}

        {/* Appearance: available to everyone */}
        <section className="card-surface p-4 md:p-5 space-y-4">
          <h2 className="text-base font-semibold text-[var(--text)]">{t('appearance')}</h2>

          <div>
            <div className="text-xs font-medium text-[var(--muted)] mb-2">{t('theme')}</div>
            <div className="flex flex-wrap gap-2">
              {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => {
                const active = theme === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTheme(mode)}
                    className={`min-h-[44px] px-4 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                        : 'border border-[var(--line)] text-[var(--text)] hover:bg-[var(--surface-subtle)]'
                    }`}
                  >
                    {t(mode)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-[var(--muted)] mb-2">{t('language')}</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleLanguageChange('en')}
                className={`min-h-[44px] px-4 rounded-lg text-sm font-medium transition-colors ${
                  language === 'en'
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'border border-[var(--line)] text-[var(--text)] hover:bg-[var(--surface-subtle)]'
                }`}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => handleLanguageChange('bn')}
                className={`min-h-[44px] px-4 rounded-lg text-sm font-medium transition-colors ${
                  language === 'bn'
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'border border-[var(--line)] text-[var(--text)] hover:bg-[var(--surface-subtle)]'
                }`}
              >
                বাংলা
              </button>
            </div>
          </div>
        </section>

        {/* Data card: Super Admin only */}
        {isSuperAdmin && (
          <section className="card-surface p-4 md:p-5 space-y-4">
            <h2 className="text-base font-semibold text-[var(--text)]">{t('data')}</h2>
            <p className="text-xs text-[var(--muted)]">
              Download a JSON backup of budgets, expense items, and bills, or load sample FY 2025-26 data.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={handleExportBackup}
                disabled={exporting}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)] inline-flex items-center gap-2 transition-colors disabled:opacity-60"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>{exporting ? 'Exporting…' : t('exportBackup')}</span>
              </button>

              <button
                type="button"
                onClick={handleLoadSampleData}
                disabled={seeding}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)] inline-flex items-center gap-2 transition-colors disabled:opacity-60"
              >
                <Database className="w-4 h-4 shrink-0" />
                <span>{seeding ? 'Loading…' : t('loadSampleData')}</span>
              </button>

              <button
                type="button"
                onClick={handleBuildEconomicCodes}
                disabled={migratingCodes}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)] inline-flex items-center gap-2 transition-colors disabled:opacity-60 text-left"
              >
                <Database className="w-4 h-4 shrink-0" />
                <span>
                  {migratingCodes
                    ? 'Building codes…'
                    : 'Build economic codes from existing data'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActivityModalOpen(true)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)] inline-flex items-center gap-2 transition-colors"
              >
                <History className="w-4 h-4 shrink-0" />
                <span>{t('globalActivity')}</span>
              </button>
            </div>
          </section>
        )}

        {/* Certification Clauses Editor for T.R. Form No. 21 (Super Admin only) */}
        {isSuperAdmin && (
          <section className="lg:col-span-2 card-surface p-4 md:p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-[var(--text)]">
                  ফর্মের প্রত্যয়ন ধারা (টি.আর. ফরম নং-২১)
                </h2>
                <p className="text-xs text-[var(--muted)]">
                  প্রতিটি ধারার লেখা সম্পাদনা বা প্রয়োজনে চালু/বন্ধ করুন। ১২ নং ধারায়{' '}
                  <code className="font-mono">{'{{payeeText}}'}</code> রাখলে বিলের প্রাপকের নাম স্বয়ংক্রিয়ভাবে বসবে। পরিবর্তন শেষে উপরের{' '}
                  <strong>{t('saveChanges')}</strong> বাটনে ক্লিক করুন।
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTr21Clauses(cloneDefaultTr21Clauses())}
                className="min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)] inline-flex items-center gap-1.5 shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>ডিফল্ট পুনরুদ্ধার</span>
              </button>
            </div>

            <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
              {tr21Clauses.map((clause, idx) => (
                <div
                  key={clause.id}
                  className={`p-3 rounded-xl border transition-colors space-y-2 ${
                    clause.enabled
                      ? 'border-[var(--line)] bg-[var(--card)]'
                      : 'border-[var(--line)]/60 bg-[var(--surface-subtle)] opacity-70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text)]">
                      <span>ধারা {clause.numberBn}.</span>
                      <span className="px-2 py-0.5 rounded bg-[var(--surface-subtle)] text-[11px] text-[var(--muted)] font-medium">
                        পাতা {clause.page === 1 ? '১' : '২'}
                      </span>
                    </div>
                    <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-medium select-none">
                      <input
                        type="checkbox"
                        checked={clause.enabled}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setTr21Clauses((prev) =>
                            prev.map((c, cIdx) => (cIdx === idx ? { ...c, enabled: checked } : c))
                          );
                        }}
                        className="w-4 h-4 accent-[var(--accent)]"
                      />
                      <span>{clause.enabled ? 'চালু' : 'বন্ধ'}</span>
                    </label>
                  </div>
                  <textarea
                    rows={clause.text.includes('\n') ? 3 : 2}
                    value={clause.text}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTr21Clauses((prev) =>
                        prev.map((c, cIdx) => (cIdx === idx ? { ...c, text: val } : c))
                      );
                    }}
                    className="w-full p-2.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-base md:text-xs bn text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Legacy Spendings -> Bills + Expense Items Migration (Super Admin only) */}
        {isSuperAdmin && (
          <section className="lg:col-span-2 card-surface p-4 md:p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-[var(--text)]">
                  Legacy Data Migration (Spendings → Bills &amp; Expense Items)
                </h2>
                <p className="text-xs text-[var(--muted)]">
                  পুরনো <code className="font-mono">spendings</code> কালেকশনের ডেটা নিরাপদ ও Idempotent ভাবে{' '}
                  <code className="font-mono">bills</code> ও <code className="font-mono">expenseItems</code>-এ রূপান্তর করে (ইতোমধ্যে অনুমোদিত বাজেট পুনরায় কাটা হয় না)।
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handlePreviewMigration}
                  disabled={previewLoading || runningMigration}
                  className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium hover:bg-[var(--surface-subtle)] inline-flex items-center gap-2 disabled:opacity-60"
                >
                  <RefreshCw className={`w-4 h-4 ${previewLoading ? 'animate-spin' : ''}`} />
                  <span>{previewLoading ? 'স্ক্যান হচ্ছে…' : 'Dry-Run প্রিভিউ'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleRunMigration}
                  disabled={runningMigration || previewLoading}
                  className="min-h-[44px] px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
                >
                  {runningMigration ? 'মাইগ্রেশন চলছে…' : 'মাইগ্রেশন চালান'}
                </button>
              </div>
            </div>

            {migrationPreview && (
              <div className="p-3.5 rounded-xl bg-[var(--surface-subtle)] border border-[var(--line)] text-xs space-y-2">
                <div className="font-semibold text-[var(--text)]">
                  Dry-Run ফলাফল: মোট পুরনো এন্ট্রি {migrationPreview.totalLegacySpendings}টি · ইতোমধ্যে মাইগ্রেটেড{' '}
                  {migrationPreview.alreadyMigratedCount}টি · বাকি {migrationPreview.toMigrateCount}টি
                </div>
                <div className="flex flex-wrap gap-3 text-[var(--muted)] tabular-nums">
                  <span>Approved: {migrationPreview.byStatus.approved}</span>
                  <span>Submitted: {migrationPreview.byStatus.submitted}</span>
                  <span>Draft: {migrationPreview.byStatus.draft}</span>
                  <span>Rejected: {migrationPreview.byStatus.rejected}</span>
                  <span>Voided→Cancelled: {migrationPreview.byStatus.cancelledFromVoided}</span>
                  <span>Budgets sync needed: {migrationPreview.budgetsNeedingSync}</span>
                  <span>FY Totals sync needed: {migrationPreview.fyTotalsNeedingSync}</span>
                </div>
              </div>
            )}

            {migrationResult && (
              <div className="p-3 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] text-xs font-medium tabular-nums">
                সম্পন্ন: {migrationResult.migratedBills}টি বিল, {migrationResult.migratedItems}টি খরচ আইটেম তৈরি হয়েছে ·{' '}
                {migrationResult.skippedExisting}টি আগে থেকেই ছিল · {migrationResult.syncedBudgets}টি বাজেট ও{' '}
                {migrationResult.syncedFyTotals}টি কোড টোটাল সিঙ্ক হয়েছে।
              </div>
            )}
          </section>
        )}
      </div>

      {/* Super Admin Global Activity Log Modal */}
      <Modal
        open={activityModalOpen}
        onClose={() => setActivityModalOpen(false)}
        title={t('globalActivity')}
        subtitle="Audit trail across budgets, expense items, bills, rates, limits, and users"
        fullScreenOnMobile
        maxWidthClass="md:max-w-3xl"
      >
        {logsLoading ? (
          <p className="text-sm text-[var(--muted)]">Loading activity log…</p>
        ) : globalLogs.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No audit logs recorded yet.</p>
        ) : (
          <>
            {/* Mobile Activity Cards */}
            <div className="md:hidden divide-y divide-[var(--line)]">
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
                  <div key={log.id} className="py-3 space-y-1 text-xs">
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
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--line)] text-[var(--muted)]">
                    <th className="sticky left-0 z-10 bg-[var(--card)] py-2.5 pr-3 font-medium whitespace-nowrap">
                      Time
                    </th>
                    <th className="py-2.5 pr-3 font-medium whitespace-nowrap">User</th>
                    <th className="py-2.5 pr-3 font-medium whitespace-nowrap">Action</th>
                    <th className="py-2.5 pr-3 font-medium whitespace-nowrap">Collection</th>
                    <th className="py-2.5 font-medium whitespace-nowrap">Document ID</th>
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
                        <td className="sticky left-0 z-10 bg-[var(--card)] py-2.5 pr-3 tabular-nums whitespace-nowrap text-[var(--muted)]">
                          {ts}
                        </td>
                        <td className="py-2.5 pr-3 font-medium text-[var(--text)] whitespace-nowrap">
                          {log.userName || log.userId}
                        </td>
                        <td className="py-2.5 pr-3 capitalize whitespace-nowrap">{log.action}</td>
                        <td className="py-2.5 pr-3 text-[var(--muted)] whitespace-nowrap">
                          {log.collection}
                        </td>
                        <td className="py-2.5 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">
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
    </Layout>
  );
}
