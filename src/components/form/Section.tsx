import React from 'react';

export interface SectionProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Section({
  title,
  description,
  action,
  children,
  className = '',
}: SectionProps) {
  return (
    <section
      className={`rounded-2xl border border-[var(--line)] bg-[var(--bg)] p-3.5 space-y-3.5 ${className}`}
    >
      {(title || description || action) && (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            {title && (
              <h3 className="text-[15px] font-bold text-[var(--text)] leading-snug">{title}</h3>
            )}
            {description && (
              <p className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}
