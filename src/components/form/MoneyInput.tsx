import React, { forwardRef } from 'react';
import { mergeDescribedBy, useFieldContext } from './FieldContext';

export interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode'> {
  invalid?: boolean;
  prefixLabel?: string;
}

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  {
    id,
    invalid,
    prefixLabel = '৳',
    className = '',
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    required,
    disabled,
    ...props
  },
  ref
) {
  const ctx = useFieldContext();
  const resolvedId = id ?? ctx.inputId;
  const isInvalid = Boolean(invalid ?? ariaInvalid ?? ctx.invalid);
  const resolvedDescribedBy = mergeDescribedBy(ctx.describedBy, ariaDescribedBy);

  return (
    <div
      className={`w-full min-h-[48px] flex items-stretch rounded-xl border bg-[var(--card)] overflow-hidden transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)] focus-within:border-[var(--accent)] ${
        isInvalid ? 'border-[var(--danger-solid)]' : 'border-[var(--border-strong)]'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      <span
        aria-hidden="true"
        className="px-3.5 flex items-center justify-center bg-[var(--accent-soft)] border-r border-[var(--border-strong)] text-base font-medium text-[var(--muted)] select-none shrink-0"
      >
        {prefixLabel}
      </span>
      <input
        ref={ref}
        id={resolvedId}
        type="text"
        inputMode="decimal"
        disabled={disabled}
        required={required ?? ctx.required}
        aria-invalid={isInvalid ? true : undefined}
        aria-describedby={resolvedDescribedBy}
        className={`w-full min-w-0 min-h-[48px] px-3.5 py-2.5 bg-transparent text-[16px] leading-normal tabular-nums text-[var(--text)] focus:outline-none disabled:cursor-not-allowed ${className}`}
        {...props}
      />
    </div>
  );
});
