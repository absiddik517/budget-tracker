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
    'id' | 'fiscalYear' | 'economicCode' | 'memoNo' | 'allocated' | 'spent' | 'pendingAmount' | 'status'
  >;
  fyCodeTotal: Pick<FyCodeTotalDoc, 'allocated' | 'spent' | 'pendingAmount'> | null | undefined;
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

export interface ComputeCodeAvailableInput {
  fiscalYear: string;
  economicCode: string;
  budgets: Array<
    Pick<
      BudgetDoc,
      'id' | 'fiscalYear' | 'economicCode' | 'memoNo' | 'allocated' | 'spent' | 'pendingAmount' | 'status'
    >
  >;
  fyCodeTotal: Pick<FyCodeTotalDoc, 'allocated' | 'spent' | 'pendingAmount'> | null | undefined;
  spendingLimits: SpendingLimitDoc[];
  date: string;
  gross: number;
  excludePendingAmount?: number; // used when approving a submitted bill whose amount is already in pendingAmount
}

export interface ComputeCodeAvailableResult {
  allocation: number;
  approvedSpent: number;
  pendingAmount: number;
  available: number;
  allowed: boolean;
  activeCodeLimit: SpendingLimitDoc | null;
  limitingConstraint: LimitingConstraint;
}

function getTimeMillis(ts: SpendingLimitDoc['updatedAt'] | SpendingLimitDoc['createdAt']): number {
  if (!ts) return 0;
  if (typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export function pickLatestEffectiveLimit(
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
 * Pure function computing available spendable paisa for a single budget and enforcing ministry caps.
 * Factors in pendingAmount so available = allocation - approvedSpent - pendingAmount (subject to caps).
 */
export function computeAvailable({
  budget,
  fyCodeTotal,
  spendingLimits,
  date,
  gross,
}: ComputeAvailableInput): ComputeAvailableResult {
  const budgetPending = Math.max(0, budget.pendingAmount || 0);
  const budgetHeadroom = budget.allocated - budget.spent - budgetPending;

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
    const totalPending = fyCodeTotal ? Math.max(0, fyCodeTotal.pendingAmount || 0) : budgetPending;
    codeCap = Math.round((totalAllocated * activeCodeLimit.rate) / 100);
    codeLimitHeadroom = codeCap - totalSpent - totalPending;
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
    budgetLimitHeadroom = budgetCap - budget.spent - budgetPending;
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

/**
 * Code-level availability across all budgets of an economic code in a Fiscal Year.
 * Used by Expense Item Entry, Bill Submit, and DDO Bill Approval transactions.
 */
export function computeCodeAvailable({
  fiscalYear,
  economicCode,
  budgets,
  fyCodeTotal,
  spendingLimits,
  date,
  gross,
  excludePendingAmount = 0,
}: ComputeCodeAvailableInput): ComputeCodeAvailableResult {
  const codeBudgets = budgets.filter(
    (b) => b.fiscalYear === fiscalYear && b.economicCode === economicCode
  );
  const sumAllocated = codeBudgets.reduce((s, b) => s + b.allocated, 0);
  const sumSpent = codeBudgets.reduce((s, b) => s + b.spent, 0);
  const sumPending = codeBudgets.reduce((s, b) => s + Math.max(0, b.pendingAmount || 0), 0);

  const allocation = fyCodeTotal ? fyCodeTotal.allocated : sumAllocated;
  const approvedSpent = fyCodeTotal ? fyCodeTotal.spent : sumSpent;
  const rawPending = fyCodeTotal
    ? Math.max(0, fyCodeTotal.pendingAmount ?? sumPending)
    : sumPending;
  const effectivePending = Math.max(0, rawPending - Math.max(0, excludePendingAmount));

  const codeHeadroom = allocation - approvedSpent - effectivePending;

  const codeLimits = spendingLimits.filter(
    (l) => l.type === 'code' && l.fiscalYear === fiscalYear && l.economicCode === economicCode
  );
  const activeCodeLimit = pickLatestEffectiveLimit(codeLimits, date);

  let codeLimitHeadroom: number | null = null;
  let codeCap: number | undefined;
  if (activeCodeLimit) {
    codeCap = Math.round((allocation * activeCodeLimit.rate) / 100);
    codeLimitHeadroom = codeCap - approvedSpent - effectivePending;
  }

  // Also check if every active budget has single-budget caps that restrict total code headroom
  const activeBudgets = codeBudgets.filter((b) => b.status === 'active');
  let budgetSumHeadroom: number | null = null;
  let strictestBudgetCap: { rate: number; memoNo: string; limitId: string; cap: number } | null = null;

  if (activeBudgets.length > 0) {
    let totalBudgetSpendable = 0;
    let hasBudgetLimit = false;
    for (const b of activeBudgets) {
      const bLimits = spendingLimits.filter(
        (l) => l.type === 'budget' && l.fiscalYear === fiscalYear && l.budgetId === b.id
      );
      const bLimit = pickLatestEffectiveLimit(bLimits, date);
      const bPending = Math.max(0, b.pendingAmount || 0);
      if (bLimit) {
        hasBudgetLimit = true;
        const cap = Math.round((b.allocated * bLimit.rate) / 100);
        const hr = cap - b.spent - bPending;
        totalBudgetSpendable += Math.max(0, hr);
        strictestBudgetCap = {
          rate: bLimit.rate,
          memoNo: b.memoNo,
          limitId: bLimit.id,
          cap,
        };
      } else {
        totalBudgetSpendable += Math.max(0, b.allocated - b.spent - bPending);
      }
    }
    if (hasBudgetLimit) {
      budgetSumHeadroom = totalBudgetSpendable + Math.max(0, excludePendingAmount);
    }
  }

  const candidates: Array<{
    kind: ConstraintKind;
    headroom: number;
    rate?: number;
    cap?: number;
    memoNo?: string;
    limitId?: string;
  }> = [
    {
      kind: 'budgetHeadroom',
      headroom: codeHeadroom,
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

  if (budgetSumHeadroom !== null && strictestBudgetCap) {
    candidates.push({
      kind: 'budgetLimit',
      headroom: budgetSumHeadroom,
      rate: strictestBudgetCap.rate,
      cap: strictestBudgetCap.cap,
      memoNo: strictestBudgetCap.memoNo,
      limitId: strictestBudgetCap.limitId,
    });
  }

  candidates.sort((a, b) => a.headroom - b.headroom);
  const strictest = candidates[0];
  const available = strictest.headroom;

  let message = '';
  let exceededMessage = '';
  if (strictest.kind === 'codeLimit') {
    message = `উপলব্ধ ${formatTaka(available)} · ${economicCode} কোডে ${strictest.rate}% মন্ত্রণালয় সীমা কার্যকর`;
    exceededMessage = `${economicCode} কোডের ${strictest.rate}% ব্যয়সীমা (cap) অতিক্রম করেছে। উপলব্ধ: ${formatTaka(available)}`;
  } else if (strictest.kind === 'budgetLimit') {
    message = `উপলব্ধ ${formatTaka(available)} · বাজেট সীমা ${strictest.rate}% কার্যকর`;
    exceededMessage = `${strictest.memoNo || economicCode} বাজেটের ${strictest.rate}% ব্যয়সীমা অতিক্রম করেছে। উপলব্ধ: ${formatTaka(available)}`;
  } else {
    message = `উপলব্ধ ${formatTaka(available)} (বরাদ্দ − অনুমোদিত ব্যয় − আটকে থাকা)`;
    exceededMessage = `${economicCode} কোডের অবশিষ্ট উপলব্ধ বাজেট অতিক্রম করেছে। উপলব্ধ: ${formatTaka(available)}`;
  }

  const allowed = gross > 0 && gross <= available;

  return {
    allocation,
    approvedSpent,
    pendingAmount: rawPending,
    available,
    allowed,
    activeCodeLimit,
    limitingConstraint: {
      kind: strictest.kind,
      available,
      rate: strictest.rate,
      cap: strictest.cap,
      economicCode,
      memoNo: strictest.memoNo,
      limitId: strictest.limitId,
      message,
      exceededMessage,
    },
  };
}
