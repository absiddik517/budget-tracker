import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Download, Database, History } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { useTheme } from '../contexts/ThemeContext';
import { useGlobalAuditLogs } from '../hooks/useAuditLogs';
import { db } from '../lib/firebase';
import { saveOfficeSettings } from '../lib/firestoreOps';
import { isValidFiscalYear } from '../lib/fy';
import { canManageUsersSettings } from '../lib/permissions';
import { loadSampleData } from '../lib/seedData';
import type { LanguageCode, ThemeMode } from '../types';

export function SettingsPage() {
  const { userDoc, needsOfficeSetup, clearOfficeSetupFlag } = useAuth();
  const { officeSettings, language, setLanguage, setSelectedFy, pushToast, t } = useApp();
  const { theme, setTheme } = useTheme();

  const isSuperAdmin = userDoc ? canManageUsersSettings(userDoc.role) : false;

  const [officeName, setOfficeName] = useState(officeSettings.officeName);
  const [address, setAddress] = useState(officeSettings.address);
  const [activeFiscalYear, setActiveFiscalYear] = useState(officeSettings.activeFiscalYear);
  const [fiscalYears, setFiscalYears] = useState<string[]>(officeSettings.fiscalYears);
  const [newFyInput, setNewFyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activityModalOpen, setActivityModalOpen] = useState(false);

  const { logs: globalLogs, loading: logsLoading } = useGlobalAuditLogs(
    isSuperAdmin && activityModalOpen,
    120
  );

  useEffect(() => {
    setOfficeName(officeSettings.officeName);
    setAddress(officeSettings.address);
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

  const handleExportBackup = async () => {
    setExporting(true);
    try {
      const [budgetsSnap, spendingsSnap, ratesSnap, limitsSnap, totalsSnap] = await Promise.all([
        getDocs(query(collection(db, 'budgets'), where('deleted', '==', false))),
        getDocs(query(collection(db, 'spendings'), where('deleted', '==', false))),
        getDocs(collection(db, 'vatTaxRates')),
        getDocs(collection(db, 'spendingLimits')),
        getDocs(collection(db, 'fyCodeTotals')),
      ]);
      const backup = {
        exportedAt: new Date().toISOString(),
        officeSettings,
        budgets: budgetsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        spendings: spendingsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        vatTaxRates: ratesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        spendingLimits: limitsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        fyCodeTotals: totalsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `budget-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      pushToast('success', 'JSON backup exported.');
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
      className="min-h-[40px] px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold transition-colors disabled:opacity-60 whitespace-nowrap"
    >
      {saving ? 'Saving…' : t('saveChanges')}
    </button>
  ) : null;

  return (
    <Layout title={t('navSettings')} actions={headerActions}>
      {needsOfficeSetup && isSuperAdmin && (
        <div className="mb-5 px-4 py-3 rounded-[14px] bg-[var(--accent-soft)] text-[var(--accent)] text-sm font-medium">
          Welcome! You are the first administrator. Please fill in your office name and fiscal year below and save.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {isSuperAdmin && (
          <section className="card-surface p-5 space-y-4">
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
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
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
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
          </section>
        )}

        {isSuperAdmin && (
          <section className="card-surface p-5 space-y-4">
            <h2 className="text-base font-semibold text-[var(--text)]">{t('fiscalYear')}</h2>
            <div>
              <label htmlFor="active-fy" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                {t('activeFiscalYear')}
              </label>
              <select
                id="active-fy"
                value={activeFiscalYear}
                onChange={(e) => setActiveFiscalYear(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm text-[var(--text)] tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
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
                className="flex-1 min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm text-[var(--text)] tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              <button
                type="button"
                onClick={handleAddFiscalYear}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors whitespace-nowrap"
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
        <section className="card-surface p-5 space-y-4">
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
          <section className="card-surface p-5 space-y-4">
            <h2 className="text-base font-semibold text-[var(--text)]">{t('data')}</h2>
            <p className="text-xs text-[var(--muted)]">
              Download a JSON backup of budgets and spending, or load sample FY 2025-26 data.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={handleExportBackup}
                disabled={exporting}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)] inline-flex items-center gap-2 transition-colors disabled:opacity-60"
              >
                <Download className="w-4 h-4" />
                <span>{exporting ? 'Exporting…' : t('exportBackup')}</span>
              </button>

              <button
                type="button"
                onClick={handleLoadSampleData}
                disabled={seeding}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)] inline-flex items-center gap-2 transition-colors disabled:opacity-60"
              >
                <Database className="w-4 h-4" />
                <span>{seeding ? 'Loading…' : t('loadSampleData')}</span>
              </button>

              <button
                type="button"
                onClick={() => setActivityModalOpen(true)}
                className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)] inline-flex items-center gap-2 transition-colors"
              >
                <History className="w-4 h-4" />
                <span>{t('globalActivity')}</span>
              </button>
            </div>
          </section>
        )}
      </div>

      {/* Super Admin Global Activity Log Modal */}
      <Modal
        open={activityModalOpen}
        onClose={() => setActivityModalOpen(false)}
        title={t('globalActivity')}
        subtitle="Audit trail across budgets, spendings, rates, limits, and users"
        maxWidthClass="lg:max-w-3xl"
      >
        {logsLoading ? (
          <p className="text-sm text-[var(--muted)]">Loading activity log…</p>
        ) : globalLogs.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No audit logs recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--muted)]">
                  <th className="py-2.5 pr-3 font-medium">Time</th>
                  <th className="py-2.5 pr-3 font-medium">User</th>
                  <th className="py-2.5 pr-3 font-medium">Action</th>
                  <th className="py-2.5 pr-3 font-medium">Collection</th>
                  <th className="py-2.5 font-medium">Document ID</th>
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
                      <td className="py-2.5 pr-3 tabular-nums whitespace-nowrap text-[var(--muted)]">
                        {ts}
                      </td>
                      <td className="py-2.5 pr-3 font-medium text-[var(--text)]">
                        {log.userName || log.userId}
                      </td>
                      <td className="py-2.5 pr-3 capitalize">{log.action}</td>
                      <td className="py-2.5 pr-3 text-[var(--muted)]">{log.collection}</td>
                      <td className="py-2.5 font-mono text-[11px] text-[var(--muted)]">
                        {log.docId}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
