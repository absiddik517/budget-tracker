import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../contexts/AppContext';
import { toBanglaDigits } from '../../lib/banglaFormat';

export interface RepeatCardProps {
  index?: number;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  extraActions?: React.ReactNode;
  onRemove?: () => void;
  canRemove?: boolean;
  removeLabel?: string;
  children: React.ReactNode;
  className?: string;
}

export function RepeatCard({
  index,
  title,
  subtitle,
  extraActions,
  onRemove,
  canRemove = true,
  removeLabel,
  children,
  className = '',
}: RepeatCardProps) {
  const { language, t } = useApp();

  const resolvedTitle =
    title ??
    (typeof index === 'number'
      ? `${t('itemLabel')} ${language === 'bn' ? toBanglaDigits(index + 1) : index + 1}`
      : t('itemLabel'));

  const resolvedRemoveLabel = removeLabel ?? t('removeItemLabel');

  const removeShortText = language === 'bn' ? 'সরান' : 'Remove';

  return (
    <div
      className={`rounded-2xl border border-[var(--line)] bg-[var(--bg)] p-3.5 space-y-3.5 ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[15px] font-bold text-[var(--text)] truncate">{resolvedTitle}</div>
          {subtitle && (
            <div className="text-xs text-[var(--muted)] truncate mt-0.5">{subtitle}</div>
          )}
        </div>
        {(extraActions || (onRemove && canRemove)) && (
          <div className="flex items-center gap-1 shrink-0">
            {extraActions}
            {onRemove && canRemove && (
              <button
                type="button"
                onClick={onRemove}
                aria-label={resolvedRemoveLabel}
                className="min-h-[44px] px-3 -mr-1.5 inline-flex items-center justify-center gap-1.5 rounded-xl border-0 bg-transparent text-sm font-semibold text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/60 transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{removeShortText}</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3.5">{children}</div>
    </div>
  );
}

export interface RepeatAddButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: React.ReactNode;
  icon?: React.ReactNode;
}

export function RepeatAddButton({
  label,
  icon,
  className = '',
  type = 'button',
  ...props
}: RepeatAddButtonProps) {
  return (
    <button
      type={type}
      className={`w-full min-h-[44px] px-3 rounded-xl border-[1.5px] border-dashed border-[var(--border-strong)] bg-transparent text-sm font-semibold text-[var(--accent)] hover:bg-[var(--accent-soft)]/50 inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${className}`}
      {...props}
    >
      {icon ?? <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );
}
