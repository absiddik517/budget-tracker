import { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { ActivityList } from '../components/ActivityList';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/form';
import { useApp } from '../contexts/AppContext';
import { useGlobalAuditLogs } from '../hooks/useAuditLogs';

export function ActivityPage() {
  const { offices, t } = useApp();
  const [officeFilter, setOfficeFilter] = useState<'ALL' | 'GLOBAL' | string>('ALL');
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');

  const { logs, loading } = useGlobalAuditLogs(true, officeFilter, 200);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((log) => {
      if (actionFilter !== 'ALL' && log.action !== actionFilter) return false;
      if (!q) return true;
      return (
        log.userName?.toLowerCase().includes(q) ||
        log.collection.toLowerCase().includes(q) ||
        log.docId.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        (log.actor?.name || '').toLowerCase().includes(q)
      );
    });
  }, [logs, actionFilter, search]);

  return (
    <Layout title={t('navActivity')}>
      <PageHeader title={t('navActivity')} />
      <div className="space-y-4">
        <div className="card-surface p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <Select
            variant="compact"
            modalTitle="কার্যালয় ফিল্টার"
            aria-label="Filter by office"
            value={officeFilter}
            onChange={(e) => setOfficeFilter(e.target.value)}
            options={[
              { value: 'ALL', label: 'সকল অফিস + গ্লোবাল' },
              { value: 'GLOBAL', label: 'শুধু গ্লোবাল কার্যক্রম' },
              ...offices.map((o) => ({
                value: o.id,
                label: o.nameBn || o.name,
                subtitle: `কোড: ${o.code}`,
                keywords: `${o.name} ${o.nameBn} ${o.code}`,
              })),
            ]}
          />

          <Select
            variant="compact"
            modalTitle="কার্যক্রমের ধরন"
            aria-label="Filter by action"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            <option value="ALL">সকল ধরন</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="correct">Correct (Audited)</option>
            <option value="submit">Submit</option>
            <option value="approve">Approve</option>
            <option value="reject">Reject</option>
            <option value="cancel">Cancel</option>
            <option value="handover">DDO Handover</option>
            <option value="transfer">Transfer</option>
            <option value="chargeGrant">Grant Addl. Charge</option>
            <option value="chargeWithdraw">Withdraw Charge</option>
            <option value="migrate">Migrate</option>
          </Select>

          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="কর্মকর্তা, কালেকশন বা ডকুমেন্ট খুঁজুন…"
            className="min-h-[44px] md:min-h-[40px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] text-sm"
          />
        </div>

        <div className="card-surface p-4 md:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-[var(--accent)]" />
              <span>কার্যক্রম বিবরণী ({filteredLogs.length})</span>
            </h2>
          </div>
          <ActivityList logs={filteredLogs} loading={loading} showContext />
        </div>
      </div>
    </Layout>
  );
}
