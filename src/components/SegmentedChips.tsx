import React from 'react';

export interface SegmentedChipOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

interface SegmentedChipsProps<T extends string> {
  options: Array<SegmentedChipOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  trailing?: React.ReactNode;
  className?: string;
}

export function SegmentedChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel = 'Filter options',
  trailing,
  className = '',
}: SegmentedChipsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 ${className}`}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`min-h-[44px] md:min-h-[40px] px-3.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              active
                ? 'bg-[var(--accent)] text-[var(--on-accent)] font-semibold'
                : 'bg-[var(--card)] border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-subtle)]'
            }`}
          >
            <span>{opt.label}</span>
            {typeof opt.count === 'number' && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-[11px] tabular-nums leading-none ${
                  active
                    ? 'bg-white/20 text-current'
                    : 'bg-[var(--surface-subtle)] text-[var(--muted)]'
                }`}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
      {trailing}
    </div>
  );
}
