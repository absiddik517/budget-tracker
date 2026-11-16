import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BarChart2,
  BookOpen,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  Percent,
  ReceiptText,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { useTheme } from '../contexts/ThemeContext';
import { formatRoleLabel } from '../lib/permissions';
import type { TranslationKey } from '../i18n';

interface LayoutProps {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

interface NavItem {
  to: string;
  labelKey: TranslationKey;
  icon: React.ComponentType<{ className?: string }>;
  superAdminOnly?: boolean;
}

const DESKTOP_NAV: NavItem[] = [
  { to: '/', labelKey: 'navDashboard', icon: LayoutGrid },
  { to: '/budgets', labelKey: 'navBudgets', icon: Wallet },
  { to: '/spending', labelKey: 'navSpending', icon: ReceiptText },
  { to: '/economic-codes', labelKey: 'navEconomicCodes', icon: BookOpen },
  { to: '/vat-tax', labelKey: 'navVatTax', icon: Percent },
  { to: '/limits', labelKey: 'navLimits', icon: ShieldCheck },
  { to: '/reports', labelKey: 'navReports', icon: BarChart2 },
  { to: '/users', labelKey: 'navUsers', icon: Users, superAdminOnly: true },
  { to: '/settings', labelKey: 'navSettings', icon: Settings },
];

export function Layout({ title, actions, children }: LayoutProps) {
  const { userDoc, signOut } = useAuth();
  const { officeSettings, selectedFy, setSelectedFy, t } = useApp();
  const { resolvedTheme, toggleTheme } = useTheme();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const isSuperAdmin = userDoc?.role === 'superAdmin';
  const visibleNav = DESKTOP_NAV.filter((item) => !item.superAdminOnly || isSuperAdmin);

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

  return (
    <div className="h-dvh w-full flex flex-col lg:flex-row overflow-hidden bg-[var(--bg)] text-[var(--text)] print:h-auto print:overflow-visible">
      {/* Desktop Left Sidebar (230px, hidden on mobile) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-[230px] lg:shrink-0 lg:h-dvh bg-[var(--card)] border-r border-[var(--line)] z-30 no-print">
        <div className="px-5 pt-6 pb-5 shrink-0">
          <Link
            to="/"
            className="text-lg font-bold tracking-tight text-[var(--accent)] whitespace-nowrap"
          >
            {t('appTitle')}
          </Link>
        </div>

        <nav className="flex-1 min-h-0 px-3 space-y-1 overflow-y-auto" aria-label="Main navigation">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = isRouteActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`min-h-[44px] flex items-center gap-3 px-3 rounded-[10px] text-sm font-medium transition-colors whitespace-nowrap ${
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
          <div className="text-xs text-[var(--muted)] truncate">
            {userDoc ? formatRoleLabel(userDoc.role) : ''} · {officeSettings.officeName}
          </div>
          <button
            type="button"
            onClick={() => signOut()}
            className="min-h-[44px] w-full flex items-center gap-2 px-2.5 rounded-lg text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors"
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
          <div className="max-w-[1220px] w-full mx-auto px-3 md:px-6 lg:px-8 py-2.5 md:py-4 flex items-center justify-between gap-2 md:gap-3">
            <h1 className="text-lg md:text-2xl font-bold tracking-tight text-[var(--text)] truncate min-w-0">
              {title}
            </h1>

            <div className="flex items-center gap-1.5 md:gap-2.5 shrink-0">
              {actions}

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
          <div className="text-lg font-bold">{officeSettings.officeName}</div>
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
              to="/"
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium px-1 ${
                isRouteActive('/') ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
              }`}
            >
              <LayoutGrid className="w-5 h-5 shrink-0" />
              <span className="truncate max-w-full">{t('navDashboard')}</span>
            </Link>
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
              to="/spending"
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium px-1 ${
                isRouteActive('/spending') ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
              }`}
            >
              <ReceiptText className="w-5 h-5 shrink-0" />
              <span className="truncate max-w-full">{t('navSpending')}</span>
            </Link>
            <Link
              to="/reports"
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium px-1 ${
                isRouteActive('/reports') ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
              }`}
            >
              <BarChart2 className="w-5 h-5 shrink-0" />
              <span className="truncate max-w-full">{t('navReports')}</span>
            </Link>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium px-1 ${
                moreOpen ||
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
                  {userDoc?.name || officeSettings.officeName}
                </div>
                <div className="text-xs text-[var(--muted)] truncate">
                  {userDoc ? formatRoleLabel(userDoc.role) : ''} · {officeSettings.officeName}
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
              <Link
                to="/economic-codes"
                onClick={() => setMoreOpen(false)}
                className="min-h-[44px] flex items-center gap-3 px-3 rounded-lg text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)]"
              >
                <BookOpen className="w-5 h-5 text-[var(--muted)] shrink-0" />
                <span>{t('navEconomicCodes')}</span>
              </Link>
              <Link
                to="/vat-tax"
                onClick={() => setMoreOpen(false)}
                className="min-h-[44px] flex items-center gap-3 px-3 rounded-lg text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)]"
              >
                <Percent className="w-5 h-5 text-[var(--muted)] shrink-0" />
                <span>{t('navVatTax')}</span>
              </Link>
              <Link
                to="/limits"
                onClick={() => setMoreOpen(false)}
                className="min-h-[44px] flex items-center gap-3 px-3 rounded-lg text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)]"
              >
                <ShieldCheck className="w-5 h-5 text-[var(--muted)] shrink-0" />
                <span>{t('navLimits')}</span>
              </Link>
              {isSuperAdmin && (
                <Link
                  to="/users"
                  onClick={() => setMoreOpen(false)}
                  className="min-h-[44px] flex items-center gap-3 px-3 rounded-lg text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)]"
                >
                  <Users className="w-5 h-5 text-[var(--muted)] shrink-0" />
                  <span>{t('navUsers')}</span>
                </Link>
              )}
              <Link
                to="/settings"
                onClick={() => setMoreOpen(false)}
                className="min-h-[44px] flex items-center gap-3 px-3 rounded-lg text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)]"
              >
                <Settings className="w-5 h-5 text-[var(--muted)] shrink-0" />
                <span>{t('navSettings')}</span>
              </Link>
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
