import { History, Building2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { StatusChip } from '../components/StatusChip';
import { useApp } from '../contexts/AppContext';
import { useMyWorkHistory } from '../hooks/useWorkHistory';
import { formatDateDisplay } from '../lib/dates';
import { formatRoleLabel } from '../lib/permissions';

export function MyWorkHistoryPage() {
  const { officesById, t } = useApp();
  const { records, loading } = useMyWorkHistory();

  return (
    <Layout title={t('navWorkHistory')}>
      <div className="space-y-4">
        <div className="card-surface overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--line)] flex items-center gap-2">
            <History className="w-4 h-4 text-[var(--accent)]" />
            <h2 className="text-sm font-semibold">আমার সকল পদায়ন ও কর্ম-ইতিহাস ({records.length})</h2>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-[var(--muted)]">ইতিহাস লোড হচ্ছে…</div>
          ) : records.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--muted)]">
              এখনো কোনো কর্ম-ইতিহাস লিপিবদ্ধ নেই।
            </div>
          ) : (
            <div className="divide-y divide-[var(--line)]">
              {records.map((wh) => {
                const office = officesById.get(wh.officeId);
                const officeLabel = office?.nameBn || office?.name || wh.officeName || wh.officeId;
                return (
                  <div key={wh.id} className="p-4 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-[var(--text)] flex items-center gap-1.5 bn">
                          <Building2 className="w-4 h-4 text-[var(--accent)] shrink-0" />
                          <span>{officeLabel}</span>
                        </div>
                        <div className="text-xs text-[var(--muted)] mt-0.5">
                          {wh.designation} · <strong>{formatRoleLabel(wh.role)}</strong> ·{' '}
                          {wh.kind === 'additionalCharge' ? 'অতিরিক্ত দায়িত্ব (Additional Charge)' : 'নিয়মিত (Regular)'}
                        </div>
                      </div>
                      <StatusChip variant={wh.status === 'active' ? 'active' : 'executed'}>
                        {wh.status === 'active' ? t('active') : t('ended')}
                      </StatusChip>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-[var(--muted)] bg-[var(--surface-subtle)] p-2.5 rounded-lg">
                      <div>
                        সময়কাল:{' '}
                        <span className="font-medium text-[var(--text)] tabular-nums">
                          {formatDateDisplay(wh.startDate)} →{' '}
                          {wh.endDate ? formatDateDisplay(wh.endDate) : 'বর্তমান'}
                        </span>
                      </div>
                      <div>
                        আদেশ নং:{' '}
                        <span className="font-medium text-[var(--text)]">
                          {wh.orderNo || '—'} ({formatDateDisplay(wh.orderDate)})
                        </span>
                      </div>
                      <div>
                        {wh.endReason ? (
                          <>
                            সমাপ্তির কারণ:{' '}
                            <span className="font-medium text-[var(--text)]">{wh.endReason}</span>
                          </>
                        ) : (
                          <>
                            পদায়নকারী:{' '}
                            <span className="font-medium text-[var(--text)]">
                              {wh.assignedBy?.name || '—'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {wh.remarks && (
                      <div className="text-xs text-[var(--muted)]">মন্তব্য: {wh.remarks}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
