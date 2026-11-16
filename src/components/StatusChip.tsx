import type { ReactNode } from 'react';

export type ChipVariant =
  | 'approved'
  | 'active'
  | 'draft'
  | 'nearLimit'
  | 'invited'
  | 'submitted'
  | 'executed'
  | 'withdrawn'
  | 'voided'
  | 'rejected'
  | 'disabled'
  | 'roleAccent'
  | 'roleNeutral';

const VARIANT_CLASSES: Record<ChipVariant, string> = {
  approved: 'bg-[var(--accent-soft)] text-[var(--accent)]',
  active: 'bg-[var(--accent-soft)] text-[var(--accent)]',
  roleAccent: 'bg-[var(--accent-soft)] text-[var(--accent)]',
  draft: 'bg-[var(--warn-bg)] text-[var(--warn-text)]',
  nearLimit: 'bg-[var(--warn-bg)] text-[var(--warn-text)]',
  invited: 'bg-[var(--warn-bg)] text-[var(--warn-text)]',
  submitted: 'border border-[var(--line)] text-[var(--muted)] bg-transparent',
  executed: 'border border-[var(--line)] text-[var(--muted)] bg-transparent',
  withdrawn: 'border border-[var(--line)] text-[var(--muted)] bg-transparent',
  voided: 'border border-[var(--line)] text-[var(--muted)] bg-transparent',
  roleNeutral: 'border border-[var(--line)] text-[var(--text)] bg-transparent',
  rejected: 'bg-[var(--danger-bg)] text-[var(--danger-text)]',
  disabled: 'bg-[var(--danger-bg)] text-[var(--danger-text)]',
};

export function StatusChip({
  variant,
  children,
  className = '',
}: {
  variant: ChipVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
