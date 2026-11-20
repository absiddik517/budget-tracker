import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useMountTransition } from '../hooks/useMountTransition';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  ariaLabel?: string;
  /** If true, renders as a bottom sheet on mobile and centered dialog on md+. Otherwise mobile-only (< lg). */
  desktopCenter?: boolean;
  maxWidthClass?: string;
  closeLabel?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  ariaLabel,
  desktopCenter = false,
  maxWidthClass = 'md:max-w-md',
  closeLabel = 'Close',
  children,
  footer,
}: BottomSheetProps) {
  const { mounted, visible } = useMountTransition(open, 220);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const prevFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!mounted) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [mounted]);

  useEffect(() => {
    if (!open) return;
    prevFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const raf = window.requestAnimationFrame(() => {
      if (closeBtnRef.current) {
        closeBtnRef.current.focus({ preventScroll: true });
      } else {
        panelRef.current?.focus({ preventScroll: true });
      }
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (mounted) return;
    if (prevFocusedRef.current && document.contains(prevFocusedRef.current)) {
      prevFocusedRef.current.focus({ preventScroll: true });
    }
    prevFocusedRef.current = null;
  }, [mounted]);

  if (!mounted) return null;

  const wrapperClass = desktopCenter
    ? 'fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4 overscroll-contain no-print'
    : 'lg:hidden fixed inset-0 z-50 flex items-end justify-center overscroll-contain no-print';

  const panelSizeClass = desktopCenter
    ? `w-full ${maxWidthClass} max-h-[88dvh] rounded-t-[16px] md:rounded-[16px] border-t md:border border-[var(--line)]`
    : 'w-full max-h-[88dvh] rounded-t-[16px] border-t border-[var(--line)]';

  const panelTransitionClass = desktopCenter
    ? visible
      ? 'translate-y-0 md:scale-100 md:opacity-100'
      : 'translate-y-full md:translate-y-0 md:scale-95 md:opacity-0'
    : visible
      ? 'translate-y-0'
      : 'translate-y-full';

  return (
    <div
      className={wrapperClass}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-label={!title ? ariaLabel : undefined}
    >
      <div
        className={`fixed inset-0 bg-black/50 backdrop-blur-[1px] transition-opacity duration-200 motion-reduce:transition-none ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className={`relative z-10 flex flex-col bg-[var(--card)] text-[var(--text)] overflow-hidden shadow-xl focus:outline-none transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none ${panelSizeClass} ${panelTransitionClass}`}
      >
        {(title || subtitle) && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--line)] shrink-0">
            <div className="min-w-0">
              {title && (
                <div
                  id={titleId}
                  className="text-sm md:text-base font-semibold text-[var(--text)] truncate"
                >
                  {title}
                </div>
              )}
              {subtitle && (
                <div className="text-xs text-[var(--muted)] truncate mt-0.5">
                  {subtitle}
                </div>
              )}
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        <div
          className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${
            footer ? '' : 'safe-bottom'
          }`}
        >
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-[var(--line)] px-4 py-3 bg-[var(--card)] safe-bottom">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
