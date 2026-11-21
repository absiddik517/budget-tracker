import React from 'react';
import { mergeDescribedBy, useFieldContext } from './FieldContext';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  className?: string;
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  id,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  className = '',
}: ToggleProps) {
  const ctx = useFieldContext();
  const resolvedId = id ?? ctx.inputId;
  const resolvedDescribedBy = mergeDescribedBy(ctx.describedBy, ariaDescribedBy);

  const switchTrack = (
    <span
      aria-hidden="true"
      className={`relative inline-flex items-center w-12 h-7 rounded-full shrink-0 transition-colors ${
        checked
          ? 'bg-[var(--accent)] border border-[var(--accent)]'
          : 'bg-[var(--border-strong)] border border-[var(--border-strong)]'
      }`}
    >
      <span
        className={`inline-block w-[22px] h-[22px] rounded-full transition-transform motion-reduce:transition-none ${
          checked
            ? 'translate-x-[22px] bg-[var(--on-accent)]'
            : 'translate-x-[2px] bg-[var(--card)]'
        }`}
      />
    </span>
  );

  if (!label && !description) {
    return (
      <button
        id={resolvedId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        aria-describedby={resolvedDescribedBy}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`min-h-[44px] min-w-[48px] inline-flex items-center justify-center rounded-xl disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${className}`}
      >
        {switchTrack}
      </button>
    );
  }

  return (
    <button
      id={resolvedId}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-describedby={resolvedDescribedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`w-full min-h-[56px] px-3.5 py-2.5 rounded-xl border border-[var(--border-strong)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] flex items-center justify-between gap-3 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${className}`}
    >
      <span className="min-w-0 flex-1">
        {label && (
          <span className="block text-sm font-medium text-[var(--text)] leading-snug">
            {label}
          </span>
        )}
        {description && (
          <span className="block text-xs text-[var(--muted)] mt-0.5 leading-relaxed">
            {description}
          </span>
        )}
      </span>
      {switchTrack}
    </button>
  );
}
