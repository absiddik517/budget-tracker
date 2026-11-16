import React, { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { StatusChip } from '../components/StatusChip';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import { db } from '../lib/firebase';
import {
  createInvite,
  deleteInvite,
  updateUserRoleOrStatus,
} from '../lib/firestoreOps';
import { formatRoleLabel } from '../lib/permissions';
import type { InviteDoc, Role, UserDoc } from '../types';

export function UsersPage() {
  const { userDoc } = useAuth();
  const { pushToast, t } = useApp();

  const [users, setUsers] = useState<UserDoc[]>([]);
  const [invites, setInvites] = useState<InviteDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [designation, setDesignation] = useState('');
  const [role, setRole] = useState<Role>('employee');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as UserDoc))
        .sort((a, b) => a.name.localeCompare(b.name));
      setUsers(list);
      setLoading(false);
    });
    const unsubInvites = onSnapshot(collection(db, 'invites'), (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as InviteDoc))
        .sort((a, b) => a.email.localeCompare(b.email));
      setInvites(list);
    });
    return () => {
      unsubUsers();
      unsubInvites();
    };
  }, []);

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userDoc) return;
    setSaving(true);
    try {
      await createInvite(
        { email, name, designation, role },
        { uid: userDoc.id, name: userDoc.name }
      );
      pushToast('success', `Invitation created for ${email.toLowerCase()}.`);
      setInviteOpen(false);
      setEmail('');
      setName('');
      setDesignation('');
      setRole('employee');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to invite user.');
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (target: UserDoc, nextRole: Role) => {
    if (!userDoc) return;
    if (target.id === userDoc.id && nextRole !== 'superAdmin') {
      pushToast('error', 'You cannot remove your own Super Admin role.');
      return;
    }
    try {
      await updateUserRoleOrStatus(
        target.id,
        { role: nextRole },
        target as unknown as Record<string, unknown>,
        { uid: userDoc.id, name: userDoc.name }
      );
      pushToast('success', `${target.name} updated to ${formatRoleLabel(nextRole)}.`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to change role.');
    }
  };

  const handleToggleStatus = async (target: UserDoc) => {
    if (!userDoc) return;
    if (target.id === userDoc.id) {
      pushToast('error', 'You cannot disable your own account.');
      return;
    }
    const nextStatus = target.status === 'disabled' ? 'active' : 'disabled';
    try {
      await updateUserRoleOrStatus(
        target.id,
        { status: nextStatus },
        target as unknown as Record<string, unknown>,
        { uid: userDoc.id, name: userDoc.name }
      );
      pushToast(
        'success',
        nextStatus === 'disabled' ? `${target.name} disabled.` : `${target.name} enabled.`
      );
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to update status.');
    }
  };

  const handleDeleteInvite = async (inv: InviteDoc) => {
    if (!userDoc) return;
    try {
      await deleteInvite(inv.id, { uid: userDoc.id, name: userDoc.name });
      pushToast('success', `Invite for ${inv.email} removed.`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to remove invite.');
    }
  };

  const actions = (
    <button
      type="button"
      onClick={() => setInviteOpen(true)}
      className="min-h-[44px] md:min-h-[40px] px-3.5 md:px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-sm font-semibold whitespace-nowrap"
    >
      {t('newUser')}
    </button>
  );

  return (
    <Layout title={t('navUsers')} actions={actions}>
      <div className="space-y-4 md:space-y-5">
        <div className="card-surface overflow-hidden">
          {/* Mobile Card List */}
          <div className="md:hidden divide-y divide-[var(--line)]">
            {loading ? (
              <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                Loading users…
              </div>
            ) : users.length === 0 && invites.length === 0 ? (
              <div className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                {t('noDataFound')}
              </div>
            ) : (
              <>
                {users.map((u) => (
                  <div key={u.id} className="p-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[var(--text)] break-words">
                          {u.name}
                        </div>
                        {u.designation && (
                          <div className="text-xs text-[var(--muted)] mt-0.5 break-words">
                            {u.designation}
                          </div>
                        )}
                        <div className="text-xs text-[var(--muted)] mt-0.5 break-all">
                          {u.email}
                        </div>
                      </div>
                      <StatusChip variant={u.status === 'active' ? 'active' : 'disabled'}>
                        {u.status === 'active' ? t('active') : t('disabled')}
                      </StatusChip>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u, e.target.value as Role)}
                        aria-label={`Role for ${u.name}`}
                        className="flex-1 min-w-0 min-h-[44px] px-3 rounded-lg text-base font-medium border border-[var(--line)] bg-[var(--card)] text-[var(--text)]"
                      >
                        <option value="employee">Employee</option>
                        <option value="ddo">DDO</option>
                        <option value="superAdmin">Super Admin</option>
                      </select>

                      {u.id !== userDoc?.id && (
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(u)}
                          className="min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium hover:bg-[var(--surface-subtle)] shrink-0"
                        >
                          {u.status === 'disabled' ? 'Enable' : 'Disable'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {invites.map((inv) => (
                  <div key={inv.id} className="p-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[var(--text)] break-words">
                          {inv.name || inv.email.split('@')[0]}
                        </div>
                        {inv.designation && (
                          <div className="text-xs text-[var(--muted)] mt-0.5 break-words">
                            {inv.designation}
                          </div>
                        )}
                        <div className="text-xs text-[var(--muted)] mt-0.5 break-all">
                          {inv.email}
                        </div>
                      </div>
                      <StatusChip variant="invited">{t('invited')}</StatusChip>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <StatusChip
                        variant={inv.role === 'employee' ? 'roleNeutral' : 'roleAccent'}
                      >
                        {formatRoleLabel(inv.role)}
                      </StatusChip>
                      <button
                        type="button"
                        onClick={() => handleDeleteInvite(inv)}
                        className="min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40"
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                  <th className="sticky left-0 z-10 bg-[var(--card)] py-3 px-4 font-medium whitespace-nowrap">Name</th>
                  <th className="py-3 px-4 font-medium whitespace-nowrap">Designation</th>
                  <th className="py-3 px-4 font-medium whitespace-nowrap">Email</th>
                  <th className="py-3 px-4 font-medium whitespace-nowrap">Role</th>
                  <th className="py-3 px-4 font-medium whitespace-nowrap">Status</th>
                  <th className="py-3 px-4 font-medium text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-8 px-4 text-center text-sm text-[var(--muted)]">
                      Loading users…
                    </td>
                  </tr>
                ) : (
                  <>
                    {users.map((u) => (
                      <tr key={u.id} className="group hover:bg-[var(--surface-subtle)] transition-colors">
                        <td className="sticky left-0 z-10 bg-[var(--card)] group-hover:bg-[var(--surface-subtle)] py-3 px-4 font-medium whitespace-nowrap transition-colors">
                          {u.name}
                        </td>
                        <td className="py-3 px-4 text-[var(--muted)] whitespace-nowrap">
                          {u.designation}
                        </td>
                        <td className="py-3 px-4 text-[var(--muted)] whitespace-nowrap">
                          {u.email}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <select
                            value={u.role}
                            onChange={(e) => handleRoleChange(u, e.target.value as Role)}
                            aria-label={`Role for ${u.name}`}
                            className="min-h-[34px] px-2.5 rounded-full text-xs font-medium border border-[var(--line)] bg-[var(--card)] text-[var(--text)]"
                          >
                            <option value="employee">Employee</option>
                            <option value="ddo">DDO</option>
                            <option value="superAdmin">Super Admin</option>
                          </select>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <StatusChip variant={u.status === 'active' ? 'active' : 'disabled'}>
                            {u.status === 'active' ? t('active') : t('disabled')}
                          </StatusChip>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {u.id !== userDoc?.id && (
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(u)}
                              className="min-h-[34px] px-3 rounded-lg border border-[var(--line)] text-xs font-medium hover:bg-[var(--surface-subtle)]"
                            >
                              {u.status === 'disabled' ? 'Enable' : 'Disable'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}

                    {invites.map((inv) => (
                      <tr key={inv.id} className="group hover:bg-[var(--surface-subtle)] transition-colors">
                        <td className="sticky left-0 z-10 bg-[var(--card)] group-hover:bg-[var(--surface-subtle)] py-3 px-4 font-medium whitespace-nowrap transition-colors">
                          {inv.name || inv.email.split('@')[0]}
                        </td>
                        <td className="py-3 px-4 text-[var(--muted)] whitespace-nowrap">
                          {inv.designation}
                        </td>
                        <td className="py-3 px-4 text-[var(--muted)] whitespace-nowrap">
                          {inv.email}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <StatusChip
                            variant={inv.role === 'employee' ? 'roleNeutral' : 'roleAccent'}
                          >
                            {formatRoleLabel(inv.role)}
                          </StatusChip>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <StatusChip variant="invited">{t('invited')}</StatusChip>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleDeleteInvite(inv)}
                            className="min-h-[34px] px-3 rounded-lg border border-[var(--line)] text-xs font-medium text-[var(--danger-text)] hover:bg-[var(--danger-bg)]/40"
                          >
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Role permissions card */}
        <section className="card-surface p-4 md:p-5 space-y-2 text-sm">
          <h2 className="text-base font-semibold text-[var(--text)]">Role permissions</h2>
          <p className="text-[var(--muted)]">
            <strong className="text-[var(--text)]">Super Admin:</strong> everything, including users and settings, and editing/deleting approved entries or budgets.
          </p>
          <p className="text-[var(--muted)]">
            <strong className="text-[var(--text)]">DDO:</strong> budgets and revisions, approvals, voids, limits, VAT/IT rates, and all reports.
          </p>
          <p className="text-[var(--muted)]">
            <strong className="text-[var(--text)]">Employee:</strong> view all budgets and reports, create and submit own spending entries.
          </p>
        </section>
      </div>

      {/* Invite User Modal */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite User"
        subtitle="The user will receive their assigned role automatically on first sign-in."
        maxWidthClass="md:max-w-lg"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setInviteOpen(false)}
              className="min-h-[44px] px-4 rounded-lg border border-[var(--line)] text-sm font-medium"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="invite-user-form"
              disabled={saving}
              className="min-h-[44px] px-5 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-sm font-semibold disabled:opacity-60"
            >
              {saving ? 'Inviting…' : 'Send invite'}
            </button>
          </div>
        }
      >
        <form id="invite-user-form" onSubmit={handleInviteSubmit} className="space-y-4">
          <div>
            <label htmlFor="inv-email" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
              Email address
            </label>
            <input
              id="inv-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="officer@office.gov.bd"
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label htmlFor="inv-name" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                Name (optional)
              </label>
              <input
                id="inv-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
              />
            </div>
            <div>
              <label htmlFor="inv-desig" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                Designation
              </label>
              <input
                id="inv-desig"
                type="text"
                required
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="Accountant"
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="inv-role" className="block text-xs font-medium text-[var(--muted)] mb-1.5">
              Role
            </label>
            <select
              id="inv-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full min-h-[44px] px-3.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-base md:text-sm"
            >
              <option value="employee">Employee</option>
              <option value="ddo">DDO</option>
              <option value="superAdmin">Super Admin</option>
            </select>
          </div>
        </form>
      </Modal>
    </Layout>
  );
}
