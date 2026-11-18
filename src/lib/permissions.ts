import type { Role } from '../types';

export function canCreateExpenseItems(role: Role): boolean {
  return role === 'employee' || role === 'ddo' || role === 'superAdmin';
}

export function canCreateDraftBill(role: Role): boolean {
  return role === 'employee' || role === 'ddo' || role === 'superAdmin';
}

export function canApproveRejectCancelBill(role: Role): boolean {
  return role === 'ddo';
}

export function canCreateDraftSpending(role: Role): boolean {
  return canCreateDraftBill(role);
}

export function canApproveRejectVoid(role: Role): boolean {
  return canApproveRejectCancelBill(role);
}

export function canEditDeleteApprovedSpending(role: Role): boolean {
  return role === 'superAdmin';
}

export function canCreateBudgets(role: Role): boolean {
  return role === 'ddo' || role === 'superAdmin';
}

export function canEditDeleteBudgets(role: Role): boolean {
  return role === 'superAdmin';
}

export function canMarkBudgetExecuted(role: Role): boolean {
  return role === 'ddo' || role === 'superAdmin';
}

export function canManageRates(role: Role): boolean {
  return role === 'ddo' || role === 'superAdmin';
}

export function canManageLimits(role: Role): boolean {
  return role === 'ddo' || role === 'superAdmin';
}

export function canManageUsersSettings(role: Role): boolean {
  return role === 'superAdmin';
}

export function formatRoleLabel(role: Role): string {
  switch (role) {
    case 'superAdmin':
      return 'Super Admin';
    case 'ddo':
      return 'DDO';
    case 'employee':
      return 'Employee';
  }
}
