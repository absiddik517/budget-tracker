import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  BarChart2,
  BookOpen,
  Building2,
  Check,
  ClipboardList,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  History,
  Layers,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  Percent,
  ReceiptText,
  Settings,
  ShieldCheck,
  Sun,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ALL_OFFICES_ID, useApp } from '../contexts/AppContext';
import { useTheme } from '../contexts/ThemeContext';
import { useMountTransition } from '../hooks/useMountTransition';
import { formatRoleLabel } from '../lib/permissions';
import type { TranslationKey } from '../i18n';
import { BottomSheet } from './BottomSheet';
import firestoreRulesText from '../../firestore.rules?raw';

export interface LayoutSaveBar {
  visible: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard?: () => void;
  label?: string;
}

interface LayoutProps {
  title: string;
  actions?: React.ReactNode;
  saveBar?: LayoutSaveBar;
  children: React.ReactNode;
}

interface NavItem {
  to: string;
  labelKey: TranslationKey;
  icon: React.ComponentType<{ className?: string }>;
  visible: boolean;
}

export function Layout({ title, actions, saveBar, children }: LayoutProps) {
  const { userDoc, isSuperAdmin, signOut } = useAuth();
  const {
    offices,
    currentOfficeId,
    setCurrentOfficeId,
    currentOffice,
    currentOfficeRole,
    effectiveRole,
    isAllOfficesMode,
    isLegacyPreMigration,
    officeSettings,
    selectedFy,
    t,
    permissionDeniedPaths,
    pushToast,
  } = useApp();
  const { resolvedTheme, toggleTheme } = useTheme();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [officeSheetOpen, setOfficeSheetOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [copiedRules, setCopiedRules] = useState(false);

  const { mounted: saveBarMounted, visible: saveBarVisible } = useMountTransition(
    Boolean(saveBar?.visible),
    220
  );

  const handleCopyRules = async () => {
    try {
      await navigator.clipboard.writeText(firestoreRulesText);
      setCopiedRules(true);
      pushToast('success', 'firestore.rules কপি হয়েছে। Firebase Console → Rules-এ পেস্ট করে Publish করুন।');
      setTimeout(() => setCopiedRules(false), 3000);
    } catch {
      pushToast('error', 'ক্লিপবোর্ডে কপি করা যায়নি। প্রজেক্টের firestore.rules ফাইলটি ব্যবহার করুন।');
    }
  };

  const showOperationalOfficeMenu = !isSuperAdmin || !isAllOfficesMode;

  const navItems: NavItem[] = [
    { to: '/', labelKey: 'navDashboard', icon: LayoutGrid, visible: true },
    { to: '/offices', labelKey: 'navOffices', icon: Building2, visible: isSuperAdmin },
    { to: '/budgets', labelKey: 'navBudgets', icon: Wallet, visible: showOperationalOfficeMenu },
    {
      to: '/expense-items',
      labelKey: 'navExpenseItems',
      icon: ClipboardList,
      visible: showOperationalOfficeMenu,
    },
    { to: '/bills', labelKey: 'navBills', icon: ReceiptText, visible: showOperationalOfficeMenu },
    { to: '/staff', labelKey: 'navStaff', icon: UserCheck, visible: !isSuperAdmin && currentOfficeRole === 'ddo' },
    { to: '/users', labelKey: 'navUsers', icon: Users, visible: isSuperAdmin },
    { to: '/reports', labelKey: 'navReports', icon: BarChart2, visible: true },
    { to: '/activity', labelKey: 'navActivity', icon: Activity, visible: isSuperAdmin },
    { to: '/limits', labelKey: 'navLimits', icon: ShieldCheck, visible: true },
    { to: '/economic-codes', labelKey: 'navEconomicCodes', icon: BookOpen, visible: true },
    { to: '/vat-tax', labelKey: 'navVatTax', icon: Percent, visible: true },
    {
      to: '/tr21-setup',
      labelKey: 'navTr21Setup',
      icon: FileSpreadsheet,
      visible: showOperationalOfficeMenu || isSuperAdmin,
    },
    { to: '/work-history', labelKey: 'navWorkHistory', icon: History, visible: !isSuperAdmin },
    { to: '/settings', labelKey: 'navSettings', icon: Settings, visible: true },
  ];

  const visibleNav = navItems.filter((item) => item.visible);

  const isRouteActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const canSwitchOffice = isSuperAdmin || offices.length > 1;

  const currentOfficeDisplayName = isAllOfficesMode
    ? t('allOffices')
    : currentOffice
      ? currentOffice.nameBn || currentOffice.name
      : officeSettings.officeName;

  const currentRoleDisplay = formatRoleLabel(effectiveRole);

  const handleSelectOffice = (officeId: string) => {
    if (!canSwitchOffice) return;
    setCurrentOfficeId(officeId);
    setOfficeSheetOpen(false);
  };

  return (
    <div className="h-dvh w-full flex flex-col lg:flex-row overflow-hidden bg-[var(--bg)] text-[var(--text)] print:h-auto print:overflow-visible">
      {/* Desktop Left Sidebar (235px, hidden on mobile) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-[235px] lg:shrink-0 lg:h-dvh bg-[var(--card)] border-r border-[var(--line)] z-30 no-print">
        <div className="px-5 pt-6 pb-4 shrink-0">
          <Link
            to="/"
            className="text-lg font-bold tracking-tight text-[var(--accent)] whitespace-nowrap"
          >
            {t('appTitle')}
          </Link>
        </div>

        <nav className="flex-1 min-h-0 px-3 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = isRouteActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`min-h-[42px] flex items-center gap-3 px-3 rounded-[10px] text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                    : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-subtle)]'
                }`}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                <span className="truncate">{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[var(--line)] space-y-2 shrink-0">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[var(--text)] truncate">
              {userDoc?.name || '—'}
            </div>
            <div className="text-[11px] text-[var(--muted)] truncate">
              {currentRoleDisplay} · {currentOfficeDisplayName}
            </div>
          </div>
          <button
            type="button"
            onClick={() => signOut()}
            className="min-h-[40px] w-full flex items-center gap-2 px-2.5 rounded-lg text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>{t('signOut')}</span>
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full w-full print:h-auto print:block">
        {/* Top Header */}
        <header className="shrink-0 safe-top z-20 bg-[var(--card)] border-b border-[var(--line)] no-print">
          <div className="max-w-[1220px] w-full mx-auto px-3 md:px-6 lg:px-8 py-2.5 md:py-4 flex items-center justify-between gap-2 md:gap-3">
            <h1 className="text-lg md:text-2xl font-bold tracking-tight text-[var(--text)] truncate min-w-0 flex-1">
              {title}
            </h1>

            <div className="flex items-center gap-2 shrink-0">
              {!isLegacyPreMigration && (
                <button
                  type="button"
                  onClick={() => setOfficeSheetOpen(true)}
                  aria-label={t('selectOffice')}
                  aria-haspopup="dialog"
                  aria-expanded={officeSheetOpen}
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl bg-[var(--card)] border border-[var(--line)] text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors shrink-0"
                >
                  <Layers className="w-5 h-5" />
                </button>
              )}

              <button
                type="button"
                onClick={toggleTheme}
                aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl bg-[var(--card)] border border-[var(--line)] text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors shrink-0"
              >
                {resolvedTheme === 'dark' ? (
                  <Sun className="w-5 h-5" />
                ) : (
                  <Moon className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </header>

        {/* Print-only Header */}
        <div className="print-only px-4 py-3 border-b border-slate-300 mb-4">
          <div className="text-lg font-bold">{currentOfficeDisplayName}</div>
          {officeSettings.address && (
            <div className="text-xs text-slate-600">{officeSettings.address}</div>
          )}
          <div className="text-sm font-medium mt-1">
            {title} · FY {selectedFy}
          </div>
        </div>

        {/* Scrollable Content Region */}
        <main className="flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain w-full print:overflow-visible">
          <div
            className={`max-w-[1220px] w-full mx-auto px-3 md:px-6 lg:px-8 pt-2.5 md:pt-3 ${
              saveBar?.visible ? 'pb-24 md:pb-24' : 'pb-5 md:pb-10'
            }`}
          >
            {isLegacyPreMigration && isSuperAdmin && (
              <div className="mb-3.5 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3.5 py-2.5 text-xs md:text-sm text-[var(--warning-text)] flex flex-wrap items-center justify-between gap-2 no-print">
                <span>
                  সিঙ্গেল-অফিস ডেটাকে মাল্টি-অফিস কাঠামোতে রূপান্তর করতে সেটিংস →{' '}
                  <strong>Migrate to multi-office</strong> ব্যবহার করুন।
                </span>
                <Link
                  to="/settings"
                  className="font-semibold underline whitespace-nowrap"
                >
                  Settings-এ যান →
                </Link>
              </div>
            )}

            {!isSuperAdmin && !isLegacyPreMigration && offices.length === 0 && (
              <div className="mb-3.5 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3.5 py-3 text-xs md:text-sm text-[var(--warning-text)] no-print">
                আপনার বর্তমানে কোনো সক্রিয় অফিস পদায়ন নেই। আপনার পূর্বের রেকর্ড দেখতে{' '}
                <Link to="/work-history" className="font-semibold underline">
                  আমার কর্ম-ইতিহাস
                </Link>{' '}
                দেখুন অথবা নতুন পদায়নের জন্য অ্যাডমিনের সাথে যোগাযোগ করুন।
              </div>
            )}

            {permissionDeniedPaths.length > 0 && !bannerDismissed && (
              <div
                role="alert"
                className="mb-3.5 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3.5 py-3 text-xs md:text-sm text-[var(--danger-text)] flex items-start justify-between gap-3 no-print"
              >
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="min-w-0 space-y-2 flex-1">
                    <div className="font-semibold">
                      Firestore Rules আপডেট প্রয়োজন (Missing or insufficient permissions)
                    </div>
                    <p className="text-xs leading-relaxed opacity-90">
                      কালেকশন{' '}
                      <span className="font-mono font-semibold">
                        {permissionDeniedPaths.join(', ')}
                      </span>{' '}
                      পড়ার অনুমতি মেলেনি। প্রজেক্ট{' '}
                      <span className="font-mono font-semibold">budget-tracker-f7025</span>-এ
                      সর্বশেষ <span className="font-mono">firestore.rules</span> কপি করে
                      Firebase Console → Firestore Database → Rules-এ Publish করুন (অথবা CLI-তে{' '}
                      <span className="font-mono">firebase deploy --only firestore:rules,firestore:indexes</span>{' '}
                      চালান)।
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={handleCopyRules}
                        className="min-h-[36px] px-3 rounded-lg border border-[var(--danger-border)] bg-[var(--card)] text-[var(--text)] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[var(--surface-subtle)]"
                      >
                        {copiedRules ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-[var(--accent)]" />
                            <span>কপি হয়েছে</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>firestore.rules কপি করুন</span>
                          </>
                        )}
                      </button>
                      <a
                        href="https://console.firebase.google.com/project/budget-tracker-f7025/firestore/rules"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[36px] px-3 rounded-lg border border-[var(--danger-border)] bg-[var(--card)] text-[var(--text)] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[var(--surface-subtle)]"
                      >
                        <span>Firebase Console Rules খুলুন</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setBannerDismissed(true)}
                  aria-label="Dismiss alert"
                  className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg hover:bg-black/10 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {actions && (
              <div className="flex flex-wrap justify-end gap-2 mb-3 no-print [&>button:only-child]:w-full [&>button:only-child]:justify-center sm:[&>button:only-child]:w-auto [&>a:only-child]:w-full [&>a:only-child]:justify-center sm:[&>a:only-child]:w-auto">
                {actions}
              </div>
            )}

            {children}
          </div>
        </main>

        {/* Sticky Unsaved Changes Save Bar */}
        {saveBarMounted && saveBar && (
          <div className="fixed inset-x-3 bottom-[calc(56px+env(safe-area-inset-bottom,0px)+8px)] lg:left-[calc(235px+1.5rem)] lg:right-6 lg:bottom-4 z-30 flex justify-center pointer-events-none no-print">
            <div
              role="region"
              aria-label={saveBar.label || t('unsavedChanges')}
              className={`pointer-events-auto w-full max-w-2xl rounded-[14px] bg-[var(--text)] text-[var(--bg)] dark:bg-[var(--card)] dark:text-[var(--text)] border border-[var(--line)] shadow-xl px-4 py-2.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 transition-[transform,opacity] duration-200 motion-reduce:transition-none ${
                saveBarVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
              }`}
            >
              <span className="text-sm font-semibold">
                {saveBar.label || t('unsavedChanges')}
              </span>
              <div className="flex items-center gap-2 shrink-0 ml-auto">
                {saveBar.onDiscard && (
                  <button
                    type="button"
                    onClick={saveBar.onDiscard}
                    disabled={saveBar.saving}
                    className="min-h-[44px] px-3.5 rounded-lg border border-current/25 text-xs sm:text-sm font-medium hover:bg-white/10 disabled:opacity-60 transition-colors whitespace-nowrap"
                  >
                    {t('discard')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={saveBar.onSave}
                  disabled={saveBar.saving}
                  className="min-h-[44px] px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 transition-colors whitespace-nowrap"
                >
                  <Check className="w-4 h-4 shrink-0" />
                  <span>{saveBar.saving ? t('savingLabel') : t('save')}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mobile Bottom Tab Bar (< 1024px) */}
        <nav
          className="lg:hidden shrink-0 z-30 bg-[var(--card)] border-t border-[var(--line)] safe-bottom no-print"
          aria-label="Mobile navigation"
        >
          <div className="grid grid-cols-5 h-[56px]">
            <Link
              to="/budgets"
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium px-1 ${
                isRouteActive('/budgets') ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
              }`}
            >
              <Wallet className="w-5 h-5 shrink-0" />
              <span className="truncate max-w-full">{t('navBudgetsShort')}</span>
            </Link>
            <Link
              to="/bills"
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium px-1 ${
                isRouteActive('/bills') ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
              }`}
            >
              <ReceiptText className="w-5 h-5 shrink-0" />
              <span className="truncate max-w-full">{t('navBills')}</span>
            </Link>
            <Link
              to="/"
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium px-1 ${
                isRouteActive('/') ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
              }`}
            >
              <LayoutGrid className="w-5 h-5 shrink-0" />
              <span className="truncate max-w-full">{t('navDashboard')}</span>
            </Link>
            <Link
              to="/expense-items"
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium px-1 ${
                isRouteActive('/expense-items') ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
              }`}
            >
              <ClipboardList className="w-5 h-5 shrink-0" />
              <span className="truncate max-w-full">{t('navExpenseItemsShort')}</span>
            </Link>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium px-1 ${
                moreOpen ||
                isRouteActive('/offices') ||
                isRouteActive('/staff') ||
                isRouteActive('/work-history') ||
                isRouteActive('/activity') ||
                isRouteActive('/reports') ||
                isRouteActive('/tr21-setup') ||
                isRouteActive('/economic-codes') ||
                isRouteActive('/vat-tax') ||
                isRouteActive('/limits') ||
                isRouteActive('/users') ||
                isRouteActive('/settings')
                  ? 'text-[var(--accent)]'
                  : 'text-[var(--muted)]'
              }`}
            >
              <Menu className="w-5 h-5 shrink-0" />
              <span className="truncate max-w-full">{t('navMore')}</span>
            </button>
          </div>
        </nav>
      </div>

      {/* Office Switcher Sheet (Bottom sheet on mobile, centered dialog on md+) */}
      {!isLegacyPreMigration && (
        <BottomSheet
          open={officeSheetOpen}
          onClose={() => setOfficeSheetOpen(false)}
          title={t('selectOffice')}
          desktopCenter
          maxWidthClass="md:max-w-md"
          closeLabel={t('closeLabel')}
        >
          <div className="p-3 space-y-2">
            {offices.length === 0 && !isSuperAdmin ? (
              <p className="text-sm text-[var(--muted)] px-2 py-4 text-center">
                {t('noDataFound')}
              </p>
            ) : (
              <div role="radiogroup" aria-label={t('selectOffice')} className="space-y-1.5">
                {isSuperAdmin && (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={currentOfficeId === ALL_OFFICES_ID}
                    onClick={() => handleSelectOffice(ALL_OFFICES_ID)}
                    className={`w-full min-h-[56px] px-3.5 py-2.5 rounded-xl flex items-center justify-between gap-3 text-left transition-colors ${
                      currentOfficeId === ALL_OFFICES_ID
                        ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'hover:bg-[var(--surface-subtle)] text-[var(--text)]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{t('allOffices')}</div>
                      <div className="text-xs opacity-80 truncate">
                        Super Admin · {t('readOnlyLabel')}
                      </div>
                    </div>
                    {currentOfficeId === ALL_OFFICES_ID && (
                      <Check className="w-5 h-5 shrink-0" />
                    )}
                  </button>
                )}

                {offices.map((off) => {
                  const selected = canSwitchOffice ? currentOfficeId === off.id : true;
                  const roleLabel = isSuperAdmin
                    ? 'Read-only'
                    : formatRoleLabel(userDoc?.access?.[off.id]);

                  if (!canSwitchOffice) {
                    return (
                      <div
                        key={off.id}
                        role="radio"
                        aria-checked="true"
                        className="w-full min-h-[56px] px-3.5 py-2.5 rounded-xl flex items-center justify-between gap-3 bg-[var(--accent-soft)] text-[var(--accent)]"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate bn">
                            {off.nameBn || off.name}
                          </div>
                          <div className="text-xs opacity-80 truncate">{roleLabel}</div>
                        </div>
                        <Check className="w-5 h-5 shrink-0" />
                      </div>
                    );
                  }

                  return (
                    <button
                      key={off.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => handleSelectOffice(off.id)}
                      className={`w-full min-h-[56px] px-3.5 py-2.5 rounded-xl flex items-center justify-between gap-3 text-left transition-colors ${
                        selected
                          ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                          : 'hover:bg-[var(--surface-subtle)] text-[var(--text)]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate bn">
                          {off.nameBn || off.name}
                        </div>
                        <div className="text-xs opacity-80 truncate">{roleLabel}</div>
                      </div>
                      {selected && <Check className="w-5 h-5 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}

            {!canSwitchOffice && offices.length === 1 && (
              <p className="text-xs text-[var(--muted)] px-1 pt-1">
                {t('singleOfficeNotice')}
              </p>
            )}
          </div>
        </BottomSheet>
      )}

      {/* Mobile "More" Sheet */}
      <BottomSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title={userDoc?.name || currentOfficeDisplayName}
        subtitle={`${currentRoleDisplay} · ${currentOfficeDisplayName}`}
        ariaLabel="More options"
        closeLabel={t('closeLabel')}
      >
        <div className="p-3 space-y-1">
          {visibleNav
            .filter((item) => !['/', '/budgets', '/bills', '/expense-items'].includes(item.to))
            .map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className="min-h-[44px] flex items-center gap-3 px-3 rounded-lg text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)]"
                >
                  <Icon className="w-5 h-5 text-[var(--muted)] shrink-0" />
                  <span>{t(item.labelKey)}</span>
                </Link>
              );
            })}
          <button
            type="button"
            onClick={() => {
              setMoreOpen(false);
              signOut();
            }}
            className="min-h-[44px] w-full flex items-center gap-3 px-3 rounded-lg text-sm font-medium text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            <span>{t('signOut')}</span>
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
