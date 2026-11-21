import React, { createContext, useContext } from 'react';

export interface FieldContextValue {
  inputId?: string;
  describedBy?: string;
  invalid?: boolean;
  required?: boolean;
}

export const FieldContext = createContext<FieldContextValue>({});

export function useFieldContext(): FieldContextValue {
  return useContext(FieldContext);
}

export function mergeDescribedBy(
  ...parts: Array<string | undefined | false | null>
): string | undefined {
  const tokens = parts
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .flatMap((p) => p.trim().split(/\s+/));
  if (tokens.length === 0) return undefined;
  return Array.from(new Set(tokens)).join(' ');
}

/**
 * Focuses and scrolls into view the first invalid control inside a form or modal container.
 * Returns true if an invalid focusable element was found and focused.
 */
export function focusFirstInvalidField(container: ParentNode | null | undefined): boolean {
  if (!container) return false;
  const firstInvalid = container.querySelector<HTMLElement>(
    '[aria-invalid="true"]:not([disabled]), input:invalid:not([disabled]), select:invalid:not([disabled]), textarea:invalid:not([disabled])'
  );
  if (!firstInvalid) return false;
  firstInvalid.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  window.requestAnimationFrame(() => {
    firstInvalid.focus({ preventScroll: true });
  });
  return true;
}
