import assert from 'node:assert/strict';
import { computeAvailable } from './computeAvailable.ts';
import type { SpendingLimitDoc } from '../types/index.ts';

const baseBudget = {
  id: 'b1',
  fiscalYear: '2025-26',
  economicCode: '3211106',
  memoNo: 'Memo 01/26',
  allocated: 30000000, // 3,00,000 taka in paisa
  spent: 18000000, // 1,80,000 taka in paisa
  status: 'active' as const,
};

const baseCodeTotal = {
  allocated: 30000000,
  spent: 18000000,
};

const codeLimit80: SpendingLimitDoc = {
  id: 'l1',
  type: 'code',
  budgetId: null,
  fiscalYear: '2025-26',
  economicCode: '3211106',
  headName: 'Entertainment',
  headNameBn: 'আপ্যায়ন ব্যয়',
  rate: 80,
  unit: 'percent',
  effectiveDate: '2025-12-01',
  refNo: 'Ref-001',
  status: 'active',
};

// Test 1: Code limit 80% reduces available from 1,20,000 to 60,000
{
  const res = computeAvailable({
    budget: baseBudget,
    fyCodeTotal: baseCodeTotal,
    spendingLimits: [codeLimit80],
    date: '2026-01-15',
    gross: 5000000, // 50,000
  });
  assert.equal(res.available, 6000000); // 60,000
  assert.equal(res.allowed, true);
  assert.equal(res.limitingConstraint.kind, 'codeLimit');
}

// Test 2: Exceeding 80% code cap fails with explicit message
{
  const res = computeAvailable({
    budget: baseBudget,
    fyCodeTotal: baseCodeTotal,
    spendingLimits: [codeLimit80],
    date: '2026-01-15',
    gross: 6500000, // 65,000
  });
  assert.equal(res.allowed, false);
  assert.ok(res.limitingConstraint.exceededMessage.includes('80% cap on 3211106'));
  assert.ok(res.limitingConstraint.exceededMessage.includes('60,000'));
}

// Test 3: Limit effectiveDate in future does not apply yet
{
  const res = computeAvailable({
    budget: baseBudget,
    fyCodeTotal: baseCodeTotal,
    spendingLimits: [codeLimit80],
    date: '2025-11-15',
    gross: 10000000, // 1,00,000
  });
  assert.equal(res.available, 12000000); // 1,20,000
  assert.equal(res.allowed, true);
  assert.equal(res.limitingConstraint.kind, 'budgetHeadroom');
}

// Test 4: Latest effectiveDate among multiple code limits wins
{
  const earlier50: SpendingLimitDoc = {
    ...codeLimit80,
    id: 'l0',
    rate: 50,
    effectiveDate: '2025-07-01',
  };
  const res = computeAvailable({
    budget: baseBudget,
    fyCodeTotal: baseCodeTotal,
    spendingLimits: [earlier50, codeLimit80],
    date: '2025-12-01',
    gross: 6000000,
  });
  assert.equal(res.available, 6000000);
  assert.equal(res.activeCodeLimit?.id, 'l1');
}

// Test 5: Stricter of code limit and budget limit wins
{
  const budgetLimit70: SpendingLimitDoc = {
    ...codeLimit80,
    id: 'l2',
    type: 'budget',
    budgetId: 'b1',
    rate: 70,
    effectiveDate: '2025-12-05',
  };
  const res = computeAvailable({
    budget: baseBudget,
    fyCodeTotal: baseCodeTotal,
    spendingLimits: [codeLimit80, budgetLimit70],
    date: '2025-12-10',
    gross: 3500000, // 35,000 > 30,000 (70% of 3,00,000 - 1,80,000)
  });
  assert.equal(res.available, 3000000);
  assert.equal(res.allowed, false);
  assert.equal(res.limitingConstraint.kind, 'budgetLimit');
}

// Test 6: Withdrawn limit is ignored
{
  const withdrawnLimit: SpendingLimitDoc = {
    ...codeLimit80,
    status: 'withdrawn',
  };
  const res = computeAvailable({
    budget: baseBudget,
    fyCodeTotal: baseCodeTotal,
    spendingLimits: [withdrawnLimit],
    date: '2026-01-15',
    gross: 12000000,
  });
  assert.equal(res.available, 12000000);
  assert.equal(res.allowed, true);
}

console.log('All computeAvailable tests passed!');
