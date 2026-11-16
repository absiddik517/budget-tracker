import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidthClass?: string;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidthClass = 'lg:max-w-xl',
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-black/50 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative z-10 w-full ${maxWidthClass} h-[100dvh] lg:h-auto lg:max-h-[90vh] flex flex-col bg-[var(--card)] text-[var(--text)] lg:rounded-[14px] border-0 lg:border lg:border-[var(--line)] overflow-hidden`}
      >
        <div className="safe-top flex items-center justify-between gap-3 px-4 lg:px-6 py-3.5 border-b border-[var(--line)] shrink-0">
          <div className="min-w-0">
            <h2 id="modal-title" className="text-lg font-semibold truncate">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-[var(--muted)] truncate mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 safe-bottom">
          {children}
        </div>
      </div>
    </div>
  );
}
