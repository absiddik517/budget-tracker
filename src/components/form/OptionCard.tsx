import React, { useRef } from 'react';
import { Check } from 'lucide-react';
import { mergeDescribedBy, useFieldContext } from './FieldContext';

export interface OptionCardProps {
  selected: boolean;
  onSelect: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  trailing?: React.ReactNode;
  disabled?: boolean;
  tabIndex?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  className?: string;
}

export const OptionCard = React.forwardRef<HTMLButtonElement, OptionCardProps>(
  function OptionCard(
    {
      selected,
      onSelect,
      title,
      description,
      trailing,
      disabled = false,
      tabIndex,
      onKeyDown,
      className = '',
    },
    ref
  ) {
    return (
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        tabIndex={tabIndex}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        className={`w-full min-h-[52px] px-3.5 py-2.5 rounded-xl text-left flex items-center gap-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
          selected
            ? 'border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
            : 'border border-[var(--border-strong)] bg-[var(--card)] hover:bg-[var(--surface-subtle)] text-[var(--text)]'
        } ${className}`}
      >
        <span
          aria-hidden="true"
          className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors ${
            selected
              ? 'bg-[var(--accent)] text-[var(--on-accent)] border border-[var(--accent)]'
              : 'border-2 border-[var(--border-strong)] bg-[var(--card)]'
          }`}
        >
          {selected && <Check className="w-3 h-3" strokeWidth={3} />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-[var(--text)] leading-snug">
            {title}
          </span>
          {description && (
            <span className="block text-xs text-[var(--muted)] mt-0.5 leading-relaxed">
              {description}
            </span>
          )}
        </span>
        {trailing && <span className="shrink-0">{trailing}</span>}
      </button>
    );
  }
);

export interface OptionCardItem<T extends string> {
  value: T;
  title: React.ReactNode;
  description?: React.ReactNode;
  trailing?: React.ReactNode;
  disabled?: boolean;
}

export interface OptionCardListProps<T extends string> {
  options: Array<OptionCardItem<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
  'aria-describedby'?: string;
}

export function OptionCardList<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
  'aria-describedby': ariaDescribedBy,
}: OptionCardListProps<T>) {
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
      className={`space-y-2 ${className}`}
    >
      {options.map((opt, idx) => (
        <OptionCard
          key={opt.value}
          ref={(el) => {
            btnRefs.current[idx] = el;
          }}
          selected={opt.value === value}
          onSelect={() => onChange(opt.value)}
          title={opt.title}
          description={opt.description}
          trailing={opt.trailing}
          disabled={opt.disabled}
          tabIndex={idx === focusableIndex ? 0 : -1}
          onKeyDown={(e) => handleKeyDown(e, idx)}
        />
      ))}
    </div>
  );
}
