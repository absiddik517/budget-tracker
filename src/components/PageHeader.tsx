import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { formatRoleLabel } from '../lib/permissions';

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode | null;
  backTo?: string;
  backLabel?: string;
  onBack?: () => void;
  statusChip?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  backTo,
  backLabel = 'Back',
  onBack,
  statusChip,
  actions,
  className = '',
}: PageHeaderProps) {
  const { selectedFy, effectiveRole } = useApp();

  const resolvedSubtitle =
    subtitle === undefined
      ? `FY ${selectedFy} · ${formatRoleLabel(effectiveRole)}`
      : subtitle;

  return (
    <div className={`mb-4 md:mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <div className="flex items-start gap-2.5 min-w-0 flex-1">
        {backTo ? (
          <Link
            to={backTo}
            aria-label={backLabel}
            className="min-h-[44px] min-w-[44px] -ml-1.5 inline-flex items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
        ) : onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            className="min-h-[44px] min-w-[44px] -ml-1.5 inline-flex items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--surface-subtle)] transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-[var(--text)] break-words">
              {title}
            </h1>
            {statusChip && <div className="shrink-0">{statusChip}</div>}
          </div>
          {resolvedSubtitle && (
            <div className="text-xs md:text-sm text-[var(--muted)] mt-0.5 tabular-nums break-words">
              {resolvedSubtitle}
            </div>
          )}
        </div>
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2 shrink-0 no-print">
          {actions}
        </div>
      )}
    </div>
  );
}
