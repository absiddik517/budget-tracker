import { formatTaka } from './money';
import type { BudgetDoc, FyCodeTotalDoc, SpendingLimitDoc } from '../types';

export type ConstraintKind = 'budgetHeadroom' | 'codeLimit' | 'budgetLimit';

export interface LimitingConstraint {
  kind: ConstraintKind;
  available: number;
  rate?: number;
  cap?: number;
  economicCode: string;
  memoNo?: string;
  limitId?: string;
  message: string;
  exceededMessage: string;
}

export interface ComputeAvailableInput {
  budget: Pick<
    BudgetDoc,
    'id' | 'fiscalYear' | 'economicCode' | 'memoNo' | 'allocated' | 'spent' | 'status'
  >;
  fyCodeTotal: Pick<FyCodeTotalDoc, 'allocated' | 'spent'> | null | undefined;
  spendingLimits: SpendingLimitDoc[];
  date: string; // YYYY-MM-DD
  gross: number; // integer paisa
}

export interface ComputeAvailableResult {
  available: number; // integer paisa
  allowed: boolean;
  budgetHeadroom: number;
  codeLimitHeadroom: number | null;
  budgetLimitHeadroom: number | null;
  activeCodeLimit: SpendingLimitDoc | null;
  activeBudgetLimit: SpendingLimitDoc | null;
  limitingConstraint: LimitingConstraint;
}

function getTimeMillis(ts: SpendingLimitDoc['updatedAt'] | SpendingLimitDoc['createdAt']): number {
  if (!ts) return 0;
  if (typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function pickLatestEffectiveLimit(
  limits: SpendingLimitDoc[],
  date: string
): SpendingLimitDoc | null {
  const eligible = limits.filter(
    (l) => l.status === 'active' && l.effectiveDate <= date
  );
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    if (a.effectiveDate !== b.effectiveDate) {
      return b.effectiveDate.localeCompare(a.effectiveDate);
    }
    const timeDiff = getTimeMillis(b.updatedAt ?? b.createdAt) - getTimeMillis(a.updatedAt ?? a.createdAt);
    if (timeDiff !== 0) return timeDiff;
    return a.rate - b.rate;
  });
  return eligible[0];
}

/**
 * Pure function computing available spendable paisa and enforcing ministry caps.
 * Used identically by the Spending form, Submit check, and Approve Firestore transaction.
 */
export function computeAvailable({
  budget,
  fyCodeTotal,
  spendingLimits,
  date,
  gross,
}: ComputeAvailableInput): ComputeAvailableResult {
  const budgetHeadroom = budget.allocated - budget.spent;

  const codeLimits = spendingLimits.filter(
    (l) =>
      l.type === 'code' &&
      l.fiscalYear === budget.fiscalYear &&
      l.economicCode === budget.economicCode
  );
  const activeCodeLimit = pickLatestEffectiveLimit(codeLimits, date);

  let codeLimitHeadroom: number | null = null;
  let codeCap: number | undefined;
  if (activeCodeLimit) {
    const totalAllocated = fyCodeTotal ? fyCodeTotal.allocated : budget.allocated;
    const totalSpent = fyCodeTotal ? fyCodeTotal.spent : budget.spent;
    codeCap = Math.round((totalAllocated * activeCodeLimit.rate) / 100);
    codeLimitHeadroom = codeCap - totalSpent;
  }

  const budgetLimits = spendingLimits.filter(
    (l) =>
      l.type === 'budget' &&
      l.fiscalYear === budget.fiscalYear &&
      l.budgetId === budget.id
  );
  const activeBudgetLimit = pickLatestEffectiveLimit(budgetLimits, date);

  let budgetLimitHeadroom: number | null = null;
  let budgetCap: number | undefined;
  if (activeBudgetLimit) {
    budgetCap = Math.round((budget.allocated * activeBudgetLimit.rate) / 100);
    budgetLimitHeadroom = budgetCap - budget.spent;
  }

  const candidates: Array<{
    kind: ConstraintKind;
    headroom: number;
    rate?: number;
    cap?: number;
    limitId?: string;
  }> = [
    {
      kind: 'budgetHeadroom',
      headroom: budgetHeadroom,
    },
  ];

  if (codeLimitHeadroom !== null && activeCodeLimit) {
    candidates.push({
      kind: 'codeLimit',
      headroom: codeLimitHeadroom,
      rate: activeCodeLimit.rate,
      cap: codeCap,
      limitId: activeCodeLimit.id,
    });
  }

  if (budgetLimitHeadroom !== null && activeBudgetLimit) {
    candidates.push({
      kind: 'budgetLimit',
      headroom: budgetLimitHeadroom,
      rate: activeBudgetLimit.rate,
      cap: budgetCap,
      limitId: activeBudgetLimit.id,
    });
  }

  // Pick the strictest (minimum headroom) constraint
  candidates.sort((a, b) => a.headroom - b.headroom);
  const strictest = candidates[0];
  const available = strictest.headroom;

  let message = '';
  let exceededMessage = '';

  if (strictest.kind === 'codeLimit') {
    message = `Available now ${formatTaka(available)} · limited by the ${strictest.rate}% cap on ${budget.economicCode}`;
    exceededMessage = `Exceeds the ${strictest.rate}% cap on ${budget.economicCode}. Available now: ${formatTaka(available)}`;
  } else if (strictest.kind === 'budgetLimit') {
    message = `Available now ${formatTaka(available)} · limited by the ${strictest.rate}% cap on ${budget.memoNo}`;
    exceededMessage = `Exceeds the ${strictest.rate}% cap on ${budget.memoNo}. Available now: ${formatTaka(available)}`;
  } else {
    message = `Available now ${formatTaka(available)} · budget remaining balance`;
    exceededMessage = `Exceeds remaining budget balance on ${budget.memoNo}. Available now: ${formatTaka(available)}`;
  }

  const allowed = gross > 0 && gross <= available;

  return {
    available,
    allowed,
    budgetHeadroom,
    codeLimitHeadroom,
    budgetLimitHeadroom,
    activeCodeLimit,
    activeBudgetLimit,
    limitingConstraint: {
      kind: strictest.kind,
      available,
      rate: strictest.rate,
      cap: strictest.cap,
      economicCode: budget.economicCode,
      memoNo: budget.memoNo,
      limitId: strictest.limitId,
      message,
      exceededMessage,
    },
  };
}
