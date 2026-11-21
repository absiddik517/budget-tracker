import React, { useRef } from 'react';
import { mergeDescribedBy, useFieldContext } from './FieldContext';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  fullWidth?: boolean;
  className?: string;
  'aria-describedby'?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  fullWidth = true,
  className = '',
  'aria-describedby': ariaDescribedBy,
}: SegmentedProps<T>) {
  const ctx = useFieldContext();
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const resolvedDescribedBy = mergeDescribedBy(ctx.describedBy, ariaDescribedBy);

  const selectedIndex = options.findIndex((o) => o.value === value && !o.disabled);
  const firstEnabledIndex = options.findIndex((o) => !o.disabled);
  const focusableIndex = selectedIndex >= 0 ? selectedIndex : firstEnabledIndex;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (
      e.key !== 'ArrowRight' &&
      e.key !== 'ArrowDown' &&
      e.key !== 'ArrowLeft' &&
      e.key !== 'ArrowUp'
    ) {
      return;
    }
    e.preventDefault();
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const total = options.length;
    for (let step = 1; step <= total; step += 1) {
      const nextIdx = (index + dir * step + total) % total;
      const nextOpt = options[nextIdx];
      if (!nextOpt.disabled) {
        onChange(nextOpt.value);
        btnRefs.current[nextIdx]?.focus({ preventScroll: true });
        break;
      }
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-describedby={resolvedDescribedBy}
      className={`p-1 rounded-xl border border-[var(--border-strong)] bg-[var(--accent-soft)] gap-1 ${
        fullWidth ? 'grid grid-flow-col auto-cols-fr w-full' : 'inline-flex flex-wrap'
      } ${className}`}
    >
      {options.map((opt, idx) => {
        const selected = opt.value === value;
        const isTabStop = idx === focusableIndex;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              btnRefs.current[idx] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={opt.disabled}
            tabIndex={isTabStop ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`min-h-[44px] px-2.5 py-2 rounded-[9px] text-sm font-semibold inline-flex items-center justify-center text-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
              selected
                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
