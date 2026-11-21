import React from 'react';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';

export type BannerVariant = 'info' | 'warn' | 'danger';

export interface BannerProps {
  variant?: BannerVariant;
  title?: React.ReactNode;
  children: React.ReactNode;
  role?: 'status' | 'alert';
  className?: string;
}

export function Banner({
  variant = 'info',
  title,
  children,
  role,
  className = '',
}: BannerProps) {
  const resolvedRole = role ?? (variant === 'danger' ? 'alert' : 'status');

  const variantClasses: Record<BannerVariant, string> = {
    info: 'bg-[var(--accent-soft)] text-[var(--text)] border border-[var(--accent)]/40',
    warn: 'bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-text)]/30',
    danger: 'bg-[var(--danger-bg)] text-[var(--danger-text)] border border-[var(--danger-text)]/30',
  };

  const IconComponent =
    variant === 'danger' ? AlertCircle : variant === 'warn' ? AlertTriangle : Info;

  const iconColorClass = variant === 'info' ? 'text-[var(--accent)]' : 'text-current';

  return (
    <div
      role={resolvedRole}
      className={`rounded-xl px-3 py-2.5 flex items-start gap-2.5 text-sm leading-snug ${variantClasses[variant]} ${className}`}
    >
      <IconComponent className={`w-5 h-5 mt-0.5 shrink-0 ${iconColorClass}`} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <div className="font-semibold text-sm leading-snug">{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
}
