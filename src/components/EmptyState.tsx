import React from 'react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--card)]/70 p-6 md:p-8 text-center flex flex-col items-center justify-center gap-2.5 ${className}`}
    >
      {icon && (
        <div className="w-10 h-10 rounded-xl bg-[var(--surface-subtle)] text-[var(--muted)] flex items-center justify-center">
          {icon}
        </div>
      )}
      <div className="text-sm md:text-base font-semibold text-[var(--text)] max-w-md">
        {title}
      </div>
      {description && (
        <p className="text-xs md:text-sm text-[var(--muted)] max-w-md leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
