import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useMountTransition } from '../hooks/useMountTransition';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  maxWidthClass?: string;
  fullScreenOnMobile?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  footer,
  children,
  maxWidthClass = 'md:max-w-lg',
  fullScreenOnMobile = false,
}: ModalProps) {
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
      if (e.key === 'Escape') onClose();
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

  const containerSizeClass = fullScreenOnMobile
    ? `w-full h-dvh md:h-auto md:max-h-[88dvh] ${maxWidthClass} rounded-none md:rounded-[14px] border-0 md:border`
    : `w-[calc(100vw-1rem)] max-w-md md:w-full ${maxWidthClass} max-h-[88dvh] rounded-t-2xl md:rounded-[14px] border border-b-0 md:border-b`;

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center overscroll-contain no-print ${
        fullScreenOnMobile ? 'items-stretch md:items-center md:p-4' : 'items-end md:items-center md:p-4'
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
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
        className={`relative z-10 flex flex-col bg-[var(--card)] text-[var(--text)] border-[var(--line)] overflow-hidden focus:outline-none transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none ${containerSizeClass} ${
          visible
            ? 'translate-y-0 md:scale-100 md:opacity-100'
            : 'translate-y-full md:translate-y-0 md:scale-95 md:opacity-0'
        }`}
      >
        <div
          className={`${
            fullScreenOnMobile ? 'safe-top' : ''
          } flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4 border-b border-[var(--line)] shrink-0`}
        >
          <div className="min-w-0">
            <h2 id={titleId} className="text-base md:text-lg font-semibold truncate">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-[var(--muted)] truncate mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div
          className={`flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 md:p-6 ${
            footer ? '' : 'safe-bottom'
          }`}
        >
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-[var(--line)] px-4 md:px-6 py-3 bg-[var(--card)] safe-bottom">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
