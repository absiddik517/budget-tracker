import type { BillStatus, OfficeRole, Role } from '../types';

export interface PermissionContext {
  isSuperAdmin: boolean;
  officeRole: OfficeRole | null;
}

function normalizeCtx(roleOrCtx: Role | PermissionContext | null | undefined): PermissionContext {
  if (!roleOrCtx) return { isSuperAdmin: false, officeRole: null };
  if (typeof roleOrCtx === 'string') {
    if (roleOrCtx === 'superAdmin') return { isSuperAdmin: true, officeRole: null };
    return { isSuperAdmin: false, officeRole: roleOrCtx };
  }
  return roleOrCtx;
}

// --- Multi-office & Role matrix (Section 3) ---

export function canManageOffices(roleOrCtx: Role | PermissionContext | null | undefined): boolean {
  return normalizeCtx(roleOrCtx).isSuperAdmin;
}

export function canEditOfficeBasic(roleOrCtx: Role | PermissionContext | null | undefined): boolean {
  const ctx = normalizeCtx(roleOrCtx);
  return ctx.isSuperAdmin || ctx.officeRole === 'ddo';
}

export function canManageAllPostings(roleOrCtx: Role | PermissionContext | null | undefined): boolean {
  return normalizeCtx(roleOrCtx).isSuperAdmin;
}

export function canManageOfficeStaff(roleOrCtx: Role | PermissionContext | null | undefined): boolean {
  const ctx = normalizeCtx(roleOrCtx);
  return ctx.isSuperAdmin || ctx.officeRole === 'ddo';
}

export function canCreateBudgets(roleOrCtx: Role | PermissionContext | null | undefined): boolean {
  const ctx = normalizeCtx(roleOrCtx);
  // Super Admin does NOT run day-to-day budgets; only office DDO creates budgets & revisions
  return !ctx.isSuperAdmin && ctx.officeRole === 'ddo';
}

export function canMarkBudgetExecuted(roleOrCtx: Role | PermissionContext | null | undefined): boolean {
  const ctx = normalizeCtx(roleOrCtx);
  return !ctx.isSuperAdmin && ctx.officeRole === 'ddo';
}

export function canCorrectApprovedRecords(roleOrCtx: Role | PermissionContext | null | undefined): boolean {
  return normalizeCtx(roleOrCtx).isSuperAdmin;
}

export function canEditDeleteBudgets(roleOrCtx: Role | PermissionContext | null | undefined): boolean {
  return normalizeCtx(roleOrCtx).isSuperAdmin;
}

export function canCreateExpenseItems(roleOrCtx: Role | PermissionContext | null | undefined): boolean {
  const ctx = normalizeCtx(roleOrCtx);
  return !ctx.isSuperAdmin && (ctx.officeRole === 'ddo' || ctx.officeRole === 'employee');
}

export function canCreateDraftBill(roleOrCtx: Role | PermissionContext | null | undefined): boolean {
  const ctx = normalizeCtx(roleOrCtx);
  return !ctx.isSuperAdmin && (ctx.officeRole === 'ddo' || ctx.officeRole === 'employee');
}

export function canApproveRejectCancelBill(roleOrCtx: Role | PermissionContext | null | undefined): boolean {
  const ctx = normalizeCtx(roleOrCtx);
  return !ctx.isSuperAdmin && ctx.officeRole === 'ddo';
}

export function canEditDeleteApprovedSpending(roleOrCtx: Role | PermissionContext | null | undefined): boolean {
  return normalizeCtx(roleOrCtx).isSuperAdmin;
}

export function canDeleteBill(
  roleOrCtx: Role | PermissionContext | null | undefined,
  status: BillStatus,
  isCreator: boolean
): boolean {
  if (status !== 'draft' && status !== 'rejected' && status !== 'cancelled') return false;
  const ctx = normalizeCtx(roleOrCtx);
  if (ctx.isSuperAdmin) return true;
  if (ctx.officeRole === 'ddo') return true;
  if (ctx.officeRole === 'employee') {
    return isCreator && (status === 'draft' || status === 'rejected');
  }
  return false;
}

export function canCreateDraftSpending(roleOrCtx: Role | PermissionContext | null | undefined): boolean {
  return canCreateDraftBill(roleOrCtx);
}

export function canApproveRejectVoid(roleOrCtx: Role | PermissionContext | null | undefined): boolean {
  return canApproveRejectCancelBill(roleOrCtx);
}

export function canManageLimits(roleOrCtx: Role | PermissionContext | null | undefined): boolean {
  const ctx = normalizeCtx(roleOrCtx);
  return ctx.isSuperAdmin || ctx.officeRole === 'ddo';
}

export function canManageRates(roleOrCtx: Role | PermissionContext | null | undefined): boolean {
  // Global Economic Codes and VAT/Tax Rates: Super Admin only
  return normalizeCtx(roleOrCtx).isSuperAdmin;
}

export function canManageUsersSettings(roleOrCtx: Role | PermissionContext | null | undefined): boolean {
  return normalizeCtx(roleOrCtx).isSuperAdmin;
}

export function formatRoleLabel(role: Role | null | undefined): string {
  switch (role) {
    case 'superAdmin':
      return 'Super Admin';
    case 'ddo':
      return 'DDO';
    case 'employee':
      return 'Employee';
    default:
      return '—';
  }
}
