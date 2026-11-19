import type {
  ActorRef,
  ActorSnapshot,
  OfficeDoc,
  OfficeRole,
  PostingKind,
  Role,
  UserDoc,
  WorkHistoryDoc,
} from '../types';

export function buildActorSnapshot(params: {
  user: UserDoc;
  officeId: string | null;
  role: Role;
  kind?: PostingKind | null;
  workHistoryId?: string | null;
  activePosting?: WorkHistoryDoc | null;
}): ActorSnapshot {
  const { user, officeId, role, kind = null, workHistoryId = null, activePosting = null } = params;
  if (role === 'superAdmin' || user.globalRole === 'superAdmin') {
    return {
      uid: user.id,
      name: user.name,
      designation: user.designation || 'Super Admin',
      officeId: null,
      role: 'superAdmin',
      kind: null,
      workHistoryId: null,
    };
  }
  return {
    uid: user.id,
    name: user.name,
    designation: activePosting?.designation || user.designation || '',
    officeId,
    role,
    kind: activePosting?.kind ?? kind ?? 'regular',
    workHistoryId: activePosting?.id ?? workHistoryId ?? null,
  };
}

export function isActorSnapshot(ref: ActorRef | null | undefined): ref is ActorSnapshot {
  return Boolean(ref && typeof ref === 'object' && 'uid' in ref);
}

export function getActorUid(ref: ActorRef | null | undefined): string {
  if (!ref) return '';
  return isActorSnapshot(ref) ? ref.uid : ref;
}

export function getActorName(ref: ActorRef | null | undefined, fallbackName?: string): string {
  if (!ref) return fallbackName || '—';
  if (isActorSnapshot(ref)) return ref.name || fallbackName || ref.uid;
  return fallbackName || ref;
}

export function getActorRoleLabel(role: Role): string {
  switch (role) {
    case 'superAdmin':
      return 'Super Admin';
    case 'ddo':
      return 'DDO';
    case 'employee':
      return 'Employee';
  }
}

export function formatActorBrief(
  ref: ActorRef | null | undefined,
  officesById?: Map<string, OfficeDoc> | Record<string, OfficeDoc>,
  fallbackName?: string
): string {
  if (!ref) return fallbackName || '—';
  if (!isActorSnapshot(ref)) {
    return fallbackName || ref;
  }
  const roleLabel = getActorRoleLabel(ref.role);
  const office =
    ref.officeId && officesById
      ? officesById instanceof Map
        ? officesById.get(ref.officeId)
        : officesById[ref.officeId]
      : null;
  const officeName = office?.nameBn || office?.name || '';
  const kindTag = ref.kind === 'additionalCharge' ? ' (Addl. Charge)' : '';
  const parts = [ref.name, roleLabel + kindTag];
  if (officeName) parts.push(officeName);
  return parts.filter(Boolean).join(', ');
}

export function formatApprovedByLine(
  ref: ActorRef | null | undefined,
  officesById?: Map<string, OfficeDoc> | Record<string, OfficeDoc>,
  fallbackName?: string
): string {
  if (!ref) return '—';
  if (!isActorSnapshot(ref)) {
    return fallbackName || ref;
  }
  const office =
    ref.officeId && officesById
      ? officesById instanceof Map
        ? officesById.get(ref.officeId)
        : officesById[ref.officeId]
      : null;
  const officeName = office?.nameBn || office?.name || '';
  const roleLabel = getActorRoleLabel(ref.role);
  const parts = [ref.name, roleLabel];
  if (officeName) parts.push(officeName);
  return parts.filter(Boolean).join(', ');
}

export function deriveAccessFields(
  postings: Array<Pick<WorkHistoryDoc, 'officeId' | 'role' | 'kind' | 'status'>>
): {
  access: Record<string, OfficeRole>;
  officeIds: string[];
  homeOfficeId: string | null;
} {
  const access: Record<string, OfficeRole> = {};
  let homeOfficeId: string | null = null;

  for (const p of postings) {
    if (p.status !== 'active' || !p.officeId) continue;
    // If an office ever had both, DDO takes precedence
    const existing = access[p.officeId];
    if (!existing || p.role === 'ddo') {
      access[p.officeId] = p.role;
    }
    if (p.kind === 'regular') {
      homeOfficeId = p.officeId;
    }
  }

  return {
    access,
    officeIds: Object.keys(access),
    homeOfficeId,
  };
}
