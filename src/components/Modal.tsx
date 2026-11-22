import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { useMountTransition } from '../hooks/useMountTransition';
import { useBackHandler } from '../lib/backStack';

export type ModalSize = 'sm' | 'md' | 'lg';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  size?: ModalSize;
  maxWidthClass?: string;
  fullScreenOnMobile?: boolean;
  /** If true (or a custom prompt message), asks confirmation before closing on backdrop/Esc/X. */
  confirmClose?: boolean | string;
}

export interface ModalFooterAction {
  label: string;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  form?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  'aria-label'?: string;
}

export interface ModalFooterProps {
  summary?: React.ReactNode;
  secondary?: ModalFooterAction;
  primary?: ModalFooterAction;
  danger?: boolean;
  loading?: boolean;
  extra?: React.ReactNode;
}

const SIZE_CLASS_MAP: Record<ModalSize, string> = {
  sm: 'md:w-[min(480px,calc(100%-48px))]',
  md: 'md:w-[min(560px,calc(100%-48px))]',
  lg: 'md:w-[min(780px,calc(100%-48px))]',
};

function resolveModalWidthClass(size?: ModalSize, maxWidthClass?: string): string {
  if (size) return SIZE_CLASS_MAP[size];
  if (!maxWidthClass) return SIZE_CLASS_MAP.md;
  if (maxWidthClass.includes('max-w-sm') || maxWidthClass.includes('max-w-md')) {
    return SIZE_CLASS_MAP.sm;
  }
  if (maxWidthClass.includes('max-w-lg') || maxWidthClass.includes('max-w-xl')) {
    return SIZE_CLASS_MAP.md;
  }
  if (maxWidthClass.includes('max-w-2xl') || maxWidthClass.includes('max-w-3xl')) {
    return SIZE_CLASS_MAP.lg;
  }
  return `md:w-[calc(100%-48px)] ${maxWidthClass}`;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

let mountedModalCount = 0;
let savedBodyOverflow = '';
const openModalStack: string[] = [];

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  footer,
  children,
  size,
  maxWidthClass,
  fullScreenOnMobile = false,
  confirmClose = false,
}: ModalProps) {
  const { t } = useApp();
  const { mounted, visible } = useMountTransition(open, 220);
  const modalId = useId();
  const titleId = useId();
  const confirmTitleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const keepEditingBtnRef = useRef<HTMLButtonElement | null>(null);
  const prevFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const attemptClose = useCallback(() => {
    if (confirmClose) {
      setShowDiscardConfirm(true);
      return;
    }
    onCloseRef.current();
  }, [confirmClose]);

  const attemptCloseRef = useRef(attemptClose);
  attemptCloseRef.current = attemptClose;

  const showDiscardRef = useRef(showDiscardConfirm);
  showDiscardRef.current = showDiscardConfirm;

  const handleBack = useCallback(() => {
    if (showDiscardRef.current) {
      setShowDiscardConfirm(false);
    } else {
      attemptCloseRef.current();
    }
  }, []);

  // Close discard prompt or modal when Android hardware Back is pressed.
  useBackHandler(open, handleBack);

  useEffect(() => {
    if (!open) {
      setShowDiscardConfirm(false);
    }
  }, [open]);

  // Body scroll lock while mounted (releases after exit animation)
  useEffect(() => {
    if (!mounted) return;
    if (mountedModalCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    mountedModalCount += 1;
    return () => {
      mountedModalCount = Math.max(0, mountedModalCount - 1);
      if (mountedModalCount === 0) {
        document.body.style.overflow = savedBodyOverflow;
      }
    };
  }, [mounted]);

  // Focus capture, stack registration, Escape handling & Tab focus trap
  useEffect(() => {
    if (!open) return;

    prevFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openModalStack.push(modalId);

    const raf = window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && panelRef.current?.contains(active)) return;
      if (closeBtnRef.current) {
        closeBtnRef.current.focus({ preventScroll: true });
      } else {
        panelRef.current?.focus({ preventScroll: true });
      }
    });

    const onKeyDown = (e: KeyboardEvent) => {
      const topId = openModalStack[openModalStack.length - 1];
      if (topId !== modalId) return;

      if (
        document.querySelector('[data-picker-select-open="true"]') ||
        document.querySelector('[data-economic-select-open="true"]')
      ) {
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (showDiscardRef.current) {
          setShowDiscardConfirm(false);
        } else {
          attemptCloseRef.current();
        }
        return;
      }

      if (e.key === 'Tab' && panelRef.current) {
        const nodes = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (nodes.length === 0) {
          e.preventDefault();
          panelRef.current.focus({ preventScroll: true });
          return;
        }
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const current = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (!current || current === first || !panelRef.current.contains(current)) {
            e.preventDefault();
            last.focus({ preventScroll: true });
          }
        } else {
          if (!current || current === last || !panelRef.current.contains(current)) {
            e.preventDefault();
            first.focus({ preventScroll: true });
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown, true);
      const idx = openModalStack.lastIndexOf(modalId);
      if (idx !== -1) openModalStack.splice(idx, 1);
    };
  }, [open, modalId]);

  useEffect(() => {
    if (!showDiscardConfirm) return;
    const raf = window.requestAnimationFrame(() => {
      keepEditingBtnRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [showDiscardConfirm]);

  useEffect(() => {
    if (mounted) return;
    const restoreTarget = prevFocusedRef.current;
    prevFocusedRef.current = null;
    if (restoreTarget && document.contains(restoreTarget)) {
      restoreTarget.focus({ preventScroll: true });
    }
  }, [mounted]);

  if (!mounted) return null;

  const widthClass = resolveModalWidthClass(size, maxWidthClass);
  // Always render as a bottom sheet on phones (never full-screen) and centered dialog on >=768px
  void fullScreenOnMobile;
  const containerSizeClass = `w-full max-w-full ${widthClass} max-h-[92dvh] md:max-h-[calc(100dvh-64px)] rounded-t-[20px] rounded-b-none md:rounded-[20px] border-t border-x-0 border-b-0 md:border`;

  const discardTitle =
    typeof confirmClose === 'string' && confirmClose.trim()
      ? confirmClose.trim()
      : t('discardChangesTitle');

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6 overscroll-contain no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className={`fixed inset-0 bg-[var(--backdrop)] transition-opacity duration-[220ms] motion-reduce:transition-none ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={attemptClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className={`relative z-10 flex flex-col bg-[var(--card)] text-[var(--text)] border-[var(--line)] overflow-hidden focus:outline-none transition-[transform,opacity] duration-[220ms] ease-out motion-reduce:transition-none ${containerSizeClass} ${
          visible
            ? 'translate-y-0 md:scale-100 md:opacity-100'
            : 'translate-y-full md:translate-y-0 md:scale-95 md:opacity-0'
        }`}
      >
        <div
          className="w-10 h-1 rounded-[2px] bg-[var(--line)] mx-auto mt-2 mb-0 md:hidden shrink-0"
          aria-hidden="true"
        />

        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-4 py-3 md:px-5 md:py-[18px] border-b border-[var(--line)] bg-[var(--card)] shrink-0">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-[18px] leading-[1.3] font-bold text-[var(--text)] break-words"
            >
              {title}
            </h2>
            {subtitle && (
              <p className="text-[13px] text-[var(--muted)] mt-0.5 break-words">{subtitle}</p>
            )}
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={attemptClose}
            aria-label={t('closeLabel')}
            className="w-11 h-11 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-[var(--border-strong)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div
          className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain p-4 md:p-5 flex flex-col gap-4 ${
            footer ? '' : 'safe-bottom'
          }`}
        >
          {children}
        </div>

        {footer && (
          <div className="sticky bottom-0 z-10 shrink-0 border-t border-[var(--line)] px-4 py-3 md:px-5 md:py-3.5 bg-[var(--card)] safe-bottom">
            {footer}
          </div>
        )}

        {showDiscardConfirm && (
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={confirmTitleId}
            className="absolute inset-0 z-20 flex items-center justify-center p-4 bg-[var(--backdrop)]"
          >
            <div className="w-full max-w-sm rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 md:p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--warn-bg)] text-[var(--warn-text)] flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3
                    id={confirmTitleId}
                    className="text-base font-semibold text-[var(--text)]"
                  >
                    {discardTitle}
                  </h3>
                  <p className="text-xs text-[var(--muted)] mt-1 leading-relaxed">
                    {t('discardChangesBody')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 md:justify-end">
                <button
                  ref={keepEditingBtnRef}
                  type="button"
                  onClick={() => setShowDiscardConfirm(false)}
                  className="flex-1 md:flex-initial min-h-[44px] px-4 rounded-xl border border-[var(--border-strong)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--surface-subtle)] text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  {t('keepEditing')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDiscardConfirm(false);
                    onCloseRef.current();
                  }}
                  className="flex-1 md:flex-initial min-h-[44px] px-4 rounded-xl bg-[var(--danger-solid)] text-[var(--on-danger)] hover:opacity-90 text-sm font-semibold transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  {t('discard')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ModalFooter({
  summary,
  secondary,
  primary,
  danger = false,
  loading = false,
  extra,
}: ModalFooterProps) {
  return (
    <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between md:gap-6">
      {summary && (
        <div className="w-full md:flex-1 md:min-w-0 text-sm text-[var(--text)]">{summary}</div>
      )}
      <div
        className={`flex flex-col gap-2 md:flex-row md:items-center md:justify-end md:shrink-0 ${
          !summary ? 'w-full md:ml-auto' : 'w-full md:w-auto'
        }`}
      >
        {extra ? <div className="flex items-center gap-2 w-full md:w-auto">{extra}</div> : null}
        <div
          className={`flex items-center gap-2 ${
            extra ? 'w-full md:w-auto' : 'w-full md:w-auto md:justify-end'
          }`}
        >
          {secondary && (
            <button
              type={secondary.type ?? 'button'}
              form={secondary.form}
              onClick={secondary.onClick}
              disabled={Boolean(secondary.disabled)}
              aria-label={secondary['aria-label']}
              className="flex-1 md:flex-none md:min-w-[130px] min-h-[48px] px-[18px] rounded-xl border border-[var(--border-strong)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--surface-subtle)] text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {secondary.icon}
              <span>{secondary.label}</span>
            </button>
          )}
          {primary && (
            <button
              type={primary.type ?? 'button'}
              form={primary.form}
              onClick={primary.onClick}
              disabled={Boolean(loading || primary.disabled)}
              aria-busy={Boolean(loading)}
              aria-label={primary['aria-label']}
              className={`flex-1 md:flex-none md:min-w-[130px] min-h-[48px] px-[18px] rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                danger
                  ? 'bg-[var(--danger-solid)] text-[var(--on-danger)] hover:opacity-90'
                  : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)]'
              }`}
            >
              {loading ? (
                <Loader2
                  className="w-4 h-4 animate-spin motion-reduce:animate-none shrink-0"
                  aria-hidden="true"
                />
              ) : (
                primary.icon
              )}
              <span>{primary.label}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
