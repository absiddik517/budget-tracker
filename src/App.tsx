import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppProvider, useApp } from './contexts/AppContext';
import { ToastContainer } from './components/ToastContainer';
import { Modal, ModalFooter } from './components/Modal';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { ExpenseItemsPage } from './pages/ExpenseItemsPage';
import { BillsPage } from './pages/BillsPage';
import { BillDetailPage } from './pages/BillDetailPage';
import { EconomicCodesPage } from './pages/EconomicCodesPage';
import { VatTaxModelPage } from './pages/VatTaxModelPage';
import { SpendingLimitsPage } from './pages/SpendingLimitsPage';
import { ReportsPage } from './pages/ReportsPage';
import { Tr21SetupPage } from './pages/Tr21SetupPage';
import { OfficesPage } from './pages/OfficesPage';
import { StaffPage } from './pages/StaffPage';
import { MyWorkHistoryPage } from './pages/MyWorkHistoryPage';
import { ActivityPage } from './pages/ActivityPage';
import { UsersPage } from './pages/UsersPage';
import { SettingsPage } from './pages/SettingsPage';
import { useAndroidBack } from './hooks/useAndroidBack';

function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const { isSuperAdmin } = useAuth();
  if (!isSuperAdmin) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function RequireDdo({ children }: { children: React.ReactNode }) {
  const { isSuperAdmin } = useAuth();
  const { currentOfficeRole } = useApp();
  if (isSuperAdmin || currentOfficeRole !== 'ddo') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function AppGate() {
  // Register native Android back-button handler before any early returns.
  const { exitConfirmOpen, cancelExit, confirmExit } = useAndroidBack();

  const { accessState, needsOfficeSetup, isSuperAdmin } = useAuth();
  const { offices, officesLoading, t } = useApp();

  let content: React.ReactNode;

  if (accessState === 'loading') {
    content = (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--text)] gap-3 px-4">
        <div className="w-7 h-7 rounded-full border-2 border-[var(--line)] border-t-[var(--accent)] animate-spin" />
        <p className="text-sm text-[var(--muted)]">Verifying office access…</p>
      </div>
    );
  } else if (accessState !== 'active') {
    content = <LoginPage />;
  } else {
    const shouldPromptInitialSetup =
      needsOfficeSetup && isSuperAdmin && !officesLoading && offices.length === 0;

    content = (
      <Routes>
        <Route
          path="/"
          element={shouldPromptInitialSetup ? <Navigate to="/settings" replace /> : <DashboardPage />}
        />
        <Route path="/budgets" element={<BudgetsPage />} />
        <Route path="/expense-items" element={<ExpenseItemsPage />} />
        <Route path="/bills" element={<BillsPage />} />
        <Route path="/bills/:billId" element={<BillDetailPage />} />
        <Route path="/spending" element={<Navigate to="/bills" replace />} />
        <Route path="/economic-codes" element={<EconomicCodesPage />} />
        <Route path="/vat-tax" element={<VatTaxModelPage />} />
        <Route path="/limits" element={<SpendingLimitsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/tr21-setup" element={<Tr21SetupPage />} />
        <Route
          path="/offices"
          element={
            <RequireSuperAdmin>
              <OfficesPage />
            </RequireSuperAdmin>
          }
        />
        <Route
          path="/users"
          element={
            <RequireSuperAdmin>
              <UsersPage />
            </RequireSuperAdmin>
          }
        />
        <Route
          path="/staff"
          element={
            <RequireDdo>
              <StaffPage />
            </RequireDdo>
          }
        />
        <Route path="/work-history" element={<MyWorkHistoryPage />} />
        <Route
          path="/activity"
          element={
            <RequireSuperAdmin>
              <ActivityPage />
            </RequireSuperAdmin>
          }
        />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <>
      {content}
      <Modal
        open={exitConfirmOpen}
        onClose={cancelExit}
        title={t('exitAppConfirmTitle')}
        size="sm"
        footer={
          <ModalFooter
            danger
            secondary={{
              label: t('exitAppStayBtn'),
              onClick: cancelExit,
            }}
            primary={{
              label: t('exitAppConfirmBtn'),
              onClick: confirmExit,
              icon: <LogOut className="w-4 h-4" aria-hidden="true" />,
            }}
          />
        }
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--danger-bg)] text-[var(--danger-text)] flex items-center justify-center shrink-0">
            <LogOut className="w-5 h-5" aria-hidden="true" />
          </div>
          <p className="text-sm text-[var(--muted)] leading-relaxed pt-1">
            {t('exitAppConfirmBody')}
          </p>
        </div>
      </Modal>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppProvider>
          <BrowserRouter>
            <div className="app-shell-root">
              <AppGate />
              <ToastContainer />
            </div>
          </BrowserRouter>
        </AppProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
