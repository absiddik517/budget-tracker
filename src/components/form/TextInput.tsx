import React, { forwardRef } from 'react';
import { mergeDescribedBy, useFieldContext } from './FieldContext';

export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  {
    id,
    invalid,
    className = '',
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    required,
    ...props
  },
  ref
) {
  const ctx = useFieldContext();
  const resolvedId = id ?? ctx.inputId;
  const isInvalid = Boolean(invalid ?? ariaInvalid ?? ctx.invalid);
  const resolvedDescribedBy = mergeDescribedBy(ctx.describedBy, ariaDescribedBy);

  return (
    <input
      ref={ref}
      id={resolvedId}
      required={required ?? ctx.required}
      aria-invalid={isInvalid ? true : undefined}
      aria-describedby={resolvedDescribedBy}
      className={`w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border bg-[var(--card)] text-[16px] leading-normal text-[var(--text)] transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] focus:border-[var(--accent)] disabled:opacity-60 disabled:cursor-not-allowed ${
        isInvalid ? 'border-[var(--danger-solid)]' : 'border-[var(--border-strong)]'
      } ${className}`}
      {...props}
    />
  );
});
