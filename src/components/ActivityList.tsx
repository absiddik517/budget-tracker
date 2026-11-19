import { formatActorBrief } from '../lib/actor';
import { useApp } from '../contexts/AppContext';
import type { AuditLogDoc } from '../types';

function formatTimestamp(ts: AuditLogDoc['timestamp']): string {
  if (!ts) return 'Pending sync';
  try {
    const dt = ts.toDate();
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yyyy = dt.getFullYear();
    const hh = String(dt.getHours()).padStart(2, '0');
    const min = String(dt.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  } catch {
    return '—';
  }
}

const ACTION_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  submit: 'Submitted',
  approve: 'Approved',
  reject: 'Rejected',
  cancel: 'Cancelled',
  void: 'Voided',
  migrate: 'Migrated',
  handover: 'DDO Handover',
  transfer: 'Transferred',
  chargeGrant: 'Granted Addl. Charge',
  chargeWithdraw: 'Withdrew Charge',
  disable: 'Disabled',
  enable: 'Enabled',
  correct: 'Corrected (Audited)',
};

export function ActivityList({
  logs,
  loading,
  showContext = false,
}: {
  logs: AuditLogDoc[];
  loading: boolean;
  showContext?: boolean;
}) {
  const { officesById } = useApp();

  if (loading) {
    return <p className="text-xs text-[var(--muted)] py-2">Loading activity…</p>;
  }
  if (logs.length === 0) {
    return <p className="text-xs text-[var(--muted)] py-2">No activity recorded yet.</p>;
  }
  return (
    <ul className="divide-y divide-[var(--line)]">
      {logs.map((log) => {
        const actorText = log.actor
          ? formatActorBrief(log.actor, officesById, log.userName)
          : log.userName || log.userId;
        const office = log.officeId ? officesById.get(log.officeId) : null;
        return (
          <li key={log.id} className="py-2.5 text-xs flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <div>
                <span className="font-semibold text-[var(--text)]">
                  {ACTION_LABELS[log.action] || log.action}
                </span>{' '}
                {showContext && (
                  <span className="text-[var(--muted)]">
                    · <span className="font-mono text-[11px]">{log.collection}</span>
                    {office ? ` (${office.nameBn || office.name})` : log.officeId === null ? ' (Global)' : ''}
                  </span>
                )}
              </div>
              <div className="text-[var(--muted)] break-words">by {actorText}</div>
            </div>
            <span className="text-[var(--muted)] tabular-nums whitespace-nowrap shrink-0">
              {formatTimestamp(log.timestamp)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
