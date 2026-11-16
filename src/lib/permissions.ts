import type { Role } from '../types';

export function canCreateDraftSpending(role: Role): boolean {
  return role === 'employee' || role === 'ddo' || role === 'superAdmin';
}

export function canApproveRejectVoid(role: Role): boolean {
  return role === 'ddo' || role === 'superAdmin';
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
