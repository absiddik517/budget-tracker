export function isValidEconomicCode(code: string, allowSpecial = false): boolean {
  const trimmed = code.trim();
  if (allowSpecial && trimmed === 'GENERAL-CONSTRUCTION') {
    return true;
  }
  return /^\d{7}$/.test(trimmed);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
