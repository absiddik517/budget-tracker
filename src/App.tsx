import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppProvider } from './contexts/AppContext';
import { ToastContainer } from './components/ToastContainer';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { SpendingPage } from './pages/SpendingPage';
import { EconomicCodesPage } from './pages/EconomicCodesPage';
import { VatTaxModelPage } from './pages/VatTaxModelPage';
import { SpendingLimitsPage } from './pages/SpendingLimitsPage';
import { ReportsPage } from './pages/ReportsPage';
import { UsersPage } from './pages/UsersPage';
import { SettingsPage } from './pages/SettingsPage';

function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const { userDoc } = useAuth();
  if (!userDoc || userDoc.role !== 'superAdmin') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function AppGate() {
  const { accessState, needsOfficeSetup } = useAuth();

  if (accessState === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--text)] gap-3">
        <div className="w-7 h-7 rounded-full border-2 border-[var(--line)] border-t-[var(--accent)] animate-spin" />
        <p className="text-sm text-[var(--muted)]">Verifying office access…</p>
      </div>
    );
  }

  if (accessState !== 'active') {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route
        path="/"
        element={needsOfficeSetup ? <Navigate to="/settings" replace /> : <DashboardPage />}
      />
      <Route path="/budgets" element={<BudgetsPage />} />
      <Route path="/spending" element={<SpendingPage />} />
      <Route path="/economic-codes" element={<EconomicCodesPage />} />
      <Route path="/vat-tax" element={<VatTaxModelPage />} />
      <Route path="/limits" element={<SpendingLimitsPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route
        path="/users"
        element={
          <RequireSuperAdmin>
            <UsersPage />
          </RequireSuperAdmin>
        }
      />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppProvider>
          <BrowserRouter>
            <AppGate />
            <ToastContainer />
          </BrowserRouter>
        </AppProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
