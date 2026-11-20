import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useMountTransition } from '../hooks/useMountTransition';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  ariaLabel?: string;
  /** Anchor element for desktop (>= 1024px) popover positioning. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  /**
   * 'popover' (default): bottom sheet under 1024px, anchored popover at >= 1024px.
   * 'center': bottom sheet on mobile, centered dialog on md+.
   * 'mobileOnly': bottom sheet under 1024px only.
   */
  desktopMode?: 'popover' | 'center' | 'mobileOnly';
  /** Legacy alias for desktopMode="center" */
  desktopCenter?: boolean;
  maxWidthClass?: string;
  closeLabel?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

let mountedSheetCount = 0;
let savedBodyOverflow = '';

export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  ariaLabel,
  anchorRef,
  desktopMode,
  desktopCenter = false,
  maxWidthClass = 'md:max-w-md',
  closeLabel = 'Close',
  children,
  footer,
}: BottomSheetProps) {
  const resolvedDesktopMode = desktopMode ?? (desktopCenter ? 'center' : 'popover');
  const { mounted, visible } = useMountTransition(open, 200);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const prevFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : false
  );
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; right: number }>({
    top: 64,
    right: 24,
  });

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    if (!open || !isDesktop || resolvedDesktopMode !== 'popover') return;
    const updatePosition = () => {
      const anchor = anchorRef?.current;
      if (!anchor) {
        setPopoverCoords({ top: 64, right: 24 });
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const top = Math.min(Math.max(rect.bottom + 8, 12), window.innerHeight - 160);
      const right = Math.max(12, window.innerWidth - rect.right);
      setPopoverCoords({ top, right });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, isDesktop, resolvedDesktopMode, anchorRef]);

  // Body scroll lock with reference counter
  useEffect(() => {
    if (!mounted) return;
    if (mountedSheetCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    mountedSheetCount += 1;
    return () => {
      mountedSheetCount = Math.max(0, mountedSheetCount - 1);
      if (mountedSheetCount === 0) {
        document.body.style.overflow = savedBodyOverflow;
      }
    };
  }, [mounted]);

  // Focus initialization, Escape, and Tab focus trap
  useEffect(() => {
    if (!open) return;
    prevFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const raf = window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && panelRef.current?.contains(active)) return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const firstFocusable = focusable && focusable.length > 0 ? focusable[0] : null;
      if (firstFocusable) {
        firstFocusable.focus({ preventScroll: true });
      } else if (closeBtnRef.current) {
        closeBtnRef.current.focus({ preventScroll: true });
      } else {
        panelRef.current?.focus({ preventScroll: true });
      }
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
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
    };
  }, [open]);

  useEffect(() => {
    if (mounted) return;
    const restoreTarget = prevFocusedRef.current;
    prevFocusedRef.current = null;
    if (restoreTarget && document.contains(restoreTarget)) {
      restoreTarget.focus({ preventScroll: true });
    }
  }, [mounted]);

  if (!mounted) return null;

  const isDesktopPopover = isDesktop && resolvedDesktopMode === 'popover';
  const isDesktopCenter = resolvedDesktopMode === 'center';

  const wrapperClass = isDesktopPopover
    ? 'fixed inset-0 z-50 overscroll-contain no-print'
    : isDesktopCenter
      ? 'fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4 overscroll-contain no-print'
      : 'lg:hidden fixed inset-0 z-50 flex items-end justify-center overscroll-contain no-print';

  const backdropClass = isDesktopPopover
    ? `fixed inset-0 bg-black/15 dark:bg-black/30 transition-opacity duration-200 motion-reduce:transition-none ${
        visible ? 'opacity-100' : 'opacity-0'
      }`
    : `fixed inset-0 bg-black/50 transition-opacity duration-200 motion-reduce:transition-none ${
        visible ? 'opacity-100' : 'opacity-0'
      }`;

  const panelBaseClass =
    'flex flex-col bg-[var(--card)] text-[var(--text)] overflow-hidden shadow-xl focus:outline-none transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none';

  const panelVariantClass = isDesktopPopover
    ? `fixed z-10 w-[min(360px,calc(100vw-2rem))] max-h-[min(72dvh,540px)] rounded-[14px] border border-[var(--line)] ${
        visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-1 scale-95'
      }`
    : isDesktopCenter
      ? `relative z-10 w-full ${maxWidthClass} max-h-[88%] md:max-h-[88dvh] rounded-t-[16px] md:rounded-[16px] border-t md:border border-[var(--line)] ${
          visible
            ? 'translate-y-0 md:scale-100 md:opacity-100'
            : 'translate-y-full md:translate-y-0 md:scale-95 md:opacity-0'
        }`
      : `relative z-10 w-full max-h-[88%] rounded-t-[16px] border-t border-[var(--line)] ${
          visible ? 'translate-y-0' : 'translate-y-full'
        }`;

  return (
    <div
      className={wrapperClass}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-label={!title ? ariaLabel : undefined}
    >
      <div className={backdropClass} onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        tabIndex={-1}
        style={
          isDesktopPopover
            ? { top: `${popoverCoords.top}px`, right: `${popoverCoords.right}px` }
            : undefined
        }
        className={`${panelBaseClass} ${panelVariantClass}`}
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
                <div className="text-xs text-[var(--muted)] truncate mt-0.5">{subtitle}</div>
              )}
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        <div
          className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${
            footer || isDesktopPopover ? '' : 'safe-bottom'
          }`}
        >
          {children}
        </div>

        {footer && (
          <div
            className={`shrink-0 border-t border-[var(--line)] px-4 py-3 bg-[var(--card)] ${
              isDesktopPopover ? '' : 'safe-bottom'
            }`}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
