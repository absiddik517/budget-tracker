import { X } from 'lucide-react';
import { useApp } from '../contexts/AppContext';

export function ToastContainer() {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-[72px] lg:bottom-5 left-3 right-3 sm:left-auto sm:right-4 z-50 flex flex-col gap-2 sm:max-w-sm sm:w-full no-print"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        let style = 'bg-[var(--card)] border-[var(--line)] text-[var(--text)]';
        if (toast.type === 'error') {
          style = 'bg-[var(--danger-bg)] border-transparent text-[var(--danger-text)]';
        } else if (toast.type === 'warning') {
          style = 'bg-[var(--warn-bg)] border-transparent text-[var(--warn-text)]';
        } else if (toast.type === 'success') {
          style = 'bg-[var(--accent-soft)] border-transparent text-[var(--accent)]';
        }

        return (
          <div
            key={toast.id}
            className={`flex items-center justify-between gap-3 px-4 py-3 rounded-[14px] border text-sm font-medium shadow-sm ${style}`}
          >
            <span>{toast.text}</span>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss message"
              className="p-1 rounded-md opacity-70 hover:opacity-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
