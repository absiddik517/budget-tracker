import React, { useEffect, useState } from 'react';
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
import { ALL_OFFICES_ID, LEGACY_UNMIGRATED_OFFICE_ID, useApp } from '../contexts/AppContext';
import { useTheme } from '../contexts/ThemeContext';
import { formatRoleLabel } from '../lib/permissions';
import type { TranslationKey } from '../i18n';
import firestoreRulesText from '../../firestore.rules?raw';

interface LayoutProps {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

interface NavItem {
  to: string;
  labelKey: TranslationKey;
  icon: React.ComponentType<{ className?: string }>;
  visible: boolean;
}

export function Layout({ title, actions, children }: LayoutProps) {
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
    setSelectedFy,
    t,
    permissionDeniedPaths,
    pushToast,
  } = useApp();
  const { resolvedTheme, toggleTheme } = useTheme();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [copiedRules, setCopiedRules] = useState(false);

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

  const fyOptions = Array.from(
    new Set([selectedFy, officeSettings.activeFiscalYear, ...officeSettings.fiscalYears])
  )
    .filter(Boolean)
    .sort()
    .reverse();

  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [moreOpen]);

  const showOfficeDropdown =
    !isLegacyPreMigration && (isSuperAdmin || offices.length > 1);

  const currentOfficeDisplayName = isAllOfficesMode
    ? t('allOffices')
    : currentOffice
      ? currentOffice.nameBn || currentOffice.name
      : officeSettings.officeName;

  const currentRoleDisplay = formatRoleLabel(effectiveRole);

  return (
    <div className="h-dvh w-full flex flex-col lg:flex-row overflow-hidden bg-[var(--bg)] text-[var(--text)] print:h-auto print:overflow-visible">
      {/* Desktop Left Sidebar (230px, hidden on mobile) */}
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
        <header className="shrink-0 safe-top z-20 bg-[var(--bg)]/95 backdrop-blur-sm border-b border-[var(--line)]/60 lg:border-b-0 no-print">
          <div className="max-w-[1220px] w-full mx-auto px-3 md:px-6 lg:px-8 py-2.5 md:py-4 flex flex-wrap items-center justify-between gap-2 md:gap-3">
            <div className="min-w-0 flex items-center gap-2 flex-1">
              <h1 className="text-lg md:text-2xl font-bold tracking-tight text-[var(--text)] truncate min-w-0">
                {title}
              </h1>
            </div>

            <div className="flex items-center gap-1.5 md:gap-2 shrink-0 flex-wrap justify-end">
              {actions}

              {/* Office Switcher (or Badge for single-office user) */}
              {showOfficeDropdown ? (
                <>
                  <label className="sr-only" htmlFor="header-office-select">
                    {t('selectOffice')}
                  </label>
                  <select
                    id="header-office-select"
                    value={currentOfficeId || ''}
                    onChange={(e) => setCurrentOfficeId(e.target.value)}
                    className="max-w-[165px] sm:max-w-[230px] min-h-[44px] md:min-h-[40px] px-2.5 md:px-3 rounded-full text-xs font-semibold bg-[var(--card)] text-[var(--text)] border border-[var(--line)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer truncate"
                  >
                    {isSuperAdmin && (
                      <option value={ALL_OFFICES_ID} className="bg-[var(--card)] text-[var(--text)]">
                        {t('allOffices')} (Super Admin)
                      </option>
                    )}
                    {offices.map((off) => {
                      const roleAtOffice = isSuperAdmin
                        ? 'Read-only'
                        : formatRoleLabel(userDoc?.access?.[off.id]);
                      return (
                        <option
                          key={off.id}
                          value={off.id}
                          className="bg-[var(--card)] text-[var(--text)]"
                        >
                          {off.nameBn || off.name} ({roleAtOffice})
                        </option>
                      );
                    })}
                  </select>
                </>
              ) : (
                !isLegacyPreMigration &&
                currentOffice && (
                  <span className="hidden sm:inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-full text-xs font-medium bg-[var(--card)] border border-[var(--line)] text-[var(--muted)] max-w-[220px] truncate">
                    <Building2 className="w-3.5 h-3.5 shrink-0 text-[var(--accent)]" />
                    <span className="truncate">{currentOffice.nameBn || currentOffice.name}</span>
                  </span>
                )
              )}

              {/* FY selector chip */}
              <label className="sr-only" htmlFor="header-fy-select">
                Select Fiscal Year
              </label>
              <select
                id="header-fy-select"
                value={selectedFy}
                onChange={(e) => setSelectedFy(e.target.value)}
                className="min-h-[44px] md:min-h-[40px] px-2.5 md:px-3 rounded-full text-xs font-semibold bg-[var(--accent-soft)] text-[var(--accent)] border border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer tabular-nums"
              >
                {fyOptions.map((fy) => (
                  <option key={fy} value={fy} className="bg-[var(--card)] text-[var(--text)]">
                    FY {fy}
                  </option>
                ))}
              </select>

              {/* Theme toggle button */}
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full bg-[var(--card)] border border-[var(--line)] text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors shrink-0"
              >
                {resolvedTheme === 'dark' ? (
                  <Sun className="w-4 h-4" />
                ) : (
                  <Moon className="w-4 h-4" />
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
          <div className="max-w-[1220px] w-full mx-auto px-3 md:px-6 lg:px-8 pt-2.5 md:pt-1 pb-5 md:pb-10">
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
            {children}
          </div>
        </main>

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

      {/* Mobile "More" Sheet */}
      {moreOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex items-end bg-black/50 overscroll-contain no-print"
          role="dialog"
          aria-modal="true"
          aria-label="More options"
        >
          <div className="fixed inset-0" onClick={() => setMoreOpen(false)} />
          <div className="relative z-10 w-full max-h-[88dvh] flex flex-col bg-[var(--card)] border-t border-[var(--line)] rounded-t-[16px] overflow-hidden safe-bottom">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)] shrink-0">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--text)] truncate">
                  {userDoc?.name || currentOfficeDisplayName}
                </div>
                <div className="text-xs text-[var(--muted)] truncate">
                  {currentRoleDisplay} · {currentOfficeDisplayName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close menu"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--muted)] shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-1">
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
          </div>
        </div>
      )}
    </div>
  );
}
