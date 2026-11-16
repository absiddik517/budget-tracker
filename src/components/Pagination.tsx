import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  pageSize?: number;
  totalItems: number;
  onPageChange: (nextPage: number) => void;
}

export function Pagination({
  page,
  pageSize = 50,
  totalItems,
  onPageChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems <= pageSize) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(totalItems, page * pageSize);

  return (
    <div className="flex items-center justify-between gap-2 px-3 md:px-4 py-2.5 md:py-3 border-t border-[var(--line)] text-xs text-[var(--muted)]">
      <span className="tabular-nums truncate">
        {start}–{end} of {totalItems}
      </span>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-[var(--line)] text-[var(--text)] disabled:opacity-40 hover:bg-[var(--surface-subtle)] transition-colors"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="px-1.5 font-medium text-[var(--text)] tabular-nums">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-[var(--line)] text-[var(--text)] disabled:opacity-40 hover:bg-[var(--surface-subtle)] transition-colors"
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
