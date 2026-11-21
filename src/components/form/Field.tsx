import React, { useId } from 'react';
import { AlertCircle } from 'lucide-react';
import { useApp } from '../../contexts/AppContext';
import { FieldContext, mergeDescribedBy } from './FieldContext';

export interface FieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  labelAs?: 'label' | 'span';
  labelAction?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function Field({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  labelAs = 'label',
  labelAction,
  className = '',
  children,
}: FieldProps) {
  const { t } = useApp();
  const generatedId = useId();
  const inputId = htmlFor ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = mergeDescribedBy(errorId, hintId);
  const invalid = Boolean(error);

  const labelContent = (
    <>
      <span>{label}</span>
      {required && (
        <>
          <span className="text-[var(--danger-text)] ml-0.5" aria-hidden="true">
            *
          </span>
          <span className="sr-only"> ({t('requiredFieldAria')})</span>
        </>
      )}
    </>
  );

  return (
    <FieldContext.Provider value={{ inputId, describedBy, invalid, required }}>
      <div className={`space-y-1.5 min-w-0 ${className}`}>
        <div className="flex items-center justify-between gap-2">
          {labelAs === 'label' ? (
            <label
              htmlFor={inputId}
              className="block text-[13px] font-semibold text-[var(--text)] leading-snug"
            >
              {labelContent}
            </label>
          ) : (
            <span className="block text-[13px] font-semibold text-[var(--text)] leading-snug">
              {labelContent}
            </span>
          )}
          {labelAction && <div className="shrink-0">{labelAction}</div>}
        </div>

        {children}

        {error && (
          <div
            id={errorId}
            role="alert"
            className="flex items-start gap-1.5 text-xs text-[var(--danger-text)] leading-snug"
          >
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {hint && (
          <p id={hintId} className="text-xs text-[var(--muted)] leading-relaxed">
            {hint}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
