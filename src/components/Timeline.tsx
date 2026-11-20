export interface TimelineStep {
  id: string;
  title: string;
  actor?: string;
  date?: string;
  badge?: string;
  state: 'done' | 'approved' | 'rejected' | 'cancelled' | 'awaiting';
}

interface TimelineProps {
  steps: TimelineStep[];
  note?: string;
}

export function Timeline({ steps, note }: TimelineProps) {
  if (steps.length === 0) return null;

  return (
    <div className="space-y-3">
      <ol className="relative space-y-0">
        {steps.map((step, idx) => {
          const isLast = idx === steps.length - 1;
          const dotClass =
            step.state === 'approved' || step.state === 'done'
              ? 'bg-[var(--accent)] border-[var(--accent)]'
              : step.state === 'rejected'
                ? 'bg-[var(--danger-text)] border-[var(--danger-text)]'
                : step.state === 'cancelled'
                  ? 'bg-[var(--muted)] border-[var(--muted)]'
                  : 'bg-[var(--card)] border-[var(--muted)] border-dashed';

          return (
            <li key={step.id} className="relative pl-6 pb-4 last:pb-0">
              {!isLast && (
                <span
                  aria-hidden="true"
                  className="absolute left-[7px] top-4 bottom-0 w-px bg-[var(--line)]"
                />
              )}
              <span
                aria-hidden="true"
                className={`absolute left-0 top-1 w-[15px] h-[15px] rounded-full border-2 ${dotClass}`}
              />
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                  <span
                    className={`text-xs font-semibold ${
                      step.state === 'awaiting'
                        ? 'text-[var(--muted)]'
                        : step.state === 'rejected'
                          ? 'text-[var(--danger-text)]'
                          : 'text-[var(--text)]'
                    }`}
                  >
                    {step.title}
                  </span>
                  {step.badge && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--warn-bg)] text-[var(--warn-text)]">
                      {step.badge}
                    </span>
                  )}
                </div>
                {step.date && (
                  <span className="text-[11px] text-[var(--muted)] tabular-nums shrink-0">
                    {step.date}
                  </span>
                )}
              </div>
              {step.actor && (
                <div className="text-xs text-[var(--muted)] mt-0.5 break-words">
                  {step.actor}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {note && (
        <p className="text-[11px] text-[var(--muted)] pt-2 border-t border-[var(--line)]/70">
          {note}
        </p>
      )}
    </div>
  );
}
