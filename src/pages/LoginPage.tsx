import React, { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useApp } from '../contexts/AppContext';

export function LoginPage() {
  const {
    accessState,
    authError,
    firebaseUser,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signOut,
  } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { t } = useApp();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(name, email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (accessState === 'pending') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4 py-8">
        <div className="card-surface w-full max-w-md p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold text-[var(--accent)]">{t('appTitle')}</span>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full border border-[var(--line)]"
            >
              {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
          <h1 className="text-xl font-bold text-[var(--text)]">{t('accessPendingTitle')}</h1>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            {t('accessPendingBody')}
          </p>
          {firebaseUser?.email && (
            <div className="text-xs text-[var(--muted)] bg-[var(--surface-subtle)] px-3 py-2.5 rounded-lg">
              Signed in as <span className="font-medium text-[var(--text)]">{firebaseUser.email}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => signOut()}
            className="min-h-[44px] w-full rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors"
          >
            {t('signOut')}
          </button>
        </div>
      </div>
    );
  }

  if (accessState === 'disabled') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4 py-8">
        <div className="card-surface w-full max-w-md p-6 space-y-4">
          <h1 className="text-xl font-bold text-[var(--danger-text)]">{t('accountDisabledTitle')}</h1>
          <p className="text-sm text-[var(--muted)] leading-relaxed">{t('accountDisabledBody')}</p>
          <button
            type="button"
            onClick={() => signOut()}
            className="min-h-[44px] w-full rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-sm font-medium"
          >
            Back to Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4 py-8">
      <div className="card-surface w-full max-w-md p-6 sm:p-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xl font-bold tracking-tight text-[var(--accent)]">
              {t('appTitle')}
            </div>
            <p className="text-sm text-[var(--muted)] mt-1">
              Government office budget &amp; spending ledger
            </p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full border border-[var(--line)] text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors shrink-0"
          >
            {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[var(--surface-subtle)]">
          <button
            type="button"
            onClick={() => {
              setMode('signin');
              setError(null);
            }}
            className={`min-h-[40px] rounded-md text-sm font-medium transition-colors ${
              mode === 'signin'
                ? 'bg-[var(--card)] text-[var(--text)] shadow-xs'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setError(null);
            }}
            className={`min-h-[40px] rounded-md text-sm font-medium transition-colors ${
              mode === 'signup'
                ? 'bg-[var(--card)] text-[var(--text)] shadow-xs'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            Register
          </button>
        </div>

        {(error || authError) && (
          <div
            role="alert"
            className="px-3.5 py-2.5 rounded-lg bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs font-medium"
          >
            {error || authError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label htmlFor="login-name" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                Full name
              </label>
              <input
                id="login-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
          )}

          <div>
            <label htmlFor="login-email" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
              Email address
            </label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@office.gov.bd"
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] w-full rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold transition-colors disabled:opacity-60"
          >
            {submitting
              ? 'Please wait…'
              : mode === 'signin'
              ? 'Sign in'
              : 'Create account'}
          </button>
        </form>

        <div className="relative flex items-center justify-center">
          <div className="border-t border-[var(--line)] w-full" />
          <span className="bg-[var(--card)] px-3 text-xs text-[var(--muted)] shrink-0">or</span>
          <div className="border-t border-[var(--line)] w-full" />
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={submitting}
          className="min-h-[44px] w-full rounded-lg border border-[var(--line)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-sm font-medium text-[var(--text)] flex items-center justify-center gap-2.5 transition-colors disabled:opacity-60"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
            />
          </svg>
          <span>Continue with Google</span>
        </button>
      </div>
    </div>
  );
}
