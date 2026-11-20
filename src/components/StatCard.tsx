import React from 'react';

export interface StatCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'accent' | 'warn' | 'danger';
  className?: string;
}

const VALUE_TONE_CLASS: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'text-[var(--text)]',
  accent: 'text-[var(--accent)]',
  warn: 'text-[var(--warn-text)]',
  danger: 'text-[var(--danger-text)]',
};

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  className = '',
}: StatCardProps) {
  return (
    <div className={`card-surface p-3.5 md:p-4 min-w-0 ${className}`}>
      <div className="text-xs font-medium text-[var(--muted)] truncate">{label}</div>
      <div
        className={`text-lg md:text-xl font-bold mt-1 tabular-nums break-words ${VALUE_TONE_CLASS[tone]}`}
      >
        {value}
      </div>
      {hint && (
        <div className="text-[11px] text-[var(--muted)] mt-1 truncate">{hint}</div>
      )}
    </div>
  );
}
